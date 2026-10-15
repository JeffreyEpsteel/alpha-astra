import { Group, Mesh, SphereGeometry, Vector3 } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { WORLD } from '../world/WorldLayout.js';
import { BOATS, boatUrl } from './Boats.js';
import { loadStaticGLB } from '../world/boat/StaticGLB.js';

// Ethena's boat yard: the display fleet (skiff, canoe, cutter, launch) moored in the shallows east
// of the pier, by the boathouse, each with a mooring buoy ahead of it. The hulls are static GLBs
// (loadStaticGLB) that bob gently on the spot; the player buys one of them at the yard, which then
// appears at the pier head as the driven boat (world/boat/BoatFactory.js).
//
//   const yard = new BoatYard( { scene, terrain, query } );   // terrain.heightAt( x, z )
//   yard.update( dt, camera ); yard.boatAt( 'skiff' ) -> { id, group, position, yaw } | null
//   YARD.x / YARD.z: centre of the moorings (minimap marker, vendor prompt); set by the constructor,
//   the default is the nominal spot by the boathouse before any yard exists.

export const YARD_IDS = [ 'skiff', 'canoe', 'cutter', 'launch' ];
export const YARD = { x: 90, z: - 26 };

const SCAN = { x0: 72, x1: 110, z0: - 40, z1: - 10, step: 1 };
const DEPTH = { min: - 2.5, max: - 1.2 }; // terrain height band (m) deep enough to float, close to shore
const SPACING = 7, PIER_CLEAR = 12, DOCK_CLEAR = 16;
const HEAVE = 0.06, ROLL = 0.02;
const FAR = 500; // beyond this (m from the camera) the bob is not updated

export class BoatYard {

	constructor( { scene, terrain, query = null } ) {

		this.scene = scene;
		this.terrain = terrain;
		this.query = query;
		this.group = new Group();
		this.group.name = 'BoatYard';
		this.boats = new Map();
		this._time = 0;
		this._disposed = false;

		// bow into the swell (the swell travels along WORLD.swellDir, toward -z)
		const bowDir = new Vector3( - WORLD.swellDir.x, 0, - WORLD.swellDir.y ).normalize();
		this.yaw = Math.atan2( bowDir.x, bowDir.z );

		const spots = findMoorings( terrain, YARD_IDS.length );
		let cx = 0, cz = 0;
		for ( const s of spots ) { cx += s.x; cz += s.z; }
		YARD.x = cx / spots.length;
		YARD.z = cz / spots.length;

		this._buoyGeo = new SphereGeometry( 0.22, 12, 8 );
		this._buoyMat = new Material( { name: 'yard-buoy', color: 0xe8641c, roughness: 0.55, underwaterLighting: 'lite' } );

		YARD_IDS.forEach( ( id, i ) => {

			const spot = spots[ i ];
			const pivot = new Group();
			pivot.name = 'yard-' + id;
			pivot.position.set( spot.x, 0, spot.z );
			pivot.rotation.set( 0, this.yaw, 0 );
			this.group.add( pivot );

			const buoy = new Mesh( this._buoyGeo, this._buoyMat );
			buoy.name = 'yard-buoy';
			buoy.castShadow = true;
			buoy.position.set( spot.x + bowDir.x * ( BOATS[ id ].length / 2 + 3 ), 0.1, spot.z + bowDir.z * ( BOATS[ id ].length / 2 + 3 ) );
			this.group.add( buoy );

			const entry = { id, group: pivot, buoy, position: pivot.position, yaw: this.yaw, phase: i * 1.7 + 0.4, loaded: false, glb: null };
			this.boats.set( id, entry );
			loadStaticGLB( boatUrl( BOATS[ id ] ) ).then( ( glb ) => {

				if ( this._disposed ) return glb.dispose();
				for ( const m of glb.materials ) m.underwaterLighting = 'lite';
				glb.group.name = 'yard-hull-' + id;
				pivot.add( glb.group );
				entry.glb = glb;
				entry.loaded = true;

			} ).catch( ( e ) => console.warn( 'BoatYard: ' + id + ' failed to load', e ) );

		} );

		this.ready = Promise.resolve(); // the hulls stream in; nothing waits on them
		scene.add( this.group );

	}

	boatAt( id ) {

		return this.boats.get( id ) || null;

	}

	// gentle bob: heave and roll on slow sines with a per-boat phase; skipped far from the camera
	update( dt, camera = null ) {

		if ( ! ( dt > 0 ) ) return;
		this._time += dt;
		if ( camera && camera.position && Math.hypot( camera.position.x - YARD.x, camera.position.z - YARD.z ) > FAR ) return;
		const t = this._time;
		for ( const b of this.boats.values() ) {

			const g = b.group;
			g.position.y = HEAVE * Math.sin( t * 0.55 + b.phase );
			g.rotation.set( 0, b.yaw, ROLL * Math.sin( t * 0.42 + b.phase * 1.3 ) );
			b.buoy.position.y = 0.1 + HEAVE * 0.8 * Math.sin( t * 0.6 + b.phase + 1.1 );

		}

	}

	dispose() {

		this._disposed = true;
		this.scene.remove( this.group );
		for ( const b of this.boats.values() ) if ( b.glb ) b.glb.dispose();
		this._buoyGeo.dispose();
		this._buoyMat.dispose();
		this.boats.clear();

	}

}

// Mooring spots: scan the shallows east of the pier for water of the right depth, at least
// SPACING apart, clear of the pier line and of the player's dock; falls back to a nominal row by
// the boathouse where the terrain gives too few.
export function findMoorings( terrain, count ) {

	const dock = WORLD.boatDock.position;
	const spots = [];
	const ok = ( x, z ) => {

		if ( Math.abs( x - WORLD.pier.x ) < PIER_CLEAR ) return false;
		if ( Math.hypot( x - dock.x, z - dock.z ) < DOCK_CLEAR ) return false;
		for ( const s of spots ) if ( Math.hypot( x - s.x, z - s.z ) < SPACING ) return false;
		return true;

	};

	if ( terrain && terrain.heightAt ) {

		// shallow first (closest to the shore), then along the shore
		const cands = [];
		for ( let x = SCAN.x0; x <= SCAN.x1; x += SCAN.step ) {

			for ( let z = SCAN.z0; z <= SCAN.z1; z += SCAN.step ) {

				const h = terrain.heightAt( x, z );
				if ( h >= DEPTH.min && h <= DEPTH.max ) cands.push( { x, z, h } );

			}

		}

		cands.sort( ( a, b ) => b.h - a.h || a.x - b.x );
		for ( const c of cands ) {

			if ( spots.length >= count ) break;
			if ( ok( c.x, c.z ) ) spots.push( { x: c.x, z: c.z, h: c.h } );

		}

	}

	for ( let i = 0; spots.length < count; i ++ ) {

		const x = 78 + i * 8, z = - 24;
		if ( ok( x, z ) ) spots.push( { x, z, h: - 2 } );
		else spots.push( { x, z: z + 8, h: - 2 } );

	}

	return spots;

}
