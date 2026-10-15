// Hull collisions on the water plane (wave 9): the player's boat against every AI ship, and the ships against each other.
// Pure maths on plain records (no engine, no DOM): test/feature-collisions.mjs drives it in node.
//
// Each hull is an oriented box on the water plane (SAT: the hulls float at about the same height, so 2-D is enough):
//   obb2( cx, cz, yaw, hx, hz )            hx half beam, hz half length (boat frame: +Z forward, +X port, yaw about +Y)
//   satOverlap( A, B ) -> { hit, sep, depth, nx, nz }   sep = the largest gap over the four axes (< 0: they overlap by
//                                          depth = -sep along n, which points from A to B)
//   contactPoint( A, B, nx, nz ) -> { x, z }   midway between A's leading corner(s) along n and B's along -n
//   resolveContact( a, b, c ) -> { jn, jt, vClose, jx, jz, dA, dB }   push apart by inverse mass, then a restitution +
//                                          friction impulse at the contact (yaw from the lever arm)
//   ramDamage( self, other, vClose, selfBow, otherBow ) -> hull points   k * m_other / ( m_self + m_other ) * v^2, k scaled
//                                          by the hull (COLLIDE.k * maxHp): a brigantine ramming a skiff at 8 m/s bow-on
//                                          nearly sinks it, a 2 m/s nudge between equals is ~2 % of the hull
//   isBowOn( body, nx, nz, point )         her bow leads into the other hull (heading along n, the contact forward)
//   predictContact( a, b, horizon ) -> { t, dist, side } | null   closest approach of two hulls within `horizon` s
//
//   const world = new CollisionWorld();
//   world.step( time, bodies ) -> contacts [ { a, b, x, z, nx, nz, depth, vClose, jn, damage: { a, b } | null, bowA, bowB } ]
//
// A body: { id, x, z, yaw, hx, hz, mass (for damage), invMass (0: immovable - grounded / moored), invI, vx, vz, w (yaw rate),
// maxHp, noDamage, gentle (coming alongside on purpose: the pair bumps but takes no damage), push( dx, dz ),
// impulse( jx, jz, px, pz ) }. push / impulse act on the real object (the boat
// controller, a Ship) and must refresh the record's x, z, vx, vz, w (the next contact of the frame reads them).
// One damage event per contact: a pair is armed while apart (gap > skin) and fires once when it closes faster than
// minSpeed, at most every COLLIDE.minGap s; rubbing alongside never re-arms it.

export const COLLIDE = {
	restitution: 0.15,
	friction: 0.3,
	k: 0.00944, // of the hull's max points per (m/s)^2 at an even mass split (see ramDamage)
	bowOn: 1.5, // a bow-on hit does x1.5 to the other hull...
	rammer: 0.6, // ...and the rammer takes x0.6
	bowCos: Math.cos( 45 * Math.PI / 180 ), // heading within 45 deg of the contact normal
	bowZ: 0.45, // contact this far forward of amidships (fraction of the half length)
	minGap: 0.4, // s between damage events of one pair
	minSpeed: 0.8, // m/s: slower closing is a touch, no damage
	skin: 0.3, // m: closer than this the pair counts as touching (no re-arm)
	slop: 0.01, // m of overlap left (keeps the contact warm instead of popping in and out)
	maxDv: 12, // m/s cap of one impulse's velocity change (a skiff against a brigantine)
};

const cross = ( rx, rz, nx, nz ) => rz * nx - rx * nz; // (r x n).y about +Y

export function obb2( cx, cz, yaw, hx, hz, out = null ) {

	const s = Math.sin( yaw ), c = Math.cos( yaw );
	// port = ( cos, -sin ), forward = ( sin, cos ) (Ballistics.yawBox)
	if ( ! out ) return { cx, cz, px: c, pz: - s, fx: s, fz: c, hx, hz };
	out.cx = cx; out.cz = cz; out.px = c; out.pz = - s; out.fx = s; out.fz = c; out.hx = hx; out.hz = hz;
	return out;

}

export function corners( b, out = [ {}, {}, {}, {} ] ) {

	let i = 0;
	for ( const sx of [ 1, - 1 ] ) for ( const sz of [ 1, - 1 ] ) {

		const o = out[ i ++ ];
		o.x = b.cx + b.px * b.hx * sx + b.fx * b.hz * sz;
		o.z = b.cz + b.pz * b.hx * sx + b.fz * b.hz * sz;

	}

	return out;

}

// projection radius of box b on the unit axis ( lx, lz )
const radius = ( b, lx, lz ) => b.hx * Math.abs( b.px * lx + b.pz * lz ) + b.hz * Math.abs( b.fx * lx + b.fz * lz );

export function satOverlap( A, B, out = {} ) {

	// the four axes in order (A port, A forward, B port, B forward); the first largest gap wins (no array per call)
	out.sep = - Infinity;
	out.nx = 1;
	out.nz = 0;
	satAxis( A, B, A.px, A.pz, out );
	satAxis( A, B, A.fx, A.fz, out );
	satAxis( A, B, B.px, B.pz, out );
	satAxis( A, B, B.fx, B.fz, out );
	const best = out.sep;
	out.hit = best < 0;
	out.depth = best < 0 ? - best : 0;
	return out;

}

function satAxis( A, B, lx, lz, out ) {

	const d = ( B.cx - A.cx ) * lx + ( B.cz - A.cz ) * lz;
	const sep = Math.abs( d ) - ( radius( A, lx, lz ) + radius( B, lx, lz ) );
	if ( sep > out.sep ) {

		out.sep = sep;
		const sg = d < 0 ? - 1 : 1;
		out.nx = lx * sg;
		out.nz = lz * sg;

	}

}

// the corners of b furthest along ( nx, nz ), averaged when an edge leads (within tol m)
function support( b, nx, nz, tol = 0.15 ) {

	const cs = corners( b );
	let mx = - Infinity;
	for ( const c of cs ) mx = Math.max( mx, c.x * nx + c.z * nz );
	let x = 0, z = 0, n = 0;
	for ( const c of cs ) if ( c.x * nx + c.z * nz >= mx - tol ) { x += c.x; z += c.z; n ++; }
	return { x: x / n, z: z / n };

}

export function contactPoint( A, B, nx, nz ) {

	const a = support( A, nx, nz ), b = support( B, - nx, - nz );
	return { x: ( a.x + b.x ) / 2, z: ( a.z + b.z ) / 2 };

}

// the bow leads into the contact: heading along the normal toward the other hull, and the contact forward of amidships
export function isBowOn( body, nx, nz, p ) {

	const fx = Math.sin( body.yaw ), fz = Math.cos( body.yaw );
	if ( fx * nx + fz * nz < COLLIDE.bowCos ) return false;
	const lz = ( p.x - body.x ) * fx + ( p.z - body.z ) * fz;
	return lz > COLLIDE.bowZ * body.hz;

}

// Hull points one hull loses: k * maxHp * m_other / ( m_self + m_other ) * v^2, x1.5 if the other rammed bow-on,
// x0.6 if this one did the ramming.
export function ramDamage( self, other, vClose, selfBow = false, otherBow = false ) {

	if ( ! ( vClose > COLLIDE.minSpeed ) || self.noDamage ) return 0;
	const ms = Math.max( 1, self.mass ), mo = Math.max( 1, other.mass );
	let d = COLLIDE.k * ( self.maxHp || 100 ) * ( mo / ( ms + mo ) ) * vClose * vClose;
	if ( otherBow ) d *= COLLIDE.bowOn;
	if ( selfBow ) d *= COLLIDE.rammer;
	return d;

}

// moment of inertia about the vertical of a box hull of mass m, length 2 hz, beam 2 hx
export const yawInertia = ( m, hx, hz ) => m * ( 4 * hz * hz + 4 * hx * hx ) / 12;

// Push a and b apart along n (A -> B) by inverse mass and apply the impulse at the contact. Returns what was done.
export function resolveContact( a, b, c ) {

	const nx = c.nx, nz = c.nz, px = c.x, pz = c.z;
	const ia = a.invMass || 0, ib = b.invMass || 0;
	const tot = ia + ib;
	const res = { jn: 0, jt: 0, vClose: 0, jx: 0, jz: 0, dA: { x: 0, z: 0 }, dB: { x: 0, z: 0 } };
	if ( tot <= 0 ) return res;
	// relative velocity of the contact points (B minus A), yaw rates included: w x r = ( w rz, - w rx )
	const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
	const vax = a.vx + ( a.w || 0 ) * raz, vaz = a.vz - ( a.w || 0 ) * rax;
	const vbx = b.vx + ( b.w || 0 ) * rbz, vbz = b.vz - ( b.w || 0 ) * rbx;
	const rvx = vbx - vax, rvz = vbz - vaz;
	const vn = rvx * nx + rvz * nz;
	res.vClose = Math.max( 0, - vn );

	// 1. separation by the inverse-mass ratio
	const corr = Math.max( 0, c.depth - COLLIDE.slop );
	if ( corr > 0 ) {

		const ka = corr * ia / tot, kb = corr * ib / tot;
		res.dA.x = - nx * ka; res.dA.z = - nz * ka;
		res.dB.x = nx * kb; res.dB.z = nz * kb;
		if ( ka > 0 && a.push ) a.push( res.dA.x, res.dA.z );
		if ( kb > 0 && b.push ) b.push( res.dB.x, res.dB.z );

	}

	if ( vn >= 0 ) return res; // already parting: no impulse

	// 2. restitution along the normal, friction along the tangent (Coulomb, |jt| <= mu jn)
	const iia = a.invI || 0, iib = b.invI || 0;
	const can = cross( rax, raz, nx, nz ), cbn = cross( rbx, rbz, nx, nz );
	const kn = tot + iia * can * can + iib * cbn * cbn;
	let jn = - ( 1 + COLLIDE.restitution ) * vn / kn;
	// a skiff against a brigantine: cap the velocity change of the light one
	const cap = COLLIDE.maxDv / Math.max( ia, ib );
	if ( jn > cap ) jn = cap;
	const tx = - nz, tz = nx;
	const vt = rvx * tx + rvz * tz;
	const cat = cross( rax, raz, tx, tz ), cbt = cross( rbx, rbz, tx, tz );
	const kt = tot + iia * cat * cat + iib * cbt * cbt;
	let jt = - vt / kt;
	const lim = COLLIDE.friction * jn;
	jt = jt < - lim ? - lim : jt > lim ? lim : jt;
	const jx = nx * jn + tx * jt, jz = nz * jn + tz * jt; // on B; A gets the opposite
	res.jn = jn; res.jt = jt; res.jx = jx; res.jz = jz;
	if ( ia > 0 && a.impulse ) a.impulse( - jx, - jz, px, pz );
	if ( ib > 0 && b.impulse ) b.impulse( jx, jz, px, pz );
	return res;

}

// Two hulls moving straight on: when do their centres first come within a contact reach (0.8 of the half lengths + 2 m)?
// { t (s), dist (m between centres at the closest approach), side (+1: b is to a's port) } when that is within `horizon`
// s and they are closing; else null.
export function predictContact( a, b, horizon = 3 ) {

	const dx = b.x - a.x, dz = b.z - a.z, vx = b.vx - a.vx, vz = b.vz - a.vz;
	const v2 = vx * vx + vz * vz;
	if ( v2 < 1e-4 || dx * vx + dz * vz >= 0 ) return null; // not closing
	const reach = Math.max( a.hx, a.hz * 0.8 ) + Math.max( b.hx, b.hz * 0.8 ) + 2;
	const tc = - ( dx * vx + dz * vz ) / v2;
	const cx = dx + vx * tc, cz = dz + vz * tc, dist = Math.hypot( cx, cz );
	if ( dist > reach ) return null; // they pass clear
	// first time |d + v t| = reach
	const B = dx * vx + dz * vz, C = dx * dx + dz * dz - reach * reach;
	const t = C <= 0 ? 0 : ( - B - Math.sqrt( Math.max( 0, B * B - v2 * C ) ) ) / v2;
	if ( t > horizon ) return null;
	// which side of a's heading b is on (at the closest point; dead ahead: where she is now)
	const px = Math.cos( a.yaw ), pz = - Math.sin( a.yaw );
	let lat = cx * px + cz * pz;
	if ( Math.abs( lat ) < 0.5 ) lat = dx * px + dz * pz;
	return { t, dist, side: lat >= 0 ? 1 : - 1 };

}

// Broad phase (wave 12D): bodies are binned in GRID.cell m squares and a body only meets the bodies of its own and the
// eight cells round it; the pairs are still visited in the brute-force order (i < j by list index), so contacts resolve
// exactly as before. Under GRID.min bodies (or a body longer than a cell) the plain loop is used: measured in node, the
// plain loop with its box reject costs 1 us for 13 hulls and 20 us for 64 (the grid 5 / 21 us), the grid wins from ~64
// (128 hulls: 47 against 78 us). A world of 12 AI ships and a few player boats stays on the plain loop.
export const GRID = { cell: 64, min: 64 };

export class CollisionWorld {

	constructor() {

		this.pairs = new Map(); // 'idA|idB' -> { key, armed, last, seen }
		this.contacts = [];
		this._frame = 0;
		this._sat = {};
		this._A = {};
		this._B = {};
		this._rad = [];
		this._cells = new Map(); // cell key -> [ body index ]
		this._cellOf = [];
		this._cand = [];
		this.stats = { tested: 0, grid: false };

	}

	_pair( a, b ) {

		const k = a.id < b.id ? `${ a.id }|${ b.id }` : `${ b.id }|${ a.id }`;
		let p = this.pairs.get( k );
		if ( ! p ) {

			p = { key: k, armed: true, last: - Infinity, seen: 0 };
			this.pairs.set( k, p );

		}

		p.seen = this._frame;
		return p;

	}

	// bin every body; false when the grid cannot be used this step (a reach longer than a cell)
	_bin( bodies, rad ) {

		const cells = this._cells, cellOf = this._cellOf, C = GRID.cell;
		for ( const list of cells.values() ) list.length = 0;
		let maxR = 0;
		for ( let i = 0; i < bodies.length; i ++ ) {

			const b = bodies[ i ];
			if ( rad[ i ] > maxR ) maxR = rad[ i ];
			// cell keys as one number (|cx|, |cz| < 2^20: +-67 000 km of sea)
			const k = ( Math.floor( b.x / C ) + 524288 ) * 1048576 + ( Math.floor( b.z / C ) + 524288 );
			cellOf[ i ] = k;
			let list = cells.get( k );
			if ( ! list ) cells.set( k, list = [] );
			list.push( i );

		}

		// a pair within reach is within one cell of each other while 2 maxR + skin (+ a push of a few m) stays under a cell
		if ( 2 * maxR + COLLIDE.skin + 4 > C || ! Number.isFinite( maxR ) ) return false;
		if ( cells.size > 4 * bodies.length + 64 ) cells.clear(); // (forget cells nobody uses any more)
		return true;

	}

	// the bodies after i (list order) in the 3 x 3 cells round body i, ascending
	_candidates( i ) {

		const out = this._cand, cells = this._cells, k = this._cellOf[ i ];
		out.length = 0;
		for ( let dx = - 1; dx <= 1; dx ++ ) for ( let dz = - 1; dz <= 1; dz ++ ) {

			const list = cells.get( k + dx * 1048576 + dz );
			if ( ! list ) continue;
			for ( let m = 0; m < list.length; m ++ ) if ( list[ m ] > i ) out.push( list[ m ] );

		}

		if ( out.length > 1 ) out.sort( ascending );
		return out;

	}

	_test( time, a, b, ra, rb, out ) {

		this.stats.tested ++;
		const reach = ra + rb + COLLIDE.skin;
		if ( Math.abs( b.x - a.x ) > reach || Math.abs( b.z - a.z ) > reach ) return;
		const A = obb2( a.x, a.z, a.yaw, a.hx, a.hz, this._A ), B = obb2( b.x, b.z, b.yaw, b.hx, b.hz, this._B );
		const s = satOverlap( A, B, this._sat );
		if ( s.sep > COLLIDE.skin ) return; // apart: the pair re-arms below (not seen this frame)
		const p = this._pair( a, b );
		if ( ! s.hit ) return; // within the skin: touching, nothing to resolve
		const nx = s.nx, nz = s.nz, depth = s.depth;
		const pt = contactPoint( A, B, nx, nz );
		const c = { a, b, x: pt.x, z: pt.z, nx, nz, depth, vClose: 0, jn: 0, damage: null, bowA: false, bowB: false };
		const bowA = isBowOn( a, nx, nz, pt ), bowB = isBowOn( b, - nx, - nz, pt );
		const r = resolveContact( a, b, c );
		c.vClose = r.vClose;
		c.jn = r.jn;
		c.bowA = bowA;
		c.bowB = bowB;
		if ( p.armed && ! a.gentle && ! b.gentle && r.vClose > COLLIDE.minSpeed && time - p.last >= COLLIDE.minGap ) {

			p.armed = false;
			p.last = time;
			c.damage = { a: ramDamage( a, b, r.vClose, bowA, bowB ), b: ramDamage( b, a, r.vClose, bowB, bowA ) };

		}

		out.push( c );

	}

	// test every pair (bodies within reach of each other), resolve the overlapping ones; returns this frame's contacts
	step( time, bodies ) {

		this._frame ++;
		const out = this.contacts;
		out.length = 0;
		const n = bodies.length;
		const rad = this._rad;
		rad.length = n;
		for ( let i = 0; i < n; i ++ ) rad[ i ] = Math.hypot( bodies[ i ].hx, bodies[ i ].hz );
		const grid = n >= GRID.min && this._bin( bodies, rad );
		this.stats.grid = grid;
		for ( let i = 0; i < n; i ++ ) {

			const a = bodies[ i ];
			if ( grid ) {

				const cand = this._candidates( i );
				for ( let m = 0; m < cand.length; m ++ ) {

					const j = cand[ m ];
					this._test( time, a, bodies[ j ], rad[ i ], rad[ j ], out );

				}

			} else for ( let j = i + 1; j < n; j ++ ) this._test( time, a, bodies[ j ], rad[ i ], rad[ j ], out );

		}

		// pairs not touching this frame are apart again: armed for the next blow (and forgotten after a while)
		for ( const p of this.pairs.values() ) {

			if ( p.seen === this._frame ) continue;
			p.armed = true;
			if ( time - p.last > 30 ) this.pairs.delete( p.key );

		}

		return out;

	}

	clear() {

		this.pairs.clear();
		this.contacts.length = 0;

	}

}

const ascending = ( a, b ) => a - b;
