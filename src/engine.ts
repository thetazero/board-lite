// The rules engine. A game is a plain JSON-serialisable object; every player
// decision goes through apply(game, player, command).

import {
  ACTIONS, BASIC_RESOURCES, BEASTS, BUILDINGS, CLASS_NAMES, DRAGONS, ELEMENTS, FAUNA, PRODUCTION_CLASSES, RESOURCES, TARGETS, TERRAIN_NOUN, TOWER_CLASSES, TUNING, UNITS, UPGRADES, combatPower, faunaDef,
  type BasicResource, type BuildingClass, type BuildingDef, type Bundle, type Counted, type DragonStage, type Element, type Resource, type UnitDef,
} from './data.ts';
import { PEAK, distance, leviathanWaters, nearBeast, neighbors, parseKey, type Hex } from './map.ts';
import { Refused, ask, moved } from './wasm.ts';
import { type Rng, pick, roll, shuffle } from './rng.ts';

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

function log(g: Game, text: string, ev: GameEvent, opts: { to?: number[]; dice?: Die[] } = {}) {
  const e: LogEntry = { round: g.round, text, ev };
  if (opts.to) e.to = opts.to;
  if (opts.dice) e.dice = opts.dice;
  g.log.push(e);
}

const nCards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

export function bundleText(b: Bundle): string {
  const parts = RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${b[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

function scale(b: Bundle, k: number): Bundle {
  const out: Bundle = {};
  for (const r of RESOURCES) if (b[r]) out[r] = b[r]! * k;
  return out;
}

export function canAfford(pl: Player, cost: Bundle): boolean {
  return RESOURCES.every((r) => pl.resources[r] >= (cost[r] ?? 0));
}

// Why a player can't pay a cost, or null if they can: the same words as the
// error, so the phone's greyed button and a refused command say one thing.
// web/phone.ts matches these words to leave the line out under a greyed button.
export function afford(pl: Player, cost: Bundle): string | null {
  return canAfford(pl, cost) ? null : `You can't afford ${bundleText(cost)}.`;
}

function gain(pl: Player, b: Bundle) {
  for (const r of RESOURCES) pl.resources[r] += b[r] ?? 0;
}

export function cardName(c: Card): string {
  return (BUILDINGS[c.key] ?? UPGRADES[c.key] ?? ACTIONS[c.key] ?? DRAGONS[c.key]).name;
}

export function cardKind(c: Card): 'building' | 'upgrade' | 'action' | 'dragon' {
  return BUILDINGS[c.key] ? 'building' : UPGRADES[c.key] ? 'upgrade' : ACTIONS[c.key] ? 'action' : 'dragon';
}

export function cardCost(c: Card): Bundle {
  return (BUILDINGS[c.key] ?? UPGRADES[c.key] ?? ACTIONS[c.key] ?? DRAGONS[c.key]).cost;
}

export function dragonName(d: Dragon): string {
  return DRAGONS[d.key].name;
}

export function stageStats(d: Dragon): DragonStage | null {
  return d.stage === 0 ? null : DRAGONS[d.key].stages[d.stage - 1];
}

// A raid defender or a beast of the fauna: the same stats, the same combat.
export function foeDef(k: string): UnitDef {
  return UNITS[k] ?? faunaDef(k);
}

// A dragon fights (raids, clears, perches) whenever it's hatched, has health
// left, and is home: hurt ones fight with what health they have.
export function canRaid(d: Dragon): boolean {
  return d.stage > 0 && !isKnockedOut(d) && !d.perch;
}

export function isKnockedOut(d: Dragon): boolean {
  return d.stage > 0 && d.damage >= stageStats(d)!.hp;
}

// The dragons perched on hex k.
export function perchedOn(g: Game, k: string): Dragon[] {
  return g.dragons.filter((d) => d.perch === k);
}

// Is the building on hex k shut down, making and scoring nothing? A beast or
// a perched dragon on it stops it, and so does a great beast holding it from
// an adjacent hex, as the Leviathan can when it surfaces by a port (#370).
// Nothing stops a tower.
export function blocked(g: Game, k: string): boolean {
  return g.buildings[k]?.type !== 'tower' && (nearBeast(g.map, k) || !!g.map[k]?.fauna || perchedOn(g, k).length > 0);
}

export function dragonPower(d: Dragon): number {
  const st = stageStats(d);
  return st ? combatPower(st) : 0;
}

// ---------- derived values ----------

// Player p's buildings that count: a suppressed one (a beast or a perched
// dragon on it) is as if it weren't there, except that nothing is built on
// its hex (#352).
function ownedBuildings(g: Game, p: number): [string, Building][] {
  return Object.entries(g.buildings).filter(([k, b]) => b.owner === p && !blocked(g, k));
}

export function buildingClass(b: Building): BuildingClass[] {
  return b.type === 'tower' ? TOWER_CLASSES : [BUILDINGS[b.type].class];
}

// Does this hex count for an effect that counts `what`? Its terrain does, and
// so does the class of any building on it, whoever owns it ('production' is
// any of the four resource classes), unless a beast or a perched dragon shuts
// it down: then it counts as if it weren't there (#352).
function counts(g: Game, k: string, what: Counted): boolean {
  const b = blocked(g, k) ? undefined : g.buildings[k];
  const classes = what === 'production' ? PRODUCTION_CLASSES : [what as BuildingClass];
  return g.map[k]?.terrain === what || (!!b && buildingClass(b).some((c) => classes.includes(c)));
}

// How many of hex k's neighbours count for `what`.
export function neighbourCount(g: Game, k: string, what: Counted): number {
  return neighbors(k).filter((n) => counts(g, n, what)).length;
}

// How many neighbours a building card at hex k counts, for its owner p: only
// p's buildings if the card says so, and never more than its cap.
export function perCount(g: Game, k: string, def: BuildingDef, p: number): number {
  if (!def.per) return 1;
  const n = neighbors(k).filter((n) => counts(g, n, def.per!) && (!def.perOwn || g.buildings[n]?.owner === p)).length;
  return Math.min(n, def.perMax ?? n);
}

// What a point card must be built adjacent to, as text: "a monument", "an ocean hex".
export function besideText(what: Counted): string {
  const noun = (TERRAIN_NOUN as Record<string, string>)[what] ?? (what === 'production' ? 'production building' : CLASS_NAMES[what as BuildingClass]);
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
}

// The multiplier on a building's effects at hex k: 1, or its neighbour count.
function times(g: Game, k: string, def: BuildingDef): number {
  return perCount(g, k, def, g.buildings[k].owner);
}

// The building types other than the tower, with their hex and multiplier.
function placed(g: Game, p: number): { k: string; b: Building; def: BuildingDef; n: number }[] {
  return ownedBuildings(g, p).filter(([, b]) => b.type !== 'tower').map(([k, b]) => ({ k, b, def: BUILDINGS[b.type], n: times(g, k, BUILDINGS[b.type]) }));
}

// The dragons a tower houses: its own, plus each floor's.
function towerHouses(floors: number): number {
  return TUNING.towerDragonCapacity + floors * (BUILDINGS.tower_floor.dragonCapacity ?? 0);
}

export function dragonCapacity(g: Game, p: number): number {
  let cap = towerHouses(g.buildings[g.towers[p]]?.floors ?? 0);
  for (const { def, n } of placed(g, p)) cap += (def.dragonCapacity ?? 0) * n;
  for (const [, b] of ownedBuildings(g, p)) for (const u of b.upgrades) cap += UPGRADES[u].dragonCapacity ?? 0;
  return cap;
}

// What you give the merchants for 1 of another resource, per resource you give:
// 4, or a port's rate for its own resource. The merchants trade basic resources
// only, never gold (#279).
export function bankRates(g: Game, p: number): Record<BasicResource, number> {
  const rates = Object.fromEntries(BASIC_RESOURCES.map((r) => [r, TUNING.bankRate])) as Record<BasicResource, number>;
  for (const { def } of placed(g, p)) if (def.bankRate) rates[def.bankRate.resource] = Math.min(rates[def.bankRate.resource], def.bankRate.rate);
  return rates;
}

function growthPerRound(g: Game, p: number): number {
  let n = 1;
  for (const { def, n: k } of placed(g, p)) n += (def.growthBonus ?? 0) * k;
  return n;
}

// The resource a building makes, if any (what a Workshop adds to).
export function madeResource(def: BuildingDef): Resource | null {
  return def.produces?.resource ?? (RESOURCES.find((r) => def.makes?.[r]) ?? null);
}

// Points a building at hex k is worth: a flat number, never multiplied by
// what's adjacent, plus its upgrades'. Production buildings, point cards
// (monuments) and a Workshop are worth points; the tower and its floors are not.
export function buildingPoints(g: Game, k: string, upgrades: string[] = g.buildings[k].upgrades): number {
  const b = g.buildings[k];
  const up = upgrades.reduce((n, u) => n + (UPGRADES[u]?.points ?? 0), 0);
  if (b.type === 'tower') return up;
  return (BUILDINGS[b.type].points ?? 0) + up;
}

// Is hex k on or next to the peak, once the Thunderbird has fallen?
export function onPeak(g: Game, k: string): boolean {
  return g.slain.thunderbird !== undefined && (k === PEAK || neighbors(PEAK).includes(k));
}

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

export function buildingYield(g: Game, k: string, upgrades: string[] = g.buildings[k].upgrades): BuildingYield {
  const b = g.buildings[k];
  const ups = upgrades.map((u) => UPGRADES[u]);
  const upHouses = ups.reduce((n, u) => n + (u.dragonCapacity ?? 0), 0);
  const makes: BuildingYield['makes'] = {};
  const add = (r: Resource, base: number, die?: number) => {
    if (!base && !die) return;
    const m = (makes[r] ??= { base: 0, dice: [] });
    m.base += base;
    if (die) m.dice.push(die);
  };
  if (b.type === 'tower') {
    for (const r of RESOURCES) add(r, TUNING.towerProduction[r] ?? 0);
    return { makes, houses: towerHouses(b.floors) + upHouses, points: 0 };
  }
  const def = BUILDINGS[b.type];
  const n = times(g, k, def);
  if (def.produces) add(def.produces.resource, def.produces.base, def.produces.die);
  for (const r of RESOURCES) add(r, (def.makes?.[r] ?? 0) * n);
  const made = madeResource(def);
  // The first of an upgrade on a building adds its baseBonus; each after it, its stackBonus.
  if (made) upgrades.forEach((u, i) => { const d = UPGRADES[u]; add(made, (upgrades.indexOf(u) === i ? d.baseBonus : d.stackBonus ?? d.baseBonus) ?? 0); });
  if (made && onPeak(g, k)) add(made, TUNING.peakBonus);
  return { makes, houses: (def.dragonCapacity ?? 0) * n + upHouses, points: buildingPoints(g, k, upgrades) };
}

// Public production: fixed amount plus a list of dice, per resource.
export function production(g: Game, p: number): Record<Resource, { base: number; dice: number[] }> {
  const out = Object.fromEntries(RESOURCES.map((r) => [r, { base: 0, dice: [] as number[] }])) as Record<Resource, { base: number; dice: number[] }>;
  for (const [k] of ownedBuildings(g, p)) {
    for (const [r, m] of Object.entries(buildingYield(g, k).makes) as [Resource, { base: number; dice: number[] }][]) {
      out[r].base += m.base;
      out[r].dice.push(...m.dice);
    }
  }
  return out;
}

function titleValue(g: Game, p: number, t: Title): number {
  if (t === 'army') return g.dragons.filter((d) => d.owner === p).reduce((s, d) => s + dragonPower(d), 0);
  if (t === 'tower') return g.buildings[g.towers[p]].floors;
  return g.players[p].resources.gold;
}

export function titleValues(g: Game, t: Title): number[] {
  return g.players.map((_, p) => titleValue(g, p, t));
}

// A title goes to the single strict leader, once they reach its minimum; the
// holder keeps it on a tie.
function updateTitles(g: Game) {
  for (const t of Object.keys(TITLE_NAMES) as Title[]) {
    const vals = titleValues(g, t);
    const best = Math.max(...vals);
    const leaders = vals.flatMap((v, p) => (v === best ? [p] : []));
    const holder = g.titles[t];
    const next = best < TUNING.titleMinimum[t] ? null : holder !== null && leaders.includes(holder) ? holder : leaders.length === 1 ? leaders[0] : null;
    if (next !== holder) {
      g.titles[t] = next;
      log(g, next === null ? `No one holds ${TITLE_NAMES[t]} now.` : `${pname(next)} takes ${TITLE_NAMES[t]}.`, { k: 'title', t, p: next });
    }
  }
}

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

export function score(g: Game, p: number): Score {
  let buildings = 0, monuments = 0;
  for (const [k, b] of ownedBuildings(g, p)) {
    buildings += buildingPoints(g, k);
    if (b.type !== 'tower' && BUILDINGS[b.type].class === 'monument') monuments += buildingPoints(g, k);
  }
  const titles = (Object.values(g.titles).filter((h) => h === p).length) * TUNING.titlePoints;
  const hidden = g.players[p].hand.reduce((s, c) => s + (ACTIONS[c.key]?.effect === 'hidden_point' ? ACTIONS[c.key].amount ?? 0 : 0), 0);
  const beasts = Object.entries(g.slain).filter(([, by]) => by === p).reduce((s, [k]) => s + BEASTS[k].points, 0);
  const raids = g.raidPoints?.[p] ?? 0;
  const pub = buildings + titles + beasts + raids;
  return { buildings, monuments, titles, beasts, raids, hidden, public: pub, total: pub + hidden };
}

// ---------- setup ----------

// `first` pins who goes first in round 1 (tests, staged scenes); by default
// it's random.
export function newGame(players: number, seed: number, first?: number): Game {
  if (!Number.isInteger(players) || players < 2 || players > 6) fail('A game needs 2 to 6 players.');
  return ask('new', null, { players, seed, first });
}

// ---------- round flow ----------

function drawCard(g: Game, deck: 'building' | 'action'): Card | null {
  if (g.decks[deck].length === 0) {
    g.decks[deck] = shuffle(g.rng, g.discards[deck]);
    g.discards[deck] = [];
  }
  return g.decks[deck].pop() ?? null;
}

function startRound(g: Game) {
  g.round++;
  log(g, `=== Round ${g.round} ===`, { k: 'round', n: g.round });
  // 1. Production, in turn order.
  const fedIds = new Set<string>();
  for (const p of turnOrder(g)) {
    const prod = production(g, p);
    const got: Bundle = {};
    const dice: Die[] = [];
    for (const r of RESOURCES) {
      got[r] = prod[r].base;
      for (const sides of prod[r].dice) {
        const value = roll(g.rng, sides);
        dice.push({ sides, value, resource: r });
        got[r]! += value;
      }
    }
    gain(g.players[p], got);
    // Then their hatched dragons eat, each while there's livestock left (#309): said
    // with what they made, so the table sees the livestock go. Nothing in
    // between (beasts wandering) touches resources, so eating here is the
    // same as eating after. Eggs don't eat (#415): they always grow.
    let eat = 0;
    for (const d of g.dragons.filter((x) => x.owner === p)) {
      if (d.stage === 0) {
        fedIds.add(d.id);
        continue;
      }
      if (g.players[p].resources.livestock < TUNING.livestockPerDragon) break;
      g.players[p].resources.livestock -= TUNING.livestockPerDragon;
      eat += TUNING.livestockPerDragon;
      fedIds.add(d.id);
    }
    log(g, `${pname(p)} makes ${bundleText(got)}.${eat ? ` ${pname(p)}'s dragons eat ${eat} livestock.` : ''}`, { k: 'produce', p, got, eat }, { dice });
  }
  wander(g);
  roam(g);
  // A fed dragon heals some if it's hurt, and grows if it isn't; a hungry one
  // does neither.
  const tended: Tended[] = [];
  const now = (d: Dragon): DragonNow => {
    const st = stageStats(d);
    return { stage: d.stage, growth: d.growth, hp: st ? st.hp - d.damage : 0, maxHp: st ? st.hp : 0, power: dragonPower(d) };
  };
  for (const d of g.dragons) {
    const from = now(d);
    tend(d);
    const to = now(d);
    if (d.hungry || JSON.stringify(from) !== JSON.stringify(to)) tended.push({ d: d.id, p: d.owner, from, to, ...(d.hungry ? { hungry: true as const } : {}) });
  }
  if (tended.length) log(g, tended.some((x) => !x.hungry) ? 'Dragons heal and grow.' : 'No dragon heals or grows.', { k: 'tend', ds: tended });
  function tend(d: Dragon) {
    const hurt = d.damage > 0;
    const fed = fedIds.has(d.id);
    if (fed) delete d.hungry;
    else d.hungry = true;
    if (!fed || hurt) log(g, `${pname(d.owner)}'s ${dragonName(d)} (${d.id}) ${fed ? 'heals instead of growing' : 'goes hungry: it doesn\'t heal or grow'}.`, { k: 'rest', d: d.id, why: fed ? 'hurt' : 'hungry' });
    if (!fed) return;
    if (hurt) {
      d.damage = Math.max(0, d.damage - TUNING.healPerRound);
      return;
    }
    if (d.stage === 3) return;
    d.growth += growthPerRound(g, d.owner);
    const need = DRAGONS[d.key].growthTime;
    while (d.stage < 3 && d.growth >= need) {
      d.growth -= need;
      d.stage++;
      log(g, `${pname(d.owner)}'s ${dragonName(d)} (${d.id}) grows into ${['an egg', 'a hatchling', 'a young dragon', 'an adult'][d.stage]}.`, { k: 'grow', d: d.id, stage: d.stage });
    }
    if (d.stage === 3) d.growth = 0;
  }
  // 2. Cards, all at once: the action cards go straight to hand; of the
  // building cards, each player keeps one and discards the rest.
  for (let p = 0; p < g.players.length; p++) {
    const pl = g.players[p];
    const actions: Card[] = [];
    for (let i = 0; i < TUNING.actionCardsPerRound; i++) {
      const c = drawCard(g, 'action');
      if (c) actions.push(c);
    }
    for (let i = 0; i < TUNING.buildingCardsDrawn; i++) {
      const c = drawCard(g, 'building');
      if (c) pl.choice.push(c);
    }
    pl.hand.push(...actions);
    const named = (cs: Card[]) => cs.map((c) => `${cardName(c)} (${c.id})`).join(', ');
    log(g, `You draw ${named(actions) || 'no action card'}${pl.choice.length ? `, and building cards ${named(pl.choice)}: keep 1` : ''}.`, { k: 'mine' }, { to: [p] });
    log(g, `${pname(p)} draws ${nCards(actions.length + pl.choice.length)}.`, { k: 'draw', p, n: actions.length + pl.choice.length });
    if (pl.choice.length === 1) keepCard(g, p, pl.choice[0]);
  }
  g.phase = 'cards';
  if (g.players.every((pl) => !pl.choice.length)) return startActions(g);
  log(g, 'Everyone keeps 1 of their 2 building cards.', { k: 'pick' });
}

function keepCard(g: Game, p: number, c: Card) {
  const pl = g.players[p];
  for (const x of pl.choice) if (x !== c) g.discards.building.push(x);
  pl.choice = [];
  pl.hand.push(c);
  log(g, `You keep ${cardName(c)} (${c.id}).`, { k: 'mine' }, { to: [p] });
}

// 3. Action phase.
function startActions(g: Game) {
  updateTitles(g);
  g.phase = 'action';
  g.turn = firstPlayer(g);
  g.raidsLeft = 1;
  log(g, `Actions: ${pname(g.turn)}'s turn.`, { k: 'turn', p: g.turn });
}

// Round 1's first player is random; from then on the first player moves one
// seat to the left each round.
export function firstPlayer(g: Game): number {
  return ((g.firstSeat ?? 0) + g.round - 1) % g.players.length;
}

export function turnOrder(g: Game): number[] {
  return g.players.map((_, i) => (firstPlayer(g) + i) % g.players.length);
}

function startRaid(g: Game) {
  g.phase = 'raid';
  const n = g.players.length;
  if (!g.dragons.some(canRaid)) {
    log(g, 'No one has a raid-ready dragon: no raid this round.', { k: 'noRaid', why: 'unable' });
    finishRaid(g);
    return;
  }
  g.raid = {
    step: 'vote',
    candidates: Object.keys(TARGETS),
    votes: Array(n).fill(null),
    target: null,
    sent: Array.from({ length: n }, () => []),
    choices: Array(n).fill(null),
    units: [],
    fighters: [],
  };
  log(g, `Raid vote: ${g.raid.candidates.map((t, i) => `${i + 1}. ${TARGETS[t].name}`).join(', ')}.`, { k: 'raid', targets: g.raid.candidates });
}

// A kingdom's loot now: its printed loot plus the gold it has hoarded.
export function lootOf(g: Game, t: string): Bundle {
  const loot = { ...TARGETS[t].loot };
  const extra = g.hoard?.[t] ?? 0;
  if (extra) loot.gold = (loot.gold ?? 0) + extra;
  return loot;
}

// After every raid, each kingdom that didn't fall adds 1 gold to its loot, and
// the one that fell is back to its printed loot.
function finishRaid(g: Game, fell?: string) {
  g.hoard ??= {};
  for (const t of Object.keys(TARGETS)) g.hoard[t] = t === fell ? 0 : (g.hoard[t] ?? 0) + 1;
  g.raid = null;
  g.raidsLeft--;
  updateTitles(g);
  if (g.raidsLeft > 0) {
    log(g, 'Another raid follows this round.', { k: 'again' });
    startRaid(g);
    return;
  }
  g.phase = 'discard';
  maybeEndRound(g);
}

function maybeEndRound(g: Game) {
  if (g.players.some((pl) => pl.hand.length > TUNING.handCap)) return; // waiting on discards
  const totals = g.players.map((_, p) => score(g, p).total);
  const best = Math.max(...totals);
  if (best >= TUNING.pointsToWin) {
    const winner = standings(g)[0].p;
    g.winner = winner;
    g.phase = 'over';
    log(g, `Final scores: ${totals.map((t, p) => `${pname(p)} ${t}`).join(', ')}.`, { k: 'final', totals, winner });
    log(g, `${pname(winner)} wins with ${best} points!`, { k: 'final', totals, winner });
    return;
  }
  startRound(g);
}

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

export function standings(g: Game): Standing[] {
  const totals = g.players.map((_, p) => score(g, p).total);
  const order = turnOrder(g);
  const sorted = [...order].sort((a, b) => totals[b] - totals[a] || g.players[b].resources.gold - g.players[a].resources.gold || order.indexOf(a) - order.indexOf(b));
  const out: Standing[] = sorted.map((p) => ({ p, total: totals[p], place: 0, tied: totals.filter((t) => t === totals[p]).length > 1, tiebreak: null }));
  // First place is never shared: the winner took the tie.
  for (const [i, s] of out.entries()) s.place = i > 1 && s.total === out[i - 1].total ? out[i - 1].place : i + 1;
  if (out.length > 1 && out[0].total === out[1].total) {
    const gold = (s: Standing) => g.players[s.p].resources.gold;
    out[0].tiebreak = gold(out[0]) > gold(out[1]) ? 'gold' : 'turn order';
  }
  return out;
}

// ---------- raid ----------

function eligibleDragons(g: Game, p: number): Dragon[] {
  return g.dragons.filter((d) => d.owner === p && canRaid(d));
}

// Only a player with a raid-ready dragon votes on the target: the others
// couldn't send anything to it. Nothing changes a dragon during the vote, so
// this holds from the vote's start to its end.
export function canVote(g: Game, p: number): boolean {
  return eligibleDragons(g, p).length > 0;
}

export const NO_VOTE = "You have no raid-ready dragon, so you don't vote.";

// What a player's vote is worth: the combat power of their raid-ready
// dragons, summed (what they could send to the target). 0 for no vote.
export function votePower(g: Game, p: number): number {
  return eligibleDragons(g, p).reduce((s, d) => s + dragonPower(d), 0);
}

// One fight: dragons against foes (a raid's defenders, or one beast of the
// fauna). The raid keeps its fight in g.raid; clearing fauna uses its own.
// A defender is a unit or beast by its key, or a perched dragon (`d`, its id,
// with `key` its card): it fights with its life stage's stats, and the hits
// it takes stay on it.
interface Battle {
  units: { key: string; hp: number; d?: string }[];
  fighters: string[];
}

export function unitsText(g: Game): string {
  return g.raid!.units.map((u, i) => `${UNITS[u.key].name} #${i + 1} ${u.hp}/${UNITS[u.key].hp}hp`).join(', ');
}

// Loot split by power (power[p] is 0 for a player not fighting). Each
// resource is split in proportion, rounded down. What's left over is handed
// out 1 at a time, strongest first, and the turn carries on from one resource
// to the next: so equal powers get equal shares, or as near as the loot
// allows. Equal powers go in `order` (the round's turn order), so as the
// first player moves round by round, so does who gets the odd one.
export function splitLoot(loot: Bundle, power: number[], order: number[] = power.map((_, p) => p)): Bundle[] {
  const total = power.reduce((s, x) => s + x, 0);
  const winners = power.flatMap((x, p) => (x ? [p] : []));
  const byPower = [...winners].sort((a, b) => power[b] - power[a] || order.indexOf(a) - order.indexOf(b));
  const shares: Bundle[] = power.map(() => ({}));
  let next = 0;
  for (const r of RESOURCES) {
    if (!loot[r]) continue;
    let left = loot[r]!;
    for (const p of winners) { const n = Math.floor((loot[r]! * power[p]) / total); if (n) shares[p][r] = n; left -= n; }
    for (; left > 0; left--, next++) { const p = byPower[next % byPower.length]; shares[p][r] = (shares[p][r] ?? 0) + 1; }
  }
  return shares;
}

// Who has the most power (power[p], 0 for not fighting); equal powers go in
// `order`, the round's turn order. Undefined if no one has any.
export function pointsLeader(power: number[], order: number[]): number | undefined {
  const best = Math.max(0, ...power);
  return best ? order.find((p) => power[p] === best) : undefined;
}

// ---------- fauna ----------

// The dragons of players other than p perched on hex k: what p fights there.
export function rivalsPerched(g: Game, p: number, k: string): Dragon[] {
  return perchedOn(g, k).filter((d) => d.owner !== p);
}

// Where player p's dragons may perch: any rival's building but a tower.
export function perchHexes(g: Game, p: number): string[] {
  return Object.keys(g.buildings).filter((k) => g.buildings[k].owner !== p && g.buildings[k].type !== 'tower').sort();
}

// What clearing the beast on hex k pays: its loot, or nothing if a card sent it.
export function faunaLoot(g: Game, k: string): Bundle {
  return g.map[k].sent ? {} : faunaDef(g.map[k].fauna!).loot;
}

// In production, each beast of the fauna (not a great beast) may move to a
// random adjacent land hex with no tower or beast, taking its card-sent mark
// with it. A hex beside no other beast is more likely (faunaSpreadWeight), so
// beasts tend to spread out (#273) but still move at random.
function wander(g: Game) {
  const open = new Set(faunaHexes(g));
  for (const k of faunaOnMap(g)) {
    const f = g.map[k].fauna!;
    if (BEASTS[f] || roll(g.rng, TUNING.faunaWanderOdds) !== 1) continue;
    const to = neighbors(k).filter((n) => open.has(n));
    if (!to.length) continue;
    const lonely = (n: string) => !neighbors(n).some((m) => m !== k && g.map[m]?.fauna);
    const n = pick(g.rng, to.flatMap((m) => Array(lonely(m) ? TUNING.faunaSpreadWeight : 1).fill(m)));
    g.map[n].fauna = f;
    if (g.map[k].sent) g.map[n].sent = true;
    delete g.map[k].fauna;
    delete g.map[k].sent;
    open.delete(n);
    open.add(k);
    const b = g.buildings[n];
    log(g, `The ${FAUNA[f].name} at ${k} moves to ${n}${b ? `, onto ${pname(b.owner)}'s ${BUILDINGS[b.type].name}` : ''}.`, { k: 'wander', from: k, to: n, fauna: f, name: FAUNA[f].name });
  }
}

// In production the Leviathan, while it lives, dives and comes up at another
// hex of its waters, at random: a hex is as likely as it is far, so it
// usually swims well away, but not always.
function roam(g: Game) {
  const k = faunaOnMap(g).find((x) => g.map[x].fauna === 'leviathan');
  if (!k) return;
  const [q, r] = parseKey(k)!;
  const far = (n: string) => {
    const [nq, nr] = parseKey(n)!;
    return distance(nq - q, nr - r);
  };
  const to = leviathanWaters(g.map, g.players.length).filter((n) => n !== k);
  if (!to.length) return;
  const n = pick(g.rng, to.flatMap((m) => Array(far(m)).fill(m)));
  g.map[n].fauna = 'leviathan';
  delete g.map[k].fauna;
  log(g, `The Leviathan dives at ${k} and surfaces at ${n}.`, { k: 'wander', from: k, to: n, fauna: 'leviathan', name: BEASTS.leviathan.name });
}

// Where a fauna card can put its beast: any land hex without fauna or a tower.
export function faunaHexes(g: Game): string[] {
  return Object.keys(g.map).filter((k) => g.map[k].terrain !== 'ocean' && !g.map[k].fauna && g.buildings[k]?.type !== 'tower').sort();
}

export function faunaOnMap(g: Game): string[] {
  return Object.keys(g.map).filter((k) => g.map[k].fauna).sort();
}

// The hexes player p may clear now: every beast of the fauna, the great
// beasts unless they have had their try this round, and every hex where a
// rival's dragon perches.
export function huntable(g: Game, p: number): string[] {
  const beasts = faunaOnMap(g).filter((k) => !BEASTS[g.map[k].fauna!] || g.beastTried[p] !== g.round);
  const perched = [...new Set(g.dragons.filter((d) => d.perch && d.owner !== p).map((d) => d.perch!))];
  return [...new Set([...beasts, ...perched])].sort();
}

// What auto clear goes for, weakest first (the least combat power, then by
// hex): player p's own buildings held by a beast of the fauna or by rivals'
// perched dragons. A great beast's hex, and fauna beside a building, aren't
// its targets (#374).
export function autoClearTargets(g: Game, p: number): string[] {
  const power = (k: string) => (g.map[k].fauna ? combatPower(faunaDef(g.map[k].fauna!)) : 0) + rivalsPerched(g, p, k).reduce((s, d) => s + dragonPower(d), 0);
  return Object.keys(g.buildings)
    .filter((k) => g.buildings[k].owner === p && !BEASTS[g.map[k].fauna ?? ''] && (g.map[k].fauna || rivalsPerched(g, p, k).length))
    .map((k) => ({ k, power: power(k) }))
    .sort((a, b) => a.power - b.power || (a.k < b.k ? -1 : 1))
    .map((t) => t.k);
}

// ---------- commands ----------

export function tradeText(g: Game, s: TradeSide): string {
  const parts: string[] = [];
  if (Object.values(s.res).some((n) => n)) parts.push(bundleText(s.res));
  for (const id of s.cards) {
    const c = g.players.flatMap((pl) => pl.hand).find((x) => x.id === id);
    parts.push(c ? `${cardName(c)} card (${id})` : `card ${id}`);
  }
  return parts.join(', ') || 'nothing';
}

function hasTradeSide(g: Game, p: number, s: TradeSide): boolean {
  return canAfford(g.players[p], s.res) && s.cards.every((id) => g.players[p].hand.some((c) => c.id === id));
}

// Whether offer o waits on p's answer: it's made to them, or open to anyone
// and they haven't declined it.
export function offerFor(o: Offer, p: number): boolean {
  return o.to === null ? o.from !== p && !(o.passed ?? []).includes(p) : o.to === p;
}

// Why player p, who the offer is made to, can't accept it now, or null if they can.
export function acceptProblem(g: Game, o: Offer, p: number): string | null {
  if (!hasTradeSide(g, o.from, o.give)) return `${pname(o.from)} no longer has what they offered.`;
  if (!hasTradeSide(g, p, o.get)) return `You don't have ${tradeText(g, o.get)}.`;
  return null;
}

export function buildableHexes(g: Game, p: number, type: string): string[] {
  const def = BUILDINGS[type];
  if (def.onTower) return [g.towers[p]];
  const out = new Set<string>();
  for (const [k] of ownedBuildings(g, p)) {
    for (const n of neighbors(k)) {
      if (g.map[n] && g.map[n].terrain !== 'ocean' && !g.buildings[n] && !nearBeast(g.map, n) && !g.map[n].fauna && (!def.terrain || g.map[n].terrain === def.terrain) && (!def.beside || neighbourCount(g, n, def.beside) > 0)) out.add(n);
    }
  }
  return [...out].sort();
}

export function upgradeTargets(g: Game, p: number, up: string): string[] {
  return ownedBuildings(g, p)
    .filter(([, b]) => buildingClass(b).some((c) => UPGRADES[up].appliesTo.includes(c)))
    .map(([k]) => k)
    .sort();
}

// The upgrades a player may add without the card, as a special project.
export const PROJECT_UPGRADES = Object.keys(UPGRADES).filter((k) => UPGRADES[k].base);

export function specialProjectCost(kind: 'egg' | 'upgrade', cost: Bundle): Bundle {
  return scale(cost, TUNING.specialProjectMultiplier[kind]);
}

export const PROJECT_DRAGONS = Object.fromEntries(ELEMENTS.map((e) => [e, Object.keys(DRAGONS).find((k) => DRAGONS[k].base && DRAGONS[k].element === e)!])) as Record<Element, string>;

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

export function waitingOn(g: Game): number[] {
  const all = g.players.map((_, p) => p);
  if (g.phase === 'over') return [];
  if (g.phase === 'action') return [g.turn, ...all.filter((p) => p !== g.turn && g.offers.some((o) => offerFor(o, p)))];
  if (g.phase === 'discard') return all.filter((p) => g.players[p].hand.length > TUNING.handCap);
  if (g.phase === 'cards') return all.filter((p) => g.players[p].choice.length);
  const raid = g.raid!;
  if (raid.step === 'vote') return all.filter((p) => raid.votes[p] === null && canVote(g, p));
  return all.filter((p) => raid.sent[p].length && !raid.choices[p]);
}
