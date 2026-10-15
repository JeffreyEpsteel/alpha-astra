import { Noise2D, smoothstep, clamp, lerp } from '../../util/Noise.js';
import { attachTidemark } from './town/TidemarkTerrain.js';
import {
	MERIDIAN, cityPlan, coastDistanceRel, coastKindRel, groundRel, hillRoadAt, polyDist, footprint, DOCKS_DECK, LAYOUT, RIVER_REL,
} from './meridian/CityPlan.js';

// Meridian's own terrain tile (wave 21A): the city island west of home, beyond the heightmap's west edge, on a 4 m height
// grid over the plan's 1840 m box (meridian/CityPlan.js MERIDIAN.tile). Everything is derived from the plan's designed
// shape: the coast (seawalls along the docks, the basin, the moles and the airport's reclaimed land; beaches on the south
// shore; rock and low cliffs under the hills), the ground (the city plain rising gently west from the docks, level docks
// and apron, the hills at the west end), the hill road graded to its profile, the villas' pads, the river's channel. The
// relief noise only touches ground where nothing is built (the hills, the dunes); the city plain is exactly the plan's
// groundAt, so the roads lie on the terrain and roadHeight( x, z ) is heightAt( x, z ) (the hill road: its profile).
//
//   const tile = new MeridianTerrain();   ~0.2 s; tile.timings
//   tile.contains / heightAt / normalAt / coastDistance -> { d, beachZone } / pathDistance / maskAt -> { rock, sand, path,
//   river, forest, paved } / local( x, z ) -> [ u, v ] (island-relative) / world( u, v ) / riverBed( t ) / graded( x, z )
//   tile.roadHeight( x, z )               the road surface (the hill road's graded profile there, else the ground)
//   ensureMeridian( terrainData )         attaches the shared tile (TidemarkTerrain.attachTidemark); idempotent
//
// Beyond the box (faded over its outer 120 m) the sea floor is the open ocean's -90 m.

const T = MERIDIAN.tile;
export const TEXEL = T.texel;
const N = T.n;
const OCEAN = - 90;
const FADE = 120;
const CX = MERIDIAN.center.x, CZ = MERIDIAN.center.z;
const HILL_HALF = 3.75;
const RIVER_DEPTH = 1.6; // the channel under its banks
const smin = ( a, b, k ) => {

	const h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0, 1 );
	return lerp( b, a, h ) - k * h * ( 1 - h );

};

function now() {

	return typeof performance !== 'undefined' ? performance.now() : Date.now();

}

// the beach zone (0..1): the south shore facing the open ocean
export function beachZoneRel( u, v ) {

	return smoothstep( 230, 300, v ) * smoothstep( - 680, - 600, u ) * ( 1 - smoothstep( 410, 450, u ) );

}

// the seabed (m, negative) at coast distance d (> 0) for the coast kinds' weights
function seabed( d, wall, beach ) {

	const rock = d < 30 ? d * 0.16 : 4.8 + ( d - 30 ) * 0.07;
	const sand = d < 80 ? d * 0.035 : 2.8 + ( d - 80 ) * 0.06;
	const quay = 7.5 + d * 0.02;
	const depth = lerp( lerp( rock, sand, beach ), quay, wall );
	return - Math.min( depth, 80 );

}

export class MeridianTerrain {

	constructor( { seed = 21 } = {} ) {

		const t0 = now();
		this.id = MERIDIAN.id;
		this.x0 = T.x0; this.z0 = T.z0;
		this.x1 = T.x0 + T.size; this.z1 = T.z0 + T.size;
		this.texel = TEXEL;
		this.n = N;
		this.noise = new Noise2D( seed );
		this.noise2 = new Noise2D( seed * 31 + 5 );
		const NN = N * N;
		this.heights = new Float32Array( NN );
		this.rock = new Uint8Array( NN );
		this.sand = new Uint8Array( NN );
		this.path = new Uint8Array( NN );
		this.river = new Uint8Array( NN );
		this.forest = new Uint8Array( NN );
		this.paved = new Uint8Array( NN ); // the city's hard ground (blocks, docks, apron): grey in the mesh, no plants
		this.plan = cityPlan();
		this.rockSites = [];
		this.timings = {};
		this._river();
		this._generate();
		this.timings.total = Math.round( now() - t0 );

	}

	local( x, z ) {

		return [ x - CX, z - CZ ];

	}

	world( u, v ) {

		return [ CX + u, CZ + v ];

	}

	contains( x, z ) {

		return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1;

	}

	// the river: bed stations every 2 m, from 1.2 m under the ground at the spring down to -1.2 m at the mouth (riverBed( t ))
	_river() {

		const pts = RIVER_REL.pts;
		let L = 0;
		for ( let k = 1; k < pts.length; k ++ ) L += Math.hypot( pts[ k ][ 0 ] - pts[ k - 1 ][ 0 ], pts[ k ][ 1 ] - pts[ k - 1 ][ 1 ] );
		this.riverLength = L;
		const n = Math.ceil( L / 2 ) + 1, bed = new Float32Array( n );
		let k = 1, acc = 0;
		for ( let s = 0; s < n; s ++ ) {

			const at = Math.min( L, s * 2 );
			while ( k < pts.length - 1 && acc + Math.hypot( pts[ k ][ 0 ] - pts[ k - 1 ][ 0 ], pts[ k ][ 1 ] - pts[ k - 1 ][ 1 ] ) < at ) {

				acc += Math.hypot( pts[ k ][ 0 ] - pts[ k - 1 ][ 0 ], pts[ k ][ 1 ] - pts[ k - 1 ][ 1 ] );
				k ++;

			}

			const [ au, av ] = pts[ k - 1 ], [ bu, bv ] = pts[ k ];
			const l = Math.hypot( bu - au, bv - av ), f = clamp( ( at - acc ) / l, 0, 1 );
			const u = au + ( bu - au ) * f, v = av + ( bv - av ) * f;
			const g = coastDistanceRel( u, v ) < 0 ? this._land( u, v, false ) : - 1.2;
			bed[ s ] = Math.min( g - RIVER_DEPTH, s > 0 ? bed[ s - 1 ] - 0.01 : g - 1.2 );

		}

		this.riverBeds = bed;
		const us = pts.map( ( p ) => p[ 0 ] ), vs = pts.map( ( p ) => p[ 1 ] );
		this._riverBox = [ Math.min( ...us ) - 30, Math.max( ...us ) + 30, Math.min( ...vs ) - 30, Math.max( ...vs ) + 30 ];

	}

	riverBed( t ) {

		const B = this.riverBeds, f = clamp( t, 0, 1 ) * ( B.length - 1 ), i = Math.min( B.length - 2, Math.floor( f ) );
		return lerp( B[ i ], B[ i + 1 ], f - i );

	}

	// the land's height at island-relative ( u, v ) before the roads, pads and the river (noise: the relief on unbuilt ground)
	_land( u, v, noise = true ) {

		const d = coastDistanceRel( u, v ), e = - d;
		const g = groundRel( u, v );
		const kind = coastKindRel( u, v );
		const bz = beachZoneRel( u, v );
		let h;
		// the city plain (to the promenade's far sidewalk) is exactly the plan's ground: the roads lie on it
		if ( kind === 'seawall' || ( u > - 455 && v < 422 && e > 20 ) ) h = g;
		else {

			const beach = e < 50 ? e * 0.045 : 2.25 + ( e - 50 ) * 0.07;
			const cliff = e * 0.85;
			h = smin( g, lerp( cliff, beach, bz ), 2.5 );

		}

		if ( noise ) {

			// relief only west of the city (the hills) and on the dunes behind the beaches
			const wild = smoothstep( - 452, - 500, u );
			const dunes = bz * smoothstep( 432, 446, v ) * ( 1 - smoothstep( 10, 60, e ) * 0 ) * smoothstep( 6, 30, e );
			const n = this.noise, n2 = this.noise2;
			h += wild * ( n.fbm( u / 70, v / 70, 4 ) * 3.2 + n2.ridged( u / 28, v / 28, 3 ) * 1.4 * smoothstep( 12, 40, h ) );
			h += dunes * Math.max( 0, n.fbm( u / 18 + 3.3, v / 18, 3 ) ) * 1.4;

		}

		return h;

	}

	_generate() {

		const NN = N * N, H = this.heights;
		const n = this.noise, n2 = this.noise2;
		let t = now();
		const tick = ( name ) => { const q = now(); this.timings[ name ] = Math.round( q - t ); t = q; };
		const D = new Float32Array( NN );
		// the villas' pads [ u0, u1, v0, v1, y ] (the footprint + 4 m)
		const pads = this.plan.buildings.filter( ( b ) => b.block === 'hills' ).map( ( b ) => {

			const f = footprint( b );
			return [ f.x0 - CX - 4, f.x1 - CX + 4, f.z0 - CZ - 4, f.z1 - CZ + 4, b.y ];

		} );
		this.pads = pads;
		const RB = this._riverBox;
		const rpts = RIVER_REL.pts;
		for ( let j = 0; j < N; j ++ ) {

			const v = this.z0 + j * TEXEL - CZ;
			for ( let i = 0; i < N; i ++ ) {

				const u = this.x0 + i * TEXEL - CX, k = j * N + i;
				const d = coastDistanceRel( u, v );
				D[ k ] = d;
				let h;
				if ( d >= 0 ) {

					const kind = coastKindRel( u, v );
					h = seabed( d, kind === 'seawall' ? 1 : 0, beachZoneRel( u, v ) );
					// the harbour basin: a level dredged floor
					const B = LAYOUT.BASIN;
					if ( u > B.x0 && u < 700 && v > B.z0 && v < B.z1 ) h = Math.min( h, - 8 );
					h += n.fbm( u / 60, v / 60, 3 ) * 0.5 * smoothstep( 6, 40, d );
					// a short bank from the waterline into the sea where the coast is natural (no 2 m step)
					if ( kind !== 'seawall' && d < 3 ) h = lerp( 0, h, d / 3 );

				} else {

					h = this._land( u, v );
					// the hill road: cut / filled to its profile across the carriageway, easing out over ~12 m
					if ( u < - 425 && u > - 700 && v > - 320 && v < 140 ) {

						const R = hillRoadAt( u, v );
						if ( R.d < HILL_HALF + 14 ) {

							const w = 1 - smoothstep( HILL_HALF + 1.5, HILL_HALF + 14, R.d );
							h = lerp( h, R.h, w );
							if ( R.d < HILL_HALF + 1.5 ) this.path[ k ] = 255;

						}

					}

					// the villas' level pads
					for ( const P of pads ) {

						const dd = Math.hypot( Math.max( P[ 0 ] - u, 0, u - P[ 1 ] ), Math.max( P[ 2 ] - v, 0, v - P[ 3 ] ) );
						if ( dd < 10 ) h = lerp( h, P[ 4 ], 1 - smoothstep( 0, 10, dd ) );

					}

					// the river's channel (and its banks easing over 8 m)
					if ( u > RB[ 0 ] && u < RB[ 1 ] && v > RB[ 2 ] && v < RB[ 3 ] ) {

						const dr = polyDist( rpts, u, v );
						const half = RIVER_REL.width / 2;
						if ( dr < half + 8 ) {

							const bed = this.riverBed( this._riverT( u, v ) );
							const w = 1 - smoothstep( half * 0.6, half + 8, dr );
							h = lerp( h, Math.min( h, bed ), w );
							this.river[ k ] = Math.round( ( 1 - smoothstep( half * 0.6, half + 2, dr ) ) * 255 );

						}

					}

				}

				H[ k ] = h;

			}

		}

		tick( 'heights' );

		// masks and the rim fade (the park and the outer blocks' yards are grass, not paving: grass grows there)
		const city = ( u, v ) => u > - 452 && v > - 680 && v < 440; // the plain, the docks and the airport
		const greens = [];
		for ( const bl of this.plan.blocks ) {

			const u0 = bl.x - CX - bl.w / 2, u1 = bl.x - CX + bl.w / 2, v0 = bl.z - CZ - bl.d / 2, v1 = bl.z - CZ + bl.d / 2;
			if ( bl.zone === 'park' ) greens.push( [ u0 + 1, u1 - 1, v0 + 1, v1 - 1 ] );
			else if ( bl.zone === 'outer' ) greens.push( [ u0 + 8, u1 - 8, v0 + 28, v1 - 28 ] );

		}

		const green = ( u, v ) => greens.some( ( g ) => u > g[ 0 ] && u < g[ 1 ] && v > g[ 2 ] && v < g[ 3 ] );
		this.greens = greens;
		for ( let j = 0; j < N; j ++ ) for ( let i = 0; i < N; i ++ ) {

			const k = j * N + i, h = H[ k ], d = D[ k ];
			const u = this.x0 + i * TEXEL - CX, v = this.z0 + j * TEXEL - CZ;
			let slope = 0;
			if ( i > 0 && j > 0 && i < N - 1 && j < N - 1 ) {

				const gx = H[ k + 1 ] - H[ k - 1 ], gz = H[ k + N ] - H[ k - N ];
				slope = Math.sqrt( gx * gx + gz * gz ) / ( 2 * TEXEL );

			}

			const bz = beachZoneRel( u, v );
			const kind = d < 60 && d > - 60 ? coastKindRel( u, v ) : '';
			let rk = smoothstep( 0.55, 1.0, slope );
			if ( kind === 'rock' ) rk = Math.max( rk, ( 1 - smoothstep( 2, 14 + n2.noise( u / 23, v / 23 ) * 8, - d ) ) * ( 1 - bz ) );
			let sd = 0;
			if ( d >= 0 ) sd = kind === 'seawall' ? 0.2 : 1;
			else sd = bz * ( 1 - smoothstep( 40, 70, - d ) ) * ( 1 - smoothstep( 0.25, 0.5, slope ) );
			const paved = city( u, v ) && d < - 1 && ! ( bz > 0.5 && v > 425 ) && ! green( u, v ) ? 1 : 0;
			// the park and the block courtyards stay grass (the mesh paints them from the plan); the hills' woods
			const f = smoothstep( 8, 26, h ) * ( 1 - rk ) * ( 1 - this.path[ k ] / 255 ) * ( 1 - paved ) * smoothstep( 0.0, 0.3, n.fbm( u / 80 + 9.2, v / 80, 3 ) + 0.2 );
			this.rock[ k ] = Math.round( clamp( rk, 0, 1 ) * 255 );
			this.sand[ k ] = Math.round( clamp( sd, 0, 1 ) * 255 );
			this.paved[ k ] = paved * 255;
			this.forest[ k ] = Math.round( clamp( f, 0, 1 ) * 255 );
			const edge = Math.min( i, j, N - 1 - i, N - 1 - j ) * TEXEL;
			if ( edge < FADE ) H[ k ] = lerp( OCEAN, h, smoothstep( 0, FADE, edge ) );

		}

		tick( 'masks' );

	}

	_riverT( u, v ) {

		const pts = RIVER_REL.pts;
		let best = Infinity, bs = 0, acc = 0;
		for ( let k = 1; k < pts.length; k ++ ) {

			const [ au, av ] = pts[ k - 1 ], [ bu, bv ] = pts[ k ];
			const du = bu - au, dv = bv - av, L2 = du * du + dv * dv, L = Math.sqrt( L2 );
			const t = clamp( ( ( u - au ) * du + ( v - av ) * dv ) / L2, 0, 1 );
			const d = Math.hypot( u - au - du * t, v - av - dv * t );
			if ( d < best ) { best = d; bs = acc + L * t; }
			acc += L;

		}

		return bs / this.riverLength;

	}

	// ------------------------------------------------------------------ queries

	heightAt( x, z ) {

		const fx = ( x - this.x0 ) / TEXEL, fz = ( z - this.z0 ) / TEXEL;
		if ( ! ( fx >= 0 && fz >= 0 && fx < N - 1 && fz < N - 1 ) ) return OCEAN;
		const i = Math.floor( fx ), j = Math.floor( fz ), tx = fx - i, tz = fz - j, k = j * N + i, H = this.heights;
		return ( H[ k ] * ( 1 - tx ) + H[ k + 1 ] * tx ) * ( 1 - tz ) + ( H[ k + N ] * ( 1 - tx ) + H[ k + N + 1 ] * tx ) * tz;

	}

	// the road surface: on the hill road its graded profile (exact, not the 4 m grid's), else the ground
	roadHeight( x, z ) {

		const u = x - CX, v = z - CZ;
		if ( u < - 425 && u > - 700 && v > - 320 && v < 140 ) {

			const R = hillRoadAt( u, v );
			if ( R.d < HILL_HALF + 0.5 ) return R.h;

		}

		return this.heightAt( x, z );

	}

	normalAt( x, z, out ) {

		const e = TEXEL;
		const hx = this.heightAt( x + e, z ) - this.heightAt( x - e, z ), hz = this.heightAt( x, z + e ) - this.heightAt( x, z - e );
		const l = Math.hypot( hx, 2 * e, hz );
		if ( out && out.set ) return out.set( - hx / l, 2 * e / l, - hz / l );
		return { x: - hx / l, y: 2 * e / l, z: - hz / l };

	}

	coastDistance( x, z ) {

		const u = x - CX, v = z - CZ;
		return { d: coastDistanceRel( u, v ), beachZone: beachZoneRel( u, v ) };

	}

	// distance to worn / built ground (negative inside): the hill road and the city's paved ground count (plants keep off)
	pathDistance( x, z ) {

		const u = x - CX, v = z - CZ;
		let best = Infinity;
		if ( u > - 452 ) best = Math.min( best, - 1 );
		else best = Math.min( best, u + 452 );
		if ( u < - 425 && u > - 700 && v > - 320 && v < 140 ) best = Math.min( best, hillRoadAt( u, v ).d - HILL_HALF );
		return best;

	}

	// the graded surfaces (no surf, no plants): 1 on the runway, 2 on the docks / apron / city plain, 0 elsewhere
	graded( x, z ) {

		const u = x - CX, v = z - CZ, A = LAYOUT.AIRPORT, R = LAYOUT.RUNWAY;
		if ( Math.abs( u - R.x ) < R.length / 2 && Math.abs( v - R.z ) < R.width / 2 ) return 1;
		if ( u > A.x0 && u < A.x1 && v > A.z0 && v < A.z1 ) return 2;
		if ( u > 400 && coastKindRel( u, v ) === 'seawall' ) return 2;
		return 0;

	}

	maskAt( x, z ) {

		const i = Math.round( ( x - this.x0 ) / TEXEL ), j = Math.round( ( z - this.z0 ) / TEXEL );
		if ( i < 0 || j < 0 || i >= N || j >= N ) return { rock: 0, sand: 1, path: 0, river: 0, forest: 0, paved: 0 };
		const k = j * N + i;
		// (paved ground reads as path to the plants: no grass on the streets and the blocks)
		return { rock: this.rock[ k ] / 255, sand: this.sand[ k ] / 255, path: Math.max( this.path[ k ], this.paved[ k ] ) / 255, river: this.river[ k ] / 255, forest: this.forest[ k ] / 255, paved: this.paved[ k ] / 255 };

	}

}

export { DOCKS_DECK };

// The island's tile for this terrain: the one attached, else the shared tile (built once per page) attached now through
// TidemarkTerrain's generic attach. TerrainData's constructor calls it after ensureBlackwater (root patch); the Meridian
// builder calls it too (idempotent), so the queries work in any order.
let shared = null;
export function ensureMeridian( terrain ) {

	const had = terrain && ( terrain._outerTiles || [] ).find( ( q ) => q.id === MERIDIAN.id );
	if ( had ) return had;
	shared = shared || new MeridianTerrain();
	return attachTidemark( terrain, shared );

}
