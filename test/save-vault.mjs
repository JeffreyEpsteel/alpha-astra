// Plain-node tests of the save vault (src/game/SaveVault.js): whole-save validation, the numbered migrations, the
// preflight with its rollback to the last good backup, rolling backups, export / import (with a server profile file),
// duplicate, delete and restore, and the GameState hooks (attachVault).
import { GameState } from '../src/game/GameState.js';
import {
	validateSave, migrateSave, detectSchema, repairSave, unwrapSave, wrapExport, attachVault, inspectSlots,
	SaveVault, MIGRATIONS, SAVE_SCHEMA, MAX_SAVE_BYTES, backupKey, corruptKey, EXPORT_FORMAT,
} from '../src/game/SaveVault.js';
import { readFileSync } from 'node:fs';
import { UPGRADES } from '../src/game/Gear.js';

const LINE_MAX = UPGRADES.line.levels.length - 1; // the tracks grow (other workers add levels)

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};
const fresh = () => {

	const s = new GameState( store() );
	s.earn( 500 );
	s.addFish( 'grunt', 0.8, 10, { habitat: 'pier', aboard: false } );
	return s;

};

// ---- the migrations are numbered 1..SAVE_SCHEMA in order and documented
{

	ok( MIGRATIONS.map( ( m ) => m.n ).join( ',' ) === Array.from( { length: SAVE_SCHEMA }, ( _, i ) => i + 1 ).join( ',' ), 'migrations numbered 1..SAVE_SCHEMA' );
	const doc = readFileSync( new URL( '../docs/SAVE_FORMAT.md', import.meta.url ), 'utf8' );
	for ( const m of MIGRATIONS ) ok( new RegExp( `\\|\\s*${ m.n }\\s*\\|` ).test( doc ), `migration ${ m.n } listed in docs/SAVE_FORMAT.md` );
	ok( doc.includes( `SAVE_SCHEMA = ${ SAVE_SCHEMA }` ), 'the doc names the current schema' );

}

// ---- a save written by GameState today passes, at the newest schema, with nothing to migrate
{

	const s = fresh();
	const json = s.toJSON();
	const r = validateSave( JSON.stringify( json ) );
	ok( r.ok && r.errors.length === 0, 'a current GameState save validates' );
	ok( r.schema === SAVE_SCHEMA && r.applied.length === 0, 'current save: newest schema, no migration applied' );
	ok( detectSchema( json ) === SAVE_SCHEMA, 'detectSchema agrees' );
	ok( r.bytes > 0 && r.bytes < MAX_SAVE_BYTES, 'size measured' );

}

// ---- a Tidewater v1 save migrates through every step and loads
{

	const v1 = { v: 1, money: 123, inventory: [ { id: 1, species: 'grunt', kg: 0.7, value: 5 } ], log: { grunt: { count: 1, bestKg: 0.7 } }, upgrades: { hold: 1 }, fuel: null, nextId: 2 };
	const m = migrateSave( v1 );
	ok( m.from === 0 && m.applied.join( ',' ) === '1,2,3,4,5,6' && m.schema === SAVE_SCHEMA, 'v1: migrations 1-6 applied' );
	ok( m.data.v === 2 && m.data.boat === 'lobster' && m.data.inventory[ 0 ].cm > 0 && m.data.log.grunt.bestCm > 0, 'v1: lobster boat and fish lengths' );
	ok( m.data.mode === 'campaign' && m.data.world === null && m.data.career.playSeconds === 0 && m.data.xp === 0, 'v1: mode, world, career, xp filled' );
	ok( v1.v === 1 && ! ( 'mode' in v1 ), 'migration works on a copy' );
	const again = migrateSave( m.data );
	ok( again.applied.length === 0, 'migrations are idempotent' );
	const r = validateSave( v1 );
	ok( r.ok, 'v1 save validates after migration' );
	const st = new GameState( store() );
	ok( st.fromJSON( r.data ) && st.boat === 'lobster' && st.money === 123, 'migrated v1 loads into GameState' );

}

// ---- what blocks a load (errors) and what GameState fixes itself (warnings)
{

	const base = () => fresh().toJSON();
	const bad = ( mut, path, msg ) => {

		const d = base();
		mut( d );
		const r = validateSave( d );
		ok( ! r.ok && r.errors.some( ( e ) => e.path.startsWith( path ) ), `error: ${ msg }` );

	};

	bad( ( d ) => { d.money = - 5; }, 'money', 'negative money' );
	bad( ( d ) => { d.money = 'lots'; }, 'money', 'money not a number' );
	bad( ( d ) => { d.money = 2e9; }, 'money', 'money over the cap' );
	bad( ( d ) => { d.xp = - 1; }, 'xp', 'negative xp' );
	bad( ( d ) => { d.upgrades.line = 9; }, 'upgrades.line', 'upgrade level out of range' );
	bad( ( d ) => { d.upgrades.rod = 1.5; }, 'upgrades.rod', 'fractional upgrade level' );
	bad( ( d ) => { d.inventory = {}; }, 'inventory', 'inventory not a list' );
	bad( ( d ) => { d.inventory[ 0 ].kg = - 1; }, 'inventory[0].kg', 'fish with negative weight' );
	bad( ( d ) => { d.inventory = Array.from( { length: 401 }, ( _, i ) => ( { id: i + 1, species: 'grunt', kg: 0.5, cm: 20, value: 3 } ) ); }, 'inventory', 'more than 400 fish' );
	bad( ( d ) => { d.log.grunt.count = - 2; }, 'log.grunt.count', 'log count negative' );
	bad( ( d ) => { d.career.caught = NaN; }, 'career.caught', 'career stat not a number' );
	bad( ( d ) => { d.fuel = - 3; }, 'fuel', 'negative fuel' );
	bad( ( d ) => { d.features = []; }, 'features', 'features not an object' );
	bad( ( d ) => { d.quests = 'x'; }, 'quests', 'quests not an object' );
	ok( ! validateSave( '{ nope' ).ok, 'error: not JSON' );
	ok( ! validateSave( { v: 7 } ).ok, 'error: unknown version' );
	ok( ! validateSave( [ 1, 2 ] ).ok, 'error: not an object' );
	const big = base();
	big.features.blob = 'x'.repeat( MAX_SAVE_BYTES );
	ok( ! validateSave( big ).ok, 'error: larger than the limit' );

	const d = base();
	d.inventory.push( { id: 99, species: 'kraken', kg: 3, value: 1 } );
	d.character = 'nobody';
	d.boat = 'yacht';
	d.rep.atlantis = 5;
	d.rep.home = 400;
	d.upgrades.warpDrive = 2;
	d.name = 'x'.repeat( 40 );
	d.world = { player: { x: 'a' } };
	const r = validateSave( d );
	ok( r.ok && r.warnings.length >= 7, 'unknown ids and clampable values are warnings, not errors' );
	ok( r.warnings.some( ( w ) => w.path === 'rep.atlantis' ) && ! r.warnings.some( ( w ) => w.path === 'rep.pons' ), 'ports are checked against the world layout' );
	const r2 = validateSave( { ...base(), discovered: [ 'gull', 'key' ] } );
	ok( r2.ok && ! r2.warnings.some( ( w ) => w.path === 'discovered' ), 'every WORLD.ports id is known (gull, key)' );

}

// ---- repairSave makes anything loadable
{

	const d = fresh().toJSON();
	d.money = - 40;
	d.upgrades.line = 99;
	d.career.caught = 'many';
	d.inventory.push( 'junk' );
	const fixed = repairSave( d );
	const r = validateSave( fixed );
	ok( r.ok, 'a repaired save validates' );
	ok( fixed.money === 0 && fixed.upgrades.line === LINE_MAX && fixed.career.caught === 0 && fixed.inventory.length === 1, 'repair clamps and drops' );

}

// ---- files: export wrapper, server profile, bare save
{

	const save = fresh().toJSON();
	const w = wrapExport( save, { mode: 'campaign', slot: 2 } );
	ok( w.format === EXPORT_FORMAT && w.schema === SAVE_SCHEMA && w.slot === 2, 'export wrapper' );
	const u1 = unwrapSave( JSON.stringify( w ) );
	ok( u1 && u1.source === 'export' && u1.save.money === save.money, 'unwraps an exported file' );
	const u2 = unwrapSave( { schema: 1, captain: 'Ana', savedAt: 5, profile: save } );
	ok( u2 && u2.source === 'server' && u2.meta.captain === 'Ana', 'unwraps a server profile file' );
	ok( unwrapSave( save ).source === 'raw', 'takes a bare save' );
	ok( unwrapSave( { hello: 1 } ) === null && unwrapSave( 'nope' ) === null, 'refuses other JSON' );

}

// ---- the vault: rolling backups, throttle, restore, duplicate, delete
{

	const st = store();
	let t = 0;
	const vault = new SaveVault( st, { backups: 3, gapMs: 1000, now: () => t } );
	const key = SaveVault.keyOf( 1, 'campaign' );
	const put = ( money ) => { const s = fresh().toJSON(); s.money = money; st.setItem( key, JSON.stringify( s ) ); };
	put( 1 );
	ok( vault.backup( key ), 'first backup written' );
	put( 2 );
	ok( ! vault.backup( key ), 'throttled within the gap' );
	t = 2000;
	ok( vault.backup( key ), 'next backup after the gap' );
	put( 3 ); t = 4000; vault.backup( key );
	put( 4 ); t = 6000; vault.backup( key );
	const list = vault.listBackups( key );
	ok( list.length === 3 && list.map( ( b ) => b.money ).join( ',' ) === '4,3,2', 'three rolling backups, newest first' );
	put( 5 );
	st.setItem( key, '{"v":2,"money":-1}' );
	t = 9000;
	ok( ! vault.backup( key, { force: true } ), 'a bad save never becomes a backup' );
	ok( vault.listBackups( key )[ 0 ].money === 4, 'the good backups stay' );
	const rr = vault.restore( key, 1 );
	ok( rr.ok && JSON.parse( st.getItem( key ) ).money === 4, 'restore puts backup 1 back' );
	const key2 = SaveVault.keyOf( 2, 'campaign' );
	ok( vault.duplicate( key, key2 ).ok && JSON.parse( st.getItem( key2 ) ).money === 4, 'duplicate copies a slot' );
	vault.remove( key2 );
	ok( st.getItem( key2 ) === null && vault.listBackups( key2 ).length === 1, 'delete keeps a backup to restore' );
	ok( vault.restore( key2, 1 ).ok && JSON.parse( st.getItem( key2 ) ).money === 4, 'a deleted slot comes back from its backup' );
	const rows = inspectSlots( st, 'campaign' );
	ok( rows.length === 4 && rows[ 1 ].exists && rows[ 1 ].ok && rows[ 1 ].money === 4 && rows[ 1 ].backups.length >= 1 && ! rows[ 3 ].exists, 'inspectSlots lists slots with backups' );

	// export and import
	const text = vault.exportText( key, { mode: 'campaign', slot: 1 } );
	ok( typeof text === 'string' && JSON.parse( text ).format === EXPORT_FORMAT, 'exportText' );
	const key3 = SaveVault.keyOf( 3, 'campaign' );
	ok( vault.importText( key3, text ).ok && JSON.parse( st.getItem( key3 ) ).money === 4, 'importText of an export' );
	const prof = { schema: 1, captain: 'Ana', savedAt: 1, profile: { ...fresh().toJSON(), money: 77, mode: 'multiplayer' } };
	const ir = vault.importText( key3, JSON.stringify( prof ) );
	ok( ir.ok && ir.source === 'server' && JSON.parse( st.getItem( key3 ) ).money === 77, 'importText of a server profile' );
	ok( vault.listBackups( key3 )[ 0 ].money === 4, 'the overwritten import target was backed up' );
	const badImport = vault.importText( key3, JSON.stringify( { ...fresh().toJSON(), money: - 9 } ) );
	ok( ! badImport.ok && JSON.parse( st.getItem( key3 ) ).money === 77, 'an invalid import changes nothing' );
	ok( ! vault.importText( key3, '{"what":1}' ).ok, 'a non-save file is refused' );

}

// ---- attachVault: preflight, rollback to the last good backup, the corrupt copy kept, backups on save
{

	const st = store();
	const s = new GameState( st );
	const reports = [];
	const vault = attachVault( s, { onReport: ( r ) => reports.push( r ) } );
	ok( attachVault( s ) === vault, 'attachVault is idempotent' );
	s.useSlot( 0, 'campaign' );
	s.earn( 300 ); // writes the slot
	const key = s.key;
	ok( JSON.parse( st.getItem( key ) ).money === 300, 'save goes through' );
	s.earn( 200 ); // first write was not backed up (nothing stored yet); the session's first backup happens now
	ok( vault.listBackups( key ).length === 1 && vault.listBackups( key )[ 0 ].money === 300, 'the first save of a session backs up the stored one' );
	s.earn( 1 );
	ok( vault.listBackups( key ).length === 1, 'later saves are throttled' );
	// the stored save goes bad: the load rolls back to the backup
	st.setItem( key, JSON.stringify( { ...JSON.parse( st.getItem( key ) ), money: - 50, upgrades: { line: 42 } } ) );
	const t = new GameState( st );
	attachVault( t, { onReport: ( r ) => reports.push( r ) } );
	ok( t.useSlot( 0, 'campaign' ) && t.money === 300, 'preflight: a bad save rolls back to the last good backup' );
	ok( t.vault.lastReport.source === 'backup' && t.vault.lastReport.rolledBack, 'the report says so' );
	ok( reports.length === 1 && reports[ 0 ].source === 'backup', 'onReport told the game' );
	ok( JSON.parse( st.getItem( corruptKey( key ) ) ).money === - 50, 'the bad save is kept as .corrupt' );
	ok( JSON.parse( st.getItem( key ) ).money === 300, 'the slot holds the good save again' );

	// a bad save and no backups: repaired, not lost
	const st2 = store();
	const bad = { ...fresh().toJSON(), money: - 1, upgrades: { line: 42 } };
	st2.setItem( GameState.slotKey( 2, 'sandbox' ), JSON.stringify( bad ) );
	const u = new GameState( st2 );
	attachVault( u );
	ok( u.useSlot( 2, 'sandbox' ) && u.vault.lastReport.source === 'repaired' && u.money === 0 && u.upgrades.line === LINE_MAX, 'no backup: the save is repaired and loads' );

	// unreadable: refused, the state stays fresh
	st2.setItem( GameState.slotKey( 3, 'sandbox' ), '{ broken' );
	const w = new GameState( st2 );
	attachVault( w );
	ok( ! w.useSlot( 3, 'sandbox' ) && w.money === 0 && w.vault.lastReport.ok === false, 'unreadable save: not loaded, fresh islander' );

	// fromJSON throwing: rollback to the state before, then the next backup
	const st3 = store();
	const g = new GameState( st3 );
	attachVault( g );
	g.useSlot( 1, 'campaign' );
	g.earn( 10 );
	g.vault._lastBackup.clear();
	g.earn( 20 ); // backup holds money 10
	const real = g.fromJSON.bind( g );
	let calls = 0;
	g.fromJSON = ( d ) => { calls ++; if ( calls === 1 ) throw new Error( 'boom' ); return real( d ); };
	ok( g.load() && g.money === 10 && g.vault.lastReport.source === 'backup', 'a load that throws rolls back and takes the backup' );

	// the legacy Tidewater key still loads through the vault
	const st4 = store();
	st4.setItem( 'alpha-astra.save.v1', JSON.stringify( { v: 1, money: 42, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ) );
	const h = new GameState( st4 );
	attachVault( h );
	ok( h.useSlot( 0, 'campaign' ) && h.money === 42 && h.boat === 'lobster', 'legacy Tidewater save still loads' );

	// storage full: the backups make room
	const st5 = store();
	const full = new GameState( st5 );
	attachVault( full );
	full.useSlot( 0, 'campaign' );
	full.earn( 5 );
	full.vault._lastBackup.clear();
	full.earn( 6 );
	ok( st5.getItem( backupKey( full.key, 1 ) ) !== null, 'a backup exists' );
	const set0 = st5.setItem;
	let refuse = true;
	st5.setItem = ( k, v ) => { if ( refuse && k === full.key ) { refuse = false; throw new Error( 'QuotaExceeded' ); } return set0( k, v ); };
	ok( full.save() && st5.getItem( backupKey( full.key, 1 ) ) === null, 'storage full: backups dropped, the save written' );

}

// ---- the universe session's storage: no local keys, only validation
{

	const prof = fresh().toJSON();
	const json = JSON.stringify( prof );
	const remote = { universe: {}, getItem: () => json, setItem: () => {}, removeItem: () => {} };
	const s = new GameState( remote );
	const vault = attachVault( s );
	ok( vault.remote && s.useSlot( 0, 'multiplayer' ) && s.money === prof.money && vault.lastReport.source === 'server', 'server profile: validated and loaded' );
	ok( ! vault.backup( s.key, { force: true } ) && vault.listBackups( s.key ).length === 0, 'no local backups of a server profile' );
	ok( ! vault.importText( s.key, json ).ok && ! vault.duplicate( s.key, 'x' ).ok && vault.remove( s.key ) === false && ! vault.restore( s.key, 1 ).ok, 'universe storage: vault writes are refused (read-only)' );
	ok( typeof vault.exportText( s.key ) === 'string', 'universe storage: export still works' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
