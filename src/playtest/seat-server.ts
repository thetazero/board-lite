#!/usr/bin/env node
// An MCP server (stdio, JSON-RPC) that is a playtest player's only way to
// touch the world: it plays one seat of one game and nothing else. The game
// file and seat are fixed by the command line, so the player can't see other
// hands, act for another seat, or reach files, shell or network.
//
//   node src/playtest/seat-server.ts <game.json> <seat>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { RuleError, apply, pname, waitingOn, type Game } from '../engine.ts';
import { load, save, withLock } from '../store.ts';
import { commandHints, playerView } from '../view.ts';

const [file, seatArg] = process.argv.slice(2);
const seat = Number(seatArg) - 1;
if (!file || !(seat >= 0)) {
  console.error('Usage: seat-server.ts <game.json> <seat>');
  process.exit(1);
}
const WAIT_SECS = Number(process.env.BOARD_LITE_WAIT_SECS ?? 60);

const visible = (g: Game) => g.log.filter((e) => !e.to || e.to.includes(seat));
const isTalk = (text: string) => / says: "| \(private\): "/.test(text);
let seen = 0; // how much of this seat's visible log the player has been shown

function newEvents(g: Game): string[] {
  const v = visible(g);
  const out = v.slice(seen).map((e) => `[r${e.round}] ${e.text}`);
  seen = v.length;
  return out;
}

function statusLine(g: Game): string {
  if (g.phase === 'over') return `The game is over. ${g.winner !== null ? `${pname(g.winner)} won.` : ''}`;
  const hints = commandHints(g, seat);
  if (hints.length) return `It's your decision. Your options:\n${hints.map((h) => `  ${h}`).join('\n')}`;
  return `Not your decision. Waiting on: ${waitingOn(g).map(pname).join(', ')}.`;
}

function report(g: Game, head?: string): string {
  const ev = newEvents(g);
  return [head, ev.length ? `New events:\n${ev.map((e) => `  ${e}`).join('\n')}` : 'No new events.', statusLine(g)].filter(Boolean).join('\n');
}

function act(command: string): string {
  return withLock(file, () => {
    const g = load(file);
    try {
      apply(g, seat, command);
    } catch (e) {
      if (e instanceof RuleError) return `Not allowed: ${e.message}`;
      throw e;
    }
    save(file, g);
    return report(g, 'Done.');
  });
}

async function wait(): Promise<string> {
  const end = Date.now() + WAIT_SECS * 1000;
  for (;;) {
    const g = load(file);
    const fresh = visible(g).slice(seen);
    const talk = fresh.some((e) => isTalk(e.text) && !e.text.startsWith(`${pname(seat)} `));
    if (g.phase === 'over' || waitingOn(g).includes(seat) || talk || Date.now() > end) return report(g);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const TOOLS = [
  {
    name: 'view',
    description: 'See the game as your seat sees it: scores, your hidden resources and hand, the public board, recent events, and your options when it is your decision.',
    inputSchema: { type: 'object', properties: { log: { type: 'number', description: 'How many recent events to include (default 25).' } } },
    run: (a: { log?: number }) => {
      const g = load(file);
      newEvents(g);
      return playerView(g, seat, a.log ?? 25);
    },
  },
  {
    name: 'act',
    description: 'Make a game decision as your seat, e.g. "build c12 2,-1", "offer P2 give 2 stone get 1 gold", "accept o40", "end", "vote 2", "commit d3", "ready", "fight", "bail", "stay", "discard c4". Returns what happened and your next options.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    run: (a: { command: string }) => act(String(a.command ?? '')),
  },
  {
    name: 'say',
    description: 'Talk to the table. Without "to", everyone hears it; with "to" (e.g. "P2"), only that player does. Allowed any time, even when it is not your decision. Talk binds no one: only accepted offers do.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, to: { type: 'string', description: 'A player like "P2" for a private message.' } }, required: ['message'] },
    run: (a: { message: string; to?: string }) => act(a.to ? `tell ${a.to} ${a.message}` : `say ${a.message}`),
  },
  {
    name: 'wait',
    description: `Wait (up to ${WAIT_SECS}s) until it is your decision, someone talks to you or the table, or the game ends. Returns the new events, including talk, and your status.`,
    inputSchema: { type: 'object', properties: {} },
    run: () => wait(),
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
        instructions: `You are ${pname(seat)} in a game of board-lite. These tools are your only way to play.`,
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
