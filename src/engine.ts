// The rules engine. A game is a plain JSON-serialisable object; every player
// decision goes through apply(game, player, command).

import {
  ACTIONS, BUILDINGS, DRAGONS, ELEMENTS, RESOURCES, TARGETS, TUNING, UNITS, UPGRADES,
  type Attack, type BuildingClass, type Bundle, type DragonStage, type Element, type Resource,
} from './data.ts';
import { generateMap, key, neighbors, parseKey, towerSpots, type Hex } from './map.ts';
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
  // Why the dragon sits out this round (no growth, no raid): it was hungry or hurt at production.
  resting: '' | 'hungry' | 'hurt';
}

export interface Player {
  resources: Record<Resource, number>;
  hand: Card[];
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
}

export type Title = 'army' | 'tower' | 'territory';
export const TITLE_NAMES: Record<Title, string> = { army: 'Strongest Dragon Army', tower: 'Tallest Tower', territory: 'Largest Territory' };

export interface Game {
  version: 1;
  players: Player[];
  round: number;
  phase: 'action' | 'raid' | 'discard' | 'over';
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
  titles: Record<Title, number | null>;
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

function log(g: Game, text: string, to?: number[], dice?: Die[]) {
  const e: LogEntry = { round: g.round, text };
  if (to) e.to = to;
  if (dice) e.dice = dice;
  g.log.push(e);
}

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

export function canRaid(d: Dragon): boolean {
  return d.stage > 0 && !d.resting && d.damage === 0;
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

function buildingClass(b: Building): BuildingClass[] {
  return b.type === 'tower' ? ['points', 'dragon'] : [BUILDINGS[b.type].class];
}

export function dragonCapacity(g: Game, p: number): number {
  let cap = TUNING.towerDragonCapacity;
  for (const [, b] of ownedBuildings(g, p)) {
    if (b.type !== 'tower') cap += BUILDINGS[b.type].dragonCapacity ?? 0;
    if (b.upgrade) cap += UPGRADES[b.upgrade].dragonCapacity ?? 0;
  }
  return cap;
}

export function bankRate(g: Game, p: number): number {
  let rate = TUNING.bankRate;
  for (const [, b] of ownedBuildings(g, p)) {
    if (b.type !== 'tower') rate = Math.min(rate, BUILDINGS[b.type].bankRate ?? rate);
  }
  return rate;
}

function growthPerRound(g: Game, p: number): number {
  let n = 1;
  for (const [, b] of ownedBuildings(g, p)) if (b.type !== 'tower') n += BUILDINGS[b.type].growthBonus ?? 0;
  return n;
}

// Public production: fixed amount plus a list of dice, per resource.
export function production(g: Game, p: number): Record<Resource, { base: number; dice: number[] }> {
  const out = Object.fromEntries(RESOURCES.map((r) => [r, { base: 0, dice: [] as number[] }])) as Record<Resource, { base: number; dice: number[] }>;
  for (const r of RESOURCES) out[r].base += TUNING.towerProduction[r] ?? 0;
  for (const [, b] of ownedBuildings(g, p)) {
    if (b.type === 'tower') continue;
    const def = BUILDINGS[b.type];
    const up = b.upgrade ? UPGRADES[b.upgrade] : null;
    if (def.produces) {
      out[def.produces.resource].base += def.produces.base + (up?.baseBonus ?? 0);
      out[def.produces.resource].dice.push(def.produces.die);
    }
    if (up?.goldPerRound) out.gold.base += up.goldPerRound;
  }
  return out;
}

function titleValue(g: Game, p: number, t: Title): number {
  if (t === 'army') return g.dragons.filter((d) => d.owner === p).reduce((s, d) => s + TUNING.dragonPointsByStage[d.stage], 0);
  if (t === 'tower') return g.buildings[g.towers[p]].floors;
  return ownedBuildings(g, p).length;
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
      log(g, next === null ? `Nobody holds ${TITLE_NAMES[t]} now.` : `${pname(next)} takes ${TITLE_NAMES[t]}.`);
    }
  }
}

export interface Score {
  dragons: number;
  buildings: number;
  titles: number;
  hidden: number;
  public: number;
  total: number;
}

export function score(g: Game, p: number): Score {
  const dragons = g.dragons.filter((d) => d.owner === p).reduce((s, d) => s + TUNING.dragonPointsByStage[d.stage], 0);
  let buildings = 0;
  for (const [, b] of ownedBuildings(g, p)) {
    if (b.type === 'tower') buildings += b.floors * BUILDINGS.tower_floor.points!;
    else buildings += BUILDINGS[b.type].points ?? 0;
    if (b.upgrade) buildings += UPGRADES[b.upgrade].points ?? 0;
  }
  const titles = (Object.values(g.titles).filter((h) => h === p).length) * TUNING.titlePoints;
  const hidden = g.players[p].hand.filter((c) => ACTIONS[c.key]?.effect === 'hidden_point').length;
  const pub = dragons + buildings + titles;
  return { dragons, buildings, titles, hidden, public: pub, total: pub + hidden };
}

// ---------- setup ----------

function buildDeck(g: Game, deck: 'building' | 'action'): Card[] {
  const defs: Record<string, { copies: number }>[] = deck === 'building' ? [BUILDINGS, UPGRADES] : [ACTIONS, DRAGONS];
  const cards: Card[] = [];
  for (const d of defs) for (const [k, def] of Object.entries(d)) for (let i = 0; i < def.copies; i++) cards.push({ id: '', deck, key: k });
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
    titles: { army: null, tower: null, territory: null },
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
    g.players.push({ resources, hand: [] });
    g.buildings[g.towers[p]] = { type: 'tower', owner: p, upgrade: null, floors: 0 };
    g.dragons.push({ id: newId(g, 'd'), owner: p, key: pick(g.rng, baseDragons), stage: 1, growth: 0, damage: 0, resting: '' });
  }
  log(g, `A ${players}-player game begins. First to ${TUNING.pointsToWin} points wins (checked at the end of each round).`);
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
  log(g, `=== Round ${g.round} ===`);
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
    log(g, `${pname(p)} produces ${bundleText(got)}.`, undefined, dice);
  }
  // Every dragon eats and heals fully. One that was hungry or hurt sits out
  // the round: it doesn't grow and can't raid.
  for (const d of g.dragons) {
    const pl = g.players[d.owner];
    const hurt = d.damage > 0;
    d.damage = 0;
    const fed = pl.resources.livestock >= TUNING.livestockPerDragon;
    if (fed) pl.resources.livestock -= TUNING.livestockPerDragon;
    d.resting = !fed ? 'hungry' : hurt ? 'hurt' : '';
    if (d.resting) {
      log(g, `${pname(d.owner)}'s ${dragonName(d)} (${d.id}) ${fed ? 'is healing' : 'goes hungry'}: it won't grow or raid this round.`);
      continue;
    }
    if (d.stage === 3) continue;
    d.growth += growthPerRound(g, d.owner);
    const need = DRAGONS[d.key].growthTime;
    while (d.stage < 3 && d.growth >= need) {
      d.growth -= need;
      d.stage++;
      log(g, `${pname(d.owner)}'s ${dragonName(d)} (${d.id}) grows into a ${['egg', 'hatchling', 'young dragon', 'adult'][d.stage]}.`);
    }
    if (d.stage === 3) d.growth = 0;
  }
  // 2. Card picking, all at once.
  for (let p = 0; p < g.players.length; p++) {
    const drawn: Card[] = [];
    for (let i = 0; i < TUNING.buildingCardsPerRound; i++) {
      const c = drawCard(g, 'building');
      if (c) drawn.push(c);
    }
    for (let i = 0; i < TUNING.actionCardsPerRound; i++) {
      const c = drawCard(g, 'action');
      if (c) drawn.push(c);
    }
    g.players[p].hand.push(...drawn);
    log(g, `You draw ${drawn.map((c) => `${cardName(c)} (${c.id})`).join(', ') || 'nothing'}.`, [p]);
    log(g, `${pname(p)} draws ${drawn.length} cards.`);
  }
  updateTitles(g);
  // 3. Action phase.
  g.phase = 'action';
  g.turn = firstPlayer(g);
  g.raidsLeft = 1;
  log(g, `Action phase: ${pname(g.turn)}'s turn.`);
}

// The first player moves one seat to the left each round.
export function firstPlayer(g: Game): number {
  return (g.round - 1) % g.players.length;
}

export function turnOrder(g: Game): number[] {
  return g.players.map((_, i) => (firstPlayer(g) + i) % g.players.length);
}

function endTurn(g: Game) {
  for (const o of g.offers) log(g, `Offer ${o.id} expires.`);
  g.offers = [];
  const next = (g.turn + 1) % g.players.length;
  if (next !== firstPlayer(g)) {
    g.turn = next;
    log(g, `${pname(g.turn)}'s turn.`);
    return;
  }
  startRaid(g);
}

function startRaid(g: Game) {
  g.phase = 'raid';
  const n = g.players.length;
  g.raid = {
    step: 'vote',
    candidates: shuffle(g.rng, Object.keys(TARGETS)).slice(0, TUNING.raidCandidates),
    votes: Array(n).fill(null),
    target: null,
    commits: Array.from({ length: n }, () => []),
    ready: Array(n).fill(false),
    choices: Array(n).fill(null),
    units: [],
    fighters: [],
  };
  log(g, `Raid phase: vote for a target among ${g.raid.candidates.map((t, i) => `${i + 1}. ${TARGETS[t].name}`).join(', ')}.`);
}

function finishRaid(g: Game) {
  g.raid = null;
  g.raidsLeft--;
  updateTitles(g);
  if (g.raidsLeft > 0) {
    log(g, 'Another raid follows this round.');
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
    // Ties: most gold, then earliest in this round's turn order.
    const contenders = turnOrder(g).filter((p) => totals[p] === best);
    const winner = contenders.reduce((a, b) => (g.players[b].resources.gold > g.players[a].resources.gold ? b : a));
    g.winner = winner;
    g.phase = 'over';
    log(g, `Final scores: ${totals.map((t, p) => `${pname(p)} ${t}`).join(', ')}.`);
    log(g, `${pname(winner)} wins with ${best} points!`);
    return;
  }
  startRound(g);
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
  log(g, `Votes: ${raid.votes.map((v, p) => `${pname(p)}→${TARGETS[raid.candidates[v!]].name}`).join(', ')}.`);
  log(g, `The raid target is ${TARGETS[raid.target].name}${tied.length > 1 ? ' (tie broken by a coin flip)' : ''}.`);
  raid.step = 'commit';
  for (let p = 0; p < g.players.length; p++) raid.ready[p] = eligibleDragons(g, p).length === 0;
  if (raid.ready.every(Boolean)) resolveCommit(g);
}

function resolveCommit(g: Game) {
  const raid = g.raid!;
  const committed = raid.commits.flatMap((c, p) => (c.length ? [p] : []));
  if (committed.length === 0) {
    log(g, 'Nobody commits to the raid.');
    return finishRaid(g);
  }
  log(g, `Commitments lock in: ${committed.map((p) => `${pname(p)} (${raid.commits[p].join(' ')})`).join(', ')}. Each now secretly chooses to fight or bail.`);
  raid.step = 'bail';
}

function resolveBail(g: Game) {
  const raid = g.raid!;
  const fighters: number[] = [];
  for (let p = 0; p < g.players.length; p++) {
    if (raid.choices[p] === 'fight') fighters.push(p);
    if (raid.choices[p] === 'bail') log(g, `${pname(p)} bails!`);
  }
  if (fighters.length === 0) {
    log(g, 'Everyone bailed. The raid is off.');
    return finishRaid(g);
  }
  raid.fighters = fighters.flatMap((p) => raid.commits[p]);
  raid.units = TARGETS[raid.target!].units.map((k) => ({ key: k, hp: UNITS[k].hp }));
  log(g, `Fighting: ${fighters.map(pname).join(', ')}. The attack on ${TARGETS[raid.target!].name} begins.`);
  // No retreat: the fight goes on until every defender falls or every dragon is knocked out.
  for (let round = 1; !checkRaidOver(g); round++) combatRound(g, round);
}

function rollAttack(g: Game, a: Attack): number {
  let sum = 0;
  for (let i = 0; i < a.dice; i++) sum += roll(g.rng, a.sides);
  return sum;
}

function pickTargets(g: Game, d: Dragon, n: number): number[] {
  const raid = g.raid!;
  const alive = raid.units.flatMap((u, i) => (u.hp > 0 ? [i] : []));
  const rule = DRAGONS[d.key].targeting;
  let order = shuffle(g.rng, alive.slice());
  if (rule === 'lowest_health') order.sort((a, b) => raid.units[a].hp - raid.units[b].hp);
  if (rule === 'strongest_attacker') {
    const power = (i: number) => { const u = UNITS[raid.units[i].key]; return u.targets * u.dice * (u.sides + 1); };
    order.sort((a, b) => power(b) - power(a));
  }
  if (rule === 'weak_to_me') {
    const weak = (i: number) => (UNITS[raid.units[i].key].weak.includes(DRAGONS[d.key].element) ? 0 : 1);
    order.sort((a, b) => weak(a) - weak(b));
  }
  return order.slice(0, n);
}

function dragonById(g: Game, id: string): Dragon {
  return g.dragons.find((d) => d.id === id)!;
}

// A dragon at 0 health is knocked out: it leaves the fight and heals at home.
function knockedOut(g: Game, d: Dragon): boolean {
  if (d.damage < stageStats(d)!.hp) return false;
  d.damage = stageStats(d)!.hp;
  g.raid!.fighters = g.raid!.fighters.filter((id) => id !== d.id);
  return true;
}

function combatRound(g: Game, round: number) {
  const raid = g.raid!;
  const lines: string[] = [];
  // Dragons strike first.
  for (const id of raid.fighters) {
    const d = dragonById(g, id);
    const st = stageStats(d)!;
    for (const ui of pickTargets(g, d, st.targets)) {
      const u = raid.units[ui];
      const def = UNITS[u.key];
      let dmg = rollAttack(g, st);
      const el = DRAGONS[d.key].element;
      if (def.weak.includes(el)) dmg *= 2;
      else if (def.strong.includes(el)) dmg = Math.max(1, Math.floor(dmg / 2));
      u.hp = Math.max(0, u.hp - dmg);
      lines.push(`${d.id} hits ${def.name} #${ui + 1} for ${dmg}${u.hp === 0 ? ' (defeated)' : ''}`);
    }
  }
  // Then the defenders.
  for (const [ui, u] of raid.units.entries()) {
    if (u.hp <= 0) continue;
    const def = UNITS[u.key];
    for (let t = 0; t < def.targets && raid.fighters.length; t++) {
      const d = dragonById(g, pick(g.rng, raid.fighters));
      const dmg = rollAttack(g, def);
      d.damage += dmg;
      lines.push(`${def.name} #${ui + 1} hits ${d.id} for ${dmg}${knockedOut(g, d) ? ' (knocked out, limps home)' : ''}`);
    }
  }
  log(g, `Combat round ${round}: ${lines.join('; ')}.`);
}

export function unitsText(g: Game): string {
  return g.raid!.units.map((u, i) => `${UNITS[u.key].name} #${i + 1} ${u.hp}/${UNITS[u.key].hp}hp`).join(', ');
}

function checkRaidOver(g: Game): boolean {
  const raid = g.raid!;
  if (raid.units.every((u) => u.hp <= 0)) {
    const winners = [...new Set(raid.fighters.map((id) => dragonById(g, id).owner))].sort();
    const loot = TARGETS[raid.target!].loot;
    const share: Bundle = {};
    for (const r of RESOURCES) if (loot[r]) share[r] = Math.floor(loot[r]! / winners.length);
    for (const p of winners) gain(g.players[p], share);
    log(g, `${TARGETS[raid.target!].name} falls! ${winners.map(pname).join(', ')} each take ${bundleText(share)}.`);
    finishRaid(g);
    return true;
  }
  if (raid.fighters.length === 0) {
    log(g, `No dragons are left in the fight. ${TARGETS[raid.target!].name} holds.`);
    finishRaid(g);
    return true;
  }
  return false;
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
  if (def.terrain && hex.terrain !== def.terrain) fail(`A ${def.name} must go on ${def.terrain}; ${k} is ${hex.terrain}.`);
  if (!neighbors(k).some((n) => g.buildings[n]?.owner === p)) fail(`${k} doesn't touch any of your buildings.`);
  return k;
}

export function buildableHexes(g: Game, p: number, type: string): string[] {
  const def = BUILDINGS[type];
  if (def.onTower) return [g.towers[p]];
  const out = new Set<string>();
  for (const [k] of ownedBuildings(g, p)) {
    for (const n of neighbors(k)) {
      if (g.map[n] && g.map[n].terrain !== 'ocean' && !g.buildings[n] && (!def.terrain || g.map[n].terrain === def.terrain)) out.add(n);
    }
  }
  return [...out].sort();
}

function placeBuilding(g: Game, p: number, type: string, k: string) {
  const def = BUILDINGS[type];
  if (def.onTower) {
    g.buildings[k].floors++;
    log(g, `${pname(p)} adds a floor to their tower (now ${g.buildings[k].floors}).`);
  } else {
    g.buildings[k] = { type, owner: p, upgrade: null, floors: 0 };
    log(g, `${pname(p)} builds a ${def.name} at ${k}.`);
  }
}

export function upgradeTargets(g: Game, p: number, up: string): string[] {
  return ownedBuildings(g, p)
    .filter(([, b]) => !b.upgrade && buildingClass(b).includes(UPGRADES[up].appliesTo))
    .map(([k]) => k)
    .sort();
}

export function specialProjectCost(cost: Bundle): Bundle {
  return scale(cost, TUNING.specialProjectMultiplier);
}

export const PROJECT_BUILDINGS = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].specialProject);
export const PROJECT_DRAGONS = Object.fromEntries(ELEMENTS.map((e) => [e, Object.keys(DRAGONS).find((k) => DRAGONS[k].base && DRAGONS[k].element === e)!])) as Record<Element, string>;

function hatch(g: Game, p: number, dragonKey: string) {
  const mine = g.dragons.filter((d) => d.owner === p).length;
  if (mine >= dragonCapacity(g, p)) fail(`You have no room for another dragon (${mine}/${dragonCapacity(g, p)}). Build a roost first.`);
  const d: Dragon = { id: newId(g, 'd'), owner: p, key: dragonKey, stage: 0, growth: 0, damage: 0, resting: '' };
  g.dragons.push(d);
  log(g, `${pname(p)} hatches an egg: ${dragonName(d)} (${d.id}), a ${DRAGONS[dragonKey].element} dragon.`);
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
    if (verb === 'decline') return log(g, `${pname(p)} declines offer ${o!.id}.`);
    if (!hasTradeSide(g, o!.from, o!.give)) fail(`${pname(o!.from)} no longer has what they offered.`);
    if (!hasTradeSide(g, p, o!.get)) fail(`You don't have what offer ${o!.id} asks for.`);
    const giveText = tradeText(g, o!.give), getText = tradeText(g, o!.get);
    moveTradeSide(g, o!.from, p, o!.give);
    moveTradeSide(g, p, o!.from, o!.get);
    return log(g, `${pname(p)} accepts offer ${o!.id}: ${pname(o!.from)} gives ${giveText} for ${getText}.`);
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
    return log(g, `${pname(p)} offers ${pname(to)} (${o.id}): ${tradeText(g, o.give)} for ${tradeText(g, o.get)}.`);
  }
  if (verb === 'cancel') {
    const o = g.offers.find((x) => x.id === args[0] && x.from === p);
    if (!o) fail(`You have no open offer "${args[0] ?? ''}".`);
    g.offers = g.offers.filter((x) => x !== o);
    return log(g, `${pname(p)} withdraws offer ${o!.id}.`);
  }
  if (p !== g.turn) fail(`It's ${pname(g.turn)}'s turn. Out of turn you can only offer, accept, decline or cancel trades.`);
  switch (verb) {
    case 'end':
      log(g, `${pname(p)} ends their turn.`);
      return endTurn(g);
    case 'bank': {
      const give = parseResource(args[0]), get = parseResource(args[1]);
      const times = args[2] ? Number(args[2]) : 1;
      if (give === get) fail(`Trade two different resources.`);
      if (!Number.isInteger(times) || times < 1) fail(`Times must be a whole number.`);
      const rate = bankRate(g, p);
      pay(pl, { [give]: rate * times });
      gain(pl, { [get]: times });
      return log(g, `${pname(p)} trades ${rate * times} ${give} to the bank for ${times} ${get}.`);
    }
    case 'build': {
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
      return log(g, `${pname(p)} adds ${UPGRADES[c.key].name} to their ${b.type === 'tower' ? 'Tower' : BUILDINGS[b.type].name} at ${k}.`);
    }
    case 'project': {
      const what = args[0] ?? '';
      if (PROJECT_BUILDINGS.includes(what)) {
        const k = placeCheck(g, p, what, args[1]);
        pay(pl, specialProjectCost(BUILDINGS[what].cost));
        log(g, `${pname(p)} uses a special project.`);
        return placeBuilding(g, p, what, k);
      }
      const el = ELEMENTS.find((e) => e === what);
      if (el) {
        const dk = PROJECT_DRAGONS[el];
        if (g.dragons.filter((d) => d.owner === p).length >= dragonCapacity(g, p)) fail(`You have no room for another dragon.`);
        pay(pl, specialProjectCost(DRAGONS[dk].cost));
        log(g, `${pname(p)} uses a special project.`);
        return hatch(g, p, dk);
      }
      return fail(`Special projects: ${PROJECT_BUILDINGS.join(', ')}, or a base dragon: ${ELEMENTS.join(', ')}.`);
    }
    case 'play': {
      const c = handCard(g, p, args[0]);
      const kind = cardKind(c);
      if (kind === 'dragon') {
        if (g.dragons.filter((d) => d.owner === p).length >= dragonCapacity(g, p)) fail(`You have no room for another dragon. Build a roost first.`);
        pay(pl, DRAGONS[c.key].cost);
        discardCard(g, p, c);
        return hatch(g, p, c.key);
      }
      if (kind !== 'action') fail(`${cardName(c)} is played with "${kind === 'building' ? 'build' : 'upgrade'}".`);
      const def = ACTIONS[c.key];
      let what = '';
      switch (def.effect) {
        case 'hidden_point':
          return fail(`${def.name} isn't played; it scores while it stays in your hand.`);
        case 'gain_resource': {
          const r = parseResource(args[1]);
          if (r === 'gold') fail(`${def.name} can't give gold.`);
          pay(pl, def.cost);
          gain(pl, { [r]: def.amount });
          what = `gains ${def.amount} ${r}`;
          break;
        }
        case 'gain_gold':
          pay(pl, def.cost);
          gain(pl, { gold: def.amount });
          what = `gains ${def.amount} gold`;
          break;
        case 'grow_dragon': {
          const d = ownDragon(g, p, args[1]);
          if (d.stage === 3) fail(`${d.id} is already an adult.`);
          pay(pl, def.cost);
          d.stage++;
          d.growth = 0;
          what = `grows ${dragonName(d)} (${d.id}) into a ${['egg', 'hatchling', 'young dragon', 'adult'][d.stage]}`;
          break;
        }
        case 'heal_dragon': {
          const d = ownDragon(g, p, args[1]);
          if (d.damage === 0 && d.resting !== 'hurt') fail(`${d.id} isn't hurt.`);
          pay(pl, def.cost);
          d.damage = 0;
          if (d.resting === 'hurt') d.resting = '';
          what = `heals ${d.id}, ready to raid`;
          break;
        }
        case 'extra_raid':
          pay(pl, def.cost);
          g.raidsLeft++;
          what = `sounds the horn: ${g.raidsLeft} raids this round`;
          break;
      }
      discardCard(g, p, c);
      return log(g, `${pname(p)} plays ${def.name} and ${what}.`);
    }
  }
  fail(`Unknown action "${verb}". Try: build, upgrade, project, play, bank, offer, accept, decline, cancel, end.`);
}

function raidCommand(g: Game, p: number, verb: string, args: string[]) {
  const raid = g.raid!;
  if (raid.step === 'vote') {
    if (verb !== 'vote') fail(`Vote for the raid target: vote 1..${raid.candidates.length}.`);
    if (raid.votes[p] !== null) fail(`You already voted.`);
    const i = Number(args[0]) - 1;
    if (!(i >= 0 && i < raid.candidates.length)) fail(`Vote 1..${raid.candidates.length}.`);
    raid.votes[p] = i;
    log(g, `You vote for ${TARGETS[raid.candidates[i]].name}.`, [p]);
    log(g, `${pname(p)} has voted.`);
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
      return log(g, `${pname(p)} commits ${ids.length ? ids.join(' ') : 'nothing'}.`);
    }
    if (verb === 'ready') {
      raid.ready[p] = true;
      log(g, `${pname(p)} is ready with ${raid.commits[p].join(' ') || 'nothing'} committed.`);
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
    log(g, `You choose to ${verb}.`, [p]);
    if (raid.commits.every((c, q) => !c.length || raid.choices[q])) resolveBail(g);
  }
}

function discardCommand(g: Game, p: number, verb: string, args: string[]) {
  const pl = g.players[p];
  const over = pl.hand.length - TUNING.handCap;
  if (over <= 0) fail(`You don't need to discard.`);
  if (verb !== 'discard') fail(`Discard ${over} card(s): discard <card ids>.`);
  const ids = [...new Set(args)];
  if (ids.length !== over) fail(`Discard exactly ${over} card(s).`);
  const cards = ids.map((id) => handCard(g, p, id));
  for (const c of cards) discardCard(g, p, c);
  log(g, `${pname(p)} discards ${ids.length} card(s).`);
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
  log(g, to ? `${pname(p)} to ${pname(to[1])} (private): "${text}"` : `${pname(p)} says: "${text}"`, to);
}

export function apply(g: Game, p: number, command: string): void {
  if (g.phase === 'over') fail(`The game is over.`);
  if (!(p >= 0 && p < g.players.length)) fail(`No such player.`);
  const [verb = '', ...args] = command.trim().split(/\s+/);
  const v = verb.toLowerCase();
  if (v === 'say' || v === 'tell') return talk(g, p, v, command.trim().slice(verb.length).trim());
  const snapshot = structuredClone(g);
  try {
    if (g.phase === 'action') actionCommand(g, p, v, args);
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
  const raid = g.raid!;
  if (raid.step === 'vote') return all.filter((p) => raid.votes[p] === null);
  if (raid.step === 'commit') return all.filter((p) => !raid.ready[p]);
  return all.filter((p) => raid.commits[p].length && !raid.choices[p]);
}
