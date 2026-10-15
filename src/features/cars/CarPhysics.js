// Arcade car physics (pure: no engine, no DOM). A body on four ray-cast wheels: each wheel samples the ground under it
// (world.ground( x, z, yRef ): the terrain, the road surface, walkable decks), the body rides the plane through them
// (pitch and roll follow the ground, so a car on a flat road can never flip; kerbs bump it, a ramp throws it), a
// bicycle-model steer with tyre grip (understeer past the grip, a handbrake slide that kicks the tail out), the engine
// and the brakes along the car, gravity along the slope, reverse, and a hold that keeps a stopped car still on a hill.
// Steps of a step higher than `maxStep` are walls (a cliff, a quay edge). world.collide( body, h ) pushes it out of solid
// things and returns the impacts ( [ { speed, x, z, nx, nz, what, id } ] ); the body keeps them in this.impacts.
//
//   const b = new CarBody( KINDS.sedan, { x, y, z, yaw } );
//   b.step( dt, { throttle 0..1, brake 0..1, steer -1..1 (+ left), handbrake: bool }, world );
//   b.x / y / z, b.yaw / pitch / roll, b.vx / vz / vy, b.speed (signed, along the nose), b.slip, b.grounded, b.spin,
//   b.steer (wheel angle), b.quat( out ) -> { x, y, z, w }, b.toWorld( lx, ly, lz, out ), b.forward(), b.left()
// Frame: yaw 0 faces +Z; forward ( sin yaw, 0, cos yaw ); +X of the model is the car's left: ( cos yaw, 0, - sin yaw ).

import { G } from './CarData.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const SUB = 1 / 90; // max sub-step (s)

export class CarBody {

	constructor( spec, { x = 0, y = 0, z = 0, yaw = 0 } = {} ) {

		this.spec = spec;
		this.x = x; this.y = y; this.z = z;
		this.yaw = yaw; this.pitch = 0; this.roll = 0;
		this.vx = 0; this.vz = 0; this.vy = 0;
		this.yawRate = 0;
		this.steer = 0;
		this.spin = 0; // wheel rotation (rad)
		this.grounded = true;
		this.slip = 0; // m/s of sideways slide (screech, smoke)
		this.bump = 0; // m: the body's suspension offset (kerbs)
		this.bumpV = 0;
		this.maxStep = spec.len > 8 ? 0.5 : 0.42;
		this.impacts = [];
		this.airT = 0;
		this.landing = 0; // m/s of the last touchdown
		this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
		this._wh = new Float64Array( 4 );
		this._prev = new Float64Array( 4 );
		this._init = false;
		this._pt = { x: 0, y: 0, z: 0 };

	}

	get speed() {

		return this.vx * Math.sin( this.yaw ) + this.vz * Math.cos( this.yaw );

	}

	forward() { return { x: Math.sin( this.yaw ), z: Math.cos( this.yaw ) }; }
	left() { return { x: Math.cos( this.yaw ), z: - Math.sin( this.yaw ) }; }

	// the four wheel contact points (model x, z): FL, FR, RL, RR
	wheelLocal( i ) {

		const s = this.spec;
		return [ ( i % 2 === 0 ? 1 : - 1 ) * s.track / 2, i < 2 ? s.wb / 2 : - s.wb / 2 ];

	}

	_groundAt( world, lx, lz, x, z, yaw, yRef ) {

		const c = Math.cos( yaw ), s = Math.sin( yaw );
		return world.ground( x + lx * c + lz * s, z - lx * s + lz * c, yRef );

	}

	// ground under the four wheels at a pose: fills this._wh, returns the mean
	_wheels( world, x, z, yaw, yRef ) {

		let sum = 0;
		for ( let i = 0; i < 4; i ++ ) {

			const [ lx, lz ] = this.wheelLocal( i );
			const h = this._groundAt( world, lx, lz, x, z, yaw, yRef );
			this._wh[ i ] = Number.isFinite( h ) ? h : - 50;
			sum += this._wh[ i ];

		}

		return sum / 4;

	}

	step( dt, input, world ) {

		this.impacts.length = 0;
		if ( input ) this.input = input;
		dt = clamp( Number.isFinite( dt ) ? dt : 0, 0, 0.1 );
		const n = Math.max( 1, Math.ceil( dt / SUB ) );
		for ( let k = 0; k < n; k ++ ) this._sub( dt / n, world );
		return this;

	}

	_sub( h, world ) {

		const S = this.spec, inp = this.input;
		if ( ! this._init ) {

			// the first step: the ground under the wheels where it stands
			this._init = true;
			const m = this._wheels( world, this.x, this.z, this.yaw, this.y + 1.2 );
			if ( ! ( this.y > m + 0.3 ) ) this.y = m;

		}

		const fx = Math.sin( this.yaw ), fz = Math.cos( this.yaw ); // forward
		const lx = fz, lz = - fx; // the car's left
		let vf = this.vx * fx + this.vz * fz;
		let vl = this.vx * lx + this.vz * lz;
		const engineOn = inp.engineOn !== false;
		const throttle = engineOn ? clamp( inp.throttle || 0, 0, 1 ) : 0, brake = clamp( inp.brake || 0, 0, 1 ), hb = !! inp.handbrake;

		// the wheels turn toward the stick, less lock as the speed rises
		const lock = S.steer / ( 1 + Math.abs( vf ) * 0.045 );
		const want = clamp( inp.steer || 0, - 1, 1 ) * lock;
		const rate = 2.6 * S.steer;
		this.steer += clamp( want - this.steer, - rate * h, rate * h );

		if ( this.grounded ) {

			// engine and brakes along the car
			let a = 0;
			if ( throttle > 0 ) {

				if ( vf < - 0.4 ) a += Math.min( S.brake, - vf / h ) * throttle; // forward on a reversing car: brakes first
				else a += S.accel * throttle * Math.max( 0, 1 - Math.max( 0, vf ) / S.top ) * ( 1 + 0.6 * Math.max( 0, 1 - Math.max( 0, vf ) / 10 ) );

			}

			if ( brake > 0 ) {

				if ( vf > 0.4 ) a -= Math.min( S.brake, vf / h ) * brake;
				else if ( engineOn && throttle === 0 && vf > - S.rev ) a -= S.accel * 0.7 * brake; // reverse
				else if ( ! engineOn && vf < - 0.05 ) a += Math.min( S.brake, - vf / h ) * brake;

			}

			if ( hb && Math.abs( vf ) > 0.2 ) a -= Math.sign( vf ) * Math.min( 5.5, Math.abs( vf ) / h );
			// gravity along the slope, rolling resistance, air drag
			a += - G * Math.sin( this.pitch );
			a -= vf * 0.04 + vf * Math.abs( vf ) * 0.42 / S.mass * 2;
			const holding = ( hb || ( throttle === 0 && brake === 0 ) || ( brake > 0 && vf > 0.05 ) ) && Math.abs( vf ) < 0.35 && Math.abs( Math.sin( this.pitch ) ) < S.grip * 0.9;
			if ( holding ) {

				vf = 0;
				a = 0;

			} else vf += a * h;
			vf = clamp( vf, - S.rev * 1.2, S.top * 1.15 );

			// yaw from the steer (bicycle model), limited by the tyres' grip
			const muG = S.grip * G;
			let yawT = vf * Math.tan( this.steer ) / S.wb;
			const need = Math.abs( yawT * vf );
			if ( need > muG && ! hb ) yawT *= muG / need; // understeer
			if ( hb && Math.abs( vf ) > 3 ) yawT *= 1.45; // the tail steps out
			this.yawRate += ( yawT - this.yawRate ) * Math.min( 1, h * ( hb ? 2.6 : 9 ) );
			// the sideways slide decays as fast as the grip allows (slowly with the rear locked)
			const latGrip = muG * ( hb ? 0.32 : 1.15 ) * h;
			const lat0 = vl;
			vl -= clamp( vl, - latGrip, latGrip );
			vl += - G * Math.sin( this.roll ) * h * ( holding ? 0 : 1 );
			if ( holding && Math.abs( vl ) < 0.4 ) vl = 0;
			this.slip = Math.abs( lat0 ) > 0.6 || ( hb && Math.abs( vf ) > 4 ) ? Math.max( Math.abs( lat0 ), hb ? Math.abs( vf ) * 0.3 : 0 ) : 0;

		} else {

			this.yawRate *= Math.exp( - h * 0.6 );
			this.slip = 0;

		}

		this.yawRate = clamp( this.yawRate, - 3.2, 3.2 );
		this.vx = fx * vf + lx * vl;
		this.vz = fz * vf + lz * vl;

		// move, then the ground under the new pose
		const ox = this.x, oz = this.z, oyaw = this.yaw;
		this.yaw += this.yawRate * h;
		this.x += this.vx * h;
		this.z += this.vz * h;
		const yRef = this.y + 1.2;
		const prev = this._prev;
		for ( let i = 0; i < 4; i ++ ) prev[ i ] = this._wh[ i ];
		let mean = this._wheels( world, this.x, this.z, this.yaw, yRef );
		// a step too high under a wheel (a quay edge, a wall of rock): blocked, like a wall. On the ground each wheel is
		// compared with its own last height (a steep road is not a wall), in the air with the body
		let wall = false;
		for ( let i = 0; i < 4; i ++ ) if ( this._wh[ i ] > ( this.grounded ? prev[ i ] : this.y ) + this.maxStep ) wall = true;
		if ( wall ) {

			const sp = Math.hypot( this.vx, this.vz );
			this.x = ox; this.z = oz; this.yaw = oyaw;
			const fwd = vf >= 0 ? 1 : - 1;
			this.impacts.push( { speed: sp, x: this.x + fx * fwd * S.len * 0.5, z: this.z + fz * fwd * S.len * 0.5, nx: - fx * fwd, nz: - fz * fwd, what: 'ground', id: null } );
			this.vx *= - 0.15; this.vz *= - 0.15; this.yawRate *= 0.3;
			mean = this._wheels( world, this.x, this.z, this.yaw, yRef );

		}

		// solid things (buildings, props, cars): pushed out, the impacts kept
		if ( world.collide ) {

			const hits = world.collide( this, h );
			if ( hits && hits.length ) for ( const e of hits ) this.impacts.push( e );

		}

		// ride the plane through the wheels
		const wb = this.spec.wb, tr = this.spec.track, w = this._wh;
		const hf = ( w[ 0 ] + w[ 1 ] ) / 2, hr = ( w[ 2 ] + w[ 3 ] ) / 2, hl = ( w[ 0 ] + w[ 2 ] ) / 2, hrt = ( w[ 1 ] + w[ 3 ] ) / 2;
		const pitchT = clamp( Math.atan2( hf - hr, wb ), - 0.6, 0.6 );
		const rollT = clamp( Math.atan2( hl - hrt, tr ), - 0.5, 0.5 );
		if ( this.grounded ) {

			const drop = this.y - mean;
			if ( drop > 0.12 + Math.abs( vf ) * h * 2 && this.vy > - 1 ) {

				// off a ledge or a crest: airborne, carrying the slope's vertical speed
				this.grounded = false;
				this.airT = 0;

			} else {

				const rise = mean - this.y;
				if ( rise > 0.02 ) { this.bumpV -= Math.min( 1.5, rise * 8 ); } // a kerb jolts the body
				// (smoothed: a kerb's jolt must not launch the car off the next crest)
				this.vy += ( clamp( h > 0 ? ( mean - this.y ) / h : 0, - 12, 12 ) - this.vy ) * 0.15;
				this.y = mean;
				this.pitch += ( pitchT - this.pitch ) * Math.min( 1, h * 14 );
				this.roll += ( rollT - this.roll ) * Math.min( 1, h * 14 );

			}

		}

		if ( ! this.grounded ) {

			this.airT += h;
			this.vy -= G * h;
			this.y += this.vy * h;
			this.pitch *= Math.exp( - h * 0.4 );
			this.roll *= Math.exp( - h * 0.8 );
			if ( this.y <= mean ) {

				this.landing = - this.vy;
				if ( this.landing > 7 ) this.impacts.push( { speed: this.landing * 0.7, x: this.x, z: this.z, nx: 0, nz: 0, what: 'landing', id: null } );
				this.bumpV -= Math.min( 3, this.landing * 0.25 );
				this.y = mean;
				this.vy = 0;
				this.grounded = true;

			}

		}

		// the suspension's bounce (visual only), the wheels' spin
		this.bumpV += ( - this.bump * 160 - this.bumpV * 14 ) * h;
		this.bump = clamp( this.bump + this.bumpV * h, - 0.12, 0.12 );
		this.spin += ( this.speed / this.spec.r ) * h;

	}

	// unit quaternion of yaw (Y), then pitch (nose up), then roll (left side up)
	quat( out = { x: 0, y: 0, z: 0, w: 1 } ) {

		return quatYPR( this.yaw, this.pitch, this.roll, out );

	}

	// a model-frame point to world
	toWorld( lx, ly, lz, out = { x: 0, y: 0, z: 0 } ) {

		const q = this.quat( _q );
		rotate( q, lx, ly, lz, out );
		out.x += this.x; out.y += this.y + this.bump; out.z += this.z;
		return out;

	}

	// a hard stop (a respawn, a teleport)
	place( x, y, z, yaw ) {

		this.x = x; this.y = y; this.z = z; this.yaw = yaw;
		this.vx = this.vz = this.vy = 0;
		this.yawRate = 0;
		this.pitch = this.roll = 0;
		this.grounded = true;
		this.steer = 0;
		this._init = false;

	}

}

const _q = { x: 0, y: 0, z: 0, w: 1 };

// q = Ry( yaw ) * Rx( - pitch ) * Rz( roll ): nose up is a negative turn about +X in a +Z-forward frame
export function quatYPR( yaw, pitch, roll, out = { x: 0, y: 0, z: 0, w: 1 } ) {

	const cy = Math.cos( yaw / 2 ), sy = Math.sin( yaw / 2 );
	const cp = Math.cos( - pitch / 2 ), sp = Math.sin( - pitch / 2 );
	const cr = Math.cos( roll / 2 ), sr = Math.sin( roll / 2 );
	// Ry * Rx
	const ax = cy * sp, ay = sy * cp, az = - sy * sp, aw = cy * cp;
	// ( Ry * Rx ) * Rz
	out.x = ax * cr + ay * sr;
	out.y = ay * cr - ax * sr;
	out.z = aw * sr + az * cr;
	out.w = aw * cr - az * sr;
	return out;

}

export function rotate( q, x, y, z, out ) {

	const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = - q.x * x - q.y * y - q.z * z;
	out.x = ix * q.w + iw * - q.x + iy * - q.z - iz * - q.y;
	out.y = iy * q.w + iw * - q.y + iz * - q.x - ix * - q.z;
	out.z = iz * q.w + iw * - q.z + ix * - q.y - iy * - q.x;
	return out;

}
