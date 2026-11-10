// The game log, for development: a timestamped record of everything that
// happens in a room, to analyze games in a time-aware way later (#426). It's
// one JSON object per line in <game>.log.jsonl, beside the game file, and
// only ever appended to. Players never see it.
//
// Every line has the time (`t`, ISO; `ms`, ms epoch), who sent it (`by`) and
// what it is (`type`):
//   event      an entry of the game's own log: `i` is its index there, plus
//              its round, text, ev, and `to` and `dice` when it has them.
//              `command` is the command behind it. An entry the game makes on
//              its own (dice, a new round, a fight, a title) is by the game,
//              and `cause` says whose command set it off.
//   refused    a command the engine turned down: `command` and `error`.
//   start      the game began: `seed`.
//   load       a game file already on disk was hosted (a restart, or a saved
//              game): `entries` is how long its log was then. Entries before
//              that have no time: they're from before the server read the file,
//              or from before this log existed.
//   join, leave, bot, handover, quit, standIn, back, connect, disconnect,
//   save, continue
//              who sits where and who's here (see Room).
// A line also has `seat` (an index into the room's seats) when it's about one.

import { appendFileSync } from 'node:fs';
import type { GameEvent, LogEntry } from '../engine.ts';

// Who sent something: a person through a client, a Claude player, a bot, the
// TV, or the game itself. `seat` and `name` say whose seat it was.
export type Sender =
  | { kind: 'phone' | 'cli' | 'claude' | 'player'; seat: number; name: string } // player: a client that didn't say which it is
  | { kind: 'bot' | 'standIn'; seat: number; name: string } // standIn: a bot playing for a person who's away or quit
  | { kind: 'tv' }
  | { kind: 'game' }; // the game or the server on its own: dice, new rounds, fights, loading a file

export type Via = 'phone' | 'cli' | 'claude';
export const VIAS: readonly string[] = ['phone', 'cli', 'claude'] satisfies Via[];

export const GAME: Sender = { kind: 'game' };

/** Where a game file's log goes. */
export const gameLogFile = (gameFile: string) => `${gameFile.replace(/\.json$/, '')}.log.jsonl`;

// What the game does on its own, rather than the player whose command it
// followed: the dice, a new round, a raid's steps and fights, titles.
const AUTO = new Set<GameEvent['k']>(['round', 'produce', 'rest', 'grow', 'tend', 'draw', 'pick', 'turn', 'wander', 'expire', 'title', 'raid', 'votes', 'target', 'locked', 'fight', 'combat', 'raidEnd', 'noRaid', 'again', 'begin', 'final']);

export class GameLog {
  readonly file: string;
  private broken = false;

  constructor(gameFile: string) {
    this.file = gameLogFile(gameFile);
  }

  write(type: string, by: Sender, fields: Record<string, unknown> = {}) {
    if (this.broken) return;
    const ms = Date.now();
    try {
      appendFileSync(this.file, `${JSON.stringify({ t: new Date(ms).toISOString(), ms, type, by, ...fields })}\n`);
    } catch (e) {
      this.broken = true; // say so once, and never stop a game over it
      console.error(`Could not write the game log ${this.file}:`, e);
    }
  }

  /** The game's log entries from index `from` on, sent by `by` (with `command`, when a command made them). */
  events(entries: LogEntry[], from: number, by: Sender, command?: string) {
    for (let i = from; i < entries.length; i++) {
      const { round, text, ev, to, dice } = entries[i];
      const auto = by.kind !== 'game' && !!ev && AUTO.has(ev.k);
      this.write('event', auto ? GAME : by, {
        i, round, text, ev,
        ...(to ? { to } : {}),
        ...(dice ? { dice } : {}),
        ...(command !== undefined ? { command } : {}),
        ...(auto ? { cause: by } : {}),
      });
    }
  }
}
