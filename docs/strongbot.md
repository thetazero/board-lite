# The strong bot

`strongbot` is a seat played by code, no model (`src/strongbot.ts`, #482): a free baseline for playtests and contests, as strong as it gets without much compute. The random bot (`bot`, `src/bot.ts`) stays as it is, for tests and as the floor.

```
node src/playtest/run.ts --models strongbot,opus,haiku
node src/playtest/batch.ts --games 30 --models strongbot,opus+expected,opus
node src/playtest/eval.ts --models haiku,opus,strongbot,bot --seats 2-6 --games 40
```

It takes no options, and isn't a Claude seat: it doesn't count against the seat pool and costs nothing. The server plays it in the room, as it does the random bot. Claude players are told it's a bot played by code that plays to win and talks.

## How it plays

- **Its turn:** it looks one step ahead. It tries every purchase it could make on a copy of the game: a building on each hex it may go on, an upgrade, a special project, a card, and a dragon together with the roost or floor that houses it. Each comes with the merchants trades that pay for it. It scores each result with `worth`, a guess in points at what the position will bring before the end: points now, production over the rounds it guesses are left, resources held (fewer and fewer points for a big pile), dragons (power raid-ready over those rounds, less their food), room to build, and how near it is to each title. It makes the best purchase that raises that, and ends its turn when none does.
- **Fights:** it estimates each fight by rolling it about 60 times with its own dice, never the game's. It clears its own suppressed buildings, beasts beside its land and the great beasts when the odds and the gain are good enough. In a raid it votes for the kingdom worth most to it, given the votes so far, and fights, holds back, or sends only its grown dragons, whichever pays best if each other player fights 60% of the time.
- **Cards:** it keeps the building card worth most where it could build it, plays Buried Treasure, Windfall, Growth Elixir and Healing Potion when they raise `worth`, a War Horn when another raid pays it, and Rouse the Bear or Wake the Basilisk on the leading rival's most valuable building. It discards its least valuable cards.
- **Trades:** short of 1 or 2 of something, it first asks the table at 2 for 1 before the merchants' 4 for 1, and waits up to 45 seconds for answers. It accepts an offer that makes its best move this turn better, never one from a rival close to winning or well ahead.
- **Talk:** it says which kingdom it votes for and asks others to fight with it, asks for what it's short of with its offer, warns the table when a rival is near winning, and answers anyone who talks to it, at most 3 lines a round.
- **Fair:** it sees only what its seat sees: the board, everyone's gold and hand size, its own hand and resources. Other hands, resources and secret raid choices stay hidden from it.

## Measuring and tuning it

`src/botbench.ts` plays bot-only games in-process, free, seats rotated each game:

```
node src/botbench.ts --games 30 --seats strong,bot,bot
node src/botbench.ts --games 30 --seats strong:KAPPA=0.1/SLOT=1,strong,strong
```

A seat like `strong:KAPPA=0.1` is a variant with its own numbers (`TUNE` in `src/strongbot.ts`), so variants can be played against each other.
