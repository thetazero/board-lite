// A simple random-ish bot. It exists to test that games run to the end and
// to give rough tuning numbers; it is not meant to play well.

import { ACTIONS, BASIC_BUILDINGS, BASIC_RESOURCES, BEASTS, BUILDINGS, ELEMENTS, RESOURCES, TUNING } from './data.ts';
import {
  acceptProblem, apply, bankRates, buildableHexes, canAfford, canRaid, cardCost, cardKind, dragonCapacity, huntable, perchHexes, specialProjectCost,
  upgradeTargets, waitingOn, RuleError, type Game,
} from './engine.ts';
import { DRAGONS } from './data.ts';
import { neighbors } from './map.ts';
import { type Rng, next, pick, shuffle } from './rng.ts';

// Concrete commands worth trying for player p, best guesses first.
export function candidateCommands(g: Game, p: number, rng: Rng): string[] {
  const pl = g.players[p];
  if (g.phase === 'action') {
    const out: string[] = [];
    // Accept or decline at random; decline always works if accepting doesn't.
    for (const o of g.offers.filter((x) => x.to === p)) out.push(...(!acceptProblem(g, o) && next(rng) < 0.5 ? [`accept ${o.id}`, `decline ${o.id}`] : [`decline ${o.id}`]));
    if (p !== g.turn) return out;
    for (const c of shuffle(rng, pl.hand.slice())) {
      if (!canAfford(pl, cardCost(c))) continue;
      const kind = cardKind(c);
      if (kind === 'building') {
        const hexes = buildableHexes(g, p, c.key);
        if (hexes.length) out.push(`build ${c.id} ${pick(rng, hexes)}`);
      } else if (kind === 'upgrade') {
        const t = upgradeTargets(g, p, c.key);
        if (t.length) out.push(`upgrade ${c.id} ${pick(rng, t)}`);
      } else if (kind === 'dragon') {
        if (g.dragons.filter((d) => d.owner === p).length < dragonCapacity(g, p)) out.push(`play ${c.id}`);
      } else {
        const a = ACTIONS[c.key];
        const mine = g.dragons.filter((d) => d.owner === p);
        if (a.effect === 'gain_resource') out.push(`play ${c.id} ${pick(rng, ['stone', 'timber', 'crystal', 'livestock'])}`);
        if (a.effect === 'gain_gold' || a.effect === 'extra_raid') out.push(`play ${c.id}`);
        const growable = mine.filter((d) => d.stage < 3);
        if (a.effect === 'grow_dragon' && growable.length) out.push(`play ${c.id} ${pick(rng, growable).id}`);
        // Fauna goes next to, or onto, another player's building.
        const theirs = Object.keys(g.buildings).filter((k) => g.buildings[k].owner !== p && g.buildings[k].type !== 'tower' && !g.map[k].fauna);
        if (a.effect === 'send_fauna' && theirs.length) out.push(`play ${c.id} ${pick(rng, theirs)}`);
        const hurt = mine.filter((d) => d.damage > 0);
        if (a.effect === 'heal_dragon' && hurt.length) out.push(`play ${c.id} ${pick(rng, hurt).id}`);
      }
    }
    // Now and then, send the ready dragons at fauna touching its land.
    const ready = g.dragons.filter((d) => d.owner === p && canRaid(d) && d.stage >= 2).map((d) => d.id);
    const near = huntable(g, p).filter((k) => Object.keys(g.buildings).some((b) => g.buildings[b].owner === p && (b === k || isNeighbour(b, k))));
    if (ready.length && near.length && next(rng) < 0.4) out.push(`clear ${pick(rng, near)} ${ready.join(' ')}`);
    // With three or more grown dragons ready, now and then try a great beast.
    const beasts = huntable(g, p).filter((k) => BEASTS[g.map[k].fauna!]);
    if (ready.length >= 3 && beasts.length && next(rng) < 0.3) out.push(`clear ${pick(rng, beasts)} ${ready.join(' ')}`);
    // Now and then, perch a ready dragon on a rival's building, or recall one.
    const rivals = perchHexes(g, p);
    if (ready.length && rivals.length && next(rng) < 0.2) out.push(`perch ${pick(rng, rivals)} ${pick(rng, ready)}`);
    const perched = g.dragons.filter((d) => d.owner === p && d.perch);
    if (perched.length && next(rng) < 0.3) out.push(`recall ${pick(rng, perched).id}`);
    // Keep enough livestock for the dragons before spending on projects.
    const roomForDragon = g.dragons.filter((d) => d.owner === p).length < dragonCapacity(g, p);
    if (roomForDragon && canAfford(pl, specialProjectCost(DRAGONS.fire_whelp.cost)) && next(rng) < 0.5) out.push(`project ${pick(rng, ELEMENTS)}`);
    for (const b of shuffle(rng, BASIC_BUILDINGS.slice())) {
      if (b === 'roost' && roomForDragon) continue;
      const hexes = buildableHexes(g, p, b);
      if (hexes.length && canAfford(pl, BUILDINGS[b].cost)) out.push(`build ${b} ${pick(rng, hexes)}`);
    }
    const rates = bankRates(g, p);
    const rich = BASIC_RESOURCES.filter((r) => pl.resources[r] >= rates[r] + 2);
    const poor = BASIC_RESOURCES.filter((r) => !rich.includes(r));
    if (rich.length && poor.length && next(rng) < 0.5) out.push(`merchants ${pick(rng, rich)} ${pick(rng, poor)}`);
    out.push('end');
    return out;
  }
  if (g.phase === 'cards') return pl.choice.length ? [`keep ${pick(rng, pl.choice).id}`] : [];
  if (g.phase === 'discard') {
    const over = pl.hand.length - TUNING.handCap;
    return [`discard ${shuffle(rng, pl.hand.map((c) => c.id)).slice(0, over).join(' ')}`];
  }
  const raid = g.raid!;
  if (raid.step === 'vote') return [`vote ${1 + Math.floor(next(rng) * raid.candidates.length)}`];
  if (raid.step === 'commit') {
    const ids = g.dragons.filter((d) => d.owner === p && canRaid(d)).map((d) => d.id);
    return raid.commits[p].length || next(rng) < 0.2 ? ['ready'] : [`commit ${ids.join(' ')}`, 'ready'];
  }
  return [next(rng) < 0.85 ? 'fight' : 'bail'];
}

function isNeighbour(a: string, b: string): boolean {
  return neighbors(a).includes(b);
}

// Makes one move for one waiting player. Returns the command it applied.
export function botMove(g: Game, p: number, rng: Rng): string {
  for (const cmd of candidateCommands(g, p, rng)) {
    try {
      apply(g, p, cmd);
      return cmd;
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  }
  throw new Error(`Bot found no legal move for P${p + 1} in phase ${g.phase}`);
}

export function botStep(g: Game, rng: Rng): { player: number; command: string } {
  const p = pick(rng, waitingOn(g));
  return { player: p, command: botMove(g, p, rng) };
}

export function playOut(g: Game, rng: Rng, maxSteps = 20000): number {
  let steps = 0;
  while (g.phase !== 'over' && steps++ < maxSteps) botStep(g, rng);
  return steps;
}

// The move made for a seat whose player has gone (quit, or away while the
// table waits on them): as little as possible, so it keeps the game moving
// without spending their resources, sending their dragons or taking a trade.
// It answers offers with a decline, ends the turn, keeps the first building
// card, votes for the first target, sends no dragons, and discards the
// oldest cards.
export function standInCommands(g: Game, p: number): string[] {
  const pl = g.players[p];
  if (g.phase === 'action') return [...g.offers.filter((o) => o.to === p).map((o) => `decline ${o.id}`), ...(g.turn === p ? ['end'] : [])];
  if (g.phase === 'cards') return pl.choice.length ? [`keep ${pl.choice[0].id}`] : [];
  if (g.phase === 'discard') return [`discard ${pl.hand.slice(0, pl.hand.length - TUNING.handCap).map((c) => c.id).join(' ')}`];
  const raid = g.raid!;
  if (raid.step === 'vote') return ['vote 1'];
  if (raid.step === 'commit') return raid.commits[p].length ? ['commit none'] : ['ready'];
  return ['bail'];
}

export function standInMove(g: Game, p: number): string {
  for (const cmd of standInCommands(g, p)) {
    try {
      apply(g, p, cmd);
      return cmd;
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  }
  throw new Error(`The stand-in found no legal move for P${p + 1} in phase ${g.phase}`);
}
