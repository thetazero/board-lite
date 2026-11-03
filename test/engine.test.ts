import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { playOut } from '../src/bot.ts';
import { RuleError, apply, bankRate, buildingClass, buildingPoints, newGame, production, score, standings, waitingOn, type Game } from '../src/engine.ts';
import { ACTIONS, BUILDINGS, DRAGONS, FAUNA, FAUNA_BY_DISTANCE, TUNING } from '../src/data.ts';
import { playerView } from '../src/view.ts';
import { distance, mapRadius, neighbors } from '../src/map.ts';

// Each round starts with everyone keeping a building card: keep the first.
function keepAll(g: Game) {
  while (g.phase === 'cards') for (const p of waitingOn(g)) apply(g, p, `keep ${g.players[p].choice[0].id}`);
}

function advanceToRaidVote(g: Game) {
  keepAll(g);
  while (g.phase === 'action') apply(g, g.turn, 'end');
}

const rich = (g: Game, p: number) => (g.players[p].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 50 });

test('bot games reach a winner for every player count', () => {
  for (let players = 2; players <= 6; players++) {
    for (let seed = 1; seed <= 10; seed++) {
      const g = newGame(players, seed);
      playOut(g, { state: seed * 31 + players });
      assert.equal(g.phase, 'over', `${players}p seed ${seed} did not finish`);
      assert.ok(g.winner !== null);
      assert.ok(score(g, g.winner!).total >= TUNING.pointsToWin);
      // The game survives a save/load round trip at the end.
      assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
    }
  }
});

test('the final standings put the winner first and mark ties', () => {
  let tiedWins = 0;
  let sharedPlaces = 0;
  for (let players = 2; players <= 6; players++) {
    for (let seed = 1; seed <= 30; seed++) {
      const g = newGame(players, seed);
      playOut(g, { state: seed * 31 + players });
      const st = standings(g);
      assert.equal(st[0].p, g.winner, `${players}p seed ${seed}: the list names someone else first`);
      assert.equal(st[0].place, 1);
      for (const [i, s] of st.entries()) {
        assert.equal(s.total, score(g, s.p).total);
        if (i === 0) continue;
        assert.ok(s.total <= st[i - 1].total, 'most points first');
        assert.ok(s.place > 1, 'first place is never shared');
        const level = s.total === st[i - 1].total;
        if (level) assert.ok(s.tied && st[i - 1].tied);
        if (level && i > 1) sharedPlaces++;
        assert.equal(s.place, level && i > 1 ? st[i - 1].place : i + 1);
      }
      if (st[0].tiebreak) {
        tiedWins++;
        assert.equal(st[0].total, st[1].total);
        assert.ok(g.players[st[0].p].resources.gold >= g.players[st[1].p].resources.gold);
      }
    }
  }
  assert.ok(tiedWins > 0 && sharedPlaces > 0, `the seeds should cover a tied win (${tiedWins}) and a shared place (${sharedPlaces})`);
});

test('the log reads as English: no "1 cards", "card(s)" or one winner who "each take"', () => {
  const bad = /\b1 (cards|raids|steps)\b|\(s\)|falls! \S+ each take|\ba (adult|egg)\b/;
  for (let players = 2; players <= 6; players++) {
    for (let seed = 1; seed <= 10; seed++) {
      const g = newGame(players, seed);
      playOut(g, { state: seed * 31 + players });
      for (const e of g.log) assert.doesNotMatch(e.text, bad, `${players}p seed ${seed}`);
    }
  }
});

test('the same seed gives the same game', () => {
  const a = newGame(4, 42), b = newGame(4, 42);
  playOut(a, { state: 1 });
  playOut(b, { state: 1 });
  assert.deepEqual(a, b);
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

test('votes and fight-or-bail choices stay secret until revealed', () => {
  const g = newGame(2, 3);
  advanceToRaidVote(g);
  apply(g, 0, 'vote 2');
  const v1 = playerView(g, 1, 1000);
  assert.ok(!v1.includes('You vote'));
  assert.ok(v1.includes('P1 has voted'));
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
  assert.ok(playerView(g, 1, 1000).includes('P1 bails!'));
  // There is no retreat: the fight plays out to the end with no more choices.
  assert.equal(g.raid, null);
  assert.match(playerView(g, 1, 1000), /falls!|holds\./);
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
  // Accepting an offer you can't pay for fails and leaves the offer open.
  apply(g, 1, 'offer P1 give 1 stone get 40 timber');
  assert.throws(() => apply(g, 0, `accept ${g.offers[0].id}`), RuleError);
  assert.equal(g.offers.length, 1);
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
  const free = Object.keys(g.map).filter((k) => g.map[k].terrain !== 'ocean' && !g.buildings[k]);
  const own = (n: number) => { for (const k of free.slice(0, n)) g.buildings[k] = { type: 'roost', owner: 0, upgrade: null, floors: 0 }; };
  own(TUNING.titleMinimum.territory - 2); // with the tower, one short of the minimum
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.territory, null);
  own(TUNING.titleMinimum.territory - 1);
  apply(g, 0, 'bank stone timber');
  assert.equal(g.titles.territory, 0);
});

test('waitingOn always names someone until the game ends', () => {
  const g = newGame(4, 77);
  const rng = { state: 5 };
  let steps = 0;
  while (g.phase !== 'over' && steps < 20000) {
    assert.ok(waitingOn(g).length > 0);
    playOut(g, rng, 1);
    steps++;
  }
  assert.equal(g.phase, 'over');
});

test('separate CLI processes can share one game', () => {
  // On disk, not /tmp (which is RAM on the dev machine).
  mkdirSync(join(homedir(), '.cache'), { recursive: true });
  const dir = mkdtempSync(join(homedir(), '.cache', 'board-lite-test-'));
  try {
    const file = join(dir, 'g.json');
    const cli = (...args: string[]) => execFileSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' });
    cli('new', file, '--players', '2', '--seed', '4');
    assert.match(cli('view', file, '1'), /It's your decision/);
    assert.match(cli('view', file, '1'), /keep <c\d+\|c\d+>/);
    assert.match(cli('bot', file, '1'), /Bot plays/);
    assert.match(cli('bot', file, '2'), /Bot plays/);
    assert.match(cli('do', file, '1', 'end'), /P2's turn/);
    assert.match(cli('wait', file, '2', '--timeout', '1'), /your decision/);
    assert.throws(() => execFileSync(process.execPath, ['src/cli.ts', 'view', file, '1'], { env: { ...process.env, BOARD_LITE_SEAT: '2' }, stdio: 'pipe' }));
    for (let i = 0; i < 15; i++) {
      const seat = /Waiting on: P(\d)/.exec(cli('status', file))![1];
      assert.match(cli('bot', file, seat), /Bot plays/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('table talk is allowed any time, private talk reaches only the two players, and nothing else changes', () => {
  const g = newGame(3, 13);
  const before = JSON.stringify({ ...g, log: [] });
  apply(g, 2, 'say anyone want   timber?'); // not P3's turn: talk is still fine
  apply(g, 1, 'tell P1 I will bail, trust me');
  assert.equal(JSON.stringify({ ...g, log: [] }), before);
  assert.ok(playerView(g, 0).includes('P3 says: "anyone want timber?"'));
  assert.ok(playerView(g, 0).includes('P2 to P1 (private): "I will bail, trust me"'));
  assert.ok(!playerView(g, 2).includes('I will bail'));
  assert.throws(() => apply(g, 0, 'tell P1 talking to myself'), RuleError);
  assert.throws(() => apply(g, 0, 'say'), RuleError);
  advanceToRaidVote(g);
  apply(g, 0, 'say vote 2 with me');
  assert.equal(g.raid!.step, 'vote');
});

test('a dragon hurt in a raid heals and grows but sits out the next raid', () => {
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
  assert.ok(a.growth + a.stage * 10 > ga, 'a hurt dragon still grows');
  advanceToRaidVote(g);
  for (const p of waitingOn(g)) apply(g, p, 'vote 1');
  assert.throws(() => apply(g, a.owner, `commit ${a.id}`), RuleError);
});

test('a hungry dragon neither grows nor raids', () => {
  const g = newGame(2, 7);
  const a = g.dragons[0];
  const ga = a.growth + a.stage * 10;
  advanceToRaidVote(g);
  // Dragons eat in hatching order: one hatched earlier eats the tower's only livestock.
  g.dragons.unshift({ ...a, id: 'd99' });
  g.players[a.owner].resources.livestock = 0;
  while (g.phase === 'raid') for (const p of waitingOn(g)) apply(g, p, g.raid!.step === 'vote' ? 'vote 1' : g.raid!.step === 'commit' ? 'ready' : 'bail');
  while (g.phase === 'discard') for (const p of waitingOn(g)) apply(g, p, 'discard');
  assert.equal(a.resting, 'hungry');
  assert.equal(a.growth + a.stage * 10, ga, 'a hungry dragon does not grow');
});

test('a tower floor is built without a card, for gold', () => {
  const g = newGame(2, 7);
  keepAll(g);
  const p = g.turn;
  const before = score(g, p).buildings;
  g.players[p].resources.gold = 0;
  assert.throws(() => apply(g, p, 'build tower_floor'), RuleError);
  g.players[p].resources = { ...g.players[p].resources, stone: 2, gold: 3 };
  apply(g, p, 'build tower_floor');
  assert.equal(g.buildings[g.towers[p]].floors, 1);
  assert.equal(score(g, p).buildings, before + 1);
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

test('building cards count their neighbours, whoever owns them', () => {
  const g = newGame(2, 8);
  keepAll(g);
  rich(g, 0);
  const tower = g.towers[0];
  const [spot, ...ring] = neighbors(tower).filter((k) => g.map[k]);
  for (const k of neighbors(spot)) if (g.map[k] && k !== tower) g.map[k].terrain = 'plains';
  g.map[spot].terrain = 'plains';
  // Cliff Works makes 1 stone a round for each neighbouring mountain.
  g.players[0].hand.push({ id: 'ccw', deck: 'building', key: 'cliff_works' });
  apply(g, 0, `build ccw ${spot}`);
  const stone = () => production(g, 0).stone.base;
  const base = stone();
  const around = neighbors(spot).filter((k) => g.map[k] && !g.buildings[k]);
  g.map[around[0]].terrain = 'mountain';
  g.map[around[1]].terrain = 'mountain';
  assert.equal(stone(), base + 2);
  // A monument counts neighbouring monuments: the tower is one, and so is anyone else's monument.
  g.players[0].hand.push({ id: 'cmo', deck: 'building', key: 'monument' });
  const next = ring.find((k) => g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
  apply(g, 0, `build cmo ${next}`);
  const touching = neighbors(next).filter((k) => g.buildings[k] && buildingClass(g.buildings[k]).includes('monument')).length;
  assert.equal(buildingPoints(g, next), touching);
  const free = neighbors(next).find((k) => g.map[k] && g.map[k].terrain !== 'ocean' && !g.buildings[k])!;
  g.buildings[free] = { type: 'monument', owner: 1, upgrade: null, floors: 0 }; // P2's
  assert.equal(buildingPoints(g, next), touching + 1);
});

test('a fight replays from its events: the hits add up to the result', () => {
  let fights = 0;
  for (let players = 2; players <= 6; players++) {
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(players, seed);
      playOut(g, { state: seed * 31 + players });
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
  }
  assert.ok(fights > 10);
});

test('the starting map has fauna, at least 2 steps from every tower, stronger further out', () => {
  for (let players = 2; players <= 6; players++) {
    const g = newGame(players, 3);
    const land = Object.values(g.map).filter((h) => h.terrain !== 'ocean');
    const fauna = land.filter((h) => h.fauna);
    assert.equal(fauna.length, Math.round(land.length / TUNING.landHexesPerFauna));
    for (const h of fauna) {
      const away = Math.min(...g.towers.map((t) => { const [q, r] = t.split(',').map(Number); return distance(h.q - q, h.r - r); }));
      assert.ok(away >= 2, `${players}p: fauna ${away} step(s) from a tower`);
      assert.equal(h.fauna, FAUNA_BY_DISTANCE[Math.min(away - 2, FAUNA_BY_DISTANCE.length - 1)]);
    }
  }
});

// A game where P1's own land is set: a meadow pasture next to the tower, and
// fauna on the hex beyond it.
function faunaGame() {
  const g = newGame(2, 5);
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

test('fauna cards put a beast on any land hex but a tower, shutting down a building', () => {
  const { g, near } = faunaGame();
  apply(g, 0, `build pasture ${near}`);
  apply(g, 0, 'end');
  const card = { id: 'c999', deck: 'action' as const, key: 'wolf_call' };
  g.players[1].hand.push(card);
  assert.throws(() => apply(g, 1, `play c999 ${g.towers[0]}`), RuleError);
  const ocean = Object.keys(g.map).find((k) => g.map[k].terrain === 'ocean')!;
  assert.throws(() => apply(g, 1, `play c999 ${ocean}`), RuleError);
  const gold = g.players[1].resources.gold;
  apply(g, 1, `play c999 ${near}`);
  assert.equal(g.map[near].fauna, 'wolf_pack');
  assert.equal(g.players[1].resources.gold, gold - ACTIONS.wolf_call.cost.gold!);
  assert.equal(production(g, 0).livestock.dice.length, 0);
  assert.ok(!g.players[1].hand.includes(card));
});
