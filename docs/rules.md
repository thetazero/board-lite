# board-lite rules (as the engine plays them)

You are a wizard who raises dragons. Build out from your tower, hatch and feed dragons, raid neutral kingdoms for gold, and be first to **15 points**. All numbers live in `src/data.ts` and are first guesses awaiting playtests.

**Hidden** (your phone): your resources and your hand. **Public** (the TV): the map, buildings, dragons, titles, hand sizes, trade offers.

**Setup.** Each player has a tower (fixed spot by player count; the six hexes around it always hold one of each terrain), 2 stone, timber, crystal and livestock, and a random base hatchling. The first player moves one seat left each round.

## A round: four phases

1. **Production** (in turn order). Your tower gives 1 stone, timber, crystal and livestock. Each production building gives its base amount plus its own die (e.g. a quarry: 1 + d3 stone). Then hurt dragons heal 8 health, and every dragon eats 1 livestock: a fed dragon grows one step (plus one per hatchery you own); a hungry one doesn't grow and can't raid this round. A dragon moves up a life stage (egg → hatchling → young → adult) when its steps reach its card's growth time.
2. **Cards** (all at once). Draw 2 building cards and 1 action card. Building cards hold buildings and upgrades; action cards hold actions and dragon eggs.
3. **Actions** (one player at a time). On your turn, in any order and as often as you can pay:
   - **Build** a building card on an empty hex touching one of your buildings (production buildings need their terrain; tower floors stack on your tower). One building per hex.
   - **Upgrade**: put an upgrade card on one of your buildings of its class. One upgrade per building; your tower counts as a points and a dragon building.
   - **Play** an action card, or hatch a dragon card as an egg (needs a free roost space).
   - **Special project** (no card): build a quarry, lumber camp, crystal mine, pasture or roost, or hatch a base egg of any element, for double the card's cost.
   - **Bank**: trade 4 of one resource for 1 of any other (3:1 with a market, 2:1 with a caravan post).
   - **Trade** with other players: resources and cards. Anyone may offer to the acting player and the acting player may offer to anyone. Accepted trades are binding. Open offers expire when the turn ends.
4. **Raid** (all at once). Repeat once per War Horn played this round.
   - **Vote**: three random kingdoms are shown; everyone secretly votes; ties are a coin flip.
   - **Commit**: everyone publicly commits raid-ready dragons (hatched, fed, unhurt) and can change their mind until they say ready. When everyone is ready, commitments lock.
   - **Fight or bail**: each committed player secretly chooses. Bailing costs nothing, but you get no loot.
   - **Combat**, in rounds: each fighting dragon hits as many defenders as its targets number, rolling its dice against each, picking defenders by its card's targeting rule. Damage is doubled against a defender weak to the dragon's element and halved (at least 1) against one strong against it. Then each defender hits random dragons. A dragon at 0 health is knocked out and goes home. After each round, every player with dragons in the fight chooses for each to **stay** or **flee**: a fleeing dragon rolls d6 + speed against d6 + the best chase among living defenders; it leaves either way, and if it loses, it takes 2 damage per point it lost by.
   - **Loot**: if every defender falls, the players with dragons still fighting split the loot evenly (rounded down).

**End of round.** Anyone over 7 cards discards down to 7. If anyone has 15 or more points, the highest total wins (ties: most gold, then earliest in this round's turn order).

## Points

- Dragons: hatchling 1, young 2, adult 4. Eggs 0.
- Tower floor 1, monument 2, Gilding +1.
- Secret Hoard cards: 1 each while in hand (hidden until the end).
- Titles, 2 each: Strongest Dragon Army (most dragon points), Tallest Tower (most floors), Largest Territory (most buildings). A title goes to the single leader; the holder keeps it on a tie.

## Cards

Building cards and upgrades are listed with their text and cost in a player's view and in `src/data.ts`: 10 buildings (quarry, lumber camp, crystal mine, pasture, roost, hatchery, market, caravan post, tower floor, monument) and 4 upgrades (Workshop, Gilding, Nesting Grounds, Trade Charter). Action cards: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn, Secret Hoard, and 15 dragons (a base whelp and two special dragons per element).
