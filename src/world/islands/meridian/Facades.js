import { BufferGeometry, Float32BufferAttribute, Color } from '../../../engine/index.js';
import { standard } from '../../../materials/Materials.js';
import { ShaderModule } from '../../../engine/gpu/Shader.js';

// Meridian's buildings (wave 21A): one material for every facade in the city and the geometry that feeds it. No textures:
// the windows are drawn by the material from the facade coordinates (uv = metres along the wall, metres above the
// building's ground), the style code, the floor height and the bay width each vertex carries, so 340 buildings share one
// shader and merge into a handful of meshes. The pattern fades to its average where a window is smaller than a pixel (no
// shimmer on the skyline), windows light up at night per building and per window (frame.night), damage stages darken,
// break and (stage 2) glow the windows from inside.
//
//   createFacadeMaterial( name )      the material (vertex colour = the wall's albedo, aux = ( style, floor height (< 0:
//                                     the building's front face), bay width, stage + seed * 0.9 ))
//   new Acc()                         a geometry accumulator: quad / wall / box / prism / cylinder / roofHip; .geometry()
//   buildingInto( acc, b, { detail, stage } ) -> { top, tiers }   one plan building (meridian/CityPlan.js) into acc
//   STYLE, styleColor( b )            the style codes, a building's wall colour (deterministic from its id)
//
// Style codes (aux.x): the facade families of CityPlan.STYLES, then plain parts: 90 plain wall, 91 flat roof, 92 metal,
// 93 dark glass panel, 94 awning cloth, 95 lit sign, 96 terracotta roof, 97 granite paving, 98 asphalt, 99 pavement slabs,
// 89 road paint.

export const STYLE = {
	pinstripe: 0, glass: 1, glassBlue: 2, stone: 3, concrete: 4, brick: 5, brickRed: 6, stucco: 7, shopfront: 8, warehouse: 9,
	villa: 10, civic: 11, station: 12, terminal: 13, hangar: 14, garage: 15, lighthouse: 16, market: 17,
	paint: 89, plain: 90, roof: 91, metal: 92, panel: 93, cloth: 94, sign: 95, tiles: 96, granite: 97, asphalt: 98, pavement: 99,
};

// floor height and bay (window spacing) per style
const GRID = {
	pinstripe: [ 3.66, 1.02 ], glass: [ 3.8, 1.5 ], glassBlue: [ 3.8, 1.5 ], stone: [ 3.6, 3.0 ], concrete: [ 3.4, 3.2 ], brick: [ 3.2, 2.9 ],
	brickRed: [ 3.2, 2.9 ], stucco: [ 3.2, 3.3 ], shopfront: [ 3.4, 3.0 ], warehouse: [ 5.5, 6.0 ], villa: [ 3.2, 3.8 ], civic: [ 6.0, 4.4 ],
	station: [ 11, 5.0 ], terminal: [ 7, 3.2 ], hangar: [ 8, 6 ], garage: [ 3.5, 6 ], lighthouse: [ 5, 3.0 ], market: [ 5, 4.0 ],
};

const C = ( hex ) => new Color( hex ); // linear from sRGB hex
const PALETTE = {
	pinstripe: [ 0xc4c8cc ], glass: [ 0x5f676d, 0x4f585f ], glassBlue: [ 0x8a96a0, 0x7b8790 ], stone: [ 0xc8b9a0, 0xb8ab92, 0xd6cbb6, 0xbfae8f ],
	concrete: [ 0xa9a7a0, 0x9a9893, 0xb3aea4 ], brick: [ 0x8a5a44, 0x7a4a38, 0x9b6a4f ], brickRed: [ 0x8f3f2e, 0x7f3a2b ],
	stucco: [ 0xd9cdb6, 0xe3d6c0, 0xcfbfa5, 0xd8c2a0, 0xc9b8a8 ], shopfront: [ 0x8a5a44, 0xd9cdb6, 0x9e8a70, 0x6f6a62 ],
	warehouse: [ 0x7d8580, 0x8a6f5a, 0x5f7380, 0x96805e, 0x6d7a6a ], villa: [ 0xece6da, 0xe9dcc4, 0xf1ece2 ], civic: [ 0xd8d2c4 ],
	station: [ 0xb59b7a ], terminal: [ 0xdfe3e6 ], hangar: [ 0x8d959b ], garage: [ 0xa3a19b ], lighthouse: [ 0xf2f0ea ], market: [ 0x9a5b45 ],
};
const ROOF = [ 0x5c5d5f, 0x6e6c68, 0x7d7b76, 0x55575a ];

const hashStr = ( s ) => {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return ( h >>> 0 ) / 4294967296;

};

export function styleColor( b ) {

	const p = PALETTE[ b.style ] || PALETTE.concrete;
	return C( p[ Math.floor( hashStr( b.id ) * p.length ) % p.length ] );

}

export function seedOf( b ) {

	return hashStr( b.id + ':s' );

}

// ------------------------------------------------------------------ geometry accumulator

export class Acc {

	constructor() {

		this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.aux = []; this.idx = [];

	}

	get count() {

		return this.pos.length / 3;

	}

	_v( p, n, u, v, c, a ) {

		this.pos.push( p[ 0 ], p[ 1 ], p[ 2 ] );
		this.nrm.push( n[ 0 ], n[ 1 ], n[ 2 ] );
		this.uv.push( u, v );
		this.col.push( c.r, c.g, c.b );
		this.aux.push( a[ 0 ], a[ 1 ], a[ 2 ], a[ 3 ] );

	}

	// a, b, c, d counter-clockwise seen from the front; uvs [ [ u, v ] x 4 ]
	quad( a, b, c, d, n, uvs, col, aux ) {

		const i = this.count;
		this._v( a, n, uvs[ 0 ][ 0 ], uvs[ 0 ][ 1 ], col, aux );
		this._v( b, n, uvs[ 1 ][ 0 ], uvs[ 1 ][ 1 ], col, aux );
		this._v( c, n, uvs[ 2 ][ 0 ], uvs[ 2 ][ 1 ], col, aux );
		this._v( d, n, uvs[ 3 ][ 0 ], uvs[ 3 ][ 1 ], col, aux );
		this.idx.push( i, i + 1, i + 2, i, i + 2, i + 3 );

	}

	tri( a, b, c, n, col, aux ) {

		const i = this.count;
		this._v( a, n, 0, 0, col, aux ); this._v( b, n, 0, 0, col, aux ); this._v( c, n, 0, 0, col, aux );
		this.idx.push( i, i + 1, i + 2 );

	}

	// a wall from P (left, seen from outside) to Q (right), y0..y1; v measured from vBase; u from u0
	wall( px, pz, qx, qz, y0, y1, vBase, col, aux, u0 = 0 ) {

		const L = Math.hypot( qx - px, qz - pz );
		if ( L < 1e-4 || y1 <= y0 ) return;
		const n = [ - ( qz - pz ) / L, 0, ( qx - px ) / L ];
		this.quad( [ px, y0, pz ], [ qx, y0, qz ], [ qx, y1, qz ], [ px, y1, pz ], n,
			[ [ u0, y0 - vBase ], [ u0 + L, y0 - vBase ], [ u0 + L, y1 - vBase ], [ u0, y1 - vBase ] ], col, aux );

	}

	// a flat horizontal quad (roof, slab) facing up
	flat( x0, x1, z0, z1, y, col, aux ) {

		this.quad( [ x0, y, z0 ], [ x0, y, z1 ], [ x1, y, z1 ], [ x1, y, z0 ], [ 0, 1, 0 ], [ [ x0, z0 ], [ x0, z1 ], [ x1, z1 ], [ x1, z0 ] ], col, aux );

	}

	// an axis aligned box: 4 walls (+ top); faceAux( side ) may return a different aux per side ('s','e','n','w')
	box( x0, x1, z0, z1, y0, y1, vBase, col, aux, { top = true, topCol = col, topAux = aux, faceAux = null, bottom = false } = {} ) {

		const A = ( s ) => ( faceAux ? faceAux( s ) || aux : aux );
		this.wall( x0, z1, x1, z1, y0, y1, vBase, col, A( 's' ) );
		this.wall( x1, z1, x1, z0, y0, y1, vBase, col, A( 'e' ) );
		this.wall( x1, z0, x0, z0, y0, y1, vBase, col, A( 'n' ) );
		this.wall( x0, z0, x0, z1, y0, y1, vBase, col, A( 'w' ) );
		if ( top ) this.flat( x0, x1, z0, z1, y1, topCol, topAux );
		if ( bottom ) this.quad( [ x0, y0, z0 ], [ x1, y0, z0 ], [ x1, y0, z1 ], [ x0, y0, z1 ], [ 0, - 1, 0 ], [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ], col, aux );

	}

	// a vertical prism over a closed outline [ [ x, z ] ... ] (counter-clockwise seen from above: x right, z down the page),
	// the facade u running on round it
	prism( outline, y0, y1, vBase, col, aux, { top = true, topCol = col, topAux = aux } = {} ) {

		let u = 0;
		const n = outline.length;
		for ( let k = 0; k < n; k ++ ) {

			const [ px, pz ] = outline[ k ], [ qx, qz ] = outline[ ( k + 1 ) % n ];
			this.wall( px, pz, qx, qz, y0, y1, vBase, col, aux, u );
			u += Math.hypot( qx - px, qz - pz );

		}

		if ( top ) {

			const i0 = this.count;
			const cx = outline.reduce( ( s, p ) => s + p[ 0 ], 0 ) / n, cz = outline.reduce( ( s, p ) => s + p[ 1 ], 0 ) / n;
			this._v( [ cx, y1, cz ], [ 0, 1, 0 ], cx, cz, topCol, topAux );
			for ( const [ x, z ] of outline ) this._v( [ x, y1, z ], [ 0, 1, 0 ], x, z, topCol, topAux );
			for ( let k = 0; k < n; k ++ ) this.idx.push( i0, i0 + 1 + k, i0 + 1 + ( ( k + 1 ) % n ) ); // (the outline runs clockwise in x / z)

		}

	}

	cylinder( x, z, r0, r1, y0, y1, seg, col, aux, { top = true } = {} ) {

		const i0 = this.count;
		for ( let k = 0; k <= seg; k ++ ) {

			const a = k / seg * Math.PI * 2, c = Math.cos( a ), s = Math.sin( a );
			this._v( [ x + c * r0, y0, z + s * r0 ], [ c, 0, s ], a * r0, 0, col, aux );
			this._v( [ x + c * r1, y1, z + s * r1 ], [ c, 0, s ], a * r1, y1 - y0, col, aux );

		}

		for ( let k = 0; k < seg; k ++ ) {

			const a = i0 + k * 2;
			this.idx.push( a, a + 1, a + 3, a, a + 3, a + 2 );

		}

		if ( top && r1 > 0 ) {

			const c0 = this.count;
			this._v( [ x, y1, z ], [ 0, 1, 0 ], 0, 0, col, aux );
			for ( let k = 0; k < seg; k ++ ) {

				const a = k / seg * Math.PI * 2;
				this._v( [ x + Math.cos( a ) * r1, y1, z + Math.sin( a ) * r1 ], [ 0, 1, 0 ], 0, 0, col, aux );

			}

			for ( let k = 0; k < seg; k ++ ) this.idx.push( c0, c0 + 1 + ( ( k + 1 ) % seg ), c0 + 1 + k );

		}

	}

	sphere( x, y, z, r, seg, rings, col, aux ) {

		const i0 = this.count;
		for ( let j = 0; j <= rings; j ++ ) {

			const t = j / rings * Math.PI, sy = Math.cos( t ), sr = Math.sin( t );
			for ( let k = 0; k <= seg; k ++ ) {

				const a = k / seg * Math.PI * 2, nx = Math.cos( a ) * sr, nz = Math.sin( a ) * sr;
				this._v( [ x + nx * r, y + sy * r, z + nz * r ], [ nx, sy, nz ], k / seg * 6, j / rings * 3, col, aux );

			}

		}

		for ( let j = 0; j < rings; j ++ ) for ( let k = 0; k < seg; k ++ ) {

			const a = i0 + j * ( seg + 1 ) + k, b = a + seg + 1;
			this.idx.push( a, a + 1, b, a + 1, b + 1, b );

		}

	}

	// a hip roof over a box (villas, the market hall)
	roofHip( x0, x1, z0, z1, y, rise, col, aux, overhang = 0.5 ) {

		x0 -= overhang; x1 += overhang; z0 -= overhang; z1 += overhang;
		const w = x1 - x0, d = z1 - z0, r = Math.min( w, d ) / 2;
		const along = w >= d; // the ridge runs along the longer side
		const cx = ( x0 + x1 ) / 2, cz = ( z0 + z1 ) / 2;
		const ra = along ? [ x0 + r, y + rise, cz ] : [ cx, y + rise, z0 + r ], rb = along ? [ x1 - r, y + rise, cz ] : [ cx, y + rise, z1 - r ];
		const A = [ x0, y, z0 ], B = [ x1, y, z0 ], Cc = [ x1, y, z1 ], D = [ x0, y, z1 ];
		const nrm = ( a, b, c ) => {

			const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ], vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
			const n = [ uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ], l = Math.hypot( ...n ) || 1;
			return [ n[ 0 ] / l, n[ 1 ] / l, n[ 2 ] / l ];

		};
		const face = ( a, b, c, d ) => this.quad( a, b, c, d, nrm( a, b, c ), [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ], col, aux );
		if ( along ) {

			face( D, Cc, rb, ra ); // south slope
			face( B, A, ra, rb ); // north slope
			this.tri( A, D, ra, nrm( A, D, ra ), col, aux ); // west hip
			this.tri( Cc, B, rb, nrm( Cc, B, rb ), col, aux ); // east hip

		} else {

			face( Cc, B, ra, rb ); // east slope (the ridge along z)
			face( A, D, rb, ra );
			this.tri( D, Cc, rb, nrm( D, Cc, rb ), col, aux );
			this.tri( B, A, ra, nrm( B, A, ra ), col, aux );

		}

	}

	geometry() {

		const g = new BufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( new Float32Array( this.pos ), 3 ) );
		g.setAttribute( 'normal', new Float32BufferAttribute( new Float32Array( this.nrm ), 3 ) );
		g.setAttribute( 'uv', new Float32BufferAttribute( new Float32Array( this.uv ), 2 ) );
		g.setAttribute( 'color', new Float32BufferAttribute( new Float32Array( this.col ), 3 ) );
		g.setAttribute( 'aux', new Float32BufferAttribute( new Float32Array( this.aux ), 4 ) );
		g.setIndex( this.idx );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;

	}

}

// ------------------------------------------------------------------ one building

const SINK = 2; // walls go this far under the ground (slopes, the far terrain's coarser grid)
const plainAux = ( code, seed = 0 ) => [ code, 3, 3, seed * 0.9 ];

// The tiers of a building (the far skyline uses them alone): [ { x0, x1, z0, z1, y0, y1 } ] in world metres
export function tiersOf( b ) {

	const q = Math.round( ( ( b.yaw % Math.PI ) + Math.PI ) % Math.PI / ( Math.PI / 2 ) ) % 2;
	const hx = ( q ? b.d : b.w ) / 2, hz = ( q ? b.w : b.d ) / 2;
	const y = b.y, top = y + b.h;
	const s = seedOf( b );
	if ( b.kind === 'highrise' && b.h > 70 ) {

		// one or two setbacks (the upper tiers narrower), more on the taller towers
		const n = b.h > 130 ? 2 : 1;
		const out = [];
		let x = hx, z = hz, y0 = y - SINK;
		const f = [ 0.62 + 0.12 * s, 0.84 + 0.08 * s ];
		for ( let k = 0; k <= n; k ++ ) {

			const y1 = k < n ? y + b.h * f[ k ] * ( n === 1 ? 1.05 : 1 ) : top;
			out.push( { x0: b.x - x, x1: b.x + x, z0: b.z - z, z1: b.z + z, y0, y1 } );
			y0 = y1;
			x = Math.max( 6, x - 3 - s * 4 ); z = Math.max( 6, z - 3 - s * 4 );

		}

		return out;

	}

	return [ { x0: b.x - hx, x1: b.x + hx, z0: b.z - hz, z1: b.z + hz, y0: y - SINK, y1: top } ];

}

// the tower's chamfered square outline (the Twins: 46 m, 2 m chamfers), counter-clockwise from above
export function towerOutline( b, c = 2.2 ) {

	const h = b.w / 2, x = b.x, z = b.z;
	return [ [ x - h + c, z + h ], [ x + h - c, z + h ], [ x + h, z + h - c ], [ x + h, z - h + c ], [ x + h - c, z - h ], [ x - h + c, z - h ], [ x - h, z - h + c ], [ x - h, z + h - c ] ];

}

// one plan building into acc. detail: the near extras (cornices, rooftop plant, water tanks, awnings, signs, the masts);
// stage: 0..3 (3 collapsed: only a stump of the ground floor walls; 21C's onStage adds the rubble)
export function buildingInto( acc, b, { detail = true, stage = 0 } = {} ) {

	const style = b.style, code = STYLE[ style ] ?? STYLE.concrete;
	const [ fh, bay ] = GRID[ style ] || GRID.concrete;
	const col = styleColor( b ), seed = seedOf( b );
	const st = stage;
	const aux = [ code, fh, bay, st + seed * 0.9 ];
	const front = [ code, - fh, bay, st + seed * 0.9 ];
	// the side facing the street (yaw: the front faces ( sin yaw, cos yaw ))
	const fs = Math.round( Math.sin( b.yaw ) ), fc = Math.round( Math.cos( b.yaw ) );
	const frontSide = fc > 0 ? 's' : fc < 0 ? 'n' : fs > 0 ? 'e' : 'w';
	const faceAux = ( s ) => ( s === frontSide ? front : null );
	const roofCol = C( ROOF[ Math.floor( seed * ROOF.length ) % ROOF.length ] );
	const roofAux = plainAux( STYLE.roof, seed );
	const out = { top: b.y + b.h, tiers: [] };

	if ( st >= 3 ) {

		// collapsed: the ground floor's broken walls (the rubble heap is 21C's, or the builder's default)
		const t = tiersOf( b )[ 0 ];
		const h = Math.min( 4, b.h * 0.15 );
		acc.box( t.x0, t.x1, t.z0, t.z1, t.y0, b.y + h, b.y, col.clone().multiplyScalar( 0.45 ), aux, { topCol: C( 0x3a3632 ), topAux: plainAux( STYLE.plain, seed ) } );
		out.top = b.y + h;
		out.tiers.push( { ...t, y1: b.y + h } );
		return out;

	}

	if ( b.kind === 'tower' ) {

		const ol = towerOutline( b );
		acc.prism( ol, b.y - SINK, b.y + b.h, b.y, col, aux, { topCol: C( 0x8d9094 ), topAux: plainAux( STYLE.metal, seed ) } );
		out.tiers.push( { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y0: b.y - SINK, y1: b.y + b.h } );
		// the roof: a parapet band, the plant room; the north tower's mast, the south tower's observation deck
		const top = b.y + b.h, h = b.w / 2 - 1.5;
		const metal = plainAux( STYLE.metal, seed ), mc = C( 0x9aa0a6 );
		acc.box( b.x - h + 6, b.x + h - 6, b.z - h + 6, b.z + h - 6, top, top + 6, top, C( 0x8e9398 ), plainAux( STYLE.plain, seed ) );
		if ( b.id === 'twin-north' ) {

			acc.cylinder( b.x, b.z, 2.2, 1.6, top + 6, top + 20, 10, mc, metal );
			acc.cylinder( b.x, b.z, 1.4, 0.35, top + 20, top + 62, 8, C( 0xd0d3d6 ), metal );
			for ( const y of [ top + 30, top + 42, top + 52 ] ) acc.cylinder( b.x, b.z, 2.0, 2.0, y, y + 0.6, 10, mc, metal ); // the antenna rings
			acc.cylinder( b.x, b.z, 0.5, 0.5, top + 62, top + 63, 6, C( 0xff2010 ), plainAux( STYLE.sign, seed ) ); // the aircraft warning light
			out.mastTop = top + 63;

		} else if ( detail ) {

			// the observation deck: a glazed pavilion and its railing round the roof
			acc.box( b.x - 9, b.x + 9, b.z - 6, b.z + 6, top + 6, top + 10, top + 6, C( 0x30404c ), plainAux( STYLE.panel, seed ) );
			const r = h - 1;
			for ( const [ px, pz, qx, qz ] of [ [ - r, r, r, r ], [ r, r, r, - r ], [ r, - r, - r, - r ], [ - r, - r, - r, r ] ] ) acc.wall( b.x + px, b.z + pz, b.x + qx, b.z + qz, top, top + 1.2, top, mc, metal );

		}

		return out;

	}

	const tiers = tiersOf( b );
	out.tiers = tiers;
	tiers.forEach( ( t, k ) => {

		const last = k === tiers.length - 1;
		acc.box( t.x0, t.x1, t.z0, t.z1, t.y0, t.y1, b.y, col, aux, { faceAux: k === 0 ? faceAux : null, topCol: roofCol, topAux: roofAux, top: true } );
		if ( ! detail ) return;
		// a cornice / parapet round each roof line (stone and brick read by it)
		if ( style !== 'glass' && style !== 'glassBlue' && style !== 'warehouse' && style !== 'hangar' && style !== 'villa' ) {

			const o = style === 'stone' || style === 'civic' ? 0.6 : 0.25;
			acc.box( t.x0 - o, t.x1 + o, t.z0 - o, t.z1 + o, t.y1, t.y1 + 0.9, t.y1, col.clone().multiplyScalar( 0.88 ), plainAux( STYLE.plain, seed ), { topCol: roofCol, topAux: roofAux } );

		}

		if ( last ) {

			const w = t.x1 - t.x0, d = t.z1 - t.z0, cx = ( t.x0 + t.x1 ) / 2, cz = ( t.z0 + t.z1 ) / 2;
			if ( style === 'villa' ) {

				acc.roofHip( t.x0, t.x1, t.z0, t.z1, t.y1, Math.min( w, d ) * 0.32, C( 0xa4553a ), plainAux( STYLE.tiles, seed ) );

			} else if ( style === 'market' ) {

				acc.roofHip( t.x0, t.x1, t.z0, t.z1, t.y1, Math.min( w, d ) * 0.25, C( 0x5c6670 ), plainAux( STYLE.metal, seed ) );

			} else if ( b.h > 12 ) {

				// rooftop plant room and units; a timber water tank on the brick midrises (the city's skyline)
				const mw = Math.min( 10, w * 0.35 ), md = Math.min( 8, d * 0.35 );
				acc.box( cx - mw / 2, cx + mw / 2, cz - md / 2, cz + md / 2, t.y1, t.y1 + 3.2, t.y1, C( 0x9a9892 ), plainAux( STYLE.plain, seed ), { topCol: roofCol, topAux: roofAux } );
				if ( ( style === 'brick' || style === 'brickRed' || style === 'stucco' ) && seed > 0.35 ) {

					const tx = t.x0 + w * 0.25, tz = t.z0 + d * 0.3;
					for ( const [ lx, lz ] of [ [ - 1.4, - 1.4 ], [ 1.4, - 1.4 ], [ 1.4, 1.4 ], [ - 1.4, 1.4 ] ] ) acc.box( tx + lx - 0.12, tx + lx + 0.12, tz + lz - 0.12, tz + lz + 0.12, t.y1, t.y1 + 3, t.y1, C( 0x3a3a3a ), plainAux( STYLE.metal, seed ), { top: false } );
					acc.cylinder( tx, tz, 2.1, 2.1, t.y1 + 3, t.y1 + 6.6, 10, C( 0x6e5238 ), plainAux( STYLE.plain, seed ) );
					acc.cylinder( tx, tz, 2.2, 0.2, t.y1 + 6.6, t.y1 + 8, 10, C( 0x4a3a2a ), plainAux( STYLE.plain, seed ), { top: false } );

				} else if ( seed < 0.5 ) {

					acc.box( cx + mw / 2 + 1.5, cx + mw / 2 + 5, cz - 2, cz + 2, t.y1, t.y1 + 1.8, t.y1, C( 0xb0b2b4 ), plainAux( STYLE.metal, seed ) );

				}

			}

		}

	} );

	if ( detail && b.sign ) shopFront( acc, b, tiers[ 0 ], frontSide, seed );
	return out;

}

// an awning over the shop windows and a sign board above it (lit at night)
const AWNINGS = [ 0x2f5d3a, 0x8c2f2a, 0x2a4a7a, 0x7a5a1e, 0x3b3b3b, 0x6a2c5a ];
const SIGNS = [ 0xf2e7c9, 0xe9c46a, 0xf4a261, 0x9fd3c7, 0xe76f51, 0xffffff ];
function shopFront( acc, b, t, side, seed ) {

	const y = b.y, ac = C( AWNINGS[ Math.floor( seed * 97 ) % AWNINGS.length ] ), sc = C( SIGNS[ Math.floor( seed * 53 ) % SIGNS.length ] );
	const cloth = plainAux( STYLE.cloth, seed ), sign = plainAux( STYLE.sign, seed );
	// along the front: P (left from outside) -> Q, outward normal n
	let P, Q, n;
	if ( side === 's' ) { P = [ t.x0, t.z1 ]; Q = [ t.x1, t.z1 ]; n = [ 0, 1 ]; }
	else if ( side === 'n' ) { P = [ t.x1, t.z0 ]; Q = [ t.x0, t.z0 ]; n = [ 0, - 1 ]; }
	else if ( side === 'e' ) { P = [ t.x1, t.z1 ]; Q = [ t.x1, t.z0 ]; n = [ 1, 0 ]; }
	else { P = [ t.x0, t.z0 ]; Q = [ t.x0, t.z1 ]; n = [ - 1, 0 ]; }
	const L = Math.hypot( Q[ 0 ] - P[ 0 ], Q[ 1 ] - P[ 1 ] ), tx = ( Q[ 0 ] - P[ 0 ] ) / L, tz = ( Q[ 1 ] - P[ 1 ] ) / L;
	const inset = 1.2, a0 = [ P[ 0 ] + tx * inset, P[ 1 ] + tz * inset ], a1 = [ Q[ 0 ] - tx * inset, Q[ 1 ] - tz * inset ];
	const out = 1.8;
	// the awning: a sloping quad from the wall at 3.6 m out to 1.8 m at 2.9 m, and its valance
	const hi = y + 3.6, lo = y + 2.9;
	const nn = [ n[ 0 ] * 0.36, 0.93, n[ 1 ] * 0.36 ];
	acc.quad( [ a0[ 0 ] + n[ 0 ] * out, lo, a0[ 1 ] + n[ 1 ] * out ], [ a1[ 0 ] + n[ 0 ] * out, lo, a1[ 1 ] + n[ 1 ] * out ], [ a1[ 0 ], hi, a1[ 1 ] ], [ a0[ 0 ], hi, a0[ 1 ] ], nn, [ [ 0, 0 ], [ L, 0 ], [ L, 1 ], [ 0, 1 ] ], ac, cloth );
	acc.quad( [ a0[ 0 ], hi, a0[ 1 ] ], [ a1[ 0 ], hi, a1[ 1 ] ], [ a1[ 0 ] + n[ 0 ] * out, lo, a1[ 1 ] + n[ 1 ] * out ], [ a0[ 0 ] + n[ 0 ] * out, lo, a0[ 1 ] + n[ 1 ] * out ], [ - nn[ 0 ], - nn[ 1 ], - nn[ 2 ] ], [ [ 0, 0 ], [ L, 0 ], [ L, 1 ], [ 0, 1 ] ], ac, cloth );
	acc.wall( a0[ 0 ] + n[ 0 ] * out, a0[ 1 ] + n[ 1 ] * out, a1[ 0 ] + n[ 0 ] * out, a1[ 1 ] + n[ 1 ] * out, lo - 0.35, lo, lo - 0.35, ac, cloth );
	// the sign board over the awning, 0.15 m off the wall
	const sw = Math.min( L - 2 * inset, 3 + seed * 6 ), m = [ ( P[ 0 ] + Q[ 0 ] ) / 2 + n[ 0 ] * 0.15, ( P[ 1 ] + Q[ 1 ] ) / 2 + n[ 1 ] * 0.15 ];
	acc.wall( m[ 0 ] - tx * sw / 2, m[ 1 ] - tz * sw / 2, m[ 0 ] + tx * sw / 2, m[ 1 ] + tz * sw / 2, y + 3.8, y + 4.7, y + 3.8, sc, sign );

}

// ------------------------------------------------------------------ the material

const FACADE_WGSL = /* wgsl */`
	let facadeAux = bitcast<vec4f>( in.vs.vFacadeAux );
	let style = facadeAux.x;
	let fhRaw = facadeAux.y;
	let isFront = fhRaw < 0.0;
	let fh = max( abs( fhRaw ), 0.5 );
	let bay = max( facadeAux.z, 0.2 );
	let stage = floor( facadeAux.w );
	let seed = fract( facadeAux.w );
	let uv = in.uv;
	let P = in.P;
	var col = in.color.rgb;
	var rough = 0.85;
	var metal = 0.0;
	var emis = vec3f( 0.0 );
	let nightK = smoothstep( 0.12, 0.6, frame.night );
	if ( style < 89.5 ) {
		// ---- a facade: the bay / floor grid and the window inside each cell
		var wx0 = 0.3; var wx1 = 0.7; var wy0 = 0.28; var wy1 = 0.78;
		var glass = vec3f( 0.05, 0.065, 0.075 );
		var gRough = 0.12; var gMetal = 0.15;
		var frameK = 0.8; // the window reveal / frame darkening round the glass
		var lit = 0.24; // share of windows lit at night
		var bayW = bay; var floorH = fh;
		var v = uv.y;
		if ( style < 0.5 ) {
			// the Twins: aluminium pinstripes, narrow full-height windows; the lobby's tall arches; the plant floors' louvres
			wx0 = 0.27; wx1 = 0.73; wy0 = 0.16; wy1 = 0.82;
			glass = vec3f( 0.055, 0.06, 0.068 ); gMetal = 0.3; gRough = 0.07;
			rough = 0.42; metal = 0.6; frameK = 0.92; lit = 0.22;
			if ( v < 22.0 ) { bayW = bay * 3.0; floorH = 22.0; wx0 = 0.12; wx1 = 0.88; wy0 = 0.05; wy1 = 0.9; }
		} else if ( style < 2.5 ) {
			// curtain walls: thin mullions, a spandrel band
			wx0 = 0.05; wx1 = 0.95; wy0 = 0.24; wy1 = 0.97;
			glass = select( vec3f( 0.04, 0.07, 0.07 ), vec3f( 0.035, 0.06, 0.1 ), style > 1.5 );
			gMetal = 0.35; gRough = 0.06; rough = 0.4; metal = 0.6; lit = 0.16;
		} else if ( style < 3.5 ) { wx0 = 0.28; wx1 = 0.72; wy0 = 0.25; wy1 = 0.8; frameK = 0.72; }
		else if ( style < 4.5 ) { wx0 = 0.06; wx1 = 0.94; wy0 = 0.32; wy1 = 0.78; frameK = 0.85; lit = 0.2; }
		else if ( style < 6.5 ) {
			wx0 = 0.3; wx1 = 0.7; wy0 = 0.25; wy1 = 0.82; frameK = 0.75; rough = 0.92;
			// brick courses
			let bu = uv.x * 4.4 + floor( v * 13.0 ) * 0.5;
			let mortar = max( 1.0 - smoothstep( 0.0, 0.08, fract( v * 13.0 ) ), 1.0 - smoothstep( 0.0, 0.05, fract( bu ) ) );
			let fwB = fwidth( v * 13.0 );
			col *= mix( 1.0, mix( 1.0, 0.8, mortar ) * mix( 0.9, 1.08, gpHash( vec3f( floor( bu ), floor( v * 13.0 ), seed ) ) ), 1.0 - smoothstep( 0.4, 1.0, fwB ) );
		}
		else if ( style < 7.5 ) { wx0 = 0.32; wx1 = 0.68; wy0 = 0.26; wy1 = 0.76; frameK = 0.78; }
		else if ( style < 8.5 ) { wx0 = 0.3; wx1 = 0.7; wy0 = 0.25; wy1 = 0.8; frameK = 0.75; }
		else if ( style < 9.5 || ( style > 13.5 && style < 14.5 ) ) {
			// corrugated sheds: ribs, high strip windows, a big door every other bay on the front
			let rib = sin( uv.x * 25.0 ) * ( 1.0 - smoothstep( 0.4, 1.2, fwidth( uv.x * 4.0 ) ) );
			col *= 0.92 + rib * 0.06;
			rough = 0.6; metal = 0.35;
			wx0 = 0.1; wx1 = 0.9; wy0 = 0.72; wy1 = 0.88; frameK = 0.9; lit = 0.2;
		}
		else if ( style < 10.5 ) { wx0 = 0.3; wx1 = 0.7; wy0 = 0.28; wy1 = 0.78; frameK = 0.6; lit = 0.45; }
		else if ( style < 11.5 ) { wx0 = 0.32; wx1 = 0.68; wy0 = 0.12; wy1 = 0.86; frameK = 0.7; lit = 0.5; }
		else if ( style < 13.5 ) { wx0 = 0.08; wx1 = 0.92; wy0 = 0.1; wy1 = 0.92; glass = vec3f( 0.06, 0.08, 0.09 ); gMetal = 0.3; lit = 0.7; }
		else if ( style < 15.5 ) {
			// the car park: open decks between the parapets
			wx0 = 0.04; wx1 = 0.96; wy0 = 0.38; wy1 = 0.95; glass = vec3f( 0.02 ); gMetal = 0.0; gRough = 0.9; lit = 0.9;
		}
		else if ( style < 16.5 ) {
			// the lighthouse: white, a red band, small windows
			if ( fract( v / 18.0 ) > 0.62 && v < 26.0 ) { col = vec3f( 0.55, 0.06, 0.04 ); }
			wx0 = 0.42; wx1 = 0.58; wy0 = 0.4; wy1 = 0.7; lit = 0.3;
		}
		else { wx0 = 0.12; wx1 = 0.88; wy0 = 0.55; wy1 = 0.92; frameK = 0.8; lit = 0.4; }
		// the shop front: the ground floor of the front face is display glass between pilasters, a door in the middle
		let shopGround = isFront && v < 3.6 && v > 0.0 && ( ( style > 7.5 && style < 8.5 ) || style > 16.5 );
		let fx = uv.x / bayW;
		let fy = v / floorH;
		var lx = fract( fx ); var ly = fract( fy );
		var cell = vec3f( floor( fx ), floor( fy ), seed * 61.0 );
		if ( shopGround ) { lx = fract( uv.x / 5.0 ); ly = v / 3.6; wx0 = 0.06; wx1 = 0.94; wy0 = 0.14; wy1 = 0.95; cell = vec3f( floor( uv.x / 5.0 ), -1.0, seed * 61.0 ); lit = 0.95; glass = vec3f( 0.08, 0.09, 0.1 ); }
		// the front door of an ordinary building (ground floor, the cell in the middle of the wall's bays)
		let inWinX = smoothstep( wx0 - 0.01, wx0, lx ) * ( 1.0 - smoothstep( wx1, wx1 + 0.01, lx ) );
		let inWinY = smoothstep( wy0 - 0.01, wy0, ly ) * ( 1.0 - smoothstep( wy1, wy1 + 0.01, ly ) );
		var inWin = inWinX * inWinY;
		// the plant floors of the Twins (two bands of louvres) and the ground: no glass below 0.6 m
		if ( style < 0.5 && ( abs( fy - 41.5 ) < 1.0 || abs( fy - 75.5 ) < 1.0 ) ) { inWin = 0.0; col *= 0.72; }
		if ( v < 0.6 ) { inWin = 0.0; col *= 0.62; }
		// where a window is under a pixel the pattern becomes its average (the skyline does not shimmer)
		let fw = max( fwidth( fx ), fwidth( fy ) );
		let blur = smoothstep( 0.3, 0.85, fw );
		let area = ( wx1 - wx0 ) * ( wy1 - wy0 ) * select( 1.0, 0.0, v < 0.6 );
		let win = mix( inWin, area, blur );
		// the frame round each window darker (the reveal)
		let nearWin = smoothstep( wx0 - 0.08, wx0, lx ) * ( 1.0 - smoothstep( wx1, wx1 + 0.08, lx ) ) * smoothstep( wy0 - 0.08, wy0, ly ) * ( 1.0 - smoothstep( wy1, wy1 + 0.08, ly ) );
		col *= mix( 1.0, frameK, nearWin * ( 1.0 - blur ) );
		// weathering: streaks down from the sills, a grime band at the street
		let streak = gpNoise( vec3f( uv.x * 2.1, v * 0.08, seed * 9.0 ) );
		col *= mix( 0.9, 1.04, streak ) * mix( 0.8, 1.0, smoothstep( 0.0, 3.0, v ) );
		// Damage extends over the full facade, including the twin towers.
		let marks = stage;
		let hw = gpHash( cell + vec3f( 3.1, 7.7, 1.3 ) );
		var gl = glass;
		var g2 = gRough;
		var broken = 0.0;
		if ( marks > 0.5 ) {
			broken = step( hw, 0.28 * marks );
			let soot = smoothstep( 0.35, 0.8, gpFbm( vec3f( P.x * 0.08, P.y * 0.03, P.z * 0.08 ) ) ) * marks * 0.5;
			col *= 1.0 - min( soot, 0.75 );
			gl = mix( gl, vec3f( 0.01 ), broken );
			g2 = mix( g2, 0.95, broken );
		}
		// lit windows at night (per window, per building), warm or cool; none in broken panes
		let hl = gpHash( cell );
		let share = lit * mix( 0.55, 1.25, seed );
		let on = step( hl, share ) * ( 1.0 - broken );
		let warm = select( vec3f( 1.0, 0.8, 0.52 ), vec3f( 0.78, 0.88, 1.0 ), gpHash( cell + vec3f( 9.0 ) ) > 0.62 );
		let litAvg = share * area * ( 1.0 - min( marks * 0.28, 0.84 ) );
		let glow = mix( on * inWin, litAvg, blur );
		// (the far average dimmer than the sum of its windows: a lit pane is a point of light, not a glowing wall)
		emis = warm * glow * nightK * mix( 1.6, 0.3, blur );
		if ( marks > 1.5 ) {
			let fire = step( gpHash( cell + vec3f( 5.0 ) ), 0.3 ) * ( 0.7 + 0.3 * sin( frame.time * 9.0 + hw * 40.0 ) );
			emis = vec3f( 1.0, 0.42, 0.1 ) * mix( fire * inWin, 0.3 * area, blur ) * 2.2;
			gl = vec3f( 0.02 );
		}
		col = mix( col, gl, win );
		rough = mix( rough, g2, win );
		metal = mix( metal, gMetal, win * ( 1.0 - broken ) );
		// at night the curtain walls and the Twins' aluminium stop mirroring the (moonlit) sky: dark glass, lit panes
		metal *= 1.0 - 0.9 * nightK;
		// (the night is exposed far brighter than physical: pale walls would glow under the moon; the city reads by its windows)
		col *= mix( 1.0, 0.4, nightK ) * ( 1.0 - 0.35 * nightK * win );
		s.specularIntensity *= 1.0 - 0.7 * nightK * win;
	} else if ( style < 91.5 && style > 90.5 ) {
		// flat roofs: gravel / tar
		col *= mix( 0.82, 1.08, gpFbm( P * 0.6 ) );
		rough = 0.95;
	} else if ( style < 92.5 && style > 91.5 ) {
		rough = 0.38; metal = 0.75;
	} else if ( style < 93.5 && style > 92.5 ) {
		rough = 0.08; metal = 0.3;
		emis = vec3f( 1.0, 0.85, 0.6 ) * nightK * 0.8;
	} else if ( style < 94.5 && style > 93.5 ) {
		// awning canvas: stripes
		col *= mix( 0.85, 1.1, step( 0.5, fract( uv.x * 1.2 ) ) );
		rough = 0.9;
	} else if ( style < 95.5 && style > 94.5 ) {
		rough = 0.5;
		emis = col * nightK * 1.1;
	} else if ( style < 96.5 && style > 95.5 ) {
		col *= mix( 0.85, 1.08, gpNoise( P * 1.7 ) );
		rough = 0.8;
	} else if ( style < 97.5 && style > 96.5 ) {
		// granite paving: slabs
		let jx = 1.0 - smoothstep( 0.0, 0.03, abs( fract( P.x / 3.0 + 0.5 ) - 0.5 ) );
		let jz = 1.0 - smoothstep( 0.0, 0.03, abs( fract( P.z / 3.0 + 0.5 ) - 0.5 ) );
		col *= mix( 1.0, 0.75, max( jx, jz ) ) * mix( 0.9, 1.06, gpHash( floor( P / 3.0 ) ) );
		rough = 0.7;
	} else if ( style > 97.5 && style < 98.5 ) {
		// asphalt: patched, darker in the wheel tracks' oil, glossy when the night lamps catch it
		col *= mix( 0.8, 1.12, gpFbm( P * vec3f( 0.35, 0.0, 0.35 ) ) ) * mix( 0.94, 1.03, gpNoise( P * 3.1 ) );
		rough = 0.82;
	} else if ( style > 98.5 && style < 99.5 ) {
		// pavement slabs (1.5 m) and the kerb
		let jx = 1.0 - smoothstep( 0.0, 0.04, abs( fract( P.x / 1.5 + 0.5 ) - 0.5 ) );
		let jz = 1.0 - smoothstep( 0.0, 0.04, abs( fract( P.z / 1.5 + 0.5 ) - 0.5 ) );
		let aa = 1.0 - smoothstep( 0.2, 0.6, fwidth( P.x / 1.5 ) + fwidth( P.z / 1.5 ) );
		col *= mix( 1.0, 0.8, max( jx, jz ) * aa ) * mix( 0.92, 1.05, gpHash( floor( P / 1.5 ) ) );
		rough = 0.75;
	} else if ( style > 88.5 && style < 89.5 ) {
		// road paint: worn
		col *= mix( 0.75, 1.0, gpNoise( P * 1.3 ) );
		rough = 0.6;
	} else {
		col *= mix( 0.9, 1.05, gpNoise( P * 0.9 ) );
	}
	s.albedo = col;
	s.roughness = rough;
	s.metalness = metal;
	s.emissive = emis;
`;

const NOISE_WGSL = /* wgsl */`
// Integer avalanche: sin/fract hashes amplify interpolation and driver errors into flashing windows.
fn gpHash( p: vec3f ) -> f32 {
 let q = bitcast<vec3u>( vec3i( round( p * 256.0 ) ) );
 var h = ( q.x * 1597334677u ) ^ ( q.y * 3812015801u ) ^ ( q.z * 2798796415u );
 h = ( h ^ ( h >> 16u ) ) * 2246822519u;
 h = ( h ^ ( h >> 13u ) ) * 3266489917u;
 return f32( ( h ^ ( h >> 16u ) ) & 16777215u ) / 16777216.0;
}
fn gpNoise( p: vec3f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let u = f * f * ( 3.0 - 2.0 * f );
	let a = mix( mix( gpHash( i ), gpHash( i + vec3f( 1, 0, 0 ) ), u.x ), mix( gpHash( i + vec3f( 0, 1, 0 ) ), gpHash( i + vec3f( 1, 1, 0 ) ), u.x ), u.y );
	let b = mix( mix( gpHash( i + vec3f( 0, 0, 1 ) ), gpHash( i + vec3f( 1, 0, 1 ) ), u.x ), mix( gpHash( i + vec3f( 0, 1, 1 ) ), gpHash( i + vec3f( 1, 1, 1 ) ), u.x ), u.y );
	return mix( a, b, u.z );
}
fn gpFbm( p: vec3f ) -> f32 { return gpNoise( p ) * 0.55 + gpNoise( p * 2.13 + 7.1 ) * 0.3 + gpNoise( p * 4.7 + 3.3 ) * 0.15; }
`;

export const FACADE_SURFACE = FACADE_WGSL;

export function createFacadeMaterial( name = 'meridianFacade' ) {

	const m = standard( {
		vertexColors: true,
		modules: [ facadeModule() ],
		attributes: { aux: 'vec4f' },
		varyings: { vFacadeAux: 'vec4u' },
		vertex: /* wgsl */`
	o.vFacadeAux = bitcast<vec4u>( v.aux );
`,
	} );
	m.name = name;
	m.surface = FACADE_WGSL;
	return m;

}

// the noise helpers as the material's own shader module (the game props' module has functions of the same names: the
// facade material never includes both)
let _fm = null;
function facadeModule() {

	if ( ! _fm ) _fm = new ShaderModule( { name: 'meridianFacade', code: NOISE_WGSL } );
	return _fm;

}
