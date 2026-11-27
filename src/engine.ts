// The rules are Rust (rust/src/engine.rs). A game is a plain JSON-serialisable
// object; every player decision goes through apply(game, player, command).

import {
  BUILDINGS, CLASS_NAMES, DRAGONS, RESOURCES, TERRAIN_NOUN, TOWER_CLASSES, TUNING, combatPower,
  type BasicResource, type BuildingClass, type Bundle, type Counted, type DragonStage, type Resource,
} from './data.ts';
import { type Hex } from './map.ts';
import { Refused, ask, moved } from './wasm.ts';
import { type Rng } from './rng.ts';

export interface Card {
  id: string;
  deck: 'building' | 'action';
  key: string; // into BUILDINGS, UPGRADES, ACTIONS or DRAGONS
}

export interface Building {
  type: string; // 'tower' or a BUILDINGS key
  owner: number;
  upgrades: string[]; // keys into UPGRADES, in the order added; a building takes any number
  floors: number; // tower only
}

export interface Dragon {
  id: string;
  owner: number;
  key: string;
  stage: number; // 0 egg, 1 hatchling, 2 young, 3 adult
  growth: number;
  damage: number; // at its stage's health, it's knocked out
  // The rival's building it perches on, if any: that building is suppressed
  // until the dragon is recalled or driven off.
  perch?: string;
  // It went hungry at this round's production, so it didn't heal or grow
  // (#362). Cleared at the next production it's fed.
  hungry?: boolean;
}

export interface Player {
  resources: Record<Resource, number>;
  hand: Card[];
  choice: Card[]; // building cards drawn this round, one to keep
}

export interface TradeSide {
  res: Bundle;
  cards: string[];
}

export interface Offer {
  id: string;
  from: number;
  to: number | null; // null: open to every other player, and the first to accept it trades
  passed?: number[]; // an open offer: the players who have declined it
  give: TradeSide; // what `from` gives
  get: TradeSide; // what `from` receives
}

export interface Raid {
  step: 'vote' | 'choose';
  candidates: string[];
  votes: (number | null)[];
  target: string | null;
  sent: string[][]; // each player's dragons in the raid: all their raid-ready dragons when the vote ends
  choices: (string[] | null)[]; // the dragons each player fights with, once chosen; the rest of theirs hold back, out of the combat but still in for loot
  units: { key: string; hp: number }[];
  fighters: string[];
}

export interface Die {
  sides: number;
  value: number;
  resource?: Resource; // what a production die rolls for
}

export interface LogEntry {
  round: number;
  text: string;
  to?: number[]; // private to these players; public if absent
  dice?: Die[]; // the dice behind this event, for clients to show
  ev?: GameEvent; // what happened, for clients that show it rather than print it
}

// One hit in a raid fight: dragon `d` and defender `u` (an index into the
// target's units); `by` says which of them struck, `down` that the one hit fell.
export interface Hit { d: string; u: number; by: 'dragon' | 'unit'; dmg: number; down: boolean; beats?: true } // beats: the attacker's element beats the target's (double damage)

// A dragon at production's dragon step (#442): how it was before it healed
// or grew and how it is after, so the TV can show the change.
export interface DragonNow { stage: number; growth: number; hp: number; maxHp: number; power: number }
export interface Tended { d: string; p: number; from: DragonNow; to: DragonNow; hungry?: true }

// The log's events as data. The text is for the CLI and Claude players; the
// TV and phones draw these instead.
export type GameEvent =
  | { k: 'round'; n: number }
  | { k: 'produce'; p: number; got: Bundle; eat?: number } // eat: livestock their dragons eat right after (absent in old saves)
  | { k: 'rest'; d: string; why: 'hungry' | 'hurt' }
  | { k: 'grow'; d: string; stage: number }
  | { k: 'tend'; ds: Tended[] } // production's dragon step, once a round: each dragon that healed, grew or went hungry (#442)
  | { k: 'draw'; p: number; n: number }
  | { k: 'pick' } // everyone keeps one of the building cards they drew
  | { k: 'keep'; p: number }
  | { k: 'turn'; p: number }
  | { k: 'build'; p: number; b: string; name: string; hex: string; project?: boolean }
  | { k: 'floor'; p: number; floors: number; project?: boolean }
  | { k: 'upgrade'; p: number; u: string; name: string; on: string; hex: string; project?: boolean }
  | { k: 'hatch'; p: number; d: string; project?: boolean }
  | { k: 'play'; p: number; card: string; name: string; gain?: Bundle; d?: string; raids?: number; hex?: string; fauna?: string }
  // A player's dragons attack what holds a hex: its beast (at full health)
  // and the rivals' dragons perched there. `units` are the defenders, the
  // beast first; a perched dragon's carries its id as `d`. `fauna` and `name`
  // are the beast's, or null and the first perched dragon's name.
  // `hps`: each of `ds`'s health as the fight starts (as for `fight`).
  // `first`: who won the coin flip and strikes first each combat round (absent in old saves: the dragons).
  | { k: 'hunt'; p: number; hex: string; fauna: string | null; name: string; hp: number; ds: string[]; hps?: number[]; units: { name: string; hp: number; d?: string; el?: string }[]; first?: Side }
  | { k: 'cleared'; p: number; hex: string; fauna: string | null; name: string; won: boolean; gain: Bundle; points?: number; home?: string[] } // home: perched dragons driven off
  | { k: 'perch'; p: number; hex: string; ds: string[]; on: string; owner: number } // on: the building's type
  | { k: 'recall'; p: number; ds: string[] }
  | { k: 'wander'; from: string; to: string; fauna: string; name: string } // in production, a beast of the fauna moves 1 hex, or the Leviathan swims anywhere in its waters
  | { k: 'bank'; p: number; give: Bundle; get: Bundle }
  | { k: 'offer'; p: number; to: number | null }
  | { k: 'trade'; from: number; to: number; give: string; get: string }
  | { k: 'decline'; p: number; from: number; give: string; get: string }
  | { k: 'withdraw'; p: number }
  | { k: 'expire'; from: number; to: number | null; give: string; get: string }
  | { k: 'end'; p: number }
  | { k: 'title'; t: Title; p: number | null }
  | { k: 'discard'; p: number; n: number }
  | { k: 'raid'; targets: string[] }
  | { k: 'voted'; p: number; t: string }
  | { k: 'votes'; votes: (number | null)[] }
  | { k: 'target'; t: string; name: string; votes: number[]; coin: boolean }
  | { k: 'commit'; p: number; ds: string[]; ready?: boolean } // old saves only: the commit step is gone
  | { k: 'locked'; ps: number[]; sent?: string[][] } // who is in the raid, and each player's dragons (lined up with ps; absent in old saves)
  | { k: 'hold'; p: number; ds?: string[] } // holds back these dragons (absent in old saves: all of theirs)
  // `hps`: each of `ds`'s health as the fight starts, lined up with `ds`, so a
  // replay drawn after it starts a hurt dragon hurt. Saves from before it lack it.
  // `first`: who won the coin flip and strikes first each combat round (absent in old saves: the dragons).
  // `held`: who held back which dragons, so a replay needn't find the hold events in the log (absent in old saves).
  | { k: 'fight'; ps: number[]; t: string; name: string; ds: string[]; hps?: number[]; units: { name: string; hp: number; el?: string }[]; first?: Side; held?: { p: number; ds: string[] }[] } // el: each defender's element (absent in old saves)
  | { k: 'combat'; round: number; hits: Hit[] }
  | { k: 'raidEnd'; t: string; name: string; won: boolean; winners: number[]; shares: Bundle[]; power: number[]; points?: number; scorer?: number } // shares and power line up with winners; scorer took the kingdom's points
  | { k: 'noRaid'; why: 'unable' | 'nobody' | 'held' } // unable: no dragon was raid-ready; held: everyone held back; nobody: old saves (no one committed)
  | { k: 'again' }
  | { k: 'begin'; players: number; first?: number }
  | { k: 'final'; totals: number[]; winner: number }
  | { k: 'talk' }
  | { k: 'mine' }; // a private line for the player it went to

// Which side of a fight strikes first: the sent dragons, or what they attack.
export type Side = 'dragons' | 'defenders';

export type Title = 'army' | 'tower' | 'hoard';
export const TITLE_NAMES: Record<Title, string> = { army: 'Strongest Dragon Army', tower: 'Tallest Tower', hoard: 'Largest Hoard' };

export interface Game {
  version: 1;
  players: Player[];
  round: number;
  phase: 'cards' | 'action' | 'raid' | 'discard' | 'over';
  turn: number; // whose turn it is in the action phase
  map: Record<string, Hex>;
  buildings: Record<string, Building>;
  towers: string[];
  dragons: Dragon[];
  decks: { building: Card[]; action: Card[] };
  discards: { building: Card[]; action: Card[] };
  offers: Offer[];
  raidsLeft: number;
  raid: Raid | null;
  // Gold each kingdom has added to its printed loot: 1 after every raid it
  // doesn't fall in, back to 0 when it falls (#99).
  hoard: Record<string, number>;
  titles: Record<Title, number | null>;
  slain: Record<string, number>; // great beasts slain, and by whom
  raidPoints: number[]; // each player's points from kingdoms that score (#321)
  beastTried: number[]; // the last round each player fought a great beast
  // Who goes first in round 1, picked at random so joining the lobby first
  // gives no edge (#416). Absent in old saves: the first seat.
  firstSeat?: number;
  winner: number | null;
  nextId: number;
  log: LogEntry[];
  rng: Rng;
}

export class RuleError extends Error {}
const fail = (msg: string): never => {
  throw new RuleError(msg);
};

export const pname = (p: number) => `P${p + 1}`;
// ---------- small helpers ----------

export function bundleText(b: Bundle): string {
  const parts = RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${b[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

function scale(b: Bundle, k: number): Bundle {
  const out: Bundle = {};
  for (const r of RESOURCES) if (b[r]) out[r] = b[r]! * k;
  return out;
}

export function stageStats(d: Dragon): DragonStage | null {
  return d.stage === 0 ? null : DRAGONS[d.key].stages[d.stage - 1];
}

// A dragon fights (raids, clears, perches) whenever it's hatched, has health
// left, and is home: hurt ones fight with what health they have.
export function canRaid(d: Dragon): boolean {
  return d.stage > 0 && !isKnockedOut(d) && !d.perch;
}

function isKnockedOut(d: Dragon): boolean {
  return d.stage > 0 && d.damage >= stageStats(d)!.hp;
}

export function dragonPower(d: Dragon): number {
  const st = stageStats(d);
  return st ? combatPower(st) : 0;
}

// ---------- derived values ----------

export function buildingClass(b: Building): BuildingClass[] {
  return b.type === 'tower' ? TOWER_CLASSES : [BUILDINGS[b.type].class];
}

// What a point card must be built adjacent to, as text: "a monument", "an ocean hex".
export function besideText(what: Counted): string {
  const noun = (TERRAIN_NOUN as Record<string, string>)[what] ?? (what === 'production' ? 'production building' : CLASS_NAMES[what as BuildingClass]);
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
}

export const dragonCapacity = (g: Game, p: number): number => ask('dragonCapacity', g, { p });

// What you give the merchants for 1 of another resource, per resource you give:
// 4, or a port's rate for its own resource. The merchants trade basic resources
// only, never gold (#279).
export const bankRates = (g: Game, p: number): Record<BasicResource, number> => ask('bankRates', g, { p });

// Points a building at hex k is worth: a flat number, never multiplied by
// what's adjacent, plus its upgrades'. Production buildings, point cards
// (monuments) and a Workshop are worth points; the tower and its floors are not.
export const buildingPoints = (g: Game, k: string): number => ask('buildingPoints', g, { k });

// What one building does each round, wherever it stands: what it makes (a
// fixed amount plus dice, per resource, only those it makes), how many dragons
// it houses, and its points. Given a list of upgrades, as it would be with
// those instead (what placing an upgrade card shows before you confirm). It ignores
// a beast or a perched dragon on it: that stops the making and the points,
// not the building.
export interface BuildingYield {
  makes: Partial<Record<Resource, { base: number; dice: number[] }>>;
  houses: number;
  points: number;
}

export const buildingYield = (g: Game, k: string, upgrades?: string[]): BuildingYield => ask('buildingYield', g, { k, upgrades });

// Public production: fixed amount plus a list of dice, per resource.
export const production = (g: Game, p: number): Record<Resource, { base: number; dice: number[] }> => ask('production', g, { p });

export const titleValues = (g: Game, t: Title): number[] => ask('titleValues', g, { t: Object.keys(TITLE_NAMES).indexOf(t) });

export interface Score {
  buildings: number; // every building's points, monuments included
  monuments: number; // the monument cards' share of those
  titles: number;
  beasts: number; // great beasts slain
  raids: number; // kingdoms that score, taken
  hidden: number;
  public: number;
  total: number;
}

export const score = (g: Game, p: number): Score => ask('score', g, { p });

// ---------- setup ----------

// `first` pins who goes first in round 1 (tests, staged scenes); by default
// it's random.
export function newGame(players: number, seed: number, first?: number): Game {
  if (!Number.isInteger(players) || players < 2 || players > 6) fail('A game needs 2 to 6 players.');
  return ask('new', null, { players, seed, first });
}

// ---------- round flow ----------

export const turnOrder = (g: Game): number[] => ask('turnOrder', g);

// A kingdom's loot now: its printed loot plus the gold it has hoarded.
export const lootOf = (g: Game, t: string): Bundle => ask('lootOf', g, { t });

// The final order: most points first. Ties for the win go to the most gold,
// then to whoever is earliest in this round's turn order; that decides the
// winner, who is always first. Other ties share their place.
export interface Standing {
  p: number;
  total: number;
  place: number; // 1 for the winner; players level on points share a place
  tied: boolean; // level on points with someone else
  tiebreak: 'gold' | 'turn order' | null; // the winner's, when they won a tie
}

export const standings = (g: Game): Standing[] => ask('standings', g);

// ---------- raid ----------

// Loot split by power (power[p] is 0 for a player not fighting). Each
// resource is split in proportion, rounded down. What's left over is handed
// out 1 at a time, strongest first, and the turn carries on from one resource
// to the next: so equal powers get equal shares, or as near as the loot
// allows. Equal powers go in `order` (the round's turn order), so as the
// first player moves round by round, so does who gets the odd one.
export const splitLoot = (loot: Bundle, power: number[], order: number[] = power.map((_, p) => p)): Bundle[] => ask('splitLoot', null, { loot, power, order });

// ---------- fauna ----------

// Where a fauna card can put its beast: any land hex without fauna or a tower.
export const faunaHexes = (g: Game): string[] => ask('faunaHexes', g);

// What auto clear goes for, weakest first (the least combat power, then by
// hex): player p's own buildings held by a beast of the fauna or by rivals'
// perched dragons. A great beast's hex, and fauna beside a building, aren't
// its targets (#374).
export const autoClearTargets = (g: Game, p: number): string[] => ask('autoClearTargets', g, { p });

// ---------- commands ----------

export const buildableHexes = (g: Game, p: number, key: string): string[] => ask('buildableHexes', g, { p, key });

export const upgradeTargets = (g: Game, p: number, key: string): string[] => ask('upgradeTargets', g, { p, key });

export function specialProjectCost(kind: 'egg' | 'upgrade', cost: Bundle): Bundle {
  return scale(cost, TUNING.specialProjectMultiplier[kind]);
}

// A refused command changes nothing. The rules are Rust (rust/src/engine.rs).
export function apply(g: Game, p: number, command: string): void {
  try {
    moved('apply', g, { p, cmd: command });
  } catch (e) {
    if (e instanceof Refused) fail(e.message);
    throw e;
  }
}

// ---------- whose decision is it ----------

export const waitingOn = (g: Game): number[] => ask('waitingOn', g);
