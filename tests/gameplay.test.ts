import { describe, it, expect } from 'vitest';
import { NavGraph } from '../src/gameplay/navGraph.ts';
import { RouteChallenge } from '../src/gameplay/routeChallenge.ts';
import { fmt } from '../src/ui/menus.ts';
import type { CampusData, Pt } from '../src/world/campusData.ts';

/** A road grid: an L-shaped road from (0,0) to (100,0) to (100,100), plus a walk shortcut on the diagonal. */
function campus(withShortcut: boolean): CampusData {
  const roads: any[] = [
    { id: 1, cls: 'residential', w: 8, pts: [[0, 0], [100, 0]] },
    { id: 2, cls: 'residential', w: 8, pts: [[100, 0], [100, 100]] },
  ];
  if (withShortcut) roads.push({ id: 3, cls: 'footway', w: 3, pts: [[0, 0], [100, 100]] });
  roads.push({ id: 4, cls: 'steps', w: 3, pts: [[0, 0], [0, 100]] });
  const box = (x: number, y: number): Pt[] => [[x - 5, y - 5], [x + 5, y - 5], [x + 5, y + 5], [x - 5, y + 5]];
  return {
    roads, buildings: [{ id: 'b1', name: 'Target Hall', kind: 'university', h: 10, style: 'precast', outer: [[95, 105], [125, 105], [125, 125], [95, 125]] }, { id: 'b0', name: 'Home', kind: 'apartments', h: 10, style: 'villageStone', outer: box(-10, -10) }],
    entrances: [], areas: [], barriers: [], steps: [], curbs: [], medians: [], bumps: [], crossings: [], stops: [], waterways: [], trees: [], treeList: [],
    lamps: [], benches: [], bollards: [], kerbs: [], flagpoles: [], bikeRacks: [], bins: [], fountains: [], signals: [], boundary: [],
    meta: { origin: { lat: 0, lon: 0 }, source: '', attribution: '', uncertain: {} },
  } as unknown as CampusData;
}

describe('navigation graph', () => {
  it('routes along roads and walks but never stairs', () => {
    const g = new NavGraph(campus(false));
    const r = g.route(g.nearest([0, 0]), g.nearest([100, 100]))!;
    expect(r.length).toBeCloseTo(200, 3); // around the L; the stairs are not used
  });
  it('takes a walkway shortcut when it is shorter', () => {
    const g = new NavGraph(campus(true));
    const r = g.route(g.nearest([0, 0]), g.nearest([100, 100]))!;
    expect(r.length).toBeCloseTo(Math.hypot(100, 100), 3);
  });
});

describe('route challenge scoring', () => {
  const run = (path: Pt[], onNet: (p: Pt) => boolean, dt = 0.2) => {
    const rc = new RouteChallenge(campus(false), [0, 0], onNet);
    expect(rc.start('Target Hall')).toBe(true);
    rc.update(3.1, path[0]); // countdown
    for (const p of path) rc.update(dt, p);
    return rc;
  };
  const along = (pts: Pt[], step = 2) => { const out: Pt[] = []; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < l; t += step) out.push([a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l]); } out.push(pts[pts.length - 1]); return out; };

  it('gives full marks for the best route at a good pace', () => {
    const rc = run(along([[0, 0], [100, 0], [100, 100]]), () => true, 0.25);
    expect(rc.phase).toBe('finished');
    expect(rc.result!.efficiency).toBeGreaterThan(0.95);
    expect(rc.result!.grade).toBe('S');
  });
  it('penalises cutting across grass and taking detours', () => {
    const grass = run(along([[0, 0], [100, 100]]), p => Math.abs(p[1]) < 5 || Math.abs(p[0] - 100) < 5, 0.25);
    expect(grass.result!.onNetwork).toBeLessThan(0.2);
    const detour = run(along([[0, 0], [100, 0], [180, 0], [100, 0], [100, 100]]), () => true, 0.25);
    expect(detour.result!.efficiency).toBeLessThan(0.75);
    expect(detour.result!.score).toBeLessThan(900);
  });
  it('runs a multi-stop gauntlet with a time per stop, and lots are destinations', () => {
    const data = campus(false);
    (data.areas as any[]).push({ kind: 'parking', name: 'Lot Z', outer: [[90, -20], [110, -20], [110, -10], [90, -10]] });
    const rc = new RouteChallenge(data, [0, 0], () => true);
    expect(rc.destinations.some(d => d.name === 'Lot Z' && d.kind === 'lot')).toBe(true);
    expect(rc.start(['Lot Z', 'Target Hall'])).toBe(true);
    rc.update(3.1, [0, 0]);
    for (const p of along([[0, 0], [100, 0], [100, -12], [100, 0], [100, 100]])) rc.update(0.25, p);
    expect(rc.phase).toBe('finished');
    expect(rc.result!.legs.map(l => l.name)).toEqual(['Lot Z', 'Target Hall']);
    expect(rc.result!.legs.every(l => l.time > 0)).toBe(true);
  });
  it('takes points off for collisions and for each assist', () => {
    const base = run(along([[0, 0], [100, 0], [100, 100]]), () => true, 0.25).result!.score;
    const rc = new RouteChallenge(campus(false), [0, 0], () => true);
    rc.start('Target Hall', { route: true, beam: true });
    rc.update(3.1, [0, 0]);
    rc.collision();
    for (const p of along([[0, 0], [100, 0], [100, 100]])) rc.update(0.25, p);
    expect(rc.result!.collisions).toBe(1);
    expect(rc.result!.score).toBe(Math.round((base - 100) * 0.8));
  });
  it('gives no efficiency or pace credit for a shortcut off the network', () => {
    const grass = run(along([[0, 0], [100, 100]]), p => Math.abs(p[1]) < 5 || Math.abs(p[0] - 100) < 5, 0.25);
    expect(grass.result!.efficiency).toBeLessThan(0.3);
    expect(grass.result!.timeScore).toBeLessThan(0.3);
  });
  it('formats run times with two-digit seconds', () => {
    expect(fmt(69.96)).toBe('1:10.0');
    expect(fmt(9.94)).toBe('0:09.9');
    expect(fmt(120.04)).toBe('2:00.0');
  });
});
