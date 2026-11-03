// The board-lite web server: serves the TV and phone clients and runs rooms.
// node:http, server-sent events for pushes, and the browser's TypeScript is
// stripped of types on the fly (no build step). The TV's 3D board uses three.js,
// served from node_modules at /vendor/three/.
//
//   node src/server/server.ts [--port 8080] [--game <file>]
//
// The TV opens http://<this machine>:<port>/tv, phones open
// http://<this machine>:<port>/ and type the room code.

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, RoomError, type RoomOptions } from './room.ts';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const THREE_BUILD = fileURLToPath(new URL('../../node_modules/three/build/', import.meta.url));
const VENDOR: Record<string, string> = { '/vendor/three/three.module.js': 'three.module.js', '/vendor/three/three.core.js': 'three.core.js' };
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000; // forget rooms untouched for 6 hours
const MAX_BODY = 4096;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PAGES: Record<string, string> = { '/': 'phone.html', '/tv': 'tv.html' };

export function startServer(port: number, opts: RoomOptions = {}, hostFiles: string[] = [], host = '0.0.0.0'): { server: Server; rooms: Map<string, Room> } {
  const rooms = new Map<string, Room>();
  // Saved games to host (e.g. one started in the CLI's file mode): every seat starts open.
  for (const file of hostFiles) {
    const room = new Room(Room.newCode((c) => rooms.has(c)), { ...opts, file });
    rooms.set(room.code, room);
  }
  const stripped = new Map<string, { src: string; js: string }>();

  setInterval(() => {
    for (const [code, room] of rooms) {
      if (Date.now() - room.lastActive > ROOM_IDLE_MS && !hostFiles.includes(room.file)) {
        room.close();
        rooms.delete(code);
      }
    }
  }, 10 * 60 * 1000).unref();

  function getRoom(code: string): Room {
    const room = rooms.get(code.toUpperCase());
    if (!room) throw new RoomError(`No game with code ${code.toUpperCase()}. Check the code on the TV.`);
    return room;
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (data.length > MAX_BODY) throw new RoomError('Request too large.');
    }
    try {
      const v = JSON.parse(data || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      throw new RoomError('Bad request.');
    }
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  function events(req: IncomingMessage, res: ServerResponse, room: Room, tok: string | null) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const send = () => res.write(`data: ${JSON.stringify(room.snapshot(tok))}\n\n`);
    const unsubscribe = room.subscribe(send);
    const disconnect = room.connect(tok);
    send();
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      disconnect();
    });
  }

  async function api(req: IncomingMessage, res: ServerResponse, parts: string[], query: URLSearchParams) {
    // GET /api/info -> the addresses phones can reach this server on
    if (parts[0] === 'info') return json(res, 200, { lan: lanAddresses(), tailscale: tailscaleAddresses(), port: (req.socket.localPort ?? 0) });
    if (parts[0] !== 'rooms') return json(res, 404, { error: 'Not found.' });
    // POST /api/rooms -> a new room, for the TV
    if (parts.length === 1 && req.method === 'POST') {
      const room = new Room(Room.newCode((c) => rooms.has(c), opts.dir), opts);
      rooms.set(room.code, room);
      return json(res, 200, { code: room.code, hostToken: room.hostToken });
    }
    const room = getRoom(parts[1] ?? '');
    const action = parts[2];
    if (action === 'events' && req.method === 'GET') return events(req, res, room, query.get('token'));
    // Plain text, for players at the command line (src/cli.ts with a room URL).
    if (req.method === 'GET' && action === 'view') return text(res, room.viewText(query.get('token') ?? '', Number(query.get('log') ?? 25)));
    if (req.method === 'GET' && action === 'status') return text(res, room.statusText());
    if (req.method === 'GET' && action === 'wait') {
      const secs = Math.min(Number(query.get('timeout') ?? 60) || 60, 3600);
      const r = await room.wait(query.get('token') ?? '', secs * 1000);
      return json(res, 200, r);
    }
    if (req.method === 'GET' && action === 'listen') {
      const secs = Math.min(Number(query.get('timeout') ?? 0) || 0, 3600);
      return json(res, 200, await room.listen(query.get('token') ?? '', Number(query.get('since') ?? 0) || 0, secs * 1000));
    }
    // GET /api/rooms/CODE?token=... -> does the room exist, is this token seated in it, and who's in it
    if (!action && req.method === 'GET') return json(res, 200, { seated: room.seatOf(query.get('token') ?? '') >= 0, host: query.get('token') === room.hostToken, lobby: room.lobby() });
    if (req.method !== 'POST') return json(res, 404, { error: 'Not found.' });
    const b = await body(req);
    const tok = str(b.token);
    const host = tok === room.hostToken;
    switch (action) {
      case 'join': {
        const seat = room.join(str(b.name));
        return json(res, 200, { token: seat.token, seat: room.seats.indexOf(seat) + 1 });
      }
      case 'bot':
        if (!room.canStart(tok)) throw new RoomError('Only the TV or the first player can add bots.');
        room.addBot();
        return json(res, 200, {});
      case 'leave': {
        // A player can leave the lobby; the TV or first player can remove anyone.
        const i = typeof b.seat === 'number' ? b.seat : room.seatOf(tok);
        if (i !== room.seatOf(tok) && !room.canStart(tok)) throw new RoomError('You can only remove yourself.');
        room.leave(i);
        return json(res, 200, {});
      }
      case 'start':
        room.start(tok);
        return json(res, 200, {});
      case 'do':
        if (host) throw new RoomError('The TV has no seat.');
        return json(res, 200, { text: room.command(tok, str(b.command)) });
    }
    return json(res, 404, { error: 'Not found.' });
  }

  function text(res: ServerResponse, body: string) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body.endsWith('\n') ? body : `${body}\n`);
  }

  async function file(res: ServerResponse, path: string) {
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
    res.writeHead(200, { 'content-type': TYPES[ext] ?? '', 'cache-control': 'no-cache' });
    res.end(text);
  }

  async function vendor(res: ServerResponse, name: string) {
    const text = await readFile(join(THREE_BUILD, name), 'utf8').catch(() => null);
    if (text === null) return json(res, 404, { error: 'three.js is missing: run npm install.' });
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'max-age=86400' });
    res.end(text);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (parts[0] === 'api') return await api(req, res, parts.slice(1), url.searchParams);
      if (PAGES[url.pathname]) return await file(res, PAGES[url.pathname]);
      if (VENDOR[url.pathname]) return await vendor(res, VENDOR[url.pathname]);
      if (/^\/[A-Za-z]{4}\/?$/.test(url.pathname)) return await file(res, 'phone.html'); // a room's address
      return await file(res, url.pathname);
    } catch (e) {
      if (e instanceof RoomError) return json(res, 400, { error: e.message });
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
    }
  });
  server.listen(port, host);
  return { server, rooms };
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
  const { server, rooms } = startServer(port, {}, game ? [resolve(game)] : []);
  server.on('listening', () => {
    const hosts = lanAddresses();
    const tail = tailscaleAddresses();
    console.log(`board-lite is running on port ${port}.`);
    for (const r of rooms.values()) console.log(`  Hosting ${r.file} as room ${r.code}: TV http://localhost:${port}/tv?room=${r.code}`);
    console.log(`  TV:     http://localhost:${port}/tv${hosts.length ? `   (or http://${hosts[0]}:${port}/tv)` : ''}`);
    for (const h of hosts) console.log(`  Phones: http://${h}:${port}/`);
    for (const h of tail) console.log(`  Phones over Tailscale: http://${h}:${port}/`);
    if (!hosts.length && !tail.length) console.log('  No network address found: phones need to be on the same network as this machine.');
  });
}
