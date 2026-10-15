import { makeRig, poseClip, localsAt, fk, qconj, qmul, qaxis, FPS } from '../../player/anim/ClipTools.js';
import ANIM from '../../player/anim/AnimDef.js';

// The arms with a melee weapon or a throwable (wave 18D, the GunPose.js pattern: "no A-pose anywhere"): pose clips built on
// the avatar's own rig from its idle with the AnimDef `{ base, keys }` recipe (ClipTools.poseClip), registered in the model's
// clip table and played by the weapons feature / PlayerCombat as upper-body montages over the locomotion:
//
//   Wpn_Hold_1H      a blade / club / paddle ready at the hip, the point forward and up
//   Wpn_Hold_Pole    the harpoon two-handed, low, the head ahead
//   Wpn_Slash        the cutlass: high right to low left, contact at 0.2 s (MELEE.cutlass.contact)
//   Wpn_Chop         the boarding axe: overhead and down, contact at 0.48 s
//   Wpn_Club         the belaying pin: a short downward blow, contact at 0.22 s
//   Wpn_Thrust       the harpoon: drawn back and driven ahead, contact at 0.3 s
//   Wpn_Throw_Ready  a throwable raised by the shoulder
//   Wpn_Throw        the throw: cocked back, released ahead at 0.25 s (THROW_RELEASE), the follow-through
//
//   Wpn_Slash_L, Wpn_Lunge   wave 19D: the cutlass's backhand and lunge (attackClip( 'cutlass', n ): cut, backhand, lunge)
//   Wpn_Throw_Harpoon        wave 19D: the harpoon's javelin throw (released at THROW_RELEASE like Wpn_Throw)
//
// Wave 19D: where the roster GLB carries the Kimodo take (tools/roster/kimodo-combat: Sword_Slash_R / _L, Axe_Chop, Club_Swing,
// Sword_Thrust, Harpoon_Throw, Throw_Overhand), the attack is that take instead of the pose clip: AnimDef's montage (MOTION_OF) names the
// clip, the stretch played (from / to) and the rate that puts its 'contact' ('release') notify on MELEE[ id ].contact
// (THROW_RELEASE), and build() slices that stretch into the pose clip's name, so Weapons and PlayerCombat play it unchanged.
// A GLB without the take keeps the 18D pose clip (the fallback).
//
//   const wp = weaponPoses( avatar ) -> { hold: { oneHand, pole, thrown, idle }, clips: WEAPON_CLIPS, motion: [ sliced names ] } | null
//   hold[ k ]: [ x, y, z, w ] the weapon in the weapon_r socket so that in that hold pose it lies as HOLD_AIM[ k ] says in model
//   space (the socket inverse at the pose times the wanted turn); idle: a raider's weapon at his idle (the point down and
//   ahead), for the hands that never play these clips. Built once per model; null when the rig lacks the arm bones or the idle.
//
// Model space of the roster GLBs: +Y up, the character faces +Z, +X is its left. reach: [ wrist x, y, z, elbow pole x, y, z ].
// The shoulders sit at ( -+0.15, 1.04, -0.1 ), the arms reach ~0.43 m (tools/weapons/rig-dump.mjs).

export const WEAPON_CLIPS = {
	hold1h: 'Wpn_Hold_1H', holdPole: 'Wpn_Hold_Pole', slash: 'Wpn_Slash', chop: 'Wpn_Chop', club: 'Wpn_Club', thrust: 'Wpn_Thrust',
	throwReady: 'Wpn_Throw_Ready', throw: 'Wpn_Throw', slashL: 'Wpn_Slash_L', lunge: 'Wpn_Lunge', throwHarpoon: 'Wpn_Throw_Harpoon',
};
// the attack clip of each melee weapon (the paddle keeps AnimDef's 'swing': Melee_Paddle) and its hold
export const ATTACK_OF = { cutlass: WEAPON_CLIPS.slash, axe: WEAPON_CLIPS.chop, pin: WEAPON_CLIPS.club, harpoon: WEAPON_CLIPS.thrust };
export const HOLD_OF = { paddle: 'oneHand', cutlass: 'oneHand', axe: 'oneHand', pin: 'oneHand', harpoon: 'pole' };
export const THROW_RELEASE = 0.25; // s into Wpn_Throw the hand lets go
// wave 19D: the AnimDef montage (a Kimodo take) behind each attack clip, and the cuts a weapon alternates
export const MOTION_OF = {
	Wpn_Slash: 'cutlassSlashR', Wpn_Slash_L: 'cutlassSlashL', Wpn_Lunge: 'cutlassThrust', Wpn_Chop: 'axeChop', Wpn_Club: 'pinClub',
	Wpn_Throw: 'bombThrow', Wpn_Throw_Harpoon: 'harpoonThrow', // (Wpn_Thrust keeps its pose: the Harpoon_Thrust take flings the left arm off the shaft)
};
// the clips beyond 18D's eight and the pose recipe each falls back to
export const EXTRA_CLIPS = { Wpn_Slash_L: 'Wpn_Slash', Wpn_Lunge: 'Wpn_Slash', Wpn_Throw_Harpoon: 'Wpn_Throw' };
// the cutlass's chain: the right cut, the backhand, the lunge (MELEE.cutlass.combo: the third bites deeper)
export const ALT_ATTACK = { cutlass: [ 'Wpn_Slash', 'Wpn_Slash_L', 'Wpn_Lunge' ] };
export const attackClip = ( id, n = 0 ) => { const a = ALT_ATTACK[ id ]; return a ? a[ ( ( n % a.length ) + a.length ) % a.length ] : ATTACK_OF[ id ]; };

const DEG = Math.PI / 180;
// the weapon's turn in model space at each hold pose: rotations about the model's X tip its +Z (the point) up for negative angles
export const HOLD_AIM = { oneHand: - 38, pole: - 10, thrown: 0, idle: 55 };

const HOLD_1H = { spine_02: [ [ 'y', - 6 ] ], hand_r: [ [ 'x', - 20 ] ], reach: { r: [ - 0.2, 0.86, 0.22, - 1, - 0.6, - 0.3 ] } };
const HOLD_POLE = { spine_02: [ [ 'y', - 18 ] ], spine_01: [ [ 'x', 4 ] ], reach: { r: [ - 0.17, 0.88, 0.02, - 1, - 0.4, - 0.4 ], l: [ - 0.12, 0.96, 0.3, 1, - 0.6, - 0.2 ] } };
const READY = { spine_02: [ [ 'y', - 10 ] ], reach: { r: [ - 0.3, 1.24, - 0.06, - 1, - 0.5, - 0.5 ], l: [ 0.18, 0.95, 0.25, 1, - 0.6, 0 ] } };

export const WEAPON_RECIPES = {
	Wpn_Hold_1H: { keys: [ { t: 0, pose: HOLD_1H }, { t: 1.97, pose: HOLD_1H } ] },
	Wpn_Hold_Pole: { keys: [ { t: 0, pose: HOLD_POLE }, { t: 1.97, pose: HOLD_POLE } ] },
	Wpn_Slash: { keys: [
		{ t: 0, pose: HOLD_1H },
		{ t: 0.1, pose: { spine_02: [ [ 'y', - 26 ] ], hand_r: [ [ 'x', - 30 ] ], reach: { r: [ - 0.33, 1.3, 0.02, - 1, 0.2, - 0.4 ] } } },
		{ t: 0.2, ease: 'out', pose: { spine_02: [ [ 'y', 22 ] ], spine_01: [ [ 'x', 6 ] ], hand_r: [ [ 'x', - 10 ] ], reach: { r: [ 0.1, 0.92, 0.34, - 1, - 0.6, 0.3 ] } } },
		{ t: 0.46, pose: HOLD_1H },
	] },
	Wpn_Chop: { keys: [
		{ t: 0, pose: HOLD_1H },
		{ t: 0.3, pose: { spine_01: [ [ 'x', - 8 ] ], spine_02: [ [ 'y', - 8 ] ], hand_r: [ [ 'x', - 40 ] ], reach: { r: [ - 0.14, 1.45, - 0.04, - 1, 0.3, - 0.6 ] } } },
		{ t: 0.48, ease: 'in', pose: { spine_01: [ [ 'x', 16 ] ], spine_02: [ [ 'y', 4 ] ], hand_r: [ [ 'x', 70 ] ], reach: { r: [ - 0.07, 0.86, 0.36, - 1, - 0.4, 0.2 ] } } },
		{ t: 0.7, pose: { spine_01: [ [ 'x', 12 ] ], hand_r: [ [ 'x', 60 ] ], reach: { r: [ - 0.07, 0.84, 0.34, - 1, - 0.4, 0.2 ] } } },
		{ t: 1.0, pose: HOLD_1H },
	] },
	Wpn_Club: { keys: [
		{ t: 0, pose: HOLD_1H },
		{ t: 0.1, pose: { spine_02: [ [ 'y', - 14 ] ], hand_r: [ [ 'x', - 30 ] ], reach: { r: [ - 0.26, 1.28, 0.04, - 1, 0.2, - 0.4 ] } } },
		{ t: 0.22, ease: 'out', pose: { spine_01: [ [ 'x', 10 ] ], spine_02: [ [ 'y', 8 ] ], reach: { r: [ - 0.04, 0.9, 0.36, - 1, - 0.5, 0.2 ] } } },
		{ t: 0.44, pose: HOLD_1H },
	] },
	Wpn_Thrust: { keys: [
		{ t: 0, pose: HOLD_POLE },
		{ t: 0.14, pose: { spine_02: [ [ 'y', - 26 ] ], spine_01: [ [ 'x', - 4 ] ], reach: { r: [ - 0.2, 0.9, - 0.08, - 1, - 0.4, - 0.4 ], l: [ 0.0, 0.98, 0.2, 1, - 0.6, - 0.2 ] } } },
		{ t: 0.3, ease: 'out', pose: { spine_02: [ [ 'y', - 4 ] ], spine_01: [ [ 'x', 14 ] ], hand_r: [ [ 'x', 30 ] ], reach: { r: [ - 0.1, 0.98, 0.24, - 1, - 0.5, - 0.2 ], l: [ - 0.06, 1.02, 0.42, 1, - 0.6, 0 ] } } },
		{ t: 0.68, pose: HOLD_POLE },
	] },
	Wpn_Throw_Ready: { keys: [ { t: 0, pose: READY }, { t: 1.97, pose: READY } ] },
	Wpn_Throw: { keys: [
		{ t: 0, pose: READY },
		{ t: 0.12, pose: { spine_02: [ [ 'y', - 24 ] ], spine_01: [ [ 'x', - 6 ] ], reach: { r: [ - 0.32, 1.28, - 0.18, - 1, - 0.3, - 0.6 ], l: [ 0.22, 1.0, 0.3, 1, - 0.6, 0 ] } } },
		{ t: THROW_RELEASE, ease: 'out', pose: { spine_02: [ [ 'y', 14 ] ], spine_01: [ [ 'x', 10 ] ], reach: { r: [ - 0.12, 1.24, 0.3, - 1, - 0.4, 0 ], l: [ 0.24, 0.9, 0.1, 1, - 0.6, - 0.2 ] } } },
		{ t: 0.48, pose: { spine_02: [ [ 'y', 18 ] ], spine_01: [ [ 'x', 14 ] ], reach: { r: [ 0.04, 0.92, 0.3, - 1, - 0.5, 0.2 ] } } },
		{ t: 0.7, pose: READY },
	] },
};

// the pose each hold is measured at (clip, time)
const HOLD_AT = { oneHand: [ 'Wpn_Hold_1H', 0.5 ], pole: [ 'Wpn_Hold_Pole', 0.5 ], thrown: [ 'Wpn_Throw_Ready', 0.5 ], idle: [ 'Idle_Breathe', 0.5 ] };
const _built = new WeakMap(); // model -> result (or null)

export function weaponPoses( avatar ) {

	const m = avatar && avatar.model;
	if ( ! m || ! m.clips || ! m.gltf ) return null;
	if ( _built.has( m ) ) return _built.get( m );
	let out = null;
	try {

		out = build( m );

	} catch ( e ) {

		out = null;

	}

	_built.set( m, out );
	return out;

}

function build( m ) {

	const base = m.clips.get( 'Idle_Breathe' );
	if ( ! base ) return null;
	const rig = makeRig( m.gltf );
	const I = rig.index;
	for ( const b of [ 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'spine_01', 'spine_02', 'weapon_r' ] ) if ( I[ b ] === undefined ) return null;
	const motion = [];
	for ( const name of [ ...Object.keys( WEAPON_RECIPES ), ...Object.keys( EXTRA_CLIPS ) ] ) {

		if ( m.clips.has( name ) ) continue;
		const md = MOTION_OF[ name ] && ANIM.montages[ MOTION_OF[ name ] ];
		const src = md && m.clips.get( md.clip );
		if ( src ) {

			m.clips.set( name, sliceClip( src, name, md ) );
			motion.push( name );
			continue;

		}

		const clip = poseClip( rig, base, name, ( WEAPON_RECIPES[ name ] || WEAPON_RECIPES[ EXTRA_CLIPS[ name ] ] ).keys, { loopBase: true } );
		if ( ! clip ) return null;
		m.clips.set( name, clip );

	}

	const hold = {};
	for ( const k in HOLD_AT ) {

		const [ clip, t ] = HOLD_AT[ k ];
		const { R } = fk( rig, localsAt( rig, m.clips.get( clip ), t ) );
		hold[ k ] = qmul( qconj( R[ I.weapon_r ] ), qaxis( 'x', HOLD_AIM[ k ] * DEG ) );

	}

	return { hold, clips: WEAPON_CLIPS, motion };

}

// the stretch from..to of a clip played at `rate`, resampled at the clip rate into a clip of its own (time 0 = `from`), so a
// plain clip-name montage plays it with the montage's timing
export function sliceClip( src, name, { from = 0, to = src.duration, rate = 1 } ) {

	to = Math.min( to, src.duration );
	const duration = ( to - from ) / rate, n = Math.max( 1, Math.round( duration * FPS ) );
	const times = new Float32Array( n + 1 );
	for ( let k = 0; k <= n; k ++ ) times[ k ] = k / n * duration;
	const channels = src.channels.map( ( ch ) => {

		const w = ch.values.length / ch.times.length, values = new Float32Array( ( n + 1 ) * w );
		for ( let k = 0; k <= n; k ++ ) sample( ch, w, from + times[ k ] * rate, values, k * w );
		return { node: ch.node, path: ch.path, times, values, step: false };

	} );
	return { name, duration, channels, procedural: true };

}

// one channel at time t: lerp (translation / scale) or nlerp along the shorter arc (rotation)
function sample( ch, w, t, out, o ) {

	const T = ch.times, V = ch.values, last = T.length - 1;
	let i = 0;
	if ( t >= T[ last ] ) i = last;
	else if ( t > T[ 0 ] ) { let lo = 0, hi = last; while ( hi - lo > 1 ) { const mid = ( lo + hi ) >> 1; if ( T[ mid ] <= t ) lo = mid; else hi = mid; } i = lo; }
	const j = Math.min( last, i + 1 );
	const u = j > i && ! ch.step ? Math.max( 0, Math.min( 1, ( t - T[ i ] ) / ( T[ j ] - T[ i ] ) ) ) : 0;
	let s = 1;
	if ( w === 4 ) { let d = 0; for ( let c = 0; c < 4; c ++ ) d += V[ i * 4 + c ] * V[ j * 4 + c ]; if ( d < 0 ) s = - 1; }
	let len = 0;
	for ( let c = 0; c < w; c ++ ) { out[ o + c ] = V[ i * w + c ] * ( 1 - u ) + s * V[ j * w + c ] * u; len += out[ o + c ] * out[ o + c ]; }
	if ( w === 4 && len > 0 ) { len = Math.sqrt( len ); for ( let c = 0; c < 4; c ++ ) out[ o + c ] /= len; }

}

// the socket's model rotation and position at a clip time (tests and the pose tool: where the weapon points)
export function socketAt( m, clipName, t ) {

	const rig = makeRig( m.gltf );
	const { R, P } = fk( rig, localsAt( rig, m.clips.get( clipName ), t ) );
	return { R: R[ rig.index.weapon_r ], P: P[ rig.index.weapon_r ] };

}
