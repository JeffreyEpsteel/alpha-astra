// Plain-node test of the wave 11 room rules (server/rooms.mjs, server/schema.mjs, src/net/Protocol.js): the host's hull
// 'bump' reaches the struck boat's owner and nobody else (never from a guest, never far from that boat), the schema's wreck
// entries (added / updated / removed by their owner only, capped, kept over a reconnect, dropped when the owner leaves, listed
// by the admin console), and the fire rates (cannon volleys per side, gunshots per weapon, ship balls only from the host).
//   node test/server-w11.mjs
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { PROTOCOL_VERSION, FireGate, CANNON_GATE, GUN_GATE, sanitizeWreck, sanitizeBump, sanitizeFx, MAX_WRECKS_PER_PLAYER } from '../src/net/Protocol.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const watchdog = setTimeout( () => { console.log( 'FAIL timeout: the test did not finish in 60 s' ); process.exit( 1 ); }, 60000 );
const until = async ( pred, ms = 3000 ) => {

	const t0 = Date.now();
	while ( Date.now() - t0 < ms ) {

		if ( pred() ) return true;
		await sleep( 25 );

	}

	return !! pred();

};
const walk = ( x, z, extra = {} ) => ( { t: 'state', p: [ x, 0, z ], yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, action: null, character: 'pepe', boat: null, ...extra } );
const aboard = ( x, z ) => walk( x, z, { mode: 'boat', boat: { id: 'skiff', p: [ x, 0.2, z ], q: [ 0, 0, 0, 1 ], throttle: 0, steer: 0, rpm: 0, driven: true } } );
const hello = ( name ) => ( { t: 'hello', v: PROTOCOL_VERSION, name, character: 'pepe', boat: 'skiff' } );

// ---- pure parts
{

	const g = new FireGate();
	let n = 0;
	for ( let i = 0; i < 10; i ++ ) if ( g.volley( 'p', 1000 + i * 50, CANNON_GATE ) ) n ++;
	ok( n === CANNON_GATE.perVolley, `a battery side: ${ n } balls of a 10-ball burst pass (perVolley ${ CANNON_GATE.perVolley })` );
	ok( ! g.volley( 'p', 1000 + CANNON_GATE.reload * 1000 - 10, CANNON_GATE ) && g.volley( 'p', 1000 + CANNON_GATE.reload * 1000 + 10, CANNON_GATE ), 'the next volley waits for the reload' );
	ok( g.volley( 's', 1100, CANNON_GATE ), 'the other side has its own reload' );
	ok( g.single( 'pistol', 0, 1.4 * GUN_GATE ) && ! g.single( 'pistol', 1000, 1.4 * GUN_GATE ) && g.single( 'pistol', 1200, 1.4 * GUN_GATE ), 'a flintlock: one shot per reload (with the jitter allowance)' );
	g.prune( 1e9, 1000 );
	ok( g.keys.size === 0, 'idle keys are pruned' );
	ok( sanitizeWreck( { op: 'add', id: 'a b', kind: 'boat', model: 'skiff', x: 0, y: 0, z: 0 } ) === null && sanitizeWreck( { op: 'add', id: 'w', kind: 'boat', model: 'nope', x: 0, y: 0, z: 0 } ) === null
		&& sanitizeWreck( { op: 'add', id: 'w', kind: 'ufo', model: 'skiff', x: 0, y: 0, z: 0 } ) === null && sanitizeWreck( { op: 'add', id: 'w', kind: 'boat', model: 'skiff', x: NaN, y: 0, z: 0 } ) === null, 'sanitizeWreck refuses bad ids, models, kinds and positions' );
	const sw = sanitizeWreck( { op: 'add', id: 'plane', kind: 'plane', model: 'seaplane', x: 1.234, y: - 2, z: 3, yaw: 7, parts: 0x1ffff } );
	ok( sw && sw.parts === 0xffff && Math.abs( sw.yaw - ( 7 - 2 * Math.PI ) ) < 1e-3 && sw.x === 1.23, 'sanitizeWreck: angles wrapped, parts 16 bits, cm' );
	const sb = sanitizeBump( { to: 'abc', j: [ 1e9, 0 ], p: [ 1, 2 ], dmg: 1e9 } );
	ok( sanitizeBump( { to: 'abc', j: [ 1e9, 0 ], p: [ 1, 2 ] } ) === null && sanitizeBump( { to: 'abc', j: [ 1, 0 ], p: [ 1, 2 ], dmg: 1e9 } ).dmg === 2000 && sb === null, 'sanitizeBump: impulse bound, damage clamped' );
	const fx = sanitizeFx( { kind: 'shot', from: [ 1, 2, 3 ], dir: [ 0, 0, 1 ], sd: 'port', c: 'doge' } ), ram = sanitizeFx( { kind: 'ram', x: 1, z: 2, v: 99 } );
	ok( fx.sd === 'port' && fx.c === 'doge' && ram && ram.v === 60 && sanitizeFx( { kind: 'shot', from: [ 1, 2, 3 ], dir: [ 0, 0, 1 ], sd: 'up', c: 'a b' } ).sd === '', 'sanitizeFx: shot side / crew, ram speed' );

}

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, reconnectSeconds: 3 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
const live = [];
const join = async ( name ) => {

	const c = wireClient( `${ base }/island` );
	live.push( c );
	c.send( hello( name ) );
	const w = await c.next( 'welcome' );
	return { c, id: w.id };

};

try {

	const { c: A, id: aId } = await join( 'Ann' );
	const { c: B, id: bId } = await join( 'Bob' );
	const { c: C, id: cId } = await join( 'Cat' );
	const room = srv.rooms.get( 'island' );
	ok( room.state.host === aId, 'the first player is the host' );
	A.send( aboard( 0, 0 ) );
	B.send( aboard( 10, 0 ) );
	C.send( aboard( 200, 0 ) );
	await until( () => [ aId, bId, cId ].every( ( id ) => room.order.get( id ).lastState ), 2000 );

	// ---- bumps
	A.send( { t: 'bump', to: bId, j: [ 900, - 20 ], p: [ 10.6, 0.4 ], dmg: 3.5, v: 2.4, by: aId, f: [ 9, 0 ] } );
	const bu = await B.next( 'bump' );
	ok( bu.from === aId && bu.j[ 0 ] === 900 && bu.dmg === 3.5 && bu.v === 2.4 && bu.f[ 0 ] === 9, 'the host\'s bump reaches the struck boat\'s owner (impulse, damage, speed, where from)' );
	B.send( { t: 'bump', to: cId, j: [ 900, 0 ], p: [ 200, 0 ], dmg: 50 } ); // a guest cannot hurt anybody this way
	A.send( { t: 'bump', to: cId, j: [ 900, 0 ], p: [ 10, 0 ], dmg: 50 } ); // nowhere near Cat's boat
	A.send( { t: 'bump', to: 'nobody', j: [ 1, 0 ], p: [ 0, 0 ] } );
	await sleep( 400 );
	ok( ! C.queue.some( ( m ) => m.t === 'bump' ) && ! A.queue.some( ( m ) => m.t === 'bump' ) && ! B.queue.some( ( m ) => m.t === 'bump' ), 'nobody else gets it; a guest\'s bump and one far from the target boat are dropped' );
	for ( let i = 0; i < 20; i ++ ) A.send( { t: 'bump', to: bId, j: [ 10, 0 ], p: [ 10, 0 ] } );
	await sleep( 400 );
	const flood = B.drain( ( m ) => m.t === 'bump' ).length;
	ok( flood <= 10 && flood >= 5, `bumps to one boat are capped (${ flood } of 20 in a burst)` );

	// ---- wrecks
	const W = () => room.state.wrecks;
	const seenBy = ( c, key ) => { const st = c.link.room && c.link.room.state; return st && st.wrecks && st.wrecks.get( key ); };
	B.send( { t: 'wreck', op: 'add', id: 'w1', kind: 'boat', model: 'skiff', x: 5, y: - 3, z: 5, yaw: 0.3, pitch: - 0.09, roll: 0.62 } );
	ok( await until( () => seenBy( A, bId + ':w1' ) && seenBy( C, bId + ':w1' ) ), 'a wreck entry reaches everybody\'s state under <owner>:<id>' );
	const e1 = seenBy( C, bId + ':w1' );
	ok( e1.owner === bId && e1.kind === 'boat' && e1.model === 'skiff' && Math.abs( e1.roll - 0.62 ) < 1e-3 && e1.t > 0, 'the entry: owner, kind, model, pose, server time' );
	const t0 = W().get( bId + ':w1' ).t;
	B.send( { t: 'wreck', op: 'add', id: 'w1', kind: 'boat', model: 'skiff', x: 7, y: - 3, z: 5 } );
	ok( await until( () => Math.abs( seenBy( A, bId + ':w1' ).x - 7 ) < 1e-3 ) && W().get( bId + ':w1' ).t === t0, 'an update moves it and keeps its time' );
	C.send( { t: 'wreck', op: 'del', id: 'w1' } );
	B.send( { t: 'wreck', op: 'add', id: 'bad', kind: 'boat', model: 'nope', x: 0, y: 0, z: 0 } );
	B.send( { t: 'wreck', op: 'add', id: 'w 2', kind: 'boat', model: 'skiff', x: 0, y: 0, z: 0 } );
	await sleep( 300 );
	ok( W().has( bId + ':w1' ) && W().size === 1, 'another player cannot remove it; malformed entries are refused' );
	for ( let i = 2; i <= 6; i ++ ) B.send( { t: 'wreck', op: 'add', id: 'w' + i, kind: 'plane', model: 'seaplane', x: i, y: 0, z: 0, parts: i } );
	await sleep( 300 );
	let mine = 0;
	W().forEach( ( e ) => { if ( e.owner === bId ) mine ++; } );
	ok( mine === MAX_WRECKS_PER_PLAYER, `at most ${ MAX_WRECKS_PER_PLAYER } entries per player (${ mine })` );
	ok( /island\s+\S+:w1\s+boat\s+skiff/.test( srv.admin( 'wrecks' ) ) && /wrecks/.test( srv.admin( 'help' ) ), 'the admin console lists the wrecks' );
	await sleep( 1000 ); // (8 wreck messages a second at most: a client sends one per wreck every 0.5 s)
	B.send( { t: 'wreck', op: 'del', id: 'w1' } );
	ok( await until( () => ! seenBy( A, bId + ':w1' ) && ! W().has( bId + ':w1' ) ), 'the owner removes it (salvaged / recovered)' );
	// a dropped owner keeps them over the reconnect; a leave takes them
	C.send( { t: 'wreck', op: 'add', id: 'sinking', kind: 'sinking', model: 'skiff', x: 200, y: 0, z: 0 } );
	await until( () => W().has( cId + ':sinking' ) );
	await sleep( 1100 ); // (the SDK reconnects rooms that were up for its minUptime)
	C.drop( true );
	ok( await until( () => room.order.get( cId ).dropped, 2000 ), 'Cat drops (seat kept)' );
	ok( W().has( cId + ':sinking' ), 'a dropped owner\'s wreck stays' );
	ok( await until( () => ! room.order.get( cId ).dropped, 6000 ) && W().has( cId + ':sinking' ) && !! seenBy( C, cId + ':sinking' ), 'reconnected: the entry is still there, in her own state too' );
	B.close();
	ok( await until( () => { let n = 0; W().forEach( ( e ) => { if ( e.owner === bId ) n ++; } ); return n === 0; } ), 'a player who leaves for good takes his wrecks along' );
	ok( await until( () => { const st = A.link.room.state; let n = 0; st.wrecks.forEach( ( e ) => { if ( e.owner === bId ) n ++; } ); return n === 0; } ), '...on everybody\'s state' );
	const { c: B2, id: b2Id } = await join( 'Bob' );
	B2.send( aboard( 10, 0 ) );
	await sleep( 300 );

	// ---- fire rates
	const shot = ( extra = {} ) => ( { t: 'fx', kind: 'shot', from: [ 10, 1, 0 ], dir: [ 1, 0, 0 ], v: 120, d: 0, o: 'player', big: false, sd: 'port', ...extra } );
	A.drain( () => true );
	for ( let i = 0; i < 10; i ++ ) B2.send( shot() );
	B2.send( shot( { sd: 'starboard' } ) );
	B2.send( shot( { o: 'sloop-1', d: 30, sd: 'port' } ) ); // a guest's 'ship' ball
	await sleep( 500 );
	const got = A.drain( ( m ) => m.t === 'fx' && m.kind === 'shot' );
	ok( got.filter( ( m ) => m.sd === 'port' ).length === CANNON_GATE.perVolley && got.filter( ( m ) => m.sd === 'starboard' ).length === 1, `a side fires one volley of at most ${ CANNON_GATE.perVolley } balls per reload; the other side its own` );
	ok( ! got.some( ( m ) => m.o !== 'player' ), 'only the host fires balls that are not a player\'s' );
	await sleep( 850 ); // (past the volley's ripple, inside its reload)
	B2.send( shot( { d: 40, sd: 'starboard' } ) );
	await sleep( 300 );
	ok( ! A.drain( ( m ) => m.t === 'fx' && m.kind === 'shot' ).length, 'after its volley the starboard side is reloading (a ball now is dropped)' );
	A.send( shot( { o: 'sloop-1', d: 26, sd: 'starboard', from: [ 0, 2, 0 ] } ) );
	const hs = await B2.next( ( m ) => m.t === 'fx' && m.o === 'sloop-1' );
	ok( hs.d === 26, 'the host\'s pirate ball keeps its damage' );
	B2.send( { t: 'fx', kind: 'ram', x: 1, y: 1, z: 1, v: 5 } );
	A.send( { t: 'fx', kind: 'ram', x: 2, y: 1, z: 2, v: 5 } );
	const rm = await B2.next( ( m ) => m.t === 'fx' && m.kind === 'ram' );
	await sleep( 200 );
	ok( rm.x === 2 && ! A.queue.some( ( m ) => m.t === 'fx' && m.kind === 'ram' ), 'the ram effect comes from the host only' );
	const gun = ( weapon ) => ( { t: 'event', kind: 'gunshot', data: { weapon, x: 10, y: 1.4, z: 0, dx: 1, dy: 0, dz: 0, hit: null } } );
	for ( let i = 0; i < 5; i ++ ) B2.send( gun( 'pistol' ) );
	B2.send( gun( 'musket' ) );
	B2.send( gun( 'cannon' ) );
	await sleep( 400 );
	let shots = A.drain( ( m ) => m.t === 'event' && m.kind === 'gunshot' );
	ok( shots.filter( ( m ) => m.data.weapon === 'pistol' ).length === 1 && shots.filter( ( m ) => m.data.weapon === 'musket' ).length === 1 && shots.length === 2, 'gunshots: one per weapon per reload; an unknown weapon is dropped' );
	await sleep( 1000 ); // (1.4 s x 0.8 since the first)
	B2.send( gun( 'pistol' ) );
	await sleep( 300 );
	shots = A.drain( ( m ) => m.t === 'event' && m.kind === 'gunshot' );
	ok( shots.length === 1, 'the reloaded pistol fires again' );
	ok( b2Id && b2Id !== bId, 'a rejoin is a new player' );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of live ) try { c.close(); } catch ( e ) { /* closed */ }
await srv.close();
clearTimeout( watchdog );
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\nserver-w11: all checks passed' );
process.exit( 0 );
