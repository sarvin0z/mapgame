import type { Building, Pt } from './campusData.ts';
import { centroid, ensureCCW, resample } from './geometry.ts';
import { insetRing } from './features.ts';
import { onSeatingSteps, PLINTH_HEIGHT_SCALE } from './sceneEdits.ts';
import { pointInRing } from './spatial.ts';
import type { Terrain } from './terrain.ts';

export const MIN_DRIVE_CLEARANCE = 2.6;

/** Use the same soffit datum for the rendered structure and Rapier. */
export function overheadLevels(b: Building, terrain: Terrain, outer = b.outer) {
  const perimeter = resample([...outer, outer[0]], .8);
  const heights = perimeter.map(([x, y]) => terrain.heightAt(x, y));
  const ground = Math.min(...heights);
  const xs = outer.map(p => p[0]), ys = outer.map(p => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.25) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1.25) {
      if (pointInRing([x, y], outer)) heights.push(terrain.heightAt(x, y));
    }
  }
  const bottom = Math.max(ground + (b.minH ?? b.h - .3), Math.max(...heights) + MIN_DRIVE_CLEARANCE + .08);
  return { bottom, top: bottom + (b.minH ? Math.max(.3, b.h - b.minH) : .3) };
}

export function canopyColumns(b: Building, outer = b.outer) {
  const ring = insetRing(ensureCCW(outer), .3) ?? ensureCCW(outer);
  return ring.flatMap((a, i) => {
    const end = ring[(i + 1) % ring.length];
    const count = Math.max(1, Math.round(Math.hypot(end[0] - a[0], end[1] - a[1]) / 6));
    return Array.from({ length: count }, (_, k): Pt =>
      [a[0] + (end[0] - a[0]) * k / count, a[1] + (end[1] - a[1]) * k / count]);
  }).map(point => ({ point, width: b.h >= 8 ? .45 : .22 }));
}

export function plinthLayout(b: Building, terrain: Terrain) {
  const hole = b.holes?.[0];
  const center = centroid(hole ?? b.outer);
  const top = terrain.minAlong(b.outer) + (b.h + 1.5) * PLINTH_HEIGHT_SCALE;
  const ring = insetRing(b.outer, 1.2) ?? b.outer;
  const columns = resample([...ring, ring[0]], 6.8).slice(0, -1)
    .filter(p => !onSeatingSteps(p, .5)).map(point => ({ point, width: .235 }));
  let length = 0, yaw = 0;
  for (const [i, a] of b.outer.entries()) {
    const end = b.outer[(i + 1) % b.outer.length];
    const span = Math.hypot(end[0] - a[0], end[1] - a[1]);
    if (span > length) {
      length = span;
      yaw = Math.atan2(end[1] - a[1], end[0] - a[0]);
    }
  }
  return { top, columnTop: top - .14, center, hole, columns, yaw };
}

/** Clip a row of steel bars to the OSM perimeter and opening with even-odd crossings. */
export function clippedRows(outline: Pt[], holes: Pt[][], yaw: number, spacing: number): [Pt, Pt][] {
  const east = Math.cos(yaw), north = Math.sin(yaw);
  const project = ([x, y]: Pt): Pt => [x * east + y * north, y * east - x * north];
  const unproject = (x: number, y: number): Pt => [x * east - y * north, x * north + y * east];
  const frame = outline.map(project);
  const rings = [frame, ...holes.map(hole => hole.map(project))];
  const bounds = frame.map(([, y]) => y);
  const rows: [Pt, Pt][] = [];
  for (let y = Math.min(...bounds) + spacing / 2; y < Math.max(...bounds); y += spacing) {
    const crossings = rings.flatMap(ring => ring.flatMap(([x0, y0], i) => {
      const [x1, y1] = ring[(i + 1) % ring.length];
      return (y0 <= y && y1 > y) || (y1 <= y && y0 > y) ? [x0 + (x1 - x0) * (y - y0) / (y1 - y0)] : [];
    })).sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      if (crossings[i + 1] - crossings[i] > .12) rows.push([unproject(crossings[i], y), unproject(crossings[i + 1], y)]);
    }
  }
  return rows;
}
