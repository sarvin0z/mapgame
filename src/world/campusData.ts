import type { LatLon } from '../geo/projection.ts';

export type Pt = [number, number]; // [east, north] meters

export interface Building {
  /** The OSM name a reconstructed model was built under, when the shown name was corrected. */
  modelName?: string;
  id: string;
  name?: string;
  kind: string;
  h: number;
  minH?: number;
  hEst?: boolean;
  levels?: number;
  style: string;
  outer: Pt[];
  holes?: Pt[][];
}

export interface Road {
  id: number;
  name?: string;
  cls: string;
  svc?: string;
  fw?: string;
  w: number;
  lanes?: number;
  oneway?: boolean;
  /** Paving other than asphalt (concrete roads show panel joints). */
  surface?: string;
  /** Mapped lane_markings=no. */
  noLines?: boolean;
  /** Rutford Avenue's pedestrian promenade (striped paving). */
  promenade?: boolean;
  /** turn:lanes values (forward / backward) when they include a left-turn lane. */
  turnF?: string;
  turnB?: string;
  lanesF?: number;
  lanesB?: number;
  pts: Pt[];
  /** The whole way, on the per-chunk pieces made by `partition` (for features placed along the way). */
  full?: Pt[];
}

export interface Area { kind: string; outer: Pt[]; sport?: string; name?: string }
export interface Barrier { kind: string; pts: Pt[]; h?: number }
export interface Steps { id: number; pts: Pt[]; w: number; n?: number; handrail?: boolean }
/** Traffic calming on a road node: `dir` is the road direction, `w` its width. */
export interface Bump { p: Pt; kind: string; dir: Pt; w: number; len?: number }
export interface Crossing { pts: Pt[]; w: number }
/** `fwd`: 1 applies to traffic along `dir`, -1 against it, 0 unknown. */
export interface StopLine { p: Pt; dir: Pt; w: number; kind: string; fwd: number }
export interface Waterway { kind: string; pts: Pt[]; w: number }
/** [x, y, height m, crown radius m, fromOsm 0/1] */
export type Tree = [number, number, number, number, number];

export interface CampusData {
  meta: {
    origin: LatLon;
    source: string;
    attribution: string;
    osmTimestamp?: string;
    uncertain: Record<string, number>;
  };
  boundary: Pt[][];
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  barriers: Barrier[];
  steps: Steps[];
  /** Curb lines (0.15 m outside the road edge) on curbed streets. */
  curbs: Pt[][];
  /** Raised medians between split one-way carriageways: centreline and width. */
  medians: { pts: Pt[]; w: number }[];
  bumps: Bump[];
  crossings: Crossing[];
  stops: StopLine[];
  waterways: Waterway[];
  /** OSM-mapped trees only; `treeList` holds the merged canopy-model list. */
  trees: Pt[];
  treeList: Tree[];
  lamps: Pt[];
  benches: Pt[];
  bollards: Pt[];
  kerbs: Pt[];
  flagpoles: Pt[];
  bikeRacks: Pt[];
  bins: Pt[];
  fountains: Pt[];
  /** [x, y, entrance kind, door type] */
  entrances: [number, number, string, string][];
  /** Signalised intersections: node and the direction (toward the node) and width of each approach. */
  signals: { p: Pt; approaches: { dir: Pt; w: number }[] }[];
}

export async function loadCampus(base = 'data/'): Promise<CampusData> {
  const get = async (f: string) => {
    const res = await fetch(base + f);
    if (!res.ok) throw new Error(`Failed to load ${f}: ${res.status}`);
    return res.json();
  };
  const [campus, trees] = await Promise.all([get('campus.json'), get('trees.json')]);
  campus.treeList = trees.trees;
  campus.bumps = dedupeBumps(campus.bumps).filter(b => !REMOVED_BUMPS.some(q => Math.hypot(q[0] - b.p[0], q[1] - b.p[1]) < 4));
  campus.medians = openMedians(campus.medians, campus.roads);
  hugRoundabout(campus.roads);
  for (const b of campus.buildings) {
    Object.assign(b, BUILDING_OVERRIDES[b.name ?? ''] ?? {});
    const fixed = NAME_FIXES[b.name ?? ''];
    if (fixed) { b.modelName = b.name; b.name = fixed; }
  }
  return campus;
}

/**
 * Traffic-calming devices mapped in OSM that are not there on site (user's site
 * knowledge, 2026-11-01): the raised table on Drive H at the University Village
 * exit. Logged in docs/ISSUES.md.
 */
/**
 * Corrections from the user's site knowledge (2026-11-01) where OSM's height,
 * level count or our inferred style is wrong. Logged in docs/ISSUES.md.
 */
const BUILDING_OVERRIDES: Record<string, Partial<Building>> = {
  // Two storeys with the orange accent panels of the 2016 renovation.
  'Callier Center Richardson': { levels: 2, h: 8.6, style: 'callier' },
  // Finished (2026): the Athenaeum's Performance Hall and Music Building beside the museum.
  'Performance Hall and Music Building': { style: 'stoneHall', kind: 'university', h: 21, levels: 4 },
  'Naveen Jindal School of Management': { style: 'jsom' },
  // Three storeys, taller than the Union it adjoins, all glass in a grey frame.
  'Comets LANding': { style: 'cometsGlass', levels: 3, h: 15.5 },
};

/**
 * The sidewalk round the central roundabout runs right along its curb on site
 * (user's site knowledge, 2026-11-01); in OSM it sits several metres out. Walk
 * vertices in that band (the ring and the ends of the walks joining it) are
 * moved radially to 0.3 m outside the curb. Crossings keep their position.
 */
function hugRoundabout(roads: Road[]) {
  const ring = roads.filter(r => r.name === 'Roundabout' && DRIVABLE.has(r.cls));
  const pts = ring.flatMap(r => r.pts);
  if (pts.length < 8) return;
  const c: Pt = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const R = pts.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / pts.length;
  const edge = R + Math.max(...ring.map(r => r.w)) / 2;
  for (const r of roads) {
    if (!PATHS.has(r.cls) || r.fw === 'crossing') continue;
    const target = edge + 0.3 + r.w / 2;
    r.pts = r.pts.map(p => {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d < target || d > edge + 12) return p;
      return [c[0] + (p[0] - c[0]) * target / d, c[1] + (p[1] - c[1]) * target / d];
    });
  }
}

/** Names corrected to the university's own spelling (OSM has a typo and an older name). */
const NAME_FIXES: Record<string, string> = {
  'Reasearch Operations Center West': 'Research Operations Center West',
  'Bioengineering Science Building': 'Bioengineering and Sciences Building',
};

const REMOVED_BUMPS: Pt[] = [[-332.39, -108.16], [-326.22, -109.26]];

/**
 * Medians are inferred from the gap between paired one-way carriageways (see
 * scripts/process-osm.ts), so they ran unbroken through junctions and left
 * stubs inside intersections. Open them wherever another drivable road comes
 * within its half-width + 4 m at a crossing angle (over 35 degrees to the
 * median), so turns across them are possible, and drop leftover pieces
 * shorter than 10 m.
 */
export function openMedians(medians: { pts: Pt[]; w: number }[], roads: Road[]): { pts: Pt[]; w: number }[] {
  const drive = roads.filter(r => DRIVABLE.has(r.cls));
  const out: { pts: Pt[]; w: number }[] = [];
  for (const m of medians) {
    const blocked = m.pts.map((p, i) => {
      const a = m.pts[Math.max(0, i - 1)], b = m.pts[Math.min(m.pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      for (const r of drive) for (let j = 0; j < r.pts.length - 1; j++) {
        const e = r.pts[j], f = r.pts[j + 1], lf = Math.hypot(f[0] - e[0], f[1] - e[1]) || 1;
        const v = [(f[0] - e[0]) / lf, (f[1] - e[1]) / lf];
        if (Math.abs(u[0] * v[0] + u[1] * v[1]) > Math.cos(35 * Math.PI / 180)) continue;
        const t = Math.max(0, Math.min(lf, (p[0] - e[0]) * v[0] + (p[1] - e[1]) * v[1]));
        if (Math.hypot(e[0] + v[0] * t - p[0], e[1] + v[1] * t - p[1]) < r.w / 2 + 4) return true;
      }
      return false;
    });
    let run: Pt[] = [];
    const flush = () => {
      let len = 0;
      for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      if (run.length >= 2 && len >= 10) out.push({ pts: run, w: m.w });
      run = [];
    };
    m.pts.forEach((p, i) => { if (blocked[i]) flush(); else run.push(p); });
    flush();
  }
  return out;
}

const BUMP_RANK: Record<string, number> = { table: 3, hump: 2, bump: 1, mini_bumps: 0 };
/**
 * One device per spot: where OSM maps two traffic-calming nodes within 8 m on
 * the same road (a bump node beside a mini-bumps node, two halves of one
 * raised crossing), keep the larger device only, so they never overlap.
 */
export function dedupeBumps(bumps: Bump[]): Bump[] {
  const out: Bump[] = [];
  for (const b of [...bumps].sort((x, y) => (BUMP_RANK[y.kind] ?? 1) - (BUMP_RANK[x.kind] ?? 1))) {
    if (!out.some(o => Math.hypot(o.p[0] - b.p[0], o.p[1] - b.p[1]) < 8)) out.push(b);
  }
  return out;
}

export const DRIVABLE = new Set([
  'primary', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'service', 'living_street', 'construction',
]);
export const PATHS = new Set(['footway', 'cycleway', 'path', 'pedestrian', 'steps', 'track']);
