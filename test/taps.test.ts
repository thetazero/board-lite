// Taps on the phone over a slow connection (web/taps.ts, #456): tapping a
// button several times before the screen catches up does what one tap does:
// no errors, no repeated actions. Taps on different buttons all count (#131).

import type { Command } from '../src/command.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { steady, taps } from '../web/taps.ts';
import { named } from '../web/common.ts';
import { Room } from '../src/host.ts';
import { RESOURCES } from '../src/data.ts';
import type { Snapshot } from '../src/state.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A phone on slow Wi-Fi at a real table: each command takes `lagMs` to reach
// the server and as long again for the answer to come back. The phone draws
// the answer's snapshot if it's newer than the one on screen, as web/phone.ts does.
function slowPhone(room: Room, tok: string, lagMs: number) {
  const errors: string[] = [];
  let dropAnswers = 0; // the next answers lost on the way back (the server did the command)
  let shownV = -1;
  let screen: Snapshot = room.snapshot(tok);
  const phone = taps({
    post: async (command, id) => {
      await sleep(lagMs);
      try {
        room.command(tok, command, 'phone', id);
      } catch (e) {
        await sleep(lagMs);
        throw e;
      }
      const state = room.snapshot(tok);
      await sleep(lagMs);
      if (dropAnswers > 0 && dropAnswers--) throw Object.assign(new Error("The server didn't answer: try again."), { unanswered: true });
      return { state };
    },
    answer: (reply) => {
      const s = (reply as { state: Snapshot }).state;
      if (s.v! <= shownV) return false;
      shownV = s.v!;
      screen = s;
      phone.seen();
      return true;
    },
    fail: (e) => errors.push((e as Error).message),
  });
  return { phone, errors, screen: () => screen, loseAnswer: () => void dropAnswers++ };
}

// Taps `times` times, `gapMs` apart: quicker than the answer comes back.
async function tapping(times: number, gapMs: number, tap: () => void) {
  for (let i = 0; i < times; i++) {
    tap();
    await sleep(gapMs);
  }
}

test('on a slow connection, tapping a button again and again does what one tap does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'board-lite-taps-'));
  try {
    const room = new Room('TAPS', { dir });
    const [ada, bram] = ['Ada', 'Bram'].map((n) => room.join(n));
    room.start(ada.token, 3);
    const g = room.game!;
    for (const s of [ada, bram]) room.command(s.token, { do: 'keep', card: g.players[room.seatOf(s.token)].choice[0].id });
    assert.equal(g.phase, 'action');
    const me = g.turn;
    const tok = [ada, bram][me].token;
    const { phone, errors, screen, loseAnswer } = slowPhone(room, tok, 40);
    const v0 = room.snapshot(tok).v!;

    // The trade form, as the phone has it: Send offer builds the command from
    // the form, then empties it. A second tap on the emptied form once sent an
    // offer to "P0" (#456).
    const have = RESOURCES.find((r) => g.players[me].resources[r] > 0)!;
    const fresh = () => ({ to: -1 as number | null, give: {} as Record<string, number> });
    let form = { to: 1 - me as number | null, give: { [have]: 1 } as Record<string, number> };
    const sendOffer = () => {
      const cmd: Command = { do: 'offer', to: form.to === null ? 'anyone' : `P${form.to + 1}`, give: form.give };
      form = fresh();
      return phone.send(cmd);
    };
    await tapping(4, 15, () => phone.tap('#offer', sendOffer));
    await sleep(200);
    assert.deepEqual(errors, []);
    assert.equal(g.offers.length, 1, 'one offer, however many taps');
    assert.equal(screen().game!.offers.length, 1, 'and the phone shows it as soon as the server answers');
    assert.ok(screen().v! > v0, 'each change to the room raises its snapshots\' version');

    // Withdraw, tapped again and again: withdrawn once, no "no open offer" error.
    const id = g.offers[0].id;
    await tapping(4, 15, () => phone.tap(`[data-cancel] {"cancel":"${id}"}`, () => phone.send({ do: 'cancel', offer: id })));
    await sleep(200);
    assert.deepEqual(errors, []);
    assert.equal(g.offers.length, 0);

    // End turn's confirm, tapped again and again: the turn ends once, with no
    // "it's their turn" error from the taps after it.
    const ends = () => g.log.filter((e) => e.ev?.k === 'end').length;
    const before = ends();
    await tapping(4, 15, () => phone.tap('#endyes', () => phone.send({ do: 'end' })));
    await sleep(200);
    assert.deepEqual(errors, []);
    assert.equal(ends(), before + 1, 'the turn ends once');

    // Table talk: Send tapped again and again says it once. And when the
    // answer is lost (the server heard it, the phone never heard back), the
    // phone says to try again; sent again, it's still said once.
    const said = () => g.log.filter((e) => / says: "/.test(e.text)).length;
    const talked = said();
    await tapping(4, 15, () => phone.tap('talk', () => phone.send({ do: 'say', message: 'good luck' })));
    await sleep(200);
    assert.deepEqual(errors, []);
    assert.equal(said(), talked + 1, 'said once, however many taps');
    loseAnswer();
    phone.tap('talk', () => phone.send({ do: 'say', message: 'well played' }));
    await sleep(200);
    assert.deepEqual(errors, ["The server didn't answer: try again."]);
    assert.equal(said(), talked + 2, 'the server heard it');
    phone.tap('talk', () => phone.send({ do: 'say', message: 'well played' }));
    await sleep(200);
    assert.equal(said(), talked + 2, 'sent again after "try again": not said twice');
    phone.tap('talk', () => phone.send({ do: 'say', message: 'well played' }));
    await sleep(200);
    assert.equal(said(), talked + 3, 'and once that went through, saying it again is a new message');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A server of our own, answering when told to.
function fakeServer() {
  const sent: Command[] = [];
  const waiting: { ok: (r: unknown) => void; no: (e: Error) => void }[] = [];
  const errors: string[] = [];
  let fresh = true; // whether the next answer brings a newer snapshot
  const phone = taps({
    post: (command) => {
      sent.push(command);
      return new Promise((ok, no) => waiting.push({ ok, no }));
    },
    answer: () => fresh,
    fail: (e) => errors.push((e as Error).message),
    waitMs: 1000,
  });
  return {
    phone, sent, errors,
    stale: () => void (fresh = false),
    answer: async () => {
      waiting.shift()!.ok({});
      await sleep(0);
    },
    refuse: async (msg: string) => {
      waiting.shift()!.no(new Error(msg));
      await sleep(0);
    },
  };
}

test('taps on different buttons all count, and go in the order tapped', async () => {
  const s = fakeServer();
  s.phone.tap('a', () => s.phone.send({ do: 'vote', target: 'brindle' }));
  s.phone.tap('b', () => s.phone.send({ do: 'fight', dragons: ['d1'] }));
  s.phone.tap('a', () => s.phone.send({ do: 'vote', target: 'brindle' })); // the first still on its way: dropped
  await s.answer();
  await s.answer();
  assert.deepEqual(s.sent, [{ do: 'vote', target: 'brindle' }, { do: 'fight', dragons: ['d1'] }]);
  // Answered and on screen: the button can be tapped again.
  s.phone.tap('a', () => s.phone.send({ do: 'vote', target: 'frostpeak' }));
  await s.answer();
  assert.deepEqual(s.sent, [{ do: 'vote', target: 'brindle' }, { do: 'fight', dragons: ['d1'] }, { do: 'vote', target: 'frostpeak' }]);
});

test('a button stays put until the screen shows its answer', async () => {
  const s = fakeServer();
  s.stale(); // the answer comes back with nothing newer: the push is still on its way
  s.phone.tap('a', () => s.phone.send({ do: 'end' }));
  await s.answer();
  s.phone.tap('a', () => s.phone.send({ do: 'end' }));
  assert.deepEqual(s.sent, [{ do: 'end' }], 'the screen still shows End turn: a tap on it is a repeat');
  s.phone.seen(); // the push arrives
  await sleep(0);
  s.phone.tap('a', () => s.phone.send({ do: 'end' }));
  assert.deepEqual(s.sent, [{ do: 'end' }, { do: 'end' }]);
});

test('a refused command drops what was tapped after it, and says so once', async () => {
  const s = fakeServer();
  s.phone.tap('a', () => s.phone.send({ do: 'build', card: 'c1', hex: '0,1' }));
  s.phone.tap('b', () => s.phone.send({ do: 'end' }));
  await s.refuse("You can't afford 2 stone.");
  assert.deepEqual(s.sent, [{ do: 'build', card: 'c1', hex: '0,1' }]);
  assert.deepEqual(s.errors, ["You can't afford 2 stone."]);
  // The button is free again at once: nothing changed to wait for.
  s.phone.tap('a', () => s.phone.send({ do: 'build', card: 'c1', hex: '0,1' }));
  assert.deepEqual(s.sent, [{ do: 'build', card: 'c1', hex: '0,1' }, { do: 'build', card: 'c1', hex: '0,1' }]);
});

test('a command whose answer was lost goes again under the same id; anything else gets a new one', async () => {
  const ids: string[] = [];
  let lose = true;
  const phone = taps({
    post: async (_command, id) => {
      ids.push(id);
      if (lose) throw Object.assign(new Error('no answer'), { unanswered: true });
      return {};
    },
    answer: () => true,
    fail: () => {},
  });
  await phone.send({ do: 'say', message: 'hi' });
  lose = false;
  await phone.send({ do: 'say', message: 'hi' });
  assert.equal(ids[1], ids[0], 'the retry is the same sending');
  await phone.send({ do: 'say', message: 'hi' });
  assert.notEqual(ids[2], ids[1], 'once it went through, the same words again are new');
  lose = true;
  await phone.send({ do: 'say', message: 'hi' });
  lose = false;
  await phone.send({ do: 'end' });
  assert.notEqual(ids[4], ids[3], 'another command after a lost one is its own');
});

test('taps that only change the phone (a stepper, a pick) count every time', async () => {
  const s = fakeServer();
  let n = 0;
  for (let i = 0; i < 3; i++) {
    s.phone.tap('+', () => n++);
    await sleep(0);
  }
  assert.equal(n, 3);
});

test('errors a stale tap can meet are said in words, not ids', () => {
  const names = ['Rowan', 'Quinn'];
  assert.equal(named('Unknown player "P0". Players are P1..P2.', names), "That player isn't at the table.");
  assert.equal(named('There is no offer "o3" made to you.', names), 'There is no offer made to you.');
  assert.equal(named('You have no open offer "o3".', names), 'You have no open offer.');
  assert.equal(named('You have no card "c12" in hand.', names), "That card isn't in your hand any more.");
});

test('a second tap on a remove button does not remove whoever moved up under it', () => {
  let t = 1000;
  const list = steady(600, () => t);
  list.drawn([1, 2, 3]);
  assert.ok(list.still);
  list.drawn([1, 2, 3, 4]); // someone joining moves no one
  assert.ok(list.still);
  list.drawn([1, 3, 4]);
  t += 300;
  assert.ok(!list.still);
  list.drawn([1, 3, 4]); // drawn again, unchanged
  t += 300;
  assert.ok(list.still);
});
