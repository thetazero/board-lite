// A seat is its player's token, not its number: seats move up when someone is removed in the lobby.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { newGame } from '../src/engine.ts';
import { Room, startServer } from '../src/host.ts';
import type { Lobby } from '../src/state.ts';
import { save } from '../src/store.ts';

const tmp = mkdtempSync(join(tmpdir(), 'board-lite-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const REFUSED = /You are not in this game\./;

async function host(files: string[] = []) {
  const { server, rooms } = startServer(0, { dir: join(tmp, String(n++)), botDelayMs: 1 }, files, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => {
    const r = await fetch(url + path, { method: 'POST', body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() as any };
  };
  const get = async (path: string) => {
    const r = await fetch(url + path);
    return { status: r.status, data: await r.json() as any };
  };
  const tool = async (name: string, args: object): Promise<{ text: string; isError: boolean }> => {
    const { result, error } = (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).data;
    assert.ok(result, `no answer: ${JSON.stringify(error)}`);
    return { text: result.content[0].text, isError: !!result.isError };
  };
  const close = () => {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  };
  return { url, rooms, post, get, tool, close };
}
// A room with these players, and what a test does to them.
async function table(s: Awaited<ReturnType<typeof host>>, ...names: string[]) {
  const { code, hostToken } = (await s.post('/api/rooms', {})).data;
  const at = `/api/rooms/${code}`;
  const tokens: string[] = [];
  for (const name of names) tokens.push((await s.post(`${at}/join`, { name, via: 'claude' })).data.token);
  const room = s.rooms.get(code)!;
  const held = async (token: string) => {
    for (let i = 0; !room.seats.find((x) => x.token === token)?.connected; i++) {
      assert.ok(i < 500, 'never waited');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const remove = (p: number) => room.leave(p);
  const start = async () => assert.equal((await s.post(`${at}/start`, { token: hostToken })).status, 200);
  return { code, hostToken, at, tokens, room, held, remove, start };
}
const soon = <T>(p: Promise<T>): Promise<T> => {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error('still waiting')), 8000); })]).finally(() => clearTimeout(t));
};

// The middle seat (someone moves into its number) and the last (no one does).
for (const [which, names] of [['someone moves into', ['Ada', 'Bram', 'Cora', 'Dov']], ['no one moves into', ['Ada', 'Bram', 'Cora']]] as const) {
  const p = which === 'someone moves into' ? 1 : 2;
  test(`a removed player whose seat ${which} is refused, and told nothing`, async () => {
    const s = await host();
    try {
      for (const ask of ['mcp', 'listen', 'wait'] as const) {
        const t = await table(s, ...names);
        const token = t.tokens[p];
        const asked = ask === 'mcp' ? s.tool('wait', { game: t.code, token })
          : s.get(`${t.at}/${ask}?token=${token}&timeout=20`).then((r) => ({ text: JSON.stringify(r.data), isError: r.status === 400 }));
        await t.held(token);
        t.remove(p);
        await t.start();
        const r = await soon(asked);
        assert.match(r.text, REFUSED, ask);
        assert.ok(r.isError, ask);
        assert.ok(!/c\d+|draw|keep/.test(r.text), `${ask}: ${r.text}`);
        // Asking again is refused too, and the game goes on.
        assert.match((await s.tool('view', { game: t.code, token })).text, REFUSED);
        assert.ok(!(await s.tool('view', { game: t.code, token: t.tokens[0] })).isError);
      }
    } finally { s.close(); }
  });
}

test('a player whose seat number changed while they waited is told of their turn', async () => {
  const s = await host();
  try {
    for (const ask of ['mcp', 'listen', 'wait'] as const) {
      const t = await table(s, 'Ada', 'Bram', 'Cora');
      const token = t.tokens[2];
      const asked = ask === 'mcp' ? s.tool('wait', { game: t.code, token })
        : s.get(`${t.at}/${ask}?token=${token}&timeout=20`).then((r) => ({ text: JSON.stringify(r.data), isError: r.status !== 200 }));
      await t.held(token);
      t.remove(1);
      await t.start();
      const r = await soon(asked);
      assert.ok(!r.isError, r.text);
      assert.ok(t.room.snapshot(token).you!.choice.every((c) => r.text.includes(c.id)), `${ask}: its own cards`);
    }
  } finally { s.close(); }
});

test('two people removing the same player at once remove only that player', async () => {
  const s = await host();
  try {
    const t = await table(s, 'Ada', 'Bram', 'Cora', 'Dov');
    const lobby: Lobby = t.room.lobby();
    const bram = { player: lobby.seats[1].id, seat: 1 }; // (the number is what it went by before)
    const answers = await Promise.all([t.hostToken, t.tokens[0]].map((token) => s.post(`${t.at}/leave`, { token, ...bram })));
    assert.deepEqual(t.room.lobby().seats.map((x) => x.name), ['Ada', 'Cora', 'Dov']);
    assert.deepEqual(answers.map((a) => a.status).sort(), [200, 400]);
    // A page from before this sent the seat's number: refused, whoever is there now.
    assert.equal((await s.post(`${t.at}/leave`, { token: t.tokens[0], seat: 1 })).status, 400);
    assert.equal((await s.post(`${t.at}/leave`, { token: t.tokens[2], player: t.room.lobby().seats[0].id })).status, 400, 'only yourself');
    assert.equal((await s.post(`${t.at}/leave`, { token: t.tokens[2] })).status, 200);
    assert.deepEqual(t.room.lobby().seats.map((x) => x.name), ['Ada', 'Dov']);
  } finally { s.close(); }
});

test('a removed player whose wait is woken by talk is refused, without a crash', async () => {
  const s = await host();
  try {
    const t = await table(s, 'Ada', 'Bram', 'Cora');
    const asked = s.tool('wait', { game: t.code, token: t.tokens[2] }).then((r) => r.text, (e) => `no answer: ${e}`);
    await t.held(t.tokens[2]);
    t.remove(2);
    await t.start();
    await s.post(`${t.at}/do`, { token: t.tokens[0], command: 'say hello' });
    assert.match(await soon(asked), REFUSED);
  } finally { s.close(); }
});

test('whoever had a seat before does not count as its player being here', () => {
  const room = new Room('HERE', { dir: join(tmp, 'here'), botDelayMs: 60000, awayMs: 50 });
  try {
    room.join('Ada');
    const bram = room.join('Bram');
    room.start(room.hostToken, 3);
    const away = room.connect(bram.token);
    room.quit(bram.token);
    const again = room.join('Bram'); // back, with the stream from before still open
    const p = room.seatOf(again.token);
    assert.equal(p, 1);
    assert.equal(room.seats[p].connected, 0);
    const here = room.connect(again.token);
    assert.equal(room.seats[p].connected, 1);
    away(); // the old stream closing is not the new player leaving
    assert.equal(room.seats[p].connected, 1);
    here();
    assert.equal(room.seats[p].connected, 0);
  } finally { room.close(); }
});

test('a seat keeps its id when the server restarts, and no id is given twice', () => {
  const opts = { dir: join(tmp, 'again') };
  const first = new Room('AGIN', opts);
  for (const name of ['Ada', 'Bram', 'Cora']) first.join(name);
  const ids = first.lobby().seats.map((x) => x.id);
  first.leave(2);
  const file = first.file;
  first.close();
  const room = new Room('AGIN', { ...opts, file });
  try {
    assert.deepEqual(room.lobby().seats.map((x) => x.id), ids.slice(0, 2));
    room.join('Dov');
    assert.ok(!ids.includes(room.lobby().seats[2].id), "a removed player's id is no one else's");
  } finally { room.close(); }
});

test('removing a player again does not remove whoever took the seat they left open', async () => {
  const file = join(tmp, 'saved.json');
  save(file, newGame(2, 7));
  const s = await host([file]);
  try {
    const [room] = [...s.rooms.values()];
    const at = `/api/rooms/${room.code}`;
    await s.post(`${at}/join`, { name: 'Bram' });
    const player = room.lobby().seats[0].id;
    assert.equal((await s.post(`${at}/leave`, { token: room.hostToken, player, seat: 0 })).status, 200);
    await s.post(`${at}/join`, { name: 'Cora' });
    assert.equal((await s.post(`${at}/leave`, { token: room.hostToken, player, seat: 0 })).status, 400);
    assert.equal(room.lobby().seats[0].name, 'Cora');
  } finally { s.close(); }
});
