// Plain-node tests of the platform layer: the perf scenario definitions and helpers (tools/perf/scenarios.js), the
// scenario runner against a stand-in app (tools/perf/runner.js), and the pieces with no browser in them: controller
// glyphs (src/ui/Glyphs.js), gamepad mapping / rumble / settings (src/core/Gamepad.js), camera kicks
// (src/game/CameraFeel.js), the error log ring buffer (src/core/ErrorLog.js) and the sandbox debug actions (src/ui/DebugPanel.js).
import * as THREE from '../src/engine/index.js';
import {
	SCENARIOS, SCENARIO_IDS, DEFAULT_SET, VIEW_SET, SCOPES, P2_KINDS, parsePerfQuery, validateScenario, summarize, budget, rankScopes, cullingCandidates,
} from '../tools/perf/scenarios.js';
import { runPerf, wrapScope, installScopes } from '../tools/perf/runner.js';
import { BOAT_IDS } from '../src/game/Boats.js';
import { SHIP_CLASSES } from '../src/features/naval/ShipClasses.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { GamepadInput, padFamily, applyDeadZone, RUMBLE } from '../src/core/Gamepad.js';
import { attachGlyphs, glyph, glyphFor, glyphHTML, keyName, currentDevice } from '../src/ui/Glyphs.js';
import { CameraFeel } from '../src/game/CameraFeel.js';
import { ErrorLog, describe } from '../src/core/ErrorLog.js';
import { DebugPanel } from '../src/ui/DebugPanel.js';
import { GameState } from '../src/game/GameState.js';
import { QualityLoop, Quality, TIERS, TIER_IDS, pickFromProbe, STORAGE_KEY } from '../src/core/Quality.js';
import { readFileSync, existsSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- the scenario definitions
{

	const known = { boats: BOAT_IDS, ports: WORLD.ports.map( ( p ) => p.id ), shipKinds: Object.keys( SHIP_CLASSES ) };
	for ( const id of SCENARIO_IDS ) {

		const probs = validateScenario( SCENARIOS[ id ], known );
		ok( probs.length === 0 && SCENARIOS[ id ].id === id, `scenario ${ id } is valid${ probs.length ? ': ' + probs.join( '; ' ) : '' }` );

	}

	for ( const need of [ 'navalFight', 'storm', 'night', 'crowd' ] ) ok( DEFAULT_SET.includes( need ), `default set has ${ need }` );
	ok( SCENARIOS.navalFight.ships.some( ( s ) => s.kind !== 'trawler' ) && SCENARIOS.navalFight.fire, 'naval fight: pirates and gunfire' );
	ok( SCENARIOS.storm.weather === 'storm' && SCENARIOS.storm.intensity === 1, 'storm: full storm' );
	ok( SCENARIOS.night.time >= 21 || SCENARIOS.night.time < 4, 'night: at night' );
	ok( SCENARIOS.crowd.peers >= 12, 'crowd: a dozen players or more' );
	ok( validateScenario( { id: 'x', name: 'x', time: 30, place: { kind: 'swim' }, ships: [ { kind: 'galleon', dx: 1, dz: 1 } ], peers: 99 }, known ).length >= 4, 'a broken scenario is reported' );
	ok( validateScenario( { ...SCENARIOS.navalFight, ships: [ { kind: 'sloop', dx: 5, dz: 5 } ] }, known ).some( ( p ) => /closer/.test( p ) ), 'a ship spawned on top of the player is refused' );
	ok( parsePerfQuery( '' ).join() === DEFAULT_SET.join() && parsePerfQuery( 'storm,night,bogus' ).join() === 'storm,night' && parsePerfQuery( 'every' ).length === SCENARIO_IDS.length - VIEW_SET.length && parsePerfQuery( 'views' ).join() === VIEW_SET.join(), 'parsePerfQuery (every: the old set; views: the wave 16C places)' );
	ok( SCOPES.every( ( s ) => s.length === 3 && typeof s[ 0 ] === 'string' ), 'scopes are [ label, path, method ]' );

}

// ---- numbers
{

	const s = summarize( [ 10, 12, 14, 16, 30, NaN ] );
	ok( s.n === 5 && s.mean === 16.4 && s.p50 === 14 && s.max === 30 && s.min === 10, 'summarize' );
	ok( summarize( [] ).n === 0, 'summarize of nothing' );
	const b = budget( [ 10, 17, 20, 15 ] );
	ok( b.over === 2 && b.share === 0.5, 'budget counts frames over 16.7 ms' );
	const rows = rankScopes( [ { a: 2, b: 1 }, { a: 4 }, { a: 3, b: 3 } ] );
	ok( rows[ 0 ].name === 'a' && rows[ 0 ].mean === 3 && rows[ 1 ].mean === 1.333 && Math.abs( rows[ 0 ].share + rows[ 1 ].share - 1 ) < 0.01, 'rankScopes (a missing scope costs 0 that frame)' );
	const rep = { scenarios: { crowd: { scopes: [ { name: 'residents', mean: 1.2, p95: 2, share: 0.2 }, { name: 'post', mean: 3, p95: 3, share: 0.5 } ] } } };
	const c = cullingCandidates( rep );
	ok( c.candidates.length === 1 && c.candidates[ 0 ].kind === 'residents' && c.candidates[ 0 ].scenario === 'crowd', 'P2 candidate from numbers' );
	ok( c.unverified.some( ( u ) => u.kind === 'projectiles' ) && c.unverified.length === P2_KINDS.length - 1, 'P2 kinds without numbers are unverified' );

}

// ---- the runner against a stand-in app
{

	let t = 0;
	const sink = {};
	const o = { work() { t += 1; return 7; } };
	const undo = wrapScope( o, 'work', 'w', sink );
	ok( o.work() === 7 && sink.w >= 0 && Object.prototype.hasOwnProperty.call( o, 'work' ), 'wrapScope times and passes the result' );
	undo();
	const proto = { update() { return 1; } };
	const inst = Object.create( proto );
	const u2 = wrapScope( inst, 'update', 'u', sink );
	u2();
	ok( ! Object.prototype.hasOwnProperty.call( inst, 'update' ) && inst.update === proto.update, 'undo of a prototype method leaves no own property' );

	const calls = { spawn: 0, fire: 0, removed: 0, manual: [], peers: new Set(), states: 0, frames: 0 };
	const ships = [];
	const busy = ( ms ) => { const e = performance.now() + ms; while ( performance.now() < e ) { /* spin */ } };
	const naval = {
		ships, playerGun: { owned: false },
		spawn( kind, opts ) { calls.spawn ++; const s = { kind, ...opts }; ships.push( s ); return s; },
		fire() { calls.fire ++; return true; },
		_removeShip( i ) { calls.removed ++; ships.splice( i, 1 ); },
		update() { busy( 0.05 * ships.length ); },
	};
	const weather = { setManual( k ) { calls.manual.push( k ); return true; }, update() {} };
	const residents = { update() { busy( 0.02 ); } };
	const list = new Map( [ [ 'naval', { instance: naval } ], [ 'weather', { instance: weather } ] ] );
	const store = new Map();
	const state = new GameState( { getItem: ( k ) => store.get( k ) ?? null, setItem: ( k, v ) => store.set( k, v ) } );
	state.setMode( 'sandbox' );
	const app = {
		mode: 'sandbox', settings: { timeOfDay: 9, timeSpeed: 0.01 }, game: { state },
		player: { mode: 'walk', position: new THREE.Vector3(), enterBoat() { this.mode = 'boat'; }, boardBoat() { this.mode = 'deck'; }, leaveHelm() { this.mode = 'deck'; }, exitBoat() { this.mode = 'walk'; } },
		boatCtl: { position: new THREE.Vector3() }, residents,
		features: { list, get: ( n ) => ( list.get( n ) || {} ).instance || null, update() { for ( const f of list.values() ) f.instance.update(); } },
		remotePlayers: { applyStates( l ) { calls.states ++; for ( const s of l ) calls.peers.add( s.id ); }, removePeer( id ) { calls.peers.delete( id ); } },
		setBoat() {}, _placePlayer( x, y, z ) { this.player.position.set( x, y, z ); },
		frame() { calls.frames ++; this.features.update(); this.residents.update(); },
	};
	const report = await runPerf( app, { scenarios: 'navalFight,crowd,storm', frames: 30, warm: 5, dt: 0.05, waitGpu: null } );
	ok( Object.keys( report.scenarios ).join() === 'navalFight,crowd,storm', 'runner ran the three scenarios' );
	ok( calls.frames === 3 * 35, 'warm-up plus measured frames rendered' );
	const nf = report.scenarios.navalFight;
	ok( nf.cpu.n === 30 && nf.cpu.mean > 0 && nf.budget.ms > 16, 'CPU frame times recorded' );
	ok( nf.scopes.some( ( s ) => s.name === 'feature:naval' && s.mean > 0 ) && nf.scopes.some( ( s ) => s.name === 'residents' ), 'per-feature and per-system scopes' );
	ok( ! nf.scopes.some( ( s ) => s.name === 'features' ), 'the features aggregate is left out when each feature has its own scope' );
	ok( calls.spawn === SCENARIOS.navalFight.ships.length && calls.removed === calls.spawn && ships.length === 0, 'ships spawned and taken away again' );
	ok( calls.fire >= 1 && naval.playerGun.owned === false, 'guns fired; the gun purchase undone' );
	ok( state.boat === 'launch', 'the scenario boats were taken (free in the sandbox; the storm deck is the last)' );
	ok( store.size === 0, 'no save written during the run' );
	ok( report.scenarios.crowd.setup.peers === 16 && calls.states > 0 && calls.peers.size === 0, 'crowd: stand-in players fed and removed' );
	ok( calls.manual.includes( 'storm' ) && calls.manual[ calls.manual.length - 1 ] === null, 'storm: weather picked and released' );
	ok( app.settings.timeSpeed === 0.01 && typeof state.storage === 'object' && state.storage, 'clock speed and storage restored' );
	ok( Array.isArray( report.candidates ) && Array.isArray( report.unverified ), 'report carries the P2 lists' );
	const und = installScopes( app, {} );
	ok( Object.prototype.hasOwnProperty.call( naval, 'update' ), 'installScopes wraps feature updates' );
	und();

}

// ---- gamepad: family, dead zone, mapping through the remap table, device switch, rumble, settings
{

	ok( padFamily( 'Xbox 360 Controller (XInput STANDARD GAMEPAD)' ) === 'xbox' && padFamily( 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' ) === 'playstation' && padFamily( '054c-09cc-Wireless Controller' ) === 'playstation' && padFamily( 'Generic USB Joystick' ) === 'gamepad', 'padFamily' );
	ok( applyDeadZone( 0.1, 0.2 ) === 0 && Math.abs( applyDeadZone( 1, 0.2 ) - 1 ) < 1e-9 && Math.abs( applyDeadZone( - 0.6, 0.2 ) + 0.5 ) < 1e-9, 'dead zone' );
	const effects = [];
	const buttons = Array.from( { length: 17 }, () => ( { pressed: false, value: 0 } ) );
	const pad = { id: 'DualSense Wireless Controller (054c)', connected: true, axes: [ 0, 0, 0, 0 ], buttons, vibrationActuator: { type: 'dual-rumble', playEffect: ( type, p ) => { effects.push( p ); return Promise.resolve(); } } };
	Object.defineProperty( globalThis, 'navigator', { value: { getGamepads: () => [ pad ], userAgent: 'node' }, configurable: true } );
	const input = { keys: new Set(), pressed: new Set(), look: { x: 0, y: 0 }, mouseDown: false, rightDown: false, padButton: ( code, d ) => ( code === 'KeyE' ? 3 : d ) };
	const gp = new GamepadInput( input );
	const seen = [];
	gp.onDeviceChange( ( d ) => seen.push( d ) );
	buttons[ 3 ].pressed = true; // remapped: KeyE sits on Y / triangle
	gp.update();
	ok( input.keys.has( 'KeyE' ) && input.pressed.has( 'KeyE' ), 'remapped button presses its logical key' );
	ok( gp.device === 'playstation' && seen[ 0 ] === 'playstation', 'pad use switches the last device' );
	buttons[ 3 ].pressed = false;
	gp.update();
	ok( ! input.keys.has( 'KeyE' ), 'release' );
	ok( gp.setDeadZone( 0.9 ) === 0.6 && gp.setSensitivity( 2 ) === 2 && gp.lookSpeed === 22 && gp.setSensitivity( 9 ) === 3, 'dead zone / sensitivity setters clamp' );
	gp.setSensitivity( 1 );
	gp.setDeadZone( 0.2 );
	pad.axes[ 2 ] = 1;
	gp.update();
	ok( input.look.x > 10, 'right stick looks' );
	pad.axes[ 2 ] = 0;
	ok( gp.rumble( 'cannon' ) && effects[ 0 ].strongMagnitude === RUMBLE.cannon.strong && effects[ 0 ].duration === RUMBLE.cannon.duration, 'rumble preset reaches the actuator' );
	ok( ! gp.rumble( 'snap' ), 'a weaker rumble does not cut a stronger one' );
	gp.setRumble( 0.5 );
	gp._rumbleUntil = 0;
	gp.rumble( { duration: 100, strong: 1, weak: 1 } );
	ok( effects[ effects.length - 1 ].strongMagnitude === 0.5, 'rumble strength scales' );
	gp.setRumble( 0 );
	ok( ! gp.rumble( 'broadside' ), 'rumble off' );

	// glyphs follow the device
	const app = { gamepad: gp, input: { ...input, _bindings: { KeyE: 'KeyG' } } };
	attachGlyphs( app );
	ok( currentDevice() === 'playstation' && glyph( 'interact' ) === '△' && glyph( 'jump' ) === '✕', 'PlayStation glyphs (with the remap)' );
	ok( glyph( 'interact', 'xbox' ) === 'Y' && glyph( 'cooler', 'xbox' ) === 'D-pad ↑' && glyph( 'move', 'xbox' ) === 'Left stick', 'Xbox glyphs' );
	gp._setDevice( 'keyboard' );
	ok( glyph( 'interact' ) === 'G' && glyph( 'sprint' ) === 'Shift' && glyph( 'cast' ) === 'LMB', 'keyboard glyphs follow the key bindings' );
	ok( glyph( 'portGuns', 'xbox' ) === 'Z', 'an action with no pad button keeps its key' );
	ok( glyphFor( 'KeyQ' ).label === 'Q' && keyName( 'Digit3' ) === '3' && keyName( 'Backquote' ) === '`', 'raw codes and key names' );
	ok( /data-glyph="interact"/.test( glyphHTML( 'interact' ) ) && /glyph-keyboard/.test( glyphHTML( 'interact' ) ), 'glyphHTML' );

}

// ---- camera feel: the new kicks, reduce motion, the shake slider, rumble, feature events
{

	const rumbles = [];
	const cam = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 60, updateProjectionMatrix() {} };
	const listeners = new Map();
	const features = { on: ( n, fn ) => { listeners.set( n, fn ); return () => listeners.delete( n ); } };
	const app = { camera: cam, settings: { reduceMotion: false, cameraShake: 1 }, gamepad: { rumble: ( t, k ) => rumbles.push( [ t, k ] ) }, features };
	const f = new CameraFeel( app );
	for ( const k of [ 'recoil', 'hit', 'broadside', 'boarding', 'cast', 'strike', 'catch', 'snap' ] ) ok( f.kick( k ) === true, `kick ${ k }` );
	ok( f.kick( 'nonsense' ) === false, 'unknown kick refused' );
	ok( rumbles.some( ( r ) => r[ 0 ] === 'cannon' ) && rumbles.some( ( r ) => r[ 0 ] === 'broadside' ) && ! rumbles.some( ( r ) => r[ 0 ] === undefined ), 'kicks rumble with their preset' );
	f.update( 1 / 60 );
	ok( listeners.has( 'cannonFired' ) && listeners.has( 'playerBoatDamaged' ) && listeners.has( 'boardingStarted' ) && listeners.has( 'explosion' ), 'feature events bound on update' );
	for ( let i = 0; i < 60; i ++ ) f.update( 1 / 60 );
	ok( ! f.active && cam.fov === 60, 'everything settles back to the base FOV' );
	const g = new CameraFeel( { ...app, features: null, settings: { reduceMotion: true } } );
	g.kick( 'recoil' );
	g.kick( 'broadside' );
	ok( ! g._recoil && ! g._shake && g._kicks.length === 2, 'reduce motion: no tilt or shake, mild FOV kicks stay' );
	const h = new CameraFeel( { ...app, features: null, settings: { cameraShake: 0 } } );
	h.kick( 'hit' );
	ok( ! h._shake, 'shake slider at 0: no shake' );
	const before = f._shake;
	listeners.get( 'playerBoatDamaged' )( { hp: 50, maxHp: 100, cause: 'cannon' } );
	ok( f._shake && f._shake !== before && f._shake.amp > 0.02, 'a heavy hull hit is a broadside kick' );
	const q = new CameraFeel( { ...app, features: null } );
	q.kick( 'explosion', { x: 500, z: 500, radius: 5 } );
	ok( ! q._shake, 'a far explosion does nothing' );
	q.kick( 'explosion', { x: 3, y: 0, z: 0, radius: 6, energy: 2000 } );
	ok( !! q._shake, 'a near explosion shakes' );

}

// ---- error log
{

	let now = 1000;
	const log = new ErrorLog( { capacity: 5, now: () => now } );
	const target = new EventTarget();
	const con = { error() {}, warn() {} };
	log.install( { target, console: con, key: null } );
	con.error( 'boom', new Error( 'bad thing' ) );
	con.warn( 'feature naval update failed' );
	const ev = new Event( 'error' );
	ev.message = 'Uncaught TypeError: x is undefined';
	ev.filename = 'App.js';
	ev.lineno = 10;
	target.dispatchEvent( ev );
	const rej = new Event( 'unhandledrejection' );
	rej.reason = new Error( 'promise went wrong' );
	target.dispatchEvent( rej );
	ok( log.entries.length === 4 && log.entries.map( ( e ) => e.kind ).join() === 'console,warn,error,rejection', 'captures console, warnings, errors and rejections' );
	ok( log.entries[ 2 ].source === 'App.js:10:0' && log.errorCount === 3, 'source and error count' );
	con.warn( 'feature naval update failed' );
	ok( log.entries.length === 4 && log.entries[ 1 ].count === 2, 'a repeat bumps the count' );
	for ( let i = 0; i < 10; i ++ ) log.push( 'error', 'e' + i );
	ok( log.entries.length === 5 && log.entries[ 4 ].message === 'e9', 'ring buffer keeps the newest' );
	const text = log.text( { header: false } );
	ok( /e9/.test( text ) && ! /e4\b/.test( text ), 'text() for the copy button' );
	log.uninstall();
	con.error( 'after' );
	ok( ! log.entries.some( ( e ) => e.message === 'after' ), 'uninstall restores the console' );
	ok( describe( new TypeError( 't' ) ).message === 'TypeError: t' && describe( { a: 1 } ).message === '{"a":1}', 'describe' );

}

// ---- debug panel actions (headless: no window or document; sandbox only)
{

	const store = new Map();
	const st = new GameState( { getItem: ( k ) => store.get( k ) ?? null, setItem: ( k, v ) => store.set( k, v ) } );
	let mode = 'campaign';
	const features = { get sandbox() { return mode === 'sandbox'; }, claimKey: () => true };
	const pos = new THREE.Vector3();
	const app = { settings: { timeOfDay: 9 }, game: { state: st }, player: { mode: 'walk', position: pos }, _placePlayer: ( x, y, z ) => pos.set( x, y, z ), saveNow: () => st.save() };
	const d = new DebugPanel( app, features );
	ok( ! d.setTime( 3 ) && d.addMoney( 5 ) === null && ! d.teleport( 'pons' ), 'campaign: every debug action refuses' );
	mode = 'sandbox';
	st.setMode( 'sandbox' );
	ok( d.setTime( 25 ) && app.settings.timeOfDay === 1, 'time (wrapped)' );
	ok( d.addXp( 150 ).xp === 150 && d.addMoney( 1000 ) === 1000, 'xp and money' );
	const fish = d.giveFish( 'grunt', 0.9 );
	ok( fish && fish.species === 'grunt' && st.inventory.length === 1, 'give fish' );
	ok( d.teleport( 'gull' ) && Math.hypot( pos.x - WORLD.ports.find( ( p ) => p.id === 'gull' ).stand.x, pos.z - WORLD.ports.find( ( p ) => p.id === 'gull' ).stand.z ) < 0.01 && st.discovered.includes( 'gull' ), 'teleport to a WORLD.ports stand (and discover it)' );
	ok( d.saveNow() && store.size > 0, 'save now' );

}

// ---- auto quality: the state machine (core/Quality.js QualityLoop) fed with frame times
{

	const feed = ( loop, ms, seconds, busy = null ) => {

		const out = [];
		for ( let t = 0; t < seconds * 1000; t += ms ) {

			const c = loop.frame( ms, busy ?? ms );
			if ( c ) out.push( c );

		}

		return out;

	};
	ok( TIER_IDS.join() === 'low,medium,high,ultra' && TIER_IDS.every( ( t ) => TIERS[ t ].scale[ 0 ] < TIERS[ t ].scale[ 1 ] ), 'four tiers with a scale range each' );
	ok( TIERS.high.shadowSize === 2048 && TIERS.high.shadowFar === 400 && TIERS.high.ao && TIERS.high.scale[ 1 ] === 1 && TIERS.high.aa === 4 && TIERS.high.draw === 1, 'High is the look the game always had' );
	ok( TIERS.low.draw < TIERS.medium.draw && TIERS.medium.draw < TIERS.high.draw && TIERS.low.particles < TIERS.high.particles && TIERS.low.lights < TIERS.high.lights, 'budgets fall with the tier' );

	// 24 fps at High: steps the scale down first, then the tier, until the target holds
	const a = new QualityLoop( { tier: 'high', scale: 1, target: 60 } );
	let ch = feed( a, 41.7, 2.1 );
	ok( ch.length === 0, 'the first window is not judged (start-up)' );
	ch = feed( a, 41.7, 2.1 );
	ok( ch.length === 1 && ch[ 0 ].tier === 'high' && ch[ 0 ].scale === 0.9, 'over budget: render scale -0.1 inside the tier' );
	ch = feed( a, 41.7, 2.1 );
	ok( ch.length === 0, 'the window after a change is skipped' );
	feed( a, 41.7, 40 );
	ok( a.tier === 'low' && a.history.some( ( c ) => c.tier === 'medium' ), 'keeps stepping: High -> Medium -> Low' );
	feed( a, 41.7, 30 );
	ok( a.tier === 'low' && a.scale === 0.5 && a.target === 30, 'nothing left at 60 fps: holds 30 (a weak GPU)' );
	ok( feed( a, 30, 20 ).length === 0, '30 fps at the 30 target: no change' );

	// headroom: steps back up, but never above the ceiling (High), and only after two good windows
	const b = new QualityLoop( { tier: 'low', scale: 0.5, target: 60, ceiling: 'high' } );
	feed( b, 16.7, 2.1, 5 );
	ch = feed( b, 16.7, 2.1, 5 );
	ok( ch.length === 0, 'one good window is not enough' );
	ch = feed( b, 16.7, 2.1, 5 );
	ok( ch.length === 1 && ch[ 0 ].scale === 0.6 && ch[ 0 ].tier === 'low', 'two good windows: scale up' );
	feed( b, 16.7, 200, 5 );
	ok( b.tier === 'high' && b.scale === 1, 'climbs back to High at full scale' );
	ok( feed( b, 16.7, 60, 4 ).length === 0 && b.tier === 'high', 'never above the ceiling' );

	// vsync-capped frames with a busy GPU: no step up (busy time decides), no step down (frame time is on target)
	const c = new QualityLoop( { tier: 'medium', scale: 0.7, target: 60 } );
	ok( feed( c, 16.7, 30, 14 ).length === 0, 'on target with no headroom: holds' );

	// flapping: a reversal doubles the wait before the next step up
	const d = new QualityLoop( { tier: 'high', scale: 0.8, target: 60 } );
	feed( d, 16.7, 2.1, 5 );
	feed( d, 16.7, 4.2, 5 );
	ok( d.scale === 0.9, 'up' );
	feed( d, 25, 4.2 );
	ok( d.scale === 0.8, 'down again' );
	const before = d.history.length;
	feed( d, 16.7, 8.4, 5 );
	ok( d.history.length === before, 'after a reversal two good windows no longer step up' );
	feed( d, 16.7, 12, 5 );
	ok( d.history.length === before + 1, 'four good windows do' );

	// manual choice, auto off
	const e = new QualityLoop( { tier: 'high', auto: false } );
	ok( feed( e, 50, 20 ).length === 0, 'auto off: no changes' );
	e.set( 'ultra' );
	ok( e.tier === 'ultra' && e.ceiling === 'ultra' && e.scale === 1, 'a manual tier sets the ceiling and the top of its range' );

	// the first-run probe
	ok( pickFromProbe( 6 ).tier === 'high' && pickFromProbe( 6 ).scale === 1, 'probe: a fast GPU starts at High 100%' );
	const p2 = pickFromProbe( 20 );
	ok( p2.tier === 'high' && p2.scale < 1 && p2.scale >= 0.7, 'probe: a little over budget starts at High with a lower scale' );
	ok( pickFromProbe( 30 ).tier === 'medium' && pickFromProbe( 50 ).tier === 'low', 'probe: Medium, Low' );
	ok( pickFromProbe( 80 ).target === 30 && pickFromProbe( 80 ).scale === 0.5, 'probe: a very slow GPU holds 30 fps' );

	// Quality on a stand-in app: ?quality=low applies the tier everywhere and is not remembered; the saved choice loads
	const store = new Map();
	const storage = { getItem: ( k ) => store.get( k ) ?? null, setItem: ( k, v ) => store.set( k, v ) };
	const shadowCalls = [];
	const mkApp = () => ( {
		settings: { renderScale: 1 }, post: { setAO( on ) { this.ao = on; }, motionBlur: { shutter: { value: 0.5 } }, haze: { shafts: { value: 1 } }, aaMode: 'taa', taau: { jitterPhaseOverride: 4 } },
		setRenderScale( v ) { this.settings.renderScale = v; },
		shadows: { enabled: true, setSize( n ) { shadowCalls.push( n ); }, setReach( m ) { this.reach = m; } },
		waterMaterial: { params: { ssr: { value: 1 } } }, localLights: { limit: 8 }, engine: { meshRenderer: { distanceScale: 1 } },
		residents: { setRadii( r ) { this.r = r; } },
	} );
	const app1 = mkApp();
	const q1 = new Quality( app1, { storage, query: new URLSearchParams( '?quality=low' ) } );
	ok( q1.tier === 'low' && ! q1.auto && app1.settings.renderScale === 0.7 && app1.post.ao === false && app1.post.motionBlur.shutter.value === 0 && app1.post.haze.shafts.value === 0, '?quality=low: Low, no auto, its post' );
	ok( app1.waterMaterial.params.ssr.value === 0 && app1.localLights.limit === 8 && app1.engine.meshRenderer.distanceScale === 0.55 && app1.residents.r.hide === 120 && shadowCalls.at( - 1 ) === 1024 && app1.shadows.reach === 150, 'Low: reflections, lamps, draw distance, residents, shadows' );
	q1.setTier( 'high' );
	ok( app1.post.ao === true && app1.post.motionBlur.shutter.value === 0.5 && app1.post.haze.shafts.value === 1 && app1.settings.renderScale === 1 && shadowCalls.at( - 1 ) === 2048, 'back to High restores the values the panels had' );
	ok( ! store.has( STORAGE_KEY ), 'a URL override is not saved' );
	const app2 = mkApp();
	const q2 = new Quality( app2, { storage, query: new URLSearchParams( '' ) } );
	ok( q2.auto && ! q2.probed && q2.tier === 'high', 'first run: auto, probe pending' );
	q2._finishProbe( 30 );
	ok( q2.tier === 'medium' && q2.probed && JSON.parse( store.get( STORAGE_KEY ) ).tier === 'medium', 'probe result applied and saved' );
	const q3 = new Quality( mkApp(), { storage, query: new URLSearchParams( '' ) } );
	ok( q3.tier === 'medium' && q3.probed, 'the saved choice loads (no second probe)' );
	ok( /Medium/.test( q3.describe() ) && /Auto/.test( q3.describe() ), 'describe() for the HUD line' );
	const qb = new Quality( mkApp(), { storage, query: new URLSearchParams( '?bench' ) } );
	ok( ! qb.auto && qb.probed, '?bench: a fixed tier, no probe' );

}

// ---- the perf budget guardrail: the 'all' scenario's CPU time per frame from the last headless run on this machine
// (node tools/perf/headless.mjs --perf=all --tag=guard writes tools/perf/out/perf-guard.json; docs/PERF.md has the
// numbers). The budget comes from the wave 4 measurements; a run over it fails here. No run: skipped.
{

	// 'all' scenario, mean CPU ms per frame in Node + Dawn (docs/PERF.md: 39-45 before wave 4, 19-26 after on the RTX 5070 Ti
	// laptop; runs vary with the machine's load): over 30 means most of the wave 4 savings are gone
	const BUDGET_ALL_CPU_MS = 30;
	const f = new URL( '../tools/perf/out/perf-guard.json', import.meta.url );
	if ( existsSync( f ) ) {

		const r = JSON.parse( readFileSync( f, 'utf8' ) );
		const all = r.scenarios && r.scenarios.all;
		ok( all && all.cpu.mean <= BUDGET_ALL_CPU_MS, `'all' scenario CPU ${ all ? all.cpu.mean.toFixed( 2 ) : '?' } ms per frame <= ${ BUDGET_ALL_CPU_MS } ms (${ r.at })` );

	} else console.log( 'skip  perf budget (no tools/perf/out/perf-guard.json: node tools/perf/headless.mjs --perf=all --tag=guard)' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
