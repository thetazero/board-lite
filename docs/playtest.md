# Sandboxed Claude playtests

`src/playtest/run.ts` runs one game where every seat is a Claude player (or the random bot). Each Claude player is its own `claude -p` process, and the only tools it has are five game tools for its own seat. It can't run commands, read or write files, browse, or act for another seat.

Claude players are clients like phones: the runner hosts the game in a room on a board-lite server of its own (on `127.0.0.1` only, on a random port) and each Claude player joins it through the same room interface the phones and the CLI use. To seat Claude players at a game people are playing, with the server the TV uses, see [`play-vs-claude.md`](play-vs-claude.md) (`--room`).

```
node src/playtest/run.ts --models opus,haiku,haiku
```

One `--models` entry per seat, 2 to 6 seats, in seat order: any `claude --model` alias or full model name (`opus`, `sonnet`, `haiku`, `claude-haiku-5-5`, ...) or `bot`. Other options:

| Option | Default | |
|---|---|---|
| `--seed N` | random | game seed; same seed, same deal |
| `--out DIR` | `~/.cache/board-lite/playtests/<time>-<models>` | where everything goes (refuses `/tmp`, which is RAM on the dev machine) |
| `--effort LEVEL` | the model's own | effort for every Claude seat |
| `--budget-usd N` | 5 | spending cap per Claude seat for the whole game |
| `--max-minutes N` | 240 | stop the game after this long |
| `--stall-minutes N` | 15 | stop if nothing happens in the game for this long |
| `--advice TEXT` | none | strategy advice appended to every Claude seat's prompt, recorded in `results.json`; for A/B tests of how players play |
| `--serve PORT` | off | also open the game's TV and phone pages to the network on PORT, to watch a playtest on a TV (the runner prints the TV link) |
| `--room URL` | none | don't host: join the Claude seats to a room someone else hosts; see [`play-vs-claude.md`](play-vs-claude.md) |

It prints progress and blocks until the game ends, so run it in the background. Several games can run at once with different `--out` dirs, within the limits below.

## How many games run at once

Each Claude seat is a `claude -p` process of 300 to 400 MB, and the dev machine has 14 GB shared with everything else, including every vibrant tab. Several tabs and the orchestrator may each run a batch at the same time, so the limit is machine-wide, not per batch:

- **At most 6 Claude seats run at once on the machine**, across every playtest from every tab: two 3-seat games, three 2-seat games, or one 6-seat game. `bot` seats don't count.
- A game takes one slot per Claude seat before it starts any of them. If the slots aren't free, or free memory (`MemAvailable`) would drop under 2 GB once its seats start (counting 450 MB a seat), it waits, logs `Waiting to start: <why>` in `runner.log`, and starts on its own once the slots free up. `--max-minutes` counts from the start, not from the wait.
- A running game whose machine falls under 1 GB free for 10 seconds stops itself (status `low memory` in `results.json`) rather than let the machine OOM. Rerun it later.
- So start a whole batch at once (all 8 games in the background is fine): the pool runs them a few at a time. Expect a batch to take about (games × seats ÷ 6) game-lengths.
- Slots live in `~/.cache/board-lite/seat-slots/`, one file per running game naming its `--out`, so `ls` there shows who holds them. A game that dies without cleaning up frees its slots automatically (its process is gone).
- `BOARD_LITE_MAX_SEATS=N` changes the limit, and every playtest on the machine must use the same N for it to hold; leave it alone unless the owner says so. A game with more Claude seats than the limit is refused.

## Results

In the `--out` directory:

- `results.json`: status (`over`, `stalled`, `time limit`, ...), seed, rounds, minutes, winner (seat and model), and per seat: name, model (`bot`, or `player: <name>` for someone else's seat in a `--room` game), final points (hidden ones included), and for Claude seats cost and how many times its process was (re)started; plus counts of public and private messages.
- `log.txt`: the whole game log as the engine recorded it, talk included. Lines only some players saw are marked `(only P1, P3)`: private messages, card draws, secret votes and fight-or-bail choices.
- `talk.txt`: just the talk.
- `seat-N.jsonl`: seat N's full Claude transcript (stream-json), including its reasoning between moves.
- `runner.log`, `seat-N.stderr.log`, `game.json` (the game, saved after every change; with `--room` the host keeps it instead).

For a depth batch (Haiku vs Opus), run several games with seats shuffled across games and read `winner.model` from each `results.json`.

## What a player can do

The seat server (`src/playtest/seat-server.ts <room-url> <token>`, an MCP server) plays one seat through the room's HTTP interface and offers:

| Tool | Does |
|---|---|
| `view` | the seat's view (`node src/cli.ts view`): public board, own hand and resources, recent events, options |
| `act` | one decision command, exactly as in `docs/cli.md` |
| `say` | talk: to the table, or with `to: "P2"` privately to one player |
| `wait` | blocks up to 120 s until it's the seat's decision, someone talks, or the game ends; returns the new events |
| `rules` | `docs/rules.md` |

Talk is part of the game: `say <message>` and `tell P2 <message>` are engine commands (any player, any time, binding no one), so they land in the game log and every player's view like other events. Players are told the game is social and to negotiate, ally, bluff and reply when spoken to.

## How the sandbox works

Each player process is started with:

- `--tools ""`: no built-in tools at all (no Bash, Read, Write, Edit, WebFetch, Agent, ...).
- `--strict-mcp-config --mcp-config seat-N/mcp.json`: the one MCP server, its room and seat token fixed on its command line. The room only answers a token with that seat's view, so that's all the player ever sees.
- `--allowedTools mcp__game__*` (the five, by name) with `--permission-mode dontAsk`: anything else would be denied, not prompted.
- `--setting-sources ""`, `--disable-slash-commands`, `--no-chrome`: none of the owner's settings, hooks, plugins, skills or browser.
- cwd `seat-N/` and `TMPDIR` inside `--out`, so nothing lands in `/tmp`.

A player whose process ends before the game does (it stopped calling tools) is resumed in the same session and told to keep playing.
