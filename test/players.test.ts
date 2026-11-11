import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSeats, parseSpec } from '../src/playtest/players.ts';
import { tally, type GameResult } from '../src/playtest/tally.ts';

test('a seat is a model and its options, labeled the same whatever order the options come in', () => {
  assert.deepEqual(parseSpec('opus'), { model: 'opus', options: [], label: 'opus' });
  assert.deepEqual(parseSpec('opus+expected+advice'), { model: 'opus', options: ['advice', 'expected'], label: 'opus+advice+expected' });
  assert.equal(parseSpec(' claude-haiku-5-5 + expected ').label, 'claude-haiku-5-5+expected');
  assert.throws(() => parseSpec('opus+telepathy'), /isn't a Claude player option/);
  assert.throws(() => parseSpec('bot+expected'), /bot takes no options/);
  assert.throws(() => parseSpec('+advice'), /names no model/);
});

test('--advice goes to the seats with +advice, or to every Claude seat when none has it', () => {
  assert.deepEqual(parseSeats(['opus+advice', 'opus'], 'raid early').map((s) => s.label), ['opus+advice', 'opus']);
  assert.deepEqual(parseSeats(['opus', 'haiku+expected', 'bot'], 'raid early').map((s) => s.label), ['opus+advice', 'haiku+advice+expected', 'bot']);
  assert.deepEqual(parseSeats(['opus', 'bot'], undefined).map((s) => s.label), ['opus', 'bot']);
  assert.throws(() => parseSeats(['opus+advice', 'opus'], undefined), /--advice TEXT/);
});

test('a batch tallies wins per configuration, so two configurations of one model compete', () => {
  const A = 'opus+advice+expected', B = 'opus';
  const game = (n: number, seats: string[], win: number): GameResult => ({
    game: `g${n}`, status: 'over', rounds: 7, winner: { seat: `P${win + 1}`, model: seats[win] }, seats: seats.map((model, i) => ({ seat: `P${i + 1}`, model })),
  });
  const t = tally([game(1, [A, A, B, B], 0), game(2, [A, B, B, A], 1), game(3, [B, B, A, A], 3), game(4, [B, A, A, B], 2)]);
  const a = t.models.find((m) => m.model === A)!;
  assert.equal(a.wins, 3);
  assert.equal(a.share, 0.5);
  assert.equal(t.models.find((m) => m.model === B)!.wins, 1);
});
