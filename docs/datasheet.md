# Tuning datasheet

Generated from `src/data.ts` by `npm run datasheet`; don't edit by hand. `npm test` fails when it is out of date, so after changing any number, rerun `npm run datasheet` and read the diff. It holds the raw rules only: every number as `src/data.ts` has it, with nothing simulated.

## Economy baseline

- Start: 3 stone, 3 timber, 3 crystal, 3 livestock. Tower income: 1 stone, 1 timber, 1 crystal, 1 livestock a round, no dice.
- Cards: each round, draw 2 building cards and keep 1, plus 1 card from the action deck (action cards and dragons; see Decks); hand cap 7. Basic buildings (Quarry, Lumber Camp, Crystal Mine, Pasture, Roost, Tower Floor) need no card.
- Win at 50 points. Titles are 7 points each, from a minimum (see Points).
- Each dragon eats 1 livestock a round, eggs included; the tower makes 1.
- Gold: no basic building makes it. It comes from raids, Markets and clearing fauna. The merchants don't trade it.
- Merchants: 4:1, basic resources only (not gold). With a port, its resource at 2:1: Stone Port, Timber Port, Crystal Port, Livestock Port.

## Decks

There are 2 decks, and these tables are all of each one: every card in it, its copies, and the total. The building deck holds every building card and upgrade. The action deck holds every action card and every dragon, base dragons included. Basic buildings are in neither deck. When a deck runs out, its discards are shuffled into a new one.

### Building deck: 42 cards

21 kinds of building card (35 cards) + 2 kinds of upgrade (7 cards) = 42 cards.

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
| Stone Port | building card | 1 | 2% |
| Timber Port | building card | 1 | 2% |
| Crystal Port | building card | 1 | 2% |
| Livestock Port | building card | 1 | 2% |
| Market | building card | 3 | 7% |
| Monument | building card | 2 | 5% |
| Standing Stones | building card | 2 | 5% |
| Lighthouse | building card | 2 | 5% |
| Guildhall | building card | 1 | 2% |
| Workshop | upgrade | 4 | 10% |
| Nesting Grounds | upgrade | 3 | 7% |
| **Total** |  | **42** | **100%** |

### Action deck: 84 cards

8 kinds of action card (54 cards) + 5 kinds of base dragon (10 cards) + 10 kinds of dragon card (20 cards) = 84 cards.

| Card | Kind | Copies | Share of deck |
|---|---|---|---|
| Windfall | action card | 4 | 5% |
| Buried Treasure | action card | 10 | 12% |
| Growth Elixir | action card | 10 | 12% |
| Healing Potion | action card | 8 | 10% |
| War Horn | action card | 6 | 7% |
| Secret Hoard | action card | 4 | 5% |
| Rouse the Bear | action card | 8 | 10% |
| Wake the Basilisk | action card | 4 | 5% |
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
| **Total** |  | **84** | **100%** |

## Costs

Everything that can be bought, as the game has it. Deck is the deck its cards are in (see Decks); a kind isn't a deck, and dragons are in the action deck. Basic buildings have no copies and are in no deck: anyone may build them, no card needed. Dragons are worth no points; they count toward Strongest Dragon Army (see Points).

| Name | Kind | Deck | Copies | Cost | Does | Points |
|---|---|---|---|---|---|---|
| Quarry | basic building | none | — | 4 timber, 4 crystal, 3 livestock | Makes 1d4 stone each round; worth 1 point. | 1 |
| Lumber Camp | basic building | none | — | 4 stone, 4 crystal, 3 livestock | Makes 1d4 timber each round; worth 1 point. | 1 |
| Crystal Mine | basic building | none | — | 4 stone, 4 timber, 3 livestock | Makes 1d4 crystal each round; worth 1 point. | 1 |
| Pasture | basic building | none | — | 3 stone, 4 timber, 4 crystal | Makes 1d4 livestock each round; worth 1 point. | 1 |
| Roost | basic building | none | — | 4 stone, 4 timber | Houses 2 more dragons. | — |
| Tower Floor | basic building | none | — | 6 stone, 4 gold | Adds a floor to your tower. Houses 1 more dragon; counts toward Tallest Tower. | — |
| Cliff Works | building card | building | 2 | 3 timber, 3 crystal, 2 livestock | Makes 1 stone each round for each adjacent mountain hex; worth 1 point. | 1 |
| Stonemason | building card | building | 2 | 3 timber, 3 crystal, 2 livestock | Makes 1 stone each round for each adjacent stone building; worth 1 point. | 1 |
| Woodcutter's Hut | building card | building | 2 | 3 stone, 3 crystal, 2 livestock | Makes 1 timber each round for each adjacent forest hex; worth 1 point. | 1 |
| Sawmill | building card | building | 2 | 3 stone, 3 crystal, 2 livestock | Makes 1 timber each round for each adjacent timber building; worth 1 point. | 1 |
| Driftwood Yard | building card | building | 1 | 4 stone, 3 crystal, 3 livestock | Makes 1 timber each round for each adjacent ocean hex; worth 1 point. | 1 |
| Crystal Spire | building card | building | 2 | 3 stone, 3 timber, 2 livestock | Makes 1 crystal each round for each adjacent crystal field hex; worth 1 point. | 1 |
| Gem Cutter | building card | building | 2 | 3 stone, 3 timber, 2 livestock | Makes 1 crystal each round for each adjacent crystal building; worth 1 point. | 1 |
| Smelter | building card | building | 1 | 2 stone, 3 timber, 3 livestock | Makes 1 crystal each round for each adjacent stone building; worth 1 point. | 1 |
| Shepherd's Fold | building card | building | 2 | 3 stone, 3 timber, 2 crystal | Makes 1 livestock each round for each adjacent meadow hex; worth 1 point. | 1 |
| Drovers' Barn | building card | building | 2 | 2 stone, 3 timber, 3 crystal | Makes 1 livestock each round for each adjacent livestock building; worth 1 point. | 1 |
| Fishery | building card | building | 1 | 3 stone, 4 timber, 3 crystal | Makes 1 livestock each round for each adjacent ocean hex; worth 1 point. | 1 |
| Hatchery | building card | building | 2 | 6 stone, 6 timber, 6 crystal | Your dragons grow 1 extra step each round. | — |
| Stone Port | building card | building | 1 | 2 stone, 6 timber, 2 livestock | You trade stone with the merchants at 2:1. | — |
| Timber Port | building card | building | 1 | 2 stone, 6 timber, 2 livestock | You trade timber with the merchants at 2:1. | — |
| Crystal Port | building card | building | 1 | 2 stone, 6 timber, 2 livestock | You trade crystal with the merchants at 2:1. | — |
| Livestock Port | building card | building | 1 | 2 stone, 6 timber, 2 livestock | You trade livestock with the merchants at 2:1. | — |
| Market | building card | building | 3 | 6 stone, 6 timber, 6 crystal, 4 gold | Makes 1 gold each round for each of your adjacent production buildings, up to 3. | — |
| Monument | building card | building | 2 | 6 stone, 5 timber | Worth 2 points. Build adjacent to a monument. | 2 |
| Standing Stones | building card | building | 2 | 5 stone, 6 crystal | Worth 2 points. Build adjacent to a crystal field hex. | 2 |
| Lighthouse | building card | building | 2 | 7 stone, 4 timber | Worth 2 points. Build adjacent to an ocean hex. | 2 |
| Guildhall | building card | building | 1 | 5 stone, 6 timber | Worth 2 points. Build adjacent to a trade building. | 2 |
| Workshop | upgrade | building | 4 | 4 stone, 4 timber, 2 crystal | This stone, timber, crystal or livestock building makes 2 more; worth 1 point. | 1 |
| Nesting Grounds | upgrade | building | 3 | 4 stone, 2 timber | This roost, hatchery or tower houses 2 more dragons. | — |
| Windfall | action card | action | 4 | nothing | Gain 3 of one resource other than gold. | — |
| Buried Treasure | action card | action | 10 | nothing | Gain 2 gold. | — |
| Growth Elixir | action card | action | 10 | 3 gold | Grow one of your dragons to its next life stage. | — |
| Healing Potion | action card | action | 8 | nothing | Fully heal one of your hurt dragons. | — |
| War Horn | action card | action | 6 | 1 crystal | Hold 1 more raid this round. | — |
| Secret Hoard | action card | action | 4 | nothing | Worth 2 points while in your hand. | 2 |
| Rouse the Bear | action card | action | 8 | 1 crystal | Place a Cave Bear on any land hex with no tower or beast. | — |
| Wake the Basilisk | action card | action | 4 | 1 crystal | Place a Basilisk on any land hex with no tower or beast. | — |
| Fire Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | fire, grows a stage every 2 rounds | — |
| Ice Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | ice, grows a stage every 2 rounds | — |
| Lightning Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | lightning, grows a stage every 2 rounds | — |
| Air Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | air, grows a stage every 2 rounds | — |
| Water Dragon | base dragon | action | 2 | 6 crystal, 4 livestock | water, grows a stage every 2 rounds | — |
| Ember Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | fire, grows a stage every 3 rounds | — |
| Cinder Drake | dragon card | action | 2 | 8 crystal, 4 livestock | fire, grows a stage every 2 rounds | — |
| Frost Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | ice, grows a stage every 3 rounds | — |
| Rime Drake | dragon card | action | 2 | 8 crystal, 4 livestock | ice, grows a stage every 2 rounds | — |
| Storm Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | lightning, grows a stage every 3 rounds | — |
| Bolt Drake | dragon card | action | 2 | 8 crystal, 4 livestock | lightning, grows a stage every 2 rounds | — |
| Sky Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | air, grows a stage every 3 rounds | — |
| Zephyr Drake | dragon card | action | 2 | 8 crystal, 4 livestock | air, grows a stage every 2 rounds | — |
| Abyss Wyrm | dragon card | action | 2 | 8 crystal, 4 livestock, 2 gold | water, grows a stage every 3 rounds | — |
| Reef Drake | dragon card | action | 2 | 8 crystal, 4 livestock | water, grows a stage every 2 rounds | — |

## Basic production buildings

Anyone may build these, no card needed.

| Building | Terrain | Cost | Makes each round |
|---|---|---|---|
| Quarry | mountain | 4 timber, 4 crystal, 3 livestock | d4 stone (avg 2.5) |
| Lumber Camp | forest | 4 stone, 4 crystal, 3 livestock | d4 timber (avg 2.5) |
| Crystal Mine | crystal field | 4 stone, 4 timber, 3 livestock | d4 crystal (avg 2.5) |
| Pasture | meadow | 3 stone, 4 timber, 4 crystal | d4 livestock (avg 2.5) |

Workshop (4 stone, 4 timber, 2 crystal): makes 2 more a round.

## Land

The land is ringed by ocean, where nothing is built. Each of its six coasts has one natural harbor at a random spot between its corners; ports go only on harbors. Land: 2p radius 4 (61 land hexes), 3p radius 4 (61 land hexes), 4p radius 5 (91 land hexes). Terrain shares are of the random land, before towers and harbors are placed.

| Terrain | For | Share of land |
|---|---|---|
| mountain | Quarry | 20% |
| forest | Lumber Camp | 20% |
| crystal field | Crystal Mine | 20% |
| meadow | Pasture | 20% |
| plains | — | 20% |
| harbor | Stone Port, Timber Port, Crystal Port, Livestock Port | coast |

## Building cards that count their neighbours

Each effect is multiplied by how many of the building's six neighbouring hexes count: hexes of a terrain (built on or not), or buildings of a class, whoever owns them unless the card says yours (the tower is a monument and a dragon building).

| Card | Class | Counts | Cost | Each one adds |
|---|---|---|---|---|
| Cliff Works | stone building | mountain hexes | 3 timber, 3 crystal, 2 livestock | 1 stone a round |
| Stonemason | stone building | stone buildings (anyone's) | 3 timber, 3 crystal, 2 livestock | 1 stone a round |
| Woodcutter's Hut | timber building | forest hexes | 3 stone, 3 crystal, 2 livestock | 1 timber a round |
| Sawmill | timber building | timber buildings (anyone's) | 3 stone, 3 crystal, 2 livestock | 1 timber a round |
| Driftwood Yard | timber building | ocean hexes | 4 stone, 3 crystal, 3 livestock | 1 timber a round |
| Crystal Spire | crystal building | crystal field hexes | 3 stone, 3 timber, 2 livestock | 1 crystal a round |
| Gem Cutter | crystal building | crystal buildings (anyone's) | 3 stone, 3 timber, 2 livestock | 1 crystal a round |
| Smelter | crystal building | stone buildings (anyone's) | 2 stone, 3 timber, 3 livestock | 1 crystal a round |
| Shepherd's Fold | livestock building | meadow hexes | 3 stone, 3 timber, 2 crystal | 1 livestock a round |
| Drovers' Barn | livestock building | livestock buildings (anyone's) | 2 stone, 3 timber, 3 crystal | 1 livestock a round |
| Fishery | livestock building | ocean hexes | 3 stone, 4 timber, 3 crystal | 1 livestock a round |
| Market | trade building | production buildings (your own), up to 3 | 6 stone, 6 timber, 6 crystal, 4 gold | 1 gold a round |

## Points

Every way to buy points. Building points are flat: they never count what's adjacent. Dragons are worth no points. Great beasts are worth their points to whoever slays them (see Great beasts).

| Source | Pays | Points | Pays per point | Ready |
|---|---|---|---|---|
| Quarry | 4 timber, 4 crystal, 3 livestock | 1 | 4 timber, 4 crystal, 3 livestock | now, and makes resources |
| Lumber Camp | 4 stone, 4 crystal, 3 livestock | 1 | 4 stone, 4 crystal, 3 livestock | now, and makes resources |
| Crystal Mine | 4 stone, 4 timber, 3 livestock | 1 | 4 stone, 4 timber, 3 livestock | now, and makes resources |
| Pasture | 3 stone, 4 timber, 4 crystal | 1 | 3 stone, 4 timber, 4 crystal | now, and makes resources |
| Cliff Works | 3 timber, 3 crystal, 2 livestock | 1 | 3 timber, 3 crystal, 2 livestock | now, and makes resources |
| Stonemason | 3 timber, 3 crystal, 2 livestock | 1 | 3 timber, 3 crystal, 2 livestock | now, and makes resources |
| Woodcutter's Hut | 3 stone, 3 crystal, 2 livestock | 1 | 3 stone, 3 crystal, 2 livestock | now, and makes resources |
| Sawmill | 3 stone, 3 crystal, 2 livestock | 1 | 3 stone, 3 crystal, 2 livestock | now, and makes resources |
| Driftwood Yard | 4 stone, 3 crystal, 3 livestock | 1 | 4 stone, 3 crystal, 3 livestock | now, and makes resources |
| Crystal Spire | 3 stone, 3 timber, 2 livestock | 1 | 3 stone, 3 timber, 2 livestock | now, and makes resources |
| Gem Cutter | 3 stone, 3 timber, 2 livestock | 1 | 3 stone, 3 timber, 2 livestock | now, and makes resources |
| Smelter | 2 stone, 3 timber, 3 livestock | 1 | 2 stone, 3 timber, 3 livestock | now, and makes resources |
| Shepherd's Fold | 3 stone, 3 timber, 2 crystal | 1 | 3 stone, 3 timber, 2 crystal | now, and makes resources |
| Drovers' Barn | 2 stone, 3 timber, 3 crystal | 1 | 2 stone, 3 timber, 3 crystal | now, and makes resources |
| Fishery | 3 stone, 4 timber, 3 crystal | 1 | 3 stone, 4 timber, 3 crystal | now, and makes resources |
| Monument, adjacent to a monument | 6 stone, 5 timber | 2 | 3 stone, 2.5 timber | now |
| Standing Stones, adjacent to a crystal field hex | 5 stone, 6 crystal | 2 | 2.5 stone, 3 crystal | now |
| Lighthouse, adjacent to an ocean hex | 7 stone, 4 timber | 2 | 3.5 stone, 2 timber | now |
| Guildhall, adjacent to a trade building | 5 stone, 6 timber | 2 | 2.5 stone, 3 timber | now |
| Secret Hoard (action card) | nothing | 2 | nothing | now, uses a hand slot |

Titles: 7 points each, for most combat power across your dragons (at least 55; a dragon counts its stage's power, as in Dragons, hurt or not, eggs 0), most tower floors (at least 4) and most gold (at least 20). Tower floors are worth no other points (each houses 1 more dragon); gold held is worth points only through Largest Hoard.

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

The element wheel, for everything that fights (dragons, defenders, fauna, great beasts), whichever side strikes: a hit from an element that beats what it hits deals double damage. That's the only element effect. Neutral beats nothing, and nothing beats it.

| Element | Beats | Weak to |
|---|---|---|
| fire | ice | water |
| ice | air | fire |
| lightning | water | air |
| air | lightning | ice |
| water | fire | lightning |
| neutral | — | — |

## Raids

Defenders:

| Unit | Power | Health | Attack (avg) | Element |
|---|---|---|---|---|
| Militia | 4 | 5 | 1×1d4 (2.5) | neutral |
| Archers | 5 | 6 | 1×1d6 (3.5) | neutral |
| Knights | 7 | 12 | 1×1d8 (4.5) | neutral |
| Frost Golem | 7 | 16 | 1×1d6 (3.5) | ice |
| Storm Griffin | 7 | 10 | 1×1d8 (4.5) | air |
| Sea Serpent | 8 | 14 | 2×1d4 (5) | water |

Combat power is √(health × average damage a combat round), rounded; a kingdom's is its defenders' summed, and raiders' powers add up the same way. It ignores elements and targeting, so it is a rough guide on purpose.

Kingdoms (all are on the ballot each raid; average damage is the defenders' total a combat round). Loot is the printed loot below plus the gold the kingdom has hoarded: after every raid, each kingdom that didn't fall adds 1 gold, and the one that fell goes back to its printed loot. Shared loot is split by the combat power each player still has fighting at the end (each resource rounded down; what's left over is handed out 1 at a time, the most power first and equal powers in the round's turn order, carrying on from one resource to the next).

| Kingdom | Defenders | Power | Total health | Avg damage a round | Loot |
|---|---|---|---|---|---|
| Hamlet of Brindle | Militia, Militia | **8** | 10 | 5 | 2 livestock, 1 gold |
| Archer's Hold | Archers, Archers, Archers, Militia | **19** | 23 | 13 | 4 timber, 4 gold |
| Frostpeak | Frost Golem, Frost Golem, Archers, Archers | **24** | 44 | 14 | 4 crystal, 7 gold |
| Knightsgate | Knights, Knights, Knights, Knights | **28** | 48 | 18 | 4 stone, 10 gold |
| Stormspire | Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin | **35** | 50 | 22.5 | 17 gold |
| Tidewatch | Sea Serpent, Sea Serpent, Sea Serpent, Knights, Knights, Knights | **45** | 78 | 28.5 | 4 livestock, 27 gold |

Healing: a hurt dragon heals 7 health at each production it's fed, instead of growing. It fights with the health it has left; only a knocked-out one (0 health) can't fight, and its next fed production brings it back. From knocked out to whole, a base dragon takes: hatchling 1, young 2, adult 3 rounds of not growing; the Frost Wyrm, the toughest adult, 5.

## Fauna

Beasts on the map. Nothing is built on a hex with fauna, and a building under fauna produces nothing (a basic production building loses its output). On their turn, any player may send raid-ready dragons against any beast, in the raids' combat; the hits they take stay on them, into the round's raids, as after a raid. If the beast falls, the hex is empty and its loot goes to that player, unless a card placed it: then there is no loot. If not, it stays at full health. In production, each beast has a 1 in 3 chance to move to a random adjacent land hex with no tower or beast; one beside no other beast is twice as likely. New fauna comes only from cards.

| Beast | Health | Attack (avg) | Element | Loot | Starts |
|---|---|---|---|---|---|
| Wolf Pack | 8 | 1×1d6 (3.5) | neutral | 2 livestock | 2 steps from the nearest tower |
| Cave Bear | 16 | 1×1d10 (5.5) | neutral | 4 livestock | 3 steps from the nearest tower |
| Basilisk | 26 | 2×1d8 (9) | neutral | 4 livestock, 2 gold | 4+ steps from the nearest tower |

On the starting map: one beast per 8 land hexes, none within 1 step of a tower.

Cards that send fauna (action cards; see Decks for how often they come):

| Card | Sends | Cost | Copies |
|---|---|---|---|
| Rouse the Bear | Cave Bear | 1 crystal | 8 |
| Wake the Basilisk | Basilisk | 1 crystal | 4 |

## Great beasts

Two on every map, the top tier of the fauna: fought like fauna (on your turn, your dragons, to the end), but each player gets one try at a great beast a round, and it is at full health for every fight. Each holds its hex and every hex next to it: nothing is built there while it lives. The player who slays one scores its points for good; it never comes back. Once the Thunderbird falls, every production building on or next to its peak makes 2 more a round.

| Beast | Health | Attack (avg) | Element | Points | Lives in |
|---|---|---|---|---|---|
| Thunderbird | 70 | 2×2d8 (18) | air | 4 | the mountain peak at the centre |
| Leviathan | 80 | 1×3d10 (16.5) | water | 4 | the ocean beside one harbor |

A single beast takes one hit per dragon a combat round, so a dragon's extra targets don't help here.

When that force exists: a base egg (any element, by special project, or a dragon card of the element) is an adult 6 rounds after it is hatched, 3 with a Hatchery. 

## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy; basic buildings aren't cards and aren't counted), plus where it comes from. Dragon upkeep (1 livestock per dragon a round) comes on top.

| Resource | In all card costs | Share | Comes from |
|---|---|---|---|
| stone | 150 | 18% | tower 1, Quarry, Cliff Works, Stonemason, raid loot (1 of 6 kingdoms) |
| timber | 143 | 17% | tower 1, Lumber Camp, Woodcutter's Hut, Sawmill, Driftwood Yard, raid loot (1 of 6 kingdoms) |
| crystal | 328 | 39% | tower 1, Crystal Mine, Crystal Spire, Gem Cutter, Smelter, raid loot (1 of 6 kingdoms) |
| livestock | 158 | 19% | tower 1, Pasture, Shepherd's Fold, Drovers' Barn, Fishery, raid loot (2 of 6 kingdoms), clearing fauna |
| gold | 62 | 7% | Market, raid loot (6 of 6 kingdoms), clearing fauna |
