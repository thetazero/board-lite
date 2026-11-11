// Runs numbered playtest games (run.ts) into <out>/g<i>, as many at a time as
// free memory can seat (up to the plan's atOnce), for batch.ts and eval.ts. A game that finished is kept; one that didn't is moved
// aside to g<i>.failed<n> and played again.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPool, holders, seatsThatFit } from './slots.ts';

const runner = fileURLToPath(new URL('./run.ts', import.meta.url));

function done(dir: string): boolean {
  const f = join(dir, 'results.json');
  return existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).status === 'over';
}

export interface Plan {
  out: string;
  games: number;
  /** Game i's seats, in seat order (i from 1). */
  seats: (i: number) => string[];
  /** Game i's other run.ts options. */
  args: (i: number) => string[];
  /** At most this many games run at once (Infinity: as many as free memory can seat). */
  atOnce: number;
}

const pool = defaultPool();
const waiting = new Set<number>(); // pids of our games that haven't taken their slots yet

function runGame(plan: Plan, i: number): Promise<void> {
  const dir = join(plan.out, `g${i}`);
  if (done(dir)) return Promise.resolve();
  // A game that didn't finish starts over in a fresh directory; keep the old one beside it.
  if (existsSync(dir)) {
    let n = 1;
    while (existsSync(`${dir}.failed${n}`)) n++;
    renameSync(dir, `${dir}.failed${n}`);
  }
  const seats = plan.seats(i);
  const argv = [runner, '--models', seats.join(','), '--out', dir, ...plan.args(i)];
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

/**
 * Whether game i can start beside the running ones. Not while one of ours is
 * still waiting for its slots, so one check can't start many; otherwise when
 * free memory can seat it (run.ts waits for its slots anyway, but a game
 * started early would only sit waiting).
 */
function roomFor(plan: Plan, i: number, running: number): boolean {
  if (running === 0) return true;
  if (running >= plan.atOnce) return false;
  const held = holders(pool);
  for (const pid of waiting) if (held.some((h) => h.pid === pid)) waiting.delete(pid);
  if (waiting.size > 0) return false;
  return seatsThatFit(pool, held) >= plan.seats(i).filter((m) => m !== 'bot').length;
}

/** Plays every game of the plan not already finished; Ctrl-C lets the running ones end and starts no more. */
export async function runGames(plan: Plan): Promise<void> {
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  const running = new Set<Promise<void>>();
  for (let i = 1; i <= plan.games && !stopping;) {
    if (roomFor(plan, i, running.size)) {
      const g = runGame(plan, i++);
      running.add(g);
      void g.then(() => running.delete(g));
    } else {
      await Promise.race([...running, new Promise((r) => setTimeout(r, 15000))]);
    }
  }
  await Promise.all(running);
}
