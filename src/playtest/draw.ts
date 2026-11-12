// The draw for a contest with games of mixed sizes (eval.ts --seats 2-6):
// each game picks how many players it has and who they are from the roster,
// at random but balanced, one game after another. See docs/eval.md.
//
// - Sizes: each size in the range comes up once, in random order, before any
//   comes up again, so no one board size decides the ranking.
// - Players: the ones with the fewest games so far, and among those the group
//   whose members have met each other least.
// - Seats: each player goes to the seat they've had less of than their share
//   (a player in a game of k gets 1/k of each of its seats).
// Ties are broken at random. Each game's draw depends only on the games before
// it, so a contest can be extended with more games and stay balanced, and can
// take new players partway (added to the end of the roster).
//
// With focus players (eval.ts --focus, such as players just added), the games
// drawn concentrate on them instead: every seat of a game but one goes to focus
// players (as many as there are), the ones with the fewest games first, and the
// other seats to the rest of the bucket, the ones who've met those focus players
// least first, so their opponents come from the whole bucket (the focus players
// also meet each other as evenly as they can). One player from the rest is
// enough to anchor a game: simulated, it rates newcomers as well as half the
// seats would, in fewer games and with fewer paid seats (docs/eval.md).

export interface DrawState {
  roster: string[];
  /** Smallest and largest game. */
  sizes: [number, number];
  /** Each game so far: the roster index of each seat, in seat order. */
  games: number[][];
  /** Roster indices the games drawn next concentrate on (none: the balanced draw). */
  focus?: number[];
}

/** How many of a game of k's seats go to focus players: all but one, if there are that many. */
export function focusSeats(k: number, focus: number): number {
  return Math.min(focus, k - 1);
}

/** A seeded random number generator (mulberry32): the same seed draws the same contest. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function subsets(n: number, k: number): number[][] {
  if (!k) return [[]];
  const out: number[][] = [];
  for (let first = 0; first <= n - k; first++) for (const rest of subsets(n - first - 1, k - 1)) out.push([first, ...rest.map((r) => r + first + 1)]);
  return out;
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** How many games each player has, how often each pair met, and each player's seats against their share. */
export function tally(roster: string[], games: number[][]) {
  const n = roster.length;
  const played = Array(n).fill(0);
  const met = Array.from({ length: n }, () => Array(n).fill(0));
  const seats = Array.from({ length: n }, () => Array(6).fill(0));
  const share = Array.from({ length: n }, () => Array(6).fill(0));
  for (const g of games) {
    g.forEach((p, s) => {
      played[p]++;
      seats[p][s]++;
      for (let j = 0; j < g.length; j++) share[p][j] += 1 / g.length;
      for (const q of g) if (q !== p) met[p][q]++;
    });
  }
  return { played, met, seats, share };
}

/** Adds `count` games to the draw, using `rand` for the ties and the sizes. */
export function extend(state: DrawState, count: number, rand: () => number): DrawState {
  const { roster, sizes: [lo, hi] } = state;
  const n = roster.length;
  if (lo < 2 || hi > 6 || lo > hi) throw new Error('Game sizes go from 2 to 6.');
  if (hi > n) throw new Error(`Games of ${hi} need at least ${hi} players in --models (a model can be listed twice).`);
  const games = [...state.games];
  const focus = new Set(state.focus ?? []);
  if ([...focus].some((p) => p < 0 || p >= n)) throw new Error('A focus player is not in the roster.');
  if (focus.size === n) throw new Error('Every player is a focus player: leave out --focus for the balanced draw.');
  const span = hi - lo + 1;
  let block: number[] = [];
  // Sizes come in blocks of every size once; a block cut short by an earlier run is finished first.
  const done = games.length % span;
  if (done) {
    const used = games.slice(games.length - done).map((g) => g.length);
    block = shuffle(Array.from({ length: span }, (_, i) => lo + i).filter((k) => { const at = used.indexOf(k); if (at < 0) return true; used.splice(at, 1); return false; }), rand);
  }
  for (let added = 0; added < count; added++) {
    if (!block.length) block = shuffle(Array.from({ length: span }, (_, i) => lo + i), rand);
    const k = block.shift()!;
    const t = tally(roster, games);
    // Players: fewest games first, then fewest meetings among them; random among equals.
    // With focus players: the focus seats' fewest games, then the fewest meetings of
    // the focus seats (with the others and each other), then the others' fewest
    // games, then fewest meetings in all.
    let best: number[] = [], bestCost = [Infinity, Infinity, Infinity, Infinity];
    const want = focusSeats(k, focus.size);
    for (const s of shuffle(subsets(n, k), rand)) {
      if (focus.size && s.filter((p) => focus.has(p)).length !== want) continue;
      let m = 0, mf = 0, gf = 0, go = 0;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        m += t.met[s[i]][s[j]];
        if (focus.has(s[i]) || focus.has(s[j])) mf += t.met[s[i]][s[j]];
      }
      for (const p of s) if (focus.has(p)) gf += t.played[p]; else go += t.played[p];
      const cost = focus.size ? [gf, mf, go, m] : [gf + go, m, 0, 0];
      const better = cost.findIndex((c, i) => c !== bestCost[i]);
      if (better >= 0 && cost[better] < bestCost[better]) { best = s; bestCost = cost; }
    }
    // Seats: each player where they're furthest under their share, counting the share this game adds.
    let order: number[] = [], orderCost = Infinity;
    for (const p of shuffle(permutations(best), rand)) {
      let c = 0;
      p.forEach((q, s) => {
        for (let j = 0; j < k; j++) {
          const over = t.seats[q][j] + (j === s ? 1 : 0) - t.share[q][j] - 1 / k;
          c += over * over;
        }
      });
      if (c < orderCost - 1e-9) { order = p; orderCost = c; }
    }
    games.push(order);
  }
  return { ...state, games };
}

/** Reads a --seats value: "3", or a range like "2-6". */
export function parseSizes(text: string): [number, number] {
  const m = /^(\d)(?:-(\d))?$/.exec(text.trim());
  if (!m) throw new Error(`--seats takes a number of players from 2 to 6, or a range like 2-6, not "${text}".`);
  const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
  if (lo < 2 || hi > 6 || lo > hi) throw new Error(`--seats takes a number of players from 2 to 6, or a range like 2-6, not "${text}".`);
  return [lo, hi];
}

/** The balance of a draw, for --dry-run: each player's games, seats and how often they met each other. */
export function balance(roster: string[], games: number[][]): string {
  const t = tally(roster, games);
  const width = Math.max(...roster.map((r) => r.length));
  const sizes = new Map<number, number>();
  for (const g of games) sizes.set(g.length, (sizes.get(g.length) ?? 0) + 1);
  const lines = [
    `Game sizes: ${[...sizes].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${c} of ${k}`).join(', ')}.`,
    `${'player'.padEnd(width)}  games  seats 1-6 (fair share)                    met each other player`,
  ];
  roster.forEach((r, p) => {
    const seats = t.seats[p].map((c, j) => `${c}(${t.share[p][j].toFixed(1)})`).join(' ');
    const met = t.met[p].filter((_, q) => q !== p);
    lines.push(`${r.padEnd(width)}  ${String(t.played[p]).padStart(5)}  ${seats.padEnd(40)}  ${Math.min(...met)} to ${Math.max(...met)} times`);
  });
  return lines.join('\n');
}
