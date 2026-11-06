# Playing on a TV and phones

The board runs in a browser on the TV; each player joins from their phone's browser. One machine runs the server; the TV and phones only need a browser on the same network. Phones, the TV, the command line, Claude players and bots can all sit at one table. To play against Claude, see [`play-vs-claude.md`](play-vs-claude.md).

## Run it

Needs Node 22.18 or newer.

```
npm install
npm run serve                  # or: node src/server/server.ts --port 8080
```

It prints the addresses to use:

```
board-lite is running on port 8080.
  TV:     http://localhost:8080/tv   (or http://192.168.1.20:8080/tv)
  Phones: http://192.168.1.20:8080/
  Phones over Tailscale: http://100.101.102.103:8080/
```

1. **TV:** open the TV address full screen (F11). It shows the room's QR code, address and 4-letter code. The server's terminal prints the commands that seat a CLI or Claude player in each new room.
2. **Phones:** scan the QR code (or type the address), type a name, tap **Join**. The name is remembered.
3. **Start:** with 2 to 6 players, press **Start game** on the TV or the first player's phone. **Add a bot** fills a seat with the test bot; the same two remove anyone with **×**. A second TV opened on the room's address shows the room but has no buttons, unless no other TV is watching: then it becomes the TV.

**Phones can't connect?** They must be on the same Wi-Fi as the server, or the same tailnet using its Tailscale address, and the firewall must allow the port (ufw: `sudo ufw allow 8080/tcp`, or `sudo ufw allow in on tailscale0`). Some guest Wi-Fi blocks devices from reaching each other.

**Reconnecting:** a phone that reloads, sleeps or drops off the Wi-Fi gets its seat back when the page is open again. A page whose connection goes quiet (no word from the server for 40 seconds, though it pings every 15) connects again by itself, so it never sits on an old moment of the game until someone reloads it. On another phone, open the room's address and tap your name.

**Nobody stalls the table:**

- **Element wheel:** the ring of colored dots by your points on the phone opens the rulebook at **Elements**: which element beats which.
- **Rules:** **Rules** at the top of the phone opens a small rulebook over whatever screen you are on: every hex, border, building, beast, dragon, element, kingdom and action card, each building, beast and dragon drawn as the TV draws it. **Close** goes back to where you were. The TV carries no labels for these; the rulebook is where you look them up.
- **Quit:** **⋯** next to your name → **Quit game**. A bot plays your seat; tap your name at the room's address to come back.
- **Away:** when the table waits on someone whose phone is gone, the others get **Let a bot play** after a minute. The seat goes back to them when their phone returns.

The stand-in bot (`standInMove` in `src/bot.ts`) only makes the moves needed for the game to go on.

**Restarts:** the server saves each game to `~/.cache/board-lite/rooms/<code>.json` after every change. After a restart, `npm run serve` hosts every room from the last 6 hours again, and everyone reconnects to their own seat. `npm run serve -- --game <file>` hosts one saved game. A saved game with no seats file has every seat open: the TV and phones show the lobby, and the game goes on once every seat is taken by a player or a bot.

## After the game

When the game ends in front of the TV, it plays a short summary (about half a minute): the points race drawn a round at a time, with the titles taken, great beasts slain and kingdoms that fell, then where everyone's points came from. **Skip** jumps to the final scores. They come with a QR code to the game's **recap page** (`/recap/<id>`), the same story to keep or share on a phone; **Watch again** plays the summary again.

The recap is one file, `~/.cache/board-lite/recaps/<id>.json` (built by `src/recap.ts` when the game ends), so its link still opens after the table starts a new game and the old room is gone. The page (`web/recap.html`) draws everything from that file: to put recaps on a website later, host the page and the files, and point the TV's QR code there.

## Playing with no TV

On the join form (the server's bare address), type your name and tap **New game** under "No TV". Your phone makes the room and shows its QR code for the others, and the address to open on a TV if one turns up later. One phone and a few bots is a whole game.

Each phone has a **You / Table** switch by the talk bar: Table shows what the TV would, as a flat map. Scenes (production rolls, fights) cut to the table on their own and back when they end; while one plays, You is off, since there is nothing to do there yet.

The switch is on the phone in a game with a TV too, so a player away from the TV can still see the table. There the table loads the first time you tap **Table**, scenes cut to it only from then on, and You stays on.

**Switching between a TV and no TV:** whether the table has a TV isn't fixed when the room is made. Open the TV on the room (`/tv?room=<code>`) at any time, in the lobby or mid-game, and it's the table's TV from then on: the phones say to watch it, and scenes play there. If no other TV is watching, it also gets the TV's buttons (**Start game**, **Add a bot**). Close it, and 20 seconds later (time for a TV to reload) the table goes on with no TV: each phone shows the table itself, as above. No one changes seats, and the game goes on where it was.

When the game ends, the table plays the same summary as the TV, as a scene the phone cuts to, and ends on the final scores with **Watch again** and **Open the recap** (the recap page) in place of the QR code. Every phone's own end screen has **Open the recap** too, with a TV or without.

## Playing from the command line

```
node src/cli.ts join http://192.168.1.20:8080/ABCD Claude    # prints your seat and token
node src/cli.ts view http://192.168.1.20:8080/ABCD <token>
node src/cli.ts do   http://192.168.1.20:8080/ABCD <token> build c12 2,-1
node src/cli.ts wait http://192.168.1.20:8080/ABCD <token>
```

Everything else is in [`cli.md`](cli.md).

## Trying it without a group

```
node src/server/demo.ts --players 3 --round 3
```

starts a game already in round 3, bots in every seat but the first, and prints a TV link and a phone link. `--all-bots` lets bots play every seat; `--seed N` picks the game.

## Staged screenshots (for look tuning)

```
npm run shots -- --only phone-hand           # shots whose name contains "phone-hand"
npm run shots -- --only raid-fight,tv-vote   # several, comma-separated
npm run shots -- --list [--only raid]        # list shots and sizes; takes none
npm run shots -- --only phone-hand --every-size   # those shots at every screen size
npm run shots -- --all                       # every shot: a few hundred images, several minutes
npm run shots -- --out NAME                  # its own folder: ~/.cache/board-lite/staged-shots/NAME/
```

**Shoot only the screens your change touched.** Find them with `--list` or in `src/shots/scenes.ts`, and shoot those with `--only`. Add `--every-size` when the change is to layout or sizing. Keep `--all` for a full audit or a change that reaches every screen.

**Before/after:** run the same `--only` on the old code, then the new, in the same checkout (or with the same `--out`). The earlier run moves to `<folder>.previous`, and changed files are starred in the output and outlined in the folder's `index.html` contact sheet.

- **Output:** `~/.cache/board-lite/staged-shots/<checkout>-<hash>/`, as WebP. Never `/tmp`; open shots where they are. Old folders are cleared away on their own.
- **One run at a time** on the machine (each takes a gigabyte or two). A second run waits for the first.
- **Sizes:** TV 1920×1080, phone 390×844. Some shots also come at TV 1280×720 and phone 360×800, 320×568, landscape and tablet.
- **A phone shot is one screen.** A longer page is shot a screen at a time, scrolling down (`name.webp`, `name.2.webp`, …).
- **The hand never covers the page.** The run lists any phone screen where the hand of cards sits over text or buttons; there should be none.
- **Same code, same images:** games are seeded and the clock is frozen. `npm test` checks every scene still stages.
- **Adding a scene:** add an entry in `src/shots/scenes.ts`.
