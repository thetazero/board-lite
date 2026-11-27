// What the web clients receive, as JSON. publicState is everything on the TV;
// seatState is one player's hidden state and choices (their phone). Like
// view.ts, nothing hidden from a player ever goes into their state.

import type { BasicResource, Resource } from './data.ts';
import type { BuildingYield, Die, Game, GameEvent, Standing, Title } from './engine.ts';
import { ask } from './wasm.ts';

export type Res = Partial<Record<Resource, number>>;

export interface HexView {
  k: string;
  q: number;
  r: number;
  terrain: string;
  building: { type: string; cls: string; name: string; owner: number; upgrades: string[] /* keys in UPGRADES */; upgradeName: string | null /* "Workshop", "2 Workshops" */; floors: number; does: BuildingDoes } | null;
  fauna: FaunaView | null; // a beast holding the hex: nothing is built there, and a building under it produces nothing
  perched: { d: string; owner: number; element: string }[]; // the dragons perched on its building (id, owner, element): it's suppressed while one is there
  held?: string; // next to this great beast (a BEASTS key): nothing is built here until it is slain, and a building here is suppressed
  suppressed?: true; // its building is suppressed (a beast on it or holding it, or a perched dragon): it counts as if it weren't there
  peak?: 'held' | 'free'; // the Thunderbird's peak
  peakZone?: number; // on or next to the freed peak: a production building here makes this many more each round
}

// What a building does each round on its hex (engine's buildingYield), with,
// for a building whose effect is none of those (the Hatchery, a Port), its
// card's words. What the phone shows for a hex before a beast or an upgrade
// goes on it.
export interface BuildingDoes extends BuildingYield {
  note?: string;
  // Placing a building on or next to the freed peak (doesIfBuilt): 'more' if
  // it makes the peak's bonus there, 'none' if it makes no resource to add it to.
  peak?: 'more' | 'none';
}

export interface FaunaView extends UnitView {
  key: string;
  loot: Res;
  points?: number; // a great beast: worth this, for good, to whoever slays it
}

export interface DragonView {
  id: string;
  owner: number;
  name: string;
  element: string;
  stage: number;
  stageName: string;
  growth: number;
  growthTime: number;
  hp: number;
  maxHp: number;
  canRaid: boolean;
  perch: string | null; // the rival's building it perches on
  weak: string[]; // the elements that beat it on the element wheel, as for every fighter
  power: number; // combat power (0 for an egg)
  status: 'ready' | 'egg' | 'perched' | 'out'; // out: knocked out, at 0 health, until it heals
  hungry: boolean; // it went hungry at this round's production: it didn't heal or grow
  targeting: string;
  attack: string;
  key: string; // its card, for the card's art
  stages: DragonStageView[]; // hatchling, young, adult: as on its card
}

export interface DragonStageView { hp: number; attack: string; power: number }

export interface UnitView {
  name: string;
  hp: number;
  maxHp: number;
  attack: string;
  power: number;
  element: string; // what it's weak to comes from the element wheel
  weak: string[];
}

export interface TargetView {
  key: string;
  name: string;
  units: UnitView[];
  loot: Res;
  power: number; // the defenders' combat power, summed
  points?: number; // what it scores, when it falls, for the most power standing
}

export interface RaidView {
  step: 'vote' | 'choose';
  candidates: TargetView[];
  votes: (number | null)[]; // each player's vote (a candidate's index), public as it's cast
  voters: boolean[]; // who votes: only players with a raid-ready dragon
  votePower: number[]; // what each player's vote is worth: their raid-ready dragons' combat power, summed (0 for no vote)
  target: TargetView | null; // units carry current health once the fight starts
  sent: string[][]; // each player's dragons in the raid, once the vote ends: all their raid-ready dragons
  decided: boolean[]; // chosen which dragons fight (not which)
  fighting: boolean[]; // players still in the fight, once it starts
  fighters: string[];
}

export interface EventView {
  i: number; // index in the game log, so clients can tell new events apart
  round: number;
  text: string;
  dice?: Die[];
  private?: boolean;
  ev?: GameEvent; // what happened, as data: the clients draw this rather than print the text
}

export interface PublicState {
  round: number;
  phase: Game['phase'];
  turn: number;
  turnOrder: number[];
  pointsToWin: number;
  titlePoints: number; // what each title is worth
  elementBeats: Record<string, string>; // the element wheel: what each element beats
  faunaWanderOdds: number; // in production, each beast but a great one moves with a 1 in this chance
  faunaSpreadWeight: number; // a moving beast is this many times as likely to pick a hex beside no other beast
  waitingOn: number[];
  players: { publicPoints: number; buildings: number; monuments: number; titles: number; beasts: number; raids: number; handSize: number; gold: number; production: Record<string, { base: number; dice: number[] }>; lastMade: { round: number; total: number } | null; bankRates: Record<BasicResource, number> }[];
  titles: { key: Title; name: string; holder: number | null; values: number[]; min: number }[];
  // The great beasts: where each is (or was), and who slew it.
  beasts: { key: string; name: string; hex: string | null; slainBy: number | null; points: number; hp: number; weak: string[] }[];
  peakBonus: number;
  map: HexView[];
  dragons: DragonView[];
  offers: { id: string; from: number; to: number | null; passed: number[]; give: string; get: string }[]; // to null: open to anyone; passed: who declined it
  raid: RaidView | null;
  kingdoms: TargetView[]; // every kingdom and the loot it holds now
  raidsLeft: number;
  winner: number | null;
  finalTotals: number[] | null;
  standings: Standing[] | null; // once it's over: the final order, ties marked
  log: EventView[]; // public events, talk aside
  talk: EventView[]; // the latest public talk
}

export interface CardView {
  id: string;
  kind: 'building' | 'upgrade' | 'action' | 'dragon';
  key: string;
  name: string;
  text: string;
  cost: Res;
  affordable: boolean;
  // What playing it needs: a hex from `hexes`, a resource, a dragon from `dragons`, or nothing.
  needs: 'hex' | 'resource' | 'dragon' | 'none' | 'unplayable';
  hexes: string[];
  // Buildings that count their neighbours: the count at each of `hexes`.
  counts?: Record<string, number>;
  dragons: string[];
  blocked: string | null; // why it can't be played right now, if known
  verb: string; // its button: Build, Upgrade, Hatch, Play or Place
  // Why you can't play it now, said as the phone says it under the greyed button
  // (docs/wording.md, "Why you can't"): what blocks it, what you can't afford,
  // or that it isn't your turn. Null when you can.
  why: string | null;
  cls?: string; // building cards: the building's class (art falls back to the class's)
  element?: string; // dragon cards: the dragon's element, for the card's art
  fauna?: FaunaView; // fauna cards: the beast it sends
  after?: Record<string, BuildingDoes>; // upgrade cards: what each of `hexes` would do with it; building cards: what it would do built there
  dragon?: { growth: number; targeting: string; stages: DragonStageView[] }; // dragon cards: growth steps per stage, how it picks targets, hatchling/young/adult stats
}

export interface SeatState {
  seat: number;
  resources: Record<Resource, number>;
  hiddenPoints: number;
  totalPoints: number;
  bankRates: Record<BasicResource, number>; // what you give the merchants, per basic resource (never gold)
  dragonsHoused: number;
  dragonCapacity: number;
  // What a round brings in, per resource: a fixed amount plus dice, the same
  // every round until something is built or hatched. eat: what your dragons
  // eat of it each round (livestock only), kept apart from what's made (#309).
  // blocked: one of your buildings that makes it is shut down (a beast or a
  // perched dragon on it), so it brings in less than it could.
  income: Record<Resource, { base: number; dice: number[]; eat: number; blocked: boolean }>;
  hand: CardView[];
  choice: CardView[]; // building cards drawn this round, to keep one
  handCap: number;
  myTurn: boolean;
  deciding: boolean;
  basics: { key: string; cls: string; name: string; text: string; cost: Res; affordable: boolean; hexes: string[]; after: Record<string, BuildingDoes> /* what it would do on each of `hexes` */; onTower: boolean; why: string | null }[]; // built without a card
  eggProject: { cost: Res; affordable: boolean; elements: string[]; room: boolean; why: string | null };
  // Upgrades added without the card, as a special project (the Workshop): on
  // which of your buildings, and what each would do with it.
  upgradeProjects: { key: string; name: string; text: string; cost: Res; affordable: boolean; hexes: string[]; after: Record<string, BuildingDoes>; why: string | null }[];
  raidReady: string[]; // my dragons that can raid, or be sent against fauna on my turn
  huntable: string[]; // hexes I may clear now: beasts (one try at a great beast a round) and rivals' perched dragons
  autoClear: string[]; // my buildings auto clear would clear, weakest first: under fauna (not a great beast) or rivals' perched dragons
  perchable: string[]; // rivals' buildings my raid-ready dragons may perch on (never a tower)
  perched: string[]; // my perched dragons, to recall
  cantAccept: Record<string, string>; // offers to me I can't accept now, by id: why
  myVote: number | null;
  whyNoVote: string | null; // why you don't vote on the raid target, when you don't
  myFight: string[] | null; // the dragons I chose to fight with in this raid ([]: I hold back), once chosen
  log: EventView[]; // private events for me
  talk: EventView[]; // talk I can see: everyone's public talk, and private messages to or from me
}

// Table talk (say and tell), as the engine logs it.
export const isTalk = (text: string) => / says: "| \(private\): "/.test(text);

// Made in Rust (rust/src/state.rs).

/** Every event seat p may see from log index `since` on, talk included. */
export const visibleEvents = (g: Game, p: number, since = 0): EventView[] => ask('visibleEvents', g, { p, since }, true);

export const publicState = (g: Game, lines = 60): PublicState => ask('publicState', g, { lines }, true);

export const seatState = (g: Game, p: number, lines = 15): SeatState => ask('seatState', g, { p, lines }, true);

// What a TV or phone receives on every change.
export type SeatKind = 'player' | 'bot' | 'open';

export interface Lobby {
  code: string;
  started: boolean;
  seating: boolean; // a saved game hosted again, waiting in the lobby until every seat is taken
  saved: number | null; // when someone at the table saved the game (ms epoch): it waits until someone continues it
  // standIn: a bot makes this player's moves (they quit: left, or they're away).
  // strong: a bot seat played by the strong bot (src/strongbot.ts).
  seats: { name: string; kind: SeatKind; connected: boolean; standIn: boolean; left: boolean; strong?: boolean }[];
  minPlayers: number;
  maxPlayers: number;
  file: string; // where the server saves the game
  remote: boolean; // no TV: a phone made the room, and each phone shows the table itself
}

/** A saved game, as the TV's lobby and the phone's join form list it (GET /api/saved). */
export interface SavedGame {
  code: string;
  savedAt: number; // ms epoch
  round: number;
  names: string[]; // everyone at the table, in seat order
}

export interface Snapshot {
  lobby: Lobby;
  seat: number; // the viewer's seat, -1 for the TV
  game: PublicState | null;
  scene: number; // ms left of the scene the TV is playing; everyone's next decision waits for it
  // How many times the room has changed when this was taken: a later snapshot
  // has a higher one, so a phone can tell the answer to its own tap from an
  // older push arriving after it (#456). Counted from the server's start, so
  // only snapshots on the same stream compare. Absent where no room made it.
  v?: number;
  recap?: string | null; // once the game is over: its recap's id (/recap/<id>, src/recap.ts)
  you: (SeatState & { name: string }) | null;
}

// ---------- a finished game's recap (built by src/recap.ts) ----------

export interface RecapStanding {
  p: number;
  place: number; // players level on points share a place, but never first
  tied: boolean;
  tiebreak: 'gold' | 'turn order' | null;
  total: number;
  buildings: number; // every building's points, monuments included
  monuments?: number; // the monument cards' share of those (absent in recaps from before #461)
  titles: number;
  beasts: number; // great beasts slain
  raids: number; // kingdoms that score, taken
  hidden: number; // Secret Hoard cards in hand
}

// What happened that's worth telling, by round: the game's turning points,
// not its routine. Titles only when the holder at a round's end differs from
// the round before (they can change hands several times in a round); great
// beasts when slain; a kingdom's fall only when it scores points or is the
// strongest kingdom to fall yet (recaps from before #375 have every fall).
export type Moment = { round: number } & (
  | { k: 'title'; t: Title; name: string; p: number }
  | { k: 'beast'; p: number; key: string; name: string; points: number }
  | { k: 'fall'; name: string; ps: number[]; points?: number; scorer?: number; times?: number } // scorer: who took a scoring kingdom's points; times: how often it fell that round to them, if more than once
);

export interface Recap {
  v: 1;
  id: string;
  ended: string; // ISO date and time
  rounds: number;
  pointsToWin: number;
  names: string[]; // by seat; the colours are the seats'
  race: number[][]; // everyone's points at the start (0) and after each round; the last row has cards in hand too
  power?: number[][]; // everyone's dragon power at the start (0) and after each round (absent in recaps from before it)
  made?: number[][]; // [round-1]: the resources everyone's production made at the start of each round (absent in recaps from before it)
  standings: RecapStanding[];
  moments: Moment[];
}

// The rulebook on each phone (web/book.ts): every building, upgrade, card,
// beast and kingdom in the game, with its text, cost and stats, as printed.
// Nothing in it depends on a game, so the server hands out the one copy.
export interface BookBuilding { key: string; name: string; cls: string; text: string; cost: Res; terrain?: string; basic: boolean }
export interface Rulebook {
  buildings: BookBuilding[]; // the basic buildings, then the building cards
  upgrades: { key: string; name: string; text: string; cost: Res; on: string[] /* building classes */; base: boolean /* also a special project */ }[];
  actions: { key: string; name: string; text: string; cost: Res; fauna?: FaunaView }[];
  dragons: { key: string; name: string; element: string; cost: Res; base: boolean; growth: number; targeting: string; stages: DragonStageView[] }[];
  fauna: FaunaView[];
  greatBeasts: FaunaView[];
  kingdoms: TargetView[]; // with their printed loot
  tower: { makes: Res; houses: number };
  terrains: string[];
  peakBonus: number; // what a production building on or next to the freed peak makes more
  faunaWanderOdds: number;
  elementBeats: Record<string, string>; // the element wheel: what each element beats
}

export const rulebook = (): Rulebook => ask('rulebook', null);
