// Downloads the two raster layers the world is built from:
//  - USGS 3DEP bare-earth DEM (public domain) via the 3DEPElevation ImageServer.
//  - Meta / World Resources Institute Global Canopy Height Map, 1 m (CC BY 4.0),
//    read as a window of the cloud-optimized GeoTIFF on the public S3 bucket.
// Output (git-ignored): data/raw/dem.f32 + dem.json, data/raw/chm.f32 + chm.json.
import { writeFile, mkdir } from 'node:fs/promises';
import { fromArrayBuffer, fromUrl } from 'geotiff';

const [S, W, N, E] = [32.9745, -96.7600, 32.9975, -96.7415];
await mkdir('data/raw', { recursive: true });

async function fetchDem() {
  // About 1.35 m per pixel; 3DEP here is 1 m lidar-derived, resampled bilinearly.
  const width = 1280, height = 1700;
  const url = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
    + `?bbox=${W},${S},${E},${N}&bboxSR=4326&imageSR=4326&size=${width},${height}`
    + '&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DEM ${res.status}`);
  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const img = await tiff.getImage();
  const [data] = (await img.readRasters()) as unknown as Float32Array[];
  let min = Infinity, max = -Infinity;
  for (const v of data) if (v > -1000) { min = Math.min(min, v); max = Math.max(max, v); }
  await writeFile('data/raw/dem.f32', Buffer.from(new Float32Array(data).buffer));
  await writeFile('data/raw/dem.json', JSON.stringify({ width: img.getWidth(), height: img.getHeight(), bbox: [W, S, E, N], crs: 'EPSG:4326', min, max, source: 'USGS 3DEP 3DEPElevation ImageServer', fetched: new Date().toISOString() }));
  console.log(`DEM ${img.getWidth()}x${img.getHeight()} elevation ${min.toFixed(1)}–${max.toFixed(1)} m`);
}

const R = 6378137;
const merc = (lat: number, lon: number) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];

async function fetchChm() {
  const url = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/023112330.tif';
  const tiff = await fromUrl(url);
  const img = await tiff.getImage();
  const [x0, y0, x1, y1] = img.getBoundingBox();
  const w = img.getWidth(), h = img.getHeight();
  const [mw, ms] = merc(S, W), [me, mn] = merc(N, E);
  const px = (x: number) => Math.floor((x - x0) / (x1 - x0) * w);
  const py = (y: number) => Math.floor((y1 - y) / (y1 - y0) * h);
  const win = [px(mw), py(mn), px(me) + 1, py(ms) + 1];
  const [data] = (await img.readRasters({ window: win })) as unknown as Uint8Array[] | Float32Array[];
  const out = Float32Array.from(data as ArrayLike<number>);
  const bx = (i: number) => x0 + i / w * (x1 - x0), by = (j: number) => y1 - j / h * (y1 - y0);
  await writeFile('data/raw/chm.f32', Buffer.from(out.buffer));
  await writeFile('data/raw/chm.json', JSON.stringify({ width: win[2] - win[0], height: win[3] - win[1], bbox3857: [bx(win[0]), by(win[3]), bx(win[2]), by(win[1])], crs: 'EPSG:3857', source: url, license: 'CC BY 4.0, Meta and World Resources Institute (Tolan et al. 2024)', fetched: new Date().toISOString() }));
  console.log(`CHM window ${win[2] - win[0]}x${win[3] - win[1]} px (${((x1 - x0) / w).toFixed(2)} m/px)`);
}

await fetchDem();
await fetchChm();
