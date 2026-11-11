import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { benchGame } from '../src/botbench.ts';
import { newGame } from '../src/engine.ts';
import { Room } from '../src/server/room.ts';
import { merchantPlan, worth } from '../src/strongbot.ts';
import { TUNING } from '../src/data.ts';

const dir = mkdtempSync(join(tmpdir(), 'board-lite-strong-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('the strong bot beats two random bots, quickly, and talks', () => {
  for (const seed of [3, 4]) {
    const r = benchGame(['strong', 'bot', 'bot'], seed);
    assert.equal(r.winner, 0, `seed ${seed}: ${r.points.join('/')}`);
    assert.ok(r.points[0] >= TUNING.pointsToWin);
    assert.ok(r.ms / r.moves < 200, `${(r.ms / r.moves).toFixed(0)} ms a move`);
    assert.ok(r.talk > 0, 'it says something');
  }
});

test('the merchants plan pays a cost from what it has, or says it can\'t', () => {
  const g = newGame(2, 1);
  g.players[0].resources = { stone: 0, timber: 12, crystal: 4, livestock: 3, gold: 0 };
  assert.deepEqual(merchantPlan(g, 0, { stone: 2, timber: 4 }), ['merchants timber stone 2']);
  assert.equal(merchantPlan(g, 0, { stone: 5 }), null);
  assert.equal(merchantPlan(g, 0, { gold: 1 }), null);
  assert.ok(Number.isFinite(worth(g, 0)));
});

test('a room with a strong bot plays itself to the end', { timeout: 120_000 }, async (t) => {
  const room = new Room('STRG', { botDelayMs: 0, dir });
  room.addBot(true);
  room.addBot();
  assert.equal(room.lobby().seats[0].strong, true);
  const ended = new Promise<void>((resolve, reject) => {
    t.mock.method(console, 'error', (...args: unknown[]) => reject(new Error(args.map(String).join(' '))));
    room.subscribe(() => { if (room.game?.phase === 'over') resolve(); });
  });
  room.start(room.hostToken, 5);
  try {
    await ended;
  } finally {
    room.close();
  }
  assert.equal(room.game!.winner, 0);
});
