// Plain-node test of wave 22A, cars for everybody (src/features/cars + src/features/netsync/CarLink.js + server/rooms.mjs): a real
// server in-process and three browser-side stacks (NetClient over @colyseus/sdk + RemotePlayers + Features + the real Cars
// on Meridian's own plan + NetSync), no GPU:
//   roles      the room's host runs the traffic for every player in the city; the guests run none and draw the host's cars
//              (the puppets sit where the host's cars are: lane codes, lights, eased corrections)
//   cars       a player's car (pose, wheels, lamps, damage stage, horn, siren) reaches the others interpolated; the driver's
//              avatar is hidden there; the car goes at once when he gets out
//   locked     another player's car (driven and stopped, or parked: oc) answers its door locked: taking it is refused
//   taking     a guest takes one of the host's stopped traffic cars: it is his and the host's copy goes; a parked spot taken on
//              one client empties everywhere (batched carTaken)
//   law        the host's police chase the wanted guest only (his cw), never an innocent one; no guest runs police of its own
//   bandwidth  bytes / s per client with two players driving and the host's traffic, against wave 20E's budget
//   server     sanitizeCars refuses malformed snapshots; a guest's 'cars' message is ignored
//   node test/feature-netsync-w22.mjs
import './headless.mjs';
import { startServer } from '../server/index.mjs';
import { sanitizeCars, CARS_RATE } from '../server/rooms.mjs';
import { Features } from '../src/features/Features.js';
import { NetClient } from '../src/net/NetClient.js';
import { RemotePlayers } from '../src/net/RemotePlayers.js';
import { NetSync } from '../src/features/netsync/NetSync.js';
import * as carsModule from '../src/features/cars/index.js';
import { laneCode, laneOf, kindCode, kindOf, NET } from '../src/features/cars/CarNet.js';
import { cityPlan, MERIDIAN } from '../src/world/islands/meridian/CityPlan.js';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg, extra = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, extra ); } else { passes ++; console.log( 'ok  ', msg, extra ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 240 s' ); process.exit( 1 ); }, 240000 );
// bytes / s in + out of the busiest client, wave 20E's bench (test/feature-netsync-w20.mjs BUDGET): the room's budget
const BUDGET = 7243;
const PLAN = cityPlan();
const C = MERIDIAN.center;

// RemotePlayers without avatars, name tags or boat models (all GPU / DOM): the interpolation is the real one
class LiteRemote extends RemotePlayers {

	constructor() { super( { scene: { add() {}, remove() {} }, camera: {} } ); }

	addPeer( { id, name } ) {

		if ( ! id || id === this.localId ) return null;
		let p = this.peers.get( id );
		if ( p ) return p;
		p = {
			id, name: name || '?', character: 'pepe', boatId: null, ownedBoat: null, avatar: null, boat: null, boatReady: false, snaps: [], tag: null,
			pose: { position: new Vector3(), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null },
			boatPos: new Vector3(), boatQuat: new Quaternion(), frame: new Quaternion(), hasPose: false, lastAt: 0,
		};
		this.peers.set( id, p );
		return p;

	}

	_ensureBoat() {}
	setMoored() {}

}

function meter( c ) {

	const ws = c.app.net && c.app.net.link && c.app.net.link.room && c.app.net.link.room.connection && c.app.net.link.room.connection.transport && c.app.net.link.room.connection.transport.ws;
	if ( ! ws || ws.__metered ) return;
	ws.__metered = true;
	const send = ws.send.bind( ws );
	ws.send = ( data ) => { c.bytes.out += data && ( data.byteLength ?? data.length ) || 0; return send( data ); };
	ws.addEventListener( 'message', ( e ) => { c.bytes.in += e.data && ( e.data.byteLength ?? e.data.length ) || 0; } );

}

function makeClient( name, { pos, seed = 1 } ) {

	const toasts = [];
	const state = { name, money: 90000, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; }, earn( n ) { this.money += n; } };
	const drv = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
	const player = {
		mode: 'walk', position: new Vector3( pos[ 0 ], 0, pos[ 1 ] ), yaw: 0, vehicle: null,
		enterVehicle( v ) { this.vehicle = v; this.mode = 'plane'; return true; },
		exitVehicle( x, y, z, yaw, m ) { this.vehicle = null; this.mode = m; this.position.set( x, y, z ); },
	};
	const app = {
		mode: 'multiplayer', settings: { timeOfDay: 12, timeSpeed: 0 }, colliders: new Colliders(), scene: null, audio: null, player,
		input: { down: () => false, hit: () => false }, game: { state, toast( t ) { toasts.push( t ); } }, net: null, remotePlayers: null,
		connect( url ) {

			if ( this.net ) this.net.disconnect();
			if ( ! this.remotePlayers ) this.remotePlayers = new LiteRemote();
			const rp = this.remotePlayers;
			this.net = new NetClient( { url, name, character: 'pepe', boat: null, onPeerJoin: ( p ) => rp.addPeer( p ), onPeerLeave: ( id ) => rp.removePeer( id ), onStates: ( l, at ) => rp.applyStates( l, at ) } );
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
			const s = { p: [ p.position.x, p.position.y, p.position.z ], yaw: p.yaw, mode: p.mode === 'plane' ? 'plane' : 'walk', speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'pepe', boat: null };
			return this.features.get( 'netsync' ).decorateState( s );

		},
	};
	const features = new Features( app );
	app.features = features;
	const events = [];
	for ( const k of [ 'carEntered', 'carRefused', 'carJacked', 'remoteWorldEvent' ] ) features.on( k, ( e ) => events.push( { k, ...e } ) );
	const cars = features.add( 'cars', { install: ( a, f ) => carsModule.install( a, f, {
		render: false, seed, plan: PLAN, terrain: { heightAt: () => 0 }, roadHeight: () => 0, flatRoads: true, input: () => drv,
	} ) } );
	const sync = features.add( 'netsync', { install: ( a, f ) => new NetSync( a, f, {} ) } );
	app.netsync = sync;
	const c = { name, app, features, cars, sync, events, toasts, state, drv, player, bytes: { in: 0, out: 0 } };
	c.frame = ( dt = 0.05 ) => {

		if ( app.remotePlayers ) app.remotePlayers.update( dt );
		features.update( dt );
		// (Player.updatePlane: the body rides in the car's seat)
		if ( cars.drive ) player.position.set( cars.drive.x, cars.drive.y + 0.4, cars.drive.z );
		if ( app.net && app.net.online ) {

			meter( c );
			app.net.send( app.netState() );

		}

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

async function connectAll( base, list ) {

	for ( const c of list ) {

		c.app.connect( `${ base }/island` );
		await until( list, () => c.app.net && c.app.net.online, 5, c.name + ' online' );

	}

	const ids = list.map( ( c ) => c.app.net.id );
	return until( list, () => list.every( ( c ) => ids.every( ( id ) => id === c.app.net.id || c.app.remotePlayers.peers.get( id )?.hasPose ) ), 6, 'poses' );

}

const close = async ( list ) => {

	for ( const c of list ) try { c.app.disconnect(); } catch ( e ) { /* closed */ }
	await sleep( 100 );

};

// a parked car near a point (this client's own streamed ones)
const parkedNear = ( c, x, z ) => {

	let best = null, bd = Infinity;
	for ( const r of c.cars.records ) if ( r.state === 'parked' ) { const d = Math.hypot( r.x - x, r.z - z ); if ( d < bd ) { bd = d; best = r; } }
	return best;

};

// ================================================================================================ pure parts
section( 'codes and the server sanitizer' );
{

	const W = makeClient( 'Solo', { pos: [ C.x, C.z ] } );
	const g = W.cars.graph;
	let round = 0, n = 0;
	for ( const e of [ ...g.edges.values() ].slice( 0, 60 ) ) for ( const dir of [ 1, - 1 ] ) for ( let k = 0; k < g.lanes( e.id, dir ); k ++ ) {

		const L = g.lane( e.id, dir, k );
		n ++;
		if ( laneOf( g, laneCode( g, L ) ) === L ) round ++;

	}

	ok( n > 50 && round === n, 'lane codes round-trip (edge, direction, lane)', `(${ round } / ${ n })` );
	const kc = kindCode( { kind: 'taxi', color: 0xf2b11c, stage: 2 } ), back = kindOf( kc );
	ok( back.kind === 'taxi' && back.stage === 2 && back.color === 0xf2b11c, 'kind, paint and damage stage in one small int', `(${ kc })` );
	ok( sanitizeCars( { tm: 3, tr: [ [ 1, 20, 33, - 1, 120, 80 ] ], fr: [ [ 'c4', 20, - 27000, - 3000, 120, 50, 3 ] ] } ) !== null, 'the server takes a well-formed snapshot' );
	ok( sanitizeCars( { tr: [ [ 1, 20, 33, - 1, 120 ] ] } ) === null && sanitizeCars( { tr: [ [ 1, 20, 33, - 1, 120, 1e9 ] ] } ) === null
		&& sanitizeCars( { fr: [ [ '<script>', 20, 0, 0, 0, 0, 0 ] ] } ) === null && sanitizeCars( { tr: new Array( 65 ).fill( [ 1, 1, 1, 1, 1, 1 ] ) } ) === null,
	'and refuses a short entry, a wild number, a bad id, too many cars' );
	ok( CARS_RATE.n >= 1 / NET.chase, 'the server rate covers the chase cadence', `(${ CARS_RATE.n } / s)` );
	W.cars.dispose();

}

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, reconnectSeconds: 8 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;

// three players in the middle of Meridian, 60 m apart
const spot = PLAN.parking.filter( ( p ) => p.kind === 'street' ).sort( ( a, b ) => Math.hypot( a.x - C.x, a.z - C.z ) - Math.hypot( b.x - C.x, b.z - C.z ) )[ 0 ];
const H = makeClient( 'Hana', { pos: [ spot.x + 40, spot.z ], seed: 11 } );
const G = makeClient( 'Gus', { pos: [ spot.x + 1.5, spot.z ], seed: 22 } );
const K = makeClient( 'Kit', { pos: [ spot.x - 40, spot.z + 30 ], seed: 33 } );
const all = [ H, G, K ];

try {

	await connectAll( base, all );
	const idOf = ( c ) => c.app.net.id;

	section( 'roles: the host runs the traffic, the guests draw it' );
	await until( all, () => G.cars.mirror.records.size > 5 && K.cars.mirror.records.size > 5, 8, 'puppets' );
	ok( H.sync.cars.role === 'host' && G.sync.cars.role === 'puppet' && K.sync.cars.role === 'puppet', 'the first player is the host, the others puppets' );
	ok( H.cars.traffic.cars.length > 10, 'the host runs the traffic', `(${ H.cars.traffic.cars.length } cars)` );
	ok( G.cars.traffic.cars.length === 0 && K.cars.traffic.cars.length === 0, 'the guests run none of their own' );
	ok( G.cars.mirror.records.size > 5, 'a guest draws the host\'s cars near him', `(${ G.cars.mirror.records.size } puppets)` );
	await run( all, 1.5 );
	const errs = [];
	for ( const [ key, r ] of G.cars.mirror.records ) {

		if ( ! key.startsWith( 't:' ) ) continue;
		const h = H.cars.traffic.cars.find( ( c ) => c.id === 'c' + key.slice( 2 ) );
		if ( h ) errs.push( Math.hypot( h.x - r.x, h.z - r.z ) );

	}

	errs.sort( ( a, b ) => a - b );
	const med = errs[ errs.length >> 1 ] || 0, p90 = errs[ Math.floor( errs.length * 0.9 ) ] || 0;
	ok( errs.length > 5 && med < 2 && p90 < 6, 'the puppets sit where the host\'s cars are (along the lanes, at its lights)', `(median ${ med.toFixed( 2 ) } m, p90 ${ p90.toFixed( 2 ) } m, ${ errs.length } cars)` );

	section( 'a player\'s car for everybody' );
	const pk = parkedNear( G, G.player.position.x, G.player.position.z );
	const r1 = pk ? G.cars.enter( pk ) : { ok: false };
	ok( r1.ok && G.cars.driving, 'Gus takes a parked car', `(${ pk && pk.kind })` );
	const taken = pk ? Number( pk.id.slice( 2 ) ) : - 1;
	await until( all, () => H.cars.remote.has( idOf( G ) ) && K.cars.remote.has( idOf( G ) ), 4, 'remote car' );
	ok( H.cars.parked.taken.has( taken ) && K.cars.parked.taken.has( taken ) && ! [ ...H.cars.parked.live.keys() ].includes( taken ), 'its parking spot empties on every client' );
	G.drv.throttle = 1;
	await run( all, 2.5 );
	const gc = G.cars.drive, hr = H.cars.remote.get( idOf( G ) );
	ok( !! hr && hr.kind === gc.kind && hr.color === gc.color, 'the host draws Gus\'s car: its kind and paint' );
	const gap = hr ? Math.hypot( hr.x - gc.x, hr.z - gc.z ) : Infinity;
	ok( gap < Math.abs( gc.speed ) * 0.45 + 1.5, 'where it is (interpolated ~120 ms behind)', `(${ gap.toFixed( 2 ) } m at ${ gc.speed.toFixed( 1 ) } m/s)` );
	ok( hr && hr.speed > 3 && hr.spin > 1, 'its wheels turn', `(spin ${ hr && hr.spin.toFixed( 1 ) })` );
	const hp = H.app.remotePlayers.peers.get( idOf( G ) );
	ok( hp && hp.inCar === true, 'and the driver is not drawn (peer.inCar)' );
	G.drv.throttle = 0; G.drv.brake = 1;
	G.cars.damage( gc, gc.maxHp * 0.4, 'test' );
	G.cars.lightsOn = true;
	G.drv.horn = true;
	const honks = H.cars.audio.state.honks;
	await run( all, 1.2 );
	G.drv.horn = false;
	ok( hr.stage === gc.stage && hr.stage >= 1, 'its damage stage', `(${ hr.stage })` );
	ok( hr.lights === true, 'its lamps' );
	ok( H.cars.audio.state.honks > honks, 'its horn sounds at the host' );

	section( 'locked: another player\'s car' );
	// (stopped and mended: the city's traffic may have hit it meanwhile)
	G.drv.brake = 0; G.drv.handbrake = true; // (the brake held at a standstill reverses)
	gc.body.vx = gc.body.vz = 0; gc.hp = gc.maxHp; gc.stage = 0; G.cars._stopFx( gc );
	await run( all, 1.0 );
	H.player.position.set( gc.x + Math.cos( gc.yaw ) * 2.2, 0, gc.z - Math.sin( gc.yaw ) * 2.2 );
	H.cars._doorT = - 1;
	const door = H.cars._doorCandidate();
	ok( door && door.rec.state === 'remote', 'Hana at the door of Gus\'s stopped car finds it', door ? `("${ H.cars._doorPrompt( door.rec ) }")` : '' );
	const refused = door ? H.cars.enter( door.rec ) : { ok: true };
	ok( refused.ok === false && refused.reason === 'owned' && ! H.cars.driving, 'taking it is refused' );
	// a car Kit owns, parked: everybody sees it, nobody else takes it
	K.state.money = 90000;
	const bought = K.cars.buy( 'sports' );
	await until( all, () => H.cars.remoteOwned.has( idOf( K ) ) && G.cars.remoteOwned.has( idOf( K ) ), 4, 'owned car' );
	const own = H.cars.remoteOwned.get( idOf( K ) )?.[ 0 ];
	const kr = K.cars.records.find( ( r ) => r.id === bought.id );
	ok( own && own.kind === 'sports' && kr && Math.hypot( own.x - kr.x, own.z - kr.z ) < 0.2, 'Kit\'s new car stands at the kerb for the others too' );
	ok( own && H.cars.enter( own ).reason === 'owned', 'and it is locked to Hana' );

	section( 'taking one of the host\'s cars' );
	// Gus out of his car, beside a stopped traffic car of the host's
	G.drv.brake = 1;
	G.cars.exit( { force: true } );
	await run( all, 0.5 );
	let victim = null;
	await until( all, () => {

		for ( const r of G.cars.mirror.records.values() ) if ( r.netKey.startsWith( 't:' ) && r.speed < 0.5 && Math.hypot( r.x - C.x, r.z - C.z ) < 700 ) { victim = r; return true; }
		return false;

	}, 10, 'a stopped puppet' );
	ok( !! victim, 'a host\'s car waits at a light', victim ? `(${ victim.netKey })` : '' );
	if ( victim ) {

		const hid = 'c' + victim.netKey.slice( 2 );
		G.player.position.set( victim.x, 0, victim.z );
		const res = G.cars.enter( victim );
		ok( res.ok && res.how === 'jack' && G.cars.driving && G.cars.drive.kind === victim.kind, 'Gus takes it (its driver thrown out: wanted)' );
		await until( all, () => ! H.cars.traffic.cars.some( ( c ) => c.id === hid ), 3, 'host drops it' );
		ok( ! H.cars.traffic.cars.some( ( c ) => c.id === hid ), 'the host\'s copy leaves its traffic' );
		await run( all, 1 );
		ok( ! G.cars.mirror.records.has( victim.netKey ) && ! K.cars.mirror.records.has( victim.netKey ), 'no puppet of it is left anywhere' );
		ok( H.cars.remote.get( idOf( G ) )?.kind === victim.kind, 'everybody sees Gus in it' );

	}

	section( 'the law: the host\'s police chase the wanted guest only' );
	G.cars._addHeat( 55, 'test' );
	ok( G.cars.policeLevel() >= 3, 'Gus is wanted', `(level ${ G.cars.policeLevel() })` );
	await until( all, () => H.cars.records.some( ( r ) => r.state === 'pursuit' ), 6, 'pursuit' );
	await run( all, 2 );
	const pursuers = H.cars.records.filter( ( r ) => r.state === 'pursuit' );
	ok( pursuers.length >= 1, 'the host sends police cars', `(${ pursuers.length })` );
	ok( pursuers.length && pursuers.every( ( r ) => r.pursue && r.pursue.target === idOf( G ) ), 'all after Gus (not Kit, not the host)' );
	ok( G.cars.records.every( ( r ) => r.state !== 'pursuit' ) && K.cars.records.every( ( r ) => r.state !== 'pursuit' ), 'no guest runs police of its own' );
	ok( [ ...G.cars.mirror.records.values() ].some( ( r ) => r.pursuit && r.kind === 'police' ), 'Gus sees them coming (beacons, siren)' );
	ok( H.cars.policeLevel() === 0 && K.cars.policeLevel() === 0, 'the host and Kit stay innocent' );
	G.cars.bust();
	await run( all, 8 );
	ok( H.cars.records.every( ( r ) => r.state !== 'pursuit' ), 'once he is busted the police go back to patrol' );

	section( 'siren of a police car a player drives' );
	K.cars.exit( { force: true } );
	const pc = K.cars._record( 'police', { x: K.player.position.x + 3, z: K.player.position.z, yaw: 0, state: 'idle' } );
	K.cars.records.push( pc );
	K.cars.enter( pc );
	K.cars.toggleSiren();
	await until( all, () => H.cars.remote.get( idOf( K ) )?.siren === true, 3, 'siren' );
	ok( H.cars.remote.get( idOf( K ) )?.siren === true && H.cars.beacons(), 'Kit\'s siren and beacons reach the host' );
	K.cars.exit( { force: true } );
	await run( all, 0.6 );
	ok( ! H.cars.remote.has( idOf( K ) ), 'out of the car: it goes at once (no frozen car)' );
	ok( ! H.app.remotePlayers.peers.get( idOf( K ) ).inCar, 'and Kit is drawn on foot again' );

	section( 'a guest\'s cars message is ignored' );
	const before = K.sync.cars.stats.in;
	G.app.net.sendMsg( { t: 'cars', tm: 1, tr: [], fr: [ [ 'c999', 20, - 27000, - 3000, 0, 0, 2 ] ] } );
	await run( all, 0.6 );
	ok( ! K.cars.mirror.records.has( 'f:c999' ), 'only the host\'s snapshots are relayed', `(${ K.sync.cars.stats.in - before } host snapshots meanwhile)` );

	section( 'bandwidth: three players in Meridian, two driving, the host\'s traffic' );
	G.cars.heat = 0; G.cars.level = 0;
	if ( ! G.cars.driving ) { const p2 = parkedNear( G, G.player.position.x, G.player.position.z ); if ( p2 ) G.cars.enter( p2 ); }
	const p3 = parkedNear( K, K.player.position.x, K.player.position.z );
	if ( p3 ) K.cars.enter( p3 );
	G.drv.brake = 0; G.drv.handbrake = false; G.drv.throttle = 0.6; G.drv.steer = 0.35;
	K.drv.throttle = 0.5; K.drv.steer = - 0.3; K.drv.brake = 0;
	await run( all, 2 );
	for ( const c of all ) c.bytes.in = c.bytes.out = 0;
	const snaps0 = H.sync.cars.stats.out, bytes0 = H.sync.cars.stats.bytesOut;
	const t0 = Date.now();
	await run( all, 6 );
	const secs = ( Date.now() - t0 ) / 1000;
	const rows = all.map( ( c ) => ( { name: c.name, host: c.sync.isHost, in: Math.round( c.bytes.in / secs ), out: Math.round( c.bytes.out / secs ), driving: c.cars.driving, wanted: c.cars.policeLevel(), puppets: c.cars.mirror.records.size } ) );
	console.table( rows );
	const worst = Math.max( ...rows.map( ( r ) => r.in + r.out ) );
	const sn = H.sync.cars.stats.out - snaps0;
	ok( worst <= BUDGET, 'the busiest client stays within wave 20E\'s budget', `(${ worst } B/s <= ${ BUDGET }; ${ ( sn / secs ).toFixed( 1 ) } snapshots/s, ~${ Math.round( ( H.sync.cars.stats.bytesOut - bytes0 ) / Math.max( 1, sn ) ) } JSON chars each, ${ G.cars.mirror.records.size } puppets at Gus)` );
	ok( G.cars.driving && K.cars.driving && H.cars.remote.size === 2, 'both drivers are drawn at the host' );
	// and in a chase: the loose cars at 4 Hz between the full snapshots
	G.cars._addHeat( 55, 'test' );
	await until( all, () => H.cars.chasing(), 6, 'chase' );
	await run( all, 1 );
	for ( const c of all ) c.bytes.in = c.bytes.out = 0;
	const t1 = Date.now();
	await run( all, 5 );
	const secs2 = ( Date.now() - t1 ) / 1000;
	const rows2 = all.map( ( c ) => ( { name: c.name, in: Math.round( c.bytes.in / secs2 ), out: Math.round( c.bytes.out / secs2 ), wanted: c.cars.policeLevel(), puppets: c.cars.mirror.records.size } ) );
	console.table( rows2 );
	const worst2 = Math.max( ...rows2.map( ( r ) => r.in + r.out ) );
	ok( H.cars.chasing() && worst2 <= BUDGET, 'and in a police chase', `(${ worst2 } B/s, ${ H.cars.records.filter( ( r ) => r.state === 'pursuit' ).length } pursuers)` );

} finally {

	await close( all );
	clearTimeout( watchdog );
	await srv.close?.();

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
