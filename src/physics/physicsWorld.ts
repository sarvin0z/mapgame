// Rapier world: the 3DEP terrain as one heightfield, plus collision geometry
// streamed per chunk around the vehicle (buildings, walls, fences, curbs,
// speed bumps, stairs, bollards, lamp posts, tree trunks, pond edges).
import RAPIER from '@dimforge/rapier3d-compat';
import type { ChunkContent } from '../world/chunks.ts';
import { CHUNK_SIZE } from '../world/chunks.ts';
import { ensureCCW, resample, ribbonEdges } from '../world/geometry.ts';
import { bumpSolid, stairBlocks } from '../world/features.ts';
import type { Terrain } from '../world/terrain.ts';
import type { Pt } from '../world/campusData.ts';
import { pointInRing } from '../world/spatial.ts';

export type Rapier = typeof RAPIER;

export async function initRapier(): Promise<Rapier> {
  await RAPIER.init();
  return RAPIER;
}

// Elevated structures (skybridges, canopies) the cart can drive under.
const PASSABLE_MIN_HEIGHT = 2.4;
/** Height of a standard curb above the road surface (m). */
export const CURB_HEIGHT = 0.15;

export class PhysicsWorld {
  world: RAPIER.World;
  private chunkBodies = new Map<string, RAPIER.RigidBody>();
  stats = { chunks: 0, colliders: 0, stepMs: 0 };

  /** Extra solid boxes per chunk (parked cars): center (world), half extents, rotation about +y. */
  extraBoxes: (c: ChunkContent) => { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }[] = () => [];

  /** Solid parts of reconstructed models outside their footprints, by building (set from main). */
  modelSolids: (b: ChunkContent['buildings'][number]) => { posts: [number, number, number][]; rings: [number, number][][] } | undefined = () => undefined;

  /** Every canopy footprint on the map (arcades can straddle chunk borders). */
  private canopies: { outer: Pt[] }[];

  constructor(public R: Rapier, private chunks: Map<string, ChunkContent>, private terrain: Terrain, public colliderRadius = 260) {
    this.canopies = [...chunks.values()].flatMap(c => c.buildings.filter(b => b.style === 'canopy'));
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;
    const ground = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.world.createCollider(heightfieldDesc(R, terrain).setFriction(1.0), ground);
    // Far below the terrain, a slab catches anything that leaves the heightfield.
    this.world.createCollider(R.ColliderDesc.cuboid(6000, 1, 6000).setTranslation(0, terrain.meta.minM - 30, 0), ground);
  }

  /** Adds/removes chunk colliders so only chunks near `x, z` (world coords) are simulated. */
  stream(x: number, z: number) {
    const fx = x, fy = -z;
    for (const [key, c] of this.chunks) {
      const d = Math.hypot(c.center[0] - fx, c.center[1] - fy) - CHUNK_SIZE * 0.7;
      const body = this.chunkBodies.get(key);
      if (d < this.colliderRadius && !body) this.chunkBodies.set(key, this.buildChunkColliders(c));
      else if (d > this.colliderRadius + 80 && body) {
        this.world.removeRigidBody(body);
        this.chunkBodies.delete(key);
      }
    }
    this.stats.chunks = this.chunkBodies.size;
    this.stats.colliders = this.world.colliders.len();
  }

  private buildChunkColliders(c: ChunkContent): RAPIER.RigidBody {
    const R = this.R, T = this.terrain, W = this.world;
    const body = W.createRigidBody(R.RigidBodyDesc.fixed());
    const post = (p: Pt, h: number, r: number) => W.createCollider(R.ColliderDesc.cylinder(h / 2, r).setTranslation(p[0], T.heightAt(p[0], p[1]) + h / 2, -p[1]), body);
    const yawQ = (ang: number) => ({ x: 0, y: Math.sin(ang / 2), z: 0, w: Math.cos(ang / 2) });
    const segmentBox = (a: Pt, e: Pt, h: number, halfT: number, base?: number) => {
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len < 0.05) return;
      const y = base ?? Math.min(T.heightAt(a[0], a[1]), T.heightAt(e[0], e[1]));
      W.createCollider(R.ColliderDesc.cuboid(len / 2, (h + 0.5) / 2, halfT).setTranslation((a[0] + e[0]) / 2, y + (h - 0.5) / 2, -(a[1] + e[1]) / 2).setRotation(yawQ(Math.atan2(e[1] - a[1], e[0] - a[0]))), body);
    };

    for (const b of c.buildings) {
      if (b.style === 'canopy' || (b.minH ?? 0) > PASSABLE_MIN_HEIGHT) {
        for (const p of supportPoints(b)) post(p, Math.max(2, b.minH ?? 4), 0.3);
        continue;
      }
      const g = T.minAlong(b.outer);
      // A canopy drawn over part of a footprint is an open arcade the cart can drive through:
      // the walls there are left out and the canopy's edges inside the footprint close it off.
      const over = this.canopies.filter(cp => cp.outer.some(p => pointInRing(p, b.outer)));
      if (over.length) {
        const r = ensureCCW(b.outer);
        for (let i = 0; i < r.length; i++) {
          const rp = resample([r[i], r[(i + 1) % r.length]], 1);
          for (let k = 0; k < rp.length - 1; k++) {
            const m: Pt = [(rp[k][0] + rp[k + 1][0]) / 2, (rp[k][1] + rp[k + 1][1]) / 2];
            if (!over.some(cp => pointInRing(m, cp.outer))) segmentBox(rp[k], rp[k + 1], b.h + 1, 0.2, g - 1);
          }
        }
        for (const cp of over) {
          const rp = resample([...cp.outer, cp.outer[0]], 1);
          for (let k = 0; k < rp.length - 1; k++) {
            const m: Pt = [(rp[k][0] + rp[k + 1][0]) / 2, (rp[k][1] + rp[k + 1][1]) / 2];
            if (pointInRing(m, b.outer) && !over.some(o => o !== cp && pointInRing(m, o.outer))) segmentBox(rp[k], rp[k + 1], b.h + 1, 0.2, g - 1);
          }
        }
        continue;
      }
      for (const ring of [ensureCCW(b.outer), ...(b.holes ?? [])]) {
        const { vertices, indices } = wallMesh(ring, g - 1, g + b.h);
        W.createCollider(R.ColliderDesc.trimesh(vertices, indices).setFriction(0.6), body);
      }
      // Entrance drums, canopy posts and columns the model adds beyond the footprint.
      const extra = this.modelSolids(b);
      if (extra) {
        for (const [x, y, r] of extra.posts) post([x, y], 4, Math.max(r, 0.2));
        for (const ring of extra.rings) {
          const { vertices, indices } = wallMesh(ensureCCW(ring), g - 1, g + b.h);
          W.createCollider(R.ColliderDesc.trimesh(vertices, indices).setFriction(0.6), body);
        }
      }
    }
    for (const bar of c.barriers) {
      const h = bar.h ?? (bar.kind === 'fence' ? 1.8 : bar.kind === 'hedge' ? 1.2 : 1.0);
      const rp = resample(bar.pts, 4);
      for (let i = 0; i < rp.length - 1; i++) segmentBox(rp[i], rp[i + 1], h, bar.kind === 'hedge' ? 0.5 : 0.15);
    }
    // Curbs: a strip mesh per run that the wheels climb (15 cm) and the chassis clears.
    for (const line of c.curbs) {
      const m = stripMesh(line, 0.2, CURB_HEIGHT, T);
      if (m) W.createCollider(R.ColliderDesc.trimesh(m.vertices, m.indices).setFriction(0.9), body);
    }
    for (const b of c.bumps) {
      const { left, right, base } = bumpSolid(b, T);
      const pts: number[] = [];
      for (const p of [...left, ...right]) pts.push(p[0], p[1], p[2], p[0], base - 0.1, p[2]);
      const desc = R.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) W.createCollider(desc.setFriction(0.9), body);
    }
    // Stairs: each tread's collider rises 1 m above the visible step, strictly inside the
    // flight's footprint, so the cart is stopped at the first step (the raycast wheels
    // would otherwise climb 16 cm risers). Nothing is added where no stair is drawn.
    for (const s of c.steps) {
      for (const blk of stairBlocks(s, T)) {
        const hy = blk.size[1] / 2 + 0.5;
        W.createCollider(R.ColliderDesc.cuboid(blk.size[0] / 2, hy, blk.size[2] / 2)
          .setTranslation(blk.center[0], blk.center[1] + 0.5, blk.center[2]).setRotation(yawQ(blk.yaw)).setFriction(0.2), body);
      }
    }
    for (const a of c.areas) {
      // Pond and pool edges: a low invisible wall stops the cart at the water line.
      if (a.kind === 'water' || a.kind === 'pool') {
        const ring = [...a.outer, a.outer[0]];
        const rp = resample(ring, 4);
        for (let i = 0; i < rp.length - 1; i++) segmentBox(rp[i], rp[i + 1], 0.8, 0.15);
      }
      if (a.kind === 'island') {
        const ring = [...a.outer, a.outer[0]];
        const m = stripMesh(ring, 0.3, CURB_HEIGHT, T);
        if (m) W.createCollider(R.ColliderDesc.trimesh(m.vertices, m.indices), body);
      }
    }
    for (const p of c.lamps) post(p, 7, 0.12);
    for (const p of c.bollards) post(p, 1.0, 0.12);
    for (const p of c.bikeRacks) post(p, 0.9, 0.3);
    for (const m of c.medians) {
      const sm = stripMesh(m.pts, m.w, 0.25, T);
      if (sm) W.createCollider(R.ColliderDesc.trimesh(sm.vertices, sm.indices).setFriction(0.9), body);
    }
    for (const p of c.flagpoles) post(p, 6, 0.1);
    for (const bx of this.extraBoxes(c))
      W.createCollider(R.ColliderDesc.cuboid(bx.hx, bx.hy, bx.hz).setTranslation(bx.x, bx.y, bx.z).setRotation(yawQ(bx.yaw)).setFriction(0.5), body);
    for (const t of c.trees) post([t[0], t[1]], Math.min(4, t[2] * 0.4), Math.min(0.45, 0.1 + t[2] * 0.015));
    return body;
  }

  step() {
    const t0 = performance.now();
    this.world.step();
    this.stats.stepMs = performance.now() - t0;
  }
}

/**
 * Rapier heightfield for the terrain grid. Rapier's rows run along +z and
 * columns along +x, centered on the collider, heights column-major. Our grid
 * rows run south to north, which is -z, so rows are flipped.
 */
export function heightfieldDesc(R: Rapier, T: Terrain) {
  const { nx, ny, step, x0, y0 } = T.meta;
  const heights = new Float32Array(nx * ny);
  for (let c = 0; c < nx; c++) for (let r = 0; r < ny; r++) heights[c * ny + r] = T.heights[(ny - 1 - r) * nx + c];
  const sx = (nx - 1) * step, sz = (ny - 1) * step;
  return R.ColliderDesc.heightfield(ny - 1, nx - 1, heights, { x: sx, y: 1, z: sz })
    .setTranslation(x0 + sx / 2, 0, -(y0 + sz / 2));
}

/** Triangulated wall shell (no caps) for a footprint ring. */
export function wallMesh(ring: [number, number][], y0: number, y1: number) {
  const n = ring.length;
  const vertices = new Float32Array(n * 2 * 3);
  ring.forEach((p, i) => {
    vertices.set([p[0], y0, -p[1]], i * 6);
    vertices.set([p[0], y1, -p[1]], i * 6 + 3);
  });
  const indices = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    indices.set([a, b, b + 1, a, b + 1, a + 1], i * 6);
  }
  return { vertices, indices };
}

/** Closed box-section strip along a polyline, following the terrain (curbs, islands). */
export function stripMesh(pts: Pt[], width: number, height: number, T: { heightAt(x: number, y: number): number }) {
  if (pts.length < 2) return null;
  const rp = resample(pts, 2);
  const { left, right } = ribbonEdges(rp, width);
  const v: number[] = [], idx: number[] = [];
  for (let i = 0; i < rp.length; i++) {
    for (const p of [left[i], right[i]]) {
      const g = T.heightAt(p[0], p[1]);
      v.push(p[0], g - 0.1, -p[1], p[0], g + height, -p[1]);
    }
  }
  // Per cross-section: 0 left-bottom, 1 left-top, 2 right-bottom, 3 right-top.
  for (let i = 0; i < rp.length - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    for (const [p, q] of [[1, 3], [0, 1], [3, 2]]) idx.push(a + p, b + p, b + q, a + p, b + q, a + q);
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
}

/** Corner support points for raised structures (skybridges, canopies on posts): footprint corners. */
export function supportPoints(b: { outer: Pt[]; minH?: number; style: string }): Pt[] {
  if (!b.minH || b.style === 'canopy') return [];
  const r = b.outer;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  // The four ring vertices nearest the bounding-box corners, pulled 0.4 m inside.
  const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]).map(k => {
    let best = r[0], bd = Infinity;
    for (const p of r) { const d = Math.hypot(p[0] - k[0], p[1] - k[1]); if (d < bd) { bd = d; best = p; } }
    const l = Math.hypot(c[0] - best[0], c[1] - best[1]) || 1;
    return [best[0] + (c[0] - best[0]) / l * 0.4, best[1] + (c[1] - best[1]) / l * 0.4] as Pt;
  });
}
