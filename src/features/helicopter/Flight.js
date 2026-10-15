// Assisted rotorcraft dynamics. +Z is forward; position.y is the skid sole.
// Small fixed substeps keep wall sweeps and downward roof crossings reliable.
import { Vector3, Quaternion, Euler } from '../../engine/index.js';

export const FLIGHT = Object.freeze( { climb: 6, descend: 2.8, cruise: 34, reverse: 14, strafe: 13, yaw: 1.05, ceiling: 800, radius: 1.65, height: 2.6 } );
const clamp = ( n, a, b ) => Math.max( a, Math.min( b, n ) );
const _e = new Euler(), _old = new Vector3();

export class RotorFlight {

	constructor( { groundAt = () => 0, collide = null, waterAt = () => 0 } = {} ) {
		this.groundAt = groundAt; this.collide = collide; this.waterAt = waterAt;
		this.position = new Vector3(); this.velocity = new Vector3(); this.quaternion = new Quaternion();
		this.yaw = 0; this.pitch = 0; this.roll = 0; this.rpm = 0; this.engineOn = false; this.starter = false;
		this.grounded = true; this.onWater = false; this.agl = 0; this.events = []; this._impactWait = 0;
		this.controls = { forward: 0, strafe: 0, yaw: 0, lift: 0, brake: false };
	}

	place( x, y, z, yaw = 0 ) {
		this.position.set( x, y, z ); this.velocity.set( 0, 0, 0 ); this.yaw = yaw;
		this.pitch = this.roll = this.rpm = 0; this.engineOn = false; this.starter = false; this.events.length = 0;
		this.quaternion.setFromEuler( _e.set( 0, yaw, 0, 'YXZ' ) );
		const floor = this.groundAt( x, z, y + 0.15 );
		this.grounded = Number.isFinite( floor ) && Math.abs( floor - y ) < 0.15;
		this.onWater = y <= this.waterAt( x, z ) && floor < this.waterAt( x, z ) - 0.15;
		this.agl = Math.max( 0, y - Math.max( floor, this.waterAt( x, z ) ) );
	}

	toWorld( l, out = new Vector3() ) {
		return out.set( l.x ?? l[ 0 ], l.y ?? l[ 1 ], l.z ?? l[ 2 ] ).applyQuaternion( this.quaternion ).add( this.position );
	}

	update( dt ) {
		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		const count = Math.ceil( Math.min( dt, 0.1 ) * 120 ), h = Math.min( dt, 0.1 ) / count;
		for ( let i = 0; i < count; i ++ ) this.step( h );
	}

	step( dt ) {
		const p = this.position, v = this.velocity, c = this.controls;
		_old.copy( p ); this._impactWait = Math.max( 0, this._impactWait - dt );
		this.rpm += ( ( this.engineOn ? 1 : this.starter ? .22 : 0 ) - this.rpm ) * ( 1 - Math.exp( - dt / ( this.engineOn || this.starter ? 1.1 : 2 ) ) );
		const powered = this.engineOn && this.rpm > 0.8 && ! this.onWater;
		const forward = c.brake ? 0 : clamp( c.forward || 0, - 1, 1 ), strafe = c.brake ? 0 : clamp( c.strafe || 0, - 1, 1 );
		if ( powered ) this.yaw += clamp( c.yaw || 0, - 1, 1 ) * FLIGHT.yaw * dt;
		this.yaw = Math.atan2( Math.sin( this.yaw ), Math.cos( this.yaw ) );
		const sn = Math.sin( this.yaw ), cs = Math.cos( this.yaw );
		const fw = forward * ( forward >= 0 ? FLIGHT.cruise : FLIGHT.reverse ), side = strafe * FLIGHT.strafe;
		const response = 1 - Math.exp( - dt * ( c.brake ? 3 : 1.05 ) );
		v.x += ( ( powered ? sn * fw + cs * side : 0 ) - v.x ) * response;
		v.z += ( ( powered ? cs * fw - sn * side : 0 ) - v.z ) * response;
		if ( powered ) {
			let vy = clamp( c.lift || 0, - 1, 1 ) * ( c.lift >= 0 ? FLIGHT.climb : FLIGHT.descend );
			if ( p.y > FLIGHT.ceiling ) vy = Math.min( vy, - 1 );
			v.y += ( vy - v.y ) * ( 1 - Math.exp( - dt * 3.2 ) );
		} else v.y = Math.max( - 45, v.y - 9.81 * dt );
		p.addScaledVector( v, dt );
		// Only surfaces at or below the previous skid height are landing candidates.
		// Crossing into a tall building is a wall collision, never a teleport to its roof.
		const floor = this.groundAt( p.x, p.z, _old.y + 0.16 ), sea = this.waterAt( p.x, p.z );
		const support = Math.max( floor, sea - 0.15 );
		const wasGrounded = this.grounded, wasContact = this.grounded || this.onWater;
		this.grounded = false; this.onWater = false;
		if ( v.y <= 0 && p.y <= support && _old.y >= support - 0.18 ) {
			const sink = Math.max( 0, - v.y ), speed = Math.hypot( v.x, v.z );
			p.y = support; v.y = 0;
			this.onWater = sea - 0.15 > floor;
			this.grounded = ! this.onWater;
			if ( ! wasContact ) this.events.push( { type: this.onWater ? 'ditched' : 'landed', sink, speed } );
			if ( this.onWater ) { this.engineOn = false; v.x *= 0.95; v.z *= 0.95; }
			else { v.x *= Math.exp( - dt * 5 ); v.z *= Math.exp( - dt * 5 ); }
		} else if ( wasGrounded && p.y > support + 0.001 ) this.events.push( { type: 'takeoff' } );
		if ( this.collide && this.collide( p, FLIGHT.radius, FLIGHT.height ) ) {
			const speed = v.length();
			v.x = v.z = 0;
			if ( this._impactWait === 0 && speed > 4 ) { this.events.push( { type: 'impact', speed } ); this._impactWait = 0.7; }
		}
		// Terrain above us is also a cliff face. A building roof is excluded by groundAt(maxY).
		const below = this.groundAt( p.x, p.z, p.y + 0.16 );
		if ( Number.isFinite( below ) && p.y < below - 0.2 ) { p.x = _old.x; p.z = _old.z; v.x = v.z = 0; }
		this.agl = Math.max( 0, p.y - Math.max( below, sea ) );
		const k = 1 - Math.exp( - dt * 4 );
		this.pitch += ( ( powered && ! this.grounded ? forward * 0.17 : 0 ) - this.pitch ) * k;
		this.roll += ( ( powered && ! this.grounded ? - strafe * 0.14 - ( c.yaw || 0 ) * 0.09 : 0 ) - this.roll ) * k;
		this.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, this.roll, 'YXZ' ) );
	}

	drainEvents() { return this.events.splice( 0 ); }

}
