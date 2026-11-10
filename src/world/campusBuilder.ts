// Builds renderable Three.js groups per map chunk, seated on the 3DEP terrain.
// Groups, from always-on to closest-only:
//   base     buildings and ground surfaces (roads, lots, lawns, water)
//   coarse   4 m terrain, shown when `near` is hidden
//   farOnly  low-poly tree blobs, shown when `detail` is hidden
//   detail   trees, lamps, curbs, markings, fences, stairs, bumps
//   near     2 m terrain and small street furniture
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkContent } from './chunks.ts';
import { CHUNK_SIZE } from './chunks.ts';
import { DRIVABLE, PATHS, type Building, type Pt, type Road, type Tree } from './campusData.ts';
import { releaseAfterUpload, MeshBuilder, addFlatPolygon, addWalls, addDrapedRibbon, addDrapedPolygon, addDrapedStrip, addDrapedDisc, resample, ribbonEdges, ensureCCW } from './geometry.ts';
import { bumpSolid, stairBlocks, maxInset, insetRing } from './features.ts';
import { simplify } from './curbs.ts';
import type { Terrain } from './terrain.ts';
import * as tex from './textures.ts';
import { photoTexture, photoNormal } from './photos.ts';
import { buildExtras, type CarTemplate } from './extras.ts';
import { buildBuilding, railing, beam, baseLevel, type BuildingKit } from './buildings.ts';
import { hasModel, slugOf } from './buildingModels.ts';
import { buildLandmarks } from './landmarks.ts';
import { pointInRing } from './spatial.ts';
import { buildLandscape } from './landscape.ts';
import { taperWidth, inTaper, laneSplit, type Taper } from './roadShape.ts';
import { occlusionMaterial, lampPoolMaterial, nightUniform, wallSkirt, blob as aoBlob } from './occlusion.ts';

/** Draw order of the depth-less ground layers (later = on top). */
export const LAYER = { terrain: -20, grass: -9, pitch: -8, parking: -7, plaza: -6, water: -6, path: -5, road: -4, marking: -3 };
export const LIFT = { grass: 0.02, pitch: 0.025, parking: 0.03, plaza: 0.035, water: 0.03, path: 0.04, road: 0.045, marking: 0.055 };

export interface WorldContext {
  terrain: Terrain;
  /** True if a map point lies on a surface parking lot. */
  inParking(p: Pt): boolean;
  /** True if a map point lies on the pavement of a drivable road (within `margin` of its edge). */
  onRoad(p: Pt, margin?: number): boolean;
  /** True if p is within r of a junction or end of a drivable road. */
  junctionNear(p: Pt, r: number): boolean;
  inPlaza(p: Pt): boolean;
  /** Where unmapped surface lots may be inferred along parking aisles (housing and service yards). */
  lotAllowed(p: Pt): boolean;
  /** Reconstructed building models by slug (see buildingModels.ts). */
  models?: Map<string, THREE.Object3D>;
  /** True for a short dead-end walkway stub (OSM artefacts that lead nowhere). */
  isStub(r: { id: number; pts: Pt[]; cls: string }): boolean;
  /** Every building (for features that relate one building to another). */
  buildings: Building[];
  /** Same for walks, paths and cycleways. */
  onPath(p: Pt, margin?: number): boolean;
  inBuilding(p: Pt): boolean;
  inWater(p: Pt): boolean;
  /** True if a tree trunk stands within r of p. */
  treeNear(p: Pt, r: number): boolean;
  /** Parked-car templates (sedan, SUV, pickup); none until loaded. */
  cars?: CarTemplate[];
  /** Road ends that narrow into a continuation (see roadTapers in roadShape.ts), by way id. */
  tapers?: Map<number, Taper[]>;
}

export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; }
const lin = (c: number[]) => c.map(v => Math.pow(v, 2.2));

function toGeometry(mb: MeshBuilder): THREE.BufferGeometry | null {
  if (!mb.vertexCount) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(mb.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(mb.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(mb.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(mb.col, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  releaseAfterUpload(g);
  return g;
}

/**
 * Breaks up texture tiling on large surfaces: a second, much larger-scale
 * sample of the same map plus a world-space value-noise tint.
 */
/** Seconds, advanced by the main loop; drives the foliage sway. */
export const foliageTime = { value: 0 };

/**
 * Leaf shading: a gentle wind sway (phase per tree, amplitude growing with
 * height), light wrapping round the crown, and sunlight glowing through the
 * leaves when the camera looks toward the sun.
 */
function foliage(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = foliageTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = dot(instanceMatrix[3].xz, vec2(0.37, 0.71));
#else
  float ph = 0.0;
#endif
  float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7 + position.x * 4.0) * 0.4) * 0.018 * max(0.0, position.y - 0.3);
  transformed.x += sway; transformed.z += sway * 0.6;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  {
    vec3 L = directionalLights[0].direction;
    float back = pow(saturate(dot(normalize(vViewPosition), L)), 3.0);
    float wrap = saturate(dot(normal, L) * 0.5 + 0.5);
    reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * (0.1 * back + 0.05 * wrap);
  }
#endif`);
  };
  return mat;
}

/**
 * Lit windows at night: the facade textures mark glass as nearly smooth (ORM
 * green channel ~0.07), so glass pixels in about 40 % of window bays (chosen per bay and
 * storey cell) glow a warm interior colour while nightUniform is on.
 */
function litWindows(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      // Recessed windows by parallax: glass (ORM roughness < 0.3) sits 18 cm behind the wall
      // face. The view ray is followed into the recess using the surface's UV derivatives;
      // where it meets the wall or frame first, the pixel shows the shaded reveal instead.
      // Faded out by 120 m, where the recess is under a pixel.
      .replace('#include <map_fragment>', `float revealF = 0.0;
#ifdef USE_MAP
  // Derivatives first, in uniform control flow; samples use textureGrad with the
  // surface's own gradients so the offset UVs do not drop to a blurry mip level.
  vec2 s0 = dFdx(vMapUv), s1 = dFdy(vMapUv);
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 pUv = vMapUv;
  #ifdef USE_ROUGHNESSMAP
  vec2 r0 = dFdx(vRoughnessMapUv), r1 = dFdy(vRoughnessMapUv);
  {
    float depth = 0.18 * (1.0 - smoothstep(50.0, 120.0, length(vViewPosition)));
    float gHere = texture2D(roughnessMap, vRoughnessMapUv).g;
    float det = s0.x * s1.y - s1.x * s0.y, detR = r0.x * r1.y - r1.x * r0.y;
    if (depth > 0.001 && gHere < 0.3 && abs(det) > 1e-14 && abs(detR) > 1e-14) {
      vec3 dPdu = (q0 * s1.y - q1 * s0.y) / det;
      vec3 dPdv = (q1 * s0.x - q0 * s1.x) / det;
      vec3 dRdu = (q0 * r1.y - q1 * r0.y) / detR;
      vec3 dRdv = (q1 * r0.x - q0 * r1.x) / detR;
      vec3 V = normalize(vViewPosition);
      vec3 N = normalize(cross(dPdu, dPdv));
      if (dot(N, V) < 0.0) N = -N;
      vec3 O = -V * (depth / max(dot(V, N), 0.35));
      vec2 off = vec2(dot(O, dPdu) / dot(dPdu, dPdu), dot(O, dPdv) / dot(dPdv, dPdv));
      vec2 offR = vec2(dot(O, dRdu) / dot(dRdu, dRdu), dot(O, dRdv) / dot(dRdv, dRdv));
      float gThere = textureGrad(roughnessMap, vRoughnessMapUv + offR, r0, r1).g;
      pUv = vMapUv + off;
      revealF = step(0.3, gThere);
    }
  }
  #endif
  vec4 sampledDiffuseColor = textureGrad(map, pUv, s0, s1);
  sampledDiffuseColor.rgb *= 1.0 - 0.45 * revealF;
  diffuseColor *= sampledDiffuseColor;
#endif`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.85, revealF);
  metalnessFactor = mix(metalnessFactor, 0.0, revealF);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_MAP
  if (uNight > 0.0) {
    float glass = 1.0 - smoothstep(0.12, 0.3, roughnessFactor);
    float cell = fract(sin(dot(floor(vMapUv), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 tint = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.85, cell));
    totalEmissiveRadiance += glass * step(0.6, cell) * uNight * tint * 1.6;
  }
#endif`);
  };
  return mat;
}

/**
 * Worn paint for road markings: world-space noise at two scales scuffs the paint toward
 * the asphalt grey and roughens it (tyre-worn crosswalk bars, faded stop lines).
 */
function worn(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
float whash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1, 0)), f.x), mix(whash(i + vec2(0, 1)), whash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float wear = wnoise(vWPos.xz * 0.9) * 0.6 + wnoise(vWPos.xz * 7.0) * 0.4;
  float scuff = smoothstep(0.42, 0.75, wear);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.42, 0.43), scuff * 0.65);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.9, scuff);');
  };
  mat.customProgramCacheKey = () => 'wornMarking';
}

function macroVariation(mat: THREE.MeshStandardMaterial, amount: number, tint: [number, number, number], soften = 0) {
  // The amounts are written into the shader text, so they are part of the program's identity.
  mat.customProgramCacheKey = () => `macro${amount}|${soften}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = { value: new THREE.Vector3(...tint) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform vec3 uTint;
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y); }`)
      // Past a dozen metres the grain of the photo (grass blades, asphalt aggregate) is finer than
      // a pixel and only shimmers as the camera moves: the surface eases onto its blurred mip
      // levels there, and its normal map fades out below, leaving the large-scale variation.
      .replace('#include <map_fragment>', `float farK = smoothstep(5.0, 45.0, length(vViewPosition));
#ifdef USE_MAP
  diffuseColor *= ${soften > 0 ? `mix(texture2D(map, vMapUv, farK * 2.5), texture2D(map, vMapUv, 5.0), ${soften.toFixed(2)})` : 'texture2D(map, vMapUv, farK * 2.5)'};
  vec3 macro = texture2D(map, vMapUv * 0.137).rgb;
  diffuseColor.rgb *= mix(vec3(1.0), macro / max(vec3(0.05), vec3(dot(macro, vec3(0.333)))), 0.35);
#endif
  float n = vnoise(vWPos.xz * 0.025) * 0.6 + vnoise(vWPos.xz * 0.11) * 0.4;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint, smoothstep(0.35, 0.75, n) * ${amount.toFixed(2)});`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
  normal = normalize(mix(normal, nonPerturbedNormal, farK * 0.9));
#endif`);
  };
}

export class CampusMaterials {
  terrain: THREE.MeshStandardMaterial;
  layers: Record<string, THREE.MeshStandardMaterial> = {};
  facades: Record<string, THREE.MeshStandardMaterial> = {};
  styles = tex.facadeStyles();
  roof: THREE.MeshStandardMaterial;
  shingle: THREE.MeshStandardMaterial;
  bark = new THREE.MeshStandardMaterial({ map: photoTexture('bark', 1, 3) ?? tex.barkTexture(), roughness: 1 });
  leaves = foliage(new THREE.MeshStandardMaterial({ map: photoTexture('leaves') ?? tex.leafTexture(), alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true }));
  blob = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  metal = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.45, metalness: 0.7 });
  galvanized = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 });
  lampHead = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d0, emissiveIntensity: 0.15 });
  wood = new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 0.9 });
  concrete = new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), color: 0xd8d4cc, roughness: 0.9 });
  curb = new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), color: 0xd9d6cf, roughness: 0.9, vertexColors: true });
  bump = new THREE.MeshStandardMaterial({ roughness: 0.7, vertexColors: true });
  stairs = new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), color: 0xd0ccc4, roughness: 0.85 });
  fence: THREE.MeshStandardMaterial;
  wall = new THREE.MeshStandardMaterial({ map: tex.pavingTexture(), color: 0xd8cbb6, roughness: 0.95, vertexColors: true });
  hedge = new THREE.MeshStandardMaterial({ map: tex.leafTexture(), color: 0x6f8f4a, roughness: 1, vertexColors: true });
  bollard = new THREE.MeshStandardMaterial({ color: 0x3a3c3f, roughness: 0.5, metalness: 0.4 });
  hvac = new THREE.MeshStandardMaterial({ color: 0xb4b8bb, roughness: 0.5, metalness: 0.5 });
  stopSign = new THREE.MeshStandardMaterial({ map: tex.signTexture('stop'), roughness: 0.5 });
  numbers = new THREE.MeshStandardMaterial({ map: tex.numberAtlas(), roughness: 0.45, metalness: 0.3 });
  yieldSign = new THREE.MeshStandardMaterial({ map: tex.signTexture('yield'), roughness: 0.5, transparent: true, alphaTest: 0.5 });
  signalHead = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0x000000 });
  whiteV = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.15 });
  concreteV = new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), vertexColors: true, roughness: 0.9 });
  curtainGlass = new THREE.MeshStandardMaterial({ color: 0x2a3d4c, roughness: 0.05, metalness: 0.7, envMapIntensity: 3, vertexColors: true });
  metalV = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
  timber = new THREE.MeshStandardMaterial({ map: tex.timberTexture(), vertexColors: true, roughness: 0.8 });
  stoneV = new THREE.MeshStandardMaterial({ map: tex.pavingTexture(), vertexColors: true, roughness: 0.85 });
  signPanel: THREE.MeshStandardMaterial | null = null;
  carBody = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.45 });
  rock = new THREE.MeshStandardMaterial({ color: 0x5b4a3c, roughness: 0.95, flatShading: true });
  doorFrame = new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.4, metalness: 0.6 });
  doorGlass = new THREE.MeshStandardMaterial({ color: 0x1e2a33, roughness: 0.05, metalness: 0.6, envMapIntensity: 4 });
  doorSteel = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3, vertexColors: true });
  /** Ground ambient-occlusion decals (see occlusion.ts). */
  occlusion = occlusionMaterial();
  /** Night light pools under street lamps. */
  lampPool = lampPoolMaterial();
  canopyWhite = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5, metalness: 0.2 });
  /**
   * Plinth shade canopy: a grid of beams every 3 m both ways plus shade fins
   * every 0.6 m along `louverAxis`, about 55 % shade, cut out in the fragment
   * shader around `louverCenter` (world x, z). `louverDepth` cuts the same
   * pattern in the shadow pass, so the canopy casts a gridded shadow.
   */
  louverCenter = new THREE.Vector2();
  louverAxis = new THREE.Vector2(1, 0);
  private louverCut = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.uniforms.uCenter = { value: this.louverCenter };
    sh.uniforms.uAxis = { value: this.louverAxis };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec2 uCenter;\nuniform vec2 uAxis;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  vec2 dd = vWPos.xz - uCenter;
  float ga = dot(dd, uAxis), gb = dot(dd, vec2(-uAxis.y, uAxis.x));
  bool beam = fract(ga / 3.0) < 0.1 || fract(gb / 3.0) < 0.1;
  bool fin = fract(ga / 0.6) < 0.45;
  if (!beam && !fin) discard;`);
  };
  louver = (() => {
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0xf2f2ee, roughness: 0.45, metalness: 0.3 });
    m.onBeforeCompile = this.louverCut;
    return m;
  })();
  louverDepth = (() => {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    m.onBeforeCompile = this.louverCut;
    return m;
  })();
  net = new THREE.MeshStandardMaterial({ map: tex.netTexture(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true });
  windscreen = new THREE.MeshStandardMaterial({ color: 0x14301f, roughness: 0.9, side: THREE.DoubleSide });
  fountainWater = new THREE.MeshStandardMaterial({ color: 0x5f8a95, roughness: 0.05, metalness: 0.1, envMapIntensity: 4 });
  mist = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 seed; uniform float uTime; varying float vA;
      void main() {
        float t = fract(uTime * 0.14 + seed.x);
        float r = 0.6 + t * 4.2 * (0.6 + seed.z * 0.6);
        vec3 p = vec3(cos(seed.y) * r, 0.25 + t * 1.8 + sin(t * 3.1416) * 0.9, sin(seed.y) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (120.0 + t * 260.0) / max(0.5, -mv.z);
        vA = (1.0 - t) * smoothstep(0.0, 0.12, t) * 0.32;
      }`,
    fragmentShader: `varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.0, d) * vA); }`,
  });

  constructor() {
    // Photo lawn tile is 3 m; lawn UVs run 6 m per unit.
    const grass = photoTexture('lawn', 2) ?? tex.grassTexture();
    // Tinted toward a watered, lush green (the texture alone reads as late-summer dry turf).
    const lawn = grass instanceof THREE.CanvasTexture ? new THREE.Color(0.74, 0.86, 0.6) : new THREE.Color(0.72, 0.76, 0.6);
    const turfN = photoNormal('lawn', 2.2, 2);
    this.terrain = new THREE.MeshStandardMaterial({ map: grass, color: lawn, roughness: 0.95, ...(turfN ? { normalMap: turfN, normalScale: new THREE.Vector2(0.45, 0.45) } : {}) });
    // Turf also has its blade-level contrast eased everywhere: at full strength a mown lawn read as a noisy carpet.
    macroVariation(this.terrain, 0.55, [1.25, 1.08, 0.78], 0.4);
    this.roof = new THREE.MeshStandardMaterial({ map: tex.roofTexture(), vertexColors: true, roughness: 0.9 });
    this.shingle = new THREE.MeshStandardMaterial({ map: tex.shingleTexture(), vertexColors: true, roughness: 0.95 });
    const chain = tex.chainLinkTexture();
    this.fence = new THREE.MeshStandardMaterial({ map: chain, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
    for (const [k, s] of Object.entries(this.styles)) {
      this.facades[k] = litWindows(new THREE.MeshStandardMaterial({ map: s.map, roughnessMap: s.orm, metalnessMap: s.orm, roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 3 }));
    }
    // Fin screen: see-through between the fins.
    Object.assign(this.facades.garageFins, { alphaTest: 0.5, side: THREE.DoubleSide });
    // Asphalt tint: the photo's own albedo (~0.11 linear) under the earlier 0xb4 tint came to ~0.05,
    // blacker than fresh tar; sun-aged road and lot asphalt measures 0.08-0.12, lots the lighter.
    // Photo asphalt is a 4 m tile: lots run 6 m per UV unit, roads 8 m; photo sidewalk is one 1.5 m panel per path UV unit.
    const asphaltLot = photoTexture('asphalt', 1.5), asphaltRoad = photoTexture('asphalt', 2), pavers = photoTexture('pavers');
    const asphalt = tex.asphaltTexture(), concrete = tex.concreteTexture(), paving = tex.pavingTexture(), dirt = tex.dirtTexture();
    const flat = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ depthWrite: false, roughness: 0.95, vertexColors: true, ...o });
    this.layers = {
      grass: flat({ map: grass, color: lawn }),
      pitch: flat({ map: grass, color: lawn }),
      dirt: flat({ map: dirt }),
      parking: flat({ map: asphaltLot ?? asphalt, ...(asphaltLot ? { color: 0xdcdcda, normalMap: photoNormal('asphalt', 1.6, 1.5)!, normalScale: new THREE.Vector2(0.2, 0.2) } : {}) }),
      plaza: flat({ map: paving }),
      // Ripples: a scrolling normal map (see waterTime); deep tint from the vertex colour.
      water: flat({ color: 0xffffff, roughness: 0.04, metalness: 0.0, envMapIntensity: 5, normalMap: tex.waterNormals(), normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: true }),
      path: flat({ map: pavers ?? concrete, roughness: 0.9, ...(pavers ? { normalMap: photoNormal('pavers', 4)!, normalScale: new THREE.Vector2(0.8, 0.8) } : {}) }),
      road: flat({ map: asphaltRoad ?? asphalt, roughness: 0.9, ...(asphaltRoad ? { color: 0xd2d2d0, normalMap: photoNormal('asphalt', 1.6, 2)!, normalScale: new THREE.Vector2(0.2, 0.2) } : {}) }),
      promenade: flat({ map: tex.promenadeTexture(), roughness: 0.85 }),
      pitchSurface: flat({ roughness: 0.8 }),
      marking: flat({ roughness: 0.55 }),
    };
    macroVariation(this.layers.grass, 0.5, [1.25, 1.08, 0.78], 0.4);
    macroVariation(this.layers.road, 0.35, [0.82, 0.82, 0.84]);

    macroVariation(this.layers.parking, 0.35, [0.85, 0.85, 0.86]);
    macroVariation(this.layers.path, 0.3, [0.9, 0.88, 0.84]);
    worn(this.layers.marking);
  }
}

const AREA_STYLE: Record<string, { layer: keyof typeof LAYER; mat: string; color: number[]; uv: number }> = {
  grass: { layer: 'grass', mat: 'grass', color: [1.0, 1.0, 1.0], uv: 6 },
  park: { layer: 'grass', mat: 'grass', color: [0.97, 1.02, 0.95], uv: 6 },
  wood: { layer: 'grass', mat: 'grass', color: [0.72, 0.8, 0.62], uv: 6 },
  scrub: { layer: 'grass', mat: 'grass', color: [1.05, 0.98, 0.8], uv: 6 },
  pitch: { layer: 'pitch', mat: 'pitch', color: [0.78, 1.12, 0.72], uv: 5 },
  track: { layer: 'pitch', mat: 'dirt', color: [1.25, 0.62, 0.5], uv: 4 },
  construction: { layer: 'pitch', mat: 'dirt', color: [1.0, 0.95, 0.85], uv: 4 },
  parking: { layer: 'parking', mat: 'parking', color: [1, 1, 1], uv: 6 },
  plaza: { layer: 'plaza', mat: 'plaza', color: [1, 1, 1], uv: 3 },
  water: { layer: 'water', mat: 'water', color: [0.1, 0.17, 0.16], uv: 10 },
  pool: { layer: 'water', mat: 'water', color: [0.25, 0.62, 0.75], uv: 10 },
};
const PATH_COLOR: Record<string, number[]> = { default: [1, 1, 1], cycleway: [0.97, 0.93, 0.9], path: [1.0, 0.95, 0.86], pedestrian: [1.02, 1.0, 0.97] };
const YELLOW = lin([0.93, 0.74, 0.16]), WHITE = lin([0.95, 0.95, 0.93]);

// ---------- Shared instanced geometry ----------
type TreeKind = 'spreading' | 'round' | 'columnar';
let shared: {
  trees: Record<TreeKind, { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry; lite: THREE.BufferGeometry }>;
  blob: THREE.BufferGeometry; lamp: THREE.BufferGeometry; lampHead: THREE.BufferGeometry; bench: THREE.BufferGeometry;
  bollard: THREE.BufferGeometry; flagpole: THREE.BufferGeometry; bikeRack: THREE.BufferGeometry; bin: THREE.BufferGeometry; hvac: THREE.BufferGeometry;
  signPost: THREE.BufferGeometry; stopFace: THREE.BufferGeometry; yieldFace: THREE.BufferGeometry;
} | null = null;

/**
 * A unit tree (height 1, canopy radius 1). The crown is a handful of leaf
 * clusters (lumpy silhouette like a live oak or cedar elm) densely filled
 * with leaf cards. Cards carry a vertex colour for self-shadowing: darker deep
 * inside and underneath, brighter on the sunlit outer shell. Cards are
 * pre-squashed by the typical radius/height ratio of the kind so they stay
 * roughly square after the per-tree non-uniform scale.
 */
function treeTemplate(kind: TreeKind) {
  let s = kind === 'spreading' ? 3 : kind === 'round' ? 5 : 9;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const P = {
    spreading: { trunk: 0.38, cy: 0.66, ry: 0.32, ratio: 0.75, cards: 380, tr: 0.06, clusters: 9 },
    round: { trunk: 0.35, cy: 0.6, ry: 0.4, ratio: 0.45, cards: 300, tr: 0.07, clusters: 7 },
    columnar: { trunk: 0.1, cy: 0.54, ry: 0.46, ratio: 0.14, cards: 180, tr: 0.12, clusters: 5 },
  }[kind];
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(P.tr * 0.6, P.tr, P.trunk + 0.1, 7, 1, true).translate(0, (P.trunk + 0.1) / 2, 0)];
  // Crown clusters: one at the top centre, the rest spread around the ellipsoid shell.
  const clusters: { c: THREE.Vector3; r: number }[] = [{ c: new THREE.Vector3(0, P.cy + P.ry * 0.35, 0), r: 0.55 }];
  for (let k = 1; k < P.clusters; k++) {
    const th = (k / (P.clusters - 1)) * Math.PI * 2 + rnd() * 0.5, el = -0.15 + rnd() * 0.75;
    const rr = 0.5 + rnd() * 0.12;
    clusters.push({ c: new THREE.Vector3(Math.cos(th) * Math.cos(el) * rr, P.cy + Math.sin(el) * rr * P.ry, Math.sin(th) * Math.cos(el) * rr), r: 0.38 + rnd() * 0.14 });
  }
  // Limbs from the trunk top toward each lower cluster.
  if (kind !== 'columnar') for (const cl of clusters.slice(1)) {
    const from = new THREE.Vector3(0, P.trunk - 0.02, 0), to = cl.c.clone().multiplyScalar(0.8);
    to.y = Math.max(to.y, P.trunk + 0.05);
    const len = from.distanceTo(to);
    const br = new THREE.CylinderGeometry(P.tr * 0.22, P.tr * 0.5, len, 5, 1, true).translate(0, len / 2, 0);
    br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize())).translate(from.x, from.y, from.z);
    parts.push(br);
  }
  const trunk = mergeGeometries(parts.map(g => g.toNonIndexed()))!;
  const full = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], col: [] as number[] };
  const lite = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], col: [] as number[] };
  const crownC = new THREE.Vector3(0, P.cy, 0);
  for (let i = 0; i < P.cards; i++) {
    const cl = clusters[i % clusters.length];
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = cl.r * (0.35 + 0.65 * Math.pow(rnd(), 0.4));
    const dir = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th), u, Math.sqrt(1 - u * u) * Math.sin(th));
    const c = new THREE.Vector3(cl.c.x + dir.x * rr, cl.c.y + dir.y * rr * P.ry * 1.6, cl.c.z + dir.z * rr);
    const size = 0.36 + rnd() * 0.24;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI));
    const ax = new THREE.Vector3(size, 0, 0).applyQuaternion(q), ay = new THREE.Vector3(0, size, 0).applyQuaternion(q);
    ax.y *= P.ratio; ay.y *= P.ratio;
    // Normal: outward from the crown centre, biased up (soft, sky-lit look).
    const out = c.clone().sub(crownC); out.y /= Math.max(0.2, P.ry); out.normalize();
    const n = new THREE.Vector3(out.x, out.y * 0.6 + 0.4, out.z).normalize();
    // Self-shadowing: depth into the crown and height within it.
    const shell = Math.min(1, c.clone().sub(crownC).setY((c.y - P.cy) / Math.max(0.2, P.ry)).length());
    const ao = 0.42 + 0.5 * shell + 0.25 * THREE.MathUtils.clamp((c.y - P.cy) / P.ry * 0.5 + 0.5, 0, 1);
    const hue = 0.94 + rnd() * 0.12;
    // Every third card also goes into the light crown, 1.55x larger so it covers about as much.
    for (const [set, scale] of i % 3 === 0 ? [[full, 1], [lite, 1.55]] as const : [[full, 1]] as const) {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(ax, a / 2 * scale).addScaledVector(ay, b / 2 * scale));
      for (const k of [0, 1, 2, 0, 2, 3]) {
        set.pos.push(corners[k].x, corners[k].y, corners[k].z);
        set.nrm.push(n.x, n.y, n.z);
        set.uv.push([0, 1, 1, 0][k], [0, 0, 1, 1][k]);
        set.col.push(ao * hue, ao, ao * (2 - hue));
      }
    }
  }
  const geo = (s: typeof full) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(s.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
    return g;
  };
  // `lite`: a third of the cards, for trees beyond the near range and for the shadow pass.
  return { trunk, leaves: geo(full), lite: geo(lite) };
}

/** A double-sided sign panel at height y with planar UVs over its bounds. */
function signFace(g: THREE.BufferGeometry, y: number) {
  const back = g.clone().rotateY(Math.PI).translate(0, 0, -0.012);
  const pos = back.attributes.position, uv = back.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02, 0.02); // plain grey back (corner of the texture)
  void pos;
  return mergeGeometries([g, back])!.translate(0, y, 0);
}

function getShared() {
  if (shared) return shared;
  const m = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g))!;
  const pole = new THREE.CylinderGeometry(0.06, 0.1, 7, 8).translate(0, 3.5, 0);
  const arm = new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6).rotateX(Math.PI / 2).translate(0, 6.9, 0.55);
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8).translate(0, 0.25, 0);
  const seat = new THREE.BoxGeometry(1.8, 0.05, 0.45).translate(0, 0.45, 0);
  const back = new THREE.BoxGeometry(1.8, 0.4, 0.05).translate(0, 0.72, -0.2);
  const legs = [-0.75, 0.75].map(x => new THREE.BoxGeometry(0.06, 0.45, 0.45).translate(x, 0.22, 0));
  // Inverted-U staple racks: a half-hoop on two legs that reach the ground.
  const hoop = (x: number) => mergeGeometries([new THREE.TorusGeometry(0.35, 0.025, 4, 10, Math.PI).translate(x, 0.55, 0), new THREE.CylinderGeometry(0.025, 0.025, 0.55, 5).translate(x - 0.35, 0.275, 0), new THREE.CylinderGeometry(0.025, 0.025, 0.55, 5).translate(x + 0.35, 0.275, 0)].map(g => g.toNonIndexed()))!;
  shared = {
    trees: { spreading: treeTemplate('spreading'), round: treeTemplate('round'), columnar: treeTemplate('columnar') },
    blob: new THREE.IcosahedronGeometry(1, 1).scale(1, 0.4, 1).translate(0, 0.62, 0),
    lamp: m([pole, arm, base]),
    lampHead: new THREE.BoxGeometry(0.35, 0.14, 0.6).translate(0, 6.85, 1.15),
    bench: m([seat, back, ...legs]),
    bollard: m([new THREE.CylinderGeometry(0.11, 0.12, 0.95, 10).translate(0, 0.47, 0), new THREE.SphereGeometry(0.11, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.95, 0)]),
    flagpole: new THREE.CylinderGeometry(0.04, 0.09, 12, 8).translate(0, 6, 0),
    bikeRack: m([hoop(-0.5), hoop(0), hoop(0.5)]),
    bin: new THREE.CylinderGeometry(0.28, 0.25, 0.9, 10).translate(0, 0.45, 0),
    hvac: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    // 2.1 m to the bottom of a 0.75 m (30 in) sign; the face looks along +z toward the driver.
    // Square post centred behind the panel. Panels start at the right angle (thetaStart) rather than
    // being rotated afterwards, so their UVs line up with the drawn sign. Stop: 30 in (0.76 m across
    // flats), bottom edge 7 ft up; yield: 36 in triangle.
    signPost: new THREE.BoxGeometry(0.05, 2.75, 0.05).translate(0, 1.375, -0.04),
    stopFace: signFace(new THREE.CircleGeometry(0.762 / 2 / Math.cos(Math.PI / 8), 8, Math.PI / 8), 2.5),
    yieldFace: signFace(new THREE.CircleGeometry(0.53, 3, -Math.PI / 2), 2.45),
  };
  return shared;
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, set: (i: number, m: THREE.Matrix4) => void, shadows: boolean) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { set(i, m); mesh.setMatrixAt(i, m); }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Objects on this layer are drawn only into the sun's shadow map (see Environment). */
export const SHADOW_ONLY_LAYER = 1;

export interface BuiltChunk {
  base: THREE.Group;
  /** Shown with `detail` but not with `near`: mid-distance stand-ins (light tree crowns). */
  mid: THREE.Group;
  coarse: THREE.Group;
  farOnly: THREE.Group;
  detail: THREE.Group;
  near: THREE.Group;
  /** Far ground paint (roads, lots, pitches draped on the 8 m grid): shown with `coarse` out to the preset's ground distance. */
  ground: THREE.Group;
  /** Tree crowns in ~40 m cells (children carry userData.cell [x, y] and lod 'full' | 'lite'), switched per cell by distance. */
  trees: THREE.Group;
}

const tq = new THREE.Quaternion(), ts = new THREE.Vector3(), tp = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export function addMesh(group: THREE.Group, mb: MeshBuilder, mat: THREE.Material, opts: { cast?: boolean; receive?: boolean; order?: number } = {}) {
  const g = toGeometry(mb);
  if (!g) return;
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = opts.cast ?? false;
  mesh.receiveShadow = opts.receive ?? true;
  if (opts.order !== undefined) mesh.renderOrder = opts.order;
  group.add(mesh);
}

/** Builds a chunk in one go (tests, warm start). */
export function buildChunk(c: ChunkContent, mats: CampusMaterials, ctx: WorldContext, full = true): BuiltChunk {
  const it = buildChunkSteps(c, mats, ctx, full);
  for (let r = it.next(); ; r = it.next()) if (r.done) return r.value;
}

/**
 * Builds a chunk as a sequence of steps; each `yield` is a point where the
 * streamer may pause and continue on a later frame, so building never stalls
 * a frame for long.
 */
/** The groups a chunk only shows close up (within the detail range); a far chunk is built without them. */
export const CLOSE_GROUPS = ['detail', 'near', 'mid', 'trees'] as const;

/** Frees a chunk group's own geometry (shared templates and building models are left alone) and empties it. */
export function disposeGroup(g: THREE.Group) {
  g.traverse((o: THREE.Object3D) => {
    // Instanced prop geometries are shared between chunks; only free per-chunk ones.
    if (o instanceof THREE.InstancedMesh) o.dispose();
    // Building models share geometry with their loaded template; never dispose those.
    else if (o instanceof THREE.Mesh && !o.userData.shared) o.geometry.dispose();
  });
  g.clear();
}

/**
 * `full` = false builds the far form of a chunk: only what is drawn beyond the detail range
 * (buildings, coarse terrain and its ground paint, tree blobs, water). The close-up groups
 * are four fifths of a chunk's geometry (2 m terrain and the surfaces draped on it,
 * markings, curbs, trees, furniture), and with every chunk in view built in full they came
 * to over a gigabyte for content hundreds of metres away. The streamer rebuilds a chunk in
 * full as the camera approaches.
 */
export function* buildChunkSteps(c: ChunkContent, mats: CampusMaterials, ctx: WorldContext, full = true): Generator<void, BuiltChunk, void> {
  const groups = { base: new THREE.Group(), coarse: new THREE.Group(), farOnly: new THREE.Group(), detail: new THREE.Group(), near: new THREE.Group(), mid: new THREE.Group(), ground: new THREE.Group(), trees: new THREE.Group() };
  for (const [k, g] of Object.entries(groups)) g.name = `chunk ${c.cx},${c.cy} ${k}`;
  const { base, coarse, farOnly, detail, near, mid } = groups;
  const T = ctx.terrain;
  const x0 = c.cx * CHUNK_SIZE, y0 = c.cy * CHUNK_SIZE;
  const rnd = (seed: number) => hash(`${c.cx},${c.cy},${seed}`);

  // --- Terrain ---
  for (const [group, lod] of [[near, 1], [coarse, 4]] as const) {
    if (!full && lod === 1) continue;
    const mesh = new THREE.Mesh(T.buildMesh(x0, y0, x0 + CHUNK_SIZE, y0 + CHUNK_SIZE, lod), mats.terrain);
    mesh.receiveShadow = true;
    mesh.renderOrder = LAYER.terrain;
    // The 4 m mesh cuts corners the 2 m-draped roads and walks follow; sinking it keeps
    // it from poking through them at distance.
    if (lod > 1) mesh.position.y = -0.35;
    group.add(mesh);
  }

  yield;
  // --- Ground surfaces ---
  // Ground layers are draped twice: cut along the 2 m terrain grid for the near range,
  // and along an 8 m grid beyond it (true heights, so far markings and decals still sit
  // on them; the coarse terrain there is sunk 0.35 m below), at about a quarter of the
  // triangles. Far walks stop at the detail range, where they are under a pixel wide.
  const coarseGround = { heightAt: (x: number, y: number) => T.heightAt(x, y), grid: { x0, y0, step: 8 } };
  const islands = new MeshBuilder();
  for (const [src, isNear] of [[T, true], [coarseGround, false]] as const) {
    const layers = new Map<string, { mb: MeshBuilder; order: number }>();
    const lb = (mat: string, order: number) => {
      if (!layers.has(mat)) layers.set(mat, { mb: new MeshBuilder(), order });
      return layers.get(mat)!.mb;
    };
    for (const a of c.areas) {
      if (a.outer.length < 3) continue;
      if (a.kind === 'island') { if (isNear) addDrapedPolygon(islands, a.outer, [], T, 0.15, [0.95, 0.95, 0.95], 2); continue; }
      const st = AREA_STYLE[a.kind];
      // Lawns and parks look the same as the terrain's own grass; drawing them again only adds overdraw.
      if (!st || a.kind === 'grass' || a.kind === 'park') continue;
      // A far chunk needs none of the 2 m drape except its water, which is drawn at every distance.
      if (isNear && !full && st.layer !== 'water') continue;
      if (st.layer === 'water') {
        // Water lies level (the banks rise above it), at the lower fifth of the shore heights.
        if (!isNear) continue;
        const hs = resample([...a.outer, a.outer[0]], 2).map(p => T.heightAt(p[0], p[1])).sort((x, y) => x - y);
        addFlatPolygon(lb('water', LAYER.water), a.outer, [], hs[Math.floor(hs.length * 0.2)] - 0.05, st.color, st.uv);
        continue;
      }
      addDrapedPolygon(lb(st.mat, LAYER[st.layer]), a.outer, [], src, LIFT[st.layer as keyof typeof LIFT] ?? 0.03, st.color, st.uv);
      yield;
    }
    if (isNear) for (const w of c.waterways) addDrapedRibbon(lb('water', LAYER.water), w.pts, w.w, src, LIFT.water, AREA_STYLE.water.color, 6);
    let nr = 0;
    for (const r of c.roads) {
      if (isNear && !full) break;
      if (++nr % 40 === 0) yield;
      // Round caps and joins make ways that meet at junctions and bends read as one surface.
      if (r.promenade) addDrapedRibbon(lb('promenade', LAYER.path), r.pts, r.w, src, LIFT.path + 0.002, [1, 1, 1], 3, r.w / 3, 'all');
      else if (DRIVABLE.has(r.cls)) {
        const tp = ctx.tapers?.get(r.id);
        addDrapedRibbon(lb('road', LAYER.road), r.pts, r.w, src, LIFT.road, r.cls === 'construction' ? [1.2, 1.1, 1.0] : [1, 1, 1], 8, r.w / 8, 'all', tp ? p => taperWidth(tp, r.w, p) : undefined);
      }
      else if (PATHS.has(r.cls) && r.cls !== 'steps' && r.fw !== 'crossing' && r.fw !== 'access_aisle' && !ctx.isStub(r)) {
        // Walks are drawn only off the roadway: where a mapped sidewalk strays onto the pavement
        // (road widths are estimates), the road surface wins.
        const pieces = trimNear(r.pts, q => ctx.onRoad(q, -0.6));
        for (const piece of pieces) addDrapedRibbon(lb('path', LAYER.path), piece, r.w, src, LIFT.path, PATH_COLOR[r.cls] ?? PATH_COLOR.default, 1.5, r.w / 1.5, 'all');
      }
    }
    for (const [k, { mb, order }] of layers) addMesh(k === 'water' && isNear ? base : isNear ? near : k === 'path' || k === 'promenade' ? mid : groups.ground, mb, mats.layers[k], { order });
    yield;
  }
  addMesh(detail, islands, mats.curb);

  yield;
  // --- Buildings ---
  const walls = new Map<string, MeshBuilder>();
  const kit: BuildingKit = {
    walls: (style: string) => { if (!walls.has(style)) walls.set(style, new MeshBuilder()); return walls.get(style)!; },
    roofs: new MeshBuilder(), shingles: new MeshBuilder(), numbers: new MeshBuilder(), white: new MeshBuilder(), concrete: new MeshBuilder(), glass: new MeshBuilder(),
    metal: new MeshBuilder(), rail: new MeshBuilder(), timber: new MeshBuilder(), stone: new MeshBuilder(), hvac: [],
    roadAhead: (p, n) => {
      for (let d = 2; d <= 60; d += 2) if (ctx.onRoad([p[0] + n[0] * d, p[1] + n[1] * d])) return d;
      return Infinity;
    },
  };
  let nb = 0;
  const ao = new MeshBuilder(), apron = new MeshBuilder();
  for (const b of c.buildings) {
    // No contact shading under a raised structure (a skybridge): it has no walls at the ground, and
    // the skirt painted a dark band across the plaza beneath it.
    if (b.style !== 'canopy' && !b.minH) wallSkirt(ao, b.outer, T);
    if (hasModel(ctx.models, b)) {
      // Reconstructed model: centroid of the footprint, seated at the ground-floor level.
      const m = ctx.models!.get(slugOf(b.modelName ?? b.name!))!.clone();
      const ring = b.outer, cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const lv = baseLevel(ring, T);
      m.position.set(cx, lv.base, -cy);
      base.add(m);
      // Paving under the whole footprint: the models are open at the ground (arcades, recessed
      // ground floors, glazed lobbies), and the lawn showed under and inside them.
      if (!b.minH) addDrapedPolygon(apron, ring, [], T, LIFT.path + 0.004, [0.96, 0.95, 0.93], 1.5);
      // Foundation from the lowest ground to the ground floor, so no model ever floats on a slope.
      // (left open under any canopy drawn over the footprint: an arcade the cart drives through).
      const over = ctx.buildings.filter(cp => cp.style === 'canopy' && cp.outer.some(p => pointInRing(p, ring)));
      const fr = ensureCCW(insetRing(ring, 0.06) ?? ring);
      for (let i = 0; i < fr.length; i++) {
        const seg = resample([fr[i], fr[(i + 1) % fr.length]], 2);
        for (let k = 0; k < seg.length - 1; k++) {
          const m: Pt = [(seg[k][0] + seg[k + 1][0]) / 2, (seg[k][1] + seg[k + 1][1]) / 2];
          if (over.some(cp => pointInRing(m, cp.outer))) continue;
          addWalls(kit.concrete, [seg[k], seg[k + 1]], lv.lo - 0.6, lv.base + 0.15, [0.84, 0.82, 0.78], false, 2, 1);
        }
      }
      continue;
    }
    buildBuilding(b, T, mats.styles, kit);
    if (++nb % 12 === 0) yield;
  }
  for (const [style, mb] of walls) addMesh(base, mb, mats.facades[style] ?? mats.facades.precast, { cast: true });
  addMesh(base, kit.roofs, mats.roof, { cast: true });
  addMesh(base, kit.shingles, mats.shingle, { cast: true });
  addMesh(base, kit.white, mats.whiteV, { cast: true });
  addMesh(base, kit.concrete, mats.concreteV, { cast: true });
  addMesh(base, kit.glass, mats.curtainGlass);
  addMesh(base, kit.metal, mats.metalV, { cast: true });
  addMesh(detail, kit.rail, mats.metalV);
  addMesh(base, kit.timber, mats.timber, { cast: true });
  addMesh(detail, kit.numbers, mats.numbers);
  addMesh(base, kit.stone, mats.stoneV, { cast: true });
  addMesh(base, apron, mats.layers.path, { order: LAYER.path });
  const hvac = kit.hvac;
  const S = getShared();
  if (hvac.length) detail.add(instanced(S.hvac, mats.hvac, hvac.length, (i, m) => {
    const [x, y, z, sx, yaw] = hvac[i];
    m.compose(tp.set(x, y, z), tq.setFromAxisAngle(UP, yaw), ts.set(sx, 1.4, sx * 0.7));
  }, false));

  yield;
  // --- Markings ---
  const marks = new Map<string, MeshBuilder>([['y', new MeshBuilder()], ['w', new MeshBuilder()]]);
  // Lane lines stop short of intersections, as painted lines do.
  const clear = (pts: Pt[], r: number) => trimNear(pts, q => ctx.junctionNear(q, r));
  const avoid: Pt[] = [...c.crossings.map(cr => cr.pts[Math.floor(cr.pts.length / 2)]), ...c.stops.map(st => st.p)];
  const paved = (p: Pt) => ctx.onRoad(p, -0.35);
  const owns = (p: Pt) => Math.floor(p[0] / CHUNK_SIZE) === c.cx && Math.floor(p[1] / CHUNK_SIZE) === c.cy;
  for (const r of c.roads) {
    if (!DRIVABLE.has(r.cls) || r.cls === 'construction') continue;
    const major = ['secondary', 'tertiary', 'unclassified', 'secondary_link', 'tertiary_link'].includes(r.cls);
    const jr = r.w / 2 + 2.5;
    // The centre line divides the directions, not the pavement: with two lanes one way and one the
    // other it sits a sixth of the width off the middle, and the arrows and stop bars follow it.
    const split = laneSplit(r);
    if (!r.oneway && major && r.w >= 6.5 && !r.noLines) {
      for (const piece of clear(r.pts, jr)) for (const off of [-0.12, 0.12]) addDrapedRibbon(marks.get('y')!, offsetLine(piece, split.line + off), 0.1, T, LIFT.marking, YELLOW, 4);
    }
    const lanes = r.lanes ?? 0;
    if (r.oneway && lanes >= 2 && r.cls !== 'service') for (const piece of clear(r.pts, jr)) for (let k = 1; k < lanes; k++) dashes(marks.get('w')!, offsetLine(piece, -r.w / 2 + r.w * k / lanes), T, WHITE);
    // Lane-use arrows from turn:lanes, placed along the whole way (not the chunk piece).
    const full = r.full ?? r.pts;
    if (r.turnF) laneArrows(marks.get('w')!, full, r.w, r.turnF, r.oneway ? r.lanes ?? 1 : split.f, r.oneway ? 0 : split.b, split.line, T, avoid, owns, paved);
    if (r.turnB) laneArrows(marks.get('w')!, [...full].reverse(), r.w, r.turnB, split.b, split.f, -split.line, T, avoid, owns, paved);
  }
  for (const cr of c.crossings) {
    // Continental crosswalk: 0.6 m bars parallel to the traffic on the road being crossed, 1.2 m
    // apart across it, each as long as the crosswalk is wide. The bars cover the mapped crossing
    // and continue to the curb at both ends (mapped ways often stop short of it), skipping any
    // median, so a crosswalk is never painted half way.
    const mid = cr.pts[Math.floor(cr.pts.length / 2)];
    const t = roadTangentNear(c.roads, mid);
    if (!t || !ctx.onRoad(mid, -0.3)) continue;
    const n: Pt = [-t[1], t[0]];
    // Mapped extent of the crossing across the road, then out to the curb at each end.
    const along = cr.pts.map(p => (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1]);
    let lo = Math.min(0, ...along), hi = Math.max(0, ...along);
    const on = (d: number) => ctx.onRoad([mid[0] + n[0] * d, mid[1] + n[1] * d], -0.3);
    while (!on(lo) && lo < hi) lo += 0.3;
    while (!on(hi) && hi > lo) hi -= 0.3;
    while (lo > -30 && on(lo - 0.3)) lo -= 0.3;
    while (hi < 30 && on(hi + 0.3)) hi += 0.3;
    const span = hi - lo;
    if (span < 2.5) continue;
    const k = Math.max(1, Math.floor((span - 0.6) / 1.2) + 1), start = lo + (span - (k - 1) * 1.2) / 2;
    for (let i = 0; i < k; i++) {
      const q: Pt = [mid[0] + n[0] * (start + i * 1.2), mid[1] + n[1] * (start + i * 1.2)];
      const a: Pt = [q[0] - t[0] * cr.w / 2, q[1] - t[1] * cr.w / 2], b: Pt = [q[0] + t[0] * cr.w / 2, q[1] + t[1] * cr.w / 2];
      if (!ctx.onRoad(a, -0.2) || !ctx.onRoad(b, -0.2)) continue;
      addDrapedRibbon(marks.get('w')!, [a, b], 0.6, T, LIFT.marking, WHITE, 4);
    }
  }
  for (const s of c.stops) {
    // Stop bars only on streets (lot-internal stop points get none), across the approach lanes:
    // the whole width of a one-way road, the right half of a two-way one.
    if (ctx.inParking(s.p)) continue;
    const [dx, dy] = s.dir, nx = -dy, ny = dx;
    const road = nearestRoad(c.roads, s.p), oneway = road?.oneway;
    const side = s.fwd >= 0 ? -1 : 1; // right of travel
    // From the centre line (wherever the lane split puts it) to the kerb. The line's offset is measured
    // to the left of the way's own direction; the stop's `dir` may run either way along it.
    let line = 0;
    if (road && !oneway) {
      const i = Math.max(1, Math.min(road.pts.length - 1, Math.round(road.pts.length / 2)));
      const wx = road.pts[i][0] - road.pts[i - 1][0], wy = road.pts[i][1] - road.pts[i - 1][1];
      line = laneSplit(road).line * (wx * dx + wy * dy >= 0 ? 1 : -1);
    }
    const from = oneway ? -(s.w / 2 - 0.3) * side : line + 0.2 * side;
    const a: Pt = [s.p[0] + nx * from, s.p[1] + ny * from], b: Pt = [s.p[0] + nx * (s.w / 2 - 0.3) * side, s.p[1] + ny * (s.w / 2 - 0.3) * side];
    addDrapedRibbon(marks.get('w')!, [a, b], 0.45, T, LIFT.marking, WHITE, 4);
  }
  // Stop and yield signs on the right of the approaching lane, facing the driver.
  const signs: THREE.Matrix4[] = [], yields: THREE.Matrix4[] = [];
  const placedSigns: Pt[] = [];
  for (const s of c.stops) {
    const sgn = s.fwd >= 0 ? 1 : -1;
    const tx = s.dir[0] * sgn, ty = s.dir[1] * sgn; // travel direction
    const rx = ty, ry = -tx; // right of travel
    // Lot-internal stop points (parking aisles) are not signed; elsewhere the sign goes on the first
    // spot beyond the kerb that is not road, lot, building or walk, and duplicates are dropped.
    if (ctx.inParking(s.p)) continue;
    let p: Pt | null = null;
    for (const off of [0.9, 1.5, 2.2]) {
      const q: Pt = [s.p[0] + rx * (s.w / 2 + off) - tx * 0.6, s.p[1] + ry * (s.w / 2 + off) - ty * 0.6];
      if (ctx.onRoad(q, 0.15) || ctx.inParking(q) || ctx.inBuilding(q) || ctx.inWater(q)) continue;
      if (ctx.onPath(q, -0.3) && off < 2.2) continue;
      p = q;
      break;
    }
    if (!p || placedSigns.some(o => Math.hypot(o[0] - p![0], o[1] - p![1]) < 4)) continue;
    placedSigns.push(p);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0], T.heightAt(p[0], p[1]), -p[1]), new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-tx, ty)), new THREE.Vector3(1, 1, 1));
    (s.kind === 'give_way' ? yields : signs).push(m);
  }
  const Sg = getShared();
  if (signs.length) for (const [geo, mat] of [[Sg.signPost, mats.galvanized], [Sg.stopFace, mats.stopSign]] as const) detail.add(instanced(geo, mat, signs.length, (i, m) => m.copy(signs[i]), true));
  if (yields.length) for (const [geo, mat] of [[Sg.signPost, mats.galvanized], [Sg.yieldFace, mats.yieldSign]] as const) detail.add(instanced(geo, mat, yields.length, (i, m) => m.copy(yields[i]), true));
  // Traffic signals: a mast arm over each approach from its right corner.
  for (const sig of c.signals) for (const ap of sig.approaches) {
    const [tx, ty] = ap.dir, rx = ty, ry = -tx;
    const base: Pt = [sig.p[0] - tx * (ap.w / 2 + 4) + rx * (ap.w / 2 + 1.2), sig.p[1] - ty * (ap.w / 2 + 4) + ry * (ap.w / 2 + 1.2)];
    if (ctx.onRoad(base, -0.3) || ctx.inBuilding(base)) continue;
    signalPole(detail, base, [tx, ty], ap.w, T, mats);
  }
  for (const mb of marks.values()) addMesh(detail, mb, mats.layers.marking, { order: LAYER.marking });

  yield;
  // --- Curbs, bumps, stairs, barriers ---
  const curb = new MeshBuilder();
  // Curb and gutter: a 15 cm concrete curb with a 0.45 m concrete gutter pan on the road side.
  const gutter = new MeshBuilder();
  // Raised medians between split carriageways: 18 cm curbed islands, grass-topped when wide.
  const medGrass = new MeshBuilder();
  for (const m of c.medians) {
    addDrapedStrip(curb, m.pts, m.w, 0.18, T, 0, [0.8, 0.79, 0.76]);
    if (m.w > 2) addDrapedRibbon(medGrass, m.pts, m.w - 0.5, T, 0.185, [0.95, 1.05, 0.9], 6, 1);
  }
  addMesh(base, medGrass, mats.layers.grass, { order: LAYER.marking + 2 });
  // No curbs across a flared road end (see inTaper): they were laid out for the old outline.
  const nearTapers = [...(ctx.tapers?.values() ?? [])].flat().filter(t => Math.abs(t.p[0] - c.center[0]) < CHUNK_SIZE && Math.abs(t.p[1] - c.center[1]) < CHUNK_SIZE);
  const curbLines = !nearTapers.length ? c.curbs : c.curbs.flatMap(l => (l.some(p => nearTapers.some(t => Math.hypot(p[0] - t.p[0], p[1] - t.p[1]) < 60)) ? trimNear(l, p => inTaper(nearTapers, p)) : [l]));
  for (const line of curbLines) {
    addDrapedStrip(curb, line, 0.16, 0.15, T, 0, [0.78, 0.77, 0.74]);
    if (line.length < 2) continue;
    const m = Math.floor(line.length / 2), a = line[Math.max(0, m - 1)], b = line[Math.min(line.length - 1, m)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const side = ctx.onRoad([mid[0] + nx * 0.6, mid[1] + ny * 0.6]) ? 1 : ctx.onRoad([mid[0] - nx * 0.6, mid[1] - ny * 0.6]) ? -1 : 0;
    if (side) addDrapedRibbon(gutter, offsetLine(line, side * 0.31), 0.45, T, LIFT.marking - 0.004, [0.62, 0.61, 0.58], 1.5, 0.3);
  }
  addMesh(detail, curb, mats.curb);
  addMesh(detail, gutter, mats.layers.path, { order: LAYER.marking - 1 });

  const bumps = new MeshBuilder();
  for (const b of c.bumps) {
    const { left, right, base: h0 } = bumpSolid(b, T);
    const stripes = 6;
    for (let i = 0; i < left.length - 1; i++) {
      for (let k = 0; k < stripes; k++) {
        const t0 = k / stripes, t1 = (k + 1) / stripes;
        const lerp = (a: number[], bb: number[], t: number) => a.map((v, j) => v + (bb[j] - v) * t);
        const A = lerp(left[i], right[i], t0), B = lerp(left[i], right[i], t1), C = lerp(left[i + 1], right[i + 1], t1), D = lerp(left[i + 1], right[i + 1], t0);
        const col = k % 2 ? YELLOW : lin([0.12, 0.12, 0.12]);
        bumps.quad(A, B, C, D, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
      }
    }
    for (const row of [left, right]) {
      const p0 = row[0], p1 = row[row.length - 1];
      bumps.quad(p0, p1, [p1[0], h0 - 0.05, p1[2]], [p0[0], h0 - 0.05, p0[2]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], lin([0.15, 0.15, 0.15]));
    }
  }
  addMesh(detail, bumps, mats.bump);

  const stairs = new MeshBuilder(), rails = new MeshBuilder();
  const stepWalks = new MeshBuilder();
  for (const s of c.steps) {
    const blocks = stairBlocks(s, T);
    if (!blocks.length) { addDrapedRibbon(stepWalks, s.pts, s.w, T, LIFT.path, PATH_COLOR.default, 1.5, s.w / 1.5); continue; }
    for (const blk of blocks) boxInto(stairs, blk.center, blk.size, blk.yaw, [1, 1, 1]);
    // Handrails on both sides: posts stand on the outer edge of each tread and the rail
    // follows the nosing line 0.9 m above it, sloping with the flight (no floating rails).
    if (s.handrail || blocks.length >= 4) {
      for (const side of [-1, 1]) {
        const pts: [Pt, number][] = blocks.map(blk => {
          const cs = Math.cos(blk.yaw), sn = Math.sin(blk.yaw);
          const off = side * (blk.size[2] / 2 - 0.12);
          const px = blk.center[0] - sn * off, py = -blk.center[2] + cs * off;
          return [[px, py] as Pt, blk.center[1] + blk.size[1] / 2];
        });
        // Order from the low end to the high end.
        pts.sort((x, y) => x[1] - y[1]);
        for (let i = 0; i < pts.length - 1; i++) railing(rails, pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1], 0.9, [0.55, 0.57, 0.6]);
      }
    }
  }
  addMesh(detail, stairs, mats.stairs, { cast: true });
  addMesh(base, stepWalks, mats.layers.path, { order: LAYER.path });
  addMesh(detail, rails, mats.metalV);

  const fence = new MeshBuilder(), fencePosts = new MeshBuilder(), wallB = new MeshBuilder(), hedge = new MeshBuilder();
  for (const b of c.barriers) {
    if (b.kind === 'fence') {
      const h = b.h ?? 1.8;
      const rp = resample(b.pts, 3);
      let u = 0;
      for (let i = 0; i < rp.length - 1; i++) {
        const a = rp[i], e = rp[i + 1], len = Math.hypot(e[0] - a[0], e[1] - a[1]);
        if (len < 0.05) continue;
        const ha = T.heightAt(a[0], a[1]), he = T.heightAt(e[0], e[1]);
        const n = [-(e[1] - a[1]) / len, 0, -(e[0] - a[0]) / len];
        fence.quad([a[0], ha, -a[1]], [e[0], he, -e[1]], [e[0], he + h, -e[1]], [a[0], ha + h, -a[1]], n, [[u / 0.5, 0], [(u + len) / 0.5, 0], [(u + len) / 0.5, h / 0.5], [u / 0.5, h / 0.5]], [1, 1, 1]);
        boxInto(fencePosts, [a[0], ha + h / 2, -a[1]], [0.06, h + 0.05, 0.06], 0, [1, 1, 1]);
        railSegment(fencePosts, [a[0], ha + h, -a[1]], [e[0], he + h, -e[1]]);
        u += len;
      }
      const last = rp[rp.length - 1];
      boxInto(fencePosts, [last[0], T.heightAt(last[0], last[1]) + h / 2, -last[1]], [0.06, h + 0.05, 0.06], 0, [1, 1, 1]);
    } else if (b.kind === 'hedge') addDrapedStrip(hedge, b.pts, 1.0, b.h ?? 1.2, T, 0, [1, 1, 1]);
    // Garden and retaining walls: low stone seat walls (OSM rarely maps their height).
    else addDrapedStrip(wallB, b.pts, b.kind === 'retaining_wall' ? 0.35 : 0.3, Math.min(b.h ?? 0.6, 0.9), T, 0, lin([0.8, 0.74, 0.64]));
  }
  addMesh(detail, fence, mats.fence);
  addMesh(detail, fencePosts, mats.galvanized);
  addMesh(detail, wallB, mats.wall, { cast: true });
  addMesh(detail, hedge, mats.hedge, { cast: true });

  yield;
  // --- Trees ---
  if (c.trees.length) {
    const byKind: Record<TreeKind, Tree[]> = { spreading: [], round: [], columnar: [] };
    for (const t of c.trees) byKind[treeKind(t)].push(t);
    const col = new THREE.Color();
    const crown = (t: Tree) => {
      const v = hash(`${t[0]}c${t[1]}`);
      // Mostly evergreen live oak / cedar elm greens, some yellowing and bare-brown autumn crowns.
      if (v < 0.78) return col.setHSL(0.22 + v * 0.05, 0.42, 0.33 + v * 0.06);
      if (v < 0.93) return col.setHSL(0.13 + (v - 0.78), 0.45, 0.36);
      return col.setHSL(0.07, 0.3, 0.3);
    };
    const placeTree = (list: Tree[]) => (i: number, m: THREE.Matrix4) => {
      const [x, y, h, r] = list[i];
      m.compose(tp.set(x, T.heightAt(x, y) - 0.05, -y), tq.setFromAxisAngle(UP, hash(`${x},${y}`) * 6.28), ts.set(r, h, r));
    };
    for (const kind of Object.keys(byKind) as TreeKind[]) {
      const list = byKind[kind];
      if (!list.length) continue;
      detail.add(instanced(S.trees[kind].trunk, mats.bark, list.length, placeTree(list), true));
      // The shadow pass always uses the light crown, on a layer only the sun's shadow camera renders.
      const sh = instanced(S.trees[kind].lite, mats.leaves, list.length, placeTree(list), true);
      list.forEach((t, i) => sh.setColorAt(i, crown(t)));
      sh.layers.set(SHADOW_ONLY_LAYER);
      detail.add(sh);
      // Visible crowns per 40 m cell: full crowns near the camera, light ones beyond
      // (the streamer picks per cell, so only trees close by carry the full card count).
      const cells = new Map<string, Tree[]>();
      for (const t of list) { const k = Math.floor(t[0] / 80) + ',' + Math.floor(t[1] / 80); if (!cells.has(k)) cells.set(k, []); cells.get(k)!.push(t); }
      for (const cl of cells.values()) {
        const cx = cl.reduce((s, t) => s + t[0], 0) / cl.length, cy = cl.reduce((s, t) => s + t[1], 0) / cl.length;
        for (const [geo, lod] of [[S.trees[kind].leaves, 'full'], [S.trees[kind].lite, 'lite']] as const) {
          const leaves = instanced(geo, mats.leaves, cl.length, placeTree(cl), false);
          cl.forEach((t, i) => leaves.setColorAt(i, crown(t)));
          leaves.userData.cell = [cx, cy];
          leaves.userData.lod = lod;
          leaves.visible = false;
          groups.trees.add(leaves);
        }
      }
    }
    // Far away every tree is the same low-poly blob: one draw call per chunk.
    const blob = instanced(S.blob, mats.blob, c.trees.length, placeTree(c.trees), false);
    c.trees.forEach((t, i) => blob.setColorAt(i, crown(t).multiplyScalar(0.55)));
    farOnly.add(blob);
    // Trees standing in paving get a mulched tree pit, as on the real plazas and lots.
    const pits = new MeshBuilder();
    for (const t of c.trees) {
      const p: Pt = [t[0], t[1]];
      if (ctx.onPath(p, 0) || ctx.inPlaza(p) || ctx.inParking(p)) addDrapedDisc(pits, p, 1.3, T, LIFT.marking + 0.003, lin([0.36, 0.27, 0.19]), 2, 12);
    }
    addMesh(detail, pits, mats.layers.dirt, { order: LAYER.marking + 1 });
    for (const t of c.trees) aoBlob(ao, t[0], t[1], t[3] * 0.3, t[3] * 0.3, 0, T, 0.45, 14, t[3] * 0.8);
  }
  // Shrub beds along building walls (landscape.ts).
  buildLandscape(c, ctx, mats, detail, groups.trees, getShared().trees.round.lite);
  yield;
  // One occlusion mesh per chunk: wall skirts and tree shadows.
  addMesh(detail, ao, mats.occlusion, { receive: false, order: LAYER.marking + 2 });

  yield;
  // --- Street furniture ---
  const yawOf = (p: Pt, k: number) => rnd(k + Math.round(p[0] * 7 + p[1] * 13)) * 6.28;
  const put = (pts: Pt[], geo: THREE.BufferGeometry, mat: THREE.Material, group: THREE.Group, cast: boolean, salt: number) => {
    if (!pts.length) return;
    group.add(instanced(geo, mat, pts.length, (i, m) => m.compose(tp.set(pts[i][0], T.heightAt(pts[i][0], pts[i][1]), -pts[i][1]), tq.setFromAxisAngle(UP, yawOf(pts[i], salt)), ts.set(1, 1, 1)), cast));
  };
  // Lamp arm orientation is not mapped; a deterministic heading is used.
  put(c.lamps, S.lamp, mats.metal, detail, true, 11);
  put(c.lamps, S.lampHead, mats.lampHead, detail, false, 11);
  // Light pools under the lamp heads (shown at night): 1.15 m out along the arm.
  const pools = new MeshBuilder();
  for (const p of c.lamps) {
    const yaw = yawOf(p, 11);
    aoBlob(pools, p[0] + Math.sin(yaw) * 1.15, p[1] - Math.cos(yaw) * 1.15, 0.01, 0.01, 0, T, 0, 16, 7);
  }
  addMesh(detail, pools, mats.lampPool, { receive: false, order: LAYER.marking + 3 });
  put(c.flagpoles, S.flagpole, mats.galvanized, detail, true, 3);
  put(c.benches, S.bench, mats.wood, near, false, 21);
  put(c.bollards, S.bollard, mats.bollard, near, false, 5);
  put(c.bikeRacks, S.bikeRack, mats.galvanized, near, false, 7);
  put(c.bins, S.bin, mats.metal, near, false, 9);

  yield;
  yield* buildExtras(c, ctx, mats, { base, detail, near, cells: groups.trees });
  buildLandmarks(c, ctx, mats, { base, detail, near }, ctx.buildings);
  if (!full) for (const k of CLOSE_GROUPS) disposeGroup(groups[k]);
  return groups;
}

function treeKind(t: Tree): TreeKind {
  const ratio = t[3] / Math.max(1, t[2]);
  return ratio < 0.2 ? 'columnar' : ratio > 0.55 ? 'spreading' : 'round';
}

function offsetLine(pts: Pt[], off: number): Pt[] {
  if (Math.abs(off) < 1e-3) return pts;
  const { left, right } = ribbonEdges(pts, Math.abs(off) * 2);
  return off > 0 ? left : right;
}

/** The drivable road whose centreline passes nearest to p. */
function nearestRoad(roads: Road[], p: Pt): Road | undefined {
  let best: Road | undefined, bd = Infinity;
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls)) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}

function dashes(mb: MeshBuilder, pts: Pt[], T: Terrain, color: number[]) {
  const rp = resample(pts, 1);
  let d = 0;
  for (let i = 1; i < rp.length; i++) {
    if (d % 12 < 3) addDrapedRibbon(mb, [rp[i - 1], rp[i]], 0.12, T, LIFT.marking, color, 4);
    d += Math.hypot(rp[i][0] - rp[i - 1][0], rp[i][1] - rp[i - 1][1]);
  }
}

export function boxInto(mb: MeshBuilder, c: number[], size: number[], yaw: number, color: number[]) {
  const [hx, hy, hz] = size.map(v => v / 2);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  // Map-space yaw (counter-clockwise from east) -> world: x' = x cos - y sin (east), north' = x sin + y cos.
  const P = (x: number, y: number, z: number) => [c[0] + x * cs - z * sn, c[1] + y, c[2] - (x * sn + z * cs)];
  const N = (x: number, z: number) => [x * cs - z * sn, 0, -(x * sn + z * cs)];
  const f = [
    [P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 1, 0]],
    [P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz), N(1, 0)],
    [P(-hx, -hy, -hz), P(-hx, hy, -hz), P(-hx, hy, hz), P(-hx, -hy, hz), N(-1, 0)],
    [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 1)],
    [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), N(0, -1)],
  ];
  for (const [a, b, cc, d, n] of f) mb.quad(a, b, cc, d, n, [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]], color);
}

/** 5 cm bar between two world points (rails, fence tops, crossbars); slopes with them. */
export function railSegment(mb: MeshBuilder, a: number[], b: number[]) {
  beam(mb, [a[0], -a[2]], [b[0], -b[2]], a[1] - 0.025, b[1] - 0.025, 0.05, 0.05, [1, 1, 1]);
}

function nearestStepTop(blocks: ReturnType<typeof stairBlocks>, p: Pt) {
  let best = 0, bd = Infinity;
  for (const b of blocks) {
    const d = Math.hypot(b.center[0] - p[0], -b.center[2] - p[1]);
    if (d < bd) { bd = d; best = b.center[1] + b.size[1] / 2; }
  }
  return best;
}

/** Walls, roof and rooftop units for one building, seated at the lowest ground point of its footprint. */
export function pointIn(p: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Splits a polyline into the pieces that stay clear of `blocked` points (sampled every metre). */
export function trimNear(pts: Pt[], blocked: (p: Pt) => boolean): Pt[][] {
  const rp = resample(pts, 1);
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of rp) {
    if (blocked(p)) { if (cur.length >= 2) out.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

/**
 * Lane-use arrow outline in lane coordinates (x along travel, y to the left),
 * about 3 m long with a 0.26 m shaft, after the MUTCD pavement-marking arrows.
 * `turn` -1 = left, 1 = right (mirrored), 0 = through.
 */
function arrowOutline(turn: number): Pt[] {
  const hw = 0.13;
  if (turn === 0) return [[-2.4, -hw], [0.2, -hw], [0.2, -0.42], [1.0, 0], [0.2, 0.42], [0.2, hw], [-2.4, hw]];
  // Shaft forward, then a quarter turn of radius 0.9 m to the side, then the head.
  const R = 0.9, pts: Pt[] = [[-2.4, -hw], [-0.6, -hw]];
  for (let k = 1; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; pts.push([-0.6 + (R + hw) * Math.sin(a), R - (R + hw) * Math.cos(a)]); }
  pts.push([0.3 + 0.42, R], [0.3, R + 0.8], [0.3 - 0.42, R]);
  for (let k = 6; k >= 0; k--) { const a = (k / 6) * Math.PI / 2; pts.push([-0.6 + (R - hw) * Math.sin(a), R - (R - hw) * Math.cos(a)]); }
  pts.push([-2.4, hw]);
  return turn < 0 ? pts : pts.map(([x, y]) => [x, -y] as Pt).reverse();
}

/**
 * Lane-use arrows from an OSM turn:lanes value ("left|through;right"), one
 * set per lane, lanes listed left to right. Placed 12 m before the end of the
 * way in the direction of travel, moved back where a crosswalk or stop line
 * is within 4 m. Measured on the whole way (`pts`); only the chunk that
 * `owns` the arrow point draws it. `oppLanes` > 0 means a two-way road (this direction's lanes
 * are right of the centreline).
 */
function laneArrows(mb: MeshBuilder, pts: Pt[], w: number, turns: string, lanes: number, oppLanes: number, line: number, T: Terrain, avoid: Pt[], owns: (p: Pt) => boolean, paved: (p: Pt) => boolean) {
  const spec = turns.split('|');
  const n = Math.max(lanes, spec.length);
  if (pts.length < 2 || n < 1) return;
  // Every lane is the same width; this direction's lanes lie to the right of the centre line, which is
  // `line` to the left of the middle (see laneSplit).
  const lw = w / (n + oppLanes);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const at = (d: number) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + l >= d) { const t = (d - acc) / l; return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Pt, u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as Pt }; }
      acc += l;
    }
    return null;
  };
  let r: ReturnType<typeof at> = null;
  for (let back = 12; back <= 24; back += 4) {
    if (len < back + 6) return;
    const q = at(len - back);
    if (q && !avoid.some(a => Math.hypot(a[0] - q.p[0], a[1] - q.p[1]) < 4 + w / 2)) { r = q; break; }
  }
  if (!r || !owns(r.p)) return;
  const { p, u } = r, left: Pt = [-u[1], u[0]];
  spec.forEach((s, i) => {
    // Lane centre, measured to the left of the way's centreline.
    const off = oppLanes ? line - lw * (i + 0.5) : w / 2 - lw * (i + 0.5);
    const kinds = new Set(s.split(';').map(k => k.trim()).filter(Boolean).map(k => (/left/.test(k) ? -1 : /right/.test(k) ? 1 : 0)));
    if (s.trim() === '' || s.trim() === 'none') return;
    for (const turn of kinds) {
      const poly = arrowOutline(turn).map(([x, y]): Pt => [p[0] + u[0] * x + left[0] * (y + off), p[1] + u[1] * x + left[1] * (y + off)]);
      // Only where the whole arrow lies on the pavement (estimated widths can put a lane over the curb).
      if (!poly.every(paved)) continue;
      addDrapedPolygon(mb, poly, [], T, LIFT.marking + 0.002, WHITE, 4);
    }
  });
}

/** Galvanized mast-arm signal: pole on the corner, arm over the approach, one head per lane. */
function signalPole(group: THREE.Group, base: Pt, dir: Pt, w: number, T: Terrain, mats: CampusMaterials) {
  const mb = new MeshBuilder(), heads = new MeshBuilder();
  const y = T.heightAt(base[0], base[1]);
  const left: Pt = [-dir[1], dir[0]];
  boxInto(mb, [base[0], y + 3.4, -base[1]], [0.26, 6.8, 0.26], 0, [1, 1, 1]);
  const armLen = Math.min(12, w * 0.75 + 1.5);
  const end: Pt = [base[0] + left[0] * armLen, base[1] + left[1] * armLen];
  railSegment(mb, [base[0], y + 6.4, -base[1]], [end[0], y + 6.1, -end[1]]);
  const yaw = Math.atan2(dir[1], dir[0]);
  for (const f of [0.45, 0.85]) {
    const hp: Pt = [base[0] + left[0] * armLen * f, base[1] + left[1] * armLen * f];
    boxInto(heads, [hp[0], y + 5.6, -hp[1]], [0.36, 1.1, 0.36], yaw, [0.05, 0.05, 0.04]);
    // Lenses face oncoming traffic (against dir): red, amber, green, with green lit.
    for (const [k, col] of [[0, [0.25, 0.02, 0.02]], [1, [0.3, 0.2, 0.02]], [2, [0.1, 1.6, 0.4]]] as const) {
      const lp: Pt = [hp[0] - dir[0] * 0.19, hp[1] - dir[1] * 0.19];
      boxInto(heads, [lp[0], y + 5.95 - k * 0.34, -lp[1]], [0.04, 0.24, 0.24], yaw, col as unknown as number[]);
    }
  }
  addMesh(group, mb, mats.galvanized, { cast: true });
  addMesh(group, heads, mats.signalHead);
}

/** Unit direction of the drivable road nearest to p (within 12 m), or null. */
function roadTangentNear(roads: Road[], p: Pt): Pt | null {
  let best: Pt | null = null, bd = 12;
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(a[0] + dx * u - p[0], a[1] + dy * u - p[1]);
      if (d < bd) { bd = d; const l = Math.sqrt(l2); best = [dx / l, dy / l]; }
    }
  }
  return best;
}
