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

/**
 * Loads every building model. Their PBR textures depend on the photo textures, so
 * `pbrReady` (the photo load) is awaited only before applying them: downloads and Draco
 * decoding run in parallel with the photos.
 */
export async function loadBuildingModels(base = 'models/buildings/', pbrReady: Promise<unknown> = Promise.resolve()): Promise<Map<string, THREE.Object3D>> {
  const out = new Map<string, THREE.Object3D>();
  let index: string[] = [];
  try { index = await (await fetch(base + 'index.json')).json(); } catch { return out; }
  const draco = new DRACOLoader().setDecoderPath('draco/').setWorkerLimit(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const familyMaterials = new Map<string, THREE.Material>();
  const familyMaps = new Map<string, THREE.Texture>();
  await Promise.all(index.map(async slug => {
    try {
      const g = await loader.loadAsync(base + slug + '.glb');
      await pbrReady;
      const sharedUrl = (g.parser.json.images as { uri?: string }[] | undefined)
        ?.find(img => img.uri?.startsWith('atlas_'))?.uri;
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material)) return;
        m.castShadow = m.receiveShadow = true;
        m.userData.shared = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (slug === 'callier_center_richardson_addition' && mat.name === 'Stair_Red' &&
            index.includes('callier_center_richardson_addition_access')) {
          m.visible = false;
          return;
        }
        const atlas = mat.name.startsWith('CampusAtlas_');
        const glazing = mat.name.startsWith('CampusAtlas_glass');
        if (atlas) {
          if (glazing) m.castShadow = false;
          // Fill depth ahead of terrain, decals and the sky.
          if (!mat.transparent) m.renderOrder = -21;
        }
        // With diffuse shading, roof and facade tiles using the same atlas and
        // colour no longer need separate batches.
        const batch = glazing ? mat.name.replace(/\.\d+$/, '') : `diffuse-${mat.side}-${mat.color.getHexString()}`;
        const familyKey = sharedUrl && mat.map ? `${sharedUrl}/${batch}` : undefined;
        if (familyKey && sharedUrl && mat.map) {
          // The chunk builder batches by material identity. A family atlas and
          // material name identify the same exported shader across its GLBs.
          const shared = familyMaterials.get(familyKey);
          if (shared) {
            m.material = shared;
            m.receiveShadow = !(shared instanceof THREE.MeshBasicMaterial);
            return;
          }
          const sharedMap = familyMaps.get(sharedUrl);
          if (sharedMap) mat.map = sharedMap;
          else familyMaps.set(sharedUrl, mat.map);
        }
        if (atlas) {
          m.material = campusMaterial(mat, slug);
          m.receiveShadow = !(m.material instanceof THREE.MeshBasicMaterial);
        } else if (!mat.map) {
          applyPbr(mat);
        }
        if (familyKey) familyMaterials.set(familyKey, m.material);
      });
      out.set(slug, g.scene);
    } catch (e) { console.warn('building model failed', slug, e); }
  }));
  draco.dispose();
  return out;
}

function campusMaterial(material: THREE.MeshStandardMaterial, slug: string): THREE.Material {
  if (material.name.startsWith('CampusAtlas_glass')) {
    if (!material.transparent && !material.name.includes('glassWarm') &&
        slug !== 'natural_science_and_engineering_research_lab' &&
        slug !== 'engineering_and_computer_science_west') {
      return reflectiveWindows(material);
    }
    material.envMapIntensity = /glassWarm|glassLobby/.test(material.name) ? 1.35 : 2.6;
    // The museum lobby has a visible illuminated interior behind the curtain wall.
    material.forceSinglePass = true;
    return material;
  }
  if (slug === 'natural_science_and_engineering_research_lab' && material.roughnessMap) {
    // The anodised scales and limestone share a batch but need separate reflectivity.
    material.normalMap = null;
    return material;
  }
  // Precast, brick and concrete are mostly diffuse. The atlas supplies the
  // small-scale surface contrast and the geometry supplies the large contours.
  const diffuse = new THREE.MeshLambertMaterial({
    name: material.name,
    map: material.map,
    color: material.color,
    side: material.side,
  });
  material.dispose();
  return diffuse;
}

/** Tinted opaque glazing with a vertex-lit sky reflection. */
function reflectiveWindows(source: THREE.MeshStandardMaterial) {
  const glass = new THREE.MeshBasicMaterial({
    name: source.name,
    map: source.map,
    color: source.color,
    side: source.side,
  });
  glass.onBeforeCompile = shader => {
    const reflection = 'varying vec4 windowSky;\n';
    shader.vertexShader = reflection + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vec3 windowNormal = normalize(normalMatrix * normal);
      vec3 windowView = normalize(-mvPosition.xyz);
      vec3 reflected = transformDirectionByInverseViewMatrix(reflect(-windowView, windowNormal), viewMatrix);
      float sky = smoothstep(-0.15, 0.65, reflected.y);
      float rim = 1.0 - clamp(abs(dot(windowNormal, windowView)), 0.0, 1.0);
      windowSky = vec4(mix(vec3(0.055, 0.066, 0.067), vec3(0.28, 0.38, 0.47), sky),
                       0.12 + 0.26 * rim * rim * rim);
    `);
    shader.fragmentShader = reflection + shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, windowSky.rgb, windowSky.a);
    `);
  };
  source.dispose();
  return glass;
}

type MapPoint = [east: number, north: number];
type ModelPoint = [east: number, north: number, height: number];
type Levels = [bottom: number, top: number];

/** Model positions use map metres. Vertical coordinates are relative to the model seat. */
export interface ModelSolids {
  posts: [number, number, number][];
  rings: MapPoint[][];
  replaceFootprint?: boolean;
  postLevels?: Levels[];
  ringLevels?: Levels[];
  volumes?: { ring: MapPoint[]; height: Levels; topRing?: MapPoint[]; holes?: MapPoint[][] }[];
  shells?: { vertices: ModelPoint[]; triangles: [number, number, number][] }[];
  /** Beam corners are written in local GLB axis order, with map east and north. */
  hulls?: [east: number, height: number, north: number][][];
  paving?: ModelPoint[][];
}

export async function loadBuildingSolids(base = 'models/buildings/'): Promise<Record<string, ModelSolids>> {
  try { return await (await fetch(base + 'solids.json')).json(); } catch { return {}; }
}

/** True if a building has a reconstructed model (its procedural body is skipped). */
export function hasModel(models: Map<string, THREE.Object3D> | undefined, b: Building) {
  return !!(b.name && models?.has(slugOf(b.modelName ?? b.name)));
}
