// Final colour grade, applied after tone mapping and sRGB output: a gentle
// contrast curve, a little saturation and warm highlights over cool shadows,
// for a filmic look without changing scene exposure.
//
// By day the grade runs inside every material's own fragment shader
// (`installInlineGrade`), so the frame is drawn straight to the canvas with no
// post-processing chain at all: on an integrated GPU the HDR target, its MSAA
// resolve and two full-screen passes cost about 3.5 ms a frame for the same
// picture. The full-screen pass below is only used when bloom is on (night,
// High), where the scene has to go through an HDR target anyway. The vignette
// is the #vignette element in the page in both cases.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GRADE = /* glsl */ `
  vec3 gradeColor(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 g = mix(vec3(l), c, 1.08);                              // saturation
    g = mix(g, g * g * (3.0 - 2.0 * g), 0.3);                    // contrast S-curve
    g += mix(vec3(-0.014, -0.002, 0.018), vec3(0.03, 0.012, -0.02), smoothstep(0.1, 0.8, l)); // split tone
    return clamp(g, 0.0, 1.0);
  }`;

let installed = false;
/**
 * Adds the grade to the end of every built-in material's fragment shader. It only takes
 * effect where the renderer tone-maps, which is when drawing to the canvas: renders into
 * a render target (the bloom chain, the sky probe, shadow maps) are left linear. Call
 * before the first material compiles.
 */
export function installInlineGrade() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.colorspace_pars_fragment += `
#ifdef TONE_MAPPING
${GRADE}
#endif`;
  THREE.ShaderChunk.colorspace_fragment += `
#ifdef TONE_MAPPING
  gl_FragColor.rgb = gradeColor(clamp(gl_FragColor.rgb, 0.0, 1.0));
#endif`;
}

export function gradePass() {
  return new ShaderPass(new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    // Not tone-mapped: as the last pass it draws to the canvas, where the renderer would otherwise
    // add the inline grade's own copy of gradeColor to this shader (a redefinition, so it failed to compile).
    toneMapped: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; varying vec2 vUv;
      ${GRADE}
      void main() { gl_FragColor = vec4(gradeColor(clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0)), 1.0); }`,
  }));
}
