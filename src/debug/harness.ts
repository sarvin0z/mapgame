// Development-only helpers for automated checks from the browser console or a
// test driver: deterministic physics stepping, scripted cart placement and
// frame capture to data/preview/ (via the dev server's /__capture endpoint).
import * as THREE from 'three';
import type { GolfCart } from '../vehicle/golfCart.ts';
import type { PhysicsWorld } from '../physics/physicsWorld.ts';
import type { WorldStreamer } from '../world/worldStreamer.ts';
import type { CameraRig } from '../camera/cameraRig.ts';
import type { Terrain } from '../world/terrain.ts';
import type { DriverInput } from '../vehicle/powertrain.ts';
import type { Pt, CampusData } from '../world/campusData.ts';

interface Ctx {
  data: CampusData;
  cart: GolfCart; physics: PhysicsWorld; streamer: WorldStreamer; rig: CameraRig; terrain: Terrain;
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; sun: THREE.DirectionalLight; sunDir: THREE.Vector3;
  /** Renders the current frame through post-processing at w x h; false when post-processing is off. */
  post?: (w: number, h: number) => boolean;
  /** Runs one frame of the real game loop at clock time `now` (ms) without scheduling another. */
  frame?: (now: number) => void;
}

export function installHarness(c: Ctx) {
  const idle: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const T = THREE.Vector3;
  const h = {
    /** Puts the cart `back` m behind map point p, facing along map direction dir, `side` m to the right. */
    place(p: Pt, dir: Pt, back = 0, side = 0) {
      const p0: Pt = [p[0] - dir[0] * back + side * dir[1], p[1] - dir[1] * back - side * dir[0]];
      c.physics.stream(p0[0], -p0[1]);
      c.cart.reset(new T(p0[0], c.terrain.heightAt(p0[0], p0[1]) + 0.05, -p0[1]), Math.atan2(dir[0], -dir[1]));
      return p0;
    },
    /** Steps physics for `secs` at 1/120 s with a controller; returns motion statistics. */
    sim(secs: number, ctl: (t: number, v: number) => DriverInput = () => idle) {
      // Keyboard input is off while scripted, and handed back afterwards: left replaced, it
      // silently disabled driving for anyone who then played in the same tab.
      const mapKeys = c.cart.mapKeys;
      c.cart.mapKeys = () => idle;
      try {
      const dt = 1 / 120, n = Math.round(secs / dt);
      const rec = { maxPitch: 0, maxRoll: 0, maxVertG: 0, minWheels: 4, samples: [] as [number, number][], end: [0, 0] as Pt, up: 1 };
      let lastVy = c.cart.body.linvel().y;
      const q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        c.cart.update(ctl(i * dt, c.cart.speed), dt);
        c.physics.step();
        if (i % 60 === 0) { const p = c.cart.position(new T()); c.physics.stream(p.x, p.z); }
        const r = c.cart.body.rotation(); q.set(r.x, r.y, r.z, r.w);
        const f = new T(0, 0, 1).applyQuaternion(q), up = new T(0, 1, 0).applyQuaternion(q);
        const right = new T().crossVectors(f, new T(0, 1, 0)).normalize();
        rec.maxPitch = Math.max(rec.maxPitch, Math.abs(Math.asin(f.y)) * 57.3);
        rec.maxRoll = Math.max(rec.maxRoll, Math.abs(Math.asin(THREE.MathUtils.clamp(up.dot(right), -1, 1))) * 57.3);
        const vy = c.cart.body.linvel().y;
        if (i > 30) rec.maxVertG = Math.max(rec.maxVertG, Math.abs(vy - lastVy) / dt / 9.81);
        lastVy = vy;
        let k = 0; for (let w = 0; w < 4; w++) if (c.cart.vc.wheelIsInContact(w)) k++;
        if (i > 60) rec.minWheels = Math.min(rec.minWheels, k);
        if (i % 12 === 0) rec.samples.push([+(i * dt).toFixed(2), +(c.cart.speed * 2.23694).toFixed(1)]);
      }
      const p = c.cart.position(new T());
      rec.end = [p.x, -p.z];
      const r = c.cart.body.rotation(); q.set(r.x, r.y, r.z, r.w);
      rec.up = +new T(0, 1, 0).applyQuaternion(q).y.toFixed(3);
      return rec;
      } finally { c.cart.mapKeys = mapKeys; }
    },
    /** Renders one 1280x800 frame from pos toward look and saves it as data/preview/<name>.png. */
    async capture(name: string, pos: THREE.Vector3, look: THREE.Vector3) {
      const size = c.renderer.getSize(new THREE.Vector2()), pr = c.renderer.getPixelRatio(), aspect = c.camera.aspect;
      c.renderer.setPixelRatio(1); c.renderer.setSize(1280, 800, false);
      c.camera.aspect = 1.6; c.camera.updateProjectionMatrix();
      c.rig.lookFrom(pos, look);
      for (let i = 0; i < 6; i++) c.streamer.update(c.camera.position, Infinity);
      c.sun.position.copy(look).addScaledVector(c.sunDir, 250);
      c.sun.target.position.copy(look);
      c.sun.target.updateMatrixWorld();
      c.cart.syncVisual(0.016, { pointLights: true });
      c.renderer.shadowMap.needsUpdate = true;
      c.renderer.render(c.scene, c.camera);
      c.renderer.shadowMap.needsUpdate = true;
      if (!c.post?.(1280, 800)) c.renderer.render(c.scene, c.camera);
      const url = c.renderer.domElement.toDataURL('image/png');
      c.renderer.setPixelRatio(pr); c.renderer.setSize(size.x, size.y, false);
      c.camera.aspect = aspect; c.camera.updateProjectionMatrix();
      await fetch('/__capture?name=' + encodeURIComponent(name), { method: 'POST', body: url });
      return name;
    },
    /** Capture relative to the cart: offsets in cart-local meters (x left, y up, z forward). */
    async captureCart(name: string, eye: [number, number, number], at: [number, number, number] = [0, 0.9, 0]) {
      const root = c.cart.model.root;
      c.cart.syncVisual(0.016, { pointLights: true });
      root.updateMatrixWorld();
      return h.capture(name, new T(...eye).applyMatrix4(root.matrixWorld), new T(...at).applyMatrix4(root.matrixWorld));
    },
  };
  /**
   * Average GPU+CPU time of one frame at 1280x720 from the chase camera, measured
   * with a blocking pixel read so it includes GPU work. Optional `toggle(off)`
   * hides something to measure what it costs.
   */
  const measure = (frames = 8) => {
    const gl = c.renderer.getContext(), px = new Uint8Array(4);
    const frame = () => { c.renderer.render(c.scene, c.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    frame(); frame();
    c.renderer.info.reset();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) frame();
    const ms = (performance.now() - t0) / frames;
    return { ms: +ms.toFixed(1), calls: Math.round(c.renderer.info.render.calls / frames), ktris: Math.round(c.renderer.info.render.triangles / frames / 1000) };
  };
  const profile = (toggles: Record<string, (off: boolean) => void> = {}) => {
    const size = c.renderer.getSize(new THREE.Vector2()), pr = c.renderer.getPixelRatio(), aspect = c.camera.aspect;
    c.renderer.setPixelRatio(1); c.renderer.setSize(1280, 720, false); c.camera.aspect = 16 / 9; c.camera.updateProjectionMatrix();
    c.rig.setMode('chase');
    for (let i = 0; i < 40; i++) { c.rig.update(c.cart, 0.05, i); c.streamer.update(c.camera.position, Infinity); }
    const out: Record<string, ReturnType<typeof measure>> = { all: measure() };
    for (const [k, f] of Object.entries(toggles)) { f(true); out[k] = measure(); f(false); }
    c.renderer.setPixelRatio(pr); c.renderer.setSize(size.x, size.y, false); c.camera.aspect = aspect; c.camera.updateProjectionMatrix();
    return out;
  };
  /**
   * Verification view: renders `name` from the best walkway/road point 18-55 m
   * from its walls (fewest other buildings and trees in the way), facing the
   * nearest facade, and saves it beside the reference photo as data/preview/cmp_<slug>.png.
   */
  const pin = (p: Pt, r: Pt[]) => { let q = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) q = !q; } return q; };
  const nearestOn = (p: Pt, r: Pt[]) => {
    let best: Pt = r[0], bd = Infinity;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const q: Pt = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) { bd = d; best = q; }
    }
    return { q: best, d: bd };
  };
  const compare = async (name: string, refFile: string, dmin = 18, dmax = 55) => {
    const b = c.data.buildings.find(x => x.name === name);
    if (!b) return name + ': missing';
    const others = c.data.buildings.filter(x => x !== b && x.style !== 'canopy');
    let best: { p: Pt; q: Pt; score: number } | null = null;
    for (const r of c.data.roads) for (const p of r.pts) {
      const { q, d } = nearestOn(p, b.outer);
      if (d < dmin || d > dmax || pin(p, b.outer) || others.some(o => pin(p, o.outer))) continue;
      const cen = b.outer.reduce((a, v) => [a[0] + v[0] / b.outer.length, a[1] + v[1] / b.outer.length], [0, 0]);
      const tgt: Pt = [q[0] + (cen[0] - q[0]) * 0.25, q[1] + (cen[1] - q[1]) * 0.25];
      let blocked = 0;
      for (let t = 0.05; t < 0.95; t += 0.05) {
        const s: Pt = [p[0] + (tgt[0] - p[0]) * t, p[1] + (tgt[1] - p[1]) * t];
        if (others.some(o => pin(s, o.outer))) blocked += 2;
      }
      const score = -blocked - Math.abs(d - (dmin + dmax) / 2) * 0.08 + (['footway', 'pedestrian'].includes(r.cls) ? 0.5 : 0);
      if (!best || score > best.score) best = { p, q: tgt, score };
    }
    if (!best) return name + ': no viewpoint';
    const H = (x: number, y: number) => c.terrain.heightAt(x, y);
    const gy = H(best.q[0], best.q[1]);
    await h.capture('_tmp', new T(best.p[0], H(best.p[0], best.p[1]) + 1.7, -best.p[1]), new T(best.q[0], gy + Math.min(b.h * 0.45, 9), -best.q[1]));
    const load = (src: string) => new Promise<HTMLImageElement | null>(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
    const [game, ref] = await Promise.all([load('/data/preview/_tmp.png?' + Math.random()), load('/data/refs/' + refFile)]);
    const cv = document.createElement('canvas');
    cv.width = 1600; cv.height = 560;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#111'; g.fillRect(0, 0, 1600, 560);
    if (ref) { const sc = Math.min(790 / ref.width, 520 / ref.height); g.drawImage(ref, 5 + (790 - ref.width * sc) / 2, 5 + (520 - ref.height * sc) / 2, ref.width * sc, ref.height * sc); }
    if (game) g.drawImage(game, 805, 5 + (520 - 790 / 1.6) / 2, 790, 790 / 1.6);
    g.fillStyle = '#ff0'; g.font = '18px sans-serif';
    g.fillText('Reference: ' + refFile, 10, 548); g.fillText('Game: ' + name, 810, 548);
    const slug = 'cmp_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    await fetch('/__capture?name=' + slug, { method: 'POST', body: cv.toDataURL('image/png') });
    return slug;
  };
  /**
   * Flicker check: renders the view twice with the camera moved 2 cm sideways
   * (foliage sway frozen) and counts 16x16 blocks where most pixels change
   * strongly. Edges only change along thin lines, so flagged blocks are
   * z-fighting or shimmering surfaces. Saves data/preview/<name>_flick.png
   * with the blocks in red. eye/look: [map x, map y, height above ground].
   */
  const flicker = async (name: string, eye: [number, number, number], look: [number, number, number]) => {
    const sim = (window as unknown as { __sim: { freezeFoliage: number | null } }).__sim;
    sim.freezeFoliage = 10;
    const H = (p: number[]) => c.terrain.heightAt(p[0], p[1]) + p[2];
    const E = new T(eye[0], H(eye), -eye[1]), L = new T(look[0], H(look), -look[1]);
    const d = L.clone().sub(E).normalize(), side = new T(-d.z, 0, d.x).normalize().multiplyScalar(0.02);
    await h.capture(name + '_a', E, L);
    await h.capture(name + '_b', E.clone().add(side), L.clone().add(side));
    sim.freezeFoliage = null;
    const load = (src: string) => new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = src + '?' + Math.random(); });
    const [a, b] = await Promise.all([load('/data/preview/' + name + '_a.png'), load('/data/preview/' + name + '_b.png')]);
    const cv = document.createElement('canvas');
    cv.width = 1280; cv.height = 800;
    const g = cv.getContext('2d')!;
    g.drawImage(a, 0, 0); const A = g.getImageData(0, 0, 1280, 800).data;
    g.drawImage(b, 0, 0); const B = g.getImageData(0, 0, 1280, 800).data;
    const out = g.createImageData(1280, 800);
    let blocks = 0;
    for (let by = 0; by < 50; by++) for (let bx = 0; bx < 80; bx++) {
      let n = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const i = ((by * 16 + y) * 1280 + bx * 16 + x) * 4;
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) n++;
      }
      if (n > 110) {
        blocks++;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = ((by * 16 + y) * 1280 + bx * 16 + x) * 4; out.data[i] = 255; out.data[i + 3] = 255; }
      }
    }
    for (let i = 0; i < A.length; i += 4) if (!out.data[i + 3]) { out.data[i] = A[i] / 2; out.data[i + 1] = A[i + 1] / 2; out.data[i + 2] = A[i + 2] / 2; out.data[i + 3] = 255; }
    g.putImageData(out, 0, 0);
    await fetch('/__capture?name=' + name + '_flick', { method: 'POST', body: cv.toDataURL('image/png') });
    return blocks;
  };
  /**
   * Oblique view of a building: from compass bearing `az` (degrees clockwise from north,
   * the side the camera stands on), `dist` metres from its centre, `up` metres above ground.
   */
  const orbit = async (name: string, az: number, dist = 70, up = 22, shot = 'orbit', at?: Pt) => {
    const b = c.data.buildings.find(x => x.name === name);
    if (!b) return name + ': missing';
    const cen = at ?? b.outer.reduce((a, v) => [a[0] + v[0] / b.outer.length, a[1] + v[1] / b.outer.length], [0, 0]);
    const r = az * Math.PI / 180, ex = cen[0] + Math.sin(r) * dist, ey = cen[1] + Math.cos(r) * dist;
    const gy = c.terrain.heightAt(cen[0], cen[1]);
    return h.capture(shot, new T(ex, gy + up, -ey), new T(cen[0], gy + Math.min(b.h * 0.4, 8), -cen[1]));
  };
  /**
   * Gameplay view: puts the cart on the way segment nearest map point t (optionally only
   * ways of the given classes, optionally facing the other way) and captures the chase
   * camera's view of it. Returns the cart position.
   */
  const chase = async (name: string, t: Pt, cls: string[] | null = null, flip = false) => {
    let best: { d: number; m: Pt; u: Pt } | null = null;
    for (const r of c.data.roads) {
      if (cls && !cls.includes(r.cls)) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 3) continue;
        const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = Math.hypot(m[0] - t[0], m[1] - t[1]);
        if (!best || d < best.d) best = { d, m, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
      }
    }
    if (!best) return null;
    h.place(best.m, flip ? [-best.u[0], -best.u[1]] : best.u, 0);
    h.sim(0.5);
    await h.captureCart(name, [0, 2.4, -6.2], [0, 1.3, 10]);
    return best.m;
  };
  /**
   * Full-frame cost at w x h from the current camera, synchronised with the GPU: the shadow
   * pass plus either the post chain (`post`) or a plain render. Restores the canvas size.
   */
  const frame = (w = 1920, hh = 1080, n = 8, post = true, shadow = true) => {
    const gl = c.renderer.getContext(), px = new Uint8Array(4);
    const size = c.renderer.getSize(new THREE.Vector2()), pr = c.renderer.getPixelRatio(), aspect = c.camera.aspect;
    c.renderer.setPixelRatio(1); c.renderer.setSize(w, hh, false);
    c.camera.aspect = w / hh; c.camera.updateProjectionMatrix();
    let calls = 0, tris = 0;
    const one = () => {
      c.renderer.info.reset();
      c.renderer.shadowMap.needsUpdate = shadow;
      if (!post || !c.post?.(w, hh)) c.renderer.render(c.scene, c.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      calls = c.renderer.info.render.calls; tris = c.renderer.info.render.triangles;
    };
    one(); one();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) one();
    const ms = (performance.now() - t0) / n;
    c.renderer.setPixelRatio(pr); c.renderer.setSize(size.x, size.y, false);
    c.camera.aspect = aspect; c.camera.updateProjectionMatrix();
    return { ms: +ms.toFixed(1), calls, ktris: Math.round(tris / 1000) };
  };
  /**
   * Runs the real game loop (input, physics, camera, streaming, render) for `secs` at `fps`
   * on a made-up clock. For checks while the page is in the background, where the browser
   * does not run animation frames at all.
   */
  let clock = performance.now();
  const pump = (secs: number, fps = 60) => {
    const n = Math.round(secs * fps);
    for (let i = 0; i < n; i++) c.frame?.(clock += 1000 / fps);
    return n;
  };
  const hx = Object.assign(h, { measure, profile, compare, flicker, orbit, chase, frame, pump });
  (window as unknown as { __h: typeof hx }).__h = hx;
}
