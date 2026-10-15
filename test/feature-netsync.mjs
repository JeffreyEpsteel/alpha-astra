// Plain-node test of the multiplayer extras (src/features/netsync + the NetClient / RemotePlayers additions): a real server
// (server/index.mjs on Colyseus, in-process on a free port) and two browser-side stacks (NetClient over @colyseus/sdk +
// RemotePlayers + Features + NetSync + the real Naval feature, no GPU): crew codes through the Crew API, a dropped guest
// reconnecting to its seat, a guest riding another player's boat, the host's ships rendered as puppets by the others,
// cannon fire shown to everybody, damage reported to the host, and host migration.
//   node test/feature-netsync.mjs
import './headless.mjs';
import { startServer } from '../server/index.mjs';
import { Features } from '../src/features/Features.js';
import { NetClient } from '../src/net/NetClient.js';
import { RemotePlayers } from '../src/net/RemotePlayers.js';
import { crewUrl } from '../src/net/Protocol.js';
import { Naval } from '../src/features/naval/Naval.js';
import * as netsync from '../src/features/netsync/index.js';
import { NetSync } from '../src/features/netsync/NetSync.js';
import { NavalLink } from '../src/features/netsync/NavalLink.js';
import { BOATS } from '../src/game/Boats.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, e = 0.1 ) => Math.abs( a - b ) <= e;
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 90 s' ); process.exit( 1 ); }, 90000 );

const terrain = new TerrainData();

// RemotePlayers without avatars, name tags or boat models (all GPU / DOM): the interpolation and the rider maths are the real ones
class LiteRemote extends RemotePlayers {

	constructor() {

		super( { scene: { add() {}, remove() {} }, camera: {} } );

	}

	addPeer( { id, name, character, boat } ) {

		if ( ! id || id === this.localId ) return null;
		let p = this.peers.get( id );
		if ( p ) return p;
		const { Vector3: V, Quaternion: Q } = { Vector3, Quaternion };
		p = {
			id, name: name || '?', character: character || 'hyptile', boatId: null, ownedBoat: boat || null, avatar: null, boat: null, boatReady: false, snaps: [], tag: null,
			pose: { position: new V(), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null },
			boatPos: new V(), boatQuat: new Q(), frame: new Q(), hasPose: false, lastAt: 0,
		};
		this.peers.set( id, p );
		return p;

	}

	_ensureBoat() {}

}

// one player's whole client side
function makeClient( name, base, { boat = 'skiff', pos = [ 0, 0, 0 ], seed = 1 } = {} ) {

	const toasts = [], placed = [];
	const state = { boat, name, money: 0, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const app = {
		mode: 'multiplayer', settings: { timeOfDay: 12 }, terrainData: terrain, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( ...pos ), quaternion: new Quaternion(), velocity: new Vector3(), driven: false, moored: true, throttle: 0, steer: 0, rpm: 0 },
		boat: { dimensions: { length: 4.5, beam: 2, draft: 0.3, freeboard: 0.6 } },
		camera: { position: new Vector3( pos[ 0 ], 4, pos[ 2 ] - 10 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'walk', position: new Vector3( pos[ 0 ], 1, pos[ 2 ] ), yaw: 0 },
		input: { hit: () => false, keys: new Set() },
		game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick() {} },
		toasts, placed, net: null, remotePlayers: null,
		serverUrl: () => `${ base }/island`,
		_placePlayer( x, y, z, yaw ) { placed.push( { x, y, z, yaw } ); this.player.position.set( x, y, z ); this.player.mode = 'walk'; },
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
				boat: { id: state.boat, p: [ b.position.x, b.position.y, b.position.z ], q: [ b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w ], throttle: 0, steer: 0, rpm: 0, driven: false },
			};
			return this.features.get( 'netsync' ).decorateState( s );

		},
	};
	const features = new Features( app );
	app.features = features;
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed, hud: false, models: false, settings: { autoSpawn: true, merchants: 2, maxPirates: 0 } } ) } );
	const sync = features.add( 'netsync', netsync );
	const events = [];
	features.on( 'shipSunk', ( e ) => events.push( e ) );
	const c = { name, app, features, naval, sync, events, toasts, placed, state };
	// a game loop: the remote players, then the features (naval, netsync), then the state out
	c.frame = ( dt = 0.05 ) => {

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

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, crewEveryMs: 100 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
const H = makeClient( 'Hana', base, { pos: [ 200, 0, - 300 ], seed: 11 } );
const G = makeClient( 'Gus', base, { pos: [ 205, 0, - 300 ], seed: 22 } );
H.app.player.position.set( 205, 1, - 320 ); // (the host walks about away from its boat for now)
G.app.player.position.set( 207, 1, - 300 );
const both = [ H, G ];

try {

	// ---- crews through the API
	H.app.connect( `${ base }/island` );
	ok( await until( both, () => H.app.net.online, 5, 'H online' ), 'the host client connects to the island room' );
	ok( H.app.net.isHost && H.app.net.crewCode === null, 'the first player is the host; island is no crew' );
	const code = await ( async () => { const p = H.sync.createCrew(); await run( both, 0.3 ); return p; } )();
	ok( /^[a-z]{6}$/.test( code ), `createCrew returns a code (${ code })` );
	ok( await until( both, () => H.app.net.online && H.app.net.crewCode === code, 5, 'H in crew' ), 'the creator moves into the crew room' );
	ok( H.app.net.isHost, 'the creator is the host of its crew' );

	await G.sync.joinCrew( code.toUpperCase() );
	ok( await until( both, () => G.app.net && G.app.net.online && G.app.net.crewCode === code, 5, 'G in crew' ), 'a second player joins by code from offline (connects first)' );
	ok( await until( both, () => H.sync.members().length === 2 && G.sync.members().length === 2, 3, 'two members' ), 'both see two crew members' );
	ok( ! G.app.net.isHost && G.app.net.host === H.app.net.id && G.sync.members().find( ( m ) => m.host ).name === 'Hana', 'the guest knows who the host is' );
	// a dropped connection (Colyseus reconnection): the same seat and id come back, the host never saw a leave
	const gid0 = G.app.net.id;
	let hostSawLeave = false;
	const offLeave = H.app.net.on( 'leave', ( m ) => { if ( m.id === gid0 ) hostSawLeave = true; } );
	await run( both, 1.1 ); // (the SDK reconnects rooms that were up for its minUptime)
	G.app.net.link.drop();
	ok( await until( both, () => G.app.net.online && G.app.net.id === gid0 && G.app.net.crewCode === code, 6, 'G back' ), 'a dropped guest comes back to its crew seat by itself (same id)' );
	ok( ! hostSawLeave && H.sync.members().length === 2 && G.app.net.host === H.app.net.id, 'the host never saw it leave; the guest still knows the host' );
	offLeave();
	let rejected = false;
	try { await G.sync.joinCrew( 'abc' ); } catch ( e ) { rejected = true; }
	ok( rejected, 'a malformed code is rejected before any network call' );

	// ---- the crew panel needs a DOM: only the module surface is checked here
	ok( typeof netsync.openCrewPanel === 'function' && netsync.openCrewPanel( { features: { get: () => null } } ) === null, 'openCrewPanel( app ) is a no-op without the feature' );
	ok( H.sync.isOpen() === false && typeof H.sync.close === 'function', 'the feature has the isOpen / close pair Features.panelOpen() uses' );

	// ---- ships: the host simulates, the guest renders puppets
	ok( await until( both, () => H.naval.ships.length >= 2 && G.naval.ships.length >= 2, 8, 'ships' ), 'the host spawns its merchants and the guest receives them' );
	ok( H.sync.naval.role === 'host' && G.sync.naval.role === 'puppet' && H.naval.active && G.naval.active, 'naval is active for both (host and puppet roles) in multiplayer mode' );
	await run( both, 1.2 );
	const hid = H.naval.ships.map( ( s ) => s.id ).sort(), gid = G.naval.ships.map( ( s ) => s.id ).sort();
	ok( hid.join() === gid.join() && G.naval.ships.every( ( s ) => s.puppet ), `the guest shows exactly the host's ships (${ hid.join( ', ' ) })` );
	const hs = H.naval.ships[ 0 ], gs = G.naval.ships.find( ( s ) => s.id === hs.id );
	ok( Math.hypot( hs.x - gs.x, hs.z - gs.z ) < 25 && gs.kind === hs.kind && gs.maxHp === hs.maxHp, `a puppet follows its ship (${ Math.hypot( hs.x - gs.x, hs.z - gs.z ).toFixed( 1 ) } m apart)` );
	await run( both, 3 );
	ok( G.naval.ships.every( ( s ) => hid.includes( s.id ) || H.naval.ships.some( ( x ) => x.id === s.id ) ), 'the guest never spawns ships of its own' );
	ok( H.sync.naval.stats.worldsOut > 5 && G.sync.naval.stats.worldsIn > 5, `the host sends ~5 Hz (${ H.sync.naval.stats.worldsOut } sent in a few seconds)` );

	// ---- cannon fire is seen by everybody
	G.naval.playerGun.owned = true;
	H.naval.playerGun.owned = true;
	// (wave 11: a hull carries shot in its magazine; a skiff's is empty unless it is stocked)
	for ( const c of [ G, H ] ) if ( c.naval.ammo && c.naval.ammo.setMax && c.naval.ammo.rounds <= 0 ) c.naval.ammo.setMax( 20, { fill: true } );
	G.app.boatCtl.position.set( gs.x + 40, 0, gs.z );
	G.app.boatCtl.moored = false;
	await run( both, 0.6 );
	ok( G.naval.fire( 'port' ) || G.naval.fire( 'starboard' ), 'the guest fires its swivel gun' );
	await run( both, 0.15 );
	ok( H.naval.balls.active.some( ( b ) => b.owner === 'remote:' + G.app.net.id && b.damage === 0 ), 'the host sees the guest\'s cannonball (a visual ball without damage)' );
	ok( H.sync.naval.stats.shotsIn >= 1 && G.sync.naval.stats.shotsOut >= 1, 'a shot is a broadcast event (out on one side, in on the other)' );
	H.app.boatCtl.moored = false;
	H.app.boatCtl.position.set( gs.x - 40, 0, gs.z ); // (open water: a ball that lands at once is gone before it can be seen)
	await run( both, 0.4 );
	ok( H.naval.fire( 'port' ) || H.naval.fire( 'starboard' ), 'the host fires its swivel gun' );
	await run( both, 0.15 );
	ok( G.naval.balls.active.some( ( b ) => b.owner === 'remote:' + H.app.net.id ), 'the guest sees the host\'s cannonball' );

	// ---- damage is reported to the host, which applies it; the sinking credit goes to the guest
	await run( both, 1.5 );
	const target = H.naval.ships.find( ( s ) => s.alive );
	const mirror = () => G.naval.ships.find( ( s ) => s.id === target.id );
	G.app.boatCtl.position.set( target.x + 30, 0, target.z );
	await run( both, 0.6 );
	const hp0 = target.hp;
	const ball = { owner: 'player', damage: 20, travelled: 0 };
	G.naval._shipHit( ball, mirror(), 'hull', { x: target.x, y: 1, z: target.z } );
	ok( await until( both, () => target.hp < hp0, 3, 'host hp' ) && near( hp0 - target.hp, 20, 0.6 ), `the host applied the reported hit (${ hp0 } -> ${ target.hp })` );
	ok( H.sync.naval.stats.hitsIn >= 1 && G.sync.naval.stats.hitsOut >= 1, 'hit reports are counted on both sides' );
	await run( both, 0.6 );
	ok( near( mirror().hp, target.hp, 8 ), 'the next world snapshot brings the guest the new hit points' );
	for ( let i = 0; i < 12 && target.alive; i ++ ) {

		G.naval._shipHit( { owner: 'player', damage: 60, travelled: 0 }, mirror(), 'hull', { x: target.x, y: 1, z: target.z } );
		await run( both, 0.15 );

	}

	ok( ! target.alive, 'the host sank the ship under the reported hits' );
	ok( await until( both, () => G.events.some( ( e ) => e.id === target.id && e.byPlayer ), 3, 'credit' ), 'the guest gets the sinking credit (shipSunk, byPlayer)' );
	ok( ! H.events.some( ( e ) => e.id === target.id && e.byPlayer ), 'the host does not credit itself for the guest\'s kill' );

	// ---- passengers
	H.app.boatCtl.position.set( 200, 0, - 300 );
	G.app.player.position.set( 203, 1, - 300 );
	H.app.player.position.set( 200, 1, - 330 );
	G.app.boatCtl.position.set( 600, 0, 600 );
	ok( await until( both, () => !! G.sync._candidate, 5, 'candidate' ), 'a slow remote boat within reach becomes a ride candidate' );
	const entry = G.features.nearestInteractable( G.app.player.position );
	ok( entry && entry.id === 'netsync.ride' && entry.prompt() === 'Ride with Hana', `the E prompt reads "${ entry && entry.prompt() }"` );
	entry.onInteract();
	ok( await until( both, () => !! G.sync.riding, 4, 'riding' ), 'E boards: the server seats the guest' );
	ok( G.sync.riding.host === H.app.net.id && G.sync.riding.seat === 0 && G.app.net.rides.get( G.app.net.id ).host === H.app.net.id, 'riding = { host, seat 0 } and the client knows the rides table' );
	await run( both, 0.8 );
	const seat = BOATS.skiff.seats[ 0 ];
	let rp = G.sync.ridePose();
	ok( rp && rp.valid && near( rp.position.x, 200 + seat.x, 0.08 ) && near( rp.position.z, - 300 + seat.z, 0.08 ) && near( rp.position.y, BOATS.skiff.deckY, 0.08 ), `ridePose is the seat on the host boat (${ rp && rp.position.x.toFixed( 2 ) }, ${ rp && rp.position.z.toFixed( 2 ) })` );
	ok( near( rp.yaw, seat.yaw + Math.PI, 1e-6 ) && rp.boatId === 'skiff', 'ridePose carries the avatar yaw in the boat frame and the boat id' );
	const hostView = H.app.remotePlayers.peers.get( G.app.net.id );
	ok( hostView && hostView.riding && hostView.pose.mode === 'seat' && near( hostView.pose.position.x, 200 + seat.x, 0.1 ) && near( hostView.pose.position.z, - 300 + seat.z, 0.1 ), 'the host sees the guest seated on its own boat' );
	ok( G.sync.decorateState( { mode: 'walk', p: [ 0, 0, 0 ] } ).mode === 'ride' && G.sync.decorateState( { p: [ 0, 0, 0 ] } ).ride === H.app.net.id, 'decorateState turns the sent state into mode ride at the seat' );
	ok( await until( both, () => H.sync.guests.length === 1, 2, 'guests' ) && H.toasts.some( ( t ) => /came aboard/.test( t ) ), 'the host is told who came aboard' );
	// the boat sails away: the guest follows
	H.app.boatCtl.position.set( 230, 0, - 300 );
	H.app.boatCtl.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), Math.PI / 2 );
	await run( both, 1.0 );
	rp = G.sync.ridePose();
	// (turned 90 degrees about +Y: boat-frame (x, z) -> world (z, -x), i.e. the seat at z = -0.91 sits at world x = -0.91)
	ok( near( rp.position.x, 230 + seat.z, 0.12 ) && near( rp.position.z, - 300 - seat.x, 0.12 ), `the seat moves and turns with the host boat (${ rp.position.x.toFixed( 2 ) }, ${ rp.position.z.toFixed( 2 ) })` );
	ok( ! G.sync._findCandidate(), 'no second ride prompt while aboard' );
	// step off at the nearest shore
	G.features.nearestInteractable( G.app.player.position ) && G.sync.stepOff();
	ok( G.sync.riding === null && G.placed.length === 1, 'stepping off puts the player somewhere (placePlayer called once)' );
	await run( both, 0.5 );
	ok( ! H.app.net.rides.size && ! G.app.net.rides.size, 'the rides table is empty again on both sides' );
	const pl = G.placed[ 0 ];
	ok( Math.hypot( pl.x - 230, pl.z + 300 ) < 16, `the guest lands within 14 m of the boat (${ Math.hypot( pl.x - 230, pl.z + 300 ).toFixed( 1 ) } m)` );

	// a closed boat is not offered
	H.sync.setOpenToGuests( false );
	G.app.player.position.set( 232, 1, - 300 );
	await run( both, 1.0 );
	ok( ! G.sync._candidate, 'a boat closed to guests is not offered' );
	H.sync.setOpenToGuests( true );

	// ---- host migration: the old host leaves, the guest takes over the ships
	const gShipsBefore = G.naval.ships.length;
	H.app.disconnect();
	ok( await until( [ G ], () => G.app.net.isHost, 5, 'G host' ), 'host migration: the remaining player becomes the host' );
	await run( [ G ], 0.3 );
	ok( G.sync.naval.role === 'host' && G.naval.active && G.naval.ships.every( ( s ) => ! s.puppet ), `the new host runs the ships itself (was ${ gShipsBefore } puppets)` );
	ok( await until( [ G ], () => G.naval.ships.length >= 1 && G.naval.ships.every( ( s ) => ! s.puppet ), 6, 'own ships' ), 'the new host respawns its own sea' );
	G.app.disconnect();
	await run( [ G ], 0.2 );
	ok( G.sync.naval.role === 'solo' && ! G.naval.active, 'offline again: naval goes back to its normal solo rules (inactive in multiplayer mode)' );

	// ---- the link uses the naval feature's own net API when it has one
	{

		const calls = [];
		const stub = {
			ships: [ { id: 's1', kind: 'sloop', name: 'A', x: 1, z: 2, yaw: 0.5, speed: 3, hp: 10, maxHp: 20, state: 'patrol', rigging: 1 } ],
			setNetRole( r ) { calls.push( [ 'role', r ] ); },
			applyRemoteShips( list, at ) { calls.push( [ 'ships', list.length, at ] ); },
			remoteShot( from, dir, v, info ) { calls.push( [ 'shot', from[ 0 ], dir[ 2 ], v, info.owner ] ); },
			applyRemoteHit( id, dmg, part, from ) { calls.push( [ 'hit', id, dmg, part, from ] ); return { found: true, sunk: false }; },
		};
		const sent = [];
		const net = { online: true, isHost: false, id: 'me', peers: new Map( [ [ 'a', {} ] ] ), on: () => () => {}, sendFx: ( f ) => sent.push( [ 'fx', f.kind ] ), sendHit: ( h ) => sent.push( [ 'hit', h.ship ] ), sendWorld: ( s ) => { sent.push( [ 'world', s.length, s[ 0 ].k ] ); return true; } };
		const sync = { features: { get: () => stub, emit() {} }, net, app: {} };
		const link = new NavalLink( sync );
		link.update( 0.1 );
		ok( calls[ 0 ] && calls[ 0 ][ 0 ] === 'role' && calls[ 0 ][ 1 ] === 'puppet' && stub.netHooks && typeof stub.netHooks.onShot === 'function', 'official API: setNetRole( "puppet" ) and netHooks are used' );
		link.onWorld( { ships: [ { id: 's1' } ], at: 5 } );
		link.onFx( { id: 'peer', kind: 'shot', from: [ 1, 2, 3 ], dir: [ 0, 0, 1 ], v: 100, d: 0, o: 'player' } );
		ok( calls.some( ( c ) => c[ 0 ] === 'ships' && c[ 2 ] === 5 ) && calls.some( ( c ) => c[ 0 ] === 'shot' && c[ 3 ] === 100 && c[ 4 ] === 'remote:peer' ), 'official API: applyRemoteShips / remoteShot' );
		ok( stub.netHooks.onShipHit( stub.ships[ 0 ], 12, 'hull' ) === true && sent.some( ( s ) => s[ 0 ] === 'hit' && s[ 1 ] === 's1' ), 'official API hook: a puppet hit is reported, not applied' );
		net.isHost = true;
		link.update( 0.1 );
		link.update( 0.2 );
		ok( calls.some( ( c ) => c[ 0 ] === 'role' && c[ 1 ] === 'host' ) && sent.some( ( s ) => s[ 0 ] === 'world' && s[ 1 ] === 1 && s[ 2 ] === 'sloop' ), 'official API: the host role sends a compact world' );
		link.onHit( { from: 'peer', ship: 's1', dmg: 999, part: 'hull' } );
		ok( calls.some( ( c ) => c[ 0 ] === 'hit' && c[ 1 ] === 's1' && c[ 2 ] === 60 && c[ 4 ] === 'peer' ), 'official API: applyRemoteHit gets the damage clamped to 60' );

	}

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of [ H, G ] ) {

	try { c.app.disconnect(); } catch ( e ) { /* closed */ }
	try { c.features.dispose(); } catch ( e ) { /* closed */ }

}

await srv.close();
clearTimeout( watchdog );
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\nfeature-netsync: all checks passed' );
process.exit( 0 );
