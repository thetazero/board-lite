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
import { liveState, terminalQr } from '../src/playtest/live.ts';

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
  writeFileSync(join(dir, 'g3', 'runner.json'), JSON.stringify({ pid: alivePid, seats: [{ p: 1, model: 'haiku', options: [], cost: 1.25 }] }));
}

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
    assert.deepEqual(s.recent.map((g) => g.game), [2, 1], 'newest first');
    assert.equal(s.playing.length, 1);
    const now = s.playing[0];
    assert.equal(now.status, 'playing');
    assert.equal(now.round, 5);
    assert.equal(now.phase, 'Actions');
    assert.deepEqual(now.seats.map((x) => x.player), ['bot', 'haiku', 'opus+expected', 'opus'], 'named from the draw, in seat order');
    assert.equal(now.seats[1].costUsd, 1.25);
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the terminal QR code is square, two modules a line', () => {
  const lines = terminalQr('http://example.ts.net:8790/').split('\n');
  assert.ok(lines.length > 10);
  assert.ok(lines.every((l) => l.length === lines[0].length));
});
