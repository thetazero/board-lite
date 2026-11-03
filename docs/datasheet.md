# Tuning datasheet

Generated from `src/data.ts` and the engine by `npm run datasheet`; don't edit by hand. `npm test` fails when it is out of date, so after changing any number, rerun `npm run datasheet` and read the diff: it shows what the change does to payback, cost per point and raid odds.

## Economy baseline

Yardstick for every "value" below: 1 per stone, timber, crystal or livestock, and 4 per gold (the bank's 4:1 price for it). Gold comes only from raids and Trade Charters.

- Start: 3 stone, 3 timber, 3 crystal, 3 livestock (value 12). Tower income: 1 stone, 1 timber, 1 crystal, 1 livestock a round (value 4), no dice.
- Cards: 2 building + 1 action a round; hand cap 7.
- Win at 15 points. Titles are 2 points each.
- Each dragon eats 1 livestock a round, eggs included; the tower makes 1.
- Bank: 4:1, 3:1 with a Market, 2:1 with a Caravan Post.

## Production buildings

Payback = value of the cost ÷ average output a round. ⚠ marks under 2 rounds.

| Building | Terrain | Cost | Value | Output a round | Payback (card) | Payback (special project) | Payback with Workshop |
|---|---|---|---|---|---|---|---|
| Quarry | mountain | 3 timber, 2 crystal, 3 livestock | 8 | d6 stone (avg 3.5) | 2.3 | 4.6 | 3.8 |
| Lumber Camp | forest | 3 stone, 3 crystal, 2 livestock | 8 | d6 timber (avg 3.5) | 2.3 | 4.6 | 3.8 |
| Crystal Mine | ley | 3 stone, 3 timber, 2 livestock | 8 | d6 crystal (avg 3.5) | 2.3 | 4.6 | 3.8 |
| Pasture | meadow | 2 stone, 3 timber, 3 crystal | 8 | d6 livestock (avg 3.5) | 2.3 | 4.6 | 3.8 |

Workshop (1 timber, 2 gold, value 9) adds 1 a round: it pays for itself in 9 rounds on its own.

## Land

Measured on 300 generated maps per player count. Each cell: share of towers with that terrain on a touching hex / average number of such hexes within 2 steps of the tower. Map radius: 2p 3, 3p 3, 4p 4.

| Terrain | For | Share of map | 2 players | 3 players | 4 players |
|---|---|---|---|---|---|
| mountain | Quarry | 21% | 74% / 2.7 | 76% / 2.8 | 76% / 2.8 |
| forest | Lumber Camp | 21% | 78% / 2.8 | 79% / 2.8 | 76% / 2.8 |
| ley | Crystal Mine | 14% | 61% / 1.9 | 61% / 1.9 | 59% / 1.9 |
| meadow | Pasture | 21% | 75% / 2.8 | 75% / 2.8 | 77% / 2.8 |
| plains | — | 21% | 74% / 2.7 | 76% / 2.8 | 75% / 2.7 |

## Dragon and trade buildings and upgrades

| Card | Kind | Cost | Value | Special project value | Does |
|---|---|---|---|---|---|
| Roost | building | 3 stone, 1 timber | 4 | 8 | Houses 2 more dragons. |
| Hatchery | building | 2 stone, 2 timber, 2 crystal | 6 | — | Your fed dragons grow one extra step each round. |
| Market | building | 1 stone, 3 timber, 1 livestock | 5 | — | You trade with the bank at 3:1. Saves 1 per resource bought vs the bank: pays back after buying 5. |
| Caravan Post | building | 2 stone, 3 timber, 1 gold | 9 | — | You trade with the bank at 2:1. Saves 2 per resource bought vs the bank: pays back after buying 4.5. |
| Nesting Grounds | upgrade (dragon) | 1 stone, 2 gold | 9 | — | This roost, hatchery or tower houses 1 more dragon. |
| Trade Charter | upgrade (trade) | 1 crystal, 2 gold | 9 | — | This trade building produces 1 gold each round. Pays back in 2.3 rounds. |

## Points

Value per point = value of everything paid ÷ points. Dragon costs include the livestock eaten while growing, from egg, without a hatchery; an adult keeps eating 1 a round. The tower alone makes 4 value a round, so a point at value V takes V ÷ 4 rounds of tower income.

| Source | Pays | Points | Value per point | Ready |
|---|---|---|---|---|
| Tower Floor | 4 stone, 1 crystal, 1 gold | 1 | 9 | now |
| Monument | 4 stone, 2 timber, 2 gold | 2 | 7 | now |
| Gilding (upgrade) | 3 gold | 1 | 12 | now |
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

Cheapest paid point: Zephyr Drake, adult at 1.8. Dearest: Gilding (upgrade) at 12, 6.7× as much.

With a Hatchery (+1 growth a round), a growth-time-2 dragon reaches adult in 3 rounds instead of 6.

Titles: 2 points each, for most dragon points, most tower floors and most buildings.

## Dragons

Each stage: health, targets × dice (average damage a combat round, before elements), flee speed.

| Dragon | Element | Cost | Growth time | Targets | Hatchling | Young | Adult |
|---|---|---|---|---|---|---|---|
| Base whelp (any element) | any | 2 crystal, 1 livestock | 2 | random | 6hp 1×1d6 (3.5) spd 1 | 12hp 1×2d6 (7) spd 2 | 20hp 2×2d6 (14) spd 2 |
| Ember Wyrm | fire | 3 crystal, 1 livestock, 1 gold | 3 | weak_to_me | 7hp 1×1d8 (4.5) spd 1 | 14hp 1×2d8 (9) spd 1 | 24hp 2×3d8 (27) spd 1 |
| Cinder Drake | fire | 3 crystal, 1 livestock | 2 | lowest_health | 6hp 1×1d6 (3.5) spd 2 | 11hp 2×1d6 (7) spd 2 | 18hp 3×1d8 (13.5) spd 3 |
| Frost Wyrm | ice | 3 crystal, 1 livestock, 1 gold | 3 | strongest_attacker | 9hp 1×1d6 (3.5) spd 0 | 17hp 1×2d6 (7) spd 0 | 30hp 1×3d8 (13.5) spd 1 |
| Rime Drake | ice | 3 crystal, 1 livestock | 2 | weak_to_me | 6hp 1×1d6 (3.5) spd 1 | 12hp 1×2d6 (7) spd 2 | 20hp 2×2d8 (18) spd 2 |
| Storm Wyrm | lightning | 3 crystal, 1 livestock, 1 gold | 3 | random | 6hp 2×1d4 (5) spd 2 | 12hp 3×1d6 (10.5) spd 2 | 20hp 4×1d8 (18) spd 3 |
| Bolt Drake | lightning | 3 crystal, 1 livestock | 2 | strongest_attacker | 5hp 1×1d8 (4.5) spd 3 | 10hp 1×2d8 (9) spd 3 | 16hp 1×3d8 (13.5) spd 4 |
| Sky Wyrm | air | 3 crystal, 1 livestock, 1 gold | 3 | lowest_health | 6hp 1×1d6 (3.5) spd 3 | 13hp 2×1d8 (9) spd 4 | 22hp 2×2d8 (18) spd 5 |
| Zephyr Drake | air | 3 crystal, 1 livestock | 1 | random | 5hp 1×1d4 (2.5) spd 4 | 9hp 1×1d8 (4.5) spd 5 | 14hp 2×1d8 (9) spd 6 |
| Abyss Wyrm | water | 3 crystal, 1 livestock, 1 gold | 3 | strongest_attacker | 8hp 1×1d8 (4.5) spd 1 | 16hp 2×1d8 (9) spd 1 | 28hp 2×2d8 (18) spd 2 |
| Reef Drake | water | 3 crystal, 1 livestock | 2 | weak_to_me | 7hp 1×1d6 (3.5) spd 2 | 13hp 1×2d6 (7) spd 2 | 21hp 2×2d6 (14) spd 3 |

## Raids

Defenders:

| Unit | Health | Attack (avg) | Chase | Strong vs | Weak vs |
|---|---|---|---|---|---|
| Militia | 5 | 1×1d4 (2.5) | 1 | — | fire |
| Archers | 6 | 1×1d6 (3.5) | 3 | water | air |
| Knights | 12 | 1×1d8 (4.5) | 2 | fire | lightning |
| Frost Golem | 16 | 1×1d6 (3.5) | 0 | ice, water | fire |
| Storm Griffin | 10 | 1×1d8 (4.5) | 4 | air, lightning | ice |
| Sea Serpent | 14 | 2×1d4 (5) | 2 | water, fire | lightning |

Kingdoms (3 are offered each raid; average damage is the defenders' total a combat round):

| Kingdom | Defenders | Total health | Avg damage a round | Best chase | Loot | Loot value |
|---|---|---|---|---|---|---|
| Hamlet of Brindle | Militia, Militia | 10 | 5 | 1 | 2 livestock, 3 gold | 14 |
| Archer's Hold | Archers, Archers, Militia | 17 | 9.5 | 3 | 2 timber, 5 gold | 22 |
| Knightsgate | Knights, Knights | 24 | 9 | 2 | 2 stone, 7 gold | 30 |
| Frostpeak | Frost Golem, Archers | 22 | 7 | 3 | 2 crystal, 7 gold | 30 |
| Stormspire | Storm Griffin, Storm Griffin | 20 | 9 | 4 | 9 gold | 36 |
| Tidewatch | Sea Serpent, Knights | 26 | 9.5 | 2 | 2 livestock, 9 gold | 38 |

Chance the kingdom falls to one player's raiders fighting to the end with no fleeing, from 100 raids through the engine per cell. Base whelp rows average the five elements, with the worst and best element in brackets. Loot is split among the players still fighting, so a shared raid pays each less.

| Raider | Hamlet of Brindle | Archer's Hold | Knightsgate | Frostpeak | Stormspire | Tidewatch |
|---|---|---|---|---|---|---|
| Base whelp, hatchling | 35% (18%–70%) | 0% (0%–1%) | 1% (0%–6%) | 0% (0%–0%) | 3% (0%–16%) | 0% (0%–0%) |
| Base whelp, young | 99% (98%–100%) | 37% (0%–65%) | 19% (0%–75%) | 33% (0%–81%) | 25% (0%–87%) | 14% (0%–68%) |
| Base whelp, adult | 100% (100%–100%) | 97% (87%–100%) | 80% (16%–100%) | 85% (49%–100%) | 75% (31%–100%) | 62% (4%–100%) |
| Two young base whelps | 100% | 99% | 83% | 95% | 83% | 74% |
| Ember Wyrm (fire), adult | 100% | 100% | 99% | 100% | 100% | 99% |
| Cinder Drake (fire), adult | 100% | 98% | 0% | 98% | 66% | 0% |
| Frost Wyrm (ice), adult | 100% | 100% | 100% | 100% | 100% | 100% |
| Rime Drake (ice), adult | 100% | 98% | 99% | 92% | 100% | 97% |
| Storm Wyrm (lightning), adult | 100% | 100% | 98% | 84% | 4% | 99% |
| Bolt Drake (lightning), adult | 100% | 95% | 97% | 94% | 29% | 99% |
| Sky Wyrm (air), adult | 100% | 100% | 100% | 100% | 79% | 100% |
| Zephyr Drake (air), adult | 100% | 92% | 23% | 72% | 1% | 11% |
| Abyss Wyrm (water), adult | 100% | 100% | 100% | 100% | 100% | 92% |
| Reef Drake (water), adult | 100% | 93% | 94% | 55% | 97% | 42% |

## Resource demand

How much of each resource every card in both decks costs in total (each card counted once per copy), plus where it comes from. Dragon upkeep (1 livestock per dragon a round) comes on top.

| Resource | In all card costs | Share | Comes from |
|---|---|---|---|
| stone | 96 | 27% | tower 1, Quarry, raid loot (1 of 6 kingdoms) |
| timber | 70 | 20% | tower 1, Lumber Camp, raid loot (1 of 6 kingdoms) |
| crystal | 94 | 27% | tower 1, Crystal Mine, raid loot (1 of 6 kingdoms) |
| livestock | 46 | 13% | tower 1, Pasture, raid loot (2 of 6 kingdoms) |
| gold | 46 | 13% | Trade Charter, raid loot (6 of 6 kingdoms) |

## Decks

Building deck 49 cards, action deck 38. Last column: chance a player is dealt at least one within 5 rounds.

| Card | Deck | Copies | Share of deck | By round 5 |
|---|---|---|---|---|
| Quarry | building | 4 | 8% | 61% |
| Lumber Camp | building | 4 | 8% | 61% |
| Crystal Mine | building | 4 | 8% | 61% |
| Pasture | building | 4 | 8% | 61% |
| Roost | building | 4 | 8% | 61% |
| Hatchery | building | 3 | 6% | 50% |
| Market | building | 3 | 6% | 50% |
| Caravan Post | building | 2 | 4% | 37% |
| Tower Floor | building | 6 | 12% | 77% |
| Monument | building | 3 | 6% | 50% |
| Workshop | building deck (upgrade) | 3 | 6% | 50% |
| Gilding | building deck (upgrade) | 3 | 6% | 50% |
| Nesting Grounds | building deck (upgrade) | 3 | 6% | 50% |
| Trade Charter | building deck (upgrade) | 3 | 6% | 50% |
| Windfall | action | 5 | 13% | 53% |
| Buried Treasure | action | 4 | 11% | 45% |
| Growth Elixir | action | 4 | 11% | 45% |
| Healing Potion | action | 3 | 8% | 35% |
| War Horn | action | 3 | 8% | 35% |
| Secret Hoard | action | 4 | 11% | 45% |
| Any dragon (15 kinds) | action | 15 | 39% | 93% |

## Game length (random bots)

30 games per player count between the random bot (`src/bot.ts`). Random bots play badly, so this is a sanity check on pace, not a prediction.

| Players | Fewest rounds | Median | Most | Stalled |
|---|---|---|---|---|
| 2 | 5 | 10 | 13 | 0 |
| 3 | 7 | 10 | 12 | 0 |
| 4 | 6 | 9 | 16 | 0 |
