// Where the inverted layer hangs (pure: no GPU, testable). The Unreal design's world is "suspended over a void" with
// overhead terrain, hanging roots and a directional landmark visible from both ports; here that layer is an opt-in
// sky over the ordinary sea: a handful of islets hanging upside down high overhead, roots trailing toward the water,
// and one big landmark islet between the home harbour and Pons Cove with a beacon at the tip of its hanging spire.
//
//   invertedLayout( WORLD ) -> [ { id, x, y, z, r, h, roots, trees, landmark, seed } ]   y: the islet's grass face (it
//                              faces down), r: its radius, h: how far the rock cone rises above the face
//   elevationFrom( site, x, z, eyeY ) -> degrees above the horizon        visibleFrom( site, x, z ) -> bool
//   rootPool( layout ) -> { x, z, r }   the water under the landmark's spire (the Easter-egg spot)
//   proximity( layout, x, z ) -> 0..1   how much of the sky the layer fills from here (1 under an islet)
//
// The ports are read from WORLD.ports at call time (the islands worker adds more); a port whose id or name mentions
// "invert" gets an islet of its own right over it.

const DEG = 180 / Math.PI;

export const LANDMARK_ALT = 300; // m: the landmark's grass face
export const LANDMARK_R = 85;
export const SPIRE = 120; // m the landmark's spire hangs below its face (the beacon at its tip)

function portById( WORLD, id ) {

	const ps = WORLD && WORLD.ports ? WORLD.ports : [];
	return ps.find( ( p ) => p.id === id ) || null;

}

function portXZ( p ) {

	if ( ! p ) return null;
	if ( p.stand ) return { x: p.stand.x, z: p.stand.z };
	if ( p.dock && p.dock.position ) return { x: p.dock.position.x, z: p.dock.position.z };
	if ( p.center ) return { x: p.center.x, z: p.center.z };
	return null;

}

export function invertedLayout( WORLD ) {

	const home = portXZ( portById( WORLD, 'home' ) ) || { x: 50, z: - 75 };
	const pons = portXZ( portById( WORLD, 'pons' ) ) || { x: 560, z: 500 };
	// the landmark: between the two ports, pushed a little seaward (south) so neither island hides it
	const mx = ( home.x + pons.x ) / 2, mz = ( home.z + pons.z ) / 2;
	const out = [
		{ id: 'landmark', x: mx + 20, y: LANDMARK_ALT, z: mz + 40, r: LANDMARK_R, h: 150, roots: 46, trees: 14, landmark: true, seed: 11 },
		// over the reef, seen from the home beach
		{ id: 'reef', x: - 120, y: 175, z: 150, r: 34, h: 60, roots: 18, trees: 5, landmark: false, seed: 23 },
		// out west toward Gull Rock
		{ id: 'west', x: - 330, y: 220, z: 330, r: 46, h: 80, roots: 22, trees: 6, landmark: false, seed: 37 },
		// out east toward Saltmarsh Key
		{ id: 'east', x: 560, y: 205, z: 160, r: 40, h: 70, roots: 20, trees: 6, landmark: false, seed: 41 },
		// beyond Pons, a small one that frames the cove from the dock
		{ id: 'pons', x: pons.x + 160, y: 160, z: pons.z + 150, r: 28, h: 50, roots: 14, trees: 4, landmark: false, seed: 53 },
	];
	for ( const p of WORLD && WORLD.ports ? WORLD.ports : [] ) {

		if ( ! /invert/i.test( ( p.id || '' ) + ' ' + ( p.name || '' ) ) ) continue;
		const c = p.center || portXZ( p );
		if ( ! c ) continue;
		out.push( { id: 'over-' + p.id, x: c.x, y: 190, z: c.z, r: 60, h: 90, roots: 30, trees: 9, landmark: false, seed: 67 } );

	}

	return out;

}

// degrees above the horizon of the islet's lowest point (the landmark: its beacon) seen from ( x, z ) at eye height
export function elevationFrom( s, x, z, eyeY = 2 ) {

	const low = s.landmark ? s.y - SPIRE : s.y;
	const d = Math.hypot( s.x - x, s.z - z );
	return Math.atan2( low - eyeY, Math.max( d, 1e-3 ) ) * DEG;

}

// clear of the horizon haze (a few degrees up) and inside the camera's 2 km far plane
export function visibleFrom( s, x, z, eyeY = 2, far = 1900 ) {

	const d = Math.hypot( s.x - x, s.z - z, s.y - eyeY );
	return d < far && elevationFrom( s, x, z, eyeY ) > 4;

}

export function rootPool( layout ) {

	const l = layout.find( ( s ) => s.landmark ) || layout[ 0 ];
	return { x: l.x, z: l.z, r: 45 };

}

export function proximity( layout, x, z ) {

	let best = 0;
	for ( const s of layout ) {

		const d = Math.hypot( s.x - x, s.z - z );
		// full under the islet, fading out to ~5 radii (plus its height: a high islet fills less sky)
		const reach = s.r * 5 + s.y * 0.5;
		const k = d <= s.r ? 1 : Math.max( 0, 1 - ( d - s.r ) / reach );
		if ( k > best ) best = k;

	}

	return best;

}
