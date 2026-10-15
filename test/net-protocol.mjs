// Plain-node test of the multiplayer server and its protocol (no GPU): starts server/index.mjs (Colyseus) on a
// free port, connects @colyseus/sdk clients through src/net/ColyseusLink (server/testkit.mjs) and checks welcome / join /
// states fan-out / chat / ping / clock / leave / health, crews, rides, the host's ships, fx / hits and room limits, plus
// sanitizeState on bad input. One server at a time (Colyseus' matchmaker is per process). Exits 0 on success, 1 on failure.
//
//   node test/net-protocol.mjs

import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import {
	sanitizeState, sanitizeChat, sanitizeHello, PROTOCOL_VERSION, MAX_CHAT, decode, encode, stateChanged, clockTimeOfDay,
	sanitizeCrewCode, isCrewRoom, makeCrewCode, crewUrl, sanitizeWorld, sanitizeFx, sanitizeHit, REFUSAL,
} from '../src/net/Protocol.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const watchdog = setTimeout( () => {

	console.log( 'FAIL timeout: the test did not finish in 40 s' );
	process.exit( 1 );

}, 40000 );

const client = wireClient;

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

// ---- sanitizeState / sanitizeChat / sanitizeHello

const good = { p: [ 1.23456, 2, - 3.999 ], yaw: 1.2345, mode: 'walk', speed: 1.5, vy: 0, grounded: true, diving: false, action: null, character: 'pepe', boat: null };
const s = sanitizeState( good );
ok( s && s.p[ 0 ] === 1.23 && s.p[ 2 ] === - 4 && s.yaw === 1.23, 'sanitizeState rounds position to cm and yaw to 2 decimals' );
ok( sanitizeState( { ...good, p: [ NaN, 0, 0 ] } ) === null, 'sanitizeState rejects NaN position' );
ok( sanitizeState( { ...good, yaw: Infinity } ) === null, 'sanitizeState rejects infinite yaw' );
ok( sanitizeState( { ...good, character: 'shrek' } ) === null, 'sanitizeState rejects an unknown character' );
ok( sanitizeState( { ...good, mode: 'fly' } ) === null, 'sanitizeState rejects an unknown mode' );
ok( sanitizeState( { ...good, action: 'x'.repeat( 10000 ) } ) === null, 'sanitizeState rejects a 10 kB action string' );
ok( sanitizeState( { ...good, name: 'x'.repeat( 10000 ) } ) === null, 'sanitizeState rejects a 10 kB name' );
ok( sanitizeState( { ...good, boat: { id: 'yacht', p: [ 0, 0, 0 ], q: [ 0, 0, 0, 1 ] } } ) === null, 'sanitizeState rejects an unknown boat' );
ok( sanitizeState( { ...good, boat: { id: 'skiff', p: [ 0, 0, 0 ], q: [ 0, 0, 0, NaN ] } } ) === null, 'sanitizeState rejects a NaN boat quaternion' );
const sb = sanitizeState( { ...good, mode: 'boat', speed: 1e9, boat: { id: 'skiff', p: [ 5, 0.1, 5 ], q: [ 0, 2, 0, 0 ], throttle: 7, steer: - 9, rpm: 1200, driven: true } } );
ok( sb && sb.speed === 200 && sb.boat.throttle === 1 && sb.boat.steer === - 1 && sb.boat.q[ 1 ] === 1 && sb.boat.driven === true, 'sanitizeState clamps numbers and normalizes the boat quaternion' );
ok( sanitizeState( 'nope' ) === null && sanitizeState( null ) === null && sanitizeState( { p: 'abc' } ) === null, 'sanitizeState rejects non-objects and malformed shapes' );
ok( stateChanged( s, sanitizeState( good ) ) === false && stateChanged( s, sanitizeState( { ...good, p: [ 1.3, 2, - 4 ] } ) ) === true, 'stateChanged ignores sub-cm noise and sees a 7 cm move' );
ok( sanitizeChat( { text: 'hi\u0000 there\u001b[31m' } ) === 'hi there[31m', 'sanitizeChat strips control characters' );
ok( sanitizeChat( { text: 'y'.repeat( 10000 ) } ).length === MAX_CHAT, 'sanitizeChat truncates to MAX_CHAT' );
ok( sanitizeChat( { text: '   ' } ) === null && sanitizeChat( { text: 5 } ) === null, 'sanitizeChat rejects empty / non-string text' );
const h = sanitizeHello( { name: '  Capt. \u0007Sprat  ', character: 'nobody', boat: 'lobster' } );
ok( h.name === 'Capt. Sprat' && h.character === 'hyptile' && h.boat === 'lobster', 'sanitizeHello cleans the name and falls back on an unknown character' );
ok( decode( 'x'.repeat( 5000 ) ) === null && decode( '{"a":1}' ) === null && decode( '{"t":"ping"}' ).t === 'ping', 'decode rejects oversized / untagged frames' );
const c0 = { timeOfDay: 23.9, timeSpeed: 0.01, at: 1000 };
ok( Math.abs( clockTimeOfDay( c0, 1000 + 20000 ) - 0.1 ) < 1e-9, 'clockTimeOfDay wraps past midnight' );

// ---- live server

const srv = startServer( { port: 0, host: '127.0.0.1', clockEveryMs: 300, log: () => {} } );
const port = await srv.ready;
ok( port > 0, `server listening on a free port (${ port })` );
const url = `ws://127.0.0.1:${ port }/island`;

try {

	const a = client( url );
	await a.open;
	a.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', character: 'pepe', boat: null } );
	const wa = await a.next( 'welcome' );
	ok( typeof wa.id === 'string' && wa.id.length === 6, 'A gets a welcome with a short id' );
	ok( wa.you.name === 'Ann' && wa.you.character === 'pepe' && Array.isArray( wa.peers ) && wa.peers.length === 0, 'A welcome: you + empty peers' );
	ok( wa.clock && Math.abs( wa.clock.timeOfDay - 9.5 ) < 0.01 && wa.clock.timeSpeed === 0.01 && typeof wa.clock.at === 'number', 'A welcome carries the island clock (9.5 h, 0.01 h/s)' );
	ok( wa.room === 'island', 'default room is island' );

	// A sends a state before B joins, so B's welcome can carry it
	a.send( { t: 'state', p: [ 10, 0, 20 ], yaw: 0.5, mode: 'walk', speed: 1, vy: 0, grounded: true, diving: false, action: null, character: 'pepe', boat: null } );
	await sleep( 50 );

	const b = client( url );
	await b.open;
	b.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'Bob\u0000<x>' + 'z'.repeat( 50 ), character: 'doge', boat: 'skiff' } );
	const [ wb, ja ] = await Promise.all( [ b.next( 'welcome' ), a.next( 'join' ) ] );
	ok( wb.peers.length === 1 && wb.peers[ 0 ].id === wa.id && wb.peers[ 0 ].name === 'Ann' && wb.peers[ 0 ].state && wb.peers[ 0 ].state.p[ 0 ] === 10, 'B welcome lists A with her last state' );
	ok( wb.you.name.length === 24 && ! wb.you.name.includes( '\u0000' ), 'long names are trimmed to MAX_NAME and cleaned' );
	ok( ja.peer.id === wb.id && ja.peer.character === 'doge' && ja.peer.boat === 'skiff', 'A gets join for B' );

	// states fan-out: B moves, A sees it; B does not get its own state back
	b.send( { t: 'state', p: [ 1.001, 2, 3 ], yaw: 3.0, mode: 'boat', speed: 4, vy: 0, grounded: true, diving: false, action: 'cast', character: 'doge',
		boat: { id: 'skiff', p: [ 1, 0, 3 ], q: [ 0, 0.7071, 0, 0.7071 ], throttle: 0.5, steer: 0, rpm: 1200, driven: true } } );
	const st = await a.next( ( m ) => m.t === 'states' && m.list.some( ( x ) => x.id === wb.id ) );
	const sbx = st.list.find( ( x ) => x.id === wb.id );
	ok( typeof st.at === 'number' && sbx.p[ 0 ] === 1 && sbx.mode === 'boat' && sbx.action === 'cast' && sbx.boat.id === 'skiff' && sbx.boat.driven === true, 'A receives B state in a states fan-out' );
	await sleep( 250 );
	ok( b.drain( ( m ) => m.t === 'states' && m.list.some( ( x ) => x.id === wb.id ) ).length === 0, 'B never receives its own state' );
	// a junk state is ignored, not fatal
	b.send( { t: 'state', p: [ NaN, 0, 0 ], yaw: 0, mode: 'walk' } );
	b.send( 'not json' );
	b.send( { t: 'state', p: [ 7, 0, 7 ], yaw: 0, mode: 'swim', diving: true } );
	const st2 = await a.next( ( m ) => m.t === 'states' && m.list.some( ( x ) => x.id === wb.id && x.p[ 0 ] === 7 ) );
	ok( st2.list.find( ( x ) => x.id === wb.id ).diving === true, 'bad frames are dropped and the next good state still arrives' );
	// unchanged states are not re-sent
	await sleep( 250 );
	a.drain( ( m ) => m.t === 'states' );
	await sleep( 250 );
	ok( a.drain( ( m ) => m.t === 'states' ).length === 0, 'unchanged states are not repeated' );

	// chat
	a.send( { t: 'chat', text: 'ahoy\u0007 Bob' } );
	const [ ca, cb ] = await Promise.all( [ a.next( 'chat' ), b.next( 'chat' ) ] );
	ok( ca.text === 'ahoy Bob' && ca.name === 'Ann' && ca.id === wa.id && typeof ca.at === 'number', 'chat relays to the sender with name, id, at (control chars stripped)' );
	ok( cb.text === 'ahoy Bob' && cb.id === wa.id, 'chat relays to the peer' );
	await sleep( 1050 ); // the limiter window of the ahoy
	for ( let i = 0; i < 6; i ++ ) a.send( { t: 'chat', text: `spam ${ i }` } );
	await sleep( 300 );
	ok( b.drain( ( m ) => m.t === 'chat' ).length === 2, 'chat is rate limited to 2 per second' );
	a.send( { t: 'chat', text: 'w'.repeat( 10000 ) } );
	await sleep( 100 );
	ok( b.drain( ( m ) => m.t === 'chat' ).length === 0, 'a burst beyond the limit is still blocked within the same second' );

	// a second hello updates the profile and is broadcast as a join
	b.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'Bobby', character: 'bonk', boat: 'lobster' } );
	const rj = await a.next( ( m ) => m.t === 'join' && m.peer.id === wb.id );
	ok( rj.peer.name === 'Bobby' && rj.peer.character === 'bonk' && rj.peer.boat === 'lobster', 'a re-hello reaches the peers as a profile join' );

	// ping / pong
	b.send( { t: 'ping', c: 4242 } );
	const pong = await b.next( 'pong' );
	ok( pong.c === 4242 && typeof pong.at === 'number', 'ping is answered with pong { c, at }' );

	// clock broadcast
	const ck = await a.next( 'clock', 2000 );
	ok( ck.timeSpeed === 0.01 && ck.timeOfDay >= 9.5 && ck.timeOfDay < 9.6, 'clock message broadcast (advancing from 9.5 h)' );

	// health
	const health = await ( await fetch( `http://127.0.0.1:${ port }/health` ) ).json();
	ok( health.ok === true && health.players === 2 && health.rooms.island && health.rooms.island.players === 2, 'GET /health reports 2 players in island' );

	// a second room is isolated
	const c = client( `ws://127.0.0.1:${ port }/Cove-2` );
	c.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'Cy', character: 'hyptile' } );
	const wc = await c.next( 'welcome' );
	ok( wc.room === 'cove-2' && wc.peers.length === 0, 'rooms by path are isolated' );
	await sleep( 100 );
	ok( a.drain( ( m ) => m.t === 'join' ).length === 0, 'island does not see the cove join' );
	c.ws.close();

	// protocol version check
	const d = client( url );
	await d.open;
	d.send( { t: 'hello', v: 99, name: 'Old' } );
	const err = await d.next( 'error' );
	ok( err.code === 'version' && ( await d.closedP ).code === REFUSAL.version, 'wrong protocol version is refused (version)' );

	// leave
	b.ws.close();
	const lv = await a.next( 'leave' );
	ok( lv.id === wb.id, 'A gets leave when B disconnects' );
	await sleep( 50 );
	const health2 = await ( await fetch( `http://127.0.0.1:${ port }/health` ) ).json();
	ok( health2.rooms.island.players === 1, 'health drops to 1 player after the leave' );

	a.ws.close();
	d.ws.close();

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

await srv.close();

// ---- room cap (its own server: one per process)
{

	const srv2 = startServer( { port: 0, host: '127.0.0.1', roomCap: 1, log: () => {} } );
	const port2 = await srv2.ready;
	try {

		const e1 = client( `ws://127.0.0.1:${ port2 }/island` ), e2 = client( `ws://127.0.0.1:${ port2 }/island` );
		e1.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'E1' } );
		await e1.next( 'welcome' );
		e2.send( { t: 'hello', v: PROTOCOL_VERSION, name: 'E2' } );
		const full = await e2.next( 'error' );
		ok( full.code === 'full' && ( await e2.closedP ).code === REFUSAL.full, 'room cap refuses the extra player (full)' );
		e1.close();

	} catch ( e ) {

		fails ++;
		console.log( 'FAIL', e && e.stack || e );

	}

	await srv2.close();

}

// ---- crews, passengers, the host's ships (v2.1)

ok( sanitizeCrewCode( ' AbCdEf ' ) === 'abcdef' && sanitizeCrewCode( 'abcde' ) === null && sanitizeCrewCode( 'abcdef1' ) === null && sanitizeCrewCode( 5 ) === null, 'sanitizeCrewCode accepts six letters, any case' );
ok( isCrewRoom( 'abcdef' ) && ! isCrewRoom( 'island' ) && ! isCrewRoom( 'cove-2' ), 'isCrewRoom: six letters but not the default room' );
const mk = makeCrewCode( ( c ) => c.startsWith( 'a' ) );
ok( /^[a-hj-km-np-z]{6}$/.test( mk ) && ! mk.startsWith( 'a' ), 'makeCrewCode skips taken codes and the confusable letters' );
ok( crewUrl( 'ws://example.com:8765/island?x=1', 'ABCDEF' ) === 'ws://example.com:8765/abcdef' && crewUrl( 'ws://x/y', 'nope' ) === null, 'crewUrl swaps the room path' );
const sw = sanitizeWorld( { ships: [
	{ id: 'sloop-1', k: 'sloop', n: 'Black Gull\u0000', x: 100.123, z: - 50, y: 7, s: 3.456, hp: 120.55, mx: 150, st: 'patrol', r: 0.9 },
	{ id: 'sloop-1', k: 'sloop', x: 1, z: 1, y: 0, s: 0, hp: 1, mx: 1, st: 'patrol' },
	{ id: 'bad', k: 'sloop', x: NaN, z: 0, y: 0, s: 0, hp: 1, mx: 1, st: 'sail' },
	{ id: 'bad2', k: 'Sloop!', x: 0, z: 0, y: 0, s: 0, hp: 1, mx: 1, st: 'sail' },
	{ id: 'far', k: 'sloop', x: 9e9, z: 0, y: 0, s: 0, hp: 1, mx: 1, st: 'sail' },
	...Array.from( { length: 40 }, ( _, i ) => ( { id: 'm' + i, k: 'trawler', x: i, z: i, y: 0, s: 1, hp: 50, mx: 50, st: 'sail' } ) ),
] } );
ok( sw && sw.ships.length === 12 && sw.ships[ 0 ].n === 'Black Gull' && sw.ships[ 0 ].x === 100.1 && sw.ships[ 0 ].y === 0.72 && sw.ships[ 1 ].id === 'm0', 'sanitizeWorld caps at 12 ships, drops duplicates / NaN / bad kinds, rounds' );
ok( sanitizeWorld( { ships: 'x' } ) === null && JSON.stringify( sanitizeWorld( { ships: Array.from( { length: 12 }, ( _, i ) => ( { id: 'trawler-' + i, k: 'trawler', n: 'x'.repeat( 99 ), x: 1234.5, z: - 1234.5, y: 1, s: 5, hp: 100, mx: 100, st: 'sail', r: 1 } ) ) } ) ).length < 3500, 'sanitizeWorld rejects non-lists; a full list fits one frame' );
const fx1 = sanitizeFx( { kind: 'shot', from: [ 1, 2, 3 ], dir: [ 0, 0, 1.9 ], v: 9999, d: 500, o: 'sloop-1', big: true } );
ok( fx1 && fx1.dir[ 2 ] === 1 && fx1.v === 400 && fx1.d === 60 && fx1.big === true, 'sanitizeFx shot: unit direction, speed and damage clamped' );
ok( sanitizeFx( { kind: 'shot', from: [ 1, 2 ], dir: [ 0, 0, 1 ] } ) === null && sanitizeFx( { kind: 'shot', from: [ 0, 0, 0 ], dir: [ 0, 0, 0 ] } ) === null && sanitizeFx( { kind: 'nuke' } ) === null, 'sanitizeFx rejects malformed shots and unknown kinds' );
ok( sanitizeHit( { ship: 'sloop-1', dmg: 9999, part: 'x' } ).dmg === 60 && sanitizeHit( { ship: 'a', dmg: - 3 } ) === null && sanitizeHit( { dmg: 5 } ) === null, 'sanitizeHit clamps damage and needs a ship' );
const sr = sanitizeState( { ...good, mode: 'ride', ride: 'abc123', seat: 2.4 } );
ok( sr && sr.mode === 'ride' && sr.ride === 'abc123' && sr.seat === 2 && sanitizeState( { ...good, ride: '../x' } ).ride === null, 'sanitizeState: ride / seat (a bad host id is dropped)' );
ok( sanitizeState( { ...good, mode: 'seat', action: 'seated' } ) !== null, 'sanitizeState accepts the seated mode and action' );

const boatState = ( x, z, extra = {} ) => ( { t: 'state', p: [ x, 0, z ], yaw: 0, mode: 'boat', speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'pepe',
	boat: { id: 'skiff', p: [ x, 0, z ], q: [ 0, 0, 0, 1 ], throttle: 0, steer: 0, rpm: 0, driven: false }, ...extra } );
const walkState = ( x, z ) => ( { t: 'state', p: [ x, 0, z ], yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'doge', boat: null } );
const hello = ( name ) => ( { t: 'hello', v: PROTOCOL_VERSION, name, character: 'pepe', boat: null } );

const srv4 = startServer( { port: 0, host: '127.0.0.1', log: () => {}, crewEveryMs: 400, emptyMs: 200, crewHoldMs: 600, maxRooms: 6 } );
const port4 = await srv4.ready;
const base4 = `ws://127.0.0.1:${ port4 }`;
const live = [];
const join = async ( path, name ) => {

	const c = client( `${ base4 }/${ path }` );
	live.push( c );
	await c.open;
	c.send( hello( name ) );
	c.welcome = await c.next( 'welcome' );
	return c;

};

try {

	// crew codes
	const lobby = await join( 'island', 'Lobby' );
	ok( lobby.welcome.crew === false && lobby.welcome.host === lobby.welcome.id, 'welcome: the first player is the host; island is not a crew room' );
	lobby.send( { t: 'createCrew' } );
	const cr = await lobby.next( 'crew' );
	ok( /^[a-hj-km-np-z]{6}$/.test( cr.code ), `createCrew answers with a six-letter code (${ cr.code })` );
	lobby.send( { t: 'createCrew' } );
	const tooSoon = await lobby.next( 'error' );
	ok( tooSoon.code === 'rate', 'a second createCrew within the window is refused' );

	const unknown = client( `${ base4 }/qqqqqq` );
	live.push( unknown );
	unknown.send( hello( 'Nobody' ) );
	const nocrew = ( await unknown.closedP ).code;
	ok( nocrew === REFUSAL.nocrew && unknown.queue.some( ( m ) => m.t === 'error' && m.code === 'nocrew' ), 'an unknown crew code is refused with nocrew' );

	const bob = await join( cr.code, 'Bob' );
	ok( bob.welcome.room === cr.code && bob.welcome.crew === true && bob.welcome.host === bob.welcome.id && bob.welcome.peers.length === 0, 'the creator walks into the crew room and is its host' );
	const ann = await join( cr.code.toUpperCase(), 'Ann' );
	const jb = await bob.next( 'join' );
	ok( ann.welcome.room === cr.code && ann.welcome.host === bob.welcome.id && ann.welcome.peers.length === 1 && jb.peer.id === ann.welcome.id, 'a second player joins by code (case-insensitive) and sees the first as host' );

	// passengers
	const B = bob.welcome.id, A = ann.welcome.id;
	bob.send( boatState( 0, 0 ) );
	ann.send( walkState( 40, 0 ) );
	await sleep( 120 );
	ann.send( { t: 'ride', host: B } );
	ok( ( await ann.next( 'rideNo' ) ).reason === 'range', 'ride: too far from the boat is refused (range)' );
	ann.send( walkState( 3, 1 ) );
	await sleep( 120 );
	await sleep( 700 ); // (the per-kind limiter window)
	ann.send( { t: 'ride', host: B } );
	const [ r1, r2 ] = await Promise.all( [ ann.next( 'ride' ), bob.next( 'ride' ) ] );
	ok( r1.guest === A && r1.host === B && r1.seat === 0 && r2.guest === A, 'ride: the server seats the guest and tells the room' );
	ann.send( walkState( 3, 1 ) ); // a guest that walks on its own...
	const sv = await bob.next( ( m ) => m.t === 'states' && m.list.some( ( x ) => x.id === A && x.mode === 'ride' ), 2000 );
	const sa = sv.list.find( ( x ) => x.id === A );
	ok( sa.ride === B && sa.seat === 0, 'a seated guest is relayed as mode ride with the host id and seat, whatever it claims' );
	const carol = await join( cr.code, 'Carol' );
	carol.send( walkState( 2, 2 ) );
	await sleep( 100 );
	carol.send( { t: 'ride', host: B } );
	ok( ( await carol.next( 'rideNo' ) ).reason === 'full', 'ride: a skiff has one seat, the second guest is refused (full)' );
	ann.send( { t: 'ride', host: B } );
	ok( ( await ann.next( 'rideNo' ) ).reason === 'busy', 'ride: a guest cannot board twice' );
	ann.send( { t: 'unride' } );
	const un = await bob.next( 'unride' );
	ok( un.guest === A && un.reason === 'left', 'unride: stepping off is announced' );
	await sleep( 120 );
	ann.send( walkState( 3, 1 ) );
	const sv2 = await bob.next( ( m ) => m.t === 'states' && m.list.some( ( x ) => x.id === A && x.mode === 'walk' ), 2000 );
	ok( sv2.list.find( ( x ) => x.id === A ).ride === null, 'after stepping off the state is walk again' );
	bob.send( { t: 'ridePolicy', open: false } );
	const pol = await ann.next( 'policy' );
	ok( pol.id === B && pol.open === false, 'ridePolicy: closing the boat is broadcast' );
	await sleep( 2100 ); // (ride requests are limited to 3 per 2 s)
	ann.send( { t: 'ride', host: B } );
	ok( ( await ann.next( 'rideNo' ) ).reason === 'closed', 'ride: a closed boat takes no guests' );
	bob.send( { t: 'ridePolicy', open: true } );
	await ann.next( 'policy' );
	// a state claiming mode ride without being seated is walk
	carol.send( { ...walkState( 2, 2 ), mode: 'ride', ride: B } );
	const sv3 = await bob.next( ( m ) => m.t === 'states' && m.list.some( ( x ) => x.id === carol.welcome.id ), 2000 );
	ok( sv3.list.find( ( x ) => x.id === carol.welcome.id ).mode === 'walk', 'an unseated client cannot claim to ride' );

	// the host's ships
	const w1 = { t: 'world', ships: [ { id: 'sloop-1', k: 'sloop', n: 'Black Gull', x: 100, z: 200, y: 1, s: 4, hp: 80, mx: 100, st: 'patrol' }, { id: 'bad', k: 'sloop' } ] };
	ann.send( w1 );
	await sleep( 200 );
	ok( bob.drain( ( m ) => m.t === 'world' ).length === 0 && carol.drain( ( m ) => m.t === 'world' ).length === 0, 'world: a snapshot from a non-host is ignored' );
	bob.send( w1 );
	const wa = await ann.next( 'world' ), wc = await carol.next( 'world' );
	ok( wa.host === B && wa.ships.length === 1 && wa.ships[ 0 ].id === 'sloop-1' && wa.ships[ 0 ].hp === 80 && typeof wa.at === 'number' && wc.ships.length === 1, 'world: the host\'s ships reach everybody else, sanitized' );
	ok( bob.drain( ( m ) => m.t === 'world' ).length === 0, 'world: not echoed to the host' );
	await sleep( 120 );
	bob.send( w1 ); bob.send( w1 ); bob.send( w1 );
	await sleep( 250 );
	ok( ann.drain( ( m ) => m.t === 'world' ).length === 1, 'world: rate limited (a burst relays one)' );
	const late = await join( cr.code, 'Late' );
	const wl = await late.next( 'world' );
	ok( wl.ships.length === 1 && wl.ships[ 0 ].id === 'sloop-1', 'world: a late joiner gets the latest ships right after the welcome' );

	// cannon fire and damage reports
	ann.send( { t: 'fx', kind: 'shot', from: [ 5, 1, 5 ], dir: [ 0, 0.1, 1 ], v: 120, d: 0, o: 'player', big: false } );
	const fb = await bob.next( 'fx' ), fc = await carol.next( 'fx' );
	ok( fb.id === A && fb.kind === 'shot' && fb.from[ 0 ] === 5 && Math.abs( Math.hypot( ...fb.dir ) - 1 ) < 0.01 && fc.id === A, 'fx: a shot reaches everybody else with the sender id' );
	ok( ann.drain( ( m ) => m.t === 'fx' ).length === 0, 'fx: not echoed' );
	ann.send( { t: 'fx', kind: 'shot', from: [ 5, 1 ], dir: [ 0, 0, 1 ] } );
	ann.send( { t: 'fx', kind: 'explode' } );
	await sleep( 150 );
	ok( bob.drain( ( m ) => m.t === 'fx' ).length === 0, 'fx: malformed / unknown effects are dropped' );
	for ( let i = 0; i < 30; i ++ ) ann.send( { t: 'fx', kind: 'shot', from: [ 5, 1, 5 ], dir: [ 0, 0, 1 ] } );
	await sleep( 300 );
	ok( bob.drain( ( m ) => m.t === 'fx' ).length <= 12, 'fx: at most 12 per second per client' );
	ann.send( { t: 'hit', ship: 'sloop-1', dmg: 9999, part: 'hull' } );
	const h1 = await bob.next( 'hit' );
	ok( h1.from === A && h1.ship === 'sloop-1' && h1.dmg === 60 && h1.part === 'hull', 'hit: a damage report goes to the host, clamped to 60' );
	ok( carol.drain( ( m ) => m.t === 'hit' ).length === 0, 'hit: only the host receives it' );
	bob.send( { t: 'hit', ship: 'sloop-1', dmg: 5 } );
	await sleep( 120 );
	ok( ann.drain( ( m ) => m.t === 'hit' ).length === 0, 'hit: the host applies its own hits locally (nothing relayed)' );

	// ride + host migration: the host leaves with a guest aboard
	await sleep( 700 );
	ann.send( walkState( 3, 1 ) );
	bob.send( boatState( 0, 0 ) );
	await sleep( 150 );
	ann.drain( ( m ) => m.t === 'ride' || m.t === 'unride' );
	ann.send( { t: 'ride', host: B } );
	await ann.next( 'ride' );
	bob.ws.close();
	const gone = await ann.next( ( m ) => m.t === 'unride' );
	ok( gone.guest === A && gone.reason === 'gone', 'the host leaving puts its guests off the boat' );
	const hostMsg = await ann.next( 'host' );
	ok( hostMsg.id === A && hostMsg.prev === B, 'host migration: the next oldest player becomes the host' );
	await carol.next( 'host' );
	ann.send( { ...w1, ships: [ { ...w1.ships[ 0 ], id: 'trawler-9', k: 'trawler' } ] } );
	const wn = await carol.next( ( m ) => m.t === 'world' && m.host === A );
	ok( wn.host === A && wn.ships[ 0 ].id === 'trawler-9', 'host migration: the new host\'s world is relayed, the old host\'s cache is gone' );
	const h2 = await join( cr.code, 'Dee' );
	ok( h2.welcome.host === A, 'a later joiner is told who the host is now' );

	// room limits (6 rooms in this server: island, the crew, and the reserved ones)
	const eph = [];
	for ( let i = 0; i < 4; i ++ ) {

		const p = await join( `room-${ i }`, 'R' + i );
		eph.push( p );

	}

	const over = client( `${ base4 }/one-too-many` );
	live.push( over );
	over.send( hello( 'Over' ) );
	const rc = ( await over.closedP ).code;
	ok( rc === REFUSAL.rooms && over.queue.some( ( m ) => m.code === 'rooms' ), 'the server refuses a new room beyond --max-rooms (rooms)' );
	await sleep( 450 );
	lobby.send( { t: 'createCrew' } );
	ok( ( await lobby.next( 'error' ) ).code === 'rooms', 'createCrew is refused when no room is free' );

	// a reserved code that nobody uses expires; an emptied room goes away
	for ( const p of eph ) p.ws.close();
	await sleep( 900 );
	lobby.send( { t: 'createCrew' } );
	const cr2 = await lobby.next( 'crew' );
	ok( /^[a-z]{6}$/.test( cr2.code ), 'rooms freed by leaving are reusable' );
	await sleep( 1400 ); // crewHoldMs 600 + tick
	const dead = client( `${ base4 }/${ cr2.code }` );
	live.push( dead );
	dead.send( hello( 'Late' ) );
	const dc = ( await dead.closedP ).code;
	ok( dc === REFUSAL.nocrew, 'an unused crew code expires' );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of live ) try { c.ws.close(); } catch ( e ) { /* closed */ }
await srv4.close();

// ---- wave 20E: a navy hail goes from the host to its player alone; nobody else may hail
{

	const srv5 = startServer( { port: 0, host: '127.0.0.1', log: () => {} } );
	const port5 = await srv5.ready;
	const cs = [];
	try {

		const mk5 = async ( name ) => {

			const c = client( `ws://127.0.0.1:${ port5 }/island` );
			cs.push( c );
			c.send( hello( name ) );
			c.welcome = await c.next( 'welcome' );
			return c;

		};
		const h = await mk5( 'Host' ), g = await mk5( 'Gus' ), k = await mk5( 'Kit' );
		const isHail = ( m ) => m.t === 'event' && m.kind === 'navyHail';
		h.send( { t: 'event', kind: 'navyHail', data: { to: g.welcome.id, say: 'board', ship: 'HMS Test', n: 7 } } );
		const got = await g.next( isHail );
		ok( got.data.to === g.welcome.id && got.data.n === 7 && got.from === h.welcome.id, "the host's navyHail reaches the player it names" );
		await sleep( 300 );
		ok( ! k.drain( isHail ).length, 'and nobody else' );
		k.send( { t: 'event', kind: 'navyHail', data: { to: g.welcome.id, say: 'board', ship: 'Fake', n: 8 } } );
		await sleep( 300 );
		ok( ! g.drain( isHail ).length && ! h.drain( isHail ).length, 'a guest cannot hail anybody (only the host runs the navy)' );

	} catch ( e ) {

		fails ++;
		console.log( 'FAIL', e && e.stack || e );

	}

	for ( const c of cs ) try { c.ws.close(); } catch ( e ) { /* closed */ }
	await srv5.close();

}

clearTimeout( watchdog );
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\nnet-protocol: all checks passed' );
process.exit( 0 );
