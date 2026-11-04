// Accepting an offer you can't pay for: the Accept button, and what happens.
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s9');
  const code = process.env.CODE;
  const ph = await A.phone('Ada');
  await ph.page.goto(`${A.BASE}/${code}`); await ph.page.waitForTimeout(800);
  const b = await ph.page.$('[data-seat="Ada"]'); if (b) await b.click();
  await ph.page.waitForTimeout(1500);
  A.log('offers:', await A.txt(ph.page, '.pbody'));
  const offers = await ph.page.$$('.offer.in');
  for (const o of offers) {
    const t = await o.innerText();
    if (/999/.test(t)) {
      await (await o.$('[data-accept]')).click();
      await ph.page.waitForTimeout(400);
      await A.shot(ph.page, 'accept-999');
      A.log('toast', await A.toasts(ph.page));
    }
  }
  await A.browser.close();
})();
