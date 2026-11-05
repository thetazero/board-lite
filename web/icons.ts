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
  // Combat power: a heater shield folded down the middle, a lighter rim on top.
  shield: [
    ['#8a9bb5', P([[0, -9], [-8.5, -7.5], [-8.5, 0], [-6, 5.5], [0, 10]])],
    ['#5f7190', P([[0, -9], [8.5, -7.5], [8.5, 0], [6, 5.5], [0, 10]])],
    ['#a9b8cd', P([[0, -9], [-8.5, -7.5], [-7, -6.2], [0, -7.5]])],
    ['#7a8ba6', P([[0, -9], [8.5, -7.5], [7, -6.2], [0, -7.5]])],
  ],
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
  // Titles: the tallest tower, the strongest army, the largest hoard.
  tower: [], // drawn below, as the tower building
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
  // Neutral: a plain grey paper disc, folded flat: no element.
  neutral: [
    ...bevel(8, 9, 5.5, 22.5, '#e4e0d8', '#b8b3a9', '#8a857c'),
    ['#cbc6bc', P(Array.from({ length: 8 }, (_, i) => polar(5.5, 22.5 + 45 * i)))],
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

  // ---- the fauna: wild beasts holding hexes of the map ----
  // A grey wolf's head, ears up.
  wolf_pack: [
    ['#5d626c', P([[-7.5, -9.5], [-2.5, -5], [-7.8, -2.5]])],
    ['#4a4e57', P([[7.5, -9.5], [7.8, -2.5], [2.5, -5]])],
    ['#c4c8cf', P([[-7.8, -4], [0, -6.5], [0, 9.5], [-3.2, 6.5], [-9, 0.5]])],
    ['#848a95', P([[0, -6.5], [7.8, -4], [9, 0.5], [3.2, 6.5], [0, 9.5]])],
    ['#eeece6', P([[-3, 1.5], [0, 0.5], [0, 9.5], [-2.2, 7.2]])],
    ['#cbc6ba', P([[0, 0.5], [3, 1.5], [2.2, 7.2], [0, 9.5]])],
    ['#1d1f24', P([[-1.4, 6.6], [1.4, 6.6], [0, 8.8]])],
    ['#f2c230', P([[-4.6, -1.6], [-1.8, -1], [-3.2, 0.2]])],
    ['#f2c230', P([[4.6, -1.6], [3.2, 0.2], [1.8, -1]])],
  ],
  // A brown bear's head, round-eared and broad.
  cave_bear: [
    ['#7a5234', P([[-8.5, -8], [-5.5, -9.8], [-3.2, -6.5], [-7.2, -4]])],
    ['#5e3e26', P([[8.5, -8], [7.2, -4], [3.2, -6.5], [5.5, -9.8]])],
    ['#a8774c', P([[-8.5, -5], [0, -7.8], [0, 8.5], [-5.5, 7.2], [-9.6, 1]])],
    ['#74502f', P([[0, -7.8], [8.5, -5], [9.6, 1], [5.5, 7.2], [0, 8.5]])],
    ['#dcc29a', P([[-3.6, 1], [0, -0.2], [0, 7.6], [-3, 6.2]])],
    ['#b8986c', P([[0, -0.2], [3.6, 1], [3, 6.2], [0, 7.6]])],
    ['#2a1a10', P([[-1.8, 1.2], [1.8, 1.2], [0, 3.4]])],
    ['#1a120b', P([[-4.6, -3], [-2.8, -3], [-2.8, -1.6], [-4.6, -1.6]])],
    ['#1a120b', P([[2.8, -3], [4.6, -3], [4.6, -1.6], [2.8, -1.6]])],
  ],
  // A basilisk's head in profile: a gold crown, a yellow slit eye, a forked
  // tongue. The crown is gold, not a dragon's red spines (#231).
  basilisk: [
    ['#e9b84a', P([[-3.5, -4.8], [5.5, -5.8], [5.5, -4], [-3.5, -3.2]])],
    ['#e9b84a', P([[-3.5, -4.8], [-3.2, -9.2], [-0.6, -5.1]])],
    ['#c9952f', P([[-0.6, -5.1], [1, -10], [2.6, -5.4]])],
    ['#e9b84a', P([[2.6, -5.4], [5.2, -9.2], [5.5, -5.8]])],
    ['#d23a3a', P([[-10, 1.6], [-13, 0.4], [-11, 1.9], [-13, 3.4]])],
    ['#46591b', P([[3.5, 0], [9.2, -1], [10, 10], [3, 10]])],
    ['#8aa83a', P([[-10, 0.2], [-4.5, -3.2], [6, -4], [9.2, -1], [2, 0.2]])],
    ['#d8cf8a', P([[-10, 0.2], [2, 0.2], [9.2, -1], [8, 4.2], [-2, 4.2]])],
    ['#f2d200', P([[-3.6, -2.4], [-0.4, -2.8], [-1.8, -0.8]])],
    ['#111111', P([[-2.1, -2.6], [-1.6, -2.6], [-1.8, -1.1]])],
  ],

  // ---- the great beasts ----
  // The Thunderbird, wings spread, a bolt down its breast.
  thunderbird: [
    ['#3d3f8f', P([[-1.5, -2], [-10, -7.5], [-9, -2.5], [-10, 1], [-6, 1.5], [-1.5, 3.5]])],
    ['#2e3070', P([[1.5, -2], [10, -7.5], [9, -2.5], [10, 1], [6, 1.5], [1.5, 3.5]])],
    ['#8a91e0', P([[-1.5, 0], [-7.5, -4], [-6.5, -0.5], [-1.5, 2.2]])],
    ['#6d74c4', P([[1.5, 0], [7.5, -4], [6.5, -0.5], [1.5, 2.2]])],
    ['#2e3070', P([[-2.6, 5], [0, 10], [2.6, 5]])],
    ['#3d3f8f', P([[-2.6, -3.5], [2.6, -3.5], [3, 4], [0, 8.5], [-3, 4]])],
    ['#4b4fa8', P([[-2.3, -7.8], [0, -9.5], [2.3, -7.8], [2.6, -3.5], [-2.6, -3.5]])],
    ['#ffd23f', P([[-1.1, -5.6], [1.1, -5.6], [0, -2.8]])],
    ['#fff4b8', P([[-1.9, -7.2], [-0.9, -7.2], [-0.9, -6.2], [-1.9, -6.2]])],
    ['#fff4b8', P([[0.9, -7.2], [1.9, -7.2], [1.9, -6.2], [0.9, -6.2]])],
    ['#ffd23f', P([[0.6, -1.8], [-1.6, 1.8], [0, 1.8], [-0.9, 5.6], [1.9, 1], [0.3, 1]])],
  ],
  // The Leviathan, deep blue, finned, rearing out of the waves.
  leviathan: [
    ['#7fe0d0', P([[-6.5, 2.5], [-9.5, 0.5], [-6, 0]])],
    ['#7fe0d0', P([[-3, -1.5], [-5, -5], [-1.2, -3]])],
    ['#2a7fa0', P([[-6.5, 8], [-7.5, 3], [-4.5, -1], [-0.5, -3.5], [0.5, -6.5], [3.5, -5.5], [2.5, -1], [-1.5, 2], [-3, 5], [-2.5, 8]])],
    ['#164e63', P([[-4.5, -1], [-6, -3.5], [-2.5, -2.5]])],
    ['#1f6f8b', P([[0.5, -6.5], [4, -9.5], [9.5, -6.5], [8.5, -4], [3.5, -5]])],
    ['#164e63', P([[3.5, -5], [8.5, -4], [6.5, -2.8]])],
    ['#7fe0d0', P([[1.5, -7.5], [2, -10], [4, -8.8]])],
    ['#d9fff6', P([[4.4, -7.6], [5.8, -7.6], [5.8, -6.4], [4.4, -6.4]])],
    ['#3d7fbf', P([[-10, 7.5], [-6, 6], [-2, 7.5], [2, 6], [6, 7.5], [10, 6], [10, 10], [-10, 10]])],
    ['#7fb6e6', P([[-10, 7.5], [-6, 6], [-2, 7.5], [-6, 7.2]])],
    ['#7fb6e6', P([[2, 6], [6, 7.5], [2, 7.2], [-2, 7.5]])],
  ],
};

export const ICON_NAMES = Object.keys(ICONS);

const LABEL: Record<string, string> = { points: 'points', cards: 'cards', raid: 'raid', shield: 'combat power', talk: 'table talk', secret: 'secret', public: 'everyone sees it', tower: 'tallest tower', hoard: 'largest hoard', d4: 'four-sided die', d6: 'six-sided die', d8: 'eight-sided die', d4face: 'four-sided die', d6face: 'six-sided die', d8face: 'eight-sided die',
  workshop: 'Workshop', nesting_grounds: 'Nesting Grounds', trade_charter: 'Trade Charter',
  militia: 'Militia', archers: 'Archers', knights: 'Knights', frost_golem: 'Frost Golem', storm_griffin: 'Storm Griffin', sea_serpent: 'Sea Serpent',
  wolf_pack: 'Wolf Pack', cave_bear: 'Cave Bear', basilisk: 'Basilisk', thunderbird: 'Thunderbird', leviathan: 'Leviathan' };

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
// Every building (and the tower's floors), drawn as the TV board's paper models
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

// Batch 3's class colours: clay for the hatchery, the trade buildings' red, monuments' pale stone.
const CLAY = '#c9774a';
const TRADE_RED = '#c8463d';
const MON = '#d6cfc0';

// A twig nest with three eggs, centred on (cx, cy).
// A dragon's egg standing on (cx, cy), h tall: its lit and shaded halves, as on the roost.
const EGG = (cx: number, cy: number, h: number, light: string, dark: string): Facet[] => {
  const e = (x: number, y: number): [number, number] => [cx + x * h, cy + y * h];
  return [
    [light, P([e(0, -1), e(-0.29, -0.86), e(-0.4, -0.5), e(-0.31, -0.14), e(0, 0)])],
    [dark, P([e(0, -1), e(0, 0), e(0.31, -0.14), e(0.4, -0.5), e(0.29, -0.86)])],
  ];
};

// A twig nest with three eggs, centred on (cx, cy).
const NEST = (cx: number, cy: number): Facet[] => [
  ...EGG(cx - 2.6, cy - 0.6, 4.6, '#ffb08a', '#d9542e'),
  ...EGG(cx + 2.6, cy - 0.6, 4.6, '#d6f2ff', '#5aa8e0'),
  ...EGG(cx, cy - 0.2, 5.6, '#fff1b0', '#e0b020'),
  ['#a8743e', P([[cx - 5.8, cy - 1.4], [cx + 5.8, cy - 1.4], [cx + 4.2, cy + 1.6], [cx - 4.2, cy + 1.6]])],
  ['#7f4b23', P([[cx - 4.2, cy + 1.6], [cx + 4.2, cy + 1.6], [cx + 3, cy + 2.8], [cx - 3, cy + 2.8]])],
  ['#d9a066', P([[cx - 5, cy - 0.8], [cx + 3.8, cy + 0.4], [cx + 3.8, cy + 1], [cx - 5, cy - 0.2]])],
];

// Crates of the goods (stone, timber, crystal, wool, gold in turn), each a block seen corner-on.
const GOODS_COLORS = ['#c6cad0', '#b97a44', '#b88bff', '#f4eedc', '#f5c542'];
const CRATES = (at: [number, number][], s: number, from = 0): Facet[] => at.flatMap(([x, y], i) => block(x, y, s, GOODS_COLORS[(from + i) % GOODS_COLORS.length]));

// The sea along an icon's foot.
const WAVES: Facet[] = [
  ['#3d7fbf', P([[-10, 6.5], [-6, 5], [-2, 6.5], [2, 5], [6, 6.5], [10, 5], [10, 10], [-10, 10]])],
  ['#7fb6e6', P([[-10, 6.5], [-6, 5], [-2, 6.5], [-6, 6.2]])],
  ['#7fb6e6', P([[2, 5], [6, 6.5], [2, 6.2], [-2, 6.5]])],
  ['#7fb6e6', P([[-6, 8.2], [-2, 9.2], [2, 8.2], [-2, 8.8]])],
];

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

    // ---- batch 2: the production cards, each a relative of its class's basic ----
    // A cliff face with a scaffold up it, a block on the top deck, cut blocks at its foot.
    case 'cliff_works': return [
      ['#c6cad0', P([[-10, 9.5], [-9.2, -3.5], [-6.5, -9.5], [-1, -8.2], [1, 9.5]])],
      ['#dfe2e6', P([[-9.2, -3.5], [-6.5, -9.5], [-4.6, -6.4]])],
      ['#8d939c', P([[-1, -8.2], [3, -3], [3.6, 9.5], [1, 9.5]])],
      ...[-7.6, -2.2].map((x): Facet => ['#a0673a', P([[x, 9.5], [x, -3.6], [x + 1, -3.6], [x + 1, 9.5]])]),
      ...[-3.6, 2.4].map((y): Facet => ['#c48a4e', P([[-9, y], [0, y], [0, y + 1.1], [-9, y + 1.1]])]),
      ...block(-4.4, -5.6, 1.9),
      ...block(6.6, 6.8, 2.7), ...block(6.6, 4.1, 2.7, '#d3d6db'),
    ];
    // A mason's arch of cut stone, a column being carved under it, blocks at its feet.
    case 'stonemason': return [
      ['#6b6470', P([[-3.5, -3], [3.5, -3], [3.5, 9.5], [-3.5, 9.5]])],
      ['#f3f4f6', P([[-1.4, 0.8], [0, 0.8], [0, 9.5], [-1.4, 9.5]])],
      ['#bfc4cb', P([[0, 0.8], [1.4, 0.8], [1.4, 9.5], [0, 9.5]])],
      ['#e4e6ea', P([[-2.1, -0.4], [2.1, -0.4], [2.1, 0.8], [-2.1, 0.8]])],
      ['#eef0f2', P([[-7.5, -6], [-5.5, -8], [9.5, -8], [7.5, -6]])],
      ['#8d939c', P([[7.5, -6], [9.5, -8], [9.5, 7.5], [7.5, 9.5]])],
      ['#d3d6db', P([[-7.5, 9.5], [-7.5, -6], [7.5, -6], [7.5, 9.5], [3.5, 9.5], [3.5, -1], [2, -3], [-2, -3], [-3.5, -1], [-3.5, 9.5]])],
      ['#eef0f2', P([[-1.3, -6], [1.3, -6], [1, -3], [-1, -3]])],
      ...([[-7.5, -3.5, -1.2], [-7.5, -3.5, 4], [3.5, 7.5, 1.4], [3.5, 7.5, 6.4]] as [number, number, number][]).map(([a, b, y]): Facet => ['#a9b0bb', P([[a, y], [b, y], [b, y + 0.5], [a, y + 0.5]])]),
      ...block(-6.6, 7.2, 2.6), ...block(6.8, 7.2, 2.6, '#c6cad0'),
    ];
    // A log cabin roofed in bark, an axe left in the chopping stump.
    case 'woodcutter': return [
      ...[1.5, 3.5, 5.5, 7.5].map((y, i): Facet => [i % 2 ? '#93603a' : '#b07444', P([[-9, y], [1.5, y], [1.5, y + 2], [-9, y + 2]])]),
      ...[1.5, 3.5, 5.5, 7.5].map((y): Facet => ['#f0cb93', P([[-10, y + 0.2], [-9, y + 0.2], [-9, y + 1.8], [-10, y + 1.8]])]),
      ['#3a302b', P([[-4.6, 9.5], [-4.6, 4.5], [-1.8, 4.5], [-1.8, 9.5]])],
      ['#8a5a32', P([[-8.6, -1], [-6.4, -5], [0.8, -5], [2.4, -1]])],
      ['#5e3c22', P([[-10, 2], [-8.6, -1], [2.4, -1], [3.4, 2]])],
      ['#7f4b23', P([[3.6, 9.5], [4.2, 4.6], [9.4, 4.6], [9.9, 9.5]])],
      ['#f0cb93', P([[4.2, 4.6], [5.4, 3.4], [8.2, 3.4], [9.4, 4.6], [8.2, 5.8], [5.4, 5.8]])],
      ['#c9965a', P([[6, 4.6], [6.8, 4], [7.6, 4.6], [6.8, 5.2]])],
      ['#c48a4e', P([[5.6, 4.2], [6.7, 4.4], [10, -6.2], [9, -6.6]])],
      ['#e3e6ea', P([[3.6, 4.4], [4.3, 0.8], [7.2, 2.2], [6.9, 4.4]])],
      ['#9aa1ab', P([[4.3, 0.8], [7.2, 2.2], [7.6, 1.2], [5, -0.4]])],
    ];
    // A round saw standing on its bench, a log being fed into it.
    case 'sawmill': return [
      ...moved([...star(16, 8.2, 6.6, '#c9ced6', '#8d949e'), ...bevel(16, 6.9, 2, 0, '#f3f4f6', '#d8dbe0', '#a9b0bb'),
        ['#3a302b', P(Array.from({ length: 8 }, (_, i) => polar(2, 22.5 + i * 45)))]], 1.2, -2.6),
      ['#a0673a', P([[-9, 1.4], [-0.4, 1.4], [-0.4, 5.2], [-9, 5.2]])],
      ['#c48a4e', P([[-9, 1.4], [-0.4, 1.4], [-0.4, 2.5], [-9, 2.5]])],
      ['#f0cb93', P(Array.from({ length: 6 }, (_, i) => { const [x, y] = polar(2.1, i * 60); return [x - 9, y + 3.3] as [number, number]; }))],
      ['#c9965a', P(Array.from({ length: 6 }, (_, i) => { const [x, y] = polar(0.9, i * 60); return [x - 9, y + 3.3] as [number, number]; }))],
      ['#b97a44', P([[-10, 5.2], [10, 5.2], [10, 6.8], [-10, 6.8]])],
      ...[-8.6, 7.6].map((x): Facet => ['#7f4b23', P([[x, 6.8], [x + 1.4, 6.8], [x + 1.4, 10], [x, 10]])]),
    ];
    // A log pile hauled up on the sand, an oar stood up in it, the sea below.
    case 'driftwood_yard': return [
      ['#e8d29a', P([[-10, 7], [-9.4, 1.2], [9, 0.4], [10, 6.2]])],
      ['#c48a4e', P([[6.6, 5], [7.6, 5], [8.6, -6], [7.6, -6]])],
      ['#d9a868', P([[7.6, -6], [8.6, -6], [9.4, -9.8], [7.6, -9.8], [7, -8]])],
      ...log(-5, 2.8, 2.6), ...log(0.2, 2.8, 2.6), ...log(-2.4, -1.7, 2.6),
      ['#3d7fbf', P([[-10, 6.5], [-6, 5], [-2, 6.5], [2, 5], [6, 6.5], [10, 5], [10, 10], [-10, 10]])],
      ['#7fb6e6', P([[-10, 6.5], [-6, 5], [-2, 6.5], [-6, 6.2]])],
      ['#7fb6e6', P([[2, 5], [6, 6.5], [2, 6.2], [-2, 6.5]])],
      ['#7fb6e6', P([[-6, 8.2], [-2, 9.2], [2, 8.2], [-2, 8.8]])],
    ];
    // A stone needle on stepped stones, a crystal hanging over its point.
    case 'ley_spire': return [
      ['#8f87a3', P([[-6.5, 9.5], [-5.4, 7.4], [5.4, 7.4], [6.5, 9.5]])],
      ['#a39cb5', P([[-4.2, 7.4], [-3.5, 5.8], [3.5, 5.8], [4.2, 7.4]])],
      ['#b9b2cc', P([[-2.6, 5.8], [-0.8, -2.2], [0, -2.2], [0, 5.8]])],
      ['#776f8d', P([[0, 5.8], [0, -2.2], [0.8, -2.2], [2.6, 5.8]])],
      ...moved(ICONS.crystal, 0, -6.4, 0.44),
      ['#e3d1ff', P([[-6.4, -6.6], [-5.6, -8], [-4.8, -6.6], [-5.6, -5.2]])],
      ['#c9a6ff', P([[4.8, -3.8], [5.6, -5.2], [6.4, -3.8], [5.6, -2.4]])],
      ...spire(-6.2, 7.6, 4.2, 1.4, -0.4), ...spire(6.2, 7.6, 4.6, 1.4, 0.4),
    ];
    // A grindstone in its frame, a big cut gem on the bench.
    case 'gem_cutter': return [
      ['#7f4b23', P([[-9, 5.6], [1, 5.6], [0.2, 9.5], [-8.2, 9.5]])],
      ...[-8.6, -0.4].map((x): Facet => ['#a0673a', P([[x, 9.5], [x, -1.4], [x + 1, -1.4], [x + 1, 9.5]])]),
      ...moved([...bevel(10, 5, 1.4, 0, '#e4ded2', '#b9b2a6', '#857e73'), ['#cfc8bb', P(Array.from({ length: 10 }, (_, i) => polar(1.4, i * 36)))]], -4, -1.2),
      ['#5e3c22', P(Array.from({ length: 8 }, (_, i) => { const [x, y] = polar(1.1, 22.5 + i * 45); return [x - 4, y - 1.2] as [number, number]; }))],
      ['#c48a4e', P([[0.6, 6.4], [9.9, 6.4], [9.9, 7.8], [0.6, 7.8]])],
      ...[1.4, 8.4].map((x): Facet => ['#7f4b23', P([[x, 7.8], [x + 1, 7.8], [x + 1, 10], [x, 10]])]),
      ...moved(ICONS.crystal, 5.3, 2.1, 0.55),
    ];
    // A brick kiln, its mouth glowing, its chimney smoking; a crystal comes out.
    case 'smelter': return [
      ['#9a4f31', P([[2.8, -3.6], [3, -7.6], [4.4, -7.6], [4.4, -3]])],
      ['#7d3d25', P([[4.4, -7.6], [5.8, -7.6], [5.8, -2.4], [4.4, -3]])],
      ['#ece8e0', P(Array.from({ length: 8 }, (_, i) => { const [x, y] = polar(1.4, 22.5 + i * 45); return [x + 5.4, y - 8.8] as [number, number]; }))],
      ['#dcd6cb', P(Array.from({ length: 8 }, (_, i) => { const [x, y] = polar(1.1, 22.5 + i * 45); return [x + 8, y - 9.2] as [number, number]; }))],
      [shade('#b9643f', 0.25), P([[-8.4, 9.5], [-7.4, 1.4], [-4.2, -3.4], [0, -4.6], [0, 9.5]])],
      [shade('#b9643f', -0.2), P([[0, -4.6], [4.2, -3.4], [7.4, 1.4], [8.4, 9.5], [0, 9.5]])],
      ['#ff9a3c', P([[-3, 9.5], [-3, 4.4], [0, 2.4], [3, 4.4], [3, 9.5]])],
      ['#ffd23f', P([[-1.6, 9.5], [-1.6, 5.4], [0, 4.3], [1.6, 5.4], [1.6, 9.5]])],
      ...block(-7.6, 6.8, 2.2), ...spire(7.4, 9.6, 6, 1.7, 0.2),
    ];
    // A round stone bothy under a tall straw cone, sheep in a dry-stone pen, a crook.
    case 'shepherds_fold': return [
      ['#c6cad0', P([[-9.4, 9.5], [-9.4, 0.4], [-5, 0.4], [-5, 9.5]])],
      ['#8d939c', P([[-5, 0.4], [-1.2, 0.4], [-1.2, 9.5], [-5, 9.5]])],
      ['#3a302b', P([[-6.4, 9.5], [-6.4, 5], [-4.2, 5], [-4.2, 9.5]])],
      ['#f2d27a', P([[-10, 1.2], [-5, -9.6], [-5, 1.2]])],
      ['#c49a3c', P([[-5, -9.6], [-0.2, 1.2], [-5, 1.2]])],
      ['#a0673a', P([[0.8, 9.5], [0.8, -5.6], [1.7, -5.6], [1.7, 9.5]])],
      ['#a0673a', P([[0.8, -5.6], [1.2, -8.2], [3, -9.4], [4.8, -8.4], [4.9, -6.4], [3.9, -6.4], [3.8, -7.8], [3, -8.2], [2, -7.6], [1.7, -5.6]])],
      ...moved(ICONS.livestock, 5.6, 0.6, 0.5),
      ['#dfe2e6', P([[-0.6, 6], [1.6, 3.8], [8.4, 3.8], [10, 5.4], [10, 6.6], [-0.6, 6.6]])],
      ['#b4b9c0', P([[-0.6, 6.6], [10, 6.6], [10, 9.5], [-0.6, 9.5]])],
      ...([[1.5, 7.6], [5.4, 7.6], [3.4, 8.6], [7.6, 8.6]] as [number, number][]).map(([x, y]): Facet => ['#8d939c', P([[x, y], [x + 1.6, y], [x + 1.6, y + 0.4], [x, y + 0.4]])]),
    ];
    // A big barn under a high straw roof, its doors open on sheep coming out.
    case 'drovers_barn': return [
      ['#c48a4e', P([[-8, 9.5], [-8, -0.6], [-5.6, -5], [0, -7.8], [0, 9.5]])],
      ['#a0673a', P([[0, -7.8], [5.6, -5], [8, -0.6], [8, 9.5], [0, 9.5]])],
      ['#f2d27a', P([[-9.8, 0.6], [-7, -5.8], [0, -9.8], [0, -7.6], [-5.6, -4.6], [-7.8, 0.6]])],
      ['#c49a3c', P([[0, -9.8], [7, -5.8], [9.8, 0.6], [7.8, 0.6], [5.6, -4.6], [0, -7.6]])],
      ['#3a302b', P([[-1.2, -4.4], [1.2, -4.4], [1.2, -2], [-1.2, -2]])],
      ['#3a302b', P([[-3.8, 9.5], [-3.8, 1.6], [3.8, 1.6], [3.8, 9.5]])],
      ...moved(ICONS.livestock, -5.2, 5.6, 0.46), ...moved(ICONS.livestock, 4.2, 6.2, 0.46),
    ];
    // A straw-roofed hut on stilts by the sea, fish drying on a rack.
    case 'fishery': return [
      ...[-7.6, -1.8].map((x): Facet => ['#5e3c22', P([[x, 1.6], [x + 1, 1.6], [x + 1, 8], [x, 8]])]),
      ['#d9b48a', P([[-8.4, -3.2], [0, -3.2], [0, 1.2], [-8.4, 1.2]])],
      ['#3a302b', P([[-5.4, -1.4], [-3.4, -1.4], [-3.4, 1.2], [-5.4, 1.2]])],
      ['#a0673a', P([[-9.4, 1.2], [1, 1.2], [1, 2.4], [-9.4, 2.4]])],
      ['#f2d27a', P([[-8.6, -6], [-6.6, -9.4], [-1.8, -9.4], [0.6, -6]])],
      ['#c49a3c', P([[-10, -2.6], [-8.6, -6], [0.6, -6], [2, -2.6]])],
      ...[3, 9].map((x): Facet => ['#a0673a', P([[x, 7], [x, -6.4], [x + 1, -6.4], [x + 1, 7]])]),
      ['#7f4b23', P([[2.4, -6.8], [10, -6.8], [10, -5.6], [2.4, -5.6]])],
      ...[5.2, 7.6].flatMap((x): Facet[] => [
        ['#dcebf4', P([[x, -5.6], [x - 1.3, -2.4], [x, 0.8]])],
        ['#7fa9c2', P([[x, -5.6], [x, 0.8], [x + 1.3, -2.4]])],
        ['#5f8aa5', P([[x, 0.4], [x - 1.2, 2.4], [x + 1.2, 2.4]])],
      ]),
      ['#3d7fbf', P([[-10, 6.5], [-6, 5], [-2, 6.5], [2, 5], [6, 6.5], [10, 5], [10, 10], [-10, 10]])],
      ['#7fb6e6', P([[-10, 6.5], [-6, 5], [-2, 6.5], [-6, 6.2]])],
      ['#7fb6e6', P([[2, 5], [6, 6.5], [2, 6.2], [-2, 6.5]])],
      ['#7fb6e6', P([[-6, 8.2], [-2, 9.2], [2, 8.2], [-2, 8.8]])],
    ];

    // ---- batch 3: dragon, trade and monument cards ----
    // Dragon buildings: a twig nest with eggs. Trade buildings: crates of the
    // goods under red and cream. Monuments: pale dressed stone tipped with gold.
    // A clay brooding dome with a glowing mouth, a nest of three eggs in front.
    case 'hatchery': return [
      [shade(CLAY, 0.3), P([[-9.6, 4], [-9, -2.4], [-6.4, -6.6], [-2.6, -8], [-2.6, 4]])],
      [shade(CLAY, -0.2), P([[-2.6, -8], [1.2, -6.6], [3.8, -2.4], [4.4, 4], [-2.6, 4]])],
      [shade(CLAY, -0.35), P([[-1.6, -7.8], [-1.6, -10], [0.4, -10], [0.4, -7.2]])],
      ['#ff9a3c', P([[-5.4, 4], [-5.4, 0.2], [-2.6, -1.8], [0.2, 0.2], [0.2, 4]])],
      ['#ffd23f', P([[-4, 4], [-4, 1.2], [-2.6, 0.2], [-1.2, 1.2], [-1.2, 4]])],
      ...NEST(3.6, 6.2),
    ];
    // A red-roofed warehouse on the quay, crates of the goods, a sail on the sea.
    case 'port': return [
      ['#f3ece0', P([[-9.6, 4], [-9.6, -2.8], [-1.4, -2.8], [-1.4, 4]])],
      ['#3a302b', P([[-6.6, 4], [-6.6, -0.2], [-4.4, -0.2], [-4.4, 4]])],
      [shade(TRADE_RED, 0.2), P([[-10, -2.4], [-7.4, -8], [-4, -8], [-5.6, -2.4]])],
      [shade(TRADE_RED, -0.2), P([[-5.6, -2.4], [-4, -8], [-1, -2.4]])],
      ['#a0673a', P([[-10, 4], [10, 4], [10, 5.4], [-10, 5.4]])],
      ...CRATES([[-0.2, 1.2], [3.4, 1.2], [1.6, -2.2]], 1.8),
      ['#7f4b23', P([[6.6, 4], [6.6, -9], [7.3, -9], [7.3, 4]])],
      ['#f3ece0', P([[7.3, -9], [7.3, 2.4], [10, 2.4]])],
      ['#c9bfae', P([[6.6, -8], [6.6, 2.4], [3.8, 2.4]])],
      [TRADE_RED, P([[7.3, -3.6], [7.3, -1.8], [9, -1.8], [8.4, -3.6]])],
      ...WAVES,
    ];
    // A stall under a striped awning, crates of the goods on its counter, a stack of gold.
    case 'market': return [
      ...[-8.2, 6.8].map((x): Facet => ['#7f4b23', P([[x, 9.5], [x, -3], [x + 1.4, -3], [x + 1.4, 9.5]])]),
      ...Array.from({ length: 5 }, (_, i): Facet[] => {
        const x = -9.5 + i * 3.8, c = i % 2 ? '#f3ece0' : TRADE_RED;
        return [[shade(c, 0.15), P([[x, -2.6], [x + 1.2, -8.6], [x + 5, -8.6], [x + 3.8, -2.6]])], [shade(c, -0.2), P([[x, -2.6], [x + 3.8, -2.6], [x + 1.9, -0.6]])]];
      }).flat(),
      ['#7f4b23', P([[-7, 5], [5.6, 5], [5.6, 9.5], [-7, 9.5]])],
      ['#a0673a', P([[-7.6, 3.8], [6.2, 3.8], [6.2, 5], [-7.6, 5]])],
      ...CRATES([[-4.6, 0.6], [-1, 0.6], [2.6, 0.6]], 1.7),
      ...[8.6, 7.2, 5.8, 4.4].map((y, i): Facet => [i % 2 ? '#f2c040' : '#ffe08a', P([[6.2, y], [7.1, y - 0.9], [9.5, y - 0.9], [10, y], [9.1, y + 0.9], [6.7, y + 0.9]])]),
    ];
    // An obelisk on stepped stones, its point gold.
    case 'monument': return [
      [shade(MON, -0.15), P([[-7.5, 9.5], [-6.5, 7.4], [6.5, 7.4], [7.5, 9.5]])],
      [MON, P([[-5, 7.4], [-4.2, 5.6], [4.2, 5.6], [5, 7.4]])],
      [shade(MON, 0.35), P([[-2.6, 5.6], [-1.5, -5.6], [0, -5.6], [0, 5.6]])],
      [shade(MON, -0.25), P([[0, 5.6], [0, -5.6], [1.5, -5.6], [2.6, 5.6]])],
      ['#ffe08a', P([[-1.5, -5.6], [0, -9.8], [0, -5.6]])],
      ['#d9a21e', P([[0, -9.8], [1.5, -5.6], [0, -5.6]])],
    ];
    // A trilithon carrying a gold sun, standing stones either side, a ley crystal between.
    case 'standing_stones': return [
      ...[-5, 2.6].map((x): Facet[] => [[shade(MON, 0.3), P([[x, 9.5], [x + 0.2, -3.6], [x + 1.2, -3.6], [x + 1.2, 9.5]])], [shade(MON, -0.2), P([[x + 1.2, 9.5], [x + 1.2, -3.6], [x + 2.2, -3.6], [x + 2.4, 9.5]])]]).flat(),
      [shade(MON, 0.15), P([[-6, -3.6], [-5.6, -6.6], [5.6, -6.6], [6, -3.6]])],
      [shade(MON, 0.5), P([[-6.4, -6.6], [-5.6, -7.6], [5.6, -7.6], [6.4, -6.6]])],
      ...moved([...bevel(8, 2.2, 1.2, 22.5, '#ffe9a3', '#f2c040', '#b98813'), ['#f5c542', P(Array.from({ length: 8 }, (_, i) => polar(1.2, 22.5 + 45 * i)))]], 0, -1.2),
      ...[[-9.6, 4.6], [7.2, 3.8]].map(([x, h]): Facet[] => [[shade(MON, 0.2), P([[x, 9.5], [x + 0.4, h], [x + 1.4, h - 1], [x + 1.4, 9.5]])], [shade(MON, -0.3), P([[x + 1.4, 9.5], [x + 1.4, h - 1], [x + 2.4, h], [x + 2.6, 9.5]])]]).flat(),
      ...spire(0, 9, 6, 1.6),
    ];
    // A pale tower on a rock over the sea, its gold lantern lit.
    case 'lighthouse': return [
      ['#fff1b0', P([[1.6, -6.4], [10, -9.4], [10, -3.4]])],
      ['#fff1b0', P([[-1.6, -6.4], [-10, -9.4], [-10, -3.4]])],
      [shade(MON, 0.35), P([[-3.6, 6], [-2.2, -3.6], [0, -3.6], [0, 6]])],
      [shade(MON, -0.2), P([[0, 6], [0, -3.6], [2.2, -3.6], [3.6, 6]])],
      ...[3.4, 0].map((y): Facet => [shade(MON, -0.45), P([[-3.3 + (3.4 - y) * 0.12, y], [3.3 - (3.4 - y) * 0.12, y], [3.2 - (3.4 - y) * 0.12, y - 1.2], [-3.2 + (3.4 - y) * 0.12, y - 1.2]])]),
      [shade(MON, -0.4), P([[-3, -3.6], [3, -3.6], [3, -4.6], [-3, -4.6]])],
      ['#ffd23f', P([[-1.8, -4.6], [1.8, -4.6], [1.8, -7.6], [-1.8, -7.6]])],
      ['#ffe08a', P([[-1.8, -4.6], [0, -4.6], [0, -7.6], [-1.8, -7.6]])],
      [shade(MON, -0.35), P([[-2.8, -7.6], [0, -10], [2.8, -7.6]])],
      ['#a1958a', P([[-7, 8], [-4.6, 4.4], [0, 4], [4.6, 4.4], [7, 8]])],
      ...WAVES,
    ];
    // A columned hall: a pediment over four columns, banners hung between them, a gold finial.
    case 'guildhall': return [
      [shade(MON, -0.2), P([[-9.6, 9.5], [-9, 7.6], [9, 7.6], [9.6, 9.5]])],
      [shade(MON, 0.1), P([[-8.4, 7.6], [-8.4, -1.4], [8.4, -1.4], [8.4, 7.6]])],
      ['#3a302b', P([[-1.2, 7.6], [-1.2, 2.8], [1.2, 2.8], [1.2, 7.6]])],
      ...[-7.6, -4, 2.8, 6.4].map((x): Facet[] => [[shade(MON, 0.55), P([[x, 7.6], [x, -1.4], [x + 0.6, -1.4], [x + 0.6, 7.6]])], [shade(MON, 0.15), P([[x + 0.6, 7.6], [x + 0.6, -1.4], [x + 1.2, -1.4], [x + 1.2, 7.6]])]]).flat(),
      ...([[-6.2, '#b88bff'], [-2.4, TRADE_RED], [4.6, '#f5c542']] as [number, string][]).map(([x, c]): Facet => [c, P([[x - 0.3, -0.6], [x + 1.5, -0.6], [x + 1.5, 3.8], [x + 0.6, 2.8], [x - 0.3, 3.8]])]),
      [shade(MON, -0.1), P([[-9.4, -1.4], [9.4, -1.4], [9.4, -2.8], [-9.4, -2.8]])],
      [shade(MON, 0.4), P([[-9.4, -2.8], [0, -7.6], [0, -2.8]])],
      [shade(MON, -0.15), P([[0, -7.6], [9.4, -2.8], [0, -2.8]])],
      ['#ffe08a', P([[-0.9, -7.4], [0, -10], [0, -7.4]])],
      ['#d9a21e', P([[0, -10], [0.9, -7.4], [0, -7.4]])],
    ];
    // A tower floor: the tower with a new floor lifted above it, about to go on.
    // A tower floor: the tower opened up, a new floor (banded in the owner's colour) lifted in under its roof.
    case 'tower_floor': return [
      ['#f6f0e2', P([[-4.6, 9.5], [-4.3, 3.6], [0, 3.6], [0, 9.5]])],
      ['#cfc6b0', P([[0, 9.5], [0, 3.6], [4.3, 3.6], [4.6, 9.5]])],
      ['#3a302b', P([[-1.5, 9.5], [-1.5, 6.9], [0, 5.9], [1.5, 6.9], [1.5, 9.5]])],
      ['#f6f0e2', P([[-4.3, 2.2], [-4.3, -3.6], [0, -3.6], [0, 2.2]])],
      ['#cfc6b0', P([[0, 2.2], [0, -3.6], [4.3, -3.6], [4.3, 2.2]])],
      [shade(pc, 0.15), P([[-4.3, -0.2], [-4.3, -1.8], [0, -1.8], [0, -0.2]])],
      [shade(pc, -0.25), P([[0, -0.2], [0, -1.8], [4.3, -1.8], [4.3, -0.2]])],
      ['#3a302b', P([[-0.65, 1.6], [0.65, 1.6], [0.65, 0.4], [-0.65, 0.4]])],
      [shade(pc, 0.2), P([[-6.2, -5], [0, -10], [0, -5]])],
      [shade(pc, -0.3), P([[0, -5], [0, -10], [6.2, -5]])],
      ['#ffe08a', P([[-9.6, 0.6], [-7.4, -2.6], [-5.2, 0.6]])],
      ['#ffe08a', P([[5.2, 0.6], [7.4, -2.6], [9.6, 0.6]])],
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
// The Largest Hoard title: a pile of coins, two below and one on top.
ICONS.hoard = [...moved(ICONS.gold, -4.2, 3.6, 0.62), ...moved(ICONS.gold, 4.2, 3.6, 0.62), ...moved(ICONS.gold, 0, -3.4, 0.62)];

// ---- upgrades: what each puts beside its building on the TV board ----
// A workshop's cog.
ICONS.workshop = [
  ...Array.from({ length: 8 }, (_, i): Facet => {
    const a = i * 45, lit = Math.cos(((a - 225) * Math.PI) / 180);
    return [lit > 0.4 ? '#eef1f5' : lit < -0.4 ? '#7d848e' : '#b4bac3', P([polar(9.6, a - 9), polar(9.6, a + 9), polar(6.6, a + 13), polar(6.6, a - 13)])];
  }),
  ...bevel(16, 7.2, 3.2, 0, '#eef1f5', '#c9ced6', '#8d949e'),
  ['#3a302b', P(Array.from({ length: 8 }, (_, i) => polar(3.2, 22.5 + i * 45)))],
];
// Nesting grounds' nest, with eggs in it.
ICONS.nesting_grounds = moved(NEST(0, 2.4), 0, 0, 1.55);
// A trade charter: a scroll between its rolled ends, a red wax seal.
ICONS.trade_charter = [
  ['#f3ead7', P([[-7, -6.4], [7, -6.4], [7, 6.4], [-7, 6.4]])],
  ['#ddd0b2', P([[-7, -6.4], [-7, 6.4], [-5.6, 6.4], [-5.6, -6.4]])],
  ['#e3d6b8', P([[-9, -8.6], [9, -8.6], [9, -6], [-9, -6]])],
  ['#b9a982', P([[-9, -6], [9, -6], [9, -5.2], [-9, -5.2]])],
  ['#e3d6b8', P([[-9, 6], [9, 6], [9, 8.6], [-9, 8.6]])],
  ['#b9a982', P([[-9, 8.6], [9, 8.6], [9, 9.4], [-9, 9.4]])],
  ...[-3, -0.6, 1.8].map((y): Facet => ['#8a7a66', P([[-4.4, y], [4.6, y], [4.6, y + 1], [-4.4, y + 1]])]),
  ['#e5484d', P(Array.from({ length: 8 }, (_, i) => { const [x, y] = polar(2.6, 22.5 + i * 45); return [x + 4.2, y + 3.4] as [number, number]; }))],
  ['#a33236', P(Array.from({ length: 8 }, (_, i) => { const [x, y] = polar(1.3, 22.5 + i * 45); return [x + 4.2, y + 3.4] as [number, number]; }))],
];
