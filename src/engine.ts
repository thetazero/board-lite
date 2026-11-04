// The rules engine. A game is a plain JSON-serialisable object; every player
// decision goes through apply(game, player, command).

import {
  ACTIONS, BASIC_BUILDINGS, BEASTS, BUILDINGS, DRAGONS, ELEMENTS, FAUNA, RESOURCES, TARGETS, TERRAIN_NOUN, TOWER_CLASSES, TUNING, UNITS, UPGRADES, combatPower, faunaDef,
  type Attack, type BuildingClass, type BuildingDef, type Bundle, type Counted, type DragonStage, type Element, type Resource, type UnitDef,
} from './data.ts';
import { PEAK, generateMap, key, nearBeast, neighbors, parseKey, towerSpots, type Hex } from './map.ts';
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
  damage: number;
  // Why the dragon sits out this round's raids: it was hungry (and doesn't
  // grow) or hurt at production, or it already fought fauna this round.
  resting: '' | 'hungry' | 'hurt' | 'hunted';
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
  to: number;
  give: TradeSide; // what `from` gives
  get: TradeSide; // what `from` receives
}

export interface Raid {
  step: 'vote' | 'commit' | 'bail';
  candidates: string[];
  votes: (number | null)[];
  target: string | null;
  commits: string[][];
  ready: boolean[];
  choices: ('fight' | 'bail' | null)[];
  units: { key: string; hp: number }[];
  fighters: string[];
}

export interface Die {
  sides: number;
  value: number;
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
export interface Hit { d: string; u: number; by: 'dragon' | 'unit'; dmg: number; down: boolean }

// The log's events as data. The text is for the CLI and Claude players; the
// TV and phones draw these instead.
export type GameEvent =
  | { k: 'round'; n: number }
  | { k: 'produce'; p: number; got: Bundle }
  | { k: 'rest'; d: string; why: 'hungry' | 'hurt' }
  | { k: 'grow'; d: string; stage: number }
  | { k: 'draw'; p: number; n: number }
  | { k: 'pick' } // everyone keeps one of the building cards they drew
  | { k: 'keep'; p: number }
  | { k: 'turn'; p: number }
  | { k: 'build'; p: number; b: string; name: string; hex: string; project?: boolean }
  | { k: 'floor'; p: number; floors: number; project?: boolean }
  | { k: 'upgrade'; p: number; u: string; name: string; on: string; hex: string }
  | { k: 'hatch'; p: number; d: string; project?: boolean }
  | { k: 'play'; p: number; card: string; name: string; gain?: Bundle; d?: string; raids?: number; hex?: string; fauna?: string }
  | { k: 'hunt'; p: number; hex: string; fauna: string; name: string; ds: string[] } // a player's dragons attack fauna
  | { k: 'cleared'; p: number; hex: string; fauna: string; name: string; won: boolean; gain: Bundle; points?: number }
  | { k: 'bank'; p: number; give: Bundle; get: Bundle }
  | { k: 'offer'; p: number; to: number }
  | { k: 'trade'; from: number; to: number; give: string; get: string }
  | { k: 'decline'; p: number; from: number }
  | { k: 'withdraw'; p: number }
  | { k: 'expire' }
  | { k: 'end'; p: number }
  | { k: 'title'; t: Title; p: number | null }
  | { k: 'discard'; p: number; n: number }
  | { k: 'raid'; targets: string[] }
  | { k: 'voted'; p: number }
  | { k: 'votes'; votes: (number | null)[] }
  | { k: 'target'; t: string; name: string; votes: number[]; coin: boolean }
  | { k: 'commit'; p: number; ds: string[]; ready?: boolean }
  | { k: 'locked'; ps: number[] }
  | { k: 'bail'; p: number }
  | { k: 'fight'; ps: number[]; t: string; name: string; ds: string[]; units: { name: string; hp: number }[] }
  | { k: 'combat'; round: number; hits: Hit[] }
  | { k: 'raidEnd'; t: string; name: string; won: boolean; winners: number[]; shares: Bundle[]; power: number[] } // shares and power line up with winners
  | { k: 'noRaid'; why: 'nobody' | 'bailed' }
  | { k: 'again' }
  | { k: 'begin'; players: number }
  | { k: 'final'; totals: number[]; winner: number }
  | { k: 'talk' }
  | { k: 'mine' }; // a private line for the player it went to

export type Title = 'army' | 'tower';
export const TITLE_NAMES: Record<Title, string> = { army: 'Strongest Dragon Army', tower: 'Tallest Tower' };

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

function pay(pl: Player, cost: Bundle) {
  if (!canAfford(pl, cost)) fail(`You can't afford ${bundleText(cost)}.`);
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

export function canRaid(d: Dragon): boolean {
  return d.stage > 0 && !d.resting && d.damage === 0;
}

// The round a hurt dragon can raid again: it heals at each production and
// sits out every round it starts hurt.
export function backInRound(g: Game, d: Dragon): number {
  return g.round + Math.ceil(d.damage / TUNING.healPerRound) + 1;
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

function ownedBuildings(g: Game, p: number): [string, Building][] {
  return Object.entries(g.buildings).filter(([, b]) => b.owner === p);
}

export function buildingClass(b: Building): BuildingClass[] {
  return b.type === 'tower' ? TOWER_CLASSES : [BUILDINGS[b.type].class];
}

// Does this hex count for an effect that counts `what`? Its terrain does, and
// so does the class of any building on it, whoever owns it.
function counts(g: Game, k: string, what: Counted): boolean {
  const b = g.buildings[k];
  return g.map[k]?.terrain === what || (!!b && buildingClass(b).includes(what as BuildingClass));
}

// How many of hex k's neighbours count for `what`.
export function neighbourCount(g: Game, k: string, what: Counted): number {
  return neighbors(k).filter((n) => counts(g, n, what)).length;
}

// The multiplier on a building's effects at hex k: 1, or its neighbour count.
function times(g: Game, k: string, def: BuildingDef): number {
  return def.per ? neighbourCount(g, k, def.per) : 1;
}

// The building types other than the tower, with their hex and multiplier.
function placed(g: Game, p: number): { k: string; b: Building; def: BuildingDef; n: number }[] {
  return ownedBuildings(g, p).filter(([, b]) => b.type !== 'tower').map(([k, b]) => ({ k, b, def: BUILDINGS[b.type], n: times(g, k, BUILDINGS[b.type]) }));
}

export function dragonCapacity(g: Game, p: number): number {
  let cap = TUNING.towerDragonCapacity;
  for (const { def, n } of placed(g, p)) cap += (def.dragonCapacity ?? 0) * n;
  for (const [, b] of ownedBuildings(g, p)) if (b.upgrade) cap += UPGRADES[b.upgrade].dragonCapacity ?? 0;
  return cap;
}

export function bankRate(g: Game, p: number): number {
  let rate = TUNING.bankRate;
  for (const { def } of placed(g, p)) rate = Math.min(rate, def.bankRate ?? rate);
  return rate;
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

// Points a building at hex k is worth right now. Only point cards (monuments)
// are worth any; the tower and its floors are not.
export function buildingPoints(g: Game, k: string): number {
  const b = g.buildings[k];
  if (b.type === 'tower') return 0;
  return (BUILDINGS[b.type].points ?? 0) * times(g, k, BUILDINGS[b.type]);
}

// Is hex k on or next to the peak, once the Thunderbird has fallen?
export function onPeak(g: Game, k: string): boolean {
  return g.slain.thunderbird !== undefined && (k === PEAK || neighbors(PEAK).includes(k));
}

// Public production: fixed amount plus a list of dice, per resource.
export function production(g: Game, p: number): Record<Resource, { base: number; dice: number[] }> {
  const out = Object.fromEntries(RESOURCES.map((r) => [r, { base: 0, dice: [] as number[] }])) as Record<Resource, { base: number; dice: number[] }>;
  for (const r of RESOURCES) out[r].base += TUNING.towerProduction[r] ?? 0;
  for (const { k, b, def, n } of placed(g, p)) {
    if (g.map[k]?.fauna) continue; // a building under fauna produces nothing
    const up = b.upgrade ? UPGRADES[b.upgrade] : null;
    if (def.produces) {
      out[def.produces.resource].base += def.produces.base;
      out[def.produces.resource].dice.push(def.produces.die);
    }
    for (const r of RESOURCES) out[r].base += (def.makes?.[r] ?? 0) * n + (up?.makes?.[r] ?? 0);
    const made = madeResource(def);
    if (made && up?.baseBonus) out[made].base += up.baseBonus;
    if (made && onPeak(g, k)) out[made].base += TUNING.peakBonus;
  }
  return out;
}

function titleValue(g: Game, p: number, t: Title): number {
  if (t === 'army') return g.dragons.filter((d) => d.owner === p).reduce((s, d) => s + TUNING.dragonPointsByStage[d.stage], 0);
  return g.buildings[g.towers[p]].floors;
}

export function titleValues(g: Game, t: Title): number[] {
  return g.players.map((_, p) => titleValue(g, p, t));
}

// A title goes to the single strict leader, once they reach its minimum; the
// holder keeps it on a tie.
function updateTitles(g: Game) {
  for (const t of Object.keys(g.titles) as Title[]) {
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
  dragons: number;
  buildings: number;
  titles: number;
  beasts: number; // great beasts slain
  hidden: number;
  public: number;
  total: number;
}

export function score(g: Game, p: number): Score {
  const dragons = g.dragons.filter((d) => d.owner === p).reduce((s, d) => s + TUNING.dragonPointsByStage[d.stage], 0);
  let buildings = 0;
  for (const [k] of ownedBuildings(g, p)) buildings += buildingPoints(g, k);
  const titles = (Object.values(g.titles).filter((h) => h === p).length) * TUNING.titlePoints;
  const hidden = g.players[p].hand.filter((c) => ACTIONS[c.key]?.effect === 'hidden_point').length;
  const beasts = Object.entries(g.slain).filter(([, by]) => by === p).reduce((s, [k]) => s + BEASTS[k].points, 0);
  const pub = dragons + buildings + titles + beasts;
  return { dragons, buildings, titles, beasts, hidden, public: pub, total: pub + hidden };
}

// ---------- setup ----------

function buildDeck(g: Game, deck: 'building' | 'action'): Card[] {
  const defs: Record<string, { copies?: number }>[] = deck === 'building' ? [BUILDINGS, UPGRADES] : [ACTIONS, DRAGONS];
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
    titles: { army: null, tower: null },
    slain: {},
    beastTried: Array(players).fill(0),
    winner: null,
    nextId: 1,
    log: [],
    rng,
  };
  g.decks.building = buildDeck(g, 'building');
  g.decks.action = buildDeck(g, 'action');
  const baseDragons = Object.keys(DRAGONS).filter((k) => DRAGONS[k].base);
  for (let p = 0; p < players; p++) {
    const resources = Object.fromEntries(RESOURCES.map((r) => [r, TUNING.startingResources[r] ?? 0])) as Record<Resource, number>;
    g.players.push({ resources, hand: [], choice: [] });
    g.buildings[g.towers[p]] = { type: 'tower', owner: p, upgrade: null, floors: 0 };
    g.dragons.push({ id: newId(g, 'd'), owner: p, key: pick(g.rng, baseDragons), stage: TUNING.startingDragonStage, growth: 0, damage: 0, resting: '' });
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
  for (const p of turnOrder(g)) {
    const prod = production(g, p);
    const got: Bundle = {};
    const dice: Die[] = [];
    for (const r of RESOURCES) {
      got[r] = prod[r].base;
      for (const sides of prod[r].dice) {
        const value = roll(g.rng, sides);
        dice.push({ sides, value });
        got[r]! += value;
      }
    }
    gain(g.players[p], got);
    log(g, `${pname(p)} produces ${bundleText(got)}.`, { k: 'produce', p, got }, { dice });
  }
  // Every dragon eats, and a hurt one heals some. One that was hungry or hurt
  // sits out the round's raids; only hunger stops it growing.
  for (const d of g.dragons) {
    const pl = g.players[d.owner];
    const hurt = d.damage > 0;
    d.damage = Math.max(0, d.damage - TUNING.healPerRound);
    const fed = pl.resources.livestock >= TUNING.livestockPerDragon;
    if (fed) pl.resources.livestock -= TUNING.livestockPerDragon;
    d.resting = !fed ? 'hungry' : hurt ? 'hurt' : '';
    if (d.resting) log(g, `${pname(d.owner)}'s ${dragonName(d)} (${d.id}) ${fed ? 'is healing and sits out this round\'s raids' : 'goes hungry: it doesn\'t grow and sits out this round\'s raids'}.`, { k: 'rest', d: d.id, why: fed ? 'hurt' : 'hungry' });
    if (!fed) continue;
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
  for (const o of g.offers) log(g, `Offer ${o.id} expires.`, { k: 'expire' });
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
    log(g, 'No one has a raid-ready dragon: no raid this round.', { k: 'noRaid', why: 'nobody' });
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

function resolveVote(g: Game) {
  const raid = g.raid!;
  const counts = raid.candidates.map((_, i) => raid.votes.filter((v) => v === i).length);
  const best = Math.max(...counts);
  const tied = raid.candidates.filter((_, i) => counts[i] === best);
  raid.target = tied.length > 1 ? pick(g.rng, tied) : tied[0];
  const target: GameEvent = { k: 'target', t: raid.target, name: TARGETS[raid.target].name, votes: counts, coin: tied.length > 1 };
  log(g, `Votes: ${raid.votes.map((v, p) => `${pname(p)}→${TARGETS[raid.candidates[v!]].name}`).join(', ')}.`, { k: 'votes', votes: [...raid.votes] });
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
  log(g, `Commitments lock in: ${committed.map((p) => `${pname(p)} (${raid.commits[p].join(' ')})`).join(', ')}. Each now secretly chooses to fight or bail.`, { k: 'locked', ps: committed });
  raid.step = 'bail';
}

function resolveBail(g: Game) {
  const raid = g.raid!;
  const fighters: number[] = [];
  for (let p = 0; p < g.players.length; p++) {
    if (raid.choices[p] === 'fight') fighters.push(p);
    if (raid.choices[p] === 'bail') log(g, `${pname(p)} bails.`, { k: 'bail', p });
  }
  if (fighters.length === 0) {
    log(g, 'Everyone bails. The raid is off.', { k: 'noRaid', why: 'bailed' });
    return finishRaid(g);
  }
  raid.fighters = fighters.flatMap((p) => raid.commits[p]);
  raid.units = TARGETS[raid.target!].units.map((k) => ({ key: k, hp: UNITS[k].hp }));
  log(g, `Fighting: ${fighters.map(pname).join(', ')}. The attack on ${TARGETS[raid.target!].name} begins.`, { k: 'fight', ps: fighters, t: raid.target!, name: TARGETS[raid.target!].name, ds: [...raid.fighters], units: raid.units.map((u) => ({ name: UNITS[u.key].name, hp: u.hp })) });
  // No retreat: the fight goes on until every defender falls or every dragon is knocked out.
  for (let round = 1; !checkRaidOver(g); round++) combatRound(g, raid, round);
}

function rollAttack(g: Game, a: Attack): number {
  let sum = 0;
  for (let i = 0; i < a.dice; i++) sum += roll(g.rng, a.sides);
  return sum;
}

// One fight: dragons against foes (a raid's defenders, or one beast of the
// fauna). The raid keeps its fight in g.raid; clearing fauna uses its own.
interface Battle {
  units: { key: string; hp: number }[];
  fighters: string[];
}

function pickTargets(g: Game, b: Battle, d: Dragon, n: number): number[] {
  const alive = b.units.flatMap((u, i) => (u.hp > 0 ? [i] : []));
  const rule = DRAGONS[d.key].targeting;
  let order = shuffle(g.rng, alive.slice());
  if (rule === 'lowest_health') order.sort((x, y) => b.units[x].hp - b.units[y].hp);
  if (rule === 'strongest_attacker') {
    const power = (i: number) => { const u = foeDef(b.units[i].key); return u.targets * u.dice * (u.sides + 1); };
    order.sort((x, y) => power(y) - power(x));
  }
  if (rule === 'weak_to_me') {
    const weak = (i: number) => (foeDef(b.units[i].key).weak.includes(DRAGONS[d.key].element) ? 0 : 1);
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

function combatRound(g: Game, b: Battle, round: number) {
  const lines: string[] = [];
  const hits: Hit[] = [];
  // Dragons strike first.
  for (const id of b.fighters) {
    const d = dragonById(g, id);
    const st = stageStats(d)!;
    for (const ui of pickTargets(g, b, d, st.targets)) {
      const u = b.units[ui];
      const def = foeDef(u.key);
      let dmg = rollAttack(g, st);
      const el = DRAGONS[d.key].element;
      if (def.weak.includes(el)) dmg *= 2;
      else if (def.strong.includes(el)) dmg = Math.max(1, Math.floor(dmg / 2));
      u.hp = Math.max(0, u.hp - dmg);
      lines.push(`${d.id} hits ${def.name} #${ui + 1} for ${dmg}${u.hp === 0 ? ' (defeated)' : ''}`);
      hits.push({ d: d.id, u: ui, by: 'dragon', dmg, down: u.hp === 0 });
    }
  }
  // Then the defenders.
  for (const [ui, u] of b.units.entries()) {
    if (u.hp <= 0) continue;
    const def = foeDef(u.key);
    for (let t = 0; t < def.targets && b.fighters.length; t++) {
      const d = dragonById(g, pick(g.rng, b.fighters));
      const dmg = rollAttack(g, def);
      d.damage += dmg;
      const down = knockedOut(b, d);
      lines.push(`${def.name} #${ui + 1} hits ${d.id} for ${dmg}${down ? ' (knocked out, limps home)' : ''}`);
      hits.push({ d: d.id, u: ui, by: 'unit', dmg, down });
    }
  }
  log(g, `Combat round ${round}: ${lines.join('; ')}.`, { k: 'combat', round, hits });
}

export function unitsText(g: Game): string {
  return g.raid!.units.map((u, i) => `${UNITS[u.key].name} #${i + 1} ${u.hp}/${UNITS[u.key].hp}hp`).join(', ');
}

function checkRaidOver(g: Game): boolean {
  const raid = g.raid!;
  if (raid.units.every((u) => u.hp <= 0)) {
    // Loot is split by the combat power each player still has fighting.
    const power = g.players.map((_, p) => raid.fighters.reduce((s, id) => { const d = dragonById(g, id); return s + (d.owner === p ? dragonPower(d) : 0); }, 0));
    const total = power.reduce((s, x) => s + x, 0);
    const winners = g.players.flatMap((_, p) => (power[p] ? [p] : []));
    const loot = lootOf(g, raid.target!);
    const shares: Bundle[] = g.players.map(() => ({}));
    // Each resource is split in proportion, rounded down; what's left over goes
    // to the player with the most power standing (the earlier seat on a tie).
    const top = winners.reduce((a, b) => (power[b] > power[a] ? b : a));
    for (const r of RESOURCES) {
      if (!loot[r]) continue;
      let left = loot[r]!;
      for (const p of winners) { const n = Math.floor((loot[r]! * power[p]) / total); if (n) shares[p][r] = n; left -= n; }
      if (left) shares[top][r] = (shares[top][r] ?? 0) + left;
    }
    for (const p of winners) gain(g.players[p], shares[p]);
    const take = winners.map((p) => `${pname(p)} (power ${power[p]}) takes ${bundleText(shares[p]) || 'nothing'}`).join('; ');
    log(g, `${TARGETS[raid.target!].name} falls. ${take}.`, { k: 'raidEnd', t: raid.target!, name: TARGETS[raid.target!].name, won: true, winners, shares: winners.map((p) => shares[p]), power: winners.map((p) => power[p]) });
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

// A player's dragons attack the beast on hex k, in a raid's combat, to the
// end. Each sits out this round's raids. If the beast falls, the hex is free
// and its loot (and a great beast's points, for good) goes to the player; if
// not, it stays, healed. A player gets one try at a great beast a round.
function clearFauna(g: Game, p: number, k: string, ds: Dragon[]) {
  const f = g.map[k].fauna!;
  const def = faunaDef(f);
  const great = BEASTS[f];
  if (great) {
    if (g.beastTried[p] === g.round) fail(`You've fought a great beast this round already: 1 try each round.`);
    g.beastTried[p] = g.round;
  }
  for (const d of ds) d.resting = 'hunted';
  const b: Battle = { units: [{ key: f, hp: def.hp }], fighters: ds.map((d) => d.id) };
  log(g, `${pname(p)} sends ${ds.map((d) => d.id).join(' ')} against the ${def.name} at ${k}.`, { k: 'hunt', p, hex: k, fauna: f, name: def.name, ds: [...b.fighters] });
  for (let round = 1; b.units[0].hp > 0 && b.fighters.length; round++) combatRound(g, b, round);
  const won = b.units[0].hp <= 0;
  if (won) {
    delete g.map[k].fauna;
    gain(g.players[p], def.loot);
    if (great) g.slain[f] = p;
  }
  const prize = great ? `${great.points} point${great.points === 1 ? '' : 's'}, for good` : bundleText(def.loot);
  const text = won
    ? great ? `The ${def.name} is slain. ${pname(p)} scores ${prize}.${f === 'thunderbird' ? ` Buildings on and adjacent to its peak make ${TUNING.peakBonus} more.` : ''}` : `The ${def.name} at ${k} falls. ${pname(p)} gains ${prize}.`
    : `The ${def.name} at ${k} holds. ${pname(p)}'s dragons fall back.`;
  log(g, text, { k: 'cleared', p, hex: k, fauna: f, name: def.name, won, gain: won ? def.loot : {}, ...(great && won ? { points: great.points } : {}) });
}

// Where a fauna card can put its beast: any land hex without fauna or a tower.
export function faunaHexes(g: Game): string[] {
  return Object.keys(g.map).filter((k) => g.map[k].terrain !== 'ocean' && !g.map[k].fauna && g.buildings[k]?.type !== 'tower').sort();
}

export function faunaOnMap(g: Game): string[] {
  return Object.keys(g.map).filter((k) => g.map[k].fauna).sort();
}

// The beasts player p may fight now: every fauna, and the great beasts
// unless they have had their try this round.
export function huntable(g: Game, p: number): string[] {
  return faunaOnMap(g).filter((k) => !BEASTS[g.map[k].fauna!] || g.beastTried[p] !== g.round);
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
  if (def.terrain && hex.terrain !== def.terrain) fail(`A ${def.name} must go on ${TERRAIN_NOUN[def.terrain]}; ${k} is ${TERRAIN_NOUN[hex.terrain]}.`);
  if (!neighbors(k).some((n) => g.buildings[n]?.owner === p)) fail(`${k} isn't adjacent to any of your buildings.`);
  return k;
}

export function buildableHexes(g: Game, p: number, type: string): string[] {
  const def = BUILDINGS[type];
  if (def.onTower) return [g.towers[p]];
  const out = new Set<string>();
  for (const [k] of ownedBuildings(g, p)) {
    for (const n of neighbors(k)) {
      if (g.map[n] && g.map[n].terrain !== 'ocean' && !g.buildings[n] && !nearBeast(g.map, n) && !g.map[n].fauna && (!def.terrain || g.map[n].terrain === def.terrain)) out.add(n);
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

export function specialProjectCost(cost: Bundle): Bundle {
  return scale(cost, TUNING.specialProjectMultiplier);
}

export const PROJECT_DRAGONS = Object.fromEntries(ELEMENTS.map((e) => [e, Object.keys(DRAGONS).find((k) => DRAGONS[k].base && DRAGONS[k].element === e)!])) as Record<Element, string>;

function hatch(g: Game, p: number, dragonKey: string, project = false) {
  const mine = g.dragons.filter((d) => d.owner === p).length;
  if (mine >= dragonCapacity(g, p)) fail(`No room for another dragon (${mine}/${dragonCapacity(g, p)}): build a roost first.`);
  const d: Dragon = { id: newId(g, 'd'), owner: p, key: dragonKey, stage: 0, growth: 0, damage: 0, resting: '' };
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
    if (!o || o.to !== p) fail(`There is no offer "${args[0] ?? ''}" made to you.`);
    g.offers = g.offers.filter((x) => x !== o);
    if (verb === 'decline') return log(g, `${pname(p)} declines offer ${o!.id}.`, { k: 'decline', p, from: o!.from });
    if (!hasTradeSide(g, o!.from, o!.give)) fail(`${pname(o!.from)} no longer has what they offered.`);
    if (!hasTradeSide(g, p, o!.get)) fail(`You don't have what offer ${o!.id} asks for.`);
    const giveText = tradeText(g, o!.give), getText = tradeText(g, o!.get);
    moveTradeSide(g, o!.from, p, o!.give);
    moveTradeSide(g, p, o!.from, o!.get);
    return log(g, `${pname(p)} accepts offer ${o!.id}: ${pname(o!.from)} gives ${giveText} for ${getText}.`, { k: 'trade', from: o!.from, to: p, give: giveText, get: getText });
  }
  if (verb === 'offer') {
    const to = parsePlayer(g, args[0]);
    if (to === p) fail(`You can't trade with yourself.`);
    if (p !== g.turn && to !== g.turn) fail(`Out of turn, you can only make offers to the acting player, ${pname(g.turn)}.`);
    const gi = args.indexOf('give'), ge = args.indexOf('get');
    if (gi !== 1 || ge < gi) fail(`Use: offer P2 give 2 stone c12 get 1 gold`);
    const o: Offer = { id: newId(g, 'o'), from: p, to, give: parseTradeSide(g, args.slice(gi + 1, ge)), get: parseTradeSide(g, args.slice(ge + 1)) };
    if (!hasTradeSide(g, p, o.give)) fail(`You don't have ${tradeText(g, o.give)}.`);
    g.offers.push(o);
    return log(g, `${pname(p)} offers ${pname(to)} (${o.id}): ${tradeText(g, o.give)} for ${tradeText(g, o.get)}.`, { k: 'offer', p, to });
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
      const open = g.offers.filter((o) => o.to === p);
      if (open.length) fail(`Answer ${open.map((o) => `${pname(o.from)}'s offer ${o.id}`).join(' and ')} first: accept or decline.`);
      log(g, `${pname(p)} ends their turn.`, { k: 'end', p });
      return endTurn(g);
    }
    case 'bank': {
      const give = parseResource(args[0]), get = parseResource(args[1]);
      const times = args[2] ? Number(args[2]) : 1;
      if (give === get) fail(`Trade two different resources.`);
      if (!Number.isInteger(times) || times < 1) fail(`Times must be a whole number.`);
      const rate = bankRate(g, p);
      pay(pl, { [give]: rate * times });
      gain(pl, { [get]: times });
      return log(g, `${pname(p)} trades ${rate * times} ${give} to the bank for ${times} ${get}.`, { k: 'bank', p, give: { [give]: rate * times }, get: { [get]: times } });
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
      pl.hand.splice(pl.hand.indexOf(c), 1);
      return placeBuilding(g, p, c.key, k);
    }
    case 'upgrade': {
      const c = handCard(g, p, args[0]);
      if (cardKind(c) !== 'upgrade') fail(`${cardName(c)} is not an upgrade card.`);
      const coords = parseKey(args[1] ?? '');
      const k = coords ? key(...coords) : '';
      if (!upgradeTargets(g, p, c.key).includes(k)) fail(`${cardName(c)} can go on: ${upgradeTargets(g, p, c.key).join(' ') || 'none of your buildings'}.`);
      pay(pl, UPGRADES[c.key].cost);
      pl.hand.splice(pl.hand.indexOf(c), 1);
      g.buildings[k].upgrade = c.key;
      const b = g.buildings[k];
      return log(g, `${pname(p)} adds ${UPGRADES[c.key].name} to their ${b.type === 'tower' ? 'Tower' : BUILDINGS[b.type].name} at ${k}.`, { k: 'upgrade', p, u: c.key, name: UPGRADES[c.key].name, on: b.type, hex: k });
    }
    case 'clear': {
      const coords = parseKey(args[0] ?? '');
      const k = coords ? key(...coords) : '';
      if (!g.map[k]?.fauna) fail(`There is no fauna at "${args[0] ?? ''}". Fauna is at: ${faunaOnMap(g).join(' ') || 'nowhere'}.`);
      const ids = [...new Set(args.slice(1))];
      if (!ids.length) fail(`Send at least one dragon: clear ${k} d1 d4`);
      const ds = ids.map((id) => ownDragon(g, p, id));
      for (const d of ds) if (!canRaid(d)) fail(`${d.id} can't fight (it must be hatched, unhurt, and not sitting out the round).`);
      return clearFauna(g, p, k, ds);
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
      return fail(`The special project is a base dragon egg of an element: ${ELEMENTS.join(', ')}.`);
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
          if (d.resting === 'hunted') fail(`${d.id} fought fauna this round, so it sits out the raids anyway.`);
          if (d.damage === 0 && d.resting !== 'hurt') fail(`${d.id} isn't hurt.`);
          pay(pl, def.cost);
          d.damage = 0;
          if (d.resting === 'hurt') d.resting = '';
          ev.d = d.id;
          what = `heals ${d.id}, ready to raid`;
          break;
        }
        case 'send_fauna': {
          const coords = parseKey(args[1] ?? '');
          const k = coords ? key(...coords) : '';
          if (!faunaHexes(g).includes(k)) fail(`Say where to place the ${FAUNA[def.fauna!].name}: a land hex with no tower or beast, like "play ${c.id} 2,-1".`);
          pay(pl, def.cost);
          g.map[k].fauna = def.fauna!;
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
  fail(`Unknown action "${verb}". Try: build, upgrade, project, play, clear, bank, offer, accept, decline, cancel, end.`);
}

function raidCommand(g: Game, p: number, verb: string, args: string[]) {
  const raid = g.raid!;
  if (raid.step === 'vote') {
    if (verb !== 'vote') fail(`Vote for the raid target: vote 1..${raid.candidates.length}.`);
    if (raid.votes[p] !== null) fail(`You already voted.`);
    const i = Number(args[0]) - 1;
    if (!(i >= 0 && i < raid.candidates.length)) fail(`Vote 1..${raid.candidates.length}.`);
    raid.votes[p] = i;
    log(g, `You vote for ${TARGETS[raid.candidates[i]].name}.`, { k: 'mine' }, { to: [p] });
    log(g, `${pname(p)} has voted.`, { k: 'voted', p });
    if (raid.votes.every((v) => v !== null)) resolveVote(g);
    return;
  }
  if (raid.step === 'commit') {
    if (raid.ready[p]) fail(`You're already locked in.`);
    if (verb === 'commit') {
      const ids = args.filter((a) => a !== 'none');
      for (const id of ids) {
        const d = ownDragon(g, p, id);
        if (!canRaid(d)) fail(`${id} can't raid (it must be hatched and not sitting out the round, and unhurt).`);
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
  if (raid.step === 'bail') {
    if (!raid.commits[p].length) fail(`You aren't in this raid.`);
    if (raid.choices[p]) fail(`You already chose.`);
    if (verb !== 'fight' && verb !== 'bail') fail(`Choose "fight" or "bail".`);
    raid.choices[p] = verb as 'fight' | 'bail';
    log(g, `You choose to ${verb}.`, { k: 'mine' }, { to: [p] });
    if (raid.commits.every((c, q) => !c.length || raid.choices[q])) resolveBail(g);
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
  if (verb !== 'discard') fail(`Discard ${nCards(over)}: discard <card ids>.`);
  const ids = [...new Set(args)];
  if (ids.length !== over) fail(`Discard exactly ${nCards(over)}.`);
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
    if (!m || !(q >= 0 && q < g.players.length) || q === p) fail(`Tell whom? e.g. "tell P2 want my timber?"`);
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
  const snapshot = structuredClone(g);
  try {
    if (g.phase === 'cards') cardsCommand(g, p, v, args);
    else if (g.phase === 'action') actionCommand(g, p, v, args);
    else if (g.phase === 'raid') raidCommand(g, p, v, args);
    else discardCommand(g, p, v, args);
    updateTitles(g);
  } catch (e) {
    Object.assign(g, snapshot); // a refused command changes nothing
    throw e;
  }
}

// ---------- whose decision is it ----------

export function waitingOn(g: Game): number[] {
  const all = g.players.map((_, p) => p);
  if (g.phase === 'over') return [];
  if (g.phase === 'action') return [...new Set([g.turn, ...g.offers.map((o) => o.to)])];
  if (g.phase === 'discard') return all.filter((p) => g.players[p].hand.length > TUNING.handCap);
  if (g.phase === 'cards') return all.filter((p) => g.players[p].choice.length);
  const raid = g.raid!;
  if (raid.step === 'vote') return all.filter((p) => raid.votes[p] === null);
  if (raid.step === 'commit') return all.filter((p) => !raid.ready[p]);
  return all.filter((p) => raid.commits[p].length && !raid.choices[p]);
}
