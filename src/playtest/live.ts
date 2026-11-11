#!/usr/bin/env node
// A live page for a contest or an eval while it runs: the ratings so far with
// how sure each is, games finished and left, the game being played now, and
// the last games' results. It only reads the directory (draw.json, each game's
// results.json, game.json and runner.json), on every request, so it works for
// a contest that's already running, started before this existed, and starts
// or stops nothing.
//
//   node src/playtest/live.ts DIR [--port 8790] [--host ADDR]
//
// It listens on this machine and on its Tailscale address, and prints the
// Tailscale link (and a QR code of it) for a phone on the same tailnet. See
// "Watch a contest live" in docs/eval.md.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUNING } from '../data.ts';
import { score, type Game } from '../engine.ts';
import { qrMatrix } from '../../web/qr.ts';
import { collect } from './leaderboard.ts';
import { rate } from './rating.ts';

export interface LiveSeat { seat: string; player: string; points: number; costUsd?: number }
export interface LiveGame {
  game: number;
  /** For a game being played: "playing", or "stopped" when its runner is gone. Otherwise its results' status. */
  status: string;
  round?: number;
  phase?: string;
  minutes: number;
  seats: LiveSeat[];
  winner?: string; // the winning seat, of a finished game
}
export interface LiveRating { player: string; rating: number; range: number; games: number; wins: number; place: number; costPerGame?: string }
export interface LiveState {
  name: string;
  dir: string;
  /** Games in the plan (a contest's draw); null for an eval, whose plan isn't on disk. */
  total: number | null;
  finished: number;
  /** Games that didn't finish and were played again (gN.failedM). */
  replayed: number;
  /** Average minutes a finished game took. */
  minutesPerGame: number | null;
  pointsToWin: number;
  playing: LiveGame[];
  recent: LiveGame[];
  ratings: LiveRating[];
  /** Roster entries with no finished game yet (a contest's), by their name in the draw. */
  unrated: string[];
  skipped: Record<string, number>;
  updated: string;
}

function readJson(f: string): any {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

const PHASES: Record<string, string> = { cards: 'Cards', action: 'Actions', raid: 'Raid', discard: 'End of round', over: 'Game over' };

function alive(pid: unknown): boolean {
  if (typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

const started = (dir: string) => {
  const s = statSync(dir);
  return s.birthtimeMs || s.ctimeMs;
};

/** Everything the page shows, read from the contest's directory now. */
export function liveState(dir: string, now = Date.now()): LiveState {
  const draw = readJson(join(dir, 'draw.json')) as { roster: string[]; games: number[][] } | null;
  const lineup = (i: number): string[] | undefined => draw?.games[i - 1]?.map((r) => draw.roster[r]);
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const numbered = names.map((n) => /^g(\d+)$/.exec(n)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])).sort((a, b) => a - b);

  const playing: LiveGame[] = [];
  const done: LiveGame[] = [];
  const seen = new Set<string>();
  for (const i of numbered) {
    const g = join(dir, `g${i}`);
    const results = readJson(join(g, 'results.json'));
    if (results?.status === 'over' && results.winner) {
      for (const s of results.seats) seen.add(s.model);
      done.push({
        game: i,
        status: 'over',
        round: results.rounds,
        minutes: results.minutes ?? 0,
        winner: results.winner.seat,
        seats: results.seats.map((s: any) => ({ seat: s.seat, player: s.model, points: s.points ?? 0, ...(s.costUsd ? { costUsd: s.costUsd } : {}) })),
      });
      continue;
    }
    const game = readJson(join(g, 'game.json')) as Game | null;
    const runner = readJson(join(g, 'runner.json'));
    const players = lineup(i);
    const seats: LiveSeat[] = (game?.players ?? players ?? []).map((_: unknown, p: number) => {
      const r = runner?.seats?.find((s: any) => s.p === p);
      return {
        seat: `P${p + 1}`,
        player: players?.[p] ?? (r ? [r.model, ...(r.options ?? [])].join('+') : '?'),
        points: game ? score(game, p).total : 0,
        ...(r?.cost ? { costUsd: Math.round(r.cost * 100) / 100 } : {}),
      };
    });
    playing.push({
      game: i,
      status: results ? results.status : alive(runner?.pid) ? 'playing' : 'stopped',
      ...(game ? { round: game.round, phase: PHASES[game.phase] ?? game.phase } : {}),
      minutes: Math.round((now - started(g)) / 600) / 100,
      seats,
    });
  }

  const c = collect({ dirs: [dir], rooms: null });
  const ratings = rate(c.games).map((r) => {
    const spent = c.games.flatMap((g) => g.spent.filter((s) => s.player === r.player));
    const usd = spent.reduce((t, s) => t + (s.costUsd ?? 0), 0), tokens = spent.reduce((t, s) => t + (s.tokens ?? 0), 0);
    const costPerGame = !spent.length ? undefined : usd ? `$${(usd / spent.length).toFixed(2)}` : `${Math.round(tokens / spent.length / 1000)}k tokens`;
    return { player: r.player, rating: Math.round(r.rating), range: Math.round(r.range), games: r.games, wins: r.wins, place: Math.round(r.place * 100) / 100, ...(costPerGame ? { costPerGame } : {}) };
  });
  const minutes = done.map((g) => g.minutes).filter((m) => m > 0);
  return {
    name: basename(dir),
    dir,
    total: draw ? draw.games.length : null,
    finished: done.length,
    replayed: names.filter((n) => /^g\d+\.failed\d+$/.test(n)).length,
    minutesPerGame: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    pointsToWin: TUNING.pointsToWin,
    playing: playing.reverse(),
    recent: done.reverse().slice(0, 12),
    ratings,
    unrated: draw ? draw.roster.filter((m) => !seen.has(m)) : [],
    skipped: c.skipped,
    updated: new Date(now).toISOString(),
  };
}

/** This machine on the tailnet: its MagicDNS name and its IPv4 address, or null without Tailscale. */
export function tailnet(): { name?: string; ip?: string } | null {
  try {
    const s = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }));
    if (s.BackendState && s.BackendState !== 'Running') return null;
    const name = typeof s.Self?.DNSName === 'string' ? s.Self.DNSName.replace(/\.$/, '') : undefined;
    const ip = (s.Self?.TailscaleIPs ?? []).find((a: string) => a.includes('.'));
    return name || ip ? { name: name || undefined, ip } : null;
  } catch {
    return null;
  }
}

/** A QR code for the terminal: two rows of modules a line, in half blocks, with a quiet zone. */
export function terminalQr(text: string): string {
  const m = qrMatrix(text);
  const n = m.length, q = 2;
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && m[r][c];
  const lines: string[] = [];
  for (let r = -q; r < n + q; r += 2) {
    let line = '';
    for (let c = -q; c < n + q; c++) {
      const top = dark(r, c), bottom = dark(r + 1, c);
      line += top && bottom ? ' ' : top ? '▄' : bottom ? '▀' : '█';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

const USAGE = `node src/playtest/live.ts DIR [options]

  DIR            the contest's (or an eval's) directory, as given to eval.ts --out
  --port N       the port (default 8790)
  --host ADDR    listen only on ADDR (default: this machine, 127.0.0.1, and its Tailscale address)`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(['--port', '--host']);
  const dirs = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  if (args.includes('--help') || dirs.length !== 1) { console.log(USAGE); process.exit(args.includes('--help') ? 0 : 1); }
  const dir = resolve(dirs[0]);
  if (!existsSync(dir)) throw new Error(`No directory ${dir}: give the contest's directory, the one eval.ts --out names.`);
  const port = Number(opt('--port') ?? 8790);
  const page = readFileSync(fileURLToPath(new URL('./live.html', import.meta.url)), 'utf8');

  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/state.json') {
      try {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(liveState(dir)));
      } catch (e) {
        console.error(e);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  };

  const ts = opt('--host') ? null : tailnet();
  const hosts = opt('--host') ? [opt('--host')!] : ['127.0.0.1', ...(ts?.ip ? [ts.ip] : [])];
  for (const host of hosts) {
    const server = createServer(handler);
    server.on('error', (e) => { console.error(`Can't listen on ${host}:${port}: ${e.message}`); process.exit(1); });
    server.listen(port, host);
  }

  const s = liveState(dir);
  console.log(`Watching ${dir}: ${s.finished}${s.total ? ` of ${s.total}` : ''} games finished.`);
  console.log(`On this machine: http://127.0.0.1:${port}/`);
  if (opt('--host')) console.log(`Listening on http://${opt('--host')}:${port}/`);
  else if (ts) {
    const link = `http://${ts.name ?? ts.ip}:${port}/`;
    console.log(`On your phone (same tailnet): ${link}${ts.name && ts.ip ? `  (or http://${ts.ip}:${port}/)` : ''}\n`);
    console.log(terminalQr(link));
  } else console.log('Tailscale is not running here, so there is no phone link: start it (tailscale up) and run this again.');
}
