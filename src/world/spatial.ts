// Small bucketed spatial lookups used while building chunks.
import type { Pt } from './campusData.ts';

function bucket<T>(cell: number) {
  const m = new Map<string, T[]>();
  return {
    add(x0: number, y0: number, x1: number, y1: number, v: T) {
      for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
        for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) {
          const k = x + ',' + y;
          if (!m.has(k)) m.set(k, []);
          m.get(k)!.push(v);
        }
    },
    at(p: Pt): T[] { return m.get(Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell)) ?? []; },
  };
}

/** True when p is within (half width + margin) of any polyline. */
export function lineLookup(lines: { pts: Pt[]; hw: number }[], cell = 20) {
  const b = bucket<[Pt, Pt, number]>(cell);
  for (const l of lines) for (let i = 0; i < l.pts.length - 1; i++) {
    const a = l.pts[i], c = l.pts[i + 1], pad = l.hw + 3;
    b.add(Math.min(a[0], c[0]) - pad, Math.min(a[1], c[1]) - pad, Math.max(a[0], c[0]) + pad, Math.max(a[1], c[1]) + pad, [a, c, l.hw]);
  }
  return (p: Pt, margin = 0) => b.at(p).some(([a, c, hw]) => {
    const dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= hw + margin;
  });
}

export function pointInRing(p: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** True when p is inside any of the polygons. */
export function polygonLookup(rings: Pt[][], cell = 50) {
  const b = bucket<Pt[]>(cell);
  for (const r of rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    b.add(x0, y0, x1, y1, r);
  }
  return (p: Pt) => b.at(p).some(r => pointInRing(p, r));
}

/** True when a point of the set lies within r of p. */
export function pointLookup(pts: Pt[], cell = 10) {
  const b = bucket<Pt>(cell);
  for (const p of pts) b.add(p[0], p[1], p[0], p[1], p);
  return (p: Pt, r: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const q of b.at([p[0] + dx * cell, p[1] + dy * cell])) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < r) return true;
    return false;
  };
}
