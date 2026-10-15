// Combat sounds for the melee feature: the owner's naval-fork recordings (public/audio/combat, see
// CREDITS.txt there) played through the game's SoundScape context. SoundScape has no hook for new banks, so
// this keeps its own small buffer cache and plays one-shots into audio.sfxAbove (the sfx volume category)
// from the same AudioContext; positional sounds go through an HRTF panner at the world position (the
// SoundScape moves the context's listener every frame).
//
//   const sfx = new CombatAudio( app.audio );        // app.audio may be null (?noAudio) or not resumed yet: then every call is a no-op
//   sfx.play( 'paddleSwing', { at: { x, y, z }, rate: 0.9, gain: 0.8 } )   // at omitted: heard in the head
//   sfx.preload()                                    // fetch + decode every file (after the first user gesture)
//
// Banks: paddleSwing, hookSwing (whooshes), paddleHit, hookHit (impacts). `lead` is how long before the
// swing's contact a whoosh must start so its peak lands on the contact (the files' peaks are 0.02 - 0.16 s in).
// Synthesised (wave 4, no file): 'tell' (the bright tick at the start of a raider's wind-up) and 'parry' (a ringing clang).

export const BANKS = {
	paddleSwing: { files: [ 'paddle_swing_1', 'paddle_swing_2', 'paddle_swing_3', 'paddle_swing_4' ], lead: 0.12 },
	hookSwing: { files: [ 'hook_swing_1', 'hook_swing_2', 'hook_swing_3', 'hook_swing_4' ], lead: 0.05 },
	paddleHit: { files: [ 'paddle_hit_1', 'paddle_hit_2' ], lead: 0 },
	hookHit: { files: [ 'hook_hit_1', 'hook_hit_2', 'hook_hit_3' ], lead: 0 },
};

function baseUrl() {

	try {

		return ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'audio/combat/';

	} catch ( e ) {

		return 'audio/combat/'; // no import.meta.env (plain node): relative to the page

	}

}

export class CombatAudio {

	constructor( audio, { url = baseUrl(), fetchImpl = null } = {} ) {

		this.audio = audio || null;
		this.url = url;
		this.fetchImpl = fetchImpl;
		this.buffers = new Map(); // file -> AudioBuffer
		this.loading = new Map(); // file -> Promise
		this.last = {}; // bank -> last variant (never the same twice in a row)
		this.failed = new Set();
		this.played = 0;

	}

	get ctx() {

		return this.audio && this.audio.ctx ? this.audio.ctx : null;

	}

	lead( bank ) {

		return BANKS[ bank ] ? BANKS[ bank ].lead : 0;

	}

	preload() {

		if ( ! this.ctx ) return Promise.resolve( 0 );
		const jobs = [];
		for ( const b of Object.values( BANKS ) ) for ( const f of b.files ) jobs.push( this._load( f ) );
		return Promise.all( jobs ).then( ( r ) => r.filter( Boolean ).length );

	}

	_load( file ) {

		if ( this.buffers.has( file ) ) return Promise.resolve( this.buffers.get( file ) );
		if ( this.failed.has( file ) || ! this.ctx ) return Promise.resolve( null );
		if ( this.loading.has( file ) ) return this.loading.get( file );
		const f = this.fetchImpl || ( typeof fetch === 'function' ? fetch : null );
		if ( ! f ) return Promise.resolve( null );
		const ctx = this.ctx;
		const p = f( this.url + file + '.ogg' )
			.then( ( r ) => { if ( ! r.ok ) throw new Error( 'HTTP ' + r.status ); return r.arrayBuffer(); } )
			.then( ( ab ) => new Promise( ( res, rej ) => ctx.decodeAudioData( ab, res, rej ) ) )
			.then( ( buf ) => { this.buffers.set( file, buf ); this.loading.delete( file ); return buf; } )
			.catch( ( e ) => { this.failed.add( file ); this.loading.delete( file ); return null; } );
		this.loading.set( file, p );
		return p;

	}

	// returns true when a sound was started (a sound whose file is still loading starts the load and skips this one)
	play( bank, { at = null, rate = 1, gain = 1, jitter = 0.05 } = {} ) {

		if ( SYNTH[ bank ] ) return this._synth( bank, { at, gain } );
		const info = BANKS[ bank ];
		const ctx = this.ctx;
		if ( ! info || ! ctx || ! this.audio.sfxAbove ) return false;
		const n = info.files.length;
		let i = Math.floor( Math.random() * n );
		if ( n > 1 && i === this.last[ bank ] ) i = ( i + 1 ) % n;
		this.last[ bank ] = i;
		const file = info.files[ i ];
		const buf = this.buffers.get( file );
		if ( ! buf ) {

			this._load( file );
			return false;

		}

		try {

			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.playbackRate.value = rate * ( 1 + ( Math.random() * 2 - 1 ) * jitter );
			const g = ctx.createGain();
			g.gain.value = gain;
			src.connect( g );
			let panner = null;
			if ( at && ctx.createPanner ) {

				panner = ctx.createPanner();
				panner.panningModel = 'HRTF';
				panner.distanceModel = 'inverse';
				panner.refDistance = 3;
				panner.rolloffFactor = 1.2;
				panner.maxDistance = 10000;
				if ( panner.positionX ) {

					panner.positionX.value = at.x;
					panner.positionY.value = at.y;
					panner.positionZ.value = at.z;

				} else if ( panner.setPosition ) panner.setPosition( at.x, at.y, at.z );
				g.connect( panner );
				panner.connect( this.audio.sfxAbove );

			} else g.connect( this.audio.sfxAbove );

			src.onended = () => {

				try { g.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* already gone */ }

			};

			src.start();
			this.played ++;
			return true;

		} catch ( e ) {

			return false;

		}

	}

	// a short synthesised one-shot (SYNTH): oscillator partials with an exponential decay, panned like the samples
	_synth( bank, { at = null, gain = 1 } = {} ) {

		const ctx = this.ctx, s = SYNTH[ bank ];
		if ( ! ctx || ! this.audio.sfxAbove || ! ctx.createOscillator ) return false;
		try {

			const t0 = ctx.currentTime;
			const out = ctx.createGain();
			out.gain.value = gain * s.gain;
			let dest = this.audio.sfxAbove, panner = null;
			if ( at && ctx.createPanner ) {

				panner = ctx.createPanner();
				panner.panningModel = 'HRTF';
				panner.refDistance = 3;
				if ( panner.positionX ) { panner.positionX.value = at.x; panner.positionY.value = at.y; panner.positionZ.value = at.z; }
				panner.connect( dest );
				dest = panner;

			}

			out.connect( dest );
			for ( const [ f, a ] of s.partials ) {

				const o = ctx.createOscillator(), g = ctx.createGain();
				o.type = s.type;
				o.frequency.setValueAtTime( f, t0 );
				if ( s.drop ) o.frequency.exponentialRampToValueAtTime( f * s.drop, t0 + s.len );
				g.gain.setValueAtTime( 0.0001, t0 );
				g.gain.exponentialRampToValueAtTime( a, t0 + 0.004 );
				g.gain.exponentialRampToValueAtTime( 0.0001, t0 + s.len );
				o.connect( g );
				g.connect( out );
				o.start( t0 );
				o.stop( t0 + s.len + 0.02 );
				o.onended = () => { try { g.disconnect(); } catch ( e ) { /* gone */ } };

			}

			setTimeout( () => { try { out.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* gone */ } }, ( s.len + 0.1 ) * 1000 );
			this.played ++;
			return true;

		} catch ( e ) {

			return false;

		}

	}

}

// synthesised banks: partials [ Hz, amplitude ], decay length (s), oscillator type, pitch drop over the length
export const SYNTH = {
	tell: { partials: [ [ 1760, 0.5 ], [ 2640, 0.22 ] ], len: 0.12, type: 'triangle', gain: 0.35, drop: 0.92 },
	parry: { partials: [ [ 820, 0.5 ], [ 1230, 0.35 ], [ 2050, 0.25 ], [ 3310, 0.12 ] ], len: 0.55, type: 'sine', gain: 0.6, drop: 0.985 },
};
