// The TV's QR code (web/qr.ts) against codes made by a reference encoder (the
// Python qrcode package, 8.2, level M, byte mode, the same mask forced): the
// SHA-256 of each code's rows as 0/1 strings must match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, qrSvg } from '../web/qr.ts';

const hash = (m: boolean[][]) => createHash('sha256').update(m.map((r) => r.map((c) => (c ? '1' : '0')).join('')).join('\n')).digest('hex');

test('QR codes match a reference encoder', () => {
  const cases: [string, number, number, string][] = [
    ['http://192.168.1.20:8080/HXJN', 3, 29, 'fb1bc484c070b016b1b6fcf7a022a4058ab934b7ba68074462b49cace04a42d2'],
    ['http://100.101.102.103:8080/BCDF', 6, 29, '53ed0bbb735ca853733106b432466f7fac94debfe33c5955eb052d26b2002ba7'],
    ['w'.repeat(200), 1, 57, '343845e26645cd28efddef50442427dde63a09b9636760be029feefe4ad28382'], // version 10: two-byte length, version bits
  ];
  for (const [text, mask, size, want] of cases) {
    const m = qrMatrix(text, mask);
    assert.equal(m.length, size, text);
    assert.equal(hash(m), want, text);
  }
});

test('a room address makes a small code, and too long a text is refused', () => {
  assert.equal(qrMatrix('http://192.168.1.20:8080/HXJN').length, 29); // version 3: big modules on the TV
  assert.match(qrSvg('http://x/ABCD'), /^<svg class="qr" viewBox="0 0 29 29"/); // version 1 plus the quiet zone
  assert.throws(() => qrMatrix('x'.repeat(300)));
});
