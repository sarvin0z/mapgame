// Streams campus chunks in and out of the scene around a focus point.
// Chunk meshes are built on demand (budgeted per frame) and disposed when far
// away, so GPU memory holds only the neighbourhood of the camera.
import * as THREE from 'three';
import type { ChunkContent } from './chunks.ts';
import { CHUNK_SIZE } from './chunks.ts';
import { buildChunk, buildChunkSteps, type BuiltChunk, type CampusMaterials, type WorldContext } from './campusBuilder.ts';

export interface StreamSettings {
  viewDistance: number;
  detailDistance: number;
  nearDistance: number;
  /** Full tree crowns (and parked cars, scaled) within this distance; light crowns beyond. */
  treeFullDistance?: number;
}

export class WorldStreamer {
  readonly root = new THREE.Group();
  private built = new Map<string, BuiltChunk>();
  /** Chunk being built across frames. */
  private building: { key: string; far: boolean; it: Generator<void, BuiltChunk, void> } | null = null;
  /** Milliseconds per frame spent building chunks while streaming. */
  buildBudgetMs = 4;
  /** Last focus point (map metres) and chunks whose geometry is not on the GPU yet. */
  private lastFocus: [number, number] = [0, 0];
  private uploads: THREE.Group[] = [];
  /** Longest single build step seen (diagnostics: a step longer than a frame is a hitch). */
  slowStep = { ms: 0, at: '' };
  stats = { loaded: 0, visible: 0, detailVisible: 0, nearVisible: 0 };

  constructor(private chunks: Map<string, ChunkContent>, private mats: CampusMaterials, private ctx: WorldContext, public settings: StreamSettings) {
    this.root.name = 'campus';
  }

  /** Chunks built at the far level (buildings and coarse ground only). */
  private far = new Map<string, boolean>();
  /** Bumped whenever chunk content changes (for re-baking the sun shadows). */
  version = 0;

  update(focus: THREE.Vector3, buildBudget = 2) {
    const fx = focus.x, fy = -focus.z;
    this.lastFocus = [fx, fy];
    const unload = this.settings.viewDistance + CHUNK_SIZE * 1.5;
    // Full detail within the detail range (plus a margin to build ahead), far level beyond,
    // and back to far once well past it (hysteresis keeps chunks from flapping).
    const fullR = this.settings.detailDistance + 60, downR = this.settings.detailDistance + 260;
    const treeFull = this.settings.treeFullDistance ?? 90;
    const pending: [number, string, ChunkContent, boolean][] = [];
    let visible = 0, detailVisible = 0, nearVisible = 0;
    for (const [key, c] of this.chunks) {
      const d = Math.hypot(c.center[0] - fx, c.center[1] - fy) - CHUNK_SIZE * 0.7;
      const b = this.built.get(key);
      if (b) {
        if (d > unload) { this.dispose(key, b); continue; }
        const isFar = this.far.get(key)!;
        if (isFar && d < fullR) pending.push([d, key, c, false]);
        else if (!isFar && d > downR) pending.push([d + 1e5, key, c, true]);
        const v = d < this.settings.viewDistance;
        b.base.visible = v;
        b.detail.visible = v && d < this.settings.detailDistance;
        b.near.visible = v && d < this.settings.nearDistance;
        b.mid.visible = b.detail.visible && !b.near.visible;
        b.coarse.visible = v && !b.near.visible;
        // A far-level chunk inside the detail range (awaiting its rebuild) keeps its tree blobs.
        b.farOnly.visible = v && (!b.detail.visible || isFar);
        b.trees.visible = b.detail.visible;
        if (b.trees.visible) for (const m of b.trees.children) {
          const [x, y] = m.userData.cell as [number, number];
          const full = Math.hypot(x - fx, y - fy) < treeFull * (m.userData.fullScale ?? 1);
          m.visible = (m.userData.lod === 'full') === full;
        }
        if (v) visible++;
        if (b.detail.visible) detailVisible++;
        if (b.near.visible) nearVisible++;
      } else if (d < this.settings.viewDistance) {
        pending.push([d, key, c, d >= fullR]);
      }
    }
    pending.sort((a, b) => a[0] - b[0]);
    if (buildBudget === Infinity) {
      // At startup only the full-detail chunks around the player are built up front; the
      // far ones (horizon) stream in over the next frames while the menu is up.
      for (const [, key, c, far] of pending) if (!far) this.add(key, buildChunk(c, this.mats, this.ctx, false), false);
    } else if (buildBudget > 0) {
      // Time-sliced: continue the chunk in progress, then start the most urgent pending one.
      const t0 = performance.now();
      while (performance.now() - t0 < this.buildBudgetMs) {
        if (!this.building) {
          const next = pending.shift();
          if (!next) break;
          this.building = { key: next[1], far: next[3], it: buildChunkSteps(next[2], this.mats, this.ctx, next[3]) };
        }
        const ts = performance.now();
        const r = this.building.it.next();
        const step = performance.now() - ts;
        if (step > this.slowStep.ms) this.slowStep = { ms: step, at: this.building.key + (this.building.far ? ' far' : ' full') };
        if (r.done) { this.add(this.building.key, r.value, this.building.far); this.building = null; }
      }
    }
    this.stats = { loaded: this.built.size, visible, detailVisible, nearVisible };
  }

  private add(key: string, b: BuiltChunk, far = false) {
    const old = this.built.get(key);
    if (old) this.dispose(key, old);
    // Hidden until the next visibility pass decides which levels to show.
    for (const g of Object.values(b)) g.visible = false;
    this.built.set(key, b);
    this.far.set(key, far);
    this.root.add(...Object.values(b));
    // Chunk content never moves: compute its world matrices once and skip it in the
    // per-frame matrix update (thousands of static objects).
    for (const g of Object.values(b)) {
      g.updateMatrixWorld(true);
      g.traverse((o: THREE.Object3D) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
    }
    // Only chunks near the player change the baked sun shadows (their area is a few
    // hundred metres); far ones never trigger a re-bake.
    const c = this.chunks.get(key)!;
    if (Math.hypot(c.center[0] - this.lastFocus[0], c.center[1] - this.lastFocus[1]) < 420) this.version++;
    this.uploads.push(...Object.values(b));
  }

  /**
   * Uploads one queued chunk group's geometry to the GPU (drawn once into a 1x1 target,
   * frustum culling off), so its first real frame does not pay for the upload; call
   * once per frame. A whole chunk becoming visible used to stall the GPU 40-160 ms.
   */
  uploadNext(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    const g = this.uploads.shift();
    if (!g || !g.parent) return;
    if (!this.uploadTarget) this.uploadTarget = new THREE.WebGLRenderTarget(1, 1);
    const culled: THREE.Object3D[] = [];
    const hidden: THREE.Object3D[] = [];
    g.traverse(o => {
      if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
      if (!o.visible) { o.visible = true; hidden.push(o); }
    });
    const prev = renderer.getRenderTarget(), autoClear = renderer.autoClear, shadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.uploadTarget);
    renderer.render(g, camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadow;
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
  }
  private uploadTarget: THREE.WebGLRenderTarget | null = null;

  /** Builds everything within view distance immediately (used at startup). */
  warm(focus: THREE.Vector3) { this.update(focus, Infinity); this.update(focus, 0); }

  private dispose(key: string, b: BuiltChunk) {
    for (const g of Object.values(b)) {
      g.traverse((o: THREE.Object3D) => {
        // Instanced prop geometries are shared between chunks; only free per-chunk ones.
        if (o instanceof THREE.InstancedMesh) o.dispose();
        // Building models share geometry with their loaded template; never dispose those.
        else if (o instanceof THREE.Mesh && !o.userData.shared) o.geometry.dispose();
      });
      this.root.remove(g);
    }
    this.built.delete(key);
    this.far.delete(key);
  }
}
