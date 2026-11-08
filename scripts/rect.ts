// Minimum-area oriented rectangle of a polygon (no Three.js dependency, for Node scripts).
type Pt = [number, number];
export function orientedRectPlain(ring: Pt[]) {
  const pts = [...ring].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let best = { area: Infinity, L: 0, W: 0, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) { const pu = p[0] * u[0] + p[1] * u[1], pv = -p[0] * u[1] + p[1] * u[0]; u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv); }
    const ar = (u1 - u0) * (v1 - v0);
    if (ar < best.area) best = { area: ar, L: Math.max(u1 - u0, v1 - v0), W: Math.min(u1 - u0, v1 - v0), angle: Math.atan2(u[1], u[0]) };
  }
  return best;
}
