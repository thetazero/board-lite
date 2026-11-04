# board-lite

A "board game lite" for one room: wizards raise dragons, build out from their towers, trade, and raid neutral kingdoms. The shared board is on a TV and each player's hand on their phone.

- Design: [`docs/design.md`](docs/design.md); the reasoning behind each provisional call is in the commit and PR that made it
- Rules as the engine plays them: [`docs/rules.md`](docs/rules.md)
- How the game words things (cards, buttons, the TV, the rules): [`docs/wording.md`](docs/wording.md), a style guide based on published board games. Read it before writing any text a player sees.
- Play on a TV with phones: `npm run serve`, then see [`docs/clients.md`](docs/clients.md)
- Play with no TV, phones only (one phone and bots works too): tap **New game** on the join form; see [`docs/clients.md`](docs/clients.md#playing-with-no-tv)
- Screenshots of the TV and phones in staged situations, for look tuning: `npm run shots` ([`docs/clients.md`](docs/clients.md#staged-screenshots-for-look-tuning))
- Play from the command line: [`docs/cli.md`](docs/cli.md)
- Play against Claude, at the same table as phone players: [`docs/play-vs-claude.md`](docs/play-vs-claude.md)
- Tuning datasheet, generated from the code: [`docs/datasheet.md`](docs/datasheet.md): the raw rules: every cost, output, stat and point, with nothing simulated. Read it before and after changing any number; `npm run datasheet` regenerates it.
- Sandboxed Claude playtests (one Claude per seat, game tools only): [`docs/playtest.md`](docs/playtest.md)

## Code

TypeScript, run directly by Node 22.18+ (no build step). `npm install` before `npm run serve`: the TV's board needs three.js.

- `src/data.ts`: every card, unit, kingdom and tuning number; `src/datasheet.ts` turns them into `docs/datasheet.md`
- `src/engine.ts`: the rules; `apply(game, seat, command)` is the only way to change a game
- `src/view.ts`: a snapshot from `src/state.ts` as text (what the CLI and Claude players print): what one seat sees, and its options
- `src/cli.ts`: the command-line interface, a client of the server's API; `src/bot.ts`: a random bot for tests and sims; `src/store.ts`: the game file and its lock
- `src/playtest/`: the runner that seats Claude players (hosting a playtest, or joining a room) and the per-seat MCP server they play through
- `src/server/`: the web server and rooms for the TV and phone clients; `src/state.ts`: the JSON they receive; `web/`: the clients (the TV's 3D board is `web/board3d.ts`, on three.js, the one runtime dependency)
- `src/shots/`: staged screenshots of the clients (`npm run shots`)

`npm install`, then `npm test` (tests) and `npm run typecheck`. CI runs both. `npm test` fails if `docs/datasheet.md` is out of date: after changing `src/data.ts` or the rules, run `npm run datasheet` and commit the result.
