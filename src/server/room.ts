// A room: one game hosted by the server, and the players seated at it. Every
// client uses the same interface: phones, the TV and the CLI (people or
// Claude playtest seats) all join with a name, get a seat token, and send the
// engine's commands through the room; every change is pushed to whoever is
// watching. Every client gets the same JSON (src/state.ts) and shows it its own
// way: the server builds no text. The game is saved to a file after each change,
// so a server restart loses nothing.
// Who sits where is saved beside it (<game>.seats.json: the code, the TV's and
// each seat's token), so after a restart the room comes back under its own
// code and every phone, the TV and each CLI player reconnect to their own seat.
// Someone at the table can save the game partway through (Room.save): it stops
// for everyone, the server keeps it however long it waits, and anyone at the
// table picks it up again with Continue, Claude players included
// (<game>.claude.json says which runners to bring back: src/playtest/run.ts).

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { botMove, standInMove } from '../bot.ts';
import { RuleError, apply, newGame, waitingOn, type Game } from '../engine.ts';
import { buildRecap } from '../recap.ts';
import { publicState, seatState, visibleEvents, type EventView, type Lobby, type SeatKind, type Snapshot } from '../state.ts';
import { load, save, withLock } from '../store.ts';
import { scenesMs, scenesOf } from '../../web/scenes.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const AWAY_MS = 60000; // a seat with no phone or CLI request for this long is away
// The table plays with a TV while a TV page watches the room, and goes on
// without one once the last TV has been gone this long: long enough for a TV
// to reload or ride out a network blip without the phones switching back and forth.
export const TV_GONE_MS = 20000;
export const ROOMS_DIR = join(homedir(), '.cache', 'board-lite', 'rooms');
// Each finished game's recap (src/recap.ts), kept after its room is gone so
// its link still opens. The file name is the recap's id.
export const RECAPS_DIR = join(homedir(), '.cache', 'board-lite', 'recaps');

/** Where recaps go: beside the rooms when they have their own folder (tests), else RECAPS_DIR. */
export const recapsDir = (opts: { dir?: string; recaps?: string }) => opts.recaps ?? (opts.dir ? join(opts.dir, 'recaps') : RECAPS_DIR);

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

// A name as the table shows it: spaces collapsed, no control or invisible
// characters (zero-width spaces, blank fillers), at most 12 characters. A
// joiner inside an emoji stays.
function tidyName(name: string): string {
  const clean = name
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]/gu, (c) => (c === '\u200D' ? c : ''))
    .replace(/ +/g, ' ')
    .trim();
  return Array.from(clean).slice(0, 12).join('').trim();
}

export class RoomError extends Error {}

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels: no accidental words
const token = () => randomBytes(12).toString('hex');
const MAX_TIMEOUT_MS = 2 ** 31 - 1; // the longest delay setTimeout keeps

export interface RoomOptions {
  file?: string; // the game file; defaults to <dir>/<code>.json
  dir?: string; // defaults to ROOMS_DIR
  botDelayMs?: number; // pause before a bot moves, so the TV can show it
  awayMs?: number; // defaults to AWAY_MS (tests shorten it)
  remote?: boolean; // made with no TV (from a phone or the CLI); whether there's a TV changes as TVs come and go (Room.hasTv)
  tvGoneMs?: number; // defaults to TV_GONE_MS (tests shorten it)
  recaps?: string; // where finished games' recaps go (recapsDir)
  now?: () => number; // the clock a recap is dated by (the screenshots fix it)
  recapId?: string; // and its id (the screenshots fix it too, so the QR code is the same each run)
  firstSeat?: number; // who goes first in round 1; random by default (tests fix it)
}

// What the seats file keeps: enough for every client to reconnect as before.
interface SavedRoom {
  code: string;
  hostToken: string;
  remote: boolean; // no TV, when last saved
  savedAt?: number; // the game was saved partway through then (ms epoch), to continue later
  seats: Pick<Seat, 'name' | 'token' | 'kind' | 'standIn' | 'left'>[];
}

/** Where a game file's seats are saved. */
export const seatsFile = (gameFile: string) => `${gameFile.replace(/\.json$/, '')}.seats.json`;

/** Where a game file's Claude runners are listed: their --out directories, to bring back when a saved game continues. */
export const claudeFile = (gameFile: string) => `${gameFile.replace(/\.json$/, '')}.claude.json`;

/** The --out directories of the Claude runners that have played in this game (src/playtest/run.ts writes them). */
export function claudeRunners(gameFile: string): string[] {
  try {
    const v = JSON.parse(readFileSync(claudeFile(gameFile), 'utf8'));
    return Array.isArray(v?.runners) ? v.runners.filter((d: unknown): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/** A Claude runner playing in this game, so continuing a saved game brings its players back. */
export function addClaudeRunner(gameFile: string, dir: string) {
  const runners = claudeRunners(gameFile);
  if (!runners.includes(dir)) writeFileSync(claudeFile(gameFile), `${JSON.stringify({ runners: [...runners, dir] }, null, 2)}\n`);
}

function readSaved(file: string): SavedRoom | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return typeof v?.code === 'string' && typeof v?.hostToken === 'string' && Array.isArray(v?.seats) ? v : null;
  } catch {
    return null;
  }
}

export class Room {
  readonly code: string;
  readonly file: string;
  readonly hostToken: string;
  readonly opts: RoomOptions;
  seats: Seat[] = [];
  lastActive = Date.now();
  // When someone at the table saved the game (ms epoch), until someone
  // continues it: nothing moves, and the server keeps the room for good.
  savedAt: number | null = null;
  private cached: Game | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private awayTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<() => void>();
  private botRng = { state: Date.now() | 0 };
  private savedSeats = '';
  // While a TV is watching, a change that gives it a scene to play (a fight,
  // a round's production roll) holds everyone's next decision until the scene
  // is over: phones show "Look at the TV", bots and CLI players wait. Without
  // a TV there are no scenes and nothing waits.
  private screens = 0; // open event streams with no seat: TVs
  private sceneUntil = 0; // ms epoch
  private sceneTimer: NodeJS.Timeout | null = null;
  // Whether the table plays with a TV: with one, scenes play on it and phones
  // say to watch it; without, each phone shows the table itself. A TV page
  // opening the room turns it on, whenever that is (lobby or mid-game); the
  // last TV staying gone for TV_GONE_MS turns it off. The room's other
  // screens (a phone's table view, the screenshots) don't count.
  private tvs = 0; // open event streams from TV pages
  private hasTv: boolean;
  private tvTimer: NodeJS.Timeout | null = null;

  constructor(code: string, opts: RoomOptions = {}) {
    this.code = code;
    this.file = opts.file ?? join(opts.dir ?? ROOMS_DIR, `${code}.json`);
    mkdirSync(dirname(this.file), { recursive: true });
    // Hosted again after a restart: the same TV, the same players in the same seats.
    const saved = readSaved(seatsFile(this.file));
    this.hostToken = saved?.hostToken ?? token();
    this.opts = opts;
    this.hasTv = saved ? !saved.remote : !opts.remote;
    if (saved) this.seats = saved.seats.map((s) => ({ ...s, connected: 0, seen: 0 }));
    this.savedAt = saved?.savedAt ?? null;
    if (existsSync(this.file)) {
      this.cached = load(this.file);
      // A saved game with no seats file: every seat starts open, and players
      // claim them by joining.
      if (this.seats.length !== this.cached.players.length) {
        this.seats = this.cached.players.map((_, p) => ({ name: `P${p + 1}`, token: token(), kind: 'open', connected: 0, seen: 0, standIn: false, left: false }));
      }
    }
    this.saveSeats();
    // Hosted again with a TV: it has a while to reconnect, like any TV that goes away.
    if (saved && this.hasTv) this.tvGone();
  }

  /** The code a game file was hosted under before, if its seats were saved. */
  static savedCode(gameFile: string): string | null {
    return readSaved(seatsFile(gameFile))?.code ?? null;
  }

  /** Rooms saved in `dir` and active in the last `withinMs`, and every saved game however old: their codes and game files, to host again after a restart. */
  static saved(dir = ROOMS_DIR, withinMs = Infinity): { code: string; file: string }[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names.filter((n) => n.endsWith('.seats.json')).flatMap((n) => {
      const path = join(dir, n);
      const file = join(dir, `${n.slice(0, -'.seats.json'.length)}.json`);
      const saved = readSaved(path);
      const touched = Math.max(statSync(path).mtimeMs, existsSync(file) ? statSync(file).mtimeMs : 0);
      if (!saved || (!saved.savedAt && Date.now() - touched > withinMs)) return [];
      return [{ code: saved.code, file }];
    });
  }

  private saveSeats() {
    const saved: SavedRoom = { code: this.code, hostToken: this.hostToken, remote: !this.hasTv, ...(this.savedAt ? { savedAt: this.savedAt } : {}), seats: this.seats.map(({ name, token, kind, standIn, left }) => ({ name, token, kind, standIn, left })) };
    const text = JSON.stringify(saved);
    if (text === this.savedSeats) return;
    this.savedSeats = text;
    save(seatsFile(this.file), saved);
  }

  static newCode(taken: (c: string) => boolean, dir = ROOMS_DIR): string {
    for (;;) {
      const c = Array.from(randomBytes(4), (b) => LETTERS[b % LETTERS.length]).join('');
      if (!taken(c) && !existsSync(join(dir, `${c}.json`)) && !existsSync(join(dir, `${c}.seats.json`))) return c;
    }
  }

  get game(): Game | null {
    return this.cached;
  }

  // The recap's id: from the room's secret host token, so it's the same after
  // a restart, a new room's is new, and no one can guess another game's.
  get recapId(): string {
    return this.opts.recapId ?? createHash('sha256').update(`recap:${this.hostToken}`).digest('hex').slice(0, 12);
  }

  get recapFile(): string {
    return join(recapsDir(this.opts), `${this.recapId}.json`);
  }

  // Once the game is over, its recap is written (once).
  private saveRecap() {
    const g = this.cached;
    if (g?.phase !== 'over' || existsSync(this.recapFile)) return;
    try {
      mkdirSync(recapsDir(this.opts), { recursive: true });
      save(this.recapFile, buildRecap(g, this.seats.map((s) => s.name), this.recapId, new Date(this.opts.now?.() ?? Date.now())));
    } catch (e) {
      console.error(`Room ${this.code}: could not save the recap:`, e);
    }
  }

  // The only way the room changes the game: through the engine, then saved.
  mutate(fn: (g: Game) => void) {
    const g = this.cached;
    if (!g) throw new RoomError("The game hasn't started.");
    const before = g.log.length;
    fn(g); // apply() leaves the game untouched when it refuses a command
    withLock(this.file, () => save(this.file, g));
    this.holdForScenes(g.log.slice(before).filter((e) => !e.to));
    this.changed();
  }

  private holdForScenes(events: Game['log']) {
    const ms = this.screens > 0 ? scenesMs(scenesOf(events)) : 0;
    if (!ms) return;
    this.sceneUntil = Math.max(Date.now(), this.sceneUntil) + ms;
    this.wakeAfterScene();
  }

  // Once the scene is over, wake everyone it held (bots, CLI players, phones).
  // Node's timers keep their own clock, so one can fire a moment before
  // Date.now() says the scene is over (or the wall clock can step back): then
  // it sets itself again rather than waking no one, which would leave a bot's
  // turn waiting for good.
  private wakeAfterScene() {
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = null;
      if (this.sceneLeft()) this.wakeAfterScene();
      else this.changed();
    }, this.sceneLeft() + 1);
  }

  // How much longer the TV's scene runs (ms); 0 when there's none.
  sceneLeft(): number {
    return Math.max(0, this.sceneUntil - Date.now());
  }

  // ---- lobby ----

  private cleanName(name: string): string {
    const clean = tidyName(name);
    if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(clean)) throw new RoomError('Choose a name.');
    if (this.seats.some((s) => s.kind !== 'open' && s.name.toLowerCase() === clean.toLowerCase())) throw new RoomError(`Someone is already called ${clean}: choose another name.`);
    return clean;
  }

  // Someone is at this seat: a bot, a phone holding its stream open, or a CLI
  // or Claude player that asked something in the last minute.
  here(s: Seat): boolean {
    return s.kind === 'bot' || (!s.left && (s.connected > 0 || Date.now() - s.seen < this.awayMs));
  }

  // Every player has quit: only bots are left, so the game stops (no one would
  // ever score) and the server forgets the room once no one has come back.
  private get awayMs(): number {
    return this.opts.awayMs ?? AWAY_MS;
  }

  get abandoned(): boolean {
    const people = this.seats.filter((s) => s.kind === 'player');
    return !!this.game && people.length > 0 && people.every((s) => s.left);
  }

  // A saved game hosted again with seats nobody holds yet: the table is back
  // in the lobby, and the game waits (no one moves, bots included) until
  // every seat is taken, by a player or a bot.
  get seating(): boolean {
    return !!this.game && this.seats.some((s) => s.kind === 'open');
  }

  // Before the game, joining adds a seat. Once it's running, joining with the
  // name of a seat nobody is at takes it back (a player on a new phone, or
  // after quitting, or someone taking over for a player who left); any other
  // name, or a bot, takes an open seat (in a saved game hosted again).
  join(name: string, kind: SeatKind = 'player'): Seat {
    if (this.game) {
      const typed = tidyName(name).toLowerCase();
      const own = this.seats.find((s) => s.kind === 'player' && s.name.toLowerCase() === typed);
      if (own && kind === 'player') {
        if (this.here(own)) throw new RoomError(`${own.name} is playing on another phone.`);
        Object.assign(own, { token: token(), standIn: false, left: false, seen: Date.now() });
        this.changed();
        return own;
      }
      const clean = this.cleanName(name);
      const open = this.seats.find((s) => s.kind === 'open');
      if (!open) throw new RoomError('The game has started and every seat is taken.');
      open.name = clean;
      open.kind = kind;
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

  // In the lobby a player (or bot) can be removed: before the game starts,
  // their seat goes; in a saved game still taking its seats, it's open again.
  leave(seatIndex: number) {
    const s = this.seats[seatIndex];
    if (!s || s.kind === 'open') throw new RoomError('No such player.');
    if (this.seating) Object.assign(s, { name: `P${seatIndex + 1}`, kind: 'open', token: token(), standIn: false, left: false });
    else if (this.game) throw new RoomError('The game has started.');
    else this.seats.splice(seatIndex, 1);
    this.changed();
  }

  // Mid-game, a player quits: a bot makes their moves from now on, and their
  // phone no longer holds the seat.
  quit(tok: string) {
    const p = this.playerSeat(tok);
    if (!this.game || this.seating) return this.leave(p);
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

  // ---- saving ----

  // The TV or a player at the table saves the game partway through: it stops
  // where it is, for everyone (bots and Claude players too), until someone
  // continues it. Everyone can leave; the server keeps it however long it waits.
  save(tok: string) {
    this.atTable(tok);
    const g = this.game;
    if (!g || this.seating) throw new RoomError("The game isn't under way.");
    if (g.phase === 'over') throw new RoomError('The game is over.');
    if (this.savedAt) return;
    this.savedAt = Date.now();
    this.changed();
  }

  // Someone at the table picks a saved game up again. True if it was saved
  // (the server then brings its Claude players back).
  continue(tok: string): boolean {
    this.atTable(tok);
    if (!this.savedAt) return false;
    this.savedAt = null;
    this.changed();
    return true;
  }

  // The TV, or a player in one of the seats.
  private atTable(tok: string) {
    const p = this.seatOf(tok);
    if (tok !== this.hostToken && (p < 0 || this.seats[p].kind !== 'player')) throw new RoomError('You are not in this game.');
  }

  // The TV (host token) or the first player to join can start the game.
  canStart(tok: string): boolean {
    return tok === this.hostToken || (tok === this.seats[0]?.token && this.seats[0].kind === 'player');
  }

  start(tok: string, seed = Date.now()) {
    if (!this.canStart(tok)) throw new RoomError('Only the TV or the first to join can start the game.');
    if (this.game) throw new RoomError('The game has already started.');
    if (this.seats.length < MIN_PLAYERS) throw new RoomError(`The game needs at least ${MIN_PLAYERS} players.`);
    if (existsSync(this.file)) throw new RoomError(`A game already exists at ${this.file}.`);
    this.cached = newGame(this.seats.length, seed, this.opts.firstSeat);
    withLock(this.file, () => save(this.file, this.cached!));
    this.changed();
  }

  seatOf(tok: string): number {
    const i = this.seats.findIndex((s) => s.token === tok);
    if (i >= 0) this.seats[i].seen = Date.now();
    return i;
  }

  // ---- play ----

  // A player's command, through the engine.
  command(tok: string, cmd: string) {
    this.act(this.playerSeat(tok), cmd);
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
      this.watchAway();
    };
  }

  // A player a bot was playing for while they were away is back.
  private back(s: Seat) {
    if (!s.standIn || s.left) return;
    s.standIn = false;
    this.changed();
  }

  // What a client that holds no stream open (the CLI, a Claude seat) asks for:
  // the snapshot a phone gets. Asking counts as being at the seat.
  state(tok: string): Snapshot {
    if (tok && tok !== this.hostToken) this.playerSeat(tok);
    return this.snapshot(tok || null);
  }

  // Resolves when this seat has a decision to make (code 0), the game ends
  // (0), or time runs out (2), with the seat's snapshot.
  wait(tok: string, timeoutMs: number): Promise<{ code: number; state: Snapshot }> {
    const p = this.playerSeat(tok);
    const left = this.holding(p);
    return new Promise((done) => {
      const check = (): boolean => {
        const g = this.game;
        if (g?.phase === 'over') return finish(0);
        if (g && waitingOn(g).includes(p) && !this.sceneLeft() && !this.seating && !this.savedAt) return finish(0);
        return false;
      };
      const finish = (code: number) => {
        clearTimeout(timer);
        unsubscribe();
        left();
        done({ code, state: this.snapshot(tok) });
        return true;
      };
      const timer = setTimeout(() => finish(2), timeoutMs);
      const unsubscribe = this.subscribe(() => void check());
      check();
    });
  }

  // For a player who follows the game as it goes (a Claude seat's tool server):
  // every event this seat can see from log index `since` on, the index to ask
  // from next time, and its snapshot. With a timeout it waits until it's this
  // seat's decision, someone else talks, the game ends, or time runs out. On its
  // own turn with an offer out, it waits for an answer rather than returning at once.
  listen(tok: string, since: number, timeoutMs: number): Promise<{ events: EventView[]; next: number; state: Snapshot }> {
    const p = this.playerSeat(tok);
    const result = () => {
      const g = this.game;
      return { events: g ? visibleEvents(g, p, since) : [], next: g ? g.log.length : 0, state: this.snapshot(tok) };
    };
    const ready = (): boolean => {
      const g = this.game;
      if (!g) return false;
      if (g.phase === 'over') return true;
      const others = visibleEvents(g, p, since).filter((e) => !e.text.startsWith(`P${p + 1} `));
      if (others.some((e) => / says: "| \(private\): "/.test(e.text))) return true;
      const awaitingAnswer = g.phase === 'action' && g.turn === p && g.offers.some((o) => o.from === p) && !others.length;
      return waitingOn(g).includes(p) && !awaitingAnswer && !this.sceneLeft() && !this.seating && !this.savedAt;
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
    if (!this.game) throw new RoomError("The game hasn't started.");
    if (this.seating) throw new RoomError('The game goes on once every seat is taken.');
    if (this.savedAt) throw new RoomError('The game is saved: continue it first.');
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
    this.watchAway();
  }

  // A seat whose phone closed counts as here for a minute; when that runs out
  // nothing else may change (the table is waiting on them), so tell everyone
  // then, and the others' phones offer a bot for them.
  private watchAway() {
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.awayTimer = null;
    const ends = this.seats.filter((s) => s.kind === 'player' && !s.left && s.connected === 0 && this.here(s)).map((s) => s.seen + this.awayMs);
    const wait = Math.max(0, Math.min(...ends) - Date.now()) + 10;
    // setTimeout fires at once on anything past ~24.8 days, so a seat seen that
    // far ahead (the screenshot rooms mark everyone here for good) needs no timer.
    if (!ends.length || wait > MAX_TIMEOUT_MS) return;
    this.awayTimer = setTimeout(() => {
      this.awayTimer = null;
      this.changed();
    }, Math.max(0, Math.min(...ends) - Date.now()) + 10);
    this.awayTimer.unref();
  }

  private scheduleBot() {
    const g = this.game;
    if (this.botTimer || !g || g.phase === 'over' || this.abandoned || this.seating || this.savedAt) return;
    if (this.sceneLeft()) {
      if (!this.sceneTimer) this.wakeAfterScene(); // something must end the wait
      return;
    }
    const botPlays = (p: number) => this.seats[p]?.kind === 'bot' || !!this.seats[p]?.standIn;
    if (!waitingOn(g).some(botPlays)) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        if (this.abandoned || this.savedAt) return;
        // A scene began while this bot was waiting to move: it moves once the
        // scene is over, when the scene's timer wakes the room.
        if (this.sceneLeft()) return this.scheduleBot();
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
      seating: this.seating,
      saved: this.savedAt,
      // Phones hold a stream open; a CLI player counts as here if it asked anything in the last minute.
      seats: this.seats.map((s) => ({ name: s.name, kind: s.kind, connected: this.here(s), standIn: s.standIn, left: s.left })),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      file: this.file,
      remote: !this.hasTv,
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
      recap: g?.phase === 'over' && existsSync(this.recapFile) ? this.recapId : null,
      you: g && p >= 0 && this.seats[p].kind === 'player' ? { ...seatState(g, p), name: this.seats[p].name } : null,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // A stream with no seat is a screen; `tv` says it's a TV page (not a
  // phone's table view).
  connect(tok: string | null, tv = false): () => void {
    if (tok === null) {
      this.screens++;
      if (tv) this.tvCame();
      return () => {
        this.screens--;
        if (tv && --this.tvs === 0) this.tvGone();
      };
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

  /** Whether a TV is watching the room right now (not just a while ago). */
  get tvWatching(): boolean {
    return this.tvs > 0;
  }

  private tvCame() {
    this.tvs++;
    if (this.tvTimer) clearTimeout(this.tvTimer);
    this.tvTimer = null;
    if (this.hasTv) return;
    this.hasTv = true;
    this.changed();
  }

  private tvGone() {
    if (this.tvTimer) clearTimeout(this.tvTimer);
    this.tvTimer = setTimeout(() => {
      this.tvTimer = null;
      if (this.tvs > 0 || !this.hasTv) return;
      this.hasTv = false;
      this.changed();
    }, this.opts.tvGoneMs ?? TV_GONE_MS);
    this.tvTimer.unref();
  }

  changed() {
    this.lastActive = Date.now();
    this.saveSeats();
    this.saveRecap(); // once the game is over (also one that ended before recaps were kept)
    this.tick();
    for (const fn of this.listeners) fn();
  }

  close() {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    if (this.awayTimer) clearTimeout(this.awayTimer);
    if (this.tvTimer) clearTimeout(this.tvTimer);
    this.botTimer = this.sceneTimer = this.awayTimer = this.tvTimer = null;
    this.listeners.clear();
  }
}
