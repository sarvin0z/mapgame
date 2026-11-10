// Site details built per chunk on top of the base campus: parking stalls and
// parked cars, sports courts and fields with their markings and equipment,
// building doors at mapped entrances, the Plinth canopy and fountain, and the
// Rock Garden. Positions come from OSM; dimensions are regulation sizes or
// taken from reference photos where noted.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkContent } from './chunks.ts';
import type { Area, Building, Pt } from './campusData.ts';
import { MeshBuilder, addDrapedPolygon, addDrapedRibbon, addWalls, ensureCCW, resample, centroid } from './geometry.ts';
import { insetRing } from './features.ts';
import { baseLevel, breezeway } from './buildings.ts';
import { hasModel } from './buildingModels.ts';
import { pointInRing } from './spatial.ts';
import { LAYER, LIFT, addMesh, boxInto, railSegment, hash, instanced, type CampusMaterials, type WorldContext } from './campusBuilder.ts';
import type { Terrain } from './terrain.ts';
import { blob } from './occlusion.ts';

const lin = (c: number[]) => c.map(v => Math.pow(v, 2.2));
const WHITE = lin([0.95, 0.95, 0.93]);

/** A parked-car type: all parts merged, coloured per vertex (paint white, the rest by part colour). */
export interface CarTemplate { name: string; length: number; geometry: THREE.BufferGeometry }

export interface ExtraGroups { base: THREE.Group; detail: THREE.Group; near: THREE.Group; /** Per-cell LOD meshes (see BuiltChunk.trees). */ cells: THREE.Group }

// Realistic US parked-car colour mix: white, black, gray and silver dominate.
const CAR_COLORS = [0xf2f2f0, 0xf2f2f0, 0xe8e8e6, 0x1a1b1e, 0x1a1b1e, 0x6b6e72, 0x8d9094, 0xb6b9bc, 0xb6b9bc, 0x7a1418, 0x1f3a6b, 0x3c4d3a, 0x9a7b55];

export function* buildExtras(c: ChunkContent, ctx: WorldContext, mats: CampusMaterials, g: ExtraGroups): Generator<void, void, void> {
  const T = ctx.terrain;
  buildParking(c, ctx, mats, g);
  yield;
  for (const a of c.areas) {
    if (a.kind === 'pitch' || a.kind === 'track') { buildPitch(a, T, mats, g); yield; }
    if (a.kind === 'rockGarden') buildRockGarden(a, T, mats, g);
  }
  buildDoors(c, ctx, mats, g);
  yield;
  for (const b of c.buildings) if (b.name === 'The Plinth') buildPlinth(b, T, mats, g);
}

// ---------------------------------------------------------------- parking

interface Stall { p: Pt; yaw: number; inferred: boolean; run?: number }

/**
 * 2.75 m x 5.5 m (9 x 18 ft) stalls on both sides of every mapped parking aisle.
 * Inside mapped lots only the lines are painted; where an aisle has no mapped
 * lot polygon the stall pad is paved too, as long as the space is clear of
 * roads, walks, buildings and trees (such lots are listed as inferred).
 */
const stallCache = new WeakMap<ChunkContent, Stall[]>();
/** Stalls by chunk key, so stalls near a chunk edge can be checked against the neighbour's. */
const stallsByChunk = new Map<string, Stall[]>();

/** True if two 2.75 x 5.5 m stalls overlap (separating-axis test on the oriented rectangles, 10 cm slack). */
function stallsOverlap(a: Stall, b: Stall) {
  if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) > 6.2) return false;
  const half = [2.7, 1.32]; // along u (into the stall), along v (along the aisle)
  const axes = (s: Stall) => { const ux = Math.cos(s.yaw), uy = Math.sin(s.yaw); return [[ux, uy], [-uy, ux]]; };
  const A = axes(a), B = axes(b), d = [b.p[0] - a.p[0], b.p[1] - a.p[1]];
  for (const ax of [...A, ...B]) {
    const proj = (S: number[][]) => half[0] * Math.abs(S[0][0] * ax[0] + S[0][1] * ax[1]) + half[1] * Math.abs(S[1][0] * ax[0] + S[1][1] * ax[1]);
    if (Math.abs(d[0] * ax[0] + d[1] * ax[1]) >= proj(A) + proj(B)) return false;
  }
  return true;
}
/** Parking stalls of a chunk (computed once; shared by rendering and physics). */
export function computeStalls(c: ChunkContent, ctx: WorldContext): Stall[] {
  const hit = stallCache.get(c);
  if (hit) return hit;
  const stalls: Stall[] = [];
  const neighbours: Stall[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) neighbours.push(...(stallsByChunk.get(`${c.cx + dx},${c.cy + dy}`) ?? []));
  let run = 0;
  for (const r of c.roads) {
    if (r.svc !== 'parking_aisle') continue;
    run += 2;
    const rp = resample(r.pts, 1);
    // Walk the aisle at 2.75 m intervals.
    let acc = 1.4;
    for (let i = 1; i < rp.length; i++) {
      const a = rp[i - 1], b = rp[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc += l;
      if (acc < 2.75) continue;
      acc = 0;
      const dx = (b[0] - a[0]) / (l || 1), dy = (b[1] - a[1]) / (l || 1);
      for (const side of [-1, 1]) {
        const nx = -dy * side, ny = dx * side;
        const off = r.w / 2 + 2.75;
        const p: Pt = [b[0] + nx * off, b[1] + ny * off];
        const back: Pt = [b[0] + nx * (r.w / 2 + 5.2), b[1] + ny * (r.w / 2 + 5.2)];
        const front: Pt = [b[0] + nx * (r.w / 2 + 0.4), b[1] + ny * (r.w / 2 + 0.4)];
        const inLot = ctx.inParking(p) && ctx.inParking(back);
        const clear = (q: Pt) => !ctx.onRoad(q, 0.3) && !ctx.onPath(q, 0.3) && !ctx.inBuilding(q) && !ctx.treeNear(q, 1.6) && !ctx.inWater(q);
        // Unmapped lots are only inferred where OSM leaves housing and service-yard lots out.
        if (!inLot && !(ctx.lotAllowed(p) && clear(p) && clear(back) && clear(front))) continue;
        if (inLot && (ctx.onPath(p, 0) || ctx.treeNear(p, 1.4))) continue;
        const st: Stall = { p, yaw: Math.atan2(ny, nx), inferred: !inLot, run: run + (side > 0 ? 1 : 0) };
        // The stall's far corners and middle must stay off every other aisle and road.
        const ux = nx, uy = ny, vx = -ny, vy = nx;
        const onPave = [[1.5, 0], [2.5, -1.2], [2.5, 1.2], [0, -1.2], [0, 1.2]].some(([du, dv]) => ctx.onRoad([p[0] + ux * du + vx * dv, p[1] + uy * du + vy * dv], -0.15));
        if (onPave) continue;
        if (stalls.some(s => stallsOverlap(s, st)) || neighbours.some(s => stallsOverlap(s, st))) continue;
        stalls.push(st);
      }
    }
  }
  fillLots(c, ctx, stalls, neighbours, run + 2);
  stallCache.set(c, stalls);
  stallsByChunk.set(`${c.cx},${c.cy}`, stalls);
  return stalls;
}

/**
 * Mapped lots whose aisles are not mapped (part of Lot J, for one) were left
 * bare. Lay those parts out as standard double-loaded modules along the lot's
 * longest edge: 5.5 m stalls, 7.3 m aisle, 2.75 m spacing. A stall is kept
 * only if it lies wholly inside the lot, more than 7 m from any mapped aisle,
 * and clear of roads, walks, buildings, trees and existing stalls.
 */
function fillLots(c: ChunkContent, ctx: WorldContext, stalls: Stall[], neighbours: Stall[], run: number) {
  const aisles = c.roads.filter(r => r.svc === 'parking_aisle').map(r => resample(r.pts, 2));
  const nearAisle = (q: Pt) => aisles.some(a => a.some(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 7));
  for (const area of c.areas) {
    if (area.kind !== 'parking' || area.outer.length < 4) continue;
    const ring = area.outer;
    let best = { l: 0, u: [1, 0] as Pt };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > best.l) best = { l, u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    }
    const u = best.u, n: Pt = [-u[1], u[0]];
    const U = ring.map(p => p[0] * u[0] + p[1] * u[1]), N = ring.map(p => p[0] * n[0] + p[1] * n[1]);
    const u0 = Math.min(...U), u1 = Math.max(...U), n0 = Math.min(...N), n1 = Math.max(...N);
    if ((u1 - u0) * (n1 - n0) > 250000) continue; // very large polygons: not a single lot
    const at = (su: number, sn: number): Pt => [u[0] * su + n[0] * sn, u[1] * su + n[1] * sn];
    let k = 0;
    for (let base = n0 + 0.3; base + 5.5 <= n1; base += 18.3) {
      // Row A faces +n (aisle above it), row B faces -n across the aisle.
      for (const [rowC, into] of [[base + 2.75, -1], [base + 12.8 + 2.75, 1]] as const) {
        if (rowC + 2.75 > n1 + 0.01) continue;
        k++;
        for (let su = u0 + 1.4; su <= u1 - 1.4; su += 2.75) {
          const p = at(su, rowC);
          const corners = [[-1.3, -2.6], [1.3, -2.6], [1.3, 2.6], [-1.3, 2.6], [0, 0]].map(([du, dn]) => at(su + du, rowC + dn));
          if (!corners.every(q => pointInRing(q, ring) && !ctx.onRoad(q, -0.15) && !ctx.onPath(q, 0) && !ctx.inBuilding(q))) continue;
          if (nearAisle(p) || ctx.treeNear(p, 1.6)) continue;
          // Stall p is the stall centre here; computeStalls stores it the same way (aisle edge + 2.75 m inward).
          const st: Stall = { p, yaw: Math.atan2(n[1] * into, n[0] * into), inferred: false, run: run + k };
          if (stalls.some(s => stallsOverlap(s, st)) || neighbours.some(s => stallsOverlap(s, st))) continue;
          stalls.push(st);
        }
      }
    }
  }
}

function buildParking(c: ChunkContent, ctx: WorldContext, mats: CampusMaterials, g: ExtraGroups) {
  const T = ctx.terrain;
  const stalls = computeStalls(c, ctx);
  if (!stalls.length) return;
  const pads = new MeshBuilder(), lines = new MeshBuilder();
  // Inferred stalls: one continuous paved strip per run of neighbouring stalls (no grass between them).
  const runs = new Map<number, Stall[]>();
  for (const s of stalls) if (s.inferred) { if (!runs.has(s.run!)) runs.set(s.run!, []); runs.get(s.run!)!.push(s); }
  for (const list of runs.values()) {
    let piece: Pt[] = [];
    const flush = () => {
      if (piece.length >= 1) {
        const a = piece[0], b = piece[piece.length - 1];
        const ext = (p: Pt, q: Pt, d: number): Pt => { const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; return [p[0] + (p[0] - q[0]) / l * d, p[1] + (p[1] - q[1]) / l * d]; };
        const s0 = list[0], vx = -Math.sin(s0.yaw), vy = Math.cos(s0.yaw);
        const pts = piece.length > 1 ? [ext(a, piece[1], 1.4), ...piece, ext(b, piece[piece.length - 2], 1.4)] : [[a[0] - vx * 1.4, a[1] - vy * 1.4] as Pt, [a[0] + vx * 1.4, a[1] + vy * 1.4] as Pt];
        addDrapedRibbon(pads, pts, 5.7, T, LIFT.parking, [1, 1, 1], 6, 1);
      }
      piece = [];
    };
    for (const s of list) {
      const prev = piece[piece.length - 1];
      if (prev && Math.hypot(prev[0] - s.p[0], prev[1] - s.p[1]) > 3.5) flush();
      piece.push(s.p);
    }
    flush();
  }
  for (const s of stalls) {
    const ux = Math.cos(s.yaw), uy = Math.sin(s.yaw), vx = -uy, vy = ux; // u: into the stall, v: along the aisle
    const corner = (du: number, dv: number): Pt => [s.p[0] + ux * du + vx * dv, s.p[1] + uy * du + vy * dv];
    for (const dv of [-1.375, 1.375]) addDrapedRibbon(lines, [corner(-2.75, dv), corner(2.6, dv)], 0.1, T, LIFT.marking, WHITE, 4);
  }
  addMesh(g.base, pads, mats.layers.parking, { order: LAYER.parking });
  addMesh(g.detail, lines, mats.layers.marking, { order: LAYER.marking });

  // Parked cars: about 60 % occupancy, nose in, slightly off-center.
  const cars = ctx.cars;
  if (!cars?.length) return;
  const byType = cars.map(() => [] as THREE.Matrix4[]);
  const colors = cars.map(() => [] as THREE.Color[]);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const ao = new MeshBuilder();
  for (const pc of parkedCars(c, ctx)) {
    blob(ao, pc.x, pc.y, pc.width / 2, pc.length / 2 - 0.2, pc.heading, T, 0.22, 16, 1.2);
    q.setFromAxisAngle(up, pc.heading);
    byType[pc.type].push(new THREE.Matrix4().compose(new THREE.Vector3(pc.x, T.heightAt(pc.x, pc.y), -pc.y), q, new THREE.Vector3(1, 1, 1)));
    colors[pc.type].push(new THREE.Color(pc.color));
  }
  cars.forEach((tpl, t) => {
    if (!byType[t].length) return;
    // Per 40 m cell: the full model near the camera, a low-poly stand-in (body and cabin
    // boxes, ~1 % of the triangles) beyond; the streamer switches them per cell.
    const cells = new Map<string, number[]>();
    byType[t].forEach((m, i) => { const k = Math.floor(m.elements[12] / 80) + ',' + Math.floor(-m.elements[14] / 80); if (!cells.has(k)) cells.set(k, []); cells.get(k)!.push(i); });
    for (const ids of cells.values()) {
      const cx = ids.reduce((s, i) => s + byType[t][i].elements[12], 0) / ids.length, cy = ids.reduce((s, i) => s - byType[t][i].elements[14], 0) / ids.length;
      for (const [geo, lod] of [[tpl.geometry, 'full'], [carProxy(tpl), 'lite']] as const) {
        // One merged mesh per car type: the paint colour comes from the instance colour,
        // the other parts are near-black and stay dark whatever it is.
        const m = instanced(geo, mats.carBody, ids.length, (i, mm) => mm.copy(byType[t][ids[i]]), true);
        ids.forEach((id, i) => m.setColorAt(i, colors[t][id]));
        m.userData.cell = [cx, cy];
        m.userData.lod = lod;
        m.userData.shared = true;
        m.userData.fullScale = 0.65; // cars: the full model only quite close
        m.visible = false;
        g.cells.add(m);
      }
    }
  });
  addMesh(g.near, ao, mats.occlusion, { receive: false, order: LAYER.marking + 2 });
}

export interface ParkedCar { x: number; y: number; heading: number; type: number; color: number; length: number; width: number; height: number }
const SIZES = [[4.63, 1.78, 1.44], [4.9, 1.95, 1.76], [5.6, 2.0, 1.88]];
const carCache = new WeakMap<ChunkContent, ParkedCar[]>();
/** Parked cars in a chunk: about 60 % of stalls, nose in, slightly off-center. `heading` is a rotation about +y. */
const proxies = new WeakMap<object, THREE.BufferGeometry>();
/** A low-poly stand-in for a car template: a painted lower body and a dark glass cabin. */
function carProxy(tpl: CarTemplate) {
  const hit = proxies.get(tpl);
  if (hit) return hit;
  tpl.geometry.computeBoundingBox();
  const b = tpl.geometry.boundingBox!, sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
  const cx = (b.max.x + b.min.x) / 2, cz = (b.max.z + b.min.z) / 2;
  const part = (w: number, h: number, d: number, y: number, z: number, c: number) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(cx, y, z);
    const col = new Float32Array(g.attributes.position.count * 3).fill(c);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };
  const geo = mergeGeometries([
    part(sx, sy * 0.5, sz, b.min.y + 0.18 + sy * 0.25, cz, 1),
    part(sx * 0.86, sy * 0.4, sz * 0.5, b.min.y + 0.18 + sy * 0.68, cz - sz * 0.03, 0.02),
    ...[-1, 1].flatMap(fz => [-1, 1].map(fx => part(0.22, 0.6, 0.6, b.min.y + 0.3, 0, 0.015).translate(fx * (sx / 2 - 0.1), 0, cz + fz * sz * 0.32))),
  ])!;
  geo.computeVertexNormals();
  proxies.set(tpl, geo);
  return geo;
}

export function parkedCars(c: ChunkContent, ctx: WorldContext): ParkedCar[] {
  const hit = carCache.get(c);
  if (hit) return hit;
  const out: ParkedCar[] = [];
  for (const s of computeStalls(c, ctx)) {
    const h = hash(`car${s.p[0].toFixed(1)},${s.p[1].toFixed(1)}`);
    if (h > 0.6) continue;
    const type = h < 0.33 ? 0 : h < 0.52 ? 1 : 2;
    const [len, width, height] = SIZES[type];
    const ux = Math.cos(s.yaw), uy = Math.sin(s.yaw);
    const shift = (hash(`sh${s.p[0]}`) - 0.5) * 0.3 + (5.5 - len) * 0.15;
    out.push({ x: s.p[0] + ux * shift, y: s.p[1] + uy * shift, heading: Math.atan2(ux, -uy) + (hash(`r${s.p[1]}`) - 0.5) * 0.05, type,
      color: CAR_COLORS[Math.floor(hash(`c${s.p[0]},${s.p[1]}`) * CAR_COLORS.length)], length: len, width, height });
  }
  carCache.set(c, out);
  return out;
}

// ---------------------------------------------------------------- sports

/** Minimum-area bounding rectangle of a polygon: center, long axis u, short axis v, length, width. */
export function orientedRect(ring: Pt[]) {
  const pts = [...ring].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let best = { area: Infinity, c: [0, 0] as Pt, u: [1, 0] as Pt, v: [0, 1] as Pt, L: 0, W: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], v: Pt = [-u[1], u[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) { const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1]; u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const c: Pt = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
      best = u1 - u0 >= v1 - v0 ? { area, c, u, v, L: u1 - u0, W: v1 - v0 } : { area, c, u: v, v: [-v[0], -v[1]], L: v1 - v0, W: u1 - u0 };
    }
  }
  return best;
}

type Frame = ReturnType<typeof orientedRect>;
const at = (f: Frame, du: number, dv: number): Pt => [f.c[0] + f.u[0] * du + f.v[0] * dv, f.c[1] + f.u[1] * du + f.v[1] * dv];
function rectPts(f: Frame, hl: number, hw: number): Pt[] { return [at(f, -hl, -hw), at(f, hl, -hw), at(f, hl, hw), at(f, -hl, hw)]; }
function lineRect(mb: MeshBuilder, f: Frame, hl: number, hw: number, T: Terrain, w = 0.08) {
  const r = rectPts(f, hl, hw);
  for (let i = 0; i < 4; i++) addDrapedRibbon(mb, [r[i], r[(i + 1) % 4]], w, T, LIFT.marking, WHITE, 4);
}
function line(mb: MeshBuilder, f: Frame, a: [number, number], b: [number, number], T: Terrain, w = 0.08, color = WHITE) {
  addDrapedRibbon(mb, [at(f, a[0], a[1]), at(f, b[0], b[1])], w, T, LIFT.marking, color, 4);
}
function arc(mb: MeshBuilder, f: Frame, cu: number, cv: number, r: number, a0: number, a1: number, T: Terrain, w = 0.1) {
  const pts: Pt[] = [];
  const n = Math.max(8, Math.ceil(r * Math.abs(a1 - a0) / 0.8));
  for (let k = 0; k <= n; k++) { const t = a0 + (a1 - a0) * k / n; pts.push(at(f, cu + Math.cos(t) * r, cv + Math.sin(t) * r)); }
  addDrapedRibbon(mb, pts, w, T, LIFT.marking, WHITE, 4);
}

/** A thin upright panel between two map points (nets, windscreens, backboards). */
function panel(mb: MeshBuilder, a: Pt, b: Pt, y0a: number, y0b: number, h: number, color: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const n = [-dy / l, 0, -dx / l];
  mb.quad([a[0], y0a, -a[1]], [b[0], y0b, -b[1]], [b[0], y0b + h, -b[1]], [a[0], y0a + h, -a[1]], n, [[0, 0], [l, 0], [l, h], [0, h]], color);
}

function buildPitch(a: Area, T: Terrain, mats: CampusMaterials, g: ExtraGroups) {
  const f = orientedRect(a.outer);
  if (f.L < 4 || f.W < 3) return;
  const sport = a.sport ?? (a.kind === 'track' ? 'running' : '');
  const surf = new Map<string, { mb: MeshBuilder; order: number }>();
  const S = (k: string, order = LAYER.pitch) => { if (!surf.has(k)) surf.set(k, { mb: new MeshBuilder(), order }); return surf.get(k)!.mb; };
  const lines = new MeshBuilder(), solid = new MeshBuilder(), net = new MeshBuilder(), fence = new MeshBuilder(), posts = new MeshBuilder(), screen = new MeshBuilder();
  const H = (p: Pt) => T.heightAt(p[0], p[1]);
  const pitchLift = LIFT.pitch + 0.004;

  if (sport === 'tennis' || sport === 'pickleball') {
    // Acrylic hard court: green surround, blue playing area (reference: UTD Tennis Complex, 2025).
    addDrapedPolygon(S('court'), a.outer, [], T, pitchLift, lin([0.24, 0.45, 0.31]), 4);
    const [hl, hw, sl, ins] = sport === 'tennis' ? [11.885, 5.485, 6.4, 1.37] : [6.7, 3.05, 2.13, 0];
    const fu = Math.min(hl, f.L / 2 - 0.5), fw = Math.min(hw, f.W / 2 - 0.3);
    addDrapedPolygon(S('court', LAYER.pitch + 1), rectPts(f, fu, fw), [], T, pitchLift + 0.003, lin([0.16, 0.33, 0.62]), 4);
    lineRect(lines, f, fu, fw, T, 0.05);
    if (ins) for (const s of [-1, 1]) line(lines, f, [-fu, s * (fw - ins)], [fu, s * (fw - ins)], T, 0.05);
    for (const s of [-1, 1]) line(lines, f, [s * sl, -(fw - ins)], [s * sl, fw - ins], T, 0.05);
    line(lines, f, [-sl, 0], [sl, 0], T, 0.05);
    // Net with posts.
    const n0 = at(f, 0, -fw - 0.9), n1 = at(f, 0, fw + 0.9);
    panel(net, n0, n1, H(n0), H(n1), 0.95, [1, 1, 1]);
    for (const p of [n0, n1]) boxInto(posts, [p[0], H(p) + 0.53, -p[1]], [0.08, 1.07, 0.08], 0, [1, 1, 1]);
    fenceAround(a.outer, 3.0, T, fence, posts, screen);
  } else if (sport === 'basketball') {
    addDrapedPolygon(S('court'), a.outer, [], T, pitchLift, lin([0.55, 0.56, 0.55]), 4);
    const hl = Math.min(14, f.L / 2 - 0.3), hw = Math.min(7.5, f.W / 2 - 0.3);
    lineRect(lines, f, hl, hw, T, 0.05);
    line(lines, f, [0, -hw], [0, hw], T, 0.05);
    arc(lines, f, 0, 0, 1.8, 0, Math.PI * 2, T, 0.05);
    for (const s of [-1, 1]) {
      lineRect(lines, { ...f, c: at(f, s * (hl - 2.9), 0) }, 2.9, 2.45, T, 0.05);
      arc(lines, f, s * (hl - 1.575), 0, 6.75, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2, T, 0.05);
      // Hoop: pole, backboard and rim.
      const base = at(f, s * (hl + 0.3), 0), board = at(f, s * (hl - 1.2), 0);
      boxInto(posts, [base[0], H(base) + 1.6, -base[1]], [0.14, 3.2, 0.14], 0, [0.35, 0.35, 0.35]);
      const yaw = Math.atan2(f.u[1], f.u[0]);
      boxInto(posts, [board[0], H(board) + 3.3, -board[1]], [0.04, 1.05, 1.8], yaw, [0.95, 0.95, 0.95]);
      railSegment(posts, [base[0], H(base) + 3.2, -base[1]], [board[0], H(board) + 3.2, -board[1]]);
    }
  } else if (sport === 'soccer' || sport === 'american_football') {
    // Mowing stripes across the field, then FIFA-size markings scaled to the mapped field.
    const hl = f.L / 2 - 1.5, hw = f.W / 2 - 1.5;
    const n = Math.max(6, Math.round(f.L / 6));
    for (let k = 0; k < n; k += 2) {
      const u0 = -f.L / 2 + f.L * k / n, u1 = -f.L / 2 + f.L * (k + 1) / n;
      addDrapedPolygon(S('stripe'), [at(f, u0, -f.W / 2), at(f, u1, -f.W / 2), at(f, u1, f.W / 2), at(f, u0, f.W / 2)], [], T, pitchLift, lin([0.82, 0.9, 0.72]), 5);
    }
    lineRect(lines, f, hl, hw, T, 0.12);
    line(lines, f, [0, -hw], [0, hw], T, 0.12);
    if (sport === 'soccer') {
      const sc = Math.min(1, f.L / 105);
      arc(lines, f, 0, 0, 9.15 * sc, 0, Math.PI * 2, T, 0.12);
      for (const s of [-1, 1]) {
        const pbw = Math.min(20.15 * sc, hw - 1), gbw = Math.min(9.15 * sc, hw - 2);
        line(lines, f, [s * hl, -pbw], [s * (hl - 16.5 * sc), -pbw], T, 0.12);
        line(lines, f, [s * hl, pbw], [s * (hl - 16.5 * sc), pbw], T, 0.12);
        line(lines, f, [s * (hl - 16.5 * sc), -pbw], [s * (hl - 16.5 * sc), pbw], T, 0.12);
        line(lines, f, [s * hl, -gbw], [s * (hl - 5.5 * sc), -gbw], T, 0.12);
        line(lines, f, [s * hl, gbw], [s * (hl - 5.5 * sc), gbw], T, 0.12);
        line(lines, f, [s * (hl - 5.5 * sc), -gbw], [s * (hl - 5.5 * sc), gbw], T, 0.12);
        // Goal: posts, crossbar and a net box behind the line.
        const gw = 3.66 * Math.max(0.6, sc), gh = 2.44 * Math.max(0.75, sc);
        const p0 = at(f, s * hl, -gw), p1 = at(f, s * hl, gw), b0 = at(f, s * (hl + 1.5), -gw), b1 = at(f, s * (hl + 1.5), gw);
        for (const p of [p0, p1]) boxInto(posts, [p[0], H(p) + gh / 2, -p[1]], [0.12, gh, 0.12], 0, [1, 1, 1]);
        railSegment(posts, [p0[0], H(p0) + gh, -p0[1]], [p1[0], H(p1) + gh, -p1[1]]);
        panel(net, b0, b1, H(b0), H(b1), gh * 0.7, [1, 1, 1]);
        panel(net, p0, b0, H(p0), H(b0), gh * 0.85, [1, 1, 1]);
        panel(net, p1, b1, H(p1), H(b1), gh * 0.85, [1, 1, 1]);
      }
    } else {
      for (let k = -9; k <= 9; k++) line(lines, f, [k * hl / 10, -hw], [k * hl / 10, hw], T, 0.1);
    }
  } else if (sport === 'baseball' || sport === 'softball') {
    // Home plate sits at the field's sharpest corner; the diamond opens toward the centroid.
    const ring = ensureCCW(a.outer);
    let best = 0, bestCos = -2;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[(i + ring.length - 1) % ring.length], cpt = ring[i], nx = ring[(i + 1) % ring.length];
      const l1 = Math.hypot(p[0] - cpt[0], p[1] - cpt[1]), l2 = Math.hypot(nx[0] - cpt[0], nx[1] - cpt[1]);
      const cs = ((p[0] - cpt[0]) * (nx[0] - cpt[0]) + (p[1] - cpt[1]) * (nx[1] - cpt[1])) / (l1 * l2 || 1);
      if (cs > bestCos) { bestCos = cs; best = i; }
    }
    const home = ring[best], cen = centroid(ring);
    const axL = Math.hypot(cen[0] - home[0], cen[1] - home[1]) || 1;
    const ax: Pt = [(cen[0] - home[0]) / axL, (cen[1] - home[1]) / axL], px: Pt = [-ax[1], ax[0]];
    const base = sport === 'baseball' ? 27.43 : 18.29, dirtR = sport === 'baseball' ? 29 : 18.3;
    const P = (along: number, side: number): Pt => [home[0] + ax[0] * along + px[0] * side, home[1] + ax[1] * along + px[1] * side];
    const fan: Pt[] = [P(-1.5, 0)];
    for (let k = 0; k <= 16; k++) { const t = -Math.PI / 4 + (Math.PI / 2) * k / 16; fan.push(P(Math.cos(t) * dirtR, Math.sin(t) * dirtR)); }
    addDrapedPolygon(S('dirt', LAYER.pitch + 1), fan, [], T, pitchLift + 0.003, lin([0.72, 0.5, 0.34]), 4);
    const d = base / Math.SQRT2;
    const grass: Pt[] = [P(d * 0.18, 0), P(d, d * 0.82), P(d * 1.82, 0), P(d, -d * 0.82)];
    addDrapedPolygon(S('grassIn', LAYER.pitch + 2), grass, [], T, pitchLift + 0.006, lin([0.3, 0.52, 0.22]), 4);
    for (const s of [-1, 1]) addDrapedRibbon(lines, [P(0, 0), P(Math.cos(Math.PI / 4) * 90, s * Math.sin(Math.PI / 4) * 90)], 0.08, T, LIFT.marking + 0.01, WHITE, 4);
    for (const bp of [P(d, d), P(2 * d, 0), P(d, -d), P(0, 0)]) boxInto(solid, [bp[0], H(bp) + 0.05, -bp[1]], [0.38, 0.08, 0.38], 0, [1, 1, 1]);
    const mound = P(d, 0);
    boxInto(solid, [mound[0], H(mound) + 0.1, -mound[1]], [2.4, 0.2, 2.4], 0, lin([0.66, 0.46, 0.32]));
    fenceAround(a.outer, 2.4, T, fence, posts, screen);
  } else if (sport === 'beachvolleyball') {
    addDrapedPolygon(S('sand'), a.outer, [], T, pitchLift, lin([0.86, 0.78, 0.58]), 3);
    const n0 = at(f, 0, -Math.min(5, f.W / 2)), n1 = at(f, 0, Math.min(5, f.W / 2));
    panel(net, n0, n1, H(n0) + 1.43, H(n1) + 1.43, 1.0, [1, 1, 1]);
    for (const p of [n0, n1]) boxInto(posts, [p[0], H(p) + 1.25, -p[1]], [0.1, 2.5, 0.1], 0, [0.8, 0.8, 0.8]);
  } else if (sport === 'cricket') {
    addDrapedPolygon(S('dirt', LAYER.pitch + 1), rectPts(f, 10.06, 1.52), [], T, pitchLift + 0.003, lin([0.76, 0.66, 0.46]), 4);
  }
  const surfMat = mats.layers.pitchSurface;
  for (const { mb, order } of surf.values()) addMesh(g.base, mb, surfMat, { order });
  addMesh(g.detail, lines, mats.layers.marking, { order: LAYER.marking });
  addMesh(g.detail, solid, mats.curb, { cast: true });
  addMesh(g.detail, net, mats.net);
  addMesh(g.detail, fence, mats.fence);
  addMesh(g.detail, screen, mats.windscreen);
  addMesh(g.detail, posts, mats.galvanized, { cast: true });
}

/** Chain-link fence (with a dark windscreen on the lower part) around a court or field. */
function fenceAround(ring: Pt[], h: number, T: Terrain, fence: MeshBuilder, posts: MeshBuilder, screen: MeshBuilder | null) {
  const rp = resample([...ring, ring[0]], 3);
  for (let i = 0; i < rp.length - 1; i++) {
    const a = rp[i], b = rp[i + 1], ha = T.heightAt(a[0], a[1]), hb = T.heightAt(b[0], b[1]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.05) continue;
    const n = [-(b[1] - a[1]) / l, 0, -(b[0] - a[0]) / l];
    fence.quad([a[0], ha, -a[1]], [b[0], hb, -b[1]], [b[0], hb + h, -b[1]], [a[0], ha + h, -a[1]], n, [[0, 0], [l / 0.5, 0], [l / 0.5, h / 0.5], [0, h / 0.5]], [1, 1, 1]);
    if (screen) screen.quad([a[0], ha, -a[1]], [b[0], hb, -b[1]], [b[0], hb + 1.8, -b[1]], [a[0], ha + 1.8, -a[1]], n, [[0, 0], [0, 0], [0, 0], [0, 0]], [0.04, 0.12, 0.07]);
    boxInto(posts, [a[0], ha + h / 2, -a[1]], [0.06, h, 0.06], 0, [1, 1, 1]);
    railSegment(posts, [a[0], ha + h, -a[1]], [b[0], hb + h, -b[1]]);
  }
}

// ---------------------------------------------------------------- rock garden

/** Founders North Rock Garden: flagstone paving and specimen rocks on short pedestals (reference photo). */
function buildRockGarden(a: Area, T: Terrain, mats: CampusMaterials, g: ExtraGroups) {
  const stone = new MeshBuilder();
  addDrapedPolygon(stone, a.outer, [], T, LIFT.plaza, [0.95, 0.9, 0.82], 2.5);
  addMesh(g.base, stone, mats.layers.plaza, { order: LAYER.plaza });
  const f = orientedRect(a.outer);
  const rocks: THREE.Matrix4[] = [], peds: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (let du = -f.L / 2 + 2; du < f.L / 2 - 1; du += 3.2) for (let dv = -f.W / 2 + 2; dv < f.W / 2 - 1; dv += 3.2) {
    const p = at(f, du + (hash(`ru${du}`) - 0.5) * 1.2, dv + (hash(`rv${dv}${du}`) - 0.5) * 1.2);
    if (!pointInRing(p, a.outer) || rocks.length >= 16) continue;
    const y = T.heightAt(p[0], p[1]);
    peds.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], y, -p[1]), q.identity(), new THREE.Vector3(1, 1, 1)));
    const s = 0.35 + hash(`rs${p[0]}`) * 0.35;
    q.setFromEuler(new THREE.Euler(hash(`a${p[0]}`) * 3, hash(`b${p[1]}`) * 3, 0));
    rocks.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], y + 0.55 + s * 0.6, -p[1]), q, new THREE.Vector3(s * 1.3, s, s * 1.1)));
  }
  if (!rocks.length) return;
  const rockGeo = new THREE.IcosahedronGeometry(1, 1), pedGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.6, 8).translate(0, 0.3, 0);
  g.detail.add(instanced(rockGeo, mats.rock, rocks.length, (i, m) => m.copy(rocks[i]), true));
  g.detail.add(instanced(pedGeo, mats.metal, peds.length, (i, m) => m.copy(peds[i]), true));
}

// ---------------------------------------------------------------- doors

/**
 * Doors at mapped entrances (OSM `entrance`, 375 on campus), placed on the
 * nearest wall and sized by type: glass double doors with a canopy at main
 * entrances, single glass doors, painted steel exit doors, roll-up service
 * doors. Buildings without a mapped entrance get a single glass door where a
 * mapped walkway ends at their wall.
 */
function buildDoors(c: ChunkContent, ctx: WorldContext, mats: CampusMaterials, g: ExtraGroups) {
  const T = ctx.terrain;
  const frames = new MeshBuilder(), glass = new MeshBuilder(), steel = new MeshBuilder(), canopy = new MeshBuilder(), stoops = new MeshBuilder();
  const shrubs: [number, number, number][] = [];
  const placed: Pt[] = [];
  // `acc`: distance along the ring to the edge start, as addWalls lays out the facade texture.
  const edges: { a: Pt; b: Pt; b0: Building; acc: number }[] = [];
  for (const b of c.buildings) {
    // Modelled buildings carry their own doors; adding mapped ones put doors on stair landings.
    if (b.style === 'canopy' || b.style === 'construction' || b.style === 'cometsGlass' || b.minH || hasModel(ctx.models, b)) continue;
    const r = ensureCCW(b.outer);
    let acc = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], q = r[(i + 1) % r.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 1e-3) continue;
      edges.push({ a, b: q, b0: b, acc });
      acc += len;
    }
  }
  const breezeways = new Map<Building, ReturnType<typeof breezeway>>();
  const inBreezeway = (b: Building, p: Pt) => {
    if (b.style !== 'villageStone') return false;
    if (!breezeways.has(b)) breezeways.set(b, breezeway(b.outer));
    const bw = breezeways.get(b);
    if (!bw) return false;
    const along = (p[0] - bw.O[0]) * bw.u[0] + (p[1] - bw.O[1]) * bw.u[1];
    return Math.abs(along) < bw.W / 2 + 1.2;
  };
  const nearestEdge = (p: Pt, maxD: number) => {
    let best: { a: Pt; b: Pt; t: number; d: number; b0: Building; acc: number } | null = null;
    for (const e of edges) {
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy;
      if (l2 < 2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2));
      const d = Math.hypot(p[0] - e.a[0] - t * dx, p[1] - e.a[1] - t * dy);
      if (d < maxD && (!best || d < best.d)) best = { ...e, t, d };
    }
    return best;
  };
  const door = (p: Pt, kind: string, type: string, maxD: number) => {
    const e = nearestEdge(p, maxD);
    if (!e || placed.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2)) return false;
    // Apartment entrances are inside the breezeway and at the stair landings, not on the outer walls.
    if (e.b0.style === 'villageStone' && (kind === 'staircase' || inBreezeway(e.b0, p))) return false;
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    const ux = (e.b[0] - e.a[0]) / L, uy = (e.b[1] - e.a[1]) / L;
    // Doors go on the wall between two window bays (the facade texture repeats every `bay` metres
    // from the ring start), so they never cover a painted window.
    const bay = mats.styles[e.b0.style]?.bay ?? 4;
    let t = -1;
    const k0 = Math.round((e.acc + e.t * L) / bay);
    for (const k of [k0, k0 - 1, k0 + 1]) {
      const along = k * bay - e.acc;
      if (along >= 1.4 && along <= L - 1.4) { t = along / L; break; }
    }
    if (t < 0) return false;
    const cx = e.a[0] + ux * L * t, cy = e.a[1] + uy * L * t;
    const ox = uy, oy = -ux; // outward normal of a CCW ring
    // Doors are at the building's ground-floor level; a concrete stoop with a step bridges any drop.
    const y = baseLevel(e.b0.outer, T).base;
    const gy = T.heightAt(cx + ox * 0.9, cy + oy * 0.9);
    if (y - gy > 0.08) {
      const steps = Math.ceil((y - gy) / 0.17);
      for (let k = 0; k < steps; k++) {
        const top = y - k * 0.17;
        const yawS = Math.atan2(uy, ux);
        boxInto(stoops, [cx + ox * (0.8 + k * 0.3), (top + gy - 0.2) / 2, -(cy + oy * (0.8 + k * 0.3))], [2.6, top - gy + 0.2, 1.6 - k * 0.0 + 0.0], yawS, [0.85, 0.83, 0.79]);
      }
    }
    const yaw = Math.atan2(uy, ux);
    // Everything sits at least 6 cm in front of the wall plane so no face is coplanar with it.
    const at2 = (du: number, dn: number, dy: number) => [cx + ux * du + ox * (dn + 0.06), y + dy, -(cy + uy * du + oy * (dn + 0.06))];
    const service = kind === 'service' || kind === 'garage' || type === 'overhead';
    const metal = kind === 'exit' || kind === 'emergency' || kind === 'staircase';
    const double = kind === 'main' || type === 'double' || type === 'automatic' || type === 'sliding';
    if (service) {
      boxInto(steel, at2(0, 0.06, 1.5), [3.0, 3.0, 0.08], yaw, lin([0.72, 0.73, 0.74]));
      for (let k = 0; k < 10; k++) boxInto(frames, at2(0, 0.11, 0.15 + k * 0.29), [2.96, 0.02, 0.02], yaw, [1, 1, 1]);
    } else if (metal) {
      boxInto(frames, at2(0, 0.05, 1.12), [1.1, 2.24, 0.08], yaw, [1, 1, 1]);
      boxInto(steel, at2(0, 0.09, 1.08), [0.92, 2.12, 0.04], yaw, lin([0.55, 0.57, 0.6]));
      boxInto(frames, at2(0, 0.13, 1.0), [0.7, 0.04, 0.04], yaw, [1, 1, 1]);
    } else {
      const w = double ? 1.9 : 1.0;
      boxInto(frames, at2(0, 0.05, 1.25), [w + 0.16, 2.5, 0.1], yaw, [1, 1, 1]);
      boxInto(glass, at2(0, 0.1, 1.2), [w, 2.3, 0.02], yaw, [1, 1, 1]);
      if (double) boxInto(frames, at2(0, 0.12, 1.2), [0.06, 2.3, 0.04], yaw, [1, 1, 1]);
      boxInto(frames, at2(0, 0.14, 1.05), [w * 0.85, 0.04, 0.04], yaw, [1, 1, 1]);
      // Accessible-entrance push plate (blue) beside main doors.
      if (double) boxInto(steel, at2(w / 2 + 0.4, 0.06, 1.0), [0.12, 0.12, 0.03], yaw, lin([0.1, 0.3, 0.75]));
      if (kind === 'main') {
        boxInto(canopy, at2(0, 0.7, 2.9), [w + 1.6, 0.18, 1.4], yaw, [1, 1, 1]);
        // Pair of concrete planters with shrubs flanking main entrances (common across campus).
        for (const side of [-1, 1]) {
          const px = cx + ux * side * (w / 2 + 1.6) + ox * 1.6, py = cy + uy * side * (w / 2 + 1.6) + oy * 1.6;
          if (ctx.onRoad([px, py], 0.5)) continue;
          const gy0 = T.heightAt(px, py);
          boxInto(stoops, [px, gy0 + 0.3, -py], [1.2, 0.6, 1.2], yaw, [0.82, 0.8, 0.76]);
          shrubs.push([px, gy0 + 0.6, py]);
        }
      }
    }
    placed.push(p);
    return true;
  };
  for (const en of c.entrances) door([en[0], en[1]], en[2], en[3], 1.6);
  // Walkways that end at a wall of a building with no mapped door nearby.
  for (const r of c.roads) {
    if (!['footway', 'path', 'pedestrian'].includes(r.cls) || r.fw === 'crossing') continue;
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
      if (placed.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 8)) continue;
      door(p, 'yes', '', 1.2);
    }
  }
  addMesh(g.near, frames, mats.doorFrame, { cast: true });
  addMesh(g.near, glass, mats.doorGlass);
  addMesh(g.near, steel, mats.doorSteel);
  addMesh(g.detail, canopy, mats.canopyWhite, { cast: true });
  addMesh(g.detail, stoops, mats.concreteV, { cast: true });
  if (shrubs.length) {
    const geo = new THREE.IcosahedronGeometry(0.55, 1).scale(1, 0.75, 1);
    // The hedge material expects vertex colours; the blob material takes per-instance colour instead.
    const mesh = instanced(geo, mats.blob, shrubs.length, (i, m) => m.makeTranslation(shrubs[i][0], shrubs[i][1] + 0.3, -shrubs[i][2]), true);
    const col = new THREE.Color();
    shrubs.forEach((_, i) => mesh.setColorAt(i, col.setHSL(0.27, 0.45, 0.22 + hash(`sh${i}`) * 0.06)));
    g.detail.add(mesh);
  }
}

// ---------------------------------------------------------------- the Plinth

/**
 * The Plinth (Student Union plaza): a white louvered canopy whose concentric
 * slats let light through, around a stepped round pool with a tall concrete
 * mist column (reference photos). Canopy outline and the open ring in it come
 * from OSM; the fountain is centered in that open ring.
 */
function buildPlinth(b: Building, T: Terrain, mats: CampusMaterials, g: ExtraGroups) {
  const hole = b.holes?.[0];
  const ground = T.minAlong(b.outer);
  // The canopy stands a little higher than the mapped height (site photos).
  const top = ground + b.h + 1.5;
  const c = hole ? centroid(hole) : centroid(b.outer);
  // Canopy: one flat sheet; the beam-and-fin grid is cut out in the material (see CampusMaterials.louver).
  const shape = new THREE.Shape(ensureCCW(b.outer).map(p => new THREE.Vector2(p[0], p[1])));
  if (hole) shape.holes.push(new THREE.Path([...ensureCCW(hole)].reverse().map(p => new THREE.Vector2(p[0], p[1]))));
  const geo = new THREE.ShapeGeometry(shape, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    uv.setXY(i, Math.hypot(x - c[0], y - c[1]) / 0.55, 0.5);
    pos.setXYZ(i, x, top, -y);
  }
  // Mapping (x, y) -> (x, top, -y) mirrors the shape, so flip each triangle to face up.
  const idx = geo.index!;
  for (let k = 0; k < idx.count; k += 3) { const t = idx.getX(k + 1); idx.setX(k + 1, idx.getX(k + 2)); idx.setX(k + 2, t); }
  geo.computeVertexNormals();
  mats.louverCenter.set(c[0], -c[1]);
  let longest = 0;
  for (let i = 0; i < b.outer.length; i++) {
    const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > longest) { longest = l; mats.louverAxis.set((q[0] - p[0]) / l, -(q[1] - p[1]) / l); }
  }
  const slats = new THREE.Mesh(geo, mats.louver);
  slats.customDepthMaterial = mats.louverDepth; // gridded shadow
  slats.castShadow = true;
  g.detail.add(slats);
  // The plaza under the canopy is concrete.
  const floor = new MeshBuilder();
  addDrapedPolygon(floor, b.outer, hole ? [hole] : [], T, LIFT.plaza + 0.006, [0.95, 0.94, 0.92], 2);
  addMesh(g.base, floor, mats.layers.path, { order: LAYER.plaza + 1 });
  const rim = new MeshBuilder(), cols = new MeshBuilder();
  addWalls(rim, b.outer, top - 0.35, top + 0.05, [1, 1, 1], false);
  addWalls(rim, b.outer, top - 0.35, top + 0.05, [1, 1, 1], true);
  if (hole) { addWalls(rim, hole, top - 0.35, top + 0.05, [1, 1, 1], true); addWalls(rim, hole, top - 0.35, top + 0.05, [1, 1, 1], false); }
  const ring = insetRing(b.outer, 1.2) ?? b.outer;
  for (const p of resample([...ring, ring[0]], 9).slice(0, -1)) {
    const y = T.heightAt(p[0], p[1]);
    boxInto(cols, [p[0], (y + top) / 2, -p[1]], [0.3, top - y, 0.3], 0, [1, 1, 1]);
  }
  addMesh(g.detail, rim, mats.canopyWhite, { cast: true });
  addMesh(g.detail, cols, mats.canopyWhite, { cast: true });
  if (!hole) return;
  let rh = 0;
  for (const p of hole) rh += Math.hypot(p[0] - c[0], p[1] - c[1]) / hole.length;
  if (rh < 3 || rh > 25) return;
  // The pool sits level with the highest ground inside the ring, so the lawn model never shows through it.
  const R = Math.min(rh * 0.8, 9);
  let poolTop = -Infinity;
  for (let r = 0; r <= R + 0.6; r += 1) for (let a = 0; a < 16; a++) poolTop = Math.max(poolTop, T.heightAt(c[0] + Math.cos(a / 16 * Math.PI * 2) * r, c[1] + Math.sin(a / 16 * Math.PI * 2) * r));
  buildFountain(c, R, poolTop, mats, g);
}

function buildFountain(c: Pt, R: number, y: number, mats: CampusMaterials, g: ExtraGroups) {
  const steps = new MeshBuilder();
  const ring = (r0: number, r1: number, h: number, seg = 48) => {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p = (r: number, a: number, yy: number) => [c[0] + Math.cos(a) * r, yy, -(c[1] + Math.sin(a) * r)];
      steps.quad(p(r1, a0, h), p(r0, a0, h), p(r0, a1, h), p(r1, a1, h), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.92, 0.9, 0.86]);
      const n = [Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)];
      steps.quad(p(r1, a0, h - 0.18), p(r1, a1, h - 0.18), p(r1, a1, h), p(r1, a0, h), [-n[0], 0, -n[2]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.8, 0.78, 0.74]);
    }
  };
  // A full raised stone ring round the basin, then three seating steps down to the pool.
  const stone = new MeshBuilder();
  const seg = 64, r0 = R, r1 = R + 0.6, top = y + 0.45;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (r: number, a: number, yy: number) => [c[0] + Math.cos(a) * r, yy, -(c[1] + Math.sin(a) * r)];
    const n0 = [Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)];
    stone.quad(p(r1, a0, top), p(r0, a0, top), p(r0, a1, top), p(r1, a1, top), [0, 1, 0], [[0, 0], [0.6, 0], [0.6, 1], [0, 1]], [0.86, 0.8, 0.7]);
    stone.quad(p(r1, a0, y - 0.1), p(r1, a1, y - 0.1), p(r1, a1, top), p(r1, a0, top), n0, [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], [0.78, 0.72, 0.62]);
    stone.quad(p(r0, a1, y - 0.1), p(r0, a0, y - 0.1), p(r0, a0, top), p(r0, a1, top), [-n0[0], 0, -n0[2]], [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], [0.74, 0.68, 0.58]);
  }
  addMesh(g.detail, stone, mats.stoneV, { cast: true });
  const poolR = R - 0.02; // fills the basin inside the stone ring
  addMesh(g.detail, steps, mats.curb, { cast: true });
  const water = new THREE.Mesh(new THREE.CircleGeometry(poolR, 48).rotateX(-Math.PI / 2), mats.fountainWater);
  // A shallow pool level with the plaza (the ground model has no basin).
  water.position.set(c[0], y + 0.04, -c[1]);
  g.detail.add(water);
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7.2, 0.9), mats.concrete);
  column.position.set(c[0], y + 3.6, -c[1]);
  column.castShadow = true;
  g.detail.add(column);
  // Mist: particles drifting out from the column base and rising, animated in the vertex shader.
  const n = 420;
  const seeds = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) seeds.set([Math.random(), Math.random() * Math.PI * 2, Math.random()], i * 3);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  pg.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(c[0], y + 2, -c[1]), R + 4);
  const mist = new THREE.Points(pg, mats.mist);
  mist.position.set(c[0], y - 0.4, -c[1]);
  mist.onBeforeRender = () => { mats.mist.uniforms.uTime.value = performance.now() / 1000; };
  g.detail.add(mist);
}
