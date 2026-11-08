// Builds the per-building reconstruction plan.
//  - Geometry, coordinates and heights come from OSM (public/data/campus.json, raw tags).
//  - Architecture comes only from reconstruction/observations.json (written from
//    reference photos); anything not observed is reported as unknown.
//  - Buildings are ranked by visibility: metres of facade within 25 m of a road
//    (x2) or walkway (x1), plus mapped entrances.
// Outputs: docs/RECONSTRUCTION_PLAN.md and reconstruction/specs.json (for Blender).
// Run with: node scripts/reconstruction-plan.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { unproject } from '../src/geo/projection.ts';
import { orientedRectPlain } from './rect.ts';

type Pt = [number, number];
const campus = JSON.parse(await readFile('public/data/campus.json', 'utf8'));
const raw = JSON.parse(await readFile('data/raw/utd-osm.json', 'utf8'));
const obs = JSON.parse(await readFile('reconstruction/observations.json', 'utf8')).buildings as Record<string, any>;

const tagsById = new Map<string, any>();
for (const e of raw.elements) if (e.tags?.building) tagsById.set(e.type[0] + e.id, e.tags);

const CAMPUS_KINDS = new Set(['university', 'dormitory', 'public', 'garage', 'parking', 'school']);
const area = (r: Pt[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
const cen = (r: Pt[]) => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]) as Pt;

const segs: { a: Pt; b: Pt; road: boolean }[] = [];
for (const r of campus.roads) {
  const road = ['secondary', 'tertiary', 'unclassified', 'residential', 'service'].includes(r.cls);
  const walk = ['footway', 'pedestrian', 'path', 'cycleway'].includes(r.cls);
  if (!road && !walk) continue;
  for (let i = 0; i < r.pts.length - 1; i++) segs.push({ a: r.pts[i], b: r.pts[i + 1], road });
}
function distSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function visibility(ring: Pt[]) {
  let score = 0;
  const near = segs.filter(s => ring.some(p => Math.hypot(p[0] - s.a[0], p[1] - s.a[1]) < 150));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0.5; t < l; t += 2) {
      const p: Pt = [a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l];
      let w = 0;
      for (const s of near) if (distSeg(p, s.a, s.b) < 25) { w = Math.max(w, s.road ? 2 : 1); if (w === 2) break; }
      score += w * 2;
    }
  }
  return score;
}

const entrancesNear = (ring: Pt[]) => (campus.entrances as [number, number, string, string][]).filter(e => ring.some((p, i) => distSeg([e[0], e[1]], p, ring[(i + 1) % ring.length]) < 2));

const rows: any[] = [];
for (const b of campus.buildings) {
  if (!b.name || /^\d+$/.test(b.name) || !CAMPUS_KINDS.has(b.kind) || b.style === 'skybridge') continue;
  const a = area(b.outer);
  if (a < 300) continue;
  const t = tagsById.get(b.id) ?? {};
  const c = cen(b.outer), ll = unproject(c[0], c[1]);
  const r = orientedRectPlain(b.outer);
  const ents = entrancesNear(b.outer);
  const heightSrc = t.height ? 'OSM height tag' : t['building:levels'] ? `OSM levels (${t['building:levels']}) x 3.6 m + 1 m` : 'estimated by building type';
  rows.push({
    id: b.id, name: b.name, short: t.short_name, lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6),
    areaM2: Math.round(a), lengthM: +r.L.toFixed(1), widthM: +r.W.toFixed(1), vertices: b.outer.length, holes: b.holes?.length ?? 0,
    heightM: b.h, levels: b.levels ?? null, heightSource: heightSrc, heightConf: t.height ? 'high' : t['building:levels'] ? 'medium' : 'low',
    roofTag: t['roof:shape'] ?? null, entrances: ents.map(e => e[2] + (e[3] ? '/' + e[3] : '')),
    visibility: visibility(b.outer), obs: obs[b.name] ?? null,
  });
}
rows.sort((x, y) => y.visibility - x.visibility);
rows.forEach((r, i) => { r.priority = i + 1; });

// Specs for Blender: buildings with an observed recipe (and their geometry).
const specs = rows.filter(r => r.obs?.recipe).map(r => {
  const b = campus.buildings.find((x: any) => x.id === r.id);
  // Front = the facade with the most road/walkway frontage; entrances and signature features go there.
  let front = 0, fs = -1;
  for (let i = 0; i < b.outer.length; i++) {
    const e = [b.outer[i], b.outer[(i + 1) % b.outer.length]];
    const l = Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]);
    if (l < 6) continue;
    const sc = visibility(e as Pt[]) * Math.min(1, l / 20);
    if (sc > fs) { fs = sc; front = i; }
  }
  const fa = b.outer[front], fb = b.outer[(front + 1) % b.outer.length];
  return { id: r.id, name: r.name, slug: r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), outer: b.outer, holes: b.holes ?? [], h: b.h, levels: b.levels ?? null, recipe: r.obs.recipe, priority: r.priority, front: [fa, fb] };
});
await mkdir('reconstruction', { recursive: true });
await writeFile('reconstruction/specs.json', JSON.stringify({ generated: new Date().toISOString(), buildings: specs }, null, 1));

// ---------- Markdown ----------
const conf = (x: any) => x ? `${x[0]} *(${x[1]})*` : '_unknown: no reference_';
let md = `# Building reconstruction plan

Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/reconstruction-plan.ts\`. Do not edit by hand: change
\`reconstruction/observations.json\` (architecture, from photos) and re-run.

**Sources.** Coordinates, footprints, heights and entrances: OpenStreetMap (snapshot ${raw.osm3s?.timestamp_osm_base?.slice(0, 10)}).
Architecture: official UT Dallas photographs listed per building (files in the user's reference folder, sources in its \`sources.csv\`).
Nothing is traced from Google imagery. Where no reference shows a feature it is marked unknown and the game keeps a
neutral generic treatment for it rather than inventing one.

**Confidence.** *high*: clearly visible in an official photo, or a mapped OSM tag. *medium*: partly visible, one side only,
or derived from OSM levels. *low*: estimated by building type or from a distant view.

**Priority** ranks ${rows.length} campus buildings (footprint ≥ 300 m²) by visibility: metres of facade within 25 m of a
drivable road (weight 2) or walkway (weight 1).

| # | Building | Visibility | Reference photos | GLB model |
|---|---|---|---|---|
${rows.map(r => `| ${r.priority} | ${r.name} | ${r.visibility} | ${r.obs ? r.obs.refs.length : 0} | ${r.obs?.recipe ? 'yes' : '—'} |`).join('\n')}

`;
for (const r of rows) {
  const o = r.obs;
  md += `## ${r.priority}. ${r.name}${r.short ? ` (${r.short})` : ''}

| Item | Value | Confidence |
|---|---|---|
| Coordinates | ${r.lat}, ${r.lon} | high (OSM) |
| Footprint | ${r.areaM2} m², ~${r.lengthM} × ${r.widthM} m oriented box, ${r.vertices} vertices${r.holes ? `, ${r.holes} courtyard(s)` : ''} | high (OSM) |
| Height | ${r.heightM} m${r.levels ? `, ${r.levels} floors` : ''} — ${r.heightSource} | ${r.heightConf} |
| Roof | ${o ? conf(o.roof) : r.roofTag ? `${r.roofTag} (OSM tag)` : '_unknown: no reference_'} | |
| Materials | ${o ? conf(o.materials) : '_unknown: no reference_'} | |
| Windows | ${o ? conf(o.windows) : '_unknown: no reference_'} | |
| Entrances | ${o ? conf(o.entrances) : '—'}; OSM maps ${r.entrances.length}${r.entrances.length ? ` (${[...new Set(r.entrances)].join(', ')})` : ''} | |
| Features | ${o?.features?.length ? o.features.map((f: any) => `${f[0]} *(${f[1]})*`).join('; ') : '—'} | |
| Not known | ${o?.unknown?.length ? o.unknown.join('; ') : o ? '—' : 'architecture (no reference photo)'} | |
| References | ${o ? o.refs.join(', ') : '**none — needs a photo**'} | |
| Reconstruction | ${o?.recipe ? `Blender GLB (\`public/models/buildings/${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.glb\`)` : 'procedural extrusion with generic facade'} | |

`;
}
await mkdir('docs', { recursive: true });
await writeFile('docs/RECONSTRUCTION_PLAN.md', md);
console.log(`${rows.length} buildings ranked; ${rows.filter(r => r.obs).length} with references; ${specs.length} GLB specs`);
console.log(rows.slice(0, 30).map(r => `${r.priority}. ${r.name} v${r.visibility}${r.obs ? ' *' : ''}`).join('\n'));
