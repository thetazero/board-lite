// The Rust rules (rust/src), called from TypeScript: the tools and tests keep
// plain game objects, and each call sends one over as JSON. Built by
// `npm run wasm:build` into rust/board_lite.wasm.
import { TUNING } from './data.ts';
import type { Game } from './engine.ts';

interface Exports { memory: { buffer: ArrayBuffer }; room(n: number): number; ask(at: number, n: number): bigint; done(at: number, n: number): void }
let rules: Exports | null = null;
function load(): Exports {
  // Node's modules by hand: the web pages' type check reads this file, and has no Node types.
  const node = (globalThis as any).process;
  const { existsSync, readFileSync } = node.getBuiltinModule('node:fs');
  const file = node.getBuiltinModule('node:url').fileURLToPath(new URL('../rust/board_lite.wasm', import.meta.url));
  if (!existsSync(file)) throw new Error('The rules are not built: npm run wasm:build (it needs Rust, and: rustup target add wasm32-unknown-unknown)');
  const W = (globalThis as any).WebAssembly;
  return (rules = new W.Instance(new W.Module(readFileSync(file)), {}).exports as Exports);
}
const enc = new TextEncoder(), dec = new TextDecoder();

export class Refused extends Error {}

// `g` goes over without its log unless `log`: most of the rules only add to it.
export function ask(op: string, g: Game | null, q: object = {}, log = false): any {
  const w = rules ?? load();
  const sent = g && !log ? { ...g, log: [] } : g;
  const bytes = enc.encode(JSON.stringify({ op, g: sent ?? undefined, q, win: TUNING.pointsToWin }));
  const at = w.room(bytes.length);
  new Uint8Array(w.memory.buffer, at, bytes.length).set(bytes);
  let packed: bigint;
  try {
    packed = BigInt.asUintN(64, w.ask(at, bytes.length));
  } catch (e) {
    rules = null; // a panic leaves it unusable: the next call starts afresh
    throw e;
  }
  const out = Number(packed >> 32n), n = Number(packed & 0xffffffffn);
  const r = JSON.parse(dec.decode(new Uint8Array(w.memory.buffer, out, n)));
  w.done(out, n);
  if (r.rule !== undefined) throw new Refused(r.rule);
  if (r.error !== undefined) throw new Error(r.error);
  return r.ok;
}

// Makes `was` what `now` is, in place, so whoever holds one of its objects
// still does: things with ids (cards, dragons, offers) are matched by them.
export function become(was: any, now: any): any {
  if (!was || !now || typeof was !== 'object' || typeof now !== 'object' || Array.isArray(was) !== Array.isArray(now)) return now;
  if (Array.isArray(was)) {
    const byId = new Map(was.filter((x) => x && typeof x === 'object' && 'id' in x).map((x) => [x.id, x]));
    const next = now.map((x: any, i: number) => (x && typeof x === 'object' && 'id' in x ? become(byId.get(x.id), x) : become(was[i], x)));
    was.splice(0, was.length, ...next);
    return was;
  }
  for (const k of Object.keys(was)) if (!(k in now)) delete was[k];
  for (const k of Object.keys(now)) was[k] = become(was[k], now[k]);
  return was;
}

// A move: the game after it, its new log entries added to the log it had.
export function moved(op: string, g: Game, q: object, log = false): { cmd: string | null; state: number } {
  const r = ask(op, g, q, log);
  const entries = g.log;
  const { log: added, ...rest } = r.g;
  const { log: _, ...mine } = g;
  const next = become(mine, rest);
  for (const k of Object.keys(g)) if (k !== 'log' && !(k in next)) delete (g as any)[k];
  Object.assign(g, next);
  entries.push(...added);
  return r;
}
