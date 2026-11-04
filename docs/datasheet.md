# Tuning datasheet

Generated from `src/data.ts` and the engine by `npm run datasheet`; don't edit by hand. `npm test` fails when it is out of date, so after changing any number, rerun `npm run datasheet` and read the diff: it shows what the change does to costs, points and raid odds.

## Economy baseline

- Start: 3 stone, 3 timber, 3 crystal, 3 livestock. Tower income: 1 stone, 1 timber, 1 crystal, 1 livestock a round, no dice.
- Cards: each round, draw 2 building cards and keep 1, plus 1 action card; hand cap 7. Basic buildings (Quarry, Lumber Camp, Crystal Mine, Pasture, Roost, Tower Floor) need no card.
- Win at 20 points. Titles are 2 points each, from a minimum (see Points).
- Each dragon eats 1 livestock a round, eggs included; the tower makes 1.
- Gold: no basic building makes it. It comes from raids, Markets, Trade Charters, clearing fauna, and the bank.
- Bank: 4:1, 3:1 with a Port.

## Costs

Everything that can be bought, as the game has it. Basic buildings have no copies: anyone may build them, no card needed. Dragon points are hatchling / young / adult.

| Name | Kind | Copies | Cost | Does | Points |
|---|---|---|---|---|---|
| Quarry | basic building | — | 8 timber, 8 crystal, 6 livestock | Makes 1d4 stone each round. | — |
| Lumber Camp | basic building | — | 8 stone, 8 crystal, 6 livestock | Makes 1d4 timber each round. | — |
| Crystal Mine | basic building | — | 8 stone, 8 timber, 6 livestock | Makes 1d4 crystal each round. | — |
| Pasture | basic building | — | 6 stone, 8 timber, 8 crystal | Makes 1d4 livestock each round. | — |
| Roost | basic building | — | 4 stone, 4 timber | Houses 2 more dragons. | — |
| Tower Floor | basic building | — | 6 stone, 4 gold | Adds a floor to your tower. Floors count toward Tallest Tower. | — |
| Cliff Works | building card | 2 | 6 timber, 6 crystal, 4 livestock | Makes 1 stone each round for each adjacent mountain. | — |
| Stonemason | building card | 2 | 6 timber, 6 crystal, 4 livestock | Makes 1 stone each round for each adjacent quarry. | — |
| Woodcutter's Hut | building card | 2 | 6 stone, 6 crystal, 4 livestock | Makes 1 timber each round for each adjacent forest. | — |
| Sawmill | building card | 2 | 6 stone, 6 crystal, 4 livestock | Makes 1 timber each round for each adjacent lumber camp. | — |
| Driftwood Yard | building card | 1 | 8 stone, 6 crystal, 6 livestock | Makes 1 timber each round for each adjacent ocean hex. | — |
| Ley Spire | building card | 2 | 6 stone, 6 timber, 4 livestock | Makes 1 crystal each round for each adjacent ley line. | — |
| Gem Cutter | building card | 2 | 6 stone, 6 timber, 4 livestock | Makes 1 crystal each round for each adjacent mine. | — |
| Smelter | building card | 1 | 4 stone, 6 timber, 6 livestock | Makes 1 crystal each round for each adjacent quarry. | — |
| Shepherd's Fold | building card | 2 | 6 stone, 6 timber, 4 crystal | Makes 1 livestock each round for each adjacent meadow. | — |
| Drovers' Barn | building card | 2 | 4 stone, 6 timber, 6 crystal | Makes 1 livestock each round for each adjacent pasture. | — |
| Fishery | building card | 1 | 6 stone, 8 timber, 6 crystal | Makes 1 livestock each round for each adjacent ocean hex. | — |
| Hatchery | building card | 2 | 6 stone, 6 timber, 6 crystal | Your dragons grow 1 extra step each round. | — |
| Port | building card | 3 | 2 stone, 6 timber, 2 livestock | You trade with the bank at 3:1. | — |
| Market | building card | 2 | 6 stone, 6 timber, 6 crystal, 4 gold | Makes 1 gold each round for each adjacent trade building. | — |
| Monument | building card | 2 | 8 stone, 6 timber, 20 gold | Worth 1 point for each adjacent monument. | 1 each |
| Standing Stones | building card | 2 | 6 stone, 6 crystal, 20 gold | Worth 1 point for each adjacent ley line. | 1 each |
| Lighthouse | building card | 2 | 10 stone, 6 timber, 20 gold | Worth 1 point for each adjacent ocean hex. | 1 each |
| Guildhall | building card | 1 | 6 stone, 6 timber, 20 gold | Worth 1 point for each adjacent trade building. | 1 each |
| Workshop | upgrade | 4 | 8 stone, 8 timber, 2 crystal | This quarry, lumber camp, mine or pasture makes 2 more. | — |
| Nesting Grounds | upgrade | 3 | 4 stone, 2 timber | This roost, hatchery or tower houses 2 more dragons. | — |
| Trade Charter | upgrade | 3 | 4 stone, 8 gold | This port or market makes 1 more gold each round. | — |
| Windfall | action card | 5 | nothing | Gain 3 of one resource other than gold. | — |
| Buried Treasure | action card | 4 | nothing | Gain 2 gold. | — |
| Growth Elixir | action card | 4 | 3 gold | Grow one of your dragons to its next life stage. | — |
| Healing Potion | action card | 3 | nothing | Fully heal one of your hurt dragons. It can raid this round. | — |
| War Horn | action card | 3 | 1 crystal | Hold 1 more raid this round. | — |
| Secret Hoard | action card | 4 | nothing | Worth 1 point while in your hand. | 1 |
| Wolf Call | action card | 2 | 1 crystal, 2 gold | Place a Wolf Pack on any land hex with no tower or beast. | — |
| Rouse the Bear | action card | 1 | 2 crystal, 3 gold | Place a Cave Bear on any land hex with no tower or beast. | — |
| Fire Dragon | base dragon | 1 | 6 crystal, 4 livestock | fire, grows a stage every 2 rounds | 1 / 2 / 3 |
| Ice Dragon | base dragon | 1 | 6 crystal, 4 livestock | ice, grows a stage every 2 rounds | 1 / 2 / 3 |
| Lightning Dragon | base dragon | 1 | 6 crystal, 4 livestock | lightning, grows a stage every 2 rounds | 1 / 2 / 3 |
| Air Dragon | base dragon | 1 | 6 crystal, 4 livestock | air, grows a stage every 2 rounds | 1 / 2 / 3 |
| Water Dragon | base dragon | 1 | 6 crystal, 4 livestock | water, grows a stage every 2 rounds | 1 / 2 / 3 |
| Ember Wyrm | dragon card | 1 | 8 crystal, 4 livestock, 2 gold | fire, grows a stage every 3 rounds | 1 / 2 / 3 |
| Cinder Drake | dragon card | 1 | 8 crystal, 4 livestock | fire, grows a stage every 2 rounds | 1 / 2 / 3 |
| Frost Wyrm | dragon card | 1 | 8 crystal, 4 livestock, 2 gold | ice, grows a stage every 3 rounds | 1 / 2 / 3 |
| Rime Drake | dragon card | 1 | 8 crystal, 4 livestock | ice, grows a stage every 2 rounds | 1 / 2 / 3 |
| Storm Wyrm | dragon card | 1 | 8 crystal, 4 livestock, 2 gold | lightning, grows a stage every 3 rounds | 1 / 2 / 3 |
| Bolt Drake | dragon card | 1 | 8 crystal, 4 livestock | lightning, grows a stage every 2 rounds | 1 / 2 / 3 |
| Sky Wyrm | dragon card | 1 | 8 crystal, 4 livestock, 2 gold | air, grows a stage every 3 rounds | 1 / 2 / 3 |
| Zephyr Drake | dragon card | 1 | 8 crystal, 4 livestock | air, grows a stage every 2 rounds | 1 / 2 / 3 |
| Abyss Wyrm | dragon card | 1 | 8 crystal, 4 livestock, 2 gold | water, grows a stage every 3 rounds | 1 / 2 / 3 |
| Reef Drake | dragon card | 1 | 8 crystal, 4 livestock | water, grows a stage every 2 rounds | 1 / 2 / 3 |

## Basic production buildings

Anyone may build these, no card needed.

| Building | Terrain | Cost | Makes each round |
|---|---|---|---|
| Quarry | mountain | 8 timber, 8 crystal, 6 livestock | d4 stone (avg 2.5) |
| Lumber Camp | forest | 8 stone, 8 crystal, 6 livestock | d4 timber (avg 2.5) |
| Crystal Mine | ley | 8 stone, 8 timber, 6 livestock | d4 crystal (avg 2.5) |
| Pasture | meadow | 6 stone, 8 timber, 8 crystal | d4 livestock (avg 2.5) |

Workshop (8 stone, 8 timber, 2 crystal): makes 2 more a round.

## Land

The land is ringed by ocean, where nothing is built. Each of its six coasts has one natural harbor at a random spot between its corners; ports go only on harbors. Land: 2p radius 4 (61 land hexes), 3p radius 4 (61 land hexes), 4p radius 5 (91 land hexes). Terrain shares are of the random land, before towers and harbors are placed.

Measured on 300 generated maps per player count. Each cell: share of towers with that terrain on a touching hex / average number of such hexes within 2 steps of the tower.

| Terrain | For | Share of land | 2 players | 3 players | 4 players |
|---|---|---|---|---|---|
| mountain | Quarry | 20% | 75% / 2.4 | 75% / 2.4 | 74% / 2.4 |
| forest | Lumber Camp | 20% | 76% / 2.5 | 77% / 2.4 | 73% / 2.4 |
| ley | Crystal Mine | 20% | 75% / 2.4 | 75% / 2.4 | 74% / 2.4 |
| meadow | Pasture | 20% | 71% / 2.4 | 72% / 2.4 | 76% / 2.4 |
| plains | — | 20% | 72% / 2.4 | 75% / 2.5 | 74% / 2.4 |
| harbor | Port | coast | 0% / 1 | 0% / 1 | 0% / 0.8 |

## Shortages

What a player's own land can't make, they have to trade for. Measured on the same maps as Land, counting production terrain within 2 steps of each tower. If shortages were fully independent between players, two players would share their scarcest resource 25% of the time.

| Players | Players with no land for some resource | Two players share their scarcest resource | Scarcest resource, how often |
|---|---|---|---|
| 2 | 24% | 24% | stone 24%, timber 24%, crystal 25%, livestock 27% |
| 3 | 25% | 26% | stone 24%, timber 25%, crystal 23%, livestock 27% |
| 4 | 23% | 26% | stone 25%, timber 24%, crystal 25%, livestock 26% |

Harbors (for ports, the only way to beat the bank's 4:1):

| Players | Harbor touching the tower | Harbor within 2 steps | Average steps to the nearest harbor |
|---|---|---|---|
| 2 | 0% | 73% | 2.3 |
| 3 | 0% | 74% | 2.3 |
| 4 | 0% | 67% | 2.3 |

## Building cards that count their neighbours

Each effect is multiplied by how many of the building's six neighbouring hexes count: hexes of a terrain (built on or not), or buildings of a class, whoever owns them (the tower is a monument and a dragon building). "Map" is for 3 players: the best count on an open hex touching a tower / share of land hexes with 2 or more.

| Card | Class | Counts | Cost | Each one adds | Map |
|---|---|---|---|---|---|
| Cliff Works | quarry | mountain hexes | 6 timber, 6 crystal, 4 livestock | 1 stone a round | 1.6 / 25% |
| Stonemason | quarry | quarries (anyone's) | 6 timber, 6 crystal, 4 livestock | 1 stone a round | built |
| Woodcutter's Hut | lumber camp | forest hexes | 6 stone, 6 crystal, 4 livestock | 1 timber a round | 1.6 / 22% |
| Sawmill | lumber camp | lumber camps (anyone's) | 6 stone, 6 crystal, 4 livestock | 1 timber a round | built |
| Driftwood Yard | lumber camp | ocean hexes | 8 stone, 6 crystal, 6 livestock | 1 timber a round | 3 / 39% |
| Ley Spire | mine | ley hexes | 6 stone, 6 timber, 4 livestock | 1 crystal a round | 1.6 / 20% |
| Gem Cutter | mine | mines (anyone's) | 6 stone, 6 timber, 4 livestock | 1 crystal a round | built |
| Smelter | mine | quarries (anyone's) | 4 stone, 6 timber, 6 livestock | 1 crystal a round | built |
| Shepherd's Fold | pasture | meadow hexes | 6 stone, 6 timber, 4 crystal | 1 livestock a round | 1.6 / 20% |
| Drovers' Barn | pasture | pastures (anyone's) | 4 stone, 6 timber, 6 crystal | 1 livestock a round | built |
| Fishery | pasture | ocean hexes | 6 stone, 8 timber, 6 crystal | 1 livestock a round | 3 / 39% |
| Market | trade building | trade buildings (anyone's) | 6 stone, 6 timber, 6 crystal, 4 gold | 1 gold a round | built |
| Monument | monument | monuments (anyone's) | 8 stone, 6 timber, 20 gold | 1 point | built |
| Standing Stones | monument | ley hexes | 6 stone, 6 crystal, 20 gold | 1 point | 1.6 / 20% |
| Lighthouse | monument | ocean hexes | 10 stone, 6 timber, 20 gold | 1 point | 3 / 39% |
| Guildhall | monument | trade buildings (anyone's) | 6 stone, 6 timber, 20 gold | 1 point | built |

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

Titles: 2 points each, for most dragon points (at least 10) and most tower floors (at least 4). Tower floors are worth nothing else.

## Dragons

Each stage: combat power (see Raids), health, targets × dice (average damage a combat round, before elements).

| Dragon | Element | Cost | Growth time | Targets | Hatchling | Young | Adult |
|---|---|---|---|---|---|---|---|
| Base dragon (any element) | any | 6 crystal, 4 livestock | 2 | random | **5**: 6hp 1×1d6 (3.5) | **9**: 12hp 1×2d6 (7) | **17**: 20hp 2×2d6 (14) |
| Ember Wyrm | fire | 8 crystal, 4 livestock, 2 gold | 3 | weak_to_me | **6**: 7hp 1×1d8 (4.5) | **11**: 14hp 1×2d8 (9) | **25**: 24hp 2×3d8 (27) |
| Cinder Drake | fire | 8 crystal, 4 livestock | 2 | lowest_health | **5**: 6hp 1×1d6 (3.5) | **9**: 11hp 2×1d6 (7) | **16**: 18hp 3×1d8 (13.5) |
| Frost Wyrm | ice | 8 crystal, 4 livestock, 2 gold | 3 | strongest_attacker | **6**: 9hp 1×1d6 (3.5) | **11**: 17hp 1×2d6 (7) | **20**: 30hp 1×3d8 (13.5) |
| Rime Drake | ice | 8 crystal, 4 livestock | 2 | weak_to_me | **5**: 6hp 1×1d6 (3.5) | **9**: 12hp 1×2d6 (7) | **19**: 20hp 2×2d8 (18) |
| Storm Wyrm | lightning | 8 crystal, 4 livestock, 2 gold | 3 | random | **5**: 6hp 2×1d4 (5) | **11**: 12hp 3×1d6 (10.5) | **19**: 20hp 4×1d8 (18) |
| Bolt Drake | lightning | 8 crystal, 4 livestock | 2 | strongest_attacker | **5**: 5hp 1×1d8 (4.5) | **9**: 10hp 1×2d8 (9) | **19**: 20hp 1×4d8 (18) |
| Sky Wyrm | air | 8 crystal, 4 livestock, 2 gold | 3 | lowest_health | **5**: 6hp 1×1d6 (3.5) | **11**: 13hp 2×1d8 (9) | **20**: 22hp 2×2d8 (18) |
| Zephyr Drake | air | 8 crystal, 4 livestock | 2 | random | **4**: 5hp 1×1d6 (3.5) | **8**: 10hp 2×1d6 (7) | **13**: 17hp 3×1d6 (10.5) |
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

Combat power is √(health × average damage a combat round), rounded; a kingdom's is its defenders' summed, and raiders' powers add up the same way (Lanchester's square law). It ignores elements and targeting, so it is a rough guide on purpose: compare it with the odds below.

Kingdoms (all are on the ballot each raid; average damage is the defenders' total a combat round). Loot is the printed loot below plus the gold the kingdom has hoarded: after every raid, each kingdom that didn't fall adds 1 gold, and the one that fell goes back to its printed loot:

| Kingdom | Defenders | Power | Total health | Avg damage a round | Loot |
|---|---|---|---|---|---|
| Hamlet of Brindle | Militia, Militia | **8** | 10 | 5 | 2 livestock, 1 gold |
| Archer's Hold | Archers, Archers, Archers, Militia | **19** | 23 | 13 | 4 timber, 4 gold |
| Frostpeak | Frost Golem, Frost Golem, Archers, Archers | **24** | 44 | 14 | 4 crystal, 7 gold |
| Knightsgate | Knights, Knights, Knights, Knights | **28** | 48 | 18 | 4 stone, 10 gold |
| Stormspire | Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin | **35** | 50 | 22.5 | 17 gold |
| Tidewatch | Sea Serpent, Sea Serpent, Sea Serpent, Knights, Knights, Knights | **45** | 78 | 28.5 | 4 livestock, 27 gold |

Chance the kingdom falls to one player's raiders fighting to the end, from 100 raids through the engine per cell. Base dragon rows average the five elements, with the worst and best element in brackets. Power is in brackets after each raider.

| Raider | Hamlet of Brindle | Archer's Hold | Frostpeak | Knightsgate | Stormspire | Tidewatch |
|---|---|---|---|---|---|---|
| Base dragon, hatchling (5) | 35% (18%–70%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) |
| Base dragon, young (9) | 99% (98%–100%) | 1% (0%–3%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) |
| Base dragon, adult (17) | 100% (100%–100%) | 93% (89%–99%) | 21% (0%–64%) | 14% (0%–67%) | 6% (0%–32%) | 0% (0%–0%) |
| Two young base dragons (18) | 100% | 97% | 29% | 16% | 8% | 0% |
| Ember Wyrm (fire), adult (25) | 100% | 100% | 99% | 0% | 58% | 0% |
| Cinder Drake (fire), adult (16) | 100% | 86% | 42% | 0% | 0% | 0% |
| Frost Wyrm (ice), adult (20) | 100% | 98% | 2% | 21% | 0% | 0% |
| Rime Drake (ice), adult (19) | 100% | 98% | 1% | 14% | 44% | 0% |
| Storm Wyrm (lightning), adult (19) | 100% | 94% | 22% | 80% | 0% | 2% |
| Bolt Drake (lightning), adult (19) | 100% | 71% | 23% | 15% | 0% | 0% |
| Sky Wyrm (air), adult (20) | 100% | 100% | 88% | 17% | 0% | 0% |
| Zephyr Drake (air), adult (13) | 100% | 95% | 3% | 0% | 0% | 0% |
| Abyss Wyrm (water), adult (22) | 100% | 100% | 11% | 25% | 20% | 0% |
| Reef Drake (water), adult (17) | 100% | 93% | 0% | 0% | 0% | 0% |

Gold a lone base dragon expects from one raid on the kingdom that pays it best (if its vote wins), by how much extra gold the kingdoms have hoarded. A Monument takes 20 gold.

| Hoarded | Hatchling | Young | Adult |
|---|---|---|---|
| none (printed loot) | 0.4 (Hamlet of Brindle) | 1 (Hamlet of Brindle) | 3.7 (Archer's Hold) |
| 3 gold each | 1.4 (Hamlet of Brindle) | 4 (Hamlet of Brindle) | 6.5 (Archer's Hold) |
| 6 gold each | 2.4 (Hamlet of Brindle) | 6.9 (Hamlet of Brindle) | 9.3 (Archer's Hold) |

Shared raids: loot is split by the combat power each player still has fighting at the end (each resource rounded down, and what's left over goes to the player with the most power). Here one player carries the raid with two base adults (34 power), and a second tags along with a base hatchling (5). Base dragons' elements vary from raid to raid. Takes are averages, losses included, from 400 raids each.

| Kingdom | Loot | Falls: alone → with the tag-along | Carrier alone takes | Carrier takes, shared | Tag-along takes | Tag-along if it falls and the hatchling stands | Raid rounds the hatchling then misses |
|---|---|---|---|---|---|---|---|
| Hamlet of Brindle (8) | 2 livestock, 1 gold | 100% → 100% | 2 livestock, 1 gold | 2 livestock, 1 gold | nothing | about nothing | 0 |
| Stormspire (35) | 17 gold | 67% → 82% | 11.4 gold | 13.1 gold | 0.8 gold | about 2 gold | 0.8 |

Healing: a hurt dragon heals 7 health at each production and sits out every round's raids until it is whole, so it misses one raid round per 7 damage, rounded up. Knocked out (0 health), a base dragon is out: hatchling 1, young 2, adult 3 rounds; the Frost Wyrm, the toughest adult, 5.

Being bailed on, from 400 raids each (elements varying): two players each send a base adult to Knightsgate (power 28). If both fight, it falls 92% of the time, each takes 1.8 stone, 4.5 gold, and each dragon misses 1.8 raid rounds on average. If one secretly bails, the one left alone wins 14% of the time, takes 0.6 stone, 1.4 gold, and misses 2.9 raid rounds.

## Fauna

Beasts on the map. Nothing is built on a hex with fauna, and a building under fauna produces nothing (a basic production building loses its output). On their turn, any player may send raid-ready dragons against any beast, in the raids' combat; those dragons sit out the round's raids, and one that takes a hit sits out the next round's too, as after a raid. If the beast falls, the hex is free and its loot goes to that player; if not, it stays at full health. New fauna comes only from cards.

| Beast | Health | Attack (avg) | Strong vs | Weak vs | Loot | Starts |
|---|---|---|---|---|---|---|
| Wolf Pack | 8 | 1×1d6 (3.5) | — | fire | 2 livestock | 2 steps from the nearest tower |
| Cave Bear | 16 | 1×1d10 (5.5) | ice | lightning | 4 livestock | 3 steps from the nearest tower |
| Basilisk | 26 | 2×1d8 (9) | fire, lightning | water, ice | 4 livestock, 2 gold | 4+ steps from the nearest tower |

Chance the beast falls, from 100 fights through the engine per cell, averaged over the five base dragons' elements (worst–best element in brackets):

| Dragons sent | Wolf Pack | Cave Bear | Basilisk |
|---|---|---|---|
| One hatchling | 56% (45%–90%) | 5% (0%–21%) | 0% (0%–0%) |
| One young | 100% (100%–100%) | 59% (2%–100%) | 20% (0%–55%) |
| One adult | 100% (100%–100%) | 85% (32%–100%) | 39% (0%–89%) |
| Two young | 100% (100%–100%) | 100% (100%–100%) | 63% (10%–100%) |
| Two adults | 100% (100%–100%) | 100% (100%–100%) | 90% (73%–100%) |

On the starting map (one beast per 8 land hexes, none within 1 step of a tower), on average:

| Players | Land hexes | Wolf Pack | Cave Bear | Basilisk |
|---|---|---|---|---|
| 2 | 61 | 2.4 | 2.4 | 3.1 |
| 3 | 61 | 4.5 | 2.8 | 0.7 |
| 4 | 91 | 5.1 | 3.6 | 2.3 |

Cards that send fauna (action cards; see Decks for how often they come):

| Card | Sends | Cost | Copies |
|---|---|---|---|
| Wolf Call | Wolf Pack | 1 crystal, 2 gold | 2 |
| Rouse the Bear | Cave Bear | 2 crystal, 3 gold | 1 |

## Great beasts

Two on every map, the top tier of the fauna: fought like fauna (on your turn, your dragons, to the end, and they sit out the round's raids), but each player gets one try at a great beast a round, and it is at full health for every fight. Each holds its hex and every hex next to it: nothing is built there while it lives. The player who slays one scores its points for good; it never comes back. Once the Thunderbird falls, every production building on or next to its peak makes 2 more a round.

| Beast | Health | Attack (avg) | Strong vs | Weak vs | Points | Lives in |
|---|---|---|---|---|---|---|
| Thunderbird | 70 | 2×2d8 (18) | lightning, air, water | ice | 2 | the mountain peak at the centre |
| Leviathan | 80 | 1×3d10 (16.5) | water, fire, ice | lightning | 2 | the ocean beside one harbor |

Chance it falls, from 200 fights through the engine per cell. "Weakness" is base dragons of the element it is weak to; "other" averages the other four elements (worst–best in brackets). A single beast takes one hit per dragon a combat round, so a dragon's extra targets don't help here.

| Dragons sent | Thunderbird, weakness | Thunderbird, other | Leviathan, weakness | Leviathan, other |
|---|---|---|---|---|
| Two young | 10% | 0% (0%–0%) | 4% | 0% (0%–0%) |
| One adult | 0% | 0% (0%–0%) | 0% | 0% (0%–0%) |
| Two adults | 47% | 0% (0%–0%) | 48% | 0% (0%–0%) |
| Three adults | 100% | 13% (0%–54%) | 98% | 12% (0%–48%) |
| Four adults | 100% | 33% (9%–100%) | 100% | 34% (10%–100%) |

Frost Wyrm adult with a base adult of its element: 99% against the Thunderbird; Rime Drake adult with a base adult of its element: 70% against the Thunderbird. Storm Wyrm adult with a base adult of its element: 23% against the Leviathan; Bolt Drake adult with a base adult of its element: 93% against the Leviathan.

When that force exists: a base egg (any element, by special project, or a dragon card of the element) is an adult 6 rounds after it is hatched, 3 with a Hatchery. Two adults of a beast's weakness, hatched in rounds 2–4, are ready in rounds 8–10; the bot games under Game length show when beasts fall with random play.

## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy; basic buildings aren't cards and aren't counted), plus where it comes from. Dragon upkeep (1 livestock per dragon a round) comes on top.

| Resource | In all card costs | Share | Comes from |
|---|---|---|---|
| stone | 226 | 23% | tower 1, Quarry, Cliff Works, Stonemason, raid loot (1 of 6 kingdoms) |
| timber | 196 | 20% | tower 1, Lumber Camp, Woodcutter's Hut, Sawmill, Driftwood Yard, raid loot (1 of 6 kingdoms) |
| crystal | 241 | 24% | tower 1, Crystal Mine, Ley Spire, Gem Cutter, Smelter, raid loot (1 of 6 kingdoms) |
| livestock | 126 | 13% | tower 1, Pasture, Shepherd's Fold, Drovers' Barn, Fishery, raid loot (2 of 6 kingdoms), clearing fauna |
| gold | 201 | 20% | Market, Trade Charter, raid loot (6 of 6 kingdoms), clearing fauna |

## Decks

Building deck 43 cards (18 buildings, 3 upgrades), action deck 41. Last column: chance a player draws at least one (to keep or pass over) within 5 rounds. A player draws at least one upgrade in their first 2 rounds 67% of the time.

| Card | Deck | Copies | Share of deck | By round 5 |
|---|---|---|---|---|
| Cliff Works | building | 2 | 5% | 42% |
| Stonemason | building | 2 | 5% | 42% |
| Woodcutter's Hut | building | 2 | 5% | 42% |
| Sawmill | building | 2 | 5% | 42% |
| Driftwood Yard | building | 1 | 2% | 23% |
| Ley Spire | building | 2 | 5% | 42% |
| Gem Cutter | building | 2 | 5% | 42% |
| Smelter | building | 1 | 2% | 23% |
| Shepherd's Fold | building | 2 | 5% | 42% |
| Drovers' Barn | building | 2 | 5% | 42% |
| Fishery | building | 1 | 2% | 23% |
| Hatchery | building | 2 | 5% | 42% |
| Port | building | 3 | 7% | 56% |
| Market | building | 2 | 5% | 42% |
| Monument | building | 2 | 5% | 42% |
| Standing Stones | building | 2 | 5% | 42% |
| Lighthouse | building | 2 | 5% | 42% |
| Guildhall | building | 1 | 2% | 23% |
| Workshop | building deck (upgrade) | 4 | 9% | 67% |
| Nesting Grounds | building deck (upgrade) | 3 | 7% | 56% |
| Trade Charter | building deck (upgrade) | 3 | 7% | 56% |
| Windfall | action | 5 | 12% | 50% |
| Buried Treasure | action | 4 | 10% | 42% |
| Growth Elixir | action | 4 | 10% | 42% |
| Healing Potion | action | 3 | 7% | 33% |
| War Horn | action | 3 | 7% | 33% |
| Secret Hoard | action | 4 | 10% | 42% |
| Wolf Call | action | 2 | 5% | 23% |
| Rouse the Bear | action | 1 | 2% | 12% |
| Any upgrade (3 kinds) | building deck (upgrade) | 10 | 23% | 95% |
| Any dragon (15 kinds) | action | 15 | 37% | 91% |

## Game length (random bots)

30 games per player count between the random bot (`src/bot.ts`). Random bots play badly, so this is a sanity check on pace, not a prediction.

Army held and Tower held: share of games that end with someone holding each title (it needs 10 dragon points or 4 tower floors).

The bots try a great beast now and then once they have three grown dragons ready, whatever their elements; the last columns are the share of games in which each beast fell, and when.

| Players | Fewest rounds | Median | Most | Stalled | Army held | Tower held | Thunderbird slain | Leviathan slain |
|---|---|---|---|---|---|---|---|---|
| 2 | 38 | 66 | 112 | 0 | 100% | 97% | 73%, median round 55 | 63%, median round 50 |
| 3 | 35 | 62 | 89 | 0 | 100% | 97% | 80%, median round 51 | 83%, median round 51 |
| 4 | 37 | 60 | 78 | 0 | 100% | 100% | 90%, median round 50 | 77%, median round 47 |
