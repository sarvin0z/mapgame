import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Terrain } from '../src/world/terrain.ts';
import { heightfieldDesc, stripMesh } from '../src/physics/physicsWorld.ts';
import { smoothPolyline } from '../src/world/smooth.ts';
import { computeCurbs, simplify } from '../src/world/curbs.ts';
import { bumpProfile, bumpSolid, stairBlocks, insetRing, maxInset } from '../src/world/features.ts';
import { resample, addDrapedPolygon, MeshBuilder } from '../src/world/geometry.ts';
import type { Pt } from '../src/world/campusData.ts';
import { dedupeBumps, openMedians } from '../src/world/campusData.ts';

/** 5x4 grid, 2 m spacing, height = 0.1 * east + 0.3 * north (a tilted plane). */
function plane() {
  const nx = 5, ny = 4, step = 2, x0 = -4, y0 = -2;
  const cm = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cm[j * nx + i] = Math.round((0.1 * (x0 + i * step) + 0.3 * (y0 + j * step)) * 100);
  return new Terrain({ x0, y0, nx, ny, step, baseElevationM: 200, minM: -1, maxM: 2, source: 'test' }, cm);
}

describe('terrain', () => {
  it('interpolates heights bilinearly and clamps outside the grid', () => {
    const t = plane();
    expect(t.heightAt(0, 0)).toBeCloseTo(0, 5);
    expect(t.heightAt(1, 1)).toBeCloseTo(0.4, 5);
    expect(t.heightAt(100, 0)).toBeCloseTo(t.heightAt(4, 0), 5);
  });

  it('builds an upward-facing mesh whose vertices sit on the terrain', () => {
    const t = plane();
    const g = t.buildMesh(-4, -2, 4, 4, 1);
    const pos = g.attributes.position, nrm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(t.heightAt(pos.getX(i), -pos.getZ(i)), 4);
      expect(nrm.getY(i)).toBeGreaterThan(0.9);
    }
    // Normal tilts toward lower ground: -x (east slope 0.1) and +z (north slope 0.3 means z = -north rises).
    expect(nrm.getX(6)).toBeLessThan(0);
    expect(nrm.getZ(6)).toBeGreaterThan(0);
  });

  it('places the minimum of a footprint at its lowest corner', () => {
    expect(plane().minAlong([[-2, -2], [2, -2], [2, 2], [-2, 2]])).toBeCloseTo(-0.8, 5);
  });
});

describe('heightfield collider', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('matches Terrain.heightAt (row/column orientation)', () => {
    const t = plane();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(heightfieldDesc(RAPIER, t));
    world.step();
    // (Rays exactly through a grid vertex can slip between triangles, so sample inside cells.)
    for (const [x, y] of [[-3, -1], [2.5, 3.5], [0.3, 0.2], [3.9, -1.9]] as Pt[]) {
      const ray = new RAPIER.Ray({ x, y: 50, z: -y }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 100, true);
      expect(hit).not.toBeNull();
      expect(50 - hit!.timeOfImpact).toBeCloseTo(t.heightAt(x, y), 2);
    }
  });

  it('builds a closed curb strip that a downward ray hits at curb height', () => {
    const t = Terrain.flat();
    const m = stripMesh([[0, 0], [10, 0]], 0.2, 0.15, t)!;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.trimesh(m.vertices, m.indices));
    world.step();
    const hit = world.castRay(new RAPIER.Ray({ x: 5, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), 10, true);
    expect(5 - hit!.timeOfImpact).toBeCloseTo(0.15, 3);
  });
});

describe('road smoothing', () => {
  it('rounds a free corner but keeps fixed vertices and ends in place', () => {
    const pts: Pt[] = [[0, 0], [50, 0], [50, 50]];
    const out = smoothPolyline(pts, [true, false, true], 5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([50, 50]);
    expect(out.length).toBeGreaterThan(5);
    // No point is farther than the cut length from the original corner path.
    const maxCornerCut = Math.min(...out.map(p => Math.hypot(p[0] - 50, p[1])));
    expect(maxCornerCut).toBeGreaterThan(0.5);
    expect(maxCornerCut).toBeLessThan(5);
  });

  it('never moves a junction', () => {
    const pts: Pt[] = [[0, 0], [10, 5], [20, 0]];
    expect(smoothPolyline(pts, [true, true, true], 5)).toEqual(pts);
  });
});

describe('curbs', () => {
  const road = (id: number, pts: Pt[], cls = 'residential', w = 8) => ({ id, cls, w, pts });

  it('runs along both edges of a curbed street, offset outside the pavement', () => {
    const curbs = computeCurbs([road(1, [[0, 0], [100, 0]])], [], [], []);
    expect(curbs.length).toBe(2);
    for (const c of curbs) for (const p of c) expect(Math.abs(Math.abs(p[1]) - 4.15)).toBeLessThan(0.01);
  });

  it('opens at a side street and at a crosswalk', () => {
    const curbs = computeCurbs(
      [road(1, [[0, 0], [100, 0]]), road(2, [[50, 0], [50, 60]])],
      [{ pts: [[20, -5], [20, 5]] }], [], []);
    // The north curb is cut at x = 20 (crosswalk) and x = 50 (side street): 3 runs; the south curb only at x = 20: 2 runs.
    const onMain = (c: Pt[]) => c.every(p => Math.abs(Math.abs(p[1]) - 4.15) < 0.01);
    const north = curbs.filter(c => onMain(c) && c[0][1] > 0), south = curbs.filter(c => onMain(c) && c[0][1] < 0);
    expect(north.length).toBe(3);
    expect(south.length).toBe(2);
    for (const c of north) for (const p of c) expect(Math.abs(p[0] - 50)).toBeGreaterThan(4);
  });

  it('skips parking aisles and driveways', () => {
    expect(computeCurbs([{ id: 1, cls: 'service', svc: 'parking_aisle', w: 7, pts: [[0, 0], [50, 0]] }], [], [], []).length).toBe(0);
  });

  it('simplifies collinear points', () => {
    expect(simplify([[0, 0], [1, 0.01], [2, 0], [3, 0]], 0.05)).toEqual([[0, 0], [3, 0]]);
  });
});

describe('traffic calming and stairs', () => {
  it('uses short, steep campus bump dimensions', () => {
    const bump = bumpProfile('bump'), hump = bumpProfile('hump'), table = bumpProfile('table');
    expect(bump[bump.length - 1][0]).toBeCloseTo(0.45);
    expect(Math.max(...bump.map(p => p[1]))).toBeCloseTo(0.085, 3);
    expect(hump[hump.length - 1][0]).toBeCloseTo(3.7);
    // Node-mapped tables are raised crosswalks; mapped lengths give full road tables.
    expect(table[table.length - 1][0]).toBeCloseTo(4);
    const long = bumpProfile('table', 6.7);
    expect(long[long.length - 1][0]).toBeCloseTo(6.7);
  });

  it('opens medians where a road crosses them', () => {
    const med = { pts: Array.from({ length: 41 }, (_, i) => [i, 0] as Pt), w: 2 };
    const cross = { id: 1, cls: 'service', w: 6, pts: [[20, -10], [20, 10]] as Pt[] };
    const out = openMedians([med], [cross]);
    expect(out.length).toBe(2);
    for (const m of out) expect(m.pts.every(p => Math.abs(p[0] - 20) >= 7)).toBe(true);
  });

  it('keeps one device per spot', () => {
    const out = dedupeBumps([
      { p: [0, 0], kind: 'mini_bumps', dir: [1, 0], w: 6 },
      { p: [0, 1.5], kind: 'bump', dir: [1, 0], w: 6 },
      { p: [30, 0], kind: 'bump', dir: [1, 0], w: 6 },
    ]);
    expect(out.map(b => b.kind).sort()).toEqual(['bump', 'bump']);
  });

  it('spans the road across its direction', () => {
    const s = bumpSolid({ p: [0, 0], kind: 'bump', dir: [1, 0], w: 8 }, Terrain.flat());
    const zs = [...s.left, ...s.right].map(v => -v[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(7.4, 3);
  });

  it('builds the mapped number of steps rising to the high end', () => {
    const t = plane();
    const blocks = stairBlocks({ id: 1, pts: [[0, -2], [0, 4]], w: 3, n: 10 }, t);
    expect(blocks.length).toBe(10);
    const tops = blocks.map(b => b.center[1] + b.size[1] / 2);
    expect(tops[9]).toBeGreaterThan(tops[0]);
    expect(tops[9]).toBeGreaterThanOrEqual(t.heightAt(0, 4) - 1e-6);
    expect(tops[9]).toBeLessThan(t.heightAt(0, 4) + 0.25); // cross-slope of the plane lifts the high side
    for (let k = 1; k < 10; k++) expect(tops[k]).toBeGreaterThanOrEqual(tops[k - 1]);
  });
});

describe('hip roofs', () => {
  it('insets a rectangle to its ridge', () => {
    const rect: Pt[] = [[0, 0], [30, 0], [30, 12], [0, 12]];
    const r = maxInset(rect, 6)!;
    expect(r.d).toBeGreaterThan(5.5);
    expect(r.d).toBeLessThan(6);
    const inner = insetRing(rect, 5)!;
    expect(Math.min(...inner.map(p => p[1]))).toBeCloseTo(5);
  });

  it('rejects an inset that collapses the ring', () => {
    expect(insetRing([[0, 0], [10, 0], [10, 4], [0, 4]], 3)).toBeNull();
  });
});

describe('draping', () => {
  it('cuts large polygons into terrain-following pieces', () => {
    const mb = new MeshBuilder();
    addDrapedPolygon(mb, [[-4, -2], [4, -2], [4, 4], [-4, 4]], [], plane(), 0.03, [1, 1, 1], 1);
    expect(mb.vertexCount).toBeGreaterThan(30);
    for (let i = 0; i < mb.pos.length; i += 3) expect(mb.pos[i + 1]).toBeCloseTo(plane().heightAt(mb.pos[i], -mb.pos[i + 2]) + 0.03, 3);
  });

  it('resamples long segments', () => {
    expect(resample([[0, 0], [10, 0]], 3).length).toBe(5);
  });
});
