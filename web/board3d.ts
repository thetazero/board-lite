// The TV's board in 3D, in folded paper: each hex is a creased sheet of coloured
// paper, laid on an open sea; buildings are folded paper models that pop up when
// they're built; dragons are origami, live at home (their tower, a roost or a
// hatchery) and now and then take off and circle it.
//
// Everything is built from a few low-poly shapes with flat shading, one paper
// grain texture and dark crease lines on the folds, so it reads as one world.
// The phone keeps the flat SVG map (common.ts): the phone stays lightweight.
//
// The clock is performance.now(), unless the page sets window.boardClock
// (seconds): the staged screenshots freeze it there and step it by hand.

import * as THREE from 'three';
import type { DragonView, HexView, PublicState } from '../src/state.ts';
import { ELEMENT_COLORS, HOLD_COLORS, PLAYER_COLORS, TERRAIN_COLORS } from './common.ts';

declare global {
  interface Window {
    boardClock?: number;
    boardFlightAt?: (frac: number) => number | null;
  }
}

const SQ3 = Math.sqrt(3);
const TILE_H = 0.07; // paper thickness of a hex
const TILE_LIFT = 0.1; // how high its folds rise to the middle
const TOP = TILE_H + TILE_LIFT * 0.6; // where things stand on a hex
const PLATE_H = 0.05;
const GROUND = TOP + PLATE_H; // where a building stands on its plate
// The camera looks down at the board from the room's side, this far above the
// table (radians; 1.13 is about 65 degrees): the owner asked for "a slight tilt"
// from top-down. Lower shows more of the models' fronts and
// sides; straight down would flatten them.
const CAMERA_TILT = 1.13;

// Paper colours. Terrain is the phone map's colours, so the two maps match.
const WALL = '#f1e8d4';
const WOOD = '#a8774b';
const WOOD_DARK = '#7a5232';
const STONE = '#a5a199';
const STONE_DARK = '#7f7b74';
const DARK = '#3a302b';
const GOLD = '#e7b43f';
const SNOW = '#fbf8f1';
const LEAF = ['#3f6f3d', '#4c7f45', '#35603a'];
const GOODS = ['#c6cad0', '#b97a44', '#b88bff', '#f5c542']; // stone, timber, crystal, gold, as in icons.ts

const clock = () => window.boardClock ?? performance.now() / 1000;

// ---------- small helpers ----------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A seeded random stream in [0, 1), so a hex looks the same every time it's drawn.
function rng(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function hexXZ(q: number, r: number): [number, number] {
  return [SQ3 * (q + r / 2), 1.5 * r];
}

const hexDist = (a: { q: number; r: number }, b: { q: number; r: number }) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

// Paper grain: soft blotches and fibres, multiplied into every colour.
function paperTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 256, 256);
  const r = rng('paper');
  for (let i = 0; i < 2200; i++) {
    const v = 205 + Math.floor(r() * 50);
    x.fillStyle = `rgba(${v},${v - 5},${v - 14},${0.3 + r() * 0.4})`;
    x.fillRect(r() * 256, r() * 256, 2 + r() * 6, 2 + r() * 6);
  }
  x.strokeStyle = 'rgba(140,120,90,.2)';
  x.lineWidth = 1.5;
  for (let i = 0; i < 220; i++) {
    const px = r() * 256, py = r() * 256, a = r() * Math.PI;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * 14, py + Math.sin(a) * 14);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let GRAIN: THREE.Texture | null = null;
// A land hex's paper: its terrain's colour, a little paled.
const tileColor = (terrain: string) => mix(TERRAIN_COLORS[terrain], '#f4ecd8', 0.12);
const MATS = new Map<string, THREE.MeshLambertMaterial>();
const CREASE = new THREE.LineBasicMaterial({ color: 0x2a1d12, transparent: true, opacity: 0.22 });

function paper(color: string, glow = 0, two = false): THREE.MeshLambertMaterial {
  const k = `${color}|${glow}|${two}`;
  let m = MATS.get(k);
  if (!m) {
    GRAIN ??= paperTexture();
    m = new THREE.MeshLambertMaterial({ color, map: GRAIN, flatShading: true, side: two ? THREE.DoubleSide : THREE.FrontSide });
    if (glow) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = glow;
    }
    MATS.set(k, m);
  }
  return m;
}

interface PartOpts { at?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] | number; glow?: number; two?: boolean; crease?: boolean }

// One folded piece of paper: a mesh with its crease lines.
function part(geo: THREE.BufferGeometry, color: string, o: PartOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, paper(color, o.glow, o.two));
  if (o.at) m.position.set(...o.at);
  if (o.rot) m.rotation.set(...o.rot);
  if (o.scale !== undefined) typeof o.scale === 'number' ? m.scale.setScalar(o.scale) : m.scale.set(...o.scale);
  m.castShadow = true;
  m.receiveShadow = true;
  if (o.crease !== false) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), CREASE));
  return m;
}

function group(...kids: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (kids.length) g.add(...kids);
  return g;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cone = (r: number, h: number, seg = 4) => new THREE.ConeGeometry(r, h, seg);
const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);

// A flat triangle fan, for wings and flags (both sides drawn).
function sheet(points: [number, number, number][], tris: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flatMap((t) => t.flatMap((i) => points[i])), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flatMap((t) => t.flatMap((i) => [points[i][0], points[i][2]])), 2));
  g.computeVertexNormals();
  return g;
}

// A hex folded from a sheet of paper: twelve facets that crease up to a peak
// in the middle and down along each corner, so the light picks out the folds.
// Its cut edges (the sides) are the paper's paler core.
function tileGeometry(): { top: THREE.BufferGeometry; sides: THREE.BufferGeometry } {
  const R = 0.965;
  const corner = (i: number, r = R) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a));
  };
  const build = (tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][]) => {
    const pos: number[] = [];
    const uv: number[] = [];
    for (const [a, b, c, out] of tris) {
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      for (const v of n.dot(out) >= 0 ? [a, b, c] : [a, c, b]) {
        pos.push(v.x, v.y, v.z);
        uv.push(v.x * 0.5 + v.y * 0.5, v.z * 0.5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  const up = new THREE.Vector3(0, 1, 0);
  const peak = new THREE.Vector3(0, TILE_H + TILE_LIFT, 0);
  const top: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  const sides: typeof top = [];
  for (let i = 0; i < 6; i++) {
    const p = corner(i).setY(TILE_H), q = corner(i + 1).setY(TILE_H);
    // Mountain folds to the middle of each edge, valley folds to the corners.
    const mid = p.clone().add(q).multiplyScalar(0.5).setY(TILE_H + TILE_LIFT * 0.45);
    top.push([peak, p, mid, up], [peak, mid, q, up]);
    const out = p.clone().add(q).setY(0).normalize();
    const pb = p.clone().setY(0), qb = q.clone().setY(0);
    sides.push([p, pb, mid, out], [mid, pb, qb, out], [mid, qb, q, out]);
  }
  return { top: build(top), sides: build(sides) };
}

// The open sea the map lies on: one flat sheet of paper far wider than the
// camera ever sees, so the water runs off every edge of the screen.
function seaGeometry(half: number): THREE.BufferGeometry {
  const pos = [-half, 0, -half, -half, 0, half, half, 0, half, -half, 0, -half, half, 0, half, half, 0, -half];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((_, i) => (i % 3 === 1 ? [] : [pos[i] * 0.6])), 2));
  g.computeVertexNormals();
  return g;
}

// Folded wave crests on a hex of sea, laid on the sea's paper.
function waveCrests(r: () => number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const crest = part(cyl(0.05, 0.05, 0.3 + r() * 0.15, 3), '#eaf4fb', { rot: [0, 0, Math.PI / 2], crease: false });
    const a = r() * Math.PI * 2, d = 0.1 + r() * 0.5;
    const holder = group(crest);
    holder.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    holder.rotation.y = r() * 0.6 - 0.3;
    g.add(holder);
  }
  return g;
}

// Merges a model's pieces into one mesh per material and one set of crease
// lines, so a busy board is a few hundred draw calls, not thousands. Pieces
// marked userData.float keep moving on their own and stay separate; with
// `joints`, so do all child groups (a dragon's moving parts), merged in place.
function bake(root: THREE.Group, joints = false): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const kept: THREE.Object3D[] = joints ? root.children.filter((c) => !(c instanceof THREE.Mesh)) : [];
  if (!joints) root.traverse((c) => c.userData.float !== undefined && kept.push(c));
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const lines: number[] = [];
  const walk = (o: THREE.Object3D) => {
    if (kept.includes(o)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (o instanceof THREE.Mesh) {
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(m);
      const list = byMat.get(o.material as THREE.Material) ?? [];
      list.push(g);
      byMat.set(o.material as THREE.Material, list);
    } else if (o instanceof THREE.LineSegments) {
      const g = o.geometry.clone().applyMatrix4(m);
      lines.push(...(g.getAttribute('position').array as Float32Array));
      g.dispose();
    }
    o.children.forEach(walk);
  };
  root.children.forEach(walk);
  if (joints) {
    // Same group, its own pieces swapped for the merged ones.
    for (const c of [...root.children]) {
      if (kept.includes(c)) continue;
      root.remove(c);
      dispose(c);
      c.removeFromParent();
    }
    for (const k of kept) bake(k as THREE.Group, true);
  } else dispose(root);
  const out = joints ? root : new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const size = name === 'uv' ? 2 : 3;
      merged.setAttribute(name, new THREE.Float32BufferAttribute(geos.flatMap((g) => Array.from((g.getAttribute(name)?.array as Float32Array | undefined) ?? new Float32Array(g.getAttribute('position').count * size))), size));
    }
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  if (lines.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    out.add(new THREE.LineSegments(g, CREASE));
  }
  if (!joints) {
    for (const k of kept) {
      // Re-parented to the merged group, where it was.
      new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld).decompose(k.position, k.quaternion, k.scale);
      out.add(k);
    }
    out.userData.floaters = kept;
  }
  return out;
}

function dispose(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.LineSegments) x.geometry.dispose();
  });
}

// ---------- terrain ----------

// Origami pine: a trunk and two folded cones.
function tree(s: number, color: string): THREE.Group {
  return groupScaled(s, [
    part(cyl(0.035, 0.045, 0.12, 4), WOOD_DARK, { at: [0, 0.06, 0], crease: false }),
    part(cone(0.2, 0.32), color, { at: [0, 0.24, 0], rot: [0, Math.PI / 4, 0] }),
    part(cone(0.14, 0.26), mix(color, '#9fc28a', 0.18), { at: [0, 0.42, 0] }),
  ]);
}

function groupScaled(s: number, kids: THREE.Object3D[]): THREE.Group {
  const g = group(...kids);
  g.scale.setScalar(s);
  return g;
}

function peak(r: number, h: number, seg: number, spin: number, snow: boolean): THREE.Group {
  const g = group(part(cone(r, h, seg), mix(STONE, '#8d8f96', 0.4), { at: [0, h / 2, 0], rot: [0, spin, 0] }));
  if (snow) {
    const f = 0.34;
    g.add(part(cone(r * f * 1.06, h * f, seg), SNOW, { at: [0, h - (h * f) / 2 + 0.005, 0], rot: [0, spin, 0] }));
  }
  return g;
}

function crystal(h: number, color = '#c3aefc'): THREE.Mesh {
  return part(new THREE.OctahedronGeometry(1, 0), color, { scale: [h * 0.32, h, h * 0.32], glow: 0.35 });
}

// Whether a hex's middle is taken, so what grows there keeps to the rim.
// The Thunderbird perches on its peak rather than hiding it.
const crowded = (h: HexView) => !!h.building || (!!h.fauna && !h.peak);

// What grows on a hex. With a building on it, only a little at the rim.
function decor(h: HexView, seaward: number): THREE.Group {
  const r = rng(h.k);
  const g = new THREE.Group();
  const built = crowded(h);
  if (h.held) g.add(hexBorder(HOLD_COLORS[h.held] ?? '#555'));
  if (h.peakZone) g.add(hexBorder(GOLD));
  // Spots around the hex: the middle is kept for a building or a beast.
  const spot = (min: number, max: number): [number, number] => {
    const a = r() * Math.PI * 2, d = min + r() * (max - min);
    return [Math.cos(a) * d, Math.sin(a) * d];
  };
  const place = (o: THREE.Object3D, [x, z]: [number, number], spin = r() * Math.PI * 2) => {
    o.position.set(x, TOP - 0.01, z);
    o.rotation.y = spin;
    g.add(o);
  };
  // Rim spots on the far side of a building, so it never hides behind them.
  const rim = (): [number, number] => {
    const a = Math.PI + 0.35 + r() * (Math.PI - 0.7);
    return [Math.cos(a) * 0.68, Math.sin(a) * 0.68];
  };
  switch (h.terrain) {
    case 'mountain':
      if (h.peak && !built) {
        // The centre peak: taller than any other, snow on top.
        place(peak(0.78, PEAK_H, 6, 0.3, true), [0, 0], 0);
        place(peak(0.28, 0.5, 5, r() * 3, false), [0.5, 0.28]);
        place(peak(0.24, 0.42, 4, r() * 3, true), [-0.5, 0.3]);
      } else if (built) {
        // Still a mountain: a snowy peak and its shoulder rise behind
        // whatever's built on it (a quarry is cut into its foot).
        place(peak(0.46, 1.05, 5, r() * 3, true), [0.16 + r() * 0.08, -0.5]);
        place(peak(0.32, 0.68, 4, r() * 3, true), [-0.44, -0.44 + r() * 0.06]);
        place(peak(0.18, 0.32, 5, r() * 3, false), [0.6, -0.12]);
      } else {
        place(peak(0.5, 0.95, 5, r() * 3, true), [r() * 0.16 - 0.08, r() * 0.16 - 0.12]);
        place(peak(0.3, 0.55, 4, r() * 3, true), [0.42, 0.3]);
        place(peak(0.26, 0.42, 5, r() * 3, false), [-0.45, 0.28]);
      }
      break;
    case 'forest': {
      const n = built ? 2 : 5;
      for (let i = 0; i < n; i++) place(tree(0.75 + r() * 0.5, LEAF[Math.floor(r() * 3)]), built ? rim() : i === 0 ? [0, 0] : spot(0.35, 0.62));
      break;
    }
    case 'meadow': {
      const n = built ? 3 : 8;
      for (let i = 0; i < n; i++) {
        const tuft = group();
        for (let j = 0; j < 3; j++) tuft.add(part(cone(0.05, 0.22 + r() * 0.08, 3), mix(TERRAIN_COLORS.meadow, '#2f5d1e', 0.35), { at: [(j - 1) * 0.055, 0.11, (r() - 0.5) * 0.04], rot: [0, 0, (j - 1) * 0.35], crease: false }));
        if (r() < 0.5) tuft.add(part(new THREE.OctahedronGeometry(0.05, 0), ['#fff7e6', '#ffd75e', '#f3a6c0'][Math.floor(r() * 3)], { at: [0, 0.27, 0], crease: false }));
        place(tuft, built ? rim() : spot(0.1, 0.7));
      }
      break;
    }
    case 'plains':
      if (!built) {
        // Folded furrows, and now and then a haystack.
        const spin = r() * Math.PI;
        const field = group();
        for (let i = -1; i <= 1; i++) field.add(part(cyl(0.06, 0.06, 0.9 - Math.abs(i) * 0.25, 3), mix(TERRAIN_COLORS.plains, '#b8913f', 0.45), { at: [0, 0.035, i * 0.2], rot: [0, 0, Math.PI / 2] }));
        place(field, [0, 0], spin);
        if (r() < 0.5) place(part(cone(0.14, 0.24, 6), '#d6ad55', { at: [0, 0.12, 0] }), spot(0.45, 0.6));
      } else if (h.building?.type !== 'tower') {
        place(part(cone(0.1, 0.17, 6), '#d6ad55', { at: [0, 0.085, 0] }), rim());
      }
      break;
    case 'ocean': {
      g.add(waveCrests(r));
      break;
    }
    case 'harbor':
      if (!built) {
        // A little jetty, pointing out to sea: somewhere a port could go.
        const jetty = group(
          part(box(0.24, 0.05, 0.9), WOOD, { at: [0, 0.08, 0.4] }),
          ...[0.05, 0.45, 0.82].flatMap((z) => [-0.1, 0.1].map((x) => part(box(0.05, 0.2, 0.05), WOOD_DARK, { at: [x, 0.02, z], crease: false }))),
          part(cyl(0.05, 0.05, 0.16, 6), WOOD_DARK, { at: [0.2, 0.13, 0.75] }),
        );
        place(jetty, [0, 0], seaward);
      }
      break;
    case 'ley': {
      const n = built ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const c = crystal(0.26 + r() * 0.2);
        c.position.y = 0.1;
        c.rotation.z = (r() - 0.5) * 0.5;
        const holder = group(c);
        holder.userData.float = r() * 6;
        place(holder, built ? rim() : i === 0 ? [0, 0] : spot(0.35, 0.6));
      }
      break;
    }
  }
  return g;
}

// ---------- buildings ----------

function flag(color: string, h: number): THREE.Group {
  return group(
    part(cyl(0.015, 0.015, h, 4), DARK, { at: [0, h / 2, 0], crease: false }),
    part(sheet([[0, 0, 0], [0.2, -0.05, 0], [0, -0.13, 0]], [[0, 1, 2]]), color, { at: [0, h, 0], two: true, crease: false }),
  );
}

// A gable roof: a three-sided prism lying along x.
function gable(w: number, d: number, h: number, color: string, y: number): THREE.Mesh {
  const geo = cyl(1, 1, w, 3);
  return part(geo, color, { at: [0, y, 0], rot: [Math.PI / 2, 0, Math.PI / 2], scale: [d / 1.7, 1, h / 1.5] });
}

function cottage(w: number, d: number, h: number, wall: string, roof: string): THREE.Group {
  const roofH = h * 0.75;
  const g = group(part(box(w, h, d), wall, { at: [0, h / 2, 0] }));
  const r = gable(w * 1.12, d * 1.25, roofH, roof, h + roofH * 0.25);
  g.add(r);
  g.add(part(box(w * 0.22, h * 0.6, 0.02), DARK, { at: [0, h * 0.3, d / 2 + 0.005], crease: false }));
  return g;
}

function tower(pc: string, floors: number): THREE.Group {
  const g = new THREE.Group();
  const base = 0.85, step = 0.3;
  const h = base + step * floors;
  g.add(part(cyl(0.3, 0.36, h, 6), WALL, { at: [0, h / 2, 0] }));
  // A band for each floor, so the floors can be counted.
  for (let i = 0; i <= floors; i++) g.add(part(cyl(0.335, 0.335, 0.045, 6), i === 0 ? STONE : pc, { at: [0, base * 0.5 + i * step + (i ? base * 0.5 - step * 0.5 : 0), 0] }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    g.add(part(box(0.1, 0.1, 0.08), WALL, { at: [Math.sin(a) * 0.29, h + 0.05, Math.cos(a) * 0.29], rot: [0, a, 0] }));
  }
  g.add(part(cone(0.4, 0.62, 6), pc, { at: [0, h + 0.31 + 0.04, 0] }));
  const f = flag(pc, 0.35);
  f.position.y = h + 0.6;
  g.add(f);
  // Door and windows face the room.
  g.add(part(box(0.13, 0.22, 0.02), DARK, { at: [0, 0.11, 0.315], crease: false }));
  for (let i = 0; i <= floors; i++) g.add(part(box(0.06, 0.1, 0.02), DARK, { at: [0, base * 0.62 + i * step, 0.3], crease: false }));
  return g;
}

// How a building shows its class: it carries its class's goods (cut stone
// blocks, a log pile, violet crystals, white sheep, a dragon's nest) in its
// class's paper colours, the same as its icon (icons.ts). Its owner is the
// border round it, never its own paper, except the tower. Buildings of one
// class are relatives: different structures carrying the same goods.
const STONE_BLOCK = '#d3d6db';
const CRYSTAL = '#b98cff';
const PINE = '#4c8a46';
const STRAW = '#e9c46a';

// A cut stone block.
const stoneBlock = (s: number, at: [number, number, number], spin = 0, c = STONE_BLOCK) => part(box(s, s * 0.8, s), c, { at, rot: [0, spin, 0] });

// Cut blocks stacked in steps by a tall wooden crane, a block on its rope.
function quarry(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.DodecahedronGeometry(0.34, 0), STONE_DARK, { at: [-0.3, 0.12, -0.38], scale: [1.2, 0.7, 0.7] }));
  const s = 0.21;
  const steps: [number, number, number][] = [
    [-0.12, 0, 0.12], [0.11, 0, 0.12], [0.34, 0, 0.12], [0.0, 0, -0.12], [0.23, 0, -0.12],
    [0, 1, 0.02], [0.23, 1, 0.02], [0.12, 2, 0],
  ];
  for (const [x, lvl, z] of steps) g.add(stoneBlock(s, [x, s * 0.4 + lvl * s * 0.8, z], (x * 7) % 0.2, lvl === 2 ? '#e4e6ea' : STONE_BLOCK));
  // The crane: a mast, its boom out over the stack, a rope and a block hanging.
  g.add(part(box(0.06, 1.05, 0.06), WOOD, { at: [-0.42, 0.52, 0.18] }));
  g.add(part(box(0.06, 0.4, 0.04), WOOD_DARK, { at: [-0.32, 0.18, 0.18], rot: [0, 0, -0.5] }));
  g.add(part(box(0.78, 0.05, 0.05), WOOD, { at: [-0.06, 0.98, 0.18], rot: [0, 0, -0.12] }));
  g.add(part(box(0.012, 0.3, 0.012), DARK, { at: [0.28, 0.78, 0.18], crease: false }));
  g.add(stoneBlock(0.14, [0.28, 0.6, 0.18]));
  return g;
}

// A log, lying along x, its cut ends pale.
function timberLog(len: number, r: number, at: [number, number, number], spin = 0): THREE.Group {
  const g = group(part(cyl(r, r, len, 6), WOOD, { rot: [0, 0, Math.PI / 2] }));
  for (const sx of [-1, 1]) g.add(part(cyl(r * 0.92, r * 0.92, 0.012, 6), '#f0cb93', { at: [sx * len / 2, 0, 0], rot: [0, 0, Math.PI / 2], crease: false }));
  g.position.set(...at);
  g.rotation.y = spin;
  return g;
}

// A log pile in front of a pine-roofed hut, under tall pines.
function lumberCamp(): THREE.Group {
  const g = new THREE.Group();
  const c = cottage(0.4, 0.32, 0.26, mix(WOOD, WALL, 0.35), PINE);
  c.position.set(-0.2, 0, -0.26);
  g.add(c);
  // Logs end-on to the room, so their pale cut ends show, as on the icon.
  const r = 0.09, len = 0.42;
  const pile: [number, number][] = [[-0.18, 0], [0, 0], [0.18, 0], [-0.09, 1], [0.09, 1], [0, 2]];
  for (const [x, lvl] of pile) g.add(timberLog(len, r, [0.12 + x, r + lvl * r * 1.7, 0.22], Math.PI / 2));
  for (const [x, z, s] of [[0.42, -0.25, 1.5], [0.2, -0.48, 1.15], [-0.5, 0.15, 1.05]] as [number, number, number][]) {
    const t = tree(s, PINE);
    t.position.set(x, 0, z);
    g.add(t);
  }
  return g;
}

// A rock with a timbered mouth, big violet crystals breaking out of its top,
// and a cart of them on the way out.
function crystalMine(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.DodecahedronGeometry(0.45, 0), '#8c8073', { at: [0, 0.12, -0.1], scale: [1.1, 0.75, 0.9] }));
  g.add(part(box(0.22, 0.24, 0.05), DARK, { at: [0, 0.12, 0.33], crease: false }));
  g.add(part(box(0.04, 0.28, 0.06), WOOD, { at: [-0.13, 0.14, 0.35] }));
  g.add(part(box(0.04, 0.28, 0.06), WOOD, { at: [0.13, 0.14, 0.35] }));
  g.add(part(box(0.32, 0.05, 0.07), WOOD, { at: [0, 0.29, 0.35] }));
  for (const [x, z, h, tilt, lean] of [[0, -0.12, 0.62, 0, 0], [-0.24, -0.05, 0.42, -0.45, 0.1], [0.24, -0.02, 0.46, 0.45, -0.1], [0.05, -0.35, 0.36, 0.1, -0.4]]) {
    const c = crystal(h, CRYSTAL);
    c.position.set(x, 0.38 + h * 0.55, z);
    c.rotation.set(lean, 0, tilt);
    g.add(c);
  }
  const cart = group(part(box(0.2, 0.1, 0.14), WOOD_DARK, { at: [0, 0.08, 0] }));
  for (const [x, h] of [[-0.04, 0.12], [0.05, 0.1]]) {
    const c = crystal(h, CRYSTAL);
    c.position.set(x, 0.15 + h * 0.4, 0);
    cart.add(c);
  }
  cart.position.set(0.4, 0, 0.32);
  cart.rotation.y = 0.5;
  g.add(cart);
  return g;
}

function sheep(): THREE.Group {
  return group(
    part(new THREE.DodecahedronGeometry(0.1, 0), '#fbf7ee', { scale: [1.3, 0.95, 1], at: [0, 0.12, 0] }),
    part(box(0.07, 0.07, 0.09), DARK, { at: [0.15, 0.15, 0], crease: false }),
    ...[[-0.06, -0.05], [-0.06, 0.05], [0.07, -0.05], [0.07, 0.05]].map(([x, z]) => part(box(0.025, 0.08, 0.025), DARK, { at: [x, 0.04, z], crease: false })),
  );
}

// Big white sheep in a rail fence, a straw-roofed shed and a haystack.
function pasture(): THREE.Group {
  const g = new THREE.Group();
  const n = 12, R = 0.66;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    g.add(part(box(0.045, 0.22, 0.045), WOOD, { at: [Math.cos(a) * R, 0.11, Math.sin(a) * R] }));
    if (i % 6 === 2) continue; // a gate
    const mx = (Math.cos(a) + Math.cos(b)) / 2 * R, mz = (Math.sin(a) + Math.sin(b)) / 2 * R;
    const len = 2 * R * Math.sin(Math.PI / n);
    for (const y of [0.09, 0.17]) g.add(part(box(len, 0.03, 0.02), mix(WOOD, WALL, 0.3), { at: [mx, y, mz], rot: [0, -(a + b) / 2 + Math.PI / 2, 0], crease: false }));
  }
  const shed = cottage(0.32, 0.24, 0.2, WALL, STRAW);
  shed.position.set(-0.22, 0, -0.34);
  g.add(shed);
  g.add(part(cone(0.15, 0.26, 6), STRAW, { at: [0.3, 0.13, -0.32] }));
  for (const [x, z, a] of [[0.2, 0.18, 0.6], [-0.24, 0.2, 2.4], [0.34, -0.06, -1], [-0.02, -0.02, 1.9]]) {
    const s = sheep();
    s.scale.setScalar(1.45);
    s.position.set(x, 0, z);
    s.rotation.y = a;
    g.add(s);
  }
  return g;
}

// A stone crag with a big twig nest on its flat top, where the dragons sit.
const ROOST_TOP = 0.5;
function roost(): THREE.Group {
  const g = group(
    part(cyl(0.44, 0.6, ROOST_TOP - 0.06, 7), STONE, { at: [0, (ROOST_TOP - 0.06) / 2, 0], rot: [0, 0.3, 0] }),
    part(new THREE.DodecahedronGeometry(0.2, 0), STONE_DARK, { at: [0.45, 0.1, 0.25], scale: [1, 0.7, 1] }),
    part(new THREE.DodecahedronGeometry(0.16, 0), STONE_DARK, { at: [-0.5, 0.08, -0.2], scale: [1, 0.8, 1] }),
    part(cyl(0.5, 0.44, 0.06, 7), mix(STONE, WALL, 0.3), { at: [0, ROOST_TOP - 0.03, 0], rot: [0, 0.3, 0] }),
    part(cyl(0.4, 0.36, 0.05, 9), '#a8743e', { at: [0, ROOST_TOP + 0.01, 0], crease: false }),
    part(new THREE.TorusGeometry(0.42, 0.09, 3, 9), WOOD_DARK, { at: [0, ROOST_TOP + 0.03, 0], rot: [Math.PI / 2, 0, 0] }),
    part(new THREE.TorusGeometry(0.47, 0.035, 3, 11), '#a8743e', { at: [0, ROOST_TOP + 0.08, 0], rot: [Math.PI / 2, 0, 0.4], crease: false }),
  );
  // Twigs sticking out of the nest.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    g.add(part(box(0.22, 0.02, 0.02), '#c48a52', { at: [Math.cos(a) * 0.5, ROOST_TOP + 0.06, Math.sin(a) * 0.5], rot: [0, -a + 0.6, 0.3], crease: false }));
  }
  return g;
}

// ---------- the fauna ----------

// A beast's lair: a dark, torn paper scrap under it with a pale edge, so the
// beast stands out from any terrain (grey wolves on grey mountains) and from
// the plate of a building it sits on.
const LAIR = '#2b2420', LAIR_EDGE = '#efe5cf';
function lair(r: number): THREE.Group {
  return group(
    part(cyl(r, r, 0.016, 7), LAIR_EDGE, { at: [0, 0.008, 0], rot: [0, 0.2, 0], crease: false }),
    part(cyl(r * 0.88, r * 0.88, 0.03, 7), LAIR, { at: [0, 0.015, 0], rot: [0, 0.6, 0] }),
  );
}

// A building's paper gone dull grey: what a shut-down building is made of.
const SHUT = new Map<THREE.Material, THREE.MeshLambertMaterial>();
function shutPaper(m: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  let s = SHUT.get(m);
  if (!s) {
    const c = m.color.clone();
    const grey = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    s = m.clone();
    s.color = new THREE.Color(grey, grey, grey).multiplyScalar(0.8).lerp(new THREE.Color('#4d4843'), 0.5);
    s.emissiveIntensity = 0;
    SHUT.set(m, s);
  }
  return s;
}
// Wild beasts holding hexes, folded like everything else: chunky shapes that
// read from the TV's tilted camera. Each faces +x; the board turns it.
//
// Each is rigged like a dragon: a head, a tail, legs or wings on joints the
// board moves (animateBeast), so a beast looks about, breathes and walks
// rather than turning on the spot as one piece.

// A joint at `pivot`, holding parts placed where they'd be without it.
function joint(pivot: [number, number, number], ...parts: THREE.Object3D[]): THREE.Group {
  const j = new THREE.Group();
  j.position.set(...pivot);
  for (const p of parts) {
    p.position.sub(j.position);
    j.add(p);
  }
  j.userData.base = j.position.clone();
  return j;
}

interface BeastRig {
  kind: 'wolf' | 'bear' | 'basilisk' | 'thunderbird' | 'leviathan';
  body: THREE.Group; // the whole animal, for breathing and the gait's bob
  head: THREE.Group; // the head, or the neck the head is on
  tail?: THREE.Group;
  legs?: THREE.Group[]; // front left, front right, back left, back right
  wings?: THREE.Group[]; // left, right
  coils?: THREE.Group[]; // the Leviathan's coils, head end first
  phase: number;
}

const WOLF = '#9aa0a8', WOLF_DARK = '#5d626c', WOLF_LIGHT = '#e4e1da';
// One wolf, side-on: long legs, a raised head with a pointed snout and two
// upright ears, and a bushy tail hanging down behind. (Three small wolves
// with tails curled up over their backs read as a scorpion on the TV, #241.)
function wolf(phase: number): BeastRig {
  const head = joint([0.2, 0.38, 0],
    part(box(0.15, 0.13, 0.16), WOLF, { at: [0.28, 0.45, 0], rot: [0, 0, 0.1] }),
    part(cone(0.055, 0.2, 4), WOLF_LIGHT, { at: [0.44, 0.42, 0], rot: [Math.PI / 4, 0, -Math.PI / 2 - 0.15] }),
    part(box(0.04, 0.04, 0.045), DARK, { at: [0.54, 0.4, 0], crease: false }),
    part(cone(0.05, 0.15, 3), WOLF_DARK, { at: [0.25, 0.57, 0.06], rot: [0.35, 0, 0.15] }),
    part(cone(0.05, 0.15, 3), WOLF_DARK, { at: [0.25, 0.57, -0.06], rot: [-0.35, 0, 0.15] }),
    part(box(0.03, 0.025, 0.03), '#f2c230', { at: [0.35, 0.48, 0.065], glow: 0.6, crease: false }),
    part(box(0.03, 0.025, 0.03), '#f2c230', { at: [0.35, 0.48, -0.065], glow: 0.6, crease: false }),
  );
  // Long and bushy, out behind and sloping down from the rump.
  const tail = joint([-0.21, 0.34, 0],
    part(new THREE.DodecahedronGeometry(0.065, 0), WOLF_DARK, { at: [-0.37, 0.25, 0], rot: [0, 0, 0.5], scale: [2.8, 1, 1] }),
  );
  const legs = [[0.15, 0.05], [0.15, -0.05], [-0.15, 0.05], [-0.15, -0.05]].map(([x, z]) =>
    joint([x, 0.26, z], part(box(0.05, 0.26, 0.05), WOLF_DARK, { at: [x, 0.13, z], crease: false })));
  const body = group(
    part(box(0.42, 0.14, 0.12), WOLF, { at: [-0.02, 0.32, 0] }),
    // The ruff: a pale, deeper chest at the front.
    part(box(0.14, 0.2, 0.16), WOLF_LIGHT, { at: [0.14, 0.33, 0], rot: [0, 0, 0.2] }),
    head, tail, ...legs,
  );
  return { kind: 'wolf', body, head, tail, legs, phase };
}

// The Wolf Pack: one wolf, big enough to read from the TV.
function wolfPack(): THREE.Group {
  const w = wolf(0);
  const big = group(w.body);
  big.scale.setScalar(1.25); // the board sets the outer group's scale
  const g = group(big);
  g.userData.rigs = [w];
  return g;
}

const BEAR = '#8a5a36', BEAR_DARK = '#5e3e26', BEAR_LIGHT = '#d8bc92';
function caveBear(): THREE.Group {
  const head = joint([0.22, 0.36, 0],
    part(new THREE.DodecahedronGeometry(0.16, 0), BEAR, { at: [0.33, 0.38, 0] }),
    part(box(0.14, 0.1, 0.12), BEAR_LIGHT, { at: [0.47, 0.34, 0] }),
    part(box(0.05, 0.04, 0.06), DARK, { at: [0.55, 0.37, 0], crease: false }),
    part(new THREE.DodecahedronGeometry(0.055, 0), BEAR_DARK, { at: [0.3, 0.53, 0.1] }),
    part(new THREE.DodecahedronGeometry(0.055, 0), BEAR_DARK, { at: [0.3, 0.53, -0.1] }),
  );
  const legs = [[0.2, 0.13], [0.2, -0.13], [-0.25, 0.13], [-0.25, -0.13]].map(([x, z]) => joint([x, 0.2, z], part(cyl(0.065, 0.075, 0.2, 5), BEAR_DARK, { at: [x, 0.1, z] })));
  const body = group(part(new THREE.DodecahedronGeometry(0.24, 0), BEAR, { at: [-0.04, 0.3, 0], scale: [1.5, 1.05, 1.1] }), head, ...legs);
  const g = group(body);
  g.userData.rigs = [{ kind: 'bear', body, head, legs, phase: 0 } satisfies BeastRig];
  return g;
}

// The Basilisk, king of serpents: a long snake, coiled flat on the ground,
// its head raised a little and crowned in gold, a forked tongue out. No
// wings, no legs, no spines down its back, so it never reads as a dragon
// (#231).
const SCALE_GREEN = '#6f8a2c', SCALE_DARK = '#46591b', BELLY = '#d8cf8a', CROWN = '#e9b84a';
function basilisk(): THREE.Group {
  // The neck rises low from the front of the coil, the head flat and wedge-shaped.
  const neck = joint([0.14, 0.1, 0],
    part(cyl(0.055, 0.075, 0.3, 5), SCALE_GREEN, { at: [0.22, 0.22, 0], rot: [0, 0, -0.7] }),
    part(box(0.2, 0.07, 0.14), SCALE_GREEN, { at: [0.37, 0.33, 0], rot: [0, 0, -0.05] }),
    part(cone(0.07, 0.12, 4), SCALE_DARK, { at: [0.5, 0.32, 0], rot: [Math.PI / 4, 0, -Math.PI / 2], scale: [1, 1, 0.6] }),
    part(box(0.16, 0.025, 0.1), BELLY, { at: [0.38, 0.29, 0], crease: false }),
    part(box(0.03, 0.025, 0.03), '#f2d200', { at: [0.42, 0.36, 0.07], glow: 0.8, crease: false }),
    part(box(0.03, 0.025, 0.03), '#f2d200', { at: [0.42, 0.36, -0.07], glow: 0.8, crease: false }),
    // The crown: a gold band with five points.
    part(cyl(0.065, 0.065, 0.035, 6), CROWN, { at: [0.33, 0.385, 0], glow: 0.2, crease: false }),
    ...[0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2;
      return part(cone(0.02, 0.07, 3), CROWN, { at: [0.33 + Math.cos(a) * 0.05, 0.435, Math.sin(a) * 0.05], glow: 0.2, crease: false });
    }),
    // The forked tongue.
    part(box(0.07, 0.008, 0.012), '#d23a3a', { at: [0.6, 0.31, 0.012], rot: [0, 0.3, 0], crease: false }),
    part(box(0.07, 0.008, 0.012), '#d23a3a', { at: [0.6, 0.31, -0.012], rot: [0, -0.3, 0], crease: false }),
  );
  // Three coils on the ground, the tail tapering out of the last.
  const body = group(
    part(new THREE.TorusGeometry(0.28, 0.07, 4, 12, Math.PI * 1.8), SCALE_DARK, { at: [-0.06, 0.07, 0], rot: [Math.PI / 2, 0, 0.6] }),
    part(new THREE.TorusGeometry(0.18, 0.065, 4, 10, Math.PI * 1.8), SCALE_GREEN, { at: [-0.06, 0.15, 0], rot: [Math.PI / 2, 0, 2.4] }),
    part(new THREE.TorusGeometry(0.09, 0.055, 4, 8, Math.PI * 1.6), SCALE_DARK, { at: [-0.06, 0.22, 0], rot: [Math.PI / 2, 0, 4.1] }),
    part(cone(0.05, 0.22, 4), SCALE_DARK, { at: [-0.3, 0.05, -0.28], rot: [Math.PI / 2, 0, 0.9] }),
    neck,
  );
  const g = group(body);
  g.userData.rigs = [{ kind: 'basilisk', body, head: neck, phase: 0 } satisfies BeastRig];
  return g;
}

// ---------- the great beasts ----------
// Bigger than any fauna: the Thunderbird perched on the centre peak, wings
// half raised, lightning down its feathers; the Leviathan's coils breaking
// the sea beside a harbor.

const STORM = '#3d3f8f', STORM_LIGHT = '#8a91e0', BOLT = '#ffd23f';
function thunderbird(): THREE.Group {
  const head = joint([0.3, 0.44, 0],
    part(new THREE.DodecahedronGeometry(0.12, 0), STORM, { at: [0.36, 0.52, 0] }),
    part(cone(0.06, 0.2, 4), BOLT, { at: [0.52, 0.5, 0], rot: [Math.PI / 4, 0, -Math.PI / 2 - 0.25] }),
    part(box(0.03, 0.03, 0.03), '#fff4b8', { at: [0.42, 0.57, 0.08], glow: 0.9, crease: false }),
    part(box(0.03, 0.03, 0.03), '#fff4b8', { at: [0.42, 0.57, -0.08], glow: 0.9, crease: false }),
    // A crest of three folded feathers.
    ...[0, 1, 2].map((i) => part(cone(0.035, 0.18, 3), STORM_LIGHT, { at: [0.3 - i * 0.06, 0.66, 0], rot: [0, 0, 0.5 + i * 0.25], crease: false })),
  );
  // The tail fan, down and back.
  const tail = joint([-0.2, 0.28, 0], part(cone(0.16, 0.42, 3), STORM, { at: [-0.4, 0.22, 0], rot: [0, 0, 1.9], scale: [1, 1, 0.3] }));
  // The wings: raised in a wide V, each a folded fan with a bolt down it.
  const wings = [1, -1].map((side) => {
    const wing = group(
      part(cone(0.2, 0.85, 3), STORM, { at: [0, 0.42, 0], scale: [1, 1, 0.22] }),
      part(cone(0.12, 0.6, 3), STORM_LIGHT, { at: [0.05, 0.36, 0.02], scale: [1, 1, 0.2] }),
      part(box(0.04, 0.16, 0.02), BOLT, { at: [0.02, 0.5, 0.04], rot: [0, 0, 0.5], glow: 0.5, crease: false }),
      part(box(0.04, 0.16, 0.02), BOLT, { at: [0.02, 0.36, 0.04], rot: [0, 0, -0.5], glow: 0.5, crease: false }),
    );
    wing.position.set(-0.02, 0.36, side * 0.14);
    wing.rotation.set(side * -0.95, 0, 0.25);
    wing.userData.side = side;
    return wing;
  });
  const body = group(
    part(new THREE.DodecahedronGeometry(0.22, 0), STORM, { at: [0, 0.3, 0], scale: [1.5, 1.1, 1] }),
    part(new THREE.DodecahedronGeometry(0.14, 0), STORM_LIGHT, { at: [0.18, 0.3, 0], scale: [1, 1.2, 1.2] }),
    // Talons gripping the rock.
    part(box(0.06, 0.12, 0.04), BOLT, { at: [0.05, 0.08, 0.08], crease: false }),
    part(box(0.06, 0.12, 0.04), BOLT, { at: [0.05, 0.08, -0.08], crease: false }),
    head, tail, ...wings,
  );
  const g = group(body);
  g.userData.rigs = [{ kind: 'thunderbird', body, head, tail, wings, phase: 0 } satisfies BeastRig];
  return g;
}

const DEEP = '#1f6f8b', DEEP_DARK = '#164e63', FIN = '#7fe0d0';
const fin = (x: number, y: number, h: number) => part(cone(0.05, h, 3), FIN, { at: [x, y + h / 2, 0], rot: [0, 0, 0.45], scale: [1, 1, 0.35] });
function leviathan(): THREE.Group {
  // The neck rearing up, the head looking out, fins down its back.
  const neck = joint([0.14, -0.02, 0],
    part(cyl(0.07, 0.1, 0.62, 6), DEEP, { at: [0.22, 0.28, 0], rot: [0, 0, -0.25] }),
    part(box(0.3, 0.13, 0.17), DEEP, { at: [0.36, 0.6, 0], rot: [0, 0, -0.2] }),
    part(cone(0.08, 0.2, 4), DEEP_DARK, { at: [0.56, 0.55, 0], rot: [Math.PI / 4, 0, -Math.PI / 2 - 0.2] }),
    part(box(0.03, 0.03, 0.03), '#d9fff6', { at: [0.42, 0.65, 0.09], glow: 0.9, crease: false }),
    part(box(0.03, 0.03, 0.03), '#d9fff6', { at: [0.42, 0.65, -0.09], glow: 0.9, crease: false }),
    fin(0.3, 0.72, 0.16), fin(0.2, 0.52, 0.14), fin(0.13, 0.32, 0.12),
  );
  // Coils breaking the water, smaller towards the tail.
  const coils = [
    joint([-0.18, 0, 0], part(new THREE.TorusGeometry(0.2, 0.08, 4, 9, Math.PI), DEEP, { at: [-0.18, 0, 0] }), fin(-0.18, 0.28, 0.13)),
    joint([-0.62, 0, 0.05],
      part(new THREE.TorusGeometry(0.14, 0.065, 4, 8, Math.PI), DEEP_DARK, { at: [-0.62, 0, 0.05] }),
      part(cone(0.06, 0.26, 3), DEEP_DARK, { at: [-0.9, 0.08, 0.05], rot: [0, 0, 1.2], scale: [1, 1, 0.4] }),
      fin(-0.62, 0.2, 0.1)),
  ];
  const body = group(neck, ...coils);
  const g = group(body);
  g.userData.rigs = [{ kind: 'leviathan', body, head: neck, coils, phase: 0 } satisfies BeastRig];
  return g;
}

const PEAK_H = 1.5; // the centre peak's height: the Thunderbird perches on top

function beastModel(key: string): THREE.Group {
  return key === 'wolf_pack' ? wolfPack() : key === 'cave_bear' ? caveBear() : key === 'thunderbird' ? thunderbird() : key === 'leviathan' ? leviathan() : basilisk();
}

// A beast's joints at time t (seconds). `gait` is how far into walking it is
// (0 standing, 1 in full stride) and `stride` the walk's own clock.
//
// Wolves look about, sniff the ground and wag their tails, and trot; the bear
// breathes heavily and swings its low head, and lumbers; the basilisk's neck
// weaves like a snake's, and it slithers; the Thunderbird turns its head in
// a bird's quick jerks and now and then mantles its wings; the Leviathan's
// coils roll through the water one after the other.
function animateBeast(r: BeastRig, t: number, gait: number, stride: number) {
  const ph = r.phase;
  const lerp = (a: number, b: number) => a + (b - a) * gait;
  const base = (j: THREE.Group) => j.userData.base as THREE.Vector3;
  if (r.kind === 'wolf') {
    const look = Math.sin(t * 0.4 + ph) * 0.45 + Math.sin(t * 0.17 + ph * 2) * 0.2;
    const sniff = smooth(0.75, 0.95, Math.sin(t * 0.29 + ph * 1.7));
    const w = stride * 11 + ph;
    r.head.rotation.set(0, lerp(look * (1 - sniff * 0.6), 0), lerp(-0.45 * sniff, Math.sin(w * 2) * 0.05));
    r.tail!.rotation.set(0, lerp(Math.sin(t * 1.7 + ph) * 0.28, Math.sin(w) * 0.15), lerp(0, 0.25));
    r.legs!.forEach((l, i) => (l.rotation.z = (i === 0 || i === 3 ? 1 : -1) * Math.sin(w) * 0.6 * gait));
    r.body.position.y = Math.abs(Math.sin(w)) * 0.025 * gait;
    r.body.scale.y = 1 + Math.sin(t * 2.2 + ph) * 0.015 * (1 - gait);
  } else if (r.kind === 'bear') {
    const sway = Math.sin(t * 0.5 + ph) * 0.4;
    const sniffAir = smooth(0.8, 0.97, Math.sin(t * 0.21 + 1));
    const w = stride * 6.5;
    r.head.rotation.set(0, lerp(sway * (1 - sniffAir), Math.sin(w / 2) * 0.15), lerp(-0.08 + Math.sin(t * 0.8) * 0.06 + sniffAir * 0.4, -0.12));
    r.legs!.forEach((l, i) => (l.rotation.z = (i === 0 || i === 3 ? 1 : -1) * Math.sin(w) * 0.45 * gait));
    r.body.rotation.x = Math.sin(w) * 0.06 * gait;
    r.body.position.y = Math.abs(Math.sin(w)) * 0.015 * gait;
    r.body.scale.set(1, 1 + Math.sin(t * 1.3) * 0.03 * (1 - gait), 1 + Math.sin(t * 1.3) * 0.02 * (1 - gait));
  } else if (r.kind === 'basilisk') {
    const w = stride * 5;
    r.head.rotation.set(
      lerp(Math.sin(t * 1.1 + ph) * 0.16, -Math.sin(w) * 0.25),
      lerp(Math.sin(t * 0.6 + ph) * 0.35, 0),
      lerp(Math.sin(t * 0.9 + ph) * 0.06, -0.2),
    );
    r.body.rotation.y = Math.sin(w) * 0.25 * gait;
    r.body.scale.y = 1 + Math.sin(t * 1.6) * 0.03 * (1 - gait);
  } else if (r.kind === 'thunderbird') {
    // The head snaps to a new look every so often, then holds it.
    const step = Math.floor(t * 0.7 + ph);
    const at = (n: number) => Math.sin(n * 12.9898) * 0.65;
    const f = t * 0.7 + ph - step;
    r.head.rotation.set(0, at(step - 1) + (at(step) - at(step - 1)) * smooth(0, 0.12, f), Math.sin(t * 0.5) * 0.05);
    const mantle = smooth(0.82, 0.96, Math.sin(t * 0.23 + ph));
    for (const wing of r.wings!) {
      const s = wing.userData.side as number;
      wing.rotation.x = s * (-0.95 + Math.sin(t * 0.9) * 0.04 + mantle * (-0.35 + Math.sin(t * 7) * 0.3));
    }
    r.tail!.rotation.y = Math.sin(t * 0.6) * 0.08;
    r.body.scale.y = 1 + Math.sin(t * 1.4) * 0.02;
  } else {
    r.head.rotation.set(0, Math.sin(t * 0.4 + ph) * 0.35, Math.sin(t * 0.7 + ph) * 0.06);
    r.head.position.y = base(r.head).y + Math.sin(t * 1.1 + ph) * 0.03;
    r.coils!.forEach((c, i) => (c.position.y = base(c).y + Math.sin(t * 1.1 + ph - (i + 1) * 1.2) * 0.04));
  }
}

// A folded paper border just inside a hex's edges: the hexes a great beast
// holds, in its colour, and the freed peak's richer ground, in gold.
function hexBorder(color: string): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    g.add(part(box(0.58, 0.025, 0.075), color, { at: [Math.cos(a) * 0.74, TILE_H + 0.045, Math.sin(a) * 0.74], rot: [0, -(a + Math.PI / 2), 0], crease: false }));
  }
  return g;
}

function nest(): THREE.Mesh {
  return part(new THREE.TorusGeometry(0.16, 0.05, 3, 7), WOOD_DARK, { at: [0, 0.03, 0], rot: [Math.PI / 2, 0, 0] });
}

// ---------- batch 3: the dragon, trade and monument cards ----------
// Dragon buildings carry a twig nest with eggs (the roost's). Trade buildings
// carry crates of the goods in their own colours under a red-and-cream awning.
// Monuments are pale dressed stone tipped with gold.

const CLAY = '#c9774a';
const TRADE_RED = '#c8463d';
const MONUMENT_STONE = mix(STONE, WALL, 0.55);
const MONUMENT_DARK = mix(STONE, WALL, 0.25);
const EGGS = ['#ff7a59', '#8fd8ff', '#ffd23f'];

// A dragon's egg, standing.
const dragonEgg = (c: string, at: [number, number, number], s = 1) =>
  part(new THREE.IcosahedronGeometry(0.1 * s, 0), mix(c, '#fff8ea', 0.15), { at, scale: [1, 1.3, 1] });

// A crate of one of the goods: a box of its colour with a darker band.
function crate(c: string, s: number, at: [number, number, number], spin = 0): THREE.Group {
  const g = group(part(box(s, s, s), c), part(box(s * 1.02, s * 0.18, s * 1.02), mix(c, DARK, 0.3), { crease: false }));
  g.position.set(at[0], at[1] + s / 2, at[2]);
  g.rotation.y = spin;
  return g;
}

// The goods, a crate of each: stone, timber, crystal, wool, gold.
const TRADE_GOODS = ['#c6cad0', '#b97a44', '#b88bff', '#fbf7ee', '#f5c542'];

// A striped awning: panels sloping down to the front, red and cream in turn.
function awning(w: number, d: number, n: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    g.add(part(box(pw, 0.02, d), i % 2 ? WALL : TRADE_RED, { at: [-w / 2 + pw * (i + 0.5), y, z], rot: [0.35, 0, 0] }));
    // A scalloped flap hanging off the front edge.
    g.add(part(cone(pw * 0.55, 0.08, 3), i % 2 ? WALL : TRADE_RED, { at: [-w / 2 + pw * (i + 0.5), y - Math.sin(0.35) * d / 2 - 0.04, z + Math.cos(0.35) * d / 2], rot: [Math.PI, 0, 0], crease: false }));
  }
  return g;
}

// A clay brooding house: a domed kiln with a glowing mouth, a big nest of
// eggs in front of it where a dragon's egg is kept warm.
function hatchery(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.36, 0.4, 0.26, 9), CLAY, { at: [-0.12, 0.13, -0.22] }));
  g.add(part(new THREE.SphereGeometry(0.37, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), mix(CLAY, WALL, 0.2), { at: [-0.12, 0.26, -0.22] }));
  g.add(part(cyl(0.06, 0.07, 0.22, 6), mix(CLAY, DARK, 0.2), { at: [0.0, 0.66, -0.3] }));
  // The mouth, glowing.
  g.add(part(box(0.2, 0.18, 0.04), '#ff9a3c', { at: [-0.12, 0.11, 0.17], glow: 0.6, crease: false }));
  g.add(part(box(0.11, 0.1, 0.045), '#ffd23f', { at: [-0.12, 0.08, 0.175], glow: 0.7, crease: false }));
  // The nest: a big twig ring with three eggs.
  g.add(part(cyl(0.2, 0.18, 0.04, 9), '#a8743e', { at: [0.32, 0.03, 0.26], crease: false }));
  g.add(part(new THREE.TorusGeometry(0.22, 0.06, 3, 9), WOOD_DARK, { at: [0.32, 0.05, 0.26], rot: [Math.PI / 2, 0, 0] }));
  EGGS.forEach((c, i) => g.add(dragonEgg(c, [0.26 + (i % 2) * 0.13, 0.15, 0.2 + (i === 2 ? 0.12 : 0)], 0.9)));
  return g;
}

// A port, built facing the sea (+z): a red-roofed warehouse, crates of the
// goods under its awning, a pier out over the water and a boat moored by it.
function port(): THREE.Group {
  const g = new THREE.Group();
  const shed = cottage(0.46, 0.32, 0.3, WALL, TRADE_RED);
  shed.position.set(-0.18, 0, -0.32);
  g.add(shed);
  g.add(awning(0.46, 0.18, 4, 0.27, -0.08).translateX(-0.18));
  TRADE_GOODS.forEach((c, i) => g.add(crate(c, 0.11, [-0.36 + (i % 3) * 0.13, i < 3 ? 0 : 0.11, 0.04 + (i < 3 ? 0 : -0.01)], (i * 0.3) % 0.4)));
  // The pier: planks on posts, running out past the hex's edge.
  g.add(part(box(0.22, 0.04, 1.05), WOOD, { at: [0.24, 0.1, 0.35] }));
  for (const z of [0, 0.35, 0.7]) for (const x of [0.14, 0.34]) g.add(part(box(0.04, 0.22, 0.04), WOOD_DARK, { at: [x, 0.01, z], crease: false }));
  g.add(crate(TRADE_GOODS[4], 0.1, [0.24, 0.12, 0.5], 0.4));
  const boat = new THREE.Group();
  boat.add(part(cyl(0.12, 0.06, 0.4, 4), WOOD, { at: [0, 0, 0], rot: [Math.PI / 2, Math.PI / 4, 0], scale: [1, 1, 0.55] }));
  boat.add(part(box(0.02, 0.5, 0.02), DARK, { at: [0, 0.27, 0], crease: false }));
  boat.add(part(sheet([[0, 0.5, 0], [0, 0.05, 0.02], [0, 0.08, 0.26]], [[0, 1, 2]]), WALL, { two: true }));
  boat.add(part(sheet([[0.003, 0.3, 0.008], [0.003, 0.22, 0.013], [0.003, 0.24, 0.15], [0.003, 0.32, 0.1]], [[0, 1, 2], [0, 2, 3]]), TRADE_RED, { two: true, crease: false }));
  boat.position.set(0.58, 0.0, 0.7);
  g.add(boat);
  return g;
}

// A market: two stalls under striped awnings, crates of the goods on their
// counters and a stack of gold coins between them.
function market(): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z, spin] of [[-0.25, -0.12, 0.25], [0.3, -0.2, -0.3]] as [number, number, number][]) {
    const st = new THREE.Group();
    for (const px of [-0.2, 0.2]) for (const pz of [-0.12, 0.12]) st.add(part(box(0.03, 0.42, 0.03), WOOD, { at: [px, 0.21, pz], crease: false }));
    st.add(part(box(0.44, 0.1, 0.2), WOOD_DARK, { at: [0, 0.1, 0.02] }));
    st.add(awning(0.46, 0.32, 4, 0.44, 0));
    st.position.set(x, 0, z);
    st.rotation.y = spin;
    g.add(st);
  }
  const counter = (x: number, z: number, spin: number, goods: string[]) =>
    goods.forEach((c, i) => g.add(crate(c, 0.09, [x + Math.cos(spin) * (i - (goods.length - 1) / 2) * 0.11, 0.2, z - Math.sin(spin) * (i - (goods.length - 1) / 2) * 0.11], spin)));
  counter(-0.25, -0.1, 0.25, TRADE_GOODS.slice(0, 3));
  counter(0.3, -0.18, -0.3, TRADE_GOODS.slice(2, 4));
  // Crates on the ground in front, and the gold.
  g.add(crate(TRADE_GOODS[1], 0.13, [-0.4, 0, 0.3], 0.3));
  g.add(crate(TRADE_GOODS[0], 0.11, [-0.26, 0, 0.36], -0.2));
  for (let i = 0; i < 4; i++) g.add(part(cyl(0.08, 0.08, 0.035, 8), i % 2 ? '#f5c542' : GOLD, { at: [0.12, 0.02 + i * 0.037, 0.24], crease: false }));
  for (let i = 0; i < 2; i++) g.add(part(cyl(0.08, 0.08, 0.035, 8), GOLD, { at: [0.3, 0.02 + i * 0.037, 0.32], crease: false }));
  return g;
}

// An obelisk on a stepped plinth, tipped with gold.
function monument(): THREE.Group {
  return group(
    part(box(0.6, 0.1, 0.6), MONUMENT_DARK, { at: [0, 0.05, 0] }),
    part(box(0.42, 0.1, 0.42), MONUMENT_STONE, { at: [0, 0.15, 0] }),
    part(cyl(0.07, 0.15, 1.15, 4), MONUMENT_STONE, { at: [0, 0.775, 0], rot: [0, Math.PI / 4, 0] }),
    part(cone(0.1, 0.18, 4), GOLD, { at: [0, 1.44, 0], rot: [0, Math.PI / 4, 0], glow: 0.15 }),
  );
}

// A ring of standing stones round a glowing ley stone; at the back a
// trilithon, its lintel carrying a gold sun.
function standingStones(): THREE.Group {
  const g = new THREE.Group();
  const n = 6, R = 0.44;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 6;
    const back = Math.sin(a) < -0.6; // the trilithon's place
    if (back) continue;
    const h = 0.4 + ((i * 37) % 10) / 50;
    g.add(part(box(0.13, h, 0.09), i % 2 ? MONUMENT_STONE : MONUMENT_DARK, { at: [Math.cos(a) * R, h / 2, Math.sin(a) * R], rot: [0, -a + Math.PI / 2, (i % 3 - 1) * 0.07] }));
    g.add(part(cone(0.07, 0.06, 4), MONUMENT_STONE, { at: [Math.cos(a) * R, h + 0.03, Math.sin(a) * R], rot: [0, -a + Math.PI / 4, 0], crease: false }));
  }
  for (const x of [-0.2, 0.2]) g.add(part(box(0.15, 0.7, 0.12), MONUMENT_STONE, { at: [x, 0.35, -0.4] }));
  g.add(part(box(0.62, 0.13, 0.15), MONUMENT_DARK, { at: [0, 0.76, -0.4] }));
  g.add(part(cyl(0.11, 0.11, 0.04, 8), GOLD, { at: [0, 0.58, -0.33], rot: [Math.PI / 2, 0, 0], glow: 0.2 }));
  // The ley stone in the middle, and the violet line it sits on.
  g.add(part(box(0.5, 0.012, 0.06), CRYSTAL, { at: [0, 0.006, 0.05], rot: [0, 0.5, 0], glow: 0.4, crease: false }));
  const c = crystal(0.26, CRYSTAL);
  c.position.set(0, 0.24, 0.05);
  g.add(c);
  return g;
}

// A lighthouse on a rock, facing the sea: a tall pale tower, a gold lantern
// lit at its top under a cap.
function lighthouse(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.DodecahedronGeometry(0.34, 0), STONE, { at: [0, 0.08, 0], scale: [1.3, 0.55, 1.2] }));
  g.add(part(cyl(0.15, 0.24, 1.0, 8), MONUMENT_STONE, { at: [0, 0.6, 0] }));
  for (const y of [0.45, 0.8]) g.add(part(cyl(0.2 - (y - 0.45) * 0.17, 0.21 - (y - 0.45) * 0.17, 0.07, 8), MONUMENT_DARK, { at: [0, y, 0], crease: false }));
  g.add(part(cyl(0.21, 0.21, 0.04, 8), MONUMENT_DARK, { at: [0, 1.12, 0] }));
  g.add(part(cyl(0.12, 0.12, 0.18, 8), '#ffd23f', { at: [0, 1.23, 0], glow: 0.8 }));
  g.add(part(cone(0.17, 0.18, 8), MONUMENT_DARK, { at: [0, 1.41, 0] }));
  g.add(part(cone(0.04, 0.1, 4), GOLD, { at: [0, 1.54, 0], glow: 0.15 }));
  // The door, toward the land.
  g.add(part(box(0.1, 0.16, 0.02), DARK, { at: [0, 0.3, -0.2], crease: false }));
  return g;
}

// A guildhall: a pale stone hall behind a columned porch, a gold finial on
// its roof and banners in the goods' colours hung between the columns (the
// trade it honours).
function guildhall(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(box(0.8, 0.07, 0.62), MONUMENT_DARK, { at: [0, 0.035, -0.05] }));
  g.add(part(box(0.66, 0.42, 0.36), MONUMENT_STONE, { at: [0, 0.28, -0.16] }));
  g.add(gable(0.74, 0.62, 0.26, MONUMENT_DARK, 0.6).translateZ(-0.06));
  // The pediment's face over the porch.
  g.add(part(sheet([[-0.36, 0, 0], [0.36, 0, 0], [0, 0.22, 0]], [[0, 1, 2]]), MONUMENT_STONE, { at: [0, 0.53, 0.25], two: true }));
  for (let i = 0; i < 4; i++) g.add(part(cyl(0.035, 0.04, 0.42, 6), WALL, { at: [-0.27 + i * 0.18, 0.28, 0.21] }));
  g.add(part(box(0.7, 0.05, 0.1), MONUMENT_STONE, { at: [0, 0.51, 0.21] }));
  // Banners in three of the goods' colours between the columns.
  [TRADE_GOODS[2], TRADE_RED, TRADE_GOODS[4]].forEach((c, i) => g.add(part(sheet([[0, 0, 0], [0.11, 0, 0], [0.11, -0.2, 0], [0.055, -0.15, 0], [0, -0.2, 0]], [[0, 1, 2], [0, 2, 3], [0, 3, 4]]), c, { at: [-0.235 + i * 0.18, 0.47, 0.2], two: true, crease: false })));
  g.add(part(box(0.12, 0.2, 0.02), DARK, { at: [0, 0.17, 0.025], crease: false }));
  g.add(part(cone(0.06, 0.16, 4), GOLD, { at: [0, 0.82, -0.06], glow: 0.15 }));
  return g;
}

// ---------- batch 2: the production cards ----------
// Each is a relative of its class's basic building: the same goods in the same
// colours, on a different structure, so two of one class still tell apart.

const SAND = '#e8d29a';
const SEA = '#3d7fbf';
const KILN = '#b9643f';
const FISH = '#9fc3d8';

// A tall cliff face with a wooden scaffold up it and cut blocks at its foot.
function cliffWorks(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.DodecahedronGeometry(0.5, 0), STONE, { at: [0, 0.5, -0.3], scale: [1.25, 1.55, 0.6], rot: [0, 0.3, 0] }));
  g.add(part(new THREE.DodecahedronGeometry(0.3, 0), STONE_DARK, { at: [0.45, 0.22, -0.2], scale: [1, 1.2, 1] }));
  // The scaffold: four posts and two plank decks against the face.
  for (const x of [-0.32, 0.12]) for (const z of [0.0, 0.14]) g.add(part(box(0.04, 0.82, 0.04), WOOD, { at: [x, 0.41, z] }));
  for (const y of [0.4, 0.78]) g.add(part(box(0.56, 0.035, 0.2), mix(WOOD, WALL, 0.3), { at: [-0.1, y, 0.07] }));
  // A ladder up to the first deck.
  for (const x of [0.2, 0.3]) g.add(part(box(0.025, 0.46, 0.025), WOOD_DARK, { at: [x, 0.22, 0.24], rot: [0.25, 0, 0], crease: false }));
  for (let i = 0; i < 4; i++) g.add(part(box(0.11, 0.018, 0.018), WOOD_DARK, { at: [0.25, 0.06 + i * 0.1, 0.27 - i * 0.025], crease: false }));
  // Blocks cut and waiting, one up on the top deck.
  g.add(stoneBlock(0.17, [-0.15, 0.85, 0.07], 0.2));
  for (const [x, y, z, a] of [[-0.3, 0.07, 0.38, 0.1], [-0.1, 0.07, 0.4, -0.2], [-0.2, 0.21, 0.38, 0]]) g.add(stoneBlock(0.18, [x, y, z], a));
  return g;
}

// A mason's yard: a stone arch built of cut blocks, a squared column being carved
// under it, and a workshop roofed in slate behind.
function stonemason(): THREE.Group {
  const g = new THREE.Group();
  const shop = cottage(0.46, 0.3, 0.24, WALL, STONE_DARK);
  shop.position.set(0.05, 0, -0.38);
  g.add(shop);
  const s = 0.15;
  for (const x of [-0.3, 0.3]) for (let i = 0; i < 4; i++) g.add(stoneBlock(s, [x, s * 0.4 + i * s * 0.8, 0.12], 0, i % 2 ? '#c6cad0' : STONE_BLOCK));
  g.add(part(box(0.78, 0.13, 0.17), STONE_BLOCK, { at: [0, 4 * s * 0.8 + 0.065, 0.12] }));
  g.add(part(box(0.16, 0.16, 0.18), '#eef0f2', { at: [0, 4 * s * 0.8 + 0.2, 0.12] }));
  // The column on its block, half done, and the mallet on the ground.
  g.add(stoneBlock(0.16, [0, 0.065, 0.14]));
  g.add(part(cyl(0.05, 0.06, 0.24, 6), '#eef0f2', { at: [0, 0.25, 0.14] }));
  g.add(part(box(0.1, 0.06, 0.06), WOOD_DARK, { at: [0.48, 0.03, 0.38], rot: [0, 0.5, 0] }));
  g.add(part(box(0.025, 0.025, 0.16), WOOD, { at: [0.43, 0.03, 0.45], rot: [0, 0.5, 0], crease: false }));
  for (const [x, z] of [[-0.48, 0.38], [-0.36, 0.48]]) g.add(stoneBlock(0.15, [x, 0.06, z], x));
  return g;
}

// A log cabin (its walls laid from logs, their ends crossing at the corners)
// roofed in bark, and a big axe left in the chopping stump.
function woodcutter(): THREE.Group {
  const g = new THREE.Group();
  const w = 0.5, d = 0.38, r = 0.04, rows = 4;
  for (let i = 0; i < rows; i++) {
    const y = r + i * r * 1.8;
    for (const z of [-d / 2, d / 2]) g.add(timberLog(w + 0.1, r, [0, y + (i % 2 ? r * 0.9 : 0), z - 0.15], 0));
    for (const x of [-w / 2, w / 2]) g.add(timberLog(d + 0.1, r, [x, y + (i % 2 ? 0 : r * 0.9), -0.15], Math.PI / 2));
  }
  const top = r + rows * r * 1.8;
  g.add(part(box(w - 0.04, top, d - 0.04), mix(WOOD, WALL, 0.25), { at: [0, top / 2, -0.15], crease: false }));
  const roof = gable(w + 0.16, d + 0.16, 0.26, WOOD_DARK, top + 0.06);
  roof.position.z = -0.15;
  g.add(roof);
  g.add(part(box(0.11, 0.18, 0.02), DARK, { at: [0.1, 0.09, -0.15 + d / 2 + 0.035], crease: false }));
  // The stump with the axe, and split wood by it.
  g.add(part(cyl(0.16, 0.19, 0.18, 7), WOOD_DARK, { at: [0.34, 0.09, 0.28] }));
  g.add(part(cyl(0.15, 0.15, 0.012, 7), '#f0cb93', { at: [0.34, 0.185, 0.28], crease: false }));
  g.add(part(box(0.045, 0.5, 0.045), '#c48a4e', { at: [0.42, 0.38, 0.28], rot: [0, 0, -0.5] }));
  g.add(part(box(0.2, 0.13, 0.03), '#d3d6db', { at: [0.3, 0.22, 0.28], rot: [0, 0, -0.5] }));
  for (const [x, z, a] of [[-0.05, 0.32, 0.3], [-0.2, 0.36, -0.4], [0.12, 0.42, 1.2]]) g.add(timberLog(0.2, 0.045, [x, 0.045, z], a));
  const t = tree(1.25, PINE);
  t.position.set(-0.48, 0, 0.12);
  g.add(t);
  return g;
}

// A big round saw on its bench, a log being fed through it, a shed roofed in
// fresh-sawn boards and the pile of logs.
function sawmill(): THREE.Group {
  const g = new THREE.Group();
  const shed = cottage(0.44, 0.3, 0.3, mix(WOOD, WALL, 0.35), '#d9a868');
  shed.position.set(0.18, 0, -0.4);
  g.add(shed);
  g.add(part(box(0.66, 0.05, 0.22), WOOD, { at: [-0.05, 0.2, 0.08] }));
  for (const x of [-0.34, 0.24]) for (const z of [0.0, 0.16]) g.add(part(box(0.04, 0.18, 0.04), WOOD_DARK, { at: [x, 0.09, z], crease: false }));
  // The blade, standing on edge facing the room, its teeth around it.
  const blade = new THREE.Group();
  blade.add(part(cyl(0.34, 0.34, 0.025, 16), '#e3e6ea', { rot: [Math.PI / 2, 0, 0] }));
  blade.add(part(cyl(0.06, 0.06, 0.04, 6), DARK, { rot: [Math.PI / 2, 0, 0], crease: false }));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    blade.add(part(cone(0.045, 0.08, 3), '#9aa1ab', { at: [Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0], rot: [0, 0, a - Math.PI / 2], crease: false }));
  }
  blade.position.set(0.02, 0.4, 0.08);
  blade.rotation.x = -0.35; // leant back a little, so the room sees its face
  g.add(blade);
  g.add(timberLog(0.4, 0.07, [-0.25, 0.3, 0.08], 0));
  const r = 0.075;
  for (const [x, lvl] of [[-0.12, 0], [0.04, 0], [-0.04, 1]] as [number, number][]) g.add(timberLog(0.3, r, [0.38 + x, r + lvl * r * 1.7, 0.36], Math.PI / 2));
  return g;
}

// Logs hauled up on a strip of beach, an upturned rowboat and an oar: facing the sea.
function driftwoodYard(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.62, 0.66, 0.03, 7), SAND, { at: [0, 0.015, 0.05], scale: [1, 1, 0.85], crease: false }));
  const r = 0.085, len = 0.42;
  const pile: [number, number][] = [[-0.17, 0], [0, 0], [0.17, 0], [-0.085, 1], [0.085, 1]];
  for (const [x, lvl] of pile) g.add(timberLog(len, r, [-0.15 + x, 0.03 + r + lvl * r * 1.7, -0.18], Math.PI / 2));
  // Bleached driftwood lying loose.
  for (const [x, z, a, l] of [[0.35, -0.2, 0.6, 0.4], [-0.45, 0.25, -0.3, 0.3]]) {
    const t = timberLog(l, 0.04, [x, 0.07, z], a);
    g.add(t);
  }
  // The rowboat, upside down on the sand.
  const boat = group(part(cyl(0.13, 0.05, 0.5, 4), WOOD_DARK, { rot: [Math.PI / 2, Math.PI / 4, 0], scale: [1, 1, 0.55] }));
  boat.rotation.set(Math.PI, 0.5, 0);
  boat.position.set(0.3, 0.1, 0.3);
  g.add(boat);
  g.add(part(box(0.03, 0.03, 0.42), WOOD, { at: [0.0, 0.05, 0.38], rot: [0, -0.9, 0], crease: false }));
  g.add(part(box(0.07, 0.015, 0.11), WOOD, { at: [0.16, 0.05, 0.25], rot: [0, -0.9, 0], crease: false }));
  return g;
}

// A slender stone needle on stepped stones, a big violet crystal hanging in the
// air over its point, and small ones breaking out at its foot.
function leySpire(): THREE.Group {
  const g = new THREE.Group();
  const stone = mix(STONE, '#8a7fa6', 0.35);
  g.add(part(cyl(0.34, 0.4, 0.08, 6), stone, { at: [0, 0.04, -0.05] }));
  g.add(part(cyl(0.24, 0.28, 0.08, 6), mix(stone, WALL, 0.2), { at: [0, 0.12, -0.05] }));
  g.add(part(cyl(0.06, 0.15, 0.9, 4), stone, { at: [0, 0.61, -0.05], rot: [0, Math.PI / 4, 0] }));
  const top = crystal(0.44, CRYSTAL);
  top.position.set(0, 1.42, -0.05);
  g.add(top);
  for (const [x, y, z, h] of [[-0.26, 1.2, 0.05, 0.13], [0.24, 1.3, -0.12, 0.11]]) {
    const c = crystal(h, '#d6bfff');
    c.position.set(x, y, z);
    c.rotation.z = x * 2;
    g.add(c);
  }
  for (const [x, z, h, t] of [[0.32, 0.25, 0.2, 0.4], [-0.34, 0.22, 0.16, -0.4], [0.05, 0.36, 0.14, 0.1]]) {
    const c = crystal(h, CRYSTAL);
    c.position.set(x, h * 0.6, z);
    c.rotation.z = t;
    g.add(c);
  }
  return g;
}

// A cutter's workshop: a grindstone wheel in its frame, a bench of big cut gems.
function gemCutter(): THREE.Group {
  const g = new THREE.Group();
  const shop = cottage(0.4, 0.3, 0.24, WALL, '#8a62c9');
  shop.position.set(-0.2, 0, -0.36);
  g.add(shop);
  // The grindstone, on edge to the room.
  g.add(part(cyl(0.22, 0.22, 0.07, 10), '#b9b2a6', { at: [-0.25, 0.3, 0.15], rot: [Math.PI / 2, 0, 0] }));
  g.add(part(cyl(0.05, 0.05, 0.09, 6), WOOD_DARK, { at: [-0.25, 0.3, 0.15], rot: [Math.PI / 2, 0, 0], crease: false }));
  for (const x of [-0.42, -0.08]) g.add(part(box(0.04, 0.32, 0.04), WOOD, { at: [x, 0.16, 0.15] }));
  g.add(part(box(0.4, 0.035, 0.035), WOOD, { at: [-0.25, 0.3, 0.15], crease: false }));
  // The bench of cut gems: wide faceted stones, not the mine's long spires.
  g.add(part(box(0.38, 0.04, 0.2), WOOD, { at: [0.3, 0.2, 0.18] }));
  for (const x of [0.14, 0.46]) g.add(part(box(0.035, 0.18, 0.035), WOOD_DARK, { at: [x, 0.09, 0.18], crease: false }));
  for (const [x, z, s] of [[0.22, 0.16, 0.11], [0.38, 0.22, 0.085], [0.42, 0.09, 0.07]]) {
    g.add(part(new THREE.OctahedronGeometry(1, 0), CRYSTAL, { at: [x, 0.22 + s * 0.85, z], scale: [s, s * 0.9, s], rot: [0, 0.4, 0], glow: 0.35 }));
  }
  const big = part(new THREE.OctahedronGeometry(1, 0), '#d6bfff', { at: [0.3, 0.13, 0.42], scale: [0.13, 0.13, 0.13], glow: 0.35 });
  g.add(big);
  return g;
}

// A brick kiln with its tall chimney smoking, its mouth glowing; stone blocks go
// in and violet crystals come out.
function smelter(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.22, 0.36, 0.45, 8), KILN, { at: [-0.05, 0.225, -0.12] }));
  g.add(part(cone(0.23, 0.2, 8), mix(KILN, DARK, 0.2), { at: [-0.05, 0.55, -0.12] }));
  g.add(part(cyl(0.07, 0.09, 0.7, 6), mix(KILN, DARK, 0.15), { at: [0.12, 0.65, -0.32] }));
  for (const [y, s, x] of [[1.08, 0.08, 0.14], [1.22, 0.1, 0.2], [1.38, 0.12, 0.3]]) g.add(part(new THREE.DodecahedronGeometry(s, 0), '#e8e4dc', { at: [x, y, -0.32], crease: false }));
  g.add(part(box(0.18, 0.16, 0.04), '#ff9a3c', { at: [-0.05, 0.1, 0.22], glow: 0.9, crease: false }));
  g.add(part(box(0.24, 0.04, 0.06), mix(KILN, DARK, 0.3), { at: [-0.05, 0.2, 0.23], crease: false }));
  for (const [x, z, a] of [[-0.45, 0.2, 0.3], [-0.42, 0.38, -0.1]]) g.add(stoneBlock(0.15, [x, 0.06, z], a));
  for (const [x, z, h, t] of [[0.3, 0.3, 0.22, 0.3], [0.42, 0.18, 0.18, -0.35], [0.2, 0.42, 0.14, -0.1]]) {
    const c = crystal(h, CRYSTAL);
    c.position.set(x, h * 0.6, z);
    c.rotation.z = t;
    g.add(c);
  }
  return g;
}

// A shepherd's bothy: a round stone hut under a tall straw cone, a little
// dry-stone pen of sheep by it, and the crook leant on the wall.
function shepherdsFold(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.24, 0.27, 0.3, 8), mix(STONE, WALL, 0.25), { at: [-0.2, 0.15, -0.25] }));
  g.add(part(cone(0.34, 0.5, 8), STRAW, { at: [-0.2, 0.55, -0.25] }));
  g.add(part(box(0.12, 0.18, 0.02), DARK, { at: [-0.12, 0.09, -0.01], rot: [0, 0.35, 0], crease: false }));
  // The pen: a half ring of dry stone in front, open to the hut.
  const n = 9, R = 0.36, cx = 0.18, cz = 0.18;
  for (let i = 0; i < n; i++) {
    const a = -0.6 + (i / (n - 1)) * Math.PI * 1.3;
    g.add(part(box(0.2, 0.15, 0.1), i % 2 ? STONE : mix(STONE, WALL, 0.3), { at: [cx + Math.cos(a) * R, 0.075, cz + Math.sin(a) * R], rot: [0, -a + Math.PI / 2, 0] }));
  }
  for (const [x, z, a] of [[0.14, 0.16, 0.5], [0.3, 0.02, 2.6]]) {
    const s = sheep();
    s.scale.setScalar(1.45);
    s.position.set(x, 0, z);
    s.rotation.y = a;
    g.add(s);
  }
  // The crook: a staff with its hooked top.
  g.add(part(cyl(0.018, 0.018, 0.66, 4), WOOD, { at: [-0.48, 0.33, 0.1], rot: [0, 0, 0.12], crease: false }));
  g.add(part(new THREE.TorusGeometry(0.07, 0.018, 3, 8, Math.PI * 1.3), WOOD, { at: [-0.5, 0.68, 0.1], rot: [0, 0, -0.2], crease: false }));
  return g;
}

// A big drovers' barn: tall timber walls, a high straw roof, wide doors open on
// sheep coming out.
function droversBarn(): THREE.Group {
  const g = new THREE.Group();
  const w = 0.72, d = 0.5, h = 0.38;
  g.add(part(box(w, h, d), mix(WOOD, WALL, 0.2), { at: [0, h / 2, -0.18] }));
  g.add(gable(w + 0.1, d + 0.16, 0.42, STRAW, h + 0.12));
  g.children[g.children.length - 1].position.z = -0.18;
  g.add(part(box(0.26, 0.28, 0.02), DARK, { at: [0, 0.14, -0.18 + d / 2 + 0.005], crease: false }));
  for (const sx of [-1, 1]) g.add(part(box(0.13, 0.28, 0.02), WOOD_DARK, { at: [sx * 0.2, 0.14, -0.18 + d / 2 + 0.05], rot: [0, sx * 0.9, 0] }));
  g.add(part(box(0.1, 0.08, 0.02), DARK, { at: [0, 0.46, -0.18 + d / 2 + 0.035], crease: false }));
  for (const [x, z, a] of [[0.05, 0.3, 1.4], [-0.3, 0.42, 0.9], [0.36, 0.4, 2.0]]) {
    const s = sheep();
    s.scale.setScalar(1.35);
    s.position.set(x, 0, z);
    s.rotation.y = a;
    g.add(s);
  }
  return g;
}

// A straw-thatched hut up on stilts at the water's edge, a rack of fish drying and
// a sheep by the door: facing the sea.
function fishery(): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.36, -0.02]) for (const z of [-0.42, -0.14]) g.add(part(box(0.04, 0.22, 0.04), WOOD_DARK, { at: [x, 0.11, z], crease: false }));
  g.add(part(box(0.48, 0.04, 0.4), WOOD, { at: [-0.19, 0.24, -0.28] }));
  const hut = cottage(0.36, 0.28, 0.22, mix(WOOD, WALL, 0.45), STRAW);
  hut.position.set(-0.19, 0.26, -0.3);
  g.add(hut);
  // The drying rack: two posts, a pole, fish hanging from it.
  for (const x of [0.02, 0.6]) g.add(part(box(0.04, 0.5, 0.04), WOOD, { at: [x, 0.25, 0.14] }));
  g.add(part(box(0.62, 0.035, 0.035), WOOD_DARK, { at: [0.31, 0.49, 0.14], crease: false }));
  for (let i = 0; i < 4; i++) {
    const x = 0.12 + i * 0.13;
    g.add(part(new THREE.OctahedronGeometry(1, 0), i % 2 ? FISH : mix(FISH, WALL, 0.3), { at: [x, 0.34, 0.14], scale: [0.065, 0.13, 0.035] }));
    g.add(part(cone(0.06, 0.07, 3), mix(FISH, DARK, 0.25), { at: [x, 0.19, 0.14], rot: [Math.PI, 0, 0], crease: false }));
  }
  // A basket of the catch, and the sheep that keeps the place.
  g.add(part(cyl(0.1, 0.08, 0.1, 7), STRAW, { at: [0.3, 0.05, 0.38] }));
  for (const x of [0.26, 0.33]) g.add(part(new THREE.OctahedronGeometry(1, 0), FISH, { at: [x, 0.11, 0.38], scale: [0.03, 0.02, 0.07] }));
  const s = sheep();
  s.scale.setScalar(1.35);
  s.position.set(-0.32, 0, 0.3);
  s.rotation.y = 0.8;
  g.add(s);
  return g;
}

// Buildings that turn to face the sea.
const SEAWARD = new Set(['port', 'driftwood_yard', 'fishery', 'lighthouse']);

// Where a building's dragons sit, in the building's own frame.
interface Perch { x: number; y: number; z: number; face: number }

const PERCHES: Record<string, Perch[]> = {
  // Side-on to the room, so each shows its profile: neck, wings, tail.
  tower: [{ x: 0.3, y: 0, z: 0.42, face: 1.75 }, { x: -0.5, y: 0, z: 0.3, face: -1.4 }],
  roost: [{ x: 0.05, y: ROOST_TOP + 0.04, z: 0.26, face: 1.65 }, { x: -0.1, y: ROOST_TOP + 0.04, z: -0.28, face: -1.5 }, { x: 0.32, y: ROOST_TOP + 0.04, z: -0.05, face: 2.6 }],
  hatchery: [{ x: 0.32, y: 0, z: 0.26, face: 0.6 }],
};
// Nesting Grounds' nest, at the plate's front corner (UPGRADE_AT): the two more dragons it houses sit by it.
const NESTING_PERCHES: Perch[] = [{ x: -0.42, y: 0, z: 0.52, face: 1.7 }, { x: -0.7, y: 0, z: 0.22, face: -1.2 }];

function buildingModel(b: NonNullable<HexView['building']>): { model: THREE.Group; offset: [number, number] } {
  const pc = PLAYER_COLORS[b.owner];
  switch (b.type) {
    case 'tower': return { model: tower(pc, b.floors), offset: [-0.15, -0.2] };
    case 'quarry': return { model: quarry(), offset: [0, 0] };
    case 'lumber_camp': return { model: lumberCamp(), offset: [0, 0] };
    case 'crystal_mine': return { model: crystalMine(), offset: [0, 0] };
    case 'pasture': return { model: pasture(), offset: [0, 0] };
    case 'roost': return { model: roost(), offset: [0, 0] };
    case 'hatchery': return { model: hatchery(), offset: [0, 0] };
    case 'port': return { model: port(), offset: [0, 0] };
    case 'market': return { model: market(), offset: [0, 0] };
    case 'monument': return { model: monument(), offset: [0, 0] };
    case 'standing_stones': return { model: standingStones(), offset: [0, 0] };
    case 'lighthouse': return { model: lighthouse(), offset: [0, 0] };
    case 'guildhall': return { model: guildhall(), offset: [0, 0] };
    case 'cliff_works': return { model: cliffWorks(), offset: [0, 0] };
    case 'stonemason': return { model: stonemason(), offset: [0, 0] };
    case 'woodcutter': return { model: woodcutter(), offset: [0, 0] };
    case 'sawmill': return { model: sawmill(), offset: [0, 0] };
    case 'driftwood_yard': return { model: driftwoodYard(), offset: [0, 0] };
    case 'ley_spire': return { model: leySpire(), offset: [0, 0] };
    case 'gem_cutter': return { model: gemCutter(), offset: [0, 0] };
    case 'smelter': return { model: smelter(), offset: [0, 0] };
    case 'shepherds_fold': return { model: shepherdsFold(), offset: [0, 0] };
    case 'drovers_barn': return { model: droversBarn(), offset: [0, 0] };
    case 'fishery': return { model: fishery(), offset: [0, 0] };
    default: return { model: group(part(box(0.4, 0.4, 0.4), pc, { at: [0, 0.2, 0] })), offset: [0, 0] }; // every building has its own model; this is a missing one
  }
}

// Where an upgrade's mark stands: the plate's front-left corner, toward the room.
const UPGRADE_AT: [number, number] = [-0.56, 0.4];

// What each upgrade puts beside the building it's on, as its card and icon
// show it (icons.ts): a workshop's cog, nesting grounds' nest
// (the dragons it houses sit by it), a trade charter's sealed scroll.
function upgradeMark(key: string): THREE.Group {
  const g = new THREE.Group();
  switch (key) {
    case 'workshop': {
      // A cog on a trestle, upright to the room.
      for (const x of [-0.1, 0.1]) g.add(part(box(0.035, 0.16, 0.035), WOOD, { at: [x, 0.08, 0], crease: false }));
      g.add(part(box(0.28, 0.035, 0.1), WOOD_DARK, { at: [0, 0.16, 0] }));
      const cog = new THREE.Group();
      cog.add(part(cyl(0.13, 0.13, 0.05, 10), '#c9ced6', { rot: [Math.PI / 2, 0, 0] }));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        cog.add(part(box(0.06, 0.06, 0.05), '#8d949e', { at: [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0], rot: [0, 0, a], crease: false }));
      }
      cog.add(part(cyl(0.045, 0.045, 0.06, 8), DARK, { rot: [Math.PI / 2, 0, 0], crease: false }));
      cog.position.set(0, 0.36, 0);
      cog.rotation.x = -0.7; // tipped back to face the camera
      g.add(cog);
      break;
    }
    case 'nesting_grounds': {
      g.add(part(cyl(0.2, 0.18, 0.04, 9), '#a8743e', { at: [0, 0.02, 0], crease: false }));
      g.add(part(new THREE.TorusGeometry(0.22, 0.065, 3, 9), WOOD_DARK, { at: [0, 0.05, 0], rot: [Math.PI / 2, 0, 0] }));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        g.add(part(box(0.16, 0.02, 0.02), '#c48a52', { at: [Math.cos(a) * 0.24, 0.07, Math.sin(a) * 0.24], rot: [0, -a + 0.6, 0.3], crease: false }));
      }
      g.add(dragonEgg(EGGS[0], [-0.05, 0.13, 0]), dragonEgg(EGGS[1], [0.07, 0.12, 0.04], 0.85));
      break;
    }
    case 'trade_charter': {
      // A charter on a lectern: a cream sheet between its rolled ends, a red seal.
      g.add(part(box(0.04, 0.2, 0.04), WOOD_DARK, { at: [0, 0.1, -0.02], crease: false }));
      const sheetG = new THREE.Group();
      sheetG.add(part(box(0.26, 0.2, 0.012), '#f3ead7'));
      for (const y of [-0.1, 0.1]) sheetG.add(part(cyl(0.025, 0.025, 0.3, 6), '#e3d6b8', { at: [0, y, 0.01], rot: [0, 0, Math.PI / 2] }));
      for (const y of [-0.04, 0.0, 0.04]) sheetG.add(part(box(0.17, 0.012, 0.004), '#8a7a66', { at: [-0.02, y + 0.02, 0.008], crease: false }));
      sheetG.add(part(cyl(0.04, 0.04, 0.02, 8), TRADE_RED, { at: [0.07, -0.05, 0.012], rot: [Math.PI / 2, 0, 0] }));
      sheetG.position.set(0, 0.3, 0);
      sheetG.rotation.x = -0.9;
      g.add(sheetG);
      break;
    }
  }
  return g;
}

// What a building stands on: a card in its hex's own terrain colour, so the
// terrain still reads. Its owner shows as their territory's border round it
// (territoryGeometry). An upgrade puts a gold rim on the card and its mark
// (upgradeMark) at the front corner.
function hexRing(outer: number, inner: number, h: number): THREE.BufferGeometry {
  const corners = (r: number) => Array.from({ length: 6 }, (_, i) => new THREE.Vector2(Math.sin((i * Math.PI) / 3) * r, Math.cos((i * Math.PI) / 3) * r));
  const shape = new THREE.Shape(corners(outer));
  shape.holes.push(new THREE.Path(corners(inner).reverse()));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // lie flat, its depth going up
  return geo;
}
function plate(upgrade: string | null, ground: string): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.9, 0.9, PLATE_H, 6), ground, { at: [0, TOP + PLATE_H / 2, 0], crease: false }));
  if (upgrade) {
    g.add(part(hexRing(0.78, 0.7, PLATE_H * 1.4), GOLD, { at: [0, TOP, 0] }));
    const mark = bake(upgradeMark(upgrade));
    mark.scale.setScalar(1.6);
    mark.position.set(UPGRADE_AT[0], GROUND, UPGRADE_AT[1]);
    g.add(mark);
  }
  return g;
}

// A player's territory, the hexes their buildings stand on, bordered in their
// colour: a band just inside each edge where the next hex isn't theirs, so
// their hexes read as one region, and two players' regions side by side each
// keep their own line.
const BORDER_R = 0.965, BORDER_W = 0.17; // the band, from the tile's edge in (as a corner radius)
function territoryGeometry(hexes: [number, number][]): THREE.BufferGeometry | null {
  const key = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
  const mine = new Set(hexes.map(([x, z]) => key(x, z)));
  const corner = (x: number, z: number, i: number, r: number) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return new THREE.Vector2(x + r * Math.cos(a), -(z + r * Math.sin(a)));
  };
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of hexes) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * 60 * i; // the edge from corner i to i + 1 faces this way
      if (mine.has(key(x + SQ3 * Math.cos(a), z + SQ3 * Math.sin(a)))) continue;
      const shape = new THREE.Shape([corner(x, z, i, BORDER_R), corner(x, z, i + 1, BORDER_R), corner(x, z, i + 1, BORDER_R - BORDER_W), corner(x, z, i, BORDER_R - BORDER_W)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: PLATE_H * 1.5, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      parts.push(geo.toNonIndexed());
    }
  }
  if (!parts.length) return null;
  const merged = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    merged.setAttribute(name, new THREE.Float32BufferAttribute(parts.flatMap((g) => Array.from(g.getAttribute(name).array as Float32Array)), size));
  }
  parts.forEach((g) => g.dispose());
  return merged;
}

// ---------- dragons ----------

// An origami dragon, head towards +z, standing on y = 0. Parts that move are
// kept so the animation can bend them.
interface Rig {
  root: THREE.Group; // placed and turned in the world
  body: THREE.Group; // breathes, banks
  neck: THREE.Group;
  tail: THREE.Group[];
  wings: THREE.Group[]; // [right, left] pivots
  legs: THREE.Group;
}

function dragonRig(element: string): Rig {
  const c = ELEMENT_COLORS[element] ?? '#ccc';
  const skin = mix(c, '#6b6157', 0.12);
  const wing = mix(c, '#fff8ea', 0.18);
  const dark = mix(c, '#1d1712', 0.45);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.4;
  root.add(body);
  body.add(part(new THREE.OctahedronGeometry(1, 0), skin, { scale: [0.25, 0.22, 0.42] }));
  body.add(part(new THREE.OctahedronGeometry(1, 0), mix(c, '#fff8ea', 0.55), { scale: [0.14, 0.1, 0.26], at: [0, -0.07, 0.07], crease: false }));
  for (let i = 0; i < 4; i++) body.add(part(cone(0.035, 0.12, 3), dark, { at: [0, 0.17 - i * 0.012, 0.14 - i * 0.13], rot: [-0.4, 0, 0], crease: false }));

  const neck = new THREE.Group();
  neck.position.set(0, 0.06, 0.3);
  neck.rotation.x = 0.55;
  neck.add(part(cone(0.12, 0.46, 4), skin, { at: [0, 0.2, 0] }));
  const head = new THREE.Group();
  head.position.set(0, 0.42, 0);
  head.rotation.x = 0.55;
  head.add(part(new THREE.OctahedronGeometry(1, 0), skin, { scale: [0.13, 0.1, 0.24], at: [0, 0, 0.07] }));
  head.add(part(cone(0.03, 0.12, 3), dark, { at: [0, -0.04, 0.2], rot: [Math.PI / 2, 0, 0], crease: false }));
  for (const s of [-1, 1]) {
    head.add(part(cone(0.024, 0.22, 3), dark, { at: [s * 0.055, 0.07, -0.08], rot: [-1.15, 0, s * 0.25], crease: false }));
    head.add(part(new THREE.OctahedronGeometry(0.03, 0), '#fff4b8', { at: [s * 0.08, 0.03, 0.11], glow: 0.9, crease: false }));
  }
  neck.add(head);
  body.add(neck);

  // The tail: three segments that sway one after the other.
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  let at = new THREE.Vector3(0, 0.02, -0.34);
  const lens = [0.32, 0.28, 0.24];
  lens.forEach((len, i) => {
    const seg = new THREE.Group();
    seg.position.copy(at);
    seg.rotation.x = i === 0 ? 0.25 : -0.12;
    seg.add(part(cone(0.1 - i * 0.028, len, 4), skin, { at: [0, 0, -len / 2], rot: [-Math.PI / 2, 0, 0], crease: i === 0 }));
    parent.add(seg);
    tail.push(seg);
    parent = seg;
    at = new THREE.Vector3(0, 0, -len * 0.9);
  });
  tail[2].add(part(sheet([[0, 0, -0.18], [0.09, 0, -0.3], [0, 0, -0.42], [-0.09, 0, -0.3]], [[0, 1, 2], [0, 2, 3]]), dark, { two: true }));

  // Wings: two folded sheets each, hinged at the shoulder.
  const wings: THREE.Group[] = [];
  const wingGeo = sheet([[0, 0, 0], [0.95, 0.12, -0.08], [0.58, -0.05, -0.5], [0.12, 0, -0.42]], [[0, 1, 2], [0, 2, 3]]);
  for (const s of [1, -1]) {
    const mount = new THREE.Group();
    mount.position.set(s * 0.12, 0.13, 0.12);
    mount.scale.x = s;
    const pivot = new THREE.Group();
    pivot.add(part(wingGeo, wing, { two: true }));
    pivot.add(part(cyl(0.018, 0.012, 0.96, 3), dark, { at: [0.475, 0.06, -0.04], rot: [0, 0.08, Math.PI / 2 - 0.12], crease: false }));
    mount.add(pivot);
    body.add(mount);
    wings.push(pivot);
  }

  const legs = new THREE.Group();
  for (const [x, z] of [[0.11, 0.18], [-0.11, 0.18], [0.12, -0.18], [-0.12, -0.18]]) legs.add(part(cone(0.05, 0.36, 4), skin, { at: [x, -0.2, z], rot: [Math.PI, 0, 0], crease: false }));
  body.add(legs);
  bake(body, true);
  return { root, body, neck, tail, wings, legs };
}

function egg(element: string): THREE.Group {
  const c = ELEMENT_COLORS[element] ?? '#ccc';
  const g = new THREE.Group();
  const shell = part(new THREE.IcosahedronGeometry(0.14, 0), mix(c, '#fff8ea', 0.15), { at: [0, 0.18, 0], scale: [1, 1.3, 1] });
  shell.add(part(new THREE.IcosahedronGeometry(0.142, 0), mix(c, '#1d1712', 0.3), { scale: [1.02, 0.25, 1.02], at: [0, 0.03, 0], crease: false }));
  g.add(nest(), shell);
  g.userData.shell = shell;
  return g;
}

const STAGE_SCALE = [1.25, 0.72, 0.95, 1.2];

interface DragonEntry {
  sig: string;
  view: DragonView;
  obj: THREE.Group;
  rig: Rig | null; // null: an egg
  perch: THREE.Vector3;
  face: number; // heading at rest
  home: THREE.Vector3; // what it circles when it flies
  seed: number;
  // Easing between poses: `shown` is the pose drawn last frame; when what it's
  // doing changes (`key`: taking off, landing, resting, a new perch, growing),
  // it eases from where it was (`from`) to the new pose instead of jumping.
  key?: string;
  shown?: number[];
  from?: { pose: number[]; at: number; dur: number; move: boolean; hop: number };
  start?: THREE.Vector3; // where it first appears (a hatchling: its egg), before going to its perch
  grow?: { from: number; at: number }; // growing to its stage's size since `at`
  skip?: number; // a flight it sits out: it couldn't fly when the flight began
  late?: boolean; // it arrived while the board was showing: it doesn't join a flight under way
}

// A dragon's pose as numbers, so two poses can be blended: where it is, its
// heading, then its joints.
function readPose(e: DragonEntry): number[] {
  const p = [e.obj.position.x, e.obj.position.y, e.obj.position.z, e.obj.rotation.y];
  const r = e.rig;
  if (!r) return p;
  p.push(r.body.rotation.x, r.body.rotation.z, r.body.position.y, r.legs.rotation.x, r.neck.rotation.x, r.neck.rotation.y);
  for (const s of r.tail) p.push(s.rotation.x, s.rotation.y);
  for (const w of r.wings) p.push(w.rotation.x, w.rotation.y, w.rotation.z, w.scale.x);
  return p;
}

function writePose(e: DragonEntry, p: number[]) {
  e.obj.position.set(p[0], p[1], p[2]);
  e.obj.rotation.y = p[3];
  const r = e.rig;
  if (!r) return;
  r.body.rotation.set(p[4], 0, p[5]);
  r.body.position.y = p[6];
  r.legs.rotation.x = p[7];
  r.neck.rotation.set(p[8], p[9], 0);
  r.tail.forEach((s, i) => s.rotation.set(p[10 + i * 2], p[11 + i * 2], 0));
  r.wings.forEach((w, i) => {
    const o = 10 + r.tail.length * 2 + i * 4;
    w.rotation.set(p[o], p[o + 1], p[o + 2]);
    w.scale.setScalar(p[o + 3]);
  });
}

// Folds up from flat with a little overshoot: 0 at k = 0, 1 at k = 1.
const popUp = (k: number) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;

// How long something takes to fold flat and go when it leaves the board (seconds).
const LEAVE_S = 0.6;
// How long the scenery on a hex takes to make room for a building or a beast,
// or to grow back (seconds): the building's own fold-up takes 0.9.
const DECOR_S = 1;

// When a dragon flies: every `period` seconds from `offset`, for `dur` seconds.
function schedule(d: DragonEntry): { offset: number; period: number; dur: number } {
  const h = (d.seed % 1000) / 1000;
  return { offset: 6 + h * 20, period: 28 + h * 14, dur: d.view.stage === 1 ? 7 : 10 };
}

const canFly = (d: DragonView) => d.stage > 0 && d.status !== 'hurt' && d.status !== 'hungry' && d.status !== 'perched';

// ---------- the board ----------

// walk: a beast that wandered here from the next hex, walking in from `from`
// (where it stood, from where it stands now) since `at` on the board's clock.
interface Built { sig: string; obj: THREE.Group; born: number; walk?: { from: THREE.Vector3; at: number } }

// A wandering beast turns to face the next hex, walks there, and turns back
// to face the room (seconds): an unhurried walk, so it's still going when
// someone looks up from their phone.
const WALK_TURN = 0.7, WALK_GO = 3.4;

// What just changed on the board stays marked for a while: a glowing gold
// outline round its hex (round the building's border, which is in its owner's
// colour), pulsing gently and fading out after FRESH_S seconds.
// The table is often looking at their phones when it happens; whoever looks
// up late still sees what's new.
const FRESH_S = 12;
const MARK = '#ffe27a';

// Several things new at once (the board catching up after a TV scene) fold
// up one after another, this many seconds apart, not all in one frame, so
// the eye can follow each. At most CASCADE_MAX of them wait their turn.
const CASCADE_S = 0.3, CASCADE_MAX = 8;

// The shortest way from one heading to another.
const turnTo = (a: number, b: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class Board3D {
  readonly el: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 200);
  private sun: THREE.DirectionalLight;
  private world = new THREE.Group();
  private mapSig = '';
  private tiles = new Map<string, { hex: HexView; decorSig: string }>();
  private decor = new THREE.Group(); // everything growing on the map, merged
  private built = new Map<string, Built>();
  private territory = new THREE.Group(); // every player's territory border
  private territorySig = '';
  private beasts = new Map<string, Built>(); // fauna, by hex
  private dragons = new Map<string, DragonEntry>();
  private plateMats = PLAYER_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c, map: null, flatShading: true }));
  private highlight: number | null = null;
  private bounds = new THREE.Box3();
  private fitPoints: THREE.Vector3[] = []; // what the camera must keep in view
  private firstUpdate = true;
  private marks = new Map<string, { mesh: THREE.Mesh; born: number }>(); // by hex
  // What's leaving the board, folding flat (a building or beast) or shrinking
  // away (a dragon or an egg) before it's gone.
  private leaving: { obj: THREE.Object3D; at: number; how: 'fold' | 'shrink'; size: number; beast?: Built }[] = [];
  // Hexes whose scenery is changing: the old folds flat while the new folds up.
  // They're left out of the merged scenery until they're done.
  private decorMoves = new Map<string, { old: THREE.Group; now: THREE.Group; at: number }>();
  private map: HexView[] = [];
  private lastT = -Infinity; // the clock at the last frame drawn

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'board3d';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.el.append(this.renderer.domElement);
    GRAIN ??= paperTexture();
    this.plateMats.forEach((m) => (m.map = GRAIN));

    this.scene.add(new THREE.HemisphereLight('#fff6e6', '#5a4a3c', 0.95));
    this.sun = new THREE.DirectionalLight('#fff1dc', 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.world);

    new ResizeObserver(() => this.resize()).observe(this.el);
    window.boardFlightAt = (frac) => this.flightAt(frac);
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  update(g: PublicState, highlight: number | null) {
    this.highlight = highlight;
    const sig = g.map.map((h) => `${h.k}${h.terrain}`).join();
    if (sig !== this.mapSig) this.buildMap(g.map, sig);
    const now = clock();
    const animate = !this.firstUpdate;
    // Each hex with something new gets its turn in the cascade; its scenery
    // makes room in step with it.
    let n = 0;
    const turns = new Map<string, number>();
    const next = (k: string) => turns.get(k) ?? turns.set(k, now + Math.min(n++, CASCADE_MAX) * CASCADE_S).get(k)!;
    this.map = g.map;
    let regrow = false;
    for (const h of g.map) {
      const t = this.tiles.get(h.k)!;
      const was = t.hex;
      t.hex = h;
      const ground = h.building ? `b${h.building.type}` : h.fauna ? 'f' : '';
      const decorSig = `${ground}${h.held ?? ''}${h.peakZone ? 'z' : ''}`;
      if (decorSig === t.decorSig) continue;
      regrow = true;
      // A building or a beast arriving or leaving: the trees, grass and
      // crystals fold down and fold up again round it, as it folds up or down.
      if (animate && t.decorSig !== '-' && h.terrain !== 'ocean' && crowded(was) !== crowded(h)) {
        const old = this.decorMoves.get(h.k);
        if (old) this.endDecorMove(h.k);
        const at = (hex: HexView) => {
          const d = decor(hex, this.seaward(g.map, hex));
          const [x, z] = hexXZ(hex.q, hex.r);
          d.position.set(x, 0, z);
          const baked = bake(group(d));
          this.world.add(baked);
          return baked;
        };
        this.decorMoves.set(h.k, { old: at(was), now: at(h), at: crowded(h) ? next(h.k) : now });
      }
      t.decorSig = decorSig;
    }
    if (regrow) this.regrowDecor();
    for (const h of g.map) {
      const b = h.building;
      const bsig = b ? `${b.type}|${b.owner}|${b.upgrade}|${b.floors}|${h.fauna ? 'shut' : ''}` : '';
      const had = this.built.get(h.k);
      if (had?.sig === bsig) continue;
      if (had) {
        this.built.delete(h.k);
        // A building that's gone folds down; one that changed is replaced by the new one folding up.
        if (!b && animate) this.leave(had.obj, now, 'fold');
        else {
          this.world.remove(had.obj);
          dispose(had.obj);
        }
      }
      if (!b) continue;
      const obj = this.placed(this.buildingGroup(b, h.terrain, SEAWARD.has(b.type) ? this.seaward(g.map, h) : 0, !!h.fauna), h);
      // Pop up from the page when it's new; a new floor or upgrade pops up too
      // (a beast arriving or leaving only greys or colours it).
      const fresh = animate && (!had || had.sig.split('|')[0] !== b.type || had.sig.split('|').slice(0, 4).join('|') !== bsig.split('|').slice(0, 4).join('|'));
      const at = fresh ? next(h.k) : -1e9;
      this.built.set(h.k, { sig: bsig, obj, born: at });
      if (fresh) this.mark(h, at);
    }
    this.drawTerritory(g.map);
    // Fauna: on its dark lair in the middle of an open hex, or out in front
    // of the building it shuts down. It folds up like a building when it
    // arrives, unless it wandered in from the next hex: then it walks over.
    const gone: { k: string; key: string; at: THREE.Vector3; b: Built }[] = [];
    const fresh: HexView[] = [];
    for (const h of g.map) {
      const f = h.fauna;
      const fsig = f ? `${f.key}|${h.building ? 1 : 0}` : '';
      const had = this.beasts.get(h.k);
      if ((had?.sig ?? '') === fsig) continue;
      if (had) {
        gone.push({ k: h.k, key: had.sig.split('|')[0], at: this.figureAt(had), b: had });
        this.beasts.delete(h.k);
      }
      if (f) fresh.push(h);
    }
    for (const h of fresh) {
      const f = h.fauna!;
      const obj = this.placed(this.beastGroup(f.key, !!h.building, h.k), h);
      const at = animate ? next(h.k) : -1e9;
      const entry: Built = { sig: `${f.key}|${h.building ? 1 : 0}`, obj, born: at };
      const from = animate ? gone.findIndex((o) => o.key === f.key && o.k !== h.k && hexDist(this.tiles.get(o.k)!.hex, h) === 1) : -1;
      if (from >= 0) {
        entry.born = -1e9;
        entry.walk = { from: gone[from].at.sub(this.figureAt(entry)), at };
        // It walks over from there: the one that stood there is this one.
        this.world.remove(gone[from].b.obj);
        dispose(gone[from].b.obj);
        gone.splice(from, 1);
      }
      this.beasts.set(h.k, entry);
      if (animate) this.mark(h, at);
    }
    // Cleared, slain or gone further than the next hex: it folds down where it stood.
    for (const o of gone) {
      if (animate) this.leave(o.b.obj, now, 'fold', o.b);
      else {
        this.world.remove(o.b.obj);
        dispose(o.b.obj);
      }
    }
    this.placeDragons(g, animate, now);
    this.firstUpdate = false;
  }

  // Each player's territory border, redrawn when whose buildings are where changes.
  private drawTerritory(map: HexView[]) {
    const sig = map.filter((h) => h.building).map((h) => `${h.k}:${h.building!.owner}`).join();
    if (sig === this.territorySig) return;
    this.territorySig = sig;
    for (const c of [...this.territory.children]) {
      this.territory.remove(c);
      dispose(c);
    }
    const byOwner = new Map<number, [number, number][]>();
    for (const h of map) if (h.building) byOwner.set(h.building.owner, [...(byOwner.get(h.building.owner) ?? []), hexXZ(h.q, h.r)]);
    for (const [owner, hexes] of byOwner) {
      const geo = territoryGeometry(hexes);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.plateMats[owner]);
      m.position.y = TOP;
      m.receiveShadow = true;
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), CREASE));
      this.territory.add(m);
    }
    if (!this.territory.parent) this.world.add(this.territory);
  }

  private mark(h: HexView, now: number) {
    this.unmark(h.k);
    const geo = new THREE.RingGeometry(0.86, 1.0, 6, 1, Math.PI / 6); // corners where the tile's are
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: MARK, transparent: true, opacity: 0, depthWrite: false }));
    const [x, z] = hexXZ(h.q, h.r);
    mesh.position.set(x, TILE_H + TILE_LIFT + 0.015, z); // just over the tile's peak, so its folds never cut it
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.marks.set(h.k, { mesh, born: now });
  }

  private unmark(k: string) {
    const m = this.marks.get(k);
    if (!m) return;
    this.scene.remove(m.mesh);
    m.mesh.geometry.dispose();
    (m.mesh.material as THREE.Material).dispose();
    this.marks.delete(k);
  }

  // Everything growing on the map, merged, but for the hexes whose scenery is moving.
  private regrowDecor() {
    this.world.remove(this.decor);
    dispose(this.decor);
    const all = new THREE.Group();
    for (const h of this.map) {
      if (this.decorMoves.has(h.k)) continue;
      const d = decor(h, this.seaward(this.map, h));
      const [x, z] = hexXZ(h.q, h.r);
      d.position.set(x, 0, z);
      all.add(d);
    }
    this.decor = bake(all);
    this.world.add(this.decor);
  }

  private endDecorMove(k: string) {
    const m = this.decorMoves.get(k);
    if (!m) return;
    for (const o of [m.old, m.now]) {
      this.world.remove(o);
      dispose(o);
    }
    this.decorMoves.delete(k);
  }

  // Takes something off the board slowly: see `leaving`.
  private leave(obj: THREE.Object3D, now: number, how: 'fold' | 'shrink', beast?: Built) {
    this.leaving.push({ obj, at: now, how, size: obj.scale.x, beast });
  }

  // ---------- building the scene ----------

  private placed(o: THREE.Object3D, h: HexView): THREE.Group {
    const [x, z] = hexXZ(h.q, h.r);
    const g = o instanceof THREE.Group ? o : group(o);
    g.position.set(x, 0, z);
    this.world.add(g);
    return g;
  }

  // Which way is the sea from a hex (the heading of +z, for rotation.y).
  private seaward(map: HexView[], h: HexView): number {
    let dx = 0, dz = 0;
    const [x, z] = hexXZ(h.q, h.r);
    for (const o of map) {
      if (o.terrain !== 'ocean' || Math.max(Math.abs(o.q - h.q), Math.abs(o.r - h.r), Math.abs(o.q + o.r - h.q - h.r)) !== 1) continue;
      const [ox, oz] = hexXZ(o.q, o.r);
      dx += ox - x;
      dz += oz - z;
    }
    return dx || dz ? Math.atan2(dx, dz) : 0;
  }

  private buildingGroup(b: NonNullable<HexView['building']>, terrain: string, facing: number, shut: boolean): THREE.Group {
    const g = plate(b.upgrade, tileColor(terrain));
    const { model: parts, offset } = buildingModel(b);
    const model = bake(parts);
    // Shut down by a beast: the building goes to dull grey paper (its border
    // keeps its owner's colour) and sits back, so the beast in front is whole.
    if (shut) {
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = shutPaper(o.material as THREE.MeshLambertMaterial);
      });
    }
    const pop = new THREE.Group(); // hinged at the hex's back edge, for the pop-up
    pop.position.set(0, GROUND, -0.6);
    model.scale.setScalar(shut ? 0.95 : 1.15);
    model.position.set(offset[0], 0, offset[1] + 0.6 - (shut ? 0.2 : 0));
    model.rotation.y = facing;
    pop.add(model);
    g.add(pop);
    g.userData.pop = pop;
    return g;
  }

  private beastGroup(key: string, onBuilding: boolean, k: string): THREE.Group {
    const g = new THREE.Group();
    const model = bake(beastModel(key), true);
    const pop = new THREE.Group();
    const great = key === 'thunderbird' || key === 'leviathan';
    const [x, z] = onBuilding ? [0.08, 0.4] : [0, 0.05];
    // The Thunderbird on its peak's summit; the Leviathan in the sea. Neither has a lair.
    const y = key === 'thunderbird' ? TOP + PEAK_H - 0.2 : key === 'leviathan' ? -0.01 : onBuilding ? GROUND : TOP;
    pop.position.set(x, y, z);
    model.scale.setScalar(key === 'thunderbird' ? 1.7 : key === 'leviathan' ? 1.9 : 1.15); // the same size on a building's hex as on an open one
    if (!great) pop.add(lair(onBuilding ? 0.42 : 0.58));
    // Three-quarters to the room, half of them looking left.
    const face = (hash(k) % 2 ? -1 : 1) * 0.75 - Math.PI / 2;
    model.rotation.y = face;
    model.userData.face = face;
    const seed = hash(k) % 628 / 100;
    for (const r of model.userData.rigs as BeastRig[]) r.phase += seed;
    pop.add(model);
    g.add(pop);
    g.userData.pop = pop;
    g.userData.figure = model;
    return g;
  }

  // Where a beast's figure stands, on the board.
  private figureAt(b: Built): THREE.Vector3 {
    return b.obj.position.clone().add((b.obj.userData.pop as THREE.Group).position);
  }

  // A beast where it stands, or walking over from the hex it wandered from.
  private animateBeast(b: Built, t: number) {
    const m = b.obj.userData.figure as THREE.Group;
    const face = m.userData.face as number;
    let gait = 0, stride = 0;
    m.position.set(0, 0, 0);
    m.rotation.y = face;
    const since = b.walk ? t - b.walk.at : Infinity;
    if (b.walk && since < WALK_GO + WALK_TURN * 2) {
      const from = b.walk.from;
      const heading = turnTo(face, Math.atan2(from.z, -from.x)); // +x towards here
      const there = smooth(WALK_TURN, WALK_TURN + WALK_GO, since);
      m.position.copy(from).multiplyScalar(1 - there);
      const back = smooth(WALK_TURN + WALK_GO, WALK_GO + WALK_TURN * 2, since);
      m.rotation.y = face + (heading - face) * smooth(0, WALK_TURN, since) * (1 - back);
      gait = smooth(0, WALK_TURN * 0.6, since) * (1 - back);
      stride = since;
    } else delete b.walk;
    for (const r of m.userData.rigs as BeastRig[]) animateBeast(r, t, gait, stride);
  }

  private buildMap(map: HexView[], sig: string) {
    for (const o of [...this.world.children]) {
      this.world.remove(o);
      dispose(o);
    }
    this.tiles.clear();
    for (const k of [...this.marks.keys()]) this.unmark(k);
    this.built.clear();
    this.beasts.clear();
    this.dragons.clear();
    this.leaving = [];
    this.decorMoves.clear();
    this.mapSig = sig;
    const geo = tileGeometry();
    const tiles = new THREE.Group();
    for (const h of map) {
      if (h.terrain === 'ocean') {
        this.tiles.set(h.k, { hex: h, decorSig: '-' });
        continue; // the sea is the sheet under the map
      }
      const r = rng(`tile${h.k}`);
      const [x, z] = hexXZ(h.q, h.r);
      const color = tileColor(h.terrain);
      const at: [number, number, number] = [x, (r() - 0.5) * 0.02, z];
      tiles.add(part(geo.top, color, { at }), part(geo.sides, mix(color, '#fbf6ea', 0.6), { at, crease: false }));
      this.tiles.set(h.k, { hex: h, decorSig: '-' });
    }
    this.world.add(bake(tiles));
    // The map's extent, for the shadows and the camera.
    this.bounds.makeEmpty();
    for (const h of map) {
      const [x, z] = hexXZ(h.q, h.r);
      this.bounds.expandByPoint(new THREE.Vector3(x - 1, 0, z - 1)).expandByPoint(new THREE.Vector3(x + 1, 1.6, z + 1));
    }
    // The land's outline, the tops of tall buildings, and the sky where dragons
    // fly: the camera fits these and lets the sea run off the screen's edges.
    this.fitPoints = map.flatMap((h) => {
      if (h.terrain === 'ocean') return [];
      const [x, z] = hexXZ(h.q, h.r);
      return [[0.95, 0, 0], [-0.95, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1.6, 0]].map(([dx, y, dz]) => new THREE.Vector3(x + dx, y, z + dz));
    });
    if (!this.fitPoints.length) this.fitPoints = map.map((h) => new THREE.Vector3(...hexXZ(h.q, h.r)).setY(0));
    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());
    // The sea: a sheet far past the screen's edges, the land pasted on it; a
    // map without an ocean gets plain paper. It catches the shadows too.
    const sea = map.some((h) => h.terrain === 'ocean');
    const floor = part(seaGeometry(150), sea ? mix(TERRAIN_COLORS.ocean, '#e6eef2', 0.2) : '#efe5cf', { at: [center.x, -0.01, center.z], crease: false });
    floor.castShadow = false;
    this.world.add(floor);
    // Wave crests on the open sea round the map, out past any screen's corners.
    if (sea) {
      const dist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const reach = map.reduce((m, h) => Math.max(m, dist(h.q, h.r)), 0);
      const onMap = new Set(map.map((h) => `${h.q},${h.r}`));
      const open = new THREE.Group();
      const out = reach * 2 + 6;
      for (let q = -out; q <= out; q++) {
        for (let r = -out; r <= out; r++) {
          if (dist(q, r) > out || onMap.has(`${q},${r}`)) continue;
          const crests = waveCrests(rng(`sea${q},${r}`));
          const [x, z] = hexXZ(q, r);
          crests.position.set(x, 0, z);
          open.add(crests);
        }
      }
      this.world.add(bake(open));
    }

    const r = Math.max(size.x, size.z);
    this.sun.position.set(center.x - r * 0.45, r * 1.1, center.z + r * 0.55);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r * 0.85;
    cam.right = cam.top = r * 0.85;
    cam.near = 0.1;
    cam.far = r * 3;
    cam.updateProjectionMatrix();
    this.resize();
  }

  private placeDragons(g: PublicState, animate: boolean, now: number) {
    // Perches: each owner's tower, roosts and hatcheries, in that order; eggs
    // go to a hatchery's nest first. Any extra dragons stand round the tower.
    const perches = new Map<number, { pos: THREE.Vector3; face: number; home: THREE.Vector3; egg: boolean }[]>();
    const towers = new Map<number, THREE.Vector3>();
    for (const h of g.map) {
      const b = h.building;
      if (!b || !(PERCHES[b.type] || b.upgrade === 'nesting_grounds')) continue;
      const [x, z] = hexXZ(h.q, h.r);
      const center = new THREE.Vector3(x, 0, z);
      if (b.type === 'tower') towers.set(b.owner, center);
      const n = b.type === 'tower' ? 1 : b.type === 'roost' ? 2 : 1;
      const list = perches.get(b.owner) ?? [];
      (PERCHES[b.type] ?? []).slice(0, n).forEach((p) => list.push({ pos: new THREE.Vector3(x + p.x, GROUND + p.y, z + p.z), face: p.face, home: center, egg: b.type === 'hatchery' }));
      if (b.upgrade === 'nesting_grounds') NESTING_PERCHES.forEach((p) => list.push({ pos: new THREE.Vector3(x + p.x, GROUND + p.y, z + p.z), face: p.face, home: center, egg: false }));
      perches.set(b.owner, list);
    }
    const want = new Map<string, { pos: THREE.Vector3; face: number; home: THREE.Vector3 }>();
    for (const [owner, list] of perches) {
      const mine = g.dragons.filter((d) => d.owner === owner);
      const free = [...list];
      const take = (eggFirst: boolean) => {
        const i = eggFirst ? free.findIndex((p) => p.egg) : free.findIndex((p) => !p.egg);
        return free.splice(i >= 0 ? i : 0, 1)[0];
      };
      const tower = towers.get(owner) ?? list[0]?.home ?? new THREE.Vector3();
      let extra = 0;
      for (const d of mine) {
        if (d.perch) continue; // away on a rival's building (below)
        const p = free.length ? take(d.stage === 0) : null;
        if (p) want.set(d.id, p);
        else {
          const a = 2.2 + extra++ * 0.9;
          want.set(d.id, { pos: new THREE.Vector3(tower.x + Math.cos(a) * 0.62, GROUND, tower.z + Math.sin(a) * 0.62), face: a + Math.PI / 2, home: tower });
        }
      }
    }
    // Perched dragons stand on the plate of the rival's building they block,
    // round its front, facing out, so the table sees who's sitting where.
    for (const h of g.map) {
      if (!h.perched?.length) continue;
      const [x, z] = hexXZ(h.q, h.r);
      const center = new THREE.Vector3(x, 0, z);
      h.perched.forEach(({ d: id }, i) => {
        const a = 0.9 + i * 0.85;
        want.set(id, { pos: new THREE.Vector3(x + Math.cos(a) * 0.6, GROUND, z + Math.sin(a) * 0.6), face: a + Math.PI / 2, home: center });
      });
    }
    const seen = new Set<string>();
    for (const d of g.dragons) {
      const w = want.get(d.id);
      if (!w) continue;
      seen.add(d.id);
      const sig = `${d.element}|${d.stage}`;
      let e = this.dragons.get(d.id);
      let start: THREE.Vector3 | undefined;
      if (e && e.sig !== sig) {
        if (e.rig && d.stage > 0 && e.sig.split('|')[0] === d.element) {
          // Grown a stage: the same dragon, growing to its new size.
          if (animate) e.grow = { from: e.obj.scale.x, at: now };
          else e.obj.scale.setScalar(STAGE_SCALE[d.stage]);
          e.sig = sig;
        } else {
          // Hatched: the egg shrinks away and the hatchling grows where it lay.
          if (animate) {
            start = e.obj.position.clone();
            this.leave(e.obj, now, 'shrink');
          } else {
            this.world.remove(e.obj);
            dispose(e.obj);
          }
          e = undefined;
        }
      }
      if (!e) {
        const rig = d.stage === 0 ? null : dragonRig(d.element);
        const obj = rig ? rig.root : egg(d.element);
        obj.scale.setScalar(STAGE_SCALE[d.stage]);
        this.world.add(obj);
        e = { sig, view: d, obj, rig, perch: w.pos, face: w.face, home: w.home, seed: hash(d.id) };
        if (animate) {
          e.late = true;
          e.start = start ?? w.pos.clone();
          e.grow = { from: 0, at: now + (start ? 0.3 : 0) };
          obj.scale.setScalar(0.001);
        }
        this.dragons.set(d.id, e);
      }
      e.view = d;
      e.perch = w.pos;
      e.face = w.face;
      e.home = w.home;
    }
    for (const [id, e] of this.dragons) {
      if (seen.has(id)) continue;
      if (animate) this.leave(e.obj, now, 'shrink');
      else {
        this.world.remove(e.obj);
        dispose(e.obj);
      }
      this.dragons.delete(id);
    }
  }

  // ---------- each frame ----------

  private resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Look down at the board from the room's side, as close as fits the land.
    const center = this.bounds.isEmpty() ? new THREE.Vector3() : this.bounds.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(0, Math.sin(CAMERA_TILT), Math.cos(CAMERA_TILT));
    // The canvas runs under the side columns so the sea reaches the screen's
    // edges; the land fits the box it's set in (its parent), centred in it.
    const box = this.el.parentElement;
    const fx = box ? Math.min(1, box.clientWidth / w) : 1;
    const fy = box ? Math.min(1, box.clientHeight / h) : 1;
    const corners = this.fitPoints;
    const fits = (dist: number) => {
      this.camera.position.copy(center).addScaledVector(dir, dist);
      this.camera.lookAt(center.x, 0, center.z + 0.1);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) < 0.96 * fx && Math.abs(p.y) < 0.93 * fy;
      });
    };
    let lo = 2, hi = 200;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
  }

  // The board clock at a point through the first flight a dragon makes (for screenshots).
  private flightAt(frac: number): number | null {
    let best: number | null = null;
    for (const e of this.dragons.values()) {
      if (!e.rig || !canFly(e.view)) continue;
      const s = schedule(e);
      const t = s.offset + frac * s.dur;
      if (best === null || s.offset < best - frac * s.dur) best = t;
    }
    return best;
  }

  private frame() {
    if (document.hidden) return;
    const t = clock();
    for (const b of [...this.built.values(), ...this.beasts.values()]) {
      const pop = b.obj.userData.pop as THREE.Group;
      const age = t - b.born;
      if (age < 1.2) {
        // Folds up from flat on the page, overshoots a little, settles
        // (flat until its turn, when several fold up one after another).
        const back = popUp(Math.max(0, Math.min(1, age / 0.9)));
        pop.rotation.x = (1 - back) * -Math.PI / 2;
        pop.scale.y = Math.max(0.02, Math.min(1.08, back));
      } else if (pop.rotation.x !== 0) {
        pop.rotation.x = 0;
        pop.scale.y = 1;
      }
    }
    // Leaving: a building or beast folds back down flat, the way it came; a
    // dragon or an egg shrinks away.
    this.leaving = this.leaving.filter((l) => {
      const k = smooth(0, LEAVE_S, t - l.at);
      if (k >= 1) {
        this.world.remove(l.obj);
        dispose(l.obj);
        return false;
      }
      if (l.how === 'fold') {
        const pop = l.obj.userData.pop as THREE.Group;
        pop.rotation.x = k * -Math.PI / 2;
        pop.scale.y = Math.max(0.02, 1 - k);
        if (l.beast) this.animateBeast(l.beast, t);
      } else l.obj.scale.setScalar(Math.max(0.001, l.size * (1 - k)));
      return true;
    });
    let regrow = false;
    // Scenery making room: the old folds flat, then the new folds up, in step
    // with the building's own fold-up.
    for (const [k, m] of this.decorMoves) {
      const age = t - m.at;
      if (age > DECOR_S) {
        this.endDecorMove(k);
        regrow = true;
        continue;
      }
      m.old.scale.y = Math.max(0.001, 1 - smooth(0, DECOR_S * 0.45, age));
      m.old.visible = age < DECOR_S * 0.45;
      m.now.scale.y = Math.max(0.001, popUp(Math.min(1, Math.max(0, (age - DECOR_S * 0.35) / (DECOR_S * 0.6)))));
    }
    if (regrow) this.regrowDecor();
    for (const [k, m] of this.marks) {
      const age = t - m.born;
      if (age > FRESH_S) {
        this.unmark(k);
        continue;
      }
      const fade = Math.max(0, Math.min(1, age / 0.4)) * (1 - smooth(FRESH_S - 3, FRESH_S, age));
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = fade * (0.8 + 0.2 * Math.cos(age * 3.5));
    }
    // The acting player's territory border glows gently.
    this.plateMats.forEach((m, i) => {
      const on = this.highlight === i;
      m.emissive.set(on ? PLAYER_COLORS[i] : '#000');
      m.emissiveIntensity = on ? 0.25 + 0.2 * Math.sin(t * 3) : 0;
    });
    const floaters = [this.decor, ...[...this.decorMoves.values()].flatMap((m) => [m.old, m.now])].flatMap((d) => (d.userData.floaters ?? []) as THREE.Object3D[]);
    for (const c of floaters) c.position.y = TOP + 0.03 + Math.sin(t * 1.4 + c.userData.float) * 0.03;
    for (const b of this.beasts.values()) this.animateBeast(b, t);
    const jumped = t < this.lastT || t - this.lastT > 0.5;
    this.lastT = t;
    for (const e of this.dragons.values()) this.animateDragon(e, t, jumped);
    this.renderer.render(this.scene, this.camera);
  }

  // A dragon each frame: where it would be and how it would stand now (posed),
  // eased from how it stood when that last changed, so it never jumps.
  // `jumped`: the clock jumped (the TV was hidden, or a screenshot stepped
  // it), so it's shown as it is now.
  private animateDragon(e: DragonEntry, t: number, jumped: boolean) {
    const key = this.posed(e, t);
    if (jumped) delete e.from;
    const target = readPose(e);
    if (!e.shown && e.start) {
      // Just arrived: from where it appears (a hatchling from its egg).
      e.shown = [...target];
      e.shown.splice(0, 3, e.start.x, e.start.y, e.start.z);
      e.key = '';
    }
    delete e.start;
    if (!jumped && e.shown && e.key !== undefined && e.key !== key) {
      // Taking off, landing, coming down hurt or hungry, settling, or off to a
      // new perch: from where it is now, the further the slower. Over level
      // ground it hops, flapping; from the air it flaps down.
      const a = e.shown;
      const d = Math.hypot(target[0] - a[0], target[1] - a[1], target[2] - a[2]);
      const move = d > 0.15;
      e.from = { pose: a, at: t, dur: Math.min(2, 0.7 + d * 0.45), move, hop: move && Math.abs(target[1] - a[1]) < 0.3 ? Math.min(0.6, 0.15 + d * 0.3) : 0 };
    }
    e.key = key;
    let p = target;
    if (e.from) {
      const u = smooth(0, e.from.dur, t - e.from.at);
      if (u >= 1) delete e.from;
      else {
        const a = e.from.pose;
        p = target.map((v, i) => (i === 3 ? a[3] + (turnTo(a[3], v) - a[3]) * u : a[i] + (v - a[i]) * u));
        const air = e.from.move ? Math.sin(Math.PI * u) : 0;
        p[1] += e.from.hop * air;
        const r = e.rig;
        if (r && air > 0) {
          p[7] += (-0.9 - p[7]) * air; // legs tucked
          const flap = Math.sin(t * (e.view.stage === 1 ? 16 : 9));
          r.wings.forEach((_, i) => {
            const o = 10 + r.tail.length * 2 + i * 4;
            p[o + 1] += (0.15 - p[o + 1]) * air;
            p[o + 2] += (flap * 0.75 + 0.1 - p[o + 2]) * air;
            p[o + 3] += (1 - p[o + 3]) * air;
          });
        }
        writePose(e, p);
      }
    }
    e.shown = p;
    // Growing a stage, or just arrived: from its old size to its new one.
    if (e.grow) {
      const to = STAGE_SCALE[e.view.stage];
      const k = (t - e.grow.at) / 0.8;
      if (k >= 1) {
        e.obj.scale.setScalar(to);
        delete e.grow;
      } else e.obj.scale.setScalar(Math.max(0.001, e.grow.from + (to - e.grow.from) * popUp(Math.max(0, k))));
    }
  }

  // Poses a dragon where it would be now, with nothing eased; says what it's
  // doing, so a change can be eased.
  private posed(e: DragonEntry, t: number): string {
    const ph = (e.seed % 628) / 100;
    const at = `${e.perch.x.toFixed(3)},${e.perch.z.toFixed(3)}`;
    if (!e.rig) {
      // Eggs rock now and then.
      const shell = e.obj.userData.shell as THREE.Mesh;
      const w = Math.sin(t * 0.7 + ph);
      shell.rotation.z = w > 0.93 ? Math.sin(t * 18) * 0.12 : 0;
      e.obj.position.copy(e.perch);
      return `egg|${at}`;
    }
    const r = e.rig;
    const s = schedule(e);
    const since = t - s.offset;
    // A flight it can't make from the start it sits out: one already under way
    // when it gets well, or when it arrives, goes on without it.
    const n = since > 0 ? Math.floor(since / s.period) : -1;
    const due = since > 0 && since % s.period < s.dur;
    if (due && (!canFly(e.view) || e.late)) e.skip = n;
    e.late = false;
    const ft = canFly(e.view) && due && e.skip !== n ? since % s.period : Infinity;
    const resting = e.view.status === 'hurt' || e.view.status === 'hungry';
    if (ft < s.dur) {
      // In the air: take off, circle home, land where it took off from.
      const radius = e.view.stage === 1 ? 1.1 : 1.6 + (e.seed % 5) * 0.12;
      const height = e.view.stage === 1 ? 1.2 : 1.5 + (e.seed % 3) * 0.2;
      const dir = e.seed % 2 ? 1 : -1;
      const mid = this.bounds.getCenter(new THREE.Vector3());
      const home = e.home.clone().lerp(new THREE.Vector3(mid.x, 0, mid.z), 0.3);
      const a0 = Math.atan2(e.perch.z - home.z, e.perch.x - home.x);
      const pos = (u: number) => {
        const k = smooth(0, 1.6, u) * (1 - smooth(s.dur - 1.8, s.dur, u));
        const a = a0 + dir * (u / s.dur) * Math.PI * 2 * 1.25 * smooth(0, 1.2, u);
        const circle = new THREE.Vector3(home.x + Math.cos(a) * radius, GROUND + height + Math.sin(u * 1.7) * 0.15, home.z + Math.sin(a) * radius);
        return e.perch.clone().lerp(circle, k);
      };
      const p = pos(ft), q = pos(ft + 0.05);
      e.obj.position.copy(p);
      const vel = q.clone().sub(p);
      const flat = Math.hypot(vel.x, vel.z);
      if (flat > 0.002) e.obj.rotation.y = Math.atan2(vel.x, vel.z);
      const climb = Math.atan2(vel.y, Math.max(flat, 0.001));
      r.body.rotation.x = -climb * 0.6;
      r.body.rotation.z = dir * -0.35 * smooth(1, 2.5, ft) * (1 - smooth(s.dur - 2.5, s.dur - 1, ft));
      const flap = Math.sin(ft * (e.view.stage === 1 ? 16 : 9));
      const gliding = smooth(2.5, 3.2, ft) * (1 - smooth(s.dur - 3, s.dur - 2.4, ft)) * (Math.sin(ft * 0.9) > 0.3 ? 1 : 0);
      for (const w of r.wings) {
        w.rotation.set(0, 0.15, flap * (0.75 - 0.6 * gliding) + 0.1);
        w.scale.setScalar(1);
      }
      r.legs.rotation.x = -0.9 * smooth(0, 0.6, ft) * (1 - smooth(s.dur - 0.6, s.dur, ft));
      r.neck.rotation.set(0.95, 0, 0);
      r.tail.forEach((seg, i) => (seg.rotation.set(i === 0 ? 0.05 : -0.04, Math.sin(ft * 3 - i) * 0.12, 0)));
      r.body.position.y = 0.4;
      return `fly|${e.view.stage}|${at}`;
    }
    // At home: breathing, looking about, the tail swishing, wings folded.
    e.obj.position.copy(e.perch);
    e.obj.rotation.y = e.face;
    r.body.rotation.set(resting ? 0.08 : 0, 0, 0);
    r.body.position.y = resting ? 0.3 : 0.4 + Math.sin(t * 1.8 + ph) * 0.012;
    r.legs.rotation.x = resting ? -1.2 : 0;
    const look = Math.sin(t * 0.37 + ph) * 0.6 + Math.sin(t * 0.13 + ph * 2) * 0.3;
    r.neck.rotation.set(resting ? 1.5 : 0.3 + Math.sin(t * 0.5 + ph) * 0.08, resting ? 0 : look * 0.7, 0);
    r.tail.forEach((seg, i) => seg.rotation.set(i === 0 ? (resting ? 0.4 : 0.25) : -0.12, Math.sin(t * 1.1 + ph - i * 0.7) * 0.25, 0));
    // Now and then it stretches its wings.
    const stretch = smooth(0.85, 0.95, Math.sin(t * 0.21 + ph * 3)) * (resting ? 0 : 1);
    for (const w of r.wings) {
      // Half raised, swept back; folded flat when it's resting.
      const up = resting ? 0.1 : 0.75 + stretch * 0.4;
      w.rotation.set(0, (resting ? 1.3 : 0.75) - stretch * 0.6, up + Math.sin(t * 6) * 0.08 * stretch);
      w.scale.setScalar(resting ? 0.55 : 0.78 + 0.22 * stretch);
    }
    return `home|${resting}|${e.view.stage}|${at}|${e.face.toFixed(3)}`;
  }
}
