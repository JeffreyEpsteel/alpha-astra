// Builds public/audio/sfx/*.ogg (mono Opus in Ogg, small). Run by hand when a source changes:
//   node src/features/sfx/tools/make-assets.mjs [path to ffmpeg]
// Sources are the owner's naval-fork generations (see public/audio/sfx/CREDITS.txt); the strike thwack, the
// miss thud, the splinters and the sail flutter are synthesised here from seeded noise (deterministic).
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), '..', '..', '..', '..' );
const OUT = join( ROOT, 'public', 'audio', 'sfx' );
const FORK = 'D:/fishing game/Forks/Fishing_Naval_20261007/Assets/Audio';
const ffmpeg = process.argv[ 2 ] || 'ffmpeg';
const tmp = mkdtempSync( join( tmpdir(), 'sfx-' ) );
mkdirSync( OUT, { recursive: true } );

const SR = 48000;
let seed = 12345;
const rnd = () => ( seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296;
const noise = () => rnd() * 2 - 1;

function wav( name, samples ) {

	let peak = 1e-6;
	for ( const s of samples ) peak = Math.max( peak, Math.abs( s ) );
	const buf = Buffer.alloc( 44 + samples.length * 2 );
	buf.write( 'RIFF', 0 ); buf.writeUInt32LE( 36 + samples.length * 2, 4 ); buf.write( 'WAVEfmt ', 8 );
	buf.writeUInt32LE( 16, 16 ); buf.writeUInt16LE( 1, 20 ); buf.writeUInt16LE( 1, 22 ); buf.writeUInt32LE( SR, 24 );
	buf.writeUInt32LE( SR * 2, 28 ); buf.writeUInt16LE( 2, 32 ); buf.writeUInt16LE( 16, 34 ); buf.write( 'data', 36 );
	buf.writeUInt32LE( samples.length * 2, 40 );
	for ( let i = 0; i < samples.length; i ++ ) buf.writeInt16LE( Math.round( samples[ i ] / peak * 0.89 * 32767 ), 44 + i * 2 );
	const p = join( tmp, name + '.wav' );
	writeFileSync( p, buf );
	return p;

}

// one-pole filters on a sample array
function lowpass( x, fc ) {

	const a = 1 - Math.exp( - 2 * Math.PI * fc / SR );
	let y = 0;
	return x.map( ( v ) => ( y += a * ( v - y ) ) );

}

function highpass( x, fc ) {

	const l = lowpass( x, fc );
	return x.map( ( v, i ) => v - l[ i ] );

}

function bandpass( x, lo, hi ) {

	return lowpass( highpass( x, lo ), hi );

}

const make = ( seconds, fn ) => Array.from( { length: Math.floor( seconds * SR ) }, ( _, i ) => fn( i / SR ) );
const fade = ( x, inS, outS ) => x.map( ( v, i ) => v * Math.min( 1, i / ( inS * SR ), ( x.length - i ) / ( outS * SR ) ) );

// the line / rod snapping tight on a good strike: a bright tick, a falling twang, a short ring
function thwack() {

	const tone = make( 0.3, ( t ) => Math.sin( 2 * Math.PI * ( 520 + 1500 * Math.exp( - t * 38 ) ) * t ) * Math.exp( - t * 22 ) );
	const tick = make( 0.3, ( t ) => noise() * Math.exp( - t * 260 ) );
	const ring = make( 0.3, ( t ) => Math.sin( 2 * Math.PI * 2350 * t ) * Math.exp( - t * 40 ) * 0.25 );
	return highpass( tone.map( ( v, i ) => v * 0.8 + tick[ i ] * 1.1 + ring[ i ] ), 240 );

}

// a miss: the hook pulling out of nothing, a low dull knock
function thud() {

	const body = make( 0.35, ( t ) => Math.sin( 2 * Math.PI * ( 58 + 40 * Math.exp( - t * 30 ) ) * t ) * Math.exp( - t * 17 ) );
	const slap = lowpass( make( 0.35, ( t ) => noise() * Math.exp( - t * 60 ) ), 700 );
	return body.map( ( v, i ) => v + slap[ i ] * 0.9 );

}

// wood tearing: a crack and a scatter of fibre ticks
function splinter() {

	const n = Math.floor( 0.9 * SR ), out = new Array( n ).fill( 0 );
	const tick = ( at, amp, fc ) => {

		const len = Math.floor( ( 0.004 + rnd() * 0.012 ) * SR );
		for ( let i = 0; i < len && at + i < n; i ++ ) out[ at + i ] += noise() * amp * Math.exp( - i / ( len * 0.28 ) );
		void fc;

	};

	tick( 0, 1.0 );
	tick( Math.floor( 0.012 * SR ), 0.7 );
	for ( let k = 0; k < 16; k ++ ) tick( Math.floor( ( 0.03 + Math.pow( rnd(), 1.6 ) * 0.7 ) * SR ), 0.18 + rnd() * 0.45 );
	const crunch = lowpass( make( 0.9, ( t ) => noise() * Math.exp( - t * 14 ) * 0.25 ), 1800 );
	return bandpass( out.map( ( v, i ) => v + crunch[ i ] ), 450, 6500 );

}

// cloth flapping in the wind: noise gated by an irregular 6 - 11 Hz flutter; edges fade so repeats overlap cleanly
function luff() {

	const dur = 1.8;
	let phase = 0;
	const x = make( dur, ( t ) => {

		const f = 6.5 + 4 * Math.sin( t * 2.3 ) + 1.5 * Math.sin( t * 7.9 );
		phase += f / SR;
		const g = Math.pow( Math.max( 0, Math.sin( 2 * Math.PI * phase ) ), 3 );
		return noise() * ( 0.12 + g );

	} );
	return fade( bandpass( x, 180, 2600 ), 0.25, 0.35 );

}

function encode( name, input, filter = '', bitrate = 40 ) {

	const args = [ '-y', '-v', 'error', '-i', input ];
	args.push( '-af', ( filter ? filter + ',' : '' ) + 'aresample=48000' );
	args.push( '-ac', '1', '-c:a', 'libopus', '-b:a', bitrate + 'k', '-application', 'audio', join( OUT, name + '.ogg' ) );
	const r = spawnSync( ffmpeg, args, { encoding: 'utf8' } );
	if ( r.status !== 0 ) throw new Error( 'ffmpeg failed for ' + name + ': ' + r.stderr );
	console.log( 'wrote', name + '.ogg' );

}

const norm = 'loudnorm=I=-20:TP=-1.5:LRA=11';

// real recordings from the fork
encode( 'rigging_strain', FORK + '/NavalActions/SailRiggingStrain_V01_Mono.wav', 'afade=t=in:d=0.2,afade=t=out:st=2.1:d=0.38,' + norm );
encode( 'cannon_reload', FORK + '/NavalActions/CannonReload_V01_Mono.wav', norm, 48 );
encode( 'clown_prank', FORK + '/ClownPullMyFinger_V4.wav', norm, 48 );
encode( 'bran_workshop', FORK + '/ResidentDialogue/Bran_Workshop_V01.mp3', norm, 28 );
encode( 'iona_workshop', FORK + '/ResidentDialogue/Iona_Workshop_V01.mp3', norm, 28 );
// derived from the rigging strain: hull groan = the same wood strain pitched down and dulled; line creak = a short,
// high slice of it (the runtime varies the playback rate with tension)
encode( 'hull_groan', FORK + '/NavalActions/SailRiggingStrain_V01_Mono.wav',
	'asetrate=26400,aresample=48000,lowpass=f=650,afade=t=in:d=0.4,afade=t=out:st=3.6:d=0.7,' + norm + ',volume=0.8' );
encode( 'line_creak', FORK + '/NavalActions/SailRiggingStrain_V01_Mono.wav',
	'atrim=0.5:0.95,asetpts=PTS-STARTPTS,asetrate=62000,aresample=48000,highpass=f=500,afade=t=in:d=0.02,afade=t=out:st=0.2:d=0.12,volume=1.0', 32 );

// synthesised
encode( 'thwack', wav( 'thwack', thwack() ), '', 40 );
encode( 'thud', wav( 'thud', thud() ), '', 40 );
encode( 'splinter', wav( 'splinter', splinter() ), '', 40 );
encode( 'sail_luff', wav( 'luff', luff() ), '', 40 );
