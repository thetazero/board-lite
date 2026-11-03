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

export function generateMap(rng: Rng, players: number): Record<string, Hex> {
  const radius = mapRadius(players);
  const hexes: Record<string, Hex> = {};
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      hexes[key(q, r)] = { q, r, terrain: randomTerrain(rng) };
    }
  }
  // Fair starts: every tower sits on plains with one of each terrain around it.
  for (const spot of towerSpots(players)) {
    hexes[spot].terrain = 'plains';
    const ring = shuffle(rng, ['mountain', 'forest', 'ley', 'meadow', 'plains', 'plains'] as Terrain[]);
    neighbors(spot).forEach((n, i) => {
      if (hexes[n]) hexes[n].terrain = ring[i];
    });
  }
  return hexes;
}
