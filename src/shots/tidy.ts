// Where screenshot runs put their output, and clearing it away once nobody
// needs it. Every run's output is a folder under one root on disk (never
// /tmp, which is RAM on the dev machine), named for the checkout that took it
// unless --out names it. Each folder says which checkout it belongs to
// (owner.json). Every run clears away the folders whose checkout is gone (a
// tab's worktree is removed when the tab closes) and those no run has written
// to for KEEP_DAYS, and any Chrome profile a killed run left behind.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const KEEP_DAYS = 7;
const OWNER = 'owner.json';

// The folder a checkout's runs go to by default: its name, and a few
// characters of its path, so two checkouts both called "before" don't share one.
export function defaultName(checkout: string): string {
  return `${basename(checkout)}-${createHash('sha256').update(checkout).digest('hex').slice(0, 6)}`;
}

// --out NAME: a folder under the root, not a path anywhere, so every run's
// output is somewhere the next run clears away.
export function checkName(name: string): string {
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.') || name.endsWith('.previous')) {
    throw new Error(`--out takes a name (letters, digits, - _ .), not a path: "${name}". `
      + 'Runs all go under ~/.cache/board-lite/staged-shots/, where finished work is cleared away.');
  }
  return name;
}

export function claim(dir: string, checkout: string) {
  writeFileSync(join(dir, OWNER), JSON.stringify({ checkout }) + '\n');
}

function owner(dir: string): string | null {
  try {
    return JSON.parse(readFileSync(join(dir, OWNER), 'utf8')).checkout ?? null;
  } catch {
    return null;
  }
}

// Clears the root of what no one needs, sparing the folders in `keep`. Call
// it only while holding the run's turn (turn.ts): then no other run is using
// any of it. Returns what it removed.
export function tidy(root: string, keep: string[], now = Date.now()): string[] {
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (!entry.isDirectory() || entry.name === 'rooms' || keep.includes(path)) continue;
    let stale: boolean;
    if (entry.name.startsWith('chrome-profile-')) stale = true; // only one run goes at a time, and it hasn't started Chrome yet
    else {
      const checkout = owner(path);
      stale = (checkout !== null && !existsSync(checkout)) || now - statSync(path).mtimeMs > KEEP_DAYS * 86400000;
    }
    if (stale) {
      rmSync(path, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}
