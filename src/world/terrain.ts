// Bare-earth terrain from USGS 3DEP, resampled to a 2 m grid in local meters.
// Heights are relative to the elevation at the map origin. Everything that sits
// on the ground (roads, buildings, props, the cart) samples `heightAt`.
import * as THREE from 'three';

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
    return new Terrain(meta, new Int16Array(buf));
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
