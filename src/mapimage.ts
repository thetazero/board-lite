// A simplified picture of the board, as a PNG, for Claude players (#384): the
// text map says what's on each hex, but its rows don't line up as a hex grid,
// so who holds which land, and where the open land between players is, is hard
// to see from it. The picture shows just that: each hex in place, filled in its
// owner's color, its coordinates on it, beasts, and dots for who can build on
// each empty hex. No dependencies: a small bitmap font, each pixel worked out
// from its hex, and node's zlib for the PNG.

import { crc32, deflateSync } from 'node:zlib';
import type { HexView, PublicState } from './state.ts';
import { DIRECTIONS, key } from './map.ts';

// The TV's seat colors (web/common.ts PLAYER_COLORS) and lightened terrain
// colors, so owned land stands out from the land no one holds.
const PLAYER = ['#e5484d', '#3e7bfa', '#f2b600', '#30a46c', '#a35bd8', '#f76b15'];
const TERRAIN: Record<string, string> = { mountain: '#c4c5c9', forest: '#a9c4ad', ley: '#c6bedd', meadow: '#d6e8bf', plains: '#efe6cb', harbor: '#b5dfda', ocean: '#9fbad6' };
const BG = '#ffffff';
const LINE = '#6b6f78';
const INK = '#111111';

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const light = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150;

// 5x7 glyphs, each 7 rows of 5, '#' set.
const FONT: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
};

class Canvas {
  readonly px: Uint8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }
  set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(c, (y * this.w + x) * 3);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  disc(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c);
  }
  // Text centred on (cx, cy), each font pixel `scale` pixels wide.
  text(s: string, cx: number, cy: number, c: RGB, scale = 1) {
    const w = (s.length * 6 - 1) * scale;
    const x0 = Math.round(cx - w / 2);
    const y0 = Math.round(cy - (7 * scale) / 2);
    [...s].forEach((ch, n) => {
      const g = FONT[ch.toUpperCase()] ?? FONT[' '];
      g.forEach((row, j) => [...row].forEach((b, i) => b === '#' && this.rect(x0 + (n * 6 + i) * scale, y0 + j * scale, scale, scale, c)));
    });
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) Buffer.from(this.px.buffer, y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1);
    const chunk = (type: string, data: Buffer) => {
      const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
}

const FAUNA_LETTER: Record<string, string> = { wolf_pack: 'W', cave_bear: 'B', basilisk: 'X', thunderbird: 'T', leviathan: 'V' };
const SQ3 = Math.sqrt(3);
const S = 30; // hex size: centre to corner, in pixels

// Pointy-top hexes, laid out as on the TV (web/common.ts hexCenter).
const center = (q: number, r: number): [number, number] => [S * SQ3 * (q + r / 2), S * 1.5 * r];
// Each axial direction as a unit vector on screen, to find which side of its hex a pixel is near.
const SIDES = DIRECTIONS.map(([dq, dr]) => {
  const [x, y] = center(dq, dr);
  const l = Math.hypot(x, y);
  return [x / l, y / l, dq, dr] as const;
});

// The empty land hexes each player can build on: no building, no beast, not
// held, adjacent to one of their buildings that isn't suppressed (the engine's
// rule for building).
export function buildable(map: HexView[]): Map<string, number[]> {
  const byKey = new Map(map.map((h) => [h.k, h]));
  const out = new Map<string, number[]>();
  for (const h of map) {
    if (h.terrain === 'ocean' || h.building || h.fauna || h.held) continue;
    const who = new Set<number>();
    for (const [dq, dr] of DIRECTIONS) {
      const n = byKey.get(key(h.q + dq, h.r + dr));
      if (n?.building && !n.suppressed) who.add(n.building.owner);
    }
    if (who.size) out.set(h.k, [...who].sort());
  }
  return out;
}

// The board as a PNG, from seat `you`'s point of view (only the legend's "YOU"
// depends on it: the board is public).
export function mapImage(g: PublicState, you: number): Buffer {
  const byKey = new Map(g.map.map((h) => [h.k, h]));
  const owner = (k: string) => byKey.get(k)?.building?.owner ?? -1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const h of g.map) {
    const [x, y] = center(h.q, h.r);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 8;
  const ox = -minX + S + pad;
  const oy = -minY + S + pad;
  const players = g.players.length;
  const legendRow = 26;
  const boardH = Math.ceil(maxY - minY + 2 * S + 2 * pad);
  const c = new Canvas(Math.ceil(maxX - minX + 2 * S + 2 * pad), boardH + legendRow * Math.ceil(players / 3) + pad, rgb(BG));
  const inr = (S * SQ3) / 2; // centre to side

  // Every pixel of the board: find its hex, then how far out it is towards which side.
  for (let py = 0; py < boardH; py++) {
    for (let px = 0; px < c.w; px++) {
      const x = px - ox, y = py - oy;
      const fq = ((SQ3 / 3) * x - y / 3) / S, fr = ((2 / 3) * y) / S;
      let rq = Math.round(fq), rr = Math.round(fr);
      const rs = Math.round(-fq - fr);
      const dq = Math.abs(rq - fq), dr = Math.abs(rr - fr), ds = Math.abs(rs + fq + fr);
      if (dq > dr && dq > ds) rq = -rr - rs;
      else if (dr > ds) rr = -rq - rs;
      const h = byKey.get(key(rq, rr));
      if (!h) continue;
      const [cx, cy] = center(h.q, h.r);
      const lx = x - cx, ly = y - cy;
      let d = -1, side = SIDES[0];
      for (const sd of SIDES) {
        const v = (lx * sd[0] + ly * sd[1]) / inr;
        if (v > d) { d = v; side = sd; }
      }
      const own = h.building?.owner ?? -1;
      let col = own >= 0 ? rgb(PLAYER[own]) : rgb(TERRAIN[h.terrain] ?? TERRAIN.plains);
      // Held by a great beast, or a suppressed building: dark stripes.
      if ((h.held || h.suppressed) && (Math.floor(px + py) % 8) < 2) col = mix(col, rgb(INK), 0.55);
      // A tower: a white ring inside its hex.
      if (h.building?.type === 'tower' && d > 0.62 && d < 0.74) col = rgb(BG);
      // Territory edge: a thick dark line where a player's land meets anything else.
      const across = owner(key(h.q + side[2], h.r + side[3]));
      if (own >= 0 && across !== own && d > 0.84) col = mix(rgb(PLAYER[own]), rgb(INK), 0.6);
      else if (d > 0.95) col = rgb(LINE);
      c.set(px, py, col);
    }
  }

  // On each hex: its coordinates; a beast's letter on a dark disc; a dot for each player who can build there.
  const canBuild = buildable(g.map);
  for (const h of g.map) {
    const [x0, y0] = center(h.q, h.r);
    const x = x0 + ox, y = y0 + oy;
    const own = h.building?.owner ?? -1;
    const fill = own >= 0 ? rgb(PLAYER[own]) : rgb(TERRAIN[h.terrain] ?? TERRAIN.plains);
    const ink = light(fill) ? rgb(INK) : rgb(BG);
    if (h.fauna) {
      c.disc(x, y - S * 0.38, 8, rgb(INK));
      c.text(FAUNA_LETTER[h.fauna.key] ?? h.fauna.key[0], x + 0.5, y - S * 0.38, rgb(BG));
    }
    if (h.terrain !== 'ocean' || h.fauna) c.text(h.k, x, y + (h.fauna ? 4 : 0), ink);
    const dots = canBuild.get(h.k) ?? [];
    dots.forEach((p, i) => {
      const dx = (i - (dots.length - 1) / 2) * 9;
      c.disc(x + dx, y - S * 0.42, 4.2, rgb(INK));
      c.disc(x + dx, y - S * 0.42, 3.2, rgb(PLAYER[p]));
    });
  }

  // Legend: each player's color, and how many hexes their buildings stand on.
  for (let p = 0; p < players; p++) {
    const col = p % 3, row = Math.floor(p / 3);
    const lx = pad + col * Math.floor((c.w - 2 * pad) / 3);
    const ly = boardH + row * legendRow + 4;
    c.rect(lx, ly, 18, 18, rgb(INK));
    c.rect(lx + 2, ly + 2, 14, 14, rgb(PLAYER[p]));
    const hexes = g.map.filter((h) => h.building?.owner === p).length;
    const label = `P${p + 1}${p === you ? ' YOU' : ''}: ${hexes} HEXES`;
    c.text(label, lx + 24 + ((label.length * 6 - 1) * 2) / 2, ly + 9, rgb(INK), 2);
  }
  return c.png();
}

// What the picture shows, in words, to go beside it.
export const MAP_IMAGE_KEY = 'The picture: each hex at its place, with its coordinates. A hex in a player\'s color has their building on it (a white ring: their tower); a dark edge runs around each player\'s land. Colored dots on an empty hex: who can build there. A dark disc: a beast (W Wolf Pack, B Cave Bear, X Basilisk, T Thunderbird, V Leviathan). Dark stripes: suppressed, or held by a great beast. Colors: P1 red, P2 blue, P3 yellow, P4 green, P5 purple, P6 orange.';
