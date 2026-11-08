// Baked ambient occlusion as ground decals: a soft darkening of the ground
// around building walls and under cars, trees and the cart. The decals are
// multiplied onto whatever is drawn beneath them (vertex colour 1 = no change),
// which grounds objects the way screen-space AO would, at the cost of a few
// triangles instead of an extra full-screen pass.
import * as THREE from 'three';
import type { Pt } from './campusData.ts';
import type { Terrain } from './terrain.ts';
import { MeshBuilder, ensureCCW } from './geometry.ts';

/** Height above the ground surface: above road markings (see LIFT in campusBuilder). */
const LIFT = 0.07;

/** Black, with opacity 1 - (vertex colour): blends like a multiply by the vertex colour. */
export function occlusionMaterial() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor = vec4(0.0, 0.0, 0.0, 1.0 - vColor.r);');
  };
  return m;
}

function push(mb: MeshBuilder, p: number[], c: number) {
  mb.pos.push(p[0], p[1], p[2]);
  mb.nrm.push(0, 1, 0);
  mb.uv.push(0, 0);
  mb.col.push(c, c, c);
}

/**
 * A band along the outside of a footprint, darkest (`dark`) at the wall and
 * fading out `width` metres away. Overlapping corners darken a little more,
 * as real corners do.
 */
export function wallSkirt(mb: MeshBuilder, ring: Pt[], T: Terrain, width = 3.5, dark = 0.32, base?: number) {
  const r = ensureCCW(ring);
  const y = (p: Pt) => (base !== undefined ? Math.max(base, T.heightAt(p[0], p[1])) : T.heightAt(p[0], p[1])) + LIFT;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.3) continue;
    // Outward normal of a CCW ring is to the right of the edge direction.
    const nx = dy / len * width, ny = -dx / len * width;
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps;
      const p0: Pt = [a[0] + dx * t0, a[1] + dy * t0], p1: Pt = [a[0] + dx * t1, a[1] + dy * t1];
      const q0: Pt = [p0[0] + nx, p0[1] + ny], q1: Pt = [p1[0] + nx, p1[1] + ny];
      const P0 = [p0[0], y(p0), -p0[1]], P1 = [p1[0], y(p1), -p1[1]], Q0 = [q0[0], y(q0), -q0[1]], Q1 = [q1[0], y(q1), -q1[1]];
      push(mb, P0, dark); push(mb, Q0, 1); push(mb, Q1, 1);
      push(mb, P0, dark); push(mb, Q1, 1); push(mb, P1, dark);
    }
  }
}

/**
 * A soft elliptical shadow centred at map point (x, y): uniformly `dark` over
 * half-extents hx (local x, see `yaw`, a rotation about +y as used for
 * instances) and hy (local z), fading to nothing `fade` metres beyond.
 */
export function blob(mb: MeshBuilder, x: number, y: number, hx: number, hy: number, yaw: number, T: Terrain, dark = 0.5, seg = 12, fade = 1) {
  // Instance yaw rotates local +z (map -north) about +y; local x/z axes in map coordinates:
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, lz: number): number[] => {
    const wx = x + lx * c + lz * s, wz = -y - lx * s + lz * c;
    return [wx, T.heightAt(wx, -wz) + LIFT, wz];
  };
  const C = at(0, 0);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const i0 = at(Math.cos(a0) * hx, Math.sin(a0) * hy), i1 = at(Math.cos(a1) * hx, Math.sin(a1) * hy);
    const o0 = at(Math.cos(a0) * (hx + fade), Math.sin(a0) * (hy + fade)), o1 = at(Math.cos(a1) * (hx + fade), Math.sin(a1) * (hy + fade));
    push(mb, C, dark); push(mb, i1, dark); push(mb, i0, dark);
    push(mb, i0, dark); push(mb, i1, dark); push(mb, o1, 1);
    push(mb, i0, dark); push(mb, o1, 1); push(mb, o0, 1);
  }
}

/** A flat contact-shadow blob in local coordinates (x right, z forward) at y = 0, for a moving object such as the cart. */
export function blobGeometry(hx: number, hz: number, dark = 0.45) {
  const mb = new MeshBuilder();
  blob(mb, 0, 0, hx, hz, 0, { heightAt: () => -LIFT } as unknown as Terrain, dark, 20, 0.7);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(mb.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(mb.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(mb.col, 3));
  return g;
}

/** Shared night switch (0 by day, 1 at night) for lamp pools and lit windows. */
export const nightUniform = { value: 0 };

/**
 * Warm light pools under street lamps at night: additive, brightest under the
 * head and fading out. Geometry comes from `blob` with dark = 0 (centre 0,
 * rim 1), so the brightness is 1 - vertex colour.
 */
export function lampPoolMaterial() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: true, blending: THREE.AdditiveBlending });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <color_fragment>', 'float pool = 1.0 - vColor.r; diffuseColor = vec4(vec3(1.0, 0.72, 0.42) * pool * pool * 0.2 * uNight, 1.0);');
  };
  return m;
}
