// The server as a public website, and the /mcp a Claude client joins through.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { waitingOn } from '../src/engine.ts';
import { startServer, visitor, type Site } from '../src/host.ts';

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
    assert.match((await s.tool('act', { game: code, token, do: 'keep', card: card.id })).content[0].text, /Done/);
    await s.tool('say', { game: code, token, message: 'Hello' });
    assert.ok(room.game!.log.some((e) => e.text.includes('"Hello"')));
    const refused = await s.tool('act', { game: code, token, do: 'nonsense' });
    assert.ok(refused.isError);
    for (const name of ['view', 'wait', 'act']) assert.ok((await s.tool(name, { game: link, token: 'wrong', do: 'end' })).isError, `${name} needs a seat`);
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
  } finally { s.close(); }
});

test('a shared link has a preview: the game\'s image and text, and the code of a game', async () => {
  const s = await host(SITE);
  const home = await host();
  try {
    const tag = (html: string, name: string) => new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)">`).exec(html)?.[1];
    for (const [path, title] of [['/', 'board-lite'], ['/tv', 'board-lite'], ['/HXNL', 'Join game HXNL'], ['/hxnl/', 'Join game HXNL']]) {
      const html = await (await fetch(s.url + path)).text();
      assert.equal(tag(html, 'og:title'), title, path);
      assert.equal(tag(html, 'og:description'), 'Raise dragons and raid kingdoms.');
      assert.equal(tag(html, 'og:image'), `${SITE.origin}/preview.png`);
      assert.equal(tag(html, 'twitter:card'), 'summary_large_image');
      assert.ok(!html.includes('<!--preview-->'));
    }
    // A preview app reads the size it's told; the image has to be it.
    const png = Buffer.from(await (await fetch(`${s.url}/preview.png`)).arrayBuffer());
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
    assert.equal(tag(await (await fetch(`${home.url}/HXNL`)).text(), 'og:image'), `${home.url}/preview.png`);
  } finally {
    s.close();
    home.close();
  }
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
    assert.ok(!s.rooms.get(code)!.seats[0].strong, 'no strong bots');
    await s.post(`/api/rooms/${code}/join`, { name: 'Ada' });
    await s.post(`/api/rooms/${code}/start`, { token: hostToken });
    await s.post(`/api/rooms/${code}/save`, { token: hostToken });
    assert.deepEqual(await (await fetch(`${s.url}/api/saved`)).json(), [], 'saved games are not listed');
    assert.deepEqual(await (await fetch(`${s.url}/api/rooms/ZZZZ`, { headers: { 'x-forwarded-for': '203.0.113.3' } })).json(), { error: 'No room with code ZZZZ: check the code.' });

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

// (Which links name a game, and clearing old rooms and recaps, are tested in rust/src/mcp.rs and limits.rs.)
test('a visitor is their address', () => {
  assert.equal(visitor('::ffff:10.0.0.1'), '10.0.0.1');
  assert.equal(visitor('10.0.0.1', '9.9.9.9, 1.2.3.4'), '1.2.3.4');
  assert.equal(visitor('2001:db8:1:2:a:b:c:d'), visitor('2001:db8:1:2::9'));
  assert.notEqual(visitor('2001:db8:1:2::9'), visitor('2001:db8:1:3::9'));
});
