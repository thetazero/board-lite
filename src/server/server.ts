// The board-lite web server: serves the TV and phone clients and runs rooms.
// node:http, server-sent events for pushes, and the browser's TypeScript is
// stripped of types on the fly (no build step). The TV's 3D board uses three.js,
// served from node_modules at /vendor/three/.
//
//   node src/server/server.ts [--port 8080] [--game <file>] [--data <dir>]
//                             [--public https://example.com [--trust-proxy]]
//
// --public is the server as a public website (docs/deploy.md).
//
// The TV opens http://<this machine>:<port>/tv, phones open
// http://<this machine>:<port>/ and type the room code.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guide, rpc } from './mcp.ts';
import { LOBBY_IDLE_MS, LimitError, Limits, SAVED_KEEP_MS, WAIT_MAX_SECS, clearOld, headers, parseOrigin, removeRoom, visitor, type Site } from './public.ts';
import { ROOMS_DIR, Room, RoomError, claudeRunners, recapsDir, type RoomOptions } from './room.ts';
import { VIAS, type Via } from './gamelog.ts';
import { rulebook, type SavedGame } from '../state.ts';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
// Found the way Node finds any package, so a checkout that shares a parent's
// node_modules (a git worktree inside the repo) still serves it.
const THREE_BUILD = (() => {
  try {
    return fileURLToPath(new URL('./', import.meta.resolve('three')));
  } catch {
    return fileURLToPath(new URL('../../node_modules/three/build/', import.meta.url));
  }
})();
const VENDOR: Record<string, string> = { '/vendor/three/three.module.js': 'three.module.js', '/vendor/three/three.core.js': 'three.core.js' };
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000; // forget rooms untouched for 6 hours (never a saved game)
const ABANDONED_MS = 10 * 60 * 1000; // and a game every player quit after 10 minutes, if no one is back
const MAX_BODY = 4096;
const MAX_MCP_BODY = 16384;
export const PING_MS = 15000; // web/common.ts's STALE_MS allows for a couple missed
const RECAP_ID = /^[0-9a-f]{12}$/; // Room.recapId

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// A browser that ignores the pages' icon link still asks for /favicon.ico.
const PAGES: Record<string, string> = { '/': 'phone.html', '/tv': 'tv.html', '/favicon.ico': 'favicon.svg' };

// `resume`: host again every room active in the last few hours, and every saved game (a restart), each
// under its own code, so the TV and phones reconnect to the same seats.
export function startServer(port: number, opts: RoomOptions = {}, hostFiles: string[] = [], host = '0.0.0.0', resume = false, site?: Site): { server: Server; rooms: Map<string, Room> } {
  const rooms = new Map<string, Room>();
  if (site) opts = { ...opts, hideFile: true };
  const limits = site ? new Limits(site.limits) : null;
  const extra = site ? headers(site.origin, WEB) : {};
  const who = (req: IncomingMessage) => visitor(req, site?.trustProxy);
  if (resume) {
    for (const { code, file } of Room.saved(opts.dir, ROOM_IDLE_MS)) {
      if (hostFiles.includes(file)) continue;
      try {
        rooms.set(code, new Room(code, { ...opts, file }));
      } catch (e) {
        console.error(`Could not host room ${code} again (${file}):`, e);
      }
    }
  }
  // Saved games to host: hosted before, it keeps its code and seats; otherwise
  // every seat starts open.
  for (const file of hostFiles) {
    const was = Room.savedCode(file);
    const code = was && !rooms.has(was) ? was : Room.newCode((c) => rooms.has(c), opts.dir);
    const room = new Room(code, { ...opts, file });
    rooms.set(room.code, room);
  }
  const stripped = new Map<string, { src: string; js: string }>();

  const clear = () => {
    try {
      clearOld(opts.dir ?? ROOMS_DIR, (code) => rooms.has(code));
    } catch (e) {
      console.error('Could not clear old games:', e);
    }
  };
  if (site) {
    setInterval(clear, 60 * 60 * 1000).unref();
    clear();
  }
  setInterval(() => {
    limits?.sweep();
    for (const [code, room] of rooms) {
      const idle = Date.now() - room.lastActive;
      // A saved game is kept until someone continues it; on a public website, for 30 days.
      if (room.savedAt && !(site && Date.now() - room.savedAt > SAVED_KEEP_MS && idle > ROOM_IDLE_MS)) continue;
      if ((idle > ROOM_IDLE_MS || (site && !room.game && idle > LOBBY_IDLE_MS && !room.watchers) || (room.abandoned && idle > ABANDONED_MS)) && !hostFiles.includes(room.file)) {
        room.close();
        rooms.delete(code);
        if (room.savedAt) removeRoom(room.file); // or the next restart would host it again
      }
    }
  }, 60 * 1000).unref();

  // `by` looks it up: a public website limits how many wrong codes one visitor tries.
  function getRoom(code: string, by: string): Room {
    limits?.mayLookUp(by);
    const room = rooms.get(code.toUpperCase());
    if (!room) limits?.wrongCode(by);
    if (!room) throw new RoomError(`No room with code ${code.toUpperCase()}. Check the code on the TV.`);
    return room;
  }

  async function body(req: IncomingMessage, max = MAX_BODY): Promise<Record<string, unknown>> {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (data.length > max) throw new RoomError('Request too large.');
    }
    try {
      const v = JSON.parse(data || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      throw new RoomError('Bad request.');
    }
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  // What a client says it is (a phone, the CLI, a Claude player), for the game log.
  const via = (v: unknown) => (VIAS.includes(str(v)) ? (v as Via) : undefined);

  const maxWait = site ? WAIT_MAX_SECS : 3600;
  async function holding<T>(req: IncomingMessage, wait: () => Promise<T>): Promise<T> {
    const release = limits?.hold(who(req));
    try {
      return await wait();
    } finally {
      release?.();
    }
  }

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  function events(req: IncomingMessage, res: ServerResponse, room: Room, tok: string | null, query: URLSearchParams) {
    const release = limits?.hold(who(req));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' });
    const send = () => res.write(`data: ${JSON.stringify(room.snapshot(tok))}\n\n`);
    const unsubscribe = room.subscribe(send);
    const disconnect = room.connect(tok, tok === null && query.has('tv'));
    send();
    // A named event, not an SSE comment: the page hears it, so a stream that
    // went quiet (dead under a restart or a network change, with no error)
    // is noticed and opened again (web/common.ts, watch).
    const ping = setInterval(() => res.write('event: ping\ndata: 1\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      release?.();
      unsubscribe();
      disconnect();
    });
  }

  // POST /mcp: a Claude client someone brings plays through here (mcp.ts).
  async function mcp(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      return res.end();
    }
    const release = limits?.hold(who(req)); // a wait is held open
    try {
      const answer = await rpc(await body(req, MAX_MCP_BODY), (code) => getRoom(code, who(req)));
      if (answer) return json(res, 200, answer);
      res.writeHead(202);
      res.end();
    } finally {
      release?.();
    }
  }

  // How a Claude client joins, for one that reads the game's link rather than drawing its page.
  function showGuide(req: IncomingMessage, res: ServerResponse, code?: string) {
    const text = guide(site?.origin ?? `http://${req.headers.host ?? 'localhost'}`, code?.toUpperCase());
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache', vary: 'accept' });
    res.end(text);
  }

  async function api(req: IncomingMessage, res: ServerResponse, parts: string[], query: URLSearchParams) {
    // GET /api/info -> the addresses phones can reach this server on
    // (a public website has one address, and says nothing about its machine)
    if (parts[0] === 'info' && site) return json(res, 200, { lan: [], tailscale: [], port: 0, origin: site.origin });
    if (parts[0] === 'info') return json(res, 200, { lan: lanAddresses(), tailscale: tailscaleAddresses(), port: (req.socket.localPort ?? 0) });
    // GET /api/recaps/ID -> a finished game's recap (src/recap.ts), kept after its room is gone
    // GET /api/rulebook -> every building, card, beast and kingdom, for the phone's rulebook
    if (parts[0] === 'rulebook' && req.method === 'GET') return json(res, 200, rulebook());
    if (parts[0] === 'recaps' && parts.length === 2 && req.method === 'GET') return recap(res, parts[1]);
    // GET /api/saved -> the saved games, newest first, for the TV's lobby and the join form to offer
    if (parts[0] === 'saved' && req.method === 'GET') return json(res, 200, site ? [] : savedGames()); // strangers' games aren't listed: open the room's link
    if (parts[0] !== 'rooms') return json(res, 404, { error: 'Not found.' });
    // POST /api/rooms -> a new room, for the TV; {remote: true} from a phone or the CLI, for a game with no TV (yet: a TV can open it any time)
    if (parts.length === 1 && req.method === 'POST') {
      const remote = (await body(req)).remote === true;
      limits?.newRoom(who(req), rooms.size);
      const room = new Room(Room.newCode((c) => rooms.has(c), opts.dir), { ...opts, remote });
      rooms.set(room.code, room);
      server.emit('room', room); // for whoever runs the server: how to seat terminal and Claude players
      return json(res, 200, { code: room.code, hostToken: room.hostToken });
    }
    const room = getRoom(parts[1] ?? '', who(req));
    const action = parts[2];
    if (action === 'events' && req.method === 'GET') return events(req, res, room, query.get('token'), query);
    // For clients that hold no stream open (the CLI, Claude seats): the same snapshot, on request.
    if (req.method === 'GET' && action === 'state') return json(res, 200, room.state(query.get('token') ?? ''));
    if (req.method === 'GET' && action === 'wait') {
      const secs = Math.min(Number(query.get('timeout') ?? 60) || 60, maxWait);
      const r = await holding(req, () => room.wait(query.get('token') ?? '', secs * 1000));
      return json(res, 200, r);
    }
    if (req.method === 'GET' && action === 'listen') {
      const secs = Math.min(Number(query.get('timeout') ?? 0) || 0, maxWait);
      return json(res, 200, await holding(req, () => room.listen(query.get('token') ?? '', Number(query.get('since') ?? 0) || 0, secs * 1000)));
    }
    // GET /api/rooms/CODE?token=... -> does the room exist, is this token seated in it, and who's in it
    if (!action && req.method === 'GET') return json(res, 200, { seated: room.seatOf(query.get('token') ?? '') >= 0, host: query.get('token') === room.hostToken, lobby: room.lobby() });
    if (req.method !== 'POST') return json(res, 404, { error: 'Not found.' });
    const b = await body(req);
    const tok = str(b.token);
    const host = tok === room.hostToken;
    switch (action) {
      case 'join': {
        const seat = room.join(str(b.name), 'player', via(b.via));
        return json(res, 200, { token: seat.token, seat: room.seats.indexOf(seat) + 1 });
      }
      case 'bot':
        if (!room.canStart(tok)) throw new RoomError('Only the TV or the first to join can add bots.');
        room.addBot(b.strong === true && !site); // the strong bot thinks for long enough to hold up every other game
        return json(res, 200, {});
      case 'leave': {
        // A player can leave the lobby; the TV or first player can remove anyone.
        const i = typeof b.seat === 'number' ? b.seat : room.seatOf(tok);
        if (i !== room.seatOf(tok) && !room.canStart(tok)) throw new RoomError('You can only remove yourself.');
        room.leave(i, room.senderOf(tok));
        return json(res, 200, {});
      }
      case 'quit': // mid-game: a bot plays the seat from now on
        room.quit(tok);
        return json(res, 200, {});
      case 'standin': // a player who's away: a bot plays for them until they're back
        room.standInFor(tok, Number(b.seat));
        return json(res, 200, {});
      case 'tv':
        // A TV opening the room while no other TV watches it becomes the
        // room's TV, with its buttons: a room made with no TV gets one, and a
        // TV that lost its token (another browser) takes over.
        return json(res, 200, room.tvWatching ? {} : { hostToken: room.hostToken });
      case 'start':
        room.start(tok);
        return json(res, 200, {});
      case 'save': // the TV or a player stops the game here, for everyone, to continue later
        room.save(tok);
        return json(res, 200, {});
      case 'continue':
        // Whoever runs the server brings back the Claude players who were at the table (see below).
        if (room.continue(tok)) server.emit('continue', room);
        return json(res, 200, {});
      case 'do':
        if (host) throw new RoomError('The TV has no seat.');
        room.command(tok, str(b.command), via(b.via), str(b.id) || undefined);
        return json(res, 200, { state: room.snapshot(tok) });
    }
    return json(res, 404, { error: 'Not found.' });
  }

  function savedGames(): SavedGame[] {
    return [...rooms.values()].filter((r) => r.savedAt && r.game).sort((a, b) => b.savedAt! - a.savedAt!)
      .map((r) => ({ code: r.code, savedAt: r.savedAt!, round: r.game!.round, names: r.seats.map((s) => s.name) }));
  }

  async function recap(res: ServerResponse, id: string) {
    const text = RECAP_ID.test(id) ? await readFile(join(recapsDir(opts), `${id}.json`), 'utf8').catch(() => null) : null;
    if (text === null) return json(res, 404, { error: 'No recap with that link.' });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(text);
  }

  async function file(req: IncomingMessage, res: ServerResponse, path: string) {
    const full = normalize(join(WEB, path));
    if (!full.startsWith(WEB) || full.slice(WEB.length).split(sep).some((part) => part.startsWith('.'))) return json(res, 404, { error: 'Not found.' });
    const ext = extname(full);
    if (!TYPES[ext]) return json(res, 404, { error: 'Not found.' });
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      return json(res, 404, { error: 'Not found.' });
    }
    if (ext === '.ts') {
      let hit = stripped.get(full);
      if (hit?.src !== text) {
        hit = { src: text, js: stripTypeScriptTypes(text, { mode: 'strip' }) };
        stripped.set(full, hit);
      }
      text = hit.js;
    }
    // Always checked with the server (no-cache), but a page the browser already
    // has comes back as a 304: a phone showing the table loads the shared
    // scripts once, and a reload costs almost nothing.
    const etag = `"${createHash('sha1').update(text).digest('base64url')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[ext] ?? '', 'cache-control': 'no-cache', etag });
    res.end(text);
  }

  async function vendor(res: ServerResponse, name: string) {
    const text = await readFile(join(THREE_BUILD, name), 'utf8').catch(() => null);
    if (text === null) return json(res, 404, { error: 'three.js is missing: run npm install.' });
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'max-age=86400' });
    res.end(text);
  }

  const server = createServer(async (req, res) => {
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    try {
      const url = URL.canParse(req.url ?? '/', 'http://x') ? new URL(req.url ?? '/', 'http://x') : null;
      if (!url) return json(res, 400, { error: 'Bad request.' });
      const parts = url.pathname.split('/').filter(Boolean);
      const asked = parts[0] === 'api' || parts[0] === 'mcp';
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
      if (asked) limits?.request(who(req));
      if (url.pathname === '/mcp') return await mcp(req, res);
      if (url.pathname === '/llms.txt') return showGuide(req, res);
      const page = /^\/([A-Za-z]{4})(\.md|\/)?$/.exec(url.pathname); // a room's address
      if (page && (page[2] === '.md' || /\btext\/markdown\b/.test(req.headers.accept ?? ''))) return showGuide(req, res, page[1]);
      if (parts[0] === 'api') return await api(req, res, parts.slice(1), url.searchParams);
      if (PAGES[url.pathname]) return await file(req, res, PAGES[url.pathname]);
      if (VENDOR[url.pathname]) return await vendor(res, VENDOR[url.pathname]);
      if (page) return await file(req, res, 'phone.html');
      if (parts[0] === 'recap' && parts.length === 2 && RECAP_ID.test(parts[1])) return await file(req, res, 'recap.html'); // a game's recap
      return await file(req, res, url.pathname);
    } catch (e) {
      if (e instanceof LimitError) return res.headersSent ? void res.end() : json(res, 429, { error: e.message });
      if (e instanceof RoomError) return json(res, 400, { error: e.message });
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
    }
  });
  server.listen(port, host);
  return { server, rooms };
}

// Continuing a saved game brings back the Claude players who were at it:
// each of their runners (src/playtest/run.ts, listed beside the game file)
// starts again with --resume, in this room, and its players take their own
// seats with their memory of the game. It notes what it does in its folder's
// runner.log as always; anything it fails on goes to runner.errors.log there.
// Only runners on this machine that listed themselves are started: nothing a
// phone sends names a folder.
export function bringBackClaude(room: Room, port: number) {
  const run = fileURLToPath(new URL('../playtest/run.ts', import.meta.url));
  for (const dir of claudeRunners(room.file)) {
    if (!existsSync(dir)) continue;
    const errors = openSync(join(dir, 'runner.errors.log'), 'a');
    const child = spawn(process.execPath, [run, '--resume', dir, '--room', `http://127.0.0.1:${port}/${room.code}`], { stdio: ['ignore', 'ignore', errors] });
    child.on('error', (e) => console.error(`Room ${room.code}: could not bring the Claude players in ${dir} back:`, e));
    child.unref();
    console.log(`Room ${room.code} continues: bringing back the Claude players in ${dir}.`);
  }
}

// The machine's own network addresses, by interface. Container and VM bridges
// (docker0, br-..., veth..., virbr...) aren't reachable from a phone, so they're left out.
function addresses(): { iface: string; address: string }[] {
  return Object.entries(networkInterfaces()).flatMap(([iface, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ iface, address: a.address })),
  ).filter((a) => !/^(docker|br-|veth|virbr|lxc|cni|flannel)/.test(a.iface));
}

/** Addresses on the local network (Wi-Fi, ethernet). */
export function lanAddresses(): string[] {
  return addresses().filter((a) => !a.iface.startsWith('tailscale')).map((a) => a.address);
}

/** This machine's Tailscale address(es): phones on the same tailnet reach it from anywhere. */
export function tailscaleAddresses(): string[] {
  return addresses().filter((a) => a.iface.startsWith('tailscale')).map((a) => a.address);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(flag('--port') ?? process.env.PORT ?? 8080);
  const game = flag('--game');
  const data = flag('--data') ?? process.env.BOARD_LITE_DATA;
  const address = flag('--public') ?? process.env.BOARD_LITE_PUBLIC_URL;
  if (process.argv.includes('--public') && !address) throw new Error('--public needs the address: --public https://example.com');
  const site: Site | undefined = address
    ? { origin: parseOrigin(address), trustProxy: process.argv.includes('--trust-proxy') || process.env.BOARD_LITE_TRUST_PROXY === '1' }
    : undefined;
  const { server, rooms } = startServer(port, data ? { dir: resolve(data) } : {}, game ? [resolve(game)] : [], '0.0.0.0', true, site);
  // Every change is already saved, so stopping (a deploy) loses nothing.
  if (site) for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0));
  server.on('listening', () => {
    if (site) return console.log(`board-lite is running on port ${port}, for ${site.origin} (${rooms.size} rooms).`);
    const hosts = lanAddresses();
    const tail = tailscaleAddresses();
    console.log(`board-lite is running on port ${port}.`);
    for (const r of rooms.values()) if (r.game || r.seats.length) console.log(`  Hosting ${r.file} as room ${r.code}: TV http://localhost:${port}/tv?room=${r.code}`);
    console.log(`  TV:     http://localhost:${port}/tv${hosts.length ? `   (or http://${hosts[0]}:${port}/tv)` : ''}`);
    for (const h of hosts) console.log(`  Phones: http://${h}:${port}/`);
    for (const h of tail) console.log(`  Phones over Tailscale: http://${h}:${port}/`);
    if (!hosts.length && !tail.length) console.log('  No network address found: phones need to be on the same network as this machine.');
  });
  // The TV shows only what the people in the room need; the ways to seat other
  // players go to this terminal, once per room.
  // A public website seats no Claude players of its own, and starts none when a
  // saved game continues: a Claude client someone brings joins through /mcp.
  if (!site) server.on('room', (room: Room) => {
    const url = `http://localhost:${port}/${room.code}`;
    console.log(`Room ${room.code} is open.`);
    console.log(`  At a terminal:  node src/cli.ts join ${url} <name>`);
    console.log(`  Claude players: node src/playtest/run.ts --room ${url} --models opus+expected,haiku+expected`);
    console.log(`  On a TV, any time: http://localhost:${port}/tv?room=${room.code}`);
  });
  if (!site) server.on('continue', (room: Room) => bringBackClaude(room, port));
}
