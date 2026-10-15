import { Group, Mesh, Vector3, Color } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, torus, sphere, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { Vendor } from './Vendor.js';
import { characterUrl } from './Characters.js';
import { WORLD } from '../world/WorldLayout.js';
import { ponsWorld } from '../world/terrain/IslandShape.js';

// Pons, the fish-market trader at Pons Cove (the small island south-east of the main one): a
// trestle table with crates and scales on the sand at the foot of the dock, and Pons behind it
// (roster character Pepe). He buys fish like PoorGoat (vendor kind 'buyer': the same Sell / Quests panel).
//
//   const port = new PonsPort( { scene, terrain, colliders } );
//   port.vendor (push into Game.vendors), port.update( dt, player ), port.lights (add to localLights),
//   port.near( p ) (within 25 m of the dock: the discovery bonus), PONS_STAND (the stall, map marker)
//
// The stall faces the dock (local +z toward the water); Pons stands behind the table.

const [ SX, SZ ] = ponsWorld( - 85, - 5 );
export const PONS_STAND = { x: Math.round( SX * 10 ) / 10, z: Math.round( SZ * 10 ) / 10, yaw: WORLD.pons.dock.heading };

const NEAR = 25; // m from the dock (xz) that counts as arriving
const FLOOR = 0.04;

export class PonsPort {

	constructor( { scene, terrain, colliders = null } ) {

		const { x, z, yaw } = PONS_STAND;
		const y = terrain.heightAt( x, z );
		this.material = createPropMaterial( 'ponsPort' );
		this.group = new Group();
		this.group.name = 'PonsPort';
		this.group.position.set( x, y, z );
		this.group.rotation.y = yaw;
		const mesh = new Mesh( buildStall(), this.material );
		mesh.name = 'PonsStall';
		mesh.castShadow = true;
		this.group.add( mesh );
		scene.add( this.group );

		// Pons behind the table (local -z), facing the customer
		const c = Math.cos( yaw ), s = Math.sin( yaw );
		const lx = 0.2, lz = - 0.8;
		this.vendor = new Vendor( {
			name: 'Pons · Fish market',
			kind: 'buyer',
			position: new Vector3( x + lx * c + lz * s, y + FLOOR, z - lx * s + lz * c ),
			yaw,
			radius: 3.2,
			greeting: 'Welcome to Pons Cove, friend! Whatever the boat brought, I\'ll weigh it fair.',
			idle: 'Quiet day at the cove. Bring me something from the deep water.',
			material: this.material,
			character: { url: characterUrl( 'pepe' ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' },
			look: { shirt: 0x3f7a5a, trousers: 0x3a3a3a, apron: 0xd8d0b8, hat: 0x2d4b3a, hair: 0x2a2018, skin: 0xb98660 },
		} );
		scene.add( this.vendor.group );

		// a lantern on the stall's right post (dusk: the root adds this to localLights)
		const px = 1.15, pz = 0.7;
		this.lights = [ { position: new Vector3( x + px * c + pz * s, y + 1.83, z - px * s + pz * c ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } ];

		// the dock: three points along it (the foot, the middle, the head)
		const D = WORLD.pons.dock;
		this._dock = [ D.start, new Vector3().lerpVectors( D.start, D.end, 0.5 ), D.end ];

		if ( colliders ) {

			// the table, the crates beside it and the shelf behind
			for ( const [ ax, az, hx, hz, hy ] of [ [ 0, 0, 1.05, 0.4, 0.5 ], [ - 1.5, 0.2, 0.4, 0.3, 0.3 ], [ 1.55, 0.1, 0.35, 0.3, 0.4 ], [ 0, - 1.4, 1.0, 0.2, 0.8 ] ] ) {

				const bx = x + ax * c + az * s, bz = z - ax * s + az * c;
				colliders.addBox( new Vector3( bx, y + hy, bz ), new Vector3( hx, hy, hz ), yaw, { tag: 'ponsStall' } );

			}

		}

	}

	// true within 25 m of the dock (any of its three sample points), measured on the ground plane
	near( p ) {

		for ( const d of this._dock ) if ( Math.hypot( p.x - d.x, p.z - d.z ) < NEAR ) return true;
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
	let seed = 23;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );

	// trestle table (top at 0.9 m), a front board, a plank floor behind it
	for ( const x of [ - 0.95, 0.95 ] ) for ( const s of [ - 1, 1 ] ) add( box( 0.07, 0.9, 0.07 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( x, 0.45, s * 0.3, s * 0.2, 0, 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.2, 0.04, 0.2 ), { ...WOODX( [ 0x8e7e68, 0x7d6d5a, 0x958670, 0x84745f ][ i ] ), matrix: mat4( jit( 0.02 ), 0.9, - 0.3 + i * 0.2, 0, jit( 0.02 ), 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( 2.4, 0.04, 0.32 ), { ...WOODX( [ 0x75664f, 0x6b5d49, 0x7a6b54, 0x6e604b ][ i ] ), matrix: mat4( 0, FLOOR - 0.02, - 0.45 - i * 0.32, 0, jit( 0.01 ), 0 ) } );

	// scales (a pan on a post), a wooden fish tray with a few silver bellies, a coil of line
	add( cylinder( 0.03, 0.04, 0.35, 8 ), { color: 0x555a5d, rough: 0.4, metal: 1, matrix: mat4( - 0.7, 1.095, - 0.1 ) } );
	add( cylinder( 0.19, 0.17, 0.03, 16 ), { color: 0x9aa0a3, rough: 0.35, metal: 1, matrix: mat4( - 0.7, 1.28, - 0.1 ) } );
	add( box( 0.9, 0.12, 0.55 ), { ...WOOD( 0x6e6048 ), matrix: mat4( 0.3, 0.98, 0.0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( sphere( 0.1, 10, 6 ), { color: [ 0xb8c4cc, 0xa2b2bc, 0xc9d2d6, 0x8fa6b2 ][ i ], rough: 0.3, metal: 0.4, matrix: mat4( 0.02 + i * 0.2, 1.06, jit( 0.2 ), 0, 0, 0, 1.9, 0.5, 0.6 ) } );
	for ( let i = 0; i < 4; i ++ ) add( torus( 0.17 - i * 0.01, 0.016, 6, 18 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 0.85, 0.94 + i * 0.03, 0.2, Math.PI / 2, 0, 0 ) } );

	// crates, stacked, beside the table; a barrel on the other side
	add( box( 0.8, 0.5, 0.6 ), { ...WOOD( 0x7b6a52 ), matrix: mat4( - 1.5, 0.25, 0.2, 0, 0.1, 0 ) } );
	add( box( 0.6, 0.4, 0.5 ), { ...WOOD( 0x6e5e47 ), matrix: mat4( - 1.45, 0.7, 0.18, 0, - 0.2, 0 ) } );
	add( cylinder( 0.32, 0.3, 0.8, 12 ), { ...WOOD( 0x5b4a39 ), matrix: mat4( 1.55, 0.4, 0.1 ) } );

	// a shelf of jars and floats on the back wall, a price board and two awning posts
	add( box( 2.0, 0.06, 0.3 ), { ...WOOD( 0x6b5b45 ), matrix: mat4( 0, 1.3, - 1.4 ) } );
	add( box( 2.0, 0.9, 0.05 ), { ...WOODX( 0x7a6e5a ), matrix: mat4( 0, 0.85, - 1.58 ) } );
	for ( let i = 0; i < 4; i ++ ) add( sphere( 0.09, 10, 8 ), { color: [ 0xe2552a, 0xe8e2d0, 0xf2c230, 0xe2552a ][ i ], rough: 0.5, matrix: mat4( - 0.7 + i * 0.4, 1.42, - 1.4 ) } );
	for ( const x of [ - 1.15, 1.15 ] ) add( box( 0.1, 2.5, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( x, 1.25, 0.5 ) } );
	add( box( 2.7, 0.05, 2.5 ), { color: 0x4a6f8f, rough: 0.95, pattern: PAT.cloth, matrix: mat4( 0, 2.58, - 0.55, 0.14, 0, 0 ) } );
	add( box( 0.76, 0.5, 0.025 ), { color: 0x2a302c, rough: 0.9, matrix: mat4( 0.1, 0.45, 0.45, - 0.2, 0, 0 ) } );

	// the lantern on the right post
	add( box( 0.06, 0.06, 0.3 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 1.15, 2.0, 0.6 ) } );
	add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( 1.15, 1.83, 0.7 ) } );
	return mergePrepared( P );

}
