import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { candidateCommands, playToEnd } from '../src/bot.ts';
import { newGame, waitingOn } from '../src/engine.ts';
import { gameLogFile } from '../src/host.ts';
import { Room, RoomError, startServer } from '../src/host.ts';
import { save } from '../src/store.ts';
import { SceneLog } from '../web/scenelog.ts';

const dir = mkdtempSync(join(tmpdir(), 'board-lite-gamelog-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines = (room: Room) => readFileSync(gameLogFile(room.file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('every entry of a game, timed and with who sent it, beside the save', () => {
  const room = new Room('GLOG', { dir });
  const seats = [room.join('Ada', 'player', 'phone'), room.join('Bram', 'player', 'cli')];
  room.start(seats[0].token, 3);
  const g = room.game!;
  const rng = { state: 2 };
  assert.throws(() => room.command(seats[0].token, { do: 'dance' } as any, 'phone'), RoomError);
  playToEnd(g, () => {
    const p = waitingOn(g)[0];
    for (const cmd of candidateCommands(g, p, rng)) {
      try {
        room.command(seats[p].token, cmd, p === 0 ? 'phone' : 'cli');
        break;
      } catch (e) {
        if (!(e instanceof RoomError)) throw e;
      }
    }
  });
  const log = lines(room);
  for (const l of log) {
    assert.ok(typeof l.ms === 'number' && new Date(l.t).getTime() === l.ms, 'every line is timed');
    assert.ok(l.by && typeof l.by.kind === 'string', 'and says who sent it');
  }
  const events = log.filter((l) => l.type === 'event');
  assert.deepEqual(events.map((l) => l.i), g.log.map((_, i) => i), 'every entry of the game log, once, in order');
  assert.deepEqual(events.map((l) => l.text), g.log.map((e) => e.text));
  assert.deepEqual(log.slice(0, 3).map((l) => [l.type, l.by.kind]), [['join', 'phone'], ['join', 'cli'], ['start', 'phone']]);
  assert.ok(events.some((l) => l.by.kind === 'phone' && l.by.seat === 0 && l.command?.do), 'a phone player\'s moves are theirs');
  assert.ok(events.some((l) => l.by.kind === 'cli' && l.by.name === 'Bram'), 'and a CLI player\'s');
  const dice = events.find((l) => l.ev.k === 'produce' && l.round > 1)!;
  assert.equal(dice.by.kind, 'game', 'dice are the game\'s');
  assert.ok(dice.cause?.seat >= 0 && dice.command, 'set off by whoever ended the round before');
  assert.ok(log.some((l) => l.type === 'refused' && l.command.do === 'dance' && l.by.name === 'Ada'), 'refused commands too');
  room.close();
});

test('bots, stand-ins, connects, saves, loads and handovers are logged too', async () => {
  const room = new Room('GLOB', { dir, botDelayMs: 1, awayMs: 1 });
  const ada = room.join('Ada', 'player', 'phone');
  const bram = room.join('Bram', 'player', 'phone');
  room.addBot();
  room.start(ada.token, 4);
  const hangUp = room.connect(ada.token);
  hangUp();
  await sleep(5);
  room.standInFor(bram.token, 0);
  for (let i = 0; i < 100 && !lines(room).some((l) => l.by.kind === 'standIn' && l.type === 'event'); i++) await sleep(10);
  room.save(ada.token);
  room.close();
  const log = lines(room);
  const kinds = new Set(log.map((l) => `${l.type}:${l.by.kind}`));
  for (const k of ['bot:bot', 'connect:phone', 'disconnect:phone', 'standIn:phone', 'event:standIn', 'save:phone']) assert.ok(kinds.has(k), `logs ${k}`);
  assert.ok(log.some((l) => l.type === 'event' && l.by.kind === 'bot' && l.command), 'a bot\'s moves, with its command');

  // Hosted again: the load is logged, the old entries aren't again, and the player taking the seat back is a handover.
  const before = room.game!.log.length;
  const again = new Room('GLOB', { dir, file: room.file, awayMs: 1 });
  const loaded = lines(again).filter((l) => l.type === 'load');
  assert.equal(loaded.at(-1).entries, before);
  await sleep(5); // not while Ada could still be on the way back
  again.join('Ada', 'player', 'phone');
  assert.equal(lines(again).at(-1).type, 'handover');
  again.close();
});

test('an old save with no game log still hosts and plays; only what happens from now on is timed', () => {
  const file = join(dir, 'old.json');
  const g = newGame(2, 9, 0);
  save(file, g);
  assert.ok(!existsSync(gameLogFile(file)));
  const room = new Room('GOLD', { dir, file });
  const [a, b] = [room.join('Ada'), room.join('Bram')];
  assert.ok(a.token && b.token);
  const p = waitingOn(room.game!)[0];
  const cmd = candidateCommands(room.game!, p, { state: 1 })[0];
  room.command([a, b][p].token, cmd);
  const log = lines(room);
  assert.equal(log[0].type, 'load');
  assert.equal(log[0].entries, g.log.length);
  const events = log.filter((l) => l.type === 'event');
  assert.ok(events.length && events.every((l) => l.i >= g.log.length), 'the old entries stay untimed');
  assert.equal(events[0].by.kind, 'player', 'a client that doesn\'t say what it is is a player');
  room.close();
});

test('a game log from when commands were text still opens, and the game goes on in it', () => {
  const file = join(dir, 'text.json');
  const g = newGame(2, 9, 0);
  save(file, g);
  const by = { kind: 'phone', seat: 0, name: 'Ada' };
  const old = [
    ...g.log.map((e, i) => ({ t: '2026-01-01T00:00:00.000Z', ms: 1767225600000, type: 'event', by, i, round: e.round, text: e.text, ev: e.ev, command: 'end' })),
    { t: '2026-01-01T00:00:00.000Z', ms: 1767225600000, type: 'refused', by, command: 'vote 1', error: "It's P2's turn." },
  ];
  writeFileSync(gameLogFile(file), old.map((l) => `${JSON.stringify(l)}\n`).join(''));
  const room = new Room('GTXT', { dir, file });
  const seats = [room.join('Ada'), room.join('Bram')];
  const p = waitingOn(room.game!)[0];
  room.command(seats[p].token, { do: 'keep', card: room.game!.players[p].choice[0].id });
  const log = lines(room);
  assert.deepEqual(log.slice(0, old.length).map((l) => l.command), old.map((l) => l.command), 'the old lines are as they were');
  assert.deepEqual(log.at(-1).command.do, 'keep');
  room.close();
});

// A round in which no one makes anything: the shortest scene there is.
const scene = (room: Room) => room.mutate((g) => void g.log.push({ round: g.round, text: 'A round', ev: { k: 'round', n: g.round } } as any));
const released = async (...rooms: Room[]) => {
  for (let n = 0; n < 500 && !rooms.every((r) => lines(r).some((l) => l.type === 'release')); n++) await sleep(20);
};
const ofScenes = (room: Room) => lines(room).filter((l) => /^(hold|release|scene)/.test(l.type));

test('scenes: when the phones are held and released, with a TV or with none', async () => {
  const made = (code: string, remote: boolean) => {
    const room = new Room(code, { dir, remote, botDelayMs: 60000 });
    const seats = [room.join('Ada', 'player', 'phone'), room.join('Bram', 'player', 'phone')];
    room.start(seats[0].token, 3);
    return { room, seats };
  };
  const tv = made('GSTV', false), none = made('GSNO', true), unwatched = made('GSUN', false);
  tv.room.connect(null, true);
  none.room.connect(none.seats[0].token);
  const from = (tv.room.game!.log).length;
  for (const r of [tv.room, none.room, unwatched.room]) scene(r);
  scene(tv.room); // during the first
  assert.equal(ofScenes(tv.room).at(-1).type, 'hold');
  await released(tv.room, none.room);
  const [a, b, c] = ofScenes(tv.room);
  assert.deepEqual([a, b, c].map((l) => [l.type, l.by.kind]), [['hold', 'game'], ['hold', 'game'], ['release', 'game']]);
  assert.deepEqual(a.scenes, [{ kind: 'roll', i: from, ms: 2200 }]);
  assert.equal(lines(tv.room).find((l) => l.type === 'event' && l.i === from).ev.k, 'round', 'i is the event the scene is for');
  assert.ok(b.until >= a.until + 2200, 'the second adds to the first');
  assert.deepEqual(c.scenes, [{ kind: 'roll', i: from }, { kind: 'roll', i: from + 1 }], 'one release for both');
  assert.ok(c.ms >= b.until && c.ms < b.until + 1500, 'at the time the hold said');
  assert.deepEqual(ofScenes(none.room).map((l) => l.type), ['hold', 'release'], 'no TV: the phones are still held');
  assert.deepEqual(ofScenes(unwatched.room), [], 'no one watching: no one held');
  for (const r of [tv.room, none.room, unwatched.room]) r.close();
});

test('scenes: when the TV starts and ends each, and one that reloads in the middle of one', async (t) => {
  const { server, rooms } = startServer(0, { dir: join(dir, 'tv'), botDelayMs: 60000 }, [], '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  const sent: Promise<Response>[] = [];
  t.mock.method(globalThis, 'fetch', (path: string, init?: RequestInit) => {
    const r = real(base + path, init);
    sent.push(r);
    return r;
  });
  const said = () => Promise.all(sent);
  const streams: AbortController[] = [];
  try {
    const code = ((await (await fetch('/api/rooms', { method: 'POST', body: '{}' })).json()) as any).code;
    const room = rooms.get(code)!;
    const ada = room.join('Ada', 'player', 'phone');
    room.join('Bram', 'player', 'phone');
    room.start(ada.token, 3);
    const open = async (log: SceneLog) => {
      const stop = new AbortController();
      streams.push(stop);
      await (await real(`${base}/api/rooms/${code}/events?tv=${log.page}`, { signal: stop.signal })).body!.getReader().read();
      return stop;
    };
    const first = new SceneLog();
    const stream = await open(first);
    const at = room.game!.log.findIndex((e) => (e.ev as any)?.k === 'round');
    first.start(code, at);
    await said();
    first.end();
    first.end(); // told once
    await said();
    first.start(code, at);
    await said();
    stream.abort(); // reloaded
    for (let n = 0; n < 200 && !lines(room).some((l) => l.type === 'disconnect'); n++) await sleep(10);
    const second = new SceneLog();
    await open(second);
    second.start(code, at);
    await said();
    second.end(true);
    await said();
    const log = lines(room).filter((l) => l.by.kind === 'tv');
    const scene = { kind: 'roll', i: at };
    const is = (type: string, tv: SceneLog, more = {}) => ({ type, tv: tv.page, ...more });
    assert.deepEqual(log.map(({ t: _t, ms: _ms, by: _by, what: _what, ...l }) => l), [
      is('connect', first),
      is('sceneStart', first, scene),
      is('sceneEnd', first, scene),
      is('sceneStart', first, scene),
      is('disconnect', first),
      is('connect', second),
      is('sceneStart', second, scene),
      is('sceneEnd', second, { ...scene, cut: true }),
    ]);
    const count = lines(room).length;
    for (const i of [0, 99999, -1, 'x']) assert.equal((await fetch(`/api/rooms/${code}/scene`, { method: 'POST', body: JSON.stringify({ i }) })).status, 400, `${i} is no scene`);
    assert.equal(lines(room).length, count, 'and nothing is logged');
  } finally {
    for (const s of streams) s.abort();
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});
