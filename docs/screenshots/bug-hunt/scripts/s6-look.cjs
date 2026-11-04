// Screens after odd table talk and offers: a long message, markup in a message, a 999-gold offer.
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s6');
  const { log, shot, txt, toasts } = A;
  const code = process.env.CODE;
  const tvCtx = await A.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`${A.BASE}/tv?room=${code}`);
  // a phone takes Ada's seat back (the API seats are not connected)
  const ph = await A.phone('Ada');
  await ph.page.goto(`${A.BASE}/${code}`);
  await ph.page.waitForTimeout(800);
  log(await txt(ph.page));
  const b = await ph.page.$('[data-seat="Ada"]');
  if (b) await b.click();
  await ph.page.waitForTimeout(1500);
  const r = await A.post(`/api/rooms/${code}/join`, { name: 'Zed' });
  log('join Zed', r.status, JSON.stringify(r.body));
  await shot(ph.page, 'ada-phone');
  // long message from Ada's phone through the talk sheet
  await ph.page.click('.talkbar').catch((e) => log('talkbar', e.message.split('\n')[0]));
  await ph.page.waitForTimeout(400);
  await shot(ph.page, 'talk-open');
  const input = await ph.page.$('.talkbar textarea, .talkbar input[type=text], .talkbar input:not([type])');
  log('talk input', !!input, input ? await input.getAttribute('maxlength') : '');
  if (input) {
    await input.fill('Anyone want to trade? ' + 'I really need crystal for the dragon. '.repeat(20));
    await ph.page.keyboard.press('Enter');
    await ph.page.waitForTimeout(800);
    await shot(ph.page, 'talk-after-long');
    log('talk toasts', await toasts(ph.page));
  }
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-feed');
  await ph.page.keyboard.press('Escape');
  await ph.page.mouse.click(200, 100);
  await ph.page.waitForTimeout(500);
  await shot(ph.page, 'ada-after');
  // tap accept on the 999 gold offer, if offered to Ada
  const acc = await ph.page.$$('[data-accept]');
  log('offers to Ada', acc.length, await txt(ph.page, '.offer'));
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
