// Water cues for the fishing (docs/UNREAL_PARITY.md F9): the lure's splash and ripple ring where it lands, a fish-shadow
// ripple burst at the strike, a bigger burst at a landed catch, a small plop at a miss. The same edges as the gulls
// (GullCues calls onCue), drawn through the VFX set's public API (features.get( 'vfx' ): splash / bubbles), nothing new
// to draw.
//
//   const fx = new CastFx( features, { env? } );  fx.cue( kind, { x, y, z } );  fx.update( dt );  fx.stats()
//
//   cast          vfx.splash( 0.3 )                         a small column and ONE foam ring (the ripple) at the lure
//   bite / strike a ripple ring + vfx.bubbles( 0.7 )        the fish's shadow turning under the bobber (no column)
//   catch         vfx.bubbles( 1.3 ) + vfx.splash( 0.6 )    a big burst, 0.15 s after the fish breaks the surface
//                                                           (the VFX set's own small catch splash is at 0 s)
//   miss          vfx.splash( 0.08 )                        a small plop
//   stow          nothing
//
// Budget: a cue spawns at most ONE ring (the splash's foam ring or the ripple), and at most RING_CAP rings are spawned in
// any RING_WINDOW seconds: past that a cue is drawn with bubbles only (a cast spammed 10 times a second stays cheap).
// Rings are counted here (stats().rings) because the VFX pool keeps no per-sprite counters.

const num = ( v, d = 0 ) => ( Number.isFinite( v ) ? v : d );

export const RING_CAP = 3;
export const RING_WINDOW = 2; // s
export const COOLDOWN = 0.4; // s: the same kind twice (an event and an edge on the same frame) shows once
export const CATCH_DELAY = 0.15; // s: past the VFX set's de-duplication window (0.1 s) so the burst is its own
export const STRENGTH = { cast: 0.3, bite: 0.55, strike: 0.55, catch: 0.6, miss: 0.08, bubbles: { bite: 0.7, strike: 0.7, catch: 1.3 } };

export class CastFx {

	constructor( features, { env = null } = {} ) {

		this.features = features || null;
		this.env = env; // { sea(): water height } for tests; else the VFX set's own
		this.t = 0;
		this._cool = {};
		this._pending = []; // { at, kind, kg } delayed bursts
		this._ringAt = []; // times of the recent rings
		this.rings = 0;
		this.bursts = { cast: 0, bite: 0, strike: 0, catch: 0, miss: 0 };

	}

	get vfx() {

		return this.features && this.features.get ? this.features.get( 'vfx' ) : null;

	}

	_sea( fx ) {

		if ( this.env && this.env.sea ) return this.env.sea();
		const e = fx && fx.env && fx.env.seaLevel;
		return typeof e === 'function' ? num( e(), 0 ) : 0;

	}

	// a ring may be spawned now (the cap per window)
	_ringOk() {

		const now = this.t;
		this._ringAt = this._ringAt.filter( ( at ) => now - at < RING_WINDOW );
		if ( this._ringAt.length >= RING_CAP ) return false;
		this._ringAt.push( now );
		this.rings ++;
		return true;

	}

	_land( fx, x, z ) {

		const sys = fx && fx.sys;
		try { return !! ( sys && sys._onLand && sys._onLand( x, z ) ); } catch ( e ) { return false; }

	}

	// a foam ring and nothing else (the strike's ripple): the VFX recipe when it is there, else a tiny splash
	_ripple( fx, x, y, z, s ) {

		const sys = fx.sys;
		if ( sys && typeof sys._foam === 'function' ) sys._foam( x, y, z, s, 1 );
		else if ( fx.splash ) fx.splash( x, y, z, 0.1 );

	}

	// kind: 'cast' | 'bite' | 'strike' | 'catch' | 'miss'; at: the water spot ( x, z; y is the sea there)
	cue( kind, at ) {

		if ( ! ( kind in this.bursts ) ) return false;
		if ( ! at || ! Number.isFinite( at.x ) || ! Number.isFinite( at.z ) ) return false;
		const fx = this.vfx;
		if ( ! fx ) return false;
		if ( this._cool[ kind ] > this.t ) return false;
		this._cool[ kind ] = this.t + COOLDOWN;
		if ( this._land( fx, at.x, at.z ) ) return false;
		this.bursts[ kind ] ++;
		const y = this._sea( fx );
		if ( kind === 'catch' ) {

			this._pending.push( { x: at.x, y, z: at.z, due: this.t + CATCH_DELAY } );
			return true;

		}

		this._burst( fx, kind, at.x, y, at.z );
		return true;

	}

	_burst( fx, kind, x, y, z ) {

		const ring = this._ringOk();
		if ( kind === 'cast' ) {

			if ( ring && fx.splash ) fx.splash( x, y, z, STRENGTH.cast );
			else if ( fx.bubbles ) fx.bubbles( x, y, z, 0.3 );

		} else if ( kind === 'bite' || kind === 'strike' ) {

			if ( ring ) this._ripple( fx, x, y, z, STRENGTH[ kind ] );
			if ( fx.bubbles ) fx.bubbles( x, y, z, STRENGTH.bubbles[ kind ] );

		} else if ( kind === 'miss' ) {

			if ( ring && fx.splash ) fx.splash( x, y, z, STRENGTH.miss );

		} else if ( kind === 'catch' ) {

			if ( fx.bubbles ) fx.bubbles( x, y, z, STRENGTH.bubbles.catch );
			if ( ring && fx.splash ) fx.splash( x, y, z, STRENGTH.catch );

		}

	}

	update( dt ) {

		this.t += Math.max( 0, num( dt ) );
		if ( ! this._pending.length ) return;
		const fx = this.vfx;
		const keep = [];
		for ( const p of this._pending ) {

			if ( p.due > this.t ) keep.push( p );
			else if ( fx ) this._burst( fx, 'catch', p.x, p.y, p.z );

		}

		this._pending = keep;

	}

	stats() {

		return { rings: this.rings, ringsRecent: this._ringAt.filter( ( at ) => this.t - at < RING_WINDOW ).length, bursts: { ...this.bursts } };

	}

}
