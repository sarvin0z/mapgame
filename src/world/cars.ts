// Loads public/models/cars.glb (blender/build_cars.py) and flattens each car
// into one merged geometry per material, ready for instancing per chunk.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarTemplate } from './extras.ts';

export async function loadCars(url = 'models/cars.glb'): Promise<CarTemplate[]> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const out: CarTemplate[] = [];
  for (const name of ['Sedan', 'SUV', 'Pickup']) {
    const root = gltf.scene.getObjectByName(name);
    if (!root) continue;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMat = new Map<string, { mat: THREE.MeshStandardMaterial; geos: THREE.BufferGeometry[] }>();
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      const g2 = geo.index ? geo.toNonIndexed() : geo;
      if (!byMat.has(mat.name)) byMat.set(mat.name, { mat, geos: [] });
      byMat.get(mat.name)!.geos.push(g2);
    });
    // Lamps sat flush with the body's end face (z-fighting flicker) and overhung its rounded
    // corners: fit each one inside the body's outline there and stand it 1.5 cm proud.
    const paint = byMat.get('Paint')?.geos ?? [];
    for (const k of ['TailLamp', 'HeadLamp']) for (const g of byMat.get(k)?.geos ?? []) fitLamp(g, paint);
    // Bake each part's colour into vertex colours; paint stays white so the instance colour shows.
    const geos: THREE.BufferGeometry[] = [];
    for (const { mat, geos: gs } of byMat.values()) {
      const col = mat.name === 'Paint' ? new THREE.Color(1, 1, 1) : mat.name === 'CarGlass' ? new THREE.Color(0.012, 0.016, 0.02)
        : mat.name === 'Hubcap' ? new THREE.Color(0.25, 0.26, 0.27) : mat.name === 'HeadLamp' ? new THREE.Color(0.7, 0.7, 0.66)
        : mat.name === 'TailLamp' ? new THREE.Color(0.62, 0.025, 0.02) : mat.name === 'Plate' ? new THREE.Color(0.6, 0.6, 0.56) : new THREE.Color(0.015, 0.015, 0.015);
      for (const g0 of gs) {
        const c = new Float32Array(g0.attributes.position.count * 3);
        for (let i = 0; i < c.length; i += 3) c.set([col.r, col.g, col.b], i);
        g0.setAttribute('color', new THREE.BufferAttribute(c, 3));
        geos.push(g0);
      }
    }
    const geometry = mergeGeometries(geos)!;
    geometry.computeBoundingSphere();
    const box = new THREE.Box3().setFromObject(root);
    out.push({ name, length: box.max.z - box.min.z, geometry });
  }
  return out;
}

/** Moves a lamp (one box, in car space: +z front) inside the body's width and just proud of its end. */
function fitLamp(lamp: THREE.BufferGeometry, body: THREE.BufferGeometry[]) {
  lamp.computeBoundingBox();
  const bb = lamp.boundingBox!, c = bb.getCenter(new THREE.Vector3());
  const sz = Math.sign(c.z) || 1, sx = Math.sign(c.x) || 1;
  const ax0 = Math.min(Math.abs(bb.min.x), Math.abs(bb.max.x)), ax1 = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
  const az0 = Math.min(Math.abs(bb.min.z), Math.abs(bb.max.z)), az1 = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
  const pts: THREE.Vector3[] = [];
  for (const g of body) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y >= bb.min.y - 0.02 && y <= bb.max.y + 0.02 && Math.sign(z) === sz) pts.push(new THREE.Vector3(Math.abs(x), y, Math.abs(z)));
    }
  }
  if (!pts.length) return;
  // Body half-width over the lamp's depth range; keep the lamp's outer edge 4 cm inside it.
  let xEdge = 0;
  for (const p of pts) if (p.z >= az0 - 0.15) xEdge = Math.max(xEdge, p.x);
  const dx = xEdge > 0 && ax1 > xEdge - 0.04 ? xEdge - 0.04 - ax1 : 0;
  // Body end over the (shifted) lamp's width; the lamp face goes 1.5 cm beyond it.
  let zEnd = 0;
  for (const p of pts) if (p.x >= ax0 + dx - 0.02 && p.x <= ax1 + dx + 0.02) zEnd = Math.max(zEnd, p.z);
  const dz = zEnd > 0 ? zEnd + 0.015 - az1 : 0;
  lamp.translate(dx * sx, 0, dz * sz);
}
