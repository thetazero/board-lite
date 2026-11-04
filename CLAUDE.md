# board-lite

Start with `README.md`. Before and after changing any tuning number in `src/data.ts`, or a rule that affects them, read `docs/datasheet.md`: payback rounds, cost per point and raid odds, generated from the code. Run `npm run datasheet` after the change and check the diff; `npm test` fails until it's regenerated.

Before writing or changing any text a player reads (cards, buttons, the TV, the phone, `docs/rules.md`, the CLI's view and errors), read `docs/wording.md` and follow it.

The owner's rule for every change: "design simple core system that work well, not add a million edge cases." Fix the system behind a problem, not each symptom. Also from the owner: "make no mistakes".
