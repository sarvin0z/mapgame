import { describe, it, expect } from 'vitest';
import { AdaptiveQuality, PRESETS, SCALES, detectPreset, pixelRatioFor, type FrameSample } from '../src/graphics/quality.ts';

/** Feeds the controller the same half-second sample for `secs` seconds and collects what it changed. */
function run(a: AdaptiveQuality, s: FrameSample, secs: number) {
  const changes = [];
  for (let t = 0; t < secs; t += 0.5) { const c = a.sample(s, 0.5); if (c) changes.push(c); }
  return changes;
}

describe('starting preset from the device', () => {
  const laptop = { touch: false, memoryGB: 8, cores: 8, minScreen: 900 };
  it('starts integrated graphics in the middle, entry-level graphics low and discrete cards on high', () => {
    expect(detectPreset({ ...laptop, gpu: 'ANGLE (AMD, AMD Radeon(TM) 840M Graphics (0x00001114) Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('medium');
    // Entry-level laptop graphics start on Low so Auto opens at 60 fps (Auto steps up when there is headroom).
    expect(detectPreset({ ...laptop, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('low');
    expect(detectPreset({ ...laptop, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce MX230 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('low');
    expect(detectPreset({ ...laptop, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('high');
    expect(detectPreset({ ...laptop, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' })).toBe('high');
  });
  it('starts phones, weak machines and software renderers low', () => {
    expect(detectPreset({ gpu: 'Adreno (TM) 610', touch: true, memoryGB: 4, cores: 8, minScreen: 393 })).toBe('low');
    expect(detectPreset({ gpu: 'Adreno (TM) 740', touch: true, memoryGB: 8, cores: 8, minScreen: 412 })).toBe('medium');
    expect(detectPreset({ ...laptop, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)' })).toBe('verylow');
    expect(detectPreset({ gpu: 'Mali-G52', touch: true, memoryGB: 3, cores: 8, minScreen: 360 })).toBe('verylow');
    expect(detectPreset({ ...laptop, memoryGB: 4, gpu: 'Intel(R) HD Graphics 4000' })).toBe('low');
  });
});

describe('render resolution', () => {
  it('never exceeds the device ratio, the preset cap or the pixel budget', () => {
    expect(pixelRatioFor(PRESETS.high, 1, 1920, 1080, 1)).toBe(1);
    expect(pixelRatioFor(PRESETS.high, 1, 1280, 720, 3)).toBe(2);
    // A 4K monitor on High: 8.3 M pixels at ratio 1 is over the 4.2 M budget.
    const pr = pixelRatioFor(PRESETS.high, 1, 3840, 2160, 1);
    expect(3840 * 2160 * pr * pr).toBeLessThanOrEqual(4.2e6 * 1.001);
    // A 3x phone on Low draws about a million pixels, not nine times its CSS size.
    const phone = pixelRatioFor(PRESETS.low, 1, 844, 390, 3);
    expect(phone).toBe(1);
    expect(pixelRatioFor(PRESETS.low, 0.6, 844, 390, 3)).toBeCloseTo(0.6);
  });
});

describe('adaptive quality', () => {
  it('leaves a display capped at 30 Hz alone when the work fits', () => {
    const a = new AdaptiveQuality('medium');
    // Every frame arrives 33 ms apart (a 30 Hz cap) with 9 ms of CPU and 5 ms of GPU work.
    const changes = run(a, { fps: 30, cpuMs: 9, gpuMs: 5, bestIntervalMs: 33.3 }, 20);
    expect(changes.filter(c => c.preset === 'low')).toEqual([]);
    expect(a.current).not.toBe('low');
  });
  it('lowers resolution first when the GPU is the bottleneck', () => {
    const a = new AdaptiveQuality('high');
    const changes = run(a, { fps: 41, cpuMs: 6, gpuMs: 24, bestIntervalMs: 16.7 }, 8);
    expect(changes[0]).toEqual({ scale: SCALES[SCALES.length - 2] });
    expect(a.current).toBe('high');
  });
  it('lowers the preset when the CPU is the bottleneck', () => {
    const a = new AdaptiveQuality('high');
    const changes = run(a, { fps: 44, cpuMs: 21, gpuMs: 9, bestIntervalMs: 16.7 }, 8);
    expect(changes[0]).toEqual({ preset: 'medium' });
  });
  it('falls back to frame rate without GPU timings', () => {
    const a = new AdaptiveQuality('medium');
    // A phone missing frames with a light main thread: treated as GPU-bound.
    const changes = run(a, { fps: 38, cpuMs: 5, bestIntervalMs: 16.7 }, 8);
    expect(changes[0]).toEqual({ scale: SCALES[SCALES.length - 2] });
  });
  it('steps back up only after a stable spell, and waits longer after a failed step up', () => {
    const a = new AdaptiveQuality('medium');
    a.scaleIndex = SCALES.length - 1;
    const easy = { fps: 60, cpuMs: 5, gpuMs: 5, bestIntervalMs: 16.7 };
    expect(run(a, easy, 10)).toEqual([]);
    expect(run(a, easy, 12)).toEqual([{ preset: 'high' }]);
    // High cannot be held: back to medium, and the next attempt takes at least twice as long.
    expect(run(a, { fps: 40, cpuMs: 22, gpuMs: 14, bestIntervalMs: 16.7 }, 10)[0]).toEqual({ preset: 'medium' });
    expect(run(a, easy, 20)).toEqual([]);
  });
  it('does nothing when switched off', () => {
    const a = new AdaptiveQuality('high');
    a.enabled = false;
    expect(run(a, { fps: 10, cpuMs: 60, gpuMs: 60, bestIntervalMs: 16.7 }, 20)).toEqual([]);
  });
});
