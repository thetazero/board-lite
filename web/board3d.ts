// The TV's board in 3D: a pop-up book. The hex map is cut from coloured card
// and lies on an open book; buildings are folded paper models that pop up when
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
import { ELEMENT_COLORS, PLAYER_COLORS, RESOURCE_COLORS, TERRAIN_COLORS } from './common.ts';

declare global {
  interface Window {
    boardClock?: number;
    boardFlightAt?: (frac: number) => number | null;
  }
}

const SQ3 = Math.sqrt(3);
const TILE_H = 0.2; // card thickness of a hex
const TILE_LIFT = 0.05; // the fold up to the middle of a hex
const TOP = TILE_H + TILE_LIFT * 0.5; // where things stand on a hex
const PLATE_H = 0.05;
const GROUND = TOP + PLATE_H; // where a building stands on its plate

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

// Paper grain: soft blotches and fibres, multiplied into every colour.
function paperTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 256, 256);
  const r = rng('paper');
  for (let i = 0; i < 2200; i++) {
    const v = 225 + Math.floor(r() * 30);
    x.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.25 + r() * 0.3})`;
    x.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
  }
  x.strokeStyle = 'rgba(150,135,110,.10)';
  for (let i = 0; i < 160; i++) {
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

// A hex cut from card, its top folded up a little to a point in the middle.
function tileGeometry(): THREE.BufferGeometry {
  const R = 0.965;
  const pos: number[] = [];
  const uv: number[] = [];
  const corner = (i: number) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return new THREE.Vector3(R * Math.cos(a), 0, R * Math.sin(a));
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const [p, q, s] = n.dot(out) >= 0 ? [a, b, c] : [a, c, b];
    for (const v of [p, q, s]) {
      pos.push(v.x, v.y, v.z);
      uv.push(v.x * 0.35 + v.y * 0.35, v.z * 0.35);
    }
  };
  const top = new THREE.Vector3(0, TILE_H + TILE_LIFT, 0);
  for (let i = 0; i < 6; i++) {
    const p = corner(i), q = corner(i + 1);
    const pt = p.clone().setY(TILE_H), qt = q.clone().setY(TILE_H);
    tri(top, pt, qt, new THREE.Vector3(0, 1, 0));
    const out = p.clone().add(q).normalize();
    tri(pt, p, q, out);
    tri(pt, q, qt, out);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
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

// What grows on a hex. With a building on it, only a little at the rim.
function decor(h: HexView): THREE.Group {
  const r = rng(h.k);
  const g = new THREE.Group();
  const built = !!h.building;
  // Spots around the hex: the middle is kept for a building.
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
      if (built) {
        place(peak(0.22, 0.42, 5, r() * 3, true), rim());
        place(peak(0.16, 0.3, 4, r() * 3, false), rim());
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
      } else if (h.building!.type !== 'tower') {
        place(part(cone(0.1, 0.17, 6), '#d6ad55', { at: [0, 0.085, 0] }), rim());
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

function tower(pc: string, floors: number, gilded: boolean): THREE.Group {
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
  g.add(part(cone(0.4, 0.62, 6), gilded ? GOLD : pc, { at: [0, h + 0.31 + 0.04, 0] }));
  const f = flag(gilded ? GOLD : pc, 0.35);
  f.position.y = h + 0.6;
  g.add(f);
  // Door and windows face the room.
  g.add(part(box(0.13, 0.22, 0.02), DARK, { at: [0, 0.11, 0.315], crease: false }));
  for (let i = 0; i <= floors; i++) g.add(part(box(0.06, 0.1, 0.02), DARK, { at: [0, base * 0.62 + i * step, 0.3], crease: false }));
  return g;
}

function quarry(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.DodecahedronGeometry(0.42, 0), STONE_DARK, { at: [-0.12, 0.16, -0.2], scale: [1.1, 0.75, 0.75] }));
  // Cut blocks, stacked.
  const blocks: [number, number, number][] = [[0.12, 0.08, 0.2], [0.32, 0.08, 0.18], [0.22, 0.24, 0.19], [0.36, 0.08, -0.04]];
  for (const b of blocks) g.add(part(box(0.18, 0.16, 0.18), mix(STONE, WALL, 0.25), { at: b }));
  // A wooden crane with a block on its rope.
  g.add(part(box(0.05, 0.75, 0.05), WOOD, { at: [-0.3, 0.37, 0.22] }));
  g.add(part(box(0.62, 0.05, 0.05), WOOD, { at: [-0.06, 0.72, 0.22], rot: [0, 0, -0.1] }));
  g.add(part(box(0.01, 0.28, 0.01), DARK, { at: [0.2, 0.55, 0.22], crease: false }));
  g.add(part(box(0.13, 0.11, 0.13), mix(STONE, WALL, 0.25), { at: [0.2, 0.39, 0.22] }));
  return g;
}

function lumberCamp(pc: string): THREE.Group {
  const g = new THREE.Group();
  const c = cottage(0.46, 0.36, 0.3, mix(WOOD, WALL, 0.35), pc);
  c.position.set(-0.08, 0, -0.16);
  g.add(c);
  for (const [x, y, z] of [[-0.09, 0.07, 0.3], [0.07, 0.07, 0.3], [-0.01, 0.2, 0.3]] as [number, number, number][]) {
    g.add(part(cyl(0.07, 0.07, 0.5, 6), WOOD, { at: [x + 0.15, y, z], rot: [0, 0.3, Math.PI / 2] }));
  }
  const t = tree(0.95, LEAF[0]);
  t.position.set(0.42, 0, -0.18);
  g.add(t);
  return g;
}

function crystalMine(pc: string): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.DodecahedronGeometry(0.45, 0), '#8c8073', { at: [0, 0.12, -0.08], scale: [1.05, 0.72, 0.9] }));
  // The adit: a dark mouth in a timber frame.
  g.add(part(box(0.22, 0.24, 0.05), DARK, { at: [0, 0.12, 0.33], crease: false }));
  g.add(part(box(0.04, 0.28, 0.06), WOOD, { at: [-0.13, 0.14, 0.35] }));
  g.add(part(box(0.04, 0.28, 0.06), WOOD, { at: [0.13, 0.14, 0.35] }));
  g.add(part(box(0.32, 0.05, 0.07), WOOD, { at: [0, 0.29, 0.35] }));
  for (const [x, z, h, tilt] of [[-0.12, -0.15, 0.42, -0.3], [0.1, -0.1, 0.5, 0.2], [0.26, 0.05, 0.3, 0.6]]) {
    const c = crystal(h, '#b98cff');
    c.position.set(x, 0.42 + h * 0.4, z);
    c.rotation.z = tilt;
    g.add(c);
  }
  g.add(part(box(0.18, 0.1, 0.12), pc, { at: [0.33, 0.07, 0.36], rot: [0, 0.4, 0] }));
  return g;
}

function sheep(): THREE.Group {
  return group(
    part(new THREE.DodecahedronGeometry(0.1, 0), '#fbf7ee', { scale: [1.3, 0.95, 1], at: [0, 0.12, 0] }),
    part(box(0.07, 0.07, 0.09), DARK, { at: [0.15, 0.15, 0], crease: false }),
  );
}

function pasture(pc: string): THREE.Group {
  const g = new THREE.Group();
  const n = 12, R = 0.62;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    g.add(part(box(0.04, 0.2, 0.04), WOOD, { at: [Math.cos(a) * R, 0.1, Math.sin(a) * R] }));
    if (i % 6 === 2) continue; // a gate
    const mx = (Math.cos(a) + Math.cos(b)) / 2 * R, mz = (Math.sin(a) + Math.sin(b)) / 2 * R;
    const len = 2 * R * Math.sin(Math.PI / n);
    g.add(part(box(len, 0.03, 0.02), mix(WOOD, WALL, 0.3), { at: [mx, 0.14, mz], rot: [0, -(a + b) / 2 + Math.PI / 2, 0], crease: false }));
  }
  const shed = cottage(0.3, 0.24, 0.2, WALL, pc);
  shed.position.set(-0.15, 0, -0.28);
  g.add(shed);
  for (const [x, z, a] of [[0.18, 0.12, 0.6], [-0.2, 0.25, 2.4], [0.3, -0.18, -1]]) {
    const s = sheep();
    s.position.set(x, 0, z);
    s.rotation.y = a;
    g.add(s);
  }
  return g;
}

function roost(pc: string): THREE.Group {
  const f = flag(pc, 0.5);
  f.position.set(-0.45, 0.4, -0.25);
  return group(
    part(cyl(0.48, 0.58, 0.32, 6), STONE, { at: [0, 0.16, 0] }),
    part(cyl(0.52, 0.48, 0.08, 6), mix(STONE, WALL, 0.3), { at: [0, 0.36, 0] }),
    part(new THREE.TorusGeometry(0.42, 0.08, 3, 9), WOOD_DARK, { at: [0, 0.42, 0], rot: [Math.PI / 2, 0, 0] }),
    f,
  );
}

function nest(): THREE.Mesh {
  return part(new THREE.TorusGeometry(0.16, 0.05, 3, 7), WOOD_DARK, { at: [0, 0.03, 0], rot: [Math.PI / 2, 0, 0] });
}

function hatchery(pc: string): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.4, 0.42, 0.3, 8), WALL, { at: [-0.1, 0.15, -0.15] }));
  g.add(part(new THREE.SphereGeometry(0.4, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), pc, { at: [-0.1, 0.3, -0.15] }));
  g.add(part(new THREE.IcosahedronGeometry(0.09, 0), GOLD, { at: [-0.1, 0.76, -0.15], scale: [1, 1.3, 1] }));
  g.add(part(box(0.14, 0.2, 0.02), DARK, { at: [0.02, 0.1, 0.23], rot: [0, 0.3, 0], crease: false }));
  const n = nest();
  n.position.set(0.35, 0, 0.3);
  g.add(n);
  return g;
}

function market(pc: string): THREE.Group {
  const g = new THREE.Group();
  g.add(part(box(0.72, 0.24, 0.32), WOOD, { at: [0, 0.12, 0.05] }));
  for (const [x, z] of [[-0.34, -0.12], [0.34, -0.12], [-0.34, 0.2], [0.34, 0.2]]) g.add(part(box(0.035, 0.62, 0.035), WOOD_DARK, { at: [x, 0.31, z], crease: false }));
  // A striped awning.
  const awning = new THREE.Group();
  for (let i = 0; i < 6; i++) awning.add(part(box(0.14, 0.02, 0.5), i % 2 ? WALL : pc, { at: [-0.35 + i * 0.14, 0, 0] }));
  awning.position.set(0, 0.66, 0.06);
  awning.rotation.x = 0.32;
  g.add(awning);
  // Goods on the counter, in the resources' colours.
  ['stone', 'timber', 'crystal', 'gold'].forEach((res, i) => g.add(part(box(0.1, 0.08, 0.1), RESOURCE_COLORS[res], { at: [-0.24 + i * 0.16, 0.28, 0.08] })));
  g.add(part(box(0.16, 0.16, 0.16), WOOD, { at: [0.28, 0.08, 0.42], rot: [0, 0.4, 0] }));
  g.add(part(cyl(0.08, 0.08, 0.18, 8), WOOD_DARK, { at: [-0.3, 0.09, 0.42] }));
  return g;
}

function caravanPost(pc: string): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cone(0.34, 0.55, 4), pc, { at: [-0.22, 0.275, -0.2], rot: [0, Math.PI / 4, 0] }));
  const wagon = new THREE.Group();
  wagon.add(part(box(0.5, 0.12, 0.26), WOOD, { at: [0, 0.16, 0] }));
  wagon.add(part(new THREE.CylinderGeometry(0.14, 0.14, 0.46, 6, 1, false, -Math.PI / 2, Math.PI), WALL, { at: [0, 0.22, 0], rot: [0, 0, Math.PI / 2], two: true }));
  for (const [x, z] of [[-0.16, 0.14], [0.16, 0.14], [-0.16, -0.14], [0.16, -0.14]]) wagon.add(part(cyl(0.09, 0.09, 0.03, 8), WOOD_DARK, { at: [x, 0.09, z], rot: [Math.PI / 2, 0, 0] }));
  wagon.position.set(0.15, 0, 0.22);
  wagon.rotation.y = -0.35;
  g.add(wagon);
  const f = flag(pc, 0.55);
  f.position.set(0.38, 0, -0.25);
  g.add(f);
  return g;
}

function monument(gilded: boolean): THREE.Group {
  const stone = mix(STONE, WALL, 0.55);
  return group(
    part(box(0.6, 0.1, 0.6), stone, { at: [0, 0.05, 0] }),
    part(box(0.42, 0.1, 0.42), stone, { at: [0, 0.15, 0] }),
    part(cyl(0.07, 0.15, 1.15, 4), gilded ? mix(GOLD, WALL, 0.35) : stone, { at: [0, 0.775, 0], rot: [0, Math.PI / 4, 0] }),
    part(cone(0.1, 0.18, 4), GOLD, { at: [0, 1.44, 0], rot: [0, Math.PI / 4, 0], glow: 0.15 }),
  );
}

// Where a building's dragons sit, in the building's own frame.
interface Perch { x: number; y: number; z: number; face: number }

const PERCHES: Record<string, Perch[]> = {
  // Side-on to the room, so each shows its profile: neck, wings, tail.
  tower: [{ x: 0.3, y: 0, z: 0.42, face: 1.75 }, { x: -0.5, y: 0, z: 0.3, face: -1.4 }],
  roost: [{ x: 0.05, y: 0.4, z: 0.3, face: 1.65 }, { x: -0.1, y: 0.42, z: -0.32, face: -1.5 }, { x: 0.4, y: 0.4, z: -0.05, face: 2.6 }],
  hatchery: [{ x: 0.35, y: 0, z: 0.3, face: 0.6 }],
};

function buildingModel(b: NonNullable<HexView['building']>): { model: THREE.Group; offset: [number, number] } {
  const pc = PLAYER_COLORS[b.owner];
  const up = !!b.upgrade;
  switch (b.type) {
    case 'tower': return { model: tower(pc, b.floors, up && b.upgrade === 'gilding'), offset: [-0.15, -0.2] };
    case 'quarry': return { model: quarry(), offset: [0, 0] };
    case 'lumber_camp': return { model: lumberCamp(pc), offset: [0, 0] };
    case 'crystal_mine': return { model: crystalMine(pc), offset: [0, 0] };
    case 'pasture': return { model: pasture(pc), offset: [0, 0] };
    case 'roost': return { model: roost(pc), offset: [0, 0] };
    case 'hatchery': return { model: hatchery(pc), offset: [0, 0] };
    case 'market': return { model: market(pc), offset: [0, 0] };
    case 'caravan_post': return { model: caravanPost(pc), offset: [0, 0] };
    case 'monument': return { model: monument(up), offset: [0, 0] };
    default: return { model: group(part(box(0.4, 0.4, 0.4), pc, { at: [0, 0.2, 0] })), offset: [0, 0] };
  }
}

// The owner's coloured card under a building; an upgrade puts a gold rim round it
// and a gold pennant beside it.
function plate(owner: number, upgraded: boolean, mats: THREE.MeshLambertMaterial[]): THREE.Group {
  const g = new THREE.Group();
  if (upgraded) g.add(part(cyl(0.87, 0.88, PLATE_H * 0.8, 6), GOLD, { at: [0, TOP + PLATE_H * 0.4 - 0.005, 0] }));
  const m = new THREE.Mesh(cyl(upgraded ? 0.78 : 0.84, upgraded ? 0.79 : 0.85, PLATE_H, 6), mats[owner]);
  m.position.y = TOP + PLATE_H / 2;
  m.receiveShadow = true;
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), CREASE));
  g.add(m);
  if (upgraded) {
    const f = flag(GOLD, 0.45);
    f.position.set(-0.55, GROUND, 0.42);
    g.add(f);
  }
  return g;
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
}

// When a dragon flies: every `period` seconds from `offset`, for `dur` seconds.
function schedule(d: DragonEntry): { offset: number; period: number; dur: number } {
  const h = (d.seed % 1000) / 1000;
  return { offset: 6 + h * 20, period: 28 + h * 14, dur: d.view.stage === 1 ? 7 : 10 };
}

const canFly = (d: DragonView) => d.stage > 0 && d.status !== 'hurt' && d.status !== 'hungry';

// ---------- the board ----------

interface Built { sig: string; obj: THREE.Group; born: number }

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
  private dragons = new Map<string, DragonEntry>();
  private plateMats = PLAYER_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c, map: null, flatShading: true }));
  private highlight: number | null = null;
  private bounds = new THREE.Box3();
  private fitPoints: THREE.Vector3[] = []; // what the camera must keep in view
  private firstUpdate = true;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'board3d';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.append(this.renderer.domElement);
    GRAIN ??= paperTexture();
    this.plateMats.forEach((m) => (m.map = GRAIN));

    this.scene.add(new THREE.HemisphereLight('#fff6e6', '#5a4a3c', 1.25));
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.9);
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
    let regrow = false;
    for (const h of g.map) {
      const t = this.tiles.get(h.k)!;
      t.hex = h;
      const decorSig = h.building ? `b${h.building.type}` : '';
      if (decorSig !== t.decorSig) regrow = true;
      t.decorSig = decorSig;
    }
    if (regrow) {
      this.world.remove(this.decor);
      dispose(this.decor);
      const all = new THREE.Group();
      for (const h of g.map) {
        const d = decor(h);
        const [x, z] = hexXZ(h.q, h.r);
        d.position.set(x, 0, z);
        all.add(d);
      }
      this.decor = bake(all);
      this.world.add(this.decor);
    }
    for (const h of g.map) {
      const b = h.building;
      const bsig = b ? `${b.type}|${b.owner}|${b.upgrade}|${b.floors}` : '';
      const had = this.built.get(h.k);
      if (had?.sig === bsig) continue;
      if (had) {
        this.world.remove(had.obj);
        dispose(had.obj);
        this.built.delete(h.k);
      }
      if (!b) continue;
      const obj = this.placed(this.buildingGroup(b), h);
      // Pop up from the page when it's new; a new floor or upgrade pops up too.
      const fresh = animate && (!had || had.sig.split('|')[0] !== b.type || had.sig !== bsig);
      this.built.set(h.k, { sig: bsig, obj, born: fresh ? now : -1e9 });
    }
    this.placeDragons(g);
    this.firstUpdate = false;
  }

  // ---------- building the scene ----------

  private placed(o: THREE.Object3D, h: HexView): THREE.Group {
    const [x, z] = hexXZ(h.q, h.r);
    const g = o instanceof THREE.Group ? o : group(o);
    g.position.set(x, 0, z);
    this.world.add(g);
    return g;
  }

  private buildingGroup(b: NonNullable<HexView['building']>): THREE.Group {
    const g = plate(b.owner, !!b.upgrade, this.plateMats);
    const { model: parts, offset } = buildingModel(b);
    const model = bake(parts);
    const pop = new THREE.Group(); // hinged at the hex's back edge, for the pop-up
    pop.position.set(0, GROUND, -0.6);
    model.scale.setScalar(1.15);
    model.position.set(offset[0], 0, offset[1] + 0.6);
    pop.add(model);
    g.add(pop);
    g.userData.pop = pop;
    return g;
  }

  private buildMap(map: HexView[], sig: string) {
    for (const o of [...this.world.children]) {
      this.world.remove(o);
      dispose(o);
    }
    this.tiles.clear();
    this.built.clear();
    this.dragons.clear();
    this.mapSig = sig;
    const geo = tileGeometry();
    const tiles = new THREE.Group();
    for (const h of map) {
      const r = rng(`tile${h.k}`);
      const [x, z] = hexXZ(h.q, h.r);
      tiles.add(part(geo, mix(TERRAIN_COLORS[h.terrain], '#f4ecd8', 0.12), { at: [x, (r() - 0.5) * 0.03, z] }));
      this.tiles.set(h.k, { hex: h, decorSig: '-' });
    }
    this.world.add(bake(tiles));
    // The open book the map is pasted into.
    this.bounds.makeEmpty();
    for (const h of map) {
      const [x, z] = hexXZ(h.q, h.r);
      this.bounds.expandByPoint(new THREE.Vector3(x - 1, 0, z - 1)).expandByPoint(new THREE.Vector3(x + 1, 1.6, z + 1));
    }
    // Every hex's outline, the tops of tall buildings, and the sky where dragons fly.
    this.fitPoints = map.flatMap((h) => {
      const [x, z] = hexXZ(h.q, h.r);
      return [[0.95, 0, 0], [-0.95, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1.6, 0]].map(([dx, y, dz]) => new THREE.Vector3(x + dx, y, z + dz));
    });
    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());
    const w = size.x + 2.4, d = size.z + 1.6;
    const pageMat = '#e8dcc2';
    for (const s of [-1, 1]) {
      const page = part(box(w / 2, 0.12, d), pageMat, { at: [center.x + s * w / 4, -0.07 + 0.04, center.z], rot: [0, 0, s * 0.012], crease: false });
      page.castShadow = false;
      this.world.add(page);
      // Stacked page edges.
      const edge = part(box(w / 2 - 0.1, 0.1, d - 0.12), '#e3d6bb', { at: [center.x + s * (w / 4 - 0.02), -0.16, center.z], crease: false });
      edge.castShadow = false;
      this.world.add(edge);
    }
    const cover = part(box(w + 0.5, 0.08, d + 0.4), '#7a2f2a', { at: [center.x, -0.25, center.z], crease: false });
    cover.castShadow = false;
    this.world.add(cover);
    this.world.add(part(box(0.05, 0.02, d), '#d9caa8', { at: [center.x, -0.005, center.z], crease: false })); // the gutter

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

  private placeDragons(g: PublicState) {
    // Perches: each owner's tower, roosts and hatcheries, in that order; eggs
    // go to a hatchery's nest first. Any extra dragons stand round the tower.
    const perches = new Map<number, { pos: THREE.Vector3; face: number; home: THREE.Vector3; egg: boolean }[]>();
    const towers = new Map<number, THREE.Vector3>();
    for (const h of g.map) {
      const b = h.building;
      if (!b || !PERCHES[b.type]) continue;
      const [x, z] = hexXZ(h.q, h.r);
      const center = new THREE.Vector3(x, 0, z);
      if (b.type === 'tower') towers.set(b.owner, center);
      const n = b.type === 'tower' ? 1 + (b.upgrade === 'nesting_grounds' ? 1 : 0) : b.type === 'roost' ? 2 + (b.upgrade === 'nesting_grounds' ? 1 : 0) : 1;
      const list = perches.get(b.owner) ?? [];
      PERCHES[b.type].slice(0, n).forEach((p) => list.push({ pos: new THREE.Vector3(x + p.x, GROUND + p.y, z + p.z), face: p.face, home: center, egg: b.type === 'hatchery' }));
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
        const p = free.length ? take(d.stage === 0) : null;
        if (p) want.set(d.id, p);
        else {
          const a = 2.2 + extra++ * 0.9;
          want.set(d.id, { pos: new THREE.Vector3(tower.x + Math.cos(a) * 0.62, GROUND, tower.z + Math.sin(a) * 0.62), face: a + Math.PI / 2, home: tower });
        }
      }
    }
    const seen = new Set<string>();
    for (const d of g.dragons) {
      const w = want.get(d.id);
      if (!w) continue;
      seen.add(d.id);
      const sig = `${d.element}|${d.stage}`;
      let e = this.dragons.get(d.id);
      if (e && e.sig !== sig) {
        this.world.remove(e.obj);
        dispose(e.obj);
        e = undefined;
      }
      if (!e) {
        const rig = d.stage === 0 ? null : dragonRig(d.element);
        const obj = rig ? rig.root : egg(d.element);
        obj.scale.setScalar(STAGE_SCALE[d.stage]);
        this.world.add(obj);
        e = { sig, view: d, obj, rig, perch: w.pos, face: w.face, home: w.home, seed: hash(d.id) };
        this.dragons.set(d.id, e);
      }
      e.view = d;
      e.perch = w.pos;
      e.face = w.face;
      e.home = w.home;
    }
    for (const [id, e] of this.dragons) {
      if (seen.has(id)) continue;
      this.world.remove(e.obj);
      dispose(e.obj);
      this.dragons.delete(id);
    }
  }

  // ---------- each frame ----------

  private resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Look down at the board from the room's side, as close as fits it all.
    const center = this.bounds.isEmpty() ? new THREE.Vector3() : this.bounds.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(0, Math.sin(0.76), Math.cos(0.76));
    const corners = this.fitPoints;
    const fits = (dist: number) => {
      this.camera.position.copy(center).addScaledVector(dir, dist);
      this.camera.lookAt(center.x, 0, center.z + 0.1);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) < 0.96 && Math.abs(p.y) < 0.93;
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
    for (const b of this.built.values()) {
      const pop = b.obj.userData.pop as THREE.Group;
      const age = t - b.born;
      if (age < 1.2) {
        // Folds up from flat on the page, overshoots a little, settles.
        const k = Math.min(1, age / 0.9);
        const back = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
        pop.rotation.x = (1 - back) * -Math.PI / 2;
        pop.scale.y = Math.max(0.02, Math.min(1.08, back));
      } else if (pop.rotation.x !== 0) {
        pop.rotation.x = 0;
        pop.scale.y = 1;
      }
    }
    // The acting player's plates glow gently.
    this.plateMats.forEach((m, i) => {
      const on = this.highlight === i;
      m.emissive.set(on ? PLAYER_COLORS[i] : '#000');
      m.emissiveIntensity = on ? 0.25 + 0.2 * Math.sin(t * 3) : 0;
    });
    for (const c of (this.decor.userData.floaters ?? []) as THREE.Object3D[]) c.position.y = TOP + 0.03 + Math.sin(t * 1.4 + c.userData.float) * 0.03;
    for (const e of this.dragons.values()) this.animateDragon(e, t);
    this.renderer.render(this.scene, this.camera);
  }

  private animateDragon(e: DragonEntry, t: number) {
    const ph = (e.seed % 628) / 100;
    if (!e.rig) {
      // Eggs rock now and then.
      const shell = e.obj.userData.shell as THREE.Mesh;
      const w = Math.sin(t * 0.7 + ph);
      shell.rotation.z = w > 0.93 ? Math.sin(t * 18) * 0.12 : 0;
      e.obj.position.copy(e.perch);
      return;
    }
    const r = e.rig;
    const s = schedule(e);
    const since = t - s.offset;
    const ft = canFly(e.view) && since > 0 ? since % s.period : Infinity;
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
      return;
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
  }
}
