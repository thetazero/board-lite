# Design decisions log

Provisional design calls made without the owner present, newest first. Each entry: the call, why, and what would change it. The owner reviews these; any can be reversed.

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
