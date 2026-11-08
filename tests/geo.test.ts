import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { project, unproject, vincenty, ORIGIN } from '../src/geo/projection.ts';
import { estimateBuildingHeight, estimateRoadWidth, parseMeters } from '../src/geo/osmRules.ts';
import type { CampusData } from '../src/world/campusData.ts';
import { centroid, signedArea } from '../src/world/geometry.ts';

describe('projection', () => {
  it('maps the origin to (0, 0)', () => {
    const [x, y] = project(ORIGIN.lat, ORIGIN.lon);
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(Math.abs(y)).toBeLessThan(1e-9);
  });

  it('round-trips coordinates across the campus', () => {
    for (const [lat, lon] of [[32.9765, -96.757], [32.995, -96.744], [32.9868, -96.7475]]) {
      const [x, y] = project(lat, lon);
      const back = unproject(x, y);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it('preserves WGS84 distances within 0.05% over campus scale', () => {
    // Campbell Rd / Waterview corner to Synergy Park / Floyd corner (~2.4 km diagonal)
    const a = { lat: 32.9765, lon: -96.757 }, b = { lat: 32.995, lon: -96.744 };
    const [ax, ay] = project(a.lat, a.lon), [bx, by] = project(b.lat, b.lon);
    const planar = Math.hypot(bx - ax, by - ay);
    const geodesic = vincenty(a, b);
    expect(Math.abs(planar - geodesic) / geodesic).toBeLessThan(5e-4);
  });
});

describe('OSM tag rules', () => {
  it('parses heights in meters and feet', () => {
    expect(parseMeters('12')).toBe(12);
    expect(parseMeters('12 m')).toBe(12);
    expect(parseMeters('30 ft')).toBeCloseTo(9.144);
    expect(parseMeters('tall')).toBeUndefined();
  });
  it('prefers explicit height, then levels, then flagged default', () => {
    expect(estimateBuildingHeight({ building: 'university', height: '20' })).toMatchObject({ height: 20, estimated: false });
    expect(estimateBuildingHeight({ building: 'university', 'building:levels': '4' })).toMatchObject({ height: 4 * 3.6 + 1, estimated: false });
    expect(estimateBuildingHeight({ building: 'university' }).estimated).toBe(true);
  });
  it('derives road width from lanes and flags defaults', () => {
    expect(estimateRoadWidth({ highway: 'tertiary', lanes: '2' })).toMatchObject({ width: 7.8, estimated: false });
    expect(estimateRoadWidth({ highway: 'footway' }).estimated).toBe(true);
  });
});

describe('campus dataset', () => {
  const data: CampusData = JSON.parse(readFileSync('public/data/campus.json', 'utf8'));

  it('has the UT Dallas boundary and core buildings', () => {
    expect(data.boundary.length).toBeGreaterThan(0);
    for (const n of ['Eugene McDermott Library', 'Student Union', 'Activity Center', 'Engineering and Computer Science South', 'Naveen Jindal School of Management']) {
      expect(data.buildings.some(b => b.name === n), n).toBe(true);
    }
  });

  it('places landmarks inside the campus boundary', () => {
    const inside = (p: [number, number], ring: [number, number][]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (const n of ['Eugene McDermott Library', 'Student Union', 'Callier Center Richardson']) {
      const b = data.buildings.find(b => b.name === n)!;
      expect(data.boundary.some(r => inside(centroid(b.outer), r)), n).toBe(true);
    }
  });

  it('keeps relative landmark layout consistent with the official campus map', () => {
    const c = (n: string) => centroid(data.buildings.find(b => b.name === n)!.outer);
    const lib = c('Eugene McDermott Library'), su = c('Student Union'), north = c('North Lab'), ac = c('Activity Center');
    // Official map tiles: North Lab is north of the library; the Activity Center is south of the Student Union.
    expect(north[1]).toBeGreaterThan(lib[1]);
    expect(ac[1]).toBeLessThan(su[1]);
    // Library is east of the Student Union.
    expect(lib[0]).toBeGreaterThan(su[0]);
  });

  it('stores building footprints with non-degenerate area', () => {
    const tiny = data.buildings.filter(b => Math.abs(signedArea(b.outer)) < 1);
    expect(tiny.length).toBeLessThan(data.buildings.length * 0.01);
  });
});
