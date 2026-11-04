# Tuning datasheet

Generated from `src/data.ts` by `npm run datasheet`; don't edit by hand. `npm test` fails when it is out of date, so after changing any number, rerun `npm run datasheet` and read the diff. It holds the raw rules only: every number as `src/data.ts` has it, with nothing simulated.

## Economy baseline

- Start: 3 stone, 3 timber, 3 crystal, 3 livestock. Tower income: 1 stone, 1 timber, 1 crystal, 1 livestock a round, no dice.
- Cards: each round, draw 2 building cards and keep 1, plus 1 card from the action deck (action cards and dragons; see Decks); hand cap 7. Basic buildings (Quarry, Lumber Camp, Crystal Mine, Pasture, Roost, Tower Floor) need no card.
- Win at 20 points. Titles are 2 points each, from a minimum (see Points).
- Each dragon eats 1 livestock a round, eggs included; the tower makes 1.
- Gold: no basic building makes it. It comes from raids, Markets, Trade Charters, clearing fauna, and the bank.
- Bank: 4:1, 3:1 with a Port.

## Decks

There are 2 decks, and these tables are all of each one: every card in it, its copies, and the total. The building deck holds every building card and upgrade. The action deck holds every action card and every dragon, base dragons included. Basic buildings are in neither deck. When a deck runs out, its discards are shuffled into a new one.

### Building deck: 43 cards

18 kinds of building card (33 cards) + 3 kinds of upgrade (10 cards) = 43 cards.

| Card | Kind | Copies | Share of deck |
|---|---|---|---|
| Cliff Works | building card | 2 | 5% |
| Stonemason | building card | 2 | 5% |
| Woodcutter's Hut | building card | 2 | 5% |
| Sawmill | building card | 2 | 5% |
| Driftwood Yard | building card | 1 | 2% |
| Crystal Spire | building card | 2 | 5% |
| Gem Cutter | building card | 2 | 5% |
| Smelter | building card | 1 | 2% |
| Shepherd's Fold | building card | 2 | 5% |
| Drovers' Barn | building card | 2 | 5% |
| Fishery | building card | 1 | 2% |
| Hatchery | building card | 2 | 5% |
| Port | building card | 3 | 7% |
| Market | building card | 2 | 5% |
| Monument | building card | 2 | 5% |
| Standing Stones | building card | 2 | 5% |
| Lighthouse | building card | 2 | 5% |
| Guildhall | building card | 1 | 2% |
| Workshop | upgrade | 4 | 9% |
| Nesting Grounds | upgrade | 3 | 7% |
| Trade Charter | upgrade | 3 | 7% |
| **Total** |  | **43** | **100%** |

### Action deck: 88 cards

8 kinds of action card (58 cards) + 5 kinds of base dragon (10 cards) + 10 kinds of dragon card (20 cards) = 88 cards.

| Card | Kind | Copies | Share of deck |
|---|---|---|---|
| Windfall | action card | 4 | 5% |
| Buried Treasure | action card | 10 | 11% |
| Growth Elixir | action card | 10 | 11% |
| Healing Potion | action card | 8 | 9% |
| War Horn | action card | 6 | 7% |
| Secret Hoard | action card | 8 | 9% |
| Wolf Call | action card | 8 | 9% |
| Rouse the Bear | action card | 4 | 5% |
| Fire Dragon | base dragon | 2 | 2% |
| Ice Dragon | base dragon | 2 | 2% |
| Lightning Dragon | base dragon | 2 | 2% |
| Air Dragon | base dragon | 2 | 2% |
| Water Dragon | base dragon | 2 | 2% |
| Ember Wyrm | dragon card | 2 | 2% |
| Cinder Drake | dragon card | 2 | 2% |
| Frost Wyrm | dragon card | 2 | 2% |
| Rime Drake | dragon card | 2 | 2% |
| Storm Wyrm | dragon card | 2 | 2% |
| Bolt Drake | dragon card | 2 | 2% |
| Sky Wyrm | dragon card | 2 | 2% |
| Zephyr Drake | dragon card | 2 | 2% |
| Abyss Wyrm | dragon card | 2 | 2% |
| Reef Drake | dragon card | 2 | 2% |
| **Total** |  | **88** | **100%** |

## Costs

Everything that can be bought, as the game has it. Deck is the deck its cards are in (see Decks); a kind isn't a deck, and dragons are in the action deck. Basic buildings have no copies and are in no deck: anyone may build them, no card needed. Dragon points are hatchling / young / adult.

| Name | Kind | Deck | Copies | Cost | Does | Points |
|---|---|---|---|---|---|---|
| Quarry | basic building | none | — | 8 timber, 8 crystal, 6 livestock | Makes 1d4 stone each round. | — |
| Lumber Camp | basic building | none | — | 8 stone, 8 crystal, 6 livestock | Makes 1d4 timber each round. | — |
| Crystal Mine | basic building | none | — | 8 stone, 8 timber, 6 livestock | Makes 1d4 crystal each round. | — |
| Pasture | basic building | none | — | 6 stone, 8 timber, 8 crystal | Makes 1d4 livestock each round. | — |
| Roost | basic building | none | — | 4 stone, 4 timber | Houses 2 more dragons. | — |
| Tower Floor | basic building | none | — | 6 stone, 4 gold | Adds a floor to your tower. Floors count toward Tallest Tower. | — |
| Cliff Works | building card | building | 2 | 6 timber, 6 crystal, 4 livestock | Makes 1 stone each round for each adjacent mountain hex. | — |
| Stonemason | building card | building | 2 | 6 timber, 6 crystal, 4 livestock | Makes 1 stone each round for each adjacent stone building. | — |
| Woodcutter's Hut | building card | building | 2 | 6 stone, 6 crystal, 4 livestock | Makes 1 timber each round for each adjacent forest hex. | — |
| Sawmill | building card | building | 2 | 6 stone, 6 crystal, 4 livestock | Makes 1 timber each round for each adjacent timber building. | — |
| Driftwood Yard | building card | building | 1 | 8 stone, 6 crystal, 6 livestock | Makes 1 timber each round for each adjacent ocean hex. | — |
| Crystal Spire | building card | building | 2 | 6 stone, 6 timber, 4 livestock | Makes 1 crystal each round for each adjacent crystal field hex. | — |
| Gem Cutter | building card | building | 2 | 6 stone, 6 timber, 4 livestock | Makes 1 crystal each round for each adjacent crystal building. | — |
| Smelter | building card | building | 1 | 4 stone, 6 timber, 6 livestock | Makes 1 crystal each round for each adjacent stone building. | — |
| Shepherd's Fold | building card | building | 2 | 6 stone, 6 timber, 4 crystal | Makes 1 livestock each round for each adjacent meadow hex. | — |
| Drovers' Barn | building card | building | 2 | 4 stone, 6 timber, 6 crystal | Makes 1 livestock each round for each adjacent livestock building. | — |
| Fishery | building card | building | 1 | 6 stone, 8 timber, 6 crystal | Makes 1 livestock each round for each adjacent ocean hex. | — |
| Hatchery | building card | building | 2 | 6 stone, 6 timber, 6 crystal | Your dragons grow 1 extra step each round. | — |
| Port | building card | building | 3 | 2 stone, 6 timber, 2 livestock | You trade with the bank at 3:1. | — |
| Market | building card | building | 2 | 6 stone, 6 timber, 6 crystal, 4 gold | Makes 1 gold each round for each adjacent trade building. | — |
| Monument | building card | building | 2 | 8 stone, 6 timber, 20 gold | Worth 1 point for each adjacent monument. | 1 each |
| Standing Stones | building card | building | 2 | 6 stone, 6 crystal, 20 gold | Worth 1 point for each adjacent crystal field hex. | 1 each |
| Lighthouse | building card | building | 2 | 10 stone, 6 timber, 20 gold | Worth 1 point for each adjacent ocean hex. | 1 each |
| Guildhall | building card | building | 1 | 6 stone, 6 timber, 20 gold | Worth 1 point for each adjacent trade building. | 1 each |
| Workshop | upgrade | building | 4 | 8 stone, 8 timber, 2 crystal | This stone, timber, crystal or livestock building makes 2 more. | — |
| Nesting Grounds | upgrade | building | 3 | 4 stone, 2 timber | This roost, hatchery or tower houses 2 more dragons. | — |
| Trade Charter | upgrade | building | 3 | 4 stone, 8 gold | This port or market makes 1 more gold each round. | — |
| Windfall | action card | action | 4 | nothing | Gain 3 of one resource other than gold. | — |
| Buried Treasure | action card | action | 10 | nothing | Gain 2 gold. | — |
| Growth Elixir | action card | action | 10 | 3 gold | Grow one of your dragons to its next life stage. | — |
| Healing Potion | action card | action | 8 | nothing | Fully heal one of your hurt dragons. It can raid this round. | — |
| War Horn | action card | action | 6 | 1 crystal | Hold 1 more raid this round. | — |
| Secret Hoard | action card | action | 8 | nothing | Worth 1 point while in your hand. | 1 |
| Wolf Call | action card | action | 8 | 1 crystal | Place a Cave Bear on any land hex with no tower or beast. | — |
| Rouse the Bear | action card | action | 4 | 1 crystal | Place a Basilisk on any land hex with no tower or beast. | — |
| Fire Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | fire, grows a stage every 2 rounds | 1 / 2 / 3 |
| Ice Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | ice, grows a stage every 2 rounds | 1 / 2 / 3 |
| Lightning Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | lightning, grows a stage every 2 rounds | 1 / 2 / 3 |
| Air Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | air, grows a stage every 2 rounds | 1 / 2 / 3 |
| Water Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | water, grows a stage every 2 rounds | 1 / 2 / 3 |
| Ember Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | fire, grows a stage every 3 rounds | 1 / 2 / 3 |
| Cinder Drake | dragon card | action | 2 | 8 crystal, 4 livestock | fire, grows a stage every 2 rounds | 1 / 2 / 3 |
| Frost Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | ice, grows a stage every 3 rounds | 1 / 2 / 3 |
| Rime Drake | dragon card | action | 2 | 8 crystal, 4 livestock | ice, grows a stage every 2 rounds | 1 / 2 / 3 |
| Storm Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | lightning, grows a stage every 3 rounds | 1 / 2 / 3 |
| Bolt Drake | dragon card | action | 2 | 8 crystal, 4 livestock | lightning, grows a stage every 2 rounds | 1 / 2 / 3 |
| Sky Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | air, grows a stage every 3 rounds | 1 / 2 / 3 |
| Zephyr Drake | dragon card | action | 2 | 8 crystal, 4 livestock | air, grows a stage every 2 rounds | 1 / 2 / 3 |
| Abyss Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | water, grows a stage every 3 rounds | 1 / 2 / 3 |
| Reef Drake | dragon card | action | 2 | 8 crystal, 4 livestock | water, grows a stage every 2 rounds | 1 / 2 / 3 |

## Basic production buildings

Anyone may build these, no card needed.

| Building | Terrain | Cost | Makes each round |
|---|---|---|---|
| Quarry | mountain | 8 timber, 8 crystal, 6 livestock | d4 stone (avg 2.5) |
| Lumber Camp | forest | 8 stone, 8 crystal, 6 livestock | d4 timber (avg 2.5) |
| Crystal Mine | crystal field | 8 stone, 8 timber, 6 livestock | d4 crystal (avg 2.5) |
| Pasture | meadow | 6 stone, 8 timber, 8 crystal | d4 livestock (avg 2.5) |

Workshop (8 stone, 8 timber, 2 crystal): makes 2 more a round.

## Land

The land is ringed by ocean, where nothing is built. Each of its six coasts has one natural harbor at a random spot between its corners; ports go only on harbors. Land: 2p radius 4 (61 land hexes), 3p radius 4 (61 land hexes), 4p radius 5 (91 land hexes). Terrain shares are of the random land, before towers and harbors are placed.

| Terrain | For | Share of land |
|---|---|---|
| mountain | Quarry | 20% |
| forest | Lumber Camp | 20% |
| crystal field | Crystal Mine | 20% |
| meadow | Pasture | 20% |
| plains | — | 20% |
| harbor | Port | coast |

## Building cards that count their neighbours

Each effect is multiplied by how many of the building's six neighbouring hexes count: hexes of a terrain (built on or not), or buildings of a class, whoever owns them (the tower is a monument and a dragon building).

| Card | Class | Counts | Cost | Each one adds |
|---|---|---|---|---|
| Cliff Works | stone building | mountain hexes | 6 timber, 6 crystal, 4 livestock | 1 stone a round |
| Stonemason | stone building | stone buildings (anyone's) | 6 timber, 6 crystal, 4 livestock | 1 stone a round |
| Woodcutter's Hut | timber building | forest hexes | 6 stone, 6 crystal, 4 livestock | 1 timber a round |
| Sawmill | timber building | timber buildings (anyone's) | 6 stone, 6 crystal, 4 livestock | 1 timber a round |
| Driftwood Yard | timber building | ocean hexes | 8 stone, 6 crystal, 6 livestock | 1 timber a round |
| Crystal Spire | crystal building | crystal field hexes | 6 stone, 6 timber, 4 livestock | 1 crystal a round |
| Gem Cutter | crystal building | crystal buildings (anyone's) | 6 stone, 6 timber, 4 livestock | 1 crystal a round |
| Smelter | crystal building | stone buildings (anyone's) | 4 stone, 6 timber, 6 livestock | 1 crystal a round |
| Shepherd's Fold | livestock building | meadow hexes | 6 stone, 6 timber, 4 crystal | 1 livestock a round |
| Drovers' Barn | livestock building | livestock buildings (anyone's) | 4 stone, 6 timber, 6 crystal | 1 livestock a round |
| Fishery | livestock building | ocean hexes | 6 stone, 8 timber, 6 crystal | 1 livestock a round |
| Market | trade building | trade buildings (anyone's) | 6 stone, 6 timber, 6 crystal, 4 gold | 1 gold a round |
| Monument | monument | monuments (anyone's) | 8 stone, 6 timber, 20 gold | 1 point |
| Standing Stones | monument | crystal field hexes | 6 stone, 6 crystal, 20 gold | 1 point |
| Lighthouse | monument | ocean hexes | 10 stone, 6 timber, 20 gold | 1 point |
| Guildhall | monument | trade buildings (anyone's) | 6 stone, 6 timber, 20 gold | 1 point |

## Points

Every way to make points. Dragon costs include the livestock eaten while growing, from egg, without a hatchery; an adult keeps eating 1 livestock a round. Neighbour-counting monuments are shown at 2 neighbours.

| Source | Pays | Points | Pays per point | Ready |
|---|---|---|---|---|
| Monument, 2 neighbours | 8 stone, 6 timber, 20 gold | 2 | 4 stone, 3 timber, 10 gold | now |
| Standing Stones, 2 neighbours | 6 stone, 6 crystal, 20 gold | 2 | 3 stone, 3 crystal, 10 gold | now |
| Lighthouse, 2 neighbours | 10 stone, 6 timber, 20 gold | 2 | 5 stone, 3 timber, 10 gold | now |
| Guildhall, 2 neighbours | 6 stone, 6 timber, 20 gold | 2 | 3 stone, 3 timber, 10 gold | now |
| Secret Hoard (action card) | nothing | 1 | nothing | now, uses a hand slot |
| Base dragon, hatchling | 6 crystal, 4 livestock + 2 livestock | 1 | 6 crystal, 6 livestock | 2 rounds |
| Base dragon, young | 6 crystal, 4 livestock + 4 livestock | 2 | 3 crystal, 4 livestock | 4 rounds |
| Base dragon, adult | 6 crystal, 4 livestock + 6 livestock | 3 | 2 crystal, 3.3 livestock | 6 rounds |
| Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, hatchling | 8 crystal, 4 livestock, 2 gold + 3 livestock | 1 | 8 crystal, 7 livestock, 2 gold | 3 rounds |
| Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, young | 8 crystal, 4 livestock, 2 gold + 6 livestock | 2 | 4 crystal, 5 livestock, 1 gold | 6 rounds |
| Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, adult | 8 crystal, 4 livestock, 2 gold + 9 livestock | 3 | 2.7 crystal, 4.3 livestock, 0.7 gold | 9 rounds |
| Cinder Drake, Rime Drake, Bolt Drake, Zephyr Drake, Reef Drake, hatchling | 8 crystal, 4 livestock + 2 livestock | 1 | 8 crystal, 6 livestock | 2 rounds |
| Cinder Drake, Rime Drake, Bolt Drake, Zephyr Drake, Reef Drake, young | 8 crystal, 4 livestock + 4 livestock | 2 | 4 crystal, 4 livestock | 4 rounds |
| Cinder Drake, Rime Drake, Bolt Drake, Zephyr Drake, Reef Drake, adult | 8 crystal, 4 livestock + 6 livestock | 3 | 2.7 crystal, 3.3 livestock | 6 rounds |
| Base dragon by special project, adult | 12 crystal, 8 livestock + 6 livestock | 3 | 4 crystal, 4.7 livestock | 6 rounds |

With a Hatchery (+1 growth a round), a growth-time-2 dragon reaches adult in 3 rounds instead of 6.

Titles: 2 points each, for most dragon points (at least 10), most tower floors (at least 4) and most gold (at least 20). Tower floors are worth nothing else; gold held is worth points only through Largest Hoard.

## Dragons

Each stage: combat power (see Raids), health, targets × dice (average damage a combat round, before elements).

| Dragon | Element | Cost | Growth time | Targets | Hatchling | Young | Adult |
|---|---|---|---|---|---|---|---|
| Base dragon (any element) | any | 6 crystal, 4 livestock | 2 | random | **5**: 6hp 1×1d6 (3.5) | **9**: 12hp 1×2d6 (7) | **17**: 20hp 2×2d6 (14) |
| Ember Wyrm | fire | 8 crystal, 4 livestock, 2 gold | 3 | weak_to_me | **6**: 7hp 1×1d8 (4.5) | **11**: 14hp 1×2d8 (9) | **25**: 24hp 2×3d8 (27) |
| Cinder Drake | fire | 8 crystal, 4 livestock | 2 | lowest_health | **5**: 6hp 1×1d6 (3.5) | **9**: 11hp 2×1d6 (7) | **16**: 18hp 3×1d8 (13.5) |
| Frost Wyrm | ice | 8 crystal, 4 livestock, 2 gold | 3 | strongest_attacker | **6**: 9hp 1×1d6 (3.5) | **11**: 17hp 1×2d6 (7) | **20**: 30hp 1×3d8 (13.5) |
| Rime Drake | ice | 8 crystal, 4 livestock | 2 | weak_to_me | **5**: 6hp 1×1d6 (3.5) | **9**: 12hp 1×2d6 (7) | **19**: 20hp 2×2d8 (18) |
| Storm Wyrm | lightning | 8 crystal, 4 livestock, 2 gold | 3 | random | **5**: 6hp 2×1d4 (5) | **11**: 12hp 3×1d6 (10.5) | **21**: 24hp 4×1d8 (18) |
| Bolt Drake | lightning | 8 crystal, 4 livestock | 2 | strongest_attacker | **5**: 5hp 1×1d8 (4.5) | **9**: 10hp 1×2d8 (9) | **19**: 20hp 1×4d8 (18) |
| Sky Wyrm | air | 8 crystal, 4 livestock, 2 gold | 3 | lowest_health | **5**: 6hp 1×1d6 (3.5) | **11**: 13hp 2×1d8 (9) | **20**: 22hp 2×2d8 (18) |
| Zephyr Drake | air | 8 crystal, 4 livestock | 2 | random | **4**: 5hp 1×1d6 (3.5) | **8**: 10hp 2×1d6 (7) | **16**: 20hp 3×1d8 (13.5) |
| Abyss Wyrm | water | 8 crystal, 4 livestock, 2 gold | 3 | strongest_attacker | **6**: 8hp 1×1d8 (4.5) | **12**: 16hp 2×1d8 (9) | **22**: 28hp 2×2d8 (18) |
| Reef Drake | water | 8 crystal, 4 livestock | 2 | weak_to_me | **5**: 7hp 1×1d6 (3.5) | **10**: 13hp 1×2d6 (7) | **17**: 21hp 2×2d6 (14) |

## Raids

Defenders:

| Unit | Power | Health | Attack (avg) | Strong vs | Weak vs |
|---|---|---|---|---|---|
| Militia | 4 | 5 | 1×1d4 (2.5) | — | fire |
| Archers | 5 | 6 | 1×1d6 (3.5) | — | air |
| Knights | 7 | 12 | 1×1d8 (4.5) | fire | lightning |
| Frost Golem | 7 | 16 | 1×1d6 (3.5) | ice, water | fire |
| Storm Griffin | 7 | 10 | 1×1d8 (4.5) | air, lightning | ice |
| Sea Serpent | 8 | 14 | 2×1d4 (5) | water, fire | lightning |

Combat power is √(health × average damage a combat round), rounded; a kingdom's is its defenders' summed, and raiders' powers add up the same way. It ignores elements and targeting, so it is a rough guide on purpose.

Kingdoms (all are on the ballot each raid; average damage is the defenders' total a combat round). Loot is the printed loot below plus the gold the kingdom has hoarded: after every raid, each kingdom that didn't fall adds 1 gold, and the one that fell goes back to its printed loot. Shared loot is split by the combat power each player still has fighting at the end (each resource rounded down, and what's left over goes to the player with the most power).

| Kingdom | Defenders | Power | Total health | Avg damage a round | Loot |
|---|---|---|---|---|---|
| Hamlet of Brindle | Militia, Militia | **8** | 10 | 5 | 2 livestock, 1 gold |
| Archer's Hold | Archers, Archers, Archers, Militia | **19** | 23 | 13 | 4 timber, 4 gold |
| Frostpeak | Frost Golem, Frost Golem, Archers, Archers | **24** | 44 | 14 | 4 crystal, 7 gold |
| Knightsgate | Knights, Knights, Knights, Knights | **28** | 48 | 18 | 4 stone, 10 gold |
| Stormspire | Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin | **35** | 50 | 22.5 | 17 gold |
| Tidewatch | Sea Serpent, Sea Serpent, Sea Serpent, Knights, Knights, Knights | **45** | 78 | 28.5 | 4 livestock, 27 gold |

Healing: a hurt dragon heals 7 health at each production and sits out every round's raids until it is whole, so it misses one raid round per 7 damage, rounded up. Knocked out (0 health), a base dragon is out: hatchling 1, young 2, adult 3 rounds; the Frost Wyrm, the toughest adult, 5.

## Fauna

Beasts on the map. Nothing is built on a hex with fauna, and a building under fauna produces nothing (a basic production building loses its output). On their turn, any player may send raid-ready dragons against any beast, in the raids' combat; those dragons sit out the round's raids, and one that takes a hit sits out the next round's too, as after a raid. If the beast falls, the hex is empty and its loot goes to that player, unless a card placed it: then there is no loot. If not, it stays at full health. In production, each beast has a 1 in 3 chance to move to a random adjacent land hex with no tower or beast. New fauna comes only from cards.

| Beast | Health | Attack (avg) | Strong vs | Weak vs | Loot | Starts |
|---|---|---|---|---|---|---|
| Wolf Pack | 8 | 1×1d6 (3.5) | — | fire | 2 livestock | 2 steps from the nearest tower |
| Cave Bear | 16 | 1×1d10 (5.5) | ice | lightning | 4 livestock | 3 steps from the nearest tower |
| Basilisk | 26 | 2×1d8 (9) | fire, lightning | water, ice | 4 livestock, 2 gold | 4+ steps from the nearest tower |

On the starting map: one beast per 8 land hexes, none within 1 step of a tower.

Cards that send fauna (action cards; see Decks for how often they come):

| Card | Sends | Cost | Copies |
|---|---|---|---|
| Wolf Call | Cave Bear | 1 crystal | 8 |
| Rouse the Bear | Basilisk | 1 crystal | 4 |

## Great beasts

Two on every map, the top tier of the fauna: fought like fauna (on your turn, your dragons, to the end, and they sit out the round's raids), but each player gets one try at a great beast a round, and it is at full health for every fight. Each holds its hex and every hex next to it: nothing is built there while it lives. The player who slays one scores its points for good; it never comes back. Once the Thunderbird falls, every production building on or next to its peak makes 2 more a round.

| Beast | Health | Attack (avg) | Strong vs | Weak vs | Points | Lives in |
|---|---|---|---|---|---|---|
| Thunderbird | 70 | 2×2d8 (18) | lightning, air, water | ice | 2 | the mountain peak at the centre |
| Leviathan | 80 | 1×3d10 (16.5) | water, fire, ice | lightning | 2 | the ocean beside one harbor |

A single beast takes one hit per dragon a combat round, so a dragon's extra targets don't help here.

When that force exists: a base egg (any element, by special project, or a dragon card of the element) is an adult 6 rounds after it is hatched, 3 with a Hatchery. 

## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy; basic buildings aren't cards and aren't counted), plus where it comes from. Dragon upkeep (1 livestock per dragon a round) comes on top.

| Resource | In all card costs | Share | Comes from |
|---|---|---|---|
| stone | 226 | 19% | tower 1, Quarry, Cliff Works, Stonemason, raid loot (1 of 6 kingdoms) |
| timber | 196 | 16% | tower 1, Lumber Camp, Woodcutter's Hut, Sawmill, Driftwood Yard, raid loot (1 of 6 kingdoms) |
| crystal | 362 | 30% | tower 1, Crystal Mine, Crystal Spire, Gem Cutter, Smelter, raid loot (1 of 6 kingdoms) |
| livestock | 186 | 16% | tower 1, Pasture, Shepherd's Fold, Drovers' Barn, Fishery, raid loot (2 of 6 kingdoms), clearing fauna |
| gold | 222 | 19% | Market, Trade Charter, raid loot (6 of 6 kingdoms), clearing fauna |
