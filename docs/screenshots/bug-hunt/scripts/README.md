# Bug hunt scripts (#107)

The scripts behind the bug hunt's findings, kept so each finding can be rerun. They aren't part of the game and nothing runs them.

They drive the real TV and phone pages in headless Chrome through `playwright-core`, which the repo doesn't depend on. Install it somewhere outside the repo and put these scripts next to it, under `~/.cache/board-lite/` (not `/tmp`):

```
mkdir -p ~/.cache/board-lite/bughunt && cd ~/.cache/board-lite/bughunt
npm init -y && npm install playwright-core@1
cp <repo>/docs/screenshots/bug-hunt/scripts/* .
```

They start Chrome with `chromium.launch()`, which drives it over a pipe, so it closes when the script ends. Keep it that way: never a Chrome started by hand on a `--remote-debugging-port` (see "Browsers in scripts" in `docs/clients.md`).

Then fix the import paths in `mkgame.ts` and `REPO` in `s8-restart.cjs` so they point at your checkout.

- `drive.cjs <base> <players> <outdir> [seed]`: a TV and one phone per seat play a whole game through the phones' buttons, with a loose random policy. It logs toasts, page errors, failed requests, stalls, and buttons something covers.
- `mkgame.ts <players> <seed> <condition> <out.json>`: a bot game played until a condition holds (`action3`, `raid2`, `nearend`, ...), saved so `npm run serve -- --game` can host it.
- `s1`–`s10`: one scenario each (the lobby, mid-game disruptions, away players, the raid, odd commands, table talk, everyone quitting, a server restart, accepting an offer, the end of a game). Each takes `BASE` and `CODE` from the environment.
