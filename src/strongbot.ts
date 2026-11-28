// The strong bot (#482): a seat played by code, no model, as a free baseline
// for playtests and contests. It plays to win, cheaply:
//
// - On its turn it looks one step ahead. Every purchase it could make now
//   (a building on each hex it may go on, an upgrade, a special project, a
//   card), with the merchants trades that would pay for it, is tried on a copy
//   of the game and scored by `worth`, a guess at what the position is worth
//   in points: points now, plus what its production, resources, dragons and
//   nearness to titles should turn into before the game ends. It makes the
//   best purchase that raises that, and ends its turn when none does.
// - Fights (raids, clearing a hex) it estimates with its own dice, rolling
//   each fight some dozens of times, never the game's: it can't see the
//   dice the game will roll.
// - It sees only what its seat sees: the public board, every player's gold
//   and hand size, and its own hand and resources. Other players' hands,
//   resources and secret raid choices stay hidden from it.
// - It talks (#482: "it explicitly should use the chat"): it says which
//   kingdom it votes for and asks others to fight with it, asks the table for
//   the resource it's short of when it offers a trade, warns the table about a
//   player close to winning, and answers players who talk to it.
//
// Compute: a turn is a few hundred copies of the game and a few thousand
// simulated fights, tens of milliseconds.

import type { Command } from './command.ts';
import type { Bundle } from './data.ts';
import type { Game } from './engine.ts';
import type { Rng } from './rng.ts';
import { ask, moved } from './wasm.ts';

// ---------- tuning of the bot itself ----------

// Its own numbers, apart from the game's (src/data.ts). Exported so the bench
// (src/botbench.ts) can play variants of it against each other.
export const TUNE = {
  // Points a basic resource held is worth with plenty of the game left; gold the same.
  V_RES: 0.2,
  V_GOLD: 0.2,
  // Points per point of combat power a dragon has raid-ready, each round: what
  // it brings in raids and clears over a round.
  KAPPA: 0.07,
  // How much an empty land hex beside its buildings is worth, early in the
  // game: room to build on later.
  FRONTIER: 0.12,
  // What a free dragon space is worth, up to 2 of them, while there's time to fill them.
  SLOT: 0.35,
  // The least gain, in points, for which it makes a move.
  MIN_GAIN: 0.05,
  // How long it waits for answers to its own offer before withdrawing it.
  OFFER_WAIT_MS: 45_000,
  // Fights rolled per estimate.
  SIMS: 60,
  // At most this many things said a round, its answers to others included.
  TALK_PER_ROUND: 3,
    // Others in a raid fight with all their dragons this often, else hold back.
  OTHERS_FIGHT: 0.6,
  // Snowball: the leader's pace so far times this guesses the rounds left.
  PACE: 0.7,
  // How far ahead production counts, as a share of the rounds left.
  HORIZON: 0.75,
  // How much a title it's near pulls, as a share of its points.
  PULL: 0.7,
};

export interface StrongOptions {
  name?: string; // its name at the table, so it knows when someone talks to it
  now?: number; // the clock, ms epoch (tests and sims fix it)
}

// The bot is Rust (rust/src/strongbot.rs); it reads the log, so the log goes over too.
const q = (p: number, opts: StrongOptions = {}) => ({ p, name: opts.name, now: opts.now ?? Date.now(), tune: TUNE });

// What the position is worth to player p, in points, by what p can see.
export const worth = (g: Game, p: number, h?: number): number => ask('worth', g, { ...q(p), h });

// The merchants trades that would let p pay `cost`, or null if they can't.
export const merchantPlan = (g: Game, p: number, cost: Bundle): Command[] | null => ask('merchantPlan', g, { ...q(p), cost });

// Whether p is waiting on answers to its own offer, with nothing to do till they come.
export const strongWaits = (g: Game, p: number, opts: StrongOptions = {}): boolean => ask('strongWaits', g, q(p, opts), true);

// Applies p's next move and returns it, or null while it waits on answers to its offer.
export function strongMove(g: Game, p: number, rng: Rng, opts: StrongOptions = {}): Command | null {
  const r = moved('strongMove', g, { ...q(p, opts), state: rng.state }, true);
  rng.state = r.state;
  return r.cmd;
}
