// Cars for everybody (wave 22A): the cars feature (src/features/cars) in a room.
//
//   players' cars  the state's `car` (Cars.decorateState: pose, steer, speed, damage stage, lamps, horn, siren) is buffered per
//                  peer with the server's time and drawn interpolated on the remote players' clock (RemotePlayers.renderTime:
//                  the avatars' INTERP_DELAY), wheels steered and spun; the driver's avatar is not drawn (RemotePlayers
//                  peer.inCar), as the local driver is not. A peer whose state lost its `car` loses the car at once. `oc`: the
//                  cars a player owns, parked in the city; both are locked to everybody else (Cars.enter refuses them).
//   the host       runs Meridian's traffic, the police and the cars they knock loose for every player in the city (Cars
//                  netRole 'host': traffic round each guest too); it sends the guests near the city a compact snapshot
//                  (CarNet.js: lane codes for the traffic, poses for the loose cars) as the server's 'cars' message, 2 Hz
//                  (4 Hz while a pursuer is out): a key snapshot every 2 s, deltas between (only the cars the guests' own
//                  prediction would now draw wrong), never stored. A guest (netRole 'puppet') runs no traffic or police and
//                  draws the snapshot (Cars.mirror: along the lanes, at the host's lights, easing out corrections).
//   the law        each player's police level rides the state (`cw`); the host's police chase the wanted players only (the
//                  nearest one each), never an innocent guest; a guest is busted on his own client, from the pursuers he sees.
//   taking         a guest takes one of the host's stopped cars: it becomes his own record and the host's goes (world event
//                  carTaken { id: 't:<n>' | 'f:<id>' }); parked spots taken / knocked loose anywhere go everywhere (carTaken
//                  { id } or { ids }, batched per frame).
//
//   const cl = new CarLink( sync );  cl.bind( net );  cl.update( dt );  cl.role  cl.stats { out, in, bytesOut, fed, peers }

import { NET } from '../cars/CarNet.js';

export const CAR_SYNC = {
	keep: 8, // snapshots of a peer's car kept
	stale: 400, // ms past the newest sample: hold the newest pose (no extrapolation beyond)
};

const lerp = ( a, b, t ) => a + ( b - a ) * t;
const lerpAngle = ( a, b, t ) => {

	let d = b - a;
	d = ( ( d + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI;
	return a + d * t;

};

export class CarLink {

	constructor( sync ) {

		this.sync = sync;
		this.role = 'solo';
		this.stats = { out: 0, in: 0, bytesOut: 0, fed: 0, peers: 0 };
		this._acc = 0;
		this._accKey = NET.key;
		this._seenViewers = '';
		this._offs = [];
		this._buf = new Map(); // peer id -> { at, snaps: [ { t, car } ] }

	}

	get cars() {

		const f = this.sync.features;
		return f && f.get ? f.get( 'cars' ) : null;

	}

	bind( net ) {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this._buf.clear();
		this._acc = 0;
		if ( net && net.on ) this._offs.push( net.on( 'cars', ( m ) => this._onCars( m ) ) );

	}

	_onCars( m ) {

		const net = this.sync.net, cars = this.cars;
		if ( ! cars || ! m || this.role !== 'puppet' ) return;
		if ( net && net.host && m.from && m.from !== net.host ) return; // (a late one from the old host)
		const serverNow = Date.now() - ( net && Number.isFinite( net.serverOffset ) ? net.serverOffset : 0 );
		const age = Number.isFinite( m.at ) ? Math.max( 0, Math.min( 1000, serverNow - m.at ) ) / 1000 : 0;
		this.stats.in ++;
		try { cars.applySnapshot( m, age ); } catch ( e ) { /* the puppets are decoration */ }

	}

	update( dt ) {

		const net = this.sync.net, cars = this.cars;
		const role = ! net || ! net.online ? 'solo' : net.isHost ? 'host' : 'puppet';
		this.role = role;
		if ( ! cars ) return;
		if ( cars.setNetRole ) cars.setNetRole( role );
		const rp = this.sync.app.remotePlayers;
		this._feed( rp, cars );
		if ( role !== 'host' ) return;

		// the guests in the city and the wanted ones, for the host's traffic and police
		const viewers = [], targets = [];
		if ( rp && rp.peers ) for ( const [ id, p ] of rp.peers ) {

			if ( ! p.hasPose ) continue;
			const pos = p.pose.position, x = pos.x, z = pos.z;
			const v = { id, x, z };
			viewers.push( v );
			const ex = p.extra || {};
			const lv = ex.cw | 0;
			if ( lv > 0 ) {

				const c = ex.car, s = c && Number.isFinite( c.s ) ? c.s : 0, yaw = c && Array.isArray( c.q ) ? c.q[ 0 ] : 0;
				targets.push( { id, x, z, vx: Math.sin( yaw ) * s, vz: Math.cos( yaw ) * s, level: Math.min( 5, lv ) } );

			}

		}

		cars.netViewers = viewers;
		cars.netTargets = targets;
		this.stats.peers = viewers.length;
		// a snapshot every NET.every s (NET.chase while a pursuer is out): a key one every NET.key s, deltas between
		this._acc += dt;
		this._accKey += dt;
		if ( this._acc < ( cars.chasing && cars.chasing() ? NET.chase : NET.every ) ) return;
		this._acc = 0;
		const key = this._accKey >= NET.key || this._viewersChanged( viewers );
		if ( key ) this._accKey = 0;
		const snap = cars.netSnapshot ? cars.netSnapshot( viewers, { key } ) : null;
		const empty = ! snap || ( ! snap.tr.length && ! snap.fr.length && ! ( snap.gone && snap.gone.length ) );
		if ( ! snap || ( empty && this._empty ) ) return;
		this._empty = empty; // (one empty snapshot clears the guests' puppets; then silence)
		if ( net.sendMsg && net.sendMsg( { t: 'cars', ...snap } ) ) {

			this.stats.out ++;
			this.stats.bytesOut += JSON.stringify( snap ).length;

		}

	}

	// a guest came (or went): a key snapshot at once
	_viewersChanged( viewers ) {

		const sig = viewers.map( ( v ) => v.id ).sort().join( ',' );
		const changed = sig !== this._seenViewers;
		this._seenViewers = sig;
		return changed;

	}

	// the other players' cars: each new state buffered, the pose interpolated at the remote players' render time
	_feed( rp, cars ) {

		if ( ! rp || ! rp.peers || ! cars.updateRemote ) return;
		const t = rp.renderTime ? rp.renderTime() : null;
		const out = [];
		for ( const [ id, p ] of rp.peers ) {

			const ex = p.extra || {};
			let b = this._buf.get( id );
			const car = ex.car && typeof ex.car === 'object' && Array.isArray( ex.car.p ) ? ex.car : null;
			if ( ! car ) {

				if ( b && b.car ) { cars.dropRemote( id ); b.car = false; b.snaps.length = 0; }
				if ( ex.oc || ( b && b.oc ) ) out.push( { id, name: p.name, oc: ex.oc || [] } );
				if ( ! b ) this._buf.set( id, b = { at: 0, snaps: [], car: false, oc: false } );
				b.oc = !! ex.oc;
				continue;

			}

			if ( ! b ) this._buf.set( id, b = { at: 0, snaps: [], car: false, oc: false } );
			b.car = true;
			if ( p.lastAt !== b.at ) {

				b.at = p.lastAt;
				b.snaps.push( { t: p.lastAt, car } );
				if ( b.snaps.length > CAR_SYNC.keep ) b.snaps.shift();

			}

			const e = { id, name: p.name, car: this._sample( b.snaps, t ) };
			if ( ex.oc || b.oc ) e.oc = ex.oc || [];
			b.oc = !! ex.oc;
			out.push( e );

		}

		for ( const id of [ ...this._buf.keys() ] ) if ( ! rp.peers.has( id ) ) {

			this._buf.delete( id );
			cars.dropRemote( id, { owned: true } );

		}

		if ( out.length ) {

			this.stats.fed += out.length;
			try { cars.updateRemote( out ); } catch ( e ) { /* a remote car is decoration */ }

		}

	}

	// the car between the two samples round time t (the newest when t is unknown or past it)
	_sample( snaps, t ) {

		const n = snaps.length;
		const last = snaps[ n - 1 ].car;
		if ( t === null || n < 2 || t >= snaps[ n - 1 ].t ) return last;
		let i = n - 2;
		while ( i > 0 && snaps[ i ].t > t ) i --;
		const A = snaps[ i ], B = snaps[ i + 1 ];
		if ( t <= A.t ) return A.car;
		const k = ( t - A.t ) / Math.max( 1, B.t - A.t ), a = A.car, c = B.car;
		const aq = Array.isArray( a.q ) ? a.q : [ 0, 0, 0 ], cq = Array.isArray( c.q ) ? c.q : [ 0, 0, 0 ];
		return {
			...c,
			p: [ lerp( a.p[ 0 ], c.p[ 0 ], k ), lerp( a.p[ 1 ], c.p[ 1 ], k ), lerp( a.p[ 2 ], c.p[ 2 ], k ) ],
			q: [ lerpAngle( aq[ 0 ] || 0, cq[ 0 ] || 0, k ), lerp( aq[ 1 ] || 0, cq[ 1 ] || 0, k ), lerp( aq[ 2 ] || 0, cq[ 2 ] || 0, k ) ],
			s: lerp( a.s || 0, c.s || 0, k ), st: lerp( a.st || 0, c.st || 0, k ),
		};

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this._buf.clear();

	}

}
