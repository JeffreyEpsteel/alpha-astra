import { cylinder, sphere, mat4 } from '../../boat/GeoKit.js';
import { WOOD, palm, rng } from '../IslandKit.js';
import { TIDEMARK as I, tidemarkWorld } from '../../terrain/IslandShape.js';
import { airstripRects, rectOut } from './TidemarkTerrain.js';
import { isVegetated } from '../../terrain/TerrainTiles.js';

// Tidemark's trees. The home island's instanced vegetation covers the island's terrain tile (wave 13A: Vegetation /
// vegetation/Scatter.js plant every terrain tile, with the grass field): then the island keeps only the palms planted
// along its streets (the quay street, the market street). Without it (?noVeg, a test without the vegetation) the
// IslandKit stand-ins stay: coconut palms along the bay beach and the back of the dunes, broadleaf trees on the hill
// flanks where the tile's woodland mask is, merged into the island's prop meshes. Clear of the roads, the river, the
// town terrace, the graded airstrip (and its approach) and every collider.
//
//   const veg = scatterTrees( { tile, colliders, add, addFar, budget } )   veg.palms, veg.trees (counts), veg.street,
//                                                                        veg.real (the instanced vegetation covers it)
//   townClear( tile, x, z, r, { trees } ) -> bool   a plant of radius r may stand at (x, z) (Scatter.js uses it too;
//                                                 trees: also the strip's approaches and the road margins)

const TOWN = I.pads[ 0 ];
const LOOKOUT = I.pads[ 2 ];
const STRIP = airstripRects();
// the planted street palms, island coordinates: the quay street's water side, the market street east of the square
const STREET_PALMS = [ [ - 150, - 66 ], [ - 150, - 44 ], [ - 150, - 24 ], [ - 150, 38 ], [ - 150, 52 ], [ - 150, 64 ], [ - 100, 2.6 ], [ - 100, 13.4 ], [ - 88, 2.6 ], [ - 88, 13.4 ] ];

export function townClear( tile, x, z, r = 0, { trees = true, lookout = true } = {} ) {

	const [ u, v ] = tile.local( x, z );
	if ( rectOut( u, v, TOWN[ 0 ], TOWN[ 1 ], TOWN[ 2 ], TOWN[ 3 ] ) < ( trees ? 6 : 1 ) ) return false;
	if ( rectOut( u, v, - 154, - 124, - 120, - 84 ) < 4 ) return false; // the boatyard slip
	// the lookout's top (the stand-ins keep clear of its shell through the colliders)
	if ( lookout && rectOut( u, v, LOOKOUT[ 0 ], LOOKOUT[ 1 ], LOOKOUT[ 2 ], LOOKOUT[ 3 ] ) < 3 + r ) return false;
	for ( const R of STRIP ) if ( rectOut( u, v, R[ 0 ], R[ 1 ], R[ 2 ], R[ 3 ] ) < ( trees ? 10 : 1.5 ) ) return false;
	if ( trees ) {

		// the take-off and landing approaches stay clear of trees for 120 m past each end
		if ( Math.abs( v - I.airstrip.v ) < I.airstrip.width && Math.abs( u - I.airstrip.u ) < I.airstrip.length / 2 + 120 ) return false;
		if ( tile.pathDistance( x, z ) < 2.5 + r ) return false;

	}

	const m = tile.maskAt( x, z );
	return m.river <= 0.05 && m.rock <= 0.5;

}

export function scatterTrees( { tile, colliders = null, add, addFar = null, budget = 1 } ) {

	const rnd = rng( 8812 );
	const placed = [];
	const blocked = ( x, z, r ) => {

		if ( colliders ) for ( const b of colliders.boxes ) {

			if ( Math.abs( x - b.center.x ) > b.radius + r + 1 || Math.abs( z - b.center.z ) > b.radius + r + 1 ) continue;
			return true;

		}

		return false;

	};

	// the street palms (always: the town planted them; their own random stream)
	let street = 0;
	const rs = rng( 4471 );
	for ( const [ u, v ] of STREET_PALMS ) {

		const [ x, z ] = tidemarkWorld( u, v );
		if ( blocked( x, z, 1.2 ) ) continue;
		const h = tile.heightAt( x, z );
		palm( add, x, h - 0.1, z, 7 + rs() * 2.5, rs, 0.06 + rs() * 0.12 );
		placed.push( [ x, z, 1.6 ] );
		if ( colliders ) colliders.addCylinder( x, z, 0.25, h - 0.5, h + 3, { tag: 'tidemarkPalm' } );
		street ++;

	}

	if ( isVegetated( tile ) ) return { palms: street, trees: 0, street, real: true };

	const free = ( x, z, r ) => {

		if ( ! townClear( tile, x, z, r, { lookout: false } ) ) return false;
		for ( const p of placed ) if ( ( p[ 0 ] - x ) ** 2 + ( p[ 1 ] - z ) ** 2 < ( r + p[ 2 ] ) ** 2 ) return false;
		if ( colliders ) {

			for ( const b of colliders.boxes ) {

				if ( Math.abs( x - b.center.x ) > b.radius + r + 1 || Math.abs( z - b.center.z ) > b.radius + r + 1 ) continue;
				return false;

			}

		}

		return true;

	};

	// palms: the beach (sand, 0.9 - 4 m up)
	let palms = 0;
	const wantPalms = Math.round( 50 * budget );
	for ( let k = 0; k < 6000 && palms < wantPalms; k ++ ) {

		const x = tile.x0 + rnd() * ( tile.x1 - tile.x0 ), z = tile.z0 + rnd() * ( tile.z1 - tile.z0 );
		const h = tile.heightAt( x, z );
		if ( h < 0.9 || h > 4.5 ) continue;
		if ( tile.maskAt( x, z ).sand < 0.3 && h > 2.2 ) continue;
		if ( ! free( x, z, 1.6 ) ) continue;
		palm( add, x, h - 0.1, z, 6 + rnd() * 4.5, rnd, 0.2 + rnd() * 0.35 );
		placed.push( [ x, z, 1.6 ] );
		if ( colliders ) colliders.addCylinder( x, z, 0.25, h - 0.5, h + 3, { tag: 'tidemarkPalm' } );
		palms ++;

	}

	// broadleaf trees: the woodland on the hill flanks (a far-LOD crown for the landmark hills too)
	let trees = 0;
	const wantTrees = Math.round( 120 * budget );
	for ( let k = 0; k < 12000 && trees < wantTrees; k ++ ) {

		const x = tile.x0 + rnd() * ( tile.x1 - tile.x0 ), z = tile.z0 + rnd() * ( tile.z1 - tile.z0 );
		const h = tile.heightAt( x, z );
		if ( h < 4 ) continue;
		const m = tile.maskAt( x, z );
		if ( m.forest < 0.35 + rnd() * 0.4 ) continue;
		const n = tile.normalAt( x, z );
		if ( n.y < 0.8 ) continue;
		if ( ! free( x, z, 2.4 ) ) continue;
		const s = 0.8 + rnd() * 0.6;
		tree( add, x, h, z, s, rnd );
		if ( addFar ) addFar( sphere( 3.2 * s, 6, 4 ), { color: 0x3e5a2c, rough: 0.9, matrix: mat4( x, h + 6.2 * s, z, 0, 0, 0, 1, 0.8, 1 ) } );
		placed.push( [ x, z, 2.4 * s ] );
		if ( colliders ) colliders.addCylinder( x, z, 0.35 * s, h - 0.5, h + 4 * s, { tag: 'tidemarkTree' } );
		trees ++;

	}

	return { palms: palms + street, trees, street, real: false };

}

// a broadleaf tree: a leaning trunk and three overlapping crown lobes
function tree( add, x, y, z, s, rnd ) {

	const lean = ( rnd() - 0.5 ) * 0.15, yaw = rnd() * Math.PI * 2;
	add( cylinder( 0.22 * s, 0.34 * s, 5 * s, 5 ), { ...WOOD( 0x5a4a3a, { rough: 0.95 } ), matrix: mat4( x, y + 2.4 * s, z, lean, yaw, 0 ) } );
	const greens = [ 0x3f6b2a, 0x4b7a31, 0x36602a, 0x557f38 ];
	for ( let k = 0; k < 3; k ++ ) {

		const a = yaw + k * 2.1, r = 1.3 * s;
		add( sphere( ( 2.3 + rnd() * 0.8 ) * s, 7, 5 ), { color: greens[ Math.floor( rnd() * 4 ) ], rough: 0.85, matrix: mat4( x + Math.cos( a ) * r, y + ( 5.6 + rnd() * 1.4 ) * s, z + Math.sin( a ) * r, 0, rnd() * 3, 0, 1, 0.78, 1 ) } );

	}

}
