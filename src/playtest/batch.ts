#!/usr/bin/env node
// Runs a batch of playtest games, the same models rotated one seat per game so
// each model sits in every seat equally often, then writes the batch's win
// rates and stats to summary.md. See "Depth batches" in docs/playtest.md.
//
//   node src/playtest/batch.ts --games 30 --models opus,haiku,haiku [--out DIR] [run.ts options]
//   node src/playtest/batch.ts --summary DIR

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPool, holders, seatsThatFit } from './slots.ts';
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

// Start a game only when free memory can seat it: the rest would just sit
// waiting (run.ts waits for its slots anyway). Games started but not yet
// holding their slots count against what's free, so one check can't start many.
const claudeSeats = models.filter((m) => m !== 'bot').length;
const pool = defaultPool();
const waiting = new Set<number>(); // pids of our games that haven't taken their slots yet
const runner = fileURLToPath(new URL('./run.ts', import.meta.url));

function done(dir: string): boolean {
  const f = join(dir, 'results.json');
  return existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).status === 'over';
}

function runGame(i: number): Promise<void> {
  const dir = join(out, `g${i}`);
  if (done(dir)) return Promise.resolve();
  // A game that didn't finish starts over in a fresh directory; keep the old one beside it.
  if (existsSync(dir)) {
    let n = 1;
    while (existsSync(`${dir}.failed${n}`)) n++;
    renameSync(dir, `${dir}.failed${n}`);
  }
  const r = (i - 1) % models.length;
  const seats = [...models.slice(r), ...models.slice(0, r)];
  const argv = [runner, '--models', seats.join(','), '--out', dir, ...(seed ? ['--seed', String(Number(seed) + i - 1)] : []), ...passed];
  console.log(`g${i}: ${seats.join(', ')}`);
  return new Promise((res) => {
    const log = createWriteStream(`${dir}.out`);
    const p = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (p.pid) waiting.add(p.pid);
    p.stdout.pipe(log);
    p.stderr.pipe(log);
    p.on('exit', () => {
      if (p.pid) waiting.delete(p.pid);
      const f = join(dir, 'results.json');
      console.log(`g${i}: ${existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).status : 'no results'}`);
      res();
    });
  });
}

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
const running = new Set<Promise<void>>();
function roomForAnother(): boolean {
  if (running.size === 0) return true;
  const held = holders(pool);
  for (const pid of waiting) if (held.some((h) => h.pid === pid)) waiting.delete(pid);
  if (waiting.size > 0) return false; // one of ours is still waiting: let it go first
  return seatsThatFit(pool, held) >= claudeSeats;
}
for (let i = 1; i <= games && !stopping;) {
  if (roomForAnother()) {
    const g = runGame(i++);
    running.add(g);
    void g.then(() => running.delete(g));
  } else {
    await Promise.race([...running, new Promise((r) => setTimeout(r, 15000))]);
  }
}
await Promise.all(running);
writeSummary(out);
