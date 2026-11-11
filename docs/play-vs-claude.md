# Playing against Claude

There's one game, and every player sits at it the same way: phones, CLI players and Claude players all join a room on the board-lite server and send the engine's commands through the same room interface. A Claude player is just another client, one that `src/playtest/run.ts` starts and sits at the table for you. The TV and phone pages are something the host serves; a table of only Claude players doesn't need them.

## Start a game

On the machine that hosts (the laptop):

```
npm run serve -- --flee-seconds 60
```

`--flee-seconds 60` gives everyone a minute to choose stay or flee in a raid battle instead of the usual 10 seconds, long enough for a Claude player to read the battle and answer. Leave it out for the normal 10-second clock, but then Claude players will nearly always stay, because they can't decide that fast.

1. **TV:** open `http://localhost:8080/tv` on the laptop (or the TV it's plugged into). It shows the room code and the addresses phones can use: the local network one, and the Tailscale one if this machine is on a tailnet.
2. **Your phone:** open the address the TV shows and join with your name. Over Tailscale, use the `100.x.y.z` address; the phone must be signed in to the same tailnet. That works from anywhere, not only on the same Wi-Fi. If the laptop runs a firewall, let the tailnet in (with ufw: `sudo ufw allow in on tailscale0`).
3. **Claude players:** in the repo on the laptop, with the room code the TV shows (the server's terminal prints this command with the room filled in when the TV opens the room):

   ```
   node src/playtest/run.ts --room http://localhost:8080/ABCD --models opus+expected,haiku+expected
   ```

   One `--models` entry per Claude player (1 to 5): `opus`, `sonnet`, `haiku`, a full model name, or a Codex model as `codex:<model>`, then its options: `+expected` shows it each player's expected production each round and what they made at the latest roll; without it, the player sees production as dice only. See [Claude player options](playtest.md#claude-player-options). They join the lobby with plain names (Rowan, Quinn, ...) that don't say which model plays which seat, so the Claude players can't tell either; the runner prints which is which. Leave it running: it runs the Claude players until the game ends. Ctrl-C stops them, and the game then waits on their seats; bring them back with `--resume` (below).
4. **Start:** press **Start game** on the TV (or on the first player's phone). Bots can fill seats too ("Add a bot").

Claude players start the moment the game does. Each is a `claude -p` process of 300 to 400 MB, and they share the machine's free memory with any playtests running (see [`playtest.md`](playtest.md#how-many-games-run-at-once)). If the slots aren't free, the runner prints `Waiting to start: ...` and only joins the lobby once they are, so wait for the Claude players to show up on the TV before you press Start.

Each Claude player may spend up to **$30** over the whole game. That's enough for a full game: in one 14-round game an Opus player had spent $6.80 and the game wasn't over. A player that reaches it stops, and so does the runner (`Finished (P2 hit its budget)`). Change it with `--budget-usd N`. Continuing a saved game keeps the budget the runner had, and counts what each player has already spent.

Other `run.ts` options work here too: `--effort`, `--advice`, `--max-minutes`, `--stall-minutes` (60 by default with `--room`: it stops the Claude players if nothing happens in the game for that long).

## Saving and continuing

**Save game** on the TV or a phone stops the game for everyone, the Claude players too: their runner sees it and stops (its `runner.log` says so). When someone at the table presses **Continue**, the server starts that runner again with `--resume`, and the Claude players come back to their own seats with their memory of the game. Nobody needs a terminal. See [Saving a game](clients.md#saving-a-game).

This works for a runner on the same machine as the server: when it takes its seats, it lists its `--out` directory beside the game (`~/.cache/board-lite/rooms/<code>.claude.json`), and Continue starts every runner listed there. A runner started again this way writes what it does to `runner.log` as usual, and anything it fails on to `runner.errors.log` in the same directory.

## If the Claude players stop

If the runner stops before the game ends (Ctrl-C, low memory, a crash, a restart), the game waits on the Claude players' seats. Bring the same players back into their own seats, remembering the game so far:

```
node src/playtest/run.ts --resume ~/.cache/board-lite/playtests/<time>-<models>
```

The runner prints this command, with its directory filled in, when it stops early. Add `--room URL` if the room's address changed (the server restarted on another port). See [Resuming a game](playtest.md#resuming-a-game).

## Talking with Claude

Claude isn't in the room, so it only hears what goes through the game. On the phone, the bar at the bottom is the table talk: tap it to read everything said and to talk, to **Everyone** (it shows on the TV) or to one player privately (only they see it). Claude players read and answer talk the same way, and they're told who at the table is a person.

The TV shows the latest public talk next to the game events. Private messages between other players never show anywhere but their own phones (or the Claude player's own view).

## What Claude can see and do

Each Claude player's only tools are five game tools for its own seat (view, act, say, wait, rules), served by `src/playtest/seat-server.ts`, which holds that seat's token and talks to the room like a phone does. The room only ever returns that seat's view: its own hand and resources, plus what's public. Each Claude player runs with no built-in tools (no shell, files or web), none of your settings, hooks or plugins, and its working directory and temp files inside the runner's `--out` directory. See ["How the sandbox works"](playtest.md#how-the-sandbox-works).

## Afterwards

The runner writes its `--out` directory (default `~/.cache/board-lite/playtests/<time>-<models>/`): `results.json` (winner, points, each Claude player's cost), `log.txt` (the whole game, talk included), `talk.txt`, and each Claude player's full transcript, reasoning included, in `seat-N.jsonl`. The server keeps the game itself in `~/.cache/board-lite/rooms/<code>.json`. Once it's over, it counts on the leaderboard (`npm run leaderboard`, see [`eval.md`](eval.md)): you're rated under the name you joined with.
