// The server as a public website, and the /mcp a Claude client joins through.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { waitingOn } from '../src/engine.ts';
import { codeIn } from '../src/server/mcp.ts';
import { clearOld, parseOrigin, visitor, type Site } from '../src/server/public.ts';
import { startServer } from '../src/server/server.ts';

const tmp = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

async function host(site?: Site) {
  const { server, rooms } = startServer(0, { dir: join(tmp, String(n++)), botDelayMs: 1 }, [], '127.0.0.1', false, site);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object, headers: Record<string, string> = {}) => {
    const r = await fetch(url + path, { method: 'POST', body: JSON.stringify(body), headers });
    return { status: r.status, data: r.status === 202 ? null : await r.json() as any };
  };
  const tool = async (name: string, args: object) => (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).data.result as { content: any[]; isError?: boolean };
  const close = () => {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  };
  return { url, rooms, post, tool, close };
}

const SITE: Site = { origin: 'https://dragons.example' };

test('a Claude client given a game link joins and plays over /mcp', async () => {
  const s = await host(SITE);
  try {
    const { code, hostToken } = (await s.post('/api/rooms', { remote: true })).data;
    const link = `${SITE.origin}/${code}`;
    const init = await s.post('/mcp', { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.data.result.protocolVersion, '2025-06-18');
    assert.equal((await s.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.equal((await fetch(`${s.url}/mcp`)).status, 405);
    const tools = (await s.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).data.result.tools;
    assert.deepEqual(tools.map((t: any) => t.name), ['join', 'view', 'act', 'say', 'wait', 'rules']);

    const token = /token: (\w+)/.exec((await s.tool('join', { game: link, name: 'Claude' })).content[0].text)![1];
    await s.post(`/api/rooms/${code}/bot`, { token: hostToken });
    await s.post(`/api/rooms/${code}/start`, { token: hostToken });
    const room = s.rooms.get(code)!;
    const view = await s.tool('view', { game: link, token });
    assert.ok(view.content.some((c) => c.type === 'image'));
    assert.ok(!view.content[0].text.includes('undefined'));
    const card = room.snapshot(token).you!.choice[0];
    assert.ok(waitingOn(room.game!).includes(0));
    assert.match((await s.tool('act', { game: code, token, command: `keep ${card.id}` })).content[0].text, /Done/);
    await s.tool('say', { game: code, token, message: 'Hello' });
    assert.ok(room.game!.log.some((e) => e.text.includes('"Hello"')));
    const refused = await s.tool('act', { game: code, token, command: 'nonsense' });
    assert.ok(refused.isError);
    for (const name of ['view', 'wait', 'act']) assert.ok((await s.tool(name, { game: link, token: 'wrong', command: 'end' })).isError, `${name} needs a seat`);
    assert.equal((await s.tool('view', { game: link })).content[0].type, 'text');
    assert.ok((await s.tool('view', { game: link })).isError, 'no token is refused');
  } finally { s.close(); }
});

test('the link tells a client that reads it how to join; a browser gets the page', async () => {
  const s = await host(SITE);
  try {
    const md = await fetch(`${s.url}/ABCD`, { headers: { accept: 'text/markdown, text/html' } });
    const text = await md.text();
    assert.match(text, /https:\/\/dragons\.example\/mcp/);
    assert.match(text, /https:\/\/dragons\.example\/ABCD/);
    const html = await fetch(`${s.url}/ABCD`, { headers: { accept: 'text/html' } });
    assert.match(html.headers.get('content-type')!, /html/);
    assert.match(await html.text(), /llms\.txt/);
    assert.equal(codeIn('https://x.example/abcd'), 'ABCD');
    assert.equal(codeIn('https://x.example/tv?room=ABCD'), 'ABCD');
    assert.throws(() => codeIn('https://x.example/'));
  } finally { s.close(); }
});

test('a public website says nothing of its machine or of other games, and limits each visitor', async () => {
  const s = await host({ ...SITE, trustProxy: true, limits: { roomsPerHour: 2, wrongCodesPerMinute: 2, open: 1 } });
  try {
    const info = await (await fetch(`${s.url}/api/info`)).json();
    assert.deepEqual(info, { lan: [], tailscale: [], port: 0, origin: SITE.origin });
    const a = { 'x-forwarded-for': 'spoofed, 203.0.113.1' };
    const b = { 'x-forwarded-for': '203.0.113.2' };
    const { code, hostToken } = (await s.post('/api/rooms', {}, a)).data;
    const lobby = (await (await fetch(`${s.url}/api/rooms/${code}`)).json()).lobby;
    assert.equal(lobby.file, '', 'not where the game file is');
    await s.post(`/api/rooms/${code}/bot`, { token: hostToken, strong: true });
    assert.equal(s.rooms.get(code)!.seats[0].strong, undefined, 'no strong bots');
    await s.post(`/api/rooms/${code}/join`, { name: 'Ada' });
    await s.post(`/api/rooms/${code}/start`, { token: hostToken });
    await s.post(`/api/rooms/${code}/save`, { token: hostToken });
    assert.deepEqual(await (await fetch(`${s.url}/api/saved`)).json(), [], 'saved games are not listed');

    await s.post('/api/rooms', {}, a);
    assert.equal((await s.post('/api/rooms', {}, a)).status, 429);
    assert.equal((await s.post('/api/rooms', {}, b)).status, 200, 'the limit is each visitor\'s own');
    for (const status of [400, 400, 429]) assert.equal((await fetch(`${s.url}/api/rooms/QQQQ`, { headers: a })).status, status);
    assert.equal((await fetch(`${s.url}/api/rooms/${code}`, { headers: b })).status, 200);
    const stop = new AbortController();
    assert.equal((await fetch(`${s.url}/api/rooms/${code}/events`, { headers: b, signal: stop.signal })).status, 200);
    assert.equal((await fetch(`${s.url}/api/rooms/${code}/events`, { headers: b })).status, 429);
    stop.abort();

    const page = await fetch(`${s.url}/`);
    assert.match(page.headers.get('content-security-policy')!, /script-src 'self' 'sha256-/);
    assert.match(page.headers.get('strict-transport-security')!, /max-age/);
  } finally { s.close(); }
});

test('a request no URL parser takes is refused, and the server goes on', async () => {
  const s = await host(SITE);
  try {
    const port = Number(new URL(s.url).port);
    const sock = connect(port, '127.0.0.1');
    sock.write('GET // HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n');
    const [chunk] = await once(sock, 'data');
    assert.match(String(chunk), /^HTTP\/1\.1 400/);
    assert.equal((await (await fetch(`${s.url}/healthz`)).json()).ok, true);
  } finally { s.close(); }
});

test('old rooms and recaps are cleared; hosted, recent and unknown files stay', () => {
  const dir = mkdtempSync(join(tmp, 'old-'));
  const put = (name: string, days: number) => {
    writeFileSync(join(dir, name), '{}');
    const t = Date.now() / 1000 - days * 86400;
    utimesSync(join(dir, name), t, t);
  };
  put('BBBB.json', 40); put('BBBB.seats.json', 40); put('BBBB.log.jsonl', 40);
  put('CCCC.json', 40);
  put('DDDD.json', 1);
  put('notes.json', 400);
  clearOld(dir, (c) => c === 'CCCC');
  assert.deepEqual(['BBBB.json', 'BBBB.seats.json', 'BBBB.log.jsonl', 'CCCC.json', 'DDDD.json', 'notes.json'].map((f) => existsSync(join(dir, f))), [false, false, false, true, true, true]);
});

test('the public address is an origin, and a visitor is their address', () => {
  assert.equal(parseOrigin('https://dragons.example/'), 'https://dragons.example');
  for (const bad of ['dragons.example', 'ftp://x', 'https://x/path']) assert.throws(() => parseOrigin(bad));
  const req = (ip: string, fwd?: string) => ({ headers: { 'x-forwarded-for': fwd }, socket: { remoteAddress: ip } }) as any;
  assert.equal(visitor(req('::ffff:10.0.0.1')), '10.0.0.1');
  assert.equal(visitor(req('10.0.0.1', '1.2.3.4')), '10.0.0.1', 'not trusted without a proxy');
  assert.equal(visitor(req('10.0.0.1', '9.9.9.9, 1.2.3.4'), true), '1.2.3.4');
  assert.equal(visitor(req('2001:db8:1:2:a:b:c:d')), visitor(req('2001:db8:1:2::9')));
  assert.notEqual(visitor(req('2001:db8:1:2::9')), visitor(req('2001:db8:1:3::9')));
});
