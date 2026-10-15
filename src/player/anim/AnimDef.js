// The animation graph definition (src/player/anim/AnimGraph.js): plain data, so Vite hot-reloads it into the running
// avatars (AnimGraph accepts this module and swaps the definition; derived clips are rebuilt when `clips` changed).
//
//   clips       clips built per character at load from the roster clips (ClipTools.js): { from, legYaw } strafe legs,
//               { from, stride, lean } a longer stride, { base, keys } a procedural pose clip
//   spaces      blend spaces: 'polar' (direction x speed, phase-synced on the left foot's forward point) and '1d' (speed)
//   states      the state machine's states: { space } | { clip, loop, from, to, rate } | { loopClip: true } (the pose action's loop)
//   rules       [ state, ( ctx, cur ) => bool ]: the first true one is the state wanted this frame (cur = { name, time, done })
//   blends      'from>to' | 'from>*' | '*>to' | 'default' -> [ seconds, 'crossfade' | 'inertial' ]
//   montages    one-shot actions: { clip, slot: 'full' | 'upper', from, to, rate, reverse, loop, hold, blendIn, blendOut,
//               rootMotion, notifies: [ [ clipTime, name ] ] }
//   footsteps   ground phase of the left / right foot contact (phase 0 = left foot furthest forward)
//
// ctx (built by the Avatar each frame): mode, speed, forward, strafe (m/s, + = right), turn (rad/s, + = left), grounded,
// vy, airTime (s off the ground), lastAir (the last airborne stretch), rod (a rod action on the overlay), seat ('ride' |
// 'plane' | null), loopClip (the clip of a looping full-body action, or null), diving; wave 18E (optional, false when the Avatar
// does not pass them): crouch (sneaking), tired (low stamina), carry (a crate in the arms).

const G = [ 1.25, 2.7 ]; // the walker's walk (Caps Lock) and jog speeds (Player.updateWalk); sprint 4.6
const crouchPose = ( drop, extra = {} ) => {

	// knees and hips bent so the pelvis sits `drop` lower with the feet in place (ClipTools.crouch, inlined so this stays data)
	const a = Math.acos( 1 - drop / 0.6 ) * 180 / Math.PI;
	return { pelvis: [ 0, - drop, 0 ], thigh_l: [ [ 'x', - a ] ], calf_l: [ [ 'x', 2 * a ] ], foot_l: [ [ 'x', - a ] ], thigh_r: [ [ 'x', - a ] ], calf_r: [ [ 'x', 2 * a ] ], foot_r: [ [ 'x', - a ] ], ...extra };

};

// the guard: fists up under the chin (the roster's big heads leave no room in front of the face), elbows down and in.
// reach: { l | r: [ wrist x, y, z, elbow pole x, y, z ] } in model space (+X left, +Y up, +Z forward), solved by ClipTools.twoBone
const GUARD = {
	spine_01: [ [ 'x', 6 ] ], spine_02: [ [ 'x', 4 ] ], head: [ [ 'x', 6 ] ], hand_l: [ [ 'x', - 25 ] ], hand_r: [ [ 'x', - 25 ] ],
	reach: { l: [ 0.09, 1.11, 0.27, 0.5, - 1, - 0.2 ], r: [ - 0.09, 1.09, 0.27, - 0.5, - 1, - 0.2 ] },
};
// wave 17B: under the canopy (hands up on the risers, wide of the big head, legs hanging together with a slow swing), rowing
// and paddling on the seated take (the roster's Row_* / Paddle_* loops start and end on the bind pose), the pull-up out of the water
const HANG = ( s ) => ( { thigh_l: [ [ 'x', - 14 - s ] ], thigh_r: [ [ 'x', - 14 + s ] ], calf_l: [ [ 'x', 16 + s ] ], calf_r: [ [ 'x', 16 - s ] ], spine_01: [ [ 'x', - 4 ] ], head: [ [ 'x', - 8 ] ],
	reach: { l: [ 0.44, 1.3, 0.02, 1, - 0.4, - 0.3 ], r: [ - 0.44, 1.3, 0.02, - 1, - 0.4, - 0.3 ] } } );
const CATCH = { spine_01: [ [ 'x', 18 ] ], head: [ [ 'x', - 12 ] ], reach: { l: [ 0.22, 0.6, 0.42, 1, - 0.3, 0 ], r: [ - 0.22, 0.6, 0.42, - 1, - 0.3, 0 ] } };
const FINISH = { spine_01: [ [ 'x', - 12 ] ], head: [ [ 'x', 8 ] ], reach: { l: [ 0.22, 0.66, 0.1, 1, - 0.2, - 1 ], r: [ - 0.22, 0.66, 0.1, - 1, - 0.2, - 1 ] } };
// side 1: the paddle on the left (+X); phase 0 the catch ahead, 1 the blade out by the hip
const PAD = ( side, phase ) => ( { spine_02: [ [ 'y', side * ( 22 - 34 * phase ) ] ], spine_01: [ [ 'x', 10 - 6 * phase ] ], reach: {
	[ side > 0 ? 'r' : 'l' ]: [ - side * 0.05, 0.72, 0.34 - 0.12 * phase, - side, - 0.5, 0 ], [ side > 0 ? 'l' : 'r' ]: [ side * 0.32, 0.42, 0.4 - 0.38 * phase, side, - 0.3, - 0.3 ] } } );
const mix = ( a, b ) => {

	const o = { ...a };
	for ( const k in b ) o[ k ] = k === 'pelvis' ? b[ k ] : k === 'reach' ? { ...a.reach, ...b.reach } : [ ...( a[ k ] || [] ), ...b[ k ] ];
	return o;

};

// wave 18E emotes (the Digit5 row): pose clips on the idle like the combat ones (the roster has no bow / salute / flex takes)
const BOW = { spine_01: [ [ 'x', 32 ] ], spine_02: [ [ 'x', 14 ] ], head: [ [ 'x', 12 ] ], upperarm_l: [ [ 'x', - 12 ] ], reach: { r: [ - 0.02, 0.84, 0.2, - 1, - 0.6, 0 ] } };
const SALUTE = { spine_01: [ [ 'x', - 4 ] ], head: [ [ 'x', - 4 ] ], reach: { r: [ - 0.11, 1.3, 0.14, - 1, 0.1, 0.2 ] } };
const FIST = ( s ) => {

	const o = {}, k = s === 'r' ? 1 : - 1;
	for ( const f of [ 'index', 'middle', 'ring' ] ) { o[ f + '_01_' + s ] = [ [ 'y', 70 * k ] ]; o[ f + '_02_' + s ] = [ [ 'y', 80 * k ] ]; o[ f + '_03_' + s ] = [ [ 'y', 50 * k ] ]; }
	return o;

};
const FLEX = ( k ) => ( { spine_01: [ [ 'x', - 4 ], [ 'y', k * 8 ] ], spine_02: [ [ 'x', - 4 ] ], head: [ [ 'x', - 6 ], [ 'y', - k * 10 ] ], pelvis: [ 0, - 0.02, 0 ], ...FIST( 'l' ), ...FIST( 'r' ),
	reach: { l: [ 0.36, 1.16, 0.0, 1, - 0.6, - 0.2 ], r: [ - 0.36, 1.16, 0.0, - 1, - 0.6, - 0.2 ] } } );
const PALM = ( s ) => ( { spine_01: [ [ 'x', 10 ] ], spine_02: [ [ 'x', 6 ] ], head: [ [ 'x', 16 ], [ 'y', s ] ], reach: { r: [ - 0.02, 1.2, 0.2, - 1, - 0.7, 0 ] } } );
// standing with a crate (the arms of tools/roster/pose-clips.mjs Carry_Box, which loops with the walk)
const CARRY = { spine_01: [ [ 'x', - 6 ] ], spine_02: [ [ 'x', - 3 ] ], head: [ [ 'x', - 4 ] ],
	reach: { l: [ 0.19, 0.9, 0.2, 1, - 0.8, - 0.1 ], r: [ - 0.19, 0.9, 0.2, - 1, - 0.8, - 0.1 ] } };
const THUMB = { spine_01: [ [ 'x', - 3 ] ], head: [ [ 'y', - 6 ] ], ...FIST( 'r' ), reach: { r: [ - 0.14, 1.02, 0.3, - 1, - 0.8, 0 ] } };

// wave 19D: the Kimodo combat takes (tools/roster/kimodo-combat, in all eight roster GLBs). A blow plays its take from `from` (the
// wind-up) at the rate that puts the take's contact frame `c` (clip time, measured: tools/roster/kimodo-combat/contact.mjs) `at`
// seconds after the press, the weapon's MELEE[ id ].contact (or THROW_RELEASE), and `after` seconds more past it; the notify
// marks it. src/features/weapons/WeaponPose.js slices the same stretch into the weapon's attack clip (Wpn_Slash ...), so
// PlayerCombat's hit timing holds with either.
const BLOW = ( clip, from, c, at, after, notify = 'contact', o = {} ) => {

	const rate = ( c - from ) / at;
	return { clip, slot: 'upper', from, to: c + after * rate, rate, blendIn: 0.06, blendOut: 0.18, notifies: [ [ c, notify ] ], ...o };

};

export default {

	version: 1,

	clips: {
		// longer strides at the same cadence for the jog and the sprint (the run take is a short-stride 1.95 m/s run)
		Run_Long: { from: 'Run_InPlace', stride: 1.2 },
		Run_Sprint: { from: 'Run_InPlace', stride: 1.38, lean: 9 },
		// strafe legs: L40 = the legs turned 40 deg to the character's left, the chest still forward
		Walk_L40: { from: 'Walk_InPlace', legYaw: 40 }, Walk_R40: { from: 'Walk_InPlace', legYaw: - 40 },
		Walk_L75: { from: 'Walk_InPlace', legYaw: 75 }, Walk_R75: { from: 'Walk_InPlace', legYaw: - 75 },
		Run_L40: { from: 'Run_Long', legYaw: 40 }, Run_R40: { from: 'Run_Long', legYaw: - 40 },
		Run_L75: { from: 'Run_Long', legYaw: 75 }, Run_R75: { from: 'Run_Long', legYaw: - 75 },
		// combat (procedural; the roster has no dodge / guard takes): deltas in model axes on the idle pose, see ClipTools.poseClip
		Dodge_Left: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.1, ease: 'out', pose: crouchPose( 0.11, { pelvis: [ 0.13, - 0.11, 0 ], spine_01: [ [ 'z', - 20 ] ], head: [ [ 'z', 8 ] ], upperarm_l: [ [ 'z', 32 ] ], upperarm_r: [ [ 'x', - 30 ], [ 'z', - 10 ] ], lowerarm_r: [ [ 'x', - 40 ] ] } ) },
			{ t: 0.28, pose: crouchPose( 0.09, { pelvis: [ 0.08, - 0.09, 0 ], spine_01: [ [ 'z', - 10 ] ], head: [ [ 'z', 6 ] ], upperarm_l: [ [ 'z', 24 ] ], upperarm_r: [ [ 'x', - 25 ] ], lowerarm_r: [ [ 'x', - 35 ] ] } ) },
			{ t: 0.5, pose: {} },
		] },
		Dodge_Right: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.1, ease: 'out', pose: crouchPose( 0.11, { pelvis: [ - 0.13, - 0.11, 0 ], spine_01: [ [ 'z', 20 ] ], head: [ [ 'z', - 8 ] ], upperarm_r: [ [ 'z', - 32 ] ], upperarm_l: [ [ 'x', - 30 ], [ 'z', 10 ] ], lowerarm_l: [ [ 'x', - 40 ] ] } ) },
			{ t: 0.28, pose: crouchPose( 0.09, { pelvis: [ - 0.08, - 0.09, 0 ], spine_01: [ [ 'z', 10 ] ], head: [ [ 'z', - 6 ] ], upperarm_r: [ [ 'z', - 24 ] ], upperarm_l: [ [ 'x', - 25 ] ], lowerarm_l: [ [ 'x', - 35 ] ] } ) },
			{ t: 0.5, pose: {} },
		] },
		Dodge_Back: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.1, ease: 'out', pose: crouchPose( 0.13, { pelvis: [ 0, - 0.13, - 0.06 ], spine_01: [ [ 'x', 16 ] ], spine_02: [ [ 'x', 6 ] ], head: [ [ 'x', - 10 ] ], upperarm_l: [ [ 'x', - 40 ], [ 'z', 12 ] ], upperarm_r: [ [ 'x', - 40 ], [ 'z', - 12 ] ], lowerarm_l: [ [ 'x', - 45 ] ], lowerarm_r: [ [ 'x', - 45 ] ] } ) },
			{ t: 0.28, pose: crouchPose( 0.1, { pelvis: [ 0, - 0.1, - 0.04 ], spine_01: [ [ 'x', 12 ] ], head: [ [ 'x', - 8 ] ], upperarm_l: [ [ 'x', - 32 ] ], upperarm_r: [ [ 'x', - 32 ] ], lowerarm_l: [ [ 'x', - 40 ] ], lowerarm_r: [ [ 'x', - 40 ] ] } ) },
			{ t: 0.5, pose: {} },
		] },
		Dodge_Forward: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.1, ease: 'out', pose: crouchPose( 0.15, { pelvis: [ 0, - 0.15, 0.06 ], spine_01: [ [ 'x', 24 ] ], spine_02: [ [ 'x', 8 ] ], head: [ [ 'x', - 16 ] ], upperarm_l: [ [ 'x', 25 ] ], upperarm_r: [ [ 'x', 25 ] ] } ) },
			{ t: 0.28, pose: crouchPose( 0.1, { spine_01: [ [ 'x', 16 ] ], head: [ [ 'x', - 10 ] ], upperarm_l: [ [ 'x', 15 ] ], upperarm_r: [ [ 'x', 15 ] ] } ) },
			{ t: 0.5, pose: {} },
		] },
		Block_Guard: { base: 'Idle_Breathe', loopBase: true, keys: [ { t: 0, pose: GUARD }, { t: 1.97, pose: GUARD } ] },
		Block_Impact: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: GUARD },
			{ t: 0.07, ease: 'out', pose: mix( GUARD, { spine_01: [ [ 'x', - 12 ] ], spine_02: [ [ 'x', - 6 ] ], head: [ [ 'x', - 8 ] ], reach: { l: [ 0.09, 1.02, 0.16, 1, - 1, - 0.5 ], r: [ - 0.09, 1.0, 0.16, - 1, - 1, - 0.5 ] } } ) },
			{ t: 0.38, pose: GUARD },
		] },
		Parry: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: GUARD },
			{ t: 0.1, ease: 'out', pose: mix( GUARD, { spine_02: [ [ 'y', 16 ] ], reach: { r: [ - 0.26, 1.1, 0.34, - 1, - 0.6, 0 ], l: [ 0.1, 0.98, 0.2, 1, - 1, - 0.3 ] } } ) },
			{ t: 0.2, pose: mix( GUARD, { spine_02: [ [ 'y', 12 ] ], reach: { r: [ - 0.24, 1.08, 0.32, - 1, - 0.6, 0 ] } } ) },
			{ t: 0.45, pose: GUARD },
		] },
		Hit_Back: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.09, ease: 'out', pose: { pelvis: [ 0, - 0.03, 0.05 ], spine_01: [ [ 'x', 14 ] ], spine_02: [ [ 'x', 10 ] ], head: [ [ 'x', - 18 ] ], upperarm_l: [ [ 'x', 18 ], [ 'z', 10 ] ], upperarm_r: [ [ 'x', 18 ], [ 'z', - 10 ] ] } },
			{ t: 0.55, pose: {} },
		] },
		Hit_Left: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.09, ease: 'out', pose: { pelvis: [ - 0.05, - 0.02, 0 ], spine_01: [ [ 'y', 12 ], [ 'z', 8 ] ], spine_02: [ [ 'y', 8 ], [ 'z', 6 ] ], head: [ [ 'z', 12 ], [ 'y', - 10 ] ], upperarm_l: [ [ 'z', 20 ] ], upperarm_r: [ [ 'z', - 12 ] ] } },
			{ t: 0.55, pose: {} },
		] },
		// in the air: the Kimodo jump's airborne frame (1.05 s: arms up and out, knees bent, feet off) with an alternating flail;
		// the roster's Fall_Loop holds an arms-out bind-like pose and the Kimodo fall take lies on its back
		Fall_Air: { base: 'Jump', baseTime: 1.05, keys: [
			{ t: 0, pose: {} },
			{ t: 0.35, pose: { upperarm_l: [ [ 'z', 14 ] ], upperarm_r: [ [ 'z', - 8 ] ], lowerarm_l: [ [ 'x', - 10 ] ], thigh_l: [ [ 'x', - 12 ] ], calf_l: [ [ 'x', 16 ] ], spine_01: [ [ 'x', - 4 ] ], head: [ [ 'x', - 5 ] ] } },
			{ t: 0.7, pose: { upperarm_l: [ [ 'z', - 8 ] ], upperarm_r: [ [ 'z', 14 ] ], lowerarm_r: [ [ 'x', - 10 ] ], thigh_r: [ [ 'x', - 12 ] ], calf_r: [ [ 'x', 16 ] ], spine_01: [ [ 'x', 3 ] ], head: [ [ 'x', 3 ] ] } },
			{ t: 1.05, pose: {} },
		] },
		Hit_Right: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: {} },
			{ t: 0.09, ease: 'out', pose: { pelvis: [ 0.05, - 0.02, 0 ], spine_01: [ [ 'y', - 12 ], [ 'z', - 8 ] ], spine_02: [ [ 'y', - 8 ], [ 'z', - 6 ] ], head: [ [ 'z', - 12 ], [ 'y', 10 ] ], upperarm_r: [ [ 'z', - 20 ] ], upperarm_l: [ [ 'z', 12 ] ] } },
			{ t: 0.55, pose: {} },
		] },
		Chute_Hang: { base: 'Idle_Breathe', loopBase: true, keys: [ { t: 0, pose: HANG( 0 ) }, { t: 1.2, pose: HANG( 6 ) }, { t: 2.4, pose: HANG( - 6 ) }, { t: 3.6, pose: HANG( 0 ) } ] },
		Row_Stroke: { base: 'Seated_Idle', keys: [ { t: 0, pose: CATCH }, { t: 0.8, pose: FINISH }, { t: 2, pose: CATCH } ] },
		Row_Stroke_Back: { base: 'Seated_Idle', keys: [ { t: 0, pose: FINISH }, { t: 0.8, pose: CATCH }, { t: 2, pose: FINISH } ] },
		Paddle_Stroke_L: { base: 'Seated_Idle', keys: [ { t: 0, pose: PAD( 1, 0 ) }, { t: 0.7, pose: PAD( 1, 1 ) }, { t: 1.4, pose: PAD( 1, 0 ) } ] },
		Paddle_Stroke_R: { base: 'Seated_Idle', keys: [ { t: 0, pose: PAD( - 1, 0 ) }, { t: 0.7, pose: PAD( - 1, 1 ) }, { t: 1.4, pose: PAD( - 1, 0 ) } ] },
		Carry_Idle: { base: 'Idle_Breathe', loopBase: true, keys: [ { t: 0, pose: CARRY }, { t: 1.97, pose: CARRY } ] },
		Emote_Bow: { base: 'Idle_Breathe', keys: [ { t: 0, pose: {} }, { t: 0.55, pose: BOW }, { t: 1.2, pose: BOW }, { t: 1.8, pose: {} } ] },
		Emote_Salute: { base: 'Idle_Breathe', keys: [ { t: 0, pose: {} }, { t: 0.35, ease: 'out', pose: SALUTE }, { t: 1.5, pose: SALUTE }, { t: 2.0, pose: {} } ] },
		Emote_Flex: { base: 'Idle_Breathe', keys: [ { t: 0, pose: {} }, { t: 0.4, ease: 'out', pose: FLEX( 0 ) }, { t: 0.9, pose: FLEX( 1 ) }, { t: 1.4, pose: FLEX( - 1 ) }, { t: 1.8, pose: FLEX( 0 ) }, { t: 2.3, pose: {} } ] },
		Emote_Facepalm: { base: 'Idle_Breathe', keys: [ { t: 0, pose: {} }, { t: 0.35, ease: 'out', pose: PALM( 0 ) }, { t: 0.8, pose: PALM( 8 ) }, { t: 1.2, pose: PALM( - 8 ) }, { t: 1.6, pose: PALM( 0 ) }, { t: 2.1, pose: {} } ] },
		Emote_ThumbsUp: { base: 'Idle_Breathe', keys: [ { t: 0, pose: {} }, { t: 0.35, ease: 'out', pose: THUMB }, { t: 1.4, pose: THUMB }, { t: 1.9, pose: {} } ] },
		Climb_Pull: { base: 'Idle_Breathe', keys: [
			{ t: 0, pose: { spine_01: [ [ 'x', 10 ] ], reach: { l: [ 0.28, 1.5, 0.32, 1, - 0.3, - 0.5 ], r: [ - 0.28, 1.5, 0.32, - 1, - 0.3, - 0.5 ] } } },
			{ t: 0.35, ease: 'out', pose: { spine_01: [ [ 'x', 26 ] ], head: [ [ 'x', - 14 ] ], thigh_r: [ [ 'x', - 75 ] ], calf_r: [ [ 'x', 105 ] ], reach: { l: [ 0.26, 0.92, 0.3, 1, 0.3, - 1 ], r: [ - 0.26, 0.92, 0.3, - 1, 0.3, - 1 ] } } },
			{ t: 0.8, pose: {} },
		] },
	},

	spaces: {
		// columns by direction (deg, + = right of the facing); each column a speed axis; idle is shared at speed 0. Backward
		// columns play their clip in reverse (legs turned the other way, so the back diagonals step the right way)
		ground: {
			kind: 'polar', idle: 'Idle_Breathe', maxRate: 1.9, sync: true,
			columns: [
				{ dir: 0, samples: [ [ 'Walk_InPlace', G[ 0 ] ], [ 'Run_Long', G[ 1 ] ], [ 'Run_Sprint', 4.6 ] ] },
				{ dir: 45, samples: [ [ 'Walk_R40', G[ 0 ] ], [ 'Run_R40', G[ 1 ] ] ] },
				{ dir: 90, samples: [ [ 'Walk_R75', G[ 0 ] ], [ 'Run_R75', G[ 1 ] ] ] },
				{ dir: 135, reverse: true, samples: [ [ 'Walk_L40', G[ 0 ] ], [ 'Run_L40', G[ 1 ] ] ] },
				{ dir: 180, reverse: true, samples: [ [ 'Walk_InPlace', G[ 0 ] ], [ 'Run_Long', G[ 1 ] ] ] },
				{ dir: - 135, reverse: true, samples: [ [ 'Walk_R40', G[ 0 ] ], [ 'Run_R40', G[ 1 ] ] ] },
				{ dir: - 90, samples: [ [ 'Walk_L75', G[ 0 ] ], [ 'Run_L75', G[ 1 ] ] ] },
				{ dir: - 45, samples: [ [ 'Walk_L40', G[ 0 ] ], [ 'Run_L40', G[ 1 ] ] ] },
			],
			// the state label by speed (m/s)
			labels: [ [ 0.25, 'idle' ], [ 1.9, 'walk' ], [ 3.4, 'jog' ], [ 4.2, 'run' ], [ Infinity, 'sprint' ] ],
		},
		swim: { kind: '1d', samples: [ [ 'Swim_Idle', 0 ], [ 'Swim_Forward', 1.0 ], [ 'Swim_Fast', 1.8 ] ], minRate: 0.5, maxRate: 2 },
		// wave 18E: sneaking (Rocketbox crouch idle, the walk crouched), the low-stamina walk (Rocketbox bruised walk), carrying a crate
		crouch: { kind: '1d', samples: [ [ 'Crouch', 0 ], [ 'Crouch_Walk', 0.67 ] ], minRate: 0.5, maxRate: 1.8 },
		tired: { kind: '1d', samples: [ [ 'Idle_Breathe', 0 ], [ 'Walk_Tired', 0.5 ] ], minRate: 0.5, maxRate: 2.2 },
		carry: { kind: '1d', samples: [ [ 'Carry_Idle', 0 ], [ 'Carry_Box', 1.1 ] ], minRate: 0.5, maxRate: 2 },
	},

	states: {
		locomotion: { space: 'ground', lean: true },
		fishing: { space: 'ground', lean: true, label: 'fishing' },
		deck: { space: 'ground', lean: true },
		jump: { clip: 'Jump', from: 0.82, to: 1.25, rate: 1.0, loop: false }, // the Kimodo take: crouch 0.55-0.8, push-off 0.85, apex 1.1, down 1.4
		fall: { clip: 'Fall_Air', loop: true },
		land: { clip: 'Land_Soft', from: 0.08, to: 0.8, rate: 1.5, loop: false },
		swim: { space: 'swim' },
		helm: { clip: 'Helm_Idle', loop: true },
		seated: { clip: 'Seated_Idle', loop: true },
		ride: { clip: 'Seated_Idle', loop: true },
		plane: { clip: 'Seated_Idle', loop: true },
		chute: { clip: 'Chute_Hang', loop: true },
		rowStroke: { clip: 'Row_Stroke', loop: true }, rowBack: { clip: 'Row_Stroke_Back', loop: true },
		paddleL: { clip: 'Paddle_Stroke_L', loop: true }, paddleR: { clip: 'Paddle_Stroke_R', loop: true },
		action: { loopClip: true },
		crouch: { space: 'crouch', label: 'crouch' },
		tired: { space: 'tired', label: 'tired' },
		carry: { space: 'carry', label: 'carry' },
		// standing and turning on the spot (the Rocketbox turns with the heading taken out: the feet step, the game turns the body)
		turnL: { clip: 'Turn_Left', loop: true, rate: 1.4, label: 'turn' },
		turnR: { clip: 'Turn_Right', loop: true, rate: 1.4, label: 'turn' },
	},

	rules: [
		[ 'swim', ( c ) => c.mode === 'swim' ],
		// the oars / the paddle (Game.helmAction loops): pose clips instead of the roster's bind-ended takes
		[ 'rowStroke', ( c ) => c.loopClip === 'Row_Forward' ], [ 'rowBack', ( c ) => c.loopClip === 'Row_Backward' ],
		[ 'paddleL', ( c ) => c.loopClip === 'Paddle_Left' ], [ 'paddleR', ( c ) => c.loopClip === 'Paddle_Right' ],
		[ 'action', ( c ) => !! c.loopClip ],
		[ 'helm', ( c ) => c.mode === 'boat' ],
		[ 'chute', ( c ) => c.mode === 'seat' && c.seat === 'chute' ],
		[ 'plane', ( c ) => c.mode === 'seat' && c.seat === 'plane' ],
		[ 'ride', ( c ) => c.mode === 'seat' && c.seat === 'ride' ],
		[ 'seated', ( c ) => c.mode === 'seat' ],
		// air: the jump on the way up, the fall after a while in the air, a landing crouch after a real drop when slow
		[ 'jump', ( c, s ) => ! c.grounded && ( s.name === 'jump' ? c.vy > - 1.5 || s.time < 0.3 : s.name !== 'fall' && c.vy > 1.0 ) ],
		[ 'fall', ( c ) => ! c.grounded && c.airTime > 0.3 ],
		[ 'land', ( c, s ) => s.name === 'land' ? ! s.done && ! ( c.speed > 1.2 && s.time > 0.12 ) : ( s.name === 'fall' || s.name === 'jump' ) && c.grounded && c.lastAir > 0.45 && c.speed < 1.5 ],
		[ 'deck', ( c ) => c.mode === 'deck' ],
		[ 'fishing', ( c ) => c.rod ],
		// wave 18E on foot: sneaking, carrying, worn out, a turn on the spot (only with the ctx flags the Avatar passes)
		[ 'crouch', ( c ) => c.crouch && c.grounded && ( c.mode === 'walk' || c.mode === 'deck' ) ],
		[ 'carry', ( c ) => c.carry && c.grounded && c.mode === 'walk' ],
		[ 'tired', ( c ) => c.tired && c.grounded && c.mode === 'walk' && c.speed > 0.25 && c.speed < 1.6 ],
		[ 'turnL', ( c, s ) => c.mode === 'walk' && c.grounded && c.speed < 0.2 && ( s.name === 'turnL' ? c.turn > 0.4 || s.time < 0.3 : c.turn > 1.2 ) ],
		[ 'turnR', ( c, s ) => c.mode === 'walk' && c.grounded && c.speed < 0.2 && ( s.name === 'turnR' ? c.turn < - 0.4 || s.time < 0.3 : c.turn < - 1.2 ) ],
		[ 'locomotion', () => true ],
	],

	blends: {
		default: [ 0.25, 'crossfade' ],
		'*>jump': [ 0.12, 'inertial' ],
		'jump>fall': [ 0.35, 'crossfade' ],
		'*>land': [ 0.1, 'inertial' ],
		'jump>*': [ 0.18, 'inertial' ],
		'fall>*': [ 0.2, 'inertial' ],
		'land>*': [ 0.25, 'crossfade' ],
		'*>swim': [ 0.4, 'crossfade' ],
		'swim>*': [ 0.35, 'crossfade' ],
		'locomotion>fishing': [ 0.2, 'crossfade' ],
		'fishing>locomotion': [ 0.2, 'crossfade' ],
		'*>action': [ 0.3, 'crossfade' ],
		'action>*': [ 0.3, 'crossfade' ],
		'*>helm': [ 0.3, 'inertial' ],
		'*>seated': [ 0.3, 'inertial' ],
		'*>crouch': [ 0.3, 'crossfade' ], 'crouch>*': [ 0.3, 'crossfade' ],
		'*>turnL': [ 0.2, 'crossfade' ], '*>turnR': [ 0.2, 'crossfade' ], 'turnL>*': [ 0.25, 'crossfade' ], 'turnR>*': [ 0.25, 'crossfade' ],
	},

	montages: {
		// fishing (the rod clips also stay on the Avatar's rod overlay; these are for callers that want one-shots)
		cast: { clip: 'Fishing_Cast', slot: 'upper', from: 0.06, blendIn: 0.04, blendOut: 0.25 },
		strike: { clip: 'Fishing_Strike', slot: 'upper', blendIn: 0.08, blendOut: 0.2 },
		catch: { clip: 'Catch_Celebrate', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		// melee: PlayerCombat's swing hits 0.3 s after the press; Melee_Paddle's paddle comes down at 1.03 s, so the swing starts
		// in the wind-up and plays fast: ( 1.03 - 0.45 ) / 1.93 = 0.3 s to 'contact'
		swing: { clip: 'Melee_Paddle', slot: 'full', from: 0.45, rate: 1.93, blendIn: 0.06, blendOut: 0.2, notifies: [ [ 1.03, 'contact' ] ] },
		dodge: { clip: 'Dodge_Back', slot: 'full', blendIn: 0.04, blendOut: 0.15, rootMotion: true },
		dodgeBack: { clip: 'Dodge_Back', slot: 'full', blendIn: 0.04, blendOut: 0.15, rootMotion: true },
		dodgeLeft: { clip: 'Dodge_Left', slot: 'full', blendIn: 0.04, blendOut: 0.15, rootMotion: true },
		dodgeRight: { clip: 'Dodge_Right', slot: 'full', blendIn: 0.04, blendOut: 0.15, rootMotion: true },
		dodgeForward: { clip: 'Dodge_Forward', slot: 'full', blendIn: 0.04, blendOut: 0.15, rootMotion: true },
		block: { clip: 'Block_Guard', slot: 'upper', loop: true, blendIn: 0.1, blendOut: 0.18 },
		blockImpact: { clip: 'Block_Impact', slot: 'upper', blendIn: 0.03, blendOut: 0.15 },
		parry: { clip: 'Parry', slot: 'upper', blendIn: 0.03, blendOut: 0.15, notifies: [ [ 0.1, 'parry' ] ] },
		// Hit_Reaction (Kimodo) flinches behind the forearms and holds it: the first 0.6 s are the hit
		hit: { clip: 'Hit_Reaction', slot: 'full', to: 0.6, blendIn: 0.04, blendOut: 0.22 },
		hitFront: { clip: 'Hit_Reaction', slot: 'full', to: 0.6, blendIn: 0.04, blendOut: 0.22 },
		hitBack: { clip: 'Hit_Back', slot: 'full', blendIn: 0.03, blendOut: 0.2 },
		hitLeft: { clip: 'Hit_Left', slot: 'full', blendIn: 0.03, blendOut: 0.2 },
		hitRight: { clip: 'Hit_Right', slot: 'full', blendIn: 0.03, blendOut: 0.2 },
		knockdown: { clip: 'Knockdown', slot: 'full', hold: true, blendIn: 0.1, blendOut: 0.2 },
		// Knockdown ends on the back: GetUp_Back (Kimodo) sits up, crouches and stands; GetUp_Front pushes up from face down
		getUp: { clip: 'GetUp_Back', slot: 'full', rate: 1.4, blendIn: 0.08, blendOut: 0.25 }, // 2.5 s at 1.4 = the 1.8 s PlayerCombat gives it (downTime - fallTime)
		getUpFront: { clip: 'GetUp_Front', slot: 'full', rate: 1.1, blendIn: 0.08, blendOut: 0.25 },
		stumble: { clip: 'Stumble', slot: 'full', blendIn: 0.08, blendOut: 0.2 },
		landSoft: { clip: 'Land_Soft', slot: 'full', blendIn: 0.05, blendOut: 0.2 },
		// gestures and emotes
		wave: { clip: 'Wave', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		friendlyWave: { clip: 'Friendly_Wave', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		celebrate: { clip: 'Catch_Celebrate', slot: 'full', blendIn: 0.15, blendOut: 0.3 },
		disappointed: { clip: 'Catch_Disappointed', slot: 'full', blendIn: 0.15, blendOut: 0.3 },
		cheer: { clip: 'Cheer_Clap', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		dance: { clip: 'Dance', slot: 'full', loop: true, blendIn: 0.3, blendOut: 0.3 },
		laugh: { clip: 'Laugh', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		shrug: { clip: 'Shrug', slot: 'full', blendIn: 0.15, blendOut: 0.25 },
		point: { clip: 'Point', slot: 'full', to: 3, blendIn: 0.2, blendOut: 0.3 },
		beckon: { clip: 'Beckon', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		inspect: { clip: 'Inspect_Catch', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		offer: { clip: 'Offer_Finger', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		prankLaugh: { clip: 'Prank_Laugh', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		sitDown: { clip: 'Sit_Down', slot: 'full', hold: true, blendIn: 0.15, blendOut: 0.25 },
		standUp: { clip: 'Stand_Up', slot: 'full', blendIn: 0.1, blendOut: 0.25 },
		// boarding a low boat: the clips step up / down; the game moves the player (root motion flag)
		boardLow: { clip: 'Board_Low', slot: 'full', blendIn: 0.1, blendOut: 0.2, rootMotion: true },
		disembarkLow: { clip: 'Disembark_Low', slot: 'full', blendIn: 0.1, blendOut: 0.2, rootMotion: true },
		boarding: { clip: 'Board_Low', slot: 'full', blendIn: 0.1, blendOut: 0.2, rootMotion: true },
		// out of the water onto a float / a low deck (Player's swim pull-up, Game.avatarAction 'climbUp')
		climbUp: { clip: 'Climb_Pull', slot: 'full', blendIn: 0.06, blendOut: 0.25 },
		// wave 18E emotes (src/features/emotes) and the way-of-life clips for callers (residents play them as GLB clips directly)
		bow: { clip: 'Emote_Bow', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		salute: { clip: 'Emote_Salute', slot: 'full', blendIn: 0.15, blendOut: 0.3 },
		flex: { clip: 'Emote_Flex', slot: 'full', blendIn: 0.15, blendOut: 0.3 },
		facepalm: { clip: 'Emote_Facepalm', slot: 'full', blendIn: 0.15, blendOut: 0.3 },
		thumbsUp: { clip: 'Emote_ThumbsUp', slot: 'full', blendIn: 0.15, blendOut: 0.3 },
		sitGround: { clip: 'Sit_Ground', slot: 'full', loop: true, blendIn: 0.5, blendOut: 0.5 },
		dance2: { clip: 'Dance_2', slot: 'full', loop: true, blendIn: 0.3, blendOut: 0.3 },
		sitChair: { clip: 'Sit_Chair', slot: 'full', hold: true, blendIn: 0.2, blendOut: 0.25 },
		sitChairIdle: { clip: 'Sit_Chair_Idle', slot: 'full', loop: true, blendIn: 0.2, blendOut: 0.25 },
		standFromChair: { clip: 'Stand_From_Chair', slot: 'full', blendIn: 0.1, blendOut: 0.25 },
		drink: { clip: 'Drink', slot: 'upper', blendIn: 0.2, blendOut: 0.3 },
		eat: { clip: 'Eat', slot: 'upper', blendIn: 0.2, blendOut: 0.3 },
		clap: { clip: 'Clap', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		pointOut: { clip: 'Point_Out', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		talkGroup: { clip: 'Talk_Group', slot: 'full', loop: true, blendIn: 0.3, blendOut: 0.3 },
		hammer: { clip: 'Hammer', slot: 'full', loop: true, blendIn: 0.2, blendOut: 0.25 },
		fishNet: { clip: 'Fish_Net', slot: 'full', loop: true, blendIn: 0.3, blendOut: 0.3 },
		kneelWork: { clip: 'Kneel_Work', slot: 'full', loop: true, blendIn: 0.4, blendOut: 0.4 },
		leanWall: { clip: 'Lean_Wall', slot: 'full', loop: true, blendIn: 0.4, blendOut: 0.4 },
		lampLight: { clip: 'Lamp_Light', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
		turnLeft: { clip: 'Turn_Left', slot: 'full', blendIn: 0.15, blendOut: 0.2 },
		turnRight: { clip: 'Turn_Right', slot: 'full', blendIn: 0.15, blendOut: 0.2 },
		// other names callers may use
		attack: { clip: 'Melee_Paddle', slot: 'full', from: 0.45, rate: 1.93, blendIn: 0.06, blendOut: 0.2, notifies: [ [ 1.03, 'contact' ] ] },
		guard: { clip: 'Block_Guard', slot: 'upper', loop: true, blendIn: 0.1, blendOut: 0.18 },
		evade: { clip: 'Dodge_Back', slot: 'full', blendIn: 0.04, blendOut: 0.15, rootMotion: true },
		stagger: { clip: 'Hit_Reaction', slot: 'full', to: 0.6, blendIn: 0.04, blendOut: 0.22 },
		// wave 19D, the Kimodo combat takes (see BLOW): per weapon the blow's contact lands on WeaponsData MELEE[ id ].contact
		// (cutlass 0.2, axe 0.48, pin 0.22, harpoon 0.3) and a throw's release on WeaponPose THROW_RELEASE (0.25)
		cutlassSlashR: BLOW( 'Sword_Slash_R', 0.36, 0.57, 0.2, 0.36 ), // high right to low left
		cutlassSlashL: BLOW( 'Sword_Slash_L', 0.62, 0.88, 0.2, 0.36 ), // the backhand, left to right
		cutlassThrust: BLOW( 'Sword_Thrust', 0.2, 0.45, 0.2, 0.36 ), // the lunge (the chain's third blow)
		axeChop: BLOW( 'Axe_Chop', 1.0, 1.6, 0.48, 0.29 ), // both hands up over the head, down hard (the take's slow raise is skipped)
		pinClub: BLOW( 'Club_Swing', 0.25, 0.55, 0.22, 0.3 ),
		harpoonThrust: BLOW( 'Harpoon_Thrust', 0.1, 0.4, 0.3, 0.4 ), // (the weapon keeps Wpn_Thrust: the left arm flings out wide, off the shaft)
		harpoonThrow: BLOW( 'Harpoon_Throw', 0.75, 1.22, 0.25, 0.4, 'release' ),
		bombThrow: BLOW( 'Throw_Overhand', 0.6, 1.0, 0.25, 0.28, 'release' ),
		// no take of the guns, the parry or the knocked-back guard passed review (the hands go into the big heads, nothing rams or recoils): 'parry' (Parry), 'blockImpact'
		// and Firearms' GunPose clips (Gun_Aim_* / Gun_Fire_* / Gun_Reload) stay. A forward roll (the game moves the player: root motion) and the raiders' taunt
		dodgeRoll: { clip: 'Dodge_Roll', slot: 'full', blendIn: 0.05, blendOut: 0.2, rootMotion: true },
		taunt: { clip: 'Taunt', slot: 'full', blendIn: 0.2, blendOut: 0.3 },
	},

	footsteps: [ 0.12, 0.62 ],
	// stance windows of the planted foot (phase), walk and run: the foot-lock hook weights
	stance: { walk: [ 0.1, 0.62 ], run: [ 0.14, 0.4 ] },
	// lean into turns (rad of roll per (m/s x rad/s)), capped; eased at `rate` 1/s
	lean: { k: 0.045, max: 0.2, rate: 6 },
	// inertial blend after a cut (s) when nothing else says
	inertial: 0.25,

};
