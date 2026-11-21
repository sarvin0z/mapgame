// Photo textures (public/textures/*.webp, generated for this project and made
// seamless): brick, sidewalk concrete, asphalt, lawn, bark and a leaf cluster.
// They are loaded once before the world is built; the procedural canvas
// textures remain the fallback when a file is missing.
import * as THREE from 'three';

export type PhotoName = 'brick_tan' | 'brick_red' | 'pavers' | 'asphalt' | 'lawn' | 'bark' | 'leaves';
const NAMES: PhotoName[] = ['brick_tan', 'brick_red', 'pavers', 'asphalt', 'lawn', 'bark', 'leaves'];

export const photos = new Map<PhotoName, HTMLImageElement>();

export async function loadPhotos(base = 'textures/') {
  await Promise.all(NAMES.map(n => new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => { photos.set(n, img); resolve(); };
    img.onerror = () => { console.warn('photo texture missing', n); resolve(); };
    img.src = base + n + '.webp';
  })));
}

/** A repeating sRGB texture of a loaded photo with `repeat` tiles per UV unit, or null if it did not load. */
export function photoTexture(name: PhotoName, repeatU = 1, repeatV = repeatU): THREE.Texture | null {
  const img = photos.get(name);
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatU, repeatV);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Fills a facade canvas (one bay by one storey) with a brick photo. One photo
 * tile is 8 courses, about 0.55 m of modular brick; the tile count is rounded
 * so the bay repeats seamlessly. Returns false if the photo is not loaded.
 */
export function drawBrick(g: CanvasRenderingContext2D, w: number, h: number, name: PhotoName, bay: number, storey: number, filter = 'none') {
  const img = photos.get(name);
  if (!img) return false;
  const nx = Math.max(1, Math.round(bay / 0.55)), ny = Math.max(1, Math.round(storey / 0.55));
  g.save();
  g.filter = filter;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) g.drawImage(img, i * w / nx, j * h / ny, w / nx + 0.5, h / ny + 0.5);
  g.restore();
  return true;
}
