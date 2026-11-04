# Wording: how board-lite talks

Every word a player reads (the TV, the phone, the cards, `docs/rules.md`, the CLI's view and errors) follows this guide. It's based on how published board games word their cards, rulebooks and player aids; the research is in the PR that added it (#75), and the sources are listed at the end.

The game should read like a well-edited board game: the box's rulebook, the cards in your hand and the reference card by your seat all use the same few words, the same way, in the same voice.

## The five rules

1. **Talk to the player as "you", in the present tense, in the active voice.** "You draw 1 action card." "Ada builds a Quarry." Not "A card is drawn", not "Ada built a Quarry". Other players are named, or "each other player" or "everyone". A player whose pronoun is needed is "they".
2. **Tell people what to do with imperatives.** Card text and buttons are commands: "Gain 2 gold.", "Place a Wolf Pack on…", "Build", "Choose a hex for the Quarry." Don't ask the player a question to tell them what to do ("Send the Cave Bear where?", "Who's going?"), and don't say "you should" or "you can now".
3. **Same thing, same words.** One name for each thing, used everywhere: a card's verb is its button's verb and its log line's verb; a rules step's name is its heading on the TV and the phone. A different word means a different thing.
4. **Numbers as numerals.** "Gain 2 gold", "1 extra step", "First to 20 points wins". Not "two gold", not "one more raid". (A sentence doesn't start with a numeral, and "one of your dragons" is a pronoun, not a count.)
5. **Plain and short.** Cut words until the meaning would change. No "it" or "they" whose thing isn't on the same line. An exclamation mark only for the game's end ("Ada wins!").

## Kinds of text

| Kind | Form | Examples |
|---|---|---|
| **Card text** | One or two sentences, capitalized and full-stopped. An effect you carry out is an imperative ("Gain 3 of one resource other than gold."); a lasting effect is a present-tense statement ("Makes 1 timber each round for each adjacent forest hex.", "Worth 1 point while in your hand."). | Windfall, Lumber Camp, Secret Hoard |
| **Button** | A verb, plus its object only when the screen doesn't already show it. The verb is the card's or the rules' own. Sentence case, no full stop. | "Build", "Play", "Hatch", "Place", "Send 2 dragons", "End turn", "Accept" |
| **Prompt** (what to do now, above a choice) | An imperative naming the choice: "Choose a <thing> for <what>". No question marks. | "Choose a hex for the Quarry", "Choose a building for the Workshop", "Choose a beast to clear" |
| **Heading / phase name** | The rules' name for the step, sentence case, no full stop. | "Production", "Actions", "Vote", "Commit", "Fight or bail", "End of round" |
| **Status** (what someone is doing, on a TV panel or the phone's top bar) | Sentence case, present tense, short: a present participle for what a player is doing. The TV's top bar names the phase (a heading), never a sentence. | "Taking a turn", "Voting", "Keeping a card" |
| **State tag** (a dragon or building, at a glance) | Sentence case, one or two words: why it's out of play. | "Hungry", "Healing 2", "Fought" (cleared fauna this round) |
| **Event** (the log, the TV feed, banners) | Present tense, third person, a statement: what just happened as if narrating the table. | "Ada builds a Quarry.", "Brindle falls", "Dax bails", "No one raids" |
| **Why you can't** (a greyed card, an error) | A statement of the reason, then, if there's a fix, a colon and an imperative. Full stop. | "No room for another dragon: build a roost first.", "You can't afford 2 stone." |
| **Rules** (`docs/rules.md`) | Second person, present tense, as above; "may" for a choice, no "should", and "must" only where breaking it is possible and matters. | "On your turn, you may play an action card." |

## The game's words

Use these and only these for each thing. Game terms are lower case in running text ("a roost", "the raid"); names of cards, buildings, beasts, kingdoms, dragons and titles are capitalized ("a Cave Bear", "the Quarry", "Strongest Dragon Army").

| Say | Not | Meaning |
|---|---|---|
| **gain** | get, receive, take (from the supply) | You get resources from the supply or the bank. "take" is for loot and titles ("Ada takes Tallest Tower") |
| **make** (a building) | produce, yield, give | What a building brings in each round: "Makes 1d6 stone each round." (The phase is still called **production**.) |
| **each round** | a round, per round, every round | How often |
| **adjacent** | neighbouring, next to, touching | Hexes sharing an edge. The rules' word for what building cards count |
| **place** (a beast) | put, send | Putting a beast on a hex with Wolf Call or Rouse the Bear |
| **send** (dragons) | commit, go | Dragons you put into a raid or against a beast. "Commit" stays the name of the raid step |
| **clear** (fauna) | hunt, fight | Sending dragons against a beast on the map |
| **slay** (a great beast) | kill, defeat | Clearing the Thunderbird or the Leviathan: a great beast is slain, for good |
| **sit out** | miss, rest, skip | A dragon that can't raid this round |
| **raid-ready** | fit, able | A hatched, unhurt dragon not sitting out |
| **beast**, **fauna** | animal, monster | One wild creature on a hex is a beast; all of them, and the rules about them, are fauna |
| **kingdom** | target, town | What a raid attacks. "target" only in the vote ("vote for a target") |
| **falls** / **holds** | is defeated, wins, survives | A kingdom's or a beast's fate after a fight |
| **bail** | flee, retreat, leave | Pulling out of a raid before the fight |
| **no one** | nobody | No player |
| **keep** | pick, choose (a card) | Keeping 1 of the 2 building cards drawn |
| **empty** (hex) | open, free | A land hex with no building and no beast |
| **weak to** / **strong against** (an element) | ×2, ½, resists, shrugs off | A beast or defender that takes double or half damage from an element: "Weak to ice", "Strong against air and lightning" |
| **Health**, **Attack**, **Power** | a heart, swords, a shield | A stat, always said with its name: "Health 10", "Attack 1d6 on 2 targets", "Power 9" |
| **loot** | prize, reward | What a fight pays, labelled "Loot" beside it |
| **crystal field** | ley line, ley | The purple terrain crystal comes from, every time. One hex of it is a "crystal field hex" |
| **<terrain> hex** ("meadow hex", "forest hex") | a bare "meadow", "forest" | A hex of a terrain, built on or not, when a card counts it or a building must go on it. |
| **<resource> building** ("livestock building", "stone building") | pasture, quarry, lumber camp, mine (for a class) | Every building of a class: the basic building and the cards that make the same resource. A card that counts buildings says "building"; one that counts terrain says "hex", so the two never read alike (a Pasture stands on a meadow hex; "adjacent pasture" and "adjacent meadow" read the same) |

Spelling is American ("harbor", "color"), to match the terrain and code names the CLI shows.

## Icons

Few icons, for the things the game names over and over: the five resources and points (the owner, 2026-11-03: "use icons for core resources, there should not be that many icons"). Everything else is words: dice are "1d6", as the rules write them; a stat is its name and number; a raid step is its name; an element in a stat line is its name. A picture of a thing (a building, a beast, a dragon, a die rolling) is art, not an icon standing for a word, and stays. What a player types is shown as typed: no icons in table talk.

## Checks before you add text

- Does the button use the same verb as the card or the rule it carries out?
- Is a "?" telling the player what to do? Make it an imperative.
- Is there an "it" or "they" whose thing isn't named nearby?
- Is there a number written as a word, or a term from the "Not" column above?
- Does the TV say the same thing the phone says, in the same words?
- Is an icon standing for a word that isn't a resource or points? Write the word.

## Sources

What published games do, which these rules follow:

- **Second person, present tense, active voice; "may" for choices, "must" for requirements.** The Catan rulebook (25th anniversary edition, Catan GmbH / Catan Studio, 2020): "On your turn, you can do the following… You must roll for resource production", "You may trade resource cards with other players", "If you roll a '7,' no one receives any resources. Then you must move the robber", "If you have 10 or more victory points during your turn, the game ends and you are the winner!" [PDF](https://cdn.shopify.com/s/files/1/0024/8617/3749/files/catan-25th-rules_eng-200313.pdf)
- **A house style guide: "you", numerals, "gain", no "should", introduce terms before using them.** Stonemaier Games' rulebook style guide (Jamey Stegmaier): address a single player in active voice ("Whenever you gain resources, place them on your player mat."), "Use numerals whenever possible (but not at the beginning of a sentence)", use "gain" not "take" for the supply, "Remove all instances of 'should'", use singular "they", and one term per thing ("A 'mat' is unique to a player. A 'board' is available to all players."). [stonemaiergames.com](https://stonemaiergames.com/?p=14043)
- **Card text as terse imperatives and statements.** Dominion (Donald X. Vaccarino, Rio Grande Games): Workshop "Gain a card costing up to $4."; Witch "+2 Cards. Each other player gains a Curse."; Village "+1 Card +2 Actions". [Dominion Strategy card list](https://dominionstrategy.com/card-lists/dominion-card-list/), [wiki](https://wiki.dominionstrategy.com/index.php/Village)
- **Templating: the same effect always gets the same words, and different words mean a different effect.** SlugFest Games, "RulesFest: Templating and Why it's Useful": "if two cards are worded differently, it is because the game designers intend for the cards to function differently." [slugfestgames.com](https://slugfestgames.com/?p=1469). Wizards of the Coast keep a written card text style guide for Magic for the same reason: "It's all about increasing consistency over time." (Mark Rosewater, "Text Me Maybe", 2013) [magic.wizards.com](https://magic.wizards.com/en/news/making-magic/text-me-maybe-2013-12-19)
- **Standardize terms in a glossary, apply capitalization and formatting rules consistently.** Meeple Mountain, "Top Six Rules for Writing Rulebooks": "focus on making all the terminology consistent throughout your rulebook", "Overall your goal for rulebook writing is clarity and consistency." [meeplemountain.com](https://www.meeplemountain.com/top-six/top-six-rules-for-writing-rulebooks)
- **Timed powers in a capitalized lead-in, then imperative text.** Wingspan (Elizabeth Hargrave, Stonemaier Games): "ONCE BETWEEN TURNS: When another player takes the 'gain food' action, gain 1 [food] from the birdfeeder at the end of their turn." [Board Game Arena help](https://en.doc.boardgamearena.com/Gamehelpwingspan)
- **"Adjacent" as the board-game word for touching hexes.** Catan: "the owners of adjacent settlements and cities do not receive resources" (rulebook above).
