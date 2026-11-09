import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { candidateCommands, playToEnd } from '../src/bot.ts';
import { newGame, waitingOn } from '../src/engine.ts';
import { gameLogFile } from '../src/server/gamelog.ts';
import { Room, RoomError } from '../src/server/room.ts';
import { save } from '../src/store.ts';

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
  assert.throws(() => room.command(seats[0].token, 'nonsense', 'phone'), RoomError);
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
  assert.ok(events.some((l) => l.by.kind === 'phone' && l.by.seat === 0 && l.command), 'a phone player\'s moves are theirs');
  assert.ok(events.some((l) => l.by.kind === 'cli' && l.by.name === 'Bram'), 'and a CLI player\'s');
  const dice = events.find((l) => l.ev.k === 'produce' && l.round > 1)!;
  assert.equal(dice.by.kind, 'game', 'dice are the game\'s');
  assert.ok(dice.cause?.seat >= 0 && dice.command, 'set off by whoever ended the round before');
  assert.ok(log.some((l) => l.type === 'refused' && l.command === 'nonsense' && l.by.name === 'Ada'), 'refused commands too');
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
  const again = new Room('GLOB', { dir, file: room.file });
  const loaded = lines(again).filter((l) => l.type === 'load');
  assert.equal(loaded.at(-1).entries, before);
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
