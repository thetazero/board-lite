import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botStep, playOut } from '../src/bot.ts';
import { RuleError, apply, backInRound, splitLoot, bankRate, canRaid, dragonPower, buildingClass, lootOf, buildingPoints, newGame, production, score, standings, turnOrder, waitingOn, type Game } from '../src/engine.ts';
import { ACTIONS, BEASTS, BUILDINGS, DRAGONS, FAUNA, FAUNA_BY_DISTANCE, RESOURCES, TARGETS, TUNING, UNITS, combatPower, targetPower } from '../src/data.ts';
import { publicState, seatState } from '../src/state.ts';
import { seatView } from '../src/view.ts';
import { PEAK, distance, generateMap, mapRadius, neighbors, towerSpots } from '../src/map.ts';

// What seat p's CLI prints: its view, from the same JSON its phone would get.
function playerView(g: Game, p: number, logLines = 25): string {
  const seats = g.players.map((_, q) => ({ name: `P${q + 1}`, kind: 'player' as const, connected: true, standIn: false, left: false }));
  const lobby = { code: 'TEST', started: true, seats, minPlayers: 2, maxPlayers: 6, file: '', remote: true };
  return seatView({ lobby, seat: p, game: publicState(g, 1000), scene: 0, you: { ...seatState(g, p, 1000), name: `P${p + 1}` } }, logLines);
}

// Each round starts with everyone keeping a building card: keep the first.
function keepAll(g: Game) {
  while (g.phase === 'cards') for (const p of waitingOn(g)) apply(g, p, `keep ${g.players[p].choice[0].id}`);
}

function advanceToRaidVote(g: Game) {
  keepAll(g);
  while (g.phase === 'action') apply(g, g.turn, 'end');
}

// Everyone starts with an egg; tests that raid in round 1 hatch them first.
const hatchAll = (g: Game) => g.dragons.forEach((d) => (d.stage = Math.max(d.stage, 1)));

const rich = (g: Game, p: number) => (g.players[p].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 50 });

// The bot games every test below reads: two seeds per player count, played
// once. waitingOn is checked at every step on the way.
let played: { players: number; seed: number; g: Game }[] | undefined;
function botGames() {
  if (played) return played;
  played = [];
  for (let players = 2; players <= 6; players++) {
    for (const seed of [1, 2]) {
      const g = newGame(players, seed);
      const rng = { state: seed * 31 + players };
      for (let steps = 0; g.phase !== 'over' && steps < 20000; steps++) {
        assert.ok(waitingOn(g).length > 0, `${players}p seed ${seed}: no one to wait on`);
        botStep(g, rng);
      }
      played.push({ players, seed, g });
    }
  }
  return played;
}

test('bot games reach a winner for every player count, naming someone to wait on until then', () => {
  for (const { players, seed, g } of botGames()) {
    assert.equal(g.phase, 'over', `${players}p seed ${seed} did not finish`);
    assert.ok(g.winner !== null);
    assert.deepEqual(waitingOn(g), []);
    assert.ok(score(g, g.winner!).total >= TUNING.pointsToWin);
    // The game survives a save/load round trip at the end.
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
});

test('the final standings put the winner first, most points first', () => {
  for (const { players, seed, g } of botGames()) {
    const st = standings(g);
    assert.equal(st[0].p, g.winner, `${players}p seed ${seed}: the list names someone else first`);
    assert.equal(st[0].place, 1);
    for (const [i, s] of st.entries()) {
      assert.equal(s.total, score(g, s.p).total);
      if (i === 0) continue;
      assert.ok(s.total <= st[i - 1].total, 'most points first');
      assert.ok(s.place > 1, 'first place is never shared');
    }
  }
});

test('ties in the standings: the win goes to the most gold, then turn order; other ties share a place', () => {
  // Staged: bot games almost never tie for the win.
  // Each player holds the given number of Secret Hoards, whatever one is worth.
  const staged = (hoards: number[], gold: number[]) => {
    const g = newGame(hoards.length, 5);
    g.players.forEach((pl, p) => {
      pl.resources.gold = gold[p];
      pl.hand = [];
      const before = score(g, p).total;
      for (let i = 0; i < hoards[p]; i++) pl.hand.push({ id: `h${p}-${i}`, deck: 'action', key: 'secret_hoard' });
      assert.equal(score(g, p).total, before + hoards[p] * ACTIONS.secret_hoard.amount!);
    });
    return { g, st: standings(g) };
  };
  // P2 and P3 level on top; P3 has more gold. P1 and P4 level behind.
  let { g, st } = staged([2, 3, 3, 2], [0, 1, 2, 0]);
  assert.deepEqual(st.slice(0, 2).map((s) => [s.p, s.place, s.tied]), [[2, 1, true], [1, 2, true]]);
  assert.equal(st[0].tiebreak, 'gold');
  assert.equal(st[2].place, 3);
  assert.equal(st[3].place, 3, 'level behind the winner shares a place');
  assert.ok(st[2].tied && st[3].tied && st[2].tiebreak === null);
  // Level on points and gold: the earlier in turn order wins.
  ({ g, st } = staged([3, 3, 1], [1, 1, 1]));
  const order = turnOrder(g).filter((p) => p < 2);
  assert.deepEqual(st.map((s) => [s.p, s.place]), [[order[0], 1], [order[1], 2], [2, 3]]);
  assert.equal(st[0].tiebreak, 'turn order');
  assert.ok(!st[2].tied);
  // No tie: no tiebreak.
  ({ st } = staged([4, 2], [0, 9]));
  assert.deepEqual(st.map((s) => [s.p, s.tiebreak]), [[0, null], [1, null]]);
});

test('the log reads as English: no "1 cards", "card(s)" or one winner who "each take"', () => {
  const bad = /\b1 (cards|raids|steps)\b|\(s\)|falls\. \S+ each take|\ba (adult|egg)\b/;
  for (const { players, seed, g } of botGames()) for (const e of g.log) assert.doesNotMatch(e.text, bad, `${players}p seed ${seed}`);
});

test('the same seed gives the same game', () => {
  const [{ players, seed, g }] = botGames();
  const again = newGame(players, seed);
  playOut(again, { state: seed * 31 + players });
  assert.deepEqual(again, g);
});

test('a view shows only your own hand and resources', () => {
  const g = newGame(3, 5);
  for (let p = 0; p < 3; p++) {
    const view = playerView(g, p, 1000);
    for (let q = 0; q < 3; q++) {
      for (const c of g.players[q].hand) assert.equal(view.includes(c.id), q === p, `P${p + 1} view vs ${c.id} of P${q + 1}`);
    }
    // No one else's resource tokens are listed.
    assert.equal((view.match(/Resources:/g) ?? []).length, 1);
  }
});

test('votes are public as cast; fight-or-bail choices stay secret until revealed', () => {
  const g = newGame(2, 3);
  hatchAll(g);
  advanceToRaidVote(g);
  apply(g, 0, 'vote 2');
  const name = TARGETS[g.raid!.candidates[1]].name;
  assert.ok(playerView(g, 1, 1000).includes(`P1 votes for ${name}`));
  assert.deepEqual(publicState(g).raid!.votes, [1, null]);
  apply(g, 1, 'vote 2');
  apply(g, 0, `commit ${g.dragons[0].id}`);
  apply(g, 0, 'ready');
  apply(g, 1, `commit ${g.dragons[1].id}`);
  apply(g, 1, 'ready');
  assert.equal(g.raid!.step, 'bail');
  apply(g, 0, 'bail');
  assert.ok(!playerView(g, 1, 1000).includes('bail!'));
  assert.ok(!playerView(g, 1, 1000).includes('You choose'));
  apply(g, 1, 'fight');
  assert.ok(playerView(g, 1, 1000).includes('P1 bails.'));
  // There is no retreat: the fight plays out to the end with no more choices.
  assert.equal(g.raid, null);
  assert.match(playerView(g, 1, 1000), /falls\.|holds\./);
});

test('everyone starts with an egg, and a raid nobody can fight is skipped', () => {
  const g = newGame(3, 5);
  assert.ok(g.dragons.every((d) => d.stage === TUNING.startingDragonStage));
  advanceToRaidVote(g);
  if (TUNING.startingDragonStage === 0) {
    assert.equal(g.raid, null);
    assert.equal(g.round, 2);
    assert.equal(g.phase, 'cards');
  }
});

test('illegal moves are refused without changing the game', () => {
  const g = newGame(3, 9);
  keepAll(g);
  const before = JSON.stringify(g);
  assert.throws(() => apply(g, 1, 'end'), RuleError); // not P2's turn
  assert.throws(() => apply(g, 0, 'build c999 0,0'), RuleError);
  assert.throws(() => apply(g, 0, 'bank stone gold 2'), RuleError); // can't afford 8 stone
  assert.throws(() => apply(g, 0, 'dance'), RuleError);
  assert.equal(JSON.stringify(g), before);
});

test('an offer must trade something real', () => {
  const g = newGame(2, 11);
  keepAll(g);
  assert.throws(() => apply(g, 0, 'offer P2 give 0 stone get 0 gold'), /nothing for nothing/);
  assert.throws(() => apply(g, 0, 'offer P2 give get'), /nothing for nothing/);
  const card = g.players[0].hand[0];
  assert.throws(() => apply(g, 0, `offer P2 give ${card.id} ${card.id} get 1 stone`), /Name each card once/);
  // Gold is public: asking for more than they have is refused at once.
  const gold = g.players[1].resources.gold;
  assert.throws(() => apply(g, 0, `offer P2 give 1 stone get ${gold + 1} gold`), new RegExp(`P2 has ${gold} gold\\.`));
  assert.equal(g.offers.length, 0);
  // A gift, something for nothing, is still a trade.
  apply(g, 0, 'offer P2 give 1 stone get');
  assert.equal(seatState(g, 1).cantAccept[g.offers[0].id], undefined);
  // An offer whose maker has since spent what it gives can't be accepted.
  g.players[0].resources.stone = 0;
  assert.deepEqual(seatState(g, 1).cantAccept, { [g.offers[0].id]: 'P1 no longer has what they offered.' });
});

test('trades are binding and move resources and cards', () => {
  const g = newGame(2, 11);
  keepAll(g);
  const card = g.players[1].hand[0];
  apply(g, 1, `offer P1 give ${card.id} get 1 stone`);
  const offer = g.offers[0];
  apply(g, 0, `accept ${offer.id}`);
  assert.ok(g.players[0].hand.some((c) => c.id === card.id));
  assert.ok(!g.players[1].hand.some((c) => c.id === card.id));
  assert.equal(g.players[1].resources.stone, TUNING.startingResources.stone! + 1 + 1);
  assert.equal(g.offers.length, 0);
  // Accepting an offer you can't pay for fails and leaves the offer open; the
  // phone greys Accept and the view says why.
  apply(g, 1, 'offer P1 give 1 stone get 40 timber');
  assert.throws(() => apply(g, 0, `accept ${g.offers[0].id}`), /You don't have 40 timber\./);
  assert.equal(g.offers.length, 1);
  assert.deepEqual(seatState(g, 0).cantAccept, { [g.offers[0].id]: "You don't have 40 timber." });
  assert.match(playerView(g, 0), new RegExp(`decline ${g.offers[0].id} .* You don't have 40 timber\\.`));
  assert.ok(!playerView(g, 0).includes(`accept ${g.offers[0].id}`));
  // The acting player answers offers made to them before ending the turn; their own offers expire with it.
  assert.throws(() => apply(g, 0, 'end'), /Answer P2's offer/);
  apply(g, 0, `decline ${g.offers[0].id}`);
  apply(g, 0, 'offer P2 give 1 stone get 1 timber');
  apply(g, 0, 'end');
  assert.equal(g.offers.length, 0);
});

test('buildings must touch your territory and match terrain', () => {
  const g = newGame(2, 2);
  keepAll(g);
  const tower = g.towers[0];
  rich(g, 0);
  assert.throws(() => apply(g, 0, `build quarry ${tower}`), RuleError); // occupied
  const far = Object.keys(g.map).find((k) => g.map[k].terrain === 'mountain' && !neighbors(k).some((n) => g.buildings[n]))!;
  assert.throws(() => apply(g, 0, `build quarry ${far}`), RuleError); // not touching
  const [wrong, right] = neighbors(tower).filter((k) => g.map[k]); // the land around a tower is random, so set it
  g.map[wrong].terrain = 'forest';
  g.map[right].terrain = 'mountain';
  assert.throws(() => apply(g, 0, `build quarry ${wrong}`), RuleError); // wrong terrain
  apply(g, 0, `build quarry ${right}`);
  assert.equal(g.buildings[right].type, 'quarry');
  // A basic building needs no card and costs what it says.
  assert.equal(g.players[0].resources.timber, 50 - BUILDINGS.quarry.cost.timber!);
  assert.throws(() => apply(g, 0, `build hatchery ${wrong}`), RuleError); // not a basic: needs its card
});

test('the ocean rings the land, with one harbor per coast; ports go only on harbors', () => {
  const g = newGame(2, 4);
  keepAll(g);
  const hexes = Object.values(g.map);
  assert.equal(hexes.filter((h) => h.terrain === 'harbor').length, 6);
  for (const h of hexes) {
    const d = Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
    assert.equal(h.terrain === 'ocean', d === mapRadius(2) + 1, `${h.q},${h.r}`);
  }
  g.players[0].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 50 };
  const tower = g.towers[0];
  const [sea, harbor, land] = neighbors(tower);
  g.map[sea].terrain = 'ocean';
  g.map[harbor].terrain = 'harbor';
  g.map[land].terrain = 'plains';
  assert.throws(() => apply(g, 0, `build roost ${sea}`), RuleError); // nothing on the ocean
  g.players[0].hand.push({ id: 'cport', deck: 'building', key: 'port' });
  assert.throws(() => apply(g, 0, `build cport ${land}`), RuleError); // a port needs a harbor
  apply(g, 0, `build cport ${harbor}`);
  assert.equal(g.buildings[harbor].type, 'port');
  assert.equal(bankRate(g, 0), BUILDINGS.port.bankRate);
});

test('a title needs its minimum as well as the lead', () => {
  const g = newGame(2, 6);
  keepAll(g);
  g.players[0].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 50 };
  const tower = g.buildings[g.towers[0]];
  tower.floors = TUNING.titleMinimum.tower - 1; // the lead, one short of the minimum
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.tower, null);
  tower.floors = TUNING.titleMinimum.tower;
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.tower, 0);
});

test('Largest Hoard goes to the most gold, from its minimum, and changes hands', () => {
  const g = newGame(2, 6);
  keepAll(g);
  const min = TUNING.titleMinimum.hoard;
  g.players[0].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: min - 1 };
  g.players[1].resources.gold = 0;
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.hoard, null); // the lead, one short of the minimum
  g.players[0].resources.gold = min;
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.hoard, 0);
  g.players[1].resources.gold = min; // a tie: the holder keeps it
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.hoard, 0);
  g.players[1].resources.gold = min + 1;
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.hoard, 1);
  assert.equal(score(g, 1).titles, TUNING.titlePoints);
});

test('dragons are worth no points; Strongest Dragon Army goes to the most combat power, from its minimum (#134)', () => {
  const g = newGame(2, 6);
  keepAll(g);
  g.players[0].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 0 };
  g.dragons = [];
  const add = (owner: number, stage: number) => g.dragons.push({ id: `d${g.dragons.length + 50}`, owner, key: 'fire_whelp', stage, growth: 0, damage: 0, resting: '' });
  const adult = dragonPower({ id: 'x', owner: 0, key: 'fire_whelp', stage: 3, growth: 0, damage: 0, resting: '' });
  const hatchling = dragonPower({ id: 'x', owner: 0, key: 'fire_whelp', stage: 1, growth: 0, damage: 0, resting: '' });
  // 3 adults fall short (the 9 dragon points they were worth fell short of 10); a hatchling more doesn't.
  assert.ok(3 * adult < TUNING.titleMinimum.army && 3 * adult + hatchling >= TUNING.titleMinimum.army);
  for (let i = 0; i < 3; i++) add(0, 3);
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.army, null);
  assert.equal(score(g, 0).public, 0); // dragons alone score nothing
  add(0, 1);
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.army, 0);
  assert.equal(score(g, 0).public, TUNING.titlePoints);
  for (let i = 0; i < 3; i++) add(1, 3);
  add(1, 1); // a tie: the holder keeps it
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.army, 0);
  add(1, 0); // an egg has no power
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.army, 0);
  add(1, 1);
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.army, 1);
  assert.equal(score(g, 1).titles, TUNING.titlePoints);
});

test('table talk is allowed any time, private talk reaches only the two players, and nothing else changes', () => {
  const g = newGame(3, 13);
  hatchAll(g);
  const before = JSON.stringify({ ...g, log: [] });
  apply(g, 2, 'say anyone want   timber?'); // not P3's turn: talk is still fine
  apply(g, 1, 'tell P1 I will bail, trust me');
  assert.equal(JSON.stringify({ ...g, log: [] }), before);
  assert.ok(playerView(g, 0).includes('P3 says: "anyone want timber?"'));
  assert.ok(playerView(g, 0).includes('P2 to P1 (private): "I will bail, trust me"'));
  assert.ok(!playerView(g, 2).includes('I will bail'));
  assert.throws(() => apply(g, 0, 'tell P1 talking to myself'), /You can't tell yourself\./);
  assert.throws(() => apply(g, 0, 'tell P9 hi'), /Tell whom\?/);
  assert.throws(() => apply(g, 0, 'say'), RuleError);
  advanceToRaidVote(g);
  apply(g, 0, 'say vote 2 with me');
  assert.equal(g.raid!.step, 'vote');
});

test('a dragon hurt in a raid heals instead of growing and sits out the next raid', () => {
  const g = newGame(2, 7);
  const a = g.dragons[0];
  a.damage = 3; // hurt in this round's raid
  g.players[a.owner].resources.livestock = 5;
  const ga = a.growth + a.stage * 10;
  advanceToRaidVote(g);
  while (g.phase === 'raid') for (const p of waitingOn(g)) apply(g, p, g.raid!.step === 'vote' ? 'vote 1' : g.raid!.step === 'commit' ? 'ready' : 'bail');
  while (g.phase === 'discard') for (const p of waitingOn(g)) apply(g, p, 'discard');
  assert.equal(g.round, 2);
  assert.equal(a.damage, 0);
  assert.equal(a.resting, 'hurt');
  assert.equal(a.growth + a.stage * 10, ga, 'a hurt dragon does not grow while it heals');
  advanceToRaidVote(g);
  for (const p of waitingOn(g)) apply(g, p, 'vote 1');
  assert.throws(() => apply(g, a.owner, `commit ${a.id}`), RuleError);
});

test('a hungry dragon neither heals, grows nor raids', () => {
  const g = newGame(2, 7);
  hatchAll(g);
  const a = g.dragons[0];
  const ga = a.growth + a.stage * 10;
  advanceToRaidVote(g);
  // Dragons eat in hatching order: one hatched earlier eats the tower's only livestock.
  g.dragons.unshift({ ...a, id: 'd99' });
  g.players[a.owner].resources.livestock = 0;
  a.damage = 3;
  while (g.phase === 'raid') for (const p of waitingOn(g)) apply(g, p, g.raid!.step === 'vote' ? 'vote 1' : g.raid!.step === 'commit' ? 'ready' : 'bail');
  while (g.phase === 'discard') for (const p of waitingOn(g)) apply(g, p, 'discard');
  assert.equal(a.resting, 'hungry');
  assert.equal(a.growth + a.stage * 10, ga, 'a hungry dragon does not grow');
  assert.equal(a.damage, 3, 'a hungry dragon does not heal');
});

test('a tower floor is built without a card, for gold, and is worth no points', () => {
  const g = newGame(2, 7);
  keepAll(g);
  const p = g.turn;
  const before = score(g, p).buildings;
  g.players[p].resources.gold = 0;
  assert.throws(() => apply(g, p, 'build tower_floor'), RuleError);
  g.players[p].resources = { ...g.players[p].resources, ...BUILDINGS.tower_floor.cost };
  apply(g, p, 'build tower_floor');
  assert.equal(g.buildings[g.towers[p]].floors, 1);
  assert.equal(score(g, p).buildings, before); // floors count only toward Tallest Tower
  assert.equal(g.players[p].resources.gold, 0);
});

test('each round you draw two building cards and keep one; the other is discarded', () => {
  const g = newGame(3, 21);
  assert.equal(g.phase, 'cards');
  assert.deepEqual(waitingOn(g), [0, 1, 2]);
  const [a, b] = g.players[0].choice;
  assert.ok(a && b && a.deck === 'building' && b.deck === 'building');
  assert.equal(g.players[0].hand.length, TUNING.actionCardsPerRound);
  assert.throws(() => apply(g, 0, 'keep c99999'), RuleError);
  assert.throws(() => apply(g, 0, 'end'), RuleError);
  apply(g, 0, `keep ${b.id}`);
  assert.ok(g.players[0].hand.some((c) => c.id === b.id));
  assert.ok(g.discards.building.some((c) => c.id === a.id));
  assert.throws(() => apply(g, 0, `keep ${a.id}`), RuleError); // already kept
  assert.ok(!playerView(g, 1, 1000).includes(a.id), 'what P1 drew stays hidden');
  apply(g, 1, `keep ${g.players[1].choice[0].id}`);
  assert.equal(g.phase, 'cards');
  apply(g, 2, `keep ${g.players[2].choice[0].id}`);
  assert.equal(g.phase, 'action');
  // Basic buildings aren't in the deck.
  for (const c of [...g.decks.building, ...g.discards.building]) assert.ok(!BUILDINGS[c.key]?.basic, c.key);
});

test('building cards count their neighbours; point buildings must go beside what they need', () => {
  const g = newGame(2, 8);
  keepAll(g);
  rich(g, 0);
  const tower = g.towers[0];
  const [spot, ...ring] = neighbors(tower).filter((k) => g.map[k]);
  for (const k of neighbors(spot)) if (g.map[k] && k !== tower) g.map[k].terrain = 'plains';
  g.map[spot].terrain = 'plains';
  // Cliff Works makes 1 stone each round for each adjacent mountain hex.
  g.players[0].hand.push({ id: 'ccw', deck: 'building', key: 'cliff_works' });
  apply(g, 0, `build ccw ${spot}`);
  const stone = () => production(g, 0).stone.base;
  const base = stone();
  const around = neighbors(spot).filter((k) => g.map[k] && !g.buildings[k]);
  g.map[around[0]].terrain = 'mountain';
  g.map[around[1]].terrain = 'mountain';
  assert.equal(stone(), base + 2);
  // A Monument must go beside a monument (a tower counts), and is worth its flat points.
  const away = neighbors(spot).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k]
    && !neighbors(k).some((n) => g.buildings[n] && buildingClass(g.buildings[n]).includes('monument')));
  g.players[0].hand.push({ id: 'cmo', deck: 'building', key: 'monument' });
  assert.ok(away, "a free hex beside the Cliff Works and away from any monument");
  assert.throws(() => apply(g, 0, `build cmo ${away}`), RuleError);
  const next = ring.find((k) => g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
  apply(g, 0, `build cmo ${next}`);
  assert.equal(buildingPoints(g, next), BUILDINGS.monument.points);
});

test('a fight replays from its events: the hits add up to the result', () => {
  let fights = 0;
  for (const { players, seed, g } of botGames()) {
    for (const [i, e] of g.log.entries()) {
      if (e.ev?.k !== 'fight') continue;
      fights++;
      const units = e.ev.units.map((u) => u.hp);
      const fighting = new Set(e.ev.ds);
      let j = i + 1;
      for (let c = g.log[j].ev; c?.k === 'combat'; c = g.log[++j].ev) {
        for (const h of c.hits) {
          if (h.by === 'dragon') {
            units[h.u] = Math.max(0, units[h.u] - h.dmg);
            assert.equal(h.down, units[h.u] === 0);
          } else if (h.down) fighting.delete(h.d);
        }
      }
      const end = g.log[j].ev;
      assert.equal(end?.k, 'raidEnd', `${players}p seed ${seed}`);
      if (end?.k !== 'raidEnd') continue;
      assert.equal(end.won, units.every((hp) => hp === 0));
      assert.equal(!end.won, fighting.size === 0);
    }
  }
  assert.ok(fights > 10);
});

test('a hurt dragon heals a little each production and sits out until it is whole', () => {
  const g = newGame(2, 7);
  const a = g.dragons[0];
  a.stage = 3; // an adult, so it has the health to take a big hit
  const damage = 2 * TUNING.healPerRound + 1;
  a.damage = damage; // hurt in this round's raid
  g.players[a.owner].resources.livestock = 20;
  const out = Math.ceil(damage / TUNING.healPerRound);
  const passRound = () => {
    for (const pl of g.players) pl.hand = []; // nothing to discard
    advanceToRaidVote(g);
    while (g.phase === 'raid') for (const p of waitingOn(g)) apply(g, p, g.raid!.step === 'vote' ? 'vote 1' : g.raid!.step === 'commit' ? 'ready' : 'bail');
    while (g.phase === 'discard') for (const p of waitingOn(g)) apply(g, p, 'discard');
  };
  assert.equal(backInRound(g, a), g.round + out + 1);
  for (let i = 1; i <= out; i++) {
    passRound();
    assert.equal(a.damage, Math.max(0, damage - i * TUNING.healPerRound));
    assert.equal(a.resting, 'hurt', `still out in round ${g.round}`);
    assert.ok(!canRaid(a));
  }
  passRound();
  assert.equal(a.resting, '');
  assert.ok(canRaid(a), `back in round ${g.round}`);
});

test('raid loot is split by the combat power still fighting at the end', () => {
  let shared = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = newGame(2, seed);
    hatchAll(g);
    keepAll(g);
    while (g.phase === 'action') apply(g, g.turn, 'end');
    g.dragons = [
      { id: 'd1', owner: 0, key: 'fire_whelp', stage: 3, growth: 0, damage: 0, resting: '' },
      { id: 'd2', owner: 0, key: 'ice_whelp', stage: 3, growth: 0, damage: 0, resting: '' },
      { id: 'd3', owner: 1, key: 'air_whelp', stage: 1, growth: 0, damage: 0, resting: '' },
      // Stays home, so the next raid has a raider and isn't skipped.
      { id: 'd4', owner: 1, key: 'water_whelp', stage: 1, growth: 0, damage: 0, resting: '' },
    ];
    g.raid!.candidates = ['archers_hold'];
    g.raidsLeft = 2; // stop at the next raid's vote, before the next production
    g.hoard.archers_hold = seed % 4; // some gold hoarded, split like the rest
    const loot = lootOf(g, 'archers_hold');
    const hoard = { ...g.hoard };
    const before = g.players.map((pl) => ({ ...pl.resources }));
    apply(g, 0, 'vote 1'); apply(g, 1, 'vote 1');
    apply(g, 0, 'commit d1 d2'); apply(g, 1, 'commit d3');
    apply(g, 0, 'ready'); apply(g, 1, 'ready');
    apply(g, 0, 'fight'); apply(g, 1, 'fight');
    const end = g.log.findLast((e) => e.ev?.k === 'raidEnd')!.ev!;
    if (end.k !== 'raidEnd' || !end.won) continue;
    assert.equal(loot.gold, TARGETS.archers_hold.loot.gold! + hoard.archers_hold);
    // The kingdom that fell is back to its printed loot; every other one adds 1 gold.
    for (const t of Object.keys(TARGETS)) assert.equal(g.hoard[t], t === 'archers_hold' ? 0 : hoard[t] + 1, t);
    const power = g.players.map((_, p) => { const i = end.winners.indexOf(p); return i < 0 ? 0 : end.power[i]; });
    const shares = splitLoot(loot, power);
    for (const r of RESOURCES) {
      if (!loot[r]) continue;
      const got: number[] = end.winners.map((p) => g.players[p].resources[r] - before[p][r]);
      assert.equal(got.reduce((s, x) => s + x, 0), loot[r], 'none of the loot is lost');
      end.winners.forEach((p, i) => assert.equal(got[i], shares[p][r] ?? 0));
    }
    if (end.winners.length === 2) shared++;
  }
  assert.ok(shared > 0, 'some raids should be shared');
});

test('loot left over goes out 1 at a time, strongest first, carrying on across resources', () => {
  // 3 equal winners, 2 livestock and 2 gold: P1 and P2 take a livestock, P3 and P1 a gold.
  assert.deepEqual(splitLoot({ livestock: 2, gold: 2 }, [5, 5, 5]), [{ livestock: 1, gold: 1 }, { livestock: 1 }, { gold: 1 }]);
  // Strongest first, equal powers in seat order; a player not fighting gets nothing.
  assert.deepEqual(splitLoot({ stone: 1, gold: 1 }, [3, 0, 7, 3]), [{ gold: 1 }, {}, { stone: 1 }, {}]);
  // Shares in proportion come first, then the leftover: 7 gold at 2:1 is 4 and 2, then 1 to the stronger.
  assert.deepEqual(splitLoot({ gold: 7 }, [2, 1]), [{ gold: 5 }, { gold: 2 }]);
});

test('Healing Potion heals a dragon that cleared a hex, which still sits out the raids', () => {
  const g = newGame(2, 3);
  keepAll(g);
  g.dragons = [{ id: 'd1', owner: g.turn, key: 'fire_whelp', stage: 2, growth: 0, damage: 3, resting: 'hunted' }];
  g.players[g.turn].hand.push({ id: 'cx', deck: 'action', key: 'healing_potion' });
  apply(g, g.turn, 'play cx d1');
  assert.equal(g.dragons[0].damage, 0);
  assert.equal(canRaid(g.dragons[0]), false, 'it cleared a hex, so it sits out this round');
});

test('discard is refused outside the end of the round', () => {
  const g = newGame(2, 3);
  keepAll(g);
  assert.throws(() => apply(g, g.turn, 'discard c1'), /end of the round/);
});

test('combat power: dragons and kingdoms carry one number, and a side adds up', () => {
  const g = newGame(2, 7);
  const a = g.dragons[0];
  a.stage = 3;
  const st = DRAGONS[a.key].stages[2];
  assert.equal(dragonPower(a), Math.round(Math.sqrt(st.hp * st.targets * st.dice * (st.sides + 1) / 2)));
  assert.equal(targetPower('brindle'), 2 * combatPower(UNITS.militia));
  assert.match(playerView(g, 0), new RegExp(`power ${dragonPower(a)}`));
});

// The map as generated, before the first production lets fauna wander.
const startingMap = (players: number, seed: number) => ({ map: generateMap({ state: seed }, players), towers: towerSpots(players) });

test('the starting map has fauna, at least 2 steps from every tower, stronger further out', () => {
  for (let players = 2; players <= 6; players++) {
    const g = startingMap(players, 3);
    const land = Object.values(g.map).filter((h) => h.terrain !== 'ocean');
    const fauna = land.filter((h) => h.fauna && FAUNA[h.fauna]);
    assert.equal(fauna.length, Math.round(land.length / TUNING.landHexesPerFauna));
    for (const h of fauna) {
      const away = Math.min(...g.towers.map((t) => { const [q, r] = t.split(',').map(Number); return distance(h.q - q, h.r - r); }));
      assert.ok(away >= 2, `${players}p: fauna ${away} step(s) from a tower`);
      assert.equal(h.fauna, FAUNA_BY_DISTANCE[Math.min(away - 2, FAUNA_BY_DISTANCE.length - 1)]);
    }
  }
});

test('the great beasts: the Thunderbird on the centre peak, the Leviathan off a harbor, nothing around them', () => {
  for (let players = 2; players <= 6; players++) {
    for (const seed of [1, 2, 3]) {
      const g = startingMap(players, seed);
      assert.equal(g.map[PEAK].fauna, 'thunderbird');
      assert.equal(g.map[PEAK].terrain, 'mountain');
      const sea = Object.keys(g.map).filter((k) => g.map[k].fauna === 'leviathan');
      assert.equal(sea.length, 1);
      assert.equal(g.map[sea[0]].terrain, 'ocean');
      assert.ok(neighbors(sea[0]).some((n) => g.map[n]?.terrain === 'harbor'));
      for (const b of [PEAK, sea[0]]) {
        for (const n of neighbors(b)) {
          assert.ok(!g.map[n]?.fauna, `${players}p: fauna next to a great beast`);
          assert.ok(!g.towers.includes(n), `${players}p: a tower next to a great beast`);
        }
      }
    }
  }
});

// A game with an adult of the beast's weakness or not, and P1's land next to the peak.
function beastGame() {
  const g = newGame(2, 5);
  keepAll(g);
  rich(g, 0);
  const [ring] = neighbors(PEAK);
  const [beyond] = neighbors(ring).filter((n) => n !== PEAK && !neighbors(PEAK).includes(n));
  g.buildings[beyond] = { type: 'roost', owner: 0, upgrade: null, floors: 0 };
  g.map[ring].terrain = 'meadow';
  delete g.map[ring].fauna;
  return { g, ring, beyond };
}

test('a great beast holds the hexes around it: nothing is built there until it falls', () => {
  const { g, ring } = beastGame();
  assert.throws(() => apply(g, 0, `build pasture ${ring}`), /great beast/);
  assert.throws(() => apply(g, 0, `build roost ${PEAK}`), RuleError);
  delete g.map[PEAK].fauna;
  g.slain.thunderbird = 1;
  apply(g, 0, `build pasture ${ring}`);
  // A production building next to the freed peak makes more.
  assert.equal(production(g, 0).livestock.base, TUNING.towerProduction.livestock! + TUNING.peakBonus);
});

test('fighting a great beast: one try a round, it heals between fights, the slayer scores for good', () => {
  const { g } = beastGame();
  const d = g.dragons.find((x) => x.owner === 0)!;
  d.stage = 1; // a hatchling can't beat the Thunderbird
  const extra = { ...d, id: 'd90', resting: '' as const };
  g.dragons.push(extra);
  apply(g, 0, `clear ${PEAK} ${d.id}`);
  assert.equal(g.map[PEAK].fauna, 'thunderbird');
  assert.throws(() => apply(g, 0, `clear ${PEAK} d90`), /1 try each round/);
  // Next round: three adult ice dragons, its weakness.
  g.round++;
  g.dragons = g.dragons.filter((x) => x.owner !== 0);
  for (let i = 0; i < 3; i++) g.dragons.push({ id: `d8${i}`, owner: 0, key: 'frost_wyrm', stage: 3, growth: 0, damage: 0, resting: '' });
  const untitled = () => score(g, 0).total - score(g, 0).titles; // the army title may move too
  const before = untitled();
  apply(g, 0, `clear ${PEAK} d80 d81 d82`);
  assert.equal(g.map[PEAK].fauna, undefined);
  assert.equal(g.slain.thunderbird, 0);
  assert.equal(score(g, 0).beasts, BEASTS.thunderbird.points);
  assert.equal(untitled(), before + BEASTS.thunderbird.points);
  assert.match(playerView(g, 1), /Thunderbird by P1/);
});

// A game where P1's own land is set: a meadow pasture next to the tower, and
// fauna on the hex beyond it.
function faunaGame() {
  const g = newGame(2, 5);
  hatchAll(g);
  keepAll(g);
  for (const k of Object.keys(g.map)) delete g.map[k].fauna;
  rich(g, 0);
  rich(g, 1);
  const [near, beyond] = neighbors(g.towers[0]).filter((k) => g.map[k] && g.map[k].terrain !== 'ocean');
  g.map[near].terrain = 'meadow';
  g.map[beyond].terrain = 'meadow';
  return { g, near, beyond };
}

test('fauna blocks building on its hex, and a building under it produces nothing', () => {
  const { g, near, beyond } = faunaGame();
  g.map[beyond].fauna = 'wolf_pack';
  assert.throws(() => apply(g, 0, `build pasture ${beyond}`), RuleError);
  apply(g, 0, `build pasture ${near}`);
  assert.equal(production(g, 0).livestock.dice.length, 1);
  g.map[near].fauna = 'cave_bear';
  assert.equal(production(g, 0).livestock.dice.length, 0);
  assert.equal(production(g, 0).livestock.base, TUNING.towerProduction.livestock);
});

test('clearing fauna: any player may, the loot is theirs, and those dragons sit out the raids', () => {
  const { g, near } = faunaGame();
  apply(g, 0, `build pasture ${near}`);
  g.map[near].fauna = 'wolf_pack'; // on P1's pasture
  apply(g, 0, 'end');
  assert.throws(() => apply(g, 1, `clear ${g.towers[0]} d2`), RuleError); // no fauna there
  assert.throws(() => apply(g, 1, `clear ${near}`), RuleError); // no dragons sent
  // P2 clears it with an adult that can't lose to wolves (a refused command
  // restores the game, so the dragon is looked up after those).
  const d = g.dragons.find((x) => x.owner === 1)!;
  d.stage = 3;
  d.key = 'frost_wyrm';
  const before = g.players[1].resources.livestock;
  apply(g, 1, `clear ${near} ${d.id}`);
  assert.equal(g.map[near].fauna, undefined);
  assert.equal(g.players[1].resources.livestock, before + FAUNA.wolf_pack.loot.livestock!);
  assert.equal(d.resting, 'hunted');
  assert.throws(() => apply(g, 1, `clear ${near} ${d.id}`), RuleError); // one fight a round
  const ev = g.log.map((e) => e.ev).filter((e) => e?.k === 'cleared');
  assert.ok(ev.some((e) => e?.k === 'cleared' && e.won && e.p === 1));
  apply(g, 1, 'end');
  for (const p of waitingOn(g)) apply(g, p, 'vote 1');
  assert.throws(() => apply(g, 1, `commit ${d.id}`), RuleError);
});

test('a lost fight leaves the beast at full health on its hex', () => {
  const { g, beyond } = faunaGame();
  g.map[beyond].fauna = 'basilisk';
  const d = g.dragons.find((x) => x.owner === 0)!;
  d.stage = 1; // a hatchling can't beat a basilisk
  apply(g, 0, `clear ${beyond} ${d.id}`);
  assert.equal(g.map[beyond].fauna, 'basilisk');
  assert.equal(d.damage, DRAGONS[d.key].stages[0].hp); // knocked out
});

test('fauna cards place a beast on any land hex with no tower or beast, shutting down a building', () => {
  const { g, near } = faunaGame();
  apply(g, 0, `build pasture ${near}`);
  apply(g, 0, 'end');
  const card = { id: 'c999', deck: 'action' as const, key: 'rouse_bear' };
  g.players[1].hand.push(card);
  assert.throws(() => apply(g, 1, `play c999 ${g.towers[0]}`), RuleError);
  const ocean = Object.keys(g.map).find((k) => g.map[k].terrain === 'ocean')!;
  assert.throws(() => apply(g, 1, `play c999 ${ocean}`), RuleError);
  const crystal = g.players[1].resources.crystal;
  apply(g, 1, `play c999 ${near}`);
  assert.equal(g.map[near].fauna, ACTIONS.rouse_bear.fauna);
  assert.equal(g.map[near].sent, true);
  assert.equal(g.players[1].resources.crystal, crystal - ACTIONS.rouse_bear.cost.crystal!);
  assert.equal(production(g, 0).livestock.dice.length, 0);
  assert.ok(!g.players[1].hand.includes(card));
});

test('a beast a card sent gives no loot when it falls', () => {
  const { g, near } = faunaGame();
  g.map[near].fauna = 'wolf_pack';
  g.map[near].sent = true; // as a card leaves it
  const d = g.dragons.find((x) => x.owner === 0)!;
  d.stage = 3;
  d.key = 'frost_wyrm'; // an adult that can't lose to wolves
  const before = { ...g.players[0].resources };
  apply(g, 0, `clear ${near} ${d.id}`);
  const ev = g.log.map((e) => e.ev).find((e) => e?.k === 'cleared');
  assert.ok(ev?.k === 'cleared' && ev.won);
  assert.deepEqual(ev.gain, {});
  assert.equal(g.map[near].fauna, undefined);
  assert.equal(g.map[near].sent, undefined);
  assert.deepEqual(g.players[0].resources, before);
});

test('in production, fauna wanders to adjacent land hexes with no tower or beast; great beasts stay', () => {
  const g = newGame(2, 7);
  for (const k of Object.keys(g.map)) if (!BEASTS[g.map[k].fauna ?? '']) delete g.map[k].fauna;
  for (const d of g.dragons) d.stage = 0; // no raids: each round goes straight to the next
  g.dragons.forEach((d) => (d.growth = -1000));
  let at = Object.keys(g.map).find((k) => g.map[k].terrain !== 'ocean' && !g.map[k].fauna && !g.buildings[k] && neighbors(k).every((n) => g.map[n]))!;
  g.map[at].fauna = 'wolf_pack';
  g.map[at].sent = true;
  const great = Object.keys(g.map).filter((k) => BEASTS[g.map[k].fauna ?? '']).sort();
  let moves = 0;
  let stays = 0;
  for (let i = 0; i < 40 && g.phase !== 'over'; i++) {
    keepAll(g);
    while (g.phase === 'action') apply(g, g.turn, 'end');
    while (g.phase === 'discard') for (const p of waitingOn(g)) {
      const pl = g.players[p];
      apply(g, p, `discard ${pl.hand.slice(0, pl.hand.length - TUNING.handCap).map((c) => c.id).join(' ')}`);
    }
    const now = Object.keys(g.map).find((k) => g.map[k].fauna === 'wolf_pack')!;
    if (now === at) stays++;
    else {
      moves++;
      assert.ok(neighbors(at).includes(now), `${at} to ${now} is 1 step`);
      assert.notEqual(g.map[now].terrain, 'ocean');
      assert.notEqual(g.buildings[now]?.type, 'tower');
      assert.equal(g.map[now].sent, true, 'the card-sent mark moves with it');
      assert.equal(g.map[at].sent, undefined);
    }
    at = now;
    assert.deepEqual(Object.keys(g.map).filter((k) => BEASTS[g.map[k].fauna ?? '']).sort(), great);
  }
  assert.ok(moves > 0 && stays > 0, `moved ${moves}, stayed ${stays}`);
  assert.ok(g.log.some((e) => e.ev?.k === 'wander'));
});

test('each option a seat is offered says why it is off, in the words a refused command uses', () => {
  const g = newGame(2, 11);
  keepAll(g);
  const p = g.turn, other = 1 - p;
  rich(g, p);
  rich(g, other);
  g.players[p].hand = [{ id: 'c900', deck: 'building', key: 'monument' }];
  g.players[other].hand = [{ id: 'c901', deck: 'building', key: 'monument' }];
  // Yours to play now: no reason.
  assert.equal(seatState(g, p).hand[0].why, null);
  assert.equal(seatState(g, p).hand[0].verb, 'Build');
  // Off your turn, the card's own verb says when.
  assert.equal(seatState(g, other).hand[0].why, 'Build it on your turn.');
  // Short of a resource: the error playing it would give.
  g.players[p].resources.stone = 0;
  const why = seatState(g, p).hand[0].why!;
  assert.match(why, /^You can't afford .*stone.*\.$/);
  assert.throws(() => apply(g, p, `build c900 ${seatState(g, p).hand[0].hexes[0]}`), new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // A basic building with nowhere to go, and the egg with no room, say so.
  const s = seatState(g, p);
  for (const b of s.basics) assert.equal(b.why === null, b.affordable && (b.onTower || b.hexes.length > 0), b.key);
  assert.equal(s.eggProject.why === null, s.eggProject.affordable && s.eggProject.room);
});
