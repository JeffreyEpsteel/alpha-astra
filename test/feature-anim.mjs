// The animation graph (src/player/anim: AnimGraph, AnimDef, BlendSpace, ClipTools) on the real Hyptile GLB through the Avatar:
// state transitions, blend-space weights, the stride matched to the ground speed (no foot slide), montages on both slots with
// their events, inertial blends, and the old pose-action API as wrappers.
//   node test/feature-anim.mjs
import './headless.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU } from '../src/engine/gpu/GPU.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import * as E from '../src/engine/index.js';
import { Avatar } from '../src/player/Avatar.js';
import { CLIPS, CLIP_SPEED } from '../src/game/Characters.js';
import DEF from '../src/player/anim/AnimDef.js';
import { prepareSpace, spaceWeights } from '../src/player/anim/BlendSpace.js';
import { makeRig, strideSpeed, localsAt, fk } from '../src/player/anim/ClipTools.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const GREY = new Uint8Array( 16 ).fill( 150 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
await GPU.init( { headless: true } );

let failures = 0;
const ok = ( c, msg ) => { if ( ! c ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };
const DT = 1 / 30;
const near = ( a, b, e ) => Math.abs( a - b ) <= e;

// ---- blend spaces (pure)
{

	const all = () => true;
	const g = prepareSpace( DEF.spaces.ground, all );
	const W = ( fwd, str, speed ) => Object.fromEntries( spaceWeights( g, { forward: fwd, strafe: str, speed } ).map( ( e ) => [ e.key, e.w ] ) );
	let w = W( 0, 0, 0 );
	ok( w.Idle_Breathe === 1, 'standing: idle only' );
	w = W( 1.25, 0, 1.25 );
	ok( near( w.Walk_InPlace, 1, 1e-6 ), 'walk speed forward: the walk sample' );
	w = W( 2, 0, 2 );
	ok( near( w.Walk_InPlace, ( 2.7 - 2 ) / ( 2.7 - 1.25 ), 1e-6 ) && near( w.Run_Long, ( 2 - 1.25 ) / ( 2.7 - 1.25 ), 1e-6 ), `between walk and jog: linear (${ w.Walk_InPlace.toFixed( 2 ) } / ${ w.Run_Long.toFixed( 2 ) })` );
	w = W( 0, 1.25, 1.25 );
	ok( near( w.Walk_R75, 1, 1e-6 ), 'strafe right: the right-strafe legs' );
	w = W( 1.25 * Math.SQRT1_2, - 1.25 * Math.SQRT1_2, 1.25 );
	ok( near( w.Walk_L40, 1, 1e-6 ), 'forward-left diagonal: the 40 deg left legs' );
	w = W( - 1.25, 0, 1.25 );
	ok( near( w[ 'Walk_InPlace<' ], 1, 1e-6 ), 'backpedal: the walk in reverse' );
	w = W( - 0.9, 0.9, Math.hypot( 0.9, 0.9 ) );
	ok( w[ 'Walk_L40<' ] > 0.5, 'back-right: the left-turned legs in reverse step the right way' );
	w = W( Math.cos( 0.4 ), Math.sin( 0.4 ), 1.25 );
	const sum = Object.values( w ).reduce( ( a, b ) => a + b, 0 );
	ok( near( sum, 1, 1e-6 ) && w.Walk_InPlace > 0 && w.Walk_R40 > 0, 'between columns: both directions, weights sum to 1' );
	w = W( 6, 0, 6 );
	ok( w.Run_Sprint === 1, 'past the sprint sample: the sprint (played faster)' );
	const s1 = prepareSpace( DEF.spaces.swim, all );
	const w1 = Object.fromEntries( spaceWeights( s1, { speed: 1.4 } ).map( ( e ) => [ e.key, e.w ] ) );
	ok( near( w1.Swim_Forward, 0.5, 1e-6 ) && near( w1.Swim_Fast, 0.5, 1e-6 ), '1d swim space: halfway between forward and fast' );
	const gm = prepareSpace( DEF.spaces.ground, ( c ) => c !== 'Walk_R75' && c !== 'Run_R75' );
	ok( gm.columns.length === 7, 'a missing clip drops its column, the rest of the space stays' );

}

// ---- derived clips
const buf = readFileSync( join( ROOT, 'public/models/roster/hyptile.glb' ) );
const gltf = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
const rig = makeRig( gltf );

const scene = new E.Scene();
let t0 = performance.now();
const av = new Avatar( { scene, character: 'hyptile' } );
await av.ready;
const buildMs = performance.now() - t0;
const m = av.model, g = av.graph;
ok( !! g, 'the avatar has an AnimGraph' );
for ( const n of Object.keys( DEF.clips ) ) if ( ! m.clips.has( n ) ) ok( false, 'derived clip built: ' + n );
ok( Object.keys( DEF.clips ).every( ( n ) => m.clips.has( n ) ), `all ${ Object.keys( DEF.clips ).length } derived / procedural clips built (${ buildMs.toFixed( 0 ) } ms load incl. the GLB)` );
{

	const run = strideSpeed( rig, m.clips.get( 'Run_InPlace' ) ), long = strideSpeed( rig, m.clips.get( 'Run_Long' ) ), walk = strideSpeed( rig, m.clips.get( 'Walk_InPlace' ) );
	const r75 = strideSpeed( rig, m.clips.get( 'Walk_R75' ) );
	ok( near( walk, CLIP_SPEED.walk, 0.1 ) && near( run, CLIP_SPEED.run, 0.1 ), `measured strides match Characters.CLIP_SPEED (residents, raiders): walk ${ walk.toFixed( 2 ) } / ${ CLIP_SPEED.walk }, run ${ run.toFixed( 2 ) } / ${ CLIP_SPEED.run } m/s` );
	ok( long > run * 1.1, `Run_Long strides further than the run take (${ long.toFixed( 2 ) } vs ${ run.toFixed( 2 ) } m/s)` );
	ok( near( r75, walk, walk * 0.2 ), `strafe legs keep the walk's foot speed (${ r75.toFixed( 2 ) } vs ${ walk.toFixed( 2 ) })` );
	// the strafe legs step sideways: the stance foot travels along -X (the character's right is -X, it moves right)
	const D = m.clips.get( 'Walk_R75' ).duration;
	let sx = 0;
	for ( let k = 0; k < 32; k ++ ) {

		const A = fk( rig, localsAt( rig, m.clips.get( 'Walk_R75' ), k / 32 * D ) ).P, B = fk( rig, localsAt( rig, m.clips.get( 'Walk_R75' ), ( k + 1 ) / 32 * D ) ).P;
		const lo = A[ rig.index.ball_l ][ 1 ] < A[ rig.index.ball_r ][ 1 ] ? rig.index.ball_l : rig.index.ball_r;
		sx += B[ lo ][ 0 ] - A[ lo ][ 0 ];

	}

	ok( sx > 0.2, `Walk_R75: the planted foot slides toward +X under a body moving to its right (${ sx.toFixed( 2 ) } m per cycle)` );
	// the chest stays forward on the strafe legs
	const P = fk( rig, localsAt( rig, m.clips.get( 'Walk_R75' ), 0.3 ) ).R[ rig.index.spine_02 ], Q = fk( rig, localsAt( rig, m.clips.get( 'Walk_InPlace' ), 0.3 ) ).R[ rig.index.spine_02 ];
	const ang = 2 * Math.acos( Math.min( 1, Math.abs( P[ 0 ] * Q[ 0 ] + P[ 1 ] * Q[ 1 ] + P[ 2 ] * Q[ 2 ] + P[ 3 ] * Q[ 3 ] ) ) ) * 180 / Math.PI;
	ok( ang < 3, `the chest keeps facing forward on the strafe legs (${ ang.toFixed( 2 ) } deg)` );
	// guard: the fists end up in front of the chin
	const G = fk( rig, localsAt( rig, m.clips.get( 'Block_Guard' ), 0.5 ) ).P;
	const hl = G[ rig.index.hand_l ], head = G[ rig.index.head ];
	ok( hl[ 2 ] > head[ 2 ] + 0.15 && hl[ 1 ] > 1.0 && hl[ 1 ] < head[ 1 ] + 0.05, `Block_Guard: left fist in front of the chin (${ hl.map( ( x ) => x.toFixed( 2 ) ).join( ', ' ) })` );

}

const pose = { position: new E.Vector3( 0, 0, 0 ), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null };
const step = () => av.update( DT, pose );
const run = ( sec, p = {} ) => { Object.assign( pose, p ); for ( let t = 0; t < sec - 1e-9; t += DT ) step(); };
// the evaluated model-space position of a bone
const bone = ( n, o = new E.Vector3() ) => m.nodeWorld( n, o );

// ---- states and their labels
{

	run( 0.5 );
	ok( av.state === 'idle' && m.current === CLIPS.idle, `standing: ${ av.state } (${ m.current })` );
	run( 0.6, { speed: 1.25 } );
	ok( av.state === 'walk' && m.current === CLIPS.walk, `1.25 m/s: ${ av.state } (${ m.current })` );
	run( 0.6, { speed: 2.7 } );
	ok( av.state === 'jog' && m.current === 'Run_Long', `2.7 m/s: ${ av.state } (${ m.current })` );
	run( 0.6, { speed: 4.6 } );
	ok( av.state === 'sprint' && m.current === 'Run_Sprint', `4.6 m/s: ${ av.state } (${ m.current })` );
	// a jump: up, a while in the air (the fall), down hard and slow (the landing crouch), then idle
	run( 0.1, { speed: 0, grounded: false, vy: 4 } );
	ok( av.state === 'jump' && m.current === 'Jump', `jump: ${ av.state } (${ m.current })` );
	run( 0.6, { vy: - 3 } );
	ok( av.state === 'fall', `a long time in the air: ${ av.state } (${ m.current })` );
	run( DT * 2, { grounded: true, vy: 0 } );
	ok( av.state === 'land' && m.current === CLIPS.landSoft, `down after a drop: ${ av.state } (${ m.current })` );
	run( 0.8 );
	ok( av.state === 'idle', `the landing hands back to idle: ${ av.state }` );
	// a short hop while running stays a run (no landing crouch at speed)
	run( 0.3, { speed: 2.7 } );
	run( 0.2, { grounded: false, vy: 2 } );
	run( 0.1, { grounded: true, vy: 0 } );
	ok( av.state === 'jog', `a hop at a jog lands straight back into the jog: ${ av.state }` );
	run( 0.6, { mode: 'swim', speed: 1.0 } );
	ok( av.state === 'swim' && m.current === CLIPS.swim, `swimming: ${ av.state } (${ m.current })` );
	run( 0.6, { mode: 'boat', speed: 0 } );
	ok( av.state === 'helm' && m.current === CLIPS.helm, `at the helm: ${ av.state }` );
	run( 0.6, { mode: 'seat', seat: 'plane', action: 'seated' } );
	ok( av.state === 'plane' && m.current === CLIPS.seated, `in the cockpit: ${ av.state }` );
	run( 0.6, { mode: 'seat', seat: 'ride' } );
	ok( av.state === 'ride', `riding along: ${ av.state }` );
	run( 0.6, { mode: 'deck', seat: null, action: null, speed: 1.25 } );
	ok( av.state === 'deck' && m.current === CLIPS.walk, `walking on a deck: ${ av.state } (${ m.current })` );
	run( 0.6, { mode: 'walk', action: 'dance', speed: 0 } );
	ok( av.state === 'action' && m.current === CLIPS.dance, `a looping action: ${ av.state } (${ m.current })` );
	run( 0.6, { action: 'hold' } );
	ok( av.state === 'fishing' && m.overlay === CLIPS.hold, `the rod out: ${ av.state } + ${ m.overlay }` );
	run( 0.6, { action: null } );

}

// ---- the stride matches the ground speed: the planted foot moves backward (model space) at the body's speed
{

	const footSpeed = ( sec ) => {

		// over the frames where one foot is clearly the lower one, its backward speed along the travel direction
		const dir = { x: pose.strafe ?? 0, y: pose.forward ?? 1, length() { return Math.hypot( this.x, this.y ); } };
		let sum = 0, n = 0;
		const a = new E.Vector3(), b = new E.Vector3(), c = new E.Vector3(), d = new E.Vector3();
		for ( let t = 0; t < sec; t += DT ) {

			bone( 'ball_l', a ); bone( 'ball_r', b );
			step();
			bone( 'ball_l', c ); bone( 'ball_r', d );
			const L = a.y < b.y - 0.03 ? [ a, c ] : b.y < a.y - 0.03 ? [ b, d ] : null;
			if ( ! L ) continue;
			// model +Z is forward, +X is the character's left; the travel direction ( strafe = right, forward )
			const dx = L[ 1 ].x - L[ 0 ].x, dz = L[ 1 ].z - L[ 0 ].z;
			sum += - ( - dx * dir.x + dz * dir.y ) / dir.length() / DT; n ++;

		}

		return n ? sum / n : 0;

	};

	for ( const s of [ 1.25, 2.7, 4.6 ] ) {

		run( 0.8, { speed: s } );
		const v = footSpeed( 1.5 );
		ok( near( v, s, s * 0.2 ), `${ s } m/s forward: the planted foot moves at ${ v.toFixed( 2 ) } m/s (no slide)` );

	}

	av.setLocomotion( { speed: 1.25, strafe: 1.25, forward: 0 } );
	pose.speed = 1.25; pose.strafe = 1.25; pose.forward = 0;
	for ( let t = 0; t < 0.8; t += DT ) { av.setLocomotion( { speed: 1.25, strafe: 1.25, forward: 0 } ); step(); }
	ok( m.current === 'Walk_R75', `setLocomotion strafe right: ${ m.current }` );
	let v = 0;
	{

		// strafe: keep the override fresh while measuring
		const keep = av.update.bind( av );
		av.update = ( dt, p ) => { av.setLocomotion( { speed: 1.25, strafe: 1.25, forward: 0 } ); keep( dt, p ); };
		v = footSpeed( 1.5 );
		av.update = keep;
		delete av.update;

	}

	ok( near( v, 1.25, 0.3 ), `strafing at 1.25 m/s: the planted foot moves at ${ v.toFixed( 2 ) } m/s sideways` );
	delete pose.strafe; delete pose.forward;
	av.setLocomotion( null );
	// backpedal from the pose position moving backward against the yaw (walk mode, no override)
	pose.speed = 1.25;
	for ( let t = 0; t < 1; t += DT ) { pose.position.z += 1.25 * DT; step(); } // yaw 0 faces -Z: +Z is backward
	ok( m.current === CLIPS.walk && g.weights()[ 0 ][ 0 ] === CLIPS.walk && g._spaceRt.get( 'ground' ).dir > 170, `moving backward: the walk reversed (dir ${ g._spaceRt.get( 'ground' ).dir.toFixed( 0 ) } deg)` );
	pose.position.set( 0, 0, 0 );
	run( 0.5, { speed: 0 } );

}

// ---- footsteps and the foot-lock weights
{

	const steps = [];
	av.onAnimEvent = ( n, info ) => { if ( n === 'footstep' ) steps.push( info.foot ); };
	run( 0.5, { speed: 1.25 } );
	steps.length = 0;
	const lock = [];
	for ( let t = 0; t < 2.0; t += DT ) { step(); lock.push( g.footLock.l ); }
	ok( steps.length >= 3 && steps.includes( 'l' ) && steps.includes( 'r' ), `footstep events while walking (${ steps.length } in 2 s: ${ steps.join( '' ) })` );
	ok( Math.max( ...lock ) === 1 && Math.min( ...lock ) === 0, 'the left foot-lock weight follows the stance (1 planted, 0 swinging)' );
	av.onAnimEvent = null;
	run( 0.5, { speed: 0 } );

}

// ---- montages: the full-body slot, the upper slot, events, rate and blend
{

	const ev = [];
	const h = av.playMontage( 'swing', { onEvent: ( n, i ) => ev.push( [ n, i.time ] ) } );
	ok( h.playing && h.slot === 'full', 'swing plays on the full body' );
	let contactAt = null, tt = 0;
	h.onEvent = ( n ) => { if ( n === 'contact' ) contactAt = tt; };
	for ( let i = 0; i < 6; i ++ ) { step(); tt += DT; }
	ok( m.current === 'Melee_Paddle', `the swing owns the base layers (${ m.current })` );
	for ( let i = 0; i < 30; i ++ ) { step(); tt += DT; }
	ok( contactAt !== null && near( contactAt, 0.3, DT * 1.5 ), `'contact' at the paddle's hit frame, 0.3 s after the press (PlayerCombat) (${ contactAt && contactAt.toFixed( 3 ) } s)` );
	const names = ev.map( ( e ) => e[ 0 ] );
	ok( names[ 0 ] === 'start' && names.includes( 'blendOut' ) && names[ names.length - 1 ] === 'end' && names.indexOf( 'blendOut' ) < names.indexOf( 'end' ), 'events in order: start, contact, blendOut, end (' + names.join( ' ' ) + ')' );
	ok( ! h.playing && m.current === CLIPS.idle, `the swing hands back to the state machine (${ m.current })` );
	// upper slot over walking: the legs keep walking, the arms guard; the rod comes back afterwards
	run( 0.5, { speed: 1.25, action: 'hold' } );
	const b = av.playMontage( 'block' );
	run( 0.4 );
	ok( b.playing && m.overlay === 'Block_Guard' && m.current === CLIPS.walk, `block on the upper body while walking (${ m.current } + ${ m.overlay })` );
	b.stop();
	run( 0.4 );
	ok( ! b.playing && m.overlay === CLIPS.hold, `stopped: the rod hold returns on the overlay (${ m.overlay })` );
	// a montage interrupts another in its slot; rate and reverse
	const d1 = av.playMontage( 'dodgeLeft' );
	run( 0.1, { action: null } );
	const d2 = av.playMontage( 'dodgeRight', { rate: 2 } );
	run( DT );
	ok( d1.weight < 1 && d2.playing, 'a second full-body montage crossfades over the first' );
	run( 0.5 );
	ok( ! d1.playing && ! d2.playing && d2.rootMotion, 'both done; dodges carry the root-motion flag' );
	const gu = av.playMontage( 'getUp' );
	ok( gu.playing && gu.name === 'getUp' && near( gu.time, 0, 1e-6 ) && m.clips.has( 'GetUp_Back' ), 'getUp plays GetUp_Back forwards from its start (the knockdown ends on the back)' );
	run( 0.3 );
	ok( gu.time < m.clips.get( 'Knockdown' ).duration - 0.25, 'and runs toward its start' );
	run( 1.5 );
	const hb = av.playMontage( 'hit', { dir: 'back' } );
	ok( hb.playing && m.clips.has( 'Hit_Back' ) && g.montage( 'full' ) === hb, 'hit with dir: back -> the Hit_Back montage' );
	run( 0.8 );
	ok( av.playMontage( 'no_such_montage' ).playing === false, 'an unknown montage returns an inert handle' );

}

// ---- inertial blend: a cut (into the jump) does not pop
{

	run( 0.6, { speed: 2.7 } );
	const rot = () => m.local.map( ( l ) => Array.from( l.r ) );
	const ang = ( a, b ) => 2 * Math.acos( Math.min( 1, Math.abs( a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] ) ) ) * 180 / Math.PI;
	const I = [ 'thigh_l', 'calf_l', 'spine_01', 'upperarm_r' ].map( ( n ) => m.gltf.nodes.findIndex( ( x ) => x.name === n ) );
	let worstRun = 0, prev = rot();
	for ( let i = 0; i < 10; i ++ ) { step(); const r = rot(); for ( const j of I ) worstRun = Math.max( worstRun, ang( r[ j ], prev[ j ] ) ); prev = r; }
	pose.grounded = false; pose.vy = 4;
	step();
	let r = rot();
	const jump = Math.max( ...I.map( ( j ) => ang( r[ j ], prev[ j ] ) ) );
	ok( g.inertialActive && jump <= worstRun * 1.6 + 1, `the cut into the jump: ${ jump.toFixed( 1 ) } deg on the first frame (running frames up to ${ worstRun.toFixed( 1 ) })` );
	// without the inertial blend the same cut is a jump in pose
	const cut = { ...DEF, blends: { ...DEF.blends, '*>jump': [ 0.0, 'cut' ] } };
	run( 0.6, { grounded: true, vy: 0 } );
	g.setDef( cut );
	prev = rot();
	step();
	prev = rot();
	pose.grounded = false; pose.vy = 4;
	step();
	r = rot();
	const pop = Math.max( ...I.map( ( j ) => ang( r[ j ], prev[ j ] ) ) );
	ok( pop > jump * 1.5, `(the same cut without it pops ${ pop.toFixed( 1 ) } deg)` );
	g.setDef( DEF );
	run( 0.6, { grounded: true, vy: 0, speed: 0 } );

}

// ---- the lean into turns
{

	run( 0.5, { speed: 2.7 } );
	for ( let t = 0; t < 0.6; t += DT ) { pose.yaw += 1.5 * DT; step(); }
	ok( g.lean > 0.1, `turning left at a jog leans in (${ g.lean.toFixed( 3 ) } rad)` );
	const pl = new E.Vector3(), hd = new E.Vector3();
	bone( 'pelvis', pl ); bone( 'head', hd );
	ok( hd.x > pl.x + 0.03, `the head is left (+X) of the pelvis (${ ( hd.x - pl.x ).toFixed( 3 ) } m)` );
	run( 1.0, { speed: 0 } );
	ok( g.lean === 0, 'straight again: no lean' );
	pose.yaw = 0;
	run( 0.2 );

}

// ---- the old action API as wrappers
{

	run( 0.4, { action: 'celebrate' } );
	ok( g.fullBusy && m.current === CLIPS.celebrate && m.overlay === null, `a ONE_SHOT action plays as a full-body montage (${ m.current })` );
	run( 3 );
	ok( ! g.fullBusy && m.current === CLIPS.idle, `it hands back when done while the action stays (${ m.current })` );
	run( 0.3, { action: 'knockdown' } );
	run( 2 );
	ok( g.fullBusy && m.current === CLIPS.knockdown, 'knockdown holds its last frame while the action stays' );
	run( 0.2, { action: 'getUp' } );
	ok( g.montage( 'full' ) && g.montage( 'full' ).name === 'getUp', 'getUp follows the knockdown (GetUp_Back)' );
	run( 3, { action: null } );
	ok( ! g.fullBusy && av.state === 'idle', 'and back to idle' );
	run( 0.3, { action: 'talk' } );
	ok( av.state === 'action' && m.current === CLIPS.talk, 'a LOOPS action is the action state' );
	run( 0.3, { action: 'look' } );
	ok( m.current === CLIPS.lookAround, 'switching loops re-enters the state with the new clip' );
	run( 0.5, { action: null } );
	// no A-pose: the base layers always carry full weight
	let minW = 1;
	const seq = [ { speed: 1 }, { action: 'wave' }, { action: null, mode: 'swim' }, { mode: 'walk', grounded: false, vy: 3 }, { grounded: true, vy: 0 }, { action: 'hold' }, { action: 'charge' }, { action: 'cast' } ];
	for ( const p of seq ) { Object.assign( pose, p ); for ( let i = 0; i < 8; i ++ ) { step(); minW = Math.min( minW, m.layers.reduce( ( a, l ) => a + l.weight, 0 ) ); } }
	ok( minW > 0.999, `the base layers sum to 1 on every frame of a busy sequence (min ${ minW.toFixed( 4 ) }): never the bind pose` );
	Object.assign( pose, { action: null, speed: 0 } );
	run( 0.5 );

}

// ---- a ragdoll knockdown still works and hands back through the graph
{

	av.ragdoll( new E.Vector3( 0, 1, 2 ), { duration: 0.5 } );
	ok( av.state === 'ragdoll', 'knocked down: state ragdoll' );
	let n = 0;
	while ( av.ragdolling && n < 400 ) { step(); n ++; }
	run( 0.1 );
	ok( ! av.ragdolling && av.state === 'idle' && m.layers.every( ( l ) => l._graph ), `up again: the graph owns the layers (${ m.current })` );

}

// ---- hot reload: a new definition swaps in
{

	const def2 = { ...DEF, spaces: { ...DEF.spaces, ground: { ...DEF.spaces.ground, labels: [ [ 0.25, 'still' ], [ Infinity, 'moving' ] ] } } };
	g.setDef( def2 );
	run( 0.3, { speed: 0 } );
	ok( av.state === 'still', 'setDef: the new definition is live (label ' + av.state + ')' );
	// changed clip recipes rebuild the derived clips (what a Vite hot reload of AnimDef.js does)
	const old = m.clips.get( 'Run_Long' );
	g.setDef( { ...DEF, clips: { ...DEF.clips, Run_Long: { from: 'Run_InPlace', stride: 1.05 } } } );
	const neu = m.clips.get( 'Run_Long' );
	ok( neu && neu !== old && strideSpeed( rig, neu ) < strideSpeed( rig, old ), 'changed recipes rebuild the derived clips' );
	g.setDef( DEF );
	run( 0.3, { speed: 2.7 } );
	ok( m.current === 'Run_Long' && m.clips.get( 'Run_Long' ) !== neu, 'and back' );

}

// ---- per-frame cost of the graph
{

	run( 0.5, { speed: 2.7 } );
	const N = 300;
	const t1 = performance.now();
	for ( let i = 0; i < N; i ++ ) g.update( DT, av._ctx );
	const ms = ( performance.now() - t1 ) / N;
	ok( ms < 0.2, `graph update ${ ms.toFixed( 4 ) } ms per frame (budget 0.2)` );
	ok( /^\[anim\] jog \(locomotion\).*Run_Long/.test( g.debugLine() ), '?animdebug line: ' + g.debugLine() );

}

av.dispose();
console.log( failures ? failures + ' failure(s)' : 'all animation graph checks passed' );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( failures ? 1 : 0 );
