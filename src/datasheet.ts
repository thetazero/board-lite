// The tuning datasheet: the raw game rules, every number in data.ts as the
// game has it (costs, outputs, stats, points), so bad tuning shows up without
// a playtest. Nothing here is simulated: no generated maps, fights or bot
// games, only what data.ts says. `npm run datasheet` writes docs/datasheet.md, and a
// test fails when that file is out of date.

import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import {
  ACTIONS, BEASTS, BUILDINGS, CLASS_NAMES, DRAGONS, FAUNA, FAUNA_BY_DISTANCE, RESOURCES, STAGE_NAMES, TARGETS, TERRAINS, TERRAIN_WEIGHTS, TUNING, UNITS, UPGRADES, avgDamage, combatPower, targetPower,
  type BuildingClass, type Bundle, type Resource,
} from './data.ts';
import { bundleText, specialProjectCost } from './engine.ts';
import { mapRadius } from './map.ts';


// ---------- plain numbers ----------

// Every number is shown as the game has it: costs, outputs, loot and points
// in their own resources. Nothing is converted into a common unit.
const perPoint = (b: Bundle, pts: number): string => {
  const parts = RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${n1(b[r]! / pts)} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
};
const avgAttack = avgDamage;
const cost = (b: Bundle) => bundleText(b) || 'free';
const n1 = (x: number) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString() : '∞');
const pct = (x: number) => `${Math.round(x * 100)}%`;

function table(head: string[], rows: (string | number)[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

// ---------- sections ----------

function economy(): string {
  return `## Economy baseline

- Start: ${cost(TUNING.startingResources)}. Tower income: ${cost(TUNING.towerProduction)} a round, no dice.
- Cards: each round, draw ${TUNING.buildingCardsDrawn} building cards and keep 1, plus ${TUNING.actionCardsPerRound} action card; hand cap ${TUNING.handCap}. Basic buildings (${Object.values(BUILDINGS).filter((b) => b.basic).map((b) => b.name).join(', ')}) need no card.
- Win at ${TUNING.pointsToWin} points. Titles are ${TUNING.titlePoints} points each, from a minimum (see Points).
- Each dragon eats ${TUNING.livestockPerDragon} livestock a round, eggs included; the tower makes ${TUNING.towerProduction.livestock ?? 0}.
- Gold: no basic building makes it. It comes from raids${goldMakers().length ? `, ${goldMakers().join(', ')}` : ''}, clearing fauna, and the bank.
- Bank: ${TUNING.bankRate}:1${Object.values(BUILDINGS).filter((b) => b.bankRate).map((b) => `, ${b.bankRate}:1 with a ${b.name}`).join('')}.`;
}

// Every building, upgrade, action card and dragon: what it costs and does.
function costs(): string {
  const pts = (n?: number) => (n ? String(n) : '—');
  const rows: (string | number)[][] = [
    ...Object.values(BUILDINGS).map((b) => [b.name, b.basic ? 'basic building' : 'building card', b.copies ?? '—', cost(b.cost), b.text, b.per && b.points ? `${b.points} each` : pts(b.points)]),
    ...Object.values(UPGRADES).map((u) => [u.name, 'upgrade', u.copies, cost(u.cost), u.text, '—']),
    ...Object.values(ACTIONS).map((a) => [a.name, 'action card', a.copies, cost(a.cost), a.text, a.effect === 'hidden_point' ? '1' : '—']),
    ...Object.values(DRAGONS).map((d) => [d.name, d.base ? 'base dragon' : 'dragon card', d.copies, cost(d.cost), `${d.element}, grows a stage every ${d.growthTime} rounds`, TUNING.dragonPointsByStage.slice(1).join(' / ')]),
  ];
  return `## Costs

Everything that can be bought, as the game has it. Basic buildings have no copies: anyone may build them, no card needed. Dragon points are hatchling / young / adult.

${table(['Name', 'Kind', 'Copies', 'Cost', 'Does', 'Points'], rows)}`;
}

function goldMakers(): string[] {
  return [...Object.values(BUILDINGS), ...Object.values(UPGRADES)].filter((c) => c.makes?.gold).map((c) => `${c.name}s`);
}

function production(): string {
  const workshop = Object.values(UPGRADES).find((u) => u.baseBonus);
  const rows = Object.values(BUILDINGS).filter((b) => b.produces).map((b) => {
    const p = b.produces!;
    return [b.name, b.terrain!, cost(b.cost), `${p.base ? `${p.base} + ` : ''}d${p.die} ${p.resource} (avg ${n1(p.base + (p.die + 1) / 2)})`];
  });
  const extra = workshop ? `\n\n${workshop.name} (${cost(workshop.cost)}): makes ${workshop.baseBonus} more a round.` : '';
  return `## Basic production buildings

Anyone may build these, no card needed.

${table(['Building', 'Terrain', 'Cost', 'Makes each round'], rows)}${extra}`;
}

// Building cards whose effect counts their neighbours.
function neighbourCards(): string {
  const cards = Object.values(BUILDINGS).filter((b) => b.per);
  const terrains = new Set<string>(TERRAINS);
  const rows = cards.map((b) => {
    const counted = terrains.has(b.per!) ? `${b.per} hexes` : `${CLASS_NAMES[b.per as BuildingClass].replace(/y$/, 'ie')}s (anyone's)`;
    return [b.name, CLASS_NAMES[b.class], counted, cost(b.cost), b.makes ? `${cost(b.makes)} a round` : `${b.points} point`];
  });
  return `## Building cards that count their neighbours

Each effect is multiplied by how many of the building's six neighbouring hexes count: hexes of a terrain (built on or not), or buildings of a class, whoever owns them (the tower is a monument and a dragon building).

${table(['Card', 'Class', 'Counts', 'Cost', 'Each one adds'], rows)}`;
}

function land(): string {
  const terrains = TERRAINS.filter((t) => t !== 'ocean');
  const totalWeight = Object.values(TERRAIN_WEIGHTS).reduce((s, w) => s + w!, 0);
  const rows = terrains.map((t) => [t, Object.values(BUILDINGS).find((b) => b.terrain === t)?.name ?? '—', TERRAIN_WEIGHTS[t] ? pct(TERRAIN_WEIGHTS[t]! / totalWeight) : 'coast']);
  const size = [2, 3, 4].map((p) => { const R = mapRadius(p); return `${p}p radius ${R} (${3 * R * (R + 1) + 1} land hexes)`; }).join(', ');
  return `## Land

The land is ringed by ocean, where nothing is built. Each of its six coasts has one natural harbor at a random spot between its corners; ports go only on harbors. Land: ${size}. Terrain shares are of the random land, before towers and harbors are placed.

${table(['Terrain', 'For', 'Share of land'], rows)}`;
}

function growth(gt: number, perRound: number, stage: number) {
  return Math.ceil((stage * gt) / perRound);
}

// Every way to make points, with what it pays in full (dragons: cost plus
// the livestock eaten while growing, from egg, without a hatchery).
type PointSource = { name: string; pays: Bundle; shown: string; points: number; ready: string };
function pointSources(): PointSource[] {
  const out: PointSource[] = [];
  for (const b of Object.values(BUILDINGS).filter((b) => b.points)) {
    // Neighbour-counting monuments, at 2 neighbours (see the table above).
    const pts = b.points! * (b.per ? 2 : 1);
    out.push({ name: b.per ? `${b.name}, 2 neighbours` : b.name, pays: b.cost, shown: cost(b.cost), points: pts, ready: 'now' });
  }
  for (const a of Object.values(ACTIONS).filter((a) => a.effect === 'hidden_point')) {
    out.push({ name: `${a.name} (action card)`, pays: a.cost, shown: cost(a.cost), points: 1, ready: 'now, uses a hand slot' });
  }
  const seen = new Set<string>();
  const fed = (c: Bundle, rounds: number): Bundle => ({ ...c, livestock: (c.livestock ?? 0) + rounds * TUNING.livestockPerDragon });
  for (const d of Object.values(DRAGONS)) {
    const sig = `${cost(d.cost)}/${d.growthTime}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const label = d.base ? 'Base dragon' : `${Object.values(DRAGONS).filter((x) => !x.base && `${cost(x.cost)}/${x.growthTime}` === sig).map((x) => x.name).join(', ')}`;
    for (const stage of [1, 2, 3]) {
      const rounds = growth(d.growthTime, 1, stage);
      out.push({ name: `${label}, ${STAGE_NAMES[stage]}`, pays: fed(d.cost, rounds), shown: `${cost(d.cost)} + ${rounds} livestock`, points: TUNING.dragonPointsByStage[stage], ready: rounds === 1 ? '1 round' : `${rounds} rounds` });
    }
  }
  const base = Object.values(DRAGONS).find((d) => d.base)!;
  const r3 = growth(base.growthTime, 1, 3);
  out.push({ name: 'Base dragon by special project, adult', pays: fed(specialProjectCost(base.cost), r3), shown: `${cost(specialProjectCost(base.cost))} + ${r3} livestock`, points: TUNING.dragonPointsByStage[3], ready: `${r3} rounds` });
  return out;
}

function points(): string {
  const rows = pointSources().map((s) => [s.name, s.shown, s.points, perPoint(s.pays, s.points), s.ready]);
  const hatchery = Object.values(BUILDINGS).find((b) => b.growthBonus);
  const base = Object.values(DRAGONS).find((d) => d.base)!;
  const r3 = growth(base.growthTime, 1, 3);
  const hatcheryNote = hatchery
    ? `\n\nWith a ${hatchery.name} (+${hatchery.growthBonus} growth a round), a growth-time-${base.growthTime} dragon reaches adult in ${growth(base.growthTime, 1 + hatchery.growthBonus!, 3)} rounds instead of ${r3}.`
    : '';
  return `## Points

Every way to make points. Dragon costs include the livestock eaten while growing, from egg, without a hatchery; an adult keeps eating ${TUNING.livestockPerDragon} livestock a round. Neighbour-counting monuments are shown at 2 neighbours.

${table(['Source', 'Pays', 'Points', 'Pays per point', 'Ready'], rows)}${hatcheryNote}

Titles: ${TUNING.titlePoints} points each, for most dragon points (at least ${TUNING.titleMinimum.army}), most tower floors (at least ${TUNING.titleMinimum.tower}) and most gold (at least ${TUNING.titleMinimum.hoard}). Tower floors are worth nothing else; gold held is worth points only through Largest Hoard.`;
}

function dragons(): string {
  const rows = Object.values(DRAGONS).filter((d, i, all) => !d.base || all.findIndex((x) => x.base) === i).map((d) => [
    d.base ? 'Base dragon (any element)' : d.name, d.base ? 'any' : d.element, cost(d.cost), d.growthTime, d.targeting,
    ...d.stages.map((s) => `**${combatPower(s)}**: ${s.hp}hp ${s.targets}×${s.dice}d${s.sides} (${n1(avgAttack(s))})`),
  ]);
  return `## Dragons

Each stage: combat power (see Raids), health, targets × dice (average damage a combat round, before elements).

${table(['Dragon', 'Element', 'Cost', 'Growth time', 'Targets', 'Hatchling', 'Young', 'Adult'], rows)}`;
}

// Rounds a dragon with this much damage sits out (it heals at each production).
const roundsOut = (damage: number) => Math.ceil(damage / TUNING.healPerRound);

function healing(): string {
  const base = Object.keys(DRAGONS).find((k) => DRAGONS[k].base)!;
  const ko = [1, 2, 3].map((st) => `${STAGE_NAMES[st]} ${roundsOut(DRAGONS[base].stages[st - 1].hp)}`).join(', ');
  const big = Object.values(DRAGONS).reduce((m, d) => (d.stages[2].hp > m.stages[2].hp ? d : m));
  return `Healing: a hurt dragon heals ${TUNING.healPerRound} health at each production and sits out every round's raids until it is whole, so it misses one raid round per ${TUNING.healPerRound} damage, rounded up. Knocked out (0 health), a base dragon is out: ${ko} rounds; the ${big.name}, the toughest adult, ${roundsOut(big.stages[2].hp)}.`;
}

function raids(): string {
  const targetRows = Object.keys(TARGETS).map((k) => {
    const t = TARGETS[k];
    const units = t.units.map((u) => UNITS[u]);
    return [
      t.name, t.units.map((u) => UNITS[u].name).join(', '), `**${targetPower(k)}**`, units.reduce((s, u) => s + u.hp, 0),
      n1(units.reduce((s, u) => s + avgAttack(u), 0)), cost(t.loot),
    ];
  });
  const unitRows = Object.values(UNITS).map((u) => [u.name, combatPower(u), u.hp, `${u.targets}×${u.dice}d${u.sides} (${n1(avgAttack(u))})`, u.strong.join(', ') || '—', u.weak.join(', ') || '—']);
  return `## Raids

Defenders:

${table(['Unit', 'Power', 'Health', 'Attack (avg)', 'Strong vs', 'Weak vs'], unitRows)}

Combat power is √(health × average damage a combat round), rounded; a kingdom's is its defenders' summed, and raiders' powers add up the same way. It ignores elements and targeting, so it is a rough guide on purpose.

Kingdoms (all are on the ballot each raid; average damage is the defenders' total a combat round). Loot is the printed loot below plus the gold the kingdom has hoarded: after every raid, each kingdom that didn't fall adds 1 gold, and the one that fell goes back to its printed loot. Shared loot is split by the combat power each player still has fighting at the end (each resource rounded down, and what's left over goes to the player with the most power).

${table(['Kingdom', 'Defenders', 'Power', 'Total health', 'Avg damage a round', 'Loot'], targetRows)}

${healing()}`;
}

function fauna(): string {
  const unitRows = Object.entries(FAUNA).map(([k, f]) => {
    const at = FAUNA_BY_DISTANCE.indexOf(k);
    const where = at < 0 ? 'cards only' : `${at + 2}${at === FAUNA_BY_DISTANCE.length - 1 ? '+' : ''} steps from the nearest tower`;
    return [f.name, f.hp, `${f.targets}×${f.dice}d${f.sides} (${n1(avgAttack(f))})`, f.strong.join(', ') || '—', f.weak.join(', ') || '—', cost(f.loot), where];
  });
  const cardRows = Object.values(ACTIONS).filter((a) => a.effect === 'send_fauna').map((a) => [a.name, FAUNA[a.fauna!].name, cost(a.cost), a.copies]);
  return `## Fauna

Beasts on the map. Nothing is built on a hex with fauna, and a building under fauna produces nothing (a basic production building loses its output). On their turn, any player may send raid-ready dragons against any beast, in the raids' combat; those dragons sit out the round's raids, and one that takes a hit sits out the next round's too, as after a raid. If the beast falls, the hex is empty and its loot goes to that player, unless a card placed it: then there is no loot. If not, it stays at full health. In production, each beast has a 1 in ${TUNING.faunaWanderOdds} chance to move to a random adjacent land hex with no tower or beast. New fauna comes only from cards.

${table(['Beast', 'Health', 'Attack (avg)', 'Strong vs', 'Weak vs', 'Loot', 'Starts'], unitRows)}

On the starting map: one beast per ${TUNING.landHexesPerFauna} land hexes, none within 1 step of a tower.

Cards that send fauna (action cards; see Decks for how often they come):

${table(['Card', 'Sends', 'Cost', 'Copies'], cardRows)}`;
}

// The great beasts: their stats, and when a grown dragon can exist.
function beasts(): string {
  const unitRows = Object.entries(BEASTS).map(([k, b]) => [
    b.name, b.hp, `${b.targets}×${b.dice}d${b.sides} (${n1(avgAttack(b))})`, b.strong.join(', '), b.weak.join(', '), b.points,
    k === 'thunderbird' ? 'the mountain peak at the centre' : 'the ocean beside one harbor',
  ]);
  const base = Object.values(DRAGONS).find((d) => d.base)!;
  const hatchery = Object.values(BUILDINGS).find((b) => b.growthBonus)!;
  const adult = growth(base.growthTime, 1, 3);
  const fast = growth(base.growthTime, 1 + hatchery.growthBonus!, 3);
  return `## Great beasts

Two on every map, the top tier of the fauna: fought like fauna (on your turn, your dragons, to the end, and they sit out the round's raids), but each player gets one try at a great beast a round, and it is at full health for every fight. Each holds its hex and every hex next to it: nothing is built there while it lives. The player who slays one scores its points for good; it never comes back. Once the Thunderbird falls, every production building on or next to its peak makes ${TUNING.peakBonus} more a round.

${table(['Beast', 'Health', 'Attack (avg)', 'Strong vs', 'Weak vs', 'Points', 'Lives in'], unitRows)}

A single beast takes one hit per dragon a combat round, so a dragon's extra targets don't help here.

When that force exists: a base egg (any element, by special project, or a dragon card of the element) is an adult ${adult} rounds after it is hatched, ${fast} with a ${hatchery.name}. `;
}

function deck(): string {
  const build = [...Object.values(BUILDINGS), ...Object.values(UPGRADES)];
  const act = [...Object.values(ACTIONS), ...Object.values(DRAGONS)];
  const nb = build.reduce((s, c) => s + (c.copies ?? 0), 0);
  const na = act.reduce((s, c) => s + c.copies, 0);
  const rows = [
    ...Object.values(BUILDINGS).filter((c) => c.copies).map((c) => [c.name, 'building', c.copies!, pct(c.copies! / nb)]),
    ...Object.values(UPGRADES).map((c) => [c.name, 'building deck (upgrade)', c.copies, pct(c.copies / nb)]),
    ...Object.values(ACTIONS).map((c) => [c.name, 'action', c.copies, pct(c.copies / na)]),
  ];
  const upgradeCopies = Object.values(UPGRADES).reduce((s, u) => s + u.copies, 0);
  rows.push([`Any upgrade (${Object.keys(UPGRADES).length} kinds)`, 'building deck (upgrade)', upgradeCopies, pct(upgradeCopies / nb)]);
  const dragonCopies = Object.values(DRAGONS).reduce((s, d) => s + d.copies, 0);
  rows.push([`Any dragon (${Object.keys(DRAGONS).length} kinds)`, 'action', dragonCopies, pct(dragonCopies / na)]);
  return `## Decks

Building deck ${nb} cards (${Object.values(BUILDINGS).filter((c) => c.copies).length} buildings, ${Object.keys(UPGRADES).length} upgrades), action deck ${na}.

${table(['Card', 'Deck', 'Copies', 'Share of deck'], rows)}`;
}

function demand(): string {
  // Where each resource is wanted: summed over every card's cost, weighted by
  // copies in the deck, against where it comes from.
  const spend = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<Resource, number>;
  const all = [...Object.values(BUILDINGS), ...Object.values(UPGRADES), ...Object.values(ACTIONS), ...Object.values(DRAGONS)];
  for (const c of all) for (const r of RESOURCES) spend[r] += (c.cost[r] ?? 0) * (c.copies ?? 0);
  const total = RESOURCES.reduce((s, r) => s + spend[r], 0);
  const sources = (r: Resource) => {
    const s: string[] = [];
    if (TUNING.towerProduction[r]) s.push(`tower ${TUNING.towerProduction[r]}`);
    for (const b of Object.values(BUILDINGS)) if (b.produces?.resource === r || b.makes?.[r]) s.push(b.name);
    for (const u of Object.values(UPGRADES)) if (u.makes?.[r]) s.push(u.name);
    const loot = Object.values(TARGETS).filter((t) => t.loot[r]).length;
    if (loot) s.push(`raid loot (${loot} of ${Object.keys(TARGETS).length} kingdoms)`);
    if (Object.values(FAUNA).some((f) => f.loot[r])) s.push('clearing fauna');
    return s.join(', ') || 'nothing';
  };
  const rows = RESOURCES.map((r) => [r, spend[r], pct(spend[r] / total), sources(r)]);
  return `## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy; basic buildings aren't cards and aren't counted), plus where it comes from. Dragon upkeep (${TUNING.livestockPerDragon} livestock per dragon a round) comes on top.

${table(['Resource', 'In all card costs', 'Share', 'Comes from'], rows)}`;
}

export function datasheet(): string {
  return `# Tuning datasheet

Generated from \`src/data.ts\` by \`npm run datasheet\`; don't edit by hand. \`npm test\` fails when it is out of date, so after changing any number, rerun \`npm run datasheet\` and read the diff. It holds the raw rules only: every number as \`src/data.ts\` has it, with nothing simulated.

${[economy(), costs(), production(), land(), neighbourCards(), points(), dragons(), raids(), fauna(), beasts(), demand(), deck()].join('\n\n')}
`;
}

export const DATASHEET_PATH = fileURLToPath(new URL('../docs/datasheet.md', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(DATASHEET_PATH, datasheet());
  console.log(`Wrote ${DATASHEET_PATH}`);
}
