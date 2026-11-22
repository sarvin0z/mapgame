// Bare-earth terrain from USGS 3DEP, resampled to a 2 m grid in local meters.
// Heights are relative to the elevation at the map origin. Everything that sits
// on the ground (roads, buildings, props, the cart) samples `heightAt`.
import * as THREE from 'three';
import { EDITS_ON, TERRAIN_EDITS, type TerrainEdit } from './sceneEdits.ts';

function inPoly(p: [number, number], r: [number, number][]) {
  let q = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) q = !q;
  }
  return q;
}
function distToPoly(p: [number, number], r: [number, number][]) {
  let m = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    m = Math.min(m, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return m;
}

export interface TerrainMeta {
  x0: number; y0: number; nx: number; ny: number; step: number;
  baseElevationM: number; minM: number; maxM: number; source: string;
}

export class Terrain {
  readonly heights: Float32Array;

  constructor(public meta: TerrainMeta, cm: Int16Array) {
    this.heights = new Float32Array(cm.length);
    for (let i = 0; i < cm.length; i++) this.heights[i] = cm[i] / 100;
  }

  static async load(base = 'data/'): Promise<Terrain> {
    const [meta, buf] = await Promise.all([
      fetch(base + 'terrain.json').then(r => r.json()),
      fetch(base + 'terrain.bin').then(r => r.arrayBuffer()),
    ]);
    const t = new Terrain(meta, new Int16Array(buf));
    if (EDITS_ON) t.applyEdits(TERRAIN_EDITS);
    return t;
  }

  /** Reshapes the height grid (site edits: levelled plazas, a shallower swale). See sceneEdits.ts. */
  applyEdits(edits: TerrainEdit[]) {
    const { x0, y0, nx, ny, step } = this.meta, h = this.heights;
    const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    for (const e of edits) {
      if (e.kind === 'level') {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const p of e.poly) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const x = x0 + i * step, y = y0 + j * step;
          if (x < bx0 - e.edge || x > bx1 + e.edge || y < by0 - e.edge || y > by1 + e.edge) continue;
          const d = inPoly([x, y], e.poly) ? 0 : distToPoly([x, y], e.poly);
          const w = 1 - smooth(d / e.edge);
          if (w > 0) h[j * nx + i] += (e.h - h[j * nx + i]) * w;
        }
      } else {
        // Plane fitted (least squares) to the ground on the ring at r: the level the dip is raised toward.
        let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, n = 0;
        for (let a = 0; a < 48; a++) {
          const dx = Math.cos(a / 48 * Math.PI * 2) * e.r, dy = Math.sin(a / 48 * Math.PI * 2) * e.r, z = this.heightAt(e.c[0] + dx, e.c[1] + dy);
          sx += dx; sy += dy; sz += z; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * z; syz += dy * z; n++;
        }
        const z0 = sz / n, gx = sxz / sxx, gy = syz / syy; // symmetric ring: sx = sy = sxy = 0
        void sx; void sy; void sxy;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const x = x0 + i * step, y = y0 + j * step, dx = x - e.c[0], dy = y - e.c[1], d = Math.hypot(dx, dy);
          if (d >= e.r) continue;
          const plane = z0 + gx * dx + gy * dy, k = j * nx + i;
          if (h[k] < plane) h[k] += (plane - h[k]) * e.amount * (1 - smooth(d / e.r));
        }
      }
    }
  }

  /** A terrain with every height zero (tests and fallbacks). */
  static flat(): Terrain {
    return new Terrain({ x0: -2000, y0: -2000, nx: 3, ny: 3, step: 2000, baseElevationM: 0, minM: 0, maxM: 0, source: 'flat' }, new Int16Array(9));
  }

  /**
   * Height (m) at map point (east x, north y), interpolated on the same two
   * triangles per cell that the terrain mesh uses (diagonal from (i, j) to
   * (i+1, j+1)), so surfaces built from it lie exactly on the rendered ground.
   * Clamps to the grid edge outside it.
   */
  heightAt(x: number, y: number): number {
    const { x0, y0, nx, ny, step } = this.meta;
    let fx = (x - x0) / step, fy = (y - y0) / step;
    fx = Math.max(0, Math.min(nx - 1.0001, fx));
    fy = Math.max(0, Math.min(ny - 1.0001, fy));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const h = this.heights, k = j * nx + i;
    const ha = h[k], hb = h[k + 1], hc = h[k + nx], hd = h[k + nx + 1];
    return tx >= ty ? ha + (hb - ha) * tx + (hd - hb) * ty : ha + (hc - ha) * ty + (hd - hc) * tx;
  }

  /** The grid the mesh is triangulated on (draped surfaces are cut along it). */
  get grid() { return { x0: this.meta.x0, y0: this.meta.y0, step: this.meta.step }; }

  /** Minimum height along a ring (used to seat buildings on slopes). */
  minAlong(ring: [number, number][]): number {
    let m = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / this.meta.step));
      for (let k = 0; k < n; k++) m = Math.min(m, this.heightAt(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));
    }
    return m;
  }

  /**
   * Grid mesh for one square of the map ([ex0, ey0] to [ex1, ey1]) at `lod`
   * times the base spacing. UVs are world meters / uvScale.
   */
  buildMesh(ex0: number, ey0: number, ex1: number, ey1: number, lod: number, uvScale = 6): THREE.BufferGeometry {
    const s = this.meta.step * lod;
    const n = Math.round((ex1 - ex0) / s), m = Math.round((ey1 - ey0) / s);
    const pos = new Float32Array((n + 1) * (m + 1) * 3), nrm = new Float32Array(pos.length), uv = new Float32Array((n + 1) * (m + 1) * 2);
    const e = this.meta.step;
    for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
      const x = ex0 + i * s, y = ey0 + j * s, k = j * (n + 1) + i;
      pos.set([x, this.heightAt(x, y), -y], k * 3);
      const dx = (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e);
      const dy = (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e);
      // Surface normal of h(x, y) in world axes (x east, y up, z = -north).
      const l = Math.hypot(dx, 1, dy);
      nrm.set([-dx / l, 1 / l, dy / l], k * 3);
      uv.set([x / uvScale, y / uvScale], k * 2);
    }
    const idx: number[] = [];
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // (a, b, d) and (a, d, c) are counter-clockwise seen from above because z = -north.
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}
