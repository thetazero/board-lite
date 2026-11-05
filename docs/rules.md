# board-lite rules (as the engine plays them)

You are a wizard who raises dragons. Build out from your tower, hatch and feed dragons, raid neutral kingdoms for gold, and be first to **30 points**. All numbers live in `src/data.ts` and are first guesses awaiting playtests.

**Hidden** (your phone): your hand, and your resources other than gold. **Public** (the TV): the map, buildings, dragons, titles, everyone's gold, hand sizes, trade offers.

**Setup.** The land is random and ringed by ocean, with one natural harbor on each coast. Wild **fauna** holds some hexes: wolves 2 steps from the nearest tower, bears 3, a basilisk further out. Two **great beasts**: the Thunderbird on the mountain peak at the centre, and the Leviathan in the ocean beside one harbor. Each player has a tower (fixed spot by player count), 3 stone, timber, crystal and livestock, and a Fire Dragon egg. The first player moves 1 seat left each round.

## A round: four phases

1. **Production** (in turn order). Your tower gives 1 stone, timber, crystal and livestock. Each basic production building rolls its own die (a quarry makes 1d4 stone; a Workshop adds 2). Building cards make what their text says, without dice. Then each beast that isn't a great beast has a 1 in 3 chance to move to a random adjacent land hex with no tower or beast; one beside no other beast is twice as likely. Then every dragon eats 1 livestock. A hurt dragon heals 7 health; any other grows 1 step (plus 1 per hatchery you own). A dragon that goes hungry doesn't heal or grow. A hurt dragon still fights, with the health it has left; a **knocked-out** dragon (0 health) can't fight until it heals. A dragon moves up a life stage (egg → hatchling → young → adult) when its steps reach its card's growth time.
2. **Cards** (all at once). Draw 1 action card and 2 building cards; keep 1 of the building cards and discard the other. Building cards hold buildings and upgrades; action cards hold actions and dragon eggs.
3. **Actions** (one player at a time). On your turn, in any order and as often as you can pay:
   - **Build** on an empty land hex (no building, no beast) adjacent to one of your buildings: a basic building, no card needed (quarry on mountain, lumber camp on forest, crystal mine on crystal field, pasture on meadow, or a roost anywhere), or a building card from your hand (a port needs a harbor; a monument card goes adjacent to what its card names). Or add a **tower floor** on your tower, no card needed.
   - **Upgrade**: put an upgrade card on one of your buildings of its class. Each building takes 1 upgrade.
   - **Play** an action card, or hatch a dragon card as an egg (needs a free roost space).
   - **Clear** a hex: send any of your raid-ready dragons against what holds it, its beast and every rival dragon perched there, together. It's a raid's combat (below), fought to the end. If the beast falls, the hex is empty and its loot is yours (a beast a card placed has none); if not, it stays, at full health. A perched dragon keeps its hits, and one knocked out goes home. A great beast takes one try per player a round.
   - **Perch**: send any of your raid-ready dragons to perch on a rival's building (not a tower). They stay until you **recall** them on your turn or they're knocked out, and don't raid or clear while there.
   - **Special project** (no card): hatch a base egg of any element, for double the base dragon card's cost.
   - **Bank**: trade 4 of one resource for 1 of any other (3:1 with a port).
   - **Trade** with other players: resources and cards. Anyone may offer to the acting player and the acting player may offer to anyone. An offer gives or gets something, and you only offer what you have; you can't ask for more gold than the other player has. You may accept an offer only if you both still have what it trades. Accepted trades are binding. The acting player answers every offer made to them before ending their turn; their own open offers expire when it ends.
4. **Raid** (all at once). Repeat once per War Horn played this round. If nobody has a raid-ready dragon, there is no raid.
   - **Combat power** is a rough guide printed on every dragon and kingdom: √(health × average damage a combat round), a kingdom's being its defenders' added up. Raiders whose powers add up past a kingdom's usually win, but it ignores elements and targeting, so it can mislead.
   - **Vote**: everyone with a raid-ready dragon votes for one of the kingdoms, in the open: everyone sees each vote as it's cast. If you have no raid-ready dragon, you don't vote. Ties are a coin flip. Easy kingdoms give almost nothing; hard ones a lot.
   - **Commit**: everyone publicly sends raid-ready dragons (hatched, not knocked out, not perched) and can change their mind until they say ready. When everyone is ready, commitments lock.
   - **Fight or bail**: each committed player secretly chooses. Bailing costs nothing, but you get no loot. This is your only way out: once the fight starts there is no retreat, and the hits a dragon takes stay on it while it heals. The more dragons fight, the faster the defenders fall and the fewer hits each takes.
   - **Combat**, in rounds: each fighting dragon hits as many defenders as its targets number, rolling its dice against each, picking defenders by its card's targeting rule. Then each defender hits random dragons. Every hit, either way, follows the **element wheel**: a hit from an element that beats what it hits deals double damage. A dragon at 0 health is knocked out and goes home. Rounds repeat until every defender or every dragon has fallen.
   - **Loot**: if every defender falls, the players with dragons still fighting split the loot by the combat power each still has fighting, rounded down. What's left over is handed out 1 at a time, the most power first (the earlier seat on a tie), carrying on from one resource to the next: 3 equal players splitting 2 livestock and 2 gold get 1 livestock, 1 livestock, then 1 gold, and the first player gets the last gold. After every raid, each kingdom that didn't fall adds 1 gold to its loot, and the one that fell goes back to its printed loot.

**End of round.** Anyone holding more than 7 cards discards down to 7, choosing which; you can't discard at any other time. If anyone has 30 or more points, the highest total wins (ties: most gold, then earliest in this round's turn order).

**Table talk.** Anyone may talk at any time, to everyone or privately to one player. Promises bind no one; only accepted trades do.

**Fauna.** Nothing is built on a hex with a beast, and a building under a beast makes nothing until the beast is cleared. Anyone may clear any beast. New beasts come only from cards (Rouse the Bear places a Cave Bear, Wake the Basilisk a Basilisk) on any land hex with no tower or beast: next to someone, or on their building. A beast a card placed gives no loot.

**Elements.** Every dragon, defender, beast and great beast has an element: fire, ice, lightning, air, water or neutral. On the element wheel each element beats exactly one other:

water → fire → ice → air → lightning → water

(Water beats fire, fire beats ice, ice beats air, air beats lightning, lightning beats water.) A hit from an element that beats what it hits deals double damage, whoever strikes: dragons against defenders and beasts, defenders and beasts against dragons, and dragons against dragons. That's the only element effect. Neutral beats nothing, and nothing beats it.

| Element | Beats | Weak to |
|---|---|---|
| water | fire | lightning |
| fire | ice | water |
| ice | air | fire |
| air | lightning | ice |
| lightning | water | air |
| neutral | nothing | nothing |

**Perched dragons.** A building with a dragon perched on it makes nothing, as under a beast. Several dragons may perch on one building, whoever owns them, and they fight together when someone clears it. Perched dragons eat, heal and grow as at home, and a hurt one keeps perching. Nothing stops a tower: no beast or dragon goes on one.

**Great beasts.** Each holds its hex and every hex adjacent to it: nothing is built there while it lives. Whoever slays one scores **4 points** for good, and it never comes back: a race. The Thunderbird is air; the Leviathan is water. Once the Thunderbird falls, each production building on or adjacent to its peak makes 2 more each round.

**Adjacent hexes.** Every building has a class (stone building, timber building, crystal building, livestock building, dragon building, monument or trade building; each basic building that makes a resource is in that resource's class, with the building cards that make the same); the tower is a monument and a dragon building. Many building cards count their 6 adjacent hexes, either hexes of a terrain, built on or not ("each adjacent meadow hex"), or buildings of a class, whoever owns them ("each adjacent livestock building"). The count is always the current one: an adjacent building built later counts too.

## Points

Dragons are worth no points; they count toward Strongest Dragon Army.

- Production buildings: 1 each, every stone, timber, crystal and livestock building, basic or card.
- Monument cards (Monument, Standing Stones, Lighthouse, Guildhall): 2 each. Each goes adjacent to at least one of what its card names: a monument (a tower is one), a crystal field hex, an ocean hex or a trade building. No other building is worth points: not the tower, not its floors.
- Secret Hoard cards: 2 each while in hand (hidden until the end).
- Great beasts: 4 each to whoever slays it, for good.
- Titles, 6 each: Strongest Dragon Army (most combat power across your dragons, at least 55; eggs count 0), Tallest Tower (most floors, at least 4) and Largest Hoard (most gold, at least 20). Tower floors (6 stone and 4 gold, no card) count only toward Tallest Tower. The holder keeps a title on a tie.

## Cards

Basic buildings (no card): quarry, lumber camp, crystal mine, pasture, roost, tower floor. Building cards and upgrades are listed with their text and cost in a player's view, in `src/data.ts`, and with what they're worth in `docs/datasheet.md`: 18 buildings across the 7 classes, most of which count what's adjacent, and 3 upgrades (Workshop, Nesting Grounds, Trade Charter). Action cards: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn, Secret Hoard, Wolf Call, Rouse the Bear, and 15 dragons (a base dragon named for its element, like the Fire Dragon, and 2 special dragons per element).
