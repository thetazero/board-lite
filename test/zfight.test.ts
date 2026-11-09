import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BUILDINGS, ELEMENTS, FAUNA, UPGRADES } from '../src/data.ts';
import { modelsForTest, type Portrait } from '../web/board3d.ts';

// No z-fighting on the 3D board (#421): wherever two faces lie in the same
// plane, facing the same way, and overlap, the renderer flickers between them
// and draws a broken pattern. This builds every model the board, the rulebook
// and the fights draw, as they're drawn, and looks for such faces.
//
// The models are built in Node: three.js builds geometry without a browser;
// only the paper texture wants a canvas (when a model is first built), and a
// blank one does.

const blank = () => new Proxy({}, { get: (_, k) => (k === 'getContext' ? () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) : undefined), set: () => true });
Object.assign(globalThis, { window: globalThis, document: { createElement: blank } });

// Two faces closer than this to one plane are in it, as the TV draws them
// (world units; a hex is about 2 across). Seen from the board's camera, tens
// of units away with its near plane at 0.1, the depth buffer can't tell apart
// faces a millimetre or two apart, so a fix moves a face by more than this.
const PLANE = 4e-3;
// Faces must share more than this area to fight (just touching edges don't).
const AREA = 1e-5;

type Tri = { p: THREE.Vector3[]; n: THREE.Vector3; d: number; sides: number; lo: THREE.Vector3; hi: THREE.Vector3; who: string };

// Every triangle of a model, in its world, with the way it shows (1 its
// front, -1 its back, 0 both).
function triangles(root: THREE.Object3D): Tri[] {
  root.updateMatrixWorld(true);
  const out: Tri[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const mat = o.material as THREE.Material;
    const sides = mat.side === THREE.DoubleSide ? 0 : mat.side === THREE.BackSide ? -1 : 1;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = g.getAttribute('position');
    const geo = o.geometry as THREE.BufferGeometry & { parameters?: Record<string, unknown> };
    const args = geo.parameters ? Object.values(geo.parameters).filter((v) => typeof v === 'number').map((v) => +(v as number).toFixed(3)).join(',') : '';
    const at = o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join(',');
    const who = `${geo.type.replace('Geometry', '')}(${args}) #${(mat as THREE.MeshLambertMaterial).color?.getHexString() ?? '?'} at ${at}`;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const p = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, i + j).applyMatrix4(o.matrixWorld));
      const n = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0]));
      if (n.length() < 1e-12) continue;
      n.normalize();
      const lo = p[0].clone().min(p[1]).min(p[2]), hi = p[0].clone().max(p[1]).max(p[2]);
      out.push({ p, n, d: n.dot(p[0]), sides, lo, hi, who });
    }
  });
  return out;
}

// The area two coplanar triangles share: one clipped by the other, in their plane.
function shared(a: Tri, b: Tri): number {
  const u = a.p[1].clone().sub(a.p[0]).normalize();
  const v = new THREE.Vector3().crossVectors(a.n, u);
  const flat = (t: Tri) => {
    const pts = t.p.map((q) => [q.clone().sub(a.p[0]).dot(u), q.clone().sub(a.p[0]).dot(v)] as [number, number]);
    const area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]);
    return area < 0 ? pts.reverse() : pts; // counter-clockwise
  };
  let poly = flat(b);
  const clip = flat(a);
  for (let i = 0; i < 3 && poly.length; i++) {
    const [x1, y1] = clip[i], [x2, y2] = clip[(i + 1) % 3];
    const side = ([x, y]: [number, number]) => (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    const next: [number, number][] = [];
    poly.forEach((p, j) => {
      const q = poly[(j + 1) % poly.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    poly = next;
  }
  let s = 0;
  poly.forEach((p, j) => {
    const q = poly[(j + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(s) / 2;
}

// Pairs of faces in one plane that overlap and show on the same side.
export function fights(root: THREE.Object3D): { at: THREE.Vector3; area: number; a: string; b: string }[] {
  const tris = triangles(root).sort((x, y) => x.lo.x - y.lo.x);
  const found: { at: THREE.Vector3; area: number; a: string; b: string }[] = [];
  for (let i = 0; i < tris.length; i++) {
    const a = tris[i];
    for (let j = i + 1; j < tris.length && tris[j].lo.x <= a.hi.x + PLANE; j++) {
      const b = tris[j];
      if (b.lo.y > a.hi.y + PLANE || b.hi.y < a.lo.y - PLANE || b.lo.z > a.hi.z + PLANE || b.hi.z < a.lo.z - PLANE) continue;
      const dot = a.n.dot(b.n);
      if (Math.abs(dot) < 0.9999) continue;
      if (b.p.some((q) => Math.abs(a.n.dot(q) - a.d) > PLANE)) continue;
      // Facing apart, each hides the other's back: only both-sided paper fights.
      const facing = Math.sign(dot);
      if (a.sides && b.sides && a.sides * b.sides * facing < 0) continue;
      // Facing straight down, both, from a single side: no camera looks up at them.
      if (a.sides && b.sides && a.n.y * a.sides < -0.99) continue;
      const area = shared(a, b);
      if (area > AREA) found.push({ at: a.p[0].clone().add(a.p[1]).add(a.p[2]).divideScalar(3), area, a: a.who, b: b.who });
    }
  }
  return found;
}

// Every hex the rulebook pictures, and more: each building on its terrain,
// with each upgrade, shut by a beast or a perched dragon, in its owner's
// border; each beast and dragon, on open ground and on a building.
function hexes(): Portrait[] {
  const out: Portrait[] = [];
  const terrains = ['mountain', 'forest', 'ley', 'meadow', 'desert', 'harbor', 'ocean'];
  for (const t of terrains) out.push({ terrain: t }, { terrain: t, held: 'thunderbird' }, { terrain: t, peakZone: 2 });
  const buildings = [...Object.entries(BUILDINGS).filter(([k]) => k !== 'tower_floor').map(([k, b]) => [k, b.terrain ?? 'desert'] as const), ['tower', 'desert'] as const];
  for (const [b, t] of buildings) {
    out.push({ terrain: t, building: b, border: true }, { terrain: t, building: b, beast: 'wolf_pack' }, { terrain: t, building: b, peakZone: 2 });
    for (const u of Object.keys(UPGRADES)) out.push({ terrain: t, building: b, upgrade: u });
  }
  for (const floors of [1, 2, 3]) out.push({ terrain: 'desert', building: 'tower', floors, dragon: { element: 'fire', stage: 2 } });
  for (const f of Object.keys(FAUNA)) out.push({ terrain: 'desert', beast: f }, { terrain: 'meadow', building: 'pasture', beast: f });
  out.push({ terrain: 'mountain', beast: 'thunderbird' }, { terrain: 'ocean', beast: 'leviathan' });
  for (const e of ELEMENTS) for (const stage of [0, 1, 2, 3]) out.push({ terrain: 'desert', dragon: { element: e, stage } }, { terrain: 'meadow', building: 'pasture', dragon: { element: e, stage } });
  return out;
}

// ZFIGHT_ALL=1 lists every pair a model has, not the first few.
test('no two faces of any 3D model lie in one plane and overlap (they would flicker)', () => {
  const bad: string[] = [];
  for (const [name, make] of Object.entries(modelsForTest(hexes()))) {
    const f = fights(make());
    if (f.length) {
      const where = [...new Set(f.map((x) => `${x.a} vs ${x.b}`))];
      bad.push(`${name}: ${f.length} pairs: ${where.slice(0, process.env.ZFIGHT_ALL ? 999 : 4).join('; ')}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the check finds the faces it should, and not the ones it shouldn\'t', () => {
  const mat = new THREE.MeshLambertMaterial();
  const at = (y: number, w = 0.1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, w), mat);
    m.position.y = y;
    return m;
  };
  const scene = (...m: THREE.Object3D[]) => {
    const g = new THREE.Group();
    g.add(...m);
    return g;
  };
  // A small box sunk in a big one, their tops level: the cave bear's nose (#421).
  assert.ok(fights(scene(at(0, 0.3), at(0, 0.05))).length > 0);
  // One stacked on another: they touch, facing apart.
  assert.equal(fights(scene(at(0), at(0.1))).length, 0);
  // Its top just above the other's.
  assert.equal(fights(scene(at(0, 0.3), at(0.01, 0.05))).length, 0);
  // ...but not by a hair: at the TV's distance the depth buffer can't tell them apart.
  assert.ok(fights(scene(at(0, 0.3), at(0.002, 0.05))).length > 0);
  // Side by side, sharing only an edge.
  const side = at(0);
  side.position.x = 0.1;
  assert.equal(fights(scene(at(0), side)).length, 0);
});
