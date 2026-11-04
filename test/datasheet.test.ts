import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DECKS } from '../src/data.ts';
import { DATASHEET_PATH, datasheet } from '../src/datasheet.ts';
import { newGame } from '../src/engine.ts';

test('docs/datasheet.md matches the current tuning', () => {
  const fresh = datasheet();
  assert.ok(fresh.includes('| Quarry |'), 'the datasheet lists the buildings');
  assert.ok(readFileSync(DATASHEET_PATH, 'utf8') === fresh, 'docs/datasheet.md is out of date: run `npm run datasheet` and commit it');
});

test("the datasheet's decks are the decks the game deals from", () => {
  const g = newGame(4, 1);
  const count = (cards: { key: string }[]) => {
    const n: Record<string, number> = {};
    for (const c of cards) n[c.key] = (n[c.key] ?? 0) + 1;
    return n;
  };
  for (const d of ['building', 'action'] as const) {
    const dealt = [...g.decks[d], ...g.discards[d], ...g.players.flatMap((p) => [...p.hand, ...p.choice].filter((c) => c.deck === d))];
    const listed: Record<string, number> = {};
    for (const defs of DECKS[d]) for (const [k, def] of Object.entries(defs as Record<string, { copies?: number }>)) if (def.copies) listed[k] = def.copies;
    assert.deepEqual(count(dealt), listed, `the ${d} deck`);
    const total = Object.values(listed).reduce((s, x) => s + x, 0);
    assert.ok(datasheet().includes(`### ${d === 'building' ? 'Building' : 'Action'} deck: ${total} cards`), `the datasheet gives the ${d} deck's total`);
  }
});
