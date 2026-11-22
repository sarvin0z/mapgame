import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { gradePass } from './graphics/grade.ts';
import { boostAll, boostTree, boostReflections } from './graphics/reflections.ts';
import { loadCampus, DRIVABLE, type CampusData } from './world/campusData.ts';
import { partition, ensureChunks } from './world/chunks.ts';
import { CampusMaterials, foliageTime, type WorldContext } from './world/campusBuilder.ts';
import { Terrain } from './world/terrain.ts';
import { loadCartModel } from './vehicle/cartModel.ts';
import { loadCars } from './world/cars.ts';
import { loadBuildingModels, loadBuildingSolids, slugOf } from './world/buildingModels.ts';
import { loadPhotos } from './world/photos.ts';
import { parkedCars } from './world/extras.ts';
import { buildLandmarks, suPromenade } from './world/landmarks.ts';
import { pointInRing } from './world/spatial.ts';
import { lineLookup, polygonLookup, pointLookup } from './world/spatial.ts';
import { WorldStreamer } from './world/worldStreamer.ts';
import { centroid } from './world/geometry.ts';
import type { Pt } from './world/campusData.ts';
import { initRapier, PhysicsWorld } from './physics/physicsWorld.ts';
import { GolfCart } from './vehicle/golfCart.ts';
import { DEFAULT_CART } from './vehicle/config.ts';
import { Input } from './input.ts';
import { CameraRig } from './camera/cameraRig.ts';
import { Environment, type TimeOfDay } from './graphics/environment.ts';
import { nightUniform } from './world/occlusion.ts';
import { PRESETS, ORDER, AdaptiveQuality, type QualityName } from './graphics/quality.ts';
import { Hud } from './ui/hud.ts';
import { Menus } from './ui/menus.ts';
import { RouteChallenge } from './gameplay/routeChallenge.ts';
import { Pedestrians } from './gameplay/pedestrians.ts';
import { Siren, Horn } from './audio/siren.ts';
import { CartAudio } from './audio/cartAudio.ts';
import { cue } from './audio/sfx.ts';
import { unlockAudio, duckVehicle, muteVehicle, volumes, setVolumes } from './audio/mixer.ts';
import { TouchControls, bindSoundSettings } from './ui/touchControls.ts';
import { unproject } from './geo/projection.ts';

const loading = document.getElementById('loading')!;
const setLoading = (t: string) => { document.getElementById('load-msg')!.textContent = t; };

/**
 * Loading percentage. Real milestones set a floor (`at`) and the ceiling of the current stage
 * (`cap`); between milestones the figure creeps toward the ceiling so it never looks stalled,
 * and the shown number eases toward its target every frame, so it counts up smoothly.
 */
const loader = (() => {
  const pct = document.getElementById('load-pct')!.firstChild!, bar = document.getElementById('load-bar')!, meter = loading.querySelector('.load-meter')!;
  let target = 0, cap = 4, shown = 0, last = performance.now(), stop = false;
  const tick = (now: number) => {
    if (stop) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    target = Math.min(cap, target + dt * 2.5);
    shown += (target - shown) * (1 - Math.exp(-dt * 7));
    const v = Math.min(100, Math.floor(shown + 0.02));
    pct.nodeValue = String(v);
    bar.style.transform = `scaleX(${(shown / 100).toFixed(4)})`;
    meter.setAttribute('aria-valuenow', String(v));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Frames can stall (a background tab, a long main-thread step); a timer keeps the count moving.
  const timer = setInterval(() => { if (stop) clearInterval(timer); else if (performance.now() - last > 90) tick(performance.now()); }, 100);
  return {
    /** A milestone: progress is at least `at`, and may creep up to `cap` before the next one. */
    set(at: number, cap2: number, msg?: string) { target = Math.max(target, at); cap = Math.max(cap2, target); if (msg) setLoading(msg); },
    /** Lets the browser paint the new figure before a long synchronous step. */
    paint: () => new Promise<void>(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 80); }),
    /** Runs the count to 100 %; resolves when it shows. */
    async finish() { target = cap = 100; for (let i = 0; i < 40 && shown < 99.5; i++) await new Promise(r => setTimeout(r, 16)); stop = true; pct.nodeValue = '100'; bar.style.transform = 'scaleX(1)'; },
  };
})();

/**
 * Spawn on the drivable road nearest to a named building, facing along the road.
 * The default is University Village Phase 1 Building 11, home of the UEMR
 * apartment (The Retrograde, 2026-08-21).
 */
function findSpawn(data: CampusData, terrain: Terrain, landmark: string) {
  const b = data.buildings.find(b => b.name === landmark || `University Village Building ${b.name}` === landmark);
  const target = b ? centroid(b.outer) : [0, 0];
  let best = { d: Infinity, p: [0, 0], h: 0 };
  for (const r of data.roads) {
    if (!DRIVABLE.has(r.cls) || r.cls === 'secondary' || r.cls === 'construction' || r.svc === 'driveway') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [a, e] = [r.pts[i], r.pts[i + 1]];
      const mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      const d = Math.hypot(mid[0] - target[0], mid[1] - target[1]);
      if (d < best.d && Math.hypot(e[0] - a[0], e[1] - a[1]) > 8) best = { d, p: mid, h: Math.atan2(e[0] - a[0], -(e[1] - a[1])) };
    }
  }
  // Face the way out: toward the end of this way that is nearest a through road
  // (so a deploying cart heads for the street, not deeper into the lot).
  const MAIN = new Set(['secondary', 'tertiary', 'unclassified', 'residential']);
  const mains = data.roads.filter(r => MAIN.has(r.cls));
  const toMain = (p: number[]) => { let d = Infinity; for (const r of mains) for (const q of r.pts) d = Math.min(d, Math.hypot(q[0] - p[0], q[1] - p[1])); return d; };
  const way = data.roads.find(r => r.pts.some((q, i) => i < r.pts.length - 1 && Math.hypot((q[0] + r.pts[i + 1][0]) / 2 - best.p[0], (q[1] + r.pts[i + 1][1]) / 2 - best.p[1]) < 1e-6));
  if (way && toMain(way.pts[0]) < toMain(way.pts[way.pts.length - 1])) best.h += Math.PI;
  // h is the heading as a rotation about +y applied to the cart's +z forward axis.
  return { pos: new THREE.Vector3(best.p[0], terrain.heightAt(best.p[0], best.p[1]), -best.p[1]), heading: best.h };
}

async function main() {
  loader.set(2, 50, 'Loading campus map data…');
  // Each download that lands moves the bar (seven files and modules, about half the load).
  let got = 0;
  const track = <T,>(p: Promise<T>) => p.then(v => { got++; loader.set(4 + got * 6.5, 50); return v; });
  const T_LOAD = { start: performance.now(), fetched: 0 };
  let bakedVersion = -1;
  /** True while the dev comment tool (3D-Agentation-Editor) is in marking mode. */
  let marking = false;
  const params = new URLSearchParams(location.search);
  const [data, terrain, R, cartModel, cars, models] = await Promise.all([track(loadCampus()), track(Terrain.load()), track(initRapier()), track(loadCartModel(DEFAULT_CART)), track(loadCars().catch(() => [])), track((() => { const photos = loadPhotos(); return loadBuildingModels(undefined, photos); })())]);
  const solids = await track(loadBuildingSolids());
  T_LOAD.fetched = performance.now();
  loader.set(52, 66, 'Building campus…');
  await loader.paint();
  const chunks = partition(data);
  const tm = terrain.meta;
  ensureChunks(chunks, tm.x0, tm.y0, tm.x0 + (tm.nx - 1) * tm.step, tm.y0 + (tm.ny - 1) * tm.step);
  const ctx0 = { inBuilding: polygonLookup(data.buildings.filter(b => b.style !== 'canopy').map(b => b.outer)) };
  const ctx: WorldContext = {
    buildings: data.buildings,
    models,
    lotAllowed: (() => {
      const near = pointLookup(data.buildings.filter(b => ['apartments', 'dormitory'].includes(b.kind) || /Police|Safety and Grounds|Service Building|Facilities/.test(b.name ?? '')).map(b => centroid(b.outer)), 80);
      return (p: Pt) => near(p, 80);
    })(),
    inPlaza: polygonLookup(data.areas.filter(a => a.kind === 'plaza').map(a => a.outer)),
    terrain,
    inParking: polygonLookup(data.areas.filter(a => a.kind === 'parking').map(a => a.outer)),
    onRoad: lineLookup(data.roads.filter(r => DRIVABLE.has(r.cls)).map(r => ({ pts: r.pts, hw: r.w / 2 }))),
    onPath: lineLookup(data.roads.filter(r => !DRIVABLE.has(r.cls)).map(r => ({ pts: r.pts, hw: r.w / 2 }))),
    inBuilding: polygonLookup(data.buildings.filter(b => b.style !== 'canopy').map(b => b.outer)),
    inWater: polygonLookup(data.areas.filter(a => a.kind === 'water' || a.kind === 'pool').map(a => a.outer)),
    treeNear: pointLookup(data.treeList.map(t => [t[0], t[1]] as Pt)),
    cars,
    isStub: (() => {
      // Short walk pieces with a free end (no other way meets it) lead nowhere: OSM artefacts.
      const key = (q: Pt) => Math.round(q[0] * 2) + ',' + Math.round(q[1] * 2);
      const deg = new Map<string, number>();
      for (const r of data.roads) for (const q of r.pts) deg.set(key(q), (deg.get(key(q)) ?? 0) + 1);
      const stubs = new Set<number>();
      for (const r of data.roads) {
        if (DRIVABLE.has(r.cls)) continue;
        let len = 0;
        for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
        const freeEnds = [r.pts[0], r.pts[r.pts.length - 1]].filter(q => (deg.get(key(q)) ?? 0) <= 1).length;
        if (len < 9 && freeEnds >= 1 && !ctx0.inBuilding(r.pts[0]) && !ctx0.inBuilding(r.pts[r.pts.length - 1])) stubs.add(r.id);
      }
      return (r: { id: number }) => stubs.has(r.id);
    })(),
    junctionNear: (() => {
      // Ways are split at junctions in OSM, so every way end is a junction (or a dead end).
      const ends: Pt[] = [];
      for (const r of data.roads) if (DRIVABLE.has(r.cls) && r.svc !== 'parking_aisle') ends.push(r.pts[0], r.pts[r.pts.length - 1]);
      return pointLookup(ends, 20);
    })(),
  };
  // Site cleanup the map data needs: lamps mapped in a carriageway, bike racks far from
  // any pavement, and stunted canopy peaks.
  // The Student Union's arcade promenade is open paving the cart can use (no trees standing in it).
  const suBuilding = data.buildings.find(b => b.name === 'Student Union');
  const promenade = suBuilding ? suPromenade(suBuilding) : null;
  for (const c of chunks.values()) {
    if (promenade) c.trees = c.trees.filter(t => !pointInRing([t[0], t[1]], promenade));
    // Lamps mapped on a parking structure's deck would stand inside it at ground level.
    c.lamps = c.lamps.filter(p => !ctx.onRoad(p, -0.4) && !ctx.junctionNear(p, 7) && !ctx.inBuilding(p));
    c.bikeRacks = c.bikeRacks.filter(p => (ctx.onPath(p, 2.5) || ctx.inPlaza(p)) && !ctx.onRoad(p, 0.5));
    c.trees = c.trees.map(t => [t[0], t[1], Math.max(6, t[2]), Math.max(2.4, t[3], t[2] * 0.3), t[4]] as typeof t);
  }

  // Reversed-Z depth (float depth, near plane at 1) removes the z-fighting ("flicker") between
  // nearly coplanar facade layers at a distance. Without EXT_clip_control, fall back to log depth.
  let renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true });
  if (!renderer.capabilities.reversedDepthBuffer) {
    renderer.dispose();
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  }
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false; // accumulate across composer passes; reset per frame
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.15, 6000);
  const mats = new CampusMaterials();
  const env = new Environment(scene, renderer, mats, terrain);
  // Sky reflections on glass, glossy facades, paint and water (see reflections.ts).
  boostReflections(mats.carBody, 3);
  boostReflections(mats.layers.water, 2.5);
  boostAll(mats);
  // Not the cart: its clear polycarbonate windshield, boosted, flashed white across the open cabin as the cart moved.
  for (const m of models.values()) boostTree(m);

  let quality: QualityName = (params.get('quality') as QualityName) ?? 'medium';
  if (!ORDER.includes(quality)) quality = 'medium';
  const adaptive = new AdaptiveQuality(quality);
  if (params.has('quality')) adaptive.enabled = false;

  const streamer = new WorldStreamer(chunks, mats, ctx, { viewDistance: PRESETS[quality].viewDistance, detailDistance: PRESETS[quality].detailDistance, nearDistance: PRESETS[quality].nearDistance, treeFullDistance: PRESETS[quality].treeFullDistance });
  scene.add(streamer.root);

  const physics = new PhysicsWorld(R, chunks, terrain);
  physics.modelSolids = b => (b.name && models.has(slugOf(b.modelName ?? b.name)) ? solids[slugOf(b.modelName ?? b.name)] : undefined);
  // Parked cars are solid: a box per car, lower body plus cabin height.
  physics.extraBoxes = c => [
    ...parkedCars(c, ctx).map(pc => ({
      x: pc.x, y: terrain.heightAt(pc.x, pc.y) + pc.height / 2 + 0.05, z: -pc.y,
      hx: pc.width / 2, hy: pc.height / 2, hz: pc.length / 2, yaw: pc.heading,
    })),
    // Landmark stairs and terraces (geometry discarded; only their solids are kept).
    ...(c.buildings.some(b => b.name === 'Student Union' || b.name === 'Comets LANding')
      ? buildLandmarks(c, ctx, mats, { base: new THREE.Group(), detail: new THREE.Group(), near: new THREE.Group() }, data.buildings, false).map(sb => ({ ...sb, yaw: sb.yaw }))
      : []),
  ];
  // Deployment points: the UEMR apartment (UV Building 11) or Safety and Grounds.
  const starts = { uv11: findSpawn(data, terrain, params.get('spawn') ?? '11'), sg: findSpawn(data, terrain, 'Safety and Grounds') };
  const spawn = { ...starts.uv11 };
  const cart = new GolfCart(R, physics.world, DEFAULT_CART, cartModel, spawn.pos, spawn.heading, (x, z) => terrain.heightAt(x, -z));
  scene.add(cart.model.root);
  physics.stream(spawn.pos.x, spawn.pos.z);

  const input = new Input(renderer.domElement);
  const rig = new CameraRig(camera, input, (x, z) => terrain.heightAt(x, -z));
  // Chase-camera occlusion against the physics colliders (buildings, walls, parked cars), not the cart.
  const camRay = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  rig.obstruct = (a, b) => {
    const d = b.clone().sub(a), len = d.length();
    if (len < 0.01) return null;
    d.divideScalar(len);
    camRay.origin = { x: a.x, y: a.y, z: a.z }; camRay.dir = { x: d.x, y: d.y, z: d.z };
    const hit = physics.world.castRay(camRay, len, true, undefined, undefined, undefined, cart.body);
    return hit ? hit.timeOfImpact : null;
  };
  const hud = new Hud(data);
  const siren = new Siren();
  const horn = new Horn();
  const cartAudio = new CartAudio();
  unlockAudio();

  // Route Challenge (gameplay layer): network-following runs from the UEMR apartment.
  const startPt: Pt = [spawn.pos.x, -spawn.pos.z];
  const onNetwork = (p: Pt) => ctx.onRoad(p, 1.0) || ctx.onPath(p, 1.0) || ctx.inParking(p) || ctx.inPlaza(p);
  // Traffic controls scored in runs: signed stop points (not those inside lots) and mapped bumps.
  const rc = new RouteChallenge(data, startPt, onNetwork, data.stops.filter(s => !ctx.inParking(s.p)), data.bumps);
  const peds = new Pedestrians(data, terrain);
  scene.add(peds.group);
  // Moving actors stay out of the baked sun-shadow map (their contact shadows ground them).
  const noCast = (root: THREE.Object3D) => root.traverse(o => { o.castShadow = false; });
  noCast(cart.model.root);
  noCast(peds.group);
  peds.group.addEventListener('childadded', e => noCast((e as unknown as { child: THREE.Object3D }).child));
  const beacon = makeBeacon();
  scene.add(beacon);
  let menuOpen = true;
  let shownResult = false;
  /** Destination the beacon and map overlay were last set up for (changes at each stop of a gauntlet). */
  let legDest: typeof rc.dest = null;
  /** Collision detection: the cart's horizontal velocity last frame and a cooldown. */
  const lastVel = new THREE.Vector3(), lastPos = new THREE.Vector3();
  let bumpCooldown = 0;
  const menus = new Menus(rc, {
    free: () => {
      rc.cancel(); hud.overlay = {}; beacon.visible = false; peds.stop();
      const sp = starts[menus.startKey as keyof typeof starts] ?? starts.uv11;
      spawn.pos = sp.pos; spawn.heading = sp.heading;
      cart.reset(spawn.pos, spawn.heading);
      physics.stream(spawn.pos.x, spawn.pos.z);
    },
    start: (dest?: string | string[], stops = 1) => {
      const sp = starts[menus.startKey as keyof typeof starts] ?? starts.uv11;
      spawn.pos = sp.pos; spawn.heading = sp.heading;
      rc.startPoint = [sp.pos.x, -sp.pos.z];
      cart.reset(spawn.pos, spawn.heading);
      physics.stream(spawn.pos.x, spawn.pos.z);
      rig.setMode('chase');
      if (!rc.start(dest, { route: menus.assisted, beam: menus.showBeam }, stops)) { hud.toast('No route found to that destination'); return; }
      shownResult = false;
      legDest = null;
      peds.start(rc.startPoint);
      const si = rc.stopIndex;
      hud.toast(si.of > 1 ? `Gauntlet: ${si.of} stops · first ${rc.dest!.name}` : `Respond to ${rc.dest!.name}`);
    },
    quality: q => {
      if (q === 'auto') { adaptive.enabled = true; return; }
      adaptive.enabled = false; adaptive.current = q as QualityName; applyQuality(q as QualityName);
    },
    menuOpen: open => { menuOpen = open; muteVehicle(open); },
    time: t => applyTime(t as TimeOfDay),
    // Read from the form: this runs while Menus is still being constructed.
    deployPoint: () => { const sp = starts[(document.getElementById('start-select') as HTMLSelectElement).value as keyof typeof starts] ?? starts.uv11; return [sp.pos.x, -sp.pos.z]; },
    thumb: d => destinationPhoto(d),
    cue,
  });
  // Phones and tablets: drive stick, dispatch pill, Pause and Accessibility.
  const touch = new TouchControls(input, { pause: () => { if (!menus.isOpen) menus.open(); } });
  touch.onPrefs = p => { rig.reducedMotion = p.reduce; };
  rig.reducedMotion = touch.prefs.reduce;
  // Settings > Sound, and the HUD sound button (mute toggle) kept in step with it.
  const syncMute = bindSoundSettings(() => volumes, v => setVolumes(v));
  touch.onButton = id => {
    if (id === 'sound') { setVolumes({ muted: !volumes.muted }); syncMute(volumes.muted); return; }
    hud.onChip(id);
  };
  // A soft tick on every menu and HUD button press (switches get a higher one).
  addEventListener('pointerdown', e => {
    const el = (e.target as HTMLElement).closest?.('button, label.switch, select');
    if (el && !el.closest('#touch')) cue(el.matches('label.switch') ? 'toggle' : 'tap');
  }, { capture: true });
  /** Speed bumps and kerbs: a sharp rise in vertical speed; a short cooldown per bump. */
  let lastVy = 0, bumpFeel = 0, lastGear = '';

  /**
   * A photo of a destination for the dispatch cards, rendered from the game: from the
   * road or walk point 25-70 m from its outline with the fewest other buildings in the
   * way, looking at it. Drawn straight to the canvas at 384x216 and read back as JPEG
   * before the browser paints, so the screen never shows it.
   */
  const shotCanvas = document.createElement('canvas');
  shotCanvas.width = 384; shotCanvas.height = 216;
  const shotCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 3000);
  const inRing = (p: Pt, r: Pt[]) => { let q = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) q = !q; } return q; };
  const solid = data.buildings.filter(b => b.style !== 'canopy' && !b.minH);
  async function destinationPhoto(d: { outlines: Pt[][]; kind: string }): Promise<string | null> {
    await new Promise(r => requestAnimationFrame(r));
    const ring = d.outlines[0];
    const c: Pt = [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length];
    const near = (p: Pt) => { let m = Infinity; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); m = Math.min(m, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])); } return m; };
    const lot = d.kind === 'lot';
    let best: { p: Pt; score: number } | null = null;
    for (const r of data.roads) for (const p of r.pts) {
      const dist = near(p);
      if (dist < (lot ? 15 : 25) || dist > 70) continue;
      const nearby = solid.filter(b => Math.hypot(b.outer[0][0] - p[0], b.outer[0][1] - p[1]) < 200);
      if (nearby.some(b => inRing(p, b.outer))) continue;
      let blocked = 0;
      for (let t = 0.1; t < 0.9; t += 0.1) { const q: Pt = [p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t]; if (!inRing(q, ring) && nearby.some(b => b.outer !== ring && inRing(q, b.outer))) blocked++; }
      const score = -blocked * 3 - Math.abs(dist - 42) * 0.05;
      if (!best || score > best.score) best = { p, score };
    }
    const eye = best?.p ?? [c[0] + 50, c[1] - 50];
    const gy = terrain.heightAt(c[0], c[1]);
    shotCam.position.set(eye[0], terrain.heightAt(eye[0], eye[1]) + (lot ? 14 : 4), -eye[1]);
    shotCam.lookAt(c[0], gy + (lot ? 0 : 6), -c[1]);
    shotCam.updateMatrixWorld();
    streamer.update(shotCam.position, 0);
    env.follow(new THREE.Vector3(c[0], gy, -c[1]));
    env.sun.target.updateMatrixWorld();
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1); renderer.setSize(384, 216, false);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, shotCam);
    shotCanvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0, 384, 216);
    renderer.setPixelRatio(pr); renderer.setSize(size.x, size.y, false);
    streamer.update(camera.position, 0);
    return shotCanvas.toDataURL('image/jpeg', 0.86);
  }

  // Time of day: sky and light (Environment), street lamps, lit windows and headlights.
  const glass: THREE.MeshStandardMaterial[] = [];
  for (const m of models.values()) m.traverse(o => { const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (mat?.name?.startsWith('Glass') && !glass.includes(mat)) glass.push(mat); });
  function applyTime(t: TimeOfDay) {
    env.setTime(t, renderer);
    const night = env.night;
    nightUniform.value = night;
    mats.lampHead.emissiveIntensity = night ? 7 : 0.15;
    mats.lampPool.visible = night > 0;
    for (const g of glass) { g.emissive.setRGB(1, 0.8, 0.55); g.emissiveIntensity = night ? 0.05 : 0; }
    cart.headlightsOn = night > 0;
    menus.setTime(t);
  }
  // One time of day, golden hour, so the sun shadows can be baked (see the frame loop).
  applyTime('golden');

  // Post-processing (bloom for emergency lights) on high quality only.
  // Multisampled half-float target so the post chain keeps MSAA and HDR highlights.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 2 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.16, 0.3, 4.0); // sun glare, lamp glow and the emergency LEDs
  // Bloom (strength ~0.14 at golden hour, barely visible) cost a full mip chain per frame; left out.
  bloom.enabled = false;
  composer.addPass(new OutputPass());
  composer.addPass(gradePass());

  function applyQuality(name: QualityName) {
    const p = PRESETS[name];
    const shadowsChanged = renderer.shadowMap.enabled !== p.shadows;
    quality = name;
    // Changing the pixel ratio resizes the canvas, which shows a black frame; only do it
    // when the ratio actually changes.
    const pr = Math.min(devicePixelRatio, p.pixelRatioCap);
    if (renderer.getPixelRatio() !== pr) { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); }
    renderer.shadowMap.enabled = p.shadows;
    env.sun.castShadow = p.shadows;
    if (p.shadows && env.sun.shadow.mapSize.x !== p.shadowMapSize) {
      env.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      env.sun.shadow.map?.dispose();
      env.sun.shadow.map = null;
    }
    streamer.settings.viewDistance = p.viewDistance;
    streamer.settings.detailDistance = p.detailDistance;
    streamer.settings.nearDistance = p.nearDistance;
    streamer.settings.treeFullDistance = p.treeFullDistance;
    env.setShadowExtent(p.shadowExtent);
    bakedVersion = -1;
    camera.far = p.viewDistance + 3000;
    camera.updateProjectionMatrix();
    env.setViewDistance(p.viewDistance);
    bloom.enabled = p.bloom;
    // Recompiling every shader drew black frames until each program was rebuilt; it is
    // only needed when shadows are switched on or off.
    if (shadowsChanged) scene.traverse(o => { if ((o as THREE.Mesh).material) ((o as THREE.Mesh).material as THREE.Material).needsUpdate = true; });
  }
  applyQuality(quality);

  hud.onChip = id => input.onAction(id === 'lights' ? 'lights' : id === 'siren' ? 'siren' : id === 'horn' ? 'horn' : id === 'headlights' ? 'headlights' : id === 'location' ? 'location' : 'camera');
  input.onAction = a => {
    switch (a) {
      case 'camera': rig.cycle(); break;
      case 'lights': cart.lightsOn = !cart.lightsOn; cartAudio.click(true); break;
      case 'headlights': cart.headlightsOn = !cart.headlightsOn; cartAudio.click(); break;
      case 'siren': siren.toggle(); break;
      case 'horn': horn.toggle(); break;
      case 'location': hud.toggleLocation(); break;
      case 'recover': cart.recover(); break;
      case 'reset': cart.reset(spawn.pos, spawn.heading); break;
      case 'help': menus.showControls(); break;
      case 'perf': hud.togglePerf(); break;
      case 'map': hud.toggleMap(); break;
      case 'quality': {
        adaptive.enabled = false;
        const next = ORDER[(ORDER.indexOf(quality) + 1) % ORDER.length];
        adaptive.current = next;
        applyQuality(next);
        break;
      }
    }
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  loader.set(68, 86, 'Streaming nearby chunks…');
  await loader.paint();
  const tWarm = performance.now();
  streamer.warm(spawn.pos);
  const tCompile = performance.now();
  // No black frames at start: compile every shader the scene uses (asynchronously, off the
  // main thread where the driver allows), bake the shadows and draw two frames behind the
  // loading screen, then reveal. Uncompiled programs were drawing nothing on first use.
  loader.set(88, 97, 'Preparing graphics…');
  await loader.paint();
  cart.syncVisual(0, { pointLights: PRESETS[quality].pointLights });
  rig.update(cart, 0.016, 0);
  env.follow(cart.position(new THREE.Vector3()));
  // The first frames compile what the opening view needs; everything else in view range
  // compiles in the background (parallel compile) while the menu is up.
  renderer.shadowMap.needsUpdate = true;
  for (let i = 0; i < 2; i++) {
    if (PRESETS[quality].bloom) composer.render(0.016); else renderer.render(scene, camera);
    await new Promise(r => requestAnimationFrame(r));
  }
  void renderer.compileAsync(scene, camera).catch(() => {});
  console.info(`[load] fetch ${Math.round(T_LOAD.fetched - T_LOAD.start)} ms, setup ${Math.round(tWarm - T_LOAD.fetched)} ms, warm ${Math.round(tCompile - tWarm)} ms, compile ${Math.round(performance.now() - tCompile)} ms`);
  setLoading('Ready');
  await loader.finish();
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 420);
  menus.open();

  const FIXED = physics.world.timestep;
  let acc = 0;
  let last = performance.now();
  let fpsFrames = 0, fpsTime = 0, fps = 60, frameMs = 0, physMs = 0, renderMs = 0;
  let physTimer = 0;
  let shadowFrame = 0;
  const bakedAt = new THREE.Vector3(Infinity, 0, 0);
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  // Exposed for automated browser checks and debugging.
  // `freezeFoliage` (seconds) holds the wind sway still for frame-difference flicker checks.
  const sim = { cart, physics, streamer, rig, renderer, scene, camera, data, terrain, spawn, composer, bloom, freezeFoliage: null as number | null };
  (window as any).__sim = sim;
  if (import.meta.env.DEV) {
    const { installHarness } = await import('./debug/harness.ts');
    // 3D-Agentation-Editor (dev only): Shift+M, click anything in the 3D scene and type a
    // comment; notes go to .scenemark/ through its receiver (see docs). Driving pauses while marking.
    const { attachSceneMark } = await import('./dev/scenemark.js');
    attachSceneMark({
      renderer, scene, camera,
      render: () => { if (PRESETS[quality].bloom) composer.render(0.016); else renderer.render(scene, camera); },
      ignore: o => o.layers.mask === 2,
      onModeChange: active => { marking = active; },
    });
    installHarness({
      data, cart, physics, streamer, rig, terrain, renderer, scene, camera, sun: env.sun, sunDir: env.sunDir,
      post: (w, h) => {
        if (!PRESETS[quality].bloom) return false;
        composer.setPixelRatio(1); composer.setSize(w, h); composer.render(0.016);
        composer.setPixelRatio(Math.min(devicePixelRatio, PRESETS[quality].pixelRatioCap)); composer.setSize(innerWidth, innerHeight);
        return true;
      },
    });
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t0 = performance.now();

    const driving = !marking && rig.mode !== 'free' && !menuOpen && rc.phase !== 'countdown' && rc.phase !== 'finished';
    const k = input.keys;
    // Keyboard, tap pads and the touch stick (analog: partial pedal and steering) combine.
    const st = input.analog;
    const fwd = driving ? Math.max(input.axis([], ['KeyW', 'ArrowUp']), Math.max(0, st.y)) : 0;
    const back = driving ? Math.max(input.axis([], ['KeyS', 'ArrowDown']), Math.max(0, -st.y)) : 0;
    const steer = driving ? THREE.MathUtils.clamp(input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) - st.x, -1, 1) : (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    const di = cart.mapKeys(fwd, back, steer, k.has('Space') || (!driving && rig.mode !== 'free'));

    acc += dt;
    let steps = 0;
    const tp = performance.now();
    while (acc >= FIXED && steps < 10) {
      cart.snapshot();
      cart.update(di, FIXED);
      physics.step();
      acc -= FIXED;
      steps++;
    }
    physMs = performance.now() - tp;

    physTimer -= dt;
    const cp = cart.position(tmp);
    if (physTimer <= 0) { physics.stream(cp.x, cp.z); physTimer = 0.25; }

    foliageTime.value = sim.freezeFoliage ?? now / 1000;
    mats.layers.water.normalMap?.offset.set(foliageTime.value * 0.012, foliageTime.value * 0.008);
    cart.syncVisual(dt, { pointLights: PRESETS[quality].pointLights }, Math.min(1, acc / FIXED));
    rig.update(cart, dt, now / 1000);
    camPos.copy(camera.position);
    streamer.update(camPos);
    streamer.uploadNext(renderer, camera);
    // Baked sun shadows: the cart and pedestrians cast none (they have contact shadows),
    // so the map only changes when the area around the player does. It is re-rendered
    // when the player has moved a third of its width from where it was baked, or the
    // chunks around changed, instead of every frame.
    const focus = rig.mode === 'free' ? camPos : cp;
    renderer.shadowMap.autoUpdate = false;
    if (bakedVersion !== streamer.version || focus.distanceTo(bakedAt) > PRESETS[quality].shadowExtent / 3) {
      env.follow(focus);
      bakedAt.copy(focus);
      bakedVersion = streamer.version;
      renderer.shadowMap.needsUpdate = true;
      shadowFrame++;
    }

    // Bloom: a little lamp glow at night; nearly none at midday, where it hazed the horizon on High.
    bloom.strength = 0.14;
    renderer.info.reset();
    const tr = performance.now();
    if (PRESETS[quality].bloom) composer.render(dt); else renderer.render(scene, camera);
    renderMs = performance.now() - tr;

    const f = cart.forward(new THREE.Vector3());
    const ll = unproject(cp.x, -cp.z);
    // Route Challenge update, beacon animation, result screen.
    {
      const fw = cart.forward(tmp2);
      if (!menuOpen) {
        rc.update(dt, [cp.x, -cp.z], cart.speed, [fw.x, -fw.z]);
        const hits = peds.update(dt, [cp.x, -cp.z], [fw.x, -fw.z], Math.abs(cart.speed), horn.on || siren.on);
        for (let k = 0; k < hits; k++) rc.pedestrianHit();
      }
      if (rc.phase === 'finished' || rc.phase === 'idle') peds.stop();
    }
    // Each stop of a run: beacon (only when chosen as an assist) and the map overlay.
    if (rc.dest && rc.dest !== legDest && rc.phase !== 'idle') {
      legDest = rc.dest;
      const t = rc.dest.target;
      beacon.position.set(t[0], terrain.heightAt(t[0], t[1]), -t[1]);
      hud.overlay = { target: menus.showTarget ? t : undefined, route: rc.assist.route ? rc.optimal!.pts : undefined, trail: rc.trail };
    }
    // Collisions: a sudden loss of speed far beyond hard braking (over 1.6 g) means the cart hit something.
    {
      const lv = cart.body.linvel();
      const v = tmp2.set(lv.x, 0, lv.z);
      const dv = v.distanceTo(lastVel);
      bumpCooldown -= dt;
      const jumped = cp.distanceTo(lastPos) > 3; // reset or recovery, not a crash
      lastPos.copy(cp);
      if (!jumped && dt > 0 && dv / dt > 16 && lastVel.length() > 2 && v.length() < lastVel.length() - 1.2 && bumpCooldown <= 0) {
        if (rc.phase === 'running') rc.collision();
        bumpCooldown = 1.5;
        // Impact feedback scaled by the speed lost: camera shake, a thump, a short buzz on phones.
        const hit = Math.min(1, (lastVel.length() - v.length()) / 6);
        rig.kick(0.3 + hit * 0.45);
        cartAudio.thump(0.5 + hit * 0.5);
        if (touch.enabled && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(30 + Math.round(hit * 40));
      }
      lastVel.copy(v);
      // Speed bumps and kerbs: a small kick and thump, scaled by how hard the wheels hit.
      bumpFeel -= dt;
      const dvy = lv.y - lastVy;
      lastVy = lv.y;
      if (!jumped && dvy > 1.1 && bumpFeel <= 0 && v.length() > 1) {
        const s = Math.min(1, (dvy - 1.1) / 2.5);
        rig.kick(0.1 + s * 0.2);
        cartAudio.thump(0.18 + s * 0.35);
        bumpFeel = 0.3;
      }
      // Motor whirr follows road speed and pedal; ducks under the siren and horn.
      cartAudio.update(menuOpen ? 0 : cart.speed, driving ? di.throttle : 0, onNetwork([cp.x, -cp.z]) ? 0 : 1, driving ? di.brake : 0);
      duckVehicle(siren.on || horn.on);
      if (cart.gear !== lastGear) { if (lastGear) cartAudio.click(); lastGear = cart.gear; }
    }
    menus.update([cp.x, -cp.z]);

    if (rc.phase !== 'idle') hud.overlay.trail = rc.trail;
    beacon.rotation.y += dt * 0.8;
    beacon.visible = (rc.phase === 'running' || rc.phase === 'countdown') && rc.assist.beam;
    (beacon.children[0] as THREE.Mesh).scale.y = 1 + Math.sin(now / 300) * 0.04;
    if (rc.phase === 'finished' && !shownResult && rc.result) {
      shownResult = true;
      beacon.visible = false;
      menus.showResult(rc.result, { image: hud.mapImage, bounds: hud.bounds, scale: hud.MAP_SCALE }, rc.optimal!.pts, rc.trail);
    }

    touch.update(dt, { mph: Math.abs(cart.speed) * 2.23694, gear: cart.gear, lights: cart.lightsOn, siren: siren.on, horn: horn.on, headlights: cart.headlightsOn, muted: volumes.muted });
    hud.update({
      speedMS: cart.speed, gear: cart.gear, x: cp.x, z: cp.z, heading: -Math.atan2(f.x, -f.z),
      lights: cart.lightsOn, siren: siren.on, horn: horn.on, headlights: cart.headlightsOn, camera: rig.mode, lat: ll.lat, lon: ll.lon,
    }, dt);

    frameMs = performance.now() - t0;
    fpsFrames++; fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0; fpsTime = 0;
      // Judged only while driving: on the menu the horizon is still streaming in.
      const change = menuOpen ? null : adaptive.sample(fps, 0.5);
      if (change) applyQuality(change);
      if (hud.perfVisible) {
        const info = renderer.info;
        const mem = (performance as any).memory;
        hud.setPerf([
          ['FPS', fps.toFixed(0)],
          ['Frame (CPU)', `${frameMs.toFixed(1)} ms`],
          ['Physics', `${physMs.toFixed(2)} ms`],
          ['Render submit', `${renderMs.toFixed(1)} ms`],
          ['Draw calls', String(info.render.calls)],
          ['Triangles', (info.render.triangles / 1000).toFixed(0) + 'k'],
          ['Geometries', String(info.memory.geometries)],
          ['Textures', String(info.memory.textures)],
          ['Chunks loaded/vis/detail', `${streamer.stats.loaded}/${streamer.stats.visible}/${streamer.stats.detailVisible}`],
          ['Physics chunks/colliders', `${physics.stats.chunks}/${physics.stats.colliders}`],
          ['Quality', `${quality}${adaptive.enabled ? ' (auto)' : ''}`],
          ...(mem ? [['JS heap', `${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB`] as [string, string]] : []),
        ]);
      }
    }
  }
  requestAnimationFrame(frame);
}

/** Destination marker: a tall translucent light column with a ground ring. */
function makeBeacon() {
  const g = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 24, 1, true).translate(0, 30, 0),
    new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4, 48).rotateX(-Math.PI / 2).translate(0, 0.15, 0),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  g.add(col, ring);
  g.visible = false;
  return g;
}

main().catch(e => {
  console.error(e);
  setLoading('Failed to start: ' + (e as Error).message);
});
