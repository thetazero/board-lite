// Screenshots of the TV and phone clients in staged game situations, for
// tuning how the game looks. One command, one headless Chrome, the real
// server and clients:
//
//   npm run shots -- --only NAME[,NAME...] [--every-size] [--out NAME]
//   npm run shots -- --list [--only NAME]   (what there is to shoot; no Chrome)
//   npm run shots -- --all [--every-size]   (everything: hundreds of images)
//
// A run takes the shots it's asked for: --only picks shots by their file or
// scene name, so checking a change shoots the screens it touched.
//
// Each scene in scenes.ts becomes a room on a private server (every seat a
// player nobody drives, so nothing moves on its own). Chrome is driven over
// the DevTools protocol with Node's own WebSocket: no dependencies. The page
// clock is frozen and CSS animations are off, so a scene renders the same
// on every run. The run goes to ~/.cache/board-lite/staged-shots/<checkout>
// (the last run moves to <checkout>.previous) with an index.html contact sheet
// that marks what changed since the previous run. Shots are WebP, a tenth of a
// PNG's size, and one the same as the previous run's is a link to that file,
// not a copy. Finished work is cleared away (tidy.ts). Only one run goes at a
// time on the machine (turn.ts): one started meanwhile waits for it, and says so.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { Room, seatsFile } from '../server/room.ts';
import { startServer } from '../server/server.ts';
import { save } from '../store.ts';
import { NAMES, picked, SCENES, stage, type Shot, type Staged } from './scenes.ts';
import { checkName, claim, defaultName, KEEP_DAYS, tidy } from './tidy.ts';
import { takeTurn } from './turn.ts';

const CACHE = join(homedir(), '.cache', 'board-lite', 'staged-shots'); // on disk: /tmp is RAM on the dev machine
const CHECKOUT = resolve(import.meta.dirname, '..', '..'); // the checkout whose clients are shot
const QUALITY = 85; // WebP: text and edges stay sharp; a PNG is ten times the size
interface Device { width: number; height: number; deviceScaleFactor: number; mobile: boolean }
const TV: Device = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
const PHONE: Device = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
// The other screens a shot with `sizes` (or every shot, with --every-size) is also taken at: the suffix on its file, and the screen.
const SIZES: Record<'tv' | 'phone', [string, Device][]> = {
  tv: [['720p', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }]],
  phone: [
    ['360', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true }], // a common Android phone
    ['320', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true }], // the smallest phones still around (iPhone SE, 1st generation)
    ['landscape', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true }], // the 390 phone turned sideways
    ['tablet', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true }], // an iPad Air, upright
  ],
};
const MAX_SCREENS = 4; // a long phone page is shot one screen at a time, scrolling down: at most this many
// On a phone screen, the page's text and buttons the hand of cards sits over:
// the hand is fixed to the bottom edge, so it must never sit over anything
// (a card held open or the talk sheet open covers everything anyway).
const COVERED = `(() => {
  const cards = [...document.querySelectorAll('.handfan .card:not(.peek)')].map((c) => c.getBoundingClientRect()).filter((r) => r.height);
  if (!cards.length || document.querySelector('.zoom, .talkbar.open, .menu')) return []; // a sheet over the hand
  const hits = new Set();
  for (const el of document.querySelectorAll('#app *')) {
    if (el.closest('.handfan, .talkbar, .toast')) continue;
    if (el.children.length && !el.matches('button, input, select')) continue; // the things you read and tap, not their boxes
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight) continue;
    if (cards.some((c) => Math.min(r.right, c.right) - Math.max(r.left, c.left) > 2 && Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top) > 2)) {
      const b = el.closest('button') ?? el;
      hits.add((b.id ? '#' + b.id : b.tagName.toLowerCase() + (b.className && typeof b.className === 'string' ? '.' + b.className.split(' ')[0] : '')) + (b.textContent.trim() ? ' "' + b.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30) + '"' : ''));
    }
  }
  return [...hits];
})()`;
const FROZEN_NOW = Date.UTC(2026, 0, 1, 20, 0, 0); // the page's clock
const LAN = { lan: ['192.168.1.20'], tailscale: [] as string[], port: 8080 }; // the address the TV shows
const TAILSCALE = ['100.86.12.40']; // and its Tailscale address, for shots with `tailscale`

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// ---------- a minimal DevTools protocol client ----------

class Cdp {
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

// Chrome is driven over a pipe, not a port: when this process ends, however it
// ends (Ctrl-C, kill -9, its tab closing), the kernel closes our end and
// Chrome quits on its own. A port would leave it running, holding a gigabyte.
async function launchChrome(): Promise<{ proc: ChildProcess; cdp: Cdp; gone: Promise<void> }> {
  // A profile of its own, so runs from several worktrees at once don't collide.
  // The next run clears away the profile of a run that was killed outright (tidy.ts).
  const profile = mkdtempSync(join(CACHE, `chrome-profile-${process.pid}-`));
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

// ---------- a browser tab ----------

// Runs before every page's own scripts: a frozen clock (the 3D board's too),
// no animations, a fresh phone (no remembered seat; a seat comes in the address).
const PAGE_SETUP = `
  Date.now = () => ${FROZEN_NOW};
  window.boardClock = 0;
  try { localStorage.clear(); } catch {}
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
    document.head.append(s);
  });
`;

class Tab {
  info = LAN; // what /api/info answers: the addresses the TV shows
  noScript = false; // the page's own script fails to load, so it stays on its first screen
  private cdp: Cdp;
  private session: string;
  private constructor(cdp: Cdp, session: string) {
    this.cdp = cdp;
    this.session = session;
  }

  static async open(cdp: Cdp): Promise<Tab> {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(cdp, sessionId);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Network.enable');
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SETUP });
    // The TV shows this machine's network address; show a fixed one instead.
    await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/info' }, { urlPattern: '*.ts' }] });
    cdp.on((method, params, session) => {
      if (session !== sessionId) return;
      if (method === 'Fetch.requestPaused' && /\.ts$/.test(new URL(params.request.url).pathname)) {
        void tab.send(tab.noScript ? 'Fetch.failRequest' : 'Fetch.continueRequest', tab.noScript ? { requestId: params.requestId, errorReason: 'Failed' } : { requestId: params.requestId });
      } else if (method === 'Fetch.requestPaused') {
        void tab.send('Fetch.fulfillRequest', {
          requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(tab.info)).toString('base64'),
        });
      }
      if (method === 'Runtime.exceptionThrown') console.error(`  page error: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`);
    });
    return tab;
  }

  send(method: string, params: object = {}): Promise<any> {
    return this.cdp.send(method, params, this.session);
  }

  async eval<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  async waitFor(expr: string, what: string, ms = 8000) {
    const end = Date.now() + ms;
    while (!(await this.eval<boolean>(`!!(${expr})`))) {
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await sleep(30);
    }
  }

  // Waits for a selector, then stops every timer the page has, in the same
  // task: a timed banner can't close between the match and the shot.
  async hold(selector: string, ms: number) {
    const ok = await this.eval<boolean>(`new Promise((r) => {
      const end = performance.now() + ${ms};
      const tick = () => {
        if (document.querySelector(${JSON.stringify(selector)})) {
          const top = setTimeout(() => {});
          for (let i = 1; i <= top; i++) { clearTimeout(i); clearInterval(i); }
          r(true);
        } else if (performance.now() > end) r(false);
        else setTimeout(tick, 30);
      };
      tick();
    })`);
    if (!ok) throw new Error(`Timed out waiting for ${selector}`);
  }

  // Two animation frames: the last DOM change is painted.
  settle() {
    return this.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  }

  // Opens a page as a fresh device would. `storage`: what that browser
  // remembers (set after the page setup clears it). `loading`: the page's
  // script never runs, so it stays on what a slow connection shows first.
  async load(url: string, device: Device, opts: { storage?: Record<string, string>; loading?: boolean } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', device);
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: device.mobile });
    this.noScript = !!opts.loading;
    const entries = Object.entries(opts.storage ?? {});
    const script = entries.length
      ? (await this.send('Page.addScriptToEvaluateOnNewDocument', { source: entries.map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') })).identifier
      : null;
    try {
      await this.send('Page.navigate', { url });
      if (opts.loading) {
        await sleep(300);
        return;
      }
      await this.waitFor(`document.readyState === 'complete' && document.querySelector('#app') && !document.querySelector('#app .loading')`, `${url} to render`);
    } finally {
      if (script) await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    }
    await this.eval('document.fonts.ready.then(() => true)');
    await this.settle();
  }

  async click(selector: string) {
    const ok = await this.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`Nothing to tap: ${selector}`);
    await sleep(60); // taps that send a command wait for the server's push
    await this.settle();
  }

  // Puts a finger down on an element and slides it (dx, dy), without letting go.
  async press(selector: string, dx: number, dy: number) {
    const ok = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(12, r.width / 2), y = r.top + r.height / 2;
      const at = (type, t, cx, cy) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy }));
      at('pointerdown', el, x, y);
      for (let i = 1; i <= 4; i++) at('pointermove', document, x + ${dx} * i / 4, y + ${dy} * i / 4);
      return true;
    })()`);
    if (!ok) throw new Error(`Nothing to press: ${selector}`);
    await this.settle();
  }

  // Types into an input the way a person would, so the page sees it as typed.
  async type(selector: string, value: string) {
    const ok = await this.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`Nothing to type into: ${selector}`);
  }

  async offline(on: boolean) {
    await this.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  // What the screen shows. A phone page longer than its screen is shot one
  // screen at a time, scrolled the way a thumb would, so the fixed parts (the
  // hand, the talk bar, a card held open) sit where they sit on a real phone.
  // (Shooting the whole page at once stretches the screen to the page's
  // height, and everything sized against the screen grows with it.)
  // Each screen comes with what the phone's hand of cards sits over, if anything (COVERED).
  async images(device: Device): Promise<{ image: Buffer; covered: string[] }[]> {
    const shoot = async () => ({
      image: Buffer.from((await this.send('Page.captureScreenshot', { format: 'webp', quality: QUALITY })).data, 'base64'),
      covered: device.mobile ? await this.eval<string[]>(COVERED) : [],
    });
    if (!device.mobile) return [await shoot()];
    const [page, screen] = await this.eval<[number, number]>('[document.documentElement.scrollHeight, innerHeight]');
    // A page that scrolls only a sliver (under 24px: padding, nothing more to see) is one screen.
    const n = page - screen < 24 ? 1 : Math.min(MAX_SCREENS, Math.ceil(page / screen));
    const out: { image: Buffer; covered: string[] }[] = [];
    for (let i = 0; i < n; i++) {
      await this.eval(`scrollTo(0, ${n > 1 ? Math.round(((page - screen) * i) / (n - 1)) : 0})`);
      await this.settle();
      out.push(await shoot());
    }
    await this.eval('scrollTo(0, 0)');
    return out;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- rooms for the staged scenes ----------

// Room codes are fixed per scene so the TV shows the same code every run.
function roomCode(i: number): string {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  return `${L[i % 20]}${L[(i * 7 + 3) % 20]}${L[(i * 3 + 11) % 20]}${L[(i * 13 + 5) % 20]}`;
}

// Bots never move here: the server's bot timer is set past the end of the run.
const NEVER = 2 ** 31 - 1;

function makeRoom(staged: Staged, code: string): Room {
  const file = join(CACHE, 'rooms', `${code}.json`);
  // A fresh room: not the game or the seats an earlier run left under this code.
  for (const f of [file, seatsFile(file)]) rmSync(f, { force: true });
  const { scene } = staged;
  const names = scene.names ?? NAMES;
  // A finished game's recap: dated by the page's frozen clock, with an id that's the same every run.
  const recap = { recaps: join(CACHE, 'recaps'), now: () => FROZEN_NOW, recapId: createHash('sha256').update(code).digest('hex').slice(0, 12) };
  rmSync(join(recap.recaps, `${recap.recapId}.json`), { force: true });
  let room: Room;
  if (staged.game) {
    mkdirSync(join(CACHE, 'rooms'), { recursive: true });
    save(file, staged.game);
    room = new Room(code, { file, botDelayMs: NEVER, remote: scene.remote, ...recap });
    // A hosted saved game starts with every seat open; otherwise everyone is seated.
    if (!scene.resume) room.seats.forEach((s, i) => Object.assign(s, { name: names[i], kind: scene.bots?.includes(i) ? 'bot' : 'player' }));
  } else {
    room = new Room(code, { file, botDelayMs: NEVER, remote: scene.remote, ...recap });
    for (let i = 0; i < scene.players - scene.lobby!.bots; i++) room.join(names[i]);
    for (let i = 0; i < scene.lobby!.bots; i++) room.addBot();
  }
  // Seats count as here unless the scene says they've gone quiet.
  room.seats.forEach((s, i) => (s.seen = scene.away?.includes(i) || s.kind === 'open' ? 0 : Number.MAX_SAFE_INTEGER));
  room.changed();
  return room;
}

// The room's seats and game as they are now, and a function that puts them
// back. The seats stay the same objects (a page's open stream counts itself
// on its seat), and the game goes back through mutate(), so it's saved too.
function keep(room: Room): () => void {
  const seats = room.seats.map((s) => [s, { ...s }] as const);
  const game = room.game && structuredClone(room.game);
  return () => {
    room.seats = seats.map(([s, was]) => Object.assign(s, was, { connected: s.connected }));
    if (game) {
      room.mutate((g) => {
        for (const k of Object.keys(g)) if (!(k in game)) delete (g as any)[k];
        Object.assign(g, structuredClone(game));
      });
    } else room.changed();
  };
}

// ---------- the run ----------

interface Done extends Shot {
  scene: string;
  size: string; // '' for the shot's own size
  width: number; // the screen's width in CSS pixels
  screens: number; // a long phone page is several screens: file.webp, file.2.webp, ...
  ms: number;
  changed: boolean | null; // null: no previous run to compare with
}

const imageName = (file: string, i: number) => `${file}${i ? `.${i + 1}` : ''}.webp`;

const USAGE = `Name what to shoot:
  npm run shots -- --only phone-hand            shots whose file or scene name contains "phone-hand"
  npm run shots -- --only raid-fight,tv-vote    several, separated by commas
  npm run shots -- --list [--only raid]         the shots there are, without taking any
  npm run shots -- --all                        every shot: hundreds of images (about 980 with --every-size)`;

// The other sizes a shot is taken at, on top of its own.
function otherSizes(shot: Shot, everySize: boolean): [string, Device][] {
  // A shot that changes the room itself (a `then`, a live move, typing) is taken at one size only.
  return (shot.sizes || everySize) && !shot.then && !shot.live && !shot.fill ? SIZES[shot.table ? 'phone' : shot.client] : [];
}

async function main() {
  const only = flag('only')?.split(',').map((p) => p.trim()).filter(Boolean) ?? null;
  const all = process.argv.includes('--all');
  const everySize = process.argv.includes('--every-size');
  if (process.argv.includes('--list')) return list(only, everySize);
  if (!only?.length && !all) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  // One run at a time on this machine, whichever tab or worktree it's from: each holds a gigabyte or two.
  mkdirSync(CACHE, { recursive: true });
  await takeTurn(join(CACHE, 'run.lock'), (h) => {
    const mins = Math.round((Date.now() - h.since) / 60000);
    console.log(`Waiting for another screenshot run to finish: process ${h.pid} in ${h.cwd}${h.args ? ` (${h.args})` : ''}, started ${mins ? `${mins} min ago` : 'just now'}.`
      + ` Only one runs at a time, so they don't run the machine out of memory.`);
  });
  const t0 = Date.now();
  const out = join(CACHE, flag('out') ? checkName(flag('out')!) : defaultName(CHECKOUT));
  const prev = `${out}.previous`;
  const cleared = tidy(CACHE, [out, prev]);
  if (cleared.length) console.log(`Cleared away ${cleared.length} old run(s) and profile(s) (their checkout is gone, or untouched for ${KEEP_DAYS} days): ${cleared.join(', ')}`);
  rmSync(prev, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, prev);
  mkdirSync(out, { recursive: true });
  claim(out, CHECKOUT);

  const staged = picked(SCENES.map((s) => stage(s)), all ? null : only);
  const tStaged = Date.now();
  if (!staged.length) {
    console.error(`No shot's file or scene name contains ${only!.map((p) => `"${p}"`).join(' or ')}. See them all: npm run shots -- --list`);
    process.exitCode = 1;
    return;
  }

  const { server, rooms } = startServer(0, { recaps: join(CACHE, 'recaps') });
  await new Promise<void>((ok) => (server.listening ? ok() : server.on('listening', () => ok())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chrome = await launchChrome();
  // Ctrl-C and friends: take Chrome down now, so its profile goes too. (A kill -9 can't be caught; the pipe covers that.)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      chrome.proc.kill();
      console.error(`\nStopped (${sig}).`);
      chrome.gone.then(() => process.exit(130));
      setTimeout(() => process.exit(130), 5000).unref();
    });
  }
  const done: Done[] = [];
  const covered: string[] = []; // phone screens where the hand sits over the page
  let failures = 0;
  try {
    const cdp = chrome.cdp;
    const tab = await Tab.open(cdp);
    let n = 0;
    for (const { st, shots } of staged) {
      const code = roomCode(SCENES.indexOf(st.scene));
      const room = makeRoom(st, code);
      rooms.set(code, room);
      for (const shot of shots) {
        const own: [string, Device] = ['', shot.client === 'tv' && !shot.table ? TV : PHONE];
        const sizes = [own, ...otherSizes(shot, everySize)];
        // Its taps can still change the room (Leave takes the seat away): each size starts from the room as it was.
        const before = sizes.length > 1 ? keep(room) : null;
        for (const [size, device] of sizes) {
          if (size && before) before();
          const ts = Date.now();
          const file = size ? `${shot.file}@${size}` : shot.file;
          try {
            const storage: Record<string, string> = {};
            let url: string;
            if (shot.table) {
              url = `${base}/tv?room=${code}&remote&n=${n++}`;
            } else if (shot.client === 'tv') {
              url = `${base}/tv?room=${code}&n=${n++}`;
              if (!shot.guest) storage[`tv:${code}`] = room.hostToken; // the TV that made the room: its buttons work
              tab.info = shot.tailscale ? { ...LAN, tailscale: TAILSCALE } : LAN;
            } else if (shot.seat !== undefined) {
              url = `${base}/${code}?n=${n++}#code=${code}&token=${room.seats[shot.seat].token}`;
            } else {
              url = `${base}${(typeof shot.path === 'function' ? shot.path(room) : shot.path) ?? `/${code}`}?n=${n++}`;
              if (shot.remember) storage.name = shot.remember;
            }
            const screenGone = shot.screen ? room.connect(null) : null;
            await tab.load(url, device, { storage, loading: shot.loading });
            // A phone in a game with no TV: its table view has loaded (and so will see what happens next).
            if (st.scene.remote && st.game && shot.seat !== undefined) await tab.waitFor(`document.querySelector('.tableview iframe')?.contentDocument?.querySelector('#app .board')`, 'the table view to load');
            if (shot.live) {
              room.mutate((g) => st.scene.live!(g, st.rng));
              await sleep(100);
            }
            if (shot.then) {
              shot.then(room);
              await sleep(150);
            }
            if (shot.offline) {
              await tab.offline(true);
              server.closeAllConnections(); // the stream drops; the page's retries can't get through
              await tab.waitFor(`document.body.classList.contains('offline')`, 'the page to notice it is offline');
            }
            if (shot.fill) {
              if (shot.fill.code !== undefined) await tab.type('#code', shot.fill.code);
              if (shot.fill.name !== undefined) await tab.type('#name', shot.fill.name);
            }
            for (const sel of shot.clicks ?? []) await tab.click(sel);
            if (shot.run) await tab.eval(shot.run);
            if (shot.press) await tab.press(shot.press.on, shot.press.dx ?? 0, shot.press.dy ?? 0);
            if (shot.waitFor && shot.hold) await tab.hold(shot.waitFor, 30000);
            else if (shot.waitFor) await tab.waitFor(`document.querySelector(${JSON.stringify(shot.waitFor)})`, shot.waitFor, 30000);
            if (shot.waitMs) await sleep(shot.waitMs);
            // A moving 3D board is shot frame by frame, at board clock times.
            const frames: (string | null)[] = shot.frames ? shot.frames.map((f) => (shot.flight ? `window.boardFlightAt?.(${f})` : String(f))) : [null];
            for (const [fi, clockAt] of frames.entries()) {
              const name = clockAt === null ? file : `${file}-${fi + 1}`;
              if (clockAt !== null) {
                const ok = await tab.eval<boolean>(`(() => { const t = ${clockAt}; if (t == null) return false; window.boardClock = t; return true; })()`);
                if (!ok) throw new Error('No dragon on the board can fly');
              }
              if (!shot.loading) await tab.settle();
              const images = await tab.images(device);
              let changed: boolean | null = null;
              images.forEach(({ image, covered: c }, i) => {
                if (c.length) covered.push(`${imageName(name, i)}: ${c.join(', ')}`);
                const before = join(prev, imageName(name, i));
                const differs = existsSync(before) ? !readFileSync(before).equals(image) : existsSync(prev) ? true : null;
                // The same as last time: the same file, not a second copy of it.
                if (differs === false) linkSync(before, join(out, imageName(name, i)));
                else writeFileSync(join(out, imageName(name, i)), image);
                changed = changed || differs;
              });
              if (existsSync(join(prev, imageName(name, images.length)))) changed = true; // it used to be longer
              const caption = clockAt === null ? shot.caption : `${shot.caption} (frame ${fi + 1} of ${frames.length})`;
              done.push({ ...shot, file: name, caption, scene: st.scene.name, size, width: device.width, screens: images.length, ms: Date.now() - ts, changed });
              console.log(`${changed ? '* ' : '  '}${name}.webp${images.length > 1 ? ` (${images.length} screens)` : ''}  ${Date.now() - ts} ms`);
            }
            if (shot.offline) await tab.offline(false);
            screenGone?.();
          } catch (e) {
            failures++;
            await tab.offline(false).catch(() => {});
            console.error(`  ${file}: FAILED: ${(e as Error).message}`);
          }
        }
      }
      room.close();
      rooms.delete(code);
    }
  } finally {
    chrome.proc.kill();
    server.close();
    server.closeAllConnections();
  }
  writeFileSync(join(out, 'index.html'), contactSheet(done, existsSync(prev) ? prev : null));
  const changed = done.filter((d) => d.changed);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${done.length} screenshots in ${secs}s (staging ${tStaged - t0} ms) -> ${out}/`);
  console.log(`Contact sheet: file://${join(out, 'index.html')}`);
  if (done.some((d) => d.changed !== null)) console.log(changed.length ? `Changed since the previous run (*): ${changed.length}` : 'Nothing changed since the previous run.');
  if (covered.length) console.log(`\nThe hand of cards sits over the page on ${covered.length} phone screen(s):\n${covered.map((c) => `  ${c}`).join('\n')}`);
  if (failures) {
    console.error(`${failures} screenshot(s) failed.`);
    process.exitCode = 1;
  }
}

// The shots there are (or those --only picks), and the sizes each is taken at: nothing is shot.
function list(only: string[] | null, everySize: boolean) {
  let images = 0;
  const picks = picked(SCENES.map((s) => stage(s)), only);
  for (const { st, shots } of picks) {
    console.log(`${st.scene.name}:`);
    for (const shot of shots) {
      const sizes = otherSizes(shot, everySize).map(([s]) => s);
      const frames = shot.frames?.length ?? 1;
      images += frames * (1 + sizes.length);
      console.log(`  ${shot.file}${sizes.length ? ` (also @${sizes.join(', @')})` : ''}${frames > 1 ? ` (${frames} frames)` : ''}  ${shot.caption}`);
    }
  }
  console.log(`\n${picks.reduce((n, p) => n + p.shots.length, 0)} shots, ${images} images or more (a long phone page is several)${everySize ? '' : '; --every-size takes more'}.`);
}

function contactSheet(done: Done[], prev: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  // Every screen at the same scale (a TV pixel is a third, a phone pixel 0.6), so sizes compare at a glance.
  const card = (d: Done) => {
    const w = Math.round(d.width * (d.client === 'tv' && !d.table ? 1 / 3 : 0.6));
    const imgs = Array.from({ length: d.screens }, (_, i) => `<a href="${imageName(d.file, i)}"><img src="${imageName(d.file, i)}" loading="lazy" style="width:${w}px"></a>`).join('');
    return `<figure class="${d.changed ? 'changed' : ''}">
    <div class="screens">${imgs}</div>
    <figcaption style="max-width:${Math.max(w * d.screens, 240)}px"><b>${esc(d.file)}</b> ${esc(d.caption)}${d.size ? ` <i>(${esc(d.size)})</i>` : ''}${d.screens > 1 ? ` <i>${d.screens} screens, scrolled</i>` : ''}${d.changed ? ` <a class="was" href="file://${esc(join(prev!, imageName(d.file, 0)))}">changed: see before</a>` : ''}</figcaption></figure>`;
  };
  const group = (client: string, sized: boolean) => done.filter((d) => d.client === client && !!d.size === sized).map(card).join('');
  return `<!doctype html><meta charset="utf-8"><title>board-lite shots</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}h2{margin:24px 0 8px}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0;background:#1c1c22;padding:8px;border-radius:6px;border:2px solid transparent}
figure.changed{border-color:#f5c542}.screens{display:flex;gap:4px;align-items:flex-start}figcaption{margin-top:6px}
a{color:#9cf}.was{color:#f5c542}i{color:#999}</style>
<h1>board-lite: staged screenshots</h1><p>${done.length} shots. ${prev ? 'Yellow: changed since the previous run.' : ''}</p>
<h2>TV</h2><div class="grid">${group('tv', false)}</div>
<h2>Phone</h2><div class="grid">${group('phone', false)}</div>
<h2>Other screen sizes</h2><div class="grid">${group('tv', true)}${group('phone', true)}</div>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
