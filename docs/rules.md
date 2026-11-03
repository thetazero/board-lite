# board-lite rules (as the engine plays them)

You are a wizard who raises dragons. Build out from your tower, hatch and feed dragons, raid neutral kingdoms for gold, and be first to **15 points**. All numbers live in `src/data.ts` and are first guesses awaiting playtests.

**Hidden** (your phone): your resources and your hand. **Public** (the TV): the map, buildings, dragons, titles, hand sizes, trade offers.

**Setup.** The land is random and ringed by ocean, with one natural harbor on each coast. Each player has a tower (fixed spot by player count), 3 stone, timber, crystal and livestock, and a random base hatchling. The first player moves one seat left each round.

## A round: four phases

1. **Production** (in turn order). Your tower gives 1 stone, timber, crystal and livestock. Each basic production building rolls its own die (a quarry: d6 stone; a Workshop adds 2). Building cards make what their text says, without dice. Then every dragon eats 1 livestock and heals fully. A dragon that went hungry, or was hurt in the last raid, **sits out** this round: it doesn't grow and can't raid. The rest grow one step (plus one per hatchery you own). A dragon moves up a life stage (egg → hatchling → young → adult) when its steps reach its card's growth time.
2. **Cards** (all at once). Draw 1 action card and 2 building cards; keep one of the building cards and discard the other. Building cards hold buildings and upgrades; action cards hold actions and dragon eggs.
3. **Actions** (one player at a time). On your turn, in any order and as often as you can pay:
   - **Build** on an empty land hex touching one of your buildings: a basic building, no card needed (quarry on mountain, lumber camp on forest, crystal mine on ley line, pasture on meadow, or a roost anywhere), or a building card from your hand (a port needs a harbor; tower floors stack on your tower).
   - **Upgrade**: put an upgrade card on one of your buildings of its class. One upgrade per building.
   - **Play** an action card, or hatch a dragon card as an egg (needs a free roost space).
   - **Special project** (no card): hatch a base egg of any element, for double the base dragon card's cost.
   - **Bank**: trade 4 of one resource for 1 of any other (3:1 with a port).
   - **Trade** with other players: resources and cards. Anyone may offer to the acting player and the acting player may offer to anyone. Accepted trades are binding. Open offers expire when the turn ends.
4. **Raid** (all at once). Repeat once per War Horn played this round.
   - **Vote**: three random kingdoms are shown; everyone secretly votes; ties are a coin flip.
   - **Commit**: everyone publicly commits raid-ready dragons (hatched, unhurt, not sitting out) and can change their mind until they say ready. When everyone is ready, commitments lock.
   - **Fight or bail**: each committed player secretly chooses. Bailing costs nothing, but you get no loot. This is your only way out: once the fight starts there is no retreat, and any dragon that takes a hit sits out next round. The more dragons fight, the faster the defenders fall and the fewer hits each takes.
   - **Combat**, in rounds: each fighting dragon hits as many defenders as its targets number, rolling its dice against each, picking defenders by its card's targeting rule. Damage is doubled against a defender weak to the dragon's element and halved (at least 1) against one strong against it. Then each defender hits random dragons. A dragon at 0 health is knocked out and goes home. Rounds repeat until every defender or every dragon has fallen.
   - **Loot**: if every defender falls, the players with dragons still fighting split the loot evenly (rounded down).

**End of round.** Anyone over 7 cards discards down to 7. If anyone has 15 or more points, the highest total wins (ties: most gold, then earliest in this round's turn order).

**Table talk.** Anyone may talk at any time, to everyone or privately to one player. Promises bind no one; only accepted trades do.

**Neighbours.** Every building has a class (quarry, lumber camp, mine, pasture, dragon building, monument or trade building); the tower is a monument and a dragon building. Many building cards count their six neighbouring hexes, either hexes of a terrain (built on or not) or buildings of a class, whoever owns them. The count is always the current one: a neighbour built later counts too.

## Points

- Dragons: hatchling 1, young 2, adult 4. Eggs 0.
- Tower floor 1; other monuments as their card says (most count their neighbours); Gilding +2.
- Secret Hoard cards: 1 each while in hand (hidden until the end).
- Titles, 2 each: Strongest Dragon Army (most dragon points, at least 8), Tallest Tower (most floors, at least 3), Largest Territory (most buildings, at least 9). The holder keeps a title on a tie.

## Cards

Basic buildings (no card): quarry, lumber camp, crystal mine, pasture, roost. Building cards and upgrades are listed with their text and cost in a player's view, in `src/data.ts`, and with what they're worth in `docs/datasheet.md`: 19 buildings across the seven classes, most of which count their neighbours, and 4 upgrades (Workshop, Gilding, Nesting Grounds, Trade Charter). Action cards: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn, Secret Hoard, and 15 dragons (a base whelp and two special dragons per element).
