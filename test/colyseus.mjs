// Plain-node test of the Colyseus rooms themselves (server/rooms.mjs, server/schema.mjs, src/net/ColyseusLink.js,
// NetClient's reconnection): a raw @colyseus/sdk client decodes the schema state by reflection and
// sees 15 Hz patches; the link turns patches into the protocol's messages; a dropped client keeps its seat and id (and
// one that never comes back leaves, mooring its boat); the same captain in a second window replaces the first; a probe
// adds nobody; a server restart on the same port is survived by NetClient. Exits 0 on success, 1 on failure.
//
//   node test/colyseus.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { Client, Callbacks } from '@colyseus/sdk';
import { linkTarget, joinError } from '../src/net/ColyseusLink.js';
import { NetClient } from '../src/net/NetClient.js';
import { probeUniverse } from '../src/net/Universe.js';
import { PROTOCOL_VERSION, REFUSAL, crewUrl, isUniverseUrl } from '../src/net/Protocol.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 90 s' ); process.exit( 1 ); }, 90000 );
const hex = ( c ) => c.repeat( 32 );
const until = async ( pred, ms = 3000 ) => {

	const t0 = Date.now();
	while ( Date.now() - t0 < ms ) {

		if ( pred() ) return true;
		await sleep( 25 );

	}

	return !! pred();

};
const freePort = () => new Promise( ( resolve ) => {

	const s = net.createServer().listen( 0, '127.0.0.1', () => {

		const p = s.address().port;
		s.close( () => resolve( p ) );

	} );

} );
const walk = ( x, z, extra = {} ) => ( { t: 'state', p: [ x, 0, z ], yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'pepe', boat: null, ...extra } );
const aboard = ( x, z ) => walk( x, z, { mode: 'boat', boat: { id: 'skiff', p: [ x, 0.2, z ], q: [ 0, 0, 0, 1 ], throttle: 0, steer: 0, rpm: 0, driven: false } } );

// ---- pure parts

{

	const t1 = linkTarget( 'ws://h:8765/island' ), t2 = linkTarget( 'wss://island.example.com/net/universe' ), t3 = linkTarget( 'ws://h:8765/ABCDEF' );
	ok( t1.endpoint === 'http://h:8765' && t1.room === 'island' && t1.kind === 'room', 'linkTarget: a named room on the server root' );
	ok( t2.endpoint === 'https://island.example.com/net' && t2.kind === 'universe' && isUniverseUrl( 'wss://island.example.com/net/universe' ), 'linkTarget: a universe behind a TLS proxy prefix' );
	ok( t3.kind === 'crew' && t3.room === 'abcdef' && linkTarget( 'http://x/y' ) === null, 'linkTarget: crew codes fold case; non-ws urls are refused' );
	ok( crewUrl( 'wss://x.org/net/island', 'qwerty' ) === 'wss://x.org/net/qwerty', 'crewUrl keeps a proxy prefix' );
	ok( joinError( { code: REFUSAL.name, message: 'taken' }, 'universe' ).code === 'name' && joinError( { code: 522, message: 'x' }, 'crew' ).code === 'nocrew' && joinError( new Error( 'ECONNREFUSED' ) ).code === 'down', 'joinError maps refusals, missing rooms and silence' );

}

const root = mkdtempSync( join( tmpdir(), 'hyptile-colyseus-' ) );
const port = await freePort();
const OPTS = { port, host: '127.0.0.1', universe: 'colytest', data: join( root, 'colytest' ), reconnectSeconds: 2, clockEveryMs: 500, flushMs: 300, saveEveryMs: 200, log: () => {} };
let srv = startServer( OPTS );
await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
let threw = null;
try { startServer( { port: 0 } ); } catch ( e ) { threw = e; }
ok( threw && /already running/.test( threw.message ), 'one server per process: a second startServer throws' );

const live = [];
try {

	// ---- a raw @colyseus/sdk client: the schema state by reflection, Callbacks, 15 Hz patches
	const raw = new Client( `http://127.0.0.1:${ port }` );
	const room = await raw.joinOrCreate( 'room', { v: PROTOCOL_VERSION, name: 'Raw', character: 'pepe', room: 'island' } );
	await until( () => room.state && room.state.players && room.state.players.size === 1 );
	const me = [ ...room.state.players.values() ][ 0 ];
	ok( me && me.name === 'Raw' && me.character === 'pepe' && room.state.room === 'island' && room.state.host === me.id, 'raw client: the reflected state has the player, the room and the host' );
	const cb = Callbacks.get( room );
	const added = [];
	cb.onAdd( 'players', ( pl, id ) => added.push( id ) );
	ok( added.length === 1 && added[ 0 ] === me.id, 'raw client: Callbacks.get( room ).onAdd fires for the player already there' );
	ok( room.state.clock && Math.abs( room.state.clock.timeOfDay - 9.5 ) < 0.1 && room.state.clock.day === - 1, 'raw client: the clock is in the state (no universe day)' );
	const changes = [];
	room.onStateChange( () => changes.push( Date.now() ) );
	const t0 = Date.now();
	for ( let i = 0; i < 20; i ++ ) {

		room.send( 'state', { p: [ i, 0, 0 ], yaw: 0, mode: 'walk' } );
		await sleep( 20 );

	}

	await sleep( 200 );
	const span = ( changes.at( - 1 ) - changes[ 0 ] ) / 1000;
	const hz = ( changes.length - 1 ) / Math.max( span, 1e-3 );
	ok( me.x === 19 && me.seq >= 15 && hz > 8 && hz < 22, `raw client: 20 states in 0.4 s arrive as ~15 Hz patches (${ changes.length } patches, ${ hz.toFixed( 1 ) } Hz)` );
	ok( Date.now() - t0 < 2000, 'raw client: patches flow without a stall' );
	await room.leave( true );

	// ---- links: join, states, chat, world events (relayed to the others, persisted for the universe)
	const A = wireClient( `${ base }/universe` ), B = wireClient( `${ base }/universe` );
	live.push( A, B );
	A.send( { t: 'hello', v: 2, name: 'Anne Bonny', character: 'pepe', boat: 'skiff', token: hex( 'a' ) } );
	const wa = await A.next( 'welcome' );
	B.send( { t: 'hello', v: 2, name: 'Mary Read', character: 'doge', boat: null, token: hex( 'b' ) } );
	const wb = await B.next( 'welcome' );
	ok( wa.universe && wa.universe.name === 'colytest' && wb.peers.length === 1 && wb.peers[ 0 ].name === 'Anne Bonny' && wb.peers[ 0 ].captain === 'anne bonny', 'two captains in the universe; the second sees the first' );
	const ja = await A.next( 'join' );
	ok( ja.peer.id === wb.id && ja.peer.name === 'Mary Read', 'the first sees the second join (a schema add)' );
	A.send( aboard( 30, 40 ) );
	const sa = await B.next( ( m ) => m.t === 'states' && m.list.some( ( s ) => s.id === wa.id ) );
	const s0 = sa.list.find( ( s ) => s.id === wa.id );
	ok( s0.mode === 'boat' && s0.boat.id === 'skiff' && s0.boat.p[ 0 ] === 30 && s0.boat.q[ 3 ] === 1 && typeof sa.at === 'number', 'a state patch reads back as the protocol state (boat, centimetres, quaternion)' );
	B.send( { t: 'chat', text: 'ahoy' } );
	const [ c1, c2 ] = await Promise.all( [ A.next( 'chat' ), B.next( 'chat' ) ] );
	ok( c1.text === 'ahoy' && c1.name === 'Mary Read' && c2.id === wb.id, 'chat reaches both' );
	A.send( { t: 'event', kind: 'propDestroyed', data: { id: 'crate-9', respawn: 300 } } );
	const ev = await B.next( 'event' );
	ok( ev.kind === 'propDestroyed' && ev.data.id === 'crate-9' && ev.from === wa.id, 'a world event is relayed with the sender id' );
	A.send( { t: 'world', ships: [ { id: 'pirate-7', k: 'sloop', n: 'Revenge', x: 10, z: 20, y: 0, s: 3, hp: 90, mx: 100, st: 'patrol' } ] } );
	const wd = await B.next( 'world' );
	ok( wd.host === wa.id && wd.ships[ 0 ].id === 'pirate-7' && wd.ships[ 0 ].hp === 90, 'the host\'s ships reach the others through the schema' );

	// ---- a probe adds nobody
	const pr = await probeUniverse( `${ base }/universe`, 'Calico Jack', { token: hex( 'c' ) } );
	await sleep( 200 );
	ok( pr.captain === 'Calico Jack' && pr.exists === false && pr.players === 2 && ! A.queue.some( ( m ) => m.t === 'join' ), 'a probe answers with the profile and nobody joins' );

	// ---- name theft refused, a second window replaces the first
	const T = wireClient( `${ base }/universe` );
	live.push( T );
	T.send( { t: 'hello', v: 2, name: 'anne BONNY', character: 'pepe', token: hex( 'f' ) } );
	ok( ( await T.next( 'error' ) ).code === 'name' && ( await T.closedP ).code === REFUSAL.name, 'another token cannot take a captain\'s name (refusal name)' );

	// ---- reconnection: a drop keeps the seat and the id; the others see no leave
	const netB = new NetClient( { url: `${ base }/universe`, name: 'Mary Read', character: 'doge', token: hex( 'b' ) } );
	B.close();
	await A.next( ( m ) => m.t === 'leave' && m.id === wb.id );
	const statuses = [];
	netB.onStatus = ( s ) => statuses.push( s );
	netB.connect();
	ok( await until( () => netB.online ), 'NetClient joins the universe' );
	const idB = netB.id;
	await A.next( ( m ) => m.t === 'join' && m.peer.id === idB );
	A.drain( () => true );
	await sleep( 1100 ); // (the SDK reconnects rooms that were up for its minUptime)
	netB.link.drop();
	ok( await until( () => ! netB.online, 2000 ), 'a dropped socket takes NetClient offline' );
	ok( await until( () => netB.online, 4000 ), 'NetClient comes back by itself' );
	ok( netB.id === idB && statuses.includes( 'connecting' ), `the same seat: the id is kept (${ idB })` );
	await sleep( 300 );
	ok( ! A.queue.some( ( m ) => m.t === 'leave' || m.t === 'join' ), 'the others saw neither a leave nor a join' );
	ok( netB.peers.has( wa.id ) && netB.universeInfo && netB.world, 'after the reconnect the peers and the universe welcome are back' );

	// a drop that never comes back is a leave after reconnectSeconds, and the boat stays moored
	const D = wireClient( `${ base }/universe` );
	live.push( D );
	D.send( { t: 'hello', v: 2, name: 'Ching Shih', character: 'pepe', boat: 'skiff', token: hex( 'd' ) } );
	const wd2 = await D.next( 'welcome' );
	D.send( aboard( 5, 6 ) );
	await A.next( ( m ) => m.t === 'states' && m.list.some( ( s ) => s.id === wd2.id ) );
	D.drop();
	await sleep( 800 );
	ok( ! A.queue.some( ( m ) => m.t === 'leave' && m.id === wd2.id ), 'still seated during the reconnect window' );
	const lv = await A.next( ( m ) => m.t === 'leave' && m.id === wd2.id, 4000 );
	const mo = await A.next( ( m ) => m.t === 'event' && m.kind === 'boatMoored' && m.data.name === 'Ching Shih', 2000 );
	ok( lv && mo.data.p[ 0 ] === 5 && srv.ctx.rooms.get( 'universe' ).state.moored.has( 'ching shih' ), 'after the window: a leave, and the boat is moored (event + schema)' );

	// the same captain from a second window: the first is closed with 'replaced' (REFUSAL.replaced)
	const A2 = wireClient( `${ base }/universe` );
	live.push( A2 );
	A2.send( { t: 'hello', v: 2, name: 'Anne Bonny', character: 'pepe', token: hex( 'a' ) } );
	await A2.next( 'welcome' );
	const rep = await A.next( 'error' );
	ok( rep.code === 'replaced' && ( await A.closedP ).code === REFUSAL.replaced, 'a second window replaces the first (replaced, close 4108)' );

	// a save, kept across a restart; NetClient survives the restart on the same port
	A2.send( { t: 'save', profile: { v: 2, money: 777, xp: 1, inventory: [], log: {}, upgrades: {}, unlocked: [], character: 'pepe', boat: 'skiff' } } );
	const sv = await A2.next( 'saved' );
	ok( sv.ok, 'a save is stored' );
	const before = netB.received;
	await srv.close();
	ok( await until( () => ! netB.online, 2000 ) && netB.status !== 'error', 'a server shutdown takes NetClient offline, not into an error' );
	srv = startServer( OPTS );
	await srv.ready;
	ok( await until( () => netB.online, 8000 ) && netB.received > before, 'NetClient rejoins the restarted server by itself' );
	const pa = await probeUniverse( `${ base }/universe`, 'Anne Bonny', { token: hex( 'a' ) } );
	ok( pa.exists && pa.profile.money === 777, 'the save came back after the restart' );
	ok( netB.world && netB.world.events.some( ( e ) => e.kind === 'propDestroyed' && e.data.id === 'crate-9' ), 'the destroyed crate is replayed after the restart' );
	netB.disconnect();

	// health
	const h = await ( await fetch( `http://127.0.0.1:${ port }/health` ) ).json();
	ok( h.ok && h.transport === 'colyseus' && h.universe && h.universe.name === 'colytest', 'GET /health still answers' );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of live ) try { c.close(); } catch ( e ) { /* closed */ }
await srv.close();
clearTimeout( watchdog );
try { rmSync( root, { recursive: true, force: true } ); } catch ( e ) { /* a locked file on Windows */ }
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\ncolyseus: all checks passed' );
process.exit( 0 );
