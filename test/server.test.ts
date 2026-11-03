import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { candidateCommands } from '../src/bot.ts';
import { waitingOn } from '../src/engine.ts';
import { Room, RoomError } from '../src/server/room.ts';
import { startServer } from '../src/server/server.ts';
import type { Snapshot } from '../src/state.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('phones can play a whole game through a room, and see only their own hand', async () => {
  const room = new Room('TEST', { fleeSeconds: 0.02 });
  const seats = ['Ada', 'Bram', 'Cora'].map((n) => room.join(n));
  assert.throws(() => room.start(seats[1].token), RoomError, 'only the first player or the TV starts');
  room.start(seats[0].token, 11);
  const g = room.game!;
  const rng = { state: 5 };
  let steps = 0;
  let timedOutFlees = 0;
  while (g.phase !== 'over' && steps++ < 20000) {
    // Nobody ever answers the flee question: the room's clock must answer "stay".
    if (g.phase === 'raid' && g.raid!.step === 'flee') {
      const round = g.raid!.combatRound;
      await sleep(40);
      if (g.raid?.combatRound !== round || g.raid?.step !== 'flee') timedOutFlees++;
      continue;
    }
    const p = waitingOn(g)[0];
    for (const cmd of candidateCommands(g, p, rng)) {
      try {
        room.command(seats[p].token, cmd);
        break;
      } catch (e) {
        if (!(e instanceof RoomError)) throw e;
      }
    }
    // What each phone receives never includes anyone else's hand.
    if (steps % 25 === 0) {
      for (let me = 0; me < 3; me++) {
        const json = JSON.stringify(room.snapshot(seats[me].token));
        for (let q = 0; q < 3; q++) {
          if (q === me) continue;
          for (const c of g.players[q].hand) assert.ok(!json.includes(`"id":"${c.id}"`), `seat ${me} can see ${c.id} in seat ${q}'s hand`);
        }
        assert.ok(!json.includes('"resources"') || JSON.parse(json).you.seat === me);
      }
      const tv = JSON.stringify(room.snapshot(null));
      assert.ok(!tv.includes('"hand"') && !tv.includes('"resources"'), 'the TV sees no hands or resources');
    }
  }
  assert.equal(g.phase, 'over');
  const end = room.snapshot(seats[0].token);
  assert.equal(end.game!.winner, g.winner);
  assert.equal(end.game!.finalTotals!.length, 3);
  assert.ok(timedOutFlees > 0, 'some flee decisions were made by the clock');
  room.close();
});

test('a room of bots plays itself to the end', async () => {
  const room = new Room('BOTS', { botDelayMs: 0, fleeSeconds: 5 });
  room.addBot();
  room.addBot();
  room.start(room.hostToken, 3);
  for (let i = 0; i < 400 && room.game!.phase !== 'over'; i++) await sleep(10);
  assert.equal(room.game!.phase, 'over');
  room.close();
});

test('lobby rules: names, size, joining late', () => {
  const room = new Room('LOBY');
  room.join('Ada');
  assert.throws(() => room.join('ada'), /already called/);
  assert.throws(() => room.join('   '), /Pick a name/);
  assert.throws(() => room.start(room.hostToken), /at least 2/);
  for (let i = 0; i < 5; i++) room.addBot();
  assert.throws(() => room.join('Late'), /full/);
  room.leave(5);
  room.start(room.hostToken);
  assert.throws(() => room.join('Late'), /already started/);
  assert.equal(room.game!.players.length, 5);
  room.close();
});

test('the HTTP server: rooms, joining, live snapshots, commands and the clients', async () => {
  const { server, rooms } = startServer(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => {
    const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, string> };
  };
  try {
    const { body: made } = await post('/api/rooms', {});
    assert.match(made.code, /^[A-Z]{4}$/);
    const ada = (await post(`/api/rooms/${made.code}/join`, { name: 'Ada' })).body.token;
    await post(`/api/rooms/${made.code}/bot`, { token: made.hostToken });
    assert.equal((await post(`/api/rooms/${made.code.toLowerCase()}/join`, { name: 'Ada' })).status, 400, 'codes are case-insensitive; names unique');
    assert.equal((await post('/api/rooms/ZZZZ/join', { name: 'X' })).status, 400);
    assert.equal((await post(`/api/rooms/${made.code}/start`, { token: ada })).status, 200);
    rooms.get(made.code)!.seats[1].bot = false; // keep the game still while we look at it

    // Server-sent events: the first message is the current snapshot.
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/rooms/${made.code}/events?token=${ada}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    const snap = JSON.parse(text.slice(text.indexOf('data: ') + 6, text.indexOf('\n\n'))) as Snapshot;
    assert.equal(snap.seat, 0);
    assert.equal(snap.you!.name, 'Ada');
    assert.equal(snap.game!.round, 1);

    const bad = await post(`/api/rooms/${made.code}/do`, { token: ada, command: 'build c999 0,0' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /no card/);
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: made.hostToken, command: 'end' })).status, 400, 'the TV has no seat');
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: ada, command: 'end' })).status, 200);

    // The clients are served with their TypeScript types stripped.
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /phone\.ts/);
    const js = await fetch(`${base}/common.ts`);
    assert.match(js.headers.get('content-type')!, /javascript/);
    assert.doesNotMatch(await js.text(), /import type|: string\)/);
    assert.equal((await fetch(`${base}/tsconfig.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  } finally {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});
