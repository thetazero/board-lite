// Mid-game disruptions on a hosted save: reloads, double taps, away, quit, take back.
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s2');
  const { log, shot, txt, toasts } = A;
  // TV on the hosted room: the server prints its code; read it from the API listing via the TV? The TV makes a new room,
  // so open it at ?room=CODE as a guest screen.
  const code = process.env.CODE;
  const tvCtx = await A.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = { page: await tvCtx.newPage() };
  await tv.page.goto(`${A.BASE}/tv?room=${code}`);
  await tv.page.waitForTimeout(2500);
  await shot(tv.page, 'tv-hosted');
  const names = ['Ada', 'Bram', 'Cleo'];
  const p = [];
  for (let i = 0; i < 3; i++) {
    p.push(await A.phone('P' + i));
    await p[i].page.goto(`${A.BASE}/${code}`);
    await p[i].page.waitForTimeout(500);
    if (i === 0) await shot(p[0].page, 'p0-open-seats');
    await p[i].page.fill('#name', names[i]);
    await p[i].page.click('button[type=submit]');
    await p[i].page.waitForTimeout(700);
  }
  for (let i = 0; i < 3; i++) log(`P${i} status:`, await txt(p[i].page, '.status'), '| pname', await txt(p[i].page, '.pname'));
  const turn = (await Promise.all(p.map((x) => x.page.$('#end')))).findIndex(Boolean);
  log('acting phone', turn);
  const P = p[turn].page;
  // 1. Build & bank, start picking a hex, then reload
  await P.click('[data-tab="more"]');
  await P.waitForTimeout(300);
  await shot(P, 'build-bank');
  const basic = await P.$('[data-basic]:not([disabled])');
  if (basic) {
    await basic.click();
    await P.waitForTimeout(300);
    await shot(P, 'picker');
    await P.reload();
    await P.waitForTimeout(1500);
    log('after reload during pick:', await txt(P, '.status'), '| picker?', !!(await P.$('.picker')));
    await shot(P, 'after-reload');
  } else log('no basic affordable');
  // 2. offers from both others at once to the acting player, then acting player tries to end turn
  for (const i of [0, 1, 2].filter((x) => x !== turn)) {
    const Q = p[i].page;
    await Q.click('[data-tab="trade"]'); await Q.waitForTimeout(200);
    const st = await Q.$$('[data-step^="give"][data-step$=" 1"]:not([disabled])');
    if (st[0]) await st[0].click();
    const gt = await Q.$$('[data-step^="get"][data-step$=" 1"]:not([disabled])');
    if (gt[0]) await gt[0].click();
    await shot(Q, `p${i}-composing-offer`);
    await Q.click('#offer').catch((e) => log('offer click', e.message.split('\n')[0]));
    await Q.waitForTimeout(500);
    log(`P${i} offer toasts`, await toasts(Q));
  }
  await P.waitForTimeout(500);
  await shot(P, 'two-offers-in');
  log('acting end button:', await txt(P, '#end'));
  // 3. double tap accept on the first and decline on the second quickly
  const acc = await P.$$('[data-accept]');
  log('offers in:', acc.length);
  if (acc.length >= 2) {
    await Promise.all([acc[0].click(), (await P.$$('[data-decline]'))[1].click()]);
    await P.waitForTimeout(800);
    log('after quick accept+decline: offers left', (await P.$$('[data-accept]')).length, 'toasts', await toasts(P));
  }
  for (const d of await P.$$('[data-decline]')) { await d.click().catch(() => {}); await P.waitForTimeout(400); }
  // 4. double tap End turn
  const end = await P.$('#end');
  await end.dblclick();
  await P.waitForTimeout(800);
  log('after dblclick end:', (await Promise.all(p.map((x) => txt(x.page, '.status')))).join(' / '), 'toasts', await toasts(P));
  // 5. the next acting player closes their phone mid-turn
  const turn2 = (await Promise.all(p.map((x) => x.page.$('#end')))).findIndex(Boolean);
  log('next acting', turn2);
  if (turn2 >= 0) {
    await p[turn2].ctx.close();
    const other = p.find((_, i) => i !== turn2);
    for (let t = 0; t < 20; t++) { await other.page.waitForTimeout(1000); if (await other.page.$('[data-standin]')) { log('away line after', t + 1, 's'); break; } }
    await shot(other.page, 'away-line');
    await shot(tv.page, 'tv-away');
    await other.page.click('[data-standin]').catch((e) => log('no standin button', e.message.split('\n')[0]));
    await other.page.waitForTimeout(2500);
    await shot(tv.page, 'tv-after-standin');
    log('statuses after standin:', (await Promise.all(p.filter((_, i) => i !== turn2).map((x) => txt(x.page, '.status')))).join(' / '));
    // they come back on a new phone (new context) and tap their name
    const back = await A.phone('back');
    await back.page.goto(`${A.BASE}/${code}`);
    await back.page.waitForTimeout(800);
    await shot(back.page, 'take-back-list');
    log('seat list:', await txt(back.page));
    const btn = await back.page.$(`[data-seat="${names[turn2]}"]`);
    if (btn) { await btn.click(); await back.page.waitForTimeout(1200); log('back in:', await txt(back.page, '.status')); await shot(back.page, 'back-in'); }
    p[turn2] = back;
  }
  // 6. quit from the menu
  const q = p[(turn + 1) % 3].page;
  await q.click('#menu'); await q.waitForTimeout(300);
  await shot(q, 'menu');
  await q.click('#quit'); await q.waitForTimeout(1200);
  log('after quit:', await txt(q));
  await shot(q, 'after-quit');
  await shot(tv.page, 'tv-after-quit');
  // try to rejoin as somebody else's name (a connected player)
  await q.goto(`${A.BASE}/${code}`); await q.waitForTimeout(800);
  log('quitter sees:', await txt(q));
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
