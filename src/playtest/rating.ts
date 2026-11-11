// Ratings for a multiplayer game, on the Elo scale: from every finished game's
// final places, fitted all at once (not updated game by game, so the order the
// games were played in doesn't matter).
//
// Each game is split into its pairs of players: in a 4-player game, the winner
// beat the other three, 2nd place beat 3rd and 4th, and so on; players level
// on points drew. Each pair counts 1/(n-1), so every game weighs the same for
// each of its players whatever its size. The ratings are the Bradley-Terry fit
// of those results (the model Elo assumes: a player rated 400 above another
// beats them 10 times in 11), with a weak prior that pulls a player with few
// games towards the middle instead of letting one lucky win send it to
// infinity. The range is the fit's 95% interval.
//
// The average seat is 1500 (each player weighs by the seats it held): ratings
// say how players compare with each other, so adding a strong player moves the
// others down a little.
// The random bot, when it played, is a row like any other, the floor to read
// the rest against. See docs/eval.md.

export interface RatedGame {
  /** Each seat's player and final place (1 = winner; level players share a place). Two seats may be the same player. */
  seats: { player: string; place: number }[];
}

export interface Rating {
  player: string;
  rating: number;
  /** Half-width of the 95% range of its gap to the average seat. */
  range: number;
  games: number;
  wins: number;
  /** Average place, 1 = always won. */
  place: number;
}

export const BOT = 'bot';
const ELO = 400 / Math.log(10); // natural log-odds to Elo points
const PRIOR_SD = 2; // in log-odds, about 350 Elo points: weak

/** Solves A x = b (A symmetric positive definite, small). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function invert(A: number[][]): number[][] {
  const n = A.length;
  const cols = Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))));
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}

export function rate(games: RatedGame[]): Rating[] {
  const names = [...new Set(games.flatMap((g) => g.seats.map((s) => s.player)))];
  const idx = new Map(names.map((n, i) => [n, i]));
  const n = names.length;
  // Every pair of seats held by different players: [i, j, score of i (1, 0.5, 0), weight].
  const pairs: [number, number, number, number][] = [];
  for (const g of games) {
    const w = 1 / Math.max(1, g.seats.length - 1);
    for (const [a, sa] of g.seats.entries()) {
      for (const sb of g.seats.slice(a + 1)) {
        if (sa.player === sb.player) continue; // the same player in two seats says nothing about it
        pairs.push([idx.get(sa.player)!, idx.get(sb.player)!, sa.place < sb.place ? 1 : sa.place === sb.place ? 0.5 : 0, w]);
      }
    }
  }
  // Newton's method on the log-posterior; the prior keeps it concave, so it converges.
  let theta = new Array<number>(n).fill(0);
  let H: number[][] = [];
  for (let iter = 0; iter < 100; iter++) {
    const grad = theta.map((t) => -t / PRIOR_SD ** 2);
    H = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 / PRIOR_SD ** 2 : 0))); // minus the Hessian
    for (const [i, j, s, w] of pairs) {
      const p = 1 / (1 + Math.exp(theta[j] - theta[i]));
      grad[i] += w * (s - p);
      grad[j] -= w * (s - p);
      const v = w * p * (1 - p);
      H[i][i] += v; H[j][j] += v; H[i][j] -= v; H[j][i] -= v;
    }
    const step = solve(H, grad);
    theta = theta.map((t, i) => t + step[i]);
    if (Math.max(0, ...step.map(Math.abs)) < 1e-9) break;
  }
  const cov = n ? invert(H) : [];
  // 1500 is the average seat: players weigh by the seats they held, so the
  // well-measured ones set the middle, not a newcomer with one game.
  const held = names.map((p) => games.reduce((t, g) => t + g.seats.filter((s) => s.player === p).length, 0));
  const w = held.map((h) => h / (held.reduce((t, x) => t + x, 0) || 1));
  const middle = theta.reduce((t, x, j) => t + w[j] * x, 0);
  // The variance of theta[i] minus the middle.
  const gapVariance = (i: number) => {
    let v = 0;
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) v += ((j === i ? 1 : 0) - w[j]) * ((k === i ? 1 : 0) - w[k]) * cov[j][k];
    return v;
  };
  return names.map((player, i) => {
    const played = games.filter((g) => g.seats.some((s) => s.player === player));
    const places = played.flatMap((g) => g.seats.filter((s) => s.player === player).map((s) => s.place));
    return {
      player,
      rating: 1500 + ELO * (theta[i] - middle),
      range: 1.96 * ELO * Math.sqrt(Math.max(0, gapVariance(i))),
      games: played.length,
      wins: played.filter((g) => g.seats.some((s) => s.player === player && s.place === 1)).length,
      place: places.reduce((t, p) => t + p, 0) / (places.length || 1),
    };
  }).sort((x, y) => y.rating - x.rating);
}

/** Places from final points: the winner first (it may have won a tie), the rest by points, level players sharing a place. */
export function placesFrom(points: number[], winner: number): number[] {
  const order = points.map((_, p) => p).sort((x, y) => (x === winner ? -1 : y === winner ? 1 : points[y] - points[x]));
  const place = new Array<number>(points.length);
  for (const [i, p] of order.entries()) place[p] = i > 1 && points[p] === points[order[i - 1]] ? place[order[i - 1]] : i + 1;
  return place;
}
