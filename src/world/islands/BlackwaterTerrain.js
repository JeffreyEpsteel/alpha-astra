import { Noise2D, smoothstep, clamp, lerp } from '../../util/Noise.js';
import { BLACKWATER as I, BLACKWATER_PATHS, polylineDistance } from '../terrain/IslandShape.js';
import { attachTidemark } from './town/TidemarkTerrain.js';

// Blackwater's own terrain tile (wave 14D). The pirates' island sat at (-55, 688) inside the 2048 m heightmap, 480 m ahead
// of the seaplane's take-off run; it now lies at terrain/IslandShape.js BLACKWATER (-120, 1520), beyond the domain's south
// edge, on a 2 m height grid over a 960 m box like Tidemark's (TidemarkTerrain.js). The heights are the heightmap's islet
// recipe (TerrainData._islet / _base / _detail / _features, copied below: those are methods, not exports; keep them in
// step) evaluated for this one island, with every noise sampled where the island was tuned (SOURCE): the ring, the
// caldera cove, the channel, the cliffs, the crags, the stacks and the pads come out exactly as before relative to the
// centre, so the fort, the town, the docks, the batteries, the moored ships and the hidden entrance stand as they did.
// Left out: the home island's own terms (its coast, massif, reef, pier channel: all zero or far there), the 1 m seabed
// biomes (seagrass, rubble: a few cm) and the Catmull-Rom upsample (the tile is sampled at 2 m directly).
//
//   const tile = new BlackwaterTerrain();       ~0.5 s; tile.timings
//   tile.contains( x, z )   tile.heightAt( x, z )   tile.normalAt( x, z, out )   tile.coastDistance( x, z ) -> { d, beachZone }
//   tile.pathDistance( x, z )   (footpaths, plus the yards on the pads and the docks' feet: plants and props keep off)
//   tile.maskAt( x, z ) -> { rock, sand, path, river, forest }   tile.local( x, z ) -> [ u, v ]   tile.world( u, v )
//   tile.recipeAt( x, z ) -> { h, d, bz, rock }   the base recipe at a point (before the 2 m relief, stacks, paths, pads)
//   ensureBlackwater( terrainData )             attaches the shared tile through TidemarkTerrain.attachTidemark (generic:
//                                               the wrapped queries find the tile whose box holds the point); idempotent
//
// Beyond the box (and at its rim, faded over the outer 120 m) the sea floor is the open ocean's -90 m.

export const TEXEL = 2;
export const HALF = 480;
const N = HALF * 2 / TEXEL + 1;
const OCEAN = - 90;
const FADE = 120;
// where the heightmap built the island until wave 14D: the recipe's noise is read there
export const SOURCE = { x: - 55, z: 688 };
const DX = SOURCE.x - I.x, DZ = SOURCE.z - I.z;

// the docks out from the crescent (stronghold/Layout.js: the main dock, and one either side at +-26 deg on the crescent)
const crescent = ( a, s ) => [ - 105 * s * Math.cos( a ), 85 * s * Math.sin( a ) ];
const DOCKS = [ 0, - 26, 26 ].map( ( deg, i ) => {

	const a = deg * Math.PI / 180;
	const s = i === 0 ? [ I.dock.u0, I.dock.v ] : crescent( a, 1.07 ), e = i === 0 ? [ I.dock.u1, I.dock.v ] : crescent( a, 0.8 );
	return { pts: [ s, e ], w: ( i === 0 ? I.dock.width : 2.2 ) / 2 };

} );

function now() {

	return typeof performance !== 'undefined' ? performance.now() : Date.now();

}

export class BlackwaterTerrain {

	constructor( { seed = 7 } = {} ) {

		const t0 = now();
		this.id = I.id;
		this.x0 = I.x - HALF; this.z0 = I.z - HALF;
		this.x1 = I.x + HALF; this.z1 = I.z + HALF;
		this.texel = TEXEL;
		this.n = N;
		// TerrainData's three noises (its default seed 7)
		this.noise = new Noise2D( seed );
		this.noise2 = new Noise2D( seed * 31 + 5 );
		this.noise3 = new Noise2D( seed * 131 + 17 );
		this.heights = new Float32Array( N * N );
		this.rock = new Uint8Array( N * N );
		this.sand = new Uint8Array( N * N );
		this.path = new Uint8Array( N * N );
		this.river = new Uint8Array( N * N ); // none: kept for the tiles' common mask shape
		this.forest = new Uint8Array( N * N );
		this.paths = BLACKWATER_PATHS;
		this.rockSites = [];
		this.timings = {};
		this._Q = { u: 0, v: 0, d: 0, d0: 0, bz: 0, m: 0 };
		this._out = { h: 0, d: 0, bz: 0, rock: 0, m: 0 };
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

	// ------------------------------------------------------------------ the recipe (TerrainData, one islet)

	// TerrainData._islet: the signed coast distance d (shelf applied), the beach zone bz, the mask m, at island
	// coordinates (u, v) with the noise read at source coordinates (sx, sz)
	_islet( u, v, sx, sz, Q ) {

		Q.u = u; Q.v = v;
		const ru = I.ru, rv = I.rv;
		let d0 = ( Math.sqrt( ( u / ru ) * ( u / ru ) + ( v / rv ) * ( v / rv ) ) - 1 ) * ru;
		// the atoll ring round the cove and the dredged channel through it
		const iu = u / I.atoll[ 0 ], iv = v / I.atoll[ 1 ];
		d0 = Math.max( d0, ( 1 - Math.sqrt( iu * iu + iv * iv ) ) * I.atoll[ 0 ] );
		const [ cv, hw, cu0, cu1 ] = I.channel;
		if ( u > cu0 && u < cu1 ) d0 = Math.max( d0, ( hw - Math.abs( v - cv ) ) * 6 * smoothstep( cu0, cu0 + 15, u ) * ( 1 - smoothstep( cu1 - 15, cu1, u ) ) );
		Q.d0 = d0;
		const sh0 = I.shelf[ 0 ], shk = I.shelf[ 1 ];
		if ( d0 >= I.far ) {

			Q.d = d0 + ( d0 > sh0 ? ( d0 - sh0 ) * shk : 0 ); Q.bz = 0; Q.m = 0;
			return Q;

		}

		const B = I.beach;
		let bz = ( 1 - smoothstep( B.out[ 0 ], B.out[ 1 ], d0 ) ) * smoothstep( B.inland[ 0 ], B.inland[ 1 ], d0 );
		bz *= smoothstep( B.sector[ 0 ], B.sector[ 1 ], - u / Math.max( 1, Math.hypot( u, v ) ) );
		let d = d0;
		const O = I.outline, f = I.far;
		if ( d0 < f * 0.8 ) {

			const n = this.noise;
			const w = 1 - smoothstep( f * 0.55, f * 0.8, d0 );
			d += ( n.fbm( sx / O[ 0 ] + O[ 4 ], sz / O[ 0 ] + O[ 5 ], 3 ) * O[ 1 ] * ( 1 - 0.85 * bz ) + n.fbm( sx / O[ 2 ] + O[ 6 ], sz / O[ 2 ] + O[ 7 ], 2 ) * O[ 3 ] * ( 1 - bz ) ) * w;

		}

		Q.d = d + ( d > sh0 ? ( d - sh0 ) * shk : 0 ); Q.bz = bz; Q.m = 1 - smoothstep( f * 0.6, f, d0 );
		return Q;

	}

	// TerrainData._base for this island alone (grid B's profile: the seabed, the beach, the hills, the sea cliffs)
	_base( u, v, sx, sz, out ) {

		const n = this.noise, n2 = this.noise2;
		const Q = this._islet( u, v, sx, sz, this._Q );
		const d = Q.d, bz = Q.bz, m = Q.m;
		// the rocky coast everywhere but the beaches (the home island's headlands are far away)
		const rm = 1 - bz * 1.4;
		let rock = 0;
		if ( rm > 0.35 ) rock = smoothstep( 0.35, 0.75, clamp( rm * ( 0.55 + 0.45 * n2.fbm( sx / 60, sz / 60, 3 ) ), 0, 1 ) );
		let h;
		if ( d >= 0 ) {

			let depth;
			if ( d < 70 ) depth = d * 0.05;
			else if ( d < 260 ) depth = 3.5 + ( d - 70 ) * 0.06;
			else if ( d < 700 ) depth = 14.9 + ( d - 260 ) * 0.07;
			else depth = 45.7 + ( d - 700 ) * 0.05;
			depth = Math.min( depth, 85 );
			depth *= lerp( 1, 2.4, rock * ( 1 - smoothstep( 150, 400, d ) ) );
			const sandRipple = d < 420 ? n.fbm( sx / 45, sz / 45, 3 ) * 0.6 * ( 1 - smoothstep( 380, 420, d ) ) : 0;
			const deepVar = n.fbm( sx / 220, sz / 220, 4 ) * 6 * smoothstep( 60, 400, d );
			h = - depth + sandRipple * smoothstep( 8, 40, d ) + deepVar;
			if ( rock > 0 && d < 300 ) h += rock * n2.ridged( sx / 25, sz / 25, 4 ) * 5 * smoothstep( 0, 20, d ) * ( 1 - smoothstep( 120, 300, d ) );
			if ( m > 0 ) {

				// the deeper water off the main dock
				const [ pu, pv, su, sv, pd ] = I.pocket;
				const du = ( u - pu ) / su, dv = ( v - pv ) / sv;
				h -= m * pd * Math.exp( - du * du - dv * dv ) * smoothstep( 5, 14, d );
				// the cove: a calm floor at I.lagoon within ~14 m of the inner shore
				const iu = u / I.atoll[ 0 ], iv = v / I.atoll[ 1 ];
				const L = 1 - smoothstep( 0.9, 1.0, Math.sqrt( iu * iu + iv * iv ) );
				if ( L > 0 ) h = lerp( h, - ( I.lagoon - 0.4 * n.fbm( sx / 31, sz / 31, 2 ) ) * smoothstep( 0, 14, d ), L );

			}

		} else {

			const e = - d;
			if ( e < 38 ) h = e * 0.068;
			else if ( e < 70 ) h = 2.584 + ( e - 38 ) * 0.03;
			else if ( e < 230 ) h = 3.544 + ( e - 70 ) * 0.075;
			else h = 15.544 + ( e - 230 ) * 0.04;
			if ( e > 25 && e < 240 ) h += smoothstep( 25, 60, e ) * ( 1 - smoothstep( 120, 240, e ) ) * n2.fbm( sx / 30, sz / 30, 3 ) * 0.9;
			let cliffScale = 1;
			if ( m > 0 ) {

				h *= 1 + ( I.heightScale - 1 ) * m;
				let hill = 0;
				for ( const [ hu, hv, su, sv, H ] of I.hills ) {

					const du = ( u - hu ) / su, dv = ( v - hv ) / sv;
					hill += H * Math.exp( - du * du - dv * dv );

				}

				hill *= 1 + 0.3 * n.fbm( sx / 40 + 6.3, sz / 40 - 2.1, 3 );
				if ( I.ridge > 0 ) hill += I.ridge * n2.ridged( sx / 24, sz / 24, 3 ) * ( 1 - bz );
				h += m * hill * smoothstep( I.hillIn[ 0 ], I.hillIn[ 1 ], e );
				cliffScale = 1 - ( 1 - I.cliffScale ) * m;

			}

			const cliffZone = rock * ( 1 - smoothstep( 90, 170, e ) );
			if ( cliffZone > 0 ) {

				const cliff = Math.min( e * 1.6, ( 18 + n2.ridged( sx / 70, sz / 70, 4 ) * 22 ) * cliffScale ) + n2.fbm( sx / 12, sz / 12, 3 ) * 2.5;
				h = lerp( h, Math.max( h, cliff ), cliffZone );

			}

		}

		out.h = h; out.d = d; out.bz = bz; out.rock = rock; out.m = m;
		return out;

	}

	recipeAt( x, z ) {

		const [ u, v ] = this.local( x, z );
		const o = this._base( u, v, x + DX, z + DZ, {} );
		return { h: o.h, d: o.d, bz: o.bz, rock: o.rock };

	}

	_generate() {

		const n = this.noise, n2 = this.noise2, n3 = this.noise3;
		const NN = N * N;
		const H = this.heights;
		const D = new Float32Array( NN ), R0 = new Float32Array( NN ), BZ = new Float32Array( NN ), M = new Float32Array( NN );
		const U = new Float32Array( NN ), V = new Float32Array( NN );
		const o = this._out;
		let t = now();
		const tick = ( name ) => { const q = now(); this.timings[ name ] = Math.round( q - t ); t = q; };

		// ---- the base profile at every node
		for ( let j = 0; j < N; j ++ ) {

			const z = this.z0 + j * TEXEL;
			for ( let i = 0; i < N; i ++ ) {

				const x = this.x0 + i * TEXEL, k = j * N + i;
				const dx = x - I.x, dz = z - I.z, u = dx * I.ax + dz * I.az, v = - dx * I.az + dz * I.ax;
				this._base( u, v, x + DX, z + DZ, o );
				H[ k ] = o.h; D[ k ] = o.d; R0[ k ] = o.rock; BZ[ k ] = o.bz; M[ k ] = o.m; U[ k ] = u; V[ k ] = v;

			}

		}

		tick( 'base' );

		// ---- TerrainData._detail: soft undulation, crags on the rocky waterline, layered cliffs, outcrops (the slope
		// from the base profile, per metre as the 1 m pass reads it)
		const B = H.slice();
		for ( let j = 1; j < N - 1; j ++ ) for ( let i = 1; i < N - 1; i ++ ) {

			const k = j * N + i;
			const h = B[ k ];
			if ( h < - 6 || M[ k ] <= 0 ) continue;
			const sx = this.x0 + i * TEXEL + DX, sz = this.z0 + j * TEXEL + DZ;
			const e = - D[ k ], bz = BZ[ k ];
			const wild = 1 - bz * ( 1 - smoothstep( 70, 130, e ) );
			if ( wild <= 0.01 ) continue;
			const gx = B[ k + 1 ] - B[ k - 1 ], gz = B[ k + N ] - B[ k - N ];
			const slope = Math.sqrt( gx * gx + gz * gz ) / ( 2 * TEXEL );
			let add = 0;
			if ( e > 4 ) add += n3.fbm( sx / 17, sz / 17, 2 ) * 0.28 * smoothstep( 4, 30, e );
			const r0 = R0[ k ];
			if ( r0 > 0.35 && e > - 25 && e < 40 ) {

				const crag = ( n2.ridged( sx / 11 + 1.3, sz / 11 - 4.4, 3 ) - 0.45 ) * 1.6 + ( n3.ridged( sx / 4.3 + 8.8, sz / 4.3, 2 ) - 0.45 ) * 0.5;
				add += crag * smoothstep( 0.35, 0.7, r0 ) * smoothstep( - 3, 1.5, h ) * ( 1 - smoothstep( 15, 38, e ) );

			}

			const layered = smoothstep( 0.45, 0.9, slope ) * r0 * ( 1 - smoothstep( 60, 140, e ) ) * smoothstep( 1, 5, h ) *
				smoothstep( - 0.1, 0.35, n3.noise( sx / 53 + 4.1, sz / 53 ) );
			if ( layered > 0.02 ) {

				const warp = n2.noise( sx / 41, sz / 41 ) * 5 + n3.noise( sx / 17, sz / 17 ) * 1.5;
				const step = 6 + 5 * ( 0.5 + 0.5 * n3.noise( sx / 97, sz / 97 ) );
				const tt = ( h + warp ) / step;
				const f = Math.floor( tt ), fr = tt - f;
				const ledge = ( f + smoothstep( 0.25, 0.9, fr ) ) * step - warp;
				add += ( ledge - h ) * 0.3 * layered;

			}

			const want = Math.max( smoothstep( 0.35, 0.8, slope ), r0 * 0.8 );
			if ( want > 0.05 ) {

				const rid = n2.fbm( sx / 24 + 3.1, sz / 24 - 7.7, 3 ) + n3.noise( sx / 6.3, sz / 6.3 ) * 0.08;
				const wall = smoothstep( 0.3, 0.36, rid );
				if ( wall > 0 ) {

					const dome = smoothstep( 0.36, 0.6, rid );
					const joint = 1 - smoothstep( 0.03, 0.09, Math.abs( n3.noise( sx / 4.6 + 7.3, sz / 4.6 - 1.9 ) ) );
					add += want * ( 1.5 + 1.5 * r0 ) * ( wall * 0.7 + dome * 0.45 ) * ( 1 - 0.3 * joint * wall );

				}

			}

			H[ k ] = h + add * wild;

		}

		tick( 'detail' );

		// ---- TerrainData._features: the sea stacks (centres rounded as IslandShape.refreshIsletStacks did)
		const r1 = ( q ) => Math.round( q * 10 ) / 10;
		for ( const [ su, sv, r, hgt ] of I.stacks ) {

			const ssx = r1( SOURCE.x + su * I.ax - sv * I.az ), ssz = r1( SOURCE.z + su * I.az + sv * I.ax );
			const cx = ssx - DX, cz = ssz - DZ;
			const R = r * 2.4;
			const i0 = Math.max( 0, Math.floor( ( cx - R - this.x0 ) / TEXEL ) ), i1 = Math.min( N - 1, Math.ceil( ( cx + R - this.x0 ) / TEXEL ) );
			const j0 = Math.max( 0, Math.floor( ( cz - R - this.z0 ) / TEXEL ) ), j1 = Math.min( N - 1, Math.ceil( ( cz + R - this.z0 ) / TEXEL ) );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const k = j * N + i;
				const sx = this.x0 + i * TEXEL + DX, sz = this.z0 + j * TEXEL + DZ;
				const dx = sx - ssx, dz = sz - ssz;
				const a = Math.atan2( dz, dx );
				const rr = r * ( 1 + 0.22 * n3.noise( Math.cos( a ) * 1.7 + ssx, Math.sin( a ) * 1.7 + ssz ) + 0.08 * n2.noise( sx / 2.5, sz / 2.5 ) );
				const uu = Math.hypot( dx, dz ) / rr;
				const col = smoothstep( 1.0, 0.82, uu );
				const top = hgt * ( 1 - 0.25 * uu * uu ) + n2.ridged( sx / 6, sz / 6, 3 ) * 2.2;
				const skirt = ( 1 - smoothstep( 0.9, 2.4, uu ) ) * ( 1.6 + n2.ridged( sx / 4, sz / 4, 2 ) * 1.4 );
				let h = H[ k ] + skirt;
				h = lerp( h, Math.max( h, top ), col );
				H[ k ] = h;
				R0[ k ] = Math.max( R0[ k ], 1 - smoothstep( 1.6, 2.4, uu ) );

			}

			this.rockSites.push( { x: cx, z: cz, r, h: hgt, kind: 'stack' } );

		}

		// the wave-cut platform under the cliffs, with tide pools
		for ( let k = 0; k < NN; k ++ ) {

			const d = D[ k ];
			if ( d < - 4 || d > 26 || R0[ k ] < 0.3 || M[ k ] <= 0 ) continue;
			const i = k % N, j = ( k - i ) / N;
			const sx = this.x0 + i * TEXEL + DX, sz = this.z0 + j * TEXEL + DZ;
			const width = 9 + 12 * ( 0.5 + 0.5 * n3.fbm( sx / 45, sz / 45, 2 ) );
			const inside = ( 1 - smoothstep( width * 0.7, width, d ) ) * smoothstep( 0.3, 0.6, R0[ k ] );
			if ( inside <= 0 ) continue;
			const pool = smoothstep( 0.2, 0.45, n2.noise( sx / 3.1, sz / 3.1 ) ) * 0.35;
			const shelf = - 0.35 + 0.35 * n.fbm( sx / 7, sz / 7, 2 ) + n2.ridged( sx / 3, sz / 3, 2 ) * 0.25 - pool;
			if ( shelf > H[ k ] ) {

				H[ k ] = lerp( H[ k ], shelf, inside );
				R0[ k ] = Math.max( R0[ k ], inside );

			}

		}

		// footpaths: worn, a few centimetres down (island coordinates)
		const P = this.path;
		const boxes = BLACKWATER_PATHS.map( ( p ) => {

			const us = p.pts.map( ( q ) => q[ 0 ] ), vs = p.pts.map( ( q ) => q[ 1 ] ), mg = p.w * 2 + 2;
			return { p, b: [ Math.min( ...us ) - mg, Math.max( ...us ) + mg, Math.min( ...vs ) - mg, Math.max( ...vs ) + mg ] };

		} );
		for ( let k = 0; k < NN; k ++ ) {

			const u = U[ k ], v = V[ k ];
			for ( const { p, b } of boxes ) {

				if ( u < b[ 0 ] || u > b[ 1 ] || v < b[ 2 ] || v > b[ 3 ] ) continue;
				const [ dist ] = polylineDistance( p.pts, u, v );
				const i = k % N, j = ( k - i ) / N;
				const w = p.w * ( 1 + 0.25 * n2.noise( ( this.x0 + i * TEXEL + DX ) / 6, ( this.z0 + j * TEXEL + DZ ) / 6 ) );
				const pm = 1 - smoothstep( w * 0.6, w * 1.9, dist );
				if ( pm <= 0 ) continue;
				P[ k ] = Math.max( P[ k ], Math.round( pm * 255 ) );
				H[ k ] -= 0.08 * ( 1 - smoothstep( w * 0.4, w * 1.2, dist ) ) * smoothstep( 1.5, 3, H[ k ] );

			}

		}

		// the building pads (the town, the fort yard, the gun platforms): level ground after all the relief
		for ( const [ pu, pv, pr, fall, hgt ] of I.pads ) {

			const R = pr + fall;
			for ( let k = 0; k < NN; k ++ ) {

				const du = U[ k ] - pu, dv = V[ k ] - pv;
				if ( du > R || du < - R || dv > R || dv < - R ) continue;
				const tt = 1 - smoothstep( pr, R, Math.hypot( du, dv ) );
				if ( tt <= 0 ) continue;
				H[ k ] = lerp( H[ k ], hgt, tt );
				R0[ k ] *= 1 - tt;

			}

		}

		tick( 'features' );

		// ---- masks (TerrainData._masks at 2 m) and the rim fade to the open-ocean floor
		const at = ( k ) => H[ k ];
		for ( let j = 0; j < N; j ++ ) for ( let i = 0; i < N; i ++ ) {

			const k = j * N + i;
			const h = H[ k ], d = D[ k ], r0 = R0[ k ], bz = BZ[ k ];
			const sx = this.x0 + i * TEXEL + DX, sz = this.z0 + j * TEXEL + DZ;
			let rk, sd;
			if ( h < - 14 || i < 2 || j < 2 || i > N - 3 || j > N - 3 ) {

				rk = r0 * ( 1 - smoothstep( 80, 260, d ) );
				sd = 1;

			} else {

				const gx = at( k + 1 ) - at( k - 1 ), gz = at( k + N ) - at( k - N );
				const slope = Math.sqrt( gx * gx + gz * gz ) / ( 2 * TEXEL );
				const nz = n2.noise( sx / 23, sz / 23 ) * 0.5 + n3.noise( sx / 7, sz / 7 ) * 0.25;
				const seaCliff = d < 0 ? r0 * ( 1 - smoothstep( 6, 38, - d ) ) : 0;
				const s0 = 1.45 - 0.75 * seaCliff + nz * 0.35;
				let steep = smoothstep( s0, s0 + 0.35, slope );
				const lap = ( at( k + 2 ) + at( k - 2 ) + at( k + 2 * N ) + at( k - 2 * N ) - 4 * h ) / 16;
				if ( steep > 0 ) steep *= 1 - 0.85 * smoothstep( 0.01, 0.08, lap ); // gully floors keep their soil
				const coast = d < 0 ? r0 * ( 1 - smoothstep( 2, 16 + nz * 12, - d ) ) : r0 * ( 1 - smoothstep( 80, 260, d ) );
				rk = Math.max( steep, coast * ( 0.75 + nz * 0.5 ) );
				rk = Math.max( rk, smoothstep( 0.55, 0.9, slope ) * smoothstep( - 0.12, - 0.3, lap ) * ( 1 - bz ) * 0.8 );
				if ( d >= 0 ) sd = 1 - smoothstep( 0.4, 0.8, rk );
				else {

					const e = - d;
					const beach = bz * ( 1 - smoothstep( 36 + nz * 10, 50 + nz * 14, e ) );
					const backBeach = bz * 0.45 * ( 1 - smoothstep( 60 + nz * 20, 100 + nz * 20, e ) );
					const dune = bz * ( 1 - smoothstep( 4.5 + nz * 2, 7 + nz * 2, h ) ) * ( 1 - smoothstep( 110, 140, e ) );
					const cove = ( 1 - smoothstep( 6, 16, e ) ) * ( 1 - smoothstep( 0.25, 0.5, rk ) ) * ( 1 - smoothstep( 1.8, 3.2, h ) ) * ( 1 - smoothstep( 0.12, 0.3, slope ) );
					sd = Math.max( beach, backBeach, dune, cove ) * ( 1 - smoothstep( 0.3, 0.6, slope ) );

				}

			}

			this.rock[ k ] = Math.round( clamp( rk, 0, 1 ) * 255 );
			this.sand[ k ] = Math.round( clamp( sd, 0, 1 ) * 255 );
			// worn ground: the yards on the pads and the docks' feet count as path (no plants, no grass there)
			const yard = 1 - smoothstep( 0, 3, this._yardDistance( U[ k ], V[ k ] ) );
			if ( yard > 0 ) P[ k ] = Math.max( P[ k ], Math.round( yard * 255 ) );
			// scrub woodland on the flanks (not on rock, the yards or the paths)
			const f = smoothstep( 6, 22, h ) * ( 1 - rk ) * ( 1 - yard ) * smoothstep( 0.1, 0.35, n.fbm( sx / 70 + 9.2, sz / 70, 3 ) + 0.2 );
			this.forest[ k ] = Math.round( clamp( f, 0, 1 ) * 255 );
			const edge = Math.min( i, j, N - 1 - i, N - 1 - j ) * TEXEL;
			if ( edge < FADE ) H[ k ] = lerp( OCEAN, h, smoothstep( 0, FADE, edge ) );

		}

		tick( 'masks' );

	}

	// distance (island metres) outside the pads' level tops and the docks (<= 0 inside)
	_yardDistance( u, v ) {

		let best = Infinity;
		for ( const [ pu, pv, pr ] of I.pads ) {

			const du = u - pu, dv = v - pv;
			if ( du > pr + 40 || du < - pr - 40 || dv > pr + 40 || dv < - pr - 40 ) continue;
			best = Math.min( best, Math.hypot( du, dv ) - pr );

		}

		for ( const D of DOCKS ) best = Math.min( best, polylineDistance( D.pts, u, v )[ 0 ] - D.w - 1 );
		return best;

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
		const Q = this._islet( u, v, x + DX, z + DZ, {} );
		return { d: Q.d, beachZone: Q.bz };

	}

	// distance (m) to the nearest footpath edge (negative inside one); the pads' yards and the docks count as worn ground
	pathDistance( x, z ) {

		const [ u, v ] = this.local( x, z );
		let best = this._yardDistance( u, v );
		for ( const p of BLACKWATER_PATHS ) best = Math.min( best, polylineDistance( p.pts, u, v )[ 0 ] - p.w );
		return best;

	}

	// the masks at the nearest node (0..1)
	maskAt( x, z ) {

		const i = Math.round( ( x - this.x0 ) / TEXEL ), j = Math.round( ( z - this.z0 ) / TEXEL );
		if ( i < 0 || j < 0 || i >= N || j >= N ) return { rock: 0, sand: 1, path: 0, river: 0, forest: 0 };
		const k = j * N + i;
		return { rock: this.rock[ k ] / 255, sand: this.sand[ k ] / 255, path: this.path[ k ] / 255, river: 0, forest: this.forest[ k ] / 255 };

	}

}

// The island's tile for this terrain: the one already attached, else the shared tile (built once per page) attached now
// through TidemarkTerrain's generic attach (TerrainData.addOuterTile when it exists). TerrainData's constructor calls it
// after ensureTidemark (root patch); anything that needs Blackwater's ground may call it too, in any order.
let shared = null;
export function ensureBlackwater( terrain ) {

	const had = terrain && terrain._outerTiles && terrain._outerTiles.find( ( q ) => q.id === I.id );
	if ( had ) return had;
	shared = shared || new BlackwaterTerrain();
	return attachTidemark( terrain, shared );

}
