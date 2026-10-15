import { vec, quat, sub3, add3, copy3, cross3, unit3, mul4, conj4, rot3, fromUnit4, identity4, copy4, norm4 } from './ikmath.js';

// IK solvers on joint positions (any one space; the rig pass uses the model space). They return world delta rotations
// (about each joint) and never touch a skeleton, so they are tested on bare chains (test/feature-ik.mjs).
//
//   solveTwoBone( a, b, c, t, out, opts )   analytic hip-knee-ankle / shoulder-elbow-wrist
//   solveCCD( pos, n, eff, target, limits, iterations, G )   cyclic coordinate descent for spine / neck chains
//
// Lengths and angles are computed inline (Math.sqrt / atan2 on locals) rather than through helpers that return or take
// doubles: those calls are past V8's inlining budget here and would box a number each, every frame, per character.

const _ab = vec(), _ac = vec(), _at = vec(), _bc = vec(), _n = vec(), _h = vec(), _b1 = vec(), _c1 = vec(), _u = vec(), _v = vec(), _w = vec();
const _qa0 = quat(), _qb = quat(), _r2 = quat(), _tw = quat(), _T = quat(), _Ti = quat(), _tmp = quat();
const NO_OPTS = {};

// Two-bone IK. a, b, c: the root, mid and end joints (the end bone's length is irrelevant); t: where c should go.
//   opts.minBend / maxBend: limits of the interior angle at b (radians: the fold limit and a little bend short of
//     straight, so a knee or an elbow never locks or bends backwards). The clip's own angle widens either limit, so a
//     target already at c changes nothing.
//   opts.pole: a point the mid joint should face (or null); opts.poleWeight 0..1 twists the chain about a->t toward it.
//   opts.hint: unit vector that bends a straight chain when there is no pole (the knee forward, the elbow back)
//   out = { qa, qb, reached, end: the solved c } (qa / qb Float64Array( 4 )): A' = qa A, B' = qb qa B for the world rotations
//     of the bones that start at a and b (qb is a world rotation about b in the solved frame).
export function solveTwoBone( a, b, c, t, out, opts = NO_OPTS ) {

	const minBend = opts.minBend ?? 0.35, maxBend = opts.maxBend ?? 3.10;
	sub3( _ab, b, a ); sub3( _ac, c, a ); sub3( _at, t, a ); sub3( _bc, c, b );
	const lab = Math.sqrt( _ab[ 0 ] * _ab[ 0 ] + _ab[ 1 ] * _ab[ 1 ] + _ab[ 2 ] * _ab[ 2 ] ), lcb = Math.sqrt( _bc[ 0 ] * _bc[ 0 ] + _bc[ 1 ] * _bc[ 1 ] + _bc[ 2 ] * _bc[ 2 ] ), lat = Math.sqrt( _at[ 0 ] * _at[ 0 ] + _at[ 1 ] * _at[ 1 ] + _at[ 2 ] * _at[ 2 ] ), lac = Math.sqrt( _ac[ 0 ] * _ac[ 0 ] + _ac[ 1 ] * _ac[ 1 ] + _ac[ 2 ] * _ac[ 2 ] );
	// interior angle at b now: between a - b = -ab and c - b
	cross3( _w, _ab, _bc );
	const bend0 = Math.atan2( Math.sqrt( _w[ 0 ] * _w[ 0 ] + _w[ 1 ] * _w[ 1 ] + _w[ 2 ] * _w[ 2 ] ), - ( _ab[ 0 ] * _bc[ 0 ] + _ab[ 1 ] * _bc[ 1 ] + _ab[ 2 ] * _bc[ 2 ] ) );
	const lo = Math.min( minBend, bend0 ), hi = Math.max( maxBend, bend0 );
	const minLat = Math.sqrt( Math.max( 0, lab * lab + lcb * lcb - 2 * lab * lcb * Math.cos( lo ) ) );
	const maxLat = Math.sqrt( lab * lab + lcb * lcb - 2 * lab * lcb * Math.cos( hi ) );
	const L = Math.min( Math.max( lat, minLat, 1e-6 ), maxLat );
	// the angles the triangle a, b, c needs for |a c| = L (law of cosines)
	cross3( _n, _ac, _ab );
	const nl = Math.sqrt( _n[ 0 ] * _n[ 0 ] + _n[ 1 ] * _n[ 1 ] + _n[ 2 ] * _n[ 2 ] );
	const acab0 = Math.atan2( nl, ( _ac[ 0 ] * _ab[ 0 ] + _ac[ 1 ] * _ab[ 1 ] + _ac[ 2 ] * _ab[ 2 ] ) );
	const acab1 = Math.acos( Math.min( 1, Math.max( - 1, ( lab * lab + L * L - lcb * lcb ) / ( 2 * lab * L ) ) ) );
	const bend1 = Math.acos( Math.min( 1, Math.max( - 1, ( lab * lab + lcb * lcb - L * L ) / ( 2 * lab * lcb ) ) ) );
	// bend plane normal: the chain's own plane when it is bent, else from the pole / hint (a straight chain has none)
	if ( nl < 0.05 * Math.max( 1e-9, lac * lab ) ) {

		if ( opts.pole ) sub3( _h, opts.pole, a );
		else if ( opts.hint ) copy3( _h, opts.hint );
		else { _h[ 0 ] = 0; _h[ 1 ] = 0; _h[ 2 ] = 1; }
		cross3( _n, _ac, _h );
		if ( ! unit3( _n, _n ) ) {

			// the hint lies along the chain: any perpendicular will do
			_w[ 0 ] = Math.abs( _ac[ 0 ] ) < 0.9 * lac ? 1 : 0; _w[ 1 ] = 0; _w[ 2 ] = 1 - _w[ 0 ];
			cross3( _n, _ac, _w );
			unit3( _n, _n );

		}

	} else unit3( _n, _n );

	// open the angle at a and set the angle at b, both about the plane normal (it stays the normal under these turns)
	// (axis-angle quaternions written inline: see the header)
	let sa = Math.sin( ( acab1 - acab0 ) * 0.5 );
	_qa0[ 0 ] = _n[ 0 ] * sa; _qa0[ 1 ] = _n[ 1 ] * sa; _qa0[ 2 ] = _n[ 2 ] * sa; _qa0[ 3 ] = Math.cos( ( acab1 - acab0 ) * 0.5 );
	sa = Math.sin( ( bend1 - bend0 ) * 0.5 );
	_qb[ 0 ] = _n[ 0 ] * sa; _qb[ 1 ] = _n[ 1 ] * sa; _qb[ 2 ] = _n[ 2 ] * sa; _qb[ 3 ] = Math.cos( ( bend1 - bend0 ) * 0.5 );
	add3( _b1, a, rot3( _u, _qa0, _ab ) );
	rot3( _v, _qa0, _bc );
	add3( _c1, _b1, rot3( _v, _qb, _v ) );
	// swing the solved triangle onto the target direction
	sub3( _u, _c1, a ); unit3( _u, _u );
	if ( lat > 1e-9 ) { unit3( _v, _at ); fromUnit4( _r2, _u, _v ); } else identity4( _r2 );
	copy4( _T, _r2 );
	// twist about a -> t so the mid joint faces the pole
	const pw = opts.poleWeight ?? 0;
	if ( opts.pole && pw > 0 ) {

		rot3( _u, _r2, sub3( _u, _b1, a ) ); // mid joint after the swing, from a
		rot3( _w, _r2, sub3( _w, _c1, a ) );
		unit3( _w, _w ); // twist axis
		let k = ( _u[ 0 ] * _w[ 0 ] + _u[ 1 ] * _w[ 1 ] + _u[ 2 ] * _w[ 2 ] );
		_u[ 0 ] -= _w[ 0 ] * k; _u[ 1 ] -= _w[ 1 ] * k; _u[ 2 ] -= _w[ 2 ] * k;
		sub3( _v, opts.pole, a );
		k = ( _v[ 0 ] * _w[ 0 ] + _v[ 1 ] * _w[ 1 ] + _v[ 2 ] * _w[ 2 ] );
		_v[ 0 ] -= _w[ 0 ] * k; _v[ 1 ] -= _w[ 1 ] * k; _v[ 2 ] -= _w[ 2 ] * k;
		if ( Math.sqrt( _u[ 0 ] * _u[ 0 ] + _u[ 1 ] * _u[ 1 ] + _u[ 2 ] * _u[ 2 ] ) > 1e-6 && Math.sqrt( _v[ 0 ] * _v[ 0 ] + _v[ 1 ] * _v[ 1 ] + _v[ 2 ] * _v[ 2 ] ) > 1e-6 ) {

			cross3( _h, _u, _v );
			let phi = Math.atan2( Math.sqrt( _h[ 0 ] * _h[ 0 ] + _h[ 1 ] * _h[ 1 ] + _h[ 2 ] * _h[ 2 ] ), ( _u[ 0 ] * _v[ 0 ] + _u[ 1 ] * _v[ 1 ] + _u[ 2 ] * _v[ 2 ] ) );
			if ( ( _h[ 0 ] * _w[ 0 ] + _h[ 1 ] * _w[ 1 ] + _h[ 2 ] * _w[ 2 ] ) < 0 ) phi = - phi;
			const ht = phi * Math.min( 1, pw ) * 0.5, st = Math.sin( ht );
			_tw[ 0 ] = _w[ 0 ] * st; _tw[ 1 ] = _w[ 1 ] * st; _tw[ 2 ] = _w[ 2 ] * st; _tw[ 3 ] = Math.cos( ht );
			mul4( _T, _tw, _T );

		}

	}

	mul4( out.qa || ( out.qa = quat() ), _T, _qa0 );
	// qb was found in the frame before the swing and twist: carry it into the solved frame (T qb T^-1)
	conj4( _Ti, _T );
	mul4( _tmp, _T, _qb );
	mul4( out.qb || ( out.qb = quat() ), _tmp, _Ti );
	norm4( out.qa, out.qa ); norm4( out.qb, out.qb );
	// the solved end, for callers and tests
	const end = out.end || ( out.end = vec() );
	rot3( _u, out.qa, _ab ); add3( _b1, a, _u );
	rot3( _v, out.qa, _bc ); rot3( _v, out.qb, _v ); add3( end, _b1, _v );
	sub3( _w, end, t );
	out.reached = Math.sqrt( _w[ 0 ] * _w[ 0 ] + _w[ 1 ] * _w[ 1 ] + _w[ 2 ] * _w[ 2 ] ) < 1e-4;
	out.bend = bend1;
	return out;

}

// Cyclic coordinate descent over a joint chain (parent first). pos: Float64Array( n * 3 ) joint positions (updated),
// eff: the end point carried by the last joint (updated), target: where it should go, limits: Float64Array( n ) the most
// each joint may turn from where it started (radians), G: Float64Array( n * 4 ) out, the world rotation each joint ends up
// with (cumulative: G[ j ] includes the turns of the joints above it; identity in). Returns true when within tol (a boolean:
// see the header); the distance left is in eff vs target.
export function solveCCD( pos, n, eff, target, limits, iterations, G, tol = 1e-4 ) {

	for ( let j = 0; j < n; j ++ ) { G[ j * 4 ] = 0; G[ j * 4 + 1 ] = 0; G[ j * 4 + 2 ] = 0; G[ j * 4 + 3 ] = 1; }
	const p = _h, own = _tw, r = _qb, gk = _tmp, gp = _Ti, q = _qa0;
	sub3( _w, eff, target );
	for ( let it = 0; it < iterations && Math.sqrt( _w[ 0 ] * _w[ 0 ] + _w[ 1 ] * _w[ 1 ] + _w[ 2 ] * _w[ 2 ] ) > tol; it ++ ) {

		for ( let j = n - 1; j >= 0; j -- ) {

			p[ 0 ] = pos[ j * 3 ]; p[ 1 ] = pos[ j * 3 + 1 ]; p[ 2 ] = pos[ j * 3 + 2 ];
			sub3( _u, eff, p ); sub3( _v, target, p );
			if ( ! unit3( _u, _u ) || ! unit3( _v, _v ) ) continue;
			fromUnit4( r, _u, _v );
			// this joint's own turn so far is G[ j ] G[ j - 1 ]^-1; with r it becomes r * own: keep that inside the limit
			gk[ 0 ] = G[ j * 4 ]; gk[ 1 ] = G[ j * 4 + 1 ]; gk[ 2 ] = G[ j * 4 + 2 ]; gk[ 3 ] = G[ j * 4 + 3 ];
			if ( j > 0 ) { gp[ 0 ] = - G[ j * 4 - 4 ]; gp[ 1 ] = - G[ j * 4 - 3 ]; gp[ 2 ] = - G[ j * 4 - 2 ]; gp[ 3 ] = G[ j * 4 - 1 ]; } else identity4( gp );
			mul4( own, gk, gp );
			mul4( q, r, own );
			// clamp the angle of q to the limit, keeping its axis (the short way round)
			const aw = Math.min( 1, Math.abs( q[ 3 ] ) ), ang = 2 * Math.acos( aw ), lim = limits[ j ];
			if ( ang > lim ) {

				const sgn = q[ 3 ] < 0 ? - 1 : 1, s = Math.sqrt( Math.max( 1e-18, 1 - aw * aw ) ), k = sgn * Math.sin( lim * 0.5 ) / s;
				q[ 0 ] *= k; q[ 1 ] *= k; q[ 2 ] *= k; q[ 3 ] = Math.cos( lim * 0.5 );

			}

			mul4( r, q, conj4( own, own ) );
			// turn this joint and everything below it
			for ( let k = j; k < n; k ++ ) {

				gk[ 0 ] = G[ k * 4 ]; gk[ 1 ] = G[ k * 4 + 1 ]; gk[ 2 ] = G[ k * 4 + 2 ]; gk[ 3 ] = G[ k * 4 + 3 ];
				mul4( gk, r, gk );
				norm4( gk, gk );
				G[ k * 4 ] = gk[ 0 ]; G[ k * 4 + 1 ] = gk[ 1 ]; G[ k * 4 + 2 ] = gk[ 2 ]; G[ k * 4 + 3 ] = gk[ 3 ];
				if ( k > j ) {

					_c1[ 0 ] = pos[ k * 3 ] - p[ 0 ]; _c1[ 1 ] = pos[ k * 3 + 1 ] - p[ 1 ]; _c1[ 2 ] = pos[ k * 3 + 2 ] - p[ 2 ];
					rot3( _c1, r, _c1 );
					pos[ k * 3 ] = p[ 0 ] + _c1[ 0 ]; pos[ k * 3 + 1 ] = p[ 1 ] + _c1[ 1 ]; pos[ k * 3 + 2 ] = p[ 2 ] + _c1[ 2 ];

				}

			}

			sub3( _c1, eff, p ); rot3( _c1, r, _c1 ); add3( eff, p, _c1 );

		}

		sub3( _w, eff, target );

	}

	return Math.sqrt( _w[ 0 ] * _w[ 0 ] + _w[ 1 ] * _w[ 1 ] + _w[ 2 ] * _w[ 2 ] ) <= tol;

}
