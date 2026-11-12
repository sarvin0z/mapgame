# Issue tracker

Status: **open**, **fixed**, or **wontfix** (with the reason). Move this list to GitHub Issues once the repository has a remote.

## Fixed during milestone 1 browser inspection

| # | Issue | Found by | Fix |
|---|---|---|---|
| 1 | Ground surfaces invisible (white scene) | Screenshot | The sky dome was drawn after the depth-less ground layers. The sky now has `renderOrder = -100` |
| 2 | Cart pitched nose-down about 40° and lifted its rear wheels when hitting a wall | Isolated Rapier test in the page | Rapier's `setMassProperties` takes the center of mass in the collider frame, so it had ended up 1.3 m high. Corrected |
| 3 | Turning-radius formula wrong (4.55 m instead of the configured 4.1 m) | Unit test | Corrected the outer-wheel lateral offset in `maxSteerAngle` |
| 4 | Projection accuracy test failed against haversine | Unit test | The reference was wrong (spherical Earth). The test now uses WGS84 Vincenty |
| 5 | High-quality bloom washed out the whole frame | Screenshot | Bloom threshold raised to 8; only the emergency LEDs exceed it |
| 6 | Performance monitor showed 1 draw call when bloom was on | Screenshot | `renderer.info.autoReset = false`, reset once per frame |
| 7 | Building colours looked chalky | Screenshot | Palette converted from sRGB to linear; Neutral tone mapping |

## Fixed during milestone 2–3 (terrain, realism, UEMR cart)

| # | Issue | Found by | Fix |
|---|---|---|---|
| 9 | Terrain was flat | Roadmap | USGS 3DEP bare-earth DEM on a 2 m grid: draped meshes plus one Rapier heightfield (orientation unit-tested) |
| 10 | Vegetation far sparser than reality | Roadmap | 2,527 trees detected in the Meta/WRI 1 m canopy height model, merged with the 208 OSM trees |
| 11 | The cart could drive into ponds and pools | Roadmap | Invisible 0.8 m wall along every water edge |
| 12 | No curbs | Roadmap | 1,933 curb runs (15 cm) along curbed streets, cut at side streets, crosswalks, lowered kerbs and lot entrances |
| 19 | A flat plain outside the terrain sat above low ground and hid the whole campus | Screenshot | Replaced by a skirt that continues the terrain edge and is sunk under the streamed area |
| 20 | Shadows almost invisible | Captured frames and pixel probe (sun on vs off changed grass by only 19/255) | The sky probe used for image-based light includes the sun disc, so shadowed areas were lit as if sunlit. Environment intensity 0.4 → 0.12, sun 2.1 → 3.4. `PCFSoftShadowMap` (removed in three r18x) replaced by `PCFShadowMap` |
| 21 | Chase and free cameras clamped to y = 0.3–0.4 m, i.e. metres above the low parts of campus | Screenshot | Cameras now stay 0.3–0.4 m above the terrain under them |
| 22 | Cart livery upside down | Screenshot | glTF UVs have their origin top-left; the canvas texture is uploaded with `flipY = false` |
| 23 | Thin "lines in the sky" over buildings with courtyards | Captured frame and ray probe | Multipolygon inner rings were given to every outer ring of a relation; each is now assigned to the outer that contains it. Parapet copings are built per edge |
| 24 | Residence halls rendered as 7-storey flat-roof blocks | Captured frame | Hip roofs now use a simplified footprint, and with a mapped level count the walls stop at the top storey and the rest of the mapped height is roof |
| 25 | Curbs were cut on the far side of T-junctions | Unit test | A branching road only opens the curb on the side it actually reaches |
| 26 | `curbs.ts` contained a cp1252 byte (Python's Windows default encoding) | UTF-8 scan | Rewritten; all edit scripts now run with `PYTHONUTF8=1` |

## Fixed in the third round (user feedback with new cart photos and 95 reference images)

| # | Issue | Fix |
|---|---|---|
| 34 | Cart was about as wide as a car | Rebuilt at street-cart size from the user's front, rear and side photos: 1.20 m wide, 2.68 m long, 1.92 m tall, 1.65 m wheelbase, 14-inch multi-spoke alloys on street tires |
| 35 | Cart details didn't match | Soft black top with rolled curtains, roof heads (red/blue right, white left), red rear heads and post strips, bumper heads, amber under-floor LEDs, round headlights over amber turn lamps, AED case under the front bench, blue batteries in the open rear bay, quilted black seats with hip rails, rear-facing flip seat, "UNIVERSITY EMS  DIAL 911" windshield banner, rear-fender livery |
| 36 | Acceleration too slow, no coasting, slow steering, top speed too low | 0–15 mph 2.0 s, 0–20 mph 3.1 s, governed 22.3 mph; pedal-up regen coasts from 22 mph to 7 mph in 3 s and to a stop in 4.6 s; steering rate 1.4 → 3.2 rad/s, and keyboard steering is limited by sideways grip (0.42 g) rather than a fixed speed curve |
| 37 | Grass overlapped roads; buildings flickered into each other | Roads, lots and lawns are now cut along the terrain's own triangles so they lie exactly on the ground; adjoining footprints are inset 3–9 cm with slightly different roof heights |
| 38 | Stairs cut into the ground; invisible blocks | Stairs are only built where the elevation data shows a real level change (29 of 152); elsewhere the mapped flight is drawn as a walk. Treads sit on the ground and colliders cover exactly the drawn steps |
| 39 | Trees in roadways and walkways | Canopy-detected trees are dropped within every road and walk (435 removed) |
| 40 | Elevation dropped in small steps toward the Plinth | Paved areas use a ~4 m smoothed grade; fields and courts are levelled |
| 41 | Plinth roof solid; fountain missing | White louvered canopy with see-through concentric slats on posts, stepped round pool with a tall concrete mist column. A duplicate OSM outline that closed the canopy's opening is now skipped |
| 42 | Crosswalks painted onto grass | Bars are only painted where the walk crosses road pavement |
| 43 | Bollards blocked the cart | Posts are evenly spaced 1.9 m apart (1.5 m clear); 9 of 12 test approaches drove straight through. The failures were at clusters where the map has posts behind the gaps |
| 44 | Curbs didn't look like curbs | 15 cm concrete curb plus a 0.45 m gutter pan on the road side |
| 45 | Rutford Avenue and most campus drives looked like asphalt | Concrete streets (OSM `surface=concrete`, 730 ways) with lane-width panels and sawn joints; no centerline where the map says `lane_markings=no` |
| 46 | No parking stalls or cars | 2.75 × 5.5 m stalls along every parking aisle (inside mapped lots; elsewhere only where the space is clear, e.g. the widened Building 11 lot); about 60 % filled with sedans, SUVs and pickups (`blender/build_cars.py`) in realistic colours |
| 47 | Tennis courts, soccer and ball fields missing | Courts: blue/green acrylic, lines, nets, fences with windscreens. Soccer: mowing stripes, regulation markings scaled to the field, goals. Baseball/softball: dirt infield, bases, mound, fences. Basketball: lines and hoops. Sand volleyball, cricket strip |
| 48 | Buildings hard to tell apart | 18 new facade styles matched to the reference photos (Founders fins, NSERL blue tile, BSB curtain wall, ATEC louvers, SLC blue mosaic, SSB louvers, SSB Addition, Callier addition, Waterview brick, Facilities dark metal, Parking Structure 4 fins, Synergy Park bands, glass pavilions, UV stone veneer, Canyon Creek and Northside brick, tan residence halls) |
| 49 | No visible doors | 375 mapped entrances get glass double doors with canopies (main), single glass doors, steel exit doors or roll-up service doors, plus a door wherever a walk ends at a wall without one |
| 50 | Blinding sun near Field Street | The sky's sun disc was ~760× the sky brightness and triggered the bloom; reduced to a visible disc below the bloom threshold |
| 51 | Driver view too narrow, glass too visible | 82° field of view from the seat; clear windshield (7 % opacity) |
| 52 | Grass texture unrealistic | 1024 px blade-stroke turf texture with dry and lush patches |

## Fixed: frame rate (2026-10-31)

| # | Issue | Fix |
|---|---|---|
| 32 | High quality fell to ~32 FPS; CPU spent 16 ms submitting ~970 draw calls; chunk builds stalled single frames for 35–120 ms | Parked-car parts merged into one mesh per car type (15 → 3 draw calls per chunk); far tree blobs merged into one per chunk; the shadow map refreshes every other frame; lawn and park overlays that duplicated the terrain grass are no longer drawn; high view distance 1800 → 1400 m; chunks are built as resumable steps within 4 ms per frame instead of whole chunks at once |

Measured in the visible browser pane (Radeon 840M, 1250×854, pixel ratio 1.25), driving at full throttle:

| Run | Before | After |
|---|---|---|
| Render submit (CPU) | 16.2 ms, ~970 calls | 4.8–7.1 ms, 314–558 calls |
| Cecil Drive, high | ~32 FPS | 58.9 FPS, no frame over 50 ms |
| Rutford Avenue (campus core), high | — | 48 FPS (GPU-bound; some 33 ms frames) |
| Rutford Avenue, medium | — | 58.7 FPS, p95 16.9 ms |
| Cecil Drive, adaptive | — | 60.0 FPS, 1 frame over 50 ms in 20 s |

## Fixed in the buildings and roads round (2026-11-01)

| # | Issue | Fix |
|---|---|---|
| 57 | All concrete streets were striped; only Rutford Avenue's promenade should be | Streets are asphalt again; the Rutford Avenue pedestrian promenade (OSM `highway=pedestrian`, between the bollards) has banded light/warm-gray paving |
| 58 | Roads and walks met with notches and spikes | Round caps and joins on every road and walk; miters capped at 1.25× so sharp bends no longer spike |
| 59 | Lane lines ran through intersections; lamp in the Loop Road / Rutford intersection | Center and lane lines stop 2.5 m short of every junction; lamps within 7 m of a junction or on a carriageway are dropped |
| 60 | No stop signs or traffic lights; turn lanes unmarked | 168 mapped stop/yield points get signs on the right of the approach; 37 mapped signals (55 approaches) get mast-arm signals; 78 ways with left-turn lanes get painted arrows |
| 61 | Skybridges and covered walkways were extruded from the ground ("pillar near Rutford", empty boxes) | OSM `bridge=covered` parts are built as glass bridges at their mapped level; bus shelters as glass shelters; unnamed outbuildings without a height are one or two storeys instead of 8 m |
| 62 | Buildings clipped windows into the uphill ground (Founders North) | Each building sits level at its highest footprint corner (up to 1.2 m above the lowest) with exposed foundation downhill; doors sit at floor level with concrete stoops |
| 63 | Floors not visible; buildings blocky | Floor bands at every storey; per-building forms from reference photos: Founders fins and floating roof, ATEC's great sloped canopy, JSOM roof plane, sunshades and entrance canopy, McDermott Library's recessed glass ground floor on columns, Berkner's deep concrete ribs, ECS/SSB sunshades, Davidson-Gundy cantilevered roof, Student Union arcade, Rec Center and Callier entrance canopies |
| 64 | Parking structures unreadable | Open decks on columns with spandrel guard walls at every level, interior column lines, stair/elevator core, roof lights; Parking Structure 4 has a see-through silver fin screen |
| 65 | UV buildings had no floors or exterior stairs | Open switchback breezeway stairs with stringers and railings to every floor, railed balconies, ground-floor patio walls |
| 66 | Stair railings floating or in the ground | Rails follow the treads' outer edges 0.9 m above each nosing, with pickets and posts on the steps. The sloped-bar helper used by all rails also built solid slabs; rewritten as true sloped bars |
| 67 | No building signs | Green UTD name signs with orange rule on the lawn facing the nearest road or walk (176 panels) |
| 68 | Student Union and Comets LANding not recognisable | Stone promenade along the Union's arcade; six broad timber bleacher steps with rails down toward the Plinth fountain; raised terrace on columns with a railed stair at Comets LANding |
| 69 | Cart drove through parked cars | Each parked car is a solid box collider (verified: the cart stops at the car's side) |
| 70 | Turning at full speed too slow | Keyboard steering now allows ~0.58 g sideways: an 18 m radius at 22 mph (64° in 2 s), 7.6° lean, all four wheels down |
| 71 | Speed bumps too gentle | Bumps are 0.45 m long and 8.5 cm tall (humps 8.5 cm) |
| 72 | Trees on concrete, stunted trees, stray bike racks | Canopy trees are excluded from lots, plazas and courts; trees left in paving get mulched pits; canopy peaks under 4 m are dropped and every tree is at least 6 m tall with a 2.4 m crown; bike racks more than 2.5 m from any walk are dropped |
| 73 | Paved outlines on grass where nothing is | Unmapped stall pads are only inferred near apartments, residence halls and service yards, and as continuous strips rather than separate tiles |
| 74 | Sidewalk concrete blotchy | Broom-finished concrete texture; garden walls lowered to seat height |

## Building reconstruction (stages 2–5, 2026-11-01)

Pipeline: `reconstruction/observations.json` (what each official reference photo shows, with a confidence per feature) →
`npm run reconstruction-plan` (adds OSM geometry and heights, ranks by visibility, writes `docs/RECONSTRUCTION_PLAN.md`
and `reconstruction/specs.json`) → `npm run build-buildings` (Blender, reusable components, Draco GLBs in
`public/models/buildings/`) → the game swaps each building's procedural body for its GLB. In dev, `__h.compare(name, refFile)`
renders a street-level view beside the reference photo (`data/preview/cmp_*.png`).

| Item | Result |
|---|---|
| Buildings planned | 67 campus buildings ≥ 300 m², ranked by road and walkway frontage |
| With reference photos | 32 (others listed as unknown; JSOM, ranked 4th, has no photo in the set) |
| GLB models | 31 (Parking Structure 4 keeps the procedural open-deck garage), 5.2 MB total, Draco level 7 |
| Components | window module (surround, mullions, transom, sill), curtain wall, fin, louver blade, door assembly with canopy, parapet, fascia, floating roof plane on posts, column, rotunda drum, glass tower, hip roof, mosaic panel, truss cantilever, pyramid lantern |
| Frame time after models | 20.6 ms at spawn, 1280×720, Radeon 840M (was 14 ms) |

Verification passes (game render beside reference):

| Discrepancy found | Correction |
|---|---|
| Punched windows sat behind the wall plane and were invisible (residence halls, Berkner, Green Hall) | Glass set just proud of the wall inside a projecting surround |
| Top row of windows above the roofline | Window rows stop a storey below the roof |
| Signature features (doors, rotundas, ATEC cantilever, glass towers) on the longest wall rather than the street side | Each spec carries its front facade (most road/walk frontage); features go there |
| NSERL read as all violet tile | Teal curtain wall over most of each facade, tile framing it, as in the photo |
| Glass mirrored the sky instead of showing its tint | Glass metalness 0.7 → 0.35 |
| Residence-hall rotunda white/blue stripes | Limestone and teal glass bands with a gray metal top band |
| Green Hall and core buildings too yellow | Aggregate precast tan shifted to the photo's gray-beige |
| Andromeda had no brick; Canyon Creek all red brick | Alternating 10 m brick bays (red-brown on Andromeda; dark gray-brown with tan stucco on Canyon Creek) |
| Auto viewpoints too close or blocked | Viewpoints chosen 18–55 m from the walls with the fewest buildings in the line of sight |

## Fixed: grounding, flicker, signs, stairs, route mode, HUD (2026-11-01)

| # | Issue | Fix |
|---|---|---|
| 80 | Buildings (ECS West and others) hovered on slopes | Every Blender model now gets a concrete foundation from the lowest ground under its footprint up to its ground floor |
| 81 | A raised building with a stair hovered with no collision | OSM `covered=yes` raised blocks are built as bridges; every raised structure gets structural columns to the ground, with colliders |
| 82 | Textures flickered on buildings | Reversed-Z float depth buffer (log-depth fallback) instead of the 24-bit standard buffer; door frames stand 6 cm off walls; model foundations inset so no faces are coplanar |
| 83 | Stop signs off-centre, floating, nonsensical in Lot J | Stop points inside parking lots are not signed; elsewhere the sign goes to the first spot beyond the kerb that is not road, lot, building, water or walk; duplicates within 4 m dropped |
| 84 | Student Union and Comets LANding stairs jutted into walkways | SU bleacher steps stop before any walkway (fewer treads where needed); Comets terrace and stair stay in a 3.2 m band against the wall; both have colliders |
| 85 | Walkway stubs that lead nowhere; accessible-parking aisles drawn as walks | Dead-end walk pieces under 9 m and OSM `footway=access_aisle` are not drawn |
| 86 | Bike racks floating / not working | Inverted-U staples on legs that reach the ground, with colliders |
| 87 | Split roads with bare grass between (bus loop) | 180 raised medians between opposite one-way carriageways: 18 cm curbed islands, grass-topped when wider than 2 m, 25 cm colliders |
| 88 | Building surfaces flat and plastic | PBR texture sets (albedo, normal from height, roughness) for precast panels, limestone ashlar, brick, stucco, metal panels, ribbed siding, glazed tile, roof membrane, shingles, and glass with interiors and blinds, mapped by material on all 31 models |
| 89 | Route Challenge mode | Start menu (Free Roam, Random, Choose destination with search, optional route shown for −10%); 3-2-1 countdown from the UEMR apartment; beacon at the destination's entrance; objective panel with timer, distance to go, distance driven and an off-network warning; result screen with grade, score, best score (localStorage), map of the best route against yours. Routing is A* over roads, aisles and walkways (stairs excluded; walks weighted 8 % above roads). Score = 45 % route efficiency + 35 % pace (vs 7 m/s on the best route) + 20 % distance on roads and walks |
| 90 | HUD looked basic | Rebuilt: glass panels, display typeface, location card, 270° speedometer with ticks and gear strip, status chips, circular minimap with route/target and rim marker, toasts, vignette, menus |
| 92 | Cart spawned facing away from the outer road; one fixed start | Spawn turns toward the end of the lot aisle nearest a main road. Deploy from UV Building 11 or Safety and Grounds (menu) |
| 93 | Arrival required the beacon point; buildings have several entrances | Arrival anywhere within 15 m of the building outline |
| 94 | Destination marker always shown; selection not random enough; Waterview in the pool | Marker off by default (menu option); crypto-random pick, never one of the last six or within 150 m of the start; Waterview Science and Technology Center excluded; University Village buildings added as "University Village Building N" |
| 95 | No horn; siren synthetic; controls keyboard-only | Air-horn chord (B) and a two-tone wail siren through a speaker model; lights, siren, horn, headlights, location and camera are clickable chips |
| 96 | Location card sometimes wrong | Measures distance to the footprint (inside / beside / N m from); hidden by default, toggled with I or its chip |
| 97 | No pedestrians to avoid | Route Challenge places about 20 walkers on walks within 220 m and recycles them around the cart. With the horn or siren sounding they clear the cart's path 28 m out; unwarned they flinch only at the last moment. Each contact costs 50 points |
| 98 | No credit for traffic rules | 15 % of the score: stop signs (armed 12 m before the line; obeyed at ≤ 1.3 m/s, so a rolling stop counts) and speed bumps (≤ 3.6 m/s within 2.5 m). Flashes on the HUD and counts on the result screen |
| 99 | Flicker over Canyon Creek Heights and elsewhere | Roof caps now triangulated with courtyard holes (the cap had covered courtyards); window glass moved clear of brick bays; the 4 m far terrain sunk 0.35 m below the 2 m-draped surfaces; shadow camera snapped to whole texels. A frame diff with the camera nudged 2 cm shows only edge aliasing over Canyon Creek |
| 100 | Timber steps jutting into the walk toward the Plinth; rogue steps on walks | The Union-to-Plinth steps were not mapped and are removed. Mapped steps are built only where the drop is ≥ 0.45 m and steeper than 12 %; gentler ones are drawn as walks |
| 101 | Promenade checker had a heavy line along its middle | Even two-tone checkerboard of 0.75 m pavers, joints of one weight both ways |
| 102 | Stop signs off-centre and wrongly sized | The octagon was rotated after its UVs were made, turning the sign 22.5° inside its outline. Panels now built at the right angle; 30 in (0.76 m) stop, 36 in yield, on a square post centred behind |
| 103 | UV buildings had exterior stairs | Breezeway through the middle (across the footprint's principal axis): open from the ground to under the eaves, plastered side walls and ceiling, switchback flights with stringers, rails and landings at each floor. Bronze number plaques beside each opening and on the end walls |
| 104 | Walks drawn on the roadway; crosswalk bars skewed; overlapping stalls | Walk ribbons are cut wherever they lie 0.6 m inside a road. Crosswalk bars run with the traffic of the road being crossed, 0.6 m wide at 1.2 m spacing, only where wholly on pavement. Stalls are tested as oriented rectangles against each other (including the neighbouring chunk's) and against other aisles |
| 105 | Look | Colour grade after tone mapping: gentle S-curve, +8 % saturation, warm highlights over cool shadows, soft vignette |

Verification: a scripted run along the best route to the Activity Center finished at 655 m against a 661 m optimum, grade S. Unit tests cover routing (stairs excluded, walk shortcuts used) and scoring (grass cutting and detours penalised).

## Graphics round against the AAA reference image (2026-11-01)

| # | Area | Change |
|---|---|---|
| 108 | Lighting | Golden-hour default (sun 21° high from the WSW, warm key light, cooler sky fill), ACES filmic tone mapping, soft PCF shadows, deeper and more saturated sky, warm horizon haze |
| 109 | Post | Post chain renders into a 4x multisampled half-float target (keeps anti-aliasing and HDR); bloom now catches sun glare, lamps and LEDs; stronger colour grade |
| 110 | Trees | Crowns built from 5–9 leaf clusters (lumpy oak/elm silhouette), more and larger cards, baked self-shadowing per card, leaf texture with lit and shaded halves, wind sway, sunlight glowing through backlit leaves |
| 111 | Grounding | Baked ambient-occlusion decals: soft darkening along building walls and under trees, parked cars and the cart (`src/world/occlusion.ts`), a few triangles instead of a screen-space AO pass |
| 112 | Reflections | Glass, glossy facades, paint and water now reflect the sky (`src/graphics/reflections.ts`); before, three.js applied the dim scene environment strength to every material |
| 113 | Lawns | Tinted toward a watered green |
| 114 | Cars | Smoother lofted bodies, painted pillars and beltline, bumpers, plates, mirrors, door seams, handles, 5-spoke rims |
| 115 | Time of day | Menu option (Golden hour / Midday / Night, also `?time=`). Night: moonlight, navy sky, glowing lamp heads with light pools on the ground, lit windows in about 40 % of bays, glowing glass on modelled buildings, cart headlights on |

## Realism, bumps, flicker and frame-rate round (2026-11-01)

| # | Area | Change |
|---|---|---|
| 119 | Textures | Photo textures generated for the project (GPT-6 Luna via the Codex CLI, gpt-image, made seamless), stored as WebP in `public/textures` (2.7 MB): tan and red brick, sidewalk concrete, asphalt, lawn, live-oak bark and a leaf cluster. Loaded before the world is built (`src/world/photos.ts`); the canvas textures stay as fallback |
| 120 | Facades | University Village, Canyon Creek and red-brick styles draw the brick photo at real course size (8 courses ≈ 0.55 m, tile count rounded per bay); modelled buildings' brick uses a neutralised version of the photo with height from inverted luminance |
| 121 | Speed bumps | Audit of all 106 mapped devices against the drivable network: two node-mapped speed tables 6 m apart overlapped (each drawn 6.7 m long) and a mini-bump node doubled a bump. Node-mapped tables are now 4 m raised crosswalks (way-mapped tables keep their length) and devices within 8 m are merged, keeping the larger (`dedupeBumps`, tested) |
| 122 | Flicker | New `__h.flicker(name, eye, look)` check (two renders 2 cm apart, foliage frozen, red 16 px blocks where most pixels change). Ten views (spawn, mall, Student Union, aerials, five long road views near and to 400 m) show no z-fighting; flagged blocks are only fine leaf and asphalt detail close to the camera |
| 123 | Frame rate | Ground layers draped twice: 2 m grid near (< 200 m), 8 m grid beyond, far walks dropped past the detail range (asphalt 2.8 M → 1.4 M triangles, walks 1.8 M → 0.5 M). Trees: full crowns near, a light crown (a third of the cards, 1.55x larger) at mid range, and the light crown alone in the shadow pass (shadow-only layer). Parked cars slimmed (two-part 14-sided wheels, fewer loft stations). Wall and tree occlusion decals merged into one mesh per chunk. Chase view: about 3.7 M → 2.2 M triangles, about 1150 → 1000 draw calls |

## Site corrections from the user's review (2026-11-01)

| # | Area | Change |
|---|---|---|
| 126 | Medians | Inferred split-carriageway medians ran through junctions (Drive H at the University Village exit, the Drive H / Loop Road SW junction). They now open wherever another drivable road crosses (within its half-width + 4 m, over 35°), and pieces under 10 m are dropped (`openMedians`, tested) |
| 127 | Speed bumps | The raised table on Drive H at the University Village exit is removed (user's site knowledge; OSM maps one) |
| 128 | Markings | Lane-use arrows rebuilt from OSM `turn:lanes` for every lane (left, right, through, combined), MUTCD-style outlines, placed on the whole way rather than per chunk piece, moved back clear of crosswalks and stop bars, lane widths fixed for two-way roads. Stop bars span the approach lanes and are no longer painted inside lots. No lane dashes on one-way service aisles |
| 129 | Lots | Mapped lots without mapped aisles (part of Lot J) are filled with standard double-loaded rows (5.5 m stalls, 7.3 m aisle, 2.75 m spacing), clear of everything else |
| 130 | Lamps | Lamps mapped inside building footprints (Parking Structure 3's deck) are dropped |
| 131 | Grading | Building pads are levelled: inside each footprint the ground takes the median outline height, blending back over 7 m (skipped where the model differs by more than 2.5 m), so entrances meet the ground (`Terrain.gradeSites`) |
| 132 | Doors | Procedural doors snap to the wall between two window bays (never over a painted window); none on modelled buildings (stopped the Student Union passage door and stair-landing doors) or inside University Village breezeways |
| 133 | Stairs | Breezeway steps are solid closed-riser blocks |
| 134 | Plinth | Canopy raised 1.5 m and drawn as a beam grid (3 m) with 0.6 m shade fins, casting a gridded shadow; concrete floor under it; full raised stone ring round the fountain |
| 135 | Student Union | Five broad brown stone steps on the wall nearest the Plinth (not mapped; placement approximate); trees removed from the arcade promenade so the cart can use it |
| 136 | Buildings | Administration Building: pyramid lantern removed. Sciences Building: recessed, colonnaded ground floor under the upper floors. Callier Center Richardson: two storeys with orange window surrounds and fins. JSOM: orange-red brick bands with ribbon windows and white sunshades. Athenaeum Performance Hall and Music Building: built as finished, pale stone with slot windows |
| 137 | Roundabout | Sidewalk ring pulled to 0.3 m outside the curb |
| 138 | Shadows | Shadow map refreshed every frame (alternate-frame updates stepped shadow edges against the moving camera) |

## Fixes after the user's second review (2026-11-01)

| # | Area | Change |
|---|---|---|
| 142 | Cart flicker | The reflection boost made the cart's clear windshield flash white across the cabin as it moved; the cart is no longer boosted |
| 143 | Shader mix-up | The reflection boost wrapped every material's shader hook with the same source text, which three.js uses as its program key, so materials picked up each other's shaders (dark floor bands drawn across skybridges and lawns, the Plinth canopy solid white). Each material now keeps its own key |
| 144 | Building models | Rebuilding one model rewrote the model index with only that model, so 30 of the 31 reconstructed buildings had fallen back to boxes (the deformed Comets LANding area, among others). The index now lists every model in the folder |
| 145 | Elevation | Site grading (#131) removed; the ground is the survey model again |
| 146 | Canopies | Canopies 8 m and taller had no posts and hovered; every canopy now stands on posts |
| 147 | Union steps | Ipe-wood seating steps (UT Dallas Magazine, 2018), seven 1 m treads at 0.4 m, up to 40 m wide on the wall facing the Plinth |
| 148 | Fountain | Pool level with the highest ground inside the ring and filling it (the lawn showed through) |
| 149 | Markings | Arrows only where the whole arrow is on pavement; crosswalks run over the mapped crossing and on to the curb at both ends |
| 150 | Water | Ponds lie level at the lower shore height, with an animated ripple normal map |
| 151 | Lights | Every head flashes on its own: driver's side red, passenger side blue, triple flashes alternating, rear heads in opposite phase, side markers alternating slowly, with glow sprites |
| 152 | Audio | Siren follows published 100 W siren specs: wail 675–1700 Hz at 12/min and yelp at 180/min in an auto program, square wave driven into a horn-speaker filter with a slap-back echo. Horn is a one-second press of a two-tone car horn |

## New features: people, gauntlets, lots (2026-11-01)

| # | Area | Change |
|---|---|---|
| 154 | People | Walkers alone or two to three abreast, skateboarders (2.6–4.2 m/s) and cyclists (3.8–6.5 m/s, on cycleways, service roads and walks, keeping right), with boards, bikes, pedalling and pushing animations |
| 155 | Destinations | Northside apartments removed; every named parking lot added (names from the OSM `ref`, as on the campus map: Lot A–W, M North/East/South/Southeast…), arrival inside the lot or within 6 m of it. Buildings: within 6 m of any wall (was 15 m) |
| 156 | Multi-stop | Route Challenge · Multi-stop: 2–10 random stops or a chosen list, one after another; time per stop and in total, scored on the combined best routes (tested) |
| 157 | Assists | Destination beam is now an option, off by default, costing 10 % like the best route |
| 158 | Collisions | A loss of speed beyond 1.6 g with the cart moving over 2 m/s counts as a collision: −100 each (tested) |
| 159 | Numbers | University Village numbers 1.6 m tall on the walls facing a drivable road within 60 m (up to three walls) |
| 160 | Union | Arcade along the Union's east side is drivable (walls left out where a canopy covers the footprint, in physics and the model's foundation). The Union steps moved to Comets LANding's north side, 22 m wide, nine treads up to the second-floor deck |
| 161 | Comets LANding | Three storeys, 15.5 m (above the Union), clear glass in a grey aluminium grid, wrapped just outside the Union model |

## Signature buildings and QA fixes (2026-11-07)

| # | Area | Change |
|---|---|---|
| 164 | QA | Automated playtest of the production build (`artifacts/qa-playtest.mjs`, report `artifacts/qa/QA_REPORT.md`). Fixed: a sleeping physics body ignored throttle after a reset (cart did not move); windshield banner and glass drawn double-sided (hazed, mirrored driver view); `PCFSoftShadowMap` warning; favicon 404. Added touch driving pads |
| 165 | ATEC | One huge dark roof plane over the whole building, rising 8 m toward the front and cantilevered 16 m past it, with steel ribs, diagonals and raking columns from the ground (`sloped_plane`, `steel_member` in `build_buildings.py`) |
| 166 | Founders | The flat floating roof is now a single tilted white plane rising 6 m to the front with a 6 m overhang on slim columns |
| 167 | Callier Center Addition | Orange perforated-screen balcony across the entrance bay, an orange sloped sunshade above it, a red exterior stair |
| 168 | McDermott Library | Sloped standing-seam metal canopy over the ground-floor glass on every long wall |
| 169 | NSERL | Limestone colonnade at the base: glass set 2.5 m back behind square stone piers (recipe `groundMat`) |
| 170 | Student Services Addition | The "frame" roof built a solid charcoal wall 1.6 m in front of every face, hiding the glass; it is now an open picture frame (head, sill band, jambs, charcoal panel base) round the blue glass |
| 171 | Student Services Building | Sunshades: two white blades per floor and white outriggers every 3 m |
| 172 | Sciences Building | Timber-slat soffit under the recessed ground floor (the recipe's `timber` flag was unused) |
| 173 | Parking Structure 4 | The wave: a band of closely spaced grey fins rising and falling along the screen in a long sine; a dark glass stair tower with white corner fins, standing proud of the screen and 4 m above the roof |
| 174 | Student Union | Tan aggregate concrete and a timber-slat soffit under the recessed arcade (Starbucks terrace photo) |

## Fixes from the external playtest reports (2026-11-07)

| # | Report item | Change |
|---|---|---|
| 175 | R-01 shortcut scored 100% | Efficiency and pace are scaled by the share of driving on roads, walks and lots, so a grass shortcut no longer earns full marks (tested). The best route now ends at the nearest network node that reaches the arrival zone (any node within 25 m of the walls, or in or beside the lot), not one fixed node, so near-start baselines are honest |
| 176 | R-03 stop counter | Never shows a stop past the last one |
| 177 | R-04 timer 1:010.0 | Times round once before formatting (tested at 0:09.9, 1:10.0, 2:00.0) |
| 178 | R-05, QA-03 search | Searches UT Dallas building codes and alternate names (BSB, ECSW, JSOM, SU, Lot J...); an empty state with a Clear search button |
| 179 | R-09, QA-04 names | Bioengineering and Sciences Building; Research Operations Center West (models keep their old file names) |
| 180 | R-07 assists | While paused mid-run, the brief says the call in progress keeps its assists and changes apply to the next call |
| 181 | R-08 arrival | The call card reads To arrival (distance to the 6 m arrival zone); the first-drive tip explains it |
| 182 | QA P1 onboarding | First-drive tip with the controls, once (dismiss or 12 s) |
| 183 | QA-02 overlap | 761-1100 px windows move the call card under the compass; location, compass and call card no longer overlap at 800 x 600 |
| 184 | V-03, S-02 camera | The chase camera ray-casts against walls and parked cars; when blocked it comes in front of them and up over the cart, looking ahead |
| 185 | V-02 night | Headlights 150 cd over a wider 0.75 rad cone to 70 m; brighter moonlit fill and exposure |
| 186 | V-01 midday glare | Bloom almost off at midday (0.05), 0.14 golden hour, 0.3 night |
| 187 | QA-01, R-02, R-06 | Already resolved by the dispatch redesign (styled buttons, deploy-point text) |
| 191 | Bioengineering and Sciences (A-04 dark glazing) | Limestone frame round the middle of the long south face (jambs, head band, floor bands), a stone end bay, and double aluminium sunshades on the glass outside the frame (`stoneFrame`). The photo's facade is matched to the 63 m south face across the lot (medium confidence); the OSM entrance face on the west keeps the door |
| 192 | Cecil H. Green Hall | Deep window reveals (`reveal` 0.75 m): the wall face carried proud of the glass, with jambs, head soffits and steep light sills, matching the photo's punched precast |
| 193 | Activity Center | Half drum of dark glass with a metal band and flat cap on the entrance axis (`entryBlock`), doors in its face |
| 195 | Synergy Park North | Ground floor is now ribbon glass (was solid white); two brown metal pilasters on dark bases flank the entrance (`entryPilasters`), as in the photo |
| 196 | Waterview Science and Technology Center | Two-storey glazed entrance bay in a white surround on the main face (`entryBay`) |
| 197 | Facilities Management | Was dark metal all round. Now grey stucco over a limestone wainscot (`wainscot` 1.3 m) with punched windows, and a taller dark corrugated-metal block beside a limestone entry bay (`entryTower`), as in the photo |
| 198 | Davidson-Gundy Alumni Center | The roof plane runs 11 m out over the entrance terrace on slender white columns from the ground (`frontReach`), with a light soffit instead of wood |
| 199 | Administration Building | Lantern restored over the entrance block, where the photo shows it (it had been centred on the footprint, then removed): raised stone block, glazed clerestory, grey-green standing-seam pyramid with white ribs (`lantern: entryPyramid`) |
| 200 | Founders North | Fins in warm textured concrete instead of clean white panel, darker blue ribbon glass (courtyard photo) |
| 201 | Lloyd V. Berkner Hall | Same 1970s precast family as Green Hall: aggregate concrete with deep window reveals (0.9 m), wider bays, and a recessed glazed ground floor behind columns, instead of thin ribs and surface windows |
| 202 | Concrete walls untextured | `Wall_concrete` (Theatre, Founders North, Berkner) now takes the precast texture set like `Wall_tan` |
| 203 | Recipes lived only in specs.json | Every recipe edited in specs.json (18 buildings across rounds) copied back into `reconstruction/observations.json`, the source the plan script regenerates specs from; regenerating now reproduces specs exactly |
| 204 | Research and Operations Center (was generic) | Observation written from photo 79; Blender model: red brick, darker brick courses every 1.5 m (`stripes`), blank walls, parapet |
| 205 | Research Operations Center West (was generic) | Observation written from photo 80; Blender model: light panels with runs of orange, rust and grey bands of random length (fixed seed) and a blue-grey metal block at the west end (`endBlock`) |
| 206 | Police Building, Safety and Grounds, North Lab (were generic) | Observations written from photos 78, 77 (sign reads SG) and 75; Blender models in cream ribbed metal (ribbed texture) with metal gutter trim, sparse windows, a dark-framed glazed entrance bay between steel pilasters (`storefrontBay`) on Police and Safety and Grounds, and white roll-up doors (`rollDoors`) on North Lab |
| 207 | Housing Storage Warehouse, Modular Lab 2 (were generic) | Observations from photos 96 and 82. Housing Storage: grey stucco over stone wainscot, low hipped standing-seam metal roof (hip roofs now take `roofRise` and `roofMat`), glazed entrance bay; the photo is titled Housing Operations Bulk Storage and is matched by name and size (medium). Modular Lab 2: tan panels with a close rhythm of dark windows |
| 210 | Activity Center entrance | Photo 39 (University Recreation) added to its references: a dark curved fascia canopy on two posts now rings the glass drum at the door head |
| 211 | Recreation Center West (was generic) | Observation from photo 49: tan panels over a 2.2 m block base, and a blue glass box on the upper floor projecting over the entrance on round white columns (`upperGlassBox`), on the OSM entrance face |
| 212 | Physics Annex (was generic) | Observation from photo 76: smooth beige panels, few windows in light surrounds, dark steel single and double doors in surrounds (`serviceDoors`), parapet |
| 213 | University Commons halls (Vega, Capella, Sirius, Helix) | The thin rotunda becomes the photographed pavilion (`rotunda: pavilion`): a two-storey half-ring of limestone piers and glass with white ledges, a smaller white drum with a glass ribbon above, a glazed clerestory on the wall behind, and a curved canopy on posts over the doors |
| 214 | Andromeda Hall | Silver drum with blue glass bands at full height and a broad curved canopy on round columns (`rotunda: silver`), from photos 46 and 92 |
| 215 | Entrance drums over roads | The first Sirius pavilion reached across the street. The free distance from each entrance face to the nearest mapped road (by its width) is now measured into the recipe (`frontClear`), and drums are set back into the wall to keep drum and canopy 1.5 m clear (Sirius 8 m, Capella 9 m, Vega and Andromeda 10 m free) |
| 216 | Model parts outside footprints were not solid | Building colliders come from the OSM outline, so the cart passed through entrance drums, canopy posts and free-standing columns. The Blender script now writes `solids.json` (posts and rings outside the footprint, 16 models) and the physics world adds them per chunk. Verified: the cart, at full throttle, stops at the Vega canopy posts and at the Activity Center drum |
| 217 | Canyon Creek Heights North and South | White two-storey entry block with tall glazing and doors beside a one-storey glazed lounge with a white fascia (`entryLobby`, photo 43), kept inside the measured clearance to the road (9.5 m and 13 m) and solid for the cart |
| 218 | Engineering and Computer Science West | Was white bands with tall glass, unlike photo 69. Now limestone with narrow blue ribbon windows (`bandWall` 0.62), a glass stair tower, and a one-storey blue glass entrance pavilion with four stone piers rising above its roof and two curved silver barrel canopies (`entryPavilion`), solid for the cart. Which face the photo shows is medium confidence; the pavilion sits on the OSM entrance face, 15.5 m from Karl Hoblitzelle Hall |
| 219 | Clearance checks | Entrance clearances re-checked against neighbouring buildings as well as roads; no pavilion, lobby or drum reaches another building |
| 220 | Student Services Building | The sunscreen now stands 2 m off the glass as a white exoskeleton (`screenOut`): columns to the ground every ~7.5 m, a deep tray at each floor with three blades below it. The top floor rises above the screen as a white band with a teal glass ribbon, as in photo 27. The columns are solid for the cart |
| 194 | University Theatre, Karl Hoblitzelle Hall | Fascia depth and height are now recipe values: Theatre 3.5 m deep, 3.2 m tall board-formed concrete band over the entrance walls; Hoblitzelle 2.2 m, 1.8 m over the recessed glass |
| 221 | University Village number plaques flickered | The plaque sat 0.06 m off the wall, the same depth as the storey ledges, so where a ledge crossed it the two faces z-fought. Now 0.14 m proud (`buildings.ts` numberPlaque). `__h.flicker` from the road at UV11 flags nothing on the building |
| 222 | Touch screens (phones, tablets, iPads) | New touch layout from the user's reference image: orange Menu button top left, place band top centre (destination and distance while responding, else the nearest building), map with a column of round cart buttons top right, an analog stick bottom left (replaces the four arrow pads), speed pill bottom right. Checked by emulated layout at 740×360, 390×780 and 1280×720; the stick was driven with synthesized pointer events (the cart reached 9.6 m/s and coasted down on release). Not tested on a physical device |
| 223 | Loading screen | Real progress bar with percentage (downloads weighted by size, then the build and first stream); "Created by Sarvinoz Hasanova" bottom right; startup graphics choice (Auto, High, Medium, Low, Very low) with a Start button, remembered between visits; `?quality=` skips it. The screen fades out |
| 224 | Very low preset and 60 fps target | New `verylow` preset (0.75x resolution, 480 m view, no shadows). Auto starts entry-level laptop graphics (Intel UHD/Iris, GeForce MX) on Low and budget phones on Very low, then the adaptive controller holds 60 fps. MSAA is off on Low and Very low. The dev machine (i7-10510U, GeForce MX230 + Intel UHD, 1080p 60 Hz) detects Low |
| 225 | Background whirring | The synthesized motor and gear whine and the constant outdoor air bed are removed; tyre and wind noise remain while moving |
| 226 | Mute, steering sensitivity, random pick | Mute: HUD sound button, N key, Settings switch (remembered). Steering sensitivity 50–200% in Settings (scales the steering rate; on the stick, full lock with less push). Dispatch has a Random button on Open calls and Any location (adds a random stop while building a multi-call list) |
| 227 | 3D-Agentation-Editor | Installed for Claude (`~/.claude/skills`) and Codex (`~/.codex/skills`, `~/.agents/skills`), copied to `src/dev/` and attached in dev builds only (Shift+M). Receiver: `node ~/.claude/skills/3D-Agentation-Editor/server.mjs` from the project root; notes land in `.scenemark/` (git-ignored). Not in the production bundle |
| 228 | Pixelated picture after the 60 fps change (224) | Cause: Auto now starts Intel UHD/Iris and GeForce MX on Low, and Low drew 1.0 M pixels (0.69x of a 1080p window, stretched) with MSAA switched off for the whole session, even after Auto stepped up; Very low drew 0.54x. Fix: MSAA is on unless the session starts on Very low (or on a 2x touch screen); Low draws 1.3 M pixels (0.79x at 1080p), Very low 0.9 M (0.66x); the adaptive controller takes resolution no lower than 0.8x before stepping the preset down, and under that only on Very low below 60% of the target rate; the floor is 0.5x, not 0.4x. Shadow maps, texture filtering (8x anisotropic, mipmaps) and the night post chain were not changed by 224. Measured on Intel UHD (0x9B41), synchronised frame at spawn, 274 calls, 948k triangles, the machine thermally throttled, three alternating runs: old Low 1334x750 60-67 ms; new Low 1520x855 with MSAA 80-86 ms; new Low at the 0.8x step (1216x684, MSAA) 53-62 ms. `?msaa=0|1` forces MSAA for measuring. Not measured in a visible window at 1920x1080 or on the GeForce MX230 |

## Open

| # | Issue | Notes |
|---|---|---|
| 8 | Pedestrian and cart-height quality of Google 3D Tiles not assessed | Blocked on an API key |
| 13 | Cart dimensions and powertrain are estimates | Shape now follows the UEMR photo (The Retrograde, 2026-08-21). Measured wheelbase, mass and motor data would replace the estimates in `src/vehicle/config.ts` |
| 14 | Pressing S at very low speed shifts to reverse (arcade mapping) | Add an F/N/R "realistic" control mode |
| 15 | Initial load builds every chunk in view on the main thread (~1–2 s) | Move to a worker (milestone 4) |
| 16 | Steering is reduced with speed for keyboard driving | Make this configurable for wheel or gamepad input |
| 18 | Driver's-seat view: the left canopy post blocks part of the view | Matches a real cart |
| 27 | Canopy model dates from 2018–2020 imagery | Trees removed or planted since then are wrong; trees inside current construction areas are dropped. The library mall's columnar trees come out as round crowns because 1 m resolution blurs narrow crowns |
| 28 | Facade and roof styles are inferred from building type and name | OSM has almost no material or roof tags here. Styles follow the reference photos qualitatively; nothing is traced |
| 29 | Rooftop mechanical units are generic | Their positions are deterministic but not mapped |
| 30 | Steps whose ends the DEM shows at nearly the same height look like ramps | The 2 m DEM smooths short level changes, e.g. building entrance stairs |
| 106 | UV breezeway positions are approximate | OSM does not map breezeways; each is placed through the centroid across the footprint's short axis. Photos per building would fix positions and count |
| 107 | Pedestrians are simple figures (no arms, no animation rig) | Instanced capsule bodies with swinging legs; a rigged low-poly model would read better up close |
| 31 | Parking stall lines are generated at 2.75 m spacing along mapped aisles | Real striping and angles may differ; only drawn where the aisle lies inside a mapped lot |
| 56 | High quality is GPU-bound in the campus core on integrated graphics (~48 FPS) | Adaptive quality drops to medium there. Remaining cost is ground-layer overdraw, MSAA and leaf cards; a merged far-LOD per chunk and a Web Worker for chunk building are the next steps |
| 53 | Buildings are still OSM footprints extruded and dressed with forms; not full hand-modelled replicas | Fully faithful models (curved glass, mullion depth, rooftop forms) would need per-building Blender work from measured references |
| 91 | Frame time on high rose to ~23–25 ms with PBR building textures (Radeon 840M) | Adaptive quality drops to medium; a texture atlas per building would cut material count |
| 78 | Several side-by-sides cannot match the reference angle (the auto viewpoint is on the nearest walkway, the photographer's spot is unknown) | ATEC's cantilever, the Admin pyramid and the Science Learning Center mosaic were built but not confirmed from the photo's angle |
| 79 | 35 of 67 major buildings have no reference photo | They keep the procedural treatment; a photo per building (JSOM first) would let them be modelled |
| 75 | Police / Safety and Grounds back lot not generated | No yard, fence or lot is mapped there and I had no reference photo of it; nothing was invented. A photo or the official map's detail would let it be built |
| 76 | Traffic signals only where OSM maps them (37 intersections) | Campus-edge signals missing from the map are missing in the game |
| 77 | Some mapped stop signs face the wrong way where OSM has no direction tag (3 of 168) | |
| 54 | Baseball diamonds are oriented from the field's sharpest corner | Some may face the wrong way |
| 55 | The fountain mist is subtle and the column is a plain box | Reference shows a textured concrete column with dense mist |
| 33 | Parking structures are solid blocks | The cart cannot enter them; ramps and decks need modelled interiors |
| 116 | Lit windows at night are chosen at random per bay | Real occupancy is unknown; the pattern is deterministic, not mapped |
| 117 | Parked-car paint tints the rims and trim slightly | Each car is one instanced mesh coloured per instance; separate paint and trim meshes would fix it at one more draw call per car type |
| 118 | Frame time on high rose to about 25–30 ms at 1280×720 with the new trees, cars and decals (measured with the browser pane hidden, so noisy) | Adaptive quality steps down when needed; leaf cards are the largest single cost |
| 124 | Frame-time numbers this round are from the hidden browser pane, which throttles rendering | Triangle and draw-call counts are reliable; milliseconds need a check with the game in front |
| 125 | The leaf-cluster photo shows individual leaves large up close | A second, smaller-leaf cluster image would help near crowns |
| 139 | Student Union steps, Lot J rows and the Performance Hall exterior are approximations | No mapped geometry or photos of them; reference photos would let them be matched |
| 140 | JSOM and Callier are still procedural boxes with new facades | Full models (JSOM's atrium and sunshades, Callier's orange screens) need Blender work from photos |
| 141 | Building flicker not reproduced | Flicker checks at high and medium quality from the air and at street level show no z-fighting; the alternate-frame shadow refresh was the likely cause and is removed. A location would let it be checked |
| 153 | Split-carriageway junctions leave small grass islands between the paired roads | OSM draws each carriageway separately; filling those gaps needs junction polygons |
| 162 | Collision detection is inferred from deceleration | Rapier contact events would also catch slow scrapes |
| 163 | Steps and Comets LANding shape follow the user's description, not photos | |
| 188 | Physics Annex entrance stoop has no collider (S-01) | Door stoops are drawn per chunk but not given physics; needs a shared stoop builder for render and physics |
| 189 | Close-range tree cards (V-04), car repetition (V-05) | Not changed this round |
| 208 | Satellite Utility Plant photo (84) unmatched | Silver louver screen over a white precast base; no OSM building is named for it (the nearest candidate, Energy Plant, may be a different building), so no model was built. Needs the building's location confirmed |
| 209 | Visitor Center photos (40, 65) | Two locations (old and 2025); which OSM building each belongs to is not confirmed, so no model was built |
| 190 | Return to menu during the reports | Most likely the dev server reloading the page as files were edited during the session |

## Verification log

### Milestone 1

| Check | Result |
|---|---|
| Frame rate, 800×870 browser pane | 60 FPS on high and medium; ~370–440 draw calls, ~100k triangles |
| 0–15 mph | 3.9 s |

### Milestone 2–3 (2026-10-31)

Vehicle checks ran by stepping the live Rapier world directly from the page at 1/120 s, so they do not depend on frame rate.

| Check | Result |
|---|---|
| `tsc --noEmit` | Pass |
| `vitest` | 44/44 pass (adds terrain, heightfield orientation, smoothing, curbs, bumps, stairs, hip roofs, draping) |
| `vite build` | Pass, static `dist/` |
| Spawn | Parking aisle beside University Village Building 11, next to the Phase 1 Clubhouse and Laundry; cart rests at terrain height (−6.31 m relative to the origin) |
| 0–15 mph | 3.0 s (was 3.9 s); full-throttle squat 4.3° |
| Top speed / braking from top speed | 18.9 mph / 1.9 s over 7.5 m |
| Body roll, full lock | 6.1° at 8 mph (0.31 g); 6.4° at 13 mph (0.42 g); 8.5° at 19 mph (0.50 g) with the inside rear wheel lifting, no rollover |
| Curb, driven straight at it | Climbs at 4 and 10 mph; 6.3° pitch, 0.35–0.38 g vertical jolt |
| Speed bump (0.6 m × 7.5 cm) | 0.84 g at 5 mph, 2.0 g at 15 mph |
| Speed hump / table at 15 mph | 0.49 g / 0.37 g |
| Stairs (3 flights, both directions) | Blocked every time, about 1.4 m short of the first step |
| Frame time, Radeon 840M, 1280×720 | High 21.8 ms (718k tris, 403 calls), medium 16.1 ms, low 12.3 ms |
| Visual checks (captured frames) | UV apartments with hip roofs, residence halls with tall hip roofs, curbs, double yellow lines, bollards, paneled sidewalks, fences, cart livery, sun shadows, campus core from the air |
