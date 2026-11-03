# board-lite rules (as the engine plays them)

You are a wizard who raises dragons. Build out from your tower, hatch and feed dragons, raid neutral kingdoms for gold, and be first to **15 points**. All numbers live in `src/data.ts` and are first guesses awaiting playtests.

**Hidden** (your phone): your resources and your hand. **Public** (the TV): the map, buildings, dragons, titles, hand sizes, trade offers.

**Setup.** The land is random and ringed by ocean, with one natural harbor on each coast. Each player has a tower (fixed spot by player count), 3 stone, timber, crystal and livestock, and a random base hatchling. The first player moves one seat left each round.

## A round: four phases

1. **Production** (in turn order). Your tower gives 1 stone, timber, crystal and livestock. Each production building rolls its own die (a quarry: d6 stone; a Workshop adds 1). Then every dragon eats 1 livestock and heals fully. A dragon that went hungry, or was hurt in the last raid, **sits out** this round: it doesn't grow and can't raid. The rest grow one step (plus one per hatchery you own). A dragon moves up a life stage (egg → hatchling → young → adult) when its steps reach its card's growth time.
2. **Cards** (all at once). Draw 2 building cards and 1 action card. Building cards hold buildings and upgrades; action cards hold actions and dragon eggs.
3. **Actions** (one player at a time). On your turn, in any order and as often as you can pay:
   - **Build** a building card on an empty land hex touching one of your buildings (production buildings need their terrain, ports a harbor; tower floors stack on your tower).
   - **Upgrade**: put an upgrade card on one of your buildings of its class. One upgrade per building; your tower counts as a points and a dragon building.
   - **Play** an action card, or hatch a dragon card as an egg (needs a free roost space).
   - **Special project** (no card): build a quarry, lumber camp, crystal mine, pasture or roost, or hatch a base egg of any element, for double the card's cost.
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

## Points

- Dragons: hatchling 1, young 2, adult 4. Eggs 0.
- Tower floor 1, monument 2, Gilding +1.
- Secret Hoard cards: 1 each while in hand (hidden until the end).
- Titles, 2 each: Strongest Dragon Army (most dragon points, at least 8), Tallest Tower (most floors, at least 3), Largest Territory (most buildings, at least 7). The holder keeps a title on a tie.

## Cards

Building cards and upgrades are listed with their text and cost in a player's view and in `src/data.ts`: 9 buildings (quarry, lumber camp, crystal mine, pasture, roost, hatchery, port, tower floor, monument) and 4 upgrades (Workshop, Gilding, Nesting Grounds, Trade Charter). Action cards: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn, Secret Hoard, and 15 dragons (a base whelp and two special dragons per element).
