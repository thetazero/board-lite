# Design decisions log

Provisional design calls made without the owner present, newest first. Each entry: the call, why, and what would change it. The owner reviews these; any can be reversed.

## 2026-11-02: complexity budget

- **Call:** the hard ceilings in `docs/design.md` under "Complexity budget".
- **Why:** the owner asked for complexity maximums to keep the game board-game-like and to stop playtest fixes from piling on edge cases. The numbers are sized so the whole ruleset can be taught in a few minutes at a table: Catan-scale resources, a handful of building and card types, one-sentence cards.
- **What would change it:** playtests showing the game is too thin within these limits (e.g. Haiku keeps up with Opus because there aren't enough meaningful choices), and no simpler change fixes that.
