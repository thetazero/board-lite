// Rooms no one could get on with (#521): a TV that lost its game on reload, a
// lobby no one could start, a game of only bots no one could wake.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Room, RoomError, startServer } from '../src/host.ts';
import { starterName } from '../web/common.ts';
import { openRoom } from '../web/tvroom.ts';

const dir = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('a TV opening a room asks again while the server fails, and a wrong code is no room: neither makes one', async (t) => {
  const { server, rooms } = startServer(0, { dir: join(dir, 'tv') }, [], '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  let fails: (() => Promise<Response>)[] = [];
  let tvFails = 0;
  t.mock.method(globalThis, 'fetch', (path: string, init?: RequestInit) => {
    if (path.endsWith('/tv') && tvFails-- > 0) return Promise.resolve(Response.json({ error: 'x' }, { status: 503 }));
    return fails.shift()?.() ?? real(base + path, init);
  });
  const status: boolean[] = [];
  const open = (code: string, token = '') => openRoom(code, token, (ok) => void status.push(ok), 5);
  try {
    const made = await open('');
    assert.ok(made?.isHost);
    assert.deepEqual(rooms.keys(), [made.code]);
    fails = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(new Response('<html>Under maintenance', { status: 503 })),
      () => Promise.resolve(Response.json({ error: 'Too many requests: try again later.' }, { status: 429 })),
      () => Promise.resolve(new Response('<html>Bad request', { status: 400 })),
    ];
    assert.deepEqual(await open(made.code, made.hostToken), made, 'the same room, still its TV');
    assert.deepEqual(status, [false, false, false, false, true], 'it says it is reconnecting meanwhile');
    tvFails = 1;
    assert.deepEqual(await open(made.code), made, 'nor does it lose the buttons if the server fails then');
    for (const wrong of ['ZZZZ', '..', 'A/B']) assert.equal(await open(wrong), null);
    assert.deepEqual(rooms.keys(), [made.code]);
  } finally {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test('a lobby with no TV can always be started by someone in it', () => {
  // The first player adds a bot and leaves.
  let room = new Room('LBYA', { dir, remote: true, botDelayMs: 60000 });
  const ada = room.join('Ada');
  room.addBot();
  const bram = room.join('Bram'), cora = room.join('Cora');
  assert.equal(starterName(room.lobby()), 'Ada');
  room.leave(0);
  assert.equal(starterName(room.lobby()), 'Bram');
  assert.equal(room.canStart(ada.token), false);
  assert.throws(() => room.start(cora.token), (e) => e instanceof RoomError && e.message === 'Only Bram can start the game.');
  room.start(bram.token);
  room.close();

  // The first player is away, then back.
  room = new Room('LBYB', { dir, remote: true });
  const [dax, eve] = ['Dax', 'Eve'].map((n) => room.join(n));
  dax.seen = 0;
  room.changed();
  assert.equal(starterName(room.lobby()), 'Eve');
  assert.ok(room.canStart(eve.token));
  room.state(dax.token);
  assert.equal(starterName(room.lobby()), 'Dax');
  room.close();

  // A Claude player can't start, so being first doesn't make it the one, after a restart too.
  room = new Room('LBYC', { dir, remote: true });
  room.join('Claude', 'player', 'claude');
  const finn = room.join('Finn');
  assert.ok(room.canStart(finn.token));
  const file = room.file;
  room.close();
  room = new Room('LBYC', { file });
  assert.ok(room.canStart(finn.token));
  room.close();
});

test('a game of only bots goes on after a restart while a TV watches', async () => {
  let room = new Room('BOTS', { dir, botDelayMs: 60000 });
  room.addBot();
  room.addBot();
  room.start(room.hostToken, 3);
  const { file } = room;
  room.close();
  room = new Room('BOTS', { file, botDelayMs: 1 });
  const before = room.game!.log.length;
  const gone = room.connect(null, true);
  for (let n = 0; n < 200 && room.game!.log.length === before; n++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(room.game!.log.length > before, 'a bot moved');
  gone();
  room.close();
});
