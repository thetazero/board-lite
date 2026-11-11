# Wording: how board-lite talks

Every word a player reads (the TV, the phone, the cards, `docs/rules.md`, the CLI's view and errors) follows this guide.

The game should read like a well-edited board game: the box's rulebook, the cards in your hand and the reference card by your seat all use the same few words, the same way, in the same voice.

## The five rules

1. **Talk to the player as "you", in the present tense, in the active voice.** "You draw 1 action card." "Ada builds a Quarry." Not "A card is drawn", not "Ada built a Quarry". Other players are named, or "each other player" or "everyone". A player whose pronoun is needed is "they".
2. **Tell people what to do with imperatives.** Card text and buttons are commands: "Gain 2 gold.", "Place a Wolf on…", "Build", "Choose a hex for the Quarry." Don't ask the player a question to tell them what to do ("Send the Cave Bear where?", "Who's going?"), and don't say "you should" or "you can now".
3. **Same thing, same words.** One name for each thing, used everywhere: a card's verb is its button's verb and its log line's verb; a rules step's name is its heading on the TV and the phone. A different word means a different thing.
4. **Numbers as numerals.** "Gain 2 gold", "1 extra step", "First to 20 points wins". Not "two gold", not "one more raid". (A sentence doesn't start with a numeral, and "one of your dragons" is a pronoun, not a count.)
5. **Plain and short.** Every word costs the player attention: more text, less read. Cut words until the meaning would change. An exclamation mark only for the game's end ("Ada wins!").

## The rulebook is different

`docs/rules.md` is where a player goes to understand a rule, so it isn't terse: full sentences, every case covered. Because it exists, everything else can be short.

## Kinds of text

| Kind | Form | Examples |
|---|---|---|
| **Card text** (on the card) | One or two sentences, capitalized and full-stopped. An effect you carry out is an imperative; a lasting effect is a present-tense statement. | Windfall, Lumber Camp, Secret Hoard |
| **At a glance** (previews, stat lines) | Numbers and icons, no sentence; a change is before → after. | "5 → 7 [stone]", "1 → 2 [point]" |
| **Button** | A verb, plus its object only when the screen doesn't already show it. The verb is the card's or the rules' own. Sentence case, no full stop. | "Build", "Play", "Hatch", "Place", "Send 2 dragons", "End turn", "Accept" |
| **Prompt** (what to do now, above a choice) | An imperative naming the choice: "Choose a <thing> for <what>". No question marks. Every choice among several options has one, and each option's button still carries the verb ("Gain", not a bare icon). | "Choose a hex for the Quarry", "Choose a building for the Workshop", "Choose a beast to clear", "Choose a resource to gain" |
| **Heading / phase name** | The rules' name for the step, sentence case, no full stop. | "Production", "Actions", "Vote", "Fight or hold back", "End of round" |
| **Status** (what someone is doing, on a TV panel or the phone's top bar) | Sentence case, present tense, short: a present participle for what a player is doing. The TV's top bar names the phase (a heading), never a sentence. | "Taking a turn", "Voting", "Discarding" |
| **State tag** (a dragon or building, at a glance) | Sentence case, one to four words: why it's out of play. A number in a tag says what it counts, and the tag claims only what the rules make sure of. | "Knocked out", "Perched" |
| **Event** (the log, the TV feed, banners) | Present tense, third person, a statement: what just happened as if narrating the table. | "Ada builds a Quarry.", "Brindle falls", "Dax holds back", "No one raids" |
| **Why you can't** (a greyed card, an error) | A statement of the reason, then, if there's a fix, a colon and an imperative. Full stop. Every greyed-out button has one, under it, in the words the refused command would use, except on the phone for a cost you can't pay: the cost beside the greyed button already says it. | "No room for another dragon: build a roost first.", "You can't afford 2 stone.", "Build it on your turn." |
| **Rules** (`docs/rules.md`) | Second person, present tense, as above; "may" for a choice, no "should", and "must" only where breaking it is possible and matters. | "On your turn, you may play an action card." |

## The game's words

Use these and only these for each thing. Game terms are lower case in running text ("a roost", "the raid"); names of cards, buildings, beasts, kingdoms, dragons and titles are capitalized ("a Cave Bear", "the Quarry", "Strongest Dragon Army").

| Say | Not | Meaning |
|---|---|---|
| **gain** | get, receive, take (from the supply) | You get resources from the supply or the merchants. "take" is for loot and titles ("Ada takes Tallest Tower") |
| **make** (a building) | produce, yield, give | What a building brings in each round: "Makes 1d6 stone each round." (The phase is still called **production**.) |
| **each round** | a round, per round, every round | How often |
| **adjacent** | neighbouring, next to, touching | Hexes sharing an edge. The rules' word for what building cards count |
| **place** (a beast) | put, send | Putting a beast on a hex with Rouse the Bear or Wake the Basilisk |
| **send** (dragons) | commit, go | Dragons you put against a beast or on a perch. A raid has no sending: every raid-ready dragon is in it |
| **clear** (a hex: fauna, perched dragons) | hunt, fight | Sending dragons against what holds a hex: its beast and rivals' dragons perched there |
| **perch** (a dragon, on a rival's building) | sit, block, occupy | Sending a dragon to sit on a rival's building so it's suppressed |
| **suppressed** (a building) | shut down, blocked, disabled | A building under a beast, held by a great beast, or with a dragon perched on it: it counts as if it weren't there, but nothing is built on its hex |
| **recall** (a perched dragon) | bring back, return, withdraw | Bringing a perched dragon home on your turn |
| **slay** (a great beast) | kill, defeat | Clearing the Thunderbird or the Leviathan: a great beast is slain, for good |
| **knocked out** | fainted, KO'd, dead, out | A dragon at 0 health: it can't fight until it heals. Greyed out wherever it's drawn |
| **raid-ready** | fit, able | A hatched dragon that isn't knocked out or perched |
| **beast**, **fauna** | animal, monster | One wild creature on a hex is a beast; all of them, and the rules about them, are fauna |
| **kingdom** | target, town | What a raid attacks. "target" only in the vote ("vote for a target") |
| **falls** / **holds** | is defeated, wins, survives | A kingdom's or a beast's fate after a fight |
| **hold back** | bail, hide, sit out, stay back | A player in a raid keeping some or all of their dragons out of its combat: they take no hits and still share the loot. Always "holds back", never a bare "holds", which is a kingdom's |
| **no one** | nobody | No player |
| **the merchants** | the bank, the market | Who you trade resources with at a fixed rate (4:1, or a port's 2:1). "Market" is a building, so it isn't this |
| **keep** | pick, choose (a card) | Keeping 1 of the 2 building cards drawn |
| **empty** (hex) | open, free | A land hex with no building and no beast |
| **beats** / **weak to** (an element) | ×2, strong against, resists, counters | The element wheel: an element that beats what it hits deals double damage. Anything hit (a dragon, defender or beast) is weak to the element that beats its own: "Ice beats air", "Weak to ice" |
| **Health**, **Attack**, **Power** | a heart, swords, a shield | A stat, always said with its name: "Health 10", "Attack 1d6 on 2 targets", "Power 9" |
| **loot** | prize, reward | What a fight pays, labelled "Loot" beside it |
| **crystal field** | ley line, ley | The purple terrain crystal comes from, every time. One hex of it is a "crystal field hex" |
| **<terrain> hex** ("meadow hex", "forest hex") | a bare "meadow", "forest" | A hex of a terrain, built on or not, when a card counts it or a building must go on it. |
| **<resource> building** ("livestock building", "stone building") | pasture, quarry, lumber camp, mine (for a class) | Every building of a class: the basic building and the cards that make the same resource. A card that counts buildings says "building"; one that counts terrain says "hex", so the two never read alike (a Pasture stands on a meadow hex; "adjacent pasture" and "adjacent meadow" read the same) |

Spelling is American ("harbor", "color"), to match the terrain and code names the CLI shows.

## Icons

Few kinds of icon, used freely: the five resources, points, and a dragon for what your dragons eat ("1 − 1🐉") (the owner: "the cardinality of icons should not be that high, the number should be."). Everything else is words: dice are "1d6", as the rules write them; a stat is its name and number; a raid step is its name; an element in a stat line is its name. A picture of a thing (a building, a beast, a dragon, a die rolling) is art, not an icon standing for a word, and stays. What a player types is shown as typed: no icons in table talk.

## Checks before you add text

- Does the button use the same verb as the card or the rule it carries out?
- Is a "?" telling the player what to do? Make it an imperative.
- Is there an "it" or "they" whose thing isn't named nearby?
- Is there a number written as a word, or a term from the "Not" column above?
- Would a number and an icon do instead?
- Does the TV say the same thing the phone says, in the same words?
- Is an icon standing for a word that isn't a resource, points or the dragons eating? Write the word.
