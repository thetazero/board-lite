// Screenshots of the TV and phone clients in staged game situations, for
// tuning how the game looks. One command, one headless Chrome, the real
// server and clients:
//
//   npm run shots [-- --only raid] [--every-size] [--out DIR]
//
// Each scene in scenes.ts becomes a room on a private server (every seat a
// player nobody drives, so nothing moves on its own). Chrome is driven over
// the DevTools protocol with Node's own WebSocket: no dependencies. The page
// clock is frozen and CSS animations are off, so a scene renders the same
// on every run. The run goes to ~/.cache/board-lite/staged-shots/latest (the last
// run moves to latest.previous) with an index.html contact sheet that marks
// what changed since the previous run.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Room } from '../server/room.ts';
import { startServer } from '../server/server.ts';
import { save } from '../store.ts';
import { drive, NAMES, SCENES, stage, type Shot, type Staged } from './scenes.ts';

const CACHE = join(homedir(), '.cache', 'board-lite', 'staged-shots'); // on disk: /tmp is RAM on the dev machine
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
  const cards = [...document.querySelectorAll('.handfan .card')].map((c) => c.getBoundingClientRect()).filter((r) => r.height);
  if (!cards.length || document.querySelector('.zoom, .talkbar.open')) return [];
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
  private ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        if (m.error) p.fail(new Error(`${m.error.message} ${m.error.data ?? ''}`));
        else p.ok(m.result);
      } else for (const h of this.handlers) h(m.method, m.params, m.sessionId);
    };
  }

  static connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    return new Promise((ok, fail) => {
      ws.onopen = () => ok(new Cdp(ws));
      ws.onerror = () => fail(new Error(`Could not connect to Chrome at ${url}`));
    });
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    if (process.env.CDP_DEBUG) console.error('>', id, method, JSON.stringify(params).slice(0, 120));
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }

  on(fn: (method: string, params: any, session?: string) => void) {
    this.handlers.push(fn);
  }

  close() {
    this.ws.close();
  }
}

function findChrome(): string {
  const candidates = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error('No Chrome or Chromium found. Set CHROME=/path/to/chrome.');
  return found;
}

async function launchChrome(): Promise<{ proc: ChildProcess; url: string }> {
  // A profile of its own, so runs from several worktrees at once don't collide.
  mkdirSync(CACHE, { recursive: true });
  const profile = mkdtempSync(join(CACHE, 'chrome-profile-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', // WebGL for the TV's 3D board, on the CPU
    '--disable-gpu-rasterization', // the rest of the page rasterized in software, the same every run
    '--disable-features=BackForwardCache', // a cached page would keep its event stream open, and the browser allows only 6 per host
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Chrome's helper processes can still be writing the profile for a moment after it exits.
  const removeProfile = (tries: number) => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      if (tries > 0) setTimeout(() => removeProfile(tries - 1), 300);
      else console.error(`Couldn't remove Chrome's profile ${profile}: ${(e as Error).message}`);
    }
  };
  proc.on('exit', () => removeProfile(10));
  const url = await new Promise<string>((ok, fail) => {
    let err = '';
    const timer = setTimeout(() => fail(new Error(`Chrome didn't start:\n${err}`)), 20000);
    proc.stderr!.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    });
    proc.on('exit', () => fail(new Error(`Chrome exited:\n${err}`)));
  });
  return { proc, url };
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
  async pngs(device: Device): Promise<{ png: Buffer; covered: string[] }[]> {
    const shoot = async () => ({
      png: Buffer.from((await this.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
      covered: device.mobile ? await this.eval<string[]>(COVERED) : [],
    });
    if (!device.mobile) return [await shoot()];
    const [page, screen] = await this.eval<[number, number]>('[document.documentElement.scrollHeight, innerHeight]');
    // A page that scrolls only a sliver (under 24px: padding, nothing more to see) is one screen.
    const n = page - screen < 24 ? 1 : Math.min(MAX_SCREENS, Math.ceil(page / screen));
    const out: { png: Buffer; covered: string[] }[] = [];
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
  rmSync(file, { force: true });
  const { scene } = staged;
  const names = scene.names ?? NAMES;
  let room: Room;
  if (staged.game) {
    mkdirSync(join(CACHE, 'rooms'), { recursive: true });
    save(file, staged.game);
    room = new Room(code, { file, botDelayMs: NEVER });
    // A hosted saved game starts with every seat open; otherwise everyone is seated.
    if (!scene.resume) room.seats.forEach((s, i) => Object.assign(s, { name: names[i], kind: scene.bots?.includes(i) ? 'bot' : 'player' }));
  } else {
    room = new Room(code, { file, botDelayMs: NEVER });
    for (let i = 0; i < scene.players - scene.lobby!.bots; i++) room.join(names[i]);
    for (let i = 0; i < scene.lobby!.bots; i++) room.addBot();
  }
  // Seats count as here unless the scene says they've gone quiet.
  room.seats.forEach((s, i) => (s.seen = scene.away?.includes(i) || s.kind === 'open' ? 0 : Number.MAX_SAFE_INTEGER));
  room.changed();
  return room;
}

// ---------- the run ----------

interface Done extends Shot {
  scene: string;
  size: string; // '' for the shot's own size
  width: number; // the screen's width in CSS pixels
  screens: number; // a long phone page is several screens: file.png, file.2.png, ...
  ms: number;
  changed: boolean | null; // null: no previous run to compare with
}

const pngName = (file: string, i: number) => `${file}${i ? `.${i + 1}` : ''}.png`;

async function main() {
  const t0 = Date.now();
  const only = flag('only');
  const everySize = process.argv.includes('--every-size');
  const out = resolve(flag('out') ?? join(CACHE, 'latest'));
  const prev = `${out}.previous`;
  rmSync(prev, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, prev);
  mkdirSync(out, { recursive: true });

  const staged = SCENES.filter((s) => !only || s.name.includes(only)).map((s) => stage(s));
  const tStaged = Date.now();

  const { server, rooms } = startServer(0);
  await new Promise<void>((ok) => (server.listening ? ok() : server.on('listening', () => ok())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chrome = await launchChrome();
  const done: Done[] = [];
  const covered: string[] = []; // phone screens where the hand sits over the page
  let failures = 0;
  try {
    const cdp = await Cdp.connect(chrome.url);
    const tab = await Tab.open(cdp);
    let n = 0;
    for (const st of staged) {
      const code = roomCode(SCENES.indexOf(st.scene));
      const room = makeRoom(st, code);
      rooms.set(code, room);
      for (const shot of st.scene.shots(st.game)) {
        const own: [string, Device] = ['', shot.client === 'tv' ? TV : PHONE];
        // A shot that changes the room (a tap that sends a command, a `then`) is taken at one size only.
        const sizes = (shot.sizes || everySize) && !shot.then && !shot.live && !shot.fill ? [own, ...SIZES[shot.client]] : [own];
        for (const [size, device] of sizes) {
          const ts = Date.now();
          const file = size ? `${shot.file}@${size}` : shot.file;
          try {
            const storage: Record<string, string> = {};
            let url: string;
            if (shot.client === 'tv') {
              url = `${base}/tv?room=${code}&n=${n++}`;
              if (!shot.guest) storage[`tv:${code}`] = room.hostToken; // the TV that made the room: its buttons work
              tab.info = shot.tailscale ? { ...LAN, tailscale: TAILSCALE } : LAN;
            } else if (shot.seat !== undefined) {
              url = `${base}/${code}?n=${n++}#code=${code}&token=${room.seats[shot.seat].token}`;
            } else {
              url = `${base}${shot.path ?? `/${code}`}?n=${n++}`;
              if (shot.remember) storage.name = shot.remember;
            }
            await tab.load(url, device, { storage, loading: shot.loading });
            if (shot.live) {
              room.mutate((g) => drive(g, st.rng, st.scene.live!));
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
            if (shot.waitFor) await tab.waitFor(`document.querySelector(${JSON.stringify(shot.waitFor)})`, shot.waitFor, 30000);
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
              const pngs = await tab.pngs(device);
              let changed: boolean | null = null;
              pngs.forEach(({ png, covered: c }, i) => {
                if (c.length) covered.push(`${pngName(name, i)}: ${c.join(', ')}`);
                writeFileSync(join(out, pngName(name, i)), png);
                const before = join(prev, pngName(name, i));
                const differs = existsSync(before) ? !readFileSync(before).equals(png) : existsSync(prev) ? true : null;
                changed = changed || differs;
              });
              if (existsSync(join(prev, pngName(name, pngs.length)))) changed = true; // it used to be longer
              const caption = clockAt === null ? shot.caption : `${shot.caption} (frame ${fi + 1} of ${frames.length})`;
              done.push({ ...shot, file: name, caption, scene: st.scene.name, size, width: device.width, screens: pngs.length, ms: Date.now() - ts, changed });
              console.log(`${changed ? '* ' : '  '}${name}.png${pngs.length > 1 ? ` (${pngs.length} screens)` : ''}  ${Date.now() - ts} ms`);
            }
            if (shot.offline) await tab.offline(false);
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
    cdp.close();
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

function contactSheet(done: Done[], prev: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  // Every screen at the same scale (a TV pixel is a third, a phone pixel 0.6), so sizes compare at a glance.
  const card = (d: Done) => {
    const w = Math.round(d.width * (d.client === 'tv' ? 1 / 3 : 0.6));
    const imgs = Array.from({ length: d.screens }, (_, i) => `<a href="${pngName(d.file, i)}"><img src="${pngName(d.file, i)}" loading="lazy" style="width:${w}px"></a>`).join('');
    return `<figure class="${d.changed ? 'changed' : ''}">
    <div class="screens">${imgs}</div>
    <figcaption style="max-width:${Math.max(w * d.screens, 240)}px"><b>${esc(d.file)}</b> ${esc(d.caption)}${d.size ? ` <i>(${esc(d.size)})</i>` : ''}${d.screens > 1 ? ` <i>${d.screens} screens, scrolled</i>` : ''}${d.changed ? ` <a class="was" href="file://${esc(join(prev!, `${d.file}.png`))}">changed: see before</a>` : ''}</figcaption></figure>`;
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
