# board-lite

Start with `README.md`. Before and after changing any tuning number in `src/data.ts`, or a rule that affects them, read `docs/datasheet.md`: the raw rules (every cost, output, stat and point), generated from the code, with nothing simulated. Run `npm run datasheet` after the change and check the diff; `npm test` fails until it's regenerated.

Before writing or changing any text a player reads (cards, buttons, the TV, the phone, `docs/rules.md`, the CLI's view and errors), read `docs/wording.md` and follow it.

Before changing a rule, read the design principles and complexity budget at the top of `docs/design.md`. A change has to stay within the budget; one that raises a ceiling says why in its PR.

A script that drives the TV or phone pages in a browser starts Chrome with `launchChrome()` from `src/browser.ts` (or playwright's `chromium.launch()`), never with `--remote-debugging-port`, so the browser goes when the script does; see "Browsers in scripts" in `docs/clients.md`.

To check a change with screenshots, shoot only the screens it touched: `npm run shots -- --only <name>` (`--list` shows the names). Not `--all` or `--every-size` of everything unless a full audit is asked for; see `docs/clients.md`.

A PR that changes anything a player sees (the TV, the phone, the CLI's view) shows it: screenshots of each changed screen, embedded as images in the PR description, before and after where there was a before. A UI PR without them isn't ready for review. Put them at the top of the description, so a reviewer at normal zoom can compare without scrolling. For each change, compose before and after into one image: before over after, or side by side, whichever reads better for that shot. Crop to what changed, label the halves "Before" and "After", and caption it in one line saying what to look at. No tables of separate images. Keep the text below short; longer reasoning goes in a `<details>` block.
