#!/usr/bin/env node
// The model eval: games among a roster of models (Claude, Codex, the bot) or
// Claude player configurations, then the leaderboard of those games
// (src/playtest/leaderboard.ts). With a fixed --seats, every lineup of that
// many in turn, each lineup rotated through every seat order; with a range
// like --seats 2-6 (a contest), each game draws its size and its players at
// random but balanced (draw.ts). See docs/eval.md.
//
//   node src/playtest/eval.ts --models opus,sonnet,haiku,codex:gpt-5.6-sol [--seats 3] [--games N] [--dry-run]
//   node src/playtest/eval.ts --models haiku,sonnet,opus,opus+fable51,bot --seats 2-6 --games 40 [--dry-run]
//   node src/playtest/eval.ts --out DIR --models <its roster>,codex:gpt-5.6-sol --seats 2-6 --games 80 \
//     --focus codex:gpt-5.6-sol --until-sure   (a player added to a contest partway, its games concentrated on it)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runGames } from './games.ts';
import { collect, leaderboard, sureEnough } from './leaderboard.ts';
import { balance, extend, parseSizes, rng, type DrawState } from './draw.ts';
import { isAi, parseSeats, parseSpec } from './players.ts';
import { defaultPool } from './slots.ts';

const USAGE = `node src/playtest/eval.ts --models <m1,m2,...> [options]

  --models ...       the roster, 2 or more: claude models (opus, sonnet, haiku, claude-...),
                     Codex models (codex:<model>, e.g. codex:gpt-5.6-sol), bot (random), strongbot, or
                     person:<name> (you, on your phone); a Claude or Codex entry can add player options,
                     like opus+advice+expected. Rerunning a contest with more entries adds them to it
  --seats K          players a game (default 3, at most the roster's size), or a range like
                     2-6: each game then draws its size and players at random, balanced
  --games N          how many games (default: one round, every lineup of K in every seat order;
                     with a range of sizes, --games is needed)
  --focus a,b        with a range of sizes: the games drawn from now on concentrate on these
                     entries (every seat of a game but one), opponents from the whole bucket
  --until-sure       with --focus: stop once each focus entry's 95% range is no wider than the
                     middle one of the rest's before the focus began; --games is then the most
  --advice TEXT      the advice for entries with +advice, passed to every game
  --parallel N       games at once (default 1; see docs/eval.md for why)
  --out DIR          the eval directory (default ~/.cache/board-lite/playtests/<time>-eval-<models>);
                     game i goes in DIR/gi. Rerunning into the same DIR keeps the finished
                     games and plays the rest.
  --budget-usd N     spending cap per Claude seat a game (default 60)
  --seed N           seed of game 1; game i gets N+i-1 (default random per game). With a
                     range of sizes it also seeds the draw
  --effort, --max-minutes, --stall-minutes   passed to every game
  --dry-run          print the games it would play, and play none`;

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help')) { console.log(USAGE); process.exit(0); }

const given = (opt('--models') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
if (given.length < 2) { console.log(USAGE); process.exit(1); }
const advice = opt('--advice');
// Every entry a model or configuration run.ts can seat, checked before anything is played.
const advised = (m: string) => parseSpec(m).options.includes('advice');
parseSeats(given, advice);
if (advice !== undefined && !given.some(advised)) throw new Error('--advice goes to the entries with +advice, and no entry in --models has it.');
const [lo, hi] = parseSizes(opt('--seats') ?? String(Math.min(3, given.length)));
if (hi > given.length) throw new Error(`--seats ${hi} needs at least ${hi} models in --models (a model can be listed twice).`);
const mixed = lo < hi;
const k = hi;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(opt('--out') ?? join(homedir(), '.cache', 'board-lite', 'playtests', `${stamp}-${mixed ? 'contest' : 'eval'}-${given.join('-').replace(/[:/+]/g, '_')}`));

// A contest's draw is kept in <out>/draw.json, so a rerun with more games extends it
// rather than drawing again. A rerun can add players: --models then holds every
// player of the contest and the new ones, who join the end of its roster.
const drawFile = join(out, 'draw.json');
interface Kept { roster: string[]; sizes: number[]; seed: number; games: number[][]; focus?: { entries: string[]; from: number } }
const kept = mixed && existsSync(drawFile) ? JSON.parse(readFileSync(drawFile, 'utf8')) as Kept : null;
const roster = kept ? grown(kept.roster, given) : given;
function grown(was: string[], now: string[]): string[] {
  const added = [...now];
  for (const m of was) {
    const at = added.indexOf(m);
    if (at < 0) throw new Error(`${out} holds a contest of ${was.join(',')}; --models needs every one of them (and can add more), or pick another --out.`);
    added.splice(at, 1);
  }
  return [...was, ...added];
}
const focusGiven = (opt('--focus') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
for (const f of focusGiven) if (!roster.includes(f)) throw new Error(`--focus ${f}: that isn't an entry in --models.`);
const focus = roster.flatMap((m, i) => (focusGiven.includes(m) ? [i] : []));
if (focus.length && !mixed) throw new Error('--focus is for a contest, with a range of --seats like 2-6.');
const untilSure = args.includes('--until-sure');
// The focus, and the game it began with, kept in draw.json: a rerun with the same
// --focus (after a stop) keeps measuring "sure" against the games before it.
const focusKept = focus.length ? (kept?.focus && kept.focus.entries.join(',') === focusGiven.join(',') ? kept.focus : { entries: focusGiven, from: (kept?.games.length ?? 0) + 1 }) : undefined;
if (untilSure && !focus.length) throw new Error('--until-sure stops once the --focus entries are rated as surely as the rest: give --focus too.');

// Every lineup of k roster entries, in roster order.
function lineups(n: number, size: number): number[][] {
  if (!size) return [[]];
  const out: number[][] = [];
  for (let first = 0; first <= n - size; first++) for (const rest of lineups(n - first - 1, size - 1)) out.push([first, ...rest.map((r) => r + first + 1)]);
  return out;
}
const all = lineups(roster.length, k);
const round = all.length * k;
if (mixed && opt('--games') === undefined) throw new Error('With a range of --seats, say how many games with --games N.');
const games = Number(opt('--games') ?? round);
if (!Number.isInteger(games) || games < 1) throw new Error(`--games takes a number of games, not ${opt('--games')}.`);

let draw: (DrawState & { seed: number }) | null = null;
if (mixed) {
  if (kept && kept.sizes.join('-') !== `${lo}-${hi}`) {
    throw new Error(`${out} holds a contest with --seats ${kept.sizes.join('-')}; run it with that, or pick another --out.`);
  }
  const seed = kept?.seed ?? Number(opt('--seed') ?? Math.floor(Math.random() * 2 ** 31));
  const state: DrawState = { roster, sizes: [lo, hi], games: kept?.games ?? [], focus };
  const more = Math.max(0, games - state.games.length);
  draw = { ...extend(state, more, rng(seed + state.games.length)), seed };
}

// Game i: with a range of sizes, the draw's game i. Otherwise lineup (i-1) mod L,
// rotated floor((i-1)/L) seats: every lineup comes up once before any comes up
// again, so a stopped eval is still balanced, and each full round seats every
// lineup in every seat order.
function seats(i: number): string[] {
  if (draw) return draw.games[i - 1].map((r) => roster[r]);
  const line = all[(i - 1) % all.length].map((r) => roster[r]);
  const turn = Math.floor((i - 1) / all.length) % k;
  return [...line.slice(turn), ...line.slice(0, turn)];
}

const claudeSeats = Math.max(...Array.from({ length: mixed ? games : Math.min(games, round) }, (_, i) => seats(i + 1).filter(isAi).length));
const atOnce = Math.max(1, Math.min(Number(opt('--parallel') ?? 1), Math.floor(defaultPool().maxSeats / Math.max(1, claudeSeats))));

if (args.includes('--dry-run')) {
  if (mixed) console.log(`${games} games of ${lo} to ${hi} players, drawn from ${roster.length}, up to ${atOnce} at a time${focusKept ? `; from game ${Math.max(focusKept.from, (kept?.games.length ?? 0) + 1)}, concentrated on ${focusGiven.join(', ')}` : ''}${untilSure ? ', until they are rated as surely as the rest' : ''}:`);
  else console.log(`${games} games of ${k} (one round is ${round}: ${all.length} lineups x ${k} seat orders), up to ${atOnce} at a time:`);
  for (let i = 1; i <= games; i++) console.log(`g${i}: ${seats(i).join(', ')}`);
  if (draw) console.log(`\n${balance(roster, draw.games.slice(0, games))}`);
  process.exit(0);
}

if (out.startsWith('/tmp')) throw new Error('Keep playtests out of /tmp (it is RAM on the dev machine).');
mkdirSync(out, { recursive: true });
const saveDraw = (games: number[][]) => writeFileSync(drawFile, `${JSON.stringify({ roster, sizes: [lo, hi], seed: draw!.seed, ...(focusKept ? { focus: focusKept } : {}), games }, null, 1)}\n`);
if (draw) saveDraw(draw.games);
const seed = opt('--seed');
const passed = ['--effort', '--max-minutes', '--stall-minutes'].flatMap((o) => (opt(o) === undefined ? [] : [o, opt(o)!]));
// Only a game with a +advice seat gets the advice: given to a game with none, run.ts would hand it to every seat.
const adviceFor = (i: number) => (advice !== undefined && seats(i).some(advised) ? ['--advice', advice] : []);
console.log(`${mixed ? 'Contest' : 'Eval'} in ${out}: ${games} games${untilSure ? ' at most' : ''}, up to ${atOnce} at a time.`);
let sureAt = '';
const reached = await runGames({
  out,
  games,
  atOnce,
  seats,
  args: (i) => ['--budget-usd', opt('--budget-usd') ?? '60', ...(seed ? ['--seed', String(Number(seed) + i - 1)] : []), ...adviceFor(i), ...passed],
  ...(untilSure ? { enough: () => { sureAt = sureEnough(out, focusGiven, focusKept!.from) ?? ''; return !!sureAt; } } : {}),
});
// Stopped because the focus players are rated surely enough: the games drawn past
// the last one started are dropped, so the draw (and the live page) ends there.
let playedTo = games;
if (draw && sureAt && reached < games) {
  const highest = Math.max(0, ...readdirSync(out).map((n) => /^g(\d+)$/.exec(n)).filter((m) => !!m).map((m) => Number(m![1])));
  playedTo = Math.max(reached, highest);
  draw.games = draw.games.slice(0, playedTo);
  saveDraw(draw.games);
  console.log(`${sureAt} Stopped after game ${playedTo}.`);
}
const text = leaderboard(collect({ dirs: [out], rooms: null }));
writeFileSync(join(out, 'leaderboard.md'), draw ? `${text}\n## The draw\n\n\`\`\`\n${balance(roster, draw.games.slice(0, playedTo))}\n\`\`\`\n` : text);
console.log(text);

