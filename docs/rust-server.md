# The Rust server

`rust/` is the public website ([`deploy.md`](deploy.md)) written again in Rust: the same rules, the same addresses, the same files on disk. It's built by `Dockerfile` into one static binary with the pages inside, on an empty base image. The migration isn't finished: `npm run serve` at home is still the TypeScript server, on the Rust rules.

```
docker build -t board-lite .
```

It takes the same variables (`BOARD_LITE_PUBLIC_URL` is required; there are no flags), and `/data` must be writable by uid 1000. A room one server hosted goes on under the other, on the same folder: stop one before starting the other.

## What's in it, and what isn't

- In: the engine, the simple bot and the stand-in, rooms, saving, `/mcp` with its text and picture, recaps, the limits and clearing.
- Not in: what only `npm run serve` at home does (strong bots, starting Claude players, network addresses, the list of saved games). The CLI, playtests and contests run on Node.

Where they differ on purpose: changes that come faster than a viewer reads them are sent as one; a wait ends when its client hangs up; nothing takes the game file's `.lock`, so don't point the CLI at a hosted file; a vote like `vote 1.5` is refused, where Node answers 500.

## Keeping the two alike

- **Numbers and card text aren't written twice.** `rust/gen/gen.ts` writes `src/data.ts`'s tables, the rulebook, the rules and the pages into `rust/generated/` (not committed). A change to those needs no Rust.
- **The rules, the simple bot and the strong bot are Rust only.** `src/engine.ts`, `bot.ts` and `strongbot.ts` call them through a WASM module (`src/wasm.ts`), built by `npm run wasm:build` and not committed: working on the game needs Rust (`rustup target add wasm32-unknown-unknown`).
- **Still twice, for now:** what's read off a game (scores, production, where things can go), `state.ts`, `view.ts`, `recap.ts`, `mapimage.ts` and `src/server/`. A change there is made in `rust/src/` too, and CI's `rust` job compares them.
- `test/rust-parity.test.ts` plays the same seeds through both engines, with junk commands among the moves, and compares everything; `PARITY_GAMES=6` plays more. `test/rust-server.test.ts` makes the same requests of both servers. Both are skipped until `npm run rust:build`.

## Measured

`rust/bench/load.ts` (how it loads a server is at its top). One machine (i9-13900H), each image limited to 1 CPU and 1 GB.

| | Node | Node, slimmed | Rust |
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
| 500 | container memory / CPU | 89 MB / 19% | 24 MB / 6.5% |
| | a move, median / p95 | 5.4 / 9.6 ms | 1.5 / 2.6 ms |
| 2,500 | container memory / CPU | 157 MB / 86% | 110 MB / 27% |
| | a move, median / p95 | 10.0 / 35.4 ms | 1.4 / 3.0 ms |

Container memory counts file cache too, so it moves a few MB between runs (the idle figures above are from another run). The Rust rows at 500 and 2,500 are from a later build, which keeps less JSON per table (it was 31 and 136 MB before). Some of the CPU gain is that JSON being made once rather than for each viewer, not Rust itself; how much wasn't measured. Games were minutes old: long games weren't measured.
