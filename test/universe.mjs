// Plain-node test of the persistent universe (no GPU): server/index.mjs --universe (Colyseus) in-process on a free port with
// a temp data dir, @colyseus/sdk clients (server/testkit.mjs) and the browser's own NetClient + UniverseSession. Checks join,
// probe, the stored profile and its anti-cheat clamp, world events relayed and persisted, extras passed through, the market,
// moored boats, name theft refused, oversized saves refused, admin commands, a restart (profile, destroyed prop, ships,
// chat and boats survive), the respawn timer and the atomic writes. Wave 15 (the shared universe): the Blackwater fort over a
// restart, /health's build, the admin HTTP routes behind a token, the client's default address and its health probe.
// Exits 0 on success, 1 on failure.
//
//   node test/universe.mjs [--data <dir>]     (default: a fresh folder under the OS temp dir, removed at the end)

import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { Universe, sanitizeProfile, writeAtomic, SCHEMA, MONEY_BURST, MONEY_RATE } from '../server/universe.mjs';
import { rewardFor, REWARD_MAX, CREDIT_MAX } from '../server/universe.mjs';
import { fencePrice } from '../src/features/hijack/Rules.js';
import { MAX_SAVE, REFUSAL, captainKey, sanitizeCaptainName, isUniverseUrl } from '../src/net/Protocol.js';
import { normalizeUniverseUrl, universeToken, probeUniverse, UniverseSession, universeError } from '../src/net/Universe.js';
import * as UniverseW15 from '../src/net/Universe.js';
import { NetClient } from '../src/net/NetClient.js';
import { GameState } from '../src/game/GameState.js';
import { NetSync } from '../src/features/netsync/NetSync.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const watchdog = setTimeout( () => {

	console.log( 'FAIL timeout: the test did not finish in 60 s' );
	process.exit( 1 );

}, 60000 );

const argData = process.argv.indexOf( '--data' );
const base = argData > 0 ? process.argv[ argData + 1 ] : null;
if ( base ) mkdirSync( base, { recursive: true } );
const root = mkdtempSync( join( base || tmpdir(), 'hyptile-universe-' ) );
const dataDir = join( root, 'testverse' );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const hex = ( c ) => c.repeat( 32 );
const TOKEN_A = hex( 'a' ), TOKEN_B = hex( 'b' ), TOKEN_C = hex( 'c' );

const client = wireClient;

const hello = ( name, token, extra = {} ) => ( { t: 'hello', v: 2, name, character: 'hyptile', boat: 'skiff', token, ...extra } );
const state = ( extra = {} ) => ( { t: 'state', p: [ 10, 1, 20 ], yaw: 0.5, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'hyptile', boat: null, ...extra } );
const profileOf = ( money, extra = {} ) => ( { v: 2, mode: 'multiplayer', name: 'whoever', money, xp: 10, inventory: [], log: {}, upgrades: { rod: 1 }, unlocked: [ 'hyptile' ], character: 'hyptile', boat: 'skiff', fuel: 30, nextId: 3, rep: {}, discovered: [], career: { sold: 2 }, quests: {}, world: null, features: {}, ...extra } );

// ---- pure parts: names, tokens, addresses, the anti-cheat, the atomic write, the respawn timer

ok( sanitizeCaptainName( '  Mad   Meg ' ) === 'Mad Meg' && captainKey( 'MAD  meg' ) === 'mad meg', 'captain names are cleaned and keyed case-blind' );
ok( sanitizeCaptainName( 'x' ) === null && sanitizeCaptainName( 'Server' ) === null && sanitizeCaptainName( '<script>' ) === null, 'too short, reserved and odd names are refused' );
ok( normalizeUniverseUrl( '192.168.1.20', { protocol: 'http:' } ) === 'ws://192.168.1.20:8875/universe', 'a bare LAN address gets ws, the separate Alpha Astra port 8875 and /universe' );
ok( normalizeUniverseUrl( 'island.example.com', { protocol: 'https:' } ) === 'wss://island.example.com/universe', 'from an https page: wss on 443 (a TLS proxy)' );
ok( normalizeUniverseUrl( 'ws://h:9000', null ) === 'ws://h:9000/universe' && isUniverseUrl( 'ws://h:9000/universe' ) && ! isUniverseUrl( 'ws://h:9000/island' ), 'a typed port is kept; isUniverseUrl tells the universe from a room' );
{

	const m = new Map(), st = { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };
	const t1 = universeToken( 'ws://a:8765/universe', st ), t2 = universeToken( 'ws://a:8765/universe', st ), t3 = universeToken( 'ws://b:8765/universe', st );
	ok( /^[0-9a-f]{32}$/.test( t1 ) && t1 === t2 && t1 !== t3, 'universeToken: 128 random bits per server, kept in storage' );

}

{

	const prev = { money: 1000, xp: 100 };
	const r = sanitizeProfile( profileOf( 1e7 ), prev, { name: 'Mad Meg', elapsedMs: 10000 } );
	ok( r && r.fix && r.profile.money === Math.floor( 1000 + MONEY_BURST + MONEY_RATE * 10 ), 'anti-cheat: money above burst + rate x online time is clamped' );
	const r2 = sanitizeProfile( profileOf( 1000 + MONEY_BURST + 20000 ), prev, { name: 'Mad Meg', elapsedMs: 0, credit: 20000 } );
	ok( r2 && ! r2.fix, 'anti-cheat: a server-relayed reward explains a bigger gain' );
	const r3 = sanitizeProfile( profileOf( 10 ), prev, { name: 'Mad Meg' } );
	ok( r3 && ! r3.fix && r3.profile.money === 10 && r3.profile.name === 'Mad Meg' && r3.profile.mode === 'multiplayer', 'spending is free; the server sets the name and the mode' );
	ok( sanitizeProfile( { v: 9 } ) === null && sanitizeProfile( 'x' ) === null && sanitizeProfile( [] ) === null, 'not a save: refused' );
	const r4 = sanitizeProfile( profileOf( 5, { inventory: [ { species: 'x', kg: - 3 }, { species: 'cod', kg: 2, value: 1e12 } ], upgrades: { rod: 99, 'bad key!': 1 } } ), null, { name: 'A b' } );
	ok( r4.profile.inventory.length === 1 && r4.profile.inventory[ 0 ].value === 1e5 && r4.profile.upgrades.rod === 20 && ! ( 'bad key!' in r4.profile.upgrades ), 'shape: bad fish dropped, absurd values clamped' );

}

// wave 16D: nothing a save carries is dropped (the career's boolean flags), and a fence sale is credited at the server's price
{

	const r = sanitizeProfile( profileOf( 10, { career: { sold: 2, metRoid: true, ponsFound: false, bad: 'x' }, rodBroken: true, features: { story: { v: 1, progress: { mayday: { s: 'active', step: 3, n: 0, at: 2 } }, launchUntil: 9 } } } ), null, { name: 'A b' } );
	ok( r.profile.career.metRoid === true && r.profile.career.ponsFound === false && r.profile.career.sold === 2 && ! ( 'bad' in r.profile.career ), 'career: numbers and the boolean flags kept (the first meeting with Roid is not replayed), junk dropped' );
	ok( r.profile.rodBroken === true && r.profile.features.story.launchUntil === 9 && r.profile.features.story.progress.mayday.step === 3, 'unknown top-level fields and the part of every feature ride along' );
	ok( rewardFor( 'stolenSold', { hull: 'brigantine', price: 1e9 } ) === fencePrice( 'brigantine' ) && fencePrice( 'brigantine' ) > 0 && rewardFor( 'stolenSold', { hull: 'x' } ) === 0, 'rewardFor: a stolen hull sold is credited at the price the fence pays for her hull, never what the client says' );
	ok( rewardFor( 'bountyClaimed', { id: 'b', reward: 250 } ) === 250 && rewardFor( 'bountyClaimed', { reward: 1e9 } ) === REWARD_MAX && rewardFor( 'x', null ) === 0, 'other events: their reward, at most REWARD_MAX' );
	const u = new Universe( { name: 'fence', dir: join( root, 'fence' ) } ).load();
	const a = u.admit( { name: 'Fence Test', token: TOKEN_C, remote: 'fence' } );
	u.recordEvent( a.key, 'id1', 'stolenSold', { hull: 'brigantine', name: 'Grey Widow', price: fencePrice( 'brigantine' ) } );
	ok( u.credits.get( a.key ) === fencePrice( 'brigantine' ) && fencePrice( 'brigantine' ) <= CREDIT_MAX, 'recordEvent credits the sale for the next save' );
	const s1 = u.storeProfile( a.key, profileOf( fencePrice( 'brigantine' ) + 100 ), { startedAt: Date.now() } );
	ok( s1.ok && ! s1.fix, 'and the save right after the sale is not clamped' );

}

{

	const f = join( root, 'atomic.json' );
	writeAtomic( f, '{"a":1}' );
	writeAtomic( f, '{"a":2}' );
	ok( JSON.parse( readFileSync( f, 'utf8' ) ).a === 2 && ! existsSync( f + '.tmp' ), 'writeAtomic replaces the file and leaves no .tmp behind' );

}

{

	let now = Date.UTC( 2026, 9, 12, 12 );
	const u = new Universe( { name: 'clock', dir: join( root, 'clock' ), now: () => now } ).load();
	const a = u.admit( { name: 'Tester', token: TOKEN_A, remote: 'x' } );
	ok( a.ok && a.isNew, 'admit registers a new captain' );
	u.recordEvent( a.key, 'id1', 'propDestroyed', { id: 'crate-7', respawn: 45 } );
	u.recordEvent( a.key, 'id1', 'waved', { id: 'nobody' } );
	ok( Object.keys( u.state.events ).length === 1, 'only the kinds WORLD_EVENT_RULES knows are persisted' );
	now += 40e3;
	ok( u.expire( now ).length === 0, 'the destroyed prop holds before its respawn time' );
	now += 10e3;
	const ex = u.expire( now );
	ok( ex.length === 1 && ex[ 0 ].kind === 'propRespawned' && ex[ 0 ].data.id === 'crate-7', 'after the respawn time the server announces propRespawned' );
	const h0 = u.hours( now );
	now += 3600e3;
	ok( Math.abs( u.hours( now ) - h0 - 36 ) < 1e-6, 'the universe clock runs with nobody online (36 game hours per real hour)' );
	u.flush( true );
	now += 86400e3;
	u.flush( true );
	ok( readdirSync( join( root, 'clock', 'backups' ) ).length === 2, 'a backup copy per day' );

}

// ---- NetSync's world-event API and the universe welcome, on a stand-in NetClient

{

	const emitted = [], sent = [], adopted = [], mooredShown = [], chat = [], markets = [];
	let marketCb = null;
	const trade = {
		marketSnapshot: () => ( { day: 9 } ), adoptMarketSnapshot: ( s ) => adopted.push( s ),
		onMarketChange: ( cb ) => { marketCb = cb; return () => { marketCb = null; }; },
	};
	const features = { emit: ( t, e ) => emitted.push( [ t, e ] ), get: ( n ) => ( n === 'trade' ? trade : null ), on() {} };
	const listeners = new Map();
	const net = {
		online: true, universe: true, isHost: false, id: 'me', status: 'online', peers: new Map(), rides: new Map(), closed: new Set(),
		universeInfo: { name: 'testverse', day: 4, seed: 7, bountySeed: 99 }, captain: 'Mad Meg',
		world: {
			events: [ { kind: 'propDestroyed', data: { id: 'dock-3' }, from: 'x1', at: 1 } ],
			boats: [ { captain: 'salty sam', name: 'Salty Sam', boat: 'skiff', p: [ 1, 0, 2 ], q: [ 0, 0, 0, 1 ] } ],
			market: { day: 3 }, chat: [ { name: 'A', text: 'one' }, { name: 'Server', text: 'two', system: true } ],
		},
		on( t, fn ) { if ( ! listeners.has( t ) ) listeners.set( t, new Set() ); listeners.get( t ).add( fn ); return () => listeners.get( t ).delete( fn ); },
		fire( t, m ) { for ( const fn of listeners.get( t ) || [] ) fn( m ); },
		sendEvent( k, d ) { sent.push( [ k, d ] ); return true; },
		sendMarket( s ) { markets.push( s ); return true; },
		setRidePolicy() {},
	};
	const app = {
		net: null, game: { state: null, toast() {} },
		remotePlayers: { peers: new Map(), setMoored: ( l ) => mooredShown.push( l ), pushChat: ( m ) => chat.push( m ), anchor: () => null },
	};
	const sync = new NetSync( app, features );
	ok( sync.sendWorldEvent( 'propDestroyed', { id: 'a' } ) === false, 'sendWorldEvent offline: false' );
	app.net = net;
	sync.update( 0.016 );
	ok( sync.sendWorldEvent( 'propDestroyed', { id: 'crate-1', respawn: 60 } ) && sent[ 0 ][ 0 ] === 'propDestroyed', 'sendWorldEvent goes through NetClient.sendEvent' );
	const replay = emitted.filter( ( [ t, e ] ) => t === 'remoteWorldEvent' && e.replay );
	ok( replay.length === 1 && replay[ 0 ][ 1 ].data.id === 'dock-3', 'the stored world events replay as remoteWorldEvent { replay: true }' );
	ok( emitted.some( ( [ t, e ] ) => t === 'universeJoined' && e.bountySeed === 99 && e.captain === 'Mad Meg' ) && sync.bountySeed() === 99, 'universeJoined carries the bounty seed' );
	ok( adopted.length === 1 && adopted[ 0 ].day === 3, 'the stored market is adopted' );
	ok( mooredShown.at( - 1 ).length === 1 && sync.moored.has( 'salty sam' ), "offline captains' boats are handed to RemotePlayers" );
	ok( chat.length === 2 && chat[ 1 ].system, 'the last chat lines are shown once' );
	net.fire( 'event', { kind: 'propRespawned', data: { id: 'dock-3' }, from: 'server', at: 5 } );
	ok( emitted.some( ( [ t, e ] ) => t === 'remoteWorldEvent' && e.kind === 'propRespawned' && e.from === 'server' && ! e.replay ), 'a live event arrives as remoteWorldEvent' );
	net.fire( 'event', { kind: 'boatUnmoored', data: { captain: 'salty sam' }, from: 'server' } );
	ok( ! sync.moored.size && mooredShown.at( - 1 ).length === 0, 'boatUnmoored takes the boat away' );
	net.fire( 'market', { sim: { day: 5 } } );
	ok( adopted.at( - 1 ).day === 5, "a non-host adopts the host's market" );
	net.isHost = true;
	sync.update( 6 );
	ok( markets.length === 1 && markets[ 0 ].day === 9 && typeof marketCb === 'function', 'the host sends its market (onMarketChange subscribed)' );
	sync.update( 6 );
	ok( markets.length === 1, 'an unchanged market is not sent again' );
	const out = sync.decorateState( { p: [ 0, 0, 0 ], plane: { id: 'seaplane' } } );
	ok( out.plane && out.plane.id === 'seaplane', "decorateState keeps other features' fields" );
	sync.dispose();

}

// ---- live server

const SERVER_OPTS = { port: 0, host: '127.0.0.1', universe: 'testverse', data: dataDir, flushMs: 300, saveEveryMs: 300, marketEveryMs: 200, clockEveryMs: 400, log: () => {} };
let srv = startServer( SERVER_OPTS );
let port = await srv.ready;
let URL_U = `ws://127.0.0.1:${ port }/universe`;

try {

	// the health endpoint knows the universe
	const health = await ( await fetch( `http://127.0.0.1:${ port }/health` ) ).json();
	ok( health.universe && health.universe.name === 'testverse' && health.version === 2, 'GET /health reports the universe' );

	// the menu's probe: nobody joins, the stored game (none yet) comes back
	const pr = await probeUniverse( URL_U, 'Mad Meg', { token: TOKEN_A } );
	ok( pr.captain === 'Mad Meg' && pr.exists === false && pr.isNew === true && pr.universe && pr.universe.name === 'testverse', 'probe: a new captain, no stored game' );

	// two captains join
	const A = client( URL_U );
	await A.open;
	A.send( hello( 'Mad Meg', TOKEN_A ) );
	const wa = await A.next( 'welcome' );
	ok( wa.universe && wa.captain === 'Mad Meg' && wa.world && Array.isArray( wa.world.events ) && wa.host === wa.id, 'A joins the universe (and runs the ships)' );
	ok( typeof wa.clock.day === 'number' && wa.clock.seed === wa.universe.seed, 'the universe clock carries the day and the weather seed' );
	const B = client( URL_U );
	await B.open;
	B.send( hello( 'Salty Sam', TOKEN_B ) );
	const wb = await B.next( 'welcome' );
	ok( wb.peers.length === 1 && wb.peers[ 0 ].name === 'Mad Meg', 'B joins and sees A' );
	await A.next( ( m ) => m.t === 'join' && m.peer.name === 'Salty Sam' );

	// the profile: stored, clamped when it cannot be explained
	A.send( { t: 'save', profile: profileOf( 1200 ) } );
	const s1 = await A.next( 'saved' );
	ok( s1.ok && ! s1.fix, 'A\'s game is stored' );
	await sleep( 350 );
	A.send( { t: 'save', profile: profileOf( 9e8 ) } );
	const s2 = await A.next( 'saved' );
	ok( s2.ok && s2.fix && s2.fix.money < 20000, 'an unexplained jump in money is clamped (fix sent back)' );
	A.send( { t: 'save', profile: profileOf( 100 ) } );
	const s3 = await A.next( 'saved' );
	ok( s3.ok === false && s3.reason === 'rate', 'saves are rate limited' );

	// world events: relayed to the others, never echoed; the known kinds persisted
	A.send( { t: 'event', kind: 'propDestroyed', data: { id: 'dock-3', respawn: 600, x: 1, y: 2, z: 3 } } );
	const e1 = await B.next( 'event' );
	ok( e1.kind === 'propDestroyed' && e1.data.id === 'dock-3' && e1.from === wa.id, 'a world event reaches B with the sender id' );
	A.send( { t: 'event', kind: 'waved', data: { at: 'you' } } );
	const e2 = await B.next( 'event' );
	ok( e2.kind === 'waved', 'an unknown kind is relayed too' );
	await sleep( 100 );
	ok( ! A.queue.some( ( m ) => m.t === 'event' ), 'the sender gets no echo' );
	ok( srv.universe.state.events[ 'propDestroyed:dock-3' ] && ! Object.keys( srv.universe.state.events ).some( ( k ) => k.startsWith( 'waved' ) ), 'propDestroyed is persisted, waved is not' );

	// extras (a seaplane's plane) pass through to the others
	A.send( state( { plane: { id: 'seaplane', p: [ 1, 50, 2 ], q: [ 0, 0, 0, 1 ], gear: true } } ) );
	const st = await B.next( ( m ) => m.t === 'states' && m.list.some( ( s ) => s.plane ) );
	ok( st.list[ 0 ].plane.id === 'seaplane' && st.list[ 0 ].plane.p[ 1 ] === 50, 'unknown per-player fields reach the other players' );

	// the market: the host's snapshot is kept and handed to the others
	A.send( { t: 'market', sim: { ports: { harbor: { cod: 1.2 } }, day: 3 } } );
	const mk = await B.next( 'market' );
	ok( mk.sim && mk.sim.day === 3 && srv.universe.state.market.sim.day === 3, 'the host\'s market goes to B and into the universe' );
	B.send( { t: 'market', sim: { hacked: true } } );
	await sleep( 300 );
	ok( srv.universe.state.market.sim.day === 3, 'only the world host may set the market' );

	// pirates: the host's ships are kept
	A.send( { t: 'world', ships: [ { id: 'pirate-1', k: 'sloop', n: 'Black Gull', x: 100, z: - 50, y: 0.5, s: 4, hp: 300, mx: 400, st: 'patrol' } ] } );
	await B.next( 'world' );
	ok( srv.universe.state.ships.length === 1 && srv.universe.state.ships[ 0 ].id === 'pirate-1', 'the pirate ships are kept by the universe' );

	// chat goes into the log
	A.send( { t: 'chat', text: 'ahoy' } );
	await B.next( 'chat' );
	ok( srv.universe.state.chat.at( - 1 ).text === 'ahoy', 'chat lines are kept (last 100)' );

	// name theft: same name, another token
	const C = client( URL_U );
	await C.open;
	C.send( hello( 'mad MEG', TOKEN_C ) );
	const ec = await C.next( 'error' );
	const cc = await C.closedP;
	ok( ec.code === 'name' && cc.code === REFUSAL.name, 'another browser cannot take Mad Meg\'s name (refusal name)' );
	ok( /belongs to another captain/.test( universeError( 'name', ec.text ) ), 'the refusal reads as a sentence' );
	let refused = null;
	try { await probeUniverse( URL_U, 'Mad Meg', { token: TOKEN_C } ); } catch ( e ) { refused = e; }
	ok( refused && refused.code === 'name', 'the menu probe is refused the same way' );

	// oversized frames
	await sleep( 350 );
	const big = JSON.stringify( profileOf( 50, { log: { pad: 'x'.repeat( MAX_SAVE + 4096 ) } } ) );
	A.sendRaw( 'save', big ); // (NetClient.sendSave sends the JSON text like this)
	const so = await A.next( 'saved' );
	ok( so.ok === false && so.reason === 'size', 'a save over 256 KB is refused (and the captain stays connected)' );
	const D = client( URL_U );
	D.send( hello( 'Dora', hex( 'd' ) ) );
	await D.next( 'welcome' );
	D.send( 'x'.repeat( MAX_SAVE * 2 + 10 ) );
	const dc = await D.closedP;
	ok( dc.code === 1009, 'a frame over twice the save limit closes the socket (1009)' );

	// admin console
	ok( /Mad Meg/.test( srv.admin( 'list' ) ) && /Salty Sam/.test( srv.admin( 'captains' ) ), 'admin list / captains' );
	ok( /announced/.test( srv.admin( 'announce Storm tonight' ) ), 'admin announce' );
	const ann = await B.next( ( m ) => m.t === 'chat' && m.system );
	ok( ann.text === 'Storm tonight' && ann.name === 'Server', 'the announcement reaches the chat' );

	// A leaves aboard: the boat stays moored for the others
	A.send( state( { mode: 'boat', boat: { id: 'skiff', p: [ 30, 0.2, 40 ], q: [ 0, 0, 0, 1 ], throttle: 0, steer: 0, rpm: 0, driven: false } } ) );
	await B.next( 'states' );
	A.ws.close();
	const mo = await B.next( ( m ) => m.t === 'event' && m.kind === 'boatMoored' );
	ok( mo.from === 'server' && mo.data.name === 'Mad Meg' && mo.data.boat === 'skiff' && mo.data.p[ 0 ] === 30, 'a captain who leaves aboard leaves a moored boat' );
	const ho = await B.next( 'host' );
	ok( ho.id === wb.id, 'the ships pass to the next captain' );
	const ad = await B.next( ( m ) => m.t === 'world' && m.adopt );
	ok( ad.ships.length === 1 && ad.host === wb.id, 'the new host is handed the stored ships to simulate' );

	// ban
	ok( /banned Salty Sam/.test( srv.admin( 'ban Salty Sam spamming' ) ), 'admin ban' );
	const bc = await B.closedP;
	ok( bc.code === REFUSAL.banned, 'the banned captain is disconnected (close 4107)' );
	let bannedErr = null;
	try { await probeUniverse( URL_U, 'Salty Sam', { token: TOKEN_B } ); } catch ( e ) { bannedErr = e; }
	ok( bannedErr && bannedErr.code === 'banned', 'and cannot come back' );
	ok( /unbanned/.test( srv.admin( 'unban Salty Sam' ) ), 'admin unban' );

	// the browser's own client: NetClient + UniverseSession (a GameState whose storage is the server)
	const mem = new Map();
	const localStore = { getItem: ( k ) => mem.get( k ) ?? null, setItem: ( k, v ) => mem.set( k, v ), removeItem: ( k ) => mem.delete( k ) };
	const app = { game: { state: new GameState( localStore ) } };
	const pe = await probeUniverse( URL_U, 'Bilge Bob', { token: hex( 'e' ) } );
	const session = new UniverseSession( { url: URL_U, captain: pe.captain, profile: pe.profile, info: pe.universe } ).attach( app );
	const gs = app.game.state;
	gs.useSlot( 0, 'multiplayer' );
	gs.reset();
	gs.name = pe.captain;
	gs.earn( 300 );
	ok( app.universe === session && session.pending && mem.size === 0, 'attached: GameState saves go to the session, not the local slots' );
	const events = [];
	const net = new NetClient( { url: URL_U, name: pe.captain, character: 'hyptile', token: hex( 'e' ) } );
	net.on( 'event', ( m ) => events.push( m ) );
	session.bind( net );
	net.connect();
	for ( let i = 0; i < 40 && ! net.online; i ++ ) await sleep( 50 );
	ok( net.online && net.universe && net.universeInfo && net.universeInfo.name === 'testverse' && net.captain === 'Bilge Bob', 'NetClient joins the universe with the token' );
	ok( net.world && net.world.events.some( ( e ) => e.kind === 'propDestroyed' && e.data.id === 'dock-3' ), 'the welcome replays the stored world events' );
	ok( net.world.boats.some( ( b ) => b.name === 'Mad Meg' ), 'the welcome lists the offline captains\' moored boats' );
	for ( let i = 0; i < 40 && ! session.stats.acked; i ++ ) await sleep( 50 );
	ok( session.stats.acked >= 1 && srv.universe.loadProfile( captainKey( 'Bilge Bob' ) ).money === 300, 'the session sends the game and the server stores it' );
	ok( net.sendEvent( 'bountyClaimed', { id: 'b-42', reward: 500 } ), 'NetClient.sendEvent' );
	await sleep( 200 );
	ok( srv.universe.state.events[ 'bountyClaimed:b-42' ], 'a claimed bounty is persisted' );
	session.detach();
	net.disconnect();
	ok( gs.storage === localStore && ! app.universe, 'detach gives the state its local storage back' );
	await sleep( 100 );
	ok( /released Bilge Bob/.test( srv.admin( 'release Bilge Bob' ) ), 'admin release frees a name whose browser was lost' );
	const pf = await probeUniverse( URL_U, 'Bilge Bob', { token: hex( 'f' ) } );
	let oldTok = null;
	try { await probeUniverse( URL_U, 'Bilge Bob', { token: hex( 'e' ) } ); } catch ( e ) { oldTok = e; }
	ok( pf.exists && pf.profile.money === 300 && oldTok && oldTok.code === 'name', 'the next browser owns the name and its game; the old token is out' );

	// restart: everything that matters is still there
	await srv.close();
	ok( existsSync( join( dataDir, 'universe.json' ) ) && JSON.parse( readFileSync( join( dataDir, 'universe.json' ), 'utf8' ) ).schema === SCHEMA, 'universe.json written with its schema version' );
	ok( readdirSync( join( dataDir, 'profiles' ) ).filter( ( f ) => f.endsWith( '.json' ) ).length === 2, 'one profile file per captain with a save' );
	ok( existsSync( join( dataDir, 'backups' ) ) && readdirSync( join( dataDir, 'backups' ) ).length >= 1, 'a daily backup exists' );
	ok( ! readdirSync( dataDir ).some( ( f ) => f.endsWith( '.tmp' ) ), 'no half-written files' );
	srv = startServer( SERVER_OPTS );
	port = await srv.ready;
	URL_U = `ws://127.0.0.1:${ port }/universe`;
	const pr2 = await probeUniverse( URL_U, 'Mad Meg', { token: TOKEN_A } );
	ok( pr2.exists && pr2.profile && pr2.profile.money === s2.fix.money && pr2.profile.name === 'Mad Meg', 'after a restart A\'s (clamped) game comes back' );
	const E = client( URL_U );
	await E.open;
	E.send( hello( 'Salty Sam', TOKEN_B ) );
	const we = await E.next( 'welcome' );
	ok( we.world.events.some( ( e ) => e.kind === 'propDestroyed' && e.data.id === 'dock-3' ), 'after a restart the destroyed dock is still destroyed' );
	ok( we.world.boats.some( ( b ) => b.name === 'Mad Meg' ) && we.world.market && we.world.market.day === 3, 'and the moored boat and the market are back' );
	ok( we.world.chat.some( ( c ) => c.text === 'Storm tonight' ), 'and the chat log' );
	const ad2 = await E.next( ( m ) => m.t === 'world' && m.adopt );
	ok( ad2.ships[ 0 ].id === 'pirate-1', 'and the first captain online takes over the stored pirates' );
	E.send( hello( 'Salty Sam', TOKEN_B ) ); // (a second hello is a profile update, not a rejoin)
	E.ws.close();
	await E.closedP;
	// A comes back: its moored boat is taken off the moorings
	const A2 = client( URL_U );
	await A2.open;
	A2.send( hello( 'Mad Meg', TOKEN_A ) );
	await A2.next( 'welcome' );
	await sleep( 50 );
	ok( ! srv.universe.state.moored[ captainKey( 'Mad Meg' ) ], 'a returning captain unmoors the boat' );
	const V1 = client( URL_U );
	await V1.open;
	V1.send( { t: 'hello', v: 1, name: 'Old Client' } );
	const ev1 = await V1.next( 'error' );
	ok( ev1.code === 'version', 'a protocol 1 client is told to update' );
	A2.ws.close();

	// the plain island room still works next to the universe
	const I = client( `ws://127.0.0.1:${ port }/island` );
	await I.open;
	I.send( { t: 'hello', v: 1, name: 'Islander' } );
	const wi = await I.next( 'welcome' );
	ok( wi.room === 'island' && ! wi.universe, 'the island room still serves protocol 1 clients' );
	I.ws.close();

} catch ( e ) {

	fails ++;
	console.log( 'FAIL exception', e && e.stack ? e.stack : e );

}

// ---- wave 15: the shared universe

{

	const { DEFAULT_UNIVERSE, SHARED_UNIVERSE, BUILD_HASH, defaultUniverseAddress, isDefaultUniverse, buildsDiffer, universeHealthUrl, probeHealth, healthText, UPDATING_TEXT } = UniverseW15;
	const explicitUniverse = 'wss://alpha-astra.example.test/universe'; // mock health endpoint, never a real fetch
	ok( DEFAULT_UNIVERSE === SHARED_UNIVERSE && DEFAULT_UNIVERSE === '' && BUILD_HASH === 'dev', 'the separate alpha has no implicit shared server (no VITE_UNIVERSE_URL here; no build hash outside vite)' );
	ok( normalizeUniverseUrl( DEFAULT_UNIVERSE, { protocol: 'https:' } ) === null && ! isUniverseUrl( DEFAULT_UNIVERSE ) && ! isDefaultUniverse( 'hyptile-universe.fly.dev' ), 'an unconfigured alpha never treats the original Fly universe as its default' );
	ok( defaultUniverseAddress( { hostname: 'jeffreyepsteel.github.io', protocol: 'https:' } ) === '' && defaultUniverseAddress( null ) === '', 'the Pages site and no page offer no unconfigured public universe' );
	ok( defaultUniverseAddress( { hostname: '192.168.1.20', protocol: 'http:' } ) === '192.168.1.20:8875', 'a game page a PC serves over http offers that PC\'s separate alpha universe' );
	const { normalizeServerUrl } = await import( '../src/net/NetClient.js' );
	ok( normalizeServerUrl( explicitUniverse ) === explicitUniverse && normalizeServerUrl( 'ws://h/island' ) === 'ws://h:8875/island', '?server=wss://... keeps port 443; plain ws gets the separate alpha port' );
	ok( universeHealthUrl( DEFAULT_UNIVERSE ) === null && universeHealthUrl( explicitUniverse ) === 'https://alpha-astra.example.test/health' && universeHealthUrl( 'ws://h:9000/net/universe' ) === 'http://h:9000/net/health', 'unconfigured health has no target; explicit health keeps TLS and proxy paths' );
	ok( buildsDiffer( 'abc1234', 'def5678' ) && ! buildsDiffer( 'abc1234', 'abc1234def' ) && ! buildsDiffer( 'dev', 'abc1234' ) && ! buildsDiffer( 'abc1234', '' ), 'builds differ only when both are known commits (a short hash matches its long one)' );
	ok( universeError( 'updating', '', explicitUniverse ) === UPDATING_TEXT && /updating, try again in a minute/.test( UPDATING_TEXT ), 'an explicit updating status keeps the readable retry sentence' );
	ok( /another version/.test( universeError( 'version', '', 'ws://friend:8765/universe' ) ), 'a friend\'s server still says it runs another version' );
	ok( /No universe server answers/.test( universeError( 'down', '', explicitUniverse ) ), 'an explicit server down has a readable address-specific sentence' );
	const fake = ( body, status = 200 ) => async () => ( { ok: status === 200, status, json: async () => body } );
	const hp1 = await probeHealth( explicitUniverse, { build: 'abc1234', fetchImpl: fake( { ok: true, version: 2, build: 'abc1234', universe: { name: 'hyptile', players: 3, cap: 24, captains: 40 } } ) } );
	ok( hp1.online && hp1.players === 3 && ! hp1.updating && healthText( hp1 ) === 'Online · 3 captains aboard (of 24)', `the panel's line: "${ healthText( hp1 ) }"` );
	const hp2 = await probeHealth( explicitUniverse, { build: 'abc1234', fetchImpl: fake( { ok: true, version: 2, build: 'fff0000', universe: { name: 'hyptile', players: 0, cap: 24 } } ) } );
	ok( hp2.online && hp2.updating && /Updating/.test( healthText( hp2 ) ), 'another commit on the server: "Updating"' );
	const hp3 = await probeHealth( explicitUniverse, { fetchImpl: async () => { throw new TypeError( 'fetch failed' ); } } );
	ok( ! hp3.online && hp3.code === 'down' && /^Offline · /.test( healthText( hp3 ) ), `no answer: "${ healthText( hp3 ) }"` );
	const hp4 = await probeHealth( 'ws://h:8765/universe', { fetchImpl: fake( { ok: true, version: 2, rooms: {} } ) } );
	ok( ! hp4.online && hp4.code === 'nouniverse', 'a server without a universe says so' );

}

try {

	// the fort, /health's build and the admin routes on a fresh universe
	await srv.close();
	const dir15 = join( root, 'w15' );
	const ADMIN = 'sesame-' + hex( '9' );
	const OPTS15 = { ...SERVER_OPTS, universe: 'w15', data: dir15, build: 'abc1234def', adminToken: ADMIN };
	srv = startServer( OPTS15 );
	port = await srv.ready;
	const U15 = `ws://127.0.0.1:${ port }/universe`;
	const h15 = await ( await fetch( `http://127.0.0.1:${ port }/health` ) ).json();
	ok( h15.build === 'abc1234def' && h15.version === 2 && h15.universe.name === 'w15', '/health carries the deployed commit (build) next to the protocol version' );
	const hpLive = await UniverseW15.probeHealth( U15, { build: 'abc1234' } );
	ok( hpLive.online && ! hpLive.updating && hpLive.cap > 0, 'probeHealth against the real server: online, same commit' );
	const hpOld = await UniverseW15.probeHealth( U15, { build: '1111111' } );
	ok( hpOld.online && hpOld.updating, 'and "updating" for a page of another commit' );

	// admin routes: none without the token, 401 with a wrong one, answers with the right one
	const adm = ( path, method = 'GET', token = ADMIN, body ) => fetch( `http://127.0.0.1:${ port }${ path }`, { method, headers: { ...( token ? { authorization: `Bearer ${ token }` } : {} ), ...( body ? { 'content-type': 'application/json' } : {} ) }, body: body ? JSON.stringify( body ) : undefined } );
	const r401 = await adm( '/admin/stats', 'GET', 'wrong' );
	const r401b = await adm( '/admin/save', 'POST', null );
	ok( r401.status === 401 && r401b.status === 401, 'an admin route refuses a wrong or missing token' );
	const st = await ( await adm( '/admin/stats' ) ).json();
	ok( st.ok && st.universe && st.universe.name === 'w15' && Array.isArray( st.online ) && st.data && st.data.dir, 'GET /admin/stats with the token' );
	const sv = await ( await adm( '/admin/save', 'POST' ) ).json();
	ok( sv.ok && /saved to/.test( sv.answer ) && existsSync( join( dir15, 'universe.json' ) ), 'POST /admin/save writes the universe' );
	const cm = await ( await adm( '/admin/command', 'POST', ADMIN, { line: 'captains' } ) ).json();
	const cmStop = await ( await adm( '/admin/command', 'POST', ADMIN, { line: 'stop' } ) ).json();
	ok( cm.ok && cm.answer === 'no captains yet' && /not an HTTP command/.test( cmStop.answer ), 'POST /admin/command runs a console command (but not stop)' );

	// the stronghold: the host's snapshot, a claim, the host's clock; all of it in universe.json
	const H = client( U15 ), G = client( U15 );
	H.send( hello( 'Fort Host', TOKEN_A ) );
	const wh = await H.next( 'welcome' );
	G.send( hello( 'Fort Guest', TOKEN_B ) );
	await G.next( 'welcome' );
	ok( wh.id && wh.host === wh.id, 'the first captain hosts the stronghold' );
	const snap = ( extra = {} ) => ( { t: 'fort', op: 'set', holder: 'pirates', claimedAt: - 1, until: - 1, alarm: 'calm', why: '', guards: 0, shipsDown: 3, castOff: 0, open: true, seen: 0,
		batteries: [ { id: 'seaward', silenced: true, why: 'cannon', platform: true, powder: false }, { id: 'channel', silenced: false, why: '', platform: false, powder: true } ], ...extra } );
	H.send( snap() );
	await sleep( 150 );
	G.send( { t: 'fort', op: 'claim' } );
	const gc = await G.next( 'fortClaim' );
	ok( gc.ok && gc.claims === 1, 'the guest claims the undefended island' );
	H.send( snap( { holder: 'player', claimedAt: 100, until: 196, seen: 1, open: false, alarm: 'alarm', why: 'cannon' } ) );
	await sleep( 600 ); // (a flush)
	const disk = JSON.parse( readFileSync( join( dir15, 'universe.json' ), 'utf8' ) );
	ok( disk.fort && disk.fort.holder === 'player' && disk.fort.byName === 'Fort Guest' && disk.fort.claims === 1 && disk.fort.claimedAt === 100 && disk.fort.batteries.seaward.silenced && disk.fort.by === undefined, 'universe.json keeps the fort like the moored boats (holder, claimant\'s name, claim, game hours, batteries; no session id)' );
	H.ws.close();
	G.ws.close();
	await sleep( 100 );
	await srv.close();

	srv = startServer( OPTS15 );
	port = await srv.ready;
	const U15b = `ws://127.0.0.1:${ port }/universe`;
	const R = client( U15b );
	R.send( hello( 'Fort Host', TOKEN_A ) );
	const wr = await R.next( 'welcome' );
	await sleep( 100 );
	const f = R.link.room.state.fort;
	ok( f.holder === 'player' && f.byName === 'Fort Guest' && f.by === '' && f.claims === 1 && f.claimedAt === 100 && f.until === 196 && f.seq > 0, 'after a restart Blackwater is still the claimant\'s (by name; the session id is gone)' );
	ok( f.alarm === 'calm' && f.batteries.get( 'seaward' ).silenced && f.batteries.get( 'seaward' ).platform && f.batteries.get( 'channel' ).powder && f.shipsDown === 3, 'its batteries, platforms, powder stores and sunk ships too; the watch starts calm' );
	ok( wr.host === wr.id, 'the returning captain hosts' );
	R.send( snap( { seen: 0 } ) ); // a fresh host that has not seen the stored claim cannot hand the island back
	await sleep( 200 );
	ok( R.link.room.state.fort.holder === 'player', 'a new host\'s snapshot that has not seen the stored claim leaves it standing' );
	R.send( snap( { holder: 'player', claimedAt: 100, until: 196, seen: 1, open: false } ) );
	await sleep( 200 );
	ok( R.link.room.state.fort.holder === 'player' && R.link.room.state.fort.claims === 1, 'the host adopts it and carries on' );
	R.ws.close();
	await sleep( 100 );

	// without a token the admin routes do not exist
	await srv.close();
	srv = startServer( { ...OPTS15, adminToken: null } );
	port = await srv.ready;
	const r404 = await fetch( `http://127.0.0.1:${ port }/admin/stats`, { headers: { authorization: `Bearer ${ ADMIN }` } } );
	ok( r404.status === 404, 'no ADMIN_TOKEN: the admin routes answer 404' );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL exception (wave 15)', e && e.stack ? e.stack : e );

}

await srv.close();
clearTimeout( watchdog );
try { rmSync( root, { recursive: true, force: true } ); } catch ( e ) { /* a locked file on Windows: the OS cleans the temp dir */ }
console.log( fails ? `\n${ fails } FAILED` : '\nall universe tests passed' );
process.exit( fails ? 1 : 0 );
