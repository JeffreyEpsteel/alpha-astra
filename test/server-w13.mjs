// Plain-node test of the wave 13 room rules (server/rooms.mjs, server/schema.mjs, server/universe.mjs, src/net/Protocol.js):
// the schema's plane entries (a stray, a parked airframe: set / moved / removed by their owner only, capped, rate-limited,
// kept over a reconnect, gone when the owner leaves, listed by the admin console), the stronghold (`fort`: only the host's
// snapshot is written, a guest's hostile act reaches the host alone, a claim is granted once and only when the host says the
// island is undefended, a host snapshot older than the claim cannot undo it, the retake), 'ask' to the host alone, the prop
// events' own budget and the universe's batched respawns (the expiry names the port).
//   node test/server-w13.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { Universe } from '../server/universe.mjs';
import { readFort } from '../server/schema.mjs';
import { PROTOCOL_VERSION, sanitizePlane, sanitizeFort, sanitizeAsk, MAX_PLANES_PER_PLAYER } from '../src/net/Protocol.js';

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
const hello = ( name, extra = {} ) => ( { t: 'hello', v: PROTOCOL_VERSION, name, character: 'pepe', boat: 'skiff', ...extra } );
const plane = ( id, kind, x, extra = {} ) => ( { t: 'plane', op: 'set', id, kind, af: 'kestrel', liv: 2, up: '1000000013', p: [ x, 60, 10 ], q: [ 0, 0, 0, 1 ], thr: 0.8, ...extra } );
const snap = ( extra = {} ) => ( {
	t: 'fort', op: 'set', holder: 'pirates', claimedAt: - 1, until: - 1, alarm: 'calm', why: '', guards: 3, shipsDown: 0, castOff: 0, open: false, seen: 0,
	batteries: [ { id: 'seaward', silenced: false, why: '', platform: false, powder: false }, { id: 'channel', silenced: false, why: '', platform: false, powder: false } ], ...extra,
} );

// ---- pure parts
{

	const p = sanitizePlane( { op: 'set', id: 'stray', kind: 'stray', af: 'jade', liv: 99, up: '12x', p: [ 1.234, 2, 3 ], q: [ 0, 0, 0, 2 ], thr: 9 } );
	ok( p && p.liv === 15 && p.up === '' && p.p[ 0 ] === 1.23 && p.q[ 3 ] === 1 && p.thr === 2, 'sanitizePlane: livery capped, a bad upgrade code dropped, cm, the quaternion normalised, the throttle clamped' );
	ok( sanitizePlane( { op: 'set', id: 'a b', kind: 'stray', af: 'jade', p: [ 0, 0, 0 ], q: [ 0, 0, 0, 1 ] } ) === null && sanitizePlane( { op: 'set', id: 's', kind: 'ufo', af: 'jade', p: [ 0, 0, 0 ], q: [ 0, 0, 0, 1 ] } ) === null
		&& sanitizePlane( { op: 'set', id: 's', kind: 'parked', af: 'Jade!', p: [ 0, 0, 0 ], q: [ 0, 0, 0, 1 ] } ) === null && sanitizePlane( { op: 'set', id: 's', kind: 'parked', af: 'jade', p: [ 0, NaN, 0 ], q: [ 0, 0, 0, 1 ] } ) === null
		&& sanitizePlane( { op: 'set', id: 's', kind: 'parked', af: 'jade', p: [ 0, 0, 0 ], q: [ 0, 0, 0, 0 ] } ) === null, 'sanitizePlane refuses bad ids, kinds, airframes, positions and a zero quaternion' );
	ok( sanitizePlane( { op: 'del', id: 'stray' } ).op === 'del', 'sanitizePlane: a removal' );
	const f = sanitizeFort( { op: 'set', holder: 'pirates', alarm: 'alarm', why: 'no good!', guards: 99, shipsDown: 7, batteries: [ { id: 'seaward', silenced: true, why: 'platform', platform: true }, { id: 'seaward' }, { id: '' } ] } );
	ok( f && f.why === '' && f.guards === 30 && f.shipsDown === 7 && f.batteries.length === 1 && f.batteries[ 0 ].silenced && f.batteries[ 0 ].platform && ! f.batteries[ 0 ].powder, 'sanitizeFort: words checked, numbers clamped, one entry per battery' );
	ok( sanitizeFort( { op: 'set', holder: 'navy', alarm: 'calm' } ) === null && sanitizeFort( { op: 'set', holder: 'pirates', alarm: 'panic' } ) === null && sanitizeFort( { op: 'act', act: 'nuke' } ) === null
		&& sanitizeFort( { op: 'act', act: 'raise', why: 'cannon' } ).why === 'cannon' && sanitizeFort( { op: 'claim', loot: 1e9 } ).loot === undefined, 'sanitizeFort: holders, alarms and acts are whitelisted; a claim carries nothing' );
	ok( sanitizeAsk( { kind: 'raid', data: { port: 'tidemark' } } ).data.port === 'tidemark' && sanitizeAsk( { kind: '1x' } ) === null, 'sanitizeAsk: a world-event shape' );
	// the universe's expiry of a broken prop names its port
	const dir = mkdtempSync( join( tmpdir(), 'hyptile-w13-' ) );
	try {

		const u = new Universe( { name: 'w13', dir, log: () => {} } );
		u.load();
		const t0 = Date.now();
		u.recordEvent( null, 'x', 'propDestroyed', { id: 'tidemark.crate.1', port: 'tidemark', respawn: 30 }, t0 );
		const out = u.expire( t0 + 31000 );
		ok( out.length === 1 && out[ 0 ].kind === 'propRespawned' && out[ 0 ].data.id === 'tidemark.crate.1' && out[ 0 ].data.port === 'tidemark', 'the universe\'s propRespawned carries { id, port }' );

	} finally {

		rmSync( dir, { recursive: true, force: true } );

	}

}

const srv = startServer( { port: 0, host: '127.0.0.1', log: () => {}, reconnectSeconds: 3 } );
const port = await srv.ready;
const base = `ws://127.0.0.1:${ port }`;
const live = [];
const join2 = async ( name, url = `${ base }/island`, extra = {} ) => {

	const c = wireClient( url );
	live.push( c );
	c.send( hello( name, extra ) );
	const w = await c.next( 'welcome' );
	return { c, id: w.id };

};
const seen = ( c, key ) => { const st = c.link.room && c.link.room.state; return st && st.planes && st.planes.get( key ); };

try {

	const { c: A, id: aId } = await join2( 'Ann' );
	const { c: B, id: bId } = await join2( 'Bob' );
	const { c: C, id: cId } = await join2( 'Cat' );
	const room = srv.rooms.get( 'island' );
	ok( room.state.host === aId, 'Ann is the host' );

	// ---- planes
	B.send( plane( 'stray', 'stray', 100 ) );
	ok( await until( () => seen( A, bId + ':stray' ) && seen( C, bId + ':stray' ) ), 'a stray plane entry reaches everybody under <owner>:stray' );
	const e = seen( C, bId + ':stray' );
	ok( e.owner === bId && e.kind === 'stray' && e.af === 'kestrel' && e.liv === 2 && e.up === '1000000013' && Math.abs( e.x - 100 ) < 1e-3 && Math.abs( e.thr - 0.8 ) < 1e-3 && e.t > 0, 'with its airframe, livery, upgrades, pose and throttle' );
	const t0 = room.state.planes.get( bId + ':stray' ).t;
	for ( let i = 1; i <= 5; i ++ ) B.send( plane( 'stray', 'stray', 100 + i * 5 ) );
	ok( await until( () => Math.abs( seen( A, bId + ':stray' ).x - 125 ) < 1e-3 ) && room.state.planes.get( bId + ':stray' ).t === t0, 'streamed poses move it (its time kept)' );
	C.send( { t: 'plane', op: 'del', id: 'stray' } );
	A.send( { t: 'plane', op: 'set', id: 'stray', kind: 'stray', af: 'jade', p: [ 0, 0, 0 ], q: [ 0, 0, 0, 0 ] } );
	await sleep( 300 );
	ok( room.state.planes.has( bId + ':stray' ) && ! room.state.planes.has( aId + ':stray' ), 'nobody else removes it; a malformed entry is refused' );
	await sleep( 1000 );
	for ( let i = 0; i < 30; i ++ ) B.send( plane( 'stray', 'stray', 200 + i ) );
	await sleep( 400 );
	const got = room.state.planes.get( bId + ':stray' ).x - 200;
	ok( got < 29 && got >= 10, `a flood of poses is cut at the plane budget (${ got + 1 } of 30 written)` );
	await sleep( 1000 );
	for ( const id of [ 'parked', 'p2', 'p3', 'p4' ] ) B.send( plane( id, 'parked', 300 ) );
	await sleep( 300 );
	let mine = 0;
	room.state.planes.forEach( ( pe ) => { if ( pe.owner === bId ) mine ++; } );
	ok( mine === MAX_PLANES_PER_PLAYER, `at most ${ MAX_PLANES_PER_PLAYER } plane entries per player (${ mine })` );
	ok( /island\s+\S+:stray\s+stray\s+kestrel/.test( srv.admin( 'planes' ) ), 'the admin console lists the planes' );
	await sleep( 1100 );
	B.send( { t: 'plane', op: 'del', id: 'stray' } );
	ok( await until( () => ! seen( A, bId + ':stray' ) ), 'the owner removes it (the stray wrecked: the wreck entry takes over)' );
	// kept over a reconnect, gone with a leave
	C.send( plane( 'parked', 'parked', 400 ) );
	await until( () => room.state.planes.has( cId + ':parked' ) );
	await sleep( 1100 );
	C.drop( true );
	ok( await until( () => room.order.get( cId ).dropped, 2000 ) && room.state.planes.has( cId + ':parked' ), 'a dropped owner\'s parked plane stays' );
	ok( await until( () => ! room.order.get( cId ).dropped, 6000 ) && !! seen( C, cId + ':parked' ), 'reconnected: still there, in her own state too' );
	B.close();
	ok( await until( () => { let n = 0; A.link.room.state.planes.forEach( ( pe ) => { if ( pe.owner === bId ) n ++; } ); return n === 0; } ), 'a player who leaves takes her planes along' );
	const { c: D, id: dId } = await join2( 'Dan' );

	// ---- the stronghold: only the host writes it
	const F = () => room.state.fort;
	const fortOf = ( c ) => c.link.room.state.fort;
	C.send( snap( { alarm: 'alarm', guards: 0 } ) );
	await sleep( 300 );
	ok( F().seq === 0 && F().alarm === 'calm', 'a guest\'s snapshot is ignored' );
	A.send( snap( { alarm: 'alarm', why: 'cannon', guards: 4, shipsDown: 5, batteries: [ { id: 'seaward', silenced: true, why: 'platform', platform: true, powder: false }, { id: 'channel', silenced: false, why: '', platform: false, powder: false } ] } ) );
	ok( await until( () => fortOf( C ).seq === 1 ), 'the host\'s snapshot reaches the guests' );
	const fc = fortOf( C ), sw = fc.batteries.get( 'seaward' );
	ok( fc.alarm === 'alarm' && fc.why === 'cannon' && fc.guards === 4 && fc.shipsDown === 5 && sw && sw.silenced && sw.platform && ! sw.powder && ! fc.batteries.get( 'channel' ).silenced, 'alarm, guards, ships, batteries with their platform and powder' );
	ok( /island\s+pirates alarm alarm, guards 4/.test( srv.admin( 'fort' ) ), 'the admin console shows it' );
	// a guest's hostile act goes to the host alone
	A.drain( () => true ); D.drain( () => true );
	C.send( { t: 'fort', op: 'act', act: 'raise', why: 'cannon' } );
	const act = await A.next( 'fortAct' );
	ok( act.from === cId && act.act === 'raise' && act.why === 'cannon', 'a guest\'s hostile act reaches the host (who, what, why)' );
	A.send( { t: 'fort', op: 'act', act: 'raise' } );
	await sleep( 300 );
	ok( ! D.queue.some( ( m ) => m.t === 'fortAct' ) && ! C.queue.some( ( m ) => m.t === 'fortAct' ) && ! A.queue.some( ( m ) => m.t === 'fortAct' ), 'nobody else hears it; the host\'s own act goes nowhere' );
	await sleep( 1000 );
	for ( let i = 0; i < 8; i ++ ) C.send( { t: 'fort', op: 'act', act: 'hostile' } );
	await sleep( 400 );
	const hostileN = A.drain( ( m ) => m.t === 'fortAct' ).length;
	ok( hostileN === 2, `'hostile' reports are rate-limited (${ hostileN } of 8)` );

	// ---- the claim: not while defended, then once
	C.send( { t: 'fort', op: 'claim' } );
	const r0 = await C.next( 'fortClaim' );
	ok( ! r0.ok && r0.reason === 'defended' && F().holder === 'pirates', 'no claim while the host says the island is defended' );
	A.send( snap( { guards: 0, open: true } ) );
	await until( () => F().open );
	await sleep( 1600 ); // (one claim per player per 1.5 s)
	C.send( { t: 'fort', op: 'claim' } );
	D.send( { t: 'fort', op: 'claim' } );
	const [ rc, rd ] = await Promise.all( [ C.next( 'fortClaim' ), D.next( 'fortClaim' ) ] );
	ok( [ rc, rd ].filter( ( r ) => r.ok ).length === 1, `two claims at once: one is granted (${ rc.ok ? 'Cat' : 'Dan' }), the other refused (${ ( rc.ok ? rd : rc ).reason })` );
	const winner = rc.ok ? cId : dId;
	ok( F().holder === 'player' && F().by === winner && F().claims === 1 && ( rc.ok ? rd : rc ).by === winner, 'the room\'s island: the claimant, the claim count' );
	ok( await until( () => fortOf( A ).holder === 'player' && fortOf( A ).by === winner ), 'everybody sees who took it' );
	// a host snapshot made before the claim reached it cannot hand the island back
	A.send( snap( { holder: 'pirates', seen: 0 } ) );
	await sleep( 300 );
	ok( F().holder === 'player', 'a stale host snapshot (seen 0 < 1 claim) does not undo the claim' );
	A.send( snap( { holder: 'player', claimedAt: 100, until: 196, seen: 1 } ) );
	ok( await until( () => fortOf( C ).claimedAt === 100 && fortOf( C ).until === 196 ), 'the host\'s clock fills in when it was claimed and when the brotherhood is back' );
	await sleep( 1600 );
	C.send( { t: 'fort', op: 'claim' } );
	const r2 = await C.next( 'fortClaim' );
	ok( ! r2.ok && r2.reason === 'taken', 'a claim of a held island is refused' );
	A.send( snap( { holder: 'pirates', seen: 1 } ) );
	ok( await until( () => fortOf( C ).holder === 'pirates' && fortOf( C ).by === '' && fortOf( C ).claimedAt === - 1 ), 'the retake (the host\'s restock timer) hands it back to the pirates' );

	// ---- ask: to the host alone
	A.drain( () => true );
	C.send( { t: 'ask', kind: 'raid', data: { port: 'tidemark', quest: 'holdTheLine' } } );
	const ask = await A.next( 'ask' );
	ok( ask.from === cId && ask.kind === 'raid' && ask.data.port === 'tidemark', 'a guest\'s request reaches the host' );
	A.send( { t: 'ask', kind: 'raid', data: {} } );
	await sleep( 300 );
	ok( ! D.queue.some( ( m ) => m.t === 'ask' ) && ! C.queue.some( ( m ) => m.t === 'ask' ), 'nobody else gets it (the host\'s own ask goes nowhere)' );

	// ---- the prop events' own budget
	D.drain( () => true );
	for ( let i = 0; i < 15; i ++ ) C.send( { t: 'event', kind: 'propDestroyed', data: { id: `tidemark.crate.${ i }`, kind: 'crate', port: 'tidemark', x: i, y: 0, z: 0, respawn: 600 } } );
	for ( let i = 0; i < 12; i ++ ) C.send( { t: 'event', kind: 'chatter', data: { i } } );
	await sleep( 500 );
	const props = D.queue.filter( ( m ) => m.t === 'event' && m.kind === 'propDestroyed' );
	const chatter = D.queue.filter( ( m ) => m.t === 'event' && m.kind === 'chatter' ).length;
	ok( props.length === 15 && props.every( ( m ) => m.data.port === 'tidemark' && m.from === cId ), `a blast's 15 broken props all arrive, with their port (${ props.length })` );
	ok( chatter === 10, `other events keep their own budget (${ chatter } of 12)` );
	A.send( { t: 'event', kind: 'propsRespawned', data: { port: 'tidemark', ids: [ 'tidemark.crate.1', 'tidemark.crate.2' ] } } );
	A.send( { t: 'event', kind: 'propsRespawned', data: { port: 'tidemark', ids: [ 3 ] } } );
	const pr = await D.next( ( m ) => m.t === 'event' && m.kind === 'propsRespawned' );
	await sleep( 200 );
	ok( pr.data.ids.length === 2 && pr.from === aId && ! D.queue.some( ( m ) => m.t === 'event' && m.kind === 'propsRespawned' ), 'the host\'s batched respawns are relayed (a malformed batch is not)' );

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

for ( const c of live ) try { c.close(); } catch ( e ) { /* closed */ }
await srv.close();

// ---- the universe stores a batch of respawns like single ones
const dataDir = mkdtempSync( join( tmpdir(), 'hyptile-w13u-' ) );
const usrv = startServer( { port: 0, host: '127.0.0.1', universe: 'w13verse', data: dataDir, flushMs: 300, saveEveryMs: 300, log: () => {} } );
try {

	const uport = await usrv.ready;
	const hex = ( c ) => c.repeat( 32 );
	const ua = wireClient( `ws://127.0.0.1:${ uport }/universe` );
	ua.send( { t: 'hello', v: 2, name: 'Mad Meg', character: 'hyptile', boat: 'skiff', token: hex( 'a' ) } );
	await ua.next( 'welcome' );
	const ub = wireClient( `ws://127.0.0.1:${ uport }/universe` );
	ub.send( { t: 'hello', v: 2, name: 'Old Tom', character: 'hyptile', boat: 'skiff', token: hex( 'b' ) } );
	await ub.next( 'welcome' );
	const uroom = usrv.rooms.get( 'universe' );
	const evs = () => uroom.uni.state.events;
	ua.send( { t: 'event', kind: 'propDestroyed', data: { id: 'tidemark.crate.7', port: 'tidemark', respawn: 600 } } );
	ua.send( { t: 'event', kind: 'propDestroyed', data: { id: 'tidemark.crate.8', port: 'tidemark', respawn: 600 } } );
	ok( await until( () => evs()[ 'propDestroyed:tidemark.crate.7' ] && evs()[ 'propDestroyed:tidemark.crate.8' ] ), 'the universe stores the broken props' );
	ua.send( { t: 'event', kind: 'propsRespawned', data: { port: 'tidemark', ids: [ 'tidemark.crate.7', 'tidemark.crate.8' ] } } );
	ok( await until( () => ! evs()[ 'propDestroyed:tidemark.crate.7' ] && ! evs()[ 'propDestroyed:tidemark.crate.8' ] ), 'a host\'s batched respawn clears them (a late joiner is not handed old breaks)' );
	ua.close();
	ub.close();

} catch ( e ) {

	fails ++;
	console.log( 'FAIL', e && e.stack || e );

}

await usrv.close();
rmSync( dataDir, { recursive: true, force: true } );
clearTimeout( watchdog );
if ( fails ) {

	console.log( `\n${ fails } failure(s)` );
	process.exit( 1 );

}

console.log( '\nserver-w13: all checks passed' );
process.exit( 0 );
