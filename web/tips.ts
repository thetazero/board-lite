// Tips for mistakes players often make. The TV lobby shows one at a time,
// a random one every TIP_MS (tv.ts); docs/rules.md's Tips section lists them
// all, word for word (test/tips.test.ts), and bots read it with the rules.
export const TIPS = [
  'Empty hexes run out by the end of the game. Build out early, so your rivals don\'t box you in.',
  'A lone dragon perched on a rival\'s building is easy prey: its owner can clear it with all their dragons at once.',
];

export const TIP_MS = 30_000;

// A random tip other than the one showing, when there's another to show.
export function nextTip(now: number, random = Math.random): number {
  if (TIPS.length < 2) return 0;
  const i = Math.floor(random() * (TIPS.length - 1));
  return i >= now ? i + 1 : i;
}
