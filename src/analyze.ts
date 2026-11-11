#!/usr/bin/env node
// Post-game analysis of one game: a room people played in, a saved game file,
// or one playtest game. What happened, counted from the game's log by
// src/playtest/stats.ts (no model involved): points by source round by round,
// titles, what each seat built, played and hatched, raids, fauna, trades and
// trade surplus, production each round, merchants and talk. See docs/analyze.md.
//
//   npm run analyze                       the room played in most recently
//   npm run analyze -- NKSQ               a room, by its code
//   npm run analyze -- path/to/game.json  a game file (a room's, or a saved one)
//   npm run analyze -- path/to/g3         a playtest game (its game.json and results.json)

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Game } from './engine.ts';
import { gameMarkdown, gameStats } from './playtest/stats.ts';
import { ROOMS_DIR, claudeRunners, seatsFile } from './server/room.ts';

type Res = { commit?: string; seats: { name?: string; model: string }[] };
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8'));

// The game file the argument names: a directory's game.json, a file, or a room code.
export function findGame(arg: string | undefined, rooms = ROOMS_DIR): string {
  if (!arg) {
    const games = existsSync(rooms)
      ? readdirSync(rooms).filter((f) => /^[A-Z0-9]+\.json$/.test(f)).map((f) => join(rooms, f))
      : [];
    if (!games.length) throw new Error(`No rooms in ${rooms}. Name a room code or a game file.`);
    return games.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  }
  if (existsSync(arg)) return statSync(arg).isDirectory() ? join(arg, 'game.json') : resolve(arg);
  const room = join(rooms, `${arg.toUpperCase()}.json`);
  if (existsSync(room)) return room;
  throw new Error(`No game at ${arg}, and no room ${arg.toUpperCase()} in ${rooms}.`);
}

// Who sat where: a playtest game's results.json beside it; for a room, the
// names in its seats file and the models from the Claude runners that played in it.
export function seatsOf(file: string, n: number): Res {
  const res: Res = { seats: Array.from({ length: n }, () => ({ model: '?' })) };
  const beside = join(file, '..', 'results.json');
  if (file.endsWith('game.json') && existsSync(beside)) return readJson(beside);
  try {
    readJson(seatsFile(file)).seats.forEach((s: { name?: string }, p: number) => { if (res.seats[p]) res.seats[p].name = s.name; });
  } catch { /* no seats file: a saved game on its own */ }
  for (const dir of claudeRunners(file)) {
    try {
      const r: Res = readJson(join(dir, 'results.json'));
      res.commit ??= r.commit;
      r.seats.forEach((s, p) => { if (res.seats[p] && s.model && !s.model.startsWith('player')) res.seats[p].model = s.model; });
    } catch { /* a runner that never wrote its results */ }
  }
  return res;
}

export function analyze(file: string): string {
  const g: Game = readJson(file);
  const name = file.endsWith('game.json') ? join(file, '..').split('/').pop()! : file.split('/').pop()!.replace(/\.json$/, '');
  const res = seatsOf(file, g.players.length);
  let s;
  try {
    s = gameStats(g, res, name);
  } catch (e) {
    // A game from older rules (a card or field this code no longer knows).
    throw new Error(`This code can't read ${file} (${(e as Error).message}). Run it from a checkout of the commit the game was played on${res.commit ? ` (${res.commit})` : ''}: git worktree add --detach <dir> <commit>.`);
  }
  const going = g.phase === 'over' ? '' : `**Not finished:** still going in round ${g.round}. These are the numbers so far.\n\n`;
  return `${going}${gameMarkdown(s)}\n`;
}

if (import.meta.url === `file://${resolve(process.argv[1] ?? '')}`) {
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    console.log('npm run analyze [-- ROOM | game.json | playtest game dir]   (no argument: the newest room)');
    process.exit(0);
  }
  try {
    const file = findGame(arg);
    console.error(`Analyzing ${file}`);
    process.stdout.write(analyze(file));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
