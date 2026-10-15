// Procedural sprite atlas for the VFX particles (src/fx/VfxParticles.js): 4 x 4 cells of 64 px, generated once
// on the CPU (no image downloads). Pure JS, so the node tests can check it without a GPU.
//
//   const { data, size, cell } = buildVfxAtlas();   // rgba8, size x size; data[ ( y * size + x ) * 4 ]
//   SPRITE.PUFF_A ...                                // cell index (column = i % 4, row = i / 4, row 0 at the top)
//
// Channels: r = coverage (the silhouette; puffs keep a gradient so the shader can erode them from the edges as
// they age), g = a second term per sprite (the hot core of a flash / flame / ember, the bevel shading of a
// splinter / chunk, the density of a puff), b = 0, a = 255. Every cell falls to zero before its border, so
// bilinear filtering and the coarse mip levels do not bleed one sprite into the next.

export const ATLAS_GRID = 4;
export const ATLAS_CELL = 64;

export const SPRITE = {
	PUFF_A: 0, // billowy smoke puff
	PUFF_B: 1, // a second puff (variety)
	PUFF_C: 2, // a ragged, wispy puff
	FLASH: 3, // muzzle flash star (additive)
	FLAME: 4, // flame tongue, point up (additive)
	EMBER: 5, // round hot dot: embers, sparks, water drops
	SHEET: 6, // torn sheet of water (splash column / crown)
	FOAM_RING: 7, // broken ring of foam (lies on the water)
	FOAM: 8, // blotchy foam patch (lies on the water)
	BUBBLES: 9, // cluster of bubbles (lies on the water)
	SPLINTER: 10, // long jagged wood shard
	CHUNK: 11, // irregular chunk (stone, timber, earth)
	DUST: 12, // very soft dust cloud
	RING: 13, // soft ring (blast shock, steam)
	DROPS: 14, // cluster of drops
	WISP: 15, // stretched smoke wisp
};

const clamp01 = ( x ) => ( x < 0 ? 0 : x > 1 ? 1 : x );
const smooth = ( a, b, x ) => {

	const t = clamp01( ( x - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );

};

// deterministic hashes / value noise (the atlas must be the same on every load)
function hash2( i, j, s ) {

	const h = Math.sin( i * 127.1 + j * 311.7 + s * 74.7 ) * 43758.5453;
	return h - Math.floor( h );

}

function vnoise( x, y, s ) {

	const i = Math.floor( x ), j = Math.floor( y );
	const fx = x - i, fy = y - j;
	const ux = fx * fx * ( 3 - 2 * fx ), uy = fy * fy * ( 3 - 2 * fy );
	const a = hash2( i, j, s ), b = hash2( i + 1, j, s ), c = hash2( i, j + 1, s ), d = hash2( i + 1, j + 1, s );
	return ( a * ( 1 - ux ) + b * ux ) * ( 1 - uy ) + ( c * ( 1 - ux ) + d * ux ) * uy;

}

function fbm( x, y, s, oct = 4 ) {

	let v = 0, a = 0.5, n = 0, f = 1;
	for ( let o = 0; o < oct; o ++ ) {

		v += vnoise( x * f, y * f, s + o * 13 ) * a;
		n += a;
		a *= 0.5;
		f *= 2.03;

	}

	return v / n;

}

function rng( seed ) {

	let s = seed >>> 0;
	return () => ( ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

}

// ---- the sprites: ( x, y ) in -1..1 (y up), returns [ r, g ]

function puff( seed, wispy ) {

	const R = rng( seed );
	const blobs = [];
	const n = wispy ? 9 : 6;
	for ( let k = 0; k < n; k ++ ) {

		const a = R() * Math.PI * 2, d = R() * ( wispy ? 0.42 : 0.32 );
		blobs.push( [ Math.cos( a ) * d, Math.sin( a ) * d, ( wispy ? 0.18 : 0.26 ) + R() * 0.2 ] );

	}

	return ( x, y ) => {

		let v = 0;
		for ( const [ bx, by, br ] of blobs ) {

			const d2 = ( ( x - bx ) * ( x - bx ) + ( y - by ) * ( y - by ) ) / ( br * br );
			v += Math.exp( - d2 * 1.6 );

		}

		const r = Math.hypot( x, y );
		const detail = fbm( x * 3 + 7, y * 3 + 3, seed, 5 );
		const env = smooth( 0.95, 0.55, r );
		const dens = clamp01( v * 0.75 ) * ( 0.45 + 0.85 * detail ) * env;
		return [ clamp01( dens ), clamp01( v * 0.5 * env ) ];

	};

}

function flash( x, y ) {

	const r = Math.hypot( x, y ), a = Math.atan2( y, x );
	const core = Math.exp( - r * r * 14 );
	const rays = Math.pow( Math.abs( Math.cos( a * 3 + 0.3 ) ), 24 ) * Math.exp( - r * 2.6 ) + Math.pow( Math.abs( Math.cos( a * 2.5 + 1.1 ) ), 40 ) * Math.exp( - r * 3.4 ) * 0.7;
	const glow = Math.exp( - r * r * 3.2 ) * 0.45;
	const env = smooth( 0.97, 0.75, r );
	return [ clamp01( ( core + rays + glow ) * env ), clamp01( core * 1.2 ) ];

}

function flame( x, y ) {

	// a teardrop, wide at the bottom, licking to a point at the top, its edge shimmering
	const t = ( y + 0.85 ) / 1.75; // 0 bottom .. 1 tip
	if ( t <= 0 || t >= 1 ) return [ 0, 0 ];
	const w = 0.5 * Math.pow( 1 - t, 0.75 ) * smooth( 0, 0.18, t );
	const xs = x + ( fbm( y * 2.2 + 1, 3.1, 41, 3 ) - 0.5 ) * 0.35 * t;
	const inside = 1 - Math.abs( xs ) / Math.max( w, 1e-3 );
	const edge = smooth( 0, 0.45, inside ) * ( 0.75 + 0.35 * fbm( x * 5, y * 4, 43, 3 ) );
	const core = smooth( 0.35, 0.95, inside ) * ( 1 - t * 0.7 );
	return [ clamp01( edge ), clamp01( core ) ];

}

function ember( x, y ) {

	const r2 = x * x + y * y;
	return [ clamp01( Math.exp( - r2 * 7 ) * smooth( 1, 0.85, Math.sqrt( r2 ) ) ), clamp01( Math.exp( - r2 * 26 ) ) ];

}

function sheet( x, y ) {

	// torn water: fibres along y, a ragged top, a broad base
	const fib = fbm( x * 5.5, y * 1.3 + 2, 51, 4 );
	const fine = fbm( x * 11, y * 3, 53, 3 );
	const across = Math.exp( - x * x * ( 2.2 + 1.5 * ( y + 1 ) ) );
	const along = smooth( - 0.98, - 0.6, y ) * smooth( 0.95, 0.15 + fib * 0.45, y );
	const v = across * along * ( 0.35 + fib * 0.8 + fine * 0.35 );
	return [ clamp01( ( v - 0.22 ) * 1.9 ), clamp01( fine ) ];

}

function foamRing( x, y ) {

	const r = Math.hypot( x, y );
	const ring = Math.exp( - Math.pow( ( r - 0.7 ) / 0.13, 2 ) );
	const brk = fbm( x * 4.5 + 2, y * 4.5, 61, 4 );
	const inner = smooth( 0.7, 0.15, r ) * fbm( x * 7, y * 7, 63, 3 ) * 0.35;
	const v = ring * clamp01( brk * 1.6 - 0.2 ) + inner;
	return [ clamp01( v * smooth( 0.97, 0.88, r ) ), clamp01( brk ) ];

}

function foamPatch( seed ) {

	const R = rng( seed );
	const blobs = [];
	for ( let k = 0; k < 46; k ++ ) {

		const a = R() * Math.PI * 2, d = Math.sqrt( R() ) * 0.72;
		blobs.push( [ Math.cos( a ) * d, Math.sin( a ) * d, 0.04 + R() * 0.12 ] );

	}

	return ( x, y ) => {

		let v = 0;
		for ( const [ bx, by, br ] of blobs ) {

			const d = Math.hypot( x - bx, y - by );
			v = Math.max( v, smooth( br, br * 0.4, d ) );

		}

		const r = Math.hypot( x, y );
		const lace = fbm( x * 9, y * 9, seed, 3 );
		return [ clamp01( v * ( 0.4 + 0.7 * lace ) * smooth( 0.95, 0.6, r ) ), clamp01( lace ) ];

	};

}

function bubbles( seed ) {

	const R = rng( seed );
	const list = [];
	for ( let k = 0; k < 16; k ++ ) {

		const a = R() * Math.PI * 2, d = Math.sqrt( R() ) * 0.68;
		list.push( [ Math.cos( a ) * d, Math.sin( a ) * d, 0.05 + R() * 0.13 ] );

	}

	return ( x, y ) => {

		let v = 0, g = 0;
		for ( const [ bx, by, br ] of list ) {

			const d = Math.hypot( x - bx, y - by );
			v = Math.max( v, Math.exp( - Math.pow( ( d - br ) / ( br * 0.32 ), 2 ) ) );
			// a highlight on the upper left of each bubble
			g = Math.max( g, Math.exp( - ( Math.pow( x - bx + br * 0.4, 2 ) + Math.pow( y - by - br * 0.4, 2 ) ) / ( br * br * 0.06 ) ) );

		}

		const r = Math.hypot( x, y );
		return [ clamp01( v * smooth( 0.95, 0.8, r ) ), clamp01( g ) ];

	};

}

function splinter( x, y ) {

	// a long shard along y, jagged edges, thicker in the middle; g: bevel light across it
	const L = 0.88;
	if ( Math.abs( y ) >= L ) return [ 0, 0 ];
	const t = Math.abs( y ) / L;
	const jag = ( vnoise( y * 9, 1.5, 71 ) - 0.5 ) * 0.07;
	const w = 0.14 * Math.pow( 1 - t, 0.55 ) + jag * ( 1 - t );
	const xs = x - Math.sin( y * 2.1 ) * 0.04;
	const inside = 1 - Math.abs( xs ) / Math.max( w, 1e-3 );
	const grain = 0.75 + 0.25 * vnoise( x * 30, y * 4, 73 );
	return [ clamp01( smooth( 0, 0.25, inside ) ), clamp01( ( 0.5 + 0.5 * xs / Math.max( w, 1e-3 ) ) * grain ) ];

}

function chunk( x, y ) {

	const r = Math.hypot( x, y ), a = Math.atan2( y, x );
	const R0 = 0.5 * ( 1 + 0.28 * ( vnoise( Math.cos( a ) * 2 + 3, Math.sin( a ) * 2 + 3, 81 ) - 0.5 ) * 2 );
	const inside = 1 - r / R0;
	// bevel: lit from the upper left, darker toward the lower right
	const shade = clamp01( 0.55 + ( - x * 0.6 + y * 0.8 ) * 0.7 ) * ( 0.8 + 0.2 * fbm( x * 8, y * 8, 83, 3 ) );
	return [ clamp01( smooth( 0, 0.12, inside ) ), clamp01( shade ) ];

}

function dust( x, y ) {

	const r = Math.hypot( x, y );
	const n = fbm( x * 2.4 + 9, y * 2.4 + 1, 91, 5 );
	return [ clamp01( smooth( 0.98, 0.15, r ) * ( 0.3 + 0.8 * n ) ), clamp01( n ) ];

}

function ring( x, y ) {

	const r = Math.hypot( x, y );
	const v = Math.exp( - Math.pow( ( r - 0.68 ) / 0.17, 2 ) ) * ( 0.7 + 0.5 * fbm( x * 5, y * 5, 101, 3 ) );
	return [ clamp01( v * smooth( 0.98, 0.86, r ) ), clamp01( v ) ];

}

function drops( seed ) {

	const R = rng( seed );
	const list = [];
	for ( let k = 0; k < 30; k ++ ) {

		const a = R() * Math.PI * 2, d = Math.pow( R(), 0.7 ) * 0.7;
		list.push( [ Math.cos( a ) * d, Math.sin( a ) * d, 0.025 + Math.pow( R(), 3 ) * 0.08 ] );

	}

	return ( x, y ) => {

		let v = 0;
		for ( const [ bx, by, br ] of list ) v = Math.max( v, smooth( br, br * 0.3, Math.hypot( x - bx, y - by ) ) );
		return [ clamp01( v * smooth( 0.95, 0.8, Math.hypot( x, y ) ) ), clamp01( v ) ];

	};

}

function wisp( x, y ) {

	const r = Math.hypot( x * 1.6, y * 0.8 );
	const n = fbm( x * 2 + Math.sin( y * 2.5 ) * 0.6, y * 1.2, 111, 5 );
	const v = smooth( 1, 0.2, r ) * ( n * 1.4 - 0.25 );
	return [ clamp01( v * smooth( 0.97, 0.8, Math.hypot( x, y ) ) ), clamp01( n ) ];

}

const CELLS = [
	puff( 1, false ), puff( 2, false ), puff( 3, true ), flash,
	flame, ember, sheet, foamRing,
	foamPatch( 7 ), bubbles( 9 ), splinter, chunk,
	dust, ring, drops( 13 ), wisp,
];

let _cache = null;

// rgba8 atlas (size = 4 * 64); built once and cached
export function buildVfxAtlas() {

	if ( _cache ) return _cache;
	const cell = ATLAS_CELL, n = ATLAS_GRID, size = cell * n;
	const data = new Uint8Array( size * size * 4 );
	for ( let c = 0; c < CELLS.length; c ++ ) {

		const fn = CELLS[ c ];
		const ox = ( c % n ) * cell, oy = Math.floor( c / n ) * cell;
		for ( let py = 0; py < cell; py ++ ) for ( let px = 0; px < cell; px ++ ) {

			const x = ( px + 0.5 ) / cell * 2 - 1;
			const y = 1 - ( py + 0.5 ) / cell * 2;
			// one texel of guard band at the border of every cell
			const guard = px === 0 || py === 0 || px === cell - 1 || py === cell - 1;
			const [ r, g ] = guard ? [ 0, 0 ] : fn( x, y );
			const k = ( ( oy + py ) * size + ox + px ) * 4;
			data[ k ] = Math.round( clamp01( r ) * 255 );
			data[ k + 1 ] = Math.round( clamp01( g ) * 255 );
			data[ k + 2 ] = 0;
			data[ k + 3 ] = 255;

		}

	}

	_cache = { data, size, cell, grid: n };
	return _cache;

}
