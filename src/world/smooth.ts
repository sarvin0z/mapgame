import type { Pt } from './campusData.ts';

/**
 * Corner-cutting (Chaikin-style) smoothing for road centerlines. Each free
 * vertex is replaced by two points cut back toward its neighbours, by at most
 * a quarter of each segment and at most `maxCut` meters, three times over.
 * Fixed vertices (ends, junctions, tagged nodes) never move, so roads still
 * meet where OSM says they meet. Nearly straight vertices are left alone.
 */
export function smoothPolyline(pts: Pt[], fixed: boolean[], maxCut: number, iterations = 3): Pt[] {
  let p = pts, f = fixed;
  let cut = maxCut;
  for (let it = 0; it < iterations; it++) {
    const np: Pt[] = [p[0]], nf: boolean[] = [f[0]];
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1], v = p[i], b = p[i + 1];
      const l1 = Math.hypot(a[0] - v[0], a[1] - v[1]), l2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
      const cos = l1 && l2 ? ((a[0] - v[0]) * (b[0] - v[0]) + (a[1] - v[1]) * (b[1] - v[1])) / (l1 * l2) : -1;
      if (f[i] || cos < -0.9994 || l1 < 0.05 || l2 < 0.05) { np.push(v); nf.push(f[i]); continue; }
      const d1 = Math.min(0.25 * l1, cut), d2 = Math.min(0.25 * l2, cut);
      np.push([v[0] + (a[0] - v[0]) * d1 / l1, v[1] + (a[1] - v[1]) * d1 / l1]);
      np.push([v[0] + (b[0] - v[0]) * d2 / l2, v[1] + (b[1] - v[1]) * d2 / l2]);
      nf.push(false, false);
    }
    np.push(p[p.length - 1]); nf.push(f[f.length - 1]);
    p = np; f = nf;
    cut /= 2;
  }
  return p;
}
