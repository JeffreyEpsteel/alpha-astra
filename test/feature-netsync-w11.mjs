// Plain-node test of wave 11's multiplayer parity (src/features/netsync HullLink / WreckLink / CrewLink + server/rooms.mjs):
// a real server in-process and two browser-side stacks (NetClient over @colyseus/sdk + RemotePlayers + Features + NetSync + the
// real Naval feature, no GPU), plus a raw observer client:
//   hulls    the host resolves a remote boat's collision with its own boat and with its ship; the impulse + damage reach that
//            boat's owner only ('bump'), who applies them; the guest predicts the push-apart itself; its own naval world adds
//            no second blow against the host's (puppet) ship
//   crew     the posted crew rides in the state and stands on the remote boat (CrewDeck, injected here); a crew gunner's shot
//            gestures there
//   rates    gunshots and cannon volleys faster than the reload are dropped on the way
//   wrecks   a boat wreck, a seaplane wreck (with its torn parts) and a sinking boat are schema entries everybody draws (naval
//            Wrecks, a seaplane Wreck + visual); they survive a reconnect and go with a salvage, a recovery or the owner
//   node test/feature-netsync-w11.mjs
import './headless.mjs';
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { Features } from '../src/features/Features.js';
import { NetClient } from '../src/net/NetClient.js';
import { RemotePlayers } from '../src/net/RemotePlayers.js';
import { PROTOCOL_VERSION, CANNON_GATE } from '../src/net/Protocol.js';
import { Naval } from '../src/features/naval/Naval.js';
import { NetSync } from '../src/features/netsync/NetSync.js';
import { anglesOf, quatOf, planeBits, SINKING_BIT } from '../src/features/netsync/WreckLink.js';
import { crewMembers } from '../src/features/netsync/CrewLink.js';
import { Wreck as PlaneWreck, PART_NAMES } from '../src/features/seaplane/Wreck.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 150 s' ); process.exit( 1 ); }, 150000 );
const terrain = new TerrainData();

// ---- pure parts
{

	const q = quatOf( 0.7, - 0.3, 0.45 ), a = anglesOf( q );
	ok( Math.abs( a.yaw - 0.7 ) < 1e-4 && Math.abs( a.pitch + 0.3 ) < 1e-4 && Math.abs( a.roll - 0.45 ) < 1e-4, 'anglesOf( quatOf( yaw, pitch, roll ) ) round-trips' );
	const w = new PlaneWreck( { position: new Vector3( 0, 1, 0 ), quaternion: new Quaternion(), seed: 3, detach: [ 'wingL', 'prop' ] } );
	const bits = planeBits( w );
	ok( bits === ( ( 1 << PART_NAMES.indexOf( 'wingL' ) ) | ( 1 << PART_NAMES.indexOf( 'prop' ) ) ) && ! ( bits & SINKING_BIT ), 'planeBits: one bit per torn part' );
	const m = crewMembers( [ [ 'doge', 'gunner', 's', 1 ], [ 'doge', 'angler', 'p', 0 ], [ 'nobody', 'gunner', 'p', 0 ], [ 'pengu', 'cook', 'p', 0 ], 'x' ] );
	ok( m.length === 1 && m[ 0 ].id === 'doge' && m[ 0 ].side === 'starboard' && m[ 0 ].slot === 1, 'crewMembers keeps known characters and posts, once each' );

}

// RemotePlayers without avatars, name tags or boat models (all GPU / DOM): the interpolation is the real one
class LiteRemote extends RemotePlayers {

	constructor() {

		super( { scene: { add() {}, remove() {} }, camera: {} } );

	}

	addPeer( { id, name, character, boat } ) {

		if ( ! id || id === this.localId ) return null;
		let p = this.peers.get( id );
		if ( p ) return p;
		p = {
			id, name: name || '?', character: character || 'hyptile', boatId: null, ownedBoat: boat || null, avatar: null, boat: null, boatReady: false, snaps: [], tag: null,
			pose: { position: new Vector3(), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null },
			boatPos: new Vector3(), boatQuat: new Quaternion(), frame: new Quaternion(), hasPose: false, lastAt: 0,
		};
		this.peers.set( id, p );
		return p;

	}

	_ensureBoat() {}

}

function fakeDeck( log ) {

	const d = {
		synced: [], updates: 0, last: null, fires: [], disposed: false,
		sync( m ) { this.synced.push( m.map( ( x ) => `${ x.id }:${ x.post }:${ x.side }` ) ); },
		update( dt, o ) { this.updates ++; this.last = { x: o.boat.position.x, z: o.boat.position.z, boatId: o.boatId }; },
		fired( id ) { this.fires.push( id ); return true; },
		dispose() { this.disposed = true; },
	};
	log.push( d );
	return d;

}

function fakeVisual( log ) {

	const v = {
		detached: [], pose: null, parts: {}, disposed: false,
		detach( n ) { this.detached.push( n ); },
		setPose( p ) { this.pose = { x: p.x, y: p.y, z: p.z }; },
		setPart( n, p ) { this.parts[ n ] = { x: p.x, y: p.y, z: p.z }; },
		partVisible() {}, setVisible() {},
		dispose() { this.disposed = true; },
	};
	log.push( v );
	return v;

}

// one player's whole client side
function makeClient( name, base, { pos = [ 0, 0, 0 ], seed = 1, crew = [] } = {} ) {

	const toasts = [], decks = [], visuals = [], events = [];
	const state = { boat: 'skiff', name, money: 0, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const boatCtl = {
		position: new Vector3( ...pos ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), mass: 420, enabled: true,
		driven: true, moored: false, throttle: 0, steer: 0, rpm: 0, calls: [],
		applyCollision( dx, dz, jx, jz, px, py, pz ) {

			this.calls.push( { dx, dz, jx, jz, px, pz } );
			this.position.x += dx;
			this.position.z += dz;
			this.velocity.x += jx / this.mass;
			this.velocity.z += jz / this.mass;
			return true;

		},
	};
	const app = {
		mode: 'multiplayer', settings: { timeOfDay: 12 }, terrainData: terrain, query: null, spray: null, scene: null, audio: null, boatCtl,
		boat: { dimensions: { length: 4.5, beam: 2, draft: 0.3, freeboard: 0.6 } },
		camera: { position: new Vector3( pos[ 0 ], 4, pos[ 2 ] - 10 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'walk', position: new Vector3( pos[ 0 ], 1, pos[ 2 ] - 30 ), yaw: 0 },
		input: { hit: () => false, keys: new Set() },
		game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick() {} },
		net: null, remotePlayers: null,
		connect( url ) {

			if ( this.net ) this.net.disconnect();
			if ( ! this.remotePlayers ) this.remotePlayers = new LiteRemote();
			const rp = this.remotePlayers;
			this.net = new NetClient( {
				url, name, character: 'pepe', boat: state.boat,
				onPeerJoin: ( p ) => rp.addPeer( p ), onPeerLeave: ( id ) => rp.removePeer( id ), onStates: ( l, at ) => rp.applyStates( l, at ),
			} );
			this.net.connect();

		},
		disconnect() {

			if ( this.net ) this.net.disconnect();
			this.net = null;
			if ( this.remotePlayers ) this.remotePlayers.dispose();
			this.remotePlayers = null;

		},
		netState() {

			const p = this.player, b = this.boatCtl;
			const s = {
				p: [ p.position.x, p.position.y, p.position.z ], yaw: p.yaw, mode: p.mode, speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'pepe',
				boat: { id: state.boat, p: [ b.position.x, b.position.y, b.position.z ], q: [ b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w ], throttle: 0, steer: 0, rpm: 0, driven: true },
			};
			return this.features.get( 'netsync' ).decorateState( s );

		},
	};
	const features = new Features( app );
	app.features = features;
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed, hud: false, models: false, settings: { autoSpawn: false, merchants: 0, maxPirates: 0 } } ) } );
	const crewList = { list: crew };
	features.add( 'crew', { install: () => ( { members: () => crewList.list } ) } );
	const plane = { wreck: null, models: null, decorateState() {}, updateRemote() {} };
	features.add( 'seaplane', { install: () => plane } );
	const sync = features.add( 'netsync', { install: ( a, f ) => new NetSync( a, f, { crewDeck: () => fakeDeck( decks ), planeVisual: () => fakeVisual( visuals ) } ) } );
	app.netsync = sync;
	for ( const k of [ 'hullsCollided', 'playerBoatDamaged', 'remoteWorldEvent' ] ) features.on( k, ( e ) => events.push( { k, ...e } ) );
	const c = { name, app, features, naval, sync, events, toasts, state, decks, visuals, crewList, plane, pins: [] };
	c.frame = ( dt = 0.05 ) => {

		for ( const pin of c.pins ) pin();
		if ( app.remotePlayers ) app.remotePlayers.update( dt );
		features.update( dt );
		if ( app.net && app.net.online ) app.net.send( app.netState() );

	};

	return c;

}

async function run( clients, seconds, dt = 0.05 ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) {

		for ( const c of clients ) c.frame( dt );
		await sleep( dt * 1000 );

	}

}

async function until( clients, pred, seconds = 6, msg = '' ) {

	const t0 = Date.now();
	while ( Date.now() - t0 < seconds * 1000 ) {

		if ( pred() ) return true;
		await run( clients, 0.1 );

	}

	if ( ! pred() ) console.log( '  (timed out waiting for ' + msg + ')' );
	return pred();

}

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, reconnectSeconds: 5 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
const H = makeClient( 'Hana', base, { pos: [ 100, 0, 100 ], seed: 11 } );
const G = makeClient( 'Gus', base, { pos: [ 300, 0, 100 ], seed: 22, crew: [ { id: 'doge', post: 'gunner', side: 'port', slot: 0 }, { id: 'pengu', post: 'angler', side: 'starboard', slot: 0 } ] } );
const both = [ H, G ];
let O = null;

try {

	H.app.connect( `${ base }/island` );
	ok( await until( both, () => H.app.net.online, 5, 'H online' ), 'the host connects' );
	G.app.connect( `${ base }/island` );
	ok( await until( both, () => G.app.net && G.app.net.online && G.app.net.host === H.app.net.id, 5, 'G online' ), 'the guest connects; Hana is the host' );
	O = wireClient( `${ base }/island` );
	O.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'Olly', character: 'pepe', boat: null } );
	await O.next( 'welcome' );
	const hid = H.app.net.id, gid = G.app.net.id;
	ok( await until( both, () => H.app.remotePlayers.peers.get( gid )?.hasPose && G.app.remotePlayers.peers.get( hid )?.hasPose, 4, 'poses' ), 'both see the other\'s boat' );
	ok( await until( both, () => Array.isArray( H.app.remotePlayers.peers.get( gid ).extra.hv ), 3, 'hv' ) && H.app.remotePlayers.peers.get( gid ).extra.hv[ 3 ] === 420, 'the state carries the boat\'s way, mass and hull (hv)' );

	// ---- hulls: the guest's boat runs into the host's
	const hp = ( c ) => c.naval.playerHull.hp;
	const hHp0 = hp( H ), gHp0 = hp( G );
	G.app.boatCtl.position.set( 101.75, 0, 100 ); // 0.15 m into Hana's hull (her half beam 1, a skiff's 0.9)
	G.app.boatCtl.velocity.set( - 3, 0, 0 );
	G.app.boatCtl.calls.length = H.app.boatCtl.calls.length = 0;
	ok( await until( both, () => G.sync.hulls.stats.bumpsIn > 0, 4, 'bump' ), 'the host resolves the collision and the guest gets its bump' );
	await run( both, 0.3 );
	const gPush = G.app.boatCtl.calls.find( ( k ) => k.dx > 0 && k.jx === 0 ), gImp = G.app.boatCtl.calls.find( ( k ) => k.jx > 0 );
	ok( !! gPush, `the guest predicted the push-apart itself (dx ${ gPush && gPush.dx.toFixed( 3 ) })` );
	ok( !! gImp && G.app.boatCtl.velocity.x > - 3, `the guest's boat took the impulse away from the host's (jx ${ gImp && gImp.jx.toFixed( 0 ) } N s)` );
	ok( H.app.boatCtl.calls.some( ( k ) => k.jx < 0 ), 'the host\'s own boat took the opposite impulse' );
	ok( hp( G ) < gHp0 && hp( H ) < hHp0, `both hulls took the blow (guest ${ gHp0 } -> ${ hp( G ).toFixed( 2 ) }, host ${ hHp0 } -> ${ hp( H ).toFixed( 2 ) })` );
	ok( G.events.some( ( e ) => e.k === 'hullsCollided' && e.remote && e.byPlayer ) && H.events.some( ( e ) => e.k === 'hullsCollided' && e.remote ), 'hullsCollided on both machines' );
	ok( G.sync.hulls.stats.rams >= 1, 'the guest sees the host\'s ram effect (fx ram)' );
	ok( ! O.queue.some( ( m ) => m.t === 'bump' ), 'the observer never gets somebody else\'s bump' );
	const gDmg1 = G.events.filter( ( e ) => e.k === 'playerBoatDamaged' && e.cause === 'ramming' ).length;
	ok( gDmg1 === 1, `one blow, one damage event on the guest (${ gDmg1 })` );

	// ---- hulls: the guest's boat against the host's ship (a puppet on the guest's machine)
	G.app.boatCtl.velocity.set( 0, 0, 0 );
	G.app.boatCtl.position.set( 300, 0, 300 );
	const ship = H.naval.spawn( 'sloop', { id: 'test-sloop', x: 100, z: 300, yaw: 0, speed: 0 } );
	H.pins.push( () => { if ( ship.alive ) { ship.x = 100; ship.z = 300; ship.yaw = 0; ship.speed = 0; } } );
	ok( await until( both, () => G.naval.ships.some( ( s ) => s.id === 'test-sloop' && s.puppet ), 4, 'puppet' ), 'the guest shows the host\'s ship as a puppet' );
	await run( both, 0.5 );
	const shipHp0 = ship.hp, bumps0 = G.sync.hulls.stats.bumpsIn;
	const byShip = [];
	const offB = G.app.net.on( 'bump', ( m ) => byShip.push( m ) );
	G.app.boatCtl.calls.length = 0;
	G.app.boatCtl.position.set( 100 + 2.6 + 0.9 - 0.1, 0, 300 );
	G.app.boatCtl.velocity.set( - 3, 0, 0 );
	ok( await until( both, () => G.sync.hulls.stats.bumpsIn > bumps0, 4, 'ship bump' ), 'a blow against the host\'s ship comes back as a bump' );
	await run( both, 0.3 );
	offB();
	ok( byShip.some( ( m ) => m.by === 'test-sloop' && m.dmg > 0 && m.j[ 0 ] > 0 ), 'the bump names the ship, pushes the boat away and hurts her' );
	ok( ship.hp < shipHp0, `the ship (host side) took her share (${ shipHp0 } -> ${ ship.hp.toFixed( 2 ) })` );
	ok( G.app.boatCtl.calls.some( ( k ) => k.dx > 0 && k.jx === 0 ), 'the guest\'s naval world pushed her clear of the puppet (prediction only)' );
	const gDmg2 = G.events.filter( ( e ) => e.k === 'playerBoatDamaged' && e.cause === 'ramming' ).length - gDmg1;
	ok( gDmg2 === byShip.filter( ( m ) => m.dmg > 0 ).length, `no second blow from the guest's own world: ${ gDmg2 } damage event(s) for ${ byShip.filter( ( m ) => m.dmg > 0 ).length } damaging bump(s)` );
	G.app.boatCtl.velocity.set( 0, 0, 0 );
	G.app.boatCtl.position.set( 300, 0, 100 );
	H.naval.playerHull.hp = H.naval.playerHull.max;
	G.naval.playerHull.hp = G.naval.playerHull.max;

	// ---- crew on the remote boat
	ok( await until( both, () => H.sync.crew.decks.has( gid ) && H.decks.length === 1 && H.decks[ 0 ].updates > 0, 3, 'deck' ), 'the host stands the guest\'s crew on her boat' );
	const deck = H.decks[ 0 ];
	ok( deck.synced[ deck.synced.length - 1 ].join() === 'doge:gunner:port,pengu:angler:starboard', `the posts arrive (${ deck.synced[ deck.synced.length - 1 ] })` );
	ok( await until( both, () => deck.last && Math.abs( deck.last.x - 300 ) < 1 && Math.abs( deck.last.z - 100 ) < 1 && deck.last.boatId === 'skiff', 2, 'deck pose' ), 'the figures ride the remote boat\'s pose (it moved: they follow)' );
	G.crewList.list = [ { id: 'doge', post: 'gunner', side: 'starboard', slot: 0 } ];
	ok( await until( both, () => deck.synced[ deck.synced.length - 1 ].join() === 'doge:gunner:starboard', 3, 'repost' ), 'a change of posts follows' );
	G.sync.naval.onLocalShot( { x: 300, y: 1, z: 100 }, { x: 0, y: 2, z: 120 }, { owner: 'player', side: 'starboard', crew: 'doge' } );
	ok( await until( both, () => deck.fires.includes( 'doge' ), 2, 'fired' ), 'a remote crew gunner\'s shot plays his gesture' );

	// ---- rates: gunshots and volleys faster than the reload are dropped
	await run( both, 1.6 ); // (the starboard volley above has reloaded)
	const gunsIn = () => H.events.filter( ( e ) => e.k === 'remoteWorldEvent' && e.kind === 'gunshot' ).length;
	const g0 = gunsIn();
	for ( let i = 0; i < 4; i ++ ) G.sync.sendWorldEvent( 'gunshot', { weapon: 'musket', x: 300, y: 1.4, z: 100, dx: 1, dy: 0, dz: 0, hit: null } );
	const s0 = H.sync.naval.stats.shotsIn;
	for ( let i = 0; i < 10; i ++ ) G.sync.naval.onLocalShot( { x: 300, y: 1, z: 100 }, { x: 0, y: 2, z: 120 }, { owner: 'player', side: 'port' } );
	await run( both, 0.6 );
	ok( gunsIn() - g0 === 1, `four musket shots at once: one reaches the others (${ gunsIn() - g0 })` );
	ok( H.sync.naval.stats.shotsIn - s0 === CANNON_GATE.perVolley, `a ten-ball burst from one side: one volley of ${ CANNON_GATE.perVolley } is shown (${ H.sync.naval.stats.shotsIn - s0 })` );

	// ---- wrecks: the guest's boat wreck
	const evIn = [];
	const offE = H.app.net.on( 'event', ( m ) => evIn.push( m.kind ) );
	const own = G.naval.wrecks.create( { boat: 'skiff', x: 400, z: 400, yaw: 0.5, list: 1 } );
	const key = `${ gid }:${ own.id }`;
	ok( await until( both, () => H.naval.wrecks.remote.has( key ), 3, 'wreck' ), 'the guest\'s wreck is drawn by the host\'s naval Wrecks (schema entry)' );
	const hw = H.naval.wrecks.remote.get( key );
	ok( hw.boat === 'skiff' && Math.abs( hw.x - 400 ) < 0.05 && Math.abs( hw.yaw - 0.5 ) < 0.01 && Math.abs( hw.roll - own.roll ) < 0.01 && hw.owner === gid, 'with its boat, place, heading and list' );
	ok( ! evIn.includes( 'wreck' ), 'no world event relayed besides (the schema carries it)' );
	ok( !! O.link.room.state.wrecks.get( key ), 'a client without the feature sees the entry in its state too' );
	// a dropped guest: the entry stays and is not sent twice
	await run( both, 1.1 );
	G.app.net.link.drop();
	ok( await until( both, () => ! G.app.net.online, 2, 'G dropped' ), 'the guest drops' );
	ok( await until( both, () => G.app.net.online && G.app.net.id === gid, 8, 'G back' ), 'the guest reconnects to the same seat' );
	await run( both, 1.2 );
	let gEntries = 0;
	H.app.net.link.room.state.wrecks.forEach( ( e ) => { if ( e.owner === gid && e.kind === 'boat' ) gEntries ++; } );
	ok( H.naval.wrecks.remote.has( key ) && gEntries === 1, 'after the reconnect the wreck is still there, once' );
	G.naval.salvage( { free: true } );
	ok( await until( both, () => ! H.naval.wrecks.remote.has( key ), 3, 'salvaged' ), 'salvaged: gone for the host too' );
	offE();

	// ---- the seaplane wreck: the fuselage and its torn parts
	const pw = new PlaneWreck( { position: new Vector3( 500, 0.6, 520 ), quaternion: quatOf( 1.1, 0, 0 ), seed: 5, detach: [ 'wingL', 'tail' ] } );
	G.plane.wreck = pw;
	ok( await until( both, () => H.visuals.length === 1 && H.visuals[ 0 ].pose, 3, 'plane' ), 'the host draws the guest\'s seaplane wreck' );
	const vis = H.visuals[ 0 ];
	ok( vis.detached.join() === 'wingL,tail' && Math.hypot( vis.pose.x - 500, vis.pose.z - 520 ) < 6, `with the same parts torn off (${ vis.detached.join() }) where it lies` );
	await run( both, 1.0 );
	ok( vis.parts.wingL && Math.hypot( vis.parts.wingL.x - 500, vis.parts.wingL.z - 520 ) > 1, 'the torn parts fly off on the host too' );
	pw.detach( 'floatR' );
	ok( await until( both, () => vis.detached.includes( 'floatR' ), 3, 'floatR' ), 'a part torn off later follows' );
	G.plane.wreck = null; // (recovered, or the fuselage sank)
	ok( await until( both, () => vis.disposed, 3, 'plane gone' ), 'recovered / sunk: the host\'s view of it goes' );

	// ---- a sinking boat, then her wreck
	G.app.boatCtl.position.set( 300, 0, 160 );
	await run( both, 0.3 );
	G.naval.damagePlayer( 99999, 'test' );
	ok( !! G.naval.sinking, 'the guest\'s boat is going down' );
	const kinds = () => [ ...H.sync.wrecks.remote.values() ].filter( ( v ) => v.entry.owner === gid ).map( ( v ) => v.kind ).sort().join();
	ok( await until( both, () => kinds() === 'sinking', 3, 'sinking' ), 'the host sees her sinking' );
	ok( await until( both, () => kinds() === 'boat', 12, 'boat wreck' ), 'then her wreck on the bottom (the sinking entry gone)' );
	const wk = [ ...H.naval.wrecks.remote.keys() ].find( ( k ) => k.startsWith( gid + ':' ) );
	ok( !! wk && Math.hypot( H.naval.wrecks.remote.get( wk ).x - 300, H.naval.wrecks.remote.get( wk ).z - 160 ) < 0.5, 'where she went down' );

	// ---- the owner leaves: the wreck goes with her
	G.app.disconnect();
	ok( await until( [ H ], () => ! [ ...H.naval.wrecks.remote.keys() ].some( ( k ) => k.startsWith( gid + ':' ) ) && ! H.sync.crew.decks.size, 4, 'left' ), 'the guest leaves: her wreck and her crew\'s figures go' );
	ok( deck.disposed, 'the crew deck was disposed' );
	ok( H.sync.hulls.stats.bumpsOut >= 2 && ! O.queue.some( ( m ) => m.t === 'bump' ), `the host sent ${ H.sync.hulls.stats.bumpsOut } bumps, none to the observer` );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of [ H, G ] ) {

	try { c.app.disconnect(); } catch ( e ) { /* closed */ }
	try { c.features.dispose && c.features.dispose(); } catch ( e ) { /* closed */ }

}

try { if ( O ) O.close(); } catch ( e ) { /* closed */ }
await srv.close();
clearTimeout( watchdog );
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\nfeature-netsync-w11: all checks passed' );
process.exit( 0 );
