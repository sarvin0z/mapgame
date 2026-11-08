import { describe, it, expect } from 'vitest';
import { DEFAULT_CART, maxSteerAngle, ackermann, centerAngleForMax } from '../src/vehicle/config.ts';
import { computeLongitudinal, motorForce, governor } from '../src/vehicle/powertrain.ts';

const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const c = DEFAULT_CART;

describe('steering geometry', () => {
  it('achieves the configured turning radius at full lock', () => {
    const [inner, outer] = ackermann(c, centerAngleForMax(c));
    expect(inner).toBeCloseTo(maxSteerAngle(c), 6);
    // Outer front wheel radius = wheelbase / sin(outer angle)
    expect(c.wheelbaseM / Math.sin(outer)).toBeCloseTo(c.turningRadiusM, 2);
  });
  it('turns the inner wheel more than the outer wheel', () => {
    const [l, r] = ackermann(c, 0.3);
    expect(l).toBeGreaterThan(r);
    const [l2, r2] = ackermann(c, -0.3);
    expect(Math.abs(r2)).toBeGreaterThan(Math.abs(l2));
  });
});

describe('electric powertrain', () => {
  it('is torque-limited at low speed and power-limited at high speed', () => {
    expect(motorForce(c, 0.5, 1)).toBe(c.maxTractiveForceN);
    expect(motorForce(c, 8, 1)).toBeCloseTo(c.peakPowerW / 8);
  });
  it('governs top speed', () => {
    expect(governor(c.topSpeedMS, c.topSpeedMS)).toBe(0);
    expect(governor(c.topSpeedMS - 1, c.topSpeedMS)).toBe(1);
  });
  it('reaches 15 mph in about 2 s, like a high-torque AC-drive street cart', () => {
    let v = 0, t = 0;
    while (v < 6.7 && t < 20) {
      const { driveForce } = computeLongitudinal(c, { ...idle, throttle: 1 }, 'F', v);
      v += (driveForce / c.massKg) * 0.01;
      t += 0.01;
    }
    expect(t).toBeGreaterThan(1.5);
    expect(t).toBeLessThan(2.6);
  });
  it('settles at the governed top speed', () => {
    let v = 0;
    for (let i = 0; i < 6000; i++) v += (computeLongitudinal(c, { ...idle, throttle: 1 }, 'F', v).driveForce / c.massKg) * 0.01;
    expect(v).toBeGreaterThan(c.topSpeedMS - 0.7);
    expect(v).toBeLessThanOrEqual(c.topSpeedMS + 0.01);
  });
  it('drives backwards in reverse, limited to reverse speed', () => {
    let v = 0;
    for (let i = 0; i < 3000; i++) v += (computeLongitudinal(c, { ...idle, throttle: 1 }, 'R', v).driveForce / c.massKg) * 0.01;
    expect(v).toBeLessThan(0);
    expect(-v).toBeLessThanOrEqual(c.reverseTopSpeedMS + 0.01);
  });
  it('applies regen when coasting and the park brake when stopped', () => {
    expect(computeLongitudinal(c, idle, 'F', 5).driveForce).toBeLessThan(-c.regenForceN);
    expect(computeLongitudinal(c, idle, 'F', 0).brakeForce).toBeGreaterThan(0);
  });
  it('full brakes decelerate at roughly 0.6 g', () => {
    const { brakeForce } = computeLongitudinal(c, { ...idle, brake: 1 }, 'F', 5);
    expect(brakeForce / c.massKg / 9.81).toBeCloseTo(0.6, 1);
  });
  it('coasts down from top speed in a few seconds without the brake', () => {
    let v = c.topSpeedMS, t = 0;
    while (v > 0.5 && t < 20) { v += (computeLongitudinal(c, idle, 'F', v).driveForce / c.massKg) * 0.01; t += 0.01; }
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(8);
  });
});
