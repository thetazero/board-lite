// A headless Chrome driven over the DevTools protocol, for the screenshot
// tools (shots.ts, motion.ts): Node's own pipes, no dependencies.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

// ---------- a minimal DevTools protocol client ----------

export class Cdp {
  private id = 0;
  private pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private handlers: ((method: string, params: any, session?: string) => void)[] = [];
  private buf = '';
  private out: Writable;
  // Chrome's --remote-debugging-pipe: it reads commands on its fd 3 and writes on its fd 4, each message ended by a NUL.
  constructor(out: Writable, input: Readable) {
    this.out = out;
    input.setEncoding('utf8');
    input.on('data', (d: string) => {
      const parts = (this.buf + d).split('\0');
      this.buf = parts.pop()!;
      for (const p of parts) this.receive(JSON.parse(p));
    });
    // Chrome gone: nothing pending will ever be answered.
    input.on('close', () => {
      for (const p of this.pending.values()) p.fail(new Error('Chrome closed its DevTools pipe'));
      this.pending.clear();
    });
  }

  private receive(m: any) {
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.fail(new Error(`${m.error.message} ${m.error.data ?? ''}`));
      else p.ok(m.result);
    } else for (const h of this.handlers) h(m.method, m.params, m.sessionId);
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    if (process.env.CDP_DEBUG) console.error('>', id, method, JSON.stringify(params).slice(0, 120));
    this.out.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }

  on(fn: (method: string, params: any, session?: string) => void) {
    this.handlers.push(fn);
  }
}

function findChrome(): string {
  const candidates = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error('No Chrome or Chromium found. Set CHROME=/path/to/chrome.');
  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Chrome is driven over a pipe, not a port: when this process ends, however it
// ends (Ctrl-C, kill -9, its tab closing), the kernel closes our end and
// Chrome quits on its own. A port would leave it running, holding a gigabyte.
export async function launchChrome(cache: string): Promise<{ proc: ChildProcess; cdp: Cdp; gone: Promise<void> }> {
  // A profile of its own, so runs from several worktrees at once don't collide.
  // Named by this run's process, so the next run can clear away the profile of a run that was killed outright.
  mkdirSync(cache, { recursive: true });
  for (const dir of readdirSync(cache)) {
    const pid = /^chrome-profile-(\d+)-/.exec(dir)?.[1];
    if (pid && !alive(Number(pid))) rmSync(join(cache, dir), { recursive: true, force: true });
  }
  const profile = mkdtempSync(join(cache, `chrome-profile-${process.pid}-`));
  const proc = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', // WebGL for the TV's 3D board, on the CPU
    '--disable-gpu-rasterization', // the rest of the page rasterized in software, the same every run
    '--disable-features=BackForwardCache', // a cached page would keep its event stream open, and the browser allows only 6 per host
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  // Chrome's helper processes can still be writing the profile for a moment after it exits.
  const gone = new Promise<void>((ok) => {
    const removeProfile = (tries: number) => {
      try {
        rmSync(profile, { recursive: true, force: true });
        ok();
      } catch (e) {
        if (tries > 0) setTimeout(() => removeProfile(tries - 1), 300);
        else {
          console.error(`Couldn't remove Chrome's profile ${profile}: ${(e as Error).message}`);
          ok();
        }
      }
    };
    proc.on('exit', () => removeProfile(10));
  });
  let err = '';
  proc.stderr!.on('data', (d) => (err += d));
  const cdp = new Cdp(proc.stdio[3] as Writable, proc.stdio[4] as Readable);
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`Chrome didn't start:\n${err}`)), 20000);
    cdp.send('Browser.getVersion').then(() => {
      clearTimeout(timer);
      ok();
    }, () => {});
    proc.on('exit', () => {
      clearTimeout(timer);
      fail(new Error(`Chrome exited:\n${err}`));
    });
  }).catch((e) => {
    proc.kill();
    throw e;
  });
  return { proc, cdp, gone };
}
