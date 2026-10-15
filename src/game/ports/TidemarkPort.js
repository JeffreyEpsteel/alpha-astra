import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, torus, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../GameMaterials.js';
import { Vendor } from '../Vendor.js';
import { characterUrl } from '../Characters.js';
import { WORLD } from '../../world/WorldLayout.js';
import { SPOTS } from '../../world/islands/town/Layout.js';

// The traders of Tidemark's market square (world/islands/Tidemark.js builds the town): Hana's fish hall (kind 'buyer',
// the Sell / Quests panel) at the stand on the square, paying a premium for reef fish (the tavern's pot and the town's
// salting sheds want them), and Marlow's chandlery counter (kind 'shop': the gear and fuel panel) in front of the
// chandlery on the quay street. The tavern keeper, the residents and the trade cell's booth are the harbour and trade
// features' (WORLD.ports tidemark: size 2, market); the notice board's site is TIDEMARK_BOARD (notices feature).
//
//   const port = new TidemarkPort( { scene, terrain, colliders } )
//   port.vendors [ fish buyer, chandler ] (push into Game.vendors), port.lights, port.update( dt, camera distance )
//   TIDEMARK_STAND (WORLD.ports stand: the map marker), TIDEMARK_PREMIUM, TIDEMARK_BOARD, TIDEMARK_TAVERN

const PORT = WORLD.ports.find( ( p ) => p.id === 'tidemark' );
export const TIDEMARK_STAND = { ...PORT.stand };
export const TIDEMARK_CHANDLER = { ...SPOTS.chandler };
export const TIDEMARK_BOARD = { x: SPOTS.board.x, z: SPOTS.board.z, yaw: SPOTS.board.yaw };
export const TIDEMARK_TAVERN = { name: 'The Tide & Tankard', x: SPOTS.keeper.x, z: SPOTS.keeper.z };
export const TIDEMARK_PREMIUM = {
	label: 'Reef fish',
	ids: [ 'yellowtail', 'grunt', 'wrasse', 'parrot', 'sergeant', 'angel' ],
	mult: 1.2,
	note: 'The Tidemark fish hall pays 20% extra for reef fish: yellowtail, grunt, hogfish, parrotfish, sergeant major and angelfish.',
};
const LOAD_DIST = 260;
const FLOOR = 0.04;

export class TidemarkPort {

	constructor( { scene, terrain, colliders = null } ) {

		this.material = createPropMaterial( 'tidemarkPort' );
		this.group = new Group();
		this.group.name = 'TidemarkPort';
		scene.add( this.group );
		this.lights = [];
		this.terrain = terrain;
		this.market = this._stall( TIDEMARK_STAND, stallGeometry( 0x2f6a8a, 'fish' ), colliders, 'tidemarkFishHall', {
			name: 'Hana · Tidemark fish hall',
			kind: 'buyer',
			greeting: 'Reef fish for the pot and the salting sheds: yellowtail, grunt, hogfish, parrotfish. Those pay best here.',
			idle: 'The boats are in early today.',
			character: { url: characterUrl( 'pepe' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x2f6a8a, trousers: 0x3a3a3a, apron: 0xe8e2d0, hat: 0x8a3b2c, hair: 0x3a2a1e, skin: 0xa8805a },
		} );
		this.chandler = this._stall( TIDEMARK_CHANDLER, stallGeometry( 0x8a3b2c, 'chandler' ), colliders, 'tidemarkChandler', {
			name: 'Marlow · Chandler',
			kind: 'shop',
			greeting: 'Rope, reels, a bigger hold, fuel for the long run home. Tidemark fits out the east.',
			idle: 'Wind\'s backing west. Weather tomorrow.',
			character: { url: characterUrl( 'bonk' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x8a3b2c, trousers: 0x3a3a3a, apron: 0x5a4632, hat: 0x2b3a44, hair: 0xc9a43a, skin: 0x8a6a4a },
		} );
		const ids = new Set( TIDEMARK_PREMIUM.ids );
		const v = this.market;
		v.premium = TIDEMARK_PREMIUM;
		v.priceFor = ( f ) => ids.has( f.species ) ? Math.round( f.value * TIDEMARK_PREMIUM.mult ) : f.value;
		v.premiumBonus = ( list ) => {

			let extra = 0;
			for ( const f of list || [] ) if ( ids.has( f.species ) ) extra += Math.round( f.value * TIDEMARK_PREMIUM.mult ) - f.value;
			return extra;

		};

		this.vendors = [ this.market, this.chandler ];

	}

	// a stall at a stand (front toward the bay: local +z), the vendor behind its counter, a lantern on the post
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

	// cameraDistance: from the island (Tidemark.update sets it); loads the characters once close
	update( dt, cameraDistance = Infinity ) {

		if ( cameraDistance > LOAD_DIST ) return;
		for ( const v of this.vendors ) {

			if ( ! v._lazyCharacter ) continue;
			const ch = v._lazyCharacter;
			v._lazyCharacter = null;
			v.loadCharacter( ch.url, ch ).catch( ( e ) => console.warn( 'TidemarkPort: character failed to load', e ) );

		}

	}

}

// a trestle counter (top at 0.9 m), a plank floor, a back wall, two posts, an awning; the fish hall's ice and fish or the
// chandler's rope, lamps and tins on top
function stallGeometry( awning, kind ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	for ( const x of [ - 1.05, 1.05 ] ) for ( const s of [ - 1, 1 ] ) add( box( 0.07, 0.9, 0.07 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( x, 0.45, s * 0.3 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.4, 0.04, 0.2 ), { ...WOODX( [ 0x8e7e68, 0x7d6d5a, 0x958670, 0x84745f ][ i ] ), matrix: mat4( 0, 0.9, - 0.3 + i * 0.2 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.6, 0.04, 0.32 ), { ...WOODX( [ 0x75664f, 0x6b5d49, 0x7a6b54, 0x6e604b ][ i ] ), matrix: mat4( 0, FLOOR - 0.02, - 0.45 - i * 0.32 ) } );
	add( box( 2.4, 1.8, 0.06 ), { ...WOODX( 0x7a6e5a ), matrix: mat4( 0, 0.9, - 1.65 ) } );
	for ( const x of [ - 1.25, 1.25 ] ) for ( const z of [ 0.55, - 1.6 ] ) add( box( 0.1, 2.5, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( x, 1.25, z ) } );
	for ( let i = 0; i < 6; i ++ ) add( box( 2.9 / 6, 0.05, 2.6 ), { color: i % 2 ? 0xe9e6dd : awning, rough: 0.95, pattern: PAT.cloth, matrix: mat4( - 1.45 + ( i + 0.5 ) * 2.9 / 6, 2.6, - 0.5, 0.12, 0, 0 ) } );
	add( box( 0.06, 0.06, 0.3 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 1.25, 2.0, 0.65 ) } );
	add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( 1.25, 1.9, 0.75 ) } );
	if ( kind === 'fish' ) {

		add( box( 2.1, 0.08, 0.6 ), { color: 0xdfe8ea, rough: 0.25, matrix: mat4( 0, 0.96, 0.0 ) } );
		let seed = 91;
		const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
		for ( let i = 0; i < 9; i ++ ) add( sphere( 1, 8, 5 ), { color: [ 0xd8b04a, 0x8fa6b2, 0x4a8fbf, 0xc96a4a, 0x6aa85a ][ i % 5 ], rough: 0.3, metal: 0.4, matrix: mat4( - 0.9 + i * 0.22, 1.05, ( rnd() - 0.5 ) * 0.3, 0, ( rnd() - 0.5 ) * 0.6, 0, 0.1, 0.06, 0.28 ) } );
		add( cylinder( 0.19, 0.17, 0.03, 16 ), { color: 0x9aa0a3, rough: 0.35, metal: 1, matrix: mat4( - 1.3, 1.29, - 0.15 ) } );
		add( cylinder( 0.03, 0.04, 0.35, 8 ), { color: 0x555a5d, rough: 0.4, metal: 1, matrix: mat4( - 1.3, 1.1, - 0.15 ) } );

	} else {

		for ( let i = 0; i < 3; i ++ ) for ( let k = 0; k < 4; k ++ ) add( torus( 0.2 - k * 0.012, 0.022, 6, 18 ), { color: [ 0xc9b48a, 0xb8a27a, 0xd8c69c ][ i ], rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 0.8 + i * 0.45, 0.95 + k * 0.04, 0.05, Math.PI / 2, 0, 0 ) } );
		add( cylinder( 0.08, 0.1, 0.3, 10 ), { color: 0xb08a3a, rough: 0.35, metal: 1, matrix: mat4( 0.55, 1.07, 0.0 ) } );
		for ( let i = 0; i < 3; i ++ ) add( cylinder( 0.08, 0.08, 0.14, 10 ), { color: [ 0xb23a2e, 0x2f5f8a, 0xe9e6dd ][ i ], rough: 0.5, metal: 0.3, matrix: mat4( 0.82 + i * 0.17, 0.99, 0.12 ) } );
		for ( const y of [ 0.9, 1.45 ] ) add( box( 2.2, 0.05, 0.32 ), { ...WOOD( 0x6b5b45 ), matrix: mat4( 0, y, - 1.45 ) } );
		for ( let i = 0; i < 6; i ++ ) add( sphere( 0.1, 10, 8 ), { color: [ 0xe8e2d0, 0xf2c230, 0xd9542b ][ i % 3 ], rough: 0.5, matrix: mat4( - 0.9 + i * 0.36, 1.57, - 1.45 ) } );

	}

	return mergePrepared( P );

}
