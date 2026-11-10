// UEMR campus EMS cart. Geometry comes from public/models/uemr_cart.glb, built
// by blender/build_cart.py from photos of the cart (The Retrograde, 2026-08-21,
// and the user's 2026 front, rear and side photos). This module paints the
// livery (front cowl, rear fenders, windshield banner) as textures, gives the
// seats a quilted vinyl texture, clones the wheel onto the four hubs and
// creates the lights.
// Local frame: +z forward, +x left (driver side), +y up, ground at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { blobGeometry, occlusionMaterial } from '../world/occlusion.ts';
import type { GolfCartConfig } from './config.ts';

export interface CartModel {
  root: THREE.Group;
  contactShadow: THREE.Mesh;
  wheels: THREE.Group[]; // FL, FR, RL, RR; each holds a 'spin' child
  /** Rear roof heads and post strips. */
  redLeds: THREE.MeshStandardMaterial;
  blueLeds: THREE.MeshStandardMaterial;
  /** Dual-color heads (roof front and bumper, cart's right side): red, then blue. */
  rbLeds: THREE.MeshStandardMaterial;
  whiteLeds: THREE.MeshStandardMaterial;
  sideLeds: THREE.MeshStandardMaterial;
  /**
   * Every emergency LED head with its own material and an additive glow sprite:
   * driver's side (x > 0, the cart frame's left) red, passenger side blue, as on
   * US emergency vehicles; `zone` front / side / rear.
   */
  leds: { mat: THREE.MeshStandardMaterial; glow: THREE.Sprite; red: boolean; zone: 'front' | 'side' | 'rear' }[];
  headlightMat: THREE.MeshStandardMaterial;
  brakeMat: THREE.MeshStandardMaterial;
  /** Light cast by the front dual-color heads; its color follows the flash phase. */
  frontLight: THREE.PointLight;
  rearLight: THREE.PointLight;
  headlight: THREE.SpotLight;
  steeringWheel?: THREE.Object3D;
  steeringRest?: THREE.Quaternion;
  /** Driver eye point in cart-local coordinates. */
  driverEye: THREE.Vector3;
}

const GREEN = '#0f7a3e', ORANGE = '#e8702a', BLUE = '#1d4fa3';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, transparent = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  if (!transparent) { g.fillStyle = '#f1f2ef'; g.fillRect(0, 0, w, h); }
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // glTF UVs have their origin at the top left
  return t;
}

/** UEMR seal: green ring with lettering, orange inner ring, Star of Life, "CAMPUS EMS" banner. */
function drawSeal(g: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  g.fillStyle = GREEN;
  g.beginPath(); g.moveTo(cx - R * 1.25, cy + R * 0.55); g.lineTo(cx + R * 1.25, cy + R * 0.55); g.lineTo(cx + R * 1.05, cy + R * 1.15); g.lineTo(cx - R * 1.05, cy + R * 1.15); g.closePath(); g.fill();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f7f4ea'; g.beginPath(); g.arc(cx, cy, R * 0.74, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ORANGE; g.lineWidth = R * 0.07; g.beginPath(); g.arc(cx, cy, R * 0.78, 0, Math.PI * 2); g.stroke();
  const arcText = (text: string, start: number, end: number, flip: boolean) => {
    g.save();
    g.fillStyle = '#ffffff';
    g.font = `bold ${Math.round(R * 0.16)}px Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < text.length; i++) {
      const a = start + (end - start) * (i + 0.5) / text.length;
      g.save();
      g.translate(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88);
      g.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
      g.fillText(text[i], 0, 0);
      g.restore();
    }
    g.restore();
  };
  arcText('UNIVERSITY EMERGENCY', Math.PI * 1.12, Math.PI * 1.88, false);
  arcText('MEDICAL RESPONSE', Math.PI * 0.78, Math.PI * 0.22, true);
  g.fillStyle = '#ffffff';
  g.font = `bold ${Math.round(R * 0.26)}px Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CAMPUS EMS', cx, cy + R * 0.86);
  g.save();
  g.translate(cx, cy - R * 0.05);
  g.fillStyle = BLUE;
  const s = R / 100;
  for (let i = 0; i < 3; i++) { g.save(); g.rotate(i * Math.PI / 3); g.fillRect(-12 * s, -44 * s, 24 * s, 88 * s); g.restore(); }
  g.fillStyle = '#ffffff';
  g.fillRect(-2.5 * s, -36 * s, 5 * s, 72 * s);
  g.lineWidth = 3 * s; g.strokeStyle = '#ffffff';
  g.beginPath();
  for (let t = 0; t <= 1; t += 0.05) { const y = -28 * s + t * 56 * s, x = Math.sin(t * Math.PI * 3) * 8 * s; t ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.restore();
}

function drawUtd(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.save();
  g.fillStyle = ORANGE;
  g.font = `bold ${size}px Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('UTD', x, y);
  g.restore();
}

/**
 * Front-cowl livery in the cowl's front-projected UVs: u = (x + 0.6) / 1.2,
 * v = (y - 0.55) / 0.5, 1 px = 1 mm, seen from the front (image left = cart's right).
 */
export function frontLivery() {
  const W = 1200, H = 500;
  const X = (x: number) => (x + 0.6) * 1000, Y = (y: number) => H - (y - 0.55) * 1000;
  return canvasTexture(W, H, g => {
    // Stripes rising from the headlight pods, leaning outward: orange inboard, green outboard.
    const band = (s: number, x0: number, x1: number, w: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(X(s * x0), Y(0.78)); g.lineTo(X(s * (x0 + w)), Y(0.78));
      g.lineTo(X(s * (x1 + w)), Y(1.02)); g.lineTo(X(s * x1), Y(1.02));
      g.closePath(); g.fill();
    };
    for (const s of [-1, 1]) {
      band(s, 0.165, 0.215, 0.026, ORANGE);
      band(s, 0.205, 0.262, 0.048, GREEN);
      drawUtd(g, X(s * 0.47), Y(0.86), 34);
    }
    drawSeal(g, X(0), Y(0.885), 82);
    g.fillStyle = GREEN;
    g.textAlign = 'center';
    g.font = 'bold 26px Georgia, serif';
    g.fillText('EMERGENCY', X(0), Y(0.758));
    g.font = 'bold 32px Georgia, serif';
    g.fillText('972 883 2222', X(0), Y(0.722));
  });
}

/** Rear-fender livery: u runs front to back along each side (0.86 m), v = (y - 0.58) / 0.22. */
export function rearLivery() {
  const W = 860, H = 220;
  const U = (u: number) => u * W, Y = (y: number) => H - (y - 0.58) * 1000;
  return canvasTexture(W, H, g => {
    g.fillStyle = GREEN; g.fillRect(U(0.04), Y(0.69), U(0.7), 9);
    g.fillStyle = ORANGE; g.fillRect(U(0.04), Y(0.675), U(0.7), 24);
    g.fillStyle = '#16301f';
    g.textAlign = 'center';
    g.font = 'bold 22px Georgia, serif';
    g.fillText('EMERGENCY', U(0.33), Y(0.765));
    g.font = 'bold 28px Georgia, serif';
    g.fillText('972 883 2222', U(0.33), Y(0.735));
    drawSeal(g, U(0.8), Y(0.745), 30);
    drawUtd(g, U(0.84), Y(0.66), 30);
  });
}

/** Windshield banner, white letters on clear glass, readable from the front. */
export function windshieldBanner() {
  return canvasTexture(1000, 70, g => {
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = 'bold 46px Georgia, serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left'; g.fillText('UNIVERSITY EMS', 150, 38);
    g.textAlign = 'right'; g.fillText('DIAL 911', 870, 38);
  }, true);
}

/** Diamond-quilted black vinyl with stitch lines; tiles every 0.12 m. */
function vinylTexture() {
  const t = canvasTexture(128, 128, g => {
    g.fillStyle = '#2a2b2e'; g.fillRect(0, 0, 128, 128);
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 70);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 64); g.lineTo(64, 0); g.lineTo(128, 64); g.lineTo(64, 128); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(160,160,160,0.25)'; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(4, 64); g.lineTo(64, 4); g.lineTo(124, 64); g.lineTo(64, 124); g.closePath(); g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Box-projected UVs (meters / tile) for meshes exported without UVs. */
function boxUV(geo: THREE.BufferGeometry, tile: number) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [pos.getZ(i), pos.getY(i)] : ay >= az ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function isUnder(o: THREE.Object3D, anc: THREE.Object3D) {
  for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === anc) return true;
  return false;
}

/**
 * Replaces the meshes under `root` accepted by `keep` with one mesh per material, in
 * root-local space (shadow flags carried over). Groups whose geometries cannot be
 * merged (different attribute sets) are left as they are.
 */
function mergeByMaterial(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !keep(m)) return;
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material)!.push(m);
  });
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = list.some(m => m.castShadow);
    out.receiveShadow = list.some(m => m.receiveShadow);
    out.renderOrder = list[0].renderOrder;
    for (const m of list) m.removeFromParent();
    root.add(out);
  }
}

export async function loadCartModel(c: GolfCartConfig, url = 'models/uemr_cart.glb'): Promise<CartModel> {
  void c;
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  const root = new THREE.Group();
  root.name = 'uemr-cart';
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  let wheelTemplate: THREE.Object3D | undefined;
  let steeringWheel: THREE.Object3D | undefined;
  const vinyl = vinylTexture();
  scene.traverse(o => {
    if (o.name === 'Wheel') wheelTemplate = o;
    if (o.name === 'SteeringWheel') steeringWheel = o;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    mats.set(m.name, m);
    const see = m.name === 'Glass' || m.name === 'WindshieldDecal';
    mesh.castShadow = !see;
    mesh.receiveShadow = !see;
    if (m.name === 'Seat_Vinyl') { boxUV(mesh.geometry, 0.12); m.map = vinyl; m.color.set(0xffffff); }
  });
  // Painted body panels: a glossy clear-coated finish over the white (the plain material
  // read as matte plastic); rubber and machined metal tuned to read at chase distance.
  const physical = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (['Body_White', 'Cowl', 'RearBody'].includes(m.name)) {
      if (!physical.has(m)) {
        const p = new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, map: m.map, roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
        physical.set(m, p);
        mats.set(m.name, p as unknown as THREE.MeshStandardMaterial);
      }
      mesh.material = physical.get(m)!;
    }
    if (m.name === 'Tire') { m.color.setRGB(0.028, 0.028, 0.03); m.roughness = 0.92; m.envMapIntensity = 0.3; }
    if (m.name === 'Rim_Machined' || m.name === 'Steel') { m.metalness = 0.9; m.roughness = 0.22; }
    if (m.name === 'Frame') { m.roughness = 0.38; }
    if (m.name === 'Seat_Vinyl') { m.roughness = 0.38; }
  });
  if (!wheelTemplate) throw new Error('cart model has no Wheel node');
  wheelTemplate.removeFromParent();
  root.add(scene);

  const get = (n: string) => {
    const m = mats.get(n);
    if (!m) throw new Error(`cart model is missing material ${n}`);
    return m;
  };
  const paint = (n: string, t: THREE.Texture) => { const m = get(n); m.map = t; m.color.set(0xffffff); m.needsUpdate = true; };
  paint('Cowl', frontLivery());
  paint('RearBody', rearLivery());
  const banner = get('WindshieldDecal');
  banner.map = windshieldBanner(); banner.color.set(0xffffff); banner.transparent = true; banner.alphaTest = 0.3; banner.depthWrite = false; banner.side = THREE.FrontSide; // printed on the outside; from the seat it was mirrored
  // Clear polycarbonate: faint tint, sharp reflections, no depth so the cabin stays visible.
  const glass = get('Glass');
  glass.transparent = true; glass.opacity = 0.07; glass.roughness = 0.02; glass.depthWrite = false; glass.side = THREE.FrontSide; glass.envMapIntensity = 0.6; // inside face reflected the sky as a haze

  const redLeds = get('LED_Red'), blueLeds = mats.get('LED_Blue') ?? new THREE.MeshStandardMaterial(), rbLeds = get('LED_RB'), whiteLeds = get('LED_White'), sideLeds = get('LED_Side');
  for (const m of [redLeds, blueLeds, rbLeds, whiteLeds, sideLeds]) m.toneMapped = false;
  const headlightMat = get('Headlight'), brakeMat = get('Brake');

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    spin.name = 'spin';
    const w = wheelTemplate.clone();
    w.position.set(0, 0, 0);
    // The template's rim faces +x (left); mirror the right-hand wheels so rims face out.
    if (i % 2 === 1) w.rotation.y = Math.PI;
    spin.add(w);
    g.add(spin);
    root.add(g);
    wheels.push(g);
  }
  wheels.forEach(g => g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }));

  // Draw calls: the body arrives as ~100 meshes; merge the static ones per material
  // (everything except the LED heads, which get per-head materials below, and the
  // steering wheel, which turns). Each wheel's parts merge the same way.
  mergeByMaterial(scene, o => !(steeringWheel && isUnder(o, steeringWheel)) && !/^LED_/.test(((o as THREE.Mesh).material as THREE.Material).name));
  for (const g of wheels) mergeByMaterial(g.getObjectByName('spin')!, () => true);

  // Per-head LED materials and glow sprites (see CartModel.leds).
  const leds: CartModel['leds'] = [];
  const glowTex = glowTexture();
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const ledMeshes: THREE.Mesh[] = [];
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && /^LED_/.test((m.material as THREE.Material).name)) ledMeshes.push(m); });
  for (const m of ledMeshes) {
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
    const red = c.x > 0;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.color.set(red ? 0x3a0606 : 0x060a3a);
    mat.emissive.set(red ? 0xff1a10 : 0x1a3cff);
    mat.emissiveIntensity = 0;
    mat.toneMapped = false;
    m.material = mat;
    const zone = (m.material.name === 'LED_Side' ? 'side' : c.z > 0 ? 'front' : 'rear') as 'front' | 'side' | 'rear';
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: red ? 0xff2a1a : 0x2a50ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    glow.position.copy(c);
    glow.scale.setScalar(zone === 'side' ? 0.35 : 0.9);
    glow.visible = false;
    root.add(glow);
    leds.push({ mat, glow, red, zone });
  }

  // Shadow pass: the body's ~45 parts cast as one merged silhouette on the layer only the
  // sun's shadow camera draws, instead of one shadow draw call each. Of each wheel, the tyre casts.
  {
    const casters: THREE.Mesh[] = [];
    scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.castShadow) casters.push(m); });
    const parts = casters.map(m => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry).attributes.position.clone());
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    });
    const merged = parts.length ? mergeGeometries(parts) : null;
    if (merged) {
      const proxy = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      proxy.name = 'ShadowProxy';
      proxy.castShadow = true;
      proxy.layers.set(1);
      root.add(proxy);
      for (const m of casters) m.castShadow = false;
    }
    for (const g of wheels) g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name !== 'Tire') m.castShadow = false; });
  }

  const frontLight = new THREE.PointLight(0xff2020, 0, 20, 2);
  frontLight.position.set(-0.3, 2.05, 0.6);
  const rearLight = new THREE.PointLight(0xff2020, 0, 16, 2);
  rearLight.position.set(0, 2.05, -1.25);
  root.add(frontLight, rearLight);
  // Low beam: wide enough to show parked cars and curbs either side of the lane, reaching about 60 m.
  const headlight = new THREE.SpotLight(0xfff4dd, 0, 70, 0.75, 0.45, 1.2);
  headlight.position.set(0, 0.72, 1.3);
  headlight.target.position.set(0, 0, 14);
  root.add(headlight, headlight.target);
  // Soft contact shadow under the cart; its height is set from the wheels each frame.
  const contactShadow = new THREE.Mesh(blobGeometry(0.62, 1.3, 0.3), occlusionMaterial());
  contactShadow.renderOrder = 10;
  root.add(contactShadow);

  return {
    root, contactShadow, leds, wheels, redLeds, blueLeds, rbLeds, whiteLeds, sideLeds, headlightMat, brakeMat, frontLight, rearLight, headlight,
    steeringWheel, steeringRest: steeringWheel?.quaternion.clone(),
    driverEye: new THREE.Vector3(0.27, 1.5, -0.04),
  };
}

/** Soft round glow for LED sprites. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
