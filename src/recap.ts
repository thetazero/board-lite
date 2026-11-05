// A finished game's recap: how it went, as data. The TV plays it at the end
// and the recap page (web/recap.ts) shows it to anyone with its link. It is
// built once, when the game ends, and holds everything the page needs (names
// and all), so it outlives the room and can be served from anywhere: the
// local server today, a website later, as the same file.

import { TUNING } from './data.ts';
import { TITLE_NAMES, score, standings, type Game, type Title } from './engine.ts';
import { gameStats } from './playtest/stats.ts';
import type { Moment, Recap } from './state.ts';

export function buildRecap(g: Game, names: string[], id: string, ended: Date): Recap {
  const order = standings(g);
  const moments: Moment[] = [];
  // Titles: the holder at the end of each round, against the round before.
  const held: Record<Title, number | null> = { army: null, tower: null, hoard: null };
  let roundTitles: Partial<Record<Title, number | null>> = {};
  let round = 0;
  const closeRound = () => {
    for (const [t, p] of Object.entries(roundTitles) as [Title, number | null][]) {
      if (p !== held[t] && p !== null) moments.push({ round, k: 'title', t, name: TITLE_NAMES[t], p });
      held[t] = p;
    }
    roundTitles = {};
  };
  for (const e of g.log) {
    if (e.round !== round) {
      closeRound();
      round = e.round;
    }
    const ev = e.ev;
    if (!ev || e.to) continue;
    if (ev.k === 'title') roundTitles[ev.t] = ev.p;
    else if (ev.k === 'cleared' && ev.won && ev.points) moments.push({ round, k: 'beast', p: ev.p, key: ev.fauna ?? '', name: ev.name, points: ev.points });
    else if (ev.k === 'raidEnd' && ev.won) moments.push({ round, k: 'fall', name: ev.name, ps: ev.winners });
  }
  closeRound();
  // A title move goes after the round's fights, which are what usually move it.
  moments.sort((a, b) => a.round - b.round || Number(a.k === 'title') - Number(b.k === 'title'));
  // Points round by round, rebuilt from the log as the table saw them (cards
  // in hand are secret until the end), then the final scores, all revealed.
  const seen = gameStats(g, { seats: [] }).points.map((row) => row.map((x) => x.public));
  const race = [g.players.map(() => 0), ...seen.slice(0, -1), g.players.map((_, p) => score(g, p).total)];
  return {
    v: 1,
    id,
    ended: ended.toISOString(),
    rounds: g.round,
    pointsToWin: TUNING.pointsToWin,
    names: g.players.map((_, p) => names[p] ?? `P${p + 1}`),
    race,
    standings: order.map((s) => {
      const sc = score(g, s.p);
      return { p: s.p, place: s.place, tied: s.tied, tiebreak: s.tiebreak, total: s.total, buildings: sc.buildings, titles: sc.titles, beasts: sc.beasts, hidden: sc.hidden };
    }),
    moments,
  };
}
