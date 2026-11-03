// The game's icons: one set, drawn as folded paper (the owner's call: "oragami
// leaning"). Every icon is a few flat facets of one colour, lit from the top
// left: a light facet, a mid one and a shaded one, with no outlines. Things the
// game names over and over (resources, points, cards, elements) are shown by
// these, not by words.
//
// Each icon is drawn on a -10..10 box. `icon(name, size)` gives the inline SVG,
// `size` in em so it scales with the text around it (the TV's text scales with
// the screen).

type Facet = [fill: string, points: string];

const P = (pts: [number, number][]) => pts.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ');
const polar = (r: number, deg: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];

// A ring of facets between two regular polygons, shaded by which way each one faces.
function bevel(sides: number, outer: number, inner: number, start: number, light: string, mid: string, dark: string): Facet[] {
  const out: Facet[] = [];
  for (let i = 0; i < sides; i++) {
    const a = start + (360 / sides) * i;
    const b = a + 360 / sides;
    const facing = (a + b) / 2; // the facet's outward direction; light comes from the top left (225°)
    const lit = Math.cos(((facing - 225) * Math.PI) / 180);
    out.push([lit > 0.4 ? light : lit < -0.4 ? dark : mid, P([polar(outer, a), polar(outer, b), polar(inner, b), polar(inner, a)])]);
  }
  return out;
}

// A folded star: each point is creased down the middle, one half lit.
function star(points: number, outer: number, inner: number, light: string, dark: string, start = -90): Facet[] {
  const out: Facet[] = [];
  for (let i = 0; i < points; i++) {
    const tip = start + (360 / points) * i;
    const half = 180 / points;
    out.push([light, P([[0, 0], polar(inner, tip - half), polar(outer, tip)])]);
    out.push([dark, P([[0, 0], polar(outer, tip), polar(inner, tip + half)])]);
  }
  return out;
}


const rot = ([x, y]: [number, number], deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

// A sword, point up, turned by `deg`.
function sword(deg: number): Facet[] {
  const r = (pts: [number, number][]) => P(pts.map((pt) => rot(pt, deg)));
  return [
    ['#eef1f5', r([[0, -9.5], [0, 3], [-1.7, 3], [-1.7, -7.2]])],
    ['#a9b0bb', r([[0, -9.5], [1.7, -7.2], [1.7, 3], [0, 3]])],
    ['#c79314', r([[-5, 3], [5, 3], [5, 4.8], [-5, 4.8]])],
    ['#7f4b23', r([[-1.1, 4.8], [1.1, 4.8], [1.1, 8], [-1.1, 8]])],
    ['#f5c542', r([[0, 7.6], [1.5, 8.8], [0, 10], [-1.5, 8.8]])],
  ];
}

// A small hex tile, its top half lit.
function hexFacets(cx: number, cy: number, light: string, dark: string): Facet[] {
  const c = (deg: number): [number, number] => { const [x, y] = polar(4.6, deg); return [cx + x, cy + y]; };
  return [
    [light, P([c(150), c(210), c(270), c(330), c(30)])],
    [dark, P([c(30), c(90), c(150)])],
  ];
}

const ICONS: Record<string, Facet[]> = {
  // A faceted boulder.
  stone: [
    ['#dfe2e6', P([[-6.5, -3], [-1, -7.5], [6, -5.5], [0.5, -1]])],
    ['#b4b9c0', P([[6, -5.5], [8.5, 1.5], [3.5, 7], [0.5, -1]])],
    ['#c6cad0', P([[-6.5, -3], [0.5, -1], [-4, 7], [-8.5, 3.5]])],
    ['#7d828b', P([[0.5, -1], [3.5, 7], [-4, 7]])],
  ],
  // A six-sided log, end on, with its growth ring.
  timber: [
    ['#b97a44', P([[-6.2, -3.9], [1.8, -3.9], [-0.5, 0], [-8.5, 0]])],
    ['#7f4b23', P([[-8.5, 0], [-0.5, 0], [1.8, 3.9], [-6.2, 3.9]])],
    ['#f0cb93', P([[-0.5, 0], [1.8, -3.9], [6.3, -3.9], [8.5, 0]])],
    ['#d9a868', P([[-0.5, 0], [8.5, 0], [6.3, 3.9], [1.8, 3.9]])],
    ['#b57f45', P([[2, 0], [3.1, -1.9], [5.3, -1.9], [6.4, 0], [5.3, 1.9], [3.1, 1.9]])],
  ],
  // A cut gem: crown above, pavilion below.
  crystal: [
    ['#c9a6ff', P([[-7.5, -2.5], [-3.5, -7.5], [-2, -2.5]])],
    ['#eadbff', P([[-3.5, -7.5], [3.5, -7.5], [2, -2.5], [-2, -2.5]])],
    ['#a874f5', P([[3.5, -7.5], [7.5, -2.5], [2, -2.5]])],
    ['#9a62ee', P([[-7.5, -2.5], [-2, -2.5], [0, 8.5]])],
    ['#b88bff', P([[-2, -2.5], [2, -2.5], [0, 8.5]])],
    ['#6a3cc0', P([[2, -2.5], [7.5, -2.5], [0, 8.5]])],
  ],
  // A folded sheep: a woolly body, dark face and legs.
  livestock: [
    ['#4a423c', P([[-3.5, 3], [-1.5, 3], [-2, 8], [-3.6, 8]])],
    ['#4a423c', P([[3, 3], [5, 2.5], [5.2, 8], [3.6, 8]])],
    ['#fbf6e8', P([[-4.5, -3.5], [0.5, -6.5], [6.5, -4], [1, -0.5]])],
    ['#ddd3b8', P([[6.5, -4], [8.5, 1], [6, 4.5], [1, -0.5]])],
    ['#ece4cf', P([[-4.5, -3.5], [1, -0.5], [-0.5, 4.5], [-5, 3]])],
    ['#c5b996', P([[1, -0.5], [6, 4.5], [-0.5, 4.5]])],
    ['#5e554d', P([[-9, 0], [-5.8, -4], [-3.8, 0.8], [-7.2, 3.2]])],
    ['#3a332e', P([[-5.8, -4], [-9.5, -4.5], [-7.4, -2]])],
  ],
  // A coin with a bevelled rim and a stamped diamond.
  gold: [
    ...bevel(8, 8.5, 5.6, 22.5, '#ffe9a3', '#f2c040', '#b98813'),
    ['#f5c542', P(Array.from({ length: 8 }, (_, i) => polar(5.6, 22.5 + 45 * i)))],
    ['#c79314', P([[0, -3.3], [2.2, 0], [0, 3.3], [-2.2, 0]])],
    ['#fff0bd', P([[0, -3.3], [-2.2, 0], [0, 0]])],
  ],
  // Victory points: a folded paper star.
  points: star(5, 9.5, 4, '#fff6dc', '#e2c58c'),
  // Cards in hand: two cards fanned, one corner folded.
  cards: [
    ['#9e9a90', P([[-8, -5], [-1.5, -7.5], [2.5, 4], [-4, 6.5]])],
    ['#f3efe4', P([[-2.5, -6.5], [5, -6.5], [7.5, -4], [7.5, 8], [-2.5, 8]])],
    ['#c9c3b3', P([[5, -6.5], [7.5, -4], [5, -4]])],
    ['#ddd7c8', P([[2.5, -6.5], [5, -6.5], [5, -4], [7.5, -4], [7.5, 8], [2.5, 8]])],
  ],
  // A paper sword, point up: the blade creased down its middle.
  sword: sword(0),
  // Two swords crossed: a raid.
  raid: [...sword(-38), ...sword(38)],
  // A folded speech bubble: table talk.
  talk: [
    ['#f3efe4', P([[-8.5, -6], [-5, -8.5], [5, -8.5], [8.5, -6], [8.5, 1.5], [0, 1.5]])],
    ['#cfc8b6', P([[-8.5, -6], [0, 1.5], [8.5, 1.5], [5, 4], [-1, 4], [-5, 8.5], [-4, 4], [-5, 4], [-8.5, 1.5]])],
    ['#8a8578', P([[-3, -2.5], [-1, -2.5], [-1, -0.8], [-3, -0.8]])],
    ['#8a8578', P([[1, -2.5], [3, -2.5], [3, -0.8], [1, -0.8]])],
  ],
  // A padlock: chosen in secret.
  secret: [
    ['#b9bec7', P([[-5.5, -1], [-5.5, -5], [-3, -8.5], [3, -8.5], [5.5, -5], [5.5, -1], [3.5, -1], [3.5, -4.5], [2, -6.5], [-2, -6.5], [-3.5, -4.5], [-3.5, -1]])],
    ['#f2b600', P([[-7.5, -1], [7.5, -1], [7.5, 3], [-7.5, 3]])],
    ['#c48f00', P([[-7.5, 3], [7.5, 3], [7.5, 8.5], [-7.5, 8.5]])],
    ['#5c4300', P([[-1, 2], [1, 2], [1, 6], [-1, 6]])],
  ],
  // An open eye: everyone sees it.
  public: [
    ['#f3efe4', P([[-9.5, 0], [-4, -5.5], [4, -5.5], [9.5, 0]])],
    ['#cfc8b6', P([[-9.5, 0], [9.5, 0], [4, 5.5], [-4, 5.5]])],
    ['#3e7bfa', P(Array.from({ length: 8 }, (_, i) => polar(3.8, 22.5 + 45 * i)))],
    ['#111', P(Array.from({ length: 6 }, (_, i) => polar(1.7, 30 + 60 * i)))],
  ],
  // Titles: the tallest tower, the largest territory, the strongest army.
  tower: [
    ['#e6e1d3', P([[-5.5, 9], [-5.5, -5], [-7, -5], [-7, -9.5], [-4.5, -9.5], [-4.5, -7.5], [-1.2, -7.5], [-1.2, -9.5], [0, -9.5], [0, 9]])],
    ['#b3ac98', P([[0, 9], [0, -9.5], [1.2, -9.5], [1.2, -7.5], [4.5, -7.5], [4.5, -9.5], [7, -9.5], [7, -5], [5.5, -5], [5.5, 9]])],
    ['#6b6553', P([[-1.6, 9], [-1.6, 4], [0, 2.5], [1.6, 4], [1.6, 9]])],
    ['#6b6553', P([[-3.5, -3], [-2, -3], [-2, 0], [-3.5, 0]])],
  ],
  territory: [
    ...hexFacets(-4.6, -4, '#a6d46a', '#6f9a3a'),
    ...hexFacets(4.6, -4, '#e3d39f', '#b39f62'),
    ...hexFacets(0, 4, '#4f8a5a', '#2f5e3a'),
  ],
  // Elements.
  // A flame of three tongues around a yellow core, so it reads as fire even dimmed.
  fire: [
    ['#ff9a3c', P([[0, -9.5], [0, 9], [-4.5, 6.5], [-6.5, 1], [-5.5, -6], [-3, -3]])],
    ['#f05a24', P([[0, -9.5], [3, -3], [5.5, -6], [6.5, 1], [4.5, 6.5], [0, 9]])],
    ['#c8331a', P([[-4.5, 6.5], [0, 4], [4.5, 6.5], [0, 9]])],
    ['#ffd23f', P([[0, -3], [2.8, 2.5], [0, 6.5], [-2.8, 2.5]])],
    ['#fff1b0', P([[0, -3], [0, 6.5], [-2.8, 2.5]])],
  ],
  // Icicles hanging from a snowy ledge: nothing like the crystal's cut gem.
  ice: [
    ['#ffffff', P([[-9.5, -6.5], [-7, -9.5], [7, -9.5], [9.5, -6.5]])],
    ['#d6f2ff', P([[-9.5, -6.5], [9.5, -6.5], [8.5, -4.5], [-8.5, -4.5]])],
    ['#c8edff', P([[-8, -4.5], [-5, -4.5], [-5, 3]])],
    ['#6cbbe6', P([[-5, -4.5], [-2, -4.5], [-5, 3]])],
    ['#e8f8ff', P([[-2, -4.5], [1, -4.5], [1, 9.5]])],
    ['#82c8ee', P([[1, -4.5], [4, -4.5], [1, 9.5]])],
    ['#c8edff', P([[4, -4.5], [6, -4.5], [6, 1]])],
    ['#6cbbe6', P([[6, -4.5], [8, -4.5], [6, 1]])],
  ],
  lightning: [
    ['#fff08a', P([[2.5, -9.5], [-6, 1.5], [-0.5, 1.5], [3, -3]])],
    ['#f2be1f', P([[3, -3], [-0.5, 1.5], [6, -1]])],
    ['#ffd23f', P([[6, -1], [-0.5, 1.5], [-3, 9.5]])],
    ['#c99300', P([[-0.5, 1.5], [-3, 9.5], [-1, 1.5]])],
  ],
  // A paper pinwheel.
  air: [
    ['#f4f7f8', P([[0, 0], [0, -9], [-5.5, -5.5]])],
    ['#b8c3c8', P([[0, 0], [9, 0], [5.5, -5.5]])],
    ['#dfe6e9', P([[0, 0], [0, 9], [5.5, 5.5]])],
    ['#9aa7ad', P([[0, 0], [-9, 0], [-5.5, 5.5]])],
    ['#ffffff', P([[0, 0], [-5.5, -5.5], [-1.2, -1.2]])],
    ['#d1d9dc', P([[0, 0], [5.5, -5.5], [1.2, -1.2]])],
  ],
  water: [
    ['#9fd0ff', P([[0, -9.5], [-6, 1], [0, 1.5]])],
    ['#3d97ff', P([[0, -9.5], [0, 1.5], [6, 1]])],
    ['#5aa8ff', P([[-6, 1], [0, 1.5], [0, 9], [-4.5, 6.5]])],
    ['#1f6fd6', P([[6, 1], [4.5, 6.5], [0, 9], [0, 1.5]])],
    ['#d9eeff', P([[-3.5, 0], [-2, -3.5], [-1.6, 0.4]])],
  ],
};

export const ICON_NAMES = Object.keys(ICONS);

const LABEL: Record<string, string> = { points: 'points', cards: 'cards', raid: 'raid', talk: 'table talk', secret: 'secret', public: 'everyone sees it', tower: 'tallest tower', territory: 'largest territory' };

// Just the shapes, to draw an icon inside another SVG (on the -10..10 box).
export function iconShapes(name: string): string {
  return (ICONS[name] ?? []).map(([f, p]) => `<polygon fill="${f}" points="${p}"/>`).join('');
}

export function icon(name: string, size = 1.25, cls = 'ricon'): string {
  const facets = ICONS[name];
  if (!facets) return '';
  return `<svg class="${cls}" style="width:${size}em;height:${size}em" viewBox="-10 -10 20 20" role="img" aria-label="${LABEL[name] ?? name}"><title>${LABEL[name] ?? name}</title>${facets.map(([f, p]) => `<polygon fill="${f}" points="${p}"/>`).join('')}</svg>`;
}
