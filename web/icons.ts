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

// A die's paper shape, and its pips as small dark octagons.
const DIE: Record<string, Facet[]> = {
  d6: [
    ['#b9b2a2', P([[-7.5, 7.5], [7.5, 7.5], [7.5, -7.5], [8.8, -6.2], [8.8, 8.8], [-6.2, 8.8]])],
    ['#ffffff', P([[-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5]])],
    ['#e6e0d2', P([[7.5, -7.5], [7.5, 7.5], [-7.5, 7.5]])],
  ],
  d8: [
    ['#ffffff', P([[0, -9.5], [0, 0], [-8, 0]])],
    ['#e6e0d2', P([[0, -9.5], [8, 0], [0, 0]])],
    ['#e6e0d2', P([[-8, 0], [0, 0], [0, 9.5]])],
    ['#b9b2a2', P([[0, 0], [8, 0], [0, 9.5]])],
  ],
  d4: [
    ['#ffffff', P([[0, -9], [0, 2.5], [-9, 7.5]])],
    ['#e6e0d2', P([[0, -9], [9, 7.5], [0, 2.5]])],
    ['#b9b2a2', P([[-9, 7.5], [0, 2.5], [9, 7.5]])],
  ],
};
const pips = (at: [number, number][], r: number): Facet[] =>
  at.map(([x, y]) => ['#2b2228', P(Array.from({ length: 8 }, (_, i) => { const [px, py] = polar(r, 22.5 + i * 45); return [x + px, y + py] as [number, number]; }))]);

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
  tower: [], // drawn below, as the tower building
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
  // Dice: white paper shapes, one per kind of die (a square d6, a diamond d8,
  // a triangle d4). With pips, a die still to roll ("2" and a d6 is 2d6); the
  // blank `…face` shape carries a number once it's rolled (dieFace).
  d6face: DIE.d6,
  d8face: DIE.d8,
  d4face: DIE.d4,
  d6: [...DIE.d6, ...pips([[-4, -4], [4, -4], [0, 0], [-4, 4], [4, 4]], 1.7)],
  d8: [...DIE.d8, ...pips([[0, -3.2], [-2.8, 1.6], [2.8, 1.6]], 1.5)],
  d4: [...DIE.d4, ...pips([[0, 3.2]], 1.6)],

  // ---- the kingdoms' defenders, one picture per kind ----
  // A villager in a straw hat with a pitchfork.
  militia: [
    ['#6b4a2c', P([[6.6, -6], [7.6, -6], [7.6, 10], [6.6, 10]])],
    ['#c9ced6', P([[4.6, -9.5], [5.4, -9.5], [5.4, -6], [4.6, -6]])],
    ['#c9ced6', P([[6.7, -9.5], [7.5, -9.5], [7.5, -6], [6.7, -6]])],
    ['#c9ced6', P([[8.8, -9.5], [9.6, -9.5], [9.6, -6], [8.8, -6]])],
    ['#c9ced6', P([[4.6, -6.6], [9.6, -6.6], [9.6, -5.6], [4.6, -5.6]])],
    ['#9a7552', P([[-6.5, 3], [0, 3], [0, 10], [-7.5, 10]])],
    ['#7a5a3c', P([[0, 3], [6, 3], [7, 10], [0, 10]])],
    ['#f0c9a3', P([[-3.6, -2.5], [0, -2.5], [0, 3.2], [-2.6, 3.2]])],
    ['#d3a47c', P([[0, -2.5], [3.6, -2.5], [2.6, 3.2], [0, 3.2]])],
    ['#f2d27a', P([[-8.5, -2], [0, -9], [0, -2]])],
    ['#c49a3c', P([[0, -9], [8.5, -2], [0, -2]])],
  ],
  // A drawn bow with its arrow.
  archers: [
    ...Array.from({ length: 6 }, (_, i): Facet => {
      const a = 115 + i * 22, b = a + 22;
      return [i < 3 ? '#c48a4e' : '#8a5a2c', P([polar(9, a), polar(9, b), polar(7.2, b), polar(7.2, a)])];
    }),
    ['#e8e2d0', P([[polar(9, 115)[0] - 0.3, polar(9, 115)[1]], [polar(9, 115)[0] + 0.3, polar(9, 115)[1]], [3.3, 0], [2.7, 0]])],
    ['#e8e2d0', P([[2.7, 0], [3.3, 0], [polar(9, 247)[0] + 0.3, polar(9, 247)[1]], [polar(9, 247)[0] - 0.3, polar(9, 247)[1]]])],
    ['#d9dde6', P([[-6, -0.5], [7, -0.5], [7, 0.5], [-6, 0.5]])],
    ['#eef1f5', P([[6.5, -2.4], [10, 0], [6.5, 0]])],
    ['#a9b0bb', P([[6.5, 0], [10, 0], [6.5, 2.4]])],
    ['#e5484d', P([[-9, -2.6], [-5.5, -0.5], [-7, -0.5]])],
    ['#a33236', P([[-9, 2.6], [-7, 0.5], [-5.5, 0.5]])],
  ],
  // A knight's great helm with its plume.
  knights: [
    ['#e5484d', P([[-0.6, -7.5], [1, -10], [6, -9.5], [2.5, -7]])],
    ['#dfe3ea', P([[-6.5, -5.5], [0, -8], [0, 9], [-6.5, 6.5]])],
    ['#9aa1ad', P([[0, -8], [6.5, -5.5], [6.5, 6.5], [0, 9]])],
    ['#22262e', P([[-5.6, -1.6], [5.6, -1.6], [5.6, 0.4], [-5.6, 0.4]])],
    ['#bfc5cf', P([[-0.5, 0.4], [0.5, 0.4], [0.5, 9], [-0.5, 9]])],
    ['#22262e', P([[-3.5, 3.5], [-2.5, 3.5], [-2.5, 4.5], [-3.5, 4.5]])],
    ['#22262e', P([[2.5, 3.5], [3.5, 3.5], [3.5, 4.5], [2.5, 4.5]])],
  ],
  // A golem of ice blocks.
  frost_golem: [
    ['#a8ddf4', P([[-9.8, -0.5], [-7, -1.2], [-7, 6], [-9.8, 5]])],
    ['#5aa6d0', P([[7, -1.2], [9.8, -0.5], [9.8, 5], [7, 6]])],
    ['#d9f3ff', P([[-7, -1.5], [0, -2], [0, 10], [-6, 10]])],
    ['#8fd0f0', P([[0, -2], [7, -1.5], [6, 10], [0, 10]])],
    ['#eefaff', P([[-4, -9], [0, -9.5], [0, -2.5], [-4.2, -2.5]])],
    ['#a8ddf4', P([[0, -9.5], [4, -9], [4.2, -2.5], [0, -2.5]])],
    ['#1d4f7a', P([[-2.8, -6.6], [-1.2, -6.6], [-1.2, -5.4], [-2.8, -5.4]])],
    ['#1d4f7a', P([[1.2, -6.6], [2.8, -6.6], [2.8, -5.4], [1.2, -5.4]])],
    ['#ffffff', P([[-5.5, 1], [-3, 0.5], [-4.5, 4]])],
  ],
  // A griffin's eagle head over a raised wing.
  storm_griffin: [
    ['#b3a3c4', P([[-0.5, 1], [9.8, -9.5], [8, 1], [3.5, 6]])],
    ['#7d6d90', P([[3.5, 6], [8, 1], [9.5, 4], [5.5, 8]])],
    ['#a0805a', P([[-3.5, 1], [0.5, 3.5], [3.5, 6], [2.5, 10], [-4.5, 10]])],
    ['#f6f2e8', P([[-4.5, -6], [1.5, -7.5], [3, -1], [-0.5, 3.5], [-3.5, 1]])],
    ['#cfc6b2', P([[1.5, -7.5], [4.5, -3], [3, -1]])],
    ['#f2b600', P([[-4.5, -5.5], [-9.5, -3.5], [-7.5, -0.5], [-3.5, -1]])],
    ['#b8860b', P([[-9.5, -3.5], [-9, -0.5], [-7.5, -0.5]])],
    ['#111111', P([[-2.6, -4.8], [-1.4, -4.8], [-1.4, -3.6], [-2.6, -3.6]])],
  ],
  // A sea serpent rearing out of the waves.
  sea_serpent: [
    ['#5fd0c0', P([[-6.5, 8], [-7.5, 3], [-4.5, -1], [-0.5, -3.5], [0.5, -6.5], [3.5, -5.5], [2.5, -1], [-1.5, 2], [-3, 5], [-2.5, 8]])],
    ['#1f8a7e', P([[-4.5, -1], [-6, -3.5], [-2.5, -2.5]])],
    ['#1f8a7e', P([[-0.5, -3.5], [-1.5, -7], [1, -5.5]])],
    ['#2fa89a', P([[0.5, -6.5], [4, -9], [9.5, -6.5], [8.5, -4], [3.5, -5]])],
    ['#1f8a7e', P([[3.5, -5], [8.5, -4], [6.5, -2.8]])],
    ['#111111', P([[4.4, -7.4], [5.6, -7.4], [5.6, -6.2], [4.4, -6.2]])],
    ['#3d7fbf', P([[-10, 7.5], [-6, 6], [-2, 7.5], [2, 6], [6, 7.5], [10, 6], [10, 10], [-10, 10]])],
    ['#7fb6e6', P([[-10, 7.5], [-6, 6], [-2, 7.5], [-6, 7.2]])],
    ['#7fb6e6', P([[2, 6], [6, 7.5], [2, 7.2], [-2, 7.5]])],
  ],
};

export const ICON_NAMES = Object.keys(ICONS);

const LABEL: Record<string, string> = { points: 'points', cards: 'cards', raid: 'raid', talk: 'table talk', secret: 'secret', public: 'everyone sees it', tower: 'tallest tower', territory: 'largest territory', d4: 'four-sided die', d6: 'six-sided die', d8: 'eight-sided die', d4face: 'four-sided die', d6face: 'six-sided die', d8face: 'eight-sided die',
  militia: 'Militia', archers: 'Archers', knights: 'Knights', frost_golem: 'Frost Golem', storm_griffin: 'Storm Griffin', sea_serpent: 'Sea Serpent' };

// Just the shapes, to draw an icon inside another SVG (on the -10..10 box).
export function iconShapes(name: string): string {
  return (ICONS[name] ?? []).map(([f, p]) => `<polygon fill="${f}" points="${p}"/>`).join('');
}

export function icon(name: string, size = 1.25, cls = 'ricon'): string {
  const facets = ICONS[name];
  if (!facets) return '';
  return `<svg class="${cls}" style="width:${size}em;height:${size}em" viewBox="-10 -10 20 20" role="img" aria-label="${LABEL[name] ?? name}"><title>${LABEL[name] ?? name}</title>${facets.map(([f, p]) => `<polygon fill="${f}" points="${p}"/>`).join('')}</svg>`;
}

// ---- buildings ----
// The tower and the five basic buildings, drawn as the TV board's paper models
// look from the room. How a building shows its class, here and on the board:
// it carries its class's goods (cut stone blocks for a quarry, a log pile for a
// lumber camp, violet crystals for a mine, white sheep for a pasture, a nest for
// a dragon building) in its class's paper colours. Its owner shows round it
// (the disc on the phone's map, the plate on the TV's), never on it, except the
// tower: a player's home is their colour.

const hex2rgb = (c: string) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// Lit (t > 0, toward warm paper) or shaded (t < 0, toward warm violet), as art.ts's tone().
function shade(c: string, t: number): string {
  const a = hex2rgb(c), b = hex2rgb(t >= 0 ? '#fff8ea' : '#2a1d33');
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * Math.abs(t)).toString(16).padStart(2, '0')).join('')}`;
}

// A cut stone block seen corner-on: its top lit, its left face mid, its right face shaded.
function block(cx: number, cy: number, s: number, c = '#c6cad0'): Facet[] {
  return [
    [shade(c, 0.55), P([[cx - s, cy - s * 0.5], [cx, cy - s], [cx + s, cy - s * 0.5], [cx, cy]])],
    [c, P([[cx - s, cy - s * 0.5], [cx, cy], [cx, cy + s], [cx - s, cy + s * 0.5]])],
    [shade(c, -0.3), P([[cx, cy], [cx + s, cy - s * 0.5], [cx + s, cy + s * 0.5], [cx, cy + s]])],
  ];
}

// A log lying end-on to the room: its bark running back, its cut end in front.
function log(cx: number, cy: number, r: number): Facet[] {
  const end = Array.from({ length: 6 }, (_, i) => polar(r, i * 60));
  const at = (p: [number, number], dx = 0, dy = 0): [number, number] => [cx + p[0] + dx, cy + p[1] + dy];
  return [
    ['#7f4b23', P([at(end[4]), at(end[4], 2.6, -1.6), at(end[0], 2.6, -1.6), at(end[0])])],
    ['#a0673a', P([at(end[3]), at(end[3], 2.6, -1.6), at(end[4], 2.6, -1.6), at(end[4])])],
    ['#f0cb93', P(end.map((p) => at(p)))],
    ['#c9965a', P(Array.from({ length: 6 }, (_, i) => at(polar(r * 0.42, i * 60))))],
  ];
}

// A crystal spire from its foot, leaning by `tilt` (radians): lit left, shaded right.
function spire(x: number, y: number, h: number, w: number, tilt = 0): Facet[] {
  const top: [number, number] = [x + Math.sin(tilt) * h, y - Math.cos(tilt) * h];
  const mid = (s: number): [number, number] => [x + Math.sin(tilt) * h * 0.3 + s * w * Math.cos(tilt), y - Math.cos(tilt) * h * 0.3 + s * w * Math.sin(tilt)];
  return [
    ['#e3d1ff', P([[x, y], mid(-1), top])],
    ['#8a55e0', P([[x, y], top, mid(1)])],
  ];
}

// A facet list moved and scaled, to place one drawing inside another.
const moved = (fs: Facet[], dx: number, dy: number, s = 1): Facet[] =>
  fs.map(([c, p]) => [c, p.split(' ').map((xy) => { const [x, y] = xy.split(',').map(Number); return `${+(x * s + dx).toFixed(2)},${+(y * s + dy).toFixed(2)}`; }).join(' ')]);

// The tower's roof when its owner isn't known (the Tallest Tower title).
const TOWER_ROOF = '#8d96aa';

export function buildingFacets(type: string, pc = TOWER_ROOF): Facet[] | null {
  switch (type) {
    // White walls, a band in the owner's colour, a pointed roof in it.
    case 'tower': return [
      ['#f6f0e2', P([[-5, 9.5], [-4.3, -1.2], [0, -1.2], [0, 9.5]])],
      ['#cfc6b0', P([[0, 9.5], [0, -1.2], [4.3, -1.2], [5, 9.5]])],
      ['#a39a84', P([[-4.3, -1.2], [4.3, -1.2], [4.3, 0.4], [-4.3, 0.4]])],
      [shade(pc, 0.15), P([[-4.75, 4.6], [-4.65, 3], [0, 3], [0, 4.6]])],
      [shade(pc, -0.25), P([[0, 4.6], [0, 3], [4.65, 3], [4.75, 4.6]])],
      [shade(pc, 0.2), P([[-6.4, -0.6], [0, -10], [0, -0.6]])],
      [shade(pc, -0.3), P([[0, -0.6], [0, -10], [6.4, -0.6]])],
      ['#3a302b', P([[-0.65, 0.9], [0.65, 0.9], [0.65, 2.4], [-0.65, 2.4]])],
      ['#3a302b', P([[-1.6, 9.5], [-1.6, 6.7], [0, 5.6], [1.6, 6.7], [1.6, 9.5]])],
    ];
    // Cut blocks stacked by a wooden crane.
    case 'quarry': return [
      ['#a0673a', P([[-9.8, 9.5], [-9.8, -8], [-8.3, -8], [-8.3, 9.5]])],
      ['#c48a4e', P([[-9.8, -9.4], [5, -7.6], [5, -6.3], [-9.8, -7.9]])],
      ['#3a302b', P([[3.7, -6.5], [4.3, -6.5], [4.3, -3.2], [3.7, -3.2]])],
      ...block(-2.5, 5.2, 4.2), ...block(5.6, 5.2, 4.2), ...block(1.55, 1, 4.2, '#d3d6db'),
    ];
    // A log pile under a pine.
    case 'lumber_camp': return [
      ['#5e3c22', P([[5.3, 9], [6.9, 9], [6.9, 4], [5.3, 4]])],
      ['#5f9a52', P([[6.1, -10], [1.6, -1.5], [6.1, -1.5]])],
      ['#35603a', P([[6.1, -10], [6.1, -1.5], [10, -1.5]])],
      ['#6aa85c', P([[6.1, -5.5], [0.8, 5], [6.1, 5]])],
      ['#3f6f3d', P([[6.1, -5.5], [6.1, 5], [10, 5]])],
      ...log(-6.2, 6.4, 3), ...log(0, 6.4, 3), ...log(-3.1, 1.2, 3),
    ];
    // A rock with a timbered mouth, violet crystals breaking out of its top.
    case 'crystal_mine': return [
      ...spire(-4.4, -0.2, 5.6, 1.9, -0.38), ...spire(4.3, -0.4, 6, 1.9, 0.38), ...spire(0, -1.8, 8.2, 2.3),
      ['#a1958a', P([[-9.8, 9.5], [-5.5, -0.5], [0, -2.2], [0, 9.5]])],
      ['#6e645a', P([[0, -2.2], [5.5, -0.5], [9.8, 9.5], [0, 9.5]])],
      ['#c48a4e', P([[-3.5, 9.5], [-3.5, 2.6], [3.5, 2.6], [3.5, 9.5]])],
      ['#241a33', P([[-2.1, 9.5], [-2.1, 4], [2.1, 4], [2.1, 9.5]])],
      ['#d6bfff', P([[-1.3, 9.5], [-0.3, 7.2], [0.9, 9.5]])],
    ];
    // A sheep behind a rail fence.
    case 'pasture': return [
      ...moved(ICONS.livestock, 0.6, -3.4, 1.05),
      ...[-8.8, 8.8].flatMap((x): Facet[] => [['#a0673a', P([[x - 1, 9.8], [x - 1, 3], [x + 1, 3], [x + 1, 9.8]])], ['#f0cb93', P([[x - 1, 3], [x, 2.1], [x + 1, 3]])]]),
      ['#d9a868', P([[-10, 4.4], [10, 4.4], [10, 5.8], [-10, 5.8]])],
      ['#b97a44', P([[-10, 7.6], [10, 7.6], [10, 9], [-10, 9]])],
    ];
    // A nest with a dragon's egg in it, up on a stone crag.
    case 'roost': return [
      ['#c6cad0', P([[-5.6, 10], [-4.6, 1], [0.4, 0.4], [0.6, 10]])],
      ['#8d939c', P([[0.6, 10], [0.4, 0.4], [4.6, 1], [5.6, 10]])],
      ['#5e3d22', P([[-8.6, -1.4], [-5.4, -3.6], [5.4, -3.6], [8.6, -1.4]])],
      ['#ffb08a', P([[0, -9.8], [-2.4, -8.4], [-3.4, -5.2], [-2.6, -2], [0, -1.4]])],
      ['#d9542e', P([[0, -9.8], [0, -1.4], [2.6, -2], [3.4, -5.2], [2.4, -8.4]])],
      ['#a8743e', P([[-8.6, -1.4], [8.6, -1.4], [6.2, 2.8], [-6.2, 2.8]])],
      ['#7f4b23', P([[-6.2, 2.8], [6.2, 2.8], [4.6, 4.2], [-4.6, 4.2]])],
      ['#d9a066', P([[-7.4, -0.6], [5.5, 1.2], [5.5, 1.9], [-7.4, 0.1]])],
      ['#d9a066', P([[-5.5, 2], [7.4, -0.4], [7.4, 0.3], [-5.5, 2.7]])],
    ];
  }
  return null;
}

// A building's shapes on the -10..10 box, or '' if it has no drawing of its own.
export function buildingShapes(type: string, pc?: string): string {
  return (buildingFacets(type, pc) ?? []).map(([f, p]) => `<polygon fill="${f}" points="${p}"/>`).join('');
}

// The Tallest Tower title is the tower itself, as the board shows it.
ICONS.tower = buildingFacets('tower')!;
