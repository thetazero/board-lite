// Staged game situations for screenshots (src/shots/shots.ts). A scene opens
// with a seeded bot game played to a point every game reaches (a round, a
// phase, the round before the end), then stages what its shots are about:
// the hand, the dragons, the buildings, the raid's votes and choices. Nothing
// searches for a lucky game, so a tuning change can't make a scene fail to
// stage unless it takes away what the scene shows.

import { botStep, standInMove } from '../bot.ts';
import { ACTIONS, BEASTS, BUILDINGS, DRAGONS, TUNING, UPGRADES, targetPower } from '../data.ts';
import { apply, buildableHexes, dragonCapacity, newGame, score, turnOrder, upgradeTargets, waitingOn, type Game } from '../engine.ts';
import { PEAK, neighbors } from '../map.ts';
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
  press?: { on: string; dx?: number; dy?: number }; // phone: a finger put down on this (after the clicks) and slid by dx, dy pixels, still held for the shot
  waitFor?: string; // a CSS selector that must match before the shot
  waitMs?: number; // extra settle time, for the TV's timed banners
  hold?: boolean; // the moment `waitFor` matches, the page's timers stop: a timed banner stays up for the shot, however slow the machine
  live?: boolean; // load the page, then let the scene's `live` moves happen, then shoot
  screen?: boolean; // phone: a TV is watching the room too, so its scenes hold the phones
  sizes?: boolean; // also shot at every other screen size of its client (shots.ts SIZES); --every-size does this for all
  frames?: number[]; // TV: one shot per time on the 3D board's clock (seconds; the page opens at 0)
  flight?: boolean; // and the frames are fractions (0 to 1) of the way through the first dragon flight instead
  table?: boolean; // TV: the table view a phone shows in a game with no TV (/tv?remote), on a phone's screen
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
  remote?: boolean; // a game with no TV: made from a phone, each phone shows the table
  // Play bot moves until this holds. Only a point every game reaches: a
  // round, a phase, whose turn. What the shots need is staged in `setup`.
  until?: (g: Game) => boolean;
  setup?: (g: Game) => void; // staged state and scripted commands once it holds
  live?: (g: Game, rng: Rng) => void; // for live shots: the moves made once the page is open
  liveEnd?: (g: Game) => boolean; // and what must hold after them (checked when staging)
  shots: (g: Game | null) => Shot[];
}

export interface Staged {
  scene: Scene;
  game: Game | null;
  rng: Rng; // the bot's dice, to carry on into live moves
}

const MAX_STEPS = 30000;

// Bot moves until `until` holds. False if the game ended first.
// The shots a run takes: those whose file or scene name contains one of the
// names asked for (all of them, with no names), by scene; scenes with none are left out.
export function picked(staged: Staged[], only: string[] | null): { st: Staged; shots: Shot[] }[] {
  return staged
    .map((st) => {
      const shots = st.scene.shots(st.game);
      return { st, shots: only ? shots.filter((shot) => only.some((p) => shot.file.includes(p) || st.scene.name.includes(p))) : shots };
    })
    .filter((p) => p.shots.length);
}

export function drive(g: Game, rng: Rng, until: (g: Game) => boolean): boolean {
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    if (until(g)) return true;
    if (g.phase === 'over') return false;
    botStep(g, rng);
  }
  return false;
}

export function stage(scene: Scene): Staged {
  const fail = (why: string): never => {
    throw new Error(`Scene ${scene.name}: ${why}.`);
  };
  if (scene.lobby) return { scene, game: null, rng: { state: scene.seed } };
  const g = newGame(scene.players, scene.seed);
  const rng = { state: scene.seed * 7919 };
  if (!drive(g, rng, scene.until ?? (() => true))) fail('the game ended before its opening did');
  scene.setup?.(g);
  // A live scene's moves must end where it says (checked on a copy).
  if (scene.live) {
    const after = structuredClone(g);
    scene.live(after, { ...rng });
    if (scene.liveEnd && !scene.liveEnd(after)) fail('its live moves end somewhere else');
  }
  return { scene, game: g, rng };
}

// Live moves: the bots play until `until` holds.
const bots = (until: (g: Game) => boolean) => (g: Game, rng: Rng) => void drive(g, rng, until);

// ---------- staging ----------

// The moves that change as little as they can (the stand-in's: end the turn,
// keep the first card, vote for the first target, send nothing, bail), made
// for whoever is waited on until `until` holds.
function pass(g: Game, until: (g: Game) => boolean) {
  for (let steps = 0; !until(g); steps++) {
    if (g.phase === 'over' || steps > 5000) throw new Error('pass: never got there');
    standInMove(g, waitingOn(g)[0]);
  }
}

// From the action phase to this round's raid vote: everyone ends their turn.
// Someone must have a dragon able to raid (see `arm`).
function toVote(g: Game) {
  const round = g.round;
  pass(g, (x) => x.phase === 'raid' || x.round !== round);
  if (g.phase !== 'raid') throw new Error('toVote: no raid this round');
}

// The raid's targets, weakest first.
const byPower = (g: Game) => [...g.raid!.candidates].sort((a, b) => targetPower(a) - targetPower(b));
// Seats in `who` vote for target t (all who haven't voted, by default).
function vote(g: Game, t: string, who = g.players.map((_, p) => p)) {
  for (const p of who) if (g.raid!.votes[p] === null) apply(g, p, `vote ${g.raid!.candidates.indexOf(t) + 1}`);
}
// Seat p sends every dragon able to raid, and locks in.
function sendAll(g: Game, p: number) {
  apply(g, p, `commit ${g.dragons.filter((d) => d.owner === p && ready(d)).map((d) => d.id).join(' ')}`);
  apply(g, p, 'ready');
}
// To the fight-or-bail step: the raiders send everything, everyone else stays home.
function toBail(g: Game, raiders: number[]) {
  for (const p of raiders) sendAll(g, p);
  for (const p of g.players.keys()) if (!g.raid!.ready[p]) apply(g, p, 'ready');
}
const ready = (d: { stage: number; resting: string; damage: number }) => d.stage > 0 && !d.resting && !d.damage;

// Seat p's dragons, replaced by one fresh dragon at each stage given (0 an egg,
// 3 an adult), each ready to raid; roosts are built beside their land until
// they fit.
function arm(g: Game, p: number, stages: number[]) {
  g.dragons = g.dragons.filter((d) => d.owner !== p);
  while (dragonCapacity(g, p) < stages.length) {
    const k = buildableHexes(g, p, 'roost').sort()[0];
    if (!k) throw new Error(`arm: no room for a roost for P${p + 1}`);
    g.buildings[k] = { type: 'roost', owner: p, upgrade: null, floors: 0 };
  }
  const keys = Object.keys(DRAGONS);
  stages.forEach((stage, i) => g.dragons.push({ id: `d${g.nextId++}`, owner: p, key: keys[(p + i) % keys.length], stage, growth: 0, damage: 0, resting: '' }));
}

// Seat p gets n buildings that roll a die each round (quarries, lumber camps
// and the like), each on the first hex beside their land of its terrain: a
// bot game rarely has them built by the rounds the scenes stage, and with
// none the round's production roll has no dice to show.
function producers(g: Game, p: number, n: number) {
  const keys = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].produces).sort();
  for (let placed = 0, i = 0; placed < n; i++) {
    if (i >= keys.length * n) throw new Error(`producers: no room for P${p + 1}'s`);
    const k = buildableHexes(g, p, keys[i % keys.length])[0];
    if (!k) continue;
    g.buildings[k] = { type: keys[i % keys.length], owner: p, upgrade: null, floors: 0 };
    placed++;
  }
}
// Everyone rolls dice: seat p gets 1 or 2 dice buildings, by seat.
const everyoneRolls = (g: Game) => g.players.forEach((_, p) => producers(g, p, 1 + (p % 2)));
// The round the live moves opened rolled dice for every seat.
const allRolled = (g: Game) => {
  const at = g.log.findLastIndex((e) => e.ev?.k === 'round');
  return g.log.slice(at).filter((e) => e.ev?.k === 'produce' && e.dice?.length).length === g.players.length;
};

// Seat p's hand gets `extra` more cards than the hand limit allows.
function overHand(g: Game, p: number, extra: number) {
  const pl = g.players[p];
  while (pl.hand.length < TUNING.handCap + extra) pl.hand.push({ id: `c${800 + pl.hand.length}`, deck: 'action', key: 'windfall' });
}
// From the action phase to the round's discards: `over` hold too many cards,
// everyone else is within the limit, and no one raids.
function toDiscard(g: Game, over: number[], extra = 1) {
  for (const p of g.players.keys()) {
    g.players[p].hand = g.players[p].hand.slice(0, TUNING.handCap);
    if (over.includes(p)) overHand(g, p, extra);
  }
  pass(g, (x) => x.phase === 'discard');
}

// The last round of this seed's bot game, found by playing it out on a copy:
// `until: late(...)` stops in the round before it, so the board is as full as
// the game gets while it is still on.
function late(players: number, seed: number) {
  let round = 0; // found the first time it's asked
  return (x: Game) => {
    if (!round) {
      const g = newGame(players, seed);
      drive(g, { state: seed * 7919 }, (y) => y.phase === 'over');
      round = g.round - 1;
    }
    return x.round === round && x.phase === 'action';
  };
}

// ---------- conditions and staging helpers ----------

const best = (g: Game) => Math.max(...g.players.map((_, p) => score(g, p).total));
// A building card in seat p's hand they have a hex for, affordable or not.
const placeableCard = (g: Game, p: number) => seatState(g, p).hand.find((c) => c.kind === 'building' && c.needs === 'hex' && !c.blocked && c.hexes.length);
// The acting player holds a building card they have a hex for (one is dealt
// if not), and what it costs.
function canBuild(g: Game) {
  const p = g.turn, pl = g.players[p];
  if (!placeableCard(g, p)) {
    const key = Object.keys(BUILDINGS).sort().find((k) => !BUILDINGS[k].basic && !BUILDINGS[k].onTower && buildableHexes(g, p, k).length);
    if (!key) throw new Error('canBuild: no building card fits');
    pl.hand.push({ id: `c${850 + pl.hand.length}`, deck: 'building', key });
  }
  const c = placeableCard(g, p)!;
  for (const [r, n] of Object.entries(c.cost) as [keyof typeof pl.resources, number][]) pl.resources[r] = Math.max(pl.resources[r], n);
}
const dist = (a: string, b: string) => { const [q, r] = a.split(',').map(Number), [q2, r2] = b.split(',').map(Number); return Math.max(Math.abs(q - q2), Math.abs(r - r2), Math.abs(q + r - q2 - r2)); };
// At least n buildings besides the towers, roosts added for each seat in turn if not.
function buildingsAtLeast(g: Game, n: number, seats = g.players.map((_, p) => p)) {
  for (let i = 0; Object.values(g.buildings).filter((b) => b.type !== 'tower').length < n; i++) {
    if (i > 50) throw new Error('buildingsAtLeast: no room');
    const p = seats[i % seats.length];
    const k = buildableHexes(g, p, 'roost').sort()[0];
    if (k) g.buildings[k] = { type: 'roost', owner: p, upgrade: null, floors: 0 };
  }
}

// The first seat (in seat order) matching a condition.
function seatWhere(g: Game, ok: (p: number) => boolean): number {
  const p = g.players.findIndex((_, i) => ok(i));
  if (p < 0) throw new Error('No seat matches.');
  return p;
}

// Seat p's hand, staged: one card per key.
const ALL_CARDS = [...Object.keys(BUILDINGS), ...Object.keys(UPGRADES), ...Object.keys(ACTIONS), ...Object.keys(DRAGONS)];
function giveHand(g: Game, p: number, keys: string[]) {
  g.players[p].hand = keys.map((key, i) => ({ id: `c${900 + i}`, deck: DRAGONS[key] || ACTIONS[key] ? 'action' : 'building', key }));
}
const card = (id: string) => `[data-card="${id}"]`;
// Why each card can't be played, one card per reason.
function blockedReasons(g: Game, p: number) {
  const seen = new Map<string, { id: string; key: string }>();
  for (const c of seatState(g, p).hand) {
    const reason = c.blocked?.replace(/No empty [\w ]+ is adjacent/, 'No empty hex is adjacent').replace(/no [\w ,]+ without an upgrade/, 'no building without an upgrade');
    if (reason && !seen.has(reason)) seen.set(reason, { id: c.id, key: c.key });
  }
  return [...seen.values()];
}
// How the last raid ended, as the log says it.
const raidOutcome = (g: Game) => g.log.findLast((e) => /falls\.|holds\.|Everyone bails|No one raids|no raid this round/.test(e.text))?.text ?? '';
const raidOver = (g: Game) => g.raid === null || g.raid.step === 'vote';
const drain = (g: Game, p: number) => Object.keys(g.players[p].resources).forEach((r) => (g.players[p].resources[r as 'gold'] = 0));

// What a player has most of (to give in a trade), other than `not`.
function most(g: Game, p: number, not = ''): string {
  const r = g.players[p].resources;
  return (['stone', 'timber', 'crystal', 'livestock'] as const).filter((x) => x !== not).reduce((a, b) => (r[b] > r[a] ? b : a));
}

// The production cards (building art, batch 2).
const PRODUCTION_CARDS = ['cliff_works', 'stonemason', 'woodcutter', 'sawmill', 'driftwood_yard', 'ley_spire', 'gem_cutter', 'smelter', 'shepherds_fold', 'drovers_barn', 'fishery'];
// The dragon, trade and monument cards and the upgrades (building art, batch 3).
const CIVIC_CARDS = ['hatchery', 'port', 'market', 'tower_floor', 'monument', 'standing_stones', 'lighthouse', 'guildhall', 'workshop', 'nesting_grounds', 'trade_charter'];

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
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: canBuild,
    shots: (g) => [
      { file: 'tv-early-3p', caption: 'TV, early game (3 players, round 2)', client: 'tv', sizes: true },
      { file: 'phone-card-open-3p', caption: 'Phone: a building card tapped open', client: 'phone', seat: g!.turn, clicks: ['.card.k-building[data-card]:not(.dim)'], sizes: true },
      { file: 'phone-build-pick-3p', caption: 'Phone: choosing where to build', client: 'phone', seat: g!.turn, clicks: ['.card.k-building[data-card]:not(.dim)', '[data-pickhex]'], sizes: true },
      { file: 'phone-build-bank-3p', caption: 'Phone: basic buildings, the egg project and the bank', client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]'], sizes: true },
      { file: 'phone-egg-element-3p', caption: "Phone: the base dragon egg's Hatch tapped, choosing its element", client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]', '#egg'] },
      { file: 'phone-card-out-of-turn-3p', caption: "Phone: a card tapped open on someone else's turn", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-card]'] },
      { file: 'phone-trade-out-of-turn-3p', caption: "Phone: the trade tab on someone else's turn (only the acting player can be offered)", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-tab=trade]'] },
      { file: 'tv-reconnecting', caption: 'TV: the connection to the server dropped', client: 'tv', offline: true },
      { file: 'phone-join-started', caption: "Phone: the room's address for a game that has started, everyone at their seat", client: 'phone', waitFor: '.seats' },
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
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: canBuild,
    live: (g) => {
      const c = placeableCard(g, g.turn)!;
      apply(g, g.turn, `build ${c.id} ${c.hexes[0]}`);
    },
    liveEnd: (g) => / builds a /.test(g.log.at(-1)?.text ?? ''),
    shots: () => [{ file: 'tv-build-3p', caption: 'TV: a new building pops up from the page', client: 'tv', live: true, frames: [0, 0.15, 0.3, 0.45, 0.7, 1.2] }],
  },
  {
    name: 'port-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // A port on the harbor nearest a tower, that tower's player's.
    setup: (g) => {
      const near = (k: string) => Math.min(...g.towers.map((t) => dist(k, t)));
      const k = Object.keys(g.map).filter((x) => g.map[x].terrain === 'harbor' && !g.buildings[x]).sort((a, b) => near(a) - near(b) || a.localeCompare(b))[0];
      const owner = g.towers.findIndex((t) => dist(k, t) === near(k));
      g.buildings[k] = { type: 'port', owner, upgrade: null, floors: 0 };
    },
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
    // The dragon, trade and monument cards and the four upgrades (building art,
    // batch 3). One player has the dragon and trade buildings, the other the
    // monuments; each upgrade sits on two buildings it fits, one per player, so
    // the board shows every upgrade on a building and the same building without
    // it. Their phone hand holds the twelve cards.
    name: 'civic-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 1 && g.phase === 'action',
    setup: (g) => {
      const dist = (a: string, b: string) => { const [q, r] = a.split(',').map(Number), [q2, r2] = b.split(',').map(Number); return Math.max(Math.abs(q - q2), Math.abs(r - r2), Math.abs(q + r - q2 - r2)); };
      const by = (t: string) => (k: string) => Object.keys(g.map).some((o) => g.map[o].terrain === t && dist(o, k) === 1);
      const near = (p: number, ok: (k: string) => boolean) => Object.keys(g.map).filter((k) => !g.buildings[k] && g.map[k].terrain !== 'ocean' && ok(k))
        .sort((a, b) => dist(a, g.towers[p]) - dist(b, g.towers[p]) || a.localeCompare(b))[0];
      const land = (k: string) => g.map[k].terrain !== 'harbor';
      const want: [string, (k: string) => boolean, string | null][][] = [
        [['port', (k) => g.map[k].terrain === 'harbor', 'trade_charter'], ['market', land, null], ['hatchery', land, 'nesting_grounds'], ['roost', land, null], ['quarry', land, 'workshop'], ['monument', land, null]],
        [['monument', land, null], ['standing_stones', (k) => land(k) && by('ley')(k), null], ['lighthouse', (k) => land(k) && by('ocean')(k), null], ['guildhall', land, null], ['market', land, 'trade_charter'], ['roost', land, 'nesting_grounds'], ['quarry', land, null]],
      ];
      for (const p of [0, 1]) for (const [type, ok, upgrade] of want[p]) {
        const k = near(p, ok);
        if (k) g.buildings[k] = { type, owner: p, upgrade, floors: 0 };
      }
      g.buildings[g.towers[0]].floors = 2;
      g.buildings[g.towers[1]].upgrade = 'nesting_grounds';
      giveHand(g, g.turn, CIVIC_CARDS);
    },
    shots: (g) => [
      { file: 'tv-civic-2p', caption: 'TV: the dragon, trade and monument cards, and each upgrade on a building', client: 'tv', waitMs: 4800 },
      { file: 'phone-civic-map-2p', caption: 'Phone: the map with them, choosing where to build a roost', client: 'phone', seat: g!.turn, clicks: ['[data-tab="more"]', '[data-basic="roost"]'] },
      { file: 'phone-civic-hand-2p', caption: 'Phone: a hand of the eight cards and the four upgrades (staged)', client: 'phone', seat: g!.turn },
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
        // It changes the room: the acting player accepts the offer made to them.
        file: 'phone-trade-accepted-4p', caption: 'Phone: the player you offered accepts', client: 'phone', seat: (g!.turn + 2) % 4,
        then: (room) => room.mutate((g2) => apply(g2, g2.turn, `accept ${g2.offers.find((o) => o.to === g2.turn)!.id}`)), waitFor: '.notices .toast',
      },
      {
        // Last: it changes the room. The offerer has spent what they offered, so Accept is off and says why.
        file: 'phone-trade-cant-accept-4p', caption: 'Phone: an offer the offerer can no longer pay (Accept is off, with the reason)', client: 'phone', seat: (g!.turn + 1) % 4,
        then: (room) => room.mutate((g2) => drain(g2, g2.turn)), waitFor: '.offer.in .blocked',
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
      { file: 'phone-card-open-windfall', caption: 'Phone: Windfall tapped open, choosing the resource to gain', client: 'phone', seat: g!.turn, clicks: [card(g!.players[g!.turn].hand.find((c) => c.key === 'windfall')!.id)] },
    ],
  },
  {
    name: 'vote-5p',
    players: 5,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      for (const p of g.players.keys()) arm(g, p, [2]);
      toVote(g);
      vote(g, byPower(g)[0], turnOrder(g).slice(0, 2));
    },
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
    until: (g) => g.round === 4 && g.phase === 'action',
    // One raider is in; the next seat has two dragons to choose from.
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === (t + 1) % 4 ? [2, 2] : [2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      sendAll(g, t);
    },
    shots: (g) => {
      const choosing = seatWhere(g!, (p) => !g!.raid!.ready[p] && seatState(g!, p).raidReady.length >= 2);
      return [
        { file: 'tv-raid-commit-4p', caption: 'TV, raid commitments (4 players)', client: 'tv' },
        { file: 'phone-raid-commit-4p', caption: 'Phone: committing dragons (one tapped)', client: 'phone', seat: choosing, clicks: ['[data-commit]'] },
        { file: 'phone-raid-dragon-4p', caption: 'Phone, raid: a dragon in the roost tapped open', client: 'phone', seat: choosing, clicks: ['.roost [data-dragon]'] },
      ];
    },
  },
  {
    name: 'bail-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Two raiders; one has chosen to fight.
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, [2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toBail(g, [t, (t + 1) % 3]);
      apply(g, t, 'fight');
    },
    shots: (g) => [
      { file: 'tv-raid-bail-3p', caption: 'TV, fight or bail (3 players): one has chosen', client: 'tv' },
      { file: 'phone-raid-bail-3p', caption: 'Phone: fight or bail, in secret', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.commits[p].length > 0 && !g!.raid!.choices[p]) },
    ],
  },
  {
    name: 'raid-result-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: wonRaid,
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-result-3p', caption: "TV: a raid's fight replayed, at the end: who won and what they took", client: 'tv', live: true, waitFor: '#overlay .outcome.show', waitMs: 400 }],
  },
  {
    // The same raid, caught mid-replay.
    name: 'raid-fight-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: wonRaid,
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-fight-3p', caption: "TV: a raid's fight mid-replay, health bars falling as the hits land", client: 'tv', live: true, waitMs: 2700 }],
  },
  {
    // The same raid, on a raider's phone while the TV replays it.
    name: 'raid-watch-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: wonRaid,
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'phone-raid-watch-3p', caption: 'Phone, while the TV replays a fight: everyone watches, and the next decision waits', client: 'phone', seat: 1, live: true, screen: true, waitMs: 600 }],
  },
  {
    // A fight one raider bailed out of: they're shown flown home beside it.
    name: 'raid-fled-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Three raiders: the first bails, the second fights, the third decides live.
    setup: (g) => {
      const [a, b, c] = turnOrder(g);
      for (const p of g.players.keys()) arm(g, p, [a, b, c].includes(p) ? [3, 3] : [0]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toBail(g, [a, b, c]);
      apply(g, a, 'bail');
      apply(g, b, 'fight');
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)), // the rest fought
    shots: () => [{ file: 'tv-raid-fled-4p', caption: 'TV: a fight mid-replay, with the raider who bailed flown home', client: 'tv', live: true, waitMs: 3300 }],
  },
  {
    name: 'discard-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => toDiscard(g, [g.turn]),
    shots: (g) => [
      { file: 'tv-discard-4p', caption: 'TV, end of round: someone is discarding', client: 'tv' },
      { file: 'phone-discard-4p', caption: 'Phone: over the hand limit, one card picked', client: 'phone', seat: waitingOn(g!)[0], clicks: ['.handfan [data-card]'], sizes: true },
      { file: 'phone-discard-waiting-4p', caption: 'Phone: under the limit, waiting for the others to discard', client: 'phone', seat: seatWhere(g!, (p) => !waitingOn(g!).includes(p)) },
    ],
  },
  {
    name: 'production-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => {
      everyoneRolls(g);
      toDiscard(g, [0]);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: allRolled,
    shots: () => [{ file: 'tv-production-4p', caption: "TV: a new round opens with everyone's production roll, the dice still tumbling", client: 'tv', live: true, waitFor: '#overlay .production li.up:nth-child(3)', hold: true }],
  },
  {
    name: 'production-done-6p',
    players: 6,
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    setup: (g) => {
      everyoneRolls(g);
      toDiscard(g, [0]);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: allRolled,
    shots: () => [{ file: 'tv-production-done-6p', caption: "TV: every player's production roll has landed (6 players)", client: 'tv', live: true, waitFor: '#overlay .production li.up:last-child:not(:has(.rolling))', hold: true }],
  },
  {
    name: 'late-6p',
    players: 6,
    seed: 1,
    until: late(6, 1),
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
    until: late(2, 1),
    shots: () => [
      { file: 'tv-late-2p', caption: 'TV, late game (2 players)', client: 'tv' },
      { file: 'tv-flight-2p', caption: "TV: a dragon's flight round its home", client: 'tv', flight: true, frames: [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95] },
      // Taking off and landing, a fiftieth of a flight (0.2 s) apart: it turns and spreads its wings over a few frames.
      { file: 'tv-takeoff-2p', caption: 'TV: a dragon takes off, easing into flight', client: 'tv', flight: true, frames: [-0.02, 0, 0.02, 0.04, 0.06, 0.08] },
      { file: 'tv-landing-2p', caption: 'TV: a dragon lands, folding its wings', client: 'tv', flight: true, frames: [0.96, 0.98, 1, 1.02, 1.04, 1.06, 1.1] },
    ],
  },
  {
    name: 'late-5p',
    players: 5,
    seed: 1,
    until: late(5, 1),
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
      { file: 'phone-resume-open', caption: "Phone: the room's address for a resumed game: take an open seat with a name", client: 'phone', waitFor: '.seats' },
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
    until: (g) => g.round === 3 && g.phase === 'action',
    // A hatchling to grow, a hurt young dragon to heal, and a basic building
    // without an upgrade, beside the land a monument can go on.
    setup: (g) => {
      const t = g.turn;
      arm(g, t, [1, 2]);
      g.dragons.filter((d) => d.owner === t)[1].damage = 3;
      if (!upgradeTargets(g, t, 'workshop').length) {
        const [type, k] = ['pasture', 'quarry', 'lumber_camp', 'crystal_mine'].map((b) => [b, buildableHexes(g, t, b).sort()[0]]).find(([, k]) => k)!;
        g.buildings[k] = { type, owner: t, upgrade: null, floors: 0 };
      }
      giveHand(g, t, PLAYABLE);
      for (const r of Object.keys(g.players[t].resources)) g.players[t].resources[r as 'gold'] = 20;
      const stuck = seatState(g, t).hand.filter((c) => c.blocked && c.needs !== 'unplayable');
      if (stuck.length) throw new Error(`hand-3p: ${stuck.map((c) => c.key).join(', ')} can't be played`);
    },
    shots: (g) => {
      const id = (key: string) => `c${900 + PLAYABLE.indexOf(key)}`;
      const me = { client: 'phone' as const, seat: g!.turn };
      return [
        { ...me, file: 'phone-hand-3p', caption: 'Phone: a hand of playable cards (staged)' },
        { ...me, file: 'phone-hand-slide', caption: 'Phone: a thumb on the hand, the card under it raised to read', press: { on: card(id('healing_potion')), dx: 15 } },
        { ...me, file: 'phone-hand-pull', caption: 'Phone: a card dragged up out of the hand: letting go plays it', press: { on: card(id('monument')), dy: -160 } },
        { ...me, file: 'phone-zoom-hoard', caption: 'Phone: Secret Hoard tapped open (kept, not played)', clicks: [card(id('secret_hoard'))] },
        { ...me, file: 'phone-zoom-elixir', caption: 'Phone: Growth Elixir, choosing the dragon', clicks: [card(id('growth_elixir'))] },
        { ...me, file: 'phone-zoom-potion', caption: 'Phone: Healing Potion, choosing the hurt dragon', clicks: [card(id('healing_potion'))] },
        { ...me, file: 'phone-zoom-dragon', caption: 'Phone: a dragon in the roost tapped open (its card, its stage marked)', clicks: ['.roost [data-dragon]'] },
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
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    // Every building the acting player has takes an upgrade, their dragons are
    // unhurt adults with no room for more, one building card has no hex of its
    // terrain left, and they have nothing to pay with.
    setup: (g) => {
      const t = g.turn;
      for (const [k, b] of Object.entries(g.buildings)) {
        if (b.owner !== t || b.upgrade) continue;
        const u = Object.keys(UPGRADES).find((u) => upgradeTargets(g, t, u).includes(k));
        if (u) b.upgrade = u;
      }
      arm(g, t, []);
      arm(g, t, Array(dragonCapacity(g, t)).fill(3));
      const terrain = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].terrain && BUILDINGS[k].terrain !== 'plains').sort((a, b) => buildableHexes(g, t, a).length - buildableHexes(g, t, b).length)[0];
      for (const k of buildableHexes(g, t, terrain)) g.map[k].terrain = 'plains';
      drain(g, t);
      giveHand(g, t, ALL_CARDS);
      if (blockedReasons(g, t).length < 6) throw new Error(`blocked-3p: only ${blockedReasons(g, t).length} reasons`);
    },
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
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => toDiscard(g, [g.turn], 3),
    shots: (g) => [
      { file: 'phone-discard-many', caption: 'Phone: discarding several cards, two picked', client: 'phone', seat: seatWhere(g!, (p) => g!.players[p].hand.length - seatState(g!, p).handCap >= 2), clicks: ['.handfan [data-card]', '.handfan [data-card]:not(.picked)'] },
      { file: 'phone-discard-slide', caption: 'Phone: discarding, a thumb sliding along the hand raises the card under it to read', client: 'phone', seat: seatWhere(g!, (p) => g!.players[p].hand.length - seatState(g!, p).handCap >= 2), clicks: ['.handfan [data-card]'], press: { on: '.handfan [data-card]:nth-child(4)', dx: 40 }, sizes: true },
    ],
  },

  // ---------- the raid, more ways ----------
  {
    name: 'horn-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const pl = g.players[g.turn];
      for (const p of g.players.keys()) arm(g, p, [2]);
      pl.hand.push({ id: 'c899', deck: 'action', key: 'war_horn' });
      pl.resources.crystal = Math.max(pl.resources.crystal, ACTIONS.war_horn.cost.crystal ?? 0);
      apply(g, g.turn, 'play c899');
      toVote(g);
    },
    shots: () => [{ file: 'tv-two-raids-4p', caption: 'TV: a round with two raids (War Horn), the first vote', client: 'tv' }],
  },
  {
    name: 'commit-5p',
    players: 5,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // The acting player is in; the next has a dragon and hasn't chosen; the rest have only eggs.
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === t || p === (t + 1) % 5 ? [2] : [0]);
      toVote(g);
      vote(g, byPower(g)[0]);
      sendAll(g, t);
    },
    shots: (g) => {
      const r = g!.raid!, ready = (p: number) => seatState(g!, p).raidReady.length;
      return [
        { file: 'phone-raid-locked-5p', caption: 'Phone, raid: locked in', client: 'phone', seat: seatWhere(g!, (p) => r.ready[p] && r.commits[p].length > 0) },
        { file: 'phone-raid-stay-home-5p', caption: 'Phone, raid: nothing committed yet (Send greyed, Stay home beside it)', client: 'phone', seat: seatWhere(g!, (p) => !r.ready[p] && !r.commits[p].length && ready(p) > 0), sizes: true },
        { file: 'phone-raid-no-dragons-5p', caption: 'Phone, raid: no dragon able to raid', client: 'phone', seat: seatWhere(g!, (p) => !ready(p)) },
      ];
    },
  },
  {
    name: 'bail-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === t || p === (t + 1) % 4 ? [2] : [0]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toBail(g, [t, (t + 1) % 4]);
      apply(g, t, 'fight');
    },
    shots: (g) => [
      { file: 'phone-raid-not-in-4p', caption: "Phone, fight or bail: you're not in this raid", client: 'phone', seat: seatWhere(g!, (p) => !g!.raid!.commits[p].length) },
      { file: 'phone-raid-chose-4p', caption: 'Phone, fight or bail: already chosen', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.commits[p].length > 0 && !!g!.raid!.choices[p]) },
    ],
  },
  {
    name: 'raid-lost-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Two hatchlings against the strongest kingdom; one has chosen to fight.
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === t || p === (t + 1) % 3 ? [1] : [0]);
      toVote(g);
      vote(g, byPower(g).at(-1)!);
      toBail(g, [t, (t + 1) % 3]);
      apply(g, (t + 1) % 3, 'fight');
    },
    live: bots(raidOver),
    liveEnd: (g) => /holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-lost-3p', caption: 'TV: a lost raid, at the end of the replay ("… holds")', client: 'tv', live: true, waitFor: '#overlay .outcome.show', waitMs: 400 }],
  },
  {
    name: 'raid-bailed-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Both send a dragon; the first bails, and the second bails live.
    setup: (g) => {
      for (const p of [0, 1]) arm(g, p, [1]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toBail(g, [0, 1]);
      apply(g, 0, 'bail');
    },
    live: (g) => apply(g, 1, 'bail'),
    liveEnd: (g) => /Everyone bails/.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-bailed-2p', caption: 'TV: everyone bailed (2 players)', client: 'tv', live: true, waitFor: '#overlay.banner', waitMs: 400 }],
  },
  {
    name: 'raid-nobody-3p',
    players: 3,
    seed: 1,
    // Everyone starts with an egg, so round 1 has no raid: it ends on the last player's turn.
    until: (g) => g.round === 1 && g.phase === 'action' && g.turn === turnOrder(g).at(-1),
    setup: (g) => g.dragons.forEach((d) => (d.stage = 0)),
    live: (g) => pass(g, (x) => x.round > 1),
    liveEnd: (g) => /no raid this round/.test(raidOutcome(g)),
    // The TV opens on round 1's own banner, then round 2's; with no raid to show in between, that's all.
    shots: () => [{ file: 'tv-raid-nobody-3p', caption: "TV: no one had a raid-ready dragon, so round 1 has no raid scene: a moment later round 2 is on to keeping cards", client: 'tv', live: true, waitMs: 3200 }],
  },
  {
    // The round's last raid is fought, then the next round opens: two banners back to back.
    name: 'banners-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === t || p === (t + 1) % 3 ? [3] : [0]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toBail(g, [t, (t + 1) % 3]);
      apply(g, (t + 1) % 3, 'fight');
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)),
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
  {
    // A message near the 300-character limit (#133): the TV feed keeps who
    // said it and ends it in "…", rather than cutting off its top.
    name: 'talk-long-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      apply(g, (g.turn + 1) % 3, `say ${'I really need crystal for the dragon. '.repeat(7).trim()}`);
    },
    shots: () => [{ file: 'tv-talk-long-3p', caption: 'TV: a message near the length limit, cut short at its end', client: 'tv', sizes: true }],
  },
  {
    // Aggressive fauna (#66): beasts on the starting map, a cave bear sent onto
    // another player's building, a wolf pack beside the acting player's tower.
    // The acting player holds both fauna cards and has a young dragon to send.
    name: 'fauna-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const p = g.turn;
      if (!Object.values(g.buildings).some((b) => b.owner !== p && b.type !== 'tower')) buildingsAtLeast(g, Object.keys(g.buildings).length - g.towers.length + 1, [(p + 1) % 3]);
      const theirs = Object.keys(g.buildings).find((k) => g.buildings[k].owner !== p && g.buildings[k].type !== 'tower')!;
      g.map[theirs].fauna = 'cave_bear';
      const open = neighbors(g.towers[p]).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
      g.map[open].fauna = 'wolf_pack';
      readyDragons(g, p);
      giveHand(g, p, ['wolf_call', 'rouse_bear', 'windfall']);
      Object.keys(g.players[p].resources).forEach((r) => (g.players[p].resources[r as 'gold'] = 6));
    },
    shots: (g) => [
      { file: 'tv-fauna-3p', caption: 'TV: fauna on the board: wolves by a tower, a bear on a building, beasts out in the wilds', client: 'tv', waitMs: 4800 },
      {
        // The wolf pack wanders to the next open hex: it turns, trots over, and turns back.
        file: 'tv-fauna-wander-3p', caption: 'TV: the wolf pack wanders to the next hex, walking over', client: 'tv',
        then: (room) => room.mutate((g2) => {
          const k = Object.keys(g2.map).find((x) => g2.map[x].fauna === 'wolf_pack')!;
          const n = neighbors(k).find((x) => g2.map[x] && g2.map[x].terrain !== 'ocean' && !g2.map[x].fauna && !g2.buildings[x])!;
          g2.map[n].fauna = 'wolf_pack';
          delete g2.map[k].fauna;
        }),
        waitMs: 1500, // the board has the move before its clock starts
        frames: [0, 0.4, 0.9, 1.5, 2.1, 2.9, 4],
      },
      {
        // The wolf pack is cleared: it folds down flat, and the hex's scenery grows back round where it stood.
        file: 'tv-fauna-leave-3p', caption: 'TV: the wolf pack is cleared, folding down, and the hex grows back', client: 'tv',
        then: (room) => room.mutate((g2) => {
          delete g2.map[Object.keys(g2.map).find((x) => g2.map[x].fauna === 'wolf_pack')!].fauna;
        }),
        waitMs: 1500,
        frames: [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1.1],
      },
      {
        // A dragon grows a stage: the same dragon, growing to its new size.
        file: 'tv-dragon-grow-3p', caption: 'TV: a dragon grows a stage', client: 'tv',
        then: (room) => room.mutate((g2) => {
          const d = g2.dragons.find((x) => x.owner === g2.turn && x.stage > 0 && x.stage < 3)!;
          d.stage++;
        }),
        waitMs: 1500,
        frames: [0, 0.2, 0.4, 0.6, 0.9],
      },
      { file: 'phone-fauna-turn-3p', caption: 'Phone: your turn, with fauna to clear', client: 'phone', seat: g!.turn },
      { file: 'phone-fauna-pick-3p', caption: 'Phone: choosing which beast to clear', client: 'phone', seat: g!.turn, clicks: ['#hunt'] },
      { file: 'phone-fauna-send-3p', caption: 'Phone: choosing dragons to send against it', client: 'phone', seat: g!.turn, clicks: ['#hunt', '[data-hex]', '[data-hunter]'] },
      { file: 'phone-fauna-card-3p', caption: 'Phone: a fauna card opened', client: 'phone', seat: g!.turn, clicks: [card('c901')] },
      { file: 'phone-fauna-where-3p', caption: 'Phone: choosing where to send the Cave Bear', client: 'phone', seat: g!.turn, clicks: [card('c901'), '[data-pickhex]'] },
    ],
  },
  {
    // Great beasts (#67): the Thunderbird on the centre peak and the Leviathan
    // off a harbor, each with the hexes it holds marked. The acting player
    // has three adult ice dragons, the Thunderbird's weakness, and sends them.
    name: 'beasts-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => beastHunters(g),
    shots: (g) => [
      { file: 'tv-beasts-3p', caption: 'TV: the Thunderbird on its peak and the Leviathan off its harbor, the hexes they hold ringed', client: 'tv', waitMs: 4800 },
      { file: 'phone-beast-pick-3p', caption: 'Phone: choosing which beast to fight, great beasts included', client: 'phone', seat: g!.turn, clicks: ['#hunt'] },
      { file: 'phone-beast-send-3p', caption: 'Phone: sending dragons against the Thunderbird', client: 'phone', seat: g!.turn, clicks: ['#hunt', `[data-hex="${PEAK}"]`, '[data-hunter]'] },
      // Last: the fight changes the game.
      { file: 'tv-beast-fight-3p', caption: 'TV: a fight against the Thunderbird mid-replay', client: 'tv', waitMs: 2400, then: (room) => room.mutate((g2) => huntPeak(g2)) },
    ],
  },
  {
    // The same fight, at its end.
    name: 'beasts-slain-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => beastHunters(g),
    shots: () => [{ file: 'tv-beast-slain-3p', caption: 'TV: the Thunderbird slain: +2 points for good', client: 'tv', waitMs: 4800, then: (room) => room.mutate((g2) => huntPeak(g2)) }],
  },
  {
    // After the Thunderbird falls: the peak is free and its ring is rich
    // ground; one player has built there, and holds the beast's trophy.
    name: 'peak-free-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      beastHunters(g);
      huntPeak(g);
      const ring = neighbors(PEAK).find((k) => !g.buildings[k])!;
      g.map[ring].terrain = 'meadow';
      g.buildings[ring] = { type: 'pasture', owner: g.turn, upgrade: null, floors: 0 };
    },
    shots: () => [{ file: 'tv-peak-free-3p', caption: 'TV: the Thunderbird slain, its peak free and the ground round it rich (gold)', client: 'tv', waitMs: 4800 }],
  },
  {
    // Clearing ordinary fauna (#96): a Cave Bear beside the acting player's
    // tower and two hatchlings sent against it, lightning (its weakness)
    // and fire. The TV replays the fight as it does a great beast's.
    name: 'fauna-fight-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => bearHunters(g),
    shots: () => [{ file: 'tv-fauna-fight-3p', caption: 'TV: two hatchlings against a Cave Bear, mid-replay', client: 'tv', waitMs: 1400, then: (room) => room.mutate((g2) => huntBear(g2)) }],
  },
  {
    // The same fight, at its end: what the player got for it.
    name: 'fauna-cleared-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => bearHunters(g),
    shots: () => [{ file: 'tv-fauna-cleared-3p', caption: 'TV: the Cave Bear falls: +4 livestock', client: 'tv', waitMs: 4800, then: (room) => room.mutate((g2) => huntBear(g2)) }],
  },
  {
    // Fauna on every terrain and on buildings (#72): a wolf pack, a cave bear
    // and a basilisk on open hexes of each land terrain, and one of each on a
    // building it shuts down. The acting player has dragons to send.
    name: 'fauna-terrain-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const p = g.turn;
      buildingsAtLeast(g, 3);
      // The great beasts stay where they are: the TV lists them as alive.
      for (const h of Object.values(g.map)) if (h.fauna && !BEASTS[h.fauna]) delete h.fauna;
      const kinds = ['wolf_pack', 'cave_bear', 'basilisk'];
      Object.keys(g.buildings).filter((k) => g.buildings[k].type !== 'tower').slice(0, 3).forEach((k, i) => (g.map[k].fauna = kinds[i]));
      for (const t of ['mountain', 'forest', 'ley', 'meadow', 'plains', 'harbor']) {
        const open = Object.keys(g.map).filter((k) => g.map[k].terrain === t && !g.buildings[k] && !g.map[k].fauna);
        open.slice(0, 3).forEach((k, i) => (g.map[k].fauna = kinds[i]));
      }
      readyDragons(g, p);
    },
    shots: (g) => {
      const kinds = ['wolf_pack', 'cave_bear', 'basilisk'];
      const hexOf = (kind: string, built: boolean) => Object.keys(g!.map).find((k) => g!.map[k].fauna === kind && !!g!.buildings[k] === built)!;
      const send = (kind: string, built: boolean) => ({
        file: `phone-fauna-send-${kind.replace('_', '-')}${built ? '-built' : ''}-3p`,
        caption: `Phone: sending dragons against a ${kind.replace('_', ' ')}${built ? ' on a building' : ''}`,
        client: 'phone' as const, seat: g!.turn, clicks: ['#hunt', `[data-hex="${hexOf(kind, built)}"]`, '[data-hunter]'],
      });
      return [
        { file: 'tv-fauna-terrain-3p', caption: 'TV: each beast on each terrain, and one of each shutting down a building', client: 'tv', waitMs: 4800 },
        { file: 'phone-fauna-terrain-pick-3p', caption: 'Phone: choosing which beast to clear, every beast on the map', client: 'phone', seat: g!.turn, clicks: ['#hunt'] },
        ...kinds.flatMap((k) => [send(k, false), send(k, true)]),
      ];
    },
  },
  // ---------- away, quitting, taking a seat back (last, so the scenes above keep their room codes) ----------
  {
    // A player who's away, one who quits, and taking a seat back. Each shot
    // changes the room, in this order.
    name: 'away-3p',
    players: 3,
    seed: 1,
    away: [1],
    until: (g) => g.round === 2 && g.phase === 'action' && g.turn === 1,
    shots: () => [
      { file: 'phone-away-3p', caption: 'Phone: the table waits on someone whose phone is gone: let a bot play for them', client: 'phone', seat: 0, sizes: true },
      { file: 'tv-standin-3p', caption: 'TV: a phone let a bot play for someone away', client: 'tv', then: (room) => room.standInFor(room.seats[0].token, 1) },
      { file: 'phone-menu-3p', caption: 'Phone: the menu under your name, with Quit game', client: 'phone', seat: 2, clicks: ['#menu'], sizes: true },
      { file: 'phone-quit-3p', caption: 'Phone: after tapping Quit game: take a seat back from here', client: 'phone', seat: 2, clicks: ['#menu', '#quit'], waitFor: '.seats' },
      { file: 'tv-quit-3p', caption: 'TV: someone quits; a bot plays for them', client: 'tv', then: (room) => room.quit(room.seats[0].token) },
      { file: 'phone-join-seats-3p', caption: "Phone: the room's address mid-game: tap your name to take your seat back", client: 'phone', waitFor: '.seats', sizes: true },
      { file: 'phone-seat-back-3p', caption: 'Phone: a seat taken back (by tapping its name)', client: 'phone', clicks: ['[data-seat]'], waitFor: '.mehead' },
      { file: 'tv-back-3p', caption: 'TV: a player a bot was playing for is back', client: 'tv', then: (room) => { room.join('Bram'); } },
    ],
  },
  // ---------- a game with no TV (remote mode) ----------
  {
    name: 'remote-lobby',
    players: 2,
    seed: 1,
    lobby: { bots: 1 },
    remote: true,
    shots: () => [
      { file: 'phone-remote-lobby-host', caption: 'No TV: the lobby on the phone that made the game, with the code to join by', client: 'phone', seat: 0, sizes: true },
    ],
  },
  {
    name: 'remote-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: canBuild,
    shots: (g) => [
      { file: 'phone-remote-you-3p', caption: 'No TV: your own view, with the You / Table switch by the talk bar', client: 'phone', seat: g!.turn, sizes: true },
      { file: 'phone-remote-table-3p', caption: 'No TV: the table view, switched to', client: 'phone', seat: g!.turn, clicks: ['.viewswitch [data-view=table]'], waitFor: '.table-on', waitMs: 600, sizes: true },
      { file: 'tv-remote-table-3p', caption: 'No TV: the table view on its own (the whole page, scrolled)', client: 'tv', table: true, sizes: true },
      { file: 'phone-remote-talk-3p', caption: 'No TV: the talk sheet open over the table view', client: 'phone', seat: g!.turn, clicks: ['.viewswitch [data-view=table]', '.talkbar .latest'], waitMs: 600 },
    ],
  },
  {
    name: 'remote-late-6p',
    players: 6,
    seed: 1,
    remote: true,
    until: late(6, 1),
    shots: () => [{ file: 'tv-remote-table-late-6p', caption: 'No TV: the table view late in a 6-player game', client: 'tv', table: true, sizes: true }],
  },
  {
    name: 'remote-vote-5p',
    players: 5,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      for (const p of g.players.keys()) arm(g, p, [2]);
      toVote(g);
    },
    shots: (g) => [
      { file: 'phone-remote-vote-5p', caption: 'No TV: your vote, on your own view', client: 'phone', seat: waitingOn(g!)[0] },
      { file: 'tv-remote-vote-5p', caption: 'No TV: the vote on the table view', client: 'tv', table: true, sizes: true },
    ],
  },
  {
    name: 'remote-commit-4p',
    players: 4,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      for (const p of g.players.keys()) arm(g, p, [2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      sendAll(g, g.turn);
    },
    shots: () => [{ file: 'tv-remote-commit-4p', caption: 'No TV: commitments on the table view', client: 'tv', table: true, sizes: true }],
  },
  {
    name: 'remote-production-4p',
    players: 4,
    seed: 1,
    remote: true,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => {
      everyoneRolls(g);
      toDiscard(g, [0]);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: allRolled,
    shots: (g) => [{ file: 'phone-remote-production-4p', caption: "No TV: the round's production rolls cut in on the phone", client: 'phone', seat: 0, live: true, waitFor: '.table-on', waitMs: 1800 }],
  },
  {
    name: 'remote-production-done-6p',
    players: 6,
    seed: 1,
    remote: true,
    until: (g) => g.round === 4 && g.phase === 'action',
    setup: (g) => {
      everyoneRolls(g);
      toDiscard(g, [0]);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: allRolled,
    shots: () => [{ file: 'tv-remote-production-done-6p', caption: "No TV: every production roll landed (6 players), on the table view", client: 'tv', table: true, live: true, waitFor: '#overlay .production li.up:last-child:not(:has(.rolling))', hold: true }],
  },
  {
    name: 'remote-fight-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: wonRaid,
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'phone-remote-fight-3p', caption: "No TV: a raid's fight cuts in on the phone, mid-replay", client: 'phone', seat: 1, live: true, waitFor: '.table-on', waitMs: 2200 }],
  },
  {
    name: 'remote-fight-end-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: wonRaid,
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-remote-fight-end-3p', caption: "No TV: a raid's fight at its end, on the table view", client: 'tv', table: true, live: true, waitFor: '#overlay .outcome.show', waitMs: 400 }],
  },
  {
    name: 'remote-beast-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => beastHunters(g),
    shots: (g) => [
      { file: 'phone-remote-beast-3p', caption: 'No TV: a fight against the Thunderbird cuts in on another player\'s phone', client: 'phone', seat: (g!.turn + 1) % 3, waitFor: '.table-on', waitMs: 2400, then: (room) => room.mutate((g2) => huntPeak(g2)) },
    ],
  },
  {
    name: 'remote-beast-end-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => beastHunters(g),
    shots: () => [{ file: 'tv-remote-beast-end-3p', caption: 'No TV: the Thunderbird slain, on the table view', client: 'tv', table: true, waitMs: 4800, then: (room) => room.mutate((g2) => huntPeak(g2)) }],
  },
  {
    name: 'remote-over-4p',
    players: 4,
    seed: 1,
    remote: true,
    until: (g) => g.phase === 'over',
    shots: (g) => [
      { file: 'phone-remote-over-4p', caption: 'No TV: the end, on your own view', client: 'phone', seat: g!.winner! },
      { file: 'tv-remote-over-4p', caption: 'No TV: the final scores on the table view', client: 'tv', table: true, sizes: true },
    ],
  },
];

// A raid sure to be won, one decision from its end: the first two in turn
// order send two adults each against the weakest kingdom, and the second has
// chosen to fight; the first decides live.
function wonRaid(g: Game) {
  const [a, b] = turnOrder(g);
  for (const p of g.players.keys()) arm(g, p, p === a || p === b ? [3, 3] : [0]);
  toVote(g);
  vote(g, byPower(g)[0]);
  toBail(g, [a, b]);
  apply(g, b, 'fight');
}

// The acting player gets three ready adult ice dragons (the Thunderbird's weakness).
// Player p's dragons, at least young and raid-ready, with this round's lines
// about them sitting out taken off the log so the feed doesn't contradict them.
function readyDragons(g: Game, p: number) {
  const mine = new Set(g.dragons.filter((x) => x.owner === p).map((d) => d.id));
  for (const d of g.dragons.filter((x) => x.owner === p)) Object.assign(d, { stage: Math.max(d.stage, 2), resting: '', damage: 0 });
  g.log = g.log.filter((e) => !(e.ev?.k === 'rest' && mine.has(e.ev.d)));
}

function beastHunters(g: Game) {
  const p = g.turn;
  g.dragons = g.dragons.filter((d) => d.owner !== p);
  for (const key of ['frost_wyrm', 'rime_drake', 'ice_whelp']) g.dragons.push({ id: `d${g.nextId++}`, owner: p, key, stage: 3, growth: 0, damage: 0, resting: '' });
}

// The acting player sends every ready dragon against the Thunderbird.
function huntPeak(g: Game) {
  const ids = g.dragons.filter((d) => d.owner === g.turn && d.stage > 0 && !d.resting && !d.damage).map((d) => d.id);
  apply(g, g.turn, `clear ${PEAK} ${ids.join(' ')}`);
}

// A Cave Bear on an open hex beside the acting player's tower, and two
// dragons of theirs (hatchlings), lightning and fire, ready to send.
function bearHunters(g: Game) {
  const p = g.turn;
  const open = neighbors(g.towers[p]).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k] && !g.map[k].fauna)!;
  g.map[open].fauna = 'cave_bear';
  g.dragons = g.dragons.filter((d) => d.owner !== p);
  for (const key of ['storm_wyrm', 'cinder_drake']) g.dragons.push({ id: `d${g.nextId++}`, owner: p, key, stage: 1, growth: 0, damage: 0, resting: '' });
}

// The acting player sends every ready dragon against the Cave Bear.
function huntBear(g: Game) {
  const k = Object.keys(g.map).find((x) => g.map[x].fauna === 'cave_bear' && neighbors(g.towers[g.turn]).includes(x))!;
  const ids = g.dragons.filter((d) => d.owner === g.turn && d.stage > 0 && !d.resting && !d.damage).map((d) => d.id);
  apply(g, g.turn, `clear ${k} ${ids.join(' ')}`);
}
