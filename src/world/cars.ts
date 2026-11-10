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
    // Bake each part's colour into vertex colours; paint stays white so the instance colour shows.
    const geos: THREE.BufferGeometry[] = [];
    for (const { mat, geos: gs } of byMat.values()) {
      const col = mat.name === 'Paint' ? new THREE.Color(1, 1, 1) : mat.name === 'CarGlass' ? new THREE.Color(0.012, 0.016, 0.02)
        : mat.name === 'Hubcap' ? new THREE.Color(0.25, 0.26, 0.27) : mat.name === 'HeadLamp' ? new THREE.Color(0.7, 0.7, 0.66)
        : mat.name === 'TailLamp' ? new THREE.Color(0.35, 0.01, 0.01) : mat.name === 'Plate' ? new THREE.Color(0.6, 0.6, 0.56) : new THREE.Color(0.015, 0.015, 0.015);
      // The model's parts overlap flush (glass under the painted belt, pillars and roof; lamps,
      // plates and trim set into the body), and faces at the same depth flicker against each
      // other with every movement of the camera. Glass is drawn back a few millimetres and
      // the applied parts pushed out, along their normals, so one of each pair always wins.
      const push = mat.name === 'Paint' ? 0 : mat.name === 'CarGlass' ? -0.008 : mat.name === 'CarTire' || mat.name === 'Hubcap' ? 0 : 0.006;
      for (const g0 of gs) {
        if (push) {
          const p = g0.attributes.position as THREE.BufferAttribute, nrm = g0.attributes.normal as THREE.BufferAttribute;
          for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + nrm.getX(i) * push, p.getY(i) + nrm.getY(i) * push, p.getZ(i) + nrm.getZ(i) * push);
        }
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
