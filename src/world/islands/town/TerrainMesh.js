import { BufferGeometry, Float32BufferAttribute, Color } from '../../../engine/index.js';

// Meshes of Tidemark's terrain tile (TidemarkTerrain): a regular grid at `step` texels, only the cells that reach above
// `floor` (the deep sea floor round the island is never drawn: the open ocean hides it), vertex colours from the tile's
// masks (sand, grass, woodland, rock, worn roads, the graded strip, the seabed darkening with depth) and the prop
// material's aux layout (roughness, metalness, pattern 0, no animation). Normals from the height grid.
//
//   terrainGeometry( tile, { step = 2, floor = -30, colors = true } ) -> BufferGeometry (indexed, uint32 when needed)
//   riverGeometry( tile ) -> BufferGeometry | null   the stream's water ribbon above sea level (down to the estuary)

const C = ( hex ) => new Color( hex ); // engine Colors are linear: set( hex ) converts from sRGB
const SAND = C( 0xcdb88f ), WET = C( 0x8f7d5c ), DEEP = C( 0x4f5a52 ), GRASS = C( 0x6f8a42 ), DRY = C( 0x9a9455 ), FOREST = C( 0x3f5a2a );
const ROCK = C( 0x7a746b ), DARK = C( 0x55504a ), PATH = C( 0x8f785a ), STRIP = C( 0x7f8a55 ), PAD = C( 0x8a8478 );
// wave 19A: the wet band of the main terrain (Terrain.js), baked per vertex: the sand within ~1.5 m of the waterline darker
// (the wet albedo) and glossy (roughness 0.95 -> 0.3 at the edge); no shore sim on the tiles, so it holds still
const WET_SAND = C( 0x958161 );
export const WET_REACH = 1.5, ROUGH_DRY = 0.95, ROUGH_WET = 0.3;

export function terrainGeometry( tile, { step = 2, floor = - 30, colors = true } = {} ) {

	const N = tile.n, H = tile.heights, T = tile.texel;
	const m = Math.floor( ( N - 1 ) / step ) + 1;
	const keep = new Uint8Array( m * m );
	for ( let j = 0; j < m - 1; j ++ ) for ( let i = 0; i < m - 1; i ++ ) {

		const a = H[ ( j * step ) * N + i * step ], b = H[ ( j * step ) * N + ( i + 1 ) * step ];
		const c = H[ ( ( j + 1 ) * step ) * N + i * step ], d = H[ ( ( j + 1 ) * step ) * N + ( i + 1 ) * step ];
		if ( Math.max( a, b, c, d ) > floor ) keep[ j * m + i ] = 1;

	}

	// vertices used by kept cells
	const vid = new Int32Array( m * m ).fill( - 1 );
	let nv = 0;
	for ( let j = 0; j < m - 1; j ++ ) for ( let i = 0; i < m - 1; i ++ ) {

		if ( ! keep[ j * m + i ] ) continue;
		for ( const k of [ j * m + i, j * m + i + 1, ( j + 1 ) * m + i, ( j + 1 ) * m + i + 1 ] ) if ( vid[ k ] < 0 ) vid[ k ] = nv ++;

	}

	const pos = new Float32Array( nv * 3 ), nrm = new Float32Array( nv * 3 ), col = new Float32Array( nv * 3 ), uv = new Float32Array( nv * 2 ), aux = new Float32Array( nv * 4 );
	const hAt = ( i, j ) => H[ Math.min( N - 1, Math.max( 0, j ) ) * N + Math.min( N - 1, Math.max( 0, i ) ) ];
	const c = new Color();
	for ( let j = 0; j < m; j ++ ) for ( let i = 0; i < m; i ++ ) {

		const v = vid[ j * m + i ];
		if ( v < 0 ) continue;
		const gi = i * step, gj = j * step, k = gj * N + gi;
		const x = tile.x0 + gi * T, z = tile.z0 + gj * T, h = H[ k ];
		pos[ v * 3 ] = x; pos[ v * 3 + 1 ] = h; pos[ v * 3 + 2 ] = z;
		const hx = hAt( gi + step, gj ) - hAt( gi - step, gj ), hz = hAt( gi, gj + step ) - hAt( gi, gj - step );
		const e = 2 * step * T, l = Math.hypot( hx, e, hz );
		nrm[ v * 3 ] = - hx / l; nrm[ v * 3 + 1 ] = e / l; nrm[ v * 3 + 2 ] = - hz / l;
		uv[ v * 2 ] = x; uv[ v * 2 + 1 ] = z;
		aux[ v * 4 ] = ROUGH_DRY;
		if ( colors ) {

			const slope = 1 - e / l; // 0 flat .. 1 vertical
			const rock = Math.max( tile.rock[ k ] / 255, smooth( 0.18, 0.4, slope ) );
			const sand = tile.sand[ k ] / 255, path = tile.path[ k ] / 255, forest = tile.forest[ k ] / 255;
			if ( h < 0 ) {

				c.copy( WET ).lerp( DEEP, smooth( 0, 14, - h ) );
				c.lerp( DARK, rock * 0.6 );

			} else {

				c.copy( GRASS ).lerp( DRY, smooth( 0.3, 0.7, hash( x * 0.11, z * 0.13 ) ) * 0.4 );
				c.lerp( FOREST, forest );
				c.lerp( SAND, Math.max( sand, 1 - smooth( 0.4, 1.4, h ) ) );
				const graded = tile.graded ? tile.graded( x, z ) : 0;
				if ( graded > 0 ) c.lerp( graded > 1.5 ? PAD : STRIP, Math.min( 1, graded ) );
				c.lerp( PATH, path * 0.85 );
				c.lerp( ROCK, rock );
				// the wet band (mottled: the hash moves its top edge by ~0.3 m)
				const wet = Math.max( sand, 1 - smooth( 0.4, 1.4, h ) ) * ( 1 - rock ) * ( 1 - path ) * ( graded > 0 ? 0 : 1 ) * smooth( WET_REACH, WET_REACH * 0.35, h + ( hash( x * 0.31, z * 0.27 ) - 0.5 ) * 0.6 );
				if ( wet > 0 ) {

					c.lerp( WET_SAND, wet );
					aux[ v * 4 ] = ROUGH_DRY + ( ROUGH_WET - ROUGH_DRY ) * wet;

				}

			}

			col[ v * 3 ] = c.r; col[ v * 3 + 1 ] = c.g; col[ v * 3 + 2 ] = c.b;

		} else {

			col[ v * 3 ] = 0.4; col[ v * 3 + 1 ] = 0.42; col[ v * 3 + 2 ] = 0.3;

		}

	}

	const idx = [];
	for ( let j = 0; j < m - 1; j ++ ) for ( let i = 0; i < m - 1; i ++ ) {

		if ( ! keep[ j * m + i ] ) continue;
		const a = vid[ j * m + i ], b = vid[ j * m + i + 1 ], cc = vid[ ( j + 1 ) * m + i ], d = vid[ ( j + 1 ) * m + i + 1 ];
		// +z rows down, +x columns right: counter-clockwise seen from above (y up)
		idx.push( a, cc, b, b, cc, d );

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nrm, 3 ) );
	g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
	g.setAttribute( 'color', new Float32BufferAttribute( col, 3 ) );
	g.setAttribute( 'aux', new Float32BufferAttribute( aux, 4 ) );
	g.setIndex( idx );
	g.computeBoundingBox();
	g.computeBoundingSphere();
	return g;

}

// the stream: a ribbon 0.25 m over the bed from the spring down to where the bed meets the sea
export function riverGeometry( tile, pts, width ) {

	const toW = ( u, v ) => tile.world( u, v );
	const samples = [];
	let L = 0;
	for ( let k = 0; k < pts.length - 1; k ++ ) L += Math.hypot( pts[ k + 1 ][ 0 ] - pts[ k ][ 0 ], pts[ k + 1 ][ 1 ] - pts[ k ][ 1 ] );
	let acc = 0;
	for ( let k = 0; k < pts.length - 1; k ++ ) {

		const a = pts[ k ], b = pts[ k + 1 ], l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		const n = Math.max( 1, Math.ceil( l / 3 ) );
		for ( let s = 0; s < n; s ++ ) {

			const f = s / n, t = ( acc + l * f ) / L;
			const bed = tile.riverBed( t );
			if ( bed + 0.25 < 0.05 ) continue;
			samples.push( { u: a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * f, v: a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * f, y: bed + 0.25, du: ( b[ 0 ] - a[ 0 ] ) / l, dv: ( b[ 1 ] - a[ 1 ] ) / l, w: width * ( 1 + 1.4 * smooth( 0.7, 1, t ) ) } );

		}

		acc += l;

	}

	if ( samples.length < 2 ) return null;
	const pos = [], nrm = [], uv = [], idx = [];
	samples.forEach( ( s, i ) => {

		for ( const side of [ - 1, 1 ] ) {

			const [ x, z ] = toW( s.u - s.dv * side * s.w * 0.75, s.v + s.du * side * s.w * 0.75 );
			pos.push( x, s.y, z );
			nrm.push( 0, 1, 0 );
			uv.push( side, i * 3 );

		}

		if ( i > 0 ) {

			const a = ( i - 1 ) * 2, b = i * 2;
			idx.push( a, a + 1, b, a + 1, b + 1, b );

		}

	} );
	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nrm, 3 ) );
	g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
	g.setIndex( idx );
	return g;

}

function smooth( a, b, x ) {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

}

function hash( x, z ) {

	const s = Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453;
	return ( s - Math.floor( s ) ) * 0.4 + 0.3 + 0.3 * Math.sin( x * 0.7 ) * Math.sin( z * 0.6 );

}
