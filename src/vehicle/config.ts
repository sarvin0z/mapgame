// Emergency golf cart parameters. Physically plausible values for the lifted
// 2+2 UEMR cart (photo: The Retrograde, 2026-08-21) carrying two crew, a jump
// bag and a cardiac monitor. Dimensions and powertrain are estimates; replace
// them with measured UEMR cart specs when available.

export interface GolfCartConfig {
  /** Total mass including crew and equipment (kg). */
  massKg: number;
  /** Height of the center of mass above the ground (m). */
  comHeight: number;
  lengthM: number;
  widthM: number;
  /** Ground to top of roof canopy (m). */
  heightM: number;
  wheelbaseM: number;
  trackFrontM: number;
  trackRearM: number;
  wheelRadiusM: number;
  wheelWidthM: number;
  /** Curb-to-curb turning radius measured at the outer front wheel (m). */
  turningRadiusM: number;
  /** Steering wheel lock-to-lock response: wheel angle change rate (rad/s). */
  steerRateRadS: number;
  /** Governed top speed forward / reverse (m/s). */
  topSpeedMS: number;
  reverseTopSpeedMS: number;
  /** Motor: peak tractive force at the wheels at low speed (N). */
  maxTractiveForceN: number;
  /** Motor: peak power at the wheels (W); force falls off as P/v above base speed. */
  peakPowerW: number;
  /** Regenerative braking force when the pedal is released (N). */
  regenForceN: number;
  /** Service brake total force at full pedal (N). */
  maxBrakeForceN: number;
  rollingResistanceCoeff: number;
  /** Drag area Cd*A (m^2). */
  dragAreaM2: number;
  /** Suspension, per wheel. Stiffness is per unit chassis mass (Rapier convention). */
  suspensionRestLengthM: number;
  suspensionTravelM: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  tireFrictionSlip: number;
  tireSideStiffness: number;
}

export const DEFAULT_CART: GolfCartConfig = {
  // Dimensions of a typical 2+2 street cart like the UEMR cart in the 2026 photos
  // (front bench plus rear-facing flip seat, 14-inch wheels, mild lift).
  massKg: 640, // cart ~470 kg, two crew, AED and jump bag
  comHeight: 0.66, // roof, light bars and seated crew: top-heavy (static stability ~0.7 g)
  lengthM: 2.68,
  widthM: 1.2,
  heightM: 1.92,
  wheelbaseM: 1.65,
  trackFrontM: 0.92,
  trackRearM: 0.98,
  wheelRadiusM: 0.28, // 205/30-14 street tire
  wheelWidthM: 0.2,
  turningRadiusM: 3.6,
  steerRateRadS: 3.2,
  topSpeedMS: 10.1, // ~22.5 mph governed
  reverseTopSpeedMS: 4.0, // ~9 mph
  maxTractiveForceN: 2400, // AC drive, high-torque controller
  peakPowerW: 11500,
  regenForceN: 900, // pedal-up regeneration: ~1.4 m/s^2 coast-down with rolling resistance
  maxBrakeForceN: 3800,
  rollingResistanceCoeff: 0.015,
  dragAreaM2: 1.0,
  suspensionRestLengthM: 0.26,
  suspensionTravelM: 0.12,
  suspensionStiffness: 26,
  suspensionCompression: 3.6,
  suspensionRelaxation: 4.2,
  tireFrictionSlip: 1.7,
  tireSideStiffness: 1.0,
};

/** Maximum front-wheel steer angle (inner wheel) that achieves the turning radius. */
export function maxSteerAngle(c: GolfCartConfig): number {
  // Outer front wheel follows the turning circle: R = wheelbase / sin(delta_outer).
  const outer = Math.asin(Math.min(1, c.wheelbaseM / c.turningRadiusM));
  // Lateral offset of the outer wheel from the turn center, then Ackermann inner angle.
  const rOuter = c.wheelbaseM / Math.tan(outer);
  return Math.atan(c.wheelbaseM / (rOuter - c.trackFrontM));
}

/** Ackermann steer angles [left, right] for a commanded center angle (positive = left turn). */
export function ackermann(c: GolfCartConfig, center: number): [number, number] {
  if (Math.abs(center) < 1e-5) return [0, 0];
  const r = c.wheelbaseM / Math.tan(Math.abs(center));
  const inner = Math.atan(c.wheelbaseM / (r - c.trackFrontM / 2));
  const outer = Math.atan(c.wheelbaseM / (r + c.trackFrontM / 2));
  return center > 0 ? [inner, outer] : [-outer, -inner];
}

export function centerAngleForMax(c: GolfCartConfig): number {
  // Center (bicycle-model) angle whose inner Ackermann angle equals maxSteerAngle.
  const inner = maxSteerAngle(c);
  const rInner = c.wheelbaseM / Math.tan(inner);
  return Math.atan(c.wheelbaseM / (rInner + c.trackFrontM / 2));
}
