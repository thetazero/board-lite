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
- At most 3 kinds of fauna, each just stats, elemental strengths and weaknesses, and its loot.
- At most 2 great beasts, each just stats, elemental strengths and weaknesses, its points, and where it lives.
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

## Holding each other back: aggressive fauna

Playtests showed that refusing to trade and taking land first were the only ways to slow a leader, and they weren't enough. The owner (2026-11-03): "you're right that only positive sum trading + a bit of land contention is insufficient". Of three options (one robber-like piece, "take that" cards, secret split-or-grab raid loot), the owner chose many nuisance pieces: "nusience pieces, and not just one sounds beautiful. Like aggressive fauna you need to clear out with dragons to expand and action cards that place them near opponents (or on top shutting down the tiles production)".

- The starting map has fauna on it, in a few strengths ("yes").
- Fauna blocks building on its hex and shuts down the production of a building it sits on (chosen over spreading or eating livestock).
- Clearing fauna "its not a raid but uses the same combat system". Anyone can clear any fauna ("anyone"), and clearing pays "some livestock? (food)", scaled by how strong the beast is.
- "you can chose to fight fauna or raid (but maybe this is a dragon level choice)… maybe you can go half half": each dragon either fights fauna or raids in a round, never both, so a player can split their dragons.
- New fauna comes only from action cards: "card only for now". The board doesn't respawn it.
- Fauna wanders (#139): in production, each beast that isn't a great beast has a 1 in 3 chance to move to a random adjacent land hex with no tower or beast. The fauna cards send the stronger beasts (Wolf Call a Cave Bear, Rouse the Bear a Basilisk), cost 1 crystal each, and come more often (4 and 2 copies; 8 and 4 since the action deck doubled in #201). A beast a card sent gives no loot, so placing one never hands a rival a prize.
- Limits: "you want some of this, you explicitly want a bit of this just like in catan, you just don't want to over do it. these action cards should be rarer and more expensive".

### Great beasts

The owner (2026-11-03): "great beasts that are hard to kill and give 1 VP for killing. 1. thunderbird on a mountain at the center of the map (this mountain should have some special modifier) 2. some sea serpent in the ocean". They are the top tier of the fauna.

- A race: "they do not, it's a race". A slain beast never comes back.
- Fights: "fauna fights should be 1 player and a time and it should heal up between fights". Fought like fauna, to the end with no bail, as one of each dragon's choices for the round (raid, hunt fauna, or hunt a beast), with one attempt per player per round, in turn order.
- Each beast has an elemental weakness, so "the race is to get the right dragons, not the most dragons", and "a well-built force should be able to win around round 8–10, not round 4" (proposed by the orchestrator; the owner: "Yup I like it").
- The centre mountain: nobody builds on or next to the peak while the Thunderbird lives; once it's slain, buildings next to the peak produce more ("Right I think a production bonus makes sense").
- The sea serpent prowls one coast, and the harbour there produces nothing until it's killed ("I like it").
- Points from beasts: "It's not a raid, and that's not a hard rul" (of "raids give loot only, no points").

## Theme

- You play a wizard who raises dragons. Your tower and buildings produce resources, dragons are hatched and raised, and dragons raid neutral kingdoms for loot.
- Raids target neutral kingdoms, not other players ("raid neutral targets is definitely the move"). Players hold each other back with fauna instead (see above).
- Spells are dropped as a system ("Drop spells for the most part though"). What remains are spell cards in hand, "basically action cards".

## Hidden vs public state

- Hidden, on your phone: resource tokens other than gold, building cards and action cards.
- Public, on the TV: dragons and buildings, on the shared map, and everyone's gold, which the Largest Hoard title counts. The owner (2026-11-03): "yeah make gold public, that totally fits the theme".

## Resources

| Resource | Comes from | Mostly spent on |
|---|---|---|
| Stone | Quarries (mountains) | Tower floors, roosts, defenses |
| Timber | Lumber camps (forests) | Buildings, raid gear |
| Crystal | Crystal mines (crystal fields, caves) | Hatching eggs, action cards |
| Livestock | Pastures | Feeding dragons, every round |
| Gold | Raids only (not produced) | The strongest things: action cards, top tower floors, adult dragons |

- Dragons eat livestock every round, which keeps trade demand steady and limits how many dragons you can keep.
- Gold is raid currency, not the score.
- Resources are tokens, not cards, and are unlimited: they don't count toward the hand cap.
- Shortages drive trade: "we intend for players to have shortages of a certain resource most of the time, so trading is necessary, and that the shortages should not be too corelated across players".

## Winning

- Victory points decide the winner (not the size of the gold hoard).
- The game ends when a player reaches N points (first to N).
- Game length: about 15 rounds. The owner, 2026-11-03, told Claude games ran 6–7 rounds: "6-7 rounds feels way too short?", then "I'd raise the point target a bit tbh. Let's target 15 rounds, and increase the ROI time on buildings".
- N is 20 (it was 15), raised "a bit" as the owner asked. Buildings pay back more slowly to match: a basic production building in about 4.5 rounds, so one built early pays for itself by the middle of the game and earns about twice its cost by the end (`docs/datasheet.md`).
- Point sources:
  - Not dragons: they are worth no points (1 / 2 / 3 by life stage until #134). The owner (2026-11-04): "let's make titles worth 3 points, drop dragon VPs", and "dragons worth [no] VPs ... Largest army unchanged, we can go off combat rating or something like that". Dragons count toward the army title instead.
  - Monuments: only monument cards are worth building points. The owner (2026-11-03): "VP buildings should be expensive monuments only". Production buildings, tower floors and upgrades are worth no points (#98). Gold was too cheap to turn into points ("4 fold for 2 points is just insane right?"), so Gilding is gone and a monument costs 20 gold (10 until #138 doubled every stone or timber cost), while raid gold stays big ("raids are supposed to be gold farms and large amounts of gold feels good").
  - Hidden points on action cards, kept in hand until the end (they count toward the 7-card cap).
  - Titles that change hands, like Catan's "longest road": strongest dragon army, tallest tower, largest hoard (#109), 3 points each (2 until #134). The army title goes to the most combat power across a player's dragons (most dragon points until #134). Kept to these three. Largest territory is dropped: "it just intensifies ecomic snowball, while talesr tower is: 1. literally visually cool 2. a side quest/resource sink" (owner, 2026-11-03). Tower floors count only toward the tower title.
  - Titles take real investment. The owner, of the army and territory titles: "strongest army and largest territory need a larger threshold".
  - Raids give loot only, no points. Great beasts aren't raids: slaying one is worth 2 points (1 until #80).

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
- Building classes so far: one per resource (stone, timber, crystal and livestock buildings, each holding its basic building: quarry, lumber camp, crystal mine, pasture), dragon buildings (roost, hatchery), monuments (tower floors and other point buildings), trade buildings (port: a better bank rate; market). No defense buildings (see Raids).

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
- Aggressive fauna holds hexes on the map until dragons clear it (see Holding each other back).

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

- Each raid phase has one raid target, chosen by a player vote; ties are resolved by a coin flip. Targets don't change in strength over the game. *(Provisionally, #99: every kingdom is on the ballot, not 3 random candidates, and a kingdom's loot grows by 1 gold after every raid it doesn't fall in, back to its printed loot when it falls. Reasoning in the pull request for issue #99.)*
- The raid has two phases:
  1. Public commit: everyone knows exactly who is committing what. Once everyone hits ready, the commitments lock in.
  2. Bail opportunity: each committed player makes a binary choice, bail or play, with no information shared.
- Bailing costs nothing except that you get no share of the loot.
- Intended dynamic: a player can commit publicly to draw others in, then secretly bail, leaving the raid weaker than everyone expected. This is deliberate, not an exploit to fix ("that consequence is exactly the dynamic I want").
- Loot is split by combat power (see Combat).
- Easy raids give almost nothing, hard ones a lot. The owner (2026-11-03): "right I think the way raids should work is easy ones give almost nothing, hard ones give a lot. And there should be a "combat power" estimate on dragons and on the raid target, so players can judge at a glance."
- Combat power: one number on each dragon and each raid target, readable at a glance. It stays a rough guide on purpose and there is no win-chance display: "Yup steeper curve, the single number misleads is literally the point, you want players to still have to think and guess".
- The raid choice stays the single vote, one target a raid phase (the owner: "the current vote"). The sabotage the owner wants is backing out of the harder, richer target with the secret bail: "I think the interesting dynamic comes in when you try to pick which raid to take and people back out of the harder more loot one to sabotage, etc..."
- Targets have units with stats and with elemental strengths and weaknesses.
- Fleeing: a dragon's flee strength is rolled against the defenders' chase strength. A dragon that flees leaves the fight either way; failing the roll means it takes damage scaled by how badly it lost. *(Provisionally removed: the secret bail is the only way out of a raid. Reasoning in the pull request for issue #5.)*

### Combat

- Classic damage rolls: each dragon has a number of targets, a number of dice, and how many sides each die has.
- Classic turn-based combat: dragons and defending units alternate sides.
- Targeting is simple and automatic; the rule is printed on the dragon card (e.g. lowest health, strongest attacker, random, a unit weak to my element).
- Dragons and units have health. Dragon health, like its attack stats, depends on life stage; the card lists stats per life stage.
- Elements: double damage against a unit weak to the attacker's element, half against one strong against it.
- After each round of combat, players get 10 seconds to choose whether to roll to flee. *(Provisionally removed with fleeing, above.)*
- Healing: healing time scales with health lost, measured in global rounds, and is slow enough that being left in a losing raid stings. The owner (2026-11-03): "I think to make that sting heal times need to be increased (healing rate decreased)".
- Loot is split among players whose dragons were still fighting at the end, by the combat power each still has fighting. The owner, on the even split: "Also I feel like raiding has a free rider problem, that is un fun? weak players should always just follow the strong one in, and if the strong bails not much happens? wdyt? Like some free rider is good but this feels like a flat dynamic". Their call ("let's try A"): split loot by combat power still standing at the end.
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
- Icons for the core resources, and few icons overall: "we should constantly use icons over words for things like wood, and make the icons look better too"; later (2026-11-03): "Icons are good. we should use icons for core resources, there should not be that many icons".
- Show, don't tell: "things should be show not tell, there should just be an animation where cards are added to your hand" (said of the phone's "You draw Quarry, Crystal Mine, Rime Drake." line).

## Open questions

- Tuning numbers (deferred; not answerable yet): points per title, costs, dice, unit stats, player count. Game length and N are set (see Winning); the rest are tuned to fit them. `docs/datasheet.md` shows the current numbers and what they add up to.
- Action cards: the full list. Known so far: dragon cards, an extra raid phase, cards that give resources, cards that grow dragons faster.

### Filled in provisionally by the first rules engine

The doc left these open; the engine had to pick something. Each is provisional, the reasoning is in the first rules engine's PR (#3), and `docs/rules.md` has the rules as played.

- Card picking: 1 action card is dealt; 2 building cards are drawn and one is kept (the owner's "draw two keep 1"), all at once in the cards phase.
- Basic buildings: the four production buildings and the roost are built without a card at the price they had as cards. The tower floor is basic too, paid mostly in gold (since #98, floors count only toward the tower title). Building cards' effects count their six neighbouring hexes (a terrain, or a class of building, anyone's), multiplying a flat effect; that one rule covers every neighbour card.
- Winning: checked at the end of each round, not mid-turn; highest total wins; ties go to most gold, then turn order.
- The first player rotates each round.
- The tower produces 1 of each non-gold resource and houses 1 dragon.
- Only production buildings are tied to terrain; other buildings go on any free hex.
- One upgrade per building; the tower counts as a monument and a dragon building.
- The special project is a base egg of any element, at double the base dragon card.
- Dragon cards hatch as eggs. Every dragon, eggs included, eats 1 livestock per round, in order of hatching.
- Healing: every dragon heals a fixed amount at production (7 health, in `src/data.ts`), and one that was still hurt when production began (or went hungry) sits out that round's raids, so it misses a raid round per 7 damage, rounded up. Only hunger stops growth, as the upkeep rule above says. Dragons never die: at 0 health they are knocked out and heal at home. (Changed in #65 from healing fully each round.)
- Combat: dragons strike first, then each defender hits random dragons, until one side has fallen. No fleeing mid-fight; bailing before it is the only way out.
- Raid votes are secret until everyone has voted, and every player votes. A player with no raid-ready dragon skips the commit step.
- Combat power is √(health × average damage a combat round), rounded; a side's is the sum (Lanchester's square law makes these add). Loot is split in proportion to it, rounded down per player, and the remainder goes to the player with the most power standing. Loot grows with the square of a kingdom's power. (#65)
- The bank sells gold at the normal rate.
- Titles go to the single leader once they reach a minimum (in `src/data.ts`); the holder keeps one on a tie.
- Resource counts are hidden; hand sizes are public. A card offered in a trade is shown to everyone.
- Trade offers expire at the end of the acting player's turn, but the acting player must answer (accept or decline) every offer made to them before ending it.
- The action card list: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn (extra raid), Secret Hoard (hidden point), plus dragons. Six of the twelve allowed effects.
- Fauna (provisional, PR for issue #66): three beasts (Wolf Pack, Cave Bear, Basilisk), one per 8 land hexes at the start, none within 1 step of a tower, stronger further from the towers. Clearing happens on your own turn in the action phase, with your own dragons only, and is fought to the end like a raid; the dragons sent sit out that round's raids. A lost fight leaves the beast at full health. "Produces nothing" covers dice and made resources; a building under fauna keeps its points and dragon room. Two fauna cards, one action effect (put a beast on any land hex but a tower): Wolf Call (2 copies) and Rouse the Bear (1 copy), the rarest action cards and among the dearest, gold-heavy. The Basilisk is never sent by a card. (Changed in #139: see "Fauna wanders" above.) Seven of the twelve allowed effects.
- Great beasts (provisional, PR for issue #67): a great beast holds its own hex and every hex next to it, so one rule covers both "nobody builds on or next to the peak" and the serpent's harbour (no port can be built there, so none works). The sea serpent is the Leviathan, to keep it apart from Tidewatch's Sea Serpent defenders; it sits in the ocean beside a random coast's harbor. The Thunderbird is weak to ice (strong against lightning, air, water), the Leviathan to lightning (strong against water, fire, ice). The peak bonus is +2 to each production building on or next to the peak, a Workshop's worth. One try at a great beast per player per round, across both.
