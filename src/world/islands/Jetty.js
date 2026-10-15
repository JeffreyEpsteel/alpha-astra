import { Vector3, Color } from '../../engine/index.js';
import { box, cylinder, sphere, mat4 } from '../boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';

// A small timber jetty for the extra islands (the same build as Pons Cove's dock, parametrised): a
// plank deck on piles from `D.start` (on the sand) out over the water to `D.end`, two stringers, a
// cap beam and a pair of piles every 3.2 m, bollards at the head, a crate or two and lantern posts.
// The deck is a walkable collider (its top is D.deckHeight above the sea), the piles are solid.
//
//   const jetty = buildJetty( { D: WORLD.gull.dock, terrain, add, colliders, tag: 'gull', crates: true } );
//   jetty.lights (LocalLights sources), jetty.length, jetty.deckTop, jetty.world( lx, lz ) -> [ x, z ]
//
// Dock frame: lz runs from the sand toward the water along D.heading, lx across (to the right of the
// direction of travel). `add( geometry, options )` collects a prepared geometry (GeoKit prepare).

const WOOD = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.wood, ...o } );
const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );

export function buildJetty( { D, terrain, add, colliders = null, tag = 'jetty', crates = true, seed = 71, lanterns = 2 } ) {

	const h = D.heading, top = D.deckHeight, hw = D.width / 2;
	const L = Math.hypot( D.end.x - D.start.x, D.end.z - D.start.z );
	const T = 0.07; // plank thickness
	let s = seed;
	const rnd = () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );
	const c = Math.cos( h ), sn = Math.sin( h );
	const world = ( lx, lz ) => [ D.start.x + lx * c + lz * sn, D.start.z - lx * sn + lz * c ];
	const at = ( lx, y, lz, ry = 0 ) => {

		const [ x, z ] = world( lx, lz );
		return mat4( x, y, z, 0, h + ry, 0 );

	};

	// deck boards across the jetty, 0.2 m wide with hairline gaps, slightly varied in tone
	const n = Math.floor( L / 0.22 );
	for ( let i = 0; i < n; i ++ ) {

		add( box( D.width, T, 0.2 ), { ...WOODX( [ 0x8a7a64, 0x7d6e5a, 0x92836b, 0x6f6150 ][ Math.floor( rnd() * 4 ) ] ), matrix: at( 0, top - T / 2, 0.11 + i * 0.22 ) } );

	}

	// two stringers under the deck, a cap beam and a pair of piles every 3.2 m
	for ( const sx of [ - 0.65, 0.65 ] ) add( box( 0.14, 0.2, L ), { ...WOOD( 0x5f5243 ), matrix: at( sx, top - T - 0.1, L / 2 ) } );
	const piles = [];
	for ( let lz = 0.6; lz < L; lz += 3.2 ) {

		add( box( 2.0 * hw + 0.3, 0.14, 0.18 ), { ...WOOD( 0x54483a ), matrix: at( 0, top - T - 0.27, lz ) } );
		for ( const sx of [ - hw - 0.1, hw + 0.1 ] ) {

			const [ x, z ] = world( sx, lz );
			const g = Math.min( terrain.heightAt( x, z ), top - 0.2 );
			const len = top + 0.18 - ( g - 0.5 );
			add( cylinder( 0.13, 0.15, len, 8 ), { ...WOOD( 0x4b4034, { rough: 0.95 } ), matrix: mat4( x, g - 0.5 + len / 2, z ) } );
			piles.push( [ x, z, g ] );

		}

	}

	// a bollard each side at the head
	for ( const sx of [ - hw + 0.18, hw - 0.18 ] ) {

		add( cylinder( 0.09, 0.11, 0.38, 10 ), { ...WOOD( 0x3f372e ), matrix: at( sx, top + 0.19, L - 0.35 ) } );
		add( sphere( 0.1, 10, 8 ), { ...WOOD( 0x3f372e ), matrix: at( sx, top + 0.4, L - 0.35 ) } );

	}

	if ( crates ) {

		add( box( 0.6, 0.4, 0.5 ), { ...WOOD( 0x7b6a52 ), matrix: at( hw - 0.45, top + 0.2, 5.0, 0.2 ) } );
		add( box( 0.5, 0.3, 0.42 ), { ...WOOD( 0x6e5e47 ), matrix: at( hw - 0.4, top + 0.55, 5.05, - 0.3 ) } );

	}

	// lantern posts: at the head and (a second one) where the jetty meets the sand
	const lights = [];
	const posts = lanterns >= 2 ? [ [ - hw + 0.12, L - 0.9 ], [ hw - 0.12, 4.0 ] ] : lanterns === 1 ? [ [ - hw + 0.12, L - 0.9 ] ] : [];
	for ( const [ lx, lz ] of posts ) {

		add( box( 0.1, 2.1, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: at( lx, top + 1.05, lz ) } );
		add( box( 0.06, 0.06, 0.4 ), { ...WOOD( 0x6e5f4c ), matrix: at( lx, top + 2.0, lz + 0.15 ) } );
		const [ x, z ] = world( lx, lz + 0.3 );
		add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( x, top + 1.83, z ) } );
		add( cylinder( 0.03, 0.09, 0.05, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( x, top + 1.98, z ) } );
		add( cylinder( 0.09, 0.07, 0.03, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( x, top + 1.7, z ) } );
		lights.push( { position: new Vector3( x, top + 1.83, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );

	}

	if ( colliders ) {

		const [ cx, cz ] = world( 0, L / 2 );
		colliders.addBox( new Vector3( cx, top - 0.15, cz ), new Vector3( hw, 0.15, L / 2 ), h, { walkable: true, tag: tag + 'Deck' } );
		for ( const [ x, z, g ] of piles ) colliders.addCylinder( x, z, 0.15, g - 0.5, top - 0.3, { tag: tag + 'Pile' } );

	}

	return { lights, length: L, deckTop: top, world, piles };

}
