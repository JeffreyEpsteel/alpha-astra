import { makeRig, poseClip, localsAt, fk, qconj } from '../../player/anim/ClipTools.js';

// The arms with a gun out (wave 17B: "no A-pose anywhere"): pose clips built on the avatar's own rig from its idle, the
// AnimDef `{ base, keys }` recipe (ClipTools.poseClip, the same tool the guard / dodge clips and the emotes' wave use),
// registered in the model's clip table and played by Firearms as upper-body montages over the locomotion:
//
//   Gun_Aim_Pistol   the pistol arm out ahead at shoulder height, the other hand at the side
//   Gun_Aim_Musket   the musket across the chest: the right hand at the lock, the left under the barrel
//   Gun_Fire_<kind>  the aim with a kick up and back (0.35 s)
//   Gun_Reload       the gun down at the waist, the free hand ramming (1 s; Firearms plays it at 1 / reload s)
//
//   const gp = gunPoses( avatar ) -> { aim: { pistol, musket }, fire: { pistol, musket }, reload, hold: { pistol, musket } } | null
//   hold[ kind ]: [ x, y, z, w ], the gun in the weapon_r socket so the barrel points straight ahead (model +Z, lock up) in
//   that kind's aim pose (the socket inverse at the pose; WeaponMesh.update( { hold } ) uses it instead of the rod-hold pitch).
//   Built once per model; null when the rig lacks the arm bones or the idle (Firearms then keeps the rod hold overlay).
//
// Model space of the roster GLBs: +Y up, the character faces +Z, +X is its left. reach: [ wrist x, y, z, elbow pole x, y, z ].

export const GUN_CLIPS = { aim: { pistol: 'Gun_Aim_Pistol', musket: 'Gun_Aim_Musket' }, fire: { pistol: 'Gun_Fire_Pistol', musket: 'Gun_Fire_Musket' }, reload: 'Gun_Reload' };

const AIM_P = { spine_02: [ [ 'y', - 8 ] ], head: [ [ 'y', 6 ] ], reach: { r: [ - 0.12, 1.02, 0.34, - 0.6, - 1, - 0.1 ] } };
const KICK_P = { spine_02: [ [ 'y', - 8 ], [ 'x', - 4 ] ], head: [ [ 'y', 6 ] ], reach: { r: [ - 0.12, 1.1, 0.27, - 0.6, - 1, - 0.1 ] } };
const AIM_M = { spine_02: [ [ 'x', 4 ] ], head: [ [ 'x', 4 ] ], reach: { r: [ - 0.07, 0.95, 0.09, - 1, - 0.6, - 0.2 ], l: [ - 0.03, 0.94, 0.28, 0.8, - 1, 0 ] } };
const KICK_M = { spine_02: [ [ 'x', - 4 ] ], head: [ [ 'x', 2 ] ], reach: { r: [ - 0.07, 0.99, 0.03, - 1, - 0.6, - 0.2 ], l: [ - 0.03, 0.98, 0.22, 0.8, - 1, 0 ] } };
const RAM = ( up ) => ( { spine_01: [ [ 'x', 8 ] ], head: [ [ 'x', 12 ] ], hand_r: [ [ 'x', - 85 ] ], reach: { r: [ - 0.1, 0.8, 0.2, - 1, - 0.5, - 0.3 ], l: [ - 0.06, up ? 1.0 : 0.88, 0.22, 1, - 0.5, - 0.3 ] } } );

export const GUN_RECIPES = {
	Gun_Aim_Pistol: { keys: [ { t: 0, pose: AIM_P }, { t: 1.97, pose: AIM_P } ] },
	Gun_Aim_Musket: { keys: [ { t: 0, pose: AIM_M }, { t: 1.97, pose: AIM_M } ] },
	Gun_Fire_Pistol: { keys: [ { t: 0, pose: AIM_P }, { t: 0.05, ease: 'out', pose: KICK_P }, { t: 0.35, pose: AIM_P } ] },
	Gun_Fire_Musket: { keys: [ { t: 0, pose: AIM_M }, { t: 0.05, ease: 'out', pose: KICK_M }, { t: 0.35, pose: AIM_M } ] },
	Gun_Reload: { keys: [ { t: 0, pose: RAM( false ) }, { t: 0.25, pose: RAM( true ) }, { t: 0.45, pose: RAM( false ) }, { t: 0.65, pose: RAM( true ) }, { t: 1.0, pose: RAM( false ) } ] },
};

const _built = new WeakMap(); // model -> result (or null)

export function gunPoses( avatar ) {

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
	for ( const b of [ 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'spine_02', 'weapon_r' ] ) if ( I[ b ] === undefined ) return null;
	for ( const name in GUN_RECIPES ) {

		if ( m.clips.has( name ) ) continue;
		const clip = poseClip( rig, base, name, GUN_RECIPES[ name ].keys, { loopBase: true } );
		if ( ! clip ) return null;
		m.clips.set( name, clip );

	}

	// the socket's model rotation at each aim pose -> its inverse is the gun in the socket with the barrel ahead
	const hold = {};
	for ( const kind of [ 'pistol', 'musket' ] ) {

		const { R } = fk( rig, localsAt( rig, m.clips.get( GUN_CLIPS.aim[ kind ] ), 0.5 ) );
		hold[ kind ] = qconj( R[ I.weapon_r ] );

	}

	return { aim: GUN_CLIPS.aim, fire: GUN_CLIPS.fire, reload: GUN_CLIPS.reload, hold };

}
