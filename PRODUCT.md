# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Members of UT Dallas University Emergency Medical Response (UEMR), the student EMS crew that responds on campus in a lifted emergency golf cart. They use the sim to learn campus routes and response driving: which roads, walks and lots reach each building, how to keep to the network, stop at signs, ease over bumps and warn pedestrians with horn and siren. (Confirmed by the user, 2026-11-07.)

## Product Purpose

A faithful, drivable recreation of the UT Dallas campus (OSM, USGS elevation, reference photos) in the browser, with the UEMR cart. Route Challenge runs dispatch the crew to a building or named parking lot, single or as a multi-stop gauntlet, and score route efficiency, pace, staying on roads and walks, traffic conduct, pedestrian contacts and collisions. Success: a crew member gets faster and cleaner at reaching real campus locations.

## Positioning

The actual UTD campus at its real scale and layout, with the actual UEMR cart and real campus rules of the road. Nothing here is a generic city.

## Capabilities and terminology

- Modes: Free Roam; Route Challenge (Random, Choose, Multi-stop). Deploy from the UEMR apartment (University Village Building 11) or Safety and Grounds.
- Runs carry a dispatch **call type** as flavor (for example Medical Assist, Fall Injury, Event Standby) with a short dispatch line. Gameplay remains routing and scoring; there is no XP, rank or patient-care step yet. (User decision, 2026-11-07.)
- Assists that cost score: best route shown, destination beam.
- Cart controls: emergency lights, siren, horn (momentary), headlights, location card, camera.

## Brand commitments

- UT Dallas orange and green; "UTD EMS" naming.
- The user approved use of the UTD monogram; the official artwork is to be supplied by the user. Until then the UI uses a typographic stand-in and a slot for `public/brand/utd-monogram.svg`. (2026-11-07.)
- Map and data attribution (OpenStreetMap, USGS 3DEP, Meta/WRI canopy) must stay visible.

## Constraints

- Static site (Vite build, relative base); desktop keyboard first, touch pads on phones.
- No invented geography; the user's site corrections override OSM.
