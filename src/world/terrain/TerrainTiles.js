import { computeShoreField } from '../ShoreField.js';
import { TIDEMARK } from './IslandShape.js';

// The heightmap's extra terrain tiles (wave 13A): islands beyond the 2048 m domain (Tidemark) live on their own height
// grids attached to the TerrainData (TidemarkTerrain.attachTidemark: `terrain._outerTiles`, or a native
// `terrain.tiles`). Everything that reads the domain's data on the GPU or builds fields from it (the water's shallow
// tint, the shore waves, the surf, the grass, the trees, the map) reads the tiles through this module too. Plain math:
// the node tests run the same lookups the shaders do.
//
//   terrainTiles( T ) -> [ { id, x0, z0, n, texel, size, heights, src } ]     n height nodes per side, node (i, j) at
//                                                                              ( x0 + i * texel, z0 + j * texel )
// Heights on the GPU: the domain's r32float height texture grows a strip of rows under the domain's res x res texels
// holding every tile's nodes back to back (row-major, linear texel index L -> texel ( L % W, res + L / W )). No new
// binding: every shader that already reads terrainHeightAt reads the tiles, at +1.75 MB for Tidemark.
//   heightAtlasLayout( T ) -> { width, mainRows, stripRows, texels, tiles: [ { ...tile, offset } ] }
//   buildHeightStrip( layout ) -> Float32Array( width * stripRows )
//   stripHeightAt( layout, strip, x, z ) -> height ( -90 outside every tile ): the WGSL lookup's maths on the CPU
//   tileHeightWGSL( layout, { fn, tex } )   WGSL: fn <fn>( xz ) -> f32, <fn>Hit( xz ) -> bool (inside a tile box),
//                                           <fn>NormalRock( xz ) -> vec4f, <fn>Splat( xz ) -> vec4f
// The shore field (ShoreField.js: arrival time, direction * exposure, shoreline time) of each tile at 4 m, packed the
// same way under the domain's field (TerrainGPU.setShoreField):
//   computeTileShoreFields( T, { swellDir } ) -> [ { id, x0, z0, cell, n, data } ]   (cell-centred like the domain's)
//   shoreTileLayout( tiles ) -> [ { id, x0, z0, size, n, cell, offset } ]
//   packShoreAtlas( field, shoreLayout, tileFields ) -> { data, width, height, mainRes, tiles }
//   shoreAtlasSample( atlas, x, z ) -> [ T, dirX, dirZ, exposure / shore time ] | null   (the WGSL tile branch)
//   tileShoreWGSL( atlas, { fn } )
// Beaches (the breakers' stations and the shore simulation's regions):
//   tileBeaches( T ) -> [ { tile, pts: [ [ x, z, nx, nz ] ] (0.6 m apart, n toward the sea), center: { x, z }, size } ]
// Vegetation: markVegetated( tile ) / isVegetated( tile ) (the instanced vegetation covers it: the island's own
// IslandKit stand-ins step back).
//   mapExtent( T, margin ) -> { x0, z0, size }   the square the world map's picture covers (domain + tiles)

export const OCEAN_FLOOR = - 90;
export const SHORE_CELL = 4; // m: the tiles' shore field cell (the domain's is 2048 / 512)

const f = ( x ) => {

	const s = String( Math.fround( x ) );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

export function terrainTiles( T ) {

	const src = ( T && ( T.tiles || T._outerTiles ) ) || [];
	const out = [];
	for ( const q of src ) {

		if ( ! q || ! q.heights ) continue;
		const n = q.n ?? q.res;
		const texel = q.texel ?? q.size / ( n - 1 );
		out.push( { id: q.id, x0: q.x0, z0: q.z0, n, texel, size: texel * ( n - 1 ), heights: q.heights, src: q } );

	}

	return out;

}

// ------------------------------------------------------------------ heights

export function heightAtlasLayout( T ) {

	const width = T.res;
	let off = 0;
	const tiles = terrainTiles( T ).map( ( t ) => {

		const e = { ...t, offset: off };
		off += t.n * t.n;
		return e;

	} );
	return { width, mainRows: T.res, stripRows: Math.ceil( off / width ), texels: off, tiles, shore: shoreTileLayout( tiles ) };

}

export function buildHeightStrip( layout ) {

	const data = new Float32Array( Math.max( 1, layout.width * layout.stripRows ) );
	for ( const t of layout.tiles ) data.set( t.heights, t.offset );
	return data;

}

// the tile lookup exactly as the WGSL does it (texel ( L % W, mainRows + L / W ) of the atlas = strip[ L ])
export function stripHeightAt( layout, strip, x, z ) {

	const W = layout.width;
	const load = ( L ) => {

		const col = L % W, row = layout.mainRows + Math.floor( L / W );
		return strip[ ( row - layout.mainRows ) * W + col ];

	};
	for ( const t of layout.tiles ) {

		const fx = ( x - t.x0 ) * ( 1 / t.texel ), fz = ( z - t.z0 ) * ( 1 / t.texel );
		if ( ! ( fx >= 0 && fz >= 0 && fx < t.n - 1 && fz < t.n - 1 ) ) continue;
		const i = Math.floor( fx ), j = Math.floor( fz ), tx = fx - i, tz = fz - j;
		const L = t.offset + j * t.n + i;
		const a = load( L ), b = load( L + 1 ), c = load( L + t.n ), d = load( L + t.n + 1 );
		return ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( c * ( 1 - tx ) + d * tx ) * tz;

	}

	return OCEAN_FLOOR;

}

// WGSL of the tile branch (no binding of its own: `tex` is the domain's height atlas)
export function tileHeightWGSL( layout, { fn = 'terrainTile', tex = 'terrainHeightTex' } = {} ) {

	const W = layout.width, R = layout.mainRows;
	let height = '', hit = '';
	for ( const t of layout.tiles ) {

		const n = t.n;
		height += `
	{
		let f = ( xz - vec2f( ${ f( t.x0 ) }, ${ f( t.z0 ) } ) ) * ${ f( 1 / t.texel ) };
		if ( f.x >= 0.0 && f.y >= 0.0 && f.x < ${ f( n - 1 ) } && f.y < ${ f( n - 1 ) } ) {
			let fi = floor( f );
			let ft = f - fi;
			let L = ${ t.offset } + i32( fi.y ) * ${ n } + i32( fi.x );
			let a = ${ fn }Load( L );
			let b = ${ fn }Load( L + 1 );
			let c = ${ fn }Load( L + ${ n } );
			let d = ${ fn }Load( L + ${ n + 1 } );
			return mix( mix( a, b, ft.x ), mix( c, d, ft.x ), ft.y );
		}
	}`;
		hit += ` || ( xz.x >= ${ f( t.x0 ) } && xz.y >= ${ f( t.z0 ) } && xz.x <= ${ f( t.x0 + t.size ) } && xz.y <= ${ f( t.z0 + t.size ) } )`;

	}

	const e = layout.tiles.length ? Math.min( ...layout.tiles.map( ( t ) => t.texel ) ) : 1;
	return /* wgsl */`
// the extra terrain tiles (TerrainTiles.js): nodes packed linearly in the rows under the domain's texels
fn ${ fn }Load( L: i32 ) -> f32 {
	return textureLoad( ${ tex }, vec2i( L % ${ W }, ${ R } + L / ${ W } ), 0 ).x;
}
// bilinear tile height at world xz (-90: no tile here)
fn ${ fn }Height( xz: vec2f ) -> f32 {${ height }
	return ${ f( OCEAN_FLOOR ) };
}
// inside one of the tiles' boxes
fn ${ fn }Hit( xz: vec2f ) -> bool {
	return false${ hit };
}
// macro normal xz, rock (from the slope), AO (1): the layout of the domain's terrainNormalRock
fn ${ fn }NormalRock( xz: vec2f ) -> vec4f {
	let e = ${ f( e ) };
	let hx = ${ fn }Height( xz + vec2f( e, 0.0 ) ) - ${ fn }Height( xz - vec2f( e, 0.0 ) );
	let hz = ${ fn }Height( xz + vec2f( 0.0, e ) ) - ${ fn }Height( xz - vec2f( 0.0, e ) );
	let n = normalize( vec3f( - hx, 2.0 * e, - hz ) );
	return vec4f( n.x, n.z, smoothstep( 0.18, 0.4, 1.0 - n.y ), 1.0 );
}
// splat (sand, paths, gullies / seagrass, rubble): sand on the seabed and up the beach, nothing else
fn ${ fn }Splat( xz: vec2f ) -> vec4f {
	let h = ${ fn }Height( xz );
	return vec4f( select( 1.0 - smoothstep( 0.4, 1.4, h ), 1.0, h < 0.0 ), 0.0, 0.0, 0.0 );
}
`;

}

// ------------------------------------------------------------------ shore field

// One field per tile from ShoreField.js on a stand-in terrain over the tile's box, its arrival times shifted to the
// domain's convention (the plane wave's phase is absolute: T = ( x * sdx + z * sdz ) / c0 + size on the border)
export function computeTileShoreFields( T, { swellDir = [ 0, - 1 ], maxDepth = 25 } = {} ) {

	const out = [];
	const [ sdx, sdz ] = swellDir;
	const c0 = Math.sqrt( 9.81 * maxDepth );
	for ( const t of terrainTiles( T ) ) {

		const res = shoreTileLayout( [ t ] )[ 0 ].n;
		const q = t.src;
		const at = typeof q.heightAt === 'function' ? ( x, z ) => q.heightAt( x, z ) : null;
		if ( ! at ) continue;
		const proxy = { size: t.size, origin: 0, heightAt: ( x, z ) => at( t.x0 + x, t.z0 + z ) };
		const fld = computeShoreField( proxy, { res, swellDir, maxDepth } );
		const shift = ( t.x0 * sdx + t.z0 * sdz ) / c0 + ( ( T.size || t.size ) - t.size );
		const d = fld.data;
		for ( let k = 0; k < d.length; k += 4 ) {

			if ( d[ k ] < 1e5 ) d[ k ] += shift;
			if ( d[ k + 3 ] < 1e5 ) d[ k + 3 ] += shift;

		}

		out.push( { id: t.id, x0: t.x0, z0: t.z0, cell: t.size / res, n: res, size: t.size, data: d } );

	}

	return out;

}

// where each tile's shore field sits in the strip (fixed by the tiles alone: the shader is built before the fields)
export function shoreTileLayout( tiles ) {

	let off = 0;
	return tiles.map( ( t ) => {

		const n = Math.max( 8, Math.round( t.size / SHORE_CELL ) );
		const e = { id: t.id, x0: t.x0, z0: t.z0, size: t.size, n, cell: t.size / n, offset: off };
		off += n * n;
		return e;

	} );

}

// the domain's field (res x res) with the tiles' fields in rows under it (linear, like the heights); a tile without a
// field gets the placeholder's "no waves" (T = 1e4)
export function packShoreAtlas( field, layout, tileFields = [] ) {

	const R = field.res;
	const texels = layout.reduce( ( s, t ) => s + t.n * t.n, 0 );
	const rows = Math.ceil( texels / R );
	const data = new Float32Array( R * ( R + rows ) * 4 );
	data.set( field.data.subarray( 0, R * R * 4 ) );
	for ( const t of layout ) {

		const fld = tileFields.find( ( q ) => q.id === t.id && q.n === t.n );
		const o = ( R * R + t.offset ) * 4;
		if ( fld ) data.set( fld.data, o );
		else for ( let k = 0; k < t.n * t.n; k ++ ) data[ o + k * 4 ] = 1e4;

	}

	return { data, width: R, height: R + rows, mainRes: R, tiles: layout };

}

// the WGSL tile branch on the CPU: bilinear over the cell centres, clamped inside the tile (null: no tile here)
export function shoreAtlasSample( atlas, x, z ) {

	const R = atlas.mainRes, D = atlas.data, base = atlas.base || 0; // base: the floats left off the front (strip only)
	for ( const t of atlas.tiles ) {

		if ( x < t.x0 || z < t.z0 || x > t.x0 + t.size || z > t.z0 + t.size ) continue;
		const fx = Math.min( Math.max( ( x - t.x0 ) / t.cell - 0.5, 0 ), t.n - 1.001 );
		const fz = Math.min( Math.max( ( z - t.z0 ) / t.cell - 0.5, 0 ), t.n - 1.001 );
		const i = Math.floor( fx ), j = Math.floor( fz ), tx = fx - i, tz = fz - j;
		const L = t.offset + j * t.n + i;
		const px = ( l, c ) => D[ ( ( R + Math.floor( l / R ) ) * R + ( l % R ) ) * 4 + c - base ];
		const out = [ 0, 0, 0, 0 ];
		for ( let c = 0; c < 4; c ++ ) out[ c ] = ( px( L, c ) * ( 1 - tx ) + px( L + 1, c ) * tx ) * ( 1 - tz ) + ( px( L + t.n, c ) * ( 1 - tx ) + px( L + t.n + 1, c ) * tx ) * tz;
		return out;

	}

	return null;

}

// WGSL: fn <fn>Shore( xz ) -> vec4f (call where <fn>Hit( xz ); the strip starts at row shoreRes of `tex`)
export function tileShoreWGSL( tiles, { fn = 'terrainTile', tex = 'terrainShoreTex', res = 'terrainParams.shoreRes' } = {} ) {

	let body = '';
	for ( const t of tiles ) {

		body += `
	if ( xz.x >= ${ f( t.x0 ) } && xz.y >= ${ f( t.z0 ) } && xz.x <= ${ f( t.x0 + t.size ) } && xz.y <= ${ f( t.z0 + t.size ) } ) {
		let fp = clamp( ( xz - vec2f( ${ f( t.x0 ) }, ${ f( t.z0 ) } ) ) * ${ f( 1 / t.cell ) } - 0.5, vec2f( 0.0 ), vec2f( ${ f( t.n - 1.001 ) } ) );
		let fi = floor( fp );
		let ft = fp - fi;
		let L = ${ t.offset } + i32( fi.y ) * ${ t.n } + i32( fi.x );
		let a = ${ fn }ShoreLoad( L, R );
		let b = ${ fn }ShoreLoad( L + 1, R );
		let c = ${ fn }ShoreLoad( L + ${ t.n }, R );
		let d = ${ fn }ShoreLoad( L + ${ t.n + 1 }, R );
		return mix( mix( a, b, ft.x ), mix( c, d, ft.x ), ft.y );
	}`;

	}

	return /* wgsl */`
fn ${ fn }ShoreLoad( L: i32, R: i32 ) -> vec4f {
	return textureLoad( ${ tex }, vec2i( L % R, R + L / R ), 0 );
}
// the tiles' shore fields (1e4: no waves, as the placeholder)
fn ${ fn }Shore( xz: vec2f ) -> vec4f {
	let R = i32( ${ res } );${ body }
	return vec4f( 1e4, 0.0, 0.0, 0.0 );
}
`;

}

// ------------------------------------------------------------------ beaches

const _beaches = new WeakMap();

// structures standing on a tile's shore (no surf under them): Tidemark's pier and quay, island coordinates
const rectOut = ( u, v, u0, u1, v0, v1 ) => Math.hypot( Math.max( u0 - u, 0, u - u1 ), Math.max( v0 - v, 0, v - v1 ) );
const KEEP_OUT = {
	tidemark: ( q, x, z ) => {

		const [ u, v ] = q.local( x, z ), P = TIDEMARK.pier, Q = TIDEMARK.quay;
		return rectOut( u, v, Math.min( P.u0, P.u1 ), Math.max( P.u0, P.u1 ), P.v - P.width / 2, P.v + P.width / 2 ) < 8 ||
			rectOut( u, v, Math.min( Q.u0, Q.u1 ), Math.max( Q.u0, Q.u1 ), Q.v0, Q.v1 ) < 6;

	},
};

// Sandy shores of every tile, as ordered runs of stations 0.6 m apart with the unit direction toward the sea. Rays
// from the tile's summit find the first sea along each bearing (bays and coves included: the summit sees them); a
// shore point is beach where the ground 3 m inland is sand (not rock, a river bank, a quay or a pad), the beach face
// is gentle and open water lies 20 m out. Runs shorter than 40 m are dropped.
export function tileBeaches( T, { spacing = 0.6, minRun = 40 } = {} ) {

	const out = [];
	for ( const t of terrainTiles( T ) ) {

		let runs = _beaches.get( t.src );
		if ( ! runs ) _beaches.set( t.src, runs = beachRuns( t, spacing, minRun ) );
		out.push( ...runs );

	}

	return out;

}

function beachRuns( t, spacing, minRun ) {

	const q = t.src, H = t.heights, n = t.n;
	const h = ( x, z ) => q.heightAt( x, z );
	const mask = typeof q.maskAt === 'function' ? ( x, z ) => q.maskAt( x, z ) : null;
	// the summit
	let best = 0;
	for ( let k = 1; k < H.length; k ++ ) if ( H[ k ] > H[ best ] ) best = k;
	if ( H[ best ] <= 1 ) return [];
	const sx = t.x0 + ( best % n ) * t.texel, sz = t.z0 + Math.floor( best / n ) * t.texel;
	const reach = t.size * 0.75;
	const pts = [];
	const RAYS = 2048;
	for ( let r = 0; r < RAYS; r ++ ) {

		const a = r / RAYS * Math.PI * 2, dx = Math.cos( a ), dz = Math.sin( a );
		let prev = 0, hit = null;
		for ( let s = 1; s < reach; s += 1 ) {

			if ( h( sx + dx * s, sz + dz * s ) < 0 ) {

				let lo = prev, hi = s;
				for ( let k = 0; k < 14; k ++ ) {

					const mid = ( lo + hi ) / 2;
					if ( h( sx + dx * mid, sz + dz * mid ) < 0 ) hi = mid; else lo = mid;

				}

				hit = ( lo + hi ) / 2;
				break;

			}

			prev = s;

		}

		pts.push( hit === null ? null : [ sx + dx * hit, sz + dz * hit, dx, dz ] );

	}

	// beach test per shore point (the ray direction stands in for the seaward normal here)
	const keepOut = KEEP_OUT[ t.id ] && typeof q.local === 'function' ? KEEP_OUT[ t.id ] : null;
	const beach = pts.map( ( p ) => {

		if ( ! p ) return false;
		const [ x, z, dx, dz ] = p;
		if ( keepOut && keepOut( q, x, z ) ) return false;
		const ix = x - dx * 3, iz = z - dz * 3;
		if ( mask ) {

			const m = mask( ix, iz );
			if ( m.sand < 0.45 || m.rock > 0.3 || m.river > 0.05 || m.path > 0.5 ) return false;

		}

		if ( typeof q.graded === 'function' && q.graded( ix, iz ) > 0 ) return false;
		if ( ( h( x - dx * 8, z - dz * 8 ) - h( x + dx * 8, z + dz * 8 ) ) / 16 > 0.25 ) return false;
		return h( x + dx * 20, z + dz * 20 ) < - 0.5 && h( x - dx * 2, z - dz * 2 ) < 2.5;

	} );

	// consecutive beach points (in bearing order, wrapping round) closer than 6 m form a run
	const runs = [];
	let cur = [];
	const start = beach.findIndex( ( b ) => ! b );
	const s0 = start < 0 ? 0 : start;
	for ( let k = 0; k <= RAYS; k ++ ) {

		const i = ( s0 + k ) % RAYS;
		const p = pts[ i ];
		const near = cur.length && p && Math.hypot( p[ 0 ] - cur[ cur.length - 1 ][ 0 ], p[ 1 ] - cur[ cur.length - 1 ][ 1 ] ) < 6;
		if ( beach[ i ] && k < RAYS && ( ! cur.length || near ) ) {

			cur.push( p );
			continue;

		}

		if ( cur.length > 1 ) runs.push( cur );
		cur = beach[ i ] && k < RAYS ? [ p ] : [];

	}

	const out = [];
	for ( const run of runs ) {

		// smooth (the transects should not follow every wiggle of the waterline), then resample by arc length
		let sm = run.map( ( p ) => [ p[ 0 ], p[ 1 ] ] );
		for ( let it = 0; it < 30; it ++ ) sm = sm.map( ( p, k ) => ( k === 0 || k === sm.length - 1 ? p : [ ( sm[ k - 1 ][ 0 ] + 2 * p[ 0 ] + sm[ k + 1 ][ 0 ] ) * 0.25, ( sm[ k - 1 ][ 1 ] + 2 * p[ 1 ] + sm[ k + 1 ][ 1 ] ) * 0.25 ] ) );
		let L = 0;
		for ( let k = 1; k < sm.length; k ++ ) L += Math.hypot( sm[ k ][ 0 ] - sm[ k - 1 ][ 0 ], sm[ k ][ 1 ] - sm[ k - 1 ][ 1 ] );
		if ( L < minRun ) continue;
		const st = [];
		let acc = 0, next = 0;
		for ( let k = 1; k < sm.length; k ++ ) {

			const [ ax, az ] = sm[ k - 1 ], [ bx, bz ] = sm[ k ];
			const seg = Math.hypot( bx - ax, bz - az );
			if ( seg < 1e-6 ) continue;
			const tx = ( bx - ax ) / seg, tz = ( bz - az ) / seg;
			while ( next <= acc + seg ) {

				const u = ( next - acc ) / seg;
				const x = ax + ( bx - ax ) * u, z = az + ( bz - az ) * u;
				// normal toward the sea: the side of the polyline where the ground is lower
				let nx = - tz, nz = tx;
				if ( h( x + nx * 6, z + nz * 6 ) > h( x - nx * 6, z - nz * 6 ) ) { nx = - nx; nz = - nz; }
				st.push( [ x, z, nx, nz ] );
				next += spacing;

			}

			acc += seg;

		}

		let x0 = Infinity, x1 = - Infinity, z0 = Infinity, z1 = - Infinity;
		for ( const [ x, z ] of st ) { x0 = Math.min( x0, x ); x1 = Math.max( x1, x ); z0 = Math.min( z0, z ); z1 = Math.max( z1, z ); }
		out.push( { tile: t.id, pts: st, length: L, center: { x: ( x0 + x1 ) / 2, z: ( z0 + z1 ) / 2 }, size: Math.min( 480, Math.max( 200, Math.max( x1 - x0, z1 - z0 ) + 80 ) ) } );

	}

	return out;

}

// ------------------------------------------------------------------ vegetation, map

const VEGETATED = new WeakSet();
export const markVegetated = ( tile ) => tile && VEGETATED.add( tile.src || tile );
export const isVegetated = ( tile ) => !! tile && VEGETATED.has( tile.src || tile );

export function mapExtent( T, margin = 60 ) {

	const half = T.size / 2;
	let x0 = T.origin, z0 = T.origin, x1 = T.origin + T.size, z1 = T.origin + T.size;
	for ( const t of terrainTiles( T ) ) {

		x0 = Math.min( x0, t.x0 - margin ); z0 = Math.min( z0, t.z0 - margin );
		x1 = Math.max( x1, t.x0 + t.size + margin ); z1 = Math.max( z1, t.z0 + t.size + margin );

	}

	const size = Math.max( x1 - x0, z1 - z0, 2 * half );
	return { x0: ( x0 + x1 ) / 2 - size / 2, z0: ( z0 + z1 ) / 2 - size / 2, size };

}
