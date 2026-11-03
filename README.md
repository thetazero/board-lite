# board-lite

A "board game lite" for one room: wizards raise dragons, build out from their towers, trade, and raid neutral kingdoms. The shared board is on a TV and each player's hand on their phone.

- Design: [`docs/design.md`](docs/design.md); the reasoning behind each provisional call is in the commit and PR that made it
- Rules as the engine plays them: [`docs/rules.md`](docs/rules.md)
- Play on a TV with phones: `npm run serve`, then see [`docs/clients.md`](docs/clients.md)
- Screenshots of the TV and phones in staged situations, for look tuning: `npm run shots` ([`docs/clients.md`](docs/clients.md#staged-screenshots-for-look-tuning))
- Play from the command line: [`docs/cli.md`](docs/cli.md)
- Tuning datasheet, generated from the code: [`docs/datasheet.md`](docs/datasheet.md): every number and what it adds up to (payback rounds, cost per point, raid odds). Read it before and after changing any number; `npm run datasheet` regenerates it.
- Sandboxed Claude playtests (one Claude per seat, game tools only): [`docs/playtest.md`](docs/playtest.md)

## Code

TypeScript, run directly by Node 22.18+ (no build step).

- `src/data.ts`: every card, unit, kingdom and tuning number; `src/datasheet.ts` turns them into `docs/datasheet.md`
- `src/engine.ts`: the rules; `apply(game, seat, command)` is the only way to change a game
- `src/view.ts`: what one seat may see, and its options
- `src/cli.ts`: the command-line interface; `src/bot.ts`: a random bot for tests and sims; `src/store.ts`: the game file and its lock
- `src/playtest/`: the playtest runner and the per-seat MCP server players use
- `src/server/`: the web server and rooms for the TV and phone clients; `src/state.ts`: the JSON they receive; `web/`: the clients
- `src/shots/`: staged screenshots of the clients (`npm run shots`)

`npm install`, then `npm test` (tests) and `npm run typecheck`. CI runs both. `npm test` fails if `docs/datasheet.md` is out of date: after changing `src/data.ts` or the rules, run `npm run datasheet` and commit the result.
