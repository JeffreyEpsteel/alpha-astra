// Wave 19E: walk into the tavern and the shops. Plain node, no GPU: the furniture kit (public/models/interiors/kit.glb,
// tools/interiors/kit.py) has every piece the rooms place; every room fits its shell, keeps the doorway, the spawn, the
// staff's spot and the counter clear; the shells that open (Tidemark's tavern, chandlery and harbourmaster's office, the
// Rum Hole, the Upturned Keel and Ethena's store) register with hollow colliders: a walker gets in through the door and
// not through a wall; the rooms load near and unload far (their colliders and lights with them); the indoor camera stays
// in the room; the seats list; the barkeep's E opens the tavern window at the bar, the shop clerk is a vendor only from
// inside; a destroyed building ejects the player, bars the door and comes back when mended.
//   node test/feature-interiors.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
let fails = 0, n = 0;
const ok = ( c, msg, info = '' ) => {

	n ++;
	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else console.log( 'ok  ', msg, info );

};
const section = ( s ) => console.log( '\n== ' + s );

globalThis.__assetFile = async ( url ) => {

	const b = readFileSync( join( root, 'public', url.replace( /^\/+/, '' ) ) );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};
globalThis.fetch = () => Promise.reject( new Error( 'no network in the test' ) );
globalThis.__noCharacters = true;
globalThis.__quietKit = true;
const warn = console.warn;
console.warn = () => {};

const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { ensureTidemark } = await import( '../src/world/islands/town/TidemarkTerrain.js' );
const { buildShells, INTERIOR_OF } = await import( '../src/world/islands/town/Buildings.js' );
const { buildHouse } = await import( '../src/world/village/Buildings.js' );
const { Builder } = await import( '../src/world/village/GeoBuilder.js' );
const { InstancedProps, Rand } = await import( '../src/world/Props.js' );
const { mulberry32 } = await import( '../src/util/Noise.js' );
const { Colliders } = await import( '../src/world/Colliders.js' );
const { createPropMaterial } = await import( '../src/game/GameMaterials.js' );
const { pieceTriangles } = await import( '../src/world/village/TownKit.js' );
const { INTERIORS, SHELL_HINTS, layoutRoom, OPEN_DOORS } = await import( '../src/world/interiors/Rooms.js' );
const { shells, clearShells } = await import( '../src/world/interiors/Shells.js' );
const { Interiors, loadInteriorKit, ARM_INDOOR } = await import( '../src/world/interiors/Interiors.js' );
const { InteriorsFeature } = await import( '../src/world/interiors/index.js' );
const { Vector3 } = await import( '../src/engine/index.js' );

// ------------------------------------------------------------------------------ the kit
section( 'the furniture kit (Blender)' );
const pieces = await loadInteriorKit();
ok( pieces && Object.keys( pieces ).length >= 35, 'kit.glb loads: one root object per piece', pieces ? Object.keys( pieces ).length + ' pieces' : 'missing' );
const used = new Set();
for ( const def of INTERIORS ) for ( const p of layoutRoom( def, SHELL_HINTS[ def.id ] ).pieces ) used.add( p.piece );
const missing = [ ...used ].filter( ( k ) => ! pieces || ! pieces[ k ] );
ok( missing.length === 0, 'every piece the rooms place is in the kit', missing.join() );
const tris = Object.fromEntries( Object.entries( pieces || {} ).map( ( [ k, v ] ) => [ k, pieceTriangles( v ) ] ) );
ok( Object.values( tris ).every( ( v ) => v >= 40 && v <= 3000 ), 'every piece 40..3000 triangles', Object.values( tris ).reduce( ( a, b ) => a + b, 0 ) + ' in all' );
ok( pieces && [ 'hearth', 'candle', 'candle_bottle', 'lantern_hang', 'chandelier' ].every( ( k ) => pieces[ k ].some( ( p ) => p.glow ) ) && ! pieces.table_round.some( ( p ) => p.glow ), 'flames, embers and lamp glass are glow parts; the tables are not' );
const kb = readFileSync( join( root, 'public/models/interiors/kit.glb' ) ).length;
ok( kb < 2e6, 'the GLB is small (no textures)', ( kb / 1024 ).toFixed( 0 ) + ' KB' );

// ------------------------------------------------------------------------------ the layouts
section( 'the rooms fit their shells' );
const inBox = ( s, x, z, r = 0 ) => Math.abs( x - s.x ) < s.hx + r && Math.abs( z - s.z ) < s.hz + r;
for ( const def of INTERIORS ) {

	const R = layoutRoom( def, SHELL_HINTS[ def.id ] );
	const out = R.pieces.filter( ( p ) => Math.abs( p.x ) > R.X + 0.05 || Math.abs( p.z ) > R.Z + 0.05 || p.y > R.h + 0.01 );
	const solidsOut = R.solids.filter( ( s ) => Math.abs( s.x ) - s.hx > R.X + 0.05 || Math.abs( s.z ) - s.hz > R.Z + 0.06 || s.h > R.h + 0.01 );
	// the way in: the doorway to the spawn and on to the counter's front, a 0.3 m capsule clear of every solid
	const path = [ [ R.doorX, R.Z + 0.3 ], [ R.spawn.x, R.spawn.z ] ];
	if ( R.staff ) path.push( [ R.staff.at.x, R.staff.at.z ] );
	const blocked = [];
	for ( let k = 1; k < path.length; k ++ ) for ( let i = 0; i <= 20; i ++ ) {

		const x = path[ k - 1 ][ 0 ] + ( path[ k ][ 0 ] - path[ k - 1 ][ 0 ] ) * i / 20, z = path[ k - 1 ][ 1 ] + ( path[ k ][ 1 ] - path[ k - 1 ][ 1 ] ) * i / 20;
		for ( const s of R.solids ) if ( inBox( s, x, z, 0.28 ) ) blocked.push( `${ x.toFixed( 1 ) },${ z.toFixed( 1 ) }` );

	}

	const staffIn = R.staff && R.solids.some( ( s ) => inBox( s, R.staff.x, R.staff.z, 0.15 ) );
	const seatsBad = R.seats.filter( ( s ) => Math.abs( s.x ) > R.X - 0.2 || Math.abs( s.z ) > R.Z - 0.2 || R.solids.some( ( q ) => inBox( q, s.x, s.z, 0.05 ) ) );
	const lightsOk = R.lights.length >= 1 && R.lights.length <= 3 && R.lights.every( ( l ) => l.y < R.h && Math.abs( l.x ) < R.X && Math.abs( l.z ) < R.Z );
	ok( ! out.length && ! solidsOut.length && ! blocked.length && ! staffIn && ! seatsBad.length && lightsOk, `${ def.id }: pieces and colliders inside, the way in clear, staff and seats free, 1-3 lights`,
		`${ R.pieces.length } pieces, ${ R.solids.length } solids, ${ R.seats.length } seats, ${ R.lights.length } lights ${ out.map( ( p ) => p.piece ).join() } ${ blocked.slice( 0, 3 ).join( ' ' ) }${ staffIn ? ' staff' : '' } ${ seatsBad.map( ( s ) => s.n ).join() }` );

}

ok( layoutRoom( INTERIORS[ 0 ], SHELL_HINTS[ 'tidemark.tavern' ] ).seats.length >= 10, 'the Tide & Tankard seats ten or more (bar stools, two tables, the dice table, the hearth)' );

// ------------------------------------------------------------------------------ the shells
section( 'the shells that open: hollow colliders, a doorway' );
const t = new TerrainData();
const tile = ensureTidemark( t );
const standIns = () => {

	const mats = {};
	for ( const k of [ 'wood', 'hard', 'roofMetal', 'thatch', 'stone', 'fabric', 'net' ] ) mats[ k ] = createPropMaterial( 'stand-in ' + k );
	return { materials: mats, textures: { bake() {} } };

};
clearShells();
const colliders = new Colliders();
const sh = buildShells( { terrain: tile, colliders, village: standIns(), propMaterial: createPropMaterial( 'p' ) } );
ok( Object.values( INTERIOR_OF ).every( ( id ) => shells().has( id ) ) && sh.list.filter( ( b ) => b.interior ).length === 3, 'Tidemark registers the tavern, the chandlery and the harbourmaster\'s office', [ ...shells().keys() ].join() );
ok( sh.list.find( ( b ) => b.id === 'tavern' ).interior === 'tidemark.tavern', 'the shells list names each building\'s interior (the damage states reach it)' );
// the home village's two: through buildHouse with Village.js's specs (house C, stilt hut S2)
{

	const B = new Builder(), rand = new Rand( mulberry32( 3 ) );
	const ctx = { B, terrain: t, colliders, rand, lights: [], inst: new InstancedProps( B ), checks: [] };
	buildHouse( ctx, { name: 'C', x: 62.5, z: - 106.0, yaw: - 0.1, w: 7.0, d: 5.8, stories: 2, roof: 'gableFront', roofMat: 'metal', wall: [ 0.9, 0.9, 0.8 ], trim: [ 1, 1, 1 ], accent: [ 0.2, 0.3, 0.6 ], siding: 1, porch: { depth: 2.2, rail: 'x' }, paint: 0.7, doorGlass: true } );
	buildHouse( ctx, { name: 'S2', harbor: true, x: 79.8, z: - 70.4, yaw: - 0.12, w: 4.4, d: 4.0, floorY: 3.05, foundation: 'stilts', roof: 'gableFront', roofMat: 'thatch', wall: [ 0.9, 0.6, 0.5 ], trim: [ 1, 1, 0.9 ], accent: [ 0.2, 0.5, 0.5 ], siding: 2, porch: { depth: 1.6, rail: 'x' }, fewWindows: true } );
	buildHouse( ctx, { name: 'C', x: 10, z: 10, yaw: 0, w: 5, d: 5 } ); // (a house called C elsewhere stays shut)
	ok( OPEN_DOORS.every( ( o ) => shells().has( o.id ) ) && [ ...shells().values() ].filter( ( s ) => Math.hypot( s.x - 10, s.z - 10 ) < 1 ).length === 0, 'the Upturned Keel (house C) and Ethena\'s store (S2) open; a namesake elsewhere does not' );

}

{

	const { ensureBlackwater } = await import( '../src/world/islands/BlackwaterTerrain.js' );
	const { Blackwater } = await import( '../src/world/islands/Blackwater.js' );
	ensureBlackwater( t );
	const scene = { children: [], add( o ) { this.children.push( o ); } };
	new Blackwater( { scene, terrain: t, colliders } );
	const rh = shells().get( 'blackwater.rumhole' );
	ok( !! rh && colliders.boxes.filter( ( b ) => b.tag === 'bwTavern' ).length === 1, 'the Rum Hole opens (Shells.openCottage: one bwTavern collider, hollow walls)' );
	if ( rh ) {

		// the floor clears the ground inside the footprint (the terrain must not come through the floor)
		const c = Math.cos( rh.yaw ), s = Math.sin( rh.yaw );
		let worst = - Infinity;
		for ( let i = - 3; i <= 3; i ++ ) for ( let j = - 2; j <= 2; j ++ ) {

			const lx = i * ( rh.w / 2 - 0.3 ) / 3, lz = j * ( rh.d / 2 - 0.3 ) / 2;
			worst = Math.max( worst, t.heightAt( rh.x + lx * c + lz * s, rh.z - lx * s + lz * c ) - rh.floorY );

		}

		ok( worst < - 0.02, 'the Rum Hole\'s floor stands above the ground everywhere inside', worst.toFixed( 2 ) + ' m' );

	}

}

// walk a 0.3 m capsule (Player.updateWalk's collision: resolveCapsule + walkable ground) along a straight line
function walk( from, to, terrain = t, steps = 240 ) {

	const p = new Vector3( from.x, from.y, from.z );
	for ( let i = 1; i <= steps; i ++ ) {

		const k = i / steps;
		const tx = from.x + ( to.x - from.x ) * k, tz = from.z + ( to.z - from.z ) * k;
		// a step toward the target (stays where it is pushed: a wall stops the walker)
		const dx = tx - p.x, dz = tz - p.z, d = Math.hypot( dx, dz ), st = Math.min( d, 0.06 );
		if ( d > 1e-6 ) { p.x += dx / d * st; p.z += dz / d * st; }
		colliders.resolveCapsule( p, 0.3, 1.75, 0.4 );
		const g = Math.max( terrain.heightAt( p.x, p.z ), colliders.groundHeightAt( p.x, p.z, p.y + 0.45 ) );
		p.y = g;

	}

	return p;

}

section( 'walking in and not through the walls' );
const rooms = new Interiors( { colliders, lights: null, meshes: false } );
ok( rooms.list.length === INTERIORS.length, 'every interior binds to its shell', rooms.list.map( ( r ) => r.id ).join() );
for ( const room of rooms.list ) {

	const d = rooms.door( room ), sp = rooms.enter( room.id );
	rooms.update( 0.016, { x: d.x, y: room.floorY, z: d.z } ); // (loads it: its furniture colliders)
	const startY = Math.max( t.heightAt( d.x, d.z ), colliders.groundHeightAt( d.x, d.z, room.floorY + 0.5 ) );
	const end = walk( { x: d.x, y: startY, z: d.z }, sp );
	const got = rooms.contains( room, end.x, end.y, end.z ) && Math.hypot( end.x - sp.x, end.z - sp.z ) < 0.25 && Math.abs( end.y - room.floorY ) < 0.05;
	// from the side, 2 m out, straight at the wall
	const sideOut = rooms.world( room, room.R.X + room.shell.t + 2.0, - room.R.Z * 0.5 );
	const sideIn = rooms.world( room, 0, - room.R.Z * 0.5 );
	const sy = Math.max( t.heightAt( sideOut.x, sideOut.z ), colliders.groundHeightAt( sideOut.x, sideOut.z, room.floorY + 0.5 ) );
	const hit = walk( { x: sideOut.x, y: sy, z: sideOut.z }, { x: sideIn.x, y: room.floorY, z: sideIn.z } );
	const through = rooms.contains( room, hit.x, hit.y, hit.z, 0.05 );
	ok( got && ! through, `${ room.id }: in through the door onto the floor, not through the side wall`, `end ${ end.x.toFixed( 2 ) },${ end.y.toFixed( 2 ) },${ end.z.toFixed( 2 ) } floor ${ room.floorY.toFixed( 2 ) }` );

}

section( 'loading near, unloading far; the indoor camera' );
{

	const L = { list: [], add( l ) { this.list.push( l ); return l; }, remove( l ) { const i = this.list.indexOf( l ); if ( i >= 0 ) this.list.splice( i, 1 ); } };
	const r2 = new Interiors( { colliders, lights: L, meshes: false } );
	const tav = r2.byId.get( 'tidemark.tavern' );
	const n0 = colliders.boxes.length;
	const sp = r2.enter( 'tidemark.tavern' );
	const inside = r2.update( 0.016, sp );
	const on = r2.list.filter( ( r ) => r.loaded );
	const sum = ( k ) => on.reduce( ( a, r ) => a + r.R[ k ].length, 0 );
	ok( inside === tav && tav.loaded && colliders.boxes.length === n0 + sum( 'solids' ) && L.list.length === sum( 'lights' ) && on.length <= 2, 'inside the tavern: loaded (and the office 30 m off), the furniture colliders and the lights in', `${ on.map( ( r ) => r.id ).join() }: ${ sum( 'solids' ) } colliders, ${ L.list.length } lights` );
	ok( L.list.every( ( l ) => l.indoor === 1 && l.range > 0 ), 'the room\'s lights are marked indoor (the LocalLights patch lights them by day)' );
	const far = { x: sp.x + 200, y: sp.y, z: sp.z };
	r2.update( 0.016, { x: sp.x + 40, y: sp.y, z: sp.z } );
	const still = tav.loaded;
	r2.update( 0.016, far );
	ok( still && ! tav.loaded && colliders.boxes.length === n0 && L.list.length === 0 && r2.inside === null, 'it stays loaded a little past the load distance, unloads far away (colliders and lights out)' );
	r2.update( 0.016, sp );
	// the camera: from the room's middle toward the back wall, and up into the ceiling
	const back = r2.world( tav, 0, 0 ), pivot = new Vector3( back.x, tav.floorY + 1.45, back.z );
	const toBack = new Vector3( - Math.sin( tav.F.yaw ), 0, - Math.cos( tav.F.yaw ) );
	const tb = r2.probe( pivot, toBack, 9 );
	ok( tb <= ARM_INDOOR + 1e-6 && tb > 1, 'the arm is shorter indoors', tb.toFixed( 2 ) + ' m' );
	const nearWall = r2.world( tav, 0, - tav.R.Z + 1.0 ), pv = new Vector3( nearWall.x, tav.floorY + 1.45, nearWall.z );
	const tw = r2.probe( pv, toBack, 4.2 );
	const up = r2.probe( pivot, new Vector3( 0, 1, 0 ), 4.2 );
	ok( tw < 1.0 - 0.15 && up < tav.R.h - 1.45, 'it stops short of the wall behind and of the ceiling', `wall ${ tw.toFixed( 2 ) } m, ceiling ${ up.toFixed( 2 ) } m` );
	ok( r2.probe( pivot, toBack, 3, null ) === 3, 'outside, the arm is the player\'s own' );
	r2.update( 0.016, far );

}

// ------------------------------------------------------------------------------ the feature: people, the bar, the shop, destruction
section( 'the feature: the bar, the shop clerk, seats, destruction' );
{

	const handlers = {}, inter = [], emitted = [];
	const features = {
		on( k, fn ) { ( handlers[ k ] = handlers[ k ] || [] ).push( fn ); return () => {}; },
		emit( k, e ) { emitted.push( k ); for ( const fn of handlers[ k ] || [] ) fn( e ); },
		interactable( e ) { inter.push( e ); return () => {}; },
		get( k ) { return k === 'harbour' ? harbour : null; },
	};
	const harbour = { sites: { tavern: [ { port: 'tidemark', name: 'The Tide & Tankard', x: 0, z: 0, keeper: 'keeper1' } ] }, openSite: null, panel: { isOpen: false, site: null, show( s ) { this.isOpen = true; this.site = s; return true; }, close() { this.isOpen = false; } }, close() { this.panel.close(); this.openSite = null; } };
	const damage = { s: {}, state( id ) { return this.s[ id ] || 'ok'; } };
	const scene = { children: [], add( o ) { this.children.push( o ); o.parent = this; }, remove( o ) { const i = this.children.indexOf( o ); if ( i >= 0 ) this.children.splice( i, 1 ); o.parent = null; } };
	const toasts = [];
	const app = {
		scene, colliders, localLights: null, ports: { tidemark: { damage, buildings: sh.list } },
		player: { position: new Vector3(), velocity: new Vector3(), yaw: 0, mode: 'walk', view: 'third', armPivot: new Vector3(), groundAt: ( x, z, m ) => Math.max( t.heightAt( x, z ), colliders.groundHeightAt( x, z, m ) ) },
		game: { vendors: [], toast: ( s ) => toasts.push( s ) },
		camera: { position: new Vector3() },
	};
	const it = new InteriorsFeature( app, features, { meshes: false } );
	ok( inter.length === 4, 'E spots: three bars and the office\'s notice board', inter.map( ( e ) => e.id ).join() );
	it.enter( 'tidemark.tavern' );
	it.update( 0.016 );
	ok( it.inside && it.inside.id === 'tidemark.tavern' && emitted.includes( 'interiorEntered' ) && toasts.includes( 'The Tide & Tankard' ), 'enter: inside the Tide & Tankard (interiorEntered, its name as a brief toast)' );
	ok( app.player.indoor && typeof app.player.indoor.arm === 'function', 'player.indoor.arm is there for the spring arm' );
	const bar = inter.find( ( e ) => e.id === 'interior:tidemark.tavern' );
	const at = bar.position();
	app.player.position.set( at.x, app.player.position.y, at.z );
	it.update( 0.016 );
	ok( bar.when() && bar.prompt() === 'Order at the bar', 'at the bar: E orders' );
	bar.onInteract();
	ok( harbour.panel.isOpen && harbour.openSite && harbour.openSite.port === 'tidemark' && harbour.openSite.keeper === 'keeper1' && Math.hypot( harbour.openSite.x - at.x, harbour.openSite.z - at.z ) < 0.01, 'the tavern window opens for the bar (the port\'s keeper, its close distance counted from the bar)' );
	ok( bar.prompt() === 'Leave the bar', 'E again leaves' );
	bar.onInteract();
	ok( ! harbour.panel.isOpen, 'and closes it' );
	const seats = it.seatsFor( 'tidemark' );
	const tav = it.rooms.byId.get( 'tidemark.tavern' );
	ok( seats.length >= 10 && seats.every( ( s ) => s.y > s.floor + 0.3 && s.y < s.floor + 0.8 && Number.isFinite( s.yaw ) && s.id.startsWith( 'interior.' ) ), 'seatsFor( tidemark ): the rooms\' seats in world space for townlife', seats.length + ' seats' );
	ok( it.seatsFor( 'home' ).length >= 6 && it.seatsFor( 'blackwater' ).length >= 6, 'the Upturned Keel and the Rum Hole publish theirs too', it.seatsFor( 'home' ).length + ' / ' + it.seatsFor( 'blackwater' ).length );
	// the shop: the clerk is a vendor of the game only while the chandlery is loaded, in range only from inside
	it.enter( 'tidemark.chandler' );
	it.update( 0.016 );
	const clerk = app.game.vendors.find( ( v ) => v.kind === 'shop' && /Tobias/.test( v.name ) );
	const ch = it.rooms.byId.get( 'tidemark.chandler' ), cs = it.rooms.staff( ch );
	app.player.position.set( cs.at.x, ch.floorY, cs.at.z );
	it.update( 0.016 );
	const inside = clerk && clerk.inRange( app.player.position );
	const behind = it.rooms.world( ch, cs.x - ch.F.x === 0 ? 0 : 0, - ch.R.Z - ch.shell.t - 0.35 );
	app.player.position.set( behind.x, ch.floorY, behind.z );
	it.update( 0.016 );
	ok( clerk && inside && ! clerk.inRange( app.player.position ), 'the chandlery\'s clerk sells (a shop vendor) from behind his counter, never through the back wall' );
	app.player.position.set( ch.F.x + 300, 0, ch.F.z );
	it.update( 0.016 );
	ok( ! app.game.vendors.includes( clerk ), 'far away the clerk is gone again (unloaded)' );
	// destruction: the tavern's roof smokes -> out, barred; mended -> back
	it.enter( 'tidemark.tavern' );
	it.update( 0.016 );
	damage.s.tavern = 'smoking';
	it.update( 0.6 );
	const pp = app.player.position;
	ok( tav.destroyed && ! it.rooms.contains( tav, pp.x, pp.y, pp.z, 0.2 ) && emitted.includes( 'interiorEjected' ) && ! tav.loaded && it.inside === null, 'a smoking tavern ejects the player onto the step and unloads', `${ pp.x.toFixed( 1 ) },${ pp.z.toFixed( 1 ) }` );
	const d = it.door( 'tidemark.tavern' ), sp = it.rooms.enter( 'tidemark.tavern' );
	const barred = walk( { x: d.x, y: pp.y, z: d.z }, sp );
	ok( ! it.rooms.contains( tav, barred.x, barred.y, barred.z ) && it.seatsFor( 'tidemark' ).every( ( s ) => s.interior !== 'tidemark.tavern' ), 'its door is barred and its seats withdrawn while it burns' );
	damage.s.tavern = 'cracked';
	it.update( 0.6 );
	const back = walk( { x: d.x, y: pp.y, z: d.z }, sp );
	ok( ! tav.destroyed && it.rooms.contains( tav, back.x, back.y, back.z ), 'mended: the door opens and the room comes back' );
	it.update( 0.016 );
	ok( tav.loaded, 'and loads again' );
	// a destruction prop event with the room's id does the same; its respawn restores
	features.emit( 'propDestroyed', { id: 'blackwater.rumhole' } );
	const rh = it.rooms.byId.get( 'blackwater.rumhole' );
	const was = rh.destroyed;
	features.emit( 'propRespawned', { id: 'blackwater.rumhole' } );
	ok( was && ! rh.destroyed, 'propDestroyed / propRespawned with a room\'s id destroy and restore it' );
	it.dispose();
	ok( app.player.indoor === null, 'dispose lets go of the camera' );

}

console.warn = warn;
console.log( `\n${ n - fails } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
