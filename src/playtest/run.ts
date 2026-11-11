#!/usr/bin/env node
// Seats Claude players (and Codex players) at a board-lite table. Each Claude
// seat is its own `claude -p` process, each Codex seat its own `codex exec`,
// whose only tools are the seat server's (view, act, say, wait, rules) for that
// one seat. No built-in tools (no shell, files, web), no other MCP servers, no
// user or project settings.
//
// Claude players are clients like any other: they join a room on a board-lite
// server and play through the same interface as the phones and the CLI. Either
// this runner hosts the room itself (a playtest: every seat Claude or a bot,
// the TV optional with --serve), or it joins Claude seats to a room someone is
// already hosting with `npm run serve` (--room), next to phone and CLI players.
//
//   node src/playtest/run.ts --models opus,haiku,haiku [--seed N] [--out DIR] [--serve PORT]
//   node src/playtest/run.ts --room http://localhost:8080/ABCD --models opus,haiku
//   node src/playtest/run.ts --resume DIR   (bring a stopped runner's Claude players back to their seats)
//
// See docs/playtest.md and docs/play-vs-claude.md.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { pname, score, type Game } from '../engine.ts';
import { load } from '../store.ts';
import { Room, addClaudeRunner } from '../server/room.ts';
import { lanAddresses, startServer, tailscaleAddresses } from '../server/server.ts';
import type { Lobby } from '../state.ts';
import { FLOOR_MB, alive, defaultPool, release, tryAcquire } from './slots.ts';
import { budgetUsd, readState, stateFile, type RunnerState } from './resume.ts';
import { OPTIONS, parseSeats, type PlayerOption, type PlayerSpec } from './players.ts';

const USAGE = `node src/playtest/run.ts --models <m1,m2,...> [options]
node src/playtest/run.ts --resume DIR [options]

  --models opus,haiku,sonnet,bot   the Claude seats: a claude model alias or name each, "codex:<model>" for a
                                    Codex seat (e.g. codex:gpt-5.6-sol; plain "codex" is Codex's default model),
                                    or "bot"; a Claude or Codex seat can add options, like opus+advice+expected
                                    (see below)
  --room URL                        join these Claude seats to a room someone else hosts (npm run serve),
                                    e.g. http://localhost:8080/ABCD; without it, this runner hosts the game
  --seed N                          game seed when hosting (default random)
  --out DIR                         where everything goes (default ~/.cache/board-lite/playtests/<time>-<models>)
  --serve PORT                      when hosting, also open the TV and phone pages to the network on PORT
  --effort low|medium|high|...      effort level for every Claude and Codex seat (default: the model's own)
  --budget-usd N                    spending cap per Claude seat, over the whole game (default 30 with --room,
                                    5 for a playtest this runner hosts); --resume keeps the one it had
  --max-minutes N                   stop after this long (default 240)
  --stall-minutes N                 stop if nothing happens in the game for this long (default 15; 60 with --room)
  --advice TEXT                     extra strategy advice appended to the prompt of each seat with +advice
                                    (of every Claude seat, if none says +advice)
  --resume DIR                      bring the Claude players of a runner that stopped (low memory, Ctrl-C, a crash,
                                    a restart) back into their own seats, in the same game, with their memory of it;
                                    DIR is that runner's --out. With --room too, the room has moved (a new port).

Claude player options, each switched on per seat with +name (none: the plain Claude player):
${Object.entries(OPTIONS).map(([k, v]) => `  +${k.padEnd(10)} ${v}`).join('\n')}

Claude seats take slots from a machine-wide pool (BOARD_LITE_MAX_SEATS, default 6) and
wait their turn when the pool is full or memory is short. See docs/playtest.md.`;

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const args = process.argv.slice(2);
const resumeDir = opt(args, '--resume');
const resumed: RunnerState | null = resumeDir ? readState(resolve(resumeDir)) : null;
const modelsArg = opt(args, '--models') ?? resumed?.seats.map((s) => [s.model, ...(s.options ?? [])].join('+')).join(',');
if (!modelsArg || args.includes('--help')) {
  console.log(USAGE);
  process.exit(modelsArg ? 0 : 1);
}
const models = modelsArg.split(',').map((m) => m.trim()).filter(Boolean);
const joinUrl = opt(args, '--room') ?? (resumed && !resumed.hosted ? resumed.room : undefined);
if (resumed) {
  if (opt(args, '--models')) throw new Error('--resume brings back the same Claude players; leave out --models.');
  if (resumed.pid && resumed.pid !== process.pid && alive(resumed.pid)) throw new Error(`The runner for ${resumeDir} is still running (process ${resumed.pid}).`);
} else if (joinUrl) {
  if (!models.length || models.length > 5) throw new Error('Give 1 to 5 Claude seats in --models.');
  if (models.includes('bot')) throw new Error('With --room, add bots from the TV ("Add a bot"); --models is only for Claude seats.');
} else if (models.length < 2 || models.length > 6) throw new Error('Need 2 to 6 seats in --models.');
const seed = Number(opt(args, '--seed') ?? resumed?.seed ?? Math.floor(Math.random() * 2 ** 31));
const effort = opt(args, '--effort') ?? resumed?.effort;
const budget = budgetUsd(opt(args, '--budget-usd'), resumed, !!joinUrl);
const maxMinutes = Number(opt(args, '--max-minutes') ?? 240);
const stallMinutes = Number(opt(args, '--stall-minutes') ?? (joinUrl ? 60 : 15));
const advice = opt(args, '--advice') ?? resumed?.advice;
const specs: PlayerSpec[] = parseSeats(models, advice);
const servePort = opt(args, '--serve');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(resumeDir ?? opt(args, '--out') ?? join(homedir(), '.cache', 'board-lite', 'playtests', `${stamp}-${specs.map((x) => x.label).join('-')}`));
if (out.startsWith('/tmp')) throw new Error('Keep playtests out of /tmp (it is RAM on the dev machine).');

const seatServer = fileURLToPath(new URL('./seat-server.ts', import.meta.url));
const tmp = join(out, 'tmp');
mkdirSync(tmp, { recursive: true });
const TOOL_NAMES = ['view', 'act', 'say', 'wait', 'rules'].map((t) => `mcp__game__${t}`);

// A Codex seat: "codex" (Codex's own default model) or "codex:<model>".
const isCodex = (model: string) => model === 'codex' || model.startsWith('codex:');

// ---- the room ----

let roomUrl = ''; // http://host:port/CODE
let api = '';
let hosted: Room | null = null; // the room, when this runner hosts it
let gameFile = '';

async function call(path: string, body?: object): Promise<Record<string, any>> {
  const r = await fetch(api + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(String(data.error ?? `HTTP ${r.status}`));
  return data;
}

const lobby = async (): Promise<Lobby> => (await call('')).lobby;

// In a room someone else hosts on this machine: list this runner beside the
// game, so when the table saves the game and later continues it (on the TV or
// a phone), the server starts it again with --resume.
function listBesideGame() {
  if (hosted || !gameFile || !existsSync(gameFile)) return;
  try {
    addClaudeRunner(gameFile, out);
  } catch (e) {
    note(`Could not list this runner beside ${gameFile} (continuing a saved game won't bring these Claude players back): ${(e as Error).message}`);
  }
}

async function host() {
  gameFile = join(out, 'game.json');
  // Resuming a playtest this runner hosted: the room comes back from game.json
  // and its seats file, under its own code and with every seat's token.
  const code = resumed ? Room.savedCode(gameFile) : null;
  if (resumed && !code) throw new Error(`Nothing to resume: ${gameFile} or its seats file is missing.`);
  if (!resumed && existsSync(gameFile)) throw new Error(`${gameFile} already exists; pick a new --out.`);
  const { server, rooms } = startServer(Number(servePort ?? 0), { botDelayMs: 300 }, [], servePort ? '0.0.0.0' : '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  hosted = new Room(code ?? Room.newCode((c) => rooms.has(c)), { botDelayMs: 300, file: gameFile });
  rooms.set(hosted.code, hosted);
  roomUrl = `http://127.0.0.1:${port}/${hosted.code}`;
  api = `http://127.0.0.1:${port}/api/rooms/${hosted.code}`;
  if (servePort) {
    const addr = lanAddresses()[0] ?? tailscaleAddresses()[0] ?? 'localhost';
    note(`Watch on a TV: http://${addr}:${port}/tv?room=${hosted.code}`);
  }
}

// Claude seats get plain names that say nothing about their model: in a depth
// test (Haiku vs Opus) no player may know which opponent is the stronger one.
// The model behind each name is only in runner.log and results.json.
const NAMES = ['Rowan', 'Quinn', 'Ellis', 'Sage', 'Wren', 'Morgan'];
function seatName(taken: string[]): string {
  const free = (n: string) => !taken.some((t) => t.toLowerCase() === n.toLowerCase());
  return NAMES.find(free) ?? `Wizard ${taken.length + 1}`;
}

// ---- Claude seats ----

// session: the Claude session id, or for a Codex seat its thread id (Codex picks it, so it's empty until the first start reports it).
// modelId: the model a Claude seat's process reports it runs (an alias like "opus" resolved). tokens: what a Codex seat used (Codex reports no cost).
interface Seat { p: number; model: string; options: PlayerOption[]; label: string; token: string; session: string; proc: ChildProcess | null; starts: number; startsHere: number; cost: number; tokens: number; modelId?: string; exitedAt: number }
const seats: Seat[] = [];
let table: Lobby['seats'] = []; // everyone at the table, once the game starts

// Everything --resume needs to bring these Claude players back, rewritten as it changes.
function saveState() {
  const state: RunnerState = {
    pid: process.pid, room: roomUrl, hosted: !!hosted, ...(hosted ? { seed } : {}), ...(effort ? { effort } : {}), ...(advice ? { advice } : {}), budget,
    seats: seats.map(({ p, model, options, token, session, starts, cost, tokens }) => ({ p, model, options, token, session, starts, cost, ...(tokens ? { tokens } : {}) })),
  };
  writeFileSync(stateFile(out), `${JSON.stringify(state, null, 2)}\n`);
}

function systemPrompt(s: Seat): string {
  const who = (q: number) => {
    const t = table[q];
    const mine = seats.find((x) => x.p === q);
    const kind = mine ? 'another AI player' : t.kind === 'bot' ? 'a random bot that never talks' : t.kind === 'open' ? 'an empty seat' : 'a person, playing on their phone or at a terminal';
    return `${pname(q)} ${t.name} (${kind})`;
  };
  const others = table.map((_, q) => q).filter((q) => q !== s.p).map(who).join('; ');
  const people = table.some((t, q) => t.kind === 'player' && !seats.some((x) => x.p === q));
  return `You are ${pname(s.p)}, called ${table[s.p].name}, one player at a ${table.length}-player table of board-lite, a social board game about wizards who raise dragons. The others: ${others}. Each has their own hidden hand. Play to win.${people ? `

There are people at this table. They see your public talk on the TV, and your private messages to them on their phone, and they can talk to you. Talk to them as you would to anyone at a game night: short, friendly, to the point. They play at human speed, so be patient when you're waiting on them.` : ''}

Your only way to act is the game tools: view, act, say, wait and rules. You have no other tools, and nothing outside the game matters.

How to play:
- Loop until the game is over: call wait; when it says it's your decision, call view, think, then act. After each act, read the result and keep going until you end your turn or are waiting again.
- Read the rules once at the start (rules tool).
- Every act takes a "why": a sentence or two on why you chose it. It is private, never shown to anyone at the table, and kept for the people studying the game afterwards, so be honest and specific.
- Decide only from what your own view shows you. Other players' hands and resources are hidden from you.
- This is a social game, and talking is a big part of it. Use say to talk to the table and say with "to" for a private word with one player: propose and haggle over trades, form alliances, ask for help with raids, make promises, bluff, and call others out. Talk is free and binds no one; only accepted offers are binding, and a player in a raid can secretly hold back from the fight. Keep messages short, like real table talk, and reply when someone talks to you.
- Don't stop until the game is over. If you're unsure what to do, call wait.${advice && s.options.includes('advice') ? `\n\nAdvice: ${advice}` : ''}`;
}

function startSeat(s: Seat) {
  const dir = join(out, `seat-${s.p + 1}`);
  mkdirSync(dir, { recursive: true });
  const mcp = join(dir, 'mcp.json');
  const movesFile = join(out, `seat-${s.p + 1}.moves.txt`);
  const serverArgs = [seatServer, roomUrl, s.token, movesFile, ...(s.options.includes('expected') ? ['--expected'] : [])];
  writeFileSync(mcp, JSON.stringify({ mcpServers: { game: { type: 'stdio', command: process.execPath, args: serverArgs } } }));
  const codex = isCodex(s.model);
  // A Codex seat that never reported its thread starts afresh: there is nothing to resume.
  const first = s.starts === 0 || (codex && !s.session);
  if (first && !s.session && !codex) s.session = randomUUID();
  const prompt = first
    ? resumed
      ? 'The game is under way: you are taking your seat partway through. Read the rules, call view to see where things stand, then play until the game is over.'
      : 'The game has started. Read the rules, then play until the game is over.'
    : resumed && s.startsHere === 0
      ? 'You were away from the table for a while (your connection to the game dropped, or the table took a break), and now you are back in your seat. The game is not over yet and may have moved on: call view to see where things stand, then keep playing: call wait, and act when it is your decision.'
      : 'The game is not over yet. Keep playing: call wait, and act when it is your decision.';
  const [cmd, argv] = codex ? ['codex', codexArgv(s, first, first ? `${systemPrompt(s)}\n\n${prompt}` : prompt, serverArgs)] : ['claude', [
    '-p', prompt,
    '--model', s.model,
    ...(first ? ['--session-id', s.session, '--append-system-prompt', systemPrompt(s)] : ['--resume', s.session]),
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
  ]];
  s.starts++;
  s.startsHere++;
  saveState();
  const transcript = createWriteStream(join(out, `seat-${s.p + 1}.jsonl`), { flags: 'a' });
  const errLog = createWriteStream(join(out, `seat-${s.p + 1}.stderr.log`), { flags: 'a' });
  const proc = spawn(cmd, argv, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: tmp, BOARD_LITE_WAIT_SECS: '120', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
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
        if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.model === 'string') s.modelId = msg.model;
        // Codex (codex exec --json): its thread, to resume, and the tokens each turn used.
        if (msg.type === 'thread.started' && typeof msg.thread_id === 'string') { s.session = msg.thread_id; saveState(); }
        if (msg.type === 'turn.completed' && msg.usage) s.tokens += (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
      } catch { /* partial or non-JSON line */ }
    }
  });
  proc.stderr!.pipe(errLog);
  proc.on('exit', (code) => {
    note(`${pname(s.p)} (${s.label}) process exited with code ${code}; ${isCodex(s.model) ? `used ${s.tokens} tokens` : `spent $${s.cost.toFixed(2)}`} so far.`);
    s.proc = null;
    s.exitedAt = Date.now();
    saveState();
  });
  s.proc = proc;
  note(`${pname(s.p)} (${s.label}) ${first ? 'starts' : 'resumes'}.`);
}

// A Codex seat's `codex exec` command line, sandboxed like a Claude seat: the
// game's MCP server is its only way to act. Codex's shell, web, image, browser,
// plugin and sub-agent tools are switched off; none of the owner's Codex config,
// rules, hooks or project docs load (--ignore-user-config; auth still comes from
// ~/.codex). Codex 0.154 keeps two things on: apply_patch, which the read-only
// sandbox rejects, and "code mode", a JavaScript runner it calls tools through,
// which has no require, fetch or files. Checked by hand on 0.154: see "Codex
// seats" in docs/eval.md. Codex takes no separate system prompt here, so the
// first prompt carries it.
const CODEX_OFF = [
  'shell_tool', 'unified_exec', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation',
  'view_image', 'multi_agent', 'plugins', 'remote_plugin', 'hooks', 'goals', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest',
];
function codexArgv(s: Seat, first: boolean, prompt: string, serverArgs: string[]): string[] {
  const str = (v: string) => JSON.stringify(v); // a TOML basic string
  const config = [
    `mcp_servers.game.command=${str(process.execPath)}`,
    `mcp_servers.game.args=[${serverArgs.map(str).join(', ')}]`,
    'mcp_servers.game.env={ BOARD_LITE_WAIT_SECS = "120" }',
    'mcp_servers.game.tool_timeout_sec=300', // wait blocks up to 120 s; Codex's default timeout is 60
    'mcp_servers.game.default_tools_approval_mode="approve"',
    'approval_policy="never"',
    'sandbox_mode="read-only"',
    'web_search="disabled"',
    'agents.max_depth=0', // no sub-agents (--disable multi_agent leaves them on)
    'project_doc_max_bytes=0',
    'history.persistence="none"',
    ...(effort ? [`model_reasoning_effort=${str(effort)}`] : []),
  ];
  const model = s.model.slice('codex:'.length);
  return [
    'exec', ...(first ? [] : ['resume', s.session]),
    '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    ...(model ? ['--model', model] : []),
    ...CODEX_OFF.flatMap((f) => ['--disable', f]),
    ...config.flatMap((c) => ['-c', c]),
    prompt,
  ];
}

function note(text: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${text}`;
  console.log(line);
  appendFileSync(join(out, 'runner.log'), `${line}\n`);
}

// What sits in each seat: a configuration (model and options) for this
// runner's Claude seats, else the room's seat.
function seatLabel(q: number): string {
  const mine = seats.find((s) => s.p === q);
  if (mine) return mine.label;
  const t = table[q];
  return t?.kind === 'bot' ? 'bot' : `${t?.kind === 'open' ? 'open' : 'player'}: ${t?.name ?? '?'}`;
}

// The code the game ran on, so its stats can be counted under the same rules
// later (src/playtest/stats.ts); "-dirty" if it had uncommitted changes.
const commit = (() => {
  try { return execFileSync('git', ['describe', '--always', '--dirty'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }).trim(); } catch { return undefined; }
})();

// What a Claude or Codex seat ran on and spent, for results.json.
function spent(s: Seat) {
  return { ...(s.modelId && s.modelId !== s.model ? { modelId: s.modelId } : {}), costUsd: Math.round(s.cost * 100) / 100, ...(s.tokens ? { tokens: s.tokens } : {}), starts: s.starts };
}

function writeResults(g: Game | null, status: string, started: number) {
  const base = { status, ...(commit ? { commit } : {}), ...(hosted ? { seed } : { room: roomUrl }), ...(effort ? { effort } : {}), ...(advice ? { advice } : {}), minutes: Math.round((Date.now() - started) / 600) / 100 };
  if (!g) {
    writeFileSync(join(out, 'results.json'), `${JSON.stringify({ ...base, seats: seats.map((s) => ({ seat: pname(s.p), model: s.label, options: s.options, ...spent(s) })) }, null, 2)}\n`);
    return { ...base, rounds: 0, winner: null };
  }
  const log = g.log.map((e) => `[r${e.round}]${e.to ? ` (only ${e.to.map(pname).join(', ')})` : ''} ${e.text}`);
  writeFileSync(join(out, 'log.txt'), `${log.join('\n')}\n`);
  writeFileSync(join(out, 'talk.txt'), `${log.filter((l) => / says: "| \(private\): "/.test(l)).join('\n')}\n`);
  const results = {
    ...base,
    rounds: g.round,
    winner: g.winner === null ? null : { seat: pname(g.winner), model: seatLabel(g.winner) },
    seats: g.players.map((_, q) => {
      const s = seats.find((x) => x.p === q);
      return { seat: pname(q), name: table[q]?.name, model: seatLabel(q), ...(s ? { options: s.options } : {}), points: score(g, q).total, ...(s ? spent(s) : {}) };
    }),
    talk: { public: g.log.filter((e) => / says: "/.test(e.text)).length, private: g.log.filter((e) => / \(private\): "/.test(e.text)).length },
  };
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

const pool = defaultPool();
let interrupted = false;

/** Blocks until this game's Claude seats fit in the machine-wide pool. */
async function admit(): Promise<boolean> {
  const claudeSeats = specs.filter((m) => m.model !== 'bot').length;
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

// The game as the host saved it, for the results (a room hosted elsewhere on this machine saves it too).
function finalGame(): Game | null {
  if (hosted) return hosted.game;
  return gameFile && existsSync(gameFile) ? load(gameFile) : null;
}

async function main() {
  const stopAll = () => { for (const s of seats) s.proc?.kill('SIGTERM'); };
  process.on('SIGINT', () => { interrupted = true; stopAll(); });
  process.on('SIGTERM', () => { interrupted = true; stopAll(); });
  process.on('exit', () => {
    release(pool);
    if (seats.length) { // no runner holds this directory any more
      try { const st = readState(out); delete st.pid; writeFileSync(stateFile(out), `${JSON.stringify(st, null, 2)}\n`); } catch { /* nothing saved */ }
    }
  });
  let status = 'running';
  if (!(await admit())) status = 'interrupted';

  // Take the seats: Claude seats join the room like any player; when hosting, bots too, then start.
  if (joinUrl) {
    const m = /^(https?:\/\/[^/]+)\/(?:tv\?room=)?([A-Za-z]{4})\/?$/.exec(joinUrl);
    if (!m) throw new Error('A room URL looks like http://localhost:8080/ABCD (the TV shows it).');
    roomUrl = `${m[1]}/${m[2].toUpperCase()}`;
    api = `${m[1]}/api/rooms/${m[2].toUpperCase()}`;
  } else await host();
  note(`${resumed ? 'Resuming: ' : ''}${hosted ? 'Playtest' : 'Claude players'} in ${out}: room ${roomUrl}${hosted ? `; seed ${seed}` : ''}; budget $${budget} per Claude player.`);
  if (status === 'running' && resumed) await reclaim(resumed);
  else if (status === 'running') {
    for (const { model, options, label } of specs) {
      if (model === 'bot') { await call('/bot', { token: hosted!.hostToken }); continue; }
      const name = seatName((await lobby()).seats.map((t) => t.name));
      const r = await call('/join', { name, via: 'claude' });
      seats.push({ p: r.seat - 1, model, options, label, token: r.token, session: isCodex(model) ? '' : randomUUID(), proc: null, starts: 0, startsHere: 0, cost: 0, tokens: 0, exitedAt: 0 });
      saveState();
      note(`${name} (${label}) takes seat ${r.seat}.`);
    }
    if (hosted) hosted.start(hosted.hostToken, seed);
    else note('Waiting for the game to start (press Start game on the TV, or the first to join does on their phone).');
    while (!(await lobby()).started && !interrupted) await new Promise((r) => setTimeout(r, 2000));
    if (interrupted) status = 'interrupted';
    table = (await lobby()).seats;
    gameFile ||= (await lobby()).file;
    listBesideGame();
    note(`The table: ${table.map((t, q) => `${pname(q)} ${t.name} (${seatLabel(q)})`).join(', ')}.`);
  }
  const started = Date.now();
  if (status === 'running') for (const s of seats) startSeat(s);

  // Follow the game through the first Claude seat's eyes (only to see that it moves and when it ends).
  let since = 0, lastChange = Date.now(), lowSince = 0;
  const watcher = seats[0];
  for (;;) {
    if (status !== 'running') break;
    await new Promise((r) => setTimeout(r, 1000));
    if (interrupted) { status = 'interrupted'; break; }
    let over = false, saved = false;
    if (watcher) {
      const r = await call(`/listen?token=${watcher.token}&since=${since}&timeout=0`).catch(() => null);
      if (r) {
        if (r.next !== since) { since = r.next; lastChange = Date.now(); }
        over = r.state?.game?.phase === 'over';
        saved = !!r.state?.lobby?.saved;
      }
    } else {
      over = hosted?.game?.phase === 'over';
      saved = !!hosted?.savedAt;
    }
    // Someone at the table saved the game: the Claude players leave with
    // everyone else, and come back when it continues.
    if (saved) { status = 'saved'; break; }
    // Free memory under the floor for 10 s: stop this game before the machine OOMs.
    if (pool.memAvailableMb() >= FLOOR_MB) lowSince = 0;
    else if (!lowSince) lowSince = Date.now();
    else if (Date.now() - lowSince > 10000) { status = 'low memory'; break; }
    if (over) {
      // Give the players a moment to see the end and sign off.
      const until = Date.now() + 120000;
      while (seats.some((s) => s.proc) && Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
      break;
    }
    if (Date.now() - started > maxMinutes * 60000) { status = 'time limit'; break; }
    if (Date.now() - lastChange > stallMinutes * 60000) { status = 'stalled'; break; }
    for (const s of seats) {
      if (s.proc) continue;
      if (s.cost >= budget) { status = `${pname(s.p)} hit its budget`; break; }
      if (s.startsHere >= 30) { status = `${pname(s.p)} kept stopping`; break; }
      if (Date.now() - s.exitedAt > 3000) startSeat(s);
    }
  }
  if (status === 'running') status = 'over';
  stopAll();
  const results = writeResults(finalGame(), status, started);
  note(`Finished (${results.status}) after ${results.rounds} rounds. Winner: ${results.winner ? `${results.winner.seat} (${results.winner.model})` : 'none'}.`);
  note(`Results: ${join(out, 'results.json')}${results.rounds ? `; full log with talk: ${join(out, 'log.txt')}` : ''}.`);
  if (status === 'saved' && !hosted) note('The game is saved. Continue it on the TV or a phone, and the Claude players come back to their seats.');
  if (status !== 'over' && seats.length && table.length) note(`The game isn't over. To bring the Claude players back to their seats: node src/playtest/run.ts --resume ${out}`);
  process.exit(0); // the hosted server would keep the process alive
}

// --resume: back into the seats this runner's Claude players held, in the game
// under way. The old seat token still holds the seat unless the player quit or
// someone took it over; then joining with the seat's name takes it back.
async function reclaim(state: RunnerState) {
  const l = await lobby();
  if (!l.started) throw new Error(`The game in ${roomUrl} hasn't started, so there's nothing to resume; start a new runner with --room instead.`);
  table = l.seats;
  gameFile ||= l.file;
  const now = await call(`/listen?token=${state.seats[0].token}&since=0&timeout=0`).catch(() => null);
  if (now && /^The game is over/.test(now.status)) throw new Error(`The game in ${roomUrl} is already over.`);
  for (const [i, saved] of state.seats.entries()) {
    const name = table[saved.p]?.name;
    if (!name) throw new Error(`Seat ${saved.p + 1} isn't in the game in ${roomUrl}; is this the right room?`);
    const s: Seat = { ...saved, tokens: saved.tokens ?? 0, options: specs[i].options, label: specs[i].label, proc: null, startsHere: 0, exitedAt: 0 };
    if (!(await call(`?token=${s.token}`)).seated) {
      const r = await call('/join', { name, via: 'claude' }).catch((e: Error) => { throw new Error(`Can't take seat ${saved.p + 1} (${name}) back: ${e.message}`); });
      s.token = r.token;
    }
    seats.push(s);
    note(`${name} (${s.label}) is back in seat ${s.p + 1}${s.starts ? ', with its memory of the game so far' : ''}.`);
  }
  saveState();
  listBesideGame();
  note(`The table: ${table.map((t, q) => `${pname(q)} ${t.name} (${seatLabel(q)})`).join(', ')}.`);
}

void main();
