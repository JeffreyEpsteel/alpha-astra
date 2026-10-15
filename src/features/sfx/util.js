// Small helpers shared by the sfx parts (plain numbers and { x, y, z } / { x, y, z, w } objects, no engine types).

export const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const num = ( v, d ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
export const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// rotates v by quaternion q ( x, y, z, w ), or by its inverse
export function rotate( q, v, inverse = false ) {

	const s = inverse ? - 1 : 1;
	const qx = s * q.x, qy = s * q.y, qz = s * q.z, qw = q.w;
	const tx = 2 * ( qy * v.z - qz * v.y ), ty = 2 * ( qz * v.x - qx * v.z ), tz = 2 * ( qx * v.y - qy * v.x );
	return {
		x: v.x + qw * tx + ( qy * tz - qz * ty ),
		y: v.y + qw * ty + ( qz * tx - qx * tz ),
		z: v.z + qw * tz + ( qx * ty - qy * tx ),
	};

}
