import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binomialTail, tally, wilson, type GameResult } from '../src/playtest/tally.ts';

test('binomial tail and Wilson interval', () => {
  assert.ok(Math.abs(binomialTail(30, 15, 1 / 3) - 0.0435) < 0.001); // 15 of 30 for a 1-in-3 seat: rare by chance
  assert.ok(Math.abs(binomialTail(4, 0, 0.3) - 1) < 1e-9);
  const [lo, hi] = wilson(1, 4);
  assert.ok(lo > 0.04 && lo < 0.05 && hi > 0.69 && hi < 0.71);
});

test('a batch tally counts wins against each model\'s share of seats, and only finished games', () => {
  const game = (n: number, seats: string[], win: number | null, status = 'over'): GameResult => ({
    game: `g${n}`, status, rounds: 7,
    winner: win === null ? null : { seat: `P${win + 1}`, model: seats[win] },
    seats: seats.map((model, i) => ({ seat: `P${i + 1}`, model })),
  });
  const t = tally([
    game(1, ['opus', 'haiku', 'haiku'], 0),
    game(2, ['haiku', 'haiku', 'opus'], 2),
    game(3, ['haiku', 'opus', 'haiku'], 0),
    game(4, ['opus', 'haiku', 'haiku'], null, 'stalled'),
  ]);
  assert.equal(t.finished.length, 3);
  assert.deepEqual(t.unfinished.map((r) => r.game), ['g4']);
  const opus = t.models.find((m) => m.model === 'opus')!;
  assert.equal(opus.wins, 2);
  assert.ok(Math.abs(opus.share - 1 / 3) < 1e-9);
  assert.equal(t.models.find((m) => m.model === 'haiku')!.wins, 1);
  assert.deepEqual(t.bySeat, { P1: 2, P3: 1 });
});
