// The city's road network for the traffic (pure: no engine). Built from a plan's roads ( CityPlan.js: nodes { id, x, z, y,
// signal }, edges { id, a, b, lanes (both ways together), width, speed, oneWay } ): right-hand lanes, junction radii and
// stop lines, the traffic lights' phases, the turn curves through a junction and the shortest routes (travel time) round
// blocked edges.
//
//   const g = new RoadGraph( plan.roads );
//   g.lanes( edgeId, dir ) -> lanes each way (dir +1 runs a -> b, -1 b -> a)      g.lane( edgeId, dir, k ) -> { ax, az, bx, bz, len, dx, dz, ay, by }
//   g.light( nodeId, edgeId, t ) -> 'green' | 'amber' | 'red' (for a car arriving at nodeId along edgeId; 'green' at a node without signals)
//   g.route( fromNode, toNode, blocked: Set ) -> [ { edge, dir } ] | null       g.next( nodeId, fromEdge ) the edges out of a node
//   g.turn( laneIn, laneOut, node ) -> { p0, p1, p2, len } (a quadratic curve)   g.at( x, z ) -> the nearest lane { edge, dir, k, s, d }
//   g.block( ids ) / g.unblock( ids ) / g.blocked (Set of edge ids)

const LANE_MIN = 2.8, LANE_MAX = 3.8;

export class RoadGraph {

	constructor( roads, { signal = { green: 14, amber: 3, allRed: 1.5 } } = {} ) {

		this.nodes = new Map();
		this.edges = new Map();
		this.blocked = new Set();
		this.signal = signal;
		for ( const n of roads.nodes || [] ) this.nodes.set( n.id, { ...n, y: Number.isFinite( n.y ) ? n.y : 0, out: [], r: 0, phase: null, offset: 0 } );
		for ( const e of roads.edges || [] ) {

			const A = this.nodes.get( e.a ), B = this.nodes.get( e.b );
			if ( ! A || ! B || A === B ) continue;
			const len = Math.hypot( B.x - A.x, B.z - A.z );
			if ( len < 1 ) continue;
			const lanes = Math.max( 1, e.lanes || 2 );
			const per = e.oneWay ? lanes : Math.max( 1, Math.floor( lanes / 2 ) );
			let laneW = Math.min( LANE_MAX, Math.max( LANE_MIN, ( e.width || lanes * 3.3 ) / ( e.oneWay ? lanes : per * 2 ) ) );
			// a two-lane street keeps its cars clear of the parking bays along its kerbs (CityPlan: bays 1.1 m in from the kerb)
			if ( e.kind === 'street' && ! e.oneWay && per === 1 ) laneW = Math.min( laneW, 3.0 );
			const E = { ...e, len, dx: ( B.x - A.x ) / len, dz: ( B.z - A.z ) / len, per, laneW, speed: e.speed || 11 };
			this.edges.set( e.id, E );
			A.out.push( E );
			B.out.push( E );

		}

		// junction radii: the stop line sits back from the node by the widest crossing road's half width (bends: little)
		for ( const n of this.nodes.values() ) {

			let w = 0;
			for ( const e of n.out ) w = Math.max( w, e.width || 6 );
			n.r = n.out.length >= 3 ? w / 2 + 2 : n.out.length === 2 ? Math.min( 3, w / 4 ) : 1;
			if ( n.signal ) this._phases( n );

		}

		this._lanes = new Map();

	}

	// the signal's two groups: the approaches near the first one's axis, and the rest
	_phases( n ) {

		const ref = n.out[ 0 ];
		const ax = ref.dx, az = ref.dz;
		n.phase = new Map();
		for ( const e of n.out ) n.phase.set( e.id, Math.abs( e.dx * ax + e.dz * az ) > 0.7 ? 0 : 1 );
		let h = 0;
		for ( let i = 0; i < n.id.length; i ++ ) h = ( h * 31 + n.id.charCodeAt( i ) ) >>> 0;
		n.offset = h % 37;

	}

	cycle() {

		const S = this.signal;
		return 2 * ( S.green + S.amber + S.allRed );

	}

	// the light a car sees arriving at node n along edge e at time t (s)
	light( nodeId, edgeId, t ) {

		const n = this.nodes.get( nodeId );
		if ( ! n || ! n.phase ) return 'green';
		const S = this.signal, half = S.green + S.amber + S.allRed;
		const g = n.phase.get( edgeId ) || 0;
		let u = ( ( t + n.offset ) % this.cycle() + this.cycle() ) % this.cycle();
		u -= g * half;
		if ( u < 0 ) u += this.cycle();
		if ( u < S.green ) return 'green';
		if ( u < S.green + S.amber ) return 'amber';
		return 'red';

	}

	lanes( edgeId, dir ) {

		const e = this.edges.get( edgeId );
		if ( ! e ) return 0;
		if ( e.oneWay && dir < 0 ) return 0;
		return e.per;

	}

	// lane k (0 next to the centre line on a two-way road) of edge e in direction dir: from stop line to stop line
	lane( edgeId, dir, k ) {

		const key = edgeId + '|' + dir + '|' + k;
		let L = this._lanes.get( key );
		if ( L ) return L;
		const e = this.edges.get( edgeId );
		if ( ! e ) return null;
		const A = this.nodes.get( dir > 0 ? e.a : e.b ), B = this.nodes.get( dir > 0 ? e.b : e.a );
		const dx = e.dx * dir, dz = e.dz * dir;
		const rx = - dz, rz = dx; // the right-hand side of the travel direction (+X is the car's left)
		const off = e.oneWay ? ( k - ( e.per - 1 ) / 2 ) * e.laneW : ( k + 0.5 ) * e.laneW;
		const ra = Math.min( A.r, e.len * 0.4 ), rb = Math.min( B.r, e.len * 0.4 );
		L = {
			edge: edgeId, dir, k, from: A.id, to: B.id, dx, dz,
			ax: A.x + dx * ra + rx * off, az: A.z + dz * ra + rz * off, bx: B.x - dx * rb + rx * off, bz: B.z - dz * rb + rz * off,
			ay: A.y, by: B.y, speed: e.speed, width: e.width,
		};
		L.len = Math.hypot( L.bx - L.ax, L.bz - L.az );
		this._lanes.set( key, L );
		return L;

	}

	// a point along a lane (s metres from its start)
	pointOn( L, s, out = { x: 0, y: 0, z: 0 } ) {

		const t = L.len > 0 ? Math.min( 1, Math.max( 0, s / L.len ) ) : 0;
		out.x = L.ax + ( L.bx - L.ax ) * t;
		out.z = L.az + ( L.bz - L.az ) * t;
		out.y = L.ay + ( L.by - L.ay ) * t;
		return out;

	}

	// the curve from the end of lane `a` into the start of lane `b` through their shared node
	turn( a, b ) {

		const p0 = { x: a.bx, z: a.bz }, p2 = { x: b.ax, z: b.az };
		// the control point: where the two lane lines cross (a straight on: the middle)
		const den = a.dx * b.dz - a.dz * b.dx;
		let p1;
		if ( Math.abs( den ) < 0.15 ) {

			if ( a.dx * b.dx + a.dz * b.dz < 0 ) {

				// a U-turn at a dead end: swing out past the node
				const n = this.nodes.get( a.to );
				p1 = { x: n.x + a.dx * 4, z: n.z + a.dz * 4 };

			} else p1 = { x: ( p0.x + p2.x ) / 2, z: ( p0.z + p2.z ) / 2 };

		} else {

			const wx = p2.x - p0.x, wz = p2.z - p0.z;
			const t = ( wx * b.dz - wz * b.dx ) / den;
			p1 = { x: p0.x + a.dx * t, z: p0.z + a.dz * t };

		}

		// arc length of the quadratic (a few chords)
		let len = 0, px = p0.x, pz = p0.z;
		for ( let i = 1; i <= 8; i ++ ) {

			const q = bezier( p0, p1, p2, i / 8, {} );
			len += Math.hypot( q.x - px, q.z - pz );
			px = q.x; pz = q.z;

		}

		const n = this.nodes.get( a.to );
		return { p0, p1, p2, len: Math.max( 0.5, len ), node: a.to, y: n ? n.y : a.by, from: a, to: b };

	}

	// the edges a car may take out of node n, arriving along fromEdge (a U-turn only at a dead end)
	next( nodeId, fromEdge = null ) {

		const n = this.nodes.get( nodeId );
		if ( ! n ) return [];
		const out = [];
		for ( const e of n.out ) {

			const dir = e.a === nodeId ? 1 : - 1;
			if ( e.oneWay && dir < 0 ) continue;
			if ( e.id === fromEdge && n.out.length > 1 ) continue;
			out.push( { edge: e.id, dir } );

		}

		return out;

	}

	// the quickest way from node a to node b ( [ { edge, dir } ] ), round the blocked edges; null when there is none
	route( from, to, blocked = this.blocked ) {

		if ( from === to ) return [];
		if ( ! this.nodes.has( from ) || ! this.nodes.has( to ) ) return null;
		const dist = new Map( [ [ from, 0 ] ] ), prev = new Map(), done = new Set();
		const open = [ from ];
		while ( open.length ) {

			let bi = 0;
			for ( let i = 1; i < open.length; i ++ ) if ( dist.get( open[ i ] ) < dist.get( open[ bi ] ) ) bi = i;
			const u = open[ bi ];
			open[ bi ] = open[ open.length - 1 ];
			open.pop();
			if ( done.has( u ) ) continue;
			done.add( u );
			if ( u === to ) break;
			for ( const e of this.nodes.get( u ).out ) {

				if ( blocked.has( e.id ) ) continue;
				const dir = e.a === u ? 1 : - 1;
				if ( e.oneWay && dir < 0 ) continue;
				const v = dir > 0 ? e.b : e.a;
				const nd = dist.get( u ) + e.len / e.speed + ( this.nodes.get( v ).signal ? 6 : 1.5 );
				if ( nd < ( dist.has( v ) ? dist.get( v ) : Infinity ) ) {

					dist.set( v, nd );
					prev.set( v, { edge: e.id, dir, from: u } );
					open.push( v );

				}

			}

		}

		if ( ! prev.has( to ) ) return null;
		const path = [];
		for ( let v = to; v !== from; ) {

			const p = prev.get( v );
			path.push( { edge: p.edge, dir: p.dir } );
			v = p.from;

		}

		return path.reverse();

	}

	// the nearest lane point to ( x, z ): { edge, dir, k, s, d (m off the lane line) }
	at( x, z ) {

		let best = null, bd = Infinity;
		for ( const e of this.edges.values() ) {

			for ( const dir of e.oneWay ? [ 1 ] : [ 1, - 1 ] ) for ( let k = 0; k < e.per; k ++ ) {

				const L = this.lane( e.id, dir, k );
				const vx = L.bx - L.ax, vz = L.bz - L.az;
				const t = Math.max( 0, Math.min( 1, ( ( x - L.ax ) * vx + ( z - L.az ) * vz ) / ( L.len * L.len || 1 ) ) );
				const d = Math.hypot( x - L.ax - vx * t, z - L.az - vz * t );
				if ( d < bd ) { bd = d; best = { edge: e.id, dir, k, s: t * L.len, d }; }

			}

		}

		return best;

	}

	block( ids ) {

		let n = 0;
		for ( const id of ids || [] ) if ( this.edges.has( id ) && ! this.blocked.has( id ) ) { this.blocked.add( id ); n ++; }
		return n;

	}

	unblock( ids ) {

		let n = 0;
		for ( const id of ids || [] ) if ( this.blocked.delete( id ) ) n ++;
		return n;

	}

}

export function bezier( p0, p1, p2, t, out ) {

	const u = 1 - t;
	out.x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
	out.z = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z;
	return out;

}

// the curve's direction at t (unnormalised)
export function bezierDir( p0, p1, p2, t, out ) {

	const u = 1 - t;
	out.x = 2 * u * ( p1.x - p0.x ) + 2 * t * ( p2.x - p1.x );
	out.z = 2 * u * ( p1.z - p0.z ) + 2 * t * ( p2.z - p1.z );
	return out;

}
