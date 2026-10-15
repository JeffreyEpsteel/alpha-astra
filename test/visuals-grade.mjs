// Wave 18A: the time of day grade (src/post/Grade.js) and the post chain's knobs per Quality tier, plain node.
//   node test/visuals-grade.mjs
import { GRADE, GRADE_WGSL, gradeWeights, gradeApplyJS } from '../src/post/Grade.js';
import { TIERS, MOBILE, mobileTier } from '../src/core/Quality.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const lum = ( c ) => c[ 0 ] * 0.2126 + c[ 1 ] * 0.7152 + c[ 2 ] * 0.0722;

// ---- the weights: golden only around sunrise / sunset, never NaN, night as given
{

	let finite = true, goldenNoon = 1, goldenLow = 0;
	for ( let deg = - 5; deg <= 90; deg += 0.5 ) {

		const w = gradeWeights( Math.sin( deg * Math.PI / 180 ), 0 );
		if ( ! Number.isFinite( w.golden ) || w.golden < 0 || w.golden > 1 ) finite = false;
		if ( deg >= 30 ) goldenNoon = Math.min( goldenNoon, 1 - w.golden );
		if ( deg >= 3 && deg <= 6 ) goldenLow = Math.max( goldenLow, w.golden );

	}

	ok( finite, 'golden weight in 0..1 for sun -5..90 deg' );
	ok( goldenNoon === 1, 'no golden look with the sun above 30 deg' );
	ok( goldenLow > 0.9, `full golden look with the sun 3..6 deg up (${ goldenLow.toFixed( 2 ) })` );
	const w = gradeWeights( NaN, NaN );
	ok( w.golden === 0 && w.night === 0, 'bad inputs: the day look' );

}

// ---- the curve: monotonic per channel and in luminance on a grey ramp (24 stops), at every blend of the looks
{

	const xs = [];
	for ( let s = - 16; s <= 8; s += 1 / 16 ) xs.push( 0.18 * 2 ** s );
	xs.unshift( 0 );
	let mono = true, lumMono = true, where = '';
	for ( const golden of [ 0, 0.5, 1 ] ) for ( const night of [ 0, 0.3, 0.7, 1 ] ) for ( const strength of [ 0.5, 1 ] ) {

		let prev = null;
		for ( const x of xs ) {

			const c = gradeApplyJS( [ x, x, x ], golden, night, strength );
			if ( prev ) {

				if ( c.some( ( v, i ) => v < prev[ i ] - 1e-9 ) ) { mono = false; where = `g ${ golden } n ${ night } s ${ strength } at ${ x }`; }
				if ( lum( c ) < lum( prev ) - 1e-9 ) lumMono = false;

			}

			prev = c;

		}

	}

	ok( mono, 'grade: every channel rises with the input (grey ramp, all blends)' + ( where ? ' ' + where : '' ) );
	ok( lumMono, 'grade: luminance rises with the input' );

}

// ---- what it does: day near neutral, golden warm highlights, night blue shadows with a floor, lamps keep their colour
{

	const mid = gradeApplyJS( [ 0.18, 0.18, 0.18 ], 0, 0, 1 );
	ok( Math.abs( lum( mid ) - 0.18 ) < 0.002 && Math.abs( mid[ 0 ] - mid[ 2 ] ) < 0.02, 'day: mid grey stays (almost) grey' );
	const hiG = gradeApplyJS( [ 1, 1, 1 ], 1, 0, 1 );
	ok( hiG[ 0 ] > hiG[ 2 ] * 1.15, 'golden hour: warm highlights' );
	const shG = gradeApplyJS( [ 0.01, 0.01, 0.01 ], 1, 0, 1 );
	ok( shG[ 2 ] > shG[ 0 ], 'golden hour: cooler shadows' );
	const darkN = gradeApplyJS( [ 0.002, 0.002, 0.002 ], 0, 1, 1 );
	ok( darkN[ 2 ] > darkN[ 0 ] * 1.5 && lum( darkN ) > 0.002, 'night: dark tones lifted and blue' );
	const lamp = gradeApplyJS( [ 3, 1.6, 0.5 ], 0, 1, 1 );
	ok( lamp[ 0 ] / lamp[ 2 ] > 5, 'night: a warm lamp keeps its colour' );
	const off = gradeApplyJS( [ 0.3, 0.2, 0.1 ], 1, 1, 0 );
	ok( off[ 0 ] === 0.3 && off[ 1 ] === 0.2 && off[ 2 ] === 0.1, 'strength 0: untouched' );
	let finite = true;
	for ( const v of [ 0, 1e-12, 1e-4, 1, 1e3, 6e4 ] ) for ( const c of [ [ v, 0, 0 ], [ 0, v, 0 ], [ 0, 0, v ], [ v, v, v ] ] ) if ( ! gradeApplyJS( c, 0.5, 0.5, 1 ).every( Number.isFinite ) ) finite = false;
	ok( finite, 'finite for black, pure primaries and fp16 peaks' );

}

// ---- the WGSL mirrors the JS (same constants, the entry point)
{

	ok( /fn gradeApply\( cIn: vec3f, golden: f32, night: f32, strength: f32 \) -> vec3f/.test( GRADE_WGSL ), 'WGSL entry point' );
	ok( GRADE_WGSL.includes( GRADE.lift.toFixed( 3 ) ) && GRADE_WGSL.includes( GRADE.liftK.toFixed( 4 ) ), 'WGSL uses the lift constants' );
	ok( ! /\bNaN\b|undefined/.test( GRADE_WGSL ), 'WGSL has no NaN / undefined literals' );
	const src = readFileSync( new URL( '../src/post/PostFX.js', import.meta.url ), 'utf8' );
	ok( src.includes( 'GRADE_WGSL' ) && src.includes( 'gradeApply( c, post.gradeGolden, post.gradeNight, post.grade )' ), 'PostFX final pass applies the grade' );

}

// ---- every tier (and the phone) keeps a composable chain: the switches Quality.apply flips exist on each
{

	const keys = [ 'ao', 'shafts', 'motionBlur', 'ssr', 'aa', 'shadowSize', 'shadowFar' ];
	for ( const id of Object.keys( TIERS ) ) ok( keys.every( ( k ) => k in TIERS[ id ] ), `tier ${ id }: post knobs present` );
	const phone = mobileTier( TIERS.low, MOBILE.phone );
	ok( phone.ao === false && phone.shafts === false && phone.motionBlur === false, 'phone: the cheap chain (no AO, shafts, motion blur)' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
