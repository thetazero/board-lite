import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { newGame } from '../src/engine.ts';
import { load, save } from '../src/store.ts';

// The desert was called plains: a game saved then still loads, with desert in it.
test('a game saved when the desert was called plains loads with desert', () => {
  const base = join(homedir(), '.cache', 'board-lite');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-store-'));
  try {
    const g = newGame(3, 7);
    const deserts = Object.keys(g.map).filter((k) => g.map[k].terrain === 'desert');
    assert.ok(deserts.length > 0);
    const old = JSON.parse(JSON.stringify(g));
    for (const k of deserts) old.map[k].terrain = 'plains';
    const file = join(dir, 'old.json');
    save(file, old);
    assert.deepEqual(load(file), g);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
