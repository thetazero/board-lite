// POST /mcp: how a Claude client someone brings (Claude Code, a claude.ai
// connector, anything that speaks MCP or can post JSON) joins a game, given its
// link. MCP's streamable HTTP transport with no sessions: `join` gives a seat
// token and every other tool takes the game and that token, so nothing is lost
// in a restart. The server runs no model: whoever brings the client pays for it.
// Each tool goes through the room like a phone does, and sees only its own seat.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_IMAGE_KEY, mapImage } from '../mapimage.ts';
import { ACT_HELP, RULES_HELP, SAY_HELP, VIEW_HELP, waitHelp } from '../seattools.ts';
import { eventLine, seatStatus, seatView } from '../view.ts';
import { LimitError } from './public.ts';
import { RoomError, type Room } from './room.ts';

const WAIT_SECS = 50; // under the minute many clients and proxies give a request
const RECENT = 25;

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Args = Record<string, unknown>;
export type FindRoom = (code: string) => Room;

/** A room's code, from its link (or the TV's), or the code itself. */
export function codeIn(link: string): string {
  const code = /(?:^|\/|[?&]room=)([A-Za-z]{4})\/?(?:[?#].*)?$/.exec(link.trim())?.[1];
  if (!code) throw new RoomError('A game is its link, like https://example.com/ABCD, or its 4-letter code.');
  return code.toUpperCase();
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const GAME = { type: 'string', description: "The game's link, or its 4-letter room code." };
const TOKEN = { type: 'string', description: 'Your seat token, from join. Keep it to yourself.' };
const tool = (description: string, properties: object, required: string[]) => ({ description, inputSchema: { type: 'object', properties, required } });

const TOOLS = {
  join: tool('Take a seat in a game, before it starts (or take back your own seat, by its name, when no one is at it). Returns your seat token, which every other tool needs.', { game: GAME, name: { type: 'string', description: 'Your name at the table, up to 12 characters.' } }, ['game', 'name']),
  view: tool(VIEW_HELP, { game: GAME, token: TOKEN }, ['game', 'token']),
  act: tool(ACT_HELP, { game: GAME, token: TOKEN, command: { type: 'string' } }, ['game', 'token', 'command']),
  say: tool(SAY_HELP, { game: GAME, token: TOKEN, message: { type: 'string' }, to: { type: 'string', description: 'A player like "P2" for a private message.' } }, ['game', 'token', 'message']),
  wait: tool(waitHelp(WAIT_SECS), { game: GAME, token: TOKEN }, ['game', 'token']),
  rules: tool(RULES_HELP, {}, []),
};

let rules = '';
const rulesText = () => (rules ||= readFileSync(fileURLToPath(new URL('../../docs/rules.md', import.meta.url)), 'utf8'));

// The game log index each seat's player has been shown events up to, by token.
// After a restart it starts again from the recent events.
const seen = new WeakMap<Room, Map<string, number>>();

async function listen(room: Room, tok: string, secs: number, head?: string): Promise<string> {
  const mine = seen.get(room) ?? new Map<string, number>();
  seen.set(room, mine);
  const since = mine.get(tok) ?? Math.max(0, (room.game?.log.length ?? 0) - RECENT);
  const r = await room.listen(tok, since, secs * 1000);
  mine.set(tok, r.next);
  return [head, r.events.length ? `New events:\n${r.events.map((e) => `  ${eventLine(e)}`).join('\n')}` : 'No new events.', seatStatus(r.state)].filter(Boolean).join('\n');
}

async function act(room: Room, tok: string, command: string): Promise<string> {
  room.command(tok, command, 'claude');
  return listen(room, tok, 0, 'Done.');
}

async function run(name: keyof typeof TOOLS, a: Args, find: FindRoom): Promise<Content[]> {
  const say = (t: string): Content[] => [{ type: 'text', text: t }];
  if (name === 'rules') return say(rulesText());
  const room = find(codeIn(text(a.game)));
  if (name === 'join') {
    const seat = room.join(text(a.name), 'player', 'claude');
    return say(`You are ${seat.name}, P${room.seats.indexOf(seat) + 1}, in room ${room.code}.\nYour token: ${seat.token}\nRead the rules, then wait, view and act until the game ends.`);
  }
  const tok = text(a.token);
  switch (name) {
    case 'view': {
      const s = room.state(tok);
      if (!s.you) return say(await listen(room, tok, 0)); // refuses a token with no seat here
      await listen(room, tok, 0); // the view shows the recent events: don't repeat them on the next wait
      return s.game
        ? [{ type: 'text', text: `${seatView(s, RECENT)}\n\n${MAP_IMAGE_KEY}` }, { type: 'image', data: mapImage(s.game, s.you.seat).toString('base64'), mimeType: 'image/png' }]
        : say(seatView(s, RECENT));
    }
    case 'act':
      return say(await act(room, tok, text(a.command)));
    case 'say':
      return say(await act(room, tok, a.to ? `tell ${text(a.to)} ${text(a.message)}` : `say ${text(a.message)}`));
    case 'wait':
      return say(await listen(room, tok, WAIT_SECS));
  }
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

/** Answers one JSON-RPC message; null for a notification, which has no answer. */
export async function rpc(msg: unknown, find: FindRoom): Promise<object | null> {
  const m = (msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : {}) as { id?: unknown; method?: unknown; params?: Args };
  const id = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null;
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (typeof m.method !== 'string') return error(-32600, 'Invalid request');
  if (id === null) return null;
  const result = (r: object) => ({ jsonrpc: '2.0', id, result: r });
  switch (m.method) {
    case 'initialize': {
      const asked = text(m.params?.protocolVersion);
      return result({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'board-lite', version: '0.1.0' },
        instructions: 'Play a seat in a game of board-lite, given its link: join, then wait, view and act until the game ends.',
      });
    }
    case 'ping':
      return result({});
    case 'tools/list':
      return result({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, ...t })) });
    case 'tools/call': {
      const name = text(m.params?.name);
      if (!Object.hasOwn(TOOLS, name)) return error(-32602, `Unknown tool ${name}`);
      const args = m.params?.arguments;
      try {
        return result({ content: await run(name as keyof typeof TOOLS, args && typeof args === 'object' ? (args as Args) : {}, find) });
      } catch (e) {
        const told = e instanceof RoomError || e instanceof LimitError;
        if (!told) console.error(e);
        return result({ content: [{ type: 'text', text: `Not allowed: ${told ? (e as Error).message : 'Something went wrong on the server.'}` }], isError: true });
      }
    }
    default:
      return error(-32601, `Method not found: ${m.method}`);
  }
}

/** How a Claude client plays, as it reads it from the game's link (`room`) or the site's /llms.txt. */
export function guide(origin: string, room?: string): string {
  const link = room ? `${origin}/${room}` : `${origin}/ABCD`;
  return `# board-lite: how an AI player joins

board-lite is a board game played on phones and a TV. Anyone with a game's link can take a seat, AI players included.

- Game: ${room ? link : `its link, like ${link}`}
- MCP server: ${origin}/mcp (streamable HTTP, no sign-in)

## With MCP

Claude Code: \`claude mcp add --transport http board-lite ${origin}/mcp\`. On claude.ai, add ${origin}/mcp as a custom connector.

Call \`join\` with the game's link and a name. It returns a seat token: pass the link and that token to every other tool. Read \`rules\`, then repeat \`wait\`, \`view\` and \`act\` until the game ends. Use \`say\` to talk to the table.

## With plain HTTP

The same tools, one JSON-RPC POST each, with nothing to set up:

\`\`\`
curl -s ${origin}/mcp -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"join","arguments":{"game":"${link}","name":"Claude"}}}'
\`\`\`

${Object.entries(TOOLS).map(([name, t]) => `- \`${name}\` (${Object.keys(t.inputSchema.properties).join(', ') || 'no arguments'}): ${t.description}`).join('\n')}
`;
}
