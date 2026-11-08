// Phase 1 feasibility viewer: Google Photorealistic 3D Tiles (when a key is
// supplied) with the project's OSM-derived footprints overlaid for alignment
// checks. Cesium is loaded from a pinned CDN build as a global.
import { loadCampus } from '../world/campusData.ts';
import { unproject, ORIGIN } from '../geo/projection.ts';

declare const Cesium: any;

const VIEWS: Record<string, { lon: number; lat: number; h: number; heading: number; pitch: number }> = {
  overview: { lon: -96.7503, lat: 32.977, h: 900, heading: 0, pitch: -40 },
  plinth: { lon: -96.74835, lat: 32.98705, h: 1.7, heading: 90, pitch: 0 },
  cart: { lon: -96.7493, lat: 32.98665, h: 1.6, heading: 90, pitch: -2 },
  library: { lon: -96.7475, lat: 32.9868, h: 30, heading: 270, pitch: -15 },
};

const keyInput = document.getElementById('key') as HTMLInputElement;
const modeEl = document.getElementById('mode')!;
const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
keyInput.value = new URLSearchParams(location.search).get('key') ?? envKey ?? '';

// Without a Cesium ion token, use OSM raster tiles as the base imagery.
Cesium.Ion.defaultAccessToken = undefined;
const viewer = new Cesium.Viewer('cesium', {
  baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })),
  baseLayerPicker: false, geocoder: false, timeline: false, animation: false, sceneModePicker: false, homeButton: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
});
viewer.scene.globe.depthTestAgainstTerrain = false;
(window as any).__viewer = viewer;

function fly(name: string) {
  const v = VIEWS[name];
  // Heights are approximate: ground near the Plinth is ~190 m above the ellipsoid... verify against DEM.
  const groundEllipsoidH = tilesLoaded ? 170 : 0;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(v.lon, v.lat, v.h + groundEllipsoidH),
    orientation: { heading: Cesium.Math.toRadians(v.heading), pitch: Cesium.Math.toRadians(v.pitch), roll: 0 },
    duration: 1.5,
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => fly(b.dataset.view!));

let tilesLoaded = false;
document.getElementById('load')!.onclick = async () => {
  const key = keyInput.value.trim();
  if (!key) { modeEl.innerHTML = '<span class="warn">No key: showing OSM imagery only.</span>'; return; }
  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`, { showCreditsOnScreen: true });
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false;
    tilesLoaded = true;
    modeEl.textContent = 'Google Photorealistic 3D Tiles loaded.';
    fly('overview');
  } catch (e) {
    modeEl.innerHTML = `<span class="warn">Failed to load tiles: ${(e as Error).message}</span>`;
  }
};

// OSM overlays, clamped to ground so they drape over 3D tiles.
const data = await loadCampus();
const ll = (p: [number, number]) => { const g = unproject(p[0], p[1]); return [g.lon, g.lat]; };
const footprints = new Cesium.CustomDataSource('footprints');
for (const b of data.buildings) {
  footprints.entities.add({
    polyline: { positions: Cesium.Cartesian3.fromDegreesArray([...b.outer, b.outer[0]].flatMap(ll)), width: 2, material: Cesium.Color.CYAN, clampToGround: true },
  });
}
const boundary = new Cesium.CustomDataSource('boundary');
for (const ring of data.boundary) {
  boundary.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray([...ring, ring[0]].flatMap(ll)), width: 3, material: Cesium.Color.ORANGE, clampToGround: true } });
}
boundary.entities.add({ position: Cesium.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat), point: { pixelSize: 8, color: Cesium.Color.RED, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND }, label: { text: 'sim origin', font: '12px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -16), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
await viewer.dataSources.add(footprints);
await viewer.dataSources.add(boundary);
(document.getElementById('footprints') as HTMLInputElement).onchange = e => footprints.show = (e.target as HTMLInputElement).checked;
(document.getElementById('boundary') as HTMLInputElement).onchange = e => boundary.show = (e.target as HTMLInputElement).checked;
modeEl.textContent = keyInput.value ? 'Key present: press Load.' : 'OSM imagery (no Google key supplied).';
fly('overview');
