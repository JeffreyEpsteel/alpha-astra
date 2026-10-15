import { Noise2D, smoothstep, clamp, lerp } from '../../../util/Noise.js';
import { TIDEMARK as I, TIDEMARK_PATHS, polylineDistance } from '../../terrain/IslandShape.js';

// Tidemark's own terrain tile (the island lies beyond the 2048 m heightmap, see terrain/IslandShape.js TIDEMARK):
// a 2 m height grid over a 1320 m box round the island, built with the same recipe as the heightmap's islands (a
// signed coast distance from the outline, the shared beach / seabed profile, gaussian hills, sea cliffs on the rocky
// shores) plus a carved river valley, the level quay / town terrace, the graded airstrip and the worn roads. Plain
// math, no engine: the tests and the game read the same heights.
//
//   const tile = new TidemarkTerrain();         ~0.3 s; tile.timings
//   tile.contains( x, z )   tile.heightAt( x, z )   tile.normalAt( x, z, out )   tile.coastDistance( x, z ) -> { d, beachZone }
//   tile.pathDistance( x, z )   tile.maskAt( x, z ) -> { rock, sand, path, river, forest }   tile.local( x, z ) -> [ u, v ]
//   tile.riverBed( t )          bed height at arc fraction t (0 spring .. 1 mouth)
//   attachTidemark( terrainData, tile )         TerrainData's heightAt / coastDistance / islandAt / pathDistance answer
//                                               from the tile inside its box (it lies wholly outside the 2048 m domain,
//                                               so nothing inside the domain changes); idempotent
//
// Beyond the box (and at its rim, faded over the outer 120 m) the sea floor is the heightmap's open-ocean -90 m.

export const TEXEL = 2;
export const HALF = 660;
const N = HALF * 2 / TEXEL + 1;
const OCEAN = - 90;
const NO_HIT = [ Infinity, 0 ];

const softRamp = ( x, k ) => ( x <= - k ? 0 : x >= k ? x : ( x + k ) * ( x + k ) / ( 4 * k ) );
const smin = ( a, b, k ) => {

	const h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0, 1 );
	return lerp( b, a, h ) - k * h * ( 1 - h );

};
const smax = ( a, b, k ) => - smin( - a, - b, k );

// distance to a rectangle in island coordinates (0 inside)
export const rectOut = ( u, v, u0, u1, v0, v1 ) => Math.hypot( Math.max( u0 - u, 0, u - u1 ), Math.max( v0 - v, 0, v - v1 ) );

// the airstrip's graded rectangles [ u0, u1, v0, v1 ]: the runway with 6 m shoulders, the taxiway and the parking pad
export function airstripRects( A = I.airstrip ) {

	const hl = A.length / 2 + 6, hw = A.width / 2 + 6;
	const [ pu, pv, phu, phv ] = A.pad;
	return [
		[ A.u - hl, A.u + hl, A.v - hw, A.v + hw ],
		[ ( A.taxiU ?? pu ) - A.taxi / 2, ( A.taxiU ?? pu ) + A.taxi / 2, A.v, pv ],
		[ pu - phu, pu + phu, pv - phv, pv + phv ],
	];

}

function now() {

	return typeof performance !== 'undefined' ? performance.now() : Date.now();

}

export class TidemarkTerrain {

	constructor( { seed = 41 } = {} ) {

		const t0 = now();
		this.id = I.id;
		this.x0 = I.x - HALF; this.z0 = I.z - HALF;
		this.x1 = I.x + HALF; this.z1 = I.z + HALF;
		this.texel = TEXEL;
		this.n = N;
		this.noise = new Noise2D( seed );
		this.noise2 = new Noise2D( seed * 31 + 5 );
		this.heights = new Float32Array( N * N );
		this.rock = new Uint8Array( N * N );
		this.sand = new Uint8Array( N * N );
		this.path = new Uint8Array( N * N );
		this.river = new Uint8Array( N * N );
		this.forest = new Uint8Array( N * N );
		this.paths = TIDEMARK_PATHS;
		this.timings = {};
		this._river();
		this._generate();
		this.timings.total = Math.round( now() - t0 );

	}

	local( x, z ) {

		const dx = x - I.x, dz = z - I.z;
		return [ dx * I.ax + dz * I.az, - dx * I.az + dz * I.ax ];

	}

	world( u, v ) {

		return [ I.x + u * I.ax - v * I.az, I.z + u * I.az + v * I.ax ];

	}

	contains( x, z ) {

		return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1;

	}

	// ------------------------------------------------------------------ the shape

	// signed coast distance (> 0 water) and the bay beach zone at island coordinates (u, v), world (x, z)
	_coast( u, v, x, z, out ) {

		let d = ( Math.sqrt( ( u / I.ru ) ** 2 + ( v / I.rv ) ** 2 ) - 1 ) * I.ru;
		for ( const [ lu, lv, lru, lrv ] of I.lobes ) {

			const dl = ( Math.sqrt( ( ( u - lu ) / lru ) ** 2 + ( ( v - lv ) / lrv ) ** 2 ) - 1 ) * Math.min( lru, lrv );
			d = smin( d, dl, 40 );

		}

		const [ bu, bv, br ] = I.bay;
		const bd = Math.hypot( u - bu, v - bv );
		d = smax( d, br - bd, 25 );
		// the bay's beach: the inner shore of the bay, from ~80 m out to ~70 m inland
		const bz = ( 1 - smoothstep( br + 30, br + 110, bd ) ) * ( 1 - smoothstep( 60, 110, d ) ) * smoothstep( - 90, - 50, d );
		if ( d < 220 ) {

			const O = I.outline, n = this.noise;
			const w = 1 - smoothstep( 140, 220, d );
			d += ( n.fbm( x / O[ 0 ] + O[ 4 ], z / O[ 0 ] + O[ 5 ], 3 ) * O[ 1 ] * ( 1 - 0.92 * bz ) + n.fbm( x / O[ 2 ] + O[ 6 ], z / O[ 2 ] + O[ 7 ], 2 ) * O[ 3 ] * ( 1 - bz ) ) * w;

		}

		out.d = d; out.bz = bz;
		return out;

	}

	_rockAt( u, v, x, z ) {

		let r = 0;
		for ( const [ ru, rv, R ] of I.rocky ) r = Math.max( r, 1 - smoothstep( R * 0.55, R, Math.hypot( u - ru, v - rv ) ) );
		return r > 0 ? r * clamp( 0.6 + 0.5 * this.noise2.fbm( x / 60, z / 60, 3 ), 0, 1 ) : 0;

	}

	// the natural ground (before the river, the pads, the strip and the roads)
	_natural( u, v, x, z, C ) {

		const n = this.noise, n2 = this.noise2;
		this._coast( u, v, x, z, C );
		const d = C.d, bz = C.bz;
		const rock = this._rockAt( u, v, x, z );
		C.rock = rock;
		if ( d >= 0 ) {

			let depth;
			if ( d < 70 ) depth = d * 0.05;
			else if ( d < 260 ) depth = 3.5 + ( d - 70 ) * 0.06;
			else depth = 14.9 + ( d - 260 ) * 0.09;
			depth = Math.min( depth, 85 ) * lerp( 1, 1.8, rock * ( 1 - smoothstep( 120, 300, d ) ) );
			// sand ripples near the shore only (faded out by 220 m, where the plain profile takes over)
			let h = - depth + ( d < 220 ? n.fbm( x / 45, z / 45, 3 ) * 0.5 * smoothstep( 8, 40, d ) * ( 1 - smoothstep( 170, 220, d ) ) : 0 );
			if ( rock > 0 && d < 200 ) h += rock * n2.ridged( x / 25, z / 25, 3 ) * 4 * smoothstep( 0, 20, d ) * ( 1 - smoothstep( 90, 200, d ) );
			// the berth off the pier head
			const [ pu, pv, su, sv, pd ] = I.pocket;
			h -= pd * Math.exp( - ( ( ( u - pu ) / su ) ** 2 ) - ( ( v - pv ) / sv ) ** 2 ) * smoothstep( 4, 12, d );
			C.h = h;
			return C;

		}

		const e = - d;
		let h;
		if ( e < 38 ) h = e * 0.068;
		else if ( e < 70 ) h = 2.584 + ( e - 38 ) * 0.03;
		else if ( e < 230 ) h = 3.544 + ( e - 70 ) * 0.075;
		else h = 15.544 + ( e - 230 ) * 0.04;
		if ( e > 25 && e < 240 ) h += smoothstep( 25, 60, e ) * ( 1 - smoothstep( 120, 240, e ) ) * n2.fbm( x / 30, z / 30, 3 ) * 0.9 * ( 0.4 + 0.6 * bz );
		let hill = 0;
		for ( const [ hu, hv, su, sv, H ] of I.hills ) hill += H * Math.exp( - ( ( ( u - hu ) / su ) ** 2 ) - ( ( v - hv ) / sv ) ** 2 );
		hill *= 1 + 0.3 * n.fbm( x / 55 + 1.7, z / 55, 3 );
		hill += 3 * n2.ridged( x / 32, z / 32, 3 ) * ( 1 - bz ) * smoothstep( 20, 90, e );
		h += hill * smoothstep( 10, 50, e );
		// sea cliffs on the rocky shores
		const cliffZone = rock * ( 1 - smoothstep( 60, 150, e ) );
		if ( cliffZone > 0 ) {

			const cliff = Math.min( e * 1.6, 16 + n2.ridged( x / 70, z / 70, 4 ) * 20 ) + n2.fbm( x / 12, z / 12, 3 ) * 2.5;
			h = lerp( h, Math.max( h, cliff ), cliffZone );

		}

		C.h = h;
		return C;

	}

	// the river: stations every 2 m along the course with the bed under the natural ground (bed[ 0 ] down at the
	// spring), never rising downstream, easing into the mouth's bed (bed[ 1 ], below the sea) over the last 60 m
	_river() {

		const R = I.river, C = {};
		const pts = R.pts;
		this.riverLength = 0;
		for ( let k = 0; k < pts.length - 1; k ++ ) this.riverLength += Math.hypot( pts[ k + 1 ][ 0 ] - pts[ k ][ 0 ], pts[ k + 1 ][ 1 ] - pts[ k ][ 1 ] );
		const n = Math.ceil( this.riverLength / 2 ) + 1;
		const bed = new Float32Array( n );
		let seg = 0, acc = 0, prev = Infinity;
		for ( let s = 0; s < n; s ++ ) {

			const at = Math.min( this.riverLength, s * 2 );
			while ( seg < pts.length - 2 && acc + Math.hypot( pts[ seg + 1 ][ 0 ] - pts[ seg ][ 0 ], pts[ seg + 1 ][ 1 ] - pts[ seg ][ 1 ] ) < at ) {

				acc += Math.hypot( pts[ seg + 1 ][ 0 ] - pts[ seg ][ 0 ], pts[ seg + 1 ][ 1 ] - pts[ seg ][ 1 ] );
				seg ++;

			}

			const a = pts[ seg ], b = pts[ seg + 1 ], L = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
			const f = Math.min( 1, ( at - acc ) / L );
			const u = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * f, v = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * f;
			const [ x, z ] = this.world( u, v );
			const g = this._natural( u, v, x, z, C ).h;
			prev = Math.min( prev, g - R.bed[ 0 ] );
			const toMouth = this.riverLength - at;
			bed[ s ] = lerp( R.bed[ 1 ], prev, smoothstep( 0, 60, toMouth ) );
			if ( bed[ s ] > prev ) bed[ s ] = prev;

		}

		this.riverBeds = bed;
		this.riverSource = bed[ 0 ];
		// island-space bounds of the valley (the per-texel distance work only runs inside)
		const us = pts.map( ( p ) => p[ 0 ] ), vs = pts.map( ( p ) => p[ 1 ] );
		this._riverBox = [ Math.min( ...us ) - 60, Math.max( ...us ) + 60, Math.min( ...vs ) - 60, Math.max( ...vs ) + 60 ];

	}

	// bed height at arc fraction t (0 spring .. 1 mouth)
	riverBed( t ) {

		const B = this.riverBeds, f = clamp( t, 0, 1 ) * ( B.length - 1 ), i = Math.min( B.length - 2, Math.floor( f ) );
		return lerp( B[ i ], B[ i + 1 ], f - i );

	}

	_generate() {

		const C = { d: 0, bz: 0, rock: 0, h: 0 };
		const H = this.heights, R = I.river, n2 = this.noise2;
		const pads = I.pads, A = I.airstrip, strip = airstripRects( A );
		const SB = [ Math.min( ...strip.map( ( r ) => r[ 0 ] ) ) - A.falloff, Math.max( ...strip.map( ( r ) => r[ 1 ] ) ) + A.falloff,
			Math.min( ...strip.map( ( r ) => r[ 2 ] ) ) - A.falloff, Math.max( ...strip.map( ( r ) => r[ 3 ] ) ) + A.falloff ];
		this._pathBoxes = TIDEMARK_PATHS.map( ( p ) => {

			const us = p.pts.map( ( q ) => q[ 0 ] ), vs = p.pts.map( ( q ) => q[ 1 ] ), m = p.w * 2.5 + 1;
			return { ...p, b: [ Math.min( ...us ) - m, Math.max( ...us ) + m, Math.min( ...vs ) - m, Math.max( ...vs ) + m ] };

		} );
		const tGen = now();
		for ( let j = 0; j < N; j ++ ) {

			const z = this.z0 + j * TEXEL;
			for ( let i = 0; i < N; i ++ ) {

				const x = this.x0 + i * TEXEL;
				const k = j * N + i;
				const dx = x - I.x, dz = z - I.z, u = dx * I.ax + dz * I.az, v = - dx * I.az + dz * I.ax;
				const edge = Math.min( x - this.x0, this.x1 - x, z - this.z0, this.z1 - z );
				// open sea far from the island: the plain floor
				const raw = ( Math.sqrt( ( u / I.ru ) ** 2 + ( v / I.rv ) ** 2 ) - 1 ) * I.ru;
				if ( raw > 360 ) {

					H[ k ] = OCEAN;
					this.sand[ k ] = 255;
					continue;

				}

				this._natural( u, v, x, z, C );
				let h = C.h;
				let rock = C.rock * ( C.d < 0 ? 1 - smoothstep( 6, 140, - C.d ) * 0.6 : 1 - smoothstep( 40, 200, C.d ) );
				let sand = C.d >= 0 ? 1 : Math.max( C.bz * ( 1 - smoothstep( 40, 60, - C.d ) ), 1 - smoothstep( 6, 18, - C.d ) ) * ( 1 - rock );

				// the river valley: the bed falls from the spring to the bay; the banks ease out over ~30 m
				const RB = this._riverBox;
				const [ rd, arc ] = u > RB[ 0 ] && u < RB[ 1 ] && v > RB[ 2 ] && v < RB[ 3 ] ? polylineDistance( R.pts, u, v ) : NO_HIT;
				let riv = 0;
				if ( rd < 60 ) {

					const bed = this.riverBed( arc / this.riverLength );
					const w = R.width * ( 1 + 1.4 * smoothstep( 0.7, 1, arc / this.riverLength ) );
					const hv = bed + Math.max( 0, rd - w ) * 0.25 + Math.max( 0, rd - w * 3 ) * 0.45;
					const before = h;
					h -= softRamp( h - hv, 1.2 );
					riv = ( 1 - smoothstep( w * 0.8, w * 1.3, rd ) ) * ( before > bed ? 1 : 0 );
					if ( before - h > 0.3 ) rock *= 0.5;

				}

				// level pads (the quay / town terrace, the boatyard slip, the lookout top)
				for ( const [ u0, u1, v0, v1, ph, fall ] of pads ) {

					if ( u < u0 - fall || u > u1 + fall || v < v0 - fall || v > v1 + fall ) continue;
					const o = rectOut( u, v, u0, u1, v0, v1 );
					if ( o >= fall ) continue;
					const t = 1 - smoothstep( 0, fall, o );
					h = lerp( h, ph, t );
					rock *= 1 - t;
					sand *= 1 - t * 0.7;

				}

				// the airstrip: exactly level inside the runway, taxiway and pad rectangles, cut and fill shoulders round them
				let so = Infinity;
				if ( u > SB[ 0 ] && u < SB[ 1 ] && v > SB[ 2 ] && v < SB[ 3 ] ) for ( const r of strip ) so = Math.min( so, rectOut( u, v, r[ 0 ], r[ 1 ], r[ 2 ], r[ 3 ] ) );
				if ( so < A.falloff ) {

					const t = 1 - smoothstep( 0, A.falloff, so );
					h = lerp( h, A.height, t );
					rock *= 1 - t;
					sand *= 1 - t;

				}

				// roads and footpaths: worn in, a few centimetres down (none on the strip)
				let pm = 0;
				for ( const p of this._pathBoxes ) {

					if ( u < p.b[ 0 ] || u > p.b[ 1 ] || v < p.b[ 2 ] || v > p.b[ 3 ] ) continue;
					const [ dd ] = polylineDistance( p.pts, u, v );
					if ( dd > p.w * 2.5 ) continue;
					const w = p.w * ( 1 + 0.2 * n2.noise( x / 6, z / 6 ) );
					pm = Math.max( pm, 1 - smoothstep( w * 0.6, w * 1.6, dd ) );

				}

				if ( pm > 0 && so > 0.5 ) h -= 0.06 * pm * smoothstep( 0.8, 1.6, h );
				// the box rim fades to the open-ocean floor
				if ( edge < 120 ) h = lerp( OCEAN, h, smoothstep( 0, 120, edge ) );
				H[ k ] = h;
				this.rock[ k ] = Math.round( clamp( rock, 0, 1 ) * 255 );
				this.sand[ k ] = Math.round( clamp( sand, 0, 1 ) * 255 );
				this.path[ k ] = Math.round( pm * 255 );
				this.river[ k ] = Math.round( riv * 255 );
				// woodland on the hill flanks above the town (not on the strip, the pads or the rock)
				const f = so < A.falloff ? 0 : smoothstep( 14, 30, h ) * ( 1 - rock ) * smoothstep( 0.1, 0.35, this.noise.fbm( x / 70 + 9.2, z / 70, 3 ) + 0.25 );
				this.forest[ k ] = Math.round( clamp( f, 0, 1 ) * 255 );

			}

		}

		this.timings.grid = Math.round( now() - tGen );

	}

	// ------------------------------------------------------------------ queries

	heightAt( x, z ) {

		const fx = ( x - this.x0 ) / TEXEL, fz = ( z - this.z0 ) / TEXEL;
		if ( ! ( fx >= 0 && fz >= 0 && fx < N - 1 && fz < N - 1 ) ) return OCEAN;
		const i = Math.floor( fx ), j = Math.floor( fz ), tx = fx - i, tz = fz - j, k = j * N + i, H = this.heights;
		return ( H[ k ] * ( 1 - tx ) + H[ k + 1 ] * tx ) * ( 1 - tz ) + ( H[ k + N ] * ( 1 - tx ) + H[ k + N + 1 ] * tx ) * tz;

	}

	normalAt( x, z, out ) {

		const e = TEXEL;
		const hx = this.heightAt( x + e, z ) - this.heightAt( x - e, z ), hz = this.heightAt( x, z + e ) - this.heightAt( x, z - e );
		const l = Math.hypot( hx, 2 * e, hz );
		if ( out && out.set ) return out.set( - hx / l, 2 * e / l, - hz / l );
		return { x: - hx / l, y: 2 * e / l, z: - hz / l };

	}

	coastDistance( x, z ) {

		const [ u, v ] = this.local( x, z );
		const C = this._coast( u, v, x, z, {} );
		return { d: C.d, beachZone: C.bz };

	}

	pathDistance( x, z ) {

		const [ u, v ] = this.local( x, z );
		let best = Infinity;
		for ( const p of TIDEMARK_PATHS ) best = Math.min( best, polylineDistance( p.pts, u, v )[ 0 ] - p.w );
		return best;

	}

	// the graded surfaces at ( x, z ): 1 on the runway itself, 2 on the taxiway and the parking apron, 0 elsewhere
	graded( x, z ) {

		const [ u, v ] = this.local( x, z ), A = I.airstrip, R = airstripRects( A );
		if ( Math.abs( u - A.u ) <= A.length / 2 && Math.abs( v - A.v ) <= A.width / 2 ) return 1;
		for ( let k = 1; k < R.length; k ++ ) if ( rectOut( u, v, R[ k ][ 0 ], R[ k ][ 1 ], R[ k ][ 2 ], R[ k ][ 3 ] ) <= 0 ) return 2;
		return 0;

	}

	// the masks at the nearest texel (0..1)
	maskAt( x, z ) {

		const i = Math.round( ( x - this.x0 ) / TEXEL ), j = Math.round( ( z - this.z0 ) / TEXEL );
		if ( i < 0 || j < 0 || i >= N || j >= N ) return { rock: 0, sand: 1, path: 0, river: 0, forest: 0 };
		const k = j * N + i;
		return { rock: this.rock[ k ] / 255, sand: this.sand[ k ] / 255, path: this.path[ k ] / 255, river: this.river[ k ] / 255, forest: this.forest[ k ] / 255 };

	}

}

// The island's tile for this terrain: the one already attached, else the shared tile (built once per page) attached now.
// Whatever needs Tidemark's ground (the island builder, the destruction planner) calls this, so the island exists
// whenever anything asks, in whatever order the systems start.
let shared = null;
export function ensureTidemark( terrain ) {

	const had = terrain && terrain._outerTiles && terrain._outerTiles.find( ( q ) => q.id === I.id );
	if ( had ) return had;
	shared = shared || new TidemarkTerrain();
	return attachTidemark( terrain, shared );

}

// TerrainData answers from the tile inside its box. The box lies wholly outside the heightmap's domain, so every query
// inside the domain is untouched. When TerrainData grows a native addOuterTile( tile ) that is used instead of wrapping
// the instance's query methods (every holder of the TerrainData object sees the wrapped methods).
export function attachTidemark( terrain, tile ) {

	if ( ! terrain || ! tile ) return tile;
	if ( typeof terrain.addOuterTile === 'function' ) {

		terrain.addOuterTile( tile );
		return tile;

	}

	const tiles = terrain._outerTiles || ( terrain._outerTiles = [] );
	const had = tiles.find( ( q ) => q.id === tile.id );
	if ( had ) return had;
	tiles.push( tile );
	if ( terrain._outerWrapped ) return tile;
	terrain._outerWrapped = true;
	const half = ( terrain.size || 2048 ) / 2;
	const find = ( x, z ) => {

		if ( Math.abs( x ) < half && Math.abs( z ) < half ) return null;
		for ( const q of tiles ) if ( q.contains( x, z ) ) return q;
		return null;

	};
	const base = {
		heightAt: terrain.heightAt.bind( terrain ),
		coastDistance: terrain.coastDistance ? terrain.coastDistance.bind( terrain ) : null,
		islandAt: terrain.islandAt ? terrain.islandAt.bind( terrain ) : null,
		pathDistance: terrain.pathDistance ? terrain.pathDistance.bind( terrain ) : null,
	};
	terrain.heightAt = ( x, z ) => {

		const q = find( x, z );
		return q ? q.heightAt( x, z ) : base.heightAt( x, z );

	};
	if ( base.coastDistance ) terrain.coastDistance = ( x, z ) => {

		const q = find( x, z );
		return q ? q.coastDistance( x, z ) : base.coastDistance( x, z );

	};
	if ( base.islandAt ) terrain.islandAt = ( x, z ) => {

		const q = find( x, z );
		return q ? q.id : base.islandAt( x, z );

	};
	if ( base.pathDistance ) terrain.pathDistance = ( x, z ) => {

		const q = find( x, z );
		return q ? q.pathDistance( x, z ) : base.pathDistance( x, z );

	};
	return tile;

}
