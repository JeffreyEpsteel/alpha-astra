// Small allocation-free vector / quaternion helpers for the contact IK (src/player/ik). Vectors are Float64Array( 3 ),
// quaternions Float64Array( 4 ) as [ x, y, z, w ] (the glTF / SkinnedModel order); every function writes into `o` and is
// safe when `o` aliases an input. Plain arrays instead of the engine's Vector3 / Quaternion so the per-frame pass does
// no getter / setter work and never allocates.

export const vec = ( x = 0, y = 0, z = 0 ) => {

	const v = new Float64Array( 3 );
	v[ 0 ] = x; v[ 1 ] = y; v[ 2 ] = z;
	return v;

};

export const quat = () => {

	const q = new Float64Array( 4 );
	q[ 3 ] = 1;
	return q;

};

export function set3( o, x, y, z ) {

	o[ 0 ] = x; o[ 1 ] = y; o[ 2 ] = z;
	return o;

}

export function copy3( o, a ) {

	o[ 0 ] = a[ 0 ]; o[ 1 ] = a[ 1 ]; o[ 2 ] = a[ 2 ];
	return o;

}

export function sub3( o, a, b ) {

	o[ 0 ] = a[ 0 ] - b[ 0 ]; o[ 1 ] = a[ 1 ] - b[ 1 ]; o[ 2 ] = a[ 2 ] - b[ 2 ];
	return o;

}

export function add3( o, a, b ) {

	o[ 0 ] = a[ 0 ] + b[ 0 ]; o[ 1 ] = a[ 1 ] + b[ 1 ]; o[ 2 ] = a[ 2 ] + b[ 2 ];
	return o;

}

// o = a + b * s
export function addScaled3( o, a, b, s ) {

	o[ 0 ] = a[ 0 ] + b[ 0 ] * s; o[ 1 ] = a[ 1 ] + b[ 1 ] * s; o[ 2 ] = a[ 2 ] + b[ 2 ] * s;
	return o;

}

export function scale3( o, a, s ) {

	o[ 0 ] = a[ 0 ] * s; o[ 1 ] = a[ 1 ] * s; o[ 2 ] = a[ 2 ] * s;
	return o;

}

export function lerp3( o, a, b, t ) {

	o[ 0 ] = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t; o[ 1 ] = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t; o[ 2 ] = a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t;
	return o;

}

export const dot3 = ( a, b ) => a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];
export const len3 = ( a ) => Math.sqrt( a[ 0 ] * a[ 0 ] + a[ 1 ] * a[ 1 ] + a[ 2 ] * a[ 2 ] );

export function dist3( a, b ) {

	const x = a[ 0 ] - b[ 0 ], y = a[ 1 ] - b[ 1 ], z = a[ 2 ] - b[ 2 ];
	return Math.sqrt( x * x + y * y + z * z );

}

export function cross3( o, a, b ) {

	const x = a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], y = a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], z = a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ];
	o[ 0 ] = x; o[ 1 ] = y; o[ 2 ] = z;
	return o;

}

// normalize into o; returns the length before (0: o is left as a)
export function norm3( o, a ) {

	const l = len3( a );
	if ( l > 1e-12 ) scale3( o, a, 1 / l );
	else copy3( o, a );
	return l;

}

// normalize in place-or-into o; false (o left as a) when a is (nearly) zero. Returns a boolean, not the length: a double
// returned from a call V8 does not inline is boxed, and these run every frame
export function unit3( o, a ) {

	const x = a[ 0 ], y = a[ 1 ], z = a[ 2 ], l2 = x * x + y * y + z * z;
	if ( l2 < 1e-24 ) { o[ 0 ] = x; o[ 1 ] = y; o[ 2 ] = z; return false; }
	const k = 1 / Math.sqrt( l2 );
	o[ 0 ] = x * k; o[ 1 ] = y * k; o[ 2 ] = z * k;
	return true;

}

// angle between two vectors (any length), robust near 0 and pi
export function angle3( a, b ) {

	const cx = a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], cy = a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], cz = a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ];
	return Math.atan2( Math.sqrt( cx * cx + cy * cy + cz * cz ), dot3( a, b ) );

}

// ---- quaternions

export function copy4( o, a ) {

	o[ 0 ] = a[ 0 ]; o[ 1 ] = a[ 1 ]; o[ 2 ] = a[ 2 ]; o[ 3 ] = a[ 3 ];
	return o;

}

export function identity4( o ) {

	o[ 0 ] = 0; o[ 1 ] = 0; o[ 2 ] = 0; o[ 3 ] = 1;
	return o;

}

// o = a * b (b first, then a)
export function mul4( o, a, b ) {

	const ax = a[ 0 ], ay = a[ 1 ], az = a[ 2 ], aw = a[ 3 ], bx = b[ 0 ], by = b[ 1 ], bz = b[ 2 ], bw = b[ 3 ];
	o[ 0 ] = ax * bw + aw * bx + ay * bz - az * by;
	o[ 1 ] = ay * bw + aw * by + az * bx - ax * bz;
	o[ 2 ] = az * bw + aw * bz + ax * by - ay * bx;
	o[ 3 ] = aw * bw - ax * bx - ay * by - az * bz;
	return o;

}

export function conj4( o, a ) {

	o[ 0 ] = - a[ 0 ]; o[ 1 ] = - a[ 1 ]; o[ 2 ] = - a[ 2 ]; o[ 3 ] = a[ 3 ];
	return o;

}

export function norm4( o, a ) {

	const l = Math.sqrt( a[ 0 ] * a[ 0 ] + a[ 1 ] * a[ 1 ] + a[ 2 ] * a[ 2 ] + a[ 3 ] * a[ 3 ] );
	if ( l < 1e-12 ) return identity4( o );
	const k = 1 / l;
	o[ 0 ] = a[ 0 ] * k; o[ 1 ] = a[ 1 ] * k; o[ 2 ] = a[ 2 ] * k; o[ 3 ] = a[ 3 ] * k;
	return o;

}

// rotation of `angle` about a unit axis
export function axisAngle4( o, axis, angle ) {

	const s = Math.sin( angle / 2 );
	o[ 0 ] = axis[ 0 ] * s; o[ 1 ] = axis[ 1 ] * s; o[ 2 ] = axis[ 2 ] * s; o[ 3 ] = Math.cos( angle / 2 );
	return o;

}

// o = q v q*
export function rot3( o, q, v ) {

	const qx = q[ 0 ], qy = q[ 1 ], qz = q[ 2 ], qw = q[ 3 ], vx = v[ 0 ], vy = v[ 1 ], vz = v[ 2 ];
	const tx = 2 * ( qy * vz - qz * vy ), ty = 2 * ( qz * vx - qx * vz ), tz = 2 * ( qx * vy - qy * vx );
	o[ 0 ] = vx + qw * tx + qy * tz - qz * ty;
	o[ 1 ] = vy + qw * ty + qz * tx - qx * tz;
	o[ 2 ] = vz + qw * tz + qx * ty - qy * tx;
	return o;

}

// shortest arc from unit vector a to unit vector b
export function fromUnit4( o, a, b ) {

	let r = dot3( a, b ) + 1;
	if ( r < 1e-9 ) {

		// opposite: any axis perpendicular to a
		r = 0;
		if ( Math.abs( a[ 0 ] ) > Math.abs( a[ 2 ] ) ) { o[ 0 ] = - a[ 1 ]; o[ 1 ] = a[ 0 ]; o[ 2 ] = 0; }
		else { o[ 0 ] = 0; o[ 1 ] = - a[ 2 ]; o[ 2 ] = a[ 1 ]; }
		o[ 3 ] = r;

	} else {

		const x = a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], y = a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], z = a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ];
		o[ 0 ] = x; o[ 1 ] = y; o[ 2 ] = z; o[ 3 ] = r;

	}

	return norm4( o, o );

}

// nlerp a -> b by t along the shorter arc
export function nlerp4( o, a, b, t ) {

	const s = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] < 0 ? - t : t, k = 1 - t;
	o[ 0 ] = a[ 0 ] * k + b[ 0 ] * s; o[ 1 ] = a[ 1 ] * k + b[ 1 ] * s; o[ 2 ] = a[ 2 ] * k + b[ 2 ] * s; o[ 3 ] = a[ 3 ] * k + b[ 3 ] * s;
	return norm4( o, o );

}

// a fraction t of a rotation (identity -> q)
export function scaleAngle4( o, q, t ) {

	if ( t >= 1 ) return copy4( o, q );
	const w = q[ 3 ] < 0 ? - 1 : 1; // the short way round
	const ang = 2 * Math.acos( Math.min( 1, Math.abs( q[ 3 ] ) ) );
	const s = Math.sin( ang / 2 );
	if ( s < 1e-9 || t <= 0 ) return identity4( o );
	const k = w / s, h = ang * t / 2, sh = Math.sin( h );
	o[ 0 ] = q[ 0 ] * k * sh; o[ 1 ] = q[ 1 ] * k * sh; o[ 2 ] = q[ 2 ] * k * sh; o[ 3 ] = Math.cos( h );
	return o;

}

// the rotation angle of q (0..pi)
export const angle4 = ( q ) => 2 * Math.acos( Math.min( 1, Math.abs( q[ 3 ] ) ) );

// limit the rotation angle of q to max (radians), keeping its axis
export function clampAngle4( o, q, max ) {

	const a = angle4( q );
	if ( a <= max ) return copy4( o, q );
	return scaleAngle4( o, q, max / a );

}

// rotation part of a column-major 4x4 (uniform scale allowed) -> quaternion
export function quatFromMat4( o, e ) {

	const sx = Math.sqrt( e[ 0 ] * e[ 0 ] + e[ 1 ] * e[ 1 ] + e[ 2 ] * e[ 2 ] ) || 1;
	const k = 1 / sx;
	const m11 = e[ 0 ] * k, m12 = e[ 4 ] * k, m13 = e[ 8 ] * k, m21 = e[ 1 ] * k, m22 = e[ 5 ] * k, m23 = e[ 9 ] * k, m31 = e[ 2 ] * k, m32 = e[ 6 ] * k, m33 = e[ 10 ] * k;
	const tr = m11 + m22 + m33;
	if ( tr > 0 ) {

		const s = 0.5 / Math.sqrt( tr + 1 );
		o[ 3 ] = 0.25 / s; o[ 0 ] = ( m32 - m23 ) * s; o[ 1 ] = ( m13 - m31 ) * s; o[ 2 ] = ( m21 - m12 ) * s;

	} else if ( m11 > m22 && m11 > m33 ) {

		const s = 2 * Math.sqrt( 1 + m11 - m22 - m33 );
		o[ 3 ] = ( m32 - m23 ) / s; o[ 0 ] = 0.25 * s; o[ 1 ] = ( m12 + m21 ) / s; o[ 2 ] = ( m13 + m31 ) / s;

	} else if ( m22 > m33 ) {

		const s = 2 * Math.sqrt( 1 + m22 - m11 - m33 );
		o[ 3 ] = ( m13 - m31 ) / s; o[ 0 ] = ( m12 + m21 ) / s; o[ 1 ] = 0.25 * s; o[ 2 ] = ( m23 + m32 ) / s;

	} else {

		const s = 2 * Math.sqrt( 1 + m33 - m11 - m22 );
		o[ 3 ] = ( m21 - m12 ) / s; o[ 0 ] = ( m13 + m31 ) / s; o[ 1 ] = ( m23 + m32 ) / s; o[ 2 ] = 0.25 * s;

	}

	return norm4( o, o );

}

export const smoothstep = ( x ) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * ( 3 - 2 * x );
export const clamp = ( x, a, b ) => x < a ? a : x > b ? b : x;
// move x toward t by at most step
export const toward = ( x, t, step ) => x < t ? Math.min( t, x + step ) : Math.max( t, x - step );
