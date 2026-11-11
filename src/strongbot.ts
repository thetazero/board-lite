// The strong bot (#482): a seat played by code, no model, as a free baseline
// for playtests and contests. It plays to win, cheaply:
//
// - On its turn it looks one step ahead. Every purchase it could make now
//   (a building on each hex it may go on, an upgrade, a special project, a
//   card), with the merchants trades that would pay for it, is tried on a copy
//   of the game and scored by `worth`, a guess at what the position is worth
//   in points: points now, plus what its production, resources, dragons and
//   nearness to titles should turn into before the game ends. It makes the
//   best purchase that raises that, and ends its turn when none does.
// - Fights (raids, clearing a hex) it estimates with its own dice, rolling
//   each fight some dozens of times, never the game's: it can't see the
//   dice the game will roll.
// - It sees only what its seat sees: the public board, every player's gold
//   and hand size, and its own hand and resources. Other players' hands,
//   resources and secret raid choices stay hidden from it.
// - It talks (#482: "it explicitly should use the chat"): it says which
//   kingdom it votes for and asks others to fight with it, asks the table for
//   the resource it's short of when it offers a trade, warns the table about a
//   player close to winning, and answers players who talk to it.
//
// Compute: a turn is a few hundred copies of the game and a few thousand
// simulated fights, tens of milliseconds.

import { ACTIONS, BASIC_RESOURCES, BEASTS, BUILDINGS, DRAGONS, ELEMENTS, ELEMENT_BEATS, RESOURCES, TARGETS, TUNING, UNITS, UPGRADES, combatPower, elementalDamage, faunaDef, type Attack, type BasicResource, type Bundle, type Element, type Resource, type UnitDef } from './data.ts';
import {
  RuleError, acceptProblem, apply, bankRates, buildableHexes, canRaid, cardCost, cardKind, dragonCapacity, dragonPower, faunaLoot, lootOf, offerFor, pname,
  production, rivalsPerched, score, specialProjectCost, stageStats, turnOrder, upgradeTargets, PROJECT_DRAGONS, PROJECT_UPGRADES, type Card, type Dragon, type Game, type Offer,
} from './engine.ts';
import { neighbors } from './map.ts';
import { standInCommands } from './bot.ts';
import { type Rng, next, pick } from './rng.ts';

// ---------- tuning of the bot itself ----------

// Its own numbers, apart from the game's (src/data.ts). Exported so the bench
// (src/botbench.ts) can play variants of it against each other.
export const TUNE = {
  // Points a basic resource held is worth with plenty of the game left; gold the same.
  V_RES: 0.2,
  V_GOLD: 0.2,
  // Points per point of combat power a dragon has raid-ready, each round: what
  // it brings in raids and clears over a round.
  KAPPA: 0.07,
  // How much an empty land hex beside its buildings is worth, early in the
  // game: room to build on later.
  FRONTIER: 0.12,
  // What a free dragon space is worth, up to 2 of them, while there's time to fill them.
  SLOT: 0.35,
  // The least gain, in points, for which it makes a move.
  MIN_GAIN: 0.05,
  // How long it waits for answers to its own offer before withdrawing it.
  OFFER_WAIT_MS: 45_000,
  // Fights rolled per estimate.
  SIMS: 60,
  // At most this many things said a round, its answers to others included.
  TALK_PER_ROUND: 3,
    // Others in a raid fight with all their dragons this often, else hold back.
  OTHERS_FIGHT: 0.6,
  // Snowball: the leader's pace so far times this guesses the rounds left.
  PACE: 0.7,
  // How far ahead production counts, as a share of the rounds left.
  HORIZON: 0.75,
  // How much a title it's near pulls, as a share of its points.
  PULL: 0.7,
};

export interface StrongOptions {
  name?: string; // its name at the table, so it knows when someone talks to it
  now?: number; // the clock, ms epoch (tests and sims fix it)
}

// When it first saw its own open offers waiting, by offer id (a module-level
// memory: offer ids are unique within a game, and a stale entry does no harm).
const offerSeen = new Map<string, number>();

// ---------- copies and trial moves ----------

export function copy(g: Game): Game {
  const { log: _, ...rest } = g;
  const c = structuredClone(rest) as Game;
  c.log = [];
  return c;
}

export function tryAll(g: Game, p: number, cmds: string[]): boolean {
  try {
    for (const c of cmds) apply(g, p, c);
    return true;
  } catch (e) {
    if (e instanceof RuleError) return false;
    throw e;
  }
}

// ---------- how far off the end is ----------

// Points each player shows the table (and, for itself, its hidden ones too).
function shown(g: Game, p: number, q: number): number {
  return q === p ? score(g, q).total : score(g, q).public;
}

// A guess at how many rounds are left: the leader's pace so far, which only
// speeds up as engines grow.
export function roundsLeft(g: Game, p: number): number {
  const lead = Math.max(...g.players.map((_, q) => shown(g, p, q)));
  const pace = Math.max(1.6, lead / Math.max(1, g.round));
  const r = ((TUNING.pointsToWin - lead) / pace) * TUNE.PACE;
  return Math.max(1, Math.min(18, r));
}

// ---------- what a position is worth ----------

const avg = (sides: number) => (sides + 1) / 2;

function expectedMakes(g: Game, p: number): Record<Resource, number> {
  const prod = production(g, p);
  return Object.fromEntries(RESOURCES.map((r) => [r, prod[r].base + prod[r].dice.reduce((s, d) => s + avg(d), 0)])) as Record<Resource, number>;
}

function growthRate(g: Game, p: number): number {
  return 1 + Object.entries(g.buildings).filter(([k, b]) => b.owner === p && b.type === 'hatchery' && !g.map[k].fauna).length;
}

const powerAt = (key: string, stage: number) => (stage === 0 ? 0 : combatPower(DRAGONS[key].stages[stage - 1]));

// A dragon over the next h rounds: the power it has raid-ready, round by
// round, less the livestock it eats.
function dragonWorth(d: Dragon, rate: number, h: number, food: number): number {
  const def = DRAGONS[d.key];
  let stage = d.stage, growth = d.growth, dmg = d.damage, sum = 0, eats = 0;
  const rounds = Math.ceil(h);
  for (let r = 0; r < rounds; r++) {
    if (stage > 0) eats++;
    if (dmg > 0) dmg = Math.max(0, dmg - TUNING.healPerRound);
    else if (stage < 3) {
      growth += rate;
      while (stage < 3 && growth >= def.growthTime) { growth -= def.growthTime; stage++; }
    }
    const hp = stage ? def.stages[stage - 1].hp : 0;
    if (stage > 0 && dmg < hp && !d.perch) sum += powerAt(d.key, stage);
  }
  return sum * TUNE.KAPPA - eats * food;
}

// A dragon's power a few rounds on, for Strongest Dragon Army.
function powerSoon(d: Dragon, rate: number, rounds: number): number {
  const def = DRAGONS[d.key];
  let stage = d.stage, growth = d.growth, dmg = d.damage;
  for (let r = 0; r < rounds; r++) {
    if (dmg > 0) dmg = Math.max(0, dmg - TUNING.healPerRound);
    else if (stage < 3) { growth += rate; while (stage < 3 && growth >= def.growthTime) { growth -= def.growthTime; stage++; } }
  }
  return powerAt(d.key, stage);
}

function armyOf(g: Game, q: number): number {
  return g.dragons.filter((d) => d.owner === q).reduce((s, d) => s + dragonPower(d), 0);
}

// How close it is to each title it doesn't hold, in points: nothing far off,
// most of the 7 when it's about to take one.
function titlePull(g: Game, p: number, h: number): number {
  const rate = growthRate(g, p);
  const mine = {
    army: g.dragons.filter((d) => d.owner === p).reduce((s, d) => s + powerSoon(d, rate, Math.min(3, Math.ceil(h))), 0),
    tower: g.buildings[g.towers[p]].floors,
    hoard: g.players[p].resources.gold,
  };
  const theirs = (t: 'army' | 'tower' | 'hoard', q: number) => (t === 'army' ? armyOf(g, q) : t === 'tower' ? g.buildings[g.towers[q]].floors : g.players[q].resources.gold);
  let sum = 0;
  for (const t of ['army', 'tower', 'hoard'] as const) {
    const best = Math.max(0, ...g.players.map((_, q) => (q === p ? 0 : theirs(t, q))));
    const holder = g.titles[t];
    if (holder === p) {
      // Held: worth something to stay ahead of the next best.
      const margin = (mine[t] - best) / Math.max(1, TUNING.titleMinimum[t]);
      sum += TUNING.titlePoints * 0.25 * Math.min(1, Math.max(0, margin * 3));
      continue;
    }
    const need = Math.max(TUNING.titleMinimum[t], best + 1);
    const frac = Math.min(1, mine[t] / need);
    sum += TUNING.titlePoints * frac ** 1.5 * (h >= 2 ? TUNE.PULL : TUNE.PULL * 0.65);
  }
  return sum;
}

// Empty land hexes beside its buildings (fauna on one counts half): where it can still build.
function frontier(g: Game, p: number): number {
  const seen = new Set<string>();
  let n = 0;
  for (const [k, b] of Object.entries(g.buildings)) {
    if (b.owner !== p) continue;
    for (const m of neighbors(k)) {
      const hex = g.map[m];
      if (!hex || seen.has(m) || hex.terrain === 'ocean' || g.buildings[m]) continue;
      seen.add(m);
      const w = hex.terrain === 'desert' ? 0.3 : hex.terrain === 'harbor' ? 0.6 : 1;
      n += hex.fauna ? w / 2 : w;
    }
  }
  return n;
}

// Resources held count in full up to what a few purchases take; past that,
// a quarter each: a pile that size can't all be spent well.
function stock(n: number, r: Resource): number {
  const cap = r === 'gold' ? 24 : 12;
  return Math.min(n, cap) + Math.max(0, n - cap) * 0.25;
}

// What the position is worth to player p, in points, by what p can see.
export function worth(g: Game, p: number, h = roundsLeft(g, p) * TUNE.HORIZON): number {
  const pl = g.players[p];
  const sc = score(g, p);
  const held = Math.min(1, Math.max(0.25, h / 6));
  let v = sc.total;
  const makes = expectedMakes(g, p);
  for (const r of RESOURCES) {
    const unit = r === 'gold' ? TUNE.V_GOLD : TUNE.V_RES;
    v += makes[r] * h * unit + stock(pl.resources[r], r) * unit * held;
  }
  const rate = growthRate(g, p);
  const mine = g.dragons.filter((d) => d.owner === p);
  // Food costs what livestock is worth to it: little out of a big herd.
  const food = TUNE.V_RES * held * (pl.resources.livestock > 12 + mine.length * 2 ? 0.25 : 1);
  for (const d of mine) v += dragonWorth(d, rate, h, food);
  const free = Math.max(0, dragonCapacity(g, p) - mine.length);
  v += Math.min(2, free) * TUNE.SLOT * Math.min(1, h / 6);
  v += frontier(g, p) * TUNE.FRONTIER * Math.min(1, h / 8);
  v += titlePull(g, p, h);
  return v;
}

// What a player's position shows the table, for judging harm done to a rival:
// points and production only, all of it public.
function publicWorth(g: Game, q: number, h: number): number {
  const makes = expectedMakes(g, q);
  return score(g, q).public + RESOURCES.reduce((s, r) => s + makes[r] * h * TUNE.V_RES, 0);
}

// ---------- paying with the merchants ----------

// The merchants trades that would let p pay `cost`, or null if they can't.
export function merchantPlan(g: Game, p: number, cost: Bundle): string[] | null {
  const have = { ...g.players[p].resources };
  if ((cost.gold ?? 0) > have.gold) return null;
  const rates = bankRates(g, p);
  const cmds: string[] = [];
  for (const r of BASIC_RESOURCES) {
    let need = (cost[r] ?? 0) - have[r];
    while (need > 0) {
      let best: BasicResource | null = null, bestN = 0;
      for (const s of BASIC_RESOURCES) {
        if (s === r) continue;
        const n = Math.floor((have[s] - (cost[s] ?? 0)) / rates[s]);
        if (n > bestN) { best = s; bestN = n; }
      }
      if (!best) return null;
      const n = Math.min(need, bestN);
      cmds.push(`merchants ${best} ${r} ${n}`);
      have[best] -= n * rates[best];
      have[r] += n;
      need -= n;
    }
  }
  return cmds;
}

// ---------- fights ----------

interface Fighter { key: string; owner: number; hp: number; stage: number }
interface Foe { def: UnitDef; hp: number }

const WEAK_TO: Record<string, Element[]> = Object.fromEntries(['neutral', ...ELEMENTS].map((e) => [e, ELEMENTS.filter((by) => ELEMENT_BEATS[by] === e)]));

function rollSum(rng: Rng, a: Attack): number {
  let s = 0;
  for (let i = 0; i < a.dice; i++) s += 1 + Math.floor(next(rng) * a.sides);
  return s;
}

// One fight to the end, as the engine fights it: returns whether every foe
// fell, and each fighter's health after.
function fightOnce(fighters: Fighter[], foes: Foe[], rng: Rng): { won: boolean; hp: number[] } {
  const hp = fighters.map((f) => f.hp);
  const fhp = foes.map((f) => f.hp);
  const dragonsFirst = next(rng) < 0.5;
  const stats = fighters.map((f) => DRAGONS[f.key].stages[f.stage - 1]);
  const els = fighters.map((f) => DRAGONS[f.key].element);
  const dragonsStrike = () => {
    for (let i = 0; i < fighters.length; i++) {
      if (hp[i] <= 0) continue;
      const st = stats[i];
      const alive = fhp.flatMap((h, j) => (h > 0 ? [j] : []));
      if (!alive.length) return;
      for (let a = alive.length - 1; a > 0; a--) { const b = Math.floor(next(rng) * (a + 1)); [alive[a], alive[b]] = [alive[b], alive[a]]; }
      const rule = DRAGONS[fighters[i].key].targeting;
      if (rule === 'lowest_health') alive.sort((x, y) => fhp[x] - fhp[y]);
      if (rule === 'strongest_attacker') alive.sort((x, y) => foes[y].def.targets * foes[y].def.dice * (foes[y].def.sides + 1) - foes[x].def.targets * foes[x].def.dice * (foes[x].def.sides + 1));
      if (rule === 'weak_to_me') alive.sort((x, y) => (WEAK_TO[foes[x].def.element].includes(els[i]) ? 0 : 1) - (WEAK_TO[foes[y].def.element].includes(els[i]) ? 0 : 1));
      for (const j of alive.slice(0, st.targets)) fhp[j] = Math.max(0, fhp[j] - elementalDamage(rollSum(rng, st), els[i], foes[j].def.element));
    }
  };
  const foesStrike = () => {
    for (let j = 0; j < foes.length; j++) {
      if (fhp[j] <= 0) continue;
      for (let t = 0; t < foes[j].def.targets; t++) {
        const up = hp.flatMap((h, i) => (h > 0 ? [i] : []));
        if (!up.length) return;
        const i = up[Math.floor(next(rng) * up.length)];
        hp[i] = Math.max(0, hp[i] - elementalDamage(rollSum(rng, foes[j].def), foes[j].def.element, els[i]));
      }
    }
  };
  for (let round = 0; round < 60; round++) {
    if (!dragonsFirst) foesStrike();
    dragonsStrike();
    if (dragonsFirst) foesStrike();
    if (fhp.every((h) => h <= 0)) return { won: true, hp };
    if (hp.every((h) => h <= 0)) return { won: false, hp };
  }
  return { won: false, hp };
}

const fighterOf = (d: Dragon): Fighter => ({ key: d.key, owner: d.owner, stage: d.stage, hp: stageStats(d)!.hp - d.damage });

// What the hits a dragon takes cost, in points: a hurt dragon heals instead of
// growing, and a knocked-out one misses the rest of the round.
function hurtCost(d: Fighter, hpAfter: number, h: number): number {
  const lost = d.hp - hpAfter;
  if (lost <= 0) return 0;
  const heals = Math.ceil((DRAGONS[d.key].stages[d.stage - 1].hp - hpAfter) / TUNING.healPerRound);
  const growing = d.stage < 3 ? heals * 0.35 : 0;
  const ko = hpAfter <= 0 ? 0.3 + powerAt(d.key, d.stage) * TUNE.KAPPA * 2 : 0;
  return Math.min(h, 6) / 6 * (growing + ko + lost * 0.02);
}

function valueOf(b: Bundle, h: number): number {
  const held = Math.min(1, Math.max(0.25, h / 6));
  return RESOURCES.reduce((s, r) => s + (b[r] ?? 0) * (r === 'gold' ? TUNE.V_GOLD : TUNE.V_RES), 0) * Math.max(held, 0.6);
}

// Clearing hex k with dragons ds: the chance it works, and what it costs in hits.
function clearOdds(g: Game, p: number, k: string, ds: Dragon[], rng: Rng, h: number): { win: number; hurt: number } {
  const f = g.map[k].fauna;
  const foes: Foe[] = [...(f ? [{ def: faunaDef(f), hp: faunaDef(f).hp }] : []), ...rivalsPerched(g, p, k).map((d) => ({ def: { name: '', ...stageStats(d)!, element: DRAGONS[d.key].element } as UnitDef, hp: stageStats(d)!.hp - d.damage }))];
  const fs = ds.map(fighterOf);
  let wins = 0, hurt = 0;
  for (let i = 0; i < TUNE.SIMS; i++) {
    const r = fightOnce(fs, foes, rng);
    if (r.won) wins++;
    fs.forEach((d, j) => (hurt += hurtCost(d, r.hp[j], h)));
  }
  return { win: wins / TUNE.SIMS, hurt: hurt / TUNE.SIMS };
}

// ---------- raids ----------


interface RaidPlan { ev: number; fight: string[]; win: number }

// What a raid on kingdom t is worth to p if p fights with `mine` (ids; empty
// holds back), and the others each fight with all theirs or hold back.
function raidValue(g: Game, p: number, t: string, inRaid: Dragon[][], mine: string[], rng: Rng, h: number, sims = TUNE.SIMS): { ev: number; win: number } {
  const loot = lootOf(g, t);
  const units: Foe[] = TARGETS[t].units.map((u) => ({ def: UNITS[u], hp: UNITS[u].hp }));
  const order = turnOrder(g);
  const pts = TARGETS[t].points ?? 0;
  let ev = 0, wins = 0;
  for (let s = 0; s < sims; s++) {
    const fighters: Dragon[] = [];
    for (let q = 0; q < g.players.length; q++) {
      if (q === p) fighters.push(...inRaid[q].filter((d) => mine.includes(d.id)));
      else if (inRaid[q].length && next(rng) < TUNE.OTHERS_FIGHT) fighters.push(...inRaid[q]);
    }
    if (!fighters.length) continue;
    const fs = fighters.map(fighterOf);
    const r = fightOnce(fs, units, rng);
    const after = new Map(fighters.map((d, i) => [d.id, r.hp[i]]));
    for (const [i, d] of fighters.entries()) if (d.owner === p) ev -= hurtCost(fs[i], r.hp[i], h);
    if (!r.won) continue;
    wins++;
    const power = g.players.map((_, q) => inRaid[q].filter((d) => (after.get(d.id) ?? 1) > 0).reduce((s2, d) => s2 + dragonPower(d), 0));
    const total = power.reduce((a, b) => a + b, 0);
    if (!power[p]) continue;
    ev += valueOf(loot, h) * power[p] / total;
    if (pts) {
      const best = Math.max(...power);
      if (order.find((q) => power[q] === best) === p) ev += pts;
    }
  }
  return { ev: ev / sims, win: wins / sims };
}

// The ways p might fight: hold back, all in, or just the grown ones.
function fightOptions(mine: Dragon[]): string[][] {
  const all = mine.map((d) => d.id);
  const grown = mine.filter((d) => d.stage >= 2).map((d) => d.id);
  const adults = mine.filter((d) => d.stage === 3).map((d) => d.id);
  const opts = [[], all, grown, adults].filter((o, i, xs) => xs.findIndex((x) => x.join() === o.join()) === i);
  return opts;
}

function bestRaidPlan(g: Game, p: number, t: string, inRaid: Dragon[][], rng: Rng, h: number): RaidPlan {
  let best: RaidPlan = { ev: -Infinity, fight: [], win: 0 };
  for (const fight of fightOptions(inRaid[p])) {
    const { ev, win } = raidValue(g, p, t, inRaid, fight, rng, h);
    if (ev > best.ev + 0.02) best = { ev, fight, win };
  }
  return best;
}

function readyBy(g: Game): Dragon[][] {
  return g.players.map((_, q) => g.dragons.filter((d) => d.owner === q && canRaid(d)));
}

// ---------- talk ----------

function talkedThisRound(g: Game, p: number): number {
  const mark = `${pname(p)} says: "`, priv = `${pname(p)} to P`;
  let n = 0;
  for (let i = g.log.length - 1; i >= 0 && g.log[i].round === g.round; i--) if (g.log[i].text.startsWith(mark) || g.log[i].text.startsWith(priv)) n++;
  return n;
}

function saidThisTurn(g: Game, p: number, words: string): boolean {
  for (let i = g.log.length - 1; i >= 0; i--) {
    if (g.log[i].ev?.k === 'turn') return false;
    if (g.log[i].text.startsWith(`${pname(p)} says: "`) && g.log[i].text.includes(words)) return true;
  }
  return false;
}

function saidThisRound(g: Game, p: number, words: string): boolean {
  for (let i = g.log.length - 1; i >= 0 && g.log[i].round === g.round; i--) if (g.log[i].text.startsWith(`${pname(p)} says: "`) && g.log[i].text.includes(words)) return true;
  return false;
}

const RES_WORDS = /\b(stone|timber|crystal|livestock|gold|trade|offer|swap|deal|need|want|give)\b/i;
const RAID_WORDS = /\b(raid|vote|fight|attack|kingdom|hold back|join)\b/i;

// The latest thing someone said to p (privately, or publicly by name) that p
// hasn't answered: p has said nothing since.
function unanswered(g: Game, p: number, name?: string): { from: number; text: string; private: boolean } | null {
  const me = new RegExp(`\\b(${pname(p)}${name ? `|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : ''})\\b`, 'i');
  for (let i = g.log.length - 1; i >= 0 && g.log.length - i < 80; i--) {
    const e = g.log[i];
    if (e.ev?.k !== 'talk') continue;
    if (e.to && !e.to.includes(p)) continue;
    const m = /^P(\d+)(?: says| to P(\d+) \(private\)): "(.*)"$/s.exec(e.text);
    if (!m) continue;
    const from = Number(m[1]) - 1;
    if (from === p) return null; // spoken since
    const priv = !!m[2];
    if (priv || me.test(m[3])) return { from, text: m[3], private: priv };
  }
  return null;
}

// ---------- the moves ----------

export function strongCommands(g: Game, p: number, rng: Rng, opts: StrongOptions = {}): string[] | null {
  const pl = g.players[p];
  const now = opts.now ?? Date.now();
  const h = roundsLeft(g, p) * TUNE.HORIZON;
  if (g.phase === 'cards') {
    const reply = replyTo(g, p, opts.name, h, rng);
    if (reply) return [reply];
    return pl.choice.length ? [`keep ${keepChoice(g, p, h).id}`] : [];
  }
  if (g.phase === 'discard') return [`discard ${discardChoice(g, p, h).join(' ')}`];
  if (g.phase === 'raid') return raidMove(g, p, rng, h);
  if (g.phase !== 'action') return [];
  // Offers made to it come first: it answers them, its turn or not.
  for (const o of g.offers.filter((x) => offerFor(x, p))) return [answer(g, p, o, h, rng)];
  if (p !== g.turn) return [];
  const reply = replyTo(g, p, opts.name, h, rng);
  if (reply) return [reply];
  // Its own offers: wait for answers a while, then withdraw them.
  const mineOpen = g.offers.filter((o) => o.from === p);
  for (const o of mineOpen) {
    if (!offerSeen.has(o.id)) offerSeen.set(o.id, now);
    if (now - offerSeen.get(o.id)! > TUNE.OFFER_WAIT_MS) return [`cancel ${o.id}`];
  }
  if (mineOpen.some((o) => g.players.some((_, q) => offerFor(o, q)))) return null;
  const warn = warning(g, p);
  if (warn) return [warn];
  const clear = bestClear(g, p, rng, h);
  if (clear) return [clear];
  const harm = sabotage(g, p, h);
  if (harm) return [harm];
  const horn = hornMove(g, p, rng, h);
  if (horn) return [horn];
  const buy = bestPurchase(g, p, h);
  if (buy) {
    // Short of 1 or 2 of something: ask the table at 2 for 1 before the merchants' 4 for 1.
    const ask = buy.cmds.length > 1 ? askTable(g, p, buy.cmds) : null;
    if (ask) return ask;
    return [buy.cmds[0]];
  }
  return ['end'];
}

// Whether p is waiting on answers to its own offer, with nothing to do till they come.
export function strongWaits(g: Game, p: number, opts: StrongOptions = {}): boolean {
  try {
    return strongCommands(g, p, { state: g.nextId }, opts) === null;
  } catch {
    return false;
  }
}

// Applies p's next move and returns it, or null while it waits on answers to its offer.
export function strongMove(g: Game, p: number, rng: Rng, opts: StrongOptions = {}): string | null {
  let cmds: string[] | null;
  try {
    cmds = strongCommands(g, p, rng, opts);
  } catch (e) {
    if (!(e instanceof RuleError)) console.error('The strong bot fell back on the stand-in:', e);
    cmds = [];
  }
  if (cmds === null) return null;
  for (const cmd of [...cmds, ...standInCommands(g, p)]) {
    try {
      apply(g, p, cmd);
      return cmd;
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  }
  throw new Error(`The strong bot found no legal move for ${pname(p)} in phase ${g.phase}`);
}

// ---------- purchases ----------

interface Purchase { cmds: string[]; gain: number; what: string }

// Everything p might buy now: the commands that buy it, and its cost. A
// dragon with no room for it comes with the roost or floor that houses it.
export function purchases(g: Game, p: number): { cmds: string[]; cost: Bundle; what: string }[] {
  const out: { cmds: string[]; cost: Bundle; what: string }[] = [];
  const one = (cmd: string, cost: Bundle, what: string) => out.push({ cmds: [cmd], cost, what });
  const pl = g.players[p];
  const mine = g.dragons.filter((d) => d.owner === p);
  const room = mine.length < dragonCapacity(g, p);
  const roosts: { cmd: string; cost: Bundle }[] = [];
  for (const b of Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].basic)) {
    for (const k of buildableHexes(g, p, b)) {
      const cmd = `build ${b}${BUILDINGS[b].onTower ? '' : ` ${k}`}`;
      one(cmd, BUILDINGS[b].cost, BUILDINGS[b].name);
      if (BUILDINGS[b].dragonCapacity) roosts.push({ cmd, cost: BUILDINGS[b].cost });
    }
  }
  const eggs: { cmd: string; cost: Bundle; what: string }[] = [{ cmd: `project ${eggElement(g, p)}`, cost: specialProjectCost('egg', DRAGONS.fire_whelp.cost), what: 'an egg' }];
  const seen = new Set<string>();
  for (const c of pl.hand) {
    if (seen.has(c.key)) continue; // copies of one card are tried once
    seen.add(c.key);
    const kind = cardKind(c);
    if (kind === 'building') for (const k of buildableHexes(g, p, c.key)) one(`build ${c.id} ${k}`, cardCost(c), BUILDINGS[c.key].name);
    if (kind === 'upgrade') for (const k of upgradeTargets(g, p, c.key)) one(`upgrade ${c.id} ${k}`, cardCost(c), UPGRADES[c.key].name);
    if (kind === 'dragon') eggs.push({ cmd: `play ${c.id}`, cost: cardCost(c), what: DRAGONS[c.key].name });
    if (kind === 'action') {
      const a = ACTIONS[c.key];
      if (a.effect === 'gain_gold') one(`play ${c.id}`, a.cost, a.name);
      if (a.effect === 'gain_resource') for (const r of BASIC_RESOURCES) one(`play ${c.id} ${r}`, a.cost, a.name);
      if (a.effect === 'grow_dragon') for (const d of mine.filter((x) => x.stage < 3)) one(`play ${c.id} ${d.id}`, a.cost, a.name);
      if (a.effect === 'heal_dragon') for (const d of mine.filter((x) => x.damage > 0)) one(`play ${c.id} ${d.id}`, a.cost, a.name);
    }
  }
  for (const e of eggs) {
    if (room) out.push({ cmds: [e.cmd], cost: e.cost, what: e.what });
    // No room: the roost or floor first. A roost's hex barely matters, so a few are tried.
    else for (const r of roosts.slice(0, 4)) out.push({ cmds: [r.cmd, e.cmd], cost: addBundles(r.cost, e.cost), what: e.what });
  }
  for (const u of PROJECT_UPGRADES) for (const k of upgradeTargets(g, p, u)) one(`project ${u} ${k}`, specialProjectCost('upgrade', UPGRADES[u].cost), UPGRADES[u].name);
  return out;
}

function addBundles(a: Bundle, b: Bundle): Bundle {
  const out: Bundle = {};
  for (const r of RESOURCES) if ((a[r] ?? 0) + (b[r] ?? 0)) out[r] = (a[r] ?? 0) + (b[r] ?? 0);
  return out;
}

// The element for a new egg: what the great beasts and the big kingdoms are
// weak to, the ones it has fewest of first.
function eggElement(g: Game, p: number): Element {
  const wanted: Element[] = [];
  if (g.slain.thunderbird === undefined) wanted.push('ice');
  if (g.slain.leviathan === undefined) wanted.push('lightning');
  wanted.push('water', 'air', 'ice', 'lightning', 'fire');
  const have = (e: Element) => g.dragons.filter((d) => d.owner === p && DRAGONS[d.key].element === e).length;
  return wanted.reduce((a, b) => (have(b) < have(a) ? b : a));
}

export function bestPurchase(g: Game, p: number, h: number): Purchase | null {
  const base = worth(g, p, h);
  let best: Purchase | null = null;
  for (const { cmds: buy, cost, what } of purchases(g, p)) {
    const plan = merchantPlan(g, p, cost);
    if (!plan) continue;
    const cmds = [...plan, ...buy];
    const c = copy(g);
    if (!tryAll(c, p, cmds)) continue;
    const gain = worth(c, p, h) - base;
    if (gain > TUNE.MIN_GAIN && (!best || gain > best.gain)) best = { cmds, gain, what };
  }
  return best;
}

// Before trading 4 for 1 with the merchants for a resource it's 1 or 2 short
// of, ask the table for it at 2 for 1, once a turn.
function askTable(g: Game, p: number, cmds: string[]): string[] | null {
  const m = cmds.map((c) => /^merchants (\w+) (\w+) (\d+)$/.exec(c)).filter((x): x is RegExpExecArray => !!x);
  if (m.length !== 1 || bankRates(g, p)[m[0][1] as BasicResource] < 4) return null;
  const [, give, get, n] = m[0];
  const times = Number(n);
  if (times > 2) return null;
  // Asked already this turn: the turn's offers are in the log since its turn began.
  for (let i = g.log.length - 1; i >= 0; i--) {
    const ev = g.log[i].ev;
    if (ev?.k === 'turn') break;
    if (ev?.k === 'offer' && ev.p === p) return null;
  }
  const offer = `offer anyone give ${times * 2} ${give} get ${times} ${get}`;
  // Said first, then offered: one move each.
  const line = `Anyone spare ${times} ${get}? ${times * 2} ${give} for ${times === 1 ? 'it' : 'them'}.`;
  if (!saidThisTurn(g, p, line)) return talkedThisRound(g, p) < TUNE.TALK_PER_ROUND ? [`say ${line}`, offer] : [offer];
  return [offer];
}

// ---------- answering offers ----------

// The best it could do this turn from a position: what it's worth, plus its best purchase.
function prospects(g: Game, p: number, h: number): number {
  const w = worth(g, p, h);
  const buy = bestPurchase(g, p, h);
  return w + (buy ? buy.gain : 0);
}

// The player most likely to win, by what the table sees: the most points shown.
function leader(g: Game, p: number): { q: number; pts: number } {
  let q = -1, pts = -1;
  for (let i = 0; i < g.players.length; i++) {
    if (i === p) continue;
    const s = score(g, i).public;
    if (s > pts) { q = i; pts = s; }
  }
  return { q, pts };
}

function answer(g: Game, p: number, o: Offer, h: number, _rng: Rng): string {
  if (acceptProblem(g, o, p) || o.get.cards.length) return `decline ${o.id}`;
  const lead = leader(g, p);
  const mineNow = score(g, p).total;
  // No help for a rival close to winning, or well ahead.
  if (o.from === lead.q && (lead.pts >= TUNING.pointsToWin - 12 || lead.pts > mineNow + 8)) return `decline ${o.id}`;
  const before = prospects(g, p, h);
  const c = copy(g);
  const pl = c.players[p];
  for (const r of RESOURCES) pl.resources[r] += (o.give.res[r] ?? 0) - (o.get.res[r] ?? 0);
  // A card it gains: kept in hand, worth a little.
  const cardGain = o.give.cards.length * 0.4;
  const after = prospects(c, p, h) + cardGain;
  // It wants to come out ahead, and by more for the leader.
  const margin = o.from === lead.q ? 0.5 : 0.15;
  return after > before + margin ? `accept ${o.id}` : `decline ${o.id}`;
}

// ---------- clearing hexes ----------

function bestClear(g: Game, p: number, rng: Rng, h: number): string | null {
  const ready = g.dragons.filter((d) => d.owner === p && canRaid(d));
  if (!ready.length) return null;
  const base = worth(g, p, h);
  const targets = new Set<string>();
  for (const [k, b] of Object.entries(g.buildings)) {
    if (b.owner === p && (g.map[k].fauna || rivalsPerched(g, p, k).length)) targets.add(k);
    if (b.owner === p) for (const m of neighbors(k)) if (g.map[m]?.fauna && !BEASTS[g.map[m].fauna!]) targets.add(m);
  }
  for (const k of Object.keys(g.map)) if (BEASTS[g.map[k].fauna ?? ''] && g.beastTried[p] !== g.round) targets.add(k);
  let best: { cmd: string; ev: number } | null = null;
  const subsets = (() => {
    const byPower = [...ready].sort((a, b) => dragonPower(b) - dragonPower(a));
    const out: Dragon[][] = [byPower];
    for (let n = 1; n < byPower.length; n++) out.push(byPower.slice(0, n));
    return out;
  })();
  for (const k of targets) {
    const f = g.map[k].fauna;
    const great = f ? BEASTS[f] : undefined;
    // What clearing it brings: its loot, its points, and the position without it.
    const c = copy(g);
    delete c.map[k].fauna;
    for (const d of c.dragons) if (d.perch === k && d.owner !== p) delete d.perch;
    if (great) c.slain[f!] = p;
    let gain = worth(c, p, h) - base + (f ? valueOf(faunaLoot(g, k), h) : 0);
    if (great && f === 'thunderbird') gain += 0; // the peak's bonus shows in worth only for buildings there
    if (gain <= 0.2) continue;
    for (const ds of subsets) {
      const odds = clearOdds(g, p, k, ds, rng, h);
      const need = great ? 0.45 : 0.7;
      if (odds.win < need) continue;
      const ev = odds.win * gain - odds.hurt;
      if (ev > 0.3 && (!best || ev > best.ev)) best = { cmd: `clear ${k} ${ds.map((d) => d.id).join(' ')}`, ev };
    }
  }
  return best?.cmd ?? null;
}

// ---------- action cards that hurt rivals or call raids ----------

// Rouse the Bear or Wake the Basilisk on the leading rival's best building.
function sabotage(g: Game, p: number, h: number): string | null {
  const pl = g.players[p];
  const card = pl.hand.find((c) => ACTIONS[c.key]?.effect === 'send_fauna');
  if (!card || (pl.resources.crystal ?? 0) < (ACTIONS[card.key].cost.crystal ?? 0)) return null;
  const lead = leader(g, p);
  if (lead.q < 0) return null;
  const mineNow = score(g, p).total;
  const weight = lead.pts >= mineNow ? 0.6 : 0.3;
  const beast = faunaDef(ACTIONS[card.key].fauna!);
  const theirPower = g.dragons.filter((d) => d.owner === lead.q && canRaid(d)).reduce((s, d) => s + dragonPower(d), 0);
  // A rival with dragons to spare clears it soon.
  const lasts = theirPower >= 2 * combatPower(beast) ? 0.25 : theirPower >= combatPower(beast) ? 0.5 : 1;
  const before = publicWorth(g, lead.q, Math.min(h, 4));
  let best: { k: string; harm: number } | null = null;
  for (const [k, b] of Object.entries(g.buildings)) {
    if (b.owner !== lead.q || b.type === 'tower' || g.map[k].fauna) continue;
    // Not beside its own buildings, where it would be in its own way.
    if (neighbors(k).some((m) => g.buildings[m]?.owner === p)) continue;
    const c = copy(g);
    c.map[k].fauna = ACTIONS[card.key].fauna!;
    c.map[k].sent = true;
    const harm = (before - publicWorth(c, lead.q, Math.min(h, 4))) * lasts * weight;
    if (!best || harm > best.harm) best = { k, harm };
  }
  return best && best.harm > 0.6 ? `play ${card.id} ${best.k}` : null;
}

// A War Horn, when another raid is worth more than its crystal.
function hornMove(g: Game, p: number, rng: Rng, h: number): string | null {
  const card = g.players[p].hand.find((c) => ACTIONS[c.key]?.effect === 'extra_raid');
  if (!card || g.players[p].resources.crystal < 1) return null;
  const inRaid = readyBy(g);
  if (!inRaid[p].length) return null;
  const best = Math.max(...Object.keys(TARGETS).map((t) => bestRaidPlan(g, p, t, inRaid, rng, h).ev));
  return best > 1.2 ? `play ${card.id}` : null;
}

// ---------- the raid ----------

function raidMove(g: Game, p: number, _rng: Rng, h: number): string[] {
  const raid = g.raid!;
  // Its own dice, seeded by the round and the raid, so saying its vote and
  // then casting it pick the same kingdom.
  const rng: Rng = { state: (g.round * 7919 + p * 104729 + g.raidsLeft * 31 + g.log.filter((e) => e.ev?.k === 'raid' && e.round === g.round).length * 17) | 0 };
  if (raid.step === 'vote') {
    const inRaid = readyBy(g);
    const evs = raid.candidates.map((t) => bestRaidPlan(g, p, t, inRaid, rng, h).ev);
    // Votes so far (public) and what each vote of its own would make the target.
    const power = (q: number) => inRaid[q].reduce((s, d) => s + dragonPower(d), 0);
    const tally = raid.candidates.map((_, i) => raid.votes.reduce<number>((s, v, q) => s + (v === i ? power(q) : 0), 0));
    let pickI = 0, pickEv = -Infinity;
    for (let i = 0; i < raid.candidates.length; i++) {
      const t = tally.slice();
      t[i] += power(p);
      const top = Math.max(...t);
      const tied = t.flatMap((x, j) => (x === top ? [j] : []));
      const ev = tied.reduce((s, j) => s + evs[j], 0) / tied.length;
      if (ev > pickEv + 1e-9) { pickI = i; pickEv = ev; }
    }
    const t = raid.candidates[pickI];
    const out = [`vote ${pickI + 1}`];
    const others = inRaid.some((ds, q) => q !== p && ds.length);
    if (others && talkedThisRound(g, p) < TUNE.TALK_PER_ROUND && !saidThisRound(g, p, 'I vote')) {
      const plan = bestRaidPlan(g, p, t, inRaid, rng, h);
      const line = plan.fight.length ? `I vote ${TARGETS[t].name}. Fight with me and it falls; we split ${lootText(lootOf(g, t))}.` : `I vote ${TARGETS[t].name}.`;
      out.unshift(`say ${line}`);
    }
    return out;
  }
  const inRaid = g.players.map((_, q) => raid.sent[q].map((id) => g.dragons.find((d) => d.id === id)!).filter(Boolean));
  const plan = bestRaidPlan(g, p, raid.target!, inRaid, rng, h);
  return [plan.fight.length ? `fight ${plan.fight.join(' ')}` : 'hold'];
}

function lootText(b: Bundle): string {
  const parts = RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${b[r]} ${r}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join('');
}

// ---------- cards ----------

// What a card in hand is worth to p: what it would add if p could pay for it now.
function cardWorth(g: Game, p: number, c: Card, h: number): number {
  const a = ACTIONS[c.key];
  if (a?.effect === 'hidden_point') return (a.amount ?? 0) + 1;
  if (a?.effect === 'gain_gold') return (a.amount ?? 0) * TUNE.V_GOLD + 0.2;
  if (a?.effect === 'gain_resource') return (a.amount ?? 0) * TUNE.V_RES + 0.2;
  if (a?.effect === 'send_fauna') return 0.5;
  if (a?.effect === 'extra_raid') return 0.5;
  if (a) return g.dragons.some((d) => d.owner === p && (a.effect === 'grow_dragon' ? d.stage < 3 : d.stage > 0)) ? 0.9 : 0.3;
  const base = worth(g, p, h);
  const cost = cardCost(c);
  const kind = cardKind(c);
  const tries = kind === 'building' ? buildableHexes(g, p, c.key).map((k) => `build ${c.id} ${k}`) : kind === 'upgrade' ? upgradeTargets(g, p, c.key).map((k) => `upgrade ${c.id} ${k}`) : [`play ${c.id}`];
  let best = kind === 'building' ? 0.2 : 0;
  for (const cmd of tries) {
    const x = copy(g);
    const pl = x.players[p];
    // As if the card's cost were in hand: what the card itself adds, apart from paying for it.
    for (const r of RESOURCES) pl.resources[r] += cost[r] ?? 0;
    const hand = x.players[p];
    if (!hand.hand.some((y) => y.id === c.id)) hand.hand.push(c);
    if (!tryAll(x, p, [cmd])) continue;
    best = Math.max(best, worth(x, p, h) - base);
  }
  return best;
}

function keepChoice(g: Game, p: number, h: number): Card {
  const pl = g.players[p];
  let best = pl.choice[0], bestV = -Infinity;
  for (const c of pl.choice) {
    const v = cardWorth(g, p, c, h);
    if (v > bestV) { best = c; bestV = v; }
  }
  return best;
}

function discardChoice(g: Game, p: number, h: number): string[] {
  const pl = g.players[p];
  const over = pl.hand.length - TUNING.handCap;
  const ranked = pl.hand.map((c) => ({ c, v: cardWorth(g, p, c, h) })).sort((a, b) => a.v - b.v);
  return ranked.slice(0, over).map((x) => x.c.id);
}

// ---------- talk ----------

// Once a round, it warns the table about a rival close to winning.
function warning(g: Game, p: number): string | null {
  const lead = leader(g, p);
  if (lead.q < 0 || lead.pts < TUNING.pointsToWin - 14 || lead.pts <= score(g, p).total) return null;
  if (talkedThisRound(g, p) >= TUNE.TALK_PER_ROUND || saidThisRound(g, p, 'points')) return null;
  return `say ${pname(lead.q)} has ${lead.pts} points, ${TUNING.pointsToWin - lead.pts} from winning. Don't trade with ${pname(lead.q)}, and let's not raid where ${pname(lead.q)} scores.`;
}

// An answer to a player who talked to it.
function replyTo(g: Game, p: number, name: string | undefined, h: number, rng: Rng): string | null {
  if (talkedThisRound(g, p) >= TUNE.TALK_PER_ROUND) return null;
  const m = unanswered(g, p, name);
  if (!m) return null;
  const to = m.private ? `tell ${pname(m.from)} ` : 'say ';
  const lead = leader(g, p);
  if (RAID_WORDS.test(m.text)) {
    const inRaid = readyBy(g);
    if (!inRaid[p].length) return `${to}I have no dragon ready to raid this round.`;
    const best = Object.keys(TARGETS).map((t) => ({ t, ev: bestRaidPlan(g, p, t, inRaid, rng, h).ev })).sort((a, b) => b.ev - a.ev)[0];
    return `${to}I'll vote ${TARGETS[best.t].name}: that's the one we can take.`;
  }
  if (RES_WORDS.test(m.text)) {
    if (m.from === lead.q && lead.pts >= TUNING.pointsToWin - 12) return `${to}You're too close to winning: no trades with you.`;
    return `${to}Make me an offer. I take any trade that helps me, and 2 for 1 usually does.`;
  }
  return `${to}${pick(rng, ['Noted.', 'Good luck to you too.', "We'll see.", 'Fair enough.'])}`;
}
