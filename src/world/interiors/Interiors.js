import { Group, Mesh, Vector3, Color } from '../../engine/index.js';
import { prepare, mergePrepared, box, mat4 } from '../boat/GeoKit.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { parseKit, TownKit, createGlowMaterial } from '../village/TownKit.js';
import { createPropMaterial } from '../../game/GameMaterials.js';
import { loadStallAssets, KitBuilder, place } from '../../game/StallKit.js';
import { INTERIORS, layoutRoom } from './Rooms.js';
import { shells } from './Shells.js';

// The interiors at runtime (wave 19E): every room whose shell a town registered (Shells.js) is bound to its layout
// (Rooms.js); near the player it loads (the lining from the stalls' Poly Haven planks, the furniture kit
// public/models/interiors/kit.glb from tools/interiors/kit.py, the room's colliders and local lights) and far away it
// unloads again (meshes disposed, colliders and lights taken out). The shell's own hollow walls and floor stay.
//
//   const it = new Interiors( { scene, colliders, lights, phone } )
//   it.bind()                        picks up shells registered since (Blackwater builds late)
//   it.update( dt, viewer )          viewer: { x, y, z } the player's feet; loads / unloads; returns the room the viewer is in
//   it.list [ room ]                 room: { id, def, shell, R, F (frame), floorY, loaded, inside, destroyed, ... }
//   it.inside                        the room the viewer is in, or null
//   it.world( room, lx, lz ) / it.local( room, x, z )      it.contains( room, x, y, z, pad )
//   it.seats( room ) / it.staff( room ) / it.door( room )  in world space (door: the step outside the doorway, facing out)
//   it.probe( pivot, dir, dist ) -> the arm length that stays in the room (the indoor camera)
//   it.setDestroyed( id, on ) -> bool    a destroyed room unloads, its doorway is barred; it.enter( id ) (tests, shots)
//   it.dispose()

export const LOAD = { desktop: 30, phone: 20, perFrame: 1 }; // m from the shell's centre; rooms starting to load a frame (wave 20A)
export const UNLOAD_PAD = 15;
export const ARM_INDOOR = 2.4; // the closer third person indoors
export const KIT_URL = 'models/interiors/kit.glb';

const base = () => {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

};

let _kit = null;
export function loadInteriorKit( url = base() + KIT_URL ) {

	if ( ! _kit ) _kit = loadGLB( url ).then( parseKit ).catch( ( e ) => {

		_kit = null;
		if ( ! globalThis.__quietKit ) console.warn( 'interiors: could not load ' + url, e && e.message ? e.message : e );
		return null;

	} );
	return _kit;

}

let _mats = null;
function materials() {

	if ( ! _mats ) {

		const prop = createPropMaterial( 'interiors' );
		const glow = createGlowMaterial( 'interiorsGlow' );
		const shade = createPropMaterial( 'interiorsShade' );
		for ( const m of [ prop, glow, shade ] ) m.underwaterLighting = 'none'; // (indoors, never under water: no caustic samplers)
		_mats = { prop, glow, shade };

	}

	return _mats;

}

const rgb = ( t ) => ( Array.isArray( t ) ? t : [ 1, 1, 1 ] );

export class Interiors {

	constructor( { scene = null, colliders = null, lights = null, phone = !! globalThis.__phoneBudget, meshes = true } = {} ) {

		this.scene = scene;
		this.colliders = colliders;
		this.lights = lights;
		this.phone = phone;
		this.meshes = meshes;
		this.list = [];
		this.byId = new Map();
		this.inside = null;
		this.bind();

	}

	bind() {

		for ( const def of INTERIORS ) {

			if ( this.byId.has( def.id ) ) continue;
			const sh = shells().get( def.id );
			if ( ! sh ) continue;
			const R = layoutRoom( def, sh );
			const c = Math.cos( sh.yaw ), s = Math.sin( sh.yaw );
			const room = {
				id: def.id, def, shell: sh, R, floorY: sh.floorY, F: { x: sh.x, z: sh.z, yaw: sh.yaw, c, s },
				loaded: false, loading: null, wanted: false, inside: false, destroyed: false,
				group: null, solids: [], lightRefs: [], block: null, shade: null,
			};
			this.list.push( room );
			this.byId.set( def.id, room );
			if ( this.meshes && this.scene ) this._shade( room );

		}

		return this.list;

	}

	world( room, lx, lz ) {

		const F = room.F;
		return { x: F.x + lx * F.c + lz * F.s, z: F.z - lx * F.s + lz * F.c };

	}

	local( room, x, z ) {

		const F = room.F, dx = x - F.x, dz = z - F.z;
		return { x: dx * F.c - dz * F.s, z: dx * F.s + dz * F.c };

	}

	// inside the room's inner faces (pad: m more, or less when negative), between the floor and the ceiling
	contains( room, x, y, z, pad = 0 ) {

		const l = this.local( room, x, z ), R = room.R;
		return Math.abs( l.x ) <= R.X + pad && Math.abs( l.z ) <= R.Z + pad && y >= room.floorY - 0.6 && y <= room.floorY + R.h;

	}

	seats( room ) {

		// (a room's seats never move: made once, not a fresh list each time townlife's tavern-goers ask; wave 20A)
		if ( room._seats ) return room._seats;
		return ( room._seats = room.R.seats.map( ( s ) => {

			const p = this.world( room, s.x, s.z );
			return { id: `interior.${ room.id }.${ s.n }`, interior: room.id, port: room.def.port, x: p.x, y: room.floorY + s.y, z: p.z, h: s.y, floor: room.floorY, yaw: room.F.yaw + s.yaw };

		} ) );

	}

	staff( room ) {

		const S = room.R.staff;
		if ( ! S ) return null;
		const p = this.world( room, S.x, S.z ), a = this.world( room, S.at.x, S.at.z );
		return { x: p.x, y: room.floorY, z: p.z, yaw: room.F.yaw + S.yaw, at: { x: a.x, y: room.floorY, z: a.z }, r: S.r };

	}

	// the step outside the doorway (the porch / stoop), the way out, and the Player.yaw that faces out
	door( room ) {

		const R = room.R, sh = room.shell;
		const out = this.world( room, R.doorX, R.Z + sh.t + 1.1 ), sill = this.world( room, R.doorX, R.Z + sh.t * 0.5 );
		return { x: out.x, z: out.z, sill, yawOut: room.F.yaw + Math.PI, yawIn: room.F.yaw };

	}

	// ------------------------------------------------------------------ per frame

	update( dt, viewer ) {

		if ( this.list.length < INTERIORS.length ) this.bind();
		const reach = this.phone ? LOAD.phone : LOAD.desktop;
		let inside = null, loads = 0;
		for ( const room of this.list ) {

			const d = viewer ? Math.hypot( viewer.x - room.F.x, viewer.z - room.F.z ) : Infinity;
			const want = ! room.destroyed && d < ( room.wanted ? reach + UNLOAD_PAD : reach );
			// (wave 20A: one room starts loading a frame - its colliders, lights and the build of its meshes - the next waits a
			// frame; a room the viewer stands in never waits)
			if ( want && ! room.wanted && loads >= LOAD.perFrame && ! ( viewer && this.contains( room, viewer.x, viewer.y, viewer.z, 0.5 ) ) ) continue;
			if ( want && ! room.wanted ) loads ++;
			if ( want !== room.wanted ) {

				room.wanted = want;
				if ( want ) this._load( room );
				else this._unload( room );

			}

			room.inside = !! viewer && ! room.destroyed && this.contains( room, viewer.x, viewer.y, viewer.z, - 0.05 );
			if ( room.inside ) inside = room;

		}

		this.inside = inside;
		return inside;

	}

	// ------------------------------------------------------------------ the indoor camera

	// the highest the spring arm's pivot may sit indoors (Player's pivot is ~3 m over the feet outdoors: above any ceiling)
	pivotTop( room = this.inside ) {

		return room ? room.floorY + room.R.h - 0.55 : Infinity;

	}

	// a spring arm from `pivot` along `dir` (unit, world) for `dist` m: how far it may reach and stay in the room the viewer is
	// in (0.22 m off the walls, under the ceiling, the closer indoor arm), or `dist` when outside
	probe( pivot, dir, dist, room = this.inside ) {

		if ( ! room ) return dist;
		const R = room.R, m = 0.22;
		const l = this.local( room, pivot.x, pivot.z );
		const lx = Math.max( - R.X + m, Math.min( R.X - m, l.x ) ), lz = Math.max( - R.Z + m, Math.min( R.Z - m, l.z ) );
		const ly = Math.max( room.floorY + 0.3, Math.min( room.floorY + R.h - m, pivot.y ) );
		const F = room.F;
		const dx = dir.x * F.c - dir.z * F.s, dz = dir.x * F.s + dir.z * F.c;
		let t = Math.min( dist, ARM_INDOOR );
		const slab = ( o, d, lo, hi ) => {

			if ( d > 1e-6 ) t = Math.min( t, ( hi - o ) / d );
			else if ( d < - 1e-6 ) t = Math.min( t, ( lo - o ) / d );

		};
		slab( lx, dx, - R.X + m, R.X - m );
		slab( lz, dz, - R.Z + m, R.Z - m );
		slab( ly, dir.y, room.floorY + 0.25, room.floorY + R.h - m );
		return Math.max( 0.35, t );

	}

	// ------------------------------------------------------------------ destroyed / restored

	setDestroyed( id, on ) {

		const room = this.byId.get( id );
		if ( ! room || room.destroyed === !! on ) return false;
		room.destroyed = !! on;
		if ( on ) {

			room.wanted = false;
			this._unload( room );
			// bar the doorway (a collider across it) so nobody walks into the ruin
			const R = room.R, p = this.world( room, R.doorX, R.Z + room.shell.t / 2 );
			if ( this.colliders ) room.block = this.colliders.addBox( new Vector3( p.x, room.floorY + 1.1, p.z ), new Vector3( R.doorW / 2 + 0.05, 1.2, room.shell.t / 2 + 0.12 ), room.F.yaw, { tag: 'interiorBarred' } );

		} else if ( room.block ) {

			this._removeBox( room.block );
			room.block = null;

		}

		if ( room.shade ) room.shade.visible = ! room.loaded;
		return true;

	}

	enter( id ) {

		const room = this.byId.get( id );
		if ( ! room ) return null;
		const sp = room.R.spawn, p = this.world( room, sp.x, sp.z );
		return { x: p.x, y: room.floorY, z: p.z, yaw: room.F.yaw + sp.yaw };

	}

	// ------------------------------------------------------------------ load / unload

	_load( room ) {

		// the colliders and the lights at once (the player can be in before the meshes are)
		const R = room.R, C = this.colliders;
		if ( C && ! room.solids.length ) for ( const s of R.solids ) {

			const p = this.world( room, s.x, s.z );
			room.solids.push( C.addBox( new Vector3( p.x, room.floorY + s.h / 2, p.z ), new Vector3( s.hx, s.h / 2, s.hz ), room.F.yaw, { tag: 'interior' } ) );

		}

		if ( this.lights && ! room.lightRefs.length ) for ( const l of R.lights ) {

			const p = this.world( room, l.x, l.z );
			room.lightRefs.push( this.lights.add( { position: new Vector3( p.x, room.floorY + l.y, p.z ), color: new Color( l.color[ 0 ], l.color[ 1 ], l.color[ 2 ] ), intensity: l.intensity, range: l.range, kind: 'interior', flicker: l.flicker, indoor: 1 } ) );

		}

		room.loaded = true;
		if ( ! this.meshes || ! this.scene || room.group || room.loading ) return;
		room.loading = this._build( room ).then( ( g ) => {

			room.loading = null;
			if ( ! g ) return;
			if ( ! room.wanted ) {

				disposeGroup( g );
				return;

			}

			room.group = g;
			this.scene.add( g );
			if ( room.shade ) room.shade.visible = false;

		} ).catch( ( e ) => {

			room.loading = null;
			console.warn( 'interiors: ' + room.id + ' did not build', e );

		} );

	}

	_unload( room ) {

		for ( const b of room.solids ) this._removeBox( b );
		room.solids = [];
		if ( this.lights ) for ( const l of room.lightRefs ) this.lights.remove( l );
		room.lightRefs = [];
		room.loaded = false;
		if ( room.group ) {

			if ( room.group.parent ) room.group.parent.remove( room.group );
			disposeGroup( room.group );
			room.group = null;

		}

		if ( room.shade ) room.shade.visible = true;

	}

	_removeBox( b ) {

		const L = this.colliders && this.colliders.boxes;
		const i = L ? L.indexOf( b ) : - 1;
		if ( i >= 0 ) L.splice( i, 1 );

	}

	// a dark block filling the room while it is not loaded: the doorway reads as a dim interior from the street
	_shade( room ) {

		const R = room.R, M = materials();
		const g = prepare( box( 2 * R.X - 0.02, R.h - 0.02, 2 * R.Z - 0.02 ), { color: 0x0b0907, rough: 1, matrix: mat4( 0, R.h / 2, 0 ) } );
		const mesh = new Mesh( mergePrepared( [ g ] ), M.shade );
		mesh.name = 'InteriorShade_' + room.id;
		mesh.position.set( room.F.x, room.floorY, room.F.z );
		mesh.rotation.y = room.F.yaw;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.cullDistance = 180;
		if ( mesh.updateMatrix ) mesh.updateMatrix();
		room.shade = mesh;
		this.scene.add( mesh );

	}

	async _build( room ) {

		const [ pieces, assets ] = await Promise.all( [ loadInteriorKit(), loadStallAssets().catch( () => null ) ] );
		if ( ! room.wanted ) return null;
		const R = room.R, M = materials();
		const g = new Group();
		g.name = 'Interior_' + room.id;
		g.position.set( room.F.x, room.floorY, room.F.z );
		g.rotation.y = room.F.yaw;
		// the furniture: one prop mesh and one glow mesh (flames, embers and lamp glass burn day and night indoors)
		const kit = new TownKit( { name: 'interior_' + room.id, material: M.prop, glowMaterial: M.glow } );
		for ( const p of R.pieces ) {

			const s = p.s ?? 1;
			kit.place( p.piece, mat4( p.x, p.y, p.z, 0, p.ry || 0, 0, p.sx ?? s, p.sy ?? s, p.sz ?? s, 'YXZ' ) );

		}

		const built = kit.build( pieces, null );
		for ( const m of built.meshes ) {

			m.castShadow = false;
			if ( m.material === M.glow ) m.onBeforeRender = () => { M.glow.emissive = [ 2.2, 2.2, 2.2 ]; };
			g.add( m );

		}

		// the lining: floor, walls, wainscot, ceiling and beams in the stalls' CC0 planks (StallKit), its scans and rope
		if ( assets ) {

			const kb = new KitBuilder( assets, 7 + R.pieces.length );
			lining( kb, R, room.shell );
			for ( const pr of R.props ) if ( assets.info.props[ pr.prop ] ) kb.prop( pr.prop, place( pr.x, pr.y, pr.z, pr.ry || 0, pr.rx || 0, 0, pr.s || 1 ) );
			for ( const c of R.coils ) kb.coil( c.x, c.y, c.z, c.r, 5, 0.014, [ 0.62, 0.53, 0.38 ] );
			const mesh = new Mesh( kb.build(), assets.material );
			mesh.name = 'InteriorLining_' + room.id;
			mesh.castShadow = false;
			mesh.receiveShadow = true;
			g.add( mesh );

		} else {

			const mesh = new Mesh( mergePrepared( plainLining( R ) ), M.prop );
			mesh.name = 'InteriorLining_' + room.id;
			mesh.castShadow = false;
			g.add( mesh );

		}

		g.traverse( ( o ) => { if ( o.updateMatrix ) o.updateMatrix(); } );
		room.triangles = 0;
		g.traverse( ( o ) => { if ( o.geometry && o.geometry.index ) room.triangles += o.geometry.index.count / 3; } );
		return g;

	}

	dispose() {

		for ( const room of this.list ) {

			this._unload( room );
			if ( room.block ) this._removeBox( room.block );
			if ( room.shade && room.shade.parent ) room.shade.parent.remove( room.shade );

		}

	}

}

function disposeGroup( g ) {

	g.traverse( ( o ) => { if ( o.geometry && o.geometry.dispose ) o.geometry.dispose(); } );

}

// the room's surfaces with StallKit's tiling planks: the floor (and the doorway's sill), the walls (the front round the door),
// a painted wainscot to 1 m with a rail, the ceiling (a stairwell left open, dark above) and its beams
function lining( kb, R, sh ) {

	const Ln = R.lining, Ly = Ln.layers || {}, T = Ln.tint || {};
	const X = R.X, Z = R.Z, h = R.h, m = ( x, y, z, ry = 0 ) => place( x, y, z, ry );
	const L = ( k, d ) => ( Ly[ k ] ?? d );
	kb.box( 2 * X, 0.04, 2 * Z, m( 0, - 0.02, 0 ), { layer: L( 'floor', 1 ), color: rgb( T.floor ), along: 'x' } );
	kb.box( R.doorW, 0.04, sh.t + 0.06, m( R.doorX, - 0.02, Z + sh.t / 2 ), { layer: L( 'floor', 1 ), color: rgb( T.floor ), along: 'z' } );
	const wainH = Ln.wainscot ? 1.0 : 0;
	const wall = ( cx, cz, w, ry, y0, y1, layer, tint ) => kb.box( w, y1 - y0, 0.03, m( cx, ( y0 + y1 ) / 2, cz, ry ), { layer, color: rgb( tint ), along: 'x' } );
	const panel = ( cx, cz, w, ry, y0 = 0, y1 = h ) => {

		if ( wainH > 0 && y0 < wainH ) {

			wall( cx, cz, w, ry, y0, Math.min( wainH, y1 ), L( 'wainscot', 3 ), T.wainscot );
			if ( y1 > wainH ) wall( cx, cz, w, ry, wainH, y1, L( 'wall', 0 ), T.wall );
			const rail = place( cx, wainH, cz, ry );
			kb.box( w, 0.06, 0.06, rail, { layer: L( 'wainscot', 3 ), color: rgb( T.wainscot ).map( ( v ) => v * 0.8 ), along: 'x' } );

		} else wall( cx, cz, w, ry, y0, y1, L( 'wall', 0 ), T.wall );

	};

	panel( 0, - Z + 0.015, 2 * X, 0 );
	panel( - X + 0.015, 0, 2 * Z, Math.PI / 2 );
	panel( X - 0.015, 0, 2 * Z, - Math.PI / 2 );
	const x0 = R.doorX - R.doorW / 2, x1 = R.doorX + R.doorW / 2;
	if ( x0 > - X + 0.02 ) panel( ( - X + x0 ) / 2, Z - 0.015, x0 + X, Math.PI );
	if ( x1 < X - 0.02 ) panel( ( x1 + X ) / 2, Z - 0.015, X - x1, Math.PI );
	wall( R.doorX, Z - 0.015, R.doorW, Math.PI, R.doorH, h, L( 'wall', 0 ), T.wall );
	// the ceiling, round the stairwell when there is one; dark above the well
	const ceil = ( ax, bx, az, bz ) => {

		if ( bx - ax < 0.02 || bz - az < 0.02 ) return;
		kb.box( bx - ax, 0.04, bz - az, m( ( ax + bx ) / 2, h + 0.02, ( az + bz ) / 2 ), { layer: L( 'ceiling', 1 ), color: rgb( T.ceiling ), along: 'x' } );

	};

	const W = R.well;
	if ( W ) {

		ceil( - X, W.x0, - Z, Z );
		ceil( W.x1, X, - Z, Z );
		ceil( W.x0, W.x1, W.z1, Z );
		kb.box( W.x1 - W.x0, 0.04, W.z1 - W.z0, m( ( W.x0 + W.x1 ) / 2, h + 1.6, ( W.z0 + W.z1 ) / 2 ), { layer: 1, color: [ 0.05, 0.045, 0.04 ] } );
		for ( const z of [ W.z0, W.z1 ] ) kb.box( W.x1 - W.x0, 1.6, 0.03, m( ( W.x0 + W.x1 ) / 2, h + 0.8, z ), { layer: 1, color: [ 0.12, 0.1, 0.08 ] } );
		for ( const x of [ W.x0, W.x1 ] ) kb.box( 0.03, 1.6, W.z1 - W.z0, m( x, h + 0.8, ( W.z0 + W.z1 ) / 2 ), { layer: 1, color: [ 0.12, 0.1, 0.08 ] } );

	} else ceil( - X, X, - Z, Z );

	const beamTint = rgb( T.ceiling ).map( ( v ) => v * 0.7 );
	const n = Math.max( 1, Math.round( 2 * X / 1.4 ) );
	for ( let i = 0; i <= n; i ++ ) {

		const x = - X + 0.2 + i * ( 2 * X - 0.4 ) / n;
		kb.box( 0.14, 0.18, 2 * Z, m( x, h - 0.09, 0 ), { layer: 0, color: beamTint, along: 'z' } );

	}

	// the jambs inside the doorway (the cut wall's ends)
	for ( const sx of [ - 1, 1 ] ) kb.box( 0.08, R.doorH, sh.t + 0.04, m( R.doorX + sx * ( R.doorW / 2 + 0.03 ), R.doorH / 2, Z + sh.t / 2 ), { layer: 3, color: rgb( T.wainscot || T.wall ), along: 'y' } );

}

// without the stall textures (tests, a failed load): the same surfaces as plain prop boxes
function plainLining( R ) {

	const P = [], c = ( t ) => new Color( ...rgb( t ) );
	const T = R.lining.tint || {};
	P.push( prepare( box( 2 * R.X, 0.04, 2 * R.Z ), { color: c( T.floor ), rough: 0.9, matrix: mat4( 0, - 0.02, 0 ) } ) );
	P.push( prepare( box( 2 * R.X, 0.04, 2 * R.Z ), { color: c( T.ceiling ), rough: 0.9, matrix: mat4( 0, R.h + 0.02, 0 ) } ) );
	P.push( prepare( box( 2 * R.X, R.h, 0.03 ), { color: c( T.wall ), rough: 0.9, matrix: mat4( 0, R.h / 2, - R.Z + 0.015 ) } ) );
	for ( const s of [ - 1, 1 ] ) P.push( prepare( box( 0.03, R.h, 2 * R.Z ), { color: c( T.wall ), rough: 0.9, matrix: mat4( s * ( R.X - 0.015 ), R.h / 2, 0 ) } ) );
	return P;

}
