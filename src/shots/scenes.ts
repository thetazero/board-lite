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
import type { Room } from '../server/room.ts';

export const NAMES = ['Ada', 'Bram', 'Cora', 'Dax', 'Eve', 'Finn'];
// The longest names the server takes (12 characters), wide letters included.
export const LONG_NAMES = ['Maximilianus', 'Wilhelmina W', 'Bartholomew', 'Anastasia M.', 'Gwendolyn W.', 'Christopher'];

export interface Shot {
  file: string; // png name, without the extension
  caption: string;
  client: 'tv' | 'phone';
  seat?: number; // phone: whose phone; none means a phone that hasn't joined
  path?: string; // a phone that hasn't joined: the address it opens (default: the room's, /CODE)
  remember?: string; // a phone that hasn't joined: the name it remembers from an earlier game
  fill?: { code?: string; name?: string }; // the join form: typed in, then Join tapped
  guest?: boolean; // TV: a second screen opened on the room's address, without the room's host token
  tailscale?: boolean; // TV: the machine also has a Tailscale address
  loading?: boolean; // shot before the page's script runs (what a slow connection shows)
  then?: (room: Room) => void; // something that happens at the table after the page is up (before the clicks)
  offline?: boolean; // the connection to the server drops after the page is up
  clicks?: string[]; // CSS selectors tapped in order before the shot (the first match each time)
  waitFor?: string; // a CSS selector that must match before the shot
  waitMs?: number; // extra settle time, for the TV's timed banners
  live?: boolean; // TV: load the page, then let the scene's `live` moves happen, then shoot
  sizes?: boolean; // also shot at every other screen size of its client (shots.ts SIZES); --every-size does this for all
  frames?: number[]; // TV: one shot per time on the 3D board's clock (seconds; the page opens at 0)
  flight?: boolean; // and the frames are fractions (0 to 1) of the way through the first dragon flight instead
}

export interface Scene {
  name: string;
  players: number;
  seed: number;
  lobby?: { bots: number }; // a room that hasn't started: no game (players - bots humans join, then the bots)
  names?: string[]; // seat names (default NAMES)
  bots?: number[]; // in a game: seats the server plays (they never move while staged)
  away?: number[]; // seats whose player has gone quiet (shown "(away)")
  resume?: boolean; // a saved game hosted again: every seat open until a phone claims it
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
const canPlaceCard = (g: Game, p: number) => seatState(g, p).hand.some((c) => c.kind === 'building' && c.needs === 'hex' && c.affordable && !c.blocked && c.hexes.length);
const committed = (g: Game) => g.raid!.commits.filter((c) => c.length).length;
const fightingPlayers = (g: Game) => new Set(g.raid!.fighters.map((id) => g.dragons.find((d) => d.id === id)!.owner)).size;

// The first seat (in seat order) matching a condition.
function seatWhere(g: Game, ok: (p: number) => boolean): number {
  const p = g.players.findIndex((_, i) => ok(i));
  if (p < 0) throw new Error('No seat matches.');
  return p;
}

// The hand the acting player would hold with these cards, and how the phone sees it.
const ALL_CARDS = [...Object.keys(BUILDINGS), ...Object.keys(UPGRADES), ...Object.keys(ACTIONS), ...Object.keys(DRAGONS)];
function giveHand(g: Game, p: number, keys: string[]) {
  g.players[p].hand = keys.map((key, i) => ({ id: `c${900 + i}`, deck: DRAGONS[key] || ACTIONS[key] ? 'action' : 'building', key }));
}
function handWith(g: Game, p: number, keys: string[]) {
  const c = structuredClone(g);
  giveHand(c, p, keys);
  return seatState(c, p).hand;
}
const card = (id: string) => `[data-card="${id}"]`;
// Why each card can't be played, one card per reason.
function blockedReasons(g: Game, p: number) {
  const seen = new Map<string, { id: string; key: string }>();
  for (const c of seatState(g, p).hand) {
    const reason = c.blocked?.replace(/No open \w+ hex/, 'No open hex').replace(/un-upgraded \w+/, 'un-upgraded');
    if (reason && !seen.has(reason)) seen.set(reason, { id: c.id, key: c.key });
  }
  return [...seen.values()];
}
// How the last raid ended, as the log says it.
const raidOutcome = (g: Game) => g.log.findLast((e) => /falls!|holds\.|Everyone bailed|Nobody commits/.test(e.text))?.text ?? '';
const raidOver = (g: Game) => g.raid === null || g.raid.step === 'vote';
const drain = (g: Game, p: number) => Object.keys(g.players[p].resources).forEach((r) => (g.players[p].resources[r as 'gold'] = 0));

// What a player has most of (to give in a trade), other than `not`.
function most(g: Game, p: number, not = ''): string {
  const r = g.players[p].resources;
  return (['stone', 'timber', 'crystal', 'livestock'] as const).filter((x) => x !== not).reduce((a, b) => (r[b] > r[a] ? b : a));
}

// The production cards (building art, batch 2).
const PRODUCTION_CARDS = ['cliff_works', 'stonemason', 'woodcutter', 'sawmill', 'driftwood_yard', 'ley_spire', 'gem_cutter', 'smelter', 'shepherds_fold', 'drovers_barn', 'fishery'];

// ---------- the scenes ----------
// The hand-3p scene's cards: kept, choose a dragon (two ways), choose a hex, choose a building.
const PLAYABLE = ['secret_hoard', 'growth_elixir', 'healing_potion', 'monument', 'workshop'];


export const SCENES: Scene[] = [
  {
    name: 'lobby',
    players: 3,
    seed: 1,
    lobby: { bots: 1 },
    shots: () => [
      { file: 'tv-lobby-3p', caption: 'TV lobby: two players and a bot joined', client: 'tv', sizes: true },
      { file: 'phone-join', caption: 'Phone: joining a room (code from the address)', client: 'phone', sizes: true },
      { file: 'phone-lobby-host', caption: 'Phone in the lobby: the first player, who can start', client: 'phone', seat: 0, sizes: true },
      { file: 'phone-lobby-waiting', caption: 'Phone in the lobby: anyone else, waiting for the start', client: 'phone', seat: 1 },
      { file: 'tv-loading', caption: 'TV: before its script has loaded', client: 'tv', loading: true },
      { file: 'phone-loading', caption: 'Phone: before its script has loaded', client: 'phone', path: '/', loading: true },
      { file: 'phone-join-no-code', caption: 'Phone: the join form opened without a room code', client: 'phone', path: '/', sizes: true },
      { file: 'phone-join-remembered', caption: 'Phone: the join form, remembering the name from last time', client: 'phone', path: '/', remember: 'Dax' },
      { file: 'phone-join-bad-code', caption: 'Phone: joining with a code no room has', client: 'phone', path: '/', fill: { code: 'QQQQ', name: 'Dax' }, clicks: ['#join button[type=submit]'], waitFor: '.error:not(:empty)' },
      { file: 'phone-join-name-taken', caption: 'Phone: joining with a name already taken', client: 'phone', fill: { name: 'ada' }, clicks: ['#join button[type=submit]'], waitFor: '.error:not(:empty)' },
      { file: 'phone-join-blank-name', caption: 'Phone: joining with only spaces for a name (empty is stopped by the browser first)', client: 'phone', fill: { name: '   ' }, clicks: ['#join button[type=submit]'], waitFor: '.error:not(:empty)' },
      { file: 'tv-guest-start', caption: "TV: a second screen on the room's address (no host token) taps Start", client: 'tv', guest: true, clicks: ['#start'], waitFor: '.toast' },
    ],
  },
  {
    name: 'opening-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 1 && g.phase === 'action',
    shots: (g) => [
      { file: 'tv-opening-production-2p', caption: 'TV, round 1 (2 players): the round opens (no dice to roll yet)', client: 'tv', waitMs: 600 },
      { file: 'phone-opening-hand-2p', caption: 'Phone, round 1: the first hand, on your turn', client: 'phone', seat: g!.turn, sizes: true },
      { file: 'phone-opening-waiting-2p', caption: "Phone, round 1: someone else's turn", client: 'phone', seat: (g!.turn + 1) % 2 },
      { file: 'phone-reconnecting', caption: 'Phone: the connection to the server dropped', client: 'phone', seat: g!.turn, offline: true },
    ],
  },
  {
    name: 'early-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action' && canPlaceCard(g, g.turn),
    shots: (g) => [
      { file: 'tv-early-3p', caption: 'TV, early game (3 players, round 2)', client: 'tv', sizes: true },
      { file: 'phone-card-open-3p', caption: 'Phone: a building card tapped open', client: 'phone', seat: g!.turn, clicks: ['.card.k-building[data-card]:not(.dim)'], sizes: true },
      { file: 'phone-build-pick-3p', caption: 'Phone: choosing where to build', client: 'phone', seat: g!.turn, clicks: ['.card.k-building[data-card]:not(.dim)', '[data-pickhex]'], sizes: true },
      { file: 'phone-build-bank-3p', caption: 'Phone: basic buildings, the egg project and the bank', client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]'], sizes: true },
      { file: 'phone-card-out-of-turn-3p', caption: "Phone: a card tapped open on someone else's turn", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-card]'] },
      { file: 'phone-trade-out-of-turn-3p', caption: "Phone: the trade tab on someone else's turn (only the acting player can be offered)", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-tab=trade]'] },
      { file: 'tv-reconnecting', caption: 'TV: the connection to the server dropped', client: 'tv', offline: true },
      { file: 'phone-join-started', caption: 'Phone: joining a game that has started, every seat taken', client: 'phone', fill: { name: 'Zed' }, clicks: ['#join button[type=submit]'], waitFor: '.error:not(:empty)' },
    ],
  },
  {
    name: 'keep-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'cards' && waitingOn(g).length === 2,
    shots: (g) => [
      { file: 'tv-keep-3p', caption: 'TV: everyone keeping one of two building cards', client: 'tv' },
      { file: 'phone-keep-3p', caption: 'Phone: keep one of the two building cards drawn', client: 'phone', seat: waitingOn(g!)[0] },
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
    // Every building on every board, side by side: each player's tower (one
    // with floors), and a quarry, lumber camp, crystal mine, pasture and roost
    // beside it, so their models and icons can be told apart and compared.
    name: 'basics-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 1 && g.phase === 'action',
    setup: (g) => {
      const near = (p: number, ok: (k: string) => boolean) => {
        const [tq, tr] = g.towers[p].split(',').map(Number);
        return Object.keys(g.map).filter((k) => !g.buildings[k] && ok(k))
          .sort((a, b) => { const d = (k: string) => { const [q, r] = k.split(',').map(Number); return Math.max(Math.abs(q - tq), Math.abs(r - tr), Math.abs(q + r - tq - tr)); }; return d(a) - d(b) || a.localeCompare(b); })[0];
      };
      const want: [string, string | null][] = [['quarry', 'mountain'], ['lumber_camp', 'forest'], ['crystal_mine', 'ley'], ['pasture', 'meadow'], ['roost', null]];
      for (const p of [0, 1]) {
        for (const [type, terrain] of want) {
          const k = near(p, (k) => (terrain ? g.map[k].terrain === terrain : !['ocean', 'harbor'].includes(g.map[k].terrain)));
          if (k) g.buildings[k] = { type, owner: p, upgrade: null, floors: 0 };
        }
        Object.keys(g.players[p].resources).forEach((r) => (g.players[p].resources[r as 'gold'] = 9));
      }
      g.buildings[g.towers[0]].floors = 3;
    },
    shots: (g) => [
      { file: 'tv-basics-2p', caption: 'TV: every basic building and both towers (one with three floors)', client: 'tv', waitMs: 4800 },
      { file: 'phone-basics-panel-2p', caption: 'Phone: the basic buildings to build', client: 'phone', seat: g!.turn, clicks: ['[data-tab="more"]'] },
      { file: 'phone-basics-map-2p', caption: 'Phone: the map with every basic building, choosing where to build a roost', client: 'phone', seat: g!.turn, clicks: ['[data-tab="more"]', '[data-basic="roost"]'] },
    ],
  },
  {
    // The production cards (building art, batch 2), each by its class's basic
    // building: one player has the quarry and lumber cards, the other the mine
    // and pasture cards, the coast cards on the coast. Their phone hand holds the
    // eleven cards.
    name: 'production-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 1 && g.phase === 'action',
    setup: (g) => {
      const dist = (a: string, b: string) => { const [q, r] = a.split(',').map(Number), [q2, r2] = b.split(',').map(Number); return Math.max(Math.abs(q - q2), Math.abs(r - r2), Math.abs(q + r - q2 - r2)); };
      const coast = (k: string) => Object.keys(g.map).some((o) => g.map[o].terrain === 'ocean' && dist(o, k) === 1);
      const near = (p: number, ok: (k: string) => boolean) => Object.keys(g.map).filter((k) => !g.buildings[k] && g.map[k].terrain !== 'ocean' && ok(k))
        .sort((a, b) => dist(a, g.towers[p]) - dist(b, g.towers[p]) || a.localeCompare(b))[0];
      const land = (terrain: string | null) => (k: string) => (terrain ? g.map[k].terrain === terrain : g.map[k].terrain !== 'harbor');
      const want: [string, (k: string) => boolean][][] = [
        [['quarry', land('mountain')], ['cliff_works', land(null)], ['stonemason', land(null)], ['lumber_camp', land('forest')], ['woodcutter', land(null)], ['sawmill', land(null)], ['driftwood_yard', coast]],
        [['crystal_mine', land('ley')], ['ley_spire', land(null)], ['gem_cutter', land(null)], ['smelter', land(null)], ['pasture', land('meadow')], ['shepherds_fold', land(null)], ['drovers_barn', land(null)], ['fishery', coast]],
      ];
      for (const p of [0, 1]) for (const [type, ok] of want[p]) {
        const k = near(p, ok);
        if (k) g.buildings[k] = { type, owner: p, upgrade: null, floors: 0 };
      }
      giveHand(g, g.turn, PRODUCTION_CARDS);
    },
    shots: (g) => [
      { file: 'tv-production-2p', caption: 'TV: the eleven production cards, each by its class\'s basic building', client: 'tv', waitMs: 4800 },
      { file: 'phone-production-map-2p', caption: 'Phone: the map with the production cards, choosing where to build a roost', client: 'phone', seat: g!.turn, clicks: ['[data-tab="more"]', '[data-basic="roost"]'] },
      { file: 'phone-production-hand-2p', caption: 'Phone: a hand of the eleven production cards (staged)', client: 'phone', seat: g!.turn },
    ],
  },
  {
    name: 'trade-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    // The acting player offers the next seat a trade, and the seat after offers them one.
    setup: (g) => {
      const t = g.turn, a = (t + 1) % 4, b = (t + 2) % 4;
      apply(g, t, `offer P${a + 1} give 1 ${most(g, t)} get 1 ${most(g, a, most(g, t))}`);
      apply(g, b, `offer P${t + 1} give 1 ${most(g, b)} get 1 ${most(g, t, most(g, b))}`);
    },
    shots: (g) => [
      { file: 'tv-trade-4p', caption: 'TV, mid game (4 players): two open trade offers', client: 'tv' },
      { file: 'phone-trade-incoming-4p', caption: 'Phone: an offer to you, out of turn', client: 'phone', seat: (g!.turn + 1) % 4 },
      { file: 'phone-trade-acting-4p', caption: "Phone, acting player: an offer in, and their own out", client: 'phone', seat: g!.turn },
      {
        file: 'phone-trade-compose-4p', caption: 'Phone, acting player: putting an offer together', client: 'phone', seat: g!.turn, sizes: true,
        clicks: ['[data-tab=trade]', '[data-to]:last-child', '[data-step="give stone 1"]', '[data-step="give timber 1"]', '[data-step="get gold 1"]', '.handfan [data-card]'],
      },
      { file: 'phone-trade-own-offer-4p', caption: "Phone: your own offer out, on someone else's turn", client: 'phone', seat: (g!.turn + 2) % 4 },
      {
        // Last: it changes the room. The offerer has spent what they offered by the time it's accepted.
        file: 'phone-toast-4p', caption: 'Phone: an error toast (accepting an offer the offerer can no longer pay)', client: 'phone', seat: (g!.turn + 1) % 4,
        then: (room) => room.mutate((g2) => drain(g2, g2.turn)), clicks: ['[data-accept]'], waitFor: '.toast',
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
      const keys = [...Object.keys(BUILDINGS).filter((k) => !BUILDINGS[k].basic), ...Object.keys(UPGRADES), ...Object.keys(ACTIONS), ...Object.keys(DRAGONS)];
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
      { file: 'tv-raid-vote-5p', caption: 'TV, raid vote (5 players): two have voted', client: 'tv', sizes: true },
      { file: 'phone-raid-vote-5p', caption: 'Phone: voting for the target', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.votes[p] === null), sizes: true },
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
    shots: () => [{ file: 'tv-raid-result-3p', caption: "TV: a raid's fight replayed, at the end: who won and what they took", client: 'tv', live: true, waitMs: 6600 }],
  },
  {
    // The same raid, caught mid-replay.
    name: 'raid-fight-3p',
    players: 3,
    seed: 3,
    until: (g) => g.round >= 3 && step(g) === 'bail' && committed(g) >= 2 && g.raid!.choices.every((c, p) => c !== null || !g.raid!.commits[p].length || p === 0),
    live: (g) => g.raid === null || g.raid.step === 'vote',
    liveEnd: (g) => /falls!/.test(g.log.findLast((e) => /falls!|holds\.|Everyone bailed/.test(e.text))?.text ?? ''),
    shots: () => [{ file: 'tv-raid-fight-3p', caption: "TV: a raid's fight mid-replay, health bars falling as the hits land", client: 'tv', live: true, waitMs: 2200 }],
  },
  {
    // A fight one raider bailed out of: they're shown flown home beside it.
    name: 'raid-fled-4p',
    players: 4,
    seed: 5,
    until: (g) => g.round >= 3 && step(g) === 'bail' && committed(g) >= 2 && g.raid!.choices.every((c) => c === null),
    setup: (g) => apply(g, seatWhere(g, (p) => g.raid!.commits[p].length > 0), 'bail'),
    live: (g) => g.raid === null || g.raid.step === 'vote',
    liveEnd: (g) => /falls!|holds\./.test(g.log.findLast((e) => /falls!|holds\.|Everyone bailed/.test(e.text))?.text ?? ''), // the rest fought
    shots: () => [{ file: 'tv-raid-fled-4p', caption: 'TV: a fight mid-replay, with the raider who bailed flown home', client: 'tv', live: true, waitMs: 2200 }],
  },
  {
    name: 'discard-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'discard',
    shots: (g) => [
      { file: 'tv-discard-4p', caption: 'TV, end of round: someone is discarding', client: 'tv' },
      { file: 'phone-discard-4p', caption: 'Phone: over the hand limit, one card picked', client: 'phone', seat: waitingOn(g!)[0], clicks: ['[data-card]'], sizes: true },
      { file: 'phone-discard-waiting-4p', caption: 'Phone: under the limit, waiting for the others to discard', client: 'phone', seat: seatWhere(g!, (p) => !waitingOn(g!).includes(p)) },
    ],
  },
  {
    name: 'production-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'discard',
    live: (g) => g.phase === 'action',
    shots: () => [{ file: 'tv-production-4p', caption: "TV: a new round opens with each player's production roll, one after another (the second rolling)", client: 'tv', live: true, waitMs: 1800 }],
  },
  {
    name: 'production-done-6p',
    players: 6,
    seed: 1,
    until: (g) => g.round >= 4 && g.phase === 'discard',
    live: (g) => g.phase === 'action',
    shots: () => [{ file: 'tv-production-done-6p', caption: "TV: every player's production roll has landed (6 players)", client: 'tv', live: true, waitFor: '#overlay .production li.up:last-child:not(:has(.rolling))', waitMs: 300 }],
  },
  {
    name: 'late-6p',
    players: 6,
    seed: 1,
    until: (g) => g.phase === 'action' && best(g) >= 11 && g.dragons.length >= 8,
    shots: (g) => {
      const leader = seatWhere(g!, (p) => score(g!, p).total === best(g!));
      return [
        { file: 'tv-late-6p', caption: 'TV, late game (6 players): a busy board', client: 'tv', sizes: true },
        { file: 'phone-late-6p', caption: 'Phone, late game: the leader', client: 'phone', seat: leader, sizes: true },
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
      { file: 'phone-game-over-winner', caption: 'Phone: the winner', client: 'phone', seat: g!.winner!, sizes: true },
      { file: 'phone-game-over-loser', caption: 'Phone: everyone else', client: 'phone', seat: (g!.winner! + 1) % 4 },
      { file: 'phone-join-another', caption: 'Phone: after "Join another game", back at the join form', client: 'phone', seat: (g!.winner! + 1) % 4, clicks: ['#newgame'], waitFor: '#join' },
    ],
  },
  {
    name: 'over-6p',
    players: 6,
    seed: 1,
    until: (g) => g.phase === 'over',
    shots: () => [{ file: 'tv-game-over-6p', caption: 'TV: final scores (6 players)', client: 'tv', sizes: true }],
  },
  // ---------- the lobby, more ways ----------
  {
    name: 'lobby-empty',
    players: 0,
    seed: 1,
    lobby: { bots: 0 },
    shots: () => [{ file: 'tv-lobby-empty', caption: 'TV lobby: a new room, nobody yet', client: 'tv' }],
  },
  {
    name: 'lobby-alone',
    players: 1,
    seed: 1,
    lobby: { bots: 0 },
    shots: () => [
      { file: 'tv-lobby-alone', caption: 'TV lobby: one player, Start disabled', client: 'tv' },
      { file: 'phone-lobby-alone', caption: 'Phone in the lobby: the first player, alone', client: 'phone', seat: 0 },
    ],
  },
  {
    name: 'lobby-full-6p',
    players: 6,
    seed: 1,
    lobby: { bots: 2 },
    names: LONG_NAMES,
    away: [1],
    shots: () => [
      { file: 'tv-lobby-full-6p', caption: 'TV lobby: full (6), long names, two bots, one away, with a Tailscale address', client: 'tv', tailscale: true, sizes: true },
      { file: 'phone-lobby-full-6p', caption: 'Phone in the lobby: full, long names', client: 'phone', seat: 2, sizes: true },
      { file: 'phone-join-full', caption: 'Phone: joining a full room', client: 'phone', fill: { name: 'Zed' }, clicks: ['#join button[type=submit]'], waitFor: '.error:not(:empty)' },
    ],
  },
  {
    // Each shot changes the room, in this order.
    name: 'lobby-leave',
    players: 3,
    seed: 1,
    lobby: { bots: 0 },
    shots: () => [
      { file: 'phone-removed', caption: 'Phone: removed from the lobby (by the TV or the first player)', client: 'phone', seat: 2, then: (room) => room.leave(2), waitFor: '#join' },
      { file: 'phone-left', caption: 'Phone: after tapping Leave in the lobby', client: 'phone', seat: 1, clicks: ['#leave'], waitFor: '#join' },
    ],
  },
  {
    name: 'resume-3p',
    players: 3,
    seed: 1,
    resume: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    shots: () => [
      { file: 'tv-resume-3p', caption: 'TV: a saved game hosted again, every seat open', client: 'tv' },
      { file: 'phone-resume-join', caption: 'Phone: joining a resumed game takes an open seat', client: 'phone', fill: { name: 'Ada' }, clicks: ['#join button[type=submit]'], waitFor: '.mehead' },
    ],
  },

  // ---------- players and names ----------
  {
    name: 'names-6p',
    players: 6,
    seed: 1,
    names: LONG_NAMES,
    bots: [4, 5],
    away: [2],
    until: (g) => g.round >= 4 && g.phase === 'action' && g.turn < 4,
    setup: (g) => {
      const t = g.turn, a = (t + 1) % 4;
      apply(g, t, `offer P${a + 1} give 1 ${most(g, t)} get 1 ${most(g, a, most(g, t))}`);
      apply(g, a, 'say Only if you leave Knightsgate to me.');
    },
    shots: (g) => [
      { file: 'tv-names-6p', caption: 'TV (6 players): long names, two bots, one away, an offer and talk', client: 'tv', sizes: true },
      { file: 'phone-names-6p', caption: 'Phone with a long name, on its turn', client: 'phone', seat: g!.turn, sizes: true },
      { file: 'phone-names-trade-6p', caption: 'Phone: the trade tab with long names', client: 'phone', seat: g!.turn, clicks: ['[data-tab=trade]'], sizes: true },
    ],
  },

  // ---------- the hand, more ways ----------
  {
    // A staged hand of cards that can all be played (each needs something different), with resources to pay.
    name: 'hand-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round >= 3 && g.phase === 'action' && handWith(g, g.turn, PLAYABLE).every((c) => !c.blocked || c.needs === 'unplayable'),
    setup: (g) => {
      giveHand(g, g.turn, PLAYABLE);
      for (const r of Object.keys(g.players[g.turn].resources)) g.players[g.turn].resources[r as 'gold'] = 8;
    },
    shots: (g) => {
      const id = (key: string) => `c${900 + PLAYABLE.indexOf(key)}`;
      const me = { client: 'phone' as const, seat: g!.turn };
      return [
        { ...me, file: 'phone-hand-3p', caption: 'Phone: a hand of playable cards (staged)' },
        { ...me, file: 'phone-zoom-hoard', caption: 'Phone: Secret Hoard tapped open (kept, not played)', clicks: [card(id('secret_hoard'))] },
        { ...me, file: 'phone-zoom-elixir', caption: 'Phone: Growth Elixir, choosing the dragon', clicks: [card(id('growth_elixir'))] },
        { ...me, file: 'phone-zoom-potion', caption: 'Phone: Healing Potion, choosing the hurt dragon', clicks: [card(id('healing_potion'))] },
        { ...me, file: 'phone-zoom-monument', caption: 'Phone: Monument tapped open', clicks: [card(id('monument'))] },
        { ...me, file: 'phone-zoom-upgrade', caption: 'Phone: an upgrade card tapped open', clicks: [card(id('workshop'))] },
        { ...me, file: 'phone-pick-upgrade', caption: 'Phone: choosing the building to upgrade', clicks: [card(id('workshop')), '[data-pickhex]'], sizes: true },
        { ...me, file: 'phone-pick-basic', caption: 'Phone: choosing where a basic building goes (no card)', clicks: ['[data-tab=more]', '[data-basic]:not([disabled])'] },
        { ...me, file: 'phone-bank-picks', caption: 'Phone: the bank, giving crystal for 2 stone', clicks: ['[data-tab=more]', '[data-bank="give crystal"]', '[data-bank="get stone"]', '[data-btimes="1"]'] },
      ];
    },
  },
  {
    // One of every card again, in a game where each reason a card can't be played comes up.
    name: 'blocked-3p',
    players: 3,
    seed: 3,
    until: (g) => {
      if (g.round < 4 || g.phase !== 'action') return false;
      const c = structuredClone(g);
      giveHand(c, c.turn, ALL_CARDS);
      return blockedReasons(c, c.turn).length >= 6 && seatState(c, c.turn).hand.some((x) => !x.blocked && !x.affordable);
    },
    setup: (g) => giveHand(g, g.turn, ALL_CARDS),
    shots: (g) => {
      const me = { client: 'phone' as const, seat: g!.turn };
      const poor = seatState(g!, g!.turn).hand.find((x) => !x.blocked && !x.affordable)!;
      return [
        ...blockedReasons(g!, g!.turn).filter((b) => b.key !== 'secret_hoard').map((b) => ({ ...me, file: `phone-blocked-${b.key}`, caption: `Phone: a card that can't be played (${b.key})`, clicks: [card(b.id)] })),
        { ...me, file: 'phone-cant-afford', caption: "Phone: a card you can't afford yet", clicks: [card(poor.id)] },
      ];
    },
  },
  {
    name: 'empty-hand-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => (g.players[g.turn].hand = []),
    shots: (g) => [{ file: 'phone-empty-hand', caption: 'Phone: no cards in hand', client: 'phone', seat: g!.turn }],
  },
  {
    name: 'discard-many',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'discard' && g.players.some((pl) => pl.hand.length - seatState(g, 0).handCap >= 2),
    shots: (g) => [
      { file: 'phone-discard-many', caption: 'Phone: discarding several cards, two picked', client: 'phone', seat: seatWhere(g!, (p) => g!.players[p].hand.length - seatState(g!, p).handCap >= 2), clicks: ['[data-card]', '[data-card]:not(.picked)'] },
    ],
  },

  // ---------- the raid, more ways ----------
  {
    name: 'horn-4p',
    players: 4,
    seed: 1,
    until: (g) => step(g) === 'vote' && g.raidsLeft >= 2,
    shots: () => [{ file: 'tv-two-raids-4p', caption: 'TV: a round with two raids (War Horn), the first vote', client: 'tv' }],
  },
  {
    name: 'commit-5p',
    players: 5,
    seed: 1,
    until: (g) => {
      if (step(g) !== 'commit') return false;
      const r = g.raid!, ready = (p: number) => seatState(g, p).raidReady.length;
      return g.players.some((_, p) => r.ready[p] && r.commits[p].length) && g.players.some((_, p) => !r.ready[p] && !r.commits[p].length && ready(p)) && g.players.some((_, p) => !ready(p));
    },
    shots: (g) => {
      const r = g!.raid!, ready = (p: number) => seatState(g!, p).raidReady.length;
      return [
        { file: 'phone-raid-locked-5p', caption: 'Phone, raid: locked in', client: 'phone', seat: seatWhere(g!, (p) => r.ready[p] && r.commits[p].length > 0) },
        { file: 'phone-raid-stay-home-5p', caption: 'Phone, raid: nothing committed yet ("Lock in (stay home)")', client: 'phone', seat: seatWhere(g!, (p) => !r.ready[p] && !r.commits[p].length && ready(p) > 0), sizes: true },
        { file: 'phone-raid-no-dragons-5p', caption: 'Phone, raid: no dragon able to raid', client: 'phone', seat: seatWhere(g!, (p) => !ready(p)) },
      ];
    },
  },
  {
    name: 'bail-4p',
    players: 4,
    seed: 1,
    until: (g) => step(g) === 'bail' && g.players.some((_, p) => !g.raid!.commits[p].length) && g.players.some((_, p) => g.raid!.commits[p].length && g.raid!.choices[p]),
    shots: (g) => [
      { file: 'phone-raid-not-in-4p', caption: "Phone, fight or bail: you're not in this raid", client: 'phone', seat: seatWhere(g!, (p) => !g!.raid!.commits[p].length) },
      { file: 'phone-raid-chose-4p', caption: 'Phone, fight or bail: already chosen', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.commits[p].length > 0 && !!g!.raid!.choices[p]) },
    ],
  },
  {
    name: 'raid-lost-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round >= 3 && step(g) === 'bail' && committed(g) >= 1,
    live: raidOver,
    liveEnd: (g) => /holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-lost-3p', caption: 'TV: a lost raid, at the end of the replay ("… holds")', client: 'tv', live: true, waitFor: '#overlay .outcome.show', waitMs: 400 }],
  },
  {
    name: 'raid-bailed-2p',
    players: 2,
    seed: 1,
    until: (g) => step(g) === 'bail' && committed(g) >= 1,
    live: raidOver,
    liveEnd: (g) => /Everyone bailed/.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-bailed-2p', caption: 'TV: everyone bailed (2 players)', client: 'tv', live: true, waitFor: '#overlay.banner', waitMs: 400 }],
  },
  {
    name: 'raid-nobody-3p',
    players: 3,
    seed: 1,
    // With no dragon able to raid, the commit step is skipped: the raid ends on the last vote.
    until: (g) => step(g) === 'vote' && g.raid!.votes.filter((v) => v === null).length === 1 && g.players.every((_, p) => !seatState(g, p).raidReady.length),
    live: (g) => g.raid === null || g.raid.votes.every((v) => v === null), // this raid is over (the next one, if any, hasn't had a vote)
    liveEnd: (g) => /Nobody commits/.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-nobody-3p', caption: 'TV: nobody commits to the raid', client: 'tv', live: true, waitFor: '#overlay.banner', waitMs: 400 }],
  },
  {
    // The round's last raid is fought, then the next round opens: two banners back to back.
    name: 'banners-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round >= 3 && step(g) === 'bail' && g.raidsLeft === 1 && committed(g) >= 1,
    live: (g) => g.phase === 'action',
    liveEnd: (g) => /falls!|holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-banners-3p', caption: "TV: the next round's production, right after a raid's result", client: 'tv', live: true, waitFor: '#overlay .production', waitMs: 1800 }],
  },

  // ---------- table talk ----------
  {
    name: 'talk-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn, a = (t + 1) % 4, b = (t + 2) % 4;
      apply(g, a, 'say Anyone want timber? I have far too much of it.');
      apply(g, t, 'say Maybe. What do you want for 2?');
      apply(g, b, `tell P${t + 1} Don't trade with them, they're one roost from winning.`);
      apply(g, a, 'say A crystal each, and I stay out of the next raid.');
    },
    shots: (g) => {
      const t = g!.turn, a = (t + 1) % 4, b = (t + 2) % 4;
      return [
        { file: 'tv-talk-4p', caption: 'TV: table talk (private messages stay off it)', client: 'tv', sizes: true },
        { file: 'phone-talk-open-4p', caption: 'Phone: the talk sheet open, with a private message', client: 'phone', seat: t, clicks: ['.talkbar .latest'], sizes: true },
        {
          // Last: it adds to the talk. What was said before the page opened counts as heard.
          file: 'phone-talk-unread-4p', caption: 'Phone: the talk bar with unread messages', client: 'phone', seat: t,
          then: (room) => room.mutate((g2) => {
            apply(g2, b, 'say Deal or not, the raid is next.');
            apply(g2, a, `tell P${t + 1} Two crystal then. Final offer.`);
          }),
        },
      ];
    },
  },
];

