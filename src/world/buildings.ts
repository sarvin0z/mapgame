// Building geometry. Every building is seated level on its site (the lowest
// footprint corner is exposed as a concrete foundation instead of burying
// windows on the uphill side), its storeys are expressed with floor bands and
// windows aligned to them, and named campus buildings get the forms that make
// them recognisable: roof overhangs, recessed colonnades, fins, sunshades,
// open parking decks, exterior stairs and balconies. Shapes follow reference
// photos of each building; dimensions not mapped in OSM are estimates.
import type { Building, Pt } from './campusData.ts';
import type { Terrain } from './terrain.ts';
import type { FacadeStyle } from './textures.ts';
import { MeshBuilder, addFlatPolygon, addWalls, ensureCCW, centroid } from './geometry.ts';
import { insetRing, maxInset } from './features.ts';
import { simplify } from './curbs.ts';
import { supportPoints } from '../physics/physicsWorld.ts';

const lin = (c: number[]) => c.map(v => Math.pow(v, 2.2));
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; }

/** Mesh buckets, one per material; the chunk builder turns each into one mesh. */
export interface BuildingKit {
  walls(style: string): MeshBuilder;
  roofs: MeshBuilder;
  shingles: MeshBuilder;
  /** University Village building-number plaques (number atlas material). */
  numbers: MeshBuilder;
  white: MeshBuilder;
  concrete: MeshBuilder;
  glass: MeshBuilder;
  metal: MeshBuilder;
  rail: MeshBuilder;
  timber: MeshBuilder;
  stone: MeshBuilder;
  hvac: [number, number, number, number, number][];
  /** Distance (m) from p along the outward direction n to the nearest drivable road, or Infinity within 60 m. */
  roadAhead?: (p: Pt, n: Pt) => number;
}

export interface Seat { ground: number; base: number; top: number; floors: number; fh: number }

// ---------------------------------------------------------------- primitives

/** Axis-aligned-in-map box rotated by yaw (counter-clockwise from east). */
export function box(mb: MeshBuilder, c: number[], size: number[], yaw: number, color: number[]) {
  const [hx, hy, hz] = size.map(v => v / 2);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (x: number, y: number, z: number) => [c[0] + x * cs - z * sn, c[1] + y, c[2] - (x * sn + z * cs)];
  const N = (x: number, z: number) => [x * cs - z * sn, 0, -(x * sn + z * cs)];
  const f = [
    [P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 1, 0]],
    [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, -1, 0]],
    [P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz), N(1, 0)],
    [P(-hx, -hy, -hz), P(-hx, hy, -hz), P(-hx, hy, hz), P(-hx, -hy, hz), N(-1, 0)],
    [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 1)],
    [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), N(0, -1)],
  ];
  for (const [a, b, cc, d, n] of f) mb.quad(a, b, cc, d, n, [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]], color);
}

/**
 * Bar from (a, ya) to (b, yb), `w` wide and `h` tall, its bottom on the line
 * between the two points; it slopes with the line (stair stringers, rails).
 */
export function beam(mb: MeshBuilder, a: Pt, b: Pt, ya: number, yb: number, w: number, h: number, color: number[]) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < 0.01) return;
  const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l, sx = -uy * w / 2, sy = ux * w / 2;
  // Corners in world space (x, y, z = -north).
  const P = (p: Pt, y: number, side: number, up: number) => [p[0] + sx * side, y + up, -(p[1] + sy * side)];
  const c = [
    P(a, ya, -1, 0), P(b, yb, -1, 0), P(b, yb, 1, 0), P(a, ya, 1, 0),
    P(a, ya, -1, h), P(b, yb, -1, h), P(b, yb, 1, h), P(a, ya, 1, h),
  ];
  const faces: [number, number, number, number, number[]][] = [
    [4, 5, 6, 7, [0, 1, 0]], [0, 1, 2, 3, [0, -1, 0]],
    [0, 1, 5, 4, [-sx, 0, sy]], [3, 2, 6, 7, [sx, 0, -sy]],
    [0, 3, 7, 4, [-ux, 0, uy]], [1, 2, 6, 5, [ux, 0, -uy]],
  ];
  for (const [i, j, k, m, n] of faces) {
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    mb.quad(c[i], c[j], c[k], c[m], [n[0] / nl, n[1] / nl, n[2] / nl], [[0, 0], [l, 0], [l, h], [0, h]], color);
  }
}

/** Horizontal slab strip along each edge of a ring, `depth` outward, from y to y + t. */
function ledge(mb: MeshBuilder, ring: Pt[], y: number, depth: number, t: number, color: number[]) {
  const r = ensureCCW(ring);
  const out = insetRing(r, -depth);
  if (!out) return;
  addWalls(mb, out, y, y + t, color, false);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], A = out[i], B = out[(i + 1) % r.length];
    for (const [yy, ny] of [[y + t, 1], [y, -1]] as const) {
      mb.quad([a[0], yy, -a[1]], [b[0], yy, -b[1]], [B[0], yy, -B[1]], [A[0], yy, -A[1]], [0, ny, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
    }
  }
}

function edges(ring: Pt[]) {
  const r = ensureCCW(ring), out: { a: Pt; b: Pt; len: number; u: Pt; n: Pt }[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    out.push({ a, b, len, u, n: [u[1], -u[0]] }); // n: outward normal of a CCW ring
  }
  return out;
}
const longest = (ring: Pt[]) => edges(ring).sort((x, y) => y.len - x.len)[0];

/** A railing: top rail, mid rail and pickets every 0.15 m, `h` tall, along a→b. */
export function railing(mb: MeshBuilder, a: Pt, b: Pt, ya: number, yb: number, h = 1.05, color = [0.1, 0.1, 0.1]) {
  beam(mb, a, b, ya + h - 0.05, yb + h - 0.05, 0.05, 0.05, color);
  beam(mb, a, b, ya + 0.1, yb + 0.1, 0.04, 0.04, color);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(l / 0.15));
  for (let k = 0; k <= n; k += (k % 8 === 0 ? 1 : 1)) {
    const t = k / n, p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], y = ya + (yb - ya) * t;
    const post = k % 8 === 0 || k === n;
    box(mb, [p[0], y + h / 2, -p[1]], post ? [0.06, h, 0.06] : [0.02, h - 0.15, 0.02], Math.atan2(b[1] - a[1], b[0] - a[0]), color);
  }
}

// ---------------------------------------------------------------- seating

/**
 * Ground-floor level for a footprint. Buildings sit level at the highest corner
 * of their footprint (capped 1.2 m above the lowest), so no windows end up
 * below grade; the drop to the lowest corner becomes exposed foundation.
 */
export function seat(b: Building, outer: Pt[], T: Terrain, style: FacadeStyle): Seat {
  const { lo, base } = baseLevel(outer, T);
  const floors = Math.max(1, b.levels ?? Math.round(b.h / style.storey));
  const top = base + b.h;
  return { ground: lo, base, top, floors, fh: Math.min(5.5, Math.max(2.8, (b.h - 0.6) / floors)) };
}

/** Lowest ground along a footprint and the level ground floor (see `seat`). */
export function baseLevel(outer: Pt[], T: Terrain) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], c = outer[(i + 1) % outer.length];
    const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2));
    for (let k = 0; k < n; k++) {
      const h = T.heightAt(a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  // A metre of foundation shows on the downhill side at most; uphill, the ground meets the wall base.
  return { lo, base: Math.min(hi, lo + 1.2) };
}

function foundation(kit: BuildingKit, outer: Pt[], s: Seat) {
  if (s.base - s.ground > 0.05) addWalls(kit.concrete, outer, s.ground - 0.4, s.base + 0.02, [0.86, 0.84, 0.8], false, 2, 1);
}

// ---------------------------------------------------------------- generic body

/** Floor bands between storeys: a 0.28 m ledge projecting 0.14 m. */
function floorBands(kit: BuildingKit, outer: Pt[], s: Seat, color: number[], depth = 0.14) {
  for (let k = 1; k < s.floors; k++) ledge(kit.concrete, outer, s.base + k * s.fh - 0.14, depth, 0.28, color);
}

function parapetRoof(kit: BuildingKit, b: Building, outer: Pt[], holes: Pt[][], top: number, rc: number[], parapet: number) {
  addFlatPolygon(kit.roofs, outer, holes, top, rc, 6);
  if (!parapet) return;
  addWalls(kit.roofs, outer, top, top + parapet, rc.map(c => c * 1.1), true);
  const yC = top + parapet, cc = rc.map(c => c * 1.15);
  for (const e of edges(outer)) {
    const nx = -e.n[0] * 0.3, ny = -e.n[1] * 0.3;
    kit.roofs.quad([e.a[0], yC, -e.a[1]], [e.b[0], yC, -e.b[1]], [e.b[0] + nx, yC, -(e.b[1] + ny)], [e.a[0] + nx, yC, -(e.a[1] + ny)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], cc);
  }
  void b;
}

function rooftopUnits(kit: BuildingKit, b: Building, outer: Pt[], top: number) {
  const ring = ensureCCW(outer);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of ring) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const n = Math.min(8, Math.floor((maxX - minX) * (maxY - minY) / 500));
  const inner = insetRing(ring, 4);
  for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
    const p: Pt = [minX + hash(b.id + 'x' + tries) * (maxX - minX), minY + hash(b.id + 'y' + tries) * (maxY - minY)];
    if (!inner || !inside(p, inner)) continue;
    kit.hvac.push([p[0], top, -p[1], 1.5 + hash(b.id + 's' + tries) * 2.5, Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0])]);
    k++;
  }
}

function inside(p: Pt, ring: Pt[]) {
  let s = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) s = !s;
  }
  return s;
}

// ---------------------------------------------------------------- entry point

export function buildBuilding(b: Building, T: Terrain, styles: Record<string, FacadeStyle>, kit: BuildingKit) {
  const styleName = b.style === 'skybridge' ? 'glassPavilion' : b.style;
  const style = styles[styleName] ?? styles.precast;
  // Adjoining OSM footprints often share edges: a small per-building inset keeps faces apart.
  const outer = b.style === 'cometsGlass'
    ? insetRing(b.outer, -0.5) ?? b.outer // stands just proud of the Union model it adjoins
    : insetRing(b.outer, 0.03 + 0.06 * hash(b.id + 'i')) ?? b.outer;
  const holes = b.holes ?? [];
  if (b.name === 'The Plinth') return; // louvered canopy and fountain: extras.ts
  if (b.style === 'canopy') return canopy(b, outer, holes, T, kit);
  if (b.style === 'shelter') return busShelter(outer, T, kit);
  const s = seat(b, outer, T, style);
  const v = hash(b.id);
  const tint = [1 + (v - 0.5) * style.tint * 2, 1 + (hash(b.id + 'g') - 0.5) * style.tint * 1.5, 1 + (hash(b.id + 'b') - 0.5) * style.tint * 1.5];
  const rc = lin(style.roof).map((c, i) => c * (0.9 + 0.2 * hash(b.id + 'r' + i)));

  if (b.style === 'skybridge') {
    const y0 = s.ground + (b.minH ?? 4.2), y1 = s.ground + b.h;
    addWalls(kit.walls('glassPavilion'), outer, y0, y1, [1, 1, 1], false, 3, y1 - y0, y0);
    addFlatPolygon(kit.white, outer, [], y1, [0.95, 0.95, 0.93]);
    addFlatPolygon(kit.white, outer, [], y0, [0.85, 0.85, 0.83], 1, -1);
    ledge(kit.white, outer, y1 - 0.5, 0.12, 0.5, [0.95, 0.95, 0.93]);
    ledge(kit.white, outer, y0, 0.12, 0.45, [0.95, 0.95, 0.93]);
    // Structural columns down to the ground at the corners: nothing hovers.
    for (const p of supportPoints(b)) {
      const g = T.heightAt(p[0], p[1]) - 0.3;
      box(kit.concrete, [p[0], (g + y0) / 2, -p[1]], [0.5, y0 - g, 0.5], 0, [0.9, 0.9, 0.88]);
    }
    return;
  }
  if (b.style === 'garage' || b.style === 'garageFins') return parkingStructure(b, outer, T, s, kit, b.style === 'garageFins');

  foundation(kit, outer, s);
  if (style.pitched && outer.length >= 4 && pitched(b, outer, s, style, tint, kit)) {
    if (b.style === 'villageStone') villageExtras(b, outer, s, kit);
    return;
  }
  const flatRoof = b.h > 6 && !['shed', 'greenhouse', 'house'].includes(b.style);
  const parapet = flatRoof ? 0.8 : 0;
  const sig = SIGNATURE.find(([re]) => re.test(b.name ?? ''))?.[1];
  const opts = sig?.(b, outer, s, kit, T) ?? {};
  const wallRing = opts.wallRing ?? outer;
  addWalls(kit.walls(styleName), wallRing, opts.wallFrom ?? s.base - 0.3, s.top + parapet, tint, false, style.bay, s.fh, s.base);
  for (const h of holes) addWalls(kit.walls(styleName), h, s.base - 0.3, s.top + parapet, tint, true, style.bay, s.fh, s.base);
  if (!opts.noBands && s.floors > 1) floorBands(kit, wallRing, s, BAND[styleName] ?? [0.85, 0.83, 0.78]);
  parapetRoof(kit, b, outer, holes, s.top, rc, parapet);
  if (flatRoof && b.style !== 'construction' && !opts.noUnits) rooftopUnits(kit, b, outer, s.top);
}

const BAND: Record<string, number[]> = {
  cometsGlass: [0.32, 0.34, 0.36],
  precast: lin([0.78, 0.68, 0.53]), precastPunched: lin([0.74, 0.64, 0.5]), modern: [0.88, 0.89, 0.89], finsWhite: [0.92, 0.92, 0.9],
  glassStone: lin([0.82, 0.78, 0.7]), sciences: lin([0.82, 0.77, 0.68]), slc: lin([0.82, 0.78, 0.7]), ssb: [0.95, 0.95, 0.94],
  ssbAdd: [0.12, 0.13, 0.14], nserl: [0.8, 0.82, 0.84], atec: [0.3, 0.33, 0.36], hallTan: [0.95, 0.94, 0.9], canyonBrick: lin([0.85, 0.8, 0.7]),
  officeBands: [0.92, 0.92, 0.9], brickRed: lin([0.8, 0.76, 0.7]), office: lin([0.75, 0.68, 0.58]), metal: [0.7, 0.72, 0.74],
};

// ---------------------------------------------------------------- pitched roofs

function pitched(b: Building, outer: Pt[], s: Seat, style: FacadeStyle, tint: number[], kit: BuildingKit) {
  const ring = ensureCCW(simplify(outer, 0.8));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of ring) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const ins = ring.length >= 3 ? maxInset(ring, Math.min(maxX - minX, maxY - minY) / 2) : null;
  const eave = ins ? insetRing(ring, -0.45) : null;
  if (!ins || !eave) return false;
  const floors = b.levels ?? Math.max(1, Math.round((b.h - 1.5) / style.storey));
  const wallsH = Math.min(floors * style.storey + 0.4, b.h - 1.2);
  const wallTop = s.base + Math.max(2.6, wallsH);
  const rise = Math.max(1.2, Math.min(ins.d * 0.55, s.top - wallTop + 0.5));
  const bw = b.style === 'villageStone' ? breezeway(outer) : null;
  if (bw) {
    gappedWalls(kit.walls(b.style), outer, s.base - 0.3, wallTop, wallTop - 0.7, tint, style.bay, style.storey, s.base, bw);
    (s as Seat & { breezeway?: Breezeway }).breezeway = bw;
  } else addWalls(kit.walls(b.style), outer, s.base - 0.3, wallTop, tint, false, style.bay, style.storey, s.base);
  if (floors > 1 && b.style !== 'house') for (let k = 1; k < floors; k++) ledge(kit.white, outer, s.base + k * style.storey - 0.1, 0.06, 0.2, [0.95, 0.94, 0.9]);
  const rc = lin(style.roof).map((c, i) => c * (0.85 + 0.3 * hash(b.id + i)));
  addWalls(kit.roofs, eave, wallTop - 0.25, wallTop, [0.9, 0.9, 0.88], false);
  addFlatPolygon(kit.roofs, eave, [], wallTop - 0.25, [0.6, 0.6, 0.6], 1, -1);
  const n = ring.length, ridgeTop = wallTop + rise;
  for (let i = 0; i < n; i++) {
    const a = eave[i], bb = eave[(i + 1) % n], ia = ins.inner[i], ib = ins.inner[(i + 1) % n];
    const A = [a[0], wallTop, -a[1]], B = [bb[0], wallTop, -bb[1]], C = [ib[0], ridgeTop, -ib[1]], D = [ia[0], ridgeTop, -ia[1]];
    const ux = B[0] - A[0], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
    let nx = -(uz * vy), ny = uz * vx - ux * vz, nz = ux * vy;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1, el = Math.hypot(ux, uz);
    const uvs = [[0, 0], [el / 3, 0], [el / 3, 1], [0, 1]];
    kit.shingles.tri(A, B, C, [nx / nl, ny / nl, nz / nl], [uvs[0], uvs[1], uvs[2]], rc);
    kit.shingles.tri(A, C, D, [nx / nl, ny / nl, nz / nl], [uvs[0], uvs[2], uvs[3]], rc);
  }
  addFlatPolygon(kit.shingles, ins.inner, [], ridgeTop, rc, 3);
  (s as Seat & { wallTop?: number }).wallTop = wallTop;
  return true;
}

interface Breezeway { O: Pt; u: Pt; n: Pt; W: number; D: number; /** Wall edges the opening cuts, with where it ends along each. */ openings?: { a: Pt; u: Pt; n: Pt; end: number; len: number }[] }

/**
 * University Village garden apartments (reference photos): stairs rise inside an
 * open breezeway through the middle of the building rather than on its outside.
 * The breezeway crosses the building's short dimension through its centroid,
 * along the footprint's principal axis; this is an approximation, as OSM does
 * not map breezeways.
 */
export function breezeway(outer: Pt[]): Breezeway | null {
  const es = edges(outer);
  if (es.length < 4) return null;
  // Principal axis from the edge-length-weighted second moments of the outline.
  const C = centroid(outer);
  let sxx = 0, syy = 0, sxy = 0;
  for (const e of es) {
    const m: Pt = [(e.a[0] + e.b[0]) / 2 - C[0], (e.a[1] + e.b[1]) / 2 - C[1]];
    sxx += m[0] * m[0] * e.len; syy += m[1] * m[1] * e.len; sxy += m[0] * m[1] * e.len;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u: Pt = [Math.cos(ang), Math.sin(ang)], n: Pt = [u[1], -u[0]];
  // Distance from the centroid to the outline along +n and -n.
  const hit = (dir: Pt) => {
    let best = Infinity;
    for (const f of es) {
      const fx = f.b[0] - f.a[0], fy = f.b[1] - f.a[1], den = dir[0] * fy - dir[1] * fx;
      if (Math.abs(den) < 1e-6) continue;
      const ox = f.a[0] - C[0], oy = f.a[1] - C[1];
      const t = (ox * fy - oy * fx) / den, k = (ox * dir[1] - oy * dir[0]) / den;
      if (k >= 0 && k <= 1 && t > 0.5 && t < best) best = t;
    }
    return best;
  };
  const front = hit(n), back = hit([-n[0], -n[1]]), D = front + back;
  // Long enough to hold a breezeway between two wings, and shallow enough to run through.
  let along = 0;
  for (const e of es) along = Math.max(along, Math.abs((e.a[0] - C[0]) * u[0] + (e.a[1] - C[1]) * u[1]));
  if (!(D >= 7 && D <= 26) || along < 12) return null;
  return { O: [C[0] + n[0] * front, C[1] + n[1] * front], u, n, W: 4.4, D };
}

/** Walls like addWalls, open across the breezeway from the ground to `gapTop`, with a header above. */
function gappedWalls(mb: MeshBuilder, ring: Pt[], y0: number, y1: number, gapTop: number, color: number[], bay: number, storey: number, vOrigin: number, bw: Breezeway) {
  const r = ensureCCW(ring);
  bw.openings = [];
  let acc = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const n = [dy / len, 0, dx / len];
    const seg = (t0: number, t1: number, ya: number, yb: number) => {
      const pa: Pt = [a[0] + dx * t0 / len, a[1] + dy * t0 / len], pb: Pt = [a[0] + dx * t1 / len, a[1] + dy * t1 / len];
      const v0 = (ya - vOrigin) / storey, v1 = (yb - vOrigin) / storey;
      mb.quad([pa[0], ya, -pa[1]], [pb[0], ya, -pb[1]], [pb[0], yb, -pb[1]], [pa[0], yb, -pa[1]], n, [[(acc + t0) / bay, v0], [(acc + t1) / bay, v0], [(acc + t1) / bay, v1], [(acc + t0) / bay, v1]], color);
    };
    // Where this edge crosses the breezeway strip (|across| < W/2), if it runs across it.
    let gap: [number, number] | null = null;
    if (Math.abs((dx * bw.u[0] + dy * bw.u[1]) / len) > 0.7) {
      const A = (p: Pt) => (p[0] - bw.O[0]) * bw.u[0] + (p[1] - bw.O[1]) * bw.u[1];
      const Dp = (p: Pt) => -((p[0] - bw.O[0]) * bw.n[0] + (p[1] - bw.O[1]) * bw.n[1]);
      const A0 = A(a), A1 = A(b), slope = (A1 - A0) / len;
      const ta = (-bw.W / 2 - A0) / slope, tb = (bw.W / 2 - A0) / slope;
      const t0 = Math.max(0, Math.min(ta, tb)), t1 = Math.min(len, Math.max(ta, tb));
      const mid: Pt = [a[0] + dx * (t0 + t1) / 2 / len, a[1] + dy * (t0 + t1) / 2 / len];
      if (t1 - t0 > 1 && Dp(mid) > -1 && Dp(mid) < bw.D + 1) { gap = [t0, t1]; bw.openings.push({ a, u: [dx / len, dy / len], n: [dy / len, -dx / len], end: t1, len }); }
    }
    if (!gap) seg(0, len, y0, y1);
    else { seg(0, gap[0], y0, y1); seg(gap[1], len, y0, y1); seg(gap[0], gap[1], gapTop, y1); }
    acc += len;
  }
}

/** Breezeway interior (side walls, ceiling, switchback stairs and landings), balconies, and the building number. */
function villageExtras(b: Building, outer: Pt[], s: Seat, kit: BuildingKit) {
  const floors = Math.max(2, b.levels ?? Math.round(b.h / 3));
  const fh = 3.0;
  const wallTop = (s as Seat & { wallTop?: number }).wallTop ?? s.base + floors * fh;
  const bw = (s as Seat & { breezeway?: Breezeway }).breezeway;
  const dark = [0.08, 0.08, 0.08], slab = [0.82, 0.8, 0.76], plaster = lin([0.86, 0.8, 0.7]);
  if (bw) {
    const P = (a: number, d: number): Pt => [bw.O[0] + bw.u[0] * a - bw.n[0] * d, bw.O[1] + bw.u[1] * a - bw.n[1] * d];
    const yaw = Math.atan2(bw.u[1], bw.u[0]);
    const top = wallTop - 0.7, D = bw.D, W = bw.W;
    for (const sd of [-1, 1]) { const c = P(sd * (W / 2 + 0.1), D / 2); box(kit.concrete, [c[0], (s.base - 0.3 + top) / 2, -c[1]], [0.2, top - s.base + 0.3, D], yaw, plaster); }
    const cc = P(0, D / 2);
    box(kit.concrete, [cc[0], top + 0.1, -cc[1]], [W + 0.4, 0.2, D], yaw, plaster);
    box(kit.concrete, [cc[0], s.base - 0.12, -cc[1]], [W, 0.3, D + 0.6], yaw, slab);
    // Switchback flights along the breezeway, two per storey, meeting at a half landing.
    const steps = 9, run = 0.28, L = steps * run, dS = D / 2 - L / 2, fw = 1.3;
    for (let f = 0; f < floors - 1; f++) {
      const y0 = s.base + f * fh, rise = fh / 2 / steps;
      for (const [k0, side, from, sgn] of [[0, -1, dS, 1], [1, 1, dS + L, -1]] as const) {
        const yb = y0 + k0 * fh / 2;
        const ac = side * (fw / 2 + 0.1);
        for (let k = 0; k < steps; k++) {
          const c = P(ac, from + sgn * (k + 0.5) * run);
          // Closed risers: each step is a solid block from the tread down one riser height.
          box(kit.concrete, [c[0], yb + (k + 0.5) * rise, -c[1]], [fw, rise + 0.02, run + 0.02], yaw, slab);
        }
        const outerA = side * (fw + 0.12);
        beam(kit.metal, P(outerA, from), P(outerA, from + sgn * L), yb - 0.15, yb + fh / 2 - 0.15, 0.06, 0.25, dark);
        railing(kit.rail, P(outerA, from), P(outerA, from + sgn * L), yb, yb + fh / 2, 0.95, dark);
      }
      const half = P(0, dS + L + 0.7), land = P(0, dS - 0.8);
      box(kit.concrete, [half[0], y0 + fh / 2 - 0.08, -half[1]], [W, 0.16, 1.4], yaw, slab);
      box(kit.concrete, [land[0], y0 + fh - 0.08, -land[1]], [W, 0.16, 1.6], yaw, slab);
    }
  }
  const es = edges(outer).filter(e => e.len > 12).sort((x, y) => y.len - x.len).slice(0, 2);
  es.forEach((e, ei) => {
    const at = (along: number, out: number): Pt => [e.a[0] + e.u[0] * along + e.n[0] * out, e.a[1] + e.u[1] * along + e.n[1] * out];
    const yaw = Math.atan2(e.u[1], e.u[0]);
    const mid = e.len / 2;
    // Balconies: every 9 m along the wall on the upper floors, clear of the breezeway, with railings.
    for (let along = 5 + 4 * ei; along < e.len - 4; along += 9) {
      if (Math.abs(along - mid) < 6) continue;
      for (let f = 1; f < floors; f++) {
        const y = s.base + f * fh;
        const c0 = at(along, 0.75);
        box(kit.concrete, [c0[0], y - 0.1, -c0[1]], [2.6, 0.2, 1.5], yaw, [0.85, 0.83, 0.8]);
        const p1 = at(along - 1.3, 0.05), p2 = at(along - 1.3, 1.5), p3 = at(along + 1.3, 1.5), p4 = at(along + 1.3, 0.05);
        railing(kit.rail, p1, p2, y, y, 1.0, dark);
        railing(kit.rail, p2, p3, y, y, 1.0, dark);
        railing(kit.rail, p3, p4, y, y, 1.0, dark);
      }
      const g = at(along, 1.55);
      box(kit.stone, [g[0], s.base + 0.6, -g[1]], [2.8, 1.2, 0.2], yaw, lin([0.8, 0.7, 0.55]));
    }
  });
  // Building number plaques, large, on the walls that face the driving streets (the ones a
  // driver sees): every wall over 6 m whose outward view reaches a drivable road within 60 m,
  // nearest first, up to three; with no road in view, the two end walls as before.
  const num = Number(b.name);
  if (!Number.isInteger(num) || num < 1 || num > NUMBER_CELLS) return;
  const all = edges(outer).filter(e => e.len > 6);
  const facing = kit.roadAhead
    ? all.map(e => ({ e, d: Math.min(...[0.3, 0.5, 0.7].map(t => kit.roadAhead!([e.a[0] + e.u[0] * e.len * t, e.a[1] + e.u[1] * e.len * t], e.n)) ) }))
      .filter(x => x.d < 60).sort((x, y) => x.d - y.d).slice(0, 3).map(x => x.e)
    : [];
  const axis = bw?.u ?? all.reduce((x, y) => (y.len > x.len ? y : x)).u;
  const walls = facing.length ? facing : all.filter(e => Math.abs(e.u[0] * axis[0] + e.u[1] * axis[1]) < 0.3).sort((x, y) => y.len - x.len).slice(0, 2);
  for (const e of walls) {
    // Centred on the wall, or beside the breezeway opening where the wall has one.
    const o = bw?.openings?.find(q => Math.hypot(q.a[0] - e.a[0], q.a[1] - e.a[1]) < 0.5 && Math.abs(q.len - e.len) < 0.5);
    const along = o && o.end + 1.6 < o.len - 0.9 ? o.end + 1.6 : e.len / 2;
    numberPlaque(kit.numbers, e, along, wallTop - 1.4, num);
  }
}

/** Number atlas layout (see textures.numberAtlas): 9 columns x 8 rows, numbers 1..72. */
const NUMBER_COLS = 9, NUMBER_ROWS = 8, NUMBER_CELLS = NUMBER_COLS * NUMBER_ROWS;
function numberPlaque(mb: MeshBuilder, e: { a: Pt; u: Pt; n: Pt }, along: number, y: number, num: number) {
  const size = 1.6, out = 0.06;
  const c: Pt = [e.a[0] + e.u[0] * along + e.n[0] * out, e.a[1] + e.u[1] * along + e.n[1] * out];
  const p0: Pt = [c[0] - e.u[0] * size / 2, c[1] - e.u[1] * size / 2], p1: Pt = [c[0] + e.u[0] * size / 2, c[1] + e.u[1] * size / 2];
  const k = num - 1, col = k % NUMBER_COLS, row = Math.floor(k / NUMBER_COLS);
  const u0 = col / NUMBER_COLS, u1 = (col + 1) / NUMBER_COLS, v1 = 1 - row / NUMBER_ROWS, v0 = 1 - (row + 1) / NUMBER_ROWS;
  mb.quad([p0[0], y - size / 2, -p0[1]], [p1[0], y - size / 2, -p1[1]], [p1[0], y + size / 2, -p1[1]], [p0[0], y + size / 2, -p0[1]], [e.n[0], 0, -e.n[1]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [1, 1, 1]);
}

// ---------------------------------------------------------------- open structures

function canopy(b: Building, outer: Pt[], holes: Pt[][], T: Terrain, kit: BuildingKit) {
  let lo = Infinity;
  for (const p of outer) lo = Math.min(lo, T.heightAt(p[0], p[1]));
  const top = lo + b.h + 0.08 * hash(b.id + 'h');
  addFlatPolygon(kit.white, outer, holes, top, [0.95, 0.95, 0.93]);
  addFlatPolygon(kit.white, outer, holes, top - 0.3, [0.75, 0.75, 0.73], 1, -1);
  addWalls(kit.white, outer, top - 0.3, top, [0.85, 0.85, 0.83], false);
  // Posts every ~6 m around the slab, set 0.3 m in from its edge (tall canopies too: none may
  // hover); thicker for tall ones.
  const r = insetRing(ensureCCW(outer), 0.3) ?? ensureCCW(outer);
  const post = b.h >= 8 ? 0.45 : 0.22;
  for (const e of edges(r)) {
    const n = Math.max(1, Math.round(e.len / 6));
    for (let k = 0; k < n; k++) {
      const p: Pt = [e.a[0] + e.u[0] * e.len * k / n, e.a[1] + e.u[1] * e.len * k / n];
      const y = T.heightAt(p[0], p[1]);
      box(kit.white, [p[0], (y + top) / 2, -p[1]], [post, top - y, post], 0, [0.9, 0.9, 0.88]);
    }
  }
}

/** DART bus shelter: glass back and sides, white roof on posts, bench. */
function busShelter(outer: Pt[], T: Terrain, kit: BuildingKit) {
  const e = longest(outer);
  if (!e) return;
  const c = centroid(outer), y = T.heightAt(c[0], c[1]);
  const yaw = Math.atan2(e.u[1], e.u[0]);
  const L = Math.max(3, e.len), D = 1.6;
  box(kit.white, [c[0], y + 2.7, -c[1]], [L + 0.3, 0.12, D + 0.3], yaw, [0.95, 0.95, 0.94]);
  const at = (du: number, dv: number): Pt => [c[0] + e.u[0] * du - e.n[0] * dv, c[1] + e.u[1] * du - e.n[1] * dv];
  for (const du of [-L / 2, L / 2]) for (const dv of [-D / 2, D / 2]) { const p = at(du, dv); box(kit.metal, [p[0], y + 1.35, -p[1]], [0.08, 2.7, 0.08], yaw, [0.15, 0.15, 0.15]); }
  const back = at(0, D / 2), s1 = at(-L / 2, 0), s2 = at(L / 2, 0);
  box(kit.glass, [back[0], y + 1.4, -back[1]], [L, 2.0, 0.02], yaw, [1, 1, 1]);
  box(kit.glass, [s1[0], y + 1.4, -s1[1]], [0.02, 2.0, D], yaw, [1, 1, 1]);
  box(kit.glass, [s2[0], y + 1.4, -s2[1]], [0.02, 2.0, D], yaw, [1, 1, 1]);
  const bench = at(0, D / 2 - 0.35);
  box(kit.metal, [bench[0], y + 0.45, -bench[1]], [L * 0.7, 0.06, 0.4], yaw, [0.2, 0.2, 0.2]);
}

/**
 * Parking structure: open decks on columns with solid concrete spandrels
 * (1.1 m guard walls) at every level, a stair/elevator core and, on
 * Parking Structure 4, a full-height screen of silver fins.
 */
function parkingStructure(b: Building, outer: Pt[], T: Terrain, s: Seat, kit: BuildingKit, fins: boolean) {
  const levels = Math.max(2, (b.levels ?? Math.round(b.h / 3.2)) + 1); // decks incl. roof
  const fh = b.h / (levels - 1);
  const conc = [0.82, 0.8, 0.76];
  foundation(kit, outer, s);
  addFlatPolygon(kit.concrete, outer, [], s.base + 0.02, [0.55, 0.55, 0.54]);
  for (let k = 1; k < levels; k++) {
    const y = s.base + k * fh;
    addFlatPolygon(kit.concrete, outer, [], y, k === levels - 1 ? [0.7, 0.7, 0.68] : [0.6, 0.6, 0.58]);
    addFlatPolygon(kit.concrete, outer, [], y - 0.35, [0.5, 0.5, 0.49], 1, -1);
    // Spandrel: the slab edge plus a 1.1 m guard wall, outside and inside faces.
    if (!fins) {
      addWalls(kit.concrete, outer, y - 0.35, y + 1.1, conc, false, 3, 1.45);
      addWalls(kit.concrete, outer, y, y + 1.1, [0.7, 0.7, 0.68], true, 3, 1.1);
    }
  }
  // Ground-level spandrel only at the slab edge (open for entry).
  addWalls(kit.concrete, outer, s.ground - 0.3, s.base + 0.3, conc, false, 3, 1);
  // Columns every ~9 m along the perimeter, set in 0.4 m.
  const ring = insetRing(ensureCCW(outer), 0.45) ?? ensureCCW(outer);
  for (const e of edges(ring)) {
    const n = Math.max(1, Math.round(e.len / 9));
    for (let k = 0; k < n; k++) {
      const p: Pt = [e.a[0] + e.u[0] * e.len * k / n, e.a[1] + e.u[1] * e.len * k / n];
      box(kit.concrete, [p[0], s.base + b.h / 2, -p[1]], [0.6, b.h, 0.6], Math.atan2(e.u[1], e.u[0]), [0.78, 0.76, 0.72]);
    }
  }
  // Interior column lines so the decks read as a garage from outside.
  const inner = insetRing(ensureCCW(outer), 8);
  if (inner) for (const e of edges(inner)) {
    const n = Math.max(1, Math.round(e.len / 9));
    for (let k = 0; k < n; k++) {
      const p: Pt = [e.a[0] + e.u[0] * e.len * k / n, e.a[1] + e.u[1] * e.len * k / n];
      box(kit.concrete, [p[0], s.base + b.h / 2, -p[1]], [0.5, b.h, 0.5], 0, [0.62, 0.62, 0.6]);
    }
  }
  // Stair and elevator core at the longest edge's first corner, rising above the roof deck.
  const e = longest(outer);
  if (e) {
    const p: Pt = [e.a[0] + e.u[0] * 3.5 - e.n[0] * 3, e.a[1] + e.u[1] * 3.5 - e.n[1] * 3];
    if (fins) {
      // Parking Structure 4 (photo): a dark glass stair tower standing proud of the screen,
      // rising 4 m above the roof deck, with white vertical fins on its corners.
      const q: Pt = [e.a[0] + e.u[0] * 4 + e.n[0] * 1.2, e.a[1] + e.u[1] * 4 + e.n[1] * 1.2];
      const yaw = Math.atan2(e.u[1], e.u[0]), th = b.h + 4.5;
      box(kit.walls('ssbAdd'), [q[0], s.base + th / 2, -q[1]], [6.5, th, 6], yaw, [0.55, 0.6, 0.68]);
      for (const du of [-3.3, 3.3]) for (const dn of [-3.05, 3.05]) {
        const c: Pt = [q[0] + e.u[0] * du + e.n[0] * dn, q[1] + e.u[1] * du + e.n[1] * dn];
        box(kit.white, [c[0], s.base + th / 2, -c[1]], [0.25, th + 0.2, 0.25], yaw, [0.94, 0.94, 0.92]);
      }
    } else box(kit.walls('precast'), [p[0], s.base + (b.h + 3.2) / 2, -p[1]], [6, b.h + 3.2, 5.5], Math.atan2(e.u[1], e.u[0]), [1, 1, 1]);
  }
  if (fins) {
    addWalls(kit.walls('garageFins'), outer, s.base + 1.2, s.top + 1.1, [1, 1, 1], false, 2, 3.2, s.base);
    addWalls(kit.walls('garageFins'), outer, s.base + 1.2, s.top + 1.1, [0.7, 0.7, 0.7], true, 2, 3.2, s.base);
    // The wave (photo): a band of closely spaced grey fins, 3 m tall, standing just proud of the
    // screen and rising and falling along the facade in a long sine.
    let acc = 0;
    for (const ed of edges(ensureCCW(outer))) {
      const yaw = Math.atan2(ed.u[1], ed.u[0]);
      for (let t = 0.25; t < ed.len; t += 0.5) {
        const u = acc + t, mid = s.base + b.h * 0.55 + Math.sin(u / 14) * b.h * 0.22;
        const c: Pt = [ed.a[0] + ed.u[0] * t + ed.n[0] * 0.18, ed.a[1] + ed.u[1] * t + ed.n[1] * 0.18];
        box(kit.metal, [c[0], mid, -c[1]], [0.07, 3.0, 0.22], yaw, [0.62, 0.65, 0.68]);
      }
      acc += ed.len;
    }
  }
  // Light poles on the roof deck.
  const c = centroid(outer);
  for (const [dx, dy] of [[-12, 0], [12, 0]]) if (inside([c[0] + dx, c[1] + dy], outer)) box(kit.metal, [c[0] + dx, s.top + 3, -(c[1] + dy)], [0.12, 6, 0.12], 0, [0.2, 0.2, 0.2]);
  void T;
}

// ---------------------------------------------------------------- signature buildings

interface SigOpts { wallRing?: Pt[]; wallFrom?: number; noBands?: boolean; noUnits?: boolean }
type Sig = (b: Building, outer: Pt[], s: Seat, kit: BuildingKit, T: Terrain) => SigOpts | void;

/** Thin flat roof plane projecting `d` beyond the walls, `t` thick, at the roof line. */
function roofOverhang(kit: BuildingKit, outer: Pt[], y: number, d: number, t: number, color: number[], mb?: MeshBuilder) {
  const out = insetRing(ensureCCW(outer), -d);
  if (!out) return;
  const m = mb ?? kit.white;
  addFlatPolygon(m, out, [], y + t, color);
  addFlatPolygon(m, out, [ensureCCW(outer)], y, color.map(c => c * 0.8), 1, -1);
  addWalls(m, out, y, y + t, color.map(c => c * 0.92), false);
}

/** Canopy projecting `d` from one edge, `t` thick, rising `rise` toward its outer edge. */
function edgeCanopy(mb: MeshBuilder, e: ReturnType<typeof longest>, y: number, d: number, t: number, rise: number, color: number[], from = 0, to = 1) {
  const a: Pt = [e.a[0] + e.u[0] * e.len * from, e.a[1] + e.u[1] * e.len * from], b: Pt = [e.a[0] + e.u[0] * e.len * to, e.a[1] + e.u[1] * e.len * to];
  const A: Pt = [a[0] + e.n[0] * d, a[1] + e.n[1] * d], B: Pt = [b[0] + e.n[0] * d, b[1] + e.n[1] * d];
  const top = [[a[0], y + t, -a[1]], [b[0], y + t, -b[1]], [B[0], y + t + rise, -B[1]], [A[0], y + t + rise, -A[1]]];
  const bot = top.map(p => [p[0], p[1] - t, p[2]]);
  mb.quad(top[0], top[1], top[2], top[3], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
  mb.quad(bot[0], bot[1], bot[2], bot[3], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color.map(c => c * 0.75));
  mb.quad(bot[3], bot[2], top[2], top[3], [e.n[0], 0, -e.n[1]], [[0, 0], [1, 0], [1, 1], [0, 1]], color.map(c => c * 0.9));
}

/** Columns along an edge, `out` m outside it, every `spacing` m. */
function colonnade(mb: MeshBuilder, e: ReturnType<typeof longest>, y0: number, y1: number, out: number, spacing: number, size: number, color: number[], from = 0, to = 1) {
  const n = Math.max(1, Math.round(e.len * (to - from) / spacing));
  for (let k = 0; k <= n; k++) {
    const t = from + (to - from) * k / n;
    const p: Pt = [e.a[0] + e.u[0] * e.len * t + e.n[0] * out, e.a[1] + e.u[1] * e.len * t + e.n[1] * out];
    box(mb, [p[0], (y0 + y1) / 2, -p[1]], [size, y1 - y0, size], Math.atan2(e.u[1], e.u[0]), color);
  }
}

/** Vertical fins or pilasters along every wall: `depth` deep, every `spacing` m. */
function fins(mb: MeshBuilder, outer: Pt[], y0: number, y1: number, depth: number, width: number, spacing: number, color: number[]) {
  for (const e of edges(outer)) {
    const n = Math.floor(e.len / spacing);
    for (let k = 1; k < n; k++) {
      const p: Pt = [e.a[0] + e.u[0] * k * spacing + e.n[0] * depth / 2, e.a[1] + e.u[1] * k * spacing + e.n[1] * depth / 2];
      box(mb, [p[0], (y0 + y1) / 2, -p[1]], [width, y1 - y0, depth], Math.atan2(e.u[1], e.u[0]), color);
    }
  }
}

/** Horizontal sunshade blades at each floor, `depth` out from the wall. */
function sunshades(kit: BuildingKit, outer: Pt[], s: Seat, depth: number, color: number[]) {
  for (let k = 0; k < s.floors; k++) ledge(kit.white, outer, s.base + k * s.fh + s.fh * 0.78, depth, 0.08, color);
}

const WHITE = [0.95, 0.95, 0.93], CREAM = lin([0.9, 0.86, 0.78]), TAN = lin([0.8, 0.7, 0.55]), CHARCOAL = [0.1, 0.11, 0.12];

const SIGNATURE: [RegExp, Sig][] = [
  // Founders: white fins and a thin, deep flat roof floating over the top floor (reference photo).
  [/^Founders Building$/, (b, outer, s, kit) => {
    fins(kit.white, outer, s.base, s.top + 0.4, 0.9, 0.22, 1.8, WHITE);
    roofOverhang(kit, outer, s.top + 1.2, 3.2, 0.35, WHITE);
    colonnade(kit.white, longest(outer), s.top + 0.8, s.top + 1.2, 2.6, 7, 0.18, WHITE);
    return { noUnits: true };
  }],
  [/^Founders North$|^Founders West Annex$/, (b, outer, s, kit) => { fins(kit.white, outer, s.base, s.top, 0.5, 0.2, 2.4, WHITE); }],
  // Davidson-Gundy Alumni Center: glass pavilion under a broad cantilevered roof on slender posts.
  [/Davidson-Gundy/, (b, outer, s, kit) => {
    roofOverhang(kit, outer, s.top + 0.3, 4.5, 0.45, WHITE);
    for (const e of edges(outer)) if (e.len > 8) colonnade(kit.white, e, s.base, s.top + 0.3, 3.8, 8, 0.2, WHITE);
    return { noUnits: true, noBands: true };
  }],
  // ATEC: the great sloped roof that cantilevers far over the entrance plaza.
  [/Arts & Technology/, (b, outer, s, kit) => {
    const e = longest(outer);
    edgeCanopy(kit.metal, e, s.top - 0.2, 14, 0.6, 5, [0.55, 0.6, 0.66]);
    colonnade(kit.metal, e, s.base, s.top + 2, 12, 8, 0.35, [0.5, 0.55, 0.6], 0.1, 0.9);
    roofOverhang(kit, outer, s.top + 0.6, 1.5, 0.4, [0.55, 0.6, 0.66], kit.metal);
    return { noBands: true };
  }],
  // JSOM: cream bands with a deep overhanging roof plane and a glass entrance canopy.
  [/Jindal/, (b, outer, s, kit) => {
    roofOverhang(kit, outer, s.top + 0.9, 2.6, 0.5, CREAM);
    const e = longest(outer);
    edgeCanopy(kit.white, e, s.base + 4.6, 5, 0.35, 0, WHITE, 0.35, 0.65);
    colonnade(kit.white, e, s.base, s.base + 4.6, 4.6, 6, 0.3, WHITE, 0.35, 0.65);
    sunshades(kit, outer, s, 0.9, CREAM);
    return { noUnits: true };
  }],
  // McDermott Library: upper floors overhang a recessed, glazed ground floor carried on columns.
  [/McDermott Library/, (b, outer, s, kit) => {
    const inner = insetRing(ensureCCW(outer), 3.2);
    if (!inner) return;
    addWalls(kit.glass, inner, s.base - 0.3, s.base + s.fh, [1, 1, 1], false, 3, s.fh);
    addFlatPolygon(kit.concrete, outer, [inner], s.base + s.fh, TAN.map(c => c * 0.85), 1, -1);
    for (const e of edges(outer)) if (e.len > 6) colonnade(kit.concrete, e, s.base, s.base + s.fh, -1.2, 7.5, 0.7, TAN);
    // Deep fascia bands at each upper floor (the library's horizontal stripes).
    for (let k = 1; k <= s.floors; k++) ledge(kit.concrete, outer, s.base + k * s.fh - 0.9, 0.45, 0.9, TAN);
    return { wallFrom: s.base + s.fh, noBands: true };
  }],
  // Berkner Hall: board-formed tan concrete with deep vertical ribs between punched windows.
  [/Berkner/, (b, outer, s, kit) => {
    fins(kit.concrete, outer, s.base, s.top + 0.8, 0.45, 0.55, 3.6, TAN);
    for (let k = 1; k < s.floors; k++) ledge(kit.concrete, outer, s.base + k * s.fh - 0.25, 0.5, 0.5, TAN);
    return { noBands: true };
  }],
  [/Green Hall|Jonsson Academic|Administration Building/, (b, outer, s, kit) => {
    fins(kit.concrete, outer, s.base, s.top + 0.8, 0.3, 0.4, 3.6, TAN);
  }],
  // ECS West and North: metal sunshade blades over every floor's glazing.
  [/Engineering and Computer Science (West|North)/, (b, outer, s, kit) => { sunshades(kit, outer, s, 1.0, [0.8, 0.82, 0.84]); }],
  [/^Student Services Building$/, (b, outer, s, kit) => { sunshades(kit, outer, s, 1.2, WHITE); roofOverhang(kit, outer, s.top + 0.8, 2.0, 0.35, WHITE); return { noUnits: true }; }],
  [/Student Services Building Addition/, (b, outer, s, kit) => {
    // Charcoal frame boxing out the glazed floors.
    roofOverhang(kit, outer, s.top + 0.4, 1.6, 0.9, CHARCOAL, kit.metal);
    const e = longest(outer);
    edgeCanopy(kit.metal, e, s.base + 4.2, 4, 0.4, 0, CHARCOAL, 0.2, 0.8);
  }],
  [/Bioengineering|Sciences Building|Science Learning|Natural Science/, (b, outer, s, kit) => {
    roofOverhang(kit, outer, s.top + 0.8, 1.4, 0.4, WHITE);
    fins(kit.white, outer, s.base + s.fh, s.top, 0.35, 0.12, 3, [0.85, 0.86, 0.86]);
  }],
  // Student Union: the long hall with a colonnaded arcade along its length.
  [/^Student Union$/, (b, outer, s, kit) => {
    const e = longest(outer);
    edgeCanopy(kit.concrete, e, s.base + 4.4, 4.5, 0.5, 0, TAN);
    colonnade(kit.concrete, e, s.base, s.base + 4.4, 4.2, 6, 0.55, TAN, 0.02, 0.98);
    roofOverhang(kit, outer, s.top + 0.8, 1.2, 0.5, TAN, kit.concrete);
  }],
  [/^Activity Center$/, (b, outer, s, kit) => { roofOverhang(kit, outer, s.top + 0.8, 1.5, 0.6, TAN, kit.concrete); }],
  [/Callier Center Richardson Addition/, (b, outer, s, kit) => {
    const e = longest(outer);
    edgeCanopy(kit.white, e, s.base + 3.6, 3, 0.35, 0, [0.85, 0.3, 0.15], 0.3, 0.6);
  }],
  [/Dining Hall West/, (b, outer, s, kit) => { roofOverhang(kit, outer, s.top + 0.3, 3.0, 0.4, WHITE); return { noBands: true }; }],
  [/Recreation Center/, (b, outer, s, kit) => { const e = longest(outer); edgeCanopy(kit.white, e, s.base + 3.8, 4, 0.4, 0, WHITE, 0.4, 0.6); colonnade(kit.white, e, s.base, s.base + 3.8, 3.8, 4, 0.5, WHITE, 0.4, 0.6); }],
];
