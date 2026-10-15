// The inverted islets as one procedural mesh (one draw): each islet hangs upside down, its grass face toward the sea
// and its rock cone rising into the sky, with roots and small upside-down trees trailing below it; the landmark
// carries a spire of warm stone with gold bands, a ring of hanging columns and a beacon at the spire's tip.
// Low-poly and flat shaded on purpose (it is read from 150 - 500 m away, through the haze). The roots and the trees
// sway in the vertex shader (frame.time / frame.windDir); the beacon glows (stronger at night); `gold` 0..1 turns the
// whole layer golden for the yellow Easter-egg preset.
//
//   const islets = new Islets( layout );  scene.add( islets.mesh );  islets.setGold( 0..1 );  islets.triangles

import { Mesh } from '../../engine/scene/Mesh.js';
import { BufferGeometry, Float32BufferAttribute } from '../../engine/geometry/index.js';
import { Material } from '../../engine/render/Material.js';
import { SPIRE } from './Layout.js';

const ROCK_LO = [ 0.36, 0.31, 0.27 ], ROCK_HI = [ 0.2, 0.19, 0.19 ], MOSS = [ 0.22, 0.3, 0.14 ];
const GRASS = [ 0.17, 0.3, 0.11 ], DIRT = [ 0.3, 0.22, 0.14 ], ROOT = [ 0.19, 0.13, 0.08 ];
const BARK = [ 0.26, 0.18, 0.11 ], LEAF = [ 0.12, 0.26, 0.1 ];
const STONE = [ 0.62, 0.55, 0.42 ], GOLD = [ 0.8, 0.6, 0.24 ], BEACON = [ 1, 0.8, 0.5 ];

function rng( seed ) {

	let s = ( seed * 0x9e3779b1 ) >>> 0;
	return () => ( s = ( Math.imul( s ^ ( s >>> 15 ), 2246822519 ) + 0x6D2B79F5 ) >>> 0 ) / 4294967296;

}

const mixc = ( a, b, t ) => [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ];

// triangle soup: flat-shaded, every vertex carries a colour, a sway (along 0..1, seed, amplitude m) and a glow
export class Soup {

	constructor() {

		this.pos = []; this.col = []; this.sway = []; this.glow = [];

	}

	tri( a, b, c, col, sw = null, glow = 0 ) {

		for ( const p of [ a, b, c ] ) {

			this.pos.push( p[ 0 ], p[ 1 ], p[ 2 ] );
			this.col.push( col[ 0 ], col[ 1 ], col[ 2 ] );
			const s = sw ? ( typeof sw === 'function' ? sw( p ) : sw ) : [ 0, 0, 0 ];
			this.sway.push( s[ 0 ], s[ 1 ], s[ 2 ] );
			this.glow.push( glow );

		}

	}

	quad( a, b, c, d, col, sw, glow ) {

		this.tri( a, b, c, col, sw, glow );
		this.tri( a, c, d, col, sw, glow );

	}

	get triangles() {

		return this.pos.length / 9;

	}

	geometry() {

		const g = new BufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'color', new Float32BufferAttribute( this.col, 3 ) );
		g.setAttribute( 'aSway', new Float32BufferAttribute( this.sway, 3 ) );
		g.setAttribute( 'aGlow', new Float32BufferAttribute( this.glow, 1 ) );
		g.computeVertexNormals();
		return g;

	}

}

// a tapered prism from p0 down/along to p1 (n sides), split in k segments; along runs 0 at p0 .. 1 at p1
function prism( S, p0, p1, r0, r1, n, k, col, swayFn, glow = 0 ) {

	const dx = p1[ 0 ] - p0[ 0 ], dy = p1[ 1 ] - p0[ 1 ], dz = p1[ 2 ] - p0[ 2 ];
	const L = Math.hypot( dx, dy, dz ) || 1;
	const ax = [ dx / L, dy / L, dz / L ];
	// a frame around the axis
	const up = Math.abs( ax[ 1 ] ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ];
	let ux = up[ 1 ] * ax[ 2 ] - up[ 2 ] * ax[ 1 ], uy = up[ 2 ] * ax[ 0 ] - up[ 0 ] * ax[ 2 ], uz = up[ 0 ] * ax[ 1 ] - up[ 1 ] * ax[ 0 ];
	const ul = Math.hypot( ux, uy, uz ) || 1; ux /= ul; uy /= ul; uz /= ul;
	const vx = ax[ 1 ] * uz - ax[ 2 ] * uy, vy = ax[ 2 ] * ux - ax[ 0 ] * uz, vz = ax[ 0 ] * uy - ax[ 1 ] * ux;
	const ring = ( t ) => {

		const r = r0 + ( r1 - r0 ) * t, c = [ p0[ 0 ] + dx * t, p0[ 1 ] + dy * t, p0[ 2 ] + dz * t ];
		const out = [];
		for ( let i = 0; i < n; i ++ ) {

			const a = i / n * Math.PI * 2, ca = Math.cos( a ) * r, sa = Math.sin( a ) * r;
			out.push( [ c[ 0 ] + ux * ca + vx * sa, c[ 1 ] + uy * ca + vy * sa, c[ 2 ] + uz * ca + vz * sa ] );

		}

		return { c, pts: out, t };

	};

	let prev = ring( 0 );
	for ( let j = 1; j <= k; j ++ ) {

		const cur = ring( j / k );
		for ( let i = 0; i < n; i ++ ) {

			const i2 = ( i + 1 ) % n;
			const a = prev.pts[ i ], b = prev.pts[ i2 ], c = cur.pts[ i2 ], d = cur.pts[ i ];
			S.tri( a, d, c, col, swayFn ? swayFn( prev.t, cur.t, a ) : null, glow );
			S.tri( a, c, b, col, swayFn ? swayFn( prev.t, cur.t, a ) : null, glow );

		}

		prev = cur;

	}

	// close the far end (a root tip or the spire's end)
	if ( r1 > 0.01 ) for ( let i = 0; i < n; i ++ ) S.tri( prev.c, prev.pts[ i ], prev.pts[ ( i + 1 ) % n ], col, swayFn ? swayFn( 1, 1, prev.c ) : null, glow );

}

// one islet, in world space (y up: the grass face at s.y, the cone above it)
export function buildIslet( S, s ) {

	const R = rng( s.seed || 1 );
	const N = s.landmark ? 32 : 22, RJ = 6;
	const rim = [];
	for ( let i = 0; i < N; i ++ ) rim.push( 1 + 0.16 * ( R() - 0.5 ) * 2 );
	const P = ( i, j ) => {

		// ring j of the cone: j = 0 the rim (at the face), RJ the apex
		const t = j / RJ;
		const a = ( i % N ) / N * Math.PI * 2;
		const wob = rim[ i % N ] * ( 1 + 0.12 * Math.sin( a * 3 + j * 1.7 + s.seed ) );
		const r = s.r * Math.pow( 1 - t, 0.85 ) * wob;
		return [ s.x + Math.cos( a ) * r, s.y + s.h * t - s.r * 0.04, s.z + Math.sin( a ) * r ];

	};

	// rock cone (normals out and up)
	for ( let j = 0; j < RJ; j ++ ) {

		const col = mixc( j === 0 ? MOSS : ROCK_LO, ROCK_HI, j / RJ );
		for ( let i = 0; i < N; i ++ ) {

			const a = P( i, j ), b = P( i + 1, j ), c = P( i + 1, j + 1 ), d = P( i, j + 1 );
			if ( j === RJ - 1 ) S.tri( a, d, b, col );
			else S.quad( a, d, c, b, col );

		}

	}

	// the grass face, bulging a little toward the sea (normals down)
	const centre = [ s.x, s.y - s.r * 0.09, s.z ];
	const mid = ( i ) => {

		const a = ( i % N ) / N * Math.PI * 2, r = s.r * 0.6 * rim[ i % N ];
		return [ s.x + Math.cos( a ) * r, s.y - s.r * 0.065, s.z + Math.sin( a ) * r ];

	};

	for ( let i = 0; i < N; i ++ ) {

		const o0 = P( i, 0 ), o1 = P( i + 1, 0 ), m0 = mid( i ), m1 = mid( i + 1 );
		S.quad( o0, o1, m1, m0, mixc( GRASS, DIRT, 0.55 ) );
		S.tri( m0, m1, centre, GRASS );

	}

	// roots: from under the face, trailing down (longer toward the rim's lowest bulge), swaying more at the tip
	const faceY = ( rr ) => s.y - s.r * 0.09 * ( 1 - rr * rr );
	for ( let k = 0; k < s.roots; k ++ ) {

		const a = R() * Math.PI * 2, rr = 0.25 + 0.75 * Math.sqrt( R() );
		const x0 = s.x + Math.cos( a ) * rr * s.r * 0.95, z0 = s.z + Math.sin( a ) * rr * s.r * 0.95;
		const L = s.r * ( 0.15 + 0.5 * R() ) * ( s.landmark ? 1.3 : 1 );
		const seed = R();
		const drift = 0.15 * L;
		const p0 = [ x0, faceY( rr ) + 0.5, z0 ], p1 = [ x0 + ( R() - 0.5 ) * drift, faceY( rr ) - L, z0 + ( R() - 0.5 ) * drift ];
		const amp = 0.06 * L;
		prism( S, p0, p1, Math.max( 0.25, s.r * 0.012 ), 0.05, 3, 5, ROOT, ( t0, t1, p ) => [ Math.max( 0, ( faceY( rr ) - p[ 1 ] ) / L ), seed, amp ] );

	}

	// upside-down trees: a trunk hanging from the face and a crown that points at the sea
	for ( let k = 0; k < s.trees; k ++ ) {

		const a = R() * Math.PI * 2, rr = 0.15 + 0.7 * R();
		const x0 = s.x + Math.cos( a ) * rr * s.r, z0 = s.z + Math.sin( a ) * rr * s.r;
		const y0 = faceY( rr ) + 0.3, th = s.r * ( 0.1 + 0.08 * R() ), cr = s.r * ( 0.07 + 0.04 * R() );
		const seed = R();
		const sw = ( along ) => [ along, seed, 0.02 * th ];
		prism( S, [ x0, y0, z0 ], [ x0, y0 - th, z0 ], cr * 0.18, cr * 0.12, 5, 2, BARK, ( t0, t1, p ) => sw( Math.max( 0, ( y0 - p[ 1 ] ) / ( th * 2 ) ) ) );
		prism( S, [ x0, y0 - th * 0.8, z0 ], [ x0, y0 - th * 2.1, z0 ], cr, 0.02, 6, 2, LEAF, ( t0, t1, p ) => sw( Math.max( 0, ( y0 - p[ 1 ] ) / ( th * 2.1 ) ) ) );

	}

	if ( s.landmark ) buildLandmark( S, s, R );

}

// the spire (stone with gold bands), its ring of hanging columns and the beacon at the tip
function buildLandmark( S, s, R ) {

	const top = s.y - s.r * 0.08;
	const segs = [ [ 0, 14, 11 ], [ 0.3, 11, 8 ], [ 0.55, 8, 5.5 ], [ 0.78, 5.5, 3 ] ]; // [ start fraction, r0, r1 ]
	for ( let i = 0; i < segs.length; i ++ ) {

		const f0 = segs[ i ][ 0 ], f1 = i + 1 < segs.length ? segs[ i + 1 ][ 0 ] : 1;
		const y0 = top - SPIRE * f0, y1 = top - SPIRE * f1;
		prism( S, [ s.x, y0, s.z ], [ s.x, y1 + 2, s.z ], segs[ i ][ 1 ], segs[ i ][ 2 ], 8, 2, STONE );
		// a gold band where the sections meet
		prism( S, [ s.x, y1 + 2.5, s.z ], [ s.x, y1, s.z ], segs[ i ][ 2 ] * 1.25, segs[ i ][ 2 ] * 1.1, 8, 1, GOLD );

	}

	// the beacon: a small faceted lamp at the tip (it glows; the night worker owns any beam)
	const by = top - SPIRE - 3;
	prism( S, [ s.x, by + 3, s.z ], [ s.x, by - 3.5, s.z ], 3.2, 0.1, 8, 2, BEACON, null, 1 );
	// golden columns hanging around the spire
	for ( let k = 0; k < 6; k ++ ) {

		const a = k / 6 * Math.PI * 2 + 0.3, rr = s.r * 0.45;
		const x = s.x + Math.cos( a ) * rr, z = s.z + Math.sin( a ) * rr;
		const L = 30 + 20 * R();
		prism( S, [ x, top - s.r * 0.03, z ], [ x, top - L, z ], 2.4, 1.6, 6, 2, mixc( STONE, GOLD, 0.5 ) );

	}

}

export class Islets {

	constructor( layout ) {

		const S = new Soup();
		for ( const s of layout ) buildIslet( S, s );
		this.triangles = S.triangles;
		this.geometry = S.geometry();
		this.material = new Material( {
			name: 'InvertedIslets',
			vertexColors: true,
			side: 'double', // seen from below and from the side; the template turns the normal to the viewer
			roughness: 0.92,
			metalness: 0,
			underwaterLighting: 'none',
			uniforms: { gold: [ 'f32', 0 ] },
			attributes: { aSway: 'vec3f', aGlow: 'f32' },
			varyings: { vGlow: 'f32' },
			vertex: /* wgsl */`
	let sw = v.aSway;
	if ( sw.z > 0.0 ) {
		// roots and crowns: a slow pendulum along the wind, a little across, more toward the tip
		let t = frame.time * ( 0.45 + 0.3 * sw.y ) + sw.y * 6.2831;
		let k = sw.x * sw.x * sw.z * ( 0.6 + 0.08 * frame.windSpeed );
		let w = vec2f( frame.windDir.x, frame.windDir.y );
		v.position += vec3f( w.x, 0.0, w.y ) * ( sin( t ) + 0.6 ) * k + vec3f( - w.y, 0.0, w.x ) * cos( t * 1.3 ) * k * 0.4;
	}
	o.vGlow = v.aGlow;
`,
			surface: /* wgsl */`
	let lum = dot( s.albedo, vec3f( 0.3, 0.55, 0.15 ) );
	s.albedo = mix( s.albedo, vec3f( 0.95, 0.72, 0.22 ) * ( 0.35 + lum * 1.6 ), mat.gold * 0.75 );
	s.emissive = vec3f( 1.0, 0.72, 0.38 ) * in.vs.vGlow * mix( 4.0, 14.0, frame.night ) * ( 1.0 + mat.gold );
`,
		} );
		this.mesh = new Mesh( this.geometry, this.material );
		this.mesh.name = 'InvertedIslets';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.visible = false;

	}

	setGold( g ) {

		this.material.uniforms.gold.value = Math.max( 0, Math.min( 1, g ) );

	}

	dispose() {

		try {

			if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );
			if ( this.geometry.dispose ) this.geometry.dispose();

		} catch ( e ) { /* already gone */ }

	}

}
