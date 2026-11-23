// Run from the repo with Node 24:
// node --experimental-transform-types blender/check_building_colliders.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { PhysicsWorld, initRapier } from '../src/physics/physicsWorld.ts';
import { slugOf } from '../src/world/buildingModels.ts';
import { loadCampus } from '../src/world/campusData.ts';
import { baseLevel } from '../src/world/buildings.ts';
import { partition } from '../src/world/chunks.ts';
import { Terrain } from '../src/world/terrain.ts';
import { EDITS_ON, TERRAIN_EDITS } from '../src/world/sceneEdits.ts';
import { checkOverpasses } from './check_overpasses.mjs';

const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const savedFetch = globalThis.fetch;
globalThis.fetch = async url => new Response(fs.readFileSync('public/' + url));
const campus = await loadCampus();
globalThis.fetch = savedFetch;
const bin = fs.readFileSync('public/data/terrain.bin');
const terrain = new Terrain(json('public/data/terrain.json'), new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2));
if (EDITS_ON) terrain.applyEdits(TERRAIN_EDITS);
const solids = json('public/models/buildings/solids.json');
const modelIndex = new Set(json('public/models/buildings/index.json'));
const scope = json('reconstruction/photo-scope.json');
const specs = Object.fromEntries(json('reconstruction/specs.json').buildings.map(s => [s.slug, s.recipe.atlasModel]));
const bySlug = Object.fromEntries(campus.buildings.filter(b => b.name).map(b => [slugOf(b.modelName ?? b.name), b]));
const R = await initRapier();
const accessReview = new Set([
  'sciences_building', 'callier_center_richardson', 'callier_center_richardson_addition',
  'student_services_building', 'student_services_building_addition', 'recreation_center_west', 'comets_landing',
]);
const canopyProbes = {
  sciences_building: [-49, 342.5, 9.65],
  callier_center_richardson: [116.5, 750.3, 2.54],
  callier_center_richardson_addition: [161, 635.4, 6.02],
  student_services_building_addition: [65.15, 32, 4.18],
  recreation_center_west: [-455.3, 485.05, 4.58],
  founders_building: [172.8, 208, 16.6],
  crow_museum_of_asian_art: [309.3, -198.55, 3.5],
  performance_hall_and_music_building: [309.1, -285.5, 3.57],
};

function checkAccess(slug, model, world, base) {
  const recipe = specs[slug];
  model.posts.forEach(([x, y, radius], i) => {
    const grade = terrain.heightAt(x, y);
    const [bottom, top] = model.postLevels[i];
    assert(base + bottom <= grade + .015 && base + top > grade + .5, slug + ': post misses grade');
    const ray = new R.Ray({ x: x + radius + .15, y: grade + .38, z: -y }, { x: -1, y: 0, z: 0 });
    const hit = world.castRay(ray, radius + .18, false);
    assert(hit, slug + ': no collider contact at a post base');
  });
  let ramp = 0;
  for (const item of recipe.access ?? []) {
    if (item.stairs) {
      const [nx, ny] = item.normal;
      const x = item.point[0] + (item.run - .06) * nx;
      const y = item.point[1] + (item.run - .06) * ny;
      const grade = terrain.heightAt(x, y);
      const ray = new R.Ray({ x, y: grade + .28, z: -y }, { x: 0, y: -1, z: 0 });
      assert(world.castRay(ray, .53, false), slug + ': stair misses its grade transition');
      continue;
    }
    const approach = model.paving[ramp++];
    assert(approach?.length === 4, slug + ': missing access ramp collider');
    for (const [x, y, z] of approach.slice(2)) {
      assert(Math.abs(base + z - terrain.heightAt(x, y)) < .10, slug + ': ramp ends above or below grade');
    }
  }
  for (const flight of recipe.flights ?? []) {
    const [x0, y0] = flight.start;
    const grade = terrain.heightAt(x0, y0);
    const x = x0 + (flight.end[0] - x0) * .025;
    const y = y0 + (flight.end[1] - y0) * .025;
    const ray = new R.Ray({ x, y: grade + .28, z: -y }, { x: 0, y: -1, z: 0 });
    const foot = world.castRay(ray, .22, false);
    assert(foot?.collider.shapeType() === R.ShapeType.ConvexPolyhedron, slug + ': missing bottom stair tread contact');
  }
}

let count = 0;
for (const [slug, model] of Object.entries(solids)) {
  if (slug.endsWith('_access')) {
    const site = bySlug[slug.slice(0, -7)];
    assert(site, slug + ': access model has no parent footprint');
    const isolated = Object.fromEntries(Object.keys(campus).map(key => [key, []]));
    isolated.buildings = [site];
    const legacy = new PhysicsWorld(R, partition(isolated), terrain);
    legacy.accessSolids = () => model;
    legacy.stream(site.outer[0][0], -site.outer[0][1]);
    legacy.world.step();
    checkAccess(slug, model, legacy.world, baseLevel(site.outer, terrain).base);
    legacy.world.free();
    console.log(slug + ': retained access contacts verified');
  }
  if (!model.replaceFootprint) continue;
  const b = bySlug[slug];
  assert(b, slug + ' is unreachable by the game model loader');
  const isolated = Object.fromEntries(Object.keys(campus).map(key => [key, []]));
  isolated.buildings = [b];
  const world = new PhysicsWorld(R, partition(isolated), terrain);
  world.modelSolids = () => model;
  world.stream(b.outer[0][0], -b.outer[0][1]);
  world.world.step();

  function hitWall(ring, [lower, upper]) {
    const base = baseLevel(b.outer, terrain).base;
    const height = base + (lower + upper) / 2;
    const segments = ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
    return segments.some(([a, c]) => {
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < .1) return false;
      const x = (a[0] + c[0]) / 2, y = (a[1] + c[1]) / 2;
      if (height < terrain.heightAt(x, y) + .08) return false;
      const nx = dy / len, ny = -dx / len;
      const ray = new R.Ray({ x: x + nx * .2, y: height, z: -y - ny * .2 }, { x: -nx, y: 0, z: ny });
      return Boolean(world.world.castRay(ray, .42, false));
    });
  }

  const ground = model.rings.map((ring, i) => ({ ring, height: model.ringLevels[i] }))
    .concat(model.volumes.filter(({ height }) => height[0] <= 0));
  assert(ground.some(({ ring, height }) => height[1] > 2 && hitWall(ring, height)),
    slug + ' has no detected enclosed ground-level collision');
  const base = baseLevel(b.outer, terrain).base;
  if (accessReview.has(slug)) checkAccess(slug, model, world.world, base);
  for (const { point: [x, y], size: [width, depth], reveal } of specs[slug]?.footings ?? []) {
    const height = terrain.heightAt(x, y);
    const ray = new R.Ray({ x: x + width * .43, y: height + reveal + .2, z: -y - depth * .43 },
      { x: 0, y: -1, z: 0 });
    assert(world.world.castRay(ray, .225, false), slug + ': V-support footing lacks a grade contact');
  }
  if (canopyProbes[slug]) {
    const [x, y, underside] = canopyProbes[slug];
    const ray = new R.Ray({ x, y: base + underside - .18, z: -y }, { x: 0, y: 1, z: 0 });
    assert(world.world.castRay(ray, .31, false), slug + ': no collider at the canopy underside');
  }
  world.world.free();
  count++;
}
console.log(`Ground-wall contacts verified for ${count} atlas buildings`);
console.log('Reviewed access geometry, support bases and elevated canopy contacts verified');

for (const slug of scope.restoredProcedural) {
  assert(!modelIndex.has(slug) && !(slug in solids), slug + ': procedural fallback still has model data');
}
for (const slug of ['university_village_2', 'engineering_and_computer_science_north', 'northside_building_3']) {
  const b = bySlug[slug];
  assert(b, slug + ': missing legacy footprint');
  const isolated = Object.fromEntries(Object.keys(campus).map(key => [key, []]));
  isolated.buildings = [b];
  const legacy = new PhysicsWorld(R, partition(isolated), terrain);
  legacy.stream(b.outer[0][0], -b.outer[0][1]);
  legacy.world.step();
  const contact = b.outer.some(([x0, y0], i) => {
    const [x1, y1] = b.outer[(i + 1) % b.outer.length];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length < 1) return false;
    const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
    const nx = (y1 - y0) / length, nz = (x1 - x0) / length;
    const start = { x: x + nx * .3, y: terrain.heightAt(x, y) + 1, z: -y + nz * .3 };
    return Boolean(legacy.world.castRay(new R.Ray(start, { x: -nx, y: 0, z: -nz }), .62, false));
  });
  legacy.world.free();
  assert(contact, slug + ': the legacy path did not rebuild its wall collider');
}
console.log('Legacy procedural wall contacts verified for University Village, ECS North and Northside');

const routes = {
  'Sciences portal': [[-57, 344], [-53, 342.15], [-48, 339.9], [-44, 338.15], [-40.2, 337.1]],
  'Crow undercroft': [[312.7, -195], [313, -202], [313.6, -221], [314.3, -235], [315, -237.85]],
  'Rec Center West entrance canopy': [[-456.9, 484.5], [-453.25, 484.5]],
  'ECS West east breezeway': [[-78, 32], [-99.64, 32.16], [-106.38, 32.25], [-114.7, 30.4]],
  'Music east undercroft': [[311, -275], [312, -286], [311.5, -306], [311, -321]],
};
const world = new PhysicsWorld(R, partition(campus), terrain);
world.modelSolids = b => b.name ? solids[slugOf(b.modelName ?? b.name)] : undefined;
world.accessSolids = b => b.name ? solids[slugOf(b.modelName ?? b.name) + '_access'] : undefined;
const cart = [
  { size: new R.Cuboid(.55, .25, 1.29), y: .64, z: 0 },
  { size: new R.Cuboid(.6, .04, 1.14), y: 1.88, z: -.15 },
];

function floor(x, y) {
  const h = terrain.heightAt(x, y);
  return Math.max(h, ...[-.023, 0, .023].flatMap(dx => {
    const ray = new R.Ray({ x: x + dx, y: h + 1.77, z: -y }, { x: 0, y: -1, z: 0 });
    const hit = world.world.castRay(ray, 3, false);
    return hit ? [h + 1.77 - hit.timeOfImpact] : [];
  }));
}

for (const [label, route] of Object.entries(routes)) {
  world.stream(route[0][0], -route[0][1]);
  world.world.step();
  const hits = [];
  for (let j = 1; j < route.length; j++) {
    const a = route[j - 1], b = route[j];
    const dx = b[0] - a[0], dy = b[1] - a[1], distance = Math.hypot(dx, dy);
    const u = dx / distance, v = dy / distance;
    const count = Math.ceil(distance / .25);
    for (let i = 0; i <= count; i++) {
      const x = a[0] + dx * i / count, y = a[1] + dy * i / count;
      const front = floor(x + u, y + v), rear = floor(x - u, y - v);
      const ground = Math.max(floor(x, y), (front + rear) / 2);
      const dir = new Vector3(u, (front - rear) / 2, -v).normalize();
      const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir);
      for (const part of cart) {
        const center = new Vector3(0, part.y, part.z).applyQuaternion(rotation).add(new Vector3(x, ground, -y));
        const hit = world.world.intersectionWithShape(center, rotation, part.size);
        if (hit) hits.push([+x.toFixed(2), +y.toFixed(2), hit.shapeType()]);
      }
    }
  }
  console.log(label, hits.length ? JSON.stringify(hits.slice(0, 12)) : 'clear');
  if (hits.length) process.exitCode = 1;
}
checkOverpasses(R, campus, terrain, world);
world.world.free();
