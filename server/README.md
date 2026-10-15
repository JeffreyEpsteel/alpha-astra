# Hyptile Island server (Colyseus)

Several players share one island: the server keeps the rooms, fans out everybody's state at 15 Hz (Colyseus schema
patches), relays chat, world events, shots and hits, keeps the island clock and, with `--universe`, a persistent world.
There is no server-side simulation: every browser runs the world, its own avatar and boat are authoritative, and the
room's host (the oldest connected player) runs the AI ships.

Since wave 4 (alpha) the transport is **Colyseus 0.18** (`@colyseus/core`, `@colyseus/ws-transport`, state in
`@colyseus/schema` 5), written to the official Colyseus agent skill (`.claude/skills/colyseus`): `defineServer` /
`defineRoom`, rooms with `state` / `messages` / `patchRate` as class properties, `schema()` with `t.*` builders,
`onDrop` → `allowReconnection` → `onReconnect` / `onLeave( client, code )`, `setTimestep` and room-clock timers. The
browser uses `@colyseus/sdk` 0.18 (`Client`, `Callbacks.get( room )`, its automatic reconnection). Game and server must
come from the same release: a 3.0-pre game cannot join a wave 4 server and vice versa.

| File | What |
| --- | --- |
| `index.mjs` | `startServer( opts )`, `/health`, the admin console, CLI (one server per process) |
| `rooms.mjs` | the `room` type (plain and crew rooms) and the `universe` type: join checks, host role, rides, messages |
| `schema.mjs` | the synchronized state: players, host, clock, the host's ships, moored boats |
| `universe.mjs` | the persistent universe on disk (captains, profiles + anti-cheat, world events, moored boats, market, chat, backups) |
| `testkit.mjs` | a plain-node test client (`wireClient( url )`) used by the tests |

## Run

```
node server/index.mjs                     # ws://0.0.0.0:8765/island (plus any /<room>, crews)
node server/index.mjs --port 9000 --host 127.0.0.1 --room-cap 8 --max-rooms 32
node server/index.mjs --universe hyptile --data server-data/hyptile --max-players 16 --backup-days 14
node server/index.mjs --reconnect-seconds 60   # how long a dropped player keeps their seat (0: none)
PORT=8765 node server/index.mjs           # env fallback for the port
```

`npm run server` does the first. One TCP port carries everything: `POST /matchmake/...` (Colyseus picks or creates the
room), the room WebSocket and `GET /health` (`{ ok, version, build, transport: 'colyseus', uptime, players, rooms, universe? }`;
`version` is the protocol, `build` the game commit from `BUILD_HASH`, 'dev' without one).
The log prints joins, drops, reconnects and leaves; Ctrl-C / `stop` / SIGTERM saves and closes every room. The console
reads stdin only when it is a terminal (`--console` forces it, `--no-console` turns it off).

## The shared universe (wave 15)

`Dockerfile`, `fly.toml` and `.github/workflows/deploy-universe.yml` run this server on Fly.io as the game's default
universe (`wss://hyptile-universe.fly.dev/universe`, docs/HOSTING.md): `--universe hyptile --data /data --max-players 24
--reconnect-seconds 120`, PORT 8080 behind Fly's TLS, the saves on a volume, one deploy per push to main with the commit in
`BUILD_HASH` (the game says "the universe is updating" while its own commit differs). With `--admin-token` / `ADMIN_TOKEN`
the HTTP routes `GET /admin/stats`, `POST /admin/save`, `POST /admin/backup` and `POST /admin/command { line }` (a console
command, not `stop`) answer `Authorization: Bearer <token>`; without one they are 404. The Blackwater `fort` is stored in
universe.json (`fort`, like `moored`) and put back into the room after a restart (`schema.restoreFort`: holder, claimant's
name, claims, game hours, batteries; the watch calm, `by` empty).

## Rooms

* `room` (joinOrCreate, filtered by name): `ws://host:8765/island` (default) or any path, lower-case `a-z 0-9 _ -`, up to
  32 characters. `--room-cap` players (16). An emptied room goes after 30 s; `island` stays.
* crews: `{ t: 'createCrew' }` reserves a fresh 6-letter code (1 per 3 s, 4 unused per address, `--max-rooms` 64 in
  all); the crew joins `ws://host:8765/<code>` (joinById). An unknown code is refused (`nocrew`); an unused one expires
  after 2 minutes.
* `universe` (joinById 'universe', created at start, never disposed: the clock and the respawn timers run with nobody
  online). See the persistent universe below.

The client side picks the room from the URL's last path segment; everything before it is the server's address, so a
TLS proxy may put the server under a prefix (`wss://island.example.com/net/universe`).

## Messages and state (`src/net/Protocol.js`)

The protocol's vocabulary is unchanged from 2.x; each `{ t, ...body }` is a Colyseus message of type `t`. The hello
(`{ v, name, character, boat, token?, probe? }`) is the join options. What changed is where some of it lives:

| In the schema state (15 Hz patches) | Read back by `src/net/ColyseusLink.js` as |
| --- | --- |
| `players[id]`: name, character, owned boat, captain, ride policy, `profile` (bumped by a hello), `seq` + the newest state (position, yaw, mode, boat transform, ride / seat, the other features' fields as JSON) | the `welcome` peers, `join` (new player or profile change), `leave`, `states { at, list }` |
| `host` | `host { id, prev }` |
| `clock` (every 10 s) | `clock { timeOfDay, timeSpeed, at, day?, seed? }` |
| `ships`, `shipsAt`, `shipsHost` (the host's `world`, 12 Hz at most) | `world { at, host, ships }` to everybody but the host |
| `moored` (universe) | (also announced as `boatMoored` / `boatUnmoored` events) |
| `wrecks['<owner>:<id>']`: kind (`sinking` / `boat` / `plane`), model, pose, `t`, `parts` (wave 11) | read directly by `src/features/netsync/WreckLink.js` |
| `planes['<owner>:<id>']`: kind (`stray` / `parked`), airframe, livery, upgrades, pose, throttle, `t` (wave 13) | read directly by `src/features/netsync/PlaneLink.js` |
| `fort`: the host's Blackwater (holder, claimant, claim count, game-hour times, alarm, guards, ships, `batteries[id]`) (wave 13) | read directly by `src/features/netsync/StrongholdLink.js` |

Messages: `hello` (a later one updates the profile), `state`, `chat`, `ping`/`pong`, `createCrew`/`crew`,
`ride`/`unride`/`ridePolicy` → `ride`/`unride`/`rideNo`/`policy`, `world`, `fx` (to the others, 30/s), `hit` (to the host,
clamped to 60, 20/s), `event` (to the others, 10/s; the universe persists the kinds in `WORLD_EVENT_RULES`), `save`
(universe, JSON text, 256 KB, 1 per 2 s) → `saved`, `market` (the host's, 1 per 5 s), `welcome`, `profile` (a probe's
answer), `error { code, text }`. The sanitizers of `Protocol.js` run on the server for every message; frames over 4 kB
are dropped (a save or a market snapshot may be bigger); 120 messages per second per client at most; the socket is
closed above 512 KB (1009).

Wave 11: `bump` (the host only: a remote boat's hull collision, forwarded to that boat's owner alone, near its boat, 10/s
per boat), `wreck` (`add` / `del` of the sender's own entries, 4 per player, 40 per room, 8 messages/s; dropped when the
owner leaves, kept over a reconnect), `fx` `ram` (from the host only). Fire rates (`Protocol.FireGate`): each cannon side
fires a volley of at most 6 balls within 1.2 s, then nothing for 1.5 s (a ship's side 3.5 s); a firearm `gunshot` event no
sooner than 0.8 x its reload after the last of that weapon; only the host fires balls that are not a player's (`o`).
The admin console's `wrecks` lists the entries.

Wave 13: `plane` (`set` / `del` of the sender's own entries, 3 per player, 48 per room, 14 messages/s; dropped when the
owner leaves, kept over a reconnect), `fort` (`set`: the host's snapshot, 10/s; `act`: a guest's hostile act forwarded to
the host alone as `fortAct`, 4/s, `hostile` 2/s; `claim`: granted once while the host says the island is undefended,
answered with `fortClaim`, 1 per 1.5 s; a host snapshot that has not seen the newest claim cannot hand the island back),
`ask` (a guest's request forwarded to the host alone, 4/s). Prop events (`propDestroyed`, `propRespawned`,
`propsRespawned { port, ids }`) have their own budget of 40/s; the universe stores a batched respawn like single ones and
its expiry of a broken prop carries the port. The admin console's `planes` and `fort` list them.

Refusals at join are Colyseus errors whose code is a `REFUSAL` number, all in the application range (Colyseus keeps
4000..4010): `full` 4101, `hello` 4102, `version` 4103, `rooms` 4104 (409 while a room is being created), `nocrew` 4105
(404 / 522), `name` 4106, `banned` 4107, `nouniverse` 4109, `badname` 4110, `token` 4111, `rate` 4113. After a join only
`banned` 4107, `replaced` 4108 and `kicked` 4112 arrive as close codes; `CloseCode.SERVER_SHUTDOWN` (4001) and
`FAILED_TO_RECONNECT` (4003) make the client join afresh after a pause.

**Reconnection.** A connection that drops (not a goodbye, not a page closing with 1001) keeps its seat
`--reconnect-seconds` (60): the player stays in the room with the same id, the host role passes on meanwhile, guests are
put ashore. The SDK reconnects the same `Room` by itself (`room.onDrop` / `room.onReconnect`, rooms up at least 1 s), so
the others see neither a leave nor a join; the server says `welcome` again and the client rebuilds its peers. After the
window it is a leave (a universe captain aboard leaves a moored boat) and `NetClient` joins afresh with backoff.

## Joining from the game

* `?server=ws://host:8765/island` in the page address (`host:port` or `host:port/room` also work; `wss://` from an https
  page), the Island / crew tab of the menu, or `?crew=abcdef`;
* the Universe tab: the address of a server started with `--universe` (see docs/HOSTING.md).

## Test

```
node test/net-protocol.mjs     # rooms, crews, rides, ships, fx / hits, limits (@colyseus/sdk clients)
node test/universe.mjs         # the persistent universe, NetClient + UniverseSession, a restart
node test/colyseus.mjs         # schema by reflection, 15 Hz patches, reconnection, replace, probe, restart on the same port
node test/feature-netsync.mjs  # two browser stacks: crews, a reconnect, rides, puppets, shots, hits, host migration
node test/server-w11.mjs       # wave 11 rules: bumps to the owner only, wreck entries, fire rates
node test/feature-netsync-w11.mjs  # two browser stacks: remote hull collisions, crew decks, rates, wrecks over a reconnect
node test/server-w13.mjs       # wave 13 rules: plane entries, the stronghold's claim once, acts / asks to the host, prop budget
node test/feature-netsync-w13.mjs  # two browser stacks: remote airframes, chute, stray -> wreck, parked, Blackwater, Tidemark
```

## The persistent universe

`--universe <name> [--data <dir>] [--max-players 16] [--backup-days 14]` keeps one always-running universe at
`ws://host:8765/universe` (universe.mjs): captains (name + sha256 of their browser token), their saved games, world events
with respawn timers, offline captains' moored boats, the market, chat and the pirates, written atomically to
`server-data/<name>/` every ~10 s and on shutdown, with daily backups. The console takes admin commands (`help`).
Hosting guide for players: docs/HOSTING.md; launcher: tools/host/HOST_UNIVERSE.cmd.

## Releases

The server needs its node_modules next to it. `node tools/host/pack-server-deps.mjs <release dir> --verify` copies the
dependency closure of `server/index.mjs` (about 105 packages, ~10 MB: Colyseus core + ws transport + schema, ws, express
and what they pull in) and starts the release's own server once to check it. `msgpackr-extract` brings a native
accelerator for the packing machine's platform; on another platform msgpackr runs without it.

## Ports and firewall

One TCP port (8765 by default) for matchmaking, the WebSocket and `/health`. Open it inbound on the host's firewall and,
for players outside the LAN, forward it or run the server on a small VPS. An https page needs `wss://`: put the server
behind a TLS proxy (docs/HOSTING.md section 6). One PC needs no Colyseus presence / Redis driver; those only matter for
several server processes, which the universe's JSON storage does not support anyway. Chat is plain text.

## Cars (wave 22A)

`cars` (host only, 8 a second at most, the frame cap, `sanitizeCars` in rooms.mjs): Meridian's traffic as lane codes and the
loose cars as poses (src/features/cars/CarNet.js), relayed to everybody else with the server's `at`; never stored. A guest's
`cars` is dropped. Players' cars ride their state (`car`, `oc`, `cw` extras); carTaken is a world event.
