// Sea lanes of the naval feature (world metres, y up, +z south; WorldLayout.js and TerrainData.js are the
// ground truth: test/feature-naval.mjs checks every leg against the heightmap).
//
// MERCHANT_ROUTE: the trading lane between the home harbour and Pons Cove. The pier head (WORLD.boatDock) is
// too shallow for a 16 m trawler, so she lies at the harbour anchorage 45 m off it (5.9 m of water) and at the
// Pons roads 75 m off the cove's dock (the dock pocket itself is 1-2 m deep). The lane bends through (100, 230)
// and (150, 500): the straight line would run through the east sea stacks (298, 252) and the shoals around them.
//
// PATROLS: closed loops in deep water (5+ m deep over the whole leg and 20 m to either side), clear of both ports:
// one across the heightmap's south band between home and Blackwater, the rest round Blackwater on its own terrain tile.
// SAFE_ZONES: pirates will not fight inside them.
//
// Wave 15C, the calm waters (the user: "better placement of pirates, further away than the starting point"):
//   CALM.home m round Jade Landing (WORLD.landing) and the home dock (WORLD.boatDock) and CALM.port m round every other port's
//   dock (WORLD.ports, read live) are calm: no pirate spawns, hunts or fires inside them, and one heading in turns along the
//   edge (Brains.keepOut). SAFE_ZONES holds the home pair and Pons (static, as before); inSafeZone( x, z ) with no list adds
//   the other ports' circles (calmZones()). Spawns for hunts and raids never come inside CALM.spawn m of home (nearHome).
//   Lane 0 runs 600+ m south of the pier head and Jade Landing, so the first pirate is met past the reef and the home calm.

import { WORLD } from '../../world/WorldLayout.js';
import { dist2 } from './util.js';

export const HARBOUR_ANCHORAGE = [ 80, 80 ];
export const PONS_ROADS = [ 452, 452 ];

export const MERCHANT_ROUTE = [ HARBOUR_ANCHORAGE, [ 100, 230 ], [ 150, 500 ], PONS_ROADS ];

// Lane 0 patrols the heightmap's south band (z 380-930, between the home island and Blackwater, 300+ m clear of the
// Inverted Isles and Pons): pirates still meet the player on the way south. The others circle Blackwater (wave 14D: on its
// own terrain tile at WORLD.blackwater.center) in its deep water, as offsets from the island's centre so they move with
// it: north across the approach from home, east past the entrance, south, and west under the summit.
const BW = WORLD.blackwater.center;
const round = ( pts ) => pts.map( ( [ dx, dz ] ) => [ Math.round( BW.x + dx ), Math.round( BW.z + dz ) ] );
// (wave 15C: 600+ m off the pier head and Jade Landing at every waypoint, 600+ m at every leg; 280+ m off the Inverted Isles' dock)
export const SOUTH_BAND_PATROL = [ [ - 200, 640 ], [ 180, 640 ], [ 320, 780 ], [ 120, 960 ], [ - 220, 920 ], [ - 300, 780 ] ];
export const BLACKWATER_PATROLS = [
	SOUTH_BAND_PATROL,
	round( [ [ - 205, - 308 ], [ 255, - 248 ], [ 115, - 293 ], [ - 5, - 263 ] ] ),
	round( [ [ 295, - 258 ], [ 385, - 128 ], [ 375, 72 ], [ 215, 262 ], [ 355, 212 ], [ 435, - 48 ], [ 395, - 218 ] ] ),
	round( [ [ - 275, 242 ], [ - 5, 302 ], [ 295, 262 ], [ 15, 262 ] ] ),
	round( [ [ - 300, - 230 ], [ - 390, - 20 ], [ - 330, 230 ], [ - 420, 90 ] ] ),
];

export const PATROLS = BLACKWATER_PATROLS;

// the calm radii (m): round Jade Landing and the home dock, round every other port's dock, and how far from home a hunt or a
// raid may appear
export const CALM = { home: 450, port: 250, spawn: 600 };

// pirates break off and merchants are safe inside these (Jade Landing, the home harbour and the cove)
export const SAFE_ZONES = [
	{ id: 'landing', x: WORLD.landing.center.x, z: WORLD.landing.center.z, r: CALM.home },
	{ id: 'harbour', x: WORLD.boatDock.position.x, z: WORLD.boatDock.position.z, r: CALM.home },
	{ id: 'pons', x: WORLD.pons.dock.position.x, z: WORLD.pons.dock.position.z, r: CALM.port },
];

// every other port's dock (WORLD.ports grows: rebuilt when its length changes)
let _ports = [], _portsN = - 1;
export function calmZones() {

	const P = WORLD.ports || [];
	if ( P.length !== _portsN ) {

		_portsN = P.length;
		_ports = P.filter( ( p ) => p && p.id !== 'home' && p.id !== 'pons' && p.dock && p.dock.position )
			.map( ( p ) => ( { id: p.id, x: p.dock.position.x, z: p.dock.position.z, r: CALM.port, port: true } ) );

	}

	return _ports;

}

// the zone (x, z) lies in (pad metres added to every radius), or null; with no list: SAFE_ZONES, then every port's calm circle
export function inSafeZone( x, z, zones = null, pad = 0 ) {

	for ( const s of zones || SAFE_ZONES ) if ( dist2( x, z, s.x, s.z ) < s.r + pad ) return s;
	if ( ! zones ) for ( const s of calmZones() ) if ( dist2( x, z, s.x, s.z ) < s.r + pad ) return s;
	return null;

}

// within r of Jade Landing or the home dock (no hunt or raid appears there)
export function nearHome( x, z, r = CALM.spawn ) {

	return dist2( x, z, WORLD.landing.center.x, WORLD.landing.center.z ) < r || dist2( x, z, WORLD.boatDock.position.x, WORLD.boatDock.position.z ) < r;

}

// heading (naval convention: forward = ( sin, cos )) straight out of the calm zone that holds (x, z), or of the nearest one
export function calmExit( x, z, pad = 0 ) {

	const s = inSafeZone( x, z, null, pad );
	if ( s ) return Math.atan2( x - s.x, z - s.z );
	let best = SAFE_ZONES[ 0 ], bd = Infinity;
	for ( const q of [ ...SAFE_ZONES, ...calmZones() ] ) {

		const d = dist2( x, z, q.x, q.z ) - q.r;
		if ( d < bd ) { bd = d; best = q; }

	}

	return Math.atan2( x - best.x, z - best.z );

}

// index of the point of a route nearest to (x, z)
export function nearestIndex( points, x, z ) {

	let best = 0, bd = Infinity;
	for ( let i = 0; i < points.length; i ++ ) {

		const d = dist2( x, z, points[ i ][ 0 ], points[ i ][ 1 ] );
		if ( d < bd ) { bd = d; best = i; }

	}

	return best;

}

// the legs of a route as [ a, b ] pairs (a loop closes back to the first point)
export function legs( points, loop = false ) {

	const out = [];
	for ( let i = 0; i < points.length - 1; i ++ ) out.push( [ points[ i ], points[ i + 1 ] ] );
	if ( loop && points.length > 2 ) out.push( [ points[ points.length - 1 ], points[ 0 ] ] );
	return out;

}

export function routeLength( points, loop = false ) {

	let l = 0;
	for ( const [ a, b ] of legs( points, loop ) ) l += dist2( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] );
	return l;

}

// a route cursor: { points, index, dir, loop }. next() advances after reaching the current point and returns
// 'end' when a ping-pong route turned around at an end, else null.
export function makeCursor( points, { loop = false, index = 0, dir = 1 } = {} ) {

	return { points, loop, index, dir };

}

export function advance( cur ) {

	const n = cur.points.length;
	if ( cur.loop ) {

		cur.index = ( cur.index + 1 ) % n;
		return null;

	}

	let next = cur.index + cur.dir;
	let ev = null;
	if ( next >= n || next < 0 ) {

		cur.dir = - cur.dir;
		next = cur.index + cur.dir;
		ev = 'end';

	}

	cur.index = next;
	return ev;

}

// ------------------------------------------------------------------ wave 19B: the navy's waters
//
// NAVY_JETTY: the naval jetty on Tidemark's east shore, south of the town pier (inside Tidemark's calm circle: no fights there).
// A plank deck from the shore (x0, ground ~2.3 m) out to the head (x1, ~4.7 m of water) along z; ships lie at `berths` off
// its head (6 m of water). The office (bounties, the navy chandler, the forecast) stands at its foot. Measured on the Tidemark
// tile (TidemarkTerrain): the shore crosses 0 m at x ~1862 on z 140.
export const NAVY_JETTY = {
	port: 'tidemark', x0: 1826, x1: 1952, z: 140, deck: 2.2, width: 4,
	office: { x: 1834, z: 136.4 },
	berths: [ { x: 1975, z: 150, yaw: 0 }, { x: 1972, z: 122, yaw: Math.PI }, { x: 1992, z: 168, yaw: 0 } ],
	home: { x: 1985, z: 140 },
};

// the navy's patrol lanes (ping-pong, read from WORLD.ports so they follow the layout): the Tidemark approach from its roads to
// the middle of the sea, and the middle stretch of the trade lane between the home roads and Tidemark
export function navyLanes() {

	const tm = ( WORLD.ports || [] ).find( ( p ) => p.id === 'tidemark' );
	const ap = tm && Array.isArray( tm.approach ) ? tm.approach : [ [ 900, 330 ], [ 1500, 560 ], [ 1996, 58 ] ];
	const outer = ap.filter( ( p ) => p[ 0 ] >= 880 ).reverse(); // roads -> (900, 330)
	const mid = ap.filter( ( p ) => p[ 0 ] >= 250 && p[ 0 ] <= 1550 );
	return [ outer, mid ].filter( ( l ) => l.length >= 2 );

}
