// Cannon and impact sounds (public/audio/naval/CannonShot_V01.mp3, ShipImpact_V01.mp3: the owner's ElevenLabs
// generations). Played through the game's SoundScape context when there is one: positional (HRTF panner) into its
// sfx bus, so the sfx volume, the mute switch and the underwater muffle apply. Buffers are fetched and decoded
// on first use. Everything is a no-op without app.audio (the ?noAudio flag, node tests).
//
//   const audio = new NavalAudio( app );
//   audio.cannon( x, y, z, gain )     a shot at that world position (heard `distance / 343` seconds later, capped)
//   audio.impact( x, y, z, gain )     a ball into a hull
//   audio.crunch( x, y, z, gain )     two hulls colliding (wave 9): synthesised - a low thump and a burst of splintering noise
//   audio.creak( x, y, z, gain )      timber straining as hulls grind together: a wobbling, filtered saw (synthesised)
//   audio.dispose();   audio.played   [ { name, x, y, z, delay } ] log of requests (tests)

const FILES = { cannon: 'audio/naval/CannonShot_V01.mp3', impact: 'audio/naval/ShipImpact_V01.mp3' };
const MAX_VOICES = 10;

function baseUrl() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

export class NavalAudio {

	constructor( app, { base = baseUrl() } = {} ) {

		this.app = app;
		this.base = base;
		this.buffers = new Map();
		this.loading = new Map();
		this.voices = [];
		this.played = [];
		this.failed = new Set();

	}

	get ctx() {

		const a = this.app && this.app.audio;
		return a && a.ctx && ! a._failed ? a.ctx : null;

	}

	_load( name ) {

		const ctx = this.ctx;
		if ( ! ctx || this.failed.has( name ) ) return null;
		if ( this.buffers.has( name ) ) return Promise.resolve( this.buffers.get( name ) );
		if ( ! this.loading.has( name ) ) {

			this.loading.set( name, fetch( this.base + FILES[ name ] )
				.then( ( r ) => r.arrayBuffer() )
				.then( ( b ) => ctx.decodeAudioData( b ) )
				.then( ( buf ) => {

					this.buffers.set( name, buf );
					return buf;

				} )
				.catch( ( e ) => {

					this.failed.add( name );
					console.warn( 'naval: could not load ' + name, e );
					return null;

				} ) );

		}

		return this.loading.get( name );

	}

	_play( name, x, y, z, gain ) {

		const a = this.app && this.app.audio;
		const ctx = this.ctx;
		// distance from the listener, for the speed of sound
		const L = a && a.env ? a.env : null;
		const d = L ? Math.hypot( x - L.lx, y - L.ly, z - L.lz ) : 0;
		const delay = Math.min( d / 343, 1.6 );
		this.played.push( { name, x, y, z, delay, gain } );
		if ( this.played.length > 64 ) this.played.shift();
		if ( ! ctx || a._muted ) return;
		const p = this._load( name );
		if ( ! p ) return;
		p.then( ( buf ) => {

			if ( ! buf || ! this.ctx ) return;
			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.playbackRate.value = 0.94 + Math.random() * 0.12;
			const g = ctx.createGain();
			g.gain.value = gain;
			const pan = ctx.createPanner();
			pan.panningModel = 'HRTF';
			pan.distanceModel = 'inverse';
			pan.refDistance = 22;
			pan.rolloffFactor = 1.1;
			pan.maxDistance = 4000;
			if ( pan.positionX ) {

				pan.positionX.value = x;
				pan.positionY.value = y;
				pan.positionZ.value = z;

			} else pan.setPosition( x, y, z );

			src.connect( g );
			g.connect( pan );
			pan.connect( a.sfxAbove || a.master || ctx.destination );
			const voice = { src, g, pan };
			this.voices.push( voice );
			if ( this.voices.length > MAX_VOICES ) {

				const old = this.voices.shift();
				try { old.src.stop(); } catch ( e ) { /* already ended */ }

			}

			src.onended = () => {

				const i = this.voices.indexOf( voice );
				if ( i >= 0 ) this.voices.splice( i, 1 );
				try { pan.disconnect(); g.disconnect(); } catch ( e ) { /* ignore */ }

			};
			src.start( ctx.currentTime + delay );

		} );

	}

	cannon( x, y, z, gain = 0.8 ) {

		this._play( 'cannon', x, y, z, gain );

	}

	impact( x, y, z, gain = 0.8 ) {

		this._play( 'impact', x, y, z, gain );

	}

	// a synthesised cue at a world position: build( ctx, out, t0, gain ) wires its nodes into `out` (the panner) and returns
	// how long it lasts (s)
	_synth( name, x, y, z, gain, build ) {

		const a = this.app && this.app.audio;
		const ctx = this.ctx;
		const L = a && a.env ? a.env : null;
		const d = L ? Math.hypot( x - L.lx, y - L.ly, z - L.lz ) : 0;
		const delay = Math.min( d / 343, 1.6 );
		this.played.push( { name, x, y, z, delay, gain } );
		if ( this.played.length > 64 ) this.played.shift();
		if ( ! ctx || a._muted ) return;
		try {

			const pan = ctx.createPanner();
			pan.panningModel = 'HRTF';
			pan.distanceModel = 'inverse';
			pan.refDistance = 18;
			pan.rolloffFactor = 1.1;
			pan.maxDistance = 3000;
			if ( pan.positionX ) {

				pan.positionX.value = x;
				pan.positionY.value = y;
				pan.positionZ.value = z;

			} else pan.setPosition( x, y, z );

			pan.connect( a.sfxAbove || a.master || ctx.destination );
			const t0 = ctx.currentTime + delay;
			const len = build( ctx, pan, t0, gain );
			setTimeout( () => {

				try { pan.disconnect(); } catch ( e ) { /* ignore */ }

			}, ( delay + len + 0.3 ) * 1000 );

		} catch ( e ) { /* audio is decoration */ }

	}

	_noise( ctx ) {

		const key = '_noiseBuf';
		if ( ! this[ key ] || this[ key ].sampleRate !== ctx.sampleRate ) {

			const n = Math.ceil( ctx.sampleRate * 1.5 ), buf = ctx.createBuffer( 1, n, ctx.sampleRate ), ch = buf.getChannelData( 0 );
			for ( let i = 0; i < n; i ++ ) ch[ i ] = Math.random() * 2 - 1;
			this[ key ] = buf;

		}

		const src = ctx.createBufferSource();
		src.buffer = this[ key ];
		src.playbackRate.value = 0.8 + Math.random() * 0.4;
		return src;

	}

	crunch( x, y, z, gain = 0.9 ) {

		this._synth( 'crunch', x, y, z, gain, ( ctx, out, t0, g0 ) => {

			// the thump: a sine dropping from 90 to 38 Hz
			const o = ctx.createOscillator(), og = ctx.createGain();
			o.type = 'sine';
			o.frequency.setValueAtTime( 90, t0 );
			o.frequency.exponentialRampToValueAtTime( 38, t0 + 0.35 );
			og.gain.setValueAtTime( 0.0001, t0 );
			og.gain.exponentialRampToValueAtTime( g0, t0 + 0.012 );
			og.gain.exponentialRampToValueAtTime( 0.0001, t0 + 0.5 );
			o.connect( og ).connect( out );
			o.start( t0 );
			o.stop( t0 + 0.55 );
			// the splintering: band-passed noise in a few cracks
			const n = this._noise( ctx ), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
			bp.type = 'bandpass';
			bp.frequency.value = 900 + Math.random() * 500;
			bp.Q.value = 0.9;
			ng.gain.setValueAtTime( 0.0001, t0 );
			for ( let i = 0; i < 4; i ++ ) {

				const t = t0 + i * ( 0.05 + Math.random() * 0.06 );
				ng.gain.exponentialRampToValueAtTime( g0 * ( 0.7 - i * 0.12 ), t + 0.01 );
				ng.gain.exponentialRampToValueAtTime( 0.02, t + 0.05 );

			}

			ng.gain.exponentialRampToValueAtTime( 0.0001, t0 + 0.6 );
			n.connect( bp ).connect( ng ).connect( out );
			n.start( t0 );
			n.stop( t0 + 0.65 );
			return 0.7;

		} );

	}

	creak( x, y, z, gain = 0.5 ) {

		this._synth( 'creak', x, y, z, gain, ( ctx, out, t0, g0 ) => {

			const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
			const f = 70 + Math.random() * 40, len = 0.6 + Math.random() * 0.5;
			o.type = 'sawtooth';
			o.frequency.setValueAtTime( f, t0 );
			o.frequency.linearRampToValueAtTime( f * 0.7, t0 + len );
			lfo.frequency.value = 11 + Math.random() * 6; // the stick-slip of timber on timber
			lg.gain.value = f * 0.25;
			lfo.connect( lg ).connect( o.frequency );
			bp.type = 'bandpass';
			bp.frequency.value = 520;
			bp.Q.value = 4;
			g.gain.setValueAtTime( 0.0001, t0 );
			g.gain.exponentialRampToValueAtTime( g0 * 0.6, t0 + 0.08 );
			g.gain.exponentialRampToValueAtTime( 0.0001, t0 + len );
			o.connect( bp ).connect( g ).connect( out );
			o.start( t0 );
			lfo.start( t0 );
			o.stop( t0 + len + 0.05 );
			lfo.stop( t0 + len + 0.05 );
			return len;

		} );

	}

	// a dry gun: the hammer falls on an empty pan (out of powder and shot)
	click( x, y, z, gain = 0.6 ) {

		this._synth( 'click', x, y, z, gain, ( ctx, out, t0, g0 ) => {

			const n = this._noise( ctx ), hp = ctx.createBiquadFilter(), g = ctx.createGain();
			hp.type = 'highpass';
			hp.frequency.value = 2400;
			g.gain.setValueAtTime( 0.0001, t0 );
			g.gain.exponentialRampToValueAtTime( g0, t0 + 0.003 );
			g.gain.exponentialRampToValueAtTime( 0.0001, t0 + 0.06 );
			n.connect( hp ).connect( g ).connect( out );
			n.start( t0 );
			n.stop( t0 + 0.08 );
			return 0.1;

		} );

	}

	dispose() {

		for ( const v of this.voices ) {

			try { v.src.stop(); } catch ( e ) { /* ignore */ }

		}

		this.voices.length = 0;
		this.buffers.clear();
		this.loading.clear();

	}

}
