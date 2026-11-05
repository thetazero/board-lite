// The TV's scenes: the moments the whole table looks up together (a round's
// production, a fight replayed, a raid nobody joined). The TV plays them
// (tv.ts) and the server holds everyone's next decision until they're over
// (src/server/room.ts), so the TV and the phones are always on the same
// moment. Both read the scenes and their lengths from here.

import type { GameEvent } from '../src/engine.ts';

export interface SceneEvent { round: number; ev?: GameEvent; dice?: unknown[] }

export type Scene =
  | { kind: 'roll'; at: number; rolls: number[]; ms: number } // at: the round event; rolls: the produce events of players who make or eat anything
  | { kind: 'fight'; at: number; combat: number[]; end: number | null; ms: number } // a raid's fight; end: its raidEnd
  | { kind: 'hunt'; at: number; combat: number[]; end: number | null; ms: number } // a fight against fauna; end: its cleared
  | { kind: 'noRaid'; at: number; ms: number };

// Every length here allows for a table whose eyes are on their phones: the
// phone says "Watch the TV" when a scene starts, and it takes a moment to
// look up. So nothing important happens in a scene's first beat, and its
// result stays up long enough to read after looking up late.

// A round's production, one player at a time (#230): a beat to look up, then
// each player's card comes in and lists what they make, one resource at a
// time: the fixed amount, then that resource's dice tumbling and landing, then
// the total. Then the player's total, held a moment, and the next player. At
// the end, everyone's totals together, long enough to read after looking up
// late. A big table has many rows, so each row's step shrinks to keep every
// row together within PROD_ROWS_MAX_MS.
export const PROD_LEAD_MS = 900;
export const PROD_PLAYER_IN_MS = 450;
export const PROD_ROW_MS = 900;
export const PROD_ROWS_MAX_MS = 10000;
export const PROD_TOTAL_MS = 1000;
export const PROD_END_MS = 3500;
export const prodStep = (rows: number) => Math.min(PROD_ROW_MS, PROD_ROWS_MAX_MS / Math.max(1, rows));
// How long a row's dice tumble before they land: most of the row's step.
export const prodSpin = (rows: number) => Math.round(prodStep(rows) * 0.65);
// rows: for each player who makes or eats anything, how many rows they show.
export const prodMs = (rows: number[]) => {
  if (!rows.length) return 2200; // nothing made: the round's number, briefly
  const all = rows.reduce((a, b) => a + b, 0);
  return PROD_LEAD_MS + rows.length * (PROD_PLAYER_IN_MS + PROD_TOTAL_MS) + all * prodStep(all) + PROD_END_MS;
};
// The resources a produce event's player makes something of, in order.
const RESOURCES = ['stone', 'timber', 'crystal', 'livestock', 'gold'] as const;
export const madeOf = (ev: GameEvent | undefined) => (ev?.k === 'produce' ? RESOURCES.filter((r) => (ev.got[r] ?? 0) > 0) : []);
// A produce event's rows on the TV: one per resource made. What their dragons
// eat comes off the livestock row, which shows even if they make none (#309).
export const eatOf = (ev: GameEvent | undefined) => (ev?.k === 'produce' ? (ev.eat ?? 0) : 0);
export const prodRowsOf = (ev: GameEvent | undefined) => madeOf(ev).length + (eatOf(ev) && !madeOf(ev).includes('livestock') ? 1 : 0);

// A fight: a beat to look up and see who's there, the hits (at most 6 s of
// them), then the outcome long enough to read.
export const FIGHT_LEAD_MS = 1600;
export const HIT_MS = 400;
export const OUTCOME_MS = 4500;
export const hitStep = (hits: number) => Math.min(HIT_MS, 6000 / Math.max(1, hits));
const fightMs = (hits: number) => FIGHT_LEAD_MS + hits * hitStep(hits) + 400 + OUTCOME_MS;

export const NO_RAID_MS = 4000;

// The scenes in a run of new events, in order.
export function scenesOf(events: SceneEvent[]): Scene[] {
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
      const rolls = events.flatMap((x, j) => (j > at && x.round === e.round && prodRowsOf(x.ev) ? [j] : []));
      out.push({ kind: 'roll', at, rolls, ms: prodMs(rolls.map((j) => prodRowsOf(events[j].ev))) });
    } else if (ev?.k === 'fight') {
      const f = fightOf(at, 'raidEnd');
      out.push({ kind: 'fight', at, ...f, ms: fightMs(hits(f.combat)) });
    } else if (ev?.k === 'hunt') {
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
