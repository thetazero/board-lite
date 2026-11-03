#!/usr/bin/env node
// Runs one sandboxed playtest: each seat is its own `claude -p` process whose
// only tools are the seat server's (view, act, say, wait, rules) for that one
// seat. No built-in tools (no shell, files, web), no other MCP servers, no
// user or project settings. "bot" seats are played by the random bot.
//
//   node src/playtest/run.ts --models opus,haiku,haiku [--seed N] [--out DIR]
//
// See docs/playtest.md.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botMove } from '../bot.ts';
import { RuleError, newGame, pname, score, waitingOn, type Game } from '../engine.ts';
import { load, save, withLock } from '../store.ts';
import { FLOOR_MB, defaultPool, release, tryAcquire } from './slots.ts';

const USAGE = `node src/playtest/run.ts --models <m1,m2,...> [options]

  --models opus,haiku,sonnet,bot   one entry per seat (2-6): a claude model alias or name, or "bot"
  --seed N                          game seed (default random)
  --out DIR                         where everything goes (default ~/.cache/board-lite/playtests/<time>-<models>)
  --effort low|medium|high|...      effort level for every Claude seat (default: the model's own)
  --budget-usd N                    spending cap per Claude seat, over the whole game (default 5)
  --max-minutes N                   stop the game after this long (default 240)
  --stall-minutes N                 stop if nothing happens in the game for this long (default 15)

Claude seats take slots from a machine-wide pool (BOARD_LITE_MAX_SEATS, default 6) and
the game waits its turn when the pool is full or memory is short. See docs/playtest.md.`;

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const args = process.argv.slice(2);
const modelsArg = opt(args, '--models');
if (!modelsArg || args.includes('--help')) {
  console.log(USAGE);
  process.exit(modelsArg ? 0 : 1);
}
const models = modelsArg.split(',').map((m) => m.trim()).filter(Boolean);
if (models.length < 2 || models.length > 6) throw new Error('Need 2 to 6 seats in --models.');
const seed = Number(opt(args, '--seed') ?? Math.floor(Math.random() * 2 ** 31));
const effort = opt(args, '--effort');
const budget = Number(opt(args, '--budget-usd') ?? 5);
const maxMinutes = Number(opt(args, '--max-minutes') ?? 240);
const stallMinutes = Number(opt(args, '--stall-minutes') ?? 15);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(opt(args, '--out') ?? join(homedir(), '.cache', 'board-lite', 'playtests', `${stamp}-${models.join('-')}`));
if (out.startsWith('/tmp')) throw new Error('Keep playtests out of /tmp (it is RAM on the dev machine).');

const seatServer = fileURLToPath(new URL('./seat-server.ts', import.meta.url));
const gameFile = join(out, 'game.json');
const tmp = join(out, 'tmp');
mkdirSync(tmp, { recursive: true });
if (existsSync(gameFile)) throw new Error(`${gameFile} already exists; pick a new --out.`);
withLock(gameFile, () => save(gameFile, newGame(models.length, seed)));

const TOOL_NAMES = ['view', 'act', 'say', 'wait', 'rules'].map((t) => `mcp__game__${t}`);

function systemPrompt(p: number): string {
  const others = models.map((_, q) => pname(q)).filter((_, q) => q !== p).join(', ');
  return `You are ${pname(p)}, one player at a ${models.length}-player table of board-lite, a social board game about wizards who raise dragons. The other players (${others}) are also AI players, each with their own hidden hand. Play to win.

Your only way to act is the game tools: view, act, say, wait and rules. You have no other tools, and nothing outside the game matters.

How to play:
- Loop until the game is over: call wait; when it says it's your decision, call view, think, then act. After each act, read the result and keep going until you end your turn or are waiting again.
- Read the rules once at the start (rules tool).
- Decide only from what your own view shows you. Other players' hands and resources are hidden from you.
- This is a social game, and talking is a big part of it. Use say to talk to the table and say with "to" for a private word with one player: propose and haggle over trades, form alliances, ask for help with raids, make promises, bluff, and call others out. Talk is free and binds no one; only accepted offers are binding, and raid commitments can be bailed on in secret. Keep messages short, like real table talk, and reply when someone talks to you.
- Don't stop until the game is over. If you're unsure what to do, call wait.`;
}

interface Seat { p: number; model: string; session: string; proc: ChildProcess | null; starts: number; cost: number; exitedAt: number }
const seats: Seat[] = models.map((model, p) => ({ p, model, session: randomUUID(), proc: null, starts: 0, cost: 0, exitedAt: 0 }));

function startSeat(s: Seat) {
  const dir = join(out, `seat-${s.p + 1}`);
  mkdirSync(dir, { recursive: true });
  const mcp = join(dir, 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { game: { type: 'stdio', command: process.execPath, args: [seatServer, gameFile, String(s.p + 1)] } } }));
  const first = s.starts === 0;
  const prompt = first
    ? 'The game has started. Read the rules, then play until the game is over.'
    : 'The game is not over yet. Keep playing: call wait, and act when it is your decision.';
  const argv = [
    '-p', prompt,
    '--model', s.model,
    ...(first ? ['--session-id', s.session, '--append-system-prompt', systemPrompt(s.p)] : ['--resume', s.session]),
    '--tools', '',
    '--strict-mcp-config', '--mcp-config', mcp,
    '--allowedTools', TOOL_NAMES.join(','),
    '--permission-mode', 'dontAsk',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--no-chrome',
    '--max-budget-usd', String(Math.max(0.01, budget - s.cost)),
    '--output-format', 'stream-json', '--verbose',
    ...(effort ? ['--effort', effort] : []),
  ];
  s.starts++;
  const transcript = createWriteStream(join(out, `seat-${s.p + 1}.jsonl`), { flags: 'a' });
  const errLog = createWriteStream(join(out, `seat-${s.p + 1}.stderr.log`), { flags: 'a' });
  const proc = spawn('claude', argv, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: tmp, BOARD_LITE_WAIT_SECS: '60', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
  });
  let buf = '';
  proc.stdout!.on('data', (chunk: Buffer) => {
    transcript.write(chunk);
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'result' && typeof msg.total_cost_usd === 'number') s.cost += msg.total_cost_usd;
      } catch { /* partial or non-JSON line */ }
    }
  });
  proc.stderr!.pipe(errLog);
  proc.on('exit', (code) => {
    note(`${pname(s.p)} (${s.model}) process exited with code ${code}; spent $${s.cost.toFixed(2)} so far.`);
    s.proc = null;
    s.exitedAt = Date.now();
  });
  s.proc = proc;
  note(`${pname(s.p)} (${s.model}) ${first ? 'starts' : 'resumes'}.`);
}

function note(text: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${text}`;
  console.log(line);
  appendFileSync(join(out, 'runner.log'), `${line}\n`);
}

const botRng = { state: seed ^ 0x2545f491 };
function playBots() {
  withLock(gameFile, () => {
    const g = load(gameFile);
    let moved = false;
    for (const s of seats) {
      if (s.model !== 'bot' || g.phase === 'over' || !waitingOn(g).includes(s.p)) continue;
      try {
        botMove(g, s.p, botRng);
        moved = true;
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
      }
    }
    if (moved) save(gameFile, g);
  });
}

function writeResults(g: Game, status: string, started: number) {
  const log = g.log.map((e) => `[r${e.round}]${e.to ? ` (only ${e.to.map(pname).join(', ')})` : ''} ${e.text}`);
  writeFileSync(join(out, 'log.txt'), `${log.join('\n')}\n`);
  writeFileSync(join(out, 'talk.txt'), `${log.filter((l) => / says: "| \(private\): "/.test(l)).join('\n')}\n`);
  const results = {
    status,
    seed,
    rounds: g.round,
    minutes: Math.round((Date.now() - started) / 600) / 100,
    winner: g.winner === null ? null : { seat: pname(g.winner), model: models[g.winner] },
    seats: seats.map((s) => ({ seat: pname(s.p), model: s.model, points: score(g, s.p).total, costUsd: Math.round(s.cost * 100) / 100, starts: s.starts })),
    talk: { public: g.log.filter((e) => / says: "/.test(e.text)).length, private: g.log.filter((e) => / \(private\): "/.test(e.text)).length },
  };
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

const pool = defaultPool();

/** Blocks until this game's Claude seats fit in the machine-wide pool. */
async function admit(): Promise<boolean> {
  const claudeSeats = seats.filter((s) => s.model !== 'bot').length;
  let said = '';
  for (;;) {
    const r = tryAcquire(pool, claudeSeats, out);
    if (r.ok) return true;
    const kind = r.why.replace(/[\d.]+/g, '#'); // don't log every change in a number
    if (kind !== said) { note(`Waiting to start: ${r.why}.`); said = kind; }
    await new Promise((res) => setTimeout(res, 5000));
    if (interrupted) return false;
  }
}

let interrupted = false;

async function main() {
  note(`Playtest in ${out}: ${models.map((m, p) => `${pname(p)} ${m}`).join(', ')}; seed ${seed}.`);
  const stopAll = () => { for (const s of seats) s.proc?.kill('SIGTERM'); };
  process.on('SIGINT', () => { interrupted = true; stopAll(); });
  process.on('SIGTERM', () => { interrupted = true; stopAll(); });
  process.on('exit', () => release(pool));
  let status = 'running';
  if (!(await admit())) status = 'interrupted';
  const started = Date.now();
  if (status === 'running') for (const s of seats) if (s.model !== 'bot') startSeat(s);
  let lastLen = -1, lastChange = Date.now(), lowSince = 0;
  for (;;) {
    if (status !== 'running') break;
    await new Promise((r) => setTimeout(r, 1000));
    playBots();
    const g = load(gameFile);
    if (g.log.length !== lastLen) { lastLen = g.log.length; lastChange = Date.now(); }
    if (interrupted) { status = 'interrupted'; break; }
    // Free memory under the floor for 10 s: stop this game before the machine OOMs.
    if (pool.memAvailableMb() >= FLOOR_MB) lowSince = 0;
    else if (!lowSince) lowSince = Date.now();
    else if (Date.now() - lowSince > 10000) { status = 'low memory'; break; }
    if (g.phase === 'over') {
      // Give the players a moment to see the end and sign off.
      const until = Date.now() + 120000;
      while (seats.some((s) => s.proc) && Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
      break;
    }
    if (Date.now() - started > maxMinutes * 60000) { status = 'time limit'; break; }
    if (Date.now() - lastChange > stallMinutes * 60000) { status = 'stalled'; break; }
    for (const s of seats) {
      if (s.model === 'bot' || s.proc) continue;
      if (s.cost >= budget) { status = `${pname(s.p)} hit its budget`; break; }
      if (s.starts >= 30) { status = `${pname(s.p)} kept stopping`; break; }
      if (Date.now() - s.exitedAt > 3000) startSeat(s);
    }
  }
  if (status === 'running') status = 'over';
  stopAll();
  const results = writeResults(load(gameFile), status, started);
  note(`Finished (${results.status}) after ${results.rounds} rounds. Winner: ${results.winner ? `${results.winner.seat} (${results.winner.model})` : 'none'}.`);
  note(`Results: ${join(out, 'results.json')}; full log with talk: ${join(out, 'log.txt')}.`);
}

void main();
