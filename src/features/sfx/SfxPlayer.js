// Sample player for the dynamic-audio layer: lazy fetch + decode of the files in public/audio/sfx and one-shot
// playback through the game's SoundScape context (app.audio). The SoundScape has no hook for new banks, so
// this keeps its own buffer cache (like melee's CombatAudio) and plays into its category nodes:
//   cat 'sfx'      -> audio.sfxAbove   (the sfx volume; the underwater muffle applies)
//   cat 'ambience' -> audio.ambAbove   (the ambience volume)
// so the master volume, the mute switch and the two category sliders already apply in the graph. A context
// without those nodes (a bare one) gets the master / mute / category volume applied here instead.
//
//   const p = new SfxPlayer( app );                   // app.audio may be null (?noAudio) or not resumed yet: then it is silent
//   p.preload( [ 'thwack', 'thud' ] );                // start loading (call early; a sound that is not decoded yet is skipped)
//   p.play( 'splinter', { at: { x, y, z }, gain: 0.8, rate: 1.1 } )   // -> voice | null
//
// Positional sounds get a gain by distance (inverse law from `ref` m, culled beyond `max` m) computed here, so
// it is the same on every browser, plus an HRTF panner (distance model off) for the direction; the context's
// listener is moved every frame by the SoundScape. Without `at` a sound is heard in the head.
// Nothing here throws: any failure returns null.

export const FILES = {
	// name: { cat, gain (base, 0..1), ref (m, full level within), max (m, silent beyond), voices (simultaneous), fade (s in/out) }
	thwack: { cat: 'sfx', gain: 0.8, ref: 2, max: 40, voices: 2, fade: 0 },
	thud: { cat: 'sfx', gain: 0.8, ref: 2, max: 40, voices: 2, fade: 0 },
	line_creak: { cat: 'sfx', gain: 0.5, ref: 2, max: 40, voices: 3, fade: 0 },
	rigging_strain: { cat: 'ambience', gain: 0.6, ref: 5, max: 70, voices: 2, fade: 0 },
	hull_groan: { cat: 'ambience', gain: 0.7, ref: 5, max: 70, voices: 2, fade: 0 },
	sail_luff: { cat: 'ambience', gain: 0.55, ref: 5, max: 70, voices: 2, fade: 0 },
	cannon_reload: { cat: 'sfx', gain: 0.8, ref: 6, max: 90, voices: 2, fade: 0 },
	splinter: { cat: 'sfx', gain: 0.8, ref: 5, max: 90, voices: 3, fade: 0 },
	clown_prank: { cat: 'sfx', gain: 0.95, ref: 5, max: 60, voices: 1, fade: 0 },
	bran_workshop: { cat: 'sfx', gain: 0.85, ref: 3, max: 32, voices: 1, fade: 0.12 },
	iona_workshop: { cat: 'sfx', gain: 0.85, ref: 3, max: 32, voices: 1, fade: 0.12 },
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const num = ( v, d ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );

function baseUrl() {

	try {

		return ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'audio/sfx/';

	} catch ( e ) {

		return 'audio/sfx/'; // no import.meta.env (plain node): relative to the page

	}

}

export class SfxPlayer {

	constructor( app, { url = baseUrl(), fetchImpl = null } = {} ) {

		this.app = app || null;
		this.url = url;
		this.fetchImpl = fetchImpl;
		this.buffers = new Map(); // name -> AudioBuffer
		this.loading = new Map(); // name -> Promise
		this.failed = new Set();
		this.voices = new Map(); // name -> [ voice ]
		this.played = []; // log of the last plays (tests, debugging): { name, cat, at, dist, gain, rate }
		this.count = 0; // sounds started
		this.skipped = 0; // sounds asked for but not started (not loaded yet, muted, too far)
		// (wave 20B) occlude( at, info ) -> { gain, cutoff } | null: a wall between a positional sound and the listener (the
		// sfx feature sets it from the interiors); the synthesised cues (Synth.js) read the same hook
		this.occlude = null;

	}

	get audio() {

		return this.app && this.app.audio ? this.app.audio : null;

	}

	get ctx() {

		const a = this.audio;
		return a && a.ctx && ! a._failed ? a.ctx : null;

	}

	// the audio is on: a running context, not muted, master volume up
	get active() {

		const a = this.audio, c = this.ctx;
		if ( ! a || ! c ) return false;
		if ( a.muted === true || a.enabled === false || c.state === 'suspended' || c.state === 'closed' ) return false;
		return this.level( 'master' ) > 0.001;

	}

	// 0..1 slider value of a category ('master' | 'sfx' | 'ambience'); 1 when the audio does not report volumes
	level( kind ) {

		const a = this.audio;
		if ( ! a || typeof a.getVolume !== 'function' ) return 1;
		try {

			return clamp( num( a.getVolume( kind ), 1 ), 0, 1 );

		} catch ( e ) {

			return 1;

		}

	}

	// the listener (world metres): the SoundScape's, else the player's eye, else the camera
	listener() {

		const a = this.audio, e = a && a.env;
		if ( e && Number.isFinite( e.lx ) && Number.isFinite( e.lz ) ) return { x: e.lx, y: num( e.ly, 1.7 ), z: e.lz };
		const p = this.app && ( this.app.player && this.app.player.position || this.app.camera && this.app.camera.position );
		return p ? { x: num( p.x, 0 ), y: num( p.y, 0 ) + 1.7, z: num( p.z, 0 ) } : { x: 0, y: 1.7, z: 0 };

	}

	has( name ) {

		return this.buffers.has( name );

	}

	_sink( cat ) {

		const a = this.audio;
		if ( ! a ) return null;
		const node = cat === 'ambience' ? a.ambAbove : a.sfxAbove;
		return node ? { node, bare: false } : { node: a.master || this.ctx.destination, bare: ! a.master };

	}

	_load( name ) {

		if ( this.buffers.has( name ) ) return Promise.resolve( this.buffers.get( name ) );
		if ( ! FILES[ name ] || this.failed.has( name ) || ! this.ctx ) return Promise.resolve( null );
		if ( this.loading.has( name ) ) return this.loading.get( name );
		const f = this.fetchImpl || ( typeof fetch === 'function' ? fetch : null );
		if ( ! f ) return Promise.resolve( null );
		const ctx = this.ctx;
		let p;
		try {

			p = Promise.resolve( f( this.url + name + '.ogg' ) )
				.then( ( r ) => { if ( ! r.ok ) throw new Error( 'HTTP ' + r.status ); return r.arrayBuffer(); } )
				.then( ( ab ) => new Promise( ( res, rej ) => {

					const r = ctx.decodeAudioData( ab, res, rej );
					if ( r && typeof r.then === 'function' ) r.then( res, rej );

				} ) )
				.then( ( buf ) => { this.buffers.set( name, buf ); this.loading.delete( name ); return buf; } )
				.catch( () => { this.failed.add( name ); this.loading.delete( name ); return null; } );

		} catch ( e ) {

			this.failed.add( name );
			return Promise.resolve( null );

		}

		this.loading.set( name, p );
		return p;

	}

	// start loading these files (decoding happens once; safe to call every frame)
	preload( names ) {

		if ( ! this.ctx ) return Promise.resolve( 0 );
		return Promise.all( ( Array.isArray( names ) ? names : [ names ] ).map( ( n ) => this._load( n ) ) ).then( ( r ) => r.filter( Boolean ).length );

	}

	// gain by distance (1 inside ref, inverse beyond, 0 past max)
	distanceGain( name, d ) {

		const f = FILES[ name ];
		if ( ! f ) return 0;
		if ( d >= f.max ) return 0;
		return d <= f.ref ? 1 : f.ref / ( f.ref + 1.1 * ( d - f.ref ) );

	}

	// Starts a sound. opts: at { x, y, z } (world; omitted = in the head), gain (x base), rate, jitter (+- rate fraction).
	// Returns the voice { name, end, dist, gain } or null (not active, not loaded yet - the load is started -, too far
	// or too quiet, or the sound's voice limit is reached).
	play( name, { at = null, gain = 1, rate = 1, jitter = 0.04 } = {} ) {

		const info = FILES[ name ];
		const ctx = this.ctx;
		if ( ! info || ! ctx ) return null;
		try {

			if ( ! this.active ) { this.skipped ++; return null; }
			const buf = this.buffers.get( name );
			if ( ! buf ) {

				this._load( name );
				this.skipped ++;
				return null;

			}

			const now = num( ctx.currentTime, 0 );
			const list = ( this.voices.get( name ) || [] ).filter( ( v ) => v.end > now );
			this.voices.set( name, list );
			if ( list.length >= info.voices ) { this.skipped ++; return null; }

			let dist = 0, g = info.gain * num( gain, 1 ), occ = null;
			if ( at ) {

				const l = this.listener();
				dist = Math.hypot( num( at.x, 0 ) - l.x, num( at.y, l.y ) - l.y, num( at.z, 0 ) - l.z );
				g *= this.distanceGain( name, dist );
				if ( typeof this.occlude === 'function' ) occ = this.occlude( at, info );
				if ( occ ) g *= clamp( num( occ.gain, 1 ), 0, 1 );

			}

			const sink = this._sink( info.cat );
			if ( ! sink ) return null;
			if ( sink.bare ) g *= this.level( 'master' ) ** 2 * this.level( info.cat ) ** 2;
			if ( g < 0.004 ) { this.skipped ++; return null; }

			const r = rate * ( 1 + ( Math.random() * 2 - 1 ) * jitter );
			const src = ctx.createBufferSource();
			src.buffer = buf;
			if ( src.playbackRate ) src.playbackRate.value = r;
			const gn = ctx.createGain();
			const dur = num( buf.duration, 1 ) / Math.max( 0.1, r );
			const t0 = Math.max( now, num( ctx.currentTime, 0 ) ) + 0.005;
			const gp = gn.gain;
			if ( info.fade > 0 && gp && gp.setValueAtTime && gp.linearRampToValueAtTime ) {

				const f = Math.min( info.fade, dur / 3 );
				gp.setValueAtTime( 0, t0 );
				gp.linearRampToValueAtTime( g, t0 + f );
				gp.setValueAtTime( g, t0 + dur - f );
				gp.linearRampToValueAtTime( 0, t0 + dur );

			} else gp.value = g;

			src.connect( gn );
			// through a wall: a low-pass after the voice's gain
			let head = gn, lp = null;
			if ( occ && num( occ.cutoff, 20000 ) < 18000 && typeof ctx.createBiquadFilter === 'function' ) {

				lp = ctx.createBiquadFilter();
				lp.type = 'lowpass';
				lp.frequency.value = Math.max( 120, occ.cutoff );
				gn.connect( lp );
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

			src.onended = () => {

				try { gn.disconnect(); if ( lp ) lp.disconnect(); if ( panner ) panner.disconnect(); } catch ( e ) { /* already gone */ }

			};

			src.start( t0 );
			const voice = { name, cat: info.cat, end: t0 + dur, dist, gain: g, rate: r, at: at ? { x: at.x, y: at.y, z: at.z } : null, src, node: gn };
			list.push( voice );
			this.count ++;
			this.played.push( { name, cat: info.cat, at: voice.at, dist, gain: g, rate: r, occluded: occ ? { gain: occ.gain, cutoff: occ.cutoff } : null } );
			if ( this.played.length > 200 ) this.played.shift();
			return voice;

		} catch ( e ) {

			return null;

		}

	}

	// seconds a sound is still sounding (0 when idle): lets callers avoid talking over themselves
	busy( name ) {

		const c = this.ctx;
		if ( ! c ) return 0;
		const now = num( c.currentTime, 0 );
		let t = 0;
		for ( const v of this.voices.get( name ) || [] ) t = Math.max( t, v.end - now );
		return Math.max( 0, t );

	}

	stopAll() {

		for ( const list of this.voices.values() ) for ( const v of list ) {

			try { v.src.stop(); } catch ( e ) { /* not started or already stopped */ }

		}

		this.voices.clear();

	}

	dispose() {

		this.stopAll();
		this.buffers.clear();
		this.loading.clear();

	}

}
