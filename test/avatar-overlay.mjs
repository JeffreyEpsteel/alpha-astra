// The layered avatar animation: SkinnedModel.setOverlay (engine/render/Skinning.js), Avatar's base + upper-body overlay split
// (player/Avatar.js) and the timing contract of the procedural fishing clips (tools/roster/fishing_pose.py), on the real Hyptile GLB.
//   node test/avatar-overlay.mjs
// Headless WebGPU (the model builds GPU buffers); no rendering, so no image decoding is needed.
import './headless.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU } from '../src/engine/gpu/GPU.js';
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import * as E from '../src/engine/index.js';
import { Avatar, UPPER_BODY, castStartFrom } from '../src/player/Avatar.js';
import { CLIPS } from '../src/game/Characters.js';
import { clipFK } from './clip-fk.mjs';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const GREY = new Uint8Array( 16 ).fill( 150 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
await GPU.init( { headless: true } );

let failures = 0;
const check = ( ok, msg ) => { if ( ! ok ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };
const ang = ( a, b ) => 2 * Math.acos( Math.min( 1, Math.abs( a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] ) ) ) * 180 / Math.PI;
const DT = 1 / 30;

const buf = readFileSync( join( ROOT, 'public/models/roster/hyptile.glb' ) );
const bytes = () => buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength );
const gltf = parseGLB( bytes() );
const node = ( g, n ) => g.nodes.findIndex( ( x ) => x.name === n );
const clipRot = ( name, bone, t ) => {

	// the clip's rotation of a bone at time t (nearest key: the fishing clips are baked every frame)
	const a = gltf.animations.find( ( x ) => x.name === name );
	const ch = a.channels.find( ( c ) => c.node === node( gltf, bone ) && c.path === 'rotation' );
	const k = Math.min( ch.times.length - 1, Math.max( 0, Math.round( t * 30 ) ) );
	return Array.from( ch.values.slice( k * 4, k * 4 + 4 ) );

};

// ---- SkinnedModel overlay
{

	const base = await SkinnedModel.create( parseGLB( bytes() ) );
	const over = await SkinnedModel.create( parseGLB( bytes() ) );
	for ( const m of [ base, over ] ) { m.play( CLIPS.walk, { fade: 0.01 } ); m.update( 0 ); }
	over.setOverlay( CLIPS.hold, { mask: UPPER_BODY, fade: 0.1 } );
	for ( let f = 0; f < 30; f ++ ) { base.update( DT ); over.update( DT ); }
	const I = ( n ) => node( over.gltf, n );
	check( over.overlay === CLIPS.hold, 'overlay name reported' );
	const legs = [ 'pelvis', 'thigh_l', 'calf_r', 'foot_l' ].map( ( n ) => ang( over.local[ I( n ) ].r, base.local[ I( n ) ].r ) );
	check( Math.max( ...legs ) < 0.1, 'masked overlay leaves the pelvis and legs on the walk (max ' + Math.max( ...legs ).toFixed( 4 ) + ' deg)' );
	const t = over.overlays[ 0 ].time;
	const arm = ang( over.local[ I( 'upperarm_r' ) ].r, clipRot( CLIPS.hold, 'upperarm_r', t ) );
	check( arm < 1.5, 'the arms are the Fishing_Hold pose (' + arm.toFixed( 2 ) + ' deg off the clip)' );
	check( ang( over.local[ I( 'upperarm_r' ) ].r, base.local[ I( 'upperarm_r' ) ].r ) > 20, 'the arm differs from the walk swing' );
	// the spine ramp: spine_01 takes about half of the clip's difference to the walk, spine_02 about 0.8
	for ( const [ bone, w ] of [ [ 'spine_01', 0.5 ], [ 'spine_02', 0.8 ] ] ) {

		const full = ang( clipRot( CLIPS.hold, bone, t ), base.local[ I( bone ) ].r ), got = ang( over.local[ I( bone ) ].r, base.local[ I( bone ) ].r );
		check( full > 1 && Math.abs( got / full - w ) < 0.15, `${ bone } blends at ${ w } (${ ( got / full ).toFixed( 2 ) })` );

	}

	// a one-shot reports its end and holds the last pose; a different overlay crossfades; null fades out to the walk
	let ended = null;
	over.onOverlayEnd = ( n ) => { ended = n; };
	over.setOverlay( CLIPS.cast, { mask: UPPER_BODY, fade: 0.05, loop: false, restart: true } );
	for ( let f = 0; f < 70; f ++ ) { base.update( DT ); over.update( DT ); }
	check( ended === CLIPS.cast, 'onOverlayEnd( Fishing_Cast ) after the one-shot' );
	check( over.overlay === CLIPS.cast && over.overlays.length === 1, 'the finished one-shot stays as the only overlay layer' );
	over.setOverlay( null, { fade: 0.1 } );
	for ( let f = 0; f < 12; f ++ ) { base.update( DT ); over.update( DT ); }
	check( over.overlay === null && over.overlays.length === 0, 'null clears the overlay' );
	const back = Math.max( ...[ 'spine_01', 'upperarm_r', 'hand_l', 'head' ].map( ( n ) => ang( over.local[ I( n ) ].r, base.local[ I( n ) ].r ) ) );
	check( back < 0.1, 'faded out: the base pose again (' + back.toFixed( 4 ) + ' deg)' );
	let threw = false;
	try { over.setOverlay( 'No_Such_Clip' ); } catch ( e ) { threw = true; }
	check( threw, 'an unknown overlay clip throws' );
	base.dispose(); over.dispose();

}

// ---- Avatar: rod actions on the overlay, everything else on the base
{

	const scene = new E.Scene();
	const av = new Avatar( { scene, character: 'hyptile' } );
	await av.ready;
	const pose = { position: new E.Vector3(), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null };
	const run = ( sec, p = {} ) => { Object.assign( pose, p ); for ( let t = 0; t < sec; t += DT ) av.update( DT, pose ); return av.model; };
	let m = run( 0.5, { action: 'hold', speed: 1.25 } );
	check( m.current === CLIPS.walk && m.overlay === CLIPS.hold, `walking with the rod: legs ${ m.current }, arms ${ m.overlay }` );
	m = run( 0.5, { speed: 2.7 } );
	// the jog is the run take with a longer stride (src/player/anim/AnimDef.js Run_Long)
	check( /^Run_/.test( m.current ) && m.overlay === CLIPS.hold, `running with the rod: legs ${ m.current }, arms ${ m.overlay }` );
	m = run( 0.5, { speed: 0 } );
	check( m.current === CLIPS.idle && m.overlay === CLIPS.hold, `standing with the rod: legs ${ m.current }, arms ${ m.overlay }` );
	m = run( 0.2, { action: 'charge' } );
	check( m.overlay === CLIPS.castCharge && m.current === CLIPS.idle, 'charge is an overlay' );
	m = run( 1.0 );
	check( m.overlay === CLIPS.castCharge, 'the charge holds its last pose while the button stays down' );
	m = run( 0.05, { action: 'cast' } );
	check( m.overlay === CLIPS.cast, 'cast replaces the charge on the overlay' );
	check( m.overlays.find( ( l ) => l.clip.name === CLIPS.cast ).time < 0.15, 'a fully charged cast starts at the back swing' );
	m = run( 2.0 );
	check( m.overlay === CLIPS.hold, 'a finished cast rests in the ready stance (' + m.overlay + ')' );
	// a tap: released 0.15 s into the charge, the cast starts where the rod is, not at the back swing
	m = run( 0.3, { action: 'hold' } );
	run( 0.17, { action: 'charge' } );
	const tc = m.overlays.find( ( l ) => l.clip.name === CLIPS.castCharge ).time;
	m = run( DT, { action: 'cast' } );
	const lc = m.overlays.find( ( l ) => l.clip.name === CLIPS.cast );
	check( Math.abs( lc.time - ( castStartFrom( tc ) + DT ) ) < 1e-6 && lc.time > 0.08, `a tap starts the cast part way (charge ${ tc.toFixed( 2 ) } s -> cast at ${ lc.time.toFixed( 2 ) } s)` );
	m = run( 0.1, { action: 'strike' } );
	check( m.overlay === CLIPS.strike, 'strike is an overlay' );
	m = run( 0.5, { action: 'reel', speed: 0 } );
	check( m.overlay === CLIPS.reel, 'reel is an overlay' );
	m = run( 0.3, { action: 'fight' } );
	check( m.overlay === CLIPS.fight, 'fight is an overlay' );
	m = run( 0.5, { action: 'celebrate' } );
	check( m.overlay === null && m.current === CLIPS.celebrate, `a full-body action is a base clip with no rod overlay (${ m.current }, ${ m.overlay })` );
	m = run( 4, { action: 'hold', mode: 'swim', speed: 1 } );
	check( m.overlay === null && m.current === CLIPS.swim, `no rod overlay while swimming (${ m.current }, ${ m.overlay })` );
	m = run( 0.5, { action: 'hold', mode: 'seat', speed: 0 } );
	check( m.current === CLIPS.seated && m.overlay === CLIPS.hold, `sitting with the rod: ${ m.current } + ${ m.overlay }` );
	m = run( 0.5, { action: null, mode: 'walk' } );
	check( m.overlay === null, 'no action: no overlay' );
	av.dispose();

}

// ---- the clips: the cast timing contract (the bobber leaves 0.09 s after rod.release(), FishingRod.js) and the poses
{

	const fk = clipFK( gltf );
	const el = ( clip, t ) => fk.rodElevation( clip, t );
	const e0 = el( CLIPS.cast, 0 ), e09 = el( CLIPS.cast, 0.09 ), eEnd = el( CLIPS.cast, 0.45 );
	check( e0 > 110 && e0 < 145, `the cast starts with the rod swung back over the shoulder (${ e0.toFixed( 0 ) } deg)` );
	check( e09 > 28 && e09 < 46, `the rod is at the release angle 0.09 s into the cast (${ e09.toFixed( 0 ) } deg above horizontal)` );
	check( eEnd < 5, `the follow-through points the rod at the water (${ eEnd.toFixed( 0 ) } deg)` );
	let mono = true;
	for ( let t = 0; t < 0.09; t += 1 / 60 ) if ( el( CLIPS.cast, t + 1 / 60 ) > el( CLIPS.cast, t ) + 0.5 ) mono = false;
	check( mono, 'the whip only moves forward until the release' );
	let worst = 0;
	for ( const tc of [ 0, 0.06, 0.12, 0.24, 0.35, 0.5, 0.7 ] ) worst = Math.max( worst, Math.abs( el( CLIPS.castCharge, tc ) - el( CLIPS.cast, castStartFrom( tc ) ) ) );
	check( worst < 22, `a cast released mid-charge continues from the same rod angle (worst mismatch ${ worst.toFixed( 0 ) } deg)` );
	const cEnd = el( CLIPS.castCharge, fk.duration( CLIPS.castCharge ) );
	check( cEnd > 110 && cEnd < 145 && Math.abs( cEnd - e0 ) < 4, `the charge ends where the cast begins (${ cEnd.toFixed( 0 ) } / ${ e0.toFixed( 0 ) } deg)` );
	const holdEl = el( CLIPS.hold, 0 ), castLast = el( CLIPS.cast, fk.duration( CLIPS.cast ) );
	check( Math.abs( holdEl - castLast ) < 4, `the cast ends in the ready stance (${ castLast.toFixed( 0 ) } / ${ holdEl.toFixed( 0 ) } deg)` );
	check( el( CLIPS.fight, 0.8 ) > el( CLIPS.hold, 0 ) + 20, 'the fight pumps the rod well above the ready stance' );
	check( Math.abs( el( CLIPS.hold, 0 ) - el( CLIPS.hold, 3.0 ) ) < 0.5 && Math.abs( el( CLIPS.reel, 0 ) - el( CLIPS.reel, 2.0 ) ) < 0.5, 'hold and reel loop on their first pose' );
	// both elbows are bent in the ready stance: the forearm is not on the line of the upper arm
	const W = fk.world( CLIPS.hold, 0 );
	const P = ( n ) => { const m = W[ fk.index( n ) ]; return [ m[ 12 ], m[ 13 ], m[ 14 ] ]; };
	const sub = ( a, b ) => a.map( ( x, i ) => x - b[ i ] );
	const dot = ( a, b ) => a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ], len = ( a ) => Math.hypot( ...a );
	for ( const s of [ 'r', 'l' ] ) {

		const u = sub( P( `lowerarm_${ s }` ), P( `upperarm_${ s }` ) ), f = sub( P( `hand_${ s }` ), P( `lowerarm_${ s }` ) );
		const bend = Math.acos( dot( u, f ) / ( len( u ) * len( f ) ) ) * 180 / Math.PI;
		check( bend > 35, `${ s === 'r' ? 'right' : 'left' } elbow bent ${ bend.toFixed( 0 ) } deg in the ready stance` );

	}

}

console.log( failures ? failures + ' failure(s)' : 'all avatar overlay checks passed' );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( failures ? 1 : 0 );
