// Headless Chrome for the project's tools (screenshots, real-client tests and
// fuzzes, playtests), and clearing away any Chrome a run left behind.
//
// A Chrome started here is driven over a pipe, never a port: when the process
// that started it ends, however it ends (finishing, failing, Ctrl-C, kill -9,
// its tab closing), the kernel closes the pipe and Chrome quits on its own. A
// Chrome started with --remote-debugging-port has nothing tying it to anyone:
// one kept running for 42 hours after its tab closed, holding 7.5 GB (#451).
//
// A script that drives the real clients uses launchChrome() (or playwright's
// chromium.launch(), which also uses a pipe), never a Chrome it starts itself.
//
//   npm run browsers    lists the headless Chromes running, and closes the stray ones
//
// A stray Chrome is a headless one nobody started through a pipe and whose
// starter is gone (it's an orphan), and which no one can still be using: the
// folder it ran in, or its profile, is gone (its tab's worktree or scratchpad
// was removed), or it has run for STRAY_HOURS. sweepBrowsers() closes them;
// screenshot runs call it before they start, and playtests when memory is short.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const STRAY_HOURS = 6; // an orphaned headless Chrome this old is left over, not in use

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

// ---------- starting Chrome ----------

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function findChrome(): string {
  const candidates = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error('No Chrome or Chromium found. Set CHROME=/path/to/chrome.');
  return found;
}

export interface Chrome {
  proc: ChildProcess;
  cdp: Cdp;
  gone: Promise<void>; // Chrome has exited and its profile is removed
  close(): Promise<void>;
}

// Starts a headless Chrome with a profile of its own under `profiles` (a
// folder on disk; the profile is removed when Chrome exits). It's closed when
// this process ends: on exit, on an uncaught error, and on Ctrl-C, SIGTERM or
// SIGHUP (which then end this process, exit code 130). A kill -9 can't be
// caught; the pipe covers that.
export async function launchChrome(profiles: string, extraArgs: string[] = []): Promise<Chrome> {
  // The profile a run killed outright (or ended by an error) left behind: its process is gone.
  for (const name of readdirSync(profiles)) {
    const m = /^chrome-profile-(\d+)-/.exec(name);
    if (m && Number(m[1]) !== process.pid && !alive(Number(m[1]))) rmSync(join(profiles, name), { recursive: true, force: true });
  }
  const profile = mkdtempSync(join(profiles, `chrome-profile-${process.pid}-`));
  const proc = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', // WebGL for the TV's 3D board, on the CPU
    '--disable-gpu-rasterization', // the rest of the page rasterized in software, the same every run
    '--disable-features=BackForwardCache', // a cached page would keep its event stream open, and the browser allows only 6 per host
    ...extraArgs,
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
  const kill = () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
  };
  // However this process ends, Chrome goes with it, now (not only once the pipe closes).
  process.on('exit', kill);
  const onSignal = (sig: NodeJS.Signals) => {
    kill();
    console.error(`\nStopped (${sig}).`);
    void gone.then(() => process.exit(130));
    setTimeout(() => process.exit(130), 5000).unref();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const sig of signals) process.on(sig, onSignal);
  const close = async () => {
    kill();
    await gone;
    process.off('exit', kill);
    for (const sig of signals) process.off(sig, onSignal);
  };

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
  }).catch(async (e) => {
    await close();
    throw e;
  });
  return { proc, cdp, gone, close };
}

// ---------- Chromes left behind ----------

export interface Running {
  pid: number;
  orphan: boolean; // whatever started it has exited
  cwd: string | null; // the folder it runs in, null if gone
  profile: string | null; // its --user-data-dir
  hours: number; // how long it has run
  mb: number; // memory it holds, with its helper processes
  port: string | null; // its --remote-debugging-port
}

// Why a headless Chrome is left over, or null if someone may still be using it.
export function strayReason(c: Running, profileExists: (p: string) => boolean = existsSync): string | null {
  if (!c.orphan) return null; // its starter is still running, and drives it or will close it
  if (c.cwd === null) return 'the folder it ran in is gone';
  if (c.profile !== null && !profileExists(c.profile)) return 'its profile is gone';
  if (c.hours >= STRAY_HOURS) return `it has run for ${Math.floor(c.hours)} hours with whatever started it gone`;
  return null;
}

function procStat(pid: string): string[] | null {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return [pid, s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), ...s.slice(s.lastIndexOf(')') + 2).split(' ')];
  } catch {
    return null;
  }
}

// The headless Chromes this user runs (the browser process of each, not its
// helpers). Linux only: elsewhere there are none to see.
export function headlessChromes(): Running[] {
  if (!existsSync('/proc/self/stat')) return [];
  const uid = process.getuid?.();
  const boot = Date.now() / 1000 - Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  const TICKS = 100; // USER_HZ: 100 on every Linux Node runs on
  const PAGE = 4096;
  const stats = new Map<number, string[]>();
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const st = procStat(pid);
    if (st) stats.set(Number(pid), st);
  }
  const children = new Map<number, number[]>();
  for (const [pid, st] of stats) {
    const ppid = Number(st[3]);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid)!.push(pid);
  }
  const treeMb = (pid: number): number => {
    const own = Number(stats.get(pid)?.[23] ?? 0) * PAGE / 1048576;
    return own + (children.get(pid) ?? []).reduce((n, c) => n + treeMb(c), 0);
  };
  const out: Running[] = [];
  for (const [pid, st] of stats) {
    let args: string[];
    try {
      if (uid !== undefined && statSync(`/proc/${pid}`).uid !== uid) continue;
      args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      // Chrome rewrites its command line as one string, spaces between the arguments: split it before each flag.
      if (args.length === 1) args = args[0].split(/ (?=--)/);
    } catch {
      continue; // gone meanwhile
    }
    if (!args.length || !/chrom|headless_shell/i.test(basename(args[0]))) continue;
    if (!args.some((a) => a.startsWith('--headless')) || args.some((a) => a.startsWith('--type='))) continue;
    const ppid = Number(st[3]);
    const parent = stats.get(ppid)?.[1];
    let cwd: string | null;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd.endsWith(' (deleted)') || !existsSync(cwd)) cwd = null;
    } catch {
      cwd = '?'; // can't tell: not gone as far as we know
    }
    const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
    out.push({
      pid,
      orphan: ppid === 1 || parent === 'systemd' || parent === 'init',
      cwd,
      profile: arg('user-data-dir'),
      hours: (Date.now() / 1000 - (boot + Number(st[21]) / TICKS)) / 3600,
      mb: treeMb(pid),
      port: arg('remote-debugging-port'),
    });
  }
  return out;
}

// Closes every stray headless Chrome (SIGTERM, then SIGKILL if it hasn't gone
// in 5 seconds), and says which and why. Returns them.
export async function sweepBrowsers(log: (line: string) => void = console.log): Promise<(Running & { why: string })[]> {
  const strays = headlessChromes().flatMap((c) => {
    const why = strayReason(c);
    return why ? [{ ...c, why }] : [];
  });
  for (const s of strays) {
    log(`Closed a stray headless Chrome (process ${s.pid}, ${Math.round(s.mb)} MB, running ${s.hours.toFixed(1)} hours): ${s.why}.`);
    try { process.kill(s.pid, 'SIGTERM'); } catch { /* gone already */ }
  }
  const end = Date.now() + 5000;
  while (strays.some((s) => alive(s.pid)) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  for (const s of strays) if (alive(s.pid)) try { process.kill(s.pid, 'SIGKILL'); } catch { /* gone */ }
  return strays;
}

// npm run browsers
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = headlessChromes();
  if (!all.length) console.log('No headless Chrome is running.');
  for (const c of all) {
    const why = strayReason(c);
    console.log(`process ${c.pid}: ${Math.round(c.mb)} MB, running ${c.hours.toFixed(1)} hours${c.port ? `, port ${c.port}` : ''}`
      + `${c.orphan ? '' : ', its starter still running'}${why ? `. Stray: ${why}` : ''}\n  in ${c.cwd ?? '(a folder that is gone)'}${c.profile ? `\n  profile ${c.profile}` : ''}`);
  }
  await sweepBrowsers();
}
