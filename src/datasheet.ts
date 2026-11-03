// The tuning datasheet: every number in data.ts and what they add up to
// (payback, cost per point, raid odds), so bad tuning shows up without a
// playtest. Everything here is computed from data.ts and the engine; nothing
// is typed in by hand. `npm run datasheet` writes docs/datasheet.md, and a
// test fails when that file is out of date.

import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { playOut } from './bot.ts';
import {
  ACTIONS, BUILDINGS, CLASS_NAMES, DRAGONS, RESOURCES, STAGE_NAMES, TARGETS, TERRAINS, TERRAIN_WEIGHTS, TUNING, UNITS, UPGRADES,
  type Attack, type BuildingClass, type Bundle, type Resource, type Terrain,
} from './data.ts';
import { apply, bundleText, newGame, specialProjectCost, type Game } from './engine.ts';
import { distance, generateMap, key, mapRadius, neighbors, parseKey, towerSpots } from './map.ts';

// ---------- the yardstick ----------

// One common unit to add mixed costs up: every non-gold resource is worth 1,
// and gold is worth what the bank charges for it.
const VALUE: Record<Resource, number> = { stone: 1, timber: 1, crystal: 1, livestock: 1, gold: TUNING.bankRate };
const value = (b: Bundle) => RESOURCES.reduce((s, r) => s + (b[r] ?? 0) * VALUE[r], 0);
const avgAttack = (a: Attack) => a.targets * a.dice * (a.sides + 1) / 2;
const cost = (b: Bundle) => bundleText(b) || 'free';
const n1 = (x: number) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString() : '∞');
const pct = (x: number) => `${Math.round(x * 100)}%`;

// Below this many rounds a building is close to free money.
const PAYBACK_WARN = 2;
const warnPayback = (r: number) => `${n1(r)}${r < PAYBACK_WARN ? ' ⚠' : ''}`;

function table(head: string[], rows: (string | number)[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

// ---------- sections ----------

function economy(): string {
  const tower = value(TUNING.towerProduction);
  const start = value(TUNING.startingResources);
  return `## Economy baseline

Yardstick for every "value" below: 1 per stone, timber, crystal or livestock, and ${VALUE.gold} per gold (the bank's ${TUNING.bankRate}:1 price for it). Gold comes only from raids${goldMakers().length ? ` and ${goldMakers().join(', ')}` : ''}.

- Start: ${cost(TUNING.startingResources)} (value ${start}). Tower income: ${cost(TUNING.towerProduction)} a round (value ${tower}), no dice.
- Cards: each round, draw ${TUNING.buildingCardsDrawn} building cards and keep 1, plus ${TUNING.actionCardsPerRound} action card; hand cap ${TUNING.handCap}. Basic buildings (${Object.values(BUILDINGS).filter((b) => b.basic).map((b) => b.name).join(', ')}) need no card.
- Win at ${TUNING.pointsToWin} points. Titles are ${TUNING.titlePoints} points each, from a minimum (see Points).
- Each dragon eats ${TUNING.livestockPerDragon} livestock a round, eggs included; the tower makes ${TUNING.towerProduction.livestock ?? 0}.
- Bank: ${TUNING.bankRate}:1${Object.values(BUILDINGS).filter((b) => b.bankRate).map((b) => `, ${b.bankRate}:1 with a ${b.name}`).join('')}.`;
}

function goldMakers(): string[] {
  return [...Object.values(BUILDINGS), ...Object.values(UPGRADES)].filter((c) => c.makes?.gold).map((c) => `${c.name}s`);
}

function production(): string {
  const workshop = Object.values(UPGRADES).find((u) => u.baseBonus);
  const rows = Object.values(BUILDINGS).filter((b) => b.produces).map((b) => {
    const p = b.produces!;
    const yieldPerRound = p.base + (p.die + 1) / 2;
    const v = value(b.cost);
    return [
      b.name, b.terrain!, cost(b.cost), v, `${p.base ? `${p.base} + ` : ''}d${p.die} ${p.resource} (avg ${n1(yieldPerRound)})`,
      warnPayback(v / yieldPerRound),
      workshop ? n1((v + value(workshop.cost)) / (yieldPerRound + workshop.baseBonus!)) : '—',
    ];
  });
  const extra = workshop
    ? `\n\n${workshop.name} (${cost(workshop.cost)}, value ${value(workshop.cost)}) adds ${workshop.baseBonus} a round: it pays for itself in ${warnPayback(value(workshop.cost) / workshop.baseBonus!)} rounds on its own.`
    : '';
  return `## Basic production buildings

Anyone may build these, no card needed. Payback = value of the cost ÷ average output a round. ⚠ marks under ${PAYBACK_WARN} rounds.

${table(['Building', 'Terrain', 'Cost', 'Value', 'Output a round', 'Payback', 'Payback with Workshop'], rows)}${extra}`;
}

// Generated maps, one batch per player count, shared by the land sections.
const MAP_SEEDS = 300;
const PLAYER_COUNTS = [2, 3, 4];
const hexDist = (a: { q: number; r: number }, b: { q: number; r: number }) => distance(a.q - b.q, a.r - b.r);
function sampleMaps(players: number) {
  return Array.from({ length: MAP_SEEDS }, (_, i) => generateMap({ state: (i + 1) * 7 + players }, players));
}
function towerHexes(players: number) {
  return towerSpots(players).map((k) => { const [q, r] = parseKey(k)!; return { q, r }; });
}
const PRODUCERS = Object.values(BUILDINGS).filter((b) => b.produces);

// Building cards whose effect counts their neighbours. For a terrain, the
// map decides the count: measured as the best open hex touching a tower (the
// first place one could go) and the share of all land hexes with 2 or more.
function neighbourCards(): string {
  const cards = Object.values(BUILDINGS).filter((b) => b.per);
  const terrains = new Set<string>(TERRAINS);
  const players = 3;
  const maps = sampleMaps(players);
  const measured = (t: Terrain) => {
    let best = 0, twoPlus = 0, landHexes = 0;
    for (const map of maps) {
      const count = (k: string) => neighbors(k).filter((n) => map[n]?.terrain === t).length;
      for (const tw of towerHexes(players)) {
        const spots = neighbors(key(tw.q, tw.r)).filter((n) => map[n] && map[n].terrain !== 'ocean' && map[n].terrain !== 'harbor');
        best += Math.max(0, ...spots.map(count));
      }
      for (const [k, h] of Object.entries(map)) if (h.terrain !== 'ocean') { landHexes++; if (count(k) >= 2) twoPlus++; }
    }
    return `${n1(best / (maps.length * players))} / ${pct(twoPlus / landHexes)}`;
  };
  const rows = cards.map((b) => {
    const v = value(b.cost);
    const counted = terrains.has(b.per!) ? `${b.per} hexes` : `${CLASS_NAMES[b.per as BuildingClass].replace(/y$/, 'ie')}s (anyone's)`;
    const each = b.makes ? value(b.makes) : 0;
    const at = (n: number) => (b.makes ? warnPayback(v / (each * n)) : n1(v / ((b.points ?? 0) * n)));
    return [b.name, CLASS_NAMES[b.class], counted, cost(b.cost), v, b.makes ? `${cost(b.makes)} a round` : `${b.points} point`, at(1), at(2), at(3), terrains.has(b.per!) ? measured(b.per as Terrain) : 'built'];
  });
  return `## Building cards that count their neighbours

Each effect is multiplied by how many of the building's six neighbouring hexes count: hexes of a terrain (built on or not), or buildings of a class, whoever owns them (the tower is a monument and a dragon building). Makers show payback in rounds; point buildings show value per point. "Map" is for ${players} players: the best count on an open hex touching a tower / share of land hexes with 2 or more.

${table(['Card', 'Class', 'Counts', 'Cost', 'Value', 'Each one adds', 'At 1', 'At 2', 'At 3', 'Map'], rows)}`;
}

function land(): string {
  // Measured on generated maps: how often a tower has each terrain next to it,
  // and how many hexes of it lie within 2 steps.
  const terrains = TERRAINS.filter((t) => t !== 'ocean');
  const totalWeight = Object.values(TERRAIN_WEIGHTS).reduce((s, w) => s + w!, 0);
  const rows = terrains.map((t) => {
    const cells: string[] = [];
    for (const players of PLAYER_COUNTS) {
      let adjacent = 0, near = 0, towers = 0;
      for (const map of sampleMaps(players)) {
        for (const tw of towerHexes(players)) {
          towers++;
          const hexes = Object.values(map).filter((h) => h.terrain === t);
          if (hexes.some((h) => hexDist(h, tw) === 1)) adjacent++;
          near += hexes.filter((h) => hexDist(h, tw) <= 2 && hexDist(h, tw) > 0).length;
        }
      }
      cells.push(`${pct(adjacent / towers)} / ${n1(near / towers)}`);
    }
    const share = TERRAIN_WEIGHTS[t] ? pct(TERRAIN_WEIGHTS[t]! / totalWeight) : 'coast';
    return [t, Object.values(BUILDINGS).find((b) => b.terrain === t)?.name ?? '—', share, ...cells];
  });
  const size = PLAYER_COUNTS.map((p) => { const R = mapRadius(p); return `${p}p radius ${R} (${3 * R * (R + 1) + 1} land hexes)`; }).join(', ');
  return `## Land

The land is ringed by ocean, where nothing is built. Each of its six coasts has one natural harbor at a random spot between its corners; ports go only on harbors. Land: ${size}. Terrain shares are of the random land, before towers and harbors are placed.

Measured on ${MAP_SEEDS} generated maps per player count. Each cell: share of towers with that terrain on a touching hex / average number of such hexes within 2 steps of the tower.

${table(['Terrain', 'For', 'Share of land', ...PLAYER_COUNTS.map((p) => `${p} players`)], rows)}`;
}

function shortages(): string {
  // Who is short of what, from the land alone: card costs ask for stone,
  // timber and crystal about equally (see Resource demand), so a player is
  // short of what their own land can't make. A player's "scarcest" resource is
  // the one with the fewest hexes to make it within 2 steps of their tower
  // (ties split evenly).
  const rows = PLAYER_COUNTS.map((players) => {
    let seats = 0, none = 0, sameScarcest = 0, pairs = 0;
    const scarcest = Object.fromEntries(PRODUCERS.map((b) => [b.produces!.resource, 0])) as Record<string, number>;
    for (const map of sampleMaps(players)) {
      const shares = towerHexes(players).map((tw) => {
        const counts = PRODUCERS.map((b) => Object.values(map).filter((h) => h.terrain === b.terrain && hexDist(h, tw) <= 2).length);
        const min = Math.min(...counts);
        const tied = counts.filter((c) => c === min).length;
        if (min === 0) none++;
        seats++;
        return counts.map((c) => (c === min ? 1 / tied : 0));
      });
      for (const sh of shares) PRODUCERS.forEach((b, i) => (scarcest[b.produces!.resource] += sh[i]));
      for (let a = 0; a < shares.length; a++) {
        for (let b = a + 1; b < shares.length; b++) {
          pairs++;
          sameScarcest += shares[a].reduce((s, x, i) => s + x * shares[b][i], 0);
        }
      }
    }
    return [players, pct(none / seats), pct(sameScarcest / pairs), PRODUCERS.map((b) => `${b.produces!.resource} ${pct(scarcest[b.produces!.resource] / seats)}`).join(', ')];
  });
  const harbor = PLAYER_COUNTS.map((players) => {
    let seats = 0, adjacent = 0, near = 0, steps = 0;
    for (const map of sampleMaps(players)) {
      const harbors = Object.values(map).filter((h) => h.terrain === 'harbor');
      for (const tw of towerHexes(players)) {
        seats++;
        const d = Math.min(...harbors.map((h) => hexDist(h, tw)));
        if (d === 1) adjacent++;
        if (d <= 2) near++;
        steps += d;
      }
    }
    return [players, pct(adjacent / seats), pct(near / seats), n1(steps / seats)];
  });
  return `## Shortages

What a player's own land can't make, they have to trade for. Measured on the same maps as Land, counting production terrain within 2 steps of each tower. If shortages were fully independent between players, two players would share their scarcest resource ${pct(1 / PRODUCERS.length)} of the time.

${table(['Players', 'Players with no land for some resource', 'Two players share their scarcest resource', 'Scarcest resource, how often'], rows)}

Harbors (for ports, the only way to beat the bank's ${TUNING.bankRate}:1):

${table(['Players', 'Harbor touching the tower', 'Harbor within 2 steps', 'Average steps to the nearest harbor'], harbor)}`;
}

function others(): string {
  const rows: (string | number)[][] = [];
  for (const b of Object.values(BUILDINGS).filter((b) => !b.produces && !b.points && !b.per)) {
    const v = value(b.cost);
    let does = b.text;
    if (b.bankRate) does += ` Saves ${TUNING.bankRate - b.bankRate} per resource bought vs the bank: pays back after buying ${n1(v / (TUNING.bankRate - b.bankRate))}.`;
    rows.push([b.name, b.basic ? 'basic building' : 'building card', cost(b.cost), v, does]);
  }
  for (const u of Object.values(UPGRADES).filter((u) => !u.baseBonus && !u.points)) {
    const v = value(u.cost);
    let does = u.text;
    if (u.makes) does += ` Pays back in ${warnPayback(v / value(u.makes))} rounds.`;
    rows.push([u.name, `upgrade (${u.appliesTo.map((c) => CLASS_NAMES[c]).join(', ')})`, cost(u.cost), v, does]);
  }
  return `## Dragon and trade buildings and upgrades

${table(['Card', 'Kind', 'Cost', 'Value', 'Does'], rows)}`;
}

function growth(gt: number, perRound: number, stage: number) {
  return Math.ceil((stage * gt) / perRound);
}

function points(): string {
  const rows: (string | number)[][] = [];
  for (const b of Object.values(BUILDINGS).filter((b) => b.points)) {
    // Neighbour-counting monuments, at 2 neighbours (see the table above).
    const pts = b.points! * (b.per ? 2 : 1);
    rows.push([b.per ? `${b.name}, 2 neighbours` : b.name, cost(b.cost), pts, n1(value(b.cost) / pts), 'now']);
  }
  for (const u of Object.values(UPGRADES).filter((u) => u.points)) {
    rows.push([`${u.name} (upgrade)`, cost(u.cost), u.points!, n1(value(u.cost) / u.points!), 'now']);
  }
  for (const a of Object.values(ACTIONS).filter((a) => a.effect === 'hidden_point')) {
    rows.push([`${a.name} (action card)`, cost(a.cost), 1, n1(value(a.cost)), 'now, uses a hand slot']);
  }
  // Dragons: cost plus the livestock eaten until each stage, without a hatchery.
  const base = Object.values(DRAGONS).find((d) => d.base)!;
  const seen = new Set<string>();
  for (const d of Object.values(DRAGONS)) {
    const sig = `${value(d.cost)}/${d.growthTime}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const label = d.base ? 'Base dragon' : `${Object.values(DRAGONS).filter((x) => !x.base && `${value(x.cost)}/${x.growthTime}` === sig).map((x) => x.name).join(', ')}`;
    for (const stage of [1, 2, 3]) {
      const rounds = growth(d.growthTime, 1, stage);
      const total = value(d.cost) + rounds * TUNING.livestockPerDragon;
      rows.push([`${label}, ${STAGE_NAMES[stage]}`, `${cost(d.cost)} + ${rounds} livestock`, TUNING.dragonPointsByStage[stage], n1(total / TUNING.dragonPointsByStage[stage]), rounds === 1 ? '1 round' : `${rounds} rounds`]);
    }
  }
  const sp = specialProjectCost(base.cost);
  const r3 = growth(base.growthTime, 1, 3);
  rows.push([`Base dragon by special project, adult`, `${cost(sp)} + ${r3} livestock`, TUNING.dragonPointsByStage[3], n1((value(sp) + r3) / TUNING.dragonPointsByStage[3]), `${r3} rounds`]);
  const hatchery = Object.values(BUILDINGS).find((b) => b.growthBonus);
  const hatcheryNote = hatchery
    ? `\n\nWith a ${hatchery.name} (+${hatchery.growthBonus} growth a round), a growth-time-${base.growthTime} dragon reaches adult in ${growth(base.growthTime, 1 + hatchery.growthBonus!, 3)} rounds instead of ${r3}.`
    : '';
  const tower = value(TUNING.towerProduction);
  // Spread of what a point costs, free cards aside.
  const priced = rows.filter((r) => Number(r[3]) > 0).sort((a, b) => Number(a[3]) - Number(b[3]));
  const [cheap, dear] = [priced[0], priced[priced.length - 1]];
  const spread = `Cheapest paid point: ${cheap[0]} at ${cheap[3]}. Dearest: ${dear[0]} at ${dear[3]}, ${n1(Number(dear[3]) / Number(cheap[3]))}× as much.`;
  return `## Points

Value per point = value of everything paid ÷ points. Dragon costs include the livestock eaten while growing, from egg, without a hatchery; an adult keeps eating ${TUNING.livestockPerDragon} a round. The tower alone makes ${tower} value a round, so a point at value V takes V ÷ ${tower} rounds of tower income.

${table(['Source', 'Pays', 'Points', 'Value per point', 'Ready'], rows)}

${spread}${hatcheryNote}

Titles: ${TUNING.titlePoints} points each, for most dragon points (at least ${TUNING.titleMinimum.army}), most tower floors (at least ${TUNING.titleMinimum.tower}) and most buildings, tower included (at least ${TUNING.titleMinimum.territory}).`;
}

function dragons(): string {
  const rows = Object.values(DRAGONS).filter((d, i, all) => !d.base || all.findIndex((x) => x.base) === i).map((d) => [
    d.base ? 'Base dragon (any element)' : d.name, d.base ? 'any' : d.element, cost(d.cost), d.growthTime, d.targeting,
    ...d.stages.map((s) => `${s.hp}hp ${s.targets}×${s.dice}d${s.sides} (${n1(avgAttack(s))})`),
  ]);
  return `## Dragons

Each stage: health, targets × dice (average damage a combat round, before elements).

${table(['Dragon', 'Element', 'Cost', 'Growth time', 'Targets', 'Hatchling', 'Young', 'Adult'], rows)}`;
}

// Run one raid through the real engine: P1 sends these dragons and fights to
// the end. Returns whether the kingdom fell.
// A small game to copy for each raid: no map, decks or log, so the engine's
// per-command snapshot stays cheap.
let template: Game | null = null;
function raid(target: string, dragons: { key: string; stage: number }[], seed: number): boolean {
  if (!template) {
    template = newGame(2, 1);
    template.log = [];
    template.decks = { building: [], action: [] };
    template.map = {}; // raids never look at the map
  }
  const g = structuredClone(template);
  g.rng = { state: seed };
  g.dragons = dragons.map((d, i) => ({ id: `d${i + 1}`, owner: 0, key: d.key, stage: d.stage, growth: 0, damage: 0, resting: '' }));
  const before = RESOURCES.reduce((s, r) => s + g.players[0].resources[r], 0);
  g.phase = 'raid';
  g.raidsLeft = 2; // so the engine stops at the next raid's vote, before healing
  g.raid = {
    step: 'vote', candidates: [target], votes: [null, null], target: null, commits: [[], []], ready: [false, false],
    choices: [null, null], units: [], fighters: [],
  };
  apply(g, 0, 'vote 1');
  apply(g, 1, 'vote 1');
  apply(g, 0, `commit ${g.dragons.map((d) => d.id).join(' ')}`);
  apply(g, 0, 'ready');
  apply(g, 0, 'fight');
  return RESOURCES.reduce((s, r) => s + g.players[0].resources[r], 0) > before; // only loot pays out here
}

const RAIDS_PER_CELL = 100; // about ±5 points of precision at 50%
function odds(target: string, dragons: { key: string; stage: number }[], salt: number) {
  let won = 0;
  for (let i = 0; i < RAIDS_PER_CELL; i++) if (raid(target, dragons, salt * 1000 + i)) won++;
  return won / RAIDS_PER_CELL;
}

function raids(): string {
  const targets = Object.keys(TARGETS);
  const targetRows = targets.map((k) => {
    const t = TARGETS[k];
    const units = t.units.map((u) => UNITS[u]);
    return [
      t.name, t.units.map((u) => UNITS[u].name).join(', '), units.reduce((s, u) => s + u.hp, 0),
      n1(units.reduce((s, u) => s + avgAttack(u), 0)), cost(t.loot), value(t.loot),
    ];
  });
  const unitRows = Object.values(UNITS).map((u) => [u.name, u.hp, `${u.targets}×${u.dice}d${u.sides} (${n1(avgAttack(u))})`, u.strong.join(', ') || '—', u.weak.join(', ') || '—']);

  // A lone dragon of every kind, at every stage, against every kingdom.
  const baseKeys = Object.keys(DRAGONS).filter((k) => DRAGONS[k].base);
  const head = ['Raider', ...targets.map((k) => TARGETS[k].name)];
  const rows: string[][] = [];
  let salt = 1;
  // Gold a lone base dragon expects from each kingdom, by stage.
  const goldEach: number[][] = [];
  for (const stage of [1, 2, 3]) {
    const avg = targets.map((t) => {
      const all = baseKeys.map((k) => odds(t, [{ key: k, stage }], salt++));
      return { all, mean: all.reduce((s, o) => s + o, 0) / all.length };
    });
    goldEach.push(avg.map((a, i) => a.mean * (TARGETS[targets[i]].loot.gold ?? 0)));
    rows.push([`Base dragon, ${STAGE_NAMES[stage]}`, ...avg.map(({ all, mean }) => `${pct(mean)} (${pct(Math.min(...all))}–${pct(Math.max(...all))})`)]);
  }
  // Raiding alone, the best of the kingdoms offered: the average over every set of candidates.
  const bestOf = (gold: number[]) => {
    const sets: number[] = [];
    const pick = (from: number, chosen: number[]) => {
      if (chosen.length === TUNING.raidCandidates) return void sets.push(Math.max(...chosen.map((i) => gold[i])));
      for (let i = from; i < gold.length; i++) pick(i + 1, [...chosen, i]);
    };
    pick(0, []);
    return sets.reduce((s, x) => s + x, 0) / sets.length;
  };
  const floor = BUILDINGS.tower_floor;
  const goldLine = `Gold a lone base dragon expects from one raid on the best of the ${TUNING.raidCandidates} kingdoms offered (if its vote wins): hatchling ${n1(bestOf(goldEach[0]))}, young ${n1(bestOf(goldEach[1]))}, adult ${n1(bestOf(goldEach[2]))}. A ${floor.name} takes ${floor.cost.gold} gold.`;
  const pairCells = targets.map((t) => {
    const all = baseKeys.map((k) => odds(t, [{ key: k, stage: 2 }, { key: k, stage: 2 }], salt++));
    return pct(all.reduce((s, o) => s + o, 0) / all.length);
  });
  rows.push(['Two young base dragons', ...pairCells]);
  for (const [k, d] of Object.entries(DRAGONS).filter(([, d]) => !d.base)) {
    rows.push([`${d.name} (${d.element}), adult`, ...targets.map((t) => pct(odds(t, [{ key: k, stage: 3 }], salt++)))]);
  }

  return `## Raids

Defenders:

${table(['Unit', 'Health', 'Attack (avg)', 'Strong vs', 'Weak vs'], unitRows)}

Kingdoms (${TUNING.raidCandidates} are offered each raid; average damage is the defenders' total a combat round):

${table(['Kingdom', 'Defenders', 'Total health', 'Avg damage a round', 'Loot', 'Loot value'], targetRows)}

Chance the kingdom falls to one player's raiders fighting to the end, from ${RAIDS_PER_CELL} raids through the engine per cell. Base dragon rows average the five elements, with the worst and best element in brackets. Loot is split among the players still fighting, so a shared raid pays each less.

${table(head, rows)}

${goldLine}`;
}

function deck(): string {
  const build = [...Object.values(BUILDINGS), ...Object.values(UPGRADES)];
  const act = [...Object.values(ACTIONS), ...Object.values(DRAGONS)];
  const nb = build.reduce((s, c) => s + (c.copies ?? 0), 0);
  const na = act.reduce((s, c) => s + c.copies, 0);
  // Chance one player is dealt at least one copy within 5 rounds, ignoring
  // what other players draw (a fair approximation while the deck is large).
  const within = (copies: number, deckSize: number, draws: number) => {
    let miss = 1;
    for (let i = 0; i < draws; i++) miss *= (deckSize - copies - i) / (deckSize - i);
    return 1 - Math.max(0, miss);
  };
  const R = 5;
  const seen = R * TUNING.buildingCardsDrawn;
  const rows = [
    ...Object.values(BUILDINGS).filter((c) => c.copies).map((c) => [c.name, 'building', c.copies!, pct(c.copies! / nb), pct(within(c.copies!, nb, seen))]),
    ...Object.values(UPGRADES).map((c) => [c.name, 'building deck (upgrade)', c.copies, pct(c.copies / nb), pct(within(c.copies, nb, seen))]),
    ...Object.values(ACTIONS).map((c) => [c.name, 'action', c.copies, pct(c.copies / na), pct(within(c.copies, na, R * TUNING.actionCardsPerRound))]),
  ];
  const upgradeCopies = Object.values(UPGRADES).reduce((s, u) => s + u.copies, 0);
  rows.push([`Any upgrade (${Object.keys(UPGRADES).length} kinds)`, 'building deck (upgrade)', upgradeCopies, pct(upgradeCopies / nb), pct(within(upgradeCopies, nb, seen))]);
  const firstTwo = within(upgradeCopies, nb, 2 * TUNING.buildingCardsDrawn);
  const dragonCopies = Object.values(DRAGONS).reduce((s, d) => s + d.copies, 0);
  rows.push([`Any dragon (${Object.keys(DRAGONS).length} kinds)`, 'action', dragonCopies, pct(dragonCopies / na), pct(within(dragonCopies, na, R * TUNING.actionCardsPerRound))]);
  return `## Decks

Building deck ${nb} cards (${Object.values(BUILDINGS).filter((c) => c.copies).length} buildings, ${Object.keys(UPGRADES).length} upgrades), action deck ${na}. Last column: chance a player draws at least one (to keep or pass over) within ${R} rounds. A player draws at least one upgrade in their first 2 rounds ${pct(firstTwo)} of the time.

${table(['Card', 'Deck', 'Copies', 'Share of deck', `By round ${R}`], rows)}`;
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
    return s.join(', ') || 'nothing';
  };
  const rows = RESOURCES.map((r) => [r, spend[r], pct(spend[r] / total), sources(r)]);
  return `## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy; basic buildings aren't cards and aren't counted), plus where it comes from. Dragon upkeep (${TUNING.livestockPerDragon} livestock per dragon a round) comes on top.

${table(['Resource', 'In all card costs', 'Share', 'Comes from'], rows)}`;
}

function length(): string {
  const GAMES = 30;
  const rows = [2, 3, 4].map((players) => {
    const rounds: number[] = [];
    let stalled = 0;
    const held = { army: 0, tower: 0, territory: 0 };
    for (let i = 0; i < GAMES; i++) {
      const g = newGame(players, 1 + i);
      playOut(g, { state: 7919 + i });
      if (g.phase === 'over') rounds.push(g.round);
      else stalled++;
      for (const t of Object.keys(held) as (keyof typeof held)[]) if (g.titles[t] !== null) held[t]++;
    }
    rounds.sort((a, b) => a - b);
    return [players, rounds[0] ?? '—', rounds[Math.floor(rounds.length / 2)] ?? '—', rounds[rounds.length - 1] ?? '—', stalled, ...Object.values(held).map((n) => pct(n / GAMES))];
  });
  return `## Game length (random bots)

${GAMES} games per player count between the random bot (\`src/bot.ts\`). Random bots play badly, so this is a sanity check on pace, not a prediction.

Last three columns: share of games that end with someone holding each title (it needs ${TUNING.titleMinimum.army} dragon points, ${TUNING.titleMinimum.tower} tower floors or ${TUNING.titleMinimum.territory} buildings).

${table(['Players', 'Fewest rounds', 'Median', 'Most', 'Stalled', 'Army held', 'Tower held', 'Territory held'], rows)}`;
}

export function datasheet(): string {
  return `# Tuning datasheet

Generated from \`src/data.ts\` and the engine by \`npm run datasheet\`; don't edit by hand. \`npm test\` fails when it is out of date, so after changing any number, rerun \`npm run datasheet\` and read the diff: it shows what the change does to payback, cost per point and raid odds.

${[economy(), production(), land(), shortages(), neighbourCards(), others(), points(), dragons(), raids(), demand(), deck(), length()].join('\n\n')}
`;
}

export const DATASHEET_PATH = fileURLToPath(new URL('../docs/datasheet.md', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(DATASHEET_PATH, datasheet());
  console.log(`Wrote ${DATASHEET_PATH}`);
}
