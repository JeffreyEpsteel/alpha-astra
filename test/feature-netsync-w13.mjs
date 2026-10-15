// Plain-node test of wave 13's multiplayer parity (src/features/netsync PlaneLink / StrongholdLink / TownLink + server/rooms.mjs):
// a real server in-process and two browser-side stacks (NetClient over @colyseus/sdk + RemotePlayers + Features + NetSync + the
// real Naval, Destruction (Rapier) and Stronghold features, a stand-in seaplane with the real RemotePlanes and Wreck, no GPU):
//   planes   a remote pilot's airframe, livery and upgrades reach the other side (her state is no longer refused: mode
//            'plane' goes as 'seat'); a bail-out shows her under a canopy, the abandoned plane flies on as a stray entry
//            until it wrecks (then the wreck entry); the airframe she has out is a parked entry everybody sees
//   fort     the host runs Blackwater: a battery silenced there is silenced on the guest, the host's batteries fire at the
//            guest's boat (the guest's never fire), a guest's attack rings the host's bell, a guard beaten on the guest
//            comes off the host's watch, two claims at once: one is granted, the claimant alone gets the loot; the
//            brotherhood's retake on the host reaches the guest
//   town     a Tidemark prop broken on the guest breaks on the host and back (with its port), the host's respawn comes back
//            on the guest, a guest's askHost( 'raid' ) reaches the host's features alone
//   reconnect  the guest drops and comes back: the planes and the stronghold are still what the room says
//   node test/feature-netsync-w13.mjs
import './headless.mjs';
import { startServer } from '../server/index.mjs';
import { Features } from '../src/features/Features.js';
import { NetClient } from '../src/net/NetClient.js';
import { RemotePlayers } from '../src/net/RemotePlayers.js';
import { Naval } from '../src/features/naval/Naval.js';
import { NetSync } from '../src/features/netsync/NetSync.js';
import { upgradeCode, upgradesOf } from '../src/features/netsync/PlaneLink.js';
import { planeModelOf } from '../src/features/netsync/WreckLink.js';
import { RemotePlanes } from '../src/features/seaplane/Remote.js';
import { Wreck as PlaneWreck } from '../src/features/seaplane/Wreck.js';
import * as stronghold from '../src/features/pirates/Stronghold.js';
import { batteryDecision } from '../src/features/pirates/Stronghold.js';
import * as destruction from '../src/features/destruction/index.js';
import { initPhysics } from '../src/physics/World.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { strongholdLayout } from '../src/world/islands/stronghold/Layout.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 180 s' ); process.exit( 1 ); }, 180000 );
const terrain = new TerrainData();
const L = strongholdLayout();
ok( await initPhysics(), 'Rapier loads (the destruction feature)' );

// ---- pure parts
{

	const u = { engine: 2, floats: 0, tank: 1, flaps: 0, pod: 1, armour: 0, lights: 0, search: 1, radio: 1, livery: 3 };
	const code = upgradeCode( u );
	ok( code === '2010100113' && JSON.stringify( upgradesOf( code ) ) === JSON.stringify( u ), `upgradeCode / upgradesOf round-trip (${ code })` );
	ok( planeModelOf( 'petrel-2' ).af === 'petrel' && planeModelOf( 'petrel-2' ).liv === 2 && planeModelOf( 'seaplane' ).af === 'jade' && planeModelOf( 'kestrel' ).liv === 0, 'a plane wreck\'s model names its airframe and paint (\'seaplane\' is the Jade)' );

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

function fakeVisual( log, info = {} ) {

	const v = {
		...info, detached: [], pose: null, parts: {}, disposed: false, spins: 0, visible: true,
		detach( n ) { this.detached.push( n ); },
		setPose( p ) { this.pose = { x: p.x, y: p.y, z: p.z }; },
		setPart( n, p ) { this.parts[ n ] = { x: p.x, y: p.y, z: p.z }; },
		spin() { this.spins ++; }, partVisible() {}, setVisible( b ) { this.visible = b; },
		dispose() { this.disposed = true; },
	};
	log.push( v );
	return v;

}

// the seaplane feature as far as the network sees it: the airframe out, its flight, the chute, the wreck, the models and the
// real RemotePlanes (decorateState is Seaplane.decorateState's)
function fakeSeaplane( log ) {

	const models = { created: [], create( af = 'jade', liv = 0 ) { const v = fakeVisual( log, { af, liv, kind: 'flying' } ); this.created.push( v ); return v; } };
	const sp = {
		af: 'petrel', owned: true, piloted: false, abandoned: false, lost: false, chute: null, wreck: null,
		upgrades: { engine: 2, floats: 0, tank: 1, flaps: 0, pod: 0, armour: 0, lights: 0, search: 0, radio: 1, livery: 2 },
		flight: { position: new Vector3( 0, 0.4, 0 ), quaternion: new Quaternion(), rpm: 0.7, heading() { return 0; } },
		models, remote: new RemotePlanes( { models } ),
		owns( af ) { return af === this.af && this.owned; },
		decorateState( out ) {

			if ( ! out || ! this.piloted ) return out;
			const p = this.flight.position, q = this.flight.quaternion, r = ( v ) => Math.round( v * 1000 ) / 1000;
			out.plane = { p: [ r( p.x ), r( p.y ), r( p.z ) ], q: [ r( q.x ), r( q.y ), r( q.z ), r( q.w ) ], thr: r( this.flight.rpm ), af: this.af, liv: this.upgrades.livery || 0 };
			out.yaw = this.flight.heading() + Math.PI;
			return out;

		},
		updateRemote( states ) { this.remote.ingest( states ); },
		update( dt ) { this.remote.update( dt ); },
	};
	return sp;

}

function makeClient( name, base, { pos = [ 0, 0, 0 ], seed = 1 } = {} ) {

	const toasts = [], visuals = [], chutes = [], events = [];
	const state = { boat: 'skiff', name, money: 0, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const boatCtl = {
		position: new Vector3( ...pos ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), mass: 420, enabled: true,
		driven: true, moored: false, throttle: 0, steer: 0, rpm: 0,
		applyCollision() { return true; },
	};
	const app = {
		mode: 'multiplayer', settings: { timeOfDay: 12, timeSpeed: 0 }, terrainData: terrain, colliders: new Colliders(), query: null, spray: null, scene: null, audio: null, boatCtl,
		boat: { dimensions: { length: 4.5, beam: 2, draft: 0.3, freeboard: 0.6 } },
		camera: { position: new Vector3( pos[ 0 ], 4, pos[ 2 ] - 10 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new Vector3( pos[ 0 ], 1, pos[ 2 ] ), yaw: 0 },
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
		// App.netState: the player's mode as Player.js has it ('plane' in the cockpit or the harness), the seaplane's fields first
		netState() {

			const p = this.player, b = this.boatCtl;
			const s = {
				p: [ p.position.x, p.position.y, p.position.z ], yaw: p.yaw, mode: p.mode, speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'pepe',
				boat: { id: state.boat, p: [ b.position.x, b.position.y, b.position.z ], q: [ b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w ], throttle: 0, steer: 0, rpm: 0, driven: true },
			};
			this.features.get( 'seaplane' ).decorateState( s );
			return this.features.get( 'netsync' ).decorateState( s );

		},
	};
	const features = new Features( app );
	app.features = features;
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed, hud: false, models: false, settings: { autoSpawn: false, merchants: 0, maxPirates: 0 } } ) } );
	const plane = features.add( 'seaplane', { install: () => fakeSeaplane( visuals ) } );
	const d = features.add( 'destruction', destruction );
	const s = features.add( 'stronghold', { install: ( a, f ) => stronghold.install( a, f, { build: false, seed: 9 } ) } );
	const sync = features.add( 'netsync', { install: ( a, f ) => new NetSync( a, f, {
		// (a wreck entry names its airframe and paint in its model, a plane entry has af / liv)
		planeVisual: ( e ) => fakeVisual( visuals, { ...( e.af ? { af: e.af, liv: e.liv } : planeModelOf( e.model ) ), kind: e.kind || 'wreck' } ),
		chuteVisual: ( id ) => { const v = { id, last: null, disposed: false, setPose( p, yaw, open ) { this.last = { x: p.x, y: p.y, z: p.z, yaw, open }; }, dispose() { this.disposed = true; } }; chutes.push( v ); return v; },
	} ) } );
	app.netsync = sync;
	for ( const k of [ 'remoteWorldEvent', 'hostRequest', 'strongholdAlarm', 'strongholdClaimed', 'strongholdRetaken', 'batterySilenced', 'propDestroyed', 'propRespawned' ] ) features.on( k, ( e ) => events.push( { k, ...e } ) );
	const c = { name, app, features, naval, plane, d, s, sync, events, toasts, state, visuals, chutes, pins: [] };
	c.frame = ( dt = 0.05 ) => {

		for ( const pin of c.pins ) pin( dt );
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

// a spot at sea in front of a battery, in its reach and arc, with a clear line of fire (as test/feature-stronghold.mjs)
const seaSpot = ( b, dist = 150 ) => {

	for ( const off of [ 0, 0.15, - 0.15, 0.3, - 0.3, 0.45, - 0.45, 0.6, - 0.6 ] ) for ( const r of [ dist, dist - 30, dist + 30 ] ) {

		const x = b.x + Math.sin( b.yaw + off ) * r, z = b.z + Math.cos( b.yaw + off ) * r;
		if ( terrain.heightAt( x, z ) < - 4 && batteryDecision( { ...b, reload: 0, silenced: false }, { ok: true, x, y: 0, z }, { terrain } ).fire ) return { x, z };

	}

	return null;

};

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, reconnectSeconds: 5 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
const H = makeClient( 'Hana', base, { pos: [ 0, 0, - 600 ], seed: 11 } );
const G = makeClient( 'Gus', base, { pos: [ 40, 0, - 600 ], seed: 22 } );
const both = [ H, G ];

try {

	H.app.connect( `${ base }/island` );
	ok( await until( both, () => H.app.net.online, 5, 'H online' ), 'the host connects' );
	G.app.connect( `${ base }/island` );
	ok( await until( both, () => G.app.net && G.app.net.online && G.app.net.host === H.app.net.id, 5, 'G online' ), 'the guest connects; Hana is the host' );
	const hid = H.app.net.id, gid = G.app.net.id;
	ok( await until( both, () => H.app.remotePlayers.peers.get( gid )?.hasPose && G.app.remotePlayers.peers.get( hid )?.hasPose, 4, 'poses' ), 'both see each other' );
	ok( await until( both, () => H.sync.fort.role === 'host' && G.sync.fort.role === 'guest', 3, 'roles' ), 'the stronghold link: Hana runs Blackwater, Gus mirrors it' );
	ok( H.d.built && G.d.built && H.d.props.some( ( p ) => p.port === 'tidemark' ), 'both run the destruction feature (Tidemark\'s props among them)' );

	// ================================================================ planes
	// ---- Hana flies her Petrel (livery 2, engine 2, tank, radio): Gus sees the right model and paint
	const HP = H.plane, f = HP.flight;
	HP.piloted = true;
	H.app.player.mode = 'plane'; // (Player.js in the cockpit)
	f.position.set( 0, 80, - 500 );
	H.pins.push( ( dt ) => { if ( HP.piloted || HP.abandoned ) f.position.z += 30 * dt; } );
	ok( await until( both, () => G.plane.remote.peers.has( hid ), 4, 'remote plane' ), 'Gus sees Hana\'s plane (her state is sent while she flies)' );
	const rpl = G.plane.remote.peers.get( hid );
	ok( rpl.af === 'petrel' && rpl.liv === 2 && rpl.visual && rpl.visual.af === 'petrel' && rpl.visual.liv === 2, `the right airframe and paint (${ rpl.af }, livery ${ rpl.liv })` );
	const peerH = G.app.remotePlayers.peers.get( hid );
	ok( peerH.extra.plane.up === upgradeCode( HP.upgrades ) && upgradesOf( peerH.extra.plane.up ).engine === 2 && upgradesOf( peerH.extra.plane.up ).radio === 1, `her upgrades ride along (${ peerH.extra.plane.up })` );
	ok( peerH.pose.mode === 'seat', 'her avatar sits (mode \'plane\' goes as \'seat\')' );
	await run( both, 0.6 );
	ok( rpl.visual.pose && Math.abs( rpl.visual.pose.y - 80 ) < 0.5 && rpl.visual.pose.z > - 500, `the plane flies on Gus' screen (z ${ rpl.visual.pose && rpl.visual.pose.z.toFixed( 1 ) })` );
	const fed0 = G.sync.planes.stats.fed;
	await run( both, 0.5 );
	const fed = G.sync.planes.stats.fed - fed0;
	ok( fed >= 4 && fed <= 12, `only new samples are fed to the remote planes (${ fed } in 0.5 s at 15 Hz)` );
	ok( ! G.app.net.link.room.state.planes.has( hid + ':parked' ), 'no parked entry while she flies it' );

	// ---- she bails out: a canopy over her avatar, the plane flies on as a stray entry
	HP.piloted = false;
	HP.abandoned = true;
	HP.chute = { position: new Vector3( f.position.x + 2, 75, f.position.z ), yaw: 0.6, state: 'open', open01: 0.8 };
	H.app.player.position.copy( HP.chute.position );
	H.pins.push( ( dt ) => { if ( HP.chute ) { HP.chute.position.y -= 5.5 * dt; H.app.player.position.copy( HP.chute.position ); } } );
	ok( await until( both, () => G.sync.planes.chutes.has( hid ) && G.chutes.length && G.chutes[ 0 ].last, 3, 'chute' ), 'Gus sees Hana under her canopy' );
	await run( both, 0.4 );
	const cv = G.chutes[ 0 ];
	ok( Math.abs( cv.last.yaw - 0.6 ) < 1e-3 && cv.last.open > 0.7 && Math.hypot( cv.last.x - HP.chute.position.x, cv.last.z - HP.chute.position.z ) < 3 && Math.abs( cv.last.y - HP.chute.position.y ) < 4, `at her place, heading and opening (y ${ cv.last.y.toFixed( 1 ) } vs ${ HP.chute.position.y.toFixed( 1 ) })` );
	ok( ! G.plane.remote.peers.has( hid ) && rpl.visual.disposed, 'the plane she left is no longer drawn from her state' );
	ok( await until( both, () => G.sync.planes.remote.has( hid + ':stray' ), 3, 'stray' ), 'it flies on as Hana\'s stray entry' );
	const sv = G.sync.planes.remote.get( hid + ':stray' ), svVis = sv.visual;
	ok( sv.af === 'petrel' && sv.liv === 2 && sv.visual && sv.visual.af === 'petrel', 'the stray: her airframe in her paint' );
	const z0 = sv.visual.pose ? sv.visual.pose.z : - 1e9;
	await run( both, 0.8 );
	ok( sv.visual.pose && sv.visual.pose.z > z0 + 10 && Math.abs( sv.visual.pose.z - f.position.z ) < 12, `it keeps flying on Gus' screen (${ z0.toFixed( 1 ) } -> ${ sv.visual.pose && sv.visual.pose.z.toFixed( 1 ) }, the owner's ${ f.position.z.toFixed( 1 ) })` );
	ok( sv.visual.spins > 0, 'its propeller turns' );
	// ---- it hits the sea: the wreck entry takes over
	HP.abandoned = false;
	HP.lost = true;
	HP.wreck = new PlaneWreck( { position: f.position.clone().setY( 0.5 ), quaternion: new Quaternion(), seed: 4, detach: [ 'wingR' ], airframe: 'petrel' } );
	ok( await until( both, () => ! G.sync.planes.remote.has( hid + ':stray' ) && [ ...G.sync.wrecks.remote.values() ].some( ( v ) => v.kind === 'plane' && v.entry.owner === hid ), 3, 'wreck' ), 'the stray goes and the wreck entry takes over' );
	const wv = [ ...G.sync.wrecks.remote.values() ].find( ( v ) => v.kind === 'plane' );
	ok( wv.entry.model === 'petrel-2' && wv.view && wv.view.visual && wv.view.visual.af === 'petrel' && wv.view.visual.liv === 2 && wv.view.wreck.airframe === 'petrel', `the wreck is a Petrel in her paint (${ wv.entry.model })` );
	ok( svVis.disposed && ! sv.visual, 'the stray\'s model is gone' );
	// ---- she lands in the water
	HP.chute = null;
	H.app.player.mode = 'swim';
	ok( await until( both, () => ! G.sync.planes.chutes.has( hid ) && cv.disposed, 3, 'chute gone' ), 'down in the water: the canopy goes' );
	// ---- recovered: the Kestrel out on the airstrip pad, parked
	HP.wreck = null;
	HP.lost = false;
	HP.af = 'kestrel';
	HP.upgrades.livery = 1;
	f.position.set( 300, 6, 200 );
	f.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 1.2 );
	ok( await until( both, () => G.sync.planes.remote.has( hid + ':parked' ), 3, 'parked' ), 'the airframe she has out is a parked entry' );
	const pv = G.sync.planes.remote.get( hid + ':parked' ), pvVis = pv.visual;
	await run( both, 0.3 );
	ok( pv.af === 'kestrel' && pv.liv === 1 && pv.visual.af === 'kestrel' && pv.visual.pose && Math.hypot( pv.visual.pose.x - 300, pv.visual.pose.z - 200 ) < 0.1, 'the Kestrel on the pad, for everybody' );
	const out0 = H.sync.planes.stats.out;
	await run( both, 1.5 );
	ok( H.sync.planes.stats.out - out0 === 0, 'a parked plane that does not move is not sent again' );
	ok( G.sync.wrecks.remote.size === 0, 'the recovered wreck is gone' );

	// ================================================================ the stronghold
	const HS = H.s, GS = G.s;
	const fortG = () => G.app.net.link.room.state.fort;
	ok( await until( both, () => fortG().seq > 0 && GS.batteries.list.length === 2, 3, 'fort' ), 'the host\'s stronghold is in the room\'s state' );
	// ---- a guest's attack rings the host's bell
	ok( HS.alarm.state === 'calm', 'all calm on Blackwater' );
	GS._hostileAct( 'cannon' );
	ok( await until( both, () => HS.alarm.state === 'alarm' && GS.alarm.state === 'alarm', 3, 'bell' ), 'a guest\'s attack rings the host\'s bell, and the guest hears it' );
	ok( G.events.some( ( e ) => e.k === 'strongholdAlarm' && e.state === 'alarm' ) && H.events.some( ( e ) => e.k === 'strongholdAlarm' && e.state === 'alarm' ), 'strongholdAlarm on both machines' );
	// ---- the host's batteries fire at the guest's boat; the guest's never fire
	const ch = HS.batteries.byId( 'channel' ), spot = seaSpot( ch );
	ok( !! spot, 'a firing spot in front of the channel battery' );
	G.app.boatCtl.position.set( spot.x, 0, spot.z );
	G.app.player.position.set( spot.x, 1, spot.z );
	G.app.player.mode = 'boat';
	H.app.boatCtl.position.set( 0, 0, - 600 );
	const salvos0 = HS.batteries.stats.salvos, gShots0 = G.sync.naval.stats.shotsIn;
	ok( await until( both, () => HS.batteries.stats.salvos > salvos0 && G.sync.naval.stats.shotsIn > gShots0, 6, 'battery fire' ), `the host's battery fires at the guest's boat and the balls fly on the guest's screen (${ G.sync.naval.stats.shotsIn - gShots0 } balls)` );
	ok( GS.batteries.stats.salvos === 0, 'the guest\'s own batteries never fire' );
	// ---- the moored ships: the host spawns them for the guest near the cove; with the bell rung they cast off
	const bw = ( c, puppet ) => c.naval.ships.filter( ( sh ) => /^blackwater-/.test( sh.id ) && !! sh.puppet === puppet );
	ok( await until( both, () => bw( H, false ).length === 3 && bw( G, true ).length === 3, 6, 'moored ships' ), 'the host spawns the three moored ships for the guest near the cove; she sees them as the host\'s puppets' );
	ok( bw( G, false ).length === 0, 'the guest spawns none of her own' );
	ok( await until( both, () => fortG().castOff > 0 && GS.ships.some( ( sl ) => sl.castOff ), 4, 'cast off' ), `the bell rung: the ships cast off, in the room's state (bits ${ fortG().castOff })` );
	// ---- a battery silenced on the host is silenced on the guest
	const plat = ch.platform;
	HS.damageStructure( plat, 1e7, 'player' );
	ok( HS.batteries.silenced( 'channel' ) && H.d.byId.get( plat ).state !== 'intact', 'the host breaks the channel battery\'s platform (a destruction prop): silenced' );
	ok( await until( both, () => GS.batteries.silenced( 'channel' ) && fortG().batteries.get( 'channel' )?.platform, 3, 'silenced' ), 'the guest\'s channel battery is silenced too (the room\'s state)' );
	ok( G.events.some( ( e ) => e.k === 'batterySilenced' && e.id === 'channel' ), 'batterySilenced on the guest' );
	const salvos1 = HS.batteries.stats.salvos;
	await run( both, 2 );
	ok( HS.batteries.stats.salvos === salvos1, 'and it fires no more' );
	// ---- the guards: one beaten on the guest comes off the host's watch
	while ( HS.guardsLeft === null || HS.guardsLeft > 3 ) HS.defeatGuard(); // (the host's watch beaten down to three)
	ok( await until( both, () => GS.guardsLeft === 3 && HS.guardsLeft === 3, 3, 'guards 3' ), 'the guest mirrors the host\'s watch (3 guards)' );
	GS.defeatGuard();
	ok( await until( both, () => HS.guardsLeft === 2 && fortG().guards === 2 && GS.guardsLeft === 2, 3, 'guard down' ), 'a guard beaten on the guest: two left on the host\'s watch, and in the room' );
	// ---- the claim, once
	HS.damageStructure( HS.batteries.byId( 'seaward' ).platform, 1e7, 'player' );
	for ( const sl of HS.ships ) sl.down = true;
	HS.guardsLeft = 0;
	ok( await until( both, () => fortG().open && GS.claimable().ok, 4, 'open' ), `undefended: both batteries out, the ships down, no guards (the guest agrees: ${ JSON.stringify( GS.claimable() ) })` );
	const m0 = { H: H.state.money, G: G.state.money };
	const rh = HS.claim(), rg = GS.claim();
	ok( rh && rh.pending && rg && rg.pending, 'both press E at the flagstaff at once: the claims go to the server' );
	ok( await until( both, () => HS.holder === 'player' && GS.holder === 'player', 4, 'claimed' ), 'Blackwater changes hands on both machines' );
	await run( both, 0.5 );
	const looted = [ H, G ].filter( ( c ) => c.events.some( ( e ) => e.k === 'strongholdClaimed' && e.by === 'player' ) );
	const paid = [ H, G ].filter( ( c ) => c.state.money > m0[ c.name === 'Hana' ? 'H' : 'G' ] );
	ok( looted.length === 1 && paid.length === 1 && looted[ 0 ] === paid[ 0 ], `the claim applies once: ${ looted.map( ( c ) => c.name ) } took the loot ($${ paid.map( ( c ) => c.state.money - m0[ c.name === 'Hana' ? 'H' : 'G' ] ) })` );
	const winner = looted[ 0 ], loser = winner === H ? G : H;
	ok( fortG().by === winner.app.net.id && loser.toasts.some( ( t ) => /claimed Blackwater first|another crew has taken/i.test( t ) ), `the room names the claimant; the other is told (${ loser.toasts.filter( ( t ) => /Blackwater/.test( t ) ).slice( - 1 ) })` );
	ok( await until( both, () => fortG().claimedAt >= 0 && Math.abs( GS.claimedAt - HS.claimedAt ) < 0.01, 3, 'claimedAt' ), 'the host\'s clock dates the claim for everybody' );
	// ---- the brotherhood retakes it on the host's clock
	HS._hours += HS.R.restock + 0.1;
	GS._hours = - 1e6; // (the guest's own clock must not matter)
	ok( await until( both, () => HS.holder === 'pirates' && GS.holder === 'pirates' && fortG().holder === 'pirates', 4, 'retaken' ), 'the restock on the host: retaken on both machines' );
	ok( G.events.some( ( e ) => e.k === 'strongholdRetaken' ) && H.events.some( ( e ) => e.k === 'strongholdRetaken' ), 'strongholdRetaken on both' );

	// ================================================================ the town
	// ---- a Tidemark prop broken on the guest breaks on the host and back
	const tm = G.d.props.filter( ( p ) => p.port === 'tidemark' && p.state === 'intact' );
	const p1 = tm[ 0 ].id, p2 = tm[ 1 ].id;
	G.d.breakProp( p1, { by: 'player' } );
	ok( await until( both, () => H.d.byId.get( p1 ).state !== 'intact', 3, 'p1 on host' ), `a Tidemark prop broken on the guest breaks on the host (${ p1 })` );
	const ev1 = H.events.find( ( e ) => e.k === 'remoteWorldEvent' && e.kind === 'propDestroyed' && e.data.id === p1 );
	ok( ev1 && ev1.data.port === 'tidemark' && ev1.from === gid, 'its world event carries the port' );
	H.d.breakProp( p2, { by: 'player' } );
	ok( await until( both, () => G.d.byId.get( p2 ).state !== 'intact', 3, 'p2 on guest' ), 'one broken on the host breaks on the guest' );
	// ---- the host's respawn comes back on the guest
	H.d.respawn( p1 );
	H.d.respawn( p2 );
	ok( await until( both, () => G.d.byId.get( p1 ).state === 'intact' && G.d.byId.get( p2 ).state === 'intact', 3, 'respawn' ), 'the host\'s town respawn: both props stand again on the guest' );
	const rr = G.events.filter( ( e ) => e.k === 'remoteWorldEvent' && e.kind === 'propRespawned' && [ p1, p2 ].includes( e.data.id ) );
	ok( rr.length === 2 && rr.every( ( e ) => e.data.port === 'tidemark' ) && H.sync.town.stats.batchesOut === 1, `in one batch, one remote propRespawned { id, port } per prop (${ rr.length })` );
	// ---- the raid runs on the host
	const asked = G.sync.askHost( 'raid', { port: 'tidemark', quest: 'holdTheLine' } );
	ok( asked && await until( both, () => H.events.some( ( e ) => e.k === 'hostRequest' && e.kind === 'raid' && e.from === gid && ! e.local ), 3, 'ask' ), 'a guest\'s askHost( \'raid\' ) reaches the host\'s features' );
	ok( ! G.events.some( ( e ) => e.k === 'hostRequest' ) && ! G.sync.hostOnly() && H.sync.hostOnly(), 'not the guest\'s own (hostOnly: the host yes, the guest no)' );
	H.sync.askHost( 'raid', { port: 'tidemark' } );
	ok( H.events.some( ( e ) => e.k === 'hostRequest' && e.local ), 'the host\'s own request runs at once' );

	// ================================================================ reconnect
	HS.damageStructure( HS.batteries.byId( 'channel' ).platform, 1e7, 'player' ); // (rebuilt by the retake: silence it again)
	ok( await until( both, () => GS.batteries.silenced( 'channel' ), 3, 'silenced again' ), 'the channel battery is silenced again' );
	await run( both, 1.1 );
	G.app.net.link.drop();
	ok( await until( both, () => ! G.app.net.online, 2, 'G dropped' ), 'the guest drops' );
	ok( G.sync.fort.role === 'guest', 'meanwhile the guest keeps mirroring (its batteries stay quiet)' );
	ok( await until( both, () => G.app.net.online && G.app.net.id === gid, 8, 'G back' ), 'the guest reconnects to the same seat' );
	await run( both, 1 );
	ok( G.sync.planes.remote.has( hid + ':parked' ) && GS.batteries.silenced( 'channel' ) && GS.holder === 'pirates' && fortG().seq > 0, 'after the reconnect: the parked Kestrel, the silenced battery, the holder, as the room has them' );
	ok( GS.batteries.stats.salvos === 0, 'and the guest\'s batteries never fired' );

	// ---- the owner leaves: her planes go
	H.app.disconnect();
	ok( await until( [ G ], () => ! G.sync.planes.remote.size && pvVis.disposed, 6, 'gone' ), 'Hana leaves: her parked plane goes with her' );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of [ H, G ] ) {

	try { c.app.disconnect(); } catch ( e ) { /* closed */ }
	try { c.features.dispose && c.features.dispose(); } catch ( e ) { /* closed */ }

}

await srv.close();
clearTimeout( watchdog );
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\nfeature-netsync-w13: all checks passed' );
process.exit( 0 );
