# Playing on a TV and phones

The shared board runs in a browser on the TV; each player joins from their phone's browser with a room code. One machine runs the server, which hosts the game; the TV and phones only need a browser on the same network.

It's one game whatever the client: phones, the TV and the command line all use the same room interface, so a table can mix phone players, CLI players, Claude players and bots. See "Playing from the command line" below, and [`play-vs-claude.md`](play-vs-claude.md) to play against Claude.

## Run it

Needs Node 22.18 or newer. In the repo:

```
npm install
npm run serve                  # or: node src/server/server.ts --port 8080
```

It prints the addresses to use, e.g.

```
board-lite is running on port 8080.
  TV:     http://localhost:8080/tv   (or http://192.168.1.20:8080/tv)
  Phones: http://192.168.1.20:8080/
  Phones over Tailscale: http://100.101.102.103:8080/
```

`--flee-seconds N` changes the stay-or-flee clock in raid battles (10 seconds by default).

1. **TV:** open the TV address in a browser on the TV (or on a laptop plugged into it), full screen (F11). It makes a room and shows its 4-letter code and the address phones should open.
2. **Phones:** open the room's address the TV shows (`http://<that machine's address>:8080/ABCD`), type a name, and join. (The bare address works too; then type the code.) Each player gets a colour.
3. **Start:** with 2 to 6 players in, press **Start game** on the TV or on the first player's phone. **Add a bot** fills an empty seat with the random test bot (handy for trying it alone).

If phones can't connect: they must be on the same Wi-Fi as the server machine, or on the same tailnet using its Tailscale address, and its firewall must allow the port (on Linux with ufw: `sudo ufw allow 8080/tcp`, or `sudo ufw allow in on tailscale0` for the tailnet). Some guest Wi-Fi networks block devices from reaching each other.

A phone that reloads or drops its connection rejoins its seat on its own (the seat is remembered in that browser). A TV that reloads keeps its room (the code is in its address). The server saves each game to `~/.cache/board-lite/rooms/<code>.json` after every change; `npm run serve -- --game <file>` hosts a saved game again (after a restart, or one started in the CLI's file mode), with every seat open for players to claim by joining.

## Playing from the command line

A CLI player sits at the same table. Use the room's address in place of a game file, and the seat token `join` gives you in place of the seat number:

```
node src/cli.ts join http://192.168.1.20:8080/ABCD Claude    # prints your seat and token
node src/cli.ts view http://192.168.1.20:8080/ABCD <token>
node src/cli.ts do   http://192.168.1.20:8080/ABCD <token> build c12 2,-1
node src/cli.ts wait http://192.168.1.20:8080/ABCD <token>
```

Everything else is as in [`cli.md`](cli.md): the same view, the same commands, the same replies. The TV and phones update the moment a CLI player moves, and the other way round. If the first player to join is at the CLI, `node src/cli.ts start <room> <token>` starts the game.

## What's where

- **TV** (everything public): the hex map with every building, each player's points, cards in hand, production per round (`2 +d3` is 2 plus a d3 roll), dragons with life stage, growth and health, the titles (everyone's count, the holder's ringed, and the count it takes to hold one), open trade offers, and the last few events, drawn as icon rows rather than sentences (who, then what they built, hatched, traded or played). Each round opens with the production dice rolling on screen. The raid takes over the screen: the three candidate kingdoms during the vote, everyone's public commitments, who has decided to fight or bail (not what), then the fight replayed blow by blow, health bars falling as the hits land, and who won and what they took. The final scores get their own banner.
- **Phone** (only yours): your resources, each with what a round brings in under it (production minus what your dragons eat, e.g. `+2 +3d6`), your points including secret ones, your roost (your dragons, their growth, health and whether they're hungry or hurt, and an empty nest for each dragon you have room for), your hand (illustrated paper cards held in a fan along the bottom edge; on your turn the ones you can play now glow; tap one to see it full size with its rules and play it, or leaf through the hand from there; new cards fly in as you draw them; to discard, tap cards in the fan), and whatever you're being asked right now. On your turn: play cards (pick the hex on a small copy of the map), special projects, the bank, trades and **End turn**. Out of turn: offer the acting player a trade, and accept or decline offers made to you. In the raid: vote, commit dragons and lock in, fight or bail in secret, stay or flee.

- **Table talk**: people in the room just talk, but players who aren't (Claude, or someone at a terminal) only hear what goes through the game. The bar at the bottom of the phone shows the latest message; tap it to read the conversation and to talk to everyone or privately to one player. The TV shows the latest public talk beside the events. CLI players use `say` and `tell`.

## Trying it without a group

```
node src/server/demo.ts --players 3 --round 3
```

starts a server with a game already in round 3, played by bots except for the first seat, and prints a TV link and a phone link for that seat (open the phone link in a narrow browser window). `--all-bots` lets bots play every seat; `--seed N` picks the game.

## Staged screenshots (for look tuning)

```
npm run shots                    # every scene, about 15 seconds
npm run shots -- --only raid     # scenes whose name contains "raid"
npm run shots -- --out DIR       # somewhere else
```

writes TV (1920×1080) and phone (390 wide at 2×, the whole page) screenshots of staged situations to `~/.cache/board-lite/staged-shots/latest/`, with an `index.html` contact sheet. The run before moves to `latest.previous`; files that differ from it are starred in the output and outlined in the sheet, so a visual change shows exactly which screens it touched.

- **The scenes** (`src/shots/scenes.ts`): the lobby and joining, the opening production roll, an early board, building, the bank, trade offers in and out, the raid's vote, commit, fight-or-bail, a won raid's fight mid-replay and at its end, discarding, a new round's production, late-game boards and the final scores, across 2 to 6 players, plus a staged hand holding one of every card (for judging the deck as a set). Each is a seeded bot game played until a condition holds, plus a few scripted commands (bots don't offer trades). Add a scene by adding an entry there.
- **The same every run:** the games are seeded, the pages' clock is frozen, CSS animations are off, and the TV shows a fixed address, so the same code gives byte-identical images. A change to the rules or the numbers can move a scene to a different moment (or the next seed, if its condition stops holding); `npm test` checks every scene still stages.
- **How:** the real server and clients, with each scene hosted as a room whose seats nobody plays, so nothing moves on its own; one headless Chrome (about 1 GB) driven over the DevTools protocol, no extra dependencies. It finds Chrome at the usual paths, or set `CHROME=/path/to/chrome`. Its profile and the output stay under `~/.cache/board-lite/`, never `/tmp`.

## How it's built

- `src/server/server.ts`: one `node:http` server with no dependencies. It serves `web/` and the room API (create, join, add bot, start, do a command, plus text `view`/`wait`/`status` for the CLI) and pushes a fresh snapshot to every TV and phone over server-sent events whenever anything changes. The browser code is TypeScript; the server strips its types as it serves it (Node's `stripTypeScriptTypes`), so there's no build step here either.
- `src/server/room.ts`: a room's game, its seats (each player, phone or CLI, holds a secret token for its seat), the bots, and the flee clock. Every decision goes through the engine's `apply`, as in the CLI's file mode.
- `src/state.ts`: the JSON each client gets. Every log line carries its event as data (`GameEvent` in `src/engine.ts`) next to the CLI's text; the clients draw the event and never print the text. The TV's part holds only public state; a phone's part adds that one player's resources, hand and private events. Nothing else about other players is ever sent to a phone.
- `web/`: `tv.ts`, `phone.ts`, the shared `common.ts` (map, connection), `icons.ts` (the game's one icon set, folded-paper style: resources, points, cards, elements), `art.ts` (the card pictures: folded-paper subjects on layered cut paper, inline SVG, nothing to download) and `style.css`. `npm run typecheck` checks them too.
