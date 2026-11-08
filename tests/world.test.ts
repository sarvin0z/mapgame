import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partition, splitByChunk, chunkOf, CHUNK_SIZE } from '../src/world/chunks.ts';
import { MeshBuilder, addWalls, addFlatPolygon, addRibbon, signedArea } from '../src/world/geometry.ts';
import { wallMesh } from '../src/physics/physicsWorld.ts';
import type { CampusData, Pt } from '../src/world/campusData.ts';

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('geometry', () => {
  it('computes orientation', () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea([...square].reverse())).toBe(-100);
  });

  it('builds outward-facing walls regardless of input winding', () => {
    for (const ring of [square, [...square].reverse()]) {
      const mb = new MeshBuilder();
      addWalls(mb, ring, 0, 5, [1, 1, 1], false);
      expect(mb.vertexCount).toBe(4 * 6);
      for (let t = 0; t < mb.vertexCount; t += 3) {
        const n = mb.nrm.slice(t * 3, t * 3 + 3);
        const cx = (mb.pos[t * 3] + mb.pos[t * 3 + 3] + mb.pos[t * 3 + 6]) / 3;
        const cz = (mb.pos[t * 3 + 2] + mb.pos[t * 3 + 5] + mb.pos[t * 3 + 8]) / 3;
        // Center of the square in world coords is (5, -5): normal must point away from it.
        expect(n[0] * (cx - 5) + n[2] * (cz + 5)).toBeGreaterThan(0);
        // Triangle winding must agree with the stored normal.
        const p = mb.pos.slice(t * 3, t * 3 + 9);
        const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
        const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        expect(f[0] * n[0] + f[1] * n[1] + f[2] * n[2]).toBeGreaterThan(0);
      }
    }
  });

  it('triangulates roofs facing up with the correct area', () => {
    const mb = new MeshBuilder();
    addFlatPolygon(mb, square, [[[2, 2], [4, 2], [4, 4], [2, 4]]], 3, [1, 1, 1]);
    let area = 0;
    for (let t = 0; t < mb.vertexCount; t += 3) {
      const p = mb.pos.slice(t * 3, t * 3 + 9);
      const fy = (p[5] - p[2]) * (p[6] - p[0]) - (p[3] - p[0]) * (p[8] - p[2]);
      expect(fy).toBeGreaterThan(0);
      area += fy / 2;
    }
    expect(area).toBeCloseTo(96, 5);
  });

  it('builds ribbons of the requested width', () => {
    const mb = new MeshBuilder();
    addRibbon(mb, [[0, 0], [20, 0]], 6, 0, [1, 1, 1]);
    const zs = mb.pos.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(6);
  });

  it('produces closed wall colliders', () => {
    const { vertices, indices } = wallMesh(square, 0, 8);
    expect(vertices.length).toBe(4 * 2 * 3);
    expect(indices.length).toBe(4 * 6);
    expect(Math.max(...indices)).toBeLessThan(8);
  });
});

describe('chunking', () => {
  it('splits polylines at chunk borders without losing vertices', () => {
    const line: Pt[] = [[10, 10], [150, 10], [250, 10], [450, 10], [460, 10]];
    const pieces = splitByChunk(line);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0][0]).toEqual(line[0]);
    expect(pieces.at(-1)!.at(-1)).toEqual(line.at(-1));
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toEqual(pieces[i - 1].at(-1));
  });

  it('assigns every campus feature to exactly one chunk', () => {
    const data: CampusData = JSON.parse(readFileSync('public/data/campus.json', 'utf8'));
    const chunks = partition(data);
    let b = 0, t = 0;
    for (const c of chunks.values()) {
      b += c.buildings.length;
      t += c.trees.length;
      for (const bl of c.buildings) {
        const [cx, cy] = chunkOf(bl.outer[0]);
        // A building's first vertex lies within one chunk of its owning chunk.
        expect(Math.abs(cx - c.cx)).toBeLessThanOrEqual(Math.ceil(400 / CHUNK_SIZE));
        expect(Math.abs(cy - c.cy)).toBeLessThanOrEqual(Math.ceil(400 / CHUNK_SIZE));
      }
    }
    expect(b).toBe(data.buildings.length);
    expect(t).toBe(data.trees.length);
  });
});
