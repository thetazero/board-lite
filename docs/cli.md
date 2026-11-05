# Playing board-lite from the command line

Needs Node 22.18 or newer (it runs the TypeScript directly). Run `npm install` once, then use `node src/cli.ts <command>` (or `npm run game -- <command>`).

The CLI is a client of the board-lite server, like a phone: every game lives on a server (`npm run serve`), in a room. You join a room with a name and get a seat token; the token is your seat, and the server only ever shows it what that seat may see. The CLI asks the server for the same JSON a phone gets and prints it as text. A CLI player can sit at a table with phones, a TV, Claude players and bots (see [`clients.md`](clients.md#playing-from-the-command-line)), or open a room of their own with no TV.

## Commands

```
node src/cli.ts new [server-url]                             open a room with no TV; prints its address
node src/cli.ts join <room-url> <name>                       take a seat; prints your token
node src/cli.ts bot <room-url> <token>                       add a bot to the room (first player only)
node src/cli.ts start <room-url> <token>                     start the game (first player only)
node src/cli.ts view <room-url> <token> [--log N]            what your seat sees, and its options
node src/cli.ts do <room-url> <token> <command...>           make a decision
node src/cli.ts wait <room-url> <token> [--timeout SECS]     block until you have a decision to make
node src/cli.ts status <room-url>                            public summary: phase, who we're waiting on
node src/cli.ts rules                                        print docs/rules.md
node src/cli.ts sim [--games N] [--players N] [--seed N]     bot-vs-bot games, run locally, for rough tuning stats
```

A server URL looks like `http://localhost:8080` (the default for `new`); a room URL like `http://192.168.1.20:8080/ABCD`. `view` shows only what your seat may see: your own resources and hand, plus everything public (map, buildings, dragons, scores without hidden points, titles, hand sizes, open trade offers, raid state) and the recent events visible to you. It ends with **Your options**, the commands you can use right now. After `do`, the CLI prints the new events and either your next options or who it's waiting on. A refused command prints `Not allowed: <reason>`, exits 1, and changes nothing.

## A game at the terminal

```
npm run serve                                              # in another terminal
node src/cli.ts new                                        # "Room ABCD is open: http://localhost:8080/ABCD"
node src/cli.ts join http://localhost:8080/ABCD Ada        # prints Ada's token
node src/cli.ts bot http://localhost:8080/ABCD <token>     # a bot takes seat 2
node src/cli.ts start http://localhost:8080/ABCD <token>
node src/cli.ts view http://localhost:8080/ABCD <token>    # read your view and options
node src/cli.ts do http://localhost:8080/ABCD <token> keep c49
node src/cli.ts wait http://localhost:8080/ABCD <token>    # until it's your decision again
```

Repeat: `wait`, `view`, `do`. To play several seats yourself, `join` once per seat, each with its own name and token. In the simultaneous steps (raid vote, commit, fight-or-bail, discards) several seats are waiting at once, in any order. To stay fair when playing every seat yourself, decide each seat from its own `view` only. Phones can join the same room from the join form with its code.

## Decision commands

Cards phase, at the start of each round (everyone at once): `keep c12` keeps one of the two building cards you drew; the other is discarded.

Action phase, on your turn:

| Command | Does |
|---|---|
| `build c12 2,-1` | build the building card c12 on hex 2,-1 |
| `build quarry 2,-1` | build a basic building, no card: `quarry`, `lumber_camp`, `crystal_mine`, `pasture` or `roost`; `build tower_floor` adds a floor to your tower (no hex) |
| `upgrade c7 2,-1` | put upgrade card c7 on your building at 2,-1 |
| `play c30` / `play c30 stone` / `play c30 d4` | play an action card (some need a resource or a dragon id), or hatch a dragon card |
| `play c40 2,-1` | play a fauna card (Rouse the Bear, Wake the Basilisk): put its beast on hex 2,-1 |
| `clear 2,-1 d3 d7` | send your raid-ready dragons d3 and d7 against what holds 2,-1 (its beast and any rival dragons perched there); the hits they take stay on them |
| `perch 2,-1 d3` | perch your raid-ready dragon d3 on a rival's building at 2,-1 (not a tower): it makes nothing while d3 stays, and d3 doesn't raid |
| `recall d3` | bring your perched dragon d3 home |
| `project fire` | special project: a base dragon egg of that element, no card, double cost |
| `bank stone timber 2` | pay 2× your bank rate in stone for 2 timber (the bank doesn't trade gold) |
| `offer P2 give 2 stone c12 get 1 gold` | propose a trade; items are `<n> <resource>` and card ids |
| `cancel o40` | withdraw your offer |
| `end` | end your turn |

Any time in the action phase: `accept o40` / `decline o40` for an offer made to you, and, out of turn, `offer` to the acting player.

Any time, any phase, anyone: `say <message>` talks to the table and `tell P2 <message>` to one player only. Talk binds no one and changes nothing; it shows up in the log like other events.

Raid phase: `vote 2`; then `commit d3 d7` (or `commit none`) and `ready`; then, if committed, `fight` or `bail`. The fight then plays out to the end with no further choices.

End of round, if over 7 cards: `discard c4 c9`.

## Hex coordinates

Hexes are axial `q,r`. The six neighbours of `q,r` are `q+1,r`, `q-1,r`, `q,r+1`, `q,r-1`, `q+1,r-1` and `q-1,r+1`. The map in a view prints one row per `r`, each cell as `q,r:<terrain>[<owner><building>]`; your options list the open hexes where each of your building cards can go.
