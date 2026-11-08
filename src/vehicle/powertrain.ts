import type { GolfCartConfig } from './config.ts';

export interface DriverInput {
  /** 0..1 accelerator pedal */
  throttle: number;
  /** 0..1 brake pedal */
  brake: number;
  /** -1..1, positive = steer left */
  steer: number;
  handbrake: boolean;
}

export type Gear = 'F' | 'R';

export interface Longitudinal {
  /** Net drive force along the cart's forward axis at the wheels (N), signed. */
  driveForce: number;
  /** Total braking force magnitude to distribute over the wheels (N). */
  brakeForce: number;
}

const G = 9.81;
const RHO = 1.2;

/** Motor tractive-force envelope: constant force up to base speed, then constant power. */
export function motorForce(c: GolfCartConfig, speed: number, throttle: number): number {
  const v = Math.abs(speed);
  const envelope = Math.min(c.maxTractiveForceN, c.peakPowerW / Math.max(v, 0.1));
  return envelope * throttle;
}

/** Speed governor: tapers motor force to zero across the last 0.6 m/s before the limit. */
export function governor(speed: number, limit: number): number {
  return Math.max(0, Math.min(1, (limit - Math.abs(speed)) / 0.6));
}

/**
 * Longitudinal force model for an electric golf cart.
 * `speed` is the signed forward speed (m/s, negative = moving backwards).
 */
export function computeLongitudinal(c: GolfCartConfig, input: DriverInput, gear: Gear, speed: number): Longitudinal {
  const dir = gear === 'F' ? 1 : -1;
  const limit = gear === 'F' ? c.topSpeedMS : c.reverseTopSpeedMS;
  let drive = 0;
  let brake = 0;

  if (input.throttle > 0) {
    const movingWithGear = speed * dir >= -0.3;
    drive = dir * motorForce(c, speed, input.throttle) * (movingWithGear ? governor(speed, limit) : 1);
  } else if (Math.abs(speed) > 0.15) {
    // Pedal-up regenerative braking, opposing motion, fading out in the last 1.5 m/s.
    drive = -Math.sign(speed) * c.regenForceN * Math.min(1, Math.abs(speed) / 1.5 + 0.2);
  }

  // Rolling resistance and aerodynamic drag oppose motion.
  if (Math.abs(speed) > 0.05) {
    const resist = c.rollingResistanceCoeff * c.massKg * G + 0.5 * RHO * c.dragAreaM2 * speed * speed;
    drive -= Math.sign(speed) * resist;
  }

  brake = input.brake * c.maxBrakeForceN;
  if (input.handbrake) brake = Math.max(brake, c.maxBrakeForceN * 0.6);
  // Electromagnetic park brake holds the cart when stopped with no pedal input.
  if (input.throttle === 0 && Math.abs(speed) < 0.4) brake = Math.max(brake, c.maxBrakeForceN * 0.5);

  return { driveForce: drive, brakeForce: brake };
}
