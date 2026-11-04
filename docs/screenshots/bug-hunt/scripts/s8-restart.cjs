// A server restart mid-game: what the TV and a phone with a remembered seat do.
const { setup } = require('./lib.cjs');
const { spawn } = require('child_process');
const REPO = require('path').resolve(__dirname, '../../../..');
const serve = (args) => { const p = spawn('node', ['src/server/server.ts', '--port', '8937', ...args], { cwd: REPO }); let out = ''; p.stdout.on('data', (d) => (out += d)); return { p, out: () => out }; };
(async () => {
  const A = await setup('s8');
  process.env.BASE = 'http://localhost:8937';
  const { log, shot, txt } = A;
  const BASE = 'http://localhost:8937';
  let s = serve([]);
  await new Promise((r) => setTimeout(r, 1500));
  const tvCtx = await A.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`${BASE}/tv`); await tv.waitForSelector('.code span');
  const code = await tv.$$eval('.code span', (x) => x.map((y) => y.textContent).join(''));
  const p = [];
  for (const n of ['Ada', 'Bram']) { const ph = await A.phone(n); await ph.page.goto(`${BASE}/${code}`); await ph.page.fill('#name', n); await ph.page.click('button[type=submit]'); await ph.page.waitForTimeout(600); p.push(ph); }
  await p[0].page.click('#start'); await p[0].page.waitForTimeout(1500);
  log('before restart', await txt(p[0].page, '.status'), '|', await txt(p[1].page, '.status'));
  s.p.kill(); await new Promise((r) => setTimeout(r, 1000));
  await p[0].page.waitForTimeout(2000);
  await shot(p[0].page, 'phone-server-down');
  s = serve(['--game', `${process.env.HOME}/.cache/board-lite/rooms/${code}.json`]);
  await new Promise((r) => setTimeout(r, 2500));
  log('server says:', s.out().split('\n')[1]);
  await p[0].page.waitForTimeout(6000);
  log('phone after restart (no reload):', (await txt(p[0].page)).slice(0, 160));
  await shot(p[0].page, 'phone-after-restart');
  await p[0].page.reload(); await p[0].page.waitForTimeout(1500);
  log('phone after reload:', (await txt(p[0].page)).slice(0, 200));
  await shot(p[0].page, 'phone-after-restart-reload');
  await tv.reload(); await tv.waitForTimeout(2500);
  log('TV after reload: url', tv.url(), '|', (await txt(tv)).slice(0, 160));
  await shot(tv, 'tv-after-restart-reload');
  // Bram joins first this time, in the re-hosted room
  const m = /room ([A-Z]{4})/.exec(s.out());
  if (m) {
    await p[1].page.goto(`${BASE}/${m[1]}`); await p[1].page.waitForTimeout(800);
    log('Bram sees:', (await txt(p[1].page)).slice(0, 200));
    await p[1].page.fill('#name', 'Bram').catch(() => {}); await p[1].page.click('button[type=submit]').catch(() => {}); await p[1].page.waitForTimeout(1500);
    log('Bram got seat named:', await txt(p[1].page, '.pname'));
    await shot(p[1].page, 'bram-rejoined');
  }
  s.p.kill();
  await A.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
