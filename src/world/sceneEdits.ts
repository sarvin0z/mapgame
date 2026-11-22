// Scene edits from the user's 3D-Agentation notes (2026-11-22). Every one-off change to
// the mapped world lives here, so it can be reviewed in one place and switched off with
// `?noedits` to compare against the map as surveyed. General fixes that apply campus-wide
// (road flares at carriageway splits, lane arrows, foundations, floors under models) are
// in the builders themselves; the edits here are the site-specific ones the user asked for.
import type { CampusData, Pt, Road } from './campusData.ts';
import { DRIVABLE } from './campusData.ts';

/** False with ?noedits in the page URL. */
export const EDITS_ON = typeof location === 'undefined' || !new URLSearchParams(location.search).has('noedits');

// ---------------------------------------------------------------- terrain

/**
 * Terrain edits, applied to the height grid when it loads (so roads, buildings, physics
 * and the cart all follow).
 *  - level: inside the polygon, heights become `h`, blending back to the surveyed ground
 *    over `edge` metres outside it.
 *  - raise: within radius `r` of `c`, the ground is lifted toward a plane fitted to the
 *    ring at `r` by `amount` (0..1), with a smooth falloff, so a dip gets shallower without
 *    any kink or bump in the surface around it.
 */
export type TerrainEdit =
  | { kind: 'level'; poly: Pt[]; h: number; edge: number }
  | { kind: 'raise'; c: Pt; r: number; amount: number };

export const TERRAIN_EDITS: TerrainEdit[] = [
  // Note 6: the slope between the two Plinth stair flights, levelled to the plaza for the Ipe steps.
  { kind: 'level', poly: [[159.5, 148.5], [172.5, 148.5], [172.5, 163.0], [159.5, 163.0]], h: -4.2, edge: 2.5 },
  // Note 11: the swale across the road east of the Science Learning Center: three quarters shallower.
  { kind: 'raise', c: [126.6, 537.5], r: 24, amount: 0.75 },
];

// ---------------------------------------------------------------- features

/** Note 7: The Plinth canopy stands 1.75 times as high above the plaza. */
export const PLINTH_HEIGHT_SCALE = 1.75;

/**
 * Note 5/6: the Ipe seating steps, moved from Comets LANding's north wall to the slope
 * between the two Plinth stair flights, facing out over the plaza toward the fountain.
 * A square footprint (width = depth): a 3 m landing at the top, nine 1 m treads down.
 * `top` is the middle of the landing's back edge, `face` the direction the steps face
 * (down and out), `ground` the plaza level at the front.
 */
export const SEATING_STEPS = { top: [157.0, 155.8] as Pt, face: [1, 0] as Pt, width: 12, landing: 3, treads: 9, tread: 1.0, ground: -4.2 };

/** True when map point p lies on the seating steps' footprint (grown by `margin`). */
export function onSeatingSteps(p: Pt, margin = 0) {
  if (!EDITS_ON) return false;
  const S = SEATING_STEPS, u: Pt = [-S.face[1], S.face[0]];
  const dx = p[0] - S.top[0], dy = p[1] - S.top[1];
  const out = dx * S.face[0] + dy * S.face[1], across = dx * u[0] + dy * u[1];
  return out > -margin && out < S.landing + S.treads * S.tread + margin && Math.abs(across) < S.width / 2 + margin;
}

/** Applies the site edits to freshly loaded campus data (no-op with ?noedits). */
export function applySceneEdits(campus: CampusData) {
  if (!EDITS_ON) return;
  const near = (pts: Pt[], p: Pt, r: number) => pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r);
  // Note 6: the pair of gray stair flights beside the Plinth slope (the Ipe steps replace them).
  campus.steps = campus.steps.filter(s => s.id !== 546844546 && s.id !== 1209670609);
  // Note 8: the construction fence east of the Plinth (one mapped fence around the site).
  campus.barriers = campus.barriers.filter(b => !(b.kind === 'fence' && segNear(b.pts, [189.495, 184.101], 1.0)));
  // Note 9: the walk west from the junction by the Science Learning Center becomes one long
  // stair (it climbs to the existing flight): the walk stops at the junction, the flight
  // starts there. Further west, toward the benches, nothing changes.
  const walk = campus.roads.find(r => r.id === 1128097837);
  if (walk) walk.pts = walk.pts.filter(p => p[0] >= 29.5);
  const flight = campus.steps.find(s => s.id === 1128097836);
  // Risers come from the level change (about 15 cm each); built even though the grade is gentle.
  if (flight && near(flight.pts, [26, 242], 0.5)) { flight.pts = [[29.9, 242.0], flight.pts[flight.pts.length - 1]]; flight.n = undefined; flight.force = true; }
  void near;
}

function segNear(pts: Pt[], p: Pt, r: number) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    if (Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- road flares (campus-wide)

/**
 * Where a wide road splits into a pair of one-way carriageways (a divided road beginning),
 * the mapped ways meet at one point: the wide road ends in a round cap and the two narrow
 * ones leave overlapping, so the street pinches to one lane's width before the median opens.
 * A painted road keeps its full width through the split. This adds an asphalt flare from the
 * wide road's full width out to the two carriageways' outer edges, as far as they need to
 * diverge to span that width. Returned as road-surface areas.
 */
export function roadFlares(roads: Road[]): { kind: string; outer: Pt[] }[] {
  const key = (p: Pt) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const ends = new Map<string, { r: Road; atStart: boolean }[]>();
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls) || r.pts.length < 2) continue;
    for (const atStart of [true, false]) {
      const k = key(atStart ? r.pts[0] : r.pts[r.pts.length - 1]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k)!.push({ r, atStart });
    }
  }
  const out: { kind: string; outer: Pt[] }[] = [];
  for (const list of ends.values()) {
    if (list.length !== 3) continue;
    const wide = list.filter(e => !e.r.oneway), pair = list.filter(e => e.r.oneway);
    if (wide.length !== 1 || pair.length !== 2) continue;
    const A = wide[0], wA = A.r.w, wB = Math.max(pair[0].r.w, pair[1].r.w);
    if (wA < wB * 1.6) continue;
    const node = A.atStart ? A.r.pts[0] : A.r.pts[A.r.pts.length - 1];
    // Path along each carriageway away from the node.
    const away = (e: { r: Road; atStart: boolean }) => (e.atStart ? e.r.pts : [...e.r.pts].reverse());
    const intoA = away(A);
    const dA = unit([intoA[1][0] - node[0], intoA[1][1] - node[1]]);
    const c: Pt = [-dA[0], -dA[1]]; // the direction the divided road continues
    const left: Pt = [-c[1], c[0]];
    const [p1, p2] = pair.map(away);
    // Which branch is on the left of the continuing direction (measured 6 m out).
    const side = (pts: Pt[]) => { const q = along(pts, 6); return (q[0] - node[0]) * left[0] + (q[1] - node[1]) * left[1]; };
    const [L, R] = side(p1) >= side(p2) ? [p1, p2] : [p2, p1];
    // Flare length: until the outer edges span the wide road's width, at least 4 m (a taper, not
    // a kink) and at most 30 m.
    let len = 30;
    for (let d = 2; d <= 30; d += 1) {
        const a = along(L, d), b = along(R, d);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) + wB >= wA) { len = Math.max(4, d); break; }
    }
    if (Math.min(polyLen(L), polyLen(R)) < len + 1) continue;
    const edge = (pts: Pt[], sgn: number) => {
      const o: Pt[] = [];
      for (let d = 0; d <= len + 1e-6; d += Math.max(1, len / 8)) {
        const q = along(pts, d), t = tangent(pts, d), n: Pt = [-t[1] * sgn, t[0] * sgn];
        // Outer side of each carriageway: away from the other one.
        o.push([q[0] + n[0] * wB / 2, q[1] + n[1] * wB / 2]);
      }
      return o;
    };
    // Outward normal sign per branch: the left branch's outer edge is to the left of c.
    const sgnFor = (pts: Pt[], want: number) => { const t = tangent(pts, 3), n: Pt = [-t[1], t[0]]; return Math.sign(n[0] * left[0] + n[1] * left[1]) === want ? 1 : -1; };
    const eL = edge(L, sgnFor(L, 1)), eR = edge(R, sgnFor(R, -1));
    const aL: Pt = [node[0] + left[0] * wA / 2, node[1] + left[1] * wA / 2], aR: Pt = [node[0] - left[0] * wA / 2, node[1] - left[1] * wA / 2];
    // The convex hull of the road end and both outer edges: straight kerb lines widening from
    // one road to the pair, with no notch where the mapped ways meet.
    out.push({ kind: 'roadfill', outer: hull([aR, aL, ...eR, ...eL]) });
  }
  return out;
}

/** Curb lines with the parts inside the flares removed (those kerbs are now mid-road). */
export function trimCurbs(curbs: Pt[][], flares: { outer: Pt[] }[]): Pt[][] {
  if (!flares.length) return curbs;
  const inside = (p: Pt) => flares.some(f => inRing(p, f.outer));
  const out: Pt[][] = [];
  for (const line of curbs) {
    let run: Pt[] = [];
    for (let i = 0; i < line.length; i++) {
      // Resample each segment at 0.5 m so a run can end close to the flare edge.
      const a = line[i], b = line[i + 1] ?? a, n = i < line.length - 1 ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)) : 1;
      for (let k = 0; k < n; k++) {
        const p: Pt = i < line.length - 1 ? [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] : a;
        if (inside(p)) { if (run.length > 1) out.push(run); run = []; } else run.push(p);
      }
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

function inRing(p: Pt, r: Pt[]) {
  let q = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) q = !q;
  }
  return q;
}

/** Convex hull (monotone chain), counter-clockwise. */
function hull(ps: Pt[]): Pt[] {
  const p = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const unit = (v: Pt): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
function polyLen(pts: Pt[]) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
function along(pts: Pt[], d: number): Pt {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= d) { const t = (d - acc) / (l || 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    acc += l;
  }
  return pts[pts.length - 1];
}
function tangent(pts: Pt[], d: number): Pt {
  const a = along(pts, Math.max(0, d - 0.5)), b = along(pts, d + 0.5);
  return unit([b[0] - a[0], b[1] - a[1]]);
}
