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
}

export class WorldStreamer {
  readonly root = new THREE.Group();
  private built = new Map<string, BuiltChunk>();
  /** Chunk being built across frames. */
  private building: { key: string; it: Generator<void, BuiltChunk, void> } | null = null;
  /** Milliseconds per frame spent building chunks while streaming. */
  buildBudgetMs = 4;
  stats = { loaded: 0, visible: 0, detailVisible: 0, nearVisible: 0 };

  constructor(private chunks: Map<string, ChunkContent>, private mats: CampusMaterials, private ctx: WorldContext, public settings: StreamSettings) {
    this.root.name = 'campus';
  }

  update(focus: THREE.Vector3, buildBudget = 2) {
    const fx = focus.x, fy = -focus.z;
    const unload = this.settings.viewDistance + CHUNK_SIZE * 1.5;
    const pending: [number, string, ChunkContent][] = [];
    let visible = 0, detailVisible = 0, nearVisible = 0;
    for (const [key, c] of this.chunks) {
      const d = Math.hypot(c.center[0] - fx, c.center[1] - fy) - CHUNK_SIZE * 0.7;
      const b = this.built.get(key);
      if (b) {
        if (d > unload) { this.dispose(key, b); continue; }
        const v = d < this.settings.viewDistance;
        b.base.visible = v;
        b.detail.visible = v && d < this.settings.detailDistance;
        b.near.visible = v && d < this.settings.nearDistance;
        b.mid.visible = b.detail.visible && !b.near.visible;
        b.coarse.visible = v && !b.near.visible;
        b.farOnly.visible = v && !b.detail.visible;
        if (v) visible++;
        if (b.detail.visible) detailVisible++;
        if (b.near.visible) nearVisible++;
      } else if (d < this.settings.viewDistance) {
        pending.push([d, key, c]);
      }
    }
    pending.sort((a, b) => a[0] - b[0]);
    if (buildBudget === Infinity) {
      for (const [, key, c] of pending) this.add(key, buildChunk(c, this.mats, this.ctx));
    } else if (buildBudget > 0) {
      // Time-sliced: continue the chunk in progress, then start the nearest pending one.
      const t0 = performance.now();
      while (performance.now() - t0 < this.buildBudgetMs) {
        if (!this.building) {
          const next = pending.find(p => p[1] !== this.building?.key && !this.built.has(p[1]));
          if (!next) break;
          this.building = { key: next[1], it: buildChunkSteps(next[2], this.mats, this.ctx) };
          pending.splice(pending.indexOf(next), 1);
        }
        const r = this.building.it.next();
        if (r.done) { this.add(this.building.key, r.value); this.building = null; }
      }
    }
    this.stats = { loaded: this.built.size, visible, detailVisible, nearVisible };
  }

  private add(key: string, b: BuiltChunk) {
    // Hidden until the next visibility pass decides which levels to show.
    for (const g of Object.values(b)) g.visible = false;
    this.built.set(key, b);
    this.root.add(b.base, b.coarse, b.farOnly, b.detail, b.near, b.mid);
  }

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
  }
}
