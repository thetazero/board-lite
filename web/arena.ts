// The fight's own scene (#326): when a raid or a hunt is fought, the TV cuts
// from the map to a full-screen stage, a backdrop of the place being fought
// over, with the two sides drawn as paper figures facing each other at their
// size. tv.ts plays the fight on it. With WebGL it's a live scene of the
// board's own origami models standing in the place (board3d.ts,
// FightStage); this file is the flat cut-paper art drawn instead where
// there's no WebGL, and the crown and burst laid over either.

import { ELEMENT_COLORS } from './common.ts';
import { iconShapes } from './icons.ts';

// ---------- backdrops ----------

// A backdrop is layers of cut paper, back to front: a sky, a glow, a far
// skyline, a nearer one, and the ground the figures stand on. Drawn on a
// 1920×1080 stage, kept to its bottom edge, so the ground stays under the
// figures at any screen shape.
const W = 1920, H = 1080, GROUND = 830;

interface Backdrop { sky: [string, string]; glow?: [number, number, string]; far: string; mid: string; ground: [string, string]; extra?: string }

// A low-poly ridge across the stage: `base` is its average height, `amp` how
// far it wanders, `n` how many points. Seeded, so a place looks the same every time.
function ridge(seed: number, base: number, amp: number, n: number, color: string): string {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts: string[] = [`0,${H}`];
  for (let i = 0; i <= n; i++) pts.push(`${Math.round((i / n) * W)},${Math.round(base - rnd() * amp)}`);
  pts.push(`${W},${H}`);
  return `<polygon fill="${color}" points="${pts.join(' ')}"/>`;
}

// Peaks: [x, height, half-width] each, with an optional cap.
function peaks(list: [number, number, number][], color: string, shade: string, cap?: string): string {
  return list.map(([x, h, w]) => {
    const top = GROUND - h;
    const capPts = cap ? `<polygon fill="${cap}" points="${x},${top} ${x - w * 0.22},${top + h * 0.22} ${x - w * 0.05},${top + h * 0.17} ${x + w * 0.08},${top + h * 0.25} ${x + w * 0.22},${top + h * 0.22}"/>` : '';
    return `<polygon fill="${color}" points="${x - w},${GROUND + 40} ${x},${top} ${x + w},${GROUND + 40}"/><polygon fill="${shade}" points="${x},${top} ${x + w},${GROUND + 40} ${x + w * 0.2},${GROUND + 40}"/>${capPts}`;
  }).join('');
}

// A wall with towers and battlements, from x0 to x1, its top at `top`.
function castle(x0: number, x1: number, top: number, color: string, shade: string, banner?: string): string {
  const out: string[] = [`<rect fill="${color}" x="${x0}" y="${top}" width="${x1 - x0}" height="${H - top}"/>`];
  for (let x = x0; x < x1; x += 44) out.push(`<rect fill="${color}" x="${x}" y="${top - 22}" width="24" height="24"/>`);
  const towers = [x0 - 20, (x0 + x1) / 2 - 60, x1 - 100];
  for (const tx of towers) {
    const tt = top - 150;
    out.push(`<rect fill="${color}" x="${tx}" y="${tt}" width="120" height="${H - tt}"/><rect fill="${shade}" x="${tx + 70}" y="${tt}" width="50" height="${H - tt}"/>`);
    for (let x = tx; x < tx + 120; x += 34) out.push(`<rect fill="${color}" x="${x}" y="${tt - 20}" width="20" height="22"/>`);
    out.push(`<rect fill="#1a1420" x="${tx + 48}" y="${tt + 50}" width="16" height="34" rx="8"/>`);
    if (banner) out.push(`<rect fill="#3a3030" x="${tx + 58}" y="${tt - 90}" width="5" height="72"/><polygon fill="${banner}" points="${tx + 63},${tt - 88} ${tx + 113},${tt - 76} ${tx + 63},${tt - 62}"/>`);
  }
  // The gate.
  const gx = (x0 + x1) / 2 + 120;
  out.push(`<path fill="#1a1420" d="M${gx} ${H} V${top + 70} a55 55 0 0 1 110 0 V${H} Z"/>`);
  return out.join('');
}

// Little houses with pitched roofs: [x, width] each.
function huts(list: [number, number][], wall: string, roof: string): string {
  return list.map(([x, w]) => {
    const t = GROUND - w * 0.55;
    return `<rect fill="${wall}" x="${x}" y="${t}" width="${w}" height="${w * 0.6}"/><polygon fill="${roof}" points="${x - 12},${t} ${x + w / 2},${t - w * 0.45} ${x + w + 12},${t}"/><rect fill="#2a1d14" x="${x + w * 0.4}" y="${t + w * 0.25}" width="${w * 0.2}" height="${w * 0.35}"/>`;
  }).join('');
}

// Pines: [x, height] each.
function pines(list: [number, number][], color: string): string {
  return list.map(([x, h]) => `<polygon fill="${color}" points="${x - h * 0.28},${GROUND + 20} ${x},${GROUND - h} ${x + h * 0.28},${GROUND + 20}"/>`).join('');
}

function bolt(x: number, y: number, s: number, color = '#ffe14d'): string {
  return `<polygon fill="${color}" opacity=".9" points="${x},${y} ${x - 40 * s},${y + 120 * s} ${x - 8 * s},${y + 115 * s} ${x - 50 * s},${y + 240 * s} ${x + 30 * s},${y + 95 * s} ${x - 2 * s},${y + 100 * s} ${x + 30 * s},${y}"/>`;
}

function waves(y: number, color: string, light: string): string {
  const out: string[] = [`<rect fill="${color}" x="0" y="${y}" width="${W}" height="${H - y}"/>`];
  for (let row = 0; row < 4; row++) for (let x = (row % 2) * 60; x < W; x += 140) {
    const yy = y + 30 + row * 55;
    out.push(`<polygon fill="${light}" opacity=".5" points="${x},${yy} ${x + 35},${yy - 12} ${x + 70},${yy} ${x + 35},${yy - 4}"/>`);
  }
  return out.join('');
}

// Each kingdom's place, and each terrain's for a fight over a hex.
const SETS: Record<string, Backdrop> = {
  brindle: { sky: ['#f6b26b', '#fbe3a1'], glow: [1450, 560, '#fff2c0'], far: ridge(3, 640, 90, 9, '#c7b27a'), mid: ridge(8, 760, 70, 7, '#8ea35a') + huts([[260, 110], [430, 90], [1500, 120], [1660, 85]], '#e8d6b0', '#9a5a32'), ground: ['#9cb85a', '#7a9844'] },
  archers_hold: { sky: ['#8fc0e6', '#eadbb4'], far: ridge(11, 650, 120, 12, '#6f8f5c'), mid: Array.from({ length: 48 }, (_, i) => `<polygon fill="#6b4a2c" points="${i * 40},${GROUND} ${i * 40 + 6},${700 + (i % 3) * 8} ${i * 40 + 18},${690 + (i % 3) * 8} ${i * 40 + 30},${700 + (i % 3) * 8} ${i * 40 + 36},${GROUND}"/>`).join('') + [300, 1560].map((x) => `<rect fill="#5a3c22" x="${x}" y="460" width="90" height="380"/><polygon fill="#8a3a2a" points="${x - 25},460 ${x + 45},380 ${x + 115},460"/><rect fill="#2a1d14" x="${x + 35}" y="520" width="20" height="40"/>`).join(''), ground: ['#b39a62', '#8f7746'] },
  frostpeak: { sky: ['#9fd0ee', '#eef8ff'], far: peaks([[200, 560, 330], [620, 680, 380], [1080, 520, 300], [1460, 720, 400], [1820, 540, 300]], '#8fb8d6', '#6f9cbf', '#ffffff'), mid: ridge(5, 790, 60, 10, '#cfe7f5'), ground: ['#e8f4fb', '#c6e0ef'] },
  knightsgate: { sky: ['#6f88b8', '#d3dbea'], far: ridge(2, 700, 80, 8, '#61789a'), mid: castle(160, 1760, 560, '#8b8f9c', '#6f7380', '#e5484d'), ground: ['#86965e', '#6c7c48'] },
  stormspire: { sky: ['#221d3c', '#5d518d'], glow: [960, 300, '#8f7fd0'], far: peaks([[250, 420, 300], [700, 380, 260], [1300, 460, 320], [1750, 400, 280]], '#3a3360', '#2c274c'), mid: `<polygon fill="#2a2445" points="880,${GROUND} 930,180 960,90 990,180 1040,${GROUND}"/><polygon fill="#1d1934" points="960,90 990,180 1040,${GROUND} 960,${GROUND}"/>` + bolt(1380, 120, 1.2) + bolt(520, 160, 0.9), ground: ['#4c4670', '#3a3458'] },
  tidewatch: { sky: ['#78bfd6', '#dff1ec'], far: waves(660, '#3d7fbf', '#bfe3f7'), mid: `<polygon fill="#5d5a62" points="1340,${GROUND} 1390,700 1560,690 1620,${GROUND}"/><polygon fill="#ece4d2" points="1430,700 1450,330 1500,330 1520,700"/><rect fill="#e5484d" x="1442" y="420" width="70" height="40"/><rect fill="#e5484d" x="1436" y="560" width="82" height="40"/><rect fill="#ffd23f" x="1450" y="285" width="50" height="45"/><polygon fill="#a33236" points="1440,285 1475,245 1510,285"/>`, ground: ['#ddc98f', '#c4ad70'] },
  cinderkeep: { sky: ['#1e0a0e', '#7a2416'], glow: [1300, 520, '#ff7a2a'], far: `<polygon fill="#3a1712" points="820,${GROUND} 1180,330 1420,330 1800,${GROUND}"/><polygon fill="#ff6a2a" points="1250,330 1350,330 1330,420 1300,520 1270,430"/><polygon fill="#ffb02e" opacity=".8" points="1220,330 1380,330 1350,250 1300,200 1250,250"/>` + ridge(7, 720, 60, 9, '#2c120e'), mid: castle(120, 900, 600, '#24100e', '#1a0a08') + [260, 500, 740].map((x) => `<rect fill="#ff9a3a" x="${x}" y="660" width="18" height="30" rx="9"/>`).join(''), ground: ['#3b2018', '#2a150f'], extra: Array.from({ length: 40 }, (_, i) => `<circle fill="#ffb02e" opacity=".7" cx="${(i * 487) % W}" cy="${150 + ((i * 263) % 700)}" r="${2 + (i % 3)}"/>`).join('') },
  titans_throne: { sky: ['#15122e', '#4a3f7a'], glow: [960, 380, '#9f8fe0'], far: peaks([[180, 520, 320], [560, 440, 280], [1360, 460, 300], [1760, 540, 320]], '#2b2650', '#211d40'), mid: `<polygon fill="#4c4962" points="560,${GROUND} 640,600 1280,600 1360,${GROUND}"/><rect fill="#5d5a72" x="760" y="160" width="400" height="300"/><polygon fill="#5d5a72" points="760,160 960,70 1160,160"/><rect fill="#4c4962" x="1080" y="160" width="80" height="300"/><rect fill="#6e6b86" x="700" y="380" width="520" height="90"/><rect fill="#5d5a72" x="660" y="320" width="100" height="280"/><rect fill="#5d5a72" x="1160" y="320" width="100" height="280"/><rect fill="#4c4962" x="1210" y="320" width="50" height="280"/>` + bolt(1500, 60, 1.3) + bolt(420, 100, 1), ground: ['#3c3a52', '#2c2a40'] },
  // A fight over a hex, by its terrain.
  forest: { sky: ['#20304a', '#5f7a86'], far: pines(Array.from({ length: 26 }, (_, i) => [i * 76 + 20, 260 + ((i * 37) % 120)]), '#24443a'), mid: pines(Array.from({ length: 12 }, (_, i) => [i * 170 + 60, 380 + ((i * 53) % 140)]), '#183428'), ground: ['#2f5a36', '#244a2c'] },
  mountain: { sky: ['#8aa0b8', '#d8dee6'], far: peaks([[240, 520, 320], [760, 640, 360], [1250, 560, 320], [1700, 660, 360]], '#77798a', '#5f6172', '#f1f3f6'), mid: ridge(4, 780, 70, 9, '#8d8f96'), ground: ['#9a9ca3', '#7d7f86'] },
  ley: { sky: ['#2e2456', '#7d68c0'], glow: [960, 560, '#c9b6ff'], far: ridge(9, 690, 90, 10, '#4a3c86'), mid: [[300, 140], [520, 90], [1380, 160], [1620, 100]].map(([x, h]) => `<polygon fill="#a58cf0" points="${x - 30},${GROUND} ${x},${GROUND - h} ${x + 30},${GROUND}"/><polygon fill="#7d62d0" points="${x},${GROUND - h} ${x + 30},${GROUND} ${x},${GROUND}"/>`).join(''), ground: ['#5d4a9c', '#4a3a80'] },
  meadow: { sky: ['#8fc6ea', '#eef6d8'], glow: [1500, 260, '#fff6c8'], far: ridge(6, 680, 80, 8, '#a8c070'), mid: ridge(12, 780, 50, 7, '#8fbf4f'), ground: ['#8fbf4f', '#76a63c'] },
  desert: { sky: ['#9cc7e8', '#f2e6c0'], far: ridge(13, 700, 60, 8, '#c8b77c'), mid: ridge(14, 790, 40, 6, '#d9c68e'), ground: ['#d9c68e', '#c2ae74'] },
  harbor: { sky: ['#7fc4d6', '#e3f2ec'], far: waves(690, '#4fb0a5', '#d8f3ee'), mid: '', ground: ['#d9c68e', '#c2ae74'] },
  ocean: { sky: ['#3f6f96', '#a6cbe0'], far: '', mid: '', ground: ['#2c5f8f', '#1f4a72'], extra: waves(GROUND - 120, '#2c5f8f', '#a6cbe0') },
};

// The backdrop for a kingdom (a TARGETS key) or a terrain.
export function backdrop(key: string): string {
  const s = SETS[key] ?? SETS.desert;
  // Ids by place: a scene fading out over the next one may hold the same ids, and both then mean the same colours.
  const id = `bd-${SETS[key] ? key : 'desert'}`;
  const glow = s.glow ? `<radialGradient id="${id}-g" cx="${s.glow[0] / W}" cy="${s.glow[1] / H}" r=".45"><stop offset="0" stop-color="${s.glow[2]}" stop-opacity=".85"/><stop offset="1" stop-color="${s.glow[2]}" stop-opacity="0"/></radialGradient>` : '';
  return `<svg class="backdrop" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="${id}-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/></linearGradient>${glow}
    <linearGradient id="${id}-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.ground[0]}"/><stop offset="1" stop-color="${s.ground[1]}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#${id}-s)"/>${s.glow ? `<rect width="${W}" height="${H}" fill="url(#${id}-g)"/>` : ''}
    <g opacity=".92">${s.far}</g>${s.mid}${s.extra ?? ''}
    <rect y="${GROUND}" width="${W}" height="${H - GROUND}" fill="url(#${id}-f)"/><rect y="${GROUND}" width="${W}" height="6" fill="#fff" opacity=".18"/>
  </svg>`;
}

// ---------- figures ----------

// Shades of a colour, for a figure's lit and shadowed facets.
const mix = (c: string, to: string, pct: number) => `color-mix(in oklab, ${c}, ${to} ${pct}%)`;

// A dragon in profile, facing right, standing: tail, body, legs, a wing
// raised behind, a long neck and horned head. Its element's colour, and its
// element's mark on its flank so it reads by shape as well as colour.
// The same drawing at every stage; the figure's size tells its health.
export function dragonFigure(element: string): string {
  const c = ELEMENT_COLORS[element] ?? '#c9ced6';
  const dk = mix(c, '#1a1020', 38), dk2 = mix(c, '#1a1020', 55), lt = mix(c, '#ffffff', 30);
  const body = [
    // the far wing, then the far legs, behind the body
    [dk2, '40,44 30,4 46,16 52,2 60,18 66,40'],
    [dk2, '40,58 46,58 47,80 39,80'],
    [dk2, '60,58 66,58 69,80 61,80'],
    // the tail, sweeping back and up
    [dk, '30,50 12,58 2,46 6,40 10,50 30,44'],
    // the body
    [c, '28,46 42,38 62,38 72,46 66,62 36,64'],
    [dk, '36,64 66,62 72,46 62,56 40,58'],
    // the near legs
    [c, '34,58 42,58 43,80 33,80'],
    [c, '56,58 64,58 66,80 56,80'],
    [dk, '33,80 43,80 43,76 31,78'],
    [dk, '56,80 66,80 66,76 55,78'],
    // the neck and head
    [c, '62,42 70,22 80,20 78,30 72,48'],
    [lt, '62,42 70,22 72,26 66,44'],
    [c, '72,14 86,14 98,22 96,27 84,28 74,26'],
    [dk, '74,26 84,28 96,27 92,31 80,31'],
    [lt, '74,14 72,4 79,13'],
    [lt, '80,14 82,6 85,14'],
    // the near wing
    [lt, '44,42 40,10 54,22 58,8 64,24 62,40'],
    [c, '44,42 54,22 62,40'],
  ] as const;
  const shapes = body.map(([f, p]) => `<polygon fill="${f}" points="${p}"/>`).join('');
  // A paper figure: the shapes cut out with a white border, then drawn.
  return `<svg class="fig-art" viewBox="-2 0 104 84" preserveAspectRatio="xMidYMax meet">
    <g stroke="#f7f0de" stroke-width="3.2" stroke-linejoin="round" fill="#f7f0de">${body.map(([, p]) => `<polygon points="${p}"/>`).join('')}</g>
    ${shapes}<circle cx="89" cy="18.5" r="1.6" fill="#111"/>
    <g transform="translate(51 50) scale(.42)" opacity=".9">${iconShapes(element)}</g></svg>`;
}

// A defender, beast or perched rival drawn from its picture, cut out of paper
// the same way, standing on the ground.
export function unitFigure(iconName: string): string {
  return `<svg class="fig-art" viewBox="-11.5 -11.5 23 23" preserveAspectRatio="xMidYMax meet">
    <g stroke="#f7f0de" stroke-width="1.6" stroke-linejoin="round">${iconShapes(iconName)}</g>${iconShapes(iconName)}</svg>`;
}

// The crown that comes down on the player with the most power standing.
export function crown(): string {
  return `<svg class="crown" viewBox="0 0 40 30" aria-hidden="true">
    <polygon fill="#f7f0de" stroke="#f7f0de" stroke-width="3" stroke-linejoin="round" points="3,27 1,6 12,15 20,1 28,15 39,6 37,27"/>
    <polygon fill="#f5c542" points="3,27 1,6 12,15 20,1 28,15 39,6 37,27"/>
    <polygon fill="#c99a1e" points="20,1 28,15 39,6 37,27 20,27"/>
    <rect fill="#b8860b" x="3" y="22" width="34" height="5"/>
    <circle fill="#e5484d" cx="20" cy="18" r="2.6"/><circle fill="#2f8fff" cx="10" cy="20" r="1.8"/><circle fill="#2f8fff" cx="30" cy="20" r="1.8"/></svg>`;
}

// A star-shaped burst behind a hit whose element beats its target's.
export function burst(): string {
  const pts = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2, r = i % 2 ? 22 : 50;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<svg class="burst-art" viewBox="0 0 100 100" aria-hidden="true"><polygon points="${pts}" style="fill:var(--bc)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
}
