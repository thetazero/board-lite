// A phone's table view (the TV page in a frame, web/tv.ts) that has fallen
// behind the server: it doesn't play the scenes the server no longer holds the
// table for, or the phone stays cut to the table over an open vote until a
// reload (#449). The rule is web/scenes.ts's `behind`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { behind, BEHIND_GRACE_MS, scenesMs, scenesOf, type SceneEvent } from '../web/scenes.ts';

// A frame that plays scenes the way tv.ts does: one after another, each for
// its length, skipping what `behind` says to whenever a snapshot comes in.
function frame() {
  let now = 0;
  let queue: number[] = [];
  let playing: { ends: number } | null = null;
  const advance = (to: number) => {
    while (true) {
      if (!playing && queue.length) playing = { ends: now + queue.shift()! };
      if (!playing || playing.ends > to) break;
      now = playing.ends;
      playing = null;
    }
    now = to;
  };
  return {
    // A snapshot arrives at `at` with new scenes, and the server's word on how long it still holds the table.
    snapshot(at: number, scenes: number[], serverLeft: number) {
      advance(at);
      queue.push(...scenes);
      const r = behind(serverLeft, playing ? playing.ends - now : null);
      if (r.skipQueued) queue = [];
      if (r.endPlaying) playing = null;
      advance(at);
    },
    // Whether it's still playing (so the phone is cut to the table) at `at`.
    cut(at: number) {
      advance(at);
      return !!playing || queue.length > 0;
    },
  };
}

const hunt: SceneEvent[] = [
  { round: 3, ev: { k: 'hunt' } as never },
  { round: 3, ev: { k: 'combat', hits: [{}, {}] } as never },
  { round: 3, ev: { k: 'cleared' } as never },
];
const huntMs = scenesMs(scenesOf(hunt));

test('a table view that was away skips the scenes it missed, so the vote shows (#449)', () => {
  // The phone slept through two hunts and the end of the action phase. When it
  // wakes, the server has long since stopped holding the table: the vote is open.
  const f = frame();
  f.snapshot(60_000, [huntMs, huntMs], 0);
  assert.equal(f.cut(60_000), false, 'nothing plays over the vote');
});

test('a scene the server holds plays out; its last moment is not cut short', () => {
  const f = frame();
  f.snapshot(0, [huntMs], huntMs);
  assert.equal(f.cut(huntMs - 2000), true, 'the hunt plays while the server holds the table');
  // The server's "over" arrives a moment before the frame's own scene ends (the frame heard of it late).
  f.snapshot(huntMs - 300, [], 0);
  assert.equal(f.cut(huntMs - 300), true, 'its last moment plays');
  assert.equal(f.cut(huntMs), false);
});

test("a table view far behind ends its scene once the server's is over", () => {
  // Two hunts come in one snapshot (the phone's stream caught up at once), but
  // the server only holds the table for what's left of them: one hunt's worth.
  const f = frame();
  f.snapshot(0, [huntMs, huntMs], huntMs);
  assert.equal(f.cut(huntMs + 1), true);
  f.snapshot(huntMs + 1, [], 0);
  assert.equal(f.cut(huntMs + 1 + BEHIND_GRACE_MS), false, "the phone is back on its own screen within a moment of the server's scene ending");
});
