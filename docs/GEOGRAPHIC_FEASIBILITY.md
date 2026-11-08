# Phase 1: Geographic feasibility

Status as of 2026-10-31.

## 1. Campus boundary

- Source: OSM relation 7316239, "University of Texas at Dallas" (`amenity=university`).
- The extent in local meters runs from x −797 to 795 and from y −830 to 1234. That is roughly 1.6 km east–west and 2.1 km north–south.
- Bounding roads: Synergy Park Blvd (north), W Campbell Rd (south), Waterview Pkwy (west) and N Floyd Rd (east). These match tiles 1–2 of the official campus map.
- The download box (`scripts/fetch-osm.mjs`) is 32.9745–32.9975° N by 96.7600–96.7415° W, which adds a margin of neighbouring streets.

## 2. Data sources and licensing

| Source | License | Used for | Status |
|---|---|---|---|
| OpenStreetMap via Overpass | ODbL 1.0 (attribution and share-alike for derived databases) | Buildings, roads, paths, areas, trees, lamps, benches, barriers, boundary | In use. Snapshot 2026-07-24 |
| Official UTD campus map tiles (supplied by the user) | UTD copyright | Visual cross-check of names and relative layout only. Nothing is traced | Used in tests as layout assertions |
| Google Photorealistic 3D Tiles | Google Maps Platform Terms | Viewing and comparison only, in `viewer.html` | Needs an API key (not yet supplied) |
| USGS 3DEP elevation (3DEPElevation ImageServer, bare earth) | Public domain | Terrain heights on a 2 m grid | In use. Relief across the area is 31.6 m (192–224 m above sea level) |
| Meta & WRI Global Canopy Height Map v1 (1 m) | CC BY 4.0 (attribution shown in game) | Tree positions, heights and crown sizes (local maxima) | In use. Based on 2018–2020 imagery |
| UEMR cart photo, The Retrograde, 2026-08-21 | Newspaper photo | Visual reference for the cart model only | Nothing is traced or embedded |
| Google Earth screenshots supplied by the user | Google | Qualitative reference for building styles, roof colours and landscaping | Nothing is traced; no geometry or imagery is used in the game |

`campus.json` is a derived database under the ODbL. If it is distributed, it must be offered under the ODbL with attribution.

## 3. Google Photorealistic 3D Tiles

- Access: Map Tiles API root `https://tile.googleapis.com/v1/3dtiles/root.json?key=…`. This needs a Google Cloud project with billing and the Map Tiles API enabled.
- `viewer.html` loads the tiles in CesiumJS when a key is supplied (paste it in the panel, use `?key=`, or set `VITE_GOOGLE_MAPS_API_KEY`). Google's attribution is shown on screen.
- Compliance: the tiles are only displayed. The project never stores, caches beyond the browser, traces or extracts their geometry, and they do not feed the game's world. The game world is built only from OSM.
- **Not verified:** coverage and quality over Richardson, TX were not inspected because no key was available. The Dallas–Fort Worth metro is generally inside Google's photorealistic coverage. Pedestrian-height and cart-height quality still need to be judged in the viewer's "Plinth (1.7 m eye)" and "Cart height (1.6 m)" presets once a key is supplied.
- The camera heights in those presets assume the ground is about 170 m above the WGS84 ellipsoid. Check this against a DEM.

## 4. Browser 3D geographic viewer

`viewer.html` (CesiumJS 1.121 from a pinned CDN build) shows OSM raster imagery by default, with the OSM building footprints (cyan) and the campus boundary (orange) overlaid. It also marks the simulation's origin.

Checked in the browser: the footprints line up with the OSM basemap. This only confirms that the projection round-trips correctly; both layers come from the same source, so it says nothing independent about accuracy.

## 5. Comparison with independent references

Automated checks (`tests/geo.test.ts`):

- The projection's planar distance differs from the WGS84 Vincenty distance by less than 0.05% over a 2.4 km campus diagonal.
- The core buildings (McDermott Library, Student Union, Activity Center, ECSS, JSOM, Callier Center) exist and lie inside the campus boundary.
- The relative layout matches the official map tiles: North Lab is north of the library, the Activity Center is south of the Student Union, and the library is east of the Student Union.

A visual comparison against the official map (inspected in the game's overview) also matches: the University Pkwy roundabout, the library mall with its reflecting pools and tree rows, the Residence Hall/University Village quads, and the soccer and athletic fields south of Loop Road SW.

## 6. Coverage gaps and inaccuracies

The full machine-readable list is in `data/verification/uncertain-features.json`.

| Gap | Size | Impact |
|---|---|---|
| Building heights estimated by type (no `height` or `building:levels` tag) | 1147 of 1377 buildings (9 named campus buildings, including the Athenaeum and the Student Union / Student Success Center) | Skyline proportions. Most named academic buildings do have mapped levels |
| Unnamed campus buildings | 89 of type university, service, parking, etc. | Labels and navigation |
| Road widths estimated by class | 3071 of 3523 ways | Road edges may be off by ±1–2 m |
| Trees | 208 mapped in OSM; 2,527 more detected in the canopy height model | Canopy imagery is 2018–2020; narrow trees (the library mall's columnar rows) blur into round crowns at 1 m |
| Terrain | 3DEP bare earth, 2 m, lightly smoothed | Short level changes (entrance stairs) are softened |
| Roof shapes | Only 9 roof tags in OSM | Hip roofs are generated for housing and residence halls; flat roofs elsewhere |
| Curbs | Derived from road widths, cut at mapped crossings, lowered kerbs (562 nodes) and side streets | Road widths are mostly estimated, so curb lines can be off by 1–2 m |
| Signs, parking stall lines | Stop/yield nodes mapped (168); stall lines generated along mapped aisles | Signs themselves are not drawn yet |
| Speed bumps | 106 mapped (89 bumps, 7 tables, 5 humps, 5 mini-bumps) | Unmapped bumps are missing; none have been invented |
| Street lamp arm orientation | Not mapped | A deterministic pseudo-random heading is used |
| Construction changes | The official map shows Student Union / Student Success Center construction closures and closed lots E and G | Not reflected; the OSM snapshot may predate them |
| Building façades and materials | Not mapped | Procedural brick or stucco palette |
