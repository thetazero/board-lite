import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collect, playerOf } from '../src/playtest/leaderboard.ts';
import { placesFrom, rate, type RatedGame } from '../src/playtest/rating.ts';

const game = (...order: string[]): RatedGame => ({ seats: order.map((player, i) => ({ player, place: i + 1 })) });

test('places: the winner is first even on a tie, other ties share a place', () => {
  assert.deepEqual(placesFrom([30, 50, 20], 1), [2, 1, 3]);
  assert.deepEqual(placesFrom([50, 50, 20], 1), [2, 1, 3]);
  assert.deepEqual(placesFrom([50, 20, 20, 10], 0), [1, 2, 2, 4]);
});

test('the player who finishes ahead more often rates higher, and the average seat is 1500', () => {
  const games = [...Array(20)].map((_, i) => (i % 4 ? game('opus', 'sonnet', 'haiku') : game('sonnet', 'opus', 'haiku')));
  const r = rate(games);
  assert.deepEqual(r.map((x) => x.player), ['opus', 'sonnet', 'haiku']);
  assert.ok(Math.abs(r.reduce((t, x) => t + x.rating, 0) / 3 - 1500) < 1e-6);
  assert.equal(r[0].wins, 15);
  assert.equal(r[0].games, 20);
});

test('one game says little: a wide range, and the prior keeps it finite', () => {
  const [a, b] = rate([game('a', 'b')]);
  assert.ok(a.rating > b.rating && Number.isFinite(a.rating));
  const many = rate([...Array(50)].map((_, i) => (i % 2 ? game('a', 'b') : game('b', 'a'))));
  assert.ok(Math.abs(many[0].rating - 1500) < 1);
  assert.ok(a.range > 2 * many[0].range, 'a one-game rating is much less sure');
});

test('the order games were played in does not matter', () => {
  const games = [game('x', 'y', 'z'), game('z', 'y', 'x'), game('y', 'x', 'z'), game('x', 'z', 'y')];
  const one = rate(games), two = rate([...games].reverse());
  for (const p of one) assert.ok(Math.abs(p.rating - two.find((q) => q.player === p.player)!.rating) < 1e-6);
});

test('the same model in two seats: no result between them, one game each', () => {
  const r = rate([game('haiku', 'opus', 'haiku')]);
  const haiku = r.find((x) => x.player === 'haiku')!;
  assert.equal(haiku.games, 1);
  assert.equal(haiku.wins, 1);
});

test('the leaderboard reads playtests, and room games with people, bots and Claude players a runner seated', () => {
  const base = join(homedir(), '.cache', 'board-lite'); // not /tmp, which is RAM on the dev machine
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'test-eval-'));
  try {
    const play = join(root, 'playtests'), rooms = join(root, 'rooms');
    mkdirSync(join(play, 'eval', 'g1'), { recursive: true });
    mkdirSync(join(play, 'joined'), { recursive: true });
    mkdirSync(rooms);
    writeFileSync(join(play, 'eval', 'g1', 'results.json'), JSON.stringify({
      status: 'over', effort: 'high', winner: { seat: 'P2' },
      seats: [{ seat: 'P1', model: 'opus', modelId: 'claude-opus-5-5', points: 40, costUsd: 9 }, { seat: 'P2', model: 'codex:gpt-5.6-sol', points: 50, tokens: 4000 }],
    }));
    writeFileSync(join(play, 'eval', 'g2.failed1'), ''); // not a directory: ignored
    // A runner that joined Rowan to the user's room ABCD.
    writeFileSync(join(play, 'joined', 'results.json'), JSON.stringify({
      status: 'over', room: 'http://localhost:8080/ABCD', winner: { seat: 'P1' },
      seats: [{ seat: 'P1', name: 'Lesha', model: 'player: Lesha', points: 50 }, { seat: 'P2', name: 'Cog', model: 'bot', points: 20 }, { seat: 'P3', name: 'Rowan', model: 'haiku', points: 30, costUsd: 1 }],
    }));
    writeFileSync(join(rooms, 'ABCD.seats.json'), JSON.stringify({ code: 'ABCD', hostToken: 't', seats: [{ name: 'Lesha', kind: 'player' }, { name: 'Cog', kind: 'bot' }, { name: 'Rowan', kind: 'player' }] }));
    writeFileSync(join(rooms, 'ABCD.json'), JSON.stringify({ phase: 'over', log: [{ round: 9, text: '', ev: { k: 'final', totals: [50, 20, 30], winner: 0 } }] }));
    // The user and a bot, nobody else; and an unfinished game.
    writeFileSync(join(rooms, 'WXYZ.seats.json'), JSON.stringify({ code: 'WXYZ', hostToken: 't', seats: [{ name: 'lesha', kind: 'player' }, { name: 'Cog', kind: 'bot' }] }));
    writeFileSync(join(rooms, 'WXYZ.json'), JSON.stringify({ phase: 'over', log: [{ round: 9, text: '', ev: { k: 'final', totals: [20, 50], winner: 1 } }] }));
    writeFileSync(join(rooms, 'QQQQ.seats.json'), JSON.stringify({ code: 'QQQQ', hostToken: 't', seats: [{ name: 'Lesha', kind: 'player' }, { name: 'Cog', kind: 'bot' }] }));
    writeFileSync(join(rooms, 'QQQQ.json'), JSON.stringify({ phase: 'action', log: [] }));

    const c = collect({ dirs: [play], rooms });
    assert.equal(c.games.length, 3);
    const seats = c.games.map((g) => g.seats.map((s) => `${s.player}#${s.place}`).join(' ')).sort();
    assert.deepEqual(seats, [
      'Lesha (person)#1 bot#3 haiku#2',
      'Lesha (person)#2 bot#1',
      'claude-opus-5-5 @high#2 codex:gpt-5.6-sol @high#1',
    ]);
    assert.equal(c.skipped['not finished'], 1);
    const haiku = c.games.flatMap((g) => g.spent).find((s) => s.player === 'haiku');
    assert.equal(haiku?.costUsd, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a seat with player options is its own player, under the model it reported running', () => {
  assert.equal(playerOf({ seat: 'P1', model: 'opus+expected', options: ['expected'], modelId: 'claude-opus-5-5' }), 'claude-opus-5-5+expected');
  assert.equal(playerOf({ seat: 'P1', model: 'opus', options: [], modelId: 'claude-opus-5-5' }, 'high'), 'claude-opus-5-5 @high');
  assert.equal(playerOf({ seat: 'P1', model: 'opus+expected', options: ['expected'] }), 'opus+expected');
  assert.equal(playerOf({ seat: 'P1', model: 'codex:gpt-5.6-sol' }), 'codex:gpt-5.6-sol');
});
