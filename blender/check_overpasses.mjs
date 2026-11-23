import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { PhysicsWorld } from '../src/physics/physicsWorld.ts';
import { partition } from '../src/world/chunks.ts';
import { pointInRing } from '../src/world/spatial.ts';
import { clippedRows, overheadLevels, plinthLayout, MIN_DRIVE_CLEARANCE } from '../src/world/overheadStructures.ts';

export function checkOverpasses(R, campus, terrain, fullWorld) {
  const results = [];
  const probe = new R.Cuboid(.595, (MIN_DRIVE_CLEARANCE - .04) / 2, 1.29);
  const up = new Vector3(0, 1, 0);
  const buildings = campus.buildings.filter(b => b.minH || b.style === 'canopy');
  for (const b of buildings) {
    const name = b.name ?? (b.minH ? 'Skybridge' : 'Canopy');
    const plinth = b.name === 'The Plinth';
    const underside = plinth ? plinthLayout(b, terrain).top - .327 : overheadLevels(b, terrain).bottom;
    const isolated = { ...campus, roads: [], areas: [], buildings: [b], barriers: [], bollards: [], lamps: [],
      trees: [], steps: [], curbs: [], bumps: [], bikeRacks: [], fences: [], medians: [], benches: [] };
    const physics = new PhysicsWorld(R, partition(isolated), terrain);
    const center = b.outer.reduce(([x, y], p) => [x + p[0] / b.outer.length, y + p[1] / b.outer.length], [0, 0]);
    physics.stream(center[0], -center[1]);
    physics.world.step();
    const xs = b.outer.map(p => p[0]), ys = b.outer.map(p => p[1]);
    const min = [Math.min(...xs), Math.min(...ys)], max = [Math.max(...xs), Math.max(...ys)];
    const candidates = [];
    for (const road of campus.roads) {
      if (road.cls === 'steps' || road.cls === 'construction') continue;
      // A path ending at the covered entrance is an approach, not a crossing.
      const landsAtEntrance = p => pointInRing(p, b.outer) ||
        b.outer.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < .15);
      if (landsAtEntrance(road.pts[0]) || landsAtEntrance(road.pts.at(-1))) continue;
      for (const [i, a] of road.pts.slice(0, -1).entries()) {
        const end = road.pts[i + 1];
        if ([0, 1].some(k => Math.min(a[k], end[k]) > max[k] || Math.max(a[k], end[k]) < min[k])) continue;
        const len = Math.hypot(end[0] - a[0], end[1] - a[1]);
        if (len > .2) {
          const nx = (end[1] - a[1]) / len, ny = (a[0] - end[0]) / len;
          for (const offset of road.w >= 2.2 ? [0, -.42, .42] : [0]) {
            candidates.push([[a[0] + nx * offset, a[1] + ny * offset],
              [end[0] + nx * offset, end[1] + ny * offset], true]);
          }
        }
      }
    }
    for (const direction of [0, Math.PI / 2, Math.PI / 4, Math.PI * .75]) {
      for (const [a, end] of clippedRows(b.outer, b.holes ?? [], direction, .48)) {
        candidates.push([a, end, false]);
      }
    }
    fullWorld.stream(center[0], -center[1]);
    fullWorld.world.step();
    let localRoute, mappedRoute, sceneRoute, anyMapped = false;
    for (const [a, end, mapped] of candidates) {
      if ((mapped && mappedRoute) || (!mapped && sceneRoute)) continue;
      const dx = end[0] - a[0], dy = end[1] - a[1], len = Math.hypot(dx, dy);
      if (len < .65) continue;
      const intervals = Math.ceil(len / .27);
      const rotation = new Quaternion().setFromAxisAngle(up, Math.atan2(dx, -dy));
      const samples = [];
      let clearance = Infinity;
      for (let i = 0; i <= intervals; i++) {
        const x = a[0] + dx * i / intervals, y = a[1] + dy * i / intervals;
        if (!pointInRing([x, y], b.outer) || b.holes?.some(h => pointInRing([x, y], h))) continue;
        const ground = terrain.heightAt(x, y);
        clearance = Math.min(clearance, underside - ground);
        samples.push({ x, y: ground + MIN_DRIVE_CLEARANCE / 2 + .02, z: -y });
      }
      if (samples.length < 3) continue;
      if (mapped) anyMapped = true;
      if (clearance < MIN_DRIVE_CLEARANCE ||
          samples.some(p => physics.world.intersectionWithShape(p, rotation, probe))) continue;
      localRoute ??= { clearance, samples: samples.length };
      if (!samples.some(p => fullWorld.world.intersectionWithShape(p, rotation, probe))) {
        sceneRoute = { clearance, samples: samples.length };
        if (mapped) mappedRoute = sceneRoute;
      }
      if (localRoute && mappedRoute) break;
    }
    physics.world.free();
    const record = mappedRoute ?? sceneRoute ?? localRoute;
    const awning = Math.min(max[0] - min[0], max[1] - min[1]) < 1.5;
    results.push({ id: b.id, name, minH: b.minH, clearance: record?.clearance,
      samples: record?.samples ?? 0, type: mappedRoute ? 'Mapped path in full scene'
        : sceneRoute ? 'Full-scene corridor; no mapped through route verified'
        : localRoute && anyMapped ? 'Structure clear; mapped route obstructed nearby'
        : localRoute ? 'Structure clear; no mapped crossing'
        : awning ? 'Door awning too narrow for cart' : 'No 2.6 m cart corridor found' });
  }
  const passed = results.filter(r => r.samples > 0);
  const mapped = results.filter(r => r.type === 'Mapped path in full scene');
  console.log(`Overhead clearance: ${passed.length}/${results.length} cart probes clear; ${mapped.length} mapped routes verified in the full scene`);
  if (process.argv.includes('--report')) {
    const lines = ['# Overpass and canopy clearance', '',
      'Rapier sampled a 1.19 m × 2.6 m × 2.58 m cart envelope at intervals of at most 0.27 m under each mapped structure.',
      'The visual soffits use the same height function as the collision geometry. The Plinth is tested with columns only.',
      'An isolated structural pass establishes clearance and column spacing. A full-scene route also checks adjacent walls and site objects.',
      '', '| OSM footprint | Structure | Minimum sampled clearance | Result |', '| --- | --- | ---: | --- |',
      ...results.map(r => `| ${r.id} | ${r.name} | ${r.clearance?.toFixed(2) ?? '—'} m | ${r.type} |`),
      '', 'The map snapshot has no separate NSERL–Bioengineering or JSOM-labeled bridge footprint. All mapped elevated footprints are listed by ID. No new footprint was added.'];
    fs.writeFileSync('reconstruction/overpass-checks.md', lines.join('\n') + '\n', 'utf8');
  }
  assert(results.filter(r => r.minH).every(r =>
    r.type === 'Mapped path in full scene' || r.type.startsWith('Full-scene corridor')),
  'At least one mapped skybridge lacks a full-scene cart corridor');
}
