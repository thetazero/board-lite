# Design decisions log

Provisional design calls made without the owner present, newest first. Each entry: the call, why, and what would change it. The owner reviews these; any can be reversed.

## 2026-11-03: why players barely traded, and the economy fix (issue #6)

Made with the owner in the loop; their calls are quoted.

**Diagnosis: the design, not the players.** The first batch (Opus vs Haiku) had 0 to 3 accepted player trades a game and up to 23 bank trades. Two controls on the same seeds (2-player games, 4 each):

| Table | Offers | Accepted | Bank trades |
|---|---|---|---|
| Opus vs Haiku (first batch) | 20 | 5 | 28 |
| Opus vs Opus | 18 | 7 | 36 |
| Opus vs Opus, told "trading is often positive-sum" | 28 | 8 | 20 |

Two strong players don't trade more. Telling them trading pays makes them *propose* more but barely *close* more. What they wanted was the same everywhere: across the first batch, 60 of the 111 resources bought from the bank were stone, while what they paid in was crystal (140) and livestock (91). Everyone was short of the same thing and had spare of the same things, so there was no one to swap with ("Sorry, I'm short on stone myself"). Three things in the rules made positions identical and self-sufficiency cheap:

1. every tower had one hex of each terrain next to it, so the land to make any resource was always at hand;
2. a production building cost 3 and made 3 a round, paying for itself in one round, so building your own missing resource (even as a special project at double cost) beat finding a partner;
3. 1 + d3 production barely varied, so supplies stayed even.

- **Call:** the land around towers is random, like the rest of the map ("lets just remove the setup ring"). **Why:** different starting land means different things to sell. The tower's 1 of each stays ("some base seems reasonable"), so nobody is locked out. It's one setup rule fewer. **What would change it:** playtests where a player starts with no useful land and nobody to trade with. A guaranteed pair of terrains per tower ("homelands") would be the fallback.
- **Call:** production buildings roll a plain d6 instead of 1 + d3 ("make peoples production more volatile, like lower base, higher variance rolls"). **Why:** swingier rounds mean one player has a glut while another is short, which is what a trade needs. Average goes from 3 to 3.5. A Workshop still adds 1.
- **Call:** production buildings cost 8, spread over the three resources they don't make, and players start with 3 of each instead of 2. **Why:** "the roi is just way way too high": at cost 3 a building paid back in under a round, so every card was built and every gap self-filled. At 8 it pays back in about 2.3 rounds, so late building is a real choice, and a special project (16) is usually worse than a trade. Starting with 3 of each (4 with the first round's tower income) still lets everyone build one in round 1. Random-bot games went from a median of 8 rounds to 10.
- **Left alone:** other buildings' costs (stone is still the most wanted resource across the decks, livestock less so because dragons eat it every round), the 4:1 bank, markets and the Caravan Post.
- **Harness, not rules:** in a playtest, `wait` on your own turn with an offer out now waits for an answer. Before, players made an offer and ended the turn before the other could reply (8 of 40 offers in the first batch expired). The runner also takes `--advice` for prompt A/B tests like the one above.

## 2026-11-03: playtest memory limit

- **Call:** playtests take seat slots from one machine-wide pool (6 Claude seats at once by default, plus a free-memory check), and games beyond it queue instead of starting. **Why:** on 2026-11-02 two tabs each started an 8-game batch all at once, about 40 Claude processes, and systemd-oomd killed the terminal holding every tab. A per-batch limit can't stop that, because tabs don't know about each other's batches; a pool in `~/.cache` shared through files can, with no daemon. 6 seats is about 2.7 GB, which fits next to the ~9 GB the tabs, orchestrator and browser already use on the 14 GB machine. **What would change it:** a bigger machine, or measurements showing seats use much less memory than 450 MB.

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
