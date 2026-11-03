// A room: one TV, the phones that joined it by code, and (once started) the
// game. Everything a client may see goes out through snapshot(); every
// decision comes in through command(), which hands it to the engine.

import { randomBytes } from 'node:crypto';
import { botMove } from '../bot.ts';
import { RuleError, apply, newGame, waitingOn, type Game } from '../engine.ts';
import { publicState, seatState, type Lobby, type Snapshot } from '../state.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
// The design gives players 10 seconds after each combat round to choose
// whether to flee; anyone who hasn't chosen by then stays.
export const FLEE_SECONDS = 10;

export interface Seat {
  name: string;
  token: string;
  bot: boolean;
  connected: number; // open event streams
}

export class RoomError extends Error {}

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels: no accidental words
const token = () => randomBytes(12).toString('hex');

export interface RoomOptions {
  botDelayMs?: number; // pause before a bot moves, so the TV can show it
  fleeSeconds?: number;
  onChange?: (room: Room) => void;
}

export class Room {
  readonly code: string;
  readonly hostToken = token();
  seats: Seat[] = [];
  game: Game | null = null;
  fleeDeadline: number | null = null;
  private fleeTimer: NodeJS.Timeout | null = null;
  private fleeRound = 0;
  private botTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<() => void>();
  private botRng = { state: Date.now() | 0 };
  lastActive = Date.now();

  readonly opts: RoomOptions;

  constructor(code: string, opts: RoomOptions = {}) {
    this.code = code;
    this.opts = opts;
  }

  static newCode(taken: (c: string) => boolean): string {
    for (;;) {
      const c = Array.from(randomBytes(4), (b) => LETTERS[b % LETTERS.length]).join('');
      if (!taken(c)) return c;
    }
  }

  // ---- lobby ----

  join(name: string): Seat {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (!clean) throw new RoomError('Pick a name.');
    if (this.game) throw new RoomError('That game has already started.');
    if (this.seats.length >= MAX_PLAYERS) throw new RoomError(`The game is full (${MAX_PLAYERS} players).`);
    if (this.seats.some((s) => s.name.toLowerCase() === clean.toLowerCase())) throw new RoomError(`Someone is already called ${clean}.`);
    const seat: Seat = { name: clean, token: token(), bot: false, connected: 0 };
    this.seats.push(seat);
    this.changed();
    return seat;
  }

  addBot(): Seat {
    const names = ['Bot Ada', 'Bot Bram', 'Bot Cora', 'Bot Dax', 'Bot Eve', 'Bot Finn'];
    const name = names.find((n) => !this.seats.some((s) => s.name === n)) ?? `Bot ${this.seats.length + 1}`;
    const seat = this.join(name);
    seat.bot = true;
    this.changed();
    return seat;
  }

  // Before the game starts a player (or bot) can be removed from the lobby.
  leave(seatIndex: number) {
    if (this.game) throw new RoomError('The game has started.');
    if (!this.seats[seatIndex]) throw new RoomError('No such player.');
    this.seats.splice(seatIndex, 1);
    this.changed();
  }

  // The TV (host token) or the first player to join can start the game.
  canStart(tok: string): boolean {
    return tok === this.hostToken || tok === this.seats[0]?.token;
  }

  start(tok: string, seed = Date.now()) {
    if (!this.canStart(tok)) throw new RoomError('Only the TV or the first player can start the game.');
    if (this.game) throw new RoomError('The game has already started.');
    if (this.seats.length < MIN_PLAYERS) throw new RoomError(`Need at least ${MIN_PLAYERS} players.`);
    this.game = newGame(this.seats.length, seed);
    this.changed();
  }

  seatOf(tok: string): number {
    return this.seats.findIndex((s) => s.token === tok);
  }

  // ---- play ----

  command(tok: string, cmd: string) {
    const p = this.seatOf(tok);
    if (p < 0) throw new RoomError('You are not in this game.');
    this.act(p, cmd);
  }

  private act(p: number, cmd: string) {
    if (!this.game) throw new RoomError('The game has not started yet.');
    try {
      apply(this.game, p, cmd);
    } catch (e) {
      if (e instanceof RuleError) throw new RoomError(e.message);
      throw e;
    }
    this.changed();
  }

  // Called after every change: keep the flee clock and the bots going.
  private tick() {
    const g = this.game;
    if (!g) return;
    const raid = g.raid;
    const fleeOpen = g.phase === 'raid' && raid?.step === 'flee';
    if (fleeOpen && this.fleeRound !== raid!.combatRound) {
      this.clearFlee();
      this.fleeRound = raid!.combatRound;
      const ms = (this.opts.fleeSeconds ?? FLEE_SECONDS) * 1000;
      this.fleeDeadline = Date.now() + ms;
      this.fleeTimer = setTimeout(() => this.fleeTimeout(), ms);
    } else if (!fleeOpen && this.fleeDeadline !== null) {
      this.clearFlee();
      this.fleeRound = 0;
    }
    this.scheduleBot();
  }

  private clearFlee() {
    if (this.fleeTimer) clearTimeout(this.fleeTimer);
    this.fleeTimer = null;
    this.fleeDeadline = null;
  }

  private fleeTimeout() {
    this.fleeTimer = null;
    const g = this.game;
    if (!g || g.raid?.step !== 'flee') return;
    for (const p of waitingOn(g)) {
      if (g.raid?.step !== 'flee' || g.raid.combatRound !== this.fleeRound) break;
      apply(g, p, 'stay');
    }
    this.changed();
  }

  private scheduleBot() {
    const g = this.game;
    if (this.botTimer || !g || g.phase === 'over') return;
    const bots = waitingOn(g).filter((p) => this.seats[p].bot);
    if (!bots.length) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const g2 = this.game!;
      const p = waitingOn(g2).find((q) => this.seats[q].bot);
      if (p === undefined) return;
      try {
        botMove(g2, p, this.botRng);
      } catch (e) {
        console.error(`Room ${this.code}: bot ${this.seats[p].name} is stuck:`, e);
        return;
      }
      this.changed();
    }, this.opts.botDelayMs ?? 700);
  }

  // ---- what clients see ----

  lobby(): Lobby {
    return {
      code: this.code,
      started: !!this.game,
      seats: this.seats.map((s) => ({ name: s.name, bot: s.bot, connected: s.bot || s.connected > 0 })),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      fleeDeadline: this.fleeDeadline,
    };
  }

  snapshot(tok: string | null): Snapshot {
    const p = tok ? this.seatOf(tok) : -1;
    return {
      lobby: this.lobby(),
      seat: p,
      game: this.game ? publicState(this.game) : null,
      you: this.game && p >= 0 ? { ...seatState(this.game, p), name: this.seats[p].name } : null,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  connect(tok: string | null): () => void {
    const s = this.seats.find((x) => x.token === tok);
    if (!s) return () => {};
    s.connected++;
    this.changed();
    return () => {
      s.connected--;
      this.changed();
    };
  }

  changed() {
    this.lastActive = Date.now();
    this.tick();
    for (const fn of this.listeners) fn();
    this.opts.onChange?.(this);
  }

  close() {
    this.clearFlee();
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.listeners.clear();
  }
}
