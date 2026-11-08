// Shapes shared by rendering and physics, so what you see is what you hit:
// speed-bump profiles, stair blocks and hip-roof insets.
import type { Bump, Pt, Steps } from './campusData.ts';
import type { HeightSource } from './geometry.ts';
import { ensureCCW, signedArea } from './geometry.ts';

/**
 * Longitudinal profile [distance along road, height] of a traffic-calming
 * device, convex, starting and ending at height 0. Dimensions follow common
 * US practice: bump 0.6 m / 7.5 cm, hump 3.7 m (12 ft) / 7.5 cm,
 * table 6.7 m (22 ft) with 1.8 m ramps / 7.5 cm when mapped as a way with a
 * length; a table mapped as a single node is a raised crosswalk, 4 m with 1 m
 * ramps.
 */
export function bumpProfile(kind: string, len?: number): Pt[] {
  const arch = (L: number, H: number, n = 7): Pt[] =>
    Array.from({ length: n }, (_, i) => { const s = i / (n - 1); return [s * L, H * Math.sin(Math.PI * s)] as Pt; });
  switch (kind) {
    case 'hump': return arch(len ?? 3.7, 0.085, 9);
    case 'table': case 'cushion': {
      if (len === undefined) return [[0, 0], [1.0, 0.075], [3.0, 0.075], [4.0, 0]];
      const L = Math.max(4, len); return [[0, 0], [1.8, 0.075], [L - 1.8, 0.075], [L, 0]];
    }
    case 'mini_bumps': return arch(0.4, 0.05, 5);
    // A slightly short, steep asphalt bump: carts need to crawl over it.
    default: return arch(0.45, 0.085, 7);
  }
}

/** World-space corner points of a bump: profile extruded across the road. */
export function bumpSolid(b: Bump, terrain: HeightSource) {
  const prof = bumpProfile(b.kind, b.len);
  const L = prof[prof.length - 1][0];
  const [dx, dy] = b.dir;
  const nx = -dy, ny = dx; // across the road
  const hw = b.w / 2 - 0.3;
  const base = terrain.heightAt(b.p[0], b.p[1]);
  const pts: number[][][] = [];
  for (const side of [-1, 1]) {
    const row: number[][] = [];
    for (const [s, h] of prof) {
      const x = b.p[0] + dx * (s - L / 2) + nx * hw * side, y = b.p[1] + dy * (s - L / 2) + ny * hw * side;
      row.push([x, Math.max(base, terrain.heightAt(x, y)) + h + 0.01, -y]);
    }
    pts.push(row);
  }
  return { left: pts[0], right: pts[1], base };
}

/** Smallest end-to-end height difference (m) for which a mapped stair is built. */
export const MIN_STAIR_DROP = 0.45;
/** Steeper than this (rise over run) before a mapped flight is built as steps; gentler ways are graded walks. */
export const MIN_STAIR_GRADE = 0.12;

export interface StairBlock { center: [number, number, number]; size: [number, number, number]; yaw: number }

/**
 * Steps along a mapped `highway=steps` way: one block per step, rising from
 * the lower end to the higher end of the terrain. The step count comes from
 * `step_count` where mapped, otherwise from a 16 cm riser.
 */
export function stairBlocks(s: Steps, terrain: HeightSource): StairBlock[] {
  const pts = s.pts;
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(total); }
  if (total < 0.3) return [];
  const h0 = terrain.heightAt(pts[0][0], pts[0][1]), h1 = terrain.heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  // Where the elevation model shows no real level change (it smooths short flights
  // and the walk is graded around them), the steps are left out and the way is
  // drawn as an ordinary walk rather than as blocks sunk into flat ground.
  if (Math.abs(h1 - h0) < MIN_STAIR_DROP) return [];
  // A long way with a gentle drop is a sloped walk in the elevation model; steps there
  // would stand proud of the grade and block the walk.
  if (Math.abs(h1 - h0) / total < MIN_STAIR_GRADE) return [];
  const byDrop = Math.round(Math.abs(h1 - h0) / 0.16);
  const n = Math.max(2, Math.min(60, s.n && Math.abs(h1 - h0) / s.n > 0.08 ? s.n : byDrop));
  const at = (d: number): { p: Pt; yaw: number } => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = (d - cum[i - 1]) / seg;
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  const out: StairBlock[] = [];
  const tread = total / n;
  const lo = Math.min(h0, h1), rise = Math.max(0.1, Math.abs(h1 - h0)) / n;
  let prevTop = -Infinity;
  for (let k = 0; k < n; k++) {
    // Step k counted from the low end. Each tread sits at least 5 cm above the ground
    // across its width (so the slope never pokes through) and never below the previous one.
    const d = h0 <= h1 ? (k + 0.5) * tread : total - (k + 0.5) * tread;
    const { p, yaw } = at(d);
    const cx = Math.cos(yaw), cy = Math.sin(yaw);
    let ground = -Infinity;
    for (const du of [-tread / 2, 0, tread / 2]) for (const dv of [-s.w / 2, 0, s.w / 2])
      ground = Math.max(ground, terrain.heightAt(p[0] + cx * du - cy * dv, p[1] + cy * du + cx * dv));
    const top = Math.max(lo + rise * (k + 1), ground + 0.05, prevTop);
    prevTop = top;
    const bottom = Math.min(top - 0.2, terrain.heightAt(p[0], p[1]) - 0.3);
    out.push({ center: [p[0], (top + bottom) / 2, -p[1]], size: [tread + 0.02, top - bottom, s.w], yaw });
  }
  return out;
}

/** Offsets a CCW ring inward by d (negative = outward). Returns null when the inset collapses. */
export function insetRing(ring: Pt[], d: number): Pt[] | null {
  const r = ensureCCW(ring);
  const n = r.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n], c = r[i], q = r[(i + 1) % n];
    const e1 = norm([c[0] - p[0], c[1] - p[1]]), e2 = norm([q[0] - c[0], q[1] - c[1]]);
    // Inward normal of a CCW ring is the left normal.
    const n1: Pt = [-e1[1], e1[0]], n2: Pt = [-e2[1], e2[0]];
    const bis = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = bis[0] * n1[0] + bis[1] * n1[1];
    if (cos < 0.25) return null; // very sharp corner
    out.push([c[0] + bis[0] * d / cos, c[1] + bis[1] * d / cos]);
  }
  // Valid if every edge kept its direction and the ring kept its orientation.
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n], a2 = out[i], b2 = out[(i + 1) % n];
    if ((b[0] - a[0]) * (b2[0] - a2[0]) + (b[1] - a[1]) * (b2[1] - a2[1]) <= 0) return null;
  }
  if (signedArea(out) <= 0) return null;
  return out;
}
function norm(v: Pt): Pt { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

/** Largest inset (up to `max`) that keeps the ring valid: the hip-roof ridge offset. */
export function maxInset(ring: Pt[], max: number): { d: number; inner: Pt[] } | null {
  let lo = 0, hi = max, best: Pt[] | null = null;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    const r = insetRing(ring, mid);
    if (r) { lo = mid; best = r; } else hi = mid;
  }
  return best && lo > 0.5 ? { d: lo, inner: best } : null;
}
