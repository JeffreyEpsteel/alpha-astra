import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { WORLD } from '../WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../terrain/IslandShape.js';
import { buildJetty } from './Jetty.js';
import { WOOD, WOODX, STONE, PAINT, rng, frameAt, cottage, palm, lantern, cullParts } from './IslandKit.js';

// West Haven, the trading harbour town on the broad green island west of the main island (terrain/IslandShape.js
// ISLES_5_8 'haven'; the Unreal game's "West haven"): a long timber pier (deck 2.1 m, like the home pier) from the
// plaza at its foot, warehouses and a customs house along the quay, cottages on the terrace above, palms on the
// beach and a stone watchtower with a lamp on the hill (a landmark from the sea). The ship chandler and the fish
// market at the plaza are src/game/ports/HavenPort.js.
//
//   const haven = new WestHaven( { scene, terrain, colliders } );
//   haven.group, haven.lights (add to localLights), haven.update( dt ) (distance culling)
//   haven.tower: { x, z, y, lampY }   haven.houses: number of buildings   haven.plaza: { x, z, y, yaw }
//
// Island frame: u runs inland (west), v across; the town faces the water (yaw HAVEN_YAW). Pads in the terrain
// level every building footprint; nothing here edits the terrain.

const I = ISLETS_BY_ID.haven;
const D = WORLD.haven.dock;
export const HAVEN_YAW = Math.atan2( - I.ax, - I.az ); // facing out of the town toward the pier and the sea
const NEAR = 750; // m: the town's props are drawn within this distance; the tower (a landmark) much farther
const FAR = 2600;

export class WestHaven {

	constructor( { scene, terrain, colliders = null, material = null } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'westHaven' );
		this.group = new Group();
		this.group.name = 'WestHaven';
		scene.add( this.group );
		this.lights = [];
		this.center = new Vector3( I.x, 0, I.z );
		this.houses = 0;

		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		const jetty = buildJetty( { D, terrain, add, colliders, tag: 'haven', seed: 91, lanterns: 2 } );
		this.jetty = jetty;
		this.lights.push( ...jetty.lights );
		this._town( add, colliders );
		this._beach( add, colliders );
		const near = new Mesh( mergePrepared( P ), this.material );
		near.name = 'WestHavenProps';
		near.castShadow = true;
		this.group.add( near );

		// the watchtower: its own mesh so it stays on the horizon when the town is culled
		const T = [];
		this._tower( ( g, o ) => T.push( prepare( g, o ) ), colliders );
		const far = new Mesh( mergePrepared( T ), this.material );
		far.name = 'WestHavenTower';
		far.castShadow = true;
		this.group.add( far );
		this.parts = [ { object: near, dist: NEAR }, { object: far, dist: FAR } ];

	}

	_w( u, v ) {

		return isletWorld( I, u, v );

	}

	_frame( u, v, yaw = HAVEN_YAW, y = null ) {

		const [ x, z ] = this._w( u, v );
		return frameAt( x, y ?? this.terrain.heightAt( x, z ), z, yaw );

	}

	// buildings on the terrain pads (IslandShape haven pads): the quay row and the terrace row
	_town( add, colliders ) {

		const t = this.terrain;
		const B = [
			// u, v, w, d, storeys, wall, roof, plank, tin
			[ - 36, - 24, 7.2, 5.6, 2, 0x8c6d4f, 0x5a5f63, true, true ], // the warehouse
			[ - 36, 24, 6.4, 5.2, 2, 0xe2d6bd, 0x7d2f25, false, false ], // the customs house
			[ - 36, - 42, 5.2, 4.4, 1, 0xc9dccf, 0x2f4b5c, false, false ],
			[ - 36, 42, 5.0, 4.2, 1, 0xe6c79a, 0x8a3b2c, false, false ],
			[ - 22, - 14, 5.6, 4.6, 2, 0xd8c3a5, 0x6b2b22, false, false ],
			[ - 22, 12, 5.4, 4.4, 1, 0x9fc1c9, 0x3d4b55, true, false ],
			[ - 22, 32, 5.0, 4.2, 1, 0xf0e4cc, 0x8a3b2c, false, false ],
			[ - 22, - 34, 5.2, 4.4, 1, 0xd9b38c, 0x4c5a3a, true, true ],
		];
		for ( const [ u, v, w, d, st, wall, roof, plank, tin ] of B ) {

			const F = this._frame( u + d * 0.2, v );
			cottage( add, F, { w, d, storeys: st, wall, roof, plank, tin, door: v > 0 ? - w * 0.15 : w * 0.15, chimney: ! tin } );
			this.houses ++;
			if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + st * 1.4, F.z ), new Vector3( w / 2 + 0.15, st * 1.4, d / 2 + 0.15 ), F.yaw, { tag: 'havenHouse' } );

		}

		// the customs house flag and the warehouse hoist beam
		{

			const F = this._frame( - 36 + 5.6 * 0.2, 24 );
			add( cylinder( 0.05, 0.07, 7, 8 ), { ...PAINT( 0xe9e6dd ), matrix: F.m( 2.6, 3.5, 2.9 ) } );
			add( box( 1.3, 0.85, 0.02 ), { color: 0x2f5f8a, rough: 0.9, pattern: PAT.cloth, matrix: F.m( 3.25, 6.4, 2.9 ) } );
			add( box( 0.6, 0.85, 0.025 ), { color: 0xf2c230, rough: 0.9, pattern: PAT.cloth, matrix: F.m( 3.25, 6.4, 2.9 ) } );
			const G = this._frame( - 36 + 5.6 * 0.2, - 24 );
			add( box( 0.2, 0.2, 1.6 ), { ...WOOD( 0x4a3c30 ), matrix: G.m( 0, 5.6, 3.4 ) } );
			add( cylinder( 0.012, 0.012, 2.6, 4 ), { color: 0xc9b48a, rough: 0.9, matrix: G.m( 0, 4.3, 4.1 ) } );
			add( box( 0.7, 0.5, 0.6 ), { ...WOOD( 0x7b6a52 ), matrix: G.m( 0, 2.85, 4.1 ) } );

		}

		// the plaza: a stone well, a lamp post with a lantern, benches, crates and barrels by the pier foot
		const PZ = this._frame( - 43, 0 );
		this.plaza = { x: PZ.x, z: PZ.z, y: PZ.y, yaw: PZ.yaw };
		const Wl = this._frame( - 41, - 3 );
		add( cylinder( 0.95, 1.05, 0.8, 14 ), { ...STONE( 0x8a8378 ), matrix: Wl.m( 0, 0.4, 0 ) } );
		add( cylinder( 0.8, 0.8, 0.05, 14 ), { color: 0x24343a, rough: 0.1, matrix: Wl.m( 0, 0.7, 0 ) } );
		for ( const s of [ - 1, 1 ] ) add( box( 0.12, 1.6, 0.12 ), { ...WOOD( 0x5a4a3a ), matrix: Wl.m( s * 0.85, 1.4, 0 ) } );
		add( box( 1.9, 0.12, 0.14 ), { ...WOOD( 0x5a4a3a ), matrix: Wl.m( 0, 2.2, 0 ) } );
		add( cylinder( 0.12, 0.12, 0.7, 8 ), { ...WOOD( 0x6e5e47 ), matrix: Wl.m( 0, 2.0, 0, 0, 0, Math.PI / 2 ) } );
		if ( colliders ) colliders.addCylinder( Wl.x, Wl.z, 1.1, Wl.y - 0.3, Wl.y + 0.85, { tag: 'havenWell' } );

		for ( const [ u, v ] of [ [ - 48, - 13 ], [ - 48, 13 ], [ - 37, 5.5 ] ] ) {

			const L = this._frame( u, v );
			add( cylinder( 0.07, 0.1, 3.2, 8 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: L.m( 0, 1.6, 0 ) } );
			add( box( 0.5, 0.05, 0.05 ), { ...PAINT( 0x2b2e31, { metal: 0.5 } ), matrix: L.m( 0, 3.1, 0.22 ) } );
			const [ lx, lz ] = L.world( 0, 0.45 );
			this.lights.push( lantern( add, lx, L.y + 2.9, lz, { intensity: 8, range: 13 } ) );

		}

		for ( const [ u, v, ry ] of [ [ - 38, 9, 0 ], [ - 38, - 15, 0.2 ] ] ) {

			const Bn = this._frame( u, v, HAVEN_YAW + ry );
			add( box( 1.8, 0.07, 0.42 ), { ...WOODX( 0x7d6e5a ), matrix: Bn.m( 0, 0.45, 0 ) } );
			for ( const s of [ - 1, 1 ] ) add( box( 0.1, 0.45, 0.38 ), { ...WOOD( 0x5a4a3a ), matrix: Bn.m( s * 0.75, 0.22, 0 ) } );

		}

		const rnd = rng( 9137 );
		for ( const [ u, v, n ] of [ [ - 49, 17, 4 ], [ - 49, - 17, 3 ], [ - 39, - 19, 3 ], [ - 38, 18, 2 ] ] ) {

			const C = this._frame( u, v );
			for ( let k = 0; k < n; k ++ ) {

				const lx = ( rnd() - 0.5 ) * 2.2, lz = ( rnd() - 0.5 ) * 1.6;
				if ( rnd() < 0.5 ) add( box( 0.7, 0.55, 0.6 ), { ...WOOD( [ 0x7b6a52, 0x6e5e47, 0x8a7a64 ][ k % 3 ] ), matrix: C.m( lx, 0.28, lz, 0, rnd(), 0 ) } );
				else add( cylinder( 0.32, 0.3, 0.85, 12 ), { ...WOOD( 0x5b4a39 ), matrix: C.m( lx, 0.42, lz ) } );

			}

			if ( colliders ) colliders.addCylinder( C.x, C.z, 1.3, C.y - 0.2, C.y + 0.9, { tag: 'havenCargo' } );

		}

	}

	// palms along the beach, rowing boats drawn up on the sand, a net on poles
	_beach( add, colliders ) {

		const t = this.terrain, rnd = rng( 5521 );
		let n = 0;
		for ( let k = 0; k < 400 && n < 16; k ++ ) {

			const u = - 54 + rnd() * 14, v = ( rnd() - 0.5 ) * 130;
			if ( Math.abs( v ) < 16 ) continue; // the plaza and the pier foot
			const [ x, z ] = this._w( u, v );
			const h = t.heightAt( x, z );
			if ( h < 0.8 || h > 4 ) continue;
			palm( add, x, h - 0.1, z, 6 + rnd() * 4, rnd, 0.2 + rnd() * 0.3 );
			if ( colliders ) colliders.addCylinder( x, z, 0.25, h - 0.5, h + 3, { tag: 'havenPalm' } );
			n ++;

		}

		this.palms = n;
		for ( const [ u, v, ry, col ] of [ [ - 52, 24, 0.4, 0x2b5a7a ], [ - 53, 30, - 0.2, 0x8a3b2c ], [ - 51, - 26, 0.1, 0x3d6b4f ] ] ) {

			const Bt = this._frame( u, v, HAVEN_YAW + Math.PI / 2 + ry );
			add( sphere( 1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2 ), { color: col, rough: 0.55, matrix: Bt.m( 0, 0.42, 0, 0, 0, 0, 0.62, 0.42, 1.9 ) } );
			add( box( 1.1, 0.05, 0.22 ), { ...WOOD( 0x6e5f4c ), matrix: Bt.m( 0, 0.4, 0.2 ) } );
			add( box( 0.05, 0.05, 2.4 ), { ...WOOD( 0x8a7a64 ), matrix: Bt.m( 0.75, 0.25, 0.3, 0, 0.3, 0.2 ) } );

		}

		const Nt = this._frame( - 49, - 40 );
		for ( const s of [ - 1.6, 1.6 ] ) add( cylinder( 0.05, 0.06, 2.2, 6 ), { ...WOOD( 0x6e5f4c ), matrix: Nt.m( s, 1.1, 0 ) } );
		add( box( 3.2, 1.3, 0.02 ), { color: 0x6b7d6a, rough: 1, pattern: PAT.cloth, matrix: Nt.m( 0, 1.35, 0 ) } );

	}

	// the stone watchtower on the hill behind the town (pad at island (12, 0)): square, tapering, a lamp on top
	_tower( add, colliders ) {

		const F = this._frame( 12, 0 );
		const H = 11;
		add( box( 4.6, 1.0, 4.6 ), { ...STONE( 0x6f6a61 ), matrix: F.m( 0, 0.2, 0 ) } );
		for ( let k = 0; k < 4; k ++ ) {

			const w = 4.0 - k * 0.3, h = H / 4;
			add( box( w, h + 0.02, w ), { ...STONE( [ 0xb3aa98, 0xa69d8b, 0xb8af9c, 0xaaa190 ][ k ] ), matrix: F.m( 0, 0.7 + h * ( k + 0.5 ), 0 ) } );

		}

		const top = 0.7 + H;
		add( box( 3.6, 0.3, 3.6 ), { ...STONE( 0x7b746a ), matrix: F.m( 0, top + 0.15, 0 ) } );
		for ( const [ sx, sz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) add( box( 0.5, 0.9, 0.5 ), { ...STONE( 0x8a8378 ), matrix: F.m( sx * 1.55, top + 0.75, sz * 1.55 ) } );
		add( box( 1.4, 1.5, 1.4 ), { color: 0xffe6b0, rough: 0.3, matrix: F.m( 0, top + 1.05, 0 ) } );
		add( cylinder( 0.1, 1.4, 1.2, 4 ), { color: 0x7d2f25, rough: 0.8, matrix: F.m( 0, top + 2.4, 0, 0, Math.PI / 4, 0 ) } );
		// the door (toward the town) and slit windows
		add( box( 1.0, 2.0, 0.1 ), { ...WOOD( 0x3d4b55 ), matrix: F.m( 0, 1.7, 2.02 ) } );
		for ( let k = 1; k < 4; k ++ ) add( box( 0.25, 0.8, 0.08 ), { color: 0x14181b, rough: 0.2, matrix: F.m( 0, 0.7 + k * 2.75, 2.0 - k * 0.15 ) } );
		const [ lx, lz ] = F.world( 0, 0 );
		this.tower = { x: F.x, z: F.z, y: F.y, lampY: F.y + top + 1.05 };
		this.lights.push( { position: new Vector3( lx, F.y + top + 1.05, lz ), color: new Color( 1, 0.82, 0.52 ), intensity: 22, range: 45, kind: 'lantern', flicker: 0.05 } );
		if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + top / 2, F.z ), new Vector3( 2.3, top / 2, 2.3 ), F.yaw, { tag: 'havenTower' } );

	}

	update() {

		this.distance = cullParts( this.center, this.parts );

	}

}
