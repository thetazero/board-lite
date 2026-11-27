// How the two website servers hold up: image, memory, CPU and latency with
// more and more people connected. Each table is a TV, four phones and a game
// played by the phones (bots' choice of moves, sent as the phones would), so
// every move is a save to disk and a push to five streams.
//
//   node rust/bench/load.ts --image <docker image> [--users 0,50,250] [--secs 30] [--rate 0.2] [--cpus 1] [--out file.jsonl]
//
// users: people and TVs connected; rate: moves a second at each table.
// Prints a JSON line for each step, read from the container's own cgroup.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { Agent, request, type ClientRequest, type IncomingMessage } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const flag = (name: string, or: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : or; };
const image = flag('image', 'bl-rust');
const steps = flag('users', '0,50,250,500,1000,2500').split(',').map(Number);
const secs = Number(flag('secs', '30'));
const rate = Number(flag('rate', '0.2'));
const cpus = flag('cpus', '1');
const warm = Number(flag('warm', '10'));
const SEATS = 4;
const TABLE = SEATS + 1;
const port = 18080 + Math.floor(Math.random() * 1000);
const name = `bl-bench-${port}`;
const docker = (...a: string[]) => execFileSync('docker', a, { encoding: 'utf8' }).trim();

docker('run', '-d', '--rm', '--name', name, '--cpus', cpus, '--memory', '1g', '--memory-swap', '1g', '--read-only', '--tmpfs', '/tmp', '-v', '/data', '-p', `127.0.0.1:${port}:8080`, '-e', 'BOARD_LITE_PUBLIC_URL=https://dragons.example', '-e', 'BOARD_LITE_TRUST_PROXY=1', image);
const id = docker('inspect', '-f', '{{.Id}}', name);
const pid = docker('inspect', '-f', '{{.State.Pid}}', name);
const cg = [`/sys/fs/cgroup/system.slice/docker-${id}.scope`, `/sys/fs/cgroup/docker/${id}`].find((p) => { try { readFileSync(`${p}/memory.current`); return true; } catch { return false; } })!;
const num = (f: string) => Number(readFileSync(`${cg}/${f}`, 'utf8'));
const stat = (f: string, k: string) => Number(new RegExp(`^${k} (\\d+)`, 'm').exec(readFileSync(`${cg}/${f}`, 'utf8'))![1]);
const rss = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))![1]) / 1024;
const MB = 1024 * 1024;

const agent = new Agent({ keepAlive: true, maxSockets: 64 });
function call(method: string, path: string, body: unknown, ip: string): Promise<{ status: number; data: any; ms: number }> {
  return new Promise((done, fail) => {
    const t = performance.now();
    const req = request({ host: '127.0.0.1', port, method, path, agent, headers: { 'x-forwarded-for': ip } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const ms = performance.now() - t;
        let data: any = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* none */ }
        done({ status: res.statusCode!, data, ms });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.setTimeout(20000, () => req.destroy(new Error('no answer in 20 s')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const retry = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 0; ; i++) try { return await fn(); } catch (e) { if (i > 50) throw e; await sleep(50); } };

let pushes = 0, pushBytes = 0, broken = 0, moves = 0, refused = 0, ended = 0;
let lat: number[] = [], seenLat: number[] = [];
const streams: ClientRequest[] = [];

interface Table { code: string; host: string; tokens: string[]; ips: string[]; sent: Map<string, number> }
let tableNo = 0, talkNo = 0;

// A stream reads everything and parses nothing but the mark of a move it waits to see.
function stream(t: Table, path: string, ip: string, watch: boolean) {
  return new Promise<void>((open, fail) => {
    const req = request({ host: '127.0.0.1', port, path, agent: false, headers: { 'x-forwarded-for': ip } }, (res: IncomingMessage) => {
      if (res.statusCode !== 200) { broken++; res.resume(); return open(); }
      let tail = '';
      res.on('data', (c: Buffer) => {
        pushBytes += c.length;
        if (c.length >= 2 && c[c.length - 1] === 10 && c[c.length - 2] === 10) pushes++;
        if (watch && t.sent.size) {
          const s = tail + c.toString('latin1');
          for (const [mark, at] of t.sent) if (s.includes(mark)) { seenLat.push(performance.now() - at); t.sent.delete(mark); }
          tail = s.slice(-40);
        }
      });
      res.on('close', () => { if (!closing) broken++; });
      res.on('error', () => {});
      open();
    });
    req.on('error', (e) => { if (!closing) { broken++; fail(e); } });
    req.end();
    streams.push(req);
  });
}
let closing = false;

async function table(): Promise<Table> {
  const n = tableNo++;
  const ip = (k: number) => `10.${(n >> 8) & 255}.${n & 255}.${k + 1}`;
  const { code, hostToken } = (await call('POST', '/api/rooms', {}, ip(0))).data;
  const t: Table = { code, host: hostToken, tokens: [], ips: [], sent: new Map() };
  for (let s = 0; s < SEATS; s++) {
    t.tokens.push((await call('POST', `/api/rooms/${code}/join`, { name: `P${s}`, via: 'phone' }, ip(s))).data.token);
    t.ips.push(ip(s));
  }
  await call('POST', `/api/rooms/${code}/start`, { token: hostToken }, ip(0));
  await stream(t, `/api/rooms/${code}/events?tv=1`, ip(9), true);
  for (let s = 0; s < SEATS; s++) await stream(t, `/api/rooms/${code}/events?token=${t.tokens[s]}`, ip(s), false);
  return t;
}

// What a phone would send now, from what it shows: half the time just end the turn or answer.
function choose(you: any, g: any): string | null {
  if (!you.deciding) return null;
  const any = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  if (g.phase === 'cards') return `keep ${any<any>(you.choice).id}`;
  if (g.phase === 'discard') return `discard ${you.hand.slice(0, you.hand.length - you.handCap).map((c: any) => c.id).join(' ')}`;
  if (g.phase === 'raid') return g.raid.step === 'vote' ? `vote ${1 + Math.floor(Math.random() * g.raid.candidates.length)}` : 'fight';
  for (const o of g.offers) if (o.to === you.seat) return `decline ${o.id}`;
  if (!you.myTurn) return null;
  for (const b of you.basics) if (!b.why && b.hexes.length && Math.random() < 0.6) return b.onTower ? `build ${b.key}` : `build ${b.key} ${any(b.hexes)}`;
  for (const c of you.hand) if (!c.why && Math.random() < 0.6) {
    if (c.kind === 'building' && c.hexes.length) return `build ${c.id} ${any(c.hexes)}`;
    if (c.kind === 'upgrade' && c.hexes.length) return `upgrade ${c.id} ${any(c.hexes)}`;
    if (c.kind === 'dragon') return `play ${c.id}`;
  }
  return 'end';
}

// One table's moves: a seat that has something to decide, at a steady rate, until told to stop.
async function play(t: Table, stop: { now: boolean }) {
  await sleep(Math.random() * 1000 / rate);
  let last: any = null;
  while (!stop.now) {
    const at = performance.now();
    try {
      const s = last?.game?.waitingOn?.length ? last.game.waitingOn[0] : 0;
      const st = (await call('GET', `/api/rooms/${t.code}/state?token=${t.tokens[s]}`, undefined, t.ips[s])).data;
      const cmd = choose(st.you, st.game);
      const p = cmd ? s : st.game.waitingOn[0];
      if (st.game.phase === 'over') { ended++; return; }
      if (cmd) {
        const r = await call('POST', `/api/rooms/${t.code}/do`, { token: t.tokens[p], command: cmd, via: 'phone', id: String(talkNo++) }, t.ips[p]);
        r.status === 200 ? moves++ : refused++;
        lat.push(r.ms);
        last = r.data?.state ?? st;
        // Every so often someone says something, marked, to time how long until the TV hears it.
        if (Math.random() < 0.5) {
          const mark = `mark${talkNo++}m`;
          t.sent.set(mark, performance.now());
          const q = await call('POST', `/api/rooms/${t.code}/do`, { token: t.tokens[p], command: `say ${mark}`, via: 'phone' }, t.ips[p]);
          q.status === 200 ? moves++ : refused++;
          lat.push(q.ms);
        }
      } else last = st;
    } catch { if (!stop.now) refused++; }
    await sleep(Math.max(0, 1000 / rate - (performance.now() - at)));
  }
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Number(s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2)) : null; };

async function main() {
  const t0 = performance.now();
  await retry(() => call('GET', '/healthz', undefined, '10.0.0.1'));
  const readyMs = Math.round(performance.now() - t0);
  const tables: Table[] = [];
  const stop = { now: false };
  const playing: Promise<void>[] = [];
  for (const users of steps) {
    const want = Math.round(users / TABLE);
    while (tables.length < want) {
      const batch = await Promise.all(Array.from({ length: Math.min(8, want - tables.length) }, table));
      tables.push(...batch);
      for (const t of batch) playing.push(play(t, stop));
    }
    await sleep(warm * 1000);
    [pushes, pushBytes, moves, refused] = [0, 0, 0, 0];
    lat = []; seenLat = [];
    const me0 = process.cpuUsage();
    const cpu0 = stat('cpu.stat', 'usage_usec'), thr0 = stat('cpu.stat', 'throttled_usec'), at = performance.now();
    let peak = 0, sum = 0, n = 0, rssSum = 0;
    while (performance.now() - at < secs * 1000) {
      await sleep(500);
      const a = stat('memory.stat', 'anon') / MB;
      peak = Math.max(peak, a); sum += a; rssSum += rss(); n++;
    }
    const took = (performance.now() - at) / 1000;
    const me = process.cpuUsage(me0);
    const row = {
      image, cpus, rate, users: tables.length * TABLE, tables: tables.length, readyMs,
      anonMB: +(sum / n).toFixed(1), anonPeakMB: +peak.toFixed(1), rssMB: +(rssSum / n).toFixed(1), cgroupMB: +(num('memory.current') / MB).toFixed(1), kernelMB: +(stat('memory.stat', 'kernel') / MB).toFixed(1),
      cpuPct: +((stat('cpu.stat', 'usage_usec') - cpu0) / took / 1e4).toFixed(2), throttledPct: +((stat('cpu.stat', 'throttled_usec') - thr0) / took / 1e4).toFixed(1),
      movesPerSec: +(moves / took).toFixed(1), refused, broken, ended, pushesPerSec: +(pushes / took).toFixed(0), pushMBps: +(pushBytes / took / MB).toFixed(2),
      p50: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99), seenP50: pct(seenLat, 0.5), seenP95: pct(seenLat, 0.95),
      driverCpuPct: +((me.user + me.system) / took / 1e4).toFixed(0),
    };
    console.log(JSON.stringify(row));
    const out = flag('out', '');
    if (out) appendFileSync(out, `${JSON.stringify(row)}\n`);
  }
  closing = true;
  stop.now = true;
  for (const s of streams) s.destroy();
}
let failed = 0;
try { await main(); } catch (e) { failed = 1; console.error(e); } finally { closing = true; docker('rm', '-fv', name); process.exit(failed); }
