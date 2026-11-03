# Tuning datasheet

Generated from `src/data.ts` and the engine by `npm run datasheet`; don't edit by hand. `npm test` fails when it is out of date, so after changing any number, rerun `npm run datasheet` and read the diff: it shows what the change does to payback, cost per point and raid odds.

## Economy baseline

Yardstick for every "value" below: 1 per stone, timber, crystal or livestock, and 4 per gold (the bank's 4:1 price for it). Gold comes only from raids and Trade Charters.

- Start: 3 stone, 3 timber, 3 crystal, 3 livestock (value 12). Tower income: 1 stone, 1 timber, 1 crystal, 1 livestock a round (value 4), no dice.
- Cards: 2 building + 1 action a round; hand cap 7.
- Win at 15 points. Titles are 2 points each, from a minimum (see Points).
- Each dragon eats 1 livestock a round, eggs included; the tower makes 1.
- Bank: 4:1, 3:1 with a Port.

## Production buildings

Payback = value of the cost ÷ average output a round. ⚠ marks under 2 rounds.

| Building | Terrain | Cost | Value | Output a round | Payback (card) | Payback (special project) | Payback with Workshop |
|---|---|---|---|---|---|---|---|
| Quarry | mountain | 3 timber, 2 crystal, 3 livestock | 8 | d6 stone (avg 3.5) | 2.3 | 4.6 | 2.5 |
| Lumber Camp | forest | 3 stone, 3 crystal, 2 livestock | 8 | d6 timber (avg 3.5) | 2.3 | 4.6 | 2.5 |
| Crystal Mine | ley | 3 stone, 3 timber, 2 livestock | 8 | d6 crystal (avg 3.5) | 2.3 | 4.6 | 2.5 |
| Pasture | meadow | 2 stone, 3 timber, 3 crystal | 8 | d6 livestock (avg 3.5) | 2.3 | 4.6 | 2.5 |

Workshop (2 timber, 1 gold, value 6) adds 2 a round: it pays for itself in 3 rounds on its own.

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

## Dragon and trade buildings and upgrades

| Card | Kind | Cost | Value | Special project value | Does |
|---|---|---|---|---|---|
| Roost | building | 2 stone, 2 timber | 4 | 8 | Houses 2 more dragons. |
| Hatchery | building | 2 stone, 2 timber, 2 crystal | 6 | — | Your growing dragons grow one extra step each round. |
| Port | building | 1 stone, 3 timber, 1 livestock | 5 | — | You trade with the bank at 3:1. Saves 1 per resource bought vs the bank: pays back after buying 5. |
| Nesting Grounds | upgrade (dragon) | 1 stone, 1 gold | 5 | — | This roost, hatchery or tower houses 2 more dragons. |
| Trade Charter | upgrade (trade) | 1 crystal, 2 gold | 9 | — | This port produces 1 gold each round. Pays back in 2.3 rounds. |

## Points

Value per point = value of everything paid ÷ points. Dragon costs include the livestock eaten while growing, from egg, without a hatchery; an adult keeps eating 1 a round. The tower alone makes 4 value a round, so a point at value V takes V ÷ 4 rounds of tower income.

| Source | Pays | Points | Value per point | Ready |
|---|---|---|---|---|
| Tower Floor | 3 stone, 2 timber, 1 gold | 1 | 9 | now |
| Monument | 4 stone, 2 timber, 2 gold | 2 | 7 | now |
| Gilding (upgrade) | 3 gold | 2 | 6 | now |
| Secret Hoard (action card) | nothing | 1 | 0 | now, uses a hand slot |
| Base whelp, hatchling | 2 crystal, 1 livestock + 2 livestock | 1 | 5 | 2 rounds |
| Base whelp, young | 2 crystal, 1 livestock + 4 livestock | 2 | 3.5 | 4 rounds |
| Base whelp, adult | 2 crystal, 1 livestock + 6 livestock | 4 | 2.3 | 6 rounds |
| Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, hatchling | 3 crystal, 1 livestock, 1 gold + 3 livestock | 1 | 11 | 3 rounds |
| Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, young | 3 crystal, 1 livestock, 1 gold + 6 livestock | 2 | 7 | 6 rounds |
| Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, adult | 3 crystal, 1 livestock, 1 gold + 9 livestock | 4 | 4.3 | 9 rounds |
| Cinder Drake, Rime Drake, Bolt Drake, Reef Drake, hatchling | 3 crystal, 1 livestock + 2 livestock | 1 | 6 | 2 rounds |
| Cinder Drake, Rime Drake, Bolt Drake, Reef Drake, young | 3 crystal, 1 livestock + 4 livestock | 2 | 4 | 4 rounds |
| Cinder Drake, Rime Drake, Bolt Drake, Reef Drake, adult | 3 crystal, 1 livestock + 6 livestock | 4 | 2.5 | 6 rounds |
| Zephyr Drake, hatchling | 3 crystal, 1 livestock + 1 livestock | 1 | 5 | 1 round |
| Zephyr Drake, young | 3 crystal, 1 livestock + 2 livestock | 2 | 3 | 2 rounds |
| Zephyr Drake, adult | 3 crystal, 1 livestock + 3 livestock | 4 | 1.8 | 3 rounds |
| Base whelp by special project, adult | 4 crystal, 2 livestock + 6 livestock | 4 | 3 | 6 rounds |

Cheapest paid point: Zephyr Drake, adult at 1.8. Dearest: Ember Wyrm, Frost Wyrm, Storm Wyrm, Sky Wyrm, Abyss Wyrm, hatchling at 11, 6.1× as much.

With a Hatchery (+1 growth a round), a growth-time-2 dragon reaches adult in 3 rounds instead of 6.

Titles: 2 points each, for most dragon points (at least 8), most tower floors (at least 3) and most buildings, tower included (at least 7).

## Dragons

Each stage: health, targets × dice (average damage a combat round, before elements).

| Dragon | Element | Cost | Growth time | Targets | Hatchling | Young | Adult |
|---|---|---|---|---|---|---|---|
| Base whelp (any element) | any | 2 crystal, 1 livestock | 2 | random | 6hp 1×1d6 (3.5) | 12hp 1×2d6 (7) | 20hp 2×2d6 (14) |
| Ember Wyrm | fire | 3 crystal, 1 livestock, 1 gold | 3 | weak_to_me | 7hp 1×1d8 (4.5) | 14hp 1×2d8 (9) | 24hp 2×3d8 (27) |
| Cinder Drake | fire | 3 crystal, 1 livestock | 2 | lowest_health | 6hp 1×1d6 (3.5) | 11hp 2×1d6 (7) | 18hp 3×1d8 (13.5) |
| Frost Wyrm | ice | 3 crystal, 1 livestock, 1 gold | 3 | strongest_attacker | 9hp 1×1d6 (3.5) | 17hp 1×2d6 (7) | 30hp 1×3d8 (13.5) |
| Rime Drake | ice | 3 crystal, 1 livestock | 2 | weak_to_me | 6hp 1×1d6 (3.5) | 12hp 1×2d6 (7) | 20hp 2×2d8 (18) |
| Storm Wyrm | lightning | 3 crystal, 1 livestock, 1 gold | 3 | random | 6hp 2×1d4 (5) | 12hp 3×1d6 (10.5) | 20hp 4×1d8 (18) |
| Bolt Drake | lightning | 3 crystal, 1 livestock | 2 | strongest_attacker | 5hp 1×1d8 (4.5) | 10hp 1×2d8 (9) | 16hp 1×3d8 (13.5) |
| Sky Wyrm | air | 3 crystal, 1 livestock, 1 gold | 3 | lowest_health | 6hp 1×1d6 (3.5) | 13hp 2×1d8 (9) | 22hp 2×2d8 (18) |
| Zephyr Drake | air | 3 crystal, 1 livestock | 1 | random | 5hp 1×1d4 (2.5) | 9hp 1×1d8 (4.5) | 14hp 2×1d8 (9) |
| Abyss Wyrm | water | 3 crystal, 1 livestock, 1 gold | 3 | strongest_attacker | 8hp 1×1d8 (4.5) | 16hp 2×1d8 (9) | 28hp 2×2d8 (18) |
| Reef Drake | water | 3 crystal, 1 livestock | 2 | weak_to_me | 7hp 1×1d6 (3.5) | 13hp 1×2d6 (7) | 21hp 2×2d6 (14) |

## Raids

Defenders:

| Unit | Health | Attack (avg) | Strong vs | Weak vs |
|---|---|---|---|---|
| Militia | 5 | 1×1d4 (2.5) | — | fire |
| Archers | 6 | 1×1d6 (3.5) | water | air |
| Knights | 12 | 1×1d8 (4.5) | fire | lightning |
| Frost Golem | 16 | 1×1d6 (3.5) | ice, water | fire |
| Storm Griffin | 10 | 1×1d8 (4.5) | air, lightning | ice |
| Sea Serpent | 14 | 2×1d4 (5) | water, fire | lightning |

Kingdoms (3 are offered each raid; average damage is the defenders' total a combat round):

| Kingdom | Defenders | Total health | Avg damage a round | Loot | Loot value |
|---|---|---|---|---|---|
| Hamlet of Brindle | Militia, Militia | 10 | 5 | 2 livestock, 3 gold | 14 |
| Archer's Hold | Archers, Archers, Archers, Archers, Militia | 29 | 16.5 | 2 timber, 7 gold | 30 |
| Knightsgate | Knights, Knights, Knights, Knights | 48 | 18 | 3 stone, 14 gold | 59 |
| Frostpeak | Frost Golem, Frost Golem, Archers, Archers | 44 | 14 | 3 crystal, 14 gold | 59 |
| Stormspire | Storm Griffin, Storm Griffin, Storm Griffin, Storm Griffin | 40 | 18 | 16 gold | 64 |
| Tidewatch | Sea Serpent, Sea Serpent, Knights, Knights | 52 | 19 | 3 livestock, 16 gold | 67 |

Chance the kingdom falls to one player's raiders fighting to the end, from 100 raids through the engine per cell. Base whelp rows average the five elements, with the worst and best element in brackets. Loot is split among the players still fighting, so a shared raid pays each less.

| Raider | Hamlet of Brindle | Archer's Hold | Knightsgate | Frostpeak | Stormspire | Tidewatch |
|---|---|---|---|---|---|---|
| Base whelp, hatchling | 35% (18%–70%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) |
| Base whelp, young | 99% (98%–100%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) | 0% (0%–0%) |
| Base whelp, adult | 100% (100%–100%) | 50% (0%–89%) | 13% (0%–65%) | 23% (0%–66%) | 21% (0%–88%) | 9% (0%–44%) |
| Two young base whelps | 100% | 62% | 16% | 28% | 22% | 13% |
| Ember Wyrm (fire), adult | 100% | 99% | 0% | 100% | 91% | 0% |
| Cinder Drake (fire), adult | 100% | 37% | 0% | 50% | 0% | 0% |
| Frost Wyrm (ice), adult | 100% | 31% | 21% | 1% | 63% | 12% |
| Rime Drake (ice), adult | 100% | 70% | 11% | 5% | 89% | 5% |
| Storm Wyrm (lightning), adult | 100% | 74% | 82% | 10% | 0% | 57% |
| Bolt Drake (lightning), adult | 100% | 0% | 0% | 2% | 0% | 0% |
| Sky Wyrm (air), adult | 100% | 93% | 12% | 87% | 0% | 7% |
| Zephyr Drake (air), adult | 100% | 16% | 0% | 0% | 0% | 0% |
| Abyss Wyrm (water), adult | 100% | 29% | 28% | 4% | 65% | 0% |
| Reef Drake (water), adult | 100% | 0% | 1% | 0% | 6% | 0% |

## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy), plus where it comes from. Dragon upkeep (1 livestock per dragon a round) comes on top.

| Resource | In all card costs | Share | Comes from |
|---|---|---|---|
| stone | 83 | 24% | tower 1, Quarry, raid loot (1 of 6 kingdoms) |
| timber | 85 | 24% | tower 1, Lumber Camp, raid loot (1 of 6 kingdoms) |
| crystal | 89 | 26% | tower 1, Crystal Mine, raid loot (1 of 6 kingdoms) |
| livestock | 46 | 13% | tower 1, Pasture, raid loot (2 of 6 kingdoms) |
| gold | 45 | 13% | Trade Charter, raid loot (6 of 6 kingdoms) |

## Decks

Building deck 51 cards, action deck 38. Last column: chance a player is dealt at least one within 5 rounds. A player is dealt at least one upgrade in their first 2 rounds 79% of the time.

| Card | Deck | Copies | Share of deck | By round 5 |
|---|---|---|---|---|
| Quarry | building | 4 | 8% | 59% |
| Lumber Camp | building | 4 | 8% | 59% |
| Crystal Mine | building | 4 | 8% | 59% |
| Pasture | building | 4 | 8% | 59% |
| Roost | building | 4 | 8% | 59% |
| Hatchery | building | 3 | 6% | 49% |
| Port | building | 3 | 6% | 49% |
| Tower Floor | building | 6 | 12% | 75% |
| Monument | building | 3 | 6% | 49% |
| Workshop | building deck (upgrade) | 4 | 8% | 59% |
| Gilding | building deck (upgrade) | 4 | 8% | 59% |
| Nesting Grounds | building deck (upgrade) | 4 | 8% | 59% |
| Trade Charter | building deck (upgrade) | 4 | 8% | 59% |
| Windfall | action | 5 | 13% | 53% |
| Buried Treasure | action | 4 | 11% | 45% |
| Growth Elixir | action | 4 | 11% | 45% |
| Healing Potion | action | 3 | 8% | 35% |
| War Horn | action | 3 | 8% | 35% |
| Secret Hoard | action | 4 | 11% | 45% |
| Any upgrade (4 kinds) | building deck (upgrade) | 16 | 31% | 99% |
| Any dragon (15 kinds) | action | 15 | 39% | 93% |

## Game length (random bots)

30 games per player count between the random bot (`src/bot.ts`). Random bots play badly, so this is a sanity check on pace, not a prediction.

Last three columns: share of games that end with someone holding each title (it needs 8 dragon points, 3 tower floors or 7 buildings).

| Players | Fewest rounds | Median | Most | Stalled | Army held | Tower held | Territory held |
|---|---|---|---|---|---|---|---|
| 2 | 8 | 11 | 14 | 0 | 100% | 17% | 23% |
| 3 | 8 | 10 | 14 | 0 | 100% | 33% | 67% |
| 4 | 7 | 9 | 14 | 0 | 93% | 33% | 43% |
