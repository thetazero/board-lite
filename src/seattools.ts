// What the tools a Claude player plays through say they do, shared by the
// sandboxed seat's server (src/playtest/seat-server.ts) and the web server's
// /mcp (rust/src/mcp.rs).

export const VIEW_HELP = 'See the game as your seat sees it: scores, your hidden resources and hand, the public board as a text map and as a picture, recent events, and your options when it is your decision.';
export const ACT_HELP = 'Make a game decision as your seat, e.g. "keep c12", "build c12 2,-1", "build quarry 2,-1", "offer P2 give 2 stone get 1 gold", "offer anyone give 1 crystal get 1 timber", "accept o40", "clear 2,-1 d3", "end", "vote 2", "fight", "fight d3 d5", "hold", "discard c4". Returns what happened and your next options.';
export const SAY_HELP = 'Talk to the table, any time. With "to" (like "P2"), only that player hears it. Promises bind no one; only accepted offers do.';
export const waitHelp = (secs: number) => `Wait (up to ${secs}s) until it is your decision, someone talks to you or the table, or the game ends. On your own turn with an offer out, it waits for an answer. Returns the new events, including talk, and your status.`;
export const RULES_HELP = 'The full rules of board-lite.';
