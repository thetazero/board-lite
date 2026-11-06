import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nextTip, TIPS } from '../web/tips.ts';

test("the rulebook's Tips section lists every tip the TV shows, word for word", () => {
  const rules = readFileSync(new URL('../docs/rules.md', import.meta.url), 'utf8');
  const section = rules.split('\n## Tips\n')[1]?.split('\n## ')[0];
  assert.ok(section, 'docs/rules.md has a Tips section');
  const listed = section.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  assert.deepEqual(listed, TIPS);
});

test('the next tip is a different one, and every other tip can come up', () => {
  for (let now = 0; now < TIPS.length; now++) {
    const seen = new Set<number>();
    for (let k = 0; k < 100; k++) seen.add(nextTip(now, () => k / 100));
    assert.ok(!seen.has(now));
    assert.equal(seen.size, TIPS.length - 1);
  }
});
