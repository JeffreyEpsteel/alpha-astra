import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { GameState, SAVE_KEY, SLOTS } from '../src/game/GameState.js';
import { SaveVault, attachVault, backupKey, corruptKey, wrapExport, EXPORT_FORMAT, SAVE_SCHEMA } from '../src/game/SaveVault.js';
import { Quality, STORAGE_KEY as QUALITY_KEY } from '../src/core/Quality.js';
import { Accessibility, STORAGE_KEY as ACCESSIBILITY_KEY } from '../src/ui/Accessibility.js';
import { SoundScape, AUDIO_SETTINGS_KEY } from '../src/audio/SoundScape.js';
import { TouchControls, TOUCH_KEY } from '../src/ui/TouchControls.js';
import { Guide } from '../src/game/Guide.js';
import { INTRO_KEY, introKey, introAllowed } from '../src/world/start/Intro.js';
import { STORAGE_KEY as LANGUAGE_KEY, setLang } from '../src/i18n/index.js';

const v1 = { v: 1, money: 9876, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 };
const v2 = { ...new GameState( null ).toJSON(), money: 7654, name: 'Original captain' };
const originalSeed = () => new Map( [
	[ 'tidewater.save.v1', JSON.stringify( v1 ) ],
	[ 'hyptile-island.save.v2', JSON.stringify( v2 ) ],
	[ 'hyptile-island.save.v2.slot1', JSON.stringify( { ...v2, money: 777 } ) ],
	[ backupKey( 'hyptile-island.save.v2', 1 ), JSON.stringify( v2 ) ],
	[ corruptKey( 'hyptile-island.save.v2' ), 'original unreadable bytes { ☃' ],
	[ 'sandbox.hyptile-island.save.v2', JSON.stringify( v2 ) ],
	[ 'multiplayer.hyptile-island.save.v2', JSON.stringify( v2 ) ],
	[ 'hyptile-island.quality', '{"tier":"low","scale":0.5,"auto":false}' ],
	[ 'hyptile-island.a11y', '{"sensitivity":2.8}' ],
	[ 'hyptile-island.audio', '{"master":0.13,"music":0.11}' ],
	[ 'hyptile-island.lang', 'ro' ],
	[ 'hyptile-island.touch', '{"size":1.4,"mode":"off"}' ],
	[ 'hyptile-island.view', 'first' ],
	[ 'hyptile-island.hold.v1', '{"campaign.0":{"f:1":[0,0]}}' ],
	[ 'hyptile-island.inventory-view', 'list' ],
	[ 'hyptile-island.intro.campaign.0', '1' ],
	[ 'hyptile-island.tip.fullscreen', '1' ],
	[ 'hyptile-island.boot', '{"stage":"original"}' ],
	[ 'tidewater.guide', '{"welcome":true}' ],
	[ 'tidewater.ui.tab', 'sea' ],
] );

function sameOriginStore() {

	const original = originalSeed(), map = new Map( original ), calls = [];
	return { original, map, calls,
		getItem( key ) { calls.push( [ 'get', key ] ); return map.get( key ) ?? null; },
		setItem( key, value ) { calls.push( [ 'set', key ] ); map.set( key, String( value ) ); },
		removeItem( key ) { calls.push( [ 'remove', key ] ); map.delete( key ); },
	};

}

function assertOriginalUntouched( store ) {

	for ( const [ key, bytes ] of store.original ) assert.equal( store.map.get( key ), bytes, 'original bytes unchanged: ' + key );
	assert.deepEqual( store.calls.filter( ( [ , key ] ) => /(?:^|\.)(?:hyptile-island|tidewater)\./.test( key ) ), [], 'candidate never implicitly accesses any original key' );
	for ( const [ op, key ] of store.calls ) if ( op !== 'get' ) assert.match( key, /^(?:(?:sandbox|multiplayer)\.)?alpha-astra\./, 'candidate write/delete stays in its namespace' );

}

test( 'all touched configuration exports and private storage keys are candidate-owned', () => {

	assert.equal( SAVE_KEY, 'alpha-astra.save.v2' );
	assert.deepEqual( [ QUALITY_KEY, ACCESSIBILITY_KEY, AUDIO_SETTINGS_KEY, TOUCH_KEY, LANGUAGE_KEY, INTRO_KEY ], [ 'alpha-astra.quality', 'alpha-astra.a11y', 'alpha-astra.audio', 'alpha-astra.touch', 'alpha-astra.lang', 'alpha-astra.intro.' ] );
	assert.equal( EXPORT_FORMAT, 'hyptile-island-save', 'explicit imported/exported file contract remains compatible' );
	assert.equal( SAVE_SCHEMA, 6 );
	for ( const file of [ 'core/Quality.js', 'i18n/index.js', 'audio/SoundScape.js', 'ui/UI.js', 'ui/TouchControls.js', 'ui/Accessibility.js', 'player/Player.js', 'game/GameState.js', 'game/GameHUD.js', 'game/Guide.js', 'world/start/Intro.js' ] ) {

		const source = readFileSync( new URL( '../src/' + file, import.meta.url ), 'utf8' );
		assert.doesNotMatch( source, /['"](?:hyptile-island|tidewater)\.[^'"]*['"]/, 'original storage-key literal absent: ' + file );

	}

} );

test( 'same-origin original slots and v1 save are not implicitly imported, listed or deleted', () => {

	const store = sameOriginStore(), state = new GameState( store );
	assert.equal( state.load(), false ); assert.equal( state.money, 0 ); assert.equal( state.boat, null );
	attachVault( state );
	assert.equal( state.load(), false, 'vault fallback also ignores original v1 and v2 keys' );
	for ( const mode of [ 'campaign', 'sandbox', 'multiplayer' ] ) {

		assert.ok( GameState.listSlots( store, SLOTS, mode ).every( ( row ) => ! row.exists ) );
		assert.equal( state.useSlot( 0, mode ), false );
		GameState.removeSlot( store, 0, mode );

	}
	assertOriginalUntouched( store );

} );

test( 'real GameState and SaveVault create/save/load/backup/copy/delete preserve all original bytes', () => {

	const store = sameOriginStore(), state = new GameState( store );
	const vault = attachVault( state, { gapMs: 0 } );
	for ( const mode of [ 'campaign', 'sandbox', 'multiplayer' ] ) for ( let slot = 0; slot < SLOTS; slot ++ ) {

		state.useSlot( slot, mode ); state.name = 'Alpha ' + mode + ' ' + slot; state.money = 100 + slot; assert.equal( state.save(), true );
		const key = GameState.slotKey( slot, mode );
		assert.equal( SaveVault.keyOf( slot, mode ), key );
		assert.equal( vault.backup( key, { force: true } ), true );
		state.money = 0; assert.equal( state.load(), true ); assert.equal( state.money, 100 + slot );
		assert.ok( vault.listBackups( key ).length >= 1 );
		assert.equal( vault.remove( key ), true );
		assert.equal( store.map.has( key ), false );
		assert.equal( vault.restore( key, 1 ).ok, true );
		assert.equal( state.load(), true ); assert.equal( state.money, 100 + slot );
		state.deleteSlot( slot, mode ); assert.equal( store.map.has( key ), false );

	}
	state.useSlot( 0, 'campaign' ); state.money = 234; state.save();
	assert.equal( vault.duplicate( state.key, GameState.slotKey( 2 ) ).ok, true );
	assert.equal( state.useSlot( 2, 'campaign' ), true ); assert.equal( state.money, 234 );
	assertOriginalUntouched( store );

} );

test( 'corrupt candidate recovery quarantines only candidate data', () => {

	const store = sameOriginStore(), state = new GameState( store );
	const vault = attachVault( state ); state.money = 321; state.save(); vault.backup( state.key, { force: true } );
	store.setItem( state.key, '{broken candidate data' );
	assert.equal( state.load(), true ); assert.equal( state.money, 321 );
	assert.equal( store.map.get( corruptKey( state.key ) ), '{broken candidate data' );
	assert.equal( vault.lastReport.source, 'backup' );
	assertOriginalUntouched( store );

} );

test( 'explicit original-format v1/v2 imports work without touching source saves', () => {

	const store = sameOriginStore(), state = new GameState( store );
	const vault = attachVault( state );
	const key = GameState.slotKey( 1 );
	assert.equal( vault.importText( key, JSON.stringify( wrapExport( v1, { slot: 1 } ) ) ).ok, true );
	assert.equal( state.useSlot( 1, 'campaign' ), true ); assert.equal( state.money, 9876 ); assert.equal( state.boat, 'lobster' );
	assert.equal( vault.importText( key, JSON.stringify( wrapExport( v2, { slot: 1 } ) ) ).ok, true );
	assert.equal( state.load(), true ); assert.equal( state.money, 7654 );
	const exported = JSON.parse( vault.exportText( key, { slot: 1 } ) );
	assert.equal( exported.format, EXPORT_FORMAT ); assert.equal( exported.schema, SAVE_SCHEMA ); assert.equal( exported.save.money, 7654 );
	assertOriginalUntouched( store );

} );

test( 'real settings loaders ignore original preferences and write independent values', () => {

	const store = sameOriginStore(), previous = globalThis.localStorage;
	globalThis.localStorage = store;
	try {

		const quality = new Quality( { settings: {} }, { storage: store, device: { mobile: false }, query: new URLSearchParams() } );
		assert.equal( quality.tier, 'high', 'does not read original low graphics preference' ); quality.setTier( 'medium' );
		assert.equal( JSON.parse( store.map.get( QUALITY_KEY ) ).tier, 'medium' );
		const accessibility = new Accessibility( { storage: store, doc: null } );
		assert.equal( accessibility.o.sensitivity, 1 ); accessibility.o.sensitivity = 1.2; accessibility.save(); accessibility._offLang?.();
		const audio = new SoundScape( { baseUrl: '/audio/' } );
		assert.equal( audio.getVolume( 'master' ), 0.8 ); audio.setVolume( 'master', 0.6 );
		assert.equal( JSON.parse( store.map.get( AUDIO_SETTINGS_KEY ) ).master, 0.6 );
		const touch = Object.assign( Object.create( TouchControls.prototype ), { storage: store, settings: { mode: 'auto', size: 1 } } );
		assert.deepEqual( touch._load(), {} ); touch._save();
		const guide = Object.assign( Object.create( Guide.prototype ), { seen: { welcome: true } } );
		assert.deepEqual( guide._load(), {} ); guide._save();
		assert.equal( introAllowed( { mode: 'campaign', slot: 0, storage: store } ), true, 'original seen-intro does not skip candidate intro' );
		assert.equal( introKey( 'campaign', 0 ), 'alpha-astra.intro.campaign.0' );
		setLang( 'en' ); assert.equal( store.map.get( LANGUAGE_KEY ), 'en' );
		assertOriginalUntouched( store );

	} finally { if ( previous === undefined ) delete globalThis.localStorage; else globalThis.localStorage = previous; }

} );
