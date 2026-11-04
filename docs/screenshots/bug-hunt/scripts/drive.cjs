// Bug hunt driver: a TV and one phone per seat, all real pages, playing a whole game
// through the phones' buttons with a loose random policy. Logs every toast, console
// error, page error, failed request and stall, and takes screenshots.
//   node drive.cjs <baseUrl> <players> <outdir> [seed]
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8931';
const N = Number(process.argv[3] || 4);
const OUT = process.argv[4] || path.join(__dirname, 'run');
let seed = Number(process.argv[5] || 1);
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rand() * a.length)];
fs.mkdirSync(OUT, { recursive: true });
const logf = fs.createWriteStream(path.join(OUT, 'log.txt'));
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); logf.write(s + '\n'); };
const NAMES = ['Ada', 'Bram', 'Cleo', 'Dov', 'Esme', 'Finn'];

const INIT = `
  window.__toasts = [];
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push((n.classList.contains('news') ? 'NEWS: ' : '') + n.textContent.trim()); })
    .observe(document, { childList: true, subtree: true });
`;

let shotN = 0;
async function shot(page, name) {
  const f = path.join(OUT, `${String(++shotN).padStart(4, '0')}-${name}.png`);
  try { await page.screenshot({ path: f }); } catch (e) { log('shot failed', name, e.message); }
  return f;
}

function watchPage(page, who) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log(`CONSOLE ${m.type()} [${who}]`, m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log(`PAGEERROR [${who}]`, e.message.slice(0, 300)));
  page.on('requestfailed', (r) => { if (!/events/.test(r.url())) log(`REQFAIL [${who}]`, r.url(), r.failure()?.errorText); });
  page.on('response', (r) => { if (r.status() >= 400) log(`HTTP ${r.status()} [${who}]`, r.url()); });
}

async function toasts(page, who) {
  const t = await page.evaluate(() => { const t = window.__toasts; window.__toasts = []; return t; }).catch(() => []);
  for (const x of t) { log(`TOAST [${who}]`, x); if (!x.startsWith('NEWS')) await shot(page, `toast-${who}`); }
}

// A real tap; if something covers it, say so (a bug a player would hit) and tap it by script.
async function realClick(el, what) {
  try { await el.click({ timeout: 1500 }); return true; } catch (e) {
    const lines = e.message.split('\n').filter((l) => /intercepts|not stable|not visible|not enabled|outside of the viewport|detached|not attached/.test(l));
    const why = lines.length ? [...new Set(lines.map((l) => l.trim().replace(/^- /, '')))].slice(-2).join(' | ') : e.message.split('\n')[0];
    log('COVERED/UNCLICKABLE', what, why.slice(0, 200));
    try { await el.evaluate((x) => x.dispatchEvent(new MouseEvent('click', { bubbles: true }))); return true; } catch { return false; }
  }
}
async function click(page, sel) {
  const el = await page.$(sel);
  if (!el) return false;
  return realClick(el, sel);
}
async function clickRandom(page, sel) {
  const els = await page.$$(sel + ':not([disabled])');
  if (!els.length) return false;
  return realClick(pick(els), sel);
}
const has = (page, sel) => page.$(sel).then((x) => !!x);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' ')).catch(() => '');

const turnBudget = new Map();

// One step for one phone: at most a few clicks. Returns a short label of what it did.
async function step(p, i) {
  const page = p.page;
  if (await has(page, '.pover')) return 'over';
  if (await has(page, '.zoom')) {
    // a card held open: play it if its action is there, else close it
    if (rand() < 0.85 && await clickRandom(page, '.zoom [data-play], .zoom [data-build], .zoom [data-pickhex]')) return 'play-from-zoom';
    await page.keyboard.press('Escape'); await click(page, '.zoom .ghost[aria-label="Close"]');
    if (await has(page, '.zoom')) { const c = await page.$('.zoom [data-card], .zoom'); await page.mouse.click(5, 5); }
    return 'close-zoom';
  }
  if (await has(page, '.picker')) {
    if (rand() < 0.08) { await click(page, '#cancelpick'); return 'cancel-pick'; }
    if (await clickRandom(page, '[data-hex]')) return 'pick-hex';
    await click(page, '#cancelpick'); return 'cancel-pick(no hexes)';
  }
  if (await has(page, '[data-hunter]')) {
    const ds = await page.$$('[data-hunter]');
    for (const d of ds) if (rand() < 0.8) await realClick(d, 'hunter');
    if (await click(page, '#huntgo:not([disabled])')) return 'hunt-go';
    await click(page, '#huntoff'); return 'hunt-off';
  }
  if (await has(page, '[data-keep]')) { await clickRandom(page, '[data-keep]'); return 'keep'; }
  if (await has(page, '#discard')) {
    if (await click(page, '#discard:not([disabled])')) return 'discard';
    { const cs = await page.$$('.handfan .card:not(.picked)'); if (cs.length) await pick(cs).evaluate((e) => e.click()); } return 'discard-pick';
  }
  if (await has(page, '[data-vote]:not([disabled])')) { await clickRandom(page, '[data-vote]'); return 'vote'; }
  if (await has(page, '#ready')) {
    const ds = await page.$$('[data-commit]:not([disabled]):not(.on)');
    if (ds.length && rand() < 0.75) { await realClick(pick(ds), 'commit'); return 'commit'; }
    await click(page, '#ready'); return 'ready';
  }
  if (await has(page, '#fight:not([disabled])')) { await click(page, rand() < 0.75 ? '#fight' : '#bail'); return 'fight/bail'; }
  if (await has(page, '[data-accept]')) { await click(page, rand() < 0.5 ? '[data-accept]' : '[data-decline]'); return 'answer-offer'; }
  // menu accidentally open
  if (await has(page, '.menu')) { await click(page, '#menucancel'); return 'menu-cancel'; }
  const myTurn = await has(page, '#end');
  if (!myTurn) {
    // out of turn: rarely offer the acting player a trade
    if (p.allowTrade && rand() < 0.01 && await has(page, '[data-tab="trade"]')) return await offerTrade(page, 'out');
    return null;
  }
  const status = await text(page, '.status');
  const key = `${i}|${await text(page, '.pts')}|${status}`;
  const b = (turnBudget.get(i) ?? 0) + 1;
  turnBudget.set(i, b);
  if (b > 14) { turnBudget.set(i, 0); if (await click(page, '#end:not([disabled])')) return 'end(budget)'; }
  const r = rand();
  // play a card that glows
  const ready = await page.$$('.handfan .card.ready:not(.dim)');
  if (ready.length && r < 0.6) { await pick(ready).evaluate((e) => e.click()); return 'open-card'; }
  // build & bank
  if (r < 0.8) {
    if (!(await has(page, '.proj'))) { await click(page, '[data-tab="more"]'); }
    if (await clickRandom(page, '[data-basic]')) return 'basic';
    if (rand() < 0.5 && await clickRandom(page, '[data-egg]')) return 'egg';
    if (rand() < 0.3) {
      await clickRandom(page, '[data-bank^="give"]'); await clickRandom(page, '[data-bank^="get"]');
      if (await click(page, '#bankgo:not([disabled])')) return 'bank';
    }
  }
  if (r >= 0.8 && r < 0.88 && await click(page, '#hunt')) return 'hunt';
  if (p.allowTrade && r >= 0.88 && r < 0.92) return await offerTrade(page, 'in-turn');
  // withdraw own open offers sometimes
  if (await has(page, '[data-cancel]') && rand() < 0.3) { await click(page, '[data-cancel]'); return 'withdraw'; }
  turnBudget.set(i, 0);
  if (await click(page, '#end:not([disabled])')) return 'end';
  return null;
}

async function offerTrade(page, why) {
  if (!(await has(page, '.trade, [data-to]'))) await click(page, '[data-tab="trade"]');
  await clickRandom(page, '[data-to]');
  for (let k = 0; k < 2; k++) await clickRandom(page, '[data-step^="give"][data-step$=" 1"]');
  await clickRandom(page, '[data-step^="get"][data-step$=" 1"]');
  const ok = await click(page, '#offer:not([disabled])');
  await click(page, '[data-tab="trade"].on');
  return ok ? `offer(${why})` : 'offer-failed';
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.addInitScript(INIT);
  watchPage(tv, 'TV');
  await tv.goto(`${BASE}/tv`);
  await tv.waitForFunction(() => /\/[A-Z]{4}/.test(location.pathname + location.hash) || document.querySelector('.code'), null, { timeout: 15000 });
  const code = (await tv.$$eval('.code span', (s) => s.map((x) => x.textContent).join(''))) || '';
  log('room', code, 'tv url', tv.url());
  const phones = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.addInitScript(INIT);
    watchPage(page, `P${i}`);
    await page.goto(`${BASE}/${code}`);
    await page.fill('#name', NAMES[i]);
    await page.click('button[type=submit]');
    await page.waitForSelector('.plobby');
    phones.push({ page, ctx, allowTrade: true });
  }
  await shot(tv, 'tv-lobby');
  await shot(phones[0].page, 'p0-lobby');
  await shot(phones[1].page, 'p1-lobby');
  await click(phones[0].page, '#start');
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-start');
  let lastChange = Date.now(); let lastSig = '';
  let round = 0; let iters = 0;
  const start = Date.now();
  const LIMIT_MS = Number(process.env.LIMIT_MS || 40 * 60 * 1000);
  while (Date.now() - start < LIMIT_MS) {
    iters++;
    let acted = false;
    for (let i = 0; i < N; i++) {
      const p = phones[i];
      let what = null;
      try { what = await step(p, i); } catch (e) { log(`STEPERR P${i}`, e.message.split('\n')[0]); }
      if (what === 'over') continue;
      if (what) { acted = true; if (process.env.VERBOSE) log(`P${i}`, what); }
      await toasts(p.page, `P${i}`);
      await p.page.waitForTimeout(40);
    }
    await toasts(tv, 'TV');
    const overs = await Promise.all(phones.map((p) => has(p.page, '.pover')));
    if (overs.every(Boolean)) { log('GAME OVER on every phone'); break; }
    // round tracking via TV text
    const sig = await tv.evaluate(() => document.body.innerText.length + '|' + (document.querySelector('.round, .roundno')?.textContent ?? '')).catch(() => '');
    const pstat = (await Promise.all(phones.map((p) => text(p.page, '.status')))).join(' / ');
    const s2 = sig + pstat;
    if (s2 !== lastSig) { lastSig = s2; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 30000) {
      log('STALL 30s; statuses:', pstat);
      await shot(tv, 'stall-tv'); for (let i = 0; i < N; i++) await shot(phones[i].page, `stall-p${i}`);
      lastChange = Date.now();
    }
    if (iters % 60 === 0) {
      log('status:', pstat);
      await shot(tv, `tv-${iters}`); await shot(phones[iters / 60 % N].page, `p${iters / 60 % N}-${iters}`);
    }
    if (!acted) await tv.waitForTimeout(300);
  }
  await tv.waitForTimeout(3000);
  await shot(tv, 'tv-end');
  for (let i = 0; i < N; i++) await shot(phones[i].page, `p${i}-end`);
  log('done after', Math.round((Date.now() - start) / 1000), 's');
  await browser.close();
})().catch((e) => { log('FATAL', e.stack); process.exit(1); });
