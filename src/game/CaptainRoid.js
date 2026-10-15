import { Group, Mesh, Vector3, Color } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, torus, sphere, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { Vendor } from './Vendor.js';
import { YARD } from './BoatYard.js';
import { WORLD } from '../world/WorldLayout.js';
import { linePhrases } from '../audio/Clicks.js';

// Captain Roid sells the boats. He is the owner's character from the naval fork (Norwood class 3, a pirate
// captain there; here he runs the yard): the model, his three animations (Idle, FirstEncounter, Repeat)
// and his recorded clicks come from Assets/CaptainRoid (see tools/roster/convert-roid.ps1). His yard is on the
// sand nearest the boat yard moorings (the fleet east of the pier, BoatYard.js), with a "BOAT YARD" sign on
// two posts, a coil of mooring line, a bollard, a lantern post and a crate he sits on.
//
// How he behaves in the fork (CaptainRoidCharacter.cpp, browser/src/dialogue.ts): he speaks only in clicks
// with subtitles; the first time you meet him he plays FirstEncounter (6 s: "I am Captain Roid. Norwood
// class three." / "Watch your footing, and keep your coins dry."), every later time Repeat (3 s: "Back
// again? The tide waits for nobody."). The same here: the first approach plays FirstEncounter once
// (state.career.metRoid remembers it, so a loaded save greets with Repeat), later approaches Repeat; the
// recorded clicks (audio/Clicks.js) play on the greeting, when his panel opens, on a boat row and on a
// purchase. The panel is HudPanels.renderYard (vendor kind 'yard').
//
// His day (wave 5): his own Idle and Repeat are still poses (two identical keys: an A-pose that never breathes)
// and he had no walk, so tools/roid/retarget.mjs retargets roster clips onto his rig (captain-roid-clips.json:
// Idle_Breathe, Walk_InPlace, Look_Around, Sit_Down, Talk, Point). With them he works the yard on the island
// clock (routineStop: stands at the sign, checks the moored boats, looks out to sea, sits on his crate, an
// afternoon stroll to the pier head; the crate and the sign at night), walking a 0.5 m grid path (WalkGrid: dry
// ground or decks, a capsule clear of every solid collider) and standing on whatever is under him (terrain or a
// deck: colliders.groundHeightAt). The stop comes from the clock alone, so every client sees roughly the same.
// Within ~6 m of the player he stops, turns to them and greets; the vendor (prompt, panel, clicks) follows his
// live position. Far from the player and the camera he simply jumps to his stop. Without the clips (load failed)
// he stays at the sign.
//
//   const roid = new CaptainRoid( { scene, terrain, colliders, clicks, clock?, viewer? } );
//   roid.vendor (push into Game.vendors; vendor.driven: Game's vendor loop leaves him to roid.update),
//   roid.update( dt, player ), roid.lights (add to localLights),
//   roid.clicks (HudPanels bursts 'open' / 'hover' / 'buy' through game.roid.clicks),
//   roid.say( kind, onPhrase ) (the Talk tab's topics: clicks + subtitles, onPhrase for the panel's chat log),
//   roid.hooks = { isMet(), setMet() } (Game wires them to the save)
//   clock(): the hour (default app.settings.timeOfDay); viewer(): the camera position (default app.camera)
//
// ROID is his yard (the sign spot): placeRoid() scans from the mooring centre toward the land (-z), column by
// column, for the first terrain point 0.6-2.0 m high within 40 m where he and his props fit (not in a building,
// not across the Jade Landing boardwalk, off Ethena's stall). It runs again in the constructor, after BoatYard
// has settled YARD on the real moorings.

export const ROID = { x: 0, z: 0, yaw: 0 };

const SAND = { min: 0.6, max: 2.0 }, REACH = 40, STEP = 0.5;
const CHANDLERY_SPOT = { x: 85.5, z: - 60.5 }, KEEP_CLEAR = 6; // Ethena's stall: keep Roid off it
const GREETING_FIRST = '*click click* I am Captain Roid. Norwood class three. Watch your footing, and keep your coins dry. Pick a boat, it will be at your berth before you have walked back.';
const GREETING_REPEAT = '*click click* Back again? The tide waits for nobody. Pick a boat.';
const BASE = ( ( typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL ) || '/' );
const MODEL = BASE + 'models/npc/captain-roid.glb';
const CLIPS_URL = BASE + 'models/npc/captain-roid-clips.json';
const COOLDOWN = 6; // s between proximity bursts
const LANTERN = { x: - 1.1, z: 0.9 }; // the post, local frame
const CRATE = { x: 2.7, z: - 0.35, w: 0.56, h: 0.42, d: 0.46 }; // the crate he sits on (seat height from the Sit_Down pelvis drop), local frame
// his footprint and his props' (local x, z, radius): placeRoid keeps them clear of buildings and the boardwalk
const FOOTPRINT = [ [ 0, 0, 0.5 ], [ - 1.25, - 1.2, 0.3 ], [ 1.25, - 1.2, 0.3 ], [ LANTERN.x, LANTERN.z, 0.3 ], [ 1.4, 0.5, 0.3 ], [ CRATE.x, CRATE.z, 0.45 ] ];
const BOARDWALK_CLEAR = 1.6; // m from the boardwalk's centre line (half its width + room)

const segDist = ( x, z, a, b ) => {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], l2 = dx * dx + dz * dz || 1;
	const t = Math.max( 0, Math.min( 1, ( ( x - a[ 0 ] ) * dx + ( z - a[ 1 ] ) * dz ) / l2 ) );
	return Math.hypot( x - a[ 0 ] - dx * t, z - a[ 1 ] - dz * t );

};

// local (lx, lz) of a frame at (x, z) turned by yaw -> world [ x, z ]
const toWorld = ( x, z, yaw, lx, lz ) => [ x + lx * Math.cos( yaw ) + lz * Math.sin( yaw ), z - lx * Math.sin( yaw ) + lz * Math.cos( yaw ) ];

// terrain: { heightAt( x, z ) }; yard: { x, z } (the mooring centre); blocked( x, h, z, yaw ): his spot or a prop hits something
export function placeRoid( terrain, yard = YARD, out = ROID, blocked = null, layout = WORLD ) {

	const sx = yard.x;
	const walk = layout && layout.landing && layout.landing.boardwalk || null;
	// 'ok', 'walk' (across the boardwalk: try further in) or 'blocked' (Ethena's stall, a building)
	const fit = ( x, h, z, yaw ) => {

		if ( Math.hypot( x - CHANDLERY_SPOT.x, z - CHANDLERY_SPOT.z ) < KEEP_CLEAR ) return 'blocked';
		if ( blocked && blocked( x, h, z, yaw ) ) return 'blocked';
		if ( walk ) for ( const [ lx, lz, r ] of FOOTPRINT ) {

			const [ wx, wz ] = toWorld( x, z, yaw, lx, lz );
			for ( let i = 0; i < walk.length - 1; i ++ ) if ( segDist( wx, wz, walk[ i ], walk[ i + 1 ] ) < BOARDWALK_CLEAR + r ) return 'walk';

		}

		return 'ok';

	};

	// a column toward the land: the first sand where he fits; a blocked stretch over 2 m (the stall, a building) ends
	// the column (never behind it)
	const scan = ( x ) => {

		let run = 0;
		for ( let d = 0; d <= REACH; d += STEP ) {

			const z = yard.z - d, h = terrain.heightAt( x, z );
			if ( h < SAND.min || h > SAND.max ) continue;
			const yaw = Math.atan2( yard.x - x, yard.z - z ); // looking out over the moorings
			const f = fit( x, h, z, yaw );
			if ( f === 'ok' ) return { x, z };
			if ( f === 'blocked' && ( run += STEP ) > 2 ) return null;

		}

		return null;

	};

	let p = null;
	// straight in from the moorings, then columns 3 m apart east and west
	if ( terrain && terrain.heightAt ) for ( let k = 0; ! p && k <= 12; k ++ ) p = scan( sx + ( k % 2 ? 1 : - 1 ) * Math.ceil( k / 2 ) * 3 );
	if ( ! p ) p = { x: sx, z: yard.z - 24 }; // no sand found: the nominal spot on the beach
	out.x = p.x;
	out.z = p.z;
	out.yaw = Math.atan2( yard.x - p.x, yard.z - p.z );
	return out;

}

placeRoid( { heightAt: () => 99 }, YARD ); // the nominal spot until a terrain is known

// ---------------------------------------------------------------- his day

// game hours per stop; DAY loops every 1.5 h, NIGHT (21-6 h) every 2 h, the pier head from 15 to 16 h
const DAY = [ [ 'sign', 0.3 ], [ 'boats', 0.3 ], [ 'sea', 0.2 ], [ 'crate', 0.45 ], [ 'sign', 0.25 ] ];
const NIGHT = [ [ 'crate', 1.5 ], [ 'sign', 0.5 ] ];
const PIER_HOURS = [ 15, 16 ];
export const ROUTINE = { DAY, NIGHT, PIER_HOURS };

// the stop he should be at, at this hour of the island clock (the same on every client)
export function routineStop( hour ) {

	if ( ! Number.isFinite( hour ) ) return 'sign';
	const h = ( ( hour % 24 ) + 24 ) % 24;
	if ( h >= PIER_HOURS[ 0 ] && h < PIER_HOURS[ 1 ] ) return 'pier';
	const list = h >= 21 || h < 6 ? NIGHT : DAY;
	const total = list.reduce( ( s, e ) => s + e[ 1 ], 0 );
	let t = h % total;
	for ( const [ stop, d ] of list ) {

		if ( t < d ) return stop;
		t -= d;

	}

	return list[ 0 ][ 0 ];

}

const WALK = 1.25; // m/s, a stroll
const ENGAGE = 6, RELEASE = 7.5; // m: he stops for the player, and goes back to work
const ACTIVE = 60; // m from the player / camera: animated and walking; beyond, he jumps to his stop

// The walk grid: 0.5 m cells over a rectangle. A cell is walkable when its ground (the terrain, or a deck within reach:
// colliders.groundHeightAt) is dry and a standing capsule there touches no solid collider (0.42 m: a walker between cell
// centres keeps ~0.1 m more than his own 0.3); neighbours differ by at most a step (stairs and ramps yes, the pier's side no). Cells are tested on demand and cached until reset().
export class WalkGrid {

	constructor( { terrain, colliders = null, x0, z0, x1, z1, cell = 0.5, radius = 0.42, step = 0.45, dry = 0.3 } ) {

		Object.assign( this, { terrain, colliders, x0, z0, cell, radius, step, dry } );
		this.nx = Math.ceil( ( x1 - x0 ) / cell ) + 1;
		this.nz = Math.ceil( ( z1 - z0 ) / cell ) + 1;
		this.h = new Float32Array( this.nx * this.nz );
		this.state = new Uint8Array( this.nx * this.nz ); // 0 unknown, 1 free, 2 blocked

	}

	reset() {

		this.state.fill( 0 );

	}

	// the ground under (x, z) for someone standing at about fromY (NaN: anywhere up to 3 m over the terrain)
	groundAt( x, z, fromY = NaN ) {

		const t = this.terrain.heightAt( x, z );
		const reach = Number.isFinite( fromY ) ? Math.max( fromY, t ) + this.step + 0.1 : Math.max( t, 0 ) + 3;
		const g = this.colliders && this.colliders.groundHeightAt ? this.colliders.groundHeightAt( x, z, reach ) : - Infinity;
		return Math.max( t, g );

	}

	index( x, z ) {

		const i = Math.round( ( x - this.x0 ) / this.cell ), j = Math.round( ( z - this.z0 ) / this.cell );
		return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? - 1 : j * this.nx + i;

	}

	cx( k ) { return this.x0 + ( k % this.nx ) * this.cell; }
	cz( k ) { return this.z0 + Math.floor( k / this.nx ) * this.cell; }

	// free? (its ground height lands in this.h)
	free( k ) {

		if ( k < 0 ) return false;
		if ( this.state[ k ] ) return this.state[ k ] === 1;
		const x = this.cx( k ), z = this.cz( k ), y = this.groundAt( x, z );
		this.h[ k ] = y;
		let ok = y >= this.dry;
		if ( ok && this.colliders && this.colliders.resolveCapsule ) ok = ! this.colliders.resolveCapsule( { x, y, z }, this.radius, 1.7, 0.4 );
		this.state[ k ] = ok ? 1 : 2;
		return ok;

	}

	// the nearest free cell to (x, z) within r m, or -1
	nearestFree( x, z, r = 3 ) {

		const k0 = this.index( x, z );
		if ( this.free( k0 ) ) return k0;
		let best = - 1, bd = Infinity;
		const n = Math.ceil( r / this.cell );
		const i0 = Math.round( ( x - this.x0 ) / this.cell ), j0 = Math.round( ( z - this.z0 ) / this.cell );
		for ( let dj = - n; dj <= n; dj ++ ) for ( let di = - n; di <= n; di ++ ) {

			const i = i0 + di, j = j0 + dj;
			if ( i < 0 || j < 0 || i >= this.nx || j >= this.nz ) continue;
			const d = di * di + dj * dj;
			if ( d < bd && d <= n * n && this.free( j * this.nx + i ) ) { bd = d; best = j * this.nx + i; }

		}

		return best;

	}

	// A* from (ax, az) to (bx, bz): [ { x, z } ... ] (corners only, the goal cell's centre last), or null
	find( ax, az, bx, bz, maxExpand = 40000 ) {

		const s = this.nearestFree( ax, az, 2 ), g = this.nearestFree( bx, bz, 3 );
		if ( s < 0 || g < 0 ) return null;
		const N = this.nx * this.nz, cost = new Float32Array( N ).fill( Infinity ), from = new Int32Array( N ).fill( - 1 );
		const heap = [], gi = g % this.nx, gj = Math.floor( g / this.nx );
		const hcost = ( k ) => {

			const di = Math.abs( k % this.nx - gi ), dj = Math.abs( Math.floor( k / this.nx ) - gj );
			return Math.max( di, dj ) + 0.4142 * Math.min( di, dj );

		};

		const push = ( k, f ) => {

			heap.push( [ f, k ] );
			let i = heap.length - 1;
			while ( i > 0 ) {

				const p = ( i - 1 ) >> 1;
				if ( heap[ p ][ 0 ] <= heap[ i ][ 0 ] ) break;
				[ heap[ p ], heap[ i ] ] = [ heap[ i ], heap[ p ] ];
				i = p;

			}

		};

		const pop = () => {

			const top = heap[ 0 ], last = heap.pop();
			if ( heap.length ) {

				heap[ 0 ] = last;
				let i = 0;
				for ( ;; ) {

					const l = i * 2 + 1, r = l + 1;
					let m = i;
					if ( l < heap.length && heap[ l ][ 0 ] < heap[ m ][ 0 ] ) m = l;
					if ( r < heap.length && heap[ r ][ 0 ] < heap[ m ][ 0 ] ) m = r;
					if ( m === i ) break;
					[ heap[ m ], heap[ i ] ] = [ heap[ i ], heap[ m ] ];
					i = m;

				}

			}

			return top;

		};

		cost[ s ] = 0;
		push( s, hcost( s ) );
		let n = 0;
		while ( heap.length && n ++ < maxExpand ) {

			const [ f, k ] = pop();
			if ( k === g ) break;
			if ( f - hcost( k ) > cost[ k ] + 1e-4 ) continue; // a stale entry
			const i = k % this.nx, j = Math.floor( k / this.nx );
			for ( let dj = - 1; dj <= 1; dj ++ ) for ( let di = - 1; di <= 1; di ++ ) {

				if ( ! di && ! dj ) continue;
				const ii = i + di, jj = j + dj;
				if ( ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz ) continue;
				const q = jj * this.nx + ii;
				if ( ! this.free( q ) || Math.abs( this.h[ q ] - this.h[ k ] ) > this.step ) continue;
				// no corner cutting past a blocked cell
				if ( di && dj && ( ! this.free( j * this.nx + ii ) || ! this.free( jj * this.nx + i ) ) ) continue;
				const c = cost[ k ] + ( di && dj ? 1.4142 : 1 );
				if ( c < cost[ q ] ) {

					cost[ q ] = c;
					from[ q ] = k;
					push( q, c + hcost( q ) );

				}

			}

		}

		if ( from[ g ] < 0 && g !== s ) return null;
		const cells = [];
		for ( let k = g; k !== s && k >= 0; k = from[ k ] ) cells.push( k );
		cells.reverse();
		// string-pull: keep only the corners (a straight line between kept points stays on free, level-enough cells)
		const out = [];
		let ax0 = this.cx( s ), az0 = this.cz( s );
		for ( let i = 0; i < cells.length; i ++ ) {

			const next = cells[ i + 1 ];
			if ( next !== undefined && this.clear( ax0, az0, this.cx( next ), this.cz( next ) ) ) continue;
			ax0 = this.cx( cells[ i ] );
			az0 = this.cz( cells[ i ] );
			out.push( { x: ax0, z: az0 } );

		}

		return out;

	}

	// a straight walk from a to b over free cells, no step higher than the grid's step between samples
	clear( ax, az, bx, bz ) {

		const len = Math.hypot( bx - ax, bz - az ), n = Math.max( 1, Math.ceil( len / ( this.cell * 0.5 ) ) );
		let prev = - 1;
		for ( let s = 0; s <= n; s ++ ) {

			const k = this.index( ax + ( bx - ax ) * s / n, az + ( bz - az ) * s / n );
			if ( ! this.free( k ) ) return false;
			if ( prev >= 0 && Math.abs( this.h[ k ] - this.h[ prev ] ) > this.step ) return false;
			prev = k;

		}

		return true;

	}

}

// his retargeted clips (tools/roid/retarget.mjs) -> engine clips for his SkinnedModel; names: the node names of his GLB
export function decodeRoidClips( data, names ) {

	const clips = [];
	const fromB64 = ( s ) => {

		const bin = typeof atob === 'function' ? atob( s ) : Buffer.from( s, 'base64' ).toString( 'binary' );
		const u8 = new Uint8Array( bin.length );
		for ( let i = 0; i < bin.length; i ++ ) u8[ i ] = bin.charCodeAt( i );
		return new Int16Array( u8.buffer );

	};

	for ( const [ name, c ] of Object.entries( data && data.clips || {} ) ) {

		const channels = [];
		const times = ( n ) => Float32Array.from( { length: n }, ( _, k ) => Math.min( c.duration, k / c.fps ) );
		for ( const ch of c.channels ) {

			const node = names.indexOf( ch.node );
			if ( node < 0 ) continue;
			channels.push( { node, path: 'rotation', times: times( ch.keys ), values: Float32Array.from( fromB64( ch.q ), ( v ) => v / 32767 ) } );

		}

		const pelvis = names.indexOf( 'pelvis' );
		if ( pelvis >= 0 && c.pelvis ) channels.push( { node: pelvis, path: 'translation', times: times( c.frames ), values: Float32Array.from( c.pelvis ) } );
		clips.push( { name, duration: c.duration, channels } );

	}

	return clips;

}

// the hour of the island clock and the camera, from the app when nobody passes them (the root does not need a patch)
const appClock = () => {

	const a = globalThis.__app, h = a && a.settings && a.settings.timeOfDay;
	return Number.isFinite( h ) ? h : null;

};

const appViewer = () => {

	const a = globalThis.__app;
	return a && a.camera && a.camera.position || null;

};

const angleTo = ( from, to ) => Math.atan2( Math.sin( to - from ), Math.cos( to - from ) );

export class CaptainRoid {

	// clock(): hour or null; viewer(): { x, z } or null; clipsData: the retargeted clips (tests; the game fetches them);
	// walk: true lets him walk without a loaded character (tests)
	constructor( { scene, terrain, colliders = null, clicks = null, material = null, clock = appClock, viewer = appViewer, clipsData = null, walk = false } ) {

		// keep him and his props out of the boathouse, the huts and the boats on the sand
		const blocked = colliders && colliders.resolveCapsule ? ( x, h, z, yaw ) => {

			for ( const [ lx, lz, r ] of FOOTPRINT ) {

				const [ wx, wz ] = toWorld( x, z, yaw, lx, lz );
				if ( colliders.resolveCapsule( { x: wx, y: h, z: wz }, r + 0.2, 1.8, 0.3 ) ) return true;

			}

			return colliders.groundHeightAt ? colliders.groundHeightAt( x, z, h + 3 ) > h + 0.3 : false; // under a deck or a roof

		} : null;
		placeRoid( terrain, YARD, ROID, blocked );
		// every line he says (here and from his panel: open, buy, broke) shows its subtitles
		this.clicks = clicks ? {
			raw: clicks,
			burst: ( kind, position = null, onPhrase = null ) => {

				const r = clicks.burst( kind, position || this.vendor.position );
				if ( kind !== 'hover' ) this._subtitles( kind, onPhrase );
				return r;

			},
		} : null;
		this.terrain = terrain;
		this.colliders = colliders;
		const { x, z, yaw } = ROID;
		const y = terrain.heightAt( x, z );
		this.home = { x, z, yaw };
		this.material = material || createPropMaterial( 'roidYard' );

		this.group = new Group();
		this.group.name = 'CaptainRoidYard';
		this.group.position.set( x, y, z );
		this.group.rotation.y = yaw;
		const props = new Mesh( buildProps(), this.material );
		props.name = 'RoidProps';
		props.castShadow = true;
		this.group.add( props );
		scene.add( this.group );

		this.vendor = new Vendor( {
			name: 'Captain Roid · Boat yard',
			kind: 'yard',
			position: new Vector3( x, y, z ),
			yaw,
			radius: 3.2,
			greeting: GREETING_FIRST,
			material: this.material,
			character: { url: MODEL, idle: 'Idle', talk: 'Repeat', greet: 'FirstEncounter' },
			look: { shirt: 0x9fc0e8, trousers: 0x8fa4b8, hair: 0x1a1512, skin: 0xb07a58 },
		} );
		this.vendor.driven = true; // roid.update moves and animates him (Game's vendor loop would run him twice)
		this.hooks = null; // { isMet(): bool, setMet() }, wired by Game to the save
		this._seen = false; // FirstEncounter has played this session
		scene.add( this.vendor.group );

		// the lantern on its post beside him (lit from dusk: the root adds this to localLights)
		const c = Math.cos( yaw ), s = Math.sin( yaw );
		const lx = LANTERN.x + 0.3; // the lantern hangs at the end of the arm
		const lp = new Vector3( x + lx * c + LANTERN.z * s, y + 1.83, z - lx * s + LANTERN.z * c );
		this.lights = [ { position: lp, color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } ];

		if ( colliders ) for ( const [ lx, lz, hx, hz, hy ] of COLLIDERS ) {

			const w = new Vector3( lx, 0, lz ).applyAxisAngle( new Vector3( 0, 1, 0 ), yaw );
			colliders.addBox( new Vector3( x + w.x, y + hy, z + w.z ), new Vector3( hx, hy, hz ), yaw, { tag: 'boatYardProps' } );

		}

		this._near = false;
		this._cool = 0;

		// his day: where he is, where he is going (see the header)
		this.clock = clock || ( () => null );
		this.viewer = viewer || ( () => null );
		this.pos = { x, y, z };
		this.yaw = yaw;
		this.stops = null; // made on the first update (the start feature's boardwalk and decks come after us)
		this.stopName = null;
		this.path = null;
		this.arrived = true;
		this.pose = 'stand'; // 'stand' | 'sitting' | 'rising'
		this._poseT = 0;
		this._actT = 0;
		this._greetT = 0;
		this._engaged = false;
		this._walkable = !! walk;
		this._rt = false; // the retargeted clips are in
		this._walkSpeed = 1.56;
		this.grid = null;
		this._gridT = 0;

		const data = clipsData ? Promise.resolve( clipsData ) : ( typeof fetch === 'function' ? Promise.resolve().then( () => fetch( CLIPS_URL ) ).then( ( r ) => ( r.ok ? r.json() : null ) ).catch( () => null ) : Promise.resolve( null ) );
		this.ready = Promise.all( [ this.vendor.loading, data ] ).then( ( [ , d ] ) => this._addClips( d ) ).catch( ( e ) => console.warn( 'CaptainRoid: clips failed', e ) );

	}

	// the retargeted clips into his SkinnedModel; the vendor's own clip-end hand-back would fight the routine
	_addClips( data ) {

		const c = this.vendor.character;
		if ( ! c ) return;
		c.onClipEnd = null;
		if ( ! data ) return;
		for ( const clip of decodeRoidClips( data, c.gltf.nodes.map( ( n ) => n.name ) ) ) c.clips.set( clip.name, clip );
		this._rt = c.clips.has( 'Idle_Breathe' );
		if ( Number.isFinite( data.walkSpeed ) ) this._walkSpeed = data.walkSpeed;
		this._walkable = this._walkable || c.clips.has( 'Walk_InPlace' );

	}

	// player: a position ( { x, z } ), a body with .position, or null (not on foot)
	update( dt, player ) {

		const p = player && player.position ? player.position : player;
		this._scenes();
		this._drive( Math.min( Math.max( dt, 0 ), 0.1 ), p );
		this._cool = Math.max( 0, this._cool - dt );
		if ( ! p ) {

			this._leave();
			return;

		}

		const d = Math.hypot( p.x - this.vendor.position.x, p.z - this.vendor.position.z );
		const near = d < this.vendor.radius + 4;
		if ( near === this._near ) return;
		if ( near ) {

			this._near = true;
			// he speaks only in clicks and calls (src/audio/RoidVoice.js); the words come as subtitles,
			// each phrase when its calls start
			let met = false;
			try { met = !! ( this.hooks && this.hooks.isMet() ); } catch ( e ) { met = false; }
			this._burst( met || this._seen ? 'repeat' : 'first' );

		} else this._leave();

	}

	// ---- the routine

	_hour() {

		try { return this.clock(); } catch ( e ) { return null; }

	}

	// the stops of his day, from the yard's layout (sign, crate, the waterline before the moorings and along the beach, the pier head)
	_makeStops() {

		const { x, z, yaw } = this.home, T = this.terrain;
		const waterline = ( sx, sz, dx, dz ) => {

			let px = sx, pz = sz;
			for ( let d = 0.5; d < 30; d += 0.5 ) {

				const qx = sx + dx * d, qz = sz + dz * d;
				if ( T.heightAt( qx, qz ) < 0.5 ) break;
				px = qx;
				pz = qz;

			}

			return { x: px, z: pz };

		};

		const [ bx, bz ] = toWorld( x, z, yaw, - 3.5, 0 ); // the boats: a few metres along the beach toward the boathouse, at the water
		const toYard = Math.atan2( YARD.x - bx, YARD.z - bz );
		const boats = waterline( bx, bz, Math.sin( toYard ), Math.cos( toYard ) );
		const [ ex, ez ] = toWorld( x, z, yaw, 7, 0 );
		const sea = waterline( ex, ez, Math.sin( yaw ), Math.cos( yaw ) );
		const [ cx, cz ] = toWorld( x, z, yaw, CRATE.x, CRATE.z + 0.1 ); // his feet a hand in front of the crate's middle
		const P = WORLD.pier;
		const pier = P ? { x: P.x + 3, z: P.zEnd - 3.5 } : { x, z };
		return {
			sign: { x, z, yaw, act: 'idle' },
			crate: { x: cx, z: cz, yaw, act: 'sit', approach: 0.9 },
			boats: { ...boats, yaw: Math.atan2( YARD.x - boats.x, YARD.z - boats.z ), act: 'point' },
			sea: { ...sea, yaw: yaw + 0.5, act: 'look' },
			pier: { ...pier, yaw: Math.PI / 2, act: 'look' }, // looking east over the berths
		};

	}

	_grid() {

		const S = Object.values( this.stops );
		if ( ! this.grid ) {

			const xs = S.map( ( s ) => s.x ), zs = S.map( ( s ) => s.z );
			this.grid = new WalkGrid( { terrain: this.terrain, colliders: this.colliders, x0: Math.min( ...xs ) - 12, x1: Math.max( ...xs ) + 12, z0: Math.min( ...zs ) - 12, z1: Math.max( ...zs ) + 6 } );

		}

		return this.grid;

	}

	_ground( x, z, fromY ) {

		if ( this.grid ) return this.grid.groundAt( x, z, fromY );
		const t = this.terrain.heightAt( x, z );
		const g = this.colliders && this.colliders.groundHeightAt ? this.colliders.groundHeightAt( x, z, ( Number.isFinite( fromY ) ? Math.max( fromY, t ) + 0.55 : Math.max( t, 0 ) + 3 ) ) : - Infinity;
		return Math.max( t, g );

	}

	// the way to a stop: grid corners, then (for the crate) the spot in front of it and the exact spot
	_plan( stop ) {

		const ax = stop.approach ? stop.x + Math.sin( stop.yaw ) * stop.approach : stop.x;
		const az = stop.approach ? stop.z + Math.cos( stop.yaw ) * stop.approach : stop.z;
		const g = this._grid();
		if ( this._gridT <= 0 ) {

			g.reset(); // props can move between walks
			this._gridT = 30;

		}

		// leaving the crate: step out in front of it first (his spot is inside its collider's margin)
		const ex = this._exit;
		this._exit = null;
		const route = ex ? [ ex ] : [];
		route.push( ...( g.find( ex ? ex.x : this.pos.x, ex ? ex.z : this.pos.z, ax, az ) || [] ) );
		if ( stop.approach ) route.push( { x: ax, z: az } );
		route.push( { x: stop.x, z: stop.z } );
		return route;

	}

	_sync() {

		const v = this.vendor;
		v.position.set( this.pos.x, this.pos.y, this.pos.z );
		v.group.position.copy( v.position );
		v.group.rotation.y = this.yaw;
		v.yaw = this.yaw;

	}

	_turn( to, dt, rate = 5 ) {

		const d = angleTo( this.yaw, to );
		this.yaw += Math.sign( d ) * Math.min( Math.abs( d ), rate * dt );
		return Math.abs( d );

	}

	_drive( dt, p ) {

		if ( ! this.stops ) this.stops = this._makeStops();
		this._gridT -= dt;
		const v = this.vendor, c = v.character;
		const viewer = p || ( () => { try { return this.viewer(); } catch ( e ) { return null; } } )();
		const dv = viewer ? Math.hypot( viewer.x - this.pos.x, viewer.z - this.pos.z ) : Infinity;
		const dp = p ? Math.hypot( p.x - this.pos.x, p.z - this.pos.z ) : Infinity;
		const wasEngaged = this._engaged;
		if ( dp < ENGAGE ) this._engaged = true;
		else if ( dp > RELEASE ) this._engaged = false;

		const want = this._walkable ? routineStop( this._hour() ) : 'sign';
		if ( want !== this.stopName ) {

			this.stopName = want;
			this.path = null;
			this.arrived = false;
			this._actT = 0;

		}

		const stop = this.stops[ this.stopName ];
		if ( dv > ACTIVE ) {

			// nobody near: he is simply at his stop (no walk, no animation)
			this.pos.x = stop.x;
			this.pos.z = stop.z;
			this.pos.y = this._ground( stop.x, stop.z, NaN );
			this.yaw = stop.yaw;
			this.arrived = true;
			this.path = null;
			this.pose = stop.act === 'sit' && ! this._engaged ? 'sitting' : 'stand';
			this._sitFromEnd = this.pose === 'sitting'; // seen again: already seated, not sitting down
			this._exit = stop.approach ? { x: stop.x + Math.sin( stop.yaw ) * stop.approach, z: stop.z + Math.cos( stop.yaw ) * stop.approach } : null;
			this._poseT = 0;
			this._sync();
			if ( c ) c.hold();
			return;

		}

		const K = v.clips || {}, has = ( n ) => !! ( c && c.clips.has( n ) );
		const idle = this._rt ? 'Idle_Breathe' : K.idle;
		let anim = idle, opts = { fade: 0.4 };

		// the greeting when the player walks up (FirstEncounter the first time; Repeat, a still pose, as a short talk)
		if ( this._engaged && ! wasEngaged && ! v.talking && K.greet ) {

			this._greetClip = K.greet === 'Repeat' && this._rt ? 'Talk' : K.greet;
			this._greetT = c && has( this._greetClip ) ? ( this._greetClip === 'Talk' ? 3 : c.clipDuration( this._greetClip ) ) : 0;

		}

		if ( this.pose === 'stand' ) this._greetT = Math.max( 0, this._greetT - dt ); // (after he is up from the crate)
		const moveWanted = ! this._engaged && ! this.arrived;
		if ( this.pose === 'sitting' && ( this._engaged || moveWanted || stop.act !== 'sit' ) ) {

			this.pose = 'rising';
			this._poseT = has( 'Sit_Down' ) ? c.clipDuration( 'Sit_Down' ) : 0;

		}

		if ( this.pose === 'rising' ) {

			this._poseT -= dt;
			anim = 'Sit_Down';
			opts = { fade: 0.15, loop: false, speed: - 1 };
			if ( this._poseT <= 0 ) this.pose = 'stand';

		} else if ( this.pose === 'sitting' ) {

			anim = 'Sit_Down';
			opts = { fade: 0.25, loop: false, from: this._sitFromEnd && c ? c.clipDuration( 'Sit_Down' ) : 0 };
			this._sitFromEnd = false;

		} else if ( this._engaged ) {

			// stop, turn to the player, greet / talk
			this._turn( Math.atan2( p.x - this.pos.x, p.z - this.pos.z ), dt, 4 );
			if ( v.talking ) anim = this._rt ? 'Talk' : K.talk;
			else if ( this._greetT > 0 ) {

				anim = this._greetClip;
				opts = { fade: 0.35, loop: false };

			}

		} else if ( ! this.arrived ) {

			if ( ! this.path ) this.path = this._plan( stop );
			const tgt = this.path[ 0 ];
			if ( ! tgt ) this.arrived = true;
			else {

				const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z, d = Math.hypot( dx, dz );
				const stepLen = WALK * dt;
				// turn first when the way is behind him, then walk
				const off = this._turn( Math.atan2( dx, dz ), dt, 4 );
				if ( d <= stepLen || d < 1e-4 ) {

					this.pos.x = tgt.x;
					this.pos.z = tgt.z;
					this.path.shift();
					if ( ! this.path.length ) {

						this.arrived = true;
						if ( stop.approach ) this._exit = { x: stop.x + Math.sin( stop.yaw ) * stop.approach, z: stop.z + Math.cos( stop.yaw ) * stop.approach };

					}

				} else if ( off < 1.2 ) {

					this.pos.x += dx / d * stepLen;
					this.pos.z += dz / d * stepLen;

				}

				this.pos.y = this._ground( this.pos.x, this.pos.z, this.pos.y );
				anim = 'Walk_InPlace';
				opts = { fade: 0.3, speed: WALK / this._walkSpeed };

			}

		}

		if ( this.arrived && this.pose === 'stand' && ! this._engaged ) {

			// at the stop: face its way, then its work
			this.pos.y = this._ground( this.pos.x, this.pos.z, this.pos.y );
			const off = this._turn( stop.yaw, dt, 3 );
			this._actT += dt;
			if ( stop.act === 'look' && has( 'Look_Around' ) ) anim = 'Look_Around';
			else if ( stop.act === 'point' && has( 'Point' ) ) anim = this._actT < c.clipDuration( 'Point' ) ? 'Point' : 'Look_Around';
			else if ( stop.act === 'sit' && has( 'Sit_Down' ) && off < 0.15 ) {

				this.pose = 'sitting';
				anim = 'Sit_Down';
				opts = { fade: 0.25, loop: false };

			}

		}

		this._sync();
		if ( ! c ) return;
		if ( ! has( anim ) ) anim = has( idle ) ? idle : c.current;
		if ( anim && c.current !== anim ) c.play( anim, opts );
		const L = c.layers && c.layers.find( ( l ) => l.target === 1 );
		if ( L && anim === 'Walk_InPlace' ) L.speed = opts.speed;
		if ( L && anim === 'Sit_Down' ) {

			// down plays forward and holds its last frame; rising plays it backward
			L.loop = false;
			L.speed = this.pose === 'rising' ? - 1 : 1;
			if ( this.pose === 'rising' ) L.time = Math.min( L.time, L.clip.duration );

		}

		c.update( dt );

	}

	// first meeting: FirstEncounter, remembered in the save (hooks.setMet); afterwards Repeat
	_scenes() {

		const v = this.vendor, K = v.clips, c = v.character;
		if ( ! K || ! c ) return;
		let met = false;
		try { met = !! ( this.hooks && this.hooks.isMet() ); } catch ( e ) { met = false; }
		if ( ! this._seen ) {

			K.greet = met ? 'Repeat' : 'FirstEncounter';
			if ( c.current === 'FirstEncounter' ) {

				this._seen = true;
				try { if ( this.hooks ) this.hooks.setMet(); } catch ( e ) { /* the save is optional */ }

			}

		} else if ( c.current !== 'FirstEncounter' ) K.greet = 'Repeat'; // never cut the first scene short
		v.greeting = this._opened || ( met && ! this._seen ) ? GREETING_REPEAT : GREETING_FIRST;

	}

	// his panel opened (HudPanels): from now on the panel line is the repeat one
	opened() {

		this._opened = true;

	}

	_leave() {

		if ( ! this._near ) return;
		this._near = false;
		this._burst( 'bye' );

	}

	// at most one proximity line per COOLDOWN seconds
	_burst( kind ) {

		if ( this._cool > 0 || ! this.clicks ) return;
		this._cool = COOLDOWN;
		this.clicks.burst( kind, this.vendor.position );

	}

	// a topic from his panel's Talk tab (HudPanels): the clicks and the subtitles of `kind`; onPhrase( { text,
	// start, end } ) is called as each phrase starts (the panel's chat log). Works without audio.
	say( kind, onPhrase = null ) {

		if ( this.clicks ) return this.clicks.burst( kind, null, onPhrase );
		this._subtitles( kind, onPhrase );
		return false;

	}

	// show a line's subtitles in time with its phrases (also when the sound could not play); a new line
	// cuts the old one's pending phrases, like the audio does
	_subtitles( kind, onPhrase = null ) {

		const said = linePhrases( kind );
		if ( ! said ) return;
		const spoken = said.phrases.filter( ( ph ) => ph.text );
		if ( ! spoken.length ) return;
		this._cancelSubtitles();
		for ( const ph of spoken ) {

			const show = () => {

				if ( this.hooks && this.hooks.subtitle ) try { this.hooks.subtitle( [ ph.text ] ); } catch ( e ) { /* optional */ }
				if ( onPhrase ) try { onPhrase( ph ); } catch ( e ) { /* optional */ }

			};

			if ( ph.start <= 0.01 || typeof setTimeout !== 'function' ) show();
			else ( this._timers || ( this._timers = [] ) ).push( setTimeout( show, ph.start * 1000 ) );

		}

	}

	_cancelSubtitles() {

		if ( ! this._timers || typeof clearTimeout !== 'function' ) return;
		for ( const t of this._timers ) clearTimeout( t );
		this._timers.length = 0;

	}

}

// sign posts, bollard, the lantern post and the crate: [ lx, lz, half x, half z, half height ] in the local frame
const COLLIDERS = [ [ - 1.25, - 1.2, 0.09, 0.09, 1.2 ], [ 1.25, - 1.2, 0.09, 0.09, 1.2 ], [ 1.4, 0.5, 0.2, 0.2, 0.25 ], [ LANTERN.x, LANTERN.z, 0.08, 0.08, 1.0 ], [ CRATE.x, CRATE.z, CRATE.w / 2, CRATE.d / 2, CRATE.h / 2 ] ];

// ---------------------------------------------------------------- the props

// 5 x 7 block letters for BOAT YARD
const FONT = {
	B: [ '1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.' ],
	O: [ '.111.', '1...1', '1...1', '1...1', '1...1', '1...1', '.111.' ],
	A: [ '.111.', '1...1', '1...1', '11111', '1...1', '1...1', '1...1' ],
	T: [ '11111', '..1..', '..1..', '..1..', '..1..', '..1..', '..1..' ],
	Y: [ '1...1', '1...1', '.1.1.', '..1..', '..1..', '..1..', '..1..' ],
	R: [ '1111.', '1...1', '1...1', '1111.', '1.1..', '1..1.', '1...1' ],
	D: [ '1111.', '1...1', '1...1', '1...1', '1...1', '1...1', '1111.' ],
};
const TEXT = 'BOAT YARD';

function buildProps() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	let seed = 29;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;

	// the sign: two posts (sunk into the sand) and a plank board of four boards, lettered on both faces
	const sz = - 1.2, bw = 2.5, bh = 0.62, by = 2.2;
	for ( const sx of [ - 1.25, 1.25 ] ) add( box( 0.14, 2.9, 0.14 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( sx, 1.1, sz, jit( 0.04 ), 0, jit( 0.04 ) ) } );
	for ( let i = 0; i < 4; i ++ ) add( box( bw, bh / 4 - 0.006, 0.05 ), { ...WOODX( [ 0x2d4a63, 0x2a4660, 0x30506b, 0x2b4963 ][ i ] ), matrix: mat4( jit( 0.01 ), by - bh / 2 + ( i + 0.5 ) * bh / 4, sz, 0, 0, jit( 0.006 ) ) } );
	for ( const y of [ by - bh / 2 + 0.07, by + bh / 2 - 0.07 ] ) add( box( bw + 0.04, 0.04, 0.07 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 0, y, sz ) } );
	const px = 0.042, adv = 6 * px, tw = TEXT.length * adv - px, ty = by + 3.5 * px - 0.01;
	for ( const side of [ 1, - 1 ] ) {

		let x0 = - tw / 2;
		for ( const ch of TEXT ) {

			const rows = FONT[ ch ];
			if ( rows ) rows.forEach( ( row, r ) => {

				// merge each run of lit pixels into one board
				let c = 0;
				while ( c < 5 ) {

					if ( row[ c ] !== '1' ) { c ++; continue; }
					let e = c;
					while ( e < 5 && row[ e ] === '1' ) e ++;
					const cx = x0 + ( c + e ) / 2 * px;
					add( box( ( e - c ) * px, px, 0.012 ), { color: 0xf0e6c8, rough: 0.7, matrix: mat4( side * cx, ty - ( r + 0.5 ) * px, sz + side * 0.03 ) } );
					c = e;

				}

			} );
			x0 += adv;

		}

	}

	// a coil of mooring line, a bollard with a turn of rope, a lifebuoy-red float on the board's post
	for ( let i = 0; i < 5; i ++ ) add( torus( 0.24 - i * 0.012, 0.02, 6, 20 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 1.0, 0.025 + i * 0.04, 0.9 + jit( 0.01 ), Math.PI / 2, 0, 0 ) } );
	add( cylinder( 0.1, 0.12, 0.55, 12 ), { ...WOOD( 0x5b4d3e ), matrix: mat4( 1.4, 0.2, 0.5 ) } );
	add( sphere( 0.12, 10, 8 ), { ...WOOD( 0x5b4d3e ), matrix: mat4( 1.4, 0.48, 0.5 ) } );
	add( torus( 0.11, 0.018, 6, 16 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 1.4, 0.38, 0.5, Math.PI / 2, 0, 0 ) } );
	for ( let i = 0; i < 3; i ++ ) add( sphere( 0.09, 10, 8 ), { color: [ 0xe2552a, 0xe8e2d0, 0xf2c230 ][ i ], rough: 0.5, matrix: mat4( - 0.95 + i * 0.13, 0.09, - 0.55 ) } );

	// the crate he sits on: slats round a frame, a lid of three boards
	{

		const { x: cx, z: cz, w, h, d } = CRATE;
		for ( const [ ox, oz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ] ] ) add( box( 0.05, h - 0.02, 0.05 ), { ...WOOD( 0x5b4d3e ), matrix: mat4( cx + ox * ( w / 2 - 0.025 ), ( h - 0.02 ) / 2, cz + oz * ( d / 2 - 0.025 ) ) } );
		for ( let i = 0; i < 3; i ++ ) {

			const y = 0.07 + i * 0.13;
			for ( const side of [ - 1, 1 ] ) {

				add( box( w - 0.02, 0.09, 0.018 ), { ...WOODX( 0x9a7f5e ), matrix: mat4( cx, y, cz + side * ( d / 2 - 0.009 ), 0, 0, jit( 0.02 ) ) } );
				add( box( 0.018, 0.09, d - 0.06 ), { ...WOOD( 0x8f7454 ), matrix: mat4( cx + side * ( w / 2 - 0.009 ), y, cz, 0, 0, jit( 0.02 ) ) } );

			}

		}

		for ( let i = 0; i < 3; i ++ ) add( box( w, 0.025, d / 3 - 0.01 ), { ...WOODX( [ 0xa68b68, 0x947a59, 0x9a7f5e ][ i ] ), matrix: mat4( cx, h - 0.0125, cz - d / 3 + i * d / 3, jit( 0.01 ), jit( 0.04 ), 0 ) } );

	}

	// the lantern post: an upright with a short arm and a glass lantern
	const lx = LANTERN.x, lz = LANTERN.z;
	add( box( 0.1, 2.1, 0.1 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( lx, 0.95, lz ) } );
	add( box( 0.4, 0.06, 0.06 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( lx + 0.15, 2.0, lz ) } );
	add( cylinder( 0.07, 0.07, 0.24, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( lx + 0.3, 1.83, lz ) } );
	add( cylinder( 0.03, 0.09, 0.05, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( lx + 0.3, 1.98, lz ) } );
	add( cylinder( 0.09, 0.07, 0.03, 8 ), { color: 0x2a2a2a, rough: 0.5, metal: 0.6, matrix: mat4( lx + 0.3, 1.7, lz ) } );
	return mergePrepared( P );

}
