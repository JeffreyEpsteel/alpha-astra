import { Group, Matrix4, Quaternion, Vector3 } from '../engine/index.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { CLIPS, characterUrl, CHARACTERS } from '../game/Characters.js';
import { ContactIK } from './ik/ContactIK.js';
import { ProcPose, repairHelmClip, bindLike } from './ik/ProcPose.js';
import { AnimGraph } from './anim/AnimGraph.js';

// A roster character in the world (the local player in third person, or a remote player): one
// SkinnedModel driven by a pose each frame. The pose is what both the walker and the network
// hand over; the avatar picks the clip, its playback rate and its transform from it.
//
//   const a = new Avatar( { scene, character: 'hyptile' } );     // loads the GLB; a.ready resolves
//   a.update( dt, pose );                                          // per frame
//   pose = { position: Vector3 (feet, world), yaw (world, radians: faces -Z at 0, like Player.yaw),
//            mode: 'walk' | 'swim' | 'deck' | 'seat' | 'boat', speed (m/s over ground), vy, grounded,
//            diving (bool), frame: Quaternion | null (the boat's orientation for deck / boat),
//            action: null | rod: 'hold' | 'charge' | 'cast' | 'strike' | 'reel' | 'fight'  (upper body, over the locomotion)
//                        | full body: 'celebrate' | 'disappointed' | 'wave' | 'talk' | 'dance' | 'cheer' | 'look' | 'seated' | rowing / steering ... }
//   a.actionRate = 1       playback rate of the reel / fight loops (the game sets it from the crank rate)
//   a.handMatrix( out )  -> world matrix of the right hand's prop socket (weapon_r), or null before load
//   a.headPosition( out ) -> world position of the head node
//   a.setCharacter( id ), a.visible, a.dispose()
//   a.lookAt( worldPoint, { seconds } ) / a.lookAt( null )   gaze toward a point (residents, vendors: the eyes only, 8 deg sideways, 6 up / down)
//   a.blink( { left, right } )   a blink now (they also happen by themselves every 2 to 6 s, and the gaze drifts a little)
//   a.ragdoll( impulse, { duration: 2.5, ground, getUp, reverse, rate } )   knockdown: a verlet ragdoll of the main bones (pelvis, spine,
//        chest, head, arms, legs) from the current pose with the current momentum + impulse (Vector3, m/s), ground contact against
//        ground( x, z ) (or a.groundHeight), then after `duration` s a blend into the get-up; a.ragdolling, a.ragdollPhase, a.onRagdollEnd
//        ( feetPosition, playerYaw ) -> put the player where the get-up ended. Melee / boarding call it on a knockdown and freeze the player.
//   a.setGroundProbe( probe )   foot IK ground (src/player/ik/Ground.js: playerGroundProbe( player ) / terrainGroundProbe( terrain, colliders ));
//        without one the feet keep the clip. Walk / deck / seat: feet planted on slopes and steps, the pelvis dropped to the lower foot.
//   a.setIKTargets( { leftHand, rightHand, leftFoot, rightFoot, look, weight } | null )   contact targets, world space: each { x, y, z }
//        or { position, quaternion?, socket?: bone name (position in that bone's frame), pole?, weight? }; kept until changed
//        (src/player/ik/Grips.js contactTargets() builds the helm / rod grips). a.ik: the ContactIK (null for rigs without the bones).
//   At the wheel (mode 'boat', not rowing / paddling) the helm state plays a standing base (the roster's Helm_Idle / Steer_* are
//        bind poses: repairHelmClip swaps in the idle; a.helmBase says which), the feet step to request.stand, the hands go on
//        the rim by the IK and src/player/ik/ProcPose.js adds the lean with request.steer (or pose.steer) and the sway against
//        the hull; rigs without the IK get arms-forward. In the water ProcPose treads (still) or flutter-kicks (the crawl clip).
//
//   Animation graph (src/player/anim: AnimGraph + the data module AnimDef.js, hot-reloaded): a state machine (idle / walk / jog /
//   run / sprint on the ground, jump / fall / land, swim, deck, seated, helm, ride, plane, action loops, ragdoll / getup, fishing)
//   with timed crossfade or inertial transitions, a polar blend space (direction x speed, phase-synced so the stride matches the
//   ground speed, strafe and backpedal legs) and montages. The pose action above still works: one-shots become full-body montages,
//   loops a looping state, rod actions the upper-body overlay.
//   a.setLocomotion( { speed, strafe, forward, turn, grounded } )   overrides for ~0.3 s after each call (combat strafing): strafe
//        and forward in m/s relative to the facing (+ = right / ahead), turn rad/s (+ = left). Without it the avatar reads speed from
//        the pose and the direction from how the pose position moves against the yaw (walk mode), or pose.forward / pose.strafe.
//   a.playMontage( name, { blendIn, blendOut, rate, slot: 'full' | 'upper', from, loop, hold, dir, onEvent } ) -> handle
//        { stop( blendOut ), onEvent( name, info ), playing, time, weight, rootMotion }; names in AnimDef.montages (swing, dodge*,
//        block, blockImpact, parry, hit / hitBack / hitLeft / hitRight, cast, strike, catch, wave, dance, emotes, boarding ...)
//        or any clip name. Events: 'start', 'blendOut', 'end' and the notifies ('contact' at the swing's hit frame, 'parry').
//   a.stopMontage( slot, blendOut ), a.state (read-only label), a.graph (AnimGraph: weights(), debugLine()),
//   a.onAnimEvent = ( name, info ) => {} (montage events, 'footstep'). ?animdebug in the URL logs a.graph.debugLine() once a
//   second for the first avatar.
//
// Clips are the in-place locomotion set converted by tools/roster (Characters.js CLIPS) plus the clips the graph derives at load
// (strafe legs, longer strides, procedural dodge / guard / parry / hit clips: AnimDef.clips).
//
// Two layers (SkinnedModel overlay): the BASE layer is the locomotion of the mode (idle / walk / run / jump, swim, helm, seat)
// or a full-body action (celebrate, dance, talk, sit, row ...); every ROD action (hold, charge, cast, strike, reel, fight)
// rides on the UPPER BODY overlay (spine ramp 0.5 / 0.8, then clavicles, arms, neck and head at 1), so walking or running with
// the rod out plays Walk_InPlace on the legs and Fishing_Hold on the arms. No rod overlay while swimming or at the helm.

const _q = new Quaternion(), _yq = new Quaternion(), _m = new Matrix4(), _v = new Vector3();
const _w = new Vector3(), _eyeA = new Vector3(), _eyeB = new Vector3();
const _yAxis = new Vector3( 0, 1, 0 ), _xAxis = new Vector3( 1, 0, 0 );
const WAIST = 0.62; // the rig's waist height (m): the pivot of the swim pitch
const DIVE_PITCH = 0.6; // rad past prone (nose-down) while diving down, as much head-up while rising (from the vertical speed)
// at the wheel these actions keep the graph's helm state (a standing base): the hands are on the rim by the contact IK and the
// steering is a procedural lean (src/player/ik/ProcPose.js), not the Steer_Left / Steer_Right clips
const HELM_ACT = { helm: true, steerLeft: true, steerRight: true };
const SWAY = { gain: 0.6, omega: 6, zeta: 0.5, max: 0.3 }; // the helmsman's upper body against the hull roll / pitch
const SWIM_PITCH = 1.2, SWIM_PITCH_FAST = 1.35; // rad forward of upright (the rig faces +Z, so +X pitches the head forward)
// action -> CLIPS key. One-shots play through and hand back to the pose loop; loops hold while the action is set
export const ONE_SHOT = {
	celebrate: 'celebrate', disappointed: 'disappointed', wave: 'wave', cheer: 'cheer',
	landSoft: 'landSoft', stumble: 'stumble', knockdown: 'knockdown', getUp: 'getUp', hit: 'hit', swing: 'swing', shrug: 'shrug', point: 'point',
	inspect: 'inspect', offer: 'offer', prankLaugh: 'prankLaugh', friendlyWave: 'friendlyWave', beckon: 'beckon', sitDown: 'sitDown', standUp: 'standUp',
	boardLow: 'boardLow', disembarkLow: 'disembarkLow', climbUp: 'climbUp',
};
export const LOOPS = {
	talk: 'talk', dance: 'dance', look: 'lookAround', tumble: 'tumble', fall: 'fall', chat: 'chat', sweep: 'sweep', laugh: 'laugh',
	swagger: 'swagger', rowForward: 'rowForward', rowBackward: 'rowBackward', paddleLeft: 'paddleLeft', paddleRight: 'paddleRight',
	steerLeft: 'steerLeft', steerRight: 'steerRight', seated: 'seated', helm: 'helm',
};

// rod actions -> CLIPS key, played on the upper-body overlay over the locomotion. The cast and the hook-set are one-shots that
// fall back to the hold when they end (the charge plays once and holds its last pose while the button stays down)
export const ROD = { hold: 'hold', charge: 'castCharge', cast: 'cast', strike: 'strike', reel: 'reel', fight: 'fight' };
const ROD_ONE_SHOT = { charge: true, cast: true, strike: true };
const ROD_FADE = { hold: 0.25, charge: 0.2, cast: 0.04, strike: 0.08, reel: 0.2, fight: 0.2 };
// a cast released before the charge reached its back swing starts further into Fishing_Cast, where the rod is at the same angle
// (charge time -> cast time; the key times are in tools/roster/fishing_pose.py, test/avatar-overlay.mjs checks the angles match)
const CHARGE_TO_CAST = [ [ 0, 0.09 ], [ 0.24, 0.05 ], [ 0.5, 0 ] ];
const CAST_FROM_HOLD = 0.06; // no charge seen (a remote player's pose): start the whip part way
export function castStartFrom( chargeTime ) {

	const T = CHARGE_TO_CAST;
	if ( chargeTime <= T[ 0 ][ 0 ] ) return T[ 0 ][ 1 ];
	for ( let i = 1; i < T.length; i ++ ) if ( chargeTime <= T[ i ][ 0 ] ) return T[ i - 1 ][ 1 ] + ( T[ i ][ 1 ] - T[ i - 1 ][ 1 ] ) * ( chargeTime - T[ i - 1 ][ 0 ] ) / ( T[ i ][ 0 ] - T[ i - 1 ][ 0 ] );
	return T[ T.length - 1 ][ 1 ];

}

// overlay mask: the ramp up the spine, everything above at full weight (arms and fingers under the clavicles, head under the neck)
export const UPPER_BODY = { spine_01: 0.5, spine_02: 0.8, clavicle_l: 1, clavicle_r: 1, neck_01: 1 };

// ---- eyes: blink and gaze (the six morph targets of the roster GLBs: Blink_L / Blink_R 0..1 closed, Gaze_Left / Gaze_Right 8 deg,
// Gaze_Up / Gaze_Down 6 deg; "left" is the character's left, model +X; opposite gaze keys are never driven together)

const ANIM_DEBUG = typeof location !== 'undefined' && /[?&]animdebug/.test( location.search || '' );
const GAZE_YAW = 8 * Math.PI / 180, GAZE_PITCH = 6 * Math.PI / 180;
const smooth = ( x ) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * ( 3 - 2 * x );

// Random blinks every 2 to 6 s (both lids, sometimes one, sometimes twice in a row) and small gaze drifts; setLook( x, y )
// holds the gaze on a direction (x: + is the character's left, y: + is up, both -1..1 = the full travel of the eyes).
// Works on any SkinnedModel with the morph targets (residents and vendors can build one on their model and call update( dt ));
// characters without them (Bravile, Heptyle) have no driver.
export class EyeDriver {

	constructor( model, rng = Math.random ) {

		this.model = model;
		this.rng = rng;
		this.enabled = true;
		this.blinkL = 0; this.blinkR = 0; // the weights written last
		this.gx = 0; this.gy = 0; // the gaze now
		this._tx = 0; this._ty = 0; // the drift target
		this._look = null; // { x, y }
		this._wait = 0.8 + rng() * 2.5; // seconds to the next blink
		this._blink = null; // { t, left, right }
		this._again = 0; // a second blink follows this many seconds after the first (0 = none)
		this._drift = 0.4 + rng() * 1.5;
		this.blinks = 0; // how many blinks have started

	}

	// a blink now: { left, right } (both by default)
	blink( { left = true, right = true } = {} ) {

		this._blink = { t: 0, left, right };
		this.blinks ++;

	}

	// hold the gaze on a direction (x, y in -1..1), or null to let it wander again
	setLook( x, y ) {

		if ( ( x === null || x === undefined ) && this._look ) this._drift = 0; // let go: pick a wander target at once
		this._look = x === null || x === undefined ? null : { x: Math.max( - 1, Math.min( 1, x ) ), y: Math.max( - 1, Math.min( 1, y ) ) };

	}

	get looking() {

		return !! this._look;

	}

	// lid closure over a blink: closing 0.07 s, shut 0.03 s, opening 0.12 s
	static lid( t ) {

		return t < 0.07 ? smooth( t / 0.07 ) : t < 0.1 ? 1 : 1 - smooth( ( t - 0.1 ) / 0.12 );

	}

	update( dt ) {

		const m = this.model, r = this.rng;
		if ( ! this.enabled || dt <= 0 ) return;
		// blinks
		const b = this._blink;
		if ( b ) {

			b.t += dt;
			if ( b.t >= 0.22 ) {

				this._blink = null;
				this._wait = this._again > 0 ? this._again : 2 + r() * 4;
				this._again = 0;

			}

		} else {

			this._wait -= dt;
			if ( this._wait <= 0 ) {

				const roll = r();
				if ( roll < 0.16 ) this.blink( r() < 0.5 ? { left: true, right: false } : { left: false, right: true } ); // one lid
				else {

					this.blink();
					if ( roll > 0.86 ) this._again = 0.12; // a double blink

				}

			}

		}

		const w = this._blink ? EyeDriver.lid( this._blink.t ) : 0;
		this.blinkL = this._blink && this._blink.left ? w : 0;
		this.blinkR = this._blink && this._blink.right ? w : 0;
		// gaze: a drift target now and then, or the held direction with a little life in it; the eyes snap to it quickly
		this._drift -= dt;
		if ( this._drift <= 0 ) {

			this._drift = 0.7 + r() * 1.7;
			if ( this._look ) {

				// a little life around the held direction
				this._tx = ( r() * 2 - 1 ) * 0.07;
				this._ty = ( r() * 2 - 1 ) * 0.04;

			} else {

				const still = r() < 0.35;
				this._tx = still ? 0 : ( r() * 2 - 1 ) * 0.45;
				this._ty = still ? 0 : ( r() * 2 - 1 ) * 0.27;

			}

		}

		const look = this._look;
		const k = 1 - Math.exp( - dt * ( look ? 18 : 14 ) );
		this.gx += ( Math.max( - 1, Math.min( 1, ( look ? look.x : 0 ) + this._tx ) ) - this.gx ) * k;
		this.gy += ( Math.max( - 1, Math.min( 1, ( look ? look.y : 0 ) + this._ty ) ) - this.gy ) * k;
		m.setMorph( 'Blink_L', this.blinkL );
		m.setMorph( 'Blink_R', this.blinkR );
		m.setMorph( 'Gaze_Left', Math.max( 0, this.gx ) );
		m.setMorph( 'Gaze_Right', Math.max( 0, - this.gx ) );
		m.setMorph( 'Gaze_Up', Math.max( 0, this.gy ) );
		m.setMorph( 'Gaze_Down', Math.max( 0, - this.gy ) );

	}

}

// ---- ragdoll: verlet particles on the joints of the rig, distance links for the bones and the torso, distance limits for the
// joints, ground contact against a height function. The simulation runs in world space; the model's bones are then rewritten
// from the particles (the swing of each bone from its start direction; the torso from two frames), see Ragdoll.apply.
//
// Bodies (14 bone segments): pelvis, spine, chest, head, upper arm x2, forearm x2, thigh x2, calf x2, foot x2; 19 particles carry them.

const RD_PARTS = [
	// [ particle, node it sits on ('$top': above the head), collision radius (m), inverse mass ]
	[ 'pelvis', 'pelvis', 0.11, 0.5 ], [ 'chest', 'spine_02', 0.11, 0.5 ], [ 'neck', 'neck_01', 0.05, 1 ], [ 'head', 'head', 0.1, 0.8 ], [ 'top', '$top', 0.08, 0.8 ],
	[ 'shL', 'upperarm_l', 0.06, 1 ], [ 'shR', 'upperarm_r', 0.06, 1 ], [ 'elL', 'lowerarm_l', 0.05, 1.2 ], [ 'elR', 'lowerarm_r', 0.05, 1.2 ],
	[ 'haL', 'hand_l', 0.045, 1.5 ], [ 'haR', 'hand_r', 0.045, 1.5 ],
	[ 'hipL', 'thigh_l', 0.09, 0.7 ], [ 'hipR', 'thigh_r', 0.09, 0.7 ], [ 'knL', 'calf_l', 0.065, 1 ], [ 'knR', 'calf_r', 0.065, 1 ],
	[ 'anL', 'foot_l', 0.075, 1.2 ], [ 'anR', 'foot_r', 0.075, 1.2 ], [ 'toL', 'ball_l', 0.035, 1.5 ], [ 'toR', 'ball_r', 0.035, 1.5 ],
];
// rigid links (the bone lengths and the torso / head frames); rest lengths are taken from the start pose
const RD_LINKS = [
	[ 'pelvis', 'chest' ], [ 'chest', 'neck' ], [ 'neck', 'head' ], [ 'head', 'top' ], [ 'neck', 'top' ],
	[ 'pelvis', 'hipL' ], [ 'pelvis', 'hipR' ], [ 'hipL', 'hipR' ], [ 'chest', 'hipL' ], [ 'chest', 'hipR' ],
	[ 'chest', 'shL' ], [ 'chest', 'shR' ], [ 'shL', 'shR' ], [ 'neck', 'shL' ], [ 'neck', 'shR' ], [ 'pelvis', 'shL' ], [ 'pelvis', 'shR' ], [ 'hipL', 'shL' ], [ 'hipR', 'shR' ],
	[ 'shL', 'elL' ], [ 'elL', 'haL' ], [ 'shR', 'elR' ], [ 'elR', 'haR' ],
	[ 'hipL', 'knL' ], [ 'knL', 'anL' ], [ 'hipR', 'knR' ], [ 'knR', 'anR' ], [ 'anL', 'toL' ], [ 'anR', 'toR' ],
];
// bones rewritten as the swing of a particle pair; the pelvis and the spine use two torso frames
const RD_CHAIN = {
	neck_01: [ 'neck', 'head' ], head: [ 'head', 'top' ], upperarm_l: [ 'shL', 'elL' ], lowerarm_l: [ 'elL', 'haL' ], upperarm_r: [ 'shR', 'elR' ], lowerarm_r: [ 'elR', 'haR' ],
	thigh_l: [ 'hipL', 'knL' ], calf_l: [ 'knL', 'anL' ], thigh_r: [ 'hipR', 'knR' ], calf_r: [ 'knR', 'anR' ], foot_l: [ 'anL', 'toL' ], foot_r: [ 'anR', 'toR' ],
};
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _e = new Vector3(), _f = new Vector3();
const _m4 = new Matrix4(), _qa = new Quaternion(), _qb = new Quaternion(), _qc = new Quaternion(), _sc = new Vector3();

export class Ragdoll {

	// model: the SkinnedModel in its current pose (the start pose); anchor: Matrix4 model space -> world (the avatar group's world
	// matrix, held fixed while the ragdoll runs); ground( x, z ) -> world height; velocity: Vector3, world m/s, given to every particle
	constructor( model, anchor, ground, velocity = null ) {

		this.model = model;
		this.anchor = anchor.clone();
		this.anchorInv = anchor.clone().invert();
		this.ground = ground;
		const nodes = model.gltf.nodes;
		const find = ( n ) => nodes.findIndex( ( x ) => x.name === n );
		this.names = RD_PARTS.map( ( p ) => p[ 0 ] );
		const I = this.index = Object.fromEntries( this.names.map( ( n, i ) => [ n, i ] ) );
		const N = RD_PARTS.length;
		this.p = Array.from( { length: N }, () => new Vector3() );
		this.q = Array.from( { length: N }, () => new Vector3() ); // previous positions
		this.radius = RD_PARTS.map( ( p ) => p[ 2 ] );
		this.inv = RD_PARTS.map( ( p ) => p[ 3 ] );
		// start positions (world) from the current pose
		const W = model.world;
		const mat = ( node, out ) => out.fromArray( W, node * 16 );
		for ( let i = 0; i < N; i ++ ) {

			const node = RD_PARTS[ i ][ 1 ];
			if ( node === '$top' ) {

				// 0.16 m up the head bone
				mat( find( 'head' ), _m4 );
				const e = _m4.elements;
				this.p[ i ].set( e[ 12 ] + e[ 4 ] * 0.16, e[ 13 ] + e[ 5 ] * 0.16, e[ 14 ] + e[ 6 ] * 0.16 );

			} else this.p[ i ].setFromMatrixPosition( mat( find( node ), _m4 ) );
			this.p[ i ].applyMatrix4( this.anchor );

		}

		// momentum: every particle moves at the start velocity (verlet: the previous position trails it)
		this._dt = 1 / 120;
		for ( let i = 0; i < N; i ++ ) {

			this.q[ i ].copy( this.p[ i ] );
			if ( velocity ) this.q[ i ].addScaledVector( velocity, - this._dt );

		}

		// links and limits
		this.links = RD_LINKS.map( ( [ a, b ] ) => ( { a: I[ a ], b: I[ b ], len: this.p[ I[ a ] ].distanceTo( this.p[ I[ b ] ] ) } ) );
		const L = ( a, b ) => this.p[ I[ a ] ].distanceTo( this.p[ I[ b ] ] );
		const hinge = ( a, b, c, deg ) => {

			// the shortest a-c distance of a joint at b that may fold by deg degrees at most
			const l1 = L( a, b ), l2 = L( b, c ), r = deg * Math.PI / 180;
			return Math.sqrt( l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos( r ) );

		};

		this.limits = [
			// knees fold to 35 deg, elbows to 25, the spine and the neck bend about 70 deg
			{ a: I.hipL, b: I.anL, min: hinge( 'hipL', 'knL', 'anL', 35 ) }, { a: I.hipR, b: I.anR, min: hinge( 'hipR', 'knR', 'anR', 35 ) },
			{ a: I.shL, b: I.haL, min: hinge( 'shL', 'elL', 'haL', 25 ) }, { a: I.shR, b: I.haR, min: hinge( 'shR', 'elR', 'haR', 25 ) },
			{ a: I.pelvis, b: I.neck, min: ( L( 'pelvis', 'chest' ) + L( 'chest', 'neck' ) ) * 0.78 },
			{ a: I.chest, b: I.top, min: ( L( 'chest', 'neck' ) + L( 'neck', 'head' ) + 0.16 ) * 0.62 },
			// limbs stay out of the torso and off each other
			{ a: I.elL, b: I.chest, min: 0.1 }, { a: I.elR, b: I.chest, min: 0.1 }, { a: I.haL, b: I.pelvis, min: 0.12 }, { a: I.haR, b: I.pelvis, min: 0.12 },
			{ a: I.knL, b: I.knR, min: 0.11 }, { a: I.anL, b: I.anR, min: 0.1 }, { a: I.knL, b: I.chest, min: 0.2 }, { a: I.knR, b: I.chest, min: 0.2 },
		];
		// start orientation data
		this.node = {};
		for ( const n of [ 'pelvis', 'spine_01', 'spine_02', ...Object.keys( RD_CHAIN ) ] ) this.node[ n ] = find( n );
		this.R0 = {};
		for ( const n in this.node ) this.R0[ n ] = this._rot( this.node[ n ] );
		this.d0 = {};
		for ( const n in RD_CHAIN ) this.d0[ n ] = this._dir( RD_CHAIN[ n ][ 0 ], RD_CHAIN[ n ][ 1 ], new Vector3() );
		this.Q0low = this._frame( 'hipL', 'hipR', 'pelvis', 'chest', new Quaternion() );
		this.Q0up = this._frame( 'shL', 'shR', 'chest', 'neck', new Quaternion() );
		// everything else keeps its start local rotation (clavicles, hands, fingers, toes, eyes, sockets)
		this.frozen = model.local.map( ( l ) => Float32Array.from( l.r ) );
		const pn = model.parent[ this.node.pelvis ];
		this.parentInv = pn >= 0 ? mat( pn, new Matrix4() ).invert() : new Matrix4();
		this._wr = model.local.map( () => new Quaternion() );
		this._target = new Map(); // node -> the world rotation the ragdoll wants
		this.time = 0;
		this.calm = 0; // seconds the particles have been nearly still
		this.contacts = 0;
		this.maxSpeed = 0;
		this._acc = 0;

	}

	// the rotation of a node in model space (from the world matrices of the last pose)
	_rot( node ) {

		_m4.fromArray( this.model.world, node * 16 ).decompose( _a, _qc, _sc );
		return _qc.clone();

	}

	// model-space position of a particle
	local( i, out ) {

		return out.copy( this.p[ i ] ).applyMatrix4( this.anchorInv );

	}

	_dir( a, b, out ) {

		this.local( this.index[ a ], _a ); this.local( this.index[ b ], _b );
		return out.subVectors( _b, _a ).normalize();

	}

	// an orthonormal frame from a lateral pair (left - right) and an up pair, as a quaternion (model space: +X left, +Y up, +Z forward)
	_frame( l, r, from, to, out ) {

		this.local( this.index[ l ], _a ); this.local( this.index[ r ], _b ); this.local( this.index[ from ], _c ); this.local( this.index[ to ], _d );
		const x = _a.sub( _b ).normalize(), up = _d.sub( _c );
		const z = _e.crossVectors( x, up ).normalize(), y = _f.crossVectors( z, x );
		_m4.makeBasis( x, y, z );
		return out.setFromRotationMatrix( _m4 );

	}

	// a velocity change in m/s on every particle, a little more on the upper body so the fall tumbles
	impulse( v ) {

		for ( let i = 0; i < this.p.length; i ++ ) this.q[ i ].addScaledVector( v, - ( i <= 4 ? 1.25 : 1 ) * this._dt );

	}

	step( dt ) {

		this._acc += Math.min( dt, 0.1 );
		const h = this._dt;
		let n = 0;
		while ( this._acc >= h && n < 8 ) {

			this._acc -= h;
			n ++;
			this._sub( h );

		}

		this.time += dt;

	}

	_sub( h ) {

		const P = this.p, Q = this.q, N = P.length;
		// verlet: x += ( x - x_prev ) * damping + g h h
		let top = 0;
		for ( let i = 0; i < N; i ++ ) {

			_a.subVectors( P[ i ], Q[ i ] ).multiplyScalar( 0.9985 );
			top = Math.max( top, _a.length() / h );
			Q[ i ].copy( P[ i ] );
			P[ i ].add( _a );
			P[ i ].y -= 9.81 * h * h;

		}

		for ( let it = 0; it < 10; it ++ ) {

			for ( const l of this.links ) this._pull( l.a, l.b, l.len, l.len );
			for ( const l of this.limits ) this._pull( l.a, l.b, l.min, 1e9 );
			// the knees bend forward only: a knee stays in front of the hip-ankle line (the torso's forward axis)
			this._kneeFront( this.index.hipL, this.index.knL, this.index.anL );
			this._kneeFront( this.index.hipR, this.index.knR, this.index.anR );
			this._collide();

		}

		// ground friction: a particle in contact loses part of its sliding speed; the speed left after the constraints is the real one
		this.contacts = 0;
		top = 0;
		for ( let i = 0; i < N; i ++ ) {

			top = Math.max( top, P[ i ].distanceTo( Q[ i ] ) / h );

			if ( P[ i ].y <= this.ground( P[ i ].x, P[ i ].z ) + this.radius[ i ] + 0.004 ) {

				this.contacts ++;
				Q[ i ].x += ( P[ i ].x - Q[ i ].x ) * 0.22;
				Q[ i ].z += ( P[ i ].z - Q[ i ].z ) * 0.22;

			}

		}

		this.maxSpeed = top;
		this.calm = top < 0.12 ? this.calm + h : 0;

	}

	// keep the distance of particles a and b inside [ lo, hi ] (the correction is shared by inverse mass)
	_pull( a, b, lo, hi ) {

		const P = this.p;
		_a.subVectors( P[ b ], P[ a ] );
		const d = _a.length();
		if ( d < 1e-9 ) return;
		const target = d < lo ? lo : d > hi ? hi : d;
		if ( target === d ) return;
		const wa = this.inv[ a ], wb = this.inv[ b ], k = ( d - target ) / d / ( wa + wb );
		P[ a ].addScaledVector( _a, k * wa );
		P[ b ].addScaledVector( _a, - k * wb );

	}

	_kneeFront( hip, knee, ankle ) {

		const P = this.p, I = this.index;
		const lat = _a.subVectors( P[ I.hipL ], P[ I.hipR ] ), up = _b.subVectors( P[ I.chest ], P[ I.pelvis ] );
		const F = _c.crossVectors( lat, up );
		if ( F.lengthSq() < 1e-9 ) return;
		F.normalize();
		_d.addVectors( P[ hip ], P[ ankle ] ).multiplyScalar( 0.5 );
		const s = _e.subVectors( P[ knee ], _d ).dot( F );
		if ( s < 0.004 ) P[ knee ].addScaledVector( F, ( 0.004 - s ) * 0.6 );

	}

	_collide() {

		const P = this.p, Q = this.q;
		for ( let i = 0; i < P.length; i ++ ) {

			const g = this.ground( P[ i ].x, P[ i ].z ) + this.radius[ i ];
			if ( P[ i ].y < g ) {

				// a small bounce: the verlet velocity left after the correction points up
				const vy = P[ i ].y - Q[ i ].y;
				P[ i ].y = g;
				if ( vy < 0 ) Q[ i ].y = g + vy * 0.1;

			}

		}

	}

	// every particle finite
	valid() {

		for ( const p of this.p ) if ( ! Number.isFinite( p.x + p.y + p.z ) ) return false;
		return true;

	}

	// lowest margin of any particle above its ground (negative: through the ground)
	clearance() {

		let m = Infinity;
		for ( let i = 0; i < this.p.length; i ++ ) m = Math.min( m, this.p[ i ].y - this.radius[ i ] - this.ground( this.p[ i ].x, this.p[ i ].z ) );
		return m;

	}

	pelvisWorld( out ) {

		return out.copy( this.p[ this.index.pelvis ] );

	}

	// write the ragdoll into model.local: each bone's local rotation is nlerped from the animated one to the ragdoll's by alpha (1 = all
	// ragdoll), the pelvis translation likewise. align = { q: Quaternion about Y, c: Vector3, p0: Vector3 } first turns the animated
	// pelvis (rotation by q, translation about p0 then onto c) so a get-up clip lies the way the body lies.
	apply( model, alpha, align = null ) {

		const L = model.local, I = this.index;
		if ( align ) {

			const pl = L[ this.node.pelvis ];
			_qa.fromArray( pl.r ); _qa.premultiply( align.q ); _qa.toArray( pl.r );
			_a.set( pl.t[ 0 ] - align.p0.x, 0, pl.t[ 2 ] - align.p0.z ).applyQuaternion( align.q );
			pl.t[ 0 ] = _a.x + align.c.x; pl.t[ 2 ] = _a.z + align.c.z;

		}

		if ( alpha <= 0 ) return;
		// torso frames and bone swings in model space
		const dLow = this._frame( 'hipL', 'hipR', 'pelvis', 'chest', new Quaternion() ).multiply( _qb.copy( this.Q0low ).invert() );
		const dUp = this._frame( 'shL', 'shR', 'chest', 'neck', new Quaternion() ).multiply( _qb.copy( this.Q0up ).invert() );
		const T = this._target;
		T.set( this.node.pelvis, dLow.clone().multiply( this.R0.pelvis ) );
		T.set( this.node.spine_01, new Quaternion().slerpQuaternions( dLow, dUp, 0.5 ).multiply( this.R0.spine_01 ) );
		T.set( this.node.spine_02, dUp.clone().multiply( this.R0.spine_02 ) );
		for ( const n in RD_CHAIN ) {

			const d1 = this._dir( RD_CHAIN[ n ][ 0 ], RD_CHAIN[ n ][ 1 ], _d );
			T.set( this.node[ n ], new Quaternion().setFromUnitVectors( this.d0[ n ], d1 ).multiply( this.R0[ n ] ) );

		}

		// parent-first: ragdoll world rotation -> ragdoll local rotation, then the blend with the animation
		for ( const i of model.order ) {

			const p = model.parent[ i ];
			const wr = this._wr[ i ];
			const pw = p >= 0 ? this._wr[ p ] : _qc.identity();
			let rag;
			if ( T.has( i ) ) {

				wr.copy( T.get( i ) );
				rag = _qa.copy( pw ).invert().multiply( wr );

			} else {

				rag = _qa.fromArray( this.frozen[ i ] );
				wr.copy( pw ).multiply( rag );

			}

			const r = L[ i ].r;
			// nlerp( animated, ragdoll, alpha ) along the shorter arc
			const d = r[ 0 ] * rag.x + r[ 1 ] * rag.y + r[ 2 ] * rag.z + r[ 3 ] * rag.w;
			const s = d < 0 ? - alpha : alpha, k = 1 - alpha;
			const x = r[ 0 ] * k + rag.x * s, y = r[ 1 ] * k + rag.y * s, z = r[ 2 ] * k + rag.z * s, w = r[ 3 ] * k + rag.w * s;
			const l = 1 / Math.hypot( x, y, z, w );
			r[ 0 ] = x * l; r[ 1 ] = y * l; r[ 2 ] = z * l; r[ 3 ] = w * l;

		}

		// the pelvis follows its particle
		this.local( I.pelvis, _a ).applyMatrix4( this.parentInv );
		const t = L[ this.node.pelvis ].t, k = 1 - alpha;
		t[ 0 ] = t[ 0 ] * k + _a.x * alpha; t[ 1 ] = t[ 1 ] * k + _a.y * alpha; t[ 2 ] = t[ 2 ] * k + _a.z * alpha;

	}

}

// foot IK weight for a pose: on the ground in walk / deck / seat, out while airborne, swimming, at the helm, in a tumble or a
// clip that moves the root (boarding, knockdowns), and faded out from a jog to a sprint
const NO_FEET = { tumble: true, fall: true, knockdown: true, getUp: true, boardLow: true, disembarkLow: true, stumble: true, landSoft: true, climbUp: true };
const FEET_RUN = [ 2.6, 4.2 ]; // m/s: full plant below, none above
export function footWeight( pose, action = null ) {

	const mode = pose.mode;
	if ( mode !== 'walk' && mode !== 'deck' && mode !== 'seat' ) return 0;
	if ( pose.grounded === false || ( action && NO_FEET[ action ] ) ) return 0;
	return 1 - smooth( ( ( pose.speed || 0 ) - FEET_RUN[ 0 ] ) / ( FEET_RUN[ 1 ] - FEET_RUN[ 0 ] ) );

}

export class Avatar {

	constructor( { scene, character = 'hyptile', lite = false } ) {

		this.scene = scene;
		this.group = new Group();
		this.group.name = 'Avatar';
		this.character = character;
		this.lite = lite;
		this.model = null;
		this.visible = true;
		this._gen = 0;
		this._action = null;
		this._actionT = 0;
		this._ovKey = null; // the rod action now on the overlay
		this._ovLayer = null;
		this._ovDone = null; // a one-shot rod action that has played out
		this._eyes = null; // EyeDriver (blink / gaze) when the character has the morph targets
		this._lookTarget = null; // lookAt( worldPoint )
		this._lookLeft = 0;
		this._inv = new Matrix4();
		this._rd = null; // the ragdoll knockdown in progress
		this._disp = new Vector3(); // where the get-up left the avatar, relative to the pose position (eases back to 0)
		this._dyaw = 0;
		this._lastPos = new Vector3();
		this._vel = new Vector3(); // ground velocity of the pose position (a knockdown keeps the momentum)
		this._poseYaw = 0;
		this._havePos = false;
		this.groundHeight = null; // ( x, z ) -> world height, for the ragdoll (default: the plane the avatar stands on)
		this.onRagdollEnd = null; // ( feetWorldPosition, playerYaw ) after the get-up: move the player there (Player.yaw convention)
		this.ik = null; // ContactIK (src/player/ik): foot planting and hand / look targets after the clip pose
		this.ikEnabled = true;
		this._ikProbe = null;
		this._ikReq = null;
		this.graph = null; // AnimGraph (src/player/anim) once the model is in
		this.onAnimEvent = null; // ( name, info ): montage events and notifies, 'footstep'
		this._loco = null; // setLocomotion overrides { ..., age }
		this._actM = null; // the montage the pose action started
		this._sv = { x: 0, z: 0 }; // smoothed ground velocity (world) for the strafe direction
		this._turn = 0;
		this._air = 0;
		this._lastAir = 0;
		this._prevYaw = null;
		this._dbgT = 0;
		this._proc = null; // ProcPose: the helm lean / hands, treading water and the crawl kick (src/player/ik/ProcPose.js)
		this.helmBase = null; // 'clip' | 'idle' | 'none': what the helm state plays on this rig (repairHelmClip)
		this._bindClips = new Map();
		this._helmW = 0; this._steerS = 0;
		this._sway = { x: 0, z: 0, vx: 0, vz: 0 };
		this._tread = 0; this._crawl = 0;
		if ( ANIM_DEBUG && ! Avatar._debugOwner ) Avatar._debugOwner = this;
		this.ready = this.setCharacter( character );
		scene.add( this.group );

	}

	// load (or swap) the character; resolves when it is in the scene
	async setCharacter( id ) {

		if ( ! CHARACTERS[ id ] ) id = 'hyptile';
		this.character = id;
		const gen = ++ this._gen;
		let model;
		try {

			model = await SkinnedModel.create( await loadGLB( characterUrl( id ) ) );

		} catch ( e ) {

			console.warn( 'Avatar: character failed to load', id, e );
			return null;

		}

		if ( gen !== this._gen ) {

			model.dispose();
			return null;

		}

		if ( this.lite ) for ( const m of model.materials ) m.underwaterLighting = 'lite';
		if ( this.model ) {

			this.group.remove( this.model.group );
			this.model.dispose();

		}

		this.model = model;
		this._ovKey = null;
		this._ovLayer = null;
		this._ovDone = null;
		this._rd = null;
		this._eyes = model.hasMorph( 'Blink_L' ) || model.hasMorph( 'Gaze_Left' ) ? new EyeDriver( model ) : null;
		this.group.add( model.group );
		// the roster's helm clip is its bind pose (an A at the wheel): the helm state plays a standing idle instead
		this.helmBase = repairHelmClip( model );
		this._bindClips = new Map();
		this._proc = ProcPose.create( model );
		// one pose hook for both procedural drivers: the ragdoll while down, else the contact IK
		this.ik = ContactIK.create( model );
		if ( this.ik ) {

			this.ik.probe = this._ikProbe;
			this.ik.setTargets( this._ikReq );

		}

		// the animation graph decides the clip layers; its post pass (inertial blends, the lean) runs before the IK
		if ( this.graph ) this.graph.dispose();
		const graph = this.graph = new AnimGraph( model, { cacheKey: id, upperMask: UPPER_BODY } );
		graph.onEvent = ( name, info ) => {

			if ( this.onAnimEvent ) this.onAnimEvent( name, info );

		};

		this._actM = null;
		this._doneAct = null;
		model.poseOverride = ( mm ) => {

			const rd = this._rd;
			if ( rd ) rd.sim.apply( mm, rd.alpha, rd.align );
			else {

				graph.post( mm );
				if ( this._proc ) this._proc.apply( mm ); // the helm lean / hands, the water (before the IK takes the hands)
				graph.capture( mm ); // the next inertial blend starts from this (before the IK)
				if ( this.ik ) this.ik.apply( mm );
				return;

			}

			graph.capture( mm );

		};

		graph.update( 0, this._context( 0, { mode: 'walk', speed: 0, grounded: true, yaw: 0 }, null, null ) );
		model.update( 0 );
		model.onOverlayEnd = ( name ) => {

			// a rod one-shot (cast, hook-set) hands back to the hold
			if ( this._ovKey && ROD_ONE_SHOT[ this._ovKey ] && CLIPS[ ROD[ this._ovKey ] ] === name ) this._ovDone = this._ovKey;

		};

		return model;

	}

	update( dt, pose ) {

		const m = this.model;
		this.group.visible = this.visible;
		// ground speed of the pose position: a knockdown starts with the momentum of the walk or the run
		if ( dt > 0 && this._havePos ) {

			this._vel.subVectors( pose.position, this._lastPos ).divideScalar( dt );
			this._vel.y = 0;
			if ( this._vel.length() > 14 ) this._vel.set( 0, 0, 0 ); // a teleport, not a run

		}

		this._lastPos.copy( pose.position );
		this._havePos = true;
		this._poseYaw = pose.yaw;
		if ( this._rd ) {

			// a ragdoll holds the avatar where it fell; the bones carry the motion, the group stays on the anchor
			this.group.position.copy( this._rd.pos );
			this.group.quaternion.copy( this._rd.quat );
			this.group.updateMatrixWorld( true );
			if ( m && this.visible ) {

				this._updateEyes( m, dt );
				this._ragdollFrame( m, dt, pose );

			} else if ( m ) m.hold();
			return;

		}

		// transform: feet at the position, facing the yaw (the rig faces +Z; Player.yaw faces -Z at 0)
		this.group.position.copy( pose.position );
		// at the wheel the feet step from the helm point to the hull's helmStand (handed over with the grips), within reach
		const stand = pose.mode === 'boat' && this._helmW > 0 && this._ikReq && this._ikReq.stand;
		if ( stand && stand.distanceToSquared( pose.position ) < 1 ) this.group.position.lerp( stand, smooth( this._helmW ) );
		_yq.setFromAxisAngle( _yAxis, pose.yaw + Math.PI + this._dyaw );
		if ( pose.frame ) this.group.quaternion.copy( pose.frame ).multiply( _yq );
		else this.group.quaternion.copy( _yq );
		if ( this._disp.lengthSq() > 1e-8 || Math.abs( this._dyaw ) > 1e-4 ) {

			// after a get-up the avatar stands where the ragdoll left it; if nobody moved the player there, it eases back
			this.group.position.add( this._disp );
			const k = Math.exp( - dt * 4 );
			this._disp.multiplyScalar( k );
			this._dyaw *= k;

		}

		// swimming: the authored swim clips keep the body upright (a treading / crawling pelvis at 0.67 m with the
		// head 0.55 m above it), so the avatar pitches forward about the waist: upright to tread water, nearly
		// prone while it swims, steeper when diving. The pitch eases so a stop or a dive does not snap.
		if ( pose.mode === 'swim' ) {

			const s = pose.speed || 0;
			let target = s < 0.2 ? 0.08 : s < 1.9 ? SWIM_PITCH : SWIM_PITCH_FAST;
			// diving: nose-down past prone while going down, head-up while coming up, upright when hovering
			if ( pose.diving ) target = s < 0.2 ? 0.5 : Math.PI / 2 - Math.max( - DIVE_PITCH, Math.min( DIVE_PITCH, ( pose.vy || 0 ) * 0.4 ) );
			if ( this._pitch === undefined || this._wasSwim !== true ) this._pitch = Math.min( target, 0.3 );
			this._pitch += ( target - this._pitch ) * Math.min( 1, dt * 4 );
			this.group.quaternion.multiply( _q.setFromAxisAngle( _xAxis, this._pitch ) );
			// the waist stays on the swim point whatever the pitch: just above the water upright, awash prone
			_v.set( 0, WAIST, 0 ).applyQuaternion( this.group.quaternion );
			const waistY = pose.diving ? 0 : 0.07 - 0.17 * Math.min( 1, this._pitch / SWIM_PITCH );
			this.group.position.y += waistY - _v.y;
			this.group.position.x -= _v.x;
			this.group.position.z -= _v.z;

		}

		this._wasSwim = pose.mode === 'swim';
		this.group.updateMatrixWorld( true );
		if ( ! m ) return;
		if ( ! this.visible ) {

			m.hold();
			return;

		}

		this._updateEyes( m, dt );
		this._ikFrame( dt, pose );
		const g = this.graph;
		// a tool that drives the clips itself (test/roster-preview.mjs clip=) replaces model.play: leave the layers to it
		if ( ! g || m.play !== SkinnedModel.prototype.play ) {

			m.update( dt );
			return;

		}

		const act = pose.action || null;
		if ( act !== this._lastAct ) {

			this._lastAct = act;
			this._doneAct = null;
			this._ovDone = null;

		}

		// the base action: a one-shot plays as a full-body montage, a loop is the graph's action state
		const bact = ROD[ act ] ? null : act;
		this._actionMontage( bact );
		let loopClip = null;
		// (the graph's own seated / helm states play those: no duplicate action state; at the wheel a bind-pose loop such as the
		// roster's Seated_Idle on an idle skiff is dropped too, so the helm state's standing base shows instead of the A)
		if ( bact && LOOPS[ bact ] && m.clips.has( CLIPS[ LOOPS[ bact ] ] ) && ! ( bact === 'seated' && pose.mode === 'seat' ) && ! ( pose.mode === 'boat' && ( HELM_ACT[ bact ] || this._isBind( CLIPS[ LOOPS[ bact ] ] ) ) ) ) loopClip = CLIPS[ LOOPS[ bact ] ];
		this._procFrame( dt, pose, pose.mode === 'boat' && ! loopClip );
		// rod actions ride on the upper body over the locomotion (never swimming, at the helm or under a full-body montage)
		const rodAct = act && ROD[ act ] && pose.mode !== 'swim' && pose.mode !== 'boat' && ! g.fullBusy && m.clips.has( CLIPS[ ROD[ act ] ] ) ? act : null;
		g.update( dt, this._context( dt, pose, loopClip, rodAct ) );
		// an upper-body montage (block, parry ...) owns the overlay while it plays; the rod comes back after it
		if ( g.upperBusy ) {

			this._ovKey = null;
			this._ovLayer = null;

		} else this._rodOverlay( m, rodAct, dt );
		if ( this.ik && 'footLock' in this.ik ) this.ik.footLock = g.footLock; // a foot-lock hook for ContactIK (stance weights)
		if ( ANIM_DEBUG && Avatar._debugOwner === this && ( this._dbgT -= dt ) <= 0 ) {

			this._dbgT = 1;
			console.log( g.debugLine() );

		}

		m.update( dt );

	}

	// a clip of this model that is its bind pose (cached)
	_isBind( name ) {

		let b = this._bindClips.get( name );
		if ( b === undefined ) {

			b = bindLike( this.model.clips.get( name ), this.model );
			this._bindClips.set( name, b );

		}

		return b;

	}

	// the procedural pass's inputs this frame: at the wheel (the lean with the steering, the sway against the hull, the arms
	// where no IK hand holds the rim), in the water (treading when still, the crawl's kick when moving)
	_procFrame( dt, pose, atHelm ) {

		const pp = this._proc;
		if ( ! pp ) return;
		const d = Math.min( Math.max( dt, 0 ), 0.05 ), k = 1 - Math.exp( - d * 6 );
		// the helm
		this._helmW = atHelm ? Math.min( 1, this._helmW + d / 0.3 ) : Math.max( 0, this._helmW - d / 0.2 );
		const req = this._ikReq;
		const st = Number.isFinite( pose.steer ) ? pose.steer : req && Number.isFinite( req.steer ) ? req.steer : 0;
		this._steerS += ( Math.max( - 1, Math.min( 1, st ) ) - this._steerS ) * k;
		// the world's up in the model frame: the body keeps part of the way back to it, on a soft spring (a little sway)
		const sw = this._sway;
		if ( this._helmW > 0 ) {

			_v.set( 0, 1, 0 ).applyQuaternion( _q.copy( this.group.quaternion ).invert() );
			const tx = SWAY.gain * Math.atan2( _v.x, _v.y ), tz = SWAY.gain * Math.atan2( _v.z, _v.y ), o = SWAY.omega;
			sw.vx += ( o * o * ( tx - sw.x ) - 2 * SWAY.zeta * o * sw.vx ) * d;
			sw.vz += ( o * o * ( tz - sw.z ) - 2 * SWAY.zeta * o * sw.vz ) * d;
			sw.x = Math.max( - SWAY.max, Math.min( SWAY.max, sw.x + sw.vx * d ) );
			sw.z = Math.max( - SWAY.max, Math.min( SWAY.max, sw.z + sw.vz * d ) );

		} else { sw.x = sw.z = sw.vx = sw.vz = 0; }

		const h = pp.helm, ik = this.ik;
		h.weight = smooth( this._helmW );
		h.steer = this._steerS;
		h.upX = sw.x; h.upZ = sw.z;
		// rigs without the IK (or a hand the IK does not hold): the plain upper-body pose, hands forward at wheel height
		h.armL = ik && this.ikEnabled ? 1 - ik.hands[ 0 ].w : 1;
		h.armR = ik && this.ikEnabled ? 1 - ik.hands[ 1 ].w : 1;
		// the water
		const swim = pose.mode === 'swim' && pose.action !== 'climbUp'; // (the pull-up montage owns the arms and legs)
		const crawl = swim ? smooth( ( ( pose.speed || 0 ) - 0.15 ) / 0.6 ) : 0;
		const kw = 1 - Math.exp( - d * ( swim ? 5 : 12 ) ); // (out of the water quickly: the legs walk again)
		this._crawl += ( crawl - this._crawl ) * kw;
		this._tread += ( ( swim ? 1 - crawl : 0 ) - this._tread ) * kw;
		if ( ! swim && this._tread < 0.01 && this._crawl < 0.01 ) this._tread = this._crawl = 0;
		pp.swim.tread = this._tread;
		pp.swim.crawl = this._crawl;
		pp.swim.time += d;

	}

	// the pose action's one-shot as a montage: started once per action, blended out when the action moves on
	_actionMontage( bact ) {

		const cur = this._actM;
		if ( cur && cur.name !== bact ) {

			this._actM = null;
			cur.stop();

		}

		if ( ! bact || ! ONE_SHOT[ bact ] || bact === this._doneAct || this._actM ) return;
		const h = this.graph.play( bact, { fromAction: true } );
		if ( ! h.playing ) {

			this._doneAct = bact;
			return;

		}

		this._actM = h;
		h.onEvent = ( e ) => {

			// handed back to the state machine: not again until the action changes
			if ( ( e === 'blendOut' || e === 'end' ) && this._actM === h ) {

				this._actM = null;
				this._doneAct = bact;

			}

		};

	}

	// the graph's inputs from the pose (and the setLocomotion overrides)
	_context( dt, pose, loopClip, rodAct ) {

		const c = this._ctx || ( this._ctx = {} );
		const o = this._loco;
		if ( o ) o.age += dt;
		const fresh = o && o.age <= 0.3;
		const speed = fresh && Number.isFinite( o.speed ) ? o.speed : pose.speed || 0;
		const yaw = pose.yaw || 0;
		let fwd = speed, str = 0;
		if ( fresh && ( Number.isFinite( o.strafe ) || Number.isFinite( o.forward ) ) ) {

			str = o.strafe || 0;
			fwd = Number.isFinite( o.forward ) ? o.forward : Math.sqrt( Math.max( 0, speed * speed - str * str ) );

		} else if ( Number.isFinite( pose.strafe ) || Number.isFinite( pose.forward ) ) {

			str = pose.strafe || 0;
			fwd = Number.isFinite( pose.forward ) ? pose.forward : Math.sqrt( Math.max( 0, speed * speed - str * str ) );

		} else if ( pose.mode === 'walk' && dt > 0 ) {

			// the way the body moves against the facing (Player.yaw: forward = ( -sin, -cos ), right = ( cos, -sin ))
			const k = 1 - Math.exp( - dt * 12 ), sv = this._sv;
			sv.x += ( this._vel.x - sv.x ) * k;
			sv.z += ( this._vel.z - sv.z ) * k;
			const v = Math.hypot( sv.x, sv.z );
			if ( v > Math.max( 0.2, speed * 0.3 ) ) {

				const f = - Math.sin( yaw ) * sv.x - Math.cos( yaw ) * sv.z, r = Math.cos( yaw ) * sv.x - Math.sin( yaw ) * sv.z;
				fwd = f / v * speed;
				str = r / v * speed;

			}

		}

		// turn rate (+ = left) from the yaw, for the lean
		if ( dt > 0 && this._prevYaw !== null && ( pose.mode === 'walk' || pose.mode === 'deck' ) ) {

			let d = yaw - this._prevYaw;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			const rate = Math.abs( d / dt ) > 12 ? 0 : d / dt; // a snap (camera reset, teleport) is not a turn
			this._turn += ( rate - this._turn ) * ( 1 - Math.exp( - dt * 8 ) );

		} else if ( dt > 0 ) this._turn = 0;
		this._prevYaw = yaw;
		const grounded = fresh && typeof o.grounded === 'boolean' ? o.grounded : pose.grounded !== false;
		if ( ! grounded ) this._air += dt;
		else if ( this._air > 0 ) {

			this._lastAir = this._air;
			this._air = 0;

		}

		c.mode = pose.mode || 'walk';
		c.speed = speed;
		c.forward = fwd;
		c.strafe = str;
		c.turn = fresh && Number.isFinite( o.turn ) ? o.turn : this._turn;
		c.grounded = grounded;
		c.vy = pose.vy || 0;
		c.airTime = this._air;
		c.lastAir = this._lastAir;
		c.diving = !! pose.diving;
		c.rod = !! rodAct;
		c.seat = pose.seat || null;
		c.loopClip = loopClip;
		c.action = pose.action || null;
		c.crouch = !! pose.crouch; c.tired = !! pose.tired; c.carry = !! pose.carry; // wave 18E blend spaces
		return c;

	}

	// ---- animation graph API (combat, emotes; see the header)

	setLocomotion( o ) {

		this._loco = o ? { ...o, age: 0 } : null;

	}

	playMontage( name, opts = {} ) {

		if ( ! this.graph || this._rd ) return { name, slot: null, playing: false, time: 0, weight: 0, rootMotion: false, stop() {}, onEvent: null };
		return this.graph.play( name, opts );

	}

	stopMontage( slot = null, blendOut = 0.2 ) {

		if ( this.graph ) this.graph.stopMontages( slot, blendOut );

	}

	// the graph's state label (idle / walk / jog / run / sprint / jump / fall / land / swim / deck / seated / helm / ride / plane /
	// action / fishing), 'ragdoll' / 'getup' while knocked down
	get state() {

		if ( this._rd ) return this._rd.phase === 'fall' ? 'ragdoll' : 'getup';
		return this.graph ? this.graph.state : 'idle';

	}

	// the rod overlay: the clip of the rod action over the upper body, or faded out when there is none
	_rodOverlay( m, rodAct, dt ) {

		let key = rodAct;
		if ( key && ROD_ONE_SHOT[ key ] && key !== 'charge' && this._ovDone === key ) key = 'hold';
		if ( ! key ) {

			if ( this._ovKey ) m.setOverlay( null, { fade: 0.2 } );
			this._ovKey = null;
			this._ovLayer = null;
			return;

		}

		if ( key !== this._ovKey ) {

			// no pop between rod poses: the switch also gets a short inertial blend (very short into the cast: the whip is timed)
			if ( this._ovKey && this.graph ) this.graph.inertialize( key === 'cast' ? 0.06 : 0.15 );
			// the cast starts from wherever the charge got to (a tap does not snap the rod back first)
			const from = key === 'cast' ? ( this._ovKey === 'charge' && this._ovLayer ? castStartFrom( this._ovLayer.time ) : CAST_FROM_HOLD ) : 0;
			this._ovKey = key;
			this._ovLayer = m.setOverlay( CLIPS[ ROD[ key ] ], { mask: UPPER_BODY, fade: ROD_FADE[ key ], loop: ! ROD_ONE_SHOT[ key ], restart: true, from } );

		}

		// the reel and the fight turn at the real crank rate (the game sets actionRate)
		if ( ( key === 'reel' || key === 'fight' ) && this._ovLayer ) this._ovLayer.speed += ( ( this.actionRate || 1 ) - this._ovLayer.speed ) * Math.min( 1, dt * 8 );

	}

	// ---- contact IK (src/player/ik)

	setGroundProbe( probe ) {

		this._ikProbe = probe || null;
		if ( this.ik ) this.ik.probe = this._ikProbe;

	}

	setIKTargets( request ) {

		this._ikReq = request || null;
		if ( this.ik ) this.ik.setTargets( this._ikReq );

	}

	// per frame, before model.update: the anchor, the mode and how much the feet may plant
	_ikFrame( dt, pose ) {

		const ik = this.ik;
		if ( ! ik ) return;
		ik.enabled = this.ikEnabled;
		ik.dt = dt;
		ik.mode = pose.mode;
		ik.setAnchor( this.group.matrixWorld.elements );
		if ( this._ikReq ) ik.setTargets( this._ikReq ); // a reused request object may have moved since it was handed over
		ik.footWeight = footWeight( pose, pose.action );
		ik.pelvisDrop = pose.mode !== 'seat'; // seated: the seat carries the pelvis

	}

	handMatrix( out ) {

		if ( ! this.model || ! this.model.nodeMatrix( 'weapon_r', _m ) ) return null;
		return out.multiplyMatrices( this.group.matrixWorld, _m );

	}

	headPosition( out ) {

		if ( ! this.model || ! this.model.nodeWorld( 'head', _v ) ) return out.copy( this.group.position ).add( _v.set( 0, 1.5, 0 ) );
		return out.copy( _v ).applyMatrix4( this.group.matrixWorld );

	}

	// ---- eyes

	// Turn the eyes toward a world point (a Vector3, kept as a copy: update it by calling again) for `seconds`, then let them wander
	// again; null releases the gaze now. The eyes travel 8 deg sideways and 6 deg up / down, so a target outside that is looked at
	// as far as they go (the head does not turn). Characters without the eye morph targets ignore it.
	lookAt( point, { seconds = Infinity } = {} ) {

		if ( ! point ) {

			this._lookTarget = null;
			if ( this._eyes ) this._eyes.setLook( null );
			return;

		}

		this._lookTarget = ( this._lookTarget || new Vector3() ).set( point.x, point.y, point.z );
		this._lookLeft = seconds;

	}

	get looking() {

		return !! this._lookTarget;

	}

	// a blink now: { left, right }
	blink( o ) {

		if ( this._eyes ) this._eyes.blink( o );

	}

	_updateEyes( m, dt ) {

		const e = this._eyes;
		if ( ! e ) return;
		if ( this._lookTarget && ! this._rd ) {

			this._lookLeft -= dt;
			const g = this._lookLeft > 0 ? this._gazeToward( m ) : null;
			if ( g ) e.setLook( g.x, g.y );
			else {

				e.setLook( null );
				if ( this._lookLeft <= 0 ) this._lookTarget = null;

			}

		}

		e.update( dt );

	}

	// gaze (-1..1 of the eyes' travel; x + = the character's left) toward the look target, in the head's own frame; null when it is behind
	_gazeToward( m ) {

		const inv = this._inv.copy( this.group.matrixWorld ).invert();
		const t = _v.copy( this._lookTarget ).applyMatrix4( inv ); // model space
		const eye = _eyeA;
		if ( m.nodeWorld( 'eye_l', eye ) && m.nodeWorld( 'eye_r', _eyeB ) ) eye.add( _eyeB ).multiplyScalar( 0.5 );
		else if ( ! m.nodeWorld( 'head', eye ) ) return null;
		const d = t.sub( eye );
		if ( ! m.skinMatrix( 'head', _m ) ) return null;
		const e = _m.elements; // the head's rotation from its bind pose: bring the direction back into the face's frame (transpose)
		const x = e[ 0 ] * d.x + e[ 1 ] * d.y + e[ 2 ] * d.z, y = e[ 4 ] * d.x + e[ 5 ] * d.y + e[ 6 ] * d.z, z = e[ 8 ] * d.x + e[ 9 ] * d.y + e[ 10 ] * d.z;
		const yaw = Math.atan2( x, z ), pitch = Math.atan2( y, Math.hypot( x, z ) );
		if ( Math.abs( yaw ) > 1.75 ) return null;
		return { x: Math.max( - 1, Math.min( 1, yaw / GAZE_YAW ) ), y: Math.max( - 1, Math.min( 1, pitch / GAZE_PITCH ) ) };

	}

	// ---- ragdoll knockdown

	get ragdolling() {

		return !! this._rd;

	}

	// 'fall' while the body is simulated, 'recover' while it blends into the get-up, null otherwise
	get ragdollPhase() {

		return this._rd ? this._rd.phase : null;

	}

	// Knock the avatar down: the bones are handed to a verlet ragdoll (impulse: Vector3 world m/s given to the whole body, on top of the
	// momentum the avatar already had), which lies where it falls for `duration` s, then blends over 0.4 s into the get-up and ends
	// standing where the body lay (onRagdollEnd( feetPosition, playerYaw ) is called so the game can put the player there; without
	// it the avatar eases back to the player). While it runs the avatar ignores the pose position and yaw: freeze the player.
	//   ground: ( x, z ) -> world height (default: groundHeight, else the plane the avatar stands on)
	//   getUp: the clip that stands the body up (default: chosen when it gets up from the way the body lies: GetUp_Front face
	//          down, GetUp_Back otherwise, both played forwards; a model without them plays Knockdown reversed, a fall onto the back
	//          backwards). Pass a clip name (with reverse) to force one.
	//   rate: playback rate of that clip
	// Returns false when there is no model yet. Calling it again while down adds the impulse.
	ragdoll( impulse = null, { duration = 2.5, ground = null, getUp = null, reverse = false, rate = 1 } = {} ) {

		const m = this.model;
		if ( ! m ) return false;
		if ( this._rd ) {

			if ( impulse ) this._rd.sim.impulse( impulse );
			return true;

		}

		this.group.updateMatrixWorld( true );
		const y0 = this.group.position.y;
		const g = ground || this.groundHeight || ( () => y0 );
		const sim = new Ragdoll( m, this.group.matrixWorld, g, this._vel );
		if ( impulse ) sim.impulse( impulse );
		this._rd = {
			sim, phase: 'fall', t: 0, tr: 0, duration, alpha: 1, getUp, reverse, rate, align: null, layer: null, phi: 0,
			pos: this.group.position.clone(), quat: this.group.quaternion.clone(), yaw0: this._poseYaw + Math.PI + this._dyaw,
		};
		this._disp.set( 0, 0, 0 );
		this._dyaw = 0;
		this._action = null;
		this._ovKey = null;
		if ( this.graph ) this.graph.stopMontages( null, 0.01 );
		this._actM = null;
		m.setOverlay( null, { fade: 0.01 } );
		if ( this.ik ) this.ik.reset(); // the pose hook hands the bones to the ragdoll; the IK fades back in after the get-up

		return true;

	}

	_ragdollFrame( m, dt, pose ) {

		const rd = this._rd, sim = rd.sim;
		rd.t += dt;
		sim.step( dt );
		if ( rd.phase === 'fall' && rd.t >= rd.duration ) this._rdRecover( m );
		let done = false;
		if ( rd.phase === 'recover' ) {

			rd.tr += dt;
			rd.alpha = Math.max( 0, 1 - rd.tr / 0.4 );
			const l = rd.layer;
			if ( ! l ) done = rd.tr > 0.5;
			else if ( rd.reverse ) {

				l.time = Math.max( 0, l.time - dt * rd.rate );
				done = l.time <= 0 && rd.alpha === 0;

			} else done = l.ended && rd.alpha === 0;
			if ( rd.tr > 5 ) done = true;

		}

		m.update( dt );
		if ( done ) this._rdCommit( m, pose );

	}

	// the body has lain down long enough: start the get-up clip, turned to the way the body lies
	_rdRecover( m ) {

		const rd = this._rd, sim = rd.sim;
		rd.phase = 'recover';
		rd.tr = 0;
		if ( ! rd.getUp ) {

			// which way the body lies: its front (+Z of the hips / chest frame) pointing down is face down
			const bq = sim._frame( 'hipL', 'hipR', 'pelvis', 'chest', new Quaternion() );
			const faceDown = _w.set( 0, 0, 1 ).applyQuaternion( bq ).y < - 0.3;
			const want = faceDown ? CLIPS.getUpFront : CLIPS.getUp;
			// the Kimodo get-ups are 2.5 s takes: played at 1.4x they stand up in about 1.8 s (as the combat get-up montage)
			if ( m.clips.get( want ) ) { rd.getUp = want; rd.reverse = false; rd.rate *= 1.4; } else { rd.getUp = CLIPS.knockdown; rd.reverse = true; }

		}
		const clip = m.clips.get( rd.getUp );
		if ( ! clip ) return;
		rd.layer = m.play( rd.getUp, { fade: 0.01, loop: false, speed: rd.reverse ? 0 : rd.rate, from: rd.reverse ? Math.max( 0, clip.duration - 1e-3 ) : 0 } );
		// the clip's pelvis at its first (or, reversed, its last) frame: where it lies and which way
		const k = ( ch ) => rd.reverse ? ch.times.length - 1 : 0;
		const rc = clip.channels.find( ( c ) => c.node === sim.node.pelvis && c.path === 'rotation' );
		const tc = clip.channels.find( ( c ) => c.node === sim.node.pelvis && c.path === 'translation' );
		if ( ! rc || ! tc ) return;
		const cq = _q.fromArray( rc.values, k( rc ) * 4 ).clone();
		const p0 = new Vector3().fromArray( tc.values, k( tc ) * 3 );
		const yawOf = ( up, fwd ) => {

			// the heading of a body: where its head points when it lies, which way it faces when it does not
			const h = Math.hypot( up.x, up.z );
			return h > 0.35 ? Math.atan2( up.x, up.z ) : Math.atan2( fwd.x, fwd.z );

		};

		const a0 = yawOf( _v.set( 0, 1, 0 ).applyQuaternion( cq ), _w.set( 0, 0, 1 ).applyQuaternion( cq ) );
		sim.local( sim.index.chest, _v ); sim.local( sim.index.pelvis, _w );
		const up = _v.sub( _w );
		const fq = sim._frame( 'hipL', 'hipR', 'pelvis', 'chest', new Quaternion() );
		const a1 = yawOf( up, _w.set( 0, 0, 1 ).applyQuaternion( fq ) );
		rd.phi = a1 - a0;
		sim.local( sim.index.pelvis, _w );
		rd.align = { q: new Quaternion().setFromAxisAngle( _yAxis, rd.phi ), c: new Vector3( _w.x, 0, _w.z ), p0 };

	}

	// the get-up is over: the avatar stands where the body lay (the group takes over the turn and the offset the get-up applied)
	_rdCommit( m, pose ) {

		const rd = this._rd;
		m.nodeWorld( 'pelvis', _v ).applyMatrix4( this.group.matrixWorld ); // world, last pose (the turn and the offset included)
		const yaw = rd.yaw0 + rd.phi;
		// the idle pose has its pelvis 0.025 m behind the group origin
		_w.set( 0, 0, 0.025 ).applyAxisAngle( _yAxis, yaw );
		const x = _v.x + _w.x, z = _v.z + _w.z;
		this._rd = null;
		if ( this.ik ) this.ik.reset();
		const playerYaw = yaw - Math.PI;
		if ( this.onRagdollEnd ) {

			this._disp.set( 0, 0, 0 );
			this._dyaw = 0;
			this.onRagdollEnd( new Vector3( x, pose.position.y, z ), playerYaw );

		} else {

			this._disp.set( x - pose.position.x, 0, z - pose.position.z );
			let d = yaw - ( pose.yaw + Math.PI );
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			this._dyaw = d;

		}

	}

	dispose() {

		this.scene.remove( this.group );
		if ( this.graph ) this.graph.dispose();
		this.graph = null;
		if ( this.model ) this.model.dispose();
		this.model = null;

	}

}
