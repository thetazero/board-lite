// When the server can't go on (#524): /healthz says so, and a move that
// couldn't be saved didn't happen, also once the server works again.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { startServer } from '../src/host.ts';
import { post as tap } from '../web/common.ts';

const DOWN = 'The server is down. Refresh the page.';
const tmp = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
let n = 0;
after(() => rmSync(tmp, { recursive: true, force: true }));
const root = process.getuid?.() === 0 && 'root writes to a read-only folder';

async function host(botDelayMs = 1) {
  const dir = join(tmp, String(n++));
  const { server, rooms } = startServer(0, { dir, botDelayMs }, [], '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => {
    const r = await fetch(url + path, { method: 'POST', body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() as any };
  };
  const health = async () => (await fetch(`${url}/healthz`)).status;
  const healthBecomes = async (want: number) => {
    const end = Date.now() + 10_000;
    while (await health() !== want && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await health(), want);
  };
  const close = () => {
    chmodSync(dir, 0o755);
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  };
  return { dir, url, rooms, post, health, healthBecomes, breaks: () => chmodSync(dir, 0o555), mends: () => chmodSync(dir, 0o755), close };
}

test('/healthz fails while the server cannot save, and passes again once it can, with no restart', { skip: root }, async () => {
  const s = await host();
  try {
    assert.equal(await s.health(), 200);
    s.breaks();
    await s.healthBecomes(503);
    s.mends();
    await s.healthBecomes(200);
    assert.deepEqual(readdirSync(s.dir), [], 'it leaves nothing behind');
  } finally { s.close(); }
});

test('a move that could not be saved did not happen, and tapping again does it once', { skip: root }, async () => {
  const s = await host();
  try {
    const { code, hostToken } = (await s.post('/api/rooms', {})).data;
    const at = `/api/rooms/${code}`;
    const ada = (await s.post(`${at}/join`, { name: 'Ada' })).data.token;
    const room = s.rooms.get(code)!;
    const refused = async (path: string, body: object) => assert.deepEqual(await s.post(path, body), { status: 503, data: { error: DOWN } });

    s.breaks();
    await refused('/api/rooms', {});
    await refused(`${at}/join`, { name: 'Bram' });
    await refused(`${at}/leave`, { token: ada });
    assert.deepEqual(room.lobby().seats.map((x) => x.name), ['Ada']);
    s.mends();
    const bram = (await s.post(`${at}/join`, { name: 'Bram' })).data.token;

    s.breaks();
    await refused(`${at}/start`, { token: hostToken });
    assert.equal(room.game, null);
    s.mends();
    assert.equal((await s.post(`${at}/start`, { token: hostToken })).status, 200);
    for (const [p, token] of [ada, bram].entries()) await s.post(`${at}/do`, { token, command: { do: 'keep', card: room.game!.players[p].choice[0].id } });
    const token = [ada, bram][room.game!.turn];

    // The same command again, under the same id and under another.
    const saved = readFileSync(room.file, 'utf8'), before = structuredClone(room.game);
    const say = { token, command: { do: 'say', message: 'Hello' }, id: 'a' };
    s.breaks();
    for (const body of [say, say, { ...say, id: 'b' }, { token, command: { do: 'end' } }]) await refused(`${at}/do`, body);
    await refused(`${at}/save`, { token });
    await refused(`${at}/quit`, { token });
    assert.deepEqual(room.game, before);
    assert.equal(room.savedAt, null);
    s.mends();
    assert.deepEqual(room.game, before, 'nor does it happen once the server works again');
    assert.equal(readFileSync(room.file, 'utf8'), saved);
    assert.equal((await s.post(`${at}/do`, say)).status, 200);
    assert.equal(room.game!.log.filter((e) => e.text.includes('"Hello"')).length, 1);
    assert.equal(JSON.parse(readFileSync(room.file, 'utf8')).log.length, room.game!.log.length);
    assert.equal((await s.post(`${at}/save`, { token })).status, 200);
  } finally { s.close(); }
});

test('a bot whose move could not be saved makes it once the server works again', { skip: root, timeout: 20_000 }, async () => {
  const s = await host(400);
  try {
    const { code, hostToken } = (await s.post('/api/rooms', {})).data;
    const at = `/api/rooms/${code}`;
    await s.post(`${at}/join`, { name: 'Ada' });
    await s.post(`${at}/bot`, { token: hostToken });
    const room = s.rooms.get(code)!;
    await s.post(`${at}/start`, { token: hostToken });
    const chosen = () => room.game!.players[1].choice.length === 0;
    s.breaks();
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(chosen(), false);
    s.mends();
    for (let i = 0; i < 100 && !chosen(); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(chosen(), true);
  } finally { s.close(); }
});

test('a tap on an open phone while the server is down says so, and is the same tap if sent again', async () => {
  const page = readFileSync(new URL('../web/down.html', import.meta.url), 'utf8');
  const proxy = createServer((_, res) => res.writeHead(503, { 'content-type': 'text/html' }).end(page)).listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  try {
    const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/api/rooms/ABCD/do`;
    await assert.rejects(tap(url, { command: { do: 'end' } }), (e: any) => e.message === DOWN && e.unanswered === true);
  } finally { proxy.close(); }
});

test('the maintenance page loads nothing', () => {
  const page = readFileSync(new URL('../web/down.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<script|url\(|@import|src=|https?:/);
  assert.deepEqual(page.match(/href="[^"]*"/g), ['href="data:,"']);
});
