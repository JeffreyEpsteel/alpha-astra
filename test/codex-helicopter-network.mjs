// Real Colyseus/WebSocket transport on ephemeral loopback. Two actual clients;
// no fake broadcasts. Synthetic save data lives under this task's report dir.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';
import { wireClient } from '../server/testkit.mjs';
import { PROTOCOL_VERSION } from '../src/net/Protocol.js';
import { Helicopter } from '../src/features/helicopter/Helicopter.js';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const reportDir = join( root, 'reports', 'codex-20261015', 'helicopter-network' );
mkdirSync( reportDir, { recursive: true } );
const syntheticDir = mkdtempSync( join( reportDir, 'synthetic-' ) );
const receipt = { startedAt: new Date().toISOString(), transport: 'real Colyseus over WebSocket', host: '127.0.0.1', requestedPort: 0, syntheticDir, checks: [], observedStates: [], cleanup: {} };
const clients = [], helicopters = [];
let srv = null, error = null;
const delay = ms => new Promise( r => setTimeout( r, ms ) );
const until = async ( predicate, ms = 5000 ) => { const start = Date.now(); while ( Date.now() - start < ms ) { if ( predicate() ) return true; await delay( 20 ); } return !! predicate(); };
const check = ( condition, label, evidence = undefined ) => {
	receipt.checks.push( { label, passed: !! condition, ...( evidence === undefined ? {} : { evidence } ) } );
	console.log( condition ? 'ok' : 'FAIL', label ); assert.ok( condition, label );
};
const makeAircraft = id => {
	const features = { get: name => name === 'netsync' ? { id } : null };
	const h = new Helicopter( { terrainData: { heightAt: () => 1 } }, features, { render: false, hud: false } );
	helicopters.push( h ); return h;
};
const playerState = ( helicopter, marker, mode = 'seat' ) => helicopter.decorateState( { t: 'state', p: [ marker, 2, - 60 ], yaw: 0, mode, action: mode === 'seat' ? 'seated' : null, character: 'pepe', grounded: mode === 'walk', speed: 0, vy: 0, boat: null } );
async function receivedState( client, id, marker ) {
	const message = await client.next( m => m.t === 'states' && m.list.some( s => s.id === id && s.p[ 0 ] === marker ), 6000 );
	const state = message.list.find( s => s.id === id && s.p[ 0 ] === marker );
	receipt.observedStates.push( { receivedAt: new Date().toISOString(), serverAt: message.at, state } ); return state;
}
// Full membership snapshot read from the OTHER client's decoded network schema.
// It carries real server data, not a made-up leave broadcast or fixture pose.
function membership( client ) {
	const result = [];
	client.link.room.state.players.forEach( ( p, id ) => {
		if ( id === client.id ) return;
		result.push( { id, helicopter: p.extra ? JSON.parse( p.extra ).helicopter : undefined } );
	} );
	return result;
}

try {
	srv = startServer( { port: 0, host: '127.0.0.1', universe: 'codex-helicopter-test', data: syntheticDir, log: () => {}, reconnectSeconds: 1, clockEveryMs: 200, flushMs: 250 } );
	const port = await srv.ready; receipt.port = port;
	check( Number.isInteger( port ) && port > 0, 'test server binds an ephemeral loopback port', { port } );
	const connect = async name => {
		const c = wireClient( `ws://127.0.0.1:${ port }/island` ); clients.push( c );
		c.send( { t: 'hello', v: PROTOCOL_VERSION, name, character: 'pepe', boat: null } );
		const welcome = await c.next( 'welcome', 8000 ); return { c, welcome };
	};
	const { c: A, welcome: wa } = await connect( 'Helicopter Network A' );
	const { c: B, welcome: wb } = await connect( 'Helicopter Network B' );
	const aId = wa.id, bId = wb.id; receipt.peerIds = { aId, bId };
	check( aId !== bId && wb.peers.some( p => p.id === aId ) && wb.host === aId, 'two real clients join and agree on first pilot host' );
	const hA = makeAircraft( aId ), hB = makeAircraft( bId );
	hA.flight.place( 84.123, 104.456, - 75.789, 0.7 ); hA.flight.rpm = 0.82; hA.piloted = true;
	A.send( playerState( hA, 100 ) ); const flying = await receivedState( B, aId, 100 );
	check( flying.mode === 'seat' && flying.action === 'seated' && flying.helicopter?.piloted === true, 'seat-mode helicopter pilot is accepted and reaches the other client' );
	check( flying.helicopter.p[ 0 ] === 84.12 && flying.helicopter.p[ 1 ] === 104.46 && flying.helicopter.rpm === 0.82, 'aircraft extra pose and rotor state survive real server sanitizer/schema/transport', flying.helicopter );
	hB.updateRemote( [ flying ] );
	check( hB.remote.peers.has( aId ) && hB.remote.count === 1, 'received flying state feeds actual Helicopter remote lifecycle' );
	const normalized = playerState( hA, 101 ); normalized.helicopter.q = [ 0, 0, 0, 4 ]; normalized.helicopter.rpm = 8;
	A.send( normalized ); const capped = await receivedState( B, aId, 101 );
	check( capped.helicopter.q[ 3 ] === 1 && capped.helicopter.rpm === 1, 'server normalizes remote helicopter quaternion and caps rotor speed' );
	const invalid = [
		[ 'zero quaternion', h => { h.q = [ 0, 0, 0, 0 ]; } ],
		[ 'NaN position', h => { h.p = [ NaN, 1, 2 ]; } ],
		[ 'infinite quaternion', h => { h.q = [ 0, Infinity, 0, 1 ]; } ],
		[ 'out-of-world position', h => { h.p = [ 1e9, 2, 3 ]; } ],
	];
	for ( let i = 0; i < invalid.length; i ++ ) {
		const [ label, corrupt ] = invalid[ i ], marker = 110 + i, s = playerState( hA, marker ); corrupt( s.helicopter );
		A.send( s ); const arrived = await receivedState( B, aId, marker );
		check( ! Object.hasOwn( arrived, 'helicopter' ), `real server discards aircraft extra with ${ label } while valid player state arrives` );
		hB.updateRemote( [ arrived ] ); check( hB.remote.count === 0, `discarded ${ label } cannot create or retain a remote helicopter` );
	}
	hA.piloted = false; hA.flight.place( 84, 1, - 76, 0.7 ); hA.flight.rpm = 0;
	A.send( playerState( hA, 120, 'walk' ) ); const parked = await receivedState( B, aId, 120 ); hB.updateRemote( [ parked ] );
	check( parked.mode === 'walk' && parked.helicopter.piloted === false && parked.helicopter.rpm === 0 && hB.remote.count === 1, 'unpiloted parked helicopter remains in remote presentation while its owner walks' );
	hB.hp = 73; hB.flight.place( 312, 1, - 102, 0.4 );
	B.send( playerState( hB, 200, 'walk' ) ); const guest = await receivedState( A, bId, 200 ); hA.updateRemote( [ guest ] );
	await delay( 450 );
	const schemaParked = JSON.parse( B.link.room.state.players.get( aId ).extra ).helicopter;
	check( schemaParked.p[ 0 ] === 84 && ! schemaParked.piloted && hB.remote.count === 1, 'parked aircraft remains in connected schema without repeat owner state sends', schemaParked );
	const privateBefore = JSON.stringify( hB.toJSON() ), privatePosition = hB.flight.position.clone(), privateHome = hB.homeSlot;
	A.close(); const leave = await B.next( m => m.t === 'leave' && m.id === aId, 6000 );
	check( leave.id === aId && await until( () => ! B.link.room.state.players.has( aId ) ), 'real disconnect removes aircraft owner from other client membership' );
	hB.updateRemote( membership( B ), { complete: true } );
	check( hB.remote.count === 0, 'actual Helicopter full snapshot removes disconnect ghost immediately' );
	check( await until( () => B.link.room.state.host === bId ), 'remaining pilot becomes host through actual schema migration' );
	const migration = await B.next( m => m.t === 'host' && m.id === bId, 6000 );
	check( migration.prev === aId && JSON.stringify( hB.toJSON() ) === privateBefore && hB.flight.position.distanceTo( privatePosition ) === 0 && hB.homeSlot === privateHome, 'host migration preserves remaining pilot private helicopter, parking, health and home slot' );
	B.send( playerState( hB, 201, 'walk' ) );
	check( await until( () => srv.rooms.get( 'island' )?.order.get( bId )?.lastState?.p[ 0 ] === 201 ), 'new host continues sending its own parked helicopter after migration' );
	receipt.passed = true;
} catch ( e ) {
	error = e; receipt.passed = false; receipt.error = { message: e.message, stack: e.stack }; console.error( e.stack );
} finally {
	for ( const h of helicopters ) try { h.dispose(); } catch {}
	for ( const c of clients ) try { c.close(); } catch {}
	if ( srv ) try { await srv.close(); receipt.cleanup.serverClosed = true; } catch ( e ) { receipt.cleanup.serverError = e.message; }
	// Scoped synthetic-only removal; never delete a computed path without checking it.
	const target = resolve( syntheticDir );
	if ( dirname( target ).toLowerCase() !== resolve( reportDir ).toLowerCase() || ! target.split( /[\\/]/ ).at( - 1 ).startsWith( 'synthetic-' ) ) throw new Error( 'unsafe synthetic cleanup target' );
	rmSync( target, { recursive: true, force: true } ); receipt.cleanup.syntheticRemoved = ! existsSync( target );
	receipt.finishedAt = new Date().toISOString(); receipt.totalChecks = receipt.checks.length;
	writeFileSync( join( reportDir, 'verification.json' ), JSON.stringify( receipt, null, 2 ) + '\n' );
}
if ( error ) process.exitCode = 1;
console.log( `${ receipt.checks.filter( c => c.passed ).length }/${ receipt.checks.length } real helicopter network checks passed; server and synthetic state cleaned.` );
