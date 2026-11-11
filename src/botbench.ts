// Bot-only games, played in-process with no server: the strong bot (#482)
// against the random bot, or against itself, to measure it and to tune it.
// Free and quick: no Claude involved.
//
//   node src/botbench.ts --games 40 --seats strong,bot,bot [--seed 1]
//
// A variant of the strong bot changes its own numbers (TUNE in
// src/strongbot.ts) for its seat: strong:KAPPA=0.07/SLOT=1.
//
// Seats rotate each game, so each seat type sits in each seat equally often.
// It prints wins per seat type, average points and rounds, and the strong
// bot's thinking time per move.

import { botMove } from './bot.ts';
import { newGame, score, waitingOn, type Game } from './engine.ts';
import { TUNE, strongMove } from './strongbot.ts';
import { type Rng, pick } from './rng.ts';

// 'bot' (the random bot), 'strong', or a variant like 'strong:KAPPA=0.07/SLOT=1'.
export type BenchSeat = string;

const DEFAULTS = { ...TUNE };

function tuneFor(seat: string) {
  Object.assign(TUNE, DEFAULTS);
  for (const kv of seat.split(':')[1]?.split('/') ?? []) {
    const [k, v] = kv.split('=');
    if (!(k in TUNE)) throw new Error(`No ${k} in TUNE.`);
    (TUNE as Record<string, number>)[k] = Number(v);
  }
}

export interface BenchGame { seats: BenchSeat[]; winner: number | null; points: number[]; rounds: number; ms: number; moves: number; talk: number }

// Plays one game to its end (or `maxRounds`): returns who won and the strong bot's time.
export function benchGame(seats: BenchSeat[], seed: number, maxRounds = 60): BenchGame {
  const g: Game = newGame(seats.length, seed);
  const rng: Rng = { state: seed * 7 + 1 };
  const clock = { t: 0 };
  let ms = 0, moves = 0;
  for (let steps = 0; g.phase !== 'over' && g.round <= maxRounds && steps < 200000; steps++) {
    const waiting = waitingOn(g);
    // Try the seats waited on, in a random order, until one moves: a strong
    // bot waiting on answers to its own offer passes.
    const order = waiting.slice().sort(() => (pick(rng, [0, 1]) ? 1 : -1));
    let moved = false;
    for (const p of order) {
      if (seats[p] === 'bot') {
        botMove(g, p, rng);
        moved = true;
        break;
      }
      tuneFor(seats[p]);
      const t0 = performance.now();
      const cmd = strongMove(g, p, rng, { now: clock.t });
      ms += performance.now() - t0;
      if (cmd !== null) {
        moves++;
        moved = true;
        break;
      }
    }
    clock.t += 1000; // a second a move, so a strong bot's offer is withdrawn if no one answers
    if (!moved) clock.t += 60_000;
  }
  return { seats, winner: g.winner, points: g.players.map((_, p) => score(g, p).total), rounds: g.round, ms, moves, talk: g.log.filter((e) => e.ev?.k === 'talk').length };
}

function main() {
  const arg = (name: string, d: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const games = Number(arg('games', '20'));
  const base = arg('seats', 'strong,bot,bot').split(',') as BenchSeat[];
  const seed0 = Number(arg('seed', '1'));
  const kinds = [...new Set(base)];
  const wins: Record<string, number> = {}, pts: Record<string, number[]> = {}, seatsOf: Record<string, number> = {};
  let rounds = 0, ms = 0, moves = 0, unfinished = 0;
  for (let i = 0; i < games; i++) {
    const seats = base.map((_, j) => base[(j + i) % base.length]);
    const r = benchGame(seats, seed0 + i);
    rounds += r.rounds;
    ms += r.ms;
    moves += r.moves;
    if (r.winner === null) unfinished++;
    else wins[seats[r.winner]] = (wins[seats[r.winner]] ?? 0) + 1;
    seats.forEach((s, p) => { (pts[s] ??= []).push(r.points[p]); seatsOf[s] = (seatsOf[s] ?? 0) + 1; });
    console.log(`game ${i + 1}: ${seats.map((s, p) => `${s}${p === r.winner ? '*' : ''} ${r.points[p]}`).join(', ')}; ${r.rounds} rounds`);
  }
  console.log(`\n${games} games of ${base.join(',')}, ${unfinished} unfinished; ${(rounds / games).toFixed(1)} rounds a game`);
  for (const k of kinds) {
    const fair = (seatsOf[k] / (games * base.length)) * (games - unfinished);
    console.log(`  ${k}: ${wins[k] ?? 0} wins (fair share ${fair.toFixed(1)}), ${(pts[k].reduce((a, b) => a + b, 0) / pts[k].length).toFixed(1)} points a seat`);
  }
  if (moves) console.log(`  strong bot: ${(ms / moves).toFixed(1)} ms a move, ${(ms / games / 1000).toFixed(2)} s a game`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
