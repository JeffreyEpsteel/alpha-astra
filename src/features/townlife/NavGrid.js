// A town's walkable grid (townlife): 1 m cells in the town's own frame (Tidemark and Blackwater lie rotated in the world),
// each with its ground height and a cost. Built in slices (buildStep) so a town that comes into range costs a few ms
// per frame, not one hitch. Walkable = dry land or a walkable deck (the pier), a gentle slope, clear of every solid
// collider (houses, stalls, walls, posts) and of the town plan's obstacles (props the destruction feature draws, which
// have no Colliders entry) by a person's radius. Streets (terrain.pathDistance, the plan's street polylines) cost 1,
// open ground more, so routes keep to the streets and still reach a door or a bench.
//
//   const g = new NavGrid( { frame: { x, z, yaw }, u0, u1, v0, v1, cell: 1 }, { ground, solids, obstacles, streets } )
//   while ( ! g.ready ) g.buildStep( 4000 );
//   g.free( x, z ) / g.groundAt( x, z ) / g.nearestFree( x, z, maxR ) -> { x, z } | null
//   g.route( ax, az, bx, bz ) -> [ { x, z }, ... ] (ends at b, or at the free cell nearest b) | null
//
// ground( x, z ) -> { y, deck } | null (null: sea); solids: [ { x, z, hx, hz, yaw } ] boxes and [ { x, z, r } ] circles.

const SQRT2 = Math.SQRT2;
const RADIUS = 0.6; // a person's clearance (m; over half a cell's diagonal less a post's radius, so a post on a cell corner still blocks)
const SEA = 0.32; // m: below this the ground is the sea / wet swash
const SLOPE = 0.7; // max rise over a metre
const OFF_STREET = 2.2; // cost of a cell off the streets

export class NavGrid {

	constructor( { frame = { x: 0, z: 0, yaw: 0 }, u0, u1, v0, v1, cell = 1 }, { ground, solids = [], obstacles = [], streets = [], pathDistance = null } = {} ) {

		this.frame = frame;
		this.c = Math.cos( frame.yaw );
		this.s = Math.sin( frame.yaw );
		this.cell = cell;
		this.u0 = u0; this.v0 = v0;
		this.nu = Math.max( 2, Math.ceil( ( u1 - u0 ) / cell ) );
		this.nv = Math.max( 2, Math.ceil( ( v1 - v0 ) / cell ) );
		const n = this.n = this.nu * this.nv;
		this.y = new Float32Array( n );
		this.cost = new Float32Array( n ); // 0: blocked
		this.deck = new Uint8Array( n );
		this.sea = new Uint8Array( n ); // 1: water (a route's last leg never ends there)
		this._ground = ground;
		this._pathDistance = pathDistance;
		// only what lies inside the grid (plus a margin) is tested per cell
		const [ cx, cz ] = this.world( ( u0 + u1 ) / 2, ( v0 + v1 ) / 2 );
		const R = Math.hypot( u1 - u0, v1 - v0 ) / 2 + 4;
		const near = ( o ) => Math.abs( o.x - cx ) < R + ( o.r || Math.hypot( o.hx || 0, o.hz || 0 ) ) && Math.abs( o.z - cz ) < R + ( o.r || Math.hypot( o.hx || 0, o.hz || 0 ) );
		this._solids = [ ...solids, ...obstacles ].filter( near ).map( prepSolid );
		this._streets = streets.filter( ( s ) => s.pts && s.pts.length >= 2 );
		this._next = 0;
		this.ready = false;
		// A* scratch (reused)
		this._g = new Float32Array( n );
		this._from = new Int32Array( n );
		this._seen = new Uint32Array( n );
		this._shut = new Uint32Array( n );
		this._gen = 0;
		this._heap = new Int32Array( n + 1 );
		this._f = new Float32Array( n );
		this._cache = new Map();
		this.expansions = 0;
		this.unreachable = 0; // routes answered 'none' by components() (wave 20A)
		this._comp = null;

	}

	// grid frame <-> world (u along the frame's local x, v along its local z: frameAt's convention)
	world( u, v ) {

		return [ this.frame.x + u * this.c + v * this.s, this.frame.z - u * this.s + v * this.c ];

	}

	local( x, z ) {

		const dx = x - this.frame.x, dz = z - this.frame.z;
		return [ dx * this.c - dz * this.s, dx * this.s + dz * this.c ];

	}

	index( x, z ) {

		const [ u, v ] = this.local( x, z );
		const i = Math.floor( ( u - this.u0 ) / this.cell ), j = Math.floor( ( v - this.v0 ) / this.cell );
		if ( i < 0 || j < 0 || i >= this.nu || j >= this.nv ) return - 1;
		return j * this.nu + i;

	}

	centre( k, out = { x: 0, z: 0 } ) {

		const i = k % this.nu, j = ( k - i ) / this.nu;
		const [ x, z ] = this.world( this.u0 + ( i + 0.5 ) * this.cell, this.v0 + ( j + 0.5 ) * this.cell );
		out.x = x; out.z = z;
		return out;

	}

	// build up to `budget` cells; true once the whole grid is done
	buildStep( budget = 4000 ) {

		if ( this.ready ) return true;
		const end = Math.min( this.n, this._next + budget );
		const p = { x: 0, z: 0 };
		for ( let k = this._next; k < end; k ++ ) {

			this.centre( k, p );
			this._buildCell( k, p.x, p.z );

		}

		this._next = end;
		if ( end >= this.n ) {

			this.ready = true;
			this._ground = null;

		}

		return this.ready;

	}

	_buildCell( k, x, z ) {

		const G0 = this._ground( x, z ); // (the ground function may reuse its result object: copy it)
		if ( ! G0 || ! ( G0.y > SEA || G0.deck ) ) { this.cost[ k ] = 0; this.sea[ k ] = 1; return; }
		const G = { y: G0.y, deck: G0.deck };
		this.y[ k ] = G.y;
		this.deck[ k ] = G.deck ? 1 : 0;
		if ( ! G.deck ) {

			// a gentle slope (a cliff or a terrace face is not a path)
			for ( const [ dx, dz ] of [ [ 0.5, 0 ], [ - 0.5, 0 ], [ 0, 0.5 ], [ 0, - 0.5 ] ] ) {

				const q = this._ground( x + dx, z + dz );
				if ( ! q || Math.abs( q.y - G.y ) > SLOPE * 0.5 || ( ! q.deck && q.y <= SEA ) ) { this.cost[ k ] = 0; return; }

			}

		}

		for ( const o of this._solids ) {

			if ( o.y0 !== undefined && ( G.y + 1.6 < o.y0 || G.y + 0.35 > o.y1 ) ) continue;
			if ( Math.abs( x - o.x ) > o.reach || Math.abs( z - o.z ) > o.reach ) continue;
			if ( o.r !== undefined ) {

				if ( ( x - o.x ) ** 2 + ( z - o.z ) ** 2 < ( o.r + RADIUS ) ** 2 ) { this.cost[ k ] = 0; return; }
				continue;

			}

			const dx = x - o.x, dz = z - o.z;
			const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
			if ( Math.abs( lx ) < o.hx + RADIUS && Math.abs( lz ) < o.hz + RADIUS ) { this.cost[ k ] = 0; return; }

		}

		this.cost[ k ] = this._onStreet( x, z ) ? 1 : OFF_STREET;

	}

	_onStreet( x, z ) {

		if ( this._pathDistance ) {

			const d = this._pathDistance( x, z );
			if ( Number.isFinite( d ) && d < 0.4 ) return true;

		}

		for ( const s of this._streets ) {

			const w = ( s.w || 2 ) / 2 + 0.3;
			for ( let i = 0; i + 1 < s.pts.length; i ++ ) if ( segDist( x, z, s.pts[ i ], s.pts[ i + 1 ] ) < w ) return true;

		}

		return false;

	}

	free( x, z ) {

		const k = this.index( x, z );
		return k >= 0 && this.cost[ k ] > 0;

	}

	// the cell's ground height
	groundAt( x, z ) {

		const k = this.index( x, z );
		return k >= 0 ? this.y[ k ] : 0;

	}

	isDeck( x, z ) {

		const k = this.index( x, z );
		return k >= 0 && this.deck[ k ] === 1;

	}

	nearestFreeIndex( x, z, maxR = 6 ) {

		const k0 = this.index( x, z );
		if ( k0 >= 0 && this.cost[ k0 ] > 0 ) return k0;
		const [ u, v ] = this.local( x, z );
		const i0 = Math.floor( ( u - this.u0 ) / this.cell ), j0 = Math.floor( ( v - this.v0 ) / this.cell );
		const R = Math.ceil( maxR / this.cell );
		let best = - 1, bd = Infinity;
		for ( let r = 1; r <= R; r ++ ) {

			for ( let j = j0 - r; j <= j0 + r; j ++ ) for ( let i = i0 - r; i <= i0 + r; i ++ ) {

				if ( Math.max( Math.abs( i - i0 ), Math.abs( j - j0 ) ) !== r ) continue;
				if ( i < 0 || j < 0 || i >= this.nu || j >= this.nv ) continue;
				const k = j * this.nu + i;
				if ( this.cost[ k ] <= 0 ) continue;
				const d = ( i - i0 ) ** 2 + ( j - j0 ) ** 2;
				if ( d < bd ) { bd = d; best = k; }

			}

			if ( best >= 0 ) return best;

		}

		return - 1;

	}

	nearestFree( x, z, maxR = 6 ) {

		const k = this.nearestFreeIndex( x, z, maxR );
		return k < 0 ? null : this.centre( k );

	}

	// every cell along a -> b free (a body's width of it: the line and 0.35 m either side), and none dearer than
	// `maxCost` (keeps a shortcut on the street)
	clear( ax, az, bx, bz, maxCost = Infinity ) {

		const L = Math.hypot( bx - ax, bz - az );
		const steps = Math.max( 1, Math.ceil( L / ( this.cell * 0.4 ) ) );
		const px = L > 1e-6 ? - ( bz - az ) / L * 0.35 : 0, pz = L > 1e-6 ? ( bx - ax ) / L * 0.35 : 0;
		for ( let s = 0; s <= steps; s ++ ) {

			const t = s / steps;
			const x = ax + ( bx - ax ) * t, z = az + ( bz - az ) * t;
			for ( let w = - 1; w <= 1; w ++ ) {

				const k = this.index( x + px * w, z + pz * w );
				if ( k < 0 ) return false;
				const c = this.cost[ k ];
				if ( c <= 0 || c > maxCost ) return false;

			}

		}

		return true;

	}

	// a route from a to b over free cells (A*, 8 neighbours, no corner cutting), string-pulled; null when unreachable
	route( ax, az, bx, bz ) {

		if ( ! this.ready ) return null;
		const s = this.nearestFreeIndex( ax, az, 8 ), t = this.nearestFreeIndex( bx, bz, 8 );
		if ( s < 0 || t < 0 ) return null;
		// wave 20A: two cells in different pieces of the grid have no route (A* searched up to 60,000 cells to find that out,
		// again every time: Tidemark's evening tavern-goers, ~11 ms a frame)
		const comp = this.components();
		if ( comp[ s ] !== comp[ t ] ) {

			this.unreachable ++;
			return null;

		}
		const end = { x: bx, z: bz };
		const tk = this.index( bx, bz );
		const exact = tk === t || ( tk >= 0 && ! this.sea[ tk ] && Math.hypot( this.centre( t ).x - bx, this.centre( t ).z - bz ) < 2.5 );
		const key = s * this.n + t;
		let cells = this._cache.get( key );
		if ( ! cells ) {

			cells = this._astar( s, t );
			if ( ! cells ) return null;
			if ( this._cache.size > 256 ) this._cache.delete( this._cache.keys().next().value );
			this._cache.set( key, cells );

		}

		const pts = this._pull( cells, ax, az );
		// starting inside a blocked cell (pushed against a post): first step out to the free cell, not past the post
		if ( this.index( ax, az ) !== s ) pts.unshift( this.centre( s ) );
		if ( exact ) {

			// the last leg to the exact spot (a door, a seat beside its bench)
			const last = pts[ pts.length - 1 ];
			if ( ! last || Math.hypot( last.x - bx, last.z - bz ) > 0.05 ) pts.push( end );

		}

		return pts;

	}

	// the connected pieces of the free cells under A*'s moves (8 neighbours, no squeezing between two blocked corners: the
	// moves are symmetric), labelled once the grid is built; comp[ k ] -1 for a blocked cell
	components() {

		if ( this._comp ) return this._comp;
		const nu = this.nu, nv = this.nv, cost = this.cost, comp = new Int32Array( this.n ).fill( - 1 ), stack = new Int32Array( this.n );
		let id = 0;
		for ( let k0 = 0; k0 < this.n; k0 ++ ) {

			if ( cost[ k0 ] <= 0 || comp[ k0 ] >= 0 ) continue;
			let sp = 0;
			stack[ sp ++ ] = k0;
			comp[ k0 ] = id;
			while ( sp > 0 ) {

				const k = stack[ -- sp ];
				const i = k % nu, j = ( k - i ) / nu;
				for ( let dj = - 1; dj <= 1; dj ++ ) for ( let di = - 1; di <= 1; di ++ ) {

					if ( ! di && ! dj ) continue;
					const ni = i + di, nj = j + dj;
					if ( ni < 0 || nj < 0 || ni >= nu || nj >= nv ) continue;
					const nk = nj * nu + ni;
					if ( cost[ nk ] <= 0 || comp[ nk ] >= 0 ) continue;
					if ( di && dj && ( cost[ j * nu + ni ] <= 0 || cost[ nj * nu + i ] <= 0 ) ) continue;
					comp[ nk ] = id;
					stack[ sp ++ ] = nk;

				}

			}

			id ++;

		}

		this.componentCount = id;
		return ( this._comp = comp );

	}

	_astar( s, t ) {

		const nu = this.nu, nv = this.nv, cost = this.cost, g = this._g, f = this._f, from = this._from, seen = this._seen, shut = this._shut;
		const gen = ++ this._gen;
		const ti = t % nu, tj = ( t - ti ) / nu;
		const h = ( k ) => {

			const i = k % nu, j = ( k - i ) / nu;
			const dx = Math.abs( i - ti ), dz = Math.abs( j - tj );
			return ( dx + dz + ( SQRT2 - 2 ) * Math.min( dx, dz ) ); // octile, at street cost

		};

		const heap = this._heap;
		let hn = 0;
		const push = ( k ) => {

			let i = ++ hn;
			heap[ i ] = k;
			while ( i > 1 && f[ heap[ i >> 1 ] ] > f[ heap[ i ] ] ) { const p = i >> 1; const q = heap[ p ]; heap[ p ] = heap[ i ]; heap[ i ] = q; i = p; }

		};

		const pop = () => {

			const top = heap[ 1 ];
			heap[ 1 ] = heap[ hn -- ];
			let i = 1;
			for ( ;; ) {

				const l = i * 2, r = l + 1;
				let m = i;
				if ( l <= hn && f[ heap[ l ] ] < f[ heap[ m ] ] ) m = l;
				if ( r <= hn && f[ heap[ r ] ] < f[ heap[ m ] ] ) m = r;
				if ( m === i ) break;
				const q = heap[ m ]; heap[ m ] = heap[ i ]; heap[ i ] = q; i = m;

			}

			return top;

		};

		g[ s ] = 0; f[ s ] = h( s ); from[ s ] = - 1; seen[ s ] = gen;
		push( s );
		let found = false, exp = 0;
		while ( hn > 0 ) {

			const k = pop();
			if ( shut[ k ] === gen ) continue;
			shut[ k ] = gen;
			if ( k === t ) { found = true; break; }
			if ( ++ exp > 60000 ) break;
			const i = k % nu, j = ( k - i ) / nu;
			for ( let dj = - 1; dj <= 1; dj ++ ) for ( let di = - 1; di <= 1; di ++ ) {

				if ( ! di && ! dj ) continue;
				const ni = i + di, nj = j + dj;
				if ( ni < 0 || nj < 0 || ni >= nu || nj >= nv ) continue;
				const nk = nj * nu + ni;
				const c = cost[ nk ];
				if ( c <= 0 || shut[ nk ] === gen ) continue;
				// no squeezing between two blocked corners
				if ( di && dj && ( cost[ j * nu + ni ] <= 0 || cost[ nj * nu + i ] <= 0 ) ) continue;
				const ng = g[ k ] + ( di && dj ? SQRT2 : 1 ) * ( c + cost[ k ] ) * 0.5;
				if ( seen[ nk ] === gen && ng >= g[ nk ] ) continue;
				seen[ nk ] = gen;
				g[ nk ] = ng;
				f[ nk ] = ng + h( nk );
				from[ nk ] = k;
				push( nk );

			}

		}

		this.expansions += exp;
		if ( ! found ) return null;
		const out = [];
		for ( let k = t; k >= 0; k = from[ k ] ) out.push( k );
		out.reverse();
		return out;

	}

	// string pulling: from each kept point, the farthest cell still in clear sight at no higher cost
	_pull( cells, ax, az ) {

		const pts = [];
		const p = { x: 0, z: 0 };
		let cx = ax, cz = az, i = 0;
		const cost = this.cost;
		while ( i < cells.length - 1 ) {

			let best = i + 1;
			const lim = Math.min( cells.length - 1, i + 40 );
			const here = Math.max( cost[ cells[ i ] ], 1 );
			for ( let j = lim; j > i + 1; j -- ) {

				this.centre( cells[ j ], p );
				let maxC = here;
				for ( let q = i; q <= j; q ++ ) maxC = Math.max( maxC, cost[ cells[ q ] ] );
				if ( this.clear( cx, cz, p.x, p.z, maxC ) ) { best = j; break; }

			}

			const c = this.centre( cells[ best ] );
			pts.push( c );
			cx = c.x; cz = c.z;
			i = best;

		}

		return pts;

	}

}

function prepSolid( o ) {

	if ( o.r !== undefined ) return { x: o.x, z: o.z, r: o.r, reach: o.r + RADIUS + 0.01, y0: o.y0, y1: o.y1 };
	const yaw = o.yaw || 0;
	return { x: o.x, z: o.z, hx: o.hx, hz: o.hz, c: Math.cos( yaw ), s: Math.sin( yaw ), reach: Math.hypot( o.hx, o.hz ) + RADIUS + 0.01, y0: o.y0, y1: o.y1 };

}

export function segDist( x, z, a, b ) {

	const ax = a[ 0 ] ?? a.x, az = a[ 1 ] ?? a.z, bx = b[ 0 ] ?? b.x, bz = b[ 1 ] ?? b.z;
	const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
	const t = L2 > 1e-9 ? Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / L2 ) ) : 0;
	return Math.hypot( x - ( ax + dx * t ), z - ( az + dz * t ) );

}

// solids from the game's Colliders: solid boxes and cylinders as the grid wants them (y0 / y1: their vertical span)
export function collidersSolids( colliders, cx, cz, R ) {

	const out = [];
	if ( ! colliders ) return out;
	for ( const b of colliders.boxes || [] ) {

		if ( ! b.solid || b.walkable ) continue;
		if ( Math.abs( b.center.x - cx ) > R + b.radius || Math.abs( b.center.z - cz ) > R + b.radius ) continue;
		out.push( { x: b.center.x, z: b.center.z, hx: b.half.x, hz: b.half.z, yaw: b.rotY, y0: b.bottom, y1: b.top } );

	}

	for ( const c of colliders.cylinders || [] ) {

		if ( Math.abs( c.x - cx ) > R + c.radius || Math.abs( c.z - cz ) > R + c.radius ) continue;
		out.push( { x: c.x, z: c.z, r: c.radius, y0: c.yMin, y1: c.yMax } );

	}

	return out;

}
