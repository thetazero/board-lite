# Model eval and leaderboard

How well does each AI model play board-lite? The eval plays games among a roster of Claude and Codex models (or a [contest](#run-a-contest): a bucket of players drawn into games of 2 to 6), and the leaderboard gives every model a rating from the games it finished. The leaderboard also rates you, and anyone else, from games played on `npm run serve` against bots or AI players.

Nothing here runs by itself: the eval costs real money and hours, so you start it.

## Run the eval

First check what it would play (this plays nothing):

```
node src/playtest/eval.ts --models opus,sonnet,haiku,codex:gpt-5.6-sol --dry-run
```

Then run it, in the background:

```
npm run eval -- --models opus,sonnet,haiku,codex:gpt-5.6-sol
```

- `--models` is the roster: Claude models (`opus`, `sonnet`, `haiku`, or a full name like `claude-haiku-5-5`), Codex models as `codex:<model>`, `bot` (the random bot) and `strongbot` (the [strong bot](strongbot.md)), each Claude or Codex model with any [player options](playtest.md#claude-player-options) (`opus+expected`). List a model twice to give it two entries.
- Each game has `--seats` players (default 3). The eval plays every lineup of 3 from the roster, and each lineup in every seat order (seat order matters: see [`playtest.md`](playtest.md#depth-batches)). That's one **round**: with 4 models, 4 lineups × 3 seat orders = 12 games, each model in 9. `--games N` plays N games instead: every lineup comes up once before any comes up twice, so a short eval is still fair.
- Games go in `~/.cache/board-lite/playtests/<time>-eval-<models>/g<i>`, each one a normal playtest directory ([`playtest.md`](playtest.md#results)). At the end it writes `leaderboard.md` there, for those games alone.
- **Stopped, or want more?** Run the same command with `--out <that directory>` and a bigger `--games`. Finished games are kept; unfinished ones are played again; new ones are added. Two rounds of 4 models is `--games 24`.
- Other options: `--parallel N` (games at once, default 1), `--budget-usd N` (cap per Claude seat a game, default 60), `--seed N`, `--effort`, `--max-minutes`, `--stall-minutes`. `node src/playtest/eval.ts --help` lists them.

## Run a contest

A contest ranks a bucket of players: models, [Claude player configurations](playtest.md#claude-player-options) and the bot. Each game draws 2 to 6 players from the bucket, so no one board size decides the ranking, and the leaderboard scores them all by their finishing places. Check the draw first (this plays nothing):

```
node src/playtest/eval.ts --models haiku,sonnet,opus,opus+advice+expected,opus+advice+expected+fable51,bot \
  --advice "$(cat advice.txt)" --seats 2-6 --games 40 --seed 1 --dry-run
```

Then run it, in the background: the same with `npm run eval --` and without `--dry-run`. It needs `--games`.

- `--seats 2-6` is the range of game sizes; `--seats 3-4` works too. It can't go above the bucket's size.
- **The draw is random but balanced**, game by game: each size comes up once, in random order, before any comes up again; each game takes the players with the fewest games so far, and among those the group that has met least; each player gets the seat they've had less of than their share. `--dry-run` prints the games, then each player's games, seats against their fair share, and how often they met each other player. In the draw above, every player has 26 or 27 games, meets each other player 18 to 20 times, and sits in each seat within one game of its share.
- `--advice` goes to the entries with `+advice`, and only to games that have one.
- The draw is kept in `draw.json` in the contest's directory. Rerun with `--out <that directory>` and a bigger `--games` to add games to it: the games already drawn stay, and the new ones keep the balance. `--seed` seeds the draw (and the games, as in an eval).
- At the end, `leaderboard.md` in that directory ranks the bucket, with how sure each rating is (the 95% range, [below](#the-leaderboard)), and the draw's balance under it. `npm run leaderboard -- <that directory>` shows it at any time, for the games finished so far, and `npm run live -- <that directory>` serves a page that follows it as games finish, for a phone too ([below](#watch-a-contest-live)).
- **How many games:** from simulated contests of the bucket above, each rating's 95% range is about ±125 points after 40 games and ±90 after 80. That tells the bot, Haiku and Opus apart after 40, but two Opus configurations close to each other (under 100 points apart) need 100 games or more.
- **Cost:** a game averages 4 players, so each Opus entry plays two games in three. At $2 to $11 an Opus seat a game, the bucket above is roughly $10 to $20 a game, $400 to $800 for 40. One game runs at a time by default (`--parallel 1`, for the reason below), so 40 games are 40 game-lengths or more (6-player games run longer).

### Watch a contest live

```
npm run live -- ~/.cache/board-lite/playtests/<the contest's directory>
```

serves a page for a contest (or an eval) while it runs: the ratings so far, each with its 95% range drawn as a bar; games finished and left, with about how long the rest will take at the number of games being played at once now (so a contest restarted with another `--parallel` is timed by how it plays now); the game being played now, its round, phase and each seat's points, and a button to watch its board; and the last games' results. It updates by itself every 10 seconds, and it's laid out for a phone.

It prints a link for this machine and, when Tailscale is running, a link on the tailnet (`http://<machine>.<tailnet>.ts.net:8790/`) with a QR code of it in the terminal: open it on a phone on the same tailnet. It listens only on this machine and its Tailscale address, not the rest of the network (`--host ADDR` to pick one, `--port N` for another port).

**Watch the table** under the game being played opens its board live: the same table view a phone's **Table** shows in a game with no TV (the map, each player's dragons and points, what just happened), updating as the players move. The game's runner hosts its room on this machine only, so the page passes that room's table view through its own port, read-only: it lets through nothing that acts in the game, and nothing with a seat's token. The players are named there as at the table (Rowan, Tick, …); the live page shows each seat's table name beside its model. When the game ends its runner closes the room, and the next game's button appears on the live page.

It only reads the contest's directory, on every refresh, so it works for a contest that's already running, and stopping it does nothing to the contest. A game whose runner has gone shows as stopped; one that didn't finish and was played again is counted under the progress bar.

### Cost and time

From the playtest at c4162c8 (19 rounds, about 75 minutes): $11.55 for the Opus seat, $4.56 for Sonnet, $2.40 for Haiku (API-equivalent). So one round of `opus,sonnet,haiku` plus one Codex model is about 12 game-lengths (15 hours) and $170 of Claude, plus the Codex seat's usage of your ChatGPT plan. Codex reports tokens, not dollars; the leaderboard shows its tokens a game.

The default budget of $60 a seat is there because Opus spends over $10 a game, and an Opus seat with advice in a long 6-player game went past $25 (contest-1111, game 15): with a lower cap, seats stop partway and the games don't count. The playtest default is $5.

One game at a time by default: three Claude seats starting at once, with other work on the machine, has set off the memory reaper, which killed the game server and the runner. The seat pool and memory checks ([`playtest.md`](playtest.md#how-many-games-run-at-once)) still apply on top of `--parallel`. A game killed for low memory isn't lost: rerun the same command.

## The leaderboard

```
npm run leaderboard
```

It reads every finished game it can find and plays none:

- every playtest, batch and eval under `~/.cache/board-lite/playtests` (or the directories you name: `npm run leaderboard -- <dir> ...`);
- every game played on `npm run serve` (`~/.cache/board-lite/rooms`), so your games against bots count. Claude or Codex players seated in your room with `run.ts --room` are named by their model, from that runner's `results.json`.

```
| # | Player | Rating | 95% range | Games | Wins | Average place | Cost a game |
|---|---|---|---|---|---|---|---|
| 1 | claude-opus-5-5 | 1676 | 1615 to 1738 | 88 | 68 | 1.30 | $2.26 |
| 2 | haiku | 1400 | 1364 to 1437 | 88 | 20 | 2.26 | $0.21 |
| 3 | Lesha (person) | 1378 | 784 to 1971 | 1 | 0 | 2.00 | |
```

How to read it:

- **Rating:** on the Elo scale. 400 points above another player means finishing ahead of it 10 times in 11; 200 points, 3 times in 4; 100 points, 2 times in 3. The average seat is 1500, so ratings say how players compare with each other, not against a fixed bar: adding a strong player moves the others down a little. The random bot, if it played, is the floor to read the rest against.
- **95% range:** where the rating really is, from these games. Two players whose ranges overlap a lot aren't told apart yet; play more games. One game gives a range about 1000 points wide; a model's range narrows as it plays more.
- **Games, Wins, Average place:** the raw record (1.00 = won every game).
- **Cost a game:** what a Claude seat spent, or a Codex seat's tokens.

Options: `--since 2026-11-01` counts only games that ended on or after a date. Use it after a rules change, since a rating mixes every game it reads. `--no-rooms` leaves out games on `npm run serve`, and `--out FILE` also writes the table to a file.

### Who's who

- A **model** is the model a Claude seat reported running (`claude-opus-5-5`), or the name it was given (`opus`) for games from before that was recorded; Codex seats are `codex:<model>`. A seat's [player options](playtest.md#claude-player-options) are part of the name (`claude-opus-5-5+expected`), and so is an `--effort` other than the model's own (`claude-opus-5-5 @high`): a model with other options or at another effort is another player.
- A **person** is the name they joined with, whatever the case. Join with the same name every time to keep one rating. A player who quit partway (a bot finished for them) isn't rated for that game.
- `bot` is the random bot (`src/bot.ts`), the same in playtests and on `npm run serve`. `strongbot` is the strong bot (`src/strongbot.ts`): pure code that plays to win, a free baseline between the random bot and the models.

### What counts

Only games that ended (`over`). Left out, and counted at the bottom of the table: unfinished games, games played with `--advice` from before seats were named by their options (#476), and games with fewer than two different players (all the same model, or bots only).

A seat with `+advice` is named by its advice too, as `claude-opus-5-5+advice:3f2a+expected`: the 4 characters are from the advice text (the start of its SHA-1), so two different texts are two different players.

### How the rating works

`src/playtest/rating.ts`. Each finished game is split into its pairs of players: the winner finished ahead of everyone, 2nd place ahead of 3rd and so on; players level on points tie. Each pair counts 1/(players − 1), so a 6-player game weighs the same as a 2-player game for each player in it. The same model in two seats gives no result between them. The ratings are the Bradley–Terry fit of all those results at once (the model behind Elo), with a weak prior that keeps a player with one or two games from flying off to infinity. Being fitted all at once, the ratings don't depend on the order games were played in, unlike game-by-game Elo updates.

Places come from the final scores the engine logged: the winner first, even when they won a tie on gold or turn order.

## Codex seats

A Codex seat is `codex exec` (Codex CLI 0.154), sandboxed as tightly as a Claude seat ([`playtest.md`](playtest.md#how-the-sandbox-works)): its only tools are the game's five, through the same seat server.

- `--ignore-user-config --ignore-rules`: none of your Codex settings, rules or project docs (auth still comes from `~/.codex`).
- `--disable` for the shell, web, browser, computer use, images, plugins, apps, hooks and sub-agents, plus `agents.max_depth=0` (`--disable multi_agent` alone leaves sub-agents on), `web_search="disabled"` and `sandbox_mode="read-only"`.
- Two things Codex 0.154 keeps on regardless. One is `apply_patch`, which the read-only sandbox rejects. The other is "code mode", a JavaScript runner it calls tools through, which has no `require`, `fetch` or files.

This was checked by hand on 0.154 (no game): asked to list its tools, run `ls /`, read `~/.bashrc`, write a file, fetch a page and start a sub-agent, it could do none of them, and it reached the game tools. Recheck after upgrading Codex.

Codex picks its own session id; the runner saves it in `runner.json`, so `--resume` works for Codex seats too. Its transcript (`codex exec --json` events) is in `seat-N.jsonl`. A ChatGPT login only serves some models (`gpt-5.5` was refused); `~/.codex/models_cache.json` lists what it offers.
