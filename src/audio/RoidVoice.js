// Captain Roid's voice: the click-and-call speech of the owner's naval fork (its browser prototype,
// Deliverables/Fishing_Browser_Prototype_20261011_v2), ported line for line. He speaks only in
// clicks and short voiced calls; the words are subtitles. Each phrase is a seeded run of syllables:
//   a click  : a 4-12 ms noise burst through a two-pole resonator at 600-3200 Hz
//   a call   : (most syllables) a short voiced vowel right after the click: a harmonic tone at 85-180 Hz
//              shaped by two formants picked from six vowel pairs, a little glide and vibrato
// The same seed always gives the same sound, so a line sounds the same every time you hear it.
//
//   renderLine( line, sampleRate ) -> { samples: Float32Array, phrases: [ { text, start, end } ], duration }
//   LINES[ id ] = { id, phrases: [ { text, seed, count, pace, pauseAfter } ] }
//
// The fork's lines (greeting-first / greeting-repeat / who / harbour / fishing / danger / leave) were for
// a quay caretaker; here he runs the boat yard, so the greetings and the yard lines are new, 'who' and 'leave'
// are the fork's own, and harbour / fishing / danger are rewritten for this island (topics, see Clicks.TOPICS).

const TAIL = 0.12; // s of silence after the last syllable (qd)
// vowel formant pairs (F1, F2 Hz)
const VOWELS = [ [ 730, 1090 ], [ 270, 2290 ], [ 300, 870 ], [ 530, 1840 ], [ 660, 1720 ], [ 440, 1020 ] ];

const P = ( text, seed, count, pace, pauseAfter ) => ( { text, seed, count, pace, pauseAfter } );
const L = ( id, phrases ) => ( { id, phrases } );

export const LINES = {
	// his own greetings and farewell from the fork
	first: L( 'first', [ P( 'Easy there, stranger. They call me Roid. I keep the boats on this beach.', 1101, 7, 0.14, 0.28 ), P( 'Watch your footing, and keep your coins dry.', 1102, 5, 0.17, 0.2 ) ] ),
	repeat: L( 'repeat', [ P( 'Back again. Good. The harbour likes a familiar face.', 2201, 6, 0.12, 0.2 ) ] ),
	who: L( 'who', [ P( 'I am Roid, caretaker of this quay.', 3301, 5, 0.15, 0.3 ), P( 'The clicks and calls are how my people talk across fog.', 3302, 8, 0.11, 0.3 ), P( 'Do not ask me to translate; the tide does that better.', 3303, 4, 0.2, 0.2 ) ] ),
	// topics, rewritten for this island (the fork's were about its quay and one raider); the fork's seeds are
	// kept for the phrases that keep their slot, new phrases use seeds 9xxx
	harbour: L( 'harbour', [ P( 'Berth her at the pier head; my yard is on the sand beside it.', 4401, 6, 0.13, 0.25 ), P( 'Dock slow: a berth forgives patience, never speed.', 4403, 9, 0.1, 0.2 ), P( 'My yard sells boats, ships and guns, whenever your purse is heavy.', 9101, 7, 0.12, 0.2 ) ] ),
	fishing: L( 'fishing', [ P( 'Fish the reef to the west: shallow, clear water, and fish at your feet.', 5501, 7, 0.12, 0.3 ), P( 'The deep water south, past the drop-off, holds the big ones.', 9102, 8, 0.12, 0.3 ), P( 'Pons Cove lies south-east, a good run for a small boat.', 5503, 6, 0.1, 0.2 ) ] ),
	danger: L( 'danger', [ P( 'Pirates sail the deep water south of here.', 6601, 5, 0.19, 0.25 ), P( 'They are worse at night and in a storm. Fit a gun before you go.', 9103, 7, 0.12, 0.25 ), P( 'Raiders camp on the east beach. Block their blow, dodge, then hit back.', 6602, 7, 0.09, 0.2 ) ] ),
	leave: L( 'leave', [ P( 'Fair winds. Watch the tide and keep your lines dry.', 7701, 5, 0.16, 0.2 ) ] ),
	// the yard
	open: L( 'open', [ P( 'Pick a hull. She will be at your berth before you have walked back.', 8801, 6, 0.13, 0.2 ) ] ),
	hover: L( 'hover', [ P( '', 8802, 2, 0.09, 0 ) ] ),
	buy: L( 'buy', [ P( 'Sold. Treat her kindly and she will bring you home.', 8803, 7, 0.11, 0.25 ), P( 'She is moored at the pier head.', 8804, 4, 0.14, 0.2 ) ] ),
	broke: L( 'broke', [ P( 'Not enough coin. The sea will pay you; come back after.', 8805, 6, 0.15, 0.2 ) ] ),
};

// the fork's hash generator (ef): a 32-bit state stepped by a large odd constant
export function seededRandom( seed ) {

	let t = seed >>> 0;
	return () => {

		t = ( t + 1831565813 ) >>> 0;
		let e = t;
		e = Math.imul( e ^ ( e >>> 15 ), e | 1 );
		e ^= e + Math.imul( e ^ ( e >>> 7 ), e | 61 );
		return ( ( e ^ ( e >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// the syllables of one phrase (tf)
function syllables( ph ) {

	const r = seededRandom( ph.seed ), out = [];
	let t = 0;
	for ( let i = 0; i < ph.count; i ++ ) {

		const v = VOWELS[ Math.floor( r() * VOWELS.length ) ] || VOWELS[ 0 ];
		out.push( {
			start: t,
			clickFreq: 600 + r() * 2600,
			clickDur: 0.004 + r() * 0.008,
			clickGain: 0.6 + r() * 0.4,
			noiseSeed: Math.floor( r() * 4294967295 ),
			voiced: i === 0 || r() > 0.2,
			f0: 85 + r() * 95,
			f1: v[ 0 ] * ( 0.92 + r() * 0.16 ),
			f2: v[ 1 ] * ( 0.92 + r() * 0.16 ),
			voiceDur: 0.06 + r() * 0.1,
			voiceGain: 0.5 + r() * 0.5,
			glide: ( r() - 0.5 ) * 0.4,
		} );
		t += ph.pace * ( 0.55 + r() * 0.95 ) + ( r() < 0.15 ? ph.pace * 0.8 : 0 );

	}

	return out;

}

// phrase timing for a line (rf): every phrase's syllables, start / end, the total duration
const _timing = new Map();
export function lineTiming( line ) {

	const hit = _timing.get( line.id );
	if ( hit ) return hit;
	const phrases = [];
	let t = 0, last = 0;
	for ( const ph of line.phrases ) {

		const syl = syllables( ph ).map( ( s ) => ( { ...s, start: s.start + t } ) );
		let end = t;
		for ( const s of syl ) end = Math.max( end, s.start + ( s.voiced ? s.clickDur * 0.5 + s.voiceDur : s.clickDur ) );
		phrases.push( { text: ph.text, start: t, end, syllables: syl } );
		last = end;
		t = end + ph.pauseAfter;

	}

	const out = { phrases, duration: last + TAIL };
	_timing.set( line.id, out );
	return out;

}

// spectral envelope of the two formants (af)
function formant( f, f1, f2 ) {

	const a = ( f - f1 ) / 140, b = ( f - f2 ) / 220;
	return Math.exp( - a * a ) + 0.6 * Math.exp( - b * b ) + 0.04;

}

// the samples of a line at `rate` Hz, normalised to 0.85 peak (of)
export function renderLine( line, rate ) {

	const timing = lineTiming( line );
	const n = Math.max( 1, Math.ceil( timing.duration * rate ) + 1 );
	const out = new Float32Array( n );
	for ( const ph of timing.phrases ) for ( const s of ph.syllables ) {

		// the click: noise through a resonator at clickFreq, a fast exponential decay
		const i0 = Math.floor( s.start * rate );
		const len = Math.max( 1, Math.floor( s.clickDur * rate * 2.5 ) );
		const noise = seededRandom( s.noiseSeed );
		const w = 2 * Math.PI * s.clickFreq / rate, c = 1.92 * Math.cos( w );
		let y1 = 0, y2 = 0;
		for ( let k = 0; k < len && i0 + k < n; k ++ ) {

			const y = 0.12 * ( noise() * 2 - 1 ) + c * y1 - 0.9216 * y2;
			y2 = y1;
			y1 = y;
			out[ i0 + k ] += y * Math.exp( - k / rate / ( s.clickDur * 0.45 ) ) * s.clickGain;

		}

		if ( ! s.voiced ) continue;
		// the call: harmonics of f0 weighted by the formants, a glide, a little vibrato, attack / decay
		const v0 = i0 + Math.floor( s.clickDur * 0.5 * rate );
		const vLen = Math.floor( s.voiceDur * rate );
		const harmonics = Math.max( 1, Math.min( 24, Math.floor( 0.45 * rate / s.f0 ) ) );
		const amp = [];
		for ( let h = 1; h <= harmonics; h ++ ) amp.push( formant( s.f0 * h, s.f1, s.f2 ) / Math.sqrt( h ) );
		const phase = new Array( harmonics ).fill( 0 );
		const vibHz = 18 + s.noiseSeed % 11, vibPh = s.noiseSeed % 97 / 97 * Math.PI * 2;
		for ( let k = 0; k < vLen && v0 + k < n; k ++ ) {

			const t = k / rate;
			const f = s.f0 * ( 1 + s.glide * ( k / vLen ) + 0.03 * Math.sin( 2 * Math.PI * vibHz * t + vibPh ) );
			let sum = 0;
			for ( let h = 0; h < harmonics; h ++ ) {

				phase[ h ] += 2 * Math.PI * f * ( h + 1 ) / rate;
				sum += amp[ h ] * Math.sin( phase[ h ] );

			}

			const env = Math.min( 1, t / 0.006 ) * Math.max( 0, 1 - k / vLen ) ** 1.5;
			out[ v0 + k ] += sum * env * s.voiceGain * 0.18;

		}

	}

	let peak = 0;
	for ( let i = 0; i < n; i ++ ) peak = Math.max( peak, Math.abs( out[ i ] ) );
	if ( peak > 0 ) {

		const k = 0.85 / peak;
		for ( let i = 0; i < n; i ++ ) out[ i ] *= k;

	}

	return { samples: out, phrases: timing.phrases.map( ( p ) => ( { text: p.text, start: p.start, end: p.end } ) ), duration: timing.duration };

}
