# The Rust server

`rust/` is the rules, the bots and the server: `npm run serve` at home, and the public website ([`deploy.md`](deploy.md)), built by `Dockerfile` into one static binary with the pages inside, on an empty base image. `npm run serve` builds it first (the pages too: after changing `web/`, run it again), so it needs Rust.

```
docker build -t board-lite .
```

The flags are `--port`, `--game`, `--data`, `--public` and `--trust-proxy`, and the website's variables are in [`deploy.md`](deploy.md). `/data` must be writable by uid 1000. A room the TypeScript server hosted goes on under this one, on the same folder.

The tests, the screenshots, the demo and the playtest runner host rooms on the same server through `src/host.ts`, which drives `rust/src/bin/stage.rs`: the server plus ways to put a room in any state. It's built only with the `stage` feature, and is never in the image.

Nothing takes the game file's `.lock`, so don't point a tool that changes a game file at one being hosted.

## Working on it

- `npm run rust:build` after a fresh checkout and after any change in `rust/` or `src/data.ts` (it needs Rust, and `rustup target add wasm32-unknown-unknown`). It writes `src/data.ts`'s tables and the pages into `rust/generated/`, then builds the rules as a WASM module and the server. None of it is committed. The tests use what was last built.
- `src/data.ts` is still where every number and card's text is. `src/engine.ts`, `bot.ts`, `strongbot.ts`, `state.ts`, `recap.ts` and `map.ts` are types and calls into the WASM module (`src/wasm.ts`), with small arithmetic on one dragon, card or hex.
- **Two versions are left, on purpose:** the text view and the map picture. `src/view.ts` and `src/mapimage.ts` draw them in the CLI and a Claude seat's own process, from the JSON a server sent; `rust/src/view.rs` and `mapimage.rs` draw them for `/mcp`. How long the TV's scenes last is in `web/scenes.ts` and `rust/src/scenes.rs` too. `test/rust-parity.test.ts` plays games and compares them.

## Measured

`rust/bench/load.ts` (how it loads a server is at its top). One machine (i9-13900H), each image limited to 1 CPU and 1 GB.

| | Node | Node, slimmed | Rust |
|---|---|---|---|
| Image on disk | 255 MB | 128 MB | 6.0 MB |
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
