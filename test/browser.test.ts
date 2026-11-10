import { after, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { findChrome, headlessChromes, STRAY_HOURS, strayReason, sweepBrowsers, type Running } from '../src/browser.ts';

const base: Running = { pid: 1234, orphan: true, cwd: '/home/x/work', profile: '/home/x/prof', hours: 1, mb: 800, port: '9333' };
const exists = () => true;

describe('a stray headless Chrome', () => {
  test('one whose starter still runs is never stray', () => {
    assert.equal(strayReason({ ...base, orphan: false, cwd: null, hours: 100 }, () => false), null);
  });
  test('an orphan whose folder is gone is stray (its tab\'s worktree was removed)', () => {
    assert.match(strayReason({ ...base, cwd: null }, exists)!, /folder it ran in is gone/);
  });
  test('an orphan whose profile is gone is stray', () => {
    assert.match(strayReason(base, () => false)!, /profile is gone/);
  });
  test(`an orphan running ${STRAY_HOURS} hours is stray; a fresh one may still be in use`, () => {
    assert.equal(strayReason(base, exists), null);
    assert.match(strayReason({ ...base, hours: 42 }, exists)!, /42 hours/);
  });
});

let chrome: string | null = null;
try { chrome = findChrome(); } catch { /* none here */ }
const linux = process.platform === 'linux';
const skip = !chrome || !linux ? 'needs Chrome, on Linux' : false;

const work = join(homedir(), '.cache', 'board-lite', 'test-browser'); // on disk, not /tmp
const BROWSER = resolve(import.meta.dirname, '..', 'src', 'browser.ts');
const gone = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };
async function until(cond: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return cond();
}

// A script that starts Chrome through launchChrome(), prints its pid, then ends as `how` says.
async function run(how: 'throw' | 'kill -9' | 'SIGTERM' | 'SIGHUP'): Promise<number> {
  mkdirSync(work, { recursive: true });
  const script = `
    import { launchChrome } from ${JSON.stringify(BROWSER)};
    const c = await launchChrome(${JSON.stringify(work)});
    console.log(c.proc.pid);
    ${how === 'throw' ? 'setTimeout(() => { throw new Error("the run failed"); }, 200);' : 'setInterval(() => {}, 1000);'}
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const pid = await new Promise<number>((ok, fail) => {
    child.stdout.on('data', (d) => ok(Number(String(d).trim())));
    child.on('exit', () => fail(new Error('the script ended before Chrome started')));
  });
  assert.ok(!gone(pid), 'Chrome is running');
  if (how === 'kill -9') child.kill('SIGKILL');
  else if (how !== 'throw') child.kill(how);
  return pid;
}

describe('a Chrome a run starts goes when the run ends', { skip }, () => {
  after(() => rmSync(work, { recursive: true, force: true, maxRetries: 5 }));
  for (const how of ['throw', 'kill -9', 'SIGTERM', 'SIGHUP'] as const) {
    test(`when the run ${how === 'throw' ? 'fails' : `gets ${how}`}`, async () => {
      const pid = await run(how);
      assert.ok(await until(() => gone(pid)), `Chrome ${pid} still running`);
    });
  }

  test('an orphaned Chrome on a port, whose folder is removed, is swept', async () => {
    const dir = mkdtempSync(join(work, 'tab-')); // the folder it runs in, as a tab's worktree
    const prof = mkdtempSync(join(work, 'prof-')); // its profile, elsewhere (removing the folder then doesn't race Chrome writing it)
    // As a tab might: started in the background from a shell that then exits, so nothing holds it.
    const sh = spawnSync('sh', ['-c', `cd "${dir}" && "${chrome}" --headless=new --remote-debugging-port=0 --user-data-dir="${prof}" about:blank >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' });
    const pid = Number(sh.stdout.trim());
    try {
      assert.ok(await until(() => existsSync(join(prof, 'Default')) && headlessChromes().some((c) => c.pid === pid && c.orphan)), 'Chrome seen as an orphan');
      assert.equal(strayReason(headlessChromes().find((c) => c.pid === pid)!), null, 'still in use while its folder is there');
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      const swept = await sweepBrowsers(() => {});
      assert.match(swept.find((s) => s.pid === pid)?.why ?? '', /folder it ran in is gone/);
      assert.ok(await until(() => gone(pid)), `Chrome ${pid} still running`);
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      await until(() => gone(pid));
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      rmSync(prof, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
