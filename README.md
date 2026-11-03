# board-lite

A "board game lite" for one room: wizards raise dragons, build out from their towers, trade, and raid neutral kingdoms. The shared board will be on a TV and each player's hand on their phone.

- Design: [`docs/design.md`](docs/design.md); the reasoning behind each provisional call is in the commit and PR that made it
- Rules as the engine plays them: [`docs/rules.md`](docs/rules.md)
- Play from the command line: [`docs/cli.md`](docs/cli.md)
- Sandboxed Claude playtests (one Claude per seat, game tools only): [`docs/playtest.md`](docs/playtest.md)

## Code

TypeScript, run directly by Node 22.18+ (no build step).

- `src/data.ts`: every card, unit, kingdom and tuning number
- `src/engine.ts`: the rules; `apply(game, seat, command)` is the only way to change a game
- `src/view.ts`: what one seat may see, and its options
- `src/cli.ts`: the command-line interface; `src/bot.ts`: a random bot for tests and sims; `src/store.ts`: the game file and its lock
- `src/playtest/`: the playtest runner and the per-seat MCP server players use

`npm install`, then `npm test` (tests) and `npm run typecheck`. CI runs both.
