// What a runner needs to bring its Claude players back into their own seats
// after it stopped (low memory, Ctrl-C, a crash, the machine restarting): the
// room, and for each Claude seat its model, seat token and Claude session.
// The runner keeps it in <out>/runner.json and rewrites it as the game goes.
// Directories from before runner.json existed are read from what the runner
// left anyway: seat-N/mcp.json holds the room and the seat's token,
// seat-N.jsonl the session id, results.json and runner.log the model.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SavedSeat { p: number; model: string; token: string; session: string; starts: number; cost: number }

export interface RunnerState {
  pid?: number; // the runner running this directory, while it runs
  room: string; // http://host:port/CODE; when hosted, the port is gone with the runner
  hosted: boolean; // the runner hosted the room itself (game.json in the directory)
  seed?: number;
  effort?: string;
  advice?: string;
  budget?: number; // --budget-usd, per Claude seat over the whole game
  seats: SavedSeat[];
}

/** Default --budget-usd for a runner seated in someone else's room (a game with people in it). */
export const ROOM_BUDGET_USD = 30;
/** Default --budget-usd for a playtest the runner hosts itself. */
export const PLAYTEST_BUDGET_USD = 5;

/**
 * The spending cap per Claude seat, over the whole game. A game with people
 * in it runs long (14 rounds cost an Opus player $6.80), so it gets room to
 * finish; a playtest the runner hosts keeps the cheaper cap. Resuming keeps
 * the budget the runner had, unless --budget-usd is given again.
 */
export function budgetUsd(given: string | undefined, resumed: RunnerState | null, inRoom: boolean): number {
  if (given !== undefined) return Number(given);
  return resumed?.budget ?? (inRoom ? ROOM_BUDGET_USD : PLAYTEST_BUDGET_USD);
}

export const stateFile = (out: string) => join(out, 'runner.json');

/** The saved state of the runner that ran `out`; throws if there's nothing to resume. */
export function readState(out: string): RunnerState {
  if (existsSync(stateFile(out))) return JSON.parse(readFileSync(stateFile(out), 'utf8')) as RunnerState;
  return fromLeftovers(out);
}

function fromLeftovers(out: string): RunnerState {
  if (!existsSync(out)) throw new Error(`No such directory: ${out}`);
  const read = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), 'utf8') : '');
  const results = (() => { try { return JSON.parse(read('results.json')) as Record<string, any>; } catch { return {}; } })();
  const log = read('runner.log');
  let room = '';
  const seats: SavedSeat[] = [];
  const dirs = readdirSync(out).map((d) => /^seat-(\d+)$/.exec(d)).filter((m) => !!m).map((m) => Number(m![1])).sort((a, b) => a - b);
  for (const n of dirs) {
    const mcp = join(out, `seat-${n}`, 'mcp.json');
    if (!existsSync(mcp)) continue;
    const [, url, token] = JSON.parse(readFileSync(mcp, 'utf8')).mcpServers.game.args as string[];
    room ||= url;
    const session = /"session_id":"([^"]+)"/.exec(read(`seat-${n}.jsonl`))?.[1];
    const fromResults = (results.seats as { seat: string; model: string; costUsd?: number; starts?: number }[] | undefined)?.find((s) => s.seat === `P${n}`);
    const model = fromResults?.model ?? new RegExp(`P${n} \\((\\S+)\\) starts`).exec(log)?.[1];
    if (!model) throw new Error(`Can't tell which model played seat ${n} (no results.json or runner.log in ${out}).`);
    // No session id: the player never got going, so it starts afresh.
    seats.push({ p: n - 1, model, token, session: session ?? '', starts: session ? Math.max(1, fromResults?.starts ?? 1) : 0, cost: fromResults?.costUsd ?? 0 });
  }
  if (!seats.length) throw new Error(`Nothing to resume in ${out}: no Claude player ever took a seat there.`);
  return { room, hosted: existsSync(join(out, 'game.json')), ...(typeof results.seed === 'number' ? { seed: results.seed } : {}), ...(results.advice ? { advice: results.advice } : {}), seats };
}
