// Final colour grade, applied after tone mapping and sRGB output: a gentle
// contrast curve, a little saturation, warm highlights over cool shadows and a
// soft vignette, for a filmic look without changing scene exposure.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export function gradePass() {
  return new ShaderPass(new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, strength: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec3 g = c;
        float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g = mix(vec3(l), g, 1.08);                                   // saturation
        g = mix(g, g * g * (3.0 - 2.0 * g), 0.3);                    // contrast S-curve
        g += mix(vec3(-0.014, -0.002, 0.018), vec3(0.03, 0.012, -0.02), smoothstep(0.1, 0.8, l)); // split tone
        vec2 d = vUv - 0.5;
        g *= 1.0 - 0.16 * smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0))); // vignette
        gl_FragColor = vec4(mix(c, clamp(g, 0.0, 1.0), strength), 1.0);
      }`,
  }));
}
