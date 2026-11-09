// Hex map in axial coordinates (q, r). Keys are "q,r".

import { BASIC_BUILDINGS, BEASTS, BUILDINGS, FAUNA_BY_DISTANCE, TERRAIN_WEIGHTS, TUNING, type Terrain } from './data.ts';
import { type Rng, next, shuffle } from './rng.ts';

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
  fauna?: string; // a beast on this hex, a FAUNA or BEASTS key
  sent?: true; // the beast here came from a card: it gives no loot
}

// The Thunderbird's peak: the mountain at the centre of the map.
export const PEAK = '0,0';

export const DIRECTIONS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const key = (q: number, r: number) => `${q},${r}`;

export function parseKey(k: string): [number, number] | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(k.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function neighbors(k: string): string[] {
  const [q, r] = parseKey(k)!;
  return DIRECTIONS.map(([dq, dr]) => key(q + dq, r + dr));
}

// Radius of the land; the ocean is one more ring around it.
export function mapRadius(players: number): number {
  return players <= 3 ? 4 : players === 4 ? 5 : 6;
}

// Tower spots, fixed by player count, so each seat has as much land around it
// as the others. With 2, 3, 4 or 6 players: corners of the ring one in from
// the coast. Five can't share six corners fairly (#376: the two seats beside
// the empty one got half as much land again), so they spread evenly around the
// ring 4 from the centre, each with the same land within 3 steps.
const CORNERS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
const FIVE = ['4,-1', '3,-4', '-2,-2', '-4,2', '-1,4'];

export function towerSpots(players: number): string[] {
  if (players === 5) return FIVE;
  const d = mapRadius(players) - 1;
  return CORNERS[players].map((i) => key(DIRECTIONS[i][0] * d, DIRECTIONS[i][1] * d));
}

function randomTerrain(rng: Rng): Terrain {
  const land = Object.entries(TERRAIN_WEIGHTS) as [Terrain, number][];
  let x = next(rng) * land.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of land) {
    x -= w;
    if (x < 0) return t;
  }
  return 'desert';
}

export const distance = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

// The hexes of ring d, starting at corner 0 and walking each side in turn:
// side i runs from corner i towards corner i+1 (d hexes, its corner first).
export function ring(d: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const [cq, cr] = DIRECTIONS[i];
    const [sq, sr] = DIRECTIONS[(i + 2) % 6];
    for (let j = 0; j < d; j++) out.push([cq * d + sq * j, cr * d + sr * j]);
  }
  return out;
}

// Fair starts (#424): roll maps until every start has about as much basic
// production opportunity as the others, ring by ring (see TUNING.fairStart).
// Rerolling from the same dice keeps one seed to one map. If no roll passes
// within MAX_ROLLS, the fairest one seen is used.
const MAX_ROLLS = 2000;

export function generateMap(rng: Rng, players: number): Record<string, Hex> {
  let best: Record<string, Hex> | null = null;
  let bestSpread = Infinity;
  for (let i = 0; i < MAX_ROLLS; i++) {
    const hexes = rollMap(rng, players);
    const spread = startSpread(hexes, players);
    if (spread <= TUNING.fairStart.tolerance) return hexes;
    if (spread < bestSpread) [best, bestSpread] = [hexes, spread];
  }
  return best!;
}

// Terrains a basic building goes on.
const BASIC_TERRAINS = new Set(BASIC_BUILDINGS.map((b) => BUILDINGS[b].terrain).filter((t) => t));

// A start's opportunity in ring d around its tower: each hex there a basic
// building can go on counts 1, each ocean hex 1 less TUNING.fairStart.oceanCost,
// and any other hex (desert, harbor) nothing. Past the ocean is off the map.
export function opportunity(hexes: Record<string, Hex>, tower: string, d: number): number {
  const [tq, tr] = parseKey(tower)!;
  let sum = 0;
  for (const [q, r] of ring(d)) {
    const h = hexes[key(tq + q, tr + r)];
    if (!h) continue;
    if (BASIC_TERRAINS.has(h.terrain)) sum += 1;
    else if (h.terrain === 'ocean') sum += 1 - TUNING.fairStart.oceanCost;
  }
  return sum;
}

// Each start's opportunity in rings 1 to TUNING.fairStart.rings, then in their total.
export function startOpportunity(hexes: Record<string, Hex>, players: number): number[][] {
  return towerSpots(players).map((t) => {
    const rings = Array.from({ length: TUNING.fairStart.rings }, (_, i) => opportunity(hexes, t, i + 1));
    return [...rings, rings.reduce((a, b) => a + b, 0)];
  });
}

// The furthest any start's opportunity is from the average across starts, as
// a share of that average, over every ring and the total.
export function startSpread(hexes: Record<string, Hex>, players: number): number {
  const rows = startOpportunity(hexes, players);
  let worst = 0;
  for (let c = 0; c < rows[0].length; c++) {
    const col = rows.map((row) => row[c]);
    const avg = col.reduce((a, b) => a + b, 0) / col.length;
    if (avg === 0) continue;
    for (const x of col) worst = Math.max(worst, Math.abs(x - avg) / avg);
  }
  return worst;
}

function rollMap(rng: Rng, players: number): Record<string, Hex> {
  const radius = mapRadius(players);
  const hexes: Record<string, Hex> = {};
  for (let q = -radius - 1; q <= radius + 1; q++) {
    for (let r = Math.max(-radius - 1, -q - radius - 1); r <= Math.min(radius + 1, -q + radius + 1); r++) {
      hexes[key(q, r)] = { q, r, terrain: distance(q, r) > radius ? 'ocean' : randomTerrain(rng) };
    }
  }
  // Towers sit on desert hexes; the land around them is as random as the rest, so
  // players start with different terrain and different things to sell.
  for (const spot of towerSpots(players)) hexes[spot].terrain = 'desert';
  // One natural harbor on each of the six coasts, somewhere between its
  // corners but not touching a tower: a port is something you build towards.
  const coast = ring(radius);
  const towers = new Set(towerSpots(players));
  for (let side = 0; side < 6; side++) {
    const between = coast.slice(side * radius + 1, (side + 1) * radius);
    const open = between.filter(([q, r]) => !neighbors(key(q, r)).some((n) => towers.has(n)));
    const [q, r] = (open.length ? open : between)[Math.floor(next(rng) * (open.length || between.length))];
    hexes[key(q, r)].terrain = 'harbor';
  }
  placeBeasts(rng, hexes, players);
  placeFauna(rng, hexes, players);
  return hexes;
}

// Is hex k held by a great beast: on it, or next to it?
export function nearBeast(hexes: Record<string, Hex>, k: string): boolean {
  return [k, ...neighbors(k)].some((n) => !!hexes[n]?.fauna && !!BEASTS[hexes[n].fauna!]);
}

// The great beasts: the Thunderbird on the peak at the centre, and the
// Leviathan in the ocean beside one coast's harbor, on a random coast.
function placeBeasts(rng: Rng, hexes: Record<string, Hex>, players: number) {
  hexes[PEAK].terrain = 'mountain';
  hexes[PEAK].fauna = 'thunderbird';
  const harbors = Object.keys(hexes).filter((k) => hexes[k].terrain === 'harbor').sort();
  const harbor = harbors[Math.floor(next(rng) * harbors.length)];
  const waters = leviathanWaters(hexes, players);
  const sea = neighbors(harbor).filter((n) => hexes[n]?.terrain === 'ocean');
  const clear = sea.filter((n) => waters.includes(n));
  const pool = clear.length ? clear : sea;
  hexes[pool[Math.floor(next(rng) * pool.length)]].fauna = 'leviathan';
}

// Where the Leviathan may be: the ocean hexes whose hold keeps clear of every
// tower's adjacent hexes, so each player's first ring stays open (all of the
// ocean if none does).
export function leviathanWaters(hexes: Record<string, Hex>, players: number): string[] {
  const towers = towerSpots(players);
  const nearTower = (k: string) => towers.some((t) => t === k || neighbors(t).includes(k));
  const sea = Object.keys(hexes).filter((k) => hexes[k].terrain === 'ocean').sort();
  const clear = sea.filter((s) => !neighbors(s).some((n) => hexes[n] && nearTower(n)));
  return clear.length ? clear : sea;
}

// Aggressive fauna on the starting map: one beast per TUNING.landHexesPerFauna
// land hexes, on random hexes at least 2 steps from every tower, so each
// player's first ring is open. The further from the towers, the stronger.
function placeFauna(rng: Rng, hexes: Record<string, Hex>, players: number) {
  const towers = towerSpots(players).map((k) => parseKey(k)!);
  const land = Object.values(hexes).filter((h) => h.terrain !== 'ocean');
  const away = (h: Hex) => Math.min(...towers.map(([q, r]) => distance(h.q - q, h.r - r)));
  const open = shuffle(rng, land.filter((h) => away(h) >= 2 && !nearBeast(hexes, key(h.q, h.r))));
  for (const h of open.slice(0, Math.round(land.length / TUNING.landHexesPerFauna))) {
    h.fauna = FAUNA_BY_DISTANCE[Math.min(away(h) - 2, FAUNA_BY_DISTANCE.length - 1)];
  }
}
