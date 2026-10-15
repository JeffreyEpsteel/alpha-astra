// The voices of waves 13-19's new actions (wave 20B), synthesised like Synth.js's cues (no files, nothing to credit):
// oscillators and filtered noise built at the moment they play. Same shape as CUES ({ cat, gain, ref, max, voices, gap,
// build( ctx, out, t, o ) -> seconds }); index.js merges them into CUES so the SynthPlayer plays them with its distance
// gain, HRTF panner, category bus, voice limits (halved on a phone), the synth's voice budget and the indoor occlusion.
//
//   arsenal   blade_swing / axe_swing / pin_swing / harpoon_jab (the swing), blade_hit / axe_hit / pin_hit (the blow
//             landing), harpoon_strike (the harpoon gun's iron home), bullet_hit { kind } (water, wood, flesh, stone),
//             swivel_bark (the swivel gun's sharper crack over the borrowed cannon), fire_crackle (fire pools, a burning deck,
//             the hearth)
//   ships     fire_whoomph (a deck catching), flood_rush (water pouring in), mast_crack (a mast going by the board), bucket_slosh
//             { hiss } (a bucket on the fire), pump_stroke (the pump brake)
//   navy      bosun_call (the pipe), heave_to (the shout), quarters_drum (beat to quarters), distant_gun (a far broadside)
//   weather   gust (a squall's gust going by)
//   rooms     door (latch, hinge, the door settling), board_creak (the floor under a foot)
//   crew      dice_rattle, snore
//   towns     dog_bark { size }
// The loops (a waterspout, a burning deck, the bilge, the hearth, the other towns' markets) are EventSounds.js's LOOPS.

import { tone, burst, voice, echoes, filterNode, gainNode } from './Synth.js';
import { clamp, num } from './util.js';

const rnd = ( a, b ) => a + Math.random() * ( b - a );

// a swing through the air: band-passed noise sweeping f0 -> f1 (faster blades sweep higher)
function swish( ctx, out, t, { f0, f1, dur, peak, q = 1.4, kind = 'white' } ) {

	burst( ctx, out, { t, dur, peak, type: 'bandpass', f: f0, f1, q, attack: dur * 0.45, kind } );

}

export const VOICES = {
	// ---- the arsenal (18D)
	// the cutlass: a thin, fast hiss and the faint ring of the blade
	blade_swing: {
		cat: 'sfx', gain: 0.7, ref: 3, max: 45, voices: 3, gap: 0.08, build( ctx, out, t ) {

			const p = rnd( 0.92, 1.1 );
			swish( ctx, out, t, { f0: 1800 * p, f1: 4400 * p, dur: 0.17, peak: 0.55, q: 1.8 } );
			tone( ctx, out, { type: 'triangle', f0: 3100 * p, f1: 2950 * p, t: t + 0.04, dur: 0.16, peak: 0.05 } );
			return 0.25;

		},
	},
	// the boarding axe: a heavy, low chop of air
	axe_swing: {
		cat: 'sfx', gain: 0.75, ref: 3, max: 45, voices: 2, gap: 0.12, build( ctx, out, t ) {

			const p = rnd( 0.9, 1.1 );
			swish( ctx, out, t, { f0: 420 * p, f1: 1100 * p, dur: 0.3, peak: 0.6, q: 1.1 } );
			swish( ctx, out, t, { f0: 160, f1: 320, dur: 0.28, peak: 0.35, q: 0.8, kind: 'brown' } );
			return 0.35;

		},
	},
	// the belaying pin: a short wooden whip
	pin_swing: {
		cat: 'sfx', gain: 0.6, ref: 3, max: 40, voices: 3, gap: 0.08, build( ctx, out, t ) {

			const p = rnd( 0.9, 1.12 );
			swish( ctx, out, t, { f0: 850 * p, f1: 1700 * p, dur: 0.15, peak: 0.55, q: 1.5 } );
			return 0.2;

		},
	},
	// the melee harpoon's jab: a long thrust and the barbs' rattle
	harpoon_jab: {
		cat: 'sfx', gain: 0.6, ref: 3, max: 40, voices: 2, gap: 0.1, build( ctx, out, t ) {

			swish( ctx, out, t, { f0: 1300, f1: 650, dur: 0.22, peak: 0.5, q: 1.2 } );
			tone( ctx, out, { type: 'triangle', f0: 2300, f1: 2200, t: t + 0.12, dur: 0.06, peak: 0.08 } );
			return 0.3;

		},
	},
	// steel biting: a bright edge, the ring, the body behind it
	blade_hit: {
		cat: 'sfx', gain: 0.8, ref: 3, max: 50, voices: 3, gap: 0.06, build( ctx, out, t ) {

			const p = rnd( 0.93, 1.08 );
			burst( ctx, out, { t, dur: 0.05, peak: 0.6, type: 'highpass', f: 3000 * p, q: 0.8, attack: 0.001 } );
			tone( ctx, out, { type: 'triangle', f0: 2400 * p, f1: 1750 * p, t, dur: 0.2, peak: 0.22, attack: 0.001 } );
			tone( ctx, out, { type: 'sine', f0: 160, f1: 90, t, dur: 0.12, peak: 0.5, attack: 0.002 } );
			return 0.3;

		},
	},
	// the axe landing: a deep chop and a crack
	axe_hit: {
		cat: 'sfx', gain: 0.9, ref: 3, max: 55, voices: 2, gap: 0.08, build( ctx, out, t ) {

			tone( ctx, out, { type: 'sine', f0: 125, f1: 52, t, dur: 0.24, peak: 0.9, attack: 0.002 } );
			burst( ctx, out, { t, dur: 0.16, peak: 0.6, type: 'lowpass', f: 1500, f1: 280, q: 0.7, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.04, peak: 0.45, type: 'bandpass', f: 2300, q: 1.3, attack: 0.001 } );
			return 0.3;

		},
	},
	// the pin on a skull: a hollow wooden knock
	pin_hit: {
		cat: 'sfx', gain: 0.8, ref: 3, max: 45, voices: 3, gap: 0.06, build( ctx, out, t ) {

			const p = rnd( 0.9, 1.1 );
			tone( ctx, out, { type: 'triangle', f0: 720 * p, f1: 420 * p, t, dur: 0.08, peak: 0.6, attack: 0.001 } );
			tone( ctx, out, { type: 'sine', f0: 230 * p, f1: 150, t, dur: 0.13, peak: 0.45, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.03, peak: 0.35, type: 'bandpass', f: 1900, q: 1.4, attack: 0.001 } );
			return 0.18;

		},
	},
	// the harpoon gun's iron striking home and the line twanging taut
	harpoon_strike: {
		cat: 'sfx', gain: 0.8, ref: 4, max: 90, voices: 2, gap: 0.15, build( ctx, out, t ) {

			tone( ctx, out, { type: 'sine', f0: 150, f1: 68, t, dur: 0.16, peak: 0.7, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.05, peak: 0.45, type: 'bandpass', f: 1200, q: 1.2, attack: 0.001 } );
			tone( ctx, out, { type: 'triangle', f0: 196, f1: 182, t: t + 0.04, dur: 0.55, peak: 0.16, attack: 0.004 } );
			tone( ctx, out, { type: 'triangle', f0: 392, f1: 366, t: t + 0.04, dur: 0.35, peak: 0.06, attack: 0.004 } );
			return 0.65;

		},
	},
	// a ball or pellet striking: o.kind 'water' (a plip and a fizz), 'ship' | 'prop' (wood), 'raider' (a dull smack), else stone
	// (a ricochet's whine)
	bullet_hit: {
		cat: 'sfx', gain: 0.6, ref: 4, max: 120, voices: 4, gap: 0.03, build( ctx, out, t, o ) {

			const k = o.kind;
			if ( k === 'water' ) {

				burst( ctx, out, { t, dur: 0.12, peak: 0.45, type: 'highpass', f: 2600, q: 0.7, attack: 0.001 } );
				tone( ctx, out, { type: 'sine', f0: rnd( 1200, 1600 ), f1: 800, t: t + 0.02, dur: 0.07, peak: 0.25 } );
				return 0.2;

			}

			if ( k === 'ship' || k === 'prop' ) {

				tone( ctx, out, { type: 'triangle', f0: rnd( 800, 1000 ), f1: 380, t, dur: 0.06, peak: 0.55, attack: 0.001 } );
				burst( ctx, out, { t, dur: 0.07, peak: 0.45, type: 'bandpass', f: 1600, q: 1.1, attack: 0.001 } );
				return 0.12;

			}

			if ( k === 'raider' ) {

				burst( ctx, out, { t, dur: 0.08, peak: 0.55, type: 'lowpass', f: 650, q: 0.7, attack: 0.001 } );
				tone( ctx, out, { type: 'sine', f0: 140, f1: 90, t, dur: 0.08, peak: 0.35 } );
				return 0.12;

			}

			burst( ctx, out, { t, dur: 0.04, peak: 0.5, type: 'bandpass', f: 3200, q: 1, attack: 0.001 } );
			if ( Math.random() < 0.6 ) tone( ctx, out, { type: 'sine', f0: rnd( 2800, 3600 ), f1: rnd( 1100, 1500 ), t: t + 0.01, dur: 0.38, peak: 0.13, attack: 0.01 } );
			return 0.42;

		},
	},
	// the swivel gun: a sharp, high crack layered over the borrowed cannon sample (naval's), a short echo
	swivel_bark: {
		cat: 'sfx', gain: 0.85, ref: 10, max: 900, voices: 2, gap: 0.2, build( ctx, out, t ) {

			burst( ctx, out, { t, dur: 0.14, peak: 0.9, type: 'bandpass', f: 2600, f1: 900, q: 0.9, attack: 0.001 } );
			tone( ctx, out, { type: 'sine', f0: 190, f1: 70, t, dur: 0.3, peak: 0.6, attack: 0.002 } );
			echoes( ctx, out, t, { f: 600, peak: 0.25, dur: 0.4, delays: [ 0.28, 0.7 ] } );
			return 1.2;

		},
	},
	// fire: a handful of pops and spits over half a second (a fire pool, a burning deck, the hearth); o.k 0..1 how fierce
	fire_crackle: {
		cat: 'sfx', gain: 0.45, ref: 3, max: 45, voices: 3, gap: 0.2, build( ctx, out, t, o ) {

			const k = clamp( num( o.k, 0.6 ), 0.1, 1 );
			const n = 3 + Math.floor( Math.random() * 5 * k );
			for ( let i = 0; i < n; i ++ ) burst( ctx, out, { t: t + Math.random() * 0.55, dur: rnd( 0.008, 0.03 ), peak: rnd( 0.15, 0.5 ) * ( 0.5 + k / 2 ), type: 'bandpass', f: rnd( 1400, 5200 ), q: rnd( 1.5, 4 ), attack: 0.0005 } );
			return 0.62;

		},
	},

	// ---- ships: fire, water, masts, buckets and the pump
	// a deck catching: the whoomph of the spirit and timber going up, a hiss
	fire_whoomph: {
		cat: 'sfx', gain: 0.8, ref: 8, max: 320, voices: 2, gap: 0.5, build( ctx, out, t ) {

			burst( ctx, out, { t, dur: 0.7, peak: 0.8, type: 'lowpass', f: 900, f1: 180, q: 0.7, kind: 'brown', attack: 0.05 } );
			burst( ctx, out, { t: t + 0.05, dur: 0.6, peak: 0.22, type: 'highpass', f: 3200, q: 0.5, attack: 0.08 } );
			return 0.8;

		},
	},
	// water pouring into a hold: a rush and the gurgle of air coming up
	flood_rush: {
		cat: 'sfx', gain: 0.8, ref: 8, max: 260, voices: 1, gap: 3, build( ctx, out, t ) {

			burst( ctx, out, { t, dur: 1.8, peak: 0.6, type: 'lowpass', f: 700, f1: 380, q: 0.7, kind: 'brown', attack: 0.2 } );
			burst( ctx, out, { t: t + 0.1, dur: 1.4, peak: 0.18, type: 'bandpass', f: 1600, q: 0.8, attack: 0.3 } );
			for ( let i = 0; i < 9; i ++ ) tone( ctx, out, { type: 'sine', f0: rnd( 220, 520 ), f1: rnd( 500, 900 ), t: t + 0.2 + Math.random() * 1.5, dur: 0.06, peak: 0.16 } );
			return 2;

		},
	},
	// a mast going by the board: the crack, the long groan of the timber, the crash and the splash
	mast_crack: {
		cat: 'sfx', gain: 1, ref: 15, max: 700, voices: 1, gap: 2, build( ctx, out, t ) {

			burst( ctx, out, { t, dur: 0.09, peak: 0.9, type: 'bandpass', f: 2500, f1: 1200, q: 0.9, attack: 0.001 } );
			const g = filterNode( ctx, 'bandpass', 260, 3, out );
			tone( ctx, g, { type: 'sawtooth', f0: 95, f1: 58, t: t + 0.05, dur: 1.1, peak: 0.55, attack: 0.15 } );
			for ( let i = 0; i < 6; i ++ ) burst( ctx, out, { t: t + 0.15 + i * 0.13, dur: 0.05, peak: 0.25, type: 'bandpass', f: rnd( 900, 2200 ), q: 2, attack: 0.001 } ); // fibres parting
			burst( ctx, out, { t: t + 1.15, dur: 0.9, peak: 0.85, type: 'lowpass', f: 1200, f1: 200, q: 0.7, kind: 'brown', attack: 0.004 } );
			burst( ctx, out, { t: t + 1.4, dur: 1.0, peak: 0.4, type: 'highpass', f: 1800, q: 0.6, attack: 0.05 } );
			return 2.5;

		},
	},
	// a bucket of sea thrown: the slosh and splatter; o.hiss: on a fire (steam)
	bucket_slosh: {
		cat: 'sfx', gain: 0.65, ref: 4, max: 60, voices: 2, gap: 0.6, build( ctx, out, t, o ) {

			burst( ctx, out, { t, dur: 0.35, peak: 0.6, type: 'lowpass', f: 900, f1: 420, q: 0.8, kind: 'brown', attack: 0.03 } );
			burst( ctx, out, { t: t + 0.1, dur: 0.28, peak: 0.3, type: 'highpass', f: 2000, q: 0.6, attack: 0.01 } );
			if ( o.hiss ) burst( ctx, out, { t: t + 0.15, dur: 0.9, peak: 0.22, type: 'highpass', f: 4200, q: 0.5, attack: 0.05 } );
			return o.hiss ? 1.1 : 0.45;

		},
	},
	// the pump brake: a clank at the top of the stroke, water gushing out of the dale
	pump_stroke: {
		cat: 'sfx', gain: 0.6, ref: 4, max: 60, voices: 2, gap: 0.5, build( ctx, out, t ) {

			tone( ctx, out, { type: 'triangle', f0: 640, f1: 500, t, dur: 0.08, peak: 0.45, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.03, peak: 0.3, type: 'bandpass', f: 2600, q: 1.5, attack: 0.001 } );
			burst( ctx, out, { t: t + 0.12, dur: 0.38, peak: 0.45, type: 'lowpass', f: 600, f1: 350, q: 0.9, kind: 'brown', attack: 0.04 } );
			burst( ctx, out, { t: t + 0.2, dur: 0.25, peak: 0.12, type: 'bandpass', f: 380, f1: 520, q: 7, attack: 0.08 } ); // the brake's creak
			return 0.55;

		},
	},

	// ---- the navy (19B)
	// the bosun's pipe: a held note, a rise, a trill and the fall (the "all hands" call before a hail)
	bosun_call: {
		cat: 'sfx', gain: 0.55, ref: 20, max: 450, voices: 1, gap: 4, build( ctx, out, t ) {

			const o = ctx.createOscillator();
			o.type = 'sine';
			const f = o.frequency;
			f.setValueAtTime( 1750, t );
			f.setValueAtTime( 1750, t + 0.35 );
			f.exponentialRampToValueAtTime( 2350, t + 0.5 );
			f.setValueAtTime( 2350, t + 1.0 );
			f.exponentialRampToValueAtTime( 1650, t + 1.25 );
			const trill = ctx.createOscillator();
			trill.frequency.value = 14;
			const tg = gainNode( ctx, 0 );
			tg.gain.setValueAtTime( 0, t + 0.5 );
			tg.gain.linearRampToValueAtTime( 70, t + 0.55 );
			tg.gain.setValueAtTime( 70, t + 0.98 );
			tg.gain.linearRampToValueAtTime( 0, t + 1.0 );
			trill.connect( tg );
			tg.connect( f );
			const g = gainNode( ctx, 0, out );
			g.gain.setValueAtTime( 0.0001, t );
			g.gain.linearRampToValueAtTime( 0.5, t + 0.04 );
			g.gain.setValueAtTime( 0.5, t + 1.2 );
			g.gain.exponentialRampToValueAtTime( 0.0001, t + 1.35 );
			o.connect( g );
			burst( ctx, out, { t, dur: 1.3, peak: 0.03, type: 'bandpass', f: 2000, q: 2, attack: 0.05 } ); // breath in the pipe
			o.start( t );
			trill.start( t );
			o.stop( t + 1.4 );
			trill.stop( t + 1.4 );
			return 1.45;

		},
	},
	// "Heave to!": two shouted syllables through a speaking trumpet
	heave_to: {
		cat: 'sfx', gain: 0.85, ref: 20, max: 420, voices: 1, gap: 4, build( ctx, out, t ) {

			voice( ctx, out, { t, dur: 0.42, f0: 175, f1: 160, forms: [ 560, 1900 ], peak: 0.8, vibrato: 0.015 } ); // "hea-"
			voice( ctx, out, { t: t + 0.36, dur: 0.12, f0: 160, f1: 150, forms: [ 400, 1500 ], peak: 0.35 } ); // "-ve"
			voice( ctx, out, { t: t + 0.6, dur: 0.55, f0: 195, f1: 130, forms: [ 420, 850 ], peak: 0.85, vibrato: 0.02 } ); // "to!"
			burst( ctx, out, { t: t + 0.58, dur: 0.04, peak: 0.25, type: 'bandpass', f: 3500, q: 1.5, attack: 0.001 } ); // the t
			return 1.3;

		},
	},
	// beat to quarters: a snare roll swelling, then three heavy strokes
	quarters_drum: {
		cat: 'sfx', gain: 0.75, ref: 20, max: 700, voices: 1, gap: 8, build( ctx, out, t ) {

			let at = t;
			const n = 22;
			for ( let i = 0; i < n; i ++ ) {

				const k = 0.25 + 0.75 * i / n;
				burst( ctx, out, { t: at, dur: 0.05, peak: 0.4 * k, type: 'bandpass', f: 1900, q: 1, attack: 0.001 } );
				tone( ctx, out, { type: 'sine', f0: 200, f1: 150, t: at, dur: 0.06, peak: 0.22 * k } );
				at += 0.075 - 0.025 * i / n;

			}

			for ( let i = 0; i < 3; i ++ ) {

				const b = at + 0.12 + i * 0.36;
				tone( ctx, out, { type: 'sine', f0: 140, f1: 60, t: b, dur: 0.4, peak: 0.85 } );
				burst( ctx, out, { t: b, dur: 0.07, peak: 0.45, type: 'bandpass', f: 1500, q: 1, attack: 0.001 } );

			}

			return at - t + 1.4;

		},
	},
	// a broadside far off: the crack long gone, a low roll with its echo (played distance / 343 s late)
	distant_gun: {
		cat: 'sfx', gain: 0.9, ref: 60, max: 4000, voices: 4, gap: 0.12, build( ctx, out, t, o ) {

			const p = clamp( num( o.power, 1 ), 0.3, 1.5 );
			tone( ctx, out, { type: 'sine', f0: 62, f1: 26, t, dur: 1.4, peak: 0.9 * p, attack: 0.02 } );
			burst( ctx, out, { t, dur: 2.2, peak: 0.7 * p, type: 'lowpass', f: 320, f1: 80, q: 0.6, kind: 'brown', attack: 0.03 } );
			echoes( ctx, out, t, { f: 220, peak: 0.4 * p, dur: 1.0, delays: [ 0.9, 2.1 ] } );
			return 3.4;

		},
	},

	// ---- weather (wave 19's storm fronts)
	// a squall's gust going by: a swell of rushing air that rises and falls (o.k 0..1: how strong)
	gust: {
		cat: 'ambience', gain: 0.55, ref: 30, max: 220, voices: 2, gap: 3, build( ctx, out, t, o ) {

			const k = clamp( num( o.k, 0.6 ), 0.15, 1 );
			const dur = 2.2 + k;
			burst( ctx, out, { t, dur, peak: 0.6 * k, type: 'bandpass', f: 380, f1: 900 * ( 0.8 + k * 0.4 ), q: 0.8, kind: 'brown', attack: dur * 0.45 } );
			burst( ctx, out, { t: t + 0.2, dur: dur * 0.8, peak: 0.18 * k, type: 'bandpass', f: 1400, f1: 2400, q: 1.6, attack: dur * 0.4 } ); // the whistle in the rigging
			return dur + 0.1;

		},
	},

	// ---- rooms (19E's interiors)
	// a door: the latch, the hinge's creak, the door settling against its frame
	door: {
		cat: 'sfx', gain: 0.6, ref: 3, max: 40, voices: 1, gap: 1, build( ctx, out, t ) {

			tone( ctx, out, { type: 'triangle', f0: 1800, f1: 1500, t, dur: 0.035, peak: 0.4, attack: 0.001 } );
			burst( ctx, out, { t, dur: 0.025, peak: 0.3, type: 'bandpass', f: 3200, q: 1.5, attack: 0.001 } );
			burst( ctx, out, { t: t + 0.08, dur: 0.5, peak: 0.25, type: 'bandpass', f: 600, f1: 950, q: 12, attack: 0.1 } );
			tone( ctx, out, { type: 'sine', f0: 125, f1: 80, t: t + 0.6, dur: 0.16, peak: 0.5, attack: 0.002 } );
			burst( ctx, out, { t: t + 0.6, dur: 0.05, peak: 0.2, type: 'lowpass', f: 1200, q: 0.7, attack: 0.001 } );
			return 0.85;

		},
	},
	// an old floorboard under a foot
	board_creak: {
		cat: 'sfx', gain: 0.4, ref: 2, max: 25, voices: 2, gap: 0.9, build( ctx, out, t ) {

			const p = rnd( 0.85, 1.2 );
			burst( ctx, out, { t, dur: 0.38, peak: 0.4, type: 'bandpass', f: 340 * p, f1: 520 * p, q: 9, attack: 0.08 } );
			const g = filterNode( ctx, 'bandpass', 300 * p, 5, out );
			tone( ctx, g, { type: 'sawtooth', f0: 105 * p, f1: 128 * p, t, dur: 0.32, peak: 0.2, attack: 0.07 } );
			return 0.45;

		},
	},

	// ---- the crew (19C)
	// dice in a cup, thrown on the planks
	dice_rattle: {
		cat: 'ambience', gain: 0.55, ref: 3, max: 30, voices: 1, gap: 2, build( ctx, out, t ) {

			for ( let i = 0; i < 8; i ++ ) tone( ctx, out, { type: 'triangle', f0: rnd( 2500, 4200 ), t: t + Math.random() * 0.35, dur: 0.02, peak: 0.18, attack: 0.0005 } );
			for ( let i = 0; i < 5; i ++ ) burst( ctx, out, { t: t + 0.45 + i * rnd( 0.05, 0.09 ), dur: 0.025, peak: 0.25 * ( 1 - i / 6 ), type: 'bandpass', f: rnd( 1200, 1900 ), q: 2.5, attack: 0.0005 } );
			return 1;

		},
	},
	// a hand asleep under the awning: the snore in, the breath out
	snore: {
		cat: 'ambience', gain: 0.4, ref: 2, max: 25, voices: 2, gap: 2.5, build( ctx, out, t ) {

			const p = rnd( 0.85, 1.2 );
			const lp = filterNode( ctx, 'lowpass', 420, 0.8, out );
			tone( ctx, lp, { type: 'sawtooth', f0: 52 * p, f1: 60 * p, t, dur: 1.1, peak: 0.28, attack: 0.5 } );
			burst( ctx, out, { t, dur: 1.1, peak: 0.12, type: 'bandpass', f: 320 * p, f1: 420 * p, q: 3, attack: 0.5 } );
			burst( ctx, out, { t: t + 1.25, dur: 0.9, peak: 0.08, type: 'highpass', f: 1500, q: 0.5, attack: 0.25 } );
			return 2.2;

		},
	},

	// ---- the towns (18B)
	// a dog barking once or a few times (o.size 0.6 small .. 1.3 big; o.n barks)
	dog_bark: {
		cat: 'ambience', gain: 0.6, ref: 6, max: 180, voices: 2, gap: 0.8, build( ctx, out, t, o ) {

			const sz = clamp( num( o.size, 1 ), 0.5, 1.5 ), n = clamp( Math.round( num( o.n, 1 + Math.floor( Math.random() * 3 ) ) ), 1, 4 );
			let at = t;
			for ( let i = 0; i < n; i ++ ) {

				const f = rnd( 0.95, 1.05 ) / sz;
				voice( ctx, out, { t: at, dur: 0.11, f0: 480 * f, f1: 290 * f, forms: [ 850 / Math.sqrt( sz ), 1700 / Math.sqrt( sz ) ], peak: 0.75 } );
				burst( ctx, out, { t: at, dur: 0.06, peak: 0.25, type: 'bandpass', f: 1300 / sz, q: 1.2, attack: 0.002 } );
				at += rnd( 0.22, 0.38 );

			}

			return at - t + 0.2;

		},
	},
};

export const VOICE_NAMES = Object.keys( VOICES );
