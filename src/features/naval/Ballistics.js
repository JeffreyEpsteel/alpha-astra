// Cannonball ballistics and hit tests (pure maths, plain numbers: no engine objects).
//
//   solveElevation( speed, dist, dy )         low-arc launch angle (rad) to hit a target `dist` away horizontally and `dy`
//                                             higher, no drag; null when out of range
//   leadAim( S, Vs, T, Vt, speed )            launch direction (unit) that meets a moving target: the ball leaves with
//                                             velocity dir * speed + Vs (the ship's own velocity)
//   stepBall( b, dt )                         exact constant-gravity step of { x, y, z, vx, vy, vz }
//   segmentVsObb( p0, p1, box, radius )       first hit fraction (0..1) of a segment against an oriented box, or -1
//   yawBox( cx, cy, cz, yaw, hx, hy, hz )     box turned about Y by `yaw` (boat frame: +Z forward, +X port)
//   quatBox( c, q, half )                     box turned by a quaternion { x, y, z, w }
//   impactTime( S, V, floor )                 when a ball from S with velocity V comes down to y = floor (s), or null
//   arcPoints( S, V, opts )                   the flight sampled for a preview: [ { x, y, z, t } ] (AimAssist's dots)
//
// Points are { x, y, z }. Gravity is 9.81 m/s^2; the muzzle speed is MUZZLE_SPEED unless the gun says otherwise.

export const GRAVITY = 9.81;
export const MUZZLE_SPEED = 120;

// Low-arc (or, with high = true, lob) elevation angle to reach (dist, dy) at `speed`.
export function solveElevation( speed, dist, dy = 0, high = false, g = GRAVITY ) {

	const v2 = speed * speed;
	if ( dist < 1e-6 ) return dy >= 0 ? Math.PI / 2 : - Math.PI / 2;
	const disc = v2 * v2 - g * ( g * dist * dist + 2 * dy * v2 );
	if ( disc < 0 ) return null;
	const root = Math.sqrt( disc );
	return Math.atan( ( v2 + ( high ? root : - root ) ) / ( g * dist ) );

}

// Time of flight for a launch at `elevation` over a horizontal distance.
export const flightTime = ( speed, elevation, dist ) => dist / Math.max( speed * Math.cos( elevation ), 1e-6 );

// Where a moving target will be hit: iterate the flight time. S, Vs: shooter position / velocity (the ball inherits Vs);
// T, Vt: target. Returns { dir: { x, y, z } unit, t, miss } or null when the target is out of range.
export function leadAim( S, Vs, T, Vt, speed = MUZZLE_SPEED, g = GRAVITY ) {

	// the ball (velocity Vs + u, |u| = speed) meets the target at time t when
	//   u(t) = ( T - S ) / t + ( Vt - Vs ) + g t / 2 ( up )
	// take the first t (the flat arc) where |u(t)| drops to the muzzle speed: scan, then bisect
	const ux = ( t ) => ( T.x - S.x ) / t + Vt.x - Vs.x;
	const uz = ( t ) => ( T.z - S.z ) / t + Vt.z - Vs.z;
	const uy = ( t ) => ( T.y - S.y ) / t + ( ( Vt.y || 0 ) - ( Vs.y || 0 ) ) + 0.5 * g * t;
	const f = ( t ) => ux( t ) ** 2 + uy( t ) ** 2 + uz( t ) ** 2 - speed * speed;
	const h = 0.04;
	let a = 0.04;
	if ( f( a ) <= 0 ) return null; // closer than the gun can aim (inside the first 4 cm of flight)
	let b = - 1;
	for ( let t = a + h; t < 16; t += h ) {

		if ( f( t ) <= 0 ) { b = t; break; }
		a = t;

	}

	if ( b < 0 ) return null; // out of range
	for ( let i = 0; i < 24; i ++ ) {

		const m = ( a + b ) / 2;
		if ( f( m ) > 0 ) a = m; else b = m;

	}

	const t = ( a + b ) / 2;
	const x = ux( t ), y = uy( t ), z = uz( t );
	const m = Math.hypot( x, y, z );
	return { dir: { x: x / m, y: y / m, z: z / m }, t };

}

// When a ball launched from S with velocity V comes down through y = floor (the later root), or null if it never does.
export function impactTime( S, V, floor = 0, g = GRAVITY ) {

	const h = S.y - floor, vy = V.y || 0;
	const disc = vy * vy + 2 * g * h;
	if ( disc < 0 ) return null;
	const t = ( vy + Math.sqrt( disc ) ) / g;
	return t > 0 ? t : null;

}

// The flight of a ball from S with velocity V, sampled every `step` s up to `maxT` (default: until it comes down to
// `floor`), at most `max` points. Plain objects { x, y, z, t }.
export function arcPoints( S, V, { step = 0.08, maxT = null, floor = 0, max = 64, g = GRAVITY } = {} ) {

	const end = maxT ?? impactTime( S, V, floor, g ) ?? 6;
	const n = Math.max( 2, Math.min( max, Math.ceil( end / step ) + 1 ) );
	const out = [];
	for ( let i = 0; i < n; i ++ ) {

		const t = end * i / ( n - 1 );
		out.push( { x: S.x + V.x * t, y: S.y + V.y * t - 0.5 * g * t * t, z: S.z + V.z * t, t } );

	}

	return out;

}

// One step of a ball: constant gravity, exact. Returns the ball.
export function stepBall( b, dt, g = GRAVITY, drift = null ) {

	if ( drift ) {

		b.vx += drift.x * dt;
		b.vz += drift.z * dt;

	}

	b.x += b.vx * dt;
	b.z += b.vz * dt;
	b.y += b.vy * dt - 0.5 * g * dt * dt;
	b.vy -= g * dt;
	return b;

}

// ---- boxes: { c: { x, y, z }, a: [ ax, ay, az ] axes (unit, world), h: [ hx, hy, hz ] half extents }

export function yawBox( cx, cy, cz, yaw, hx, hy, hz ) {

	const s = Math.sin( yaw ), c = Math.cos( yaw );
	// local +X is port, +Z forward: forward = ( sin, 0, cos ), port = ( cos, 0, -sin )
	return { c: { x: cx, y: cy, z: cz }, a: [ { x: c, y: 0, z: - s }, { x: 0, y: 1, z: 0 }, { x: s, y: 0, z: c } ], h: [ hx, hy, hz ] };

}

// v rotated by the unit quaternion q: v + w t + q.xyz x t, t = 2 q.xyz x v
function rotate( q, v ) {

	const tx = 2 * ( q.y * v.z - q.z * v.y ), ty = 2 * ( q.z * v.x - q.x * v.z ), tz = 2 * ( q.x * v.y - q.y * v.x );
	return {
		x: v.x + q.w * tx + ( q.y * tz - q.z * ty ),
		y: v.y + q.w * ty + ( q.z * tx - q.x * tz ),
		z: v.z + q.w * tz + ( q.x * ty - q.y * tx ),
	};

}

export function quatBox( c, q, half ) {

	return { c: { x: c.x, y: c.y, z: c.z }, a: [ rotate( q, { x: 1, y: 0, z: 0 } ), rotate( q, { x: 0, y: 1, z: 0 } ), rotate( q, { x: 0, y: 0, z: 1 } ) ], h: half.slice() };

}

export { rotate as rotateByQuat };

// First contact of the segment p0 -> p1 with the box inflated by `radius` (slab test in the box frame):
// the fraction along the segment, or -1.
export function segmentVsObb( p0, p1, box, radius = 0 ) {

	let tmin = 0, tmax = 1;
	const ox = p0.x - box.c.x, oy = p0.y - box.c.y, oz = p0.z - box.c.z;
	const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
	for ( let i = 0; i < 3; i ++ ) {

		const a = box.a[ i ], h = box.h[ i ] + radius;
		const o = ox * a.x + oy * a.y + oz * a.z;
		const d = dx * a.x + dy * a.y + dz * a.z;
		if ( Math.abs( d ) < 1e-9 ) {

			if ( Math.abs( o ) > h ) return - 1;
			continue;

		}

		let t1 = ( - h - o ) / d, t2 = ( h - o ) / d;
		if ( t1 > t2 ) { const t = t1; t1 = t2; t2 = t; }
		if ( t1 > tmin ) tmin = t1;
		if ( t2 < tmax ) tmax = t2;
		if ( tmin > tmax ) return - 1;

	}

	return tmin;

}

// Does the segment p0 -> p1 pass within r of the point c? (broad phase)
export function segmentNearPoint( p0, p1, c, r ) {

	const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
	const l2 = dx * dx + dy * dy + dz * dz;
	let t = l2 > 0 ? ( ( c.x - p0.x ) * dx + ( c.y - p0.y ) * dy + ( c.z - p0.z ) * dz ) / l2 : 0;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const x = p0.x + dx * t - c.x, y = p0.y + dy * t - c.y, z = p0.z + dz * t - c.z;
	return x * x + y * y + z * z <= r * r;

}
