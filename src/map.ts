// Hex map in axial coordinates (q, r). Keys are "q,r".

import { TERRAIN_WEIGHTS, TERRAINS, type Terrain } from './data.ts';
import { type Rng, next } from './rng.ts';

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

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

// Tower spots: corners of the ring one in from the edge, spread by player count.
const CORNERS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };

export function towerSpots(players: number): string[] {
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
  return 'plains';
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

export function generateMap(rng: Rng, players: number): Record<string, Hex> {
  const radius = mapRadius(players);
  const hexes: Record<string, Hex> = {};
  for (let q = -radius - 1; q <= radius + 1; q++) {
    for (let r = Math.max(-radius - 1, -q - radius - 1); r <= Math.min(radius + 1, -q + radius + 1); r++) {
      hexes[key(q, r)] = { q, r, terrain: distance(q, r) > radius ? 'ocean' : randomTerrain(rng) };
    }
  }
  // Towers sit on plains; the land around them is as random as the rest, so
  // players start with different terrain and different things to sell.
  for (const spot of towerSpots(players)) hexes[spot].terrain = 'plains';
  // One natural harbor on each of the six coasts, somewhere between its corners.
  const coast = ring(radius);
  for (let side = 0; side < 6; side++) {
    const [q, r] = coast[side * radius + 1 + Math.floor(next(rng) * (radius - 1))];
    hexes[key(q, r)].terrain = 'harbor';
  }
  return hexes;
}
