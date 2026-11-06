// A finished game's recap: how it went, as data. The TV plays it at the end
// and the recap page (web/recap.ts) shows it to anyone with its link. It is
// built once, when the game ends, and holds everything the page needs (names
// and all), so it outlives the room and can be served from anywhere: the
// local server today, a website later, as the same file.

import { TUNING, targetPower } from './data.ts';
import { TITLE_NAMES, score, standings, type Game, type Title } from './engine.ts';
import { gameStats } from './playtest/stats.ts';
import type { Moment, Recap } from './state.ts';

export function buildRecap(g: Game, names: string[], id: string, ended: Date): Recap {
  const order = standings(g);
  const moments: Moment[] = [];
  // Titles: the holder at the end of each round, against the last holder told
  // (a title nobody holds for a while, then back to the same player, isn't news).
  const held: Record<Title, number | null> = { army: null, tower: null, hoard: null };
  let roundTitles: Partial<Record<Title, number | null>> = {};
  let round = 0;
  let strongest = 0; // the power of the strongest kingdom that has fallen
  const closeRound = () => {
    for (const [t, p] of Object.entries(roundTitles) as [Title, number | null][]) {
      if (p === null || p === held[t]) continue;
      moments.push({ round, k: 'title', t, name: TITLE_NAMES[t], p });
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
    else if (ev.k === 'raidEnd' && ev.won) {
      // A kingdom's fall is news when it scores points, or when it's the
      // strongest kingdom to fall yet: the table reaching a new rung of the
      // ladder. The same kingdoms falling again and again is the game's routine.
      const power = targetPower(ev.t);
      const first = power > strongest;
      strongest = Math.max(strongest, power);
      if (ev.scorer === undefined && !first) continue;
      // The same kingdom falling again in a round to the same scorer is one line.
      const again = ev.scorer !== undefined && moments.find((m) => m.round === round && m.k === 'fall' && m.name === ev.name && m.scorer === ev.scorer);
      if (again && again.k === 'fall') {
        again.points = (again.points ?? 0) + (ev.points ?? 0);
        again.times = (again.times ?? 1) + 1;
        again.ps = [...new Set([...again.ps, ...ev.winners])].sort((a, b) => a - b);
      } else moments.push({ round, k: 'fall', name: ev.name, ps: ev.winners, ...(ev.scorer !== undefined ? { points: ev.points, scorer: ev.scorer } : {}) });
    }
  }
  closeRound();
  // A title move goes after the round's fights, which are what usually move it.
  moments.sort((a, b) => a.round - b.round || Number(a.k === 'title') - Number(b.k === 'title'));
  // Points round by round, rebuilt from the log as the table saw them (cards
  // in hand are secret until the end), then the final scores, all revealed.
  const stats = gameStats(g, { seats: [] });
  const seen = stats.points.map((row) => row.map((x) => x.public));
  const race = [g.players.map(() => 0), ...seen.slice(0, -1), g.players.map((_, p) => score(g, p).total)];
  // What each player's production made, round by round: every resource, the
  // dice as they rolled.
  const made = Array.from({ length: g.round }, () => g.players.map(() => 0));
  for (const e of g.log) if (e.ev?.k === 'produce' && e.round >= 1) made[e.round - 1][e.ev.p] += Object.values(e.ev.got).reduce((a, b) => a + (b ?? 0), 0);
  return {
    v: 1,
    id,
    ended: ended.toISOString(),
    rounds: g.round,
    pointsToWin: TUNING.pointsToWin,
    names: g.players.map((_, p) => names[p] ?? `P${p + 1}`),
    race,
    power: stats.power,
    made,
    standings: order.map((s) => {
      const sc = score(g, s.p);
      return { p: s.p, place: s.place, tied: s.tied, tiebreak: s.tiebreak, total: s.total, buildings: sc.buildings, titles: sc.titles, beasts: sc.beasts, raids: sc.raids, hidden: sc.hidden };
    }),
    moments,
  };
}
