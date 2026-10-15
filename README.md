# Alpha Astra

An independent version of **Hyptile Island**, based on the updated October 15 city build. The original game, repository and Pages site are separate.

- Play: https://jeffreyepsteel.github.io/alpha-astra/
- Source: https://github.com/JeffreyEpsteel/alpha-astra

## This version

- Transparent car windows and visible seats, dashboard, steering wheel and cabin trim.
- Stable city window lighting; both landmark skyscrapers support roof landings and can be destroyed and rebuilt.
- A free coastal rescue helicopter at the home harbour. Fly, hover, land on roofs, exit, repair and recover it. Other multiplayer pilots see its flight and parked position.
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

## Development and verification

```sh
npm run dev
npm run test:codex
npm run test:codex-network
```

The original test suite remains available as `npm test`; several original programs require native WebGPU/Dawn and are not plain headless CI tests. The Pages workflow runs the focused regression suite and production build from this repository's `main` branch. There is no inherited Fly.io deployment workflow.

See [release notes](docs/ALPHA_ASTRA.md), [credits](CREDITS.md) and [license](LICENSE). Original game authorship and asset licenses are retained. The nautical chart ornament was generated with ChatGPT Image; its prompt is in [the map asset record](docs/alpha-astra-map-prompt.txt). Terrain, markers and quest routes are drawn from live game data.
