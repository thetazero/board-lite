// The end of a game on real phones, then what a table does next: reloads, New game on the TV and phones.
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s10');
  const { log, shot, txt, toasts } = A;
  const code = process.env.CODE;
  const tvCtx = await A.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  tv.on('pageerror', (e) => log('  PAGEERROR [TV]', e.message));
  await tv.goto(`${A.BASE}/tv?room=${code}`);
  const names = ['Ada', 'Bram', 'Cleo'];
  const p = [];
  for (let i = 0; i < 3; i++) {
    p.push(await A.phone(names[i]));
    await p[i].page.goto(`${A.BASE}/${code}`); await p[i].page.waitForTimeout(500);
    await p[i].page.fill('#name', names[i]); await p[i].page.click('button[type=submit]'); await p[i].page.waitForTimeout(600);
  }
  const jsClick = (page, sel) => page.$eval(sel, (e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))).then(() => true).catch(() => false);
  const t0 = Date.now();
  let over = false;
  while (Date.now() - t0 < 900000 && !over) {
    for (const x of p) {
      const pg = x.page;
      if (await pg.$('.pover')) continue;
      if (await pg.$('[data-keep]')) { await jsClick(pg, '[data-keep]'); continue; }
      if (await pg.$('#discard')) {
        if (!(await jsClick(pg, '#discard:not([disabled])'))) await jsClick(pg, '.handfan .card:not(.picked)');
        continue;
      }
      if (await jsClick(pg, '[data-vote]:not([disabled])')) continue;
      if (await pg.$('#ready')) { await jsClick(pg, '[data-commit]:not(.on):not([disabled])'); await pg.waitForTimeout(300); await jsClick(pg, '#ready'); continue; }
      if (await jsClick(pg, '#fight:not([disabled])')) continue;
      if (await jsClick(pg, '[data-decline]')) continue;
      if (await pg.$('#end')) {
        // tower floors are points: build one if we can, else end
        if (!(await pg.$('.proj'))) await jsClick(pg, '[data-tab="more"]');
        const floor = await pg.$$eval('[data-basic]:not([disabled])', (bs) => bs.map((b) => b.dataset.basic));
        if (floor.includes('floor') || floor.includes('towerFloor') || floor.some((f) => /floor/i.test(f))) { await jsClick(pg, `[data-basic="${floor.find((f) => /floor/i.test(f))}"]`); await pg.waitForTimeout(400); continue; }
        await jsClick(pg, '#end:not([disabled])');
      }
    }
    await p[0].page.waitForTimeout(300);
    over = (await Promise.all(p.map((x) => x.page.$('.pover')))).every(Boolean);
  }
  log('over?', over, 'after', Math.round((Date.now() - t0) / 1000), 's');
  await tv.waitForTimeout(4000);
  await shot(tv, 'tv-over');
  for (let i = 0; i < 3; i++) await shot(p[i].page, `p${i}-over`);
  log('TV over text:', (await txt(tv)).slice(0, 300));
  // reload a phone after the end
  await p[1].page.reload(); await p[1].page.waitForTimeout(1500);
  log('P1 after reload:', (await txt(p[1].page)).slice(0, 120));
  // TV New game
  await tv.click('#again').catch((e) => log('no #again', e.message.split('\n')[0]));
  await tv.waitForTimeout(2000);
  log('TV after New game: url', tv.url(), (await txt(tv)).slice(0, 120));
  await shot(tv, 'tv-new-game');
  // phone New game
  await p[0].page.click('#newgame').catch((e) => log('no #newgame', e.message.split('\n')[0]));
  await p[0].page.waitForTimeout(1200);
  log('P0 after New game:', (await txt(p[0].page)).slice(0, 200));
  await shot(p[0].page, 'p0-new-game');
  // P2 rescans the TV's new QR: opens the new room address
  const newCode = await tv.$$eval('.code span', (x) => x.map((y) => y.textContent).join('')).catch(() => '');
  await p[2].page.goto(`${A.BASE}/${newCode}`); await p[2].page.waitForTimeout(1200);
  log('P2 opening new room:', (await txt(p[2].page)).slice(0, 200));
  await shot(p[2].page, 'p2-new-room');
  // P1 (still on the old room) opens the bare address
  await p[1].page.goto(`${A.BASE}/`); await p[1].page.waitForTimeout(1200);
  log('P1 bare address:', (await txt(p[1].page)).slice(0, 200));
  for (let i = 0; i < 3; i++) log(`P${i} toasts`, await toasts(p[i].page));
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
