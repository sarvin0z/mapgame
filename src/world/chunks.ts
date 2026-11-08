import type { CampusData, Building, Road, Area, Barrier, Pt, Steps, Bump, Crossing, StopLine, Waterway, Tree } from './campusData.ts';
import { centroid } from './geometry.ts';

export const CHUNK_SIZE = 200; // meters

export function chunkKey(cx: number, cy: number) { return `${cx},${cy}`; }
export function chunkOf(p: Pt): [number, number] { return [Math.floor(p[0] / CHUNK_SIZE), Math.floor(p[1] / CHUNK_SIZE)]; }

export interface ChunkContent {
  cx: number;
  cy: number;
  /** Center in map meters [east, north] */
  center: Pt;
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  barriers: Barrier[];
  steps: Steps[];
  curbs: Pt[][];
  medians: { pts: Pt[]; w: number }[];
  bumps: Bump[];
  crossings: Crossing[];
  stops: StopLine[];
  waterways: Waterway[];
  trees: Tree[];
  lamps: Pt[];
  benches: Pt[];
  bollards: Pt[];
  flagpoles: Pt[];
  bikeRacks: Pt[];
  bins: Pt[];
  entrances: [number, number, string, string][];
  signals: CampusData['signals'];
}

function empty(cx: number, cy: number): ChunkContent {
  return {
    cx, cy, center: [(cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE],
    buildings: [], roads: [], areas: [], barriers: [], steps: [], curbs: [], medians: [], bumps: [], crossings: [], stops: [], waterways: [],
    trees: [], lamps: [], benches: [], bollards: [], flagpoles: [], bikeRacks: [], bins: [], entrances: [], signals: [],
  };
}

/**
 * Bins every feature into a fixed grid by its anchor point (centroid for
 * polygons, midpoint vertex for lines). Long lines are split into
 * per-chunk pieces so no chunk owns geometry far outside itself.
 */
export function partition(data: CampusData): Map<string, ChunkContent> {
  const map = new Map<string, ChunkContent>();
  const get = (p: Pt) => {
    const [cx, cy] = chunkOf(p);
    const k = chunkKey(cx, cy);
    let c = map.get(k);
    if (!c) { c = empty(cx, cy); map.set(k, c); }
    return c;
  };
  for (const b of data.buildings) get(centroid(b.outer)).buildings.push(b);
  for (const a of data.areas) get(centroid(a.outer)).areas.push(a);
  for (const r of data.roads) for (const piece of splitByChunk(r.pts)) get(piece[Math.floor(piece.length / 2)]).roads.push({ ...r, pts: piece, full: r.pts });
  for (const b of data.barriers) for (const piece of splitByChunk(b.pts)) get(piece[0]).barriers.push({ ...b, pts: piece });
  for (const w of data.waterways ?? []) for (const piece of splitByChunk(w.pts)) get(piece[0]).waterways.push({ ...w, pts: piece });
  for (const c of data.curbs ?? []) for (const piece of splitByChunk(c)) get(piece[0]).curbs.push(piece);
  for (const m of data.medians ?? []) for (const piece of splitByChunk(m.pts)) get(piece[0]).medians.push({ pts: piece, w: m.w });
  for (const s of data.steps ?? []) get(s.pts[Math.floor(s.pts.length / 2)]).steps.push(s);
  for (const c of data.crossings ?? []) get(c.pts[0]).crossings.push(c);
  for (const b of data.bumps ?? []) get(b.p).bumps.push(b);
  for (const s of data.stops ?? []) get(s.p).stops.push(s);
  for (const t of data.treeList ?? data.trees.map(p => [p[0], p[1], 8, 3, 1] as Tree)) get([t[0], t[1]]).trees.push(t);
  for (const e of data.entrances ?? []) get([e[0], e[1]]).entrances.push(e);
  for (const sg of data.signals ?? []) get(sg.p).signals.push(sg);
  for (const k of ['lamps', 'benches', 'bollards', 'flagpoles', 'bikeRacks', 'bins'] as const)
    for (const p of data[k] ?? []) get(p)[k].push(p);
  return map;
}

/** Splits a polyline into consecutive pieces whose first vertex lies in one chunk; pieces share endpoints. */
export function splitByChunk(pts: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [pts[0]];
  let key = chunkKey(...chunkOf(pts[0]));
  for (let i = 1; i < pts.length; i++) {
    cur.push(pts[i]);
    const k = chunkKey(...chunkOf(pts[i]));
    if (k !== key && i < pts.length - 1) {
      out.push(cur);
      cur = [pts[i]];
      key = k;
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

/** Every chunk key covering the terrain grid, so ground exists even where there are no features. */
export function ensureChunks(map: Map<string, ChunkContent>, x0: number, y0: number, x1: number, y1: number) {
  for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++)
    for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++)
      if (!map.has(chunkKey(cx, cy))) map.set(chunkKey(cx, cy), empty(cx, cy));
}
