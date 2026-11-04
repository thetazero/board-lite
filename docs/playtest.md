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
- So start a whole batch at once (`batch.ts`, below, or all games in the background): the pool runs them a few at a time. Expect a batch to take about (games × seats ÷ 6) game-lengths.
- Slots live in `~/.cache/board-lite/seat-slots/`, one file per running game naming its `--out`, so `ls` there shows who holds them. A game that dies without cleaning up frees its slots automatically (its process is gone).
- `BOARD_LITE_MAX_SEATS=N` changes the limit, and every playtest on the machine must use the same N for it to hold; leave it alone unless the owner says so. A game with more Claude seats than the limit is refused.

## Results

In the `--out` directory:

- `results.json`: status (`over`, `stalled`, `time limit`, ...), the commit the runner ran on, seed, rounds, minutes, winner (seat and model), and per seat: name, model (`bot`, or `player: <name>` for someone else's seat in a `--room` game), final points (hidden ones included), and for Claude seats cost and how many times its process was (re)started; plus counts of public and private messages.
- `log.txt`: the whole game log as the engine recorded it, talk included. Lines only some players saw are marked `(only P1, P3)`: private messages, card draws, secret votes and fight-or-bail choices.
- `talk.txt`: just the talk.
- `seat-N.moves.txt`: why seat N made each move. Every `act` (and `say`) carries a private `why` that no other player sees, and this file pairs each one with what really happened (`-> done` or `-> not allowed: can't afford ...`). It's the record of reasoning to audit: read it, not the narration.
- `seat-N.jsonl`: seat N's full Claude transcript (stream-json): every tool call and result and the text between them. Its thinking blocks are empty: `claude -p` drops thinking from its output (there is no flag to keep it), which is why `why` exists. The text between moves is narration, sometimes of a move that then failed; check it against the tool results or `seat-N.moves.txt`.
- `runner.log`, `seat-N.stderr.log`, `game.json` (the game, saved after every change; with `--room` the host keeps it instead).

Claude seats are named Rowan, Quinn, Ellis, ... in seat order, never after their model, so no player knows which opponent is the stronger one. Which model plays which name is only in `runner.log` and `results.json`.

## Depth batches

"Does haiku regularly lose to opus? If not, the game has no depth." One game, or four, can't answer it: with 1 Opus against 2 Haiku a no-skill Opus still wins 1 game in 3, and 4 games can't tell "no depth" from "some depth". `batch.ts` runs a batch big enough and tallies it:

```
node src/playtest/batch.ts --games 30 --models opus,haiku,haiku
```

- Game *i* goes in `<out>/g<i>` and rotates the seats *i*-1 places, so each model sits in each seat equally often (seat order matters: in batch b13-0921, P2 won all 4 games). It takes `--out`, `--seed` and the run.ts options `--effort`, `--budget-usd`, `--max-minutes`, `--stall-minutes`, `--advice`, passed to every game.
- It runs as many games at once as the seat pool can seat (two 3-seat games) and the rest after them. Run it in the background: about (games × Claude seats ÷ 6) game-lengths, so 30 three-seat games are 15 game-lengths, about 2 hours on an idle machine, and about $55 at today's costs (Opus about $1.80 a game, Haiku under $0.10).
- A game that doesn't finish (`stalled`, `low memory`, ...) is left in `g<i>.failed<n>`; run the same command with the same `--out` again to rerun just those.
- At the end it writes `<out>/summary.md`: per model, games, wins, win rate with a 95% range, its fair share of wins (its share of the seats), and the chance of that many wins or more if every seat were equally strong; wins by seat; one line per game; then the batch's [stats](#stats). `node src/playtest/batch.ts --summary <out>` rewrites it at any time, e.g. while the batch runs.

How many games: **30**, with 1 Opus and 2 Haiku. Opus "regularly" beating Haiku means Opus wins clearly more than 1 in 3. Over 30 games, 15 or more Opus wins happens by chance under 5% of the time; an Opus that really wins 60% of its games gets there 9 times in 10 (with 20 games, only 3 in 4; at 50% it takes 60 games to be as sure). So: fewer than 15 of 30 means no clear depth so far; 15 or more means depth, and the chance column says how sure. Read `seat-N.moves.txt` for why the winners won.

## Stats

What happened in every game, counted from its `game.json` by `src/playtest/stats.ts`: exact, free (no Claude involved), and in every batch's `summary.md` without extra steps. Read it before sending an audit agent through the transcripts; the audit is for *why*, the stats are for *what* and *how often*.

```
node src/playtest/stats.ts <batch dir>                 # print a batch's stats
node src/playtest/stats.ts --compare <dir A> <dir B>   # two batches side by side, e.g. before and after a tuning pass
```

- **Per game:** each seat's points round by round, by source (dragons, buildings, titles, great beasts; Secret Hoards only at the end, since discards are secret); who took each title and when, and how many rounds each seat held it; what each seat built, upgraded, played and hatched, and its special projects; raids (targets chosen and fallen, who joined, who took loot, raid gold, bails); fauna and great beasts fought and cleared; trade offers, trades and declines; bank trades; talk (to the table, private, words).
- **Per batch:** the same rolled up per model, average points by round, and every building, upgrade, action card, dragon, special project and fauna with its uses, how often it was drawn or offered, and a flag when it was **never** used or used in **every** game.
- **Exact:** points are rebuilt from the log's events and scored with the engine's own `score()`; at the end they're checked against the saved game and the game's own final scores. A mismatch is printed, never hidden.
- **Rules change, numbers don't:** `results.json` records the commit a game ran on (`commit`). Stats that come out exact are saved to `<batch dir>/stats.json`; once the scoring rules change, `stats.ts` and `--compare` read that file instead, so an old batch keeps its own numbers. For a batch played before this existed, run `stats.ts` once from a checkout of the commit it was played on (`git worktree add --detach <dir> <commit>`) to save its `stats.json`.

## What a player can do

The seat server (`src/playtest/seat-server.ts <room-url> <token>`, an MCP server) plays one seat through the room's HTTP interface and offers:

| Tool | Does |
|---|---|
| `view` | the seat's view (`node src/cli.ts view`): public board, own hand and resources, recent events, options |
| `act` | one decision command, exactly as in `docs/cli.md`, with a private `why` (see `seat-N.moves.txt`) |
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
