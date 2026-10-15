# Start: Hyptile Island's own opening

## Why the old opening looked like Tidewater

Hyptile spawned exactly where Tidewater does (WORLD.start 53.6, -77, yaw PI): on the plank boardwalk at the pier
foot, looking straight down it to the white entrance arch with the painted fish sign, a blue stilt hut on the left
and PoorGoat's stand on the right. That is Tidewater's key art (`public/ui/keyart.jpg`), and the loading screen showed
that same picture with the same bottom-left wordmark layout. Village.js and Pier.js are unchanged from Tidewater.

## What changed

- Spawn: Jade Landing, a jade-roofed fisher's pavilion on a timber deck in the east corner of the bay under the
  headland (WORLD.landing). You start on the boardwalk just off its steps (WORLD.start 169, -68.29, yaw 2.25), looking west across the bay
  at the totem, the village and the pier under paper lanterns and bunting.
- Landmark: a carved jade-fish totem on the sand (three jade fish swimming round a lacquered pole, a leaping carp and
  a glowing pearl on top).
- Dressing: fish drying racks (north side), two striped hammocks (sea side), potted ti plants, coral / cream / jade
  palette, three lantern lights.
- Boardwalk: west along the back of the beach to the boathouse footpath (IslandShape PATHS 'east'), with bunting
  pole pairs. Harbour, stalls, Roid's yard, ports and the boat dock did not move; no terrain heights changed.
- Dress-over (Dressover.js): a jade tiled roof cap on the pier arch, two coral nobori banners by the pier steps,
  pennants on the stilt huts.
- Intro (Intro.js): first campaign start per save slot, a 4.4 s glide in from the bay, round the sea side of the
  pavilion to the player, with a title card. Never under ?bench / ?bg / ?nomenu. Any key skips.
- Loader (index.html): Hyptile key art (`public/ui/keyart/`, a closer crop of the menu art), jade glass card,
  stacked wordmark.

Files: `index.js` (feature module), `Landing.js`, `Dressover.js`, `Intro.js`, `Shapes.js`. Preview renders:
`node tools/start/preview.mjs <outPrefix> [views] [--night]`. Test: `node test/feature-start.mjs`.
