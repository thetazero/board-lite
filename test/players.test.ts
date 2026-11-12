import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FABLE_5_1_ADVICE, isAi, parseSeats, parseSpec, resultsLabel, seatAdvice } from '../src/playtest/players.ts';
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

test('+fable51 gives a seat the Fable 5.1 advice word for word, with no --advice needed', () => {
  assert.deepEqual(parseSeats(['opus+fable51', 'opus'], undefined).map((s) => s.label), ['opus+fable51', 'opus']);
  assert.ok(FABLE_5_1_ADVICE.startsWith('The game is engine-building. Points are mostly building count.'));
  assert.ok(FABLE_5_1_ADVICE.endsWith("- Bear them anyway. It's 1 crystal."));
  assert.equal(seatAdvice(['fable51'], undefined), `\n\nAdvice:\n\n${FABLE_5_1_ADVICE}`);
  assert.equal(seatAdvice([], 'raid early'), '');
  assert.equal(seatAdvice(['advice', 'fable51'], 'raid early'), `\n\nAdvice: raid early\n\nAdvice:\n\n${FABLE_5_1_ADVICE}`);
  // --advice with no +advice seat still goes to every Claude seat, the +fable51 ones too.
  assert.deepEqual(parseSeats(['opus+fable51', 'opus'], 'raid early').map((s) => s.label), ['opus+advice+fable51', 'opus+advice']);
});

test('a person is a seat too: person:<name>, with no options, and no AI seat to take a slot', () => {
  assert.deepEqual(parseSpec('person:Lesha'), { model: 'person:Lesha', options: [], label: 'person:Lesha' });
  assert.throws(() => parseSpec('person:Lesha+expected'), /person takes no options/);
  assert.throws(() => parseSpec('person:'), /names no one/);
  assert.deepEqual(['opus+expected', 'codex:gpt-5.6-sol', 'bot', 'strongbot', 'person:Lesha'].map(isAi), [true, true, false, false, false]);
  assert.equal(resultsLabel('person:Lesha'), 'player: Lesha', 'named in results.json as any person at the table');
  assert.equal(resultsLabel('opus+expected+fable51'), 'opus+fable51+expected', 'options in their own order');
  assert.deepEqual(parseSeats(['opus', 'person:Lesha'], 'Hoard gold.').map((x) => x.label), ['opus+advice', 'person:Lesha'], 'advice goes to the Claude seats only');
});
