// The flares in the sky (wave 15D): each climbs on a smoke trail, bursts and hangs red under its parachute for FLARE.burn
// seconds, sinking and drifting downwind. Drawn as a small emissive ball kept a few pixels wide at any distance (seen
// from kilometres), the vfx feature's fire on its head and smoke puffs, and a red local light that lights the water at
// night (a pool of sources handed to the scene's lights once: lights[]). Headless without a scene (the list still runs).
//
//   const fx = new Flares( { scene, vfx: () => vfx | null, audio, sfx: () => sfx | null } );
//   fx.launch( x, y, z, { remote } ) -> flare     fx.update( dt, camera, wind )     fx.list [ { id, x, y, z, t, phase } ]
//   fx.lights (LocalLights sources)               fx.clear() / dispose()
import { Mesh, SphereGeometry, Vector3, Color } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { FLARE } from './RescueData.js';

const MAX = 4; // flares in the sky at once (an older one goes out)
const LIGHTS = 2;
const G = 9.81;

export class Flares {

	constructor( { scene = null, vfx = () => null, audio = null, sfx = () => null } = {} ) {

		this.scene = scene;
		this.vfx = vfx;
		this.audio = audio;
		this.sfx = sfx;
		this.list = [];
		this._id = 1;
		const c = FLARE.light.color;
		this.lights = [];
		for ( let i = 0; i < LIGHTS; i ++ ) {

			this.lights.push( {
				position: new Vector3( 0, - 100, 0 ), color: new Color( c[ 0 ], c[ 1 ], c[ 2 ] ), intensity: FLARE.light.intensity,
				range: FLARE.light.range, kind: 'flare', enabled: false, dir: null, flicker: 0.25, phase: i * 2.3, scale: 1,
			} );

		}

		this._geo = scene ? new SphereGeometry( 1, 10, 8 ) : null;
		this._mat = scene ? new Material( { name: 'rescue-flare', color: 0xff3a24, emissive: [ 9, 1.4, 0.7 ], roughness: 1, underwaterLighting: 'lite' } ) : null;

	}

	launch( x, y, z, { remote = false } = {} ) {

		if ( this.list.length >= MAX ) this._remove( 0 );
		const a = Math.random() * Math.PI * 2, lean = 1.5 + Math.random() * 1.5;
		const f = {
			id: this._id ++, x, y, z, vx: Math.cos( a ) * lean, vy: FLARE.speed, vz: Math.sin( a ) * lean,
			t: 0, phase: 'rise', remote, smokeT: 0, mesh: null,
		};
		if ( this.scene && this._geo ) {

			f.mesh = new Mesh( this._geo, this._mat );
			f.mesh.name = 'rescue-flare';
			f.mesh.position.set( x, y, z );
			f.mesh.scale.setScalar( 0.3 );
			this.scene.add( f.mesh );

		}

		this.list.push( f );
		if ( this.audio && this.audio.whoosh ) this.audio.whoosh( 1.6 );
		return f;

	}

	update( dt, camera = null, wind = null ) {

		if ( ! ( dt > 0 ) ) return;
		const vfx = this.vfx() || null;
		const wx = wind ? wind.x : 0.6, wz = wind ? wind.z : 0.2;
		for ( let i = this.list.length - 1; i >= 0; i -- ) {

			const f = this.list[ i ];
			f.t += dt;
			f.smokeT -= dt;
			if ( f.phase === 'rise' ) {

				f.vy -= G * dt;
				f.x += f.vx * dt;
				f.y += f.vy * dt;
				f.z += f.vz * dt;
				if ( f.smokeT <= 0 && vfx ) {

					f.smokeT = 0.08;
					vfx.smoke( f.x, f.y, f.z, 0.25 );

				}

				if ( f.t >= FLARE.rise ) this._burst( f, vfx );

			} else if ( f.phase === 'burn' ) {

				// under the parachute: sinking, drifting downwind
				f.x += wx * FLARE.drift * dt;
				f.z += wz * FLARE.drift * dt;
				f.y -= FLARE.sink * dt;
				if ( vfx && vfx.fire ) vfx.fire( 'flare-' + f.id, f.x, f.y, f.z, 0.45 );
				if ( f.smokeT <= 0 && vfx ) {

					f.smokeT = 0.6;
					vfx.smoke( f.x, f.y + 0.4, f.z, 0.2 );

				}

				if ( f.t >= FLARE.rise + FLARE.burn ) {

					this._remove( i );
					continue;

				}

			}

			if ( f.mesh ) {

				// a few pixels wide at any range (a flare is a point of light far off), brighter while it burns
				const d = camera && camera.position ? Math.hypot( camera.position.x - f.x, camera.position.y - f.y, camera.position.z - f.z ) : 50;
				f.mesh.position.set( f.x, f.y, f.z );
				f.mesh.scale.setScalar( Math.max( f.phase === 'burn' ? 0.5 : 0.2, d * ( f.phase === 'burn' ? 0.004 : 0.0015 ) ) );

			}

		}

		this._light();

	}

	// the burning flares (newest first) take the light pool
	_light() {

		let n = 0;
		for ( let i = this.list.length - 1; i >= 0 && n < this.lights.length; i -- ) {

			const f = this.list[ i ];
			if ( f.phase !== 'burn' ) continue;
			const L = this.lights[ n ++ ];
			L.position.set( f.x, f.y, f.z );
			const left = FLARE.rise + FLARE.burn - f.t;
			L.scale = Math.min( 1, left / 3, ( f.t - FLARE.rise ) / 0.3 + 0.2 ); // (fades in at the burst, out at the end)
			L.enabled = true;

		}

		for ( ; n < this.lights.length; n ++ ) this.lights[ n ].enabled = false;

	}

	_burst( f, vfx ) {

		f.phase = 'burn';
		f.vx = f.vy = f.vz = 0;
		if ( vfx ) {

			if ( vfx.flash ) vfx.flash( f.x, f.y, f.z, 1.5 );
			vfx.smoke( f.x, f.y, f.z, 0.6 );

		}

		const s = this.sfx();
		if ( s && s.play ) try { s.play( 'thwack', { at: { x: f.x, y: f.y, z: f.z } } ); } catch ( e ) { /* sound is optional */ }

	}

	_remove( i ) {

		const [ f ] = this.list.splice( i, 1 );
		if ( ! f ) return;
		const vfx = this.vfx();
		if ( vfx && vfx.stopFire ) vfx.stopFire( 'flare-' + f.id );
		if ( f.mesh && this.scene ) this.scene.remove( f.mesh );

	}

	clear() {

		while ( this.list.length ) this._remove( this.list.length - 1 );
		this._light();

	}

	dispose() {

		this.clear();
		if ( this._geo && this._geo.dispose ) this._geo.dispose();
		if ( this._mat && this._mat.dispose ) this._mat.dispose();

	}

}
