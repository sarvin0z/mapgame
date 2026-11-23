# Campus building reference map

Footprint IDs refer to `public/data/campus.json`. Slugs are GLB stems. Style names
indicate current procedural rendering. Counts in the Batch 1 table are selected
comparison views, with the two crops of the Callier archive counted once.

| Batch 1 building | OSM ID | Model slug | Comparison views and available references |
| --- | --- | --- | --- |
| Sciences Building | w923037378 | `sciences_building` | 3 selected. Downloads arcade, night tower and SCI/SLC courtyard. User PDF pp. 1, 6. Existing exterior and portal set in `data/refs` and `quality_pdf`. Datum Engineers and UT Dallas |
| Sirius Hall | w258038934 | `sirius_hall` | 2 selected. Downloads curved entrance, user PDF p. 14, local 06/58 (same angle), and the UT Dallas timeline |
| Callier Center Richardson Addition | w514362006 | `callier_center_richardson_addition` | 2 selected. Downloads red stair, local 01/45, CENTRIA and Metal Architecture galleries |
| Callier Center Richardson | w543192302 | `callier_center_richardson` | 1 archive photograph, two framings. UT Dallas Callier timeline, with Metal Architecture for later renovation context |
| Crow Museum of Asian Art | w1128100173 | `crow_museum_of_asian_art` | 3 selected. Downloads exterior, user PDF pp. 2, 7, Morphosis, Wells and architect-supplied views published in Texas Architect. OSM labels the museum footprint with the district name |

## Batches 2-4 and the supplied collection

| Building or place | Current slug or procedural style | Reference coverage |
| --- | --- | --- |
| NSERL | `natural_science_and_engineering_research_lab` | Curved green-glass aerial, user PDF pp. 2, 8, local 03, 3 Instagram views listed |
| ECS West | `engineering_and_computer_science_west` | Night glazing, user PDF pp. 1, 7, 7 exterior angles in quality PDF, local 710 series, 1 Instagram view listed |
| ECS North / South | `engineering_and_computer_science_north` / `engineering_and_computer_science_south` | Local 69 complex view and user PDF p. 20 for South. North photo identity unresolved |
| Student Union / Food Court | `student_union` / `student_union_food_court` | Local 10, 74, 91, 94, including interiors |
| Student Union / Student Success Center | `student_union_student_success_center` | User PDF pp. 4, 16, local 63, 4 Instagram progress views listed |
| Comets LANding | `comets_landing` | User PDF pp. 2, 9, local 22, 1 Instagram aerial listed |
| Recreation Center West | `recreation_center_west` | User PDF pp. 4, 17, 18, local 49, 1 Instagram view listed. Downloads University Recreation entrance needs site confirmation |
| Student Services / Addition | `student_services_building` / `student_services_building_addition` | User PDF pp. 3, 10, local 27/28, 1 Instagram main-building view listed |
| McDermott Library / The Plinth | `eugene_mcdermott_library` / `canopy` | 2 Downloads library/pergola angles and 2 Trellis Plaza angles. User PDF pp. 2, 8, local 02 and 4 quality-PDF Plinth views |
| Visitor Center | `parking_structure_3` | Official relocation to PS3. Local 65 and the Downloads storefront view match this site. Local 40 shows the older Activity Center Bookstore location |
| Activity Center / Bookstore | `activity_center` / `activity_center_bookstore` | User PDF pp. 3, 10, local 11/90, Downloads cylindrical Bookstore side. The two footprints are separate |
| Andromeda / Vega | `andromeda_hall` / `vega_hall` | 2 Downloads Andromeda angles and 1 Vega. Local 46/92 for Andromeda |
| Capella / Helix | `capella_hall` / `helix_hall` | Capella in user PDF pp. 5, 19, and 1 Instagram angle. Local 95 and quality PDF p14_2 for Helix |
| Athenaeum Music Building and Performance Hall | `performance_hall_and_music_building` | User PDF pp. 4, 17 and 4 Instagram views listed |
| JSOM | `naveen_jindal_school_of_management` / `charles_and_nancy_davidson_building` | User PDF pp. 1, 12, quality PDF pp. 9-10, local 78 series, 8 Instagram views listed. Numbered building assignments remain incomplete |
| Davidson-Gundy Alumni Center | `davidson_gundy_alumni_center` | User PDF pp. 2, 9, local 14, 1 Instagram view listed |
| Founders / Founders North | `founders_building` / `founders_north` | User PDF pp. 2, 11, local 12/73/83, 1 archival Instagram angle for Founders |
| Physics / Annex | `physics_building` / `physics_annex` | Downloads Golden Hour Entry for Physics. Local 76 for the Annex |
| Science Learning Center | `science_learning_center` | Downloads SCI/SLC quad and local 29 |
| Dining Hall West | `dining_hall_west` | User PDF pp. 3, 15 and local 08 |
| University Village | `university_village_<number>`, leasing office and clubhouse slugs | Downloads Phase 1 garden, user PDF pp. 3, 13, local aerials and ground views, 3 Instagram views with phase uncertain |
| Northside residences | `northside_building_<number>` and `northside_plus_building_<number>` | User PDF pp. 3, 11, local 24/60/61/62, 1 Instagram view listed |
| Canyon Creek Heights | `canyon_creek_heights_north_ch7` / `canyon_creek_heights_south_ch6` | Local 35/43/48 and quality PDF p15_2/p15_3 |
| Unidentified supporting scenes | Pending footprint match | Downloads arcade, lakeside pavilion, reflecting pools and garage interior. Instagram inventory lists 8 uncertain views |

Photographs are comparison inputs only. The Instagram inventory is indexed by
its supplied captions. Instagram blocked direct post retrieval in this pass.
`python blender/render_compare.py <slug>` creates a comparison from
`observations.json`. The script requires Pillow and uses PyMuPDF for the PDF
references. It writes the annotated sheet under `data/preview/buildings/`.

## Scope and remaining uncertainty

[Batch results](batch-results.md) lists each rebuilt footprint and links its
comparison. The Plinth uses the existing procedural louvers and fountain. Its
published height and physical columns were updated. The remaining procedural
parking decks, greenhouse, pump station, mail kiosk, small unnamed structures,
and surrounding off-campus buildings retain their existing treatments.

Apartment references establish family materials and approximate rhythms.
Individual balcony details, roof shapes and rear elevations remain
unconfirmed. The new Student Success Center and Music Building include
construction-era comparisons. PS3's Visitor Center storefront is modeled,
and internal garage circulation still lacks a verified comparison. Family
color atlases are shared as WebPs alongside their GLBs to avoid duplicated image
bytes and in-game GPU maps. Unique color atlases and normal atlases remain
embedded.

## Photo-only scope

The final [photo scope](photo-scope.json) records the kept footprints and every
reversion to `0ced19f`. The table above records the previous broad reference
survey. Group views and generic campus angles qualify only where a footprint
can be assigned. Unassigned University Village and Northside blocks and
web-only views are excluded. Callier main follows the requested scope and uses
its archive view. The [final audit](batch-results.md) links the fresh comparison
sheets and records the performance sample.
