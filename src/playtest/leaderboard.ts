#!/usr/bin/env node
// The leaderboard: a rating for every model, and every person, from the games
// they finished. It reads two places, and runs no games:
//
// - playtests and eval games (each game's results.json, under
//   ~/.cache/board-lite/playtests by default): which model sat where;
// - games played on `npm run serve` (~/.cache/board-lite/rooms): people on
//   phones or the CLI, bots, and Claude or Codex players a runner seated with
//   --room (named from that runner's results.json).
//
//   node src/playtest/leaderboard.ts [DIR ...] [--since 2026-11-01] [--no-rooms] [--rooms DIR] [--out FILE]
//
// See docs/eval.md for how the rating works and how to read it.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT, placesFrom, rate, type RatedGame } from './rating.ts';

const CACHE = join(homedir(), '.cache', 'board-lite');

interface ResultSeat { seat: string; name?: string; model: string; modelId?: string; points?: number; costUsd?: number; tokens?: number }
interface Results { status: string; room?: string; effort?: string; advice?: string; winner: { seat: string } | null; seats: ResultSeat[] }

/** A finished game, ready to rate, with what it cost each AI seat. */
export interface Played extends RatedGame {
  source: string; // the directory or room file it came from
  spent: { player: string; costUsd?: number; tokens?: number }[];
}

export interface Collected { games: Played[]; skipped: Record<string, number> }

/** Who a results.json seat is on the leaderboard: a model (its effort, if set), a person, or the bot. */
export function playerOf(s: ResultSeat, effort?: string): string | null {
  if (s.model === 'bot') return BOT;
  if (s.model.startsWith('player: ')) return person(s.model.slice('player: '.length));
  if (s.model.startsWith('open')) return null;
  return `${s.modelId ?? s.model}${effort ? ` @${effort}` : ''}`;
}

// People are told apart by the name they joined with, whatever its case.
const people = new Map<string, string>();
function person(name: string): string {
  const key = name.trim().toLowerCase();
  if (!people.has(key)) people.set(key, `${name.trim()} (person)`);
  return people.get(key)!;
}

// The final scores the engine logged when the game ended.
function finalScores(game: any): { totals: number[]; winner: number } | null {
  const ev = [...(game?.log ?? [])].reverse().find((e: any) => e?.ev?.k === 'final')?.ev;
  return ev && Array.isArray(ev.totals) && typeof ev.winner === 'number' ? { totals: ev.totals, winner: ev.winner } : null;
}

function readJson(f: string): any {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

function resultsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || /\.failed\d+$/.test(d.name) || d.name === 'tmp' || /^seat-\d+$/.test(d.name)) continue;
    const sub = join(dir, d.name);
    if (existsSync(join(sub, 'results.json'))) out.push(join(sub, 'results.json'));
    else out.push(...resultsFiles(sub)); // a batch or an eval: its games are a level down
  }
  if (existsSync(join(dir, 'results.json'))) out.push(join(dir, 'results.json'));
  return out;
}

const roomCode = (url: string) => /\/([A-Za-z]{4})\/?$/.exec(url)?.[1]?.toUpperCase();

/** Every finished game in the playtest dirs and the rooms dir, and how many were left out and why. */
export function collect(opts: { dirs: string[]; rooms: string | null; since?: number }): Collected {
  const games: Played[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const recent = (f: string) => !opts.since || statSync(f).mtimeMs >= opts.since;
  // Runners that seated AI players in someone's room: their seats get their models' names there.
  const runners = new Map<string, Results[]>();

  const files = [...new Set(opts.dirs.flatMap(resultsFiles))];
  for (const f of files) {
    const r = readJson(f) as Results | null;
    if (!r || !recent(f)) continue;
    if (r.room) {
      const code = roomCode(r.room);
      if (code) runners.set(code, [...(runners.get(code) ?? []), r]);
      continue;
    }
    fromResults(r, join(f, '..'));
  }

  function fromResults(r: Results, dir: string) {
    if (r.status !== 'over' || !r.winner) return skip('not finished');
    if (r.advice) return skip('played with --advice (an experiment)');
    const final = dir ? finalScores(readJson(join(dir, 'game.json'))) : null;
    const winner = r.seats.findIndex((s) => s.seat === r.winner!.seat);
    const places = final ? placesFrom(final.totals, final.winner) : placesFrom(r.seats.map((s) => s.points ?? 0), winner);
    add(dir, r.seats.map((s, p) => ({ player: playerOf(s, r.effort), place: places[p], costUsd: s.costUsd, tokens: s.tokens })));
  }

  function add(source: string, seats: { player: string | null; place: number; costUsd?: number; tokens?: number }[]) {
    const held = seats.filter((s): s is typeof s & { player: string } => !!s.player);
    if (new Set(held.map((s) => s.player)).size < 2) return skip('fewer than two different players');
    games.push({
      source,
      seats: held.map(({ player, place }) => ({ player, place })),
      spent: held.filter((s) => s.player !== BOT && (s.costUsd || s.tokens)).map(({ player, costUsd, tokens }) => ({ player, costUsd, tokens })),
    });
  }

  const seen = new Set<string>();
  if (opts.rooms && existsSync(opts.rooms)) {
    for (const n of readdirSync(opts.rooms)) {
      if (!n.endsWith('.seats.json')) continue;
      const file = join(opts.rooms, `${n.slice(0, -'.seats.json'.length)}.json`);
      const saved = readJson(join(opts.rooms, n));
      if (!saved || !existsSync(file) || !recent(file)) continue;
      const game = readJson(file);
      if (game?.phase !== 'over') { skip('not finished'); continue; }
      const final = finalScores(game);
      if (!final || saved.seats.length !== final.totals.length) { skip('no final scores'); continue; }
      const code = String(saved.code).toUpperCase();
      seen.add(code);
      const ran = runners.get(code) ?? [];
      const places = placesFrom(final.totals, final.winner);
      add(file, saved.seats.map((s: { name: string; kind: string; left?: boolean }, p: number) => {
        // A player who quit had a bot finish for them: that seat isn't theirs to rate.
        if (s.left) return { player: null, place: places[p] };
        if (s.kind === 'bot') return { player: BOT, place: places[p] };
        if (s.kind !== 'player') return { player: null, place: places[p] };
        for (const r of ran) {
          const mine = r.seats.find((x) => x.name?.toLowerCase() === s.name.toLowerCase() && !x.model.startsWith('player: ') && x.model !== 'bot');
          if (mine) return { player: playerOf(mine, r.effort), place: places[p], costUsd: mine.costUsd, tokens: mine.tokens };
        }
        return { player: person(s.name), place: places[p] };
      }));
    }
  }
  // A room game whose room file is gone: its runner's results still say who sat where.
  for (const [code, rs] of runners) if (!seen.has(code)) for (const r of rs) fromResults(r, '');
  return { games, skipped };
}

export function leaderboard(c: Collected): string {
  const rows = rate(c.games);
  const lines = [
    '# Leaderboard',
    '',
    `${c.games.length} finished games. The average seat here is 1500, and a player 400 points above another is expected to finish ahead of it 10 times in 11. The range is where the rating is, 95% sure, from these games. See docs/eval.md.`,
    '',
    '| # | Player | Rating | 95% range | Games | Wins | Average place | Cost a game |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const [i, r] of rows.entries()) {
    const spent = c.games.flatMap((g) => g.spent.filter((s) => s.player === r.player));
    const usd = spent.reduce((t, s) => t + (s.costUsd ?? 0), 0), tokens = spent.reduce((t, s) => t + (s.tokens ?? 0), 0);
    const cost = !spent.length ? '' : usd ? `$${(usd / spent.length).toFixed(2)}` : `${Math.round(tokens / spent.length / 1000)}k tokens`;
    const range = `${Math.round(r.rating - r.range)} to ${Math.round(r.rating + r.range)}`;
    lines.push(`| ${i + 1} | ${r.player} | ${Math.round(r.rating)} | ${range} | ${r.games} | ${r.wins} | ${r.place.toFixed(2)} | ${cost} |`);
  }
  const left = Object.entries(c.skipped);
  if (left.length) lines.push('', `Left out: ${left.map(([why, n]) => `${n} ${why}`).join('; ')}.`);
  return `${lines.join('\n')}\n`;
}

const USAGE = `node src/playtest/leaderboard.ts [DIR ...] [options]

  DIR ...        playtest, batch or eval directories to read (default ~/.cache/board-lite/playtests, all of it)
  --since DATE   only games that ended on or after DATE (e.g. 2026-11-01): rules change, old games may not count
  --rooms DIR    where npm run serve keeps its games (default ~/.cache/board-lite/rooms)
  --no-rooms     leave out the games played on npm run serve
  --out FILE     also write the leaderboard to FILE`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(USAGE); process.exit(0); }
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(['--since', '--rooms', '--out']);
  const dirs = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1])).map((d) => resolve(d));
  const since = opt('--since') ? Date.parse(opt('--since')!) : undefined;
  if (since !== undefined && Number.isNaN(since)) throw new Error(`--since takes a date like 2026-11-01, not ${opt('--since')}.`);
  const text = leaderboard(collect({
    dirs: dirs.length ? dirs : [join(CACHE, 'playtests')],
    rooms: args.includes('--no-rooms') ? null : resolve(opt('--rooms') ?? join(CACHE, 'rooms')),
    since,
  }));
  if (opt('--out')) writeFileSync(resolve(opt('--out')!), text);
  console.log(text);
}
