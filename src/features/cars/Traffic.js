// The city's traffic (pure: no engine). Cars drive the RoadGraph's right-hand lanes at the limit (a little under or over
// by temperament), follow the car ahead (a gap that grows with speed), stop at red lights and at amber when they can,
// give way at a junction without lights while another car is crossing it, slow for the turns, honk when something stands
// in their way and turn back (or take another way) when it does not move, route round blocked edges (roadBlocked) and
// buses run a loop of stops. Far cars tick at a low rate.
//
//   const tr = new Traffic( graph, { rng, onHonk( car ), onReroute( car ) } );
//   tr.add( { id, kind, spec, color, ... }, { edge, dir, k, s } | null (a random lane), { bus: [ nodeIds ] } )
//   tr.update( dt, { time, viewer: { x, z }, obstacles: [ { x, z, yaw, len, wid, speed, id, static } ] } )
//   tr.remove( car )   tr.block( ids ) / tr.unblock( ids )   tr.cars   tr.occupied( x, z, r )
// A car record: { id, kind, spec, x, y, z, yaw, speed, steer, ai: { L, s, turn, ts, path, dest, v, pers, waitT, why, ... } }.
// y: the lane's height (the plan's node y, linear); the caller may replace it with the road surface (groundY( x, z )).

import { TRAFFIC } from './CarData.js';
import { bezier, bezierDir } from './RoadGraph.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
// why a car behind a stopped one waits: the queue's reason (a red light far ahead is no reason to honk)
const queued = ( c ) => ( c.ai && c.ai.v < 0.3 && c.ai.why ? ( c.ai.why[ 0 ] === 'q' ? c.ai.why : 'q:' + c.ai.why ) : 'car' );
const _p = { x: 0, y: 0, z: 0 }, _d = { x: 0, z: 0 };

export class Traffic {

	constructor( graph, { rng = Math.random, groundY = null, onHonk = null, onReroute = null, T = TRAFFIC } = {} ) {

		this.graph = graph;
		this.rng = rng;
		this.groundY = groundY;
		this.onHonk = onHonk;
		this.onReroute = onReroute;
		this.T = T;
		this.cars = [];
		this.time = 0;
		this.junction = new Map(); // node -> Set of cars crossing it
		this._index = new Map(); // lane key -> [ { car, s } ]
		this.nodeIds = [ ...graph.nodes.keys() ];
		this.stats = { honks: 0, reroutes: 0, uturns: 0, redStops: 0 };

	}

	_key( L ) {

		return L.edge + '|' + L.dir + '|' + L.k;

	}

	// a random lane point (s along it) of a usable edge
	randomLane() {

		const edges = [ ...this.graph.edges.values() ].filter( ( e ) => ! this.graph.blocked.has( e.id ) );
		if ( ! edges.length ) return null;
		const e = edges[ Math.floor( this.rng() * edges.length ) % edges.length ];
		const dir = e.oneWay ? 1 : this.rng() < 0.5 ? 1 : - 1;
		const k = Math.floor( this.rng() * e.per ) % e.per;
		const L = this.graph.lane( e.id, dir, k );
		return { edge: e.id, dir, k, s: L.len * ( 0.15 + 0.7 * this.rng() ) };

	}

	add( car, at = null, { bus = null } = {} ) {

		at = at || this.randomLane();
		if ( ! at ) return null;
		const L = this.graph.lane( at.edge, at.dir, Math.min( at.k || 0, Math.max( 0, this.graph.lanes( at.edge, at.dir ) - 1 ) ) );
		if ( ! L ) return null;
		car.ai = {
			L, s: clamp( at.s ?? 0, 0, L.len ), turn: null, ts: 0, path: [], dest: null, v: car.ai && car.ai.v ? car.ai.v : 0,
			pers: 0.86 + this.rng() * 0.24, waitT: 0, blockT: 0, honkT: 0, why: '', acc: 0, inJ: null, uturnT: 0,
			bus: bus ? { stops: bus.slice(), i: 0, stopT: 0 } : null,
		};
		car.speed = car.ai.v;
		this._pose( car );
		this.cars.push( car );
		this._plan( car );
		return car;

	}

	remove( car ) {

		const i = this.cars.indexOf( car );
		if ( i < 0 ) return false;
		this.cars.splice( i, 1 );
		this._leaveJunction( car );
		return true;

	}

	// a new destination and the way there from the end of the current lane
	_plan( car ) {

		const a = car.ai, g = this.graph;
		const from = a.L.to;
		let dest = null;
		if ( a.bus ) {

			dest = a.bus.stops[ a.bus.i % a.bus.stops.length ];
			// (arriving at the stop: no way on until it has stopped there)
			if ( dest === from ) { a.dest = dest; a.path = []; return true; }

		} else {

			for ( let i = 0; i < 6 && ( ! dest || dest === from ); i ++ ) dest = this.nodeIds[ Math.floor( this.rng() * this.nodeIds.length ) % this.nodeIds.length ];

		}

		const path = dest ? g.route( from, dest ) : null;
		a.dest = dest;
		if ( path && path.length ) {

			a.path = path;
			return true;

		}

		// nowhere to go (blocked in): any open way out of the next node
		const opts = g.next( from, a.L.edge ).filter( ( o ) => ! g.blocked.has( o.edge ) );
		a.path = opts.length ? [ opts[ Math.floor( this.rng() * opts.length ) % opts.length ] ] : [];
		return false;

	}

	// the lane a car takes next (keeping its lane index where it can)
	_nextLane( car ) {

		const a = car.ai, g = this.graph;
		if ( ! a.path.length ) this._plan( car );
		const n = a.path[ 0 ];
		if ( ! n ) return null;
		const per = g.lanes( n.edge, n.dir );
		if ( ! per ) return null;
		return g.lane( n.edge, n.dir, Math.min( a.L.k, per - 1 ) );

	}

	_enterJunction( car, node ) {

		let s = this.junction.get( node );
		if ( ! s ) this.junction.set( node, s = new Set() );
		s.add( car );
		car.ai.inJ = node;

	}

	_leaveJunction( car ) {

		const a = car.ai;
		if ( a && a.inJ !== null ) {

			const s = this.junction.get( a.inJ );
			if ( s ) s.delete( car );
			a.inJ = null;

		}

	}

	// may a car arriving along lane L cross its end node now? ('red' | 'yield' | null)
	_gate( car, dist ) {

		const a = car.ai, g = this.graph, L = a.L;
		const n = g.nodes.get( L.to );
		if ( ! n ) return null;
		if ( n.phase ) {

			const lt = g.light( L.to, L.edge, this.time );
			if ( lt === 'red' ) return 'red';
			// amber: stop if it can do so comfortably, else go through
			if ( lt === 'amber' && dist > a.v * a.v / ( 2 * this.T.decel ) + 1 && ! a.commit ) return 'red';
			// too close to stop on amber: committed, it goes through
			if ( lt === 'amber' ) a.commit = true;
			return null;

		}

		if ( n.out.length >= 3 ) {

			// give way: someone else is crossing (cars from my own lane may follow through)
			const occ = this.junction.get( L.to );
			if ( occ ) for ( const o of occ ) if ( o !== car && o.ai && o.ai.turn && this._key( o.ai.turn.from ) !== this._key( L ) ) return 'yield';

		}

		return null;

	}

	_buildIndex() {

		const idx = this._index;
		for ( const a of idx.values() ) a.length = 0;
		const put = ( key, car, s ) => {

			let a = idx.get( key );
			if ( ! a ) idx.set( key, a = [] );
			a.push( { car, s } );

		};
		for ( const c of this.cars ) {

			const a = c.ai;
			if ( ! a ) continue;
			if ( a.turn ) {

				put( this._key( a.turn.from ), c, a.turn.from.len + a.ts );
				put( this._key( a.turn.to ), c, a.ts - a.turn.len );

			} else put( this._key( a.L ), c, a.s );

		}

	}

	// the nearest car ahead in a lane key beyond s: { s, car } | null
	_ahead( key, s, self ) {

		const a = this._index.get( key );
		if ( ! a ) return null;
		let best = null;
		for ( const e of a ) if ( e.car !== self && e.s > s && ( ! best || e.s < best.s ) ) best = e;
		return best;

	}

	update( dt, { time = null, viewer = null, obstacles = [] } = {} ) {

		this.time = time !== null ? time : this.time + dt;
		this._buildIndex();
		const T = this.T;
		for ( const c of [ ...this.cars ] ) {

			const a = c.ai;
			if ( ! a ) continue;
			// far cars tick at a low rate
			const far = viewer ? Math.hypot( c.x - viewer.x, c.z - viewer.z ) > T.near : false;
			a.acc += dt;
			if ( far && a.acc < T.slowTick ) continue;
			const h = Math.min( a.acc, 0.5 );
			a.acc = 0;
			this._step( c, h, obstacles );

		}

	}

	_step( c, h, obstacles ) {

		const a = c.ai, T = this.T, g = this.graph;
		const len = c.spec.len;
		let vmax = a.L.speed * a.pers * ( c.kind === 'bus' ? 0.75 : 1 );
		let gap = Infinity, why = '', leadV = 0, staticBlock = false;

		if ( a.turn ) {

			vmax = Math.min( vmax, T.turnSpeed );
			const ahead = this._ahead( this._key( a.turn.to ), a.ts - a.turn.len, c );
			if ( ahead ) { gap = ahead.s - ( a.ts - a.turn.len ) - ( len + ahead.car.spec.len ) / 2; why = queued( ahead.car ); leadV = ahead.car.ai.v; }

		} else {

			const key = this._key( a.L );
			const ahead = this._ahead( key, a.s, c );
			const toEnd = a.L.len - a.s;
			if ( ahead ) { gap = ahead.s - a.s - ( len + ahead.car.spec.len ) / 2; why = queued( ahead.car ); leadV = ahead.car.ai.v; }
			// the end of the lane: the gate (lights, giving way, a bus stop) and the room in the next lane
			if ( toEnd < 60 ) {

				const gate = this._gate( c, toEnd - len / 2 );
				if ( gate && toEnd - len / 2 < gap ) { gap = toEnd - len / 2; why = gate; leadV = 0; }
				if ( a.bus && a.bus.stopT > 0 ) { gap = Math.min( gap, toEnd - len / 2 ); why = 'stop'; }
				const nl = this._nextLane( c );
				if ( nl ) {

					// slow for a sharp turn
					const cos = a.L.dx * nl.dx + a.L.dz * nl.dz;
					if ( cos < 0.85 ) vmax = Math.min( vmax, Math.sqrt( T.turnSpeed * T.turnSpeed + 2 * T.decel * 0.6 * Math.max( 0, toEnd - 2 ) ) );
					const nx = this._ahead( this._key( nl ), - 1e9, c );
					if ( nx && ! ahead ) {

						const d = toEnd + 2 * ( g.nodes.get( a.L.to ) || { r: 4 } ).r + nx.s - ( len + nx.car.spec.len ) / 2;
						if ( d < gap ) { gap = d; why = queued( nx.car ); leadV = nx.car.ai.v; }

					}

				}

			}

		}

		// things in the lane that are not traffic: the player's car, a wreck, someone on foot
		const fx = Math.sin( c.yaw ), fz = Math.cos( c.yaw );
		for ( const o of obstacles ) {

			if ( o.id === c.id ) continue;
			const dx = o.x - c.x, dz = o.z - c.z;
			if ( dx * dx + dz * dz > 45 * 45 ) continue;
			const df = dx * fx + dz * fz, dl = Math.abs( dx * fz - dz * fx );
			if ( df <= 0 || df > 40 || dl > ( o.wid || 0.6 ) / 2 + c.spec.wid / 2 + 0.4 ) continue;
			const d = df - ( len + ( o.len || 0.6 ) ) / 2;
			if ( d < gap ) { gap = d; why = o.kind || 'obstacle'; leadV = Math.max( 0, o.speed || 0 ); staticBlock = !! o.static || ( o.speed || 0 ) < 0.3; }

		}

		// the speed: the limit, the room to stop in, a little headway
		let vt = vmax;
		if ( gap < Infinity ) {

			const room = gap - T.minGap;
			vt = Math.min( vt, Math.sqrt( Math.max( 0, 2 * T.decel * room ) + leadV * leadV * 0.5 ), Math.max( 0, room / T.headway + leadV ) );

		}

		a.v += clamp( vt - a.v, - T.panic * h, T.accel * h );
		if ( a.v < 0 ) a.v = 0;
		a.why = a.v < 0.3 ? why : '';
		if ( why === 'red' && a.v < 0.3 && a.why === 'red' && a.waitT === 0 ) this.stats.redStops ++;
		a.waitT = a.v < 0.3 ? a.waitT + h : 0;

		// stuck behind something that does not move: honk, then turn back or take another way
		if ( a.v < 0.3 && ( why === 'car' || why === 'player' || why === 'wreck' || why === 'obstacle' || why === 'pedestrian' ) ) {

			a.blockT += h;
			a.honkT -= h;
			if ( a.blockT > T.honkAfter && a.honkT <= 0 ) {

				a.honkT = 4 + this.rng() * 3;
				this.stats.honks ++;
				if ( this.onHonk ) this.onHonk( c );

			}

			if ( a.blockT > T.rerouteAfter && ( staticBlock || why === 'car' ) && ! a.turn && a.uturnT <= 0 ) this._uturn( c );

		} else a.blockT = 0;
		a.uturnT -= h;

		// the bus at its stop
		if ( a.bus && a.bus.stopT > 0 && a.v < 0.3 ) {

			a.bus.stopT -= h;
			if ( a.bus.stopT <= 0 ) { a.bus.i ++; this._plan( c ); }

		}

		this._advance( c, a.v * h );
		c.speed = a.v;
		this._pose( c );

	}

	// a U-turn onto the other side of the same road (one-way: another lane), a new route from there
	_uturn( c ) {

		const a = c.ai, g = this.graph, L = a.L;
		a.uturnT = 10;
		a.blockT = 0;
		if ( g.lanes( L.edge, - L.dir ) ) {

			const L2 = g.lane( L.edge, - L.dir, Math.min( L.k, g.lanes( L.edge, - L.dir ) - 1 ) );
			a.L = L2;
			a.s = clamp( L2.len - a.s, 0, L2.len );
			a.v = 0;
			this.stats.uturns ++;

		}

		this._plan( c );
		this.stats.reroutes ++;
		if ( this.onReroute ) this.onReroute( c );

	}

	_advance( c, ds ) {

		const a = c.ai, g = this.graph;
		let guard = 0;
		while ( ds > 0 && guard ++ < 4 ) {

			if ( a.turn ) {

				const left = a.turn.len - a.ts;
				if ( ds < left ) { a.ts += ds; return; }
				ds -= left;
				// into the next lane
				a.L = a.turn.to;
				a.s = 0;
				a.turn = null;
				a.ts = 0;
				this._leaveJunction( c );

			} else {

				const left = a.L.len - a.s;
				if ( ds < left ) { a.s += ds; return; }
				// at the stop line: the bus stops here when it is its stop
				if ( a.bus && a.L.to === a.bus.stops[ a.bus.i % a.bus.stops.length ] && a.bus.stopT <= 0 && ! a.bus.served ) {

					a.s = a.L.len;
					a.bus.stopT = this.T.busStop;
					a.bus.served = true;
					return;

				}

				// (two cars may reach a junction without lights in the same frame: the second one waits at its line)
				const n = g.nodes.get( a.L.to );
				if ( n && n.phase && ! a.commit && g.light( a.L.to, a.L.edge, this.time ) === 'red' ) { a.s = a.L.len; a.v = 0; return; }
				if ( n && ! n.phase && n.out.length >= 3 ) {

					const occ = this.junction.get( a.L.to );
					if ( occ ) for ( const o of occ ) if ( o !== c && o.ai && o.ai.turn && this._key( o.ai.turn.from ) !== this._key( a.L ) ) { a.s = a.L.len; a.v = 0; return; }

				}

				ds -= left;
				const nl = this._nextLane( c );
				if ( ! nl ) { a.s = a.L.len; return; }
				if ( a.bus ) a.bus.served = false;
				a.path.shift();
				a.turn = g.turn( a.L, nl );
				a.ts = 0;
				this._enterJunction( c, a.L.to );
				a.commit = false;
				if ( ! a.path.length ) this._plan2( c, nl );

			}

		}

	}

	// the route on from a lane about to be entered
	_plan2( car, nl ) {

		const keep = car.ai.L;
		car.ai.L = nl;
		this._plan( car );
		car.ai.L = keep;

	}

	_pose( c ) {

		const a = c.ai;
		if ( a.turn ) {

			const t = clamp( a.ts / a.turn.len, 0, 1 );
			bezier( a.turn.p0, a.turn.p1, a.turn.p2, t, _p );
			bezierDir( a.turn.p0, a.turn.p1, a.turn.p2, t, _d );
			c.x = _p.x; c.z = _p.z;
			c.y = a.turn.y;
			if ( _d.x * _d.x + _d.z * _d.z > 1e-6 ) c.yaw = Math.atan2( _d.x, _d.z );
			c.steer = clamp( ( a.turn.to.dx * a.turn.from.dz - a.turn.to.dz * a.turn.from.dx ) * - 0.5, - 0.5, 0.5 );

		} else {

			this.graph.pointOn( a.L, a.s, _p );
			c.x = _p.x; c.z = _p.z; c.y = _p.y;
			c.yaw = Math.atan2( a.L.dx, a.L.dz );
			c.steer *= 0.8;

		}

		if ( this.groundY ) {

			const y = this.groundY( c.x, c.z );
			if ( Number.isFinite( y ) ) c.y = y;

		}

	}

	// close the edges (21C's roadBlocked): cars on them turn back, routes through them are made again
	block( ids ) {

		const n = this.graph.block( ids );
		if ( ! n ) return 0;
		const set = new Set( ids );
		for ( const c of this.cars ) {

			const a = c.ai;
			if ( ! a ) continue;
			if ( ! a.turn && set.has( a.L.edge ) ) this._uturn( c );
			else if ( a.path.some( ( p ) => set.has( p.edge ) ) ) {

				this._plan( c );
				this.stats.reroutes ++;
				if ( this.onReroute ) this.onReroute( c );

			}

		}

		return n;

	}

	unblock( ids ) {

		return this.graph.unblock( ids );

	}

	// is there a traffic car within r of ( x, z )?
	occupied( x, z, r ) {

		for ( const c of this.cars ) if ( Math.abs( c.x - x ) < r && Math.abs( c.z - z ) < r && Math.hypot( c.x - x, c.z - z ) < r ) return c;
		return null;

	}

}
