// A simple random-ish bot. It exists to test that games run to the end and
// to give rough tuning numbers; it is not meant to play well.

import { ACTIONS, BUILDINGS, ELEMENTS, RESOURCES, TUNING } from './data.ts';
import {
  PROJECT_BUILDINGS, apply, bankRate, buildableHexes, canAfford, canRaid, cardCost, cardKind, dragonCapacity, specialProjectCost,
  upgradeTargets, waitingOn, RuleError, type Game,
} from './engine.ts';
import { DRAGONS } from './data.ts';
import { type Rng, next, pick, shuffle } from './rng.ts';

// Concrete commands worth trying for player p, best guesses first.
export function candidateCommands(g: Game, p: number, rng: Rng): string[] {
  const pl = g.players[p];
  if (g.phase === 'action') {
    const out: string[] = [];
    for (const o of g.offers.filter((x) => x.to === p)) out.push(next(rng) < 0.5 ? `accept ${o.id}` : `decline ${o.id}`);
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
        const hurt = mine.filter((d) => d.damage > 0 || d.resting === 'hurt');
        if (a.effect === 'heal_dragon' && hurt.length) out.push(`play ${c.id} ${pick(rng, hurt).id}`);
      }
    }
    // Keep enough livestock for the dragons before spending on projects.
    const roomForDragon = g.dragons.filter((d) => d.owner === p).length < dragonCapacity(g, p);
    if (roomForDragon && canAfford(pl, specialProjectCost(DRAGONS.fire_whelp.cost)) && next(rng) < 0.5) out.push(`project ${pick(rng, ELEMENTS)}`);
    for (const b of shuffle(rng, PROJECT_BUILDINGS.slice())) {
      if (b === 'roost' && roomForDragon) continue;
      const hexes = buildableHexes(g, p, b);
      if (hexes.length && canAfford(pl, specialProjectCost(BUILDINGS[b].cost))) out.push(`project ${b} ${pick(rng, hexes)}`);
    }
    const rate = bankRate(g, p);
    const rich = RESOURCES.filter((r) => pl.resources[r] >= rate + 2);
    if (rich.length && next(rng) < 0.5) out.push(`bank ${pick(rng, rich)} ${pick(rng, RESOURCES.filter((r) => !rich.includes(r)).concat(['gold']))}`);
    out.push('end');
    return out;
  }
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
