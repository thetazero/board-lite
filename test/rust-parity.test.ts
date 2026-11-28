// The rules natively (the website) against the same rules as WASM (the tools):
// the same seeds and commands, bots' moves and junk alike, give the same games
// and JSON. The text view, the picture and scene lengths still have TypeScript
// versions, and are compared with those. Skipped until it's built: npm run rust:build. CI builds it.
import type { Command } from '../src/command.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { botMove, endingTarget, standInMove } from '../src/bot.ts';
import { TUNING } from '../src/data.ts';
import { RuleError, apply, newGame, waitingOn, type Game } from '../src/engine.ts';
import { mapImage } from '../src/mapimage.ts';
import { buildRecap } from '../src/recap.ts';
import { next, pick, type Rng } from '../src/rng.ts';
import { publicState, rulebook, seatState, visibleEvents, type Lobby, type Snapshot } from '../src/state.ts';
import { seatStatus, seatView } from '../src/view.ts';
import { scenesMs, scenesOf } from '../web/scenes.ts';

const BIN = fileURLToPath(new URL('../rust/target/home/parity', import.meta.url));
const skip = existsSync(BIN) ? false : 'the Rust server is not built (npm run rust:build)';
const GAMES = Number(process.env.PARITY_GAMES ?? 2); // of each player count

function rust() {
  const child = spawn(BIN, { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting: ((s: string) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (l) => waiting.shift()!(l));
  const ask = (op: string, q: object = {}) => new Promise<any>((done) => {
    waiting.push((l) => done(JSON.parse(l)));
    child.stdin.write(`${JSON.stringify({ op, ...q })}\n`);
  });
  return { ask, stop: () => child.stdin.end() };
}

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
// Everything past the header's fixed chunks: the picture's own bytes.
const pixels = (png: Buffer) => {
  const len = png.readUInt32BE(33);
  return Buffer.concat([png.subarray(16, 29), inflateSync(png.subarray(41, 41 + len))]);
};

// Commands a client might send, right and wrong.
function junk(g: Game, rng: Rng): Command {
  const n = g.players.length;
  const p = `P${1 + Math.floor(next(rng) * (n + 1))}`;
  const card = () => pick(rng, g.players.flatMap((pl) => [...pl.hand, ...pl.choice].map((c) => c.id)).concat('c9999'));
  const dragon = () => pick(rng, g.dragons.map((d) => d.id).concat('d999'));
  const hex = () => pick(rng, [...Object.keys(g.map), '99,9', 'x', '-0,1', '+1,1']);
  const res = (): any => pick(rng, ['stone', 'timber', 'CRYSTAL', 'crystal', 'livestock', 'gold', 'mud']);
  const some = () => ({ [res()]: Math.floor(next(rng) * 4), ...(next(rng) < 0.3 && { cards: [card()] }) });
  const offer = g.offers.length ? pick(rng, g.offers).id : pick(rng, (g.closedOffers ?? []).map((o) => o.id).concat('o1'));
  return pick<any>(rng, [
    { do: 'offer', to: p, give: some(), get: some() }, { do: 'offer', to: 'anyone', give: some(), get: some() }, { do: 'offer', to: 'anyone', get: { cards: [card()] } }, { do: 'offer', to: p }, { do: 'offer', give: { stone: 1 } },
    { do: 'accept', offer }, { do: 'decline', offer }, { do: 'cancel', offer }, { do: 'tell', to: p, message: 'hello there' }, { do: 'tell', to: 'p1', message: '' }, { do: 'say' }, { do: 'say', message: ` hé  ${'x'.repeat(Math.floor(next(rng) * 600))}` },
    { do: 'build', card: card(), hex: hex() }, { do: 'build_basic', building: 'roost', hex: hex() }, { do: 'build_basic', building: 'quarry', hex: hex() }, { do: 'build_basic', building: 'tower_floor' }, { do: 'build_basic', building: 'quarry' },
    { do: 'upgrade', card: card(), hex: hex() }, { do: 'play', card: card(), dragon: dragon() }, { do: 'play', card: card(), hex: hex() }, { do: 'play', card: card(), resource: res() }, { do: 'play', card: card() },
    { do: 'clear', hex: hex(), dragons: [dragon(), dragon()] }, { do: 'clear', hex: hex(), dragons: [] }, { do: 'auto_clear' }, { do: 'perch', hex: hex(), dragons: [dragon()] }, { do: 'recall', dragons: [dragon()] }, { do: 'recall', dragons: [] },
    { do: 'project_egg', element: pick(rng, ['fire', 'ice', 'mud']) }, { do: 'project_upgrade', upgrade: pick(rng, ['workshop', 'mud']), hex: hex() },
    { do: 'merchants', pay: res(), gain: res(), ...pick(rng, [{}, { times: 1 }, { times: 2 }, { times: 0 }, { times: 1.5 }, { times: 'x' }, { times: 4294967295 }]) },
    { do: 'keep', card: card() }, { do: 'discard', cards: [card(), card()] }, { do: 'discard', cards: [] }, { do: 'end' }, { do: 'END' }, {}, 'end', null,
    { do: 'vote', target: pick(rng, [...(g.raid?.candidates ?? []), 'x']) }, { do: 'fight', dragons: [dragon()] }, { do: 'fight', dragons: [] }, { do: 'hold' }, { do: 'hold', dragons: ['d1'] },
  ]);
}

const lobby: Lobby = { code: 'ABCD', started: true, seating: false, saved: null, seats: [{ id: 1, name: 'Ada', kind: 'player', connected: true, standIn: false, left: false }, { id: 2, name: 'Tick', kind: 'bot', connected: true, standIn: false, left: false }], minPlayers: 2, maxPlayers: 6, file: '', remote: true };

test('the Rust engine plays every game as this one does', { skip, timeout: 110000 }, async () => {
  const r = rust();
  let refused = 0, obeyed = 0, ended = 0;
  try {
    assert.deepEqual(await r.ask('rulebook'), plain(rulebook()));
    for (let players = 2; players <= 6; players++) {
      for (let n = 0; n < GAMES; n++) {
        const seed = 1000 * players + n * 7919 + 5;
        const g = newGame(players, seed);
        await r.ask('new', { players, seed });
        const rng: Rng = { state: seed };
        const where = `${players} players, seed ${seed}`;
        for (let step = 0; step < 100000 && g.phase !== 'over'; step++) {
          if (next(rng) < 0.4) {
            const p = Math.floor(next(rng) * players);
            const cmd = junk(g, rng);
            let error: string | null = null;
            try { apply(g, p, cmd); } catch (e) { if (!(e instanceof RuleError)) throw e; error = e.message; }
            error === null ? obeyed++ : refused++;
            assert.equal(await r.ask('apply', { p, cmd }), error, `${where}, step ${step}: P${p + 1} ${JSON.stringify(cmd)}`);
            if (g.phase as string === 'over') break;
          }
          const p = pick(rng, waitingOn(g));
          const before = g.log.length;
          if (next(rng) < 0.02) assert.deepEqual(await r.ask('standin', { p }), standInMove(g, p), where);
          else {
            const state = rng.state;
            const cmd = botMove(g, p, rng);
            assert.deepEqual(await r.ask('bot', { p, state }), { cmd, state: rng.state }, `${where}, step ${step}`);
          }
          assert.equal(await r.ask('scenes', { since: before }), scenesMs(scenesOf(g.log.slice(before).filter((e) => !e.to))));
          if (step % 23 === 0) {
            // It stops being a game anyone could win: this one is far past its length.
            if (g.round > 45 && endingTarget(g, TUNING.pointsToWin) < TUNING.pointsToWin) break;
            assert.deepEqual(await r.ask('game'), plain(g), `${where}, step ${step}`);
            assert.deepEqual(await r.ask('public'), plain(publicState(g)), `${where}, step ${step}`);
            for (let q = 0; q < players; q++) {
              const seat = seatState(g, q);
              assert.deepEqual(await r.ask('seat', { p: q }), plain(seat), `${where}, step ${step}, P${q + 1}`);
              assert.deepEqual(await r.ask('events', { p: q, since: before }), plain(visibleEvents(g, q, before)));
              const s: Snapshot = { lobby, seat: q, game: publicState(g), scene: 0, you: { ...seat, name: 'Ada' } };
              assert.deepEqual(await r.ask('view', { p: q, lobby, name: 'Ada' }), [seatView(s, 25), seatStatus(s)], `${where}, step ${step}`);
            }
          }
          if (step % 211 === 0) assert.ok(pixels(Buffer.from(await r.ask('image', { p: 1 }))).equals(pixels(mapImage(publicState(g), 1))), `${where}, step ${step}: the picture`);
          // Saved by one, continued by the other.
          if (step % 401 === 0) await r.ask('load', { text: JSON.stringify(g) });
        }
        if (g.phase === 'over') ended++;
        assert.deepEqual(await r.ask('game'), plain(g), where);
        assert.deepEqual(await r.ask('public'), plain(publicState(g)), where);
        assert.deepEqual(await r.ask('recap'), plain(buildRecap(g, ['Ada', 'Bram'], 'abc', new Date(0))), where);
      }
    }
    console.log(`${refused} refused and ${obeyed} obeyed odd commands; ${ended} of ${5 * GAMES} games won`);
  } finally { r.stop(); }
});

test('a game saved by an older version loads the same', { skip }, async () => {
  const r = rust();
  try {
    const text = JSON.stringify(newGame(3, 9)).replaceAll('"desert"', '"plains"').replaceAll('"wolf"', '"wolf_pack"');
    await r.ask('load', { text });
    assert.deepEqual(await r.ask('game'), plain(newGame(3, 9)));
  } finally { r.stop(); }
});
