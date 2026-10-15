import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { G } from '../../engine/render/Frame.js';
import { WORLD } from '../WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../terrain/IslandShape.js';
import { buildJetty } from './Jetty.js';
import { WOOD, WOODX, STONE, rng, frameAt, basaltCluster, lantern, cullParts } from './IslandKit.js';

// The Shrine, the basalt sea-stack cluster north-east of the main island (terrain/IslandShape.js ISLES_5_8
// 'shrine'; the Unreal game's "The shrine"): a dark steep rock ringed by a dozen sea stacks (the terrain), with
// clusters of hexagonal basalt columns at their feet and along the shore, a short jetty on the one pocket
// beach, the hermit fisher's stone hut above it (the hermit himself is src/game/ports/ShrinePort.js), stone
// steps up the rock and the shrine on the summit: a cairn with a lantern niche under a timber gate, strung
// with faded flags. The shrine lamp burns brighter at night.
//
//   const shrine = new TheShrine( { scene, terrain, colliders } );
//   shrine.group, shrine.lights, shrine.update( dt )   shrine.hut: { x, z, y, yaw }   shrine.summit: { x, z, y }
//   shrine.columns: number of basalt columns

const I = ISLETS_BY_ID.shrine;
const D = WORLD.shrine.dock;
export const SHRINE_YAW = Math.atan2( - I.ax, - I.az ); // facing out of the hut toward the landing
const NEAR = 700;

export class TheShrine {

	constructor( { scene, terrain, colliders = null, material = null } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'theShrine' );
		this.group = new Group();
		this.group.name = 'TheShrine';
		scene.add( this.group );
		this.lights = [];
		this.center = new Vector3( I.x, 0, I.z );
		this._t = 0;

		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		this.jetty = buildJetty( { D, terrain, add, colliders, tag: 'shrine', seed: 17, lanterns: 1, crates: false } );
		this.lights.push( ...this.jetty.lights );
		this._hut( add, colliders );
		this._steps( add );
		this._summit( add, colliders );
		this.columns = this._basalt( add );
		const mesh = new Mesh( mergePrepared( P ), this.material );
		mesh.name = 'TheShrineProps';
		mesh.castShadow = true;
		this.group.add( mesh );
		this.parts = [ { object: mesh, dist: NEAR } ];

	}

	_frame( u, v, yaw = SHRINE_YAW, y = null ) {

		const [ x, z ] = isletWorld( I, u, v );
		return frameAt( x, y ?? this.terrain.heightAt( x, z ), z, yaw );

	}

	// the hermit's hut on its pad (island -27, 13): dry-stone walls, a turf roof, a drying rack and nets
	_hut( add, colliders ) {

		const F = this._frame( - 27, 13, SHRINE_YAW + 0.25 );
		this.hut = { x: F.x, z: F.z, y: F.y, yaw: F.yaw };
		const w = 3.6, d = 3.0, hh = 2.1;
		const rnd = rng( 731 );
		// the walls: courses of rough stones (slightly jittered boxes) so the dry-stone reads up close
		for ( let row = 0; row < 6; row ++ ) {

			const y = 0.18 + row * 0.35;
			for ( const [ ax, az, len, ry ] of [ [ 0, d / 2, w, 0 ], [ 0, - d / 2, w, 0 ], [ w / 2, 0, d, Math.PI / 2 ], [ - w / 2, 0, d, Math.PI / 2 ] ] ) {

				if ( az > 0 && row < 5 && len === w ) {

					// the front: leave the doorway (0.9 m wide, right of centre)
					for ( const [ x0, x1 ] of [ [ - w / 2, 0.1 ], [ 1.0, w / 2 ] ] ) add( box( x1 - x0, 0.33, 0.45 ), { ...STONE( [ 0x4a4846, 0x55524e, 0x3f3e3c ][ ( row + Math.floor( rnd() * 3 ) ) % 3 ] ), matrix: F.m( ( x0 + x1 ) / 2, y, az, 0, ( rnd() - 0.5 ) * 0.04, 0 ) } );
					continue;

				}

				add( box( len + 0.4, 0.33, 0.45 ), { ...STONE( [ 0x4a4846, 0x55524e, 0x3f3e3c ][ ( row + Math.floor( rnd() * 3 ) ) % 3 ] ), matrix: F.m( ax, y, az, 0, ry + ( rnd() - 0.5 ) * 0.04, 0 ) } );

			}

		}

		add( box( 1.1, 0.25, 0.5 ), { ...STONE( 0x3a3936 ), matrix: F.m( 0.55, 1.9, d / 2 ) } ); // lintel
		add( box( 0.85, 1.7, 0.06 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( 0.55, 0.85, d / 2 - 0.1 ) } );
		// the turf roof: a low hipped mound (flattened sphere) on a timber edge
		add( box( w + 0.7, 0.14, d + 0.7 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( 0, hh + 0.1, 0 ) } );
		add( sphere( 1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0x4c5a33, rough: 1, pattern: PAT.cloth, matrix: F.m( 0, hh + 0.15, 0, 0, 0, 0, w / 2 + 0.4, 0.9, d / 2 + 0.4 ) } );
		add( cylinder( 0.12, 0.14, 0.9, 8 ), { ...STONE( 0x3a3936 ), matrix: F.m( - 1.0, hh + 0.95, - 0.6 ) } );
		// a fish-drying rack beside the hut, a coracle and a coil of net
		for ( const s of [ - 1, 1 ] ) add( cylinder( 0.04, 0.05, 1.8, 6 ), { ...WOOD( 0x6e5f4c ), matrix: F.m( w / 2 + 1.2, 0.9, s * 0.9 ) } );
		add( cylinder( 0.03, 0.03, 1.9, 6 ), { ...WOOD( 0x6e5f4c ), matrix: F.m( w / 2 + 1.2, 1.75, 0, Math.PI / 2, 0, 0 ) } );
		for ( let k = 0; k < 6; k ++ ) add( sphere( 1, 6, 4 ), { color: [ 0xa89a7c, 0x9d8f72, 0xb3a586 ][ k % 3 ], rough: 0.7, matrix: F.m( w / 2 + 1.2, 1.45, - 0.75 + k * 0.3, 0, 0, 0, 0.04, 0.24, 0.07 ) } );
		add( sphere( 1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0x3b2f24, rough: 0.8, matrix: F.m( - w / 2 - 1.1, 0.02, 1.2, Math.PI, 0, 0, 0.75, 0.32, 0.75 ) } );
		add( cylinder( 0.55, 0.6, 0.18, 12 ), { color: 0x5d6b55, rough: 1, pattern: PAT.cloth, matrix: F.m( - w / 2 - 0.6, 0.09, - 0.6 ) } );
		const [ lx, lz ] = F.world( 1.3, d / 2 + 0.35 );
		this.lights.push( lantern( add, lx, F.y + 1.9, lz ) );
		if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + 1.2, F.z ), new Vector3( w / 2 + 0.25, 1.2, d / 2 + 0.25 ), F.yaw, { tag: 'shrineHut' } );

	}

	// flat stone steps along the path from the hut up the rock (IslandShape PATHS 'shrine')
	_steps( add ) {

		const pts = [ [ - 27, 7 ], [ - 21, 4 ], [ - 15, 2 ], [ - 8, 3 ], [ - 1, 6 ], [ 6, 9 ] ];
		const rnd = rng( 4421 );
		for ( let k = 0; k < pts.length - 1; k ++ ) {

			const [ u0, v0 ] = pts[ k ], [ u1, v1 ] = pts[ k + 1 ];
			const n = Math.ceil( Math.hypot( u1 - u0, v1 - v0 ) / 1.2 );
			for ( let q = 0; q < n; q ++ ) {

				const f = q / n;
				const [ x, z ] = isletWorld( I, u0 + ( u1 - u0 ) * f, v0 + ( v1 - v0 ) * f );
				const [ xa, za ] = isletWorld( I, u1, v1 );
				const yaw = Math.atan2( xa - x, za - z );
				add( box( 1.1, 0.16, 0.6 ), { ...STONE( [ 0x6a6762, 0x5f5c58, 0x75716b ][ q % 3 ] ), matrix: mat4( x, this.terrain.heightAt( x, z ) + 0.03, z, ( rnd() - 0.5 ) * 0.06, yaw + ( rnd() - 0.5 ) * 0.2, 0 ) } );

			}

		}

	}

	// the summit shrine (pad at island (10, 10)): a cairn with a lantern niche under a two-post timber gate
	_summit( add, colliders ) {

		const F = this._frame( 10, 10, SHRINE_YAW + Math.PI );
		this.summit = { x: F.x, z: F.z, y: F.y };
		const rnd = rng( 8811 );
		// the cairn: stacked flat stones, a dark niche facing the steps with the lamp in it
		let y = 0;
		for ( let k = 0; k < 7; k ++ ) {

			const r = 0.9 - k * 0.1, h = 0.26 + rnd() * 0.08;
			add( cylinder( r * ( 0.92 + rnd() * 0.1 ), r, h, 7 ), { ...STONE( [ 0x4a4846, 0x3d3c3a, 0x55524e ][ k % 3 ] ), matrix: F.m( ( rnd() - 0.5 ) * 0.06, y + h / 2, ( rnd() - 0.5 ) * 0.06, 0, rnd() * 2, 0 ) } );
			y += h;

		}

		add( box( 0.42, 0.42, 0.3 ), { color: 0x101214, rough: 0.9, matrix: F.m( 0, 0.85, - 0.62 ) } );
		const [ lx, lz ] = F.world( 0, - 0.68 );
		this.lamp = lantern( add, lx, F.y + 0.82, lz, { intensity: 9, range: 30, color: new Color( 1.0, 0.78, 0.45 ) } );
		const self = this;
		this.lamp.update = function () {

			// a votive flame: a slow flicker, much brighter once it is dark (seen from the sea)
			const night = Math.max( 0, Math.min( 1, ( G.night.value - 0.1 ) / 0.6 ) );
			this.scale = ( 0.35 + 0.65 * night ) * ( 0.9 + 0.1 * Math.sin( self._t * 7.3 ) * Math.sin( self._t * 2.1 ) );

		};

		this.lamp.scale = 1;
		this.lights.push( this.lamp );
		// the gate: two posts, a double lintel, painted rust red, in front of the cairn
		for ( const s of [ - 1, 1 ] ) add( cylinder( 0.13, 0.16, 3.4, 10 ), { color: 0x8a2f22, rough: 0.7, matrix: F.m( s * 1.5, 1.7, - 1.9 ) } );
		add( box( 4.2, 0.22, 0.3 ), { color: 0x2b2b2b, rough: 0.7, matrix: F.m( 0, 3.45, - 1.9 ) } );
		add( box( 3.5, 0.16, 0.22 ), { color: 0x8a2f22, rough: 0.7, matrix: F.m( 0, 2.95, - 1.9 ) } );
		// faded flags strung from the gate to a pole behind the cairn
		add( cylinder( 0.05, 0.06, 4.2, 6 ), { ...WOOD( 0x6e5f4c ), matrix: F.m( 0, 2.1, 2.2 ) } );
		const FL = [ 0xb8c4cc, 0xc9b48a, 0x9a5a4a, 0x7d8f6a, 0xd9cfb8 ];
		for ( const s of [ - 1, 1 ] ) {

			for ( let k = 0; k < 7; k ++ ) {

				const f = ( k + 0.5 ) / 7;
				const lx2 = s * 1.5 * ( 1 - f ), lz2 = - 1.9 + 4.1 * f, ly = 3.35 + 0.7 * f - 0.35 * Math.sin( f * Math.PI );
				add( box( 0.22, 0.28, 0.01 ), { color: FL[ ( k + ( s > 0 ? 2 : 0 ) ) % FL.length ], rough: 0.95, pattern: PAT.cloth, matrix: F.m( lx2, ly - 0.15, lz2, 0, Math.atan2( - s * 1.5, 4.1 ), 0.1 * s ) } );

			}

		}

		if ( colliders ) {

			colliders.addCylinder( F.x, F.z, 0.95, F.y - 0.3, F.y + y, { tag: 'shrineCairn' } );
			for ( const s of [ - 1, 1 ] ) {

				const [ px, pz ] = F.world( s * 1.5, - 1.9 );
				colliders.addCylinder( px, pz, 0.18, F.y - 0.3, F.y + 3.4, { tag: 'shrineGate' } );

			}

		}

	}

	// basalt columns: clusters at the feet of the sea stacks and along the rocky shore
	_basalt( add ) {

		const t = this.terrain, rnd = rng( 2203 );
		let n = 0;
		for ( const [ u, v, r ] of I.stacks ) {

			// the columns step down from the stack into the sea on its seaward side
			const a = Math.atan2( v, u ) + ( rnd() - 0.5 ) * 0.8;
			for ( let q = 0; q < 2; q ++ ) {

				const off = r * ( 1.15 + q * 0.55 );
				const [ x, z ] = isletWorld( I, u + Math.cos( a + q * 0.9 - 0.45 ) * off, v + Math.sin( a + q * 0.9 - 0.45 ) * off );
				const y = Math.max( t.heightAt( x, z ), - 1.2 );
				const k = 6 + Math.floor( rnd() * 6 );
				basaltCluster( add, x, y, z, r * 0.55, k, 1.2 + r * 0.45 * ( 1 - q * 0.4 ), rnd );
				n += k;

			}

		}

		// along the shore away from the landing (the far side and the flanks)
		for ( let k = 0, c = 0; k < 600 && c < 14; k ++ ) {

			const a = rnd() * Math.PI * 2;
			const u = Math.cos( a ) * I.ru * 1.02, v = Math.sin( a ) * I.rv * 1.02;
			if ( u < - 18 ) continue; // keep the beach and the jetty clear
			const [ x, z ] = isletWorld( I, u, v );
			const h = t.heightAt( x, z );
			if ( h < - 1.5 || h > 3 ) continue;
			const m = 8 + Math.floor( rnd() * 8 );
			basaltCluster( add, x, h, z, 2.2 + rnd() * 1.6, m, 1.4 + rnd() * 2.4, rnd );
			n += m;
			c ++;

		}

		return n;

	}

	update( dt = 0 ) {

		this._t += dt;
		this.distance = cullParts( this.center, this.parts );

	}

}
