import { Color } from '../../engine/index.js';
import { terrainGeometry, WET_REACH, ROUGH_DRY, ROUGH_WET } from './town/TerrainMesh.js';
import { BLACKWATER as I } from '../terrain/IslandShape.js';

// The land mesh of Blackwater's terrain tile (BlackwaterTerrain, wave 14D). The island used to be drawn by the heightmap's
// terrain chunks; on its own tile it needs a mesh like Tidemark's. The grid, the floor cut-off, the normals and the prop
// material's aux layout are town/TerrainMesh.terrainGeometry's (it takes any tile with n / heights / texel / x0 / z0); only
// the vertex colours are Blackwater's own, from the tile's masks: black volcanic sand on the crescent and the beaches, wet
// darker sand at the waterline, dark basalt on the ring and the cliffs, scrub green in the sheltered pockets and on the
// flanks, packed earth on the paths and the pads' yards, the seabed darkening with depth and a silty caldera floor under the cove.
//
//   blackwaterLandGeometry( tile, { step = 2, floor = -30 } ) -> BufferGeometry (position, normal, uv, color, aux)

const C = ( hex ) => new Color( hex ); // engine Colors are linear: set( hex ) converts from sRGB
const SAND = C( 0x3b3631 ), WET = C( 0x1e1c1b ), SEABED = C( 0x3a3832 ), DEEP = C( 0x1c2626 ), CALDERA = C( 0x262a26 );
const SCRUB = C( 0x4f5c33 ), DRY = C( 0x67633d ), FOREST = C( 0x2f4126 ), BASALT = C( 0x433f3c ), DARK = C( 0x262524 ), PATH = C( 0x5e4f3e );

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};
const hash = ( x, z ) => {

	const s = Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453;
	return ( s - Math.floor( s ) ) * 0.4 + 0.3 + 0.3 * Math.sin( x * 0.7 ) * Math.sin( z * 0.6 );

};

export function blackwaterLandGeometry( tile, { step = 2, floor = - 30 } = {} ) {

	const g = terrainGeometry( tile, { step, floor, colors: false } );
	const pos = g.getAttribute( 'position' ).array, nrm = g.getAttribute( 'normal' ).array, col = g.getAttribute( 'color' ).array;
	const aux = g.getAttribute( 'aux' ).array; // (x: roughness)
	const N = tile.n, T = tile.texel, c = new Color();
	for ( let v = 0; v < pos.length / 3; v ++ ) {

		const x = pos[ v * 3 ], h = pos[ v * 3 + 1 ], z = pos[ v * 3 + 2 ];
		const i = Math.min( N - 1, Math.max( 0, Math.round( ( x - tile.x0 ) / T ) ) ), j = Math.min( N - 1, Math.max( 0, Math.round( ( z - tile.z0 ) / T ) ) );
		const k = j * N + i;
		const slope = 1 - nrm[ v * 3 + 1 ]; // 0 flat .. 1 vertical
		const rock = Math.max( tile.rock[ k ] / 255, smooth( 0.2, 0.42, slope ) );
		const sand = tile.sand[ k ] / 255, path = tile.path[ k ] / 255, forest = tile.forest[ k ] / 255;
		if ( h < 0 ) {

			c.copy( WET ).lerp( SEABED, smooth( 0, 3, - h ) ).lerp( DEEP, smooth( 4, 30, - h ) );
			// the cove: the caldera's silty floor inside the ring
			const [ u, w ] = tile.local( x, z );
			const iu = u / I.atoll[ 0 ], iv = w / I.atoll[ 1 ];
			c.lerp( CALDERA, ( 1 - smooth( 0.85, 1.05, Math.sqrt( iu * iu + iv * iv ) ) ) * smooth( 1.5, 5, - h ) );
			c.lerp( DARK, rock * 0.6 );

		} else {

			c.copy( SCRUB ).lerp( DRY, smooth( 0.3, 0.7, hash( x * 0.11, z * 0.13 ) ) * 0.45 );
			c.lerp( FOREST, forest );
			c.lerp( SAND, Math.max( sand, 1 - smooth( 0.4, 1.4, h ) ) );
			// the wet band (wave 19A, TerrainMesh's): the black sand within ~1.5 m of the waterline darker and glossy
			const edge = 1 - smooth( 0.05, 0.6, h );
			const wet = Math.max( edge, Math.max( sand, 1 - smooth( 0.4, 1.4, h ) ) * ( 1 - rock ) * ( 1 - path ) * smooth( WET_REACH, WET_REACH * 0.35, h + ( hash( x * 0.31, z * 0.27 ) - 0.5 ) * 0.6 ) * 0.85 );
			c.lerp( WET, wet );
			aux[ v * 4 ] = ROUGH_DRY + ( ROUGH_WET - ROUGH_DRY ) * wet * ( 1 - rock );
			c.lerp( PATH, path * 0.8 );
			c.lerp( BASALT, rock ).lerp( DARK, rock * smooth( 0.35, 0.7, slope ) * 0.6 );

		}

		col[ v * 3 ] = c.r; col[ v * 3 + 1 ] = c.g; col[ v * 3 + 2 ] = c.b;

	}

	return g;

}
