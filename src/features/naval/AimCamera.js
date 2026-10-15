// Third-person cannon aiming (wave 10): while naval.aiming and the helm camera is the chase view, the camera swings to an
// over-the-shoulder rig on the aimed side, vertical look sets the guns' range and the crosshair sits where the ball lands.
// Pure maths (no engine, no DOM): Naval.js keeps the eased state, Player.updateBoat reads the rig through naval.aimCamera().
//
//   AIM_CAM                        the rig: shoulder 2.5 m to the aimed side, 1.2 m up from the chase anchor, 30 % closer,
//                                  fov -8 deg, eased over 0.25 s; the look pitch band that maps onto the gun's range
//   pitchToRange( pitch, min, max ) -> m    look pitch (rad, + up) -> range: the band's bottom is the shortest shot, its top
//                                  (just above the horizon) the longest; linear in between, clamped outside
//   rangeToPitch( range, min, max ) -> rad  the inverse (tests, and to start the look where the guns already point)
//   easeAimCam( st, { aiming, side }, dt ) -> st      st { blend 0..1, shoulder -1..1 (+ port), side }: blend moves toward
//                                  aiming at 1 / AIM_CAM.ease per s, the shoulder swings to the side's sign at twice that
//   aimRig( st, { dist, fov, pitch, az } ) -> { side, sign, blend, yawOffset, pitch, pitchMin, pitchMax, dist, fov, fovDelta,
//                                  shoulder: { x, y } } | null    the rig for the camera code (null while blend is 0)
//     side / sign                  the aimed side ('port' / 'starboard') and +1 / -1 (the boat frame's +X is port)
//     blend                        the eased amount (smoothstep of st.blend): 0 the chase camera, 1 the full aim rig
//     yawOffset                    the bearing the guns are laid at off the side's beam (rad, inside the swing; + toward the bow
//                                  on port): where the crosshair's bearing sits relative to the beam
//     pitch / pitchMin / pitchMax  the look pitch held inside the aim band (rad, + up): Player clamps orbitPitch = - pitch to it
//     dist                         the camera's distance from the pivot (m): dist x ( 1 - 0.3 blend )
//     fov / fovDelta               the narrower field (deg): fov + fovDelta, fovDelta = - 8 blend (Naval applies it after the
//                                  camera feel's own fov, like the firearms' zoom; restored on release)
//     shoulder { x, y }            the pivot's offset from the chase anchor in the boat frame (m): x = 2.5 x the eased shoulder,
//                                  y = 1.2 blend

import { clamp } from './util.js';

export const AIM_CAM = {
	side: 2.5, // m to the aimed side (boat frame)
	lift: 1.2, // m up
	closer: 0.3, // the arm 30 % shorter
	fov: - 8, // deg
	ease: 0.25, // s in / out
	pitchLo: - 0.40, // look pitch (rad) of the shortest range
	pitchHi: 0.06, // and of the longest (a hair above the horizon)
};

export function pitchToRange( pitch, minRange = 20, maxRange = 320 ) {

	const t = clamp( ( pitch - AIM_CAM.pitchLo ) / ( AIM_CAM.pitchHi - AIM_CAM.pitchLo ), 0, 1 );
	return minRange + ( maxRange - minRange ) * t;

}

export function rangeToPitch( range, minRange = 20, maxRange = 320 ) {

	const t = clamp( ( range - minRange ) / Math.max( 1e-6, maxRange - minRange ), 0, 1 );
	return AIM_CAM.pitchLo + ( AIM_CAM.pitchHi - AIM_CAM.pitchLo ) * t;

}

export function easeAimCam( st, { aiming = false, side = null } = {}, dt = 0.016 ) {

	const k = dt / AIM_CAM.ease;
	if ( aiming && side ) st.side = side;
	const want = aiming ? 1 : 0;
	st.blend = st.blend < want ? Math.min( want, st.blend + k ) : Math.max( want, st.blend - k );
	const sg = st.side === 'starboard' ? - 1 : 1;
	// a fresh aim starts on its own side (no swing across from the last one)
	if ( aiming && st.blend <= k + 1e-9 ) st.shoulder = sg;
	else st.shoulder = st.shoulder < sg ? Math.min( sg, st.shoulder + 2 * k ) : Math.max( sg, st.shoulder - 2 * k );
	return st;

}

export function aimRig( st, { dist = 13, fov = null, pitch = 0, az = 0 } = {} ) {

	if ( ! st || ! ( st.blend > 0 ) ) return null;
	const b = clamp( st.blend, 0, 1 );
	const e = b * b * ( 3 - 2 * b );
	const side = st.side === 'starboard' ? 'starboard' : 'port';
	const fovDelta = AIM_CAM.fov * e;
	return {
		side, sign: side === 'port' ? 1 : - 1, blend: e, yawOffset: Number.isFinite( az ) ? az : 0,
		pitch: clamp( Number.isFinite( pitch ) ? pitch : 0, AIM_CAM.pitchLo, AIM_CAM.pitchHi ), pitchMin: AIM_CAM.pitchLo, pitchMax: AIM_CAM.pitchHi,
		dist: dist * ( 1 - AIM_CAM.closer * e ),
		fov: Number.isFinite( fov ) ? fov + fovDelta : null, fovDelta,
		shoulder: { x: AIM_CAM.side * clamp( st.shoulder, - 1, 1 ) * e, y: AIM_CAM.lift * e },
	};

}
