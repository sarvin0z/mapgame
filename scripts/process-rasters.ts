// Turns the downloaded rasters into game data, in local meters:
//  - public/data/terrain.bin + terrain.json: 3DEP bare-earth heights on a 2 m grid.
//  - public/data/trees.json: individual trees detected in the 1 m canopy height
//    model (local maxima), with height and crown radius measured from the raster.
// Needs public/data/campus.json (run process-osm first) to mask out trees that
// fall on buildings, roads and water.
// Run with: node scripts/process-rasters.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { project, unproject, ORIGIN } from '../src/geo/projection.ts';
import { writePng } from './png.ts';

type Pt = [number, number];
const STEP = 2;

const demMeta = JSON.parse(await readFile('data/raw/dem.json', 'utf8'));
const dem = new Float32Array((await readFile('data/raw/dem.f32')).buffer.slice(0));
const chmMeta = JSON.parse(await readFile('data/raw/chm.json', 'utf8'));
const chm = new Float32Array((await readFile('data/raw/chm.f32')).buffer.slice(0));
const campus = JSON.parse(await readFile('public/data/campus.json', 'utf8'));

function bilinear(arr: Float32Array, w: number, h: number, fx: number, fy: number) {
  fx = Math.max(0, Math.min(w - 1.001, fx)); fy = Math.max(0, Math.min(h - 1.001, fy));
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
  const i = y * w + x;
  return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - ty) + (arr[i + w] * (1 - tx) + arr[i + w + 1] * tx) * ty;
}

// ---------- Terrain ----------
const [W, S, E, N] = demMeta.bbox;
const sw = project(S, W), ne = project(N, E), nw = project(N, W), se = project(S, E);
const x0 = Math.ceil(Math.max(sw[0], nw[0]) / STEP) * STEP, x1 = Math.floor(Math.min(se[0], ne[0]) / STEP) * STEP;
const y0 = Math.ceil(Math.max(sw[1], se[1]) / STEP) * STEP, y1 = Math.floor(Math.min(nw[1], ne[1]) / STEP) * STEP;
const nx = (x1 - x0) / STEP + 1, ny = (y1 - y0) / STEP + 1;

function demAt(lat: number, lon: number) {
  const fx = (lon - W) / (E - W) * demMeta.width - 0.5;
  const fy = (N - lat) / (N - S) * demMeta.height - 0.5;
  return bilinear(dem, demMeta.width, demMeta.height, fx, fy);
}
const base = Math.round(demAt(ORIGIN.lat, ORIGIN.lon) * 10) / 10;
let grid = new Float32Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const ll = unproject(x0 + i * STEP, y0 + j * STEP);
  grid[j * nx + i] = demAt(ll.lat, ll.lon) - base;
}
// One pass of a [1 2 1] Gaussian removes lidar speckle while keeping curbs-scale relief.
function blur(src: Float32Array, w: number, h: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = src[j * w + Math.max(0, i - 1)], b = src[j * w + i], c = src[j * w + Math.min(w - 1, i + 1)];
    tmp[j * w + i] = (a + 2 * b + c) / 4;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = tmp[Math.max(0, j - 1) * w + i], b = tmp[j * w + i], c = tmp[Math.min(h - 1, j + 1) * w + i];
    out[j * w + i] = (a + 2 * b + c) / 4;
  }
  return out;
}
grid = blur(grid, nx, ny);

// Paved surfaces (roads, walks, plazas, lots) are graded smoothly in reality: the lidar
// steps and kinks along them come from curbs, planters and interpolation under removed
// buildings. Under paving the heights are replaced by a much smoother surface (about
// 4 m Gaussian); playing fields and courts are levelled to their mean height.
{
  const paved = new Uint8Array(nx * ny);
  const cell = (x: number, y: number) => [Math.round((x - x0) / STEP), Math.round((y - y0) / STEP)];
  const markPoly = (ring: Pt[], v: number, target: Uint8Array) => {
    let ymin = Infinity, ymax = -Infinity;
    for (const p of ring) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
    for (let j = Math.max(0, Math.ceil((ymin - y0) / STEP)); j <= Math.min(ny - 1, Math.floor((ymax - y0) / STEP)); j++) {
      const yy = y0 + j * STEP, xs: number[] = [];
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [pa, pb] = [ring[a], ring[b]];
        if ((pa[1] > yy) !== (pb[1] > yy)) xs.push(pa[0] + (yy - pa[1]) / (pb[1] - pa[1]) * (pb[0] - pa[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let i = Math.max(0, Math.ceil((xs[k] - x0) / STEP)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / STEP)); i++) target[j * nx + i] = v;
    }
  };
  for (const r of campus.roads) {
    if (r.cls === 'steps') continue;
    const hw = r.w / 2 + 1;
    for (let k = 0; k < r.pts.length - 1; k++) {
      const [a, b] = [r.pts[k], r.pts[k + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= len; t += 1) {
        const px = a[0] + (b[0] - a[0]) * t / (len || 1), py = a[1] + (b[1] - a[1]) * t / (len || 1);
        for (let dy = -hw; dy <= hw; dy += 1) for (let dx = -hw; dx <= hw; dx += 1) {
          if (dx * dx + dy * dy > hw * hw) continue;
          const [i, j] = cell(px + dx, py + dy);
          if (i >= 0 && j >= 0 && i < nx && j < ny) paved[j * nx + i] = 1;
        }
      }
    }
  }
  for (const a of campus.areas) if (['plaza', 'parking'].includes(a.kind)) markPoly(a.outer, 1, paved);
  let smooth = grid;
  for (let k = 0; k < 6; k++) smooth = blur(smooth, nx, ny);
  for (let k = 0; k < grid.length; k++) if (paved[k]) grid[k] = smooth[k];
  // Level fields and courts.
  for (const a of campus.areas) {
    if (!['pitch', 'track'].includes(a.kind)) continue;
    const m = new Uint8Array(nx * ny);
    markPoly(a.outer, 1, m);
    let sum = 0, n = 0;
    for (let k = 0; k < m.length; k++) if (m[k]) { sum += grid[k]; n++; }
    if (n) for (let k = 0; k < m.length; k++) if (m[k]) grid[k] = sum / n;
  }
  grid = blur(grid, nx, ny);
}
const cm = new Int16Array(grid.length);
let gmin = Infinity, gmax = -Infinity;
for (let k = 0; k < grid.length; k++) { cm[k] = Math.round(grid[k] * 100); gmin = Math.min(gmin, grid[k]); gmax = Math.max(gmax, grid[k]); }
await mkdir('public/data', { recursive: true });
await writeFile('public/data/terrain.bin', Buffer.from(cm.buffer));
await writeFile('public/data/terrain.json', JSON.stringify({
  x0, y0, nx, ny, step: STEP, baseElevationM: base, minM: gmin, maxM: gmax, encoding: 'int16 centimeters, row-major, rows south to north',
  source: 'USGS 3D Elevation Program (3DEP) bare-earth DEM, public domain', fetched: demMeta.fetched,
}));
console.log(`terrain ${nx}x${ny} @${STEP} m, base ${base} m, relief ${gmin.toFixed(1)}..${gmax.toFixed(1)} m`);

const terrainH = (x: number, y: number) => bilinear(grid, nx, ny, (x - x0) / STEP, (y - y0) / STEP);

// ---------- Trees from the canopy height model ----------
const R = 6378137;
const [cx0, cy0, cx1, cy1] = chmMeta.bbox3857;
function chmAt(x: number, y: number) {
  const ll = unproject(x, y);
  const mx = R * ll.lon * Math.PI / 180, my = R * Math.log(Math.tan(Math.PI / 4 + ll.lat * Math.PI / 360));
  return bilinear(chm, chmMeta.width, chmMeta.height, (mx - cx0) / (cx1 - cx0) * chmMeta.width - 0.5, (cy1 - my) / (cy1 - cy0) * chmMeta.height - 0.5);
}
const tw = Math.floor(x1 - x0), th = Math.floor(y1 - y0);
const canopy = new Float32Array(tw * th);
for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) canopy[j * tw + i] = chmAt(x0 + i + 0.5, y0 + j + 0.5);
const cs = blur(canopy, tw, th);

// Masks rasterized at 1 m: buildings, water, drivable road surface.
const mask = new Uint8Array(tw * th); // 1 building, 2 water, 3 road, 4 construction
function fillPoly(ring: Pt[], v: number) {
  let ymin = Infinity, ymax = -Infinity;
  for (const p of ring) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  for (let j = Math.max(0, Math.floor(ymin - y0)); j <= Math.min(th - 1, Math.ceil(ymax - y0)); j++) {
    const yy = y0 + j + 0.5, xs: number[] = [];
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [pa, pb] = [ring[a], ring[b]];
      if ((pa[1] > yy) !== (pb[1] > yy)) xs.push(pa[0] + (yy - pa[1]) / (pb[1] - pa[1]) * (pb[0] - pa[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let i = Math.max(0, Math.ceil(xs[k] - x0 - 0.5)); i <= Math.min(tw - 1, Math.floor(xs[k + 1] - x0 - 0.5)); i++) mask[j * tw + i] = v;
  }
}
for (const a of campus.areas) if (a.kind === 'construction') fillPoly(a.outer, 4);
for (const a of campus.areas) if (a.kind === 'water' || a.kind === 'pool') fillPoly(a.outer, 2);
for (const a of campus.areas) if (['pitch', 'track', 'plaza', 'parking'].includes(a.kind)) fillPoly(a.outer, 3);
for (const b of campus.buildings) if (b.kind !== 'roof') fillPoly(b.outer, 1);
// Every road and walkway: no trunk may stand on pavement.
for (const r of campus.roads) {
  const hw = Math.max(0.6, r.w / 2 + 0.4);
  for (let k = 0; k < r.pts.length - 1; k++) {
    const [a, b] = [r.pts[k], r.pts[k + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= len; s += 0.5) {
      const px = a[0] + (b[0] - a[0]) * s / len, py = a[1] + (b[1] - a[1]) * s / len;
      for (let dy = -hw; dy <= hw; dy += 0.7) for (let dx = -hw; dx <= hw; dx += 0.7) {
        if (dx * dx + dy * dy > hw * hw) continue;
        const i = Math.floor(px + dx - x0), j = Math.floor(py + dy - y0);
        if (i >= 0 && j >= 0 && i < tw && j < th && mask[j * tw + i] === 0) mask[j * tw + i] = 3;
      }
    }
  }
}

const trees: number[][] = [];
const dropped = { building: 0, water: 0, road: 0, construction: 0 };
// Peaks lower than 4 m are mostly shrubs and hedges, which read as stunted trees.
const MIN_H = 4;
const candidates: number[][] = [];
for (let j = 2; j < th - 2; j++) for (let i = 2; i < tw - 2; i++) {
  const h = cs[j * tw + i];
  if (h < MIN_H) continue;
  const rad = Math.min(4, Math.max(1, Math.round(1 + 0.1 * h)));
  let isMax = true;
  for (let dj = -rad; dj <= rad && isMax; dj++) for (let di = -rad; di <= rad; di++) {
    if (!di && !dj || di * di + dj * dj > rad * rad) continue;
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= tw || jj >= th) continue;
    const v = cs[jj * tw + ii];
    // Strict maximum, ties broken by index so a plateau yields one tree.
    if (v > h || (v === h && jj * tw + ii < j * tw + i)) { isMax = false; break; }
  }
  if (!isMax) continue;
  const m = mask[j * tw + i];
  if (m === 1) { dropped.building++; continue; }
  if (m === 2) { dropped.water++; continue; }
  if (m === 3) { dropped.road++; continue; }
  if (m === 4) { dropped.construction++; continue; }
  // Crown radius: mean distance along 8 rays to where canopy falls below 45% of the peak.
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    let d = 0.5;
    for (; d < 9; d += 0.5) {
      const ii = Math.round(i + ca * d), jj = Math.round(j + sa * d);
      if (ii < 0 || jj < 0 || ii >= tw || jj >= th || cs[jj * tw + ii] < Math.max(1.5, 0.45 * h)) break;
    }
    sum += d;
  }
  const x = x0 + i + 0.5, y = y0 + j + 0.5;
  candidates.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(h * 10) / 10, Math.round(Math.max(1, Math.min(9, sum / 8)) * 10) / 10]);
}
// Non-maximum suppression by crown: a lower peak inside a taller tree's crown is the same tree.
candidates.sort((a, b) => b[2] - a[2]);
const cell = new Map<string, number[][]>();
const ck = (x: number, y: number) => `${Math.floor(x / 10)},${Math.floor(y / 10)}`;
for (const c of candidates) {
  let ok = true;
  for (let gx = -1; gx <= 1 && ok; gx++) for (let gy = -1; gy <= 1 && ok; gy++)
    for (const t of cell.get(`${Math.floor(c[0] / 10) + gx},${Math.floor(c[1] / 10) + gy}`) ?? [])
      if (Math.hypot(t[0] - c[0], t[1] - c[1]) < 0.6 * Math.max(t[3], c[3])) { ok = false; break; }
  if (!ok) continue;
  trees.push(c);
  const k = ck(c[0], c[1]);
  if (!cell.has(k)) cell.set(k, []);
  cell.get(k)!.push(c);
}
// Mapped OSM trees take precedence; a canopy tree within 3 m of one is the same tree.
const osmTrees: Pt[] = campus.trees;
const merged: number[][] = [];
for (const t of osmTrees) {
  let best: number[] | undefined, bd = 3;
  for (const c of trees) { const d = Math.hypot(c[0] - t[0], c[1] - t[1]); if (d < bd) { bd = d; best = c; } }
  merged.push([t[0], t[1], best ? best[2] : 8, best ? best[3] : 3, 1]);
  if (best) best[4] = -1;
}
for (const c of trees) if (c[4] !== -1) merged.push([c[0], c[1], c[2], c[3], 0]);
await writeFile('public/data/trees.json', JSON.stringify({
  source: 'Meta & World Resources Institute Global Canopy Height Map v1 (1 m, CC BY 4.0), local maxima; plus OpenStreetMap natural=tree',
  attribution: 'Canopy height © Meta and WRI, CC BY 4.0',
  fields: ['x', 'y', 'heightM', 'crownRadiusM', 'fromOsm'],
  dropped,
  trees: merged,
}));
console.log(`trees: ${candidates.length} canopy peaks, ${trees.length} detected in canopy model, ${osmTrees.length} mapped in OSM, ${merged.length} after merge; dropped`, dropped);

// Debug previews.
await mkdir('data/preview', { recursive: true });
writePng('data/preview/hillshade.png', nx, ny, (i, jj) => {
  const j = ny - 1 - jj;
  const z = (ii: number, jjj: number) => grid[Math.max(0, Math.min(ny - 1, jjj)) * nx + Math.max(0, Math.min(nx - 1, ii))];
  const dx = (z(i + 1, j) - z(i - 1, j)) / (2 * STEP), dy = (z(i, j + 1) - z(i, j - 1)) / (2 * STEP);
  const shade = Math.max(0, Math.min(1, 0.6 + (-dx * 0.7 + dy * 0.7) * 3));
  const t = (grid[j * nx + i] - gmin) / (gmax - gmin);
  return [shade * (120 + 120 * t), shade * (150 + 60 * (1 - t)), shade * 120].map(Math.round) as [number, number, number];
});
const step = 2;
writePng('data/preview/canopy.png', Math.floor(tw / step), Math.floor(th / step), (i, jj) => {
  const j = th - 1 - jj * step, ii = i * step;
  const v = cs[j * tw + ii], m = mask[j * tw + ii];
  if (m === 1) return [200, 80, 80];
  if (m === 3) return [90, 90, 90];
  if (m === 2) return [60, 110, 200];
  const g = Math.min(255, v * 12);
  return [255 - g, 255, 255 - g];
});
void terrainH;
