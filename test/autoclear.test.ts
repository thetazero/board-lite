// Auto clear (#374): one command clears your own buildings one at a time,
// weakest first, each wave sending all your raid-ready dragons, as "clear"
// would by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuleError, apply, autoClearTargets, canRaid, dragonPower, newGame, waitingOn, type Dragon, type Game } from '../src/engine.ts';
import { FAUNA, combatPower } from '../src/data.ts';
import { publicState, seatState } from '../src/state.ts';
import { seatView } from '../src/view.ts';
import { neighbors } from '../src/map.ts';

function addDragon(g: Game, owner: number, stage: number, key = 'fire_whelp'): Dragon {
  const d: Dragon = { id: `d${g.nextId++}`, owner, key, stage, growth: 0, damage: 0 };
  g.dragons.push(d);
  return d;
}

// Two players, P1's turn in round 1, no fauna and no dragons. P1 owns
// buildings on the land hexes around their tower (`mine`); `empty` is a land
// hex with nothing on it beside one of them.
function setup(seed = 5) {
  const g = newGame(2, seed, 0);
  while (g.phase === 'cards') for (const p of waitingOn(g)) apply(g, p, `keep ${g.players[p].choice[0].id}`);
  for (const k of Object.keys(g.map)) delete g.map[k].fauna;
  g.dragons = [];
  const land = neighbors(g.towers[0]).filter((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k]);
  const mine = land.slice(0, 4);
  for (const k of mine) g.buildings[k] = { type: 'pasture', owner: 0, upgrades: [], floors: 0 };
  const empty = mine.flatMap((k) => neighbors(k)).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k] && !mine.includes(k))!;
  return { g, mine, empty };
}

test('auto clear targets your own held buildings, weakest first, and skips great beasts and fauna beside them', () => {
  const { g, mine: [a, b, c, d], empty } = setup();
  g.map[a].fauna = 'basilisk';
  g.map[b].fauna = 'wolf';
  g.map[c].fauna = 'thunderbird';
  g.map[empty].fauna = 'wolf';
  const rival = addDragon(g, 1, 1);
  rival.perch = d;
  const power = { [a]: combatPower(FAUNA.basilisk), [b]: combatPower(FAUNA.wolf), [d]: dragonPower(rival) };
  assert.deepEqual(autoClearTargets(g, 0), [a, b, d].sort((x, y) => power[x] - power[y] || (x < y ? -1 : 1)));
  // A rival's dragon perched there is fought too: the hex is held by both.
  rival.perch = a;
  assert.deepEqual(autoClearTargets(g, 0), [b, a]);
  // P2 owns none of these: nothing for them to auto clear.
  assert.deepEqual(autoClearTargets(g, 1), []);
});

test('auto clear fights each target in turn with every raid-ready dragon, as clear does', () => {
  const { g, mine: [a, b] } = setup();
  g.map[a].fauna = 'cave_bear';
  g.map[b].fauna = 'wolf';
  const ds = [0, 1, 2, 3, 4].map(() => addDragon(g, 0, 3));
  const egg = addDragon(g, 0, 0);
  const before = g.log.length;
  apply(g, 0, 'autoclear');
  const hunts = g.log.slice(before).flatMap((e) => (e.ev?.k === 'hunt' ? [e.ev] : []));
  const ends = g.log.slice(before).flatMap((e) => (e.ev?.k === 'cleared' ? [e.ev] : []));
  assert.equal(hunts[0].hex, b); // the wolves first, the weaker
  assert.deepEqual(hunts[0].ds, ds.map((d) => d.id)); // all of them, not the egg
  assert.ok(!hunts[0].ds.includes(egg.id));
  // Each wave sends whoever is still raid-ready, and it goes on only after a win.
  ends.forEach((e, i) => { if (i < ends.length - 1) assert.ok(e.won); });
  if (ends.every((e) => e.won)) {
    assert.equal(hunts.length, 2);
    assert.equal(hunts[1].hex, a);
    for (const id of hunts[1].ds) assert.ok(hunts[0].ds.includes(id));
    assert.equal(g.map[a].fauna, undefined);
    assert.equal(g.map[b].fauna, undefined);
  }
  assert.equal(g.turn, 0); // still P1's turn
});

test('auto clear stops at a lost fight, when nothing is left, or when no dragon is raid-ready', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { g, mine } = setup(seed);
    for (const k of mine) g.map[k].fauna = 'basilisk';
    addDragon(g, 0, 2);
    addDragon(g, 0, 3);
    const before = g.log.length;
    apply(g, 0, 'autoclear');
    const ends = g.log.slice(before).flatMap((e) => (e.ev?.k === 'cleared' ? [e.ev] : []));
    assert.ok(ends.length >= 1);
    ends.slice(0, -1).forEach((e) => assert.ok(e.won));
    const left = autoClearTargets(g, 0).length, ready = g.dragons.filter((d) => d.owner === 0 && canRaid(d)).length;
    assert.ok(!ends.at(-1)!.won || !left || !ready, `seed ${seed}: stopped early`);
  }
});

test("auto clear is refused with nothing to clear, no raid-ready dragon, or off your turn, and changes nothing", () => {
  const { g, mine: [a] } = setup();
  addDragon(g, 0, 3);
  assert.throws(() => apply(g, 0, 'autoclear'), /nothing to auto clear/);
  g.map[a].fauna = 'wolf';
  g.dragons[0].damage = 999;
  assert.throws(() => apply(g, 0, 'autoclear'), /no raid-ready dragon/);
  g.dragons[0].damage = 0;
  assert.throws(() => apply(g, 1, 'autoclear'), RuleError);
  assert.equal(g.map[a].fauna, 'wolf');
});

test('the phone and the CLI offer auto clear only with something to clear and a dragon to send', () => {
  const { g, mine: [a] } = setup();
  const seats = g.players.map((_, q) => ({ name: `P${q + 1}`, kind: 'player' as const, connected: true, standIn: false, left: false }));
  const view = () => seatView({ lobby: { code: 'T', started: true, seating: false, saved: null, seats, minPlayers: 2, maxPlayers: 6, file: '', remote: true }, seat: 0, game: publicState(g, 100), scene: 0, you: { ...seatState(g, 0), name: 'P1' } }, 10);
  g.map[a].fauna = 'wolf';
  assert.deepEqual(seatState(g, 0).autoClear, [a]);
  assert.doesNotMatch(view(), /^\s*autoclear /m); // no dragon
  addDragon(g, 0, 3);
  assert.match(view(), /^\s*autoclear /m);
});
