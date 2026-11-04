// A room: one game hosted by the server, and the players seated at it. Every
// client uses the same interface: phones, the TV and the CLI (people or
// Claude playtest seats) all join with a name, get a seat token, and send the
// engine's commands through the room; every change is pushed to whoever is
// watching. The game is saved to a file after each change (the same format
// the CLI's file mode uses), so a server restart or a CLI look loses nothing.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { botMove, standInMove } from '../bot.ts';
import { BEASTS } from '../data.ts';
import { RuleError, apply, newGame, waitingOn, type Game } from '../engine.ts';
import { publicState, seatState, type Lobby, type SeatKind, type Snapshot } from '../state.ts';
import { afterMove, playerView, publicStatus, seatStatus, visibleLog } from '../view.ts';
import { load, save, withLock } from '../store.ts';
import { scenesMs, scenesOf } from '../../web/scenes.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const ROOMS_DIR = join(homedir(), '.cache', 'board-lite', 'rooms');

export interface Seat {
  name: string;
  token: string;
  kind: SeatKind; // player: someone holds the token (phone or CLI); bot: the server plays it; open: nobody yet (claim by joining)
  connected: number; // open event streams
  seen: number; // last request from this seat (ms epoch); the CLI doesn't hold a stream
  // Mid-game, a bot makes this player's moves (as little as it can: bot.ts
  // standInMove) when they quit, or when someone at the table asks it to
  // because the table is waiting on them and they're away. Their own phone
  // coming back hands the seat back; after quitting, they (or anyone) take it
  // back by joining with its name.
  standIn: boolean;
  left: boolean; // quit: no phone holds the seat any more
}

export class RoomError extends Error {}

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels: no accidental words
const token = () => randomBytes(12).toString('hex');

export interface RoomOptions {
  file?: string; // the game file; defaults to <dir>/<code>.json
  dir?: string; // defaults to ROOMS_DIR
  botDelayMs?: number; // pause before a bot moves, so the TV can show it
}

export class Room {
  readonly code: string;
  readonly file: string;
  readonly hostToken = token();
  readonly opts: RoomOptions;
  seats: Seat[] = [];
  lastActive = Date.now();
  private cached: Game | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<() => void>();
  private botRng = { state: Date.now() | 0 };
  // While a TV is watching, a change that gives it a scene to play (a fight,
  // a round's production roll) holds everyone's next decision until the scene
  // is over: phones show "Look at the TV", bots and CLI players wait. Without
  // a TV there are no scenes and nothing waits.
  private screens = 0; // open event streams with no seat: TVs
  private sceneUntil = 0; // ms epoch
  private sceneTimer: NodeJS.Timeout | null = null;

  constructor(code: string, opts: RoomOptions = {}) {
    this.code = code;
    this.opts = opts;
    this.file = opts.file ?? join(opts.dir ?? ROOMS_DIR, `${code}.json`);
    mkdirSync(dirname(this.file), { recursive: true });
    // Hosting a saved game (from the CLI's file mode, or before a restart):
    // every seat starts open, and players claim them by joining.
    if (existsSync(this.file)) {
      this.cached = load(this.file);
      this.seats = this.cached.players.map((_, p) => ({ name: `P${p + 1}`, token: token(), kind: 'open', connected: 0, seen: 0, standIn: false, left: false }));
    }
  }

  static newCode(taken: (c: string) => boolean, dir = ROOMS_DIR): string {
    for (;;) {
      const c = Array.from(randomBytes(4), (b) => LETTERS[b % LETTERS.length]).join('');
      if (!taken(c) && !existsSync(join(dir, `${c}.json`))) return c;
    }
  }

  get game(): Game | null {
    return this.cached;
  }

  // The only way the room changes the game: through the engine, then saved.
  mutate(fn: (g: Game) => void) {
    const g = this.cached;
    if (!g) throw new RoomError('The game has not started yet.');
    const before = g.log.length;
    fn(g); // apply() leaves the game untouched when it refuses a command
    withLock(this.file, () => save(this.file, g));
    this.holdForScenes(g.log.slice(before).filter((e) => !e.to));
    this.changed();
  }

  private holdForScenes(events: Game['log']) {
    const ms = this.screens > 0 ? scenesMs(scenesOf(events, (k) => k in BEASTS)) : 0;
    if (!ms) return;
    this.sceneUntil = Math.max(Date.now(), this.sceneUntil) + ms;
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = null;
      this.changed();
    }, this.sceneUntil - Date.now());
  }

  // How much longer the TV's scene runs (ms); 0 when there's none.
  sceneLeft(): number {
    return Math.max(0, this.sceneUntil - Date.now());
  }

  // ---- lobby ----

  private cleanName(name: string): string {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (!clean) throw new RoomError('Pick a name.');
    if (this.seats.some((s) => s.kind !== 'open' && s.name.toLowerCase() === clean.toLowerCase())) throw new RoomError(`Someone is already called ${clean}.`);
    return clean;
  }

  // Someone is at this seat: a bot, a phone holding its stream open, or a CLI
  // or Claude player that asked something in the last minute.
  here(s: Seat): boolean {
    return s.kind === 'bot' || (!s.left && (s.connected > 0 || Date.now() - s.seen < 60000));
  }

  // Before the game, joining adds a seat. Once it's running, joining with the
  // name of a seat nobody is at takes it back (a player on a new phone, or
  // after quitting, or someone taking over for a player who left); any other
  // name takes an open seat (one nobody holds, in a saved game hosted again).
  join(name: string, kind: SeatKind = 'player'): Seat {
    if (this.game) {
      const typed = name.replace(/\s+/g, ' ').trim().toLowerCase();
      const own = this.seats.find((s) => s.kind === 'player' && s.name.toLowerCase() === typed);
      if (own && kind === 'player') {
        if (this.here(own)) throw new RoomError(`${own.name} is playing on another phone.`);
        Object.assign(own, { token: token(), standIn: false, left: false, seen: Date.now() });
        this.changed();
        return own;
      }
      const clean = this.cleanName(name);
      const open = this.seats.find((s) => s.kind === 'open');
      if (!open || kind !== 'player') throw new RoomError('That game has already started and every seat is taken.');
      open.name = clean;
      open.kind = 'player';
      open.token = token();
      this.changed();
      return open;
    }
    const clean = this.cleanName(name);
    if (this.seats.length >= MAX_PLAYERS) throw new RoomError(`The game is full (${MAX_PLAYERS} players).`);
    const seat: Seat = { name: clean, token: token(), kind, connected: 0, seen: Date.now(), standIn: false, left: false };
    this.seats.push(seat);
    this.changed();
    return seat;
  }

  addBot(): Seat {
    // Clockwork names, so a bot never shares a name with a person at the table.
    const names = ['Tick', 'Gizmo', 'Widget', 'Pinion', 'Cog', 'Ratchet', 'Bolt'];
    const taken = (n: string) => this.seats.some((s) => s.kind !== 'open' && s.name.toLowerCase() === n.toLowerCase());
    return this.join(names.find((n) => !taken(n)) ?? `Cog ${this.seats.length + 1}`, 'bot');
  }

  // Before the game starts a player (or bot) can be removed from the lobby.
  leave(seatIndex: number) {
    if (this.game) throw new RoomError('The game has started.');
    if (!this.seats[seatIndex]) throw new RoomError('No such player.');
    this.seats.splice(seatIndex, 1);
    this.changed();
  }

  // Mid-game, a player quits: a bot makes their moves from now on, and their
  // phone no longer holds the seat.
  quit(tok: string) {
    const p = this.playerSeat(tok);
    if (!this.game) return this.leave(p);
    if (this.game.phase === 'over') throw new RoomError('The game is over.');
    Object.assign(this.seats[p], { token: token(), standIn: true, left: true });
    this.changed();
  }

  // Anyone at the table lets a bot play for a player who is away.
  standInFor(tok: string, seat: number) {
    this.playerSeat(tok);
    const s = this.seats[seat];
    if (!this.game || this.game.phase === 'over') throw new RoomError('The game is not running.');
    if (!s || s.kind !== 'player') throw new RoomError('No such player.');
    if (s.standIn) return;
    if (this.here(s)) throw new RoomError(`${s.name} is back.`);
    s.standIn = true;
    this.changed();
  }

  // The TV (host token) or the first player to join can start the game.
  canStart(tok: string): boolean {
    return tok === this.hostToken || (tok === this.seats[0]?.token && this.seats[0].kind === 'player');
  }

  start(tok: string, seed = Date.now()) {
    if (!this.canStart(tok)) throw new RoomError('Only the TV or the first player can start the game.');
    if (this.game) throw new RoomError('The game has already started.');
    if (this.seats.length < MIN_PLAYERS) throw new RoomError(`Need at least ${MIN_PLAYERS} players.`);
    if (existsSync(this.file)) throw new RoomError(`A game already exists at ${this.file}.`);
    this.cached = newGame(this.seats.length, seed);
    withLock(this.file, () => save(this.file, this.cached!));
    this.changed();
  }

  seatOf(tok: string): number {
    const i = this.seats.findIndex((s) => s.token === tok);
    if (i >= 0) this.seats[i].seen = Date.now();
    return i;
  }

  // ---- play ----

  // A player's command. Returns what that player saw happen and their next
  // options, as text (what the CLI prints; phones ignore it).
  command(tok: string, cmd: string): string {
    const p = this.playerSeat(tok);
    const before = this.game ? visibleLog(this.game, p).length : 0;
    this.act(p, cmd);
    return afterMove(this.game!, p, before);
  }

  private playerSeat(tok: string): number {
    const p = this.seatOf(tok);
    if (p < 0 || this.seats[p].kind !== 'player') throw new RoomError('You are not in this game.');
    this.back(this.seats[p]);
    return p;
  }

  // A CLI or Claude player waiting on the table (wait, listen) is at their seat
  // as much as a phone holding its stream open. Returns the hand-back.
  private holding(p: number): () => void {
    const s = this.seats[p];
    s.connected++;
    return () => {
      s.connected--;
      s.seen = Date.now();
    };
  }

  // A player a bot was playing for while they were away is back.
  private back(s: Seat) {
    if (!s.standIn || s.left) return;
    s.standIn = false;
    this.changed();
  }

  // ---- the same game as text, for players at the command line ----

  viewText(tok: string, logLines = 25): string {
    const p = this.playerSeat(tok);
    if (!this.game) return `You are seat ${p + 1} (${this.seats[p].name}) in room ${this.code}. The game hasn't started.\n${this.statusText()}`;
    return `${this.tableLine(p)}\n${playerView(this.game, p, logLines)}`;
  }

  // Who sits where: the engine calls players P1, P2...; people know each other by name.
  tableLine(p = -1): string {
    const who = this.seats.map((s, i) => `P${i + 1} ${s.name}${i === p ? ' (you)' : s.kind === 'bot' ? ' (bot)' : s.kind === 'open' ? ' (open seat)' : ''}`);
    return `Table: ${who.join(', ')}.`;
  }

  statusText(): string {
    const names = this.seats.map((s, i) => `P${i + 1} ${s.name}${s.kind === 'bot' ? ' (bot)' : s.kind === 'open' ? ' (open seat)' : ''}`).join(', ');
    if (!this.game) return `Room ${this.code}, in the lobby: ${names || 'nobody yet'}. ${MIN_PLAYERS} to ${MAX_PLAYERS} players; the TV or the first player starts.`;
    return `Room ${this.code}: ${names}.\n${publicStatus(this.game)}`;
  }

  // Resolves when this seat has a decision to make, the game ends, or time runs out.
  wait(tok: string, timeoutMs: number): Promise<{ text: string; code: number }> {
    const p = this.playerSeat(tok);
    const left = this.holding(p);
    return new Promise((done) => {
      const check = (): boolean => {
        const g = this.game;
        if (g?.phase === 'over') return finish('The game is over.', 0);
        if (g && waitingOn(g).includes(p) && !this.sceneLeft()) return finish(`P${p + 1}: your decision. Run "view" to see the board.`, 0);
        return false;
      };
      const finish = (text: string, code: number) => {
        clearTimeout(timer);
        unsubscribe();
        left();
        done({ text, code });
        return true;
      };
      const timer = setTimeout(() => finish(this.game ? `Still waiting on: ${waitingOn(this.game).map((q) => `P${q + 1}`).join(', ')}.` : 'The game has not started yet.', 2), timeoutMs);
      const unsubscribe = this.subscribe(() => void check());
      check();
    });
  }

  // For a player who follows the game as it goes (a Claude seat's tool server):
  // the events this seat can see from index `since` of its visible log, and its
  // status. With a timeout it waits until it's this seat's decision, someone
  // else talks, the game ends, or time runs out. On its own turn with an offer
  // out, it waits for an answer rather than returning at once.
  listen(tok: string, since: number, timeoutMs: number): Promise<{ events: string[]; next: number; status: string }> {
    const p = this.playerSeat(tok);
    const result = () => {
      const g = this.game;
      if (!g) return { events: [], next: 0, status: `The game hasn't started yet. ${this.tableLine(p)}` };
      const v = visibleLog(g, p);
      return { events: v.slice(since).map((e) => `[r${e.round}] ${e.text}`), next: v.length, status: seatStatus(g, p) };
    };
    const ready = (): boolean => {
      const g = this.game;
      if (!g) return false;
      if (g.phase === 'over') return true;
      const others = visibleLog(g, p).slice(since).filter((e) => !e.text.startsWith(`P${p + 1} `));
      if (others.some((e) => / says: "| \(private\): "/.test(e.text))) return true;
      const awaitingAnswer = g.phase === 'action' && g.turn === p && g.offers.some((o) => o.from === p) && !others.length;
      return waitingOn(g).includes(p) && !awaitingAnswer && !this.sceneLeft();
    };
    if (timeoutMs <= 0 || ready()) return Promise.resolve(result());
    const left = this.holding(p);
    return new Promise((done) => {
      const finish = () => {
        clearTimeout(timer);
        unsubscribe();
        left();
        done(result());
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsubscribe = this.subscribe(() => {
        if (ready()) finish();
      });
    });
  }

  private act(p: number, cmd: string) {
    if (!this.game) throw new RoomError('The game has not started yet.');
    try {
      this.mutate((g) => apply(g, p, cmd));
    } catch (e) {
      if (e instanceof RuleError) throw new RoomError(e.message);
      throw e;
    }
  }

  // Called after every change: keep the bots going.
  private tick() {
    this.scheduleBot();
  }

  private scheduleBot() {
    const g = this.game;
    if (this.botTimer || !g || g.phase === 'over' || this.sceneLeft()) return;
    const botPlays = (p: number) => this.seats[p]?.kind === 'bot' || !!this.seats[p]?.standIn;
    if (!waitingOn(g).some(botPlays)) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        this.mutate((g2) => {
          const p = waitingOn(g2).find(botPlays);
          if (p === undefined) return;
          if (this.seats[p].kind === 'bot') botMove(g2, p, this.botRng);
          else standInMove(g2, p);
        });
      } catch (e) {
        console.error(`Room ${this.code}: a bot is stuck:`, e);
      }
    }, this.opts.botDelayMs ?? 700);
  }

  // ---- what clients see ----

  lobby(): Lobby {
    return {
      code: this.code,
      started: !!this.game,
      // Phones hold a stream open; a CLI player counts as here if it asked anything in the last minute.
      seats: this.seats.map((s) => ({ name: s.name, kind: s.kind, connected: this.here(s), standIn: s.standIn, left: s.left })),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      file: this.file,
    };
  }

  snapshot(tok: string | null): Snapshot {
    const p = tok ? this.seatOf(tok) : -1;
    const g = this.game;
    return {
      lobby: this.lobby(),
      seat: p,
      game: g ? publicState(g) : null,
      scene: this.sceneLeft(),
      you: g && p >= 0 && this.seats[p].kind === 'player' ? { ...seatState(g, p), name: this.seats[p].name } : null,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  connect(tok: string | null): () => void {
    if (tok === null) {
      this.screens++;
      return () => void this.screens--;
    }
    const s = this.seats.find((x) => x.token === tok);
    if (!s) return () => {};
    s.connected++;
    this.back(s);
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
  }

  close() {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    this.botTimer = this.sceneTimer = null;
    this.listeners.clear();
  }
}
