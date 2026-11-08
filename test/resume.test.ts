import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { budgetUsd, readState, stateFile } from '../src/playtest/resume.ts';

function dir(): string {
  const base = join(homedir(), '.cache', 'board-lite');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, 'test-resume-'));
}

// A --room runner from before runner.json: what it left is enough to come back.
test('a stopped runner with no runner.json resumes from what it left behind', () => {
  const out = dir();
  try {
    mkdirSync(join(out, 'seat-1'));
    writeFileSync(join(out, 'seat-1', 'mcp.json'), JSON.stringify({ mcpServers: { game: { args: ['seat-server.ts', 'http://localhost:8080/GZJH', 'tok1', 'moves'] } } }));
    writeFileSync(join(out, 'seat-1.jsonl'), '{"type":"system","subtype":"init","session_id":"sess-1"}\n{"type":"assistant","session_id":"sess-1"}\n');
    writeFileSync(join(out, 'results.json'), JSON.stringify({ status: 'low memory', room: 'http://localhost:8080/GZJH', seats: [{ seat: 'P1', model: 'opus', costUsd: 0.5, starts: 1 }, { seat: 'P2', model: 'player: losha' }] }));
    const s = readState(out);
    assert.equal(s.room, 'http://localhost:8080/GZJH');
    assert.equal(s.hosted, false);
    assert.deepEqual(s.seats, [{ p: 0, model: 'opus', token: 'tok1', session: 'sess-1', starts: 1, cost: 0.5 }]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a Claude player that never started comes back as a fresh start', () => {
  const out = dir();
  try {
    mkdirSync(join(out, 'seat-2'));
    writeFileSync(join(out, 'seat-2', 'mcp.json'), JSON.stringify({ mcpServers: { game: { args: ['s', 'http://h/ABCD', 'tok2'] } } }));
    writeFileSync(join(out, 'runner.log'), '00:00:00 P2 (haiku) starts.\n');
    writeFileSync(join(out, 'game.json'), '{}');
    const s = readState(out);
    assert.equal(s.hosted, true);
    assert.deepEqual(s.seats, [{ p: 1, model: 'haiku', token: 'tok2', session: '', starts: 0, cost: 0 }]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('runner.json wins, and a directory with no Claude player has nothing to resume', () => {
  const out = dir();
  try {
    assert.throws(() => readState(out), /Nothing to resume/);
    const saved = { room: 'http://h/ABCD', hosted: false, seats: [{ p: 0, model: 'opus', token: 't', session: 's', starts: 3, cost: 1 }] };
    writeFileSync(stateFile(out), JSON.stringify(saved));
    assert.deepEqual(readState(out), saved);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the budget: $30 in a room, $5 for a hosted playtest, and resuming keeps the one the runner had', () => {
  assert.equal(budgetUsd(undefined, null, true), 30);
  assert.equal(budgetUsd(undefined, null, false), 5);
  assert.equal(budgetUsd('12', null, true), 12);
  const seats = [{ p: 1, model: 'opus', token: 't', session: 's', starts: 4, cost: 6.8 }];
  // Continue starts the runner again with only --resume and --room.
  assert.equal(budgetUsd(undefined, { room: 'http://h/ABCD', hosted: false, budget: 15, seats }, true), 15);
  assert.equal(budgetUsd('40', { room: 'http://h/ABCD', hosted: false, budget: 15, seats }, true), 40);
  // A runner from before runner.json kept its budget: a player past $5 still plays on.
  assert.ok(budgetUsd(undefined, { room: 'http://h/ABCD', hosted: false, seats }, true) > seats[0].cost);
});
