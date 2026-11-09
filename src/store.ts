// The game file on disk: load, save and a lock, shared by the CLI and the
// playtest player server so several processes can play one game.

import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Game } from './engine.ts';

export function sleepMs(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10000) unlinkSync(lock); // stale lock
      } catch { /* gone already */ }
      if (Date.now() - start > 30000) throw new Error(`Timed out waiting for ${lock}`);
      sleepMs(20);
    }
  }
  try {
    return fn();
  } finally {
    try { unlinkSync(lock); } catch { /* ignore */ }
  }
}

export function load(file: string): Game {
  if (!existsSync(file)) throw new Error(`No game at ${file}. Start one with: board-lite new ${file}`);
  return upgrade(JSON.parse(readFileSync(file, 'utf8')) as Game);
}

// Brings a game saved by an older version up to date, in place.
export function upgrade(g: Game): Game {
  // The desert was called plains before.
  for (const h of Object.values(g.map ?? {})) if ((h.terrain as string) === 'plains') h.terrain = 'desert';
  return g;
}

export function save(file: string, g: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(g));
  renameSync(tmp, file);
}
