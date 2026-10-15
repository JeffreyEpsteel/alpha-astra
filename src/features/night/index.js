import { Vector3, Color } from '../../engine/index.js';
import { G } from '../../core/Globals.js';
import { Glow, HALO, POOL, SPRITE, FLOAT, STREAK } from './Glow.js';
import { Plankton, MAX_STIR } from './Plankton.js';
import {
	clamp, smooth, nightFromHour, lampsOn, phaseOf, ease, hash01, fireflyBlink, beamFacing, planktonFlash,
	isLowPreset, BUDGET, nearest, packDisturbances,
} from './NightCurve.js';

// Night as Hyptile Island's identity: bioluminescent plankton wherever the water is stirred (wakes, moving
// hulls, the bobber and the bites, the reef's surf, splashes), halos on every lamp (docks, stalls, Roid's yard,
// the boat's running lights), running lights on the ships at sea, the Gull Rock lighthouse's flash and the
// light its beams lay on the water, fireflies over the vegetation by the paths, moon glints and a lantern on
// the bobber. Two draws (Plankton, Glow); hidden and idle in daylight.
//
//   features.add( 'night', night );   const n = features.get( 'night' );
//   n.nightFactor        0 day .. 1 deep night (eased; the sky's G.night, or the clock when the sky is absent)
//   n.phase              'day' | 'dusk' | 'night' | 'dawn'      n.lamps  0..1 the lamps' ramp
//   n.isNight()          nightFactor > 0.5
//   n.stir( x, z, radius, strength = 1, seconds = 2 )   light the plankton somewhere for a while (fish, a jump)
//   n.addSwarm( x, z, y? )                              a firefly swarm (other islands' paths)
//   features.emit( 'nightPhase', { phase, previous, night } )   when the phase turns
//   lights[]             pooled local lights (the bobber's lantern, ships' masthead lights): installFeatures
//                        hands them to app.localLights; unused ones are disabled
// ?noNight turns the effects off (the factor and the events stay); the low preset (NightCurve.isLowPreset)
// draws fewer cells, halos and fireflies and lights only the bobber.

const WARM = [ 1.0, 0.72, 0.42 ];
const BEAM = [ 1.0, 0.86, 0.58 ];
const FIREFLY = [ 0.72, 1.0, 0.28 ];
const MOON = [ 0.72, 0.8, 1.0 ];
const SKIP_HALO = new Set( [ 'boatDome', 'boatInstruments', 'nightLamp' ] );
const HALO_KIND = { // radius m, radiance per unit of the lamp's intensity, cap
	lantern: [ 0.32, 0.45, 5 ], pathLight: [ 0.22, 0.5, 4 ], window: [ 0.55, 0.12, 0.8 ], boatNav: [ 0.16, 2.6, 4.5 ],
};
const SHIP_RANGE = 160; // m: ships whose hulls stir the plankton
const BEAM_LEN = 170; // GullRock's beam length

export function install( app, features ) {

	return new Night( app, features );

}

export class Night {

	constructor( app, features ) {

		this.app = app || {};
		this.features = features || null;
		this.low = isLowPreset( app );
		this.budget = this.low ? BUDGET.low : BUDGET.normal;
		this.nightFactor = this._target();
		this.lamps = lampsOn( this.nightFactor );
		this.phase = phaseOf( this._hours() );
		this.t = 0;
		this.active = false;
		this.glow = null;
		this.plankton = null;
		this.swarms = null; // built on the first night (the vegetation is read then)
		this._stirs = []; // transient stirrings { x, z, r, s, t, life }
		this._dist = []; // per-frame disturbance list (reused objects)
		this._distN = 0;
		this._prev = new Map(); // remote boats: last position (speed by difference)
		this._near = [];
		this._ships = [];
		this._off = [];

		const qs = this.app.qs;
		const off = !! ( qs && typeof qs.has === 'function' && qs.has( 'noNight' ) );
		const scene = this.app.scene;
		if ( ! off && scene && typeof scene.add === 'function' ) {

			const b = this.budget;
			try {

				this.glow = new Glow( { query: this.app.query, count: b.halos + b.fireflies + b.glints + 64 } );
				scene.add( this.glow.mesh );

			} catch ( e ) { console.warn( 'night: glow unavailable', e ); this.glow = null; }

			try {

				this.plankton = new Plankton( {
					query: this.app.query, wake: this.app.wake, shoreSim: this.app.shoreSim, shore: this.app.shore,
					terrain: this.app.terrainGPU, count: b.plankton, box: b.box,
				} );
				scene.add( this.plankton.mesh );

			} catch ( e ) { console.warn( 'night: plankton unavailable', e ); this.plankton = null; }

		}

		// pooled local lights: [ 0 ] the bobber's lantern, the rest masthead lights of the nearest ships
		this.lights = [];
		for ( let i = 0; i < Math.max( 1, this.budget.lights ); i ++ ) {

			this.lights.push( {
				position: new Vector3( 0, - 100, 0 ), color: i === 0 ? new Color( 1.0, 0.74, 0.45 ) : new Color( 1.0, 0.95, 0.85 ),
				intensity: i === 0 ? 1.1 : 2.2, range: i === 0 ? 4.5 : 14, kind: 'nightLamp', enabled: false, phase: i * 7.3,
			} );

		}

		// splashes stir the water for a few seconds
		if ( features && features.on ) {

			this._off.push( features.on( 'cannonballImpact', ( e ) => {

				if ( e && e.hit === 'water' ) this.stir( e.x, e.z, 2.5 + Math.min( 4, ( e.energy || 1 ) * 0.5 ), 1.6, 2.5 );

			} ) );
			this._off.push( features.on( 'explosion', ( e ) => { if ( e ) this.stir( e.x, e.z, ( e.radius || 4 ) * 1.2, 1.4, 3 ); } ) );
			this._off.push( features.on( 'shipSunk', ( e ) => { if ( e ) this.stir( e.x, e.z, 12, 1.2, 8 ); } ) );
			this._off.push( features.on( 'fishCaught', () => {

				const b = this._bobber();
				if ( b ) this.stir( b.x, b.z, 1.5, 1.5, 2 );

			} ) );

		}

	}

	// the low budget on / off at run time (core/Quality.js: the Low tier); the draw capacities were sized at install
	setLow( on ) {

		on = !! on;
		if ( on === this.low ) return;
		this.low = on;
		this.budget = on ? BUDGET.low : BUDGET.normal;

	}

	// ---- read

	isNight() { return this.nightFactor > 0.5; }

	_hours() {

		const s = this.app.settings;
		return s && Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;

	}

	// the sky's own night (App.updateSun writes G.night from the sun's depth); the clock when no sky runs
	_target() {

		const v = G && G.night ? G.night.value : NaN;
		if ( this.app.sky || this.app.atmosphere ) return Number.isFinite( v ) ? clamp( v, 0, 1 ) : 0;
		return nightFromHour( this._hours() );

	}

	// ---- write

	stir( x, z, r = 1, s = 1, seconds = 2 ) {

		if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return;
		if ( this._stirs.length >= 24 ) this._stirs.shift();
		this._stirs.push( { x, z, r: Math.max( 0.2, r ), s, t: 0, life: Math.max( 0.1, seconds ) } );

	}

	addSwarm( x, z, y = null ) {

		if ( ! this.swarms ) this._buildSwarms();
		const td = this.app.terrainData;
		const gy = Number.isFinite( y ) ? y : td && td.heightAt ? td.heightAt( x, z ) : 0;
		this.swarms.push( { x, z, y: gy, seed: this.swarms.length * 13.7 + 3.1 } );

	}

	// ---- per frame

	update( dt ) {

		if ( ! ( dt > 0 ) ) dt = 0;
		this.t += dt;
		const target = this._target();
		this.nightFactor = Math.abs( target - this.nightFactor ) > 0.25 ? target : ease( this.nightFactor, target, dt, 0.4 );
		const night = this.nightFactor;
		this.lamps = lampsOn( night );
		const phase = phaseOf( this._hours() );
		if ( phase !== this.phase ) {

			const previous = this.phase;
			this.phase = phase;
			if ( this.features && this.features.emit ) this.features.emit( 'nightPhase', { phase, previous, night } );

		}

		for ( let i = this._stirs.length - 1; i >= 0; i -- ) {

			const s = this._stirs[ i ];
			s.t += dt;
			if ( s.t >= s.life ) this._stirs.splice( i, 1 );

		}

		// daylight: hidden, nothing else is done
		if ( night < 0.01 ) {

			if ( this.active ) this._sleep();
			return;

		}

		this.active = true;
		const cam = this.app.camera;
		if ( ! cam || ! cam.position ) return;
		if ( ! this.swarms ) this._buildSwarms();
		this._collect();
		this._lastDt = dt;
		this._updatePlankton( dt, cam, night );
		this._updateGlow( cam, night );
		this._updateLights( night );

	}

	_sleep() {

		this.active = false;
		if ( this.glow ) this.glow.hide();
		if ( this.plankton ) this.plankton.hide();
		for ( const l of this.lights ) l.enabled = false;

	}

	// ---- what stirs the water: hulls, the bobber, a swimmer, splashes

	_push( x, z, r, s ) {

		if ( ! ( s > 0.001 ) || ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return;
		let d = this._dist[ this._distN ];
		if ( ! d ) d = this._dist[ this._distN ] = { x: 0, z: 0, r: 1, s: 0 };
		d.x = x; d.z = z; d.r = r; d.s = s;
		this._distN ++;

	}

	_bobber() {

		const rod = this.app.game && this.app.game.rod;
		if ( ! rod || ! rod.bobber || ( rod.state !== 'floating' && rod.state !== 'fighting' ) ) return null;
		return rod.bobber;

	}

	_collect() {

		this._distN = 0;
		const app = this.app;
		const bc = app.boatCtl;
		if ( bc && bc.position && bc.enabled !== false ) {

			const v = bc.velocity ? Math.hypot( bc.velocity.x, bc.velocity.z ) : bc.speed || 0;
			if ( v > 0.3 ) this._push( bc.position.x, bc.position.z, 2.6 + Math.min( 2, v * 0.15 ), Math.min( 1.2, v / 4 ) );

		}

		// ships of the naval feature
		const cp = app.camera.position;
		this._ships.length = 0;
		const nv = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		for ( const sh of ( nv && nv.ships ) || [] ) {

			if ( ! sh || ! Number.isFinite( sh.x ) || sh.state === 'gone' ) continue;
			const d = Math.hypot( sh.x - cp.x, sh.z - cp.z );
			if ( d > this.budget.haloRange ) continue;
			this._ships.push( sh );
			if ( d < SHIP_RANGE ) {

				const len = ( sh.cls && sh.cls.length ) || 14;
				const sp = Math.abs( sh.speed || 0 );
				if ( sp > 0.3 ) this._push( sh.x, sh.z, len * 0.55, Math.min( 1.2, sp / 4 ) );
				if ( sh.state === 'sinking' ) this._push( sh.x, sh.z, len * 0.7, 1.2 );

			}

		}

		// other players' boats (speed from the change of position)
		const rp = app.remotePlayers;
		if ( rp && rp.peers && rp.peers.forEach ) {

			const dt = Math.max( 1e-3, this._lastDt || 1 / 60 );
			rp.peers.forEach( ( p, id ) => {

				if ( ! p || ! p.boat || ! p.boatPos || ! p.hasPose ) return;
				const q = p.boatPos, last = this._prev.get( id );
				const v = last ? Math.hypot( q.x - last.x, q.z - last.z ) / dt : 0;
				if ( last ) { last.x = q.x; last.z = q.z; } else this._prev.set( id, { x: q.x, z: q.z } );
				if ( v > 0.3 && v < 40 ) this._push( q.x, q.z, 3, Math.min( 1.2, v / 4 ) );

			} );

		}

		// the bobber: a faint ring while it floats, brighter when a fish noses it, a burst on the take and the fight
		const b = this._bobber();
		if ( b ) {

			const g = app.game, bite = g.bite, fight = g.fight;
			let r = 0.55, s = 0.22;
			if ( bite && bite.phase === 'nibble' ) { r = 0.8; s = 0.6; }
			if ( bite && bite.phase === 'take' ) { r = 1.2; s = 1.3; }
			if ( fight ) { r = 1.0 + Math.min( 1.5, Math.abs( fight.surge || 0 ) ); s = 1.2; }
			this._push( b.x, b.z, r, s );

		}

		const p = app.player;
		if ( p && p.mode === 'swim' && p.position ) this._push( p.position.x, p.position.z, 1.1, 0.7 );
		for ( const s of this._stirs ) this._push( s.x, s.z, s.r, s.s * ( 1 - s.t / s.life ) );
		for ( let i = this._distN; i < this._dist.length; i ++ ) this._dist[ i ].s = 0; // (stale entries are skipped)

	}

	// ---- plankton

	_updatePlankton( dt, cam, night ) {

		const pk = this.plankton;
		if ( ! pk ) return;
		packDisturbances( this._dist, cam.position.x, cam.position.z, MAX_STIR, pk.stir );
		const wd = G.windDir ? G.windDir.value : null, ws = G.windSpeed ? G.windSpeed.value : 0;
		const drift = this._drift || ( this._drift = { x: 0, y: 0 } );
		drift.x = wd ? wd.x * ws * 0.03 : 0;
		drift.y = wd ? wd.y * ws * 0.03 : 0;
		pk.update( dt, cam, {
			strength: smooth( night, 0.25, 0.8 ),
			count: this.budget.plankton,
			box: this.budget.box,
			windDrift: drift,
			waterHeight: Number.isFinite( this.app.cameraWaterHeight ) ? this.app.cameraWaterHeight : 0,
		} );

	}

	// ---- glows

	_updateGlow( cam, night ) {

		const gl = this.glow;
		if ( ! gl ) return;
		const app = this.app, cp = cam.position, t = this.t, b = this.budget;
		const td = app.terrainData;
		const ground = ( x, z ) => ( td && td.heightAt ? td.heightAt( x, z ) : - 10 );
		gl.begin();

		// lamps of the scene (village, ports, stalls, Roid's yard, the boat's running lights)
		const LL = app.localLights;
		const lamp = this.lamps * ( LL && Number.isFinite( LL.strength ) ? LL.strength : 1 );
		const gull = app.ports && app.ports.gull;
		if ( LL && LL.sources && LL.enabled !== false && lamp > 0.002 ) {

			const cands = this._cands || ( this._cands = [] );
			cands.length = 0;
			for ( const s of LL.sources ) if ( s && s.position && s.enabled !== false && ! SKIP_HALO.has( s.kind ) && s !== ( gull && gull.lampLight ) ) cands.push( s );
			const pick = nearest( cands, cp.x, cp.z, b.halos, b.haloRange, this._near );
			for ( const s of pick ) {

				const [ rad, k, cap ] = HALO_KIND[ s.kind ] || HALO_KIND.lantern;
				const flick = s.flicker ? 1 + s.flicker * Math.sin( t * 9 + ( s.phase || 0 ) ) * Math.sin( t * 5.3 + ( s.phase || 0 ) * 0.37 ) : 1;
				const e = Math.min( cap, ( s.intensity || 1 ) * k * ( s.scale ?? 1 ) ) * lamp * flick;
				const c = s.color || { r: WARM[ 0 ], g: WARM[ 1 ], b: WARM[ 2 ] };
				gl.push( s.position.x, s.position.y, s.position.z, rad, c.r * e, c.g * e, c.b * e, HALO );
				// a lamp over the water lays a warm pool on it (static lamps: the ground is read once)
				if ( ! s.update && s.kind !== 'window' ) {

					if ( s._nightWater === undefined ) s._nightWater = ground( s.position.x, s.position.z ) < - 0.3 && s.position.y < 9;
					if ( s._nightWater ) {

						const h = Math.max( 0.5, s.position.y );
						const pe = e * 0.05;
						gl.push( s.position.x, 0, s.position.z, 1.2 + h * 0.35, c.r * pe, c.g * pe, c.b * pe, POOL );

					}

				}

			}

		}

		// the ships' running lights: masthead white, red to port, green to starboard, stern white
		for ( const sh of this._ships ) {

			if ( ! sh.alive && sh.alive !== undefined ) continue;
			const cls = sh.cls || {};
			const y0 = ( sh.pose && Number.isFinite( sh.pose.y ) ? sh.pose.y : 0 );
			const fx = Math.sin( sh.yaw || 0 ), fz = Math.cos( sh.yaw || 0 ); // bow
			const rx = fz, rz = - fx; // starboard (bow turned clockwise seen from above)
			const half = ( cls.length || 14 ) * 0.5, bm = ( cls.beam || 5 ) * 0.5, sheer = cls.sheer || 3;
			const e = lamp * 3.2;
			gl.push( sh.x + fx * half * 0.2, y0 + ( cls.mast || 10 ) + 0.3, sh.z + fz * half * 0.2, 0.22, e, e * 0.95, e * 0.85, HALO );
			gl.push( sh.x - rx * bm + fx * half * 0.3, y0 + sheer, sh.z - rz * bm + fz * half * 0.3, 0.18, e, e * 0.06, e * 0.03, HALO );
			gl.push( sh.x + rx * bm + fx * half * 0.3, y0 + sheer, sh.z + rz * bm + fz * half * 0.3, 0.18, e * 0.05, e, e * 0.3, HALO );
			gl.push( sh.x - fx * half, y0 + sheer + 0.4, sh.z - fz * half, 0.16, e * 0.8, e * 0.76, e * 0.68, HALO );

		}

		// the Gull Rock lighthouse: a steady lamp, a flash when a beam sweeps over you, light lying on the water
		if ( gull && gull.lighthouse && gull.beams ) {

			const L = gull.lighthouse;
			const ly = Number.isFinite( gull._y ) ? gull._y : L.lampY;
			const on = smooth( night, 0.1, 0.7 );
			const a = gull.beams.rotation ? gull.beams.rotation.y : 0;
			const face = beamFacing( a, cp.x - L.x, cp.z - L.z, 220 );
			const pulse = 0.88 + 0.12 * Math.sin( t * 1.9 );
			let e = 3.2 * on * pulse;
			gl.push( L.x, ly, L.z, 1.9, BEAM[ 0 ] * e, BEAM[ 1 ] * e, BEAM[ 2 ] * e, HALO );
			if ( face > 0.01 ) {

				e = 22 * face * on;
				gl.push( L.x, ly, L.z, 3 + 9 * face, BEAM[ 0 ] * e, BEAM[ 1 ] * e, BEAM[ 2 ] * e, HALO );

			}

			if ( gull.beams.visible !== false ) for ( const ang of [ a, a + Math.PI ] ) {

				const dx = Math.cos( ang ), dz = - Math.sin( ang );
				const sa = Math.atan2( dz, dx ); // the streak's angle in x / z (Glow reads it from y: kept in -PI..PI)
				for ( let d = 22; d < BEAM_LEN; d += 24 ) {

					const x = L.x + dx * d, z = L.z + dz * d;
					if ( ground( x, z ) > - 0.4 ) continue;
					const f = 1 - d / BEAM_LEN;
					const se = 0.3 * f * on;
					gl.push( x, sa, z, 2.2 + d * 0.055, BEAM[ 0 ] * se, BEAM[ 1 ] * se, BEAM[ 2 ] * se, STREAK );

				}

			}

		}

		// the bobber's lantern: a warm glint riding the swell, a little pool round it; dipped when a fish takes it
		const bob = this._bobber();
		if ( bob ) {

			const bite = app.game.bite;
			const under = bite && bite.phase === 'take' ? 0.35 : 1;
			const e = 2.6 * this.lamps * under * ( 0.93 + 0.07 * Math.sin( t * 6.1 ) );
			gl.push( bob.x, 0.12, bob.z, 0.09, WARM[ 0 ] * e, WARM[ 1 ] * e, WARM[ 2 ] * e, FLOAT );
			const pe = e * 0.06;
			gl.push( bob.x, 0, bob.z, 0.9, WARM[ 0 ] * pe, WARM[ 1 ] * pe, WARM[ 2 ] * pe, POOL );

		}

		// fireflies over the vegetation by the paths (not in the rain)
		const wx = this.features && this.features.get ? this.features.get( 'weather' ) : null;
		const rain = wx ? clamp( ( wx.rainIntensity ?? ( wx.current && wx.current.rain ) ) || 0, 0, 1 ) : 0;
		const ff = smooth( night, 0.45, 0.9 ) * ( 1 - rain );
		if ( ff > 0.01 && this.swarms.length ) {

			const per = Math.max( 1, Math.floor( b.fireflies / b.swarms ) );
			for ( const sw of nearest( this.swarms, cp.x, cp.z, b.swarms, 140, this._near ) ) {

				const fade = ff * smooth( Math.sqrt( sw._d2 ), 140, 90 );
				if ( fade < 0.01 ) continue;
				for ( let j = 0; j < per; j ++ ) {

					const sd = sw.seed * 7.31 + j * 1.618;
					const h1 = hash01( sd ), h2 = hash01( sd + 4.2 ), h3 = hash01( sd + 9.7 );
					const x = sw.x + Math.sin( t * ( 0.21 + 0.2 * h1 ) + h2 * 6.28 ) * ( 1.5 + 2.5 * h3 );
					const z = sw.z + Math.cos( t * ( 0.17 + 0.2 * h2 ) + h3 * 6.28 ) * ( 1.5 + 2.5 * h1 );
					const y = sw.y + 0.5 + 1.8 * h2 + 0.35 * Math.sin( t * ( 0.5 + h3 ) + h1 * 6.28 );
					const e = 20 * fireflyBlink( t, sd ) * fade; // (a point light: the sprite keeps its energy when it grows to 2.5 px)
					if ( ! gl.push( x, y, z, 0.035, FIREFLY[ 0 ] * e, FIREFLY[ 1 ] * e, FIREFLY[ 2 ] * e, SPRITE ) ) break;

				}

			}

		}

		// moon glints: sparkles on the water along the moon's reflection (G.sunDir is the moon at night)
		const md = G.sunDir ? G.sunDir.value : null;
		const above = Number.isFinite( app.cameraWaterHeight ) ? cp.y - app.cameraWaterHeight : cp.y;
		if ( md && md.y > 0.05 && night > 0.5 && above > 0.3 ) {

			const hl = Math.hypot( md.x, md.z );
			if ( hl > 1e-3 ) {

				const ux = md.x / hl, uz = md.z / hl;
				const d0 = clamp( above * hl / md.y, 8, 260 );
				const slot = Math.floor( t * 3 );
				const k = smooth( night, 0.5, 0.9 ) * 1.6;
				for ( let i = 0; i < b.glints; i ++ ) {

					const sd = slot * 17.3 + i * 3.11;
					const d = d0 * ( 0.45 + 1.6 * hash01( sd ) );
					const lat = ( hash01( sd + 1.7 ) - 0.5 ) * d * 0.12;
					const x = cp.x + ux * d - uz * lat, z = cp.z + uz * d + ux * lat;
					if ( ground( x, z ) > - 0.5 ) continue;
					const e = k * planktonFlash( t * 1.7, sd );
					gl.push( x, 0.02, z, 0.05 + d * 0.0012, MOON[ 0 ] * e, MOON[ 1 ] * e, MOON[ 2 ] * e, FLOAT );

				}

			}

		}

		gl.end();

	}

	// ---- local lights: the bobber's lantern, the masthead lights of the nearest ships

	_updateLights( night ) {

		const L = this.lights;
		const bob = this._bobber();
		const on = this.lamps > 0.01;
		const b0 = L[ 0 ];
		b0.enabled = !! ( bob && on );
		if ( b0.enabled ) b0.position.set( bob.x, ( Number.isFinite( bob.y ) ? bob.y : 0 ) + 0.35, bob.z );
		const cp = this.app.camera.position;
		const n = Math.min( L.length, Math.max( 1, this.budget.lights ) ); // (the budget may have dropped since: setLow)
		const ships = nearest( this._ships, cp.x, cp.z, n - 1, 120, this._nearShips || ( this._nearShips = [] ) );
		for ( let i = n; i < L.length; i ++ ) L[ i ].enabled = false;
		for ( let i = 1; i < n; i ++ ) {

			const sh = ships[ i - 1 ], l = L[ i ];
			l.enabled = !! ( sh && on && sh.state !== 'sinking' );
			if ( ! l.enabled ) continue;
			const cls = sh.cls || {};
			const y0 = sh.pose && Number.isFinite( sh.pose.y ) ? sh.pose.y : 0;
			l.position.set( sh.x, y0 + ( cls.mast || 10 ) + 0.3, sh.z );

		}

	}

	// ---- firefly swarms: shrubs and bananas by the village's paths and near land lanterns

	_buildSwarms() {

		const out = this.swarms = [];
		const app = this.app;
		const td = app.terrainData;
		const heightAt = ( x, z ) => ( td && td.heightAt ? td.heightAt( x, z ) : 0 );
		const anchors = [];
		const v = app.village;
		for ( const p of v ? [ v.path, ...( v.sidePaths || [] ) ] : [] ) {

			if ( ! p || ! p.samples ) continue;
			for ( let i = 0; i < p.samples.length; i += 4 ) {

				const q = p.samples[ i ].p;
				if ( q ) anchors.push( q.x, q.z );

			}

		}

		for ( const s of ( app.localLights && app.localLights.sources ) || [] ) {

			if ( s && s.kind === 'lantern' && s.position && ! s.update && heightAt( s.position.x, s.position.z ) > 0.5 ) anchors.push( s.position.x, s.position.z );

		}

		const nearAnchor = ( x, z, r ) => {

			for ( let i = 0; i < anchors.length; i += 2 ) if ( ( anchors[ i ] - x ) ** 2 + ( anchors[ i + 1 ] - z ) ** 2 < r * r ) return true;
			return false;

		};

		const spaced = ( x, z ) => out.every( ( s ) => ( s.x - x ) ** 2 + ( s.z - z ) ** 2 > 144 );
		const recs = app.vegetation && app.vegetation.records;
		const cap = this.low ? 30 : 80;
		if ( recs ) for ( const key of [ 'shrubs', 'bananas', 'heliconias', 'elephantEars', 'ferns' ] ) {

			for ( const r of recs[ key ] || [] ) {

				if ( out.length >= cap ) break;
				if ( ! Number.isFinite( r.x ) || ! nearAnchor( r.x, r.z, 22 ) || ! spaced( r.x, r.z ) ) continue;
				out.push( { x: r.x, z: r.z, y: Number.isFinite( r.y ) ? r.y : heightAt( r.x, r.z ), seed: out.length * 13.7 + 3.1 } );

			}

		}

		// no vegetation records: beside the paths themselves
		if ( ! out.length ) for ( let i = 0; i < anchors.length && out.length < cap; i += 2 ) {

			const side = ( i / 2 ) % 2 ? 3.5 : - 3.5;
			const x = anchors[ i ] + side, z = anchors[ i + 1 ] + side * 0.5;
			const y = heightAt( x, z );
			if ( y > 0.8 && spaced( x, z ) ) out.push( { x, z, y, seed: out.length * 13.7 + 3.1 } );

		}

		return out;

	}

	// ---- contract

	reset() {

		this._stirs.length = 0;

	}

	dispose() {

		for ( const off of this._off ) try { off(); } catch ( e ) { /* gone */ }
		this._off.length = 0;
		const scene = this.app.scene;
		for ( const m of [ this.glow, this.plankton ] ) if ( m && scene && scene.remove ) try { scene.remove( m.mesh ); } catch ( e ) { /* gone */ }
		if ( this.glow ) this.glow.dispose();
		if ( this.plankton ) this.plankton.dispose();
		this.glow = this.plankton = null;
		for ( const l of this.lights ) {

			l.enabled = false;
			if ( this.app.localLights && this.app.localLights.remove ) this.app.localLights.remove( l );

		}

	}

}
