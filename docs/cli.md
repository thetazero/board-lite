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
node src/cli.ts do <room-url> <token> '<command>'            make a decision (JSON)
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
node src/cli.ts do http://localhost:8080/ABCD <token> '{"do":"keep","card":"c49"}'
node src/cli.ts wait http://localhost:8080/ABCD <token>    # until it's your decision again
```

Repeat: `wait`, `view`, `do`. To play several seats yourself, `join` once per seat, each with its own name and token. In the simultaneous steps (raid vote, fight or hold back, discards) several seats are waiting at once, in any order. To stay fair when playing every seat yourself, decide each seat from its own `view` only. Phones can join the same room from the join form with its code.

## Decision commands

A command is a JSON object: `do` says which, and each takes only the fields below. The phones, the bots and Claude players send the same ones (`src/command.ts`, `rust/src/command.rs`). Cards, dragons and offers are named by their ids (`"c12"`, `"d3"`, `"o40"`), hexes as `"2,-1"`, players as `"P2"`. Anything else is refused: `No such command: ...`.

Cards phase, at the start of each round (everyone at once): `{"do":"keep","card":"c12"}` keeps one of the two building cards you drew; the other is discarded.

Action phase, on your turn:

| Command | Does |
|---|---|
| `{"do":"build","card":"c12","hex":"2,-1"}` | build the building card c12 on hex 2,-1 (a card for your tower takes no hex) |
| `{"do":"build_basic","building":"quarry","hex":"2,-1"}` | build a basic building, no card: `quarry`, `lumber_camp`, `crystal_mine`, `pasture` or `roost`; `tower_floor` adds a floor to your tower (no hex) |
| `{"do":"upgrade","card":"c7","hex":"2,-1"}` | put upgrade card c7 on your building at 2,-1 |
| `{"do":"play","card":"c30"}` | play an action card, or hatch a dragon card. Some action cards need a `"resource":"stone"` or a `"dragon":"d4"`; a fauna card (Rouse the Bear, Wake the Basilisk) needs the `"hex"` its beast goes on |
| `{"do":"clear","hex":"2,-1","dragons":["d3","d7"]}` | send your raid-ready dragons d3 and d7 against what holds 2,-1 (its beast and every rival dragon perched there, together; a coin flip says which side strikes first); the hits they take stay on them. Dragons not knocked out can clear again this turn, and still raid |
| `{"do":"auto_clear"}` | clear your own held buildings, weakest first, with all your raid-ready dragons, until one fight is lost |
| `{"do":"perch","hex":"2,-1","dragons":["d3"]}` | perch your raid-ready dragon d3 on a rival's building at 2,-1 (not a tower): it's suppressed (counts as if it weren't there) while d3 stays, and d3 doesn't raid. Dragons perched on one building fight together when it's cleared |
| `{"do":"recall","dragons":["d3"]}` | bring your perched dragon d3 home |
| `{"do":"project_egg","element":"fire"}` | special project: a base dragon egg of that element, no card, double cost |
| `{"do":"project_upgrade","upgrade":"workshop","hex":"2,-1"}` | special project: a Workshop on that building of yours, no card, at the special project cost |
| `{"do":"merchants","pay":"stone","gain":"timber","times":2}` | pay 2× your merchants' rate in stone for 2 timber (the merchants don't trade gold; `times` is 1 if left out) |
| `{"do":"offer","to":"P2","give":{"stone":2,"cards":["c12"]},"get":{"gold":1}}` | propose a trade: give resources, cards or both (everyone sees which cards), for resources: you can't ask for cards |
| `{"do":"offer","to":"anyone","give":{"stone":2},"get":{"timber":1}}` | propose a trade to every other player at once; the first to accept trades |
| `{"do":"cancel","offer":"o40"}` | withdraw your offer |
| `{"do":"end"}` | end your turn |

Any time in the action phase: `{"do":"accept","offer":"o40"}` or `{"do":"decline","offer":"o40"}` for an offer made to you or open to anyone, and, out of turn, `offer` to the acting player. A late answer hears what became of the offer, whatever the phase.

Any time, any phase, anyone: `{"do":"say","message":"..."}` talks to the table and `{"do":"tell","to":"P2","message":"..."}` to one player only. Talk binds no one and changes nothing; it shows up in the log like other events.

Raid phase: `{"do":"vote","target":"frostpeak"}` (your options list the kingdoms); then, if you have a raid-ready dragon (all of them are in the raid), `{"do":"fight"}` (all your dragons in it fight), `{"do":"fight","dragons":["d3","d7"]}` (those fight, the rest hold back) or `{"do":"hold"}` (all hold back). The fight then plays out to the end with no further choices.

End of round, if over 7 cards: `{"do":"discard","cards":["c4","c9"]}`.

## Hex coordinates

Hexes are axial `q,r`. The six neighbours of `q,r` are `q+1,r`, `q-1,r`, `q,r+1`, `q,r-1`, `q+1,r-1` and `q-1,r+1`. The map in a view prints one row per `r`, each cell as `q,r:<terrain>[<owner><building>]`; your options list the hexes where each of your building cards can go.
