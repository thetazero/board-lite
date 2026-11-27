# The Rust server

`rust/` is the public website ([`deploy.md`](deploy.md)) written again in Rust: the same rules, the same addresses, the same files on disk. It's built by `Dockerfile.rust` into one static binary with the pages inside, on an empty base image. It's an alternative: `deploy/compose.yml` and the published image are still the Node server.

```
docker build -f Dockerfile.rust -t board-lite-rust .
```

It takes the same variables (`BOARD_LITE_PUBLIC_URL` is required; there are no flags), and `/data` must be writable by uid 1000. A room one server hosted goes on under the other, on the same folder: stop one before starting the other.

## What's in it, and what isn't

- In: the engine, the simple bot and the stand-in, rooms, saving, `/mcp` with its text and picture, recaps, the limits and clearing.
- Not in: what only `npm run serve` at home does (strong bots, starting Claude players, network addresses, the list of saved games). The CLI, playtests, contests and the tests of the rules stay on the TypeScript.

Where they differ on purpose: changes that come faster than a viewer reads them are sent as one; a wait ends when its client hangs up; nothing takes the game file's `.lock`, so don't point the CLI at a hosted file; a vote like `vote 1.5` is refused, where Node answers 500.

## Keeping the two alike

- **Numbers and card text aren't written twice.** `rust/gen/gen.ts` writes `src/data.ts`'s tables, the rulebook, the rules and the pages into `rust/generated/` (not committed). A change to those needs no Rust.
- **Rules and views are.** A change to how `src/engine.ts`, `state.ts`, `view.ts`, `bot.ts`, `recap.ts`, `map.ts`, `mapimage.ts` or `src/server/` behaves has to be made in `rust/src/` too, in the file of the same name. CI's `rust` job fails until it is.
- `test/rust-parity.test.ts` plays the same seeds through both engines, with junk commands among the moves, and compares everything; `PARITY_GAMES=6` plays more. `test/rust-server.test.ts` makes the same requests of both servers. Both are skipped until `npm run rust:build`.

## Measured

`rust/bench/load.ts` (how it loads a server is at its top). One machine (i9-13900H), each image limited to 1 CPU and 1 GB.

| | Node (`Dockerfile`) | Node, slimmed | Rust (`Dockerfile.rust`) |
|---|---|---|---|
| Image on disk | 255 MB | 128 MB | 5.7 MB |
| Image compressed | 89 MB | 48 MB | 1.9 MB |
| Container memory, idle | 49.9 MB | not measured | 0.6 MB |
| Time to first answer | 268 ms | not measured | 6–11 ms |

With people connected (each table a TV and 4 phones, about 0.3 moves a second, each saved and pushed to all five), 12 seconds measured at each step, one run, other work going on on the machine:

| People | | Node | Rust |
|---|---|---|---|
| 0 | container memory / CPU | 58 MB / 0.2% | 2.6 MB / 0% |
| 50 | container memory / CPU | 72 MB / 2.6% | 6.9 MB / 0.6% |
| | a move, median / p95 | 5.3 / 8.9 ms | 1.8 / 5.1 ms |
| 500 | container memory / CPU | 89 MB / 19% | 31 MB / 5.8% |
| | a move, median / p95 | 5.4 / 9.6 ms | 1.6 / 3.4 ms |
| 2,500 | container memory / CPU | 157 MB / 86% | 136 MB / 28% |
| | a move, median / p95 | 10.0 / 35.4 ms | 1.5 / 3.2 ms |

Container memory counts file cache too, so it moves a few MB between runs (the idle figures above are from another run). The Rust server keeps each table's JSON for as long as the table is busy, which is probably most of its memory at 2,500: not confirmed. Some of the CPU gain is that JSON being made once rather than for each viewer, not Rust itself; how much wasn't measured. Games were minutes old: long games weren't measured.
