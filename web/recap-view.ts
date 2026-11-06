// A finished game's recap (src/recap.ts), drawn: the points race round by
// round with what happened along it, and where each player's points came
// from. The TV plays it at the end of a game (tv.ts); the recap page shows
// it whole (recap.ts). Ink on paper, like the end screen's sheet.

import type { Moment, Recap } from '../src/state.ts';
import { PLAYER_COLORS, esc, icon, playerTag } from './common.ts';

const ink = (p: number) => `color-mix(in oklab, ${PLAYER_COLORS[p]} 78%, #1a1218)`;

// "Ada", "Ada and Dax", "Ada, Bram and Dax"
function tags(ps: number[], names: string[]): string {
  const t = ps.map((p) => playerTag(p, names));
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t.at(-1)}` : t[0] ?? '';
}

/** One moment as a line the table reads: an event, present tense. */
export function momentHtml(m: Moment, names: string[]): string {
  if (m.k === 'title') return `${playerTag(m.p, names)} takes <b>${esc(m.name)}</b>`;
  if (m.k === 'beast') return `${playerTag(m.p, names)} slays the <b>${esc(m.name)}</b> <span class="gain">+${m.points}${icon('points', 1)}</span>`;
  const scored = m.scorer !== undefined ? `: ${playerTag(m.scorer, names)} <span class="gain">+${m.points}${icon('points', 1)}</span>` : '';
  return `<b>${esc(m.name)}</b> falls${m.times ? ` ${m.times} times` : ''} to ${tags(m.ps, names)}${scored}`;
}

// Who a moment is about, for its marks on the race.
const whoOf = (m: Moment): number[] => (m.k === 'fall' ? m.ps : [m.p]);

export interface RaceOptions {
  upTo?: number; // draw rounds 0..upTo (default: all); the last one draws itself in
  width?: number;
  height?: number;
}

// A grid step that gives about 4 to 6 lines up to `top`.
function niceStep(top: number): number {
  return [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => top / s <= 6) ?? 1000;
}

interface Lines {
  rows: number[][]; // [i][seat]: one row per round, from round `from`
  from: number; // the round of rows[0]
  last: number; // the last round on the axis
  label: string; // what the chart shows, for screen readers
  goal?: { v: number; text: string }; // a line dashed across, and what it is
  // Marks drawn over the lines, given where a round and a value fall.
  marks?: (x: (round: number) => number, y: (v: number) => number, upTo: number) => string[];
}

/**
 * Everyone's lines over the rounds, the leader on top, each ending in a dot
 * and their name and number. With `upTo`, only that far: the TV draws it a
 * round at a time.
 */
function linesSvg(r: Recap, c: Lines, opts: RaceOptions): string {
  const W = opts.width ?? 1000;
  const H = opts.height ?? 520;
  const { last, from } = c;
  const upTo = Math.min(opts.upTo ?? last, last);
  const L = 44, R = 150, T = 18, B = 58; // margins: values on the left, names on the right, rounds below
  const top = Math.max(1, c.goal?.v ?? 0, ...c.rows.flat());
  const step = niceStep(top);
  const yMax = Math.ceil((top + step / 5) / step) * step;
  const x = (i: number) => L + (last ? (i / last) * (W - L - R) : 0);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const out: string[] = [];
  // Grid, and the round numbers below.
  for (let v = 0; v <= yMax; v += step) {
    out.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 10}" y="${y(v) + 6}" text-anchor="end">${v}</text>`);
  }
  const every = last <= 12 ? 1 : last <= 30 ? 5 : 10;
  for (let i = 0; i <= last; i++) {
    if ((i % every === 0 && last - i >= every / 2) || i === last) out.push(`<text class="axis" x="${x(i)}" y="${H - B + 28}" text-anchor="middle">${i}</text>`);
  }
  out.push(`<text class="axis label" x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle">Round</text>`);
  // The goal, labelled at its start, clear of the names at the lines' ends.
  if (c.goal) out.push(`<line class="goal" x1="${L}" x2="${W - R}" y1="${y(c.goal.v)}" y2="${y(c.goal.v)}"/><text class="axis goal-label" x="${L + 8}" y="${y(c.goal.v) - 8}">${esc(c.goal.text)}</text>`);
  const shown = c.rows.slice(0, Math.max(0, upTo - from + 1));
  // The leader last, so their line is on top.
  const order = [...r.standings].reverse().map((s) => s.p);
  for (const p of order) {
    const pts = shown.map((row, i) => `${x(from + i).toFixed(1)},${y(row[p]).toFixed(1)}`);
    const before = pts.slice(0, -1);
    if (before.length > 1) out.push(`<polyline class="run" style="--pc:${ink(p)}" points="${before.join(' ')}"/>`);
    // The newest round's step, drawn in (style.css .race .grow).
    if (pts.length > 1) out.push(`<polyline class="run grow" pathLength="1" style="--pc:${ink(p)}" points="${pts.slice(-2).join(' ')}"/>`);
  }
  if (c.marks) out.push(...c.marks(x, y, upTo));
  // Each line's end: a dot and the name, nudged apart where lines end close together.
  const endRow = shown.at(-1);
  if (endRow) {
    const at = from + shown.length - 1;
    const ends = order.map((p) => ({ p, v: endRow[p], ly: y(endRow[p]) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 26);
    const over = ends.length ? ends.at(-1)!.ly - (H - B) : 0;
    if (over > 0) for (const e of ends) e.ly -= over;
    for (const e of ends) {
      out.push(`<circle class="end" style="--pc:${ink(e.p)}" cx="${x(at)}" cy="${y(e.v)}" r="6"/>`);
      out.push(`<text class="who" style="--pc:${ink(e.p)}" x="${x(at) + 14}" y="${e.ly + 7}">${esc(r.names[e.p])} <tspan class="pts">${e.v}</tspan></text>`);
    }
  }
  return `<svg class="race" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.label)}">${out.join('')}</svg>`;
}

/**
 * The points race: one line per player from the start to the last round, the
 * points to win dashed across, and a mark where each moment happened.
 */
export function raceSvg(r: Recap, opts: RaceOptions = {}): string {
  const last = r.race.length - 1;
  return linesSvg(r, {
    rows: r.race, from: 0, last, label: 'Points by round',
    goal: { v: r.pointsToWin, text: `${r.pointsToWin} to win` },
    marks: (x, y, upTo) => r.moments.filter((m) => m.round <= upTo).flatMap((m) => whoOf(m).map((p) =>
      `<circle class="mark ${m.k}${m.round === upTo ? ' new' : ''}" style="--pc:${ink(p)}" cx="${x(m.round)}" cy="${y(r.race[m.round][p])}" r="${m.k === 'title' ? 7 : 10}"/>`)),
  }, opts);
}

/** Everyone's dragon power, from the start to the last round; '' for a recap from before it was kept. */
export function powerSvg(r: Recap, opts: RaceOptions = {}): string {
  return r.power ? linesSvg(r, { rows: r.power, from: 0, last: r.race.length - 1, label: 'Dragon power by round' }, opts) : '';
}

/** What everyone's production made each round, from round 1; '' for a recap from before it was kept. */
export function madeSvg(r: Recap, opts: RaceOptions = {}): string {
  return r.made?.length ? linesSvg(r, { rows: r.made, from: 1, last: r.race.length - 1, label: 'Resources made by round' }, opts) : '';
}

const PARTS = [
  { key: 'buildings', cls: 'buildings', label: 'Buildings' },
  { key: 'titles', cls: 'titles', label: 'Titles' },
  { key: 'beasts', cls: 'beasts', label: 'Great beasts' },
  { key: 'raids', cls: 'kingdoms', label: 'Kingdoms' },
  { key: 'hidden', cls: 'hand', label: 'In hand' },
] as const;

/** Where each player's points came from: a bar per player, in final order, split by source. */
export function breakdownHtml(r: Recap): string {
  const most = Math.max(1, ...r.standings.map((s) => s.total));
  const used = PARTS.filter((part) => r.standings.some((s) => s[part.key] > 0));
  const rows = r.standings.map((s) => {
    const bits = used.filter((part) => s[part.key] > 0).map((part) => `<span class="part ${part.cls}" style="flex-grow:${s[part.key]}">${s[part.key]}</span>`).join('');
    return `<li><span class="who">${playerTag(s.p, r.names)}</span>
      <span class="bar"><span class="fill" style="width:${(100 * s.total) / most}%">${bits}</span></span>
      <b class="total">${s.total}${icon('points', 1.1)}</b></li>`;
  }).join('');
  const key = used.map((part) => `<span><i class="part ${part.cls}"></i>${part.label}</span>`).join('');
  return `<ol class="breakdown">${rows}</ol><div class="partkey">${key}</div>`;
}

/** The moments of a game, grouped by round, as a list. */
export function momentsHtml(r: Recap, upTo = Infinity): string {
  const rounds = [...new Set(r.moments.filter((m) => m.round <= upTo).map((m) => m.round))];
  if (!rounds.length) return '';
  return `<ol class="moments">${rounds.map((n) => `<li><span class="rnd">Round ${n}</span><ul>${r.moments.filter((m) => m.round === n).map((m) => `<li>${momentHtml(m, r.names)}</li>`).join('')}</ul></li>`).join('')}</ol>`;
}
