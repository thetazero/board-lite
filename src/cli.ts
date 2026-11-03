#!/usr/bin/env node
// Command-line interface. Each call loads the game file, does one thing, and
// saves it, so several separate processes (one per player) can share a game.

import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { botMove, playOut } from './bot.ts';
import { RuleError, apply, newGame, pname, score, waitingOn, type Game } from './engine.ts';
import { commandHints, playerView, publicStatus } from './view.ts';

const USAGE = `board-lite: wizards raising dragons (headless rules + CLI)

  board-lite new <game.json> [--players 2-6] [--seed N]   start a game
  board-lite view <game.json> <seat> [--log N]            what that seat sees, and its options
  board-lite do <game.json> <seat> <command...>           make a decision as that seat
  board-lite wait <game.json> <seat> [--timeout SECS]     block until that seat has a decision to make
  board-lite status <game.json>                           public summary: phase, who we're waiting on
  board-lite bot <game.json> <seat>                       let a random bot make one decision for that seat
  board-lite rules                                        print the rules
  board-lite sim [--games N] [--players N] [--seed N]     bot-vs-bot games, for rough tuning stats

Seats are 1-based (1 = P1). If BOARD_LITE_SEAT is set, only that seat can be viewed or played.
See docs/cli.md for how to play.`;

function sleepMs(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10000) unlinkSync(lock); // stale lock
      } catch { /* gone already */ }
      if (Date.now() - start > 30000) throw new Error(`Timed out waiting for ${lock}`);
      sleepMs(20);
    }
  }
  try {
    return fn();
  } finally {
    try { unlinkSync(lock); } catch { /* ignore */ }
  }
}

function load(file: string): Game {
  if (!existsSync(file)) throw new Error(`No game at ${file}. Start one with: board-lite new ${file}`);
  return JSON.parse(readFileSync(file, 'utf8')) as Game;
}

function save(file: string, g: Game) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(g));
  renameSync(tmp, file);
}

function flag(args: string[], name: string, dflt: number): number {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = Number(args[i + 1]);
  args.splice(i, 2);
  if (!Number.isFinite(v)) throw new Error(`${name} needs a number`);
  return v;
}

function seatArg(g: Game, s: string | undefined): number {
  const n = Number(/^p?(\d+)$/i.exec(s ?? '')?.[1]);
  if (!(n >= 1 && n <= g.players.length)) throw new Error(`Seat must be 1..${g.players.length}`);
  const only = process.env.BOARD_LITE_SEAT;
  if (only && Number(only) !== n) throw new Error(`This shell may only act as seat ${only}.`);
  return n - 1;
}

function visibleLog(g: Game, p: number) {
  return g.log.filter((e) => !e.to || e.to.includes(p));
}

function afterMove(g: Game, p: number, before: number): string {
  const lines = visibleLog(g, p).slice(before).map((e) => `  [r${e.round}] ${e.text}`);
  const hints = commandHints(g, p);
  const tail = g.phase === 'over' ? 'The game is over.' : hints.length ? `Your options:\n${hints.map((h) => `  ${h}`).join('\n')}` : `Waiting on: ${waitingOn(g).map(pname).join(', ')}.`;
  return `${lines.join('\n')}\n${tail}`;
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const args = rest.slice();
  switch (cmd) {
    case 'new': {
      const players = flag(args, '--players', 4);
      const seed = flag(args, '--seed', Math.floor(Math.random() * 2 ** 31));
      const file = args[0];
      if (!file) throw new Error('Usage: board-lite new <game.json>');
      const g = newGame(players, seed);
      withLock(file, () => save(file, g));
      console.log(`New ${players}-player game saved to ${file} (seed ${seed}).`);
      console.log(publicStatus(g));
      return 0;
    }
    case 'view': {
      const logLines = flag(args, '--log', 25);
      const g = load(args[0]);
      console.log(playerView(g, seatArg(g, args[1]), logLines));
      return 0;
    }
    case 'status': {
      console.log(publicStatus(load(args[0])));
      return 0;
    }
    case 'do':
    case 'bot': {
      const file = args[0];
      return withLock(file, () => {
        const g = load(file);
        const p = seatArg(g, args[1]);
        const before = visibleLog(g, p).length;
        try {
          if (cmd === 'do') apply(g, p, args.slice(2).join(' '));
          else {
            if (!waitingOn(g).includes(p)) throw new RuleError(`${pname(p)} has nothing to decide right now.`);
            const rng = { state: (g.rng.state ^ 0x5bd1e995) | 0 };
            console.log(`Bot plays: ${botMove(g, p, rng)}`);
          }
        } catch (e) {
          if (e instanceof RuleError) {
            console.log(`Not allowed: ${e.message}`);
            return 1;
          }
          throw e;
        }
        save(file, g);
        console.log(afterMove(g, p, before));
        return 0;
      });
    }
    case 'wait': {
      const timeout = flag(args, '--timeout', 600);
      const file = args[0];
      const start = Date.now();
      for (;;) {
        const g = load(file);
        const p = seatArg(g, args[1]);
        if (g.phase === 'over') {
          console.log('The game is over.');
          return 0;
        }
        if (waitingOn(g).includes(p)) {
          console.log(`${pname(p)}: your decision. Run "view" to see the board.`);
          return 0;
        }
        if (Date.now() - start > timeout * 1000) {
          console.log(`Still waiting on: ${waitingOn(g).map(pname).join(', ')}.`);
          return 2;
        }
        sleepMs(250);
      }
    }
    case 'rules': {
      const here = fileURLToPath(new URL('../docs/rules.md', import.meta.url));
      console.log(readFileSync(here, 'utf8'));
      return 0;
    }
    case 'sim': {
      const games = flag(args, '--games', 50);
      const players = flag(args, '--players', 4);
      const seed = flag(args, '--seed', 1);
      const rounds: number[] = [];
      const wins = Array(players).fill(0);
      let stalled = 0;
      for (let i = 0; i < games; i++) {
        const g = newGame(players, seed + i);
        playOut(g, { state: seed * 7919 + i });
        if (g.phase !== 'over') { stalled++; continue; }
        rounds.push(g.round);
        wins[g.winner!]++;
        if (i === 0) console.log(`Game 1 final: ${g.players.map((_, p) => `${pname(p)} ${score(g, p).total}`).join(', ')}`);
      }
      rounds.sort((a, b) => a - b);
      const avg = rounds.reduce((s, r) => s + r, 0) / Math.max(1, rounds.length);
      console.log(`${games} games, ${players} players: ${rounds.length} finished, ${stalled} stalled.`);
      console.log(`Rounds: min ${rounds[0]}, median ${rounds[Math.floor(rounds.length / 2)]}, max ${rounds[rounds.length - 1]}, mean ${avg.toFixed(1)}`);
      console.log(`Wins by seat: ${wins.map((w, p) => `${pname(p)} ${w}`).join(', ')}`);
      return 0;
    }
    default:
      console.log(USAGE);
      return cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
