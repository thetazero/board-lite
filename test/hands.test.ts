// No one is sent a card they can't see (#527). Whole games with junk commands,
// and beside each game the same one with the hidden cards swapped for others:
// what a viewer is sent can't tell the two apart, whichever way it would say so.
import type { Command } from '../src/command.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botMove, endingTarget } from '../src/bot.ts';
import { ACTIONS, BUILDINGS, DRAGONS, TUNING, UPGRADES } from '../src/data.ts';
import { RuleError, apply, newGame, waitingOn, type Card, type Game } from '../src/engine.ts';
import { next, pick, type Rng } from '../src/rng.ts';
import { publicState, seatState, visibleEvents, type Snapshot } from '../src/state.ts';
import { seatView } from '../src/view.ts';

const KEYS = { building: [...Object.keys(BUILDINGS).filter((k) => !BUILDINGS[k].basic), ...Object.keys(UPGRADES)], action: [...Object.keys(ACTIONS), ...Object.keys(DRAGONS)] };
const TV = -1;
const WIN = TUNING.pointsToWin;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Another card of its deck; which one depends only on what it was.
const other = (c: Card): Card => ({ ...c, key: KEYS[c.deck][(KEYS[c.deck].indexOf(c.key) + 1) % KEYS[c.deck].length] });

// The game with every card in a hand or a choice swapped, but for the seats in
// `seen` and the cards an offer shows everyone.
function swapped(g: Game, seen: number[], offered: string[] = []): Game {
  const { log, ...rest } = g;
  const h: Game = { ...clone(rest), log: [...log] };
  const shown = new Set([...offered, ...h.offers.flatMap((o) => o.give.cards)]);
  h.players.forEach((pl, p) => {
    if (seen.includes(p)) return;
    pl.hand = pl.hand.map((c) => (shown.has(c.id) ? c : other(c)));
    pl.choice = pl.choice.map(other);
  });
  return h;
}

// All a viewer is sent, with the latest of the log.
function sent(g: Game, v: number): unknown {
  const cut: Game = { ...g, log: g.log.slice(-40) };
  const game = publicState(cut);
  if (v === TV) return { game };
  const you = { ...seatState(cut, v), name: 'Ada' };
  const lobby = { seats: [] } as any;
  const s: Snapshot = { lobby, seat: v, game, scene: 0, you };
  return { game, you, events: visibleEvents(cut, v, 0), view: seatView(s, 25) };
}

function junk(g: Game, p: number, rng: Rng): Command {
  const n = g.players.length;
  const to = p !== g.turn && next(rng) < 0.7 ? `P${g.turn + 1}` : `P${1 + Math.floor(next(rng) * n)}`;
  const held = g.players.flatMap((pl) => [...pl.hand, ...pl.choice].map((c) => c.id));
  const card = () => (next(rng) < 0.7 ? pick(rng, held.concat('c9999')) : `c${1 + Math.floor(next(rng) * 130)}`);
  const mine = () => pick(rng, g.players[p].hand.map((c) => c.id).concat('c9999'));
  const many = () => Array.from({ length: 1 + Math.floor(next(rng) * 4) }, card);
  const hex = () => pick(rng, Object.keys(g.map));
  const dragon = () => pick(rng, g.dragons.map((d) => d.id).concat('d999'));
  const offer = g.offers.length ? pick(rng, g.offers).id : 'o1';
  return pick<any>(rng, [
    { do: 'offer', to: 'anyone', give: { stone: 1 }, get: { cards: [...new Set(many())] } }, { do: 'offer', to, give: { gold: 0 }, get: { cards: [card()] } },
    { do: 'offer', to, give: { cards: many() }, get: { stone: 1 } }, { do: 'offer', to, give: { cards: [card()] }, get: { cards: [card()] } }, { do: 'offer', to, give: { cards: [mine()] }, get: { cards: [card()] } }, { do: 'offer', to: 'anyone', give: { cards: [mine()] }, get: {} },
    { do: 'accept', offer }, { do: 'accept', offer }, { do: 'decline', offer }, { do: 'cancel', offer },
    { do: 'build', card: card(), hex: hex() }, { do: 'upgrade', card: card(), hex: hex() }, { do: 'play', card: card() }, { do: 'play', card: card(), dragon: dragon(), hex: hex() }, { do: 'play', card: card(), resource: 'stone' },
    { do: 'keep', card: card() }, { do: 'discard', cards: many() }, { do: 'tell', to, message: 'hello' }, { do: 'fight', dragons: [dragon()] }, { do: 'hold' }, { do: 'end' },
  ]);
}

function attempt(g: Game, p: number, cmd: Command): string | null {
  try { apply(g, p, cmd); return null; } catch (e) { if (!(e instanceof RuleError)) throw e; return e.message; }
}

test('a refused command and an accepted one say nothing of hands the player cannot see', { timeout: 110000 }, () => {
  const did = { refused: 0, offered: 0, traded: 0, ended: 0 };
  for (const [players, seed] of [[2, 11], [3, 3], [5, 29]]) {
    const g = newGame(players, seed);
    const rng: Rng = { state: seed };
    for (let step = 0; step < 20000 && g.phase !== 'over'; step++) {
      const where = `${players} players, seed ${seed}, step ${step}`;
      // A junk command: what its sender, and everyone told, hears is the same with other players' cards swapped.
      if (next(rng) < 0.6) {
        let p = Math.floor(next(rng) * players);
        let cmd = junk(g, p, rng);
        const o = g.offers.find((x) => x.get.cards.length) ?? g.offers[0];
        if (o && next(rng) < 0.3) {
          p = o.to ?? pick(rng, [...g.players.keys()].filter((q) => q !== o.from));
          cmd = { do: 'accept', offer: o.id };
        }
        const v = pick(rng, [TV, ...g.players.keys()]);
        // Its sender, and whoever else is told of it. Building, upgrading and playing a card show it.
        const shows = cmd.do === 'build' || cmd.do === 'upgrade' || cmd.do === 'play';
        const give = cmd.do === 'offer' ? (cmd.give?.cards ?? []).filter((id) => g.players[p].hand.some((c) => c.id === id)) : [];
        const twins = ([[p, swapped(g, [p])], [v, swapped(g, shows ? [p, v] : [v], give)]] as const);
        const at = g.log.length;
        const said = attempt(g, p, cmd);
        const what = `${where}: P${p + 1} ${JSON.stringify(cmd)}`;
        if (g.phase as string === 'over') break; // hands count at the end
        if (said !== null) did.refused++;
        else if (cmd.do === 'offer') did.offered++;
        else if (cmd.do === 'accept') did.traded++;
        for (const [who, twin] of twins) {
          const answer = attempt(twin, p, cmd);
          if (who === p) assert.equal(answer, said, what);
          const heard = (x: Game) => x.log.slice(at).filter((e) => !e.to || e.to.includes(who));
          if (said === null) assert.deepEqual(heard(twin), heard(g), `${what}: what ${who === TV ? 'the TV' : `P${who + 1}`} hears`);
        }
      } else botMove(g, pick(rng, waitingOn(g)), rng);
      if (g.phase as string === 'over') break;
      // What each viewer is sent, with everyone else's cards swapped.
      if (step % 7 === 0 || g.offers.length && step % 2 === 0) {
        const v = pick(rng, [TV, ...g.players.keys()]);
        assert.deepEqual(sent(swapped(g, [v]), v), sent(g, v), `${where}: what ${v === TV ? 'the TV' : `P${v + 1}`} is sent`);
      }
      if (g.round > 12 && endingTarget(g, TUNING.pointsToWin, 12) < TUNING.pointsToWin) TUNING.pointsToWin = endingTarget(g, TUNING.pointsToWin, 12);
    }
    TUNING.pointsToWin = WIN;
    if (g.phase === 'over') did.ended++;
  }
  console.log(did);
  assert.equal(did.ended, 3, 'whole games');
  assert.ok(did.refused > 100 && did.offered > 20 && did.traded > 5, JSON.stringify(did));
});

test('an offer names the cards it gives, and a card it asks for only to the player who holds it', () => {
  const g = newGame(3, 5, 0);
  while (g.phase === 'cards') for (const p of waitingOn(g)) apply(g, p, { do: 'keep', card: g.players[p].choice[0].id });
  const [mine, theirs] = [g.players[0].hand[0], g.players[1].hand[0]];
  const name = (p: number, id: string) => seatState(g, p).hand.find((c) => c.id === id)!.name;
  const [mineName, theirsName] = [name(0, mine.id), name(1, theirs.id)];
  assert.throws(() => apply(g, 0, { do: 'offer', to: 'P2', give: { cards: [theirs.id] }, get: { stone: 1 } }), (e: Error) => e.message === `You don't have card ${theirs.id}.`);
  apply(g, 0, { do: 'offer', to: 'anyone', give: { cards: [mine.id] }, get: { cards: [theirs.id] } });
  const o = publicState(g).offers[0];
  assert.deepEqual([o.give, o.get], [`${mineName} card`, `card ${theirs.id}`]);
  assert.deepEqual(seatState(g, 1).asked, { [o.id]: `${theirsName} card` });
  assert.deepEqual(seatState(g, 2).asked, { [o.id]: `card ${theirs.id}` });
  assert.equal(seatState(g, 2).cantAccept[o.id], `You don't have card ${theirs.id}.`);
  apply(g, 1, { do: 'accept', offer: o.id });
  assert.match(g.log.at(-1)!.text, new RegExp(`gives ${mineName} card \\(${mine.id}\\) for card ${theirs.id}\\.$`));
});
