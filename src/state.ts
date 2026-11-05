// What the web clients receive, as JSON. publicState is everything on the TV;
// seatState is one player's hidden state and choices (their phone). Like
// view.ts, nothing hidden from a player ever goes into their state.

import { ACTIONS, BASIC_BUILDINGS, BEASTS, BUILDINGS, CLASS_NAMES, DRAGONS, ELEMENTS, ELEMENT_BEATS, ELEMENT_WEAK, RESOURCES, faunaDef, STAGE_NAMES, TARGETING_TEXT, TARGETS, TERRAIN_NOUN, TUNING, UNITS, UPGRADES, combatPower, orList, targetPower, type BuildingDef, type Bundle, type DragonDef, type Resource } from './data.ts';
import {
  type GameEvent, TITLE_NAMES, acceptProblem, afford, bankRate, besideText, buildingClass, buildingYield, buildableHexes, canAfford, canRaid, canVote, NO_VOTE, cardCost, cardKind, cardName, dragonCapacity, dragonPower, faunaHexes, faunaLoot, huntable, lootOf,
  neighbourCount, onPeak, perchHexes, perchedOn, production, score, specialProjectCost, standings, stageStats, titleValues, turnOrder, upgradeTargets, waitingOn,
  type BuildingYield, type Card, type Die, type Dragon, type Game, type Standing, type TradeSide, type Title,
} from './engine.ts';
import { PEAK, nearBeast, neighbors } from './map.ts';

export type Res = Partial<Record<Resource, number>>;

export interface HexView {
  k: string;
  q: number;
  r: number;
  terrain: string;
  building: { type: string; cls: string; name: string; owner: number; upgrade: string | null /* its key in UPGRADES */; upgradeName: string | null; floors: number; does: BuildingDoes } | null;
  fauna: FaunaView | null; // a beast holding the hex: nothing is built there, and a building under it produces nothing
  perched: { d: string; owner: number; element: string }[]; // the dragons perched on its building (id, owner, element): it makes nothing while one is there
  held?: string; // next to this great beast (a BEASTS key): nothing is built here until it is slain
  peak?: 'held' | 'free'; // the Thunderbird's peak
  peakZone?: boolean; // on or next to the freed peak: a production building here makes more
}

// What a building does each round on its hex (engine's buildingYield), with,
// for a building whose effect is none of those (the Hatchery, a Port), its
// card's words. What the phone shows for a hex before a beast or an upgrade
// goes on it.
export interface BuildingDoes extends BuildingYield {
  note?: string;
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
}

export interface RaidView {
  step: 'vote' | 'commit' | 'bail';
  candidates: TargetView[];
  votes: (number | null)[]; // each player's vote (a candidate's index), public as it's cast
  voters: boolean[]; // who votes: only players with a raid-ready dragon
  target: TargetView | null; // units carry current health once the fight starts
  commits: string[][];
  ready: boolean[];
  decided: boolean[]; // fight-or-bail chosen (not what)
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
  waitingOn: number[];
  players: { publicPoints: number; buildings: number; monuments: number; titles: number; beasts: number; handSize: number; gold: number; production: Record<string, { base: number; dice: number[] }>; bankRate: number }[];
  titles: { key: Title; name: string; holder: number | null; values: number[]; min: number }[];
  // The great beasts: where each is (or was), and who slew it.
  beasts: { key: string; name: string; hex: string | null; slainBy: number | null; points: number; hp: number; weak: string[] }[];
  peakBonus: number;
  map: HexView[];
  dragons: DragonView[];
  offers: { id: string; from: number; to: number; give: string; get: string }[];
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
  after?: Record<string, BuildingDoes>; // upgrade cards: what each of `hexes` would do with it
  dragon?: { growth: number; targeting: string; stages: DragonStageView[] }; // dragon cards: growth steps per stage, how it picks targets, hatchling/young/adult stats
}

export interface SeatState {
  seat: number;
  resources: Record<Resource, number>;
  hiddenPoints: number;
  totalPoints: number;
  bankRate: number;
  dragonsHoused: number;
  dragonCapacity: number;
  // What a round brings in, per resource: production minus what the dragons
  // eat. A fixed amount plus dice, the same every round until something is
  // built or hatched.
  income: Record<Resource, { base: number; dice: number[] }>;
  hand: CardView[];
  choice: CardView[]; // building cards drawn this round, to keep one
  handCap: number;
  myTurn: boolean;
  deciding: boolean;
  basics: { key: string; cls: string; name: string; text: string; cost: Res; affordable: boolean; hexes: string[]; onTower: boolean; why: string | null }[]; // built without a card
  eggProject: { cost: Res; affordable: boolean; elements: string[]; room: boolean; why: string | null };
  raidReady: string[]; // my dragons that can be committed to a raid, or sent against fauna on my turn
  huntable: string[]; // hexes I may clear now: beasts (one try at a great beast a round) and rivals' perched dragons
  perchable: string[]; // rivals' buildings my raid-ready dragons may perch on (never a tower)
  perched: string[]; // my perched dragons, to recall
  cantAccept: Record<string, string>; // offers to me I can't accept now, by id: why
  myVote: number | null;
  whyNoVote: string | null; // why you don't vote on the raid target, when you don't
  myChoice: 'fight' | 'bail' | null;
  log: EventView[]; // private events for me
  talk: EventView[]; // talk I can see: everyone's public talk, and private messages to or from me
}

const res = (b: Bundle): Res => Object.fromEntries(RESOURCES.filter((r) => b[r]).map((r) => [r, b[r]!]));

function attackText(a: { targets: number; dice: number; sides: number }) {
  return `${a.dice}d${a.sides}${a.targets > 1 ? ` on ${a.targets} targets` : ''}`;
}

const stageViews = (def: DragonDef): DragonStageView[] => def.stages.map((st) => ({ hp: st.hp, attack: attackText(st), power: combatPower(st) }));

function dragonView(g: Game, d: Dragon): DragonView {
  const def = DRAGONS[d.key];
  const st = stageStats(d);
  const status = canRaid(d) ? 'ready' : d.stage === 0 ? 'egg' : d.perch ? 'perched' : 'out';
  return {
    id: d.id, owner: d.owner, name: def.name, element: def.element, stage: d.stage, stageName: STAGE_NAMES[d.stage],
    growth: d.growth, growthTime: def.growthTime, hp: st ? st.hp - d.damage : 0, maxHp: st ? st.hp : 0,
    canRaid: canRaid(d), perch: d.perch ?? null, weak: ELEMENT_WEAK[def.element], power: dragonPower(d), status, targeting: TARGETING_TEXT[def.targeting], attack: st ? attackText(st) : '',
    key: d.key, stages: stageViews(def),
  };
}

function targetView(g: Game, key: string, hp?: number[]): TargetView {
  const t = TARGETS[key];
  return {
    key, name: t.name, loot: res(lootOf(g, key)), power: targetPower(key),
    units: t.units.map((u, i) => {
      const x = UNITS[u];
      return { name: x.name, hp: hp ? hp[i] : x.hp, maxHp: x.hp, attack: attackText(x), power: combatPower(x), element: x.element, weak: ELEMENT_WEAK[x.element] };
    }),
  };
}

// A beast, with the loot it gives: a card-sent one gives none.
export function faunaView(key: string, loot: Bundle = faunaDef(key).loot): FaunaView {
  const x = faunaDef(key);
  return { key, name: x.name, hp: x.hp, maxHp: x.hp, attack: attackText(x), power: combatPower(x), element: x.element, weak: ELEMENT_WEAK[x.element], loot: res(loot), ...(BEASTS[key] ? { points: BEASTS[key].points } : {}) };
}

function sideText(g: Game, s: TradeSide): string {
  const parts = RESOURCES.filter((r) => (s.res[r] ?? 0) > 0).map((r) => `${s.res[r]} ${r}`);
  for (const id of s.cards) {
    const c = g.players.flatMap((p) => p.hand).find((x) => x.id === id);
    parts.push(c ? `${cardName(c)} card` : `card ${id}`);
  }
  return parts.join(', ') || 'nothing';
}

// Table talk (say and tell), as the engine logs it.
export const isTalk = (text: string) => / says: "| \(private\): "/.test(text);

function events(g: Game, keep: (e: Game['log'][number]) => boolean, n: number, since = 0): EventView[] {
  const out: EventView[] = [];
  for (let i = g.log.length - 1; i >= since && out.length < n; i--) {
    const e = g.log[i];
    if (!keep(e)) continue;
    out.push({ i, round: e.round, text: e.text, ...(e.dice ? { dice: e.dice } : {}), ...(e.ev ? { ev: e.ev } : {}), ...(e.to ? { private: true } : {}) });
  }
  return out.reverse();
}

/** Every event seat p may see from log index `since` on, talk included. */
export function visibleEvents(g: Game, p: number, since = 0): EventView[] {
  return events(g, (e) => !e.to || e.to.includes(p), Infinity, since);
}

export function publicState(g: Game, logLines = 60): PublicState {
  const n = g.players.length;
  const raid = g.raid;
  return {
    round: g.round,
    phase: g.phase,
    turn: g.turn,
    turnOrder: turnOrder(g),
    pointsToWin: TUNING.pointsToWin,
    titlePoints: TUNING.titlePoints,
    elementBeats: ELEMENT_BEATS,
    faunaWanderOdds: TUNING.faunaWanderOdds,
    waitingOn: waitingOn(g),
    players: g.players.map((pl, p) => {
      const s = score(g, p);
      return { publicPoints: s.public, buildings: s.buildings, monuments: s.monuments, titles: s.titles, beasts: s.beasts, handSize: pl.hand.length, gold: pl.resources.gold, production: production(g, p), bankRate: bankRate(g, p) };
    }),
    titles: (Object.keys(TITLE_NAMES) as Title[]).map((t) => ({ key: t, name: TITLE_NAMES[t], holder: g.titles[t], values: titleValues(g, t), min: TUNING.titleMinimum[t] })),
    beasts: Object.entries(BEASTS).map(([key, x]) => ({
      key, name: x.name, hex: Object.keys(g.map).find((k) => g.map[k].fauna === key) ?? null, slainBy: g.slain[key] ?? null, points: x.points, hp: x.hp, weak: ELEMENT_WEAK[x.element],
    })),
    peakBonus: TUNING.peakBonus,
    map: Object.entries(g.map).map(([k, h]) => {
      const b = g.buildings[k];
      return {
        ...(!h.fauna && h.terrain !== 'ocean' && nearBeast(g.map, k) ? { held: neighbors(k).map((n) => g.map[n]?.fauna).find((f) => f && BEASTS[f]) } : {}),
        ...(k === PEAK ? { peak: h.fauna ? 'held' as const : 'free' as const } : {}),
        ...(h.terrain !== 'ocean' && onPeak(g, k) ? { peakZone: true } : {}),
        k, q: h.q, r: h.r, terrain: h.terrain,
        building: b ? { type: b.type, cls: buildingClass(b)[0], name: b.type === 'tower' ? 'Tower' : BUILDINGS[b.type].name, owner: b.owner, upgrade: b.upgrade, upgradeName: b.upgrade ? UPGRADES[b.upgrade].name : null, floors: b.floors, does: buildingDoes(g, k) } : null,
        fauna: h.fauna ? faunaView(h.fauna, faunaLoot(g, k)) : null,
        perched: perchedOn(g, k).map((d) => ({ d: d.id, owner: d.owner, element: DRAGONS[d.key].element })),
      };
    }),
    dragons: g.dragons.map((d) => dragonView(g, d)),
    offers: g.offers.map((o) => ({ id: o.id, from: o.from, to: o.to, give: sideText(g, o.give), get: sideText(g, o.get) })),
    raid: raid && {
      step: raid.step,
      candidates: raid.candidates.map((t) => targetView(g, t)),
      votes: [...raid.votes],
      voters: Array.from({ length: n }, (_, p) => canVote(g, p)),
      target: raid.target ? targetView(g, raid.target, raid.units.length ? raid.units.map((u) => u.hp) : undefined) : null,
      commits: raid.commits,
      ready: raid.ready,
      decided: raid.choices.map((c) => c !== null),
      fighting: Array.from({ length: n }, (_, p) => raid.fighters.some((id) => g.dragons.find((d) => d.id === id)!.owner === p)),
      fighters: raid.fighters,
    },
    kingdoms: Object.keys(TARGETS).map((t) => targetView(g, t)),
    raidsLeft: g.raidsLeft,
    winner: g.winner,
    finalTotals: g.phase === 'over' ? g.players.map((_, p) => score(g, p).total) : null,
    standings: g.phase === 'over' ? standings(g) : null,
    log: events(g, (e) => !e.to && !isTalk(e.text), logLines),
    talk: events(g, (e) => !e.to && isTalk(e.text), 12),
  };
}

function buildingDoes(g: Game, k: string, upgrade?: string): BuildingDoes {
  const b = g.buildings[k];
  const def = b.type === 'tower' ? null : BUILDINGS[b.type];
  const note = def && (def.growthBonus || def.bankRate) ? def.text : undefined;
  return { ...buildingYield(g, k, upgrade), ...(note ? { note } : {}) };
}

// A card as a seat sees it, with what playing it now needs and, if it can't
// be played now, why.
function cardView(g: Game, p: number, c: Card): CardView {
  const v = cardOptions(g, p, c);
  const verb = v.kind === 'dragon' ? 'Hatch' : v.kind === 'upgrade' ? 'Upgrade' : v.kind === 'building' ? 'Build' : v.fauna ? 'Place' : 'Play';
  const why = v.blocked ?? afford(g.players[p], cardCost(c)) ?? (g.phase === 'action' && g.turn === p ? null : `${verb} it on your turn.`);
  return { ...v, verb, why };
}

function cardOptions(g: Game, p: number, c: Card): Omit<CardView, 'verb' | 'why'> {
  const kind = cardKind(c);
  const pl = g.players[p];
  const mine = g.dragons.filter((d) => d.owner === p);
  const base = { id: c.id, kind, key: c.key, name: cardName(c), cost: res(cardCost(c)), affordable: canAfford(pl, cardCost(c)), hexes: [] as string[], dragons: [] as string[], blocked: null as string | null };
  if (kind === 'building') {
    const b = BUILDINGS[c.key];
    const hexes = b.onTower ? [] : buildableHexes(g, p, c.key);
    const text = placeText(b);
    const counts = b.per ? Object.fromEntries(hexes.map((k) => [k, neighbourCount(g, k, b.per!)])) : undefined;
    return { ...base, text, cls: b.class, needs: b.onTower ? 'none' : 'hex', hexes, ...(counts ? { counts } : {}), blocked: !b.onTower && !hexes.length ? noHex(b) : null };
  }
  if (kind === 'upgrade') {
    const u = UPGRADES[c.key];
    const hexes = upgradeTargets(g, p, c.key);
    const after = Object.fromEntries(hexes.map((k) => [k, buildingDoes(g, k, c.key)]));
    return { ...base, text: u.text, needs: 'hex', hexes, after, blocked: hexes.length ? null : `You have no ${orList(u.appliesTo.map((c) => CLASS_NAMES[c]))} without an upgrade.` };
  }
  if (kind === 'dragon') {
    const d = DRAGONS[c.key];
    const full = mine.length >= dragonCapacity(g, p);
    const adult = d.stages[2];
    const text = `${d.element[0].toUpperCase()}${d.element.slice(1)} dragon, hatches as an egg, grows every ${d.growthTime} step${d.growthTime > 1 ? 's' : ''}. As an adult: ${adult.hp} health, attacks ${attackText(adult)}; ${TARGETING_TEXT[d.targeting]}.`;
    const dragon = { growth: d.growthTime, targeting: TARGETING_TEXT[d.targeting], stages: stageViews(d) };
    return { ...base, text, element: d.element, dragon, needs: 'none', blocked: full ? NO_ROOM : null };
  }
  const a = ACTIONS[c.key];
  if (a.effect === 'hidden_point') return { ...base, text: a.text, needs: 'unplayable', blocked: 'Keep this card in your hand to score its points.' };
  if (a.effect === 'gain_resource') return { ...base, text: a.text, needs: 'resource' };
  if (a.effect === 'grow_dragon') {
    const ids = mine.filter((d) => d.stage < 3).map((d) => d.id);
    return { ...base, text: a.text, needs: 'dragon', dragons: ids, blocked: ids.length ? null : 'All your dragons are adults.' };
  }
  if (a.effect === 'send_fauna') return { ...base, text: a.text, fauna: faunaView(a.fauna!, {}), needs: 'hex', hexes: faunaHexes(g) };
  if (a.effect === 'heal_dragon') {
    const ids = mine.filter((d) => d.damage > 0).map((d) => d.id);
    return { ...base, text: a.text, needs: 'dragon', dragons: ids, blocked: ids.length ? null : 'None of your dragons is hurt.' };
  }
  return { ...base, text: a.text, needs: 'none' };
}

const NO_ROOM = 'No room for another dragon: build a roost first.';
const noHex = (b: BuildingDef) => `No empty ${b.terrain ? TERRAIN_NOUN[b.terrain] : 'land hex'} is adjacent to your buildings${b.beside ? ` and to ${besideText(b.beside)}` : ''}.`;
// A building's card text, plus where it must go.
const placeText = (b: BuildingDef) => `${b.text}${b.terrain ? ` Build on a ${TERRAIN_NOUN[b.terrain]}.` : ''}${b.beside ? ` Build adjacent to ${besideText(b.beside)}.` : ''}`;

export function seatState(g: Game, p: number, logLines = 15): SeatState {
  const pl = g.players[p];
  const s = score(g, p);
  const raid = g.raid;
  const housed = g.dragons.filter((d) => d.owner === p).length;
  const eggCost = specialProjectCost(DRAGONS.fire_whelp.cost);
  const income = production(g, p);
  income.livestock.base -= housed * TUNING.livestockPerDragon;
  return {
    seat: p,
    resources: { ...pl.resources },
    hiddenPoints: s.hidden,
    totalPoints: s.total,
    bankRate: bankRate(g, p),
    dragonsHoused: housed,
    dragonCapacity: dragonCapacity(g, p),
    income,
    hand: pl.hand.map((c) => cardView(g, p, c)),
    choice: pl.choice.map((c) => cardView(g, p, c)),
    handCap: TUNING.handCap,
    myTurn: g.phase === 'action' && g.turn === p,
    deciding: waitingOn(g).includes(p),
    basics: BASIC_BUILDINGS.map((k) => {
      const b = BUILDINGS[k];
      const hexes = buildableHexes(g, p, k);
      const why = (!b.onTower && !hexes.length ? noHex(b) : null) ?? afford(pl, b.cost);
      return { key: k, cls: b.class, name: b.name, text: placeText(b), cost: res(b.cost), affordable: canAfford(pl, b.cost), hexes, onTower: !!b.onTower, why };
    }),
    eggProject: { cost: res(eggCost), affordable: canAfford(pl, eggCost), elements: [...ELEMENTS], room: housed < dragonCapacity(g, p), why: (housed < dragonCapacity(g, p) ? null : NO_ROOM) ?? afford(pl, eggCost) },
    raidReady: g.dragons.filter((d) => d.owner === p && canRaid(d)).map((d) => d.id),
    huntable: huntable(g, p),
    perchable: perchHexes(g, p),
    perched: g.dragons.filter((d) => d.owner === p && d.perch).map((d) => d.id),
    cantAccept: Object.fromEntries(g.offers.filter((o) => o.to === p).flatMap((o) => { const why = acceptProblem(g, o); return why ? [[o.id, why]] : []; })),
    myVote: raid?.votes[p] ?? null,
    whyNoVote: raid?.step === 'vote' && !canVote(g, p) ? NO_VOTE : null,
    myChoice: raid?.choices[p] ?? null,
    log: events(g, (e) => !!e.to?.includes(p) && !isTalk(e.text), logLines),
    talk: events(g, (e) => isTalk(e.text) && (!e.to || e.to.includes(p)), 40),
  };
}

// What a TV or phone receives on every change.
export type SeatKind = 'player' | 'bot' | 'open';

export interface Lobby {
  code: string;
  started: boolean;
  // standIn: a bot makes this player's moves (they quit: left, or they're away).
  seats: { name: string; kind: SeatKind; connected: boolean; standIn: boolean; left: boolean }[];
  minPlayers: number;
  maxPlayers: number;
  file: string; // where the server saves the game
  remote: boolean; // no TV: a phone made the room, and each phone shows the table itself
}

export interface Snapshot {
  lobby: Lobby;
  seat: number; // the viewer's seat, -1 for the TV
  game: PublicState | null;
  scene: number; // ms left of the scene the TV is playing; everyone's next decision waits for it
  you: (SeatState & { name: string }) | null;
}
