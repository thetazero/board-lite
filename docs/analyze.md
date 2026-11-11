# Post-game analysis

One finished game, analyzed from its own log: what happened and how it went, counted exactly (no model involved). Works on a room people played in, a saved game file, or one playtest game.

```
npm run analyze                         # the room played in most recently
npm run analyze -- NKSQ                 # a room, by its code (in ~/.cache/board-lite/rooms)
npm run analyze -- path/to/game.json    # a game file
npm run analyze -- path/to/batch/g3     # a playtest game: its game.json and results.json
```

It prints Markdown (the file it read goes to stderr). Seats are named from the room's seats file, with the models of any Claude players from their runners' `results.json`; a playtest game's from its `results.json`. A game still going is analyzed up to now, and says so.

What it shows, per seat:

- **Points** at the end of each round, by source (buildings, titles, great beasts; Secret Hoards only at the end), and the final score.
- **Titles**: who took each and when, and how many rounds each seat held it.
- **What each seat did**: built, upgraded, played and hatched; special projects; raids (targets, who joined, loot, raid gold, who held back); fauna and great beasts fought and cleared; trade offers, trades and declines; merchant trades; talk.
- **Trade surplus**: the basic resources each seat came out with from its trades with other players. Each basic resource (stone, timber, crystal, livestock) counts 1; gold and cards count 0; merchant trades are left out. Two columns: all trades with players, and the same leaving out every trade with gold on either side. The number of trades is in brackets. Across the table the surplus adds up to 0 in the first column.
- **Production**: the basic resources each seat made each round, and in all (gold not counted).

The counting is `gameStats()` in `src/playtest/stats.ts`, the same that makes a playtest batch's stats ([`playtest.md`](playtest.md#stats)), so a batch's per-game section shows all of this too. Points are rebuilt from the log and scored with the engine's own `score()`, then checked against the saved game; a mismatch is printed, never hidden. A game from much older rules may not read at all: the error names the commit to run it from (`git worktree add --detach <dir> <commit>`).
