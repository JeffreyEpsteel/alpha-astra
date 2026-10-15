// Real Colyseus server + two clients on an ephemeral loopback port, isolated temporary universe data.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { PROTOCOL_VERSION } from '../src/net/Protocol.js';

const dir = mkdtempSync( join( tmpdir(), 'hyptile-codex-authority-' ) );
const server = startServer( { port: 0, host: '127.0.0.1', universe: 'codex-authority', data: dir, reconnectSeconds: 5, log() {} } );
const clients = [];
let checks = 0, serial = 0;
const check = ( ok, name ) => { assert.ok( ok, name ); checks ++; console.log( 'ok', name ); };
const sleep = ms => new Promise( r => setTimeout( r, ms ) );
const until = async ( predicate, ms = 7000 ) => {

	const start = Date.now();
	while ( Date.now() - start < ms ) { if ( predicate() ) return true; await sleep( 20 ); }
	return !! predicate();

};
const event = ( client, kind, data ) => client.send( { t: 'event', kind, data } );
// A following allowed event is a wire-order barrier: every preceding frame on this sender's socket has been handled.
const barrier = async ( sender, recipient ) => {

	const mark = ++ serial;
	event( sender, 'emote', { id: 'wave', authorityTest: mark } );
	await recipient.next( m => m.t === 'event' && m.kind === 'emote' && m.data.authorityTest === mark );

};
const noEvent = ( client, kinds ) => ! client.queue.some( m => m.t === 'event' && kinds.includes( m.kind ) );

try {

	const port = await server.ready;
	const connect = async ( name, token ) => {

		const c = wireClient( `ws://127.0.0.1:${ port }/universe` );
		clients.push( c );
		c.send( { t: 'hello', v: PROTOCOL_VERSION, name, character: 'pepe', boat: 'skiff', token: token.repeat( 32 ) } );
		const welcome = await c.next( m => m.t === 'welcome' || m.t === 'error' );
		assert.equal( welcome.t, 'welcome', `join ${ name }: ${ welcome.code || '' } ${ welcome.text || '' }` );
		return { c, id: welcome.id };

	};
	const { c: host, id: hostId } = await connect( 'Authority Host', 'a' );
	const { c: guest, id: guestId } = await connect( 'Authority Guest', 'b' );
	const room = server.rooms.get( 'universe' );
	check( room.state.host === hostId && room.order.size === 2, 'two real clients joined; the first client is host' );
	const props = [ 'meridian.authority.1', 'meridian.authority.2' ];
	for ( const id of props ) event( guest, 'propDestroyed', { id, port: 'meridian', respawn: 600 } );
	await barrier( guest, host );
	check( props.every( id => room.uni.state.events[ 'propDestroyed:' + id ] ) && host.drain( m => m.t === 'event' && m.kind === 'propDestroyed' ).length === 2, 'legitimate guest prop damage is relayed and persisted' );

	event( guest, 'cityStages', { s: [ [ 'twin-north', 3, 0, 0 ] ], snap: 1 } );
	event( guest, 'propsRespawned', { ids: props, port: 'meridian' } );
	event( guest, 'propRespawned', { id: props[ 0 ], port: 'meridian' } );
	event( guest, 'navyHail', { to: hostId, say: 'board', ship: 'Forged', n: 1 } );
	await barrier( guest, host );
	check( noEvent( host, [ 'cityStages', 'propsRespawned', 'propRespawned', 'navyHail' ] ), 'guest cannot forge city snapshots, either respawn form, or navy hails' );
	check( props.every( id => room.uni.state.events[ 'propDestroyed:' + id ] ), 'forged guest respawns cannot clear persistent broken props' );

	for ( const c of [ guest, host ] ) {

		event( c, 'boatMoored', { captain: 'forged', boat: 'skiff', p: [ 0, 0, 0 ] } );
		event( c, 'boatUnmoored', { captain: 'forged' } );
		await barrier( c, c === guest ? host : guest );

	}
	check( clients.every( c => noEvent( c, [ 'boatMoored', 'boatUnmoored' ] ) ), 'both host and guest are barred from forging server mooring notices' );

	const stages = { s: [ [ 'twin-north', 2, 60, 0 ] ], snap: 1 };
	event( host, 'cityStages', stages );
	const snapshot = await guest.next( m => m.t === 'event' && m.kind === 'cityStages' );
	check( snapshot.from === hostId && JSON.stringify( snapshot.data ) === JSON.stringify( stages ), 'legitimate host city snapshot is delivered with authenticated sender identity' );
	event( host, 'propsRespawned', { ids: [ props[ 0 ] ], port: 'meridian' } );
	const batch = await guest.next( m => m.t === 'event' && m.kind === 'propsRespawned' );
	check( batch.from === hostId && ! room.uni.state.events[ 'propDestroyed:' + props[ 0 ] ], 'host batched respawn is relayed and clears persistent damage' );
	event( host, 'propRespawned', { id: props[ 1 ], port: 'meridian' } );
	await guest.next( m => m.t === 'event' && m.kind === 'propRespawned' );
	check( ! room.uni.state.events[ 'propDestroyed:' + props[ 1 ] ], 'host single respawn retains compatible persistence behavior' );

	// Unknown asks must not reach listeners or consume the separate four-per-second legitimate request budget.
	for ( const kind of [ 'eraseCity', 'cityStages', 'propsRespawned', 'prototype', 'hostCommand' ] ) guest.send( { t: 'ask', kind, data: { s: stages.s } } );
	for ( const [ kind, data ] of [ [ 'cityHit', { k: 'blast', x: - 2500, y: 6, z: - 300, r: 4, e: 60 } ], [ 'citySnap', {} ], [ 'raid', { port: 'tidemark', chain: 'holdTheLine' } ] ] ) {

		guest.send( { t: 'ask', kind, data } );
		const request = await host.next( m => m.t === 'ask' && m.kind === kind );
		check( request.from === guestId && JSON.stringify( request.data ) === JSON.stringify( data ), `legitimate guest ${ kind } request reaches the current host` );

	}
	await barrier( guest, host );
	check( ! host.queue.some( m => m.t === 'ask' ), 'unknown and snapshot-forgery asks are rejected' );
	check( ! guest.queue.some( m => m.t === 'ask' ), 'guest receives no host-directed requests' );
	event( guest, 'thrown', { kind: 'bomb', ev: 'blast', x: 0, y: 0, z: 0 } );
	await host.next( m => m.t === 'event' && m.kind === 'thrown' );
	check( true, 'legitimate guest weapon action events remain usable' );

	// A transient drop transfers authority. Reconnecting the former host does not steal it back.
	// ColyseusLink deliberately requires one second of initial connection uptime before automatic reconnect.
	await sleep( 1100 );
	host.drop( true );
	check( await until( () => room.state.host === guestId && room.order.get( hostId )?.dropped ), 'host disconnect migrates authority to the connected guest' );
	check( await until( () => ! room.order.get( hostId )?.dropped && ! host.link.dropped ), 'the former host reconnects to its retained seat' );
	check( room.state.host === guestId && room.order.size === 2, 'reconnecting the old host preserves the new host and both player seats' );
	host.drain( () => true ); guest.drain( () => true );
	event( host, 'cityStages', stages );
	event( host, 'propsRespawned', { ids: props, port: 'meridian' } );
	await barrier( host, guest );
	check( noEvent( guest, [ 'cityStages', 'propsRespawned' ] ), 'former host loses snapshot and respawn authority after migration' );
	event( guest, 'cityStages', { s: [ [ 'twin-south', 1, 0, 0 ] ] } );
	const migrated = await host.next( m => m.t === 'event' && m.kind === 'cityStages' );
	check( migrated.from === guestId, 'new host immediately gains world snapshot authority' );
	event( guest, 'propsRespawned', { ids: props, port: 'meridian' } );
	const respawn = await host.next( m => m.t === 'event' && m.kind === 'propsRespawned' );
	check( respawn.from === guestId, 'new host gains respawn authority' );
	host.send( { t: 'ask', kind: 'cityHit', data: { k: 'fire', x: - 2500, y: 6, z: - 300 } } );
	const routed = await guest.next( m => m.t === 'ask' && m.kind === 'cityHit' );
	check( routed.from === hostId, 'legitimate guest action requests follow host migration' );

} finally {

	for ( const c of clients ) c.close();
	await server.close();
	const target = resolve( dir );
	assert.ok( target.startsWith( resolve( tmpdir() ) + sep ) && basename( target ).startsWith( 'hyptile-codex-authority-' ), 'temporary cleanup remains in the test-owned directory' );
	rmSync( target, { recursive: true, force: true } );

}
console.log( `${ checks } server authority checks passed; isolated server and temporary data cleaned up` );
