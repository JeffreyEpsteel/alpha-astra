// Ship ambience and combat sounds (NAVAL_BRIEF B2, WORLD_TRADE_PIRATES_BRIEF A6), from the boat controller and
// the naval feature events. Aboard means app.player.mode is 'deck', 'seat' or 'boat'.
//
//   rigging strain  sail boats only: creaking rope and canvas, more often and louder the harder the wind blows,
//                   the faster the boat sails and the more it heels (ambience volume)
//   hull groans     every boat: the planking working. A stress value rises with the roll rate and pitch rate
//                   (app.boatCtl.angular, in the frame of the hull) and jumps with every slam (boatCtl.onSlam, which
//                   is chained, never replaced); a groan plays when it is high enough, louder and more often the
//                   rougher it is, and after hull damage when the hull is below half
//   sail luffing    sail boats: the canvas flutters when the bow is within ~55 degrees of the wind (G.windDir is
//                   taken as the direction the wind blows towards) and the wind is up; louder the closer to head to wind
//   cannon reload   the clank when naval.reloadLeft[ side ] runs out (the swivel gun is ready again), at the boat;
//                   also on the feature event 'cannonReloaded' { x?, y?, z? }
//   splinters       features 'playerBoatDamaged': wood tearing at the boat, louder with the size of the hit
// Sail boats: a Boats.js entry with sail: true or rig: 'sail', or one of SAIL_BOATS (the cutter and the ship classes).

import { BOATS } from '../../game/Boats.js';
import { G } from '../../core/Globals.js';
import { clamp, lerp, num, smooth, rotate } from './util.js';

export const SAIL_BOATS = new Set( [ 'cutter', 'sloop', 'brigantine', 'schooner', 'galleon', 'frigate', 'caravel', 'trawler_sail' ] );
const DEG = Math.PI / 180;
const ABOARD = new Set( [ 'deck', 'seat', 'boat' ] );

export function isSailBoat( id ) {

	if ( ! id ) return false;
	const b = BOATS[ id ];
	return !! ( ( b && ( b.sail === true || b.rig === 'sail' ) ) || SAIL_BOATS.has( id ) );

}

export class ShipSfx {

	constructor( sfx ) {

		this.sfx = sfx;
		this.stress = 0; // 0..1.5: how hard the hull is working
		this.groanT = 4;
		this.riggingT = 3;
		this.luffT = 0;
		this.lastHp = null;
		this.reload = { port: 0, starboard: 0 };
		this.slams = 0;
		this.reloads = 0;
		this.hits = 0;
		this._hooked = null;
		this._prevSlam = null;
		this.off = [];
		const f = sfx.features;
		if ( f && f.on ) {

			this.off.push( f.on( 'playerBoatDamaged', ( e ) => this.damaged( e ) ) );
			this.off.push( f.on( 'cannonReloaded', ( e ) => this.reloaded( e ) ) );

		}

	}

	get boat() {

		return this.sfx.app.boatCtl || null;

	}

	// the position of the boat (up: metres above it, for the mast head)
	spot( up = 0 ) {

		const b = this.boat, p = this.sfx.app.player && this.sfx.app.player.position;
		const q = b && b.position ? b.position : p;
		return q ? { x: num( q.x, 0 ), y: num( q.y, 0 ) + up, z: num( q.z, 0 ) } : null;

	}

	aboard() {

		const p = this.sfx.app.player;
		return !! p && ABOARD.has( p.mode );

	}

	boatId() {

		const g = this.sfx.app.game;
		return g && g.state ? g.state.boat : null;

	}

	wind() {

		const w = this.sfx.features && this.sfx.features.get ? this.sfx.features.get( 'weather' ) : null;
		return clamp( w && Number.isFinite( w.wind ) ? w.wind : 6, 0, 40 );

	}

	// chain onto the slam hook of the boat controller (the App sets it to the hull slap); re-chained if replaced
	hook() {

		const b = this.boat;
		if ( ! b || b.onSlam === this._hooked ) return;
		const prev = b.onSlam;
		const mine = ( s ) => {

			try {

				if ( typeof prev === 'function' ) prev( s );

			} finally {

				this.slam( s );

			}

		};

		this._prevSlam = prev;
		this._hooked = mine;
		b.onSlam = mine;

	}

	slam( s ) {

		this.slams ++;
		this.stress = clamp( this.stress + 0.9 * clamp( num( s, 0.5 ), 0, 1 ), 0, 1.5 );

	}

	damaged( e ) {

		try {

			const hp = num( e && e.hp, null ), max = num( e && e.maxHp, 100 );
			let dmg = this.lastHp !== null && hp !== null ? this.lastHp - hp : max * 0.08;
			if ( ! ( dmg > 0 ) ) dmg = max * 0.04;
			this.lastHp = hp !== null ? hp : this.lastHp;
			this.hits ++;
			this.sfx.player.preload( [ 'splinter', 'hull_groan' ] );
			this.sfx.play( 'splinter', { at: this.spot( 0.8 ), gain: clamp( 0.4 + 3 * dmg / max, 0.4, 1 ), rate: 0.9 + Math.random() * 0.25 } );
			// a hurt hull groans: soon, and louder the worse it is
			if ( hp !== null && hp < max * 0.5 ) {

				this.stress = Math.max( this.stress, 0.9 );
				this.groanT = Math.min( this.groanT, 0.5 + Math.random() * 0.6 );

			}

		} catch ( err ) { /* never throws */ }

	}

	reloaded( e ) {

		this.reloads ++;
		const at = e && Number.isFinite( e.x ) && Number.isFinite( e.z ) ? { x: e.x, y: num( e.y, 1 ), z: e.z } : this.spot( 0.8 );
		this.sfx.play( 'cannon_reload', { at, rate: 1 } );

	}

	update( dt ) {

		const s = this.sfx;
		this.hook();

		// the swivel gun is ready again
		const nv = s.features && s.features.get ? s.features.get( 'naval' ) : null;
		if ( nv && nv.reloadLeft ) {

			for ( const side of [ 'port', 'starboard' ] ) {

				const left = num( nv.reloadLeft[ side ], 0 );
				if ( this.reload[ side ] > 0 && left <= 0 ) this.reloaded( null );
				this.reload[ side ] = left;

			}

		}

		const b = this.boat;
		if ( ! b || ! this.aboard() ) {

			this.stress = Math.max( 0, this.stress - dt * 0.5 );
			return;

		}

		s.player.preload( [ 'hull_groan', 'splinter', 'cannon_reload' ] );
		const id = this.boatId(), sail = isSailBoat( id ), wind = this.wind();
		const q = b.quaternion, speed = num( b.speed, 0 );
		let roll = 0, pitch = 0, heel = 0, fwd = { x: 0, z: 1 };
		if ( q && b.angular ) {

			const a = rotate( q, b.angular, true ); // x pitch, y yaw, z roll rates (rad/s) in the frame of the hull
			roll = Math.abs( a.z );
			pitch = Math.abs( a.x );
			heel = Math.abs( rotate( q, { x: 1, y: 0, z: 0 } ).y ); // sin of the heel angle (port axis against the horizon)
			fwd = rotate( q, { x: 0, y: 0, z: 1 } );

		}

		// the hull working: rolling and pitching rates; slams add on top (slam())
		const work = clamp( roll / 0.45 + pitch / 0.7 * 0.6, 0, 1.4 );
		this.stress = clamp( this.stress + work * dt * 0.55 - dt * 0.12, 0, 1.5 );
		this.groanT -= dt;
		if ( this.groanT <= 0 && this.stress > 0.4 ) {

			const k = clamp( this.stress, 0, 1 );
			s.play( 'hull_groan', { at: this.spot( 0.2 ), gain: 0.3 + 0.7 * k, rate: 0.85 + Math.random() * 0.3 } );
			this.stress *= 0.6;
			this.groanT = lerp( 7, 2.5, k ) + Math.random() * 2;

		} else if ( this.groanT <= 0 ) this.groanT = 0.5;

		if ( ! sail ) return;

		// rigging: creaks of rope and canvas
		this.riggingT -= dt;
		if ( this.riggingT <= 0 ) {

			s.player.preload( [ 'rigging_strain', 'sail_luff' ] );
			const strain = clamp( 0.15 + smooth( 3, 14, wind ) * 0.6 + smooth( 1, 7, speed ) * 0.2 + heel * 1.2, 0, 1 );
			s.play( 'rigging_strain', { at: this.spot( 2.5 ), gain: 0.3 + 0.7 * strain, rate: 0.9 + 0.25 * strain + Math.random() * 0.06 } );
			this.riggingT = lerp( 11, 3.2, strain ) * ( 0.75 + Math.random() * 0.5 );

		}

		// luffing: head to wind
		this.luffT -= dt;
		if ( this.luffT <= 0 ) {

			const w = G && G.windDir && G.windDir.value ? G.windDir.value : null;
			let angle = 180;
			if ( w ) {

				const wl = Math.hypot( w.x, w.y ) || 1, fl = Math.hypot( fwd.x, fwd.z ) || 1;
				const into = clamp( - ( w.x * fwd.x + w.y * fwd.z ) / ( wl * fl ), - 1, 1 ); // 1: bow straight into the wind
				angle = Math.acos( into ) / DEG;

			}

			const luff = smooth( 55, 18, angle ) * smooth( 2.5, 8, wind );
			if ( luff > 0.12 ) {

				s.player.preload( 'sail_luff' );
				s.play( 'sail_luff', { at: this.spot( 2.5 ), gain: 0.25 + 0.75 * luff, rate: 0.9 + 0.012 * wind } );
				this.luffT = 1.35;

			} else this.luffT = 0.4;

		}

	}

	dispose() {

		for ( const f of this.off ) try { f(); } catch ( e ) { /* ignore */ }
		this.off.length = 0;
		const b = this.boat;
		if ( b && this._hooked && b.onSlam === this._hooked ) b.onSlam = this._prevSlam;
		this._hooked = null;

	}

}
