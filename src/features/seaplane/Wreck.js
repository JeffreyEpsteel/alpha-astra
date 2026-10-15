// A seaplane wreck (wave 10), pure logic: the fuselage and the parts it shed as free bodies. Each part flies a few
// seconds (ballistic, air drag, a tumble), splashes into the water and floats there planks-style (a bob on the swell, a
// slow drift, settling flat), then sinks; on land it comes to rest and stays. The fuselage floats CRASH.afloat seconds
// (seeded: 60-120), lists towards a missing float, then goes down by the nose over CRASH.sinkTime. Seaplane.js owns one,
// draws it through PlaneVisual.detach() and plays its events (splash / land / sinking / sunk) as effects.
//
//   const w = new Wreck( { position, quaternion, velocity, angular, detach: [ 'wingL', 'wingR', 'floatR' ], seed } );
//   w.detach( name ) -> bool (once per part)     w.update( dt, { seaAt( x, z, i ), groundAt( x, z ) } ) -> events
//   w.bodies (Map name -> body { name, c, q, v, w, state: 'flying' | 'afloat' | 'sinking' | 'aground' | 'gone' })
//   w.fuselage, w.sunk, w.t, w.x / y / z / yaw (the fuselage), w.parts -> [ { name, x, y, z, state } ]
//   w.pose( name, outPosition, outQuaternion ) -> bool: the transform for a group whose geometry is in the model frame
//   with its origin at PARTS[ name ].origin (the plane's origin; the propeller's pivot at the hub)

import { Vector3, Quaternion } from '../../engine/index.js';
import { GEOM } from './Flight.js';
import { CRASH } from './Crash.js';

const G = 9.81;
const _a = new Vector3(), _b = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _up = new Vector3( 0, 1, 0 );

// model-frame centres; float: the centre's height over the water afloat; rest: over the ground; life: s afloat (range)
export const PARTS = {
	fuselage: { c: GEOM.com, float: 0.75, rest: 1.05, size: 2.2 },
	wingL: { c: [ 3.7, 3.3, 0.6 ], float: 0.12, rest: 0.12, life: [ 35, 55 ], size: 0.6 },
	wingR: { c: [ - 3.7, 3.3, 0.6 ], float: 0.12, rest: 0.12, life: [ 35, 55 ], size: 0.6 },
	tail: { c: [ 0, 2.9, - 5.3 ], float: 0.15, rest: 0.35, life: [ 25, 40 ], size: 1.0 },
	floatL: { c: [ GEOM.floatX, 0.32, - 0.2 ], float: 0.22, rest: 0.3, life: [ 80, 140 ], size: 0.6 },
	floatR: { c: [ - GEOM.floatX, 0.32, - 0.2 ], float: 0.22, rest: 0.3, life: [ 80, 140 ], size: 0.6 },
	prop: { c: GEOM.prop, origin: GEOM.prop, float: - 0.3, rest: 0.25, life: [ 0, 0.5 ], size: 0.5, sinkTime: 3 },
};

export const PART_NAMES = Object.keys( PARTS );

// wave 12: the parts' centres on the other airframes (Airframes.js; the same names: the Albatross's floats are its
// wingtip floats, the Kestrel's its main gear legs); new Wreck( { ..., airframe } )
const VARIANT = {
	petrel: { wingL: { c: [ 3.0, 3.3, 0.6 ] }, wingR: { c: [ - 3.0, 3.3, 0.6 ] }, floatL: { c: [ 1.2, 0.3, - 0.2 ] }, floatR: { c: [ - 1.2, 0.3, - 0.2 ] } },
	albatross: { fuselage: { c: [ 0, 1.6, - 0.1 ], float: 1.0, rest: 0.8, size: 2.8 }, wingL: { c: [ 4.8, 3.35, 0.5 ] }, wingR: { c: [ - 4.8, 3.35, 0.5 ] }, tail: { c: [ 0, 3.2, - 6.6 ] }, floatL: { c: [ 7.2, 1.2, 0.1 ] }, floatR: { c: [ - 7.2, 1.2, 0.1 ] }, prop: { c: [ 2.7, 3.05, 2.75 ], origin: [ 2.7, 3.05, 2.75 ] } },
	kestrel: { fuselage: { c: [ 0, 1.75, 0.1 ] }, floatL: { c: [ 1.3, 0.45, - 0.35 ] }, floatR: { c: [ - 1.3, 0.45, - 0.35 ] } },
};

export function partsFor( airframe = 'jade' ) {

	const v = VARIANT[ airframe ];
	if ( ! v ) return PARTS;
	const out = {};
	for ( const n of PART_NAMES ) out[ n ] = { ...PARTS[ n ], ...( v[ n ] || {} ) };
	return out;

}

// a small seeded random (mulberry32): the same crash breaks the same way
export function seeded( seed = 1 ) {

	let a = ( seed >>> 0 ) || 1;
	return () => {

		a = ( a + 0x6D2B79F5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export class Wreck {

	constructor( { position, quaternion, velocity = null, angular = null, detach = [], seed = 1, afloat = null, airframe = 'jade' } = {} ) {

		this.rand = seeded( seed );
		this.airframe = airframe;
		this.P = partsFor( airframe );
		this.t = 0;
		this.bodies = new Map();
		this.detached = new Set();
		this.sunk = false;
		this.events = [];
		const r = this.rand, [ a0, a1 ] = CRASH.afloat;
		const q = new Quaternion().copy( quaternion || _q.identity() );
		const local = new Vector3( ...this.P.fuselage.c );
		const c = local.clone().applyQuaternion( q ).add( position || _a.set( 0, 0, 0 ) );
		// the fuselage keeps a third of the plane's way (the impact took the rest) and a slow tumble
		const v = velocity ? velocity.clone().multiplyScalar( 0.35 ) : new Vector3();
		v.y = Math.max( v.y, - 3 );
		const w = angular ? angular.clone().multiplyScalar( 0.3 ) : new Vector3();
		this.fuselage = this._body( 'fuselage', c, q, v, w, Number.isFinite( afloat ) ? afloat : a0 + ( a1 - a0 ) * r() );
		for ( const n of detach ) this.detach( n );

	}

	_body( name, c, q, v, w, life ) {

		const P = this.P[ name ];
		const b = {
			name, c, q, v, w, life, state: 'flying', t: 0, sinkT: 0, phase: this.rand() * 6.28,
			local: new Vector3( ...P.c ), origin: new Vector3( ...( P.origin || [ 0, 0, 0 ] ) ),
			float: P.float, rest: P.rest, size: P.size, sinkTime: P.sinkTime || CRASH.sinkTime, list: 0,
		};
		this.bodies.set( name, b );
		return b;

	}

	// tear a part off the fuselage (once): it leaves from where it was with the fuselage's way plus a kick outwards
	detach( name ) {

		const P = this.P[ name ];
		if ( ! P || name === 'fuselage' || this.detached.has( name ) ) return false;
		const f = this.fuselage, r = this.rand;
		this.detached.add( name );
		const local = _a.set( ...P.c );
		const c = local.clone().sub( f.local ).applyQuaternion( f.q ).add( f.c );
		const out = c.clone().sub( f.c );
		out.y = 0;
		if ( out.lengthSq() < 0.01 ) out.set( r() - 0.5, 0, r() - 0.5 );
		out.normalize().multiplyScalar( 3 + 3 * r() );
		const v = f.v.clone().multiplyScalar( 1.3 ).add( out );
		v.y = Math.max( 0, v.y ) + 2 + 3 * r();
		const w = new Vector3( r() - 0.5, r() - 0.5, r() - 0.5 ).multiplyScalar( 6 );
		const [ l0, l1 ] = P.life;
		this._body( name, c, f.q.clone(), v, w, l0 + ( l1 - l0 ) * r() );
		// the fuselage lists towards a missing float
		if ( name === 'floatL' ) f.list -= 0.2;
		if ( name === 'floatR' ) f.list += 0.2;
		return true;

	}

	get x() { return this.fuselage.c.x; }
	get y() { return this.fuselage.c.y; }
	get z() { return this.fuselage.c.z; }
	get yaw() {

		const f = _b.set( 0, 0, 1 ).applyQuaternion( this.fuselage.q );
		return Math.atan2( f.x, f.z );

	}

	get parts() {

		const out = [];
		for ( const b of this.bodies.values() ) out.push( { name: b.name, x: b.c.x, y: b.c.y, z: b.c.z, state: b.state } );
		return out;

	}

	// the transform of the group that draws a part (its geometry in the model frame, its origin at PARTS.origin)
	pose( name, outP, outQ ) {

		const b = this.bodies.get( name );
		if ( ! b ) return false;
		outQ.copy( b.q );
		outP.copy( b.origin ).sub( b.local ).applyQuaternion( b.q ).add( b.c );
		return b.state !== 'gone';

	}

	// env: { seaAt( x, z, i ) (the water there; i: the body's index), groundAt( x, z ) }
	update( dt, env = {} ) {

		dt = Math.min( dt, 0.1 );
		this.t += dt;
		const seaAt = env.seaAt || ( () => 0 ), groundAt = env.groundAt || ( () => - Infinity );
		let i = 0;
		for ( const b of this.bodies.values() ) {

			const sea = seaAt( b.c.x, b.c.z, i ++ );
			const g = groundAt( b.c.x, b.c.z );
			this._step( b, dt, Number.isFinite( sea ) ? sea : 0, Number.isFinite( g ) ? g : - Infinity );

		}

		if ( this.fuselage.state === 'gone' ) this.sunk = true;
		const e = this.events;
		this.events = [];
		return e;

	}

	_step( b, dt, sea, ground ) {

		if ( b.state === 'gone' ) return;
		b.t += dt;
		if ( b.state === 'aground' ) {

			// at rest on the ground: settles onto its belly over a second (a tumbling part does not stay on its tip)
			if ( b.t < 3 ) this._settle( b, dt, 0, 2.5 );
			return;

		}

		const land = ground > sea - 0.4;
		if ( b.state === 'flying' ) {

			b.v.y -= G * dt;
			b.v.multiplyScalar( Math.exp( - dt * 0.12 ) );
			b.c.addScaledVector( b.v, dt );
			this._spin( b, dt );
			b.w.multiplyScalar( Math.exp( - dt * 0.4 ) );
			if ( land && b.c.y <= ground + b.rest ) {

				b.c.y = ground + b.rest;
				this.events.push( { type: 'land', name: b.name, x: b.c.x, y: ground, z: b.c.z, strength: Math.min( 2, 0.4 + b.v.length() / 12 ) } );
				b.v.set( 0, 0, 0 );
				b.w.set( 0, 0, 0 );
				b.state = 'aground';
				b.t = 0;

			} else if ( ! land && b.c.y <= sea + b.float ) {

				this.events.push( { type: 'splash', name: b.name, x: b.c.x, y: sea, z: b.c.z, strength: Math.min( 2, 0.4 + Math.abs( b.v.y ) / 6 + b.v.length() / 25 ) } );
				b.v.y *= 0.15;
				b.v.x *= 0.5;
				b.v.z *= 0.5;
				b.w.multiplyScalar( 0.3 );
				b.state = b.life <= 0 ? 'sinking' : 'afloat';
				b.t = 0;
				if ( b.state === 'sinking' ) this.events.push( { type: 'sinking', name: b.name, x: b.c.x, y: sea, z: b.c.z } );

			}

			return;

		}

		// afloat / sinking: a spring to the float line on the swell (deeper while sinking), water drag, settling level
		let depth = 0;
		if ( b.state === 'sinking' ) {

			b.sinkT += dt;
			const k = Math.min( 1, b.sinkT / b.sinkTime );
			depth = Math.pow( k, 1.5 ) * ( b.size + b.float + 2.5 );
			if ( k >= 1 ) {

				b.state = 'gone';
				this.events.push( { type: 'sunk', name: b.name, x: b.c.x, y: sea, z: b.c.z } );
				return;

			}

		} else if ( b.t > b.life ) {

			b.state = 'sinking';
			b.sinkT = 0;
			this.events.push( { type: 'sinking', name: b.name, x: b.c.x, y: sea, z: b.c.z } );

		}

		const bob = 0.07 * Math.sin( this.t * 1.35 + b.phase );
		const ty = sea + b.float + bob - depth;
		b.v.y += ( ( ty - b.c.y ) * 7 - b.v.y * 3.5 ) * dt;
		const drag = Math.exp( - dt * 0.7 );
		b.v.x *= drag;
		b.v.z *= drag;
		b.c.addScaledVector( b.v, dt );
		b.w.multiplyScalar( Math.exp( - dt * 2.5 ) );
		this._spin( b, dt );
		const pitch = b.state === 'sinking' && b.name === 'fuselage' ? 0.45 * Math.min( 1, b.sinkT / b.sinkTime * 1.5 ) : 0;
		this._settle( b, dt, pitch, 1.2, 1 );
		// drifted onto a beach: it stays there
		if ( land && ground + b.rest >= b.c.y ) {

			b.c.y = ground + b.rest;
			b.v.set( 0, 0, 0 );
			b.state = 'aground';
			b.t = 0;

		}

	}

	// turn towards level on the heading it has: nose down by `pitch` (rad), its list, a slow roll on the swell (`swell`)
	_settle( b, dt, pitch, rate, swell = 0 ) {

		const f = _b.set( 0, 0, 1 ).applyQuaternion( b.q );
		_q.setFromAxisAngle( _up, Math.atan2( f.x, f.z ) );
		// (+X rotation tips the +Z nose down)
		_q2.setFromAxisAngle( _a.set( 1, 0, 0 ), pitch + swell * 0.04 * Math.sin( this.t * 0.9 + b.phase ) );
		_q.multiply( _q2 );
		_q2.setFromAxisAngle( _a.set( 0, 0, 1 ), b.list + swell * 0.05 * Math.sin( this.t * 1.1 + b.phase * 1.7 ) );
		_q.multiply( _q2 );
		b.q.slerp( _q, 1 - Math.exp( - dt * rate ) );

	}

	_spin( b, dt ) {

		const ang = b.w.length() * dt;
		if ( ang > 1e-6 ) {

			_q2.setFromAxisAngle( _a.copy( b.w ).normalize(), ang );
			b.q.premultiply( _q2 ).normalize();

		}

	}

}
