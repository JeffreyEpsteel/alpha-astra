import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, torus, sphere, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../GameMaterials.js';
import { Vendor } from '../Vendor.js';
import { characterUrl } from '../Characters.js';
import { WORLD } from '../../world/WorldLayout.js';

// Pengu, the fish buyer at Saltmarsh Key (the low sandy key east of the harbour): a trestle table
// with scales, a tray of silver flats fish, crab baskets and a price board on the sand in front of
// his hut (the hut itself is world/islands/SaltmarshKey.js), and Pengu behind the table (roster
// character Pengu). He is a vendor of kind 'buyer' like PoorGoat and Pons (the same Sell / Quests panel)
// who pays a premium for ONE species group, the flats fish of the mangrove shallows:
//
//   KEY_PREMIUM = { label, ids: [ species ids ], mult }       (vendor.premium is the same object)
//   vendor.priceFor( fish ) -> $ for one inventory fish ( value x mult for the premium species )
//   vendor.premiumBonus( fishList ) -> the extra $ over the normal value for those fish
//
//   const port = new KeyPort( { scene, terrain, colliders } );
//   port.vendor (push into Game.vendors), port.update( dt, player ), port.lights (add to localLights),
//   port.near( p ) (within 25 m of the dock or the stall), KEY_STAND (the stall: map marker)
//
// The stall faces the water (local +z); Pengu stands behind the table.

const KP = WORLD.ports.find( ( p ) => p.id === 'key' );
export const KEY_STAND = { ...KP.stand };
export const KEY_PREMIUM = {
	label: 'Flats fish',
	ids: [ 'mullet', 'needlefish', 'jack', 'silverside', 'tarpon' ],
	mult: 1.4,
	note: 'Pengu pays 40% extra for flats fish: mullet, houndfish, jack, silverside and tarpon.',
};

const NEAR = 25; // m from the dock or the stall (xz) that counts as arriving
const FLOOR = 0.04;

export class KeyPort {

	constructor( { scene, terrain, colliders = null } ) {

		const { x, z, yaw } = KEY_STAND;
		const y = terrain.heightAt( x, z );
		this.material = createPropMaterial( 'keyPort' );
		this.group = new Group();
		this.group.name = 'KeyPort';
		this.group.position.set( x, y, z );
		this.group.rotation.y = yaw;
		const mesh = new Mesh( buildStall(), this.material );
		mesh.name = 'KeyStall';
		mesh.castShadow = true;
		this.group.add( mesh );
		scene.add( this.group );

		const c = Math.cos( yaw ), s = Math.sin( yaw );
		const lx = 0.2, lz = - 0.8;
		this.vendor = new Vendor( {
			name: 'Pengu · Marsh buyer',
			kind: 'buyer',
			position: new Vector3( x + lx * c + lz * s, y + FLOOR, z - lx * s + lz * c ),
			yaw,
			radius: 3.2,
			greeting: 'Ahoy! Flats fish fetch a premium here: mullet, houndfish, jack, silverside, tarpon. The rest I buy fair.',
			idle: 'Tide is turning. The mullet will be running in the channel.',
			material: this.material,
			character: { url: characterUrl( 'pengu' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x2f5f6a, trousers: 0x3a3a3a, apron: 0xc9c2a8, hat: 0x2b3a44, hair: 0x1c1a18, skin: 0xb98660 },
		} );
		const ids = new Set( KEY_PREMIUM.ids );
		this.vendor.premium = KEY_PREMIUM;
		this.vendor.priceFor = ( f ) => ids.has( f.species ) ? Math.round( f.value * KEY_PREMIUM.mult ) : f.value;
		this.vendor.premiumBonus = ( list ) => {

			let extra = 0;
			for ( const f of list || [] ) if ( ids.has( f.species ) ) extra += Math.round( f.value * KEY_PREMIUM.mult ) - f.value;
			return extra;

		};

		scene.add( this.vendor.group );

		// a lantern on the awning's right post
		const px = 1.15, pz = 0.7;
		this.lights = [ { position: new Vector3( x + px * c + pz * s, y + 1.83, z - px * s + pz * c ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } ];

		const D = WORLD.key.dock;
		this._spots = [ D.start, new Vector3().lerpVectors( D.start, D.end, 0.5 ), D.end, new Vector3( x, 0, z ) ];

		if ( colliders ) {

			for ( const [ ax, az, hx, hz, hy ] of [ [ 0, 0, 1.05, 0.4, 0.5 ], [ - 1.5, 0.2, 0.4, 0.3, 0.3 ], [ 1.55, 0.1, 0.35, 0.3, 0.4 ], [ 0, - 1.4, 1.0, 0.2, 0.8 ] ] ) {

				const bx = x + ax * c + az * s, bz = z - ax * s + az * c;
				colliders.addBox( new Vector3( bx, y + hy, bz ), new Vector3( hx, hy, hz ), yaw, { tag: 'keyStall' } );

			}

		}

	}

	near( p ) {

		const q = p && p.position ? p.position : p;
		for ( const d of this._spots ) if ( Math.hypot( q.x - d.x, q.z - d.z ) < NEAR ) return true;
		return false;

	}

	update( dt, player ) {

		const p = player && player.position ? player.position : player;
		this.vendor.update( dt, p );

	}

}

// the stall in local space: table across x (centre origin), customer side +z, an awning on two posts
function buildStall() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	let seed = 61;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );

	// trestle table (top at 0.9 m), a front board, a plank floor behind it
	for ( const x of [ - 0.95, 0.95 ] ) for ( const s of [ - 1, 1 ] ) add( box( 0.07, 0.9, 0.07 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( x, 0.45, s * 0.3, s * 0.2, 0, 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.2, 0.04, 0.2 ), { ...WOODX( [ 0x8e7e68, 0x7d6d5a, 0x958670, 0x84745f ][ i ] ), matrix: mat4( jit( 0.02 ), 0.9, - 0.3 + i * 0.2, 0, jit( 0.02 ), 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.4, 0.04, 0.32 ), { ...WOODX( [ 0x75664f, 0x6b5d49, 0x7a6b54, 0x6e604b ][ i ] ), matrix: mat4( 0, FLOOR - 0.02, - 0.45 - i * 0.32, 0, jit( 0.01 ), 0 ) } );

	// scales (a pan on a post), a tray with silver mullet and a jack, a coil of line
	add( cylinder( 0.03, 0.04, 0.35, 8 ), { color: 0x555a5d, rough: 0.4, metal: 1, matrix: mat4( - 0.7, 1.095, - 0.1 ) } );
	add( cylinder( 0.19, 0.17, 0.03, 16 ), { color: 0x9aa0a3, rough: 0.35, metal: 1, matrix: mat4( - 0.7, 1.28, - 0.1 ) } );
	add( box( 0.9, 0.12, 0.55 ), { ...WOOD( 0x6e6048 ), matrix: mat4( 0.3, 0.98, 0.0 ) } );
	for ( let i = 0; i < 5; i ++ ) add( sphere( 1, 8, 5 ), { color: [ 0xb8c4cc, 0xa2b2bc, 0xc9d2d6, 0x8fa6b2, 0xb2c0c8 ][ i ], rough: 0.3, metal: 0.4, matrix: mat4( - 0.04 + i * 0.17, 1.08, jit( 0.2 ), 0, jit( 0.5 ), 0, 0.09, 0.05, 0.2 ) } );
	for ( let i = 0; i < 4; i ++ ) add( torus( 0.17 - i * 0.01, 0.016, 6, 18 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 0.85, 0.94 + i * 0.03, 0.2, Math.PI / 2, 0, 0 ) } );

	// crab baskets beside the table and a barrel on the other side
	add( cylinder( 0.34, 0.34, 0.5, 10 ), { color: 0x4d5a52, rough: 0.5, metal: 0.4, matrix: mat4( - 1.5, 0.25, 0.2 ) } );
	add( cylinder( 0.3, 0.3, 0.45, 10 ), { color: 0x56645a, rough: 0.5, metal: 0.4, matrix: mat4( - 1.45, 0.72, 0.18 ) } );
	add( cylinder( 0.32, 0.3, 0.8, 12 ), { ...WOOD( 0x5b4a39 ), matrix: mat4( 1.55, 0.4, 0.1 ) } );

	// a shelf of jars and floats on the back wall, a price board and two awning posts
	add( box( 2.0, 0.06, 0.3 ), { ...WOOD( 0x6b5b45 ), matrix: mat4( 0, 1.3, - 1.4 ) } );
	add( box( 2.0, 0.9, 0.05 ), { ...WOODX( 0x7a6e5a ), matrix: mat4( 0, 0.85, - 1.58 ) } );
	for ( let i = 0; i < 4; i ++ ) add( sphere( 0.09, 10, 8 ), { color: [ 0x2f8f9a, 0xe8e2d0, 0xf2c230, 0x2f8f9a ][ i ], rough: 0.5, matrix: mat4( - 0.7 + i * 0.4, 1.42, - 1.4 ) } );
	for ( const x of [ - 1.15, 1.15 ] ) add( box( 0.1, 2.5, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( x, 1.25, 0.5 ) } );
	add( box( 2.7, 0.05, 2.5 ), { color: 0x3f7a6e, rough: 0.95, pattern: PAT.cloth, matrix: mat4( 0, 2.58, - 0.55, 0.14, 0, 0 ) } );
	add( box( 0.76, 0.5, 0.025 ), { color: 0x23333a, rough: 0.9, matrix: mat4( 0.1, 0.45, 0.45, - 0.2, 0, 0 ) } );
	// the premium sign: a bright board with a fish on it, hung from the awning front
	add( box( 0.8, 0.3, 0.03 ), { color: 0xf2c230, rough: 0.7, matrix: mat4( 0, 2.28, 0.72, 0, 0, 0 ) } );
	add( sphere( 1, 8, 5 ), { color: 0x1d2f3a, rough: 0.6, matrix: mat4( - 0.04, 2.28, 0.745, 0, 0, 0, 0.18, 0.07, 0.02 ) } );
	add( box( 0.1, 0.1, 0.02 ), { color: 0x1d2f3a, rough: 0.6, matrix: mat4( 0.17, 2.28, 0.745, 0, 0, Math.PI / 4 ) } );
	// a bunch of mullet hung from the awning's left side
	for ( let i = 0; i < 5; i ++ ) {

		add( cylinder( 0.004, 0.004, 0.35, 4 ), { color: 0xc9b48a, rough: 0.9, matrix: mat4( - 0.95 + i * 0.1, 2.35, 0.3 + jit( 0.1 ) ) } );
		add( sphere( 1, 8, 5 ), { color: [ 0xb8c4cc, 0xa2b2bc, 0xc9d2d6 ][ i % 3 ], rough: 0.3, metal: 0.4, matrix: mat4( - 0.95 + i * 0.1, 2.06, 0.3 + jit( 0.1 ), 0, 0, 0.1 * ( i % 2 ? 1 : - 1 ), 0.035, 0.2, 0.06 ) } );

	}

	// the lantern on the right post
	add( box( 0.06, 0.06, 0.3 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 1.15, 2.0, 0.6 ) } );
	add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( 1.15, 1.83, 0.7 ) } );
	return mergePrepared( P );

}
