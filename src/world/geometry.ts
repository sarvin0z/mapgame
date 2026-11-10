// Pure geometry helpers (no WebGL) that turn 2D map features into triangle
// soups. World axes: x = east, y = up, z = -north.
import { ShapeUtils, Vector2 } from 'three';
import type { Pt } from './campusData.ts';

export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2; // positive = counter-clockwise (east/north axes)
}

export function ensureCCW(ring: Pt[]): Pt[] { return signedArea(ring) < 0 ? [...ring].reverse() : ring; }
export function ensureCW(ring: Pt[]): Pt[] { return signedArea(ring) > 0 ? [...ring].reverse() : ring; }

export function centroid(ring: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/** Collects triangles with positions, normals, uvs and colors. */
export class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  get vertexCount() { return this.pos.length / 3; }

  /** Push a triangle, flipping its winding if needed so its face normal agrees with `n`. */
  tri(a: number[], b: number[], c: number[], n: number[], uvs: number[][], color: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const flip = fx * n[0] + fy * n[1] + fz * n[2] < 0;
    const verts = flip ? [a, c, b] : [a, b, c];
    const uvv = flip ? [uvs[0], uvs[2], uvs[1]] : uvs;
    for (let i = 0; i < 3; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uvv[i][0], uvv[i][1]);
      this.col.push(color[0], color[1], color[2]);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][], color: number[]) {
    this.tri(a, b, c, n, [uvs[0], uvs[1], uvs[2]], color);
    this.tri(a, c, d, n, [uvs[0], uvs[2], uvs[3]], color);
  }
}

/** Triangulates a polygon (with optional holes) into a horizontal surface at height y. */
export function addFlatPolygon(mb: MeshBuilder, outer: Pt[], holes: Pt[][], y: number, color: number[], uvScale = 1, normalY = 1) {
  const contour = ensureCCW(outer).map(p => new Vector2(p[0], p[1]));
  const hs = holes.map(h => ensureCW(h).map(p => new Vector2(p[0], p[1])));
  const tris = ShapeUtils.triangulateShape(contour, hs);
  const all = contour.concat(...hs);
  const up = [0, normalY, 0];
  for (const t of tris) {
    const v = t.map(i => [all[i].x, y, -all[i].y]);
    const uvs = t.map(i => [all[i].x / uvScale, all[i].y / uvScale]);
    mb.tri(v[0], v[1], v[2], up, uvs, color);
  }
}

/** Vertical walls around a ring, outward-facing. UVs: u = meters / bayWidth, v = meters / storey. */
export function addWalls(mb: MeshBuilder, ring: Pt[], y0: number, y1: number, color: number[], isHole: boolean, bay = 4, storey = 3.6, vOrigin = 0) {
  const r = isHole ? ensureCW(ring) : ensureCCW(ring);
  let u = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    // Right-hand side of travel is outside for a CCW ring (and inside the hole for a CW hole ring).
    const n = [dy / len, 0, dx / len];
    const u0 = u / bay, u1 = (u + len) / bay;
    const v0 = (y0 - vOrigin) / storey, v1 = (y1 - vOrigin) / storey;
    mb.quad([a[0], y0, -a[1]], [b[0], y0, -b[1]], [b[0], y1, -b[1]], [a[0], y1, -a[1]], n,
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color);
    u += len;
  }
}

/** Flat ribbon along a polyline (roads, paths) with mitered joins. */
export function addRibbon(mb: MeshBuilder, pts: Pt[], width: number, y: number, color: number[], uvScale = 4) {
  if (pts.length < 2) return;
  const hw = width / 2;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    let nx = -dy, ny = dx;
    let scale = 1;
    if (i > 0 && i < pts.length - 1) {
      // Miter length correction, clamped to avoid spikes at sharp corners.
      const ax = pts[i][0] - prev[0], ay = pts[i][1] - prev[1];
      const al = Math.hypot(ax, ay) || 1;
      const cos = (-ay / al) * nx + (ax / al) * ny;
      // Long miters at sharp bends stick out as spikes; round joins fill the gap instead.
      scale = Math.min(1.25, 1 / Math.max(0.5, cos));
    }
    nx *= hw * scale; ny *= hw * scale;
    left.push([pts[i][0] + nx, pts[i][1] + ny]);
    right.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  let dist = 0;
  const up = [0, 1, 0];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const v0 = dist / uvScale, v1 = (dist + seg) / uvScale;
    mb.quad(
      [right[i][0], y, -right[i][1]], [left[i][0], y, -left[i][1]],
      [left[i + 1][0], y, -left[i + 1][1]], [right[i + 1][0], y, -right[i + 1][1]],
      up, [[0, v0], [1, v0], [1, v1], [0, v1]], color,
    );
    dist += seg;
  }
}

/** Dashed centerline marks along a polyline. */
export function addDashes(mb: MeshBuilder, pts: Pt[], y: number, color: number[], dash = 3, gap = 6, width = 0.12) {
  let carry = 0; // distance into the current dash+gap period
  const period = dash + gap;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    let s = -carry;
    while (s < len) {
      const s0 = Math.max(0, s), s1 = Math.min(len, s + dash);
      if (s1 > s0) {
        const p0: Pt = [a[0] + dx * s0, a[1] + dy * s0], p1: Pt = [a[0] + dx * s1, a[1] + dy * s1];
        addRibbon(mb, [p0, p1], width, y, color);
      }
      s += period;
    }
    carry = (carry + len) % period;
  }
}

// ---------- Terrain-draped surfaces ----------

export interface HeightSource {
  heightAt(x: number, y: number): number;
  /** Triangulation grid of the rendered ground; draped surfaces are cut along it so they lie exactly on it. */
  grid?: { x0: number; y0: number; step: number };
}

/** Resamples a polyline so no segment is longer than `maxSeg` meters. */
export function resample(pts: Pt[], maxSeg: number): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

/** Left and right edges of a ribbon of `width` around a polyline, with clamped miters. */
export function ribbonEdges(pts: Pt[], width: number): { left: Pt[]; right: Pt[] } {
  const hw = width / 2;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    let scale = 1;
    if (i > 0 && i < pts.length - 1) {
      const ax = pts[i][0] - prev[0], ay = pts[i][1] - prev[1];
      const al = Math.hypot(ax, ay) || 1;
      const cos = (-ay / al) * -dy + (ax / al) * dx;
      // Long miters at sharp bends stick out as spikes; round joins fill the gap instead.
      scale = Math.min(1.25, 1 / Math.max(0.5, cos));
    }
    const nx = -dy * hw * scale, ny = dx * hw * scale;
    left.push([pts[i][0] + nx, pts[i][1] + ny]);
    right.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  return { left, right };
}

function faceUp(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** A ribbon that follows the terrain exactly (cut along the ground's triangles). */
export function addDrapedRibbon(mb: MeshBuilder, pts: Pt[], width: number, terrain: HeightSource, lift: number, color: number[], uvScale = 4, uAcross = 1, round: 'none' | 'joins' | 'all' = 'none', widthAt?: (p: Pt) => number) {
  if (pts.length < 2) return;
  if (round !== 'none') {
    // Round caps and joins, so ways that meet at an angle or end at a junction leave no notch.
    for (let i = 0; i < pts.length; i++) {
      const end = i === 0 || i === pts.length - 1;
      if (end ? round !== 'all' : turnAngle(pts, i) < 0.35) continue;
      addDrapedDisc(mb, pts[i], (widthAt ? widthAt(pts[i]) : width) / 2, terrain, lift, color, uvScale);
    }
  }
  // `widthAt` narrows the ribbon locally (a road tapering into a narrower continuation); sampled every 2 m there.
  const rp = resample(pts, widthAt ? 2 : 4);
  const { left, right } = ribbonEdges(rp, width);
  if (widthAt) for (let i = 0; i < rp.length; i++) {
    const k = widthAt(rp[i]) / width;
    if (k === 1) continue;
    left[i] = [rp[i][0] + (left[i][0] - rp[i][0]) * k, rp[i][1] + (left[i][1] - rp[i][1]) * k];
    right[i] = [rp[i][0] + (right[i][0] - rp[i][0]) * k, rp[i][1] + (right[i][1] - rp[i][1]) * k];
  }
  let dist = 0;
  for (let i = 0; i < rp.length - 1; i++) {
    const seg = Math.hypot(rp[i + 1][0] - rp[i][0], rp[i + 1][1] - rp[i][1]);
    const v0 = dist / uvScale, v1 = (dist + seg) / uvScale;
    const a = right[i], b = left[i], c = left[i + 1], d = right[i + 1];
    drapeTriangle(mb, [a, b, c], [[0, v0], [uAcross, v0], [uAcross, v1]], terrain, lift, color);
    drapeTriangle(mb, [a, c, d], [[0, v0], [uAcross, v1], [0, v1]], terrain, lift, color);
    dist += seg;
  }
}

/** Clips a convex polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
export function clipToRect(poly: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  let out = poly;
  out = clipHalfPlane(out, 1, 0, -x0);
  out = clipHalfPlane(out, -1, 0, x1);
  out = clipHalfPlane(out, 0, 1, -y0);
  out = clipHalfPlane(out, 0, -1, y1);
  return out;
}

/** Keeps the part of a convex polygon where a*x + b*y + c >= 0. */
export function clipHalfPlane(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const dc = a * cur[0] + b * cur[1] + c, dp = a * prev[0] + b * prev[1] + c;
    if ((dc >= 0) !== (dp >= 0)) {
      const t = dp / (dp - dc);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (dc >= 0) out.push(cur);
  }
  return out;
}

/**
 * Adds a map-space triangle on the ground: cut along the terrain's cells and
 * cell diagonals so every piece is coplanar with a ground triangle, then lifted
 * by `lift`. UVs are interpolated from the triangle's corners.
 */
export function drapeTriangle(mb: MeshBuilder, tri: Pt[], uvs: number[][], terrain: HeightSource, lift: number, color: number[]) {
  const [A, B, C] = tri;
  const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(det) < 1e-9) return;
  const uvAt = (p: Pt) => {
    const l1 = ((B[1] - C[1]) * (p[0] - C[0]) + (C[0] - B[0]) * (p[1] - C[1])) / det;
    const l2 = ((C[1] - A[1]) * (p[0] - C[0]) + (A[0] - C[0]) * (p[1] - C[1])) / det;
    const l3 = 1 - l1 - l2;
    return [uvs[0][0] * l1 + uvs[1][0] * l2 + uvs[2][0] * l3, uvs[0][1] * l1 + uvs[1][1] * l2 + uvs[2][1] * l3];
  };
  const emit = (piece: Pt[]) => {
    if (piece.length < 3) return;
    const v = piece.map(p => [p[0], terrain.heightAt(p[0], p[1]) + lift, -p[1]]);
    const t = piece.map(uvAt);
    for (let k = 1; k < piece.length - 1; k++) {
      const n = faceUp(v[0], v[k], v[k + 1]);
      if (Math.abs(n[1]) < 1e-6) continue;
      mb.tri(v[0], v[k], v[k + 1], n, [t[0], t[k], t[k + 1]], color);
    }
  };
  const g = terrain.grid;
  if (!g) { emit(tri); return; }
  const s = g.step;
  const i0 = Math.floor((Math.min(A[0], B[0], C[0]) - g.x0) / s), i1 = Math.floor((Math.max(A[0], B[0], C[0]) - g.x0) / s);
  const j0 = Math.floor((Math.min(A[1], B[1], C[1]) - g.y0) / s), j1 = Math.floor((Math.max(A[1], B[1], C[1]) - g.y0) / s);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const cx = g.x0 + i * s, cy = g.y0 + j * s;
    const piece = clipToRect(tri, cx, cy, cx + s, cy + s);
    if (piece.length < 3) continue;
    // The cell's diagonal runs from (cx, cy) to (cx + s, cy + s): x - y = cx - cy.
    emit(clipHalfPlane(piece, 1, -1, -(cx - cy)));
    emit(clipHalfPlane(piece, -1, 1, cx - cy));
  }
}

/** A polygon (with holes) lying exactly on the terrain. */
export function addDrapedPolygon(mb: MeshBuilder, outer: Pt[], holes: Pt[][], terrain: HeightSource, lift: number, color: number[], uvScale = 1) {
  const contour = ensureCCW(outer).map(p => new Vector2(p[0], p[1]));
  const hs = holes.map(h => ensureCW(h).map(p => new Vector2(p[0], p[1])));
  const tris = ShapeUtils.triangulateShape(contour, hs);
  const all = contour.concat(...hs);
  for (const t of tris) {
    const tri: Pt[] = t.map(i => [all[i].x, all[i].y]);
    drapeTriangle(mb, tri, tri.map(p => [p[0] / uvScale, p[1] / uvScale]), terrain, lift, color);
  }
}

/** Solid strip (curb, step, wall) of a given cross-section following the terrain along a polyline. */
export function addDrapedStrip(mb: MeshBuilder, pts: Pt[], width: number, height: number, terrain: HeightSource, base: number, color: number[], sides = true) {
  if (pts.length < 2) return;
  const rp = resample(pts, 2);
  const { left, right } = ribbonEdges(rp, width);
  const H = (p: Pt) => terrain.heightAt(p[0], p[1]) + base;
  let dist = 0;
  for (let i = 0; i < rp.length - 1; i++) {
    const seg = Math.hypot(rp[i + 1][0] - rp[i][0], rp[i + 1][1] - rp[i][1]);
    const L0 = left[i], L1 = left[i + 1], R0 = right[i], R1 = right[i + 1];
    const hl0 = H(L0), hl1 = H(L1), hr0 = H(R0), hr1 = H(R1);
    const top = [[R0[0], hr0 + height, -R0[1]], [L0[0], hl0 + height, -L0[1]], [L1[0], hl1 + height, -L1[1]], [R1[0], hr1 + height, -R1[1]]];
    mb.quad(top[0], top[1], top[2], top[3], faceUp(top[0], top[1], top[2]), [[0, dist], [width, dist], [width, dist + seg], [0, dist + seg]], color);
    if (sides) {
      for (const [P0, P1, h0, h1] of [[L0, L1, hl0, hl1], [R1, R0, hr1, hr0]] as const) {
        const dx = P1[0] - P0[0], dy = P1[1] - P0[1], l = Math.hypot(dx, dy) || 1;
        // Outward = left of each side's traversal direction: map (-dy, dx) -> world (-dy, 0, -dx).
        mb.quad([P0[0], h0 - 0.05, -P0[1]], [P1[0], h1 - 0.05, -P1[1]], [P1[0], h1 + height, -P1[1]], [P0[0], h0 + height, -P0[1]],
          [-dy / l, 0, -dx / l], [[0, 0], [seg, 0], [seg, height], [0, height]], color.map(c => c * 0.85));
      }
    }
    dist += seg;
  }
}

function turnAngle(pts: Pt[], i: number) {
  const a = pts[i - 1], b = pts[i], c = pts[i + 1];
  const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
}

/** A disc lying on the terrain (road caps, tree pits). UVs in meters / uvScale. */
export function addDrapedDisc(mb: MeshBuilder, c: Pt, r: number, terrain: HeightSource, lift: number, color: number[], uvScale = 4, seg = 14) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p1: Pt = [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], p2: Pt = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r];
    const tri: Pt[] = [c, p1, p2];
    drapeTriangle(mb, tri, tri.map(p => [p[0] / uvScale, p[1] / uvScale]), terrain, lift, color);
  }
}

/**
 * Drops a geometry's JavaScript-side vertex arrays once they have been copied to the GPU.
 * Chunk meshes are never read back or edited after they are built, so the copy only held
 * memory: about as much again as the GPU's own. Bounds are computed first, since
 * culling needs them and could not compute them afterwards. Not for geometry that is
 * shared, cloned or merged later.
 */
export function releaseAfterUpload(g: { attributes: Record<string, unknown>; boundingSphere: unknown; boundingBox: unknown; computeBoundingSphere(): void; computeBoundingBox(): void }) {
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  for (const a of Object.values(g.attributes) as { onUpload?: (cb: () => void) => unknown; array: unknown }[]) {
    a.onUpload?.(function (this: { array: unknown }) { this.array = null; });
  }
}
