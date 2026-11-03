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

- Hidden, on your phone: resource cards and action cards.
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

## Winning

- Victory points decide the winner (not the size of the gold hoard).
- Where points come from is still open; see open questions.

## Buildings

- Buildings are built with resources. Some produce resources, some give victory points, and so on. All of them are shown on the game board on the TV.
- Two kinds of cards for them:
  1. Building cards.
  2. Building upgrade cards. An upgrade applies to a class of building and is placed on one specific building, which then looks different on the board.
- Building classes so far: production (quarry, lumber camp, crystal mine, pasture), dragon (hatchery, roost), tower floors (victory points), trade (market, caravan post: better bank trade rates). No defense buildings (see Raids).

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
- Loot is split evenly (among those who play).
- Targets have units with stats and with elemental strengths and weaknesses.
- On a lost raid, each dragon's flee strength is rolled against the defenders' chase strength. A dragon that fails to flee is out healing for a number of rounds, scaled by how badly it lost the roll.
- Action cards can add another raid phase.
- No retaliation and no defense buildings.

## Open questions

- Turn structure, and how players get building and upgrade cards (deferred to the turn discussion).
- Where victory points come from. Raised so far: dragons (by life stage, decided), tower floors, raid trophies, hidden points on action cards, a title that changes hands.
- Dragons: how players get dragon cards.
- Raids: how a raid is won (how dragon and unit stats and elements combine with dice); what a raid's loot is; when the raid phase falls in a turn.
- Action cards: what they do.
- Player count and game length.
