import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, torus, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../GameMaterials.js';
import { Vendor } from '../Vendor.js';
import { characterUrl } from '../Characters.js';
import { WORLD } from '../../world/WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../../world/terrain/IslandShape.js';

// The traders of West Haven's plaza (world/islands/WestHaven.js builds the town): Bravile's ship chandlery (a
// vendor of kind 'shop' like Ethena: the same gear and fuel panel) under a blue awning with coils of rope,
// anchors, lamps and paint on the shelves, and Doge's fish market (kind 'buyer', the Sell / Quests panel) at a
// long table under a striped awning; the market pays a premium for deep-water fish (HAVEN_PREMIUM). Both stand
// on the plaza pad at the pier foot, facing the pier.
//
//   const port = new HavenPort( { scene, terrain, colliders } );
//   port.vendors [ chandler, market ] (push into Game.vendors), port.lights, port.update( dt, camera distance )
//   HAVEN_STAND (the chandlery: WORLD.ports 'haven' stand, the map marker), HAVEN_MARKET, HAVEN_PREMIUM
//
// The roster characters load lazily, the first time the camera comes within LOAD_DIST (the vendors' stand-in
// figures show until then), so a far island costs nothing at startup.

const I = ISLETS_BY_ID.haven;
const PORT = WORLD.ports.find( ( p ) => p.id === 'haven' );
export const HAVEN_STAND = { ...PORT.stand };
const [ mx, mz ] = isletWorld( I, - 42, - 10 );
export const HAVEN_MARKET = { x: mx, z: mz, yaw: PORT.stand.yaw };
export const HAVEN_PREMIUM = {
	label: 'Deep-water fish',
	ids: [ 'tuna', 'mahi', 'redSnapper', 'grouper', 'barracuda', 'crookedcod' ],
	mult: 1.25,
	note: 'The Haven market pays 25% extra for deep-water fish: tuna, mahi-mahi, red snapper, grouper, barracuda and crooked cod.',
};
const LOAD_DIST = 260;
const FLOOR = 0.04;

export class HavenPort {

	constructor( { scene, terrain, colliders = null } ) {

		this.material = createPropMaterial( 'havenPort' );
		this.group = new Group();
		this.group.name = 'HavenPort';
		scene.add( this.group );
		this.lights = [];
		this.terrain = terrain;

		this.chandler = this._stall( HAVEN_STAND, buildChandlery(), colliders, 'havenChandlery', {
			name: 'Bravile · Ship chandler',
			kind: 'shop',
			greeting: 'Rope, reels, a bigger hold, diesel for the run home. West Haven fits out every boat on this sea.',
			idle: 'Fair wind from the east today.',
			character: { url: characterUrl( 'bravile' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x2f4a63, trousers: 0x3a3a3a, apron: 0x5a4632, hat: 0x2b3a44, hair: 0xc9a43a, skin: 0x8a6a4a },
		} );
		this.market = this._stall( HAVEN_MARKET, buildMarket(), colliders, 'havenMarket', {
			name: 'Doge · Haven fish market',
			kind: 'buyer',
			greeting: 'Much fish. Deep-water catch fetches a premium here: tuna, mahi, snapper, grouper, barracuda, crooked cod.',
			idle: 'The trawlers are late again.',
			character: { url: characterUrl( 'doge' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0xc9a43a, trousers: 0x3a3a3a, apron: 0xe8e2d0, hat: 0x8a3b2c, hair: 0xd9b38c, skin: 0xd9b38c },
		} );
		const ids = new Set( HAVEN_PREMIUM.ids );
		const v = this.market;
		v.premium = HAVEN_PREMIUM;
		v.priceFor = ( f ) => ids.has( f.species ) ? Math.round( f.value * HAVEN_PREMIUM.mult ) : f.value;
		v.premiumBonus = ( list ) => {

			let extra = 0;
			for ( const f of list || [] ) if ( ids.has( f.species ) ) extra += Math.round( f.value * HAVEN_PREMIUM.mult ) - f.value;
			return extra;

		};

		this.vendors = [ this.chandler, this.market ];

	}

	// a stall at a stand (front toward the pier: local +z), the vendor behind its counter, a lantern on the post
	_stall( S, geometry, colliders, tag, opts ) {

		const { x, z, yaw } = S;
		const y = this.terrain.heightAt( x, z );
		const g = new Group();
		g.position.set( x, y, z );
		g.rotation.y = yaw;
		const mesh = new Mesh( geometry, this.material );
		mesh.name = tag;
		mesh.castShadow = true;
		g.add( mesh );
		this.group.add( g );
		const c = Math.cos( yaw ), s = Math.sin( yaw );
		const lx = 0.0, lz = - 0.85;
		const { character, ...rest } = opts;
		const vendor = new Vendor( { ...rest, position: new Vector3( x + lx * c + lz * s, y + FLOOR, z - lx * s + lz * c ), yaw, radius: 3.2, material: this.material } );
		vendor._lazyCharacter = character;
		this.group.add( vendor.group );
		const px = 1.25, pz = 0.75;
		this.lights.push( { position: new Vector3( x + px * c + pz * s, y + 1.9, z - px * s + pz * c ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 7.5, range: 11, kind: 'lantern', flicker: 0.08 } );
		if ( colliders ) {

			for ( const [ ax, az, hx, hz, hy ] of [ [ 0, 0, 1.2, 0.4, 0.5 ], [ 0, - 1.5, 1.2, 0.22, 0.9 ] ] ) {

				colliders.addBox( new Vector3( x + ax * c + az * s, y + hy, z - ax * s + az * c ), new Vector3( hx, hy, hz ), yaw, { tag } );

			}

		}

		return vendor;

	}

	// cameraDistance: from the island (WestHaven.update returns it); loads the characters once close
	update( dt, cameraDistance = Infinity ) {

		if ( cameraDistance < LOAD_DIST ) for ( const v of this.vendors ) {

			if ( ! v._lazyCharacter ) continue;
			const ch = v._lazyCharacter;
			v._lazyCharacter = null;
			v.loadCharacter( ch.url, ch ).catch( ( e ) => console.warn( 'HavenPort: character failed to load', e ) );

		}

	}

}

// the chandlery in local space: a counter across x, shelves behind, a blue awning on two posts
function buildChandlery() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	stallFrame( add, 0x2f5f8a );
	// counter goods: coils of rope, a brass lamp, tins of paint, a chart roll
	for ( let i = 0; i < 3; i ++ ) for ( let k = 0; k < 4; k ++ ) add( torus( 0.2 - k * 0.012, 0.022, 6, 18 ), { color: [ 0xc9b48a, 0xb8a27a, 0xd8c69c ][ i ], rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 0.8 + i * 0.45, 0.95 + k * 0.04, 0.05, Math.PI / 2, 0, 0 ) } );
	add( cylinder( 0.08, 0.1, 0.3, 10 ), { color: 0xb08a3a, rough: 0.35, metal: 1, matrix: mat4( 0.55, 1.07, 0.0 ) } );
	for ( let i = 0; i < 3; i ++ ) add( cylinder( 0.08, 0.08, 0.14, 10 ), { color: [ 0xb23a2e, 0x2f5f8a, 0xe9e6dd ][ i ], rough: 0.5, metal: 0.3, matrix: mat4( 0.82 + i * 0.17, 0.99, 0.12 ) } );
	add( cylinder( 0.05, 0.05, 0.8, 8 ), { color: 0xe8dcc0, rough: 0.9, matrix: mat4( 0.4, 0.97, 0.22, 0, 0, Math.PI / 2 ) } );
	// shelves behind: floats, jars, folded canvas; an anchor and a coil of chain at the side
	for ( const y of [ 0.9, 1.45 ] ) add( box( 2.2, 0.05, 0.32 ), { ...WOOD( 0x6b5b45 ), matrix: mat4( 0, y, - 1.45 ) } );
	for ( let i = 0; i < 6; i ++ ) add( sphere( 0.1, 10, 8 ), { color: [ 0xe8e2d0, 0xf2c230, 0xd9542b ][ i % 3 ], rough: 0.5, matrix: mat4( - 0.9 + i * 0.36, 1.57, - 1.45 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 0.4, 0.18, 0.28 ), { color: [ 0xd9cfb8, 0xc8bfa8, 0xb8c4cc, 0x9a5a4a ][ i ], rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 0.75 + i * 0.5, 1.02, - 1.45 ) } );
	add( box( 0.12, 1.1, 0.12 ), { color: 0x2b2e31, rough: 0.5, metal: 0.8, matrix: mat4( - 1.55, 0.6, 0.2 ) } );
	add( torus( 0.38, 0.06, 6, 14, Math.PI ), { color: 0x2b2e31, rough: 0.5, metal: 0.8, matrix: mat4( - 1.55, 0.25, 0.2, 0, 0, Math.PI ) } );
	add( box( 0.8, 0.07, 0.07 ), { color: 0x2b2e31, rough: 0.5, metal: 0.8, matrix: mat4( - 1.55, 1.05, 0.2 ) } );
	for ( let k = 0; k < 5; k ++ ) add( torus( 0.25, 0.035, 5, 12 ), { color: 0x4a4d50, rough: 0.6, metal: 0.8, matrix: mat4( 1.6, 0.04 + k * 0.06, 0.1, Math.PI / 2, 0, 0 ) } );
	// the sign: an anchor on a board under the awning
	add( box( 1.1, 0.34, 0.03 ), { ...WOODX( 0xe9e6dd ), matrix: mat4( 0, 2.25, 0.74 ) } );
	add( box( 0.05, 0.22, 0.02 ), { color: 0x1d2f3a, rough: 0.6, matrix: mat4( 0, 2.25, 0.765 ) } );
	add( box( 0.2, 0.04, 0.02 ), { color: 0x1d2f3a, rough: 0.6, matrix: mat4( 0, 2.33, 0.765 ) } );
	add( torus( 0.09, 0.015, 4, 10, Math.PI ), { color: 0x1d2f3a, rough: 0.6, matrix: mat4( 0, 2.2, 0.765, 0, 0, Math.PI ) } );
	return mergePrepared( P );

}

// the fish market table in local space: a long table with ice trays and fish, scales, a striped awning
function buildMarket() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	stallFrame( add, 0xb23a2e, true );
	add( box( 2.1, 0.08, 0.6 ), { color: 0xdfe8ea, rough: 0.25, matrix: mat4( 0, 0.96, 0.0 ) } );
	let seed = 77;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	for ( let i = 0; i < 9; i ++ ) add( sphere( 1, 8, 5 ), { color: [ 0x8fa6b2, 0xb8c4cc, 0xc96a4a, 0x6a7f8c, 0xd8b04a ][ i % 5 ], rough: 0.3, metal: 0.4, matrix: mat4( - 0.9 + i * 0.22, 1.05, ( rnd() - 0.5 ) * 0.3, 0, ( rnd() - 0.5 ) * 0.6, 0, 0.1, 0.06, 0.28 ) } );
	add( cylinder( 0.03, 0.04, 0.35, 8 ), { color: 0x555a5d, rough: 0.4, metal: 1, matrix: mat4( - 1.3, 1.1, - 0.15 ) } );
	add( cylinder( 0.19, 0.17, 0.03, 16 ), { color: 0x9aa0a3, rough: 0.35, metal: 1, matrix: mat4( - 1.3, 1.29, - 0.15 ) } );
	for ( let i = 0; i < 3; i ++ ) add( cylinder( 0.3, 0.28, 0.45, 12 ), { color: 0x5b4a39, rough: 0.9, pattern: PAT.wood, matrix: mat4( 1.6, 0.23 + i * 0.0, - 0.4 + i * 0.5 ) } );
	return mergePrepared( P );

}

// shared: trestle counter (top at 0.9 m), a plank floor, back wall, two posts and an awning of `awning` colour
function stallFrame( add, awning, striped = false ) {

	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	for ( const x of [ - 1.05, 1.05 ] ) for ( const s of [ - 1, 1 ] ) add( box( 0.07, 0.9, 0.07 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( x, 0.45, s * 0.3 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.4, 0.04, 0.2 ), { ...WOODX( [ 0x8e7e68, 0x7d6d5a, 0x958670, 0x84745f ][ i ] ), matrix: mat4( 0, 0.9, - 0.3 + i * 0.2 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.6, 0.04, 0.32 ), { ...WOODX( [ 0x75664f, 0x6b5d49, 0x7a6b54, 0x6e604b ][ i ] ), matrix: mat4( 0, FLOOR - 0.02, - 0.45 - i * 0.32 ) } );
	add( box( 2.4, 1.8, 0.06 ), { ...WOODX( 0x7a6e5a ), matrix: mat4( 0, 0.9, - 1.65 ) } );
	for ( const x of [ - 1.25, 1.25 ] ) add( box( 0.1, 2.5, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( x, 1.25, 0.55 ) } );
	for ( const x of [ - 1.25, 1.25 ] ) add( box( 0.1, 2.5, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( x, 1.25, - 1.6 ) } );
	if ( striped ) {

		for ( let i = 0; i < 6; i ++ ) add( box( 2.9 / 6, 0.05, 2.6 ), { color: i % 2 ? 0xe9e6dd : awning, rough: 0.95, pattern: PAT.cloth, matrix: mat4( - 1.45 + ( i + 0.5 ) * 2.9 / 6, 2.6, - 0.5, 0.12, 0, 0 ) } );

	} else add( box( 2.9, 0.05, 2.6 ), { color: awning, rough: 0.95, pattern: PAT.cloth, matrix: mat4( 0, 2.6, - 0.5, 0.12, 0, 0 ) } );
	add( box( 0.06, 0.06, 0.3 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 1.25, 2.0, 0.65 ) } );
	add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( 1.25, 1.9, 0.75 ) } );

}
