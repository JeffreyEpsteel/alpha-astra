// Pure timing and intensity rules of the night feature (no engine imports: plain-node testable).
//
//   nightFromHour( h )          0 day .. 1 deep night: the ramp App.updateSun applies to the sun's depth below
//                               the horizon (smoothstep( -sunY, 0.02, 0.18 ), the same G.night the sky uses)
//   sunHeight( h )              sin of the sun's elevation (Sky.js sunDirectionFromTime, latitude 24, declination 6)
//   lampsOn( night )            the lamps' ramp (LocalLights / lantern glass: smoothstep( night, 0.15, 0.75 ))
//   phaseOf( h )                'day' | 'dusk' | 'night' | 'dawn'
//   ease( cur, target, dt, tau ) first-order approach (no click when the clock is scrubbed)
//   fireflyBlink( t, seed )     0..1 flash pattern of one firefly (a short flash every 2-5 s, a faint ember between)
//   beamFacing( angle, dx, dz ) 0..1 how squarely one of the lighthouse's two opposed beams points along (dx, dz)
//   planktonFlash( t, seed )    0..1 the twinkle of one plankton cell (fast rise, slow decay)
//   isLowPreset( app )          the low graphics preset (settings.quality / preset 'low', ?lowFx, render scale <= 0.55)
//   BUDGET.normal / .low        how much is drawn and how many local lights the feature may light
//   nearest( items, x, z, n, maxD, out )   the n items nearest to (x, z) within maxD (the light / swarm budgets)
//   packDisturbances( list, x, z, n, out ) the n strongest stirrings of the water near (x, z) into a flat vec4 array

export const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export function smooth( x, a, b ) {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

}

const DEG = Math.PI / 180;

export function sunHeight( hours, latitudeDeg = 24, declinationDeg = 6 ) {

	const phi = latitudeDeg * DEG, dec = declinationDeg * DEG;
	const H = ( hours - 12 ) * 15 * DEG;
	return Math.sin( phi ) * Math.sin( dec ) + Math.cos( phi ) * Math.cos( dec ) * Math.cos( H );

}

export function nightFromHour( hours ) {

	return Number.isFinite( hours ) ? smooth( - sunHeight( hours ), 0.02, 0.18 ) : 0;

}

export function lampsOn( night ) {

	return smooth( night, 0.15, 0.75 );

}

export function phaseOf( hours ) {

	if ( ! Number.isFinite( hours ) ) return 'day';
	const y = sunHeight( hours );
	if ( y > 0.1 ) return 'day';
	if ( y < - 0.18 ) return 'night';
	return ( ( hours % 24 ) + 24 ) % 24 < 12 ? 'dawn' : 'dusk';

}

export function ease( cur, target, dt, tau = 0.6 ) {

	if ( ! ( dt > 0 ) ) return cur;
	return cur + ( target - cur ) * ( 1 - Math.exp( - dt / tau ) );

}

// a deterministic 0..1 hash of a number (seeds of fireflies, swarms, plankton cells)
export function hash01( n ) {

	const s = Math.sin( n * 127.1 + 311.7 ) * 43758.5453;
	return s - Math.floor( s );

}

// one firefly: a 0.25-0.4 s flash every 2-5 s (its own period and phase), a dim ember between flashes
export function fireflyBlink( t, seed ) {

	const period = 2 + 3 * hash01( seed * 3.7 + 1 );
	const width = 0.25 + 0.15 * hash01( seed * 5.3 + 2 );
	const x = ( ( t / period + hash01( seed * 9.1 + 3 ) ) % 1 ) * period; // s since this cycle's flash began
	const flash = x < width ? Math.sin( Math.PI * x / width ) : 0;
	return 0.06 + 0.94 * flash;

}

// the lighthouse's two beams point along angle and angle + PI (GullRock: +X turned by rotation.y, so the
// direction is ( cos a, -sin a ) in x / z); 1 when one points straight along ( dx, dz ), ~0.5 at 3.7 deg off
export function beamFacing( angle, dx, dz, sharp = 300 ) {

	const l = Math.hypot( dx, dz );
	if ( l < 1e-6 ) return 0;
	const c = Math.abs( ( Math.cos( angle ) * dx - Math.sin( angle ) * dz ) / l );
	return Math.exp( ( c - 1 ) * sharp );

}

// the twinkle of a plankton cell: a fast rise and an exponential decay once per 0.6-2.4 s
export function planktonFlash( t, seed ) {

	const per = 0.6 + 1.8 * hash01( seed * 1.3917 + 5.1 );
	const ph = ( ( t / per + hash01( seed * 2.11 + 0.4 ) ) % 1 + 1 ) % 1;
	return Math.exp( - ph * 7 ) * smooth( ph, 0, 0.04 );

}

export function isLowPreset( app ) {

	const s = ( app && app.settings ) || {};
	const q = String( s.quality || s.preset || s.graphics || '' ).toLowerCase();
	if ( q === 'low' ) return true;
	if ( s.lowFx ) return true;
	const qs = app && app.qs;
	if ( qs && typeof qs.has === 'function' && ( qs.has( 'lowFx' ) || qs.has( 'lowNight' ) ) ) return true;
	return Number.isFinite( s.renderScale ) && s.renderScale <= 0.55;

}

// plankton: sparkles (instances) in a box of `box` m round the camera; halos: lamps drawn with a glow;
// fireflies over `swarms` swarms; lights: the local lights this feature may switch on at once
export const BUDGET = {
	normal: { plankton: 6144, box: 64, halos: 180, haloRange: 900, fireflies: 120, swarms: 24, lights: 4, glints: 12 },
	low: { plankton: 2048, box: 48, halos: 64, haloRange: 400, fireflies: 40, swarms: 8, lights: 1, glints: 6 },
};

// the n items ( { x, z } or { position: { x, z } } ) nearest to (x, z) within maxD, nearest first
export function nearest( items, x, z, n, maxD = Infinity, out = [] ) {

	out.length = 0;
	if ( n <= 0 ) return out;
	const m2 = maxD * maxD;
	for ( const it of items ) {

		const p = it.position || it;
		const d2 = ( p.x - x ) ** 2 + ( p.z - z ) ** 2;
		if ( ! ( d2 <= m2 ) ) continue;
		if ( out.length === n && d2 >= out[ n - 1 ]._d2 ) continue;
		it._d2 = d2;
		let i = Math.min( out.length, n - 1 );
		if ( out.length < n ) out.push( it );
		while ( i > 0 && out[ i - 1 ]._d2 > d2 ) { out[ i ] = out[ i - 1 ]; i --; }
		out[ i ] = it;

	}

	return out;

}

// stirrings { x, z, r, s } -> out (Float32Array or array of n * 4: x, z, radius, strength), the strongest near
// (x, z) first (strength over distance); the rest of out is zeroed. Returns how many were packed.
export function packDisturbances( list, x, z, n, out, reach = 90 ) {

	const pick = [];
	for ( const d of list ) {

		if ( ! d || ! ( d.s > 0.001 ) || ! ( d.r > 0 ) ) continue;
		const dist = Math.hypot( d.x - x, d.z - z ) - d.r;
		if ( dist > reach ) continue;
		pick.push( { d, w: d.s / ( 1 + Math.max( 0, dist ) / 20 ) } );

	}

	pick.sort( ( a, b ) => b.w - a.w );
	const k = Math.min( n, pick.length );
	for ( let i = 0; i < n; i ++ ) {

		const o = i * 4;
		if ( i < k ) {

			const d = pick[ i ].d;
			out[ o ] = d.x; out[ o + 1 ] = d.z; out[ o + 2 ] = d.r; out[ o + 3 ] = d.s;

		} else {

			out[ o ] = 0; out[ o + 1 ] = 0; out[ o + 2 ] = 1; out[ o + 3 ] = 0;

		}

	}

	return k;

}
