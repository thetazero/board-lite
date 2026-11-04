import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicState, seatState } from '../src/state.ts';
import { SCENES, stage } from '../src/shots/scenes.ts';

// The browser part (npm run shots) needs Chrome and isn't run here; the
// staging is, so a rules change that makes a scene unreachable shows up in CI.
test('every screenshot scene stages, the same way every time', () => {
  const files = new Set<string>();
  for (const scene of SCENES) {
    const a = stage(scene);
    const b = stage(scene);
    assert.deepEqual(a.game, b.game, `${scene.name} stages the same game twice`);
    const shots = scene.shots(a.game);
    assert.ok(shots.length, scene.name);
    for (const s of shots) {
      assert.ok(!files.has(s.file), `${s.file} is used once`);
      files.add(s.file);
      if (s.seat !== undefined) assert.ok(s.seat >= 0 && s.seat < scene.players, `${s.file} has a real seat`);
      if (s.live) assert.ok(scene.live, `${s.file} is live, so its scene says how far to play`);
      if (s.fill || s.path || s.remember) assert.equal(s.seat, undefined, `${s.file} is a phone that hasn't joined`);
    }
    if (a.game) {
      publicState(a.game);
      a.game.players.forEach((_, p) => seatState(a.game!, p));
    }
  }
  // The games cover every player count the game supports.
  assert.deepEqual([...new Set(SCENES.filter((s) => !s.lobby).map((s) => s.players))].sort(), [2, 3, 4, 5, 6]);
});
