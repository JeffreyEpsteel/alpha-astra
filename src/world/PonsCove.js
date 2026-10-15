import { Group, Mesh, Vector3, Color } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from './boat/GeoKit.js';
import { createPropMaterial, PAT } from '../game/GameMaterials.js';
import { WORLD } from './WorldLayout.js';
import { ponsWorld } from './terrain/IslandShape.js';

// The built part of Pons Cove, the small island south-east of the main one: a short timber dock
// on the north-west beach (a plank deck on piles, walkable, deck top WORLD.pons.dock.deckHeight
// above the sea), a pair of fishermen's huts above the beach and two lanterns.
//
//   const cove = new PonsCove( { scene, terrain, colliders } );
//   cove.group, cove.lights (add to localLights), cove.deckTop, cove.dockLength
//
// The dock runs from D.start (on the sand) out to D.end over the water along D.heading
// (local +z of the dock frame); the boat moors at D.position beside its end.

const D = WORLD.pons.dock;
const WOOD = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.wood, ...o } );
const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );

// the huts, in the island frame (u from the beach inland, v across): [ u, v, yaw offset ]
export const PONS_HUTS = [ [ - 72, - 12 ], [ - 63, 24 ] ];

export class PonsCove {

	constructor( { scene, terrain, colliders = null, material = null } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'ponsCove' );
		this.group = new Group();
		this.group.name = 'PonsCove';
		scene.add( this.group );
		this.lights = [];
		this.deckTop = D.deckHeight;
		this.dockLength = Math.hypot( D.end.x - D.start.x, D.end.z - D.start.z );

		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		this._dock( P, add, colliders );
		for ( const [ u, v ] of PONS_HUTS ) this._hut( add, colliders, u, v );
		const mesh = new Mesh( mergePrepared( P ), this.material );
		mesh.name = 'PonsCoveProps';
		mesh.castShadow = true;
		this.group.add( mesh );

	}

	// dock-frame point (lx across, lz along) to the world
	_w( lx, lz ) {

		const c = Math.cos( D.heading ), s = Math.sin( D.heading );
		return [ D.start.x + lx * c + lz * s, D.start.z - lx * s + lz * c ];

	}

	_dock( P, add, colliders ) {

		const h = D.heading, L = this.dockLength, top = D.deckHeight, hw = D.width / 2;
		const T = 0.07; // plank thickness
		const ground = ( x, z ) => this.terrain.heightAt( x, z );
		let seed = 71;
		const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
		const at = ( lx, y, lz, ry = 0 ) => {

			const [ x, z ] = this._w( lx, lz );
			return mat4( x, y, z, 0, h + ry, 0 );

		};

		// deck boards across the dock, 0.2 m wide with hairline gaps, slightly varied in tone
		const n = Math.floor( L / 0.22 );
		for ( let i = 0; i < n; i ++ ) {

			add( box( D.width, T, 0.2 ), { ...WOODX( [ 0x8a7a64, 0x7d6e5a, 0x92836b, 0x6f6150 ][ Math.floor( rnd() * 4 ) ] ), matrix: at( 0, top - T / 2, 0.11 + i * 0.22 ) } );

		}

		// two stringers under the deck, a cap beam and a pair of piles every 3.2 m
		for ( const sx of [ - 0.8, 0.8 ] ) add( box( 0.14, 0.2, L ), { ...WOOD( 0x5f5243 ), matrix: at( sx, top - T - 0.1, L / 2 ) } );
		const piles = [];
		for ( let lz = 0.6; lz < L; lz += 3.2 ) {

			add( box( 2.0 * hw + 0.3, 0.14, 0.18 ), { ...WOOD( 0x54483a ), matrix: at( 0, top - T - 0.27, lz ) } );
			for ( const sx of [ - hw - 0.1, hw + 0.1 ] ) {

				const [ x, z ] = this._w( sx, lz );
				const g = Math.min( ground( x, z ), top - 0.2 );
				const len = top + 0.18 - ( g - 0.5 );
				add( cylinder( 0.13, 0.15, len, 8 ), { ...WOOD( 0x4b4034, { rough: 0.95 } ), matrix: mat4( x, g - 0.5 + len / 2, z ) } );
				piles.push( [ x, z, g ] );

			}

		}

		// a bollard each side at the end, a coil of line and a crate near the foot
		for ( const sx of [ - hw + 0.18, hw - 0.18 ] ) {

			add( cylinder( 0.09, 0.11, 0.38, 10 ), { ...WOOD( 0x3f372e ), matrix: at( sx, top + 0.19, L - 0.35 ) } );
			add( sphere( 0.1, 10, 8 ), { ...WOOD( 0x3f372e ), matrix: at( sx, top + 0.4, L - 0.35 ) } );

		}

		add( box( 0.6, 0.4, 0.5 ), { ...WOOD( 0x7b6a52 ), matrix: at( hw - 0.45, top + 0.2, 6.0, 0.2 ) } );
		add( box( 0.5, 0.3, 0.42 ), { ...WOOD( 0x6e5e47 ), matrix: at( hw - 0.4, top + 0.55, 6.05, - 0.3 ) } );

		// two lantern posts: at the head of the dock and where it meets the sand
		for ( const [ lx, lz ] of [ [ - hw + 0.12, L - 0.9 ], [ hw - 0.12, 4.0 ] ] ) {

			add( box( 0.1, 2.1, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: at( lx, top + 1.05, lz ) } );
			add( box( 0.06, 0.06, 0.4 ), { ...WOOD( 0x6e5f4c ), matrix: at( lx, top + 2.0, lz + 0.15 ) } );
			const [ x, z ] = this._w( lx, lz + 0.3 );
			add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( x, top + 1.83, z ) } );
			add( cylinder( 0.03, 0.09, 0.05, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( x, top + 1.98, z ) } );
			add( cylinder( 0.09, 0.07, 0.03, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( x, top + 1.7, z ) } );
			this.lights.push( { position: new Vector3( x, top + 1.83, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );

		}

		if ( colliders ) {

			// the deck: a walkable slab (its top is the deck), the piles solid below the planks
			const [ cx, cz ] = this._w( 0, L / 2 );
			colliders.addBox( new Vector3( cx, top - 0.15, cz ), new Vector3( hw, 0.15, L / 2 ), h, { walkable: true, tag: 'ponsDeck' } );
			for ( const [ x, z, g ] of piles ) colliders.addCylinder( x, z, 0.15, g - 0.5, top - 0.3, { tag: 'ponsPile' } );

		}

	}

	// a small fisherman's hut with its door toward the water, on the terrain at island point (u, v)
	_hut( add, colliders, u, v ) {

		const [ x, z ] = ponsWorld( u, v );
		const t = this.terrain;
		// the lowest ground under the footprint, so the floor never floats
		const yaw = D.heading;
		const hx = 1.8, hz = 1.5;
		let y0 = Infinity;
		for ( const [ ox, oz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) {

			const c = Math.cos( yaw ), s = Math.sin( yaw );
			const lx = ox * hx, lz = oz * hz;
			y0 = Math.min( y0, t.heightAt( x + lx * c + lz * s, z - lx * s + lz * c ) );

		}

		y0 = Math.max( y0, 0.2 );
		const wallH = 2.3;
		const M = ( lx, ly, lz, rx = 0, ry = 0, rz = 0 ) => {

			const c = Math.cos( yaw ), s = Math.sin( yaw );
			return mat4( x + lx * c + lz * s, y0 + ly, z - lx * s + lz * c, rx, yaw + ry, rz );

		};

		// floor on short posts, plank walls, a lean door, one window, a pitched roof of tin
		add( box( 2 * hx + 0.2, 0.2, 2 * hz + 0.2 ), { ...WOOD( 0x5a4e40 ), matrix: M( 0, 0.0, 0 ) } );
		add( box( 2 * hx, wallH, 2 * hz ), { ...WOODX( 0x8c7f6a ), matrix: M( 0, wallH / 2 + 0.1, 0 ) } );
		add( box( 0.95, 1.9, 0.08 ), { ...WOOD( 0x3e5a6b ), matrix: M( 0.4, 1.05, hz + 0.03 ) } );
		add( box( 0.7, 0.55, 0.08 ), { color: 0x1d2a33, rough: 0.2, matrix: M( - 1.0, 1.55, hz + 0.03 ) } );
		add( box( 0.82, 0.07, 0.1 ), { ...WOOD( 0x5a4e40 ), matrix: M( - 1.0, 1.85, hz + 0.04 ) } );
		const slope = 0.42, rw = hx / Math.cos( slope ) + 0.35;
		for ( const sgn of [ - 1, 1 ] ) {

			add( box( rw, 0.07, 2 * hz + 0.6 ), { color: 0x7d5a4a, rough: 0.6, metal: 0.5, pattern: PAT.rusty, matrix: M( sgn * hx * 0.5, wallH + 0.1 + hx * 0.5 * Math.tan( slope ), 0, 0, 0, - sgn * slope ) } );

		}

		add( box( 2 * hx, hx * Math.tan( slope ), 2 * hz ), { ...WOODX( 0x7f735f ), matrix: M( 0, wallH + 0.1 + hx * Math.tan( slope ) * 0.5 - 0.02, 0 ) } );
		// a bench and a barrel by the door
		add( box( 1.3, 0.07, 0.34 ), { ...WOOD( 0x6b5b45 ), matrix: M( - 1.0, 0.5, hz + 0.45 ) } );
		add( cylinder( 0.3, 0.3, 0.7, 12 ), { ...WOOD( 0x5b4a39 ), matrix: M( 1.5, 0.45, hz + 0.45 ) } );

		if ( colliders ) {

			colliders.addBox( new Vector3( x, y0 + wallH / 2 + 0.1, z ), new Vector3( hx, wallH / 2 + 0.1, hz ), yaw, { tag: 'ponsHut' } );

		}

	}

}
