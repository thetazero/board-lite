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

1. **TV:** open the TV address in a browser on the TV (or on a laptop plugged into it), full screen (F11). It makes a room and shows its 4-letter code and the address phones should open. Each seat appears as a place card with its tower, and the towers stand in the picture at the top in the players' colours. The server's terminal prints, for each new room, the commands that seat a CLI player or Claude players at it (the TV doesn't show them).
2. **Phones:** open the room's address the TV shows (`http://<that machine's address>:8080/ABCD`), type a name, and join. (The bare address works too; then type the code.) Each player gets a colour.
3. **Start:** with 2 to 6 players in, press **Start game** on the TV or on the first player's phone. **Add a bot** fills an empty seat with the random test bot (handy for trying it alone); bots get clockwork names (Tick, Gizmo, ...) so they never share a name with a person. On the TV, a seat's × (shown on hover) removes it before the start.

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

- **TV** (everything public): the board in 3D, in folded paper: each hex a creased sheet of coloured paper in an origami tray, seen from a little off straight down, every building a folded paper model on its owner's coloured plate (it pops up off the page when it's built; an upgrade adds a gold rim and pennant), and every dragon in origami at home on its owner's tower, roost or hatchery, flying a lap round its home now and then (eggs sit in nests; hungry or hurt dragons lie down and stay in). The board is the TV: it fills the screen's height, centred, and everything else stands in the columns either side of it and in its corners. A card per player, the first half of the table on the left and the rest on the right, sized to be read from the couch (as large as the player count allows, stepping down only to fit): their points, cards in hand, what they're doing when the table waits on them (their turn, answering a trade, discarding, voting…), the titles they hold, and their dragons by name (a second of the same kind is "II") with life stage, growth, and health or why they're sitting out the round (hungry, or healing after a fight). No resources and no income: those are each player's own, on their phone. Open trade offers sit over the top edge of the board, on its tray. In the bottom-left corner, the last few events and table talk in one feed, the events drawn as icon rows rather than sentences (who, then what they built, hatched, traded or played); in the bottom-right, the titles (everyone's count, the holder's ringed, and the count it takes to hold one). Each round opens with its number and each player's production roll in turn, one player at a time, their dice tumbling and landing for the whole table to see (only the dice: not what they bring in). The raid takes over the screen, drawn rather than written: each kingdom's defenders as a picture per kind ("×4") with their health, attack and the elements they take double or half from; then an arena, the raiders on the left (each player's dragons that could go, the ones sent lit, a roost for anyone staying home, a tick once they're ready) and the kingdom on the right, through commitments and fight-or-bail (who has chosen, not what); then the fight replayed blow by blow, a stroke from each attacker to what it hits, health bars falling as the hits land, whoever bailed shown flying home, and who won and what they took. When a War Horn adds raids, a dim mark for each one still to come sits by the raid's title. At the end the winner gets their moment (their tower and dragons under paper confetti) above the final standings: place, points (with any that were secret cards), ties marked, and how the winner won a tie if they did. The phone shows the same in place of the game: no resources or income left over.
- **Phone** (only yours): your resources, each with what a round brings in under it (production minus what your dragons eat, e.g. `+2 +3d6`), your points including secret ones, your roost (your dragons, their growth, health and whether they're hungry or hurt, and an empty nest for each dragon you have room for), your hand (illustrated paper cards held in a fan along the bottom edge; on your turn the ones you can play now glow; tap one to see it full size with its rules and play it, or leaf through the hand from there; new cards fly in as you draw them; to discard, tap cards in the fan), and whatever you're being asked right now. At the start of each round: keep one of the two building cards you drew. On your turn: play cards (pick the hex on a small copy of the map; for a building that counts its neighbours, each hex shows its count), basic buildings with no card, the egg special project, the bank, trades and **End turn**. Out of turn: offer the acting player a trade, and accept or decline offers made to you. In the raid, with your roost and hand still on screen (the hand gives way on a short screen) and the kingdom you'd fight drawn above your choice: vote, commit dragons and lock in, fight or bail in secret (seeing who else is going, and with what).

- **Table talk**: people in the room just talk, but players who aren't (Claude, or someone at a terminal) only hear what goes through the game. The bar at the bottom of the phone shows the latest message; tap it to read the conversation and to talk to everyone or privately to one player. The TV shows public talk in its feed of events, as it happens. CLI players use `say` and `tell`.

## Trying it without a group

```
node src/server/demo.ts --players 3 --round 3
```

starts a server with a game already in round 3, played by bots except for the first seat, and prints a TV link and a phone link for that seat (open the phone link in a narrow browser window). `--all-bots` lets bots play every seat; `--seed N` picks the game.

## Staged screenshots (for look tuning)

```
npm run shots                    # every scene, under a minute and a half
npm run shots -- --only raid     # scenes whose name contains "raid"
npm run shots -- --every-size    # every shot at every screen size, for a full audit
npm run shots -- --out DIR       # somewhere else
```

writes screenshots of the TV and phones in staged situations to `~/.cache/board-lite/staged-shots/latest/`, with an `index.html` contact sheet. The run before moves to `latest.previous`; files that differ from it are starred in the output and outlined in the sheet, so a visual change shows exactly which screens it touched.

- **Screens:** the TV at 1920×1080, the phone at 390×844 (2×). Shots marked `sizes` are also taken at the other sizes: the TV at 1280×720 (`@720p`), the phone at 360×800 (`@360`), 320×568 (`@320`), sideways at 844×390 (`@landscape`) and on a tablet at 820×1180 (`@tablet`). `--every-size` does that for every shot.
- **A phone shot is what the phone's screen shows.** A page longer than the screen is shot one screen at a time, scrolling down (`name.png`, `name.2.png`, ... up to 4), so the hand, the talk bar and an open card sit where they sit on a real phone. Don't shoot the whole page at once: Chrome stretches the screen to the page's height for that, and everything sized against the screen grows with it.
- **The scenes** (`src/shots/scenes.ts`): each is a seeded bot game played until a condition holds, plus a few scripted commands (bots don't offer trades or talk), or a lobby. A shot can also open the page as a device that remembers a name, type into the join form, open the TV without its host token, drop the connection, stop the page before its script loads, or have something happen at the table after the page is up (`then`). Add a scene by adding an entry there. What they cover:
  - **Joining and leaving:** the TV lobby empty, with one player (Start disabled), with three, and full (six, long names, bots, someone away, a Tailscale address); the phone lobby as the first player (alone, and with others) and as anyone else; the join form from the room's address, without a code, and remembering a name; every join error (no such room, name taken, blank name, full, started and full); removed from the lobby, Leave, and Join another game; a saved game hosted again (open seats) and a phone taking a seat in it.
  - **Connecting:** both clients before their script loads, and with the connection dropped ("Reconnecting…"); an error toast on each (a second TV screen tapping Start, accepting an offer the offerer can no longer pay).
  - **The turn:** the opening round card, each player's production roll coming up in turn and all of them landed, early and late boards for 2 to 6 players, the 3D board frame by frame (a building popping up, a dragon's flight) and a port on the coast, six players with long names, bots and someone away; the phone on its turn and off it, with an empty hand, a hand of every card, a hand of playable cards (Secret Hoard kept, Growth Elixir and Healing Potion choosing a dragon, Monument, an upgrade), every reason a card can't be played, a card you can't afford, a card tapped out of turn; choosing a hex to build a card, a basic building and an upgrade; the bank with picks made; trade offers in, out (on your turn and someone else's), being composed, and the trade tab out of turn.
  - **Discarding:** the TV, one card picked, several picked, and waiting for others.
  - **The raid:** two raids in one round, the vote (voting and voted), commit (one tapped, nothing yet, locked in, no dragon able to raid), fight or bail (choosing, chosen, not in it), the fight's replay (mid-way and at its end, and one a raider bailed out of) and a win, a loss, everyone bailing, nobody committing, and the next round's production banner right after a raid's.
  - **Table talk:** the TV's talk panel, the phone's talk bar with unread messages, and the talk sheet open with a private message.
  - **The end:** final scores for 4 and 6 players, the winner's and everyone else's phone.
  - **Not shot:** "You are not in this game." (the phone shows it if its seat stops being a player's mid-game, which nothing in the server does) and the browser's own bubble for an empty name (the form's `required`; a name of only spaces reaches the server's "Pick a name.").
- **The same every run:** the games are seeded, the pages' clock is frozen, CSS animations are off, bots never move, and the TV shows a fixed address, so the same code gives byte-identical images. A change to the rules or the numbers can move a scene to a different moment (or the next seed, if its condition stops holding); `npm test` checks every scene still stages.
- **How:** the real server and clients, with each scene hosted as a room whose seats nobody plays, so nothing moves on its own; one headless Chrome (about 1 GB) driven over the DevTools protocol, no extra dependencies. The 3D board renders on the CPU (SwiftShader). Its clock (`window.boardClock`) starts frozen at 0; a shot with `frames` takes one picture per board-clock time, which is how `tv-build-3p-*` shows a building popping up and `tv-flight-2p-*` a dragon's flight. It finds Chrome at the usual paths, or set `CHROME=/path/to/chrome`. Its profile and the output stay under `~/.cache/board-lite/`, never `/tmp`.

## How it's built

- `src/server/server.ts`: one `node:http` server. It serves `web/`, three.js for the TV's 3D board (from `node_modules`, at `/vendor/three/`), and the room API (create, join, add bot, start, do a command, plus text `view`/`wait`/`status` for the CLI) and pushes a fresh snapshot to every TV and phone over server-sent events whenever anything changes. The browser code is TypeScript; the server strips its types as it serves it (Node's `stripTypeScriptTypes`), so there's no build step here either.
- `src/server/room.ts`: a room's game, its seats (each player, phone or CLI, holds a secret token for its seat), and the bots. Every decision goes through the engine's `apply`, as in the CLI's file mode.
- `src/state.ts`: the JSON each client gets. Every log line carries its event as data (`GameEvent` in `src/engine.ts`) next to the CLI's text; the clients draw the event and never print the text. The TV's part holds only public state; a phone's part adds that one player's resources, hand and private events. Nothing else about other players is ever sent to a phone.
- `web/`: `tv.ts`, `phone.ts`, the TV's 3D board `board3d.ts` (three.js; the TV falls back to the flat map without WebGL), the shared `common.ts` (the phone's flat map, connection, the final standings), `icons.ts` (the game's one icon set, folded-paper style: resources, points, cards, elements), `art.ts` (the card pictures, and the lobby's and game over's scenes: folded-paper subjects on layered cut paper, inline SVG, nothing to download) and `style.css`. `npm run typecheck` checks them too.
