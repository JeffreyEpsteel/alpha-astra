import { Color } from '../../../engine/index.js';
import { Acc, STYLE } from './Facades.js';
import { cityPlan, MERIDIAN, LAYOUT, DOCKS_DECK, SIDEWALK, coastDistanceRel, coastKindRel } from './CityPlan.js';

// Meridian's streets (wave 21A), drawn with the facade material's ground codes into one accumulator: the carriageways on
// the terrain (asphalt, 3 cm up), junction boxes, kerbed sidewalks (0.15 m) round every city block with corner squares,
// zebra crossings and stop lines at the junctions, lane paint (double yellow on the avenues, white dashes), the hill road
// as a ribbon on its graded profile, the plazas (granite: the Twins' plaza, the market, city hall square), the park's
// paths, the stone seawalls of the docks, the basin, the moles and the airport, the pier, the ferry slip and the runway.
//
//   buildStreets( { tile, plan } ) -> { acc, stats, crossings: [ { x, z } ], lamps: [ { x, z, yaw } ], signals: [ { node,
//                                       x, z, yaw, axis } ], benches, trees, hydrants }   (placements for the kit)

const C = ( hex ) => new Color( hex );
const ASPHALT = C( 0x3a3b3d ), ASPHALT_HILL = C( 0x46464a ), PAVE = C( 0xb9b5ad ), KERB = C( 0x9d9a94 ), WHITE = C( 0xe8e6e0 ), YELLOW = C( 0xd9b23a );
const GRANITE = C( 0xb8b2aa ), COBBLE = C( 0x8e8074 ), GRAVEL = C( 0xb6a88f ), QUAY = C( 0x7f7a70 ), COPING = C( 0xa7a197 ), TIMBER = C( 0x6b5338 ), RUNWAY = C( 0x2f3032 );
const A = ( code ) => [ code, 3, 3, 0 ];
const KERB_H = 0.15, ROAD_UP = 0.03, PAINT_UP = 0.045;
const CX = MERIDIAN.center.x, CZ = MERIDIAN.center.z;

export function buildStreets( { tile, plan = cityPlan(), acc = new Acc() } = {} ) {

	const H = ( x, z ) => tile.roadHeight( x, z );
	const N = plan.roads.byId;
	const out = { acc, lamps: [], signals: [], crossings: [], benches: [], trees: [], hydrants: [], stats: {} };
	const axisOf = ( e ) => {

		const a = N[ e.a ], b = N[ e.b ];
		const dx = b.x - a.x, dz = b.z - a.z;
		return Math.abs( dx ) < 0.01 ? 'ns' : Math.abs( dz ) < 0.01 ? 'ew' : 'diag';

	};

	// ---- each node's junction box: hx (half width of its north-south roads), hz (east-west roads), and which sides have a road
	const J = {};
	for ( const n of plan.roads.nodes ) J[ n.id ] = { hx: 0, hz: 0, n: false, s: false, e: false, w: false, diag: false, hill: false, edges: [] };
	for ( const e of plan.roads.edges ) {

		const ax = axisOf( e );
		for ( const [ id, other ] of [ [ e.a, e.b ], [ e.b, e.a ] ] ) {

			const j = J[ id ], p = N[ id ], q = N[ other ];
			j.edges.push( e );
			if ( e.kind === 'hill' ) { j.hill = true; continue; }
			if ( ax === 'ns' ) { j.hx = Math.max( j.hx, e.width / 2 ); if ( q.z < p.z ) j.n = true; else j.s = true; }
			else if ( ax === 'ew' ) { j.hz = Math.max( j.hz, e.width / 2 ); if ( q.x < p.x ) j.w = true; else j.e = true; }
			else j.diag = true;

		}

	}

	for ( const id in J ) {

		const j = J[ id ];
		if ( ! j.hx ) j.hx = j.hz || 3.75;
		if ( ! j.hz ) j.hz = j.hx;

	}

	// ---- carriageways (subdivided every 8 m: the ground's kinks at the docks), lane paint, crossings
	const strip = ( ax, az, bx, bz, half, y0off, col, code, step = 8 ) => {

		const L = Math.hypot( bx - ax, bz - az );
		if ( L < 0.05 ) return;
		const tx = ( bx - ax ) / L, tz = ( bz - az ) / L, nx = - tz, nz = tx;
		const n = Math.max( 1, Math.ceil( L / step ) );
		for ( let k = 0; k < n; k ++ ) {

			const s0 = k / n * L, s1 = ( k + 1 ) / n * L;
			const p0x = ax + tx * s0, p0z = az + tz * s0, p1x = ax + tx * s1, p1z = az + tz * s1;
			const l0 = [ p0x + nx * half, p0z + nz * half ], r0 = [ p0x - nx * half, p0z - nz * half ];
			const l1 = [ p1x + nx * half, p1z + nz * half ], r1 = [ p1x - nx * half, p1z - nz * half ];
			const y = ( x, z ) => H( x, z ) + y0off;
			// counter-clockwise from above: right0, right1, left1, left0 (n is the left of the travel direction)
			acc.quad( [ r0[ 0 ], y( ...r0 ), r0[ 1 ] ], [ l0[ 0 ], y( ...l0 ), l0[ 1 ] ], [ l1[ 0 ], y( ...l1 ), l1[ 1 ] ], [ r1[ 0 ], y( ...r1 ), r1[ 1 ] ], [ 0, 1, 0 ],
				[ [ r0[ 0 ], r0[ 1 ] ], [ l0[ 0 ], l0[ 1 ] ], [ l1[ 0 ], l1[ 1 ] ], [ r1[ 0 ], r1[ 1 ] ] ], col, A( code ) );

		}

	};
	// a flat rectangle on the ground (axis aligned), with an optional kerb face round it
	const pad = ( x0, x1, z0, z1, up, col, code, kerb = false ) => {

		if ( x1 - x0 < 0.05 || z1 - z0 < 0.05 ) return;
		const nx = Math.max( 1, Math.ceil( ( x1 - x0 ) / 12 ) ), nz = Math.max( 1, Math.ceil( ( z1 - z0 ) / 12 ) );
		for ( let i = 0; i < nx; i ++ ) for ( let k = 0; k < nz; k ++ ) {

			const a0 = x0 + ( x1 - x0 ) * i / nx, a1 = x0 + ( x1 - x0 ) * ( i + 1 ) / nx, b0 = z0 + ( z1 - z0 ) * k / nz, b1 = z0 + ( z1 - z0 ) * ( k + 1 ) / nz;
			acc.quad( [ a0, H( a0, b0 ) + up, b0 ], [ a0, H( a0, b1 ) + up, b1 ], [ a1, H( a1, b1 ) + up, b1 ], [ a1, H( a1, b0 ) + up, b0 ], [ 0, 1, 0 ], [ [ a0, b0 ], [ a0, b1 ], [ a1, b1 ], [ a1, b0 ] ], col, A( code ) );

		}

		if ( kerb ) {

			const kc = KERB, ka = A( STYLE.pavement );
			const wallH = ( px, pz, qx, qz ) => {

				const n = Math.max( 1, Math.ceil( Math.hypot( qx - px, qz - pz ) / 12 ) );
				for ( let k = 0; k < n; k ++ ) {

					const ax = px + ( qx - px ) * k / n, az = pz + ( qz - pz ) * k / n, bx = px + ( qx - px ) * ( k + 1 ) / n, bz = pz + ( qz - pz ) * ( k + 1 ) / n;
					const ya = H( ax, az ), yb = H( bx, bz );
					const L = Math.hypot( bx - ax, bz - az ), nrm = [ - ( bz - az ) / L, 0, ( bx - ax ) / L ];
					acc.quad( [ ax, ya - 0.05, az ], [ bx, yb - 0.05, bz ], [ bx, yb + up, bz ], [ ax, ya + up, az ], nrm, [ [ 0, 0 ], [ L, 0 ], [ L, up ], [ 0, up ] ], kc, ka );

				}

			};
			wallH( x0, z1, x1, z1 ); wallH( x1, z1, x1, z0 ); wallH( x1, z0, x0, z0 ); wallH( x0, z0, x0, z1 );

		}

	};
	const paint = ( ax, az, bx, bz, w, col ) => strip( ax, az, bx, bz, w / 2, PAINT_UP, col, STYLE.paint, 12 );
	const dashes = ( ax, az, bx, bz, off, w, col, dash = 3, gap = 6 ) => {

		const L = Math.hypot( bx - ax, bz - az ), tx = ( bx - ax ) / L, tz = ( bz - az ) / L, nx = - tz, nz = tx;
		for ( let s = 2; s + dash < L - 2; s += dash + gap ) paint( ax + tx * s + nx * off, az + tz * s + nz * off, ax + tx * ( s + dash ) + nx * off, az + tz * ( s + dash ) + nz * off, w, col );

	};

	let roadTris0 = acc.idx.length;
	for ( const e of plan.roads.edges ) {

		const a = N[ e.a ], b = N[ e.b ], ax = axisOf( e );
		const L = Math.hypot( b.x - a.x, b.z - a.z ), tx = ( b.x - a.x ) / L, tz = ( b.z - a.z ) / L;
		if ( e.kind === 'hill' || ax === 'diag' ) {

			// a ribbon on the graded profile, and a pad at each bend (no gaps at the joints)
			strip( a.x, a.z, b.x, b.z, e.width / 2, ROAD_UP, e.kind === 'hill' ? ASPHALT_HILL : ASPHALT, STYLE.asphalt, 4 );
			dashes( a.x, a.z, b.x, b.z, 0, 0.12, WHITE );
			continue;

		}

		// trimmed to the junction boxes at both ends
		const ja = J[ e.a ], jb = J[ e.b ];
		const ta = ax === 'ns' ? ja.hz : ja.hx, tb = ax === 'ns' ? jb.hz : jb.hx;
		const sx = a.x + tx * ta, sz = a.z + tz * ta, ex = b.x - tx * tb, ez = b.z - tz * tb;
		strip( sx, sz, ex, ez, e.width / 2, ROAD_UP, ASPHALT, STYLE.asphalt );
		// lane paint (clear of the crossings: 5 m off each junction)
		const cut = 5.5;
		const px = sx + tx * cut, pz = sz + tz * cut, qx = ex - tx * cut, qz = ez - tz * cut;
		if ( Math.hypot( qx - px, qz - pz ) > 4 ) {

			if ( e.lanes >= 4 ) {

				paint( px - tz * 0.18, pz + tx * 0.18, qx - tz * 0.18, qz + tx * 0.18, 0.12, YELLOW );
				paint( px + tz * 0.18, pz - tx * 0.18, qx + tz * 0.18, qz - tx * 0.18, 0.12, YELLOW );
				dashes( px, pz, qx, qz, 3.5, 0.12, WHITE );
				dashes( px, pz, qx, qz, - 3.5, 0.12, WHITE );

			} else dashes( px, pz, qx, qz, 0, 0.12, WHITE );

		}

		// zebra crossings at both ends (city streets), stop lines where there are signals
		if ( e.kind !== 'quay' ) for ( const [ n, cx, cz, dir ] of [ [ a, sx, sz, 1 ], [ b, ex, ez, - 1 ] ] ) {

			const half = e.width / 2;
			// bars along the travel direction, 0.5 m wide, 1 m apart, 3 m long, starting 0.5 m off the junction box
			for ( let o = - half + 0.6; o <= half - 0.4; o += 1.0 ) {

				const x0 = cx + tx * dir * 0.5 - tz * o, z0 = cz + tz * dir * 0.5 + tx * o;
				paint( x0, z0, x0 + tx * dir * 3, z0 + tz * dir * 3, 0.5, WHITE );

			}

			out.crossings.push( { x: cx + tx * dir * 2, z: cz + tz * dir * 2, node: n.id } );
			if ( n.signal ) {

				// the stop line across the lanes coming in (right-hand traffic: the incoming lanes are on the right of -dir)
				const sl = cx + tx * dir * 4.2, sz2 = cz + tz * dir * 4.2;
				const rx = tz * dir, rz = - tx * dir; // right of the incoming travel (-dir * t)
				paint( sl, sz2, sl + rx * half * 0.95, sz2 + rz * half * 0.95, 0.4, WHITE );

			}

		}

	}

	// junction boxes and the sidewalks round them
	for ( const n of plan.roads.nodes ) {

		const j = J[ n.id ];
		if ( j.hill && ! j.n && ! j.s && ! j.e && ! j.w ) {

			const r = 3.75;
			pad( n.x - r, n.x + r, n.z - r, n.z + r, ROAD_UP, ASPHALT_HILL, STYLE.asphalt );
			continue;

		}

		pad( n.x - j.hx, n.x + j.hx, n.z - j.hz, n.z + j.hz, ROAD_UP, ASPHALT, STYLE.asphalt );
		if ( j.edges.every( ( e ) => e.kind === 'hill' ) ) continue;
		// the corner squares, and the sidewalk across a side with no road
		const w = SIDEWALK;
		for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

			const x0 = sx < 0 ? n.x - j.hx - w : n.x + j.hx, z0 = sz < 0 ? n.z - j.hz - w : n.z + j.hz;
			pad( x0, x0 + w, z0, z0 + w, KERB_H, PAVE, STYLE.pavement, true );

		}

		if ( ! j.n ) pad( n.x - j.hx, n.x + j.hx, n.z - j.hz - w, n.z - j.hz, KERB_H, PAVE, STYLE.pavement, true );
		if ( ! j.s ) pad( n.x - j.hx, n.x + j.hx, n.z + j.hz, n.z + j.hz + w, KERB_H, PAVE, STYLE.pavement, true );
		if ( ! j.w ) pad( n.x - j.hx - w, n.x - j.hx, n.z - j.hz, n.z + j.hz, KERB_H, PAVE, STYLE.pavement, true );
		if ( ! j.e ) pad( n.x + j.hx, n.x + j.hx + w, n.z - j.hz, n.z + j.hz, KERB_H, PAVE, STYLE.pavement, true );

	}

	out.stats.roads = ( acc.idx.length - roadTris0 ) / 3;

	// sidewalks along the axis aligned edges (between the corner squares), and the street furniture on them
	let lampK = 0;
	const sw0 = acc.idx.length;
	for ( const e of plan.roads.edges ) {

		const ax = axisOf( e );
		if ( e.kind === 'hill' || ax === 'diag' ) continue;
		const a = N[ e.a ], b = N[ e.b ], ja = J[ e.a ], jb = J[ e.b ];
		const half = e.width / 2, w = SIDEWALK;
		for ( const side of [ - 1, 1 ] ) {

			if ( e.kind === 'quay' && side > 0 ) continue; // the quay road's water side is the open apron
			if ( ax === 'ns' ) {

				const z0 = Math.min( a.z, b.z ) + ( a.z < b.z ? ja.hz : jb.hz ) + w, z1 = Math.max( a.z, b.z ) - ( a.z < b.z ? jb.hz : ja.hz ) - w;
				const x0 = side > 0 ? a.x + half : a.x - half - w;
				pad( x0, x0 + w, z0, z1, KERB_H, PAVE, STYLE.pavement, true );
				furnish( e, x0 + ( side > 0 ? 0.7 : w - 0.7 ), z0, x0 + ( side > 0 ? 0.7 : w - 0.7 ), z1, side > 0 ? - Math.PI / 2 : Math.PI / 2 );

			} else {

				const x0 = Math.min( a.x, b.x ) + ( a.x < b.x ? ja.hx : jb.hx ) + w, x1 = Math.max( a.x, b.x ) - ( a.x < b.x ? jb.hx : ja.hx ) - w;
				const z0 = side > 0 ? a.z + half : a.z - half - w;
				pad( x0, x1, z0, z0 + w, KERB_H, PAVE, STYLE.pavement, true );
				furnish( e, x0, z0 + ( side > 0 ? 0.7 : w - 0.7 ), x1, z0 + ( side > 0 ? 0.7 : w - 0.7 ), side > 0 ? Math.PI : 0 );

			}

		}

	}

	out.stats.sidewalks = ( acc.idx.length - sw0 ) / 3;

	// street lamps (one side, ~40 m apart, avenues both sides), hydrants, a bench now and then; yaw: the lamp arm over the road
	function furnish( e, ax, az, bx, bz, yaw ) {

		const L = Math.hypot( bx - ax, bz - az );
		if ( L < 10 ) return;
		const tx = ( bx - ax ) / L, tz = ( bz - az ) / L;
		const every = e.lanes >= 4 ? 34 : 42;
		for ( let s = 8; s < L - 4; s += every ) {

			if ( e.lanes < 4 && ( lampK ++ ) % 2 ) continue;
			out.lamps.push( { x: ax + tx * s, z: az + tz * s, yaw } );

		}

		if ( L > 40 ) out.hydrants.push( { x: ax + tx * ( L * 0.5 + 3 ), z: az + tz * ( L * 0.5 + 3 ), yaw } );
		if ( e.lanes >= 4 && L > 60 ) out.benches.push( { x: ax + tx * L * 0.3, z: az + tz * L * 0.3, yaw: yaw + Math.PI } );
		if ( e.lanes >= 4 ) for ( let s = 14; s < L - 8; s += 22 ) out.trees.push( { x: ax + tx * s, z: az + tz * s, yaw: s, street: true } );

	}

	// traffic signals: a pole on each corner of a signalled junction, facing the traffic that comes at it
	for ( const n of plan.roads.nodes ) {

		if ( ! n.signal ) continue;
		const j = J[ n.id ];
		for ( const [ sx, sz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) {

			const x = n.x + sx * ( j.hx + 0.8 ), z = n.z + sz * ( j.hz + 0.8 );
			// right-hand traffic: the pole on the near-right corner shows the approach that drives toward the junction:
			// a pole at +z (south) side with sx > 0 (east) faces south (yaw 0), and so on round
			const yaw = sz > 0 && sx > 0 ? 0 : sz > 0 && sx < 0 ? - Math.PI / 2 : sz < 0 && sx < 0 ? Math.PI : Math.PI / 2;
			const axis = ( yaw === 0 || yaw === Math.PI ) ? 'ns' : 'ew';
			out.signals.push( { node: n.id, x, z, yaw, axis } );

		}

	}

	// ---- plazas
	const P = Object.fromEntries( plan.plazas.map( ( p ) => [ p.id, p ] ) );
	const slab = ( p, col, code, up = KERB_H ) => pad( p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2, up, col, code, true );
	slab( P.twins, GRANITE, STYLE.granite );
	slab( P.market, COBBLE, STYLE.granite );
	slab( P.hall, GRANITE, STYLE.granite );
	// the park: gravel paths across it (diagonals and a ring) and its trees
	{

		const p = P.park, x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
		strip( x0 + 2, z0 + 2, x1 - 2, z1 - 2, 1.4, 0.04, GRAVEL, STYLE.plain, 6 );
		strip( x0 + 2, z1 - 2, x1 - 2, z0 + 2, 1.4, 0.04, GRAVEL, STYLE.plain, 6 );
		strip( p.x, z0 + 1, p.x, z1 - 1, 1.6, 0.045, GRAVEL, STYLE.plain, 6 );
		let k = 0;
		for ( let x = x0 + 8; x < x1 - 6; x += 13 ) for ( let z = z0 + 8; z < z1 - 6; z += 13 ) {

			const h = Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453 % 1;
			if ( Math.abs( h ) < 0.3 ) continue;
			const jx = x + h * 4, jz = z - h * 3;
			// off the paths
			const dd = Math.min( Math.abs( ( jx - x0 ) / ( x1 - x0 ) - ( jz - z0 ) / ( z1 - z0 ) ), Math.abs( ( jx - x0 ) / ( x1 - x0 ) - ( z1 - jz ) / ( z1 - z0 ) ) ) * Math.min( x1 - x0, z1 - z0 );
			if ( dd < 4 || Math.abs( jx - p.x ) < 4 ) continue;
			out.trees.push( { x: jx, z: jz, yaw: k ++ } );

		}

		for ( let z = z0 + 12; z < z1 - 8; z += 24 ) out.benches.push( { x: p.x + 2.6, z, yaw: - Math.PI / 2 }, { x: p.x - 2.6, z, yaw: Math.PI / 2 } );

	}

	// benches along the harbour quay, looking out over the basin (clear of the fish market's stall, the vendors and the pier)
	{

		const A = P.apron, u = A.x + A.w / 2 - 6;
		const busy = [ plan.port.stand, plan.port.notice, plan.port.agent, ...plan.port.vendors ];
		for ( let z = A.z - A.d / 2 + 10; z < A.z + A.d / 2 - 6; z += 22 ) {

			if ( busy.some( ( q ) => Math.abs( q.z - z ) < 9 ) || Math.abs( z - plan.docks[ 0 ].a.z ) < 8 ) continue;
			out.benches.push( { x: u, z, yaw: Math.PI / 2, quay: true } );

		}

	}

	// the Twins' plaza: the fountain's basin round the bronze globe, benches round it
	const globe = { x: ( plan.buildings[ 0 ].x + plan.buildings[ 1 ].x ) / 2 - 18, z: ( plan.buildings[ 0 ].z + plan.buildings[ 1 ].z ) / 2 + 22 };
	{

		const y = H( globe.x, globe.z ) + KERB_H;
		acc.cylinder( globe.x, globe.z, 13, 13, y - 0.2, y + 0.55, 32, C( 0x9a948a ), A( STYLE.plain ), { top: false } );
		acc.cylinder( globe.x, globe.z, 12.4, 12.4, y + 0.3, y + 0.3, 32, C( 0x2d4d58 ), [ STYLE.panel, 3, 3, 0 ], { top: true } ); // (the water: a dark glossy disc)
		acc.cylinder( globe.x, globe.z, 0.9, 0.7, y, y + 3.2, 10, C( 0x6b5a3a ), A( STYLE.metal ) );
		acc.sphere( globe.x, y + 7.6, globe.z, 4.6, 18, 12, C( 0x8a6a3a ), A( STYLE.metal ) );
		for ( let k = 0; k < 8; k ++ ) {

			const a = k / 8 * Math.PI * 2;
			out.benches.push( { x: globe.x + Math.cos( a ) * 17, z: globe.z + Math.sin( a ) * 17, yaw: Math.atan2( - Math.cos( a ), - Math.sin( a ) ), plaza: true } );

		}

		out.globe = { ...globe, y };

	}

	// ---- the seawalls: marching squares on the designed coast (2 m) where it is engineered, a stone face from the dredged
	// floor to the deck and a coping along the top
	const sw = acc.idx.length;
	const S = 2;
	const B = { u0: LAYOUT.AIRPORT.x0 - 20, u1: 800, v0: LAYOUT.AIRPORT.z0 - 20, v1: 460 };
	const nu = Math.ceil( ( B.u1 - B.u0 ) / S ), nv = Math.ceil( ( B.v1 - B.v0 ) / S );
	const d = new Float32Array( ( nu + 1 ) * ( nv + 1 ) );
	for ( let j = 0; j <= nv; j ++ ) for ( let i = 0; i <= nu; i ++ ) d[ j * ( nu + 1 ) + i ] = coastDistanceRel( B.u0 + i * S, B.v0 + j * S );
	const lerpZero = ( pa, pb, da, db ) => {

		const t = da / ( da - db );
		return [ pa[ 0 ] + ( pb[ 0 ] - pa[ 0 ] ) * t, pa[ 1 ] + ( pb[ 1 ] - pa[ 1 ] ) * t ];

	};
	const quayFace = ( p, q ) => {

		// p -> q with the land on the left seen from the sea: the face looks out to sea
		const mu = ( p[ 0 ] + q[ 0 ] ) / 2, mv = ( p[ 1 ] + q[ 1 ] ) / 2;
		if ( coastKindRel( mu, mv ) !== 'seawall' ) return;
		const [ px, pz ] = [ CX + p[ 0 ], CZ + p[ 1 ] ], [ qx, qz ] = [ CX + q[ 0 ], CZ + q[ 1 ] ];
		const top = DOCKS_DECK + 0.25;
		acc.wall( px, pz, qx, qz, - 8, top, 0, QUAY, A( STYLE.plain ) );
		// the coping: a 0.6 m stone lip, flush with the face
		const L = Math.hypot( qx - px, qz - pz );
		if ( L < 1e-3 ) return;
		const nx = - ( qz - pz ) / L, nz = ( qx - px ) / L;
		acc.quad( [ px, top, pz ], [ px - nx * 0.6, top, pz - nz * 0.6 ], [ qx - nx * 0.6, top, qz - nz * 0.6 ], [ qx, top, qz ], [ 0, 1, 0 ], [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ] ], COPING, A( STYLE.plain ) );

	};
	for ( let j = 0; j < nv; j ++ ) for ( let i = 0; i < nu; i ++ ) {

		const k = j * ( nu + 1 ) + i;
		const c = [ d[ k ], d[ k + 1 ], d[ k + nu + 2 ], d[ k + nu + 1 ] ]; // (i,j) (i+1,j) (i+1,j+1) (i,j+1)
		const pts = [ [ B.u0 + i * S, B.v0 + j * S ], [ B.u0 + ( i + 1 ) * S, B.v0 + j * S ], [ B.u0 + ( i + 1 ) * S, B.v0 + ( j + 1 ) * S ], [ B.u0 + i * S, B.v0 + ( j + 1 ) * S ] ];
		let idx = 0;
		for ( let q = 0; q < 4; q ++ ) if ( c[ q ] < 0 ) idx |= 1 << q; // land corners
		if ( idx === 0 || idx === 15 ) continue;
		// the crossing points on the cell's edges, then pair them so the land lies on the left of p -> q (the wall faces the sea)
		const cross = [];
		for ( let q = 0; q < 4; q ++ ) {

			const r = ( q + 1 ) % 4;
			if ( ( c[ q ] < 0 ) !== ( c[ r ] < 0 ) ) cross.push( { e: q, p: lerpZero( pts[ q ], pts[ r ], c[ q ], c[ r ] ), landFirst: c[ q ] < 0 } );

		}

		if ( cross.length === 2 ) {

			// walking the cell's boundary (counter-clockwise from above: x right, z down -> this order turns clockwise in x/z),
			// the edge leaving land enters the sea: from the land-to-sea crossing to the sea-to-land crossing the land is on the left
			const [ a, b ] = cross;
			const from = a.landFirst ? a : b, to = a.landFirst ? b : a;
			quayFace( to.p, from.p );

		} else if ( cross.length === 4 ) {

			const pair = ( x, y ) => quayFace( ( y.landFirst ? y : x ).p, ( y.landFirst ? x : y ).p );
			pair( cross[ 0 ], cross[ 1 ] );
			pair( cross[ 2 ], cross[ 3 ] );

		}

	}

	out.stats.seawalls = ( acc.idx.length - sw ) / 3;

	// ---- the pier (deck on piles), the ferry slip, the runway
	for ( const D of plan.docks ) {

		if ( D.kind === 'pier' ) {

			const x0 = Math.min( D.a.x, D.b.x ), x1 = Math.max( D.a.x, D.b.x ), z0 = D.a.z - D.width / 2, z1 = D.a.z + D.width / 2;
			acc.box( x0, x1, z0, z1, D.deck - 0.5, D.deck, 0, TIMBER, A( STYLE.plain ), { topCol: C( 0x7a6248 ) } );
			for ( let x = x0 + 3; x < x1; x += 6 ) for ( const z of [ z0 + 0.4, z1 - 0.4 ] ) acc.cylinder( x, z, 0.25, 0.25, - 8, D.deck - 0.5, 6, C( 0x3f3426 ), A( STYLE.plain ), { top: false } );

		} else if ( D.kind === 'ferry' ) {

			// a ramp from the quay into the water, its side walls
			const x0 = D.a.x - D.width / 2, x1 = D.a.x + D.width / 2, zt = D.a.z, zb = D.b.z;
			const yt = DOCKS_DECK + 0.05, yb = - 1.2;
			acc.quad( [ x0, yb, zb ], [ x0, yt, zt ], [ x1, yt, zt ], [ x1, yb, zb ], [ 0, 0.995, - 0.1 ], [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ] ], C( 0x77736b ), A( STYLE.pavement ) );
			acc.wall( x0, zt, x0, zb, - 3, yt + 0.6, 0, QUAY, A( STYLE.plain ) );
			acc.wall( x1, zb, x1, zt, - 3, yt + 0.6, 0, QUAY, A( STYLE.plain ) );

		}

	}

	{

		const R = plan.airstrip, hl = R.length / 2, hw = R.width / 2, y = R.y + 0.05;
		const flatQ = ( x0, x1, z0, z1, yy, col, code ) => acc.quad( [ x0, yy, z0 ], [ x0, yy, z1 ], [ x1, yy, z1 ], [ x1, yy, z0 ], [ 0, 1, 0 ], [ [ x0, z0 ], [ x0, z1 ], [ x1, z1 ], [ x1, z0 ] ], col, A( code ) );
		for ( let k = 0; k < 8; k ++ ) flatQ( R.x - hl + k * R.length / 8, R.x - hl + ( k + 1 ) * R.length / 8, R.z - hw, R.z + hw, y, RUNWAY, STYLE.asphalt );
		for ( let s = - hl + 40; s < hl - 40; s += 30 ) flatQ( R.x + s, R.x + s + 15, R.z - 0.45, R.z + 0.45, y + 0.015, WHITE, STYLE.paint );
		for ( const e of [ - 1, 1 ] ) {

			for ( let o = - hw + 3; o < hw - 2; o += 3.4 ) flatQ( R.x + e * ( hl - 4 ) - 15, R.x + e * ( hl - 4 ) + 15, R.z + o, R.z + o + 1.8, y + 0.015, WHITE, STYLE.paint ); // (the piano keys)
			flatQ( R.x - hl + 2, R.x + hl - 2, R.z + e * ( hw - 1 ) - 0.3, R.z + e * ( hw - 1 ) + 0.3, y + 0.015, WHITE, STYLE.paint );

		}

		out.runwayLights = [];
		for ( let s = - hl; s <= hl; s += 40 ) for ( const e of [ - 1, 1 ] ) out.runwayLights.push( { x: R.x + s, z: R.z + e * ( hw + 1.5 ), y: R.y } );

	}

	out.stats.triangles = acc.idx.length / 3;
	return out;

}
