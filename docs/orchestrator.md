# Orchestrator instructions

Standing instructions from the project owner to board-lite's orchestrator (the Claude tab that runs the queue). Quotes are the owner's words. Re-read this after any restart or context compaction.

## The job

- Don't just merge things and watch: "I want you to geniunely look at prs visuals, etc... and think 'does this look good', 'is this fun', etc... and refine the game. not just be lazy merge things and then nothing every really happens."
- Nothing will be one-shot: "this will not be one shot, it will take lots and lots of work. I fully expect almost every first attempt to go wrong and require reworking, and basic things like 'are the graphics coherent and consistent' to be hard to accomplish."
- Playtest: "you (the orchestrator) should do claude playtests via subagents to get a sense for the game, and improve it over many iterations." Running playtests without asking first is expected: "you literally have to otherwise you will accomplish nothing."
- Depth test: "does haiku regularly lose to opus? If not, the game has no depth." Run mixed Haiku/Opus games, each player a subagent seeing only its own player view, over a batch of games, and track win rates.
- Look at the TV and phone clients in the browser, play them, take screenshots, and judge them as a player would. File what's wrong with screenshots attached.

## The most important rule: fix systems, don't patch symptoms

"Something I really want you to avoid here is that often you just say 'done when: x no longer happens' after seeing x happen in a playtest, so the agent hacks around the current system and makes it even more convoluted. often times 'x' happens due to poorly designed game systems, not because of bugs that need to be patched away. it is incredibly important that you do not fall into this trap. this is literally the most important thing for you to do. design simple core system that work well, not add a million edge cases. Infact try to force this by asserting certain complexity maximums to keep it 'board game like'."

- Issues from playtests name the system-level problem, not the symptom, and require the fix to keep the rules as simple or simpler.
- Hold every change to the complexity budget in `docs/design.md`.

## Design calls

- "you should just make provisional calls as needed, but definitely record any major design calls in a doc, with reasoning." That doc is `docs/decisions.md`.
- `docs/design.md` records the owner's decisions in their words; open questions stay marked open.

## Workstreams and order

1. The core game, headless, with a CLI Claude can play (#1).
2. The TV and phone clients. Starts once the first version of 1 lands: "After the first iteration (3) can totally start working."
3. Graphics and feel. Starts once the first version of the clients lands.

## Machine and repo

- `/tmp` is a 7.4G RAM-backed tmpfs: "don't blow up my tmp dir, that always OOMS me. be careful about that." Bulky output (logs, transcripts, screenshots) goes on disk, e.g. `~/.cache/board-lite/`. Other projects' temp files under `/tmp/claude-1000` can be cleared when their tabs are closed (the owner OK'd clearing retrox's).
- Auto-merge is on (`.vibrant/merge.json`, merges on green CI). Never use `--delete-branch`: "delete branch will fuck your shit remove that."
- The queue runs in overnight mode while the owner is away.
- Stack: a web game in TypeScript (strong preference); the phone client should be lightweight.
