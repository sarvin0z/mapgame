# Design

<!-- Written after the build from src/style.css, index.html and src/ui/*.ts (2026-11-07). The build is the authority; update this when the build changes. -->

## World

Campus dispatch wayfinding. Every screen reads like the UEMR crew's dispatch board crossed with campus signage. A call is a card with a type, a place, a code, a distance and a drive time. In play, one band says where to go and how far. Panels are warm, dark, near-opaque glass laid over the live 3D campus, which stays visible around them.

## Palette (CSS custom properties in `src/style.css`)

| Token | Value | Role |
|---|---|---|
| `--ground` | rgba(18, 16, 14, 0.86) | Panel ground (with 14px backdrop blur, only to keep text legible over the moving 3D) |
| `--ground-soft` | rgba(18, 16, 14, 0.66) | Small HUD controls |
| `--raise` / `--raise-hi` | rgba(255, 244, 230, 0.05 / 0.09) | Items and hover inside panels |
| `--line` | rgba(255, 240, 220, 0.12) | Hairlines and panel edges |
| `--fg` / `--muted` / `--faint` | #f4f1ec / #b0a89e / #857d74 | Text, secondary text, tertiary text (warm greys, never cool) |
| `--orange` / `--orange-hi` | #e87500 / #ff8a1f | UTD orange: the one action, the selected item, the followed destination, an active cart control |
| `--orange-ink` | #1a0d00 | Text on orange |
| `--green` | #3fb27f | Arrival, good conduct, the best route |
| `--red` | #ff5a4a | Call icons and misses. The medical cross tile is #c8102e |

Rule: orange marks only what to act on or what is being followed. Never use it for decoration.

## Type

- **Display:** Barlow 600/700, a grotesk drawn after US highway signage. Use it for headings, call names, every number read at a glance (speed, time, distance, score) and control labels.
- **Body:** Inter 400/500/600.
- **Numbers:** always `font-variant-numeric: tabular-nums`.
- **Sizes:** speed 56, grade 64, countdown 150, view title 34, result title 28, call type 17–22, body 13.5–14, captions 11.5–12.5. Nothing under 11px.

## Shape and depth

- **Radii:** panel 16, item 10, thumbnails 6. The thumbnail sits inside an item with an 8px inset, and the brief photo has a 10px inset.
- **Shadow:** one depth recipe, `--shadow`: an inset top highlight plus an offset soft drop. Never a coloured glow.
- **Image outlines:** content images get a 1px white outline at 10% opacity, inset by 1px.

## Components

- **Dispatch shell:** a nav column (wordmark, Resume, Dispatch, Free roam, Settings, Controls), a board (title, tabs with an orange underline, list) and a brief panel. Below 1100px the brief moves under the board; below 760px everything stacks.
- **Call card:** a 128×76 photo of the destination rendered from the game, then the call type with its icon, place, dispatch note, and distance, time and difficulty with icons. The selected card gets a 12% orange wash and an orange 1px border.
- **Brief:** a 16:9 photo with the title over a bottom scrim, the dispatch note, four facts (distance, estimated drive, difficulty, code), objectives, assist switches with their score cost, and a full-width orange Start button.
- **HUD:**
  - unit badge (Available/Responding) top left;
  - compass strip with an orange needle and red destination pin, top centre;
  - call card (type, place and code, time, to go, driven, stop label, off-network warning) top right;
  - circular minimap bottom left;
  - 44px icon control buttons, the speedometer with an orange arc, and D/R gear tiles, bottom right.
- **Menu button:** an orange button labelled MENU with a menu icon, at the top left on every device; it opens dispatch.
- **Touch layout (any coarse pointer):**
  - Menu as a 48px pill top left;
  - a place band top centre (pin, place name, and distance left while responding);
  - the map as a rounded square, beside a column of 46×44 cart buttons (sound, lights, siren, horn, headlights) top right;
  - an analog stick bottom left (an orange knob on a dark glass base) that springs back to centre over 220ms on release;
  - a speed pill bottom right (gauge icon, MPH, and an R tile in reverse).
  - The desktop unit badge, compass, call card and speedometer are not shown.
- **Loading:** the wordmark, a 4px progress bar with the percentage beside it, the graphics choice (five options and a Start button), and a credit line in faint 11.5px at the bottom right.
- **Result:** a stats table, a grade ring that fills to the score, a performance checklist (green check or red miss), the route map, and actions (Back to dispatch, Retry, Next call).

## Icons

One authored SVG sprite in `index.html`: a 24 grid, 1.75px stroke, round caps and joins, `currentColor`. The cross and play icons are filled. Don't add glyph or emoji icons.

## Motion

- **Easing:** `--ease-out` cubic-bezier(0.23, 1, 0.32, 1).
- **Entrances (menu open, result):** opacity, 4px blur and a 12px rise over 300ms, staggered 100ms by column.
- **Brief swap:** 220ms.
- **Board updates:** the call card on a new stop, and traffic events, flip down from a −70° rotateX over 240ms, like a dispatch board.
- **Countdown tick:** 300ms.
- **Grade ring:** fills over 900ms once.
- **Presses:** scale to 0.96 over 150ms.
- **Hover:** only under `(hover: hover)`.
- **Reduced motion:** every movement becomes a 200ms fade.
- **HUD readouts:** never animate.

## Brand

The UTD monogram loads from `public/brand/utd-monogram.svg`, which the user will supply. Until then the orange tile shows a typeset "UTD" in Barlow.
