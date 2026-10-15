// Clip tools for the animation graph: CPU forward kinematics over a glTF rig, clips derived from the roster's
// clips (strafe legs, longer strides) and short procedural clips authored as poses (dodge, guard, parry, hit
// reactions). The output is the glTF clip shape the engine samples ({ name, duration, channels: [ { node, path,
// times, values } ] }), so the pose still comes from SkinnedModel's clip sampling on the GPU-skinning path; the
// graph only decides the layer weights.
//
//   const rig = makeRig( gltf );                         // nodes / parents / order / rest
//   deriveClip( rig, srcClip, 'Walk_Strafe_R', ( loc, t ) => legYaw( rig, loc, - 75 ) )
//   strideScale( rig, srcClip, 'Run_Long', 1.2 )         // thigh / calf swing amplified about the cycle mean
//   poseClip( rig, base, 'Block_Guard', keys )           // keys: [ { t, pose: { bone: [ [ 'x', deg ], ... ], pelvis: [ dx, dy, dz ] }, ease } ]
//   strideSpeed( rig, clip ) -> m/s of the planted foot; footMarker( rig, clip, 'l' ) -> clip time of the left foot's most-forward point
//
// Frames: model space of the roster GLBs is +Y up, the character faces +Z, +X is its LEFT. A rotation about +X by a
// positive angle tips the top forward (and swings a hanging limb backward); about +Y it turns the face toward +X (left);
// about +Z it tips the top toward -X (the character's right).

export const FPS = 30;
const DEG = Math.PI / 180;

// ---- quaternion helpers on plain arrays [ x, y, z, w ]

export function qmul( a, b, o = [ 0, 0, 0, 1 ] ) {

	const ax = a[ 0 ], ay = a[ 1 ], az = a[ 2 ], aw = a[ 3 ], bx = b[ 0 ], by = b[ 1 ], bz = b[ 2 ], bw = b[ 3 ];
	o[ 0 ] = ax * bw + aw * bx + ay * bz - az * by;
	o[ 1 ] = ay * bw + aw * by + az * bx - ax * bz;
	o[ 2 ] = az * bw + aw * bz + ax * by - ay * bx;
	o[ 3 ] = aw * bw - ax * bx - ay * by - az * bz;
	return o;

}

export const qconj = ( a ) => [ - a[ 0 ], - a[ 1 ], - a[ 2 ], a[ 3 ] ];
export const qaxis = ( ax, rad ) => {

	const s = Math.sin( rad / 2 ), c = Math.cos( rad / 2 );
	return ax === 'x' ? [ s, 0, 0, c ] : ax === 'y' ? [ 0, s, 0, c ] : [ 0, 0, s, c ];

};

export function qnorm( q ) {

	const l = Math.hypot( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ) || 1;
	q[ 0 ] /= l; q[ 1 ] /= l; q[ 2 ] /= l; q[ 3 ] /= l;
	return q;

}

// slerp( a, b, t ) along the shorter arc
export function qslerp( a, b, t ) {

	let bx = b[ 0 ], by = b[ 1 ], bz = b[ 2 ], bw = b[ 3 ];
	let d = a[ 0 ] * bx + a[ 1 ] * by + a[ 2 ] * bz + a[ 3 ] * bw;
	if ( d < 0 ) { d = - d; bx = - bx; by = - by; bz = - bz; bw = - bw; }
	if ( d > 0.9995 ) return qnorm( [ a[ 0 ] + ( bx - a[ 0 ] ) * t, a[ 1 ] + ( by - a[ 1 ] ) * t, a[ 2 ] + ( bz - a[ 2 ] ) * t, a[ 3 ] + ( bw - a[ 3 ] ) * t ] );
	const th = Math.acos( d ), s = Math.sin( th ), ka = Math.sin( ( 1 - t ) * th ) / s, kb = Math.sin( t * th ) / s;
	return [ a[ 0 ] * ka + bx * kb, a[ 1 ] * ka + by * kb, a[ 2 ] * ka + bz * kb, a[ 3 ] * ka + bw * kb ];

}

// q^k (the rotation angle scaled by k, k may exceed 1)
export function qpow( q, k ) {

	const sg = q[ 3 ] < 0 ? - 1 : 1; // the shorter way
	const w = Math.min( 1, q[ 3 ] * sg ), s = Math.sqrt( Math.max( 0, 1 - w * w ) );
	if ( s < 1e-8 ) return [ 0, 0, 0, 1 ];
	const h = Math.acos( w ) * k, f = Math.sin( h ) / s * sg;
	return [ q[ 0 ] * f, q[ 1 ] * f, q[ 2 ] * f, Math.cos( h ) ];

}

export function qrot( q, v ) {

	const [ x, y, z, w ] = q, [ vx, vy, vz ] = v;
	const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = - x * vx - y * vy - z * vz;
	return [ ix * w + iw * - x + iy * - z - iz * - y, iy * w + iw * - y + iz * - x - ix * - z, iz * w + iw * - z + ix * - y - iy * - x ];

}

// ---- the rig

export function makeRig( gltf ) {

	const N = gltf.nodes.length, parent = new Int32Array( N ).fill( - 1 ), order = [];
	gltf.nodes.forEach( ( n, i ) => n.children.forEach( ( c ) => { parent[ c ] = i; } ) );
	const visit = ( i ) => { order.push( i ); gltf.nodes[ i ].children.forEach( visit ); };
	gltf.roots.forEach( visit );
	const index = {};
	gltf.nodes.forEach( ( n, i ) => { if ( index[ n.name ] === undefined ) index[ n.name ] = i; } );
	const rest = gltf.nodes.map( ( n ) => ( { t: Array.from( n.t ), r: Array.from( n.r ) } ) );
	return { gltf, N, parent, order, index, rest };

}

function sample( ch, t, out ) {

	const T = ch.times, V = ch.values, w = ch.path === 'rotation' ? 4 : 3, n = T.length;
	if ( n === 1 || t <= T[ 0 ] ) { for ( let c = 0; c < w; c ++ ) out[ c ] = V[ c ]; return out; }
	if ( t >= T[ n - 1 ] ) { for ( let c = 0; c < w; c ++ ) out[ c ] = V[ ( n - 1 ) * w + c ]; return out; }
	let k = 0, lo = 0, hi = n - 1;
	while ( hi - lo > 1 ) { const m = ( lo + hi ) >> 1; if ( T[ m ] <= t ) lo = m; else hi = m; }
	k = lo;
	const f = ch.step ? 0 : ( t - T[ k ] ) / ( T[ k + 1 ] - T[ k ] ), a = k * w, b = ( k + 1 ) * w;
	if ( w === 3 ) { for ( let c = 0; c < 3; c ++ ) out[ c ] = V[ a + c ] + ( V[ b + c ] - V[ a + c ] ) * f; return out; }
	const d = V[ a ] * V[ b ] + V[ a + 1 ] * V[ b + 1 ] + V[ a + 2 ] * V[ b + 2 ] + V[ a + 3 ] * V[ b + 3 ], s = d < 0 ? - f : f;
	for ( let c = 0; c < 4; c ++ ) out[ c ] = V[ a + c ] * ( 1 - f ) + V[ b + c ] * s;
	return qnorm( out );

}

// the local pose of every node at time t of a clip (rest where the clip has no channel)
export function localsAt( rig, clip, t ) {

	const loc = rig.rest.map( ( r ) => ( { t: r.t.slice(), r: r.r.slice() } ) );
	for ( const ch of clip.channels ) {

		if ( ch.path === 'rotation' ) sample( ch, t, loc[ ch.node ].r );
		else if ( ch.path === 'translation' ) sample( ch, t, loc[ ch.node ].t );

	}

	return loc;

}

// world rotations / positions (model space) of a local pose
export function fk( rig, loc ) {

	const N = rig.N, R = new Array( N ), P = new Array( N );
	for ( const i of rig.order ) {

		const p = rig.parent[ i ], L = loc[ i ];
		if ( p < 0 ) { R[ i ] = L.r.slice(); P[ i ] = L.t.slice(); continue; }
		R[ i ] = qmul( R[ p ], L.r );
		const v = qrot( R[ p ], L.t );
		P[ i ] = [ P[ p ][ 0 ] + v[ 0 ], P[ p ][ 1 ] + v[ 1 ], P[ p ][ 2 ] + v[ 2 ] ];

	}

	return { R, P };

}

// rewrite a local pose so the named bones get the world rotation edit( oldWorld ) (others keep their local rotation:
// children follow). edits: { boneName: ( oldWorld ) => newWorld }
export function editWorld( rig, loc, edits ) {

	const { R } = fk( rig, loc ), R2 = new Array( rig.N );
	const by = {};
	for ( const n in edits ) if ( rig.index[ n ] !== undefined ) by[ rig.index[ n ] ] = edits[ n ];
	for ( const i of rig.order ) {

		const p = rig.parent[ i ];
		const pw = p >= 0 ? R2[ p ] : [ 0, 0, 0, 1 ];
		if ( by[ i ] ) {

			R2[ i ] = by[ i ]( R[ i ] );
			loc[ i ].r = qnorm( qmul( qconj( pw ), R2[ i ] ) );

		} else R2[ i ] = qmul( pw, loc[ i ].r );

	}

	return loc;

}

// ---- derived clips

// a new clip from a source clip, sampled every frame: fn( locals, t, u ) edits the pose in place (u = t / duration)
export function deriveClip( rig, src, name, fn, { duration = src.duration } = {} ) {

	const n = Math.max( 1, Math.round( duration * FPS ) );
	const frames = [];
	for ( let k = 0; k <= n; k ++ ) {

		const t = k / n * duration;
		const loc = localsAt( rig, src, t * src.duration / duration );
		fn( loc, t, t / duration );
		frames.push( loc );

	}

	return bake( rig, name, frames, duration, src );

}

// frames (local poses at even times over duration) -> a clip with a rotation channel for every node the source animates
// (or every joint) and the pelvis translation
function bake( rig, name, frames, duration, src = null ) {

	const n = frames.length, times = new Float32Array( n );
	for ( let k = 0; k < n; k ++ ) times[ k ] = k / ( n - 1 ) * duration;
	const rotNodes = new Set(), trNodes = new Set();
	if ( src ) for ( const ch of src.channels ) ( ch.path === 'rotation' ? rotNodes : ch.path === 'translation' ? trNodes : new Set() ).add( ch.node );
	else for ( const j of rig.gltf.skins[ 0 ].joints ) rotNodes.add( j );
	const pel = rig.index.pelvis;
	if ( pel !== undefined ) { rotNodes.add( pel ); trNodes.add( pel ); }
	const channels = [];
	for ( const i of rotNodes ) {

		const v = new Float32Array( n * 4 );
		let prev = null;
		for ( let k = 0; k < n; k ++ ) {

			const q = frames[ k ][ i ].r;
			// keep consecutive keys in one hemisphere (clean nlerp between them)
			const s = prev && prev[ 0 ] * q[ 0 ] + prev[ 1 ] * q[ 1 ] + prev[ 2 ] * q[ 2 ] + prev[ 3 ] * q[ 3 ] < 0 ? - 1 : 1;
			for ( let c = 0; c < 4; c ++ ) v[ k * 4 + c ] = q[ c ] * s;
			prev = v.subarray( k * 4, k * 4 + 4 );

		}

		channels.push( { node: i, path: 'rotation', times, values: v, step: false } );

	}

	for ( const i of trNodes ) {

		const v = new Float32Array( n * 3 );
		for ( let k = 0; k < n; k ++ ) for ( let c = 0; c < 3; c ++ ) v[ k * 3 + c ] = frames[ k ][ i ].t[ c ];
		channels.push( { node: i, path: 'translation', times, values: v, step: false } );

	}

	return { name, duration, channels, procedural: true };

}

// strafe legs: the pelvis (and the legs under it) turned by deg about the vertical, the spine taking the turn back so the
// chest still faces forward. deg > 0 turns the legs toward the character's left (+X).
export function legYaw( rig, loc, deg ) {

	const I = rig.index;
	const p = rig.parent[ I.pelvis ];
	const P = p >= 0 ? fk( rig, loc ).R[ p ] : [ 0, 0, 0, 1 ];
	const yq = qaxis( 'y', deg * DEG );
	const k = qmul( qmul( qconj( P ), yq ), P ); // the yaw in the pelvis' parent frame
	const { R } = fk( rig, loc );
	const chest = R[ I.spine_02 ];
	loc[ I.pelvis ].r = qnorm( qmul( k, loc[ I.pelvis ].r ) );
	loc[ I.pelvis ].t = qrot( k, loc[ I.pelvis ].t );
	editWorld( rig, loc, {
		spine_01: ( w ) => qmul( qaxis( 'y', deg * 0.45 * DEG ), qmul( qconj( yq ), w ) ), // keeps 45 % of the leg turn
		spine_02: () => chest, // the chest faces forward again
	} );
	return loc;

}

// the swing of the legs amplified about the cycle's mean pose (a longer stride at the same cadence)
export function strideScale( rig, src, name, k, { calf = 1 + ( k - 1 ) * 0.5, drop = 0.02 * ( k - 1 ) / 0.2, lean = 0 } = {} ) {

	const I = rig.index, bones = [ [ 'thigh_l', k ], [ 'thigh_r', k ], [ 'calf_l', calf ], [ 'calf_r', calf ] ];
	const mean = {};
	const n = Math.max( 2, Math.round( src.duration * FPS ) );
	for ( const [ b ] of bones ) {

		const acc = [ 0, 0, 0, 0 ];
		for ( let f = 0; f < n; f ++ ) {

			const q = localsAt( rig, src, f / n * src.duration )[ I[ b ] ].r;
			const s = acc[ 0 ] * q[ 0 ] + acc[ 1 ] * q[ 1 ] + acc[ 2 ] * q[ 2 ] + acc[ 3 ] * q[ 3 ] < 0 ? - 1 : 1;
			for ( let c = 0; c < 4; c ++ ) acc[ c ] += q[ c ] * s;

		}

		mean[ b ] = qnorm( acc );

	}

	return deriveClip( rig, src, name, ( loc ) => {

		for ( const [ b, kk ] of bones ) {

			const m = mean[ b ], L = loc[ I[ b ] ];
			L.r = qnorm( qmul( m, qpow( qmul( qconj( m ), L.r ), kk ) ) );

		}

		loc[ I.pelvis ].t[ 1 ] -= drop;
		if ( lean ) editWorld( rig, loc, { spine_01: ( w ) => qmul( qaxis( 'x', lean * DEG ), w ) } );

	} );

}

// ---- measurements

// ground speed of an in-place locomotion clip (m/s at rate 1): the velocity of whichever foot is clearly the lower one (the
// planted foot), averaged as a vector over the cycle, so a strafe clip's sideways stance counts at full speed
export function strideSpeed( rig, clip ) {

	const I = rig.index, n = Math.max( 8, Math.round( clip.duration * 60 ) ), D = clip.duration, h = D / n;
	const F = [];
	for ( let k = 0; k <= n; k ++ ) F.push( fk( rig, localsAt( rig, clip, k * h ) ).P );
	const L = I.ball_l, R = I.ball_r;
	let sx = 0, sz = 0, cnt = 0;
	for ( let k = 1; k <= n; k ++ ) {

		const a = F[ k - 1 ], dy = a[ L ][ 1 ] - a[ R ][ 1 ];
		const f = dy < - 0.02 ? L : dy > 0.02 ? R : - 1;
		if ( f < 0 ) continue;
		sx += ( a[ f ][ 0 ] - F[ k ][ f ][ 0 ] ) / h;
		sz += ( a[ f ][ 2 ] - F[ k ][ f ][ 2 ] ) / h;
		cnt ++;

	}

	return cnt ? Math.hypot( sx, sz ) / cnt : 0;

}

// clip time where a foot is furthest forward (the sync marker of the locomotion clips: phase 0 = left foot forward)
export function footMarker( rig, clip, side = 'l' ) {

	const I = rig.index, n = Math.max( 8, Math.round( clip.duration * 60 ) );
	let best = - Infinity, bt = 0;
	for ( let k = 0; k < n; k ++ ) {

		const t = k / n * clip.duration;
		const z = fk( rig, localsAt( rig, clip, t ) ).P[ I[ 'ball_' + side ] ][ 2 ];
		if ( z > best ) { best = z; bt = t; }

	}

	return bt;

}

// ---- procedural pose clips

const ease = {
	linear: ( x ) => x,
	smooth: ( x ) => x * x * ( 3 - 2 * x ),
	out: ( x ) => 1 - ( 1 - x ) * ( 1 - x ) * ( 1 - x ),
	in: ( x ) => x * x,
};

// the model-frame delta of a pose entry: [ [ axis, deg ], ... ] applied in order (first rotation first)
function delta( spec ) {

	let q = [ 0, 0, 0, 1 ];
	if ( spec ) for ( const [ ax, deg ] of spec ) q = qmul( qaxis( ax, deg * DEG ), q );
	return q;

}

// A clip from poses over a base pose (the first frame of `base`, e.g. Idle_Breathe, so nothing is in the bind A-pose).
// keys: [ { t, pose: { bone: [ [ 'x' | 'y' | 'z', deg ], ... ], pelvis: [ dx, dy, dz ] }, ease: 'smooth' | 'out' | 'in' | 'linear' } ]
// (the ease shapes the segment that ENDS at the key). A bone's delta is a rotation in model axes about its own joint, on
// top of whatever its parents did; bones a key leaves out are at no delta there. loop: the base pose keeps playing.
export function poseClip( rig, base, name, keys, { duration = keys[ keys.length - 1 ].t, baseTime = 0, loopBase = false } = {} ) {

	const n = Math.max( 1, Math.round( duration * FPS ) );
	const bones = new Set();
	for ( const k of keys ) for ( const b in k.pose ) if ( b !== 'pelvis' && b !== 'reach' ) bones.add( b );
	const D = keys.map( ( k ) => { const o = {}; for ( const b of bones ) o[ b ] = delta( k.pose[ b ] ); return o; } );
	const frames = [];
	for ( let f = 0; f <= n; f ++ ) {

		const t = f / n * duration;
		const loc = localsAt( rig, base, loopBase ? ( baseTime + t ) % base.duration : baseTime );
		let j = 0;
		while ( j < keys.length - 1 && keys[ j + 1 ].t <= t ) j ++;
		const a = keys[ j ], b = keys[ Math.min( j + 1, keys.length - 1 ) ];
		const span = b.t - a.t, x = span > 1e-6 ? Math.min( 1, ( t - a.t ) / span ) : 0;
		const u = ( ease[ b.ease ] || ease.smooth )( x );
		const ja = j, jb = Math.min( j + 1, keys.length - 1 );
		// pelvis offset (model frame, added to the pelvis translation through its parent)
		const pa = a.pose.pelvis || [ 0, 0, 0 ], pb = b.pose.pelvis || [ 0, 0, 0 ];
		const po = [ 0, 1, 2 ].map( ( c ) => pa[ c ] + ( pb[ c ] - pa[ c ] ) * u );
		const L = loc[ rig.index.pelvis ];
		L.t = [ L.t[ 0 ] + po[ 0 ], L.t[ 1 ] + po[ 1 ], L.t[ 2 ] + po[ 2 ] ];
		// bone deltas, parent first: local' = P'^-1 D P' local
		const R2 = new Array( rig.N );
		const dq = {};
		for ( const bn of bones ) if ( rig.index[ bn ] !== undefined ) dq[ rig.index[ bn ] ] = qslerp( D[ ja ][ bn ], D[ jb ][ bn ], u );
		for ( const i of rig.order ) {

			const p = rig.parent[ i ];
			const pw = p >= 0 ? R2[ p ] : [ 0, 0, 0, 1 ];
			if ( dq[ i ] ) {

				// the world rotation it would have under the moved parent, then the delta about its own joint
				const w = p >= 0 ? qmul( pw, loc[ i ].r ) : loc[ i ].r.slice();
				R2[ i ] = qmul( dq[ i ], w );
				loc[ i ].r = qnorm( qmul( qconj( pw ), R2[ i ] ) );

			} else R2[ i ] = p >= 0 ? qmul( pw, loc[ i ].r ) : loc[ i ].r.slice();

		}

		// hand reach targets (model space, with an elbow pole direction), weighted in and out between keys that have them
		for ( const side of [ 'l', 'r' ] ) {

			const ra = a.pose.reach && a.pose.reach[ side ], rb = b.pose.reach && b.pose.reach[ side ];
			const w = ( ra ? 1 - u : 0 ) + ( rb ? u : 0 );
			if ( w <= 1e-4 ) continue;
			const A = ra || rb, B = rb || ra;
			const tg = [ 0, 1, 2, 3, 4, 5 ].map( ( c ) => A[ c ] + ( B[ c ] - A[ c ] ) * u );
			twoBone( rig, loc, 'upperarm_' + side, 'lowerarm_' + side, 'hand_' + side, tg.slice( 0, 3 ), tg.slice( 3, 6 ), w );

		}

		frames.push( loc );

	}

	return bake( rig, name, frames, duration, null );

}

// shortest rotation taking unit vector a onto unit vector b
function qfromto( a, b ) {

	const d = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];
	if ( d < - 0.999999 ) return Math.abs( a[ 0 ] ) < 0.9 ? qnorm( [ 0, - a[ 2 ], a[ 1 ], 0 ] ) : qnorm( [ a[ 2 ], 0, - a[ 0 ], 0 ] );
	return qnorm( [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ], 1 + d ] );

}

const sub = ( a, b ) => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
const unit = ( a ) => {

	const l = Math.hypot( a[ 0 ], a[ 1 ], a[ 2 ] ) || 1;
	return [ a[ 0 ] / l, a[ 1 ] / l, a[ 2 ] / l ];

};

// analytic two-bone IK on a local pose (model space): the end joint onto target, the middle joint bent toward pole (a direction),
// blended by weight w (a partial swing of each bone)
export function twoBone( rig, loc, upper, lower, end, target, pole, w = 1 ) {

	const I = rig.index, iu = I[ upper ], il = I[ lower ], ie = I[ end ];
	if ( iu === undefined || il === undefined || ie === undefined ) return loc;
	let { R, P } = fk( rig, loc );
	const A = P[ iu ], B = P[ il ], C = P[ ie ];
	const la = Math.hypot( ...sub( B, A ) ), lb = Math.hypot( ...sub( C, B ) );
	const toT = sub( target, A );
	const d = Math.max( 1e-4, Math.min( la + lb - 1e-4, Math.hypot( ...toT ) ) );
	const u = unit( toT );
	const pd = pole[ 0 ] * u[ 0 ] + pole[ 1 ] * u[ 1 ] + pole[ 2 ] * u[ 2 ];
	const pp = unit( [ pole[ 0 ] - u[ 0 ] * pd, pole[ 1 ] - u[ 1 ] * pd, pole[ 2 ] - u[ 2 ] * pd ] );
	const ca = Math.max( - 1, Math.min( 1, ( la * la + d * d - lb * lb ) / ( 2 * la * d ) ) ), sa = Math.sqrt( 1 - ca * ca );
	const E = [ A[ 0 ] + la * ( ca * u[ 0 ] + sa * pp[ 0 ] ), A[ 1 ] + la * ( ca * u[ 1 ] + sa * pp[ 1 ] ), A[ 2 ] + la * ( ca * u[ 2 ] + sa * pp[ 2 ] ) ];
	const T = [ A[ 0 ] + u[ 0 ] * d, A[ 1 ] + u[ 1 ] * d, A[ 2 ] + u[ 2 ] * d ];
	// the upper bone swings B - A onto E - A, then the lower bone C - B onto T - E
	const s1 = qslerp( [ 0, 0, 0, 1 ], qfromto( unit( sub( B, A ) ), unit( sub( E, A ) ) ), w );
	const pu = rig.parent[ iu ], Pu = pu >= 0 ? R[ pu ] : [ 0, 0, 0, 1 ];
	loc[ iu ].r = qnorm( qmul( qconj( Pu ), qmul( s1, R[ iu ] ) ) );
	( { R, P } = fk( rig, loc ) );
	const B2 = P[ il ], C2 = P[ ie ];
	const s2 = qslerp( [ 0, 0, 0, 1 ], qfromto( unit( sub( C2, B2 ) ), unit( sub( T, B2 ) ) ), w );
	const pl = rig.parent[ il ];
	loc[ il ].r = qnorm( qmul( qconj( R[ pl ] ), qmul( s2, R[ il ] ) ) );
	return loc;

}

// knees and hips bent so the pelvis sits `drop` m lower with the feet where they were (a crouch for the pose clips):
// thigh forward by a, calf back by 2a, foot forward by a again (both legs, or one side)
export function crouch( drop, sides = [ 'l', 'r' ], legLen = 0.3 ) {

	const c = Math.max( - 1, Math.min( 1, 1 - drop / ( 2 * legLen ) ) );
	const a = Math.acos( c ) / DEG;
	const o = { pelvis: [ 0, - drop, 0 ] };
	for ( const s of sides ) {

		o[ 'thigh_' + s ] = [ [ 'x', - a ] ];
		o[ 'calf_' + s ] = [ [ 'x', 2 * a ] ];
		o[ 'foot_' + s ] = [ [ 'x', - a ] ];

	}

	return o;

}
