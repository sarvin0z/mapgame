// Curb lines along the edges of curbed streets, derived from OSM road
// centerlines and widths. Curbs are cut where another road branches off,
// where a crosswalk meets the road, at mapped lowered kerbs, and where the
// edge runs through a parking lot, so the cart can always turn off a road
// where a real driveway or crossing exists.
import type { Pt } from './campusData.ts';

interface RoadLike { id: number; cls: string; svc?: string; w: number; pts: Pt[] }
interface AreaLike { kind: string; outer: Pt[] }

const CURBED = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'service']);
const DRIVE = new Set([...CURBED, 'primary', 'living_street', 'construction']);
const UNCURBED_SERVICE = new Set(['parking_aisle', 'driveway', 'alley', 'drive-through']);

export function isCurbed(r: RoadLike) {
  return CURBED.has(r.cls) && !(r.cls === 'service' && UNCURBED_SERVICE.has(r.svc ?? ''));
}

function pointInRing(p: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segParam(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

class Grid<T> {
  private m = new Map<string, T[]>();
  private size: number;
  constructor(size: number) { this.size = size; }
  add(x0: number, y0: number, x1: number, y1: number, v: T) {
    for (let x = Math.floor(x0 / this.size); x <= Math.floor(x1 / this.size); x++)
      for (let y = Math.floor(y0 / this.size); y <= Math.floor(y1 / this.size); y++) {
        const k = x + ',' + y;
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k)!.push(v);
      }
  }
  near(p: Pt): T[] { return this.m.get(Math.floor(p[0] / this.size) + ',' + Math.floor(p[1] / this.size)) ?? []; }
}

/** Returns curb polylines (each at least 3 m long), offset 0.15 m outside the road edge. */
export function computeCurbs(roads: RoadLike[], crossings: { pts: Pt[] }[], kerbs: Pt[], areas: AreaLike[]): Pt[][] {
  const segs = new Grid<{ id: number; a: Pt; b: Pt; hw: number; dir: Pt; atStart: boolean; atEnd: boolean }>(20);
  for (const r of roads) {
    if (!DRIVE.has(r.cls)) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const pad = r.w / 2 + 3;
      segs.add(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad,
        { id: r.id, a, b, hw: r.w / 2, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], atStart: i === 0, atEnd: i === r.pts.length - 2 });
    }
  }
  const gapPts = new Grid<Pt>(10);
  for (const c of crossings) for (const p of [c.pts[0], c.pts[c.pts.length - 1]]) gapPts.add(p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3, p);
  for (const p of kerbs) gapPts.add(p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3, p);
  const lots = areas.filter(a => a.kind === 'parking' || a.kind === 'plaza').map(a => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of a.outer) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { ring: a.outer, x0, y0, x1, y1 };
  });
  const lotGrid = new Grid<typeof lots[number]>(50);
  for (const l of lots) lotGrid.add(l.x0, l.y0, l.x1, l.y1, l);

  const out: Pt[][] = [];
  for (const r of roads) {
    if (!isCurbed(r)) continue;
    for (const side of [1, -1]) {
      let run: Pt[] = [];
      const flush = () => {
        let len = 0;
        for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
        if (len >= 3) out.push(simplify(run, 0.06).map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] as Pt));
        run = [];
      };
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l < 0.01) continue;
        const dir: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        const off = r.w / 2 + 0.15;
        const n = Math.max(1, Math.ceil(l));
        for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
          const c: Pt = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
          const p: Pt = [c[0] - dir[1] * off * side, c[1] + dir[0] * off * side];
          let gap = false;
          for (const s of segs.near(p)) {
            if (s.id === r.id) continue;
            // A parallel continuation of the same street does not open the curb; a branching road does.
            if (Math.abs(s.dir[0] * dir[0] + s.dir[1] * dir[1]) > 0.9 && segDist(c, s.a, s.b) < 1) continue;
            // Only where the other road actually reaches this side: beyond its end (the far
            // side of a T junction) the curb stays continuous.
            const t = segParam(p, s.a, s.b), d = segDist(p, s.a, s.b);
            const atEnd = (t <= 0 && s.atStart) || (t >= 1 && s.atEnd);
            if (atEnd ? d < 1 : d < s.hw + 1.5) { gap = true; break; }
          }
          if (!gap) for (const g of gapPts.near(p)) if (Math.hypot(g[0] - p[0], g[1] - p[1]) < 2.2) { gap = true; break; }
          if (!gap) for (const lot of lotGrid.near(p)) if (p[0] >= lot.x0 && p[0] <= lot.x1 && p[1] >= lot.y0 && p[1] <= lot.y1 && pointInRing(p, lot.ring)) { gap = true; break; }
          if (gap) flush(); else run.push(p);
        }
      }
      flush();
    }
  }
  return out;
}

/** Douglas-Peucker simplification. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol));
}
