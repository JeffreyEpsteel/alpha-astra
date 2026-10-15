// Plain-node tests of the world map (src/features/worldmap + src/ui/WorldMap.js marker logic): the bounds, the fog grid
// and its save, the pan / zoom view, the waypoint (feature, minimap hand-off, arrival), discovery, the marker list
// (stalls, ports, ships, bounties, search zones, seaplane, peers, boat) and the shared terrain bake.
import { WORLD } from '../src/world/WorldLayout.js';
import { install, WorldMapFeature } from '../src/features/worldmap/index.js';
import { FogGrid, MapView, worldBounds, edgeClamp, niceScale, pickWaypoint, revealRadius, compass, viewAngle, yawAngle, FOG_CELL, discoveryState, legendRows, LEGEND_KINDS, questPinMarker, questPinId, parkedAirframes, portMarkerKind } from '../src/features/worldmap/MapLogic.js';
import { WorldMap } from '../src/ui/WorldMap.js';
import { Minimap, TerrainBake, ICON, portKnown } from '../src/game/Minimap.js';
import { CAMP } from '../src/features/melee/MeleeData.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;

// ---- bounds: the heightmap plus every island and port
{

	const B = worldBounds( WORLD, { size: 2048, origin: - 1024 } );
	ok( B.x0 <= - 1024 && B.z0 <= - 1024 && B.x1 >= 1024 && B.z1 >= 1024, 'bounds cover the heightmap' );
	const inside = ( x, z ) => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1;
	ok( WORLD.islands.every( ( i ) => inside( i.center.x, i.center.z ) ) && WORLD.ports.every( ( p ) => inside( p.stand.x, p.stand.z ) ), 'every island and port is inside' );
	const far = worldBounds( { islands: [ { id: 'far', center: { x: 3000, z: - 2500 }, radius: 100 } ], ports: [] }, { size: 2048, origin: - 1024 } );
	ok( far.x1 >= 3100 && far.z0 <= - 2600, 'an island beyond the heightmap widens the map' );
	const none = worldBounds( {}, null );
	ok( none.x0 < 0 && none.x1 > 0, 'no data: a default square' );

}

// ---- fog grid
{

	const B = { x0: - 1024, z0: - 1024, x1: 1024, z1: 1024 };
	const f = new FogGrid( B, FOG_CELL );
	ok( f.nx === 32 && f.nz === 32 && f.count === 0, 'a 2048 m world: 32 x 32 cells of 64 m, all fogged' );
	const v0 = f.version;
	const n = f.reveal( 0, 0, 120 );
	ok( n > 4 && f.count === n && f.version > v0, `revealing 120 m clears ${ n } cells and bumps the version` );
	ok( f.revealedAt( 10, - 10 ) && ! f.revealedAt( 900, 900 ), 'revealedAt: near yes, far no' );
	ok( f.reveal( 0, 0, 120 ) === 0, 'revealing the same place again adds nothing' );
	ok( f.reveal( 500, 500, 0 ) === 1, 'radius 0 still clears the cell underfoot' );
	ok( f.reveal( NaN, 0, 100 ) === 0 && f.reveal( 99999, 99999, 50 ) === 0, 'bad or outside positions reveal nothing' );
	const soft = f.softAt( null, 0, 0 );
	ok( soft > 0.5 && f.softAt( null, - 900, - 900 ) === 0, 'softAt: explored ~1, unexplored 0' );
	const mask = f.circleMask( [ { x: - 600, z: - 600, r: 100 } ] );
	ok( mask[ f.index( - 600, - 600 ) ] === 1 && ! mask[ f.index( 600, - 600 ) ], 'circleMask marks a charted island' );
	ok( f.softAt( mask, - 600, - 600 ) > 0.5, 'softAt counts the charted mask' );

	// save round trip
	const j = JSON.parse( JSON.stringify( f.toJSON() ) );
	const g = new FogGrid( B, FOG_CELL );
	ok( g.fromJSON( j ) && g.count === f.count && g.revealedAt( 0, 0 ) && g.revealedAt( 500, 500 ), 'fog survives the save' );
	ok( j.bits.length === Math.ceil( 32 * 32 / 4 ), 'the save is compact (4 cells per hex digit)' );

	// a grown world: the old cells are remapped by their centres
	const big = new FogGrid( { x0: - 2048, z0: - 1024, x1: 2048, z1: 2048 }, FOG_CELL );
	ok( big.fromJSON( j ) && big.count === f.count && big.revealedAt( 0, 0 ) && big.revealedAt( 500, 500 ), 'an older grid is remapped onto wider bounds' );

	// junk is refused
	ok( ! g.fromJSON( null ) && g.count === 0, 'null clears' );
	ok( ! g.fromJSON( { bits: 'zz', cell: 64, x0: 0, z0: 0, nx: 1, nz: 1 } ) && ! g.fromJSON( { bits: 'f', cell: - 1, x0: 0, z0: 0, nx: 1, nz: 1 } ), 'bad data is refused' );
	ok( ! g.fromJSON( { bits: '', cell: 64, x0: 0, z0: 0, nx: 1e6, nz: 1e6 } ), 'an absurd grid is refused' );
	g.revealAll();
	ok( g.count === g.cells.length, 'revealAll' );
	g.clear();
	ok( g.count === 0, 'clear' );

}

// ---- the view: pan / zoom, clamped
{

	const B = { x0: - 1000, z0: - 1000, x1: 1000, z1: 1000 };
	const v = new MapView( B );
	v.setSize( 1000, 500 );
	ok( near( v.kMin, 0.25 ), 'kMin fits the whole world (500 px / 2000 m)' );
	v.k = 100;
	v.clamp();
	ok( v.k === v.kMax, 'zoom clamps to kMax' );
	v.k = 0.001;
	v.clamp();
	ok( v.k === v.kMin && v.cx === 0 && v.cz === 0, 'zoomed all the way out: the world is centred' );
	v.k = 1;
	v.centerOn( 100, - 200 );
	const s = v.toScreen( 130, - 180 ), w = v.toWorld( s.x, s.y );
	ok( near( w.x, 130 ) && near( w.z, - 180 ), 'toScreen / toWorld are inverse' );
	ok( near( s.x, 530 ) && near( s.y, 270 ), 'north up, x right, z down' );
	const before = v.toWorld( 800, 100 );
	v.zoomAt( 1.5, 800, 100 );
	const after = v.toWorld( 800, 100 );
	ok( near( before.x, after.x, 1e-6 ) && near( before.z, after.z, 1e-6 ), 'wheel zoom keeps the point under the cursor' );
	v.centerOn( 99999, 99999 );
	ok( v.cx + v.w / 2 / v.k <= 1000 + 1e-9 && v.cz + v.h / 2 / v.k <= 1000 + 1e-9, 'panning stops at the world edge' );
	const cx = v.cx;
	v.panBy( - 100, 0 );
	ok( v.cx === cx, 'a drag past the edge does not move' );
	v.panBy( 100, 0 );
	ok( v.cx < cx, 'dragging right moves the view west' );

}

// ---- the view keeps the title bar and the status line clear
{

	const B = { x0: - 1000, z0: - 1000, x1: 1000, z1: 1000 };
	const v = new MapView( B );
	v.setSize( 1000, 800 );
	v.setInsets( { top: 70, bottom: 60, left: 10, right: 10 } );
	v.fit();
	ok( near( v.k, 670 / 2000 ), 'the fit uses the free height (800 - 70 - 60)' );
	const nw = v.toScreen( B.x0, B.z0 ), se = v.toScreen( B.x1, B.z1 );
	ok( nw.y >= 70 - 1e-6 && se.y <= 800 - 60 + 1e-6 && nw.x >= 10 && se.x <= 990, 'fitted: the whole world lies inside the free area' );
	ok( near( ( nw.y + se.y ) / 2, ( 70 + 740 ) / 2 ), 'and is centred in it' );
	v.zoomAt( 3 );
	v.centerOn( - 99999, - 99999 );
	const nw2 = v.toScreen( B.x0, B.z0 );
	ok( near( nw2.y, 70 ) && near( nw2.x, 10 ), 'zoomed in at the north-west corner: the world edge stops below the title bar' );
	v.centerOn( 99999, 99999 );
	const se2 = v.toScreen( B.x1, B.z1 );
	ok( near( se2.y, 740 ) && near( se2.x, 990 ), 'and at the south-east corner above the status line' );
	v.setInsets( { top: 5000 } );
	ok( v.freeH === 200 && v.k >= v.kMin, 'absurd insets keep a usable area' );
	v.setInsets( {} );
	ok( near( v.kMin, 800 / 2000 ), 'no insets: the plain fit' );

}

// ---- helpers
{

	const in1 = edgeClamp( 100, 100, 400, 300, 20 );
	ok( ! in1.edge && in1.x === 100, 'edgeClamp: inside stays' );
	const out = edgeClamp( 2000, 150, 400, 300, 20 );
	ok( out.edge && near( out.x, 380 ) && near( out.y, 150 ) && near( out.angle, Math.PI / 2 ), 'edgeClamp: off to the east sits on the edge, chevron east' );
	const up = edgeClamp( 200, - 5000, 400, 300, 20 );
	ok( up.edge && near( up.y, 20 ) && near( up.angle, 0 ), 'edgeClamp: north is angle 0' );
	const sc = niceScale( 0.5, 110 );
	ok( sc.metres === 200 && sc.px === 100 && sc.label === '200 m', 'scale bar: 200 m at 0.5 px/m' );
	ok( niceScale( 0.05, 110 ).label === '2 km', 'scale bar in km' );
	const wp = pickWaypoint( null, 12.345, - 7.89, 1 );
	ok( wp && wp.x === 12.3 && wp.z === - 7.9, 'a click sets a rounded waypoint' );
	ok( pickWaypoint( wp, 14, - 8, 1, 16 ) === null, 'a click on the waypoint clears it' );
	const moved = pickWaypoint( wp, 200, 50, 1, 16 );
	ok( moved && moved.x === 200, 'a click elsewhere moves it' );
	ok( pickWaypoint( wp, NaN, 0, 1 ) === wp, 'a bad click keeps it' );
	ok( revealRadius( 'walk' ) === 120 && revealRadius( 'boat' ) === 240 && revealRadius( 'walk', 200 ) > 400 && revealRadius( 'walk', 1e6 ) === 900, 'reveal radius: on foot, at sea, up high (capped)' );
	ok( compass( 0, - 10 ) === 'N' && compass( 10, 0 ) === 'E' && compass( - 5, 5 ) === 'SW', 'compass words (north is -z)' );
	ok( near( viewAngle( 1, 0 ), Math.PI / 2 ) && near( yawAngle( 0 ), Math.PI ) && near( yawAngle( Math.PI / 2 ), Math.PI / 2 ), 'view / yaw angles' );

}

// ---- the feature: waypoint, discovery, fog, save
const mkFeatures = ( { sandbox = false, discovered = [] } = {} ) => {

	const events = [];
	const reg = new Map();
	const claims = [];
	const f = {
		sandbox, state: { discovered },
		claimKey: ( code, name ) => { claims.push( [ code, name ] ); return true; },
		emit: ( n, d ) => events.push( [ n, d ] ),
		get: ( n ) => reg.get( n ) || null,
		events, reg, claims,
	};
	return f;

};

{

	const minimapCalls = [];
	const toasts = [];
	const app = {
		terrainData: { size: 2048, origin: - 1024 },
		player: { position: { x: 0, y: 2, z: 0 }, mode: 'walk' },
		camera: { position: { x: 0, y: 6, z: 4 } },
		game: { minimap: { setWaypoint: ( p ) => minimapCalls.push( p ) }, toast: ( s ) => toasts.push( s ) },
	};
	const F = mkFeatures( { discovered: [ 'pons' ] } );
	const m = install( app, F );
	ok( m instanceof WorldMapFeature, 'install returns the feature' );
	ok( F.claims.some( ( [ c, n ] ) => c === 'KeyM' && n === 'worldmap' ), 'claims M' );
	ok( ! m.isOpen && ! m.wantsMouse(), 'closed at start (no DOM: no UI)' );
	ok( m.open() === false && ! m.isOpen, 'open without a HUD does nothing' );
	ok( m.discovered( 'home' ) && m.discovered( 'pons' ) && ! m.discovered( 'gull' ), 'discovery follows GameState.discovered (home always)' );

	m.setWaypoint( { x: 300, z: 200 } );
	ok( m.waypoint.x === 300 && F.events.some( ( [ n, d ] ) => n === 'waypointChanged' && d.waypoint.x === 300 ), 'setWaypoint emits waypointChanged' );
	ok( minimapCalls.length === 1 && minimapCalls[ 0 ].x === 300, 'the minimap gets the waypoint' );
	m.setWaypoint( { x: 300, z: 200 } );
	ok( F.events.filter( ( [ n ] ) => n === 'waypointChanged' ).length === 1, 'the same waypoint again is not re-emitted' );
	m.update( 0.3 );
	ok( minimapCalls.length === 1, 'no repeated minimap writes per frame' );
	ok( m.fog.revealedAt( 0, 0 ) && ! m.fog.revealedAt( 600, 600 ), 'update reveals the fog around the player' );

	// a minimap built later (the HUD is lazy) still gets the waypoint
	const later = [];
	app.game.minimap = { setWaypoint: ( p ) => later.push( p ) };
	m.update( 0.01 );
	ok( later.length === 1 && later[ 0 ].x === 300, 'a new minimap is synced' );

	// the free camera does not lift the fog
	app.freeCam = true;
	app.player.position = { x: 800, y: 2, z: 800 };
	m.update( 1 );
	ok( ! m.fog.revealedAt( 800, 800 ), 'the free camera reveals nothing' );
	app.freeCam = false;

	// save
	const j = JSON.parse( JSON.stringify( m.toJSON() ) );
	const m2 = install( { ...app, game: { minimap: null } }, mkFeatures() );
	m2.fromJSON( j );
	ok( m2.waypoint && m2.waypoint.x === 300 && m2.fog.count === m.fog.count && m2.fog.revealedAt( 0, 0 ), 'fog and waypoint survive the save' );
	m2.fromJSON( { v: 1, fog: null, wp: { x: 'a' } } );
	ok( m2.waypoint === null && m2.fog.count === 0, 'a broken save loads empty' );
	m2.fromJSON( null );
	ok( m2.fog.count === 0, 'null is ignored' );

	// arrival clears the waypoint
	app.player.position = { x: 305, y: 1, z: 195 };
	m.update( 0.3 );
	ok( m.waypoint === null && toasts.some( ( s ) => /waypoint/i.test( s ) ), 'reaching the waypoint clears it with a toast' );
	ok( later[ later.length - 1 ] === null, 'and clears the minimap flag' );

	m.setWaypoint( { x: 1, z: 2 } );
	m.reset();
	ok( m.waypoint === null && m.fog.count === 0, 'reset: no waypoint, all fogged' );

	// sandbox: everything charted
	const s = install( app, mkFeatures( { sandbox: true } ) );
	ok( s.discovered( 'gull' ) && s.discovered( 'anything' ), 'the sandbox charts every island' );
	s.dispose();
	m.dispose();

}

// ---- the marker list (WorldMap._collect without a DOM)
{

	const reg = new Map();
	const feats = { get: ( n ) => reg.get( n ) || null };
	const F = { discovered: ( id ) => id === 'home' || id === 'pons', waypoint: { x: 10, z: 20 }, sandbox: false };
	const app = {
		features: feats,
		player: { position: { x: 0, y: 0, z: 0 }, mode: 'walk' },
		camera: { position: { x: 0, y: 5, z: 5 }, matrixWorld: { elements: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] } },
		boatCtl: { position: { x: 70, z: - 20 } },
		game: { state: { boat: 'skiff' } },
		ports: { markers: [ { id: 'gull', x: - 555, z: 198, icon: 'anchor' }, { id: 'pons-light', x: 600, z: 500, icon: 'fish' } ] },
		remotePlayers: { peers: new Map( [
			[ 'a', { id: 'a', name: 'Ana', hasPose: true, pose: { mode: 'walk', position: { x: 5, z: 5 } } } ],
			[ 'b', { id: 'b', name: 'Bo', hasPose: true, pose: { mode: 'boat', position: { x: 50, z: 60 } } } ],
			[ 'c', { id: 'c', name: 'Cy', hasPose: false, pose: { mode: 'walk', position: { x: 0, z: 0 } } } ],
		] ) },
	};
	reg.set( 'naval', { ships: [
		{ id: 1, alive: true, faction: 'pirate', x: 300, z: 300 },
		{ id: 2, alive: true, faction: 'pirate', x: 400, z: 300, bounty: { id: 'n1', captain: 'Red Mara' } },
		{ id: 3, alive: false, faction: 'pirate', x: 0, z: 0 },
		{ id: 4, alive: true, faction: 'merchant', x: 1, z: 1 },
	] } );
	reg.set( 'notices', { active: [
		{ id: 'n1', kind: 'bounty', region: { x: 400, z: 300 }, captain: 'Red Mara' },
		{ id: 'n2', kind: 'bounty', region: { x: - 300, z: 500 }, captain: 'Black Ivo' },
		{ id: 'n3', kind: 'notice', region: { x: 1, z: 1 } },
	] } );
	reg.set( 'pirates', { searchZones: () => [ { id: 'z1', x: 200, z: - 400, r: 250, captain: 'Old Vane' }, { id: 'z2', center: { x: 10, z: 10 }, radius: 90 }, { id: 'bad' }, { id: 'n2', x: 0, z: 0 } ] } );
	reg.set( 'seaplane', { marker: () => ( { x: 90, z: 90, heading: Math.PI / 2 } ) } );
	reg.set( 'trade', { sites: { home: { x: 57.8, z: - 75.2 }, pons: { x: 500, z: 480 } } } );

	const wm = Object.create( WorldMap.prototype );
	wm.app = app;
	wm.feature = F;
	const list = [];
	wm._collect( list );
	const keys = new Set( list.map( ( m ) => m.key ) );
	const get = ( k ) => list.find( ( m ) => m.key === k );
	ok( keys.has( 'joe' ) && keys.has( 'marta' ) && keys.has( 'yard' ) && keys.has( 'pons' ), 'the home stall, chandlery, Captain Roid’s yard and Pons' );
	ok( get( 'camp' ) && get( 'camp' ).x === CAMP.x && get( 'camp' ).z === CAMP.z && CAMP.x === 127 && CAMP.z === - 71, 'the raider camp at (127, -71)' );
	ok( ! keys.has( 'port:gull' ) && ! keys.has( 'port:key' ), 'undiscovered ports have no marker' );
	ok( keys.has( 'board:home' ) && keys.has( 'board:pons' ) && keys.has( 'trade:home' ) && keys.has( 'trade:pons' ), 'notice boards and trade stalls of charted ports' );
	ok( get( 'ship:1' ).kind === 'pirate' && ! keys.has( 'ship:3' ) && ! keys.has( 'ship:4' ), 'live pirate ships only' );
	ok( get( 'ship:2' ).kind === 'bounty' && get( 'ship:2' ).label === 'Red Mara' && get( 'ship:2' ).edge, 'a bounty target: labelled, kept on the edge' );
	const regions = wm._regionList;
	ok( regions.some( ( r ) => r.key === 'n2' && ! r.zone ) && ! regions.some( ( r ) => r.key === 'n1' ), 'a hunted bounty with no ship shows its region; one with a ship does not' );
	ok( regions.some( ( r ) => r.key === 'zone:z1' && r.zone && r.r === 250 && r.label === 'Old Vane' ), 'pirate search zones (x / z / r)' );
	ok( regions.some( ( r ) => r.key === 'zone:z2' && r.r === 90 && r.x === 10 ), 'search zones (center / radius)' );
	ok( ! regions.some( ( r ) => r.key === 'zone:bad' ) && ! regions.some( ( r ) => r.key === 'zone:n2' ), 'malformed and duplicate zones are skipped' );
	const pl = get( 'plane' );
	ok( pl && pl.x === 90 && near( pl.rot, Math.PI / 2 ), 'the seaplane, turned to its heading' );
	ok( get( 'boat' ) && get( 'boat' ).x === 70, 'the boat moored elsewhere' );
	ok( get( 'peer:a' ).label === 'Ana' && get( 'peer:b' ).kind === 'peer is-boat' && ! keys.has( 'peer:c' ), 'remote players with names (at sea marked), none before a pose' );
	ok( get( 'wp' ) && get( 'wp' ).edge, 'the waypoint, kept on the edge' );
	ok( get( 'me' ) && get( 'me' ).edge && near( get( 'me' ).rot, 0 ), 'the player, heading from the camera (identity view looks -z = north, up)' );

	// aboard: no separate boat marker; a pirates feature that throws is ignored
	app.player.mode = 'boat';
	reg.set( 'pirates', { searchZones: () => { throw new Error( 'x' ); } } );
	reg.delete( 'seaplane' );
	const l2 = [];
	wm._collect( l2 );
	ok( ! l2.some( ( m ) => m.key === 'boat' ) && ! l2.some( ( m ) => m.key === 'plane' ), 'aboard: no boat marker; no seaplane feature: no plane' );
	ok( ! wm._regionList.some( ( r ) => r.zone ), 'a failing searchZones is ignored' );

	// ports added later by the islands worker (WORLD.ports grows) show once discovered
	WORLD.ports.push( { id: 'testport', name: 'Test Port', stand: { x: 900, z: 900 } } );
	F.discovered = ( id ) => id === 'home' || id === 'testport';
	const l3 = [];
	wm._collect( l3 );
	ok( l3.some( ( m ) => m.key === 'port:testport' ) && ! l3.some( ( m ) => m.key === 'pons' ), 'a new port appears once discovered (read dynamically)' );
	WORLD.ports.pop();

	ok( wm._islandName( { id: 'home' } ) === 'Hyptile Island' && wm._islandName( { id: 'gull' } ) === 'Gull Rock', 'island names from the ports' );

}

// ---- the minimap's waypoint and the shared bake
{

	const mm = Object.create( Minimap.prototype );
	mm.setWaypoint( { x: 3, z: 4 } );
	ok( mm.waypoint.x === 3, 'minimap waypoint set' );
	mm.setWaypoint( { x: NaN, z: 1 } );
	ok( mm.waypoint === null, 'minimap waypoint cleared by bad data' );
	ok( typeof ICON.flag === 'string' && ICON.flag.startsWith( '<svg' ), 'shared icons include the flag' );

	// a tiny terrain: a 64 m world, a cone island in the middle
	const res = 16, size = 64;
	const T = {
		res, texel: size / res, origin: - size / 2, size,
		heightAt: ( x, z ) => 6 - Math.hypot( x, z ) * 0.4,
		seagrass: new Uint8Array( res * res ), rubble: new Uint8Array( res * res ), rock: new Uint8Array( res * res ),
		sand: new Uint8Array( res * res ), path: new Uint8Array( res * res ), scarp: new Uint8Array( res * res ), pads: [ { x: 0, z: 0, radius: 2 } ],
	};
	let put = 0, rects = 0;
	const ctx = {
		createImageData: ( w, hh ) => ( { width: w, height: hh, data: new Uint8ClampedArray( w * hh * 4 ) } ),
		putImageData: () => put ++, fillRect: () => rects ++, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
	};
	const n = 32;
	const B = new TerrainBake( ctx, { n, x0: - 32, z0: - 32, ppm: n / 64, jetties: true, keepHeights: true } );
	ok( B.step( T, 10 ) === false && ! B.done && put === 0, 'the bake runs in row chunks' );
	ok( B.heightAt( 0, 0 ) === null, 'no heights before it is done' );
	while ( ! B.step( T, 10 ) );
	ok( B.done && put === 1 && rects > 0, 'done: the image is put once, pads and pier drawn' );
	ok( B.heightAt( 0, 0 ) > 4 && B.heightAt( 30, 30 ) < 0 && B.heightAt( 100, 0 ) === null, 'kept heights answer lookups' );
	const B2 = new TerrainBake( ctx, { n, x0: - 32, z0: - 32, ppm: n / 64 } );
	while ( ! B2.step( T, 100 ) );
	ok( B2.h === null && B2.heightAt( 0, 0 ) === null, 'the minimap bake drops its heights' );

}

// ---- wave 13C: discovery states, the legend, quest pins, parked planes, the airstrip and the pirate island on the map
{

	// discovery states: "?" until discovered, then named
	const disc = ( ...ids ) => ( id ) => ids.includes( id );
	const bw = WORLD.islands.find( ( i ) => i.id === 'blackwater' ), tm = WORLD.islands.find( ( i ) => i.id === 'tidemark' ), home = WORLD.islands.find( ( i ) => i.id === 'home' );
	ok( bw && bw.pirate && tm && tm.tile, 'Blackwater is a pirate island and Tidemark a tile island in WORLD' );
	ok( discoveryState( disc(), home ) === 'charted', 'the home island is always charted' );
	ok( discoveryState( disc(), bw ) === 'unknown' && discoveryState( disc( 'tidemark' ), bw ) === 'unknown', 'Blackwater is a "?" until the stronghold sights it' );
	ok( discoveryState( disc( 'blackwater' ), bw ) === 'charted' && discoveryState( disc( 'blackwater' ), tm ) === 'unknown', 'then it is named, and Tidemark is still unknown' );
	ok( discoveryState( disc(), tm, true ) === 'charted' && discoveryState( disc(), bw, true ) === 'charted', 'the sandbox charts everything' );
	ok( discoveryState( null, bw ) === 'unknown' && discoveryState( disc(), null ) === 'charted', 'garbage in: unknown / charted' );

	// the legend
	const kindsOf = ( o ) => legendRows( o ).map( ( r ) => r.kind );
	const base = kindsOf( { discovered: disc(), kinds: new Set() } );
	ok( [ 'me', 'boat', 'plane', 'peer', 'joe', 'trade', 'marta', 'yard', 'pons', 'board', 'camp', 'pirate', 'bounty', 'zone', 'wp', 'unknown', 'fog' ].every( ( k ) => base.includes( k ) ), 'the legend always explains you, the boat, planes, players, stalls, ports, boards, camp, ships, bounties, zones, waypoint, "?" and fog' );
	ok( ! base.some( ( k ) => [ 'airstrip', 'isle', 'battery', 'wreck', 'death', 'quest', 'parked', 'pin' ].includes( k ) ), 'and nothing it cannot show yet (airstrip, pirate island, battery reach, wreck, sea chest, quest, parked plane, pin)' );
	const withT = kindsOf( { discovered: disc( 'tidemark' ), kinds: new Set() } );
	ok( withT.includes( 'airstrip' ) && ! withT.includes( 'isle' ), 'Tidemark discovered: the airstrip row' );
	const withB = kindsOf( { discovered: disc( 'blackwater' ), kinds: new Set() } );
	ok( withB.includes( 'isle' ) && withB.includes( 'battery' ) && ! withB.includes( 'airstrip' ), 'Blackwater discovered: the pirate island and its battery reach' );
	const withK = kindsOf( { discovered: disc(), kinds: new Set( [ 'wreck', 'death', 'quest', 'parked', 'pin' ] ) } );
	ok( [ 'wreck', 'death', 'quest', 'parked', 'pin' ].every( ( k ) => withK.includes( k ) ), 'wrecks, the sea chest, quest pins, parked planes and marked places appear with their markers' );
	const all = kindsOf( { discovered: disc(), sandbox: true, kinds: new Set() } );
	ok( all.includes( 'airstrip' ) && all.includes( 'isle' ) && all.includes( 'battery' ), 'the sandbox lists the discovery rows' );
	const rows = legendRows( { discovered: disc( 'tidemark', 'blackwater' ), kinds: new Set( LEGEND_KINDS ) } );
	ok( rows.length === LEGEND_KINDS.length && new Set( rows.map( ( r ) => r.kind ) ).size === rows.length, 'every kind once, in order' );
	ok( rows.every( ( r ) => typeof r.key === 'string' && r.key.startsWith( 'worldmap.' ) && r.text && ( r.icon === '' || r.icon === '?' || ICON[ r.icon ] ) ), 'each row has an i18n key, a text and a real icon' );
	ok( legendRows().length > 10 && legendRows( { kinds: [ 1 ] } ).length > 10, 'no options: the fixed rows; a non-Set kinds is ignored' );

	// quest pins
	ok( questPinMarker( { id: 'ferry', x: 10, z: 20, label: 'Tidemark fish hall' } ).id === questPinId( 'ferry' ) && questPinId( 'ferry' ) === 'quest:ferry', 'a pin has a quest: id' );
	const pm = questPinMarker( { id: 7, x: 1.5, z: - 2, label: 'x'.repeat( 90 ) } );
	ok( pm.kind === 'quest' && pm.icon === 'quest' && pm.label.length === 48, 'kind quest, its own icon, a trimmed label' );
	ok( questPinMarker( null ) === null && questPinMarker( { id: 'a', x: NaN, z: 1 } ) === null && questPinMarker( { x: 1, z: 1 } ) === null && questPinMarker( { id: '', x: 1, z: 1 } ) === null, 'bad pins are refused' );
	ok( questPinMarker( { id: 'a', x: 1, z: 2 } ).label === '', 'a pin without a label is fine' );

	// parked airframes
	const sp = {
		af: 'jade', fleet: { jade: { owned: true }, kestrel: { owned: true }, petrel: { owned: true, lost: true }, albatross: { owned: false } },
		base: ( id ) => id === 'kestrel' ? { kind: 'strip', x: 1650, z: 50 } : { kind: 'ramp', x: 0, z: - 20 },
	};
	const parked = parkedAirframes( sp, () => true );
	ok( parked.length === 1 && parked[ 0 ].id === 'kestrel' && parked[ 0 ].name === 'Kestrel' && parked[ 0 ].x === 1650 && parked[ 0 ].port === 'tidemark', 'the Kestrel parked on the strip (not the one out, not a wreck, not an unbought one)' );
	ok( parkedAirframes( sp, ( id ) => id === 'home' ).length === 0, 'its marker waits until Tidemark is discovered' );
	sp.af = 'kestrel';
	sp.fleet.jade.owned = true;
	const parked2 = parkedAirframes( sp, () => true );
	ok( parked2.length === 1 && parked2[ 0 ].id === 'jade' && parked2[ 0 ].port === 'home', 'with the Kestrel out the Jade is the parked one, at the ramp' );
	ok( parkedAirframes( null ).length === 0 && parkedAirframes( {} ).length === 0 && parkedAirframes( { fleet: { a: { owned: true } }, af: 'b', base: () => { throw new Error( 'x' ); } } ).length === 0 && parkedAirframes( { fleet: { a: { owned: true } }, af: 'b', base: () => ( { x: NaN, z: 1 } ) } ).length === 0, 'no seaplane, no fleet, a failing or bad base: none' );

	// the airstrip is its own badge kind
	ok( portMarkerKind( { icon: 'plane' } ) === 'airstrip' && portMarkerKind( { icon: 'anchor' } ) === 'pons' && portMarkerKind( null ) === 'pons', 'the airstrip marker has its own kind' );
	ok( portKnown( { state: { discovered: [ 'tidemark' ] } }, 'tidemark' ) && ! portKnown( { state: { discovered: [] } }, 'tidemark' ) && portKnown( {}, 'home' ), 'the minimap: a port is known from the save' );
	const gm = { app: { features: { get: ( n ) => n === 'worldmap' ? { discovered: ( id ) => id === 'tidemark' } : null } }, state: { discovered: [] } };
	ok( portKnown( gm, 'tidemark' ) && ! portKnown( gm, 'gull' ), 'the minimap asks the world map feature first (the sandbox charts everything)' );

}

{

	// the feature: quest pins from events, saved; parked planes as markers
	const handlers = new Map();
	const reg = new Map();
	const added = [], removed = [];
	const mm = { addMarker: ( m ) => added.push( m ), removeMarker: ( id ) => removed.push( id ), setWaypoint: () => {} };
	const F = {
		sandbox: false, state: { discovered: [ 'tidemark' ] },
		claimKey: () => true, emit: ( n, d ) => ( handlers.get( n ) || [] ).forEach( ( h ) => h( d ) ),
		on: ( n, h ) => { handlers.set( n, [ ...( handlers.get( n ) || [] ), h ] ); return () => handlers.set( n, ( handlers.get( n ) || [] ).filter( ( q ) => q !== h ) ); },
		get: ( n ) => reg.get( n ) || null,
	};
	const app = { terrainData: { size: 2048, origin: - 1024 }, player: { position: { x: 0, y: 2, z: 0 }, mode: 'walk' }, game: { minimap: mm } };
	const m = install( app, F );

	F.emit( 'questPin', { id: 'ferry', x: 1840, z: - 24, label: 'Tidemark fish hall' } );
	ok( m.markers.has( 'quest:ferry' ) && m.markers.get( 'quest:ferry' ).kind === 'quest' && m.pins.size === 1, 'questPin puts a quest pin on the map' );
	m.update( 0.01 );
	ok( added.some( ( a ) => a.id === 'quest:ferry' && a.icon === 'quest' && a.label === 'Tidemark fish hall' ), 'and on the minimap' );
	F.emit( 'questPin', { id: 'ferry', x: 1850, z: - 30, label: 'The tavern' } );
	ok( m.markers.size === 1 && m.markers.get( 'quest:ferry' ).x === 1850 && m.markers.get( 'quest:ferry' ).label === 'The tavern', 'the same id again moves and relabels the pin' );
	F.emit( 'questPin', { id: 'other', x: - 700, z: 690, label: 'Blackwater cove' } );
	F.emit( 'questPin', { id: 'bad', x: 'x', z: 1 } );
	F.emit( 'questPin', null );
	ok( m.markers.size === 2 && m.pins.size === 2, 'a second quest, a bad payload ignored' );

	const collected = [];
	m._collectMarkers( collected );
	const pin = collected.find( ( c ) => c.key === 'pin:quest:ferry' );
	ok( pin && pin.kind === 'quest' && pin.edge && /The tavern/.test( pin.label ) && / km$/.test( pin.label ), 'the world map draws it on the edge with its label and the distance' );

	const j = JSON.parse( JSON.stringify( m.toJSON() ) );
	ok( Array.isArray( j.pins ) && j.pins.length === 2 && j.pins[ 0 ].id === 'ferry' && j.pins[ 0 ].x === 1850, 'pins are in the save' );
	const m2 = install( { ...app, game: { minimap: null } }, F );
	m2.fromJSON( j );
	ok( m2.markers.has( 'quest:ferry' ) && m2.markers.has( 'quest:other' ) && m2.markers.get( 'quest:other' ).z === 690, 'a loaded game shows its pins again' );
	m2.fromJSON( { v: 1, fog: null, wp: null } );
	ok( m2.markers.size === 0 && m2.pins.size === 0, 'a save without pins clears them' );
	m2.fromJSON( { v: 1, pins: [ { id: 1, x: 5, z: 5 }, { id: 2, x: NaN, z: 1 }, 'x', null ] } );
	ok( m2.markers.size === 1, 'broken pins in a save are skipped' );
	m2.dispose();
	ok( ! ( 'pins' in new WorldMapFeature( app, null ).toJSON() ), 'no pins: nothing extra in the save' );

	F.emit( 'questPinClear', { id: 'ferry' } );
	ok( ! m.markers.has( 'quest:ferry' ) && m.markers.has( 'quest:other' ) && m.pins.size === 1, 'questPinClear removes that pin' );
	m.update( 0.01 );
	ok( removed.includes( 'quest:ferry' ), 'and takes it off the minimap' );
	F.emit( 'questPinClear', { id: 'nothing' } );
	F.emit( 'questPinClear', null );
	F.emit( 'questPinClear', {} );
	ok( m.markers.size === 1, 'clearing an unknown pin changes nothing' );
	m.reset();
	ok( m.markers.size === 0 && m.pins.size === 0, 'reset clears the pins' );

	// parked planes
	const sp = { af: 'jade', fleet: { jade: { owned: true }, kestrel: { owned: true } }, base: ( id ) => id === 'kestrel' ? { kind: 'strip', x: 1650, z: 50 } : { kind: 'ramp', x: 0, z: - 20 } };
	reg.set( 'seaplane', sp );
	m.update( 0.6 );
	const pk = m.markers.get( 'parked:kestrel' );
	ok( pk && pk.kind === 'parked' && pk.icon === 'plane' && /Kestrel/.test( pk.label ) && pk.x === 1650 && ! m.markers.has( 'parked:jade' ), 'the Kestrel parked on the strip is a marker (the plane out has the plane badge)' );
	const c2 = [];
	m._collectMarkers( c2 );
	const cm = c2.find( ( c ) => c.key === 'pin:parked:kestrel' );
	ok( cm && cm.minor && ! cm.edge, 'drawn small on the world map, not pinned to the edge' );
	sp.af = 'kestrel';
	m.update( 0.6 );
	ok( ! m.markers.has( 'parked:kestrel' ) && m.markers.has( 'parked:jade' ), 'fly the Kestrel and the Jade is the parked one' );
	F.state.discovered = [];
	m.update( 0.6 );
	ok( m.markers.has( 'parked:jade' ), 'a ramp plane at home needs no discovery' );
	sp.fleet.jade.lost = true;
	m.update( 0.6 );
	ok( ! m.markers.has( 'parked:jade' ), 'a wreck is not parked' );
	reg.delete( 'seaplane' );
	m.update( 0.6 );
	ok( m.markers.size === 0, 'no seaplane feature: no parked markers' );
	m.dispose();
	F.emit( 'questPin', { id: 'late', x: 1, z: 1 } );
	ok( m.markers.size === 0, 'a disposed feature stops listening' );

}

{

	// WorldMap._collect: the airstrip, the pirate island, the batteries' reach, the crew
	const reg = new Map();
	const feats = { get: ( n ) => reg.get( n ) || null };
	const mk = ( ids, sandbox = false ) => ( { discovered: ( id ) => id === 'home' || sandbox || ids.includes( id ), waypoint: null, sandbox } );
	const app = {
		features: feats, player: { position: { x: 0, y: 0, z: 0 }, mode: 'walk' },
		camera: { position: { x: 0, y: 5, z: 5 }, matrixWorld: { elements: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] } },
		boatCtl: { position: { x: 70, z: - 20 } }, game: { state: { boat: 'skiff' } },
		ports: { markers: [ { id: 'tidemark:airstrip', name: 'Airstrip', x: 1652, z: 52, icon: 'plane', port: 'tidemark' } ] },
	};
	const collect = ( F ) => {

		const wm = Object.create( WorldMap.prototype );
		wm.app = app;
		wm.feature = F;
		const list = [];
		wm._collect( list );
		return { list, wm, get: ( k ) => list.find( ( m ) => m.key === k ) };

	};

	let c = collect( mk( [] ) );
	ok( ! c.get( 'port:tidemark:airstrip' ) && ! c.get( 'isle:blackwater' ), 'undiscovered: no airstrip badge and no pirate island badge' );
	c = collect( mk( [ 'tidemark' ] ) );
	ok( c.get( 'port:tidemark:airstrip' ) && c.get( 'port:tidemark:airstrip' ).kind === 'airstrip' && c.get( 'port:tidemark:airstrip' ).x === 1652, 'Tidemark discovered: the airstrip badge, its own kind' );
	ok( ! c.get( 'isle:blackwater' ), 'a pirate island stays off the map until it is charted' );
	c = collect( mk( [ 'blackwater' ] ) );
	const isle = c.get( 'isle:blackwater' );
	ok( isle && isle.kind === 'isle' && isle.x === WORLD.blackwater.center.x && isle.z === WORLD.blackwater.center.z, 'Blackwater charted: a skull on the island' );
	ok( collect( mk( [], true ) ).get( 'isle:blackwater' ) && collect( mk( [], true ) ).get( 'port:tidemark:airstrip' ), 'the sandbox shows both' );

	// the batteries' reach: the pirates' search zones carry kind 'battery'
	reg.set( 'pirates', { searchZones: () => [
		{ id: 'battery-seaward', kind: 'battery', x: 100, z: 650, r: 220, label: 'The seaward battery', silenced: false },
		{ id: 'battery-channel', kind: 'battery', x: 60, z: 640, r: 220, label: 'The channel battery (silenced)', silenced: true },
		{ id: 'z1', x: 200, z: - 400, r: 250, captain: 'Old Vane' },
	] } );
	c = collect( mk( [ 'blackwater' ] ) );
	const rg = c.wm._regionList;
	ok( rg.find( ( r ) => r.key === 'zone:battery-seaward' ).battery === true && rg.find( ( r ) => r.key === 'zone:battery-seaward' ).silenced === false && rg.find( ( r ) => r.key === 'zone:battery-seaward' ).r === 220, 'a battery zone is flagged battery with its range' );
	ok( rg.find( ( r ) => r.key === 'zone:battery-channel' ).silenced === true && ! rg.find( ( r ) => r.key === 'zone:z1' ).battery, 'a silenced battery is flagged; a bounty zone is not a battery' );

	// the crew count on the boat, the airframe on the plane badge
	reg.set( 'crew', { posts: { pepe: 'gunner', doge: 'angler' } } );
	reg.set( 'seaplane', { af: 'kestrel', marker: () => ( { x: 1700, z: 60, heading: 0 } ) } );
	c = collect( mk( [ 'tidemark' ] ) );
	ok( c.get( 'boat' ).label === '2 crew', 'the moored boat says how many crew are posted' );
	ok( c.get( 'plane' ).label === 'Kestrel', 'the plane badge names the airframe' );
	reg.delete( 'crew' );
	ok( collect( mk( [] ) ).get( 'boat' ).label === '', 'no crew: no label' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall world map tests passed' );
process.exit( fails ? 1 : 0 );
