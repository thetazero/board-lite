import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RESERVE_MB, SEAT_MB, holders, release, seatsThatFit, tryAcquire, type Pool } from '../src/playtest/slots.ts';

function pool(maxSeats: number, freeMb = 100000): Pool {
  const base = join(homedir(), '.cache', 'board-lite');
  mkdirSync(base, { recursive: true });
  return { dir: mkdtempSync(join(base, 'test-slots-')), maxSeats, memAvailableMb: () => freeMb };
}

function holder(p: Pool, pid: number, seats: number) {
  writeFileSync(join(p.dir, `${pid}.json`), JSON.stringify({ pid, seats, out: `game-${pid}`, since: '' }));
}

test('a game waits while other games hold the machine-wide seat slots', () => {
  const p = pool(6);
  try {
    holder(p, process.ppid, 4); // another live playtest
    const r = tryAcquire(p, 3, 'mine');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.why : '', /4 of 6 seat slots in use/);
    assert.equal(tryAcquire(p, 2, 'mine').ok, true);
    assert.equal(holders(p).reduce((n, h) => n + h.seats, 0), 6);
    release(p);
    assert.equal(holders(p).length, 1);
  } finally {
    rmSync(p.dir, { recursive: true, force: true });
  }
});

test('slots held by dead processes are freed', () => {
  const p = pool(3);
  try {
    holder(p, 2 ** 22 + 12345, 3); // above Linux's pid_max, so never alive
    assert.equal(tryAcquire(p, 3, 'mine').ok, true);
    assert.deepEqual(readdirSync(p.dir).filter((f) => f.endsWith('.json')), [`${process.pid}.json`]);
    release(p);
  } finally {
    rmSync(p.dir, { recursive: true, force: true });
  }
});

test('a game waits while free memory is short, and too-big games are refused', () => {
  const p = pool(6, RESERVE_MB + 2 * SEAT_MB);
  try {
    const r = tryAcquire(p, 3, 'mine');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.why : '', /MB free/);
    assert.equal(tryAcquire(p, 2, 'mine').ok, true);
    release(p);
    assert.throws(() => tryAcquire(p, 7, 'mine'), /at most 6/);
  } finally {
    rmSync(p.dir, { recursive: true, force: true });
  }
});

test('with no cap, as many seats start as free memory allows, keeping the reserve', () => {
  const p = pool(Infinity, RESERVE_MB + 10 * SEAT_MB);
  try {
    holder(p, process.ppid, 4); // started long ago: its memory already shows in MemAvailable
    assert.equal(seatsThatFit(p), 10);
    assert.equal(tryAcquire(p, 10, 'mine').ok, true);
    release(p);
    const r = tryAcquire(p, 11, 'mine');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.why : '', /MB free/);
  } finally {
    rmSync(p.dir, { recursive: true, force: true });
  }
});

test('a game that just took its slots counts against free memory while its seats start', () => {
  const p = pool(Infinity, RESERVE_MB + 10 * SEAT_MB);
  try {
    writeFileSync(join(p.dir, `${process.ppid}.json`), JSON.stringify({ pid: process.ppid, seats: 4, out: 'new', since: new Date().toISOString() }));
    assert.equal(seatsThatFit(p), 6);
    assert.equal(tryAcquire(p, 7, 'mine').ok, false);
    assert.equal(tryAcquire(p, 6, 'mine').ok, true);
    release(p);
  } finally {
    rmSync(p.dir, { recursive: true, force: true });
  }
});
