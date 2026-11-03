// What the web clients receive, as JSON. publicState is everything on the TV;
// seatState is one player's hidden state and choices (their phone). Like
// view.ts, nothing hidden from a player ever goes into their state.

import { ACTIONS, BUILDINGS, DRAGONS, ELEMENTS, RESOURCES, STAGE_NAMES, TARGETING_TEXT, TARGETS, TUNING, UNITS, UPGRADES, type Bundle, type Resource } from './data.ts';
import {
  PROJECT_BUILDINGS, TITLE_NAMES, bankRate, buildableHexes, canAfford, canRaid, cardCost, cardKind, cardName, dragonCapacity,
  production, score, specialProjectCost, stageStats, titleValues, turnOrder, upgradeTargets, waitingOn,
  type Card, type Die, type Dragon, type Game, type TradeSide, type Title,
} from './engine.ts';

export type Res = Partial<Record<Resource, number>>;

export interface HexView {
  k: string;
  q: number;
  r: number;
  terrain: string;
  building: { type: string; name: string; owner: number; upgrade: string | null; floors: number } | null;
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
  fed: boolean;
  canRaid: boolean;
  status: string;
  targeting: string;
  attack: string;
  speed: number;
}

export interface UnitView {
  name: string;
  hp: number;
  maxHp: number;
  attack: string;
  chase: number;
  weak: string[];
  strong: string[];
}

export interface TargetView {
  key: string;
  name: string;
  units: UnitView[];
  loot: Res;
}

export interface RaidView {
  step: 'vote' | 'commit' | 'bail' | 'flee';
  candidates: TargetView[];
  voted: boolean[];
  target: TargetView | null; // units carry current health once the fight starts
  commits: string[][];
  ready: boolean[];
  decided: boolean[]; // fight-or-bail chosen (not what)
  fighting: boolean[]; // players still in the fight, once it starts
  fighters: string[];
  fleeDecided: boolean[];
  combatRound: number;
}

export interface EventView {
  i: number; // index in the game log, so clients can tell new events apart
  round: number;
  text: string;
  dice?: Die[];
  private?: boolean;
}

export interface PublicState {
  round: number;
  phase: Game['phase'];
  turn: number;
  turnOrder: number[];
  pointsToWin: number;
  waitingOn: number[];
  players: { publicPoints: number; dragons: number; buildings: number; titles: number; handSize: number; production: Record<string, { base: number; dice: number[] }>; bankRate: number }[];
  titles: { key: Title; name: string; holder: number | null; values: number[] }[];
  map: HexView[];
  dragons: DragonView[];
  offers: { id: string; from: number; to: number; give: string; get: string }[];
  raid: RaidView | null;
  raidsLeft: number;
  winner: number | null;
  finalTotals: number[] | null;
  log: EventView[];
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
  dragons: string[];
  blocked: string | null; // why it can't be played right now, if known
}

export interface SeatState {
  seat: number;
  resources: Record<Resource, number>;
  hiddenPoints: number;
  totalPoints: number;
  bankRate: number;
  dragonsHoused: number;
  dragonCapacity: number;
  hand: CardView[];
  handCap: number;
  myTurn: boolean;
  deciding: boolean;
  projects: { key: string; name: string; cost: Res; affordable: boolean; hexes: string[] }[];
  eggProject: { cost: Res; affordable: boolean; elements: string[]; room: boolean };
  raidReady: string[]; // my dragons that can be committed
  myVote: number | null;
  myChoice: 'fight' | 'bail' | null;
  myFlee: string[] | null;
  log: EventView[]; // private events for me
}

const res = (b: Bundle): Res => Object.fromEntries(RESOURCES.filter((r) => b[r]).map((r) => [r, b[r]!]));

function attackText(a: { targets: number; dice: number; sides: number }) {
  return `${a.targets > 1 ? `${a.targets}× ` : ''}${a.dice}d${a.sides}`;
}

function dragonView(d: Dragon): DragonView {
  const def = DRAGONS[d.key];
  const st = stageStats(d);
  const status = canRaid(d) ? 'ready' : d.stage === 0 ? 'egg' : !d.fed ? 'hungry' : 'hurt';
  return {
    id: d.id, owner: d.owner, name: def.name, element: def.element, stage: d.stage, stageName: STAGE_NAMES[d.stage],
    growth: d.growth, growthTime: def.growthTime, hp: st ? st.hp - d.damage : 0, maxHp: st ? st.hp : 0, fed: d.fed,
    canRaid: canRaid(d), status, targeting: TARGETING_TEXT[def.targeting], attack: st ? attackText(st) : '', speed: st?.speed ?? 0,
  };
}

function targetView(key: string, hp?: number[]): TargetView {
  const t = TARGETS[key];
  return {
    key, name: t.name, loot: res(t.loot),
    units: t.units.map((u, i) => {
      const x = UNITS[u];
      return { name: x.name, hp: hp ? hp[i] : x.hp, maxHp: x.hp, attack: attackText(x), chase: x.chase, weak: x.weak, strong: x.strong };
    }),
  };
}

function sideText(g: Game, s: TradeSide): string {
  const parts = RESOURCES.filter((r) => (s.res[r] ?? 0) > 0).map((r) => `${s.res[r]} ${r}`);
  for (const id of s.cards) {
    const c = g.players.flatMap((p) => p.hand).find((x) => x.id === id);
    parts.push(c ? `${cardName(c)} card` : `card ${id}`);
  }
  return parts.join(', ') || 'nothing';
}

function events(g: Game, keep: (e: Game['log'][number]) => boolean, n: number): EventView[] {
  const out: EventView[] = [];
  for (let i = g.log.length - 1; i >= 0 && out.length < n; i--) {
    const e = g.log[i];
    if (!keep(e)) continue;
    out.push({ i, round: e.round, text: e.text, ...(e.dice ? { dice: e.dice } : {}), ...(e.to ? { private: true } : {}) });
  }
  return out.reverse();
}

export function publicState(g: Game, logLines = 40): PublicState {
  const n = g.players.length;
  const raid = g.raid;
  return {
    round: g.round,
    phase: g.phase,
    turn: g.turn,
    turnOrder: turnOrder(g),
    pointsToWin: TUNING.pointsToWin,
    waitingOn: waitingOn(g),
    players: g.players.map((pl, p) => {
      const s = score(g, p);
      return { publicPoints: s.public, dragons: s.dragons, buildings: s.buildings, titles: s.titles, handSize: pl.hand.length, production: production(g, p), bankRate: bankRate(g, p) };
    }),
    titles: (Object.keys(TITLE_NAMES) as Title[]).map((t) => ({ key: t, name: TITLE_NAMES[t], holder: g.titles[t], values: titleValues(g, t) })),
    map: Object.entries(g.map).map(([k, h]) => {
      const b = g.buildings[k];
      return {
        k, q: h.q, r: h.r, terrain: h.terrain,
        building: b ? { type: b.type, name: b.type === 'tower' ? 'Tower' : BUILDINGS[b.type].name, owner: b.owner, upgrade: b.upgrade ? UPGRADES[b.upgrade].name : null, floors: b.floors } : null,
      };
    }),
    dragons: g.dragons.map(dragonView),
    offers: g.offers.map((o) => ({ id: o.id, from: o.from, to: o.to, give: sideText(g, o.give), get: sideText(g, o.get) })),
    raid: raid && {
      step: raid.step,
      candidates: raid.candidates.map((t) => targetView(t)),
      voted: raid.votes.map((v) => v !== null),
      target: raid.target ? targetView(raid.target, raid.units.length ? raid.units.map((u) => u.hp) : undefined) : null,
      commits: raid.commits,
      ready: raid.ready,
      decided: raid.choices.map((c) => c !== null),
      fighting: Array.from({ length: n }, (_, p) => raid.fighters.some((id) => g.dragons.find((d) => d.id === id)!.owner === p)),
      fighters: raid.fighters,
      fleeDecided: raid.flee.map((f) => f !== null),
      combatRound: raid.combatRound,
    },
    raidsLeft: g.raidsLeft,
    winner: g.winner,
    finalTotals: g.phase === 'over' ? g.players.map((_, p) => score(g, p).total) : null,
    log: events(g, (e) => !e.to, logLines),
  };
}

function cardView(g: Game, p: number, c: Card): CardView {
  const kind = cardKind(c);
  const pl = g.players[p];
  const mine = g.dragons.filter((d) => d.owner === p);
  const base = { id: c.id, kind, key: c.key, name: cardName(c), cost: res(cardCost(c)), affordable: canAfford(pl, cardCost(c)), hexes: [] as string[], dragons: [] as string[], blocked: null as string | null };
  if (kind === 'building') {
    const b = BUILDINGS[c.key];
    const hexes = b.onTower ? [] : buildableHexes(g, p, c.key);
    const text = `${b.text}${b.terrain ? ` Goes on ${b.terrain}.` : ''}`;
    return { ...base, text, needs: b.onTower ? 'none' : 'hex', hexes, blocked: !b.onTower && !hexes.length ? `No open ${b.terrain ?? ''} hex next to your buildings.`.replace('  ', ' ') : null };
  }
  if (kind === 'upgrade') {
    const u = UPGRADES[c.key];
    const hexes = upgradeTargets(g, p, c.key);
    return { ...base, text: `${u.text} (On a ${u.appliesTo} building.)`, needs: 'hex', hexes, blocked: hexes.length ? null : `You have no un-upgraded ${u.appliesTo} building.` };
  }
  if (kind === 'dragon') {
    const d = DRAGONS[c.key];
    const full = mine.length >= dragonCapacity(g, p);
    const adult = d.stages[2];
    const text = `${d.element[0].toUpperCase()}${d.element.slice(1)} dragon, hatches as an egg, grows every ${d.growthTime} step${d.growthTime > 1 ? 's' : ''}. As an adult: ${adult.hp} health, attacks ${attackText(adult)}, speed ${adult.speed}; ${TARGETING_TEXT[d.targeting]}.`;
    return { ...base, text, needs: 'none', blocked: full ? 'No room: build a roost first.' : null };
  }
  const a = ACTIONS[c.key];
  if (a.effect === 'hidden_point') return { ...base, text: a.text, needs: 'unplayable', blocked: 'Keep it: it scores while in your hand.' };
  if (a.effect === 'gain_resource') return { ...base, text: a.text, needs: 'resource' };
  if (a.effect === 'grow_dragon') {
    const ids = mine.filter((d) => d.stage < 3).map((d) => d.id);
    return { ...base, text: a.text, needs: 'dragon', dragons: ids, blocked: ids.length ? null : 'All your dragons are fully grown.' };
  }
  if (a.effect === 'heal_dragon') {
    const ids = mine.filter((d) => d.damage > 0).map((d) => d.id);
    return { ...base, text: a.text, needs: 'dragon', dragons: ids, blocked: ids.length ? null : 'None of your dragons is hurt.' };
  }
  return { ...base, text: a.text, needs: 'none' };
}

export function seatState(g: Game, p: number, logLines = 15): SeatState {
  const pl = g.players[p];
  const s = score(g, p);
  const raid = g.raid;
  const housed = g.dragons.filter((d) => d.owner === p).length;
  const eggCost = specialProjectCost(DRAGONS.fire_whelp.cost);
  return {
    seat: p,
    resources: { ...pl.resources },
    hiddenPoints: s.hidden,
    totalPoints: s.total,
    bankRate: bankRate(g, p),
    dragonsHoused: housed,
    dragonCapacity: dragonCapacity(g, p),
    hand: pl.hand.map((c) => cardView(g, p, c)),
    handCap: TUNING.handCap,
    myTurn: g.phase === 'action' && g.turn === p,
    deciding: waitingOn(g).includes(p),
    projects: PROJECT_BUILDINGS.map((k) => {
      const cost = specialProjectCost(BUILDINGS[k].cost);
      return { key: k, name: BUILDINGS[k].name, cost: res(cost), affordable: canAfford(pl, cost), hexes: buildableHexes(g, p, k) };
    }),
    eggProject: { cost: res(eggCost), affordable: canAfford(pl, eggCost), elements: [...ELEMENTS], room: housed < dragonCapacity(g, p) },
    raidReady: g.dragons.filter((d) => d.owner === p && canRaid(d)).map((d) => d.id),
    myVote: raid?.votes[p] ?? null,
    myChoice: raid?.choices[p] ?? null,
    myFlee: raid?.flee[p] ?? null,
    log: events(g, (e) => !!e.to?.includes(p), logLines),
  };
}

// What a TV or phone receives on every change.
export interface Lobby {
  code: string;
  started: boolean;
  seats: { name: string; bot: boolean; connected: boolean }[];
  minPlayers: number;
  maxPlayers: number;
  fleeDeadline: number | null; // ms epoch, while the flee choice is open
}

export interface Snapshot {
  lobby: Lobby;
  seat: number; // the viewer's seat, -1 for the TV
  game: PublicState | null;
  you: (SeatState & { name: string }) | null;
}
