// The Rust server's engine (rust/) against this one: the same seeds and the
// same commands, bots' moves and junk alike, have to give the same game, the
// same JSON for every client, the same text and picture for Claude players and
// the same recap. Skipped until it's built: npm run rust:build. CI builds it.
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

const BIN = fileURLToPath(new URL('../rust/target/release/parity', import.meta.url));
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

// Commands a player might type, right and wrong.
function junk(g: Game, rng: Rng): string {
  const n = g.players.length;
  const p = `P${1 + Math.floor(next(rng) * (n + 1))}`;
  const card = () => pick(rng, g.players.flatMap((pl) => [...pl.hand, ...pl.choice].map((c) => c.id)).concat('c9999'));
  const dragon = () => pick(rng, g.dragons.map((d) => d.id).concat('d999'));
  const hex = () => pick(rng, [...Object.keys(g.map), '99,9', 'x', '-0,1', '+1,1']);
  const res = () => pick(rng, ['stone', 'timber', 'CRYSTAL', 'livestock', 'gold', 'mud']);
  const some = () => `${Math.floor(next(rng) * 4)} ${res()}${next(rng) < 0.3 ? `, ${card()}` : ''}`;
  const offer = g.offers.length ? pick(rng, g.offers).id : 'o1';
  return pick(rng, [
    `offer ${p} give ${some()} get ${some()}`, `offer anyone give ${some()} get ${some()}`, `offer Anyone give get ${card()}`, `offer ${p}`, `offer P1 get 1 stone give 1 gold`,
    `accept ${offer}`, `decline ${offer}`, `cancel ${offer}`, `tell ${p} hello there`, `tell p1`, 'say', `say  hé  ${'x'.repeat(Math.floor(next(rng) * 600))}`,
    `build ${card()} ${hex()}`, `build roost ${hex()}`, `build quarry ${hex()}`, 'build tower_floor', `upgrade ${card()} ${hex()}`, `play ${card()} ${dragon()}`, `play ${card()} ${hex()}`, `play ${card()} ${res()}`,
    `clear ${hex()} ${dragon()} ${dragon()}`, `clear ${hex()}`, 'autoclear', `perch ${hex()} ${dragon()}`, `recall ${dragon()}`, 'recall', `project ${pick(rng, ['fire', 'ice', 'workshop', 'mud'])} ${hex()}`,
    `merchants ${res()} ${res()} ${pick(rng, ['', '1', '2', '1e1', '0', '1.5', 'x'])}`, `keep ${card()}`, `discard ${card()} ${card()}`, 'discard', 'end', 'END', '', 'nonsense', `vote ${pick(rng, ['1', '9', '0', 'x'])}`, `fight ${dragon()}`, 'hold', 'hold d1',
  ]);
}

const lobby: Lobby = { code: 'ABCD', started: true, seating: false, saved: null, seats: [{ name: 'Ada', kind: 'player', connected: true, standIn: false, left: false }, { name: 'Tick', kind: 'bot', connected: true, standIn: false, left: false }], minPlayers: 2, maxPlayers: 6, file: '', remote: true };

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
            assert.equal(await r.ask('apply', { p, cmd }), error, `${where}, step ${step}: P${p + 1} ${cmd}`);
            if (g.phase as string === 'over') break;
          }
          const p = pick(rng, waitingOn(g));
          const before = g.log.length;
          if (next(rng) < 0.02) assert.equal(await r.ask('standin', { p }), standInMove(g, p), where);
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
