// Which scenes the TV plays (web/tvscenes.ts), and the table not waiting for those it doesn't (#538, #540, #542).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, mock, test } from 'node:test';
import type { GameEvent } from '../src/engine.ts';
import { gameLogFile, startServer } from '../src/host.ts';
import { scenesOf } from '../web/scenes.ts';
import { TvScenes } from '../web/tvscenes.ts';

const dir = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const scene = (i: number) => ({ i, round: i, ev: { k: 'noRaid', why: 'held' } as GameEvent });
const plain = (i: number) => ({ i, round: i });

test('a scene up as the game is saved never comes back, nor do those waiting (#538)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tv = new TvScenes<string>();
    const ended: string[] = [];
    tv.add('production');
    tv.add('tend');
    assert.equal(tv.next(), 'production');
    tv.start([500, () => ended.push('fades')], [1000, () => ended.push('ends')]);
    mock.timers.tick(600);
    tv.drop(); // Game saved
    mock.timers.tick(60_000);
    assert.deepEqual(ended, ['fades'], 'its end never comes to draw the board again');
    assert.equal(tv.up, false);
    assert.equal(tv.next(), undefined);
  } finally {
    mock.timers.reset();
  }
});

test('a TV back online skips the scenes it missed, and plays the next (#540)', () => {
  const tv = new TvScenes<string>();
  assert.deepEqual(tv.take([plain(0), scene(1)], false), { play: [plain(0), scene(1)], missed: false }, 'as it happens');
  const log = [plain(0), scene(1), scene(2), plain(3), scene(4)];
  assert.deepEqual(tv.take(log, true), { play: [], missed: true });
  assert.deepEqual(tv.take(log, false), { play: [], missed: false }, 'for good');
  assert.deepEqual(tv.take([...log, scene(5)], false).play, [scene(5)]);
  // Back with nothing missed: what it's playing plays on.
  assert.equal(tv.take([...log, scene(5)], true).missed, false);
  assert.equal(tv.take([...log, scene(5), plain(6)], true).missed, false);
  // A restarted server lost the last moves: what happens instead still plays.
  tv.take(log, true);
  assert.deepEqual(tv.take([...log, scene(5)], false).play, [scene(5)]);
});

async function table() {
  const { server, rooms } = startServer(0, { dir, botDelayMs: 60_000 });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => {
    const r = await fetch(`${base}/api/rooms${path}`, { method: 'POST', body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, string> };
  };
  const { code, hostToken } = (await post('', {})).body;
  const room = rooms.get(code)!;
  const ada = room.join('Ada').token;
  room.join('Bram');
  const tv = room.connect(null, true);
  room.start(ada, 3);
  const play = () => {
    room.mutate((g) => g.log.push({ round: 1, text: 'Everyone holds back.', ev: { k: 'noRaid', why: 'held' } } as never));
    return room.game!.log.length - 1;
  };
  const held = () => room.snapshot(ada).scene! > 0;
  const stop = () => {
    tv();
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  };
  return { room, ada, hostToken, play, held, stop, skip: (token: string, seen: number) => post(`/${code}/skip`, { token, seen }) };
}

test("a TV reloaded in a scene says it plays none, and the phones don't wait for it (#542)", async () => {
  const t = await table();
  try {
    const seen = t.play();
    assert.ok(scenesOf(t.room.snapshot(null).game!.log).length && t.held());
    assert.equal((await t.skip(t.ada, seen)).status, 400, 'only the TV says so');
    assert.ok(t.held());
    assert.equal((await t.skip(t.hostToken, seen - 1)).status, 200);
    assert.ok(t.held(), 'a scene the TV has yet to hear of is still to come');
    const v = t.room.snapshot(t.ada).v!;
    await t.skip(t.hostToken, seen);
    assert.equal(t.held(), false);
    assert.ok(t.room.snapshot(t.ada).v! > v, 'the phones are told');
    assert.equal(readFileSync(gameLogFile(t.room.file), 'utf8').match(/"type":"release"/g)?.length, 1, 'the game log says so, once');
    t.play();
    assert.ok(t.held(), 'the next scene is waited for');
  } finally {
    t.stop();
  }
});

test('a game saved in a scene is continued with nothing to wait for (#538)', async () => {
  const t = await table();
  try {
    t.play();
    assert.ok(t.held());
    t.room.save(t.ada);
    assert.equal(t.held(), false);
    t.room.continue(t.ada);
    assert.equal(t.held(), false);
  } finally {
    t.stop();
  }
});
