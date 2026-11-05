#!/usr/bin/env node
// What happened in each playtest game, counted from its game.json, not judged
// by a model: where each seat's points came from round by round, titles, what
// was built, played and hatched, raids, fauna, trades, the bank and talk. Then
// the same rolled up over a batch, with what's never or always used flagged,
// and two batches side by side. See "Stats" in docs/playtest.md.
//
//   node src/playtest/stats.ts DIR                  print a batch's stats (saving each exact game to DIR/stats.json)
//   node src/playtest/stats.ts --compare DIR1 DIR2  two batches side by side
//
// Points are rebuilt from the log's events (buildings, floors, dragons and
// their growth, titles, great beasts: none of them ever goes away) and scored
// with the engine's own score(). The rebuilt end state is checked against the
// saved game, so a mismatch shows instead of a wrong number.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ACTIONS, BEASTS, BUILDINGS, DRAGONS, ELEMENTS, FAUNA, TARGETS, UPGRADES } from '../data.ts';
import { type Game, type GameEvent, score } from '../engine.ts';

type Count = Record<string, number[]>; // key -> per seat

export interface SeatPoints { buildings: number; titles: number; beasts: number; public: number }
export interface GameStats {
  game: string;
  commit?: string; // the code it was played on, from results.json
  rounds: number;
  winner: number | null;
  seats: { seat: string; name: string; model: string; final: number; hidden: number }[];
  points: SeatPoints[][]; // [round-1][seat]: public points at the end of each round
  titles: { round: number; title: string; p: number | null }[];
  titleRounds: Record<string, number[]>; // rounds each seat ended holding each title
  offered: Record<string, number>; // cards seen: drawn, or offered to keep
  kept: Record<string, number>; // building-deck cards kept
  built: Count;
  upgraded: Count;
  played: Count; // action cards
  hatched: Count; // dragon keys hatched (cards and projects); starting dragons not counted
  elements: Count; // every dragon a seat ended with, by element, starting ones included
  projects: Count; // special projects: building type, 'tower_floor' or 'egg'
  hoards: number[]; // Secret Hoards in hand at the end
  raids: { targets: Record<string, { chosen: number; fell: number }>; joined: number[]; fell: number[]; loot: number[]; bailed: number[]; gold: number[] };
  fauna: Record<string, { tried: number[]; cleared: number[] }>;
  trades: { offers: number[]; accepted: number[]; declined: number[] }; // accepted: trades a seat was in
  bank: { trades: number[]; gave: number[]; got: number[] };
  talk: { said: number[]; told: number[]; words: number[] };
  check: string[]; // what doesn't add up: the rebuild against the saved game, or today's rules against the game's own final scores
}

const zeros = (n: number) => Array<number>(n).fill(0);
const bump = (c: Count, k: string, p: number, n: number, by = 1) => { (c[k] ??= zeros(n))[p] += by; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// Names by key: today's cards, and whatever names older games' logs used, so a
// game played before a card was renamed or cut still reads (#97).
const NAMES: Record<string, string> = Object.fromEntries(
  [BUILDINGS, UPGRADES, ACTIONS, DRAGONS, FAUNA, BEASTS, TARGETS].flatMap((m) => Object.entries(m).map(([k, d]) => [k, d.name])),
);
NAMES.egg = 'Base egg';
const nm = (k: string) => NAMES[k] ?? k;
const NAME_TO_KEY: Record<string, string> = Object.fromEntries(
  [BUILDINGS, UPGRADES, ACTIONS, DRAGONS].flatMap((m) => Object.entries(m).map(([k, d]) => [d.name, k])),
);
const keyOfName = (name: string) => NAME_TO_KEY[name] ?? name.toLowerCase().replace(/'/g, '').replace(/\W+/g, '_');

// A game's stats; `res` is its results.json, for the seats' models.
export function gameStats(g: Game, res: { commit?: string; seats: { name?: string; model: string }[] }, game = ''): GameStats {
  const n = g.players.length;
  const fin = g.log.findLast((e) => e.ev?.k === 'final')?.ev as Extract<GameEvent, { k: 'final' }> | undefined;
  const s: GameStats = {
    game, commit: res.commit, rounds: g.round, winner: g.winner,
    seats: g.players.map((_, p) => ({ seat: `P${p + 1}`, name: res.seats[p]?.name ?? '', model: res.seats[p]?.model ?? '?', final: fin?.totals[p] ?? score(g, p).total, hidden: score(g, p).hidden })),
    points: [], titles: [], titleRounds: {}, offered: {}, kept: {}, built: {}, upgraded: {}, played: {}, hatched: {}, elements: {}, projects: {},
    hoards: g.players.map((_, p) => score(g, p).hidden),
    raids: { targets: {}, joined: zeros(n), fell: zeros(n), loot: zeros(n), bailed: zeros(n), gold: zeros(n) },
    fauna: {}, trades: { offers: zeros(n), accepted: zeros(n), declined: zeros(n) },
    bank: { trades: zeros(n), gave: zeros(n), got: zeros(n) }, talk: { said: zeros(n), told: zeros(n), words: zeros(n) }, check: [],
  };

  // The rebuilt board: what score() reads. Towers start bare, buildings and
  // hatched dragons appear as the log says, starting dragons are there from the start.
  const hatchedIds = new Set(g.log.flatMap((e) => (e.ev?.k === 'hatch' ? [e.ev.d] : [])));
  const keyOf = Object.fromEntries(g.dragons.map((d) => [d.id, d.key]));
  const r: Game = {
    ...g,
    players: g.players.map((pl) => ({ ...pl, hand: [] })),
    buildings: Object.fromEntries(g.towers.map((k, p) => [k, { type: 'tower', owner: p, upgrade: null, floors: 0 }])),
    dragons: g.dragons.filter((d) => !hatchedIds.has(d.id)).map((d) => ({ ...d, stage: 0 })),
    titles: { army: null, tower: null, hoard: null }, slain: {},
  };
  const dragon = (id: string) => r.dragons.find((d) => d.id === id)!;
  const snap = () => {
    s.points.push(g.players.map((_, p) => { const x = score(r, p); return { buildings: x.buildings, titles: x.titles, beasts: x.beasts, public: x.public }; }));
    for (const [t, h] of Object.entries(r.titles)) if (h !== null) bump(s.titleRounds, t, h, n);
  };
  let target = '';
  for (const e of g.log) {
    const ev = e.ev as GameEvent;
    if ('name' in ev) { const x = ev as { name: string; b?: string; u?: string; card?: string; fauna?: string; t?: string }; NAMES[x.b ?? x.u ?? x.card ?? x.fauna ?? x.t ?? ''] ??= x.name; }
    switch (ev.k) {
      case 'round': if (ev.n > 1) snap(); break;
      case 'mine': {
        const m = /^You (draw|keep) (.*)\.$/.exec(e.text);
        if (!m) break;
        // "Sky Wyrm (c84), and building cards Crystal Spire (c43), Port (c42): keep one"
        for (const [, name] of m[2].replace(/(^|, )(and )?building cards /g, '$1').matchAll(/([^,:]+?) \(c\d+\)/g)) {
          const k = keyOfName(name.trim());
          const tally = m[1] === 'draw' ? s.offered : s.kept;
          tally[k] = (tally[k] ?? 0) + 1;
        }
        break;
      }
      case 'build':
        r.buildings[ev.hex] = { type: ev.b, owner: ev.p, upgrade: null, floors: 0 };
        bump(s.built, ev.b, ev.p, n);
        if (ev.project) bump(s.projects, ev.b, ev.p, n);
        break;
      case 'floor':
        r.buildings[r.towers[ev.p]].floors = ev.floors;
        bump(s.built, 'tower_floor', ev.p, n);
        if (ev.project) bump(s.projects, 'tower_floor', ev.p, n);
        break;
      case 'upgrade':
        r.buildings[ev.hex].upgrade = ev.u;
        bump(s.upgraded, ev.u, ev.p, n);
        break;
      case 'hatch':
        r.dragons.push({ id: ev.d, owner: ev.p, key: keyOf[ev.d], stage: 0, growth: 0, damage: 0, resting: '' });
        bump(s.hatched, keyOf[ev.d], ev.p, n);
        if (ev.project) bump(s.projects, 'egg', ev.p, n);
        break;
      case 'grow': dragon(ev.d).stage = ev.stage; break;
      case 'play':
        bump(s.played, ev.card, ev.p, n);
        if (ev.card === 'growth_elixir' && ev.d) dragon(ev.d).stage++;
        break;
      case 'title':
        r.titles[ev.t] = ev.p;
        s.titles.push({ round: e.round, title: ev.t, p: ev.p });
        break;
      case 'hunt': (s.fauna[ev.fauna] ??= { tried: zeros(n), cleared: zeros(n) }).tried[ev.p]++; break;
      case 'cleared':
        if (ev.won) s.fauna[ev.fauna].cleared[ev.p]++;
        if (ev.won && BEASTS[ev.fauna]) r.slain[ev.fauna] = ev.p;
        break;
      case 'target': target = ev.t; (s.raids.targets[ev.t] ??= { chosen: 0, fell: 0 }).chosen++; break;
      case 'fight': for (const p of ev.ps) s.raids.joined[p]++; break;
      case 'bail': s.raids.bailed[ev.p]++; break;
      case 'raidEnd':
        if (ev.won) s.raids.targets[target].fell++;
        ev.winners.forEach((p, i) => {
          if (ev.won) s.raids.fell[p]++;
          if (Object.values(ev.shares[i] ?? {}).some((x) => x! > 0)) s.raids.loot[p]++;
          s.raids.gold[p] += ev.shares[i]?.gold ?? 0;
        });
        break;
      case 'offer': s.trades.offers[ev.p]++; break;
      case 'trade': s.trades.accepted[ev.from]++; s.trades.accepted[ev.to]++; break;
      case 'decline': s.trades.declined[ev.p]++; break;
      case 'bank':
        s.bank.trades[ev.p]++;
        s.bank.gave[ev.p] += sum(Object.values(ev.give) as number[]);
        s.bank.got[ev.p] += sum(Object.values(ev.get) as number[]);
        break;
      case 'talk': {
        const m = /^P(\d+) (says|to P\d+ \(private\)): "(.*)"$/s.exec(e.text);
        if (!m) break;
        const p = Number(m[1]) - 1;
        if (m[2] === 'says') s.talk.said[p]++; else s.talk.told[p]++;
        s.talk.words[p] += m[3].split(/\s+/).filter(Boolean).length;
        break;
      }
    }
  }
  snap();
  for (const d of r.dragons) bump(s.elements, DRAGONS[d.key]?.element ?? '?', d.owner, n);

  // The rebuilt end state against the saved one.
  g.players.forEach((_, p) => {
    const want = score(g, p), got = s.points.at(-1)![p];
    for (const k of ['buildings', 'titles', 'beasts'] as const) {
      if (want[k] !== got[k]) s.check.push(`P${p + 1} ${k}: rebuilt from the log ${got[k]}, the saved board ${want[k]}`);
    }
  });
  // Today's score() of the saved board against the final scores the game itself
  // logged: they differ when the scoring rules changed after the game was played.
  if (fin) fin.totals.forEach((t, p) => { if (t !== score(g, p).total) s.check.push(`P${p + 1} final: the game scored ${t}, today's rules score ${score(g, p).total}`); });
  if (s.points.length !== g.round) s.check.push(`${s.points.length} rounds rebuilt, the game played ${g.round}`);
  return s;
}

// The finished games of a batch (g1, g2, ...), each counted or, when this code
// can't read it at all (a card it no longer knows, say), its error.
type Read = { game: string; stats?: GameStats; error?: string };
function readGames(dir: string): Read[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^g\d+$/.test(d.name) && existsSync(join(dir, d.name, 'game.json')) && existsSync(join(dir, d.name, 'results.json')))
    .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1)))
    .flatMap((d): Read[] => {
      const res = JSON.parse(readFileSync(join(dir, d.name, 'results.json'), 'utf8'));
      if (res.status !== 'over') return [];
      try {
        return [{ game: d.name, stats: gameStats(JSON.parse(readFileSync(join(dir, d.name, 'game.json'), 'utf8')), res, d.name) }];
      } catch (e) {
        return [{ game: d.name, error: `${d.name} (${(e as Error).message}${res.commit ? `; played on ${res.commit}` : ''})` }];
      }
    });
}

// The finished games of a batch; a game this code can't read is left out and named in `skipped`.
export function batchStats(dir: string): { games: GameStats[]; skipped: string[] } {
  const all = readGames(dir);
  return { games: all.flatMap((x) => (x.stats ? [x.stats] : [])), skipped: all.flatMap((x) => (x.error ? [x.error] : [])) };
}

// Saved stats from before #136 counted "and building cards Port" as its own
// card; fold those keys into the card's own.
function cleanSaved(s: GameStats): GameStats {
  for (const t of [s.offered, s.kept]) {
    for (const k of Object.keys(t)) {
      const m = /^(?:and_)?building_cards_(.+)$/.exec(k);
      if (m) { t[m[1]] = (t[m[1]] ?? 0) + t[k]; delete t[k]; }
    }
  }
  return s;
}

// A batch's stats, game by game: each finished game as this code counts it;
// when that isn't exact (the rules changed since) but stats.json has the game
// from when it was, that instead. Every exact game is saved to DIR/stats.json,
// beside the games saved before, so a batch keeps its own numbers for later
// comparisons once the rules move on, and a run while the batch is still
// playing only adds the games still to come later.
export interface Batch { games: GameStats[]; skipped: string[]; saved?: string[] }
export function loadBatch(dir: string): Batch {
  const file = join(dir, 'stats.json');
  const before: GameStats[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as GameStats[]).map(cleanSaved) : [];
  const keep = new Map(before.map((s) => [s.game, s]));
  const games: GameStats[] = [], skipped: string[] = [], saved: string[] = [];
  let changed = false;
  for (const x of readGames(dir)) {
    const exact = x.stats && !x.stats.check.length;
    if (exact) {
      if (JSON.stringify(keep.get(x.game)) !== JSON.stringify(x.stats)) changed = true;
      keep.set(x.game, x.stats!);
      games.push(x.stats!);
    } else if (keep.has(x.game)) {
      games.push(keep.get(x.game)!);
      saved.push(x.game);
    } else if (x.stats) games.push(x.stats);
    else skipped.push(x.error!);
  }
  if (changed) {
    const all = [...keep.values()].sort((a, b) => Number(a.game.slice(1)) - Number(b.game.slice(1)));
    writeFileSync(file, `${JSON.stringify(all)}\n`);
  }
  return { games, skipped, ...(saved.length ? { saved } : {}) };
}

// ---------- the catalog: everything a player could use ----------

const BUILD_KEYS = Object.keys(BUILDINGS);
// Each list is today's catalog plus anything an older game used that's since gone.
const CATALOG: { what: string; keys: string[]; uses: (s: GameStats) => Count; seen?: boolean; noFlags?: boolean }[] = [
  { what: 'Buildings built', keys: BUILD_KEYS, uses: (s) => s.built, seen: true },
  { what: 'Upgrades', keys: Object.keys(UPGRADES), uses: (s) => s.upgraded, seen: true },
  { what: 'Action cards played', keys: Object.keys(ACTIONS).filter((k) => ACTIONS[k].effect !== 'hidden_point'), uses: (s) => s.played, seen: true },
  { what: 'Dragons hatched', keys: Object.keys(DRAGONS), uses: (s) => s.hatched, seen: true },
  { what: 'Dragon elements held at the end', keys: [...ELEMENTS], uses: (s) => s.elements, noFlags: true },
  { what: 'Special projects', keys: [...BUILD_KEYS.filter((k) => BUILDINGS[k].basic), 'egg'], uses: (s) => s.projects },
  { what: 'Fauna and great beasts cleared', keys: [...Object.keys(FAUNA), ...Object.keys(BEASTS)], uses: (s) => Object.fromEntries(Object.entries(s.fauna).map(([k, v]) => [k, v.cleared])) },
];

// ---------- markdown ----------

const P = (p: number | null) => (p === null ? 'no one' : `P${p + 1}`);
const TITLES = ['army', 'tower', 'hoard'];
const title = (t: string) => t[0].toUpperCase() + t.slice(1);
const avg = (x: number, n: number) => (n ? (x / n).toFixed(1).replace(/\.0$/, '') : '-');
const bySeat = (xs: number[]) => xs.map((x, p) => `P${p + 1} ${x}`).join(', ');
const counted = (c: Count, name: (k: string) => string) =>
  Object.entries(c).sort((a, b) => sum(b[1]) - sum(a[1])).map(([k, v]) => `${name(k)} ${sum(v)} (${bySeat(v)})`).join('; ') || 'none';

export function gameMarkdown(s: GameStats): string {
  const L: string[] = [];
  L.push(`### ${s.game}: ${s.rounds} rounds, ${s.winner === null ? 'no winner' : `${P(s.winner)} ${s.seats[s.winner].model} wins`}`, '');
  if (s.check.length) L.push(`**These points aren't exact:** ${s.check.join('; ')}. If the rules changed since the game was played, run stats.ts from a checkout of the commit it was played on${s.commit ? ` (${s.commit})` : ''}.`, '');
  L.push(`Points at the end of each round (public; Secret Hoards only at the end):`, '');
  L.push(`| Seat | Source | ${s.points.map((_, i) => `r${i + 1}`).join(' | ')} | Hoards | Final |`, `|---|---|${s.points.map(() => '---|').join('')}---|---|`);
  s.seats.forEach((st, p) => {
    let first = true; // the seat's name goes on its first row shown
    for (const k of ['buildings', 'titles', 'beasts', 'public'] as const) {
      const row = s.points.map((r) => r[p][k]);
      if (k !== 'public' && row.every((x) => x === 0)) continue;
      L.push(`| ${first ? `${st.seat} ${st.model}` : ''} | ${k === 'public' ? '**total**' : k} | ${row.join(' | ')} | ${k === 'public' ? st.hidden : ''} | ${k === 'public' ? `**${st.final}**` : ''} |`);
      first = false;
    }
  });
  L.push('');
  L.push(`- **Titles:** ${s.titles.map((t) => `r${t.round} ${title(t.title)} → ${P(t.p)}`).join(', ') || 'none taken'}. Rounds held: ${Object.entries(s.titleRounds).map(([t, v]) => `${title(t)} ${bySeat(v)}`).join('; ') || 'none'}.`);
  L.push(`- **Built:** ${counted(s.built, nm)}.`);
  L.push(`- **Upgrades:** ${counted(s.upgraded, nm)}.`);
  L.push(`- **Action cards played:** ${counted(s.played, nm)}. Secret Hoards held at the end: ${bySeat(s.hoards)}.`);
  L.push(`- **Dragons hatched:** ${counted(s.hatched, nm)}. Elements at the end: ${counted(s.elements, (k) => k)}.`);
  L.push(`- **Special projects:** ${counted(s.projects, nm)}.`);
  const tg = Object.entries(s.raids.targets);
  L.push(`- **Raids:** ${tg.length ? tg.map(([k, v]) => `${nm(k)} ${v.fell}/${v.chosen} fell`).join(', ') : 'none'}. Joined: ${bySeat(s.raids.joined)}; on the winning side: ${bySeat(s.raids.fell)}; took loot: ${bySeat(s.raids.loot)}; raid gold: ${bySeat(s.raids.gold)}; bailed: ${bySeat(s.raids.bailed)}.`);
  const fa = Object.entries(s.fauna);
  L.push(`- **Fauna and great beasts:** ${fa.length ? fa.map(([k, v]) => `${nm(k)} ${sum(v.cleared)}/${sum(v.tried)} cleared (${bySeat(v.cleared)})`).join('; ') : 'none fought'}.`);
  L.push(`- **Trades:** offers ${bySeat(s.trades.offers)}; accepted (either side) ${bySeat(s.trades.accepted)}; declined ${bySeat(s.trades.declined)}. **Bank:** ${bySeat(s.bank.trades)} trades, ${sum(s.bank.gave)} given for ${sum(s.bank.got)}.`);
  L.push(`- **Talk:** to the table ${bySeat(s.talk.said)}; private ${bySeat(s.talk.told)}; words ${bySeat(s.talk.words)}.`);
  return L.join('\n');
}

// Per model over a batch: games, then the per-game average of each number.
interface ModelRoll { model: string; seatGames: number; wins: number; src: SeatPoints; hidden: number; final: number; byRound: number[]; n: Record<string, number> }

function modelRolls(games: GameStats[]): ModelRoll[] {
  const out: Record<string, ModelRoll> = {};
  const maxR = Math.max(0, ...games.map((s) => s.rounds));
  const roundN: Record<string, number[]> = {};
  for (const s of games) s.seats.forEach((st, p) => {
    const m = (out[st.model] ??= { model: st.model, seatGames: 0, wins: 0, src: { buildings: 0, titles: 0, beasts: 0, public: 0 }, hidden: 0, final: 0, byRound: zeros(maxR), n: {} });
    const rn = (roundN[st.model] ??= zeros(maxR));
    m.seatGames++;
    if (s.winner === p) m.wins++;
    const end = s.points.at(-1)![p];
    for (const k of Object.keys(m.src) as (keyof SeatPoints)[]) m.src[k] += end[k];
    m.hidden += st.hidden;
    m.final += st.final;
    s.points.forEach((r, i) => { m.byRound[i] += r[p].public; rn[i]++; });
    const add = (k: string, v: number) => { m.n[k] = (m.n[k] ?? 0) + v; };
    add('built', sum(Object.entries(s.built).filter(([k]) => k !== 'tower_floor').map(([, v]) => v[p])));
    add('floors', s.built.tower_floor?.[p] ?? 0);
    add('upgrades', sum(Object.values(s.upgraded).map((v) => v[p])));
    add('cards played', sum(Object.values(s.played).map((v) => v[p])));
    add('dragons hatched', sum(Object.values(s.hatched).map((v) => v[p])));
    add('special projects', sum(Object.values(s.projects).map((v) => v[p])));
    add('raids joined', s.raids.joined[p]);
    add('raids joined that fell', s.raids.fell[p]);
    add('raids with loot', s.raids.loot[p]);
    add('raid gold', s.raids.gold[p]);
    add('bailed', s.raids.bailed[p]);
    add('fauna cleared', sum(Object.entries(s.fauna).filter(([k]) => FAUNA[k]).map(([, v]) => v.cleared[p])));
    add('great beasts slain', sum(Object.entries(s.fauna).filter(([k]) => BEASTS[k]).map(([, v]) => v.cleared[p])));
    add('trade offers', s.trades.offers[p]);
    add('trades', s.trades.accepted[p]);
    add('bank trades', s.bank.trades[p]);
    add('said', s.talk.said[p]);
    add('told', s.talk.told[p]);
    add('words', s.talk.words[p]);
    for (const t of [...new Set([...TITLES, ...games.flatMap((s) => Object.keys(s.titleRounds))])]) add(`rounds holding ${title(t)}`, s.titleRounds[t]?.[p] ?? 0);
  });
  for (const m of Object.values(out)) m.byRound = m.byRound.map((x, i) => (roundN[m.model][i] ? x / roundN[m.model][i] : NaN));
  return Object.values(out);
}

// Catalog use over a batch: per key, total uses, games used in, and seats (seat-games) that used it.
function catalogRoll(games: GameStats[], also: GameStats[] = []) {
  return CATALOG.map((c) => ({
    ...c,
    rows: [...new Set([...c.keys, ...[...games, ...also].flatMap((s) => Object.keys(c.uses(s)))])].map((k) => {
      const per = games.map((s) => c.uses(s)[k] ?? zeros(s.seats.length));
      return {
        k, name: nm(k), uses: sum(per.map(sum)),
        games: per.filter((v) => sum(v) > 0).length,
        seats: sum(per.map((v) => v.filter((x) => x > 0).length)),
        offered: sum(games.map((s) => s.offered[k] ?? 0)), kept: sum(games.map((s) => s.kept[k] ?? 0)),
      };
    }),
  }));
}

export function batchMarkdown({ games, skipped, saved }: Batch): string {
  const L: string[] = ['## What happened', ''];
  if (saved?.length) L.push(`${saved.length === games.length ? 'Every game' : saved.join(', ')} read from this batch's stats.json: the rules have changed since ${saved.length === 1 ? 'it was' : 'they were'} played, so these are the numbers counted under ${saved.length === 1 ? 'its' : 'their'} own rules.`, '');
  if (skipped.length) L.push(`**Not counted, this code can't read them (run stats.ts from the commit they were played on):** ${skipped.join(', ')}.`, '');
  if (!games.length) return [...L, 'No finished games.', ''].join('\n');
  const seatGames = sum(games.map((s) => s.seats.length));
  const bad = games.filter((s) => s.check.length);
  L.push(`Counted from each finished game's log by \`src/playtest/stats.ts\` (no model involved). Per model, averages per game it played.${bad.length ? ` **Points aren't exact in ${bad.map((s) => s.game).join(', ')}; see each game below.**` : ' Every game\'s points, rebuilt round by round, match its saved end and its own final scores.'}`, '');

  const rolls = modelRolls(games);
  L.push('### Where points came from', '');
  L.push('| Model | Seat-games | Wins | Buildings | Titles | Great beasts | Hoards | Final |', '|---|---|---|---|---|---|---|---|');
  for (const m of rolls) L.push(`| ${m.model} | ${m.seatGames} | ${m.wins} | ${avg(m.src.buildings, m.seatGames)} | ${avg(m.src.titles, m.seatGames)} | ${avg(m.src.beasts, m.seatGames)} | ${avg(m.hidden, m.seatGames)} | ${avg(m.final, m.seatGames)} |`);
  const maxR = Math.max(...games.map((s) => s.rounds));
  L.push('', 'Average public points at the end of each round (games still going that round):', '');
  L.push(`| Model | ${Array.from({ length: maxR }, (_, i) => `r${i + 1}`).join(' | ')} |`, `|---|${'---|'.repeat(maxR)}`);
  for (const m of rolls) L.push(`| ${m.model} | ${m.byRound.map((x) => (Number.isNaN(x) ? '-' : x.toFixed(1))).join(' | ')} |`);

  L.push('', '### What players did', '');
  L.push(`| Per game | ${rolls.map((m) => m.model).join(' | ')} |`, `|---|${'---|'.repeat(rolls.length)}`);
  for (const k of Object.keys(rolls[0].n)) L.push(`| ${k} | ${rolls.map((m) => avg(m.n[k], m.seatGames)).join(' | ')} |`);
  const tg: Record<string, { chosen: number; fell: number }> = {};
  for (const s of games) for (const [k, v] of Object.entries(s.raids.targets)) { tg[k] ??= { chosen: 0, fell: 0 }; tg[k].chosen += v.chosen; tg[k].fell += v.fell; }
  L.push('', `Raid targets (fell / chosen): ${[...new Set([...Object.keys(TARGETS), ...Object.keys(tg)])].map((k) => `${nm(k)} ${tg[k]?.fell ?? 0}/${tg[k]?.chosen ?? 0}`).join(', ')}.`);
  const changes = games.map((s) => s.titles.length);
  L.push(`Title changes per game: ${changes.join(', ')}. Talk per game (messages): ${games.map((s) => sum(s.talk.said) + sum(s.talk.told)).join(', ')}.`);

  L.push('', '### Never and always used', '');
  L.push(`Across ${games.length} games and ${seatGames} seat-games. **never**: no one used it in any game; **always**: used in every game. Seen: times it was drawn or offered to keep; kept: building-deck cards kept.`, '');
  const flags: string[] = [];
  for (const c of catalogRoll(games)) {
    L.push(`**${c.what}**`, '', `| | Uses | Games | Seat-games${c.seen ? ' | Seen | Kept' : ''} | |`, `|---|---|---|---|${c.seen ? '---|---|' : ''}---|`);
    for (const r of c.rows) {
      const flag = c.noFlags ? '' : r.uses === 0 ? 'never' : r.games === games.length ? 'always' : '';
      if (flag) flags.push(`${r.name} (${c.what.toLowerCase()}): ${flag}`);
      L.push(`| ${r.name} | ${r.uses} | ${r.games} | ${r.seats}${c.seen ? ` | ${r.offered || ''} | ${r.kept || ''}` : ''} | ${flag ? `**${flag}**` : ''} |`);
    }
    L.push('');
  }
  L.push(`Flagged: ${flags.join('; ') || 'nothing'}.`, '');

  L.push('## Each game', '');
  for (const s of games) L.push(gameMarkdown(s), '');
  return L.join('\n');
}

// ---------- two batches side by side ----------

export function compareMarkdown(a: { dir: string; games: GameStats[] }, b: { dir: string; games: GameStats[] }): string {
  const L = [`# ${a.dir} vs ${b.dir}`, '', `Per game averages (all seats). A: ${a.games.length} games; B: ${b.games.length} games.`, ''];
  const inexact = [...a.games.map((s) => `A ${s.game}`).filter((_, i) => a.games[i].check.length), ...b.games.map((s) => `B ${s.game}`).filter((_, i) => b.games[i].check.length)];
  if (inexact.length) L.push(`**Points aren't exact in ${inexact.join(', ')}** (played under other scoring rules; see each batch's own stats). The counts are exact either way.`, '');
  const line = (label: string, f: (gs: GameStats[]) => number) => {
    const x = f(a.games), y = f(b.games);
    const d = y - x;
    L.push(`| ${label} | ${x.toFixed(1)} | ${y.toFixed(1)} | ${d > 0 ? '+' : ''}${d.toFixed(1)} |`);
  };
  const per = (gs: GameStats[], f: (s: GameStats) => number) => (gs.length ? sum(gs.map(f)) / gs.length : NaN);
  const seats = (f: (s: GameStats, p: number) => number) => (gs: GameStats[]) => per(gs, (s) => sum(s.seats.map((_, p) => f(s, p))));
  L.push('| | A | B | B − A |', '|---|---|---|---|');
  line('rounds', (gs) => per(gs, (s) => s.rounds));
  line('winner\'s points', (gs) => per(gs, (s) => (s.winner === null ? 0 : s.seats[s.winner].final)));
  for (const k of ['buildings', 'titles', 'beasts'] as const) line(`points from ${k} (all seats)`, seats((s, p) => s.points.at(-1)![p][k]));
  line('points from hoards (all seats)', seats((s, p) => s.seats[p].hidden));
  line('title changes', (gs) => per(gs, (s) => s.titles.length));
  line('raids held', (gs) => per(gs, (s) => sum(Object.values(s.raids.targets).map((v) => v.chosen))));
  line('raids that fell', (gs) => per(gs, (s) => sum(Object.values(s.raids.targets).map((v) => v.fell))));
  line('seats joining raids', seats((s, p) => s.raids.joined[p]));
  line('raid gold', seats((s, p) => s.raids.gold[p]));
  line('fauna cleared', seats((s, p) => sum(Object.entries(s.fauna).filter(([k]) => FAUNA[k]).map(([, v]) => v.cleared[p]))));
  line('great beasts slain', seats((s, p) => sum(Object.entries(s.fauna).filter(([k]) => BEASTS[k]).map(([, v]) => v.cleared[p]))));
  line('trade offers', seats((s, p) => s.trades.offers[p]));
  line('trades', (gs) => per(gs, (s) => sum(s.trades.accepted) / 2));
  line('bank trades', seats((s, p) => s.bank.trades[p]));
  line('talk messages', seats((s, p) => s.talk.said[p] + s.talk.told[p]));
  line('talk words', seats((s, p) => s.talk.words[p]));
  const ca = catalogRoll(a.games, b.games), cb = catalogRoll(b.games, a.games);
  ca.forEach((c, i) => {
    L.push('', `**${c.what}** (uses per game)`, '', '| | A | B | B − A |', '|---|---|---|---|');
    c.rows.forEach((r) => {
      const x = a.games.length ? r.uses / a.games.length : NaN, y = b.games.length ? cb[i].rows.find((x) => x.k === r.k)!.uses / b.games.length : NaN;
      if (!x && !y) { L.push(`| ${r.name} | 0 | 0 | |`); return; }
      const d = y - x;
      L.push(`| ${r.name} | ${x.toFixed(1)} | ${y.toFixed(1)} | ${d > 0 ? '+' : ''}${d.toFixed(1)} |`);
    });
  });
  return `${L.join('\n')}\n`;
}

// ---------- CLI ----------

if (import.meta.url === `file://${resolve(process.argv[1] ?? '')}`) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--compare');
  if (ci >= 0 && args.length >= ci + 3) {
    const [a, b] = [resolve(args[ci + 1]), resolve(args[ci + 2])];
    process.stdout.write(compareMarkdown({ dir: a, games: loadBatch(a).games }, { dir: b, games: loadBatch(b).games }));
  } else if (args[0] && !args[0].startsWith('-')) {
    process.stdout.write(batchMarkdown(loadBatch(resolve(args[0]))));
  } else {
    console.log('node src/playtest/stats.ts DIR\nnode src/playtest/stats.ts --compare DIR1 DIR2');
    process.exit(1);
  }
}
