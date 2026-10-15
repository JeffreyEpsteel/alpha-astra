import { Group, Mesh, Vector3 } from '../../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, mat4 } from '../../boat/GeoKit.js';
import { PAT } from '../../../game/GameMaterials.js';
import { TIDEMARK as I, tidemarkWorld } from '../../terrain/IslandShape.js';
import { PAINT, frameAt } from '../IslandKit.js';

// Tidemark's airstrip (WORLD.tidemark.airstrip; terrain/IslandShape.js TIDEMARK.airstrip graded it level): painted
// threshold bars and a dashed centreline, edge lights every 32 m and threshold lights at both ends (their glass is the
// emissive lamp mesh: no local lights), the windsock by the apron (its sock turns with G.windDir), fuel drums by the
// hangar (the only colliders out here besides the hangar's walls: the runway, the taxiway and the apron stay clear).
//
//   const strip = buildAirstrip( { terrain, add, addLamp, colliders, material } )
//   strip.sock (the windsock Group: add it to the scene; strip.updateWind( windDir ) turns it), strip.edgeLights (count)

const A = I.airstrip;
const RUN = Math.atan2( I.ax, I.az ); // take-off heading (+u)

// a frame on the runway: lx across (+v side is the town's), lz along the take-off direction, y on the graded surface
const at = ( u, v, yaw = RUN ) => {

	const [ x, z ] = tidemarkWorld( u, v );
	return frameAt( x, A.height, z, yaw );

};

export function buildAirstrip( { terrain, add, addLamp, colliders = null, material = null } ) {

	const paint = PAINT( 0xeeeae0, { rough: 0.8 } );
	const y0 = 0.03;
	// threshold bars: eight 30 m bars at each end (the take-off end and the far end), a bar across, the centreline dashes
	for ( const end of [ - 1, 1 ] ) {

		const uEnd = A.u + end * ( A.length / 2 - 4 - 15 );
		for ( let k = 0; k < 8; k ++ ) {

			const v = A.v - A.width / 2 + 2.2 + k * ( ( A.width - 4.4 ) / 7 );
			add( box( 1.6, 0.04, 28 ), { ...paint, matrix: at( uEnd, v ).m( 0, y0, 0 ) } );

		}

		add( box( A.width - 2, 0.04, 1.4 ), { ...paint, matrix: at( A.u + end * ( A.length / 2 - 2 ), A.v ).m( 0, y0, 0 ) } );

	}

	for ( let u = A.u - A.length / 2 + 45; u < A.u + A.length / 2 - 45; u += 32 ) add( box( 0.8, 0.04, 16 ), { ...paint, matrix: at( u + 8, A.v ).m( 0, y0, 0 ) } );
	// the taxiway's yellow centreline to the apron
	const pv = A.pad[ 1 ];
	for ( let v = A.v + A.width / 2; v < pv - 4; v += 6 ) add( box( 0.4, 0.04, 3.5 ), { color: 0xe0b545, rough: 0.8, matrix: at( A.taxiU, v + 2, RUN + Math.PI / 2 ).m( 0, y0, 0 ) } );

	// edge lights: a short post with a glass cap on both edges, every 32 m; threshold lights (green / red caps) across both ends
	let edgeLights = 0;
	const light = ( u, v, cap ) => {

		const L = at( u, v );
		add( cylinder( 0.05, 0.06, 0.36, 6 ), { color: 0x3a3d40, rough: 0.6, metal: 0.4, matrix: L.m( 0, 0.18, 0 ) } );
		addLamp( cylinder( 0.11, 0.11, 0.14, 8 ), { color: cap, rough: 0.2, matrix: L.m( 0, 0.42, 0 ) } );
		edgeLights ++;

	};

	for ( let u = A.u - A.length / 2; u <= A.u + A.length / 2 + 0.1; u += 32 ) for ( const s of [ - 1, 1 ] ) light( u, A.v + s * ( A.width / 2 + 1.2 ), 0xfff0c8 );
	for ( let k = 0; k < 6; k ++ ) {

		const v = A.v - A.width / 2 + 2 + k * ( ( A.width - 4 ) / 5 );
		light( A.u - A.length / 2 - 2, v, 0x7cf08a ); // the take-off threshold
		light( A.u + A.length / 2 + 2, v, 0xff6a5a ); // the runway's far end

	}

	// fuel drums on a pallet by the hangar (and their collider)
	const [ px, pz ] = tidemarkWorld( A.hangar[ 0 ] - 3, A.hangar[ 1 ] + 10 );
	const D = frameAt( px, A.height, pz, RUN );
	add( box( 2.4, 0.14, 1.3 ), { color: 0x7b6a52, rough: 0.9, pattern: PAT.wood, matrix: D.m( 0, 0.07, 0 ) } );
	for ( let k = 0; k < 4; k ++ ) add( cylinder( 0.29, 0.29, 0.88, 12 ), { ...PAINT( k === 2 ? 0x2f5f8a : 0xb23a2e, { metal: 0.4, pattern: PAT.rusty } ), matrix: D.m( - 0.85 + k * 0.57, 0.58, 0 ) } );
	add( cylinder( 0.29, 0.29, 0.88, 12 ), { ...PAINT( 0xb23a2e, { metal: 0.4, pattern: PAT.rusty } ), matrix: D.m( 1.9, 0.3, 0.2, Math.PI / 2, 0, 0 ) } );
	if ( colliders ) {

		colliders.addBox( new Vector3( px, A.height + 0.5, pz ), new Vector3( 1.25, 0.5, 0.7 ), RUN, { tag: 'tidemarkFuel' } );
		const [ qx, qz ] = D.world( 1.9, 0.2 );
		colliders.addCylinder( qx, qz, 0.5, A.height - 0.1, A.height + 0.6, { tag: 'tidemarkFuel' } );

	}

	// the windsock on its mast at the apron's corner, beside the taxiway (clear of the runway's edge)
	const [ wx, wz ] = tidemarkWorld( A.pad[ 0 ] - A.pad[ 2 ] + 2, A.pad[ 1 ] + A.pad[ 3 ] - 2 );
	add( cylinder( 0.06, 0.09, 6.2, 8 ), { ...PAINT( 0xeeeae0, { metal: 0.3 } ), matrix: mat4( wx, A.height + 3.1, wz ) } );
	add( box( 0.9, 0.06, 0.06 ), { ...PAINT( 0x3a3d40 ), matrix: mat4( wx, A.height + 6.15, wz ) } );
	if ( colliders ) colliders.addCylinder( wx, wz, 0.12, A.height - 0.1, A.height + 6.2, { tag: 'tidemarkWindsock' } );
	const S = [];
	for ( let k = 0; k < 5; k ++ ) {

		const r0 = 0.42 - k * 0.06, r1 = r0 - 0.06;
		// a stripe of the cone, along local +z (downwind), drooping a little
		S.push( prepare( cylinder( r1, r0, 0.62, 10, 1, true ), { color: k % 2 ? 0xeeeae0 : 0xe8692e, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 0, - 0.05 * k, 0.32 + k * 0.62, Math.PI / 2 - 0.08, 0, 0 ) } ) );

	}

	S.push( prepare( cylinder( 0.44, 0.44, 0.06, 12, 1, true ), { color: 0x3a3d40, rough: 0.5, metal: 0.6, matrix: mat4( 0, 0, 0, Math.PI / 2, 0, 0 ) } ) );
	const sock = new Group();
	sock.name = 'TidemarkWindsock';
	sock.position.set( wx, A.height + 5.9, wz );
	if ( material ) {

		const m = new Mesh( mergePrepared( S ), material );
		m.name = 'TidemarkWindsockSock';
		m.castShadow = true;
		sock.add( m );

	}

	return {
		sock, edgeLights,
		// the sock streams downwind: G.windDir is the direction the wind blows toward ( x, z )
		updateWind( dir ) {

			if ( ! dir ) return;
			const x = dir.x, z = dir.y !== undefined ? dir.y : dir.z;
			if ( Number.isFinite( x ) && Number.isFinite( z ) && ( x || z ) ) sock.rotation.y = Math.atan2( x, z );

		},
	};

}
