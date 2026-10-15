// CPU-only integration regressions. Real flight, cockpit logic, authored GLB loader,
// Player vehicle/camera, Features and GameState; synthetic storage, no server/GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Vector3, PerspectiveCamera, Scene } from '../src/engine/index.js';
import * as seaplane from '../src/features/seaplane/index.js';
import { AIRPORT_FLEET, findAirport, airportRank, airportStand, buildAirportStandGeometry } from '../src/features/seaplane/Airport.js';
import { AIRFRAMES, spec } from '../src/features/seaplane/Airframes.js';
import { PlaneModels } from '../src/features/seaplane/Model.js';
import { layoutFor, controlAt } from '../src/features/seaplane/Panels.js';
import { panelSnapshot } from '../src/features/seaplane/Cockpit.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { Player } from '../src/player/Player.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { PlaneLink } from '../src/features/netsync/PlaneLink.js';
import { sanitizePlane } from '../src/net/Protocol.js';
import { cityPlan, LAYOUT, MERIDIAN } from '../src/world/islands/meridian/CityPlan.js';

let passed = 0;
async function test( name, fn ) { await fn(); passed ++; console.log( 'PASS', name ); }
const storage = () => { const m = new Map(); return { getItem: k => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: k => m.delete( k ), m }; };
const terrain = { heightAt: ( x ) => x < - 1800 ? 2.8 : - 20 };
function fixture( { store = storage(), world = WORLD, id = null, ids = [] } = {} ) {
	const state = new GameState( store );
	if ( id ) state.setMode( 'multiplayer' );
	const input = { keys: new Set(), pressed: new Set(), enabled: true, down( k ) { return this.keys.has( k ); }, hit( k ) { return this.pressed.has( k ); }, consumeLook: () => ( { x: 0, y: 0 } ), consumeWheel: () => 0 };
	const camera = new PerspectiveCamera( 60, 1.6, 0.1, 5000 );
	const query = { allocate: () => 0, cpu: new Float32Array( 16 ), cpuValid: false, setPoint() {} };
	const player = new Player( { camera, input, terrain, colliders: new Colliders(), query, boat: null } );
	const events = [], toasts = [];
	const app = { mode: id ? 'multiplayer' : 'campaign', terrainData: terrain, camera, input, player, game: { state, toast: text => toasts.push( text ) }, ...( id ? { net: { id }, remotePlayers: { peers: new Map( ids.filter( k => k !== id ).map( k => [ k, {} ] ) ) } } : {} ) };
	const features = new Features( app );
	const sp = seaplane.install( app, features, { models: false, site: false, world } );
	features.list.set( 'seaplane', { module: seaplane, instance: sp } );
	state.featuresProvider = () => features.toJSON();
	for ( const n of [ 'planeTookOff', 'planeCrashed', 'seaplaneRecovered' ] ) features.on( n, e => events.push( { ...e, name: n } ) );
	const go = af => { const b = sp.base( af ); player.position.set( b.x, b.y, b.z ); };
	const unboard = () => { sp.piloted = false; player.mode = 'walk'; player.vehicle = null; input.keys.clear(); };
	return { app, state, features, sp, player, input, camera, store, events, toasts, go, unboard };
}

await test( 'cold boot displays two distinct airport aircraft without granting or changing active Jade', () => {
	const w = fixture(), { sp } = w;
	assert.equal( sp.af, 'jade' ); assert.equal( sp.owned, false ); assert.deepEqual( sp.toJSON().fleet, {} );
	assert.deepEqual( AIRPORT_FLEET, [ 'swift', 'courier' ] );
	assert.deepEqual( [ ...sp.parked.keys() ], [ 'strip', 'airport-swift', 'airport-courier' ] );
	const markers = sp.airportMarkers(); assert.equal( markers.length, 2 );
	assert.ok( markers.every( m => m.available && ! m.claimed && m.y === 2.8 ) );
	assert.deepEqual( markers.map( m => [ m.x, m.z ] ), [ [ - 2760, - 950 ], [ - 2744, - 928 ] ] );
	assert.equal( sp.parked.get( 'airport-swift' ).liv, 3 ); assert.equal( sp.parked.get( 'airport-courier' ).liv, 2 );
	assert.ok( spec( 'swift' ).mass < spec( 'kestrel' ).mass ); assert.equal( spec( 'courier' ).geom.engines.length, 2 );
	assert.equal( spec( 'courier' ).crates, 4 );
	const g = buildAirportStandGeometry( findAirport( WORLD ) ); assert.ok( g.attributes.position.count > 100 ); g.dispose();
	assert.equal( w.features.nearestInteractable( sp.parked.get( 'airport-swift' ).door ).id, 'seaplane-parked-airport-swift' );
	assert.equal( sp.useAirportAircraft( 'swift' ).ok, false, 'cannot remotely summon before reaching airport' );
	const absent = fixture( { world: { islands: [], ports: [] } } );
	assert.deepEqual( absent.sp.airportMarkers(), [] ); assert.equal( absent.sp.available( 'swift' ), false ); assert.equal( absent.sp.useAirportAircraft( 'swift' ).ok, false );
	w.sp.dispose(); absent.sp.dispose();
} );

await test( 'E claims and boards courtesy aircraft; existing bought aircraft and its cargo/upgrades stay stored', () => {
	const w = fixture(), { sp } = w;
	w.state.money = 50000; assert.ok( sp.buy( 'jade' ).ok );
	sp.hp = 73; sp.flight.fuel = 0.42; sp.upgrades.radio = 1; sp._respec();
	w.go( 'swift' );
	const r = sp.useParked( 'airport-swift' ); assert.ok( r.ok && r.boarded );
	assert.equal( w.player.mode, 'plane' ); assert.equal( w.player.vehicle, sp.vehicle );
	assert.equal( sp.af, 'swift' ); assert.equal( sp.upgrades.livery, 3 ); assert.equal( sp.flight.engineOn, false );
	assert.equal( sp.fleet.jade.hp, 73 ); assert.equal( sp.fleet.jade.fuel, 0.42 ); assert.equal( sp.fleet.jade.upgrades.radio, 1 );
	assert.equal( sp.parked.has( 'airport-swift' ), false, 'active aircraft has exactly one local model' );
	assert.equal( sp.useAirportAircraft( 'courier' ).ok, false, 'cannot switch while flying' );
	assert.equal( sp.takeOut( 'jade' ).ok, false );
	w.unboard(); w.go( 'courier' ); assert.ok( sp.useParked( 'airport-courier' ).boarded );
	assert.equal( sp.af, 'courier' ); assert.equal( sp.flight.engineFail.length, 2 );
	assert.ok( sp.fleet.swift.owned );
	w.unboard(); assert.ok( sp.takeOut( 'jade' ).ok ); assert.equal( sp.hp, 73 ); assert.equal( sp.flight.fuel, 0.42 );
	assert.equal( sp.upgrades.radio, 1 );
	sp.dispose();
} );

await test( 'actual GameState saves and reloads both aircraft, condition, upgrades and cargo; old saves never grant them', () => {
	const w = fixture(), { sp } = w;
	w.go( 'swift' ); assert.ok( sp.useAirportAircraft( 'swift' ).boarded ); w.unboard();
	sp.hp = 67; sp.flight.fuel = 0.31; sp.upgrades.engine = 1;
	w.go( 'courier' ); assert.ok( sp.useAirportAircraft( 'courier' ).boarded ); w.unboard();
	sp.cargo = [ { good: 'tools', qty: 2, kg: 45, crates: 1, cond: 0.83, paid: 90 } ];
	sp.hp = 81; sp.flight.fuel = 0.57; sp.upgrades.radio = 1; sp._respec();
	assert.ok( w.state.save() );
	const restored = fixture( { store: w.store } ); assert.ok( restored.state.load() ); restored.features.fromJSON( restored.state.featuresData );
	assert.equal( restored.sp.af, 'courier' ); assert.equal( restored.sp.hp, 81 ); assert.equal( restored.sp.flight.fuel, 0.57 );
	assert.equal( restored.sp.piloted, false ); assert.ok( restored.sp.home ); assert.equal( restored.sp.cargo[ 0 ].cond, 0.83 );
	assert.equal( restored.sp.fleet.swift.hp, 67 ); assert.equal( restored.sp.fleet.swift.fuel, 0.31 ); assert.equal( restored.sp.fleet.swift.upgrades.engine, 1 );
	assert.equal( restored.sp.upgrades.radio, 1 );
	const old = fixture(); old.sp.fromJSON( { owned: true, hp: 55, fuel: 0.4 } );
	assert.equal( old.sp.af, 'jade' ); assert.equal( old.sp.hp, 55 ); assert.equal( old.sp.owns( 'swift' ), false );
	restored.sp.reset(); assert.equal( restored.sp.af, 'jade' ); assert.deepEqual( restored.sp.toJSON().fleet, {} );
	assert.equal( restored.sp.airportMarkers().length, 2 );
	for ( const a of [ w, restored, old ] ) a.sp.dispose();
} );

await test( 'airport service recovers the same crashed record, keeps cargo/upgrades and refuses distant or occupied vehicles', () => {
	const w = fixture(), { sp } = w; w.go( 'courier' ); sp.useAirportAircraft( 'courier' ); w.unboard();
	sp.cargo = [ { good: 'tools', qty: 1, kg: 45, crates: 1 } ]; sp.upgrades.radio = 1;
	const crashStand = sp.base();
	sp.flight.place( crashStand.x, crashStand.z, 0, 20 ); sp.flight.velocity.set( 0, - 18, 0 );
	sp.flight.airborne = true; sp.flight._wasAir = true; sp.flight.airTime = 2;
	for ( let i = 0; i < 180 && ! sp.lost; i ++ ) sp._step( 1 / 60 );
	assert.ok( sp.lost && w.events.some( e => e.name === 'planeCrashed' ), 'real hard ground arrival creates wreck' );
	sp.flight.fuel = 0; sp.flight.engineFail.fill( true ); w.go( 'courier' );
	assert.equal( sp.useAirportAircraft( 'courier' ).ok, true, 'E service at airport retrieves wreck' ); w.unboard();
	assert.equal( sp.lost, false ); assert.equal( sp.hp, 100 ); assert.equal( sp.flight.fuel, 1 );
	assert.equal( sp.flight.engineFail.some( Boolean ), false ); assert.equal( sp.cargo.length, 1 ); assert.equal( sp.upgrades.radio, 1 );
	w.player.position.set( 0, 0, 0 ); assert.equal( sp.useAirportAircraft( 'swift' ).ok, false );
	w.go( 'swift' ); w.player.mode = 'boat'; assert.equal( sp.useAirportAircraft( 'swift' ).ok, false );
	w.player.mode = 'plane'; w.player.vehicle = { kind: 'helicopter' }; assert.equal( sp.board(), false );
	assert.equal( sp.useAirportAircraft( 'swift' ).ok, false );
	sp.dispose();
} );

await test( 'Courier airport cargo uses Meridian provenance and cannot transfer while airborne or away from a port', () => {
	const w = fixture(), { sp } = w, added = [];
	const tr = { cargo: { tools: { qty: 2, cond: 0.9 } }, takeCargo( g, n ) { this.cargo[ g ].qty -= n; return { qty: n }; }, addCargo( g, n, options ) { added.push( { g, n, options } ); return n; } };
	w.features.list.set( 'trade', { instance: tr } );
	w.go( 'courier' ); sp.useAirportAircraft( 'courier' ); w.unboard();
	assert.equal( sp.cargoPort(), 'meridian' ); assert.ok( sp.loadCargo().ok );
	assert.equal( sp.cargoCrates(), 2 ); assert.ok( sp.unloadCargo().ok ); assert.equal( added[ 0 ].options.port, 'meridian' );
	sp.cargo = [ { good: 'tools', qty: 1, kg: 45, crates: 1 } ];
	sp.flight.position.set( - 900, 20, 300 ); assert.equal( sp.unloadCargo().ok, false ); assert.equal( sp.cargo.length, 1 );
	w.go( 'courier' ); const b = sp.base(); sp.flight.position.set( b.x, b.y + 100, b.z ); sp.flight.airborne = true;
	assert.equal( sp.cargoPort(), null ); assert.equal( sp.loadCargo().ok, false );
	sp.dispose();
} );

await test( '16 multiplayer captains get 32 non-overlapping stands; peer streams cannot claim, service or replace local fleet', () => {
	const ids = Array.from( { length: 16 }, ( _, i ) => 'captain-' + String( i ).padStart( 2, '0' ) );
	const spots = [];
	for ( const id of ids ) {
		const app = { net: { id }, remotePlayers: { peers: new Map( ids.filter( s => s !== id ).map( s => [ s, {} ] ).reverse() ) } };
		for ( const af of AIRPORT_FLEET ) spots.push( { af, ...airportStand( findAirport( WORLD ), af, airportRank( app ) ) } );
	}
	assert.equal( new Set( spots.map( s => `${ s.x },${ s.z }` ) ).size, 32 );
	for ( let i = 0; i < spots.length; i ++ ) for ( let j = i + 1; j < spots.length; j ++ ) assert.ok( Math.abs( spots[ i ].x - spots[ j ].x ) >= 16 || Math.abs( spots[ i ].z - spots[ j ].z ) >= 22 );
	for ( const s of spots ) {
		const span = spec( s.af ).geom.span / 2;
		const u = s.x - MERIDIAN.center.x, v = s.z - MERIDIAN.center.z;
		assert.ok( u - span > LAYOUT.AIRPORT.x0 && u + span < LAYOUT.AIRPORT.x1 && v - 7 > LAYOUT.AIRPORT.z0 && v + 5 < LAYOUT.AIRPORT.z1, 'whole airframe inside reclaimed apron' );
		for ( const b of cityPlan().buildings ) {
			assert.ok( Math.abs( s.x - b.x ) > span + b.w / 2 || Math.abs( s.z - b.z ) > 7 + b.d / 2, `stand clear of ${ b.id }` );
			// Conservative swept taxi footprint up to the runway entry, including wings.
			const endZ = WORLD.meridian.airstrip.z - 8;
			assert.ok( Math.abs( s.x - b.x ) > span + b.w / 2 || endZ + 8 < b.z - b.d / 2 || s.z - 7 > b.z + b.d / 2, `taxi path clear of ${ b.id }` );
		}
	}
	const w = fixture( { id: ids[ 0 ], ids } ); w.go( 'swift' ); w.sp.useAirportAircraft( 'swift' );
	const before = JSON.stringify( w.sp.toJSON() );
	w.sp.updateRemote( [ { id: ids[ 1 ], plane: { af: 'courier', liv: 2, p: [ - 2222, 2.8, - 898 ], q: [ 0, 0, 0, 1 ], thr: 0 } } ] );
	assert.equal( JSON.stringify( w.sp.toJSON() ), before ); assert.equal( w.sp.owns( 'courier' ), false );
	const out = w.sp.decorateState( {} ); assert.equal( out.plane.af, 'swift' );
	w.unboard(); const link = new PlaneLink( { features: w.features } );
	const local = link.local(); assert.equal( local.length, 1 ); assert.equal( local[ 0 ].af, 'swift' );
	assert.equal( sanitizePlane( { op: 'set', ...local[ 0 ] } ).af, 'swift' );
	assert.ok( [ ...w.features._interactables ].every( s => ! String( s.id ).includes( ids[ 1 ] ) ) );
	w.sp.dispose();
} );

await test( 'join/drop keeps issued z aircraft and service fixed; newcomer a excludes live and parked aircraft footprints', () => {
	const z = fixture( { id: 'z', ids: [ 'z' ] } ); z.go( 'swift' ); assert.ok( z.sp.useAirportAircraft( 'swift' ).boarded );
	const firstBase = z.sp.base( 'swift' ), firstFlight = z.sp.flight.position.clone();
	z.app.remotePlayers.peers.set( 'a', {} );
	assert.deepEqual( z.sp.base( 'swift' ), firstBase ); assert.ok( z.sp.flight.position.equals( firstFlight ) );
	const a = fixture( { id: 'a', ids: [ 'a', 'z' ] } );
	a.app.remotePlayers.peers.set( 'z', { extra: { plane: z.sp.decorateState( {} ).plane } } );
	airportRank( a.app, a.sp.airport, true );
	a.sp._syncParked();
	assert.notEqual( a.sp.base( 'swift' ).x, firstBase.x, 'earlier lexical id yields to already occupied stand' );
	const aStand = a.sp.base( 'swift' ); a.go( 'swift' ); assert.ok( a.sp.useAirportAircraft( 'swift' ).boarded );
	a.app.remotePlayers.peers.delete( 'z' ); assert.deepEqual( a.sp.base( 'swift' ), aStand );
	z.app.remotePlayers.peers.delete( 'a' ); assert.deepEqual( z.sp.base( 'swift' ), firstBase );
	const b = fixture( { id: 'b', ids: [ 'b', 'z' ] } );
	// A parked room entry remains occupied even without the flying-player field.
	b.app.net.link = { room: { state: { planes: new Map( [ [ 'z:parked', { owner: 'z', af: 'swift', x: firstBase.x, y: firstBase.y, z: firstBase.z, qx: 0, qy: 0, qz: 0, qw: 1 } ] ] ) } } };
	airportRank( b.app, b.sp.airport, true );
	b.sp._syncParked(); assert.notEqual( b.sp.base( 'swift' ).x, firstBase.x );
	assert.ok( a.sp.flight.position.x === aStand.x, 'crew membership cannot relocate the issued aircraft' );
	for ( const w of [ z, a, b ] ) w.sp.dispose();
} );

await test( 'malformed observed peer and parked aircraft cannot throw or poison airport allocation', () => {
	const p = [ - 2760, 2.8, - 950 ], q = [ 0, 0, 0, 1 ];
	const malformed = [
		{ p: { x: p[ 0 ], y: p[ 1 ], z: p[ 2 ] } },
		{ p: { ...p, length: 3 } }, { p: 'bad' }, { p: null },
		{ p: p.slice( 0, 2 ) }, { p: [ ...p, 9 ] }, { p: [ p[ 0 ], NaN, p[ 2 ] ] }, { p: new Array( 3 ) },
		{ q: { ...q, length: 4 } }, { q: null }, { q: 'bad' }, { q: q.slice( 0, 3 ) },
		{ q: [ 0, NaN, 0, 1 ] }, { q: [ 0, 0, 0, Infinity ] }, { q: [ 0, 0, 0, 0 ] }, { q: new Array( 4 ) },
		{ af: '__proto__' }, { af: 'constructor' },
	];
	for ( const bad of malformed ) {
		const w = fixture( { id: 'a', ids: [ 'a', 'z' ] } );
		w.app.remotePlayers.peers.set( 'z', { extra: { plane: { af: 'swift', p, q, ...bad } } } );
		assert.equal( airportRank( w.app, w.sp.airport, true ), 0, 'invalid peer aircraft ignored' );
		assert.doesNotThrow( () => w.sp._syncParked() );
		assert.ok( w.sp.airportMarkers().every( m => Number.isFinite( m.x ) && Number.isFinite( m.z ) ) );
		// A later valid peer state must still reserve the physically occupied pair.
		w.app.remotePlayers.peers.set( 'z', { extra: { plane: { af: 'swift', p, q } } } );
		assert.equal( airportRank( w.app, w.sp.airport, true ), 1 );
		w.sp.dispose();
	}
	const valid = { owner: 'z', af: 'swift', x: p[ 0 ], y: p[ 1 ], z: p[ 2 ], qx: 0, qy: 0, qz: 0, qw: 1 };
	for ( const bad of [ null, {}, { ...valid, x: 'bad' }, { ...valid, z: null }, { ...valid, y: Infinity }, { ...valid, qx: NaN }, { ...valid, qw: undefined }, { ...valid, qw: 0 }, { ...valid, af: '__proto__' } ] ) {
		const w = fixture( { id: 'a', ids: [ 'a', 'z' ] } );
		w.app.net.link = { room: { state: { planes: new Map( [ [ 'z:parked', bad ] ] ) } } };
		assert.equal( airportRank( w.app, w.sp.airport, true ), 0, 'invalid parked aircraft ignored' );
		w.app.net.link.room.state.planes.set( 'z:parked', valid );
		assert.equal( airportRank( w.app, w.sp.airport, true ), 1, 'valid parked state works after malformed entry' );
		w.sp.dispose();
	}
} );

await test( 'online airport actions never write local slots; universe-backed captain adapter still receives saves', () => {
	for ( const staleMode of [ false, true ] ) {
		const local = fixture( { id: 'local', ids: [ 'local' ] } );
		local.app.net.online = true;
		if ( staleMode ) { local.app.mode = 'campaign'; local.state.setMode( 'campaign' ); }
		local.go( 'courier' ); assert.ok( local.sp.useAirportAircraft( 'courier' ).boarded );
		local.sp._save(); assert.equal( local.store.m.size, 0, 'actual connection/mode prevents all local seaplane saves' );
		local.sp.dispose();
	}
	const store = storage(); store.universe = { synthetic: true };
	const universe = fixture( { store, id: 'captain', ids: [ 'captain' ] } );
	universe.go( 'courier' ); assert.ok( universe.sp.useAirportAircraft( 'courier' ).boarded );
	const saved = [ ...store.m.values() ].map( s => JSON.parse( s ) );
	assert.ok( saved.length > 0 && saved.some( d => d.features.seaplane.af === 'courier' && d.features.seaplane.owned ) );
	universe.sp.dispose();
} );

await test( 'production drive suppresses real gamepad reads and auto-start behind own tray or other modal, including toggle frames', () => {
	const prior = Object.getOwnPropertyDescriptor( globalThis, 'navigator' );
	let polls = 0;
	const buttons = Array.from( { length: 16 }, ( _, i ) => ( { value: i === 7 ? 1 : 0, pressed: i === 7 } ) );
	Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { getGamepads() { polls ++; return [ { connected: true, axes: [ 0, 0.4 ], buttons } ]; } } } );
	try {
		for ( const modalType of [ 'tray', 'other' ] ) {
			const w = fixture(); w.go( 'swift' ); assert.ok( w.sp.useAirportAircraft( 'swift' ).boarded );
			if ( modalType === 'tray' ) w.sp.panel.isOpen = true;
			else w.features.list.set( 'test-modal', { instance: { isOpen: () => true } } );
			const beforePolls = polls;
			w.input.keys.add( 'ShiftLeft' );
			for ( let i = 0; i < 10; i ++ ) w.sp.drive( 1 / 60 );
			assert.equal( polls, beforePolls, 'modal owns gamepad input without polling navigator' );
			assert.equal( w.sp.pilot.throttle, 0 ); assert.equal( w.sp.flight.controls.throttle, 0 );
			assert.equal( w.sp.systems.cranking, false ); assert.equal( w.sp.flight.engineOn, false );
			assert.equal( w.sp.flight.controls.pitch, 0 );
			w.sp.pilot.throttle = 0.4; w.sp.drive( 1 / 60 );
			assert.equal( w.sp.pilot.throttle, 0.4, 'modal preserves existing throttle setting without taking held trigger input' );
			assert.equal( w.sp.systems.cranking, false );
			w.sp.panel.isOpen = false; w.features.list.delete( 'test-modal' ); w.input.keys.clear();
			w.sp.drive( 1 / 60 );
			assert.ok( polls > beforePolls && w.sp.pilot.throttle > 0 && w.sp.systems.cranking && w.sp.flight.controls.pitch > 0, 'pad control resumes after modal closes' );
			w.sp.dispose();
		}
		const w = fixture(); w.go( 'courier' ); w.sp.useAirportAircraft( 'courier' );
		// Supply only the tiny DOM host used by the real tray open/close methods.
		w.sp.panel.el = { innerHTML: '', classList: { add() {}, remove() {}, toggle() {} } };
		const oldDocument = Object.getOwnPropertyDescriptor( globalThis, 'document' );
		Object.defineProperty( globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } } );
		try {
			const before = polls;
			w.input.pressed.add( 'Digit3' ); w.sp.drive( 1 / 60 );
			assert.ok( w.sp.panel.isOpen ); assert.equal( polls, before ); assert.equal( w.sp.systems.cranking, false );
			w.input.pressed.clear(); w.input.pressed.add( 'Digit3' ); w.sp.drive( 1 / 60 ); // second press closes through production act path
			assert.equal( w.sp.panel.isOpen, false ); assert.equal( polls, before ); assert.equal( w.sp.pilot.throttle, 0 );
			w.input.pressed.clear(); w.sp.drive( 1 / 60 );
			assert.ok( polls > before && w.sp.systems.cranking, 'pad resumes on the frame after tray close' );
		} finally { w.sp.dispose(); if ( oldDocument ) Object.defineProperty( globalThis, 'document', oldDocument ); else delete globalThis.document; }
	} finally { if ( prior ) Object.defineProperty( globalThis, 'navigator', prior ); else delete globalThis.navigator; }
} );

await test( 'real authored model loader derives correct wings, two Courier props/nacelles and distinct paint without changing Kestrel', async () => {
	const prior = globalThis.__assetFile;
	globalThis.__assetFile = url => { const path = new URL( '../public/' + String( url ).replace( /^\//, '' ), import.meta.url ); const b = fs.readFileSync( path ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
	const models = new PlaneModels( { scene: new Scene(), baseUrl: '/' } );
	try {
		for ( const id of [ 'kestrel', 'swift', 'courier' ] ) {
			const v = models.create( id, AIRFRAMES[ id ].livery || 0 ); await models.ready;
			assert.ok( v.loaded, `${ id } authored model loaded` );
			const wing = v.parts.wingL.children.concat( v.parts.wingR.children );
			let lo = Infinity, hi = - Infinity;
			for ( const m of wing ) { m.geometry.computeBoundingBox(); lo = Math.min( lo, m.geometry.boundingBox.min.x ); hi = Math.max( hi, m.geometry.boundingBox.max.x ); }
			assert.ok( Math.abs( hi - lo - spec( id ).geom.span ) < 0.05, `${ id } rendered span ${ hi - lo }` );
			assert.equal( v.pivots.length, spec( id ).geom.engines?.length || 1 );
			assert.ok( v.pivots.every( p => p.children.length >= 2 ), 'propeller blade and tip meshes attached at every engine' );
			if ( id === 'courier' ) assert.equal( v.meshes.filter( m => m.name === 'seaplane-courier-nacelle' ).length, 2 );
			assert.ok( v.meshes.some( m => /glass/.test( m.name ) ), 'authored cockpit glazing preserved' );
			if ( id !== 'kestrel' ) assert.ok( v.meshes.some( m => m._base?.name.endsWith( 'SeaplaneJade' ) && m.material !== m._base ), 'variant livery applied' );
		}
		assert.ok( ! models.failed );
	} finally { models.dispose(); globalThis.__assetFile = prior; }
} );

for ( const af of AIRPORT_FLEET ) await test( `${ af }: real cockpit controls, starter, throttle, runway takeoff and sustained climb`, () => {
	const w = fixture(), { sp, input } = w; w.go( af ); assert.ok( sp.useAirportAircraft( af ).boarded );
	const l = layoutFor( af );
	for ( const id of [ 'engine', 'master', 'nav', 'landing', 'flapsUp', 'flapsDown', 'trimUp', 'trimDown', 'ap', 'brake', 'map' ] ) {
		const c = l.controls.find( c => c.id === id ); assert.ok( c?.act, `${ id } present and clickable` ); assert.equal( controlAt( l, c.x + c.w / 2, c.y + c.h / 2 ).id, id );
	}
	assert.ok( sp.act( 'nav' ) ); assert.equal( sp.systems.nav, true );
	assert.ok( sp.act( 'brake' ) ); assert.equal( sp.parkBrake, true ); sp.act( 'brake' );
	assert.ok( sp.act( 'flapsDown' ) ); assert.equal( sp.flight.flaps, 1 );
	assert.ok( sp.act( 'trimUp' ) ); assert.equal( sp.pilot.trim, 0.1 ); sp.act( 'trimDown' );
	if ( af === 'courier' ) { assert.ok( sp.act( 'feather2' ) ); assert.equal( sp.flight.engineFail[ 1 ], true ); assert.ok( sp.act( 'feather2' ) ); assert.equal( sp.flight.engineFail[ 1 ], false ); }
	const airport = findAirport( WORLD ), f = sp.flight;
	assert.ok( sp.act( 'engine' ) ); assert.equal( sp.systems.cranking, true );
	let turn = false, aligned = false;
	for ( let i = 0; i < 60 * 100 && ! aligned; i ++ ) {
		input.keys.clear();
		if ( sp.pilot.throttle < 0.18 ) input.keys.add( 'ShiftLeft' );
		if ( f.airspeed > 4.5 && sp.pilot.throttle > 0.1 ) input.keys.add( 'KeyC' );
		if ( f.position.z > airport.z - 12 ) turn = true;
		if ( turn ) input.keys.add( 'KeyA' );
		sp.drive( 1 / 60 );
		aligned = turn && f.heading() > Math.PI / 2 - 0.06;
	}
	assert.ok( aligned && Math.abs( f.position.z - airport.z ) < airport.width / 2, 'taxied from actual stand and turned onto runway: ' + JSON.stringify( { p: f.position.toArray(), h: f.heading() } ) );
	assert.equal( sp.lost, false ); input.keys.clear();
	const takeoffStart = f.position.x;
	input.keys.add( 'ShiftLeft' ); let lift = null, maxAlt = 0;
	for ( let i = 0; i < 60 * 50; i ++ ) {
		if ( f.forwardSpeed > ( af === 'swift' ? 18 : 24 ) && ! f.airborne ) input.keys.add( 'KeyS' ); else input.keys.delete( 'KeyS' );
		sp.drive( 1 / 60 );
		if ( f.airborne && ! lift ) lift = { run: f.position.x - takeoffStart, speed: f.airspeed, seconds: i / 60 };
		if ( lift && ! sp.pilot.ap.on && f.agl > 20 ) assert.ok( sp.act( 'ap' ) );
		maxAlt = Math.max( maxAlt, f.position.y - airport.y );
		if ( lift && maxAlt > 30 ) break;
	}
	assert.ok( lift && lift.run > 60 && lift.run < 400, JSON.stringify( lift ) );
	assert.ok( f.engineOn && sp.piloted && ! sp.lost && maxAlt > 20, `flight maintained, max altitude ${ maxAlt }` );
	assert.equal( w.events.filter( e => e.name === 'planeCrashed' ).length, 0 );
	assert.ok( w.events.some( e => e.name === 'planeTookOff' ) );
	const snap = panelSnapshot( sp ); assert.equal( snap.name, AIRFRAMES[ af ].name ); assert.ok( Math.abs( snap.litres / snap.fuel - AIRFRAMES[ af ].litres ) < 1e-6 );
	assert.equal( snap.gear, true ); assert.equal( sp.canExit(), false, 'cannot exit a flying aircraft' );
	console.log( `  ${ af }: liftoff ${ lift.run.toFixed( 1 ) } m / ${ lift.speed.toFixed( 1 ) } m/s / ${ lift.seconds.toFixed( 1 ) } s; peak ${ maxAlt.toFixed( 1 ) } m` );
	sp.dispose();
} );

console.log( `${ passed } airport fleet integration groups passed; no GPU, network, browser or original writes.` );
