#!/usr/bin/env node
// Command-line interface: a wrapper around a board-lite server's API. Every
// game lives on a server (npm run serve), in a room, and a CLI player sits at
// it like a phone: they join with a name, get a seat token, send the engine's
// commands, and see the same JSON a phone gets (src/state.ts), printed as text
// (src/view.ts) rather than drawn. `sim` alone runs locally: bot-vs-bot games
// for rough tuning stats.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playOut } from './bot.ts';
import { newGame, pname, score } from './engine.ts';
import type { Snapshot } from './state.ts';
import { afterMove, nextIndex, seatView, statusText } from './view.ts';

const USAGE = `board-lite: wizards raising dragons, at the command line

Every game is hosted by a board-lite server (npm run serve; the TV shows its room address):

  board-lite new [server-url]                             open a room with no TV; prints its address
  board-lite join <room-url> <name>                       take a seat; prints your token
  board-lite bot <room-url> <token>                       add a bot to the room (first to join only)
  board-lite start <room-url> <token>                     start the game (first to join only)
  board-lite view <room-url> <token> [--log N]            what your seat sees, and its options
  board-lite do <room-url> <token> <command...>           make a decision
  board-lite wait <room-url> <token> [--timeout SECS]     block until you have a decision to make
  board-lite status <room-url>                            public summary: phase, who we're waiting on
  board-lite rules                                        print the rules
  board-lite sim [--games N] [--players N] [--seed N]     bot-vs-bot games, run here, for rough tuning stats

A server URL looks like http://localhost:8080 (the default); a room URL like http://192.168.1.20:8080/ABCD.
See docs/cli.md for how to play.`;

function flag(args: string[], name: string, dflt: number): number {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = Number(args[i + 1]);
  args.splice(i, 2);
  if (!Number.isFinite(v)) throw new Error(`${name} needs a number`);
  return v;
}

class Refused extends Error {}

async function call(url: string, body?: object): Promise<Record<string, any>> {
  let r: Response;
  try {
    r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  } catch {
    throw new Error(`No board-lite server answers at ${new URL(url).origin}. Start one with: npm run serve`);
  }
  const data = (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as Record<string, any>) : {};
  if (!r.ok) throw new Refused(String(data.error ?? `The server answered ${r.status}.`));
  return data;
}

function roomApi(url: string | undefined): string {
  const m = /^(https?:\/\/[^/]+)\/(?:tv\?room=)?([A-Za-z]{4})\/?$/.exec(url ?? '');
  if (!m) throw new Error(`A room URL looks like http://192.168.1.20:8080/ABCD (the TV shows it).`);
  return `${m[1]}/api/rooms/${m[2].toUpperCase()}`;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const args = rest.slice();
  const [room, token = ''] = args;
  const state = async () => (await call(`${roomApi(room)}/state?token=${encodeURIComponent(token)}`)) as Snapshot;
  switch (cmd) {
    case 'new': {
      const server = (args[0] ?? 'http://localhost:8080').replace(/\/+$/, '');
      if (!/^https?:\/\/[^/]+$/.test(server)) throw new Error('A server URL looks like http://localhost:8080.');
      const r = await call(`${server}/api/rooms`, { remote: true });
      const url = `${server}/${r.code}`;
      console.log(`Room ${r.code} is open: ${url}\nTake a seat: board-lite join ${url} <name>`);
      return 0;
    }
    case 'join': {
      const r = await call(`${roomApi(room)}/join`, { name: args.slice(1).join(' '), via: 'cli' });
      console.log(`You are seat ${r.seat}. Your token: ${r.token}\nUse it after the room's address, e.g. board-lite view ${room} ${r.token}`);
      return 0;
    }
    case 'bot': {
      await call(`${roomApi(room)}/bot`, { token });
      console.log(statusText(await state()));
      return 0;
    }
    case 'start':
      await call(`${roomApi(room)}/start`, { token });
      console.log('The game has started.');
      return 0;
    case 'view': {
      const log = flag(args, '--log', 25);
      console.log(seatView(await state(), log));
      return 0;
    }
    case 'status':
      console.log(statusText((await call(`${roomApi(room)}/state`)) as Snapshot));
      return 0;
    case 'do': {
      const since = nextIndex(await state());
      const r = await call(`${roomApi(room)}/do`, { token, command: args.slice(2).join(' '), via: 'cli' });
      console.log(afterMove(r.state as Snapshot, since));
      return 0;
    }
    case 'wait': {
      const timeout = flag(args, '--timeout', 600);
      const start = Date.now();
      for (;;) {
        // The server answers as soon as it's this seat's decision; ask again in chunks.
        const left = Math.max(1, Math.ceil(timeout - (Date.now() - start) / 1000));
        const r = await call(`${roomApi(room)}/wait?token=${encodeURIComponent(token)}&timeout=${Math.min(left, 60)}`);
        if (r.code === 2 && Date.now() - start < timeout * 1000) continue;
        const s = r.state as Snapshot;
        const g = s.game;
        if (g?.phase === 'over') console.log('Game over.');
        else if (r.code === 0) console.log(`${pname(s.seat)}: your decision. Run "view" to see the board.`);
        else console.log(g ? `Waiting for ${g.waitingOn.map(pname).join(', ')}.` : "The game hasn't started.");
        return Number(r.code);
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
    if (e instanceof Refused) {
      console.log(`Not allowed: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    console.error((e as Error).message);
    process.exitCode = 1;
  },
);
