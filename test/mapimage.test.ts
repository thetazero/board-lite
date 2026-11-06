// The picture of the board Claude players get with their view (#384).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { botStep } from '../src/bot.ts';
import { buildableHexes, newGame } from '../src/engine.ts';
import { buildable, mapImage } from '../src/mapimage.ts';
import { publicState } from '../src/state.ts';

test('the picture is a PNG of the whole board', () => {
  for (const n of [2, 5, 6]) {
    const g = newGame(n, 3);
    const rng = { state: 9 };
    for (let i = 0; i < 400 && g.phase !== 'over'; i++) botStep(g, rng);
    const png = mapImage(publicState(g), 0);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    assert.ok(w > 300 && w < 1000 && h > 300 && h < 1000, `${w}x${h}`);
    const idat = png.indexOf('IDAT');
    assert.equal(inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).length, (w * 3 + 1) * h);
  }
});

test("the picture's build dots are where the engine lets each player build", () => {
  for (const seed of [1, 2, 3, 4]) {
    const g = newGame(4, seed);
    const rng = { state: seed };
    for (let i = 0; i < 1200 && g.phase !== 'over'; i++) {
      botStep(g, rng);
      if (i % 100) continue;
      const dots = buildable(publicState(g).map);
      for (let p = 0; p < 4; p++) {
        const mine = [...dots].filter(([, who]) => who.includes(p)).map(([k]) => k).sort();
        assert.deepEqual(mine, buildableHexes(g, p, 'roost'), `seed ${seed}, step ${i}, P${p + 1}`);
      }
    }
  }
});
