// Deck layouts of the three ships (Boats.js kind 'ship'), measured on the GLBs (public/models/ships/*_v2.glb) and the
// fork's Assets/NavalShips/manifest.json, in the game's boat frame: +Z forward, +X port, y = 0 the design waterline,
// z = 0 the middle of the hull (the GLB is centred on its X extent, see features/naval/Models.js centreOnHull).
//
//   const boxes = shipColliders( BOATS.sloop, lines )     -> [ { tag, center, half, walkable, solid } ] for the deck walker
//   shipExitPoints( spec, lines )                         -> 6 Vector3: where the player steps ashore / jumps (rail openings)
//   deckSurfaceAt( id, x, z )                             -> the designed deck height under (x, z) or null off the deck
//   gunMounts( spec, lines )                              -> [ { side, x, y, z } ] swivel mounts on the rail (muzzle = x + MUZZLE_REACH)
//
// Walkable boxes carry the walking surface: the main deck, the quarterdeck (stern platform) with its steps or side
// ramps (stepped in <= 0.1 m risers: Player.DECK_STEP is 0.36), the brigantine's forecastle. Their tops sit at or just
// under the plank surface (never above it); test/feature-ships.mjs checks them against the GLB triangles. Solid boxes
// are what the player cannot cross: the bulwarks (open at the boarding gap), the transom, the stem, the mast
// tabernacles and, on the trawler, the wheelhouse walls.

import { Vector3 } from '../../engine/index.js';

export const BULWARK = 0.98; // m of bulwark above the local deck (manifest rails.rail_height_above_deck_m)
export const GAP = 0.9; // half length of the boarding opening in the bulwarks (manifest main_deck_boarding_gap_m)
export const MUZZLE_REACH = 0.95; // m from the swivel pintle to the muzzle, along the beam

// surfaces: flat decks { z0, z1, y [, x0, x1] }; ramps: stepped inclines { x0, x1 (+ mirror), from, to, yFrom, yTo, steps };
// solid: extra solid boxes { tag, x0, x1, z0, z1, y0, y1 } (y relative to the deck below)
export const SHIP_LAYOUT = {
	sloop: {
		deckEnd: 6.6, // the planks end here; a stem box closes the bow
		surfaces: [
			{ z0: - 0.75, z1: 6.6, y: 2.2 }, // main deck
			// beside and between the gangways the deck stays at 2.2 m
			{ z0: - 3.6, z1: - 0.75, y: 2.2, x0: 2.15, x1: 4 },
			{ z0: - 3.6, z1: - 0.75, y: 2.2, x0: - 4, x1: - 2.15 },
			{ z0: - 3.6, z1: - 0.75, y: 2.2, x0: - 0.12, x1: 0.12 },
			{ z0: - 7.05, z1: - 4.5, y: 2.9 }, // stern platform
			// the centre stair between the two gangways (manifest stern_stairs: 3 treads of 0.28 m, rise 0.233)
			{ z0: - 4.04, z1: - 3.76, y: 2.43, x0: - 0.24, x1: 0.24 },
			{ z0: - 4.32, z1: - 4.04, y: 2.67, x0: - 0.24, x1: 0.24 },
			{ z0: - 4.6, z1: - 4.32, y: 2.9, x0: - 0.24, x1: 0.24 },
		],
		// two side gangways 2 m wide centred at +-1.15 m rising 0.7 m over 3.75 m (manifest side_gangways)
		ramps: [ { x0: 0.12, x1: 2.15, mirror: true, from: - 0.75, to: - 4.5, yFrom: 2.2, yTo: 2.9, steps: 7 } ],
		masts: [ { z: 1.7 } ],
		solid: [],
	},
	brigantine: {
		deckEnd: 9.4,
		surfaces: [
			{ z0: - 4.5, z1: 6.25, y: 2.6 }, // main deck
			{ z0: - 4.8, z1: - 4.5, y: 2.87 }, // stern stairs: three treads of 0.3 m, rise 0.267
			{ z0: - 5.1, z1: - 4.8, y: 3.13 },
			{ z0: - 10.0, z1: - 5.1, y: 3.4 }, // quarterdeck
			{ z0: 6.25, z1: 6.45, y: 2.77 }, // forecastle steps (rise 0.167, tread 0.2)
			{ z0: 6.45, z1: 6.65, y: 2.93 },
			{ z0: 6.65, z1: 9.4, y: 3.1 }, // forecastle
		],
		ramps: [],
		masts: [ { z: 4.3 }, { z: - 1.7 } ],
		solid: [],
	},
	trawler: {
		deckEnd: 7.4,
		surfaces: [
			{ z0: - 3.56, z1: 7.4, y: 2.4 }, // main deck
			{ z0: - 3.84, z1: - 3.56, y: 2.6 }, // stern steps (3 x 0.2)
			{ z0: - 4.12, z1: - 3.84, y: 2.8 },
			{ z0: - 8.05, z1: - 4.12, y: 3.0 }, // stern platform under the wheelhouse
		],
		ramps: [],
		masts: [ { z: 1.3 } ],
		// the wheelhouse: side walls and the aft wall; the front is open (the wheel stands 0.55 m ahead of the helm)
		solid: [
			{ tag: 'wheelhouse', x0: 1.6, x1: 1.9, z0: - 7.85, z1: - 4.55, y0: 0, y1: 2.6 },
			{ tag: 'wheelhouse', x0: - 1.9, x1: - 1.6, z0: - 7.85, z1: - 4.55, y0: 0, y1: 2.6 },
			{ tag: 'wheelhouse', x0: - 1.9, x1: 1.9, z0: - 8.0, z1: - 7.7, y0: 0, y1: 2.6 },
		],
	},
};

const V = ( x, y, z ) => new Vector3( x, y, z );

function box( tag, x0, x1, y0, y1, z0, z1, walkable = false, solid = ! walkable ) {

	return {
		tag,
		center: V( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 ),
		half: V( Math.abs( x1 - x0 ) / 2, Math.abs( y1 - y0 ) / 2, Math.abs( z1 - z0 ) / 2 ),
		walkable, solid,
	};

}

// the walkable surfaces as plain rectangles { x0, x1, z0, z1, y } (ramps already stepped): the one list both the
// colliders and deckSurfaceAt() read
export function walkSurfaces( id, halfWidth = 4 ) {

	const L = SHIP_LAYOUT[ id ];
	if ( ! L ) return [];
	const out = [];
	for ( const s of L.surfaces ) out.push( { x0: s.x0 ?? - halfWidth, x1: s.x1 ?? halfWidth, z0: s.z0, z1: s.z1, y: s.y } );
	for ( const r of L.ramps ) {

		// step k (0 .. steps - 1) covers the k-th slice of the run, its top is the ramp height at the slice's low end
		for ( let k = 0; k < r.steps; k ++ ) {

			const za = r.from + ( r.to - r.from ) * k / r.steps, zb = r.from + ( r.to - r.from ) * ( k + 1 ) / r.steps;
			const y = r.yFrom + ( r.yTo - r.yFrom ) * k / r.steps;
			const z0 = Math.min( za, zb ), z1 = Math.max( za, zb );
			out.push( { x0: r.x0, x1: r.x1, z0, z1, y } );
			if ( r.mirror ) out.push( { x0: - r.x1, x1: - r.x0, z0, z1, y } );

		}

	}

	return out;

}

// highest designed walking surface at (x, z), or null where there is none
export function deckSurfaceAt( id, x, z ) {

	let best = null;
	for ( const s of walkSurfaces( id ) ) if ( x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && ( best === null || s.y > best ) ) best = s.y;
	return best;

}

// the deck level at the helm (the stern platform)
export function helmDeckY( spec ) {

	return spec.helmDeckY ?? spec.deckY;

}

// Colliders in the boat frame for the deck walker (Player.updateDeck / deckGroundAt).
export function shipColliders( spec, lines ) {

	const id = spec.shipClass || spec.id;
	const L = SHIP_LAYOUT[ id ];
	if ( ! L ) throw new Error( 'shipColliders: no layout for ' + id );
	const boxes = [];
	const deckY = spec.deckY;

	// walking surfaces: a slab 0.1 m thick under each top, clipped to the hull plan at the aft/fore ends of the run
	for ( const s of walkSurfaces( id ) ) {

		const zm = ( s.z0 + s.z1 ) / 2;
		const hw = Math.max( 0.3, lines.halfBreadth( lines.tAtSheerZ( zm ), s.y ) - lines.shell );
		boxes.push( box( 'deck', Math.max( s.x0, - hw ), Math.min( s.x1, hw ), s.y - 0.1, s.y, s.z0, s.z1, true, false ) );

	}

	// the highest deck level near z (to size the bulwark over the quarterdeck / forecastle)
	const surfaces = walkSurfaces( id );
	const levelAt = ( z ) => {

		let y = deckY;
		for ( const s of surfaces ) if ( z >= s.z0 - 1e-6 && z <= s.z1 + 1e-6 && s.y > y ) y = s.y;
		return y;

	};

	// bulwarks on both sides in short runs following the sheer, open at the boarding gap
	const zA = lines.zAft + lines.shell, zB = L.deckEnd;
	const segs = [];
	const cut = ( a, b ) => {

		if ( b - a > 0.05 ) segs.push( [ a, b ] );

	};

	cut( zA, - GAP );
	cut( GAP, zB );
	for ( const [ a, b ] of segs ) {

		const n = Math.max( 1, Math.ceil( ( b - a ) / 1.2 ) );
		for ( let i = 0; i < n; i ++ ) {

			const z0 = a + ( b - a ) * i / n, z1 = a + ( b - a ) * ( i + 1 ) / n;
			const t0 = lines.tAtSheerZ( z0 ), t1 = lines.tAtSheerZ( z1 );
			const xo = Math.max( lines.sheerX( t0 ), lines.sheerX( t1 ) );
			const xi = Math.max( 0.1, Math.min( lines.sheerX( t0 ), lines.sheerX( t1 ) ) - lines.shell );
			const top = Math.max( levelAt( z0 ), levelAt( z1 ), levelAt( ( z0 + z1 ) / 2 ) ) + BULWARK;
			for ( const sd of [ 1, - 1 ] ) boxes.push( box( 'bulwark', sd * Math.min( xi, xo ), sd * Math.max( xi, xo ), deckY, top, z0, z1 ) );

		}

	}

	// the transom across the stern and the stem across the bow
	const sternLevel = levelAt( lines.zAft + 0.3 );
	boxes.push( box( 'transom', - lines.sheerX( 0 ), lines.sheerX( 0 ), deckY, sternLevel + BULWARK, lines.zAft, lines.zAft + lines.shell ) );
	const bowLevel = levelAt( L.deckEnd - 0.3 );
	boxes.push( box( 'stem', - lines.sheerX( lines.tAtSheerZ( L.deckEnd ) ), lines.sheerX( lines.tAtSheerZ( L.deckEnd ) ), deckY, bowLevel + BULWARK, L.deckEnd, lines.zBow ) );

	// mast tabernacles (0.9 m square) and the other solids
	for ( const m of L.masts ) boxes.push( box( 'mast', - 0.45, 0.45, deckY, deckY + 2.6, m.z - 0.45, m.z + 0.45 ) );
	for ( const s of L.solid ) {

		const base = levelAt( ( s.z0 + s.z1 ) / 2 );
		boxes.push( box( s.tag, s.x0, s.x1, base + s.y0, base + s.y1, s.z0, s.z1 ) );

	}

	return boxes;

}

// Where the player steps ashore / jumps overboard: the rail openings amidships, the stern platform and the foredeck.
// Six points (port and starboard of three stations), at the local deck height.
export function shipExitPoints( spec, lines ) {

	const id = spec.shipClass || spec.id;
	const L = SHIP_LAYOUT[ id ];
	const surfaces = walkSurfaces( id );
	const levelAt = ( z ) => {

		let y = spec.deckY;
		for ( const s of surfaces ) if ( z >= s.z0 && z <= s.z1 && s.y > y ) y = s.y;
		return y;

	};

	// stern: the middle of the quarterdeck (the longest raised surface aft of amidships)
	const stern = L.surfaces.filter( ( s ) => s.y > spec.deckY && s.z1 < 0 ).reduce( ( a, s ) => ( s.z1 - s.z0 > a.z1 - a.z0 ? s : a ), { z0: 0, z1: 0 } );
	const zs = [ 0, ( stern.z0 + stern.z1 ) / 2, 0.5 * L.deckEnd ];
	const pts = [];
	for ( const z of zs ) {

		const t = lines.tAtSheerZ( z );
		for ( const s of [ 1, - 1 ] ) pts.push( V( s * ( lines.sheerX( t ) - 0.035 ), levelAt( z ) + 0.05, z ) );

	}

	return pts;

}

// Swivel mounts on the rail, one list per boat: port (+x) and starboard (-x) guns at the catalog's stations (the pintle
// stands in the bulwark, 0.2 m inside the outer face).
export function gunMounts( spec, lines ) {

	const b = spec.broadside;
	if ( ! b ) return [];
	const out = [];
	for ( const z of b.z ) {

		const x = b.x;
		for ( const side of [ 'port', 'starboard' ] ) out.push( { side, x: side === 'port' ? x : - x, y: spec.deckY + ( b.y ?? 1.2 ), z } );

	}

	return out;

}
