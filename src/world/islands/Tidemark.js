import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { G } from '../../engine/render/Frame.js';
import { prepare, mergePrepared } from '../boat/GeoKit.js';
import { createPropMaterial } from '../../game/GameMaterials.js';
import { WORLD } from '../WorldLayout.js';
import { TIDEMARK as I, tidemarkWorld } from '../terrain/IslandShape.js';
import { cameraPosition } from './IslandKit.js';
import { attachTidemark, ensureTidemark } from './town/TidemarkTerrain.js';
import { terrainGeometry, riverGeometry } from './town/TerrainMesh.js';
import { buildShells, lookoutGlass } from './town/Buildings.js';
import { buildWaterfront } from './town/Waterfront.js';
import { buildAirstrip } from './town/Airstrip.js';
import { scatterTrees } from './town/Vegetation.js';
import { TownDamage } from './town/Damage.js';
import { BUILDINGS, SPOTS, townProps } from './town/Layout.js';
import { NearRelease } from '../village/TownKit.js';

// Tidemark, the big town island east of the archipelago (terrain/IslandShape.js TIDEMARK, WORLD.tidemark): a ~420 m
// green island beyond the 2048 m heightmap on its own terrain tile, a sheltered bay on its lee (east-south-east) side
// with a long beach, a rocky headland with sea cliffs to the north, the lookout hill, a stream running down to the bay,
// and the town on the bay: the stone quay and pier, a timber wharf, twelve buildings on two streets round the market
// square (the chandlery, the Tide & Tankard, the warehouse, the chapel, fishermen's houses, the harbourmaster's hut and
// the boatyard), and the airstrip on the level ground behind the town (hangar, windsock, fuel, edge lights). The
// breakable props (stalls, carts, lamp posts, fences, the well roof, the pier railings, the boatyard's doors, crates
// and barrels) are the destruction feature's (Sites.js plans them from town/Layout.js); the shells take damage states.
//
//   const tm = new Tidemark( { scene, terrain, colliders, village? } )
//   tm.tile (the terrain tile; attached to `terrain`'s queries), tm.group, tm.lights (LocalLights sources),
//   tm.update( dt ) (distance culling, the night glow, the windsock), tm.distance (camera, m)
//   tm.damage (TownDamage: hit( x, y, z, energy ) / state( id ) / toJSON / fromJSON), tm.buildings (shells),
//   tm.connect( features ) (cannonballImpact / explosion / planeCrashed damage the shells; the vfx feature's smoke),
//   tm.airstrip / tm.bay / tm.dock (WORLD.tidemark), tm.stats { triangles, palms, trees, edgeLights, lights }
//   tm.release (TownKit NearRelease, phones: the near meshes' GPU buffers freed beyond 1.5 km, re-uploaded from 1.3 km)

const NEAR_TERRAIN = 1100; // m: the 4 m terrain mesh within this, the 16 m one beyond (the far one is the landmark)
const TOWN_DIST = 800; // the shells, the props and the airstrip
const TREE_DIST = 900;

export class Tidemark {

	constructor( { scene, terrain, colliders = null, village = null, tile = null, budget = null } ) {

		this.tile = tile ? attachTidemark( terrain, tile ) : ensureTidemark( terrain );
		this.terrain = terrain;
		const T = this.tile;
		const phone = budget ?? ( globalThis.__phoneBudget ? 0.5 : 1 );
		this.material = createPropMaterial( 'tidemark' );
		this.lampMaterial = createPropMaterial( 'tidemarkLamps' );
		this.lampMaterial.side = 'double';
		this.group = new Group();
		this.group.name = 'Tidemark';
		scene.add( this.group );
		this.center = new Vector3( I.x, 0, I.z );
		this.airstrip = WORLD.tidemark.airstrip;
		this.bay = WORLD.tidemark.bay;
		this.dock = WORLD.tidemark.dock;
		this.lights = [];

		// the terrain: the land and shallows at 4 m (6 m on phones) near, and a 16 m mesh of the whole tile that is always
		// drawn (the deeper seabed; dropped 1 m under the near mesh while that shows, so they never fight) and the stream
		const nearT = new Mesh( terrainGeometry( T, { step: phone < 1 ? 3 : 2, floor: phone < 1 ? - 3 : - 4 } ), this.material );
		nearT.name = 'TidemarkTerrainNear';
		nearT.receiveShadow = true;
		nearT.castShadow = true;
		const farT = new Mesh( terrainGeometry( T, { step: 8, floor: - 40 } ), this.material );
		farT.name = 'TidemarkTerrainFar';
		farT.receiveShadow = true;
		this.group.add( nearT, farT );
		const rg = riverGeometry( T, I.river.pts, I.river.width );
		this.waterMaterial = createPropMaterial( 'tidemarkStream' );
		this.waterMaterial.side = 'double';
		const river = rg ? new Mesh( prepare( rg, { color: 0x2f5a62, rough: 0.05, metal: 0.1 } ), this.waterMaterial ) : null;
		if ( river ) {

			river.name = 'TidemarkStream';
			river.castShadow = false;
			this.group.add( river );

		}

		// the town: shells, the waterfront, the airstrip, the trees (one merged prop mesh near, one far)
		const Pn = [], Pf = [], L = [], Tn = [];
		const add = ( g, o ) => Pn.push( prepare( g, o ) );
		const addLamp = ( g, o ) => L.push( prepare( g, o ) );
		const shells = buildShells( { terrain: T, colliders, village, propMaterial: this.material } );
		this.buildings = shells.list;
		const wf = buildWaterfront( { terrain: T, add, colliders } );
		this.lights.push( ...wf.lights );
		const strip = buildAirstrip( { terrain: T, add, addLamp, colliders, material: this.material } );
		this.windsock = strip;
		this.group.add( strip.sock );
		const veg = scatterTrees( { tile: T, colliders, add: ( g, o ) => Tn.push( prepare( g, o ) ), addFar: ( g, o ) => Pf.push( prepare( g, o ) ), budget: phone } );
		lookoutGlass( addLamp, shells.lamp.x, shells.lamp.y, shells.lamp.z );
		this.lights.push( { position: shells.lamp.clone(), color: new Color( 1, 0.82, 0.52 ), intensity: 22, range: 45, kind: 'lantern', flicker: 0.05 } );

		const mk = ( list, name, mat, shadow = true ) => {

			if ( ! list.length ) return null;
			const m = new Mesh( mergePrepared( list ), mat );
			m.name = name;
			m.castShadow = shadow;
			m.receiveShadow = true;
			this.group.add( m );
			return m;

		};
		for ( const m of shells.meshes ) this.group.add( m );
		this.group.add( shells.far );
		const props = mk( Pn, 'TidemarkTown', this.material );
		const trees = mk( Tn, 'TidemarkTrees', this.material );
		const crowns = mk( Pf, 'TidemarkCrownsFar', this.material, false );
		const lamps = mk( L, 'TidemarkLamps', this.lampMaterial, false );

		this.damage = new TownDamage( this.buildings, { group: this.group, material: this.material } );
		this.parts = { nearT, farT, river, shells: shells.meshes, props, trees, crowns, lamps };
		// the renderer's distance cull measures from the object's position (scaled by the quality tier): the merged meshes
		// are built in world space, so they are re-centred on the town before getting a cull distance
		const town = tidemarkWorld( - 110, - 20 );
		for ( const m of [ ...shells.meshes, props, trees ] ) {

			if ( ! m ) continue;
			m.geometry.translate( - town[ 0 ], 0, - town[ 1 ] );
			m.geometry.computeBoundingBox();
			m.geometry.computeBoundingSphere();
			m.position.set( town[ 0 ], 0, town[ 1 ] );
			if ( m.updateMatrix ) m.updateMatrix();
			m.cullDistance = m === trees ? TREE_DIST : TOWN_DIST;
			m.cullRadius = m === trees ? 450 : 260; // the trees spread over the island; the town and the airstrip ~260 m round it

		}
		const tris = ( m ) => ( m && m.geometry.index ? m.geometry.index.count / 3 : 0 );
		this.stats = {
			terrain: tris( nearT ), terrainFar: tris( farT ), trees: tris( trees ), town: [ ...shells.meshes, shells.far, props, lamps, river ].reduce( ( s, m ) => s + tris( m ), 0 ),
			palms: veg.palms, treeCount: veg.trees, edgeLights: strip.edgeLights, lights: this.lights.length, villageHouses: shells.village,
			buildings: BUILDINGS.length, props: townProps( T ).length, tile: T.timings,
		};
		this.distance = Infinity;
		this._spots = SPOTS;
		// wave 20A (phones): the near terrain, the shells (the kit hangs under the paving), the props, trees, lamps and the stream
		// let their GPU buffers go while the town is far; the far terrain, the far shells and the far crowns stay
		this.release = new NearRelease( { roots: [ nearT, river, ...shells.meshes, props, trees, lamps ] } );

	}

	update( dt ) {

		const cam = cameraPosition();
		const d = cam ? Math.hypot( cam.x - this.center.x, cam.z - this.center.z ) : Infinity;
		this.distance = d;
		const P = this.parts, known = Number.isFinite( d );
		const near = ! known || d < NEAR_TERRAIN;
		if ( P.nearT.visible !== near ) P.nearT.visible = near;
		const drop = near ? - 1 : 0;
		if ( P.farT.position.y !== drop ) {

			P.farT.position.y = drop;
			if ( P.farT.updateMatrix ) P.farT.updateMatrix();

		}
		const town = ! known || d < TOWN_DIST + 400;
		for ( const m of P.shells ) if ( m.visible !== town ) m.visible = town;
		for ( const m of [ P.props, P.lamps, P.river ] ) if ( m && m.visible !== town ) m.visible = town;
		if ( P.trees ) P.trees.visible = ! known || d < TREE_DIST;
		if ( P.crowns ) P.crowns.visible = known && d >= TREE_DIST;
		// lamps glow at dusk and through the night (the edge lights, the lookout's lantern room)
		const night = Math.max( 0, Math.min( 1, ( ( G.night ? G.night.value : 0 ) - 0.1 ) / 0.6 ) );
		const e = 0.15 + 3.2 * night;
		this.lampMaterial.emissive = [ e, e * 0.82, e * 0.55 ];
		if ( town && G.windDir ) this.windsock.updateWind( G.windDir.value );
		this.release.update( d ); // (after the visibility above: a released town's near meshes stay hidden)
		this.damage.update( dt, this.features && this.features.get ? this.features.get( 'vfx' ) : null );

	}

	// the game's hits on the town's shells (Features events): cannonballs, explosions and crashing planes crack the walls and
	// set roofs smoking (the vfx feature's smoke); returns the unsubscribe. App calls it once the features are installed.
	connect( features ) {

		if ( ! features || typeof features.on !== 'function' ) return () => {};
		this.features = features;
		const hit = ( e, energy ) => e && Number.isFinite( e.x ) && this.damage.hit( e.x, e.y ?? 2, e.z, energy );
		const offs = [
			features.on( 'cannonballImpact', ( e ) => hit( e, e && e.energy > 0 ? e.energy : 4000 ) ),
			features.on( 'explosion', ( e ) => hit( e, e && e.energy > 0 ? e.energy : 8000 ) ),
			features.on( 'planeCrashed', ( e ) => hit( e, e ? 0.5 * ( e.mass || 600 ) * ( e.speed || 20 ) ** 2 : 0 ) ),
		];
		this._off = () => { for ( const o of offs ) if ( typeof o === 'function' ) o(); };
		return this._off;

	}

	dispose() {

		if ( this._off ) this._off();
		this.damage.reset();
		if ( this.group.parent ) this.group.parent.remove( this.group );
		this.group.traverse( ( o ) => { if ( o.geometry && o.geometry.dispose ) o.geometry.dispose(); } );

	}

}
