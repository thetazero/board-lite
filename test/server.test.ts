import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import { candidateCommands, endingTarget, playToEnd } from '../src/bot.ts';
import { apply, newGame, waitingOn } from '../src/engine.ts';
import { Room, RoomError, addClaudeRunner, claudeRunners } from '../src/host.ts';
import { load, save } from '../src/store.ts';
import { startServer } from '../src/host.ts';
import type { Rulebook, Snapshot } from '../src/state.ts';
import { ACTIONS, BEASTS, BUILDINGS, DRAGONS, FAUNA, TARGETS, TUNING, UPGRADES } from '../src/data.ts';
import { POINTS_TO_WIN } from '../web/common.ts';
import { scenesMs, scenesOf } from '../web/scenes.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'board-lite-test-')); // a few small game files
after(() => rmSync(dir, { recursive: true, force: true }));
const run = promisify(execFile);
const cli = (...args: string[]) => run(process.execPath, ['src/cli.ts', ...args]).then((r) => r.stdout, (e) => `${e.stdout}${e.stderr}`);

test('phones can play a whole game through a room, and see only their own hand', async () => {
  const room = new Room('TEST', { dir });
  const seats = ['Ada', 'Bram', 'Cora'].map((n) => room.join(n));
  assert.throws(() => room.start(seats[1].token), RoomError, 'only the first player or the TV starts');
  room.start(seats[0].token, 11);
  const g = room.game!;
  const rng = { state: 5 };
  let steps = 0;
  // playToEnd: bot play can stall short of the win target; this ends it whatever the tuning.
  playToEnd(g, () => {
    steps++;
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
  });
  assert.equal(g.phase, 'over');
  assert.equal(load(room.file).phase, 'over', 'the game is saved as it goes');
  const end = room.snapshot(seats[0].token);
  assert.equal(end.game!.winner, g.winner);
  assert.equal(end.game!.finalTotals!.length, 3);
  assert.equal(end.scene, 0, 'with no TV watching, nothing is held for scenes');
  room.close();
});

test('while a TV watches, its scene holds the next decision until it ends', async () => {
  const room = new Room('SCEN', { dir });
  const seats = ['Ada', 'Bram'].map((n) => room.join(n));
  const tvGone = room.connect(null);
  room.start(room.hostToken, 7);
  const g = room.game!;
  const rng = { state: 3 };
  while (g.round === 1) {
    const p = waitingOn(g)[0];
    for (const cmd of candidateCommands(g, p, rng)) {
      try {
        room.command(seats[p].token, cmd);
        break;
      } catch (e) {
        if (!(e instanceof RoomError)) throw e;
      }
    }
  }
  // Round 1's raid: every dragon is an egg, so no one could raid: no scene for it.
  const r1 = g.log.filter((e) => e.round === 1 && !e.to);
  assert.ok(r1.some((e) => e.ev?.k === 'noRaid' && e.ev.why === 'unable'));
  assert.deepEqual(scenesOf(r1).map((s) => s.kind), ['roll', 'tend'], 'only the opening roll, and the eggs growing');
  // Round 2 has begun, and its production is on the TV: the phones wait for it.
  const left = room.snapshot(seats[0].token).scene;
  assert.ok(left > 0 && left < 20000, `production takes ${left} ms`);
  const t0 = Date.now();
  const p = waitingOn(g)[0];
  const r = await room.wait(seats[p].token, left + 5000);
  assert.equal(r.code, 0);
  assert.ok(Date.now() - t0 >= left - 50, 'wait returns only once the scene is over');
  assert.equal(room.snapshot(seats[p].token).scene, 0);
  tvGone();
  room.close();
});

test("with no TV, the opening round's production is held for a phone's table view (#449)", () => {
  const room = new Room('OPEN', { dir, remote: true });
  const seats = ['Ada', 'Bram'].map((n) => room.join(n));
  const phoneGone = room.connect(seats[0].token); // the phone; its table view opens only once the game starts
  room.start(seats[0].token, 7);
  const left = room.snapshot(seats[0].token).scene;
  const opening = scenesMs(scenesOf(room.game!.log.filter((e) => !e.to)));
  assert.ok(left > 0 && Math.abs(left - opening) < 1000, `the server holds the table for the opening scenes: ${left} of ${opening} ms`);
  phoneGone();
  room.close();
  // With nobody's phone there (a CLI or Claude table), nothing waits.
  const cli = new Room('NOPH', { dir, remote: true });
  const s2 = ['Ada', 'Bram'].map((n) => cli.join(n));
  cli.start(s2[0].token, 7);
  assert.equal(cli.snapshot(s2[0].token).scene, 0);
  cli.close();
});

// No clock here: the test follows the room move by move, so a slow machine only
// makes it slower. It fails when a bot throws, or when the bots keep moving
// without the game ever ending. The timeout only catches a room that goes
// silent, which would otherwise hang the run.
test('a room of bots plays itself to the end', { timeout: 120_000 }, async (t) => {
  const room = new Room('BOTS', { botDelayMs: 0, dir });
  room.addBot();
  room.addBot();
  const maxMoves = 100_000; // a 3-bot game takes well under this
  let moves = 0;
  // Bot play can stall short of the win target: as playToEnd does, it drops to
  // the leader's points late in the game, so this ends whatever the tuning.
  const target = TUNING.pointsToWin;
  t.after(() => (TUNING.pointsToWin = target));
  const ended = new Promise<void>((resolve, reject) => {
    t.mock.method(console, 'error', (...args: unknown[]) => reject(new Error(args.map(String).join(' '))));
    room.subscribe(() => {
      if (room.game) TUNING.pointsToWin = endingTarget(room.game, target);
      if (room.game?.phase === 'over') resolve();
      else if (++moves > maxMoves) reject(new Error(`the game was not over after ${maxMoves} moves`));
    });
  });
  room.start(room.hostToken, 3);
  try {
    await ended;
  } finally {
    room.close();
  }
  assert.equal(room.game!.phase, 'over');
});

test("the lobby and the join form name the game's real goal", () => {
  assert.equal(POINTS_TO_WIN, TUNING.pointsToWin, 'web/common.ts POINTS_TO_WIN must match TUNING.pointsToWin');
});

test('lobby rules: names, size, joining late', () => {
  const room = new Room('LOBY', { dir });
  room.join('Ada');
  assert.throws(() => room.join('ada'), /already called/);
  assert.throws(() => room.join('   '), /Choose a name/);
  assert.throws(() => room.join('\u200B\u200B\u200B'), /Choose a name/, 'zero-width spaces are no name');
  assert.throws(() => room.join('\u3164\u2800\u200D'), /Choose a name/, 'nor are blank fillers');
  assert.equal(room.join('Bo\u200Bb').name, 'Bob', 'an invisible character inside a name is dropped');
  room.leave(1);
  assert.throws(() => room.start(room.hostToken), /at least 2/);
  for (let i = 0; i < 5; i++) room.addBot();
  assert.throws(() => room.join('Late'), /full/);
  room.leave(5);
  room.start(room.hostToken);
  assert.throws(() => room.join('Late'), /has started/);
  assert.equal(room.game!.players.length, 5);
  room.close();
});

// Seats count as here while they hold a stream or asked something in the last minute.
const goQuiet = (room: Room, i: number) => Object.assign(room.seats[i], { connected: 0, seen: 0 });

test('a player who quits: a bot makes as few moves as it can, and the seat can be taken back by name', async () => {
  const room = new Room('QUIT', { dir, botDelayMs: 0 });
  const [ada, bram, cora] = ['Ada', 'Bram', 'Cora'].map((n) => room.join(n));
  room.start(ada.token, 7);
  const g = room.game!;
  const stock = () => JSON.stringify(g.players[1].resources);
  const quitter = bram.token;
  room.quit(quitter);
  assert.ok(room.seats[1].left && room.seats[1].standIn);
  assert.throws(() => room.command(quitter, { do: 'end' }), /not in this game/, 'the phone that quit no longer holds the seat');
  assert.equal(room.lobby().seats[1].connected, false);
  // The table plays on; the bot answers for Bram at once.
  for (let i = 0; i < 300 && g.round < 3; i++) {
    const p = waitingOn(g).find((q) => q !== 1);
    if (p !== undefined) {
      const [seat] = [ada, bram, cora].filter((_, k) => k === p);
      for (const cmd of candidateCommands(g, p, { state: i }).filter((c) => c.do !== 'accept')) {
        try {
          room.command(seat.token, cmd);
          break;
        } catch (e) {
          if (!(e instanceof RoomError)) throw e;
        }
      }
    }
    await sleep(1);
  }
  assert.ok(g.round >= 3, 'the game did not stall on the seat that quit');
  assert.equal(Object.keys(g.buildings).filter((k) => g.buildings[k].owner === 1).length, 1, 'the stand-in builds nothing (only the tower)');
  assert.notEqual(stock(), '{}');
  // Anyone (Bram on another phone) takes the seat back with its name.
  assert.throws(() => room.join('Ada'), /playing on another phone/, "a seat someone is at can't be taken");
  const back = room.join(' bram ');
  assert.equal(back, room.seats[1]);
  assert.ok(!back.left && !back.standIn);
  room.command(back.token, { do: 'say', message: 'hello' });
  room.close();
});

test('a player who is away: the table lets a bot play for them, and their phone coming back hands the seat back', async () => {
  const room = new Room('AWAY', { dir, botDelayMs: 60_000 });
  const [ada, bram] = ['Ada', 'Bram'].map((n) => room.join(n));
  assert.throws(() => room.standInFor(ada.token, 1), /not running/);
  room.start(ada.token, 7);
  assert.throws(() => room.standInFor(ada.token, 1), /is back/, "only for someone who isn't here");
  goQuiet(room, 1);
  assert.throws(() => room.standInFor('nobody', 1), /not in this game/);
  room.standInFor(ada.token, 1);
  assert.ok(room.seats[1].standIn && !room.seats[1].left);
  assert.equal(room.lobby().seats[1].standIn, true);
  // The game hasn't moved on (the bot's timer is long here); Bram's phone reconnects.
  const disconnect = room.connect(bram.token);
  assert.ok(!room.seats[1].standIn, 'back in their own hands');
  disconnect();
  // A CLI or Claude player coming back by asking anything counts too.
  goQuiet(room, 1);
  room.standInFor(ada.token, 1);
  room.state(bram.token);
  assert.ok(!room.seats[1].standIn);
  // And one waiting on the table (a long "wait" or "listen") is at their seat all along.
  room.command(bram.token, { do: 'keep', card: room.game!.players[1].choice[0].id });
  const waiting = room.wait(bram.token, 20);
  room.seats[1].seen = 0; // a minute later, still waiting
  assert.throws(() => room.standInFor(ada.token, 1), /is back/);
  await waiting;
  assert.equal(room.seats[1].connected, 0);
  room.close();
});

// A started room with everyone here, and the game waiting on `turn`.
function table(code: string, opts: object = {}, names = ['Ada', 'Bram', 'Cora']) {
  const room = new Room(code, { dir, botDelayMs: 60_000, ...opts });
  const seats = names.map((n) => room.join(n));
  room.start(seats[0].token, 7);
  for (const s of seats) room.connect(s.token);
  return { room, seats };
}
const deciders = (room: Room, p: number) => room.lobby().seats[p].deciders ?? [];

test('a seat whose phone is gone is open: the first player decides, or someone new joins it', () => {
  const { room, seats: [ada, bram, cora] } = table('OPNA');
  assert.throws(() => room.join('Zed'), /every seat is taken/);
  goQuiet(room, 1);
  assert.deepEqual(deciders(room, 1), [0]);
  assert.throws(() => room.standInFor(cora.token, 1), /Only Ada can do that/);
  room.standInFor(ada.token, 1);
  assert.throws(() => room.join('Zed'), /every seat is taken/, "a seat a bot plays is kept for its player");
  room.state(bram.token);
  assert.ok(!room.seats[1].standIn);
  goQuiet(room, 1);
  const old = bram.token;
  assert.equal(room.join('Zed'), room.seats[1]);
  assert.equal(room.seats[1].name, 'Zed');
  assert.throws(() => room.state(old), /not in this game/);
  room.command(room.seats[1].token, { do: 'say', message: 'hello' });
  room.close();
});

test('when the first player is the one who left, the next player here decides', () => {
  const { room, seats: [ada, bram, cora] } = table('OPNB');
  goQuiet(room, 0);
  assert.deepEqual(deciders(room, 0), [1]);
  assert.throws(() => room.standInFor(cora.token, 0), /Only Bram/);
  room.standInFor(bram.token, 0);
  assert.ok(ada.standIn);
  room.close();
});

test('when the first player does not decide about a seat whose phone is gone, in time anyone does', async () => {
  const { room, seats: [, , cora] } = table('OPNC', { openMs: 50 });
  goQuiet(room, 1);
  room.changed();
  assert.ok(await until(() => deciders(room, 1).length === 2, 2000));
  room.standInFor(cora.token, 1);
  room.close();
});

test('a seat whose phone is here is opened only by the first player, after a wait, and taken back only by a tap', async () => {
  const { room, seats: [ada, bram, cora] } = table('OPND', { openMs: 300 });
  assert.throws(() => room.open(ada.token, 1), /Bram is playing/);
  assert.ok(await until(() => deciders(room, 1).length > 0, 3000));
  assert.deepEqual(deciders(room, 1), [0]);
  assert.deepEqual(deciders(room, 0), [1], 'never themselves');
  assert.ok(!room.seats[1].opened, 'never on its own');
  assert.throws(() => room.open(cora.token, 1), /Only Ada/);
  room.command(bram.token, { do: 'say', message: 'wait' });
  assert.throws(() => room.open(ada.token, 1), /Bram is playing/, 'a word from Bram starts the wait over');
  assert.ok(await until(() => deciders(room, 1).length > 0, 3000));
  room.open(ada.token, 1);
  room.standInFor(ada.token, 1);
  room.state(bram.token);
  room.connect(bram.token);
  assert.ok(room.seats[1].opened && room.seats[1].standIn, 'the phone answering is no one back');
  room.back(bram.token);
  assert.ok(!room.seats[1].opened && !room.seats[1].standIn);
  assert.ok(await until(() => deciders(room, 1).length > 0, 3000));
  room.open(ada.token, 1);
  room.command(bram.token, { do: 'say', message: 'here' });
  assert.ok(!room.seats[1].opened, 'so does a move');
  assert.ok(await until(() => deciders(room, 1).length > 0, 3000));
  room.open(ada.token, 1);
  room.close();
  const again = new Room('OPND', { dir, file: room.file, botDelayMs: 60_000 });
  assert.ok(again.seats[1].opened, 'kept over a restart');
  again.join('Zed');
  assert.ok(again.seats[1].name === 'Zed' && !again.seats[1].opened);
  again.close();
});

test('the stand-in keeps the game moving to the end without spending anything', async () => {
  const room = new Room('STND', { dir, botDelayMs: 0 });
  const seats = ['Ada', 'Bram'].map((n) => room.join(n));
  room.start(seats[0].token, 5);
  const g = room.game!;
  const dragons = g.dragons.length; // each player starts with one
  room.quit(seats[0].token);
  room.seats[1].standIn = true; // away, with a bot playing for them (quitting too would end the game)
  room.changed();
  for (let i = 0; i < 2000 && g.round < 6; i++) await sleep(1);
  room.close();
  assert.ok(g.round >= 6, `stuck in round ${g.round}, phase ${g.phase} ${g.raid?.step ?? ''}`);
  assert.equal(Object.keys(g.buildings).length, 2, 'only the towers');
  assert.equal(g.dragons.length, dragons, 'no eggs hatched');
});

test("a phone that closes on its turn: once it counts as away, the others hear so and can let a bot play", async () => {
  const room = new Room('SHUT', { dir, botDelayMs: 0, awayMs: 50 });
  const [ada, bram] = ['Ada', 'Bram'].map((n) => room.join(n));
  room.start(ada.token, 3);
  const g = room.game!;
  const turn = room.seats[g.turn ?? 0] === ada ? ada : bram;
  const other = turn === ada ? bram : ada;
  const close = room.connect(turn.token);
  room.connect(other.token);
  let updates = 0;
  room.subscribe(() => updates++);
  close(); // the acting player's tab closes; nothing else happens at the table
  assert.ok(room.lobby().seats[room.seats.indexOf(turn)].connected, 'here for a moment, in case the phone is back');
  const before = updates;
  for (let i = 0; i < 200 && room.here(turn); i++) await sleep(5);
  await sleep(30);
  assert.ok(updates > before, 'the table hears when they count as away');
  assert.equal(room.lobby().seats[room.seats.indexOf(turn)].connected, false);
  room.standInFor(other.token, room.seats.indexOf(turn));
  room.close();
});

// Three ways a phone drops, each away after about `awayMs`: not at once, and not much later (#520).
const until = async (done: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await sleep(5);
  return done();
};

test('a phone that loses Wi-Fi with its stream still open is away once it stops answering pings', async () => {
  const { server, rooms } = startServer(0, { dir, botDelayMs: 60_000, awayMs: 400 }, [], '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => (await (await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })).json()) as Record<string, string>;
  const ctrl = new AbortController();
  try {
    const { code } = await post('/api/rooms', {});
    const ada = (await post(`/api/rooms/${code}/join`, { name: 'Ada' })).token;
    const bram = (await post(`/api/rooms/${code}/join`, { name: 'Bram' })).token;
    await post(`/api/rooms/${code}/start`, { token: ada });
    const room = rooms.get(code)!;
    await fetch(`${base}/api/rooms/${code}/events?token=${bram}&answers`, { signal: ctrl.signal });
    assert.ok(room.here(room.seats[1]), 'not at once');
    // The table plays on: being sent it doesn't make Bram here.
    const end = Date.now() + 2000;
    while (room.here(room.seats[1]) && Date.now() < end) {
      room.command(ada, { do: 'say', message: 'hello' });
      await sleep(20);
    }
    assert.equal(room.seats[1].connected, 1, 'the stream never closed');
    assert.ok(!room.here(room.seats[1]), 'away all the same');
    room.standInFor(ada, 1);
    // Back on Wi-Fi, the page answers on the same stream, and gets its seat back.
    assert.deepEqual(await post(`/api/rooms/${code}/here`, { token: bram }), {});
    assert.ok(room.here(room.seats[1]) && !room.seats[1].standIn);
    // Answering, it stays, and the table isn't told anything new.
    const version = room.snapshot(null).v;
    for (let i = 0; i < 16; i++) {
      await sleep(50);
      await post(`/api/rooms/${code}/here`, { token: bram });
      assert.ok(room.here(room.seats[1]));
    }
    assert.ok(room.snapshot(null).v! <= version! + 1, 'at most Ada going quiet');
    // Its stream ending long after the phone went doesn't bring it back.
    assert.ok(await until(() => !room.here(room.seats[1]), 2000));
    ctrl.abort();
    assert.ok(await until(() => room.seats[1].connected === 0, 2000));
    assert.ok(!room.here(room.seats[1]));
  } finally {
    ctrl.abort();
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test('a phone that reloads in a quiet game keeps its seat for a moment', async () => {
  for (const answers of [false, true]) {
    const room = new Room(answers ? 'RELA' : 'RELO', { dir, botDelayMs: 60_000, awayMs: 400 });
    const [ada, bram] = ['Ada', 'Bram'].map((n) => room.join(n));
    room.start(ada.token, 7);
    const close = room.connect(bram.token, false, answers);
    if (answers) {
      await sleep(250); // it answered its last ping a while ago
      room.state(bram.token);
    } else await sleep(500); // nothing for longer than it takes to be away
    close();
    assert.ok(room.here(bram));
    assert.throws(() => room.join('Bram'), /playing on another phone/);
    assert.throws(() => room.standInFor(ada.token, 1), /is back/);
    assert.ok(await until(() => !room.here(bram), 2000), 'then away');
    room.close();
  }
});

test('after a server restart, no seat can be taken until its player has had time to reconnect', async () => {
  const roomsDir = mkdtempSync(join(dir, 'minute-'));
  const opts = { dir: roomsDir, botDelayMs: 60_000, awayMs: 500 };
  const first = new Room('MINU', opts);
  const [ada, bram] = ['Ada', 'Bram'].map((n) => first.join(n));
  first.start(ada.token, 7);
  const tokens = [ada.token, bram.token];
  first.close();
  const room = new Room('MINU', opts);
  assert.throws(() => room.join('Bram'), /playing on another phone/);
  assert.throws(() => room.standInFor(tokens[0], 1), /is back/);
  let updates = 0;
  room.subscribe(() => updates++);
  assert.ok(await until(() => !room.here(room.seats[1]), 2000), 'away after that');
  assert.ok(await until(() => updates > 0, 1000), 'and the table hears so');
  room.standInFor(tokens[0], 1);
  room.close();
});

test('a game every player quits ends: the bots stop, nothing is saved again, and the server forgets the room', async () => {
  const room = new Room('GONE', { dir, botDelayMs: 0 });
  const seats = ['Ada', 'Bram'].map((n) => room.join(n));
  room.addBot();
  room.start(seats[0].token, 5);
  const g = room.game!;
  room.quit(seats[0].token);
  assert.ok(!room.abandoned, 'Bram is still playing');
  room.quit(seats[1].token);
  assert.ok(room.abandoned);
  const active = room.lastActive;
  const mtime = statSync(room.file).mtimeMs;
  const log = g.log.length;
  await sleep(50);
  assert.equal(g.log.length, log, 'no bot moves');
  assert.equal(statSync(room.file).mtimeMs, mtime, 'no saves');
  assert.equal(room.lastActive, active, 'idle, so the server forgets it');
  room.join('Ada'); // until then, a player can come back
  assert.ok(!room.abandoned);
  for (let i = 0; i < 200 && g.log.length === log; i++) await sleep(1);
  assert.ok(g.log.length > log, 'the bots play again');
  room.close();
});

test('the HTTP server: rooms, joining, live snapshots, commands and the clients', async () => {
  const { server, rooms } = startServer(0, { dir, firstSeat: 0 });
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
    Object.assign(rooms.get(made.code)!.seats[1], { kind: 'player', connected: 1 }); // a person at their phone, not a bot: keep the game still while we look at it
    rooms.get(made.code)!.changed();

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

    const bad = await post(`/api/rooms/${made.code}/do`, { token: ada, command: { do: 'build', card: 'c999', hex: '0,0' } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /keep 1 of your 2 building cards/); // the round opens with picking a card
    const old = await post(`/api/rooms/${made.code}/do`, { token: ada, command: 'end', via: 'cli' });
    assert.equal(old.status, 400);
    assert.match(old.body.error, /JSON/, 'text is no command');
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: made.hostToken, command: { do: 'end' } })).status, 400, 'the TV has no seat');
    const oldPage = await post(`/api/rooms/${made.code}/do`, { token: ada, command: 'end', via: 'phone' });
    assert.equal(oldPage.body.error, 'This page is out of date: reload it.', 'a phone page from when commands were text');
    // The round opens with everyone keeping one of two building cards.
    assert.equal(snap.you!.choice.length, 2);
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: ada, command: { do: 'keep', card: snap.you!.choice[0].id } })).status, 200);
    const g = rooms.get(made.code)!.game!;
    apply(g, 1, { do: 'keep', card: g.players[1].choice[0].id });
    rooms.get(made.code)!.changed();
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: ada, command: { do: 'end' } })).status, 200);
    // Mid-game: a bot for someone away (not someone at their phone), and quitting.
    assert.match((await post(`/api/rooms/${made.code}/standin`, { token: ada, seat: 1 })).body.error, /is back/);
    assert.equal((await post(`/api/rooms/${made.code}/quit`, { token: ada })).status, 200);
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: ada, command: { do: 'say', message: 'hi' } })).status, 400, 'the seat is no longer theirs');
    assert.equal((await post(`/api/rooms/${made.code}/join`, { name: 'ADA' })).status, 200, 'taken back by name');

    // A game with no TV: a phone makes the room, and its first player adds bots and starts.
    assert.equal(rooms.get(made.code)!.lobby().remote, false, 'a TV-made room has a TV');
    const solo = (await post('/api/rooms', { remote: true })).body.code;
    assert.equal(rooms.get(solo)!.lobby().remote, true);
    const me = (await post(`/api/rooms/${solo}/join`, { name: 'Ada' })).body.token;
    assert.equal((await post(`/api/rooms/${solo}/bot`, { token: me })).status, 200);
    assert.equal((await post(`/api/rooms/${solo}/start`, { token: me })).status, 200);
    assert.ok(rooms.get(solo)!.game, 'one phone and a bot is a game');
    // The table view a phone shows is the TV page as a watcher: three.js is loaded on demand
    // (behind the table, for the fights' figures), never as part of the page.
    assert.match(await (await fetch(`${base}/tv.ts`)).text(), /await import\('\.\/board3d\.ts'\)/);

    // Both pages have an icon, so no browser logs a missing favicon.
    for (const path of ['/favicon.svg', '/favicon.ico']) {
      const icon = await fetch(`${base}${path}`);
      assert.equal(icon.status, 200, path);
      assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
      await icon.text();
    }
    for (const path of ['/', '/tv']) assert.match(await (await fetch(`${base}${path}`)).text(), /rel="icon" href="\/favicon.svg"/, path);

    // The clients are served with their TypeScript types stripped.
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /phone\.ts/);
    const js = await fetch(`${base}/common.ts`);
    assert.match(js.headers.get('content-type')!, /javascript/);
    assert.doesNotMatch(await js.text(), /import type|: string\)/);
    assert.equal((await fetch(`${base}/tsconfig.json`)).status, 404);
    // A script the browser already has comes back as a 304 (the phone's table view reuses the phone's).
    const tag = (await fetch(`${base}/common.ts`)).headers.get('etag')!;
    assert.equal((await fetch(`${base}/common.ts`, { headers: { 'if-none-match': tag } })).status, 304);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  } finally {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test('a TV can come and go at any time: opening one gives the table a TV, and it goes on without one once the TV is gone', async () => {
  const room = new Room('TVTV', { dir, remote: true, tvGoneMs: 30, botDelayMs: 60000 });
  const seats = ['Ada', 'Bram'].map((n) => room.join(n));
  assert.equal(room.lobby().remote, true, 'made with no TV');
  const table = room.connect(null); // a phone's table view is no TV
  assert.equal(room.lobby().remote, true);
  let tv = room.connect(null, true); // in the lobby
  assert.equal(room.lobby().remote, false);
  room.start(seats[0].token, 3);
  tv();
  tv = room.connect(null, true); // a reload: no switch in between
  await sleep(60);
  assert.equal(room.lobby().remote, false);
  tv();
  assert.equal(room.lobby().remote, false, 'a TV that just went may be reloading');
  await sleep(60);
  assert.equal(room.lobby().remote, true, 'mid-game, the table goes on with no TV');
  assert.equal(JSON.parse(readFileSync(room.file.replace(/\.json$/, '.seats.json'), 'utf8')).remote, true, 'saved, for a restart');
  const back = room.connect(null, true); // and back again, mid-game, the same seats
  assert.equal(room.lobby().remote, false);
  assert.equal(room.snapshot(seats[1].token).seat, 1);
  back();
  table();
  room.close();
});

test('a TV opened on a room with no TV watching becomes its TV, with its buttons', async () => {
  const { server, rooms } = startServer(0, { dir });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => (await (await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })).json()) as Record<string, string>;
  const ctrl = new AbortController();
  try {
    const { code } = await post('/api/rooms', { remote: true });
    const room = rooms.get(code)!;
    await post(`/api/rooms/${code}/join`, { name: 'Ada' });
    const { hostToken } = await post(`/api/rooms/${code}/tv`, {});
    assert.ok(room.canStart(hostToken), 'it can add bots and start');
    const es = await fetch(`${base}/api/rooms/${code}/events?tv`, { signal: ctrl.signal });
    await es.body!.getReader().read();
    assert.equal(room.lobby().remote, false, 'watching as a TV gives the table a TV');
    assert.deepEqual(await post(`/api/rooms/${code}/tv`, {}), {}, 'a second TV has no buttons');
  } finally {
    ctrl.abort();
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test('one game, any client: a CLI player and a bot at a server-hosted table', async () => {
  const { server, rooms } = startServer(0, { dir, botDelayMs: 0, firstSeat: 0 });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const opened = await cli('new', base);
    const url = /is open: (\S+)/.exec(opened)?.[1];
    assert.ok(url, opened);
    const room = rooms.get(url!.slice(-4))!;
    const joined = await cli('join', url!, 'Claude');
    const token = /token: (\w+)/.exec(joined)?.[1];
    assert.ok(token, joined);
    assert.match(await cli('bot', url!, token!), /P2 Tick \(bot\)/);
    assert.match(await cli('start', url!, token!), /started/);
    const view = await cli('view', url!, token!);
    assert.match(view, /You are P1/);
    assert.match(view, /Your options/);
    const keep = /"do":"keep","card":"<(c\d+)\|/.exec(view)?.[1];
    assert.ok(keep, view);
    assert.match(await cli('do', url!, token!, JSON.stringify({ do: 'keep', card: keep })), /You keep/);
    assert.match(await cli('wait', url!, token!, '--timeout', '20'), /your decision/); // the bot keeps one too
    assert.match(await cli('do', url!, token!, '{"do":"build","card":"c999","hex":"0,0"}'), /Not allowed: You have no card c999 in hand/);
    const ended = await cli('do', url!, token!, '{"do":"end"}');
    assert.match(ended, /P1 ends their turn/);
    // The bot plays its turn. Everyone's dragon is still an egg, so there is no
    // raid: wait returns at our next decision, the next round's cards.
    assert.match(await cli('wait', url!, token!, '--timeout', '20'), /your decision/);
    assert.equal(room.game!.round, 2);
    assert.equal(room.game!.phase, 'cards');
    assert.match(await cli('status', url!), /Room \w{4}: P1 Claude, P2 Tick \(bot\)/);
  } finally {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test('a saved game with no seats file can be hosted; players claim its open seats', () => {
  const file = join(dir, 'hosted.json');
  const g = newGame(3, 4, 0);
  for (const p of [0, 1, 2]) apply(g, p, { do: 'keep', card: g.players[p].choice[0].id });
  save(file, g);
  const room = new Room('HOST', { file, botDelayMs: 60000 });
  assert.deepEqual(room.seats.map((s) => s.kind), ['open', 'open', 'open']);
  assert.equal(room.lobby().seating, true, 'back in the lobby until every seat is taken');
  const ada = room.join('Ada');
  assert.equal(room.seats.indexOf(ada), 0);
  assert.throws(() => room.command(ada.token, { do: 'end' }), /once every seat is taken/, 'the game waits for the open seat');
  // Leaving, or removing someone, gives the seat back while the game waits.
  const bram = room.join('Bram');
  room.leave(room.seats.indexOf(bram));
  assert.deepEqual(room.seats.map((s) => s.kind), ['player', 'open', 'open']);
  // A bot can take an open seat; once every seat is taken, the game goes on.
  room.join('Bram');
  room.addBot();
  assert.equal(room.lobby().seating, false);
  room.command(ada.token, { do: 'end' });
  assert.equal(load(file).turn, 1, 'moves are saved to the same file');
  assert.throws(() => room.join('Cora'), /every seat is taken/);
  assert.throws(() => room.leave(2), /has started/);
  room.close();
});

test('a server restart: the room comes back under its own code, and every client to its own seat', async () => {
  const roomsDir = mkdtempSync(join(dir, 'restart-'));
  const serve = async (hostFiles: string[] = []) => {
    const s = startServer(0, { dir: roomsDir, botDelayMs: 60000, firstSeat: 0 }, hostFiles, '127.0.0.1', true);
    await new Promise((r) => s.server.once('listening', r));
    const base = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    const stop = () => {
      for (const r of s.rooms.values()) r.close();
      s.server.closeAllConnections();
      s.server.close();
    };
    const post = async (path: string, body: object) => (await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })).json() as Promise<Record<string, string>>;
    return { ...s, base, stop, post };
  };
  const first = await serve();
  const made = await first.post('/api/rooms', {});
  const ada = (await first.post(`/api/rooms/${made.code}/join`, { name: 'Ada' })).token;
  const bram = (await first.post(`/api/rooms/${made.code}/join`, { name: 'Bram' })).token;
  await first.post(`/api/rooms/${made.code}/bot`, { token: made.hostToken });
  await first.post(`/api/rooms/${made.code}/start`, { token: ada });
  const file = first.rooms.get(made.code)!.file;
  first.stop();

  for (const again of [await serve(), await serve([file])]) {
    try {
      assert.deepEqual([...again.rooms.keys()], [made.code], 'the same code, whether resumed or hosted with --game');
      const room = again.rooms.get(made.code)!;
      assert.deepEqual(room.seats.map((s) => [s.name, s.kind]), [['Ada', 'player'], ['Bram', 'player'], ['Tick', 'bot']]);
      // Bram's phone reconnects first and still gets his own seat; the TV is still the TV.
      const asBram = (await (await fetch(`${again.base}/api/rooms/${made.code}?token=${bram}`)).json()) as { seated: boolean };
      assert.ok(asBram.seated);
      assert.equal(room.snapshot(bram).seat, 1);
      assert.equal(room.snapshot(ada).seat, 0);
      assert.ok(room.canStart(made.hostToken));
      assert.equal(room.game!.round, 1);
    } finally {
      again.stop();
    }
  }
  // A room the server doesn't have: the clients stop retrying on a 400.
  const third = await serve();
  try {
    assert.equal((await fetch(`${third.base}/api/rooms/ZZZZ`)).status, 400);
  } finally {
    third.stop();
  }
});

test('a Claude seat server plays one seat of a room over MCP, and wakes when someone talks', async () => {
  const { server, rooms } = startServer(0, { dir, botDelayMs: 0, firstSeat: 0 }, [], '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => (await (await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })).json()) as Record<string, any>;
  try {
    const { code } = await post('/api/rooms', {});
    const ada = await post(`/api/rooms/${code}/join`, { name: 'Ada' }); // a phone
    const opus = await post(`/api/rooms/${code}/join`, { name: 'Opus' }); // Claude
    await post(`/api/rooms/${code}/start`, { token: ada.token });
    const g = rooms.get(code)!.game!;
    for (const [p, t] of [[0, ada.token], [1, opus.token]] as const) await post(`/api/rooms/${code}/do`, { token: t, command: { do: 'keep', card: g.players[p].choice[0].id } });
    const reqs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'view', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'say', arguments: { message: 'hello', to: 'P1' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'act', arguments: { do: 'end', card: null, why: 'nothing left to build' } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'wait', arguments: {} } },
    ];
    const moves = join(mkdtempSync(join(tmpdir(), 'board-lite-moves-')), 'moves.txt');
    const child = execFile(process.execPath, ['src/playtest/seat-server.ts', `${base}/${code}`, opus.token, moves], { env: { ...process.env, BOARD_LITE_WAIT_SECS: '20' } });
    const lines: any[] = [];
    let buf = '';
    child.stdout!.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(JSON.parse(buf.slice(0, i)));
    });
    const reply = async (id: number) => {
      for (let t = 0; t < 400; t++) {
        const r = lines.find((l) => l.id === id);
        if (r) return r;
        await sleep(25);
      }
      throw new Error(`no reply to ${id}`);
    };
    // One request at a time, as Claude makes them.
    for (const r of reqs.slice(0, 5)) {
      child.stdin!.write(`${JSON.stringify(r)}\n`);
      await reply(r.id);
    }
    assert.deepEqual((await reply(2)).result.tools.map((t: { name: string }) => t.name), ['view', 'act', 'say', 'wait', 'rules']);
    assert.match((await reply(3)).result.content[0].text, /^Table: P1 Ada, P2 Opus \(you\)\.\nYou are P2\./);
    // The view carries a picture of the board beside the text map (#384).
    const picture = (await reply(3)).result.content[1];
    assert.equal(picture.type, 'image');
    assert.equal(picture.mimeType, 'image/png');
    assert.equal(Buffer.from(picture.data, 'base64').subarray(1, 4).toString(), 'PNG');
    assert.match((await reply(4)).result.content[0].text, /P2 to P1 \(private\): "hello"/);
    assert.match((await reply(5)).result.content[0].text, /Not allowed/); // it's P1's turn, and the server only plays P2
    // The moves file pairs each move's private reason with what really happened.
    assert.match(readFileSync(moves, 'utf8'), /{"do":"tell","to":"P1","message":"hello"}\n  -> done\n.* {"do":"end"}\n  why: nothing left to build\n  -> not allowed: It's P1's turn/);
    rmSync(dirname(moves), { recursive: true });
    // Waiting returns as soon as the phone player talks.
    child.stdin!.write(`${JSON.stringify(reqs[5])}\n`);
    await sleep(200);
    assert.ok(!lines.some((l) => l.id === 6), 'wait blocks while nothing happens');
    await post(`/api/rooms/${code}/do`, { token: ada.token, command: { do: 'say', message: 'hi Opus, want to trade?' } });
    assert.match((await reply(6)).result.content[0].text, /P1 says: "hi Opus, want to trade\?"[\s\S]*Waiting for/);
    child.kill();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("the phone's rulebook holds every building, card, beast and kingdom", async () => {
  const { server } = startServer(0, { dir });
  await new Promise((r) => server.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rulebook`);
    const book = (await r.json()) as Rulebook;
    assert.deepEqual(book.buildings.map((b) => b.key).sort(), Object.keys(BUILDINGS).sort());
    assert.deepEqual(book.upgrades.map((u) => u.key), Object.keys(UPGRADES));
    assert.deepEqual(book.actions.map((a) => a.key), Object.keys(ACTIONS));
    assert.deepEqual(book.dragons.map((d) => d.key), Object.keys(DRAGONS));
    assert.deepEqual([...book.fauna, ...book.greatBeasts].map((f) => f.key), [...Object.keys(FAUNA), ...Object.keys(BEASTS)]);
    assert.deepEqual(book.kingdoms.map((k) => k.key), Object.keys(TARGETS));
  } finally {
    server.close();
  }
});

test('saving a game: it stops for everyone, survives a restart however old, and anyone at the table continues it', async () => {
  const roomsDir = mkdtempSync(join(dir, 'saved-'));
  const serve = async () => {
    const s = startServer(0, { dir: roomsDir, botDelayMs: 20, firstSeat: 0 }, [], '127.0.0.1', true);
    await new Promise((r) => s.server.once('listening', r));
    const base = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    const stop = () => {
      for (const r of s.rooms.values()) r.close();
      s.server.closeAllConnections();
      s.server.close();
    };
    const post = async (path: string, body: object) => {
      const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
      const v = (await r.json()) as Record<string, string>;
      if (!r.ok) throw new Error(v.error);
      return v;
    };
    return { ...s, base, stop, post };
  };
  const first = await serve();
  const made = await first.post('/api/rooms', {});
  const ada = (await first.post(`/api/rooms/${made.code}/join`, { name: 'Ada' })).token;
  const bram = (await first.post(`/api/rooms/${made.code}/join`, { name: 'Bram' })).token;
  await first.post(`/api/rooms/${made.code}/bot`, { token: made.hostToken });
  await assert.rejects(first.post(`/api/rooms/${made.code}/save`, { token: ada }), /isn't under way/);
  await first.post(`/api/rooms/${made.code}/start`, { token: ada });
  const room = first.rooms.get(made.code)!;
  // The bot's opening keep happens; then Ada saves.
  for (const p of [0, 1]) room.command([ada, bram][p], { do: 'keep', card: room.game!.players[p].choice[0].id });
  await sleep(100);
  await assert.rejects(first.post(`/api/rooms/${made.code}/save`, { token: 'nobody' }), /not in this game/);
  await first.post(`/api/rooms/${made.code}/save`, { token: ada });
  assert.ok(room.snapshot(bram).lobby.saved, 'every phone hears it');
  assert.throws(() => room.command(ada, { do: 'end' }), /saved: continue it first/);
  const log = room.game!.log.length;
  const waited = await room.wait(ada, 100);
  assert.equal(waited.code, 2, "a CLI or Claude player's wait doesn't wake on a saved game");
  assert.equal(room.game!.log.length, log, 'and no bot moves');
  const listed = (await (await fetch(`${first.base}/api/saved`)).json()) as { code: string; round: number; names: string[] }[];
  assert.deepEqual(listed.map((s) => [s.code, s.round, s.names]), [[made.code, 1, ['Ada', 'Bram', 'Tick']]]);
  const file = room.file;
  first.stop();

  // Long after the rooms' 6 hours, the server restarts: the saved game is still there.
  const long = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  for (const f of [file, file.replace(/\.json$/, '.seats.json')]) utimesSync(f, long, long);
  // A Claude runner that is gone by now (test/rust-server.test.ts brings back one that isn't).
  addClaudeRunner(file, '/somewhere/claude-run');
  assert.deepEqual(claudeRunners(file), ['/somewhere/claude-run']);
  const again = await serve();
  try {
    const back = again.rooms.get(made.code)!;
    assert.ok(back, 'hosted again after the restart');
    assert.ok(back.savedAt, 'still saved');
    await again.post(`/api/rooms/${made.code}/continue`, { token: bram });
    assert.equal(back.lobby().saved, null);
    await again.post(`/api/rooms/${made.code}/continue`, { token: bram }); // a second tap does nothing
    back.command(ada, { do: 'end' });
    assert.deepEqual((await (await fetch(`${again.base}/api/saved`)).json()), []);
  } finally {
    again.stop();
  }
});

test('a game left idle saves itself, over a restart too, and the table continues it the next day (#526)', async () => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const seatsOf = (file: string) => file.replace(/\.json$/, '.seats.json');
  const serve = async (roomsDir: string, idleMs?: number, site?: { origin: string }) => {
    const s = startServer(0, { dir: roomsDir, botDelayMs: 60_000, firstSeat: 0, idleMs }, [], '127.0.0.1', true, site);
    await new Promise((r) => s.server.once('listening', r));
    const base = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    const get = async (path: string) => (await fetch(base + path)).json() as Promise<any>;
    const post = async (path: string, body: object) => {
      const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) assert.fail(await r.text());
      return (await r.json()) as Record<string, string>;
    };
    const stop = () => {
      for (const r of s.rooms.values()) r.close();
      s.server.closeAllConnections();
      s.server.close();
    };
    return { ...s, get, post, stop };
  };
  const start = async (s: Awaited<ReturnType<typeof serve>>) => {
    const { code } = await s.post('/api/rooms', {});
    const tokens = [];
    for (const name of ['Ada', 'Bram']) tokens.push((await s.post(`/api/rooms/${code}/join`, { name })).token);
    await s.post(`/api/rooms/${code}/start`, { token: tokens[0] });
    return { code, tokens, file: s.rooms.get(code)!.file };
  };
  const age = (file: string, at: Date) => [file, seatsOf(file)].forEach((f) => utimesSync(f, at, at));
  const continues = async (s: Awaited<ReturnType<typeof serve>>, g: Awaited<ReturnType<typeof start>>) => {
    assert.ok((await s.get(`/api/rooms/${g.code}?token=${g.tokens[1]}`)), 'its address answers');
    const room = s.rooms.get(g.code)!;
    assert.ok(room.snapshot(g.tokens[0]).lobby.saved, 'its player sees it was saved');
    await s.post(`/api/rooms/${g.code}/continue`, { token: g.tokens[1] });
    assert.equal(room.lobby().saved, null);
    room.command(g.tokens[0], { do: 'keep', card: room.game!.players[0].choice[0].id });
  };

  // The server stays up, at home and as a website.
  for (const site of [undefined, { origin: 'https://dragons.example' }]) {
    const s = await serve(mkdtempSync(join(dir, 'idle-')), 400, site);
    try {
      const g = await start(s);
      s.server.tidy();
      assert.equal(s.rooms.get(g.code)!.lobby().saved, null, 'not while it is played');
      const last = s.rooms.get(g.code)!.lastActive;
      // A room still in its lobby, and a game every player quit, are forgotten.
      const lobby = await s.post('/api/rooms', {});
      const gone = await start(s);
      for (const t of gone.tokens) s.rooms.get(gone.code)!.quit(t);
      await sleep(500);
      s.server.tidy();
      assert.deepEqual(s.rooms.keys(), [g.code]);
      assert.equal(s.rooms.get(g.code)!.lobby().saved, last, 'saved as of when it stopped');
      if (!site) assert.deepEqual((await s.get('/api/saved')).map((x: any) => x.code), [g.code]);
      assert.ok(JSON.parse(readFileSync(seatsOf(g.file), 'utf8')).savedAt, 'on disk too');
      await continues(s, g);
      s.server.tidy();
      assert.equal(s.rooms.get(g.code)!.lobby().saved, null, 'continued, it is played again');
    } finally {
      s.stop();
    }
  }

  // The server stopped before the game was idle for long, and starts the next day.
  const roomsDir = mkdtempSync(join(dir, 'idle-'));
  const first = await serve(roomsDir);
  const g = await start(first);
  const ancient = await start(first), quit = await start(first), over = await start(first), recent = await start(first);
  for (const t of quit.tokens) first.rooms.get(quit.code)!.quit(t);
  first.rooms.get(over.code)!.mutate((x) => { x.phase = 'over'; });
  first.stop();
  for (const x of [g, quit, over]) age(x.file, dayAgo);
  age(ancient.file, new Date(Date.now() - 40 * 24 * 60 * 60 * 1000));
  const again = await serve(roomsDir);
  try {
    assert.deepEqual(again.rooms.keys().sort(), [g.code, recent.code].sort());
    assert.equal(again.rooms.get(recent.code)!.lobby().saved, null, 'one from just now goes on');
    assert.ok(Math.abs(again.rooms.get(g.code)!.lobby().saved! - dayAgo.getTime()) < 1000, 'saved as of when it stopped');
    await continues(again, g);
  } finally {
    again.stop();
  }
});
