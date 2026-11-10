# Graphics audit and overhaul (pass 1)

The renderer is Three.js (WebGL 2) with ACES filmic tone mapping, sRGB output, PCF sun
shadows (2048² map over 140 m, snapped to shadow texels), sky image-based lighting from a
PMREM of the Sky shader, and an HDR post chain (MSAA ×4 half-float, UnrealBloom, output,
colour grade). Measurements were taken on an AMD Radeon 840M (integrated) through ANGLE
on D3D11, with the harness helpers `__h.profile()` and `__h.frame(w, h)`.

## Root causes found

| Problem | Cause | Fix |
|---|---|---|
| 4.6 M triangles per frame, 67 ms | Parked cars: a 2,084-triangle model per car, about 1,250 drawn and shadow-cast, because detail switched per 200 m chunk | Per 80 m cell LOD: full model within ~60 m, a 24-triangle body and cabin stand-in beyond |
| Full tree crowns far away | Same chunk-level switch: 760-triangle crowns up to ~340 m out | Per-cell crowns: full within 95 m (High), 70 m (Medium), 45 m (Low); light crowns beyond |
| ~9 ms a frame of matrix updates | About 10k static objects recomputed every frame | Chunk content's world matrices are frozen once built |
| 111 draw calls for the cart | GLB arrives as many meshes | Static parts merged per material (48 meshes) |
| ~25 ms for bloom | UnrealBloom ran by day at strength 0.05–0.14 | Bloom only at night on High; the colour grade stays on Medium and High |
| 115k-triangle terrain skirt; 4 m far terrain | Over-resolved meshes under fog | 150 m skirt cells; 8 m far terrain |
| Milky, washed-out golden hour | Warm-white fog from 45 % of view distance, turbid sky, day bloom | Clear air (turbidity 2.2, less Mie haze), fog tinted to the horizon from 55 % to 190 % of view distance, lower and warmer sun, less flat ambient fill |
| Flat ground | Colour maps only on asphalt, pavers and turf | Normal maps derived from the photo textures; lawn tint less saturated |
| Lawn running up to every wall | No foundation planting | Mulched shrub beds with a brick edge along building walls, clear of walks, roads, lots and doors |
| Painted-on windows | Procedural facades are flat textures | Parallax recessed windows: glass 18 cm behind the wall face with a shaded reveal, faded out by 120 m |
| Blue halo around the cart by day | LED glow sprites at night strength | Halo at 28 % by day, full at night |

## Counts at the same gameplay views (chase camera)

| View | Before | After |
|---|---|---|
| Andromeda Hall drive | 561 draws, 4.63 M triangles | 345 draws, 0.96 M triangles |
| UV11 spawn | 800 draws | 638 draws, 1.30 M triangles |
| University Village (UV58) | — | 635 draws, 1.29 M triangles |

Millisecond timings varied widely between runs because the browser pane was hidden (the page
was throttled as a background tab), so the counts above are the reliable comparison. In one
consistent run the scene render at the Andromeda view went from 66.7 ms to 31.5 ms after the
car and tree LOD.

## Not done yet

- Procedural building geometry: real window frames, trim and entrances on the non-reconstructed buildings
- Cart model detail: the dashboard, suspension and undercarriage are unchanged
- Screen-space ambient occlusion: not added, since the iGPU budget was already exceeded
- Street-tree density: unchanged, because trees come from OSM and the canopy height model, and none were invented
- A frame-time check at 1080p with the browser window in the foreground

# Pass 2

- **Cart:** body panels are now clear-coated gloss paint (MeshPhysicalMaterial). The tyres, machined rims, frame and vinyl were tuned so they read as different materials at chase distance.
- **Road markings:** the paint is worn in world space, scuffed toward the asphalt grey and rougher where scuffed.
- **Procedural flat-roof buildings:** a darker stone base course at the ground and a projecting cornice under the parapet.
- **Parallax windows:** offsets are now worked out in each texture's own UV space and sampled with `textureGrad`, so recesses stay sharp and line up with the window mask.
- **Golden hour:** a clearer sky and a tighter sun glow. Driving straight into the low sun is still bright, which is realistic but can wash out the frame.
- **Not a bug:** windows that look buried in walls at Sciences and Physics only happen when the camera is inside the footprint, under the arcade overhang, and sees the upper walls from behind.
- **Ambient occlusion:** screen-space AO (GTAO) was not added. On the 840M, frames are already at 40–60 ms, and the baked contact shading under walls, trees and cars covers the main cases.

# Pass 3 (2026-11-09): performance, memory, camera, phones

Measured on the Radeon 840M at the UV11 spawn, chase camera, 1024x768 window.

## What the audit found

| Finding | Evidence |
|---|---|
| The game held 1.29 GB of geometry in JavaScript | Every chunk in view was built in full; 1.08 GB of it was close-up detail (`near` 708 MB, `detail` 290 MB, `mid` 80 MB) for chunks too far away to show it |
| Auto quality stripped the game to Low for nothing | The browser pane presents at 30 Hz; the controller chased 60 fps, so it dropped to Low although a Low frame was 9 ms of CPU and 4 ms of GPU work |
| The post chain cost 3.5 ms a frame by day | GPU timer queries on High: 15.3 ms with the chain, 11.8 ms without, for a grade that needs no HDR target |
| Distant chunks are CPU-bound, close ones GPU-bound | Chunks beyond 400 m: 566 draw calls for 1.1 ms of GPU time. The 9 `near` groups: 38 calls, 424k triangles, 3.9 ms |
| The cart alone was 99 draw calls | 48 meshes, each drawn again into the shadow map |
| `__h.frame()` and `__h.profile()` overstate cost | Their blocking `readPixels` has a ~15 ms floor on an empty scene. Use GPU timer queries (the perf panel's GPU row) |
| Every quality change rebuilt every shader | `applyQuality` set `needsUpdate` on all materials |

## What changed

- **Memory and load time:** chunks beyond the detail range are built in a light far form (`buildChunkSteps(..., full = false)`) and rebuilt in full 120 m before their detail is needed (`WorldStreamer.fullLead`, `fullRelease`). Chunk meshes drop their JavaScript vertex arrays once uploaded (`releaseAfterUpload`). Geometry held in JavaScript on High: 1.29 GB to about 250-410 MB. Heap: 1.66 GB to 0.73 GB. Dev-server load: about 21 s to 12 s.
- **No post chain by day:** the colour grade is compiled into the material shaders (`installInlineGrade` in `grade.ts`). The HDR chain is created lazily and only runs for bloom at night on High.
- **Adaptive quality** (`quality.ts`): the target is the display's own rate, capped at 60. Where GPU timer queries exist it compares measured CPU and GPU time with the frame budget, lowers resolution when the GPU is the limit and the preset when the CPU is. Resolution moves in steps from 60 % to 100 %. A failed step up doubles the wait before the next.
- **Starting preset from the device** (`detectPreset`): phones and software renderers start on Low, integrated graphics on Medium, discrete cards and Apple silicon on High. Each preset has a pixel budget (`maxPixelsM`), so a 4K monitor or a 3x phone does not multiply the cost. MSAA is off on touch screens of 2x density and up.
- **Draw calls:** the cart casts one merged shadow silhouette (99 to about 55 calls); far ground paint stops at `groundDistance`; shadows switch at the light, so no shaders are rebuilt.
- **Chase camera (removed 2026-11-10 at the user's request: it put the cart off-centre and the changing field of view felt wrong; `cameraRig.ts` is back to the committed version):** rode on the drawn cart position with a smoothed height (bumps move the cart, not the horizon), field of view 60 to 67 degrees with speed, looks further ahead at speed, eases in and out with braking and acceleration, and returns smoothly after an obstacle instead of snapping.
- **Physics-to-render interpolation:** the cart is drawn blended between 120 Hz physics steps (`GolfCart.snapshot`, `syncVisual(alpha)`), which removes the fine judder when the two clocks drift.
- **Ground:** lawn, asphalt and pavers ease onto blurred mip levels and lose their normal map past 5-45 m, where the grain only shimmered; turf contrast is eased everywhere. Asphalt albedo raised from about 0.05 to 0.08-0.09 (it read as black).
- **Sky:** a soft shoulder on the sky shader, so the glow round the low golden-hour sun keeps its colour instead of tone-mapping to a white void.
- **Phones:** a landscape layout for viewports under 500 px tall (thumb pads in the bottom corners, dash between them, minimap under the unit badge); pinch and double-tap zoom off.

## Counts at the UV11 spawn (4:3)

| Preset | Before | After |
|---|---|---|
| Low | 470 draws, 865k triangles | 441 draws, 797k triangles |
| Medium | 888 draws, 1.56 M triangles, post chain | 809 draws, 1.41 M triangles, no post chain |
| High | 975 draws, 1.65 M triangles, post chain | 919 draws, 1.51 M triangles, no post chain by day |

## Not measured or not done

- Frame times after the changes: the app window was not in view during the later measurements, so the page was throttled. The 3.5 ms post-chain saving was measured in the foreground before the change; the rest is counts and memory.
- No phone, tablet or discrete-GPU machine was tested. The device guess, the pixel budgets and the landscape layout are checked by unit tests and by measuring element positions at 812x375, not on hardware.
- Distant terrain, far ground paint and tree blobs are still one to four draw calls a chunk (see the follow-up below for what was merged).
- Compressed textures (KTX2) and Meshopt or Draco for the building models; the 5.2 MB main bundle is not code-split.

## Pass 3 follow-up (2026-11-10): driving report, flicker, merged chunks

- **"Driving no longer works":** on a fresh load the real loop drives normally (0 to 22.3 mph in 4 s with W held, steering and braking respond). Two ways it could stop were found and closed. The dev helper `__h.sim()` replaced the cart's key mapping and never put it back, so any tab it had run in (the preview tab, after the scripted checks) ignored the driving keys until reloaded; it now restores it. And Free roam left the camera in whatever mode it was in, where the free camera takes the driving keys; it now returns to the chase camera.
- **Flicker on cars and walls:** it was z-fighting between faces at the same depth, flipping with any camera movement however small. On cars, the glass house against the painted belt, pillars and roof, and lamps, plates and trim set flush into the body: glass is drawn back 8 mm and applied parts pushed out 6 mm at load (`cars.ts`). On procedural buildings, the foundation shared a plane with the bottom 32 cm of every wall; it is set 2 cm inside (`buildings.ts`). The chase camera's smoothed values also now come fully to rest. Pixels flipping between consecutive frames of a parked view at the spawn: about 1,700 before, 0 after. Under a forced 10 micron camera step: 805 before, 74 after.
- **Still flickers:** thin dotted lines along window mullions when a wall is seen almost edge-on from under a metre away (the parallax window shader), found beside the School of Management.
- **Merged distant chunks:** each chunk's always-drawn meshes (walls, roofs, trim, water) are merged per material across 3 x 3 chunk tiles (`WorldStreamer` tiles, `mergeBase`). Building models, instanced props, terrain and tree blobs are not merged.

| Preset (UV11 spawn, 4:3) | Before the merge | After |
|---|---|---|
| Low | 441 draws, 797k triangles | 404 draws, 956k triangles |
| Medium | 809 draws, 1.41 M triangles | 682 draws, 1.63 M triangles |
| High | 919 draws, 1.51 M triangles | 748 draws, 1.74 M triangles |

Triangles rise because a 600 m tile is culled as a whole. Earlier foreground measurements put the GPU cost of these meshes at about 0.2 ms, against roughly 12 microseconds of CPU per draw call saved; neither was re-timed after the merge.

- **Testing in a background tab:** `__h.pump(secs)` runs the real game loop on a made-up clock, for when the browser is not running animation frames.

## Audio, feedback and lighting accuracy (2026-11-10)

Worked through the `audio-design`, `game-feel` and `create-game-assets` skills.

### Audio (`src/audio/mix.ts`)

Before: a siren and a horn, wired straight to the output. No cart, tyre or impact sound, no volume control.

- **Buses:** `vehicle`, `ambience`, `sfx` and `emergency` into a master gain and a limiter. Levels are in decibels. The Settings volume slider is squared before it becomes gain and is remembered between visits.
- **Ducking:** `vehicle` and `ambience` dip 7 dB while the siren or horn sounds, through a separate gain node, so it never overwrites the volume setting.
- **Cart:** a motor and gear whine from about 55 Hz at a crawl to 430 Hz at top speed that swells under throttle, tyre noise and wind that rise with speed, all silent at a standstill.
- **Effects:** impact, suspension thud, countdown beeps, arrival chime. Each play varies by about a semitone and 2 dB.
- **Not done:** no loudness measurement (the skill's -24 LUFS target) and no listening test. Everything is synthesized; nothing was checked against a recording of the real cart.

### Feedback

- **Collision:** impact sound, a red vignette flash and a decaying camera shake scaled to the speed lost. It now fires on every drive; the penalty still applies only during a run.
- **Pedestrian contact:** a softer version of the same.
- **Kerbs, speed bumps and landings:** a thud and a small shake when vertical speed changes suddenly.
- **Shake:** at most 10 cm and under one degree, squared so small knocks barely show, gone in about half a second, applied to the drawn view after the camera rig and never to the cart. "Camera shake on impacts" in Settings turns it off.
- **No hit-stop:** freezing time does not suit a driving simulator.

### Campus accuracy

Compared against the reference photos with `__h.compare` and `__h.orbit` (references are for comparison only).

| Building | Finding | Action |
|---|---|---|
| Cecil H. Green Hall | At golden hour the model matches the photo (tan precast, deep dark windows, recessed ground floor). At midday it rendered pure white with grey glass and no shadows | Lighting fix below |
| Sciences Building | Same white-out at midday. The one reference is a close-up, so massing cannot be checked from it (already listed as unknown in the recipe) | Lighting fix; model unchanged |
| Founders Building | Fins, glazing and floating roof present | None |
| Student Union, Plinth | Read correctly | None |

- **Midday lighting:** the high-sun sky is about ten times brighter in the lighting probe than the golden-hour one, so at the same weight the probe alone lit every wall to white (a tan wall measured 197,207,207 with the sun switched off). Its midday weight is now 0.045 (was 0.24), exposure 0.76, and the probe's sun disc is dimmed like the visible one. Every building at midday was affected.
- **Night on High:** the bloom chain's grade pass failed to compile after the inline grade was added (a duplicate function). Fixed in `grade.ts`.
- **No building model was rebuilt.** The recipes compared matched their photos once the lighting was right.

## Roads, bases, bridges, sound and JSOM (2026-11-10, second request)

- **Cart sound:** quieter and more electric. The vehicle bus is down 7 dB, the motor is almost all sine and triangle (the sawtooth is what read as an engine), and tyre and wind noise now carry most of the sound.
- **Road ends (`roadShape.ts`):** 105 places where a wide section met a narrower continuation ended in a faceted bulb with stray curb stubs (Drive H north of UV11 is the one in the user's screenshot). The narrower ways now flare out to the wide section's width over 8 to 26 m. Curbs are left out across the flare, because they were laid out for the old outline.
- **Lane markings:** the centre line used to be drawn in the middle of the pavement even where one direction has more lanes, so arrows and stop bars sat off their lanes. It now divides the directions by lane count (`laneSplit`), and arrows and stop bars follow it.
- **Not changed on roads:** raised medians are still drawn as plain concrete strips, which can read as a sidewalk in the road (Tatum Street). Whether each is grass or concrete on the ground is not in the map data.
- **Stop signs:** obeyed if the cart slows to 10 mph or less on the approach (was about 3 mph). Messages and the Controls note are updated.
- **Pedestrians:** 80 during a response (was 30).
- **Skybridges:** the dark band on the ground under a bridge was the contact-shading skirt drawn round every building footprint. Raised structures no longer get one. The bridge's real sun shadow is unchanged.
- **Building bases:** reconstructed models are open at the ground (arcades, recessed floors, glazed lobbies), so lawn showed under and inside them. Each now has paving over its footprint.
- **JSOM:** new recipe and model (limestone bands, green ribbon glass, parapet roof) from four photos in the user's PDF. The curved rotunda comes from the mapped outline; nothing was placed by hand. The photos are from an image search, not the official set, and are recorded as such in `observations.json`.
- **Not done from the PDF:**
  - Sciences Building: photos 1 and 2 agree with the existing reference (limestone, wood soffit, a glass corner on columns), but which corner they show is unknown, so no cantilever was added. Photos 3 and 4 show a grey ribbed-masonry tower that does not match the other photos and may be a different building.
  - ECS West: already reconstructed; not re-checked against the new photos.
  - Residence halls: no building in the map data is named as a University Commons hall, so there was nothing to attach a recipe to.
  - Taco Bell in PS3: not added. Its position inside the garage is not mapped.
  - Plinth and reflecting pools: not changed.
