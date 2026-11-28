// The Rust server, driven from TypeScript: what the tests, the screenshots, the
// demo and the playtest runner use to host rooms, and to look into one or put it
// in a state. It starts rust/src/bin/stage.rs once and asks it one thing at a
// time, waiting for each answer. A room's game and seats here are copies, kept
// as the server's are: a change made to them goes over with the next call.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';
import { TUNING } from './data.ts';
import type { Game } from './engine.ts';
import type { Lobby, SeatKind, Snapshot } from './state.ts';
import { become } from './wasm.ts';

export const ROOMS_DIR = join(homedir(), '.cache', 'board-lite', 'rooms');
const beside = (gameFile: string, end: string) => `${gameFile.replace(/\.json$/, '')}${end}`;
/** Where a game file's seats are saved. */
export const seatsFile = (gameFile: string) => beside(gameFile, '.seats.json');
/** Where a game file's log goes. */
export const gameLogFile = (gameFile: string) => beside(gameFile, '.log.jsonl');
/** Where a game file's Claude runners are listed, to bring back when a saved game continues. */
export const claudeFile = (gameFile: string) => beside(gameFile, '.claude.json');

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

export class RoomError extends Error {}
export class LimitError extends Error {}

// ---------- one question, one answer ----------

const BIN = fileURLToPath(new URL('../rust/target/home/stage', import.meta.url));
// The worker holds the process; this thread sleeps until it has the answer.
const WORKER = `
const { spawn } = require('node:child_process');
const { workerData } = require('node:worker_threads');
const { bin, port, flag } = workerData;
const child = spawn(bin, { stdio: ['pipe', 'pipe', 'inherit'] });
const say = (v) => { port.postMessage(v); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
// An answer starts with a null; any other line is the server talking to its terminal.
let parts = [];
child.stdout.on('data', (d) => {
  parts.push(d);
  if (d[d.length - 1] !== 10) return;
  const lines = Buffer.concat(parts).toString().split('\\n').slice(0, -1);
  parts = [];
  for (const l of lines) if (l[0] === '\\0') say(l.slice(1));
});
child.on('exit', (code) => say(JSON.stringify({ fail: 'server', why: 'the staging server stopped (' + code + ')' })));
child.on('error', (e) => say(JSON.stringify({ fail: 'server', why: String(e) })));
port.on('message', (m) => child.stdin.write(m));
`;
let line: { port: import('node:worker_threads').MessagePort; flag: Int32Array } | null = null;
function connect() {
  if (!existsSync(BIN)) throw new Error('The server is not built: npm run rust:build');
  const { port1, port2 } = new MessageChannel();
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const w = new Worker(WORKER, { eval: true, workerData: { bin: BIN, port: port2, flag }, transferList: [port2] });
  w.unref();
  port1.unref();
  return (line = { port: port1, flag });
}
function ask(op: string, q: object = {}): any {
  const { port, flag } = line ?? connect();
  Atomics.store(flag, 0, 0);
  port.postMessage(`${JSON.stringify({ op, win: TUNING.pointsToWin, ...q })}\n`);
  if (Atomics.wait(flag, 0, 0, 60_000) === 'timed-out') throw new Error(`The staging server did not answer ${op}.`);
  const r = JSON.parse(receiveMessageOnPort(port)!.message);
  return r;
}
function ok(r: any): any {
  if (r.fail === 'room') throw new RoomError(r.why);
  if (r.fail === 'limit') throw new LimitError(r.why);
  if (r.fail) throw new Error(r.why);
  return r.ok;
}
const call = (op: string, q: object = {}) => ok(ask(op, q));

// ---------- rooms ----------

export interface Seat {
  uid: number;
  name: string;
  token: string;
  kind: SeatKind;
  connected: number; // open event streams
  seen: number; // when this seat was last heard from (ms epoch)
  standIn: boolean;
  left: boolean;
  strong?: boolean;
  via?: 'phone' | 'cli' | 'claude';
}
export interface RoomOptions {
  file?: string;
  dir?: string;
  hideFile?: boolean;
  botDelayMs?: number;
  awayMs?: number;
  remote?: boolean;
  tvGoneMs?: number;
  recaps?: string;
  now?: () => number; // the clock a recap is dated by
  recapId?: string;
  firstSeat?: number;
}
const sent = (o: RoomOptions) => ({ ...o, now: undefined, ended: o.now?.(), dir: o.dir ?? (o.file && !o.recaps ? dirname(o.file) : undefined) });

const known = new Map<number, Room>();
// Keeps the copies up with what bots, timers and the web do meanwhile.
const FAST = !!process.env.NODE_TEST_CONTEXT;
setInterval(() => {
  for (const r of known.values()) r.sync();
}, FAST ? 15 : 250).unref();

export class Room {
  readonly code: string;
  readonly file: string;
  readonly hostToken: string;
  readonly recapId: string;
  seats: Seat[] = [];
  savedAt: number | null = null;
  lastActive = 0;
  abandoned = false;
  readonly id: number;
  private copy: Game | null = null;
  private rev = -1;
  private was = { game: '', logged: 0, seats: '', by: new Map<number, number>() };
  private version = -1;
  private left = 0;
  private listeners = new Set<() => void>();
  private holds?: NodeJS.Timeout;

  constructor(code: string, opts: RoomOptions | { id: number; code: string; file: string; hostToken: string; recapId: string } = {}) {
    const r = 'id' in opts ? opts : call('newRoom', { code, opts: sent(opts) });
    this.id = r.id;
    this.code = r.code;
    this.file = r.file;
    this.hostToken = r.hostToken;
    this.recapId = r.recapId;
    known.set(this.id, this);
    this.was.seats = this.seatsText();
    this.sync();
  }
  static newCode(taken: (c: string) => boolean, dir = ROOMS_DIR): string {
    for (;;) {
      const c = call('newCode', { dir });
      if (!taken(c)) return c;
    }
  }
  /** The code a game file was hosted under before, if its seats were saved. */
  static savedCode(gameFile: string): string | null {
    try {
      return JSON.parse(readFileSync(seatsFile(gameFile), 'utf8')).code ?? null;
    } catch {
      return null;
    }
  }
  static at(r: { id: number; code: string; file: string; hostToken: string; recapId: string }): Room {
    return known.get(r.id) ?? new Room(r.code, r);
  }

  // What's been changed here since the last answer.
  private changes(): object | undefined {
    const push: Record<string, unknown> = {};
    if (this.copy) {
      const { log, ...rest } = this.copy;
      if (JSON.stringify(rest) !== this.was.game || log.length !== this.was.logged) Object.assign(push, { game: { ...rest, log: [] }, log: log.slice(this.was.logged) });
    }
    if (this.seatsText() !== this.was.seats) {
      push.seats = this.seats.map((s) => ({ ...s, connected: s.connected === this.was.by.get(s.uid) ? undefined : s.connected }));
      push.savedAt = this.savedAt;
    }
    return Object.keys(push).length ? push : undefined;
  }
  private seatsText() {
    return JSON.stringify([this.seats, this.savedAt]);
  }
  private take(now: any) {
    if (now.game) {
      const entries = this.copy?.log ?? [];
      const { log: _, ...game } = now.game;
      if (!this.copy) this.copy = { ...game, log: entries } as Game;
      else {
        const { log, ...mine } = this.copy;
        const next = become(mine, game);
        for (const k of Object.keys(this.copy)) if (k !== 'log' && !(k in next)) delete (this.copy as any)[k];
        Object.assign(this.copy, next);
      }
      entries.splice(now.logFrom, Infinity, ...now.log);
      this.copy.log = entries;
      this.rev = now.gameRev;
    }
    const by = new Map(this.seats.map((s) => [s.uid, s]));
    const seats = now.seats.map((s: Seat) => Object.assign(by.get(s.uid) ?? {}, s));
    this.seats.splice(0, Infinity, ...seats);
    Object.assign(this, { savedAt: now.savedAt, lastActive: now.lastActive, abandoned: now.abandoned });
    this.left = now.sceneLeft;
    if (this.copy) {
      const { log, ...rest } = this.copy;
      this.was.game = JSON.stringify(rest);
      this.was.logged = log.length;
    }
    this.was.seats = this.seatsText();
    this.was.by = new Map(this.seats.map((s) => [s.uid, s.connected]));
    const heard = this.version >= 0 && now.version !== this.version;
    this.version = now.version;
    if (heard) for (const fn of [...this.listeners]) fn();
  }
  private ask(op: string, q: object = {}): any {
    const r = ask(op, { room: this.id, push: this.changes(), rev: this.rev, logged: this.copy?.log.length ?? 0, ...q });
    if (r.now) this.take(r.now);
    return ok(r);
  }
  sync() {
    if (known.has(this.id)) this.ask('sync');
  }

  get game(): Game | null {
    this.sync();
    return this.copy;
  }
  // `fn` changes the game (and returns the command, if it was one).
  mutate(fn: (g: Game) => unknown) {
    this.sync();
    if (!this.copy) throw new RoomError("The game hasn't started.");
    const before = this.copy.log.length;
    fn(this.copy);
    this.ask('mutated', { before });
  }
  changed() { this.ask('changed'); }
  join(name: string, kind: SeatKind = 'player', via?: Seat['via']): Seat { return this.seats[this.ask('join', { name, kind, via })]; }
  addBot(strong = false) { this.ask('addBot', { strong }); }
  leave(seat: number) { this.ask('leave', { seat }); }
  quit(tok: string) { this.ask('quit', { tok }); }
  standInFor(tok: string, seat: number) { this.ask('standInFor', { tok, seat }); }
  save(tok: string) { this.ask('save', { tok }); }
  continue(tok: string): boolean { return this.ask('continue', { tok }); }
  canStart(tok: string): boolean { return this.ask('canStart', { tok }); }
  start(tok: string, seed?: number) { this.ask('start', { tok, seed }); }
  command(tok: string, cmd: string, via?: Seat['via'], id?: string) { this.ask('command', { tok, cmd, via, id }); }
  state(tok: string): Snapshot { return this.ask('state', { tok }); }
  snapshot(tok: string | null): Snapshot { return this.ask('snapshot', { tok }); }
  lobby(): Lobby { return this.ask('lobby'); }
  seatOf(tok: string): number { return this.seats.findIndex((s) => s.token === tok); }
  here(s: Seat): boolean {
    const seat = this.lobby().seats[this.seats.indexOf(s)];
    return !!seat?.connected;
  }
  sceneLeft(): number {
    this.sync();
    return this.left;
  }
  connect(tok: string | null, tv = false, answers = false): () => void {
    const here = this.ask('connect', { tok, tv, answers });
    return () => this.ask('disconnect', { here });
  }
  async wait(tok: string, ms: number): Promise<{ code: number; state: Snapshot }> {
    const wait = this.ask('wait', { tok, ms });
    for (;;) {
      const r = this.ask('waited', { wait });
      if (r?.error) throw new RoomError(r.error);
      if (r) return r;
      await new Promise((done) => setTimeout(done, 5));
    }
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    this.holds ??= setInterval(() => {}, 1 << 30); // whoever waits to hear keeps the process open
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) this.letGo();
    };
  }
  private letGo() {
    clearInterval(this.holds);
    this.holds = undefined;
  }
  close() {
    if (!known.has(this.id)) return;
    this.ask('closeRoom');
    known.delete(this.id);
    this.listeners.clear();
    this.letGo();
  }
}

// ---------- servers ----------

export interface Site {
  origin: string;
  trustProxy?: boolean;
  limits?: Partial<{ requestsPerMinute: number; roomsPerHour: number; wrongCodesPerMinute: number; open: number }>;
}

class Rooms {
  private readonly server: number;
  constructor(server: number) { this.server = server; }
  private all() { return (call('rooms', { server: this.server }) as any[]).map((r) => Room.at(r)); }
  get(code: string) { return this.all().find((r) => r.code === code); }
  has(code: string) { return !!this.get(code); }
  set(_code: string, room: Room) { call('setRoom', { server: this.server, room: room.id }); }
  keys() { return this.all().map((r) => r.code); }
  values() { return this.all(); }
  delete(code: string) { call('deleteRoom', { server: this.server, code }); }
  clear() { call('clearRooms', { server: this.server }); }
  get size() { return this.all().length; }
}

class Server extends EventEmitter {
  listening = false;
  private readonly id: number;
  private readonly port: number;
  // Holds the process open, as a listening server does.
  private readonly holds = setInterval(() => {}, 1 << 30);
  constructor(r: { id: number; port: number }) {
    super();
    this.id = r.id;
    this.port = r.port;
    setImmediate(() => {
      this.listening = true;
      this.emit('listening');
    });
  }
  address() { return { port: this.port }; }
  private closed = false;
  closeAllConnections() {
    if (!this.closed) call('drop', { server: this.id });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.holds);
    call('close', { server: this.id });
  }
}

// `resume`: host again every room active in the last few hours, and every saved game, each under its own code.
export function startServer(port: number, opts: RoomOptions = {}, files: string[] = [], host = '0.0.0.0', resume = false, site?: Site): { server: Server; rooms: Rooms } {
  const r = call('serve', { port, opts: sent(opts), files, host, resume, site });
  return { server: new Server(r), rooms: new Rooms(r.id) };
}

/** The machine's addresses on the local network, and on Tailscale. */
export const lanAddresses = (): string[] => call('addresses').lan;
export const tailscaleAddresses = (): string[] => call('addresses').tailscale;
/** Who a request is from, for the website's limits. */
export const visitor = (ip: string, forwarded?: string): string => call('visitor', { ip, forwarded });
