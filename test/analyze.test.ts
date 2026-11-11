import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyze, findGame } from '../src/analyze.ts';
import { botStep, playToEnd } from '../src/bot.ts';
import { newGame } from '../src/engine.ts';

test('analyze finds a room by code, a game file or a playtest game, and names its seats (#475)', () => {
  const dir = mkdtempSync(join(homedir(), '.cache', 'board-lite-test-'));
  try {
    const g = newGame(3, 7);
    const rng = { state: 7 };
    playToEnd(g, () => botStep(g, rng));
    // A room: its game file, the people in its seats file, and a Claude runner's models.
    const rooms = join(dir, 'rooms'), runner = join(dir, 'runner');
    mkdirSync(rooms); mkdirSync(runner);
    writeFileSync(join(rooms, 'ABCD.json'), JSON.stringify(g));
    writeFileSync(join(rooms, 'ABCD.seats.json'), JSON.stringify({ seats: [{ name: 'Losha' }, { name: 'Rowan' }, { name: 'Quinn' }] }));
    writeFileSync(join(rooms, 'ABCD.claude.json'), JSON.stringify({ runners: [runner] }));
    writeFileSync(join(runner, 'results.json'), JSON.stringify({ commit: 'abc1234', seats: [{ model: 'player: Losha' }, { model: 'haiku' }, { model: 'opus' }] }));
    const file = findGame('abcd', rooms);
    assert.equal(file, join(rooms, 'ABCD.json'));
    assert.equal(findGame(undefined, rooms), file);
    const md = analyze(file);
    assert.match(md, /### ABCD: \d+ rounds/);
    assert.match(md, /\| P1 Losha \| [+−]?\d+ \(\d+\) \| [+−]?\d+ \(\d+\) \|/);
    assert.match(md, /\| P2 Rowan \(haiku\) \|/);
    assert.match(md, /Basic resources made in production each round/);
    // A playtest game: its directory, with results.json beside game.json.
    const pg = join(dir, 'g1');
    mkdirSync(pg);
    writeFileSync(join(pg, 'game.json'), JSON.stringify(g));
    writeFileSync(join(pg, 'results.json'), JSON.stringify({ seats: [{ model: 'opus' }, { model: 'haiku' }, { model: 'haiku' }] }));
    assert.match(analyze(findGame(pg, rooms)), /### g1: .*\n[^]*\| P3 haiku \| [+−]?\d+ \(/);
    assert.throws(() => findGame('ZZZZ', rooms), /no room ZZZZ/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
