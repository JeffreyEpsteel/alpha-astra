// Buoyancy and water drag for loose bodies (backend independent: plain math on the body's pose).
// A body is a box (half extents), a sphere or a cylinder; the submerged fraction comes from the depth of its lowest point
// below the local surface over its vertical extent, so a plank floats flat and a 600 kg/m3 crate floats a little over half
// under. Drag is linear in velocity and scales with the submerged fraction (stronger vertically: it damps the bobbing).

export const WATER_DENSITY = 1000;
const LIN_DRAG = 0.9; // 1/s per unit submerged fraction, horizontal
const VERT_DRAG = 2.2; // 1/s, vertical

// vertical half extent of a box with half extents (hx, hy, hz) turned by quaternion q
export function verticalExtent( shape, hx, hy, hz, r, q ) {

	if ( shape === 'sphere' ) return r;
	const { x, y, z, w } = q;
	// row 1 of the rotation matrix: how much of each local axis points up
	const r10 = 2 * ( x * y + w * z ), r11 = 1 - 2 * ( x * x + z * z ), r12 = 2 * ( y * z - w * x );
	if ( shape === 'cylinder' ) {

		// axis along local y: half height times |up . axis| plus the radius times the axis' horizontal spread
		const a = Math.abs( r11 );
		return hy * a + r * Math.sqrt( Math.max( 0, 1 - a * a ) );

	}

	return Math.abs( r10 ) * hx + Math.abs( r11 ) * hy + Math.abs( r12 ) * hz;

}

// force on the body this step (out.fx..fz, out.frac). gravity: m/s^2 (positive number)
export function buoyancy( body, surfaceY, gravity, out ) {

	const p = body.position, v = body.velocity;
	const h = verticalExtent( body.shape, body.hx, body.hy, body.hz, body.radius, body.quaternion );
	const bottom = p.y - h;
	const frac = h > 1e-4 ? Math.min( 1, Math.max( 0, ( surfaceY - bottom ) / ( 2 * h ) ) ) : 0;
	out.frac = frac;
	if ( frac <= 0 ) { out.fx = 0; out.fy = 0; out.fz = 0; return out; }
	const lift = WATER_DENSITY * gravity * body.volume * frac * body.buoyancy;
	const m = body.mass;
	out.fx = - m * LIN_DRAG * frac * v.x;
	out.fy = lift - m * VERT_DRAG * frac * v.y;
	out.fz = - m * LIN_DRAG * frac * v.z;
	return out;

}
