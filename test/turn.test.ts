import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { takeTurn, type Holder } from '../src/shots/turn.ts';

// npm run shots: one run at a time on the machine, the others wait.
test('a second screenshot run waits for the first, says so once, then goes', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'turn-')), 'run.lock');
  const release = await takeTurn(file, () => assert.fail('the first run has nobody to wait for'), 10);
  const waits: Holder[] = [];
  let second = false;
  const next = takeTurn(file, (h) => waits.push(h), 10).then((r) => ((second = true), r));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(second, false, 'the second run waits');
  assert.equal(waits.length, 1, 'and says so, once');
  assert.equal(waits[0].pid, process.pid);
  release();
  (await next)();
  assert.equal(second, true, 'it goes once the first is done');
  assert.equal(existsSync(file), false, 'and leaves no turn behind');
});

test("a run killed outright doesn't hold the turn", async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'turn-')), 'run.lock');
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  writeFileSync(file, JSON.stringify({ pid: Number(gone.stdout), started: null, cwd: '/', args: '', since: 0 }));
  const release = await takeTurn(file, () => assert.fail("a dead run isn't waited for"), 10);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
  release();
});
