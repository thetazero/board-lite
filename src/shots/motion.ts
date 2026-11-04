// A whole bot game watched on the TV and one phone in real time, looking for
// motion that jumps instead of moving: an animation cut off or restarted by a
// re-render, a bar or a card that snaps where it should slide, a screen that
// swaps for another with nothing in between. For auditing how the game
// moves (issue #169) and checking a fix:
//
//   npm run motion [-- --players 3] [--seed 7] [--minutes 8] [--delay 1500] [--out DIR]
//
// Unlike `npm run shots`, nothing is frozen: the clock runs, CSS animates and
// the bots play (each move after --delay ms, standing in for people). A probe
// in each page reports what it sees as it happens; each kind of jump gets a
// few short clips (the frames the screen painted around it, from Chrome's
// screencast) as a GIF and a strip. Everything goes to
// ~/.cache/board-lite/motion/latest: report.md (what was seen, how often, the
// clips), log.jsonl (every probe event) and clips/.
//
// The 3D board renders on the CPU here (SwiftShader), so its own frame rate is
// low and says nothing about a real TV; the probes time the page's own changes.
// It shares `npm run shots`'s turn: one Chrome on the machine at a time.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Cdp, launchChrome } from './chrome.ts';
import { botMove } from '../bot.ts';
import { waitingOn } from '../engine.ts';
import { Room } from '../server/room.ts';
import { startServer } from '../server/server.ts';
import { takeTurn } from './turn.ts';

const CACHE = join(homedir(), '.cache', 'board-lite');
const SHOTS = join(CACHE, 'staged-shots'); // the screenshot runs' turn and Chrome profiles
const flag = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const players = Number(flag('players', '3'));
const seed = Number(flag('seed', '7'));
const minutes = Number(flag('minutes', '8'));
const delay = Number(flag('delay', '1500'));
const out = resolve(flag('out', join(CACHE, 'motion', 'latest')));
const CLIPS_PER_KIND = 3;
const BEFORE_S = 0.7, AFTER_S = 1.1; // a clip: this long before the moment and after it

const TV = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

// The probe, in every page before its own scripts. It reports through the
// binding `motionProbe` (one JSON object per call):
//   cut      an element removed while its CSS animation or transition was still running
//   rerun    the same animation started again on the same thing while it stayed on screen (a re-render replaying it)
//   snap     a bar's width (a health bar) or a card's lift changed in one frame, not over time
//   swap     what fills the screen changed in one frame (the TV's overlay, the phone's screen), and whether anything faded
//   pop      an element appeared or went with no animation (a toast, a production row, a card zoom)
const PROBE = String.raw`(() => {
  const send = (o) => { try { window.motionProbe(JSON.stringify({ t: Date.now(), page: location.pathname.startsWith('/tv') ? 'tv' : 'phone', ...o })); } catch {} };
  const what = (el) => {
    if (!el || !el.tagName) return '?';
    const own = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.dataset?.card ? '[card]' : el.dataset?.d ? '[d=' + el.dataset.d + ']' : el.dataset?.u ? '[u=' + el.dataset.u + ']' : '');
    const up = el.parentElement?.closest('[id], .fighter, .handfan, .zoom, .production, .result, .raidbox, .board, .notices');
    return (up ? (up.id ? '#' + up.id : up.className.split(' ')[0]) + ' > ' : '') + own;
  };
  // Running CSS animations and transitions, by element.
  const running = new Map();
  const key = (e) => e.type.startsWith('animation') ? e.animationName : 'transition:' + e.propertyName;
  const started = (e) => {
    const k = key(e);
    const el = e.target;
    let m = running.get(el);
    if (!m) running.set(el, (m = new Map()));
    m.set(k, Date.now());
    // The same animation on the same thing, a moment ago, on an element since replaced: a re-render replaying it.
    const id = what(el) + '|' + k;
    const last = recent.get(id);
    if (last && !last.el.isConnected && Date.now() - last.at < 4000) send({ kind: 'rerun', name: k, el: id.split('|')[0], afterMs: Date.now() - last.at });
    recent.set(id, { el, at: Date.now() });
  };
  const ended = (e) => running.get(e.target)?.delete(key(e));
  const recent = new Map();
  addEventListener('animationstart', started, true);
  addEventListener('transitionrun', started, true);
  addEventListener('animationend', ended, true);
  addEventListener('transitionend', ended, true);
  addEventListener('animationcancel', ended, true);
  addEventListener('transitioncancel', ended, true);
  // What fills the screen, in a word or two.
  const screen = () => {
    if (location.pathname.startsWith('/tv')) {
      const o = document.getElementById('overlay');
      const cls = o ? o.className.replace('overlay', '').trim() || 'none' : 'none';
      const sub = o?.querySelector('.production') ? ' production' : o?.querySelector('.fight') ? ' fight' : o?.querySelector('.result') ? ' result' : o?.querySelector('.raidbox h1') ? ' ' + o.querySelector('.raidbox h1').textContent.trim().split(/\s+/)[0].toLowerCase() : '';
      return (document.querySelector('.lobby') ? 'lobby' : 'board') + ' | overlay ' + cls + sub;
    }
    const a = document.getElementById('app');
    if (!a) return '?';
    if (a.querySelector('.watchtv')) return 'watch-tv';
    const parts = [];
    if (a.querySelector('.pover')) parts.push('game over');
    if (a.querySelector('.joinpage')) parts.push('join: ' + (a.querySelector('.joinpage .notice, .joinpage .err, .joinpage p')?.textContent.trim().slice(0, 30) ?? ''));
    if (a.querySelector('.zoom')) parts.push('card open');
    const st = a.querySelector('.status');
    if (st) parts.push(st.textContent.trim().replace(/\s+/g, ' ').slice(0, 28));
    return parts.join(' | ') || 'game';
  };
  let shown = null;
  let fadeSeen = 0;
  addEventListener('animationstart', (e) => { if (/fade|zoom|deal/.test(e.animationName)) fadeSeen = Date.now(); }, true);
  const look = () => {
    const now = screen();
    const from = shown;
    shown = now;
    if (from !== null && now !== from) {
      // The screen changed: did anything fade or move on the way?
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const animated = Date.now() - fadeSeen < 120 || document.getAnimations().some((a) => a.playState === 'running' && a.effect?.target?.closest?.('#overlay, #app') && a.effect.getComputedTiming().duration >= 100 && a.currentTime < 120);
        send({ kind: 'swap', from, to: now, animated });
      }));
    }
  };
  // Things that come and go on their own (toasts) and rows that turn on.
  const appeared = (el) => {
    if (!(el instanceof Element)) return;
    if (el.matches('.toast')) requestAnimationFrame(() => {
      const cs = getComputedStyle(el);
      send({ kind: 'pop', what: 'toast appears', el: what(el), animated: cs.animationName !== 'none' || parseFloat(cs.transitionDuration) > 0 });
      const gone = new MutationObserver(() => {
        if (el.isConnected) return;
        gone.disconnect();
        send({ kind: 'pop', what: 'toast goes', el: what(el), animated: false });
      });
      gone.observe(document.body, { childList: true, subtree: true });
    });
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.addedNodes) appeared(n);
      if (m.type === 'attributes' && m.target instanceof Element && m.oldValue !== null) {
        const before = new Set((m.oldValue || '').split(/\s+/));
        const added = [...m.target.classList].filter((c) => !before.has(c));
        for (const c of added) if (['up', 'show', 'down'].includes(c)) {
          const el = m.target;
          requestAnimationFrame(() => {
            const cs = getComputedStyle(el);
            send({ kind: 'pop', what: '.' + c + ' turns on', el: what(el), animated: cs.animationName !== 'none' || (parseFloat(cs.transitionDuration) > 0 && cs.transitionProperty !== 'none' && !/^(transform|box-shadow)/.test(cs.transitionProperty)) });
          });
        }
      }
    }
    // Animations still running on elements just removed.
    for (const [el, m] of running) {
      if (el.isConnected) continue;
      for (const [k, at] of m) if (Date.now() - at > 16) send({ kind: 'cut', name: k, el: what(el), ranMs: Date.now() - at });
      running.delete(el);
    }
    look();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  // Bars and cards, every frame. A change on an element that's moving (a
  // transition or an animation running on it) is motion, however few frames
  // the screen gets; a change with nothing running, or on a new element that
  // replaced the old one, lands in one frame: a snap.
  const bars = new Map();
  const lifts = new Map();
  const moving = (el) => el.getAnimations().some((a) => a.playState === 'running');
  const tick = () => {
    requestAnimationFrame(tick);
    for (const s of document.querySelectorAll('.hpbar > span')) {
      const f = s.closest('[data-d], [data-u]');
      if (!f) continue;
      const id = (f.dataset.d ? 'd' + f.dataset.d : 'u' + f.dataset.u) + (f.closest('#overlay') ? '@fight' : '');
      const w = s.getBoundingClientRect().width / (s.parentElement.getBoundingClientRect().width || 1) * 100;
      const was = bars.get(id);
      if (was && Math.abs(w - was.w) > 8 && !moving(s)) send({ kind: 'snap', what: 'health bar', el: what(f), from: Math.round(was.w), to: Math.round(w), replaced: was.el !== s });
      bars.set(id, { w, el: s });
    }
    for (const c of document.querySelectorAll('.handfan .card')) {
      const id = c.dataset.card;
      const y = c.getBoundingClientRect().top;
      const was = lifts.get(id);
      if (was && Math.abs(y - was.y) > 12 && !moving(c)) send({ kind: 'snap', what: 'card in the hand moves', el: what(c), from: Math.round(was.y), to: Math.round(y), replaced: was.el !== c });
      lifts.set(id, { y, el: c });
    }
  };
  requestAnimationFrame(tick);
})();`;

interface Frame { t: number; data: string }
interface Probe { t: number; page: 'tv' | 'phone'; kind: string; [k: string]: unknown }

class Page {
  frames: Frame[] = [];
  private cdp: Cdp;
  private session: string;
  constructor(cdp: Cdp, session: string) {
    this.cdp = cdp;
    this.session = session;
  }
  static async open(cdp: Cdp, device: object, url: string, storage: Record<string, string>, onProbe: (p: Probe) => void): Promise<Page> {
    // A window each, both in front: a tab behind another gets no animation frames.
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Page(cdp, sessionId);
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Runtime.addBinding', { name: 'motionProbe' });
    await p.send('Emulation.setDeviceMetricsOverride', device);
    await p.send('Page.addScriptToEvaluateOnNewDocument', {
      source: Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + PROBE,
    });
    cdp.on((method, params, session) => {
      if (session !== sessionId) return;
      if (method === 'Runtime.bindingCalled' && params.name === 'motionProbe') onProbe(JSON.parse(params.payload));
      if (method === 'Page.screencastFrame') {
        p.frames.push({ t: params.metadata.timestamp * 1000, data: params.data });
        const cut = Date.now() - 6000;
        while (p.frames.length && p.frames[0].t < cut) p.frames.shift();
        void p.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      }
      if (method === 'Runtime.exceptionThrown') console.error(`  page error: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`);
    });
    await p.send('Page.navigate', { url });
    // The page's own process, once it's loaded: the screencast needs it.
    for (let i = 0; i < 200 && !(await p.eval<boolean>(`document.readyState === 'complete' && location.href !== 'about:blank'`).catch(() => false)); i++) await sleep(50);
    await p.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 960, maxHeight: 844 });
    return p;
  }
  send(method: string, params: object = {}): Promise<any> {
    return this.cdp.send(method, params, this.session);
  }
  async eval<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }
  tap(selector: string) {
    return this.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What a probe event is a case of: the clips are kept per kind.
// Screens in general terms, so every player's turn is one kind, not one per name.
const general = (screen: unknown) => String(screen)
  .replace(/^board \| overlay /, '')
  .replace(/raid raid/, 'raid vote').replace(/raid fight$/, 'raid fight-or-bail')
  .replace(/Waiting for .*/, 'waiting').replace(/\S+'s turn/, "someone's turn").replace(/An offer for you/, 'an offer')
  .replace(/raid Vote/, 'raid vote').replace(/raid .* everyone sees/, 'raid commit').replace(/raid .* secret/, 'raid fight-or-bail')
  .replace(/Discard \d.*/, 'discard').replace(/Keep 1.*/, 'keep a card');
function kindOf(p: Probe): string | null {
  if (p.kind === 'swap') return p.animated ? null : `${p.page}: ${general(p.from)} -> ${general(p.to)}`;
  if (p.kind === 'cut' || p.kind === 'rerun') return `${p.page}: ${p.kind} ${p.name} on ${String(p.el).replace(/\[[du]=[^\]]*\]/, '').replace(/\.(k-\w+|longname|strike|down|dim|ready|dealt)/g, '')}`;
  if (p.kind === 'snap') return `${p.page}: ${p.what} snaps${p.what === 'card in the hand moves' ? (Math.abs(Number(p.to) - Number(p.from)) > 200 ? ' (whole hand moves)' : ' (re-fanned or lifted)') : ''}`;
  if (p.kind === 'pop') return p.animated ? null : `${p.page}: ${p.what} (${String(p.el).split(' > ').pop()!.split('.').slice(0, 2).join('.')})`;
  return null;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  await takeTurn(join(SHOTS, 'run.lock'), (h) => console.log(`Waiting for another screenshot run to finish: process ${h.pid} in ${h.cwd}. Only one runs at a time.`));
  rmSync(`${out}.previous`, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, `${out}.previous`);
  mkdirSync(join(out, 'clips'), { recursive: true });

  const { server, rooms } = startServer(0, { dir: join(CACHE, 'motion', 'rooms'), botDelayMs: delay }, [], '127.0.0.1');
  await new Promise<void>((ok) => (server.listening ? ok() : server.on('listening', () => ok())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const room = new Room(Room.newCode((c) => rooms.has(c)), { dir: join(CACHE, 'motion', 'rooms'), botDelayMs: delay });
  rooms.set(room.code, room);
  const names = ['Ada', 'Bram', 'Cora', 'Dax', 'Eve', 'Finn'];
  // The phone's seat is a player's (a bot's seat has no phone); this script makes its moves, as a bot would.
  for (let p = 0; p < players; p++) room.join(names[p], p ? 'bot' : 'player');
  room.seats.forEach((s) => (s.seen = Number.MAX_SAFE_INTEGER));

  const chrome = await launchChrome(SHOTS);
  const t0 = Date.now();
  const kinds = new Map<string, { n: number; first: Probe; clips: string[] }>();
  const pending: Promise<void>[] = [];
  let clipNo = 0;
  const pages: Record<string, Page> = {};
  const onProbe = (p: Probe) => {
    appendFileSync(join(out, 'log.jsonl'), JSON.stringify({ ...p, s: +((p.t - t0) / 1000).toFixed(2) }) + '\n');
    const k = kindOf(p);
    if (!k) return;
    let entry = kinds.get(k);
    if (!entry) kinds.set(k, (entry = { n: 0, first: p, clips: [] }));
    entry.n++;
    if (entry.clips.length >= CLIPS_PER_KIND) return;
    const name = `${String(++clipNo).padStart(3, '0')}-${p.page}-${p.kind}`;
    entry.clips.push(name);
    pending.push(sleep(AFTER_S * 1000 + 300).then(() => clip(pages[p.page], p.t, name)));
  };
  const clip = (page: Page, t: number, name: string) => {
    const frames = page.frames.filter((f) => f.t >= t - BEFORE_S * 1000 && f.t <= t + AFTER_S * 1000);
    if (!frames.length) return;
    const dir = join(out, 'clips', name);
    mkdirSync(dir, { recursive: true });
    // Each frame held for as long as the screen showed it.
    const list = frames.map((f, i) => {
      const file = `f${String(i).padStart(3, '0')}.jpg`;
      writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
      const next = frames[i + 1]?.t ?? t + AFTER_S * 1000;
      return `file '${file}'\nduration ${Math.max(0.02, (next - f.t) / 1000).toFixed(3)}`;
    });
    writeFileSync(join(dir, 'frames.txt'), `${list.join('\n')}\nfile 'f${String(frames.length - 1).padStart(3, '0')}.jpg'\n`);
    writeFileSync(join(dir, 'times.txt'), frames.map((f, i) => `f${String(i).padStart(3, '0')}.jpg ${((f.t - t) / 1000).toFixed(3)}s`).join('\n') + '\n');
    // A strip: up to 10 frames from just before the moment on, each labelled with its time from the moment.
    const strip = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.t >= t - 250).slice(0, 10);
    try {
      execFileSync('montage', [...strip.flatMap(({ f, i }) => ['-label', `${((f.t - t) / 1000).toFixed(2)} s`, `f${String(i).padStart(3, '0')}.jpg`]),
        '-tile', `${strip.length}x1`, '-geometry', page === pages.tv ? '480x270+4+4' : '195x422+4+4', '-pointsize', '16', '-background', '#222', '-fill', '#eee', join('..', `${name}.strip.jpg`)], { cwd: dir });
    } catch (e) {
      console.error(`  no strip for ${name}: ${(e as Error).message}`);
    }
    try {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-i', 'frames.txt', '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', join('..', `${name}.gif`)], { cwd: dir });
    } catch (e) {
      console.error(`  no GIF for ${name}: ${(e as Error).message}`);
    }
  };

  try {
    pages.tv = await Page.open(chrome.cdp, TV, `${base}/tv?room=${room.code}`, { [`tv:${room.code}`]: room.hostToken }, onProbe);
    pages.phone = await Page.open(chrome.cdp, PHONE, `${base}/#code=${room.code}&token=${room.seats[0].token}`, {}, onProbe);
    await sleep(4000); // both pages up, the board built
    room.start(room.hostToken, seed);
    console.log(`Room ${room.code}: ${players} bots, seed ${seed}, a move every ${delay} ms, for up to ${minutes} min. TV ${base}/tv?room=${room.code}`);
    // Now and then the phone's player taps a card open while someone else moves, as people do.
    const end = Date.now() + minutes * 60000;
    const rng = { state: seed };
    let ticks = 0, waitingSince = 0, tapped = '';
    while (Date.now() < end && room.game?.phase !== 'over') {
      await sleep(250);
      const g = room.game!;
      const moment = `${g.round}|${g.phase}|${g.turn}`;
      // Off its turn, the phone's player taps a card open now and then, and picks a card to discard.
      if (moment !== tapped && !room.sceneLeft() && ((g.phase === 'action' && g.turn !== 0 && g.round % 2) || (g.phase === 'discard' && waitingOn(g).includes(0)))) {
        tapped = moment;
        await sleep(600);
        await pages.phone.tap('.handfan .card').catch(() => false);
      }
      if (waitingOn(g).includes(0) && !room.sceneLeft()) {
        waitingSince ||= Date.now();
        if (Date.now() - waitingSince > delay * 1.5) {
          room.mutate((g2) => void botMove(g2, 0, rng));
          waitingSince = 0;
        }
      } else waitingSince = 0;
      // The server's bots can miss their turn when a scene's end timer fires a moment
      // early (they wait out the scene, and nothing asks them again): nudge them.
      if (ticks % 20 === 0 && !room.sceneLeft()) room.changed();
      if (++ticks % 8 === 0) process.stdout.write(`\r  ${Math.round((Date.now() - t0) / 1000)} s, round ${g.round}, ${g.phase}       `);
    }
    console.log(room.game?.phase === 'over' ? '\n  The game is over.' : '\n  Time is up.');
    await sleep(6000); // the end screens
    await Promise.all(pending);
    for (const [name, page] of Object.entries(pages)) writeFileSync(join(out, `last-${name}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  } finally {
    chrome.proc.kill();
    server.close();
    await chrome.gone;
  }

  const rows = [...kinds.entries()].sort((a, b) => b[1].n - a[1].n);
  const md = [`# Motion audit: ${players} bots, seed ${seed}`, '', `${Math.round((Date.now() - t0) / 1000)} s of play, round ${room.game?.round}${room.game?.phase === 'over' ? ', to the end of the game' : ''}. Each line: how often it was seen, then its clips (clips/NAME.gif, clips/NAME.strip.jpg with each frame's time from the moment, the frames in clips/NAME/).`, '',
    ...rows.map(([k, e]) => `- **${k}** ×${e.n}${e.clips.length ? `: ${e.clips.join(', ')}` : ''}\n  first: \`${JSON.stringify(e.first)}\``)];
  writeFileSync(join(out, 'report.md'), md.join('\n') + '\n');
  console.log(`${rows.length} kinds of jump. Report: ${join(out, 'report.md')}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
