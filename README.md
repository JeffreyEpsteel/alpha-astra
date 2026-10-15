# Alpha Astra

An independent version of **Hyptile Island**, based on the updated October 15 city build. The original game, repository and Pages site are separate.

- Play: https://jeffreyepsteel.github.io/alpha-astra/
- Source: https://github.com/JeffreyEpsteel/alpha-astra

## This version

- Transparent car windows and seven distinct interiors: sedan, taxi, police, pickup, van, sports car and bus. Each has its own dashboard design and cabin details, live instruments, moving steering wheel and working controls.
- Stable city window lighting; both landmark skyscrapers support roof landings and can be destroyed and rebuilt.
- A free coastal rescue helicopter at the home harbour with a live flight deck, engine startup, lighting and hover hold. Fly, land on roofs, exit, repair and recover it. Other multiplayer pilots see its flight and parked position.
- Two additional airport aircraft: the Swift trainer and twin-engine Meridian Courier. Collect them at marked stands, use their existing airplane cockpit systems, and return to the stands for service.
- A selectable quest journal (`J`), tracked objectives and map focus, plus an illustrated navigation chart (`M`). The map's terrain and quest coordinates come from the actual game.
- Multiplayer hides local save/load and sandbox world controls. Connecting from solo loads a separate multiplayer profile. World destruction and respawn messages enforce host authority.
- Separate `alpha-astra` browser save/settings keys, including on GitHub Pages. Existing Hyptile saves are not imported automatically; compatible exported saves can be imported explicitly in solo play.

## Play locally

Requires Node.js 22 or newer and Chrome/Edge with WebGPU.

```sh
npm ci
npm run build
```

On Windows run `PLAY_CODEX.cmd`. It opens this build on `http://127.0.0.1:5195/`. The launcher reuses only its own verified background service. Logs and process receipts are in `runtime/codex-launcher/`.

Run `HOST_CODEX_MULTIPLAYER.cmd` for a separate local persistent universe on `127.0.0.1:8875`. Saves stay in `server-data/codex-candidate/`. This loopback host supports multiple local browser profiles; it is not a public Internet server.

**The Pages site supports solo play.** Public multiplayer requires an Alpha Astra-compatible host with a secure WebSocket address entered in the menu. This repository has no default public server and never automatically connects to the original game's universe. Hosting costs and a public server have not been provisioned.

## Helicopter

Board near the home helipad with `E`. Use `Shift` to rise, `C` to descend, `W/S` to move forward/backward, `A/D` to turn, `,/.` to strafe, and `Space` to brake/hover. `V` selects cockpit/chase view. `E` exits only after landing and stopping. A service pedestal at the home pad recovers and repairs the aircraft. F1 lists keyboard and touch controls.

Boarding starts the turbine automatically; wait for green rotor RPM. `3` opens the systems tray, or aim at a physical switch and click in cockpit view. `O` starts/stops the turbine, `U` controls avionics, `Y` holds position and altitude, `N` toggles navigation lights, and `;` toggles the landing light. Shutdown is guarded while airborne. The searchlight follows your cockpit view. On touch screens use **Cockpit**.

## Car interiors and airport aircraft

In a car, use `V` for the driver view and `3` for dashboard controls (**Dash** on touch). The live panel shows speed, automatic gear, RPM and condition. Its switches operate the engine, parking brake, headlights, horn and police siren where fitted. Steering wheel and pedals follow driving input. `L` changes headlights; `H` sounds the horn.

At Meridian airport, collect the Swift trainer or twin-engine Meridian Courier with `E` beside its marked stand. They are free personal aircraft with their own fleet records. The same stands recover, repair and refuel them. Follow the yellow taxi line to the runway, then turn toward its longer end. `O` starts the engine; `Shift/C` change throttle, `A/D` steer or bank, `S` raises the nose, `V` selects cockpit view, and `3` opens cockpit switches. Both have wheel brakes and the original airplane systems; the Courier has separate engine instruments and feather/restart switches. Airport pickup markers appear on the map once Meridian is discovered.

## Development and verification

```sh
npm run dev
npm run test:codex
npm run test:codex-network
```

`npm test` runs the portable focused regressions used by the Pages workflow. `npm run test:legacy` retains the original project's test command as a historical reference; some programs require native WebGPU/Dawn, original authoring fixtures or retired Fly deployment files and are not portable CI tests. The Pages workflow builds from this repository's `main` branch. There is no inherited Fly.io deployment workflow.

See [release notes](docs/ALPHA_ASTRA.md), [credits](CREDITS.md) and [license](LICENSE). Original game authorship and asset licenses are retained. The nautical chart ornament was generated with ChatGPT Image; its prompt is in [the map asset record](docs/alpha-astra-map-prompt.txt). Terrain, markers and quest routes are drawn from live game data.
