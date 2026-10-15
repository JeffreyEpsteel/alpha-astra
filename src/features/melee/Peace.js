import { WORLD } from '../../world/WorldLayout.js';

// The peaceful home waters: the whole home island, its harbour and the bay out past the reef. Nobody starts a
// fight in here - no raiders (melee), no retaliation raids (pirates/Retaliation.js), no pirate ship comes in
// (naval/Brains.js steers them out) and no hostile boarding (boarding/Hostile.js). The melee tutorial stays
// reachable at the training post on the harbour beach (Dummy.js), where sparring never hurts.
//
//   inPeace( x, z, pad = 0 )   -> bool     peaceZone() -> { x, z, r } | null (read live: WORLD.islands may grow)
//   beyondReef( x, z )         -> bool     the reef line hostile boarding must be past (the zone's own edge)
//   peaceExit( x, z )          -> heading (rad, naval convention: forward = ( sin, cos )) straight out of the zone
//
// The zone is a circle on the home island's centre: SHRINK of its radius (560 m) puts the edge ~230 m off the
// beach (z ~ 190 at the harbour), well past the reef (z <= 116), short of the merchant lane's (100, 230) bend
// and of every outer island and patrol lane (test/feature-combat.mjs checks them all).

export const PEACE = { shrink: 0.93, pad: 60 };

let _cache = null, _src = null;

export function peaceZone() {

	const home = ( WORLD.islands || [] ).find( ( i ) => i && i.id === 'home' );
	if ( ! home || ! home.center ) return null;
	if ( _src !== home ) {

		_src = home;
		_cache = { x: home.center.x, z: home.center.z, r: home.radius * PEACE.shrink };

	}

	return _cache;

}

export function inPeace( x, z, pad = 0 ) {

	const p = peaceZone();
	if ( ! p || ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return false;
	return Math.hypot( x - p.x, z - p.z ) < p.r + pad;

}

export const beyondReef = ( x, z ) => ! inPeace( x, z );

// how far inside (+) or outside (-) the edge a point is
export function peaceDepth( x, z ) {

	const p = peaceZone();
	return p ? p.r - Math.hypot( x - p.x, z - p.z ) : - Infinity;

}

export function peaceExit( x, z ) {

	const p = peaceZone();
	if ( ! p ) return 0;
	return Math.atan2( x - p.x, z - p.z );

}
