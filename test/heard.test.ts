// The phone's count of unread table talk (web/heard.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heard } from '../web/heard.ts';

const says = (i: number, seat: number) => ({ i, text: `P${seat + 1} says: "hi"` });

test('what was said before the phone opened counts as heard, and what comes after is unread', () => {
  const h = new Heard();
  const old = [says(3, 1), says(8, 2)];
  assert.equal(h.unread(old, 0, false), 0);
  assert.equal(h.unread([...old, says(9, 1), says(12, 0)], 0, false), 1); // your own line isn't unread
  assert.equal(h.unread([...old, says(9, 1), says(12, 0)], 0, true), 0);
  assert.equal(h.unread([...old, says(9, 1), says(12, 0)], 0, false), 0);
});

test("a game's first message is unread", () => {
  const h = new Heard();
  assert.equal(h.unread([], 0, false), 0);
  assert.equal(h.unread([says(5, 1)], 0, false), 1);
});

test('a second game on the same phone counts its own messages, whatever the first game reached (#543)', () => {
  const h = new Heard();
  h.unread([says(900, 1)], 0, true); // a long first game, its talk heard
  h.forget();
  assert.equal(h.unread([], 0, false), 0);
  assert.equal(h.unread([says(5, 1), says(6, 1)], 0, false), 2);
});
