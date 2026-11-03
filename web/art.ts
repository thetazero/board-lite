// Card art in the game's papercraft look: every picture is folded paper
// (origami subjects made of flat facets, one light side and one shadow side,
// with a crease between) standing on layers of cut paper (a sky sheet, a far
// layer and a ground layer, each lifted a little off the one behind, like a
// pop-up book). Edges are straight cuts, never curves, so the set reads as one
// folded deck. Everything is inline SVG on a 120 x 84 box: the phone downloads
// nothing extra. The card frame around the art lives in phone.ts and style.css.

import { ELEMENT_COLORS, TERRAIN_COLORS } from './common.ts';

type Pt = [number, number];

// ---------- paper and folds ----------

function hex2rgb(c: string): number[] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = hex2rgb(a);
  const y = hex2rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// Light falls from the upper left: t > 0 is a face turned to the light, t < 0 one in shadow.
// Shadows go toward a warm violet, not black, so folds stay paper-coloured.
export function tone(c: string, t: number): string {
  return t >= 0 ? mix(c, '#fff8ea', t) : mix(c, '#2a1d33', -t);
}

const pts = (p: Pt[]) => p.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join(' L');

// One flat facet of folded paper, with a faint crease along its edges.
function f(p: Pt[], color: string, t = 0): string {
  return `<path d="M${pts(p)}Z" fill="${tone(color, t)}" stroke="${tone(color, t - 0.18)}" stroke-width=".35" stroke-linejoin="round"/>`;
}

// A layer of the pop-up: its own shadow falls on the layer behind.
const lift = (body: string, high = false) => `<g filter="url(#${high ? 'pp-lift2' : 'pp-lift'})">${body}</g>`;
const at = (x: number, y: number, s: number, body: string, flip = false) => `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">${body}</g>`;

// The filters the art shares, defined once per page.
export const ART_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="pp-lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx=".4" dy="1.1" stdDeviation=".7" flood-color="#2a1d33" flood-opacity=".45"/></filter>
  <filter id="pp-lift2" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx=".8" dy="2" stdDeviation="1.2" flood-color="#2a1d33" flood-opacity=".5"/></filter>
</defs></svg>`;

// ---------- scenery ----------

// A sheet of sky paper, with a cut-paper sun or moon.
function sky(color: string, disc?: { x: number; y: number; r: number; c: string }): string {
  const sun = disc ? lift(f(poly(disc.x, disc.y, disc.r, 8), disc.c, 0.1)) : '';
  return `<rect width="120" height="84" fill="${color}"/>${sun}`;
}

// A regular polygon (paper cut with scissors, not a compass).
function poly(cx: number, cy: number, r: number, n: number, rot = 0, ry = r): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (Math.PI * 2 * i) / n;
    return [cx + r * Math.cos(a), cy + ry * Math.sin(a)] as Pt;
  });
}

// A strip of ground cut along a straight-edged line, from y-values left to right.
function strip(ys: number[], color: string, t = 0): string {
  const step = 120 / (ys.length - 1);
  return f([...ys.map((y, i) => [i * step, y] as Pt), [120, 84], [0, 84]], color, t);
}

// Far ridges: each peak two facets, lit side and shadow side.
function ridges(peaks: [number, number, number][], color: string, base = 64): string {
  return peaks.map(([x, h, w]) => f([[x - w, base], [x, base - h], [x, base]], color, 0.12) + f([[x, base - h], [x + w, base], [x, base]], color, -0.15)).join('');
}

function groundLayers(terrain: string, ys = [60, 58, 61, 57, 60, 59, 61]): string {
  const c = TERRAIN_COLORS[terrain];
  return lift(strip(ys, c, 0.05)) + lift(strip(ys.map((y, i) => y + 13 + (i % 2 ? 2 : -1)), c, -0.12));
}

function shadowUnder(x: number, y: number, w: number): string {
  return `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${w * 0.16}" fill="#2a1d33" opacity=".22"/>`;
}

// ---------- folded subjects (drawn around 0,0) ----------

// An isometric paper box: top face centred on (x, y), w wide along the right
// edge, d deep along the left edge, h tall.
function box(x: number, y: number, w: number, d: number, h: number, c: string): string {
  const R: Pt = [0.87 * w, 0.5 * w];
  const L: Pt = [-0.87 * d, 0.5 * d];
  const B: Pt = [x - (R[0] + L[0]) / 2, y - (R[1] + L[1]) / 2];
  const add = (...v: Pt[]): Pt => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1]] as Pt, [0, 0] as Pt);
  const down: Pt = [0, h];
  return f([B, add(B, R), add(B, R, L), add(B, L)], c, 0.3)
    + f([add(B, L), add(B, L, R), add(B, L, R, down), add(B, L, down)], c, 0)
    + f([add(B, R), add(B, R, L), add(B, R, L, down), add(B, R, down)], c, -0.28);
}

// A paper cube (equal sides), top centred on (x, y).
function cube(x: number, y: number, s: number, c: string): string {
  const a = s * 0.87;
  return f([[x, y - s * 0.5], [x + a, y], [x, y + s * 0.5], [x - a, y]], c, 0.3)
    + f([[x - a, y], [x, y + s * 0.5], [x, y + s * 1.5], [x - a, y + s]], c, 0)
    + f([[x, y + s * 0.5], [x + a, y], [x + a, y + s], [x, y + s * 1.5]], c, -0.28);
}

// A folded pine: three tiers, each split down the middle.
function pine(x: number, y: number, h: number, c = '#2f6b3a'): string {
  let out = f([[x - h * 0.05, y], [x + h * 0.05, y], [x + h * 0.05, y - h * 0.15], [x - h * 0.05, y - h * 0.15]], '#6b4527', -0.1);
  for (let i = 0; i < 3; i++) {
    const top = y - h * (0.45 + i * 0.27);
    const bot = y - h * (0.12 + i * 0.25);
    const w = h * (0.34 - i * 0.07);
    out += f([[x, top], [x, bot + h * 0.04], [x - w, bot]], c, 0.15) + f([[x, top], [x + w, bot], [x, bot + h * 0.04]], c, -0.2);
  }
  return out;
}

// A cut gem: a hexagonal prism's point.
function crystal(x: number, y: number, h: number, w: number, c: string, rot = 0): string {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">${f([[-w, 0], [-w, -h * 0.7], [0, -h], [0, 0]], c, 0.25)}${f([[0, 0], [0, -h], [w, -h * 0.7], [w, 0]], c, -0.2)}${f([[-w * 0.35, -h * 0.72], [0, -h], [w * 0.1, -h * 0.65]], c, 0.55)}</g>`;
}

// An egg folded from eight facets.
function egg(x: number, y: number, s: number, c: string): string {
  const p = poly(0, 0, 6, 10, -Math.PI / 2, 8).map(([a, b]) => [a, b < 0 ? b * 1.1 : b * 0.95] as Pt);
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const t = Math.cos(Math.atan2(p[i][1] + q[1], p[i][0] + q[0]) + Math.PI * 0.75) * 0.3;
    out += f([[0, -1], p[i], q], c, t);
  }
  return at(x, y, s, out);
}

function sheep(x: number, y: number, s: number, flip = false): string {
  const wool = '#efe8d6';
  const face = '#3a3038';
  return at(x, y, s,
    f([[-6, 2], [-5, 8], [-4, 8], [-4, 3]], face) + f([[3, 2], [4, 8], [5, 8], [5, 3]], face)
    + f([[-8, -1], [-5, -6], [2, -7], [7, -3], [1, 0]], wool, 0.2)
    + f([[-8, -1], [1, 0], [7, -3], [8, 2], [2, 5], [-6, 4]], wool, -0.12)
    + f([[7, -4], [12, -6], [13, -2], [9, 1]], face, 0.15) + f([[9, 1], [13, -2], [11, 2]], face, -0.2)
    + f([[8, -5], [10, -9], [10, -5]], face, 0.1), flip);
}

function coin(x: number, y: number, r: number): string {
  return f(poly(x, y, r, 8, Math.PI / 8), '#e9b84a', 0.15) + f(poly(x, y, r * 0.55, 8, Math.PI / 8), '#e9b84a', -0.15);
}

function flame(x: number, y: number, h: number, c = '#ff7a2f'): string {
  return f([[x - h * 0.3, y], [x - h * 0.05, y - h], [x, y]], c, 0.25) + f([[x, y], [x - h * 0.05, y - h], [x + h * 0.3, y]], c, -0.1)
    + f([[x - h * 0.13, y], [x + h * 0.02, y - h * 0.5], [x + h * 0.13, y]], '#ffd23f', 0.1);
}

function star(x: number, y: number, s: number, c = '#fff1c4'): string {
  return f([[x, y - s], [x + s * 0.25, y - s * 0.25], [x + s, y], [x + s * 0.25, y + s * 0.25], [x, y + s], [x - s * 0.25, y + s * 0.25], [x - s, y], [x - s * 0.25, y - s * 0.25]], c, 0.1);
}

// A flask of potion, for the action cards.
function flask(x: number, y: number, liquid: string, mark: string): string {
  const glass = '#d9eef2';
  const body = poly(0, 6, 13, 8, Math.PI / 8);
  return at(x, y, 1,
    f([[-4, -14], [4, -14], [4, -6], [-4, -6]], glass, 0.2)
    + f([[-5, -19], [5, -19], [4, -14], [-4, -14]], '#a0673a', 0)
    + f(body, glass, 0.25)
    // the potion: the lower part of the bottle, its lit and shaded halves
    + f([[-12, 3], [0, 3], [0, 18], body[2], body[3]], liquid, 0.08)
    + f([[0, 3], [12, 3], body[0], body[1], [0, 18]], liquid, -0.18)
    + f([[-8, -2], [-4, -6], [-6, 4]], '#ffffff', 0.4)
    + mark);
}

// ---------- the folded dragon ----------

// Whelps are stubby with a big head, drakes lean, wyrms big with horns and a spined back.
interface Build { neck: number; wing: number; tail: number; head: number; horns: boolean; body: number; scale: number }

const BUILDS: Record<string, Build> = {
  whelp: { neck: 4, wing: 10, tail: 8, head: 1.4, horns: false, body: 1.1, scale: 1.2 },
  drake: { neck: 11, wing: 22, tail: 17, head: 1, horns: false, body: 0.85, scale: 1.12 },
  wyrm: { neck: 14, wing: 27, tail: 22, head: 1.15, horns: true, body: 1.2, scale: 1.25 },
};

export function dragonFigure(c: string, b: Build): string {
  const n = b.neck;
  const w = b.wing;
  const t = b.tail;
  const hx = 12 + n * 0.55;
  const hy = -4 - n;
  const h = b.head;
  const belly = tone(c, 0.45);
  const parts = [
    // far wing (in shadow), behind the body
    f([[0, -6], [-3, -6 - w], [-15, -7 - w * 0.55], [-7, -4]], c, -0.35),
    // tail: two tapering folds and a barbed tip
    f([[-12, 0], [-9, 5], [-13 - t * 0.55, 5], [-12 - t, -1]], c, -0.1),
    f([[-12 - t, -1], [-13 - t * 0.55, 5], [-16 - t * 1.05, 3]], c, 0.15),
    f([[-16 - t * 1.05, 3], [-19 - t * 1.1, -3], [-12 - t, -1]], c, -0.2),
    // legs
    f([[-7, 5], [-3, 6], [-6, 12], [-9, 12]], c, -0.3),
    f([[5, 5], [9, 4], [9, 12], [6, 12]], c, -0.3),
    // a wyrm's spined back
    b.horns ? [[-12, -1], [-7, -4], [-2, -6], [3, -6.5]].map(([x, y]) => f([[x - 2, y + 1], [x, y - 4], [x + 2.5, y + 0.5]], tone(c, -0.3), 0)).join('') : '',
    // body: lit back, shaded belly
    f([[-14, 0], [-4, -7 * b.body], [10, -6], [3, 1]], c, 0.2),
    f([[-14, 0], [3, 1], [10, -6], [14, 1], [3, 8 * b.body], [-9, 6]], c, -0.08),
    f([[-6, 6], [3, 1], [12, 0], [3, 8 * b.body]], belly, -0.05),
    // neck
    f([[7, -6], [hx - 3, hy + 1], [hx + 1, hy + 4], [14, 1]], c, 0.05),
    f([[10, -2], [hx - 1, hy + 3], [hx + 1, hy + 4], [14, 1]], belly, -0.1),
    // head: a wedge, upper face lit
    at(hx, hy, h,
      (b.horns ? f([[-3, -2], [-9, -8], [-1, -3]], tone(c, -0.4), 0) + f([[0, -3], [-4, -10], [2, -3]], tone(c, -0.25), 0) : '')
      + f([[-4, -3], [3, -4], [11, 1], [0, 1]], c, 0.25)
      + f([[-4, -3], [0, 1], [11, 1], [9, 3], [-2, 4]], c, -0.15)
      + f([[1, -2.6], [3.4, -2.2], [2, -0.8]], '#1d1530', 0)),
    // near wing: two folds, the leading edge catching the light
    f([[2, -6], [5, -6 - w * 1.1], [-3, -3 - w * 0.75]], c, 0.4),
    f([[2, -6], [-3, -3 - w * 0.75], [-12, -5 - w * 0.4], [-5, -2]], c, 0.1),
  ];
  return parts.join('');
}

// ---------- backdrops by card kind ----------

const ELEMENT_SCENE: Record<string, () => string> = {
  fire: () => sky('#5b2230', { x: 92, y: 22, r: 12, c: '#ff9a3c' })
    + lift(ridges([[18, 26, 16], [52, 18, 14], [104, 22, 16]], '#7a2e2a', 66))
    + lift(f([[0, 70], [120, 66], [120, 84], [0, 84]], '#3a1a22', 0)) + flame(14, 72, 16) + flame(104, 70, 20) + flame(30, 76, 10, '#ff5a36'),
  ice: () => sky('#cfe6f2', { x: 24, y: 18, r: 9, c: '#ffffff' })
    + lift(crystal(10, 70, 34, 6, '#9fd3ef', -8) + crystal(104, 68, 40, 7, '#9fd3ef', 6) + crystal(116, 72, 22, 5, '#bfe3f5', 14))
    + lift(strip([66, 64, 67, 63, 66, 65, 67], '#eef7fb', 0)),
  lightning: () => sky('#252a48')
    + lift(f([[0, 10], [18, 4], [40, 9], [66, 2], [90, 8], [120, 3], [120, 22], [96, 26], [70, 20], [44, 27], [20, 21], [0, 25]], '#4a4f72', 0))
    + lift(f([[20, 22], [30, 22], [24, 34], [33, 34], [14, 58], [20, 40], [12, 40]], '#ffd23f', 0.1), true)
    + lift(strip([68, 66, 69, 65, 68, 67, 69], '#3a3f60', 0)),
  air: () => sky('#f1d9d2', { x: 98, y: 18, r: 8, c: '#fff4c9' })
    + lift(f([[4, 30], [14, 22], [28, 24], [36, 18], [50, 24], [44, 32]], '#ffffff', 0) + f([[2, 60], [12, 52], [28, 54], [36, 48], [48, 56], [40, 62]], '#ffffff', -0.05))
    + lift(f([[0, 74], [30, 70], [60, 74], [90, 70], [120, 73], [120, 84], [0, 84]], '#eef6fa', 0)),
  water: () => sky('#123e66', { x: 22, y: 16, r: 7, c: '#d9eef2' })
    + lift(strip([62, 58, 63, 57, 62, 58, 63, 57, 62], '#1f62a0', 0))
    + lift(strip([70, 66, 71, 65, 70, 66, 71, 65, 70], '#2f8fff', -0.05))
    + lift(strip([78, 75, 79, 74, 78, 75, 79], '#5fb0ff', 0.1)),
};

function dragonArt(key: string, element: string): string {
  const build = key.endsWith('wyrm') ? 'wyrm' : key.endsWith('drake') ? 'drake' : 'whelp';
  const b = BUILDS[build];
  const c = ELEMENT_COLORS[element] ?? '#ff5a36';
  // Ice and air dragons are pale; give them a little more colour so they stand off their sky.
  const body = element === 'air' ? '#7fb2c2' : element === 'ice' ? '#6fc2ea' : element === 'lightning' ? '#f2c230' : c;
  const x = build === 'wyrm' ? 62 : 58;
  const y = build === 'wyrm' ? 62 : 60;
  return (ELEMENT_SCENE[element] ?? ELEMENT_SCENE.fire)() + shadowUnder(x, 75, 18 * b.scale) + lift(at(x, y, b.scale, dragonFigure(body, b)), true);
}

// Upgrades: a gold fan of folds behind the object, on a paper plinth.
function upgradeScene(subject: string): string {
  const fan = Array.from({ length: 12 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 12;
    const b = (Math.PI * 2 * (i + 1)) / 12;
    return f([[60, 46], [60 + 80 * Math.cos(a), 46 + 80 * Math.sin(a)], [60 + 80 * Math.cos(b), 46 + 80 * Math.sin(b)]], '#efd9a0', i % 2 ? -0.08 : 0.15);
  }).join('');
  return `<rect width="120" height="84" fill="#efd9a0"/>${fan}`
    + lift(f([[30, 70], [90, 70], [96, 78], [24, 78]], '#b98d4a', 0.1) + f([[24, 78], [96, 78], [96, 84], [24, 84]], '#b98d4a', -0.2))
    + lift(subject, true);
}

// Actions: a night of violet paper with cut stars, the object floating.
function actionScene(subject: string, glow = '#b07cff'): string {
  return `<rect width="120" height="84" fill="#33285a"/>`
    + star(14, 14, 3) + star(104, 12, 4) + star(96, 34, 2) + star(22, 44, 2) + star(110, 62, 2.5) + star(40, 10, 1.6)
    + lift(f(poly(60, 44, 30, 10, 0), glow, -0.45) + f(poly(60, 44, 21, 10, Math.PI / 10), glow, -0.3))
    + shadowUnder(60, 78, 16)
    + lift(subject, true);
}

// ---------- buildings ----------

const BUILDINGS: Record<string, () => string> = {
  quarry: () => sky('#a9c8de', { x: 98, y: 16, r: 7, c: '#fff1c4' })
    + lift(ridges([[24, 44, 26], [62, 36, 22], [100, 40, 24]], '#8d8f96'))
    + lift(f([[50, 22], [62, 28], [56, 30]], '#f6f3ee') + f([[17, 22], [24, 20], [28, 26]], '#f6f3ee'))
    + groundLayers('mountain')
    + shadowUnder(60, 76, 30)
    + lift(cube(46, 58, 9, '#c4c6cc') + cube(62, 58, 9, '#b3b6bd') + cube(78, 58, 9, '#c4c6cc') + cube(54, 49, 9, '#d3d5da') + cube(70, 49, 9, '#bcbfc5'), true)
    + lift(f([[90, 72], [104, 52], [106, 53], [93, 73]], '#a0673a', 0) + f([[98, 52], [112, 56], [110, 59], [96, 55]], '#9aa0a6', -0.1)),
  lumber_camp: () => sky('#b9d7c4')
    + lift(pine(10, 58, 30) + pine(28, 56, 36) + pine(104, 58, 34) + pine(118, 60, 26))
    + groundLayers('forest')
    + shadowUnder(64, 76, 30)
    + lift(
      f([[38, 74], [52, 52], [66, 74]], '#e9d9b6', 0.15) + f([[52, 52], [66, 74], [58, 74]], '#e9d9b6', -0.2) + f([[49, 74], [52, 64], [55, 74]], '#3a2a20', 0)
      + [[74, 70], [84, 70], [94, 70], [79, 62], [89, 62]].map(([x, y]) => f([[x - 8, y - 3], [x, y - 3], [x, y + 3], [x - 8, y + 3]], '#a0673a', -0.05) + f(poly(x, y, 4, 6), '#d9a066', 0.15) + f(poly(x, y, 1.6, 6), '#a0673a', 0)).join(''),
      true)
    + lift(pine(22, 80, 22) + pine(110, 82, 24)),
  crystal_mine: () => sky('#4a3a7a', { x: 100, y: 14, r: 6, c: '#e8e0ff' })
    + star(20, 14, 2) + star(74, 10, 1.5)
    + lift(ridges([[30, 34, 26], [86, 30, 24]], '#6f6a86'))
    + groundLayers('ley')
    + lift(f([[36, 72], [44, 48], [60, 40], [76, 48], [84, 72]], '#7d7891', 0.1) + f([[60, 40], [76, 48], [84, 72], [60, 72]], '#7d7891', -0.2) + f([[50, 72], [52, 58], [60, 54], [68, 58], [70, 72]], '#241a33', 0))
    + lift(crystal(54, 72, 16, 4, '#c4a2ff', -18) + crystal(62, 72, 22, 5, '#b07cff', 4) + crystal(70, 72, 14, 4, '#d6bfff', 24) + crystal(94, 76, 18, 5, '#b07cff', 10) + crystal(26, 78, 12, 4, '#c4a2ff', -14), true),
  pasture: () => sky('#bfe3f0', { x: 98, y: 16, r: 8, c: '#fff1c4' })
    + lift(strip([46, 40, 44, 38, 44, 41, 46], '#7fae45', 0.1))
    + groundLayers('meadow')
    + lift([12, 34, 56, 78, 100].map((x) => f([[x, 52], [x + 3, 52], [x + 3, 70], [x, 70]], '#c99b6a', -0.05)).join('') + f([[10, 56], [110, 56], [110, 59], [10, 59]], '#d9b07c', 0.1) + f([[10, 63], [110, 63], [110, 66], [10, 66]], '#d9b07c', 0))
    + shadowUnder(44, 78, 12) + shadowUnder(80, 80, 12)
    + lift(sheep(42, 70, 1.3) + sheep(82, 72, 1.35, true), true),
  roost: () => sky('#f2c79a', { x: 30, y: 20, r: 10, c: '#fff1c4' })
    + lift(ridges([[90, 30, 22], [118, 22, 16]], '#c08a63'))
    + groundLayers('plains')
    + lift(f([[50, 76], [54, 34], [62, 28], [66, 76]], '#a58a6a', 0.1) + f([[62, 28], [72, 36], [74, 76], [66, 76]], '#a58a6a', -0.22), true)
    + lift(f([[44, 30], [52, 36], [76, 36], [84, 30], [76, 26], [52, 26]], '#8a5a32', -0.05) + f([[44, 30], [52, 26], [76, 26], [84, 30], [64, 32]], '#a8743e', 0.15)
      + egg(58, 24, 0.9, '#ff7a59') + egg(70, 23, 0.8, '#8fd8ff'), true),
  hatchery: () => `<rect width="120" height="84" fill="#5a3b2e"/>`
    + lift(f(poly(60, 46, 34, 12), '#ffb347', -0.25) + f(poly(60, 46, 24, 12, 0.26), '#ffb347', 0))
    + lift(f([[0, 66], [120, 66], [120, 84], [0, 84]], '#7a5038', 0))
    + lift(f([[26, 68], [34, 58], [86, 58], [94, 68], [82, 74], [38, 74]], '#d9a94a', 0) + [30, 40, 50, 60, 70, 80].map((x) => f([[x, 60], [x + 6, 57], [x + 10, 61]], '#e9c06a', 0.15)).join(''))
    + lift(egg(46, 50, 1.1, '#ff5a36') + egg(74, 50, 1.1, '#2f8fff') + egg(60, 46, 1.25, '#ffd23f'), true),
  market: () => sky('#bfe0f0', { x: 18, y: 16, r: 7, c: '#fff1c4' })
    + lift(f([[86, 64], [86, 40], [100, 30], [114, 40], [114, 64]], '#d6c3a0', 0) + f([[96, 64], [96, 52], [104, 52], [104, 64]], '#6b4527', 0))
    + groundLayers('plains')
    + shadowUnder(56, 78, 34)
    + lift(
      f([[28, 40], [32, 40], [32, 74], [28, 74]], '#8a5a32', 0) + f([[80, 40], [84, 40], [84, 74], [80, 74]], '#8a5a32', -0.1)
      + Array.from({ length: 7 }, (_, i) => f([[24 + i * 9.4, 42], [29 + i * 9.4, 30], [33.4 + i * 9.4, 42]], i % 2 ? '#f3ead7' : '#d64545', 0.1)
        + f([[24 + i * 9.4, 42], [28.7 + i * 9.4, 48], [33.4 + i * 9.4, 42]], i % 2 ? '#f3ead7' : '#d64545', -0.2)).join('')
      + box(56, 58, 22, 10, 12, '#b98d4a')
      + cube(46, 54, 4, '#9aa0a6') + crystal(56, 58, 8, 2.4, '#b07cff') + coin(65, 54, 3.2), true),
  caravan_post: () => sky('#f3d6a4', { x: 96, y: 18, r: 9, c: '#fff1c4' })
    + lift(ridges([[20, 20, 22], [50, 14, 18]], '#d0a874'))
    + groundLayers('plains')
    + lift(f([[100, 34], [102, 34], [102, 74], [100, 74]], '#8a5a32', 0) + f([[102, 34], [116, 39], [102, 44]], '#3e7bfa', 0.1) + f([[102, 44], [116, 39], [114, 44]], '#3e7bfa', -0.2))
    + shadowUnder(54, 78, 30)
    + lift(
      f([[28, 56], [80, 56], [80, 68], [28, 68]], '#a0673a', 0) + f([[80, 56], [86, 53], [86, 64], [80, 68]], '#a0673a', -0.25)
      + f([[30, 56], [32, 42], [42, 34], [54, 32]], '#f3ead7', 0.2) + f([[30, 56], [54, 32], [66, 34], [78, 56]], '#f3ead7', 0.05) + f([[66, 34], [76, 42], [78, 56]], '#f3ead7', -0.18)
      + f(poly(38, 70, 7, 8), '#6b4527', -0.05) + f(poly(38, 70, 2, 8), '#d9a066', 0) + f(poly(72, 70, 7, 8), '#6b4527', -0.05) + f(poly(72, 70, 2, 8), '#d9a066', 0), true),
  tower_floor: () => sky('#b7c6e6', { x: 22, y: 16, r: 7, c: '#fff1c4' })
    + groundLayers('plains', [64, 62, 65, 61, 64, 63, 65])
    + shadowUnder(60, 78, 22)
    + lift(
      f([[44, 76], [44, 54], [60, 58], [60, 80]], '#c7c1d6', 0.1) + f([[60, 58], [76, 54], [76, 76], [60, 80]], '#c7c1d6', -0.22)
      + f([[56, 78], [56, 68], [60, 69], [60, 79]], '#3a2a40', 0)
      + f([[50, 66], [50, 62], [53, 62.7], [53, 66.7]], '#ffd23f', 0), true)
    // the new floor, settling into place
    + lift(
      f([[44, 50], [44, 34], [60, 38], [60, 54]], '#b07cff', 0.2) + f([[60, 38], [76, 34], [76, 50], [60, 54]], '#b07cff', -0.15)
      + f([[44, 34], [60, 30], [76, 34], [60, 38]], '#b07cff', 0.45)
      + [44, 52, 60, 68].map((x, i) => f([[x, 34 + (i < 2 ? 0 : 0)], [x + 4, 33], [x + 4, 28], [x, 29]], '#b07cff', i < 2 ? 0.3 : -0.05)).join(''), true)
    + f([[30, 40], [38, 40], [38, 41], [30, 41]], '#ffffff') + f([[84, 44], [92, 44], [92, 45], [84, 45]], '#ffffff') + f([[28, 48], [34, 48], [34, 49], [28, 49]], '#ffffff'),
  monument: () => sky('#c9b6d6', { x: 92, y: 20, r: 10, c: '#ffe2a8' })
    + lift(ridges([[14, 18, 18], [106, 22, 20]], '#c08a63'))
    + groundLayers('plains')
    + shadowUnder(60, 78, 26)
    + lift(
      f([[40, 78], [44, 70], [76, 70], [80, 78]], '#d6cbb5', 0) + f([[46, 70], [50, 64], [70, 64], [74, 70]], '#e3d9c4', 0.1)
      + f([[52, 64], [55, 20], [60, 20], [60, 64]], '#e8dfcc', 0.2) + f([[60, 20], [65, 20], [68, 64], [60, 64]], '#e8dfcc', -0.2)
      + f([[55, 20], [60, 10], [60, 20]], '#f5c542', 0.3) + f([[60, 10], [65, 20], [60, 20]], '#f5c542', -0.1), true),
};

// ---------- upgrades ----------

const UPGRADES: Record<string, () => string> = {
  workshop: () => upgradeScene(
    f([[40, 62], [80, 62], [74, 70], [46, 70]], '#5c6370', 0.15) + f([[46, 70], [74, 70], [70, 76], [50, 76]], '#5c6370', -0.2) + f([[30, 58], [40, 62], [46, 66], [36, 64]], '#5c6370', 0)
    + `<g transform="rotate(-35 64 44)">${f([[62, 30], [66, 30], [66, 64], [62, 64]], '#a0673a', 0.05)}${f([[52, 24], [76, 24], [76, 32], [52, 32]], '#9aa0a6', 0.25)}${f([[52, 32], [76, 32], [76, 36], [52, 36]], '#9aa0a6', -0.25)}</g>`
    + star(84, 46, 4, '#fff1c4') + star(90, 56, 2.5, '#fff1c4')),
  gilding: () => upgradeScene(
    f([[36, 66], [36, 40], [46, 52], [52, 32], [60, 46]], '#f5c542', 0.25) + f([[60, 46], [68, 32], [74, 52], [84, 40], [84, 66]], '#f5c542', -0.05)
    + f([[36, 66], [84, 66], [84, 72], [36, 72]], '#d9a13a', -0.15)
    + f(poly(60, 58, 4, 4), '#d64545', 0.1) + f(poly(46, 60, 3, 4), '#2f8fff', 0.1) + f(poly(74, 60, 3, 4), '#30a46c', 0.1)
    + star(52, 32, 3, '#fffbe6') + star(84, 40, 2.4, '#fffbe6')),
  nesting_grounds: () => upgradeScene(
    f([[30, 58], [40, 72], [80, 72], [90, 58], [60, 64]], '#8a5a32', -0.05) + f([[30, 58], [60, 64], [90, 58], [76, 54], [44, 54]], '#a8743e', 0.15)
    + egg(60, 50, 1.2, '#ff7a59')
    + f([[24, 56], [34, 48], [38, 54]], '#f3ead7', 0.2) + f([[96, 56], [86, 46], [82, 54]], '#f3ead7', -0.05) + f([[86, 62], [100, 64], [90, 58]], '#d9c7a3', 0)),
  trade_charter: () => upgradeScene(
    f([[34, 36], [86, 36], [86, 66], [34, 66]], '#f3ead7', 0.1) + f([[34, 66], [86, 66], [84, 70], [36, 70]], '#f3ead7', -0.2)
    + f([[30, 32], [38, 32], [38, 40], [30, 40]], '#d9c7a3', 0) + f([[82, 62], [90, 62], [90, 70], [82, 70]], '#d9c7a3', -0.15)
    + [44, 50, 56].map((y) => f([[42, y], [78, y], [78, y + 1.6], [42, y + 1.6]], '#8a7a66', 0)).join('')
    + f(poly(72, 62, 7, 8), '#c0392b', 0.1) + f(poly(72, 62, 4, 8), '#c0392b', -0.15) + coin(46, 62, 5)),
};

// ---------- actions ----------

const ACTIONS: Record<string, () => string> = {
  windfall: () => actionScene(
    `<path d="M20 58 L40 50 L56 54 L72 44 L88 46 L100 34" fill="none" stroke="#f3ead7" stroke-width="2.2" stroke-linejoin="round" opacity=".85"/>`
    + `<path d="M24 70 L44 64 L62 68 L80 60 L96 62" fill="none" stroke="#f3ead7" stroke-width="1.6" stroke-linejoin="round" opacity=".6"/>`
    + f([[36, 36], [44, 32], [50, 38], [46, 46], [38, 44]], '#9aa0a6', 0.1) + f([[44, 32], [50, 38], [46, 46]], '#9aa0a6', -0.2)
    + `<g transform="rotate(-25 66 58)">${f([[56, 54], [74, 54], [74, 62], [56, 62]], '#a0673a', 0)}${f(poly(74, 58, 4.2, 6), '#d9a066', 0.1)}</g>`
    + crystal(84, 40, 18, 5, '#b07cff', 20), '#5fd0a0'),
  treasure: () => actionScene(
    coin(36, 72, 5) + coin(84, 70, 4.5) + coin(90, 76, 4)
    + f([[38, 52], [82, 52], [82, 74], [38, 74]], '#8a5a32', 0) + f([[82, 52], [90, 48], [90, 70], [82, 74]], '#8a5a32', -0.3)
    + f([[38, 52], [44, 38], [88, 34], [90, 48], [82, 52]], '#a8743e', 0.2)
    + f([[38, 60], [82, 60], [82, 63], [38, 63]], '#e9b84a', 0) + f([[57, 58], [63, 58], [63, 66], [57, 66]], '#e9b84a', 0.15)
    + coin(52, 50, 5) + coin(64, 46, 5.5) + coin(76, 48, 4.5), '#ffd23f'),
  growth_elixir: () => actionScene(flask(60, 46, '#4cc26e',
    f([[0, -19], [0, -26], [-6, -30], [-1, -23]], '#4cc26e', 0.2) + f([[0, -24], [7, -30], [1, -21]], '#4cc26e', -0.1)), '#4cc26e'),
  healing_potion: () => actionScene(flask(60, 46, '#e5484d',
    f([[0, 12], [-6, 6], [-6, 2], [-3, 0], [0, 3]], '#fff1f1', 0.1) + f([[0, 12], [0, 3], [3, 0], [6, 2], [6, 6]], '#fff1f1', -0.1)), '#ff7a8a'),
  war_horn: () => actionScene(
    f([[30, 62], [36, 56], [50, 46], [54, 52], [40, 64]], '#efe4cc', 0.2) + f([[50, 46], [66, 40], [68, 46], [54, 52]], '#efe4cc', 0.05)
    + f([[66, 40], [80, 36], [84, 22], [94, 34], [88, 48], [68, 46]], '#efe4cc', -0.05) + f([[84, 22], [96, 26], [94, 34]], '#efe4cc', -0.3)
    + f([[48, 45], [52, 43], [57, 51], [53, 53]], '#e9b84a', 0) + f([[64, 39], [68, 38], [70, 47], [66, 47]], '#e9b84a', -0.05)
    + f([[26, 66], [30, 62], [36, 66], [32, 70]], '#e9b84a', 0)
    + `<path d="M98 20 L106 14 M100 30 L110 30 M98 40 L106 46" stroke="#fff1c4" stroke-width="2" stroke-linecap="square"/>`, '#ff7a59'),
  secret_hoard: () => actionScene(
    f([[40, 74], [36, 58], [46, 42], [60, 40], [56, 56], [52, 74]], '#b58a5a', 0.1) + f([[52, 74], [56, 56], [60, 40], [74, 42], [84, 58], [80, 74]], '#b58a5a', -0.15)
    + f([[48, 40], [56, 34], [64, 36], [72, 34], [72, 42], [48, 42]], '#9c7448', 0.05)
    + f([[48, 42], [72, 42], [72, 45], [48, 45]], '#e9b84a', 0)
    + coin(60, 34, 4.5) + f(poly(60, 60, 4, 6, 0), '#3a2a20', 0) + f([[58, 62], [62, 62], [61, 68], [59, 68]], '#3a2a20', 0), '#b07cff'),
};

// ---------- entry points ----------

// The picture for one card. `element` is a dragon's element.
// Until a building has its own picture it borrows its class's.
const CLASS_ART: Record<string, string> = { quarry: 'quarry', lumber: 'lumber_camp', mine: 'crystal_mine', pasture: 'pasture', dragon: 'roost', monument: 'monument', trade: 'market' };

export function cardArt(kind: string, key: string, element?: string, cls?: string): string {
  const draw = kind === 'building' ? BUILDINGS[key] ?? BUILDINGS[CLASS_ART[cls ?? ''] ?? ''] : kind === 'upgrade' ? UPGRADES[key] : kind === 'action' ? ACTIONS[key] : null;
  const body = kind === 'dragon' ? dragonArt(key, element ?? 'fire') : draw ? draw() : actionScene(star(60, 44, 10));
  return `<svg class="art" viewBox="0 0 120 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
}

// The coloured paper of a card's frame: one colour per kind, dragons by element.
export function frameColor(kind: string, element?: string): string {
  if (kind === 'dragon') return ELEMENT_COLORS[element ?? 'fire'] ?? '#ff5a36';
  return { building: '#c0703f', upgrade: '#d9a13a', action: '#7a5cc8' }[kind] ?? '#888';
}

// Small kind marks for the card's corner (icons, not words). The corner disc and
// the name ribbon share one colour per kind (frameColor): rust buildings, gold
// upgrades, purple actions, and a dragon in its element's colour.
export const KIND_ICON: Record<string, string> = {
  // A building card goes on a hex of the map: its mark is the hex, not a house (a house reads as one building, like the Market).
  building: '<path d="M0 -9 L7.8 -4.5 V4.5 L0 9 L-7.8 4.5 V-4.5 Z"/><path d="M0 -4.5 L3.9 -2.25 V2.25 L0 4.5 L-3.9 2.25 V-2.25 Z" fill="#0003"/>',
  upgrade: '<path d="M0 -9 L2.6 -3 L9 -2.8 L4 1.6 L5.6 8 L0 4.4 L-5.6 8 L-4 1.6 L-9 -2.8 L-2.6 -3 Z"/>',
  action: '<path d="M0 -9 L2 -2 L9 0 L2 2 L0 9 L-2 2 L-9 0 L-2 -2 Z"/>',
  dragon: '<ellipse cx="0" cy="1" rx="6" ry="8"/><path d="M-5 0 L-2 -2 L0 1 L2 -2 L5 0" fill="none" stroke="#0005" stroke-width="1.4"/>',
};

export function kindIcon(kind: string, size = 14, color = '#fff'): string {
  return `<svg class="kicon" width="${size}" height="${size}" viewBox="-10 -10 20 20" fill="${color}">${KIND_ICON[kind] ?? ''}</svg>`;
}

// ---------- small folded glyphs for card stats ----------

const GLYPH: Record<string, string> = {
  health: f([[0, 8], [-8, 0], [-8, -4], [-4, -7], [0, -3]], '#e5484d', 0.15) + f([[0, 8], [0, -3], [4, -7], [8, -4], [8, 0]], '#e5484d', -0.15),
  attack: [-5, 0, 5].map((x) => f([[x - 3, 8], [x + 2.5, -8], [x + 3.5, -7], [x - 1, 8]], '#d9dde6', x < 0 ? 0.2 : -0.05)).join(''),
  growth: f([[-6, -8], [6, -8], [0, 0]], '#e9b84a', 0.15) + f([[0, 0], [-6, 8], [6, 8]], '#e9b84a', -0.15) + f([[-7, -9], [7, -9], [7, -7.5], [-7, -7.5]], '#a0673a') + f([[-7, 7.5], [7, 7.5], [7, 9], [-7, 9]], '#a0673a'),
};

export function glyph(name: string, label: string, size = 1.1): string {
  return `<svg class="glyph" style="width:${size}em;height:${size}em" viewBox="-10 -10 20 20" role="img" aria-label="${label}"><title>${label}</title>${GLYPH[name] ?? ''}</svg>`;
}

// A dragon at one life stage, for the stat rows: the card's dragon, smaller when younger.
export function stageFigure(key: string, element: string, stage: number): string {
  const build = key.endsWith('wyrm') ? 'wyrm' : key.endsWith('drake') ? 'drake' : 'whelp';
  const c = element === 'air' ? '#7fb2c2' : element === 'ice' ? '#6fc2ea' : element === 'lightning' ? '#f2c230' : ELEMENT_COLORS[element] ?? '#ff5a36';
  const s = [0.5, 0.72, 0.95][stage];
  return `<svg class="stagefig" viewBox="-40 -42 80 56" aria-hidden="true">${at(0, 6, s, dragonFigure(c, BUILDS[build]))}</svg>`;
}

// ---------- the table: lobby and game-over scenes ----------

// A wizard's tower: folded grey walls, a roof and pennant in its owner's colour.
// Drawn standing on (0, 0), about 60 tall.
function wizardTower(c: string): string {
  const wall = '#c7c1d6';
  return f([[-9, 0], [-9, -30], [0, -28], [0, 3]], wall, 0.12) + f([[0, -28], [9, -30], [9, 0], [0, 3]], wall, -0.22)
    + f([[-3, 1.8], [-3, -7], [0, -6.4], [0, 2.6]], '#3a2a40', 0)
    + f([[3, -18], [3, -23], [6, -23.6], [6, -18.6]], '#ffd23f', 0)
    + f([[-12, -29], [0, -54], [0, -27]], c, 0.22) + f([[0, -54], [12, -29], [0, -27]], c, -0.2)
    + f([[-0.6, -54], [0.6, -54], [0.6, -63], [-0.6, -63]], '#6b4527', 0)
    + f([[0.6, -63], [10, -60], [0.6, -57]], c, 0.1);
}

// The night sky over the table, a far range and the ground the towers stand on.
function tableBackdrop(w: number, h: number, moonX = 0.86): string {
  const sky = `<rect width="${w}" height="${h}" fill="#2b2452"/>`;
  const stars = Array.from({ length: Math.round(w / 22) }, (_, i) => star((i * 97) % w, 8 + ((i * 37) % (h * 0.4)), 1.6 + (i % 3) * 0.7, '#fff1c4')).join('');
  const moon = lift(f(poly(moonX * w, h * 0.2, h * 0.09, 8), '#fff1c4', 0.1));
  const peaks: [number, number, number][] = Array.from({ length: Math.ceil(w / 50) + 1 }, (_, i) => [i * 50 + (i % 2) * 14, 30 + ((i * 13) % 22), 30]);
  const hills = (ys: number[], c: string, t: number) => {
    const step = w / (ys.length - 1);
    return f([...ys.map((y, i) => [i * step, y] as Pt), [w, h], [0, h]], c, t);
  };
  return sky + stars + moon
    + lift(ridges(peaks, '#4a3f7a', h * 0.72))
    + lift(hills([h * 0.74, h * 0.7, h * 0.75, h * 0.69, h * 0.74, h * 0.7, h * 0.75], '#5d7a4a', 0))
    + lift(hills([h * 0.88, h * 0.85, h * 0.9, h * 0.84, h * 0.89, h * 0.86, h * 0.9], '#4f6b3e', -0.1));
}

// The title picture: one tower per seat in its player's colour, each with a dragon
// flying over it. With nobody seated yet, three towers in plain paper wait.
// `w` x `h` is the picture's shape; the towers stand between `from` and `to` across it.
export function tableScene(colors: string[], w = 360, h = 140, from = 0, to = 1): string {
  const cs = colors.length ? colors : ['#8a8496', '#9a94a6', '#8a8496'];
  const span = (to - from) * w;
  const step = span / (cs.length + 1);
  const s = Math.min(1, (h / 140) * (cs.length > 4 ? 0.85 : 1));
  const towers = cs.map((c, i) => {
    const x = from * w + step * (i + 1);
    const y = h * 0.86 + (i % 2 ? 3 : 0) * s;
    const dragon = colors.length ? lift(at(x + (i % 2 ? -13 : 13) * s, y - (88 - (i % 3) * 5) * s, 0.6 * s, dragonFigure(c, BUILDS.drake), i % 2 === 1), true) : '';
    return shadowUnder(x, y + 1, 14 * s) + lift(at(x, y, s, wizardTower(c)), true) + dragon;
  }).join('');
  return `<svg class="scene" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${tableBackdrop(w, h, from > 0.2 ? from * 0.85 : 0.86)}${towers}</svg>`;
}

// The winner's moment: their tower at the top of the hill, their dragon over it,
// and paper stars falling in every player's colour.
export function winnerScene(color: string, colors: string[], w = 240, h = 120): string {
  const cx = w / 2;
  const base = h * 0.8;
  const s = h / 120;
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 16;
    const b = a + Math.PI / 16;
    const r = w + h;
    return f([[cx, base - 30 * s], [cx + r * Math.cos(a), base - 30 * s + r * Math.sin(a)], [cx + r * Math.cos(b), base - 30 * s + r * Math.sin(b)]], '#f5c542', i % 2 ? 0.25 : 0.05);
  }).join('');
  const confetti = Array.from({ length: Math.round(w / 10) }, (_, i) => {
    const c = colors[i % colors.length] ?? color;
    const x = (i * 53 + 11) % w;
    const y = 6 + ((i * 29) % (h * 0.6));
    return `<g transform="rotate(${(i * 47) % 90} ${x} ${y})">${star(x, y, (2.2 + (i % 3)) * s, c)}</g>`;
  }).join('');
  return `<svg class="scene" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <rect width="${w}" height="${h}" fill="#e9a23b"/>${rays}
    ${lift(f([[0, h], [0, base + 10 * s], [cx - 60 * s, base + 2 * s], [cx, base - 2 * s], [cx + 60 * s, base + 2 * s], [w, base + 10 * s], [w, h]], '#5d7a4a', 0))}
    ${lift(f([[0, h], [0, h - 6 * s], [cx - 20 * s, h - 9 * s], [w, h - 5 * s], [w, h]], '#4f6b3e', -0.1))}
    ${shadowUnder(cx, base, 20 * s)}${lift(at(cx, base, 1.1 * s, wizardTower(color)), true)}
    ${lift(at(cx + 50 * s, base - 70 * s, 0.85 * s, dragonFigure(color, BUILDS.wyrm), true), true)}
    ${lift(at(cx - 50 * s, base - 58 * s, 0.6 * s, dragonFigure(color, BUILDS.drake)), true)}
    ${lift(confetti)}
  </svg>`;
}

// A player's tower on its own, as a seat's token.
export function towerToken(color: string, size = 2.2): string {
  return `<svg class="token" style="height:${size}em;width:${size * 0.5}em" viewBox="-14 -66 28 70" aria-hidden="true">${wizardTower(color)}</svg>`;
}
