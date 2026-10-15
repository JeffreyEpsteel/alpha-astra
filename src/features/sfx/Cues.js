// Event cues (wave 13C): the synthesised sounds of Synth.js played when something happens, each with its own rate limit.
//
//   cannonFired (by 'pirate', at a Blackwater battery)  battery_fire    a deeper report than a swivel gun, echoing in the caldera
//   explosion (by 'powder', or at a powder store)       powder_blast    the store going up
//   strongholdAlarm 'alarm'                             fort_bell       a hurried run of strikes; it keeps ringing every few
//                                                                       seconds while the alarm stands (stronghold.alarm.state)
//   stronghold.alarm.state calm -> spotted              watch_call      the watchtower's shouted call
//   blackFlagBought                                     black_flag      cloth, coins, a drum thump (in the head)
//   strongholdClaimed                                   claim           horns, a bell and a drum roll (in the head)
//   meleeHit during the practice fight                  sword_clack     the wooden swords (practiceStarted .. practiceEnded)
//   seaplane.chute opens (or planeBailedOut + 1.2 s)    canopy_snap     the canopy filling; then chute_creak while it hangs
//   seaplane wheels (Kestrel)                           a rumble that rises with the ground speed and a squeal under hard
//                                                       braking, at the plane (loops, built when the wheels first roll)
//
// pure: cueFor( name, event, state ) -> [ { cue, at?, ...options } ], wheelLevels( flight ). The Cues class owns the
// listeners, the rate limits (sfx.time) and the plane polling; `cues.counts[ cue ]` counts what started (tests).
// The Albatross's second engine belongs to PlaneAudio (src/features/seaplane): see the wave 13C report for the hook.

import { strongholdLayout } from '../../world/islands/stronghold/Layout.js';
import { CUES, noiseBuf, gainNode, filterNode } from './Synth.js';
import { clamp, num, smooth } from './util.js';

const BATTERY_REACH = 45; // m: a cannonFired this close to a battery's guns is the battery's
const POWDER_REACH = 30; // m: an explosion this close to a powder store is the store's

const layout = () => {

	try { return strongholdLayout(); } catch ( e ) { return null; }

};

const pt = ( e ) => ( e && Number.isFinite( e.x ) && Number.isFinite( e.z ) ? { x: e.x, y: num( e.y, 2 ), z: e.z } : null );

// the cues an event calls for. state: { practice } (the practice fight is on)
export function cueFor( name, e, state = {} ) {

	const L = layout();
	switch ( name ) {

		case 'cannonFired': {

			const p = pt( e );
			if ( ! p || ! L ) return [];
			for ( const b of L.batteries ) for ( const g of [ b, ...b.guns ] ) if ( Math.hypot( g.x - p.x, g.z - p.z ) < BATTERY_REACH ) return [ { cue: 'battery_fire', at: { x: p.x, y: Math.max( p.y, 8 ), z: p.z }, power: 1 } ];
			return [];

		}

		case 'explosion': {

			const p = pt( e );
			if ( ! p ) return [];
			const store = L && L.powder.find( ( s ) => Math.hypot( s.x - p.x, s.z - p.z ) < POWDER_REACH );
			if ( ( e && e.by === 'powder' ) || store ) return [ { cue: 'powder_blast', at: p } ];
			return [];

		}

		case 'strongholdAlarm':
			if ( ! e || e.state !== 'alarm' || ! L ) return [];
			return [ { cue: 'fort_bell', at: { x: L.tower.x, y: L.tower.h + 4, z: L.tower.z }, strikes: 8 } ];
		case 'blackFlagBought':
			return [ { cue: 'black_flag' } ];
		case 'strongholdClaimed':
			return [ { cue: 'claim' } ];
		case 'meleeHit':
			if ( ! state.practice ) return [];
			return pt( e ) ? [ { cue: 'sword_clack', at: pt( e ) } ] : [ { cue: 'sword_clack' } ];
		default:
			return [];

	}

}

// the land plane's ground sounds from its Flight: rolling (rises with the ground speed) and the brakes' squeal
export function wheelLevels( f ) {

	const none = { roll: 0, brake: 0, pitch: 900 };
	if ( ! f || ! f.geom || ! f.geom.wheels || f.airborne || f.onWater ) return none;
	const v = Math.abs( num( f.airspeed, 0 ) );
	const b = clamp( num( f.controls && f.controls.brake, 0 ), 0, 1 );
	return { roll: smooth( 0.4, 22, v ) * 0.9, brake: smooth( 0.35, 0.9, b ) * smooth( 3, 14, v ), pitch: 900 + v * 35 };

}

export class Cues {

	constructor( sfx ) {

		this.sfx = sfx;
		this.last = {}; // cue -> sfx.time of its last start
		this.counts = {};
		this.practice = false;
		this.snapAt = - 1; // sfx.time the canopy is due when the chute cannot be read
		this.chuteOpen = false;
		this.creakT = 3;
		this.alarmState = 'calm';
		this.alarmT = 0;
		this.wheels = { roll: 0, brake: 0, pitch: 900 };
		this.nodes = null;
		this.off = [];
		const f = sfx.features;
		if ( f && f.on ) {

			for ( const n of [ 'cannonFired', 'explosion', 'strongholdAlarm', 'blackFlagBought', 'strongholdClaimed', 'meleeHit' ] ) this.off.push( f.on( n, ( e ) => this.event( n, e ) ) );
			this.off.push( f.on( 'practiceStarted', () => { this.practice = true; } ) );
			this.off.push( f.on( 'practiceEnded', () => { this.practice = false; } ) );
			this.off.push( f.on( 'planeBailedOut', () => { this.snapAt = sfx.time + 1.2; } ) );

		}

	}

	_feature( name ) {

		const f = this.sfx.features;
		return f && f.get ? f.get( name ) : null;

	}

	// starts a cue unless it is inside its own rate limit
	trigger( cue, opts = {} ) {

		const info = CUES[ cue ];
		if ( ! info ) return null;
		const now = this.sfx.time;
		if ( cue in this.last && now - this.last[ cue ] < info.gap ) return null;
		const v = this.sfx.synth.play( cue, opts );
		if ( v ) {

			this.last[ cue ] = now;
			this.counts[ cue ] = ( this.counts[ cue ] || 0 ) + 1;

		}

		return v;

	}

	event( name, e ) {

		try {

			for ( const c of cueFor( name, e, { practice: this.practice } ) ) {

				const { cue, ...opts } = c;
				this.trigger( cue, opts );
				if ( cue === 'fort_bell' ) this.alarmT = 7;

			}

		} catch ( err ) { /* a missed cue is fine */ }

	}

	update( dt ) {

		this._stronghold( dt );
		this._chute( dt );
		this._wheels( dt );

	}

	// the alarm's state, read from the stronghold: the watch calls out, the bell keeps ringing while it stands
	_stronghold( dt ) {

		const sh = this._feature( 'stronghold' ), L = layout();
		const st = sh && sh.alarm && typeof sh.alarm.state === 'string' ? sh.alarm.state : 'calm';
		const prev = this.alarmState;
		this.alarmState = st;
		if ( ! L ) return;
		const tower = { x: L.tower.x, y: L.tower.h + 4, z: L.tower.z };
		if ( st === 'spotted' && prev === 'calm' ) this.trigger( 'watch_call', { at: tower } );
		if ( st === 'alarm' ) {

			this.alarmT -= dt;
			if ( this.alarmT <= 0 ) {

				this.alarmT = 7;
				this.trigger( 'fort_bell', { at: tower, strikes: 8 } );

			}

		} else this.alarmT = 0;

	}

	_chute( dt ) {

		const sp = this._feature( 'seaplane' ), c = sp && sp.chute;
		const open = !! ( c && c.state === 'open' );
		if ( open && ! this.chuteOpen ) {

			this.snapAt = - 1;
			this.creakT = 2.5;
			const p = c.position;
			this.trigger( 'canopy_snap', p ? { at: { x: p.x, y: p.y + 6, z: p.z } } : {} );

		} else if ( ! open && this.snapAt >= 0 && this.sfx.time >= this.snapAt ) {

			// the chute could not be read: the bail-out's timer stands in for the opening
			this.snapAt = - 1;
			if ( ! c ) this.trigger( 'canopy_snap', {} );

		}

		if ( open ) {

			this.creakT -= dt;
			if ( this.creakT <= 0 ) {

				this.creakT = 3 + Math.random() * 3;
				const p = c.position, v = c.velocity;
				const strain = clamp( v ? Math.abs( num( v.y, 0 ) ) / 6 + 0.25 : 0.5, 0.2, 1 );
				this.trigger( 'chute_creak', { strain, at: p ? { x: p.x, y: p.y + 4, z: p.z } : null } );

			}

		}

		this.chuteOpen = open;

	}

	_wheels() {

		const sp = this._feature( 'seaplane' ), f = sp && sp.flight;
		const w = this.wheels = wheelLevels( f );
		const pl = this.sfx.player, ctx = pl.ctx;
		if ( ! ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createBufferSource !== 'function' ) return;
		if ( ! this.nodes ) {

			if ( w.roll < 0.02 || ! pl.active ) return;
			this.nodes = this._buildWheels( ctx );
			if ( ! this.nodes ) return;

		}

		const n = this.nodes, t = num( ctx.currentTime, 0 ), on = pl.active && f && f.position;
		n.roll.gain.setTargetAtTime( on ? w.roll * 0.22 : 0, t, 0.12 );
		n.rollLp.frequency.setTargetAtTime( 120 + w.roll * 700, t, 0.15 );
		n.grit.gain.setTargetAtTime( on ? w.roll * 0.05 : 0, t, 0.12 );
		n.squeal.gain.setTargetAtTime( on ? w.brake * 0.05 : 0, t, 0.06 );
		n.osc.frequency.setTargetAtTime( w.pitch, t, 0.1 );
		if ( on && n.pan.positionX ) {

			n.pan.positionX.setTargetAtTime( f.position.x, t, 0.05 );
			n.pan.positionY.setTargetAtTime( f.position.y, t, 0.05 );
			n.pan.positionZ.setTargetAtTime( f.position.z, t, 0.05 );

		}

	}

	_buildWheels( ctx ) {

		try {

			const sink = this.sfx.player._sink( 'sfx' );
			if ( ! sink ) return null;
			const pan = ctx.createPanner();
			pan.panningModel = 'equalpower';
			pan.distanceModel = 'inverse';
			pan.refDistance = 10;
			pan.rolloffFactor = 1;
			pan.maxDistance = 600;
			pan.connect( sink.node );
			const loop = ( kind ) => {

				const s = ctx.createBufferSource();
				s.buffer = noiseBuf( ctx, kind );
				s.loop = true;
				s.start( 0, Math.random() * 1.5 );
				return s;

			};

			const rollSrc = loop( 'brown' ), rollLp = filterNode( ctx, 'lowpass', 120, 0.7 ), roll = gainNode( ctx, 0, pan );
			rollSrc.connect( rollLp );
			rollLp.connect( roll );
			const gritSrc = loop( 'white' ), gritBp = filterNode( ctx, 'bandpass', 900, 0.8 ), grit = gainNode( ctx, 0, pan );
			gritSrc.connect( gritBp );
			gritBp.connect( grit );
			const osc = ctx.createOscillator();
			osc.type = 'triangle';
			osc.frequency.value = 900;
			const squeal = gainNode( ctx, 0, pan );
			osc.connect( squeal );
			osc.start();
			return { pan, roll, rollLp, grit, squeal, osc, sources: [ rollSrc, gritSrc, osc ] };

		} catch ( e ) {

			return null;

		}

	}

	reset() {

		this.practice = false;
		this.snapAt = - 1;
		this.chuteOpen = false;
		this.alarmT = 0;
		this.alarmState = 'calm';

	}

	dispose() {

		for ( const f of this.off ) try { f(); } catch ( e ) { /* ignore */ }
		this.off.length = 0;
		const n = this.nodes;
		this.nodes = null;
		if ( n ) {

			for ( const s of n.sources ) try { s.stop(); } catch ( e ) { /* already stopped */ }
			try { n.pan.disconnect(); } catch ( e ) { /* gone */ }

		}

	}

}
