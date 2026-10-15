import { Vector3 } from '../../engine/index.js';
import { box } from '../boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';
import { WOOD, WOODX, STONE, PAINT } from '../islands/IslandKit.js';
import { DOOR } from './Rooms.js';

// The shells that open (wave 19E): the towns register each building whose door leads into an interior as they build it,
// and give it hollow colliders instead of one solid block: the four walls (the front one cut round the doorway, a lintel
// over it) and a walkable floor at the ground floor's level. src/world/interiors/Interiors.js lays the room out inside.
//
//   registerShell( id, shell )  shell: { x, z, yaw, w, d, t, floorY, h (the ground floor's ceiling), doorX, doorW, doorH,
//                               top, colliders: [ boxes ] }      shellOf( id ), shells() (Map), clearShells()
//   hollowColliders( colliders, frame { x, z, yaw }, { w, d, t, bottom, top, floorY, doorX, doorW, doorH }, tag ) -> [ boxes ]
//   openCottage( add, F, o, colliders ) IslandKit.cottage's look with a real doorway (Blackwater's Rum Hole): o as cottage
//                               plus { id }; registers the shell, returns { top, h, floorY }

const _shells = new Map();

export function registerShell( id, shell ) {

	_shells.set( id, { id, ...shell } );
	return _shells.get( id );

}

export const shellOf = ( id ) => _shells.get( id ) || null;
export const shells = () => _shells;
export const clearShells = () => _shells.clear();

const _c = new Vector3(), _h = new Vector3();

export function hollowColliders( colliders, { x, z, yaw }, { w, d, t, bottom, top, floorY, doorX = 0, doorW = DOOR.w, doorH = DOOR.h }, tag = 'shell' ) {

	if ( ! colliders ) return [];
	const c = Math.cos( yaw ), s = Math.sin( yaw ), out = [];
	// (the back wall carries the building's own tag: one per building, as its solid body had; the rest tag + 'Wall' / 'Floor')
	const add = ( lx, lz, hx, y0, y1, hz, opts = {} ) => {

		_c.set( x + lx * c + lz * s, ( y0 + y1 ) / 2, z - lx * s + lz * c );
		_h.set( hx, ( y1 - y0 ) / 2, hz );
		out.push( colliders.addBox( _c, _h, yaw, { tag: out.length ? tag + 'Wall' : tag, ...opts } ) );

	};

	const ht = t / 2 + 0.04; // a little proud of both faces
	add( 0, - d / 2 + t / 2, w / 2, bottom, top, ht );
	for ( const sx of [ - 1, 1 ] ) add( sx * ( w / 2 - t / 2 ), 0, ht, bottom, top, d / 2 );
	const x0 = doorX - doorW / 2, x1 = doorX + doorW / 2;
	if ( x0 > - w / 2 + 0.01 ) add( ( - w / 2 + x0 ) / 2, d / 2 - t / 2, ( x0 + w / 2 ) / 2, bottom, top, ht );
	if ( x1 < w / 2 - 0.01 ) add( ( x1 + w / 2 ) / 2, d / 2 - t / 2, ( w / 2 - x1 ) / 2, bottom, top, ht );
	add( doorX, d / 2 - t / 2, doorW / 2, floorY + doorH, top, ht );
	// the floor (and the threshold): walkable at the floor's level
	add( 0, 0.01, w / 2, Math.min( bottom, floorY - 0.4 ), floorY, d / 2 + 0.02, { walkable: true, tag: tag + 'Floor' } );
	return out;

}

// IslandKit.cottage with hollow walls and an open doorway (the same stone pad, corner posts, storey band, windows, roof
// and chimney): the Rum Hole. The walls are four slabs; the front is cut round the door.
export function openCottage( add, F, o = {}, colliders = null ) {

	const w = o.w || 5, d = o.d || 4, wallH = o.wallH || 2.6, st = o.storeys || 1;
	const H = wallH * st, t = 0.15;
	const wall = o.wall ?? 0xd9cfb8, roof = o.roof ?? 0x8a3b2c, trim = o.trim ?? 0x3d4b55;
	const wallMat = o.plank ? WOODX( wall ) : PAINT( wall, { rough: 0.85 } );
	const doorX = o.door ?? 0, dw = DOOR.w, dh = DOOR.h;
	const base = 0.3, floorY = F.y + 0.325;
	add( box( w + 0.3, 0.45, d + 0.3 ), { ...STONE( 0x6f6a61 ), matrix: F.m( 0, 0.1, 0 ) } );
	// the walls: back, sides, the front round the doorway
	add( box( w, H, t ), { ...wallMat, matrix: F.m( 0, base + H / 2, - d / 2 + t / 2 ) } );
	for ( const sx of [ - 1, 1 ] ) add( box( t, H, d - 2 * t ), { ...wallMat, matrix: F.m( sx * ( w / 2 - t / 2 ), base + H / 2, 0 ) } );
	const x0 = doorX - dw / 2, x1 = doorX + dw / 2;
	add( box( x0 + w / 2, H, t ), { ...wallMat, matrix: F.m( ( - w / 2 + x0 ) / 2, base + H / 2, d / 2 - t / 2 ) } );
	add( box( w / 2 - x1, H, t ), { ...wallMat, matrix: F.m( ( x1 + w / 2 ) / 2, base + H / 2, d / 2 - t / 2 ) } );
	add( box( dw, H - dh - 0.025, t ), { ...wallMat, matrix: F.m( doorX, base + 0.025 + dh + ( H - dh - 0.025 ) / 2, d / 2 - t / 2 ) } );
	// the door's casing (the leaf stands open inside: the room's)
	for ( const sx of [ - 1, 1 ] ) add( box( 0.1, dh + 0.06, 0.08 ), { ...WOOD( trim ), matrix: F.m( doorX + sx * ( dw / 2 + 0.05 ), base + 0.025 + dh / 2, d / 2 + 0.03 ) } );
	add( box( dw + 0.3, 0.12, 0.12 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( doorX, base + 0.025 + dh + 0.06, d / 2 + 0.05 ) } );
	add( box( dw, 0.04, t + 0.04 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( doorX, base + 0.03, d / 2 - t / 2 ) } );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) add( box( 0.18, H, 0.18 ), { ...WOOD( 0x5a4a3a ), matrix: F.m( sx * w / 2, base + H / 2, sz * d / 2 ) } );
	if ( st > 1 ) add( box( w + 0.12, 0.16, d + 0.12 ), { ...WOOD( 0x5a4a3a ), matrix: F.m( 0, base + wallH, 0 ) } );
	// the windows (dark glass, frames, shutters) as the cottage's
	for ( let k = 0; k < st; k ++ ) {

		for ( const wx of [ - w * 0.3, w * 0.3 ] ) {

			if ( k === 0 && Math.abs( wx - doorX ) < 0.9 ) continue;
			const y = base + k * wallH + wallH * 0.58;
			add( box( 0.8, 0.85, 0.06 ), { color: 0x1c262c, rough: 0.15, matrix: F.m( wx, y, d / 2 + 0.03 ) } );
			add( box( 0.92, 0.08, 0.1 ), { ...WOOD( 0x4a3c30 ), matrix: F.m( wx, y - 0.48, d / 2 + 0.06 ) } );
			for ( const s of [ - 1, 1 ] ) add( box( 0.38, 0.85, 0.04 ), { ...WOOD( trim ), matrix: F.m( wx + s * 0.62, y, d / 2 + 0.08 ) } );

		}

		add( box( 0.8, 0.85, 0.06 ), { color: 0x1c262c, rough: 0.15, matrix: F.m( 0, base + k * wallH + wallH * 0.58, - d / 2 - 0.03 ) } );

	}

	// the upper floor's boards close the ground floor's ceiling from above (seen through the windows of the storey)
	if ( st > 1 ) add( box( w - 2 * t, 0.08, d - 2 * t ), { ...WOOD( 0x3a2e24 ), matrix: F.m( 0, base + wallH + 0.04, 0 ) } );
	const slope = o.slope ?? 0.55, half = d / 2 + 0.35;
	const rl = half / Math.cos( slope ), rise = half * Math.tan( slope ), top = base + H;
	for ( const s of [ - 1, 1 ] ) add( box( w + 0.6, 0.1, rl ), { color: roof, rough: 0.8, pattern: o.tin ? PAT.rusty : 0, metal: o.tin ? 0.5 : 0, matrix: F.m( 0, top + rise / 2 + 0.05, s * half / 2, s * slope, 0, 0 ) } );
	add( box( w + 0.62, 0.12, 0.14 ), { color: roof, rough: 0.8, matrix: F.m( 0, top + rise + 0.07, 0 ) } );
	for ( const s of [ - 1, 1 ] ) {

		add( box( 0.06, rise * 0.62, d * 0.62 ), { ...wallMat, matrix: F.m( s * w / 2, top + rise * 0.31, 0 ) } );
		add( box( 0.06, rise * 0.3, d * 0.3 ), { ...wallMat, matrix: F.m( s * w / 2, top + rise * 0.77, 0 ) } );

	}

	// a ceiling under the roof (the roof slabs and gables leave the eaves open)
	add( box( w, 0.05, d ), { ...WOOD( 0x3a2e24 ), matrix: F.m( 0, top + 0.02, 0 ) } );
	if ( o.chimney !== false ) {

		add( box( 0.55, rise + 1.0, 0.55 ), { ...STONE( 0x7b746a ), matrix: F.m( w * 0.3, top + ( rise + 1.0 ) / 2, - d * 0.15 ) } );
		add( box( 0.65, 0.12, 0.65 ), { ...STONE( 0x5d5852 ), matrix: F.m( w * 0.3, top + rise + 1.0, - d * 0.15 ) } );

	}

	const walls = hollowColliders( colliders, F, { w, d, t, bottom: F.y - 0.3, top: F.y + top, floorY, doorX, doorW: dw, doorH: dh }, o.tag || 'openCottage' );
	if ( o.id ) registerShell( o.id, { x: F.x, z: F.z, yaw: F.yaw, w, d, t, floorY, h: wallH - 0.05, stories: st, doorX, doorW: dw, doorH: dh, top: F.y + top + rise, colliders: walls } );
	return { top: top + rise, h: H, floorY };

}
