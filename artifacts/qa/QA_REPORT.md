# QA report: UTD EMS Cart Simulator (2026-11-07)

## Result

**Not release-ready. Close for desktop; not ready for mobile.**

- **Build:** typecheck, the 55 unit tests and the production build all pass.
- **Desktop:** the production build loads and plays in Chrome on the GPU. Two blocking defects turned up in play and are now fixed: the cart sometimes would not move, and the driver's view was hazed.
- **Mobile:** the menu renders but there were no touch controls. Basic touch pads are now in but not yet re-tested.
- **Still open:** load time (23 s), JS heap (~1.3 GB), and High-quality frame rate on integrated graphics (31–34 FPS).

## How it was tested

- **Build:** `npx tsc --noEmit` passed. `npx vitest run` passed 55/55. `npx vite build` passed, with a 5.2 MB main chunk (1.9 MB gzipped) and a chunk-size warning.
- **Server:** the production preview (`npx vite preview --port 5188`), not the dev server.
- **Scripted playtest:** `artifacts/qa-playtest.mjs` runs Playwright with the installed Chrome. Windows blocks Playwright's own Chromium on this machine.
  - **GPU:** AMD Radeon 840M (D3D11), not software rendering, so the frame times count.
  - **Input:** real keyboard and mouse.
  - **Viewports:** desktop 1600×900 and a mobile 390×844 touch device at DPR 3.
  - **Output:** `artifacts/qa/report.json` plus screenshots `artifacts/qa/01–21*.png`.
- **Visual checks (dev harness):**
  - 12 side-by-sides against reference photos (`data/preview/cmp_*.png`).
  - 3 flicker sweeps (`data/preview/qa_fk_*_flick.png`).

## Defects

| # | Severity | Defect | Evidence | Status |
|---|---|---|---|---|
| 1 | **Blocker** | Holding W from rest after a reset did nothing for 5 s: the cart moved 0 m. The physics body falls asleep at rest, and engine force alone does not wake it. Steering input happened to wake it. | report.json, step "free-roam accelerate 5 s": moved 0 | **Fixed:** `golfCart.update` wakes the body on any input |
| 2 | **Major** | Driver view: the windshield was hazed beige and the "UNIVERSITY EMS · DIAL 911" banner read backwards. Both the banner and the glass were drawn double-sided. | `04-camera-driver.png` | **Fixed:** both outside-only (verified in `data/preview/qa2_inside.png` and `qa2_front.png`) |
| 3 | **Major (mobile)** | No touch controls, so the cart cannot be driven on a phone (a tap moved it 0 m). | report.json mobile step | **Partly fixed:** gas, brake and steer pads on touch screens; not yet re-tested on a device |
| 4 | Major | First load takes 23 s on desktop and 26 s on mobile. All chunks in view are built on the main thread before the menu works. | report.json `loadMs` | Open (issue #15: move chunk building to a worker) |
| 5 | Major | JS heap is about 1.0–1.36 GB. Likely to crash mobile Safari and low-memory devices. | report.json `heapMB` | Open |
| 6 | Minor | High quality runs 31–34 FPS (p95 48 ms) with 1,138 draw calls and 2.7 M triangles. Adaptive quality drops to Medium, which runs about 57–60 FPS (p95 19–25 ms, about 500 calls, 1.0 M triangles). | report.json | Open; the over-budget numbers are a known tradeoff |
| 7 | Minor | Two 404s in the console. | report.json | The favicon is now inline; the second 404 was not identified |
| 8 | Minor | Console warning: "PCFSoftShadowMap has been removed". | report.json | **Fixed** |
| 9 | Minor | With the lights on, the red roof-LED glow shows as a red band across the top of the windshield in the driver's view. | `qa2_inside.png` | Open |
| 10 | Minor | Mobile menu: the panel (358×804) needs scrolling to reach the options; there is no horizontal overflow. | `20-mobile-menu.png` | Acceptable |
| 11 | Info | F1 help did not open under automation, probably because the browser reserves F1 in automated sessions. Help also opens with `/`. | report.json | Check by hand |

## Gameplay and feel

- **Driving:** with steering held the cart reached 7.3 mph within 2.5 s, and 14.8 mph at top speed in the route run. One brake press went from +7 mph to −7 mph in 1.5 s, meaning it slid straight into reverse. That's the arcade mapping (issue #14) and feels abrupt; consider a short hold before reverse engages.
- **Route Challenge:**
  - Starts and shows the countdown, the objective panel, the off-network warning, and the "Collision −100" event.
  - The destination beam option works.
  - A naive bot steering straight at the beacon reached 449 m out in 60 s but got stuck 13 times on buildings. That shows walls and collisions work; it says nothing about difficulty.
  - I didn't drive a run to completion with a route-following bot. The unit tests cover finishing a run and multi-stop scoring.
- **Collisions:** driving into the nearest building registered one −100 collision, and the cart stayed upright.
- **Multi-stop:** "Stop 1 of 4" started correctly.
- **Destination picker:** 149 destinations, including 20 parking lots. No Northside or Waterview entries.
- **Stability:** 60 s of continuous driving in circles. FPS held (56.7 before, 60.7 after), the heap did not grow (1,026 → 1,016 MB), and there were no errors.
- **Night and resize:** night mode renders at 58 FPS. Resizing the window is handled (canvas 768×480 at 1024×640, so the DPR cap applied).
- **Audio:** the Web Audio context is available. Audio output can't be judged under automation, so the siren and horn need a listen by hand.

## Comparison with reference photos (12 buildings)

| Building | Match | Main gaps |
|---|---|---|
| Andromeda Hall | Good | Massing and the brick and tan bays match; missing the curved glass entrance canopy |
| Sciences Building | Fair | The limestone colour matches; missing the timber soffit overhang and the stone banding texture |
| Parking Structure 4 | Fair–good | The fin screen reads right; missing the wavy pattern and the dark glass stair tower |
| NSERL | Fair | Blue/violet panels present; missing the stone colonnade base and glass stair bay; too boxy |
| ATEC (Arts & Technology) | Weak | Shows as a flat glass box; missing the huge sloped cantilever roof |
| Founders Building | Fair | Glass and fins present; missing the big sloping roof plane |
| Student Services Building | Fair | Glass box is right; a dark blank wall (the Addition) dominates the view; missing the sunshades |
| Callier Center Richardson | Weak | Orange-trimmed windows only; missing the orange screened balcony, the red stair and the silver ribbed cladding |
| McDermott Library | Weak | The comparison camera ended up under the Plinth canopy; needs a better viewpoint and the ribbed upper facade |
| Student Union | Weak | The camera viewpoint is under a canopy; the timber steps and terrace aren't visible from this angle |
| Administration Building | Fair | Tan banded massing is right; the pyramid lantern was removed at your request (the photo shows one) |
| Comets LANding | n/a | The reference photo is an interior shot; the exterior follows your description |

Overall, colour, lighting and vegetation now read as a warm, plausible campus. The biggest remaining realism gap is signature architecture: the sloped roofs, cantilevers and screens on ATEC, Founders, Callier and the Library. Those need modelling, not texture work.

## Flicker

- **Plinth:** 7 flagged blocks.
- **Spawn and the tree-lined walkway:** many flagged blocks, but only on grass and leaves within about 3 m of the camera. That comes from high-frequency texture detail moving between the two renders, not from z-fighting.
- **Buildings:** no building surfaces were flagged.

## Release checklist

- **Base path:** `base: './'` (relative), so the build works from any static host sub-path.
- **Debug gating:** the debug harness loads only in development builds (`import.meta.env.DEV`). The `/__capture` endpoint exists only on the dev server. `window.__sim` is still exposed in production; that's harmless but worth gating.
- **Secrets:** no API keys in client code.
- **Deploy:** run `npm run build`, then upload `dist/` to any static host.
- **Risks:** load time, memory, the 5.2 MB main bundle, and mobile not yet re-verified.
