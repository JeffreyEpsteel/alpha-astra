// The tavern's sound, synthesised through the game's own audio context like the weather (no files):
//   bed      a warm low room tone: brown noise through a low-pass, always under the crowd
//   murmur   the crowd: noise through two voice-band filters (around 420 Hz and 1.1 kHz) whose levels flutter at
//            syllable rates, so it reads as many people talking, not as wind
//   clinks   now and then a cup or a die on a table: a short bright partial pair with a fast decay
// The level follows the distance to the nearest tavern (loud inside the panel, gone by ~38 m) and the crowd
// (how many people sit on the patio or inside: harbour.crowd()). Everything hangs off one bus on the
// SoundScape's ambience path (ambAbove: its slider, the master, mute and the underwater muffle apply), like
// weather/WeatherAudio.js. Nothing here throws; without app.audio.ctx (tests, ?noAudio) it stays silent.
//
//   const ta = new TavernAudio( app );
//   ta.update( dt, { distance: m, crowd: 0..1, inside: bool } );   ta.dispose();

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
export const HEAR_M = 38;

// how loud the tavern is: 0 beyond HEAR_M, full inside; a quiet room still has its bed
export function tavernLevel( distance, crowd, inside = false ) {

	if ( inside ) return 0.55 + 0.45 * clamp( crowd, 0, 1 );
	if ( ! Number.isFinite( distance ) || distance >= HEAR_M ) return 0;
	const near = 1 - clamp( ( distance - 3 ) / ( HEAR_M - 3 ), 0, 1 );
	return near * near * ( 0.25 + 0.75 * clamp( crowd, 0, 1 ) ) * 0.7;

}

export class TavernAudio {

	constructor( app, { rng = Math.random } = {} ) {

		this.app = app;
		this.rng = rng;
		this.n = null;
		this.failed = false;
		this.level = 0;
		this.clinkT = 2;
		this.clinks = 0;

	}

	get ctx() {

		const a = this.app && this.app.audio;
		return a && a.ctx ? a.ctx : null;

	}

	_build() {

		const a = this.app && this.app.audio, c = a && a.ctx;
		if ( ! c || this.failed || typeof c.createGain !== 'function' || typeof c.createBuffer !== 'function' ) return false;
		try {

			const gain = ( v, dest ) => {

				const g = c.createGain();
				g.gain.value = v;
				if ( dest ) g.connect( dest );
				return g;

			};

			const filter = ( type, f, q, dest ) => {

				const b = c.createBiquadFilter();
				b.type = type;
				b.frequency.value = f;
				b.Q.value = q;
				if ( dest ) b.connect( dest );
				return b;

			};

			const sink = a.ambAbove || a.master || c.destination;
			const bus = gain( 0, sink );
			const brown = this._noise( c, 5, true, 11 ), white = this._noise( c, 3, false, 12 );
			const loop = ( buf, off, dest ) => {

				const s = c.createBufferSource();
				s.buffer = buf;
				s.loop = true;
				s.connect( dest );
				s.start( 0, off % buf.duration );
				return s;

			};

			const bed = gain( 0.22, bus );
			const bedLP = filter( 'lowpass', 320, 0.7, bed );
			const lowV = gain( 0.5, bus ), highV = gain( 0.18, bus );
			const flutL = gain( 1, lowV ), flutH = gain( 1, highV );
			const lowBP = filter( 'bandpass', 420, 1.1, flutL );
			const highBP = filter( 'bandpass', 1100, 1.4, flutH );
			const clinkBus = gain( 0.5, bus );
			const src = [ loop( brown, 0, bedLP ), loop( brown, 2.3, lowBP ), loop( white, 1.1, highBP ) ];
			const lfos = [];
			const lfo = ( f, depth, param ) => {

				if ( typeof c.createOscillator !== 'function' ) return;
				const o = c.createOscillator();
				o.frequency.value = f;
				const g = c.createGain();
				g.gain.value = depth;
				o.connect( g );
				g.connect( param );
				o.start();
				lfos.push( o );

			};

			// syllable-rate flutter at unrelated rates (several talkers), and a slow swell of the room
			lfo( 3.7, 0.28, flutL.gain );
			lfo( 5.3, 0.2, flutL.gain );
			lfo( 4.4, 0.35, flutH.gain );
			lfo( 0.13, 0.15, lowV.gain );
			lfo( 0.6, 120, lowBP.frequency );
			this.n = { bus, clinkBus, src, lfos };
			return true;

		} catch ( e ) {

			this.failed = true;
			this.n = null;
			return false;

		}

	}

	_noise( c, seconds, brown, seed ) {

		const n = Math.max( 1, Math.floor( c.sampleRate * seconds ) );
		const buf = c.createBuffer( 1, n, c.sampleRate );
		const d = buf.getChannelData( 0 );
		let s = ( 0x9e3779b9 * seed ) >>> 0, last = 0, peak = 1e-6;
		for ( let i = 0; i < n; i ++ ) {

			s = ( Math.imul( s, 1664525 ) + 1013904223 ) >>> 0;
			const w = s / 2147483648 - 1;
			if ( brown ) {

				last = ( last + 0.02 * w ) / 1.02;
				d[ i ] = last;
				if ( Math.abs( last ) > peak ) peak = Math.abs( last );

			} else d[ i ] = w;

		}

		if ( brown ) for ( let i = 0; i < n; i ++ ) d[ i ] = d[ i ] / peak * 0.9;
		return buf;

	}

	_clink( c, level ) {

		try {

			const t = c.currentTime, f = 2600 + this.rng() * 1700;
			const g = c.createGain();
			g.gain.setValueAtTime( 0.0001, t );
			g.gain.exponentialRampToValueAtTime( 0.12 * level, t + 0.004 );
			g.gain.exponentialRampToValueAtTime( 0.0001, t + 0.22 );
			g.connect( this.n.clinkBus );
			for ( const k of [ 1, 2.76 ] ) {

				const o = c.createOscillator();
				o.type = 'sine';
				o.frequency.value = f * k;
				o.connect( g );
				o.start( t );
				o.stop( t + 0.25 );

			}

			this.clinks ++;

		} catch ( e ) { /* a missed clink is fine */ }

	}

	update( dt, { distance = Infinity, crowd = 0, inside = false } = {} ) {

		const want = tavernLevel( distance, crowd, inside );
		this.level += ( want - this.level ) * ( 1 - Math.exp( - dt * 2 ) );
		const c = this.ctx;
		if ( ! c ) return;
		if ( ! this.n ) {

			if ( this.level < 0.005 || ! this._build() ) return;

		}

		const a = this.app.audio;
		const vol = a && a.muted ? 0 : this.level;
		try { this.n.bus.gain.setTargetAtTime( vol, c.currentTime, 0.25 ); } catch ( e ) { /* ignore */ }
		if ( vol > 0.02 ) {

			this.clinkT -= dt;
			if ( this.clinkT <= 0 ) {

				this.clinkT = 1.5 + this.rng() * ( 6 - 4 * clamp( crowd, 0, 1 ) );
				this._clink( c, vol );

			}

		}

	}

	dispose() {

		if ( ! this.n ) return;
		for ( const s of [ ...this.n.src, ...this.n.lfos ] ) try { s.stop(); } catch ( e ) { /* ignore */ }
		try { this.n.bus.disconnect(); } catch ( e ) { /* ignore */ }
		this.n = null;

	}

}
