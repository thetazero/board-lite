#!/usr/bin/env node
// The model eval: games among a roster of models (Claude, Codex, the bot),
// every lineup of --seats of them in turn, each lineup rotated through every
// seat order, then the leaderboard of those games (src/playtest/leaderboard.ts).
// See docs/eval.md.
//
//   node src/playtest/eval.ts --models opus,sonnet,haiku,codex:gpt-5.6-sol [--seats 3] [--games N] [--dry-run]

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runGames } from './games.ts';
import { collect, leaderboard } from './leaderboard.ts';
import { defaultPool } from './slots.ts';

const USAGE = `node src/playtest/eval.ts --models <m1,m2,...> [options]

  --models ...       the roster, 2 or more: claude models (opus, sonnet, haiku, claude-...),
                     Codex models (codex:<model>, e.g. codex:gpt-5.6-sol), or bot
  --seats K          players a game (default 3, at most the roster's size)
  --games N          how many games (default: one round, every lineup of K in every seat order)
  --parallel N       games at once (default 1; see docs/eval.md for why)
  --out DIR          the eval directory (default ~/.cache/board-lite/playtests/<time>-eval-<models>);
                     game i goes in DIR/gi. Rerunning into the same DIR keeps the finished
                     games and plays the rest.
  --budget-usd N     spending cap per Claude seat a game (default 25)
  --seed N           seed of game 1; game i gets N+i-1 (default random per game)
  --effort, --max-minutes, --stall-minutes   passed to every game
  --dry-run          print the games it would play, and play none`;

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help')) { console.log(USAGE); process.exit(0); }

const roster = (opt('--models') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
if (roster.length < 2) { console.log(USAGE); process.exit(1); }
const k = Number(opt('--seats') ?? Math.min(3, roster.length));
if (!Number.isInteger(k) || k < 2 || k > 6) throw new Error('--seats takes 2 to 6.');
if (k > roster.length) throw new Error(`--seats ${k} needs at least ${k} models in --models (a model can be listed twice).`);

// Every lineup of k roster entries, in roster order.
function lineups(n: number, size: number): number[][] {
  if (!size) return [[]];
  const out: number[][] = [];
  for (let first = 0; first <= n - size; first++) for (const rest of lineups(n - first - 1, size - 1)) out.push([first, ...rest.map((r) => r + first + 1)]);
  return out;
}
const all = lineups(roster.length, k);
const round = all.length * k;
const games = Number(opt('--games') ?? round);

// Game i: lineup (i-1) mod L, rotated floor((i-1)/L) seats. Every lineup comes
// up once before any comes up again, so a stopped eval is still balanced, and
// each full round seats every lineup in every seat order.
function seats(i: number): string[] {
  const line = all[(i - 1) % all.length].map((r) => roster[r]);
  const turn = Math.floor((i - 1) / all.length) % k;
  return [...line.slice(turn), ...line.slice(0, turn)];
}

const claudeSeats = Math.max(...Array.from({ length: Math.min(games, round) }, (_, i) => seats(i + 1).filter((m) => m !== 'bot').length));
const atOnce = Math.max(1, Math.min(Number(opt('--parallel') ?? 1), Math.floor(defaultPool().maxSeats / Math.max(1, claudeSeats))));

if (args.includes('--dry-run')) {
  console.log(`${games} games of ${k} (one round is ${round}: ${all.length} lineups x ${k} seat orders), ${atOnce} at a time:`);
  for (let i = 1; i <= games; i++) console.log(`g${i}: ${seats(i).join(', ')}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(opt('--out') ?? join(homedir(), '.cache', 'board-lite', 'playtests', `${stamp}-eval-${roster.join('-').replace(/[:/]/g, '_')}`));
if (out.startsWith('/tmp')) throw new Error('Keep playtests out of /tmp (it is RAM on the dev machine).');
mkdirSync(out, { recursive: true });
const seed = opt('--seed');
const passed = ['--effort', '--max-minutes', '--stall-minutes'].flatMap((o) => (opt(o) === undefined ? [] : [o, opt(o)!]));
console.log(`Eval in ${out}: ${games} games, ${atOnce} at a time.`);
await runGames({
  out,
  games,
  atOnce,
  seats,
  args: (i) => ['--budget-usd', opt('--budget-usd') ?? '25', ...(seed ? ['--seed', String(Number(seed) + i - 1)] : []), ...passed],
});
const text = leaderboard(collect({ dirs: [out], rooms: null }));
writeFileSync(join(out, 'leaderboard.md'), text);
console.log(text);
