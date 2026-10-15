// What a damaged building looks like, as instanced boxes (pure geometry, node-testable): scorch marks and broken windows
// (scarred), breaches with soot and a spill of rubble below (gutted), the rubble heap of a collapse and the rigid chunks
// that fall into it, the scaffolding of a repair, and the cosmetic marks on the twin towers' lower facade.
// Every item is { p: [ x, y, z ], q: [ x, y, z, w ], s: [ sx, sy, sz ], c: [ r, g, b ] }; all deterministic from the id.
//
//   looks( b, { stage, marks, repair, progress, heapN, phone } ) -> [ item ]     (b: a CityModel building)
//   heap( b, n ) -> [ item ]   collapse( b, n ) -> Collapse ( .at( t, out ) -> items, .duration )

import { COLORS, KIND_COLOR, COLLAPSE, RENDER } from './CityWreckData.js';
import { rng32, hashStr } from './Model.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const mix3 = ( a, b, t ) => [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ];
const shade = ( c, k ) => [ c[ 0 ] * k, c[ 1 ] * k, c[ 2 ] * k ];

// yaw then pitch then roll (Y X Z), as the destruction props
export function quatYXZ( yaw, pitch = 0, roll = 0 ) {

	const cy = Math.cos( yaw / 2 ), sy = Math.sin( yaw / 2 ), cx = Math.cos( pitch / 2 ), sx = Math.sin( pitch / 2 ), cz = Math.cos( roll / 2 ), sz = Math.sin( roll / 2 );
	return [
		sx * cy * cz + cx * sy * sz,
		cx * sy * cz - sx * cy * sz,
		cx * cy * sz - sx * sy * cz,
		cx * cy * cz + sx * sy * sz,
	];

}

// a building-local point to the world (the inverse of Model.local)
function toWorld( b, lx, ly, lz ) {

	return [ b.x + lx * b.cos + lz * b.sin, b.y0 + ly, b.z - lx * b.sin + lz * b.cos ];

}

export function colorOf( b ) {

	return COLORS[ ( b.p && b.p.wreckColor ) || KIND_COLOR[ b.kind ] || 'concrete' ] || COLORS.concrete;

}

// a point on one of the four facades: face 0 +x, 1 -x, 2 +z, 3 -z; u along it (-1..1), y up it; out: off the wall
function onFace( b, face, u, y, out ) {

	const ax = face < 2, sgn = face % 2 === 0 ? 1 : - 1;
	const half = ax ? b.hd : b.hw;
	const lx = ax ? sgn * ( b.hw + out ) : u * half, lz = ax ? u * half : sgn * ( b.hd + out );
	// the decal's own yaw: its thin axis (local z) along the facade's normal
	const yaw = b.yaw + ( ax ? Math.PI / 2 : 0 );
	return { p: toWorld( b, lx, y, lz ), yaw, half };

}

function decal( b, rnd, kind, yMin, yMax ) {

	const face = Math.floor( rnd() * 4 ), u = rnd() * 1.6 - 0.8;
	const y = yMin + rnd() * Math.max( 0.1, yMax - yMin );
	const f = onFace( b, face, u, y, 0.06 );
	if ( kind === 'window' ) return { p: f.p, q: quatYXZ( f.yaw ), s: [ 1.1 + rnd() * 0.5, 1.2 + rnd() * 0.4, 0.1 ], c: COLORS.window };
	const w = 1.4 + rnd() * 2.6, h = 1.6 + rnd() * 3.2;
	return { p: f.p, q: quatYXZ( f.yaw, 0, ( rnd() - 0.5 ) * 0.5 ), s: [ w, h, 0.08 ], c: mix3( COLORS.scorch, COLORS.soot, rnd() ) };

}

// the rubble heap of a collapse: a mound over the footprint spilling past it, the floors' slabs among the pieces
export function heap( b, n, { shrink = 0 } = {} ) {

	const rnd = rng32( hashStr( b.id + ':heap' ) );
	const spill = Math.min( COLLAPSE.spillMax, Math.max( COLLAPSE.spillMin, b.top * COLLAPSE.spill ) );
	const rx = b.hw + spill * 0.95, rz = b.hd + spill * 0.95;
	const H = Math.min( COLLAPSE.heapMax, b.top * COLLAPSE.heapHeight ) * ( 1 - shrink * 0.75 );
	const base = colorOf( b ), out = [];
	const scale = clamp( Math.sqrt( b.hw * b.hd ) / 6, 0.6, 1.8 );
	// the dust bed under it all
	out.push( { p: toWorld( b, 0, 0.12, 0 ), q: quatYXZ( b.yaw ), s: [ rx * 2 * 0.85, 0.3, rz * 2 * 0.85 ], c: mix3( mix3( COLORS.dust, base, 0.4 ), COLORS.soot, 0.35 ) } );
	const count = Math.max( 4, Math.round( n * ( 1 - shrink ) ) );
	for ( let i = 0; i < count; i ++ ) {

		// denser and bigger in the middle
		const a = rnd() * Math.PI * 2, r = Math.pow( rnd(), 0.75 );
		const lx = Math.cos( a ) * r * rx, lz = Math.sin( a ) * r * rz;
		const prof = H * ( 1 - Math.pow( r, 1.6 ) );
		const big = i < count * 0.25;
		const s = ( big ? 2.4 + rnd() * 1.8 : 0.7 + rnd() * 1.6 ) * scale * ( 1 - r * 0.35 );
		const kind = rnd();
		let size = [ s * ( 0.8 + rnd() * 0.8 ), s * ( 0.35 + rnd() * 0.45 ), s * ( 0.7 + rnd() * 0.6 ) ];
		let c = shade( base, 0.62 + rnd() * 0.5 );
		if ( kind < 0.12 ) { size = [ 0.12, 0.12, s * 1.6 ]; c = COLORS.rebar; } // bent rebar
		else if ( kind < 0.27 ) c = mix3( c, COLORS.soot, 0.7 );
		else if ( kind < 0.36 ) c = mix3( c, COLORS.dust, 0.6 );
		const y = Math.max( size[ 1 ] * 0.3, prof * ( 0.55 + rnd() * 0.45 ) - size[ 1 ] * 0.15 );
		out.push( { p: toWorld( b, lx, y, lz ), q: quatYXZ( b.yaw + rnd() * 6.28, ( rnd() - 0.5 ) * 0.9, ( rnd() - 0.5 ) * 0.9 ), s: size, c, big } );

	}

	// two or three floor slabs leaning out of it
	const slabs = Math.min( 3, Math.max( 1, Math.round( b.floors / 2 ) ) );
	for ( let k = 0; k < slabs; k ++ ) {

		const lx = ( rnd() - 0.5 ) * b.hw, lz = ( rnd() - 0.5 ) * b.hd;
		const w = b.hw * ( 0.8 + rnd() * 0.5 ), d = b.hd * ( 0.6 + rnd() * 0.5 );
		out.push( { p: toWorld( b, lx, H * ( 0.3 + rnd() * 0.4 ), lz ), q: quatYXZ( b.yaw + ( rnd() - 0.5 ) * 0.8, ( rnd() - 0.5 ) * 0.9, ( rnd() - 0.5 ) * 0.7 ), s: [ w, 0.35, d ], c: shade( base, 0.7 + rnd() * 0.2 ), big: true } );

	}

	return out;

}

// the scaffolding of a repair, up to `height`, and the building's new shell rising inside it (a collapse being rebuilt)
function scaffold( b, progress, rebuilding ) {

	const out = [];
	const top = rebuilding ? Math.max( 3, b.top * progress ) : Math.min( b.top, b.cls === 'high' ? 40 : b.top );
	const H = Math.min( b.top + 1.5, top + 2 );
	if ( rebuilding ) out.push( { p: toWorld( b, 0, top / 2, 0 ), q: quatYXZ( b.yaw ), s: [ b.hw * 2 - 0.4, top, b.hd * 2 - 0.4 ], c: shade( COLORS.concrete, 0.95 ) } );
	const off = 1.3, step = 3.2, rows = Math.max( 1, Math.floor( H / 2.2 ) );
	const rnd = rng32( hashStr( b.id + ':scaf' ) );
	for ( let face = 0; face < 4; face ++ ) {

		const ax = face < 2, half = ax ? b.hd : b.hw;
		const n = Math.max( 2, Math.round( half * 2 / step ) + 1 );
		for ( let i = 0; i < n; i ++ ) {

			const u = n === 1 ? 0 : - 1 + 2 * i / ( n - 1 );
			const f = onFace( b, face, u * ( half + off ) / half, H / 2, off );
			out.push( { p: f.p, q: quatYXZ( f.yaw ), s: [ 0.12, H, 0.12 ], c: COLORS.steel } );

		}

		for ( let r = 1; r <= rows; r ++ ) {

			const f = onFace( b, face, 0, r * 2.2, off );
			out.push( { p: f.p, q: quatYXZ( f.yaw ), s: [ ( half + off ) * 2, 0.08, 0.9 ], c: COLORS.timber } );

		}

		// a tarp or two hung on it
		for ( let k = 0; k < 2; k ++ ) {

			if ( rnd() < 0.35 ) continue;
			const f = onFace( b, face, rnd() * 1.4 - 0.7, 2 + rnd() * Math.max( 0.5, H - 6 ), off + 0.5 );
			out.push( { p: f.p, q: quatYXZ( f.yaw ), s: [ 3 + rnd() * 3, 2.5 + rnd() * 2, 0.04 ], c: rnd() < 0.5 ? COLORS.tarp : [ 0.8, 0.8, 0.78 ] } );

		}

	}

	return out;

}

// everything a building shows beyond its own model at this stage
export function looks( b, { stage = b.stage, marks = b.marks || 0, repair = b.repair, progress = 0, heapN = COLLAPSE.heap.desktop, phone = false } = {} ) {

	const out = [];
	const rnd = rng32( hashStr( b.id + ':looks' ) );
	if ( stage === 3 ) {

		if ( repair && repair.phase === 'build' ) return out.concat( heap( b, Math.round( heapN * 0.2 ), { shrink: 1 } ), scaffold( b, progress, true ) );
		return heap( b, phone ? Math.min( heapN, COLLAPSE.heap.phone ) : heapN, { shrink: repair && repair.phase === 'clear' ? progress : 0 } );

	}

	if ( stage >= 1 ) {

		// more marks on a bigger facade
		const area = 2 * ( b.hw + b.hd ) * 2 * Math.min( b.top, 40 );
		const n = Math.round( RENDER.decals[ stage ] * clamp( area / 700, 1, 3 ) * ( phone ? 0.6 : 1 ) );
		const yMax = b.cls === 'high' ? b.top * 0.95 : b.top - 0.8;
		const yMin = b.cls === 'high' && stage === 2 ? b.top * 0.55 : 1;
		for ( let i = 0; i < n; i ++ ) out.push( decal( b, rnd, i % 5 < 3 ? 'window' : 'scorch', yMin, yMax ) );

	}

	if ( stage === 2 ) {

		// breaches through the facade, soot streaked above them, rubble spilled below
		const base = colorOf( b );
		const nb = ( b.cls === 'high' ? 3 : 2 ) + ( b.hw * b.hd * 4 > 900 ? 1 : 0 );
		for ( let i = 0; i < nb; i ++ ) {

			const face = Math.floor( rnd() * 4 ), u = rnd() * 1.2 - 0.6;
			const fl = b.cls === 'high' ? b.top * ( 0.6 + rnd() * 0.3 ) : Math.max( 2, b.top * ( 0.25 + rnd() * 0.5 ) );
			const w = Math.min( 7, 3 + rnd() * 4 ), h = Math.min( b.top * 0.5, 2.6 + rnd() * 2.4 );
			const f = onFace( b, face, u, fl, - 0.1 );
			out.push( { p: f.p, q: quatYXZ( f.yaw, 0, ( rnd() - 0.5 ) * 0.3 ), s: [ w, h, 0.5 ], c: COLORS.breach } );
			const s = onFace( b, face, u, fl + h / 2 + 2.6, 0.07 );
			out.push( { p: s.p, q: quatYXZ( s.yaw ), s: [ w * 0.8, 5.2, 0.06 ], c: COLORS.soot } );
			if ( b.cls !== 'high' || i === 0 ) {

				for ( let k = 0; k < ( phone ? 3 : 6 ); k ++ ) {

					const g = onFace( b, face, u + ( rnd() - 0.5 ) * 0.3, 0.3, 0.6 + rnd() * 2.2 );
					const sz = 0.5 + rnd() * 1.1;
					out.push( { p: [ g.p[ 0 ], b.y0 + sz * 0.25, g.p[ 2 ] ], q: quatYXZ( rnd() * 6.28, ( rnd() - 0.5 ) * 0.6, 0 ), s: [ sz, sz * 0.5, sz * 0.8 ], c: shade( base, 0.6 + rnd() * 0.4 ) } );

				}

			}

		}

	}

	if ( repair && repair.phase === 'build' && stage > 0 ) out.push( ...scaffold( b, progress, false ) );
	return out;

}

// the collapse: rigid chunks of the building fall floor by floor (the lowest first, the rest following it down) and settle
// as the heap's big pieces, so the heap takes over without a jump
export class Collapse {

	constructor( b, n, { heapN = COLLAPSE.heap.desktop } = {} ) {

		this.b = b;
		const H = heap( b, heapN );
		const targets = H.filter( ( it ) => it.big ).slice( 0, n );
		const rnd = rng32( hashStr( b.id + ':fall' ) );
		const m = targets.length;
		const floors = Math.max( 1, Math.min( b.floors, Math.ceil( m / 4 ) ) );
		const per = Math.ceil( m / floors );
		const nx = Math.max( 1, Math.round( Math.sqrt( per * b.hw / Math.max( 1, b.hd ) ) ) ), nz = Math.max( 1, Math.ceil( per / nx ) );
		const fh = b.top / floors;
		// starts: a grid of blocks through the building's volume, lowest first; targets sorted by height to match
		const starts = [];
		for ( let k = 0; k < floors && starts.length < m; k ++ ) {

			for ( let i = 0; i < nx && starts.length < m; i ++ ) for ( let j = 0; j < nz && starts.length < m; j ++ ) {

				const lx = - b.hw + ( i + 0.5 ) * ( 2 * b.hw / nx ), lz = - b.hd + ( j + 0.5 ) * ( 2 * b.hd / nz );
				starts.push( { p: toWorld( b, lx, ( k + 0.5 ) * fh, lz ), s: [ 2 * b.hw / nx * 0.97, fh * 0.94, 2 * b.hd / nz * 0.97 ], level: k } );

			}

		}

		targets.sort( ( a, c ) => a.p[ 1 ] - c.p[ 1 ] );
		this.chunks = [];
		let end = 0;
		for ( let i = 0; i < starts.length; i ++ ) {

			const s = starts[ i ], t = targets[ i ];
			const delay = 0.05 + s.level * 0.11 + rnd() * 0.12;
			const drop = Math.max( 0.5, s.p[ 1 ] - t.p[ 1 ] );
			const T = Math.max( 0.45, Math.sqrt( 2 * drop / COLLAPSE.gravity ) );
			this.chunks.push( { s, t, delay, T, drop, q0: quatYXZ( b.yaw ), c: shade( colorOf( b ), 0.8 + rnd() * 0.25 ) } );
			end = Math.max( end, delay + T );

		}

		this.duration = b.cls === 'tower' ? end + 0.4 : Math.min( COLLAPSE.duration + 2, end + 0.4 );
		this.landedAt = Math.min( ...this.chunks.map( ( c ) => c.delay + c.T ) );

	}

	// the chunks' poses at t seconds into the fall
	at( t, out = [] ) {

		for ( const c of this.chunks ) {

			const f = clamp( ( t - c.delay ) / c.T, 0, 1 );
			const e = f * f; // falling: slow then fast
			const h = f * f * ( 3 - 2 * f );
			const p = [ c.s.p[ 0 ] + ( c.t.p[ 0 ] - c.s.p[ 0 ] ) * h, c.s.p[ 1 ] - c.drop * e, c.s.p[ 2 ] + ( c.t.p[ 2 ] - c.s.p[ 2 ] ) * h ];
			const s = [ c.s.s[ 0 ] + ( c.t.s[ 0 ] - c.s.s[ 0 ] ) * h, c.s.s[ 1 ] + ( c.t.s[ 1 ] - c.s.s[ 1 ] ) * h, c.s.s[ 2 ] + ( c.t.s[ 2 ] - c.s.s[ 2 ] ) * h ];
			const q = f >= 1 ? c.t.q : slerp( c.q0, c.t.q, h );
			out.push( { p, q, s, c: f >= 1 ? c.t.c : mix3( c.c, c.t.c, h ) } );

		}

		return out;

	}

}

function slerp( a, b, t ) {

	let d = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ];
	const sg = d < 0 ? - 1 : 1;
	d = Math.abs( d );
	const x = a[ 0 ] + ( b[ 0 ] * sg - a[ 0 ] ) * t, y = a[ 1 ] + ( b[ 1 ] * sg - a[ 1 ] ) * t, z = a[ 2 ] + ( b[ 2 ] * sg - a[ 2 ] ) * t, w = a[ 3 ] + ( b[ 3 ] * sg - a[ 3 ] ) * t;
	const l = Math.hypot( x, y, z, w ) || 1;
	return [ x / l, y / l, z / l, w / l ];

}
