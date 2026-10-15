// Lanterns on the AI ships (user 2026-10-13: "make sure the lights actually illuminate the surroundings from the ships"):
// a small pool of local light sources that follows the nearest alive ships each frame: a stern lantern and a masthead
// light per ship, warm, with the same dusk ramp as every lamp (LocalLights.update scales by the night). The pool is
// handed to the scene's local lights once (features' lights[] at install), so ships that spawn later still get lit:
// the sources move, they are not created per ship.
//
//   const sl = new ShipLights( naval, { ships: 3 } );   sl.sources (LocalLights sources)   sl.update( camera )
import { Vector3, Color } from '../../engine/index.js';

const PER_SHIP = 2;
const _v = new Vector3();

export class ShipLights {

	constructor( naval, { ships = 3 } = {} ) {

		this.naval = naval;
		this.sources = [];
		for ( let i = 0; i < ships * PER_SHIP; i ++ ) {

			const stern = i % PER_SHIP === 0;
			this.sources.push( {
				position: new Vector3( 0, - 100, 0 ), color: new Color( stern ? 1.0 : 1.0, stern ? 0.82 : 0.93, stern ? 0.55 : 0.8 ),
				intensity: stern ? 2.4 : 2.0, range: stern ? 16 : 20, kind: stern ? 'shipLantern' : 'shipMast', enabled: false,
				dir: null, flicker: stern ? 0.08 : 0, phase: i * 1.7,
			} );

		}

	}

	// the nearest alive ships to the camera take the pool (the ships' own update moved them this frame)
	update( camera ) {

		const ships = this.naval.ships;
		const cp = camera ? camera.position : null;
		const near = [];
		for ( const s of ships ) {

			if ( ! s.alive || s.sinking ) continue;
			s._ld2 = cp ? ( s.x - cp.x ) * ( s.x - cp.x ) + ( s.z - cp.z ) * ( s.z - cp.z ) : 0;
			if ( s._ld2 < 400 * 400 ) near.push( s );

		}

		near.sort( ( a, b ) => a._ld2 - b._ld2 );
		const n = this.sources.length / PER_SHIP;
		for ( let i = 0; i < n; i ++ ) {

			const s = near[ i ], stern = this.sources[ i * PER_SHIP ], mast = this.sources[ i * PER_SHIP + 1 ];
			if ( ! s ) { stern.enabled = mast.enabled = false; continue; }
			const c = s.cls || {}, L = c.length || 12, y = ( s.pose ? s.pose.y : 0 ) + ( c.sheer || 1.2 );
			const sx = Math.sin( s.yaw ), cz = Math.cos( s.yaw );
			// astern (−forward) for the lantern, amidships and up the mast for the masthead
			stern.position.set( s.x - sx * L * 0.46, y + 1.2, s.z - cz * L * 0.46 );
			mast.position.set( s.x + sx * L * 0.05, y + Math.min( 9, 3 + L * 0.3 ), s.z + cz * L * 0.05 );
			stern.enabled = mast.enabled = true;

		}

		void _v;

	}

}
