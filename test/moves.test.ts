// The same game with the same moves plays out the same: test/moves.json has
// games as they were played, and a digest of each every 50 moves. They were
// recorded from the engine that took text commands (#556), so they hold the
// typed ones to it. After a change of rules or tuning that's meant to change
// how games go, record them again: RECORD_MOVES=1 node --test test/moves.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { botMove, standInMove } from '../src/bot.ts';
import type { Command } from '../src/command.ts';
import { apply, newGame, waitingOn, type Game } from '../src/engine.ts';
import { strongMove } from '../src/strongbot.ts';

const FILE = new URL('moves.json', import.meta.url);
interface Recorded { players: number; seed: number; strong: 'none' | 'all' | 'even'; max: number; digests: string[]; moves: [number, Command][] }

// The offers kept only to explain a late answer aren't part of how a game plays out.
const digest = ({ closedOffers: _, ...g }: Game) => createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0, 16);

// The bots play it, as they were when it was recorded.
function play(r: Recorded): Recorded {
  const g = newGame(r.players, r.seed);
  const rng = { state: r.seed };
  let now = 0;
  const moves: [number, Command][] = [], digests: string[] = [];
  while (g.phase !== 'over' && moves.length < r.max) {
    const was = moves.length;
    for (const p of waitingOn(g)) {
      now += 2000;
      const strong = r.strong === 'all' || (r.strong === 'even' && p % 2 === 0);
      const cmd = strong ? strongMove(g, p, rng, { now }) : moves.length % 17 === 3 ? standInMove(g, p) : botMove(g, p, rng);
      if (!cmd) continue; // waiting on answers to its offer
      moves.push([p, cmd]);
      if (moves.length % 50 === 0) digests.push(digest(g));
      break;
    }
    if (moves.length === was) now += 60000;
  }
  return { ...r, digests: [...digests, digest(g)], moves };
}

test('the same game with the same moves plays out as before', () => {
  let games: Recorded[] = JSON.parse(readFileSync(FILE, 'utf8'));
  if (process.env.RECORD_MOVES) {
    games = games.map(play);
    writeFileSync(FILE, `[\n${games.map((g) => JSON.stringify(g)).join(',\n')}\n]\n`);
  }
  for (const r of games) {
    const g = newGame(r.players, r.seed);
    const digests: string[] = [];
    r.moves.forEach(([p, cmd], i) => {
      apply(g, p, cmd);
      if ((i + 1) % 50 === 0) digests.push(digest(g));
    });
    assert.deepEqual([...digests, digest(g)], r.digests, `${r.players} players, seed ${r.seed}: see the top of this file`);
  }
});
