// What the phone says a building does (web/does.ts), and what its rulebook
// says a special project costs (web/book.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, TUNING, UPGRADES } from '../src/data.ts';
import { newGame } from '../src/engine.ts';
import { publicState, rulebook, seatState } from '../src/state.ts';
import { neighbors } from '../src/map.ts';
import { bookSheet, loadBook } from '../web/book.ts';
import { doesParts } from '../web/does.ts';

test('every building says what it does, even where it makes nothing (#545)', () => {
  const g = newGame(2, 7);
  const k = neighbors(g.towers[0]).find((n) => g.map[n].terrain !== 'ocean' && !g.map[n].fauna)!;
  const says = (type: string) => {
    g.buildings[k] = { type, owner: 0, upgrades: [], floors: 0 };
    return doesParts(publicState(g, 10).map.find((h) => h.k === k)!.building!.does);
  };
  for (const type of Object.keys(BUILDINGS)) if (!BUILDINGS[type].onTower) assert.ok(says(type).length, type);
  assert.deepEqual(says('hatchery'), ['Dragons grow 1 extra step']);
  assert.deepEqual(says('timber_port'), ['Trade timber at 2:1']);
});

test("the phone's rulebook gives the Workshop project's cost as the game charges it (#547)", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => Response.json(rulebook());
  try {
    await loadBook(-1, () => {}); // no seat: no pictures
  } finally {
    globalThis.fetch = real;
  }
  const said = [...bookSheet('buildings').matchAll(/Also a special project, at (\w+) the cost/g)].map((m) => m[1]);
  const g = newGame(2, 7);
  const charged = seatState(g, g.turn).upgradeProjects.map((u) => {
    const card = UPGRADES[u.key].cost;
    const times = new Set(Object.entries(u.cost).map(([r, n]) => n! / card[r as 'stone']!));
    assert.equal(times.size, 1);
    return [...times][0];
  });
  assert.ok(charged.length);
  assert.deepEqual(charged, charged.map(() => TUNING.specialProjectMultiplier.upgrade));
  assert.deepEqual(said, charged.map((n) => ({ 2: 'double', 3: 'triple' })[n]));
});
