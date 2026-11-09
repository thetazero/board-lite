// Dragons perching on a rival's building to stop it producing (#217).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standInMove } from '../src/bot.ts';
import { RuleError, apply, bankRates, buildableHexes, canRaid, dragonCapacity, faunaHexes, newGame, production, score, waitingOn, type Dragon, type Game } from '../src/engine.ts';
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
  const g = newGame(players, 5, 0);
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

test('a shut-down building is as if it were not there: it scores nothing, and counts for nothing adjacent (#352)', () => {
  const { g, pasture } = perchGame();
  // A Market of P1's beside the Pasture counts it as an adjacent production building.
  const market = neighbors(pasture).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
  g.buildings[market] = { type: 'market', owner: 0, upgrades: [], floors: 0 };
  const gold = () => production(g, 0).gold.base;
  const points = score(g, 0).buildings;
  const goldBefore = gold();
  assert.ok(goldBefore >= 1);
  apply(g, 0, 'end');
  const d = addDragon(g, 1, 2);
  apply(g, 1, `perch ${pasture} ${d.id}`);
  assert.equal(score(g, 0).buildings, points - 1); // the Pasture's 1 point is gone
  assert.equal(gold(), goldBefore - 1); // and the Market no longer counts it
  assert.equal(seatState(g, 0).totalPoints, score(g, 0).total);
  apply(g, 1, `recall ${d.id}`);
  assert.equal(score(g, 0).buildings, points);
  assert.equal(gold(), goldBefore);
  // A beast on it does the same, until it's cleared.
  g.map[pasture].fauna = 'wolf_pack';
  assert.equal(score(g, 0).buildings, points - 1);
  assert.equal(gold(), goldBefore - 1);
  delete g.map[pasture].fauna;
  assert.equal(score(g, 0).buildings, points);
});

test('a suppressed roost houses no dragons, and too many dragons only stops hatching (#352)', () => {
  const { g, pasture } = perchGame();
  const roost = neighbors(g.towers[0]).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
  g.buildings[roost] = { type: 'roost', owner: 0, upgrades: [], floors: 0 };
  const room = dragonCapacity(g, 0);
  for (let i = 0; i < room; i++) addDragon(g, 0, 1);
  // Nothing is built beside the Pasture through it while it's suppressed.
  const beside = buildableHexes(g, 0, 'roost').filter((k) => neighbors(k).includes(pasture) && !neighbors(k).some((n) => n !== pasture && g.buildings[n]?.owner === 0));
  apply(g, 0, 'end');
  const d = addDragon(g, 1, 2);
  apply(g, 1, `perch ${roost} ${d.id}`);
  apply(g, 1, `perch ${pasture} ${addDragon(g, 1, 2).id}`);
  assert.equal(dragonCapacity(g, 0), room - 2);
  for (const k of beside) assert.ok(!buildableHexes(g, 0, 'roost').includes(k));
  // P1 keeps every dragon; the phone and the CLI say they're over their room.
  assert.equal(g.dragons.filter((x) => x.owner === 0).length, room);
  const me = seatState(g, 0);
  assert.ok(me.dragonsHoused > me.dragonCapacity);
  const seats = g.players.map((_, q) => ({ name: `P${q + 1}`, kind: 'player' as const, connected: true, standIn: false, left: false }));
  const view = seatView({ lobby: { code: 'T', started: true, seating: false, saved: null, seats, minPlayers: 2, maxPlayers: 6, file: '', remote: true }, seat: 0, game: publicState(g, 100), scene: 0, you: { ...me, name: 'P1' } }, 10);
  assert.match(view, /2 over, no hatching until there.s room/);
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
  const view = (p: number) => seatView({ lobby: { code: 'T', started: true, seating: false, saved: null, seats, minPlayers: 2, maxPlayers: 6, file: '', remote: true }, seat: p, game: publicState(g, 100), scene: 0, you: { ...seatState(g, p, 100), name: `P${p + 1}` } }, 10);
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
  assert.match(view(0), new RegExp(`Hexes: .*${pasture} ${d.id}`));
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

test('a coin flip, once a fight, decides which side strikes first each combat round (#380)', () => {
  const seen = new Set<string>();
  for (let seed = 1; seen.size < 2 && seed < 40; seed++) {
    const { g, pasture } = perchGame();
    const [a, b] = [addDragon(g, 1, 3), addDragon(g, 1, 3)];
    apply(g, 0, 'end');
    apply(g, 1, `perch ${pasture} ${a.id} ${b.id}`);
    apply(g, 1, 'end');
    toTurnOf(g, 0);
    g.rng.state = seed;
    const ds = [addDragon(g, 0, 3), addDragon(g, 0, 3)];
    apply(g, 0, `clear ${pasture} ${ds.map((d) => d.id).join(' ')}`);
    const at = g.log.findLastIndex((e) => e.ev?.k === 'hunt');
    const hunt = g.log[at].ev as Extract<Game['log'][number]['ev'], { k: 'hunt' }>;
    assert.ok(hunt.first === 'dragons' || hunt.first === 'defenders');
    assert.match(g.log[at].text, hunt.first === 'dragons' ? /Coin flip: the dragons strike first\./ : /Coin flip: the defenders strike first\./);
    seen.add(hunt.first!);
    // Every round, the winner's hits all come before the other side's.
    const rounds = g.log.slice(at).flatMap((e) => (e.ev?.k === 'combat' ? [e.ev] : []));
    assert.ok(rounds.length > 0);
    for (const r of rounds) {
      const sides = r.hits.map((h) => (h.by === 'dragon' ? 'dragons' : 'defenders'));
      const firstOther = sides.findIndex((s) => s !== hunt.first);
      if (firstOther >= 0) assert.ok(sides.slice(firstOther).every((s) => s !== hunt.first), `round ${r.round}: ${sides.join(' ')}`);
    }
  }
  assert.deepEqual([...seen].sort(), ['defenders', 'dragons']);
});

// The Leviathan surfacing by a port holds it: suppressed, it trades at 4:1,
// as under fauna or a perched dragon, until the Leviathan moves off (#370).
test('a building the Leviathan holds from an adjacent hex is suppressed, and works again once it moves off', () => {
  const { g } = perchGame();
  const tower = g.towers[0];
  const harbor = neighbors(tower).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
  g.map[harbor].terrain = 'harbor';
  g.players[0].hand.push({ id: 'cport', deck: 'building', key: 'stone_port' });
  apply(g, 0, `build cport ${harbor}`);
  assert.equal(bankRates(g, 0).stone, 2);
  const before = score(g, 0).buildings;
  // Somewhere beside the port but not beside the tower, as the ocean there would be.
  const sea = neighbors(harbor).find((k) => g.map[k] && !neighbors(k).includes(tower) && k !== tower && !g.buildings[k])!;
  for (const k of Object.keys(g.map)) if (g.map[k].fauna === 'leviathan') delete g.map[k].fauna;
  g.map[sea].terrain = 'ocean';
  g.map[sea].fauna = 'leviathan';
  assert.equal(bankRates(g, 0).stone, TUNING.bankRate);
  assert.ok(score(g, 0).buildings < before, 'the port scores nothing');
  const hex = publicState(g).map.find((h) => h.k === harbor)!;
  assert.equal(hex.suppressed, true);
  assert.equal(hex.held, 'leviathan');
  assert.equal(publicState(g).map.find((h) => h.k === tower)!.suppressed, undefined, 'nothing stops a tower');
  delete g.map[sea].fauna;
  assert.equal(bankRates(g, 0).stone, 2);
  assert.equal(score(g, 0).buildings, before);
  assert.equal(publicState(g).map.find((h) => h.k === harbor)!.suppressed, undefined);
});

// The phone's count is the TV's plus the Secret Hoards in hand, whatever
// suppresses a building and whatever lifts it again (#443).
test("a phone's points are always the TV's public points plus its hidden ones, through perching, recalls, clears and beasts", () => {
  const { g, pasture } = perchGame(3);
  rich(g, 2);
  g.players[0].hand.push({ id: 'hoard-443', deck: 'action', key: 'secret_hoard' });
  // pub: P1's points from buildings, as the TV's points track shows them.
  const check = (why: string, pub: number) => {
    for (let p = 0; p < 3; p++) {
      const tv = publicState(g).players[p].publicPoints;
      const phone = seatState(g, p);
      assert.equal(phone.totalPoints, tv + phone.hiddenPoints, `${why}: P${p + 1}'s phone`);
    }
    assert.equal(publicState(g).players[0].buildings, pub, `${why}: P1's points from buildings`);
  };
  const full = score(g, 0).buildings;
  check('before', full);
  assert.equal(seatState(g, 0).hiddenPoints, 2);
  const a = addDragon(g, 1, 1);
  const b = addDragon(g, 2, 1);
  apply(g, 0, 'end');
  apply(g, 1, `perch ${pasture} ${a.id}`);
  check('perched', full - 1);
  apply(g, 1, `recall ${a.id}`);
  check('recalled', full);
  apply(g, 1, `perch ${pasture} ${a.id}`);
  apply(g, 1, 'end');
  apply(g, 2, `perch ${pasture} ${b.id}`);
  check('two perched', full - 1);
  apply(g, 2, 'end');
  toTurnOf(g, 0);
  check('next round', full - 1);
  const hunters = [addDragon(g, 0, 3), addDragon(g, 0, 3), addDragon(g, 0, 3), addDragon(g, 0, 3)];
  apply(g, 0, `clear ${pasture} ${hunters.map((d) => d.id).join(' ')}`);
  check('cleared', full);
  g.map[pasture].fauna = 'wolf_pack';
  check('a beast on it', full - 1);
});
