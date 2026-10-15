import assert from 'node:assert/strict';
globalThis.location = { search: '' };
const { App } = await import( '../src/App.js' );
const { isOnlineSession, rules } = await import( '../src/game/GameMode.js' );
const { SaveManager } = await import( '../src/ui/SaveManager.js' );
const { PauseMenu } = await import( '../src/ui/PauseMenu.js' );
const { Features } = await import( '../src/features/Features.js' );
const { DebugPanel } = await import( '../src/ui/DebugPanel.js' );
const { sanitizeState, sanitizeHelicopter } = await import( '../src/net/Protocol.js' );
let checks = 0;
function check( name, fn ) { fn(); checks ++; console.log( 'PASS', name ); }

for ( const app of [ { mode: 'multiplayer' }, { rules: rules( 'multiplayer' ) }, { mode: 'sandbox', net: { online: true } } ] ) {
	check( 'online local-save mutations refuse without touching storage', () => {
		const storage = { getItem: () => null, setItem: () => { throw Error( 'unexpected write' ); }, removeItem: () => { throw Error( 'unexpected delete' ); } };
		const saves = new SaveManager( { app, storage } );
		assert.equal( isOnlineSession( app ), true );
		for ( const result of [ saves.importText( 0, '{}' ), saves.duplicate( 0, 1 ), saves.restore( 0, 0 ), saves.copyServerTo( 1 ) ] ) assert.equal( result.ok, false );
		assert.equal( saves.deleteSlot( 0 ), false );
	} );
}
check( 'solo slots remain writable', () => assert.equal( new SaveManager( { app: { mode: 'campaign' }, storage: null } ).readOnly, false ) );
check( 'connected sandbox cannot open or execute cheats', () => {
	const app = { mode: 'sandbox', net: { online: true } }, features = new Features( app );
	assert.equal( features.sandbox, false );
	const debug = new DebugPanel( app, features );
	assert.equal( debug.open(), false ); assert.equal( debug.addMoney( 1000 ), null ); assert.equal( debug.teleport( 'home' ), false );
	debug.dispose();
} );
check( 'local quick-save refuses online but preserves server profile writes', () => {
	let writes = 0;
	const app = { mode: 'multiplayer', rules: rules( 'multiplayer' ), game: { state: { storage: {}, save: () => ( writes ++, true ) } } };
	assert.equal( App.prototype.saveNow.call( app ), false ); assert.equal( writes, 0 );
	app.game.state.storage.universe = {};
	assert.equal( App.prototype.saveNow.call( app ), true ); assert.equal( writes, 1 );
} );
check( 'Settings Connect saves solo then loads the separate multiplayer profile', () => {
	for ( const mode of [ 'sandbox', 'campaign' ] ) {
		const calls = [];
		const app = { mode, session: true, saveNow: () => calls.push( 'save' ), startSession: choice => { calls.push( choice ); return true; } };
		assert.equal( App.prototype.connect.call( app, 'ws://127.0.0.1:8875/island' ), true );
		assert.deepEqual( calls, [ 'save', { mode: 'multiplayer', slot: 0, server: 'ws://127.0.0.1:8875/island' } ] );
	}
} );
await ( async () => {
	let opened = false;
	const result = await App.prototype.openLoadMenu.call( { mode: 'multiplayer', game: { toast() {} }, menu: { show: () => { opened = true; } } } );
	assert.equal( result, false ); assert.equal( opened, false ); checks ++; console.log( 'PASS online load menu refused before session changes' );
} )();
check( 'online pause has no save/load/import controls; solo still does', () => {
	function render( online ) {
		const el = { innerHTML: '', querySelector( selector ) { const attr = selector.slice( 1, -1 ); return this.innerHTML.includes( attr ) ? { addEventListener() {} } : null; } };
		PauseMenu.prototype._render.call( { el, app: { rules: { online, autosave: ! online } } } ); return el.innerHTML;
	}
	for ( const attr of [ 'data-save', 'data-load', 'data-saves' ] ) { assert.ok( ! render( true ).includes( attr ) ); assert.ok( render( false ).includes( attr ) ); }
} );
check( 'helicopter state survives real protocol and normalizes transforms', () => {
	const state = sanitizeState( { p: [ 1, 2, 3 ], yaw: 0, mode: 'seat', helicopter: { p: [ 40, 500, - 12 ], q: [ 0, 0, 0, 2 ], rpm: 5, homeSlot: 42, piloted: true } } );
	assert.deepEqual( state.helicopter, { p: [ 40, 500, -12 ], q: [ 0, 0, 0, 1 ], rpm: 1, homeSlot: 15, piloted: true } );
	for ( const bad of [ {}, { p: [ NaN, 0, 0 ], q: [ 0, 0, 0, 1 ] }, { p: [ 0, 0, 0 ], q: [ 0, 0, 0, 0 ] }, { p: [ 1e9, 0, 0 ], q: [ 0, 0, 0, 1 ] } ] ) assert.equal( sanitizeHelicopter( bad ), undefined );
} );
console.log( `${ checks } multiplayer restriction checks passed` );
