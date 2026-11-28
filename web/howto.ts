// The rulebook's How to play tab (book.ts): the goal, the round and the points,
// for someone who hasn't played. Words only, and nothing from the server, so it
// reads even if the rest of the book doesn't load; test/howto.test.ts holds it
// against the rules.
import { POINTS_TO_WIN } from './common.ts';
import { BEAST_POINTS, BUILDING_POINTS, MONUMENT_POINTS, TITLE_POINTS, TITLES } from './explain-steps.ts';

export const GOAL = `Raise dragons, build out from your tower and raid kingdoms to score points. If anyone has ${POINTS_TO_WIN} points at the end of a round, the most points wins.`;

export const PHASES: { name: string; text: string }[] = [
  { name: 'Production', text: 'Your tower and buildings make resources. Your dragons eat livestock and grow.' },
  { name: 'Cards', text: 'Draw 1 action card and 2 building cards. Keep 1 of the building cards.' },
  { name: 'Actions', text: 'On your turn, build adjacent to your buildings, play cards, send dragons to clear beasts, and trade.' },
  { name: 'Raid', text: 'Vote for a kingdom to raid together. Choose which of your dragons fight. If the kingdom falls, split the loot by combat power.' },
];

export const WORKSHOP_POINTS = 1, HOARD_POINTS = 2;
export const KINGDOM_POINTS = [{ name: 'Cinderkeep', points: 1 }, { name: 'Titan’s Throne', points: 2 }];

const names = TITLES.map((t) => t.name);
export const SCORES: { points: number; text: string }[] = [
  { points: TITLE_POINTS, text: `Each title you hold: ${names.slice(0, -1).join(', ')} and ${names.at(-1)}` },
  { points: BEAST_POINTS, text: 'Each great beast you slay' },
  { points: MONUMENT_POINTS, text: 'Each monument card you build' },
  { points: HOARD_POINTS, text: 'Each Secret Hoard card in your hand' },
  { points: BUILDING_POINTS, text: 'Each production building' },
  { points: WORKSHOP_POINTS, text: 'Each Workshop' },
  ...KINGDOM_POINTS.map((k) => ({ points: k.points, text: `${k.name} falls, and you have the most combat power in the raid` })),
];
