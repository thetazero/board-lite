# board-lite rules (as the engine plays them)

You are a wizard who raises dragons. Build out from your tower, hatch and feed dragons, raid neutral kingdoms for gold, and be first to **15 points**. All numbers live in `src/data.ts` and are first guesses awaiting playtests.

**Hidden** (your phone): your resources and your hand. **Public** (the TV): the map, buildings, dragons, titles, hand sizes, trade offers.

**Setup.** The land is random and ringed by ocean, with one natural harbor on each coast. Wild **fauna** holds some hexes: wolves 2 steps from the nearest tower, bears 3, a basilisk further out. Two **great beasts**: the Thunderbird on the mountain peak at the centre, and the Leviathan in the ocean beside one harbor. Each player has a tower (fixed spot by player count), 3 stone, timber, crystal and livestock, and a random base hatchling. The first player moves one seat left each round.

## A round: four phases

1. **Production** (in turn order). Your tower gives 1 stone, timber, crystal and livestock. Each basic production building rolls its own die (a quarry: d6 stone; a Workshop adds 2). Building cards make what their text says, without dice. Then every dragon eats 1 livestock, heals 7 health and grows one step (plus one per hatchery you own); one that went hungry doesn't grow. A dragon that went hungry, or was still hurt when production began, **sits out** this round's raids: a dragon misses one round of raids for every 7 damage it took, rounded up. A dragon moves up a life stage (egg → hatchling → young → adult) when its steps reach its card's growth time.
2. **Cards** (all at once). Draw 1 action card and 2 building cards; keep one of the building cards and discard the other. Building cards hold buildings and upgrades; action cards hold actions and dragon eggs.
3. **Actions** (one player at a time). On your turn, in any order and as often as you can pay:
   - **Build** on an empty land hex (no building, no fauna) touching one of your buildings: a basic building, no card needed (quarry on mountain, lumber camp on forest, crystal mine on ley line, pasture on meadow, or a roost anywhere), or a building card from your hand (a port needs a harbor). Or add a **tower floor** on your tower, no card needed.
   - **Upgrade**: put an upgrade card on one of your buildings of its class. One upgrade per building.
   - **Play** an action card, or hatch a dragon card as an egg (needs a free roost space).
   - **Clear fauna**: send any of your raid-ready dragons against the beast on any hex. It's a raid's combat (below), fought to the end. Those dragons sit out this round's raids. If the beast falls, the hex is free and its livestock is yours; if not, it stays, at full health. A great beast takes one try per player a round.
   - **Special project** (no card): hatch a base egg of any element, for double the base dragon card's cost.
   - **Bank**: trade 4 of one resource for 1 of any other (3:1 with a port).
   - **Trade** with other players: resources and cards. Anyone may offer to the acting player and the acting player may offer to anyone. Accepted trades are binding. The acting player answers every offer made to them before ending their turn; their own open offers expire when it ends.
4. **Raid** (all at once). Repeat once per War Horn played this round.
   - **Combat power** is a rough guide printed on every dragon and kingdom: √(health × average damage a combat round), a kingdom's being its defenders' added up. Raiders whose powers add up past a kingdom's usually win, but it ignores elements and targeting, so it can mislead.
   - **Vote**: three random kingdoms are shown; everyone secretly votes; ties are a coin flip. Easy kingdoms give almost nothing; hard ones a lot.
   - **Commit**: everyone publicly commits raid-ready dragons (hatched, unhurt, not sitting out) and can change their mind until they say ready. When everyone is ready, commitments lock.
   - **Fight or bail**: each committed player secretly chooses. Bailing costs nothing, but you get no loot. This is your only way out: once the fight starts there is no retreat, and a dragon that takes a hit sits out raids while it heals. The more dragons fight, the faster the defenders fall and the fewer hits each takes.
   - **Combat**, in rounds: each fighting dragon hits as many defenders as its targets number, rolling its dice against each, picking defenders by its card's targeting rule. Damage is doubled against a defender weak to the dragon's element and halved (at least 1) against one strong against it. Then each defender hits random dragons. A dragon at 0 health is knocked out and goes home. Rounds repeat until every defender or every dragon has fallen.
   - **Loot**: if every defender falls, the players with dragons still fighting split the loot by the combat power each still has fighting (rounded down; what's left over goes to the one with the most).

**End of round.** Anyone over 7 cards discards down to 7. If anyone has 15 or more points, the highest total wins (ties: most gold, then earliest in this round's turn order).

**Table talk.** Anyone may talk at any time, to everyone or privately to one player. Promises bind no one; only accepted trades do.

**Fauna.** Nothing is built on a hex with fauna, and a building under fauna produces nothing until it's cleared. Anyone may clear any fauna. New fauna comes only from cards (Wolf Call, Rouse the Bear), which put a beast on any land hex but a tower: next to someone, or on their building.

**Great beasts.** Each holds its hex and every hex next to it: nothing is built there while it lives. Whoever slays one scores **1 point** for good, and it never comes back: a race. The Thunderbird is weak to ice and shrugs off lightning, air and water; the Leviathan is weak to lightning and shrugs off water, fire and ice. Once the Thunderbird falls, each production building on or next to its peak makes 2 more a round.

**Neighbours.** Every building has a class (quarry, lumber camp, mine, pasture, dragon building, monument or trade building); the tower is a monument and a dragon building. Many building cards count their six neighbouring hexes, either hexes of a terrain (built on or not) or buildings of a class, whoever owns them. The count is always the current one: a neighbour built later counts too.

## Points

- Dragons: hatchling 1, young 2, adult 3. Eggs 0.
- Tower floor 1 (2 stone and 3 gold, no card: raid loot always has a way into points); other monuments as their card says (most count their neighbours); Gilding +2.
- Secret Hoard cards: 1 each while in hand (hidden until the end).
- Great beasts: 1 each to whoever slays it, for good.
- Titles, 2 each: Strongest Dragon Army (most dragon points, at least 8), Tallest Tower (most floors, at least 3), Largest Territory (most buildings, at least 9). The holder keeps a title on a tie.

## Cards

Basic buildings (no card): quarry, lumber camp, crystal mine, pasture, roost, tower floor. Building cards and upgrades are listed with their text and cost in a player's view, in `src/data.ts`, and with what they're worth in `docs/datasheet.md`: 18 buildings across the seven classes, most of which count their neighbours, and 4 upgrades (Workshop, Gilding, Nesting Grounds, Trade Charter). Action cards: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn, Secret Hoard, Wolf Call, Rouse the Bear, and 15 dragons (a base dragon named for its element, like the Fire Dragon, and two special dragons per element).
