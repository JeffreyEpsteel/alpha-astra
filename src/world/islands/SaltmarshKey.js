import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, torus, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { WORLD } from '../WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../terrain/IslandShape.js';
import { buildJetty } from './Jetty.js';

// Saltmarsh Key, the low sandy key east of the harbour (terrain/IslandShape.js ISLETS 'key'): a
// timber jetty at the end of the dredged channel, a fisherman's hut behind the stall (the stall,
// the trader and his lantern are src/game/ports/KeyPort.js), drying racks, crab pots and an
// upturned skiff, and the mangroves: prop-rooted shrub clumps standing in the shallows round the
// shore, scrub on the low ground and reed tufts. Everything is merged geometry (GeoKit), one mesh.
//
//   const key = new SaltmarshKey( { scene, terrain, colliders } );
//   key.group, key.lights (add to localLights), key.shrubs (count), key.hut: { x, z, y, yaw }
//
// Local frame of the hut / stall (KEY_FRAME): origin at the stall front, +z toward the water (the
// dock heading), +x to the right of that.

const I = ISLETS_BY_ID.key;
const D = WORLD.key.dock;
const WOOD = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.wood, ...o } );
const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );

// the stall front (the trader stands just behind it): island coordinates (-24.5, -8) -> WORLD.ports
export const KEY_FRAME = { x: WORLD.ports.find( ( p ) => p.id === 'key' ).stand.x, z: WORLD.ports.find( ( p ) => p.id === 'key' ).stand.z, yaw: D.heading };

const frame = ( lx, lz ) => {

	const c = Math.cos( KEY_FRAME.yaw ), s = Math.sin( KEY_FRAME.yaw );
	return [ KEY_FRAME.x + lx * c + lz * s, KEY_FRAME.z - lx * s + lz * c ];

};

export class SaltmarshKey {

	constructor( { scene, terrain, colliders = null, material = null, shrubs = true } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'saltmarshKey' );
		this.group = new Group();
		this.group.name = 'SaltmarshKey';
		scene.add( this.group );
		this.lights = [];

		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		const jetty = buildJetty( { D, terrain, add, colliders, tag: 'key', seed: 57 } );
		this.jetty = jetty;
		this.lights.push( ...jetty.lights );
		this._hut( add, colliders );
		this._gear( add, colliders );
		this.shrubs = shrubs ? this._mangroves( add ) : 0;
		const mesh = new Mesh( mergePrepared( P ), this.material );
		mesh.name = 'SaltmarshKeyProps';
		mesh.castShadow = true;
		this.group.add( mesh );

	}

	// the hut behind the stall: weathered planks, a tin roof, a porch toward the water, a window
	_hut( add, colliders ) {

		const t = this.terrain;
		const yaw = KEY_FRAME.yaw;
		const [ x, z ] = frame( 0.6, - 5.6 );
		const hx = 2.2, hz = 1.8, wallH = 2.4;
		let y0 = Infinity;
		for ( const [ ox, oz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) {

			const c = Math.cos( yaw ), s = Math.sin( yaw );
			y0 = Math.min( y0, t.heightAt( x + ox * hx * c + oz * hz * s, z - ox * hx * s + oz * hz * c ) );

		}

		y0 = Math.max( y0, 0.3 );
		this.hut = { x, z, y: y0, yaw };
		const M = ( lx, ly, lz, rx = 0, ry = 0, rz = 0 ) => {

			const c = Math.cos( yaw ), s = Math.sin( yaw );
			return mat4( x + lx * c + lz * s, y0 + ly, z - lx * s + lz * c, rx, yaw + ry, rz, 1, 1, 1, 'YXZ' );

		};

		// footings (short stone piers), floor, plank walls in sun-faded turquoise, a lean door, window and shutter
		for ( const [ fx, fz ] of [ [ - 1, - 1 ], [ 0, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 0, 1 ], [ 1, 1 ] ] ) add( cylinder( 0.2, 0.24, 0.4, 8 ), { color: 0x6d675e, rough: 0.95, matrix: M( fx * ( hx - 0.2 ), 0.12, fz * ( hz - 0.2 ) ) } );
		add( box( 2 * hx + 0.2, 0.18, 2 * hz + 0.2 ), { ...WOOD( 0x5a4e40 ), matrix: M( 0, 0.3, 0 ) } );
		add( box( 2 * hx, wallH, 2 * hz ), { ...WOODX( 0x7d948f ), matrix: M( 0, wallH / 2 + 0.4, 0 ) } );
		add( box( 0.95, 1.95, 0.08 ), { ...WOOD( 0x8a4b3a ), matrix: M( 1.0, 1.4, hz + 0.03 ) } );
		add( box( 0.9, 0.7, 0.08 ), { color: 0x1d2a33, rough: 0.2, matrix: M( - 1.1, 1.9, hz + 0.03 ) } );
		add( box( 0.95, 0.08, 0.14 ), { ...WOOD( 0x5a4e40 ), matrix: M( - 1.1, 2.3, hz + 0.05 ) } );
		add( box( 0.12, 0.74, 0.04 ), { ...WOOD( 0x8a4b3a ), matrix: M( - 1.7, 1.9, hz + 0.1 ) } );
		add( box( 0.12, 0.74, 0.04 ), { ...WOOD( 0x8a4b3a ), matrix: M( - 0.5, 1.9, hz + 0.1 ) } );

		// pitched tin roof, ridge along x
		const slope = 0.4, rw = hz / Math.cos( slope ) + 0.45;
		for ( const sgn of [ - 1, 1 ] ) {

			add( box( 2 * hx + 0.7, 0.07, rw ), { color: 0x6f7377, rough: 0.55, metal: 0.6, pattern: PAT.rusty, matrix: M( 0, wallH + 0.55 + hz * 0.5 * Math.tan( slope ), sgn * hz * 0.5, sgn * slope, 0, 0 ) } );

		}

		add( box( 2 * hx, hz * Math.tan( slope ), 0.05 ), { ...WOODX( 0x7d948f ), matrix: M( 0, wallH + 0.42 + hz * 0.5 * Math.tan( slope ), hz ) } );
		add( box( 2 * hx, hz * Math.tan( slope ), 0.05 ), { ...WOODX( 0x7d948f ), matrix: M( 0, wallH + 0.42 + hz * 0.5 * Math.tan( slope ), - hz ) } );
		// a chimney pipe
		add( cylinder( 0.1, 0.1, 1.1, 8 ), { color: 0x3b3b3d, rough: 0.5, metal: 0.7, matrix: M( - 1.4, wallH + 1.0, - 0.7 ) } );

		// porch: planks across the front, two posts with a lean-to roof over the door
		for ( let k = 0; k < 5; k ++ ) add( box( 2.6, 0.05, 0.28 ), { ...WOODX( [ 0x8a7a64, 0x7d6e5a, 0x92836b, 0x6f6150, 0x85755f ][ k ] ), matrix: M( 0.6, 0.36, hz + 0.18 + k * 0.28 ) } );
		for ( const sx of [ - 0.65, 1.85 ] ) add( cylinder( 0.06, 0.07, 2.35, 7 ), { ...WOOD( 0x6e5f4c ), matrix: M( sx, 0.4 + 1.1, hz + 1.5 ) } );
		add( box( 2.9, 0.05, 1.9 ), { color: 0x6f7377, rough: 0.55, metal: 0.6, pattern: PAT.rusty, matrix: M( 0.6, 2.6, hz + 0.6, 0.12, 0, 0 ) } );
		// a hanging lantern at the porch roof's edge (the light is added by KeyPort)
		add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: M( 1.85, 2.2, hz + 1.5 ) } );
		add( cylinder( 0.03, 0.09, 0.05, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: M( 1.85, 2.35, hz + 1.5 ) } );
		const W = ( lx, lz ) => {

			const c = Math.cos( yaw ), s = Math.sin( yaw );
			return [ x + lx * c + lz * s, z - lx * s + lz * c ];

		};

		const [ px, pz ] = W( 1.85, hz + 1.5 );
		this.lights.push( { position: new Vector3( px, y0 + 2.2, pz ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );
		// a lit window (light only outward, like the village's)
		const [ wx, wz ] = W( - 1.1, hz + 0.5 );
		this.lights.push( { position: new Vector3( wx, y0 + 1.9, wz ), color: new Color( 1.0, 0.8, 0.5 ), intensity: 0.8, range: 6, kind: 'window' } );

		if ( colliders ) {

			colliders.addBox( new Vector3( x, y0 + wallH / 2 + 0.3, z ), new Vector3( hx, wallH / 2 + 0.3, hz ), yaw, { tag: 'keyHut' } );

		}

	}

	// gear around the hut: drying racks with fish, crab pots, a net heap, a skiff on trestles, barrels
	_gear( add, colliders ) {

		const yaw = KEY_FRAME.yaw;
		const t = this.terrain;
		const place = ( lx, lz ) => {

			const [ x, z ] = frame( lx, lz );
			return [ x, z, Math.max( t.heightAt( x, z ), 0.15 ) ];

		};

		// two drying racks: posts, a rail, a dozen silver fish hung head-down
		for ( const [ rx, rz ] of [ [ - 5.6, - 4.8 ], [ - 5.8, - 7.6 ] ] ) {

			const [ x, z, y ] = place( rx, rz );
			const R = ( lx, ly, lz, rxr = 0, ryr = 0, rzr = 0, sx = 1, sy = sx, sz = sx ) => {

				const c = Math.cos( yaw ), s = Math.sin( yaw );
				return mat4( x + lx * c + lz * s, y + ly, z - lx * s + lz * c, rxr, yaw + ryr, rzr, sx, sy, sz, 'YXZ' );

			};

			for ( const sx of [ - 1.4, 1.4 ] ) add( cylinder( 0.05, 0.06, 1.9, 6 ), { ...WOOD( 0x5f5243 ), matrix: R( sx, 0.85, 0 ) } );
			add( cylinder( 0.035, 0.035, 2.9, 6 ), { ...WOOD( 0x6e5f4c ), matrix: R( 0, 1.75, 0, 0, 0, Math.PI / 2 ) } );
			for ( let k = 0; k < 11; k ++ ) {

				const fx = - 1.2 + k * 0.24;
				const tone = [ 0xb8c4cc, 0xa2b2bc, 0xc9d2d6, 0x8fa6b2 ][ k % 4 ];
				add( sphere( 1, 7, 5 ), { color: tone, rough: 0.35, metal: 0.4, matrix: R( fx, 1.5, 0.02 * ( k % 3 ), 0, 0, 0.05 * ( k % 2 ? 1 : - 1 ), 0.035, 0.2, 0.07 ) } );
				add( box( 0.01, 0.07, 0.05 ), { color: tone, rough: 0.4, matrix: R( fx, 1.28, 0.02 * ( k % 3 ) ) } );

			}

			if ( colliders ) colliders.addBox( new Vector3( x, y + 0.9, z ), new Vector3( 0.1, 0.9, 1.5 ), yaw + Math.PI / 2, { tag: 'keyRack' } );

		}

		// crab pots (wire cages with a ring and a float)
		for ( const [ cx, cz, cy ] of [ [ 3.2, - 4.6, 0 ], [ 3.9, - 4.2, 0 ], [ 3.5, - 4.4, 0.62 ] ] ) {

			const [ x, z, y ] = place( cx, cz );
			add( cylinder( 0.38, 0.38, 0.55, 10 ), { color: 0x4d5a52, rough: 0.5, metal: 0.5, pattern: PAT.rusty, matrix: mat4( x, y + 0.28 + cy, z ) } );
			add( torus( 0.38, 0.018, 5, 14 ), { color: 0x3b3f3c, rough: 0.5, metal: 0.6, matrix: mat4( x, y + 0.56 + cy, z, Math.PI / 2 ) } );
			add( sphere( 0.09, 8, 6 ), { color: 0xe2552a, rough: 0.5, matrix: mat4( x + 0.3, y + 0.62 + cy, z + 0.1 ) } );

		}

		// a heap of olive net with floats
		{

			const [ x, z, y ] = place( - 3.0, - 6.8 );
			add( sphere( 1, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0x5d6b4a, rough: 1, pattern: PAT.cloth, matrix: mat4( x, y, z, 0, 0.4, 0, 0.95, 0.4, 0.7 ) } );
			for ( let k = 0; k < 4; k ++ ) add( sphere( 0.07, 8, 6 ), { color: [ 0xe2552a, 0xe8e2d0 ][ k % 2 ], rough: 0.5, matrix: mat4( x - 0.5 + k * 0.32, y + 0.32, z + ( k % 2 ? 0.2 : - 0.15 ) ) } );

		}

		// the skiff upturned on two trestles
		{

			const [ x, z, y ] = place( 1.4, - 9.9 );
			const R = ( lx, ly, lz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => {

				const c = Math.cos( yaw ), s = Math.sin( yaw );
				return mat4( x + lx * c + lz * s, y + ly, z - lx * s + lz * c, rx, yaw + ry, rz, sx, sy, sz, 'YXZ' );

			};

			add( sphere( 1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0x2f6f86, rough: 0.5, matrix: R( 0, 0.55, 0, Math.PI, 0, 0, 0.6, 0.38, 2.0 ) } );
			add( box( 0.06, 0.04, 3.7 ), { ...WOOD( 0x6e5f4c ), matrix: R( 0, 0.57, 0 ) } );
			for ( const lz of [ - 0.9, 0.9 ] ) {

				add( box( 1.2, 0.07, 0.07 ), { ...WOOD( 0x5f5243 ), matrix: R( 0, 0.55, lz ) } );
				for ( const sx of [ - 0.5, 0.5 ] ) add( box( 0.07, 0.55, 0.07 ), { ...WOOD( 0x5f5243 ), matrix: R( sx, 0.27, lz ) } );

			}

			if ( colliders ) colliders.addBox( new Vector3( x, y + 0.6, z ), new Vector3( 0.7, 0.6, 1.9 ), yaw, { tag: 'keySkiff' } );

		}

		// two barrels and a crate by the hut wall
		for ( const [ bx, bz ] of [ [ - 2.6, - 3.9 ], [ - 3.3, - 3.6 ] ] ) {

			const [ x, z, y ] = place( bx, bz );
			add( cylinder( 0.3, 0.28, 0.8, 12 ), { ...WOOD( 0x5b4a39 ), matrix: mat4( x, y + 0.4, z ) } );

		}

	}

	// mangrove clumps in the shallows round the shore, scrub on the low ground, reed tufts
	_mangroves( add ) {

		const t = this.terrain;
		let s = 4129;
		const rnd = () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );
		const GREENS = [ 0x2f5a2c, 0x3b6a30, 0x2a4f2a, 0x47773a ];
		const [ hx, hz ] = [ this.hut.x, this.hut.z ];
		const clearOf = ( x, z ) => {

			const [ u, v ] = [ ( x - I.x ) * I.ax + ( z - I.z ) * I.az, - ( x - I.x ) * I.az + ( z - I.z ) * I.ax ];
			if ( u < - 20 && Math.abs( v ) < 7 ) return false; // the dock approach and the channel
			if ( Math.hypot( x - hx, z - hz ) < 13 ) return false; // the hut and the stall
			if ( Math.hypot( x - KEY_FRAME.x, z - KEY_FRAME.z ) < 9 ) return false;
			return true;

		};

		let n = 0;
		const target = 110;
		for ( let k = 0; k < 20000 && n < target; k ++ ) {

			const [ x, z ] = isletWorld( I, ( rnd() - 0.5 ) * 150, ( rnd() - 0.5 ) * 110 );
			const h = t.heightAt( x, z );
			if ( h < - 0.75 || h > 1.25 || ! clearOf( x, z ) ) continue;
			if ( h > 0.5 && rnd() < 0.8 ) continue; // the scrub is sparse; the mangroves line the water
			const sh = Math.max( h, - 0.2 );
			const small = h > 0.8; // scrub on the low ground
			const sc = small ? 0.55 + rnd() * 0.4 : 0.8 + rnd() * 0.7;
			const yaw = rnd() * 6.28;
			const col = GREENS[ Math.floor( rnd() * GREENS.length ) ];
			const base = ( lx, ly, lz, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => mat4( x, h, z, 0, yaw, 0, sc ).multiply( mat4( lx, ly, lz, rx, 0, rz, sx, sy, sz ) );
			void sh;
			// trunk and the canopy lumps
			add( cylinder( 0.05, 0.09, 0.9, 6 ), { ...WOOD( 0x4d3f32 ), matrix: base( 0, 0.55, 0, 0.08, 0.05 ) } );
			const lumps = 3 + Math.floor( rnd() * 3 );
			for ( let q = 0; q < lumps; q ++ ) {

				const a = q / lumps * 6.28 + rnd(), r = q === 0 ? 0 : 0.35 + rnd() * 0.3;
				const rad = 0.55 + rnd() * 0.4;
				add( sphere( 1, 7, 5 ), { color: col, rough: 0.85, matrix: base( Math.cos( a ) * r, 1.15 + rnd() * 0.3, Math.sin( a ) * r, 0, 0, rad, rad * 0.7, rad ) } );

			}

			// prop roots: thin arched rods from the canopy down to the mud or water
			if ( ! small ) {

				const roots = 5 + Math.floor( rnd() * 4 );
				for ( let q = 0; q < roots; q ++ ) {

					const a = q / roots * 6.28 + rnd() * 0.5, lean = 0.4 + rnd() * 0.35;
					const len = 1.1 + rnd() * 0.3;
					add( cylinder( 0.018, 0.03, len, 5 ), { ...WOOD( 0x5b4a39 ), matrix: base( Math.cos( a ) * 0.4, 0.55, Math.sin( a ) * 0.4, Math.sin( a ) * lean, - Math.cos( a ) * lean ) } );

				}

			}

			n ++;

		}

		// reed tufts at the water line and along the low ground
		let tufts = 0;
		for ( let k = 0; k < 9000 && tufts < 70; k ++ ) {

			const [ x, z ] = isletWorld( I, ( rnd() - 0.5 ) * 140, ( rnd() - 0.5 ) * 100 );
			const h = t.heightAt( x, z );
			if ( h < - 0.35 || h > 1.0 || ! clearOf( x, z ) ) continue;
			const blades = 5 + Math.floor( rnd() * 4 );
			for ( let q = 0; q < blades; q ++ ) {

				const a = rnd() * 6.28, lean = 0.1 + rnd() * 0.3, len = 0.6 + rnd() * 0.6;
				add( cylinder( 0.004, 0.018, len, 4 ), { color: [ 0x7d8f4a, 0x93a055, 0x6b7d3d ][ q % 3 ], rough: 0.9, matrix: mat4( x + Math.cos( a ) * 0.12, h + len / 2 - 0.05, z + Math.sin( a ) * 0.12, Math.sin( a ) * lean, 0, - Math.cos( a ) * lean ) } );

			}

			tufts ++;

		}

		return n;

	}

	update() {}

}
