import { describe, it, expect } from 'vitest';
import { Pedestrians } from '../src/gameplay/pedestrians.ts';
import type { CampusData } from '../src/world/campusData.ts';
import type { Terrain } from '../src/world/terrain.ts';

/** One straight 200 m footway along the x axis, flat ground, one walker on it. */
function setup() {
  const data = { roads: [{ id: 1, cls: 'footway', w: 3, pts: [[0, 0], [200, 0]] }] } as unknown as CampusData;
  const terrain = { heightAt: () => 0 } as unknown as Terrain;
  const peds = new Pedestrians(data, terrain, 1);
  peds.start([100, 0], 220);
  const w = (peds as any).walkers[0];
  w.s = 100; w.lane = 0; w.dir = 1; w.speed = 0; // standing at x = 100 on the walk's centre line
  return { peds, w };
}

/** Drives a cart along the walk toward the walker at 6 m/s, from x = 70; returns contacts and the walker's final offset. */
function drive(warn: boolean) {
  const { peds, w } = setup();
  let hits = 0;
  for (let x = 70; x < 110; x += 6 / 60) hits += peds.update(1 / 60, [x, 0], [1, 0], 6, warn);
  return { hits, offset: Math.abs(w.lane + w.dodge) };
}

describe('pedestrians', () => {
  it('step clear of the cart when the horn or siren sounds', () => {
    const r = drive(true);
    expect(r.hits).toBe(0);
    expect(r.offset).toBeGreaterThan(2.5);
  });
  it('are struck by a fast cart that gives no warning', () => {
    expect(drive(false).hits).toBeGreaterThan(0);
  });
});
