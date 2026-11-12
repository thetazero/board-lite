import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extend, focusSeats, parseSizes, rng, tally } from '../src/playtest/draw.ts';

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

test('a contest takes new players partway: the games drawn stay, and the new players join the end of the roster', () => {
  const first = extend({ roster, sizes: [2, 6], games: [] }, 20, rng(3)).games;
  const grown = [...roster, 'codex:gpt-5.6-sol', 'codex:gpt-6-astra'];
  const more = extend({ roster: grown, sizes: [2, 6], games: first }, 10, rng(4)).games;
  assert.deepEqual(more.slice(0, 20), first);
  // The balanced draw puts the newcomers, with the fewest games, in the games that follow.
  for (const g of more.slice(20)) assert.ok(g.includes(6) || g.includes(7));
});

test('focus players get every seat of a game but one, opponents from the whole bucket', () => {
  const first = extend({ roster, sizes: [2, 6], games: [] }, 40, rng(1)).games;
  const grown = [...roster, 'luna', 'sol', 'terra', 'astra'];
  const focus = [6, 7, 8, 9];
  const all = extend({ roster: grown, sizes: [2, 6], games: first, focus }, 40, rng(2)).games;
  const added = all.slice(40);
  for (const g of added) assert.equal(g.filter((p) => focus.includes(p)).length, Math.min(4, g.length - 1), `game ${g}`);
  const t = tally(grown, added);
  const fp = focus.map((p) => t.played[p]);
  assert.ok(Math.max(...fp) - Math.min(...fp) <= 1, `focus games: ${fp}`);
  // Every focus player meets every other player in the bucket, each old player about as often.
  for (const f of focus) {
    const old = [0, 1, 2, 3, 4, 5].map((o) => t.met[f][o]);
    assert.ok(Math.min(...old) >= 2 && Math.max(...old) - Math.min(...old) <= 3, `${grown[f]} met the others ${old}`);
  }
  assert.ok(Math.min(...fp) > Math.max(...[0, 1, 2, 3, 4, 5].map((o) => t.played[o])), 'the focus players play more than the rest');
});

test('focus seats: every seat but one, as many as there are focus players', () => {
  assert.deepEqual([2, 3, 4, 5, 6].map((k) => focusSeats(k, 4)), [1, 2, 3, 4, 4]);
  assert.equal(focusSeats(6, 1), 1, 'a single newcomer has one seat');
  assert.throws(() => extend({ roster: ['a', 'b', 'c'], sizes: [2, 3], games: [], focus: [0, 1, 2] }, 1, rng(1)));
  const few = extend({ roster: ['a', 'b', 'c', 'd'], sizes: [2, 4], games: [], focus: [0, 1, 2] }, 3, rng(1)).games;
  for (const g of few) assert.ok(g.includes(3), 'the one player outside the focus anchors every game');
});
