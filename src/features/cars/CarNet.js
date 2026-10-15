// The cars in multiplayer (wave 22A): the room's host runs the city's traffic, its police and the cars they knock loose; the
// others draw them as puppets from a compact snapshot (netsync/CarLink.js sends it 2 - 4 times a second through the server's
// 'cars' message). Pure: no engine, no DOM.
//
//   traffic   [ id, kc, L, N, s, v ] per car: the number of its id ('c12' -> 12), kc = ( stage * 8 + kind ) * 16 + paint, the
//             lane it is on (a lane code: edge index, direction, lane) and the next one (-1: none), s along L in dm (past
//             L's length: in the turn into N), v in dm/s. The puppet runs on along its lanes (the same RoadGraph from the
//             same plan) and stops at the host's red lights (the snapshot carries the traffic clock), so 2 Hz is enough.
//   free      [ id, kc, x, z, yaw, v, flags ] per loose car (a pursuer, one knocked loose, a wreck): dm, centiradians, dm/s;
//             flags 1 lamps, 2 pursuit (beacons), 4 a driver aboard, 8 a wreck. Dead-reckoned along its heading between snapshots.
//   A puppet eases out of the error a new snapshot shows (no snap), and goes when a snapshot leaves it out.
//   Deltas: a key snapshot (every traffic car near a guest) every NET.key s; in between only the traffic cars the guests would
//   now draw wrong (the host runs the guests' own prediction on a shadow Mirror: another lane, > 1 m along it, a new speed),
//   with `gone` (the ids that left) and d: 1. The loose cars are all in every snapshot (a few at most).
//
//   encodeSnapshot( cars, viewers, { reach, key, shadow } ) -> { tm, tr, fr } | { tm, tr, fr, d: 1, gone }   (host)
//   const m = new Mirror( cars );  m.apply( snap, ageSeconds );  m.update( dt );  m.records (Map key -> record)  m.clear()

import { KIND_IDS, KINDS, PAINTS, paintFor } from './CarData.js';
import { quatYPR } from './CarPhysics.js';

export const NET = {
	every: 0.5, // s between two snapshots
	chase: 0.25, // s between two while a pursuer is out
	key: 2, // s between two key snapshots (every car; a late joiner has all of them by then)
	slip: 1, // m along the lane the guests' prediction may be off before the car is sent again
	reach: 260, // m round a guest: the cars it is sent (the far ones are specks; the parked ones are drawn to 230 m)
	maxTraffic: 60, maxFree: 16,
	ease: 5, // 1/s: how fast a puppet works off a correction
	stale: 3, // s without a snapshot: the puppets go
	lead: 0.6, // s a loose car is dead-reckoned at most
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const _p = { x: 0, y: 0, z: 0 };

// ------------------------------------------------------------------ lane codes

function edgeIndex( graph ) {

	if ( ! graph._netIdx ) {

		const ids = [ ...graph.edges.keys() ];
		graph._netIdx = { ids, at: new Map( ids.map( ( id, i ) => [ id, i ] ) ) };

	}

	return graph._netIdx;

}

export function laneCode( graph, L ) {

	if ( ! L ) return - 1;
	const i = edgeIndex( graph ).at.get( L.edge );
	return i === undefined ? - 1 : ( i * 2 + ( L.dir > 0 ? 1 : 0 ) ) * 4 + Math.min( 3, L.k | 0 );

}

export function laneOf( graph, code ) {

	if ( ! Number.isInteger( code ) || code < 0 ) return null;
	const id = edgeIndex( graph ).ids[ code >> 3 ];
	if ( id === undefined ) return null;
	const dir = ( code >> 2 ) & 1 ? 1 : - 1, k = code & 3;
	if ( ! graph.lanes( id, dir ) ) return null;
	return graph.lane( id, dir, Math.min( k, graph.lanes( id, dir ) - 1 ) );

}

export function kindCode( rec ) {

	const k = Math.max( 0, KIND_IDS.indexOf( rec.kind ) );
	const pi = PAINTS.indexOf( rec.color );
	return ( Math.min( 3, rec.stage | 0 ) * 8 + k ) * 16 + ( pi < 0 ? 15 : pi );

}

export function kindOf( kc ) {

	const kind = KIND_IDS[ ( kc >> 4 ) & 7 ] || 'sedan';
	const pi = kc & 15;
	return { kind, stage: ( kc >> 7 ) & 3, color: pi < PAINTS.length ? PAINTS[ pi ] : paintFor( kind, 0 ) };

}

// the lane a traffic car takes after this one (without planning: the route's next step)
function nextLane( graph, a ) {

	const n = a.path && a.path[ 0 ];
	if ( ! n ) return null;
	const per = graph.lanes( n.edge, n.dir );
	return per ? graph.lane( n.edge, n.dir, Math.min( a.L.k, per - 1 ) ) : null;

}

// ------------------------------------------------------------------ the host's side

// viewers: [ { x, z } ] the guests near the city; the cars within reach of one of them
export function encodeSnapshot( cars, viewers, { reach = NET.reach, key = true, shadow = null } = {} ) {

	const g = cars.graph, tr = [], fr = [], R2 = reach * reach, sent = new Set();
	const near = ( r ) => viewers.some( ( v ) => ( r.x - v.x ) ** 2 + ( r.z - v.z ) ** 2 < R2 );
	for ( const c of cars.traffic.cars ) {

		if ( sent.size >= NET.maxTraffic ) break;
		const a = c.ai;
		if ( ! a || ! near( c ) ) continue;
		const n = Number( String( c.id ).replace( /^c/, '' ) );
		if ( ! Number.isInteger( n ) ) continue;
		const L = a.turn ? a.turn.from : a.L, N = a.turn ? a.turn.to : nextLane( g, a );
		const s = a.turn ? L.len + a.ts : a.s, lc = laneCode( g, L );
		if ( lc < 0 ) continue;
		sent.add( 't:' + n );
		const e = [ n, kindCode( c ), lc, laneCode( g, N ), Math.round( s * 10 ), Math.round( clamp( a.v, 0, 99 ) * 10 ) ];
		// a delta leaves out the cars the guests already draw right
		const was = ! key && shadow ? shadow.records.get( 't:' + n ) : null;
		if ( was && ! drifted( g, was, e ) ) continue;
		tr.push( e );

	}

	for ( const r of cars.records ) {

		if ( fr.length >= NET.maxFree ) break;
		if ( r.own || r.state === 'parked' || r.state === 'player' || r.state === 'remote' || r.sunk || ! near( r ) ) continue;
		if ( r.state !== 'pursuit' && r.state !== 'idle' && r.state !== 'wreck' ) continue;
		const v = r.body ? r.body.speed : r.speed || 0;
		const flags = ( r.lights ? 1 : 0 ) | ( r.state === 'pursuit' ? 2 : 0 ) | ( r.driver ? 4 : 0 ) | ( r.stage >= 4 ? 8 : 0 );
		fr.push( [ String( r.id ).slice( 0, 12 ), kindCode( r ), Math.round( r.x * 10 ), Math.round( r.z * 10 ), Math.round( Math.atan2( Math.sin( r.yaw ), Math.cos( r.yaw ) ) * 100 ), Math.round( clamp( v, - 99, 99 ) * 10 ), flags ] );

	}

	const tm = Math.round( cars.traffic.time * 100 ) / 100;
	let snap = { tm, tr, fr };
	if ( ! key && shadow ) {

		const gone = [];
		for ( const k of shadow.records.keys() ) if ( k[ 0 ] === 't' && ! sent.has( k ) && gone.length < NET.maxTraffic ) gone.push( Number( k.slice( 2 ) ) );
		snap = { tm, tr, fr, d: 1, gone };

	}

	// the host keeps the guests' view: its next delta is measured against it
	if ( shadow ) shadow.apply( snap, 0 );
	return snap;

}

// would the guests draw this car wrong now? (their puppet `was` against the host's entry e)
function drifted( g, was, e ) {

	const m = was.m, kc = kindCode( was );
	if ( kc !== e[ 1 ] || ! m.L ) return true;
	if ( laneCode( g, m.L ) !== e[ 2 ] ) return true;
	if ( laneCode( g, m.N ) !== e[ 3 ] ) return true;
	return Math.abs( m.s * 10 - e[ 4 ] ) > NET.slip * 10 || Math.abs( m.v * 10 - e[ 5 ] ) > 8;

}

// ------------------------------------------------------------------ the guests' side

export class Mirror {

	constructor( cars ) {

		this.cars = cars;
		this.records = new Map(); // 't:12' / 'f:<id>' -> record (state 'mirror')
		this.taken = new Set(); // keys this client took (its own car now: later snapshots leave them out)
		this.time = 0; // the host's traffic clock (the lights)
		this.since = Infinity; // s since the last snapshot
		this.stats = { applied: 0, cars: 0 };

	}

	get graph() { return this.cars.graph; }

	clear() {

		this.records.clear();
		this.since = Infinity;

	}

	// snap: { tm, tr, fr }; age: s since the host sent it
	apply( snap, age = 0 ) {

		if ( ! snap || typeof snap !== 'object' ) return 0;
		age = clamp( Number( age ) || 0, 0, 1 );
		const seen = new Set(), delta = !! snap.d;
		if ( Number.isFinite( snap.tm ) ) this.time = snap.tm + age;
		for ( const e of Array.isArray( snap.tr ) ? snap.tr : [] ) {

			if ( ! Array.isArray( e ) || e.length < 6 || ! e.every( Number.isFinite ) ) continue;
			const key = 't:' + e[ 0 ];
			if ( this.taken.has( key ) ) continue;
			const L = laneOf( this.graph, e[ 2 ] );
			if ( ! L ) continue;
			seen.add( key );
			const r = this._get( key, 'c' + e[ 0 ], e[ 1 ] );
			const m = r.m;
			const was = m.placed ? { x: r.x, z: r.z } : null;
			m.free = false;
			m.L = L;
			m.N = laneOf( this.graph, e[ 3 ] );
			m.s = e[ 4 ] / 10;
			m.v = Math.max( 0, e[ 5 ] / 10 );
			m.turn = null;
			r.driver = true;
			this._advance( r, age );
			this._place( r, was );

		}

		for ( const e of Array.isArray( snap.fr ) ? snap.fr : [] ) {

			if ( ! Array.isArray( e ) || e.length < 7 || typeof e[ 0 ] !== 'string' || ! e.slice( 1 ).every( Number.isFinite ) ) continue;
			const key = 'f:' + e[ 0 ];
			if ( this.taken.has( key ) ) continue;
			seen.add( key );
			const r = this._get( key, e[ 0 ], e[ 1 ] );
			const m = r.m;
			const was = m.placed ? { x: r.x, z: r.z } : null;
			m.free = true;
			m.x = e[ 2 ] / 10; m.z = e[ 3 ] / 10; m.yaw = e[ 4 ] / 100; m.v = e[ 5 ] / 10; m.t = age;
			r.stage = e[ 6 ] & 8 ? 4 : ( e[ 1 ] >> 7 ) & 3;
			r.lights = !! ( e[ 6 ] & 1 );
			r.pursuit = !! ( e[ 6 ] & 2 );
			r.driver = !! ( e[ 6 ] & 4 );
			this._place( r, was );

		}

		// (a delta speaks for the loose cars and the traffic it names: the rest of the traffic runs on, but for `gone`)
		for ( const k of [ ...this.records.keys() ] ) if ( ! seen.has( k ) && ( ! delta || k[ 0 ] === 'f' ) ) this.records.delete( k );
		if ( delta && Array.isArray( snap.gone ) ) for ( const n of snap.gone ) this.records.delete( 't:' + n );
		this.since = 0;
		this.stats.applied ++;
		this.stats.cars = this.records.size;
		return this.records.size;

	}

	_get( key, id, kc ) {

		const { kind, stage, color } = kindOf( kc );
		let r = this.records.get( key );
		if ( ! r || r.kind !== kind ) {

			r = this.cars._record( kind, { state: 'mirror', id: 'm:' + id, color } );
			r.netKey = key;
			r.m = { placed: false, ex: 0, ez: 0, s: 0, v: 0, L: null, N: null, turn: null, free: false };
			this.records.set( key, r );

		}

		r.color = color;
		r.stage = stage;
		return r;

	}

	// a new pose: the old drawn one minus the new is the error to ease out
	_place( r, was ) {

		const m = r.m;
		this._pose( r );
		if ( was ) {

			m.ex += was.x - r.x; m.ez += was.z - r.z;
			// (a jump this large is a teleport or a lane change at a junction: no easing across a block)
			if ( m.ex * m.ex + m.ez * m.ez > 400 ) m.ex = m.ez = 0;

		}

		m.placed = true;
		r.x += m.ex; r.z += m.ez;

	}

	// along the lanes: L, the turn into N, N; stops at a red light at L's end
	_advance( r, dt ) {

		const m = r.m, g = this.graph;
		if ( m.free ) { m.t = Math.min( NET.lead, m.t + dt ); return; }
		if ( ! m.L ) return;
		let s = m.s + m.v * dt;
		if ( s > m.L.len - 0.5 && m.s <= m.L.len && m.N ) {

			// the host's lights: no puppet runs a red one it was waiting at
			const lt = g.light( m.L.to, m.L.edge, this.time );
			if ( lt === 'red' && m.s < m.L.len - 0.1 && m.v < 4 ) { s = Math.min( s, m.L.len ); }

		}

		if ( ! m.N ) s = Math.min( s, m.L.len );
		else if ( s > m.L.len ) {

			if ( ! m.turn ) m.turn = g.turn( m.L, m.N );
			if ( s > m.L.len + m.turn.len ) {

				// into N (and no further: the next snapshot says where it goes then)
				const s2 = Math.min( s - m.L.len - m.turn.len, m.N.len );
				m.L = m.N; m.N = null; m.turn = null;
				s = s2;

			}

		}

		m.s = s;

	}

	_pose( r ) {

		const m = r.m, g = this.graph;
		if ( m.free ) {

			const lead = Math.min( NET.lead, m.t );
			r.x = m.x + Math.sin( m.yaw ) * m.v * lead;
			r.z = m.z + Math.cos( m.yaw ) * m.v * lead;
			r.yaw = m.yaw;
			r.speed = r.stage >= 4 ? 0 : m.v;

		} else if ( m.L ) {

			if ( m.s > m.L.len && m.N ) {

				if ( ! m.turn ) m.turn = g.turn( m.L, m.N );
				const t = clamp( ( m.s - m.L.len ) / m.turn.len, 0, 1 ), u = 1 - t, T = m.turn;
				r.x = u * u * T.p0.x + 2 * u * t * T.p1.x + t * t * T.p2.x;
				r.z = u * u * T.p0.z + 2 * u * t * T.p1.z + t * t * T.p2.z;
				const dx = 2 * u * ( T.p1.x - T.p0.x ) + 2 * t * ( T.p2.x - T.p1.x ), dz = 2 * u * ( T.p1.z - T.p0.z ) + 2 * t * ( T.p2.z - T.p1.z );
				if ( dx * dx + dz * dz > 1e-6 ) r.yaw = Math.atan2( dx, dz );
				r.steer = clamp( ( T.to.dx * T.from.dz - T.to.dz * T.from.dx ) * - 0.5, - 0.5, 0.5 );

			} else {

				g.pointOn( m.L, m.s, _p );
				r.x = _p.x; r.z = _p.z;
				r.yaw = Math.atan2( m.L.dx, m.L.dz );
				r.steer *= 0.8;

			}

			r.speed = m.v;

		}

		const y = this.cars._roadY( r.x, r.z );
		r.y = Number.isFinite( y ) ? y : r.y;

	}

	update( dt ) {

		this.since += dt;
		this.time += dt;
		if ( this.since > NET.stale && this.records.size ) this.records.clear();
		const k = Math.exp( - NET.ease * dt );
		for ( const r of this.records.values() ) {

			const m = r.m;
			this._advance( r, dt );
			this._pose( r );
			m.ex *= k; m.ez *= k;
			r.x += m.ex; r.z += m.ez;
			r.spin += ( r.speed / r.spec.r ) * dt;
			quatYPR( r.yaw, 0, 0, r.quat );

		}

	}

	// this client took a puppet: it is its own car from now on
	take( r ) {

		if ( ! r || ! r.netKey ) return null;
		this.taken.add( r.netKey );
		this.records.delete( r.netKey );
		return r.netKey;

	}

}

export { KINDS };
