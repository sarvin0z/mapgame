# Roadmap

Legend: ✅ done and verified in the browser · 🟡 partial · ⬜ not started

## Milestone 1: First browser prototype ✅ (2026-10-31)

- ✅ Vite + TypeScript + Three.js + Rapier scaffold that builds to a static site
- ✅ OSM download and processing pipeline in local WGS84 tangent-plane meters
- ✅ Initial campus, emergency golf cart, cameras, HUD, chunk streaming, performance monitor
- ✅ Cesium feasibility viewer with OSM overlays

## Milestone 2: Geographic fidelity 🟡

- ✅ Terrain from USGS 3DEP (public domain): 2 m grid, Rapier heightfield, everything seated on the ground
- ✅ Fresh OSM snapshot (2026-10-31) with stairs, traffic calming, bollards, kerbs, crossings, stop signs, waterways, traffic islands
- ✅ Curbs along curbed streets, opened at side streets, crosswalks and lowered kerbs
- ✅ Mapped speed bumps, humps, tables and mini-bumps (106) as physical, striped shapes
- ✅ Road centerlines smoothed into arcs between junctions
- ✅ Stairs, bollards, fences, walls, hedges and pond edges block the cart
- ✅ Spawn at University Village Phase 1, Building 11
- ⬜ Get a Google Map Tiles API key and inspect coverage at pedestrian and cart height
- ⬜ Verify estimated building heights (see `data/verification/`)
- ⬜ Survey or verify the widths of the main campus drives
- ⬜ Reflect current construction closures beyond what OSM shows

## Milestone 3: Visual realism 🟡

- ✅ UEMR cart rebuilt in Blender from the Retrograde photo (`blender/build_cart.py`), with livery texture
- ✅ Facade styles per building type (tan precast, white-and-glass modern, residence halls, UV apartments, houses, parking structures, metal buildings, construction)
- ✅ Hip roofs for housing, parapets and rooftop units for flat roofs
- ✅ Trees from the Meta/WRI canopy height model with measured height and crown size, three crown shapes, leaf cards
- ✅ Markings: centerlines, lane lines, crosswalks, stop lines, parking stalls
- ✅ Lighting rebalanced so sun shadows read clearly
- ⬜ Signature buildings modelled in Blender (Student Union, ECSS, JSOM, McDermott Library, the Plinth)
- ⬜ Parking-structure decks and ramps the cart can drive
- ⬜ Time-of-day lighting and night lamp lights
- ⬜ Parked cars, signs, pedestrians

## Milestone 4: Performance

- 🟡 Chunk streaming with four detail levels (terrain 2 m / 4 m, trees as cards / blobs)
- ⬜ Web Worker mesh building
- ⬜ Hierarchical LOD for far buildings, occlusion culling
- ⬜ Split the 5 MB bundle (Rapier WASM is inlined)

## Milestone 5: Gameplay (kept separate from rendering and physics in `src/gameplay/`)

- ⬜ Road and footpath graph with A* routing
- ⬜ Dispatch calls at real building entrances (375 OSM `entrance` nodes are already downloaded)
- ⬜ Route guidance, scenarios, response-time tracking
