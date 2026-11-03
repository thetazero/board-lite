# Playing board-lite from the command line

Needs Node 22.18 or newer (it runs the TypeScript directly). Run `npm install` once, then use `node src/cli.ts <command>` (or `npm run game -- <command>`).

The game lives in a JSON file. Every command loads it, does one thing and saves it, under a lock, so one session can play every seat or several separate processes can each play one seat of the same game. The file holds the whole game, hidden parts included, so a player who must not cheat should only get the CLI, never the file. Setting `BOARD_LITE_SEAT=2` restricts a shell to seat 2. Keep game files on disk (e.g. `~/.cache/board-lite/`), not in `/tmp`.

## Commands

```
node src/cli.ts new <game.json> [--players 2-6] [--seed N]   start a game
node src/cli.ts view <game.json> <seat> [--log N]            what that seat sees, and its options
node src/cli.ts do <game.json> <seat> <command...>           make a decision as that seat
node src/cli.ts wait <game.json> <seat> [--timeout SECS]     block until that seat has a decision
node src/cli.ts status <game.json>                           public summary: phase, who we're waiting on
node src/cli.ts bot <game.json> <seat>                       a random bot makes one decision for that seat
node src/cli.ts rules                                        print docs/rules.md
node src/cli.ts sim [--games N] [--players N] [--seed N]     bot-vs-bot games, for rough tuning stats
```

Seats are 1-based. `view` shows only what that player may see: their own resources and hand, plus everything public (map, buildings, dragons, scores without hidden points, titles, hand sizes, open trade offers, raid state) and the recent events visible to them. It ends with **Your options**, the commands that seat can use right now. After `do`, the CLI prints the new events and either your next options or who it's waiting on. A refused command prints `Not allowed: <reason>`, exits 1, and changes nothing.

## The loop for playing every seat

```
node src/cli.ts new ~/.cache/board-lite/g1.json --players 3
node src/cli.ts status ~/.cache/board-lite/g1.json     # "Waiting on: P1"
node src/cli.ts view ~/.cache/board-lite/g1.json 1     # read P1's view and options
node src/cli.ts do ~/.cache/board-lite/g1.json 1 build c49 1,0
node src/cli.ts do ~/.cache/board-lite/g1.json 1 end
```

Repeat: `status` to see whose decision it is, `view` that seat, `do` its decision. In the simultaneous steps (raid vote, commit, fight-or-bail, discards) several seats are waiting at once, in any order. To stay fair when playing every seat yourself, decide each seat from its own `view` only.

## Decision commands

Action phase, on your turn:

| Command | Does |
|---|---|
| `build c12 2,-1` | build the building card c12 on hex 2,-1 (tower floors take no hex: `build c12`) |
| `upgrade c7 2,-1` | put upgrade card c7 on your building at 2,-1 |
| `play c30` / `play c30 stone` / `play c30 d4` | play an action card (some need a resource or a dragon id), or hatch a dragon card |
| `project quarry 2,-1` / `project fire` | special project: a basic building or a base dragon egg, no card, double cost |
| `bank stone gold 2` | pay 2× your bank rate in stone for 2 gold |
| `offer P2 give 2 stone c12 get 1 gold` | propose a trade; items are `<n> <resource>` and card ids |
| `cancel o40` | withdraw your offer |
| `end` | end your turn |

Any time in the action phase: `accept o40` / `decline o40` for an offer made to you, and, out of turn, `offer` to the acting player.

Any time, any phase, anyone: `say <message>` talks to the table and `tell P2 <message>` to one player only. Talk binds no one and changes nothing; it shows up in the log like other events.

Raid phase: `vote 2`; then `commit d3 d7` (or `commit none`) and `ready`; then, if committed, `fight` or `bail`. The fight then plays out to the end with no further choices.

End of round, if over 7 cards: `discard c4 c9`.

## Hex coordinates

Hexes are axial `q,r`. The six neighbours of `q,r` are `q+1,r`, `q-1,r`, `q,r+1`, `q,r-1`, `q+1,r-1` and `q-1,r+1`. The map in a view prints one row per `r`, each cell as `q,r:<terrain>[<owner><building>]`; your options list the open hexes where each of your building cards can go.
