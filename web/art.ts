// Card art in the game's papercraft look: every picture is folded paper
// (origami subjects made of flat facets, one light side and one shadow side,
// with a crease between) standing on layers of cut paper (a sky sheet, a far
// layer and a ground layer, each lifted a little off the one behind, like a
// pop-up book). Edges are straight cuts, never curves, so the set reads as one
// folded deck. Everything is inline SVG on a 120 x 84 box: the phone downloads
// nothing extra. The card frame around the art lives in phone.ts and style.css.

import { ELEMENT_COLORS, TERRAIN_COLORS } from './common.ts';
import { iconShapes } from './icons.ts';

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

// A cut gem seen from the side: a crown of three facets over a pointed pavilion.
function gem(x: number, y: number, s: number, c = '#b07cff'): string {
  return at(x, y, s,
    f([[-8, -2], [-4, -7], [-2, -2]], c, 0.3) + f([[-4, -7], [4, -7], [2, -2], [-2, -2]], c, 0.55) + f([[4, -7], [8, -2], [2, -2]], c, -0.1)
    + f([[-8, -2], [-2, -2], [0, 9]], c, 0.05) + f([[-2, -2], [2, -2], [0, 9]], c, 0.2) + f([[2, -2], [8, -2], [0, 9]], c, -0.3));
}

// Logs end-on: bark running back, pale cut ends.
function logEnds(at: [number, number][], r = 4): string {
  return at.map(([x, y]) => f([[x - r * 2, y - r * 0.75], [x, y - r * 0.75], [x, y + r * 0.75], [x - r * 2, y + r * 0.75]], '#a0673a', -0.05) + f(poly(x, y, r, 6), '#d9a066', 0.15) + f(poly(x, y, r * 0.4, 6), '#a0673a', 0)).join('');
}

// The sea along the back, waves cut in it, and the beach in front.
function shore(sand = '#e8d29a'): string {
  return lift(strip([50, 48, 51, 47, 50, 48, 51], '#3d7fbf', -0.05))
    + [14, 46, 80, 104].map((x) => f([[x - 6, 54], [x, 51], [x + 6, 54], [x, 53]], '#cfe6f2', 0.2)).join('')
    + lift(strip([62, 60, 63, 59, 62, 61, 63], sand, 0.05)) + lift(strip([74, 76, 73, 77, 74, 75, 73], sand, -0.12));
}

// A fish hanging by its tail.
function fish(x: number, y: number, s = 1): string {
  return at(x, y, s, f([[0, 0], [-3, 7], [0, 14]], '#9fc3d8', 0.35) + f([[0, 0], [0, 14], [3, 7]], '#9fc3d8', -0.15) + f([[0, 13], [-3, 17], [3, 17]], '#5f8aa5', 0));
}

// The yellow straw the pasture class thatches with.
const STRAW = '#e9c46a';
// Batch 3's class colours (icons.ts and board3d.ts share them): the hatchery's
// clay, the trade buildings' red, the monuments' pale dressed stone.
const CLAY = '#c9774a';
const TRADE_RED = '#c8463d';
const MON = '#d6cfc0';

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
  // The clay brooding dome, its mouth aglow, and the nest of eggs it keeps warm.
  hatchery: () => sky('#f2c79a', { x: 98, y: 18, r: 9, c: '#fff1c4' })
    + lift(ridges([[16, 24, 20], [40, 16, 16]], '#c08a63'))
    + groundLayers('plains')
    + shadowUnder(44, 78, 28)
    + lift(f([[18, 76], [18, 52], [24, 38], [36, 30], [44, 29], [44, 76]], CLAY, 0.15) + f([[44, 29], [52, 30], [64, 38], [70, 52], [70, 76], [44, 76]], CLAY, -0.2)
      + f([[48, 30], [48, 18], [54, 18], [54, 32]], CLAY, -0.35)
      + f([[34, 76], [34, 60], [44, 54], [54, 60], [54, 76]], '#ff9a3c', 0.1) + f([[39, 76], [39, 64], [44, 61], [49, 64], [49, 76]], '#ffd23f', 0.2), true)
    + shadowUnder(90, 80, 20)
    + lift(egg(82, 66, 0.95, '#ff7a59') + egg(98, 66, 0.95, '#8fd8ff') + egg(90, 62, 1.1, '#ffd23f')
      + f([[70, 70], [78, 80], [102, 80], [110, 70], [90, 74]], '#8a5a32', -0.05) + f([[70, 70], [90, 74], [110, 70], [100, 67], [80, 67]], '#a8743e', 0.15), true),
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
  // ---- batch 3: the dragon, trade and monument cards ----
  // A red-roofed warehouse on the quay, crates of the goods, a boat at the pier.
  port: () => sky('#cfe6f2', { x: 22, y: 16, r: 8, c: '#fff8e0' })
    + lift(strip([50, 48, 51, 47, 50, 48, 51], '#3d7fbf', -0.05))
    + [60, 84, 106].map((x) => f([[x - 6, 56], [x, 53], [x + 6, 56], [x, 55]], '#cfe6f2', 0.2)).join('')
    + lift(f([[0, 62], [64, 58], [64, 84], [0, 84]], '#a0673a', 0) + f([[0, 62], [64, 58], [64, 61], [0, 65]], '#c48a4e', 0.2))
    + shadowUnder(30, 70, 26)
    + lift(f([[8, 66], [8, 40], [48, 40], [48, 66]], '#f3ece0', 0) + f([[24, 66], [24, 52], [34, 52], [34, 66]], '#3a2a20', 0)
      + f([[4, 42], [16, 24], [40, 24], [52, 42]], TRADE_RED, 0.15) + f([[2, 44], [4, 40], [52, 40], [54, 44]], TRADE_RED, -0.25), true)
    + lift(cube(50, 66, 5, '#c6cad0') + cube(58, 70, 5, '#b97a44') + cube(54, 61, 5, '#b88bff') + cube(42, 72, 5, '#f5c542'), true)
    + lift(f([[64, 64], [118, 60], [118, 64], [64, 68]], '#c48a4e', 0.1) + [72, 92, 112].map((x) => f([[x, 66], [x + 2, 66], [x + 2, 80], [x, 80]], '#7f4b23', 0)).join(''))
    + lift(f([[80, 56], [108, 56], [104, 62], [84, 62]], '#a0673a', -0.05) + f([[93, 56], [93, 20], [95, 20], [95, 56]], '#5e3c22', 0)
      + f([[95, 22], [95, 52], [112, 52]], '#f3ece0', 0.1) + f([[93, 24], [93, 52], [80, 52]], '#f3ece0', -0.15) + f([[95, 38], [95, 44], [105, 44], [102, 38]], TRADE_RED, 0), true),
  // A ring of standing stones on the ley line, a trilithon carrying a gold sun.
  standing_stones: () => sky('#3d3170', { x: 98, y: 14, r: 6, c: '#e8e0ff' })
    + star(20, 12, 2) + star(70, 8, 1.5) + star(46, 18, 1.2)
    + lift(ridges([[24, 20, 22], [104, 24, 22]], '#6f6a86'))
    + groundLayers('ley')
    + lift(`<path d="M0 74 Q60 60 120 72" stroke="#c7b6ff" stroke-width="2.4" fill="none" opacity=".8"/>`)
    + shadowUnder(60, 78, 36)
    + lift([[20, 46], [34, 40], [86, 40], [100, 46]].map(([x, top]) => f([[x - 5, 76], [x - 4.4, top], [x, top - 2], [x, 76]], MON, 0.2) + f([[x, 76], [x, top - 2], [x + 4.4, top], [x + 5, 76]], MON, -0.2)).join('')
      + f([[46, 76], [47, 34], [53, 34], [53, 76]], MON, 0.15) + f([[67, 76], [67, 34], [73, 34], [74, 76]], MON, -0.2)
      + f([[42, 34], [44, 26], [76, 26], [78, 34]], MON, 0.3) + f(poly(60, 40, 5, 8, Math.PI / 8), '#f5c542', 0.2) + f(poly(60, 40, 2.6, 8, Math.PI / 8), '#f5c542', -0.1)
      + crystal(60, 74, 16, 4, '#b07cff'), true),
  // A pale tower on its rock over the sea, the gold lantern lit, its beams out over the water.
  lighthouse: () => sky('#253058', { x: 20, y: 14, r: 6, c: '#e8eef8' })
    + star(100, 10, 1.6) + star(36, 22, 1.2)
    + f([[62, 22], [120, 4], [120, 30]], '#fff1b0', 0.1).replace('<path', '<path opacity=".8"')
    + f([[58, 22], [0, 6], [0, 30]], '#fff1b0', 0.1).replace('<path', '<path opacity=".6"')
    + lift(strip([56, 54, 57, 53, 56, 55, 57], '#2c5f8f', -0.05))
    + [16, 44, 88, 108].map((x) => f([[x - 6, 64], [x, 61], [x + 6, 64], [x, 63]], '#8fb8de', 0.1)).join('')
    + lift(f([[30, 84], [40, 66], [60, 62], [80, 66], [92, 84]], '#8d8f96', 0.05) + f([[60, 62], [80, 66], [92, 84], [60, 84]], '#8d8f96', -0.2))
    + lift(f([[50, 66], [53, 30], [60, 30], [60, 66]], MON, 0.2) + f([[60, 66], [60, 30], [67, 30], [70, 66]], MON, -0.2)
      + [56, 44].map((y) => f([[50.5 + (66 - y) * 0.08, y], [69.5 - (66 - y) * 0.08, y], [69.3 - (66 - y) * 0.08, y - 4], [50.7 + (66 - y) * 0.08, y - 4]], MON, -0.45)).join('')
      + f([[51, 30], [69, 30], [69, 27], [51, 27]], MON, -0.4)
      + f([[54, 27], [66, 27], [66, 18], [54, 18]], '#ffd23f', 0.3)
      + f([[51, 18], [60, 9], [69, 18]], MON, -0.3) + f([[59, 9], [60, 5], [61, 9]], '#f5c542', 0.2)
      + f([[57, 66], [57, 59], [63, 59], [63, 66]], '#3a2a20', 0), true),
  // A columned guildhall, banners in the goods' colours between the columns, a gold finial.
  guildhall: () => sky('#bfd4e6', { x: 100, y: 16, r: 7, c: '#fff1c4' })
    + lift(f([[2, 64], [2, 44], [14, 34], [26, 44], [26, 64]], '#d6c3a0', 0) + f([[94, 64], [94, 48], [118, 48], [118, 64]], '#d6c3a0', -0.1))
    + groundLayers('plains')
    + shadowUnder(60, 78, 40)
    + lift(f([[18, 80], [20, 74], [100, 74], [102, 80]], MON, -0.1) + f([[22, 74], [22, 42], [98, 42], [98, 74]], MON, 0.05)
      + f([[54, 74], [54, 56], [66, 56], [66, 74]], '#3a2a20', 0)
      + [26, 38, 76, 88].map((x) => f([[x, 74], [x, 42], [x + 2.5, 42], [x + 2.5, 74]], MON, 0.45) + f([[x + 2.5, 74], [x + 2.5, 42], [x + 5, 42], [x + 5, 74]], MON, 0.1)).join('')
      + ([[32, '#b88bff'], [44, TRADE_RED], [82, '#f5c542']] as [number, string][]).map(([x, c]) => f([[x - 0.5, 44], [x + 5, 44], [x + 5, 58], [x + 2.2, 55], [x - 0.5, 58]], c, 0)).join('')
      + f([[18, 42], [102, 42], [102, 36], [18, 36]], MON, -0.1)
      + f([[18, 36], [60, 16], [60, 36]], MON, 0.3) + f([[60, 16], [102, 36], [60, 36]], MON, -0.15)
      + f([[57, 17], [60, 6], [60, 17]], '#f5c542', 0.3) + f([[60, 6], [63, 17], [60, 17]], '#f5c542', -0.15), true),
  // ---- batch 2: the production cards ----
  cliff_works: () => sky('#a9c8de', { x: 24, y: 16, r: 7, c: '#fff1c4' })
    + lift(ridges([[20, 30, 22], [112, 26, 20]], '#8d8f96'))
    + groundLayers('mountain')
    + lift(f([[50, 76], [56, 26], [72, 10], [88, 16], [92, 76]], '#9a9ca3', 0.12) + f([[88, 16], [104, 34], [110, 76], [92, 76]], '#9a9ca3', -0.25) + f([[56, 26], [72, 10], [66, 30]], '#9a9ca3', 0.35), true)
    + lift([60, 82].map((x) => f([[x, 76], [x, 30], [x + 2.4, 30], [x + 2.4, 76]], '#a0673a', 0)).join('')
      + [32, 52].map((y) => f([[54, y], [90, y], [90, y + 3], [54, y + 3]], '#c48a4e', 0.1)).join('')
      + f([[90, 76], [94, 52], [96, 52], [92, 76]], '#7f4b23', 0) + f([[95, 76], [99, 52], [101, 52], [97, 76]], '#7f4b23', 0)
      + cube(72, 24.5, 5, '#d3d5da'), true)
    + shadowUnder(30, 80, 18)
    + lift(cube(22, 64, 8, '#c4c6cc') + cube(37, 66, 8, '#b3b6bd') + cube(29, 55, 8, '#d3d5da'), true),
  stonemason: () => sky('#bcd2e6', { x: 100, y: 16, r: 7, c: '#fff1c4' })
    + lift(ridges([[14, 18, 18], [104, 22, 20]], '#8d8f96'))
    + lift(box(92, 38, 26, 14, 16, '#e8dfcc') + f([[78, 38], [92, 26], [106, 38]], '#7d828b', 0.1))
    + groundLayers('plains')
    + shadowUnder(52, 78, 30)
    + lift(f([[30, 34], [36, 30], [78, 30], [72, 34]], '#d3d5da', 0.35) + f([[72, 34], [78, 30], [78, 72], [72, 76]], '#d3d5da', -0.3)
      + f([[30, 76], [30, 34], [72, 34], [72, 76], [62, 76], [62, 48], [56, 42], [46, 42], [40, 48], [40, 76]], '#d3d5da', 0.05)
      + f([[48, 34], [54, 34], [53, 42], [49, 42]], '#eef0f2', 0.3)
      + [[30, 40, 46], [30, 40, 60], [62, 72, 52], [62, 72, 66]].map(([a, b, y]) => f([[a, y], [b, y], [b, y + 0.8], [a, y + 0.8]], '#9aa0a6', 0)).join('')
      + f([[40, 76], [40, 48], [46, 42], [56, 42], [62, 48], [62, 76]], '#4a4252', 0)
      + f([[47, 76], [47, 56], [51, 56], [51, 76]], '#eef0f2', 0.2) + f([[51, 56], [55, 56], [55, 76], [51, 76]], '#eef0f2', -0.2) + f([[45, 53], [57, 53], [57, 56], [45, 56]], '#e4e6ea', 0.1), true)
    + lift(cube(88, 66, 7, '#c4c6cc') + cube(102, 68, 6, '#b3b6bd') + f([[18, 80], [30, 70], [32, 72], [20, 82]], '#a0673a', 0) + f([[27, 66], [35, 70], [32, 75], [24, 71]], '#7f4b23', 0), true),
  woodcutter: () => sky('#b9d7c4')
    + lift(pine(12, 58, 34) + pine(30, 56, 28) + pine(96, 56, 36) + pine(114, 60, 30))
    + groundLayers('forest')
    + shadowUnder(54, 78, 30)
    + lift([0, 1, 2, 3, 4].map((i) => f([[28, 52 + i * 5], [76, 52 + i * 5], [76, 57 + i * 5], [28, 57 + i * 5]], '#a0673a', i % 2 ? -0.12 : 0.05)
        + f(poly(28, 54.5 + i * 5, 2.6, 6), '#d9a066', 0.15)).join('')
      + f([[46, 77], [46, 62], [56, 62], [56, 77]], '#3a2a20', 0)
      + f([[22, 52], [36, 32], [70, 32], [82, 52]], '#7f4b23', 0.05) + f([[22, 52], [82, 52], [80, 55], [24, 55]], '#5e3c22', -0.1), true)
    + shadowUnder(96, 80, 12)
    + lift(f([[88, 80], [89, 68], [103, 68], [104, 80]], '#7f4b23', -0.05) + f(poly(96, 68, 7, 8, 0, 2.6), '#d9a066', 0.15)
      + f([[98, 66], [101, 66], [112, 40], [109, 40]], '#c48a4e', 0.05) + f([[90, 67], [92, 58], [101, 61], [100, 67]], '#d9dde6', 0.25)
      + logEnds([[24, 78], [33, 78], [28.5, 71.5]], 3.4), true),
  sawmill: () => sky('#b9d7c4', { x: 22, y: 16, r: 7, c: '#fff1c4' })
    + lift(pine(8, 56, 30) + pine(112, 56, 34))
    + lift(box(92, 40, 30, 16, 18, '#d9c39a') + f([[76, 40], [92, 28], [108, 40]], '#d9a868', 0.15))
    + groundLayers('forest')
    + shadowUnder(54, 80, 34)
    + lift(f(Array.from({ length: 32 }, (_, i) => { const a = (Math.PI * i) / 16; const r = i % 2 ? 22 : 25; return [58 + r * Math.cos(a), 42 + r * Math.sin(a)] as Pt; }), '#a9b0bb', -0.05)
      + f(poly(58, 42, 21, 16), '#dfe2e6', 0.2) + f(poly(58, 42, 13, 16), '#dfe2e6', 0.05) + f(poly(58, 42, 3.5, 8), '#3a3038', 0), true)
    + lift(f([[16, 62], [104, 62], [104, 66], [16, 66]], '#b97a44', 0.1) + [20, 96].map((x) => f([[x, 66], [x + 4, 66], [x + 4, 80], [x, 80]], '#7f4b23', -0.1)).join('')
      + f([[14, 50], [54, 50], [54, 62], [14, 62]], '#a0673a', -0.05) + f([[14, 50], [54, 50], [54, 53], [14, 53]], '#c48a4e', 0.2) + f(poly(14, 56, 6, 6), '#d9a066', 0.15) + f(poly(14, 56, 2.4, 6), '#a0673a', 0)
      + logEnds([[92, 58], [101, 58], [96.5, 52]], 3.6), true),
  driftwood_yard: () => sky('#cfe6f2', { x: 96, y: 16, r: 8, c: '#fff8e0' })
    + lift(ridges([[16, 14, 16]], '#9fb8c8', 50))
    + shore()
    + shadowUnder(54, 78, 30)
    + lift(logEnds([[44, 72], [54, 72], [64, 72], [49, 64], [59, 64], [54, 56]]), true)
    + lift(f([[78, 76], [86, 66], [110, 66], [114, 76]], '#7f4b23', -0.1) + f([[86, 66], [110, 66], [106, 63], [90, 63]], '#a0673a', 0.15)
      + f([[20, 78], [22, 34], [24, 34], [23, 78]], '#c48a4e', 0.05) + f([[19, 34], [21, 22], [26, 22], [27, 34]], '#d9a868', 0.15)
      + f([[6, 80], [36, 74], [37, 76], [7, 82]], '#d8cbb3', 0.1), true),
  ley_spire: () => sky('#3d3170', { x: 98, y: 14, r: 6, c: '#e8e0ff' })
    + star(18, 14, 2) + star(80, 24, 1.5) + star(40, 10, 1.4)
    + lift(ridges([[20, 26, 22], [104, 28, 22]], '#6f6a86'))
    + groundLayers('ley')
    + shadowUnder(60, 78, 22)
    + lift(f([[38, 78], [42, 72], [78, 72], [82, 78]], '#8f87a3', 0) + f([[45, 72], [48, 67], [72, 67], [75, 72]], '#a39cb5', 0.1)
      + f([[52, 67], [58, 30], [60, 30], [60, 67]], '#b9b2cc', 0.15) + f([[60, 67], [60, 30], [62, 30], [68, 67]], '#b9b2cc', -0.25), true)
    + `<g opacity=".35">${f(poly(60, 17, 16, 10), '#b07cff', 0.4)}</g>`
    + lift(gem(60, 16, 1.25, '#b07cff') + gem(40, 26, 0.45, '#d6bfff') + gem(82, 20, 0.4, '#c4a2ff'), true)
    + lift(crystal(30, 80, 14, 4, '#b07cff', -18) + crystal(92, 80, 16, 4, '#c4a2ff', 16), true),
  gem_cutter: () => `<rect width="120" height="84" fill="#6b4a3a"/>`
    + lift(f([[78, 10], [108, 10], [108, 40], [78, 40]], '#3d3170', 0) + star(88, 20, 1.6) + star(100, 30, 1.2) + f([[92, 10], [94, 10], [94, 40], [92, 40]], '#8a5a32', 0) + f([[78, 24], [108, 24], [108, 26], [78, 26]], '#8a5a32', 0))
    + lift(f([[0, 66], [120, 66], [120, 84], [0, 84]], '#8a5a32', -0.05))
    + shadowUnder(34, 80, 22)
    + lift([16, 48].map((x) => f([[x, 80], [x, 38], [x + 3, 38], [x + 3, 80]], '#a0673a', 0)).join('')
      + f(poly(33, 42, 18, 12), '#b9b2a6', 0.1) + f(poly(33, 42, 12, 12), '#b9b2a6', -0.1) + f(poly(33, 42, 3.4, 8), '#5e3c22', 0)
      + f([[14, 70], [54, 70], [50, 80], [18, 80]], '#7f4b23', 0), true)
    + lift(f([[60, 62], [114, 62], [114, 66], [60, 66]], '#c48a4e', 0.15) + [64, 108].map((x) => f([[x, 66], [x + 3, 66], [x + 3, 82], [x, 82]], '#7f4b23', -0.1)).join(''), true)
    + lift(gem(86, 48, 1.4, '#b07cff') + gem(68, 56, 0.55, '#d6bfff') + gem(105, 57, 0.45, '#c4a2ff'), true),
  smelter: () => sky('#f2c79a', { x: 22, y: 18, r: 9, c: '#fff1c4' })
    + lift(ridges([[96, 30, 24]], '#8d8f96'))
    + groundLayers('mountain')
    + shadowUnder(56, 78, 30)
    + lift(f([[66, 42], [66, 12], [72, 12], [72, 40]], '#9a4f31', 0.05) + f([[72, 12], [77, 12], [77, 42], [72, 40]], '#9a4f31', -0.25)
      + f(poly(76, 8, 4, 8), '#ece8e0', 0.1) + f(poly(84, 5, 5, 8), '#ece8e0', 0) + f(poly(94, 4, 5.5, 8), '#ece8e0', -0.05), true)
    + lift(f([[30, 78], [33, 56], [42, 42], [56, 38], [56, 78]], '#b9643f', 0.15) + f([[56, 38], [70, 42], [79, 56], [82, 78], [56, 78]], '#b9643f', -0.2)
      + f([[47, 78], [47, 64], [56, 58], [65, 64], [65, 78]], '#ff9a3c', 0.1) + f([[51, 78], [51, 67], [56, 63], [61, 67], [61, 78]], '#ffd23f', 0.2), true)
    + lift(cube(16, 64, 7, '#c4c6cc') + cube(24, 70, 6, '#b3b6bd') + crystal(92, 80, 18, 5, '#b07cff', 10) + crystal(102, 80, 13, 4, '#c4a2ff', 26) + crystal(84, 80, 10, 3.4, '#d6bfff', -14), true),
  shepherds_fold: () => sky('#bfe3f0', { x: 98, y: 16, r: 8, c: '#fff1c4' })
    + lift(strip([46, 40, 44, 38, 44, 41, 46], '#7fae45', 0.1))
    + groundLayers('meadow')
    + shadowUnder(38, 78, 20)
    + lift(f([[22, 78], [22, 46], [38, 46], [38, 78]], '#c4c6cc', 0.1) + f([[38, 46], [54, 46], [54, 78], [38, 78]], '#c4c6cc', -0.22) + f([[30, 78], [30, 64], [37, 64], [37, 78]], '#3a2a20', 0)
      + f([[16, 48], [38, 12], [38, 48]], STRAW, 0.2) + f([[38, 12], [60, 48], [38, 48]], STRAW, -0.15), true)
    + shadowUnder(82, 76, 16)
    + lift(sheep(76, 64, 1.15) + sheep(98, 62, 1.05, true), true)
    + lift(f([[60, 73], [64, 69], [116, 69], [120, 73]], '#c4c6cc', 0.3) + f([[60, 73], [120, 73], [120, 82], [60, 82]], '#c4c6cc', -0.05)
      + [[64, 76], [78, 76], [92, 76], [106, 76], [70, 79], [86, 79], [100, 79]].map(([x, y]) => f([[x, y], [x + 7, y], [x + 7, y + 0.8], [x, y + 0.8]], '#8d939c', 0)).join('')
      + f([[58, 80], [60, 30], [62, 30], [61, 80]], '#a0673a', 0) + f([[60, 30], [61, 24], [66, 21], [71, 24], [71, 29], [68, 29], [68, 25], [66, 24], [63, 26], [62, 30]], '#a0673a', 0.1), true),
  drovers_barn: () => sky('#bfe3f0', { x: 18, y: 16, r: 8, c: '#fff1c4' })
    + lift(strip([46, 42, 44, 40, 45, 42, 46], '#7fae45', 0.1))
    + groundLayers('meadow')
    + shadowUnder(60, 78, 36)
    + lift(f([[30, 76], [30, 38], [40, 22], [60, 12], [60, 76]], '#c48a4e', 0.1) + f([[60, 12], [80, 22], [90, 38], [90, 76], [60, 76]], '#c48a4e', -0.18)
      + f([[24, 40], [36, 18], [60, 6], [60, 13], [41, 23], [31, 40]], STRAW, 0.25) + f([[60, 6], [84, 18], [96, 40], [89, 40], [79, 23], [60, 13]], STRAW, -0.1)
      + f([[56, 30], [64, 30], [64, 38], [56, 38]], '#3a2a20', 0)
      + f([[46, 76], [46, 46], [74, 46], [74, 76]], '#3a2a20', 0)
      + f([[36, 76], [38, 46], [46, 46], [46, 76]], '#8a5a32', 0.1) + f([[74, 46], [82, 46], [84, 76], [74, 76]], '#8a5a32', -0.15), true)
    + shadowUnder(40, 82, 12) + shadowUnder(78, 82, 12)
    + lift(sheep(58, 72, 1.0) + sheep(36, 76, 1.2) + sheep(84, 77, 1.2, true), true),
  fishery: () => sky('#cfe6f2', { x: 20, y: 16, r: 8, c: '#fff8e0' })
    + shore()
    + shadowUnder(40, 80, 26)
    + lift([24, 54].map((x) => f([[x, 80], [x, 50], [x + 3, 50], [x + 3, 80]], '#5e3c22', 0)).join('')
      + f([[18, 50], [62, 50], [62, 54], [18, 54]], '#a0673a', 0.1)
      + f([[22, 50], [22, 32], [58, 32], [58, 50]], '#d9b48a', 0.05) + f([[34, 50], [34, 40], [42, 40], [42, 50]], '#3a2a20', 0)
      + f([[16, 34], [26, 14], [54, 14], [64, 34]], STRAW, 0.2) + f([[14, 36], [16, 32], [64, 32], [66, 36]], STRAW, -0.2), true)
    + lift([74, 110].map((x) => f([[x, 78], [x, 26], [x + 2.6, 26], [x + 2.6, 78]], '#a0673a', 0)).join('')
      + f([[72, 26], [114, 26], [114, 29], [72, 29]], '#7f4b23', 0) + [82, 92, 102].map((x) => fish(x, 29, 1.15)).join(''), true)
    + lift(sheep(100, 72, 0.9, true), true),
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
    // The cog it puts by its building on the board, a hammer and anvil before it.
    lift(f(poly(66, 40, 22, 16), '#aab1bb', -0.1) + Array.from({ length: 8 }, (_, i) => { const a = (Math.PI * i) / 4; return f(poly(66 + 24 * Math.cos(a), 40 + 24 * Math.sin(a), 5, 4, a + Math.PI / 4), '#aab1bb', Math.cos(a + Math.PI * 0.75) * 0.3); }).join('')
      + f(poly(66, 40, 14, 16), '#c9ced6', 0.2) + f(poly(66, 40, 6, 8, Math.PI / 8), '#3a302b', 0))
    + f([[40, 62], [80, 62], [74, 70], [46, 70]], '#5c6370', 0.15) + f([[46, 70], [74, 70], [70, 76], [50, 76]], '#5c6370', -0.2) + f([[30, 58], [40, 62], [46, 66], [36, 64]], '#5c6370', 0)
    + `<g transform="rotate(-35 64 44)">${f([[62, 30], [66, 30], [66, 64], [62, 64]], '#a0673a', 0.05)}${f([[52, 24], [76, 24], [76, 32], [52, 32]], '#9aa0a6', 0.25)}${f([[52, 32], [76, 32], [76, 36], [52, 36]], '#9aa0a6', -0.25)}</g>`
    + star(84, 46, 4, '#fff1c4') + star(90, 56, 2.5, '#fff1c4')),
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
  // The fauna cards: the beast they send, big, called up out of the night.
  wolf_call: () => actionScene(
    f(poly(92, 20, 9, 12), '#f6efd8', 0.2) + f(poly(95, 18, 7, 12), '#33285a', 0)
    + `<g transform="translate(60 50) scale(2.2)">${iconShapes('cave_bear')}</g>`, '#9aa0a8'),
  rouse_bear: () => actionScene(
    f([[26, 76], [34, 40], [60, 26], [86, 40], [94, 76], [80, 76], [76, 48], [60, 40], [44, 48], [40, 76]], '#6d6a63', 0.05)
    + `<g transform="translate(60 54) scale(2.2)">${iconShapes('basilisk')}</g>`, '#c48a52'),
  secret_hoard: () => actionScene(
    f([[40, 74], [36, 58], [46, 42], [60, 40], [56, 56], [52, 74]], '#b58a5a', 0.1) + f([[52, 74], [56, 56], [60, 40], [74, 42], [84, 58], [80, 74]], '#b58a5a', -0.15)
    + f([[48, 40], [56, 34], [64, 36], [72, 34], [72, 42], [48, 42]], '#9c7448', 0.05)
    + f([[48, 42], [72, 42], [72, 45], [48, 45]], '#e9b84a', 0)
    + coin(60, 34, 4.5) + f(poly(60, 60, 4, 6, 0), '#3a2a20', 0) + f([[58, 62], [62, 62], [61, 68], [59, 68]], '#3a2a20', 0), '#b07cff'),
};

// ---------- entry points ----------

// The picture for one card. `element` is a dragon's element.
// Until a building has its own picture it borrows its class's.
const CLASS_ART: Record<string, string> = { quarry: 'quarry', lumber: 'lumber_camp', mine: 'crystal_mine', pasture: 'pasture', dragon: 'roost', monument: 'monument', trade: 'port' };

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
  // Combat power: a folded shield, gold.
  power: f([[0, -9], [-8, -6], [-7, 2], [0, 9]], '#e9b84a', 0.18) + f([[0, -9], [8, -6], [7, 2], [0, 9]], '#e9b84a', -0.18),
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
