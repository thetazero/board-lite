#!/usr/bin/env node
// An MCP server (stdio, JSON-RPC) that is a Claude player's only way to touch
// the world: it plays one seat at one room on a board-lite server, through the
// same room interface the phones and the CLI use. The room and the seat's token
// are fixed by the command line, so the player can't see other hands, act for
// another seat, or reach files, shell or anything else on the network.
//
//   node src/playtest/seat-server.ts <room-url> <token> [moves-file]
//
// The room URL looks like http://localhost:8080/ABCD. With a moves file, every
// act and say is appended to it with the player's private reason ("why") and
// what actually happened, so a playtest audit can read why each move was made.
// Claude Code drops thinking from `claude -p` transcripts, so this is the record.

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { EventView, Snapshot } from '../state.ts';
import { eventLine, seatStatus, seatView } from '../view.ts';

const [roomUrl, token, movesFile] = process.argv.slice(2);
const m = /^(https?:\/\/[^/]+)\/([A-Za-z]{4})\/?$/.exec(roomUrl ?? '');
if (!m || !token) {
  console.error('Usage: seat-server.ts <room-url> <token>');
  process.exit(1);
}
const api = `${m[1]}/api/rooms/${m[2].toUpperCase()}`;
const WAIT_SECS = Number(process.env.BOARD_LITE_WAIT_SECS ?? 60);
let seen = 0; // the game log index the player has been shown events up to

async function call(path: string, body?: object): Promise<Record<string, any>> {
  const r = await fetch(api + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const type = r.headers.get('content-type') ?? '';
  const data = type.includes('json') ? ((await r.json()) as Record<string, any>) : { text: await r.text() };
  if (!r.ok) return { error: String(data.error ?? data.text ?? `HTTP ${r.status}`) };
  return data;
}

const q = (o: Record<string, string | number>) => `?${new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]))}`;

// New events since the player last looked (talk included), then its status.
async function listen(timeoutSecs: number, head?: string): Promise<string> {
  const r = await call(`/listen${q({ token, since: seen, timeout: timeoutSecs })}`);
  if (r.error) return `Error: ${r.error}`;
  seen = r.next;
  const ev: EventView[] = r.events;
  return [head, ev.length ? `New events:\n${ev.map((e) => `  ${eventLine(e)}`).join('\n')}` : 'No new events.', seatStatus(r.state as Snapshot)].filter(Boolean).join('\n');
}

function record(command: string, why: string | undefined, outcome: string) {
  if (!movesFile) return;
  const time = new Date().toISOString().slice(11, 19);
  appendFileSync(movesFile, `${time} ${command}\n${why ? `  why: ${why.replace(/\s+/g, ' ').trim()}\n` : ''}  -> ${outcome}\n`);
}

async function act(command: string, why?: string): Promise<string> {
  const r = await call('/do', { token, command });
  if (r.error) {
    record(command, why, `not allowed: ${r.error}`);
    return `Not allowed: ${r.error}`;
  }
  record(command, why, 'done');
  return listen(0, 'Done.');
}

const WHY = { type: 'string', description: 'Private: one or two sentences on why you chose this. No other player ever sees it; it is kept for the people studying the game after it ends.' };

const TOOLS = [
  {
    name: 'view',
    description: 'See the game as your seat sees it: scores, your hidden resources and hand, the public board, recent events, and your options when it is your decision.',
    inputSchema: { type: 'object', properties: { log: { type: 'number', description: 'How many recent events to include (default 25).' } } },
    run: async (a: { log?: number }) => {
      const r = await call(`/state${q({ token })}`);
      if (r.error) return `Error: ${r.error}`;
      await listen(0); // the view shows the recent events: don't repeat them on the next wait
      return seatView(r as Snapshot, a.log ?? 25);
    },
  },
  {
    name: 'act',
    description: 'Make a game decision as your seat, e.g. "keep c12", "build c12 2,-1", "build quarry 2,-1", "offer P2 give 2 stone get 1 gold", "offer anyone give 1 crystal get 1 timber", "accept o40", "clear 2,-1 d3", "end", "vote 2", "commit d3", "ready", "fight", "hold", "discard c4". Returns what happened and your next options.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, why: WHY }, required: ['command', 'why'] },
    run: (a: { command: string; why?: string }) => act(String(a.command ?? ''), a.why),
  },
  {
    name: 'say',
    description: 'Talk to the table. Without "to", everyone hears it; with "to" (e.g. "P2"), only that player does. Allowed any time, even when it is not your decision. Talk binds no one: only accepted offers do.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, to: { type: 'string', description: 'A player like "P2" for a private message.' }, why: WHY }, required: ['message'] },
    run: (a: { message: string; to?: string; why?: string }) => act(a.to ? `tell ${a.to} ${a.message}` : `say ${a.message}`, a.why),
  },
  {
    name: 'wait',
    description: `Wait (up to ${WAIT_SECS}s) until it is your decision, someone talks to you or the table, or the game ends. On your own turn with an offer out, it waits for an answer. Returns the new events, including talk, and your status.`,
    inputSchema: { type: 'object', properties: {} },
    run: () => listen(WAIT_SECS),
  },
  {
    name: 'rules',
    description: 'The full rules of board-lite.',
    inputSchema: { type: 'object', properties: {} },
    run: () => readFileSync(fileURLToPath(new URL('../../docs/rules.md', import.meta.url)), 'utf8'),
  },
] as const;

function send(msg: object) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(req: { id?: number | string; method: string; params?: any }) {
  const reply = (result: object) => req.id !== undefined && send({ jsonrpc: '2.0', id: req.id, result });
  switch (req.method) {
    case 'initialize':
      return reply({
        protocolVersion: req.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'board-lite-seat', version: '0.1.0' },
        instructions: 'You are one player in a game of board-lite. These tools are your only way to play.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === req.params?.name);
      if (!tool) return send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `Unknown tool ${req.params?.name}` } });
      try {
        const text = await (tool.run as (a: any) => string | Promise<string>)(req.params?.arguments ?? {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  void handle(req);
});
