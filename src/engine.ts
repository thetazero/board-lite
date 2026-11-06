// The rules engine. A game is a plain JSON-serialisable object; every player
// decision goes through apply(game, player, command).

import {
  ACTIONS, BASIC_BUILDINGS, BASIC_RESOURCES, BEASTS, BUILDINGS, CLASS_NAMES, DECKS, DRAGONS, ELEMENTS, ELEMENT_WEAK, FAUNA, PRODUCTION_CLASSES, RESOURCES, TARGETS, TERRAIN_NOUN, TOWER_CLASSES, TUNING, UNITS, UPGRADES, combatPower, elementalDamage, faunaDef, orList,
  type Attack, type BasicResource, type BuildingClass, type BuildingDef, type Bundle, type Counted, type DragonStage, type Element, type Resource, type UnitDef,
} from './data.ts';
import { PEAK, distance, generateMap, key, leviathanWaters, nearBeast, neighbors, parseKey, towerSpots, type Hex } from './map.ts';
import { type Rng, pick, roll, shuffle } from './rng.ts';

export interface Card {
  id: string;
  deck: 'building' | 'action';
  key: string; // into BUILDINGS, UPGRADES, ACTIONS or DRAGONS
}

export interface Building {
  type: string; // 'tower' or a BUILDINGS key
  owner: number;
  upgrade: string | null;
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
  step: 'vote' | 'commit' | 'choose';
  candidates: string[];
  votes: (number | null)[];
  target: string | null;
  commits: string[][];
  ready: boolean[];
  choices: ('fight' | 'hold' | null)[]; // hold: held back, out of the combat but still in for loot
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

// The log's events as data. The text is for the CLI and Claude players; the
// TV and phones draw these instead.
export type GameEvent =
  | { k: 'round'; n: number }
  | { k: 'produce'; p: number; got: Bundle; eat?: number } // eat: livestock their dragons eat right after (absent in old saves)
  | { k: 'rest'; d: string; why: 'hungry' | 'hurt' }
  | { k: 'grow'; d: string; stage: number }
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
  | { k: 'commit'; p: number; ds: string[]; ready?: boolean }
  | { k: 'locked'; ps: number[] }
  | { k: 'hold'; p: number } // holds back
  // `hps`: each of `ds`'s health as the fight starts, lined up with `ds`, so a
  // replay drawn after it starts a hurt dragon hurt. Saves from before it lack it.
  // `first`: who won the coin flip and strikes first each combat round (absent in old saves: the dragons).
  | { k: 'fight'; ps: number[]; t: string; name: string; ds: string[]; hps?: number[]; units: { name: string; hp: number; el?: string }[]; first?: Side } // el: each defender's element (absent in old saves)
  | { k: 'combat'; round: number; hits: Hit[] }
  | { k: 'raidEnd'; t: string; name: string; won: boolean; winners: number[]; shares: Bundle[]; power: number[]; points?: number; scorer?: number } // shares and power line up with winners; scorer took the kingdom's points
  | { k: 'noRaid'; why: 'unable' | 'nobody' | 'held' } // unable: no dragon was raid-ready; held: everyone held back
  | { k: 'again' }
  | { k: 'begin'; players: number }
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

function newId(g: Game, prefix: string): string {
  return `${prefix}${g.nextId++}`;
}

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

function pay(pl: Player, cost: Bundle) {
  const why = afford(pl, cost);
  if (why) fail(why);
  for (const r of RESOURCES) pl.resources[r] -= cost[r] ?? 0;
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

function parsePlayer(g: Game, s: string | undefined): number {
  const m = /^p?(\d+)$/i.exec(s ?? '');
  const p = m ? Number(m[1]) - 1 : -1;
  if (p < 0 || p >= g.players.length) fail(`Unknown player "${s ?? ''}". Players are P1..P${g.players.length}.`);
  return p;
}

function parseResource(s: string | undefined): Resource {
  const r = RESOURCES.find((x) => x === s?.toLowerCase());
  return r ?? fail(`Unknown resource "${s ?? ''}". Resources: ${RESOURCES.join(', ')}.`);
}

function handCard(g: Game, p: number, id: string | undefined): Card {
  const c = g.players[p].hand.find((x) => x.id === id);
  return c ?? fail(`You have no card "${id ?? ''}" in hand.`);
}

function ownDragon(g: Game, p: number, id: string | undefined): Dragon {
  const d = g.dragons.find((x) => x.id === id && x.owner === p);
  return d ?? fail(`You have no dragon "${id ?? ''}".`);
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
  for (const [, b] of ownedBuildings(g, p)) if (b.upgrade) cap += UPGRADES[b.upgrade].dragonCapacity ?? 0;
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
// what's adjacent, plus its upgrade's. Production buildings, point cards
// (monuments) and a Workshop are worth points; the tower and its floors are not.
export function buildingPoints(g: Game, k: string, upgrade: string | null = g.buildings[k].upgrade): number {
  const b = g.buildings[k];
  const up = upgrade ? UPGRADES[upgrade]?.points ?? 0 : 0;
  if (b.type === 'tower') return up;
  return (BUILDINGS[b.type].points ?? 0) + up;
}

// Is hex k on or next to the peak, once the Thunderbird has fallen?
export function onPeak(g: Game, k: string): boolean {
  return g.slain.thunderbird !== undefined && (k === PEAK || neighbors(PEAK).includes(k));
}

// What one building does each round, wherever it stands: what it makes (a
// fixed amount plus dice, per resource, only those it makes), how many dragons
// it houses, and its points. Given an upgrade, as it would be with that one
// instead (what placing an upgrade card shows before you confirm). It ignores
// a beast or a perched dragon on it: that stops the making and the points,
// not the building.
export interface BuildingYield {
  makes: Partial<Record<Resource, { base: number; dice: number[] }>>;
  houses: number;
  points: number;
}

export function buildingYield(g: Game, k: string, upgrade: string | null = g.buildings[k].upgrade): BuildingYield {
  const b = g.buildings[k];
  const up = upgrade ? UPGRADES[upgrade] : null;
  const makes: BuildingYield['makes'] = {};
  const add = (r: Resource, base: number, die?: number) => {
    if (!base && !die) return;
    const m = (makes[r] ??= { base: 0, dice: [] });
    m.base += base;
    if (die) m.dice.push(die);
  };
  if (b.type === 'tower') {
    for (const r of RESOURCES) add(r, TUNING.towerProduction[r] ?? 0);
    return { makes, houses: towerHouses(b.floors) + (up?.dragonCapacity ?? 0), points: 0 };
  }
  const def = BUILDINGS[b.type];
  const n = times(g, k, def);
  if (def.produces) add(def.produces.resource, def.produces.base, def.produces.die);
  for (const r of RESOURCES) add(r, (def.makes?.[r] ?? 0) * n);
  const made = madeResource(def);
  if (made && up?.baseBonus) add(made, up.baseBonus);
  if (made && onPeak(g, k)) add(made, TUNING.peakBonus);
  return { makes, houses: (def.dragonCapacity ?? 0) * n + (up?.dragonCapacity ?? 0), points: buildingPoints(g, k, upgrade) };
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

function buildDeck(g: Game, deck: 'building' | 'action'): Card[] {
  const defs: readonly Record<string, { copies?: number }>[] = DECKS[deck];
  const cards: Card[] = [];
  for (const d of defs) for (const [k, def] of Object.entries(d)) for (let i = 0; i < (def.copies ?? 0); i++) cards.push({ id: '', deck, key: k });
  shuffle(g.rng, cards);
  for (const c of cards) c.id = newId(g, 'c');
  return cards;
}

export function newGame(players: number, seed: number): Game {
  if (!Number.isInteger(players) || players < 2 || players > 6) fail('A game needs 2 to 6 players.');
  const rng: Rng = { state: seed | 0 };
  const g: Game = {
    version: 1,
    players: [],
    round: 0,
    phase: 'action',
    turn: 0,
    map: generateMap(rng, players),
    buildings: {},
    towers: towerSpots(players),
    dragons: [],
    decks: { building: [], action: [] },
    discards: { building: [], action: [] },
    offers: [],
    raidsLeft: 0,
    raid: null,
    hoard: Object.fromEntries(Object.keys(TARGETS).map((t) => [t, 0])),
    titles: { army: null, tower: null, hoard: null },
    slain: {},
    raidPoints: Array(players).fill(0),
    beastTried: Array(players).fill(0),
    winner: null,
    nextId: 1,
    log: [],
    rng,
  };
  g.decks.building = buildDeck(g, 'building');
  g.decks.action = buildDeck(g, 'action');
  for (let p = 0; p < players; p++) {
    const resources = Object.fromEntries(RESOURCES.map((r) => [r, TUNING.startingResources[r] ?? 0])) as Record<Resource, number>;
    g.players.push({ resources, hand: [], choice: [] });
    g.buildings[g.towers[p]] = { type: 'tower', owner: p, upgrade: null, floors: 0 };
    g.dragons.push({ id: newId(g, 'd'), owner: p, key: PROJECT_DRAGONS.fire, stage: TUNING.startingDragonStage, growth: 0, damage: 0 });
  }
  log(g, `A ${players}-player game begins. First to ${TUNING.pointsToWin} points wins (checked at the end of each round).`, { k: 'begin', players });
  startRound(g);
  return g;
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
    // Then their dragons eat, each while there's livestock left (#309): said
    // with what they made, so the table sees the livestock go. Nothing in
    // between (beasts wandering) touches resources, so eating here is the
    // same as eating after.
    let eat = 0;
    for (const d of g.dragons.filter((x) => x.owner === p)) {
      if (g.players[p].resources.livestock < TUNING.livestockPerDragon) break;
      g.players[p].resources.livestock -= TUNING.livestockPerDragon;
      eat += TUNING.livestockPerDragon;
      fedIds.add(d.id);
    }
    log(g, `${pname(p)} produces ${bundleText(got)}.${eat ? ` ${pname(p)}'s dragons eat ${eat} livestock.` : ''}`, { k: 'produce', p, got, eat }, { dice });
  }
  wander(g);
  roam(g);
  // A fed dragon heals some if it's hurt, and grows if it isn't; a hungry one
  // does neither.
  for (const d of g.dragons) {
    const hurt = d.damage > 0;
    const fed = fedIds.has(d.id);
    if (!fed || hurt) log(g, `${pname(d.owner)}'s ${dragonName(d)} (${d.id}) ${fed ? 'heals instead of growing' : 'goes hungry: it doesn\'t heal or grow'}.`, { k: 'rest', d: d.id, why: fed ? 'hurt' : 'hungry' });
    if (!fed) continue;
    if (hurt) {
      d.damage = Math.max(0, d.damage - TUNING.healPerRound);
      continue;
    }
    if (d.stage === 3) continue;
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
    log(g, `You draw ${named(actions) || 'no action card'}${pl.choice.length ? `, and building cards ${named(pl.choice)}: keep one` : ''}.`, { k: 'mine' }, { to: [p] });
    log(g, `${pname(p)} draws ${nCards(actions.length + pl.choice.length)}.`, { k: 'draw', p, n: actions.length + pl.choice.length });
    if (pl.choice.length === 1) keepCard(g, p, pl.choice[0]);
  }
  g.phase = 'cards';
  if (g.players.every((pl) => !pl.choice.length)) return startActions(g);
  log(g, 'Everyone picks a building card to keep.', { k: 'pick' });
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
  log(g, `Action phase: ${pname(g.turn)}'s turn.`, { k: 'turn', p: g.turn });
}

// The first player moves one seat to the left each round.
export function firstPlayer(g: Game): number {
  return (g.round - 1) % g.players.length;
}

export function turnOrder(g: Game): number[] {
  return g.players.map((_, i) => (firstPlayer(g) + i) % g.players.length);
}

function endTurn(g: Game) {
  for (const o of g.offers) log(g, `Offer ${o.id} expires.`, { k: 'expire', from: o.from, to: o.to, give: tradeText(g, o.give), get: tradeText(g, o.get) });
  g.offers = [];
  const next = (g.turn + 1) % g.players.length;
  if (next !== firstPlayer(g)) {
    g.turn = next;
    log(g, `${pname(g.turn)}'s turn.`, { k: 'turn', p: g.turn });
    return;
  }
  startRaid(g);
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
    commits: Array.from({ length: n }, () => []),
    ready: Array(n).fill(false),
    choices: Array(n).fill(null),
    units: [],
    fighters: [],
  };
  log(g, `Raid phase: vote for a target among ${g.raid.candidates.map((t, i) => `${i + 1}. ${TARGETS[t].name}`).join(', ')}.`, { k: 'raid', targets: g.raid.candidates });
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

function resolveVote(g: Game) {
  const raid = g.raid!;
  const counts = raid.candidates.map((_, i) => raid.votes.reduce<number>((s, v, p) => s + (v === i ? votePower(g, p) : 0), 0));
  const best = Math.max(...counts);
  const tied = raid.candidates.filter((_, i) => counts[i] === best);
  raid.target = tied.length > 1 ? pick(g.rng, tied) : tied[0];
  const target: GameEvent = { k: 'target', t: raid.target, name: TARGETS[raid.target].name, votes: counts, coin: tied.length > 1 };
  log(g, `Votes: ${raid.votes.flatMap((v, p) => (v === null ? [] : [`${pname(p)} (power ${votePower(g, p)})→${TARGETS[raid.candidates[v]].name}`])).join(', ')}.`, { k: 'votes', votes: [...raid.votes] });
  log(g, `The raid target is ${TARGETS[raid.target].name}${tied.length > 1 ? ' (tie broken by a coin flip)' : ''}.`, target);
  raid.step = 'commit';
  for (let p = 0; p < g.players.length; p++) raid.ready[p] = eligibleDragons(g, p).length === 0;
  if (raid.ready.every(Boolean)) resolveCommit(g);
}

function resolveCommit(g: Game) {
  const raid = g.raid!;
  const committed = raid.commits.flatMap((c, p) => (c.length ? [p] : []));
  if (committed.length === 0) {
    log(g, 'No one raids.', { k: 'noRaid', why: 'nobody' });
    return finishRaid(g);
  }
  log(g, `Commitments lock in: ${committed.map((p) => `${pname(p)} (${raid.commits[p].join(' ')})`).join(', ')}. Each now secretly chooses to fight or hold back.`, { k: 'locked', ps: committed });
  raid.step = 'choose';
}

function resolveChoices(g: Game) {
  const raid = g.raid!;
  const fighters: number[] = [];
  for (let p = 0; p < g.players.length; p++) {
    if (raid.choices[p] === 'fight') fighters.push(p);
    if (raid.choices[p] === 'hold') log(g, `${pname(p)} holds back.`, { k: 'hold', p });
  }
  if (fighters.length === 0) {
    log(g, 'Everyone holds back. The raid is off.', { k: 'noRaid', why: 'held' });
    return finishRaid(g);
  }
  raid.fighters = fighters.flatMap((p) => raid.commits[p]);
  raid.units = TARGETS[raid.target!].units.map((k) => ({ key: k, hp: UNITS[k].hp }));
  const first = coinFlip(g);
  log(g, `Fighting: ${fighters.map(pname).join(', ')}. The attack on ${TARGETS[raid.target!].name} begins. ${firstText(first, 'the defenders')}`, { k: 'fight', ps: fighters, t: raid.target!, name: TARGETS[raid.target!].name, ds: [...raid.fighters], hps: raid.fighters.map((id) => healthOf(dragonById(g, id))), units: raid.units.map((u) => ({ name: UNITS[u.key].name, hp: u.hp, el: UNITS[u.key].element })), first });
  // No retreat: the fight goes on until every defender falls or every dragon is knocked out.
  for (let round = 1; !checkRaidOver(g); round++) combatRound(g, raid, round, first);
}

// A hatched dragon's health now: its life stage's, less the hits it carries.
function healthOf(d: Dragon): number {
  return Math.max(0, stageStats(d)!.hp - d.damage);
}

function rollAttack(g: Game, a: Attack): number {
  let sum = 0;
  for (let i = 0; i < a.dice; i++) sum += roll(g.rng, a.sides);
  return sum;
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

function unitDef(g: Game, u: Battle['units'][number]): UnitDef {
  if (!u.d) return foeDef(u.key);
  const d = dragonById(g, u.d);
  return { name: dragonName(d), ...stageStats(d)!, element: DRAGONS[d.key].element };
}

function pickTargets(g: Game, b: Battle, d: Dragon, n: number): number[] {
  const alive = b.units.flatMap((u, i) => (u.hp > 0 ? [i] : []));
  const rule = DRAGONS[d.key].targeting;
  let order = shuffle(g.rng, alive.slice());
  if (rule === 'lowest_health') order.sort((x, y) => b.units[x].hp - b.units[y].hp);
  if (rule === 'strongest_attacker') {
    const power = (i: number) => { const u = unitDef(g, b.units[i]); return u.targets * u.dice * (u.sides + 1); };
    order.sort((x, y) => power(y) - power(x));
  }
  if (rule === 'weak_to_me') {
    const weak = (i: number) => (ELEMENT_WEAK[unitDef(g, b.units[i]).element].includes(DRAGONS[d.key].element) ? 0 : 1);
    order.sort((x, y) => weak(x) - weak(y));
  }
  return order.slice(0, n);
}

function dragonById(g: Game, id: string): Dragon {
  return g.dragons.find((d) => d.id === id)!;
}

// A dragon at 0 health is knocked out: it leaves the fight and heals at home.
function knockedOut(b: Battle, d: Dragon): boolean {
  if (d.damage < stageStats(d)!.hp) return false;
  d.damage = stageStats(d)!.hp;
  b.fighters = b.fighters.filter((id) => id !== d.id);
  return true;
}

// A perched dragon takes its hits like any other; at 0 health it is knocked
// out and goes home.
function defenderHit(g: Game, u: Battle['units'][number]) {
  const d = dragonById(g, u.d!);
  d.damage = stageStats(d)!.hp - u.hp;
  if (u.hp === 0) delete d.perch;
}

// Who strikes first in a fight: a coin flip, once for the whole fight.
function coinFlip(g: Game): Side {
  return roll(g.rng, 2) === 1 ? 'dragons' : 'defenders';
}

// The log's line for the flip; `them` names what the dragons attack, one
// beast or dragon unless `many`.
function firstText(first: Side, them: string, many = true): string {
  return first === 'dragons' ? 'Coin flip: the dragons strike first.' : `Coin flip: ${them} ${many ? 'strike' : 'strikes'} first.`;
}

// One combat round: the side that won the fight's coin flip strikes first,
// then the other, with what it has left standing.
function combatRound(g: Game, b: Battle, round: number, first: Side) {
  const lines: string[] = [];
  const hits: Hit[] = [];
  if (first === 'defenders') defendersStrike(g, b, lines, hits);
  dragonsStrike(g, b, lines, hits);
  if (first === 'dragons') defendersStrike(g, b, lines, hits);
  log(g, `Combat round ${round}: ${lines.join('; ')}.`, { k: 'combat', round, hits });
}

function dragonsStrike(g: Game, b: Battle, lines: string[], hits: Hit[]) {
  for (const id of b.fighters) {
    const d = dragonById(g, id);
    const st = stageStats(d)!;
    for (const ui of pickTargets(g, b, d, st.targets)) {
      const u = b.units[ui];
      const def = unitDef(g, u);
      const roll = rollAttack(g, st);
      const dmg = elementalDamage(roll, DRAGONS[d.key].element, def.element);
      u.hp = Math.max(0, u.hp - dmg);
      if (u.d) defenderHit(g, u);
      lines.push(`${d.id} hits ${def.name} #${ui + 1} for ${dmg}${u.hp === 0 ? ' (defeated)' : ''}`);
      hits.push({ d: d.id, u: ui, by: 'dragon', dmg, down: u.hp === 0, ...(dmg > roll ? { beats: true as const } : {}) });
    }
  }
}

function defendersStrike(g: Game, b: Battle, lines: string[], hits: Hit[]) {
  for (const [ui, u] of b.units.entries()) {
    if (u.hp <= 0) continue;
    const def = unitDef(g, u);
    for (let t = 0; t < def.targets && b.fighters.length; t++) {
      const d = dragonById(g, pick(g.rng, b.fighters));
      const roll = rollAttack(g, def);
      const dmg = elementalDamage(roll, def.element, DRAGONS[d.key].element);
      d.damage += dmg;
      const down = knockedOut(b, d);
      lines.push(`${def.name} #${ui + 1} hits ${d.id} for ${dmg}${down ? ' (knocked out, limps home)' : ''}`);
      hits.push({ d: d.id, u: ui, by: 'unit', dmg, down, ...(dmg > roll ? { beats: true as const } : {}) });
    }
  }
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

function checkRaidOver(g: Game): boolean {
  const raid = g.raid!;
  if (raid.units.every((u) => u.hp <= 0)) {
    // Loot is split by the combat power each player has in the raid not
    // knocked out: the dragons still fighting and the ones held back.
    const standing = raid.commits.flat().map((id) => dragonById(g, id)).filter((d) => healthOf(d) > 0);
    const power = g.players.map((_, p) => standing.reduce((s, d) => s + (d.owner === p ? dragonPower(d) : 0), 0));
    const winners = g.players.flatMap((_, p) => (power[p] ? [p] : []));
    const loot = lootOf(g, raid.target!);
    const order = turnOrder(g);
    const shares = splitLoot(loot, power, order);
    for (const p of winners) gain(g.players[p], shares[p]);
    const take = winners.map((p) => `${pname(p)} (power ${power[p]}) takes ${bundleText(shares[p]) || 'nothing'}`).join('; ');
    // A kingdom that scores gives its points to the most power standing
    // (not knocked out); equal powers go in turn order, as the loot's odd ones do.
    const points = TARGETS[raid.target!].points;
    const scorer = points ? pointsLeader(power, order) : undefined;
    if (points && scorer !== undefined) {
      g.raidPoints ??= g.players.map(() => 0);
      g.raidPoints[scorer] += points;
    }
    const scored = points && scorer !== undefined ? ` ${pname(scorer)} has the most power standing and scores ${points} point${points === 1 ? '' : 's'}.` : '';
    log(g, `${TARGETS[raid.target!].name} falls. ${take}.${scored}`, { k: 'raidEnd', t: raid.target!, name: TARGETS[raid.target!].name, won: true, winners, shares: winners.map((p) => shares[p]), power: winners.map((p) => power[p]), ...(points && scorer !== undefined ? { points, scorer } : {}) });
    finishRaid(g, raid.target!);
    return true;
  }
  if (raid.fighters.length === 0) {
    log(g, `No dragons are left in the fight. ${TARGETS[raid.target!].name} holds.`, { k: 'raidEnd', t: raid.target!, name: TARGETS[raid.target!].name, won: false, winners: [], shares: [], power: [] });
    finishRaid(g);
    return true;
  }
  return false;
}

// ---------- fauna ----------

// A player's dragons attack what holds hex k, in a raid's combat, to the end:
// its beast and every rival dragon perched there, together. The hits they
// take stay on them, into the round's raids. If every defender falls, the beast is gone and
// its loot (and a great beast's points, for good) goes to the player, and the
// perched dragons are knocked out and go home. If not, the beast stays,
// healed; perched dragons keep their hits, and stay unless knocked out. A
// player gets one try at a great beast a round.
function clearHex(g: Game, p: number, k: string, ds: Dragon[]): boolean {
  const f = g.map[k].fauna ?? null;
  const great = f ? BEASTS[f] : undefined;
  if (great) {
    if (g.beastTried[p] === g.round) fail(`You've fought a great beast this round already: 1 try each round.`);
    g.beastTried[p] = g.round;
  }
  const perched = rivalsPerched(g, p, k);
  const units: Battle['units'] = [
    ...(f ? [{ key: f, hp: faunaDef(f).hp }] : []),
    ...perched.map((d) => ({ key: d.key, hp: healthOf(d), d: d.id })),
  ];
  const b: Battle = { units, fighters: ds.map((d) => d.id) };
  const name = f ? faunaDef(f).name : dragonName(perched[0]);
  const foes = [...(f ? [`the ${name}`] : []), ...perched.map((d) => `${pname(d.owner)}'s ${dragonName(d)} (${d.id})`)].join(' and ');
  const first = coinFlip(g);
  const them = units.length > 1 ? 'the defenders' : f ? `the ${name}` : `${pname(perched[0].owner)}'s ${dragonName(perched[0])}`;
  log(g, `${pname(p)} sends ${ds.map((d) => d.id).join(' ')} against ${foes} at ${k}. ${firstText(first, them, units.length > 1)}`, {
    k: 'hunt', p, hex: k, fauna: f, name, hp: units[0].hp, ds: [...b.fighters], hps: ds.map(healthOf), units: units.map((u) => ({ name: unitDef(g, u).name, hp: u.hp, ...(u.d ? { d: u.d } : {}), el: unitDef(g, u).element })), first,
  });
  for (let round = 1; b.units.some((u) => u.hp > 0) && b.fighters.length; round++) combatRound(g, b, round, first);
  const won = b.units.every((u) => u.hp <= 0);
  const home = perched.filter((d) => !d.perch).map((d) => d.id);
  const loot = f ? faunaLoot(g, k) : {};
  if (won && f) {
    delete g.map[k].fauna;
    delete g.map[k].sent;
    gain(g.players[p], loot);
    if (great) g.slain[f] = p;
  }
  const flown = home.length ? ` ${home.join(' ')} ${home.length === 1 ? 'is' : 'are'} driven off and ${home.length === 1 ? 'goes' : 'go'} home.` : '';
  let text: string;
  if (!f) text = won ? `${pname(p)}'s dragons win at ${k}.${flown}` : `The dragons at ${k} hold. ${pname(p)}'s dragons fall back.${flown}`;
  else if (!won) text = `The ${name} at ${k} holds. ${pname(p)}'s dragons fall back.${flown}`;
  else if (great) text = `The ${name} is slain. ${pname(p)} scores ${great.points} point${great.points === 1 ? '' : 's'}, for good.${f === 'thunderbird' ? ` Buildings on and adjacent to its peak make ${TUNING.peakBonus} more.` : ''}`;
  else text = `The ${name} at ${k} falls.${Object.keys(loot).length ? ` ${pname(p)} gains ${bundleText(loot)}.` : ''}${flown}`;
  log(g, text, { k: 'cleared', p, hex: k, fauna: f, name, won, gain: won ? loot : {}, ...(great && won ? { points: great.points } : {}), ...(home.length ? { home } : {}) });
  return won;
}

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

// Auto clear: clear player p's own buildings one at a time, weakest first,
// each wave sending all p's raid-ready dragons, exactly as "clear" would. It
// stops when nothing is left to clear, no dragon is raid-ready, or a wave
// loses.
function autoClear(g: Game, p: number) {
  const ready = () => g.dragons.filter((d) => d.owner === p && canRaid(d));
  if (!autoClearTargets(g, p).length) fail(`Nothing holds your buildings: there's nothing to auto clear.`);
  if (!ready().length) fail(`You have no raid-ready dragon to send.`);
  for (;;) {
    const [k] = autoClearTargets(g, p);
    const ds = ready();
    if (!k || !ds.length) return;
    if (!clearHex(g, p, k, ds)) return;
  }
}

// ---------- commands ----------

function parseTradeSide(g: Game, tokens: string[]): TradeSide {
  const side: TradeSide = { res: {}, cards: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/,$/, '');
    if (!t) continue;
    if (/^c\d+$/.test(t)) side.cards.push(t);
    else if (/^\d+$/.test(t)) {
      const r = parseResource(tokens[++i]?.replace(/,$/, ''));
      side.res[r] = (side.res[r] ?? 0) + Number(t);
    } else fail(`Can't read "${t}" in a trade. Use amounts like "2 stone" and card ids like "c12".`);
  }
  return side;
}

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

function tradesNothing(s: TradeSide): boolean {
  return !s.cards.length && !Object.values(s.res).some((n) => n);
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

function moveTradeSide(g: Game, from: number, to: number, s: TradeSide) {
  pay(g.players[from], s.res);
  gain(g.players[to], s.res);
  for (const id of s.cards) {
    const i = g.players[from].hand.findIndex((c) => c.id === id);
    g.players[to].hand.push(...g.players[from].hand.splice(i, 1));
  }
}

function placeCheck(g: Game, p: number, type: string, hexArg: string | undefined): string {
  const def = BUILDINGS[type];
  if (def.onTower) return g.towers[p];
  const coords = parseKey(hexArg ?? '');
  if (!coords) fail(`Say where to build, as a hex like "2,-1".`);
  const k = key(...coords!);
  const hex = g.map[k];
  if (!hex) fail(`${k} is not on the map.`);
  if (hex.terrain === 'ocean') fail(`${k} is ocean; nothing is built on the ocean.`);
  if (g.buildings[k]) fail(`${k} already has a building.`);
  if (hex.fauna) fail(`A ${faunaDef(hex.fauna).name} holds ${k}: clear it first.`);
  if (nearBeast(g.map, k)) fail(`A great beast holds ${k} from an adjacent hex: slay it first.`);
  if (def.terrain && hex.terrain !== def.terrain) fail(`A ${def.name} must go on a ${TERRAIN_NOUN[def.terrain]}; ${k} is a ${TERRAIN_NOUN[hex.terrain]}.`);
  if (!neighbors(k).some((n) => g.buildings[n]?.owner === p && !blocked(g, n))) fail(`${k} isn't adjacent to any of your buildings.`);
  if (def.beside && !neighbourCount(g, k, def.beside)) fail(`A ${def.name} must go adjacent to ${besideText(def.beside)}; ${k} isn't.`);
  return k;
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

function placeBuilding(g: Game, p: number, type: string, k: string, project = false) {
  const def = BUILDINGS[type];
  if (def.onTower) {
    g.buildings[k].floors++;
    log(g, `${pname(p)} adds a floor to their tower (now ${g.buildings[k].floors})${project ? ' as a special project' : ''}.`, { k: 'floor', p, floors: g.buildings[k].floors, ...(project ? { project } : {}) });
  } else {
    g.buildings[k] = { type, owner: p, upgrade: null, floors: 0 };
    log(g, `${pname(p)} builds a ${def.name} at ${k}${project ? ' as a special project' : ''}.`, { k: 'build', p, b: type, name: def.name, hex: k, ...(project ? { project } : {}) });
  }
}

export function upgradeTargets(g: Game, p: number, up: string): string[] {
  return ownedBuildings(g, p)
    .filter(([, b]) => !b.upgrade && buildingClass(b).some((c) => UPGRADES[up].appliesTo.includes(c)))
    .map(([k]) => k)
    .sort();
}

// The hex an upgrade goes on, from what the player typed, or why it can't.
function upgradeCheck(g: Game, p: number, up: string, typed: string | undefined): string {
  const coords = parseKey(typed ?? '');
  const k = coords ? key(...coords) : '';
  const ok = upgradeTargets(g, p, up);
  if (!ok.includes(k)) fail(`${UPGRADES[up].name} can go on: ${ok.join(' ') || 'none of your buildings'}.`);
  return k;
}

function placeUpgrade(g: Game, p: number, up: string, k: string, project = false) {
  g.buildings[k].upgrade = up;
  const b = g.buildings[k];
  const name = UPGRADES[up].name;
  log(g, `${pname(p)} adds ${name} to their ${b.type === 'tower' ? 'Tower' : BUILDINGS[b.type].name} at ${k}${project ? ' as a special project' : ''}.`, { k: 'upgrade', p, u: up, name, on: b.type, hex: k, ...(project ? { project } : {}) });
}

// The upgrades a player may add without the card, as a special project.
export const PROJECT_UPGRADES = Object.keys(UPGRADES).filter((k) => UPGRADES[k].base);

export function specialProjectCost(cost: Bundle): Bundle {
  return scale(cost, TUNING.specialProjectMultiplier);
}

export const PROJECT_DRAGONS = Object.fromEntries(ELEMENTS.map((e) => [e, Object.keys(DRAGONS).find((k) => DRAGONS[k].base && DRAGONS[k].element === e)!])) as Record<Element, string>;

function hatch(g: Game, p: number, dragonKey: string, project = false) {
  const mine = g.dragons.filter((d) => d.owner === p).length;
  if (mine >= dragonCapacity(g, p)) fail(`No room for another dragon (${mine}/${dragonCapacity(g, p)}): build a roost first.`);
  const d: Dragon = { id: newId(g, 'd'), owner: p, key: dragonKey, stage: 0, growth: 0, damage: 0 };
  g.dragons.push(d);
  log(g, `${pname(p)} hatches an egg: ${dragonName(d)} (${d.id}), a ${DRAGONS[dragonKey].element} dragon${project ? ', as a special project' : ''}.`, { k: 'hatch', p, d: d.id, ...(project ? { project } : {}) });
}

function discardCard(g: Game, p: number, c: Card) {
  const hand = g.players[p].hand;
  hand.splice(hand.indexOf(c), 1);
  g.discards[c.deck].push(c);
}

function actionCommand(g: Game, p: number, verb: string, args: string[]) {
  const pl = g.players[p];
  if (verb === 'accept' || verb === 'decline') {
    const o = g.offers.find((x) => x.id === args[0]);
    if (!o || !offerFor(o, p)) fail(`There is no offer "${args[0] ?? ''}" made to you.`);
    if (verb === 'decline') {
      // An open offer stays open to the others until all of them decline it.
      if (o!.to === null) o!.passed = [...(o!.passed ?? []), p];
      if (o!.to !== null || g.players.every((_, i) => !offerFor(o!, i))) g.offers = g.offers.filter((x) => x !== o);
      return log(g, `${pname(p)} declines offer ${o!.id}.`, { k: 'decline', p, from: o!.from, give: tradeText(g, o!.give), get: tradeText(g, o!.get) });
    }
    const problem = acceptProblem(g, o!, p);
    if (problem) fail(problem);
    g.offers = g.offers.filter((x) => x !== o);
    const giveText = tradeText(g, o!.give), getText = tradeText(g, o!.get);
    moveTradeSide(g, o!.from, p, o!.give);
    moveTradeSide(g, p, o!.from, o!.get);
    return log(g, `${pname(p)} accepts offer ${o!.id}: ${pname(o!.from)} gives ${giveText} for ${getText}.`, { k: 'trade', from: o!.from, to: p, give: giveText, get: getText });
  }
  if (verb === 'offer') {
    // "anyone": an offer every other player may accept, made on your own turn.
    const to = ['anyone', 'everyone'].includes(args[0]?.toLowerCase() ?? '') ? null : parsePlayer(g, args[0]);
    if (to === p) fail(`You can't trade with yourself.`);
    if (p !== g.turn && to !== g.turn) fail(`Out of turn, you can only make offers to the acting player, ${pname(g.turn)}.`);
    const gi = args.indexOf('give'), ge = args.indexOf('get');
    if (gi !== 1 || ge < gi) fail(`Use: offer P2 give 2 stone c12 get 1 gold, or offer anyone give ...`);
    const o: Offer = { id: newId(g, 'o'), from: p, to, give: parseTradeSide(g, args.slice(gi + 1, ge)), get: parseTradeSide(g, args.slice(ge + 1)) };
    if (tradesNothing(o.give) && tradesNothing(o.get)) fail(`That trades nothing for nothing: give or get something.`);
    if (new Set([...o.give.cards, ...o.get.cards]).size < o.give.cards.length + o.get.cards.length) fail(`Name each card once.`);
    if (!hasTradeSide(g, p, o.give)) fail(`You don't have ${tradeText(g, o.give)}.`);
    // Gold is public, so an ask for more than they have is refused here; the
    // rest of what they hold is hidden, and is checked when they answer.
    const gold = to === null ? Math.max(...g.players.filter((_, i) => i !== p).map((x) => x.resources.gold)) : g.players[to].resources.gold;
    if ((o.get.res.gold ?? 0) > gold) fail(to === null ? `No other player has more than ${gold} gold.` : `${pname(to)} has ${gold} gold.`);
    if (to === null) o.passed = [];
    g.offers.push(o);
    return log(g, `${pname(p)} offers ${to === null ? 'anyone' : pname(to)} (${o.id}): ${tradeText(g, o.give)} for ${tradeText(g, o.get)}.`, { k: 'offer', p, to });
  }
  if (verb === 'cancel') {
    const o = g.offers.find((x) => x.id === args[0] && x.from === p);
    if (!o) fail(`You have no open offer "${args[0] ?? ''}".`);
    g.offers = g.offers.filter((x) => x !== o);
    return log(g, `${pname(p)} withdraws offer ${o!.id}.`, { k: 'withdraw', p });
  }
  if (p !== g.turn) fail(`It's ${pname(g.turn)}'s turn. Out of turn you can only offer, accept, decline or cancel trades.`);
  switch (verb) {
    case 'end': {
      // An offer made to you gets an answer from you, not from the clock.
      const open = g.offers.filter((o) => offerFor(o, p));
      if (open.length) fail(`Answer ${open.map((o) => `${pname(o.from)}'s offer ${o.id}`).join(' and ')} first: accept or decline.`);
      log(g, `${pname(p)} ends their turn.`, { k: 'end', p });
      return endTurn(g);
    }
    case 'merchants':
    case 'bank': { // "bank" is the old name, still accepted
      const give = parseResource(args[0]), get = parseResource(args[1]);
      const times = args[2] ? Number(args[2]) : 1;
      if (give === 'gold' || get === 'gold') fail(`The merchants don't trade gold.`);
      if (give === get) fail(`Trade two different resources.`);
      if (!Number.isInteger(times) || times < 1) fail(`Times must be a whole number.`);
      const rate = bankRates(g, p)[give as BasicResource];
      pay(pl, { [give]: rate * times });
      gain(pl, { [get]: times });
      return log(g, `${pname(p)} trades ${rate * times} ${give} to the merchants for ${times} ${get}.`, { k: 'bank', p, give: { [give]: rate * times }, get: { [get]: times } });
    }
    case 'build': {
      // A basic building by name, or a building card from hand.
      const basic = BASIC_BUILDINGS.find((b) => b === args[0]);
      if (basic) {
        const k = placeCheck(g, p, basic, args[1]);
        pay(pl, BUILDINGS[basic].cost);
        return placeBuilding(g, p, basic, k);
      }
      if (!pl.hand.some((c) => c.id === args[0])) fail(`Build a card from your hand (like "build c12 2,-1") or a basic building: ${BASIC_BUILDINGS.join(', ')}.`);
      const c = handCard(g, p, args[0]);
      if (cardKind(c) !== 'building') fail(`${cardName(c)} is not a building card.`);
      const k = placeCheck(g, p, c.key, args[1]);
      pay(pl, BUILDINGS[c.key].cost);
      discardCard(g, p, c);
      return placeBuilding(g, p, c.key, k);
    }
    case 'upgrade': {
      const c = handCard(g, p, args[0]);
      if (cardKind(c) !== 'upgrade') fail(`${cardName(c)} is not an upgrade card.`);
      const k = upgradeCheck(g, p, c.key, args[1]);
      pay(pl, UPGRADES[c.key].cost);
      discardCard(g, p, c);
      return placeUpgrade(g, p, c.key, k);
    }
    case 'clear': {
      const coords = parseKey(args[0] ?? '');
      const k = coords ? key(...coords) : '';
      if (!g.map[k]?.fauna && !rivalsPerched(g, p, k).length) fail(`There is no beast or rival dragon at "${args[0] ?? ''}". Clear: ${huntable(g, p).join(' ') || 'nowhere'}.`);
      const ids = [...new Set(args.slice(1))];
      if (!ids.length) fail(`Send at least one dragon: clear ${k} d1 d4`);
      const ds = ids.map((id) => ownDragon(g, p, id));
      for (const d of ds) if (!canRaid(d)) fail(`${d.id} can't fight (it must be hatched, not knocked out, and not perched).`);
      clearHex(g, p, k, ds);
      return;
    }
    case 'autoclear':
      return autoClear(g, p);
    case 'perch': {
      const coords = parseKey(args[0] ?? '');
      const k = coords ? key(...coords) : '';
      if (!perchHexes(g, p).includes(k)) fail(`Perch on a rival's building (not a tower), like "perch 2,-1 d3". Rivals' buildings: ${perchHexes(g, p).join(' ') || 'none'}.`);
      const ids = [...new Set(args.slice(1))];
      if (!ids.length) fail(`Send at least one dragon: perch ${k} d1 d4`);
      const ds = ids.map((id) => ownDragon(g, p, id));
      for (const d of ds) if (!canRaid(d)) fail(`${d.id} can't perch (it must be hatched, not knocked out, and not perched).`);
      for (const d of ds) d.perch = k;
      const b = g.buildings[k];
      return log(g, `${pname(p)}'s ${ids.join(' ')} ${ids.length === 1 ? 'perches' : 'perch'} on ${pname(b.owner)}'s ${BUILDINGS[b.type].name} at ${k}: it's suppressed while they stay.`, { k: 'perch', p, hex: k, ds: ids, on: b.type, owner: b.owner });
    }
    case 'recall': {
      const ids = [...new Set(args)];
      if (!ids.length) fail(`Recall a perched dragon: recall d3`);
      const ds = ids.map((id) => ownDragon(g, p, id));
      for (const d of ds) if (!d.perch) fail(`${d.id} isn't perched.`);
      for (const d of ds) delete d.perch;
      return log(g, `${pname(p)} recalls ${ids.join(' ')} home.`, { k: 'recall', p, ds: ids });
    }
    case 'project': {
      const what = args[0] ?? '';
      const el = ELEMENTS.find((e) => e === what);
      if (el) {
        const dk = PROJECT_DRAGONS[el];
        if (g.dragons.filter((d) => d.owner === p).length >= dragonCapacity(g, p)) fail(`No room for another dragon: build a roost first.`);
        pay(pl, specialProjectCost(DRAGONS[dk].cost));
        return hatch(g, p, dk, true);
      }
      if (UPGRADES[what]?.base) {
        const k = upgradeCheck(g, p, what, args[1]);
        pay(pl, specialProjectCost(UPGRADES[what].cost));
        return placeUpgrade(g, p, what, k, true);
      }
      return fail(`A special project is a base dragon egg of an element (${ELEMENTS.join(', ')}) or ${orList(PROJECT_UPGRADES.map((u) => `a ${UPGRADES[u].name}`))} on one of your buildings, like "project ${PROJECT_UPGRADES[0]} 2,-1".`);
    }
    case 'play': {
      const c = handCard(g, p, args[0]);
      const kind = cardKind(c);
      if (kind === 'dragon') {
        if (g.dragons.filter((d) => d.owner === p).length >= dragonCapacity(g, p)) fail(`No room for another dragon: build a roost first.`);
        pay(pl, DRAGONS[c.key].cost);
        discardCard(g, p, c);
        return hatch(g, p, c.key);
      }
      if (kind !== 'action') fail(`${cardName(c)} is played with "${kind === 'building' ? 'build' : 'upgrade'}".`);
      const def = ACTIONS[c.key];
      let what = '';
      const ev: GameEvent = { k: 'play', p, card: c.key, name: def.name };
      switch (def.effect) {
        case 'hidden_point':
          return fail(`${def.name} isn't played; it scores while it stays in your hand.`);
        case 'gain_resource': {
          const r = parseResource(args[1]);
          if (r === 'gold') fail(`${def.name} can't give gold.`);
          pay(pl, def.cost);
          gain(pl, { [r]: def.amount });
          what = `gains ${def.amount} ${r}`;
          ev.gain = { [r]: def.amount };
          break;
        }
        case 'gain_gold':
          pay(pl, def.cost);
          gain(pl, { gold: def.amount });
          what = `gains ${def.amount} gold`;
          ev.gain = { gold: def.amount };
          break;
        case 'grow_dragon': {
          const d = ownDragon(g, p, args[1]);
          if (d.stage === 3) fail(`${d.id} is already an adult.`);
          pay(pl, def.cost);
          d.stage++;
          d.growth = 0;
          ev.d = d.id;
          what = `grows ${dragonName(d)} (${d.id}) into ${['an egg', 'a hatchling', 'a young dragon', 'an adult'][d.stage]}`;
          break;
        }
        case 'heal_dragon': {
          const d = ownDragon(g, p, args[1]);
          if (d.damage === 0) fail(`${d.id} isn't hurt.`);
          pay(pl, def.cost);
          d.damage = 0;
          ev.d = d.id;
          what = `heals ${d.id}`;
          break;
        }
        case 'send_fauna': {
          const coords = parseKey(args[1] ?? '');
          const k = coords ? key(...coords) : '';
          if (!faunaHexes(g).includes(k)) fail(`Say where to place the ${FAUNA[def.fauna!].name}: a land hex with no tower or beast, like "play ${c.id} 2,-1".`);
          pay(pl, def.cost);
          g.map[k].fauna = def.fauna!;
          g.map[k].sent = true;
          ev.hex = k;
          ev.fauna = def.fauna!;
          const b = g.buildings[k];
          what = `places a ${FAUNA[def.fauna!].name} on ${k}${b ? `, on ${pname(b.owner)}'s ${BUILDINGS[b.type].name}` : ''}`;
          break;
        }
        case 'extra_raid':
          pay(pl, def.cost);
          g.raidsLeft++;
          ev.raids = g.raidsLeft;
          what = `sounds the horn: ${g.raidsLeft} raids this round`;
          break;
      }
      discardCard(g, p, c);
      return log(g, `${pname(p)} plays ${def.name} and ${what}.`, ev);
    }
  }
  fail(`Unknown action "${verb}". Try: build, upgrade, project, play, clear, autoclear, perch, recall, merchants, offer, accept, decline, cancel, end.`);
}

function raidCommand(g: Game, p: number, verb: string, args: string[]) {
  const raid = g.raid!;
  if (raid.step === 'vote') {
    if (!canVote(g, p)) fail(NO_VOTE);
    if (verb !== 'vote') fail(`Vote for the raid target: vote 1..${raid.candidates.length}.`);
    if (raid.votes[p] !== null) fail(`You already voted.`);
    const i = Number(args[0]) - 1;
    if (!(i >= 0 && i < raid.candidates.length)) fail(`Vote 1..${raid.candidates.length}.`);
    raid.votes[p] = i;
    log(g, `${pname(p)} votes for ${TARGETS[raid.candidates[i]].name}.`, { k: 'voted', p, t: raid.candidates[i] });
    if (raid.votes.every((v, q) => v !== null || !canVote(g, q))) resolveVote(g);
    return;
  }
  if (raid.step === 'commit') {
    if (raid.ready[p]) fail(`You're already locked in.`);
    if (verb === 'commit') {
      const ids = args.filter((a) => a !== 'none');
      for (const id of ids) {
        const d = ownDragon(g, p, id);
        if (!canRaid(d)) fail(`${id} can't raid (it must be hatched, not knocked out, and not perched).`);
      }
      raid.commits[p] = [...new Set(ids)];
      return log(g, `${pname(p)} commits ${ids.length ? ids.join(' ') : 'nothing'}.`, { k: 'commit', p, ds: raid.commits[p] });
    }
    if (verb === 'ready') {
      raid.ready[p] = true;
      log(g, `${pname(p)} is ready with ${raid.commits[p].join(' ') || 'nothing'} committed.`, { k: 'commit', p, ds: raid.commits[p], ready: true });
      if (raid.ready.every(Boolean)) resolveCommit(g);
      return;
    }
    return fail(`Commit dragons with "commit d1 d4" (or "commit none"), then "ready".`);
  }
  if (raid.step === 'choose') {
    if (!raid.commits[p].length) fail(`You aren't in this raid.`);
    if (raid.choices[p]) fail(`You already chose.`);
    if (verb !== 'fight' && verb !== 'hold') fail(`Choose "fight" or "hold".`);
    raid.choices[p] = verb as 'fight' | 'hold';
    log(g, `You choose to ${verb === 'hold' ? 'hold back' : 'fight'}.`, { k: 'mine' }, { to: [p] });
    if (raid.commits.every((c, q) => !c.length || raid.choices[q])) resolveChoices(g);
  }
}

function cardsCommand(g: Game, p: number, verb: string, args: string[]) {
  const pl = g.players[p];
  if (!pl.choice.length) fail(`You've kept your card; waiting on the others.`);
  if (verb !== 'keep') fail(`Keep one of the building cards you drew: keep ${pl.choice.map((c) => c.id).join(' or ')}.`);
  const c = pl.choice.find((x) => x.id === args[0]) ?? fail(`Keep one of ${pl.choice.map((c) => `${cardName(c)} (${c.id})`).join(', ')}.`);
  keepCard(g, p, c);
  log(g, `${pname(p)} keeps a building card.`, { k: 'keep', p });
  if (g.players.every((x) => !x.choice.length)) startActions(g);
}

function discardCommand(g: Game, p: number, verb: string, args: string[]) {
  const pl = g.players[p];
  const over = pl.hand.length - TUNING.handCap;
  if (over <= 0) fail(`You don't need to discard.`);
  if (verb !== 'discard') fail(`Discard ${nCards(over)} first, like "discard ${pl.hand.slice(0, over).map((c) => c.id).join(' ')}".`);
  const ids = [...new Set(args)];
  if (ids.length !== over) fail(`Discard exactly ${nCards(over)}, like "discard ${pl.hand.slice(0, over).map((c) => c.id).join(' ')}": you hold ${pl.hand.length} and the hand limit is ${TUNING.handCap}.`);
  const cards = ids.map((id) => handCard(g, p, id));
  for (const c of cards) discardCard(g, p, c);
  log(g, `${pname(p)} discards ${nCards(ids.length)}.`, { k: 'discard', p, n: ids.length });
  maybeEndRound(g);
}

// Table talk: allowed any time, by anyone, and binds no one (only accepted
// offers do). "say" is heard by everyone, "tell P2" only by P2.
const MAX_TALK = 500;
function talk(g: Game, p: number, verb: string, rest: string) {
  let to: number[] | undefined;
  if (verb === 'tell') {
    const m = /^p(\d+)\s*(.*)$/is.exec(rest);
    const q = Number(m?.[1]) - 1;
    if (m && q === p) fail(`You can't tell yourself.`);
    if (!m || !(q >= 0 && q < g.players.length)) fail(`Tell whom? e.g. "tell P2 want my timber?"`);
    to = [p, q];
    rest = m![2].trim();
  }
  const text = rest.replace(/\s+/g, ' ');
  if (!text) fail(`Say what?`);
  if (text.length > MAX_TALK) fail(`Keep it under ${MAX_TALK} characters.`);
  log(g, to ? `${pname(p)} to ${pname(to[1])} (private): "${text}"` : `${pname(p)} says: "${text}"`, { k: 'talk' }, { to });
}

export function apply(g: Game, p: number, command: string): void {
  if (g.phase === 'over') fail(`The game is over.`);
  if (!(p >= 0 && p < g.players.length)) fail(`No such player.`);
  const [verb = '', ...args] = command.trim().split(/\s+/);
  const v = verb.toLowerCase();
  if (v === 'say' || v === 'tell') return talk(g, p, v, command.trim().slice(verb.length).trim());
  // A refused command changes nothing. The log only ever grows, so it is cut
  // back rather than copied: copying it on every command made long games slow.
  const { log: _, ...rest } = g;
  const snapshot = structuredClone(rest);
  const logged = g.log.length;
  try {
    if (v === 'discard' && g.phase !== 'discard') fail(`Discard at the end of the round, after the raids, if you hold more than ${TUNING.handCap} cards.`);
    if (g.phase === 'cards') cardsCommand(g, p, v, args);
    else if (g.phase === 'action') actionCommand(g, p, v, args);
    else if (g.phase === 'raid') raidCommand(g, p, v, args);
    else discardCommand(g, p, v, args);
    updateTitles(g);
  } catch (e) {
    Object.assign(g, snapshot);
    g.log.length = logged;
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
  if (raid.step === 'commit') return all.filter((p) => !raid.ready[p]);
  return all.filter((p) => raid.commits[p].length && !raid.choices[p]);
}
