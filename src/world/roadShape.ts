// Road shape rules that the map data does not carry: how a wide section narrows into
// its continuation, and where the centre line lies when the two directions have a
// different number of lanes.
import type { Pt } from './campusData.ts';

/**
 * The end of a way that carries on from a wider one (one lane each way leaving a
 * three-lane approach round a median, a street after its turn lane ends). Drawn at their
 * own widths, the wide way ended in a faceted bulb sticking out past the narrow one.
 * Instead the narrow way starts at the wide way's width and narrows to its own over
 * `len` metres, as the pavement does on the ground. (The flare is on the narrow side
 * because a one-way pair starts from a single point: narrowing the wide way to meet
 * them pinched the road at the node.)
 */
export interface Taper {
  /** The node the way ends at. */
  p: Pt;
  /** Unit direction from the node back along the way. */
  dir: Pt;
  /** The way's own width, and its width at the node (the wider way's). */
  from: number;
  to: number;
  len: number;
}

interface Way { id: number; pts: Pt[]; w: number; svc?: string; oneway?: boolean }

/** Tapers by way id, from every pair of way ends that meet head-on with different widths. */
export function roadTapers(roads: Way[]): Map<number, Taper[]> {
  const key = (p: Pt) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
  const nodes = new Map<string, { r: Way; p: Pt; dir: Pt }[]>();
  for (const r of roads) {
    if (r.svc === 'parking_aisle' || r.pts.length < 2) continue;
    for (const end of [0, 1]) {
      const p = end ? r.pts[r.pts.length - 1] : r.pts[0], q = end ? r.pts[r.pts.length - 2] : r.pts[1];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-6) continue;
      const k = key(p);
      if (!nodes.has(k)) nodes.set(k, []);
      nodes.get(k)!.push({ r, p, dir: [(q[0] - p[0]) / l, (q[1] - p[1]) / l] });
    }
  }
  const out = new Map<number, Taper[]>();
  for (const list of nodes.values()) {
    if (list.length < 2) continue;
    for (const a of list) {
      const others = list.filter(o => o !== a);
      // Only where every other way carries on ahead: at a crossing or a side street the full width is right.
      if (!others.every(o => a.dir[0] * o.dir[0] + a.dir[1] * o.dir[1] < -0.6)) continue;
      for (const o of others) {
        if (a.r.w - o.r.w < 1) continue;
        const len = Math.min(26, Math.max(8, (a.r.w - o.r.w) * 3.5));
        if (!out.has(o.r.id)) out.set(o.r.id, []);
        out.get(o.r.id)!.push({ p: o.p, dir: o.dir, from: o.r.w, to: a.r.w, len });
      }
    }
  }
  return out;
}

/** Width of a way of full width `w` at point p, given its tapers. */
export function taperWidth(tapers: Taper[], w: number, p: Pt): number {
  let out = w;
  for (const t of tapers) {
    const d = Math.hypot(p[0] - t.p[0], p[1] - t.p[1]);
    if (d < t.len) out = Math.max(out, t.to + (t.from - t.to) * (d / t.len));
  }
  return out;
}

/**
 * True for a point in the flare of a road end. The curbs were laid out for the ways' own
 * widths and the wide way's round end, so across a flare they would cut through the new
 * pavement; they are left out there (a transition of 8 to 26 m).
 */
export function inTaper(tapers: Taper[], p: Pt): boolean {
  for (const t of tapers) {
    const dx = p[0] - t.p[0], dy = p[1] - t.p[1];
    const s = dx * t.dir[0] + dy * t.dir[1];          // along the way, from the node
    const o = -dx * t.dir[1] + dy * t.dir[0];         // across it
    if (s > -1.5 && s < t.len + 1 && Math.abs(o) < t.to / 2 + 2) return true;
  }
  return false;
}

/**
 * Lanes each way on a two-way road and where its centre line lies, as an offset to the
 * left of the way's own direction (0 = the middle). From the lane counts and turn-lane
 * lists in the map data; with nothing to go on the directions share the road equally.
 */
export function laneSplit(r: { w: number; oneway?: boolean; lanes?: number; lanesF?: number; lanesB?: number; turnF?: string; turnB?: string }): { f: number; b: number; line: number } {
  if (r.oneway) return { f: r.lanes ?? 1, b: 0, line: 0 };
  let f = r.lanesF ?? (r.turnF ? r.turnF.split('|').length : undefined);
  let b = r.lanesB ?? (r.turnB ? r.turnB.split('|').length : undefined);
  if (f === undefined && b !== undefined && r.lanes) f = r.lanes - b;
  if (b === undefined && f !== undefined && r.lanes) b = r.lanes - f;
  if (f === undefined || b === undefined || f < 1 || b < 1) return { f: f && f >= 1 ? f : 1, b: b && b >= 1 ? b : 1, line: 0 };
  // The backward lanes take the left side: the line is b lanes in from the left edge.
  return { f, b, line: r.w / 2 - (b * r.w) / (f + b) };
}
