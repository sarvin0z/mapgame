// Streams campus chunks in and out of the scene around a focus point.
// Chunk meshes are built on demand (budgeted per frame) and disposed when far
// away, so GPU memory holds only the neighbourhood of the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { releaseAfterUpload } from './geometry.ts';
import type { ChunkContent } from './chunks.ts';
import { CHUNK_SIZE } from './chunks.ts';
import { buildChunk, buildChunkSteps, disposeGroup, CLOSE_GROUPS, type BuiltChunk, type CampusMaterials, type WorldContext } from './campusBuilder.ts';

export interface StreamSettings {
  viewDistance: number;
  detailDistance: number;
  nearDistance: number;
  /** Full tree crowns within this distance of the camera (light crowns beyond). */
  treeFullDistance?: number;
  /** Far ground paint is drawn out to this distance (default: the view distance). */
  groundDistance?: number;
}

/** Chunks per side of a merge tile (600 m). */
const TILE = 3;

/**
 * A chunk's always-drawn meshes (walls, roofs, trim, water: its `base` group), merged with
 * those of its neighbours in a 3 x 3 tile, one mesh per material. Every chunk used to draw
 * its own two to twelve of these at every distance: several hundred draw calls a frame for
 * buildings a kilometre away, which cost the CPU far more to submit than the GPU to draw.
 * The sources are kept (off the scene, so never uploaded) to re-merge when a neighbour
 * streams in or out.
 */
interface Tile {
  group: THREE.Group;
  sources: Map<string, THREE.Mesh[]>;
  center: [number, number];
  dirty: number;
}

/** Plain per-chunk meshes can be merged; instanced props, shared building models and custom-shadowed meshes stay in the chunk. */
const mergeable = (o: THREE.Object3D): o is THREE.Mesh => {
  const m = o as THREE.Mesh;
  return m.isMesh === true && !(o instanceof THREE.InstancedMesh) && !o.userData.shared && !Array.isArray(m.material) && !m.customDepthMaterial
    && m.geometry.index === null && !!m.geometry.attributes.position?.array;
};

export class WorldStreamer {
  private tiles = new Map<string, Tile>();
  /** Set false to draw every chunk's own meshes (for comparing draw calls). */
  mergeBase = true;

  private tileOf(key: string) {
    const [cx, cy] = key.split(',').map(Number);
    const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE), k = tx + ',' + ty;
    let t = this.tiles.get(k);
    if (!t) {
      t = { group: new THREE.Group(), sources: new Map(), center: [(tx + 0.5) * TILE * CHUNK_SIZE, (ty + 0.5) * TILE * CHUNK_SIZE], dirty: 0 };
      t.group.name = 'tile ' + k;
      this.tiles.set(k, t);
      this.root.add(t.group);
    }
    return t;
  }

  /** Moves a new chunk's mergeable base meshes into its tile; on a rebuild of a chunk the tile already holds, drops them. */
  private adopt(key: string, base: THREE.Group, rebuilt: boolean) {
    if (!this.mergeBase) return;
    const t = this.tileOf(key);
    const own = base.children.filter(o => mergeable(o) && o.children.length === 0 && o.position.lengthSq() === 0 && o.quaternion.w === 1 && o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1) as THREE.Mesh[];
    for (const m of own) base.remove(m);
    if (rebuilt && t.sources.has(key)) { for (const m of own) m.geometry.dispose(); return; }
    t.sources.set(key, own);
    t.dirty ||= 1;
  }

  private rebuildTile(t: Tile) {
    for (const o of t.group.children) (o as THREE.Mesh).geometry.dispose();
    t.group.clear();
    const sets = new Map<string, THREE.Mesh[]>();
    for (const list of t.sources.values()) for (const m of list) {
      const k = [(m.material as THREE.Material).uuid, m.castShadow, m.receiveShadow, m.renderOrder, Object.keys(m.geometry.attributes).sort().join('+')].join('|');
      if (!sets.has(k)) sets.set(k, []);
      sets.get(k)!.push(m);
    }
    for (const list of sets.values()) {
      const g = list.length > 1 ? mergeGeometries(list.map(m => m.geometry)) : null;
      // (a lone mesh, or geometries that will not merge, are drawn from a copy: the sources stay untouched)
      const geos = g ? [g] : list.map(m => m.geometry.clone());
      for (const geo of geos) {
        releaseAfterUpload(geo);
        const mesh = new THREE.Mesh(geo, list[0].material);
        mesh.castShadow = list[0].castShadow;
        mesh.receiveShadow = list[0].receiveShadow;
        mesh.renderOrder = list[0].renderOrder;
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        t.group.add(mesh);
      }
    }
    t.group.updateMatrixWorld(true);
    t.dirty = 0;
  }

  /** Re-merges tiles whose chunks changed: all at once when asked, else one a frame once streaming pauses. */
  private mergeTiles(all: boolean, fx: number, fy: number) {
    const reach = this.settings.viewDistance + TILE * CHUNK_SIZE * 0.75;
    let done = false;
    for (const [k, t] of this.tiles) {
      if (!t.sources.size) {
        for (const o of t.group.children) (o as THREE.Mesh).geometry.dispose();
        this.root.remove(t.group);
        this.tiles.delete(k);
        continue;
      }
      if (t.dirty && (all || (!done && (!this.building || t.dirty > 45)))) { this.rebuildTile(t); done = true; }
      else if (t.dirty) t.dirty++;
      t.group.visible = Math.hypot(t.center[0] - fx, t.center[1] - fy) < reach;
    }
  }
  readonly root = new THREE.Group();
  private built = new Map<string, BuiltChunk>();
  /** Chunks currently built in full (with their close-up groups); the rest are in their far form. */
  private fullKeys = new Set<string>();
  /** Chunk being built across frames. */
  private building: { key: string; full: boolean; it: Generator<void, BuiltChunk, void> } | null = null;
  /**
   * A chunk is built in full this far beyond the detail range (so it is ready before
   * its detail is shown: 120 m is 12 s at the cart's top speed, and a chunk builds in about one), and drops back to its far
   * form at `fullRelease` beyond it. The gap keeps a cart circling a boundary from rebuilding.
   */
  fullLead = 120;
  fullRelease = 400;
  /** Milliseconds per frame spent building chunks while streaming. */
  buildBudgetMs = 4;
  stats = { loaded: 0, visible: 0, detailVisible: 0, nearVisible: 0 };

  constructor(private chunks: Map<string, ChunkContent>, private mats: CampusMaterials, private ctx: WorldContext, public settings: StreamSettings) {
    this.root.name = 'campus';
  }

  /**
   * Builds in full, at once, every chunk within `radius` of a point: the cart's surroundings
   * after a jump across campus (a reset, a new deployment point), or a spot about to be
   * photographed for a dispatch card. Blocks for the time it takes.
   */
  ensureFull(focus: THREE.Vector3, radius: number) {
    const fx = focus.x, fy = -focus.z;
    for (const [key, c] of this.chunks) {
      if (this.fullKeys.has(key) || Math.hypot(c.center[0] - fx, c.center[1] - fy) - CHUNK_SIZE * 0.7 > radius) continue;
      if (this.building?.key === key) this.building = null;
      this.add(key, buildChunk(c, this.mats, this.ctx, true), true);
    }
  }
  private lastFocus = new THREE.Vector3(Infinity, 0, 0);

  update(focus: THREE.Vector3, buildBudget = 2) {
    const fx = focus.x, fy = -focus.z;
    // The camera jumped (not drove) somewhere new: have the ground it stands on ready this frame.
    if (buildBudget > 0 && buildBudget !== Infinity && this.lastFocus.x !== Infinity && this.lastFocus.distanceTo(focus) > 150) this.ensureFull(focus, this.settings.nearDistance);
    if (buildBudget > 0) this.lastFocus.copy(focus);
    const unload = this.settings.viewDistance + CHUNK_SIZE * 1.5;
    const pending: [number, string, ChunkContent, boolean][] = [];
    const fullWithin = this.settings.detailDistance + this.fullLead, farBeyond = this.settings.detailDistance + this.fullRelease;
    let visible = 0, detailVisible = 0, nearVisible = 0;
    for (const [key, c] of this.chunks) {
      const d = Math.hypot(c.center[0] - fx, c.center[1] - fy) - CHUNK_SIZE * 0.7;
      const b = this.built.get(key);
      if (b) {
        if (d > unload) { this.dispose(key, b); continue; }
        const isFull = this.fullKeys.has(key);
        if (!isFull && d < fullWithin) pending.push([d, key, c, true]);
        // (not on a borrowed view, such as a dispatch-card photo taken across campus)
        else if (isFull && d > farBeyond && buildBudget > 0) { for (const k of CLOSE_GROUPS) disposeGroup(b[k]); this.fullKeys.delete(key); }
        const v = d < this.settings.viewDistance;
        b.base.visible = v;
        // A chunk still in its far form (just after a jump across campus) keeps showing that until its full build lands.
        const close = this.fullKeys.has(key);
        b.detail.visible = v && close && d < this.settings.detailDistance;
        b.near.visible = v && close && d < this.settings.nearDistance;
        b.mid.visible = b.detail.visible && !b.near.visible;
        b.coarse.visible = v && !b.near.visible;
        b.farOnly.visible = v && !b.detail.visible;
        // Roads and lots on far terrain lie edge-on to a driver and sit in the haze: ~1 draw call each for nothing.
        b.ground.visible = b.coarse.visible && d < (this.settings.groundDistance ?? Infinity);
        b.trees.visible = b.detail.visible;
        if (b.detail.visible) {
          const full = this.settings.treeFullDistance ?? 90;
          for (const m of b.trees.children) {
            const [x, y] = m.userData.cell as [number, number];
            const isFull = Math.hypot(x - fx, y - fy) < full * (m.userData.fullScale ?? 1);
            m.visible = (m.userData.lod === 'full') === isFull;
          }
        }
        if (v) visible++;
        if (b.detail.visible) detailVisible++;
        if (b.near.visible) nearVisible++;
      } else if (d < this.settings.viewDistance) {
        pending.push([d, key, c, d < fullWithin]);
      }
    }
    pending.sort((a, b) => a[0] - b[0]);
    if (buildBudget === Infinity) {
      for (const [, key, c, full] of pending) this.add(key, buildChunk(c, this.mats, this.ctx, full), full);
    } else if (buildBudget > 0) {
      // Time-sliced: continue the chunk in progress, then start the nearest pending one.
      const t0 = performance.now();
      while (performance.now() - t0 < this.buildBudgetMs) {
        if (!this.building) {
          const next = pending[0];
          if (!next) break;
          this.building = { key: next[1], full: next[3], it: buildChunkSteps(next[2], this.mats, this.ctx, next[3]) };
          pending.shift();
        }
        const r = this.building.it.next();
        if (r.done) {
          // Dropped if, while it was being built, the chunk was already brought to this form.
          const stale = this.building.full ? this.fullKeys.has(this.building.key) : this.built.has(this.building.key);
          if (stale) for (const g of Object.values(r.value)) disposeGroup(g);
          else this.add(this.building.key, r.value, this.building.full);
          this.building = null;
        }
      }
    }
    this.mergeTiles(buildBudget === Infinity, fx, fy);
    this.stats = { loaded: this.built.size, visible, detailVisible, nearVisible };
  }

  private add(key: string, b: BuiltChunk, full: boolean) {
    // A full build replaces the chunk's far form.
    const old = this.built.get(key);
    if (old) this.dispose(key, old, true);
    this.adopt(key, b.base, !!old);
    if (full) this.fullKeys.add(key);
    // Hidden until the next visibility pass decides which levels to show.
    for (const g of Object.values(b)) g.visible = false;
    this.built.set(key, b);
    this.root.add(...Object.values(b));
    // Chunk content never moves once built: compute its world matrices once and skip it
    // in the per-frame matrix update (it was ~9 ms a frame over ~10k objects).
    for (const g of Object.values(b)) {
      g.updateMatrixWorld(true);
      g.traverse((o: THREE.Object3D) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
    }
  }

  /** Builds everything within view distance immediately (used at startup). */
  warm(focus: THREE.Vector3) { this.update(focus, Infinity); this.update(focus, 0); }

  /** `replacing`: the chunk is being swapped for another build of itself, so its share of the merged tile stays. */
  private dispose(key: string, b: BuiltChunk, replacing = false) {
    if (!replacing) {
      const t = this.tileOf(key), own = t.sources.get(key);
      if (own) { for (const m of own) m.geometry.dispose(); t.sources.delete(key); t.dirty ||= 1; }
    }
    for (const g of Object.values(b)) {
      disposeGroup(g);
      this.root.remove(g);
    }
    this.built.delete(key);
    this.fullKeys.delete(key);
  }
}
