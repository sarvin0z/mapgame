// Loads the Blender-generated building models (public/models/buildings, built
// by blender/build_buildings.py from reconstruction/specs.json). Each model is
// in building-local metres with its origin at the footprint centroid and y = 0
// at the ground floor; the chunk builder places it at the building's seat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { Building } from './campusData.ts';
import { applyPbr } from './pbrTextures.ts';

export function slugOf(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export async function loadBuildingModels(base = 'models/buildings/'): Promise<Map<string, THREE.Object3D>> {
  const out = new Map<string, THREE.Object3D>();
  let index: string[] = [];
  try { index = await (await fetch(base + 'index.json')).json(); } catch { return out; }
  const draco = new DRACOLoader().setDecoderPath('draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  await Promise.all(index.map(async slug => {
    try {
      const g = await loader.loadAsync(base + slug + '.glb');
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = true;
        m.userData.shared = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        applyPbr(mat);
      });
      out.set(slug, g.scene);
    } catch (e) { console.warn('building model failed', slug, e); }
  }));
  draco.dispose();
  return out;
}

/** Ground-level solid parts of the models that stand outside their OSM footprints (drums, posts), in map metres. */
export interface ModelSolids { posts: [number, number, number][]; rings: [number, number][][] }

export async function loadBuildingSolids(base = 'models/buildings/'): Promise<Record<string, ModelSolids>> {
  try { return await (await fetch(base + 'solids.json')).json(); } catch { return {}; }
}

/** True if a building has a reconstructed model (its procedural body is skipped). */
export function hasModel(models: Map<string, THREE.Object3D> | undefined, b: Building) {
  return !!(b.name && models?.has(slugOf(b.modelName ?? b.name)));
}
