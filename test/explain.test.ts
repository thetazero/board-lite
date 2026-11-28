import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BEASTS, TUNING } from '../src/data.ts';
import { rulebook } from '../src/state.ts';
import { BUILT, DRAWN, HEXES, KINGDOMS, ROUND, SCORES, STEPS } from '../web/explain-steps.ts';

const rules = readFileSync(new URL('../docs/rules.md', import.meta.url), 'utf8');

test('the explanation takes 30 seconds to a minute', () => {
  const ms = STEPS.reduce((s, x) => s + x.ms, 0);
  assert.ok(ms >= 30_000 && ms <= 60_000, `${ms} ms`);
});

test("its phases are the rules', and it shows each", () => {
  const phases = [...rules.split('\n## A round')[1].split('\n## ')[0].matchAll(/^\d\. \*\*(\w+)\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(ROUND, phases);
  assert.deepEqual([...new Set(STEPS.flatMap((s) => s.phase ?? []))], phases);
});

test("its numbers are the game's", () => {
  assert.ok(STEPS.at(-1)!.text.includes(`${TUNING.pointsToWin} points`));
  const worth = (name: string) => SCORES.find((s) => s.name === name)!.points;
  assert.equal(worth('Most dragon power, tower floors or gold'), TUNING.titlePoints);
  for (const b of Object.values(BEASTS)) assert.equal(worth('Slay a great beast'), b.points);
  assert.ok(rules.includes(`Monument cards (Monument, Standing Stones, Lighthouse, Guildhall): ${worth('Monument')} each`));
  assert.ok(rules.includes(`Production buildings: ${worth('Production building')} each`));
  assert.ok(rules.includes('Draw 1 action card and 2 building cards; keep 1 of the building cards'));
});

test('what it shows exists, and is built where the rules allow', () => {
  const book = rulebook();
  for (const k of DRAWN) assert.ok(book.buildings.some((b) => b.key === k && !b.basic), k);
  for (const k of KINGDOMS) assert.ok(book.kingdoms.some((t) => t.key === k), k);
  const near = (a: string, b: string) => {
    const [q, r] = a.split(',').map(Number), [s, t] = b.split(',').map(Number);
    return Math.max(Math.abs(q - s), Math.abs(r - t), Math.abs(q + r - s - t)) === 1;
  };
  for (const b of BUILT.filter((x) => x.type !== 'tower')) {
    const terrain = HEXES.find((h) => `${h.q},${h.r}` === b.at)!.terrain;
    const card = book.buildings.find((x) => x.key === b.type)!;
    assert.ok(card, b.type);
    assert.ok(card.terrain ? card.terrain === terrain : terrain !== 'ocean', `${b.type} on ${terrain}`);
    assert.ok(BUILT.some((x) => x.owner === b.owner && x.from <= b.from && near(x.at, b.at)), `${b.type} is adjacent to its owner's`);
  }
});
