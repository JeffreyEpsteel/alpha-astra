# Alpha Astra — October 15, 2026

Independent copy of the current Hyptile Island city build. Original source remains untouched. New repository: JeffreyEpsteel/alpha-astra.

## Repair details

Car GLBs used opaque atlas faces for windows and lacked cabin geometry. Glass is separated into a transparent pass, cabin caps are opened, and seats, dash, wheel, floor and trim are present. All seven models have themed interiors, live speed/gear/RPM/condition instruments, moving steering and pedals, and physical switches with an accessible dashboard on `3`. Engine, parking brake, lamps, horn and police siren controls affect actual vehicle behavior. Gear and RPM are arcade driving readouts; cars do not acquire a new fuel simulation.

Each type has a distinct instrument layout and physical cabin details: wood and analog gauges for the sedan, a taxi driver display, police status and siren controls, a utility pickup console, compact van instruments, a sports tachometer and bucket-seat trim, and a broad transit console for the bus. The van cluster is raised and narrowed to keep its numeric gauges visible in the normal driving view. Opening a map or another modal prevents hidden dashboard buttons from changing vehicle state.

Facade windows now use flat integer building identity and stable integer hashing instead of interpolated floating-point identity. Both landmark towers have finite destruction health, staged damage, collapse, debris, reset and replication. Roof collision respects the actual footprint, rooftop plant/pavilion and antenna. Authoritative collapse removes support immediately, including while its visual animation is queued.

The helicopter has assisted flight, rotor animation, synthesized positional rotor sound, collision, rooftop landing, damage, repair, safe exit and persistent parking. Its native flight deck displays rotor speed, attitude, heading, altitude, height above ground, vertical speed and hull warnings. Physical switches and the `3` systems tray control turbine startup, avionics, position hold and actual navigation/landing/search/cabin lights. Cyclic, collective and pedals move with input. Restoring a saved destroyed roof safely returns unsupported parking to the home pad. Resetting a session never writes over loaded progress. Incremental network updates preserve unchanged remote helicopters; complete membership snapshots remove disconnected owners and carry lighting state.

The Swift trainer and twin-engine Meridian Courier are available at marked Meridian airport stands. Both reuse the existing airplane cockpit and flight systems, with distinct wings/tails and the Courier's twin-engine controls. `E` collects a personal aircraft; its stand recovers, repairs and refuels it. Taxi lines lead to the runway. Airport service preserves upgrades and cargo; cargo transfers use the airport's actual port. Assigned stands remain stable through peer joins and disconnects and avoid observed aircraft.

The quest journal combines active stories, notices/bounties and fishing orders. Selecting an objective shows progress, tracking and its real map target. Objectives without a fixed location say so. The map includes live helicopter and player markers and an AI-generated nautical border with a coordinate grid.

## Verification and limits

Focused regressions cover city geometry/collapse, cockpit controls, helicopter physics and save restoration, airport collection/service/taxi/takeoff, keyboard/touch state, quest tracking, multiplayer restrictions and separate browser storage. Real two-client Colyseus tests verify helicopter pose and lighting transport and authoritative world-event restrictions. A broader inherited test pass recorded 86 passing programs, 10 GPU-dependent programs skipped and one deployment fixture blocked by the local test environment. The spyglass key conflict is fixed, and a bounded shader compilation queue permits two fresh rendered clients to start reliably.

Rendered Chrome WebGPU checks use fresh browser contexts and documented placement fixtures with real flight controls. These are targeted gameplay checks, not an exhaustive performance or Internet multiplayer certification. Original broad GPU benchmark suites were not all rerun. Mobile logic/layout tests run, but physical phone testing is still needed. Existing multiplayer economy/client-trust architecture is retained; this is not a complete anti-cheat system. Helicopter pads and airport stands avoid observed peers, but simultaneous unseen clients can choose the same slot before their state is advertised; reservation is not server-atomic.

Final cockpit/airport acceptance: 51 car checks across seven types, 17 helicopter checks and 13 airport flight checks passed with no JavaScript/WebGPU errors. The final helicopter check verified the raised canopy and removed legacy gauges in the loaded build, physical switch clicks, pointer release, engine restart, real light sources, measured Web Audio output, takeoff, hover hold, landing and exit. Both new planes took off from their actual stands using keyboard taxi and flight controls.

Reviewed screenshots: [helicopter flight deck](alpha-astra-screenshots/helicopter.png), [sedan](alpha-astra-screenshots/car-interior.png), [sports car](alpha-astra-screenshots/sports-interior.png), [bus](alpha-astra-screenshots/bus-interior.png), [Courier cockpit](alpha-astra-screenshots/courier-cockpit.png), [Swift in flight](alpha-astra-screenshots/swift-flight.png), [navigation map](alpha-astra-screenshots/map.png).

The local multiplayer launcher uses its own loopback server and persistent state. GitHub Pages cannot host that server. A public secure multiplayer host must be configured separately. No original universe deployment or save storage is reused.

## Art and reference use

The nautical ornament was generated through the built-in ChatGPT Image tool and integrated over accurate game terrain. The user-provided Cherkasy Drive project was inspected for interaction and presentation ideas; its code and assets were not copied into this build. Existing Hyptile and third-party attributions remain in CREDITS.md and per-asset credit files.
