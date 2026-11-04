// The raid on real phones: vote, quick taps on two dragons, reload mid-commit, TV reload mid-fight.
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s4');
  const { log, shot, txt, toasts } = A;
  const code = process.env.CODE;
  const N = Number(process.env.N || 3);
  const tvCtx = await A.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  tv.on('pageerror', (e) => log('  PAGEERROR [TV]', e.message));
  await tv.goto(`${A.BASE}/tv?room=${code}`);
  const names = ['Ada', 'Bram', 'Cleo', 'Dov'];
  const p = [];
  for (let i = 0; i < N; i++) {
    p.push(await A.phone('P' + i));
    await p[i].page.goto(`${A.BASE}/${code}`);
    await p[i].page.waitForTimeout(500);
    await p[i].page.fill('#name', names[i]);
    await p[i].page.click('button[type=submit]');
    await p[i].page.waitForTimeout(700);
  }
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-vote');
  await shot(p[0].page, 'p0-vote');
  for (let i = 0; i < N; i++) { const v = await p[i].page.$('[data-vote]:not([disabled])'); if (v) await v.click(); await p[i].page.waitForTimeout(300); }
  await tv.waitForTimeout(2000);
  for (let i = 0; i < N; i++) log(`P${i}:`, await txt(p[i].page, '.status'), '| commit buttons', (await p[i].page.$$('[data-commit]:not([disabled])')).length);
  await shot(tv, 'tv-commit');
  // quick taps on two dragons
  for (let i = 0; i < N; i++) {
    const ds = await p[i].page.$$('[data-commit]:not([disabled])');
    if (ds.length >= 2) {
      // a person taps one dragon, then the next, about a fifth of a second apart
      const b0 = await ds[0].boundingBox(); const b1 = await ds[1].boundingBox();
      await p[i].page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2);
      await p[i].page.waitForTimeout(Number(process.env.GAP || 200));
      await p[i].page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
      await p[i].page.waitForTimeout(1000);
      log(`P${i} after two quick taps: on =`, (await p[i].page.$$('[data-commit].on')).length, 'button:', await txt(p[i].page, '#ready'));
      await shot(p[i].page, `p${i}-two-taps`);
    } else if (ds.length === 1) {
      await ds[0].click(); await p[i].page.waitForTimeout(600);
      // reload mid-commit
      await p[i].page.reload(); await p[i].page.waitForTimeout(1500);
      log(`P${i} after reload mid-commit: on =`, (await p[i].page.$$('[data-commit].on')).length, await txt(p[i].page, '#ready'));
    }
  }
  for (let i = 0; i < N; i++) { const r = await p[i].page.$('#ready'); if (r) await r.click(); await p[i].page.waitForTimeout(300); }
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-fightbail');
  for (let i = 0; i < N; i++) log(`P${i}:`, await txt(p[i].page, '.status'), '| fight?', !!(await p[i].page.$('#fight:not([disabled])')));
  await shot(p[0].page, 'p0-fightbail');
  for (let i = 0; i < N; i++) { const f = await p[i].page.$('#fight:not([disabled])'); if (f) { await f.click(); await p[i].page.waitForTimeout(300); } }
  // TV reload mid-replay
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-replay-1');
  await tv.reload();
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-replay-after-reload');
  await tv.waitForTimeout(6000);
  await shot(tv, 'tv-replay-later');
  for (let i = 0; i < N; i++) { log(`P${i}:`, await txt(p[i].page, '.status')); await shot(p[i].page, `p${i}-after-raid`); }
  for (let i = 0; i < N; i++) log(`P${i} toasts`, await toasts(p[i].page));
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
