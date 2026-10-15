import { GunAudio } from '../firearms/GunAudio.js';

// The arsenal's synthesised sounds (wave 18D), on GunAudio's banks (noise bursts through filters, falling tones, an HRTF
// panner at `at`; app.audio null or not resumed: every call is a no-op and returns false):
//   blast( at, size )   a powder bomb: a deep boom, a crack and a long rumble with an echo
//   shatter( at )       a fire bottle breaking: a glassy tinkle over the whoomph of the spirit catching
//   hiss( at )          a lit fuse / a smoke pot catching          whoosh( k )   a throw leaving the hand (k: 0..1 weight)
//   clang( at )         steel on steel (a cutlass guard)          thud( at )    a harpoon striking home, a bomb bouncing

export class WeaponAudio extends GunAudio {

	_play( at, gain, fn ) {

		const ctx = this.ctx;
		if ( ! ctx || ! this.audio.sfxAbove || ! ctx.createBufferSource || ! ctx.createBiquadFilter ) return false;
		try {

			const t0 = ctx.currentTime;
			const { out, panner } = this._out( ctx, at, gain );
			const len = fn( ctx, out, t0 );
			setTimeout( () => { try { out.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* gone */ } }, ( len + 0.3 ) * 1000 );
			this.played ++;
			return true;

		} catch ( e ) {

			return false;

		}

	}

	blast( at = null, size = 1 ) {

		return this._play( at, 1.0, ( ctx, out, t0 ) => {

			this._burst( ctx, out, t0, { type: 'bandpass', freq: 1800, q: 0.6, len: 0.08, peak: 0.9 } );
			this._burst( ctx, out, t0, { type: 'lowpass', freq: 380, q: 0.5, len: 1.1 * size, peak: 1 } );
			this._tone( ctx, out, t0, { freq: 58, drop: 0.45, len: 0.9 * size, peak: 0.9 } );
			this._burst( ctx, out, t0 + 0.35, { type: 'lowpass', freq: 240, q: 0.5, len: 1.6 * size, peak: 0.25 } );
			return 2 * size;

		} );

	}

	shatter( at = null ) {

		return this._play( at, 0.8, ( ctx, out, t0 ) => {

			for ( let i = 0; i < 5; i ++ ) this._tone( ctx, out, t0 + i * 0.018, { freq: 2600 + i * 730, drop: 0.9, len: 0.12, peak: 0.25, type: 'triangle' } );
			this._burst( ctx, out, t0, { type: 'highpass', freq: 5200, q: 0.7, len: 0.18, peak: 0.5 } );
			this._burst( ctx, out, t0 + 0.05, { type: 'lowpass', freq: 600, q: 0.5, len: 0.7, peak: 0.6 } ); // the whoomph
			return 0.9;

		} );

	}

	hiss( at = null, len = 0.8 ) {

		return this._play( at, 0.35, ( ctx, out, t0 ) => {

			this._burst( ctx, out, t0, { type: 'highpass', freq: 4200, q: 0.4, len, peak: 0.5 } );
			return len;

		} );

	}

	whoosh( k = 0.5, at = null ) {

		return this._play( at, 0.3 + 0.3 * k, ( ctx, out, t0 ) => {

			this._burst( ctx, out, t0, { type: 'bandpass', freq: 700 + 500 * k, q: 1.2, len: 0.22, peak: 0.6 } );
			return 0.3;

		} );

	}

	clang( at = null ) {

		return this._play( at, 0.6, ( ctx, out, t0 ) => {

			this._tone( ctx, out, t0, { freq: 1900, drop: 0.97, len: 0.35, peak: 0.5, type: 'triangle' } );
			this._tone( ctx, out, t0, { freq: 2870, drop: 0.97, len: 0.25, peak: 0.3, type: 'triangle' } );
			this._burst( ctx, out, t0, { type: 'bandpass', freq: 4000, q: 1.5, len: 0.05, peak: 0.6 } );
			return 0.4;

		} );

	}

	thud( at = null ) {

		return this._play( at, 0.5, ( ctx, out, t0 ) => {

			this._tone( ctx, out, t0, { freq: 140, drop: 0.5, len: 0.16, peak: 0.6 } );
			this._burst( ctx, out, t0, { type: 'lowpass', freq: 900, q: 0.6, len: 0.1, peak: 0.5 } );
			return 0.2;

		} );

	}

}
