// Hex map in axial coordinates (q, r). Keys are "q,r".

import { TERRAIN_WEIGHTS, TERRAINS, type Terrain } from './data.ts';
import { type Rng, next, shuffle } from './rng.ts';

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

export function mapRadius(players: number): number {
  return players <= 3 ? 3 : players === 4 ? 4 : 5;
}

// Tower spots: corners of the ring one in from the edge, spread by player count.
const CORNERS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };

export function towerSpots(players: number): string[] {
  const d = mapRadius(players) - 1;
  return CORNERS[players].map((i) => key(DIRECTIONS[i][0] * d, DIRECTIONS[i][1] * d));
}

function randomTerrain(rng: Rng): Terrain {
  const total = TERRAINS.reduce((s, t) => s + TERRAIN_WEIGHTS[t], 0);
  let x = next(rng) * total;
  for (const t of TERRAINS) {
    x -= TERRAIN_WEIGHTS[t];
    if (x < 0) return t;
  }
  return 'plains';
}

// Seat N's homeland. Seats sitting next to each other on the map get
// complementary pairs, and the first N pairs use every terrain about equally.
export const HOMELANDS: [Terrain, Terrain][] = [
  ['mountain', 'forest'], ['ley', 'meadow'], ['mountain', 'ley'], ['forest', 'meadow'], ['mountain', 'meadow'], ['forest', 'ley'],
];

export function generateMap(rng: Rng, players: number): Record<string, Hex> {
  const radius = mapRadius(players);
  const hexes: Record<string, Hex> = {};
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      hexes[key(q, r)] = { q, r, terrain: randomTerrain(rng) };
    }
  }
  // Homelands: every tower sits on plains, ringed by three hexes each of two
  // production terrains. Neighbours get complementary pairs (stone and timber
  // lands next to crystal and livestock lands), so players need each other.
  towerSpots(players).forEach((spot, i) => {
    hexes[spot].terrain = 'plains';
    const [a, b] = HOMELANDS[i];
    const ring = shuffle(rng, [a, a, a, b, b, b]);
    neighbors(spot).forEach((n, j) => {
      if (hexes[n]) hexes[n].terrain = ring[j];
    });
  });
  return hexes;
}
