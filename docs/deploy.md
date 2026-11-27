# The public website

board-lite as a website anyone can open. It's one container and one folder of games (no database), and needs an always-on machine with a disk: games live in the server's memory and reach phones over streams held open, so a serverless host (Vercel, Lambda) or a second copy of the server won't work.

## Put it up

1. A small Linux machine (1 CPU, 1 GB) with Docker, and ports 80 and 443 open.
2. Point the site's DNS name at it.
3. In the repo on that machine:

   ```
   DOMAIN=dragons.example docker compose -f deploy/compose.yml up -d --build
   ```

Caddy gets the HTTPS certificate by itself. The phone page is `https://dragons.example/`, the TV's `https://dragons.example/tv`, and `/healthz` says the server is up.

**Update:** `git pull`, then the same command. Every change is saved as it happens, so games go on and everyone reconnects to their seat.

**Back up:** the `games` volume is the only state.

**Another host** (Fly, Render, a machine with its own proxy): run `ghcr.io/thetazero/board-lite` (published from each merge to `main` that passes CI, tagged `latest` and by commit) or build the `Dockerfile`, mount a disk at `/data` that uid 1000 can write, run exactly one copy, and set:

| Variable | What |
|---|---|
| `BOARD_LITE_PUBLIC_URL` | the site's address, like `https://dragons.example`. Turns the public website on (`--public`) |
| `BOARD_LITE_TRUST_PROXY` | `1` when, and only when, every request comes through a proxy that adds the visitor's address to `X-Forwarded-For` (`--trust-proxy`). Without it, behind a proxy, everyone counts as one visitor |
| `BOARD_LITE_DATA` | where games are kept (`--data`; `/data` in the image) |
| `PORT` | the port (8080) |

## Claude

The website seats no Claude players and starts none when a saved game continues: the runner isn't in the image, and no request can start one. No model is called and no key is on the machine.

A Claude client someone brings, on their own account, joins like anyone else, given the game's link. Before the game starts:

- **Claude Code:** `claude mcp add --transport http board-lite https://dragons.example/mcp`, then "Join https://dragons.example/ABCD and play".
- **claude.ai:** add `https://dragons.example/mcp` as a custom connector, then the same.
- **Any client that can post JSON:** give it the link. Read as Markdown (or at `/ABCD.md`) it says how to join, by `curl` if need be. `/llms.txt` says the same for any game.

`/mcp` has `join`, `view`, `act`, `say`, `wait` and `rules`. `join` returns a seat token, which the others take; a token sees only its own seat. The endpoint keeps no sessions, so a restart breaks nothing. It's on `npm run serve` too. `src/playtest/run.ts --room https://dragons.example/ABCD`, on your own machine, works as well ([`play-vs-claude.md`](play-vs-claude.md)), except that a saved game's Claude players come back only with `--resume`.

## What's different from `npm run serve`

- **A game's link is its key.** Anyone with it can join the lobby, be the TV when none is watching, or take the seat of a player who is away or quit, as at home. Saved games aren't listed: open the game's link to continue one.
- **Limits** for each visitor (an IPv4 address or IPv6 /64) and in all: new rooms, requests, wrong room codes, streams held open. They're `LIMITS` in `src/server/public.ts`; past one, the server answers 429.
- **Cleared away:** a room that never started, after an hour with no one in it; a saved game and old rooms' files after 30 days; recaps after a year. Players' names and table talk are in those files.
- **Bots** are the simple ones: the strong bot is refused, since its thinking would hold up every other game.
- **Headers:** a Content-Security-Policy, HSTS and the like, and no search indexing.
