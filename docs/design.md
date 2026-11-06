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
- At most 8 raid unit types, each just stats plus an element. (6 until #321, raised for the two point-scoring kingdoms' leaders, the Fire Giant and the Titan: the owner asked for "some new strong enemies that are 2/3rds of the CP here... a single unit".)
- At most 3 kinds of fauna, each just stats, an element, and its loot.
- At most 2 great beasts, each just stats, an element, its points, and where it lives.
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
- Fauna wanders (#139): in production, each beast that isn't a great beast has a 1 in 3 chance to move to a random adjacent land hex with no tower or beast. The fauna cards send the stronger beasts (Wolf Call a Cave Bear, Rouse the Bear a Basilisk), cost 1 crystal each, and come more often (4 and 2 copies; 8 and 4 since the action deck doubled in #201). A beast a card sent gives no loot, so placing one never hands a rival a prize. Since #231 each card is named for the beast it places: Rouse the Bear places the Cave Bear, Wake the Basilisk the Basilisk (Wolf Call is gone; no card places wolves). Since #273 a beast that moves is twice as likely to pick an open hex beside no other beast, so the fauna tends to spread out instead of bunching up by chance. The owner asked for "not hard rule, a tendancy", and on a first version that always picked the least crowded hex: "too strong, I still want randomness, just biased towards empty tiles". The odds of moving and the one-step move stay, only the pick of where is weighted.
- Limits: "you want some of this, you explicitly want a bit of this just like in catan, you just don't want to over do it. these action cards should be rarer and more expensive".

### Perching dragons

The owner (2026-11-04, #217): "what yorue missing is a very interesting dynamic, if I want to block two tiles I need to split my dragons, but then they can be picked off." Their rules:

- On your turn a dragon may perch on a rival's building instead of raiding or clearing. While one perches there, the building is suppressed, as under a beast. It stays until its owner recalls it or it's driven off.
- A suppressed building (a beast or a perched dragon on it) counts as if it weren't there, except that its hex stays taken (#352). The owner: "I want perching to be more viable", "it should be basically as if it were not there". More dragons than room only stops hatching: "no penalty is necessary beyond that".
- Anyone can attack perched dragons, in the same fight as fauna. Several dragons may perch on one building, from different players too, and they fight together.
- Perched dragons take damage and heal as anywhere else: "no insta heal like fauna because they are not fauna". A hurt one keeps blocking while it heals.
- It sits alongside Rouse the Bear and Wake the Basilisk ("alongside"): a rule added without one cut, the owner's call.
- Nothing can block the wizard tower, neither dragons nor fauna, "to avoid softlock".

Filled in provisionally (reasoning in the PR for #217): a dragon perches only if it's raid-ready, and a recalled one may raid that round if it isn't knocked out; a perched dragon is driven off by being knocked out, and goes home; clearing a hex fights everything holding it at once (a beast that wandered onto a perched building fights beside the dragons there); your own perched dragons are never your foes, so you can't clear a hex where only yours perch; a perched building keeps its points and dragon room, as under a beast (until #352).

### Great beasts

The owner (2026-11-03): "great beasts that are hard to kill and give 1 VP for killing. 1. thunderbird on a mountain at the center of the map (this mountain should have some special modifier) 2. some sea serpent in the ocean". They are the top tier of the fauna.

- A race: "they do not, it's a race". A slain beast never comes back.
- Fights: "fauna fights should be 1 player and a time and it should heal up between fights". Fought like fauna, to the end with no bail, as one of each dragon's choices for the round (raid, hunt fauna, or hunt a beast), with one attempt per player per round, in turn order. (Changed in #262: a dragon fights whenever it has health left, so clearing no longer costs the round's raids; the one try a round at a great beast stays.)
- Each beast has an elemental weakness, so "the race is to get the right dragons, not the most dragons", and "a well-built force should be able to win around round 8–10, not round 4" (proposed by the orchestrator; the owner: "Yup I like it").
- The centre mountain: nobody builds on or next to the peak while the Thunderbird lives; once it's slain, buildings next to the peak produce more ("Right I think a production bonus makes sense").
- The sea serpent prowls one coast, and the harbour there produces nothing until it's killed ("I like it").
- Since #339 the Leviathan moves every round: "I feel like it should move to a random tile every turn. With the same [pseudo random] pushing it to go somewhere further away, but not always further away." In production it moves to a random other ocean hex, each weighted by its distance from where it is (so a hex twice as far is twice as likely), and keeps to the ocean hexes whose hold stays clear of the towers' adjacent hexes, as its starting spot always did. It holds wherever it is now: a port built while it was away keeps working when it comes back (the hold only stops building, as before). On the TV it dives and comes up at its new hex a few seconds later ("sink into the ocean, or swim into the ocean, or really dive, and then pop back out a few seconds later").
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
- N is 50 (30 until #316, 20 until #134, 15 before that). The owner, after a 13-round playtest ended at 30 (2026-11): "it felt like it ended before it got satisfying", "let's make it 50, and raise title value by 1 as well". #134 roughly doubled every point source, so 30 keeps the game about as long. N went from 15 to 20 "a bit", as the owner asked. Buildings pay back more slowly to match: a basic production building in about 4.5 rounds, so one built early pays for itself by the middle of the game and earns about twice its cost by the end (`docs/datasheet.md`).
- Point sources:
  - Not dragons: they are worth no points (1 / 2 / 3 by life stage until #134). The owner (2026-11-04): "let's make titles worth 3 points, drop dragon VPs", and "dragons worth [no] VPs ... Largest army unchanged, we can go off combat rating or something like that". Dragons count toward the army title instead.
  - Production buildings: every stone, timber, crystal and livestock building, basic or card, is worth 1 point (#134). The owner (2026-11-04): "engine building games tie points to engine building". (From #98 until then only monuments were worth points: "VP buildings should be expensive monuments only".) The Market makes gold but is a trade building, and is worth no points; nor are tower floors, upgrades, roosts, hatcheries or ports.
  - Monuments (Monument, Standing Stones, Lighthouse, Guildhall): a flat 2 points each, with no neighbour counting (#134). Each must be built adjacent to at least one of what it used to count: a monument (the tower is one), a crystal field hex, an ocean hex, a trade building. They cost 11 stone, timber and crystal and no gold: the owner, "they should be 50% more efficient than the cheap card variant at point gen", against a production card's 8 resources for 1 point. Until #134 they cost 20 gold (to keep gold from turning cheaply into points: "4 fold for 2 points is just insane right?"); raid gold stays big ("raids are supposed to be gold farms and large amounts of gold feels good").
  - Hidden points on action cards, kept in hand until the end (they count toward the 7-card cap). Secret Hoard is worth 2 (1 until #134): the owner, "fair since it hogs slots in your hand".
  - Titles that change hands, like Catan's "longest road": strongest dragon army, tallest tower, largest hoard (#109), 7 points each (6 until #316, 3 until the point-scale PR of #134, 2 before). The army title goes to the most combat power across a player's dragons (most dragon points until #134). Kept to these three. Largest territory is dropped: "it just intensifies ecomic snowball, while talesr tower is: 1. literally visually cool 2. a side quest/resource sink" (owner, 2026-11-03). Tower floors count toward the tower title, and each houses 1 dragon (#323; the owner: "yes 1 dragon capacity per floor pls", so the tower isn't only a title chase).
  - Titles take real investment. The owner, of the army and territory titles: "strongest army and largest territory need a larger threshold".
  - Great beasts: slaying one is worth 4 points (2 until #134, 1 until #80).
  - The top two kingdoms (#321): Cinderkeep (about 70 combat power) scores 1 point and Titan's Throne (about 120) 2, every time one falls, for the raider with the most combat power still fighting at the end, counted at each dragon's stage power, not weighted by health. Every other raid gives loot only. The owner: "how to make late game dragons give VPs, that push you over the edge to victory. at around 1 VP a round max", "how about most CP left standing?", "correct it should not be healthy weighted, no new rule". It's a way to score that needs no land: at 50 points, bot games stalled with the board full and the leader at 40–46. Each is led by one strong unit worth about two thirds of its power (the Fire Giant 50, the Titan 79), "so it's actually a real challenge with casualties", but not so hard a big army can't take it alone. No cap: "if you can grind through 140CP worth of stuff in a round good for you". Their loot follows the same curve as the rest ("lots of loot, scaling just as before"), so voting for one is a choice between loot for everyone and points for the biggest army: "gold glut is the point? this is a dragon game."

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
- Building classes so far: one per resource (stone, timber, crystal and livestock buildings, each holding its basic building: quarry, lumber camp, crystal mine, pasture), dragon buildings (roost, hatchery), monuments (tower floors and other point buildings), trade buildings (ports: 2:1 with the merchants for one basic resource each; market). No defense buildings (see Raids).
- The Market makes 1 gold a round for each of its owner's own adjacent production buildings, up to 3 (#305), with 3 copies; it used to count anyone's adjacent trade buildings. The owner: "I still want raids to be primary source of gold, but someone with a really strong engine should be able to push gold up." Its high cost stays ("keep the high market cost"). The Trade Charter upgrade (1 more gold a round on a port or market, for 4 stone and 8 gold) is cut: the owner called it "kinda shit".

### Special projects

- Always-available "special projects" let a player get unstuck on all the basic things without a card, such as building the basic buildings or getting a base dragon of each element. (With the basic buildings no longer cards, only the base egg was left as a special project.) Since #350 a Workshop is one too, so the 4 Workshop cards can't all sit with one player: in a 25-round playtest one player held all 4 by round 6 and production flattened for everyone. The owner: "I want a workshop basic project, which is 2x as expensive as the card".
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
  2. Fight or hold back: each committed player makes a binary choice, fight or hold back, with no information shared. Dragons held back stay out of the combat and take no hits, and still share the loot (#386).
- Intended dynamic: a player can commit publicly to draw others in, then secretly hold back, leaving the fight weaker than everyone expected. This is deliberate, not an exploit to fix ("that consequence is exactly the dynamic I want").
- Hold back replaced bail in #386. Bailing gave nothing, so it paid only when the fight's cost outweighed your share, which almost never happened: in every playtest, 4 bails in 32 two-seat choices, 1 in 234 three-seat, 0 in 89 five-seat. The owner: "Also nobody ever bails", and "just generally some way to free ride… Loot is still split the same way. via combat power. But on top of that, you just don't participate in the combat phase." Points go the same way as loot ("If you do one as no, then it doesn't work as free riding"). Holding back pays whenever the raid would win without you; you fight when it needs you, and a fighter knocked out gets nothing.
- Loot is split by combat power (see Combat).
- Easy raids give almost nothing, hard ones a lot. The owner (2026-11-03): "right I think the way raids should work is easy ones give almost nothing, hard ones give a lot. And there should be a "combat power" estimate on dragons and on the raid target, so players can judge at a glance."
- Combat power: one number on each dragon and each raid target, readable at a glance. It stays a rough guide on purpose and there is no win-chance display: "Yup steeper curve, the single number misleads is literally the point, you want players to still have to think and guess".
- The raid choice stays the single vote, one target a raid phase (the owner: "the current vote"). The sabotage the owner wants is backing out of the harder, richer target with the secret choice (a bail until #386, now holding back): "I think the interesting dynamic comes in when you try to pick which raid to take and people back out of the harder more loot one to sabotage, etc..."
- Targets have units with stats and an element.
- Fleeing: a dragon's flee strength is rolled against the defenders' chase strength. A dragon that flees leaves the fight either way; failing the roll means it takes damage scaled by how badly it lost. *(Provisionally removed: holding back, secretly, before the fight is the only way to keep out of a raid's combat. Reasoning in the pull request for issue #5.)*

### Combat

- Classic damage rolls: each dragon has a number of targets, a number of dice, and how many sides each die has.
- Classic turn-based combat: dragons and defending units alternate sides.
- Targeting is simple and automatic; the rule is printed on the dragon card (e.g. lowest health, strongest attacker, random, a unit weak to my element).
- Dragons and units have health. Dragon health, like its attack stats, depends on life stage; the card lists stats per life stage.
- Elements (#223): double damage when the attacker's element beats the target's. That's the only element effect: nothing deals half, and there's no "strong against". The owner: "There's also this weird atacker/defender dynamic, I feel like for a casual board game it's too complicated. wdyt about a consolidationt to just double damage, that's it, against the thing you are atacking if you have the 'ice beats ligtnight' style buff". It works both ways (foes whose element beats a dragon's hit it for double) and for dragons fighting dragons; neutral never deals or takes double.
- The element wheel (#223): each element beats exactly one other, water → fire → ice → air → lightning → water. An earlier chart had ice beating both lightning and air while air beat nothing; the wheel fixes that.
- One element chart for everything that fights (the owner, 2026-11-04, #217): "there should be one list. at the element level, this list is used by anything that has an element, in a shared manner. there is no special dual lane combat system", and a "neutral" element "that is just neutral against everything". Every dragon, defender, beast and great beast has an element, and the chart applies to every hit, whichever side strikes. It was per-unit lists of weaknesses and strengths, and defenders' hits ignored elements. Since #223 the chart is the wheel above. Defenders and beasts with no theme are neutral (Militia, Archers, Knights, Wolf Pack, Cave Bear, and the Basilisk: "basilisk is neutral"); the Frost Golem is ice, the Storm Griffin and the Thunderbird air, the Sea Serpent and the Leviathan water.
- After each round of combat, players get 10 seconds to choose whether to roll to flee. *(Provisionally removed with fleeing, above.)*
- Healing: healing time scales with health lost, measured in global rounds, and is slow enough that being left in a losing raid stings. The owner (2026-11-03): "I think to make that sting heal times need to be increased (healing rate decreased)".
- Loot is split among players whose dragons were still fighting at the end, by the combat power each still has fighting. The owner, on the even split: "Also I feel like raiding has a free rider problem, that is un fun? weak players should always just follow the strong one in, and if the strong bails not much happens? wdyt? Like some free rider is good but this feels like a flat dynamic". Their call ("let's try A"): split loot by combat power still standing at the end. Since #386 that counts every committed dragon not knocked out, held back or not (the owner: "maybe instead of still fighting in the end, it should be still conscious").
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

- Each player starts with a tower hex, some resources, and a Fire Dragon egg. The owner (2026-11-04): every player starts with a Fire Dragon "so nobody has an unfair elemental advantage early" (#217); it was a random base dragon.
- Tower placement is fixed by player count.

## Trading

- Players trade with each other (resources and cards).
- The merchants ("the bank" before #286) trade at 4:1, like Catan. A port trades one basic resource at 2:1: a Stone, Timber, Crystal and Livestock Port, one card each, built on a harbor (#277). They replaced the generic 3:1 Port so players get good at turning one resource into others and have a reason to buy it from the table. The owner: "sure we can replace the generic 3:1 with specifics"; no gold port, "gold is not a basic resource".
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
- Basic buildings: the four production buildings and the roost are built without a card at the price they had as cards. The tower floor is basic too, paid mostly in gold (since #98, floors are worth points only through the tower title; since #323 each houses 1 dragon). Building cards' effects count their six neighbouring hexes (a terrain, or a class of building, anyone's), multiplying a flat effect; that one rule covers every neighbour card.
- Winning: checked at the end of each round, not mid-turn; highest total wins; ties go to most gold, then turn order.
- The first player rotates each round.
- The tower produces 1 of each non-gold resource and houses 1 dragon, plus 1 per floor (#323).
- Only production buildings are tied to terrain; other buildings go on any free hex.
- One upgrade per building; the tower counts as a monument and a dragon building.
- The special projects are a base egg of any element and a Workshop, each at double its card.
- Dragon cards hatch as eggs. Every dragon, eggs included, eats 1 livestock per round, in order of hatching.
- Healing: every fed dragon that is hurt heals a fixed amount at production (7 health, in `src/data.ts`). The owner (#262): "dragons can fight whenever they have positive health. knocked out drags should be greyed out and clearly indicated": a hurt dragon fights with the health it has left, so the hits it takes are a cost it carries into its next fights; only a knocked-out one (0 health) can't fight, until a fed production heals it. Nothing sits out any more: not a hurt dragon, not a hungry one, not one that cleared a hex. Combat power stays as printed; the health bar shows the damage (the owner: "feature not bug"). (Changed in #262 from sitting out a raid round per 7 damage.) The owner (#234): "dragons should not grow while they are healing up... and should not heal while out of food": a hurt dragon heals instead of growing, and a hungry one does neither. Dragons never die: at 0 health they are knocked out and heal at home. (Changed in #65 from healing fully each round.)
- Combat: a coin flip as each fight starts decides which side strikes first each round, the dragons or the defenders (beasts and perched dragons, when clearing a hex); then the other side strikes, until one side has fallen. Once per fight, for every fight. (#380; until then the dragons always struck first. The owner: "'dragons on the attack strike first' feels wrong, can we make who fights first a coin flip", "Once per fight".) No fleeing mid-fight; holding back before it is the only way to stay out.
- Raid votes are public as they're cast, and every player votes. (Changed in #238 from secret until everyone had voted.) Each vote counts the voter's raid-ready dragons' combat power, summed: the owner (#307), "raid voting should be combat power weighted". Raid-ready only, since that's all a voter could send. (Changed from one vote each.) A player with no raid-ready dragon skips the commit step.
- Combat power is √(health × average damage a combat round), rounded; a side's is the sum (Lanchester's square law makes these add). Loot is split in proportion to it, rounded down per player, and the remainder goes to the player with the most power standing. Loot grows with the square of a kingdom's power. (#65)
- The merchants don't trade gold, either way (#279). The owner: "Just remove gold from bank trades pls". Gold comes only from raids, Markets and clearing fauna, so what it buys (tower floors, Markets, wyrms, Growth Elixir, Largest Hoard) can't be bought with ordinary resources. (Changed from selling gold at the normal rate.)
- Titles go to the single leader once they reach a minimum (in `src/data.ts`); the holder keeps one on a tie.
- Resource counts are hidden; hand sizes are public. A card offered in a trade is shown to everyone.
- Trade offers expire at the end of the acting player's turn, but the acting player must answer (accept or decline) every offer made to them before ending it.
- The action card list: Windfall, Buried Treasure, Growth Elixir, Healing Potion, War Horn (extra raid), Secret Hoard (hidden point), plus dragons. Six of the twelve allowed effects.
- Fauna (provisional, PR for issue #66): three beasts (Wolf Pack, Cave Bear, Basilisk), one per 8 land hexes at the start, none within 1 step of a tower, stronger further from the towers. Clearing happens on your own turn in the action phase, with your own dragons only, and is fought to the end like a raid; the dragons sent sit out that round's raids (changed in #262: they may raid with the health they have left). A lost fight leaves the beast at full health. "Produces nothing" covers dice and made resources; a building under fauna keeps its points and dragon room. Two fauna cards, one action effect (put a beast on any land hex but a tower): Wolf Call (2 copies) and Rouse the Bear (1 copy), the rarest action cards and among the dearest, gold-heavy. The Basilisk is never sent by a card. (Changed in #139: see "Fauna wanders" above.) Seven of the twelve allowed effects.
- Great beasts (provisional, PR for issue #67): a great beast holds its own hex and every hex next to it, so one rule covers both "nobody builds on or next to the peak" and the serpent's harbour (no port can be built there, so none works). The sea serpent is the Leviathan, to keep it apart from Tidewatch's Sea Serpent defenders; it sits in the ocean beside a random coast's harbor. The Thunderbird is weak to ice, the Leviathan to lightning (since #223, as air and water on the element wheel). The peak bonus is +2 to each production building on or next to the peak, a Workshop's worth. One try at a great beast per player per round, across both.
