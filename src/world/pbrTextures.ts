// Procedural PBR texture sets (albedo, normal, roughness) for building surfaces.
// Each set is drawn as a height field plus colour on canvases; the normal map is
// derived from the height with a Sobel filter. Albedo is near-neutral so the
// material colour (taken from the reference photos) still sets the hue.
// Texture scale: `size` metres per repeat; the Blender models use 1 UV unit = 1 m.
import * as THREE from 'three';
import { photos } from './photos.ts';

export interface PbrSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; size: number; normalScale: number; roughness: number }

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function tex(c: HTMLCanvasElement, srgb: boolean, size: number) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(1 / size, 1 / size);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Height (0..1, canvas red channel) to a tangent-space normal map. */
function normalFromHeight(h: HTMLCanvasElement, strength: number) {
  const w = h.width, H = h.height;
  const src = h.getContext('2d')!.getImageData(0, 0, w, H).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = H;
  const g = out.getContext('2d')!;
  const img = g.createImageData(w, H);
  const at = (x: number, y: number) => src[(((y + H) % H) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}

type Painter = (c: CanvasRenderingContext2D, h: CanvasRenderingContext2D, r: CanvasRenderingContext2D, px: number) => void;

function make(px: number, size: number, strength: number, roughness: number, paint: Painter): PbrSet {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = px; return c; };
  const cc = mk(), hc = mk(), rc = mk();
  const c = cc.getContext('2d')!, h = hc.getContext('2d')!, r = rc.getContext('2d')!;
  h.fillStyle = '#808080'; h.fillRect(0, 0, px, px);
  r.fillStyle = `rgb(0,${Math.round(roughness * 255)},0)`; r.fillRect(0, 0, px, px);
  paint(c, h, r, px);
  return { map: tex(cc, true, size), normalMap: tex(normalFromHeight(hc, strength), false, size), roughnessMap: tex(rc, false, size), size, normalScale: 1, roughness: 1 };
}

/** Fine per-pixel noise on all three canvases. */
function grain(c: CanvasRenderingContext2D, h: CanvasRenderingContext2D, px: number, base: number, amp: number, n: number, sz = 1) {
  c.fillStyle = `rgb(${base},${base},${base})`; c.fillRect(0, 0, px, px);
  for (let i = 0; i < n; i++) {
    const x = rnd() * px, y = rnd() * px, d = (rnd() - 0.5) * amp;
    const v = Math.max(0, Math.min(255, base + d));
    c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, sz, sz);
    const hv = 128 + d * 0.8;
    h.fillStyle = `rgb(${hv},${hv},${hv})`; h.fillRect(x, y, sz, sz);
  }
}

/** Soft dark streaks running down from the top (rain staining on concrete and stone). */
function streaks(c: CanvasRenderingContext2D, px: number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * px, w = 2 + rnd() * 10, len = px * (0.1 + rnd() * 0.5), y0 = rnd() * px;
    const gr = c.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(60,55,50,${alpha})`); gr.addColorStop(1, 'rgba(60,55,50,0)');
    c.fillStyle = gr; c.fillRect(x, y0, w, len);
  }
}

function joints(c: CanvasRenderingContext2D, h: CanvasRenderingContext2D, px: number, xs: number[], ys: number[], wpx: number, shade = 'rgba(40,36,30,0.55)') {
  c.fillStyle = shade; h.fillStyle = '#202020';
  for (const x of xs) { c.fillRect(x - wpx / 2, 0, wpx, px); h.fillRect(x - wpx / 2, 0, wpx, px); }
  for (const y of ys) { c.fillRect(0, y - wpx / 2, px, wpx); h.fillRect(0, y - wpx / 2, px, wpx); }
}

const cache = new Map<string, PbrSet>();
function get(kind: string, f: () => PbrSet) { if (!cache.has(kind)) { seed = kind.length * 7919 + 13; cache.set(kind, f()); } return cache.get(kind)!; }

export const pbr = {
  /** Precast concrete: 3 m x 1.5 m panels, exposed aggregate, staining. Repeat 6 m. */
  precast: () => get('precast', () => make(1024, 6, 3, 0.9, (c, h, _r, px) => {
    grain(c, h, px, 225, 34, 160000, 1);
    streaks(c, px, 50, 0.08);
    const p = px / 6;
    joints(c, h, px, [0, p * 3], [0, p * 1.5, p * 3, p * 4.5], 3);
    for (let i = 0; i < 24; i++) { const x = (Math.floor(rnd() * 2) * 3 + 0.4 + rnd() * 2.2) * p, y = (Math.floor(rnd() * 4) * 1.5 + 0.3 + rnd() * 0.9) * p; c.fillStyle = 'rgba(50,45,40,0.35)'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
  })),
  /** Limestone ashlar: 0.6 x 0.3 m blocks, varied tone. Repeat 2.4 m. */
  limestone: () => get('limestone', () => make(1024, 2.4, 4, 0.85, (c, h, _r, px) => {
    grain(c, h, px, 228, 22, 120000, 1);
    const bw = px / 4, bh = px / 8;
    for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = (rnd() - 0.5) * 26;
      c.fillStyle = `rgba(${v > 0 ? '255,250,235' : '120,105,85'},${Math.abs(v) / 120})`; c.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
    c.fillStyle = 'rgba(90,80,65,0.45)'; h.fillStyle = '#303030';
    for (let row = 0; row <= 8; row++) { c.fillRect(0, row * bh - 1.5, px, 3); h.fillRect(0, row * bh - 1.5, px, 3); }
    for (let row = 0; row < 8; row++) for (let col = 0; col <= 4; col++) { const x = col * bw + (row % 2 ? bw / 2 : 0); c.fillRect(x - 1.5, row * bh, 3, bh); h.fillRect(x - 1.5, row * bh, 3, bh); }
  })),
  /**
   * Brick, running bond. From the brick photo where loaded (8 courses, repeat
   * 0.55 m): albedo made near-neutral so the model's material colour sets the
   * hue, height from inverted luminance so the lighter mortar sits recessed.
   * Otherwise procedural, 0.2 x 0.065 m with 10 mm mortar, repeat 1.6 m.
   */
  brick: () => get('brick', () => photos.has('brick_tan') ? make(1024, 0.55, 3, 0.9, (c, h, _r, px) => {
    const img = photos.get('brick_tan')!;
    c.filter = 'grayscale(0.85) brightness(1.45) contrast(0.95)'; c.drawImage(img, 0, 0, px, px); c.filter = 'none';
    h.filter = 'grayscale(1) invert(1) contrast(1.8)'; h.drawImage(img, 0, 0, px, px); h.filter = 'none';
  }) : make(1024, 1.6, 5, 0.9, (c, h, _r, px) => {
    c.fillStyle = '#d6d0c6'; c.fillRect(0, 0, px, px);
    h.fillStyle = '#404040'; h.fillRect(0, 0, px, px);
    const bw = px / 8, bh = px / 21.3, m = 3;
    for (let row = 0; row < 22; row++) for (let col = -1; col < 9; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = 150 + rnd() * 90;
      c.fillStyle = `rgb(${v},${v * (0.92 + rnd() * 0.08)},${v * (0.88 + rnd() * 0.1)})`; c.fillRect(x + m, y + m, bw - 2 * m, bh - 2 * m);
      h.fillStyle = `rgb(${150 + rnd() * 30},0,0)`; h.fillRect(x + m, y + m, bw - 2 * m, bh - 2 * m);
      for (let k = 0; k < 18; k++) { c.fillStyle = `rgba(0,0,0,${rnd() * 0.15})`; c.fillRect(x + m + rnd() * (bw - 2 * m), y + m + rnd() * (bh - 2 * m), 2, 2); }
    }
  })),
  /** Stucco: sand-float finish with control joints every 3 m. Repeat 6 m. */
  stucco: () => get('stucco', () => make(1024, 6, 2.5, 0.92, (c, h, _r, px) => {
    grain(c, h, px, 232, 20, 220000, 1);
    streaks(c, px, 30, 0.05);
    joints(c, h, px, [0, px / 2], [0, px / 2], 2, 'rgba(60,55,45,0.35)');
  })),
  /** Smooth painted metal panels, 1.5 m modules with reveal joints. Repeat 3 m. */
  panel: () => get('panel', () => make(512, 3, 2, 0.45, (c, h, r, px) => {
    grain(c, h, px, 238, 8, 20000, 1);
    joints(c, h, px, [0, px / 2], [0, px / 2], 3, 'rgba(40,40,40,0.45)');
    r.fillStyle = 'rgb(0,90,0)'; r.fillRect(0, 0, px, px);
  })),
  /** Ribbed metal siding, 0.2 m ribs. Repeat 2 m. */
  ribbed: () => get('ribbed', () => make(512, 2, 4, 0.5, (c, h, _r, px) => {
    grain(c, h, px, 220, 10, 10000, 1);
    for (let x = 0; x < px; x += px / 10) {
      const g = c.createLinearGradient(x, 0, x + px / 10, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.5, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0.18)');
      c.fillStyle = g; c.fillRect(x, 0, px / 10, px);
      const hg = h.createLinearGradient(x, 0, x + px / 10, 0);
      hg.addColorStop(0, '#606060'); hg.addColorStop(0.5, '#c0c0c0'); hg.addColorStop(1, '#606060');
      h.fillStyle = hg; h.fillRect(x, 0, px / 10, px);
    }
  })),
  /** Glazed ceramic tile (NSERL): 0.3 m tiles with iridescent variation. Repeat 2.4 m. */
  tile: () => get('tile', () => make(1024, 2.4, 3, 0.25, (c, h, _r, px) => {
    c.fillStyle = '#bbbbbb'; c.fillRect(0, 0, px, px);
    const t = px / 8;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const v = 190 + rnd() * 65, hue = rnd();
      c.fillStyle = `rgb(${v * (0.85 + hue * 0.2)},${v * 0.9},${v})`; c.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
    }
    joints(c, h, px, Array.from({ length: 9 }, (_, k) => k * t), Array.from({ length: 9 }, (_, k) => k * t), 3, 'rgba(60,60,70,0.5)');
  })),
  /** Single-ply roof membrane with welded seams every 3 m. Repeat 6 m. */
  membrane: () => get('membrane', () => make(512, 6, 1.5, 0.8, (c, h, _r, px) => {
    grain(c, h, px, 228, 14, 30000, 1);
    streaks(c, px, 20, 0.05);
    joints(c, h, px, [0, px / 2], [], 2, 'rgba(120,120,115,0.4)');
  })),
  /** Architectural asphalt shingles. Repeat 3 m. */
  shingle: () => get('shingle', () => make(512, 3, 4, 0.95, (c, h, _r, px) => {
    grain(c, h, px, 170, 70, 60000, 1);
    const row = px / 20;
    for (let y = 0; y < px; y += row) {
      c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, y, px, 2); h.fillStyle = '#303030'; h.fillRect(0, y, px, 3);
      for (let x = rnd() * 40; x < px; x += 20 + rnd() * 30) { c.fillRect(x, y, 2, row); h.fillRect(x, y, 2, row); }
    }
  })),
  /**
   * Window glass with what is seen through it: per-pane interior brightness,
   * ceiling light strips and partly lowered blinds. Repeat 6 m x 4 m (one
   * floor), panes 1.5 m. Rough channel low for sharp reflections.
   */
  glass: () => get('glass', () => make(512, 6, 0.3, 0.06, (c, _h, r, px) => {
    const pw = px / 4, fh = px;
    for (let i = 0; i < 4; i++) {
      const v = 150 + rnd() * 105;
      const g = c.createLinearGradient(0, 0, 0, fh);
      g.addColorStop(0, `rgb(${v * 0.9},${v * 0.92},${v})`); g.addColorStop(0.15, `rgb(${v * 1.05},${v * 1.05},${v})`); g.addColorStop(1, `rgb(${v * 0.7},${v * 0.72},${v * 0.75})`);
      c.fillStyle = g; c.fillRect(i * pw, 0, pw, fh);
      const blind = rnd() < 0.5 ? rnd() * 0.6 : 0;
      if (blind) { c.fillStyle = 'rgba(235,232,222,0.55)'; c.fillRect(i * pw, 0, pw, fh * blind); for (let y = 0; y < fh * blind; y += 4) { c.fillStyle = 'rgba(0,0,0,0.1)'; c.fillRect(i * pw, y, pw, 1); } }
      if (rnd() < 0.6) { c.fillStyle = 'rgba(255,255,245,0.6)'; c.fillRect(i * pw + pw * 0.2, fh * 0.06, pw * 0.6, 3); }
    }
    r.fillStyle = 'rgb(0,14,0)'; r.fillRect(0, 0, px, px);
  })),
};

/** PBR set for a building-model material name (from blender/build_buildings.py). */
export function pbrFor(name: string): PbrSet | null {
  if (/^Glass|Mosaic/.test(name)) return pbr.glass();
  if (/Brick/i.test(name)) return pbr.brick();
  if (/limestone|stoneGray/i.test(name)) return pbr.limestone();
  if (/Stucco/i.test(name)) return pbr.stucco();
  if (/violetTile/.test(name)) return pbr.tile();
  if (/darkMetal|Louver|Steel_Truss|Roof_Metal|silver|creamMetal|Metal_Corrugated/.test(name)) return pbr.ribbed();
  if (/Wall_white|Trim_White|charcoal|Metal_Cornice|Metal_Drum|Frame/.test(name)) return pbr.panel();
  if (/Roof_Membrane/.test(name)) return pbr.membrane();
  if (/Roof_Shingle/.test(name)) return pbr.shingle();
  if (/Wall_tan|Concrete|Wall_concrete/.test(name)) return pbr.precast();
  return null;
}

/** Applies the PBR set to a material, keeping its colour as the tint. */
export function applyPbr(m: THREE.MeshStandardMaterial) {
  const set = pbrFor(m.name);
  if (!set) return;
  m.map = set.map;
  m.normalMap = set.normalMap;
  m.roughnessMap = set.roughnessMap;
  if (/^Glass/.test(m.name)) {
    // Reflective glass: low roughness, view-dependent reflection from the sky probe.
    m.roughness = 1; m.metalness = 0.55; m.envMapIntensity = 2.6;
    m.normalScale.set(0.15, 0.15);
  } else {
    m.roughness = 1;
    m.normalScale.set(0.9, 0.9);
  }
  m.needsUpdate = true;
}
