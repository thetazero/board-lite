// Win rates of a playtest batch, read from each game's results.json, and
// whether a model wins more than its share of seats would by chance. This is
// the depth test: "does haiku regularly lose to opus? If not, the game has no
// depth." See "Depth batches" in docs/playtest.md.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface GameResult {
  game: string;
  status: string;
  rounds?: number;
  winner: { seat: string; model: string } | null;
  seats: { seat: string; model: string; points?: number }[];
}

export function readBatch(dir: string): GameResult[] {
  const games = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^g\d+$/.test(d.name))
    .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1)));
  const out: GameResult[] = [];
  for (const d of games) {
    const f = join(dir, d.name, 'results.json');
    if (existsSync(f)) out.push({ game: d.name, ...JSON.parse(readFileSync(f, 'utf8')) });
  }
  return out;
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialTail(n: number, k: number, p: number): number {
  let sum = 0;
  for (let i = k; i <= n; i++) {
    let c = 1; // n choose i, built up without overflow
    for (let j = 1; j <= i; j++) c = (c * (n - i + j)) / j;
    sum += c * p ** i * (1 - p) ** (n - i);
  }
  return Math.min(1, sum);
}

/** 95% Wilson interval for k successes in n. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d, half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export interface ModelRow { model: string; games: number; wins: number; share: number; low: number; high: number; p: number }

/** Per model, over the finished games: wins, the wins its share of seats would expect, and how unlikely its wins are by chance. */
export function tally(results: GameResult[]): { finished: GameResult[]; unfinished: GameResult[]; models: ModelRow[]; bySeat: Record<string, number> } {
  const finished = results.filter((r) => r.status === 'over' && r.winner);
  const unfinished = results.filter((r) => !finished.includes(r));
  const names = [...new Set(finished.flatMap((r) => r.seats.map((s) => s.model)))];
  const models = names.map((model) => {
    const played = finished.filter((r) => r.seats.some((s) => s.model === model));
    const wins = played.filter((r) => r.winner!.model === model).length;
    // Its chance of winning a game if every seat were equally strong (the same every game when seats only rotate).
    const share = played.reduce((t, r) => t + r.seats.filter((s) => s.model === model).length / r.seats.length, 0) / (played.length || 1);
    const [low, high] = wilson(wins, played.length);
    return { model, games: played.length, wins, share, low, high, p: binomialTail(played.length, wins, share) };
  });
  const bySeat: Record<string, number> = {};
  for (const r of finished) bySeat[r.winner!.seat] = (bySeat[r.winner!.seat] ?? 0) + 1;
  return { finished, unfinished, models, bySeat };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function summary(dir: string): string {
  const results = readBatch(dir);
  const t = tally(results);
  const lines = [`# Batch ${dir}`, '', `${t.finished.length} finished games${t.unfinished.length ? `; not finished: ${t.unfinished.map((r) => `${r.game} (${r.status})`).join(', ')}` : ''}.`, ''];
  lines.push('| Model | Games | Wins | Win rate (95% range) | Fair share | Chance of this many wins or more if all seats were equal |', '|---|---|---|---|---|---|');
  for (const m of t.models) lines.push(`| ${m.model} | ${m.games} | ${m.wins} | ${pct(m.wins / (m.games || 1))} (${pct(m.low)}-${pct(m.high)}) | ${pct(m.share)} | ${m.p < 0.001 ? '<0.001' : m.p.toFixed(3)} |`);
  lines.push('', `Wins by seat: ${Object.entries(t.bySeat).sort().map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}.`, '');
  lines.push('| Game | Rounds | Winner | Seats (points) |', '|---|---|---|---|');
  for (const r of results) lines.push(`| ${r.game} | ${r.rounds ?? '-'} | ${r.winner ? `${r.winner.seat} ${r.winner.model}` : r.status} | ${r.seats.map((s) => `${s.seat} ${s.model}${s.points === undefined ? '' : ` ${s.points}`}`).join(', ')} |`);
  return `${lines.join('\n')}\n`;
}
