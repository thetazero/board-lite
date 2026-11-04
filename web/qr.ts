// A QR code for the room's address, so a phone joins by pointing its camera at
// the TV. Byte mode, error correction level M, versions 1 to 10 (up to 213
// bytes: any address this server prints fits). No dependencies: the encoding
// follows the QR spec (ISO/IEC 18004), as laid out in Project Nayuki's
// reference implementation. test/qr.test.ts checks it against known codes.

// Per version 1..10 at level M: error correction codewords per block, and blocks.
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

/** The modules of a QR code for `text` (true is dark), row by row. `mask` forces a mask pattern (0-7). */
export function qrMatrix(text: string, mask?: number): boolean[][] {
  const data = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= MAX_VERSION && dataCodewords(version) < 2 + data.length + (version >= 10 ? 1 : 0)) version++;
  if (version > MAX_VERSION) throw new Error('Too long for a QR code here.');
  const capacity = dataCodewords(version);

  // The bit stream: mode (byte), length, the bytes, then a terminator and padding.
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(data.length, version >= 10 ? 16 : 8);
  for (const b of data) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; words.length < capacity; pad ^= 0xec ^ 0x11) words.push(pad);

  const code = new Code(version);
  code.drawCodewords(interleave(words, version));
  let best = mask ?? 0;
  if (mask === undefined) {
    let lowest = Infinity;
    for (let m = 0; m < 8; m++) {
      code.applyMask(m);
      code.drawFormat(m);
      const p = code.penalty();
      if (p < lowest) [lowest, best] = [p, m];
      code.applyMask(m); // a mask undoes itself
    }
  }
  code.applyMask(best);
  code.drawFormat(best);
  return code.modules;
}

/** The QR code as an SVG, with the 4-module quiet zone around it the spec asks for. */
export function qrSvg(text: string, label = text): string {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = '';
  m.forEach((row, y) => row.forEach((dark, x) => (d += dark ? `M${x + 4} ${y + 4}h1v1h-1z` : '')));
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label.replace(/[&<>"]/g, '')}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function rawModules(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    r -= (25 * align - 10) * align - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

function dataCodewords(v: number): number {
  return Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v - 1] * BLOCKS[v - 1];
}

// Split into blocks, add each block's error correction, and interleave.
function interleave(words: number[], v: number): number[] {
  const blocks = BLOCKS[v - 1];
  const ecc = ECC_PER_BLOCK[v - 1];
  const raw = Math.floor(rawModules(v) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const div = rsDivisor(ecc);
  const out: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = words.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const rem = rsRemainder(dat, div);
    if (i < short) dat.push(0);
    out.push(dat.concat(rem));
  }
  const result: number[] = [];
  for (let i = 0; i < out[0].length; i++) {
    out.forEach((b, j) => {
      if (i !== shortLen - ecc || j >= short) result.push(b[i]);
    });
  }
  return result;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}

function rsRemainder(data: number[], div: number[]): number[] {
  const r = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

class Code {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly fixed: boolean[][]; // function patterns: never masked, never data

  constructor(version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(s - 4, 3);
    this.finder(3, s - 4);
    const pos = alignment(version);
    const last = pos.length - 1;
    pos.forEach((a, i) => pos.forEach((b, j) => {
      if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) this.align(a, b);
    }));
    this.drawFormat(0); // reserves the format areas
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = s - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, bit);
        this.set(b, a, bit);
      }
    }
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.fixed[y][x] = true;
  }

  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  private align(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormat(mask: number) {
    const data = (0 << 3) | mask; // level M's format bits are 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true); // the dark module
  }

  drawCodewords(words: number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? s - 1 - vert : vert;
          if (!this.fixed[y][x] && i < words.length * 8) {
            this.modules[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.fixed[y][x]) continue;
        const flip = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][mask];
        if (flip) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  // The spec's penalty score: long runs, 2x2 blocks, finder-like patterns, and
  // an uneven share of dark modules. The lowest-scoring mask scans best.
  penalty(): number {
    const s = this.size;
    const m = this.modules;
    let p = 0;
    const lines: boolean[][] = [];
    for (let i = 0; i < s; i++) {
      lines.push(m[i]);
      lines.push(m.map((row) => row[i]));
    }
    const finderLike = [true, false, true, true, true, false, true];
    for (const line of lines) {
      for (let i = 0, run = 1; i < s; i++) {
        if (i > 0 && line[i] === line[i - 1]) run++;
        else run = 1;
        if (run === 5) p += 3;
        else if (run > 5) p += 1;
      }
      for (let i = 0; i + 7 <= s; i++) {
        if (!finderLike.every((v, k) => line[i + k] === v)) continue;
        const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k]);
        const lightAfter = i + 11 <= s && [7, 8, 9, 10].every((k) => !line[i + k]);
        if (lightBefore || lightAfter) p += 40;
      }
    }
    let dark = 0;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (m[y][x]) dark++;
        if (x + 1 < s && y + 1 < s && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
    }
    const total = s * s;
    p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return p;
  }
}

function alignment(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let i = 0, pos = v * 4 + 10; i < n - 1; i++, pos -= step) r.splice(1, 0, pos);
  return r;
}
