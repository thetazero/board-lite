import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extend, parseSizes, rng, tally } from '../src/playtest/draw.ts';

const roster = ['haiku', 'sonnet', 'opus', 'opus+advice+expected', 'opus+fable51', 'bot'];

test('a contest draws every size equally, and balances games, meetings and seats', () => {
  const { games } = extend({ roster, sizes: [2, 6], games: [] }, 60, rng(1));
  assert.equal(games.length, 60);
  for (let k = 2; k <= 6; k++) assert.equal(games.filter((g) => g.length === k).length, 12);
  for (const g of games) assert.equal(new Set(g).size, g.length, 'nobody sits twice in a game');
  const t = tally(roster, games);
  assert.ok(Math.max(...t.played) - Math.min(...t.played) <= 1, `games: ${t.played}`);
  const met = t.met.flatMap((row, p) => row.filter((_, q) => q !== p));
  assert.ok(Math.max(...met) - Math.min(...met) <= 4, `meetings: ${met}`);
  t.seats.forEach((row, p) => row.forEach((c, j) => assert.ok(Math.abs(c - t.share[p][j]) <= 1.5, `${roster[p]} seat ${j + 1}: ${c} against ${t.share[p][j]}`)));
});

test('the same seed draws the same contest, and extending it keeps the games already drawn', () => {
  const a = extend({ roster, sizes: [2, 6], games: [] }, 23, rng(5)).games;
  assert.deepEqual(extend({ roster, sizes: [2, 6], games: [] }, 23, rng(5)).games, a);
  const first = extend({ roster, sizes: [2, 6], games: [] }, 13, rng(5)).games;
  const more = extend({ roster, sizes: [2, 6], games: first }, 10, rng(99)).games;
  assert.deepEqual(more.slice(0, 13), first);
  // A size block cut short at game 13 is finished before a new one starts: games 11-15 hold every size once.
  assert.deepEqual(more.slice(10, 15).map((g) => g.length).sort(), [2, 3, 4, 5, 6]);
  const t = tally(roster, more);
  assert.ok(Math.max(...t.played) - Math.min(...t.played) <= 1);
});

test('--seats takes a number or a range from 2 to 6', () => {
  assert.deepEqual(parseSizes('3'), [3, 3]);
  assert.deepEqual(parseSizes('2-6'), [2, 6]);
  assert.throws(() => parseSizes('1-6'));
  assert.throws(() => parseSizes('5-3'));
  assert.throws(() => parseSizes('2-7'));
  assert.throws(() => extend({ roster: ['a', 'b', 'c'], sizes: [2, 4], games: [] }, 1, rng(1)));
});
