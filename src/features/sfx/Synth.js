// Synthesised cues (wave 13C): short sounds built from oscillators and filtered noise at the moment they play, so the
// new places and events need no audio files (the same way PlaneAudio and TavernAudio make theirs). A cue is a builder
// ( ctx, out, t, o ) that wires nodes into the gain node `out` from time t and returns its length in seconds; the
// SynthPlayer gives it the SfxPlayer's rules: the distance gain (inverse law from `ref`, culled past `max`), an HRTF
// panner for the direction, the SoundScape's sfx / ambience category node (so the master volume, the mute switch and the
// two sliders apply), a voice limit per cue and a log of what played (tests, debugging).
//
//   const s = new SynthPlayer( sfxPlayer );
//   s.play( 'battery_fire', { at: { x, y, z }, gain: 1, rate: 1 } )   -> voice | null (not active, too far, no room)
//   CUES[ name ] = { cat, gain, ref, max, voices, build }
//
// Wave 20B: a cue's voices are halved on a phone (globalThis.__phoneBudget) and the whole synth has a budget (VOICE_CAP) so a
// battle never stacks into clipping; opts.delay starts a cue later (a far gun's sound travelling); the SfxPlayer's occlude
// hook makes a positional cue quieter and low-passed through a room's walls. Voices.js adds the new actions' cues.
//
// Without oscillators on the context (a bare test double) every call returns null; nothing here throws.

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const num = ( v, d ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );

// ------------------------------------------------------------------ building blocks

const NOISE = new WeakMap();

// a two-second loop of noise per context: 'white' or 'brown' (a leaky integral: the low rumble of surf and crowds)
export function noiseBuf( ctx, kind = 'white' ) {

	let m = NOISE.get( ctx );
	if ( ! m ) NOISE.set( ctx, m = {} );
	if ( m[ kind ] ) return m[ kind ];
	const sr = num( ctx.sampleRate, 44100 ), len = Math.max( 64, Math.floor( sr * 2 ) );
	const buf = ctx.createBuffer( 1, len, sr );
	const d = buf.getChannelData( 0 );
	let last = 0;
	for ( let i = 0; i < len; i ++ ) {

		const w = Math.random() * 2 - 1;
		if ( kind === 'brown' ) {

			last = ( last + 0.02 * w ) / 1.02;
			d[ i ] = last * 3.5;

		} else d[ i ] = w;

	}

	m[ kind ] = buf;
	return buf;

}

export function gainNode( ctx, v = 1, dest = null ) {

	const g = ctx.createGain();
	g.gain.value = v;
	if ( dest ) g.connect( dest );
	return g;

}

export function filterNode( ctx, type, f, q = 0.7, dest = null ) {

	const n = ctx.createBiquadFilter();
	n.type = type;
	n.frequency.value = f;
	n.Q.value = q;
	if ( dest ) n.connect( dest );
	return n;

}

// attack to peak, then an exponential fall to silence over `decay`
function envelope( param, t, peak, attack, decay ) {

	param.setValueAtTime( 0.0001, t );
	param.linearRampToValueAtTime( Math.max( 0.0002, peak ), t + attack );
	param.exponentialRampToValueAtTime( 0.0001, t + attack + decay );

}

// an oscillator gliding f0 -> f1 with an enveloped gain into dest
export function tone( ctx, dest, { type = 'sine', f0, f1 = f0, t, dur, peak = 1, attack = 0.004 } ) {

	const o = ctx.createOscillator();
	o.type = type;
	o.frequency.setValueAtTime( f0, t );
	if ( f1 !== f0 ) o.frequency.exponentialRampToValueAtTime( Math.max( 1, f1 ), t + dur );
	const g = ctx.createGain();
	envelope( g.gain, t, peak, attack, Math.max( 0.01, dur - attack ) );
	o.connect( g );
	g.connect( dest );
	o.start( t );
	o.stop( t + dur + 0.05 );
	return o;

}

// filtered noise with an enveloped gain; the filter may sweep f -> f1
export function burst( ctx, dest, { t, dur, peak = 1, type = 'lowpass', f = 800, f1 = f, q = 0.7, attack = 0.002, kind = 'white', offset = null } ) {

	const s = ctx.createBufferSource();
	s.buffer = noiseBuf( ctx, kind );
	const fl = filterNode( ctx, type, f, q );
	if ( f1 !== f ) {

		fl.frequency.setValueAtTime( f, t );
		fl.frequency.exponentialRampToValueAtTime( Math.max( 20, f1 ), t + dur );

	}

	const g = ctx.createGain();
	envelope( g.gain, t, peak, attack, Math.max( 0.01, dur - attack ) );
	s.connect( fl );
	fl.connect( g );
	g.connect( dest );
	s.start( t, offset === null ? Math.random() * 1.5 : offset );
	s.stop( t + dur + 0.05 );
	return s;

}

// a struck bell: inharmonic partials with their own decays (the lowest rings longest)
const BELL = [ [ 0.5, 1.0, 2.6 ], [ 1, 0.9, 2.0 ], [ 1.19, 0.5, 1.3 ], [ 1.56, 0.4, 0.9 ], [ 2, 0.35, 0.8 ], [ 2.51, 0.22, 0.5 ], [ 3.2, 0.12, 0.35 ] ];

export function bellStrike( ctx, dest, t, f0, amp = 1, ring = 1 ) {

	for ( const [ r, a, d ] of BELL ) tone( ctx, dest, { type: 'sine', f0: f0 * r, t, dur: d * ring, peak: 0.35 * a * amp, attack: 0.003 } );
	burst( ctx, dest, { t, dur: 0.05, peak: 0.25 * amp, type: 'bandpass', f: f0 * 5, q: 1.5 } ); // the clapper

}

// the report echoing round the caldera: copies of a low burst coming back later and duller
export function echoes( ctx, dest, t, { f = 380, peak = 0.5, dur = 0.7, delays = [ 0.45, 0.95, 1.7 ] } = {} ) {

	delays.forEach( ( dl, i ) => burst( ctx, dest, { t: t + dl, dur: dur * ( 1 + i * 0.4 ), peak: peak / ( 2 + i * 1.3 ), type: 'lowpass', f: f / ( 1 + i * 0.5 ), q: 0.6, attack: 0.04 } ) );

}

// a vowel-ish voice: a sawtooth through two formant bands, gliding in pitch
export function voice( ctx, dest, { t, dur, f0, f1 = f0, forms = [ 700, 1200 ], peak = 0.5, type = 'sawtooth', vibrato = 0 } ) {

	const o = ctx.createOscillator();
	o.type = type;
	o.frequency.setValueAtTime( f0, t );
	o.frequency.exponentialRampToValueAtTime( Math.max( 1, f1 ), t + dur );
	if ( vibrato > 0 ) {

		const l = ctx.createOscillator();
		l.frequency.value = 6;
		const lg = gainNode( ctx, f0 * vibrato );
		l.connect( lg );
		lg.connect( o.frequency );
		l.start( t );
		l.stop( t + dur + 0.05 );

	}

	const g = ctx.createGain();
	envelope( g.gain, t, peak, Math.min( 0.04, dur / 4 ), dur );
	o.connect( g );
	forms.forEach( ( f, i ) => {

		const b = filterNode( ctx, 'bandpass', f, 4 + i );
		g.connect( b );
		b.connect( dest );

	} );
	o.start( t );
	o.stop( t + dur + 0.1 );

}

// ------------------------------------------------------------------ the cues

const rnd = ( a, b ) => a + Math.random() * ( b - a );

export const CUES = {
	// a shore battery: a deeper report than the swivel gun (a falling thump, a rolling roar) and the caldera's echoes
	battery_fire: {
		cat: 'sfx', gain: 1, ref: 30, max: 1100, voices: 4, gap: 0.18, build( ctx, out, t, o ) {

			const p = clamp( num( o.power, 1 ), 0.4, 1.5 );
			tone( ctx, out, { type: 'sine', f0: 120, f1: 26, t, dur: 1.0, peak: 1.0 * p, attack: 0.003 } );
			tone( ctx, out, { type: 'triangle', f0: 70, f1: 30, t, dur: 0.6, peak: 0.5 * p, attack: 0.004 } );
			burst( ctx, out, { t, dur: 0.9, peak: 0.85 * p, type: 'lowpass', f: 900, f1: 160, q: 0.8, kind: 'brown' } );
			burst( ctx, out, { t, dur: 0.12, peak: 0.5 * p, type: 'bandpass', f: 1800, f1: 600, q: 0.9 } ); // the crack
			echoes( ctx, out, t, { peak: 0.55 * p } );
			return 2.9;

		},
	},
	// the powder store going up: a long roar, a deep shock and falling debris
	powder_blast: {
		cat: 'sfx', gain: 1, ref: 50, max: 1500, voices: 2, gap: 0.4, build( ctx, out, t ) {

			tone( ctx, out, { type: 'sine', f0: 80, f1: 18, t, dur: 2.0, peak: 1.2, attack: 0.004 } );
			burst( ctx, out, { t, dur: 2.4, peak: 1.0, type: 'lowpass', f: 1100, f1: 120, q: 0.7, kind: 'brown', attack: 0.006 } );
			burst( ctx, out, { t, dur: 0.25, peak: 0.7, type: 'bandpass', f: 2200, f1: 500, q: 0.8 } );
			for ( let i = 0; i < 14; i ++ ) burst( ctx, out, { t: t + 0.5 + Math.random() * 1.6, dur: 0.07, peak: rnd( 0.08, 0.25 ), type: 'bandpass', f: rnd( 900, 3200 ), q: 2 } ); // debris
			echoes( ctx, out, t, { peak: 0.9, dur: 1.1, delays: [ 0.55, 1.2, 2.0, 2.9 ] } );
			return 4.3;

		},
	},
	// the fort bell on the alarm: a hurried run of strikes on a bronze bell
	fort_bell: {
		cat: 'sfx', gain: 0.9, ref: 40, max: 900, voices: 1, gap: 3, build( ctx, out, t, o ) {

			const n = clamp( Math.round( num( o.strikes, 7 ) ), 1, 12 );
			let at = t;
			for ( let i = 0; i < n; i ++ ) {

				bellStrike( ctx, out, at, 392, 0.8 + 0.2 * ( i % 2 ), 0.9 );
				at += 0.36 + 0.05 * Math.sin( i * 1.7 );

			}

			return at - t + 2.4;

		},
	},
	// the town's chapel bell: one slow, deep strike (the caller strikes it n times on the hour)
	chapel_bell: {
		cat: 'ambience', gain: 0.9, ref: 40, max: 700, voices: 3, gap: 0.5, build( ctx, out, t ) {

			bellStrike( ctx, out, t, 262, 1, 1.5 );
			return 4.5;

		},
	},
	// the watchtower's call: a shouted "hoy" twice, a falling pair of vowels
	watch_call: {
		cat: 'sfx', gain: 0.9, ref: 20, max: 500, voices: 1, gap: 5, build( ctx, out, t ) {

			for ( let i = 0; i < 2; i ++ ) {

				const a = t + i * 0.85;
				voice( ctx, out, { t: a, dur: 0.55, f0: 210, f1: 150, forms: [ 700, 1150 ], peak: 0.8, vibrato: 0.01 } );
				voice( ctx, out, { t: a + 0.5, dur: 0.3, f0: 150, f1: 120, forms: [ 450, 900 ], peak: 0.6 } );

			}

			return 2.2;

		},
	},
	// buying the black flag: new cloth snapping out, a few coins and a drum thump
	black_flag: {
		cat: 'sfx', gain: 0.9, ref: 3, max: 60, voices: 1, gap: 2, build( ctx, out, t ) {

			burst( ctx, out, { t, dur: 0.14, peak: 0.7, type: 'bandpass', f: 1400, f1: 500, q: 1.2 } ); // the snap
			for ( let i = 0; i < 7; i ++ ) burst( ctx, out, { t: t + 0.16 + i * 0.075, dur: 0.08, peak: 0.28 * ( 1 - i / 9 ), type: 'bandpass', f: 1000 + 120 * Math.sin( i * 2.1 ), q: 2.5 } ); // the flutter
			for ( let i = 0; i < 3; i ++ ) {

				const a = t + 0.5 + i * 0.11;
				tone( ctx, out, { type: 'sine', f0: 2600 + i * 310, t: a, dur: 0.22, peak: 0.22 } );
				tone( ctx, out, { type: 'sine', f0: 3900 + i * 420, t: a, dur: 0.16, peak: 0.12 } );

			}

			tone( ctx, out, { type: 'sine', f0: 110, f1: 55, t: t + 0.05, dur: 0.4, peak: 0.6 } );
			return 1.2;

		},
	},
	// claiming the island: three rising horn notes, a bell and a drum roll
	claim: {
		cat: 'sfx', gain: 0.9, ref: 3, max: 80, voices: 1, gap: 6, build( ctx, out, t ) {

			const lp = filterNode( ctx, 'lowpass', 1400, 0.7, out );
			[ [ 261.6, 0 ], [ 392, 0.45 ], [ 523.3, 0.9 ] ].forEach( ( [ f, d ], i ) => {

				tone( ctx, lp, { type: 'sawtooth', f0: f, t: t + d, dur: i === 2 ? 1.5 : 0.6, peak: 0.28, attack: 0.05 } );
				tone( ctx, lp, { type: 'square', f0: f * 1.005, t: t + d, dur: i === 2 ? 1.5 : 0.6, peak: 0.1, attack: 0.05 } );

			} );
			bellStrike( ctx, out, t + 0.9, 330, 0.8, 1.2 );
			for ( let i = 0; i < 14; i ++ ) tone( ctx, out, { type: 'sine', f0: 150, f1: 90, t: t + 0.1 + i * 0.07, dur: 0.12, peak: 0.12 + i * 0.012 } );
			return 3;

		},
	},
	// a wooden practice sword: a hard clack and the rattle after it
	sword_clack: {
		cat: 'sfx', gain: 0.9, ref: 3, max: 50, voices: 3, gap: 0.08, build( ctx, out, t ) {

			const pitch = rnd( 0.9, 1.15 );
			tone( ctx, out, { type: 'triangle', f0: 1150 * pitch, f1: 520 * pitch, t, dur: 0.07, peak: 0.7, attack: 0.001 } );
			tone( ctx, out, { type: 'sine', f0: 420 * pitch, f1: 300, t, dur: 0.1, peak: 0.4, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.03, peak: 0.5, type: 'bandpass', f: 2600, q: 1.4, attack: 0.001 } );
			burst( ctx, out, { t: t + 0.055, dur: 0.04, peak: 0.22, type: 'bandpass', f: 1900 * pitch, q: 2, attack: 0.001 } );
			return 0.2;

		},
	},
	// the parachute: the canopy filling with a crack and a deep whump, cloth flapping as it settles
	canopy_snap: {
		cat: 'sfx', gain: 1, ref: 12, max: 250, voices: 1, gap: 3, build( ctx, out, t ) {

			burst( ctx, out, { t, dur: 0.1, peak: 0.9, type: 'highpass', f: 900, f1: 2400, q: 0.7, attack: 0.001 } );
			tone( ctx, out, { type: 'sine', f0: 150, f1: 55, t: t + 0.01, dur: 0.35, peak: 0.8 } );
			burst( ctx, out, { t: t + 0.03, dur: 0.3, peak: 0.5, type: 'lowpass', f: 700, f1: 200, kind: 'brown' } );
			for ( let i = 0; i < 9; i ++ ) burst( ctx, out, { t: t + 0.18 + i * 0.07, dur: 0.07, peak: 0.28 * Math.exp( - i / 4 ), type: 'bandpass', f: rnd( 500, 1100 ), q: 1.5 } );
			return 1.1;

		},
	},
	// the parachute lines under load: a slow rope creak
	chute_creak: {
		cat: 'ambience', gain: 0.5, ref: 8, max: 120, voices: 1, gap: 3, build( ctx, out, t, o ) {

			const k = clamp( num( o.strain, 0.5 ), 0.1, 1 );
			burst( ctx, out, { t, dur: 0.7, peak: 0.35 * k, type: 'bandpass', f: 380, f1: 620 * ( 0.7 + k ), q: 7, attack: 0.15 } );
			tone( ctx, out, { type: 'sawtooth', f0: 95, f1: 120 * ( 0.8 + k ), t, dur: 0.6, peak: 0.07 * k, attack: 0.2 } );
			return 0.9;

		},
	},
	// a gull over the quay: the long mewing "kee-yow"
	gull: {
		cat: 'ambience', gain: 0.5, ref: 8, max: 160, voices: 2, gap: 1.5, build( ctx, out, t ) {

			const f = rnd( 0.9, 1.15 ), n = rnd( 0, 1 ) < 0.5 ? 2 : 3;
			for ( let i = 0; i < n; i ++ ) {

				const a = t + i * 0.42;
				voice( ctx, out, { t: a, dur: 0.38, f0: 1250 * f, f1: 1900 * f, forms: [ 1500, 2600 ], peak: 0.45, vibrato: 0.02 } );
				voice( ctx, out, { t: a + 0.25, dur: 0.3, f0: 1900 * f, f1: 1000 * f, forms: [ 1500, 2600 ], peak: 0.35, vibrato: 0.02 } );

			}

			return n * 0.42 + 0.4;

		},
	},
	// a hammer on timber from the boatyard shed
	hammer: {
		cat: 'ambience', gain: 0.8, ref: 6, max: 110, voices: 3, gap: 0.2, build( ctx, out, t ) {

			const f = rnd( 0.9, 1.1 );
			tone( ctx, out, { type: 'triangle', f0: 900 * f, f1: 420 * f, t, dur: 0.07, peak: 0.55, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.035, peak: 0.45, type: 'bandpass', f: 2400, q: 1.2, attack: 0.001 } );
			tone( ctx, out, { type: 'sine', f0: 180, f1: 110, t, dur: 0.12, peak: 0.3, attack: 0.002 } ); // the board answering
			return 0.2;

		},
	},
	// a pirate drum: a skin thump (kind 'low' | 'high') with a slap
	drum: {
		cat: 'ambience', gain: 1, ref: 25, max: 500, voices: 8, gap: 0.05, build( ctx, out, t, o ) {

			const hi = o.kind === 'high';
			tone( ctx, out, { type: 'sine', f0: hi ? 220 : 130, f1: hi ? 130 : 62, t, dur: hi ? 0.22 : 0.4, peak: hi ? 0.5 : 0.9, attack: 0.002 } );
			burst( ctx, out, { t, dur: 0.05, peak: hi ? 0.4 : 0.22, type: 'bandpass', f: hi ? 1800 : 900, q: 1.2, attack: 0.001 } );
			return 0.5;

		},
	},
	// the Rum Hole turning rowdy: a roar of voices, a cheer going up
	tavern_shout: {
		cat: 'ambience', gain: 0.7, ref: 6, max: 90, voices: 2, gap: 1.5, build( ctx, out, t ) {

			const n = 3 + Math.floor( Math.random() * 3 );
			for ( let i = 0; i < n; i ++ ) voice( ctx, out, { t: t + Math.random() * 0.35, dur: rnd( 0.5, 0.9 ), f0: rnd( 110, 190 ), f1: rnd( 150, 260 ), forms: [ rnd( 500, 750 ), rnd( 1000, 1400 ) ], peak: 0.3, vibrato: 0.03 } );
			if ( Math.random() < 0.5 ) for ( let i = 0; i < 4; i ++ ) tone( ctx, out, { type: 'sine', f0: rnd( 2400, 3400 ), t: t + 0.4 + i * 0.09, dur: 0.14, peak: 0.1 } ); // mugs
			return 1.6;

		},
	},
	// a parrot in the island's trees: a harsh rising squawk and a whistle
	parrot: {
		cat: 'ambience', gain: 0.5, ref: 8, max: 180, voices: 2, gap: 2, build( ctx, out, t ) {

			const f = rnd( 0.85, 1.2 );
			voice( ctx, out, { t, dur: 0.22, f0: 900 * f, f1: 1700 * f, forms: [ 1400, 2400 ], peak: 0.6, type: 'square', vibrato: 0.03 } );
			if ( Math.random() < 0.6 ) voice( ctx, out, { t: t + 0.3, dur: 0.18, f0: 1700 * f, f1: 1000 * f, forms: [ 1400, 2400 ], peak: 0.5, type: 'square' } );
			else tone( ctx, out, { type: 'sine', f0: 2200 * f, f1: 3000 * f, t: t + 0.3, dur: 0.35, peak: 0.25 } );
			return 0.9;

		},
	},
	// a frigatebird: a low, rattling croak from above the cliffs
	frigate: {
		cat: 'ambience', gain: 0.4, ref: 10, max: 220, voices: 1, gap: 4, build( ctx, out, t ) {

			for ( let i = 0; i < 4; i ++ ) voice( ctx, out, { t: t + i * 0.11, dur: 0.09, f0: 520 - i * 20, f1: 380, forms: [ 700, 1500 ], peak: 0.5, type: 'square' } );
			return 0.7;

		},
	},
};

// ------------------------------------------------------------------ the player

// (wave 20B) the whole synth's budget of voices sounding at once, so a battle's guns, hits and drums never stack into
// clipping; a phone gets fewer, and half of each cue's own voices (globalThis.__phoneBudget, docs/PERF.md)
export const VOICE_CAP = { desktop: 24, phone: 10 };
export const isPhone = () => !! globalThis.__phoneBudget;
export function voiceLimit( info, phone = isPhone() ) {

	const n = Math.max( 1, Math.round( num( info && info.voices, 1 ) ) );
	return phone ? Math.max( 1, Math.ceil( n / 2 ) ) : n;

}

export class SynthPlayer {

	constructor( player ) {

		this.player = player; // the SfxPlayer: context, active flag, listener, category sinks
		this.voices = new Map(); // name -> [ voice ]
		this.played = []; // log of the last plays: { name, cat, at, dist, gain, rate }
		this.count = 0;
		this.skipped = 0;
		this.failed = 0;
		this.limited = 0; // skipped: the cue's own voices were all sounding
		this.capped = 0; // skipped: the whole synth's budget was full

	}

	has( name ) {

		return !! CUES[ name ];

	}

	distanceGain( name, d ) {

		const f = CUES[ name ];
		if ( ! f ) return 0;
		if ( d >= f.max ) return 0;
		return d <= f.ref ? 1 : f.ref / ( f.ref + 1.1 * ( d - f.ref ) );

	}

	// voices still sounding (or waiting on their delay) across every cue
	live( now = num( this.player && this.player.ctx && this.player.ctx.currentTime, 0 ) ) {

		let n = 0;
		for ( const list of this.voices.values() ) for ( const v of list ) if ( v.end > now ) n ++;
		return n;

	}

	// opts: at { x, y, z } (omitted: in the head), gain, rate (pitch / tempo of builders that use it), delay (s: a far gun
	// heard after its sound has travelled), any builder option. A positional cue is occluded when the SfxPlayer's
	// occlude( at ) says so (wave 20B: a wall between it and the listener): { gain, cutoff } -> quieter and low-passed.
	play( name, opts = {} ) {

		const info = CUES[ name ], p = this.player, ctx = p && p.ctx;
		if ( ! info || ! ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createBuffer !== 'function' ) return null;
		try {

			if ( ! p.active ) { this.skipped ++; return null; }
			const { at = null, gain = 1 } = opts;
			const now = num( ctx.currentTime, 0 );
			const list = ( this.voices.get( name ) || [] ).filter( ( v ) => v.end > now );
			this.voices.set( name, list );
			const phone = isPhone();
			if ( list.length >= voiceLimit( info, phone ) ) { this.skipped ++; this.limited ++; return null; }
			if ( ! info.prio && this.live( now ) >= ( phone ? VOICE_CAP.phone : VOICE_CAP.desktop ) ) { this.skipped ++; this.capped ++; return null; }
			let dist = 0, g = info.gain * num( gain, 1 ), occ = null;
			if ( at ) {

				const l = p.listener();
				dist = Math.hypot( num( at.x, 0 ) - l.x, num( at.y, l.y ) - l.y, num( at.z, 0 ) - l.z );
				g *= this.distanceGain( name, dist );
				if ( typeof p.occlude === 'function' ) occ = p.occlude( at, info );
				if ( occ ) g *= clamp( num( occ.gain, 1 ), 0, 1 );

			}

			const sink = p._sink( info.cat );
			if ( ! sink ) return null;
			if ( sink.bare ) g *= p.level( 'master' ) ** 2 * p.level( info.cat ) ** 2;
			if ( g < 0.004 ) { this.skipped ++; return null; }

			const out = ctx.createGain();
			out.gain.value = g;
			// through a wall: the low-pass between the cue and its panner / bus
			let head = out, lp = null;
			if ( occ && num( occ.cutoff, 20000 ) < 18000 && typeof ctx.createBiquadFilter === 'function' ) {

				lp = filterNode( ctx, 'lowpass', Math.max( 120, occ.cutoff ), 0.6 );
				out.connect( lp );
				head = lp;

			}

			let panner = null;
			if ( at && typeof ctx.createPanner === 'function' ) {

				panner = ctx.createPanner();
				panner.panningModel = 'HRTF';
				panner.distanceModel = 'inverse';
				panner.refDistance = 1;
				panner.rolloffFactor = 0; // the distance gain is applied above
				panner.maxDistance = 10000;
				if ( panner.positionX ) {

					panner.positionX.value = num( at.x, 0 );
					panner.positionY.value = num( at.y, 0 );
					panner.positionZ.value = num( at.z, 0 );

				} else if ( panner.setPosition ) panner.setPosition( num( at.x, 0 ), num( at.y, 0 ), num( at.z, 0 ) );
				head.connect( panner );
				panner.connect( sink.node );

			} else head.connect( sink.node );

			const delay = clamp( num( opts.delay, 0 ), 0, 12 );
			const t0 = Math.max( now, num( ctx.currentTime, 0 ) ) + 0.01 + delay;
			const dur = num( info.build( ctx, out, t0, opts ), 1 );
			const voice = { name, cat: info.cat, end: t0 + dur, dist, gain: g, at: at ? { x: at.x, y: at.y, z: at.z } : null, node: out, delay, occluded: occ ? occ : null };
			list.push( voice );
			this.count ++;
			this.played.push( { name, cat: info.cat, at: voice.at, dist, gain: g, delay, occluded: occ ? { gain: occ.gain, cutoff: occ.cutoff } : null } );
			if ( this.played.length > 200 ) this.played.shift();
			// the nodes free themselves when their sources end; this drops the output a little after the last one
			if ( typeof setTimeout === 'function' ) {

				const h = setTimeout( () => { try { out.disconnect(); if ( lp ) lp.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* already gone */ } }, Math.ceil( ( delay + dur + 0.3 ) * 1000 ) );
				if ( h && h.unref ) h.unref();

			}

			return voice;

		} catch ( e ) {

			this.failed ++;
			return null;

		}

	}

	busy( name ) {

		const c = this.player && this.player.ctx;
		if ( ! c ) return 0;
		const now = num( c.currentTime, 0 );
		let t = 0;
		for ( const v of this.voices.get( name ) || [] ) t = Math.max( t, v.end - now );
		return Math.max( 0, t );

	}

	stopAll() {

		for ( const list of this.voices.values() ) for ( const v of list ) try { v.node.disconnect(); } catch ( e ) { /* gone */ }
		this.voices.clear();

	}

}
