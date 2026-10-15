// What each weather kind does to the world. Pure data and functions (no DOM, no engine).
//
// A kind has two rows of numbers, "mild" (intensity 0) and "full" (intensity 1), in KEYS order; climate()
// blends them by the intensity. The sea-state rows follow the settings panel's presets (AppUI SEA:
// Calm / Breezy / Choppy / Storm) so a stormy day is the panel's Storm, a clear one its Calm.
//
//   wind m/s, fetch km, chop (choppiness), swell (second wave system scale), surf (shore wave amplitude),
//   period (shore wave period, s), whitecaps 0..1, clouds (coverage), cirrus, haze (density; fog goes far
//   past the panel's slider range of 4: 1 is ~20 km of visibility), shafts (sun shafts through the haze),
//   rain 0..1 (precipitation), danger 0..1 (storm), bite (fish bite multiplier), light (exposure multiplier)

export const KEYS = [ 'wind', 'fetch', 'chop', 'swell', 'surf', 'period', 'whitecaps', 'clouds', 'cirrus', 'haze', 'shafts', 'rain', 'danger', 'bite', 'light' ];

const TABLE = {
	//          wind fetch chop  swell surf  per   white clouds cirr  haze shaft rain dang bite light
	clear: [ [ 5.0, 60, 0.80, 0.33, 0.22, 10.5, 0.25, 0.30, 0.50, 0.9, 1.00, 0.00, 0, 1.00, 1.00 ],
	         [ 3.2, 35, 0.72, 0.26, 0.16, 11.0, 0.15, 0.15, 0.35, 0.7, 1.10, 0.00, 0, 1.00, 1.00 ] ],
	breezy: [ [ 6.0, 100, 0.88, 0.42, 0.30, 9.5, 0.40, 0.40, 0.50, 1.0, 1.00, 0.00, 0, 1.04, 1.00 ],
	          [ 10.0, 200, 0.98, 0.58, 0.45, 8.8, 0.60, 0.55, 0.60, 1.2, 0.90, 0.00, 0, 1.08, 1.00 ] ],
	overcast: [ [ 5.5, 90, 0.84, 0.40, 0.28, 9.5, 0.30, 0.70, 0.20, 1.3, 0.50, 0.00, 0, 1.12, 0.96 ],
	            [ 8.0, 160, 0.92, 0.52, 0.38, 9.2, 0.45, 0.97, 0.10, 1.9, 0.20, 0.00, 0, 1.20, 0.90 ] ],
	rain: [ [ 7.0, 150, 0.92, 0.50, 0.38, 9.0, 0.50, 0.85, 0.15, 1.8, 0.30, 0.25, 0.0, 1.20, 0.94 ],
	        [ 14.0, 400, 1.10, 0.78, 0.62, 8.5, 0.80, 1.00, 0.05, 3.0, 0.08, 1.00, 0.1, 0.95, 0.82 ] ],
	storm: [ [ 16.0, 600, 1.12, 0.88, 0.75, 11.0, 0.90, 0.98, 0.10, 2.4, 0.05, 0.70, 0.6, 0.68, 0.84 ],
	         [ 22.0, 1200, 1.30, 1.10, 1.00, 12.5, 1.00, 1.00, 0.02, 3.2, 0.00, 1.00, 1.0, 0.55, 0.74 ] ],
	fog: [ [ 3.0, 40, 0.70, 0.25, 0.17, 11.0, 0.12, 0.50, 0.10, 12, 0.50, 0.00, 0, 1.05, 0.97 ],
	       [ 1.8, 25, 0.62, 0.20, 0.12, 11.0, 0.08, 0.65, 0.05, 34, 0.12, 0.00, 0, 1.10, 0.92 ] ],
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const lerp = ( a, b, t ) => a + ( b - a ) * t;

// the parameter set of a kind at an intensity (0..1) as { wind, fetch, ..., windDir (degrees offset) }
export function climate( kind, intensity = 0.5, dirOffsetDeg = 0 ) {

	const rows = TABLE[ kind ] || TABLE.breezy;
	const i = clamp( Number.isFinite( intensity ) ? intensity : 0.5, 0, 1 );
	const out = { windDir: dirOffsetDeg };
	for ( let k = 0; k < KEYS.length; k ++ ) out[ KEYS[ k ] ] = lerp( rows[ 0 ][ k ], rows[ 1 ][ k ], i );
	return out;

}

// blends two parameter sets (t 0..1): fetch in log space, the wind direction by the short way round
export function mix( a, b, t, out = {} ) {

	for ( const k of KEYS ) out[ k ] = k === 'fetch' ? Math.exp( lerp( Math.log( a[ k ] ), Math.log( b[ k ] ), t ) ) : lerp( a[ k ], b[ k ], t );
	let d = ( ( b.windDir - a.windDir ) % 360 + 540 ) % 360 - 180;
	if ( ! Number.isFinite( d ) ) d = 0;
	out.windDir = a.windDir + d * t;
	return out;

}

export function smoothstep01( t ) {

	const x = clamp( t, 0, 1 );
	return x * x * ( 3 - 2 * x );

}

// how species react to the weather: shallow, small, gentle fish feel it most, big hard-fighting ones less
// (the bite multiplier of the kind is scaled around 1 by this, then kept within 0.5 .. 1.4)
export function speciesSensitivity( fish ) {

	if ( ! fish || ! Number.isFinite( fish.fight ) ) return 1;
	return clamp( 1.25 - 0.5 * fish.fight, 0.7, 1.25 );

}

export const BITE_RANGE = [ 0.5, 1.4 ];
