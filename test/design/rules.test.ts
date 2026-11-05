// Design rules: relationships between tuning numbers that should hold whatever
// the exact numbers are (#222). Each test reads the numbers from src/data.ts,
// so a retune that keeps the rules passes. See README.md in this folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, UPGRADES, type BuildingDef, type Bundle, type Resource } from '../../src/data.ts';

const BASIC: Resource[] = ['stone', 'timber', 'crystal', 'livestock'];

// What a bundle is worth, counting every basic resource as 1. Gold isn't a
// basic resource, so a cost with gold has no value under these rules yet.
function value(b: Bundle, what: string): number {
  assert.ok(!b.gold, `${what} costs gold; the design rules count basic resources only, so decide how gold counts`);
  return BASIC.reduce((s, r) => s + (b[r] ?? 0), 0);
}

const round = (n: number) => Math.round(n * 100) / 100;
const list = (xs: string[]) => xs.map((x) => `\n  ${x}`).join('');

// Basic production buildings: roll a die each round; payback in expectation.
const basics = Object.values(BUILDINGS).filter((b) => b.basic && b.produces);
const basicPayback = (b: BuildingDef) => value(b.cost, b.name) / (b.produces!.base + (b.produces!.die + 1) / 2);

// Production cards: building cards that make a basic resource for each
// neighbour they count. Water cards count ocean hexes, which every coast has.
const cards = Object.values(BUILDINGS).filter((b) => !b.basic && b.per && b.makes && BASIC.some((r) => b.makes![r]));
const isWater = (b: BuildingDef) => b.per === 'ocean';
const water = cards.filter(isWater);
const dry = cards.filter((b) => !isWater(b));
const cardPayback = (b: BuildingDef, neighbours: number) => value(b.cost, b.name) / (value(b.makes!, b.name) * neighbours);

const workshop = UPGRADES.workshop;
const workshopPayback = value(workshop.cost, workshop.name) / workshop.baseBonus!;

test('rule 1: the basic production buildings pay back in 4 to 5 rounds, in expectation', () => {
  assert.ok(basics.length > 0, 'no basic production buildings found');
  const broken = basics.filter((b) => basicPayback(b) < 4 || basicPayback(b) > 5)
    .map((b) => `${b.name}: costs ${value(b.cost, b.name)}, makes ${b.produces!.base + (b.produces!.die + 1) / 2} a round, pays back in ${round(basicPayback(b))} rounds`);
  assert.deepEqual(broken, [], `Rule 1 broke: a basic production building should pay back in 4 to 5 rounds:${list(broken)}`);
});

// "Close but slightly better" at 2 neighbours: faster than the basic building,
// but by no more than this share of its payback.
const CLOSE = 0.2;

test('rule 2: production cards beat the basic buildings with 3 neighbours, lose with 1, and edge them with 2', () => {
  assert.ok(dry.length > 0, 'no production cards found');
  const broken: string[] = [];
  for (const c of dry) {
    for (const b of basics) {
      const base = basicPayback(b);
      const [one, two, three] = [1, 2, 3].map((n) => cardPayback(c, n));
      const vs = `than ${b.name} (${round(base)} rounds)`;
      if (!(three < base)) broken.push(`${c.name} with 3 neighbours pays back in ${round(three)} rounds, not faster ${vs}`);
      if (!(one > base)) broken.push(`${c.name} with 1 neighbour pays back in ${round(one)} rounds, not slower ${vs}`);
      if (!(two < base)) broken.push(`${c.name} with 2 neighbours pays back in ${round(two)} rounds, not faster ${vs}`);
      else if (two < base * (1 - CLOSE)) broken.push(`${c.name} with 2 neighbours pays back in ${round(two)} rounds, more than ${CLOSE * 100}% faster ${vs}`);
    }
  }
  assert.deepEqual(broken, [], `Rule 2 broke:${list(broken)}`);
});

test('rule 3: the water cards pay back slower than every other production card, since water is guaranteed', () => {
  assert.ok(water.length > 0, 'no water cards found');
  const broken: string[] = [];
  for (const w of water) {
    for (const c of dry) {
      for (const n of [1, 2, 3]) {
        if (!(cardPayback(w, n) > cardPayback(c, n))) {
          broken.push(`${w.name} with ${n} neighbours pays back in ${round(cardPayback(w, n))} rounds, not slower than ${c.name} (${round(cardPayback(c, n))})`);
        }
      }
    }
  }
  assert.deepEqual(broken, [], `Rule 3 broke:${list(broken)}`);
});

// As written: slower than every production building, with any 1 to 3
// neighbours. It doesn't hold today (a card with 1 neighbour pays back slower
// than the Workshop), and what it should compare against is the user's call
// (#222), so it reports without failing the run until then.
test('rule 4: the Workshop has the worst payback overall, since it takes no tile', { todo: 'what "worst payback overall" compares against is open (#222)' }, () => {
  const others = [
    ...basics.map((b) => ({ name: b.name, payback: basicPayback(b) })),
    ...cards.flatMap((c) => [1, 2, 3].map((n) => ({ name: `${c.name} with ${n} neighbour${n > 1 ? 's' : ''}`, payback: cardPayback(c, n) }))),
  ];
  const broken = others.filter((o) => !(workshopPayback > o.payback))
    .map((o) => `${o.name} pays back in ${round(o.payback)} rounds, no faster than the Workshop (${round(workshopPayback)})`);
  assert.deepEqual(broken, [], `Rule 4 broke:${list(broken)}`);
});

test('rule 5: monuments make points at least 30% more efficiently than the cheapest production card', () => {
  const cheapest = cards.reduce((a, b) => (value(b.cost, b.name) < value(a.cost, a.name) ? b : a));
  const cardRate = cheapest.points! / value(cheapest.cost, cheapest.name);
  const monuments = Object.values(BUILDINGS).filter((b) => b.class === 'monument' && b.points && !b.makes);
  assert.ok(monuments.length > 0, 'no monuments found');
  const broken = monuments.filter((m) => m.points! / value(m.cost, m.name) < 1.3 * cardRate)
    .map((m) => `${m.name}: ${m.points} points for ${value(m.cost, m.name)}, ${round(value(m.cost, m.name) / m.points!)} a point; ${cheapest.name} is ${round(1 / cardRate)} a point, so a monument needs at most ${round(1 / (1.3 * cardRate))}`);
  assert.deepEqual(broken, [], `Rule 5 broke:${list(broken)}`);
});
