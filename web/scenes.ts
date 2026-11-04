// The TV's scenes: the moments the whole table looks up together (a round's
// production roll, a fight replayed, a raid nobody joined). The TV plays them
// (tv.ts) and the server holds everyone's next decision until they're over
// (src/server/room.ts), so the TV and the phones are always on the same
// moment. Both read the scenes and their lengths from here.

import type { GameEvent } from '../src/engine.ts';

export interface SceneEvent { round: number; ev?: GameEvent; dice?: unknown[] }

export type Scene =
  | { kind: 'roll'; at: number; rolls: number[]; ms: number } // at: the round event; rolls: the produce events with dice
  | { kind: 'fight'; at: number; combat: number[]; end: number | null; ms: number } // a raid's fight; end: its raidEnd
  | { kind: 'hunt'; at: number; combat: number[]; end: number | null; ms: number } // a great beast's fight; end: its cleared
  | { kind: 'noRaid'; at: number; ms: number };

// Each player's dice tumble a moment after the last's, all landing within
// about a second; then the table reads them.
export const ROLL_STAGGER_MS = 250;
export const ROLL_SPIN_MS = 800;
const rollMs = (n: number) => (n ? 300 + (n - 1) * ROLL_STAGGER_MS + ROLL_SPIN_MS + 1400 : 1200);

// A fight: a beat to see who's there, the hits (at most 4.5 s of them), then
// the outcome long enough to read.
export const FIGHT_LEAD_MS = 800;
export const HIT_MS = 300;
export const OUTCOME_MS = 3200;
export const hitStep = (hits: number) => Math.min(HIT_MS, 4500 / Math.max(1, hits));
const fightMs = (hits: number) => FIGHT_LEAD_MS + hits * hitStep(hits) + 400 + OUTCOME_MS;

export const NO_RAID_MS = 2500;

// The scenes in a run of new events, in order. isBeast: whether a fauna key
// is a great beast (only those fights are replayed; clearing fauna is a line
// in the feed).
export function scenesOf(events: SceneEvent[], isBeast: (fauna: string) => boolean): Scene[] {
  const out: Scene[] = [];
  const fightOf = (at: number, last: 'raidEnd' | 'cleared') => {
    const combat: number[] = [];
    for (let j = at + 1; j < events.length; j++) {
      const k = events[j].ev?.k;
      if (k === last) return { combat, end: j };
      if (k === 'combat') combat.push(j);
    }
    return { combat, end: null };
  };
  const hits = (combat: number[]) => combat.reduce((s, j) => s + (events[j].ev as Extract<GameEvent, { k: 'combat' }>).hits.length, 0);
  events.forEach((e, at) => {
    const ev = e.ev;
    if (ev?.k === 'round') {
      const rolls = events.flatMap((x, j) => (j > at && x.round === e.round && x.ev?.k === 'produce' && x.dice?.length ? [j] : []));
      out.push({ kind: 'roll', at, rolls, ms: rollMs(rolls.length) });
    } else if (ev?.k === 'fight') {
      const f = fightOf(at, 'raidEnd');
      out.push({ kind: 'fight', at, ...f, ms: fightMs(hits(f.combat)) });
    } else if (ev?.k === 'hunt' && isBeast(ev.fauna)) {
      const f = fightOf(at, 'cleared');
      out.push({ kind: 'hunt', at, ...f, ms: fightMs(hits(f.combat)) });
    } else if (ev?.k === 'noRaid' && ev.why !== 'unable') {
      // A raid nobody could join (no dragon was ready) is no scene at all.
      out.push({ kind: 'noRaid', at, ms: NO_RAID_MS });
    }
  });
  return out;
}

export const scenesMs = (scenes: Scene[]) => scenes.reduce((s, x) => s + x.ms, 0);
