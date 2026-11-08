// Site features around named buildings: UTD building-name signs on the lawn
// in front of each campus building, the Student Union's stone promenade and
// broad timber steps down to the Plinth fountain, and the raised stair and
// terrace at Comets LANding.
import * as THREE from 'three';
import type { ChunkContent } from './chunks.ts';
import type { Building, Pt } from './campusData.ts';
import { MeshBuilder, addDrapedPolygon, ensureCCW, centroid } from './geometry.ts';
import { box, railing, baseLevel } from './buildings.ts';
import { signSlot } from './textures.ts';
import { LAYER, LIFT, addMesh, type CampusMaterials, type WorldContext } from './campusBuilder.ts';

const SIGNED = new Set(['university', 'dormitory', 'public', 'school', 'hospital', 'office', 'apartments', 'yes', 'construction']);

export interface LandmarkGroups { base: THREE.Group; detail: THREE.Group; near: THREE.Group }

/** Solid boxes (stairs, terraces, columns) built by the landmark features, for physics. */
export interface Solid { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }
let solids: Solid[] | null = null;
function solidBox(mb: MeshBuilder, c: number[], size: number[], yaw: number, col: number[]) {
  box(mb, c, size, yaw, col);
  solids?.push({ x: c[0], y: c[1], z: c[2], hx: size[0] / 2, hy: size[1] / 2, hz: size[2] / 2, yaw });
}

/** Builds the landmark features and returns their solid parts (for colliders). */
export function buildLandmarks(c: ChunkContent, ctx: WorldContext, mats: CampusMaterials, g: LandmarkGroups, all: Building[], withSigns = true): Solid[] {
  solids = [];
  const out = solids;
  if (withSigns) buildSigns(c, ctx, mats, g);
  for (const b of c.buildings) {
    if (b.name === 'Student Union') studentUnion(b, ctx, mats, g, all);
    if (b.name === 'Comets LANding') cometsLanding(b, ctx, mats, g);
  }
  solids = null;
  return out;
}

function pointIn(p: Pt, r: Pt[]) {
  let q = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], c = r[j];
    if ((a[1] > p[1]) !== (c[1] > p[1]) && p[0] < (c[0] - a[0]) * (p[1] - a[1]) / (c[1] - a[1]) + a[0]) q = !q;
  }
  return q;
}

function edgeList(ring: Pt[]) {
  const r = ensureCCW(ring), out: { a: Pt; b: Pt; len: number; u: Pt; n: Pt; mid: Pt }[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    out.push({ a, b, len, u, n: [u[1], -u[0]], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  return out;
}

/**
 * Sign on the lawn in front of the building's longest wall that faces a road
 * or walk: two posts and a double-sided green panel with the building name.
 */
function buildSigns(c: ChunkContent, ctx: WorldContext, mats: CampusMaterials, g: LandmarkGroups) {
  const T = ctx.terrain;
  const posts = new MeshBuilder(), panel = new MeshBuilder();
  let tex: THREE.Texture | null = null;
  for (const b of c.buildings) {
    if (!b.name || /^\d+$/.test(b.name) || !SIGNED.has(b.kind) || /Mail$|Laundry|Clubhouse/.test(b.name) || b.minH) continue;
    if (b.style === 'canopy' || b.style === 'shelter' || b.style === 'skybridge') continue;
    let best: { p: Pt; u: Pt; n: Pt; score: number } | null = null;
    for (const e of edgeList(b.outer)) {
      if (e.len < 8) continue;
      for (const d of [5, 7, 3.5]) {
        const p: Pt = [e.mid[0] + e.n[0] * d, e.mid[1] + e.n[1] * d];
        if (ctx.onRoad(p, 0.8) || ctx.onPath(p, 0.6) || ctx.inBuilding(p) || ctx.inParking(p) || ctx.inPlaza(p) || ctx.inWater(p) || ctx.treeNear(p, 1.5)) continue;
        const faces = [8, 14, 22].some(k => { const q: Pt = [p[0] + e.n[0] * k, p[1] + e.n[1] * k]; return ctx.onRoad(q, 1) || ctx.onPath(q, 1); });
        const score = e.len * (faces ? 3 : 1);
        if (!best || score > best.score) best = { p, u: e.u, n: e.n, score };
        break;
      }
    }
    if (!best) continue;
    const slot = signSlot(b.name);
    tex = slot.tex;
    const { p, u, n } = best, y = T.heightAt(p[0], p[1]);
    const yaw = Math.atan2(u[1], u[0]);
    for (const s of [-0.95, 0.95]) box(posts, [p[0] + u[0] * s, y + 0.75, -(p[1] + u[1] * s)], [0.09, 1.5, 0.09], yaw, [0.12, 0.11, 0.1]);
    box(posts, [p[0], y + 0.12, -p[1]], [2.3, 0.24, 0.35], yaw, [0.72, 0.68, 0.6]);
    // Panel faces: front toward the road (+n), back toward the building, same name both sides.
    const w = 2.0, h0 = y + 0.7, h1 = y + 1.45;
    for (const side of [1, -1]) {
      const o = 0.045 * side;
      const A: Pt = [p[0] - u[0] * w / 2 * side + n[0] * o, p[1] - u[1] * w / 2 * side + n[1] * o];
      const B: Pt = [p[0] + u[0] * w / 2 * side + n[0] * o, p[1] + u[1] * w / 2 * side + n[1] * o];
      panel.quad([A[0], h0, -A[1]], [B[0], h0, -B[1]], [B[0], h1, -B[1]], [A[0], h1, -A[1]], [n[0] * side, 0, -n[1] * side],
        [[slot.u0, slot.v0], [slot.u1, slot.v0], [slot.u1, slot.v1], [slot.u0, slot.v1]], [1, 1, 1]);
    }
    box(posts, [p[0], (h0 + h1) / 2, -p[1]], [w + 0.08, h1 - h0 + 0.08, 0.08], yaw, [0.06, 0.2, 0.13]);
  }
  addMesh(g.detail, posts, mats.metalV, { cast: true });
  if (tex) {
    if (!mats.signPanel) mats.signPanel = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    addMesh(g.detail, panel, mats.signPanel);
  }
}

/**
 * Student Union (reference photos): a stone-paved promenade along the long
 * arcade.
 */
/** The Student Union's arcade promenade: a 10 m band along its longest wall. */
export function suPromenade(b: Building): Pt[] {
  const e = edgeList(b.outer).sort((x, y) => y.len - x.len)[0];
  const at = (along: number, out: number): Pt => [e.a[0] + e.u[0] * along + e.n[0] * out, e.a[1] + e.u[1] * along + e.n[1] * out];
  return [at(0, 0.2), at(e.len, 0.2), at(e.len, 10), at(0, 10)];
}

function studentUnion(b: Building, ctx: WorldContext, mats: CampusMaterials, g: LandmarkGroups, all: Building[]) {
  const T = ctx.terrain;
  const stone = new MeshBuilder();
  addDrapedPolygon(stone, suPromenade(b), [], T, LIFT.plaza + 0.004, [0.98, 0.93, 0.84], 2.5);
  addMesh(g.base, stone, mats.layers.plaza, { order: LAYER.plaza + 1 });

  void all; // the Union steps are built with Comets LANding, the Union's north wing
}

/**
 * The Union steps at Comets LANding, the Union's north wing: broad Ipe-wood seating
 * steps (rebuilt in Ipe in place of concrete, UT Dallas Magazine 2018) centred on the
 * north door and climbing all the way to the second-floor deck: nine 1 m treads of
 * about 0.4 m, up to 22 m wide, with a 3 m landing along the wall at the top. Not mapped
 * in OSM; placement follows the user's site description.
 */
function cometsLanding(b: Building, ctx: WorldContext, mats: CampusMaterials, g: LandmarkGroups) {
  const T = ctx.terrain;
  // The exterior wall facing most nearly north (the side toward the Plinth plaza).
  const e = edgeList(b.outer).filter(f => f.len > 8).sort((x, y) => y.n[1] * y.len - x.n[1] * x.len)[0];
  if (!e) return;
  const base = baseLevel(b.outer, T).base;
  const deckY = base + 3.6; // second-floor entrance level
  const steps = new MeshBuilder();
  const at = (along: number, out: number): Pt => [e.a[0] + e.u[0] * along + e.n[0] * out, e.a[1] + e.u[1] * along + e.n[1] * out];
  const yaw = Math.atan2(e.u[1], e.u[0]);
  const L = Math.min(22, e.len - 1), mid = e.len / 2, n = 9, tread = 1.0, landing = 3;
  const ground = Math.min(...[0, 0.5, 1].map(t => { const q = at(mid - L / 2 + L * t, landing + n * tread + 0.5); return T.heightAt(q[0], q[1]); }));
  const rise = (deckY - ground) / (n + 1);
  // Landing against the wall at deck height, then steps down and out from it.
  const c0 = at(mid, landing / 2 + 0.05);
  solidBox(steps, [c0[0], (ground - 0.3 + deckY) / 2, -c0[1]], [L, deckY - ground + 0.3, landing], yaw, [0.52, 0.34, 0.21]);
  for (let k = 0; k < n; k++) {
    // Step k: from the landing out to (n - k) treads, top at k + 1 risers.
    const depth = (n - k) * tread, top = ground + (k + 1) * rise;
    const c = at(mid, landing + depth / 2);
    const col = k % 2 ? [0.5, 0.32, 0.2] : [0.55, 0.36, 0.22];
    solidBox(steps, [c[0], (ground - 0.3 + top) / 2, -c[1]], [L, top - ground + 0.3, depth], yaw, col);
  }
  addMesh(g.detail, steps, mats.timber, { cast: true });
  const rails = new MeshBuilder();
  railing(rails, at(mid - L / 2, 0.2), at(mid - L / 2, landing), deckY, deckY);
  railing(rails, at(mid + L / 2, 0.2), at(mid + L / 2, landing), deckY, deckY);
  addMesh(g.detail, rails, mats.metalV);
}
