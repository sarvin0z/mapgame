# Building reconstruction plan

Generated 2026-11-10 by `scripts/reconstruction-plan.ts`. Do not edit by hand: change
`reconstruction/observations.json` (architecture, from photos) and re-run.

**Sources.** Coordinates, footprints, heights and entrances: OpenStreetMap (snapshot 2026-11-01).
Architecture: official UT Dallas photographs listed per building (files in the user's reference folder, sources in its `sources.csv`).
Nothing is traced from Google imagery. Where no reference shows a feature it is marked unknown and the game keeps a
neutral generic treatment for it rather than inventing one.

**Confidence.** *high*: clearly visible in an official photo, or a mapped OSM tag. *medium*: partly visible, one side only,
or derived from OSM levels. *low*: estimated by building type or from a distant view.

**Priority** ranks 67 campus buildings (footprint ≥ 300 m²) by visibility: metres of facade within 25 m of a
drivable road (weight 2) or walkway (weight 1).

| # | Building | Visibility | Reference photos | GLB model |
|---|---|---|---|---|
| 1 | Vega Hall | 1010 | 1 | yes |
| 2 | Helix Hall | 1004 | 1 | yes |
| 3 | Sirius Hall | 974 | 2 | yes |
| 4 | Naveen Jindal School of Management | 970 | 4 | yes |
| 5 | Andromeda Hall | 960 | 3 | yes |
| 6 | Canyon Creek Heights North (CH7) | 902 | 3 | yes |
| 7 | Capella Hall | 850 | 1 | yes |
| 8 | Activity Center | 802 | 3 | yes |
| 9 | Parking Structure 4 | 772 | 1 | yes |
| 10 | Engineering and Computer Science West | 690 | 1 | yes |
| 11 | Synergy Park North | 676 | 1 | yes |
| 12 | Student Union | 668 | 2 | yes |
| 13 | Edith O'Donnell Arts & Technology Building | 644 | 1 | yes |
| 14 | Waterview Science and Technology Center | 620 | 1 | yes |
| 15 | Synergy Park North 2 | 562 | 0 | — |
| 16 | Natural Science and Engineering Research Lab | 540 | 1 | yes |
| 17 | Canyon Creek Heights South (CH6) | 534 | 3 | yes |
| 18 | Callier Center Richardson Addition | 530 | 2 | yes |
| 19 | Research and Operations Center | 514 | 1 | yes |
| 20 | Parking Structure 3 | 506 | 0 | — |
| 21 | Engineering and Computer Science South | 496 | 0 | — |
| 22 | Activity Center Bookstore | 484 | 0 | — |
| 23 | Bioengineering Science Building | 482 | 1 | yes |
| 24 | Parking Structure 1 | 482 | 0 | — |
| 25 | Sciences Building | 478 | 1 | yes |
| 26 | Davidson-Gundy Alumni Center | 462 | 1 | yes |
| 27 | Engineering and Computer Science North | 452 | 0 | — |
| 28 | Erik Jonsson Academic Center | 436 | 0 | — |
| 29 | Administration Building | 426 | 1 | yes |
| 30 | Student Services Building Addition | 412 | 1 | yes |
| 31 | Waterview Academic and Administrative Center | 398 | 0 | — |
| 32 | North Lab | 378 | 1 | yes |
| 33 | Cecil H. Green Hall | 376 | 1 | yes |
| 34 | Reasearch Operations Center West | 364 | 1 | yes |
| 35 | Callier Center Richardson | 362 | 0 | — |
| 36 | Founders Building | 348 | 1 | yes |
| 37 | Eugene McDermott Library | 332 | 1 | yes |
| 38 | Student Union Food Court | 324 | 0 | — |
| 39 | Energy Plant | 318 | 0 | — |
| 40 | Karl Hoblitzelle Hall | 308 | 2 | yes |
| 41 | Dining Hall West | 300 | 1 | yes |
| 42 | Dallas International School | 294 | 0 | — |
| 43 | Recreation Center West | 292 | 1 | yes |
| 44 | Lloyd V. Berkner Hall | 290 | 2 | yes |
| 45 | Service Building | 288 | 0 | — |
| 46 | Safety and Grounds | 286 | 1 | yes |
| 47 | Police Building | 284 | 1 | yes |
| 48 | Facilities Management | 282 | 1 | yes |
| 49 | Modular Lab 2 | 280 | 1 | yes |
| 50 | Facilities Management Shop Building | 280 | 0 | — |
| 51 | Modular Lab 1 | 276 | 0 | — |
| 52 | Science Learning Center | 272 | 1 | yes |
| 53 | Physics Building | 272 | 0 | — |
| 54 | University Surplus | 272 | 0 | — |
| 55 | Housing Storage Warehouse | 260 | 1 | yes |
| 56 | Student Services Building | 234 | 1 | yes |
| 57 | Founders North | 226 | 2 | yes |
| 58 | Facilities Management Pole Barn | 192 | 0 | — |
| 59 | University Theatre | 164 | 1 | yes |
| 60 | Charles and Nancy Davidson Building | 162 | 0 | — |
| 61 | Facilities Management Storage Building | 152 | 0 | — |
| 62 | Classroom Building | 138 | 0 | — |
| 63 | Facilities Management Events Building | 134 | 0 | — |
| 64 | North Office Building | 124 | 0 | — |
| 65 | Founders West Annex | 120 | 0 | — |
| 66 | Comets LANding | 102 | 0 | — |
| 67 | Physics Annex | 82 | 1 | yes |

## 1. Vega Hall (RHV)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991313, -96.75432 | high (OSM) |
| Footprint | 4699 m², ~95 × 94.8 m oriented box, 145 vertices | high (OSM) |
| Height | 21.3 m, 4 floors — OSM height tag | high |
| Roof | gray hip roofs over each wing *(medium)* | |
| Materials | tan/beige stucco with white trim bands *(high)* | |
| Windows | paired punched windows with white frames on every floor *(high)* | |
| Entrances | main entrance in a white curved rotunda with glass bands, reached by steps *(low)*; OSM maps 14 (yes, exit/hinged, emergency) | |
| Features | same University Commons design as Sirius and Helix *(low)* | |
| Not known | wing-by-wing roof details | |
| References | 57_University_Commons_Residence_Halls.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/vega_hall.glb`) | |

## 2. Helix Hall (RHH)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990175, -96.75296 | high (OSM) |
| Footprint | 4375 m², ~94.5 × 94.1 m oriented box, 131 vertices | high (OSM) |
| Height | 17.1 m, 4 floors — OSM height tag | high |
| Roof | gray hip roofs over each wing *(medium)* | |
| Materials | tan/beige stucco with white trim bands *(high)* | |
| Windows | paired punched windows with white frames on every floor *(high)* | |
| Entrances | main entrance in a white curved rotunda with glass bands, reached by steps *(high)*; OSM maps 9 (main, yes, main/hinged, exit/hinged, staircase/hinged, emergency) | |
| Features | white curved rotunda with horizontal glass bands at the entrance *(high)* | |
| Not known | wing-by-wing roof details | |
| References | 95_Helix_Hall_Residence_Hall_Southwest.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/helix_hall.glb`) | |

## 3. Sirius Hall (RHS)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990182, -96.751685 | high (OSM) |
| Footprint | 4231 m², ~91.8 × 88.6 m oriented box, 128 vertices | high (OSM) |
| Height | 21.3 m, 4 floors — OSM height tag | high |
| Roof | gray hip roofs over each wing *(medium)* | |
| Materials | tan/beige stucco with white trim bands *(high)* | |
| Windows | paired punched windows with white frames on every floor *(high)* | |
| Entrances | main entrance in a white curved rotunda with glass bands, reached by steps *(high)*; OSM maps 9 (main/hinged, staircase/hinged, exit, exit/hinged, emergency) | |
| Features | white curved rotunda with glass bands over the entrance steps *(high)* | |
| Not known | wing-by-wing roof details | |
| References | 06_Sirius_Hall.jpg, 58_Sirius_Hall_Exterior_2024.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/sirius_hall.glb`) | |

## 4. Naveen Jindal School of Management (JSOM)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.984979, -96.747206 | high (OSM) |
| Footprint | 11619 m², ~176 × 90 m oriented box, 71 vertices, 1 courtyard(s) | high (OSM) |
| Height | 18.3 m, 4 floors — OSM height tag | high |
| Roof | flat, stepped rectangular masses *(medium)* | |
| Materials | cream limestone-coloured walls; green-tinted glass *(medium)* | |
| Windows | long horizontal rows of green-tinted windows between cream wall bands on each floor *(medium)* | |
| Entrances | main entrance at a curved, glazed rotunda with an entrance plaza *(medium)*; OSM maps 10 (yes, yes/double) | |
| Features | curved entrance rotunda between rectangular wings *(medium)*; horizontal window rows aligned across the wings *(medium)* | |
| Not known | the photos come from a user-supplied image search (Building Reconstruction Quality.pdf, 2026-11-10) and are not from the official set: checked only for agreeing with each other; which footprint edges the rotunda occupies (taken from the OSM outline as mapped, not placed); rear and service facades; JSOM II and III additions | |
| References | 78_JSOM_1.png, 78_JSOM_2.png, 78_JSOM_3.png, 78_JSOM_4.png | |
| Reconstruction | Blender GLB (`public/models/buildings/naveen_jindal_school_of_management.glb`) | |

## 5. Andromeda Hall (RHA)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990351, -96.754632 | high (OSM) |
| Footprint | 5748 m², ~216.4 × 89.1 m oriented box, 64 vertices | high (OSM) |
| Height | 18.9 m, 5 floors — OSM height tag | high |
| Roof | flat with parapet *(high)* | |
| Materials | tan panels alternating with red-brown brick bays; white bands; blue glass towers *(high)* | |
| Windows | rows of punched windows; full-height blue glass at towers *(high)* | |
| Entrances | white curved drum with a columned portico *(high)*; OSM maps 6 (main/hinged, yes, main) | |
| Features | blue glass towers *(high)*; white columned portico with curved drum above *(high)* | |
| Not known | — | |
| References | 46_Andromeda_Hall_Current.jpg, 92_Andromeda_Hall_Exterior_2015.jpg, 42_Residence_Hall_West.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/andromeda_hall.glb`) | |

## 6. Canyon Creek Heights North (CH7)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.981566, -96.755312 | high (OSM) |
| Footprint | 3472 m², ~149.3 × 49.3 m oriented box, 79 vertices | high (OSM) |
| Height | 12.8 m, 4 floors — OSM height tag | high |
| Roof | flat with projecting cornice *(high)* | |
| Materials | dark gray-brown brick lower floors and bays; tan stucco upper floors and bays; white entrance volume *(medium)* | |
| Windows | punched windows with white frames, grouped in vertical bays *(high)* | |
| Entrances | white glazed entrance pavilion *(low)*; OSM maps 6 (yes, main, service/hinged) | |
| Features | alternating brick and stucco vertical bays *(high)* | |
| Not known | — | |
| References | 43_Canyon_Creek_Heights_South.jpg, 48_Canyon_Creek_Heights_Housing.jpg, 35_Canyon_Creek_Heights_Aerial.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/canyon_creek_heights_north_ch7.glb`) | |

## 7. Capella Hall (RHC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991284, -96.751781 | high (OSM) |
| Footprint | 4678 m², ~96 × 94.1 m oriented box, 131 vertices | high (OSM) |
| Height | 21.3 m, 4 floors — OSM height tag | high |
| Roof | gray hip roofs over each wing *(medium)* | |
| Materials | tan/beige stucco with white trim bands *(high)* | |
| Windows | paired punched windows with white frames on every floor *(high)* | |
| Entrances | main entrance in a white curved rotunda with glass bands, reached by steps *(low)*; OSM maps 12 (staircase/hinged, exit, main, exit/hinged, main/hinged, emergency) | |
| Features | same University Commons design as Sirius and Helix *(low)* | |
| Not known | wing-by-wing roof details | |
| References | 57_University_Commons_Residence_Halls.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/capella_hall.glb`) | |

## 8. Activity Center (AB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.985139, -96.749672 | high (OSM) |
| Footprint | 8546 m², ~174.4 × 64 m oriented box, 65 vertices | high (OSM) |
| Height | 14.3 m, 1 floors — OSM height tag | high |
| Roof | flat, low *(high)* | |
| Materials | tan precast concrete *(high)* | |
| Windows | few windows; glazed central entrance *(high)* | |
| Entrances | central glazed entrance on axis with a long walk and steps, with an 'ACTIVITY CENTER' sign wall *(high)*; OSM maps 7 (yes, yes/automatic, yes/double, exit) | |
| Features | mostly blank precast walls *(high)* | |
| Not known | — | |
| References | 11_Activity_Center.jpg, 39_Recreation_Center_Exterior.jpg, 90_Activity_Center_Exterior.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/activity_center.glb`) | |

## 9. Parking Structure 4 (PS4)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986141, -96.752945 | high (OSM) |
| Footprint | 7624 m², ~109.1 × 77.1 m oriented box, 17 vertices | high (OSM) |
| Height | 17.4 m, 4 floors — OSM height tag | high |
| Roof | open roof deck *(high)* | |
| Materials | silver perforated vertical fin screen; glass stair tower; concrete decks *(high)* | |
| Windows | glass stair tower at the corner *(high)* | |
| Entrances | vehicle entrances (not visible in photo) *(low)*; OSM maps 1 (yes) | |
| Features | vertical fin screen with a wave pattern *(high)*; glass stair tower *(high)* | |
| Not known | entrance positions | |
| References | 66_Parking_Structure_4_Exterior.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/parking_structure_4.glb`) | |

## 10. Engineering and Computer Science West (ECSW)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986131, -96.751589 | high (OSM) |
| Footprint | 6427 m², ~111 × 79.2 m oriented box, 59 vertices, 1 courtyard(s) | high (OSM) |
| Height | 22.6 m, 4 floors — OSM height tag | high |
| Roof | flat *(medium)* | |
| Materials | tan limestone panels; blue glass ribbon windows; glass stair towers; silver curved canopies *(medium)* | |
| Windows | narrow blue ribbon windows on each floor between deep limestone bands *(medium)* | |
| Entrances | glazed entrance *(low)*; OSM maps 6 (yes/automatic, service, exit/yes, main/yes) | |
| Features | limestone sign wall at the base *(medium)*; one-storey glazed entrance pavilion with stone piers and curved silver canopies *(medium)*; full-height glass stair tower *(medium)* | |
| Not known | which facade the photo shows (complex not isolated) | |
| References | 69_Engineering_Computer_Science_Complex.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/engineering_and_computer_science_west.glb`) | |

## 11. Synergy Park North (SPN)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.994076, -96.752253 | high (OSM) |
| Footprint | 4290 m², ~123.3 × 50.2 m oriented box, 59 vertices | high (OSM) |
| Height | 9.1 m, 2 floors — OSM height tag | high |
| Roof | flat *(high)* | |
| Materials | white horizontal bands; dark ribbon glass; brown pilasters at the entrance *(high)* | |
| Windows | continuous dark ribbon windows on each floor *(high)* | |
| Entrances | entrance between brown pilasters *(high)*; OSM maps 9 (yes, main, emergency, service/hinged, exit/hinged) | |
| Features | — | |
| Not known | — | |
| References | 86_Synergy_Park_North_Exterior.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/synergy_park_north.glb`) | |

## 12. Student Union (SU)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986643, -96.748812 | high (OSM) |
| Footprint | 5848 m², ~126 × 77.5 m oriented box, 92 vertices | high (OSM) |
| Height | 12.2 m, 2 floors — OSM height tag | high |
| Roof | flat with deep tan fascia over a covered terrace *(high)* | |
| Materials | tan precast concrete; dark glass *(high)* | |
| Windows | dark glazing set back behind the terrace *(high)* | |
| Entrances | glazed doors off the terrace, reached by the timber bleacher steps *(high)*; OSM maps 9 (main, exit, yes, yes/hinged, exit/yes, service/double, exit/hinged) | |
| Features | broad timber bleacher steps down to the plaza *(high)*; green patio umbrellas on the terrace *(medium)*; covered terrace under the fascia *(high)* | |
| Not known | north side (OSM marks the Student Success Center expansion under construction) | |
| References | 91_Student_Union_Exterior.jpg, 10_Student_Union_Plaza.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/student_union.glb`) | |

## 13. Edith O'Donnell Arts & Technology Building

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986139, -96.747545 | high (OSM) |
| Footprint | 6159 m², ~92.2 × 85.2 m oriented box, 67 vertices | high (OSM) |
| Height | 15.2 m, 4 floors — OSM height tag | high |
| Roof | huge sloped roof cantilevering over the entrance plaza, on exposed steel lattice trusses *(high)* | |
| Materials | dark blue glass; white stucco volumes; perforated metal screens *(high)* | |
| Windows | tall dark curtain wall under the cantilever *(high)* | |
| Entrances | glazed main entrance under the cantilevered roof *(high)*; OSM maps 6 (yes/hinged, main/hinged, exit, yes) | |
| Features | cantilevered sloped roof with lattice trusses *(high)*; white stucco volume with perforated screen *(medium)* | |
| Not known | back of house facades | |
| References | 05_Arts_Technology_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/edith_o_donnell_arts_technology_building.glb`) | |

## 14. Waterview Science and Technology Center (WSTC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991994, -96.757377 | high (OSM) |
| Footprint | 4336 m², ~110 × 45.6 m oriented box, 15 vertices | high (OSM) |
| Height | 6.1 m, 2 floors — OSM height tag | high |
| Roof | flat *(high)* | |
| Materials | red brick; dark glass *(high)* | |
| Windows | punched windows in brick; glazed recessed entrance *(high)* | |
| Entrances | recessed glass entrance at a brick pier *(high)*; OSM maps 4 (exit, main, yes) | |
| Features | — | |
| Not known | — | |
| References | 98_Waterview_Science_Technology_Center_Exterior.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/waterview_science_and_technology_center.glb`) | |

## 15. Synergy Park North 2 (SP2)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.995009, -96.753371 | high (OSM) |
| Footprint | 4026 m², ~111.8 × 50.7 m oriented box, 20 vertices | high (OSM) |
| Height | 9.1 m, 2 floors — OSM height tag | high |
| Roof | flat (OSM tag) | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 2 (yes) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 16. Natural Science and Engineering Research Lab (RL)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992326, -96.750395 | high (OSM) |
| Footprint | 4105 m², ~96.4 × 70.8 m oriented box, 37 vertices | high (OSM) |
| Height | 24.4 m, 4 floors — OSM height tag | high |
| Roof | flat with thin metal cornice *(medium)* | |
| Materials | blue-violet glazed tile cladding; teal curtain wall; limestone base *(high)* | |
| Windows | teal curtain-wall bays and stair tower; punched windows in tiled walls *(high)* | |
| Entrances | glazed entrance at the stone base *(medium)*; OSM maps 1 (yes) | |
| Features | full-height teal glass stair tower *(high)*; limestone ground-floor base *(high)* | |
| Not known | rear facade | |
| References | 03_NSERL.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/natural_science_and_engineering_research_lab.glb`) | |

## 17. Canyon Creek Heights South (CH6) (CH6)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.980644, -96.755358 | high (OSM) |
| Footprint | 7508 m², ~131.5 × 67 m oriented box, 42 vertices, 2 courtyard(s) | high (OSM) |
| Height | 12.8 m, 4 floors — OSM height tag | high |
| Roof | flat with projecting cornice *(high)* | |
| Materials | dark gray-brown brick lower floors and bays; tan stucco upper floors and bays; white entrance volume *(high)* | |
| Windows | punched windows with white frames, grouped in vertical bays *(high)* | |
| Entrances | white glazed entrance pavilion *(high)*; OSM maps 9 (yes, exit, exit/hinged, main/hinged) | |
| Features | alternating brick and stucco vertical bays *(high)* | |
| Not known | — | |
| References | 43_Canyon_Creek_Heights_South.jpg, 48_Canyon_Creek_Heights_Housing.jpg, 35_Canyon_Creek_Heights_Aerial.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/canyon_creek_heights_south_ch6.glb`) | |

## 18. Callier Center Richardson Addition (CRA)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991845, -96.748409 | high (OSM) |
| Footprint | 3639 m², ~118.6 × 64.6 m oriented box, 27 vertices | high (OSM) |
| Height | 7 m, 2 floors — OSM height tag | high |
| Roof | flat *(medium)* | |
| Materials | silver vertical metal fins; orange perforated screen balcony; glass *(high)* | |
| Windows | glazed ground floor; screened upper floor *(high)* | |
| Entrances | glazed entrance with a red exterior stair to the orange balcony *(high)*; OSM maps 4 (yes, yes/hinged) | |
| Features | orange perforated balcony screen *(high)*; red stair *(high)* | |
| Not known | — | |
| References | 45_Callier_Center_Richardson_Addition.jpg, 01_Callier_Center.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/callier_center_richardson_addition.glb`) | |

## 19. Research and Operations Center (ROC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986219, -96.75723 | high (OSM) |
| Footprint | 4785 m², ~74.1 × 64.7 m oriented box, 5 vertices | high (OSM) |
| Height | 6.1 m, 2 floors — OSM height tag | high |
| Roof | flat behind a plain brick parapet *(high)* | |
| Materials | orange-red brick with darker horizontal brick bands *(high)* | |
| Windows | very few: small punched windows high on the walls *(high)* | |
| Entrances | single glazed door with a small canopy on the parking-lot face *(medium)*; OSM maps 1 (yes) | |
| Features | horizontal dark brick bands every ~1.5 m *(high)*; mostly blank walls *(high)* | |
| Not known | rear facades; which face the photo shows (assumed the OSM entrance face) | |
| References | 79_Research_Operations_Center.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/research_and_operations_center.glb`) | |

## 20. Parking Structure 3 (PS3)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.99023, -96.750514 | high (OSM) |
| Footprint | 6722 m², ~96.9 × 76 m oriented box, 22 vertices | high (OSM) |
| Height | 14.3 m, 3 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 3 (yes) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 21. Engineering and Computer Science South (ECSS)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986136, -96.750483 | high (OSM) |
| Footprint | 5419 m², ~97.5 × 81.6 m oriented box, 43 vertices | high (OSM) |
| Height | 7.6 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 6 (main/double, yes/double, exit) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 22. Activity Center Bookstore (ACB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.98466, -96.749507 | high (OSM) |
| Footprint | 3014 m², ~74.2 × 62.4 m oriented box, 44 vertices | high (OSM) |
| Height | 11 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 6 (yes, exit) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 23. Bioengineering Science Building (BSB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991508, -96.749973 | high (OSM) |
| Footprint | 5182 m², ~132.3 × 62.6 m oriented box, 34 vertices | high (OSM) |
| Height | 25.3 m, 4 floors — OSM height tag | high |
| Roof | flat with thin projecting roof edge *(high)* | |
| Materials | long curtain wall with dark mullions; light limestone end walls with vertical stone fins *(high)* | |
| Windows | continuous curtain wall on the long facade, 4 floors *(high)* | |
| Entrances | glazed entrance at the end bay *(medium)*; OSM maps 4 (yes) | |
| Features | stone end walls framing the glass *(high)*; thin roof edge projecting over the curtain wall *(high)* | |
| Not known | courtyard side | |
| References | 04_Bioengineering_Sciences_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/bioengineering_science_building.glb`) | |

## 24. Parking Structure 1 (PS1)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.985945, -96.745478 | high (OSM) |
| Footprint | 4648 m², ~84.4 × 55.1 m oriented box, 6 vertices | high (OSM) |
| Height | 15.2 m, 3 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 25. Sciences Building (SCI)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988767, -96.750374 | high (OSM) |
| Footprint | 4460 m², ~108.4 × 82.6 m oriented box, 33 vertices | high (OSM) |
| Height | 15.4 m, 4 floors — OSM levels (4) x 3.6 m + 1 m | medium |
| Roof | flat *(medium)* | |
| Materials | beige limestone; timber soffits and louvers *(high)* | |
| Windows | deep-set windows in limestone walls *(medium)* | |
| Entrances | entrance with large metal 'SCIENCES BUILDING' letters on the stone *(high)*; OSM maps 10 (yes, staircase) | |
| Features | wood-slat soffit/louvers *(medium)*; mounted building lettering *(high)* | |
| Not known | overall massing | |
| References | 13_Sciences_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/sciences_building.glb`) | |

## 26. Davidson-Gundy Alumni Center (DGA)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986032, -96.746529 | high (OSM) |
| Footprint | 2672 m², ~75.1 × 55 m oriented box, 26 vertices | high (OSM) |
| Height | 10.7 m, 2 floors — OSM height tag | high |
| Roof | very thin flat roof plane cantilevering far beyond the walls, warm wood soffit *(high)* | |
| Materials | floor-to-ceiling glass; wood soffit; slender white posts *(high)* | |
| Windows | full-height glass on all visible sides *(high)* | |
| Entrances | glass doors under the cantilevered roof *(medium)*; OSM maps 1 (yes) | |
| Features | thin cantilevered roof plane *(high)* | |
| Not known | — | |
| References | 14_Davidson_Gundy_Alumni_Center.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/davidson_gundy_alumni_center.glb`) | |

## 27. Engineering and Computer Science North (ECSN)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986979, -96.750425 | high (OSM) |
| Footprint | 4936 m², ~97.8 × 79.2 m oriented box, 29 vertices | high (OSM) |
| Height | 7.6 m, 3 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 5 (yes, yes/double, exit) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 28. Erik Jonsson Academic Center (JO)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988782, -96.748926 | high (OSM) |
| Footprint | 4051 m², ~113 × 59.3 m oriented box, 53 vertices | high (OSM) |
| Height | 13.7 m, 4 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 9 (yes, exit) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 29. Administration Building (AD)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.989631, -96.748312 | high (OSM) |
| Footprint | 3789 m², ~90.9 × 89 m oriented box, 41 vertices | high (OSM) |
| Height | 12.5 m, 3 floors — OSM height tag | high |
| Roof | flat, with a central pyramidal metal-and-glass roof lantern *(high)* | |
| Materials | tan precast concrete *(high)* | |
| Windows | horizontal bands of recessed glazing *(medium)* | |
| Entrances | central entrance below the pyramid, facing the landscaped mall *(medium)*; OSM maps 3 (yes) | |
| Features | pyramid roof lantern *(high)* | |
| Not known | side facades | |
| References | 26_Administration_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/administration_building.glb`) | |

## 30. Student Services Building Addition (SSA)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.985972, -96.749371 | high (OSM) |
| Footprint | 2220 m², ~68.6 × 38.3 m oriented box, 23 vertices | high (OSM) |
| Height | 16.5 m, 3 floors — OSM height tag | high |
| Roof | flat, edged by a deep dark-gray frame *(high)* | |
| Materials | charcoal metal frame; blue glass *(high)* | |
| Windows | full-height blue curtain wall inside a projecting charcoal frame *(high)* | |
| Entrances | glazed ground floor under the frame *(medium)*; OSM maps 6 (exit, main, yes/hinged, yes, emergency) | |
| Features | projecting charcoal frame boxing out the upper floors *(high)* | |
| Not known | rear | |
| References | 28_Student_Services_Building_Addition.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/student_services_building_addition.glb`) | |

## 31. Waterview Academic and Administrative Center (WAAC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990388, -96.75804 | high (OSM) |
| Footprint | 2831 m², ~66 × 43.9 m oriented box, 8 vertices | high (OSM) |
| Height | 23.8 m, 5 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 32. North Lab (NL)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990369, -96.749291 | high (OSM) |
| Footprint | 1400 m², ~76.2 × 29.3 m oriented box, 16 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | low-slope metal roof with a white gutter trim *(high)* | |
| Materials | cream vertical-ribbed metal panels *(high)* | |
| Windows | very few small windows *(high)* | |
| Entrances | white roll-up doors and white personnel doors along the long faces *(high)*; OSM maps 1 (yes) | |
| Features | roll-up service doors *(high)* | |
| Not known | door positions on unseen faces (doors placed on the longest face only) | |
| References | 75_North_Lab_Official.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/north_lab.glb`) | |

## 33. Cecil H. Green Hall (GR)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988606, -96.747872 | high (OSM) |
| Footprint | 4051 m², ~76 × 72.6 m oriented box, 41 vertices | high (OSM) |
| Height | 13.7 m, 4 floors — OSM height tag | high |
| Roof | flat *(high)* | |
| Materials | tan exposed-aggregate precast concrete *(high)* | |
| Windows | groups of deep punched square windows in cantilevered upper volumes *(high)* | |
| Entrances | recessed ground-floor entrance off a brick-paved plaza with low steps *(high)*; OSM maps 6 (yes, emergency, main) | |
| Features | upper floors cantilever over a recessed, shaded ground floor *(high)*; brick-paved forecourt *(high)* | |
| Not known | — | |
| References | 09_Green_Hall.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/cecil_h_green_hall.glb`) | |

## 34. Reasearch Operations Center West (ROW)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986222, -96.758595 | high (OSM) |
| Footprint | 2842 m², ~92.1 × 31 m oriented box, 4 vertices | high (OSM) |
| Height | 9.5 m, 1 floors — OSM height tag | high |
| Roof | flat, low parapet *(high)* | |
| Materials | light panels with horizontal bands of orange, rust and grey panels of varying length; a blue-grey metal block at one end *(high)* | |
| Windows | few: small square windows within the banding *(medium)* | |
| Entrances | doors along the long face (positions not certain) *(low)*; OSM maps 0 | |
| Features | horizontal multicoloured panel bands *(high)*; blue-grey metal end block *(high)* | |
| Not known | rear facade; exact band pattern (randomised in the model) | |
| References | 80_Research_Operations_Center_West.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/reasearch_operations_center_west.glb`) | |

## 35. Callier Center Richardson (CR)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992416, -96.748874 | high (OSM) |
| Footprint | 2330 m², ~70.9 × 57 m oriented box, 30 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 4 (yes, exit) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 36. Founders Building (FO)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.987682, -96.749124 | high (OSM) |
| Footprint | 4312 m², ~111 × 41.5 m oriented box, 40 vertices | high (OSM) |
| Height | 16.8 m, 3 floors — OSM height tag | high |
| Roof | thin flat roof plane floating above the top floor, projecting ~3 m on all sides, on slender posts *(high)* | |
| Materials | white painted precast concrete fins; blue-green tinted glass *(high)* | |
| Windows | full-height glazing between closely spaced white vertical fins (~1.8 m), fins run the full height *(high)* | |
| Entrances | glazed storefront ground floor with double doors on the long facade *(medium)*; OSM maps 10 (yes/sliding, yes, yes/automatic) | |
| Features | white vertical fins over the whole facade *(high)*; floating roof canopy *(high)*; glazed ground floor slightly recessed *(medium)* | |
| Not known | rear facade; rooftop equipment | |
| References | 12_Founders_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/founders_building.glb`) | |

## 37. Eugene McDermott Library (MC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.987026, -96.747627 | high (OSM) |
| Footprint | 5509 m², ~81.1 × 72.2 m oriented box, 26 vertices | high (OSM) |
| Height | 14.6 m, 3 floors — OSM height tag | high |
| Roof | flat with deep projecting fascia *(high)* | |
| Materials | tan precast concrete *(high)* | |
| Windows | upper floors: recessed ribbon windows behind a rhythm of deep precast frames (square bays); ground floor: shaded glass behind a deep overhang *(high)* | |
| Entrances | main entrance at the recessed ground floor facing the mall *(medium)*; OSM maps 4 (yes, yes/automatic, exit/hinged) | |
| Features | stepped upper floors with deep horizontal precast bands *(high)*; low tan concrete planter walls along the front *(high)*; upper floors overhang a shaded ground floor *(high)* | |
| Not known | north facade | |
| References | 02_McDermott_Library.png | |
| Reconstruction | Blender GLB (`public/models/buildings/eugene_mcdermott_library.glb`) | |

## 38. Student Union Food Court (SUFC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986778, -96.749419 | high (OSM) |
| Footprint | 2255 m², ~52.4 × 52 m oriented box, 35 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 10 (service/hinged, secondary/hinged, yes/hinged) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 39. Energy Plant (EP)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988645, -96.751268 | high (OSM) |
| Footprint | 1473 m², ~60.9 × 28.5 m oriented box, 10 vertices | high (OSM) |
| Height | 17.1 m, 3 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 40. Karl Hoblitzelle Hall (HH)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986787, -96.751658 | high (OSM) |
| Footprint | 2917 m², ~88.3 × 37.1 m oriented box, 33 vertices | high (OSM) |
| Height | 6.7 m, 1 floors — OSM height tag | high |
| Roof | flat, low *(high)* | |
| Materials | tan precast concrete *(high)* | |
| Windows | dark recessed glazing under a deep overhang *(high)* | |
| Entrances | entrance at the top of broad steps under the overhang *(high)*; OSM maps 10 (main/automatic, yes, exit/hinged) | |
| Features | deep overhang shading the front *(high)* | |
| Not known | — | |
| References | 97_Karl_Hoblitzelle_Hall_Exterior.jpg, 71_Karl_Hoblitzelle_Hall_2025.png | |
| Reconstruction | Blender GLB (`public/models/buildings/karl_hoblitzelle_hall.glb`) | |

## 41. Dining Hall West (DHW)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.989874, -96.754454 | high (OSM) |
| Footprint | 2984 m², ~78.8 × 49.5 m oriented box, 41 vertices | high (OSM) |
| Height | 11.3 m, 1 floors — OSM height tag | high |
| Roof | flat white roof with overhang *(high)* | |
| Materials | glass walls; white roof edge; deck over the pond *(high)* | |
| Windows | full-height glass *(high)* | |
| Entrances | not visible *(low)*; OSM maps 4 (yes, exit) | |
| Features | deck over the pond *(medium)* | |
| Not known | entrance side | |
| References | 08_Dining_Hall_West.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/dining_hall_west.glb`) | |

## 42. Dallas International School

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991149, -96.75809 | high (OSM) |
| Footprint | 1505 m², ~50.2 × 34.5 m oriented box, 17 vertices | high (OSM) |
| Height | 25.9 m, 5 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 1 (main) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 43. Recreation Center West (RCW)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990089, -96.755243 | high (OSM) |
| Footprint | 2059 m², ~58.8 × 38.4 m oriented box, 9 vertices | high (OSM) |
| Height | 11.3 m, 2 floors — OSM height tag | high |
| Roof | flat *(medium)* | |
| Materials | smooth tan panels over a split-face block base *(high)* | |
| Windows | blue glass box on the upper floor at the entrance *(high)* | |
| Entrances | glazed doors under the glass box, which rests on round white columns *(high)*; OSM maps 1 (main/hinged) | |
| Features | projecting upper glass box on round columns with the REC CENTER WEST name band *(high)* | |
| Not known | which face the entrance is on (placed on the OSM entrance face); rest of the facades | |
| References | 49_Rec_Center_West_Exterior.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/recreation_center_west.glb`) | |

## 44. Lloyd V. Berkner Hall (BE)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.987705, -96.750536 | high (OSM) |
| Footprint | 3471 m², ~84.2 × 45.3 m oriented box, 38 vertices | high (OSM) |
| Height | 18.3 m, 2 floors — OSM height tag | high |
| Roof | flat *(high)* | |
| Materials | tan precast concrete, board texture *(high)* | |
| Windows | deep-set punched windows in stacked, stepped volumes *(high)* | |
| Entrances | ground-floor entrance off the paved plaza *(medium)*; OSM maps 1 (yes) | |
| Features | stacked precast volumes with deep reveals *(high)* | |
| Not known | — | |
| References | 89_Lloyd_V_Berkner_Hall_Current.jpg, 85_Lloyd_V_Berkner_Hall_1973_Historic.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/lloyd_v_berkner_hall.glb`) | |

## 45. Service Building (SB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991305, -96.746379 | high (OSM) |
| Footprint | 1473 m², ~68.2 × 21.7 m oriented box, 5 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 46. Safety and Grounds (SG)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990877, -96.746777 | high (OSM) |
| Footprint | 961 m², ~51.3 × 18.8 m oriented box, 6 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | low gable, metal *(medium)* | |
| Materials | light grey vertical-ribbed metal panels *(high)* | |
| Windows | few: a tall dark window beside the entrance *(high)* | |
| Entrances | dark-framed glazed entrance bay with double doors (sign reads Environmental Health & Safety, SG) *(high)*; OSM maps 2 (yes, exit/hinged) | |
| Features | — | |
| Not known | rear facades | |
| References | 77_Environmental_Health_Safety_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/safety_and_grounds.glb`) | |

## 47. Police Building (PD)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991692, -96.745713 | high (OSM) |
| Footprint | 1247 m², ~56.5 × 32.2 m oriented box, 10 vertices | high (OSM) |
| Height | 4.6 m, 1 floors — OSM height tag | high |
| Roof | flat or very low slope behind a metal gutter trim *(high)* | |
| Materials | cream vertical-ribbed metal panels with darker steel pilasters *(high)* | |
| Windows | a few tall dark windows in the long face *(high)* | |
| Entrances | recessed dark-framed glazed entrance with double glass doors up a short flight of steps and a ramp *(high)*; OSM maps 1 (yes/hinged) | |
| Features | glazed entrance bay set back under the eave *(high)* | |
| Not known | rear facades; which face the photo shows (assumed the OSM entrance face) | |
| References | 78_UT_Dallas_Police_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/police_building.glb`) | |

## 48. Facilities Management (FM)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992244, -96.747268 | high (OSM) |
| Footprint | 1261 m², ~47.6 × 34.3 m oriented box, 16 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | flat *(high)* | |
| Materials | dark corrugated metal volume; limestone and white panel volumes *(high)* | |
| Windows | small square windows *(high)* | |
| Entrances | glass door in the stone volume *(high)*; OSM maps 4 (main, yes/hinged, exit) | |
| Features | 'FACILITIES MANAGEMENT' lettering on the dark metal *(high)* | |
| Not known | — | |
| References | 15_Facilities_Management.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/facilities_management.glb`) | |

## 49. Modular Lab 2 (ML2)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986842, -96.753258 | high (OSM) |
| Footprint | 839 m², ~51.7 × 16.2 m oriented box, 7 vertices | high (OSM) |
| Height | 4.3 m, 1 floors — OSM height tag | high |
| Roof | flat behind a metal coping *(medium)* | |
| Materials | smooth tan panels; steel columns; dark louvered window panels *(high)* | |
| Windows | tall narrow dark louvered panels in a regular rhythm along the long face *(high)* | |
| Entrances | dark double doors under a projecting metal canopy *(high)*; OSM maps 2 (yes) | |
| Features | — | |
| Not known | rear facade | |
| References | 82_Modular_Lab_2.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/modular_lab_2.glb`) | |

## 50. Facilities Management Shop Building (FMSB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992223, -96.746997 | high (OSM) |
| Footprint | 1192 m², ~54 × 22.2 m oriented box, 7 vertices | high (OSM) |
| Height | 4.6 m, 1 floors — OSM levels (1) x 3.6 m + 1 m | medium |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 1 (yes/hinged) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 51. Modular Lab 1 (ML1)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.986841, -96.752655 | high (OSM) |
| Footprint | 812 m², ~51.6 × 15.9 m oriented box, 7 vertices | high (OSM) |
| Height | 4.3 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 2 (yes) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 52. Science Learning Center (SLC)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988163, -96.750346 | high (OSM) |
| Footprint | 2312 m², ~88 × 32.2 m oriented box, 31 vertices | high (OSM) |
| Height | 15.2 m, 3 floors — OSM height tag | high |
| Roof | flat parapet *(high)* | |
| Materials | light stone/precast; large mosaic of blue glass panels *(high)* | |
| Windows | blue glass mosaic wall on the main facade *(high)* | |
| Entrances | glazed ground floor at the plaza corner *(medium)*; OSM maps 7 (yes, exit, exit/hinged) | |
| Features | blue glass mosaic panel wall *(high)* | |
| Not known | other facades | |
| References | 29_Science_Learning_Center.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/science_learning_center.glb`) | |

## 53. Physics Building (PHY)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.989427, -96.75034 | high (OSM) |
| Footprint | 1854 m², ~60.7 × 52.8 m oriented box, 31 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 4 (yes) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 54. University Surplus (FMCS)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991766, -96.747259 | high (OSM) |
| Footprint | 1040 m², ~46.6 × 22.4 m oriented box, 7 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 3 (yes, yes/hinged) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 55. Housing Storage Warehouse (HSW)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.991341, -96.75328 | high (OSM) |
| Footprint | 880 m², ~44 × 20.1 m oriented box, 5 vertices | high (OSM) |
| Height | 4.6 m, 1 floors — OSM levels (1) x 3.6 m + 1 m | medium |
| Roof | low hipped standing-seam metal roof with deep eaves *(high)* | |
| Materials | grey stucco over a stone wainscot; a tower clad in grey lap siding at the entrance *(high)* | |
| Windows | large dark-framed punched windows *(high)* | |
| Entrances | glazed entrance under a flat metal canopy *(high)*; OSM maps 1 (main) | |
| Features | stone wainscot *(high)* | |
| Not known | identity: the photo is titled Housing Operations Bulk Storage Building; matched to the OSM Housing Storage Warehouse by name and size (medium); rear facade | |
| References | 96_Housing_Operations_Bulk_Storage_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/housing_storage_warehouse.glb`) | |

## 56. Student Services Building (SSB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.985965, -96.748869 | high (OSM) |
| Footprint | 1962 m², ~56.5 × 34.8 m oriented box, 11 vertices | high (OSM) |
| Height | 22.9 m, 4 floors — OSM height tag | high |
| Roof | flat with thin white roof plane *(high)* | |
| Materials | white metal frame grid; light green glass *(high)* | |
| Windows | full curtain wall behind a white frame with horizontal louver blades *(high)* | |
| Entrances | glazed entrance *(low)*; OSM maps 4 (main/hinged, yes/hinged, emergency/hinged) | |
| Features | white sunshade louvers on every floor *(high)*; reflecting pool alongside *(high)* | |
| Not known | — | |
| References | 27_Student_Services_Building.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/student_services_building.glb`) | |

## 57. Founders North (FN)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988122, -96.749298 | high (OSM) |
| Footprint | 1836 m², ~74.6 × 30.4 m oriented box, 27 vertices | high (OSM) |
| Height | 10.7 m, 2 floors — OSM height tag | high |
| Roof | flat *(medium)* | |
| Materials | white precast vertical fins and glass, matching Founders *(medium)* | |
| Windows | full-height glazing between white fins *(medium)* | |
| Entrances | courtyard side opening onto the Rock Garden *(medium)*; OSM maps 6 (yes) | |
| Features | Rock Garden courtyard with specimen rocks on pedestals *(high)* | |
| Not known | street facades | |
| References | 73_Founders_North_Courtyard.jpg, 83_Founders_North_Courtyard_2.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/founders_north.glb`) | |

## 58. Facilities Management Pole Barn (FMPB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992303, -96.74634 | high (OSM) |
| Footprint | 725 m², ~52.6 × 13.8 m oriented box, 4 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 59. University Theatre (TH)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.988436, -96.748738 | high (OSM) |
| Footprint | 1373 m², ~39.8 × 34.5 m oriented box, 17 vertices | high (OSM) |
| Height | 9.1 m, 1 floors — OSM height tag | high |
| Roof | flat, low *(high)* | |
| Materials | tan stucco/precast *(high)* | |
| Windows | few; recessed glass entrance *(high)* | |
| Entrances | recessed entrance with a digital sign panel beside it *(high)*; OSM maps 0 | |
| Features | blank tan walls with a recessed entry *(high)* | |
| Not known | — | |
| References | 81_University_Theatre_Exterior.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/university_theatre.glb`) | |

## 60. Charles and Nancy Davidson Building

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.984954, -96.745521 | high (OSM) |
| Footprint | 5674 m², ~100.1 × 70.8 m oriented box, 8 vertices, 1 courtyard(s) | high (OSM) |
| Height | 11.8 m, 3 floors — OSM levels (3) x 3.6 m + 1 m | medium |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 61. Facilities Management Storage Building (FMF)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992439, -96.7458 | high (OSM) |
| Footprint | 343 m², ~21 × 16.3 m oriented box, 4 vertices | high (OSM) |
| Height | 6.1 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 62. Classroom Building (CB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.989701, -96.749254 | high (OSM) |
| Footprint | 1081 m², ~45.9 × 23.9 m oriented box, 10 vertices | high (OSM) |
| Height | 4.6 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 2 (yes) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 63. Facilities Management Events Building (FME)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.992761, -96.746611 | high (OSM) |
| Footprint | 682 m², ~32.8 × 20.9 m oriented box, 4 vertices | high (OSM) |
| Height | 6.7 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 0 | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 64. North Office Building (NB)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.990078, -96.74931 | high (OSM) |
| Footprint | 668 m², ~44.7 × 15.3 m oriented box, 9 vertices | high (OSM) |
| Height | 4.6 m, 1 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 1 (yes) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 65. Founders West Annex (FA)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.987707, -96.749887 | high (OSM) |
| Footprint | 475 m², ~45.3 × 10.5 m oriented box, 14 vertices | high (OSM) |
| Height | 18.3 m, 2 floors — OSM height tag | high |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 5 (yes, service/hinged) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 66. Comets LANding

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.98715, -96.748962 | high (OSM) |
| Footprint | 578 m², ~28.5 × 20.7 m oriented box, 7 vertices | high (OSM) |
| Height | 8.2 m, 2 floors — OSM levels (2) x 3.6 m + 1 m | medium |
| Roof | _unknown: no reference_ | |
| Materials | _unknown: no reference_ | |
| Windows | _unknown: no reference_ | |
| Entrances | —; OSM maps 1 (main) | |
| Features | — | |
| Not known | architecture (no reference photo) | |
| References | **none — needs a photo** | |
| Reconstruction | procedural extrusion with generic facade | |

## 67. Physics Annex (PHA)

| Item | Value | Confidence |
|---|---|---|
| Coordinates | 32.989518, -96.749925 | high (OSM) |
| Footprint | 387 m², ~20.3 × 19.1 m oriented box, 8 vertices | high (OSM) |
| Height | 4.3 m, 1 floors — OSM height tag | high |
| Roof | flat behind a dark metal coping *(high)* | |
| Materials | smooth beige panels *(high)* | |
| Windows | few: single windows with light surrounds *(high)* | |
| Entrances | dark steel single and double doors in light surrounds, reached by short stairs with rust-red rails *(high)*; OSM maps 4 (yes) | |
| Features | communications tower behind (not modelled) *(high)* | |
| Not known | rear facades; stair positions (S-01: door stoops still have no colliders) | |
| References | 76_Physics_Annex_Official.jpg | |
| Reconstruction | Blender GLB (`public/models/buildings/physics_annex.glb`) | |

