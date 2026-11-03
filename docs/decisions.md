# Design decisions log

Provisional design calls made without the owner present, newest first. Each entry: the call, why, and what would change it. The owner reviews these; any can be reversed.

## 2026-11-02: player trading (issue #6)

The first playtest batch had 0 to 3 accepted player trades a game and up to 23 bank trades. The logs show why: there was little to trade *for*.

- **Call:** each tower sits in a **homeland**, three hexes each of two production terrains, and neighbours get opposite pairs (mountain and forest beside ley and meadow). This replaces "one of each terrain around every tower". **Why:** every player produced the same mix, so everyone had surplus of the same things and was short of the same things. Trade needs one player's surplus to be another's shortage, as Catan gets from uneven placement. The tower still makes 1 of each, so nobody is ever locked out, and the rest of the map is random, so expanding toward the land you lack is still an option (and the contest for land gets sharper). Same rule length: one setup rule swapped for another. **What would change it:** playtests where one homeland pair wins much more often, or where players far apart have nobody useful to trade with.
- **Call:** the Caravan Post is cut; the Market (3:1) is the only better bank rate. **Why:** a 2:1 rate on *every* resource beat almost any deal a player would give, and it was cheap; in game 5 all three players had a Market or Caravan Post and the bank handled 23 trades. Owner decision "markets improve the rate" stands with the Market. One fewer building type (9 of 10 allowed). **What would change it:** the bank going unused even when players can't find a partner.
- **Call:** costs are spread so each basic resource is wanted about equally (across the decks: stone 41, timber 41, livestock 42, crystal 74 with dragons, plus livestock upkeep). Tower floors lean on stone, monuments on timber and livestock, dragons on crystal and livestock; each production building costs things its own homeland doesn't make. **Why:** stone was in nearly every cost (tower floor and monument 4 each, roost 3), so every player was short of stone at once and nobody would sell it ("I declined P1's and P2's gold-for-stone offers because I needed stone for floors"). Different strategies should want different things. Numbers only; no rule change.
- **Harness, not rules:** in a playtest, the acting player's `wait` now waits for an answer while they have an offer out. Before, `wait` returned at once on your own turn (it is always your decision), so players made an offer and ended the turn before anyone could reply.

## 2026-11-02: table talk and sandboxed playtests

- **Call:** talk is an engine command (`say`, `tell P2`), allowed for anyone at any time, binding no one. **Why:** at a real table people talk whenever they like, so "when the game allows talk" is simply always; one rule with no timing questions. Putting it in the game log means the TV can show table talk later and playtest logs carry the conversation next to the moves. It adds no rule beyond "promises don't bind; only accepted trades do", which the design already implied. **What would change it:** playtests where unlimited private talk during the secret bail step makes raids pointless.
- **Call:** playtest players are separate `claude -p` processes with no built-in tools and one per-seat MCP server, not subagents of the orchestrator with a restricted Bash. **Why:** a subagent inherits the orchestrator's permissions, and a Bash allow-pattern for the CLI still lets a player read the game file (every hand) or act as another seat. With no built-ins and a server whose seat is fixed, the player physically can only play its seat and talk. It also lets each seat pick its own model.

## 2026-11-02: first rules engine

The engine (issue #1) had to fill the gaps `docs/design.md` left open. The full list is in design.md's open questions; these are the calls with real reasoning behind them.

- **Call:** cards are dealt, not chosen. **Why:** smallest rule that matches "picking is free"; a draft (see 3, keep 2) is the obvious next lever if playtests show too little to decide. **What would change it:** the depth test (Haiku keeps up with Opus).
- **Call:** the win is checked at the end of the round, highest total wins. **Why:** with simultaneous raid steps and hidden points there is no clean "moment" mid-round; end of round is one rule with no timing questions.
- **Call:** the first player rotates each round. **Why:** in bot games a fixed order gave P1 about 26 wins in 40 two-player games (first pick of land each round); rotating brought it to 51/49 over 100. One short rule for fairness.
- **Call:** dragons are never killed; at 0 health they are knocked out and heal. **Why:** the design doc gives damage and healing but no death, and losing a dragon you raised for many rounds would feel bad in a casual group ("most people should leave feeling good"). Healing by a flat 8 per round gives "one round typically, longer for a badly hurt adult" without a table.
- **Call:** only production buildings care about terrain. **Why:** the doc only says terrain decides *which production building* goes there; tying the rest to terrain too would be a second placement rule.
- **Call:** every dragon, eggs included, eats 1 livestock. **Why:** an exception for eggs is a special case; one rule for all dragons is simpler.
- **Call:** the bank sells gold at the normal rate. **Why:** banning one resource from the bank would be an exception; at 4:1 raids stay the cheap way to get gold. **What would change it:** playtests where nobody raids because buying gold is good enough.
- **Call:** a player with no raid-ready dragon skips the commit step and offers expire at the end of a turn. **Why:** steps with no possible choice are skipped automatically rather than asked; stale offers would otherwise pile up.
- **Call:** all numbers (15 to win, costs, dice, stats) are first guesses. Random bots finish 2 to 6 player games in 5 to 12 rounds (median 8). **What would change it:** playtests; they all live in `src/data.ts`.

## 2026-11-02: complexity budget

- **Call:** the hard ceilings in `docs/design.md` under "Complexity budget".
- **Why:** the owner asked for complexity maximums to keep the game board-game-like and to stop playtest fixes from piling on edge cases. The numbers are sized so the whole ruleset can be taught in a few minutes at a table: Catan-scale resources, a handful of building and card types, one-sentence cards.
- **What would change it:** playtests showing the game is too thin within these limits (e.g. Haiku keeps up with Opus because there aren't enough meaningful choices), and no simpler change fixes that.
