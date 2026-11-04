import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publicState, seatState } from '../src/state.ts';
import { SCENES, stage } from '../src/shots/scenes.ts';
import { checkName, claim, defaultName, KEEP_DAYS, tidy } from '../src/shots/tidy.ts';

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

test('screenshot runs clear away what no one needs: gone checkouts, old runs, stray Chrome profiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'shots-tidy-')); // a few empty folders: tiny, even where /tmp is RAM
  try {
    const live = mkdtempSync(join(tmpdir(), 'shots-checkout-'));
    const run = (name: string, checkout: string | null, daysOld = 0) => {
      const dir = join(root, name);
      mkdirSync(dir);
      if (checkout) claim(dir, checkout);
      const t = new Date(Date.now() - daysOld * 86400000);
      utimesSync(dir, t, t);
    };
    run('mine', live);
    run('mine.previous', live, KEEP_DAYS + 1); // old, but the run about to start replaces it anyway
    run('fresh', live, 1);
    run('closed-tab', join(live, 'gone'));
    run('stale', live, KEEP_DAYS + 1);
    run('legacy', null, KEEP_DAYS + 1);
    run('legacy-new', null, 1);
    run('chrome-profile-123-abc', null);
    mkdirSync(join(root, 'rooms'));
    const removed = tidy(root, [join(root, 'mine'), join(root, 'mine.previous')]);
    assert.deepEqual(removed.sort(), ['chrome-profile-123-abc', 'closed-tab', 'legacy', 'stale']);
    assert.deepEqual(readdirSync(root).sort(), ['fresh', 'legacy-new', 'mine', 'mine.previous', 'rooms']);
    rmSync(live, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--out takes a name, never a path (so nothing lands in /tmp, which is RAM)', () => {
  assert.equal(checkName('before-205'), 'before-205');
  for (const bad of ['/tmp/x', '../x', 'a/b', '.x', 'x.previous', '']) assert.throws(() => checkName(bad), /takes a name/);
  assert.notEqual(defaultName('/a/before'), defaultName('/b/before'));
  assert.match(defaultName('/a/tab-7'), /^tab-7-[0-9a-f]{6}$/);
});
