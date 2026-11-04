// Does "X is away. Let a bot play" ever appear when the acting player's phone closes?
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s3');
  const { log, shot, txt } = A;
  const code = process.env.CODE;
  const tvCtx = await A.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`${A.BASE}/tv?room=${code}`);
  const names = ['Ada', 'Bram', 'Cleo'];
  const p = [];
  for (let i = 0; i < 3; i++) {
    p.push(await A.phone('P' + i));
    await p[i].page.goto(`${A.BASE}/${code}`);
    await p[i].page.waitForTimeout(500);
    await p[i].page.fill('#name', names[i]);
    await p[i].page.click('button[type=submit]');
    await p[i].page.waitForTimeout(700);
  }
  const turn = (await Promise.all(p.map((x) => x.page.$('#end')))).findIndex(Boolean);
  log('acting', turn, names[turn]);
  const t0 = Date.now();
  await p[turn].ctx.close();
  const other = p[(turn + 1) % 3].page;
  let seen = false;
  while (Date.now() - t0 < 120000) {
    await other.waitForTimeout(2000);
    if (await other.$('[data-standin]')) { log('away line appeared after', Math.round((Date.now() - t0) / 1000), 's'); seen = true; break; }
  }
  if (!seen) log('NO away line after 120 s. status:', await txt(other, '.status'));
  await shot(other, 'after-120s');
  await shot(tv, 'tv-after-120s');
  // now any other change: the third phone reloads
  await p[(turn + 2) % 3].page.reload();
  await other.waitForTimeout(1500);
  log('after another phone reloads: away line?', !!(await other.$('[data-standin]')), await txt(other, '.status'));
  await shot(other, 'after-other-reload');
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
