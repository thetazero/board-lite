// Machine-wide seat slots for playtests. Every Claude seat is a `claude -p`
// process of a few hundred MB, and several tabs may run batches at once, so a
// game takes one slot per Claude seat from a pool shared by every playtest on
// the machine before it starts any of them, and waits while the pool is full or
// free memory is short. See "How many games run at once" in docs/playtest.md.

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withLock } from '../store.ts';

export const SEAT_MB = 450; // one claude -p process plus its seat server, measured at 300-400 MB
export const RESERVE_MB = 2048; // free memory a new game must leave for everything else
export const FLOOR_MB = 1024; // below this, running games stop rather than risk an OOM

export interface Pool { dir: string; maxSeats: number; memAvailableMb: () => number }

export function defaultPool(): Pool {
  return {
    dir: process.env.BOARD_LITE_SLOTS_DIR ?? join(homedir(), '.cache', 'board-lite', 'seat-slots'),
    maxSeats: Number(process.env.BOARD_LITE_MAX_SEATS ?? 6),
    memAvailableMb,
  };
}

export function memAvailableMb(): number {
  try {
    const m = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (m) return Number(m[1]) / 1024;
  } catch { /* not Linux */ }
  return Infinity;
}

export interface Holder { pid: number; seats: number; out: string; since: string }

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Live holders of the pool; files left by dead processes are removed. */
export function holders(pool: Pool): Holder[] {
  mkdirSync(pool.dir, { recursive: true });
  const live: Holder[] = [];
  for (const f of readdirSync(pool.dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const h = JSON.parse(readFileSync(join(pool.dir, f), 'utf8')) as Holder;
      if (alive(h.pid)) live.push(h);
      else unlinkSync(join(pool.dir, f));
    } catch { /* half-written or already gone */ }
  }
  return live;
}

/**
 * Takes `seats` slots for this process if they fit right now, and says why not
 * otherwise. Check and take happen under one lock, so two games can't both
 * squeeze into the last slots.
 */
export function tryAcquire(pool: Pool, seats: number, out: string): { ok: true } | { ok: false; why: string } {
  if (seats > pool.maxSeats) throw new Error(`This game has ${seats} Claude seats but at most ${pool.maxSeats} may run at once (BOARD_LITE_MAX_SEATS).`);
  if (seats === 0) return { ok: true };
  mkdirSync(pool.dir, { recursive: true });
  return withLock(join(pool.dir, 'pool'), () => {
    const held = holders(pool).filter((h) => h.pid !== process.pid);
    const used = held.reduce((n, h) => n + h.seats, 0);
    if (used + seats > pool.maxSeats) {
      return { ok: false as const, why: `${used} of ${pool.maxSeats} seat slots in use (${held.map((h) => h.out).join(', ')})` };
    }
    const free = pool.memAvailableMb();
    if (free - seats * SEAT_MB < RESERVE_MB) {
      return { ok: false as const, why: `${Math.round(free)} MB free; ${seats} seats need ${seats * SEAT_MB} MB plus ${RESERVE_MB} MB to spare` };
    }
    const h: Holder = { pid: process.pid, seats, out, since: new Date().toISOString() };
    writeFileSync(join(pool.dir, `${process.pid}.json`), JSON.stringify(h));
    return { ok: true as const };
  });
}

export function release(pool: Pool) {
  try { unlinkSync(join(pool.dir, `${process.pid}.json`)); } catch { /* not held */ }
}
