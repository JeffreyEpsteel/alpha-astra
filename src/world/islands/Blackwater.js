import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { buildJetty } from './Jetty.js';
import { WOOD, WOODX, STONE, rng, frameAt, cottage, palm, lantern, cullParts } from './IslandKit.js';
import { strongholdLayout, bw, bwYaw } from './stronghold/Layout.js';
import { TownKit, createGlowMaterial } from '../village/TownKit.js';
import { STRONGHOLD_KINDS, strongholdPlan } from './stronghold/Kinds.js';
import { rngFor } from '../../features/destruction/Kinds.js';
import { ensureBlackwater } from './BlackwaterTerrain.js';
import { openCottage } from '../interiors/Shells.js';
import { blackwaterLandGeometry } from './BlackwaterMesh.js';
import { NearRelease } from '../village/TownKit.js';

// Blackwater, the pirates' island (terrain/IslandShape.js BLACKWATER; wave 12B). The pirate town on the black-sand crescent
// inside the caldera cove - the Rum Hole tavern, the black market, the plunder store, huts, three timber docks - and the
// fort on the north headland above the entrance: a log blockhouse, the watchtower with its alarm bell, the flagstaff with
// the black flag, two gun platforms of three guns and their powder stores, all inside / beside a palisade.
// src/features/pirates/Stronghold.js builds this and runs the place.
//
//   const isle = new Blackwater( { scene, terrain, colliders } );
//   isle.group, isle.lights (LocalLights sources), isle.update( dt ) (distance culling), isle.distance (camera, m)
//   isle.seats [ { id, x, y, z, yaw } ] (the Rum Hole bench, the fire logs: blackwaterSeats()), isle.kit (the town kit:
//   kit.ready resolves once its GLB is merged in); BLACKWATER_SHACKS (wave 18C: the stilt shacks behind the crescent)
//   isle.structures   Map id -> Mesh: the breakable palisade runs, gun platforms and powder stores drawn here while the
//                     destruction feature does not own them (setStructuresDrawn( false ) once it does); setBroken( id, on )
//   isle.setSilenced( batteryId, on )   the guns of a broken battery slump on their carriages
//   isle.setBell( k )                   the bell swings (0..1) while the alarm rings; isle.setFlag( holder ) 'pirates' | 'player'
//   isle.release                        (wave 20A, phones) TownKit NearRelease: the town's props (the kit under them) and the near land
//                                       free their GPU buffers beyond 1.5 km and come back from 1.3 km

const NEAR = 900; // m: the town, the fort and the guns
const NEAR_TERRAIN = 1100; // m: the 2 m land mesh within this, the 8 m one (the whole island and its shelf) always
const FAR = 3200; // m: the watchtower and the flag (a landmark from the lanes)
const TAR = 0x2c2620, SAIL = 0xb8ac94, RUST = 0x5a3d2c;

// a linear [ r, g, b ] (destruction piece colours) as an sRGB hex for GeoKit
const hexOf = ( c ) => c.reduce( ( h, v ) => h * 256 + Math.max( 0, Math.min( 255, Math.round( 255 * Math.pow( Math.max( 0, v ), 1 / 2.2 ) ) ) ), 0 );

export class Blackwater {

	constructor( { scene, terrain, colliders = null, material = null, budget = null } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'blackwater' );
		this.group = new Group();
		this.group.name = 'Blackwater';
		scene.add( this.group );
		// the tile already attached to the terrain, else attach it (a TerrainData); a stand-in terrain gets no land mesh
		const tile = ( terrain && ( terrain.tiles || terrain._outerTiles || [] ).find( ( q ) => q.id === 'blackwater' ) ) || ( terrain && terrain.coastDistance && terrain.heightAt ? ensureBlackwater( terrain ) : null );
		this.land = this.buildLand( tile, budget ?? ( globalThis.__phoneBudget ? 0.5 : 1 ) );
		this.L = strongholdLayout();
		this.center = new Vector3( this.L.center.x, 0, this.L.center.z );
		this.lights = [];
		this.distance = Infinity;
		this.structures = new Map();
		this.guns = new Map();
		this._bell = 0;
		this._t = 0;
		this.rnd = rng( 1717 );

		// the town kit (wave 18C: signs, rum barrels, skull poles, net racks, lanterns; merged under the near mesh once loaded)
		this.kit = new TownKit( { name: 'blackwater', material: this.material, glowMaterial: createGlowMaterial( 'blackwaterGlow' ) } );
		this.kit.enabled = true;
		this.seats = blackwaterSeats( terrain );
		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		this._town( add, colliders );
		this._docks( add, colliders );
		this._fort( add, colliders );
		const near = new Mesh( mergePrepared( P ), this.material );
		near.name = 'BlackwaterProps';
		near.castShadow = true;
		this.group.add( near );
		this.kit.ready = this.kit.attach( near );

		// the landmark: the watchtower (its bell its own mesh, it swings) and the flag
		const T = [];
		this._tower( ( g, o ) => T.push( prepare( g, o ) ), colliders );
		const far = new Mesh( mergePrepared( T ), this.material );
		far.name = 'BlackwaterTower';
		far.castShadow = true;
		this.group.add( far );
		this.bell = this._mesh( ( add2 ) => add2( cylinder( 0.22, 0.42, 0.6, 10 ), { color: 0x9a7a3a, rough: 0.35, metal: 0.8 } ), 'BlackwaterBell' );
		this.bell.position.set( this.L.tower.x, this.L.fort.y + this.L.tower.h - 0.2, this.L.tower.z );
		this.flag = this._mesh( ( add2 ) => add2( box( 1.9, 1.2, 0.04 ), { color: 0x141414, rough: 0.9 } ), 'BlackwaterFlag' );
		this.flag.position.set( this.L.flag.x + 1.0, this.L.fort.y + 8.6, this.L.flag.z );

		for ( const b of this.L.batteries ) this.guns.set( b.id, this._battery( b ) );
		this._structures();

		this.parts = [ { object: near, dist: NEAR }, { object: far, dist: FAR }, { object: this.bell, dist: NEAR }, { object: this.flag, dist: FAR }, { object: this.land.near, dist: NEAR_TERRAIN } ];
		for ( const m of this.guns.values() ) this.parts.push( { object: m, dist: NEAR } );
		this._structParts = [];
		for ( const m of this.structures.values() ) this._structParts.push( { object: m, dist: NEAR } );
		this._drawStructures = true;
		this.release = new NearRelease( { roots: [ near, this.land.near ] } );

	}

	// wave 14D: the island lies on its own terrain tile (BlackwaterTerrain), beyond the heightmap's chunks, so it draws its
	// own ground as Tidemark does: the land and shallows at 2 m (3 m on phones) near, and an 8 m mesh of the island and its
	// shelf that always draws (dropped 1 m under the near mesh while that shows, so they never fight)
	buildLand( tile, phone = 1 ) {

		if ( ! tile ) return { near: new Group(), far: new Group(), tile: null };
		const near = new Mesh( blackwaterLandGeometry( tile, { step: phone < 1 ? 3 : 2, floor: phone < 1 ? - 3 : - 4 } ), this.material );
		near.name = 'BlackwaterTerrainNear';
		near.receiveShadow = true;
		near.castShadow = true;
		const far = new Mesh( blackwaterLandGeometry( tile, { step: 8, floor: - 40 } ), this.material );
		far.name = 'BlackwaterTerrainFar';
		far.receiveShadow = true;
		this.group.add( near, far );
		return { near, far, tile };

	}

	_mesh( build, name ) {

		const P = [];
		build( ( g, o ) => P.push( prepare( g, o ) ) );
		const m = new Mesh( mergePrepared( P ), this.material );
		m.name = name;
		m.castShadow = true;
		this.group.add( m );
		return m;

	}

	_y( x, z ) {

		return this.terrain.heightAt( x, z );

	}

	// ---- the town on the crescent

	_town( add, colliders ) {

		const rnd = this.rnd;
		const kit = this.kit;
		for ( const b of this.L.town ) {

			const F = frameAt( b.x, this._y( b.x, b.z ), b.z, b.yaw );
			if ( b.kind === 'tavern' ) {

				// wave 19E: the Rum Hole's door opens into its interior (src/world/interiors): hollow walls, a doorway, the shell registered
				openCottage( add, F, { w: b.w, d: b.d, storeys: 2, wall: 0x6a5642, plank: true, roof: TAR, trim: 0x3a2a22, tin: true, id: 'blackwater.rumhole', tag: 'bwTavern' }, colliders );
				roofPatches( add, F, b.w, b.d, 5.2, 0.55, rnd );
				// the name board on the wall (the kit), else the old board on two chains with a painted bottle
				kit.place( 'sign_rumhole', F.m( 0, 3.95, b.d / 2 + 0.02, 0, 0, 0, 0.9 ) );
				if ( ! kit.enabled ) {

					add( box( 2.4, 0.7, 0.08 ), { ...WOOD( 0x3b2a1e ), matrix: F.m( 0, 3.3, b.d / 2 + 0.6 ) } );
					add( box( 0.3, 0.55, 0.1 ), { color: 0xa8692c, rough: 0.5, matrix: F.m( - 0.6, 3.3, b.d / 2 + 0.66 ) } );

				}

				// barrels and a bench out front (townlife's obstacles and seats mirror these), rum barrels on a rack by the side
				for ( const s of [ - 1, 1 ] ) add( cylinder( 0.36, 0.36, 0.85, 10 ), { ...WOOD( 0x6b4a2c ), matrix: F.m( s * ( b.w / 2 - 0.3 ), 0.72, b.d / 2 + 0.9 ) } );
				add( box( 2.2, 0.1, 0.45 ), { ...WOOD( 0x5a4632 ), matrix: F.m( 1.6, 0.75, b.d / 2 + 1.4 ) } );
				for ( const s of [ - 1, 1 ] ) add( box( 0.1, 0.7, 0.4 ), { ...WOOD( 0x4a3a2a ), matrix: F.m( 1.6 + s * 0.95, 0.38, b.d / 2 + 1.4 ) } );
				kit.place( 'rum_barrels', F.m( b.w / 2 + 1.3, 0, 0.6, 0, Math.PI / 2, 0 ) );
				// a string of lanterns across the front under the eaves
				lanternString( add, kit, F, - b.w / 2 + 0.2, b.w / 2 - 0.2, 2.75, b.d / 2 + 0.25, 7 );
				const [ lx, lz ] = F.world( 0, b.d / 2 + 0.7 );
				this.lights.push( lantern( add, lx, F.y + 2.6, lz, { intensity: 8 } ) );
				// (its colliders are the open cottage's hollow walls and floor)

			} else if ( b.kind === 'market' ) {

				cottage( add, F, { w: b.w, d: b.d, wall: 0x4f4538, plank: true, roof: RUST, tin: true, chimney: false } );
				roofPatches( add, F, b.w, b.d, 2.6, 0.55, rnd );
				// the fence's awning (a stained sail, ragged edge) and his table of goods
				add( box( b.w + 0.4, 0.06, 2.4 ), { color: 0x6b2a24, rough: 0.8, pattern: PAT.cloth, matrix: F.m( 0, 2.45, b.d / 2 + 1.1, - 0.22, 0, 0 ) } );
				for ( let k = 0; k < 7; k ++ ) add( box( 0.5, 0.05, 0.3 + rnd() * 0.3 ), { color: 0x5e2420, rough: 0.9, pattern: PAT.cloth, matrix: F.m( - b.w / 2 + 0.4 + k * ( b.w / 6 ), 2.15, b.d / 2 + 2.35, - 1.2, 0, 0 ) } );
				for ( const s of [ - 1, 1 ] ) add( box( 0.12, 2.3, 0.12 ), { ...WOOD( 0x4a3a2a ), matrix: F.m( s * ( b.w / 2 + 0.1 ), 1.15, b.d / 2 + 2.2 ) } );
				add( box( 2.6, 0.08, 0.9 ), { ...WOOD( 0x5a4632 ), matrix: F.m( 0, 0.9, b.d / 2 + 1.3 ) } );
				for ( let k = 0; k < 4; k ++ ) add( box( 0.42, 0.32, 0.36 ), { ...WOODX( 0x7a5a3a ), matrix: F.m( - 0.9 + k * 0.6, 1.1, b.d / 2 + 1.3, 0, rnd() * 0.4, 0 ) } );
				add( cylinder( 0.3, 0.3, 0.7, 10 ), { color: 0x2b2b2b, rough: 0.6, matrix: F.m( b.w / 2 + 0.6, 0.35, b.d / 2 + 0.6 ) } );
				kit.place( 'sign_blackmarket', F.m( 0, 2.55, b.d / 2 + 2.32, 0, 0, 0, 0.72 ) );
				kit.place( 'skull_pole', F.m( - b.w / 2 - 1.2, 0, b.d / 2 + 0.4, 0, 0.4, 0 ) );
				const [ lx, lz ] = F.world( 0, b.d / 2 + 2.0 );
				this.lights.push( lantern( add, lx, F.y + 2.2, lz, { intensity: 6, range: 9 } ) );
				if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + 1.6, F.z ), new Vector3( b.w / 2 + 0.15, 1.6, b.d / 2 + 0.15 ), b.yaw, { tag: 'bwMarket' } );

			} else if ( b.kind === 'store' ) {

				cottage( add, F, { w: b.w, d: b.d, wall: 0x584a3c, plank: true, roof: RUST, tin: true, chimney: true } );
				roofPatches( add, F, b.w, b.d, 2.6, 0.55, rnd );
				for ( let k = 0; k < 5; k ++ ) add( box( 0.6, 0.6, 0.6 ), { ...WOODX( 0x7a5a3a ), matrix: F.m( - 2 + k * 0.9, 0.6 + ( k % 2 ) * 0.6, b.d / 2 + 0.8, 0, rnd() * 0.5, 0 ) } );
				kit.place( 'lantern_wall', F.m( b.w / 2 - 0.5, 2.5, b.d / 2 + 0.02 ) );
				if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + 1.6, F.z ), new Vector3( b.w / 2 + 0.15, 1.6, b.d / 2 + 0.15 ), b.yaw, { tag: 'bwHut' } );

			} else {

				shack( add, kit, F, b.w, b.d, rnd, ( lx, lz ) => { const [ x, z ] = F.world( lx, lz ); return this._y( x, z ); } );
				if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + 1.6, F.z ), new Vector3( b.w / 2 + 0.15, 1.6, b.d / 2 + 0.15 ), b.yaw, { tag: 'bwHut' } );

			}

		}

		// wave 18C: more shacks on stilts behind the crescent's line (the den grows up the slope), net racks by the huts,
		// skull poles at the town's ends
		for ( const s of BLACKWATER_SHACKS ) {

			const F = frameAt( s.x, this._y( s.x, s.z ), s.z, s.yaw );
			shack( add, kit, F, s.w, s.d, rnd, ( lx, lz ) => { const [ x, z ] = F.world( lx, lz ); return this._y( x, z ); } );
			if ( colliders ) colliders.addBox( new Vector3( F.x, F.y + 1.8, F.z ), new Vector3( s.w / 2 + 0.15, 1.8, s.d / 2 + 0.15 ), s.yaw, { tag: 'bwShack' } );

		}

		for ( const id of [ 'hut1', 'hut2' ] ) {

			const b = this.L.town.find( ( q ) => q.id === id );
			const F = frameAt( b.x, this._y( b.x, b.z ), b.z, b.yaw );
			kit.place( 'netrack', F.m( ( id === 'hut1' ? 1 : - 1 ) * ( b.w / 2 + 2.6 ), 0, - 0.4, 0, Math.PI / 2, 0 ) );

		}

		for ( const id of [ 'hut3', 'hut4' ] ) {

			const b = this.L.town.find( ( q ) => q.id === id );
			const F = frameAt( b.x, this._y( b.x, b.z ), b.z, b.yaw );
			kit.place( 'skull_pole', F.m( ( id === 'hut3' ? 1 : - 1 ) * ( b.w / 2 + 1.6 ), 0, b.d / 2 + 1.0 ) );

		}

		// palms along the back of the crescent, nets drying on poles, a fire pit
		for ( let k = 0; k < 9; k ++ ) {

			const a = ( k / 8 - 0.5 ) * 2.0, q = bw( - 105 * 1.42 * Math.cos( a ), 85 * 1.42 * Math.sin( a ) );
			const h = this._y( q.x, q.z );
			if ( h < 0.6 || h > 9 ) continue;
			palm( add, q.x, h - 0.2, q.z, 6 + rnd() * 3, rnd, 0.3 );
			if ( colliders ) colliders.addCylinder( q.x, q.z, 0.25, h - 0.5, h + 3, { tag: 'bwPalm' } );

		}

		const pit = bw( - 112, 18 ), py = this._y( pit.x, pit.z );
		for ( let k = 0; k < 8; k ++ ) {

			const a = k / 8 * Math.PI * 2;
			add( sphere( 0.22, 6, 4 ), { ...STONE( 0x2e2c2a ), matrix: mat4( pit.x + Math.cos( a ) * 0.8, py + 0.08, pit.z + Math.sin( a ) * 0.8 ) } );

		}

		add( box( 1.0, 0.12, 0.2 ), { ...WOOD( 0x2a2016 ), matrix: mat4( pit.x, py + 0.15, pit.z, 0, 0.6, 0 ) } );
		add( box( 0.9, 0.12, 0.18 ), { ...WOOD( 0x2a2016 ), matrix: mat4( pit.x, py + 0.2, pit.z, 0, - 0.5, 0.15 ) } );
		// the embers glow at night, and the fire lights the faces round it; logs to sit on (blackwaterSeats)
		kit.glow( sphere( 0.42, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0x2a1a10, lit: 0.9, matrix: mat4( pit.x, py + 0.05, pit.z, 0, 0, 0, 1, 0.5, 1 ) } );
		this.lights.push( { position: new Vector3( pit.x, py + 0.8, pit.z ), color: new Color( 1.0, 0.5, 0.2 ), intensity: 10, range: 11, kind: 'lantern', flicker: 0.35 } );
		for ( const L of FIRE_LOGS ) {

			const x = pit.x + Math.cos( L.a ) * L.r, z = pit.z + Math.sin( L.a ) * L.r;
			add( cylinder( 0.2, 0.22, 1.5, 8 ), { ...WOOD( 0x5a4430 ), matrix: mat4( x, this._y( x, z ) + 0.2, z, 0, Math.PI / 2 - L.a, Math.PI / 2, 1, 1, 1, 'YXZ' ) } );

		}

	}

	_docks( add, colliders ) {

		for ( const d of this.L.docks ) {

			const foot = this._y( d.start.x, d.start.z );
			const D = { start: d.start, end: d.end, heading: d.heading, width: d.width, deckHeight: Math.max( 0.9, foot + 0.3 ) };
			const j = buildJetty( { D, terrain: this.terrain, add, colliders, tag: 'blackwater' + d.id, seed: 131 + d.id * 7, crates: d.id === 0, lanterns: d.id === 0 ? 1 : 0 } );
			this.lights.push( ...j.lights.slice( 0, 1 ) );

		}

	}

	// ---- the fort

	_fort( add, colliders ) {

		const L = this.L, y = L.fort.y;
		// the blockhouse: squat log walls, slits, a tar roof
		const B = frameAt( L.blockhouse.x, y, L.blockhouse.z, L.blockhouse.yaw );
		cottage( add, B, { w: 7, d: 5, wallH: 2.8, wall: 0x4e3e2e, plank: true, roof: TAR, trim: 0x2a1e16, chimney: false, slope: 0.4 } );
		if ( colliders ) colliders.addBox( new Vector3( B.x, y + 1.6, B.z ), new Vector3( 3.65, 1.6, 2.65 ), B.yaw, { tag: 'bwBlockhouse' } );
		// the flagstaff
		add( cylinder( 0.07, 0.11, 9.5, 8 ), { ...WOOD( 0x3a2e22 ), matrix: mat4( L.flag.x, y + 4.75, L.flag.z ) } );
		add( sphere( 0.14, 8, 6 ), { color: 0x9a7a3a, metal: 0.8, rough: 0.35, matrix: mat4( L.flag.x, y + 9.55, L.flag.z ) } );
		// braziers at the gate
		const G = L.gate;
		for ( const s of [ - 1, 1 ] ) {

			const a = bwYaw( 1, 0 ) + s * 0.4;
			const x = G.x + Math.sin( a ) * 2.4, z = G.z + Math.cos( a ) * 2.4;
			add( cylinder( 0.32, 0.18, 0.5, 8 ), { color: 0x2a2a2a, metal: 0.6, rough: 0.5, matrix: mat4( x, y + 1.25, z ) } );
			add( cylinder( 0.05, 0.05, 1.0, 6 ), { color: 0x2a2a2a, metal: 0.6, rough: 0.5, matrix: mat4( x, y + 0.5, z ) } );
			add( sphere( 0.24, 6, 4 ), { color: 0xffa040, rough: 1, matrix: mat4( x, y + 1.55, z ) } );

		}

		this.lights.push( { position: new Vector3( G.x, y + 2.2, G.z ), color: new Color( 1.0, 0.6, 0.3 ), intensity: 9, range: 13, kind: 'lantern', flicker: 0.18 } );
		// shot piles beside each battery
		for ( const b of L.batteries ) {

			const F = frameAt( b.x, b.y, b.z, b.yaw );
			for ( let k = 0; k < 6; k ++ ) add( sphere( 0.14, 6, 4 ), { color: 0x1c1c1f, metal: 0.6, rough: 0.45, matrix: F.m( - 3.9 + ( k % 3 ) * 0.28, 0.14 + Math.floor( k / 3 ) * 0.24, - 3.2 + ( k % 2 ) * 0.1 ) } );

		}

	}

	_tower( add, colliders ) {

		const T = this.L.tower, y = this.L.fort.y, h = T.h;
		for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) add( box( 0.28, h, 0.28 ), { ...WOOD( 0x3e3022 ), matrix: mat4( T.x + sx * 1.3, y + h / 2, T.z + sz * 1.3, sz * 0.04, 0, - sx * 0.04 ) } );
		for ( const k of [ 0.3, 0.62 ] ) for ( const r of [ 0, Math.PI / 2 ] ) add( box( 2.9, 0.14, 0.14 ), { ...WOOD( 0x4a3a2a ), matrix: mat4( T.x, y + h * k, T.z, 0, r, 0 ) } );
		add( box( 3.4, 0.16, 3.4 ), { ...WOODX( 0x5a4632 ), matrix: mat4( T.x, y + h - 2.2, T.z ) } );
		for ( const r of [ 0, Math.PI / 2, Math.PI, - Math.PI / 2 ] ) add( box( 3.4, 0.9, 0.08 ), { ...WOOD( 0x4a3a2a ), matrix: mat4( T.x + Math.sin( r ) * 1.66, y + h - 1.7, T.z + Math.cos( r ) * 1.66, 0, r, 0 ) } );
		// the roof and the bell yoke
		add( cylinder( 0.05, 2.6, 1.3, 4 ), { color: TAR, rough: 0.8, matrix: mat4( T.x, y + h + 0.65, T.z, 0, Math.PI / 4, 0 ) } );
		add( box( 1.2, 0.12, 0.12 ), { ...WOOD( 0x2e241a ), matrix: mat4( T.x, y + h + 0.05, T.z ) } );
		// a ladder
		for ( let k = 0; k < 10; k ++ ) add( box( 0.6, 0.05, 0.05 ), { ...WOOD( 0x5a4632 ), matrix: mat4( T.x, y + 0.5 + k * ( h - 2.6 ) / 10, T.z + 1.45 ) } );
		if ( colliders ) colliders.addBox( new Vector3( T.x, y + h / 2, T.z ), new Vector3( 1.45, h / 2, 1.45 ), 0, { tag: 'bwTower' } );
		// the flag's halyard and a pennant on the tower
		add( box( 0.9, 0.35, 0.03 ), { color: 0x6b1e1a, rough: 0.9, matrix: mat4( T.x + 0.5, y + h + 1.5, T.z ) } );
		add( cylinder( 0.03, 0.03, 1.6, 5 ), { ...WOOD( 0x3a2e22 ), matrix: mat4( T.x, y + h + 1.1, T.z ) } );

	}

	// three guns on carriages across the platform's front (their own mesh: a silenced battery's guns slump)
	_battery( b ) {

		const m = this._mesh( ( add ) => {

			for ( const g of b.guns ) {

				const lx = ( g.x - b.x ) * Math.cos( b.yaw ) - ( g.z - b.z ) * Math.sin( b.yaw );
				const F = frameAt( 0, 0, 0, 0 );
				add( box( 0.9, 0.42, 1.5 ), { ...WOOD( 0x4a3424 ), matrix: F.m( lx, 1.58, 1.0 ) } );
				for ( const s of [ - 1, 1 ] ) for ( const z of [ 0.45, 1.55 ] ) add( cylinder( 0.22, 0.22, 0.1, 10 ), { ...WOOD( 0x3a2a1c ), matrix: F.m( lx + s * 0.5, 1.45, z, 0, 0, Math.PI / 2 ) } );
				add( cylinder( 0.13, 0.19, 2.1, 10 ), { color: 0x232526, metal: 0.7, rough: 0.4, matrix: F.m( lx, 1.92, 1.35, Math.PI / 2 - 0.06, 0, 0 ) } );
				add( sphere( 0.2, 8, 6 ), { color: 0x232526, metal: 0.7, rough: 0.4, matrix: F.m( lx, 1.92, 0.3 ) } );

			}

		}, 'BlackwaterGuns.' + b.id );
		m.position.set( b.x, b.y, b.z );
		m.rotation.set( 0, b.yaw, 0 );
		return m;

	}

	// the breakable structures as plain meshes (one each) while the destruction feature does not draw them
	_structures() {

		for ( const p of strongholdPlan( this.terrain ) ) {

			const K = STRONGHOLD_KINDS[ p.kind ];
			const pieces = K.build( rngFor( p.site + p.kind + p.id ), p.opts || {} );
			const m = this._mesh( ( add ) => {

				for ( const q of pieces ) {

					const rx = q.quat && q.quat.x ? 2 * Math.asin( Math.max( - 1, Math.min( 1, q.quat.x ) ) ) : 0;
					const g = q.type === 'barrel' ? cylinder( q.size[ 0 ] / 2, q.size[ 0 ] / 2, q.size[ 1 ], 10 ) : box( q.size[ 0 ], q.size[ 1 ], q.size[ 2 ] );
					add( g, { color: hexOf( q.color ), rough: 0.9, pattern: q.type === 'barrel' ? 0 : PAT.wood, matrix: mat4( q.pos.x, q.pos.y, q.pos.z, rx, 0, 0 ) } );

				}

			}, 'BlackwaterStructure.' + p.id );
			m.position.set( p.x, p.y, p.z );
			m.rotation.set( 0, p.yaw, 0 );
			this.structures.set( p.id, m );

		}

	}

	setStructuresDrawn( on ) {

		this._drawStructures = !! on;
		for ( const m of this.structures.values() ) m.visible = on && ! m.userData.broken && this.distance < NEAR;

	}

	setBroken( id, on ) {

		const m = this.structures.get( id );
		if ( ! m ) return;
		m.userData.broken = !! on;
		m.visible = this._drawStructures && ! on && this.distance < NEAR;

	}

	setSilenced( id, on ) {

		const m = this.guns.get( id );
		if ( ! m ) return;
		// the guns tip off their broken deck
		m.rotation.set( on ? 0.18 : 0, this.L.batteries.find( ( b ) => b.id === id ).yaw, on ? 0.12 : 0 );
		m.position.y = this.L.batteries.find( ( b ) => b.id === id ).y - ( on ? 0.9 : 0 );

	}

	setBell( k ) {

		this._bell = Math.max( 0, Math.min( 1, k ) );

	}

	setFlag( holder ) {

		this._holder = holder;
		if ( holder === 'player' ) this.flag.visible = false;

	}

	update( dt ) {

		this._t += dt;
		this.distance = cullParts( this.center, this.parts );
		this.release.update( this.distance ); // (after cullParts: a released town's near meshes stay hidden)
		const drop = this.land.near.visible ? - 1 : 0;
		if ( this.land.far.position.y !== drop ) {

			this.land.far.position.y = drop;
			if ( this.land.far.updateMatrix ) this.land.far.updateMatrix();

		}

		if ( this._drawStructures ) for ( const p of this._structParts ) p.object.visible = ! p.object.userData.broken && ( ! Number.isFinite( this.distance ) || this.distance < p.dist );
		if ( this.bell.visible ) this.bell.rotation.z = this._bell * 0.6 * Math.sin( this._t * 7 );
		if ( this._holder === 'player' ) this.flag.visible = false;
		if ( this.flag.visible ) this.flag.rotation.y = 0.15 * Math.sin( this._t * 1.7 );

	}

	dispose() {

		if ( this.group.parent ) this.group.parent.remove( this.group );
		for ( const c of this.group.children ) if ( c.geometry && c.geometry.dispose ) c.geometry.dispose();
		if ( this.material && this.material.dispose ) this.material.dispose();

	}

}

// ---- wave 18C: the den's looks (plain data and GeoKit helpers)

// the extra shacks on stilts behind the crescent's line, between the old buildings (island u, v; they face the cove like
// the town). Colliders tagged bwShack; townlife can read this list for its walkers' obstacles.
export const BLACKWATER_SHACKS = [ [ - 130.3, - 20 ], [ - 130.3, 20 ], [ - 113.8, - 54 ], [ - 113.8, 54 ], [ - 90.6, - 78 ], [ - 90.6, 78 ] ].map( ( [ u, v ], i ) => {

	const q = bw( u, v );
	return { id: 'shack' + ( i + 1 ), u, v, x: q.x, z: q.z, yaw: bwYaw( - 10 - u, - v ), w: 3.6, d: 3.2 };

} );

// logs round the fire pit (a ring of 2 m round bw( -112, 18 )): people sit on them
const FIRE_LOGS = [ { a: 0.4, r: 2.0 }, { a: 2.5, r: 2.0 }, { a: 4.4, r: 2.0 } ];

// where people sit: the Rum Hole's bench (two places; the bench at 0.75 m) and the logs round the fire (two each)
export function blackwaterSeats( terrain ) {

	const L = strongholdLayout();
	const out = [];
	const y = ( x, z ) => ( terrain && terrain.heightAt ? terrain.heightAt( x, z ) : 0 );
	const rum = L.town.find( ( b ) => b.kind === 'tavern' );
	const F = frameAt( rum.x, y( rum.x, rum.z ), rum.z, rum.yaw );
	for ( const [ k, lx ] of [ [ 'a', 1.2 ], [ 'b', 2.0 ] ] ) {

		const [ x, z ] = F.world( lx, rum.d / 2 + 1.4 );
		out.push( { id: 'blackwater.bench.' + k, x, y: F.y + 0.8, z, yaw: rum.yaw } );

	}

	const pit = bw( - 112, 18 );
	FIRE_LOGS.forEach( ( L2, i ) => {

		for ( const [ k, off ] of [ [ 'a', - 0.4 ], [ 'b', 0.4 ] ] ) {

			// along the log (its tangent), facing the fire
			const tx = - Math.sin( L2.a ), tz = Math.cos( L2.a );
			const x = pit.x + Math.cos( L2.a ) * L2.r + tx * off, z = pit.z + Math.sin( L2.a ) * L2.r + tz * off;
			out.push( { id: `blackwater.log.${ i }.${ k }`, x, y: y( x, z ) + 0.42, z, yaw: Math.atan2( pit.x - x, pit.z - z ) } );

		}

	} );
	return out;

}

// tin patches over a cottage roof (IslandKit.cottage's pitch: slope, half = d / 2 + 0.35): odd sheets of other colours
function roofPatches( add, F, w, d, H, slope, rnd ) {

	const half = d / 2 + 0.35, rise = half * Math.tan( slope ), top = 0.3 + H;
	for ( const s of [ - 1, 1 ] ) for ( let k = 0; k < 3; k ++ ) {

		const t = 0.25 + rnd() * 0.55, x = ( rnd() - 0.5 ) * ( w - 1.2 );
		const c = [ 0x7a4a30, 0x8c9296, 0x5a3d2c, 0x3a3a38 ][ Math.floor( rnd() * 4 ) ];
		add( box( 0.9 + rnd() * 0.5, 0.03, 1.0 + rnd() * 0.4 ), { color: c, rough: 0.7, metal: 0.4, pattern: PAT.rusty, matrix: F.m( x, top + rise * ( 1 - t ) + 0.13, s * half * t, s * slope, ( rnd() - 0.5 ) * 0.2, 0 ) } );

	}

}

// a sagging line of lanterns between two points of the front (x0 .. x1 at height y, z out from the wall): the line in
// the prop mesh, the lantern glass in the kit's glow mesh
function lanternString( add, kit, F, x0, x1, y, z, n ) {

	const sag = 0.35, pts = [];
	for ( let k = 0; k <= 12; k ++ ) {

		const t = k / 12;
		pts.push( [ x0 + ( x1 - x0 ) * t, y - sag * 4 * t * ( 1 - t ) ] );

	}

	for ( let k = 0; k < 12; k ++ ) {

		const [ ax, ay ] = pts[ k ], [ bx, by ] = pts[ k + 1 ];
		add( box( Math.hypot( bx - ax, by - ay ) + 0.01, 0.015, 0.015 ), { color: 0x2a2620, rough: 0.9, matrix: F.m( ( ax + bx ) / 2, ( ay + by ) / 2, z, 0, 0, Math.atan2( by - ay, bx - ax ) ) } );

	}

	for ( let k = 1; k <= n; k ++ ) {

		const t = k / ( n + 1 ), x = x0 + ( x1 - x0 ) * t, yy = y - sag * 4 * t * ( 1 - t ) - 0.14;
		kit.glow( cylinder( 0.07, 0.07, 0.16, 6 ), { color: [ 0x8a5a2a, 0x6a2a20, 0x8a7a3a ][ k % 3 ], lit: 0.8, matrix: F.m( x, yy, z ) } );
		add( cylinder( 0.08, 0.02, 0.05, 6 ), { color: 0x1c1a18, rough: 0.6, metal: 0.5, matrix: F.m( x, yy + 0.1, z ) } );

	}

}

// a ramshackle plank shack on stilts: uneven ground is taken by the stilts (ground( lx, lz ) the height under a local point),
// a front deck, walls of odd vertical planks (a door gap, a shuttered window), a patched tin roof, a stovepipe, a ragged
// sailcloth lean-to and a lantern by the door (glow). ~1.2k triangles.
function shack( add, kit, F, w, d, rnd, ground ) {

	const corners = [ [ - w / 2, - d / 2 ], [ w / 2, - d / 2 ], [ w / 2, d / 2 + 1.1 ], [ - w / 2, d / 2 + 1.1 ], [ 0, 0 ] ];
	const gs = corners.map( ( [ lx, lz ] ) => ground( lx, lz ) - F.y );
	const floor = Math.max( ...gs ) + 0.45;
	const tones = [ 0x5e4c3a, 0x4e4032, 0x6a5641, 0x584a3a, 0x3e342a, 0x6e5e4a ];
	// stilts and the floor (the deck runs 1.1 m out in front)
	for ( const [ lx, lz ] of [ [ - w / 2 + 0.15, - d / 2 + 0.15 ], [ w / 2 - 0.15, - d / 2 + 0.15 ], [ w / 2 - 0.15, d / 2 - 0.1 ], [ - w / 2 + 0.15, d / 2 - 0.1 ], [ w / 2 - 0.2, d / 2 + 1.0 ], [ - w / 2 + 0.2, d / 2 + 1.0 ] ] ) {

		const g = ground( lx, lz ) - F.y - 0.3, h = floor - g;
		add( box( 0.16, h, 0.16 ), { ...WOOD( 0x3a3026 ), matrix: F.m( lx, g + h / 2, lz, ( rnd() - 0.5 ) * 0.06, 0, ( rnd() - 0.5 ) * 0.06 ) } );

	}

	add( box( w + 0.2, 0.12, d + 0.2 ), { ...WOODX( 0x4e4032 ), matrix: F.m( 0, floor - 0.06, 0 ) } );
	for ( let k = 0; k < 5; k ++ ) add( box( 0.2 + rnd() * 0.04, 0.06, w - 0.1 ), { ...WOOD( tones[ k % 6 ] ), matrix: F.m( - w / 2 + 0.3 + k * ( w - 0.6 ) / 4, floor, d / 2 + 0.55, 0, Math.PI / 2, 0 ) } );
	const H = 2.3;
	// walls: odd planks; the front leaves a door (x -0.4..0.4) and a window (x 0.8..1.4, 1.0..1.7 up)
	const wall = ( L, place, front ) => {

		const n = Math.ceil( L / 0.32 );
		for ( let k = 0; k < n; k ++ ) {

			const x = - L / 2 + ( k + 0.5 ) * L / n, h = H + ( rnd() - 0.5 ) * 0.25;
			if ( front && Math.abs( x ) < 0.45 ) {

				add( box( L / n - 0.02, 0.4, 0.05 ), { ...WOOD( tones[ k % 6 ] ), matrix: place( x, floor + H - 0.2 ) } );
				continue;

			}

			if ( front && x > 0.75 && x < 1.45 ) {

				add( box( L / n - 0.02, 0.95, 0.05 ), { ...WOOD( tones[ ( k + 2 ) % 6 ] ), matrix: place( x, floor + 0.47 ) } );
				add( box( L / n - 0.02, H - 1.75, 0.05 ), { ...WOOD( tones[ ( k + 1 ) % 6 ] ), matrix: place( x, floor + 1.75 + ( H - 1.75 ) / 2 ) } );
				continue;

			}

			add( box( L / n - 0.02, h, 0.05 ), { ...WOOD( tones[ Math.floor( rnd() * 6 ) ] ), matrix: place( x, floor + h / 2 ) } );

		}

	};
	wall( w, ( x, y ) => F.m( x, y, d / 2 ), true );
	wall( w, ( x, y ) => F.m( x, y, - d / 2 ), false );
	wall( d, ( x, y ) => F.m( w / 2, y, x, 0, Math.PI / 2, 0 ), false );
	wall( d, ( x, y ) => F.m( - w / 2, y, x, 0, Math.PI / 2, 0 ), false );
	// the dark doorway and window behind the gaps, a shutter hanging off one hinge
	add( box( 0.9, 1.9, 0.02 ), { color: 0x14110e, rough: 1, matrix: F.m( 0, floor + 0.95, d / 2 - 0.06 ) } );
	add( box( 0.7, 0.8, 0.02 ), { color: 0x14110e, rough: 1, matrix: F.m( 1.1, floor + 1.35, d / 2 - 0.06 ) } );
	add( box( 0.34, 0.75, 0.04 ), { ...WOOD( 0x6a5641 ), matrix: F.m( 1.65, floor + 1.25, d / 2 + 0.08, 0, - 0.5, 0.2 ) } );
	// the roof: a single pitch falling to the back, sheets of tin each a little askew
	const rise = 0.7, run = d + 0.9, ang = Math.atan2( rise, run );
	for ( let k = 0; k < 4; k ++ ) {

		const x = - w / 2 - 0.15 + ( k + 0.5 ) * ( w + 0.3 ) / 4;
		const c = [ 0x7a4a30, 0x8c9296, 0x5a3d2c, 0x6b6f72, 0x3a3a38 ][ Math.floor( rnd() * 5 ) ];
		add( box( ( w + 0.3 ) / 4 + 0.12, 0.03, Math.hypot( rise, run ) + 0.1 ), { color: c, rough: 0.65, metal: 0.45, pattern: PAT.rusty, matrix: F.m( x, floor + H + 0.1 + rise / 2 + ( rnd() - 0.5 ) * 0.04, 0.15, - ang, ( rnd() - 0.5 ) * 0.05, ( rnd() - 0.5 ) * 0.05 ) } );

	}

	// a rock or two weighing the tin down, the stovepipe
	add( sphere( 0.16, 6, 4 ), { ...STONE( 0x2e2c2a ), matrix: F.m( - w * 0.25, floor + H + 0.5, 0.2 ) } );
	add( cylinder( 0.08, 0.08, 1.2, 8 ), { color: 0x2b2522, rough: 0.6, metal: 0.5, pattern: PAT.rusty, matrix: F.m( w / 2 - 0.5, floor + H + 0.75, - d / 4 ) } );
	add( cylinder( 0.16, 0.1, 0.12, 8 ), { color: 0x2b2522, rough: 0.6, metal: 0.5, matrix: F.m( w / 2 - 0.5, floor + H + 1.4, - d / 4 ) } );
	// the lean-to: a stained sail on two poles over the deck
	for ( const s of [ - 1, 1 ] ) add( box( 0.08, 2.0, 0.08 ), { ...WOOD( 0x3e342a ), matrix: F.m( s * ( w / 2 - 0.2 ), floor + 1.0, d / 2 + 1.05 ) } );
	add( box( w - 0.2, 0.03, 1.4 ), { color: [ 0xb8ac94, 0x8a7a64, 0x6b2a24 ][ Math.floor( rnd() * 3 ) ], rough: 0.95, pattern: PAT.cloth, matrix: F.m( 0, floor + 2.1, d / 2 + 0.55, 0.28, 0, ( rnd() - 0.5 ) * 0.06 ) } );
	// the lantern by the door
	add( box( 0.03, 0.03, 0.3 ), { color: 0x1c1a18, rough: 0.6, metal: 0.5, matrix: F.m( - 0.65, floor + 1.95, d / 2 + 0.15 ) } );
	kit.glow( cylinder( 0.07, 0.07, 0.17, 6 ), { color: 0x6a4a2a, lit: rnd() < 0.7 ? 0.9 : 0, matrix: F.m( - 0.65, floor + 1.75, d / 2 + 0.3 ) } );
	// a crate and a barrel on the deck
	add( box( 0.5, 0.45, 0.5 ), { ...WOODX( 0x7a5a3a ), matrix: F.m( w / 2 - 0.5, floor + 0.23, d / 2 + 0.6, 0, rnd(), 0 ) } );
	add( cylinder( 0.25, 0.25, 0.7, 10 ), { ...WOOD( 0x5a4028 ), matrix: F.m( - w / 2 + 0.45, floor + 0.35, d / 2 + 0.6 ) } );

}
