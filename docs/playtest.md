# Sandboxed Claude playtests

`src/playtest/run.ts` runs one game where every seat is a Claude player (or the random bot). Each Claude player is its own `claude -p` process, and the only tools it has are five game tools for its own seat. It can't run commands, read or write files, browse, or act for another seat.

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

It prints progress and blocks until the game ends, so run it in the background. Several games can run at once with different `--out` dirs.

## Results

In the `--out` directory:

- `results.json`: status (`over`, `stalled`, `time limit`, ...), seed, rounds, minutes, winner (seat and model), and per seat: model, final points (hidden ones included), cost, how many times its process was (re)started; plus counts of public and private messages.
- `log.txt`: the whole game log as the engine recorded it, talk included. Lines only some players saw are marked `(only P1, P3)`: private messages, card draws, secret votes and fight-or-bail choices.
- `talk.txt`: just the talk.
- `seat-N.jsonl`: seat N's full Claude transcript (stream-json), including its reasoning between moves.
- `runner.log`, `seat-N.stderr.log`, `game.json` (the final state).

For a depth batch (Haiku vs Opus), run several games with seats shuffled across games and read `winner.model` from each `results.json`.

## What a player can do

The seat server (`src/playtest/seat-server.ts <game.json> <seat>`, an MCP server) offers:

| Tool | Does |
|---|---|
| `view` | the seat's view (`node src/cli.ts view`): public board, own hand and resources, recent events, options |
| `act` | one decision command, exactly as in `docs/cli.md` |
| `say` | talk: to the table, or with `to: "P2"` privately to one player |
| `wait` | blocks up to 60 s until it's the seat's decision, someone talks, or the game ends; returns the new events |
| `rules` | `docs/rules.md` |

Talk is part of the game: `say <message>` and `tell P2 <message>` are engine commands (any player, any time, binding no one), so they land in the game log and every player's view like other events. Players are told the game is social and to negotiate, ally, bluff and reply when spoken to.

## How the sandbox works

Each player process is started with:

- `--tools ""`: no built-in tools at all (no Bash, Read, Write, Edit, WebFetch, Agent, ...).
- `--strict-mcp-config --mcp-config seat-N/mcp.json`: the one MCP server, its seat fixed on its command line. The game file holds every hand, but only the server reads it; the player sees only what the server returns, which is that seat's view.
- `--allowedTools mcp__game__*` (the five, by name) with `--permission-mode dontAsk`: anything else would be denied, not prompted.
- `--setting-sources ""`, `--disable-slash-commands`, `--no-chrome`: none of the owner's settings, hooks, plugins, skills or browser.
- cwd `seat-N/` and `TMPDIR` inside `--out`, so nothing lands in `/tmp`.

A player whose process ends before the game does (it stopped calling tools) is resumed in the same session and told to keep playing.
