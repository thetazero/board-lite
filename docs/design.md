# board-lite design

Living design doc. Decisions here were made in conversation with the project owner; quoted lines are theirs. Open questions are listed at the end and are not decided yet.

## Design principles (the owner's, and the most important part of this doc)

- Simple core systems that work well, not a pile of edge cases. Keep it "board game like".
- When a playtest shows a problem, assume a poorly designed system first, not a bug to patch. In the owner's words: "often times 'x' happens due to poorly designed game systems, not because of bugs that need to be patched away... design simple core system that work well, not add a million edge cases."
- A fix should make the rules simpler or keep them the same size. A fix that adds a special case, exception or extra rule is the wrong fix unless nothing simpler works, and then something else should go.
- Depth test: Haiku players should regularly lose to Opus players. If they don't, the game has no depth.
- Provisional design calls made without the owner carry their reasoning in the commit message and PR description that make them. There is no separate decision log.

### Complexity budget

Hard ceilings, set provisionally by the orchestrator at the owner's request ("try to force this by asserting certain complexity maximums"). Changes must stay within them; raising one is a design call, with its reasoning in the commit and PR that raise it.

- The full rules, not counting individual card text, fit on one printed page.
- 5 resources (stone, timber, crystal, livestock, gold). No more.
- 4 phases per global round. No more.
- No cap on building or upgrade types. The owner, 2026-11-03: "the 10 building limit is stupid and the exact opposite of what I want, I want lots of fun variety." (The 6-upgrade cap went with it, as an orchestrator call in the same spirit.) Variety comes as many cards within a few classes.
- At most 12 distinct non-dragon action card effects.
- A dragon card is: element, growth time, stats per life stage, and one targeting rule. Nothing else.
- At most 6 raid unit types, each just stats plus elemental strengths and weaknesses.
- Any card's text is one short sentence.
- No rule that only exists to handle a single edge case.

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
- Shortages drive trade: "we intend for players to have shortages of a certain resource most of the time, so trading is necessary, and that the shortages should not be too corelated across players".

## Winning

- Victory points decide the winner (not the size of the gold hoard).
- The game ends when a player reaches N points (first to N).
- Point sources:
  - Dragons, by life stage.
  - Buildings: some building cards are worth points (e.g. tower floors, monuments).
  - Upgrades can add points to their building.
  - Hidden points on action cards, kept in hand until the end (they count toward the 7-card cap).
  - Titles that change hands, like Catan's "longest road": strongest dragon army, tallest tower, largest territory. Kept to these three.
  - Titles take real investment: "strongest army and largest territory need a larger threshold".
  - Raids give loot only, no points.

## Buildings

- Buildings are built with resources. Some produce resources, some give victory points, and so on. All of them are shown on the game board on the TV.
- Two kinds of cards for them:
  1. Building cards.
  2. Building upgrade cards. An upgrade applies to a class of building and is placed on one specific building, which then looks different on the board.
- Costs: upgrades skew gold-heavy; raw builds skew resource-heavy.
- Building cards should be special and interesting (owner, 2026-11-03, after playing: "I basically always have too many building cards, and they don't feel fun or meaningful"):
  - The basic production buildings are not cards; anyone can build them.
  - Building cards are "special and more interesting, like buildings that scale with number of neighbors of a certain class, regardless of what team they are on. generally adjacency limited."
  - Lots of variety: "I want lots of fun variety."
  - Variety within classes: "there can be lots of different buildings but they can still be classes like "quary" which is upgraded by any quarry upgrade."
  - Drawing: "draw two keep 1 is the correct direction".
- Building classes so far: one per resource (quarry, lumber camp, mine, pasture), dragon buildings (roost, hatchery), monuments (tower floors and other point buildings), trade buildings (port: a better bank rate; market). No defense buildings (see Raids).

### Special projects

- Always-available "special projects" let a player get unstuck on all the basic things without a card, such as building the basic buildings or getting a base dragon of each element. (With the basic buildings no longer cards, only the base egg is left as a special project.)
- They are expensive: always worse than the equivalent card.

## Map

- One shared hex map.
- One building per hex. A hex's terrain decides which production building can go there. Tower floors stack on your tower hex.
- You expand outward from your tower: a new building must touch one of yours. Players start spread out and grow toward each other.
- Good land runs out as players grow toward each other, so the map becomes more contested late in the game.
- Bigger than the first version: "the map needs to be bigger".
- "Ocean around the outside of the map, only natural harbors support markets which should probably be renamed to ports".
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

- Each raid phase has one raid target, chosen from 3 random candidates by a player vote; ties are resolved by a coin flip. Targets don't change in strength over the game.
- The raid has two phases:
  1. Public commit: everyone knows exactly who is committing what. Once everyone hits ready, the commitments lock in.
  2. Bail opportunity: each committed player makes a binary choice, bail or play, with no information shared.
- Bailing costs nothing except that you get no share of the loot.
- Intended dynamic: a player can commit publicly to draw others in, then secretly bail, leaving the raid weaker than everyone expected. This is deliberate, not an exploit to fix ("that consequence is exactly the dynamic I want").
- Loot is split evenly (among those who play; see Combat for fled dragons).
- Targets have units with stats and with elemental strengths and weaknesses.
- Fleeing: a dragon's flee strength is rolled against the defenders' chase strength. A dragon that flees leaves the fight either way; failing the roll means it takes damage scaled by how badly it lost. *(Provisionally removed: the secret bail is the only way out of a raid. Reasoning in the pull request for issue #5.)*

### Combat

- Classic damage rolls: each dragon has a number of targets, a number of dice, and how many sides each die has.
- Classic turn-based combat: dragons and defending units alternate sides.
- Targeting is simple and automatic; the rule is printed on the dragon card (e.g. lowest health, strongest attacker, random, a unit weak to my element).
- Dragons and units have health. Dragon health, like its attack stats, depends on life stage; the card lists stats per life stage.
- Elements: double damage against a unit weak to the attacker's element, half against one strong against it.
- After each round of combat, players get 10 seconds to choose whether to roll to flee. *(Provisionally removed with fleeing, above.)*
- Healing: healing time scales with health lost, measured in global rounds. Typically it's one round; only a fully mature dragon that took a lot of damage is out longer.
- Loot is split evenly among players whose dragons were still fighting at the end.
- Loot is gold plus resources, skewed heavily toward gold.
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

- Order of play: globally visible things happen in turn order; local hidden things happen all at once, to keep the game fast ("make globally visible stuff turn order, local hidden stuff all at once"). So production resolves in turn order (it's just an animation), card picking is all at once, and the raid phase is all at once.

## Setup

- Each player starts with a tower hex, some resources, and a starting dragon.
- Tower placement is fixed by player count.

## Trading

- Players trade with each other (resources and cards).
- Bank trades at 4:1, like Catan; ports improve the rate.
- Trades between players are binding once confirmed.

## Map generation

- The hex map is randomly generated each game. It should be fun but legible on a TV screen.

## Platform

- A web game. Strong preference for TypeScript; no other stack preferences.
- The phone client should be lightweight.

## Look and feel

The owner's calls (2026-11-03), after playing the first clients:

- Art style: papercraft / pop-up book, leaning origami: "Yeah I feel like oragami leaning is the way to go".
- "I want cool looking cards with graphics that look like cards, I want the game board to be 3d and fun, and for buildings to literally be built and stand on the board, I want dragons to look cool and fly around their homes from time to time. but otherwise just chill at home"
- The phone's copy of the map stays flat: "yup flat simplified version probably".
- TV camera: "top down view will make some graphics tricky", "Yup agreed probably a slight tilt is optimal", "while keeping the simple mobile view flat".
- Icons, not words: "we should constantly use icons over words for things like wood, and make the icons look better too".
- Show, don't tell: "things should be show not tell, there should just be an animation where cards are added to your hand" (said of the phone's "You draw Quarry, Crystal Mine, Rime Drake." line).

## Open questions

- Tuning numbers (deferred; not answerable yet): N to win, points per title, costs, dice, unit stats, player count, game length. `docs/datasheet.md` shows the current numbers and what they add up to.
- Action cards: the full list. Known so far: dragon cards, an extra raid phase, cards that give resources, cards that grow dragons faster.

### Filled in provisionally by the first rules engine

The doc left these open; the engine had to pick something. Each is provisional, the reasoning is in the first rules engine's PR (#3), and `docs/rules.md` has the rules as played.

- Card picking: 1 action card is dealt; 2 building cards are drawn and one is kept (the owner's "draw two keep 1"), all at once in the cards phase.
- Basic buildings: the four production buildings and the roost are built without a card at the price they had as cards. The tower floor is basic too, paid mostly in gold, so raid loot always has a way into points. Building cards' effects count their six neighbouring hexes (a terrain, or a class of building, anyone's), multiplying a flat effect; that one rule covers every neighbour card.
- Winning: checked at the end of each round, not mid-turn; highest total wins; ties go to most gold, then turn order.
- The first player rotates each round.
- The tower produces 1 of each non-gold resource and houses 1 dragon.
- Only production buildings are tied to terrain; other buildings go on any free hex.
- One upgrade per building; the tower counts as a monument and a dragon building.
- The special project is a base egg of any element, at double the base dragon card.
- Dragon cards hatch as eggs. Every dragon, eggs included, eats 1 livestock per round, in order of hatching.
- Healing: every dragon heals fully at production, but one that was hurt (or went hungry) sits out that round's raids. Only hunger stops growth, as the upkeep rule above says. Any hit in a raid costs the next raid, however big the dragon. Dragons never die: at 0 health they are knocked out and heal at home.
- Combat: dragons strike first, then each defender hits random dragons, until one side has fallen. No fleeing mid-fight; bailing before it is the only way out.
- Raid votes are secret until everyone has voted, and every player votes. A player with no raid-ready dragon skips the commit step.
- Loot is rounded down per player; the remainder is lost.
- The bank sells gold at the normal rate.
- Titles go to the single leader once they reach a minimum (in `src/data.ts`); the holder keeps one on a tie.
- Resource counts are hidden; hand sizes are public. A card offered in a trade is shown to everyone.
- Trade offers expire at the end of the acting player's turn, but the acting player must answer (accept or decline) every offer made to them before ending it.
- The action card list: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn (extra raid), Secret Hoard (hidden point), plus dragons. Six of the twelve allowed effects.
