// Chase, first-person (driver seat) and free-fly cameras.
import * as THREE from 'three';
import type { Input } from '../input.ts';
import type { GolfCart } from '../vehicle/golfCart.ts';

export type CameraMode = 'chase' | 'cockpit' | 'free';
const MODES: CameraMode[] = ['chase', 'cockpit', 'free'];

export class CameraRig {
  mode: CameraMode = 'chase';
  private chaseDist = 5.5;
  private orbitYaw = 0;
  private orbitPitch = 0.28;
  private lastOrbit = -10;
  private lookYaw = 0;
  private lookPitch = 0;
  private freeYaw = 0;
  private freePitch = -0.3;
  private smoothedPos = new THREE.Vector3();
  private smoothedYaw = 0;
  private initialized = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');

  /**
   * Distance along the ray from `from` toward `to` at which something solid (a wall, a
   * parked car) blocks it, or null when clear. The chase camera moves in front of it.
   */
  obstruct?: (from: THREE.Vector3, to: THREE.Vector3) => number | null;
  private pivot = new THREE.Vector3();

  /** `groundAt(x, z)` is the terrain height under a world point; cameras stay above it. */
  constructor(public camera: THREE.PerspectiveCamera, private input: Input, private groundAt: (x: number, z: number) => number = () => 0) {}

  /** Free camera placed at `pos` looking at `target` (used for scripted views and checks). */
  lookFrom(pos: THREE.Vector3, target: THREE.Vector3) {
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.setMode('free');
  }

  cycle() {
    const i = (MODES.indexOf(this.mode) + 1) % MODES.length;
    this.setMode(MODES[i]);
  }

  setMode(m: CameraMode) {
    if (m === 'free') {
      this.e.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.freeYaw = this.e.y;
      this.freePitch = this.e.x;
    }
    this.mode = m;
    this.lookYaw = this.lookPitch = 0;
  }

  update(cart: GolfCart, dt: number, time: number) {
    const { dx, dy, wheel } = this.input.consumeMouse();
    const cam = this.camera;
    const cartPos = cart.position(this.tmp);
    const fwd = cart.forward(this.tmp2);
    const cartYaw = Math.atan2(fwd.x, fwd.z);
    // Wider field of view from the driver's seat, as a driver's peripheral vision would give.
    const fov = this.mode === 'cockpit' ? 82 : 62;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }

    if (this.mode === 'chase') {
      if (dx || dy) { this.orbitYaw -= dx * 0.005; this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.004, -0.05, 1.3); this.lastOrbit = time; }
      if (wheel) this.chaseDist = THREE.MathUtils.clamp(this.chaseDist * (1 + wheel * 0.001), 3.5, 40);
      // Return behind the cart a couple of seconds after the user stops orbiting.
      if (time - this.lastOrbit > 2.5 && !this.input.dragging) this.orbitYaw *= Math.exp(-dt * 1.5);
      if (!this.initialized) { this.smoothedYaw = cartYaw; this.initialized = true; }
      let dyaw = cartYaw - this.smoothedYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.smoothedYaw += dyaw * (1 - Math.exp(-dt * 4));
      const yaw = this.smoothedYaw + this.orbitYaw;
      const d = this.chaseDist;
      const target = new THREE.Vector3(
        cartPos.x - Math.sin(yaw) * Math.cos(this.orbitPitch) * d,
        cartPos.y + 1.0 + Math.sin(this.orbitPitch) * d,
        cartPos.z - Math.cos(yaw) * Math.cos(this.orbitPitch) * d,
      );
      if (this.smoothedPos.lengthSq() === 0) this.smoothedPos.copy(target);
      this.smoothedPos.lerp(target, 1 - Math.exp(-dt * 10));
      this.smoothedPos.y = Math.max(this.smoothedPos.y, this.groundAt(this.smoothedPos.x, this.smoothedPos.z) + 0.4);
      cam.position.copy(this.smoothedPos);
      // Keep the cart in view: when a wall or parked car is between the cart and the camera,
      // bring the camera in front of it and up over the cart, never closer than 2.2 m.
      const pivot = this.pivot.set(cartPos.x, cartPos.y + 1.2, cartPos.z);
      const hit = this.obstruct?.(pivot, cam.position);
      let pulled = 0;
      if (hit !== null && hit !== undefined) {
        const full = cam.position.distanceTo(pivot), keep = Math.max(2.2, hit - 0.35);
        if (keep < full) { pulled = 1 - keep / full; cam.position.sub(pivot).multiplyScalar(keep / full).add(pivot); cam.position.y += pulled * 2.6; }
      }
      // Pulled in, the camera looks past the cart at the way ahead rather than down at its roof.
      cam.lookAt(cartPos.x + fwd.x * pulled * 8, cartPos.y + 1.2, cartPos.z + fwd.z * pulled * 8);
    } else if (this.mode === 'cockpit') {
      if (dx || dy) { this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.004, -2.4, 2.4); this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.004, -1, 0.8); this.lastOrbit = time; }
      if (time - this.lastOrbit > 3 && !this.input.dragging) { this.lookYaw *= Math.exp(-dt * 2); this.lookPitch *= Math.exp(-dt * 2); }
      const root = cart.model.root;
      root.updateMatrixWorld();
      cam.position.copy(cart.model.driverEye).applyMatrix4(root.matrixWorld);
      this.e.set(this.lookPitch - 0.12, Math.PI + this.lookYaw, 0, 'YXZ');
      cam.quaternion.copy(root.quaternion).multiply(this.q.setFromEuler(this.e));
    } else {
      if (dx || dy) { this.freeYaw -= dx * 0.004; this.freePitch = THREE.MathUtils.clamp(this.freePitch - dy * 0.004, -1.55, 1.55); }
      const k = this.input.keys;
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 80 : 18) * dt;
      this.e.set(this.freePitch, this.freeYaw, 0, 'YXZ');
      cam.quaternion.setFromEuler(this.e);
      const move = new THREE.Vector3(
        (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
        (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
        (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0),
      );
      if (wheel) move.z += wheel * 0.02;
      move.applyQuaternion(cam.quaternion).multiplyScalar(speed);
      cam.position.add(move);
      cam.position.y = Math.max(cam.position.y, this.groundAt(cam.position.x, cam.position.z) + 0.3);
    }
  }
}
