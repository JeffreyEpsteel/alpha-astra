import { Group, Mesh, Vector3, Color, Matrix4 } from '../../../engine/index.js';
import { G } from '../../../engine/render/Frame.js';
import { loadGLB } from '../../../engine/loaders/GLTF.js';
import { prepare } from '../../boat/GeoKit.js';
import { createPropMaterial } from '../../../game/GameMaterials.js';
import { standard } from '../../../materials/Materials.js';
import { WORLD } from '../../WorldLayout.js';
import { cameraPosition } from '../IslandKit.js';
import { TownKit, parseKit, createGlowMaterial, updateGlow, NearRelease } from '../../village/TownKit.js';
import { riverGeometry } from '../town/TerrainMesh.js';
import { ensureMeridian, MeridianTerrain } from '../MeridianTerrain.js';
import { meridianLandGeometry } from '../MeridianMesh.js';
import { MERIDIAN, cityPlan, footprint, signalState, signalOffset, SIGNAL_CYCLE, RIVER_REL, DOCKS_DECK } from './CityPlan.js';
import { Acc, buildingInto, createFacadeMaterial, tiersOf, STYLE } from './Facades.js';
import { buildStreets } from './Streets.js';
import { registerMeridian } from './World.js';

// Meridian, the city island (wave 21A): builds the plan (meridian/CityPlan.js) on its terrain tile and publishes the
// runtime handle the cars (21B) and the city's destruction (21C) use.
//
//   const city = new Meridian( { scene, terrain, colliders, budget? } )      (Ports builds it: ports.meridian; App: app.meridian)
//   city.plan                       the plan;  city.tile  the terrain tile (attached to `terrain`'s queries)
//   city.building( id ) -> handle   { id, kind, plan, group (a Group at the building's foot, made on first use), bounds
//                                   { min, max }, colliders [ Colliders boxes ], setStage( 0..3 ) -> stage, stage, fireAnchors
//                                   [ { x, y, z } ] , landmark, collapsible, protected }
//   city.buildings()                every handle;  city.onStage = ( id, stage ) => { ... }  (21C: called after each change)
//   city.roadHeight( x, z )         the road surface (the terrain, the hill road's graded profile)
//   city.signalState( node, axis )  'green' | 'yellow' | 'red' now (the heads the city draws show the same)
//   city.seats / city.homes         for townlife (benches { id, x, y, z, yaw }; doors { id, x, z, yaw })
//   city.lights                     LocalLights sources (a few: the lighthouse, the plazas, the port)
//   city.update( dt ), city.stats, city.distance, city.dispose()
//
// Stage looks: 1 scarred (broken panes, soot), 2 gutted (fire glow behind the windows), 3 collapsed (a stump of the ground
// floor; 21C's onStage adds the rubble). The Twins share all destruction stages.
// Distance: per chunk (~400 m) a near mesh (cornices, roof plant, water tanks, awnings, signs) or a far one (the tiers
// alone); the kit (lamps, signals, benches, trees, cranes) and the streets only near the city; the land at 4 m (hills) /
// 8 m (the city plain) near and 24 m far. Phones: shorter distances, coarser land, NearRelease when far.

const NEAR_CHUNK = 650, NEAR_CHUNK_PHONE = 380;
const STREETS_DIST = 900, KIT_DIST = 650, LAND_DIST = 1700;
const CHUNK = { w: 400, d: 350 };
const KIT_URL = 'models/meridian/kit.glb';
const LENS = { red: new Color( 1.0, 0.07, 0.04 ), yellow: new Color( 1.0, 0.55, 0.04 ), green: new Color( 0.1, 1.0, 0.45 ) };
// the lenses of a signal_pole (tools/meridian/kit.py), local metres: the arm head and the pole head, red / yellow / green
export const SIGNAL_LENSES = [ [ - 4.5, 6.21 ], [ - 4.5, 5.85 ], [ - 4.5, 5.49 ], [ 0, 3.31 ], [ 0, 2.95 ], [ 0, 2.59 ] ];

const base = () => {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

};

// the signal heads' material: each lens knows its junction's offset, its axis and its colour; the frame's time picks the lit one
function createSignalMaterial() {

	const P = SIGNAL_CYCLE.period, g = SIGNAL_CYCLE.green, y = SIGNAL_CYCLE.green + SIGNAL_CYCLE.yellow;
	const m = standard( {
		vertexColors: true,
		attributes: { aux: 'vec4f' },
		varyings: { vAux: 'vec4f' },
		vertex: /* wgsl */`
	o.vAux = v.aux;
`,
	} );
	m.name = 'meridianSignals';
	m.surface = /* wgsl */`
	var q = fract( ( frame.time + in.vs.vAux.x ) / ${ P.toFixed( 1 ) } ) * ${ P.toFixed( 1 ) };
	if ( in.vs.vAux.y > 0.5 ) { q = fract( ( q + ${ ( P / 2 ).toFixed( 1 ) } ) / ${ P.toFixed( 1 ) } ) * ${ P.toFixed( 1 ) }; }
	let state = select( select( 0.0, 1.0, q < ${ y.toFixed( 1 ) } ), 2.0, q < ${ g.toFixed( 1 ) } );
	let on = 1.0 - step( 0.5, abs( in.vs.vAux.z - state ) );
	s.albedo = in.color.rgb * 0.12;
	s.roughness = 0.25;
	s.emissive = in.color.rgb * on * 6.0;
`;
	return m;

}

export class Meridian {

	constructor( { scene, terrain, colliders = null, budget = null, tile = null, kit = true } ) {

		registerMeridian( WORLD );
		this.tile = tile || ( terrain && terrain.heightAt ? ensureMeridian( terrain ) : new MeridianTerrain() );
		this.terrain = terrain;
		this.colliders = colliders;
		this.plan = cityPlan();
		const phone = budget ?? ( globalThis.__phoneBudget ? 0.5 : 1 );
		this.phone = phone < 1;
		this.center = new Vector3( MERIDIAN.center.x, 0, MERIDIAN.center.z );
		this.group = new Group();
		this.group.name = 'Meridian';
		if ( scene ) scene.add( this.group );
		this.onStage = null;
		this.lights = [];
		this.distance = Infinity;
		this.landMaterial = createPropMaterial( 'meridianLand' );
		this.facade = createFacadeMaterial( 'meridianFacade' );
		this.kitMaterial = createPropMaterial( 'meridianKit' );
		this.glowMaterial = createGlowMaterial( 'meridianGlow' );
		this.signalMaterial = createSignalMaterial();
		const T = this.tile;

		// ---- the land: the hills at 4 m (west of the city plain), the plain at 8 m, the whole tile at 24 m (always drawn,
		// dropped 1 m under the near meshes while they show), the river
		const split = 120; // the column at u = -440 (a multiple of 2, 3 and 6: the steps' grids meet on it)
		const nearHills = new Mesh( meridianLandGeometry( T, { step: this.phone ? 2 : 1, floor: - 4, i0: 0, i1: split } ), this.landMaterial );
		const nearCity = new Mesh( meridianLandGeometry( T, { step: this.phone ? 3 : 2, floor: - 4, i0: split, i1: T.n - 1 } ), this.landMaterial );
		const far = new Mesh( meridianLandGeometry( T, { step: 6, floor: - 40 } ), this.landMaterial );
		nearHills.name = 'MeridianLandHills'; nearCity.name = 'MeridianLandCity'; far.name = 'MeridianLandFar';
		for ( const m of [ nearHills, nearCity ] ) { m.receiveShadow = true; m.castShadow = true; }
		far.receiveShadow = true;
		this.group.add( nearHills, nearCity, far );
		this.waterMaterial = createPropMaterial( 'meridianRiver' );
		this.waterMaterial.side = 'double';
		const rg = riverGeometry( T, RIVER_REL.pts, RIVER_REL.width * 0.8 );
		const river = rg ? new Mesh( prepare( rg, { color: 0x2f5a62, rough: 0.05, metal: 0.1 } ), this.waterMaterial ) : null;
		if ( river ) { river.name = 'MeridianRiver'; this.group.add( river ); }

		// ---- the buildings, by chunk; their handles and colliders
		this.handles = new Map();
		this.chunks = new Map();
		for ( const b of this.plan.buildings ) {

			const key = b.kind === 'tower' ? 'twins' : `${ Math.floor( ( b.x - MERIDIAN.center.x + 800 ) / CHUNK.w ) }_${ Math.floor( ( b.z - MERIDIAN.center.z + 700 ) / CHUNK.d ) }`;
			let c = this.chunks.get( key );
			if ( ! c ) this.chunks.set( key, c = { key, list: [], near: null, far: null, dirty: true, x: 0, z: 0 } );
			c.list.push( b );
			this.handles.set( b.id, this._handle( b, c ) );

		}

		for ( const c of this.chunks.values() ) {

			let x0 = Infinity, x1 = - Infinity, z0 = Infinity, z1 = - Infinity;
			for ( const b of c.list ) { const f = footprint( b ); x0 = Math.min( x0, f.x0 ); x1 = Math.max( x1, f.x1 ); z0 = Math.min( z0, f.z0 ); z1 = Math.max( z1, f.z1 ); }
			c.x = ( x0 + x1 ) / 2; c.z = ( z0 + z1 ) / 2; c.radius = Math.hypot( x1 - x0, z1 - z0 ) / 2;
			c.near = new Mesh( undefined, this.facade ); c.far = new Mesh( undefined, this.facade );
			for ( const [ m, n ] of [ [ c.near, 'Near' ], [ c.far, 'Far' ] ] ) {

				m.name = `MeridianBlocks${ n }_${ c.key }`;
				m.position.set( c.x, 0, c.z );
				if ( m.updateMatrix ) m.updateMatrix();
				m.castShadow = true;
				m.receiveShadow = true;
				this.group.add( m );

			}

			this._rebuild( c );

		}

		// ---- the streets, the plazas, the seawalls, the pier, the runway (one mesh round the city's centre)
		const st = buildStreets( { tile: T, plan: this.plan } );
		this.streetInfo = st;
		const sg = st.acc.geometry();
		sg.translate( - this.center.x, 0, - this.center.z );
		sg.computeBoundingBox(); sg.computeBoundingSphere();
		const streets = new Mesh( sg, this.facade );
		streets.name = 'MeridianStreets';
		streets.position.copy( this.center );
		if ( streets.updateMatrix ) streets.updateMatrix();
		streets.receiveShadow = true;
		streets.castShadow = false;
		this.group.add( streets );

		// ---- the signal heads' lenses (their own material: the light follows signalState)
		const la = new Acc();
		this.signalNodes = new Map();
		for ( const s of st.signals ) {

			const node = this.plan.roads.byId[ s.node ];
			this.signalNodes.set( s.node, node );
			const y = this.roadHeight( s.x, s.z ) + 0.15;
			const c = Math.cos( s.yaw ), sn = Math.sin( s.yaw );
			const W = ( lx, ly, lz ) => [ s.x + lx * c + lz * sn, y + ly, s.z - lx * sn + lz * c ];
			const n = [ sn, 0, c ];
			SIGNAL_LENSES.forEach( ( [ lx, ly ], k ) => {

				const lens = 2 - ( k % 3 ); // red 0, yellow 1, green 2 (top to bottom)
				const col = [ LENS.red, LENS.yellow, LENS.green ][ lens ];
				const r = 0.13, zf = 0.115; // just in front of the housing's face (local +z 0.10), under its hood
				const aux = [ signalOffset( s.node ), s.axis === 'ew' ? 1 : 0, lens, 0 ];
				la.quad( W( lx - r, ly - r, zf ), W( lx + r, ly - r, zf ), W( lx + r, ly + r, zf ), W( lx - r, ly + r, zf ), n, [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ], col, aux );

			} );

		}

		const lg = la.geometry();
		lg.translate( - this.center.x, 0, - this.center.z );
		lg.computeBoundingSphere();
		const lenses = new Mesh( lg, this.signalMaterial );
		lenses.name = 'MeridianSignals';
		lenses.position.copy( this.center );
		if ( lenses.updateMatrix ) lenses.updateMatrix();
		lenses.castShadow = false;
		this.group.add( lenses );

		// ---- the kit (loads once): lamps, signals, benches, hydrants, trees, cranes, the market's stalls, the notice board
		this.kit = new TownKit( { name: 'Meridian', material: this.kitMaterial, glowMaterial: this.glowMaterial } );
		this._placeKit( st );
		this.kitMeshes = [];
		this.kitReady = kit ? loadGLB( base() + KIT_URL ).then( parseKit ).then( ( pieces ) => {

			const r = this.kit.build( pieces, streets, {} );
			this.kitMeshes = r.meshes;
			this.stats.kit = r.triangles;
			if ( r.missing.length ) console.warn( 'meridian kit: missing pieces', r.missing );
			for ( const m of r.meshes ) m.visible = streets.visible;
			return r;

		} ).catch( ( e ) => {

			if ( ! globalThis.__quietKit ) console.warn( 'meridian kit: could not load', e && e.message ? e.message : e );
			return null;

		} ) : Promise.resolve( null );

		// ---- the few real lights (the rest is emissive: windows, lamp heads, signs)
		const L = ( x, z, up, color, intensity, range, kind = 'lamp' ) => this.lights.push( { position: new Vector3( x, this.roadHeight( x, z ) + up, z ), color, intensity, range, kind } );
		const warm = new Color( 1.0, 0.82, 0.55 ), cool = new Color( 0.85, 0.92, 1.0 );
		const lh = this.plan.lighthouse;
		L( lh.x, lh.z, 31, new Color( 1, 0.9, 0.7 ), 40, 70, 'lantern' );
		if ( st.globe ) L( st.globe.x, st.globe.z, 9, cool, 16, 40 );
		const mk = this.plan.plazas.find( ( p ) => p.id === 'market' ), ap = this.plan.port.stand, stn = this.handles.get( 'station' );
		L( mk.x, mk.z, 7, warm, 14, 36 );
		L( ap.x, ap.z, 6, warm, 12, 30 );
		if ( stn ) L( stn.plan.x, stn.plan.z + stn.plan.d / 2 + 6, 6, cool, 12, 30 );
		// the street lamps: every other one a real light (LocalLights draws the 16 nearest the camera, from dusk: the rest of
		// the city keeps its lamp heads' glow alone); under the head, 2.2 m out over the road
		const lampCol = new Color( 0.92, 0.95, 1.0 );
		st.lamps.forEach( ( l, i ) => {

			if ( i % ( this.phone ? 4 : 2 ) ) return;
			L( l.x + Math.sin( l.yaw ) * 2.2, l.z + Math.cos( l.yaw ) * 2.2, 7.4, lampCol, 26, 22, 'streetLamp' );

		} );

		// ---- colliders: the pier's deck (walkable); the buildings' were added with their handles
		const pier = this.plan.docks.find( ( d ) => d.kind === 'pier' );
		if ( colliders && pier ) {

			const x0 = Math.min( pier.a.x, pier.b.x ), x1 = Math.max( pier.a.x, pier.b.x );
			colliders.addBox( new Vector3( ( x0 + x1 ) / 2, pier.deck - 0.25, pier.a.z ), new Vector3( ( x1 - x0 ) / 2, 0.25, pier.width / 2 ), 0, { walkable: true, tag: 'meridianPier' } );

		}

		// townlife: the benches and the doors of the homes round the port and downtown
		this.seats = st.benches.map( ( b, i ) => ( { id: 'meridian:bench' + i, x: b.x, y: this.roadHeight( b.x, b.z ) + 0.15 + 0.46, z: b.z, yaw: b.yaw } ) );
		this.homes = [];
		for ( const b of this.plan.buildings ) {

			if ( ! [ 'lowrise', 'midrise' ].includes( b.kind ) || b.style === 'garage' ) continue;
			const fx = Math.sin( b.yaw ), fz = Math.cos( b.yaw ), f = footprint( b );
			const half = Math.abs( fx ) > 0.5 ? ( f.x1 - f.x0 ) / 2 : ( f.z1 - f.z0 ) / 2;
			this.homes.push( { id: 'home:' + b.id, x: b.x + fx * ( half + 0.8 ), z: b.z + fz * ( half + 0.8 ), yaw: Math.atan2( - fx, - fz ), building: b.id } );

		}

		this.parts = { nearHills, nearCity, far, river, streets, lenses };
		const tris = ( m ) => ( m && m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0 );
		let near = 0, farT = 0;
		for ( const c of this.chunks.values() ) { near += tris( c.near ); farT += tris( c.far ); }
		this.stats = {
			buildings: this.plan.buildings.length, chunks: this.chunks.size, blocksNear: near, blocksFar: farT,
			streets: tris( streets ), lenses: tris( lenses ), landNear: tris( nearHills ) + tris( nearCity ), landFar: tris( far ),
			lamps: st.lamps.length, signals: st.signals.length, trees: st.trees.length, benches: st.benches.length, lights: this.lights.length,
			kit: 0, tile: T.timings,
		};
		this.release = new NearRelease( { roots: [ nearHills, nearCity, river, streets, lenses, ...[ ...this.chunks.values() ].map( ( c ) => c.near ) ] } );

	}

	// ------------------------------------------------------------------ the handles

	_handle( b, chunk ) {

		const self = this;
		const tiers = tiersOf( b );
		const colliders = [];
		if ( this.colliders ) {

			const ts = b.kind === 'tower' ? [ { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y0: b.y - 2, y1: b.y + b.h } ] : tiers;
			for ( const t of ts ) colliders.push( this.colliders.addBox( new Vector3( ( t.x0 + t.x1 ) / 2, ( t.y0 + t.y1 ) / 2, ( t.z0 + t.z1 ) / 2 ), new Vector3( ( t.x1 - t.x0 ) / 2, ( t.y1 - t.y0 ) / 2, ( t.z1 - t.z0 ) / 2 ), 0, { tag: 'meridianBuilding' } ) );
			if ( b.kind === 'tower' ) {

				// Roof support is separate from the solid walls: aircraft still strike the facade.
				// Two crossing rectangles stay inside the roof's chamfered corners.
				const roof = ( x0, x1, z0, z1, y ) => {

					const c = this.colliders.addBox( new Vector3( ( x0 + x1 ) / 2, y - 0.1, ( z0 + z1 ) / 2 ), new Vector3( ( x1 - x0 ) / 2, 0.1, ( z1 - z0 ) / 2 ), 0, { walkable: true, solid: false, tag: 'meridianRoof' } );
					c._roof = true;
					colliders.push( c );

				};
				const top = b.y + b.h, h = b.w / 2;
				roof( b.x - h + 2.2, b.x + h - 2.2, b.z - h, b.z + h, top );
				roof( b.x - h, b.x + h, b.z - h + 2.2, b.z + h - 2.2, top );
				const ph = h - 7.5;
				const plant = this.colliders.addBox( new Vector3( b.x, top + 3, b.z ), new Vector3( ph, 3, ph ), 0, { tag: 'meridianRoofPlant' } );
				plant._roofObstacle = true;
				colliders.push( plant );
				roof( b.x - ph, b.x + ph, b.z - ph, b.z + ph, top + 6 );
				if ( b.id === 'twin-north' ) {

					for ( const [ y0, y1, radius ] of [ [ top + 6, top + 20, 2.2 ], [ top + 20, top + 63, 1.4 ] ] ) {

						const mast = this.colliders.addBox( new Vector3( b.x, ( y0 + y1 ) / 2, b.z ), new Vector3( radius, ( y1 - y0 ) / 2, radius ), 0, { tag: 'meridianRoofMast' } );
						mast._roofObstacle = true;
						colliders.push( mast );

					}

				} else if ( b.id === 'twin-south' ) {

					const pavilion = this.colliders.addBox( new Vector3( b.x, top + 8, b.z ), new Vector3( 9, 2, 6 ), 0, { tag: 'meridianRoofPlant' } );
					pavilion._roofObstacle = true;
					colliders.push( pavilion );
					roof( b.x - 9, b.x + 9, b.z - 6, b.z + 6, top + 10 );

				}

			}

		}

		const f = footprint( b );
		let group = null;
		const h = {
			id: b.id, kind: b.kind, plan: b, chunk: chunk.key, stage: 0,
			landmark: !! b.landmark, collapsible: b.collapsible !== false, protected: !! b.protected, name: b.name || null,
			bounds: { min: { x: f.x0, y: b.y, z: f.z0 }, max: { x: f.x1, y: b.y + b.h, z: f.z1 } },
			colliders,
			fireAnchors: b.protected ? [] : fireAnchors( b, f ),
			setCollisionStage( s ) {

				for ( const c of colliders ) {

					if ( c._roof ) { c.walkable = s < 3; continue; }
					if ( c._roofObstacle ) { c.solid = s < 3; continue; }
					if ( c._top === undefined ) c._top = c.top;
					c.top = s >= 3 ? Math.max( c.bottom + 0.5, Math.min( c._top, b.y + Math.min( 4, b.h * 0.15 ) ) ) : c._top;
					c.half.y = ( c.top - c.bottom ) / 2;
					c.center.y = c.bottom + c.half.y;

				}

			},
			get group() {

				if ( ! group ) {

					group = new Group();
					group.name = 'meridian:' + b.id;
					group.position.set( b.x, b.y, b.z );
					self.group.add( group );

				}

				return group;

			},
			setStage( s ) {

				s = Math.max( 0, Math.min( 3, Math.round( Number( s ) || 0 ) ) );
				if ( b.collapsible === false ) s = Math.min( s, 2 );
				if ( s === h.stage ) return h.stage;
				h.stage = s;
				chunk.dirty = true;
				self._dirty = true;
				h.setCollisionStage( s );

				if ( typeof self.onStage === 'function' ) {

					try { self.onStage( b.id, s ); } catch ( e ) { console.warn( 'meridian: onStage failed', b.id, e ); }

				}

				return s;

			},
		};
		return h;

	}

	building( id ) {

		return this.handles.get( id ) || null;

	}

	// Highest live roof at/below maxY. Callers must check a downward crossing themselves.
	// pad is an inward clearance for a landing footprint, unlike groundHeightAt's outward pad.
	landingSurfaceAt( x, z, maxY = Infinity, pad = 0 ) {

		let best = null;
		for ( const h of this.handles.values() ) for ( const c of h.colliders ) {

			if ( ! c._roof || ! c.walkable || c.top > maxY ) continue;
			const x0 = c.center.x - c.half.x, x1 = c.center.x + c.half.x, z0 = c.center.z - c.half.z, z1 = c.center.z + c.half.z;
			if ( x < x0 + pad || x > x1 - pad || z < z0 + pad || z > z1 - pad ) continue;
			if ( ! best || c.top > best.y ) best = { id: h.id, x0, x1, z0, z1, y: c.top, top: c.top, tag: c.tag };

		}
		if ( best ) for ( const c of this.handles.get( best.id ).colliders ) {

			if ( ! c._roofObstacle || ! c.solid || c.top <= best.y + 0.01 || c.bottom > best.y + 0.2 ) continue;
			if ( Math.abs( x - c.center.x ) < c.half.x + pad && Math.abs( z - c.center.z ) < c.half.z + pad ) return null;

		}
		return best;

	}

	buildings() {

		return [ ...this.handles.values() ];

	}

	roadHeight( x, z ) {

		return this.tile.roadHeight( x, z );

	}

	signalState( node, axis, t = G.time ? G.time.value : 0 ) {

		return signalState( node, axis, t );

	}

	// rebuild the chunks whose buildings changed stage (setStage marks them; update() calls this once a frame)
	flush() {

		if ( ! this._dirty ) return 0;
		this._dirty = false;
		let n = 0;
		for ( const c of this.chunks.values() ) if ( c.dirty ) { this._rebuild( c ); n ++; }
		return n;

	}

	_rebuild( c ) {

		const near = new Acc(), far = new Acc();
		for ( const b of c.list ) {

			const stage = this.handles.get( b.id ).stage;
			buildingInto( near, b, { detail: true, stage } );
			buildingInto( far, b, { detail: false, stage } );

		}

		for ( const [ m, acc ] of [ [ c.near, near ], [ c.far, far ] ] ) {

			const g = acc.geometry();
			g.translate( - c.x, 0, - c.z );
			g.computeBoundingBox(); g.computeBoundingSphere();
			const old = m.geometry;
			m.geometry = g;
			if ( old && old !== g && old.dispose ) old.dispose();

		}

		c.dirty = false;

	}

	// ------------------------------------------------------------------ the kit

	_placeKit( st ) {

		const K = this.kit, m = new Matrix4(), r = new Matrix4();
		const put = ( piece, x, z, yaw, up = 0.15 ) => {

			r.makeRotationY( yaw );
			m.copy( r ).setPosition( x, this.roadHeight( x, z ) + up, z );
			K.place( piece, m );

		};
		// (phones: every other lamp, no hydrants, the park's trees but not the avenues')
		const ph = this.phone;
		st.lamps.forEach( ( l, i ) => { if ( ! ph || i % 2 === 0 ) put( 'lamp_city', l.x, l.z, l.yaw ); } );
		for ( const s of st.signals ) put( 'signal_pole', s.x, s.z, s.yaw );
		for ( const b of st.benches ) put( 'bench_city', b.x, b.z, b.yaw );
		if ( ! ph ) for ( const hy of st.hydrants ) put( 'hydrant', hy.x, hy.z, hy.yaw );
		st.trees.forEach( ( t, i ) => { if ( ! ph || ! t.street ) put( i % 3 ? 'tree_a' : 'tree_b', t.x, t.z, t.yaw * 1.7, t.street ? 0.15 : 0 ); } );
		// the docks: cranes along the north and south quays (their jibs over the basin), bollards along the quay edges
		const Q = this.plan.docks;
		for ( const d of Q ) {

			if ( d.kind !== 'quay' ) continue;
			const L = Math.hypot( d.b.x - d.a.x, d.b.z - d.a.z ), tx = ( d.b.x - d.a.x ) / L, tz = ( d.b.z - d.a.z ) / L;
			// the water side: the basin lies east of the west quay, south of the north quay, north of the south quay
			const yaw = d.id === 'quay-west' ? Math.PI / 2 : d.id === 'quay-north' ? 0 : Math.PI;
			const wx = Math.sin( yaw ), wz = Math.cos( yaw );
			for ( let s = 6; s < L - 4; s += 14 ) put( 'bollard', d.a.x + tx * s - wx * 0.8, d.a.z + tz * s - wz * 0.8, yaw, 0 );
			if ( d.id !== 'quay-west' ) for ( let s = 30; s < L - 20; s += 45 ) put( 'crane', d.a.x + tx * s - wx * 8, d.a.z + tz * s - wz * 8, yaw, 0 );

		}

		// the market square's stalls (two rows facing each other), the port's notice board and stalls on the apron
		const mk = this.plan.plazas.find( ( p ) => p.id === 'market' );
		for ( let k = 0; k < 6; k ++ ) {

			put( 'stall_market', mk.x - 40 + k * 16, mk.z + 6, Math.PI );
			put( 'stall_market', mk.x - 40 + k * 16, mk.z + 18, 0 );

		}

		this.stalls = [];
		for ( let k = 0; k < 6; k ++ ) this.stalls.push( { x: mk.x - 40 + k * 16, z: mk.z + 6, yaw: Math.PI }, { x: mk.x - 40 + k * 16, z: mk.z + 18, yaw: 0 } );
		const P = this.plan.port;
		put( 'board_notice', P.notice.x, P.notice.z, P.notice.yaw, 0 );
		for ( const v of P.vendors ) put( 'stall_market', v.x, v.z, v.yaw, 0 );
		// bus stops on the avenues near the station and the port
		const stn = this.plan.buildings.find( ( b ) => b.id === 'station' );
		if ( stn ) put( 'bus_stop', stn.x + 30, stn.z + stn.d / 2 + 6.5, 0 );

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		const cam = cameraPosition();
		const known = !! cam && Number.isFinite( cam.x );
		const d = known ? Math.hypot( cam.x - this.center.x, cam.z - this.center.z ) : Infinity;
		this.distance = d;
		this.flush();
		const P = this.parts;
		const nearLand = ! known || d < LAND_DIST;
		for ( const m of [ P.nearHills, P.nearCity, P.river ] ) if ( m && m.visible !== nearLand ) m.visible = nearLand;
		const drop = nearLand ? - 1 : 0;
		if ( P.far.position.y !== drop ) {

			P.far.position.y = drop;
			if ( P.far.updateMatrix ) P.far.updateMatrix();

		}

		// the distance to the city's edge (the plain is ~1.2 km across)
		const edge = Math.max( 0, d - 650 );
		const streets = ! known || edge < STREETS_DIST * ( this.phone ? 0.6 : 1 );
		if ( P.streets.visible !== streets ) P.streets.visible = streets;
		if ( P.lenses.visible !== streets ) P.lenses.visible = streets;
		const kit = ! known || edge < KIT_DIST * ( this.phone ? 0.6 : 1 );
		for ( const m of this.kitMeshes ) if ( m.visible !== kit ) m.visible = kit;
		const near = this.phone ? NEAR_CHUNK_PHONE : NEAR_CHUNK;
		for ( const c of this.chunks.values() ) {

			const dc = known ? Math.max( 0, Math.hypot( cam.x - c.x, cam.z - c.z ) - c.radius ) : 0;
			const n = ! known || dc < near;
			if ( c.near.visible !== n ) c.near.visible = n;
			if ( c.far.visible === n ) c.far.visible = ! n;

		}

		updateGlow( this.glowMaterial );
		this.release.update( d );

	}

	dispose() {

		if ( this.colliders ) {

			const own = new Set( [ ...this.handles.values() ].flatMap( ( h ) => h.colliders ) );
			this.colliders.boxes = this.colliders.boxes.filter( ( b ) => ! own.has( b ) && b.tag !== 'meridianPier' );

		}

		if ( this.group.parent ) this.group.parent.remove( this.group );
		this.group.traverse( ( o ) => { if ( o.geometry && o.geometry.dispose ) o.geometry.dispose(); } );

	}

}

// where a fire shows on a building: a window on each face every ~12 m up (to 60 m), and the roof
function fireAnchors( b, f ) {

	const out = [];
	const top = b.y + b.h;
	const cx = b.x, cz = b.z;
	const faces = [ [ cx, f.z1 + 0.3 ], [ f.x1 + 0.3, cz ], [ cx, f.z0 - 0.3 ], [ f.x0 - 0.3, cz ] ];
	for ( let y = b.y + 3; y < Math.min( top - 1, b.y + 60 ); y += 12 ) for ( const [ x, z ] of faces ) out.push( { x, y, z } );
	out.push( { x: cx, y: top + 0.5, z: cz } );
	return out;

}

export { DOCKS_DECK, STYLE };
