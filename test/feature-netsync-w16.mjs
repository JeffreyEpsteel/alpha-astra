// Plain-node test of wave 16A's multiplayer parts (src/features/netsync/RescueLink.js + server/rooms.mjs): a real server in-process
// and two browser-side stacks (NetClient over @colyseus/sdk + RemotePlayers + Features + the real Naval and Rescue features +
// NetSync, a stand-in hijack with boats left moored, no GPU):
//   launch   the guest fires a flare and its harbour launch sails on the guest; the host sees it (state rl -> a visual of kind
//            'launch' where the guest's launch is), and nothing of it enters the host's ship list; the host's own launch rides
//            the host's ship list instead (NavalLink 'world': a puppet of kind 'launch' on the guest) and is not sent twice
//   left     the host's boats left moored (hijack.left -> state lb) are entries of the guest's moored list ('left:<peer>:<n>',
//            drawn by RemotePlayers.setMoored); taken back, they go
//   node test/feature-netsync-w16.mjs
import './headless.mjs';
import { startServer } from '../server/index.mjs';
import { Features } from '../src/features/Features.js';
import { NetClient } from '../src/net/NetClient.js';
import { RemotePlayers } from '../src/net/RemotePlayers.js';
import { Naval } from '../src/features/naval/Naval.js';
import { NetSync } from '../src/features/netsync/NetSync.js';
import { RescueLink, RESCUE_SYNC } from '../src/features/netsync/RescueLink.js';
import * as rescueModule from '../src/features/rescue/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3, Quaternion, Group } from '../src/engine/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 150 s' ); process.exit( 1 ); }, 150000 );
const terrain = new TerrainData();

// RemotePlayers without avatars, name tags or boat models (all GPU / DOM): the interpolation is the real one
class LiteRemote extends RemotePlayers {

	constructor() {

		super( { scene: { add() {}, remove() {} }, camera: {} } );
		this.mooredLists = [];

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

	// (the hulls are BoatFactory models: GPU-free, but the list is what this test reads)
	setMoored( list ) {

		this.mooredLists.push( list.map( ( b ) => b.captain ) );
		this.mooredNow = list;

	}

}

function makeClient( name, base, { pos = [ 0, 0, 0 ], seed = 1 } = {} ) {

	const toasts = [], visuals = [];
	const state = { boat: 'skiff', name, money: 500, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const boatCtl = {
		position: new Vector3( pos[ 0 ] + 300, 0, pos[ 2 ] ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), mass: 420, enabled: true,
		driven: false, moored: true, throttle: 0, steer: 0, rpm: 0, applyCollision() { return true; },
	};
	const app = {
		mode: 'multiplayer', settings: { timeOfDay: 12, timeSpeed: 0 }, terrainData: terrain, colliders: new Colliders(), query: null, spray: null, scene: null, audio: null, boatCtl,
		boat: { dimensions: { length: 4.5, beam: 2, draft: 0.3, freeboard: 0.6 } },
		camera: { position: new Vector3( pos[ 0 ], 4, pos[ 2 ] - 10 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'swim', position: new Vector3( pos[ 0 ], - 0.06, pos[ 2 ] ), yaw: 0 },
		input: { hit: () => false, down: () => false, keys: new Set() },
		game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick() {} }, avatar: { character: 'pepe' }, paused: false,
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

			const p = this.player;
			const s = { p: [ p.position.x, p.position.y, p.position.z ], yaw: p.yaw, mode: p.mode, speed: 0, vy: 0, grounded: false, diving: false, action: null, character: 'pepe' };
			return this.features.get( 'netsync' ).decorateState( s );

		},
	};
	const features = new Features( app );
	app.features = features;
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed, hud: false, models: false, settings: { autoSpawn: false, merchants: 0, maxPirates: 0 } } ) } );
	const avatarFactory = () => ( { group: new Group(), ready: Promise.resolve( null ), dispose() {} } );
	const rescue = features.add( 'rescue', { install: ( a, f ) => rescueModule.install( a, f, { rng: () => 0.5, avatarFactory } ) } );
	const hijack = features.add( 'hijack', { install: () => ( { left: [] } ) } );
	const sync = features.add( 'netsync', { install: ( a, f ) => new NetSync( a, f, {
		rescueVisual: ( kind, id ) => { const v = { kind, id, last: null, visible: false, disposed: false, apply( ship, pose ) { this.last = { x: ship.x, z: ship.z, yaw: ship.yaw, y: pose.y }; }, setVisible( b ) { this.visible = b; }, dispose() { this.disposed = true; } }; visuals.push( v ); return v; },
	} ) } );
	app.netsync = sync;
	const c = { name, app, features, naval, rescue, hijack, sync, toasts, state, visuals };
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

// a rescue answered now: the flare goes up and the wait is cut short
async function flare( c, clients ) {

	c.rescue.flares = 1;
	c.rescue.fire();
	c.rescue.job.delay = 0;
	await run( clients, 0.2 );
	return c.rescue.job;

}

// ---- the pure part: the state fields
{

	const fake = { features: { get: ( n ) => ( n === 'rescue' ? { launchEntry: () => ( { kind: 'launch', x: 1.234, z: - 5.678, yaw: 7, speed: 4.5, inNaval: true } ) } : n === 'hijack' ? { left: [ { boat: 'lobster', x: 1, z: 2, heading: 0.5 }, { boat: 'nope', x: 0, z: 0 } ] } : null ) }, net: { isHost: false } };
	const rl = new RescueLink( fake );
	const s = rl.decorate( {} );
	ok( s.rl && s.rl[ 0 ] === 'launch' && s.rl[ 1 ] === 1.23 && s.rl[ 2 ] === - 5.68 && Math.abs( s.rl[ 3 ] - ( 7 - 2 * Math.PI ) ) < 1e-3 && s.rl[ 4 ] === 4.5, `a guest's launch rides its state: rl ${ JSON.stringify( s.rl ) }` );
	ok( s.lb && s.lb.length === 1 && s.lb[ 0 ][ 0 ] === 'lobster', 'its left boats: lb (known hulls only)' );
	fake.net.isHost = true;
	ok( ! rl.decorate( {} ).rl, 'the host\'s launch (in its ship list) is not sent twice' );
	ok( JSON.stringify( rl.decorate( {} ) ).length < 200 && RESCUE_SYNC.maxLeft === 6, 'small: within the state\'s extra budget' );

}

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, reconnectSeconds: 5 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
const H = makeClient( 'Hana', base, { pos: [ - 40, 0, 300 ], seed: 11 } );
const G = makeClient( 'Gus', base, { pos: [ - 60, 0, 330 ], seed: 22 } );
const both = [ H, G ];

try {

	H.app.connect( `${ base }/island` );
	ok( await until( both, () => H.app.net.online, 5, 'H online' ), 'the host connects' );
	G.app.connect( `${ base }/island` );
	ok( await until( both, () => G.app.net && G.app.net.online && G.app.net.host === H.app.net.id, 5, 'G online' ), 'the guest connects; Hana is the host' );
	const hid = H.app.net.id, gid = G.app.net.id;
	ok( await until( both, () => H.app.remotePlayers.peers.get( gid )?.hasPose && G.app.remotePlayers.peers.get( hid )?.hasPose && G.sync.naval.role === 'puppet', 4, 'poses' ), 'both see each other (the guest\'s naval is a puppet)' );

	// ---- the guest's launch
	const gj = await flare( G, both );
	const gs = gj && gj.ship;
	ok( gs && gs.kind === 'launch' && gj.own && G.naval.ships.includes( gs ) && ! gs.puppet, 'the guest\'s flare: its harbour launch sails on the guest' );
	ok( await until( both, () => H.sync.rescue.remote.has( gid ), 4, 'H sees G launch' ), 'the host gets it (state rl)' );
	await run( both, 1.5 );
	const hv = H.sync.rescue.remote.get( gid ), vis = hv && hv.visual;
	const d = vis && vis.last ? Math.hypot( vis.last.x - gs.x, vis.last.z - gs.z ) : Infinity;
	ok( vis && vis.kind === 'launch' && vis.visible && d < 6, `the host draws a launch where the guest's is (${ d.toFixed( 2 ) } m off at ${ gs.speed.toFixed( 1 ) } m/s)` );
	ok( ! H.naval.ships.some( ( s ) => s.kind === 'launch' ), 'and nothing of it enters the host\'s ship list' );
	ok( ! G.naval.ships.some( ( s ) => s.kind === 'launch' && s.puppet ), 'nor comes back to the guest as a puppet' );

	// ---- the host's launch: through the ship list
	const hj = await flare( H, both );
	const hs = hj && hj.ship;
	ok( hs && hs.kind === 'launch' && H.naval.ships.includes( hs ), 'the host\'s flare: its launch in the host\'s ship list' );
	ok( await until( both, () => G.naval.ships.some( ( s ) => s.puppet && s.id === hs.id && s.kind === 'launch' ), 4, 'G puppet' ), 'the guest draws it as a puppet of kind launch (NavalLink)' );
	await run( both, 0.5 );
	ok( ! G.sync.rescue.remote.has( hid ), 'and gets no second copy through the state' );

	// the guest's launch done: gone on the host
	G.rescue._release( G.rescue.job );
	ok( await until( both, () => ! H.sync.rescue.remote.has( gid ), 4, 'gone' ) && vis.disposed, 'her job over on the guest: the host\'s copy goes' );

	// ---- the host's left boats -> the guest's moored list
	H.hijack.left.push( { id: 'left-1', boat: 'lobster', name: 'Lobster boat', x: - 20, z: 280, heading: 0.5 }, { id: 'left-2', boat: 'skiff', name: 'Skiff', x: - 30, z: 290, heading: 0 } );
	const key0 = `left:${ hid }:0`, key1 = `left:${ hid }:1`;
	ok( await until( both, () => G.sync.moored.has( key0 ) && G.sync.moored.has( key1 ), 4, 'moored' ), 'the guest\'s moored list gets the host\'s left boats' );
	const e0 = G.sync.moored.get( key0 );
	const shown = G.app.remotePlayers.mooredNow || [];
	ok( e0.boat === 'lobster' && e0.p[ 0 ] === - 20 && e0.p[ 2 ] === 280 && Math.abs( e0.q[ 1 ] - Math.sin( 0.25 ) ) < 1e-3 && /Hana's lobster boat/.test( e0.name ) && shown.some( ( b ) => b.captain === key0 ), `drawn moored where she lies: "${ e0.name }"` );
	H.hijack.left.splice( 0, 1 );
	ok( await until( both, () => ! G.sync.moored.has( key1 ) && G.sync.moored.get( key0 )?.boat === 'skiff', 4, 'unmoored' ), 'one taken back: the list follows' );
	H.hijack.left.length = 0;
	ok( await until( both, () => ! [ ...G.sync.moored.keys() ].some( ( k ) => k.startsWith( 'left:' ) ), 4, 'none' ) && ! ( G.app.remotePlayers.mooredNow || [] ).length, 'none left: none drawn' );

} finally {

	for ( const c of both ) {

		try { c.app.disconnect(); } catch ( e ) { /* closed */ }

	}

	clearTimeout( watchdog );

}

await srv.close();
console.log( fails ? `feature-netsync-w16: ${ fails } failed` : 'feature-netsync-w16: all checks passed' );
process.exit( fails ? 1 : 0 );
