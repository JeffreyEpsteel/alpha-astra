// Captain Roid's clicks: his click-and-call voice from the owner's naval fork (src/audio/RoidVoice.js,
// ported from the fork's browser prototype). Each kind is one of his lines, rendered once per audio
// context into a buffer and played through the game's context, so the words in the subtitles line up
// with the calls:
//   first   the first meeting            repeat  later meetings       open    his panel opens
//   hover   two quiet clicks (a row)     buy     a boat sold          broke   not enough money
//   bye     he says goodbye ('leave')    who     who he is
//   harbour / fishing / danger   the answers of his Talk topics (TOPICS)
// ('hello' is kept as an alias of 'first'.)
//
//   const clicks = new Clicks( { getContext: () => app.audio && app.audio.ctx } );
//   const said = clicks.burst( 'first', position );   // -> { kind, phrases: [ { text, start, end } ], duration } | false
//
// The context is the game's (SoundScape.ctx) when getContext gives one, else a small context of its
// own made on the first user gesture. With a position (anything with x / z) the voice fades with the
// distance to the listener: full within 2 m, silent at 18 m. Muted / suspended / no audio: returns false
// quietly, never throws. Subtitles are the caller's (CaptainRoid shows them from `phrases`).

import { LINES, renderLine, lineTiming } from './RoidVoice.js';

export const NEAR = 2, FAR = 18;

// gain by distance (m): 1 within NEAR, 0 at FAR, smooth in between
export function clickGain( d ) {

	if ( ! ( d > NEAR ) ) return 1;
	if ( d >= FAR ) return 0;
	const t = 1 - ( d - NEAR ) / ( FAR - NEAR );
	return t * t;

}

// kind -> { line (RoidVoice LINES id), vol }
export const BURSTS = {
	first: { line: 'first', vol: 0.9 },
	hello: { line: 'first', vol: 0.9 },
	repeat: { line: 'repeat', vol: 0.9 },
	open: { line: 'open', vol: 0.8 },
	hover: { line: 'hover', vol: 0.45 },
	buy: { line: 'buy', vol: 1.0 },
	broke: { line: 'broke', vol: 0.8 },
	bye: { line: 'leave', vol: 0.75 },
	who: { line: 'who', vol: 0.85 },
	harbour: { line: 'harbour', vol: 0.85 },
	fishing: { line: 'fishing', vol: 0.85 },
	danger: { line: 'danger', vol: 0.85 },
};

// the topics of his panel's Talk tab (the fork's list and labels): choosing one asks `label`, he answers
// with the clicks of `kind` and the subtitles of that line. 'leave' is Goodbye: the panel closes.
export const TOPICS = [
	{ id: 'who', kind: 'who', label: 'Who are you?' },
	{ id: 'harbour', kind: 'harbour', label: 'Where do I berth my boat?' },
	{ id: 'fishing', kind: 'fishing', label: 'Where is the fishing good?' },
	{ id: 'danger', kind: 'danger', label: 'Anything dangerous around here?' },
	{ id: 'leave', kind: 'bye', label: 'Goodbye.', closes: true },
];

// the subtitles of a kind without playing it (timing only)
export function linePhrases( kind ) {

	const b = BURSTS[ kind ];
	if ( ! b || ! LINES[ b.line ] ) return null;
	const t = lineTiming( LINES[ b.line ] );
	return { kind, phrases: t.phrases.map( ( p ) => ( { text: p.text, start: p.start, end: p.end } ) ), duration: t.duration };

}

export class Clicks {

	constructor( { getContext = null, getListener = null, getAudio = null } = {} ) {

		this.getContext = getContext;
		this.getListener = getListener; // () => { x, z } | null; default: the player, else the context's listener
		this.getAudio = getAudio || ( () => globalThis.__app && globalThis.__app.audio );
		this.own = null; // our own context, only when the game gives none
		this._buffers = new WeakMap(); // context -> Map( line id -> AudioBuffer )
		this._armed = false;
		this._voice = null; // the line speaking now: { out, end } (a new line cuts the old one short)
		this.last = null; // { kind, line, gain } of the latest line (diagnostics)
		this._armOwn();

	}

	// a context of our own, made on the first user gesture (autoplay policy)
	_armOwn() {

		if ( this._armed || typeof window === 'undefined' || ! window.addEventListener ) return;
		this._armed = true;
		const make = () => {

			for ( const e of [ 'pointerdown', 'keydown' ] ) window.removeEventListener( e, make, true );
			try {

				const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
				if ( typeof AC === 'function' && ! this.own ) this.own = new AC( { latencyHint: 'interactive' } );

			} catch ( e ) { /* no audio */ }

		};

		for ( const e of [ 'pointerdown', 'keydown' ] ) window.addEventListener( e, make, true );

	}

	context() {

		let c = null;
		try {

			c = this.getContext ? this.getContext() : null;

		} catch ( e ) { c = null; }

		return c || this.own;

	}

	listener( ctx ) {

		try {

			if ( this.getListener ) {

				const l = this.getListener();
				if ( l ) return l;

			}

			const app = globalThis.__app;
			if ( app && app.player && app.player.position ) return app.player.position;
			const L = ctx && ctx.listener;
			if ( L && L.positionX ) return { x: L.positionX.value, z: L.positionZ.value };

		} catch ( e ) { /* none */ }

		return null;

	}

	// the volume the game's settings ask for: 0 when muted, volume squared like SoundScape
	volume() {

		let a = null;
		try {

			a = this.getAudio ? this.getAudio() : null;

		} catch ( e ) { a = null; }

		if ( ! a ) return 1;
		if ( a.muted ) return 0;
		return typeof a.volume === 'number' ? a.volume * a.volume : 1;

	}

	// the rendered buffer of a line for a context (made once)
	buffer( ctx, lineId ) {

		let m = this._buffers.get( ctx );
		if ( ! m ) this._buffers.set( ctx, m = new Map() );
		if ( m.has( lineId ) ) return m.get( lineId );
		const rate = ctx.sampleRate || 44100;
		const { samples } = renderLine( LINES[ lineId ], rate );
		const buf = ctx.createBuffer( 1, samples.length, rate );
		if ( buf.copyToChannel ) buf.copyToChannel( samples, 0 );
		else buf.getChannelData( 0 ).set( samples );
		m.set( lineId, buf );
		return buf;

	}

	burst( kind = 'first', position = null ) {

		try {

			const spec = BURSTS[ kind ];
			if ( ! spec || ! LINES[ spec.line ] ) return false;
			const ctx = this.context();
			if ( ! ctx || typeof ctx.createGain !== 'function' || typeof ctx.createBuffer !== 'function' ) return false;
			if ( ctx.state === 'suspended' ) {

				// resume from the gesture that brought him up; this line is lost
				try { const p = ctx.resume && ctx.resume(); if ( p && p.catch ) p.catch( () => {} ); } catch ( e ) { /* ignore */ }
				return false;

			}

			if ( ctx.state && ctx.state !== 'running' ) return false;
			let gain = this.volume();
			if ( gain <= 0 ) return false;
			if ( position ) {

				const l = this.listener( ctx );
				if ( l ) gain *= clickGain( Math.hypot( position.x - l.x, position.z - l.z ) );

			}

			if ( gain < 0.005 ) return false;
			// a quiet hover tick never cuts a sentence short
			if ( kind === 'hover' && this._voice && this._voice.end > ( ctx.currentTime || 0 ) ) return false;
			return this._play( ctx, kind, spec, gain );

		} catch ( e ) {

			return false;

		}

	}

	_play( ctx, kind, spec, gain ) {

		const buf = this.buffer( ctx, spec.line );
		// one voice: the previous line stops
		if ( this._voice ) {

			try { this._voice.src.stop(); } catch ( e ) { /* ended */ }
			this._voice = null;

		}

		const out = ctx.createGain();
		out.gain.value = Math.min( 1, gain * spec.vol );
		out.connect( ctx.destination );
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect( out );
		const t0 = ( ctx.currentTime || 0 ) + 0.01;
		src.start( t0 );
		const dur = buf.duration || lineTiming( LINES[ spec.line ] ).duration;
		this._voice = { src, end: t0 + dur };
		if ( typeof setTimeout === 'function' ) setTimeout( () => { try { out.disconnect(); } catch ( e ) { /* gone */ } }, ( dur + 0.3 ) * 1000 );
		this.last = { kind, line: spec.line, gain: out.gain.value };
		return linePhrases( kind );

	}

}
