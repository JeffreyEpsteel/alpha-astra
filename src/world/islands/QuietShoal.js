import { Group, Mesh, Vector3 } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { WORLD } from '../WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../terrain/IslandShape.js';
import { buildJetty } from './Jetty.js';
import { WOOD, WOODX, rng, frameAt, lantern, cullParts } from './IslandKit.js';

// Quiet Shoal, the low mangrove and root island north-west of the main island (terrain/IslandShape.js
// ISLES_5_8 'shoal'; the Unreal game's "Quiet shoal" landing, and its second fishing spot, the Hanging Roots):
// a muddy key on a wide shoal, prop-rooted mangroves standing in the shallows all round, reeds, a net shed on
// stilts by the jetty, and inland the Hanging Roots: a giant strangler fig, ~24 m, its branches dropping
// curtains of aerial roots to the ground. The fig's trunk and crown are a separate landmark mesh (seen from
// far off); the roots, mangroves and the rest are culled beyond NEAR.
//
//   const shoal = new QuietShoal( { scene, terrain, colliders } );
//   shoal.group, shoal.lights, shoal.update( dt )   shoal.fig: { x, z, y, height }   shoal.shrubs, shoal.roots

const I = ISLETS_BY_ID.shoal;
const D = WORLD.shoal.dock;
const NEAR = 650;
const FAR = 2600;
const GREENS = [ 0x2f5a2c, 0x3b6a30, 0x2a4f2a, 0x47773a ];

export class QuietShoal {

	constructor( { scene, terrain, colliders = null, material = null, shrubs = true } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'quietShoal' );
		this.group = new Group();
		this.group.name = 'QuietShoal';
		scene.add( this.group );
		this.lights = [];
		this.center = new Vector3( I.x, 0, I.z );

		const P = [], Fg = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		const addFar = ( g, o ) => Fg.push( prepare( g, o ) );
		this.jetty = buildJetty( { D, terrain, add, colliders, tag: 'shoal', seed: 23, lanterns: 1 } );
		this.lights.push( ...this.jetty.lights );
		this._shed( add, colliders );
		this.roots = this._fig( addFar, add, colliders );
		this.shrubs = shrubs ? this._mangroves( add ) : 0;
		const near = new Mesh( mergePrepared( P ), this.material );
		near.name = 'QuietShoalProps';
		near.castShadow = true;
		const far = new Mesh( mergePrepared( Fg ), this.material );
		far.name = 'QuietShoalFig';
		far.castShadow = true;
		this.group.add( near, far );
		this.parts = [ { object: near, dist: NEAR }, { object: far, dist: FAR } ];

	}

	// the net shed on stilts (pad at island (-34, 14)): a plank hut on six posts over the mud, nets hung to dry
	_shed( add, colliders ) {

		const [ x, z ] = isletWorld( I, - 34, 14 );
		const yaw = Math.atan2( - I.ax, - I.az );
		const g = this.terrain.heightAt( x, z );
		const F = frameAt( x, g, z, yaw );
		this.shed = { x, z, y: g, yaw };
		const fl = 1.1; // floor above the ground
		for ( const [ sx, sz ] of [ [ - 1, - 1 ], [ 0, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 0, 1 ], [ 1, 1 ] ] ) add( cylinder( 0.09, 0.11, fl + 0.6, 7 ), { ...WOOD( 0x4b4034 ), matrix: F.m( sx * 1.6, ( fl - 0.6 ) / 2, sz * 1.3 ) } );
		add( box( 3.8, 0.12, 3.2 ), { ...WOODX( 0x6f6150 ), matrix: F.m( 0, fl, 0 ) } );
		add( box( 3.4, 2.0, 2.6 ), { ...WOODX( 0x7a6e5a ), matrix: F.m( 0, fl + 1.06, - 0.2 ) } );
		add( box( 0.85, 1.7, 0.06 ), { ...WOOD( 0x3d4b55 ), matrix: F.m( 0.7, fl + 0.9, 1.13 ) } );
		for ( const s of [ - 1, 1 ] ) add( box( 4.0, 0.06, 1.9 ), { color: 0x7a5b3a, rough: 0.95, pattern: PAT.cloth, matrix: F.m( 0, fl + 2.35, s * 0.75 - 0.2, s * 0.38, 0, 0 ) } );
		// a ladder down to the mud, nets on a line between two poles, floats
		for ( let k = 0; k < 4; k ++ ) add( box( 0.6, 0.05, 0.08 ), { ...WOOD( 0x5b4a39 ), matrix: F.m( - 0.9, 0.2 + k * 0.3, 1.75 ) } );
		for ( const s of [ - 0.65, - 1.15 ] ) add( box( 0.05, 1.3, 0.05 ), { ...WOOD( 0x5b4a39 ), matrix: F.m( s, 0.55, 1.75, 0.15, 0, 0 ) } );
		for ( const s of [ 3.2, 6.4 ] ) add( cylinder( 0.05, 0.06, 2.2, 6 ), { ...WOOD( 0x6e5f4c ), matrix: F.m( s, 1.1, 0.6 ) } );
		add( box( 3.0, 1.4, 0.02 ), { color: 0x6b7d6a, rough: 1, pattern: PAT.cloth, matrix: F.m( 4.8, 1.3, 0.6 ) } );
		for ( let k = 0; k < 5; k ++ ) add( sphere( 0.1, 8, 6 ), { color: [ 0xe8e2d0, 0xf2c230, 0xd9542b ][ k % 3 ], rough: 0.5, matrix: F.m( 3.5 + k * 0.6, 1.95, 0.62 ) } );
		const [ lx, lz ] = F.world( 1.5, 1.4 );
		this.lights.push( lantern( add, lx, g + fl + 1.85, lz ) );
		if ( colliders ) colliders.addBox( new Vector3( x, g + fl / 2 + 1.1, z ), new Vector3( 1.9, fl / 2 + 1.1, 1.6 ), yaw, { tag: 'shoalShed' } );

	}

	// the Hanging Roots: buttressed trunk, spreading limbs, a broad crown and curtains of aerial roots
	_fig( addFar, add, colliders ) {

		const [ x, z ] = isletWorld( I, 0, 2 );
		const y = this.terrain.heightAt( x, z );
		const rnd = rng( 6113 );
		const H = 24;
		this.fig = { x, z, y, height: H };
		const BARK = [ 0x6d6255, 0x5f564a, 0x776b5d ];
		// the trunk: a bundle of fused stems with flaring buttresses at the foot
		for ( let k = 0; k < 7; k ++ ) {

			const a = k / 7 * Math.PI * 2 + rnd() * 0.4, r = 0.9 + rnd() * 0.5;
			const bx = x + Math.cos( a ) * r, bz = z + Math.sin( a ) * r;
			addFar( rod( new Vector3( bx, y - 0.4, bz ), new Vector3( x + Math.cos( a ) * 0.4, y + H * 0.55, z + Math.sin( a ) * 0.4 ), 0.75 - k * 0.04, 7, 0.45 ), { ...WOOD( BARK[ k % 3 ], { rough: 0.95 } ) } );
			const fx = x + Math.cos( a ) * ( 3.2 + rnd() ), fz = z + Math.sin( a ) * ( 3.2 + rnd() );
			addFar( rod( new Vector3( fx, y - 0.3, fz ), new Vector3( bx, y + 3.2, bz ), 0.28, 6, 0.55 ), { ...WOOD( BARK[ ( k + 1 ) % 3 ], { rough: 0.95 } ) } );

		}

		// limbs spreading out level-ish from the top of the trunk; the crown lumps sit on them; roots hang from them
		const limbs = [];
		for ( let k = 0; k < 9; k ++ ) {

			const a = k / 9 * Math.PI * 2 + rnd() * 0.5;
			const len = 9 + rnd() * 6, y0 = y + H * ( 0.5 + rnd() * 0.12 );
			const a0 = new Vector3( x + Math.cos( a ) * 0.6, y0, z + Math.sin( a ) * 0.6 );
			const a1 = new Vector3( x + Math.cos( a ) * len, y0 + 2 + rnd() * 3, z + Math.sin( a ) * len );
			addFar( rod( a0, a1, 0.5, 6, 0.16 ), { ...WOOD( BARK[ k % 3 ], { rough: 0.95 } ) } );
			limbs.push( [ a0, a1 ] );

		}

		for ( let k = 0; k < 26; k ++ ) {

			const [ a0, a1 ] = limbs[ k % limbs.length ];
			const f = 0.35 + rnd() * 0.75;
			const cx = a0.x + ( a1.x - a0.x ) * f + ( rnd() - 0.5 ) * 3, cz = a0.z + ( a1.z - a0.z ) * f + ( rnd() - 0.5 ) * 3;
			const cy = a0.y + ( a1.y - a0.y ) * f + 2.5 + rnd() * 3.5;
			const r = 3.2 + rnd() * 2.6;
			addFar( sphere( 1, 9, 6 ), { color: GREENS[ k % GREENS.length ], rough: 0.85, matrix: mat4( cx, cy, cz, 0, rnd() * 3, 0, r, r * 0.62, r ) } );

		}

		// aerial roots: thin, slightly wavy strands from the limbs to (nearly) the ground; the thick ones root
		let n = 0;
		for ( let k = 0; k < 150; k ++ ) {

			const [ a0, a1 ] = limbs[ k % limbs.length ];
			const f = 0.2 + rnd() * 0.8;
			const sx = a0.x + ( a1.x - a0.x ) * f, sz = a0.z + ( a1.z - a0.z ) * f, sy = a0.y + ( a1.y - a0.y ) * f - 0.3;
			const g = this.terrain.heightAt( sx, sz );
			const thick = rnd() < 0.18;
			const end = thick ? g - 0.2 : g + 0.4 + rnd() * ( sy - g ) * 0.55;
			const r = thick ? 0.12 + rnd() * 0.06 : 0.025 + rnd() * 0.03;
			const mid = new Vector3( sx + ( rnd() - 0.5 ) * 0.8, ( sy + end ) / 2, sz + ( rnd() - 0.5 ) * 0.8 );
			add( rod( new Vector3( sx, sy, sz ), mid, r, 4, r * 0.9 ), { ...WOOD( thick ? 0x6d6255 : 0x7d705f, { rough: 0.95 } ) } );
			add( rod( mid, new Vector3( mid.x + ( rnd() - 0.5 ) * 0.5, end, mid.z + ( rnd() - 0.5 ) * 0.5 ), r * 0.9, 4, r * ( thick ? 1.2 : 0.4 ) ), { ...WOOD( thick ? 0x6d6255 : 0x7d705f, { rough: 0.95 } ) } );
			if ( thick && colliders ) colliders.addCylinder( mid.x, mid.z, r + 0.05, g - 0.3, sy, { tag: 'shoalRoot' } );
			n ++;

		}

		if ( colliders ) colliders.addCylinder( x, z, 2.0, y - 1, y + H * 0.55, { tag: 'shoalFig' } );
		return n;

	}

	// mangroves in the shallows round the shore, scrub on the low ground, reed tufts (as at Saltmarsh Key, denser)
	_mangroves( add ) {

		const t = this.terrain, rnd = rng( 3391 );
		const F = this.fig, S = this.shed;
		const clearOf = ( x, z ) => {

			const dx = x - I.x, dz = z - I.z;
			const u = dx * I.ax + dz * I.az, v = - dx * I.az + dz * I.ax;
			if ( u < - 30 && Math.abs( v ) < 8 ) return false; // the jetty and its approach
			if ( Math.hypot( x - F.x, z - F.z ) < 7 ) return false;
			if ( Math.hypot( x - S.x, z - S.z ) < 9 ) return false;
			return true;

		};

		let n = 0;
		for ( let k = 0; k < 24000 && n < 150; k ++ ) {

			const [ x, z ] = isletWorld( I, ( rnd() - 0.5 ) * 150, ( rnd() - 0.5 ) * 125 );
			const h = t.heightAt( x, z );
			if ( h < - 0.8 || h > 2.2 || ! clearOf( x, z ) ) continue;
			if ( h > 0.6 && rnd() < 0.75 ) continue; // the mangroves line the water; inland they thin out
			const small = h > 1.0;
			const sc = small ? 0.6 + rnd() * 0.5 : 0.9 + rnd() * 0.9;
			const yaw = rnd() * 6.28;
			const col = GREENS[ Math.floor( rnd() * GREENS.length ) ];
			const base = ( lx, ly, lz, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => mat4( x, h, z, 0, yaw, 0, sc ).multiply( mat4( lx, ly, lz, rx, 0, rz, sx, sy, sz ) );
			add( cylinder( 0.05, 0.09, 1.0, 6 ), { ...WOOD( 0x4d3f32 ), matrix: base( 0, 0.65, 0, 0.08, 0.05 ) } );
			const lumps = 3 + Math.floor( rnd() * 3 );
			for ( let q = 0; q < lumps; q ++ ) {

				const a = q / lumps * 6.28 + rnd(), r = q === 0 ? 0 : 0.4 + rnd() * 0.35;
				const rad = 0.6 + rnd() * 0.45;
				add( sphere( 1, 7, 5 ), { color: col, rough: 0.85, matrix: base( Math.cos( a ) * r, 1.3 + rnd() * 0.35, Math.sin( a ) * r, 0, 0, rad, rad * 0.7, rad ) } );

			}

			if ( ! small ) {

				const roots = 6 + Math.floor( rnd() * 4 );
				for ( let q = 0; q < roots; q ++ ) {

					const a = q / roots * 6.28 + rnd() * 0.5, lean = 0.4 + rnd() * 0.35;
					add( cylinder( 0.018, 0.032, 1.2 + rnd() * 0.3, 5 ), { ...WOOD( 0x5b4a39 ), matrix: base( Math.cos( a ) * 0.42, 0.6, Math.sin( a ) * 0.42, Math.sin( a ) * lean, - Math.cos( a ) * lean ) } );

				}

			}

			n ++;

		}

		for ( let k = 0, tufts = 0; k < 9000 && tufts < 80; k ++ ) {

			const [ x, z ] = isletWorld( I, ( rnd() - 0.5 ) * 140, ( rnd() - 0.5 ) * 115 );
			const h = t.heightAt( x, z );
			if ( h < - 0.35 || h > 1.2 || ! clearOf( x, z ) ) continue;
			const blades = 5 + Math.floor( rnd() * 4 );
			for ( let q = 0; q < blades; q ++ ) {

				const a = rnd() * 6.28, lean = 0.1 + rnd() * 0.3, len = 0.6 + rnd() * 0.7;
				add( cylinder( 0.004, 0.018, len, 4 ), { color: [ 0x7d8f4a, 0x93a055, 0x6b7d3d ][ q % 3 ], rough: 0.9, matrix: mat4( x + Math.cos( a ) * 0.12, h + len / 2 - 0.05, z + Math.sin( a ) * 0.12, Math.sin( a ) * lean, 0, - Math.cos( a ) * lean ) } );

			}

			tufts ++;

		}

		return n;

	}

	update() {

		this.distance = cullParts( this.center, this.parts );

	}

}
