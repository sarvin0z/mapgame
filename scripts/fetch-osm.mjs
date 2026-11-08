// Downloads OpenStreetMap features (ODbL) for the UT Dallas campus area via Overpass.
// Output: data/raw/utd-osm.json (raw Overpass JSON, kept out of the client bundle).
import { writeFile, mkdir } from 'node:fs/promises';

// south, west, north, east — covers Synergy Park Blvd (N) to W Campbell Rd (S),
// Waterview Pkwy (W) to N Floyd Rd (E), with a small margin.
export const BBOX = [32.9745, -96.7600, 32.9975, -96.7415];

const query = `
[out:json][timeout:120];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
  way["highway"](${BBOX});
  way["amenity"="parking"](${BBOX});
  way["leisure"](${BBOX});
  way["natural"="water"](${BBOX});
  way["landuse"](${BBOX});
  way["amenity"="university"](${BBOX});
  relation["amenity"="university"](${BBOX});
  node["natural"="tree"](${BBOX});
  node["highway"="street_lamp"](${BBOX});
  node["amenity"="bench"](${BBOX});
  way["natural"="tree_row"](${BBOX});
  way["barrier"](${BBOX});
  node["barrier"](${BBOX});
  node["traffic_calming"](${BBOX});
  way["traffic_calming"](${BBOX});
  node["highway"~"crossing|stop|give_way|traffic_signals"](${BBOX});
  node["kerb"](${BBOX});
  node["entrance"](${BBOX});
  way["natural"~"wood|scrub|grassland"](${BBOX});
  way["area:highway"](${BBOX});
  way["man_made"](${BBOX});
  node["man_made"](${BBOX});
  way["amenity"](${BBOX});
  node["amenity"~"bicycle_parking|waste_basket|fountain"](${BBOX});
  way["waterway"](${BBOX});
  node["highway"="bus_stop"](${BBOX});
);
out body;
>;
out skel qt;
`;

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

for (const url of endpoints) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'utd-ems-sim/0.1 (educational prototype)' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    await mkdir('data/raw', { recursive: true });
    await writeFile('data/raw/utd-osm.json', JSON.stringify(json));
    console.log(`Saved ${json.elements.length} elements from ${url} (OSM timestamp ${json.osm3s?.timestamp_osm_base})`);
    process.exit(0);
  } catch (e) {
    console.warn(`Failed ${url}: ${e.message}`);
  }
}
process.exit(1);
