// Destruction feature: breakable crates, barrels, fish racks, fences, lean-to huts, dock railings and rock stacks round
// every port, at the raider camp (127, -71) and rotten pilings / wreckage out on the shoals, simulated by src/physics
// (Rapier) when they break.
//
//   features.add( 'destruction', destruction );        // import * as destruction from './features/destruction/index.js'
//   const d = features.get( 'destruction' );
//   d.raycastSegment( ax, ay, az, bx, by, bz ) -> { t, id, x, y, z } | null      (cannonballs: test each flight segment)
//   d.impulse( x, y, z, radius, energy )        -> props broken                 (damage + push debris; energy in J)
//   d.nearProp( x, z, range ) -> id | null      d.breakProp( id, { energy, by } )   d.damage( id, energy, at, by )
//   d.info()   d.props   d.update( dt )   d.toJSON() / fromJSON() / reset() / dispose()
//
// Listens: cannonballImpact { x, y, z, vx, vy, vz, energy, hit, target } (hit 'prop' + target id: a direct hit),
//   explosion { x, y, z, radius, energy }, meleeHit { x, y, z, range, energy, by } (optional hook; without it the paddle's
//   contact is read off melee's combat state), planeCrashed { x, y, z, speed, mass }, remoteWorldEvent kinds propDestroyed
//   (idempotent; replay: true breaks it silently) and propRespawned (the server's timer).
// Emits: propDestroyed { id, kind, x, y, z, by, port (null at the camp and the shoals), site } and propRespawned { id, kind }.
//   Local destruction also goes to app.netsync?.sendWorldEvent( 'propDestroyed', { ..., respawn: seconds } ).
// Respawn: campaign / multiplayer after RESPAWN_HOURS in-game hours (never within 25 m of the player); sandbox: reset().
// Save: { v, hours, broken: [ [ id, respawnHour | null ] ] }.
// Options ( install( app, features, opts ) ): { physics: false, render: false, plan: [ ...planProps output ], maxBodies,
//   oceanHeight( x, z, t ) }.

import { Destruction } from './Destruction.js';

export function install( app, features, opts = {} ) {

	return new Destruction( app, features, opts );

}

export { Destruction, RESPAWN_HOURS, MELEE_ENERGY } from './Destruction.js';
export { KINDS, buildKind } from './Kinds.js';
export { planProps } from './Sites.js';

export default { install };
