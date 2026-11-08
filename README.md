# UTD EMS Cart Simulator

A browser-based 3D recreation of the University of Texas at Dallas campus, built from OpenStreetMap data, USGS 3DEP elevation and a 1 m canopy height model, in which you drive the University Emergency Medical Response (UEMR) golf cart. You start at University Village Phase 1, Building 11.

Stack: TypeScript, Three.js (rendering), Rapier 3D (physics), Vite (build), CesiumJS (geographic evaluation viewer).

**Play in the browser:** https://sarvin0z.github.io/mapgame/ (rebuilt from `main` by `.github/workflows/pages.yml` on every push).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. Press **F1** in the game to see the controls.

| Page | Purpose |
|---|---|
| `index.html` | The driving prototype |
| `viewer.html` | Phase 1 geographic viewer: OSM or Google Photorealistic 3D Tiles, with the project's footprints overlaid |

URL options for the game: `?quality=low|medium|high` (turns adaptive quality off), `?spawn=<building name>` (for example `?spawn=Eugene%20McDermott%20Library`; the default is `11`, University Village Building 11).

## Build and deploy

```bash
npm run build
```

`dist/` is a static site with relative paths, so it can be served from any static host or sub-path.

## Tests

```bash
npm test
```

The tests cover the projection's accuracy against WGS84 geodesics, the OSM tag rules, campus landmark placement, geometry winding, chunking, steering geometry and the powertrain model. Vehicle behaviour in Rapier (acceleration, braking, turning, wall impacts) was checked in the browser; see `docs/ISSUES.md`.

## Map data pipeline

```bash
npm run fetch-osm        # Overpass API -> data/raw/utd-osm.json (git-ignored)
npm run fetch-rasters    # USGS 3DEP DEM + Meta/WRI canopy heights -> data/raw/ (git-ignored)
npm run process-osm      # -> public/data/campus.json (+ curbs) and data/verification/uncertain-features.json
npm run process-rasters  # -> public/data/terrain.bin/.json and trees.json; previews in data/preview/
npm run build-cart       # Blender 5.2, headless -> public/models/uemr_cart.glb
```

Map data © OpenStreetMap contributors (ODbL). Elevation: USGS 3DEP (public domain). Canopy heights © Meta and World Resources Institute (CC BY 4.0). The in-game attribution must stay visible.

During `npm run dev`, the page can POST a PNG to `/__capture?name=x` and it is saved to `data/preview/x.png`. Automated visual checks use this when the browser window is not on screen.

## Layout

```
src/geo/        projection (WGS84 local tangent plane) and OSM tag rules
src/world/      campus data, terrain, chunking, mesh builders, curbs, smoothing, streaming
src/physics/    Rapier world and streamed colliders
src/vehicle/    cart config, powertrain, Rapier vehicle, procedural model
src/camera/     chase / driver / free cameras
src/graphics/   environment, quality presets, adaptive quality
src/ui/         HUD, minimap, performance monitor
src/viewer/     Cesium feasibility viewer
blender/        build_cart.py: the UEMR cart, generated headless in Blender
docs/           roadmap, issue tracker, geographic feasibility report
```

Coordinates: x is east, z is −north and y is up, all in meters from the origin at 32.9858° N, 96.7503° W.

## Vehicle parameters

All of the cart's parameters are in `src/vehicle/config.ts` (`DEFAULT_CART`). They are estimates for the lifted 2+2 UEMR cart with two crew and gear: 720 kg, center of mass 0.74 m (top-heavy, static stability about 0.69 g), 0–15 mph in about 3 s, 19 mph governed. Replace them with measured values when available.
