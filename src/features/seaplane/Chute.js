// The parachute (wave 12C, bailing out of the seaplane), pure logic plus an optional procedural canopy. It is a small
// vehicle the player enters exactly as the plane (Player.enterVehicle: toWorld, seat, eye, drive, exit, heading), so
// Player.js needs no change: the avatar hangs seated in the harness (Player.pose 'seat' in the chute's frame).
//
//   const c = new Chute( { position, velocity, heading, agl, seaAt( x, z ), groundAt( x, z ), look() -> { x, z } } );
//   c.step( dt ) -> events [ { type: 'open' } | { type: 'landed', x, y, z, mode: 'swim' | 'walk', water } ]
//   c.state 'free' | 'open' | 'landed', c.open01 (0..1 canopy), c.velocity, c.position (the harness: the pilot's feet)
//   c.vehicle (the Player.enterVehicle view), c.mesh (Group: canopy and lines, when built with a scene) / dispose()
//
// Free fall first (air drag towards ~50 m/s), the canopy opens CHUTE.delay s after the bail (at once under CHUTE.low
// metres above what is below), then the descent settles at CHUTE.sink m/s with CHUTE.drift m/s of drift towards where
// the pilot looks (look(): the camera's horizontal forward), a small pendulum swing; touching the water or the ground
// ends it ('swim' in water deeper than 1.1 m, else 'walk': the caller calls Player.exitVehicle, as the crash code does).

import { Vector3, Quaternion, Group, Mesh } from '../../engine/index.js';
import { prepare, mergePrepared, sphere, rod, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';

const G = 9.81;
export const CHUTE = {
	minAgl: 35, // m above the water / ground under the plane: lower than this there is no bailing out
	delay: 1, // s of free fall before the canopy opens
	low: 25, // m: under this the canopy opens at once
	openTime: 0.8, // s from the pull to a full canopy
	sink: 5.5, // m/s under the open canopy
	drift: 3, // m/s of steering drift towards the look direction
	freeDrag: 0.004, // 1/m: free fall settles near sqrt( g / k ) ~ 50 m/s
	swing: 0.14, // rad of pendulum swing after the opening shock
	lines: 12,
	radius: 4.2, height: 7.2, // the canopy: a shallow dome this far above the harness
};

const _y = new Vector3( 0, 1, 0 ), _x = new Vector3( 1, 0, 0 ), _z = new Vector3( 0, 0, 1 ), _q = new Quaternion(), _t = new Vector3();

// the canopy: twelve gores of a shallow dome in two colours and twelve lines down to the harness (GeoKit triangles)
export function buildCanopy() {

	const P = [], n = CHUTE.lines, R = CHUTE.radius, H = CHUTE.height, cap = 0.62;
	const rimY = H - R * 0.55 + R * Math.cos( cap ) * 0.55, rimR = R * Math.sin( cap );
	for ( let i = 0; i < n; i ++ ) {

		const g = sphere( R, 3, 5, i * Math.PI * 2 / n, Math.PI * 2 / n, 0, cap );
		P.push( prepare( g, { color: i % 2 ? 0xf2efe6 : 0xe0612f, rough: 0.85, pattern: PAT.cloth, matrix: mat4( 0, H - R * 0.55, 0, 0, 0, 0, 1, 0.55, 1 ) } ) );

	}

	for ( let i = 0; i < n; i ++ ) {

		const a = ( i + 0.5 ) * Math.PI * 2 / n;
		const top = new Vector3( Math.sin( a ) * rimR, rimY, Math.cos( a ) * rimR );
		P.push( prepare( rod( new Vector3( Math.sin( a ) * 0.18, 1.5, Math.cos( a ) * 0.12 ), top, 0.012, 3 ), { color: 0x2b2b2b, rough: 0.6 } ) );

	}

	return mergePrepared( P );

}

export class Chute {

	constructor( { position, velocity = null, heading = 0, agl = Infinity, seaAt = null, groundAt = null, look = null, scene = null } = {} ) {

		this.position = new Vector3().copy( position || _t.set( 0, 100, 0 ) );
		this.velocity = new Vector3().copy( velocity || _t.set( 0, 0, 0 ) );
		this.quaternion = new Quaternion().setFromAxisAngle( _y, heading );
		this.yaw = heading;
		this.seaAt = seaAt || ( () => 0 );
		this.groundAt = groundAt || ( () => - Infinity );
		this.look = look;
		this.t = 0;
		this.state = 'free';
		this.openAt = agl < CHUTE.low ? 0 : CHUTE.delay;
		this.open01 = 0;
		this.swingT = 0;
		this.landed = null;
		this.events = [];
		const self = this;
		// the Player's view (Player.enterVehicle): the harness is the seat, the eye over it, a short chase arm
		this.vehicle = {
			kind: 'chute',
			quaternion: this.quaternion,
			seat: [ 0, 0, 0 ],
			eye: [ 0, 1.6, 0.15 ],
			focus: [ 0, 2.6, 0 ],
			chase: 11,
			toWorld: ( l, out ) => out.set( l.x ?? l[ 0 ], l.y ?? l[ 1 ], l.z ?? l[ 2 ] ).applyQuaternion( self.quaternion ).add( self.position ),
			drive: ( dt ) => self.drive( dt ),
			exit: () => false, // (no letting go of the harness)
			prompt: () => null,
			speed: () => Math.hypot( self.velocity.x, self.velocity.z ),
			heading: () => self.yaw,
			seaLevel: () => self.seaAt( self.position.x, self.position.z ),
		};
		this.onDrive = null; // Seaplane.js: what to do with the events while the player hangs in it
		this.mesh = null;
		if ( scene ) {

			this.material = createPropMaterial( 'seaplaneChute' );
			this.geometry = buildCanopy();
			this.mesh = new Group();
			this.mesh.name = 'SeaplaneChute';
			this.canopy = new Mesh( this.geometry, this.material );
			this.canopy.castShadow = true;
			this.mesh.add( this.canopy );
			this.scene = scene;
			scene.add( this.mesh );
			this._sync();

		}

	}

	drive( dt ) {

		const ev = this.step( dt );
		if ( this.onDrive ) this.onDrive( ev );
		return ev;

	}

	step( dt ) {

		if ( this.state === 'landed' ) return [];
		dt = Math.min( dt, 0.1 );
		this.t += dt;
		const v = this.velocity;
		if ( this.state === 'free' ) {

			v.y -= G * dt;
			const sp = v.length();
			v.multiplyScalar( Math.max( 0, 1 - CHUTE.freeDrag * sp * dt ) );
			if ( this.t >= this.openAt ) {

				this.state = 'open';
				this.openT = 0;
				this.swingT = 0;
				this.events.push( { type: 'open', x: this.position.x, y: this.position.y, z: this.position.z } );

			}

		}

		if ( this.state === 'open' ) {

			this.openT += dt;
			this.open01 = Math.min( 1, this.openT / CHUTE.openTime );
			// steering: drift towards the look direction (the camera's horizontal forward)
			let lx = 0, lz = 0;
			const L = this.look ? this.look() : null;
			if ( L && Number.isFinite( L.x ) && Number.isFinite( L.z ) ) {

				const l = Math.hypot( L.x, L.z );
				if ( l > 1e-3 ) {

					lx = L.x / l;
					lz = L.z / l;

				}

			}

			const rate = 0.6 + 3.4 * this.open01;
			const k = 1 - Math.exp( - dt * rate );
			v.x += ( lx * CHUTE.drift - v.x ) * k;
			v.z += ( lz * CHUTE.drift - v.z ) * k;
			v.y += ( - CHUTE.sink - v.y ) * k;
			if ( lx || lz ) {

				let d = Math.atan2( lx, lz ) - this.yaw;
				d = Math.atan2( Math.sin( d ), Math.cos( d ) );
				this.yaw += d * ( 1 - Math.exp( - dt * 1.5 ) );

			}

			this.swingT += dt;

		}

		this.position.addScaledVector( v, dt );
		// the harness swings under the canopy after the opening shock (a damped pendulum), facing the drift
		const swing = this.state === 'open' ? CHUTE.swing * Math.exp( - this.swingT * 0.35 ) * Math.sin( this.swingT * 2.1 ) : 0;
		this.quaternion.setFromAxisAngle( _y, this.yaw ).multiply( _q.setFromAxisAngle( _x, swing ) ).multiply( _q.setFromAxisAngle( _z, swing * 0.4 * Math.cos( this.swingT * 1.3 ) ) );
		// down: in the water or on the ground
		const p = this.position;
		const sea = this.seaAt( p.x, p.z ), g = this.groundAt( p.x, p.z );
		const surface = Math.max( sea, Number.isFinite( g ) ? g : - Infinity );
		if ( p.y <= surface ) {

			const water = ! ( g > sea - 1.1 );
			this.state = 'landed';
			this.landed = { type: 'landed', x: p.x, y: water ? sea - 0.2 : Math.max( g, sea - 1.1 ), z: p.z, mode: water ? 'swim' : 'walk', water, sea, speed: v.length() };
			p.y = surface;
			this.events.push( this.landed );

		}

		this._sync();
		const e = this.events;
		this.events = [];
		return e;

	}

	_sync() {

		if ( ! this.mesh ) return;
		this.mesh.position.copy( this.position );
		this.mesh.quaternion.copy( this.quaternion );
		// the canopy blooms out of the pack
		const o = this.state === 'free' ? 0 : Math.max( 0.08, this.open01 );
		this.canopy.visible = this.state !== 'free' && this.state !== 'landed';
		this.canopy.scale.set( 0.15 + 0.85 * o, 0.35 + 0.65 * o, 0.15 + 0.85 * o );

	}

	dispose() {

		if ( this.mesh && this.scene && this.scene.remove ) this.scene.remove( this.mesh );
		if ( this.geometry && this.geometry.dispose ) this.geometry.dispose();
		if ( this.material && this.material.dispose ) this.material.dispose();
		this.mesh = null;

	}

}
