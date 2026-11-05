// Dragons perching on a rival's building to stop it producing (#217).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standInMove } from '../src/bot.ts';
import { RuleError, apply, canRaid, faunaHexes, newGame, production, waitingOn, type Dragon, type Game } from '../src/engine.ts';
import { BEASTS, DRAGONS, ELEMENTS, ELEMENT_BEATS, ELEMENT_WEAK, FAUNA, TUNING, UNITS, UNIT_ELEMENTS, elementalDamage } from '../src/data.ts';
import { publicState, seatState } from '../src/state.ts';
import { seatView } from '../src/view.ts';
import { neighbors } from '../src/map.ts';

const rich = (g: Game, p: number) => (g.players[p].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 50 });

function addDragon(g: Game, owner: number, stage: number, key = 'fire_whelp'): Dragon {
  const d: Dragon = { id: `d${g.nextId++}`, owner, key, stage, growth: 0, damage: 0 };
  g.dragons.push(d);
  return d;
}

// Two players, round 1, P1's turn: no fauna, both rich, and P1 has a Pasture
// on a meadow beside their tower. The starting eggs are gone: each test adds
// the dragons it needs.
function perchGame(players = 2) {
  const g = newGame(players, 5);
  while (g.phase === 'cards') for (const p of waitingOn(g)) apply(g, p, `keep ${g.players[p].choice[0].id}`);
  for (const k of Object.keys(g.map)) delete g.map[k].fauna;
  g.dragons = [];
  rich(g, 0);
  rich(g, 1);
  const pasture = neighbors(g.towers[0]).find((k) => g.map[k] && g.map[k].terrain !== 'ocean')!;
  g.map[pasture].terrain = 'meadow';
  apply(g, 0, `build pasture ${pasture}`);
  return { g, pasture };
}

// Plays out the rest of the round and the next round's production, sending
// no one anywhere, until it's p's turn in the action phase.
function toTurnOf(g: Game, p: number) {
  const round = g.round;
  while (!(g.phase === 'action' && g.turn === p && g.round > round)) standInMove(g, waitingOn(g)[0]);
}

test('every player starts with a Fire Dragon egg', () => {
  for (const players of [2, 4, 6]) for (const seed of [1, 2, 3]) {
    const g = newGame(players, seed);
    assert.equal(g.dragons.length, players);
    for (const d of g.dragons) {
      assert.equal(d.key, 'fire_whelp');
      assert.equal(DRAGONS[d.key].element, 'fire');
      assert.equal(d.stage, 0);
    }
  }
});

test("a dragon perches only on a rival's building, never a tower, and only if raid-ready (hatched, not knocked out)", () => {
  const { g, pasture } = perchGame();
  const d = addDragon(g, 1, 1);
  const egg = addDragon(g, 1, 0);
  apply(g, 0, 'end');
  assert.throws(() => apply(g, 1, `perch ${g.towers[0]} ${d.id}`), RuleError); // a tower
  assert.throws(() => apply(g, 1, `perch ${g.towers[1]} ${d.id}`), RuleError); // their own tower
  assert.throws(() => apply(g, 1, `perch ${pasture}`), RuleError); // no dragon
  assert.throws(() => apply(g, 1, `perch ${pasture} ${egg.id}`), RuleError); // an egg
  g.dragons.find((x) => x.id === d.id)!.damage = DRAGONS[d.key].stages[0].hp;
  assert.throws(() => apply(g, 1, `perch ${pasture} ${d.id}`), RuleError); // knocked out
  g.dragons.find((x) => x.id === d.id)!.damage = 1; // hurt is fine
  apply(g, 1, `perch ${pasture} ${d.id}`);
  assert.equal(g.dragons.find((x) => x.id === d.id)!.perch, pasture);
  // P1 can't perch on their own building.
  const mine = addDragon(g, 0, 1);
  apply(g, 1, 'end');
  toTurnOf(g, 0);
  assert.throws(() => apply(g, g.turn, `perch ${pasture} ${mine.id}`), RuleError);
});

test('a perched building makes nothing, the dragon stays until recalled, and it sits out raids and clearing', () => {
  const { g, pasture } = perchGame();
  const before = production(g, 0).livestock.dice.length;
  assert.equal(before, 1);
  apply(g, 0, 'end');
  const d = addDragon(g, 1, 2);
  apply(g, 1, `perch ${pasture} ${d.id}`);
  const perched = () => g.dragons.find((x) => x.id === d.id)!;
  assert.equal(production(g, 0).livestock.dice.length, 0);
  assert.equal(production(g, 0).livestock.base, TUNING.towerProduction.livestock); // the tower still makes its own
  assert.equal(canRaid(perched()), false);
  // Rounds go by: it stays, and P1's Pasture rolls no die at production.
  toTurnOf(g, 1);
  assert.equal(perched().perch, pasture);
  const produced = g.log.filter((e) => e.round === g.round && e.ev?.k === 'produce' && e.ev.p === 0);
  assert.equal(produced[0].dice?.length ?? 0, 0);
  // It can't be sent anywhere while it perches.
  assert.throws(() => apply(g, 1, `perch ${pasture} ${d.id}`), RuleError);
  // Recalled, it's home, and the Pasture makes livestock again.
  assert.throws(() => apply(g, 0, `recall ${d.id}`), RuleError); // not P1's to recall
  apply(g, 1, `recall ${d.id}`);
  assert.equal(perched().perch, undefined);
  assert.equal(production(g, 0).livestock.dice.length, 1);
  assert.equal(canRaid(perched()), true);
  assert.throws(() => apply(g, 1, `recall ${d.id}`), RuleError); // not perched
});

test('nothing blocks a tower: no dragon perches there and no beast is placed there', () => {
  const { g } = perchGame();
  for (const k of g.towers) assert.ok(!faunaHexes(g).includes(k));
  assert.ok(!seatState(g, 1).perchable.includes(g.towers[0]));
  assert.ok(!seatState(g, 1).perchable.includes(g.towers[1]));
});

test("several players' dragons perch on one building, and they fight together", () => {
  const { g, pasture } = perchGame(3);
  rich(g, 2);
  const a = addDragon(g, 1, 1);
  const b = addDragon(g, 2, 1);
  apply(g, 0, 'end');
  apply(g, 1, `perch ${pasture} ${a.id}`);
  apply(g, 1, 'end');
  apply(g, 2, `perch ${pasture} ${b.id}`);
  assert.deepEqual(publicState(g).map.find((h) => h.k === pasture)!.perched.map((x) => x.owner), [1, 2]);
  // P1 attacks with four adults: whatever the dice, both hatchlings fall in the first round.
  const hunters = [addDragon(g, 0, 3), addDragon(g, 0, 3), addDragon(g, 0, 3), addDragon(g, 0, 3)];
  apply(g, 2, 'end');
  toTurnOf(g, 0);
  apply(g, 0, `clear ${pasture} ${hunters.map((d) => d.id).join(' ')}`);
  const hunt = g.log.findLast((e) => e.ev?.k === 'hunt')!.ev as Extract<Game['log'][number]['ev'], { k: 'hunt' }>;
  assert.deepEqual(hunt.units.map((u) => u.d), [a.id, b.id]);
  assert.equal(hunt.fauna, null);
  const end = g.log.findLast((e) => e.ev?.k === 'cleared')!.ev as Extract<Game['log'][number]['ev'], { k: 'cleared' }>;
  assert.equal(end.won, true);
  assert.deepEqual(end.home, [a.id, b.id]);
  for (const id of [a.id, b.id]) {
    const d = g.dragons.find((x) => x.id === id)!;
    assert.equal(d.perch, undefined);
    assert.equal(d.damage, DRAGONS[d.key].stages[0].hp); // knocked out, healing at home
  }
  assert.equal(production(g, 0).livestock.dice.length, 1);
  // The hunters fought, but any with health left can still raid this round.
  for (const d of hunters) { const x = g.dragons.find((y) => y.id === d.id)!; assert.equal(canRaid(x), x.damage < DRAGONS[x.key].stages[x.stage - 1].hp); }
});

test('anyone may clear perched dragons; a lost fight leaves them perched, keeping their hits', () => {
  const { g, pasture } = perchGame();
  const [a, b] = [addDragon(g, 1, 3), addDragon(g, 1, 3)];
  apply(g, 0, 'end');
  apply(g, 1, `perch ${pasture} ${a.id} ${b.id}`);
  assert.throws(() => apply(g, 1, `clear ${pasture} ${a.id}`), RuleError); // your own perched dragons aren't foes (and a perched one can't fight)
  const own = addDragon(g, 1, 3);
  assert.throws(() => apply(g, 1, `clear ${pasture} ${own.id}`), RuleError);
  apply(g, 1, 'end');
  toTurnOf(g, 0);
  // A hatchling against two adults: it's knocked out in the first round, and
  // deals at most 6 damage.
  const h = addDragon(g, 0, 1);
  apply(g, 0, `clear ${pasture} ${h.id}`);
  const end = g.log.findLast((e) => e.ev?.k === 'cleared')!.ev as Extract<Game['log'][number]['ev'], { k: 'cleared' }>;
  assert.equal(end.won, false);
  const hurt = [a, b].map((x) => g.dragons.find((d) => d.id === x.id)!);
  for (const d of hurt) assert.equal(d.perch, pasture);
  const taken = hurt.reduce((s, d) => s + d.damage, 0);
  assert.ok(taken > 0 && taken <= 6, `perched dragons keep their hits (took ${taken})`);
  assert.equal(production(g, 0).livestock.dice.length, 0);
});

test('a perched dragon heals at production like any other, and keeps blocking while hurt', () => {
  const { g, pasture } = perchGame();
  const d = addDragon(g, 1, 3);
  apply(g, 0, 'end');
  apply(g, 1, `perch ${pasture} ${d.id}`);
  const hp = DRAGONS.fire_whelp.stages[2].hp;
  g.dragons.find((x) => x.id === d.id)!.damage = hp - 1; // 1 health left
  toTurnOf(g, 1);
  const now = g.dragons.find((x) => x.id === d.id)!;
  assert.equal(now.damage, hp - 1 - TUNING.healPerRound); // healed only its round's share
  assert.equal(now.perch, pasture);
  assert.equal(production(g, 0).livestock.dice.length, 0);
  // Its owner's phone can recall it; the TV and the CLI show where it sits.
  assert.deepEqual(seatState(g, 1).perched, [d.id]);
  assert.equal(publicState(g).dragons.find((x) => x.id === d.id)!.perch, pasture);
});

test('a beast and perched dragons on one building fight together', () => {
  const { g, pasture } = perchGame();
  const a = addDragon(g, 1, 1);
  apply(g, 0, 'end');
  apply(g, 1, `perch ${pasture} ${a.id}`);
  apply(g, 1, 'end');
  toTurnOf(g, 0);
  // Placed after production, so it can't wander off first.
  g.map[pasture].fauna = 'wolf_pack';
  assert.equal(g.dragons.find((x) => x.id === a.id)!.perch, pasture);
  const hunters = [addDragon(g, 0, 3, 'ember_wyrm'), addDragon(g, 0, 3), addDragon(g, 0, 3), addDragon(g, 0, 3)];
  apply(g, 0, `clear ${pasture} ${hunters.map((d) => d.id).join(' ')}`);
  const hunt = g.log.findLast((e) => e.ev?.k === 'hunt')!.ev as Extract<Game['log'][number]['ev'], { k: 'hunt' }>;
  assert.equal(hunt.fauna, 'wolf_pack');
  assert.equal(hunt.units.length, 2);
  assert.equal(hunt.units[1].d, a.id);
});

test("the CLI offers perch, recall and clearing a rival's perched dragons", () => {
  const { g, pasture } = perchGame();
  const seats = g.players.map((_, q) => ({ name: `P${q + 1}`, kind: 'player' as const, connected: true, standIn: false, left: false }));
  const view = (p: number) => seatView({ lobby: { code: 'T', started: true, seating: false, seats, minPlayers: 2, maxPlayers: 6, file: '', remote: true }, seat: p, game: publicState(g, 100), scene: 0, you: { ...seatState(g, p, 100), name: `P${p + 1}` } }, 10);
  const d = addDragon(g, 1, 2);
  apply(g, 0, 'end');
  assert.match(view(1), new RegExp(`perch <hex> <dragon ids\\.\\.\\.>.*${pasture}`));
  apply(g, 1, `perch ${pasture} ${d.id}`);
  assert.match(view(1), new RegExp(`recall <dragon ids\\.\\.\\.>.*${d.id}`));
  assert.match(view(1), new RegExp(`${pasture}:[^ ]*<${d.id}>`));
  const h = addDragon(g, 0, 2);
  apply(g, 1, 'end');
  toTurnOf(g, 0);
  assert.ok(seatState(g, 0).huntable.includes(pasture));
  assert.match(view(0), new RegExp(`you can fight: .*${pasture} ${d.id}`));
  assert.ok(h);
});

test('one element wheel for everything that fights: double damage only; neutral is neutral against everything', () => {
  for (const x of [...Object.values(UNITS), ...Object.values(FAUNA), ...Object.values(BEASTS)]) assert.ok(UNIT_ELEMENTS.includes(x.element), x.name);
  for (const d of Object.values(DRAGONS)) assert.ok(UNIT_ELEMENTS.includes(d.element), d.name);
  // water → fire → ice → air → lightning → water: each element beats exactly one other, and is beaten by exactly one.
  assert.deepEqual(ELEMENT_BEATS, { water: 'fire', fire: 'ice', ice: 'air', air: 'lightning', lightning: 'water' });
  for (const e of ELEMENTS) assert.equal(ELEMENT_WEAK[e].length, 1, e);
  assert.deepEqual(ELEMENT_WEAK.neutral, []);
  for (const e of UNIT_ELEMENTS) {
    assert.equal(elementalDamage(5, 'neutral', e), 5);
    assert.equal(elementalDamage(5, e, 'neutral'), 5);
  }
  // Double when the attacker's element beats the target's; otherwise unchanged, never halved.
  for (const by of ELEMENTS) for (const to of ELEMENTS) assert.equal(elementalDamage(5, by, to), ELEMENT_BEATS[by] === to ? 10 : 5, `${by} on ${to}`);
});

test('foe elements', () => {
  const el = (x: { element: string }) => x.element;
  assert.deepEqual([UNITS.militia, UNITS.archers, UNITS.knights, FAUNA.wolf_pack, FAUNA.cave_bear, FAUNA.basilisk].map(el), Array(6).fill('neutral'));
  assert.equal(UNITS.frost_golem.element, 'ice');
  assert.equal(UNITS.storm_griffin.element, 'air');
  assert.equal(BEASTS.thunderbird.element, 'air');
  assert.equal(UNITS.sea_serpent.element, 'water');
  assert.equal(BEASTS.leviathan.element, 'water');
});

// Every hit in a fight between perched fire dragons and the dragons sent at them.
function fightHits(attacker: string, hunters: number) {
  const { g, pasture } = perchGame();
  const fire = addDragon(g, 1, 3);
  apply(g, 0, 'end');
  apply(g, 1, `perch ${pasture} ${fire.id}`);
  apply(g, 1, 'end');
  toTurnOf(g, 0);
  const ids = Array.from({ length: hunters }, () => addDragon(g, 0, 3, attacker).id);
  apply(g, 0, `clear ${pasture} ${ids.join(' ')}`);
  return g.log.flatMap((e) => (e.ev?.k === 'combat' ? e.ev.hits : []));
}

test('the chart works both ways when dragons fight dragons: water doubles on fire, fire doubles on ice', () => {
  // Water against a perched fire dragon: every hit the water dragons land is doubled.
  const water = fightHits('water_whelp', 1).filter((h) => h.by === 'dragon');
  assert.ok(water.length && water.every((h) => h.dmg % 2 === 0), `water on fire: ${water.map((h) => h.dmg)}`);
  // A perched fire dragon defending against ice: every hit it lands is doubled.
  const fire = fightHits('ice_whelp', 1).filter((h) => h.by === 'unit');
  assert.ok(fire.length && fire.every((h) => h.dmg % 2 === 0), `fire on ice: ${fire.map((h) => h.dmg)}`);
});
