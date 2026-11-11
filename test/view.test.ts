// The phone's You / Table switch (web/view.ts): which view shows, from the
// server's snapshots and the player's taps alone. Three times the phone stayed
// on the table over an open vote until a reload (#329, #449, #455); these are
// the rules that keep it from happening again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askKey, PhoneView, type ViewSnapshot } from '../web/view.ts';

const noTv = (o: Partial<ViewSnapshot> = {}): ViewSnapshot => ({ remote: true, scene: 0, ask: '', over: false, ...o });
const withTv = (o: Partial<ViewSnapshot> = {}): ViewSnapshot => ({ ...noTv(o), remote: false, ...o });
const vote = askKey({ phase: 'raid', round: 2, turn: 0, raid: { step: 'vote' } }, true);

test('a vote that opens shows on You, whatever the phone was showing (#455)', () => {
  // LTKN: no scene was held when the vote opened, yet the phone was on the table.
  const v = new PhoneView();
  v.snapshot(0, noTv(), true);
  v.tap(1000, 'table');
  assert.equal(v.view(1000), 'table');
  v.snapshot(2000, noTv({ ask: vote }), true);
  assert.equal(v.view(2000), 'you', 'the vote lands on You');
});

test('a vote that opens as a scene ends shows once the scene is over', () => {
  const v = new PhoneView();
  v.snapshot(0, noTv({ scene: 5000, ask: vote }), true);
  assert.equal(v.view(100), 'table', 'the scene plays first');
  assert.equal(v.youOff(100), true, 'with no TV, You is off while it plays');
  v.tap(200, 'you');
  assert.equal(v.view(200), 'table', 'a tap on You does nothing then');
  v.snapshot(5000, noTv({ ask: vote }), true);
  assert.equal(v.view(5000), 'you');
  assert.equal(v.youOff(5000), false);
});

test("a scene ends on the phone's own clock when the server's word that it's over never comes", () => {
  const v = new PhoneView();
  v.snapshot(0, noTv({ scene: 5000 }), true);
  assert.equal(v.scene(4999), true);
  assert.equal(v.view(4999), 'table');
  assert.equal(v.scene(5000), false);
  assert.equal(v.view(5000), 'you', 'back on You with no snapshot at all');
  assert.equal(v.sceneEndsAt(), 5000, 'the phone knows when to look again');
});

test('the server saying the scene is over ends it at once, even early', () => {
  const v = new PhoneView();
  v.snapshot(0, noTv({ scene: 20_000 }), true);
  v.snapshot(3000, noTv(), true);
  assert.equal(v.view(3000), 'you');
});

test('a phone that slept through scenes never plays them: it goes by what the server holds now (#449)', () => {
  const v = new PhoneView();
  v.snapshot(0, noTv(), true);
  // It wakes a minute later, after two hunts it never heard of; the vote is open.
  v.snapshot(60_000, noTv({ ask: vote }), true);
  assert.equal(v.view(60_000), 'you');
});

test('a scene a phone joins halfway plays for what the server has left of it', () => {
  const v = new PhoneView();
  v.snapshot(0, noTv({ scene: 1200 }), true);
  assert.equal(v.view(1000), 'table');
  assert.equal(v.view(1200), 'you');
});

test('the player looking at the table stays there while the same decision goes on', () => {
  const v = new PhoneView();
  const turn = askKey({ phase: 'action', round: 2, turn: 0 }, true);
  v.snapshot(0, noTv({ ask: turn }), true);
  v.tap(100, 'table');
  v.snapshot(200, noTv({ ask: turn }), true); // someone talks, offers, trades
  assert.equal(v.view(200), 'table');
  v.tap(300, 'you');
  assert.equal(v.view(300), 'you');
});

test('after a scene, the phone goes back to the view the player chose', () => {
  const v = new PhoneView();
  v.snapshot(0, noTv(), true);
  v.tap(0, 'table');
  v.snapshot(100, noTv({ scene: 3000 }), true);
  v.snapshot(3100, noTv(), true);
  assert.equal(v.view(3100), 'table', 'they were looking at the table');
  const w = new PhoneView();
  w.snapshot(0, noTv(), true);
  w.snapshot(100, noTv({ scene: 3000 }), true);
  w.snapshot(3100, noTv(), true);
  assert.equal(w.view(3100), 'you');
});

test('with a TV, a scene cuts to the table only on a phone that opened it, and You takes it back', () => {
  const v = new PhoneView();
  v.snapshot(0, withTv({ scene: 5000 }), false);
  assert.equal(v.view(100), 'you', 'no table loaded: the phone says to watch the TV');
  assert.equal(v.youOff(100), false);
  v.frame(true);
  v.snapshot(6000, withTv({ scene: 5000 }), true);
  assert.equal(v.view(6100), 'table', 'the next scene, with the table loaded');
  v.tap(6200, 'you');
  assert.equal(v.view(6200), 'you', 'You is never off with a TV');
  v.snapshot(6300, withTv({ scene: 4700 }), true);
  assert.equal(v.view(6300), 'you', 'the same scene goes on: still You');
  v.snapshot(12_000, withTv({ scene: 3000 }), true);
  assert.equal(v.view(12_000), 'table', 'a new scene cuts again');
});

test('with no TV, a game that ends goes to the table for its summary', () => {
  const v = new PhoneView();
  v.snapshot(0, noTv(), true);
  v.snapshot(100, noTv({ over: true }), true);
  assert.equal(v.view(100), 'table');
  v.tap(200, 'you');
  v.snapshot(300, noTv({ over: true }), true);
  assert.equal(v.view(300), 'you', 'only the once');
  const late = new PhoneView();
  late.snapshot(0, noTv({ over: true }), true);
  assert.equal(late.view(0), 'you', 'a phone opened on a finished game shows its own end screen');
});

test('the decision key changes with each new decision, and is empty with none', () => {
  assert.equal(askKey({ phase: 'raid', round: 2, turn: 0, raid: { step: 'vote' } }, false), '');
  assert.equal(askKey(null, true), '');
  assert.notEqual(vote, askKey({ phase: 'raid', round: 2, turn: 0, raid: { step: 'choose' } }, true));
  assert.notEqual(askKey({ phase: 'action', round: 2, turn: 0 }, true), askKey({ phase: 'action', round: 2, turn: 1 }, true));
});
