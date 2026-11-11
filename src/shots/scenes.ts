// Staged game situations for screenshots (src/shots/shots.ts). A scene opens
// with a seeded bot game played to a point every game reaches (a round, a
// phase, the round before the end), then stages what its shots are about:
// the hand, the dragons, the buildings, the raid's votes and choices. Nothing
// searches for a lucky game, so a tuning change can't make a scene fail to
// stage unless it takes away what the scene shows.

import { botStep, standInMove } from '../bot.ts';
import { ACTIONS, BEASTS, BUILDINGS, DRAGONS, TUNING, UPGRADES, targetPower } from '../data.ts';
import { apply, buildableHexes, canRaid, dragonCapacity, newGame, score, stageStats, standings, turnOrder, upgradeTargets, waitingOn, type Dragon, type Game } from '../engine.ts';
import { PEAK, distance, leviathanWaters, nearBeast, neighbors, parseKey } from '../map.ts';
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
  path?: string | ((room: Room) => string); // a phone that hasn't joined: the address it opens (default: the room's, /CODE); TV: opens this instead of the room (/tv makes a new room)
  remember?: string; // a phone that hasn't joined: the name it remembers from an earlier game
  fill?: { code?: string; name?: string }; // the join form: typed in, then Join tapped
  guest?: boolean; // TV: a second screen opened on the room's address, without the room's host token
  tailscale?: boolean; // TV: the machine also has a Tailscale address
  loading?: boolean; // shot before the page's script runs (what a slow connection shows)
  then?: (room: Room) => void; // something that happens at the table after the page is up (before the clicks)
  offline?: boolean; // the connection to the server drops after the page is up
  clicks?: string[]; // CSS selectors tapped in order before the shot (the first match each time)
  run?: string; // a script run in the page after the clicks (e.g. the TV's summaryAt)
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
  saved?: boolean; // someone at the table saved the game, an hour and a half ago
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

// The TV's summary at the end of a game, played from step n (from the end if
// negative), once the TV has the recap.
const summaryAt = (n: number) => `new Promise((done) => {
  const go = () => document.querySelector('.endbox #replay') ? done(window.summaryAt(${n})) : setTimeout(go, 30);
  go();
})`;

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
  // Staged scenes keep the first seat first in round 1, so each shot stays as it was.
  const g = newGame(scene.players, scene.seed, 0);
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
// keep the first card, vote for the first target, hold back), made
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
// Seats in `who` vote for target t (all who haven't voted and have a vote, by default).
function vote(g: Game, t: string, who = g.players.map((_, p) => p)) {
  for (const p of who) if (g.raid?.step === 'vote' && waitingOn(g).includes(p)) apply(g, p, `vote ${g.raid.candidates.indexOf(t) + 1}`);
}
// The vote over, the raid is at fight or hold back: every raid-ready dragon is in.
function toChoice(g: Game) {
  if (g.raid?.step !== 'choose') throw new Error('toChoice: the raid is not at fight or hold back');
}
const ready = (d: Dragon) => canRaid(d) && !d.damage;

// Seat p's dragons, replaced by one fresh dragon at each stage given (0 an egg,
// 3 an adult), each ready to raid; roosts are built beside their land until
// they fit.
function arm(g: Game, p: number, stages: number[]) {
  g.dragons = g.dragons.filter((d) => d.owner !== p);
  while (dragonCapacity(g, p) < stages.length) {
    const k = buildableHexes(g, p, 'roost').sort()[0];
    if (!k) throw new Error(`arm: no room for a roost for P${p + 1}`);
    g.buildings[k] = { type: 'roost', owner: p, upgrades: [], floors: 0 };
  }
  const keys = Object.keys(DRAGONS);
  stages.forEach((stage, i) => g.dragons.push({ id: `d${g.nextId++}`, owner: p, key: keys[(p + i) % keys.length], stage, growth: 0, damage: 0 }));
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
    g.buildings[k] = { type: keys[i % keys.length], owner: p, upgrades: [], floors: 0 };
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
      const g = newGame(players, seed, 0);
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
    if (k) g.buildings[k] = { type: 'roost', owner: p, upgrades: [], floors: 0 };
  }
}

// Seat p reaches the points to win (shown, not hidden): their buildings worth
// the most points, placed where they can go, then, once there's no room,
// points from kingdoms taken, until they do.
function pointsToWin(g: Game, p: number) {
  const worth = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].points && !BUILDINGS[k].onTower).sort((a, b) => BUILDINGS[b].points! - BUILDINGS[a].points! || (a < b ? -1 : 1));
  for (let i = 0; score(g, p).public < TUNING.pointsToWin; i++) {
    const at = worth.flatMap((type) => buildableHexes(g, p, type).sort().slice(0, 1).map((k) => ({ type, k })))[0];
    if (i > 50) throw new Error('pointsToWin: no room');
    if (at) g.buildings[at.k] = { type: at.type, owner: p, upgrades: [], floors: 0 };
    else g.raidPoints[p] += TUNING.pointsToWin - score(g, p).public;
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
    const reason = c.blocked?.replace(/No empty [\w ]+ is adjacent/, 'No empty hex is adjacent');
    if (reason && !seen.has(reason)) seen.set(reason, { id: c.id, key: c.key });
  }
  return [...seen.values()];
}
// How the last raid ended, as the log says it.
const raidOutcome = (g: Game) => g.log.findLast((e) => /falls\.|holds\.|Everyone holds back|No one raids|no raid this round/.test(e.text))?.text ?? '';
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
const CIVIC_CARDS = ['hatchery', 'stone_port', 'market', 'tower_floor', 'monument', 'standing_stones', 'lighthouse', 'guildhall', 'workshop', 'nesting_grounds'];

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
      { file: 'tv-guest-lobby', caption: "TV: a second screen on the room's address (no host token): no buttons for the room, it says who starts", client: 'tv', guest: true },
    ],
  },
  {
    name: 'opening-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 1 && g.phase === 'action',
    shots: (g) => [
      { file: 'tv-opening-production-2p', caption: "TV, round 1 (2 players): production, the first player's tower only (no dice to roll yet)", client: 'tv', waitFor: '#overlay .production .pturn.on .ptotal.up', hold: true, waitMs: 500 },
      { file: 'phone-opening-hand-2p', caption: 'Phone, round 1: the first hand, on your turn', client: 'phone', seat: g!.turn, sizes: true },
      { file: 'phone-end-confirm-2p', caption: 'Phone: End turn tapped, waiting for its confirm', client: 'phone', seat: g!.turn, clicks: ['#end'] },
      { file: 'phone-opening-waiting-2p', caption: "Phone, round 1: someone else's turn", client: 'phone', seat: (g!.turn + 1) % 2 },
      { file: 'phone-reconnecting', caption: 'Phone: the connection to the server dropped', client: 'phone', seat: g!.turn, offline: true },
    ],
  },
  {
    name: 'early-5p',
    players: 5,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    shots: () => [{ file: 'tv-early-5p', caption: 'TV, early game (5 players, round 2): where the five towers stand', client: 'tv' }],
  },
  {
    name: 'early-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: canBuild,
    shots: (g) => [
      { file: 'tv-early-3p', caption: 'TV, early game (3 players, round 2)', client: 'tv', sizes: true },
      { file: 'tv-pointing-3p', caption: 'TV, in a game: the mouse moves, and Full screen and Save game show in the corner', client: 'tv', run: "dispatchEvent(new PointerEvent('pointermove'))", waitFor: 'body.pointing #fullscreen', hold: true },
      { file: 'phone-card-open-3p', caption: 'Phone: a building card tapped open', client: 'phone', seat: g!.turn, clicks: ['.card.k-building[data-card]:not(.dim)'], sizes: true },
      { file: 'phone-build-pick-3p', caption: 'Phone: choosing where to build', client: 'phone', seat: g!.turn, clicks: ['.card.k-building[data-card]:not(.dim)', '[data-pickhex]'], sizes: true },
      { file: 'phone-build-3p', caption: 'Phone: basic buildings and the egg project', client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]'], sizes: true },
      { file: 'phone-trade-bank-3p', caption: 'Phone: the trade tab on your turn: an offer to a player, and the merchants', client: 'phone', seat: g!.turn, clicks: ['[data-tab=trade]'], sizes: true },
      { file: 'phone-hand-raised-3p', caption: "Phone: the tucked hand tapped on someone else's turn, raised to look at", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-raisehand]'] },
      { file: 'phone-card-out-of-turn-3p', caption: "Phone: a card tapped open on someone else's turn", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-raisehand]', '[data-card]'] },
      { file: 'phone-trade-out-of-turn-3p', caption: "Phone: the trade tab on someone else's turn (only the acting player can be offered)", client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['[data-tab=trade]'] },
      { file: 'phone-table-3p', caption: 'Phone, in a game with a TV: the table view, switched to by Table', client: 'phone', seat: (g!.turn + 1) % 3, clicks: ['.viewswitch [data-view=table]'], waitFor: '.table-on', waitMs: 1200 },
      { file: 'tv-reconnecting', caption: 'TV: the connection to the server dropped', client: 'tv', offline: true },
      { file: 'phone-join-started', caption: "Phone: the room's address for a game that has started, everyone at their seat", client: 'phone', waitFor: '.seats' },
    ],
  },
  {
    // #350: a Workshop as a special project. The acting player has a quarry
    // and can afford the project, so Upgrade opens the choice of building.
    // The quarry already has 2 Workshops, so a third adds 1 (#400).
    name: 'workshop-project-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => {
      const p = g.turn;
      Object.keys(g.players[p].resources).forEach((r) => (g.players[p].resources[r as 'gold'] = 12));
      const k = neighbors(g.towers[p]).find((n) => g.map[n].terrain !== 'ocean' && !g.map[n].fauna && !g.buildings[n])!;
      g.map[k].terrain = 'mountain';
      g.buildings[k] = { type: 'quarry', owner: p, upgrades: ['workshop', 'workshop'], floors: 0 };
    },
    shots: (g) => [
      { file: 'tv-workshops-3p', caption: 'TV: a quarry with 2 Workshops, a mark for each', client: 'tv', waitMs: 4800 },
      { file: 'phone-workshop-project-3p', caption: 'Phone: special projects, with the Workshop affordable', client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]'] },
      { file: 'phone-workshop-project-pick-3p', caption: "Phone: the Workshop project's Upgrade tapped and a building picked, before confirming", client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]', '[data-upproject=workshop]', `[data-hex="${Object.keys(g!.buildings).find((k) => g!.buildings[k].type === 'quarry' && g!.buildings[k].owner === g!.turn)}"]`] },
    ],
  },
  {
    // The egg can be afforded, so Hatch opens the choice of its element.
    name: 'egg-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => { Object.keys(g.players[g.turn].resources).forEach((r) => (g.players[g.turn].resources[r as 'gold'] = 12)); },
    shots: (g) => [
      { file: 'phone-egg-element-3p', caption: "Phone: the base dragon egg's Hatch tapped, choosing its element", client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]', '#egg'], sizes: true },
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
    // The four ports, on the four harbors nearest the tower of the player whose
    // turn it is: the Timber Port nearest, so their bank shows timber at 2:1.
    setup: (g) => {
      const owner = g.turn;
      const ks = Object.keys(g.map).filter((x) => g.map[x].terrain === 'harbor' && !g.buildings[x]).sort((a, b) => dist(a, g.towers[owner]) - dist(b, g.towers[owner]) || a.localeCompare(b));
      g.players[owner].resources.timber = Math.max(g.players[owner].resources.timber, 6);
      ['timber_port', 'stone_port', 'crystal_port', 'livestock_port'].forEach((type, i) => ks[i] && (g.buildings[ks[i]] = { type, owner, upgrades: [], floors: 0 }));
    },
    shots: (g) => {
      return [
        { file: 'tv-port-4p', caption: 'TV: the four ports on the coast, facing the sea, each with a pile of what it trades', client: 'tv' },
        // The water moving: frames half a second apart, through one slow swell.
        { file: 'tv-sea-4p', caption: 'TV: the sea moving gently, half a second apart', client: 'tv', frames: Array.from({ length: 16 }, (_, i) => i * 0.5) },
        { file: 'phone-bank-port', caption: 'Phone: the merchants with a Timber Port: timber at 2:1', client: 'phone', seat: g!.turn, clicks: ['[data-tab=trade]', '[data-bank="give timber"]', '[data-bank="get crystal"]'] },
      ];
    },
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
          if (k) g.buildings[k] = { type, owner: p, upgrades: [], floors: 0 };
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
        if (k) g.buildings[k] = { type, owner: p, upgrades: [], floors: 0 };
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
        [['crystal_port', (k) => g.map[k].terrain === 'harbor', null], ['market', land, null], ['hatchery', land, 'nesting_grounds'], ['roost', land, null], ['quarry', land, 'workshop'], ['monument', land, null]],
        // (the quarry gets a second Workshop below: they stack, #400)
        [['monument', land, null], ['standing_stones', (k) => land(k) && by('ley')(k), null], ['lighthouse', (k) => land(k) && by('ocean')(k), null], ['guildhall', land, null], ['market', land, null], ['roost', land, 'nesting_grounds'], ['quarry', land, null]],
      ];
      for (const p of [0, 1]) for (const [type, ok, upgrade] of want[p]) {
        const k = near(p, ok);
        if (k) g.buildings[k] = { type, owner: p, upgrades: upgrade ? [upgrade] : [], floors: 0 };
      }
      g.buildings[g.towers[0]].floors = 2;
      for (const b of Object.values(g.buildings)) if (b.type === 'quarry' && b.owner === 0) b.upgrades.push('workshop');
      g.buildings[g.towers[1]].upgrades = ['nesting_grounds'];
      giveHand(g, g.turn, CIVIC_CARDS);
    },
    shots: (g) => [
      { file: 'tv-civic-2p', caption: 'TV: the dragon, trade and monument cards, and each upgrade on a building (2 Workshops on one quarry)', client: 'tv', waitMs: 4800 },
      { file: 'phone-civic-map-2p', caption: 'Phone: the map with them, choosing where to build a roost', client: 'phone', seat: g!.turn, clicks: ['[data-tab="more"]', '[data-basic="roost"]'] },
      { file: 'phone-civic-hand-2p', caption: 'Phone: a hand of the eight cards and the two upgrades (staged)', client: 'phone', seat: g!.turn },
      // The Market's cost is the longest, four kinds: it must stay on the card (#432).
      { file: 'phone-hand-market-2p', caption: 'Phone: a thumb on the Market, the card with the longest cost, raised to read', client: 'phone', seat: g!.turn, press: { on: card(g!.players[g!.turn].hand.find((c) => c.key === 'market')!.id) } },
      { file: 'phone-zoom-port', caption: 'Phone: a port card tapped open', client: 'phone', seat: g!.turn, clicks: [card('c901')] },
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
        clicks: ['[data-tab=trade]', '[data-to]:nth-last-child(2)', '[data-step="give stone 1"]', '[data-step="give timber 1"]', '[data-step="get gold 1"]', '.handfan [data-card]'],
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
    name: 'trade-anyone-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    // The acting player offers anyone a trade, and the next seat declines it.
    setup: (g) => {
      const t = g.turn;
      apply(g, t, `offer anyone give 1 ${most(g, t)} get 1 ${most(g, (t + 2) % 4, most(g, t))}`);
      apply(g, (t + 1) % 4, `decline ${g.offers[0].id}`);
    },
    shots: (g) => [
      { file: 'tv-trade-anyone-4p', caption: 'TV: an offer to anyone', client: 'tv' },
      { file: 'phone-trade-anyone-in-4p', caption: 'Phone: an offer to anyone, out of turn', client: 'phone', seat: (g!.turn + 2) % 4 },
      { file: 'phone-trade-anyone-out-4p', caption: 'Phone, acting player: their offer to anyone, one player declined', client: 'phone', seat: g!.turn },
      {
        file: 'phone-trade-anyone-compose-4p', caption: 'Phone, acting player: putting an offer to anyone together', client: 'phone', seat: g!.turn,
        clicks: ['[data-tab=trade]', '[data-to="anyone"]', '[data-step="give stone 1"]', '[data-step="get gold 1"]'],
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
      const order = turnOrder(g);
      // The first seat has an adult dragon and a young one, so its vote is
      // worth more than a single young dragon's.
      for (const p of g.players.keys()) arm(g, p, p === order[0] ? [3, 2] : [2]);
      // The last seat's only dragon was knocked out clearing a beast this
      // turn, so that player doesn't vote.
      const last = order.at(-1)!;
      for (const d of g.dragons) if (d.owner === last) d.damage = DRAGONS[d.key].stages[d.stage - 1].hp;
      toVote(g);
      // Two votes, split: the one worth more power leads.
      vote(g, byPower(g)[1], [order[0]]);
      vote(g, byPower(g)[0], [order[1]]);
    },
    shots: (g) => [
      { file: 'tv-raid-vote-5p', caption: 'TV, raid vote (5 players): two have voted, split, the one worth more power leads; one has no vote', client: 'tv', sizes: true },
      { file: 'phone-raid-vote-5p', caption: 'Phone: voting for the target', client: 'phone', seat: seatWhere(g!, (p) => waitingOn(g!).includes(p)), sizes: true },
      { file: 'phone-raid-voted-5p', caption: 'Phone: voted, waiting', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.votes[p] !== null) },
      { file: 'phone-raid-no-vote-5p', caption: 'Phone: no raid-ready dragon, so no vote', client: 'phone', seat: turnOrder(g!).at(-1)! },
    ],
  },
  {
    name: 'in-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    // Straight from the vote to fight or hold back: everyone is in with every raid-ready dragon; the next seat has two.
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === (t + 1) % 4 ? [2, 2] : [2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
    },
    shots: (g) => {
      const two = seatWhere(g!, (p) => g!.raid!.sent[p].length >= 2);
      return [
        { file: 'tv-raid-in-4p', caption: 'TV, fight or hold back right after the vote: everyone is in with every raid-ready dragon (4 players)', client: 'tv' },
        { file: 'phone-raid-in-4p', caption: 'Phone, fight or hold back right after the vote: your dragons in the raid', client: 'phone', seat: two },
        { file: 'phone-raid-dragon-4p', caption: 'Phone, raid: a dragon in the raid tapped open', client: 'phone', seat: two, clicks: ['.sent [data-dragon]'] },
      ];
    },
  },
  {
    // A raid on a kingdom that scores: what it's worth, and who leads for its points.
    name: 'points-choose-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 4 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === t ? [3, 3, 3] : p === (t + 1) % 4 ? [3, 3] : [2]);
      toVote(g);
      vote(g, 'cinderkeep');
      toChoice(g);
    },
    shots: (g) => [
      { file: 'tv-points-choose-4p', caption: 'TV, fight or hold back on Cinderkeep: worth 1 point, and who leads for it', client: 'tv' },
      { file: 'phone-points-choose-4p', caption: 'Phone, fight or hold back against a kingdom that scores', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.sent[p].length >= 2) },
    ],
  },
  {
    // Cinderkeep falls: the raider with the most power standing scores its point.
    name: 'points-result-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const [a, b] = turnOrder(g);
      for (const p of g.players.keys()) arm(g, p, p === a ? [3, 3, 3] : p === b ? [3, 3, 3, 3, 3, 3] : [0]);
      toVote(g);
      vote(g, 'cinderkeep');
      toChoice(g);
      apply(g, b, 'fight');
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-points-result-3p', caption: 'TV: Cinderkeep falls, and the crown comes down on the most power standing, then its point', client: 'tv', live: true, waitFor: '#overlay .scored', waitMs: 600 }],
  },
  {
    // Cinderkeep falls to all six, long names and all: the loot row wraps
    // inside its sheet, which stands clear of the fighters, and one crown
    // comes down (#364).
    name: 'points-result-6p',
    players: 6,
    seed: 1,
    names: LONG_NAMES,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      for (const p of g.players.keys()) arm(g, p, [3, 3]);
      toVote(g);
      vote(g, 'cinderkeep');
      const all = [...g.players.keys()];
      toChoice(g);
      for (const p of all.slice(1)) apply(g, p, 'fight');
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-points-result-6p', caption: 'TV: Cinderkeep falls to six players with long names: the loot wraps inside its sheet, clear of the fighters, and one crown comes down', client: 'tv', live: true, waitFor: '#overlay .scored', waitMs: 600 }],
  },
  {
    // The same fight on Cinderkeep, mid-replay: its Fire Giant looms over the Knights (#326).
    name: 'points-fight-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const [a, b] = turnOrder(g);
      for (const p of g.players.keys()) arm(g, p, p === a ? [3, 3, 3] : p === b ? [3, 3, 3, 3, 3, 3] : [0]);
      toVote(g);
      vote(g, 'cinderkeep');
      toChoice(g);
      apply(g, b, 'fight');
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-points-fight-3p', caption: "TV: a fight on Cinderkeep mid-replay, on its own stage: the Fire Giant looms, a hit bolts across in its attacker's colour", client: 'tv', live: true, waitMs: 3300 }],
  },
  {
    // Titan's Throne, mid-replay: the Titan, the biggest figure in the game, over its Griffins and Knights.
    name: 'titan-fight-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const [a, b] = turnOrder(g);
      for (const p of g.players.keys()) arm(g, p, p === a ? [3, 3, 3, 3] : p === b ? [3, 3, 3, 3] : [0]);
      toVote(g);
      g.raid!.candidates[0] = 'titans_throne';
      vote(g, 'titans_throne');
      toChoice(g);
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-titan-fight-3p', caption: "TV: a fight on Titan's Throne mid-replay: the Titan looms over everything", client: 'tv', live: true, waitMs: 3700 }],
  },
  {
    // The same fight with no TV, on a phone held upright: each side stands
    // its figures one above another, and past four starts another column.
    name: 'remote-titan-fight-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const [a, b] = turnOrder(g);
      for (const p of g.players.keys()) arm(g, p, p === a ? [3, 3, 3, 3] : p === b ? [3, 3, 3, 3] : [0]);
      toVote(g);
      g.raid!.candidates[0] = 'titans_throne';
      vote(g, 'titans_throne');
      toChoice(g);
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'phone-remote-titan-fight-3p', caption: "No TV: Titan's Throne on a phone: each side in columns of up to four", client: 'phone', seat: 1, live: true, waitFor: '.table-on', waitMs: 3700 }],
  },
  {
    name: 'choose-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Two raiders; one has chosen to fight.
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, [2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
      apply(g, t, 'fight');
    },
    shots: (g) => [
      { file: 'tv-raid-choose-3p', caption: 'TV, fight or hold back (3 players): one has chosen', client: 'tv' },
      { file: 'phone-raid-choose-3p', caption: 'Phone: fight or hold back, in secret', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.sent[p].length > 0 && !g!.raid!.choices[p]) },
    ],
  },
  {
    name: 'choose-5p',
    players: 5,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Four raiders against the strongest kingdom on offer, one with two
    // dragons; two have chosen, two are still choosing; the fifth has only an egg, so isn't in.
    setup: (g) => {
      const t = g.turn;
      const raiders = [0, 1, 2, 3].map((i) => (t + i) % 5);
      for (const p of g.players.keys()) arm(g, p, p === raiders[1] ? [3, 2] : p === raiders[3] ? [1] : raiders.includes(p) ? [2] : [0]);
      toVote(g);
      vote(g, byPower(g).at(-1)!);
      toChoice(g);
      apply(g, raiders[0], 'fight');
      apply(g, raiders[2], 'hold');
    },
    shots: () => [{ file: 'tv-raid-choose-5p', caption: 'TV, fight or hold back (5 players): two have chosen, two are choosing', client: 'tv', sizes: true }],
  },
  {
    // Late in a game: two raiders have 8 dragons each in, one has 4, against
    // Cinderkeep, whose sheet is tall; long names; a few dragons are hurt.
    name: 'choose-many-3p',
    players: 3,
    seed: 1,
    names: LONG_NAMES,
    until: (g) => g.round === 4 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn;
      const many = [3, 3, 3, 2, 3, 3, 2, 3];
      for (const p of g.players.keys()) arm(g, p, p === (t + 1) % 3 ? [3, 2, 3, 3] : many);
      toVote(g);
      vote(g, 'cinderkeep');
      toChoice(g);
      const hurt = g.dragons.filter((d) => d.stage === 3);
      hurt[2].damage = 3;
      hurt[9].damage = 8;
      apply(g, t, 'fight');
    },
    shots: () => [{ file: 'tv-raid-choose-many-3p', caption: 'TV, fight or hold back: 8 dragons each for two raiders, on Cinderkeep', client: 'tv', sizes: true }],
  },
  {
    name: 'remote-choose-3p',
    players: 3,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, [2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
      apply(g, t, 'fight');
    },
    shots: () => [{ file: 'tv-remote-choose-3p', caption: 'No TV: fight or hold back on the table view', client: 'tv', table: true, sizes: true }],
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
    shots: () => [{ file: 'tv-raid-fight-3p', caption: "TV: a raid's fight mid-replay, on the kingdom's own stage: a hit lands, a Militia falls", client: 'tv', live: true, waitMs: 2950 }],
  },
  {
    // The same raid as it starts: the coin flip for who strikes first (#439).
    name: 'raid-coin-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: wonRaid,
    live: bots(raidOver),
    liveEnd: (g) => /falls\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-coin-3p', caption: "TV: a raid's fight starts with a coin flip: it lands, and who strikes first shows under it", client: 'tv', live: true, waitFor: '#overlay .fightscene', waitMs: 300 }],
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
    // A fight one raider held back from: they're shown beside it.
    name: 'raid-held-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Three raiders: the first holds back, the second fights with one dragon
    // and holds back the other, the third decides live.
    setup: (g) => {
      const [a, b, c] = turnOrder(g);
      for (const p of g.players.keys()) arm(g, p, [a, b, c].includes(p) ? [3, 3] : [0]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
      apply(g, a, 'hold');
      apply(g, b, `fight ${g.raid!.sent[b][0]}`);
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)), // the rest fought
    shots: () => [{ file: 'tv-raid-held-4p', caption: 'TV: a fight mid-replay, with the dragons held back beside it', client: 'tv', live: true, waitMs: 4100 }],
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
    shots: () => [{ file: 'tv-production-4p', caption: "TV: a new round's production, one player at a time: the second player's resources, dice landed, and their total", client: 'tv', live: true, waitFor: '#overlay .production .pturn.on:nth-child(2) .ptotal.up', hold: true, waitMs: 500 }],
  },
  {
    // Production's dragon step (#442): right after the resources, everyone's
    // dragons heal, grow, move up a stage, or go hungry, on one sheet.
    name: 'production-dragons-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => {
      everyoneRolls(g);
      toDiscard(g, [0]);
      tendable(g);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: (g) => {
      const t = g.log.findLast((e) => e.ev?.k === 'tend')?.ev;
      return t?.k === 'tend' && t.ds.some((x) => x.hungry) && t.ds.some((x) => x.to.stage > x.from.stage) && t.ds.some((x) => x.to.hp > x.from.hp && x.to.stage === x.from.stage);
    },
    shots: () => [
      { file: 'tv-production-dragons-4p', caption: "TV: production's dragon step: health fills, growth fills in, a dragon moves up a stage, and a hungry one is marked", client: 'tv', live: true, waitFor: '#overlay .tending .trow.staged', hold: true, waitMs: 700 },
    ],
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
    shots: () => [{ file: 'tv-production-done-6p', caption: "TV: production ends with everyone's totals together (6 players)", client: 'tv', live: true, waitFor: '#overlay .production .psum.on', hold: true, waitMs: 500 }],
  },
  {
    // A big producer on a phone's table view: 6 dice on every row (#333),
    // set down wherever the terrain fits.
    name: 'production-many-dice-2p',
    players: 2,
    seed: 1,
    remote: true,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => {
      for (const type of ['quarry', 'lumber_camp', 'crystal_mine', 'pasture']) {
        const free = Object.keys(g.map).sort().filter((k) => g.map[k].terrain === BUILDINGS[type].terrain && !g.buildings[k] && !g.map[k].fauna && !nearBeast(g.map, k));
        for (const k of free.slice(0, 6)) g.buildings[k] = { type, owner: 0, upgrades: [], floors: 0 };
      }
      toDiscard(g, [1]);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: (g) => g.log.slice(g.log.findLastIndex((e) => e.ev?.k === 'round')).some((e) => e.ev?.k === 'produce' && e.ev.p === 0 && (e.dice?.length ?? 0) >= 20),
    shots: () => [{ file: 'tv-remote-production-many-dice-2p', caption: "No TV: production on a phone's table view, with 6 dice on every row", client: 'tv', table: true, live: true, waitFor: '#overlay .production .pturn.on .ptotal.up', hold: true, waitMs: 500, sizes: true }],
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
    // Late in a big game: 12 or 13 dragons each, of every stage, long names;
    // some hurt, a few knocked out (#406).
    name: 'late-many-6p',
    players: 6,
    seed: 1,
    names: LONG_NAMES,
    until: late(6, 1),
    setup: (g) => {
      const stages = [3, 3, 2, 3, 1, 3, 2, 0, 3, 3, 2, 1, 3];
      // More than their roosts hold: the TV draws them all the same.
      const keys = Object.keys(DRAGONS);
      g.dragons = [];
      for (const p of g.players.keys()) stages.slice(0, 12 + (p % 2)).forEach((stage, i) => g.dragons.push({ id: `d${g.nextId++}`, owner: p, key: keys[(p + i) % keys.length], stage, growth: 0, damage: 0 }));
      const adults = g.dragons.filter((d) => d.stage === 3);
      adults.forEach((d, i) => { if (i % 5 === 1) d.damage = 6; if (i % 11 === 4) d.damage = 99; });
      for (const d of g.dragons) d.damage = Math.min(d.damage, stageStats(d)?.hp ?? 0);
    },
    shots: () => [{ file: 'tv-late-many-6p', caption: 'TV, late game (6 players): 12 or 13 dragons each', client: 'tv', sizes: true }],
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
    // The turn order mid-round (#430): two players have had their turn, and
    // the third is taking it.
    name: 'turn-order-5p',
    players: 5,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action' && turnOrder(g).indexOf(g.turn) === 2,
    shots: () => [
      { file: 'tv-turn-order-5p', caption: 'TV: the turn order mid-round: two turns over, the third player acting, who goes first next round', client: 'tv' },
    ],
  },
  {
    // A crowded panel header (#398): one player holds every title and slew
    // both great beasts, five badges between their name and their points.
    name: 'many-badges-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 8 && g.phase === 'action',
    setup: (g) => {
      for (const t of Object.keys(g.titles) as (keyof typeof g.titles)[]) g.titles[t] = 0;
      for (const k of Object.keys(g.map)) if (g.map[k].fauna && BEASTS[g.map[k].fauna!]) delete g.map[k].fauna;
      for (const b of Object.keys(BEASTS)) g.slain[b] = 0;
    },
    shots: () => [{ file: 'tv-many-badges-3p', caption: "TV: a player with every title and both great beasts: their points still show in full", client: 'tv' }],
  },
  {
    name: 'last-round-4p',
    players: 4,
    seed: 1,
    // Late in the game, the leader is staged up to the points to win: the
    // round plays on to its end.
    until: late(4, 1),
    setup: (g) => pointsToWin(g, standings(g)[0].p),
    shots: (g) => {
      const top = g!.players.findIndex((_, p) => score(g!, p).public >= TUNING.pointsToWin);
      return [
        { file: 'tv-last-round-4p', caption: 'TV: someone has the points to win, so this round is the last', client: 'tv' },
        { file: 'phone-last-round-4p', caption: 'Phone: someone else has the points to win', client: 'phone', seat: (top + 1) % 4 },
        { file: 'phone-last-round-mine-4p', caption: 'Phone: you have the points to win', client: 'phone', seat: top },
      ];
    },
  },
  {
    name: 'over-4p',
    players: 4,
    seed: 1,
    until: (g) => g.phase === 'over',
    shots: (g) => [
      { file: 'tv-game-over-4p', caption: "TV: final scores, with a QR code to the game's recap", client: 'tv' },
      { file: 'tv-recap-race-4p', caption: 'TV, at the end: the points race, drawn a round at a time (here round 12), with what happened lately', client: 'tv', run: summaryAt(11), waitFor: '[data-step="race-12"]', hold: true },
      { file: 'tv-recap-race-end-4p', caption: 'TV, at the end: the whole race', client: 'tv', run: summaryAt(-3), waitFor: `[data-step="race-${g!.round}"]`, hold: true },
      { file: 'tv-recap-growth-4p', caption: "TV, at the end: everyone's dragon power and production over the game", client: 'tv', run: summaryAt(-2), waitFor: '[data-step="growth"]', hold: true },
      { file: 'tv-recap-points-4p', caption: "TV, at the end: where everyone's points came from", client: 'tv', run: summaryAt(-1), waitFor: '[data-step="points"]', hold: true },
      { file: 'phone-recap-page', caption: "The recap page the TV's QR code opens", client: 'phone', path: (room) => `/recap/${room.recapId}`, waitFor: '.recap-page .sheet' },
      { file: 'phone-game-over-winner', caption: 'Phone: the winner', client: 'phone', seat: g!.winner!, sizes: true },
      { file: 'phone-game-over-loser', caption: 'Phone: everyone else', client: 'phone', seat: (g!.winner! + 1) % 4 },
      { file: 'phone-join-another', caption: 'Phone: after "Join another game", back at the join form', client: 'phone', seat: (g!.winner! + 1) % 4, clicks: ['#newgame'], waitFor: '#join' },
    ],
  },
  {
    // The recap's charts with the longest names: each line's name and number fit at its end.
    name: 'over-long-4p',
    players: 4,
    seed: 1,
    names: LONG_NAMES,
    until: (g) => g.phase === 'over',
    shots: (g) => [
      { file: 'phone-recap-page-long', caption: 'The recap page with long names: every chart shows each name and number in full', client: 'phone', path: (room) => `/recap/${room.recapId}`, waitFor: '.recap-page .sheet' },
      { file: 'tv-recap-growth-long-4p', caption: 'TV, at the end: dragon power and production with long names', client: 'tv', run: summaryAt(-2), waitFor: '[data-step="growth"]', hold: true },
      { file: 'tv-recap-race-end-long-4p', caption: 'TV, at the end: the whole race with long names', client: 'tv', run: summaryAt(-3), waitFor: `[data-step="race-${g!.round}"]`, hold: true },
    ],
  },
  {
    name: 'over-6p',
    players: 6,
    // Seed 1's bots stopped finishing once tower floors housed dragons (#323).
    seed: 2,
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
    name: 'saved-4p',
    players: 4,
    seed: 1,
    bots: [3],
    names: ['Ada', 'Bram', 'Rowan', 'Quinn'],
    away: [2],
    saved: true,
    until: (g) => g.round === 4 && g.phase === 'action',
    shots: () => [
      { file: 'tv-saved-4p', caption: 'TV: a saved game, waiting for the table to come back and continue it', client: 'tv' },
      { file: 'phone-saved-4p', caption: 'Phone: a saved game, with Continue', client: 'phone', seat: 0 },
      { file: 'phone-join-saved', caption: 'Phone: the join form offers the saved games', client: 'phone', path: '/', waitFor: '.savedgames' },
      { file: 'phone-seats-saved', caption: "Phone: a saved game's address: tap your name to take your seat back", client: 'phone', waitFor: '.seats' },
      { file: 'tv-lobby-saved-games', caption: "TV: a new room's lobby offers the saved games", client: 'tv', path: '/tv', waitFor: '.savedgames' },
      { file: 'tv-saved-continue-4p', caption: 'TV: Continue pressed: the game goes on where it was', client: 'tv', clicks: ['#continue'], waitFor: '.board' },
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
      { file: 'phone-resume-join', caption: 'Phone: joining a resumed game takes an open seat, and waits in the lobby for the rest', client: 'phone', fill: { name: 'Ada' }, clicks: ['#join button[type=submit]'], waitFor: '.plobby' },
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
        g.buildings[k] = { type, owner: t, upgrades: [], floors: 0 };
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
        { ...me, file: 'phone-pick-upgrade-picked', caption: 'Phone: a building tapped for the Workshop: its name and each change, before → after, then Upgrade', clicks: [card(id('workshop')), '[data-pickhex]', '.pmap [data-hex]'], sizes: true },
        { ...me, file: 'phone-pick-basic', caption: 'Phone: choosing where a basic building goes (no card)', clicks: ['[data-tab=more]', '[data-basic]:not([disabled])'] },
        { ...me, file: 'phone-bank-picks', caption: 'Phone: the merchants, giving crystal for 2 stone', clicks: ['[data-tab=trade]', '[data-bank="give crystal"]', '[data-bank="get stone"]', '[data-btimes="1"]'] },
      ];
    },
  },
  {
    // Dragons that went hungry at this round's production (#362): each seat
    // has more dragons than livestock.
    name: 'hungry-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const [a, b] = [g.turn, 1 - g.turn];
      arm(g, a, [1, 2, 2, 3]);
      arm(g, b, [1, 2, 3]);
      for (const p of [a, b]) g.dragons.filter((d) => d.owner === p).slice(2).forEach((d) => (d.hungry = true));
    },
    shots: (g) => [
      { file: 'tv-hungry-2p', caption: 'TV: dragons that went hungry this round', client: 'tv' },
      { file: 'phone-hungry-2p', caption: 'Phone: your dragons that went hungry this round', client: 'phone', seat: g!.turn },
      { file: 'phone-hungry-zoom-2p', caption: 'Phone: a hungry dragon tapped open', client: 'phone', seat: 1 - g!.turn, clicks: ['.roost [data-dragon]:nth-child(3)'] },
    ],
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
        if (b.owner !== t || b.upgrades.length) continue;
        const u = Object.keys(UPGRADES).find((u) => upgradeTargets(g, t, u).includes(k));
        if (u) b.upgrades = [u];
      }
      arm(g, t, []);
      arm(g, t, Array(dragonCapacity(g, t)).fill(3));
      const terrain = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].terrain && BUILDINGS[k].terrain !== 'desert').sort((a, b) => buildableHexes(g, t, a).length - buildableHexes(g, t, b).length)[0];
      for (const k of buildableHexes(g, t, terrain)) g.map[k].terrain = 'desert';
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
    name: 'choose-4p',
    players: 4,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const t = g.turn;
      for (const p of g.players.keys()) arm(g, p, p === t ? [2, 2] : p === (t + 1) % 4 ? [2] : [0]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
      apply(g, t, `fight ${g.raid!.sent[t][0]}`);
    },
    shots: (g) => [
      { file: 'phone-raid-not-in-4p', caption: "Phone, fight or hold back: you're not in this raid", client: 'phone', seat: seatWhere(g!, (p) => !g!.raid!.sent[p].length) },
      { file: 'phone-raid-chose-4p', caption: 'Phone, fight or hold back: already chosen, one dragon fights and one holds back', client: 'phone', seat: seatWhere(g!, (p) => g!.raid!.sent[p].length > 0 && !!g!.raid!.choices[p]) },
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
      toChoice(g);
      apply(g, (t + 1) % 3, 'fight');
    },
    live: bots(raidOver),
    liveEnd: (g) => /holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-lost-3p', caption: 'TV: a lost raid, at the end of the replay ("… holds")', client: 'tv', live: true, waitFor: '#overlay .outcome.show', waitMs: 400 }],
  },
  {
    name: 'raid-held-2p',
    players: 2,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    // Both have a dragon in; the first holds back, and the second holds back live.
    setup: (g) => {
      for (const p of [0, 1]) arm(g, p, [1]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
      apply(g, 0, 'hold');
    },
    live: (g) => apply(g, 1, 'hold'),
    liveEnd: (g) => /Everyone holds back/.test(raidOutcome(g)),
    shots: () => [{ file: 'tv-raid-held-2p', caption: 'TV: everyone held back (2 players)', client: 'tv', live: true, waitFor: '#overlay.banner', waitMs: 400 }],
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
      toChoice(g);
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
      giveHand(g, p, ['rouse_bear', 'wake_basilisk', 'windfall']);
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
      {
        // The bear's on this player's building: what it makes reads red in their header (#298).
        file: 'phone-fauna-blocked-3p', caption: 'Phone: a beast on one of your buildings: what it makes reads red', client: 'phone',
        seat: g!.buildings[Object.keys(g!.map).find((k) => g!.map[k].fauna === 'cave_bear' && g!.buildings[k])!].owner,
      },
      { file: 'phone-fauna-pick-3p', caption: 'Phone: choosing which beast to clear', client: 'phone', seat: g!.turn, clicks: ['#hunt'] },
      { file: 'phone-fauna-send-3p', caption: 'Phone: choosing dragons to send against it', client: 'phone', seat: g!.turn, clicks: ['#hunt', '[data-hex]', '[data-hunter]'] },
      { file: 'phone-fauna-card-3p', caption: 'Phone: a fauna card opened', client: 'phone', seat: g!.turn, clicks: [card('c901')] },
      { file: 'phone-fauna-where-3p', caption: 'Phone: choosing where to send the Cave Bear', client: 'phone', seat: g!.turn, clicks: [card('c901'), '[data-pickhex]'] },
      {
        file: 'phone-fauna-where-picked-3p', caption: "Phone: a rival's building tapped for the Basilisk: what it makes, then Place", client: 'phone', seat: g!.turn,
        clicks: [card('c901'), '[data-pickhex]', `[data-hex="${seatState(g!, g!.turn).hand.find((c) => c.id === 'c901')!.hexes.find((k) => g!.buildings[k] && g!.buildings[k].owner !== g!.turn && g!.buildings[k].type !== 'roost')}"]`],
      },
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
      {
        // The Leviathan swims to a far hex of its waters (#339): it dives,
        // stays under, and comes up there a few seconds later.
        file: 'tv-leviathan-dive-3p', caption: 'TV: the Leviathan dives, and comes up at a far hex a few seconds later', client: 'tv',
        then: (room) => room.mutate((g2) => {
          const k = Object.keys(g2.map).find((x) => g2.map[x].fauna === 'leviathan')!;
          const [q, r] = parseKey(k)!;
          const n = leviathanWaters(g2.map, 3).reduce((a, b) => {
            const [aq, ar] = parseKey(a)!, [bq, br] = parseKey(b)!;
            return distance(bq - q, br - r) > distance(aq - q, ar - r) ? b : a;
          });
          g2.map[n].fauna = 'leviathan';
          delete g2.map[k].fauna;
        }),
        waitMs: 1500, // the board has the move before its clock starts
        frames: [0, 0.6, 1.2, 2.5, 4.2, 4.7, 5.6],
      },
      // Last: the fight changes the game.
      { file: 'tv-beast-fight-3p', caption: 'TV: a fight against the Thunderbird mid-replay', client: 'tv', waitMs: 3200, then: (room) => room.mutate((g2) => huntPeak(g2)) },
    ],
  },
  {
    // Fauna beside a great beast (#357): a Basilisk on a hex the Thunderbird
    // holds. The hex is still held, so it keeps its border.
    name: 'beast-hold-fauna-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      beastHunters(g);
      const n = neighbors(PEAK).sort().find((x) => g.map[x] && g.map[x].terrain !== 'ocean' && !g.map[x].fauna && !g.buildings[x])!;
      g.map[n].fauna = 'basilisk';
    },
    shots: () => [{ file: 'tv-beast-hold-fauna-3p', caption: 'TV: a Basilisk beside the Thunderbird, on a hex it holds: still ringed', client: 'tv', waitMs: 4800 }],
  },
  {
    // The Leviathan surfacing by a port holds it (#370): the port is
    // suppressed, its hex dark grey, the feed says so, and its owner's
    // merchants are back to 4:1 for timber until the Leviathan moves off.
    name: 'leviathan-port-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const at = Object.keys(g.map).find((x) => g.map[x].fauna === 'leviathan')!;
      const waters = leviathanWaters(g.map, 3);
      const harbor = Object.keys(g.map).sort().find((x) => g.map[x].terrain === 'harbor' && !g.buildings[x] && !g.map[x].fauna && neighbors(x).some((n) => waters.includes(n)))!;
      // No other beast near it, so the Leviathan's hold is all that greys it.
      for (const n of [harbor, ...neighbors(harbor), ...neighbors(harbor).flatMap(neighbors)]) if (g.map[n]?.fauna && !BEASTS[g.map[n].fauna!]) delete g.map[n].fauna;
      g.buildings[harbor] = { type: 'timber_port', owner: g.turn, upgrades: [], floors: 0 };
      g.players[g.turn].resources.timber = Math.max(g.players[g.turn].resources.timber, 6);
      // It has just surfaced beside the port, as in production, and the feed says so.
      const to = neighbors(harbor).find((x) => waters.includes(x))!;
      delete g.map[at].fauna;
      g.map[to].fauna = 'leviathan';
      g.log.push({ round: g.round, text: `The Leviathan dives at ${at} and surfaces at ${to}.`, ev: { k: 'wander', from: at, to, fauna: 'leviathan', name: BEASTS.leviathan.name } });
    },
    shots: (g) => [
      { file: 'tv-leviathan-port-3p', caption: "TV: the Leviathan holds a Timber Port: it's suppressed, its hex dark grey", client: 'tv', waitMs: 4800 },
      { file: 'phone-bank-leviathan-port-3p', caption: 'Phone: the merchants while the Leviathan holds your Timber Port: timber at 4:1', client: 'phone', seat: g!.turn, clicks: ['[data-tab=trade]', '[data-bank="give timber"]', '[data-bank="get crystal"]'] },
    ],
  },
  {
    // The same fight, at its end.
    name: 'beasts-slain-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => beastHunters(g),
    shots: () => [{ file: 'tv-beast-slain-3p', caption: 'TV: the Thunderbird slain: +4 points for good, and the freed peak\'s +2 pops up', client: 'tv', waitMs: 4800, then: (room) => room.mutate((g2) => huntPeak(g2)) }],
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
      g.buildings[ring] = { type: 'pasture', owner: g.turn, upgrades: [], floors: 0 };
    },
    shots: () => [{ file: 'tv-peak-free-3p', caption: 'TV: the Thunderbird slain, its peak free and the ground round it rich (gold)', client: 'tv', waitMs: 4800 }],
  },
  {
    // Building by the freed peak (#366): a hex tapped shows what the building
    // would do there before Build, a Pasture with the peak's 2 more, and a
    // Hatchery, which makes no resource, told it makes nothing more.
    name: 'peak-build-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      beastHunters(g);
      huntPeak(g);
      const ring = neighbors(PEAK).filter((k) => !g.buildings[k]);
      g.map[ring[0]].terrain = 'meadow';
      g.buildings[ring[0]] = { type: 'pasture', owner: g.turn, upgrades: [], floors: 0 };
      g.map[ring[1]].terrain = 'meadow';
      giveHand(g, g.turn, ['hatchery']);
      for (const r of Object.keys(g.players[g.turn].resources)) g.players[g.turn].resources[r as 'gold'] = 20;
    },
    shots: (g) => {
      const me = seatState(g!, g!.turn);
      const peakHex = (hexes: string[]) => hexes.find((k) => k === PEAK || neighbors(PEAK).includes(k))!;
      const pasture = peakHex(me.basics.find((b) => b.key === 'pasture')!.hexes);
      return [
        { file: 'phone-peak-build-hatchery-3p', caption: 'Phone: a hex by the freed peak tapped for a Hatchery: what it does there, and that it makes nothing more', client: 'phone', seat: g!.turn, clicks: [card('c900'), '[data-pickhex]', `.pmap [data-hex="${peakHex(me.hand[0].hexes)}"]`] },
        { file: 'phone-peak-build-pasture-3p', caption: "Phone: a hex by the freed peak tapped for a Pasture: what it makes there, the peak's 2 more included", client: 'phone', seat: g!.turn, clicks: ['[data-tab=more]', '[data-basic=pasture]', `.pmap [data-hex="${pasture}"]`] },
      ];
    },
  },
  {
    // Clearing ordinary fauna (#96): a Cave Bear beside the acting player's
    // tower and two hatchlings sent against it, lightning
    // and fire. The TV replays the fight as it does a great beast's.
    name: 'fauna-fight-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => bearHunters(g),
    shots: () => [{ file: 'tv-fauna-fight-3p', caption: 'TV: two hatchlings against a Cave Bear, mid-replay', client: 'tv', waitMs: 2200, then: (room) => room.mutate((g2) => huntBear(g2)) }],
  },
  {
    // The same fight as it starts: the coin flip for who strikes first (#439).
    name: 'fauna-coin-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => bearHunters(g),
    shots: () => [{ file: 'tv-fauna-coin-3p', caption: 'TV: clearing a Cave Bear starts with a coin flip: it lands, and who strikes first shows under it', client: 'tv', waitFor: '#overlay .fightscene', waitMs: 300, then: (room) => room.mutate((g2) => huntBear(g2)) }],
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
    // Perching (#217): two rivals' dragons sit on the acting player's
    // Pasture, suppressed while they're there, and the acting
    // player has one of their own perched on a rival's Lumber Camp, with three
    // adults at home to send.
    name: 'perch-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => perchers(g),
    shots: (g) => [
      { file: 'tv-perch-3p', caption: "TV: dragons perched on a rival's buildings, suppressed: their hexes go dark grey", client: 'tv', waitMs: 4800 },
      { file: 'phone-perch-turn-3p', caption: 'Phone: your turn, with perched dragons to clear, a building to perch on and a dragon to recall', client: 'phone', seat: g!.turn },
      { file: 'phone-perch-pick-3p', caption: "Phone: choosing a rival's building to perch on", client: 'phone', seat: g!.turn, clicks: ['#perch'] },
      { file: 'phone-perch-send-3p', caption: 'Phone: choosing dragons to perch there', client: 'phone', seat: g!.turn, clicks: ['#perch', '[data-hex]', '[data-hunter]'] },
      { file: 'phone-perch-clear-3p', caption: 'Phone: sending dragons against the dragons perched on your Pasture', client: 'phone', seat: g!.turn, clicks: ['#hunt', `[data-hex="${perchedPasture(g!)}"]`, '[data-hunter]'] },
      { file: 'phone-perch-other-3p', caption: "Phone: a rival's view, their dragon perched on someone else's Pasture", client: 'phone', seat: (g!.turn + 1) % 3 },
      // Last: the fight changes the game.
      { file: 'tv-perch-fight-3p', caption: 'TV: three adults against two perched dragons, mid-replay', client: 'tv', waitMs: 2800, then: (room) => room.mutate((g2) => apply(g2, g2.turn, `clear ${perchedPasture(g2)} ${g2.dragons.filter((d) => d.owner === g2.turn && canRaid(d)).map((d) => d.id).join(' ')}`)) },
    ],
  },
  {
    // A rival perched on the acting player's roost (#352): suppressed, it
    // houses no dragons, and the phone says they're over their room.
    name: 'perch-roost-3p',
    players: 3,
    seed: 1,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => roostPerched(g),
    shots: (g) => [
      { file: 'tv-perch-roost-3p', caption: "TV: a dragon perched on a rival's roost, whose hex goes dark grey", client: 'tv', waitMs: 4800 },
      { file: 'phone-perch-roost-3p', caption: 'Phone: your roost suppressed, so you have 1 dragon more than room', client: 'phone', seat: g!.turn },
    ],
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
      for (const t of ['mountain', 'forest', 'ley', 'meadow', 'desert', 'harbor']) {
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
      { file: 'phone-menu-3p', caption: 'Phone: the menu under your name, with Save game and Quit game', client: 'phone', seat: 2, clicks: ['#menu'], sizes: true },
      { file: 'phone-wheel-3p', caption: 'Phone: the rulebook at its elements tab: the element wheel, opened from the ring of dots by your points', client: 'phone', seat: 2, clicks: ['#wheel'], waitFor: '.bookpage .wheel', sizes: true },
      ...(['board', 'buildings', 'beasts', 'dragons', 'kingdoms', 'cards'] as const).map((t): Shot => ({
        file: `phone-rules-${t}-3p`, caption: `Phone: the rulebook, from Rules in the header, at its ${t} tab`, client: 'phone', seat: 2,
        clicks: ['#book', `[data-booktab="${t}"]`], waitFor: t === 'kingdoms' || t === 'cards' ? '.bookpage .bentry, .bookpage .bking' : '.bookpage img.bpic', sizes: t === 'board',
      })),
      { file: 'phone-rules-marks-3p', caption: 'Phone: the rulebook, further down its board tab: borders and marks on the board', client: 'phone', seat: 2, clicks: ['#book'], waitFor: '.bookpage img.bpic', run: `document.querySelector('.bookpage').scrollTop = document.querySelectorAll('.bookpage .bhead')[1].offsetTop - document.querySelector('.bookpage').offsetTop` },
      { file: 'phone-rules-trade-3p', caption: 'Phone: the rulebook, at the trade buildings on its buildings tab: the four ports', client: 'phone', seat: 2, clicks: ['#book', '[data-booktab="buildings"]'], waitFor: '.bookpage img.bpic', run: `const p = document.querySelector('.bookpage'); p.scrollTop = [...p.querySelectorAll('.bhead')].find((h) => h.textContent === 'Trade buildings').offsetTop - p.offsetTop` },
      { file: 'phone-rules-upgrades-3p', caption: 'Phone: the rulebook, at the end of its buildings tab: the upgrades', client: 'phone', seat: 2, clicks: ['#book', '[data-booktab="buildings"]'], waitFor: '.bookpage img.bpic', run: `document.querySelector('.bookpage').scrollTop = 1e6` },
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
    // Production's dragon step (#442) on a phone's table view (#447).
    name: 'remote-production-dragons-4p',
    players: 4,
    seed: 1,
    remote: true,
    until: (g) => g.round === 2 && g.phase === 'action',
    setup: (g) => {
      everyoneRolls(g);
      toDiscard(g, [0]);
      tendable(g);
    },
    live: bots((g) => g.phase === 'action'),
    liveEnd: (g) => {
      const t = g.log.findLast((e) => e.ev?.k === 'tend')?.ev;
      return t?.k === 'tend' && t.ds.some((x) => x.hungry) && t.ds.some((x) => x.to.stage > x.from.stage) && t.ds.some((x) => x.to.hp > x.from.hp && x.to.stage === x.from.stage);
    },
    shots: () => [
      { file: 'tv-remote-production-dragons-4p', caption: "No TV: production's dragon step on a phone's table view", client: 'tv', table: true, live: true, waitFor: '#overlay .tending .trow.staged', hold: true, waitMs: 700 },
    ],
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
    shots: () => [
      { file: 'phone-remote-fight-3p', caption: "No TV: a raid's fight cuts in on the phone, mid-replay", client: 'phone', seat: 1, live: true, waitFor: '.table-on', waitMs: 3000 },
      // You, tapped while the fight plays: the phone stays on the table, never "Watch the table" (#294).
      { file: 'phone-remote-fight-you-3p', caption: 'No TV: You tapped mid-fight: the table stays, You is off till the fight ends', client: 'phone', seat: 1, live: true, run: `setTimeout(() => document.querySelector('[data-view="you"]').click(), 1000)`, waitFor: '.viewswitch', waitMs: 1800 },
    ],
  },
  {
    // A fight on the phone with several held back, some with many dragons
    // (#453): they share lines at the foot, and the fighters stand above them.
    name: 'remote-fight-held-4p',
    players: 4,
    seed: 1,
    remote: true,
    until: (g) => g.round === 3 && g.phase === 'action',
    setup: (g) => {
      const [a, b, c, d] = turnOrder(g);
      arm(g, a, [3, 3, 2, 2, 3]);
      arm(g, b, [3, 3]);
      arm(g, c, [3, 2, 3, 2]);
      arm(g, d, [3, 2]);
      toVote(g);
      vote(g, byPower(g)[0]);
      toChoice(g);
      apply(g, a, 'hold');
      apply(g, b, `fight ${g.raid!.sent[b][0]}`);
      apply(g, c, 'hold');
    },
    live: bots(raidOver),
    liveEnd: (g) => /falls\.|holds\./.test(raidOutcome(g)),
    shots: () => [{ file: 'phone-remote-fight-held-4p', caption: 'No TV: a fight on the phone, mid-replay, with three players holding back dragons', client: 'phone', seat: 1, live: true, waitFor: '.table-on', waitMs: 3000 }],
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
      { file: 'phone-remote-beast-3p', caption: 'No TV: a fight against the Thunderbird cuts in on another player\'s phone', client: 'phone', seat: (g!.turn + 1) % 3, waitFor: '.table-on', waitMs: 3200, then: (room) => room.mutate((g2) => huntPeak(g2)) },
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
      { file: 'tv-remote-over-4p', caption: "No TV: the final scores on the table view, with a link to the game's recap", client: 'tv', table: true, sizes: true },
      { file: 'tv-remote-recap-race-4p', caption: 'No TV, at the end: the points race on the table view, here round 12', client: 'tv', table: true, sizes: true, run: summaryAt(11), waitFor: '[data-step="race-12"]', hold: true },
      { file: 'tv-remote-recap-growth-4p', caption: "No TV, at the end: everyone's dragon power and production, on the table view", client: 'tv', table: true, sizes: true, run: summaryAt(-2), waitFor: '[data-step="growth"]', hold: true },
      { file: 'tv-remote-recap-points-4p', caption: "No TV, at the end: where everyone's points came from, on the table view", client: 'tv', table: true, run: summaryAt(-1), waitFor: '[data-step="points"]', hold: true },
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
  toChoice(g);
  // One raider's dragon comes in hurt, so the replay starts its bar short (#311).
  g.dragons.find((d) => d.id === g.raid!.sent[a][0])!.damage = 8;
  apply(g, b, 'fight');
}

// Dragons for production's dragon step (#442), set up just before it: each
// seat has a hurt dragon, one a step from moving up a stage and an egg a step
// from hatching; the last seat has more dragons than its livestock can feed.
function tendable(g: Game) {
  const n = g.players.length;
  for (const p of g.players.keys()) {
    arm(g, p, p === n - 1 ? [1, 2, 2, 3, 3] : [3, 1, 0]);
    const [a, b, c] = g.dragons.filter((d) => d.owner === p);
    a.damage = Math.min(9, DRAGONS[a.key].stages[a.stage - 1].hp - 1);
    b.growth = DRAGONS[b.key].growthTime - 1;
    if (c.stage === 0) c.growth = DRAGONS[c.key].growthTime - 1;
  }
  g.players[n - 1].resources.livestock = 0;
}

// The acting player gets three ready adult ice dragons (the Thunderbird's weakness).
// Player p's dragons, at least young and unhurt, with this round's lines
// about them healing or going hungry taken off the log so the feed doesn't contradict them.
function readyDragons(g: Game, p: number) {
  const mine = new Set(g.dragons.filter((x) => x.owner === p).map((d) => d.id));
  for (const d of g.dragons.filter((x) => x.owner === p)) Object.assign(d, { stage: Math.max(d.stage, 2), damage: 0 });
  g.log = g.log.filter((e) => !(e.ev?.k === 'rest' && mine.has(e.ev.d)));
}

function beastHunters(g: Game) {
  const p = g.turn;
  g.dragons = g.dragons.filter((d) => d.owner !== p);
  for (const key of ['frost_wyrm', 'rime_drake', 'ice_whelp']) g.dragons.push({ id: `d${g.nextId++}`, owner: p, key, stage: 3, growth: 0, damage: 0 });
}

// A building of player q's beside their tower (a Pasture or Lumber Camp on
// an open hex made that terrain), built if they have none there yet.
function besideTower(g: Game, q: number, type: 'pasture' | 'lumber_camp'): string {
  const mine = neighbors(g.towers[q]).find((k) => g.buildings[k]?.owner === q && g.buildings[k].type === type);
  if (mine) return mine;
  const k = neighbors(g.towers[q]).find((x) => g.map[x] && g.map[x].terrain !== 'ocean' && !g.buildings[x] && !nearBeast(g.map, x))!;
  delete g.map[k].fauna;
  g.map[k].terrain = type === 'pasture' ? 'meadow' : 'forest';
  g.buildings[k] = { type, owner: q, upgrades: [], floors: 0 };
  return k;
}

function perchers(g: Game) {
  const p = g.turn, [a, b] = [(p + 1) % 3, (p + 2) % 3];
  const pasture = besideTower(g, p, 'pasture');
  const camp = besideTower(g, a, 'lumber_camp');
  g.dragons = [];
  const add = (owner: number, key: string, stage: number, perch?: string, damage = 0) =>
    g.dragons.push({ id: `d${g.nextId++}`, owner, key, stage, growth: 0, damage, ...(perch ? { perch } : {}) });
  add(a, 'storm_wyrm', 2, pasture, 5);
  add(b, 'reef_drake', 2, pasture);
  add(p, 'ember_wyrm', 2, camp);
  for (const key of ['frost_wyrm', 'fire_whelp', 'bolt_drake']) add(p, key, 3);
  add(a, 'ice_whelp', 1);
  add(b, 'air_whelp', 1);
  // Two roosts of the acting player's, so their four dragons have room.
  for (let i = 0; i < 2; i++) roostBeside(g, p);
}

// A roost on an empty land hex beside q's tower.
function roostBeside(g: Game, q: number): string {
  const k = [g.towers[q], ...neighbors(g.towers[q])].flatMap((t) => neighbors(t)).find((x) => g.map[x] && g.map[x].terrain !== 'ocean' && !g.buildings[x] && !nearBeast(g.map, x) && neighbors(x).some((n) => g.buildings[n]?.owner === q))!;
  delete g.map[k].fauna;
  g.buildings[k] = { type: 'roost', owner: q, upgrades: [], floors: 0 };
  return k;
}

// As perchers, and a rival's hatchling perched on one of the acting player's
// roosts: suppressed, it houses no dragons, so they have 1 more than room (#352).
function roostPerched(g: Game) {
  perchers(g);
  const roost = Object.keys(g.buildings).find((k) => g.buildings[k].owner === g.turn && g.buildings[k].type === 'roost')!;
  g.dragons.find((d) => d.key === 'air_whelp')!.perch = roost;
}

// The acting player's Pasture with rivals perched on it.
function perchedPasture(g: Game): string {
  return Object.keys(g.buildings).find((k) => g.buildings[k].owner === g.turn && g.buildings[k].type === 'pasture' && g.dragons.some((d) => d.perch === k && d.owner !== g.turn))!;
}

// The acting player sends every ready dragon against the Thunderbird.
function huntPeak(g: Game) {
  const ids = g.dragons.filter((d) => d.owner === g.turn && ready(d)).map((d) => d.id);
  apply(g, g.turn, `clear ${PEAK} ${ids.join(' ')}`);
}

// A Cave Bear on an open hex beside the acting player's tower, and two
// dragons of theirs (hatchlings), lightning and fire, ready to send.
function bearHunters(g: Game) {
  const p = g.turn;
  const open = neighbors(g.towers[p]).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k] && !g.map[k].fauna)!;
  g.map[open].fauna = 'cave_bear';
  g.dragons = g.dragons.filter((d) => d.owner !== p);
  for (const key of ['storm_wyrm', 'cinder_drake']) g.dragons.push({ id: `d${g.nextId++}`, owner: p, key, stage: 1, growth: 0, damage: 0 });
}

// The acting player sends every ready dragon against the Cave Bear.
function huntBear(g: Game) {
  const k = Object.keys(g.map).find((x) => g.map[x].fauna === 'cave_bear' && neighbors(g.towers[g.turn]).includes(x))!;
  const ids = g.dragons.filter((d) => d.owner === g.turn && ready(d)).map((d) => d.id);
  apply(g, g.turn, `clear ${k} ${ids.join(' ')}`);
}
