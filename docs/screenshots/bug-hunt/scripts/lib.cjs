const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8931';
const INIT = `
  window.__toasts = [];
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push((n.classList.contains('news') ? 'NEWS: ' : '') + n.textContent.trim()); })
    .observe(document, { childList: true, subtree: true });
`;
async function setup(outName) {
  const OUT = path.join(__dirname, outName);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let n = 0;
  const log = (...a) => console.log(...a);
  const watch = (page, who) => {
    page.on('console', (m) => { if (m.type() === 'error') log(`  CONSOLE [${who}]`, m.text().slice(0, 200)); });
    page.on('pageerror', (e) => log(`  PAGEERROR [${who}]`, e.message.slice(0, 300)));
  };
  const api = {
    BASE, OUT, browser, log,
    async tv() {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage(); await page.addInitScript(INIT); watch(page, 'TV');
      await page.goto(`${BASE}/tv`);
      await page.waitForSelector('.code span');
      const code = await page.$$eval('.code span', (s) => s.map((x) => x.textContent).join(''));
      return { page, ctx, code };
    },
    async phone(who, opts = {}) {
      const ctx = opts.ctx || await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); await page.addInitScript(INIT); watch(page, who);
      return { page, ctx };
    },
    async join(p, code, name) {
      await p.page.goto(`${BASE}/${code}`);
      await p.page.fill('#name', name);
      await p.page.click('button[type=submit]');
      await p.page.waitForTimeout(500);
    },
    async shot(page, name) { const f = path.join(OUT, `${String(++n).padStart(3, '0')}-${name}.png`); await page.screenshot({ path: f }); log('  shot', f); return f; },
    async toasts(page) { return page.evaluate(() => { const t = window.__toasts; window.__toasts = []; return t; }); },
    txt: (page, sel = 'body') => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(none)'),
    async post(url, body) { const r = await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; },
  };
  return api;
}
module.exports = { setup };
