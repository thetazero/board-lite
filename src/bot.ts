// A simple random-ish bot. It exists to test that games run to the end and
// to give rough tuning numbers; it is not meant to play well.

import { TUNING } from './data.ts';
import { score, waitingOn, type Game } from './engine.ts';
import { type Rng, pick } from './rng.ts';
import { ask, moved } from './wasm.ts';

// Concrete commands worth trying for player p, best guesses first.
export function candidateCommands(g: Game, p: number, rng: Rng): string[] {
  const r = ask('candidates', g, { p, state: rng.state });
  rng.state = r.state;
  return r.cmds;
}

// Makes one move for one waiting player. Returns the command it applied.
export function botMove(g: Game, p: number, rng: Rng): string {
  const r = moved('botMove', g, { p, state: rng.state });
  rng.state = r.state;
  return r.cmd!;
}

export function botStep(g: Game, rng: Rng): { player: number; command: string } {
  const p = pick(rng, waitingOn(g));
  return { player: p, command: botMove(g, p, rng) };
}

export function playOut(g: Game, rng: Rng, maxSteps = 20000): number {
  let steps = 0;
  while (g.phase !== 'over' && steps++ < maxSteps) botStep(g, rng);
  return steps;
}

// Bot games can stall short of the points to win: the board fills up before
// anyone gets there. Tests and screenshots need games that end whatever the
// tuning, so if no one has won by round `by`, the target drops to the
// leader's points (never above the real one) and that round's end ends the
// game. `step` makes one move. The tuning is put back after; this returns the
// target the game ended on.
export function playToEnd(g: Game, step: () => void, by = 40, maxSteps = 100000): number {
  const target = TUNING.pointsToWin;
  let ended = target;
  try {
    for (let steps = 0; g.phase !== 'over' && steps < maxSteps; steps++) {
      TUNING.pointsToWin = ended = endingTarget(g, target, by);
      step();
    }
  } finally {
    TUNING.pointsToWin = target;
  }
  return ended;
}

// The win target playToEnd plays to: the real one, until round `by`, then the
// leader's points if lower.
export function endingTarget(g: Game, target: number, by = 40): number {
  return g.round < by ? target : Math.min(target, Math.max(1, ...g.players.map((_, p) => score(g, p).total)));
}

// The move made for a seat whose player has gone (quit, or away while the
// table waits on them): as little as possible, so it keeps the game moving
// without spending their resources, sending their dragons or taking a trade.
// It answers offers with a decline, ends the turn, keeps the first building
// card, votes for the first target, sends no dragons (or holds back the ones it sent), and discards the
// oldest cards.
export const standInCommands = (g: Game, p: number): string[] => ask('standInCommands', g, { p });
export const standInMove = (g: Game, p: number): string => moved('standInMove', g, { p }).cmd!;
