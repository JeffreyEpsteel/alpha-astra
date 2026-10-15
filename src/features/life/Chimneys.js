// Chimney smoke with a fog glow (docs/UNREAL_PARITY.md W10): every collider tagged 'chimney' (the village houses'
// stone stacks; any island that tags its chimneys the same way) puffs smoke through the VFX set, more in the morning
// and the evening and in cold wet weather; at night and in fog the flue's firelight glows at the top (a small warm
// local light the smoke and the roof pick up).
//
//   chimneySites( colliders ) -> [ { x, y, z } ]  the top of each stack (pure)
//   smokeRate( hour, weatherKind ) -> puffs per second (0 .. ~1.6)
//   const c = new Chimneys( { sites, vfx: () => features.get( 'vfx' ) } );  c.update( dt, { camera, hour, kind, fog } )
//   c.lights (LocalLights sources)  c.puffs (count)

import { Vector3, Color } from '../../engine/math/index.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const bump = ( x, c, w ) => Math.exp( - ( ( x - c ) / w ) * ( ( x - c ) / w ) );

export const SMOKE_RANGE = 260; // m: no puffs for chimneys farther from the camera
const GLOW_LIGHTS = 2;

export function makeGlowLights( n = GLOW_LIGHTS ) {

	const out = [];
	for ( let i = 0; i < n; i ++ ) out.push( { position: new Vector3( 0, - 1000, 0 ), color: new Color( 1.0, 0.52, 0.24 ), intensity: 0, range: 7, kind: 'chimney', enabled: false, flicker: 0.3 } );
	return out;

}

export function chimneySites( colliders ) {

	const out = [];
	for ( const b of colliders && colliders.boxes ? colliders.boxes : [] ) {

		if ( b.tag !== 'chimney' && b.tag !== 'stovepipe' ) continue;
		out.push( { x: b.center.x, y: b.top + 0.4, z: b.center.z } );

	}

	return out;

}

// cooking fires at breakfast and supper, a banked fire at night, more when it is cold and wet
export function smokeRate( hour = 12, kind = 'clear' ) {

	const h = ( ( hour % 24 ) + 24 ) % 24;
	let r = 0.25 + 0.9 * bump( h, 7, 1.6 ) + 1.0 * bump( h, 19, 2.2 ) + 0.35 * ( h > 21 || h < 5 ? 1 : 0 );
	if ( kind === 'rain' || kind === 'fog' || kind === 'overcast' ) r *= 1.35;
	if ( kind === 'storm' ) r *= 0.7; // the wind tears it away; fewer, quicker puffs
	return clamp( r, 0, 1.6 );

}

export class Chimneys {

	// lights: optional LocalLights sources to drive (the feature makes them at install so the registry hands them over)
	constructor( { sites = [], vfx = () => null, rng = Math.random, lights = null } = {} ) {

		this.sites = sites.map( ( s, i ) => ( { ...s, acc: rng(), id: 'chimney-' + i } ) );
		this.vfx = vfx;
		this.rng = rng;
		this.puffs = 0;
		this.lights = lights || makeGlowLights();

	}

	update( dt, { camera = null, hour = 12, kind = 'clear', fog = 0, night = 0 } = {} ) {

		const cam = camera && camera.position ? camera.position : null;
		const rate = smokeRate( hour, kind );
		const v = this.vfx();
		const near = [];
		for ( const s of this.sites ) {

			const d = cam ? Math.hypot( s.x - cam.x, s.z - cam.z ) : 0;
			near.push( { s, d } );
			if ( d > SMOKE_RANGE || ! v || typeof v.smoke !== 'function' ) continue;
			s.acc += dt * rate;
			while ( s.acc >= 1 ) {

				s.acc -= 1;
				// a soft puff straight up (the VFX set's wind carries it); a little stronger in the morning damp
				try { v.smoke( s.x + ( this.rng() - 0.5 ) * 0.2, s.y, s.z + ( this.rng() - 0.5 ) * 0.2, 0.22 + 0.1 * this.rng(), 0, 1, 0 ); } catch ( e ) { /* the VFX set is optional */ }
				this.puffs ++;

			}

		}

		// the glow: the nearest stacks, at night and in fog
		near.sort( ( a, b ) => a.d - b.d );
		const glow = clamp( Math.max( night, fog * 0.8 ), 0, 1 );
		this.lights.forEach( ( l, i ) => {

			const n = near[ i ];
			l.enabled = !! n && glow > 0.05 && n.d < SMOKE_RANGE;
			if ( ! n ) return;
			l.position.set( n.s.x, n.s.y + 0.3, n.s.z );
			l.intensity = 2.5 * glow;

		} );

	}

}
