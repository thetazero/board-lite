import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TARGETS, TUNING } from '../src/data.ts';
import { GOAL, HOARD_POINTS, KINGDOM_POINTS, PHASES, SCORES, WORKSHOP_POINTS } from '../web/howto.ts';
import { ROUND } from '../web/explain-steps.ts';

const rules = readFileSync(new URL('../docs/rules.md', import.meta.url), 'utf8');

test("How to play's phases are the rules'", () => {
  assert.deepEqual(PHASES.map((p) => p.name), ROUND); // ROUND is held to the rules in explain.test.ts
  assert.ok(rules.includes('Draw 1 action card and 2 building cards; keep 1 of the building cards'));
});

test("How to play's points are the game's", () => {
  assert.ok(GOAL.includes(`${TUNING.pointsToWin} points`));
  assert.ok(rules.includes(`Workshops: ${WORKSHOP_POINTS} each`));
  assert.ok(rules.includes(`Secret Hoard cards: ${HOARD_POINTS} each`));
  const paying = Object.values(TARGETS).filter((t) => t.points).map((t) => ({ name: t.name.replace("'", '’'), points: t.points }));
  assert.deepEqual(KINGDOM_POINTS, paying);
});

test('How to play is short: under 150 words', () => {
  const all = [GOAL, ...PHASES.flatMap((p) => [p.name, p.text]), ...SCORES.map((s) => `${s.points} ${s.text}`)].join(' ');
  assert.ok(all.split(/\s+/).length < 150, `${all.split(/\s+/).length} words`);
});
