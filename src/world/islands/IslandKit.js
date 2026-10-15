import { Vector3, Color } from '../../engine/index.js';
import { FrameUniforms } from '../../engine/render/Frame.js';
import { box, cylinder, sphere, mat4 } from '../boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';

// Shared pieces for the islands 5-8 builders (WestHaven, TheShrine, QuietShoal, InvertedIsles): a seeded
// random stream, a local frame at a point, a cottage, a coconut palm, a cluster of basalt columns, a lantern
// and the distance culling every island runs per frame. Everything adds prepared GeoKit geometry through
// `add( geometry, options )` so each island stays one merged mesh (one draw) per material.

export const WOOD = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.wood, ...o } );
export const WOODX = ( c, o = {} ) => ( { color: c, rough: 0.9, pattern: PAT.woodX, ...o } );
export const STONE = ( c, o = {} ) => ( { color: c, rough: 0.95, ...o } );
export const PAINT = ( c, o = {} ) => ( { color: c, rough: 0.6, ...o } );

export function rng( seed ) {

	let s = Math.max( 1, Math.floor( seed ) % 2147483647 );
	return () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );

}

// a frame at (x, y, z) turned by yaw: local +z is the facing direction (sin yaw, cos yaw), +x its right
export function frameAt( x, y, z, yaw ) {

	const c = Math.cos( yaw ), s = Math.sin( yaw );
	return {
		x, y, z, yaw,
		world: ( lx, lz ) => [ x + lx * c + lz * s, z - lx * s + lz * c ],
		m: ( lx, ly, lz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => mat4( x + lx * c + lz * s, y + ly, z - lx * s + lz * c, rx, yaw + ry, rz, sx, sy, sz, 'YXZ' ),
	};

}

// A cottage on a level pad: stone footing, walls (plank or plaster), a door and windows on the front (+z),
// a pitched roof with its ridge along x, a chimney. o: { w, d, wallH, wall, roof, trim, plank, door, storeys }
export function cottage( add, F, o = {} ) {

	const w = o.w || 5, d = o.d || 4, wallH = o.wallH || 2.6, st = o.storeys || 1;
	const H = wallH * st;
	const wall = o.wall ?? 0xd9cfb8, roof = o.roof ?? 0x8a3b2c, trim = o.trim ?? 0x3d4b55;
	const wallMat = o.plank ? WOODX( wall ) : PAINT( wall, { rough: 0.85 } );
	add( box( w + 0.3, 0.45, d + 0.3 ), { ...STONE( 0x6f6a61 ), matrix: F.m( 0, 0.1, 0 ) } );
	add( box( w, H, d ), { ...wallMat, matrix: F.m( 0, 0.3 + H / 2, 0 ) } );
	// corner posts and a storey band
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) add( box( 0.18, H, 0.18 ), { ...WOOD( 0x5a4a3a ), matrix: F.m( sx * w / 2, 0.3 + H / 2, sz * d / 2 ) } );
	if ( st > 1 ) add( box( w + 0.12, 0.16, d + 0.12 ), { ...WOOD( 0x5a4a3a ), matrix: F.m( 0, 0.3 + wallH, 0 ) } );
	// the door and the windows (dark glass, painted frames and shutters)
	const doorX = o.door ?? 0;
	add( box( 0.95, 2.0, 0.08 ), { ...WOOD( trim ), matrix: F.m( doorX, 1.3, d / 2 + 0.03 ) } );
	add( box( 1.15, 0.12, 0.12 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( doorX, 2.35, d / 2 + 0.05 ) } );
	for ( let k = 0; k < st; k ++ ) {

		for ( const wx of [ - w * 0.3, w * 0.3 ] ) {

			if ( k === 0 && Math.abs( wx - doorX ) < 0.9 ) continue;
			const y = 0.3 + k * wallH + wallH * 0.58;
			add( box( 0.8, 0.85, 0.06 ), { color: 0x1c262c, rough: 0.15, matrix: F.m( wx, y, d / 2 + 0.03 ) } );
			add( box( 0.92, 0.08, 0.1 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( wx, y - 0.48, d / 2 + 0.06 ) } );
			for ( const s of [ - 1, 1 ] ) add( box( 0.38, 0.85, 0.04 ), { ...WOOD( trim ), matrix: F.m( wx + s * 0.62, y, d / 2 + 0.08 ) } );

		}

		// a back window
		add( box( 0.8, 0.85, 0.06 ), { color: 0x1c262c, rough: 0.15, matrix: F.m( 0, 0.3 + k * wallH + wallH * 0.58, - d / 2 - 0.03 ) } );

	}

	// pitched roof, ridge along x, gables
	const slope = o.slope ?? 0.55, half = d / 2 + 0.35;
	const rl = half / Math.cos( slope );
	const rise = half * Math.tan( slope );
	const top = 0.3 + H;
	for ( const s of [ - 1, 1 ] ) add( box( w + 0.6, 0.1, rl ), { color: roof, rough: 0.8, pattern: o.tin ? PAT.rusty : 0, metal: o.tin ? 0.5 : 0, matrix: F.m( 0, top + rise / 2 + 0.05, s * half / 2, s * slope, 0, 0 ) } );
	add( box( w + 0.62, 0.12, 0.14 ), { color: roof, rough: 0.8, matrix: F.m( 0, top + rise + 0.07, 0 ) } );
	for ( const s of [ - 1, 1 ] ) {

		// the gable: a box squashed into a wedge would need custom geometry; two stepped boards read the same
		add( box( 0.06, rise * 0.62, d * 0.62 ), { ...wallMat, matrix: F.m( s * w / 2, top + rise * 0.31, 0 ) } );
		add( box( 0.06, rise * 0.3, d * 0.3 ), { ...wallMat, matrix: F.m( s * w / 2, top + rise * 0.77, 0 ) } );

	}

	if ( o.chimney !== false ) {

		add( box( 0.55, rise + 1.0, 0.55 ), { ...STONE( 0x7b746a ), matrix: F.m( w * 0.3, top + ( rise + 1.0 ) / 2, - d * 0.15 ) } );
		add( box( 0.65, 0.12, 0.65 ), { ...STONE( 0x5d5852 ), matrix: F.m( w * 0.3, top + rise + 1.0, - d * 0.15 ) } );

	}

	return { top: top + rise, h: H };

}

// A coconut palm: a curved, ringed trunk and a crown of drooping fronds (low poly; scenery only)
export function palm( add, x, y, z, height, rnd, lean = 0.25 ) {

	const yaw = rnd() * Math.PI * 2;
	const segs = 6;
	let px = x, pz = z, py = y;
	const dx = Math.sin( yaw ), dz = Math.cos( yaw );
	for ( let i = 0; i < segs; i ++ ) {

		const t = ( i + 0.5 ) / segs, l = height / segs;
		const bend = lean * t * t;
		const r = 0.2 - 0.07 * t;
		const nx = px + dx * bend * l * 1.6, nz = pz + dz * bend * l * 1.6;
		add( cylinder( r * 0.92, r, l * 1.04, 7 ), { ...WOOD( i % 2 ? 0x7a6a55 : 0x6e604d, { rough: 0.95 } ), matrix: mat4( ( px + nx ) / 2, py + l / 2, ( pz + nz ) / 2, dz * bend * 1.2, 0, - dx * bend * 1.2 ) } );
		px = nx; pz = nz; py += l;

	}

	const fronds = 9;
	for ( let i = 0; i < fronds; i ++ ) {

		const a = i / fronds * Math.PI * 2 + rnd() * 0.4;
		const len = 2.6 + rnd() * 1.0, droop = 0.35 + rnd() * 0.45;
		const ca = Math.cos( a ), sa = Math.sin( a );
		const cx = px + ca * len * 0.45, cz = pz + sa * len * 0.45;
		add( box( 0.55, 0.04, len ), { color: [ 0x3f6b2a, 0x4b7a31, 0x36602a ][ i % 3 ], rough: 0.8, matrix: mat4( cx, py - len * 0.18, cz, droop, Math.atan2( ca, sa ), 0, 1, 1, 1, 'YXZ' ) } );

	}

	add( sphere( 0.32, 7, 5 ), { color: 0x4a3a22, rough: 0.8, matrix: mat4( px, py - 0.15, pz ) } );

}

// Basalt columns: a tight cluster of hexagonal prisms with stepped tops (columnar jointing), dark grey
export function basaltCluster( add, x, y, z, r, n, hMax, rnd, hMin = 0.4 ) {

	for ( let i = 0; i < n; i ++ ) {

		const a = rnd() * Math.PI * 2, d = Math.sqrt( rnd() ) * r;
		const cx = x + Math.cos( a ) * d, cz = z + Math.sin( a ) * d;
		const rad = 0.35 + rnd() * 0.3;
		const fall = 1 - d / ( r + 0.01 ); // taller in the middle
		const h = hMin + ( hMax - hMin ) * ( 0.35 + 0.65 * fall ) * ( 0.75 + rnd() * 0.25 );
		const tone = [ 0x2e3032, 0x37393b, 0x2a2b2d, 0x3d3f40 ][ Math.floor( rnd() * 4 ) ];
		add( cylinder( rad, rad * 1.03, h, 6 ), { ...STONE( tone, { rough: 0.85 } ), matrix: mat4( cx, y + h / 2 - 0.3, cz, 0, rnd() * 1.05, 0 ) } );

	}

}

// a hanging lantern (housing + glass) at (x, y, z) and its LocalLights source
export function lantern( add, x, y, z, { intensity = 7.5, range = 11, color = new Color( 1.0, 0.72, 0.42 ) } = {} ) {

	add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( x, y, z ) } );
	add( cylinder( 0.03, 0.09, 0.05, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( x, y + 0.15, z ) } );
	add( cylinder( 0.09, 0.07, 0.03, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( x, y - 0.13, z ) } );
	return { position: new Vector3( x, y, z ), color, intensity, range, kind: 'lantern', flicker: 0.08 };

}

// where the camera is (the last frame's): FrameUniforms carries it for every draw
export function cameraPosition() {

	const v = FrameUniforms.fields.cameraPos.value;
	return v || null;

}

// Distance culling for an island: `parts` [ { object, dist } ] are visible while the camera is within `dist`
// metres (xz) of the centre. Returns the camera distance (Infinity when unknown, which keeps everything shown).
export function cullParts( center, parts, cam = cameraPosition() ) {

	const d = cam ? Math.hypot( cam.x - center.x, cam.z - center.z ) : Infinity;
	for ( const p of parts ) {

		const show = ! Number.isFinite( d ) || d < p.dist;
		if ( p.object.visible !== show ) p.object.visible = show;

	}

	return d;

}
