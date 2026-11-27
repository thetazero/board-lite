// The lobby's explanation of the game (explain.ts plays it): what it says and
// how long each step stays. Words and numbers only, so test/explain.test.ts
// can hold them against the rules.
import { POINTS_TO_WIN } from './common.ts';

export type Show = 'title' | 'production' | 'cards' | 'actions' | 'grow' | 'vote' | 'fight' | 'points';
// `phase` is the round's phase it shows, lit on the track; the title and the
// points belong to no phase.
export interface Step { show: Show; phase: string | null; text: string; ms: number }

export const ROUND = ['Production', 'Cards', 'Actions', 'Raid'];

export const STEPS: Step[] = [
  { show: 'title', phase: null, text: '', ms: 5000 },
  { show: 'production', phase: 'Production', text: 'Each round, your tower and buildings make resources.', ms: 7000 },
  { show: 'cards', phase: 'Cards', text: 'Keep 1 of 2 building cards. Building it costs the resources on it.', ms: 8000 },
  { show: 'actions', phase: 'Actions', text: 'On your turn, build adjacent to your buildings and hatch dragon eggs.', ms: 8500 },
  { show: 'grow', phase: 'Production', text: 'Each round, your dragons eat livestock and grow.', ms: 6500 },
  { show: 'vote', phase: 'Raid', text: 'Vote for the kingdom to raid together.', ms: 6500 },
  { show: 'fight', phase: 'Raid', text: "If the kingdom falls, split the loot by your dragons' power.", ms: 7500 },
  { show: 'points', phase: null, text: `First to ${POINTS_TO_WIN} points wins.`, ms: 7000 },
];

// Most of what scores, with its points.
export const SCORES = [
  { name: 'Production building', points: 1 },
  { name: 'Monument card', points: 2 },
  { name: 'Great beast', points: 4 },
  { name: 'Title', points: 7 },
];

// The building cards drawn, the first kept and then built; the kingdoms voted on; the one raided.
export const DRAWN = ['stonemason', 'lighthouse'];
export const KINGDOMS = ['brindle', 'archers_hold', 'frostpeak'];
export const RAIDED = 1;

// The board it plays on: two towers on a small island.
const LAND: Record<string, string> = {
  '-2,-1': 'mountain', '-1,-1': 'forest', '0,-1': 'desert', '1,-1': 'ley', '2,-1': 'meadow', '3,-1': 'forest',
  '-3,0': 'meadow', '-2,0': 'desert', '-1,0': 'ley', '0,0': 'meadow', '1,0': 'mountain', '2,0': 'desert', '3,0': 'meadow',
  '-3,1': 'forest', '-2,1': 'mountain', '-1,1': 'meadow', '0,1': 'forest', '1,1': 'ley', '2,1': 'mountain',
};
export const HEXES: { q: number; r: number; terrain: string }[] = [];
for (let r = -2; r <= 2; r++) for (let q = -5; q <= 5; q++) if (Math.abs(q + r / 2) <= 4) HEXES.push({ q, r, terrain: LAND[`${q},${r}`] ?? 'ocean' });

// What's built, in order: each is there from board `from` on (explain.ts).
export const BUILT: { at: string; type: string; owner: number; from: number }[] = [
  { at: '-2,0', type: 'tower', owner: 0, from: 0 },
  { at: '2,0', type: 'tower', owner: 1, from: 0 },
  { at: '-2,1', type: 'quarry', owner: 0, from: 0 },
  { at: '1,0', type: 'quarry', owner: 1, from: 0 },
  { at: '-3,1', type: 'stonemason', owner: 0, from: 1 },
  { at: '-3,0', type: 'pasture', owner: 0, from: 2 },
  { at: '3,0', type: 'pasture', owner: 1, from: 6 },
  { at: '-1,0', type: 'roost', owner: 0, from: 7 },
  { at: '2,1', type: 'roost', owner: 1, from: 7 },
  { at: '-2,-1', type: 'monument', owner: 0, from: 7 },
  { at: '2,-1', type: 'monument', owner: 1, from: 7 },
];
