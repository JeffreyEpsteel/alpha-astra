// Gun sounds, all synthesised (no files): the report of the pistol and the musket, the dry click of an empty pan and the
// reload clacks. Built like melee's CombatAudio synth banks: one-shots into audio.sfxAbove (the sfx volume category) of the
// game's SoundScape context, through an HRTF panner at the world position when `at` is given.
//
//   const a = new GunAudio( app.audio );   // app.audio may be null (?noAudio) or not resumed: every call is then a no-op
//   a.report( 'pistol' | 'musket', { at, gain } )   a.click( kind, { at, gain } )   kind: 'dry' | 'half' | 'cock' | 'pour' | 'ram'
//
// The report: a white-noise burst through a band-pass (the crack) over a low-passed body, a sine thump falling an octave, and a
// quieter low-passed copy ~0.2 s later (the echo off the hills). The musket is longer and lower.

export const REPORTS = {
	pistol: { len: 0.32, crack: 3200, body: 900, thump: 95, gain: 0.9, echo: 0.22 },
	musket: { len: 0.6, crack: 2400, body: 620, thump: 70, gain: 1.0, echo: 0.3 },
	// wave 18D: the rifle cracks sharper and rolls further; the blunderbuss is a short wide roar; the harpoon gun a thump
	rifle: { len: 0.7, crack: 3600, body: 700, thump: 80, gain: 1.0, echo: 0.42 },
	blunderbuss: { len: 0.5, crack: 1500, body: 420, thump: 55, gain: 1.0, echo: 0.24 },
	harpoon: { len: 0.28, crack: 900, body: 300, thump: 60, gain: 0.7, echo: 0.18 },
};

// clicks: [ Hz, decay s, gain, noise band Hz (0: tone only) ]
export const CLICKS = {
	dry: [ 2100, 0.05, 0.45, 5200 ],
	half: [ 1500, 0.06, 0.4, 4200 ],
	cock: [ 1250, 0.09, 0.55, 3600 ],
	pour: [ 0, 0.16, 0.25, 6800 ],
	ram: [ 640, 0.14, 0.35, 2600 ],
};

export class GunAudio {

	constructor( audio ) {

		this.audio = audio || null;
		this._noise = null;
		this.played = 0;

	}

	get ctx() {

		return this.audio && this.audio.ctx ? this.audio.ctx : null;

	}

	_noiseBuffer( ctx ) {

		if ( this._noise && this._noise.sampleRate === ctx.sampleRate ) return this._noise;
		const n = Math.floor( ctx.sampleRate * 0.8 );
		const b = ctx.createBuffer( 1, n, ctx.sampleRate );
		const d = b.getChannelData( 0 );
		for ( let i = 0; i < n; i ++ ) d[ i ] = Math.random() * 2 - 1;
		this._noise = b;
		return b;

	}

	// the destination: the sfx bus, through a panner at `at`
	_out( ctx, at, gain ) {

		const out = ctx.createGain();
		out.gain.value = gain;
		let panner = null;
		if ( at && ctx.createPanner ) {

			panner = ctx.createPanner();
			panner.panningModel = 'HRTF';
			panner.distanceModel = 'inverse';
			panner.refDistance = 4;
			panner.rolloffFactor = 0.9;
			panner.maxDistance = 10000;
			if ( panner.positionX ) { panner.positionX.value = at.x; panner.positionY.value = at.y; panner.positionZ.value = at.z; } else if ( panner.setPosition ) panner.setPosition( at.x, at.y, at.z );
			out.connect( panner );
			panner.connect( this.audio.sfxAbove );

		} else out.connect( this.audio.sfxAbove );
		return { out, panner };

	}

	_burst( ctx, dest, t0, { type, freq, q = 0.8, len, peak } ) {

		const src = ctx.createBufferSource();
		src.buffer = this._noiseBuffer( ctx );
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime( 0.0001, t0 );
		g.gain.exponentialRampToValueAtTime( peak, t0 + 0.002 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t0 + len );
		src.connect( f );
		f.connect( g );
		g.connect( dest );
		src.start( t0, Math.random() * 0.3 );
		src.stop( t0 + len + 0.02 );
		src.onended = () => { try { f.disconnect(); g.disconnect(); } catch ( e ) { /* gone */ } };

	}

	_tone( ctx, dest, t0, { freq, drop = 0.5, len, peak, type = 'sine' } ) {

		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime( freq, t0 );
		o.frequency.exponentialRampToValueAtTime( Math.max( 20, freq * drop ), t0 + len );
		g.gain.setValueAtTime( 0.0001, t0 );
		g.gain.exponentialRampToValueAtTime( peak, t0 + 0.004 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t0 + len );
		o.connect( g );
		g.connect( dest );
		o.start( t0 );
		o.stop( t0 + len + 0.02 );
		o.onended = () => { try { g.disconnect(); } catch ( e ) { /* gone */ } };

	}

	report( kind = 'pistol', { at = null, gain = 1 } = {} ) {

		const ctx = this.ctx, r = REPORTS[ kind ] || REPORTS.pistol;
		if ( ! ctx || ! this.audio.sfxAbove || ! ctx.createBufferSource || ! ctx.createBiquadFilter ) return false;
		try {

			const t0 = ctx.currentTime;
			const { out, panner } = this._out( ctx, at, gain * r.gain );
			this._burst( ctx, out, t0, { type: 'bandpass', freq: r.crack, q: 0.7, len: 0.06, peak: 0.9 } ); // the crack
			this._burst( ctx, out, t0, { type: 'lowpass', freq: r.body, q: 0.5, len: r.len, peak: 0.8 } ); // the boom
			this._tone( ctx, out, t0, { freq: r.thump, drop: 0.5, len: r.len * 0.7, peak: 0.7 } ); // the thump
			this._burst( ctx, out, t0 + r.echo, { type: 'lowpass', freq: r.body * 0.6, q: 0.5, len: r.len * 1.4, peak: 0.18 } ); // the echo
			setTimeout( () => { try { out.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* gone */ } }, ( r.echo + r.len * 1.5 + 0.2 ) * 1000 );
			this.played ++;
			return true;

		} catch ( e ) {

			return false;

		}

	}

	click( kind = 'dry', { at = null, gain = 1 } = {} ) {

		const ctx = this.ctx, c = CLICKS[ kind ] || CLICKS.dry;
		if ( ! ctx || ! this.audio.sfxAbove || ! ctx.createOscillator ) return false;
		try {

			const t0 = ctx.currentTime;
			const { out, panner } = this._out( ctx, at, gain * c[ 2 ] );
			if ( c[ 0 ] ) this._tone( ctx, out, t0, { freq: c[ 0 ], drop: 0.8, len: c[ 1 ], peak: 0.6, type: 'triangle' } );
			if ( c[ 3 ] && ctx.createBufferSource && ctx.createBiquadFilter ) this._burst( ctx, out, t0, { type: 'bandpass', freq: c[ 3 ], q: 2, len: c[ 1 ] * 0.8, peak: 0.7 } );
			setTimeout( () => { try { out.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* gone */ } }, ( c[ 1 ] + 0.15 ) * 1000 );
			this.played ++;
			return true;

		} catch ( e ) {

			return false;

		}

	}

}
