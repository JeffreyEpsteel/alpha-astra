import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Vector3 } from '../../engine/index.js';
import { prepare, mergePrepared, mat4, box, cylinder, sphere, lathe, rod, gridSurface } from '../boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';

// Geometry helpers for Jade Landing (src/world/start): a bucketed kit over the boat's GeoKit layout
// (color = linear albedo, aux = rough, metal, pattern, anim) and the few organic shapes the landing
// needs: a carved fish (lathe body, bent), a curved hip roof with lifted corners, paper lanterns on
// a sagging string, bunting, a striped hammock.
//
// aux.w (anim) is read by the landing material (Landing.js): 0..1 = wind sway weight (cloth), +2 = glows
// at night (paper lanterns, the totem's pearl).

export const PALETTE = {
	jade: 0x3a9a74, jadeLight: 0x74c9a0, jadeDeep: 0x1d6650, roofJade: 0x2c8a66,
	coral: 0xe8735a, coralDeep: 0xc4523e, cream: 0xf1e3c6, sand: 0xd9c7a0,
	lacquer: 0xb23f2d, gold: 0xd9a441, timber: 0x8a6a48, timberDark: 0x5e4632, rope: 0x9a8058,
	stone: 0xcfc2a6, ink: 0x1d2328, silver: 0xa9b8bd,
};

export const GLOW = 2; // aux.w offset of the self-lit parts

// Collects prepared geometries per bucket ('solid', 'cloth') and merges them.
export class Kit {

	constructor() {

		this.buckets = new Map();
		this.triangles = 0;

	}

	add( bucket, geo, opts = {} ) {

		const g = prepare( geo, opts );
		if ( ! this.buckets.has( bucket ) ) this.buckets.set( bucket, [] );
		this.buckets.get( bucket ).push( g );
		this.triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
		return g;

	}

	merged( bucket ) {

		const list = this.buckets.get( bucket );
		return list && list.length ? mergePrepared( list ) : null;

	}

}

// matrix: local +y along `dir`, local +z toward `up` (orthonormalised), at `pos`
export function basis( pos, dir, up = new Vector3( 0, 1, 0 ) ) {

	const y = dir.clone().normalize();
	const x = new Vector3().crossVectors( y, up );
	if ( x.lengthSq() < 1e-8 ) x.set( 1, 0, 0 );
	x.normalize();
	const z = new Vector3().crossVectors( x, y ).normalize();
	return new Matrix4().makeBasis( x, y, z ).setPosition( pos );

}

// recolour / re-aux a geometry by vertex (before prepare; prepare keeps existing attributes)
export function paint( g, fn ) {

	const p = g.attributes.position, n = p.count;
	const col = new Float32Array( n * 3 ), aux = new Float32Array( n * 4 );
	const v = new Vector3();
	for ( let i = 0; i < n; i ++ ) {

		v.fromBufferAttribute( p, i );
		const [ c, a ] = fn( v, i );
		col[ i * 3 ] = c.r; col[ i * 3 + 1 ] = c.g; col[ i * 3 + 2 ] = c.b;
		aux.set( a, i * 4 );

	}

	g.setAttribute( 'color', new Float32BufferAttribute( col, 3 ) );
	g.setAttribute( 'aux', new Float32BufferAttribute( aux, 4 ) );
	return g;

}

// a flat triangle list (both faces) from [ [a, b, c], ... ] Vector3 triples, with a per-vertex anim weight
export function triangles( tris, weightFn = () => 0 ) {

	const pos = [], nrm = [], aw = [];
	const e1 = new Vector3(), e2 = new Vector3(), n = new Vector3();
	for ( const [ a, b, c ] of tris ) {

		e1.subVectors( b, a ); e2.subVectors( c, a );
		n.crossVectors( e1, e2 ).normalize();
		for ( const [ p, s ] of [ [ a, 1 ], [ b, 1 ], [ c, 1 ], [ a, - 1 ], [ c, - 1 ], [ b, - 1 ] ] ) {

			pos.push( p.x, p.y, p.z );
			nrm.push( n.x * s, n.y * s, n.z * s );
			aw.push( weightFn( p ) );

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nrm, 3 ) );
	g.userData = { weights: aw };
	return g;

}

// ---------------------------------------------------------------- the carved fish
// Body: a lathe along +y (tail at 0, nose at L), flattened sideways (x); dorsal side +z. Fins: squashed
// spheres. bend > 0 arches the back ('z') or curls it sideways ('x') about the body's middle (radians over
// its length). Returns { parts: [ { geo, role } ] } in the fish frame; role: body | fin | eye | pupil.
export function fishParts( L, R, { bend = 0, plane = 'z', width = 0.62, segs = 14, lite = false } = {} ) {

	const prof = [ [ 0.12, 0 ], [ 0.2, 0.07 ], [ 0.48, 0.24 ], [ 0.84, 0.44 ], [ 1.0, 0.6 ], [ 0.93, 0.76 ], [ 0.68, 0.9 ], [ 0.34, 0.975 ], [ 0.0, 1.0 ] ];
	const body = lathe( prof.map( ( [ r, y ] ) => [ r * R, y * L ] ), segs );
	body.applyMatrix4( new Matrix4().makeScale( width, 1, 1 ) );
	const fin = ( sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0 ) => {

		const g = lite ? sphere( 1, 6, 4 ) : sphere( 1, 10, 6 );
		g.applyMatrix4( mat4( x, y, z, rx, ry, rz, sx, sy, sz ) );
		return g;

	};

	const parts = [ { geo: body, role: 'body' } ];
	// forked tail, dorsal fin, two pectorals
	for ( const s of [ - 1, 1 ] ) parts.push( { geo: fin( 0.025, 0.26 * L, 0.07 * L, 0, - 0.06 * L, s * 0.07 * L, s * 0.75 ), role: 'fin' } );
	parts.push( { geo: fin( 0.022, 0.26 * L, 0.1 * L, 0, 0.52 * L, R * 0.92, - 0.25 ), role: 'fin' } );
	// (lite: small fish seen from afar, no pectorals or eyes)
	if ( ! lite ) for ( const s of [ - 1, 1 ] ) parts.push( { geo: fin( 0.16 * L, 0.11 * L, 0.02, s * R * width * 0.95, 0.66 * L, - R * 0.45, 0.5, 0, s * 0.5 ), role: 'fin' } );
	// eyes (gold) with ink pupils
	if ( ! lite ) for ( const s of [ - 1, 1 ] ) {

		const ex = s * R * width * 0.62, ey = 0.86 * L, ez = R * 0.3;
		parts.push( { geo: fin( 0.07 * R, 0.07 * R, 0.07 * R, ex, ey, ez ), role: 'eye' } );
		parts.push( { geo: fin( 0.035 * R, 0.035 * R, 0.035 * R, ex + s * 0.045 * R, ey + 0.012 * L, ez ), role: 'pupil' } );

	}

	if ( bend ) for ( const p of parts ) bendY( p.geo, L, bend, plane );
	return parts;

}

// bends a geometry laid along +y (0..L) about its middle: the curvature centre on -z ('z': arched back) or
// -x ('x': curling sideways), total angle `bend`
export function bendY( g, L, bend, plane = 'z' ) {

	const Rb = L / bend, p = g.attributes.position, nAttr = g.attributes.normal;
	const v = new Vector3();
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		const phi = ( v.y - L / 2 ) / Rb;
		const c = Math.cos( phi ), s = Math.sin( phi );
		if ( plane === 'z' ) {

			const rho = Rb + v.z;
			p.setXYZ( i, v.x, L / 2 + rho * s, - Rb + rho * c );
			if ( nAttr ) { v.fromBufferAttribute( nAttr, i ); nAttr.setXYZ( i, v.x, v.y * c + v.z * s, - v.y * s + v.z * c ); }

		} else {

			const rho = Rb + v.x;
			p.setXYZ( i, - Rb + rho * c, L / 2 + rho * s, v.z );
			if ( nAttr ) { v.fromBufferAttribute( nAttr, i ); nAttr.setXYZ( i, v.x * c - v.y * s, v.x * s + v.y * c, v.z ); }

		}

	}

	p.needsUpdate = true;
	return g;

}

// adds a fish to the kit with a frame matrix (fish +y = nose, +z = back)
export function addFish( kit, matrix, L, R, opts = {} ) {

	const { color = PALETTE.jade, fin = PALETTE.jadeLight, rough = 0.32, eye = PALETTE.gold, metal = 0, bucket = 'solid' } = opts;
	for ( const { geo, role } of fishParts( L, R, opts ) ) {

		geo.applyMatrix4( matrix );
		const c = role === 'body' ? color : role === 'fin' ? fin : role === 'eye' ? eye : PALETTE.ink;
		kit.add( bucket, geo, { color: c, rough: role === 'pupil' ? 0.2 : rough, metal: role === 'eye' ? 0.6 : metal } );

	}

}

// ---------------------------------------------------------------- roof
// A hip roof over a rectangle (half extents hx, hz in its own frame, eaves at y0) rising `h` to a short
// ridge along x, concave in section, corners lifted by `lift`, tile channels every `tile` m. `frame` maps
// the roof frame to the world. Adds the glazed top, the timber soffit underneath and a ridge beam.
export function addRoof( kit, frame, { hx, hz, y0, h, ridge = 0.35, lift = 0.45, tile = 0.32, rings = 9, color = PALETTE.roofJade, soffit = 0xa8865e, ridgeColor = PALETTE.jadeDeep } ) {

	const perim = 4 * ( hx + hz );
	const nj = Math.max( 32, Math.round( perim / ( tile / 2 ) ) & ~ 1 );
	const loop = ( t, sink ) => {

		// rectangle half extents shrinking toward the ridge (x keeps `ridge` of its length)
		const ax = hx + ( hx * ridge - hx ) * Math.pow( t, 0.85 ), az = hz * ( 1 - Math.pow( t, 0.85 ) * 0.97 );
		const y = y0 + h * Math.pow( t, 1.7 ) - sink;
		const out = [];
		for ( let j = 0; j < nj; j ++ ) {

			// walk the perimeter by arc length
			const s = j / nj * 2 * ( ax + az ) * 2;
			let x, z, nx, nz;
			const L1 = 2 * ax, L2 = 2 * az;
			if ( s < L1 ) { x = - ax + s; z = az; nx = 0; nz = 1; } else if ( s < L1 + L2 ) { x = ax; z = az - ( s - L1 ); nx = 1; nz = 0; } else if ( s < 2 * L1 + L2 ) { x = ax - ( s - L1 - L2 ); z = - az; nx = 0; nz = - 1; } else { x = - ax; z = - az + ( s - 2 * L1 - L2 ); nx = - 1; nz = 0; }
			// corner lift: strongest at the eave corners, fading up the hips
			const cx = Math.abs( x ) / Math.max( ax, 1e-3 ), cz = Math.abs( z ) / Math.max( az, 1e-3 );
			const corner = Math.pow( Math.min( cx, cz ), 6 );
			// tile channels (alternate in / out along the slope direction)
			const ch = ( j & 1 ) ? 0.045 * ( 1 - t * 0.6 ) : 0;
			out.push( new Vector3( x + nx * ch * 0.3, y + corner * lift * Math.pow( 1 - t, 1.6 ) - ch, z + nz * ch * 0.3 ) );

		}

		return out;

	};

	const top = [], under = [];
	for ( let i = 0; i <= rings; i ++ ) {

		const t = i / rings;
		top.push( loop( t, 0 ) );
		under.push( loop( t, 0.12 ).map( ( p ) => p.clone() ) );

	}

	const gTop = gridSurface( top, { closeJ: true } );
	const gUnder = gridSurface( under, { closeJ: true, flip: true } );
	// tiles darken toward the eaves where the rain runs off
	const rc = lin( color );
	paint( gTop, ( p ) => {

		const k = 0.82 + 0.18 * Math.min( 1, Math.max( 0, ( p.y - y0 ) / h ) );
		return [ { r: rc.r * k, g: rc.g * k, b: rc.b * k }, [ 0.38, 0.05, PAT.plain, 0 ] ];

	} );
	gTop.applyMatrix4( frame );
	gUnder.applyMatrix4( frame );
	kit.add( 'solid', gTop );
	kit.add( 'solid', gUnder, { color: soffit, rough: 0.85, pattern: PAT.wood } );
	// a fascia strip along the eaves (closes the gap between top and soffit) and the ridge beam
	const eave = top[ 0 ], eaveU = under[ 0 ];
	const rows = [ eave, eaveU ];
	const fascia = gridSurface( rows, { closeJ: true } );
	fascia.applyMatrix4( frame );
	kit.add( 'solid', fascia, { color: PALETTE.coralDeep, rough: 0.6 } );
	const yr = y0 + h;
	const rb = box( 2 * hx * ridge + 0.5, 0.22, 0.26 );
	rb.applyMatrix4( new Matrix4().multiplyMatrices( frame, mat4( 0, yr + 0.06, 0 ) ) );
	kit.add( 'solid', rb, { color: ridgeColor, rough: 0.35 } );
	// ridge-end finials: little upturned jade fish tails
	for ( const s of [ - 1, 1 ] ) {

		const f = cylinder( 0.02, 0.12, 0.55, 8 );
		f.applyMatrix4( new Matrix4().multiplyMatrices( frame, mat4( s * ( hx * ridge + 0.2 ), yr + 0.35, 0, 0, 0, - s * 0.45 ) ) );
		kit.add( 'solid', f, { color: PALETTE.jadeLight, rough: 0.3 } );

	}

	return { eaveCorners: [ [ - hx, hz ], [ hx, hz ], [ hx, - hz ], [ - hx, - hz ] ].map( ( [ x, z ] ) => new Vector3( x, y0 + lift, z ).applyMatrix4( frame ) ) };

}

// ---------------------------------------------------------------- strings, lanterns, bunting, hammock

// points of a sagging line between a and b (Vector3)
export function sag( a, b, depth, n = 10 ) {

	const out = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		out.push( new Vector3().lerpVectors( a, b, t ).setY( a.y + ( b.y - a.y ) * t - depth * 4 * t * ( 1 - t ) ) );

	}

	return out;

}

// a cord through points (thin rods)
export function addCord( kit, pts, r = 0.012, color = PALETTE.rope, bucket = 'solid' ) {

	for ( let i = 0; i < pts.length - 1; i ++ ) kit.add( bucket, rod( pts[ i ], pts[ i + 1 ], r, 4 ), { color, rough: 0.9, pattern: PAT.cloth } );

}

// a round paper lantern hanging with its top at `top` (Vector3); returns its centre
const LANTERN_COLORS = [ PALETTE.coral, PALETTE.cream, PALETTE.jadeLight ];
export function addLantern( kit, top, size = 0.22, colorIndex = 0 ) {

	const c = new Vector3( top.x, top.y - 0.06 - size * 1.05, top.z );
	const body = sphere( size, 12, 8 );
	body.applyMatrix4( mat4( c.x, c.y, c.z, 0, 0, 0, 1, 1.12, 1 ) );
	// faint ribs: darken rings by latitude
	const col = lin( LANTERN_COLORS[ colorIndex % 3 ] );
	paint( body, ( p ) => {

		const k = 0.88 + 0.12 * Math.abs( Math.cos( ( p.y - c.y ) / size * 9 ) );
		return [ { r: col.r * k, g: col.g * k, b: col.b * k }, [ 0.7, 0, PAT.cloth, GLOW ] ];

	} );
	kit.add( 'solid', body );
	for ( const s of [ - 1, 1 ] ) {

		const cap = cylinder( size * 0.42, size * 0.42, 0.05, 10 );
		cap.applyMatrix4( mat4( c.x, c.y + s * size * 1.1, c.z ) );
		kit.add( 'solid', cap, { color: PALETTE.ink, rough: 0.5 } );

	}

	kit.add( 'solid', rod( new Vector3( c.x, c.y + size * 1.12, c.z ), top, 0.006, 3 ), { color: PALETTE.ink, rough: 0.6 } );
	// a short tassel below
	kit.add( 'cloth', rod( new Vector3( c.x, c.y - size * 1.12, c.z ), new Vector3( c.x, c.y - size * 1.12 - 0.16, c.z ), 0.012, 4, 0.004 ), { color: PALETTE.coralDeep, rough: 0.9, anim: 0.6 } );
	return c;

}

// a lantern string from a to b: the cord and `n` lanterns along it; returns the lantern centres
export function addLanternString( kit, a, b, { depth = 0.5, n = 5, size = 0.2, offset = 0 } = {} ) {

	const pts = sag( a, b, depth, 16 );
	addCord( kit, pts, 0.008, PALETTE.ink );
	const out = [];
	for ( let i = 0; i < n; i ++ ) {

		const t = ( i + 1 ) / ( n + 1 );
		const p = new Vector3().lerpVectors( a, b, t ).setY( a.y + ( b.y - a.y ) * t - depth * 4 * t * ( 1 - t ) );
		out.push( addLantern( kit, p, size * ( i % 2 ? 0.85 : 1 ), i + offset ) );

	}

	return out;

}

// triangular pennants under a sagging line (cloth bucket, swaying)
const BUNTING_COLORS = [ PALETTE.coral, PALETTE.cream, PALETTE.jade, PALETTE.gold ];
export function addBunting( kit, a, b, { depth = 0.35, spacing = 0.42, size = 0.3, offset = 0 } = {} ) {

	const pts = sag( a, b, depth, 16 );
	addCord( kit, pts, 0.007 );
	const len = a.distanceTo( b );
	const n = Math.max( 2, Math.floor( len / spacing ) );
	const along = new Vector3().subVectors( b, a ).setY( 0 ).normalize();
	for ( let i = 1; i < n; i ++ ) {

		const t = i / n;
		const p = new Vector3().lerpVectors( a, b, t ).setY( a.y + ( b.y - a.y ) * t - depth * 4 * t * ( 1 - t ) );
		const half = along.clone().multiplyScalar( size * 0.42 );
		const tip = p.clone().add( new Vector3( 0, - size, 0 ) );
		const g = triangles( [ [ p.clone().sub( half ), p.clone().add( half ), tip ] ], ( q ) => Math.min( 1, ( p.y - q.y ) / size ) );
		const c = lin( BUNTING_COLORS[ ( i + offset ) % 4 ] );
		const w = g.userData.weights;
		paint( g, ( q, k ) => [ c, [ 0.9, 0, PAT.cloth, w[ k ] ] ] );
		kit.add( 'cloth', g );

	}

}

// a striped hammock slung between two posts' tops a and b (Vector3), the posts, ropes and spreader bars
const STRIPES = [ PALETTE.coral, PALETTE.cream, PALETTE.jade, PALETTE.cream ];
export function addHammock( kit, a, b, { width = 1.0, sagDepth = 0.75 } = {} ) {

	const along = new Vector3().subVectors( b, a );
	const len = along.length();
	along.normalize();
	const side = new Vector3( - along.z, 0, along.x ).normalize();
	const inset = 0.45; // rope from the post to the spreader bar
	const ni = 14, nj = 9;
	const rows = [];
	for ( let i = 0; i <= ni; i ++ ) {

		const t = i / ni;
		const d = inset + t * ( len - 2 * inset );
		const base = a.clone().addScaledVector( along, d );
		const tt = d / len;
		base.y = a.y + ( b.y - a.y ) * tt - sagDepth * 4 * tt * ( 1 - tt );
		const row = [];
		for ( let j = 0; j <= nj; j ++ ) {

			const s = j / nj * 2 - 1;
			// spread at the bars, a little gathered between, a trough across
			const w = width / 2 * ( 0.92 + 0.08 * Math.sin( Math.PI * t ) );
			row.push( base.clone().addScaledVector( side, s * w ).add( new Vector3( 0, - 0.16 * ( 1 - s * s ) * Math.sin( Math.PI * t ), 0 ) ) );

		}

		rows.push( row );

	}

	for ( const flip of [ false, true ] ) {

		const g = gridSurface( rows, { flip } );
		paint( g, ( p, k ) => {

			const j = k % ( nj + 1 );
			return [ lin( STRIPES[ Math.floor( j / ( nj + 1 ) * 8 ) % 4 ] ), [ 0.9, 0, PAT.cloth, 0.12 ] ];

		} );
		kit.add( 'cloth', g );

	}

	// spreader bars and the ropes fanning to the post rings
	for ( const end of [ 0, ni ] ) {

		const r = rows[ end ];
		kit.add( 'solid', rod( r[ 0 ].clone().addScaledVector( side, - 0.05 ), r[ nj ].clone().addScaledVector( side, 0.05 ), 0.025, 6 ), { color: PALETTE.timber, rough: 0.8, pattern: PAT.wood } );
		const tie = end === 0 ? a : b;
		for ( const j of [ 0, 3, 6, 9 ] ) addCord( kit, [ r[ j ], tie ], 0.008 );

	}

}

// sRGB hex -> linear rgb (what paint() writes; prepare() converts hex colours itself)
const _c = new Color();
export function lin( hex ) {

	const c = _c.set( hex );
	return { r: c.r, g: c.g, b: c.b };

}
