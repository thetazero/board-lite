// A load the page can't do without, tried again when it fails (web/retry.ts):
// the lobby's explanation waits on the rulebook (#560).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepTrying } from '../web/retry.ts';

test('a load that fails is tried again until it works', async () => {
  let tries = 0;
  const load = async () => {
    if (++tries < 3) throw new Error('503');
    return 'the rulebook';
  };
  assert.equal(await keepTrying(load, () => true, 1), 'the rulebook');
  assert.equal(tries, 3);
});

test('a load no longer wanted is not tried again', async () => {
  let tries = 0;
  const load = async () => {
    tries++;
    throw new Error('503');
  };
  assert.equal(await keepTrying(load, () => false, 1), null);
  assert.equal(tries, 1);
});
