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
  | { kind: 'tend'; at: number; ms: number } // production's dragon step: at, its tend event
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

// Production's dragon step (#442), right after the resources: every player's
// dragons that heal, grow or go hungry, together on one sheet. A beat with
// them as they were, then each change plays at once: health bars fill, growth
// fills in, and a dragon that moves up a stage takes its new one. Held to be
// read, but quick: the table has just watched production.
export const TEND_LEAD_MS = 800;
export const TEND_STAGE_AT_MS = 900; // after the lead: a full growth track turns into the next stage
export const TEND_MS = 4800;

// A fight: a beat to look up and see who's there while a coin is tossed for
// who strikes first (#439), the hits (at most 6 s of them), then the outcome
// long enough to read. A kingdom that scores (#326) adds a beat of its own
// after the loot: the crown comes down on the player with the most power
// standing, then their points, held to be read.
export const FIGHT_LEAD_MS = 2400; // the coin flip's timing is in style.css (.coinflip)
export const HIT_MS = 400;
export const OUTCOME_MS = 4500;
export const CROWN_AT_MS = 2400; // after the outcome: the loot read, the crown comes down
export const POINTS_AT_MS = 1100; // after the crown: the points
export const SCORED_MS = 3800; // the points held
export const hitStep = (hits: number) => Math.min(HIT_MS, 6000 / Math.max(1, hits));
// When the outcome shows, from the scene's start.
export const outcomeAt = (hits: number) => FIGHT_LEAD_MS + hits * hitStep(hits) + 400;
const fightMs = (hits: number, scored = false) => outcomeAt(hits) + (scored ? CROWN_AT_MS + POINTS_AT_MS + SCORED_MS : OUTCOME_MS);

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
    } else if (ev?.k === 'tend') {
      out.push({ kind: 'tend', at, ms: TEND_MS });
    } else if (ev?.k === 'fight') {
      const f = fightOf(at, 'raidEnd');
      const end = f.end === null ? undefined : events[f.end].ev;
      out.push({ kind: 'fight', at, ...f, ms: fightMs(hits(f.combat), end?.k === 'raidEnd' && end.scorer !== undefined) });
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

// A table view that has fallen behind the server (#449). The server holds the
// table only while its scenes play (src/server/room.ts), and each snapshot says
// how much longer (`scene`). A table view can still have scenes to play once
// the server says none are left: a phone's table view that was away (the phone
// asleep, its stream gone) gets everything it missed as new, and one made just
// after the game started has the opening round to show. Played then, they'd
// keep the phone cut away from the vote or turn that has already opened, until
// a reload. So once the server holds nothing, the scenes still queued are
// skipped, and the one playing ends unless it's in its last moment (there,
// ending a little after the server is only the time a snapshot takes to arrive).
export const BEHIND_GRACE_MS = 1500;
export function behind(serverLeft: number, playingLeft: number | null): { skipQueued: boolean; endPlaying: boolean } {
  if (serverLeft > 0) return { skipQueued: false, endPlaying: false };
  return { skipQueued: true, endPlaying: playingLeft !== null && playingLeft > BEHIND_GRACE_MS };
}
