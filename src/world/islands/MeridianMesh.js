import { BufferGeometry, Float32BufferAttribute, Color } from '../../engine/index.js';
import { WET_REACH, ROUGH_DRY, ROUGH_WET } from './town/TerrainMesh.js';
import { MERIDIAN, cityPlan } from './meridian/CityPlan.js';

// The land meshes of Meridian's terrain tile (MeridianTerrain, wave 21A), drawn with the prop material (vertex colour +
// aux roughness) like Tidemark's and Blackwater's: a regular grid at `step` texels over a range of columns, only the cells
// that reach above `floor` (the open ocean hides the deep floor). The city is paved (the plan's blocks: concrete, the
// docks and the apron lighter, the park and the outer blocks' yards grass), the beaches sand with the wet band at the
// waterline, the hills grass and woods with rock on the steep and on the north-west shore, the seabed darkening with depth.
//
//   meridianLandGeometry( tile, { step = 2, floor = -4, i0 = 0, i1 = n - 1 } ) -> BufferGeometry (position, normal, uv,
//   color, aux)   i0..i1: the columns (texels) the mesh covers (the builder splits the hills and the city plain)

const C = ( hex ) => new Color( hex );
const GRASS = C( 0x6b8a44 ), DRY = C( 0x95925a ), FOREST = C( 0x34502a ), SAND = C( 0xd2bd92 ), WET = C( 0x9a8564 ), ROCK = C( 0x7c766c );
const DARK = C( 0x57524b ), SEABED = C( 0x8a7f66 ), DEEP = C( 0x46524c ), PAVED = C( 0x8c8a85 ), DOCKS = C( 0x9b9890 ), YARD = C( 0x6f8048 );
const PATH = C( 0x7d6f5e ), RIVERBED = C( 0x4d5547 ), APRON = C( 0xa3a099 );

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};
const hash = ( x, z ) => {

	const s = Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453;
	return ( s - Math.floor( s ) ) * 0.4 + 0.3 + 0.3 * Math.sin( x * 0.7 ) * Math.sin( z * 0.6 );

};

// the plan's green ground: the park, and a yard in the middle of each outer block (world boxes)
let _green = null;
function greens() {

	if ( _green ) return _green;
	const plan = cityPlan();
	_green = [];
	for ( const b of plan.blocks ) {

		if ( b.zone === 'park' ) _green.push( [ b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 1 ] );
		else if ( b.zone === 'outer' ) _green.push( [ b.x - b.w / 2 + 6, b.x + b.w / 2 - 6, b.z - b.d / 2 + 26, b.z + b.d / 2 - 26, 0.8 ] );
		else if ( b.zone === 'hills' ) continue;

	}

	return _green;

}

export function meridianLandGeometry( tile, { step = 2, floor = - 4, i0 = 0, i1 = tile.n - 1 } = {} ) {

	const N = tile.n, H = tile.heights, T = tile.texel;
	const cols = [];
	for ( let i = i0; i <= i1; i += step ) cols.push( i );
	if ( cols[ cols.length - 1 ] !== i1 ) cols.push( i1 );
	const rows = [];
	for ( let j = 0; j < N; j += step ) rows.push( j );
	if ( rows[ rows.length - 1 ] !== N - 1 ) rows.push( N - 1 );
	const mc = cols.length, mr = rows.length;
	const keep = new Uint8Array( mc * mr );
	for ( let b = 0; b < mr - 1; b ++ ) for ( let a = 0; a < mc - 1; a ++ ) {

		const h = Math.max( H[ rows[ b ] * N + cols[ a ] ], H[ rows[ b ] * N + cols[ a + 1 ] ], H[ rows[ b + 1 ] * N + cols[ a ] ], H[ rows[ b + 1 ] * N + cols[ a + 1 ] ] );
		if ( h > floor ) keep[ b * mc + a ] = 1;

	}

	const vid = new Int32Array( mc * mr ).fill( - 1 );
	let nv = 0;
	for ( let b = 0; b < mr - 1; b ++ ) for ( let a = 0; a < mc - 1; a ++ ) {

		if ( ! keep[ b * mc + a ] ) continue;
		for ( const k of [ b * mc + a, b * mc + a + 1, ( b + 1 ) * mc + a, ( b + 1 ) * mc + a + 1 ] ) if ( vid[ k ] < 0 ) vid[ k ] = nv ++;

	}

	const pos = new Float32Array( nv * 3 ), nrm = new Float32Array( nv * 3 ), col = new Float32Array( nv * 3 ), uv = new Float32Array( nv * 2 ), aux = new Float32Array( nv * 4 );
	const hAt = ( i, j ) => H[ Math.min( N - 1, Math.max( 0, j ) ) * N + Math.min( N - 1, Math.max( 0, i ) ) ];
	const c = new Color();
	const G = greens(), CX = MERIDIAN.center.x, CZ = MERIDIAN.center.z;
	for ( let b = 0; b < mr; b ++ ) for ( let a = 0; a < mc; a ++ ) {

		const v = vid[ b * mc + a ];
		if ( v < 0 ) continue;
		const gi = cols[ a ], gj = rows[ b ], k = gj * N + gi;
		const x = tile.x0 + gi * T, z = tile.z0 + gj * T, h = H[ k ];
		pos[ v * 3 ] = x; pos[ v * 3 + 1 ] = h; pos[ v * 3 + 2 ] = z;
		const hx = hAt( gi + 1, gj ) - hAt( gi - 1, gj ), hz = hAt( gi, gj + 1 ) - hAt( gi, gj - 1 );
		const e = 2 * T, l = Math.hypot( hx, e, hz );
		nrm[ v * 3 ] = - hx / l; nrm[ v * 3 + 1 ] = e / l; nrm[ v * 3 + 2 ] = - hz / l;
		uv[ v * 2 ] = x; uv[ v * 2 + 1 ] = z;
		aux[ v * 4 ] = ROUGH_DRY;
		const slope = 1 - e / l;
		const rock = Math.max( tile.rock[ k ] / 255, smooth( 0.2, 0.42, slope ) );
		const sand = tile.sand[ k ] / 255, forest = tile.forest[ k ] / 255, path = tile.path[ k ] / 255, paved = tile.paved[ k ] / 255, river = tile.river[ k ] / 255;
		if ( h < 0 ) {

			c.copy( WET ).lerp( SEABED, smooth( 0, 2, - h ) ).lerp( DEEP, smooth( 3, 14, - h ) );
			c.lerp( DARK, rock * 0.5 );
			c.lerp( RIVERBED, river );

		} else {

			c.copy( GRASS ).lerp( DRY, smooth( 0.3, 0.7, hash( x * 0.11, z * 0.13 ) ) * 0.4 );
			c.lerp( FOREST, forest );
			c.lerp( SAND, Math.max( sand, ( 1 - paved ) * ( 1 - smooth( 0.4, 1.4, h ) ) ) );
			const wet = Math.max( sand, 1 - smooth( 0.4, 1.4, h ) ) * ( 1 - rock ) * ( 1 - paved ) * smooth( WET_REACH, WET_REACH * 0.35, h + ( hash( x * 0.31, z * 0.27 ) - 0.5 ) * 0.6 );
			if ( wet > 0 ) {

				c.lerp( WET, wet );
				aux[ v * 4 ] = ROUGH_DRY + ( ROUGH_WET - ROUGH_DRY ) * wet;

			}

			c.lerp( PATH, path * 0.9 );
			if ( paved > 0 ) {

				const u = x - CX;
				const dk = u > 420 || tile.graded( x, z ) > 0;
				const p = c.clone().copy( dk ? ( tile.graded( x, z ) === 2 && z - CZ < - 470 ? APRON : DOCKS ) : PAVED ).multiplyScalar( 0.92 + hash( x * 0.05, z * 0.07 ) * 0.16 );
				// the park and the yards stay green
				let green = 0;
				for ( const g of G ) if ( x > g[ 0 ] && x < g[ 1 ] && z > g[ 2 ] && z < g[ 3 ] ) green = Math.max( green, g[ 4 ] * smooth( 0, 6, Math.min( x - g[ 0 ], g[ 1 ] - x, z - g[ 2 ], g[ 3 ] - z ) ) );
				const green2 = c.clone().copy( YARD ).lerp( GRASS, 0.5 );
				c.copy( p ).lerp( green2, green );
				aux[ v * 4 ] = 0.85;

			}

			c.lerp( ROCK, rock * ( 1 - paved ) );
			c.lerp( RIVERBED, river * 0.8 );

		}

		col[ v * 3 ] = c.r; col[ v * 3 + 1 ] = c.g; col[ v * 3 + 2 ] = c.b;

	}

	const idx = [];
	for ( let b = 0; b < mr - 1; b ++ ) for ( let a = 0; a < mc - 1; a ++ ) {

		if ( ! keep[ b * mc + a ] ) continue;
		const p = vid[ b * mc + a ], q = vid[ b * mc + a + 1 ], r = vid[ ( b + 1 ) * mc + a ], s = vid[ ( b + 1 ) * mc + a + 1 ];
		idx.push( p, r, q, q, r, s );

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
