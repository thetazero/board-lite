// Screenshots of the TV and phone clients in staged game situations, for
// tuning how the game looks. One command, one headless Chrome, the real
// server and clients:
//
//   npm run shots [-- --only raid] [--out DIR]
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
const TV = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const FROZEN_NOW = Date.UTC(2026, 0, 1, 20, 0, 0); // the page's clock
const LAN = { lan: ['192.168.1.20'], tailscale: [] as string[], port: 8080 }; // the address the TV shows

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
    '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-gpu',
    '--disable-features=BackForwardCache', // a cached page would keep its event stream open, and the browser allows only 6 per host
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.on('exit', () => rmSync(profile, { recursive: true, force: true }));
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

// Runs before every page's own scripts: a frozen clock, no animations, a fresh
// phone (no remembered seat; a seat comes in the address).
const PAGE_SETUP = `
  Date.now = () => ${FROZEN_NOW};
  try { localStorage.clear(); } catch {}
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
    document.head.append(s);
  });
`;

class Tab {
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
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SETUP });
    // The TV shows this machine's network address; show a fixed one instead.
    await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/info' }] });
    cdp.on((method, params, session) => {
      if (session !== sessionId) return;
      if (method === 'Fetch.requestPaused') {
        void tab.send('Fetch.fulfillRequest', {
          requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(LAN)).toString('base64'),
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

  async load(url: string, device: typeof TV) {
    await this.send('Emulation.setDeviceMetricsOverride', device);
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: device.mobile });
    await this.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete' && document.querySelector('#app') && !document.querySelector('#app .loading')`, `${url} to render`);
    await this.eval('document.fonts.ready.then(() => true)');
    await this.settle();
  }

  async click(selector: string) {
    const ok = await this.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`Nothing to tap: ${selector}`);
    await sleep(60); // taps that send a command wait for the server's push
    await this.settle();
  }

  // The phone is shot down to the bottom of the page, not just the first screen.
  async png(device: typeof TV): Promise<Buffer> {
    let clip;
    if (device.mobile) {
      const h = await this.eval<number>('Math.max(document.documentElement.scrollHeight, innerHeight)');
      clip = { x: 0, y: 0, width: device.width, height: h, scale: 1 };
    }
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
    return Buffer.from(r.data, 'base64');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- rooms for the staged scenes ----------

// Room codes are fixed per scene so the TV shows the same code every run.
function roomCode(i: number): string {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  return `${L[i % 20]}${L[(i * 7 + 3) % 20]}${L[(i * 3 + 11) % 20]}${L[(i * 13 + 5) % 20]}`;
}

function makeRoom(staged: Staged, code: string): Room {
  const file = join(CACHE, 'rooms', `${code}.json`);
  rmSync(file, { force: true });
  let room: Room;
  if (staged.game) {
    mkdirSync(join(CACHE, 'rooms'), { recursive: true });
    save(file, staged.game);
    room = new Room(code, { file });
    room.seats.forEach((s, i) => Object.assign(s, { name: NAMES[i], kind: 'player' }));
  } else {
    room = new Room(code, { file });
    const { players, lobby } = staged.scene;
    for (let i = 0; i < players - lobby!.bots; i++) room.join(NAMES[i]);
    for (let i = 0; i < lobby!.bots; i++) room.addBot();
  }
  room.seats.forEach((s) => (s.seen = Number.MAX_SAFE_INTEGER)); // nobody shows as away
  room.changed();
  return room;
}

// ---------- the run ----------

interface Done extends Shot {
  scene: string;
  ms: number;
  changed: boolean | null; // null: no previous run to compare with
}

async function main() {
  const t0 = Date.now();
  const only = flag('only');
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
        const ts = Date.now();
        try {
          const device = shot.client === 'tv' ? TV : PHONE;
          const tokenPart = shot.seat === undefined ? '' : `#code=${code}&token=${room.seats[shot.seat].token}`;
          const url = shot.client === 'tv' ? `${base}/tv?room=${code}&n=${n++}` : `${base}/${code}?n=${n++}${tokenPart}`;
          await tab.load(url, device);
          if (shot.live) {
            room.mutate((g) => drive(g, st.rng, st.scene.live!));
            await sleep(100);
          }
          for (const sel of shot.clicks ?? []) await tab.click(sel);
          if (shot.waitMs) await sleep(shot.waitMs);
          await tab.settle();
          const png = await tab.png(device);
          const file = join(out, `${shot.file}.png`);
          writeFileSync(file, png);
          const before = join(prev, `${shot.file}.png`);
          const changed = existsSync(before) ? !readFileSync(before).equals(png) : null;
          done.push({ ...shot, scene: st.scene.name, ms: Date.now() - ts, changed });
          console.log(`${changed ? '* ' : '  '}${shot.file}.png  ${Date.now() - ts} ms`);
        } catch (e) {
          failures++;
          console.error(`  ${shot.file}: FAILED: ${(e as Error).message}`);
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
  if (failures) {
    console.error(`${failures} screenshot(s) failed.`);
    process.exitCode = 1;
  }
}

function contactSheet(done: Done[], prev: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const card = (d: Done) => `<figure class="${d.client}${d.changed ? ' changed' : ''}">
    <a href="${d.file}.png"><img src="${d.file}.png" loading="lazy"></a>
    <figcaption><b>${esc(d.file)}</b> ${esc(d.caption)}${d.changed ? ` <a class="was" href="file://${esc(join(prev!, `${d.file}.png`))}">changed: see before</a>` : ''}</figcaption></figure>`;
  return `<!doctype html><meta charset="utf-8"><title>board-lite shots</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}h2{margin:24px 0 8px}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0;background:#1c1c22;padding:8px;border-radius:6px;border:2px solid transparent}
figure.changed{border-color:#f5c542}figure.tv img{width:640px}figure.phone img{width:240px}figcaption{max-width:640px;margin-top:6px}
figure.phone figcaption{max-width:240px}a{color:#9cf}.was{color:#f5c542}</style>
<h1>board-lite: staged screenshots</h1><p>${done.length} shots. ${prev ? 'Yellow: changed since the previous run.' : ''}</p>
<h2>TV</h2><div class="grid">${done.filter((d) => d.client === 'tv').map(card).join('')}</div>
<h2>Phone</h2><div class="grid">${done.filter((d) => d.client === 'phone').map(card).join('')}</div>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
