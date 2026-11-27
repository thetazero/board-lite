// What a public website adds to the server (--public https://...): limits on
// what one visitor, and everyone together, can use, the headers a public page
// should have, and clearing old games off the disk. At home none of it is on.
// Seating Claude players from the server is off there too: see server.ts.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

export interface Site {
  origin: string; // https://example.com: the address players use
  trustProxy?: boolean; // behind a reverse proxy, which says who the visitor is in X-Forwarded-For
  limits?: Partial<typeof LIMITS>; // tests lower them
}

// Per visitor, sized so a whole table behind one home's address fits easily.
export const LIMITS = {
  requestsPerMinute: 600,
  roomsPerHour: 20,
  wrongCodesPerMinute: 30, // so no one finds games by trying codes
  open: 60, // event streams and waits held open at once
  openTotal: 3000,
  roomsTotal: 500,
};

export const WAIT_MAX_SECS = 60; // how long a wait or listen may be held open
export const LOBBY_IDLE_MS = 60 * 60 * 1000; // forget a room that never started, with no one in it, after an hour
export const SAVED_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // a saved game, and every room's files, after 30 days
export const RECAP_KEEP_MS = 365 * 24 * 60 * 60 * 1000;

export class LimitError extends Error {}

export function parseOrigin(url: string): string {
  const u = URL.canParse(url) ? new URL(url) : null;
  if (!u || !/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search || u.hash) throw new Error(`The public address looks like https://example.com, not ${url}`);
  return u.origin;
}

/** Who a request is from, for the limits. One IPv6 home is a whole /64. */
export function visitor(req: IncomingMessage, trustProxy = false): string {
  // The last address is the one our own proxy added; those before it are the visitor's say-so.
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)!.trim() : '';
  const ip = (forwarded || req.socket.remoteAddress || '').replace(/^::ffff:(?=\d+\.)/, '');
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  return [...a, ...(tail === undefined ? [] : Array<string>(Math.max(0, 8 - a.length - b.length)).fill('0')), ...b].slice(0, 4).join(':');
}

export class Limits {
  readonly max: typeof LIMITS;
  private counts = new Map<string, { n: number; until: number }>();
  private open = new Map<string, number>();
  private openTotal = 0;

  constructor(over: Partial<typeof LIMITS> = {}) {
    this.max = { ...LIMITS, ...over };
  }

  private count(key: string, max: number, ms: number, add = 1) {
    const now = Date.now();
    let c = this.counts.get(key);
    if (!c || c.until <= now) this.counts.set(key, (c = { n: 0, until: now + ms }));
    if (c.n + (add || 1) > max) throw new LimitError('Too many requests: try again later.');
    c.n += add;
  }

  request(who: string) { this.count(`request ${who}`, this.max.requestsPerMinute, 60_000); }

  newRoom(who: string, rooms: number) {
    if (rooms >= this.max.roomsTotal) throw new LimitError('Too many games are open: try again later.');
    this.count(`room ${who}`, this.max.roomsPerHour, 3600_000);
  }

  /** Before looking up a code: refused once this visitor has tried too many wrong ones. */
  mayLookUp(who: string) { this.count(`code ${who}`, this.max.wrongCodesPerMinute, 60_000, 0); }

  wrongCode(who: string) { this.count(`code ${who}`, this.max.wrongCodesPerMinute, 60_000); }

  /** Something held open (a stream, a wait). Returns what to call once it closes. */
  hold(who: string): () => void {
    const n = this.open.get(who) ?? 0;
    if (n >= this.max.open || this.openTotal >= this.max.openTotal) throw new LimitError('Too many connections: close one first.');
    this.open.set(who, n + 1);
    this.openTotal++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.openTotal--;
      const left = this.open.get(who)! - 1;
      if (left) this.open.set(who, left);
      else this.open.delete(who);
    };
  }

  sweep() {
    const now = Date.now();
    for (const [k, c] of this.counts) if (c.until <= now) this.counts.delete(k);
  }
}

/** The headers every answer carries. Scripts come from the site alone, and the pages' import map. */
export function headers(origin: string, web: string): Record<string, string> {
  const maps = new Set<string>();
  for (const page of ['phone.html', 'tv.html', 'recap.html']) {
    for (const m of readFileSync(join(web, page), 'utf8').matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)) {
      maps.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  return {
    'content-security-policy': `default-src 'self'; script-src ${["'self'", ...maps].join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
    ...(origin.startsWith('https:') ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}

/** Delete a room's files. */
export function removeRoom(gameFile: string) {
  const base = gameFile.replace(/\.json$/, '');
  for (const end of ['.json', '.seats.json', '.log.jsonl']) rmSync(`${base}${end}`, { force: true });
}

/** Delete the files of rooms untouched for SAVED_KEEP_MS (but not those hosted now) and old recaps. Only files the server itself names. */
export function clearOld(dir: string, hosted: (code: string) => boolean, now = Date.now()) {
  const old = (path: string, ms: number) => now - statSync(path).mtimeMs > ms;
  const names = (d: string) => { try { return readdirSync(d); } catch { return []; } };
  const rooms = new Map<string, string[]>();
  for (const n of names(dir)) {
    const code = /^([A-Z]{4})(\.seats|\.log)?\.jsonl?$/.exec(n)?.[1];
    if (code && !hosted(code)) rooms.set(code, [...(rooms.get(code) ?? []), join(dir, n)]);
  }
  for (const files of rooms.values()) if (files.every((f) => old(f, SAVED_KEEP_MS))) for (const f of files) unlinkSync(f);
  for (const n of names(join(dir, 'recaps'))) {
    const f = join(dir, 'recaps', n);
    if (/^[0-9a-f]{12}\.json$/.test(n) && old(f, RECAP_KEEP_MS)) unlinkSync(f);
  }
}
