import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { botStep } from '../src/bot.ts';
import { apply, newGame, score, type Game } from '../src/engine.ts';
import { ACTIONS, BUILDINGS, DRAGONS, UPGRADES } from '../src/data.ts';
import { batchMarkdown, batchStats, compareMarkdown, gameStats, loadBatch } from '../src/playtest/stats.ts';

const seats = (n: number) => ({ seats: Array.from({ length: n }, (_, i) => ({ model: i ? 'haiku' : 'opus' })) });
const events = (g: Game, k: string) => g.log.filter((e) => e.ev?.k === k).map((e) => e.ev as Record<string, unknown>);

test('points rebuilt from the log equal score() at any point in a game, and the counts match the log', () => {
  // Four seeds: each a different player count, and seed 3 cut off mid-round.
  for (let seed = 1; seed <= 4; seed++) {
    const players = 2 + (seed % 4);
    const g = newGame(players, seed);
    apply(g, 0, 'say anyone want timber?');
    apply(g, 1, 'tell P1 maybe');
    const rng = { state: seed * 7 };
    const stop = seed % 3 ? Infinity : 150 + seed * 40; // some games cut off mid-round
    for (let i = 0; g.phase !== 'over' && i < Math.min(stop, 20000); i++) botStep(g, rng);
    const s = gameStats(g, seats(players), `seed ${seed}`);
    assert.deepEqual(s.check, [], `seed ${seed}`);
    assert.equal(s.points.length, g.round);
    g.players.forEach((_, p) => {
      const want = score(g, p);
      const got = s.points.at(-1)![p];
      assert.deepEqual([got.buildings, got.titles, got.beasts, got.public], [want.buildings, want.titles, want.beasts, want.public], `seed ${seed} P${p + 1}`);
    });
    const total = (c: Record<string, number[]>) => Object.values(c).flat().reduce((a, b) => a + b, 0);
    assert.equal(total(s.built), events(g, 'build').length + events(g, 'floor').length);
    assert.equal(total(s.upgraded), events(g, 'upgrade').length);
    assert.equal(total(s.played), events(g, 'play').length);
    assert.equal(total(s.hatched), events(g, 'hatch').length);
    assert.equal(s.bank.trades.reduce((a, b) => a + b, 0), events(g, 'bank').length);
    assert.equal(s.trades.accepted.reduce((a, b) => a + b, 0), 2 * events(g, 'trade').length);
    assert.deepEqual([s.talk.said[0], s.talk.told[1]], [1, 1]);
    assert.equal(s.talk.words[0], 3);
    assert.equal(s.titles.length, events(g, 'title').length);
  }
});

test('a batch reads its finished games, flags what is never used, and compares with another', () => {
  const dir = mkdtempSync(join(homedir(), '.cache', 'board-lite-test-'));
  try {
    for (let i = 1; i <= 3; i++) {
      const g = newGame(3, i);
      // The third is stalled, so it never has to finish.
      for (let n = 0; g.phase !== 'over' && n < (i === 3 ? 50 : 20000); n++) botStep(g, { state: i } as never);
      mkdirSync(join(dir, `g${i}`));
      writeFileSync(join(dir, `g${i}`, 'game.json'), JSON.stringify(g));
      writeFileSync(join(dir, `g${i}`, 'results.json'), JSON.stringify({ status: i === 3 ? 'stalled' : 'over', ...seats(3) }));
    }
    const b = batchStats(dir);
    assert.deepEqual(b.games.map((s) => s.game), ['g1', 'g2']);
    const md = batchMarkdown(b);
    assert.match(md, /match its saved end/);
    const rows = md.split('\n').filter((l) => /^\| [A-Z][^|]* \| \d+ \| \d+ \| \d+ \|/.test(l));
    assert.ok(rows.length > 40);
    for (const l of rows) {
      const [uses, games] = l.split('|').slice(2, 4).map(Number);
      // Elements are counted but never flagged.
      if (!/^\| (fire|ice|lightning|air|water) /.test(l)) assert.equal(/\*\*(never|always)\*\*/.exec(l)?.[1], uses === 0 ? 'never' : games === 2 ? 'always' : undefined, l);
    }
    assert.match(md, /### g2: \d+ rounds/);
    assert.match(compareMarkdown({ dir: 'A', games: b.games }, { dir: 'B', games: b.games.slice(1) }), /\| rounds \| [\d.]+ \| [\d.]+ \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every card seen or kept is counted under its own key (#136)', () => {
  const known = new Set([BUILDINGS, UPGRADES, ACTIONS, DRAGONS].flatMap((m) => Object.keys(m)));
  for (let seed = 1; seed <= 4; seed++) {
    const g = newGame(3, seed);
    for (let n = 0; g.phase !== 'over' && n < 20000; n++) botStep(g, { state: seed } as never);
    const s = gameStats(g, seats(3));
    assert.ok(Object.keys(s.offered).length > 5);
    for (const k of [...Object.keys(s.offered), ...Object.keys(s.kept)]) assert.ok(known.has(k), `seed ${seed}: ${k}`);
  }
});

test('stats.json saved while a batch plays gains the games that finish later, and old saves are cleaned (#136)', () => {
  const dir = mkdtempSync(join(homedir(), '.cache', 'board-lite-test-'));
  const game = (i: number, status: string) => {
    const g = newGame(3, i);
    for (let n = 0; g.phase !== 'over' && n < 20000; n++) botStep(g, { state: i } as never);
    mkdirSync(join(dir, `g${i}`), { recursive: true });
    writeFileSync(join(dir, `g${i}`, 'game.json'), JSON.stringify(g));
    writeFileSync(join(dir, `g${i}`, 'results.json'), JSON.stringify({ status, ...seats(3) }));
  };
  const saved = () => (JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')) as { game: string }[]).map((s) => s.game);
  try {
    game(1, 'over');
    game(2, 'playing');
    assert.deepEqual(loadBatch(dir).games.map((s) => s.game), ['g1']);
    assert.deepEqual(saved(), ['g1']);
    game(2, 'over');
    assert.deepEqual(loadBatch(dir).games.map((s) => s.game), ['g1', 'g2']);
    assert.deepEqual(saved(), ['g1', 'g2']);

    // A game today's rules don't count exactly is read from stats.json, the
    // others counted afresh; a key saved the old garbled way is folded in.
    const file = join(dir, 'stats.json');
    const all = JSON.parse(readFileSync(file, 'utf8'));
    all[0].offered = { port: 1, and_building_cards_port: 2 };
    writeFileSync(file, JSON.stringify(all));
    const g1 = JSON.parse(readFileSync(join(dir, 'g1', 'game.json'), 'utf8'));
    g1.round += 1; // the rebuild no longer matches the saved game
    writeFileSync(join(dir, 'g1', 'game.json'), JSON.stringify(g1));
    const b = loadBatch(dir);
    assert.deepEqual(b.games.map((s) => s.game), ['g1', 'g2']);
    assert.deepEqual(b.saved, ['g1']);
    assert.deepEqual(b.games[0].offered, { port: 3 });
    assert.match(batchMarkdown(b), /g1 read from this batch's stats.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
