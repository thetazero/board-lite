// The Rust website against the Node one: the same requests, in the same order,
// get the same answers, and a room one hosted goes on under the other.
// Skipped until it's built: npm run rust:build. CI builds it.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIN = join(ROOT, 'rust/target/release/board-lite');
const skip = existsSync(BIN) ? false : 'the Rust server is not built (npm run rust:build)';
const tmp = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
const running = new Set<ChildProcess>();
after(() => {
  for (const c of running) c.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
});

type Which = 'node' | 'rust';
async function host(which: Which, dir: string) {
  const probe = createServer().listen(0);
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  await once(probe, 'close');
  const env = { ...process.env, PORT: String(port), BOARD_LITE_DATA: dir, BOARD_LITE_PUBLIC_URL: 'https://dragons.example', BOARD_LITE_TRUST_PROXY: '1', NODE_NO_WARNINGS: '1' };
  const child = which === 'rust' ? spawn(BIN, { env, stdio: ['ignore', 'pipe', 'inherit'] }) : spawn(process.execPath, [join(ROOT, 'src/server/server.ts')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  running.add(child);
  await once(child.stdout!, 'data');
  const url = `http://127.0.0.1:${port}`;
  let who = '203.0.113.1';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(url + path, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { 'x-forwarded-for': who, ...headers } });
    const text = await r.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: Object.fromEntries(r.headers), data };
  };
  return {
    url, port, call,
    as: (ip: string) => { who = ip; },
    post: (path: string, body: unknown = {}) => call('POST', path, body),
    get: (path: string, headers = {}) => call('GET', path, undefined, headers),
    stop: async () => {
      child.kill('SIGTERM');
      const [code] = await once(child, 'exit');
      running.delete(child);
      assert.equal(code, 0, `${which} stops when asked`);
    },
  };
}
type Host = Awaited<ReturnType<typeof host>>;

// What differs from run to run: the code, tokens, dice and times.
function tame(v: unknown, names: Map<string, string>): unknown {
  if (typeof v === 'string') return [...names].reduce((s, [a, b]) => s.replaceAll(a, b), v);
  if (Array.isArray(v)) return v.map((x) => tame(x, names));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tame(x, names)]));
  return v;
}
const HEADERS = ['content-type', 'cache-control', 'etag', 'vary', 'allow', 'content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-robots-tag', 'x-accel-buffering'];

// One visit, start to finish; what each request was answered.
async function visit(s: Host) {
  const out: unknown[] = [];
  const names = new Map<string, string>();
  const note = (what: string, r: { status: number; headers: Record<string, string>; data: unknown }, body = true) => {
    const headers = Object.fromEntries(HEADERS.flatMap((h) => (r.headers[h] ? [[h, r.headers[h]]] : [])));
    out.push([what, r.status, headers, body ? tame(r.data, names) : typeof r.data]);
    return r.data as any;
  };
  for (const p of ['/', '/tv', '/phone.ts', '/board3d.ts', '/style.css', '/favicon.ico', '/ABCD', '/ABCD/', '/llms.txt', '/ABCD.md', '/abcd.md', '/recap/0123456789ab', '/recap/x', '/nope', '/.git', '/tsconfig.json', '/vendor/three/three.core.js', '/vendor/three/three.module.js', '/vendor/three/x.js', '/healthz', '/api/info', '/api/rulebook', '/api/saved', '/api/recaps/0123456789ab', '/api/recaps/zz', '/api/nope', '/api/rooms', '/api/rooms/QQQQ', '/api/rooms/ab%20c', '/mcp', '/ab/cd', '/api']) note(p, await s.get(p));
  const etag = (await s.get('/phone.ts')).headers.etag;
  note('304', await s.get('/phone.ts', { 'if-none-match': etag }));
  note('markdown', await s.get('/abcd', { accept: 'text/html;q=0.5, text/markdown' }));
  note('bad JSON', await s.post('/api/rooms', '{'));
  note('not an object', await s.post('/mcp', '[1]'));
  note('too long', await s.post('/api/rooms', JSON.stringify({ x: 'x'.repeat(5000) })));
  const { code, hostToken } = (await s.post('/api/rooms', { remote: true })).data;
  names.set(code, 'CODE').set(hostToken, 'HOST');
  const room = (action = '') => `/api/rooms/${code}${action && `/${action}`}`;
  const join = async (name: unknown, via?: string) => {
    const r = await s.post(room('join'), { name, via });
    if (r.data.token) names.set(r.data.token, `TOKEN ${r.data.seat}`);
    note(`join ${String(name)}`, r);
    return r.data.token as string;
  };
  note('room', await s.get(room()));
  note('no one', await s.post(room('start'), { token: hostToken }));
  const ada = await join('  Ada​   Lovelace the First ', 'phone');
  for (const name of ['', 5, 'ㅤ', '́', 'ada lovelace', 'ADA LOVELACE']) await join(name);
  const bram = await join('👩‍👩‍👧 Bram', 'cli');
  note('lower case', await s.get(`/api/rooms/${code.toLowerCase()}?token=${bram}`));
  note('start, not first', await s.post(room('start'), { token: bram }));
  note('remove another', await s.post(room('leave'), { token: bram, seat: 0 }));
  note('remove no one', await s.post(room('leave'), { token: hostToken, seat: 7 }));
  note('bot, not first', await s.post(room('bot'), { token: bram }));
  note('bot', await s.post(room('bot'), { token: ada, strong: true }));
  note('kick the bot', await s.post(room('leave'), { token: ada, seat: 2 }));
  note('bot again', await s.post(room('bot'), { token: ada }));
  note('save too soon', await s.post(room('save'), { token: ada }));
  note('quit in the lobby', await s.post(room('quit'), { token: 'x' }));
  note('do too soon', await s.post(room('do'), { token: ada, command: 'end' }));
  note('lobby state', await s.get(room(`state?token=${ada}`)));
  note('no seat', await s.get(room('state?token=wrong')));
  note('tv', await s.post(room('tv')));
  note('odd', await s.post(room('odd')));
  note('odd get', await s.get(room('odd')));
  note('put', await s.call('PUT', room('start'), {}));
  note('start', await s.post(room('start'), { token: ada }));
  note('start again', await s.post(room('start'), { token: ada }));
  note('late', await s.post(room('join'), { name: 'Late' }));
  note('taken', await s.post(room('join'), { name: 'Ada Lovelace' }));
  const shape = (v: any): unknown => (Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, /^-?\d+,-?\d+$/.test(k) ? 'hex' : true])) : typeof v);
  const st = (await s.get(room(`state?token=${ada}`))).data;
  out.push(['state', shape(st), shape(st.game), shape(st.you), shape(st.lobby), st.seat, st.you.name, tame(st.lobby, names)]);
  const did = await s.post(room('do'), { token: ada, command: `keep ${st.you.choice[0].id}`, via: 'phone', id: 'one' });
  out.push(['keep', did.status, did.data.state.you.choice.length]);
  const twice = await s.post(room('do'), { token: ada, command: `keep ${st.you.choice[0].id}`, via: 'phone', id: 'one' });
  out.push(['retried', twice.status, twice.data.state.you.choice.length]);
  note('kept already', await s.post(room('do'), { token: ada, command: 'keep c1' }));
  note('the TV plays', await s.post(room('do'), { token: hostToken, command: 'end' }));
  const wait = (await s.get(room(`wait?token=${bram}&timeout=5`))).data;
  out.push(['wait', wait.code, shape(wait.state)]);
  const heard = (await s.get(room(`listen?token=${bram}&since=0`))).data;
  out.push(['listen', Object.keys(heard).sort(), shape(heard.events), heard.next > 5, shape(heard.state)]);
  note('stand in for one who is here', await s.post(room('standin'), { token: ada, seat: 1 }));
  note('stand in for no one', await s.post(room('standin'), { token: ada, seat: 'x' }));
  note('not saved', await s.post(room('continue'), { token: ada }));
  note('save', await s.post(room('save'), { token: ada }));
  note('saved', await s.post(room('do'), { token: bram, command: 'end' }));
  note('say while saved', await s.post(room('do'), { token: bram, command: 'say hello' }));
  note('continue', await s.post(room('continue'), { token: bram }));
  // A phone's stream, and a TV's.
  const sse = async (path: string) => {
    const stop = new AbortController();
    const r = await fetch(s.url + path, { signal: stop.signal, headers: { 'x-forwarded-for': '203.0.113.9' } });
    let got = '';
    for await (const c of r.body!) {
      got += Buffer.from(c).toString();
      if (got.includes('\n\n')) break;
    }
    stop.abort();
    const first = JSON.parse(/^data: (.*)\n\n/.exec(got)![1]);
    return [r.status, r.headers.get('content-type'), r.headers.get('x-accel-buffering'), shape(first), first.seat, !!first.you];
  };
  out.push(['phone', await sse(room(`events?token=${ada}`))]);
  out.push(['tv', await sse(room('events?tv=1'))]);
  out.push(['stranger', await sse(room('events?token=wrong'))]);
  // A Claude client.
  const rpc = async (method: string, params: object = {}, id: unknown = 1) => s.post('/mcp', { jsonrpc: '2.0', id, method, params });
  const tool = async (name: string, args: object) => rpc('tools/call', { name, arguments: args });
  for (const [m, p, id] of [['initialize', { protocolVersion: '2025-06-18' }], ['initialize', {}], ['ping'], ['tools/list'], ['nope'], ['notifications/initialized', {}, null], ['ping', {}, 'x'], ['tools/call', { name: 'nope' }], ['tools/call', {}]] as [string, object?, unknown?][]) note(m, await rpc(m, p, id === undefined ? 1 : id));
  note('rules', await tool('rules', {}));
  for (const game of ['', 'https://x.example/', 'https://x.example/tv?room=QQQQ', code.toLowerCase()]) note(`view ${game === code.toLowerCase() ? 'code' : game}`, await tool('view', { game, token: 'wrong' }));
  const joined = await tool('join', { game: `https://dragons.example/${code}`, name: 'Claude' });
  note('join late', joined);
  const other = (await s.post('/api/rooms', {})).data;
  names.set(other.code, 'OTHER').set(other.hostToken, 'OTHERHOST');
  const j = (await tool('join', { game: other.code, name: 'Claude' })).data.result.content[0].text;
  const tok = /token: (\w+)/.exec(j)![1];
  names.set(tok, 'CLAUDE');
  out.push(['joined', tame(j, names)]);
  note('wait in the lobby', await tool('act', { game: other.code, token: tok, command: 'end' }));
  note('view the lobby', await tool('view', { game: other.code, token: tok }));
  await s.post(`/api/rooms/${other.code}/bot`, { token: other.hostToken });
  await s.post(`/api/rooms/${other.code}/start`, { token: other.hostToken });
  const view = (await tool('view', { game: other.code, token: tok })).data.result.content;
  out.push(['view', view.map((c: any) => [c.type, c.mimeType]), view[0].text.split('\n').filter((l: string) => l.startsWith('=='))]);
  const said = (await tool('say', { game: other.code, token: tok, message: 'Hello', to: 'P2' })).data.result;
  out.push(['say', said.isError, said.content[0].text.split('\n').slice(0, 1), /P1 to P2 \(private\): "Hello"/.test(said.content[0].text)]);
  note('refused', await tool('act', { game: other.code, token: tok, command: 'nonsense' }));
  // Mid-game, someone quits, and takes their seat back.
  note('quit', await s.post(room('quit'), { token: bram }));
  note('quit is gone', await s.post(room('do'), { token: bram, command: 'end' }));
  await join('👩‍👩‍👧 bram');
  // The limits.
  s.as('203.0.113.50');
  for (let i = 0; i < 31; i++) {
    const r = await s.get('/api/rooms/QQQQ');
    if (i > 28) note(`wrong code ${i}`, r);
  }
  s.as('203.0.113.51');
  const made = [];
  for (let i = 0; i < 21; i++) made.push((await s.post('/api/rooms', {})).status);
  out.push(['rooms', made]);
  return { out, code, ada };
}

test('the Rust website answers as the Node one does', { skip, timeout: 60000 }, async () => {
  const answers: Record<string, unknown[]> = {};
  for (const which of ['node', 'rust'] as const) {
    const s = await host(which, join(tmp, which));
    answers[which] = (await visit(s)).out;
    const sock = connect(s.port, '127.0.0.1');
    sock.write('GET // HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n');
    assert.match(String((await once(sock, 'data'))[0]), /^HTTP\/1\.1 400/);
    await s.stop();
  }
  for (const [i, a] of answers.node.entries()) assert.deepEqual(answers.rust[i], a, String((a as unknown[])[0]));
  assert.equal(answers.rust.length, answers.node.length);
  const kinds = (d: string) => [...new Set(readdirSync(join(tmp, d)).map((n) => n.slice(4)))].sort();
  assert.deepEqual(kinds('rust'), kinds('node'), 'the same files');
  const logged = (d: string) => new Set(readdirSync(join(tmp, d)).filter((n) => n.endsWith('.log.jsonl')).flatMap((n) => readFileSync(join(tmp, d, n), 'utf8').trim().split('\n').map((l) => { const x = JSON.parse(l); return `${x.type} ${x.by.kind} ${Object.keys(x).filter((k) => k !== 'dice' && k !== 'to').sort()}`; })));
  // Which event a game's dice make can differ: what isn't an event can't.
  const steady = (d: string) => [...logged(d)].filter((l) => !l.startsWith('event')).sort();
  assert.deepEqual(steady('rust'), steady('node'), 'the same lines in the game log');
});

test('a room goes on under either server, with its seats', { skip, timeout: 60000 }, async () => {
  const dir = join(tmp, 'shared');
  let code = '', ada = '', host_ = '';
  let was: any;
  for (const which of ['node', 'rust', 'node', 'rust'] as const) {
    const s = await host(which, dir);
    if (!code) {
      ({ code, hostToken: host_ } = (await s.post('/api/rooms', {})).data);
      ada = (await s.post(`/api/rooms/${code}/join`, { name: 'Ada' })).data.token;
      await s.post(`/api/rooms/${code}/join`, { name: 'Bram' });
      await s.post(`/api/rooms/${code}/start`, { token: host_ });
    }
    const now = (await s.get(`/api/rooms/${code}/state?token=${ada}`)).data;
    if (was) assert.deepEqual([now.game, now.you], [was.game, was.you], which);
    const said = await s.post(`/api/rooms/${code}/do`, { token: ada, command: `say hello from ${which}` });
    assert.equal(said.status, 200);
    was = said.data.state;
    assert.equal((await s.get(`/api/rooms/${code}?token=${host_}`)).data.host, true);
    await s.stop();
  }
});

test('it opens more files than the usual soft limit, so saving goes on with many streams open', { skip: skip || (process.platform !== 'linux' && 'reads /proc') }, async () => {
  const child = spawn('sh', ['-c', 'ulimit -S -n 256; exec "$0"', BIN], { env: { ...process.env, PORT: '0', BOARD_LITE_DATA: join(tmp, 'files'), BOARD_LITE_PUBLIC_URL: 'https://dragons.example' }, stdio: ['ignore', 'pipe', 'inherit'] });
  running.add(child);
  await once(child.stdout!, 'data');
  const [, soft, hard] = /Max open files\s+(\d+)\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/limits`, 'utf8'))!;
  assert.ok(Number(soft) > 256 && soft === hard, `${soft} of ${hard}`);
  child.kill('SIGKILL');
  running.delete(child);
});

test('at home: addresses, strong bots, saved games, a game file hosted, and Claude players brought back', { skip, timeout: 60000 }, async () => {
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
