// The seaplane's home: a small hangar on the beach west of the pier, a timber slipway down the sand and a jetty out
// to the berth where the plane floats (bow to the open sea), clear of the pier (x 55), the boat berths, the stalls,
// the yard (east of the pier), the spawn and the reef. One merged mesh, walkable colliders for the jetty and the
// hangar floor, solid hangar walls.
//
//   SITE.berth { x, z, heading }   where the plane floats when it is home (heading: boatDock convention, 0 = bow +z)
//   SITE.hangar { x, z, w, d, h }  footprint centre and size; SITE.office: the E spot of the ramp panel
//   SITE.jetty { x, z0, z1, w, y } the walkway beside the plane's port float (the door side)
//   jettyPoint( x, z ) -> { x, y, z }   nearest standing point on the jetty
//   const s = new SeaplaneSite( { scene, terrain, colliders } );  s.dispose()

import { Group, Mesh, Vector3 } from '../../engine/index.js';
import { prepare, mergePrepared, box, cylinder, mat4, triangleCount } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';

export const SITE = {
	berth: { x: 0, z: - 20, heading: 0 },
	hangar: { x: 0, z: - 62, w: 10, d: 8, h: 4.6 },
	office: { x: - 2.6, z: - 57.2 },
	ramp: { x: 0, z0: - 57.6, z1: - 35, w: 4.4 },
	jetty: { x: 3.4, z0: - 46, z1: - 12, w: 1.6, y: 0.55 },
	homeRadius: 32, // m from the berth: "at the ramp" (mooring pull, exit onto the jetty)
};

export function jettyPoint( x, z ) {

	const j = SITE.jetty;
	return { x: j.x + Math.max( - j.w / 2 + 0.3, Math.min( j.w / 2 - 0.3, x - j.x ) ), y: j.y, z: Math.max( j.z0 + 0.4, Math.min( j.z1 - 0.4, z ) ) };

}

export function distToBerth( x, z ) {

	return Math.hypot( x - SITE.berth.x, z - SITE.berth.z );

}

export function buildSiteGeometry( terrain ) {

	const H = ( x, z ) => ( terrain && terrain.heightAt ? terrain.heightAt( x, z ) : 0 );
	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodZ } );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const PAINT = ( c ) => ( { color: c, rough: 0.6, pattern: PAT.plain } );
	const METAL = ( c ) => ( { color: c, rough: 0.4, metal: 1 } );
	const hg = SITE.hangar, r = SITE.ramp, j = SITE.jetty;

	// ---- hangar: floor slab, three walls in jade planks, an open front with a cream header, a pitched roof
	let fy = - Infinity;
	for ( const dx of [ - hg.w / 2, 0, hg.w / 2 ] ) for ( const dz of [ - hg.d / 2, 0, hg.d / 2 ] ) fy = Math.max( fy, H( hg.x + dx, hg.z + dz ) );
	fy += 0.15;
	const floorY = fy;
	add( box( hg.w + 0.6, 0.9, hg.d + 0.6 ), { color: 0x9c958a, rough: 0.95, pattern: PAT.plain, matrix: mat4( hg.x, fy - 0.45, hg.z ) } );
	const wallT = 0.18, back = hg.z - hg.d / 2, front = hg.z + hg.d / 2;
	add( box( hg.w, hg.h, wallT ), { ...WOODX( 0x2f8a72 ), matrix: mat4( hg.x, fy + hg.h / 2, back ) } );
	for ( const s of [ - 1, 1 ] ) add( box( wallT, hg.h, hg.d ), { ...WOOD( 0x2f8a72 ), matrix: mat4( hg.x + s * hg.w / 2, fy + hg.h / 2, hg.z ) } );
	// front: corner posts, a header beam and gable boards above the door
	for ( const s of [ - 1, 1 ] ) add( box( 0.6, hg.h, wallT ), { ...WOODX( 0x2f8a72 ), matrix: mat4( hg.x + s * ( hg.w / 2 - 0.3 ), fy + hg.h / 2, front ) } );
	add( box( hg.w, 0.5, wallT + 0.04 ), { ...PAINT( 0xeee3c4 ), matrix: mat4( hg.x, fy + hg.h - 0.25, front ) } );
	const rise = 1.6, half = hg.w / 2 + 0.5, slope = Math.atan2( rise, half ), len = Math.hypot( rise, half );
	for ( const s of [ - 1, 1 ] ) {

		add( box( len, 0.14, hg.d + 1.0 ), { ...WOODX( 0x7b4a33 ), matrix: mat4( hg.x + s * half / 2, fy + hg.h + rise / 2, hg.z, 0, 0, - s * slope ) } );
		// gable triangles as stacked boards, front and back
		for ( let k = 0; k < 4; k ++ ) {

			const wk = hg.w * ( 1 - ( k + 0.5 ) / 4 );
			for ( const zz of [ back, front ] ) add( box( wk, rise / 4, wallT ), { ...WOODX( k % 2 ? 0x2f8a72 : 0x2a7d67 ), matrix: mat4( hg.x, fy + hg.h + ( k + 0.5 ) * rise / 4, zz ) } );

		}

	}

	// the sign over the door (jade board, cream border) and a workbench, drums and a propeller on the back wall
	add( box( 3.6, 0.7, 0.08 ), { ...PAINT( 0xeee3c4 ), matrix: mat4( hg.x, fy + hg.h + 0.55, front + 0.12 ) } );
	add( box( 3.3, 0.5, 0.1 ), { ...PAINT( 0x1f6f5c ), matrix: mat4( hg.x, fy + hg.h + 0.55, front + 0.13 ) } );
	add( box( 2.4, 0.08, 0.7 ), { ...WOODX( 0x8a6a4c ), matrix: mat4( hg.x - 2.6, fy + 0.9, back + 0.55 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.08, 0.9, 0.6 ), { ...WOOD( 0x6a4e38 ), matrix: mat4( hg.x - 2.6 + s * 1.1, fy + 0.45, back + 0.55 ) } );
	for ( const [ dx, c ] of [ [ 2.6, 0xb5483a ], [ 3.3, 0x24425a ] ] ) add( cylinder( 0.3, 0.3, 0.9, 14 ), { ...METAL( c ), matrix: mat4( hg.x + dx, fy + 0.45, back + 0.6 ) } );
	add( box( 0.16, 2.4, 0.06 ), { ...METAL( 0x1a1c1e ), matrix: mat4( hg.x + 0.5, fy + 2.4, back + 0.14, 0, 0, 0.5 ) } );

	// ---- the slipway: a timber deck laid on the sand, cross planks, tilted to the beach
	{

		const y0 = H( r.x, r.z0 ) + 0.1, y1 = H( r.x, r.z1 ) + 0.1;
		const L = Math.hypot( r.z1 - r.z0, y0 - y1 ), tilt = Math.atan2( y0 - y1, r.z1 - r.z0 );
		const cz = ( r.z0 + r.z1 ) / 2, cy = ( y0 + y1 ) / 2;
		add( box( r.w, 0.12, L ), { ...WOOD( 0x8e7a5e ), matrix: mat4( r.x, cy - 0.06, cz, tilt ) } );
		for ( let k = 0; k < 10; k ++ ) {

			const t = ( k + 0.5 ) / 10;
			add( box( r.w + 0.3, 0.06, 0.18 ), { ...WOODX( 0x6e5a42 ), matrix: mat4( r.x, y0 + ( y1 - y0 ) * t + 0.03, r.z0 + ( r.z1 - r.z0 ) * t, tilt ) } );

		}

		for ( const s of [ - 1, 1 ] ) add( box( 0.16, 0.16, L ), { ...WOOD( 0x5d4e3b ), matrix: mat4( r.x + s * ( r.w / 2 + 0.08 ), cy + 0.02, cz, tilt ) } );

	}

	// ---- the jetty: planks on posts beside the berth
	{

		const len = j.z1 - j.z0, cz = ( j.z0 + j.z1 ) / 2;
		add( box( j.w, 0.14, len ), { ...WOOD( 0x917e62 ), matrix: mat4( j.x, j.y - 0.07, cz ) } );
		for ( let z = j.z0 + 1; z <= j.z1; z += 3 ) for ( const s of [ - 1, 1 ] ) {

			const px = j.x + s * ( j.w / 2 - 0.08 ), gy = H( px, z );
			const top = j.y + 0.35, h = top - gy + 0.3;
			add( cylinder( 0.1, 0.11, h, 8 ), { ...WOOD( 0x5a4a38 ), matrix: mat4( px, top - h / 2, z ) } );

		}

		for ( const z of [ SITE.berth.z + 3, SITE.berth.z - 3.5 ] ) add( box( 0.08, 0.08, 0.36 ), { ...METAL( 0x2a2d30 ), matrix: mat4( j.x - j.w / 2 + 0.2, j.y + 0.04, z ) } );

	}

	// ---- a windsock on a pole by the slipway (the cone hangs off the arm)
	{

		const wx = r.x - r.w / 2 - 1.6, wz = r.z0 + 4, gy = H( wx, wz );
		add( cylinder( 0.05, 0.07, 5.5, 8 ), { ...PAINT( 0xeee3c4 ), matrix: mat4( wx, gy + 2.75, wz ) } );
		add( cylinder( 0.32, 0.12, 1.6, 10, 1, true ), { color: 0xe0612f, rough: 0.9, pattern: PAT.cloth, matrix: mat4( wx + 0.85, gy + 5.2, wz, 0, 0, Math.PI / 2 - 0.25 ) } );

	}

	return { geometry: mergePrepared( P ), floorY };

}

export class SeaplaneSite {

	constructor( { scene = null, terrain = null, colliders = null, mesh = true } = {} ) {

		const { geometry, floorY } = buildSiteGeometry( terrain );
		this.geometry = geometry;
		this.floorY = floorY;
		this.triangles = triangleCount( geometry );
		this.group = new Group();
		this.group.name = 'SeaplaneSite';
		this.material = null;
		if ( mesh ) {

			this.material = createPropMaterial( 'seaplaneSite' );
			const m = new Mesh( geometry, this.material );
			m.name = 'SeaplaneSiteMesh';
			m.castShadow = true;
			m.receiveShadow = true;
			this.group.add( m );

		}

		this.scene = scene;
		if ( scene ) scene.add( this.group );

		this.colliders = [];
		this._world = colliders;
		if ( colliders ) {

			const hg = SITE.hangar, j = SITE.jetty, fy = floorY, t = 0.1;
			const add = ( c, h, opts ) => this.colliders.push( colliders.addBox( c, h, 0, { tag: 'seaplaneSite', ...opts } ) );
			add( new Vector3( hg.x, fy - 0.45, hg.z ), new Vector3( hg.w / 2 + 0.3, 0.45, hg.d / 2 + 0.3 ), { walkable: true } );
			add( new Vector3( hg.x, fy + hg.h / 2, hg.z - hg.d / 2 ), new Vector3( hg.w / 2, hg.h / 2, t ) );
			for ( const s of [ - 1, 1 ] ) {

				add( new Vector3( hg.x + s * hg.w / 2, fy + hg.h / 2, hg.z ), new Vector3( t, hg.h / 2, hg.d / 2 ) );
				add( new Vector3( hg.x + s * ( hg.w / 2 - 0.3 ), fy + hg.h / 2, hg.z + hg.d / 2 ), new Vector3( 0.3, hg.h / 2, t ) );

			}

			add( new Vector3( j.x, j.y - 0.4, ( j.z0 + j.z1 ) / 2 ), new Vector3( j.w / 2, 0.4, ( j.z1 - j.z0 ) / 2 ), { walkable: true } );

		}

	}

	dispose() {

		if ( this._world ) {

			for ( const c of this.colliders ) {

				const i = this._world.boxes.indexOf( c );
				if ( i >= 0 ) this._world.boxes.splice( i, 1 );

			}

			this.colliders = [];

		}

		if ( this.scene && this.scene.remove ) this.scene.remove( this.group );
		if ( this.geometry && this.geometry.dispose ) this.geometry.dispose();
		if ( this.material && this.material.dispose ) this.material.dispose();

	}

}

// ---------------------------------------------------------------- wave 12C: the airstrip (the Kestrel's base)
// The town-island worker builds the strip: WORLD[ island ].airstrip = { x, z, y, heading, length, width, pad } (read
// dynamically: the first island that has one; none at runtime and the Kestrel is simply not for sale). pad: { x, z }
// (or [ x, z ]), where a plane is parked; missing: near the strip's south-west end. The hangar office (the E spot of
// the same hangar window, scoped to the strip) stands beside the pad, off the runway.

export function findAirstrip( world, near = null ) {

	if ( ! world ) return null;
	let best = null, bd = Infinity;
	for ( const isl of world.islands || [] ) {

		const s = isl && world[ isl.id ] && world[ isl.id ].airstrip;
		if ( ! s || ! Number.isFinite( s.x ) || ! Number.isFinite( s.z ) ) continue;
		if ( ! near ) return { island: isl.id, ...s };
		const d = Math.hypot( s.x - near.x, s.z - near.z ); // (wave 21A: Meridian's airport too: the nearest strip)
		if ( d < bd ) { bd = d; best = { island: isl.id, ...s }; }

	}

	return best;

}

// the parking spot on the pad: { x, y, z, heading } with the nose down the runway (towards the strip's far end)
export function stripPad( s ) {

	if ( ! s ) return null;
	const h = Number.isFinite( s.heading ) ? s.heading : 0, L = Number.isFinite( s.length ) ? s.length : 400;
	const fx = Math.sin( h ), fz = Math.cos( h );
	let px, pz;
	const pad = s.pad;
	if ( Array.isArray( pad ) && pad.length >= 2 ) [ px, pz ] = pad;
	else if ( pad && Number.isFinite( pad.x ) ) ( px = pad.x, pz = pad.z );
	else ( px = s.x - fx * L * 0.42, pz = s.z - fz * L * 0.42 );
	// face the longer part of the runway from the pad
	const along = ( s.x - px ) * fx + ( s.z - pz ) * fz;
	const heading = along >= 0 ? h : h + Math.PI;
	const y = Number.isFinite( pad && pad.y ) ? pad.y : Number.isFinite( s.y ) ? s.y : 0;
	return { x: px, y, z: pz, heading: Math.atan2( Math.sin( heading ), Math.cos( heading ) ) };

}

// is ( x, z ) on the runway's graded rectangle (plus a margin), or on the apron between the pad and the runway
export function onStrip( s, x, z, margin = 0 ) {

	if ( ! s ) return false;
	const h = Number.isFinite( s.heading ) ? s.heading : 0, fx = Math.sin( h ), fz = Math.cos( h );
	const loc = ( px, pz ) => {

		const dx = px - s.x, dz = pz - s.z;
		return [ dx * fx + dz * fz, dx * fz - dz * fx ];

	};

	const [ along, across ] = loc( x, z );
	if ( Math.abs( along ) <= ( s.length || 400 ) / 2 + margin && Math.abs( across ) <= ( s.width || 20 ) / 2 + margin ) return true;
	const p = stripPad( s );
	if ( ! p ) return false;
	const [ pa, pc ] = loc( p.x, p.z );
	return Math.abs( along - pa ) <= 18 + margin && across >= Math.min( pc, 0 ) - 12 - margin && across <= Math.max( pc, 0 ) + 12 + margin;

}

// the strip hangar's office: beside the pad, off the runway's side (the pad's side of the centre line)
export function stripOffice( s ) {

	const p = stripPad( s );
	if ( ! p ) return null;
	if ( s.office && Number.isFinite( s.office.x ) ) return { x: s.office.x, z: s.office.z, y: s.office.y ?? p.y, yaw: p.heading };
	// the town's hangar shed (WORLD[ island ].airstrip.hangar): the E spot in front of it, towards the pad
	if ( s.hangar && Number.isFinite( s.hangar.x ) ) {

		const dx = p.x - s.hangar.x, dz = p.z - s.hangar.z, d = Math.hypot( dx, dz ) || 1, k = Math.min( d * 0.5, 12 ) / d;
		return { x: s.hangar.x + dx * k, y: p.y, z: s.hangar.z + dz * k, yaw: p.heading, shed: true };

	}

	const h = p.heading, rx = Math.cos( h ), rz = - Math.sin( h ); // the pad's port side (model +X)
	const off = ( s.width || 20 ) / 2 + 6;
	return { x: p.x + rx * off, y: p.y, z: p.z + rz * off, yaw: h };

}

// a small hangar office hut and a windsock at the strip (the town worker owns the runway itself)
export function buildStripGeometry( s, terrain ) {

	const o = stripOffice( s );
	if ( ! o || o.shed ) return null; // (the town builds the hangar shed: nothing of ours to add)
	const H = ( x, z ) => ( terrain && terrain.heightAt ? terrain.heightAt( x, z ) : o.y );
	const P = [];
	const add = ( g, opt ) => P.push( prepare( g, opt ) );
	const gy = Math.max( o.y, H( o.x, o.z ) );
	const c = Math.cos( o.yaw ), sn = Math.sin( o.yaw );
	const at = ( lx, lz ) => [ o.x + lx * c + lz * sn, o.z - lx * sn + lz * c ];
	const [ hx, hz ] = at( 3.2, 0 );
	add( box( 3.2, 2.6, 3.2 ), { color: 0x2f8a72, rough: 0.9, pattern: PAT.woodX, matrix: mat4( hx, gy + 1.3, hz, 0, o.yaw, 0 ) } );
	add( box( 3.8, 0.16, 3.8 ), { color: 0x7b4a33, rough: 0.9, pattern: PAT.woodX, matrix: mat4( hx, gy + 2.7, hz, 0, o.yaw, 0 ) } );
	const [ sx, sz ] = at( 1.55, 0 );
	add( box( 2.2, 0.5, 0.08 ), { color: 0xeee3c4, rough: 0.6, pattern: PAT.plain, matrix: mat4( sx, gy + 2.2, sz, 0, o.yaw + Math.PI / 2, 0 ) } ); // the sign over the door
	const [ wx, wz ] = at( 3.2, 4.5 );
	add( cylinder( 0.05, 0.07, 5.5, 8 ), { color: 0xeee3c4, rough: 0.6, pattern: PAT.plain, matrix: mat4( wx, gy + 2.75, wz ) } );
	add( cylinder( 0.32, 0.12, 1.6, 10, 1, true ), { color: 0xe0612f, rough: 0.9, pattern: PAT.cloth, matrix: mat4( wx + 0.85, gy + 5.2, wz, 0, 0, Math.PI / 2 - 0.25 ) } );
	return { geometry: mergePrepared( P ), office: o, hut: { x: hx, z: hz, y: gy } };

}

export class StripSite {

	constructor( { strip, scene = null, terrain = null, colliders = null, mesh = true } = {} ) {

		this.strip = strip;
		this.office = stripOffice( strip );
		this.scene = scene;
		this.group = new Group();
		this.group.name = 'SeaplaneStrip';
		this.colliders = [];
		this._world = colliders;
		const b = buildStripGeometry( strip, terrain );
		this.geometry = b ? b.geometry : null;
		if ( b && mesh ) {

			this.material = createPropMaterial( 'seaplaneStrip' );
			const m = new Mesh( b.geometry, this.material );
			m.castShadow = true;
			m.receiveShadow = true;
			this.group.add( m );

		}

		if ( scene && b ) scene.add( this.group );
		if ( colliders && b ) this.colliders.push( colliders.addBox( new Vector3( b.hut.x, b.hut.y + 1.3, b.hut.z ), new Vector3( 1.6, 1.3, 1.6 ), this.office.yaw, { tag: 'seaplaneStrip' } ) );

	}

	dispose() {

		if ( this._world ) for ( const c of this.colliders ) {

			const i = this._world.boxes.indexOf( c );
			if ( i >= 0 ) this._world.boxes.splice( i, 1 );

		}

		this.colliders = [];
		if ( this.scene && this.scene.remove ) this.scene.remove( this.group );
		if ( this.geometry && this.geometry.dispose ) this.geometry.dispose();
		if ( this.material && this.material.dispose ) this.material.dispose();

	}

}
