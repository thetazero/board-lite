import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import { candidateCommands } from '../src/bot.ts';
import { apply, newGame, waitingOn } from '../src/engine.ts';
import { Room, RoomError } from '../src/server/room.ts';
import { load, save } from '../src/store.ts';
import { startServer } from '../src/server/server.ts';
import type { Snapshot } from '../src/state.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'board-lite-test-')); // a few small game files
after(() => rmSync(dir, { recursive: true, force: true }));
const run = promisify(execFile);
const cli = (...args: string[]) => run(process.execPath, ['src/cli.ts', ...args]).then((r) => r.stdout, (e) => `${e.stdout}${e.stderr}`);

test('phones can play a whole game through a room, and see only their own hand', async () => {
  const room = new Room('TEST', { dir });
  const seats = ['Ada', 'Bram', 'Cora'].map((n) => room.join(n));
  assert.throws(() => room.start(seats[1].token), RoomError, 'only the first player or the TV starts');
  room.start(seats[0].token, 11);
  const g = room.game!;
  const rng = { state: 5 };
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 20000) {
    const p = waitingOn(g)[0];
    for (const cmd of candidateCommands(g, p, rng)) {
      try {
        room.command(seats[p].token, cmd);
        break;
      } catch (e) {
        if (!(e instanceof RoomError)) throw e;
      }
    }
    // What each phone receives never includes anyone else's hand.
    if (steps % 25 === 0) {
      for (let me = 0; me < 3; me++) {
        const json = JSON.stringify(room.snapshot(seats[me].token));
        for (let q = 0; q < 3; q++) {
          if (q === me) continue;
          for (const c of g.players[q].hand) assert.ok(!json.includes(`"id":"${c.id}"`), `seat ${me} can see ${c.id} in seat ${q}'s hand`);
        }
        assert.ok(!json.includes('"resources"') || JSON.parse(json).you.seat === me);
      }
      const tv = JSON.stringify(room.snapshot(null));
      assert.ok(!tv.includes('"hand"') && !tv.includes('"resources"'), 'the TV sees no hands or resources');
    }
  }
  assert.equal(g.phase, 'over');
  assert.equal(load(room.file).phase, 'over', 'the game is saved as it goes');
  const end = room.snapshot(seats[0].token);
  assert.equal(end.game!.winner, g.winner);
  assert.equal(end.game!.finalTotals!.length, 3);
  room.close();
});

test('a room of bots plays itself to the end', async () => {
  const room = new Room('BOTS', { botDelayMs: 0, dir });
  room.addBot();
  room.addBot();
  room.start(room.hostToken, 3);
  for (let i = 0; i < 400 && room.game!.phase !== 'over'; i++) await sleep(10);
  assert.equal(room.game!.phase, 'over');
  room.close();
});

test('lobby rules: names, size, joining late', () => {
  const room = new Room('LOBY', { dir });
  room.join('Ada');
  assert.throws(() => room.join('ada'), /already called/);
  assert.throws(() => room.join('   '), /Pick a name/);
  assert.throws(() => room.start(room.hostToken), /at least 2/);
  for (let i = 0; i < 5; i++) room.addBot();
  assert.throws(() => room.join('Late'), /full/);
  room.leave(5);
  room.start(room.hostToken);
  assert.throws(() => room.join('Late'), /already started/);
  assert.equal(room.game!.players.length, 5);
  room.close();
});

test('the HTTP server: rooms, joining, live snapshots, commands and the clients', async () => {
  const { server, rooms } = startServer(0, { dir });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => {
    const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, string> };
  };
  try {
    const { body: made } = await post('/api/rooms', {});
    assert.match(made.code, /^[A-Z]{4}$/);
    const ada = (await post(`/api/rooms/${made.code}/join`, { name: 'Ada' })).body.token;
    await post(`/api/rooms/${made.code}/bot`, { token: made.hostToken });
    assert.equal((await post(`/api/rooms/${made.code.toLowerCase()}/join`, { name: 'Ada' })).status, 400, 'codes are case-insensitive; names unique');
    assert.equal((await post('/api/rooms/ZZZZ/join', { name: 'X' })).status, 400);
    assert.equal((await post(`/api/rooms/${made.code}/start`, { token: ada })).status, 200);
    rooms.get(made.code)!.seats[1].kind = 'open'; // keep the game still while we look at it

    // Server-sent events: the first message is the current snapshot.
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/rooms/${made.code}/events?token=${ada}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    const snap = JSON.parse(text.slice(text.indexOf('data: ') + 6, text.indexOf('\n\n'))) as Snapshot;
    assert.equal(snap.seat, 0);
    assert.equal(snap.you!.name, 'Ada');
    assert.equal(snap.game!.round, 1);

    const bad = await post(`/api/rooms/${made.code}/do`, { token: ada, command: 'build c999 0,0' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Keep one of the building cards/); // the round opens with picking a card
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: made.hostToken, command: 'end' })).status, 400, 'the TV has no seat');
    // The round opens with everyone keeping one of two building cards.
    assert.equal(snap.you!.choice.length, 2);
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: ada, command: `keep ${snap.you!.choice[0].id}` })).status, 200);
    const g = rooms.get(made.code)!.game!;
    apply(g, 1, `keep ${g.players[1].choice[0].id}`);
    assert.equal((await post(`/api/rooms/${made.code}/do`, { token: ada, command: 'end' })).status, 200);

    // The clients are served with their TypeScript types stripped.
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /phone\.ts/);
    const js = await fetch(`${base}/common.ts`);
    assert.match(js.headers.get('content-type')!, /javascript/);
    assert.doesNotMatch(await js.text(), /import type|: string\)/);
    assert.equal((await fetch(`${base}/tsconfig.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  } finally {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test('one game, any client: a CLI player and a bot at a server-hosted table', async () => {
  const { server, rooms } = startServer(0, { dir, botDelayMs: 0 });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const code = String(((await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()) as { code: string }).code);
    const url = `${base}/${code}`;
    const joined = await cli('join', url, 'Claude');
    const token = /token: (\w+)/.exec(joined)?.[1];
    assert.ok(token, joined);
    const room = rooms.get(code)!;
    room.addBot();
    assert.match(await cli('start', url, token!), /started/);
    const view = await cli('view', url, token!);
    assert.match(view, /You are P1/);
    assert.match(view, /Your options/);
    const keep = /keep <(c\d+)\|/.exec(view)?.[1];
    assert.ok(keep, view);
    assert.match(await cli('do', url, token!, 'keep', keep!), /You keep/);
    assert.match(await cli('wait', url, token!, '--timeout', '20'), /your decision/); // the bot keeps one too
    assert.match(await cli('do', url, token!, 'build', 'c999', '0,0'), /Not allowed: Build a card from your hand/);
    const ended = await cli('do', url, token!, 'end');
    assert.match(ended, /P1 ends their turn/);
    // The bot plays its turn. Everyone's dragon is still an egg, so there is no
    // raid: wait returns at our next decision, the next round's cards.
    assert.match(await cli('wait', url, token!, '--timeout', '20'), /your decision/);
    assert.equal(room.game!.round, 2);
    assert.equal(room.game!.phase, 'cards');
    assert.match(await cli('status', url), /Room \w{4}: P1 Claude, P2 Tick \(bot\)/);
  } finally {
    for (const r of rooms.values()) r.close();
    server.closeAllConnections();
    server.close();
  }
});

test("a game from the CLI's file mode can be hosted; players claim its open seats", () => {
  const file = join(dir, 'hosted.json');
  const g = newGame(2, 4);
  for (const p of [0, 1]) apply(g, p, `keep ${g.players[p].choice[0].id}`);
  save(file, g);
  const room = new Room('HOST', { file });
  assert.deepEqual(room.seats.map((s) => s.kind), ['open', 'open']);
  const ada = room.join('Ada');
  assert.equal(room.seats.indexOf(ada), 0);
  room.command(ada.token, 'end');
  assert.equal(load(file).turn, 1, 'moves are saved to the same file');
  room.join('Bram');
  assert.throws(() => room.join('Cora'), /every seat is taken/);
  room.close();
});

test('a Claude seat server plays one seat of a room over MCP, and wakes when someone talks', async () => {
  const { server, rooms } = startServer(0, { dir, botDelayMs: 0 }, [], '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: object) => (await (await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })).json()) as Record<string, any>;
  try {
    const { code } = await post('/api/rooms', {});
    const ada = await post(`/api/rooms/${code}/join`, { name: 'Ada' }); // a phone
    const opus = await post(`/api/rooms/${code}/join`, { name: 'Opus' }); // Claude
    await post(`/api/rooms/${code}/start`, { token: ada.token });
    const g = rooms.get(code)!.game!;
    for (const [p, t] of [[0, ada.token], [1, opus.token]] as const) await post(`/api/rooms/${code}/do`, { token: t, command: `keep ${g.players[p].choice[0].id}` });
    const reqs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'view', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'say', arguments: { message: 'hello', to: 'P1' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'act', arguments: { command: 'end', why: 'nothing left to build' } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'wait', arguments: {} } },
    ];
    const moves = join(mkdtempSync(join(tmpdir(), 'board-lite-moves-')), 'moves.txt');
    const child = execFile(process.execPath, ['src/playtest/seat-server.ts', `${base}/${code}`, opus.token, moves], { env: { ...process.env, BOARD_LITE_WAIT_SECS: '20' } });
    const lines: any[] = [];
    let buf = '';
    child.stdout!.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(JSON.parse(buf.slice(0, i)));
    });
    const reply = async (id: number) => {
      for (let t = 0; t < 400; t++) {
        const r = lines.find((l) => l.id === id);
        if (r) return r;
        await sleep(25);
      }
      throw new Error(`no reply to ${id}`);
    };
    // One request at a time, as Claude makes them.
    for (const r of reqs.slice(0, 5)) {
      child.stdin!.write(`${JSON.stringify(r)}\n`);
      await reply(r.id);
    }
    assert.deepEqual((await reply(2)).result.tools.map((t: { name: string }) => t.name), ['view', 'act', 'say', 'wait', 'rules']);
    assert.match((await reply(3)).result.content[0].text, /^Table: P1 Ada, P2 Opus \(you\)\.\nYou are P2\./);
    assert.match((await reply(4)).result.content[0].text, /P2 to P1 \(private\): "hello"/);
    assert.match((await reply(5)).result.content[0].text, /Not allowed/); // it's P1's turn, and the server only plays P2
    // The moves file pairs each move's private reason with what really happened.
    assert.match(readFileSync(moves, 'utf8'), /tell P1 hello\n  -> done\n.* end\n  why: nothing left to build\n  -> not allowed: It's P1's turn/);
    rmSync(dirname(moves), { recursive: true });
    // Waiting returns as soon as the phone player talks.
    child.stdin!.write(`${JSON.stringify(reqs[5])}\n`);
    await sleep(200);
    assert.ok(!lines.some((l) => l.id === 6), 'wait blocks while nothing happens');
    await post(`/api/rooms/${code}/do`, { token: ada.token, command: 'say hi Opus, want to trade?' });
    assert.match((await reply(6)).result.content[0].text, /P1 says: "hi Opus, want to trade\?"[\s\S]*Not your decision/);
    child.kill();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
