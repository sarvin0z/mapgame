// Converts raw Overpass JSON (data/raw/utd-osm.json) into the compact campus
// dataset the client loads (public/data/campus.json), in local meters.
// Run with: node scripts/process-osm.ts  (Node >= 22.6 strips TS types natively)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { project, ORIGIN } from '../src/geo/projection.ts';
import { estimateBuildingHeight, estimateRoadWidth, areaKind, buildingStyle } from '../src/geo/osmRules.ts';
import { smoothPolyline } from '../src/world/smooth.ts';
import { computeCurbs } from '../src/world/curbs.ts';

type Pt = [number, number];
const raw = JSON.parse(await readFile('data/raw/utd-osm.json', 'utf8'));
const nodes = new Map<number, Pt>();
const nodeTags = new Map<number, any>();
const ways = new Map<number, any>();
for (const e of raw.elements) {
  if (e.type === 'node') { nodes.set(e.id, round(project(e.lat, e.lon))); if (e.tags) nodeTags.set(e.id, e.tags); }
  else if (e.type === 'way') ways.set(e.id, e);
}
function round(p: Pt): Pt { return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]; }
function wayPts(w: any): Pt[] { return w.nodes.map((id: number) => nodes.get(id)).filter(Boolean); }
function isClosed(w: any) { return w.nodes.length > 3 && w.nodes[0] === w.nodes.at(-1); }
function open(pts: Pt[]) { return pts.slice(0, -1); }
function polyArea(r: Pt[]) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }
function pointInRing(p: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Stitch multipolygon member ways into closed rings.
function rings(members: any[], role: string): Pt[][] {
  const segs: number[][] = members
    .filter(m => m.type === 'way' && m.role === role && ways.has(m.ref))
    .map(m => [...ways.get(m.ref).nodes]);
  const out: Pt[][] = [];
  while (segs.length) {
    let ring = segs.shift()!;
    let grew = true;
    while (ring[0] !== ring.at(-1) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s[0] === ring.at(-1)) ring = ring.concat(s.slice(1));
        else if (s.at(-1) === ring.at(-1)) ring = ring.concat([...s].reverse().slice(1));
        else continue;
        segs.splice(i, 1); grew = true; break;
      }
    }
    if (ring[0] === ring.at(-1)) out.push(open(ring.map(id => nodes.get(id)!).filter(Boolean)));
  }
  return out;
}

const DRIVE = new Set(['primary', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'service', 'living_street', 'construction']);

// Nodes shared by two or more highway ways are junctions; smoothing keeps them fixed.
const useCount = new Map<number, number>();
for (const w of ways.values()) if (w.tags?.highway) for (const id of new Set<number>(w.nodes)) useCount.set(id, (useCount.get(id) ?? 0) + 1);

const relationOutlines = new Set<number>();
for (const e of raw.elements) if (e.type === 'relation' && e.tags?.building) for (const m of e.members) if (m.type === 'way') relationOutlines.add(m.ref);

const buildings: any[] = [], roads: any[] = [], areas: any[] = [], barriers: any[] = [];
const signals: any[] = [];
const steps: any[] = [], bumps: any[] = [], crossings: any[] = [], stops: any[] = [], waterways: any[] = [];
const fountains: Pt[] = [];
/** Building entrances: [x, y, kind, door]. */
const entrances: [number, number, string, string][] = [];
const trees: Pt[] = [], lamps: Pt[] = [], benches: Pt[] = [], bollards: Pt[] = [], kerbs: Pt[] = [], flagpoles: Pt[] = [], bikeRacks: Pt[] = [], bins: Pt[] = [];
let boundary: Pt[][] = [];
const uncertain = { estimatedHeights: 0, estimatedRoadWidths: 0, unnamedBuildings: 0, bumpsOffRoad: 0 };

function addBuilding(id: string, tags: any, outer: Pt[], holes: Pt[][]) {
  if (outer.length < 3) return;
  const est = estimateBuildingHeight(tags);
  if (est.estimated) uncertain.estimatedHeights++;
  if (!tags.name) uncertain.unnamedBuildings++;
  let h = est.height, minH = est.minHeight || undefined, style = buildingStyle(tags);
  if (tags.bridge === 'covered' || tags.bridge === 'yes' || (tags.covered === 'yes' && est.minHeight)) {
    // Skybridge: a 4 m enclosed walkway at its mapped level (default one storey up), never a solid tower.
    minH = Math.max(4.2, est.minHeight || 0);
    h = minH + 4;
    style = 'skybridge';
  } else if (tags.amenity === 'shelter') {
    h = 2.8; minH = undefined; style = 'shelter';
  } else if (est.estimated && !tags.name) {
    // Unnamed outbuildings with no height tag: a storey for small ones, two for larger.
    const a = Math.abs(polyArea(outer));
    if (a < 150) h = Math.min(h, 3.4);
    else if (a < 600) h = Math.min(h, 6.5);
  }
  buildings.push({
    id, name: tags.name, kind: tags.building, h, minH,
    levels: tags['building:levels'] ? +tags['building:levels'] : undefined,
    hEst: est.estimated || undefined, style, outer, holes: holes.length ? holes : undefined,
  });
}

/** Road centerline smoothed between junctions so bends become arcs instead of polygon corners. */
function smoothedWay(w: any, maxCut: number): Pt[] {
  const ids: number[] = w.nodes.filter((id: number) => nodes.has(id));
  const fixed = ids.map((id, i) => i === 0 || i === ids.length - 1 || (useCount.get(id) ?? 0) > 1 || nodeTags.has(id));
  return smoothPolyline(ids.map(id => nodes.get(id)!), fixed, maxCut).map(round);
}

for (const e of raw.elements) {
  const t = e.tags;
  if (!t) continue;
  if (e.type === 'node') {
    const p = nodes.get(e.id)!;
    if (t.natural === 'tree') trees.push(p);
    else if (t.highway === 'street_lamp') lamps.push(p);
    else if (t.amenity === 'bench') benches.push(p);
    else if (t.barrier === 'bollard') bollards.push(p);
    else if (t.man_made === 'flagpole') flagpoles.push(p);
    else if (t.amenity === 'bicycle_parking') bikeRacks.push(p);
    else if (t.amenity === 'waste_basket') bins.push(p);
    else if (t.amenity === 'fountain') fountains.push(p);
    if (t.entrance) entrances.push([p[0], p[1], t.entrance, t.door ?? (t.automatic_door ? 'automatic' : '')]);
    if (t.kerb === 'lowered' || t.kerb === 'flush' || t.kerb === 'no' || (t.barrier === 'kerb' && t.kerb !== 'raised')) kerbs.push(p);
    continue;
  }
  if (e.type === 'relation') {
    if (t.amenity === 'university') boundary = rings(e.members, 'outer');
    else if (t.building) {
      // Each inner ring belongs to the outer ring that contains it; earcut bridges holes that lie outside.
      const inners = rings(e.members, 'inner');
      rings(e.members, 'outer').forEach((r, k) => addBuilding('r' + e.id + (k ? '_' + k : ''), t, r, inners.filter(h => pointInRing(h[0], r))));
    }
    continue;
  }
  const pts = wayPts(e);
  if (pts.length < 2) continue;
  if (t.building) {
    // A way that is also the outline of a building relation would be built twice (and close the relation's holes).
    if (isClosed(e) && !relationOutlines.has(e.id)) addBuilding('w' + e.id, t, open(pts), []);
  } else if (t['area:highway'] === 'traffic_island' && isClosed(e)) {
    areas.push({ kind: 'island', outer: open(pts) });
  } else if (t.highway && isClosed(e) && (t.area === 'yes' || (t.highway === 'pedestrian' && t.area !== 'no'))) {
    areas.push({ kind: 'plaza', outer: open(pts) });
  } else if (t.highway === 'steps') {
    steps.push({ id: e.id, pts, w: estimateRoadWidth(t).width, n: t.step_count ? +t.step_count : undefined, handrail: t.handrail === 'yes' || undefined });
  } else if (t.highway && !['elevator', 'proposed', 'platform'].includes(t.highway)) {
    const w = estimateRoadWidth(t);
    if (w.estimated) uncertain.estimatedRoadWidths++;
    const drive = DRIVE.has(t.highway);
    roads.push({
      id: e.id, name: t.name, cls: t.highway, svc: t.service, fw: t.footway, w: w.width,
      lanes: t.lanes ? +t.lanes : undefined, oneway: t.oneway === 'yes' || undefined,
      surface: t.surface === 'concrete' || t.surface === 'paving_stones' ? t.surface : undefined, noLines: t.lane_markings === 'no' || undefined,
      promenade: t.highway === 'pedestrian' && /Rutford/i.test(t.name ?? '') || undefined,
      turnF: /left/.test(t['turn:lanes:forward'] ?? (t.oneway === 'yes' ? t['turn:lanes'] ?? '' : '')) ? t['turn:lanes:forward'] ?? t['turn:lanes'] : undefined,
      turnB: /left/.test(t['turn:lanes:backward'] ?? '') ? t['turn:lanes:backward'] : undefined,
      lanesF: t['lanes:forward'] ? +t['lanes:forward'] : undefined,
      lanesB: t['lanes:backward'] ? +t['lanes:backward'] : undefined,
      pts: smoothedWay(e, drive ? 5 : 1.5),
    });
    if (t.footway === 'crossing') crossings.push({ pts, w: Math.max(2.4, w.width) });
  } else if (t.natural === 'tree_row') {
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
      for (let k = 0; k < n; k++) trees.push(round([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]));
    }
  } else if (t.barrier === 'bollard') {
    // A line of bollards: evenly spaced about 1.9 m apart along the mapped way
    // (1.5 m clear between posts, the usual spacing that lets carts and bikes through).
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.9));
      for (let k = 0; k < n; k++) bollards.push(round([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]));
    }
    bollards.push(pts.at(-1)!);
  } else if (t.barrier && ['fence', 'wall', 'retaining_wall', 'hedge', 'jersey_barrier'].includes(t.barrier)) {
    barriers.push({ kind: t.barrier === 'jersey_barrier' ? 'wall' : t.barrier, pts, h: t.height ? parseFloat(t.height) || undefined : undefined });
  } else if (t.waterway && ['stream', 'ditch', 'drain'].includes(t.waterway) && t.tunnel !== 'culvert' && t.layer !== '-1') {
    waterways.push({ kind: t.waterway, pts, w: t.waterway === 'stream' ? 3 : 1.5 });
  } else if (isClosed(e)) {
    const kind = areaKind(t);
    // Campus lots carry their letter in `ref` (J, M East); name them as the campus map does.
    const name = t.name ?? (kind === 'parking' && t.ref ? (/^(SPN|Residence)/.test(t.ref) ? t.ref : `Lot ${t.ref}`) : undefined);
    if (kind) areas.push({ kind, outer: open(pts), sport: t.sport, name });
  }
}

// Traffic calming and stop lines sit on a node of a drivable road; take the road's direction and width there.
const driveWays = [...ways.values()].filter(w => w.tags?.highway && DRIVE.has(w.tags.highway));
const wayByNode = new Map<number, any[]>();
for (const w of driveWays) for (const id of w.nodes) { if (!wayByNode.has(id)) wayByNode.set(id, []); wayByNode.get(id)!.push(w); }
function roadAt(id: number) {
  const w = wayByNode.get(id)?.[0];
  if (!w) return undefined;
  const i = w.nodes.indexOf(id);
  const a = nodes.get(w.nodes[Math.max(0, i - 1)])!, b = nodes.get(w.nodes[Math.min(w.nodes.length - 1, i + 1)])!;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { dir: [Math.round((b[0] - a[0]) / l * 1000) / 1000, Math.round((b[1] - a[1]) / l * 1000) / 1000] as Pt, w: estimateRoadWidth(w.tags).width };
}
for (const [id, t] of nodeTags) {
  const tc = t.traffic_calming;
  if (tc && tc !== 'no' && tc !== 'island') {
    const r = roadAt(id);
    if (!r) { uncertain.bumpsOffRoad++; continue; }
    bumps.push({ p: nodes.get(id), kind: tc, dir: r.dir, w: r.w });
  }
  if (t.highway === 'traffic_signals') {
    // One signal per approaching drivable way: the light stands on the approach's right corner.
    const approaches: { dir: Pt; w: number }[] = [];
    for (const w of wayByNode.get(id) ?? []) {
      const i = w.nodes.indexOf(id);
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= w.nodes.length) continue;
        if (w.tags.oneway === 'yes' && j > i) continue; // traffic leaves the node that way
        const q = nodes.get(w.nodes[j])!, c = nodes.get(id)!;
        const l = Math.hypot(c[0] - q[0], c[1] - q[1]) || 1;
        approaches.push({ dir: [Math.round((c[0] - q[0]) / l * 1000) / 1000, Math.round((c[1] - q[1]) / l * 1000) / 1000], w: estimateRoadWidth(w.tags).width });
      }
    }
    if (approaches.length) signals.push({ p: nodes.get(id), approaches });
  }
  if (t.highway === 'stop' || t.highway === 'give_way') {
    const r = roadAt(id);
    if (r) stops.push({ p: nodes.get(id), dir: r.dir, w: r.w, kind: t.highway, fwd: t.direction === 'backward' ? -1 : t.direction === 'forward' ? 1 : 0 });
  }
}
// Speed tables mapped as short ways.
for (const w of ways.values()) {
  const tc = w.tags?.traffic_calming;
  if (!tc || tc === 'no' || w.tags.highway) continue;
  const pts = wayPts(w);
  const mid: Pt = [(pts[0][0] + pts.at(-1)![0]) / 2, (pts[0][1] + pts.at(-1)![1]) / 2];
  const along = Math.hypot(pts.at(-1)![0] - pts[0][0], pts.at(-1)![1] - pts[0][1]);
  const r = w.nodes.map(roadAt).find(Boolean);
  if (r) bumps.push({ p: round(mid), kind: tc, dir: r.dir, w: r.w, len: Math.round(along * 10) / 10 });
}

// Mapped bollard nodes sometimes double up with bollard lines; keep posts at least 1.7 m apart.
const spacedBollards: Pt[] = [];
for (const b of bollards) if (!spacedBollards.some(o => Math.hypot(o[0] - b[0], o[1] - b[1]) < 1.7)) spacedBollards.push(b);
bollards.length = 0;
bollards.push(...spacedBollards);

const curbs = computeCurbs(roads, crossings, kerbs, areas);

// Split carriageways: where two one-way roads run side by side in opposite directions with a
// narrow gap, the gap is built as a raised median (a wide curb) rather than bare grass.
const medians: { pts: Pt[]; w: number }[] = [];
{
  const ones = roads.filter(r => r.oneway && DRIVE.has(r.cls));
  for (const a of ones) {
    const run: Pt[] = [];
    let wsum = 0, n = 0;
    const flush = () => { if (run.length >= 3) medians.push({ pts: run.slice(), w: Math.round(wsum / n * 10) / 10 }); run.length = 0; wsum = 0; n = 0; };
    for (let i = 0; i < a.pts.length - 1; i++) {
      const p = a.pts[i], q = a.pts[i + 1], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, u: Pt = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
      for (let t = 0; t < l; t += 2) {
        const c: Pt = [p[0] + u[0] * t, p[1] + u[1] * t];
        let best: { m: Pt; gap: number } | null = null;
        for (const b of ones) {
          if (b === a || b.id < a.id) continue; // each pair once
          for (let j = 0; j < b.pts.length - 1; j++) {
            const e = b.pts[j], f = b.pts[j + 1], lb = Math.hypot(f[0] - e[0], f[1] - e[1]) || 1, ub: Pt = [(f[0] - e[0]) / lb, (f[1] - e[1]) / lb];
            if (u[0] * ub[0] + u[1] * ub[1] > -0.9) continue; // opposite direction, nearly parallel
            const tt = Math.max(0, Math.min(lb, (c[0] - e[0]) * ub[0] + (c[1] - e[1]) * ub[1]));
            const qq: Pt = [e[0] + ub[0] * tt, e[1] + ub[1] * tt];
            const d = Math.hypot(qq[0] - c[0], qq[1] - c[1]);
            const gap = d - a.w / 2 - b.w / 2;
            if (gap > 0.8 && gap < 9 && (!best || gap < best.gap)) best = { m: [(c[0] + qq[0]) / 2, (c[1] + qq[1]) / 2], gap };
          }
        }
        if (best) { run.push(round(best.m)); wsum += best.gap - 0.2; n++; } else flush();
      }
    }
    flush();
  }
}

const out = {
  curbs,
  medians,
  meta: {
    origin: ORIGIN,
    source: 'OpenStreetMap contributors (ODbL 1.0) via Overpass API',
    attribution: '© OpenStreetMap contributors',
    osmTimestamp: raw.osm3s?.timestamp_osm_base,
    generated: new Date().toISOString(),
    units: 'meters; x east, y north of origin',
    uncertain,
  },
  boundary, buildings, roads, areas, barriers, steps, bumps, crossings, stops, waterways,
  trees, lamps, benches, bollards, kerbs, flagpoles, bikeRacks, bins, fountains, entrances, signals,
};
await mkdir('public/data', { recursive: true });
await writeFile('public/data/campus.json', JSON.stringify(out));

// Verification list: every value that was estimated rather than mapped.
const verification = {
  generated: out.meta.generated,
  note: 'Features whose dimensions were estimated by rule. Verify against site survey or licensed reference data.',
  namedBuildingsWithEstimatedHeight: buildings.filter(b => b.hEst && b.name && !/^\d+$/.test(b.name)).map(b => ({ id: b.id, name: b.name, kind: b.kind, assumedHeightM: b.h })),
  unnamedCampusBuildings: buildings.filter(b => !b.name && ['university', 'yes', 'roof', 'service', 'parking'].includes(b.kind)).map(b => ({ id: b.id, kind: b.kind })),
  roadsWithEstimatedWidth: roads.filter(r => r.name && ['secondary', 'tertiary', 'unclassified', 'service'].includes(r.cls)).map(r => ({ id: r.id, name: r.name, cls: r.cls, widthM: r.w })),
  stepsWithoutStepCount: steps.filter(s => !s.n).length,
  counts: uncertain,
};
await mkdir('data/verification', { recursive: true });
await writeFile('data/verification/uncertain-features.json', JSON.stringify(verification, null, 1));
console.log(`curb runs ${curbs.length} (${Math.round(curbs.reduce((s, c) => s + c.length, 0))} vertices), buildings ${buildings.length}, roads ${roads.length}, areas ${areas.length}, steps ${steps.length}, bumps ${bumps.length}, crossings ${crossings.length}, stops ${stops.length}, bollards ${bollards.length}, kerbs ${kerbs.length}, trees(osm) ${trees.length}, lamps ${lamps.length}, barriers ${barriers.length}, waterways ${waterways.length}`);
console.log('uncertain', uncertain);
