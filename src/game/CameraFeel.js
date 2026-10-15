import * as THREE from '../engine/index.js';

// Camera feel: small, short camera touches on the fishing and combat beats, layered over whatever the player
// (or the free camera) set this frame. The App calls update( dt ) after player.update; the game calls
// kick( type, opts? ) on its events:
//   cast       the rod whips: +4° FOV for 0.3 s (fast in, eased out)
//   strike     "fish on": a 0.25 s shake
//   catch      the landing: an 80 ms hitstop (the camera holds still while the world runs on) and a
//              quick FOV pull-in that eases back
//   snap       the line parts (also a near miss): a shorter, sharper shake
//   recoil     the player's gun fires: the view kicks up ~0.6° and settles, a small FOV punch
//   hit        a blow taken (melee, a ball into the hull): a short hard shake
//   broadside  a heavy hit to the boat: a longer shake and a FOV pull-in
//   boarding   boarding starts: a 120 ms hitstop and a shake
//   explosion  opts { x, y, z, radius, energy }: a shake that fades with the distance to the camera
// Melee (wave 4, src/features/melee):
//   meleeHit   the player's blow lands: a 55 ms hitstop and a small sharp shake
//   meleeHeavy a punish or a finishing blow: a 90 ms hitstop, a FOV pull-in and a shake
//   parry      a clean parry: a 110 ms hitstop and a FOV pull (no shake: the moment reads as control)
//   meleeHurt  a blow taken on foot: a hard short shake and a small FOV punch outward
//   dodge      the evade: a quick FOV push (no shake)
// opts.scale (0..2) scales any kick. Each kick also rumbles the gamepad (app.gamepad.rumble, core/Gamepad.js).
// Sailing: the FOV opens a few degrees with boat speed (0 at rest, +5° flat out) for a sense of speed.
// The base FOV is the settings slider (app.ui.s.fov, else the camera's own); the camera's fov is only
// written while something is active and put back to the base after, so the slider stays in charge.
// app.settings.reduceMotion turns the shakes, the recoil tilt and the sailing FOV off (the FOV kicks and hitstops
// stay, they are mild); app.settings.cameraShake (0..1) scales the shakes.
// The combat events of the feature registry are followed by themselves once app.features exists (update binds them):
// cannonFired { by: 'player' } -> recoil, playerBoatDamaged -> hit / broadside, boardingStarted -> boarding,
// playerKnockedDown -> hit, explosion -> explosion.
const CAST_FOV = 4, CAST_T = 0.3;
const STRIKE_T = 0.25, STRIKE_AMP = 0.011; // rad
const CATCH_HOLD = 0.08, CATCH_FOV = - 3, CATCH_T = 0.22;
const SNAP_T = 0.18, SNAP_AMP = 0.016;
const SAIL_FOV = 5;
const RECOIL_ANG = 0.0105, RECOIL_T = 0.32, RECOIL_FOV = 1.5; // rad, s, degrees
const HIT_T = 0.22, HIT_AMP = 0.018;
const BROAD_T = 0.45, BROAD_AMP = 0.026, BROAD_FOV = - 2.5;
const BOARD_HOLD = 0.12, BOARD_T = 0.3, BOARD_AMP = 0.014;
const BLAST_AMP = 0.03; // at the blast itself; fades to 0 at radius * 4 (60 m at most)
const BROADSIDE_HP = 0.12; // a hit taking this share of the hull (or more) is a broadside kick
const MHIT_HOLD = 0.055, MHIT_AMP = 0.006, MHIT_T = 0.12;
const MHEAVY_HOLD = 0.09, MHEAVY_FOV = - 2.2, MHEAVY_T = 0.24, MHEAVY_AMP = 0.01;
const PARRY_HOLD = 0.11, PARRY_FOV = - 3, PARRY_T = 0.3;
const MHURT_AMP = 0.02, MHURT_T = 0.2, MHURT_FOV = 1.6;
const DODGE_FOV = 2.2, DODGE_T = 0.22;
const RUMBLE_OF = {
	strike: 'strike', catch: 'catch', snap: 'snap', recoil: 'cannon', hit: 'hit', broadside: 'broadside', boarding: 'boarding', explosion: 'explosion',
	meleeHit: 'snap', meleeHeavy: 'catch', parry: 'catch', meleeHurt: 'hit',
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export class CameraFeel {

	constructor( app ) {

		this.app = app;
		this.fovKick = 0; // degrees added to the base fov right now
		this._kicks = []; // { amount, t, dur } fov kicks
		this._shake = null; // { amp, t, dur, seed }
		this._hold = null; // { t, pos, quat, dur }
		this._recoil = null; // { t, amp }
		this._bound = null; // the feature registry whose events are followed
		this._offs = [];
		this._lastHp = null;
		this._sail = 0; // smoothed sailing fov
		this._applied = null; // the fov we last wrote (null: the camera is on its base)
		this._time = 0;

	}

	get reduceMotion() {

		const s = this.app && this.app.settings;
		return !! ( s && s.reduceMotion );

	}

	// the accessibility shake slider (0..1, default 1)
	get shakeScale() {

		const s = this.app && this.app.settings;
		const v = s && Number.isFinite( s.cameraShake ) ? s.cameraShake : 1;
		return Math.max( 0, Math.min( 1, v ) );

	}

	// see the header for the types; returns false for an unknown one
	kick( type, opts = {} ) {

		const k = Math.max( 0, Math.min( 2, Number.isFinite( opts && opts.scale ) ? opts.scale : 1 ) );
		let rumble = k;
		switch ( type ) {

			case 'cast':
				this._kicks.push( { amount: CAST_FOV * k, t: 0, dur: CAST_T } );
				rumble = 0;
				break;
			case 'strike':
				this._startShake( STRIKE_AMP * k, STRIKE_T );
				break;
			case 'catch':
				this._hold = { t: 0, pos: null, quat: null, dur: CATCH_HOLD };
				this._kicks.push( { amount: CATCH_FOV * k, t: 0, dur: CATCH_T } );
				break;
			case 'snap':
				this._startShake( SNAP_AMP * k, SNAP_T );
				break;
			case 'recoil':
				if ( ! this.reduceMotion ) this._recoil = { t: 0, amp: RECOIL_ANG * k };
				this._kicks.push( { amount: RECOIL_FOV * k, t: 0, dur: RECOIL_T } );
				break;
			case 'hit':
				this._startShake( HIT_AMP * k, HIT_T );
				break;
			case 'broadside':
				this._startShake( BROAD_AMP * k, BROAD_T );
				this._kicks.push( { amount: BROAD_FOV * k, t: 0, dur: BROAD_T } );
				break;
			case 'boarding':
				this._hold = { t: 0, pos: null, quat: null, dur: BOARD_HOLD };
				this._startShake( BOARD_AMP * k, BOARD_T );
				break;
			case 'meleeHit':
				this._hold = { t: 0, pos: null, quat: null, dur: MHIT_HOLD };
				this._startShake( MHIT_AMP * k, MHIT_T );
				rumble = k * 0.5;
				break;
			case 'meleeHeavy':
				this._hold = { t: 0, pos: null, quat: null, dur: MHEAVY_HOLD };
				this._kicks.push( { amount: MHEAVY_FOV * k, t: 0, dur: MHEAVY_T } );
				this._startShake( MHEAVY_AMP * k, MHEAVY_T );
				break;
			case 'parry':
				this._hold = { t: 0, pos: null, quat: null, dur: PARRY_HOLD };
				this._kicks.push( { amount: PARRY_FOV * k, t: 0, dur: PARRY_T } );
				break;
			case 'meleeHurt':
				this._startShake( MHURT_AMP * k, MHURT_T );
				this._kicks.push( { amount: MHURT_FOV * k, t: 0, dur: MHURT_T } );
				break;
			case 'dodge':
				this._kicks.push( { amount: DODGE_FOV * k, t: 0, dur: DODGE_T } );
				rumble = 0;
				break;
			case 'explosion': {

				const f = this._blastFalloff( opts );
				if ( f <= 0 ) return true;
				this._startShake( BLAST_AMP * f * k, 0.3 + 0.4 * f );
				rumble = f * k;
				break;

			}

			default:
				return false;

		}

		const gp = this.app && this.app.gamepad;
		if ( rumble > 0 && gp && typeof gp.rumble === 'function' ) gp.rumble( RUMBLE_OF[ type ], Math.min( 1, rumble ) );
		return true;

	}

	// 1 at the blast, 0 at radius * 4 (60 m at most) from the camera
	_blastFalloff( o ) {

		const cam = this.app && this.app.camera;
		if ( ! o || ! cam || ! Number.isFinite( o.x ) || ! Number.isFinite( o.z ) ) return 0;
		const r = Math.max( 4, Number.isFinite( o.radius ) ? o.radius : 6 );
		const reach = Math.min( 60, r * 4 );
		const p = cam.position;
		const d = Math.hypot( p.x - o.x, ( p.y - ( o.y || 0 ) ) * 0.5, p.z - o.z );
		const f = Math.max( 0, 1 - d / reach );
		const e = Number.isFinite( o.energy ) ? Math.min( 1.5, 0.5 + o.energy / 2000 ) : 1;
		return Math.min( 1, f * f * e );

	}

	// the combat events of the feature registry (update calls this once app.features exists)
	bindFeatures( features ) {

		if ( ! features || typeof features.on !== 'function' || this._bound === features ) return;
		this.unbindFeatures();
		this._bound = features;
		const on = ( n, fn ) => this._offs.push( features.on( n, fn ) );
		on( 'cannonFired', ( e ) => { if ( e && e.by === 'player' ) this.kick( 'recoil' ); } );
		on( 'playerBoatDamaged', ( e ) => {

			const hp = e && Number.isFinite( e.hp ) ? e.hp : null, max = e && e.maxHp > 0 ? e.maxHp : null;
			const prev = this._lastHp === null && hp !== null && max ? max : this._lastHp;
			this._lastHp = hp;
			const lost = hp !== null && prev !== null && max ? ( prev - hp ) / max : 0;
			this.kick( lost >= BROADSIDE_HP ? 'broadside' : 'hit' );

		} );
		on( 'boardingStarted', () => this.kick( 'boarding' ) );
		on( 'playerKnockedDown', () => this.kick( 'hit' ) );
		on( 'explosion', ( e ) => this.kick( 'explosion', e || {} ) );

	}

	unbindFeatures() {

		for ( const off of this._offs ) if ( typeof off === 'function' ) off();
		this._offs = [];
		this._bound = null;

	}

	_startShake( amp, dur ) {

		amp *= this.shakeScale;
		if ( this.reduceMotion || ! ( amp > 0 ) ) return;
		if ( this._shake && this._shake.amp * ( 1 - this._shake.t / this._shake.dur ) > amp ) return; // a bigger one is running
		this._shake = { amp, t: 0, dur, seed: Math.random() * 1000 };

	}

	get active() {

		return this._kicks.length > 0 || !! this._shake || !! this._hold || !! this._recoil || this._sail > 0.01;

	}

	// base fov: the settings slider, else the camera's own
	baseFov() {

		const ui = this.app.ui;
		const v = ui && ui.s && Number.isFinite( ui.s.fov ) ? ui.s.fov : null;
		if ( v !== null ) return v;
		return this._applied === null && this.app.camera ? this.app.camera.fov : 60;

	}

	update( dt ) {

		const app = this.app, cam = app.camera;
		if ( app.features && this._bound !== app.features ) this.bindFeatures( app.features );
		if ( ! cam ) return;
		dt = Math.max( 0, Math.min( 0.1, dt || 0 ) );
		this._time += dt;

		// hitstop: freeze the camera where it was when the catch landed, briefly
		const h = this._hold;
		if ( h ) {

			if ( ! h.pos ) {

				h.pos = cam.position.clone();
				h.quat = cam.quaternion.clone();

			} else {

				cam.position.copy( h.pos );
				cam.quaternion.copy( h.quat );

			}

			h.t += dt;
			if ( h.t >= ( h.dur || CATCH_HOLD ) ) this._hold = null;

		}

		// fov kicks: snap in, ease out
		let kick = 0;
		for ( let i = this._kicks.length - 1; i >= 0; i -- ) {

			const k = this._kicks[ i ];
			k.t += dt;
			const u = Math.min( 1, k.t / k.dur );
			kick += k.amount * ( 1 - u * u * ( 3 - 2 * u ) );
			if ( u >= 1 ) this._kicks.splice( i, 1 );

		}

		// sailing: the fov opens with boat speed
		const p = app.player, b = app.boatCtl;
		const sailing = ! this.reduceMotion && p && p.mode === 'boat' && b && Number.isFinite( b.speed );
		const sailTarget = sailing ? SAIL_FOV * smooth( 3, 12, Math.abs( b.speed ) ) : 0;
		this._sail += ( sailTarget - this._sail ) * ( 1 - Math.exp( - dt * 2.5 ) );
		if ( Math.abs( this._sail ) < 0.01 ) this._sail = 0;
		this.fovKick = kick + this._sail;

		const base = this.baseFov();
		if ( this.fovKick !== 0 ) {

			const fov = base + this.fovKick;
			if ( cam.fov !== fov ) {

				cam.fov = fov;
				cam.updateProjectionMatrix();

			}

			this._applied = fov;

		} else if ( this._applied !== null ) {

			// nothing active: hand the camera back to the slider's value
			if ( cam.fov !== base ) {

				cam.fov = base;
				cam.updateProjectionMatrix();

			}

			this._applied = null;

		}

		// recoil: the view kicks up fast and settles back (pitch about the camera's own x axis)
		const rc = this._recoil;
		if ( rc ) {

			rc.t += dt;
			const u = rc.t / RECOIL_T;
			if ( u >= 1 || this.reduceMotion ) this._recoil = null;
			else {

				const a = rc.amp * ( u < 0.15 ? u / 0.15 : Math.pow( 1 - ( u - 0.15 ) / 0.85, 2 ) );
				_e.set( a, 0, 0 );
				cam.quaternion.multiply( _q.setFromEuler( _e ) );

			}

		}

		// shake: decaying jitter after the player set the camera this frame
		const s = this._shake;
		if ( s ) {

			s.t += dt;
			const u = s.t / s.dur;
			if ( u >= 1 || this.reduceMotion ) this._shake = null;
			else {

				const a = s.amp * ( 1 - u ) * ( 1 - u );
				const t = this._time * 38 + s.seed;
				_e.set( a * Math.sin( t * 1.3 ), a * 0.7 * Math.sin( t * 1.9 + 1.1 ), a * 0.5 * Math.sin( t * 1.1 + 2.3 ) );
				cam.quaternion.multiply( _q.setFromEuler( _e ) );

			}

		}

	}

}

function smooth( a, b, x ) {

	const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

}
