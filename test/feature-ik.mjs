// Contact IK (src/player/ik): the solvers on bare chains, then the post-animation pass on the real Hyptile GLB through the Avatar
// (foot planting with the pelvis drop, hand targets in world and bone frames, weight blending, the ragdoll hand-off, the budget).
//   node test/feature-ik.mjs
// Headless WebGPU (the model builds GPU buffers); no rendering.
import './headless.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU } from '../src/engine/gpu/GPU.js';
import * as E from '../src/engine/index.js';
import { Avatar, footWeight } from '../src/player/Avatar.js';
import { ContactIK, pelvisOffset, supportOffset, FOOT, LOCK } from '../src/player/ik/ContactIK.js';
import { solveTwoBone, solveCCD } from '../src/player/ik/Solvers.js';
import { vec, dist3, angle3, sub3, rot3 } from '../src/player/ik/ikmath.js';
import { crankKnobLocal, contactTargets } from '../src/player/ik/Grips.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const GREY = new Uint8Array( 16 ).fill( 150 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const DEG = Math.PI / 180;

// ---- two-bone solver on a bare chain (a 0.45 m thigh, a 0.45 m calf, bent a little forward)
{

	const a = vec( 0, 1, 0 ), b = vec( 0, 0.55, 0.05 ), c = vec( 0, 0.1, 0 );
	const l1 = dist3( a, b ), l2 = dist3( b, c );
	const solved = ( out ) => {

		// rebuild the chain from the solve: b' = a + qa (b - a), c' = b' + qb qa (c - b)
		const ab = sub3( vec(), b, a ), bc = sub3( vec(), c, b );
		rot3( ab, out.qa, ab ); rot3( bc, out.qa, bc ); rot3( bc, out.qb, bc );
		const b1 = vec( a[ 0 ] + ab[ 0 ], a[ 1 ] + ab[ 1 ], a[ 2 ] + ab[ 2 ] );
		return { b1, c1: vec( b1[ 0 ] + bc[ 0 ], b1[ 1 ] + bc[ 1 ], b1[ 2 ] + bc[ 2 ] ) };

	};

	const T = vec( 0.1, 0.3, 0.15 );
	let out = solveTwoBone( a, b, c, T, {} );
	let s = solved( out );
	ok( out.reached && dist3( s.c1, T ) < 1e-4, 'two-bone: a reachable target is reached (' + dist3( s.c1, T ).toExponential( 1 ) + ' m)' );
	ok( Math.abs( dist3( a, s.b1 ) - l1 ) < 1e-6 && Math.abs( dist3( s.b1, s.c1 ) - l2 ) < 1e-6, 'two-bone: the bone lengths are kept' );
	out = solveTwoBone( a, b, c, vec( 0, - 2, 0.3 ), {} );
	s = solved( out );
	const dir = sub3( vec(), s.c1, a ), want = vec( 0, - 3, 0.3 );
	ok( ! out.reached && angle3( dir, want ) < 0.5 * DEG && dist3( a, s.c1 ) > ( l1 + l2 ) * 0.99, 'two-bone: an unreachable target gets the straightened limb pointing at it' );
	ok( out.bend <= 3.10 + 1e-6, 'two-bone: the knee stops short of locking straight (' + ( out.bend / DEG ).toFixed( 1 ) + ' deg)' );
	out = solveTwoBone( a, b, c, vec( 0, 0.98, 0.02 ), {}, { minBend: 30 * DEG } );
	ok( out.bend >= 30 * DEG - 1e-6, 'two-bone: a target at the hip folds no further than the limit (' + ( out.bend / DEG ).toFixed( 1 ) + ' deg)' );
	// pole: the same target, the knee turned to face +X
	out = solveTwoBone( a, b, c, vec( 0, 0.3, 0 ), {}, { pole: vec( 1, 0.55, 0 ), poleWeight: 1 } );
	s = solved( out );
	ok( out.reached && s.b1[ 0 ] > 0.1 && Math.abs( s.b1[ 2 ] ) < 0.01, 'two-bone: the pole turns the knee toward it (' + s.b1[ 0 ].toFixed( 3 ) + ', ' + s.b1[ 2 ].toFixed( 3 ) + ')' );
	out = solveTwoBone( a, b, c, vec( 0, 0.3, 0 ), {}, { pole: vec( 1, 0.55, 0 ), poleWeight: 0 } );
	s = solved( out );
	ok( s.b1[ 2 ] > 0.02, 'two-bone: without the pole weight the knee stays in its own plane (forward)' );
	out = solveTwoBone( a, b, c, c, {} );
	ok( Math.abs( out.qa[ 3 ] ) > 1 - 1e-9 && Math.abs( out.qb[ 3 ] ) > 1 - 1e-9, 'two-bone: the target at the end changes nothing' );
	// a straight chain bends toward the hint
	const bs = vec( 0, 0.55, 0 );
	out = solveTwoBone( a, bs, c, vec( 0, 0.4, 0 ), {}, { hint: vec( 0, 0, 1 ) } );
	const b2 = rot3( vec(), out.qa, sub3( vec(), bs, a ) );
	ok( b2[ 2 ] > 0.05, 'two-bone: a straight leg bends toward the hint (knee forward)' );

}

// ---- CCD over a three-joint chain, with per-joint limits
{

	const pos = new Float64Array( [ 0, 0, 0, 0, 0.2, 0, 0, 0.4, 0 ] ), eff = vec( 0, 0.6, 0 ), G = new Float64Array( 12 );
	const tgt = vec( 0.2, 0.5, 0.1 ), done = solveCCD( pos, 3, eff, tgt, new Float64Array( [ 1, 1, 1 ] ), 20, G ), err = dist3( eff, tgt );
	ok( done && err < 1e-3, 'CCD: reaches a target inside the chain (' + err.toExponential( 1 ) + ' m)' );
	const pos2 = new Float64Array( [ 0, 0, 0, 0, 0.2, 0, 0, 0.4, 0 ] ), eff2 = vec( 0, 0.6, 0 ), G2 = new Float64Array( 12 );
	solveCCD( pos2, 3, eff2, vec( 0.6, 0, 0 ), new Float64Array( [ 0.2, 0.2, 0.2 ] ), 20, G2 );
	const own0 = 2 * Math.acos( Math.min( 1, Math.abs( G2[ 3 ] ) ) );
	ok( own0 <= 0.2 + 1e-6 && angle3( vec( eff2[ 0 ], eff2[ 1 ], eff2[ 2 ] ), vec( 0, 1, 0 ) ) <= 0.6 + 1e-3, 'CCD: the limits hold (root turned ' + ( own0 / DEG ).toFixed( 1 ) + ' deg)' );

}

// ---- the pelvis and support rules
ok( pelvisOffset( 0.1, - 0.12 ) === - 0.12 && pelvisOffset( 0.1, 0.05 ) === 0 && pelvisOffset( - 0.6, 0 ) === - FOOT.maxDrop, 'pelvis drops to the lower foot, never rises, at most maxDrop' );
ok( supportOffset( 0.2 ) === 0.2 && supportOffset( 1.2 ) === 0 && supportOffset( - 1 ) === 0 && supportOffset( NaN ) === 0, 'a wall or a drop is no support' );
ok( footWeight( { mode: 'walk', speed: 1, grounded: true } ) === 1 && footWeight( { mode: 'walk', speed: 6, grounded: true } ) === 0, 'foot weight: full at a walk, none at a sprint' );
ok( footWeight( { mode: 'swim', speed: 0 } ) === 0 && footWeight( { mode: 'walk', grounded: false } ) === 0 && footWeight( { mode: 'boat' } ) === 0 && footWeight( { mode: 'deck', speed: 0 }, 'tumble' ) === 0, 'foot weight: none swimming, airborne, at the helm or tumbling' );
ok( footWeight( { mode: 'seat', speed: 0 } ) === 1 && footWeight( { mode: 'deck', speed: 0, grounded: true } ) === 1, 'foot weight: full seated and on deck' );

// ---- the pass on the real rig
await GPU.init( { headless: true } );
const DT = 1 / 60;
const scene = new E.Scene();
const av = new Avatar( { scene, character: 'hyptile' } );
await av.ready;
ok( av.ik instanceof ContactIK, 'the Hyptile rig gets a ContactIK' );
const m = av.model;
const pose = { position: new E.Vector3( 10, 2, - 4 ), yaw: 0.6, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null };
const run = ( sec, p = {} ) => { Object.assign( pose, p ); for ( let t = 0; t < sec - 1e-9; t += DT ) av.update( DT, pose ); };
const W = ( name ) => m.nodeWorld( name, new E.Vector3() ).applyMatrix4( av.group.matrixWorld ); // world position of a bone
const local = ( name ) => m.nodeWorld( name, new E.Vector3() ); // model space

run( 0.5 );
// the clip pose of the same frame, before the IK: snapshot the model-space bones at the top of the pose hook
const clip = { L: new E.Vector3(), R: new E.Vector3(), P: new E.Vector3(), palm: new E.Vector3(), footY: new E.Vector3() };
{

	const hook = m.poseOverride, ik = av.ik, I = ik.I;
	const at = ( i, o ) => o.set( ik.Wp[ i * 3 ], ik.Wp[ i * 3 + 1 ], ik.Wp[ i * 3 + 2 ] );
	m.poseOverride = ( mm ) => {

		ik._fkFrom( mm.local );
		at( I.foot_l, clip.L ); at( I.foot_r, clip.R ); at( I.pelvis, clip.P ); at( I.weapon_l, clip.palm );
		const q = ik.Wq, k = I.foot_l * 4;
		clip.footY.set( 0, 1, 0 ).applyQuaternion( new E.Quaternion( q[ k ], q[ k + 1 ], q[ k + 2 ], q[ k + 3 ] ) );
		hook( mm );

	};

}

const clipAt = () => ( { L: clip.L.clone(), R: clip.R.clone(), P: clip.P.clone() } );
// the animation graph writes the stance weights (ik.footLock) every frame; fix them for a check, null hands them back
const graphLock = av.graph && av.graph._footLock;
const lockFeet = ( v ) => {

	if ( ! av.graph ) { if ( v ) Object.assign( av.ik.footLock, v ); return; }
	av.graph._footLock = v ? function () { this.footLock.l = v.l; this.footLock.r = v.r; } : graphLock;

};
lockFeet( { l: 0, r: 0 } );
const clipPalm = () => clip.palm.clone().applyMatrix4( av.group.matrixWorld );

// a plane at the feet: the IK changes nothing
const flat = ( p, mode, out ) => { out.x = p.x; out.y = 2; out.z = p.z; out.nx = 0; out.ny = 1; out.nz = 0; return true; };
av.setGroundProbe( flat );
run( 0.6 );
let c0 = clipAt();
ok( local( 'foot_l' ).distanceTo( c0.L ) < 0.003 && local( 'pelvis' ).distanceTo( c0.P ) < 0.003, 'flat ground under the feet: the clip pose stands (' + local( 'foot_l' ).distanceTo( c0.L ).toFixed( 4 ) + ' m)' );
const ax = new E.Vector3( 1, 0, 0 ).applyAxisAngle( new E.Vector3( 0, 1, 0 ), pose.yaw + Math.PI ); // model +X in the world
// foot lock: a planted foot keeps its world XZ while the body shifts, then blends back to the clip when released
{

	lockFeet( { l: 1, r: 1 } );
	run( 0.3 );
	const p0 = W( 'foot_l' ), start = pose.position.clone();
	for ( let i = 0; i < 8; i ++ ) run( DT, { position: pose.position.clone().addScaledVector( ax, 0.01 ) } ); // 8 cm sideways, standing
	const held = Math.hypot( W( 'foot_l' ).x - p0.x, W( 'foot_l' ).z - p0.z );
	ok( av.ik.legs[ 0 ].pinned && held < 0.004, 'foot lock: the planted foot stays put while the body moves 8 cm (' + held.toFixed( 4 ) + ' m)' );
	lockFeet( { l: 0, r: 0 } );
	run( DT );
	const mid = W( 'foot_l' ).distanceTo( clip.L.clone().applyMatrix4( av.group.matrixWorld ) );
	run( LOCK.release + 0.1 );
	const back = W( 'foot_l' ).distanceTo( clip.L.clone().applyMatrix4( av.group.matrixWorld ) );
	ok( mid > 0.02 && back < 0.002 && av.ik.legs[ 0 ].pw === 0, `foot lock: released, it blends back to the clip (${ mid.toFixed( 3 ) } m after a frame, ${ back.toFixed( 4 ) } m after ${ LOCK.release } s)` );
	lockFeet( { l: 1, r: 1 } );
	run( 0.1 );
	run( DT, { position: pose.position.clone().addScaledVector( ax, LOCK.maxSlip + 0.1 ) } );
	ok( ! av.ik.legs[ 0 ].pinned && av.ik.legs[ 0 ].pw === 0, 'foot lock: a jump past maxSlip lets go at once' );
	lockFeet( { l: 0, r: 0 } );
	run( 0.3, { position: start } );

}

// a step: the left foot (model +X) on a 0.12 m ledge, the right 0.15 m down: the pelvis drops to the lower foot
const step = ( p, mode, out ) => {

	const side = ( p.x - pose.position.x ) * ax.x + ( p.z - pose.position.z ) * ax.z;
	out.x = p.x; out.y = 2 + ( side > 0 ? 0.12 : - 0.15 ); out.z = p.z; out.nx = 0; out.ny = 1; out.nz = 0;
	return true;

};
av.setGroundProbe( step );
run( 1.0 );
c0 = clipAt();
const dl = local( 'foot_l' ).y - c0.L.y, dr = local( 'foot_r' ).y - c0.R.y, dp = local( 'pelvis' ).y - c0.P.y;
ok( Math.abs( dl - 0.12 ) < 0.01 && Math.abs( dr + 0.15 ) < 0.01, `feet planted on the step: left ${ dl.toFixed( 3 ) }, right ${ dr.toFixed( 3 ) } m` );
ok( Math.abs( dp + 0.15 ) < 0.005, `pelvis dropped to the lower foot (${ dp.toFixed( 3 ) } m)` );
ok( av.ik.drop < - 0.14, 'the drop is reported (' + av.ik.drop.toFixed( 3 ) + ')' );
// a slope: the stance feet tilt with the normal, clamped to maxTilt
const n = new E.Vector3( 0, 1, 0.8 ).normalize();
av.setGroundProbe( ( p, mode, out ) => { out.x = p.x; out.y = 2; out.z = p.z; out.nx = n.x; out.ny = n.y; out.nz = n.z; return true; } );
run( 1.0 );
const fx = () => { const i = av.ik.I.foot_l * 16; return new E.Vector3( m.world[ i + 4 ], m.world[ i + 5 ], m.world[ i + 6 ] ).normalize(); }; // the foot's y axis
const tilt = clip.footY.angleTo( fx() );
ok( tilt > 2 * DEG && tilt <= FOOT.maxTilt + 1 * DEG, 'a slope tilts the stance foot, clamped (' + ( tilt / DEG ).toFixed( 1 ) + ' deg, the slope ' + ( Math.acos( n.y ) / DEG ).toFixed( 0 ) + ')' );
// swimming fades the feet out
av.setGroundProbe( step );
run( 0.8 );
run( 0.5, { mode: 'swim' } );
ok( av.ik.fw === 0 && av.ik.legs[ 0 ].off === 0, 'swimming: the foot IK is off' );
run( 0.5, { mode: 'walk' } );
// running fast fades it out
run( 0.6, { speed: 5 } );
ok( av.ik.fw === 0, 'sprinting: the foot IK is off' );
run( 0.6, { speed: 0 } );
ok( av.ik.fw === 1, 'standing again: the foot IK is back' );

// ---- hands: a world target in front of the left shoulder, within reach
av.setGroundProbe( null );
run( 0.5 );
const sh = W( 'upperarm_l' );
const fwd = new E.Vector3( 0, 0, 1 ).applyAxisAngle( new E.Vector3( 0, 1, 0 ), pose.yaw + Math.PI );
const target = sh.clone().addScaledVector( fwd, 0.35 ).addScaledVector( ax, 0.05 ).add( new E.Vector3( 0, - 0.15, 0 ) );
const palm0 = clipPalm();
const req = { leftHand: { position: target.clone() }, weight: 1 };
av.setIKTargets( req );
run( 0.05 );
const early = W( 'weapon_l' ).distanceTo( target );
run( 0.5 );
const reached = W( 'weapon_l' ).distanceTo( target );
ok( reached < 0.01, 'left palm on a world target (' + reached.toFixed( 4 ) + ' m off, started ' + palm0.distanceTo( target ).toFixed( 3 ) + ')' );
ok( early > reached + 0.02, 'the hand blends in over time, no snap (' + early.toFixed( 3 ) + ' m after 0.05 s)' );
req.weight = 0.5;
run( 0.5 );
const half = W( 'weapon_l' ).distanceTo( target ), full0 = clipPalm().distanceTo( target );
ok( Math.abs( half / full0 - 0.5 ) < 0.05, 'weight 0.5: about halfway (' + half.toFixed( 3 ) + ' of ' + full0.toFixed( 3 ) + ' m)' );
req.weight = 1;
// out of reach: the pelvis leans and the spine bends toward it, the hand gets closer than the arm alone could
const far = sh.clone().addScaledVector( fwd, 0.85 ).add( new E.Vector3( 0, - 0.3, 0 ) );
req.leftHand.position.copy( far );
run( 0.6 );
ok( av.ik.lean > 0.02 && W( 'weapon_l' ).distanceTo( far ) < 0.12, 'a far target leans the body toward it (lean ' + av.ik.lean.toFixed( 3 ) + ', ' + W( 'weapon_l' ).distanceTo( far ).toFixed( 3 ) + ' m off)' );
// a rotation target: the palm on the point and the hand turned to the given world rotation
{

	const q = new E.Quaternion().setFromAxisAngle( new E.Vector3( 0, 1, 0 ), pose.yaw + 0.4 ).multiply( new E.Quaternion().setFromAxisAngle( new E.Vector3( 1, 0, 0 ), - 1.2 ) );
	req.leftHand = { position: target.clone(), quaternion: q };
	run( 0.5 );
	const hq = new E.Quaternion();
	m.nodeMatrix( 'hand_l', new E.Matrix4() ).premultiply( av.group.matrixWorld ).decompose( new E.Vector3(), hq, new E.Vector3() );
	ok( W( 'weapon_l' ).distanceTo( target ) < 0.002 && hq.angleTo( q ) < 0.5 * DEG, 'a rotation target: palm on the point (' + W( 'weapon_l' ).distanceTo( target ).toFixed( 4 ) + ' m), hand turned (' + ( hq.angleTo( q ) / DEG ).toFixed( 2 ) + ' deg off)' );
	// a foot target: the left ankle lifted onto a point (a foot on a gunwale, a rung)
	const ft = W( 'foot_l' ).addScaledVector( fwd, 0.12 ).add( new E.Vector3( 0, 0.1, 0 ) );
	req.leftHand = null;
	req.leftFoot = { position: ft };
	run( 0.5 );
	ok( W( 'foot_l' ).distanceTo( ft ) < 0.005, 'a foot target: the ankle on the point (' + W( 'foot_l' ).distanceTo( ft ).toFixed( 4 ) + ' m)' );
	req.leftFoot = null;
	req.leftHand = { position: far };

}

// released: back to the clip
av.setIKTargets( null );
run( 0.6 );
const palmClip = clipPalm();
ok( W( 'weapon_l' ).distanceTo( palmClip ) < 0.001 && av.ik.hands[ 0 ].w === 0 && ! av.ik.active, 'released: the clip hand again (' + W( 'weapon_l' ).distanceTo( palmClip ).toFixed( 4 ) + ' m)' );

// ---- the rod: the left hand on the crank knob in the rod hand's socket frame, during the fight overlay
{

	const out = {};
	const player = { mode: 'walk' }, rod = { equipped: true, crank: 0.7 };
	contactTargets( out, { player, rod, boat: null, action: 'fight' } );
	ok( out.leftHand.weight === 1 && out.leftHand.socket === 'weapon_r' && out.rightHand.weight === 0, 'grips: fighting a fish puts the off hand on the reel knob' );
	av.setIKTargets( out );
	run( 0.8, { action: 'fight' } );
	const knob = crankKnobLocal( rod.crank, new E.Vector3() );
	const hm = av.handMatrix( new E.Matrix4() );
	const kw = knob.clone().applyMatrix4( hm );
	const d = W( 'weapon_l' ).distanceTo( kw );
	ok( d < 0.015, 'left palm on the crank knob (' + d.toFixed( 4 ) + ' m off)' );
	contactTargets( out, { player: { mode: 'swim' }, rod, boat: null, action: 'fight' } );
	ok( out.leftHand.weight === 0, 'grips: no rod grip while swimming' );
	const wheel = { model: { helmGrips: { left: { x: 0.2, y: 1.2, z: 0.5 }, right: { x: - 0.2, y: 1.2, z: 0.5 } } }, toWorld: ( l, o ) => o.copy( l ) };
	contactTargets( out, { player: { mode: 'boat' }, rod, boat: wheel, action: 'helm' } );
	ok( out.leftHand.weight === 1 && out.rightHand.weight === 1 && out.leftHand.socket === null && out.leftHand.position.y === 1.2, 'grips: both hands on declared helm grips' );
	av.setIKTargets( null );
	run( 0.4, { action: null } );

}

lockFeet( null ); // the graph's own stance weights from here on

// ---- the ragdoll takes the bones, the IK comes back after
{

	av.setGroundProbe( step );
	run( 0.8 );
	av.ragdoll( new E.Vector3( 0, 1, 2 ), { duration: 0.5, ground: () => 2 } );
	ok( av.ik.fw === 0 && ! av.ik.active, 'a knockdown resets the IK' );
	let finite = true;
	for ( let i = 0; i < 300 && av.ragdolling; i ++ ) { av.update( DT, pose ); finite = finite && Number.isFinite( W( 'pelvis' ).y ); }
	ok( ! av.ragdolling && finite, 'the ragdoll runs and ends with the shared pose hook' );
	run( 0.8 );
	ok( av.ik.fw === 1 && av.ik.drop < - 0.1, 'the foot IK fades back in after the get-up (drop ' + av.ik.drop.toFixed( 3 ) + ')' );

}

// ---- budget: feet on a step, both hands on world targets, the look; mean pass time (node; the browser is in the same range)
{

	const ik = av.ik;
	const lt = W( 'upperarm_l' ).addScaledVector( fwd, 0.3 ), rt = W( 'upperarm_r' ).addScaledVector( fwd, 0.3 );
	av.setIKTargets( { leftHand: lt, rightHand: rt, look: W( 'head' ).addScaledVector( fwd, 2 ).add( new E.Vector3( 0.5, 0.3, 0 ) ) } );
	run( 0.5 );
	const N = 2000;
	for ( let i = 0; i < 200; i ++ ) { ik.dt = DT; ik.apply( m ); }
	const t0 = performance.now();
	for ( let i = 0; i < N; i ++ ) { ik.dt = DT; ik.apply( m ); }
	const ms = ( performance.now() - t0 ) / N;
	ok( ms < 0.2, 'pass time ' + ms.toFixed( 4 ) + ' ms per character, feet + two hands + look (budget 0.2)' );
	// no garbage: the heap barely moves over many passes
	// no garbage (exact only under node --expose-gc; otherwise a collection in between can hide it)
	for ( let i = 0; i < 30000; i ++ ) ik.apply( m ); // let the optimizing compiler settle first
	if ( globalThis.gc ) globalThis.gc();
	const h0 = process.memoryUsage().heapUsed;
	for ( let i = 0; i < 20000; i ++ ) ik.apply( m );
	const grew = ( process.memoryUsage().heapUsed - h0 ) / 20000;
	ok( grew < 8, 'no per-pass allocation (' + grew.toFixed( 2 ) + ' bytes / pass' + ( globalThis.gc ? '' : ', run with --expose-gc for an exact figure' ) + ')' );

}

av.dispose();
console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
