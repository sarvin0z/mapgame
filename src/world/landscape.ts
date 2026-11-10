// Foundation planting along building walls: the mulched shrub beds with a brick edge
// that line UT Dallas buildings (and most US campuses), where the walls meet lawn.
// Beds are laid only where the strip in front of a wall is open ground: not on roads,
// walks, plazas, lots or water, and kept clear of doors. Shrubs are instanced per
// 80 m cell and shown only near the camera (BuiltChunk.trees); the mulch and edging
// are cheap draped strips shown with the chunk's detail level.
import * as THREE from 'three';
import type { ChunkContent } from './chunks.ts';
import type { Pt } from './campusData.ts';
import { MeshBuilder, addDrapedRibbon, ensureCCW } from './geometry.ts';
import { addMesh, hash, instanced, LAYER, LIFT, type CampusMaterials, type WorldContext } from './campusBuilder.ts';

const lin = (c: number[]) => c.map(v => Math.pow(v, 2.2));
const PLANTED_KINDS = new Set(['university', 'dormitory', 'apartments', 'public', 'school', 'office', 'commercial', 'retail']);
const SKIP_STYLES = new Set(['canopy', 'skybridge', 'shelter', 'garage', 'garageFins', 'shed', 'construction', 'greenhouse']);
const BED_OUT = 1.7; // bed depth from the wall (m)

/**
 * Shrub palette: dark glossy greens (holly, wax myrtle), yellow-green (abelia) and a
 * few burgundy loropetalums, as in Dallas landscaping.
 */
function shrubColor(v: number, out: THREE.Color) {
  if (v < 0.55) return out.setHSL(0.27 + v * 0.04, 0.42, 0.2 + v * 0.06);
  if (v < 0.82) return out.setHSL(0.2, 0.5, 0.3);
  return out.setHSL(0.97, 0.35, 0.22);
}

export function buildLandscape(c: ChunkContent, ctx: WorldContext, mats: CampusMaterials, detail: THREE.Group, cells: THREE.Group, shrubGeo: THREE.BufferGeometry) {
  const T = ctx.terrain;
  const mulch = new MeshBuilder(), edging = new MeshBuilder();
  const shrubs: [number, number, number, number][] = []; // x, y, radius, height
  const doors: Pt[] = c.entrances.map(e => [e[0], e[1]]);
  for (const b of c.buildings) {
    if (!b.name && b.kind !== 'apartments') continue;
    if (!PLANTED_KINDS.has(b.kind) || SKIP_STYLES.has(b.style) || b.minH) continue;
    const ring = ensureCCW(b.outer);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], e = ring[(i + 1) % ring.length], L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 3) continue;
      const u: Pt = [(e[0] - a[0]) / L, (e[1] - a[1]) / L], n: Pt = [u[1], -u[0]]; // outward of a CCW ring
      const at = (t: number, o: number): Pt => [a[0] + u[0] * t + n[0] * o, a[1] + u[1] * t + n[1] * o];
      const open = (t: number) => {
        for (const o of [0.5, 1.1, BED_OUT + 0.3]) {
          const p = at(t, o);
          if (ctx.onRoad(p, 0.4) || ctx.onPath(p, 0.25) || ctx.inParking(p) || ctx.inPlaza(p) || ctx.inWater(p) || ctx.inBuilding(p)) return false;
        }
        const p = at(t, 0.8);
        return !doors.some(d => Math.hypot(d[0] - p[0], d[1] - p[1]) < 3.2);
      };
      // Runs of open stretches along the wall (sampled every metre, ends pulled in 0.6 m).
      let run: number[] = [];
      const flush = () => {
        if (run.length >= 3) {
          const t0 = run[0] + 0.3, t1 = run[run.length - 1] - 0.3;
          addDrapedRibbon(mulch, [at(t0, BED_OUT / 2 + 0.05), at(t1, BED_OUT / 2 + 0.05)], BED_OUT, T, LIFT.plaza, [0.74, 0.5, 0.36], 2.5);
          addDrapedRibbon(edging, [at(t0, BED_OUT + 0.06), at(t1, BED_OUT + 0.06)], 0.14, T, LIFT.plaza + 0.004, [0.95, 0.5, 0.38], 1);
          for (let t = t0 + 0.7; t < t1 - 0.4; t += 1.25) {
            const v = hash(`sh${b.id}${i}${t.toFixed(1)}`);
            if (v < 0.12) continue; // the odd gap, as beds have
            const p = at(t + (v - 0.5) * 0.3, 0.75 + v * 0.25);
            shrubs.push([p[0], p[1], 0.62 + v * 0.3, 0.85 + v * 0.5]);
          }
        }
        run = [];
      };
      for (let t = 0.6; t < L - 0.6; t += 1) { if (open(t)) run.push(t); else flush(); }
      flush();
    }
  }
  addMesh(detail, mulch, mats.layers.dirt, { order: LAYER.plaza });
  addMesh(detail, edging, mats.layers.dirt, { order: LAYER.plaza + 1 });
  if (!shrubs.length) return;
  // Per 80 m cell, near the camera only (lod 'full'; there is no far stand-in: from
  // farther away the bed itself reads).
  const byCell = new Map<string, typeof shrubs>();
  for (const s of shrubs) { const k = Math.floor(s[0] / 80) + ',' + Math.floor(s[1] / 80); if (!byCell.has(k)) byCell.set(k, []); byCell.get(k)!.push(s); }
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const list of byCell.values()) {
    const mesh = instanced(shrubGeo, mats.leaves, list.length, (i, m) => {
      const [x, y, r, h] = list[i];
      m.compose(new THREE.Vector3(x, T.heightAt(x, y) - 0.08, -y), q.setFromAxisAngle(up, hash(`r${x},${y}`) * 6.28), new THREE.Vector3(r, h, r));
    }, false);
    list.forEach((s, i) => mesh.setColorAt(i, shrubColor(hash(`c${Math.round(s[0])},${Math.round(s[1] / 6)}`), col)));
    mesh.userData.cell = [list.reduce((a, s) => a + s[0], 0) / list.length, list.reduce((a, s) => a + s[1], 0) / list.length];
    mesh.userData.lod = 'full';
    mesh.userData.fullScale = 0.6;
    mesh.visible = false;
    cells.add(mesh);
  }
}
