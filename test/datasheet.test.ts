import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DATASHEET_PATH, datasheet } from '../src/datasheet.ts';

test('docs/datasheet.md matches the current tuning', () => {
  const fresh = datasheet();
  assert.ok(fresh.includes('| Quarry |'), 'the datasheet lists the buildings');
  assert.ok(readFileSync(DATASHEET_PATH, 'utf8') === fresh, 'docs/datasheet.md is out of date: run `npm run datasheet` and commit it');
});
