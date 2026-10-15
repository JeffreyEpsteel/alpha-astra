// Destructible prop kinds: each one is a set of pieces (boxes, a barrel cylinder, rock hulls) in the prop's own frame
// (x right, y up, z forward, the ground at y = 0), the joints between touching pieces (found automatically) and the
// pieces anchored to the world (posts, pilings, ribs: a joint at their foot). Plain data and math: no engine, no physics.
//
//   const layout = buildKind( 'crate', rng )   -> { pieces, joints: [ [ i, k, breakForce, anchor ] ], anchors: [ [ i, breakForce, anchor ] ] }
//   KINDS[ kind ] = { toughness (J of damage to break it), jointForce (N), mat: 'wood' | 'stone', shatterAt, ... }
//   shatterLayout( kind, pieces, rng ) -> the pieces a heavy hit leaves (a barrel bursts into staves, rocks split)
//
// A piece: { type: 'box' | 'barrel' | 'rock', size: [ sx, sy, sz ] (full widths; a barrel is 2r x h x 2r, a rock scales the
// unit icosahedron), pos: { x, y, z }, quat: { x, y, z, w }, color: [ r, g, b ] (linear), density, jf (its joints' break
// force, N), anchor (break force of its joint to the world, 0: none), float (buoyancy scale) }

import { STRONGHOLD_KINDS } from '../../world/islands/stronghold/Kinds.js';

const ID = { x: 0, y: 0, z: 0, w: 1 };

// quaternion from Euler angles applied in Y, X, Z order (yaw, then pitch, then roll)
export function quatYXZ( y = 0, x = 0, z = 0 ) {

	const c1 = Math.cos( x / 2 ), c2 = Math.cos( y / 2 ), c3 = Math.cos( z / 2 );
	const s1 = Math.sin( x / 2 ), s2 = Math.sin( y / 2 ), s3 = Math.sin( z / 2 );
	return {
		x: s1 * c2 * c3 + c1 * s2 * s3,
		y: c1 * s2 * c3 - s1 * c2 * s3,
		z: c1 * c2 * s3 - s1 * s2 * c3,
		w: c1 * c2 * c3 + s1 * s2 * s3,
	};

}

export function quatMul( a, b ) {

	return {
		x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
		y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
		z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	};

}

// rotate ( x, y, z ) by q
export function rotate( q, x, y, z ) {

	const tx = 2 * ( q.y * z - q.z * y ), ty = 2 * ( q.z * x - q.x * z ), tz = 2 * ( q.x * y - q.y * x );
	return {
		x: x + q.w * tx + ( q.y * tz - q.z * ty ),
		y: y + q.w * ty + ( q.z * tx - q.x * tz ),
		z: z + q.w * tz + ( q.x * ty - q.y * tx ),
	};

}

const conj = ( q ) => ( { x: - q.x, y: - q.y, z: - q.z, w: q.w } );

// the unit icosahedron (radius 0.5, the vertex set of IcosahedronGeometry( 0.5, 0 )): rock render shape and hull
const PHI = ( 1 + Math.sqrt( 5 ) ) / 2;
export const ICOSA = [
	[ - 1, PHI, 0 ], [ 1, PHI, 0 ], [ - 1, - PHI, 0 ], [ 1, - PHI, 0 ], [ 0, - 1, PHI ], [ 0, 1, PHI ],
	[ 0, - 1, - PHI ], [ 0, 1, - PHI ], [ PHI, 0, - 1 ], [ PHI, 0, 1 ], [ - PHI, 0, - 1 ], [ - PHI, 0, 1 ],
].map( ( v ) => { const l = Math.hypot( ...v ) * 2; return [ v[ 0 ] / l, v[ 1 ] / l, v[ 2 ] / l ]; } );
export const ICOSA_Y = Math.max( ...ICOSA.map( ( v ) => v[ 1 ] ) ); // 0.425: half height of a unit rock

export function rockHull( size ) {

	const out = new Float32Array( ICOSA.length * 3 );
	ICOSA.forEach( ( v, i ) => { out[ i * 3 ] = v[ 0 ] * size[ 0 ]; out[ i * 3 + 1 ] = v[ 1 ] * size[ 1 ]; out[ i * 3 + 2 ] = v[ 2 ] * size[ 2 ]; } );
	return out;

}

// half extents a piece's collider really has (a rock hull is smaller than its scale box)
export function pieceHalf( p ) {

	if ( p.type === 'rock' ) return [ p.size[ 0 ] * 0.5 * 0.95, p.size[ 1 ] * ICOSA_Y, p.size[ 2 ] * 0.5 * 0.95 ];
	return [ p.size[ 0 ] / 2, p.size[ 1 ] / 2, p.size[ 2 ] / 2 ];

}

// ---- colours (linear albedo)
const WOOD = [ [ 0.30, 0.23, 0.16 ], [ 0.40, 0.28, 0.16 ], [ 0.24, 0.17, 0.11 ], [ 0.46, 0.38, 0.27 ] ];
const FISH = [ 0.52, 0.55, 0.57 ];
const STONE = [ [ 0.40, 0.38, 0.35 ], [ 0.47, 0.45, 0.41 ], [ 0.34, 0.33, 0.31 ] ];
const tint = ( c, rng, a = 0.12 ) => { const k = 1 + ( rng() - 0.5 ) * 2 * a; return [ c[ 0 ] * k, c[ 1 ] * k, c[ 2 ] * k ]; };

const box = ( sx, sy, sz, x, y, z, color, o = {} ) => ( {
	type: 'box', size: [ sx, sy, sz ], pos: { x, y, z }, quat: o.quat || ID, color, density: o.density ?? 560,
	jf: o.jf ?? 0, anchor: o.anchor ?? 0, float: o.float ?? 1,
} );

// ---- the kinds

export const KINDS = {
	crate: { toughness: 700, jointForce: 900, mat: 'wood', shatterAt: 3, label: 'crate' },
	barrel: { toughness: 650, jointForce: 0, mat: 'wood', shatterAt: 2.2, label: 'barrel' },
	fishRack: { toughness: 420, jointForce: 700, mat: 'wood', shatterAt: 4, label: 'fish rack' },
	fence: { toughness: 650, jointForce: 650, mat: 'wood', shatterAt: 4, label: 'fence' },
	leanTo: { toughness: 1400, jointForce: 1100, mat: 'wood', shatterAt: 4, label: 'lean-to' },
	railing: { toughness: 600, jointForce: 650, mat: 'wood', shatterAt: 4, label: 'railing' },
	rockStack: { toughness: 9000, jointForce: 0, mat: 'stone', shatterAt: 2, label: 'rock stack' },
	piling: { toughness: 2500, jointForce: 3000, mat: 'wood', shatterAt: 4, label: 'rotten pilings' },
	wreck: { toughness: 1800, jointForce: 1400, mat: 'wood', shatterAt: 4, label: 'wreckage' },
	// Tidemark's town (wave 12A; world/islands/town/Layout.js places them)
	stall: { toughness: 900, jointForce: 800, mat: 'wood', shatterAt: 4, label: 'market stall' },
	cart: { toughness: 1100, jointForce: 1000, mat: 'wood', shatterAt: 4, label: 'cart' },
	lampPost: { toughness: 750, jointForce: 900, mat: 'wood', shatterAt: 4, label: 'lamp post' },
	wellRoof: { toughness: 800, jointForce: 800, mat: 'wood', shatterAt: 4, label: 'well roof' },
	shedDoor: { toughness: 1000, jointForce: 900, mat: 'wood', shatterAt: 4, label: 'shed doors' },
};

const BUILD = {

	// six faces of two planks each
	crate( rng, o ) {

		const s = o.size ?? 0.75 + rng() * 0.25, t = 0.045, g = 0.004, H = s - 2 * t;
		const c = tint( WOOD[ Math.floor( rng() * 3 ) ], rng );
		const P = [];
		for ( const sx of [ - 1, 1 ] ) {

			P.push( box( s / 2 - g, t, s - g, sx * s / 4, t / 2, 0, tint( c, rng, 0.06 ) ) );
			P.push( box( s / 2 - g, t, s - g, sx * s / 4, s - t / 2, 0, tint( c, rng, 0.06 ) ) );

		}

		for ( let k = 0; k < 2; k ++ ) {

			const y = t + H / 4 + k * H / 2;
			for ( const sz of [ - 1, 1 ] ) P.push( box( s - g, H / 2 - g, t, 0, y, sz * ( s / 2 - t / 2 ), tint( c, rng, 0.06 ) ) );
			for ( const sx of [ - 1, 1 ] ) P.push( box( t, H / 2 - g, s - 2 * t - g, sx * ( s / 2 - t / 2 ), y, 0, tint( c, rng, 0.06 ) ) );

		}

		return P;

	},

	// one cylinder while whole (shatterLayout bursts it into staves and lids)
	barrel( rng, o ) {

		const r = 0.27 + rng() * 0.04, h = 0.78 + rng() * 0.08;
		return [ { type: 'barrel', size: [ 2 * r, h, 2 * r ], pos: { x: 0, y: h / 2, z: 0 }, quat: quatYXZ( rng() * 6.28 ), color: tint( [ 0.36, 0.24, 0.13 ], rng ), density: 330, jf: 0, anchor: 0, float: 1 } ];

	},

	// two A-frames, a ridge pole, two side rails and a row of drying fish
	fishRack( rng ) {

		const c = tint( WOOD[ 3 ], rng ), P = [];
		const L = 1.8, lean = Math.atan2( 0.36, 1.76 );
		for ( const z of [ - 1.0, 1.0 ] ) for ( const sx of [ - 1, 1 ] ) {

			P.push( box( 0.07, L, 0.07, sx * 0.18, 0.88, z, tint( c, rng, 0.08 ), { quat: quatYXZ( 0, 0, sx * lean ), anchor: 1800 } ) );

		}

		P.push( box( 0.07, 0.07, 2.4, 0, 1.765, 0, tint( c, rng, 0.08 ) ) );
		for ( const sx of [ - 1, 1 ] ) P.push( box( 0.05, 0.05, 2.12, sx * 0.29, 0.5, 0, tint( c, rng, 0.08 ) ) );
		for ( let k = 0; k < 6; k ++ ) {

			const z = - 0.8 + k * 0.32 + ( rng() - 0.5 ) * 0.05;
			P.push( box( 0.05, 0.3, 0.12, 0, 1.765 - 0.035 - 0.152, z, tint( FISH, rng, 0.08 ), { quat: quatYXZ( ( rng() - 0.5 ) * 0.5 ), density: 900, jf: 90 } ) );

		}

		return P;

	},

	// posts every 2 m, two rails per span in front of them
	fence( rng, o ) {

		const spans = o.spans ?? 2 + Math.floor( rng() * 2 ), c = tint( WOOD[ 0 ], rng ), P = [];
		const L = spans * 2;
		for ( let i = 0; i <= spans; i ++ ) P.push( box( 0.1, 1.15, 0.1, - L / 2 + i * 2, 0.575, 0, tint( c, rng, 0.1 ), { anchor: 2500, quat: quatYXZ( 0, ( rng() - 0.5 ) * 0.04, ( rng() - 0.5 ) * 0.04 ) } ) );
		for ( let i = 0; i < spans; i ++ ) for ( const y of [ 0.45, 0.9 ] ) P.push( box( 1.98, 0.09, 0.035, - L / 2 + i * 2 + 1, y, 0.0675, tint( c, rng, 0.1 ) ) );
		return P;

	},

	// a lean-to: tall front posts, short back posts, two beams, a sloped plank roof and a back wall
	leanTo( rng ) {

		const c = tint( WOOD[ 1 ], rng ), P = [];
		const hf = 2.1, hb = 1.4, zf = 0.9, zb = - 0.9;
		for ( const x of [ - 1.1, 1.1 ] ) {

			P.push( box( 0.12, hf, 0.12, x, hf / 2, zf, tint( c, rng, 0.08 ), { anchor: 3000 } ) );
			P.push( box( 0.12, hb, 0.12, x, hb / 2, zb, tint( c, rng, 0.08 ), { anchor: 3000 } ) );

		}

		P.push( box( 2.5, 0.12, 0.12, 0, hf + 0.06, zf, tint( c, rng, 0.08 ) ) );
		P.push( box( 2.5, 0.12, 0.12, 0, hb + 0.06, zb, tint( c, rng, 0.08 ) ) );
		const a = Math.atan2( hf - hb, zf - zb ), len = Math.hypot( hf - hb, zf - zb ) + 0.45;
		const yMid = ( hf + hb ) / 2 + 0.12 + 0.02 / Math.cos( a );
		for ( let k = 0; k < 5; k ++ ) P.push( box( 0.49, 0.04, len, - 1.0 + k * 0.5, yMid, 0, tint( WOOD[ 3 ], rng, 0.12 ), { quat: quatYXZ( 0, - a, 0 ) } ) );
		for ( let k = 0; k < 3; k ++ ) P.push( box( 2.3, 0.42, 0.04, 0, 0.25 + k * 0.44, zb - 0.08, tint( c, rng, 0.1 ) ) );
		return P;

	},

	// a dock railing along x: posts every 1.5 m (anchored to the deck), a mid and a top rail on the outer side
	railing( rng, o ) {

		const L = o.length ?? 4.5, n = Math.max( 2, Math.round( L / 1.5 ) ), step = L / n, c = tint( WOOD[ 2 ], rng ), P = [];
		for ( let i = 0; i <= n; i ++ ) P.push( box( 0.08, 0.95, 0.08, - L / 2 + i * step, 0.475, 0, tint( c, rng, 0.1 ), { anchor: 1600 } ) );
		for ( let i = 0; i < n; i ++ ) for ( const y of [ 0.5, 0.9 ] ) P.push( box( step - 0.02, 0.07, 0.04, - L / 2 + ( i + 0.5 ) * step, y, - 0.06, tint( c, rng, 0.1 ) ) );
		return P;

	},

	// three or four boulders piled up (no joints: a resting stack the physics knocks over)
	rockStack( rng ) {

		const sizes = [ [ 1.3, 0.95, 1.15 ], [ 0.95, 0.75, 0.9 ], [ 0.62, 0.55, 0.6 ] ];
		if ( rng() < 0.5 ) sizes.push( [ 0.38, 0.34, 0.36 ] );
		const P = [];
		let y = 0;
		sizes.forEach( ( s, i ) => {

			const h = s[ 1 ] * ICOSA_Y;
			y += h;
			P.push( { type: 'rock', size: s, pos: { x: ( rng() - 0.5 ) * 0.16, y, z: ( rng() - 0.5 ) * 0.16 }, quat: quatYXZ( rng() * 6.28 ), color: tint( STONE[ i % 3 ], rng, 0.08 ), density: 2400, jf: 0, anchor: 0, float: 1 } );
			y += h - 0.06; // settle into the one below

		} );
		return P;

	},

	// shoal pilings: three posts standing on the seabed up out of the water, two cross beams. o.depth: water depth (m)
	piling( rng, o ) {

		const depth = o.depth ?? 2, top = depth + 1.3 + rng() * 0.4, c = tint( [ 0.22, 0.2, 0.17 ], rng ), P = [];
		for ( const x of [ - 1.2, 0, 1.2 ] ) {

			const h = top - rng() * 0.5;
			P.push( box( 0.26, h, 0.26, x, h / 2 + 0.01, ( rng() - 0.5 ) * 0.1, tint( c, rng, 0.12 ), { anchor: 6000, density: 650, quat: quatYXZ( rng() * 3, ( rng() - 0.5 ) * 0.08, ( rng() - 0.5 ) * 0.08 ) } ) );

		}

		P.push( box( 2.75, 0.16, 0.1, 0, depth + 0.9, 0.19, tint( c, rng, 0.1 ), { density: 650 } ) );
		P.push( box( 2.75, 0.16, 0.1, 0, Math.max( 0.4, depth - 0.1 ), - 0.19, tint( c, rng, 0.1 ), { density: 650 } ) );
		return P;

	},

	// a stranded hull side: five strakes on a leaning plane with three ribs behind them, ribs anchored in the seabed
	wreck( rng ) {

		const b = 0.55 + rng() * 0.15, c = tint( [ 0.26, 0.2, 0.14 ], rng ), P = [];
		const u = { x: Math.sin( b ), y: Math.cos( b ) }, n = { x: Math.cos( b ), y: - Math.sin( b ) };
		const q = quatYXZ( 0, 0, - b );
		for ( let k = 0; k < 5; k ++ ) {

			const s = 0.2 + k * 0.27;
			P.push( box( 0.06, 0.25, 3.4 - Math.abs( k - 1.5 ) * 0.25 - rng() * 0.3, u.x * s, u.y * s + 0.03, ( rng() - 0.5 ) * 0.2, tint( c, rng, 0.12 ), { quat: q } ) );

		}

		for ( const z of [ - 1.3, 0, 1.3 ] ) {

			const s = 0.78;
			P.push( box( 0.13, 1.56, 0.13, u.x * s - n.x * 0.1, u.y * s - n.y * 0.1, z, tint( c, rng, 0.1 ), { quat: q, anchor: 5000 } ) );

		}

		return P;

	},

	// ---- Tidemark's town (wave 12A)

	// a market stall: four posts (anchored), a counter with a front board, a sloped canvas awning, goods on the counter
	stall( rng ) {

		const c = tint( WOOD[ 1 ], rng ), P = [];
		const AWN = [ [ 0.62, 0.16, 0.12 ], [ 0.14, 0.32, 0.52 ], [ 0.66, 0.5, 0.12 ], [ 0.2, 0.42, 0.22 ] ][ Math.floor( rng() * 4 ) ];
		const hf = 2.2, hb = 1.9;
		for ( const x of [ - 1.1, 1.1 ] ) {

			P.push( box( 0.09, hf, 0.09, x, hf / 2, 0.7, tint( c, rng, 0.08 ), { anchor: 2200 } ) );
			P.push( box( 0.09, hb, 0.09, x, hb / 2, - 0.7, tint( c, rng, 0.08 ), { anchor: 2200 } ) );

		}

		P.push( box( 2.3, 0.06, 0.7, 0, 0.9, 0.35, tint( WOOD[ 3 ], rng, 0.1 ) ) ); // counter top
		P.push( box( 2.3, 0.82, 0.04, 0, 0.45, 0.72, tint( c, rng, 0.1 ) ) ); // front board
		for ( const sx of [ - 1, 1 ] ) P.push( box( 0.04, 0.82, 0.62, sx * 1.07, 0.45, 0.35, tint( c, rng, 0.1 ) ) );
		const a = Math.atan2( hf - hb, 1.4 ), len = Math.hypot( hf - hb, 1.4 ) + 0.5;
		P.push( box( 2.5, 0.03, len, 0, ( hf + hb ) / 2 + 0.06, 0, tint( AWN, rng, 0.06 ), { quat: quatYXZ( 0, - a, 0 ), density: 300 } ) );
		for ( let k = 0; k < 3; k ++ ) P.push( box( 0.36, 0.22, 0.28, - 0.7 + k * 0.7, 1.04, 0.3, tint( [ [ 0.6, 0.42, 0.18 ], [ 0.5, 0.55, 0.3 ], [ 0.7, 0.3, 0.2 ] ][ k ], rng, 0.1 ), { density: 400 } ) );
		return P;

	},

	// a hand cart: a plank bed on an axle, two spoked wheels (cylinders turned on their side), two shafts and low sides
	cart( rng ) {

		const c = tint( WOOD[ 0 ], rng ), P = [];
		const wq = quatYXZ( 0, 0, Math.PI / 2 );
		for ( const x of [ - 0.78, 0.78 ] ) P.push( { type: 'barrel', size: [ 1.0, 0.09, 1.0 ], pos: { x, y: 0.5, z: 0 }, quat: wq, color: tint( WOOD[ 2 ], rng, 0.08 ), density: 500, jf: 0, anchor: 0, float: 1 } );
		P.push( box( 1.46, 0.08, 0.08, 0, 0.5, 0, tint( c, rng, 0.08 ) ) ); // axle
		P.push( box( 1.3, 0.07, 1.9, 0, 0.58, - 0.2, tint( c, rng, 0.08 ) ) ); // bed
		for ( const sx of [ - 1, 1 ] ) P.push( box( 0.05, 0.3, 1.9, sx * 0.63, 0.765, - 0.2, tint( c, rng, 0.1 ) ) );
		P.push( box( 1.3, 0.3, 0.05, 0, 0.765, - 1.13, tint( c, rng, 0.1 ) ) );
		for ( const sx of [ - 1, 1 ] ) P.push( box( 0.07, 0.07, 1.5, sx * 0.42, 0.42, 1.48, tint( c, rng, 0.08 ), { quat: quatYXZ( 0, 0.12, 0 ) } ) );
		P.push( box( 0.6, 0.45, 0.5, 0.1, 0.84, - 0.5, tint( WOOD[ 1 ], rng, 0.1 ), { density: 400 } ) ); // a crate riding in the bed
		return P;

	},

	// a lamp post: an anchored post on a foot block, an arm and the lantern (glass box) hanging from it
	lampPost( rng ) {

		const c = tint( [ 0.16, 0.15, 0.14 ], rng, 0.08 ), P = [];
		P.push( box( 0.32, 0.25, 0.32, 0, 0.125, 0, tint( STONE[ 1 ], rng, 0.06 ), { anchor: 3000, density: 2200 } ) );
		P.push( box( 0.12, 3.0, 0.12, 0, 1.75, 0, c, { anchor: 0 } ) );
		P.push( box( 0.06, 0.06, 0.62, 0, 3.12, 0.28, c ) );
		P.push( box( 0.24, 0.32, 0.24, 0, 2.86, 0.5, [ 0.95, 0.72, 0.38 ], { density: 300 } ) );
		P.push( box( 0.3, 0.05, 0.3, 0, 3.045, 0.5, c ) );
		return P;

	},

	// the well's roof: two posts standing on the stone rim (anchored), a ridge beam, two roof boards and the windlass
	wellRoof( rng ) {

		const c = tint( WOOD[ 0 ], rng ), P = [];
		for ( const x of [ - 0.9, 0.9 ] ) P.push( box( 0.12, 1.7, 0.12, x, 0.8 + 0.85, 0, tint( c, rng, 0.08 ), { anchor: 2000 } ) );
		P.push( box( 2.2, 0.12, 0.14, 0, 2.56, 0, tint( c, rng, 0.08 ) ) );
		const a = 0.62, len = 1.25;
		for ( const sz of [ - 1, 1 ] ) P.push( box( 2.3, 0.04, len, 0, 2.56 - Math.sin( a ) * len / 2 + 0.08, sz * Math.cos( a ) * len / 2, tint( WOOD[ 3 ], rng, 0.1 ), { quat: quatYXZ( 0, sz * a, 0 ) } ) );
		P.push( { type: 'barrel', size: [ 0.22, 1.6, 0.22 ], pos: { x: 0, y: 1.9, z: 0 }, quat: quatYXZ( 0, 0, Math.PI / 2 ), color: tint( WOOD[ 1 ], rng, 0.08 ), density: 500, jf: 0, anchor: 0, float: 1 } );
		return P;

	},

	// two shed door leaves across a 4.8 m doorway (x), hung on posts at the jambs (anchored)
	shedDoor( rng ) {

		const c = tint( [ 0.32, 0.36, 0.33 ], rng, 0.1 ), P = [];
		for ( const sx of [ - 1, 1 ] ) {

			P.push( box( 0.16, 3.2, 0.16, sx * 2.48, 1.6, 0, tint( WOOD[ 2 ], rng, 0.08 ), { anchor: 4000 } ) );
			P.push( box( 2.36, 2.9, 0.07, sx * 1.22, 1.5, 0.1, tint( c, rng, 0.06 ) ) );
			P.push( box( 2.2, 0.12, 0.05, sx * 1.22, 0.6, 0.16, tint( c, rng, 0.06 ) ) );
			P.push( box( 2.2, 0.12, 0.05, sx * 1.22, 2.4, 0.16, tint( c, rng, 0.06 ) ) );

		}

		return P;

	},

};

// Blackwater's fort (wave 12B; world/islands/stronghold/Kinds.js): palisade, gunPlatform, powder (def.explosive)
for ( const [ kind, K ] of Object.entries( STRONGHOLD_KINDS ) ) {

	KINDS[ kind ] = K.def;
	BUILD[ kind ] = K.build;

}

// ---- touching pieces become jointed

// the points where piece a lies inside piece b expanded by eps (a's corners, edge midpoints, face centres), in prop space
function contactPoints( a, b, eps ) {

	const ha = pieceHalf( a ), hb = pieceHalf( b ), qbI = conj( b.quat );
	const out = [];
	for ( let i = - 1; i <= 1; i ++ ) for ( let j = - 1; j <= 1; j ++ ) for ( let k = - 1; k <= 1; k ++ ) {

		if ( i === 0 && j === 0 && k === 0 ) continue;
		const r = rotate( a.quat, i * ha[ 0 ], j * ha[ 1 ], k * ha[ 2 ] );
		const p = { x: a.pos.x + r.x, y: a.pos.y + r.y, z: a.pos.z + r.z };
		const l = rotate( qbI, p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z );
		if ( Math.abs( l.x ) <= hb[ 0 ] + eps && Math.abs( l.y ) <= hb[ 1 ] + eps && Math.abs( l.z ) <= hb[ 2 ] + eps ) out.push( p );

	}

	return out;

}

export function findJoints( pieces, eps = 0.035 ) {

	const joints = [];
	for ( let i = 0; i < pieces.length; i ++ ) for ( let k = i + 1; k < pieces.length; k ++ ) {

		const a = pieces[ i ], b = pieces[ k ];
		if ( ! ( a.jf > 0 ) || ! ( b.jf > 0 ) ) continue;
		const pts = contactPoints( a, b, eps ).concat( contactPoints( b, a, eps ) );
		if ( ! pts.length ) continue;
		const c = pts.reduce( ( s, p ) => ( { x: s.x + p.x / pts.length, y: s.y + p.y / pts.length, z: s.z + p.z / pts.length } ), { x: 0, y: 0, z: 0 } );
		joints.push( [ i, k, Math.min( a.jf, b.jf ), c ] );

	}

	return joints;

}

// the foot of an anchored piece (its lowest point in prop space) holds it to the world
function footOf( p ) {

	const h = pieceHalf( p );
	const d = rotate( p.quat, 0, - h[ 1 ], 0 );
	return { x: p.pos.x + d.x, y: p.pos.y + d.y, z: p.pos.z + d.z };

}

export function buildKind( kind, rng, opts = {} ) {

	const K = KINDS[ kind ];
	const pieces = BUILD[ kind ]( rng, opts );
	for ( const p of pieces ) if ( ! p.jf && K.jointForce > 0 ) p.jf = K.jointForce;
	const joints = findJoints( pieces );
	const anchors = [];
	pieces.forEach( ( p, i ) => { if ( p.anchor > 0 ) anchors.push( [ i, p.anchor, footOf( p ) ] ); } );
	return { pieces, joints, anchors };

}

// a heavy hit: barrels burst into eight staves and two lids, boulders split in two; others keep their pieces
export function shatterLayout( kind, pieces, rng ) {

	const out = [];
	for ( const p of pieces ) {

		if ( p.type === 'barrel' ) {

			const r = p.size[ 0 ] / 2, h = p.size[ 1 ];
			const base = { x: p.pos.x, y: p.pos.y - h / 2, z: p.pos.z };
			for ( let k = 0; k < 8; k ++ ) {

				const a = k / 8 * Math.PI * 2;
				const w = 2 * Math.PI * r / 8 - 0.01;
				out.push( box( w, h * 0.97, 0.035, base.x + Math.cos( a ) * ( r - 0.02 ), base.y + h / 2, base.z + Math.sin( a ) * ( r - 0.02 ), tint( p.color, rng, 0.08 ), { quat: quatYXZ( Math.PI / 2 - a ), density: 600 } ) );

			}

			for ( const y of [ 0.02, h - 0.02 ] ) out.push( box( r * 1.5, 0.03, r * 1.5, base.x, base.y + y, base.z, tint( p.color, rng, 0.08 ), { density: 600 } ) );

		} else if ( p.type === 'rock' && p.size[ 0 ] > 0.5 ) {

			const s = p.size.map( ( v ) => v * 0.72 );
			const off = rotate( p.quat, p.size[ 0 ] * 0.2, 0, 0 );
			for ( const sg of [ - 1, 1 ] ) out.push( { ...p, size: s, pos: { x: p.pos.x + off.x * sg, y: p.pos.y + off.y * sg, z: p.pos.z + off.z * sg }, color: tint( p.color, rng, 0.06 ) } );

		} else out.push( p );

	}

	return out;

}

// prop-space bounds of a layout: { min, max, center, half, radius }
export function layoutBounds( pieces ) {

	const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: - Infinity, y: - Infinity, z: - Infinity };
	for ( const p of pieces ) {

		const h = pieceHalf( p );
		for ( let i = - 1; i <= 1; i += 2 ) for ( let j = - 1; j <= 1; j += 2 ) for ( let k = - 1; k <= 1; k += 2 ) {

			const r = rotate( p.quat, i * h[ 0 ], j * h[ 1 ], k * h[ 2 ] );
			const x = p.pos.x + r.x, y = p.pos.y + r.y, z = p.pos.z + r.z;
			if ( x < min.x ) min.x = x; if ( y < min.y ) min.y = y; if ( z < min.z ) min.z = z;
			if ( x > max.x ) max.x = x; if ( y > max.y ) max.y = y; if ( z > max.z ) max.z = z;

		}

	}

	const center = { x: ( min.x + max.x ) / 2, y: ( min.y + max.y ) / 2, z: ( min.z + max.z ) / 2 };
	const half = { x: ( max.x - min.x ) / 2, y: ( max.y - min.y ) / 2, z: ( max.z - min.z ) / 2 };
	return { min, max, center, half, radius: Math.hypot( half.x, half.y, half.z ) };

}

// deterministic random numbers (mulberry32) from a string seed
export function rngFor( key, salt = 0 ) {

	let h = 2166136261 ^ salt;
	for ( let i = 0; i < key.length; i ++ ) h = Math.imul( h ^ key.charCodeAt( i ), 16777619 );
	let a = h >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}
