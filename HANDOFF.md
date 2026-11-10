# UTD EMS Cart Simulator: handoff

Updated 2026-11-09.

This is a browser recreation of the UT Dallas campus. You drive the UEMR (University Emergency Medical Response) golf cart around it. It is built with TypeScript, Three.js, Rapier, Vite, Blender 5.2 and OpenStreetMap data.

- **State:** the game is committed and live on GitHub Pages. Three passes since then are **uncommitted** (§2): graphics passes 1 and 2, and pass 3 (performance, memory, camera, phones; 2026-11-09).
- **Checks:** typecheck, all 66 tests and the production build pass on the current working tree.

Read this first, then `README.md` (running, data pipeline, folder layout), `docs/ISSUES.md` (numbered change log #1–#220 and the **Open** list) and `docs/GRAPHICS.md` (graphics audit and both passes).

---

## 1. Where things are

| What | Where |
|---|---|
| Working copy | `C:\Users\Ibrahim\Desktop\UTDMapSim` (local branch `main`, tracks `origin/main`) |
| Repository | `https://github.com/sarvin0z/mapgame`. Private, owned by sarvin0z; `ibrahimqureshifs` is a collaborator with push rights but **no admin** (cannot open Settings) |
| Live game | https://sarvin0z.github.io/mapgame/. GitHub Pages, source "GitHub Actions" |
| Deploy | `.github/workflows/pages.yml`: on every push to `main` it runs `npm ci`, `npm test` and `npm run build`, then deploys `dist/`. A failing test stops the deploy |
| Commits | `71f2e80` Initial commit (sarvin0z's `.gitattributes`) and `6f0262a` "Add UTD EMS Cart Simulator and GitHub Pages deploy" |

Pushing works from this machine with the Windows Git credential manager's saved login (`git push`); there is no `gh` CLI. The live site's page is public even though the repo is private.

Kept out of the shared repo through `.git/info/exclude` (local only): `.plans/`, `reports/` and `research_notes/`, which are personal derm-outreach notes. `.gitignore` excludes `node_modules/`, `dist/`, `data/raw/`, `data/preview/`, `data/refs/` and `artifacts/qa/*.png`. `.gitattributes` marks `*.bin *.glb *.wasm *.webp *.png *.jpg` as binary.

## 2. Uncommitted work (passes 1, 2 and 3)

`git status` shows these changes, all made after the last commit and **not yet approved for commit**:

```
M src/debug/harness.ts        chase(), frame() helpers
M src/graphics/environment.ts lighting/sky/fog retune, coarser skirt
M src/graphics/quality.ts     treeFullDistance, post flag per preset
M src/main.ts                 bloom only at night, harness post sizing, LED glow level
M src/vehicle/cartModel.ts    merge static meshes per material; clear-coat paint
M src/vehicle/golfCart.ts     glowLevel (LED halo dimmer by day)
M src/world/buildings.ts      base course + cornice on flat-roof procedural buildings
M src/world/campusBuilder.ts  per-cell tree LOD, landscape beds, ground normals,
                              parallax windows, worn markings, 8 m far terrain
M src/world/extras.ts         per-cell parked-car LOD with low-poly stand-in
M src/world/photos.ts         photoNormal() (normal maps from photo textures)
M src/world/worldStreamer.ts  per-cell LOD switching, frozen chunk matrices
?? src/world/landscape.ts     shrub beds along building walls
?? docs/GRAPHICS.md           audit + pass notes
```

Pass 3 (2026-11-09, details in `docs/GRAPHICS.md` "Pass 3") also touched `index.html`, `src/style.css`, `src/camera/cameraRig.ts`, `src/graphics/grade.ts`, `src/world/geometry.ts` and added `tests/quality.test.ts`. In short:

- Distant chunks are built in a light far form and rebuilt in full on approach; chunk meshes drop their JS arrays after upload (1.29 GB to about 250-410 MB of geometry).
- The colour grade is compiled into the material shaders; the post chain only exists for night bloom on High.
- Adaptive quality targets the display's own rate and uses GPU timer queries; the starting preset is guessed from the device.
- Physics-to-render interpolation (the chase camera rework was removed again at the user's request), calmer ground textures, lighter asphalt, a sky that no longer whites out toward the sun, and a landscape-phone HUD layout.

The user said "not yet" to committing (2026-11-08). When they approve, commit everything above and push. Pages will redeploy automatically.

### What the passes changed (details in `docs/GRAPHICS.md`)

- **Performance (Andromeda view):** 561 draw calls and 4.63 M triangles became 345 draw calls and 0.96 M triangles.
  - **Cars and trees:** they now switch detail per 80 m cell (`userData.cell` and `userData.lod` on meshes in the chunk's `trees` group, switched in `worldStreamer.update`). Parked cars beyond about 60 m become a 24-triangle stand-in (`carProxy` in extras.ts).
  - **Static chunk content:** `matrixAutoUpdate` is off, so the per-frame matrix update dropped from about 9 ms to 1.2 ms.
  - **Cart:** about 111 meshes merged to 48 (`mergeByMaterial`). The steering wheel and LED heads stay separate.
  - **Bloom:** runs only at night on High. The colour grade still runs on Medium and High (`PRESETS.post`).
- **Lighting:**
  - Clearer sky (lower turbidity and Mie) with a tighter sun glow (`mieDirectionalG` 0.86).
  - Fog from 55% to 190% of the view distance.
  - Lower, warmer golden-hour sun, and less hemisphere fill.
  - The LED glow sprite is at 28% by day (`cart.glowLevel`).
- **Materials and detail:**
  - Normal maps derived from the asphalt, paver and lawn photos, with a less saturated lawn.
  - Shrub beds with mulch and a brick edge along building walls (`landscape.ts`).
  - Parallax recessed windows on procedural facades (`litWindows` shader, ORM green below 0.3 counts as glass).
  - Worn road markings (`worn()`).
  - Base course and cornice on procedural buildings.
  - Clear-coat cart body (MeshPhysicalMaterial) with tuned tyre, rim, frame and vinyl.
- **Not done:**
  - Screen-space AO, skipped for cost on the integrated GPU.
  - Real geometry for the procedural buildings.
  - Cart dashboard and suspension detail.
  - A trustworthy 1080p frame-time measurement with the browser pane visible.

## 3. Quick start

```bash
npm install
npm run dev            # http://localhost:5173 (launch config: .claude/launch.json "dev")
npm test               # vitest, 57 tests
npx tsc --noEmit
npm run build          # -> dist/ (relative base './', works under /mapgame/)
```

- **Requirements:** Node 22+ (CI uses 24; this machine has 24.20) and Blender 5.2 for the asset generators.
- **URL options:** `?quality=low|medium|high`, `?time=golden|day|night`, `?spawn=<building name>`.
- **Controls:** F1 in the game lists them.
  - W/A/S/D drive. C cycles chase, driver and free camera (removing the free camera was part of the undone Game Edits).
  - L, K, H and B toggle the lights, headlights, siren and horn.
  - I toggles the location card. Esc opens Dispatch.

## 4. The user's hard constraints

- **Unmapped geography:** do not invent building positions or pathways where geographic information is missing. Log uncertain geography in `docs/ISSUES.md` (Open) and `data/verification/`.
- **Reference photos:** `data/refs/` is for comparison only. Never ship or trace them; they are git-ignored.
- **Site knowledge:** the user's on-site corrections override OSM. Record each as a named override with a comment.
- **Commits:** commit and push only on explicit approval. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Undo means undo:** when the user asks to undo, revert completely. The 2026-11-07 "Game Edits" pass was undone this way (§7).

## 5. Architecture

- **Coordinates:** map `Pt = [east, north]` in metres from 32.9858° N, 96.7503° W. World x is east, y is up and **z is −north**, so map `[x, y]` becomes world `(x, h, −y)`. Mixing these up is the most common bug.

| Area | Files | Notes |
|---|---|---|
| Data | `public/data/campus.json`, `terrain.bin/json`, `trees.json` | From `scripts/process-osm.ts` and `process-rasters.ts` (raw inputs in `data/raw/`, not committed) |
| Road shape | `src/world/roadShape.ts` | Flared road ends where widths change, and the centre-line position from lane counts |
| Corrections | `src/world/campusData.ts` | `BUILDING_OVERRIDES`, `REMOVED_BUMPS`, `openMedians`, `hugRoundabout` |
| Streaming | `chunks.ts`, `worldStreamer.ts` | 200 m chunks; groups `base`, `coarse`, `farOnly`, `detail`, `near`, `mid` and **`trees`** (per-cell LOD meshes) |
| Chunk builder | `campusBuilder.ts` | Ground layers, markings, curbs, trees, props, `CampusMaterials` |
| Landscaping | `landscape.ts` | Foundation shrub beds (new, uncommitted) |
| Buildings | `buildings.ts` (procedural), `buildingModels.ts` and `public/models/buildings/*.glb` | About 41 Blender models from `reconstruction/specs.json`; `solids.json` holds the models' out-of-footprint colliders |
| Site features | `extras.ts`, `landmarks.ts` | Lots, parked cars, doors, the Plinth; signs, Student Union, Comets LANding steps |
| Textures | `textures.ts`, `pbrTextures.ts`, `photos.ts` | Photo WebPs in `public/textures/`; `pbrFor()` maps model material names to PBR sets |
| Physics | `physicsWorld.ts` | Terrain heightfield plus per-chunk colliders; canopies over footprints become drivable arcades; `modelSolids` hook |
| Vehicle | `src/vehicle/*` | Raycast vehicle; `cartModel.ts` (GLB, per-LED materials, merged meshes) |
| Audio | `src/audio/mix.ts`, `siren.ts` | Buses, cart sound, effects; siren and horn play on the emergency bus |
| Graphics | `src/graphics/*` | `environment.ts`, `grade.ts`, `reflections.ts`, `quality.ts` |
| Gameplay | `src/gameplay/*` | `routeChallenge.ts`, `navGraph.ts`, `pedestrians.ts` |
| UI | `src/ui/hud.ts`, `menus.ts`, `index.html`, `src/style.css` | Dispatch menu, HUD, result screen |

## 6. Building reconstruction pipeline

- **Source of truth:** recipes live in `reconstruction/observations.json`. Run `npx tsx scripts/reconstruction-plan.ts` to regenerate `reconstruction/specs.json` and `docs/RECONSTRUCTION_PLAN.md`.
- **Build:** run the command below. Passing a slug rebuilds one building; `index.json` and `solids.json` are rebuilt from the whole folder.
  ```bash
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python blender/build_buildings.py -- reconstruction/specs.json public/models/buildings [slug]
  ```
- **Recipe features:** see #191–220 in ISSUES.md. They include `stoneFrame`, `reveal`, `entryBlock`, `rotunda` (pavilion/silver), `entryLobby`, `entryPavilion`, `facade: louvered` with `screenOut`, `frontClear` (keeps entrances off roads and neighbouring buildings), `storefrontBay` and `rollDoors`.
- **Material names drive textures:** building-model material names select the in-game PBR textures through `pbrFor`. Renaming a material changes its texture.
- **Other generators:** `blender/build_cars.py` → `public/models/cars.glb`, `blender/build_cart.py` → `public/models/uemr_cart.glb`, `blender/to_webp.py`.

## 7. History of recent sessions

| Date | Work | State |
|---|---|---|
| ≤ 2026-11-07 | QA report, UI redesign (dispatch, HUD, result), building reconstructions #164–220 (ECSW, SSB, Andromeda, Vega, Helix, Sirius, Capella, CH6/CH7, Police, ROC and others) | Committed in `6f0262a` |
| 2026-11-07 | Committed and pushed to sarvin0z/mapgame; Pages set up (sarvin0z switched the source to GitHub Actions); live game verified | Done |
| 2026-11-07 | "Game Edits" PDF (25 pages, about 45 items) implemented and QA'd, then **undone at the user's request** | Fully reverted; nothing remains |
| 2026-11-08 | Graphics overhaul against a reference board (AAA look within a browser budget): passes 1 and 2 | **Uncommitted** (§2) |

### The undone "Game Edits" list (if the user asks again)

Source: `C:\Users\Ibrahim\Downloads\Game Edits (1).pdf`. The requests were:
- **Driving and routes:** remove the free cam; fix the Safety and Grounds spawn direction; more realistic routes; a "Random call" button; parking-lot speed bumps.
- **Passages and paths:** a passage under Andromeda Hall to Rec Center West and Dining Hall West; drive-through and higher Sciences arcade.
- **Stop signs:** at UV lot exits and a missing four-way.
- **Brown walls and HUD:** the brown "fence" walls near Helix and Vega, and the wrong "Helix" HUD label.
- **Terrain:** the North Lab dip; the AD courtyard hill; grass on the McDermott and Berkner ground floors.
- **Lighting:** building and skybridge shadows.
- **New structures:** a Taco Bell in PS3; a Callier courtyard playground; a loading dock; a BSB door; brown 1×1 m steps on the Plinth.
- **Building fixes:**
  - Callier stair side.
  - Police entrance side and overlapping windows.
  - ATEC roof size and hover.
  - JSOM orange.
- **Roads:**
  - Consistent road widths.
  - Stop-line placement.
  - A road joint that should be a curb.
  - Rutford 1 m stripes.
- **Other:**
  - Cars on islands.
  - UV numbers that flicker or are misplaced.
  - Car headlights flickering.
  - The construction fence on the SU sidewalk.
  - The Helix lake.
  - An invisible wall (the pond-edge barrier).
  - SU corridor pavers.

Before the undo, the implementation used two files that are now deleted: `src/world/userEdits.ts` (data corrections) and `src/world/additions.ts` (new structures). It also used Blender recipe keys `passage`, `entryFace: back`, `stairEnd: far`, `groundH` and `arcade`. If the user asks for these again, re-implement them; nothing is left in the tree. Note that several of them (ATEC roof, JSOM colour, the shadows) overlap with what the graphics passes touched.

## 8. Verification workflow

The dev server accepts `POST /__capture?name=x` and writes `data/preview/x.png`. In dev builds, `window.__h` provides:

- **Captures:**
  - `capture(name, pos, look)` and `captureCart(name, eye, at)`.
  - `view(...)` was removed with the undo; use `capture`.
  - `orbit(buildingName, azimuth, dist, up, shot)` for an oblique view of a building.
  - `chase(name, mapPt, roadClasses?, flip?)` puts the cart on the nearest way and captures the gameplay chase view.
  - `compare(building, refFile)` renders next to a reference photo.
- **Checks:**
  - `flicker(name, eye, look)` checks for z-fighting.
  - `place(pt, dir)` and `sim(secs, ctl)` run deterministic driving tests.
  - `pump(secs)` runs the real game loop on a made-up clock, which works while the pane is hidden.
- **Performance:**
  - `profile()` reports chase-camera milliseconds, draw calls and triangles.
  - `frame(w, h)` gives full-frame GPU-synced timing at a given size, with the post chain.
  - Both have a ~15 ms floor from their blocking pixel read, so use them for comparisons only. The perf panel (P) shows true GPU time from timer queries, and `__sim.gpuTimer.ms` exposes it.

`window.__sim` exposes `cart`, `scene`, `data`, `terrain`, `renderer`, `physics`, `streamer`, `adaptive`, `gpuTimer`, `quality` and `post` (the bloom chain, null until first used).

**Timing is unreliable while the browser pane is hidden** (the tab is throttled, and `requestAnimationFrame` may not fire at all), so compare draw calls and triangles instead. Even in view, the pane presents this page at 30 Hz. The test GPU is an AMD Radeon 840M (integrated), and page load takes about 30 s on the dev server.

## 9. Known gotchas

- **Bash heredocs:** on this Windows machine they break on quotes and backticks. Write patch scripts with the Write tool, then run `PYTHONUTF8=1 python -I file.py`.
- **Shader cache keys:** `onBeforeCompile` cache keys must be unique per material (`reflections.ts` captures the original key).
- **Frozen chunk matrices:** chunk content has `matrixAutoUpdate` off. Anything that moves inside a chunk needs `updateMatrixWorld` called by hand.
- **Merged tiles:** a chunk's plain `base` meshes are moved into a per-material mesh shared by its 3 x 3 tile (`tile x,y` groups under the streamer root). Look for walls and roofs there, not in `chunk x,y base`, which keeps only building models and instanced props.
- **Chase camera:** the user rejected a speed-sensitive field of view and any framing that moves the cart off-centre. Leave `cameraRig.ts` as committed unless asked.
- **Lighting probe weight:** `env` in `environment.ts` is per time of day because the sky's brightness differs by about ten times between them. Check a wall with the sun switched off before changing it.
- **Free camera:** in the free camera the driving keys fly the camera and the cart does not move. `__h.capture`, `chase` and `orbit` leave the rig in that mode.
- **Far-form chunks:** a chunk beyond the detail range has empty `detail`, `near`, `mid` and `trees` groups until the streamer rebuilds it in full. Code that needs full detail somewhere the cart is not (a scripted view, a photo) calls `streamer.ensureFull(point, radius)` or `streamer.update(pos, Infinity)`.
- **Released vertex arrays:** chunk geometry from `toGeometry` has `attribute.array === null` after its first draw. Do not read or merge chunk meshes after they are built.
- **Colour grade:** it lives in `THREE.ShaderChunk` (`installInlineGrade`) and applies wherever the renderer tone-maps. A material with `toneMapped: false` is not graded.
- **Per-cell LOD:** meshes added to the chunk's `trees` group must carry `userData.cell` and `userData.lod` (`full` or `lite`, plus an optional `fullScale`), or they never show.
- **Cart reflections:** do not apply the reflection boost to the cart, because the windshield flashed white. The cart's static meshes are now merged, so look parts up by material, not by node name.
- **Shadow map:** it updates every frame; alternate-frame updates looked like flicker.
- **Terrain grading:** an early `gradeSites` attempt was reverted. The undone Game Edits pass had a narrower `cutAround` that worked, if grading is needed again.
- **Raw OSM:** `data/raw/utd-osm.json` is the one the processor reads. Re-running `process-osm.ts` regenerates `campus.json`.
- **Camera inside a footprint:** windows can look buried in walls (Sciences, Physics) when the camera is under an arcade overhang. That is the camera position, not a model bug.

## 10. Open items

- **Commit and push** the two graphics passes once the user approves.
- **Graphics:**
  - Real procedural building geometry (frames, trim, entrances).
  - Cart dashboard and suspension.
  - Optional ambient occlusion on capable GPUs.
  - A foreground 1080p frame-time measurement, and any test on a real phone or a discrete GPU.
  - Merge distant chunks per material (about 570 draw calls beyond 400 m on High).
  - Facing the low golden-hour sun is still very bright.
- **From ISSUES Open:**
  - #188 Physics Annex stoop collider.
  - #189 trees and cars.
  - #208 Satellite Utility Plant unmatched.
  - #209 Visitor Center locations unconfirmed.
- **From the user's PDF (`Downloads/Building Reconstruction Quality.pdf`, photos saved under `data/refs/7*_`):** JSOM is done; Sciences cantilever corner, residence halls and the PS3 Taco Bell are not (see `docs/GRAPHICS.md`).
- **Not reconstructed:** ROC-type buildings without photos stay procedural; Comet Student Center and Northside are not in the reconstruction plan.
- **Other:**
  - Collisions are detected from deceleration and miss slow scrapes.
  - Lit windows at night are random.
  - The user has not confirmed the siren and horn sounds, or the new cart, impact and chime sounds.
