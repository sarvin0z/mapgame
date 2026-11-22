// Routable network for the cart: drivable roads, parking aisles, walks, paths and
// crossings (stairs excluded). Nodes are way vertices; ways meet where they share
// a vertex (OSM junction nodes are kept exact by the processing step).
import type { CampusData, Pt } from '../world/campusData.ts';
import { DRIVABLE } from '../world/campusData.ts';
import { polygonLookup, lineLookup } from '../world/spatial.ts';

const ROUTABLE_PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);

export class NavGraph {
  pts: Pt[] = [];
  adj: { to: number; cost: number }[][] = [];
  private index = new Map<string, number>();
  /** True when p is inside a solid building (one the cart cannot drive through). */
  solidAt: (p: Pt) => boolean = () => false;
  private grid = new Map<string, number[]>();

  constructor(data: CampusData) {
    const key = (p: Pt) => Math.round(p[0] * 10) + ',' + Math.round(p[1] * 10);
    const node = (p: Pt) => {
      const k = key(p);
      let i = this.index.get(k);
      if (i === undefined) {
        i = this.pts.length;
        this.pts.push(p);
        this.adj.push([]);
        this.index.set(k, i);
        const g = Math.floor(p[0] / 25) + ',' + Math.floor(p[1] / 25);
        if (!this.grid.has(g)) this.grid.set(g, []);
        this.grid.get(g)!.push(i);
      }
      return i;
    };
    // Walls the cart cannot pass: solid buildings (not canopies, skybridges or anything raised
    // on columns, which the cart can drive under). A walk mapped through a building (a stair
    // breezeway, an indoor corridor) is not a cart route, and one that hugs a wall is a squeeze
    // for a 1.2 m cart: it stays usable but costs more, so routes prefer open walks and roads.
    const solid = (data.buildings ?? []).filter(b => !['canopy', 'skybridge', 'shelter'].includes(b.style) && !b.minH);
    const inside = polygonLookup(solid.map(b => b.outer));
    this.solidAt = inside;
    const nearWall = lineLookup(solid.map(b => ({ pts: [...b.outer, b.outer[0]], hw: 0 })));
    const segFit = (p: Pt, q: Pt) => {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 1.5));
      let tight = 0;
      for (let k = 0; k <= n; k++) {
        const s: Pt = [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n];
        if (inside(s)) return Infinity;
        if (nearWall(s, 1.0)) tight++;
      }
      return 1 + 3 * tight / (n + 1);
    };
    for (const r of data.roads) {
      if (!DRIVABLE.has(r.cls) && !ROUTABLE_PATHS.has(r.cls)) continue;
      // Walks cost slightly more per metre than roads: at equal length a driver keeps to the road.
      const drive = DRIVABLE.has(r.cls), w = drive ? 1 : 1.08;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const fit = drive ? 1 : segFit(r.pts[i], r.pts[i + 1]);
        if (fit === Infinity) continue;
        const a = node(r.pts[i]), b = node(r.pts[i + 1]);
        if (a === b) continue;
        const c = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]) * w * fit;
        // One-way restrictions apply to roads only; the cart may use either direction of a walk.
        this.adj[a].push({ to: b, cost: c });
        if (!(r.oneway && DRIVABLE.has(r.cls))) this.adj[b].push({ to: a, cost: c });
      }
    }
  }

  /** Nearest network node to p (searches outward up to `maxR` metres). */
  nearest(p: Pt, maxR = 150) {
    let best = -1, bd = Infinity;
    for (let r = 0; r * 25 <= maxR && best < 0; r++) {
      const gx = Math.floor(p[0] / 25), gy = Math.floor(p[1] / 25);
      for (let dx = -r - 1; dx <= r + 1; dx++) for (let dy = -r - 1; dy <= r + 1; dy++)
        for (const i of this.grid.get((gx + dx) + ',' + (gy + dy)) ?? []) {
          const d = Math.hypot(this.pts[i][0] - p[0], this.pts[i][1] - p[1]);
          if (d < bd) { bd = d; best = i; }
        }
    }
    return best;
  }

  /** Nodes within `r` metres of any point accepted by `near` (a cheap grid sweep over a box). */
  nodesNear(box: [number, number, number, number], accept: (p: Pt) => boolean) {
    const out: number[] = [];
    for (let gx = Math.floor(box[0] / 25); gx <= Math.floor(box[2] / 25); gx++)
      for (let gy = Math.floor(box[1] / 25); gy <= Math.floor(box[3] / 25); gy++)
        for (const i of this.grid.get(gx + ',' + gy) ?? []) if (accept(this.pts[i])) out.push(i);
    return out;
  }

  /**
   * A* shortest route from `from` to whichever of `to` (one node or several) is cheapest. With
   * `extra`, each goal also costs extra(node): the approach still left from there (so the route
   * ends at the goal nearest the destination, not merely the first one reached).
   */
  route(from: number, to: number | number[], extra?: (i: number) => number): { pts: Pt[]; length: number } | null {
    const goals = Array.isArray(to) ? to : [to];
    if (!goals.length) return null;
    const n = this.pts.length, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const isGoal = new Set(goals);
    const gp = goals.map(i => this.pts[i]);
    const h = (i: number) => { let m = Infinity; for (const q of gp) m = Math.min(m, Math.hypot(this.pts[i][0] - q[0], this.pts[i][1] - q[1])); return m; };
    let reached = -1, bestTotal = Infinity;
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    g[from] = 0;
    push(h(from), from);
    while (heap.length) {
      const [f, i] = pop();
      if (f >= bestTotal) break; // no cheaper goal can remain (h and extra are never negative)
      if (isGoal.has(i)) {
        const total = g[i] + (extra ? extra(i) : 0);
        if (total < bestTotal) { bestTotal = total; reached = i; }
        if (!extra) break;
      }
      for (const e of this.adj[i]) {
        const ng = g[i] + e.cost;
        if (ng < g[e.to]) { g[e.to] = ng; prev[e.to] = i; push(ng + h(e.to), e.to); }
      }
    }
    if (reached < 0) return null;
    const pts: Pt[] = [];
    for (let i = reached; i >= 0; i = prev[i]) pts.push(this.pts[i]);
    pts.reverse();
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { pts, length };
  }
}
