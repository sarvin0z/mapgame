// Golf cart rigid body + Rapier raycast vehicle controller, driven by the
// electric powertrain model. Visual model follows the physics each frame.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Rapier } from '../physics/physicsWorld.ts';
import { type GolfCartConfig, ackermann, centerAngleForMax } from './config.ts';
import { computeLongitudinal, type DriverInput, type Gear } from './powertrain.ts';
import type { CartModel } from './cartModel.ts';

const UP_AXIS = 1;
const FORWARD_AXIS = 2;

export class GolfCart {
  body: RAPIER.RigidBody;
  vc: RAPIER.DynamicRayCastVehicleController;
  model: CartModel;
  gear: Gear = 'F';
  speed = 0; // signed forward m/s
  steerCenter = 0; // current center steer angle (rad)
  lightsOn = true;
  headlightsOn = false;
  braking = false;
  private lightTime = 0;
  private steerQ = new THREE.Quaternion();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private connY: number;
  private maxCenter: number;

  constructor(R: Rapier, world: RAPIER.World, public cfg: GolfCartConfig, model: CartModel, spawn: THREE.Vector3, heading: number,
    private groundAt: (x: number, z: number) => number = () => 0) {
    this.model = model;
    this.maxCenter = centerAngleForMax(cfg);

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y + 0.15, spawn.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.02)
        .setAngularDamping(0.6)
        .setCanSleep(false),
    );
    const L = cfg.lengthM, W = cfg.widthM, m = cfg.massKg;
    const hBody = 0.5;
    // Inertia of a solid box of the cart's envelope.
    const ix = (m / 12) * (hBody * hBody * 4 + L * L), iy = (m / 12) * (W * W + L * L), iz = (m / 12) * (W * W + hBody * hBody * 4);
    // Chassis box from 0.32 m (ground clearance) up through the seat pods.
    const colliderY = 0.32 + hBody / 2;
    world.createCollider(
      R.ColliderDesc.cuboid(W / 2 - 0.05, hBody / 2, L / 2 - 0.05)
        .setTranslation(0, colliderY, 0)
        // Center of mass is given in the collider's frame, not the body's.
        .setMassProperties(m, { x: 0, y: cfg.comHeight - colliderY, z: 0 }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.15)
        .setRestitution(0.05),
      this.body,
    );
    // Canopy roof (massless) so the cart cannot drive under low obstacles.
    world.createCollider(
      R.ColliderDesc.cuboid(W / 2, 0.04, (L - 0.4) / 2).setTranslation(0, cfg.heightM - 0.04, -0.15).setDensity(0).setFriction(0.3),
      this.body,
    );

    this.vc = world.createVehicleController(this.body);
    this.vc.indexUpAxis = UP_AXIS;
    this.vc.setIndexForwardAxis = FORWARD_AXIS;
    // Static sag so the body origin rides at ground level.
    const sag = 9.81 / (4 * cfg.suspensionStiffness);
    this.connY = cfg.wheelRadiusM + cfg.suspensionRestLengthM - sag;
    const wb = cfg.wheelbaseM / 2;
    const pos = [
      [cfg.trackFrontM / 2, wb], [-cfg.trackFrontM / 2, wb],
      [cfg.trackRearM / 2, -wb], [-cfg.trackRearM / 2, -wb],
    ];
    pos.forEach(([x, z], i) => {
      this.vc.addWheel({ x, y: this.connY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, cfg.suspensionRestLengthM, cfg.wheelRadiusM);
      this.vc.setWheelSuspensionStiffness(i, cfg.suspensionStiffness);
      this.vc.setWheelSuspensionCompression(i, cfg.suspensionCompression);
      this.vc.setWheelSuspensionRelaxation(i, cfg.suspensionRelaxation);
      this.vc.setWheelMaxSuspensionTravel(i, cfg.suspensionTravelM);
      this.vc.setWheelMaxSuspensionForce(i, m * 9.81 * 3);
      this.vc.setWheelFrictionSlip(i, cfg.tireFrictionSlip);
      this.vc.setWheelSideFrictionStiffness(i, cfg.tireSideStiffness);
    });
  }

  /** Arcade-style pedal mapping: the brake key reverses once stopped, and vice versa. */
  mapKeys(fwd: number, back: number, steer: number, handbrake: boolean): DriverInput {
    const v = this.speed;
    if (this.gear === 'F') {
      if (back > 0 && v < 0.3 && fwd === 0) this.gear = 'R';
    } else if (fwd > 0 && v > -0.3 && back === 0) this.gear = 'F';
    const throttle = this.gear === 'F' ? fwd : back;
    const brake = this.gear === 'F' ? back : fwd;
    return { throttle, brake, steer, handbrake };
  }

  update(input: DriverInput, dt: number) {
    const cfg = this.cfg;
    // Rapier puts a resting body to sleep, and engine force alone does not wake it
    // (holding W after a reset left the cart standing still).
    if (input.throttle || input.brake || input.steer) this.body.wakeUp();
    this.speed = this.vc.currentVehicleSpeed();
    const v = Math.abs(this.speed);

    // Steering: rate-limited, reduced at speed as a driver would.
    // Keyboard steering is all-or-nothing, so cap the steer angle where a full-lock
    // turn would exceed ~0.58 g sideways (the cart tips near 0.7 g).
    const latLimit = v > 0.5 ? Math.atan((0.58 * 9.81 * cfg.wheelbaseM) / (v * v)) : this.maxCenter;
    const target = input.steer * Math.min(this.maxCenter, latLimit);
    const rate = (Math.sign(target - this.steerCenter) === Math.sign(this.steerCenter) || target === 0 ? 1.8 : 1) * cfg.steerRateRadS;
    this.steerCenter += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerCenter));
    const [l, r] = ackermann(cfg, this.steerCenter);
    this.vc.setWheelSteering(0, l);
    this.vc.setWheelSteering(1, r);

    const { driveForce, brakeForce } = computeLongitudinal(cfg, input, this.gear, this.speed);
    this.braking = input.brake > 0 || input.handbrake;
    const braking = brakeForce > 0;
    // Rear-wheel drive. Rapier ignores the brake on a wheel with engine force,
    // so the motor is cut while the service/park brake is applied.
    for (const i of [2, 3]) this.vc.setWheelEngineForce(i, braking ? 0 : driveForce / 2);
    for (const i of [0, 1]) this.vc.setWheelEngineForce(i, 0);
    // Rapier treats the brake value as a per-step impulse.
    const brakeImpulse = braking ? (brakeForce / 4) * dt : 0;
    for (let i = 0; i < 4; i++) this.vc.setWheelBrake(i, brakeImpulse);

    this.vc.updateVehicle(dt);
  }

  private prevT = new THREE.Vector3();
  private prevQ = new THREE.Quaternion();
  private curQ = new THREE.Quaternion();

  /** Records the pose before a physics step, for `syncVisual` to blend from. */
  snapshot() {
    const t = this.body.translation(), q = this.body.rotation();
    this.prevT.set(t.x, t.y, t.z);
    this.prevQ.set(q.x, q.y, q.z, q.w);
  }

  /**
   * Sync the visual model with the physics state; call once per rendered frame.
   * Physics runs in fixed 1/120 s steps, so a rendered frame lands between two of them:
   * `alpha` (0..1) is how far past the last step it is, and the model is drawn at the pose
   * blended from the step before. Without it the cart moves by one, two or three steps per
   * frame as the two clocks drift, which shows as a fine judder of the whole view.
   */
  syncVisual(dt: number, quality: { pointLights: boolean }, alpha = 1) {
    const t = this.body.translation(), q = this.body.rotation();
    const root = this.model.root;
    root.position.set(t.x, t.y, t.z);
    root.quaternion.set(q.x, q.y, q.z, q.w);
    // Not across a reset or recovery (the cart jumped), where blending would streak it through the world.
    if (alpha < 1 && this.prevT.distanceToSquared(root.position) < 1) {
      root.position.lerpVectors(this.prevT, root.position, alpha);
      root.quaternion.copy(this.prevQ).slerp(this.curQ.set(q.x, q.y, q.z, q.w), alpha);
    }
    for (let i = 0; i < 4; i++) {
      const g = this.model.wheels[i];
      const c = this.vc.wheelChassisConnectionPointCs(i)!;
      const len = this.vc.wheelSuspensionLength(i) ?? this.cfg.suspensionRestLengthM;
      g.position.set(c.x, c.y - len, c.z);
      g.rotation.y = this.vc.wheelSteering(i) ?? 0;
      g.children[0].rotation.x = this.vc.wheelRotation(i) ?? 0;
      if (i === 0) this.model.contactShadow.position.y = c.y - len - this.cfg.wheelRadiusM + 0.04;
    }
    const sw = this.model.steeringWheel;
    // About 1.5 turns lock to lock on a golf-cart rack: wheel angle ~ 9x the road-wheel angle.
    if (sw && this.model.steeringRest) sw.quaternion.copy(this.model.steeringRest).multiply(this.steerQ.setFromAxisAngle(this.yAxis, -this.steerCenter * 9));
    this.updateLights(dt, quality.pointLights);
  }

  /** LED halo strength: full at night; by day a flash is only a small bright point. */
  glowLevel = 1;

  private updateLights(dt: number, pointLights: boolean) {
    const m = this.model;
    this.lightTime += dt;
    let a = 0, b = 0, cross = 0;
    if (this.lightsOn) {
      // Red/blue wig-wag, 1.0 s cycle: three quick flashes on the red (driver's) side, then three
      // on the blue side; front and rear alternate in opposite phase and the side markers
      // run a slower steady alternation, as common US emergency light programs do.
      const p = (this.lightTime % 1.0) / 1.0;
      const triple = (start: number) => p >= start && p < start + 0.42 && Math.floor((p - start) / 0.07) % 2 === 0 ? 1 : 0;
      a = triple(0);
      b = triple(0.5);
      cross = p < 0.5 ? 1 : 0;
    }
    for (const l of m.leds) {
      // Rear heads run opposite to the front, side markers swap every half second.
      const on = l.zone === 'side' ? (l.red ? cross : 1 - cross) * (this.lightsOn ? 1 : 0)
        : l.zone === 'rear' ? (l.red ? b : a) : (l.red ? a : b);
      l.mat.emissiveIntensity = on * (l.zone === 'side' ? 10 : 22);
      l.glow.visible = on > 0;
      (l.glow.material as THREE.SpriteMaterial).opacity = this.glowLevel;
    }
    const rb = a || b;
    m.frontLight.color.setRGB(a ? 1 : 0.1, 0.08, b ? 1 : 0.1);
    m.frontLight.intensity = pointLights ? rb * 4 : 0;
    m.rearLight.color.setRGB(b ? 1 : 0.1, 0.08, a ? 1 : 0.1);
    m.rearLight.intensity = pointLights ? rb * 3 : 0;
    m.headlight.intensity = this.headlightsOn ? 150 : 0;
    m.headlightMat.emissiveIntensity = this.headlightsOn ? 3 : 0.4;
    m.brakeMat.emissiveIntensity = this.braking ? 4 : this.headlightsOn ? 0.8 : 0.1;
  }

  reset(pos: THREE.Vector3, heading: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setTranslation({ x: pos.x, y: pos.y + 0.3, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.gear = 'F';
    this.steerCenter = 0;
  }

  /** Flip upright in place, keeping heading. */
  recover() {
    const t = this.body.translation();
    const fwd = this.forward();
    this.reset(new THREE.Vector3(t.x, this.groundAt(t.x, t.z) + 0.2, t.z), Math.atan2(fwd.x, fwd.z));
  }

  forward(target = new THREE.Vector3()) {
    const q = this.body.rotation();
    return target.set(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  }

  position(target = new THREE.Vector3()) {
    const t = this.body.translation();
    return target.set(t.x, t.y, t.z);
  }
}
