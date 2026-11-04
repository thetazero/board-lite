// Lobby edge cases: names, duplicate joins, double start, leaving, TV reload.
const { setup } = require('./lib.cjs');
(async () => {
  const A = await setup('s1');
  const { log, shot, txt, toasts } = A;
  const tv = await A.tv();
  log('room', tv.code);
  const p = [];
  for (let i = 0; i < 6; i++) p.push(await A.phone('P' + i));
  // 1. HTML in a name, emoji, wide names, whitespace
  await A.join(p[0], tv.code, '  <b>Ada</b> ');
  log('P0 after join:', (await txt(p[0].page, 'h1')));
  await A.join(p[1], tv.code, '🐉🐉🐉🐉🐉🐉');
  log('P1:', await txt(p[1].page, 'h1'), '|', await txt(p[1].page, '.error'));
  await A.join(p[2], tv.code, 'WWWWWWWWWWWW');
  log('P2:', await txt(p[2].page, 'h1'));
  // 2. same name, different case
  await A.join(p[3], tv.code, 'wwwwwwwwwwww');
  log('P3 dup case:', await txt(p[3].page, '.error'));
  // 3. lowercase room code via bare address
  await p[3].page.goto(A.BASE + '/');
  await p[3].page.fill('#code', tv.code.toLowerCase());
  await p[3].page.fill('#name', 'Dov');
  await p[3].page.click('button[type=submit]');
  await p[3].page.waitForTimeout(500);
  log('P3 lowercase code:', await txt(p[3].page, 'h1'), '|', await txt(p[3].page, '.error'));
  // 4. a name only of zero-width / special chars
  await A.join(p[4], tv.code, '​​');
  log('P4 zero-width:', await txt(p[4].page, 'h1'), '|', await txt(p[4].page, '.error'));
  await shot(tv.page, 'tv-lobby-names');
  await shot(p[1].page, 'p1-lobby-emoji');
  // 5. back button after join
  await p[2].page.goBack().catch(() => {});
  await p[2].page.waitForTimeout(800);
  log('P2 after back:', (await txt(p[2].page)).slice(0, 150));
  await p[2].page.goForward().catch(() => {});
  await p[2].page.waitForTimeout(800);
  log('P2 after forward:', (await txt(p[2].page)).slice(0, 150));
  // 6. same phone, second tab
  const p2b = await A.phone('P2b', { ctx: p[2].ctx });
  await p2b.page.goto(A.BASE + '/' + tv.code);
  await p2b.page.waitForTimeout(800);
  log('P2 second tab:', (await txt(p2b.page)).slice(0, 150));
  // 7. first player leaves: does the second get Start?
  await p[0].page.click('#leave');
  await p[0].page.waitForTimeout(800);
  log('P0 after leave:', (await txt(p[0].page)).slice(0, 150));
  log('P1 now has start?', !!(await p[1].page.$('#start')));
  // 8. P0 rejoins with same name
  await p[0].page.fill('#name', 'Ada');
  await p[0].page.click('button[type=submit]');
  await p[0].page.waitForTimeout(500);
  log('P0 rejoin:', await txt(p[0].page, 'h1'));
  // 9. TV reload in lobby keeps room + host powers
  await tv.page.reload();
  await tv.page.waitForTimeout(1500);
  const code2 = await tv.page.$$eval('.code span', (s) => s.map((x) => x.textContent).join(''));
  log('TV reload code', code2, 'same?', code2 === tv.code, 'url', tv.page.url());
  // 10. TV and phone start at once
  const r = await Promise.allSettled([tv.page.click('#start'), p[1].page.click('#start')]);
  await tv.page.waitForTimeout(1500);
  log('toasts TV', await toasts(tv.page), 'P1', await toasts(p[1].page));
  await shot(tv.page, 'tv-started');
  await shot(p[1].page, 'p1-started');
  await shot(p2b.page, 'p2b-started');
  log('P2 tab A:', (await txt(p[2].page, '.status')), '| tab B:', await txt(p2b.page, '.status'));
  // 11. join after start with a new name
  await A.join(p[5], tv.code, 'Late');
  log('P5 late join:', (await txt(p[5].page)).slice(0, 200));
  await shot(p[5].page, 'p5-late');
  // 12. join after start with name of a connected player
  await p[5].page.goto(A.BASE + '/' + tv.code);
  await p[5].page.waitForTimeout(500);
  log('P5 seat list:', (await txt(p[5].page)).slice(0, 200));
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
