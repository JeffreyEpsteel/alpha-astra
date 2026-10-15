// Small shared helpers of the naval feature (no engine, no DOM: runs in node).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// angle wrapped to (-PI, PI]
export function wrap( a ) {

	a %= TAU;
	if ( a > Math.PI ) a -= TAU;
	else if ( a <= - Math.PI ) a += TAU;
	return a;

}

// shortest signed turn from `from` to `to`
export const angleDiff = ( to, from ) => wrap( to - from );

export const dist2 = ( ax, az, bx, bz ) => Math.hypot( bx - ax, bz - az );

// deterministic random numbers (mulberry32): rng() in [0, 1), plus helpers
export function makeRng( seed = 1 ) {

	let s = ( seed >>> 0 ) || 1;
	const rng = () => {

		s = ( s + 0x6D2B79F5 ) >>> 0;
		let t = s;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

	rng.range = ( a, b ) => a + ( b - a ) * rng();
	rng.pick = ( list ) => list[ Math.floor( rng() * list.length ) % list.length ];
	// roughly normal, sd 1 (sum of three uniforms)
	rng.gauss = () => ( rng() + rng() + rng() - 1.5 ) * 2;
	return rng;

}

// 'port' | 'starboard' from the many spellings a caller may use; null when unknown
export function normaliseSide( side ) {

	const s = String( side ).toLowerCase();
	if ( s === 'port' || s === 'p' || s === 'left' || s === 'l' || s === 'z' || s === 'keyz' ) return 'port';
	if ( s === 'starboard' || s === 's' || s === 'right' || s === 'r' || s === 'x' || s === 'keyx' ) return 'starboard';
	return null;

}

// +1 port, -1 starboard (the boat frame is +Z forward / +X port, yaw about +Y: positive yaw turns to port)
export const sideSign = ( side ) => ( side === 'port' ? 1 : - 1 );
