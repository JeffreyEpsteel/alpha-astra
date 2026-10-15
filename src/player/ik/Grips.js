import { Vector3 } from '../../engine/index.js';

// Where the hands go (contact IK targets for Avatar.setIKTargets, src/player/ik/ContactIK.js):
//
//   crankKnobLocal( crankAngle, out )      the reel's crank knob in the right hand's prop socket frame (weapon_r)
//   helmGrips( boatCtl, outL, outR )        both hands on the helm (world), false when the hull has no known handholds
//   contactTargets( out, { player, rod, boat, action } )   the player's targets this frame (one reusable object):
//       the off hand on the crank knob while holding / reeling / fighting a fish (solved in the rod hand's frame, so it
//       follows this frame's rod with no lag), both hands on the wheel at the helm; out.steer is the boat's steering
//       (-1..1, + = port) for the helmsman's lean (Avatar) and out.stand the feet's place at the wheel (world, model.helmStand).
//
// Boat models may carry fixed handholds: model.helmGrips = { left: {x,y,z}, right: {x,y,z} } (boat frame); else every hull's
// wheel: model.wheelGrips( outL, outR ) (BoatModel / FleetBoatModel / ShipBoatModel: the rim points turning with the wheel),
// else a bare wheelPivot / wheelMesh pair.

// FishingRod.js reel geometry (rod frame: +Y along the blank from the butt, the reel below at -Z): the reel seat held at
// SEAT_Y, the crank axis at BODY_Y / REEL_Z, the arm 0.052 m, the T-knob centre 0.058 m out on the left (-X)
const SEAT_Y = 0.405, BODY_Y = 0.327, REEL_Z = - 0.092, ARM = 0.052, KNOB_X = - 0.058;

// rod frame -> socket frame: rod +X = socket +X, rod +Y = socket +Z, rod +Z = socket -Y, the seat at the socket
// (FishingRod.update: makeBasis( x, ( 0, 0, 1 ), ( 0, -1, 0 ) ) at -SEAT_Y along the shaft); the arm turns about the rod X
export function crankKnobLocal( crankAngle, out ) {

	const s = Math.sin( crankAngle ), c = Math.cos( crankAngle );
	return out.set( KNOB_X, - ( REEL_Z - ARM * s ), BODY_Y - ARM * c - SEAT_Y );

}

const WHEEL_R = 0.2; // Wheelhouse.wheelGeometry rim radius
const GRIP_ANGLE = Math.PI / 6; // ten and two o'clock (from the helmsman's left, +X of the wheel = port)
const HAND_TURN = 0.6; // rad the hands follow the wheel before they slide on the rim
const _p = new Vector3(), _gl = new Vector3(), _gr = new Vector3();

export function helmGrips( boatCtl, outL, outR ) {

	const m = boatCtl && boatCtl.model;
	if ( ! m ) return false;
	if ( m.helmGrips && m.helmGrips.left && m.helmGrips.right ) {

		boatCtl.toWorld( _p.copy( m.helmGrips.left ), outL );
		boatCtl.toWorld( _p.copy( m.helmGrips.right ), outR );
		return true;

	}

	if ( typeof m.wheelGrips === 'function' ) {

		if ( ! m.wheelGrips( _gl, _gr ) ) return false;
		boatCtl.toWorld( _p.copy( _gl ), outL );
		boatCtl.toWorld( _p.copy( _gr ), outR );
		return true;

	}

	const piv = m.wheelPivot;
	if ( ! piv ) return false;
	const rz = m.wheelMesh ? Math.max( - HAND_TURN, Math.min( HAND_TURN, m.wheelMesh.rotation.z ) ) : 0;
	rimPoint( boatCtl, piv, GRIP_ANGLE + rz, outL );
	rimPoint( boatCtl, piv, Math.PI - GRIP_ANGLE + rz, outR );
	return true;

}

// the rim point at angle a in the pivot frame (spokes in its XY plane) -> boat frame -> world
function rimPoint( boatCtl, piv, a, out ) {

	const r = boatCtl.model.wheelRadius || WHEEL_R;
	_p.set( r * Math.cos( a ), r * Math.sin( a ), 0 ).applyQuaternion( piv.quaternion ).add( piv.position );
	return boatCtl.toWorld( _p, out );

}

const ROD_GRIP = { hold: true, strike: true, reel: true, fight: true };
const HELM = { helm: true, steerLeft: true, steerRight: true };

export function contactTargets( out, { player, rod, boat, action } ) {

	if ( ! out.leftHand ) {

		out.leftHand = { position: new Vector3(), socket: null, weight: 1 };
		out.rightHand = { position: new Vector3(), socket: null, weight: 1 };

	}

	const L = out.leftHand, R = out.rightHand;
	L.weight = 0; R.weight = 0;
	out.weight = 1;
	const bm = boat && boat.model;
	out.steer = player && player.mode === 'boat' && bm ? ( Number.isFinite( bm.steering ) ? bm.steering : Number.isFinite( boat.steer ) ? boat.steer : 0 ) : 0;
	out.stand = null;
	if ( player && player.mode === 'boat' && HELM[ action ] && helmGrips( boat, L.position, R.position ) ) {

		L.socket = null; R.socket = null;
		L.weight = 1; R.weight = 1;
		// where the helmsman's feet go at this wheel (the avatar steps there from the helm point)
		if ( bm.helmStand ) out.stand = boat.toWorld( _p.copy( bm.helmStand ), out._stand || ( out._stand = new Vector3() ) );

	} else if ( rod && rod.equipped && ROD_GRIP[ action ] && player && player.mode !== 'swim' && player.mode !== 'boat' ) {

		// the off hand on the crank knob (it turns with rod.crank); the rod hand itself carries the rod
		crankKnobLocal( rod.crank || 0, L.position );
		L.socket = 'weapon_r';
		L.weight = 1;

	}

	return out;

}
