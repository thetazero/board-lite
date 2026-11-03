#!/usr/bin/env node
// Command-line interface. Each call loads the game file, does one thing, and
// saves it, so several separate processes (one per player) can share a game.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { botMove, playOut } from './bot.ts';
import { RuleError, apply, newGame, pname, score, waitingOn, type Game } from './engine.ts';
import { load, save, sleepMs, withLock } from './store.ts';
import { afterMove, playerView, publicStatus, visibleLog } from './view.ts';

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

A game hosted by the server (npm run serve; the TV shows its room URL) is played the same way, with
the room URL in place of the file and your seat token in place of the seat number:

  board-lite join <room-url> <name>                       take a seat; prints your token
  board-lite start <room-url> <token>                     start the game (first player only)
  board-lite view|do|wait <room-url> <token> ...          as above
  board-lite status <room-url>

See docs/cli.md for how to play.`;

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


const isRoom = (s: string | undefined) => /^https?:\/\//.test(s ?? '');

// Server mode: the same commands against a room on a board-lite server, through
// the same interface the phones use. The URL is http://host:port/CODE.
async function remote(cmd: string, args: string[]): Promise<number> {
  const m = /^(https?:\/\/[^/]+)\/(?:tv\?room=)?([A-Za-z]{4})\/?$/.exec(args[0]);
  if (!m) throw new Error(`A room URL looks like http://192.168.1.20:8080/ABCD (the TV shows it).`);
  const api = `${m[1]}/api/rooms/${m[2].toUpperCase()}`;
  const token = args[1] ?? '';
  const call = async (path: string, body?: object) => {
    const r = await fetch(api + path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    const type = r.headers.get('content-type') ?? '';
    const data = type.includes('json') ? ((await r.json()) as Record<string, unknown>) : { text: await r.text() };
    return { ok: r.ok, data };
  };
  const print = (r: { ok: boolean; data: Record<string, unknown> }, ok: string) => {
    if (!r.ok) {
      console.log(`Not allowed: ${r.data.error}`);
      return 1;
    }
    console.log(ok);
    return 0;
  };
  switch (cmd) {
    case 'join': {
      const r = await call('/join', { name: args.slice(1).join(' ') });
      return print(r, `You are seat ${r.data.seat}. Your token: ${r.data.token}\nUse it in place of the seat number, e.g. board-lite view ${args[0]} ${r.data.token}`);
    }
    case 'start':
      return print(await call('/start', { token }), 'The game has started.');
    case 'view': {
      const log = flag(args, '--log', 25);
      const r = await call(`/view?token=${token}&log=${log}`);
      return print(r, String(r.data.text ?? '').trimEnd());
    }
    case 'status': {
      const r = await call('/status');
      return print(r, String(r.data.text ?? '').trimEnd());
    }
    case 'do': {
      const r = await call('/do', { token, command: args.slice(2).join(' ') });
      return print(r, String(r.data.text ?? '').trimEnd());
    }
    case 'wait': {
      const timeout = flag(args, '--timeout', 600);
      const start = Date.now();
      for (;;) {
        // The server answers as soon as it's this seat's decision; ask again in chunks.
        const left = Math.max(1, Math.ceil(timeout - (Date.now() - start) / 1000));
        const r = await call(`/wait?token=${token}&timeout=${Math.min(left, 60)}`);
        if (!r.ok) return print(r, '');
        if (r.data.code !== 2 || Date.now() - start >= timeout * 1000) {
          console.log(r.data.text);
          return Number(r.data.code);
        }
      }
    }
  }
  throw new Error(`"${cmd}" doesn't work with a room URL. Try: join, start, view, do, wait, status.`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const args = rest.slice();
  if (isRoom(args[0])) return remote(cmd, args);
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

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  },
);
