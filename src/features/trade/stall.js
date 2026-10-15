import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, torus, sphere, mat4, triangleCount } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { WORLD } from '../../world/WorldLayout.js';
import { ponsWorld } from '../../world/terrain/IslandShape.js';

// The two market stalls of the merchant trade: a plank platform with a counter, a ledger and scales, shelves of
// jars behind, a striped awning on four posts, crates, a barrel and a coil of rope beside it, and a hanging sign
// with a gold coin. One merged mesh per stall (about 4k triangles, one draw call each).
//
// Sites (world metres, yaw = the way the customer side +z faces):
//   home  57.8, -75.2   east of the boardwalk up from the pier foot, facing it; PoorGoat's fish stand (49.9, -74.6) is across
//                       the boardwalk, 8 m away, facing the other way, so the two make a little market lane
//   pons  island frame (-86, -13)   on the beach 8 m along from Pons's stall (-85, -5), same yaw (facing the dock)
//
//   const s = new TradeStall( { scene, terrain, colliders, site: STALL_SITES.home, variant: 'home' } );
//   s.group, s.lights (add to localLights), s.front (the point customers stand at), s.dispose()

const [ PX, PZ ] = ponsWorld( - 86, - 13 );
export const STALL_SITES = {
	home: { x: 57.8, z: - 75.2, yaw: - 1.45 },
	pons: { x: Math.round( PX * 10 ) / 10, z: Math.round( PZ * 10 ) / 10, yaw: WORLD.pons.dock.heading },
};

const FRONT = 1.5; // m in front of the stall's centre: where the E prompt is measured from
const VARIANTS = {
	home: { awnA: 0xb5483a, awnB: 0xe9dfc8, board: 0x24425a },
	pons: { awnA: 0x2f8f86, awnB: 0xf0d9a0, board: 0x4a2f22 },
};

// local (lx across, lz toward the customer) to the world, for a stall at ( x, z ) turned by yaw
export function stallWorld( site, lx, lz ) {

	const c = Math.cos( site.yaw ), s = Math.sin( site.yaw );
	return [ site.x + lx * c + lz * s, site.z - lx * s + lz * c ];

}

export function stallFront( site ) {

	const [ x, z ] = stallWorld( site, 0, FRONT );
	return { x, z };

}

export function buildStallGeometry( variant = 'home' ) {

	const V = VARIANTS[ variant ] || VARIANTS.home;
	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	let seed = variant === 'pons' ? 41 : 17;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;
	const WOOD = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.wood, ...o } );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const CLOTH = ( c ) => ( { color: c, rough: 0.95, pattern: PAT.cloth } );
	const METAL = ( c, r = 0.35 ) => ( { color: c, rough: r, metal: 1 } );

	// plinth under the platform (buried on a slope), the platform boards, the counter and its top
	add( box( 3.1, 0.5, 3.0 ), { ...WOOD( 0x5d4e3b ), matrix: mat4( 0, - 0.25, - 0.05 ) } );
	for ( let i = 0; i < 6; i ++ ) add( box( 3.0, 0.08, 0.5 ), { ...WOODX( [ 0x8e7e68, 0x7d6d5a, 0x958670, 0x84745f, 0x8a7a64, 0x7a6a56 ][ i ] ), matrix: mat4( jit( 0.02 ), - 0.02, - 1.3 + i * 0.52, 0, jit( 0.012 ), 0 ) } );
	add( box( 2.3, 0.78, 0.55 ), { ...WOODX( 0x7a6b58 ), matrix: mat4( 0, 0.41, 0.4 ) } );
	add( box( 2.5, 0.06, 0.75 ), { ...WOODX( 0x9a8a72 ), matrix: mat4( 0, 0.83, 0.4 ) } );

	// on the counter: scales (post, beam, pan, weight), the ledger and an ink pot, a dish of pearls, a coin stack
	add( cylinder( 0.03, 0.04, 0.4, 8 ), { ...METAL( 0x555a5d, 0.4 ), matrix: mat4( - 0.8, 1.06, 0.35 ) } );
	add( box( 0.55, 0.025, 0.03 ), { ...METAL( 0x6a6f72, 0.4 ), matrix: mat4( - 0.8, 1.25, 0.35 ) } );
	add( cylinder( 0.17, 0.15, 0.025, 14 ), { ...METAL( 0x9aa0a3 ), matrix: mat4( - 1.05, 1.1, 0.35 ) } );
	add( cylinder( 0.17, 0.15, 0.025, 14 ), { ...METAL( 0x9aa0a3 ), matrix: mat4( - 0.55, 1.14, 0.35 ) } );
	add( box( 0.36, 0.045, 0.26 ), { color: V.awnA, rough: 0.7, pattern: PAT.plain, matrix: mat4( 0.1, 0.885, 0.42, 0, 0.35, 0 ) } );
	add( box( 0.32, 0.03, 0.22 ), { color: 0xeee6cf, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 0.1, 0.915, 0.42, 0, 0.35, 0 ) } );
	add( cylinder( 0.035, 0.04, 0.07, 8 ), { color: 0x1b1e22, rough: 0.3, matrix: mat4( 0.38, 0.895, 0.3 ) } );
	add( cylinder( 0.1, 0.07, 0.04, 12 ), { color: 0x8a6a43, rough: 0.8, pattern: PAT.wood, matrix: mat4( 0.62, 0.88, 0.42 ) } );
	for ( let i = 0; i < 5; i ++ ) add( sphere( 0.028, 8, 6 ), { color: 0xf0eaf6, rough: 0.2, metal: 0.2, matrix: mat4( 0.59 + ( i % 3 ) * 0.032, 0.918 + ( i > 2 ? 0.03 : 0 ), 0.4 + ( i % 2 ) * 0.03 ) } );
	for ( let i = 0; i < 4; i ++ ) add( cylinder( 0.035, 0.035, 0.012, 12 ), { ...METAL( 0xd9a441, 0.3 ), matrix: mat4( 0.88, 0.866 + i * 0.013, 0.5 ) } );

	// a crate of coconuts on the counter's end
	add( box( 0.5, 0.2, 0.36 ), { ...WOOD( 0x7b6a52 ), matrix: mat4( 0.95, 0.96, 0.3, 0, 0.1, 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( sphere( 0.075, 8, 6 ), { color: 0x6a4b2a, rough: 0.85, matrix: mat4( 0.82 + i * 0.1, 1.1, 0.28 + ( i % 2 ) * 0.08 ) } );

	// back wall with three shelves of jars, bottles and coils
	add( box( 2.7, 2.0, 0.06 ), { ...WOODX( 0x7a6e5a ), matrix: mat4( 0, 1.0, - 1.3 ) } );
	for ( const y of [ 0.62, 1.2, 1.78 ] ) add( box( 2.5, 0.05, 0.4 ), { ...WOOD( 0x6b5b45 ), matrix: mat4( 0, y, - 1.08 ) } );
	const jars = [ 0xb5642f, 0x7a3a22, 0xd9812b, 0xe6d9b8, 0x6e8a3c, 0xc9a86a, 0x8e3b2a, 0xd9812b ];
	for ( let i = 0; i < 8; i ++ ) {

		const sh = i % 3;
		const y = [ 0.62, 1.2, 1.78 ][ sh ] + 0.025;
		const h = sh === 0 ? 0.3 : 0.2;
		add( cylinder( 0.07, 0.075, h, 10 ), { color: jars[ i ], rough: 0.35, metal: 0.05, matrix: mat4( - 1.0 + i * 0.28 + jit( 0.06 ), y + h / 2, - 1.08 + jit( 0.1 ) ) } );

	}

	for ( let i = 0; i < 3; i ++ ) add( torus( 0.2 - i * 0.02, 0.05, 6, 16 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 0.5 + i * 0.5, 1.28 + i * 0.0, - 1.08, Math.PI / 2, 0, 0 ) } );
	for ( const y of [ 0.62, 1.2, 1.78 ] ) for ( const x of [ - 1.3, 1.3 ] ) add( box( 0.06, 0.06, 0.4 ), { ...WOOD( 0x5d4e3b ), matrix: mat4( x, y - 0.05, - 1.08 ) } );

	// posts and the awning: stripes sloping down toward the customer, a valance, front and back beams
	for ( const [ x, z ] of [ [ - 1.38, 0.95 ], [ 1.38, 0.95 ], [ - 1.38, - 1.3 ], [ 1.38, - 1.3 ] ] ) add( box( 0.09, 2.6, 0.09 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( x, 1.3, z ) } );
	add( box( 3.0, 0.08, 0.08 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 0, 2.46, 0.95 ) } );
	add( box( 3.0, 0.08, 0.08 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 0, 2.7, - 1.3 ) } );
	const SLOPE = 0.11;
	for ( let i = 0; i < 6; i ++ ) {

		const x = - 1.25 + i * 0.5, col = i % 2 ? V.awnB : V.awnA;
		add( box( 0.5, 0.035, 2.9 ), { ...CLOTH( col ), matrix: mat4( x, 2.62, - 0.1, SLOPE, 0, 0 ) } );
		add( box( 0.5, 0.2, 0.025 ), { ...CLOTH( col ), matrix: mat4( x, 2.36, 1.33 ) } );

	}

	// hanging sign on an arm out of the right front post: a dark board with a gold coin
	add( box( 0.06, 0.06, 1.0 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 1.38, 2.52, 1.4 ) } );
	for ( const x of [ - 0.22, 0.22 ] ) add( box( 0.015, 0.2, 0.015 ), { ...METAL( 0x333333 ), matrix: mat4( 1.38 + x, 2.38, 1.85 ) } );
	add( box( 0.6, 0.46, 0.05 ), { color: V.board, rough: 0.7, pattern: PAT.wood, matrix: mat4( 1.38, 2.05, 1.85 ) } );
	add( cylinder( 0.16, 0.16, 0.03, 20 ), { ...METAL( 0xd9a441, 0.3 ), matrix: mat4( 1.38, 2.05, 1.89, Math.PI / 2, 0, 0 ) } );
	add( cylinder( 0.115, 0.115, 0.034, 20 ), { ...METAL( 0xf0c46a, 0.25 ), matrix: mat4( 1.38, 2.05, 1.895, Math.PI / 2, 0, 0 ) } );

	// beside the stall: stacked crates and a sack on the left, a barrel and a rope coil on the right
	add( box( 0.72, 0.46, 0.56 ), { ...WOOD( 0x7b6a52 ), matrix: mat4( - 2.0, 0.23, 0.45, 0, 0.12, 0 ) } );
	add( box( 0.58, 0.4, 0.5 ), { ...WOOD( 0x6e5e47 ), matrix: mat4( - 1.96, 0.66, 0.42, 0, - 0.22, 0 ) } );
	add( box( 0.6, 0.42, 0.5 ), { ...WOOD( 0x84745a ), matrix: mat4( - 2.05, 0.21, - 0.4, 0, 0.3, 0 ) } );
	add( sphere( 0.3, 10, 8 ), { color: 0xcdb98e, rough: 0.95, pattern: PAT.cloth, matrix: mat4( - 1.95, 0.17, 1.25, 0, 0.5, 0, 1.15, 0.62, 0.9 ) } );
	add( cylinder( 0.3, 0.27, 0.8, 12 ), { ...WOOD( 0x5b4a39 ), matrix: mat4( 2.0, 0.4, 0.45 ) } );
	for ( const y of [ 0.2, 0.62 ] ) add( torus( 0.295, 0.016, 6, 16 ), { ...METAL( 0x44484a, 0.5 ), matrix: mat4( 2.0, y, 0.45, Math.PI / 2, 0, 0 ) } );
	for ( let i = 0; i < 3; i ++ ) add( torus( 0.27 - i * 0.015, 0.055, 6, 16 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 2.0, 0.07 + i * 0.1, 1.25, Math.PI / 2, 0, 0 ) } );

	// the lantern on the left front post
	add( box( 0.05, 0.05, 0.28 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( - 1.38, 2.2, 1.08 ) } );
	add( cylinder( 0.07, 0.07, 0.22, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( - 1.38, 2.02, 1.18 ) } );
	return mergePrepared( P );

}

export class TradeStall {

	constructor( { scene, terrain, colliders = null, site, variant = 'home' } ) {

		this.site = site;
		this.variant = variant;
		// the platform sits on the highest ground under it (the plinth hides the gap on the low side of a slope)
		let y = - Infinity;
		for ( const [ ax, az ] of [ [ 0, 0 ], [ - 1.45, - 1.45 ], [ 1.45, - 1.45 ], [ - 1.45, 1.45 ], [ 1.45, 1.45 ] ] ) {

			const [ wx, wz ] = stallWorld( site, ax, az );
			y = Math.max( y, terrain && terrain.heightAt ? terrain.heightAt( wx, wz ) : 0 );

		}

		this.group = new Group();
		this.group.name = 'TradeStall:' + variant;
		this.group.position.set( site.x, y, site.z );
		this.group.rotation.y = site.yaw;
		this.material = createPropMaterial( 'tradeStall' );
		this.geometry = buildStallGeometry( variant );
		this.triangles = triangleCount( this.geometry );
		const mesh = new Mesh( this.geometry, this.material );
		mesh.name = 'TradeStallMesh';
		mesh.castShadow = true;
		this.group.add( mesh );
		this.scene = scene;
		if ( scene ) scene.add( this.group );

		const [ lx, lz ] = stallWorld( site, - 1.38, 1.18 );
		this.lights = [ { position: new Vector3( lx, y + 2.02, lz ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } ];
		this.front = stallFront( site );

		// the counter, the crate stack, the barrel, the back shelves and the four posts
		this.colliders = [];
		this._world = colliders;
		if ( colliders ) {

			const boxAt = ( lx0, lz0, hx, hy, hz ) => {

				const [ bx, bz ] = stallWorld( site, lx0, lz0 );
				this.colliders.push( colliders.addBox( new Vector3( bx, y + hy, bz ), new Vector3( hx, hy, hz ), site.yaw, { tag: 'tradeStall' } ) );

			};

			boxAt( 0, 0.4, 1.25, 0.45, 0.4 );
			boxAt( - 2.0, 0.45, 0.4, 0.45, 0.32 );
			boxAt( 0, - 1.25, 1.35, 0.95, 0.2 );
			const [ ox, oz ] = stallWorld( site, 2.0, 0.45 );
			this.colliders.push( colliders.addCylinder( ox, oz, 0.3, y, y + 0.8, { tag: 'tradeStall' } ) );
			for ( const [ px, pz ] of [ [ - 1.38, 0.95 ], [ 1.38, 0.95 ], [ - 1.38, - 1.3 ], [ 1.38, - 1.3 ] ] ) {

				const [ wx, wz ] = stallWorld( site, px, pz );
				this.colliders.push( colliders.addCylinder( wx, wz, 0.07, y, y + 2.6, { tag: 'tradeStall' } ) );

			}

		}

	}

	dispose() {

		if ( this._world ) {

			for ( const c of this.colliders ) {

				for ( const list of [ this._world.boxes, this._world.cylinders ] ) {

					const i = list.indexOf( c );
					if ( i >= 0 ) list.splice( i, 1 );

				}

			}

			this.colliders = [];

		}

		if ( this.scene && this.scene.remove ) this.scene.remove( this.group );
		if ( this.geometry && this.geometry.dispose ) this.geometry.dispose();
		if ( this.material && this.material.dispose ) this.material.dispose();

	}

}
