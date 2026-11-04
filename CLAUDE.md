# board-lite

Start with `README.md`. Before and after changing any tuning number in `src/data.ts`, or a rule that affects them, read `docs/datasheet.md`: the raw rules (every cost, output, stat and point), generated from the code, with nothing simulated. Run `npm run datasheet` after the change and check the diff; `npm test` fails until it's regenerated.

Before writing or changing any text a player reads (cards, buttons, the TV, the phone, `docs/rules.md`, the CLI's view and errors), read `docs/wording.md` and follow it.

Before changing a rule, read the design principles and complexity budget at the top of `docs/design.md`. A change has to stay within the budget; one that raises a ceiling says why in its PR.
