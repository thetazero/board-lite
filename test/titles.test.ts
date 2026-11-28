// The TV's toast when a title changes hands (web/titles.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TitleNews } from '../web/titles.ts';

const at = (i: number, tower: number | null, hoard: number | null = null) => ({
  log: [{ i }],
  titles: [
    { key: 'tower' as const, name: 'Tallest Tower', holder: tower, values: [], min: 4 },
    { key: 'hoard' as const, name: 'Largest Hoard', holder: hoard, values: [], min: 20 },
  ],
});
const tower = (from: number | null, to: number | null) => ({ key: 'tower', name: 'Tallest Tower', from, to });

test('a title that changes hands is told once, with who loses it', () => {
  const n = new TitleNews();
  assert.deepEqual(n.next(at(1, null)), []);
  assert.deepEqual(n.next(at(2, 0)), [tower(null, 0)]);
  assert.deepEqual(n.next(at(3, 0)), []);
  assert.deepEqual(n.next(at(4, 1)), [tower(0, 1)]);
  assert.deepEqual(n.next(at(5, null)), [tower(1, null)]); // no one holds it now
});

test('a TV opened mid-game says nothing about the titles already held', () => {
  assert.deepEqual(new TitleNews().next(at(40, 2, 0)), []);
});

test('several titles at once are each told', () => {
  const n = new TitleNews();
  n.next(at(1, null));
  assert.deepEqual(n.next(at(2, 1, 1)).map((c) => c.key), ['tower', 'hoard']);
});

test('a toast a scene cut off is told again after it, as things stand then', () => {
  const n = new TitleNews();
  n.next(at(1, 0));
  const cut = n.next(at(2, 1));
  n.unread(cut);
  assert.deepEqual(n.next(at(3, 1)), cut);
  n.unread(cut);
  assert.deepEqual(n.next(at(4, 2)), [tower(0, 2)]); // it changed again in the scene
  const first = n.next(at(5, 0)), second = n.next(at(6, 1));
  n.unread([...first, ...second]); // two up at once for the same title
  assert.deepEqual(n.next(at(7, 2)), []); // it's back with who had it
});

test('a game that goes back a move, or on from a save, is not news', () => {
  const n = new TitleNews();
  n.next(at(5, 0));
  assert.deepEqual(n.next(at(4, null)), []);
  n.skip(at(9, 2));
  assert.deepEqual(n.next(at(10, 2)), []);
  assert.deepEqual(n.next(at(11, 0)), [tower(2, 0)]);
});
