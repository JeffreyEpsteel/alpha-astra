// The pilot's side of the seaplane, pure logic (the node test drives it): stick / keys / pad -> Flight.controls with
// a light stability assist, and what a contact event means for the plane (fine, a hard bounce, a crash).
//
//   const pilot = new Pilot();
//   pilot.read( keys, pad, flight, dt );   // keys: { up, down, left, right, throttleUp, throttleDown, yawLeft, yawRight,
//                                          //         trimUp, trimDown } (bools)
//   pilot.trim (-1..1, nose up +: = / - keys, the trim wheel), pilot.engageAutopilot( flight ) / disengageAutopilot(),
//   pilot.ap { on, alt, dropped } (the autopilot holds the wings level and the altitude it was engaged at; a firm
//   stick or the water drops it and sets `dropped` for the caller's toast)
//                                          // pad: null | { pitch, roll, yaw, throttle } analogue -1..1 (throttle: rate)
//   judge( event, hp ) -> { kind: 'fine' | 'landed' | 'tookOff' | 'bounce' | 'crash' | 'scrape', severity (Crash.js:
//                           'none' | 'scrape' | 'rough' | 'wreck' | 'death'), damage, hurt, sprung, onWater, text }
//
// Keys (Seaplane.js reads them): Shift / C throttle up / down, W / S nose down / up, A / D roll (water rudder and
// rudder while taxiing), , / . rudder. Wave 5: never Ctrl (Ctrl+W closes the browser tab and a page cannot stop it). With the stick neutral the assist levels the wings and damps the pitch, so a
// released plane settles instead of spiralling in; it fades out while the player is holding the stick.

import { MathUtils } from '../../engine/index.js';
import { CRASH, assess } from './Crash.js';

const clamp = MathUtils.clamp;
const sstep = MathUtils.smoothstep;

export const PILOT = {
	throttleRate: 0.65, // lever travel per second while Shift / C is held
	stickRate: 4.0, // keyboard stick: 1/s towards the held direction (springs back faster)
	stickReturn: 6.0,
	keyPitch: 0.55, // keyboard authority (a held key is a full stick otherwise: a stall off the water)
	keyRoll: 0.8,
	levelGain: 1.4, // roll command per radian of bank (assist, stick neutral)
	rollDamp: 0.35, // per rad/s of roll rate
	pitchDamp: 0.55, // per rad/s of pitch rate
	turnRudder: 0.3, // rudder that follows the roll command (coordinated turns)
	waterYawDamp: 2.5, // on the water: rudders against the yaw rate (per rad/s), so a gust or a wave does not start a water loop
	trimRate: 0.45, // trim travel per second while = / - is held
};

// the altitude hold: a climb / sink rate towards the held altitude, the elevator after the rate error (PI)
export const AUTOPILOT = {
	altGain: 0.3, // m/s of climb per metre below the held altitude
	maxRate: 3, // m/s
	kp: 0.09, ki: 0.05, // elevator per m/s of rate error, and its integral
	maxPitch: 0.55,
	release: 0.5, // a stick held past this drops the autopilot
	stallGuard: 3 * Math.PI / 180, // rad of stall margin: below it the autopilot lowers the nose
};

// sink rate (m/s) bands at touchdown (Crash.js's CRASH holds the whole table)
export const TOUCH = { fine: CRASH.roughSink, crash: CRASH.wreckSink };
export const MAX_HP = 100;

export class Pilot {

	constructor() {

		this.stick = { pitch: 0, roll: 0, yaw: 0 }; // keyboard stick, smoothed
		this.throttle = 0;
		this.trim = 0;
		this.ap = { on: false, alt: 0, i: 0, dropped: null };

	}

	reset() {

		this.stick.pitch = this.stick.roll = this.stick.yaw = 0;
		this.throttle = 0;
		this.trim = 0;
		this.disengageAutopilot();
		this.ap.dropped = null;

	}

	// holds the current altitude with the wings level; only in the air
	engageAutopilot( flight ) {

		if ( ! flight || ! flight.airborne ) return false;
		const ap = this.ap;
		ap.on = true;
		ap.alt = flight.position.y;
		ap.i = 0;
		ap.dropped = null;
		return true;

	}

	disengageAutopilot() {

		this.ap.on = false;
		this.ap.i = 0;

	}

	// one frame of input into flight.controls
	read( keys = {}, pad = null, flight, dt ) {

		const s = this.stick;
		const ease = ( v, target ) => v + ( target - v ) * ( 1 - Math.exp( - dt * ( target === 0 ? PILOT.stickReturn : PILOT.stickRate ) ) );
		s.pitch = ease( s.pitch, ( keys.down ? 1 : 0 ) - ( keys.up ? 1 : 0 ) ); // S pulls the nose up, W pushes it down
		s.roll = ease( s.roll, ( keys.right ? 1 : 0 ) - ( keys.left ? 1 : 0 ) );
		s.yaw = ease( s.yaw, ( keys.yawRight ? 1 : 0 ) - ( keys.yawLeft ? 1 : 0 ) );
		let pitch = s.pitch * PILOT.keyPitch, roll = s.roll * PILOT.keyRoll, yaw = s.yaw;
		let thr = ( keys.throttleUp ? 1 : 0 ) - ( keys.throttleDown ? 1 : 0 );
		if ( pad ) {

			// an analogue stick beats the digital keys the pad also presses
			if ( Math.abs( pad.pitch || 0 ) > Math.abs( pitch ) ) pitch = pad.pitch;
			if ( Math.abs( pad.roll || 0 ) > Math.abs( roll ) ) roll = pad.roll;
			if ( Math.abs( pad.yaw || 0 ) > Math.abs( yaw ) ) yaw = pad.yaw;
			if ( Math.abs( pad.throttle || 0 ) > Math.abs( thr ) ) thr = pad.throttle;

		}

		this.throttle = clamp( this.throttle + thr * PILOT.throttleRate * dt, 0, 1 );
		this.trim = clamp( this.trim + ( ( keys.trimUp ? 1 : 0 ) - ( keys.trimDown ? 1 : 0 ) ) * PILOT.trimRate * dt, - 1, 1 );
		const c = flight.controls;
		c.throttle = this.throttle;
		c.trim = this.trim;
		// the autopilot lets go when the plane is back on the water or the pilot takes the stick firmly
		const ap = this.ap;
		if ( ap.on ) {

			if ( ! flight.airborne ) {

				this.disengageAutopilot();
				ap.dropped = 'water';

			} else if ( Math.max( Math.abs( s.pitch ), Math.abs( s.roll ), pad ? Math.abs( pad.pitch || 0 ) : 0, pad ? Math.abs( pad.roll || 0 ) : 0 ) > AUTOPILOT.release ) {

				this.disengageAutopilot();
				ap.dropped = 'stick';

			}

		}

		// body rates (pitch about +X, yaw about +Y, roll about +Z) from the world angular velocity
		const q = flight.quaternion, w = flight.angular;
		const rx = w.x * ( 1 - 2 * ( q.y * q.y + q.z * q.z ) ) + w.y * 2 * ( q.x * q.y + q.w * q.z ) + w.z * 2 * ( q.x * q.z - q.w * q.y );
		const rz = w.x * 2 * ( q.x * q.z + q.w * q.y ) + w.y * 2 * ( q.y * q.z - q.w * q.x ) + w.z * ( 1 - 2 * ( q.x * q.x + q.y * q.y ) );
		const ry = w.x * 2 * ( q.x * q.y - q.w * q.z ) + w.y * ( 1 - 2 * ( q.x * q.x + q.z * q.z ) ) + w.z * 2 * ( q.y * q.z + q.w * q.x );

		// taxiing: A / D steer with the water rudder (and the air rudder); the ailerons come in with airspeed
		const air = flight.airborne ? 1 : sstep( flight.airspeed, 14, 24 );
		const steer = roll;
		roll *= air;
		yaw = clamp( yaw + steer * ( 1 - air ), - 1, 1 );
		// + ry turns the nose to port (left): answer with right rudder, less while the player steers
		const wet = ( flight.onWater || flight.grounded ) && ! flight.airborne ? 1 : 0; // (wave 12: the Kestrel's nose wheel on the ground)
		const yawDamp = wet * PILOT.waterYawDamp * ry * ( 1 - Math.min( 1, Math.abs( steer + s.yaw ) * 2 ) );
		c.waterRudder = wet ? clamp( steer + s.yaw + yawDamp, - 1, 1 ) : 0;
		yaw += yawDamp;

		// the autopilot: a neutral stick for the wings (the assist below levels them) and the altitude hold's elevator
		let apPitch = 0;
		if ( ap.on ) {

			const rate = clamp( ( ap.alt - flight.position.y ) * AUTOPILOT.altGain, - AUTOPILOT.maxRate, AUTOPILOT.maxRate );
			const err = rate - flight.velocity.y;
			ap.i = clamp( ap.i + err * AUTOPILOT.ki * dt, - 0.4, 0.4 );
			apPitch = clamp( err * AUTOPILOT.kp + ap.i, - AUTOPILOT.maxPitch, AUTOPILOT.maxPitch );
			if ( ( flight.stallMargin ?? 1 ) < AUTOPILOT.stallGuard ) apPitch = Math.min( apPitch, - 0.15 );
			roll = 0;
			pitch = 0;

		}

		// assist in the air: level the wings, damp the pitch
		const hold = Math.min( 1, Math.abs( roll ) * 3 ), holdP = Math.min( 1, Math.abs( pitch ) * 3 );
		const fly = flight.airborne ? 1 : 0;
		const bank = flight.rollAngle();
		roll += fly * ( 1 - hold ) * ( - PILOT.levelGain * bank ) - fly * PILOT.rollDamp * rz;
		pitch += fly * ( 1 - holdP ) * PILOT.pitchDamp * rx; // + rx is nose-down rotation: answer with back stick
		yaw += fly * PILOT.turnRudder * roll;
		pitch += apPitch;
		c.pitch = clamp( pitch, - 1, 1 );
		c.roll = clamp( roll, - 1, 1 );
		c.yaw = clamp( yaw, - 1, 1 );
		return c;

	}

}

// what a Flight event means: touchdowns by sink rate and attitude, strikes by part, speed and what was hit. Wave 10: the
// table is Crash.js's CRASH (assess); judge keeps the older kinds for the callers ('bounce' is a rough landing,
// 'crash' a wreck or, with severity 'death', a direct collision) and adds severity, hurt (pilot health) and sprung.
export function judge( e, hp = MAX_HP, opts = {} ) {

	if ( ! e ) return { kind: 'fine', damage: 0, severity: 'none' };
	if ( e.type === 'liftoff' ) return { kind: 'tookOff', damage: 0, severity: 'none' };
	if ( e.type !== 'touch' && e.type !== 'strike' ) return { kind: 'fine', damage: 0, severity: 'none' };
	const a = assess( e, hp, opts );
	const onWater = e.type === 'touch' ? e.surface === 'water' : undefined;
	const kind = a.severity === 'none' ? ( e.type === 'touch' ? 'landed' : 'fine' ) : a.severity === 'scrape' ? 'scrape' : a.severity === 'rough' ? 'bounce' : 'crash';
	return { kind, severity: a.severity, damage: kind === 'crash' ? hp : a.damage, hurt: a.hurt, sprung: a.sprung, onWater, text: a.text, speed: a.speed };

}
