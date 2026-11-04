# board-lite rules (as the engine plays them)

You are a wizard who raises dragons. Build out from your tower, hatch and feed dragons, raid neutral kingdoms for gold, and be first to **20 points**. All numbers live in `src/data.ts` and are first guesses awaiting playtests.

**Hidden** (your phone): your hand, and your resources other than gold. **Public** (the TV): the map, buildings, dragons, titles, everyone's gold, hand sizes, trade offers.

**Setup.** The land is random and ringed by ocean, with one natural harbor on each coast. Wild **fauna** holds some hexes: wolves 2 steps from the nearest tower, bears 3, a basilisk further out. Two **great beasts**: the Thunderbird on the mountain peak at the centre, and the Leviathan in the ocean beside one harbor. Each player has a tower (fixed spot by player count), 3 stone, timber, crystal and livestock, and a random base dragon egg. The first player moves 1 seat left each round.

## A round: four phases

1. **Production** (in turn order). Your tower gives 1 stone, timber, crystal and livestock. Each basic production building rolls its own die (a quarry makes 1d4 stone; a Workshop adds 2). Building cards make what their text says, without dice. Then each beast that isn't a great beast has a 1 in 3 chance to move to a random adjacent land hex with no tower or beast. Then every dragon eats 1 livestock, heals 7 health and grows 1 step (plus 1 per hatchery you own); a dragon that goes hungry doesn't grow. A dragon that goes hungry, or is still hurt when production begins, **sits out** this round's raids: a dragon sits out 1 round of raids for every 7 damage it took, rounded up. A dragon moves up a life stage (egg → hatchling → young → adult) when its steps reach its card's growth time.
2. **Cards** (all at once). Draw 1 action card and 2 building cards; keep 1 of the building cards and discard the other. Building cards hold buildings and upgrades; action cards hold actions and dragon eggs.
3. **Actions** (one player at a time). On your turn, in any order and as often as you can pay:
   - **Build** on an empty land hex (no building, no beast) adjacent to one of your buildings: a basic building, no card needed (quarry on mountain, lumber camp on forest, crystal mine on crystal field, pasture on meadow, or a roost anywhere), or a building card from your hand (a port needs a harbor). Or add a **tower floor** on your tower, no card needed.
   - **Upgrade**: put an upgrade card on one of your buildings of its class. Each building takes 1 upgrade.
   - **Play** an action card, or hatch a dragon card as an egg (needs a free roost space).
   - **Clear fauna**: send any of your raid-ready dragons against the beast on any hex. It's a raid's combat (below), fought to the end. Those dragons sit out this round's raids. If the beast falls, the hex is free and its loot is yours (a beast a card placed has none); if not, it stays, at full health. A great beast takes one try per player a round.
   - **Special project** (no card): hatch a base egg of any element, for double the base dragon card's cost.
   - **Bank**: trade 4 of one resource for 1 of any other (3:1 with a port).
   - **Trade** with other players: resources and cards. Anyone may offer to the acting player and the acting player may offer to anyone. Accepted trades are binding. The acting player answers every offer made to them before ending their turn; their own open offers expire when it ends.
4. **Raid** (all at once). Repeat once per War Horn played this round. If nobody has a raid-ready dragon, there is no raid.
   - **Combat power** is a rough guide printed on every dragon and kingdom: √(health × average damage a combat round), a kingdom's being its defenders' added up. Raiders whose powers add up past a kingdom's usually win, but it ignores elements and targeting, so it can mislead.
   - **Vote**: everyone secretly votes for one of the kingdoms; ties are a coin flip. Easy kingdoms give almost nothing; hard ones a lot.
   - **Commit**: everyone publicly sends raid-ready dragons (hatched, unhurt, not sitting out) and can change their mind until they say ready. When everyone is ready, commitments lock.
   - **Fight or bail**: each committed player secretly chooses. Bailing costs nothing, but you get no loot. This is your only way out: once the fight starts there is no retreat, and a dragon that takes a hit sits out raids while it heals. The more dragons fight, the faster the defenders fall and the fewer hits each takes.
   - **Combat**, in rounds: each fighting dragon hits as many defenders as its targets number, rolling its dice against each, picking defenders by its card's targeting rule. Damage is doubled against a defender weak to the dragon's element and halved (at least 1) against one strong against it. Then each defender hits random dragons. A dragon at 0 health is knocked out and goes home. Rounds repeat until every defender or every dragon has fallen.
   - **Loot**: if every defender falls, the players with dragons still fighting split the loot by the combat power each still has fighting (rounded down; what's left over goes to the player with the most). After every raid, each kingdom that didn't fall adds 1 gold to its loot, and the one that fell goes back to its printed loot.

**End of round.** Anyone over 7 cards discards down to 7. If anyone has 20 or more points, the highest total wins (ties: most gold, then earliest in this round's turn order).

**Table talk.** Anyone may talk at any time, to everyone or privately to one player. Promises bind no one; only accepted trades do.

**Fauna.** Nothing is built on a hex with a beast, and a building under a beast makes nothing until the beast is cleared. Anyone may clear any beast. New beasts come only from cards (Wolf Call places a Cave Bear, Rouse the Bear a Basilisk) on any land hex with no tower or beast: next to someone, or on their building. A beast a card placed gives no loot.

**Great beasts.** Each holds its hex and every hex adjacent to it: nothing is built there while it lives. Whoever slays one scores **2 points** for good, and it never comes back: a race. The Thunderbird is weak to ice and shrugs off lightning, air and water; the Leviathan is weak to lightning and shrugs off water, fire and ice. Once the Thunderbird falls, each production building on or adjacent to its peak makes 2 more each round.

**Adjacent hexes.** Every building has a class (stone building, timber building, crystal building, livestock building, dragon building, monument or trade building; each basic building that makes a resource is in that resource's class, with the building cards that make the same); the tower is a monument and a dragon building. Many building cards count their 6 adjacent hexes, either hexes of a terrain, built on or not ("each adjacent meadow hex"), or buildings of a class, whoever owns them ("each adjacent livestock building"). The count is always the current one: an adjacent building built later counts too.

## Points

- Dragons: hatchling 1, young 2, adult 3. Eggs 0.
- Monument cards (Monument, Standing Stones, Lighthouse, Guildhall): as their card says, 1 point for each adjacent hex or building it counts. No other building is worth points: not production buildings, not the tower, not its floors.
- Secret Hoard cards: 1 each while in hand (hidden until the end).
- Great beasts: 2 each to whoever slays it, for good.
- Titles, 2 each: Strongest Dragon Army (most dragon points, at least 10), Tallest Tower (most floors, at least 4) and Largest Hoard (most gold, at least 10). Tower floors (6 stone and 4 gold, no card) count only toward Tallest Tower. The holder keeps a title on a tie.

## Cards

Basic buildings (no card): quarry, lumber camp, crystal mine, pasture, roost, tower floor. Building cards and upgrades are listed with their text and cost in a player's view, in `src/data.ts`, and with what they're worth in `docs/datasheet.md`: 18 buildings across the 7 classes, most of which count what's adjacent, and 3 upgrades (Workshop, Nesting Grounds, Trade Charter). Action cards: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn, Secret Hoard, Wolf Call, Rouse the Bear, and 15 dragons (a base dragon named for its element, like the Fire Dragon, and 2 special dragons per element).
