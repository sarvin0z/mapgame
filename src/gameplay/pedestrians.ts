// People for Route Challenge runs: pedestrians walking alone or side by side in
// groups of two or three, skateboarders, and cyclists, each at their own pace
// and on their own kind of path (walkers and skaters on walks, cyclists on
// cycleways, walks and quiet service roads, keeping right). They step aside
// when the horn or siren sounds as the cart approaches, flinch away at the
// last moment otherwise, and a contact is reported to the run. Drawn with a
// few instanced meshes (legs, torso, head, hair, bicycle, wheels, skateboard).
import * as THREE from 'three';
import type { CampusData, Pt } from '../world/campusData.ts';
import type { Terrain } from '../world/terrain.ts';

type Mode = 'walk' | 'skate' | 'bike';

interface Walker {
  mode: Mode;
  way: Pt[]; len: number; s: number; dir: 1 | -1; speed: number; lane: number;
  dodge: number; dodgeT: number; target: number; hitCooldown: number; phase: number;
  shirt: THREE.Color; pants: THREE.Color; skin: THREE.Color; hair: THREE.Color; gear: THREE.Color;
}

const SHIRTS = [0xe87500, 0x154734, 0x2b4c7e, 0xf2f2f2, 0x1d1d1f, 0x8a1c2b, 0x6d7f8c, 0xd8c39a, 0x3f6e4d, 0x9b5de5];
const PANTS = [0x22252b, 0x2d3e5c, 0x6b6257, 0x1a1a1a, 0x8d8475];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa86f4c];
const HAIR = [0x1b1410, 0x3b2a1d, 0x6a4e35, 0x0e0e0e, 0xb08d57];
const GEAR = [0x1f6fb2, 0xc23b22, 0x1d1d1f, 0x3c8d40, 0xe2b13c, 0xdedede];

/** Speed range (m/s) per mode: a stroll, a cruising skateboard, an easy bike ride. */
const SPEED: Record<Mode, [number, number]> = { walk: [1.1, 1.5], skate: [2.6, 4.2], bike: [3.8, 6.5] };
/** Height of the rider's hips above the ground, per mode. */
const LIFT: Record<Mode, number> = { walk: 0, skate: 0.12, bike: 0.12 };

export class Pedestrians {
  readonly group = new THREE.Group();
  private walkers: Walker[] = [];
  private walks: Pt[][];
  private rides: Pt[][];
  private legs: THREE.InstancedMesh;
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private hair: THREE.InstancedMesh;
  private bike: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private board: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private sc = new THREE.Vector3(1, 1, 1);
  private static readonly Y = new THREE.Vector3(0, 1, 0);
  private static readonly X = new THREE.Vector3(1, 0, 0);
  active = false;

  constructor(data: CampusData, private terrain: Terrain, private count = 80) {
    // Walks long enough to stroll along: footways, pedestrian streets and paths over 30 m.
    this.walks = data.roads.filter(r => ['footway', 'pedestrian', 'path'].includes(r.cls) && r.fw !== 'crossing' && r.fw !== 'access_aisle')
      .map(r => r.pts).filter(p => len(p) > 30);
    // Cyclists also use cycleways and quiet service roads (not parking aisles).
    this.rides = data.roads.filter(r => r.cls === 'cycleway' || (r.cls === 'service' && r.svc !== 'parking_aisle'))
      .map(r => r.pts).filter(p => len(p) > 40).concat(this.walks);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const legGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.86, 6).translate(0, -0.43, 0); // pivot at hip
    const torsoGeo = new THREE.CapsuleGeometry(0.19, 0.42, 4, 8).scale(1, 1, 0.7).translate(0, 1.18, 0);
    const headGeo = new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.6, 0);
    const hairGeo = new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.63, -0.01);
    // Bicycle frame along local -z (forward): top tube, down tube, seat post, bars; wheels separate.
    const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
      const l = a.distanceTo(b), g = new THREE.CylinderGeometry(0.022, 0.022, l, 5).translate(0, l / 2, 0);
      return g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Pedestrians.Y, b.clone().sub(a).normalize())).translate(a.x, a.y, a.z).toNonIndexed();
    };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const frameParts = [tube(V(0, 0.34, 0.5), V(0, 0.55, 0.05)), tube(V(0, 0.55, 0.05), V(0, 0.85, 0.15)), tube(V(0, 0.82, 0.15), V(0, 0.8, -0.5)),
      tube(V(0, 0.55, 0.05), V(0, 0.8, -0.5)), tube(V(0, 0.34, -0.55), V(0, 0.95, -0.5)), tube(V(-0.25, 0.97, -0.48), V(0.25, 0.97, -0.48)),
      new THREE.BoxGeometry(0.12, 0.04, 0.24).translate(0, 0.88, 0.17).toNonIndexed()];
    const frameGeo = mergeAll(frameParts);
    const wheelGeo = new THREE.TorusGeometry(0.33, 0.03, 6, 18).rotateY(Math.PI / 2);
    const boardGeo = mergeAll([new THREE.BoxGeometry(0.22, 0.03, 0.82).translate(0, 0.1, 0).toNonIndexed(),
      ...[-0.28, 0.28].map(z => new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6).rotateZ(Math.PI / 2).translate(0, 0.04, z).toNonIndexed())]);
    this.legs = new THREE.InstancedMesh(legGeo, mat, count * 2);
    this.torso = new THREE.InstancedMesh(torsoGeo, mat, count);
    this.head = new THREE.InstancedMesh(headGeo, mat, count);
    this.hair = new THREE.InstancedMesh(hairGeo, mat, count);
    this.bike = new THREE.InstancedMesh(frameGeo, mat, count);
    this.wheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }), count * 2);
    this.board = new THREE.InstancedMesh(boardGeo, mat, count);
    for (const im of [this.legs, this.torso, this.head, this.hair, this.bike, this.wheels, this.board]) { im.castShadow = true; im.frustumCulled = false; im.count = 0; this.group.add(im); }
    this.group.visible = false;
  }

  /** Populates walks within `radius` of `center` (map coordinates). */
  start(center: Pt, radius = 220) {
    this.walkers = [];
    for (let tries = 0; tries < 200 && this.walkers.length < this.count; tries++) this.walkers.push(...this.spawn(center, radius, 40, this.count - this.walkers.length));
    this.active = true;
    this.group.visible = true;
  }

  stop() { this.active = false; this.group.visible = false; this.walkers = []; }

  /**
   * One party: a cyclist (15 %), a skateboarder (10 %), or one to three people walking
   * side by side at a shared pace (pairs and threes about a third of the time).
   */
  private spawn(center: Pt, radius: number, minDist: number, room: number): Walker[] {
    const r = Math.random();
    const mode: Mode = r < 0.15 && this.rides.length ? 'bike' : r < 0.25 ? 'skate' : 'walk';
    const size = mode !== 'walk' ? 1 : Math.min(room, Math.random() < 0.65 ? 1 : Math.random() < 0.6 ? 2 : 3);
    const ways = mode === 'bike' ? this.rides : this.walks;
    if (!ways.length || size < 1) return [];
    for (let t = 0; t < 40; t++) {
      const way = ways[Math.floor(Math.random() * ways.length)];
      const L = len(way), s = Math.random() * L, p = at(way, s).p;
      const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
      if (d > radius || d < minDist) continue;
      const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const [v0, v1] = SPEED[mode], speed = v0 + Math.random() * (v1 - v0);
      // Riders keep right of the way's centre line; a group walks abreast, 0.65 m apart.
      const base = mode === 'walk' ? (Math.random() - 0.5) * 0.6 : -dir * (0.5 + Math.random() * 0.6);
      return Array.from({ length: size }, (_, k) => ({
        mode, way, len: L, s, dir, speed, lane: base + (k - (size - 1) / 2) * 0.65,
        dodge: 0, dodgeT: 0, target: 0, hitCooldown: 0, phase: Math.random() * 6,
        shirt: new THREE.Color(pick(SHIRTS)), pants: new THREE.Color(pick(PANTS)), skin: new THREE.Color(pick(SKIN)), hair: new THREE.Color(pick(HAIR)), gear: new THREE.Color(pick(GEAR)),
      }));
    }
    return [];
  }

  /**
   * Steps everyone. `cart` is the cart's map position, `fwd` its map heading,
   * `warn` true while the horn or siren sounds. Returns how many people were touched.
   */
  update(dt: number, cart: Pt, fwd: Pt, speed: number, warn: boolean): number {
    if (!this.active) return 0;
    let hits = 0;
    // Recycle parties far from the cart onto ways nearer to it (a whole group at a time).
    for (let i = 0; i < this.walkers.length;) {
      const w = this.walkers[i], here = at(w.way, w.s).p;
      let n = 1;
      while (i + n < this.walkers.length && this.walkers[i + n].way === w.way && this.walkers[i + n].s === w.s) n++;
      if (Math.hypot(here[0] - cart[0], here[1] - cart[1]) > 260) {
        const g = this.spawn(cart, 220, 60, n);
        if (g.length) this.walkers.splice(i, n, ...g);
        i += g.length || n;
      } else i += n;
    }
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      const { p, u } = at(w.way, w.s);
      const n: Pt = [-u[1], u[0]];
      const pos: Pt = [p[0] + n[0] * (w.lane + w.dodge), p[1] + n[1] * (w.lane + w.dodge)];
      // Relation to the cart, in the cart's frame.
      const rx = pos[0] - cart[0], ry = pos[1] - cart[1];
      const ahead = rx * fwd[0] + ry * fwd[1], side = rx * fwd[1] - ry * fwd[0];
      const approaching = ahead > -1 && Math.abs(side) < 3.5 && speed > 1;
      // Warned people clear the path quickly; unwarned ones only flinch at the last moment.
      const trigger = (warn && approaching && ahead < 28) || (approaching && ahead < 2.2 && speed > 2.5);
      if (trigger && w.dodgeT <= 0) {
        // Move to whichever side of the way is further from the cart's path.
        const away = Math.sign((side >= 0 ? 1 : -1) * (n[0] * fwd[1] - n[1] * fwd[0]) || 1);
        w.dodgeT = warn ? 4 : 2;
        w.dodge = 0;
        w.target = away * (warn ? 3.2 : 1.8);
      }
      const target = w.dodgeT > 0 ? w.target : 0;
      const rate = w.dodgeT > 0 ? (warn ? 4.5 : 2.2) : 1;
      w.dodge += Math.max(-rate * dt, Math.min(rate * dt, target - w.dodge));
      w.dodgeT -= dt;
      // Walkers pause while stepping aside; riders slow down.
      const moving = w.dodgeT > 0 ? (w.mode === 'walk' ? 0.3 : 0.5) : 1;
      w.s += w.dir * w.speed * moving * dt;
      if (w.s < 0 || w.s > w.len) { w.dir = (w.dir === 1 ? -1 : 1); w.s = Math.max(0, Math.min(w.len, w.s)); if (w.mode !== 'walk') w.lane = -w.lane; }
      w.phase += dt * (w.mode === 'walk' ? w.speed * 4.2 : w.mode === 'bike' ? w.speed * 1.6 : 2.2) * moving;
      w.hitCooldown -= dt;
      if (Math.abs(side) < 0.8 && ahead > -1.4 && ahead < 1.6 && speed > 0.8 && w.hitCooldown <= 0) {
        hits++;
        w.hitCooldown = 3;
        w.dodgeT = 2; w.target = (side >= 0 ? 1 : -1) * 2.5;
      }
      this.pose(i, w, pos, u);
    }
    const n = this.walkers.length;
    for (const im of [this.torso, this.head, this.hair, this.bike, this.board]) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    for (const im of [this.legs, this.wheels]) { im.count = n * 2; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    return hits;
  }

  /** Writes instance k of `im` at world position p with rotation q (or hides it far below). */
  private put(im: THREE.InstancedMesh, k: number, p: THREE.Vector3 | null, q: THREE.Quaternion, color?: THREE.Color) {
    if (p) this.m.compose(p, q, this.sc); else this.m.makeScale(0, 0, 0);
    im.setMatrixAt(k, this.m);
    if (color) im.setColorAt(k, color);
  }

  private pose(i: number, w: Walker, pos: Pt, u: Pt) {
    const y = this.terrain.heightAt(pos[0], pos[1]);
    const facing: Pt = w.dir === 1 ? u : [-u[0], -u[1]];
    const yaw = Math.atan2(facing[0], -facing[1]) + Math.PI;
    const lift = LIFT[w.mode];
    const bob = w.mode === 'walk' ? Math.abs(Math.sin(w.phase)) * 0.035 : 0;
    const body = this.q.setFromAxisAngle(Pedestrians.Y, yaw);
    // Riders lean a little forward (cyclists more).
    if (w.mode !== 'walk') body.multiply(this.q2.setFromAxisAngle(Pedestrians.X, w.mode === 'bike' ? 0.35 : 0.08));
    const at = this.v.set(pos[0], y + lift + bob, -pos[1]);
    this.put(this.torso, i, at, body, w.shirt);
    this.put(this.head, i, at, body, w.skin);
    this.put(this.hair, i, at, body, w.hair);
    const ground = this.v2.set(pos[0], y, -pos[1]);
    const flat = new THREE.Quaternion().setFromAxisAngle(Pedestrians.Y, yaw);
    this.put(this.bike, i, w.mode === 'bike' ? ground : null, flat, w.gear);
    this.put(this.board, i, w.mode === 'skate' ? ground : null, flat, w.gear);
    for (const k of [0, 1]) {
      const wp = w.mode === 'bike' ? new THREE.Vector3(0, 0.34, k ? -0.55 : 0.5).applyQuaternion(flat).add(ground) : null;
      this.put(this.wheels, i * 2 + k, wp, flat.clone().multiply(this.q2.setFromAxisAngle(Pedestrians.X, w.phase)));
    }
    // Legs about the hip: walking swing, pedalling circles, or a skater's stance with an occasional push.
    for (const k of [0, 1]) {
      const swing = w.mode === 'walk' ? Math.sin(w.phase + k * Math.PI) * 0.45
        : w.mode === 'bike' ? 0.3 + Math.sin(w.phase + k * Math.PI) * 0.35
        : (k === 1 ? Math.max(0, Math.sin(w.phase)) * 0.5 : 0);
      const legQ = flat.clone().multiply(this.q2.setFromAxisAngle(Pedestrians.X, swing));
      const off = w.mode === 'skate' ? (k ? 0.18 : -0.18) : (k ? 0.1 : -0.1);
      const hipH = w.mode === 'bike' ? 0.98 : 0.92;
      const hip = new THREE.Vector3(off, hipH + bob, 0).applyAxisAngle(Pedestrians.Y, yaw).add(this.v.set(pos[0], y + lift, -pos[1]));
      this.put(this.legs, i * 2 + k, hip, legQ, w.pants);
    }
  }
}

function mergeAll(gs: THREE.BufferGeometry[]) {
  const pos: number[] = [], nrm: number[] = [];
  for (const g of gs) { pos.push(...(g.attributes.position.array as Float32Array)); nrm.push(...(g.attributes.normal.array as Float32Array)); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

function len(p: Pt[]) { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; }
function at(p: Pt[], s: number): { p: Pt; u: Pt } {
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= s || i === p.length - 1) {
      const t = l ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], u: l ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [0, 1] };
    }
    acc += l;
  }
  return { p: p[0], u: [0, 1] };
}
