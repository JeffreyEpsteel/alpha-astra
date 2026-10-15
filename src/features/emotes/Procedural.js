// The emotes' last resort: an arm wave authored as a pose clip on the avatar's own rig, for a roster character whose GLB
// has none of the Wave / Friendly_Wave takes. ClipTools.poseClip builds it from deltas on the idle (the same tool the
// combat clips use), it is registered in the model's clip table under a name, and Avatar.playMontage( name, { slot:
// 'upper' } ) plays it like any clip (AnimGraph.play accepts a clip name), so it blends over the walking legs.
//
//   proceduralWave( avatar ) -> clip name | null      builds once per model; null when the rig lacks the right arm bones
//   WAVE_CLIP                                         'Emote_Wave_Proc'

import { makeRig, poseClip } from '../../player/anim/ClipTools.js';

export const WAVE_CLIP = 'Emote_Wave_Proc';

// frames: +X is the character's left; a hanging limb tipped about -Z swings out to the character's right
const RAISE = { upperarm_r: [ [ 'z', - 140 ], [ 'x', - 8 ] ], lowerarm_r: [ [ 'z', - 8 ] ], head: [ [ 'z', 5 ] ] };
const swing = ( deg ) => ( { upperarm_r: [ [ 'z', - 140 ], [ 'x', - 8 ] ], lowerarm_r: [ [ 'z', deg ] ], head: [ [ 'z', 5 ] ] } );
export const WAVE_KEYS = [
	{ t: 0, pose: {} },
	{ t: 0.4, ease: 'out', pose: RAISE },
	{ t: 0.65, pose: swing( - 38 ) },
	{ t: 0.9, pose: swing( 14 ) },
	{ t: 1.15, pose: swing( - 38 ) },
	{ t: 1.4, pose: swing( 14 ) },
	{ t: 1.65, pose: swing( - 38 ) },
	{ t: 1.9, pose: swing( 14 ) },
	{ t: 2.3, pose: {} },
];

export function proceduralWave( avatar ) {

	const m = avatar && avatar.model;
	if ( ! m || ! m.clips || ! m.gltf ) return null;
	if ( m.clips.has( WAVE_CLIP ) ) return WAVE_CLIP;
	const base = m.clips.get( 'Idle_Breathe' ) || m.clips.values().next().value;
	if ( ! base ) return null;
	try {

		const rig = makeRig( m.gltf );
		if ( rig.index.upperarm_r === undefined || rig.index.lowerarm_r === undefined ) return null;
		const clip = poseClip( rig, base, WAVE_CLIP, WAVE_KEYS, { loopBase: true } );
		if ( ! clip ) return null;
		m.clips.set( WAVE_CLIP, clip );
		return WAVE_CLIP;

	} catch ( e ) {

		return null;

	}

}
