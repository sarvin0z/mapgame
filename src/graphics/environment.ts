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
  golden: { elev: 8, azim: 262, color: 0xffa860, intensity: 4.4, hemi: [0x8c98e0, 0x5a4636, 1.05], fog: 0xc0a4b8, turbidity: 3.0, rayleigh: 3.6, mie: 0.0035, env: 0.42, exposure: 0.98 },
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
    // Fill only pixels the depth-writing terrain and building atlas passes left empty.
    this.sky.renderOrder = LAYER.terrain + 2;
    this.sky.material.vertexShader = this.sky.material.vertexShader.replace('gl_Position.z = gl_Position.w;',
      `#ifdef USE_REVERSED_DEPTH_BUFFER
        gl_Position.z = 0.0;
      #else
        gl_Position.z = gl_Position.w;
      #endif`);
    this.sky.material.uniforms.mieDirectionalG.value = 0.78;
    // The stock sun disc is ~760x brighter than the sky, which blew out the bloom pass and
    // blinded the driver when heading toward the sun (Field Street at dusk). Keep a visible
    // disc but below the bloom threshold.
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace('( 760.0 * sundisc )', '( 10.0 * sundisc )');
    // A deeper, more saturated blue overhead (the stock output reads pale after filmic tone mapping).
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );',
      `float skyL = dot(clearSky, vec3(0.2126, 0.7152, 0.0722));
      vec3 sd = normalize(vWorldPosition - cameraPosition);
      float hgt = clamp(sd.y, 0.0, 1.0);
      float sunward = clamp(dot(normalize(sd.xz + 1e-5), normalize(vSunDirection.xz + 1e-5)) * 0.5 + 0.5, 0.0, 1.0);
      vec3 horizonC = mix(vec3(0.95, 0.52, 0.55), vec3(1.0, 0.62, 0.26), pow(sunward, 2.0));
      vec3 bandC = vec3(1.0, 0.42, 0.62);
      vec3 topC = vec3(0.3, 0.36, 1.0);
      vec3 art = mix(horizonC, bandC, smoothstep(0.02, 0.14, hgt));
      art = mix(art, topC, smoothstep(0.08, 0.38, hgt));
      art /= max(0.05, dot(art, vec3(0.2126, 0.7152, 0.0722)));
      // Clear sky steered to the sunset gradient; the clouds (their difference from the clear
      // sky) are added back on top, lit warm pink-orange, brighter toward the sun.
      vec3 graded = mix(max(mix(vec3(skyL), clearSky, 1.25), 0.0), skyL * art * mix(1.05, 0.8, smoothstep(0.1, 0.6, hgt)), sunsetGrade);
      vec3 cloudPart = texColor - clearSky;
      float cloudL = dot(cloudPart, vec3(0.2126, 0.7152, 0.0722));
      graded += cloudL * mix(vec3(1.25, 0.62, 0.7), vec3(1.5, 0.8, 0.45), sunward) * 2.2 + cloudPart * 0.3;
      gl_FragColor = vec4(graded * 0.82 + nightGlow * vec3(0.012, 0.02, 0.045), 1.0);`);
    this.sky.material.fragmentShader = 'uniform float sunsetGrade;\n' + this.sky.material.fragmentShader
      .replace('vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );',
        'vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );\nvec3 clearSky = texColor;');
    this.sky.material.uniforms.sunsetGrade = { value: 0.82 };
    // Scattered cirrus that the low sun lights pink and orange.
    for (const [k, v] of [['cloudCoverage', 0.5], ['cloudDensity', 0.55], ['cloudScale', 0.00016], ['cloudElevation', 0.6]] as const)
      if (this.sky.material.uniforms[k]) this.sky.material.uniforms[k].value = v;
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
    const step = 50, radius = 6000;
    const axis = (lo: number, hi: number) => {
      const center = Math.trunc((lo + hi) / (2 * step)) * step;
      const samples: number[] = [];
      for (let offset = -radius; offset <= radius; offset += step) {
        const p = center + offset;
        // Keep the original edge sampling near the streamed map. The distant skirt
        // changes only gradually as it fades into the fog.
        if ((p >= lo - 300 && p <= hi + 300) || (offset + radius) % (4 * step) === 0) samples.push(p);
      }
      return samples;
    };
    const xs = axis(cx0, cx1), ys = axis(cy0, cy1).reverse();
    const g = new THREE.PlaneGeometry(1, 1, xs.length - 1, ys.length - 1);
    const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = xs[i % xs.length], y = ys[Math.floor(i / xs.length)];
      const inside = x > cx0 + 1 && x < cx1 - 1 && y > cy0 + 1 && y < cy1 - 1;
      const out = Math.hypot(Math.max(cx0 - x, 0, x - cx1), Math.max(cy0 - y, 0, y - cy1));
      const edge = terrain.heightAt(Math.min(Math.max(x, cx0), cx1), Math.min(Math.max(y, cy0), cy1));
      const t = THREE.MathUtils.smoothstep(out, 0, 1500);
      pos.setXYZ(i, x, inside ? edge - 6 : edge + (avg - edge) * t - 0.05, -y);
      uv.setXY(i, x / 6, y / 6);
    }
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, mats.terrain);
    ground.renderOrder = LAYER.terrain + 1;
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

  /** Sets the half-width (m) of the sun's shadow area. */
  setShadowExtent(e: number) {
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -e;
    s.right = s.top = e;
    s.far = 600;
    s.updateProjectionMatrix();
  }

  setViewDistance(d: number) {
    const fog = this.scene.fog as THREE.Fog;
    fog.far = d * 1.25;
    fog.near = d * 0.6;
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
