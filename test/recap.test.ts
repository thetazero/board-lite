import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { botStep, playToEnd } from '../src/bot.ts';
import { TARGETS, targetPower } from '../src/data.ts';
import { newGame, score, standings, titleValues } from '../src/engine.ts';
import { buildRecap } from '../src/recap.ts';
import { Room } from '../src/server/room.ts';
import { startServer } from '../src/server/server.ts';
import type { Recap } from '../src/state.ts';
import { save } from '../src/store.ts';

const dir = mkdtempSync(join(tmpdir(), 'board-lite-recap-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function finished(seed: number, players: number) {
  const g = newGame(players, seed);
  const rng = { state: seed * 13 };
  playToEnd(g, () => botStep(g, rng)); // ends whatever the win target
  assert.equal(g.phase, 'over');
  return g;
}

test("a recap tells the race round by round, ends on the final scores, and lists what happened", () => {
  const g = finished(3, 4);
  const r = buildRecap(g, ['Ada', 'Bram', 'Cora', 'Dax'], 'abc', new Date(0));
  assert.equal(r.race.length, g.round + 1, 'the start, then each round');
  assert.deepEqual(r.race[0], [0, 0, 0, 0]);
  assert.deepEqual(r.race.at(-1), g.players.map((_, p) => score(g, p).total), 'the last row is the final scores, cards in hand too');
  assert.deepEqual(r.standings.map((s) => s.p), standings(g).map((s) => s.p));
  // Dragon power, from the start to the end, as Strongest Dragon Army counts it.
  assert.equal(r.power!.length, g.round + 1);
  assert.deepEqual(r.power!.at(-1), titleValues(g, 'army'));
  assert.ok(r.power!.some((row) => row.some((v) => v > 0)), 'dragons grow');
  // What production made, each round from round 1, as the log says.
  assert.equal(r.made!.length, g.round);
  assert.ok(r.made!.every((row) => row.every((v) => v >= 0)) && r.made!.flat().some((v) => v > 0));
  for (const s of r.standings) assert.equal(s.buildings + s.titles + s.beasts + s.raids + s.hidden, s.total);
  assert.ok(r.moments.length > 0);
  assert.ok(r.moments.every((m, i) => m.round >= 1 && m.round <= g.round && (i === 0 || r.moments[i - 1].round <= m.round)), 'in round order');
  // A title's holder at each round's end is told once, when it changes.
  const titles = r.moments.filter((m) => m.k === 'title');
  for (const t of ['army', 'tower', 'hoard']) {
    const holders = titles.filter((m) => m.t === t).map((m) => m.p);
    assert.ok(holders.every((p, i) => i === 0 || p !== holders[i - 1]), `${t} changes hands each time it's told`);
  }
  // Kingdoms: only the turning points, not every fall. A fall that scores no
  // points is told only when it's the strongest kingdom to fall yet.
  const falls = g.log.filter((e) => e.ev?.k === 'raidEnd' && e.ev.won && !e.to);
  const powerOf = (name: string) => targetPower(Object.keys(TARGETS).find((k) => TARGETS[k].name === name)!);
  const plain = r.moments.filter((m) => m.k === 'fall' && m.scorer === undefined).map((m) => m.k === 'fall' ? powerOf(m.name) : 0);
  assert.ok(plain.every((v, i) => i === 0 || v > plain[i - 1]), 'each plain fall told is a stronger kingdom than the last');
  assert.ok(falls.length > r.moments.filter((m) => m.k === 'fall').length, 'routine falls are left out');
  assert.ok(JSON.stringify(r).length < 20000, 'small enough to keep and share');
});

test("the server keeps a finished game's recap and serves it after the room is gone", async () => {
  const g = finished(5, 3);
  const file = join(dir, 'RCAP.json');
  save(file, g);
  const { server, rooms } = startServer(0, { dir }, [file], '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const room = [...rooms.values()][0];
    room.seats.forEach((s, i) => (s.name = ['Ada', 'Bram', 'Cora'][i]));
    room.changed();
    const id = room.snapshot(null).recap!;
    assert.match(id, /^[0-9a-f]{12}$/);
    const r = (await fetch(`${base}/api/recaps/${id}`).then((x) => x.json())) as Recap;
    assert.equal(r.id, id);
    assert.deepEqual(r.names, ['Ada', 'Bram', 'Cora']);
    assert.equal(r.standings[0].p, g.winner);
    const page = await fetch(`${base}/recap/${id}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /recap\.ts/);
    // A new game at the table: the old room is gone, its recap stays.
    room.close();
    rooms.clear();
    assert.equal((await fetch(`${base}/api/recaps/${id}`)).status, 200);
    assert.equal((await fetch(`${base}/api/recaps/000000000000`)).status, 404);
    assert.equal((await fetch(`${base}/api/recaps/..%2F..%2Fx`)).status, 404);
    // The same room hosted again (a restart) keeps the same recap.
    assert.equal(new Room(room.code, { file, dir }).recapId, id);
  } finally {
    server.close();
  }
});

test("no recap until the game is over", () => {
  const room = new Room('NOPE', { dir });
  room.join('Ada');
  room.join('Bram');
  room.start(room.hostToken, 1);
  assert.equal(room.snapshot(null).recap ?? null, null);
  room.close();
});
