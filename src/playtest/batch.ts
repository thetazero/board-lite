#!/usr/bin/env node
// Runs a batch of playtest games, the same models rotated one seat per game so
// each model sits in every seat equally often, then writes the batch's win
// rates and stats to summary.md. See "Depth batches" in docs/playtest.md.
//
//   node src/playtest/batch.ts --games 30 --models opus,haiku,haiku [--out DIR] [run.ts options]
//   node src/playtest/batch.ts --summary DIR

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runGames } from './games.ts';
import { batchMarkdown, loadBatch } from './stats.ts';
import { summary } from './tally.ts';

const USAGE = `node src/playtest/batch.ts --games N --models <m1,m2,...> [--out DIR] [options]
node src/playtest/batch.ts --summary DIR

  --games N          how many games (default 30; see docs/playtest.md for why)
  --models ...       the seats of game 1, as for run.ts; game i rotates them i-1 seats
  --out DIR          the batch directory (default ~/.cache/board-lite/playtests/<time>-batch-<models>);
                     game i goes in DIR/gi. Rerunning into the same DIR keeps the finished
                     games and reruns the rest.
  --seed N           seed of game 1; game i gets N+i-1 (default random per game)
  --effort, --budget-usd, --max-minutes, --stall-minutes, --advice   passed to every game
  --summary DIR      just (re)write and print DIR/summary.md`;

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help')) { console.log(USAGE); process.exit(0); }

// Win rates, then what happened in every game (src/playtest/stats.ts).
function writeSummary(dir: string) {
  const text = `${summary(dir)}\n${batchMarkdown(loadBatch(dir))}`;
  writeFileSync(join(dir, 'summary.md'), text);
  console.log(text);
}

const only = opt('--summary');
if (only) { writeSummary(resolve(only)); process.exit(0); }

const models = (opt('--models') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
if (models.length < 2) { console.log(USAGE); process.exit(1); }
const games = Number(opt('--games') ?? 30);
const seed = opt('--seed');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(opt('--out') ?? join(homedir(), '.cache', 'board-lite', 'playtests', `${stamp}-batch-${models.join('-')}`));
if (out.startsWith('/tmp')) throw new Error('Keep playtests out of /tmp (it is RAM on the dev machine).');
mkdirSync(out, { recursive: true });
const passed = ['--effort', '--budget-usd', '--max-minutes', '--stall-minutes', '--advice'].flatMap((o) => (opt(o) === undefined ? [] : [o, opt(o)!]));

// As many games at once as free memory can seat (runGames checks before each).
await runGames({
  out,
  games,
  atOnce: Infinity,
  // Game i rotates the seats i-1 places, so each model sits in each seat equally often.
  seats: (i) => { const r = (i - 1) % models.length; return [...models.slice(r), ...models.slice(0, r)]; },
  args: (i) => [...(seed ? ['--seed', String(Number(seed) + i - 1)] : []), ...passed],
});
writeSummary(out);
