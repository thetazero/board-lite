import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { playOut } from '../src/bot.ts';
import { RuleError, apply, newGame, score, waitingOn, type Game } from '../src/engine.ts';
import { BUILDINGS, TUNING } from '../src/data.ts';
import { playerView } from '../src/view.ts';
import { neighbors } from '../src/map.ts';

function advanceToRaidVote(g: Game) {
  while (g.phase === 'action') apply(g, g.turn, 'end');
}

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
});

test('illegal moves are refused without changing the game', () => {
  const g = newGame(3, 9);
  const before = JSON.stringify(g);
  assert.throws(() => apply(g, 1, 'end'), RuleError); // not P2's turn
  assert.throws(() => apply(g, 0, 'build c999 0,0'), RuleError);
  assert.throws(() => apply(g, 0, 'bank stone gold'), RuleError); // can't afford 4 stone
  assert.throws(() => apply(g, 0, 'dance'), RuleError);
  assert.equal(JSON.stringify(g), before);
});

test('trades are binding and move resources and cards', () => {
  const g = newGame(2, 11);
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
});

test('buildings must touch your territory and match terrain', () => {
  const g = newGame(2, 2);
  const tower = g.towers[0];
  g.players[0].resources = { stone: 50, timber: 50, crystal: 50, livestock: 50, gold: 50 };
  assert.throws(() => apply(g, 0, `project quarry ${tower}`), RuleError); // occupied
  const far = Object.keys(g.map).find((k) => g.map[k].terrain === 'mountain' && !neighbors(k).some((n) => g.buildings[n]))!;
  assert.throws(() => apply(g, 0, `project quarry ${far}`), RuleError); // not touching
  const [wrong, right] = neighbors(tower).filter((k) => g.map[k]); // the land around a tower is random, so set it
  g.map[wrong].terrain = 'forest';
  g.map[right].terrain = 'mountain';
  assert.throws(() => apply(g, 0, `project quarry ${wrong}`), RuleError); // wrong terrain
  apply(g, 0, `project quarry ${right}`);
  assert.equal(g.buildings[right].type, 'quarry');
  // Special projects cost double the card.
  assert.equal(g.players[0].resources.timber, 50 - BUILDINGS.quarry.cost.timber! * 2);
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

test('a playtest seat server plays one seat over MCP', () => {
  mkdirSync(join(homedir(), '.cache'), { recursive: true });
  const dir = mkdtempSync(join(homedir(), '.cache', 'board-lite-test-'));
  try {
    const file = join(dir, 'g.json');
    execFileSync(process.execPath, ['src/cli.ts', 'new', file, '--players', '2', '--seed', '4']);
    const reqs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'say', arguments: { message: 'hello', to: 'P1' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'act', arguments: { command: 'end' } } },
    ];
    const outText = execFileSync(process.execPath, ['src/playtest/seat-server.ts', file, '2'], { input: reqs.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8' });
    const res = outText.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(res[1].result.tools.map((t: { name: string }) => t.name), ['view', 'act', 'say', 'wait', 'rules']);
    assert.match(res[2].result.content[0].text, /P2 to P1 \(private\): "hello"/);
    assert.match(res[3].result.content[0].text, /Not allowed/); // it's P1's turn, and the server only plays P2
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
