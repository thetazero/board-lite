// Runs numbered playtest games (run.ts) into <out>/g<i>, a few at a time, for
// batch.ts and eval.ts. A game that finished is kept; one that didn't is moved
// aside to g<i>.failed<n> and played again.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  /** How many games run at once. */
  atOnce: number;
}

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
    p.stdout.pipe(log);
    p.stderr.pipe(log);
    p.on('exit', () => {
      const f = join(dir, 'results.json');
      console.log(`g${i}: ${existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).status : 'no results'}`);
      res();
    });
  });
}

/** Plays every game of the plan not already finished; Ctrl-C lets the running ones end and starts no more. */
export async function runGames(plan: Plan): Promise<void> {
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  let next = 1;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(plan.atOnce, plan.games)) }, async () => {
    while (next <= plan.games && !stopping) await runGame(plan, next++);
  }));
}
