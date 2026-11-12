// A contest's --until-sure (eval.ts): it stops once each --focus player is
// rated as surely as the rest were when the focus began.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sureEnough } from '../src/playtest/leaderboard.ts';
import { rng } from '../src/playtest/draw.ts';

const base = join(homedir(), '.cache', 'board-lite'); // not /tmp, which is RAM on the dev machine

test('until sure: the focus players are as sure as the rest were before the focus began', () => {
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-focus-'));
  try {
    const r = rng(7);
    let i = 0;
    const game = (models: string[]) => {
      const order = [...models].sort(() => r() - 0.5);
      i++;
      mkdirSync(join(dir, `g${i}`));
      writeFileSync(join(dir, `g${i}`, 'results.json'), JSON.stringify({
        status: 'over', winner: { seat: `P${models.indexOf(order[0]) + 1}` },
        seats: models.map((model, p) => ({ seat: `P${p + 1}`, model, points: 10 * (models.length - order.indexOf(model)) })),
      }));
    };
    const old = ['haiku', 'sonnet', 'opus', 'bot'];
    for (let n = 0; n < 30; n++) game([old[n % 4], old[(n + 1) % 4], old[(n + 2) % 4]]);
    const from = i + 1;
    assert.equal(sureEnough(dir, ['codex:gpt-5.6-sol'], from), null, 'no game yet');
    game(['codex:gpt-5.6-sol', 'opus']);
    assert.equal(sureEnough(dir, ['codex:gpt-5.6-sol'], from), null, 'one game is far from sure');
    let games = 1;
    while (!sureEnough(dir, ['codex:gpt-5.6-sol'], from) && games < 100) { game(['codex:gpt-5.6-sol', old[games % 4], old[(games + 1) % 4]]); games++; }
    assert.ok(games > 5 && games < 40, `sure after ${games} games`);
    assert.match(sureEnough(dir, ['codex:gpt-5.6-sol'], from)!, /within ±\d+, the middle of the rest's before game 31/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
