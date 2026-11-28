// A command that comes too late, or too early, is refused for the reason
// that's true of it (#555, #556).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command } from '../src/command.ts';
import { RuleError, apply, newGame, waitingOn, type Game } from '../src/engine.ts';
import { standInMove } from '../src/bot.ts';

function started(players = 3): Game {
  const g = newGame(players, 11, 0);
  while (g.phase === 'cards') for (const p of waitingOn(g)) apply(g, p, { do: 'keep', card: g.players[p].choice[0].id });
  for (const pl of g.players) Object.assign(pl.resources, { stone: 9, timber: 9, crystal: 9, livestock: 9 });
  return g;
}
const refused = (g: Game, p: number, cmd: Command, why: string) => {
  const before = JSON.stringify(g);
  assert.throws(() => apply(g, p, cmd), (e) => e instanceof RuleError && e.message === why);
  assert.equal(JSON.stringify(g), before, 'nothing changes');
};
const offer = (g: Game, p: number, to: string) => {
  apply(g, p, { do: 'offer', to, give: { stone: 1 }, get: { timber: 1 } });
  return g.offers.at(-1)!.id;
};
// Everyone's dragon hatched and raid-ready, so there's a raid to vote in.
const raidReady = (g: Game) => g.dragons.forEach((d) => (d.stage = 1));

test('a late answer to an expired offer says it has expired, in every phase the game reaches', () => {
  const g = started();
  raidReady(g);
  g.dragons = g.dragons.filter((d) => d.owner !== 1); // P2 has no dragon: the answer once heard about the vote (#555)
  while (g.turn !== 2) apply(g, g.turn, { do: 'end' });
  const toP2 = offer(g, 2, 'P2'), toAll = offer(g, 2, 'anyone');
  apply(g, 2, { do: 'end' });
  const seen = new Set<string>();
  for (let i = 0; i < 200 && (seen.size < 5 || g.round < 3); i++) {
    const phase = g.phase === 'raid' ? `raid ${g.raid!.step}` : g.phase;
    if (!seen.has(phase)) for (const id of [toP2, toAll]) {
      refused(g, 1, { do: 'decline', offer: id }, 'That offer has expired.');
      refused(g, 1, { do: 'accept', offer: id }, 'That offer has expired.');
      refused(g, 2, { do: 'cancel', offer: id }, 'That offer has expired.');
    }
    seen.add(phase);
    // Hands over the limit, so the round ends with discards.
    if (g.phase === 'raid') while (g.players[0].hand.length < 9) g.players[0].hand.push({ ...g.decks.building.pop()! });
    standInMove(g, waitingOn(g)[0]);
  }
  assert.deepEqual([...seen].sort(), ['action', 'cards', 'discard', 'raid choose', 'raid vote']);
  g.phase = 'over';
  refused(g, 1, { do: 'decline', offer: toP2 }, 'That offer has expired.');
  refused(g, 1, { do: 'end' }, 'The game is over.');
});

test('an answer to an offer closed some other way says how', () => {
  const g = started();
  const a = offer(g, 0, 'anyone');
  apply(g, 1, { do: 'decline', offer: a });
  refused(g, 1, { do: 'accept', offer: a }, "You've already declined that offer.");
  apply(g, 2, { do: 'accept', offer: a });
  refused(g, 1, { do: 'accept', offer: a }, 'P3 has already accepted that offer.');
  refused(g, 2, { do: 'accept', offer: a }, "You've already accepted that offer.");
  refused(g, 0, { do: 'cancel', offer: a }, 'P3 has already accepted that offer.');
  const b = offer(g, 0, 'P2');
  refused(g, 2, { do: 'decline', offer: b }, `There is no offer ${b} made to you.`);
  apply(g, 0, { do: 'cancel', offer: b });
  refused(g, 1, { do: 'accept', offer: b }, 'P1 has withdrawn that offer.');
  refused(g, 2, { do: 'decline', offer: b }, `There is no offer ${b} made to you.`);
  refused(g, 0, { do: 'cancel', offer: b }, "You've already withdrawn that offer.");
  const c = offer(g, 0, 'P2');
  apply(g, 1, { do: 'decline', offer: c });
  refused(g, 0, { do: 'cancel', offer: c }, 'That offer has been declined.');
  refused(g, 1, { do: 'accept', offer: 'o9999' }, 'There is no offer o9999 made to you.');
});

test('a command that does not fit the phase is refused for its own reason', () => {
  const g = newGame(3, 11, 0);
  refused(g, 0, { do: 'end' }, 'Turns start once everyone has kept a card: keep 1 of your 2 building cards.');
  apply(g, 0, { do: 'keep', card: g.players[0].choice[0].id });
  refused(g, 0, { do: 'end' }, 'Turns start once everyone has kept a card: wait for the others.');
  for (const p of [1, 2]) apply(g, p, { do: 'keep', card: g.players[p].choice[0].id });
  raidReady(g);
  refused(g, 1, { do: 'keep', card: 'c1' }, 'Keep a building card at the start of the round.');
  refused(g, 1, { do: 'vote', target: 'brindle' }, "Vote for a target in the raid, after everyone's turn.");
  refused(g, 1, { do: 'hold' }, "Fight or hold back in the raid, after everyone's turn.");
  for (const p of [0, 1, 2]) apply(g, p, { do: 'end' });
  refused(g, 0, { do: 'hold' }, 'Fight or hold back after the vote.');
  refused(g, 0, { do: 'end' }, 'Turns are over for this round: do it on your next turn.');
  refused(g, 0, { do: 'offer', to: 'P2', give: { stone: 1 } }, "Turns are over for this round: make offers during the next round's turns.");
  const t = g.raid!.candidates[0];
  for (const p of [0, 1, 2]) apply(g, p, { do: 'vote', target: t });
  refused(g, 0, { do: 'vote', target: t }, 'The vote is over.');
  refused(g, 0, { do: 'fight', dragons: [] }, 'Choose dragons to fight, or hold back.');
  apply(g, 0, { do: 'say', message: 'anyone, any time' });
});

test('text is not a command', () => {
  const g = started();
  for (const bad of ['end', 'say hi', '', null, 7, [], {}, { do: 'end', card: 'c1' }, { do: 'play' }]) assert.throws(() => apply(g, 0, bad as any), RuleError, JSON.stringify(bad));
});
