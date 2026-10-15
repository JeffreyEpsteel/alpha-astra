# Alpha Astra — October 15, 2026

Independent copy of the current Hyptile Island city build. Original source remains untouched. New repository: JeffreyEpsteel/alpha-astra.

## Repair details

Car GLBs used opaque atlas faces for windows and lacked cabin geometry. Glass is separated into a transparent pass, cabin caps are opened, and seats, dash, wheel, floor and trim are present. Regression rays cover the seven bundled car models.

Facade windows now use flat integer building identity and stable integer hashing instead of interpolated floating-point identity. Both landmark towers have finite destruction health, staged damage, collapse, debris, reset and replication. Roof collision respects the actual footprint, rooftop plant/pavilion and antenna. Authoritative collapse removes support immediately, including while its visual animation is queued.

The helicopter has assisted flight, rotor animation, cockpit instruments, synthesized positional rotor sound, collision, rooftop landing, damage, repair, safe exit and persistent parking. Restoring a saved destroyed roof safely returns unsupported parking to the home pad. Resetting a session never writes over loaded progress. Incremental network updates preserve unchanged remote helicopters; complete membership snapshots remove disconnected owners.

The quest journal combines active stories, notices/bounties and fishing orders. Selecting an objective shows progress, tracking and its real map target. Objectives without a fixed location say so. The map includes live helicopter and player markers and an AI-generated nautical border with a coordinate grid.

## Verification and limits

Focused regressions cover city geometry/collapse, helicopter physics and save restoration, keyboard/touch state, quest tracking, multiplayer restrictions and separate browser storage. Real two-client Colyseus tests verify helicopter pose transport and authoritative world-event restrictions. A broader inherited test pass recorded 86 passing programs, 10 GPU-dependent programs skipped and one deployment fixture blocked by the local test environment.

Rendered Chrome WebGPU checks use fresh browser contexts and documented placement fixtures with real flight controls. These are targeted gameplay checks, not an exhaustive performance or Internet multiplayer certification. Original broad GPU benchmark suites were not all rerun. Mobile logic/layout tests run, but physical phone testing is still needed. Existing multiplayer economy/client-trust architecture is retained; this is not a complete anti-cheat system. Helicopter home-pad assignment is deterministic with peer conflict avoidance; simultaneous joins can briefly choose the same unreserved slot.

The local multiplayer launcher uses its own loopback server and persistent state. GitHub Pages cannot host that server. A public secure multiplayer host must be configured separately. No original universe deployment or save storage is reused.

## Art and reference use

The nautical ornament was generated through the built-in ChatGPT Image tool and integrated over accurate game terrain. The user-provided Cherkasy Drive project was inspected for interaction and presentation ideas; its code and assets were not copied into this build. Existing Hyptile and third-party attributions remain in CREDITS.md and per-asset credit files.
