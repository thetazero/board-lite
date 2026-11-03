// Staged game situations for screenshots (src/shots/shots.ts). Each scene is
// reached by playing a seeded game with the random bot until a condition
// holds, then sometimes scripting a few commands (trade offers, which the bot
// never makes). Everything is seeded, so a scene comes out the same on every
// run until the rules or the numbers change; if a condition never holds for
// the scene's seed, the next seeds are tried, in order.

import { botStep } from '../bot.ts';
import { ACTIONS, BUILDINGS, DRAGONS, UPGRADES } from '../data.ts';
import { apply, newGame, score, waitingOn, type Game } from '../engine.ts';
import { seatState } from '../state.ts';
import type { Rng } from '../rng.ts';

export const NAMES = ['Ada', 'Bram', 'Cora', 'Dax', 'Eve', 'Finn'];

export interface Shot {
  file: string; // png name, without the extension
  caption: string;
  client: 'tv' | 'phone';
  seat?: number; // phone: whose phone; none means a phone that hasn't joined
  clicks?: string[]; // CSS selectors tapped in order before the shot (the first match each time)
  waitMs?: number; // extra settle time, for the TV's timed banners
  live?: boolean; // TV: load the page, then let the scene's `live` moves happen, then shoot
  frames?: number[]; // TV: one shot per time on the 3D board's clock (seconds; the page opens at 0)
  flight?: boolean; // and the frames are fractions (0 to 1) of the way through the first dragon flight instead
}

export interface Scene {
  name: string;
  players: number;
  seed: number;
  lobby?: { bots: number }; // a room that hasn't started: no game
  until?: (g: Game) => boolean; // play bot moves until this holds
  setup?: (g: Game) => void; // scripted commands once it holds
  live?: (g: Game) => boolean; // for live shots: bot moves after the TV is open, until this holds
  liveEnd?: (g: Game) => boolean; // and where those moves must end up (else the next seed is tried)
  shots: (g: Game | null) => Shot[];
}

export interface Staged {
  scene: Scene;
  game: Game | null;
  seed: number; // the seed that worked
  rng: Rng; // the bot's dice, to carry on into live moves
}

const SEED_TRIES = 40;
const MAX_STEPS = 30000;

// Bot moves until `until` holds. False if the game ended first.
export function drive(g: Game, rng: Rng, until: (g: Game) => boolean): boolean {
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    if (until(g)) return true;
    if (g.phase === 'over') return false;
    botStep(g, rng);
  }
  return false;
}

export function stage(scene: Scene): Staged {
  if (scene.lobby) return { scene, game: null, seed: scene.seed, rng: { state: scene.seed } };
  for (let seed = scene.seed; seed < scene.seed + SEED_TRIES; seed++) {
    const g = newGame(scene.players, seed);
    const rng = { state: seed * 7919 };
    if (!drive(g, rng, scene.until ?? (() => true))) continue;
    scene.setup?.(g);
    // A live scene must also reach its end state from here (checked on a copy).
    if (scene.live) {
      const after = structuredClone(g);
      if (!drive(after, { ...rng }, scene.live) || (scene.liveEnd && !scene.liveEnd(after))) continue;
    }
    return { scene, game: g, seed, rng };
  }
  throw new Error(`Scene ${scene.name}: no game from seed ${scene.seed} to ${scene.seed + SEED_TRIES - 1} reaches it.`);
}

// ---------- conditions ----------

const step = (g: Game) => (g.phase === 'raid' ? g.raid!.step : null);
const best = (g: Game) => Math.max(...g.players.map((_, p) => score(g, p).total));
const dragonsOf = (g: Game, p: number) => g.dragons.filter((d) => d.owner === p);
const buildingsOf = (g: Game, p: number) => Object.values(g.buildings).filter((b) => b.owner === p).length;
// The acting player can play a building card on a hex right now.
const canPlaceCard = (g: Game, p: number) => seatState(g, p).hand.some((c) => c.needs === 'hex' && c.affordable && !c.blocked && c.hexes.length);
const committed = (g: Game) => g.raid!.commits.filter((c) => c.length).length;
const fightingPlayers = (g: Game) => new Set(g.raid!.fighters.map((id) => g.dragons.find((d) => d.id === id)!.owner)).size;

// The first seat (in seat order) matching a condition.
function seatWhere(g: Game, ok: (p: number) => boolean): number {
  const p = g.players.findIndex((_, i) => ok(i));
  if (p < 0) throw new Error('No seat matches.');
  return p;
}

// What a player has most of (to give in a trade), other than `not`.
function most(g: Game, p: number, not = ''): string {
  const r = g.players[p].resources;
  return (['stone', 'timber', 'crystal', 'livestock'] as const).filter((x) => x !== not).reduce((a, b) => (r[b] > r[a] ? b : a));
}

// ---------- the scenes ----------

export const SCENES: Scene[] = [
  {
    name: 'lobby',
    players: 3,
    seed: 1,
    lobby: { bots: 1 },
    shots: () => [
      { file: 'tv-lobby-3p', caption: 'TV lobby: two players and a bot joined', client: 'tv' },
      { file: 'phone-join', caption: 'Phone: joining a room (code from the address)', client: 'phone' },
      { file: 'phone-lobby-host', caption: 'Phone in the lobby: the first player, who can start', client: 'phone', seat: 0 },
    ],
  },
  {
    name: 'opening-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 1 && g.phase === 'action',
    shots: (g) => [
      { file: 'tv-opening-production-2p', caption: "TV, round 1 (2 players): the opening production roll", client: 'tv', waitMs: 1800 },
      { file: 'phone-opening-hand-2p', caption: 'Phone, round 1: the first hand, on your turn', client: 'phone', seat: g!.turn },
      { file: 'phone-opening-waiting-2p', caption: "Phone, round 1: someone else's turn", client: 'phone', seat: (g!.turn + 1) % 2 },
    ],
  },
  {
    name: 'early-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action' && canPlaceCard(g, g.turn),
    shots: (g) => [
      { file: 'tv-early-3p', caption: 'TV, early game (3 players, round 2)', client: 'tv' },
      { file: 'phone-card-open-3p', caption: 'Phone: a building card tapped open', client: 'phone', seat: g!.turn, clicks: ['.card[data-card]:not(.dim)'] },
      { file: 'phone-build-pick-3p', caption: 'Phone: choosing where to build', client: 'phone', seat: g!.turn, clicks: ['.card[data-card]:not(.dim)', '[data-pickhex]'] },
      { file: 'phone-build-bank-3p', caption: 'Phone: special projects and the bank', client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]'] },
    ],
  },
  {
    name: 'build-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action' && canPlaceCard(g, g.turn),
    live: (g) => / builds a /.test(g.log.at(-1)?.text ?? ''),
    shots: () => [{ file: 'tv-build-3p', caption: 'TV: a new building pops up from the page', client: 'tv', live: true, frames: [0, 0.15, 0.3, 0.45, 0.7, 1.2] }],
  },
  {
    name: 'port-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'action' && Object.values(g.buildings).some((b) => b.type === 'port'),
    shots: () => [{ file: 'tv-port-4p', caption: 'TV: a port on the coast, facing the sea', client: 'tv' }],
  },
  {
    name: 'trade-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    // The acting player offers the next seat a trade, and the seat after offers them one.
    setup: (g) => {
      const t = g.turn, a = (t + 1) % 4, b = (t + 2) % 4;
      apply(g, t, `offer P${a + 1} give 2 ${most(g, t)} get 1 ${most(g, a, most(g, t))}`);
      apply(g, b, `offer P${t + 1} give 1 ${most(g, b)} get 1 ${most(g, t, most(g, b))}`);
    },
    shots: (g) => [
      { file: 'tv-trade-4p', caption: 'TV, mid game (4 players): two open trade offers', client: 'tv' },
      { file: 'phone-trade-incoming-4p', caption: 'Phone: an offer to you, out of turn', client: 'phone', seat: (g!.turn + 1) % 4 },
      { file: 'phone-trade-acting-4p', caption: "Phone, acting player: an offer in, and their own out", client: 'phone', seat: g!.turn },
      {
        file: 'phone-trade-compose-4p', caption: 'Phone, acting player: putting an offer together', client: 'phone', seat: g!.turn,
        clicks: ['[data-tab=trade]', '[data-to]:last-child', '[data-step="give stone 1"]', '[data-step="give timber 1"]', '[data-step="get gold 1"]', '[data-tcard]'],
      },
    ],
  },
  {
    // Not a real game moment: the acting player holds one of every card, to see the whole deck at once.
    name: 'every-card',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const keys = [...Object.keys(BUILDINGS), ...Object.keys(UPGRADES), ...Object.keys(ACTIONS), ...Object.keys(DRAGONS)];
      g.players[g.turn].hand = keys.map((key, i) => ({ id: `c${900 + i}`, deck: DRAGONS[key] || ACTIONS[key] ? 'action' : 'building', key }));
    },
    shots: (g) => [
      { file: 'phone-every-card', caption: 'Phone: one of every card in the deck (staged, not a real hand)', client: 'phone', seat: g!.turn },
      { file: 'phone-card-open-dragon', caption: 'Phone: a dragon card tapped open', client: 'phone', seat: g!.turn, clicks: ['.card.k-dragon'] },
      { file: 'phone-card-open-action', caption: 'Phone: an action card tapped open', client: 'phone', seat: g!.turn, clicks: ['.card.k-action'] },
    ],
  },
  {
    name: 'vote-5p',
    players: 5,
    seed: 1,
    until: (g) => g.round >= 3 && step(g) === 'vote' && g.raid!.votes.filter((v) => v !== null).length === 2,
    shots: (g) => [
      { file: 'tv-raid-vote-5p', caption: 'TV, raid vote (5 players): two have voted', client: 'tv' },
      { file: 'phone-raid-vote-5p', caption: 'Phone: voting for the target', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.votes[p] === null) },
      { file: 'phone-raid-voted-5p', caption: 'Phone: voted, waiting', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.votes[p] !== null) },
    ],
  },
  {
    name: 'commit-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round >= 4 && step(g) === 'commit' && committed(g) >= 1 && g.players.some((_, p) => !g.raid!.ready[p] && seatState(g, p).raidReady.length >= 2),
    shots: (g) => {
      const choosing = seatWhere(g!, (p) => !g!.raid!.ready[p] && seatState(g!, p).raidReady.length >= 2);
      return [
        { file: 'tv-raid-commit-4p', caption: 'TV, raid commitments (4 players)', client: 'tv' },
        { file: 'phone-raid-commit-4p', caption: 'Phone: committing dragons (one tapped)', client: 'phone', seat: choosing, clicks: ['[data-commit]'] },
      ];
    },
  },
  {
    name: 'bail-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round >= 3 && step(g) === 'bail' && committed(g) >= 2 && g.raid!.choices.some((c) => c !== null),
    shots: (g) => [
      { file: 'tv-raid-bail-3p', caption: 'TV, fight or bail (3 players): one has chosen', client: 'tv' },
      { file: 'phone-raid-bail-3p', caption: 'Phone: fight or bail, in secret', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.commits[p].length > 0 && !g!.raid!.choices[p]) },
    ],
  },
  {
    name: 'raid-result-3p',
    players: 3,
    seed: 3,
    until: (g) => g.round >= 3 && step(g) === 'bail' && committed(g) >= 2 && g.raid!.choices.every((c, p) => c !== null || !g.raid!.commits[p].length || p === 0),
    live: (g) => g.raid === null || g.raid.step === 'vote', // the raid is over
    liveEnd: (g) => /falls!/.test(g.log.findLast((e) => /falls!|holds\.|Everyone bailed/.test(e.text))?.text ?? ''), // and won
    shots: () => [{ file: 'tv-raid-result-3p', caption: "TV: a raid's fight replay and result", client: 'tv', live: true, waitMs: 400 }],
  },
  {
    name: 'discard-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'discard',
    shots: (g) => [
      { file: 'tv-discard-4p', caption: 'TV, end of round: someone is discarding', client: 'tv' },
      { file: 'phone-discard-4p', caption: 'Phone: over the hand limit, one card picked', client: 'phone', seat: waitingOn(g!)[0], clicks: ['[data-card]'] },
    ],
  },
  {
    name: 'production-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'discard',
    live: (g) => g.phase === 'action',
    shots: () => [{ file: 'tv-production-4p', caption: 'TV: a new round opens with the production dice', client: 'tv', live: true, waitMs: 1800 }],
  },
  {
    name: 'late-6p',
    players: 6,
    seed: 1,
    until: (g) => g.phase === 'action' && best(g) >= 11 && g.dragons.length >= 8,
    shots: (g) => {
      const leader = seatWhere(g!, (p) => score(g!, p).total === best(g!));
      return [
        { file: 'tv-late-6p', caption: 'TV, late game (6 players): a busy board', client: 'tv' },
        { file: `phone-late-6p`, caption: 'Phone, late game: the leader', client: 'phone', seat: leader },
      ];
    },
  },
  {
    name: 'late-2p',
    players: 2,
    seed: 1,
    until: (g) => g.phase === 'action' && best(g) >= 11 && g.players.every((_, p) => buildingsOf(g, p) >= 5),
    shots: () => [
      { file: 'tv-late-2p', caption: 'TV, late game (2 players)', client: 'tv' },
      { file: 'tv-flight-2p', caption: "TV: a dragon's flight round its home", client: 'tv', flight: true, frames: [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95] },
    ],
  },
  {
    name: 'late-5p',
    players: 5,
    seed: 1,
    until: (g) => g.phase === 'action' && best(g) >= 11 && g.players.every((_, p) => dragonsOf(g, p).length >= 1),
    shots: (g) => [
      { file: 'tv-late-5p', caption: 'TV, late game (5 players)', client: 'tv' },
      { file: 'phone-late-5p-turn', caption: 'Phone, late game: your turn', client: 'phone', seat: g!.turn },
    ],
  },
  {
    name: 'over-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'over',
    shots: (g) => [
      { file: 'tv-game-over-4p', caption: 'TV: final scores', client: 'tv' },
      { file: 'phone-game-over-winner', caption: 'Phone: the winner', client: 'phone', seat: g!.winner! },
      { file: 'phone-game-over-loser', caption: 'Phone: everyone else', client: 'phone', seat: (g!.winner! + 1) % 4 },
    ],
  },
  {
    name: 'over-6p',
    players: 6,
    seed: 1,
    until: (g) => g.phase === 'over',
    shots: () => [{ file: 'tv-game-over-6p', caption: 'TV: final scores (6 players)', client: 'tv' }],
  },
];
