import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { gradePass, installInlineGrade } from './graphics/grade.ts';
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
import { roadTapers } from './world/roadShape.ts';
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
import { PRESETS, ORDER, QUALITY_LABEL, AdaptiveQuality, GpuTimer, detectPreset, pixelRatioFor, type QualityName } from './graphics/quality.ts';
import { Hud } from './ui/hud.ts';
import { Menus } from './ui/menus.ts';
import { RouteChallenge } from './gameplay/routeChallenge.ts';
import { Pedestrians } from './gameplay/pedestrians.ts';
import { Siren, Horn, setEmergencyOutput } from './audio/siren.ts';
import { AudioMix, CartAudio, Sfx } from './audio/mix.ts';
import { unproject } from './geo/projection.ts';
import { Loading, probeGpu } from './ui/loading.ts';

// The colour grade is compiled into every material (see grade.ts), so it must be in place before any shader is built.
installInlineGrade();

const loading = new Loading();
const setLoading = (t: string) => loading.text(t);
/**
 * Lets the browser paint the loading bar between long synchronous build steps. Animation
 * frames stop in a background tab, so a timer also resolves it: loading carries on there.
 */
const paint = () => new Promise<void>(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60); });

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
  setLoading('Loading campus map data…');
  const params = new URLSearchParams(location.search);
  // The device's own starting preset, from a throwaway context, so the quality choice can
  // show it under Auto while the campus downloads.
  const touch = matchMedia('(pointer: coarse)').matches;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const guessed = detectPreset({
    gpu: probeGpu(), touch,
    memoryGB: nav.deviceMemory, cores: nav.hardwareConcurrency, minScreen: Math.min(screen.width, screen.height),
  });
  const urlQuality = params.get('quality') as QualityName | null;
  // A ?quality= URL skips the choice (automated checks and shared links).
  const fromUrl = !!urlQuality && ORDER.includes(urlQuality);
  if (fromUrl) loading.skipChoice();
  const choiceP = fromUrl ? Promise.resolve(urlQuality!) : loading.chooseQuality(guessed);
  const L = loading;
  const [data, terrain, R, cartModel, cars, models, solids] = await Promise.all([
    L.track(loadCampus(), 3), L.track(Terrain.load(), 3), L.track(initRapier(), 2), L.track(loadCartModel(DEFAULT_CART), 2),
    L.track(loadCars().catch(() => []), 1), L.track(loadPhotos().then(() => loadBuildingModels()), 4), L.track(loadBuildingSolids(), 1),
  ]);
  setLoading('Choose graphics quality, then Start');
  const choice = await choiceP;
  setLoading('Building campus…');
  await paint();
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
    tapers: roadTapers(data.roads.filter(r => DRIVABLE.has(r.cls))),
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
  // Multisampling is skipped on phone-class screens of 2x density and up: the pixels are already
  // finer than the eye resolves at arm's length, and MSAA is the dearest thing a tile-based GPU does.
  // Elsewhere only a Very low start skips it. It is fixed for the life of the context, so a
  // session that starts on Low must have it: without it Low showed stair-stepped edges, and
  // Auto kept them after stepping up. On entry-level laptop graphics it costs 10-15% at
  // Low's 1.3 M pixels.
  // ?msaa=0|1 forces it, for measuring.
  const startPreset: QualityName = choice === 'auto' ? guessed : choice;
  const antialias = params.has('msaa') ? params.get('msaa') !== '0' : !(touch && devicePixelRatio >= 2) && startPreset !== 'verylow';
  let renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance', reversedDepthBuffer: true });
  if (!renderer.capabilities.reversedDepthBuffer) {
    renderer.dispose();
    renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
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

  // Starting preset: the player's choice at startup (or the URL's), or under Auto the guess
  // from the device, which the adaptive controller then corrects to hold 60 fps.
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let quality: QualityName = startPreset;
  const adaptive = new AdaptiveQuality(quality);
  adaptive.enabled = choice === 'auto';
  (document.getElementById('quality-select') as HTMLSelectElement).value = choice;
  const gpuTimer = new GpuTimer(gl);

  const streamer = new WorldStreamer(chunks, mats, ctx, { viewDistance: PRESETS[quality].viewDistance, detailDistance: PRESETS[quality].detailDistance, nearDistance: PRESETS[quality].nearDistance, treeFullDistance: PRESETS[quality].treeFullDistance, groundDistance: PRESETS[quality].groundDistance });
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
  // Audio: everything plays through the mix's buses (mix.ts); the siren and horn on the emergency bus.
  const mix = new AudioMix();
  setEmergencyOutput(mix.bus('emergency'));
  const cartAudio = new CartAudio(mix), sfx = new Sfx(mix);
  const siren = new Siren();
  const horn = new Horn();
  const stored = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  {
    const vol = document.getElementById('volume') as HTMLInputElement | null;
    if (vol) {
      vol.value = stored('volume', '80');
      mix.setVolume(+vol.value / 100);
      vol.addEventListener('input', () => { mix.setVolume(+vol.value / 100); store('volume', vol.value); });
    }
  }
  // Mute: the HUD's sound button, N, and the Settings switch all set the one master mute.
  const muteBox = document.getElementById('mute') as HTMLInputElement;
  const setMuted = (m: boolean) => { mix.setMuted(m); muteBox.checked = m; store('muted', m ? '1' : '0'); };
  setMuted(stored('muted', '0') === '1');
  muteBox.addEventListener('change', () => setMuted(muteBox.checked));
  // Steering sensitivity, 50-200%: the rate the wheels turn, and on the touch stick how far
  // it must be pushed for full lock.
  const sens = document.getElementById('steer-sens') as HTMLInputElement;
  const sensOut = document.getElementById('steer-sens-val')!;
  let steerSens = 1;
  const setSens = (v: number) => { steerSens = v / 100; sensOut.textContent = `${v}%`; sens.value = String(v); };
  setSens(Math.min(200, Math.max(50, Number(stored('steer-sens', '100')) || 100)));
  sens.addEventListener('input', () => { setSens(+sens.value); store('steer-sens', sens.value); });
  // Impact feedback (see docs/GRAPHICS.md "Feedback"): a decaying camera shake, scaled to the
  // event and switchable off in Settings. It offsets the drawn view only, after the camera
  // rig has placed it, and never the cart.
  let trauma = 0, shakeT = 0;
  const shakeBox = document.getElementById('shake') as HTMLInputElement | null;
  if (shakeBox) { shakeBox.checked = stored('shake', '1') === '1'; shakeBox.addEventListener('change', () => store('shake', shakeBox.checked ? '1' : '0')); }
  const jolt = (amount: number) => { trauma = Math.min(1, trauma + amount); };
  const vignette = document.getElementById('vignette');
  const flashHit = () => { if (!vignette) return; vignette.classList.remove('hit'); void vignette.offsetWidth; vignette.classList.add('hit'); };
  let lastVy = 0, joltCooldown = 0, lastCount = 0, lastPhase = 'idle';

  // Route Challenge (gameplay layer): network-following runs from the UEMR apartment.
  const startPt: Pt = [spawn.pos.x, -spawn.pos.z];
  const onNetwork = (p: Pt) => ctx.onRoad(p, 1.0) || ctx.onPath(p, 1.0) || ctx.inParking(p) || ctx.inPlaza(p);
  // Traffic controls scored in runs: signed stop points (not those inside lots) and mapped bumps.
  const rc = new RouteChallenge(data, startPt, onNetwork, data.stops.filter(s => !ctx.inParking(s.p)), data.bumps);
  const peds = new Pedestrians(data, terrain);
  scene.add(peds.group);
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
      // Back in the cart: left in the free camera, the driving keys fly the camera and the cart sits still.
      rig.setMode('chase');
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
      store('quality-choice', q);
      if (q === 'auto') { adaptive.enabled = true; applyResolution(); return; }
      adaptive.enabled = false; adaptive.current = q as QualityName; applyQuality(q as QualityName); applyResolution();
    },
    menuOpen: open => { menuOpen = open; },
    time: t => applyTime(t as TimeOfDay),
    // Read from the form: this runs while Menus is still being constructed.
    deployPoint: () => { const sp = starts[(document.getElementById('start-select') as HTMLSelectElement).value as keyof typeof starts] ?? starts.uv11; return [sp.pos.x, -sp.pos.z]; },
    thumb: d => destinationPhoto(d),
  });

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
    // The photo's surroundings in full detail (distant chunks are kept in their light far form).
    streamer.ensureFull(shotCam.position, 150);
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
    cart.glowLevel = night ? 1 : 0.28;
    menus.setTime(t);
  }
  const startTime = params.get('time') as TimeOfDay | null;
  applyTime(startTime && ['golden', 'day', 'night'].includes(startTime) ? startTime : 'golden');

  // Post-processing exists only for bloom (lamp glow and the emergency LEDs at night, High):
  // by day the frame is drawn straight to the canvas, graded in the material shaders. The
  // chain and its HDR targets are therefore built the first time they are needed.
  // Multisampled half-float target so the post chain keeps MSAA and HDR highlights.
  let post: { composer: EffectComposer; bloom: UnrealBloomPass } | null = null;
  const ensurePost = () => {
    if (post) return post;
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.3, 4.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.addPass(gradePass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    post = { composer, bloom };
    return post;
  };
  const wantPost = () => PRESETS[quality].bloom && env.night > 0;

  /** Render resolution from the preset, the adaptive scale and the window size. */
  function applyResolution() {
    const pr = pixelRatioFor(PRESETS[quality], adaptive.enabled ? adaptive.scale : 1, innerWidth, innerHeight, devicePixelRatio);
    if (Math.abs(pr - renderer.getPixelRatio()) < 1e-3) return;
    renderer.setPixelRatio(pr);
    post?.composer.setPixelRatio(pr);
  }

  function applyQuality(name: QualityName) {
    const p = PRESETS[name];
    quality = name;
    applyResolution();
    // Shadows are switched at the light: materials pick up the changed light set by themselves,
    // where switching the renderer's shadow map off needed every shader in the scene rebuilt.
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
    streamer.settings.groundDistance = p.groundDistance;
    camera.far = p.viewDistance + 3000;
    camera.updateProjectionMatrix();
    env.setViewDistance(p.viewDistance);
  }
  applyQuality(quality);

  hud.onChip = id => input.onAction(id === 'lights' ? 'lights' : id === 'siren' ? 'siren' : id === 'horn' ? 'horn' : id === 'headlights' ? 'headlights' : id === 'location' ? 'location' : id === 'mute' ? 'mute' : 'camera');
  // The on-screen Menu button: dispatch and settings without a keyboard.
  document.getElementById('menu-btn')!.addEventListener('click', () => menus.open());
  input.onAction = a => {
    switch (a) {
      case 'mute': setMuted(!mix.muted); break;
      case 'camera': rig.cycle(); break;
      case 'lights': cart.lightsOn = !cart.lightsOn; break;
      case 'headlights': cart.headlightsOn = !cart.headlightsOn; break;
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
        (document.getElementById('quality-select') as HTMLSelectElement).value = next;
        hud.toast(`Graphics: ${QUALITY_LABEL[next]}`, 1.5);
        break;
      }
    }
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    applyResolution();
    post?.composer.setSize(innerWidth, innerHeight);
  });

  setLoading('Streaming nearby chunks…');
  loading.set(loading.afterAssets + 0.12);
  await paint();
  streamer.warm(spawn.pos);
  setLoading('Ready');
  loading.finish();
  menus.open();

  const FIXED = physics.world.timestep;
  let acc = 0;
  let last = performance.now();
  let fpsFrames = 0, fpsTime = 0, fps = 60, frameMs = 0, physMs = 0, renderMs = 0, cpuSum = 0;
  /** Recent frame intervals (ms): their fastest few show the display's refresh cap. */
  const intervals = new Float32Array(120).fill(16.7);
  let intervalAt = 0;
  let physTimer = 0;
  let shadowFrame = 0;
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  /** Size the composer was set to by the dev harness's timing views ('' = the window's). */
  let postSize = '';
  // Exposed for automated browser checks and debugging.
  // `freezeFoliage` (seconds) holds the wind sway still for frame-difference flicker checks.
  const sim = { cart, physics, streamer, rig, renderer, scene, camera, data, terrain, spawn, adaptive, gpuTimer, mix, cartAudio, get quality() { return quality; }, get post() { return post; }, freezeFoliage: null as number | null };
  (window as any).__sim = sim;
  if (import.meta.env.DEV) {
    const { installHarness } = await import('./debug/harness.ts');
    // 3D-Agentation-Editor (dev only): Shift+M, click the scene, type a note. Notes go to the
    // receiver (node ~/.claude/skills/3D-Agentation-Editor/server.mjs, run from the project root)
    // and land in .scenemark/notes.json with a screenshot, for the agent to act on.
    const { attachSceneMark } = await import('./dev/scenemark.js');
    attachSceneMark({
      renderer, scene, camera,
      render: () => { if (wantPost()) ensurePost().composer.render(0.016); else renderer.render(scene, camera); },
      ignore: o => o === beacon || beacon.children.includes(o as THREE.Mesh),
      // Marking pauses driving input: menuOpen stops the cart taking keys.
      onModeChange: active => { menuOpen = active || menus.isOpen; },
    });

    installHarness({
      data, cart, physics, streamer, rig, terrain, renderer, scene, camera, sun: env.sun, sunDir: env.sunDir,
      frame: now => frame(now, false),
      post: (w, h) => {
        if (!wantPost()) return false;
        const { composer } = ensurePost();
        // Resized only when the size changes (timing loops call this every frame), and put back on the next real frame.
        if (postSize !== w + 'x' + h) { composer.setPixelRatio(1); composer.setSize(w, h); postSize = w + 'x' + h; }
        composer.render(0.016);
        return true;
      },
    });
  }

  function frame(now: number, scheduled = true) {
    if (scheduled) requestAnimationFrame(t => frame(t));
    const dt = Math.min(0.1, (now - last) / 1000);
    intervals[intervalAt = (intervalAt + 1) % intervals.length] = now - last;
    last = now;
    const t0 = performance.now();

    const driving = rig.mode !== 'free' && !menuOpen && rc.phase !== 'countdown' && rc.phase !== 'finished';
    const k = input.keys;
    // Keyboard, or the touch stick when a finger holds it: up drives, down brakes then
    // reverses, sideways steers (scaled by the steering sensitivity, so a higher setting
    // reaches full lock with less of a push).
    const st = input.stick;
    const fwd = driving ? Math.max(input.axis([], ['KeyW', 'ArrowUp']), st.active ? Math.max(0, st.y) : 0) : 0;
    const back = driving ? Math.max(input.axis([], ['KeyS', 'ArrowDown']), st.active ? Math.max(0, -st.y) : 0) : 0;
    const stickSteer = st.active ? Math.max(-1, Math.min(1, -st.x * steerSens)) : 0;
    const steer = driving ? (input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) || stickSteer) : (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    cart.steerSensitivity = steerSens;
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
    cart.syncVisual(dt, { pointLights: PRESETS[quality].pointLights }, steps < 10 ? acc / FIXED : 1);
    rig.update(cart, dt, now / 1000);
    // Shake: trauma decays every frame and is squared, so small knocks barely move the view.
    if (trauma > 0) {
      trauma = Math.max(0, trauma - dt * 1.8);
      if (rig.mode !== 'free' && (shakeBox?.checked ?? true)) {
        const s = trauma * trauma;
        shakeT += dt * 34;
        camera.translateX(0.1 * s * Math.sin(shakeT * 1.7));
        camera.translateY(0.07 * s * Math.sin(shakeT * 2.3));
        camera.rotateZ(0.012 * s * Math.sin(shakeT * 1.1));
      }
    }
    camPos.copy(camera.position);
    streamer.update(camPos);
    env.follow(rig.mode === 'free' ? camPos : cp);
    // The shadow map is refreshed every frame: refreshing it every other frame made
    // shadow edges step against the moving camera, which read as flicker on facades.
    // Its cost is kept down instead by the light tree crowns in the shadow pass.
    shadowFrame++;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    renderer.info.reset();
    const tr = performance.now();
    gpuTimer.begin();
    if (wantPost()) {
      const { composer } = ensurePost();
      if (postSize) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); postSize = ''; }
      composer.render(dt);
    } else renderer.render(scene, camera);
    gpuTimer.end();
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
        if (hits) { sfx.impact(0.25); jolt(0.3); flashHit(); }
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
      if (!jumped && !menuOpen && dt > 0 && dv / dt > 16 && lastVel.length() > 2 && v.length() < lastVel.length() - 1.2 && bumpCooldown <= 0) {
        // Heard and felt on every drive; scored only during a run.
        const hard = Math.min(1, (lastVel.length() - v.length()) / 6);
        sfx.impact(hard); jolt(0.35 + 0.4 * hard); flashHit();
        if (rc.phase === 'running') rc.collision();
        bumpCooldown = 1.5;
      }
      lastVel.copy(v);
      // A kerb, speed bump or landing: a sudden change in vertical speed while moving.
      joltCooldown -= dt;
      const dvy = Math.abs(lv.y - lastVy);
      if (!jumped && !menuOpen && dvy > 0.85 && v.length() > 1.5 && joltCooldown <= 0 && bumpCooldown < 1.4) {
        const k = Math.min(1, (dvy - 0.85) / 2.5);
        sfx.thud(k); jolt(0.1 + 0.15 * k);
        joltCooldown = 0.35;
      }
      lastVy = lv.y;
    }
    // Cart sound, siren ducking, countdown beeps and the arrival chime.
    cartAudio.update(dt, menuOpen ? 0 : cart.speed, menuOpen ? 0 : di.throttle);
    mix.setDucked(siren.on || horn.on);
    if (rc.phase === 'countdown') { const n = Math.ceil(rc.countdown); if (n !== lastCount && n > 0) sfx.beep(); lastCount = n; }
    if (rc.phase !== lastPhase) {
      if (lastPhase === 'countdown' && rc.phase === 'running') sfx.beep(true);
      if (rc.phase === 'finished') sfx.chime();
      lastPhase = rc.phase; lastCount = 0;
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

    hud.update({
      speedMS: cart.speed, gear: cart.gear, x: cp.x, z: cp.z, heading: -Math.atan2(f.x, -f.z),
      lights: cart.lightsOn, siren: siren.on, horn: horn.on, headlights: cart.headlightsOn, camera: rig.mode, lat: ll.lat, lon: ll.lon,
      muted: mix.muted,
      dest: rc.dest && (rc.phase === 'running' || rc.phase === 'countdown') ? { name: rc.dest.name, left: rc.distanceLeft([cp.x, -cp.z]) } : undefined,
    }, dt);

    frameMs = performance.now() - t0;
    cpuSum += frameMs;
    fpsFrames++; fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      const cpuMs = cpuSum / fpsFrames;
      const best = Array.from(intervals).sort((a, b) => a - b)[6];
      // Not while the menu covers the view (its destination photos borrow the renderer) or the tab is hidden.
      const change = menuOpen || document.hidden ? null : adaptive.sample({ fps, cpuMs, gpuMs: gpuTimer.ms, bestIntervalMs: best }, fpsTime);
      fpsFrames = 0; fpsTime = 0; cpuSum = 0;
      if (change?.preset) applyQuality(change.preset); else if (change) applyResolution();
      if (hud.perfVisible) {
        const info = renderer.info;
        const mem = (performance as any).memory;
        hud.setPerf([
          ['FPS', fps.toFixed(0)],
          ['Frame (CPU)', `${frameMs.toFixed(1)} ms`],
          ['Physics', `${physMs.toFixed(2)} ms`],
          ['Render submit', `${renderMs.toFixed(1)} ms`],
          ['GPU', gpuTimer.ms === undefined ? 'n/a' : `${gpuTimer.ms.toFixed(1)} ms`],
          ['Resolution', `${renderer.domElement.width}×${renderer.domElement.height}`],
          ['Draw calls', String(info.render.calls)],
          ['Triangles', (info.render.triangles / 1000).toFixed(0) + 'k'],
          ['Geometries', String(info.memory.geometries)],
          ['Textures', String(info.memory.textures)],
          ['Chunks loaded/vis/detail', `${streamer.stats.loaded}/${streamer.stats.visible}/${streamer.stats.detailVisible}`],
          ['Physics chunks/colliders', `${physics.stats.chunks}/${physics.stats.colliders}`],
          ['Quality', `${quality}${adaptive.enabled ? ` (auto, ${Math.round(adaptive.scale * 100)}%)` : ''}`],
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
  loading.fail('Failed to start: ' + (e as Error).message + '. Reload the page to try again.');
});
