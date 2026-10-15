// Synthesised weather sound through the game's own audio context (app.audio, a SoundScape): no files.
//   rain    filtered white noise in two layers (a bright patter and a body), a flutter that makes it gust
//   rumble  low brown noise under heavy rain and storms
//   wind    a howl: brown noise through a band-pass whose centre drifts, only in strong wind (the SoundScape
//           already plays the recorded wind bed; this adds the storm's top end)
//   thunder one-shots scheduled `delay` seconds after the flash: a crack (close strikes) and a rolling
//           rumble, brown noise through a low-pass that closes while it decays
// Everything hangs off one bus connected to the SoundScape's ambience path (ambAbove: its volume, the master /
// mute and the underwater muffle all apply), or its master, or - for a bare context - the destination with
// the app's volume and mute applied here. Nothing here throws: a missing or failed context just leaves the
// weather silent. The context is created by the SoundScape on the first user gesture, so the graph is built
// the first time an update finds app.audio.ctx.
//
// Rain by surface (what the drops land on near the player, surfaceMix below): the patter / body bed is the ground;
//   wood    sparse drop clicks through a mid band-pass (a pier, the boardwalk, a boat's deck)
//   canvas  the same drops low and dull, a drum (sails overhead aboard a sailing boat, a roof over your head)
//   water   a fizz and small plinks (swimming, aboard, standing at the water's edge)
// Wind up the mast: the howl grows with height above the sea (a hill, a ship's deck) and aboard a sailing boat; a
// rigging whistle joins it aloft, and in fresh wind the canvas flaps (a luffing sail: brown noise chopped at ~6 Hz).
//
//   const wa = new WeatherAudio( app, { rng } );
//   wa.update( dt, { rain: 0..1, wind: m/s, danger: 0..1, shelter: 0..1, surface? } );   surface: surfaceMix() shape,
//                                                                                         read from app.player when absent
//   wa.thunder( delaySeconds, power 0..1 );   wa.dispose();   wa.mix (the last surface mix)

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// boats that carry a sail (Boats.js ids); a catalog entry with `sails: true` counts too
const SAILS = new Set( [ 'cutter', 'sloop', 'brigantine' ] );
const ABOARD = new Set( [ 'boat', 'deck', 'seat', 'ride' ] );

// what the rain falls on around the player, 0..1 each (not normalised: ground is the rest of the bed), and how high
// the wind reaches: { ground, wood, canvas, water, aloft, sails }. No player: all ground, nothing aloft.
export function surfaceMix( app, shelter = 0 ) {

	const out = { ground: 1, wood: 0, canvas: 0, water: 0, aloft: 0, sails: 0 };
	const p = app && app.player;
	if ( ! p || ! p.position ) return out;
	const y = p.position.y, sh = clamp( shelter || 0, 0, 1 );
	if ( p.mode === 'swim' ) {

		out.ground = 0; out.water = 1;
		return out;

	}

	if ( ABOARD.has( p.mode ) ) {

		const st = app.game && app.game.state;
		const id = st && st.boat;
		const def = app.boats && id ? app.boats[ id ] : null;
		const sails = !! ( id && ( SAILS.has( id ) || ( def && def.sails ) ) );
		out.sails = sails ? 1 : 0;
		out.ground = 0;
		out.wood = 0.65 * ( 1 - 0.5 * sh );
		out.water = 0.45;
		out.canvas = Math.max( sails ? 0.7 : 0, 0.6 * sh );
		out.aloft = clamp( smooth( 1.5, 14, y ) + 0.45 * out.sails, 0, 1 );
		return out;

	}

	const T = app.terrainData;
	const h = T && typeof T.heightAt === 'function' ? T.heightAt( p.position.x, p.position.z ) : y;
	// standing on something built: a pier deck, the boardwalk, a porch
	const onDeck = y - h > 0.35 ? 1 : 0;
	out.wood = onDeck * ( 1 - sh );
	out.ground = ( 1 - onDeck ) * ( 1 - 0.6 * sh );
	out.canvas = 0.6 * sh;
	// the sea being rained on: over the water or at its edge
	out.water = 0.6 * smooth( 1.6, - 0.4, h );
	out.aloft = smooth( 4, 40, y );
	return out;

}

export class WeatherAudio {

	constructor( app, { rng = Math.random } = {} ) {

		this.app = app;
		this.rng = rng;
		this.n = null; // the built graph
		this.failed = false;
		this._retry = 0;
		this._acc = 0;
		this._voices = new Set();
		this.thunderCount = 0;
		this.mix = surfaceMix( null );

	}

	get audio() {

		return this.app ? this.app.audio : null;

	}

	get ready() {

		return !! this.n;

	}

	get ctx() {

		const a = this.audio;
		return a && a.ctx ? a.ctx : null;

	}

	_build() {

		const a = this.audio, c = a && a.ctx;
		if ( ! c || this.failed || typeof c.createGain !== 'function' || typeof c.createBuffer !== 'function' ) return false;
		try {

			const gain = ( v, dest ) => {

				const g = c.createGain();
				g.gain.value = v;
				if ( dest ) g.connect( dest );
				return g;

			};

			const filter = ( type, freq, q, dest ) => {

				const b = c.createBiquadFilter();
				b.type = type;
				b.frequency.value = freq;
				if ( q !== undefined ) b.Q.value = q;
				if ( dest ) b.connect( dest );
				return b;

			};

			const sink = a.ambAbove || a.master || null;
			const bare = ! sink;
			const bus = gain( 1, sink || c.destination );
			const muffle = filter( 'lowpass', 20000, 0.7, bus );
			const white = this._noise( c, 4, false, 1 );
			const brown = this._noise( c, 6, true, 2 );
			const loop = ( buf, offset, dest ) => {

				const s = c.createBufferSource();
				s.buffer = buf;
				s.loop = true;
				s.connect( dest );
				s.start( 0, offset % buf.duration );
				return s;

			};

			// rain: patter (bright) and body (mid), both flutter slowly
			const patter = gain( 0, muffle );
			const patterHP = filter( 'highpass', 1400, 0.5, patter );
			const patterPk = filter( 'peaking', 5200, 0.8, patterHP );
			patterPk.gain.value = 5;
			const body = gain( 0, muffle );
			const flutB = gain( 1, body ); // multiplicative flutter (an LFO added to a zero gain would sound at rain 0)
			const bodyBP = filter( 'bandpass', 2100, 0.6, flutB );
			const rumble = gain( 0, muffle );
			const rumbleLP = filter( 'lowpass', 240, 0.7, rumble );
			const howl = gain( 0, muffle );
			const flutH = gain( 1, howl );
			const howlBP = filter( 'bandpass', 520, 1.6, flutH );
			const thunderBus = gain( 1, muffle );
			// rain by surface: sparse drops (clicks) on wood, the same drops low on canvas, fizz and plinks on water
			const drops = this._drops( c, 3, 34, 3 );
			const wood = gain( 0, muffle );
			const woodBP = filter( 'bandpass', 1500, 1.4, wood );
			const canvas = gain( 0, muffle );
			const canvasPk = filter( 'peaking', 210, 1.2, canvas );
			canvasPk.gain.value = 6;
			const canvasLP = filter( 'lowpass', 520, 0.7, canvasPk );
			const water = gain( 0, muffle );
			const waterHP = filter( 'highpass', 3200, 0.6, water );
			const plinkBP = filter( 'bandpass', 2600, 3, water );
			// wind up the mast: a rigging whistle, and the canvas flapping in fresh wind
			const whistle = gain( 0, muffle );
			const whistleBP = filter( 'bandpass', 2200, 9, whistle );
			const flap = gain( 0, muffle );
			const flutF = gain( 1, flap );
			const flapLP = filter( 'lowpass', 300, 0.8, flutF );

			const src = [
				loop( white, 0.0, patterPk ),
				loop( white, 1.7, bodyBP ),
				loop( brown, 0.0, rumbleLP ),
				loop( brown, 2.9, howlBP ),
				loop( drops, 0.0, woodBP ),
				loop( drops, 1.3, canvasLP ),
				loop( white, 0.9, waterHP ),
				loop( drops, 2.1, plinkBP ),
				loop( white, 2.3, whistleBP ),
				loop( brown, 1.1, flapLP ),
			];

			// slow modulators: rain flutter on the body, the howl's centre frequency and level
			const lfos = [];
			const lfo = ( freq, depth, param ) => {

				if ( typeof c.createOscillator !== 'function' ) return;
				const o = c.createOscillator();
				o.frequency.value = freq;
				const g = c.createGain();
				g.gain.value = depth;
				o.connect( g );
				g.connect( param );
				o.start();
				lfos.push( o );

			};

			lfo( 0.37, 0.25, flutB.gain );
			lfo( 0.11, 160, howlBP.frequency );
			lfo( 0.23, 0.35, flutH.gain );
			lfo( 0.17, 500, whistleBP.frequency );
			lfo( 6.3, 0.9, flutF.gain ); // the luff: a sail shaking at ~6 Hz

			this.n = { bus, muffle, patter, body, rumble, howl, thunderBus, howlBP, wood, canvas, water, whistle, flap, src, lfos, white, brown, drops, bare };
			return true;

		} catch ( e ) {

			this.failed = true;
			this.n = null;
			return false;

		}

	}

	// mono noise buffer: white (uniform) or brown (integrated, normalised); seeded so every build sounds the same
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

	// sparse raindrops: silence with short decaying noise bursts at random times (~rate per second), seeded
	_drops( c, seconds, rate, seed ) {

		const sr = c.sampleRate, n = Math.max( 1, Math.floor( sr * seconds ) );
		const buf = c.createBuffer( 1, n, sr );
		const d = buf.getChannelData( 0 );
		let s = ( 0x85ebca6b * seed ) >>> 0;
		const rnd = () => ( s = ( Math.imul( s, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296;
		const count = Math.round( rate * seconds );
		for ( let k = 0; k < count; k ++ ) {

			const at = Math.floor( rnd() * n ), len = Math.max( 4, Math.floor( sr * ( 0.003 + 0.006 * rnd() ) ) );
			const amp = 0.3 + 0.7 * rnd();
			for ( let i = 0; i < len && at + i < n; i ++ ) d[ at + i ] += ( rnd() * 2 - 1 ) * amp * Math.exp( - 5 * i / len );

		}

		return buf;

	}

	// level of the bus when the app's volume is not already applied downstream
	_level() {

		const a = this.audio;
		if ( ! a ) return 0;
		if ( a.muted ) return 0;
		if ( this.n && this.n.bare ) {

			const v = typeof a.volume === 'number' ? a.volume : 0.8;
			return v * v;

		}

		return 1;

	}

	update( dt, s ) {

		const a = this.audio;
		if ( ! a || this.failed ) return;
		try {

			if ( ! this.n ) {

				// the context appears on the first user gesture: look for it about once a second
				this._retry -= dt;
				if ( this._retry > 0 ) return;
				this._retry = 1;
				if ( ! this._build() ) return;

			}

			this._acc += dt;
			if ( this._acc < 0.1 ) return;
			this._acc = 0;
			const c = a.ctx, n = this.n;
			if ( ! c || ! n ) return;
			const now = c.currentTime;
			const rain = clamp( s.rain || 0, 0, 1 );
			const wind = Math.max( 0, s.wind || 0 );
			const danger = clamp( s.danger || 0, 0, 1 );
			const shelter = clamp( s.shelter || 0, 0, 1 );
			const level = this._level();
			const to = ( param, v, tc = 0.4 ) => param.setTargetAtTime( v, now, tc );
			const m = this.mix = s.surface || surfaceMix( this.app, shelter );
			// the bed is the ground's: it thins (never vanishes) on a deck or in the water
			const bed = 0.35 + 0.65 * clamp( m.ground ?? 1, 0, 1 );
			to( n.bus.gain, level, 0.15 );
			to( n.patter.gain, 0.034 * Math.pow( rain, 1.2 ) * bed );
			to( n.body.gain, 0.03 * Math.pow( rain, 1.5 ) * bed );
			to( n.wood.gain, 0.09 * Math.pow( rain, 1.1 ) * clamp( m.wood || 0, 0, 1 ) );
			to( n.canvas.gain, 0.12 * Math.pow( rain, 1.2 ) * clamp( m.canvas || 0, 0, 1 ) );
			to( n.water.gain, 0.03 * Math.pow( rain, 1.2 ) * clamp( m.water || 0, 0, 1 ) );
			to( n.rumble.gain, 0.11 * Math.pow( smooth( 0.45, 1, rain ), 1.4 ) * ( 0.4 + 0.6 * danger ) );
			const aloft = clamp( m.aloft || 0, 0, 1 ), sails = clamp( m.sails || 0, 0, 1 );
			to( n.howl.gain, ( 0.06 * smooth( 10, 22, wind ) * ( 0.6 + 0.4 * danger ) + 0.012 * smooth( 6, 10, wind ) ) * ( 1 + 1.2 * aloft ) );
			to( n.whistle.gain, 0.02 * smooth( 7, 20, wind ) * aloft );
			to( n.flap.gain, 0.06 * sails * smooth( 8, 18, wind ) * ( 0.5 + 0.5 * danger ) );
			// under a roof the rain is dull and close
			to( n.muffle.frequency, 20000 * Math.pow( 1400 / 20000, shelter ), 0.3 );

		} catch ( e ) {

			this.failed = true;

		}

	}

	// a thunderclap `delay` s from now; power 0..1 (close, loud strikes have a crack)
	thunder( delay = 2, power = 0.7 ) {

		const a = this.audio, c = a && a.ctx, n = this.n;
		if ( ! c || ! n || this.failed || a.muted ) return false;
		try {

			const p = clamp( power, 0.1, 1 );
			const t0 = c.currentTime + Math.max( 0.02, delay );
			const dur = 3.5 + 3.5 * p + 2 * this.rng();
			const rumble = c.createBufferSource();
			rumble.buffer = n.brown;
			rumble.loop = true;
			const lp = c.createBiquadFilter();
			lp.type = 'lowpass';
			lp.Q.value = 0.8;
			lp.frequency.setValueAtTime( 700 + 1800 * p, t0 );
			lp.frequency.exponentialRampToValueAtTime( 70, t0 + dur );
			const g = c.createGain();
			g.gain.setValueAtTime( 0, t0 );
			// the crack, then the roll: a decaying envelope with a few swells (echoes off the clouds)
			g.gain.linearRampToValueAtTime( 0.55 * p, t0 + 0.04 );
			const swells = 3 + Math.floor( this.rng() * 3 );
			const at = [];
			for ( let i = 0; i < swells; i ++ ) at.push( 0.3 + this.rng() * ( dur * 0.7 ) );
			at.sort( ( x, y ) => x - y );
			let last = 0.04;
			for ( const t of at ) {

				const env = Math.exp( - t / ( dur * 0.4 ) );
				if ( t - last < 0.25 ) continue;
				g.gain.linearRampToValueAtTime( 0.22 * p * env, t0 + t - 0.12 );
				g.gain.linearRampToValueAtTime( 0.5 * p * env, t0 + t );
				last = t;

			}

			g.gain.linearRampToValueAtTime( 0, t0 + dur );
			rumble.connect( lp );
			lp.connect( g );
			g.connect( n.thunderBus );
			rumble.start( t0, this.rng() * 2 );
			rumble.stop( t0 + dur + 0.1 );
			const nodes = [ rumble, lp, g ];
			// close strikes crack: a short burst of bright noise
			if ( delay < 2.2 || p > 0.8 ) {

				const crack = c.createBufferSource();
				crack.buffer = n.white;
				const hp = c.createBiquadFilter();
				hp.type = 'highpass';
				hp.frequency.value = 1800;
				const cg = c.createGain();
				cg.gain.setValueAtTime( 0, t0 );
				cg.gain.linearRampToValueAtTime( 0.16 * p, t0 + 0.005 );
				cg.gain.exponentialRampToValueAtTime( 0.001, t0 + 0.35 );
				crack.connect( hp );
				hp.connect( cg );
				cg.connect( n.thunderBus );
				crack.start( t0, this.rng() );
				crack.stop( t0 + 0.4 );
				nodes.push( crack, hp, cg );

			}

			const voice = { nodes };
			this._voices.add( voice );
			rumble.onended = () => {

				for ( const x of nodes ) { try { x.disconnect(); } catch ( e ) { /* gone */ } }
				this._voices.delete( voice );

			};

			this.thunderCount ++;
			return true;

		} catch ( e ) {

			return false;

		}

	}

	dispose() {

		const n = this.n;
		this.n = null;
		this.failed = true;
		if ( ! n ) return;
		const stop = ( x ) => { try { x.stop(); } catch ( e ) { /* not started */ } try { x.disconnect(); } catch ( e ) { /* gone */ } };
		for ( const s of n.src ) stop( s );
		for ( const o of n.lfos ) stop( o );
		for ( const v of this._voices ) for ( const x of v.nodes ) stop( x );
		this._voices.clear();
		for ( const k of [ 'patter', 'body', 'wood', 'canvas', 'water', 'rumble', 'howl', 'whistle', 'flap', 'thunderBus', 'muffle', 'bus' ] ) { try { n[ k ].disconnect(); } catch ( e ) { /* gone */ } }

	}

}
