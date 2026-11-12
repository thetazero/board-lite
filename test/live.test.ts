// The live contest page (src/playtest/live.ts): what it reads from a contest's
// directory while the contest runs. A finished game counts towards the ratings,
// the game being played shows its round and points, and a game whose runner
// is gone shows as stopped, not playing.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { newGame } from '../src/engine.ts';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { liveState, terminalQr, timeLeft, watchProxy } from '../src/playtest/live.ts';

const base = join(homedir(), '.cache', 'board-lite'); // not /tmp, which is RAM on the dev machine

function stageContest(dir: string, alivePid = process.pid) {
  const roster = ['haiku', 'opus', 'opus+expected', 'bot'];
  writeFileSync(join(dir, 'draw.json'), JSON.stringify({ roster, sizes: [2, 4], seed: 1, games: [[0, 1, 3], [2, 1], [3, 0, 2, 1], [1, 2], [0, 3]] }));
  const finished = (i: number, seats: [string, number][], winner: number, minutes: number) => {
    mkdirSync(join(dir, `g${i}`));
    writeFileSync(join(dir, `g${i}`, 'results.json'), JSON.stringify({
      status: 'over', minutes, rounds: 9, winner: { seat: `P${winner + 1}` },
      seats: seats.map(([model, points], p) => ({ seat: `P${p + 1}`, model, points, ...(model === 'bot' ? {} : { costUsd: 3 }) })),
    }));
  };
  finished(1, [['haiku', 31], ['opus', 52], ['bot', 12]], 1, 40);
  finished(2, [['opus+expected', 50], ['opus', 44]], 0, 30);
  mkdirSync(join(dir, 'g2.failed1'));
  // Game 3, being played: its runner is this test's process, so it's alive.
  mkdirSync(join(dir, 'g3'));
  const g = newGame(4, 7);
  g.round = 5;
  g.phase = 'action';
  writeFileSync(join(dir, 'g3', 'game.json'), JSON.stringify(g));
  writeFileSync(join(dir, 'g3', 'game.seats.json'), JSON.stringify({ seats: [{ name: 'Rowan' }, { name: 'Tick' }, { name: 'Quinn' }, { name: 'Ellis' }] }));
  writeFileSync(join(dir, 'g3', 'runner.json'), JSON.stringify({ pid: alivePid, room: `http://127.0.0.1:${roomPort}/FJKK`, hosted: true, seats: [{ p: 1, model: 'haiku', options: [], cost: 1.25 }] }));
}
let roomPort = 1;

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, '127.0.0.1', () => ok((s.address() as AddressInfo).port)));

test('a running contest: games finished and left, the game being played, and ratings from the finished ones', () => {
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-live-'));
  try {
    stageContest(dir);
    const s = liveState(dir);
    assert.equal(s.total, 5);
    assert.equal(s.finished, 2);
    assert.equal(s.replayed, 1);
    assert.equal(s.minutesPerGame, 35);
    assert.equal(s.atOnce, 1);
    assert.equal(s.minutesLeft, 35 * 3, 'game 3 just started, and 2 more after it, 1 at a time');
    assert.deepEqual(s.recent.map((g) => g.game), [2, 1], 'newest first');
    assert.equal(s.playing.length, 1);
    const now = s.playing[0];
    assert.equal(now.status, 'playing');
    assert.equal(now.round, 5);
    assert.equal(now.phase, 'Actions');
    assert.deepEqual(now.seats.map((x) => x.player), ['bot', 'haiku', 'opus+expected', 'opus'], 'named from the draw, in seat order');
    assert.equal(now.seats[1].costUsd, 1.25);
    assert.equal(now.seats[1].name, 'Tick', 'its name at the table, as the table view shows it');
    assert.equal(now.watch, 'tv?room=FJKK&remote', 'its board can be watched');
    assert.deepEqual(s.ratings.map((r) => r.player).sort(), ['bot', 'haiku', 'opus', 'opus+expected']);
    assert.equal(s.ratings[0].player, 'opus+expected');
    assert.ok(s.ratings.every((r) => r.range > 0));
    assert.deepEqual(s.unrated, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a game whose runner is gone shows as stopped', () => {
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-live-'));
  try {
    stageContest(dir, 2 ** 22 + 12345); // above Linux's default pid_max, so no process has it
    assert.equal(liveState(dir).playing[0].status, 'stopped');
    assert.equal(liveState(dir).playing[0].watch, undefined, 'nothing to watch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('time left shares the games left among the games played at once', () => {
  assert.equal(timeLeft(10, 60, []), 600, 'none playing: 1 at a time');
  assert.equal(timeLeft(10, 60, [0]), 600);
  assert.equal(timeLeft(10, 60, [0, 0]), 300, '2 at a time: half as long');
  assert.equal(timeLeft(10, 60, [30, 30]), 270, 'less what the games being played have had');
  assert.equal(timeLeft(2, 60, [10, 50]), 50, 'the last games: as long as the longest left of them');
  assert.equal(timeLeft(3, 60, [80, 0]), 60, 'a game past the average counts as nearly done');
});

test('the terminal QR code is square, two modules a line', () => {
  const lines = terminalQr('http://example.ts.net:8790/').split('\n');
  assert.ok(lines.length > 10);
  assert.ok(lines.every((l) => l.length === lines[0].length));
});

test("a game's table view is passed through from its room, read-only", async () => {
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-live-'));
  const seen: string[] = [];
  const room = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain', 'x-secret': '1' });
    res.end(`room ${req.url}`);
  });
  const live = createServer((req, res) => watchProxy(dir, req, res));
  try {
    roomPort = await listen(room);
    stageContest(dir);
    const at = `http://127.0.0.1:${await listen(live)}`;
    const get = (path: string, init?: RequestInit) => fetch(at + path, init).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));

    const page = await get('/tv?room=FJKK&remote');
    assert.equal(page.status, 200);
    assert.equal(page.text, 'room /tv?room=FJKK&remote');
    assert.equal(page.headers.get('x-secret'), null, 'only the headers a page needs');
    assert.equal((await get('/api/rooms/FJKK/events')).text, 'room /api/rooms/FJKK/events');
    assert.equal((await get('/style.css')).text, 'room /style.css', "the page's files, from a room being played");

    assert.equal((await get('/api/rooms/FJKK/save', { method: 'POST' })).status, 405, 'watching changes nothing');
    assert.equal((await get('/api/rooms/FJKK?token=abc')).status, 403, 'no seat');
    assert.equal((await get('/api/saved')).status, 404);
    assert.equal((await get('/api/rooms/ABCD')).status, 400, 'a room not being played here');
    assert.deepEqual(seen, ['GET /tv?room=FJKK&remote', 'GET /api/rooms/FJKK/events', 'GET /style.css']);
  } finally {
    room.close();
    live.close();
    roomPort = 1;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a game with a person in it: their link into the seat, and that the game waits for them until it starts', () => {
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-live-'));
  try {
    writeFileSync(join(dir, 'draw.json'), JSON.stringify({ roster: ['opus+expected+fable51', 'person:Lesha', 'bot'], sizes: [2, 3], seed: 1, games: [[0, 2], [1, 0, 2]] }));
    mkdirSync(join(dir, 'g1'));
    writeFileSync(join(dir, 'g1', 'results.json'), JSON.stringify({ status: 'over', minutes: 30, rounds: 9, winner: { seat: 'P1' }, seats: [{ seat: 'P1', model: 'opus+fable51+expected', points: 50 }, { seat: 'P2', model: 'bot', points: 20 }] }));
    mkdirSync(join(dir, 'g2'));
    writeFileSync(join(dir, 'g2', 'runner.json'), JSON.stringify({ pid: process.pid, room: 'http://127.0.0.1:41234/ABCD', hosted: true, seats: [], people: [{ p: 0, name: 'Lesha', token: 'tok' }], port: 41234 }));
    const s = liveState(dir);
    assert.deepEqual(s.playing[0].play, [{ name: 'Lesha', port: 41234, hash: '#code=ABCD&token=tok' }]);
    assert.deepEqual(s.playing[0].waitingFor, ['Lesha'], 'no game.json yet: it waits for them');
    assert.deepEqual(s.unrated, ['person:Lesha'], 'a roster entry is matched to its results by its label, options in any order');
    writeFileSync(join(dir, 'g2', 'game.json'), JSON.stringify(newGame(3, 7)));
    assert.equal(liveState(dir).playing[0].waitingFor, undefined, 'started');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
