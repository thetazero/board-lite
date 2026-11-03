# board-lite design

Living design doc. Decisions here were made in conversation with the project owner; quoted lines are theirs. Open questions are listed at the end and are not decided yet.

## Format

- A "board game lite" played in one room: the shared game board is on a TV with a fixed camera, and each player's phone holds only their small hidden state (their hand).
- Phones join the TV's game by room code (Jackbox-style).
- Keep the player's state small and the TV's state larger. Eyes should stay on the TV and the people in the room; the phone is for glancing at your hand and confirming actions.
- Dynamics stay simple: dice rolls are still used, shown on screen, and there aren't many of them.
- Because the computer handles the rules, the TV can do real animation, and the game cuts to a raid cut scene when needed.

## What the game should feel like

- Real social interaction, with the best strategy mostly collaborative (positive-sum) for most of the game, and still a winner.
- Fun to try to be good at: the best play is the intended play. No obvious optimal strategy that the rules merely ask players not to use.
- Works for casual, mixed-skill groups over many sessions; most people should leave feeling good.
- Core loop: Catan's social loop (generate → trade → build) combined with Terraforming Mars's satisfying engine growth.

## Theme

- You play a wizard who raises dragons. Your tower and buildings produce resources, dragons are hatched and raised, and dragons raid neutral kingdoms for loot.
- Raids target neutral kingdoms, not other players ("raid neutral targets is definitely the move").
- Spells are dropped as a system ("Drop spells for the most part though"). What remains are spell cards in hand, "basically action cards".

## Hidden vs public state

- Hidden, on your phone: resource tokens, building cards and action cards.
- Public, on the TV: dragons and buildings, on the shared map.

## Resources

| Resource | Comes from | Mostly spent on |
|---|---|---|
| Stone | Quarries (mountains) | Tower floors, roosts, defenses |
| Timber | Lumber camps (forests) | Buildings, raid gear |
| Crystal | Crystal mines (ley lines, caves) | Hatching eggs, action cards |
| Livestock | Pastures | Feeding dragons, every round |
| Gold | Raids only (not produced) | The strongest things: action cards, top tower floors, adult dragons |

- Dragons eat livestock every round, which keeps trade demand steady and limits how many dragons you can keep.
- Gold is raid currency, not the score.
- Resources are tokens, not cards, and are unlimited: they don't count toward the hand cap.

## Winning

- Victory points decide the winner (not the size of the gold hoard).
- The game ends when a player reaches N points (first to N).
- Point sources:
  - Dragons, by life stage.
  - Buildings: some building cards are worth points (e.g. tower floors, monuments).
  - Upgrades can add points to their building.
  - Hidden points on action cards, kept in hand until the end (they count toward the 7-card cap).
  - Titles that change hands, like Catan's "longest road": strongest dragon army, tallest tower, largest territory. Kept to these three.
  - Raids give loot only, no points.

## Buildings

- Buildings are built with resources. Some produce resources, some give victory points, and so on. All of them are shown on the game board on the TV.
- Two kinds of cards for them:
  1. Building cards.
  2. Building upgrade cards. An upgrade applies to a class of building and is placed on one specific building, which then looks different on the board.
- Costs: upgrades skew gold-heavy; raw builds skew resource-heavy.
- Building classes so far: production (quarry, lumber camp, crystal mine, pasture), dragon (hatchery, roost), tower floors (victory points), trade (market, caravan post: better bank trade rates). No defense buildings (see Raids).

### Special projects

- Always-available "special projects" let a player get unstuck on all the basic things without a card, such as building the basic buildings or getting a base dragon of each element.
- They are expensive: always worse than the equivalent card.

## Map

- One shared hex map.
- One building per hex. A hex's terrain decides which production building can go there. Tower floors stack on your tower hex.
- You expand outward from your tower: a new building must touch one of yours. Players start spread out and grow toward each other.
- Good land runs out as players grow toward each other, so the map becomes more contested late in the game.
- Neutral kingdoms are not on the map. Raids against them happen in a separate raiding phase of the game.

## Dragons

- Dragons fit into action cards as well ("I feel like dragons fit into 'action cards' as well").
- Each dragon has an element and a life stage. Its combat stats and its victory points are a function of its life stage.
- Elements: fire, ice, lightning, air, water.
- Upkeep: dragons eat livestock. If you run out of food, the dragon stops growing and can't raid. That is the only penalty.
- From card to board: a dragon card is held hidden in your hand, like any action card, and played to hatch the dragon publicly on the board.
- Life stages: egg → hatchling → young → adult.
- Growth is automatic while the dragon is fed, but different dragons take different amounts of time to grow.
- Roosts house dragons and cap how many you can keep.

## Raids

- Each raid phase has one raid candidate (a single neutral target).
- The raid has two phases:
  1. Public commit: everyone knows exactly who is committing what. Once everyone hits ready, the commitments lock in.
  2. Bail opportunity: each committed player makes a binary choice, bail or play, with no information shared.
- Bailing costs nothing except that you get no share of the loot.
- Intended dynamic: a player can commit publicly to draw others in, then secretly bail, leaving the raid weaker than everyone expected. This is deliberate, not an exploit to fix ("that consequence is exactly the dynamic I want").
- Loot is split evenly (among those who play; see Combat for fled dragons).
- Targets have units with stats and with elemental strengths and weaknesses.
- Fleeing: a dragon's flee strength is rolled against the defenders' chase strength. A dragon that flees leaves the fight either way; failing the roll means it takes damage scaled by how badly it lost.

### Combat

- Classic damage rolls: each dragon has a number of targets, a number of dice, and how many sides each die has.
- Classic turn-based combat: dragons and defending units alternate sides.
- Targeting is simple and automatic; the rule is printed on the dragon card (e.g. lowest health, strongest attacker, random, a unit weak to my element).
- Dragons and units have health. Dragon health, like its attack stats, depends on life stage; the card lists stats per life stage.
- Elements: double damage against a unit weak to the attacker's element, half against one strong against it.
- After each round of combat, players get 10 seconds to choose whether to roll to flee.
- Healing: a dragon that loses all its health is out healing for one full global round. The owner's tentative idea: healing time simply scales with health lost ("Maybe healing just scaled by health lost works here").
- Loot is split evenly among players whose dragons were still fighting at the end.
- Action cards can add another raid phase.
- No retaliation and no defense buildings.

## Game structure

- The game is played in large global rounds. Each global round has, in order:
  1. Production phase: "Catan lite". Production is tied to the building, not the hex (at least for now); each building has a base production plus a roll of its own, e.g. a quarry produces 1 stone plus a d3. The TV shows each player's production per resource as the summed base plus the dice, e.g. 12 + some number of dice for stone.
  2. Card picking phase: cards are drawn from a deck. Picking is free. Each player gets a fixed number per round, maybe 2 building cards and 1 action card.
     - Upgrade cards come from the building deck.
     - Dragon cards are mixed randomly into the action deck, roughly evenly; no separate dragon deck.
     - Hand cap of 7 cards, counting only building and action cards. Over the cap, you discard down to 7 at the end of the round. Cards (not just resources) can be traded.
  3. Action phase: playing action cards, trading, and building all happen here. Catan-style turns: players act one at a time, and anyone can trade with the acting player. Chosen over a simultaneous timed phase because turns force communication.
  4. Raid phase

## Open questions

- Within the global round: whether the production, card picking and raid phases are simultaneous or in turn order.
- Victory points: the value of N; how many points each title is worth.
- Raids: what a raid's loot is; exact healing rule (settle the tentative "scaled by health lost").
- Action cards: what they do.
- Player count and game length.
