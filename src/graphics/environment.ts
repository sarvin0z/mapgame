// Sky, sun, ambient light, fog and the base ground plane.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { LAYER, type CampusMaterials } from '../world/campusBuilder.ts';
import type { Terrain } from '../world/terrain.ts';
import { CHUNK_SIZE } from '../world/chunks.ts';

export type TimeOfDay = 'golden' | 'day' | 'night';

/**
 * Lighting per time of day. At night the key light is the moon (the sky
 * shader is given a sun below the horizon); street lamps and lit windows
 * are switched on by the caller through `night`.
 */
const TIMES: Record<TimeOfDay, {
  elev: number; azim: number; skySun?: number; color: number; intensity: number;
  hemi: [number, number, number]; fog: number; turbidity: number; rayleigh: number; mie: number; env: number; exposure: number;
}> = {
  // Golden hour: a low sun in the west-south-west, as on a Dallas autumn evening.
  golden: { elev: 21, azim: 242, color: 0xffc285, intensity: 4.6, hemi: [0xa8c0e4, 0x5c4632, 0.42], fog: 0xe2d2bc, turbidity: 3.2, rayleigh: 3.0, mie: 0.0025, env: 0.22, exposure: 0.95 },
  day: { elev: 52, azim: 200, color: 0xfff3e2, intensity: 4.0, hemi: [0xc4dafa, 0x6b6150, 0.5], fog: 0xd8e3ee, turbidity: 2.6, rayleigh: 1.6, mie: 0.0025, env: 0.2, exposure: 0.9 },
  night: { elev: 38, azim: 140, skySun: -9, color: 0x9fb4e0, intensity: 0.85, hemi: [0x40548a, 0x221d17, 0.85], fog: 0x101826, turbidity: 2, rayleigh: 1.2, mie: 0.002, env: 0.6, exposure: 1.45 },
};

export class Environment {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  sunDir = new THREE.Vector3();
  time: TimeOfDay = 'golden';
  /** 0 by day, 1 at night: drives lamps, lit windows and headlights. */
  night = 0;
  private pmrem: THREE.PMREMGenerator;
  private skyCopy: Sky;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, mats: CampusMaterials, terrain: Terrain) {
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.sky.renderOrder = -100; // before the depth-less ground layers
    this.sky.material.uniforms.mieDirectionalG.value = 0.78;
    // The stock sun disc is ~760x brighter than the sky, which blew out the bloom pass and
    // blinded the driver when heading toward the sun (Field Street at dusk). Keep a visible
    // disc but below the bloom threshold.
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace('( 760.0 * sundisc )', '( 10.0 * sundisc )');
    // A deeper, more saturated blue overhead (the stock output reads pale after filmic tone mapping).
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );',
      'float skyL = dot(texColor, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(max(mix(vec3(skyL), texColor, 1.25), 0.0) * 0.82 + nightGlow * vec3(0.012, 0.02, 0.045), 1.0);');
    // Night: a deep navy floor so the sky is not pure black (moonlit haze).
    this.sky.material.fragmentShader = 'uniform float nightGlow;\n' + this.sky.material.fragmentShader;
    this.sky.material.uniforms.nightGlow = { value: 0 };
    scene.add(this.sky);

    // Image-based lighting from a copy of the same sky (rebuilt by setTime).
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.skyCopy = new Sky();
    this.skyCopy.scale.setScalar(10000);

    this.hemi = new THREE.HemisphereLight();
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -70;
    s.right = s.top = 70;
    s.near = 10;
    s.far = 500;
    s.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    // Shadow-only stand-ins (light tree crowns) live on layer 1.
    this.sun.shadow.camera.layers.enable(1);
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog(0xe2d2bc, 400, 1700);
    this.setTime('golden', renderer);

    // Beyond the streamed terrain: a coarse skirt that continues the edge heights
    // and relaxes to the average edge height far away, under the fog. Inside
    // the streamed area it is sunk well below the terrain.
    const m = terrain.meta;
    let sum = 0, n = 0;
    for (let i = 0; i < m.nx; i += 8) { sum += terrain.heights[i] + terrain.heights[(m.ny - 1) * m.nx + i]; n += 2; }
    for (let j = 0; j < m.ny; j += 8) { sum += terrain.heights[j * m.nx] + terrain.heights[j * m.nx + m.nx - 1]; n += 2; }
    const avg = sum / n;
    const C = CHUNK_SIZE;
    const cx0 = Math.floor(m.x0 / C) * C, cy0 = Math.floor(m.y0 / C) * C;
    const cx1 = Math.floor((m.x0 + (m.nx - 1) * m.step) / C) * C + C, cy1 = Math.floor((m.y0 + (m.ny - 1) * m.step) / C) * C + C;
    const S = 50, R = 6000;
    const g = new THREE.PlaneGeometry(2 * R, 2 * R, (2 * R) / S, (2 * R) / S).rotateX(-Math.PI / 2);
    g.translate((cx0 + cx1) / 2 - ((cx0 + cx1) / 2) % S, 0, -((cy0 + cy1) / 2 - ((cy0 + cy1) / 2) % S));
    const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = -pos.getZ(i);
      const inside = x > cx0 + 1 && x < cx1 - 1 && y > cy0 + 1 && y < cy1 - 1;
      const out = Math.hypot(Math.max(cx0 - x, 0, x - cx1), Math.max(cy0 - y, 0, y - cy1));
      const edge = terrain.heightAt(Math.min(Math.max(x, cx0), cx1), Math.min(Math.max(y, cy0), cy1));
      const t = THREE.MathUtils.smoothstep(out, 0, 1500);
      pos.setY(i, inside ? edge - 6 : edge + (avg - edge) * t - 0.05);
      uv.setXY(i, x / 6, y / 6);
    }
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, mats.terrain);
    ground.renderOrder = LAYER.terrain - 1;
    ground.receiveShadow = true;
    ground.name = 'skirt';
    scene.add(ground);
  }

  /** Sun or moon, sky, ambient light, fog and the reflection probe for a time of day. */
  setTime(t: TimeOfDay, renderer: THREE.WebGLRenderer) {
    const P = TIMES[t];
    this.time = t;
    this.night = t === 'night' ? 1 : 0;
    this.sky.material.uniforms.nightGlow.value = this.night;
    const dir = (elev: number, azim: number, out: THREE.Vector3) => {
      const e = elev * THREE.MathUtils.DEG2RAD, a = azim * THREE.MathUtils.DEG2RAD; // azimuth clockwise from north
      return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    };
    dir(P.elev, P.azim, this.sunDir);
    const skySun = dir(P.skySun ?? P.elev, P.skySun !== undefined ? P.azim + 180 : P.azim, new THREE.Vector3());
    for (const sky of [this.sky, this.skyCopy]) {
      const u = sky.material.uniforms;
      u.turbidity.value = P.turbidity;
      u.rayleigh.value = P.rayleigh;
      u.mieCoefficient.value = P.mie;
      u.mieDirectionalG.value = 0.78;
      u.sunPosition.value.copy(skySun);
    }
    this.sun.color.set(P.color);
    this.sun.intensity = P.intensity;
    this.hemi.color.set(P.hemi[0]);
    this.hemi.groundColor.set(P.hemi[1]);
    this.hemi.intensity = P.hemi[2];
    (this.scene.fog as THREE.Fog).color.set(P.fog);
    renderer.toneMappingExposure = P.exposure;
    const skyScene = new THREE.Scene();
    skyScene.add(this.skyCopy);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(skyScene);
    this.scene.environment = this.envRT.texture;
    // The sky probe includes the sun disc, which would light shadowed areas as if
    // they were sunlit; keep it for reflections and soft fill only.
    this.scene.environmentIntensity = P.env;
  }

  setViewDistance(d: number) {
    const fog = this.scene.fog as THREE.Fog;
    fog.far = d * 1.05;
    fog.near = d * 0.45;
  }

  /** Centres the shadow camera on `focus`, snapped to whole shadow-map texels so shadow edges don't crawl as the cart moves. */
  follow(focus: THREE.Vector3) {
    const cam = this.sun.shadow.camera, texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const right = this.snapR.crossVectors(this.sunDir, THREE.Object3D.DEFAULT_UP).normalize();
    const up = this.snapU.crossVectors(right, this.sunDir).normalize();
    const a = Math.round(focus.dot(right) / texel) * texel, b = Math.round(focus.dot(up) / texel) * texel, d = focus.dot(this.sunDir);
    const f = this.snapF.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(this.sunDir, d);
    this.sun.position.copy(f).addScaledVector(this.sunDir, 250);
    this.sun.target.position.copy(f);
  }
  private snapR = new THREE.Vector3();
  private snapU = new THREE.Vector3();
  private snapF = new THREE.Vector3();
}
