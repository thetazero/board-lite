// The server itself, as it's run: `npm run serve` at home, and the website.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIN = join(ROOT, 'rust/target/home/board-lite');
const tmp = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
const running = new Set<ChildProcess>();
after(() => {
  for (const c of running) c.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
});

test('it opens more files than the usual soft limit, so saving goes on with many streams open', { skip: process.platform !== 'linux' && 'reads /proc' }, async () => {
  const child = spawn('sh', ['-c', 'ulimit -S -n 256; exec "$0"', BIN], { env: { ...process.env, PORT: '0', BOARD_LITE_DATA: join(tmp, 'files'), BOARD_LITE_PUBLIC_URL: 'https://dragons.example' }, stdio: ['ignore', 'pipe', 'inherit'] });
  running.add(child);
  await once(child.stdout!, 'data');
  const [, soft, hard] = /Max open files\s+(\d+)\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/limits`, 'utf8'))!;
  assert.ok(Number(soft) > 256 && soft === hard, `${soft} of ${hard}`);
  child.kill('SIGKILL');
  running.delete(child);
});

test('at home: addresses, strong bots, saved games, a game file hosted, and Claude players brought back', { timeout: 60000 }, async () => {
  const dir = join(tmp, 'home'), bin = join(tmp, 'bin'), runner = join(tmp, 'runner');
  for (const d of [bin, runner]) mkdirSync(d);
  // A stand-in for node: what the server would start, written down and not run.
  writeFileSync(join(bin, 'node'), `#!/bin/sh\necho "$@" >> ${join(tmp, 'started')}\n`);
  chmodSync(join(bin, 'node'), 0o755);
  const start = async (...args: string[]) => {
    const { BOARD_LITE_PUBLIC_URL: _, ...rest } = process.env;
    const child = spawn(BIN, ['--port', '0', '--data', dir, ...args], { cwd: ROOT, env: { ...rest, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'inherit'] });
    running.add(child);
    const said = String((await once(child.stdout!, 'data'))[0]);
    const url = `http://127.0.0.1:${/port (\d+)/.exec(said)![1]}`;
    const api = async (path: string, body?: object) => (await fetch(url + path, body ? { method: 'POST', body: JSON.stringify(body) } : {})).json() as any;
    return { said, url, api, stop: async () => { child.kill('SIGTERM'); await once(child, 'exit'); running.delete(child); } };
  };
  let s = await start();
  const info = await s.api('/api/info');
  assert.equal(`http://127.0.0.1:${info.port}`, s.url);
  assert.ok(Array.isArray(info.lan) && Array.isArray(info.tailscale) && !('origin' in info));
  assert.equal((await fetch(s.url)).headers.get('content-security-policy'), null);
  const { code, hostToken } = await s.api('/api/rooms', { remote: true });
  const { token } = await s.api(`/api/rooms/${code}/join`, { name: 'Ada' });
  await s.api(`/api/rooms/${code}/bot`, { token, strong: true });
  const { lobby } = await s.api(`/api/rooms/${code}`);
  assert.equal(lobby.seats[1].strong, true);
  assert.equal(lobby.file, join(dir, `${code}.json`));
  await s.api(`/api/rooms/${code}/start`, { token: hostToken });
  assert.deepEqual(await s.api('/api/saved'), []);
  // The strong bot keeps its card on its own.
  let st = await s.api(`/api/rooms/${code}/state?token=${token}`);
  for (let i = 0; i < 50 && st.game.waitingOn.includes(1); i++) {
    await new Promise((r) => setTimeout(r, 100));
    st = await s.api(`/api/rooms/${code}/state?token=${token}`);
  }
  assert.deepEqual(st.game.waitingOn, [0], 'the strong bot moved');
  await s.api(`/api/rooms/${code}/save`, { token });
  writeFileSync(join(dir, `${code}.claude.json`), JSON.stringify({ runners: [runner, join(tmp, 'gone')] }));
  await s.stop();
  s = await start();
  const [saved] = await s.api('/api/saved');
  assert.deepEqual([saved.code, saved.round, saved.names], [code, 1, ['Ada', 'Tick']]);
  await s.api(`/api/rooms/${code}/continue`, { token });
  for (let i = 0; i < 50 && !existsSync(join(tmp, 'started')); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(readFileSync(join(tmp, 'started'), 'utf8').trim(), `src/playtest/run.ts --resume ${runner} --room ${s.url}/${code}`);
  await s.stop();
  // A game file from elsewhere: every seat starts open.
  const file = join(tmp, 'other.json');
  writeFileSync(file, readFileSync(join(dir, `${code}.json`)));
  s = await start('--game', file);
  const hosted = /Hosting (\S+other\.json) as room (\w+)/.exec(s.said)!;
  assert.deepEqual((await s.api(`/api/rooms/${hosted[2]}`)).lobby.seats.map((x: any) => x.kind), ['open', 'open']);
  await s.stop();
});
