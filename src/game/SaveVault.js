import { FISH, fishLengthCm } from './FishTable.js';
import { UPGRADES, defaultUpgrades } from './Gear.js';
import { CHARACTERS, DEFAULT_CHARACTER } from './Characters.js';
import { BOATS } from './Boats.js';
import { PORTS, REP_MAX } from './Progression.js';
import { isMode, DEFAULT_MODE } from './GameMode.js';
import { GameState, parseWorld, defaultRep, defaultStats, SLOTS } from './GameState.js';
import { WORLD } from '../world/WorldLayout.js';

// The save vault: whole-save validation, numbered migrations, a preflight before any load with a rollback to the
// last good backup, and rolling backups per slot. GameState stays the owner of the save's shape (toJSON / fromJSON);
// the vault sits around its load() and save() (attachVault) and gives the save manager (ui/SaveManager.js) its tools.
// The format and the migrations are documented in docs/SAVE_FORMAT.md (keep the numbers there and here the same).
//
//   validateSave( json | text, opts? ) -> { ok, errors: [ { path, msg } ], warnings: [ ... ], bytes, schema, applied, data }
//        data: the migrated copy (what a load would read); errors block a load, warnings are what GameState drops or
//        clamps by itself. opts: { maxBytes, knownPorts }
//   migrateSave( json ) -> { data, applied: [ n ], schema }      repairSave( json ) -> a copy that loads safely
//   unwrapSave( any ) -> { save, source: 'raw' | 'export' | 'server', meta } | null   (an exported file, a server profile
//        file { schema, captain, savedAt, profile } or a bare GameState JSON)
//   wrapExport( save, { mode, slot, captain } ) -> the exported file's object
//   inspectSlots( storage, mode ) -> every slot of a mode with its validation and backups (the save manager's list)
//
//   const vault = attachVault( state, { onReport } );  // state.load() preflights, state.save() keeps rolling backups
//   vault.lastReport                              // { key, source: 'main' | 'backup' | 'repaired' | 'none' | 'server', ... }
//   vault.listBackups( key ) / backup( key, { force } ) / restore( key, i ) / duplicate( from, to ) / remove( key )
//   vault.importText( key, text ) / exportText( key, meta ) / read( key ) / preflight( key )
//   SaveVault.keyOf( slot, mode ) = GameState.slotKey
//
// Backups live next to the slot: `<slot key>.bak1` (newest) .. `.bakN`; a save that fails its preflight is kept
// as `<slot key>.corrupt` for a look. A backup is taken from the stored save (validated first, so a bad save never
// pushes out a good backup) on the first write of a slot in a page session and then at most every BACKUP_GAP_MS.
// The persistent universe's storage (state.storage.universe) is the server's: no local backups there (the server
// keeps daily ones), the profile is only validated, and the vault's own writes (import, duplicate, delete, restore)
// refuse: it is read-only here (export still works).

export const SAVE_SCHEMA = 6; // the newest migration number (docs/SAVE_FORMAT.md)
export const MAX_SAVE_BYTES = 256 * 1024; // the universe server's limit too (net/Protocol.js MAX_SAVE)
export const WARN_SAVE_BYTES = 128 * 1024;
export const BACKUPS = 3;
export const BACKUP_GAP_MS = 5 * 60 * 1000;
export const EXPORT_FORMAT = 'hyptile-island-save';
export const MONEY_MAX = 1e9;
export const MAX_FISH = 400; // the server's limits (server/universe.mjs sanitizeProfile)
export const MAX_LOG = 300;

const isObj = ( v ) => !! v && typeof v === 'object' && ! Array.isArray( v );
const fin = ( v ) => typeof v === 'number' && Number.isFinite( v );

// ---- migrations: numbered, idempotent, each one only fills in what its era of saves lacks

export const MIGRATIONS = [
	{
		n: 1, name: 'Tidewater v1 save to Hyptile Island v2 (the lobster boat, Hyptile alone in the crew)',
		needs: ( d ) => d.v === 1,
		apply: ( d ) => {

			d.v = 2;
			d.boat = 'lobster';
			if ( ! Array.isArray( d.unlocked ) ) d.unlocked = [ DEFAULT_CHARACTER ];
			if ( typeof d.character !== 'string' ) d.character = DEFAULT_CHARACTER;
			if ( ! isObj( d.quests ) ) d.quests = {};

		},
	},
	{
		n: 2, name: 'lengths (cm) on the fish in the hold and the log records',
		needs: ( d ) => ( Array.isArray( d.inventory ) && d.inventory.some( ( f ) => isObj( f ) && FISH[ f.species ] && fin( f.kg ) && ! fin( f.cm ) ) ) ||
			( isObj( d.log ) && Object.entries( d.log ).some( ( [ k, v ] ) => FISH[ k ] && isObj( v ) && v.bestKg > 0 && ! fin( v.bestCm ) ) ),
		apply: ( d ) => {

			if ( Array.isArray( d.inventory ) ) for ( const f of d.inventory ) if ( isObj( f ) && FISH[ f.species ] && fin( f.kg ) && f.kg > 0 && ! fin( f.cm ) ) f.cm = Math.round( fishLengthCm( f.species, f.kg ) );
			if ( isObj( d.log ) ) for ( const [ k, v ] of Object.entries( d.log ) ) if ( FISH[ k ] && isObj( v ) && v.bestKg > 0 && ! fin( v.bestCm ) ) v.bestCm = Math.round( fishLengthCm( k, v.bestKg ) );

		},
	},
	{
		n: 3, name: 'progression: xp, port reputation, discovered ports',
		needs: ( d ) => ! ( 'xp' in d ) || ! isObj( d.rep ) || ! Array.isArray( d.discovered ),
		apply: ( d ) => {

			if ( ! ( 'xp' in d ) ) d.xp = 0;
			if ( ! isObj( d.rep ) ) d.rep = defaultRep();
			if ( ! Array.isArray( d.discovered ) ) d.discovered = [];

		},
	},
	{
		n: 4, name: 'game modes and the world snapshot (mode, world)',
		needs: ( d ) => ! ( 'mode' in d ) || ! ( 'world' in d ),
		apply: ( d ) => {

			if ( ! ( 'mode' in d ) ) d.mode = DEFAULT_MODE;
			if ( ! ( 'world' in d ) ) d.world = null;

		},
	},
	{
		n: 5, name: 'feature data (features: { <feature>: its toJSON() })',
		needs: ( d ) => ! ( 'features' in d ),
		apply: ( d ) => {

			d.features = {};

		},
	},
	{
		n: 6, name: 'career stats complete (every defaultStats() counter)',
		needs: ( d ) => ! ( 'career' in d ) || ( isObj( d.career ) && Object.keys( defaultStats() ).some( ( k ) => ! ( k in d.career ) ) ),
		apply: ( d ) => {

			if ( ! ( 'career' in d ) ) d.career = defaultStats();
			else d.career = { ...defaultStats(), ...d.career };

		},
	},
];

// the schema a save already has: the highest n with no migration up to it still needed
export function detectSchema( d ) {

	if ( ! isObj( d ) ) return 0;
	let s = 0;
	for ( const m of MIGRATIONS ) {

		if ( m.needs( d ) ) break;
		s = m.n;

	}

	return s;

}

export function migrateSave( json ) {

	const data = clone( json );
	const applied = [];
	if ( ! isObj( data ) ) return { data, applied, schema: 0 };
	const from = detectSchema( data );
	for ( const m of MIGRATIONS ) {

		if ( ! m.needs( data ) ) continue;
		m.apply( data );
		applied.push( m.n );

	}

	return { data, applied, from, schema: detectSchema( data ) };

}

// ---- validation

// the port ids a save may name: the progression's and every port and island in the world layout (it grows: read now)
export function knownPorts() {

	const s = new Set( PORTS );
	if ( WORLD && Array.isArray( WORLD.ports ) ) for ( const p of WORLD.ports ) if ( p && typeof p.id === 'string' ) s.add( p.id );
	if ( WORLD && Array.isArray( WORLD.islands ) ) for ( const p of WORLD.islands ) if ( p && typeof p.id === 'string' ) s.add( p.id );
	return s;

}

export function validateSave( input, { maxBytes = MAX_SAVE_BYTES, knownPorts: ports = null } = {} ) {

	const errors = [], warnings = [];
	const err = ( path, msg ) => errors.push( { path, msg } );
	const warn = ( path, msg ) => warnings.push( { path, msg } );
	const fail = ( bytes ) => ( { ok: false, errors, warnings, bytes, schema: 0, applied: [], data: null } );
	let json = input, text = null;
	if ( typeof input === 'string' ) {

		text = input;
		try {

			json = JSON.parse( input );

		} catch ( e ) {

			err( '', 'not JSON: ' + e.message );
			return fail( byteLength( text ) );

		}

	}

	const bytes = text !== null ? byteLength( text ) : byteLength( safeStringify( json ) );
	if ( bytes > maxBytes ) err( '', `too large: ${ Math.round( bytes / 1024 ) } KB (at most ${ Math.round( maxBytes / 1024 ) } KB)` );
	else if ( bytes > WARN_SAVE_BYTES ) warn( '', `large: ${ Math.round( bytes / 1024 ) } KB` );
	if ( ! isObj( json ) ) {

		err( '', 'not a save (expected an object)' );
		return fail( bytes );

	}

	if ( json.v !== 1 && json.v !== 2 ) {

		err( 'v', `unknown save version ${ JSON.stringify( json.v ) } (1 or 2)` );
		return fail( bytes );

	}

	const { data: d, applied, schema } = migrateSave( json );
	const portSet = ports ? new Set( ports ) : knownPorts();

	// wallet and progression
	if ( ! fin( d.money ) ) err( 'money', 'not a number' );
	else if ( d.money < 0 ) err( 'money', 'negative' );
	else if ( d.money > MONEY_MAX ) err( 'money', `over ${ MONEY_MAX }` );
	if ( ! fin( d.xp ) ) err( 'xp', 'not a number' );
	else if ( d.xp < 0 ) err( 'xp', 'negative' );
	else if ( d.xp > 1e9 ) err( 'xp', 'over 1e9' );
	if ( 'fuel' in d && d.fuel !== null && ! ( fin( d.fuel ) && d.fuel >= 0 && d.fuel <= 1e5 ) ) err( 'fuel', 'expected null or 0..1e5 litres' );
	if ( 'nextId' in d && ! ( fin( d.nextId ) && d.nextId >= 0 ) ) warn( 'nextId', 'not a positive number (recomputed)' );
	if ( 'savedAt' in d && ! fin( d.savedAt ) ) warn( 'savedAt', 'not a time' );
	if ( d.mode !== undefined && ! isMode( d.mode ) ) warn( 'mode', `unknown mode ${ JSON.stringify( d.mode ) }` );
	if ( 'name' in d && typeof d.name !== 'string' ) warn( 'name', 'not text (cleared)' );
	else if ( typeof d.name === 'string' && d.name.length > 24 ) warn( 'name', 'longer than 24 characters (cut)' );

	// the hold
	if ( ! Array.isArray( d.inventory ) ) err( 'inventory', 'not a list' );
	else {

		if ( d.inventory.length > MAX_FISH ) err( 'inventory', `${ d.inventory.length } fish (at most ${ MAX_FISH })` );
		const ids = new Set();
		d.inventory.forEach( ( f, i ) => {

			const p = `inventory[${ i }]`;
			if ( ! isObj( f ) ) return err( p, 'not a fish' );
			if ( ! FISH[ f.species ] ) warn( p + '.species', `unknown species ${ JSON.stringify( f.species ) } (dropped)` );
			if ( ! fin( f.kg ) || f.kg <= 0 || f.kg >= 5000 ) err( p + '.kg', 'expected 0 < kg < 5000' );
			if ( 'value' in f && ! ( fin( f.value ) && f.value >= 0 && f.value <= 1e6 ) ) err( p + '.value', 'expected 0..1e6' );
			if ( 'id' in f ) {

				if ( ! Number.isInteger( f.id ) ) warn( p + '.id', 'not an integer' );
				else if ( ids.has( f.id ) ) warn( p + '.id', `duplicate id ${ f.id }` );
				ids.add( f.id );

			}

		} );

	}

	// the fish log
	if ( ! isObj( d.log ) ) err( 'log', 'not an object' );
	else {

		const keys = Object.keys( d.log );
		if ( keys.length > MAX_LOG ) err( 'log', `${ keys.length } species (at most ${ MAX_LOG })` );
		for ( const k of keys ) {

			const v = d.log[ k ];
			if ( ! FISH[ k ] ) warn( `log.${ k }`, 'unknown species' );
			if ( ! isObj( v ) ) { err( `log.${ k }`, 'not an entry' ); continue; }
			if ( ! ( Number.isInteger( v.count ) && v.count >= 0 ) ) err( `log.${ k }.count`, 'expected a whole number >= 0' );
			if ( 'bestKg' in v && ! ( fin( v.bestKg ) && v.bestKg >= 0 && v.bestKg < 5000 ) ) err( `log.${ k }.bestKg`, 'expected 0..5000' );

		}

	}

	// gear: an out-of-range level would break gearStats()
	if ( 'upgrades' in d && ! isObj( d.upgrades ) ) err( 'upgrades', 'not an object' );
	else if ( isObj( d.upgrades ) ) {

		for ( const [ k, v ] of Object.entries( d.upgrades ) ) {

			if ( ! UPGRADES[ k ] ) { warn( `upgrades.${ k }`, 'unknown upgrade track' ); continue; }
			const max = UPGRADES[ k ].levels.length - 1;
			if ( ! Number.isInteger( v ) || v < 0 || v > max ) err( `upgrades.${ k }`, `expected a level 0..${ max }` );

		}

	}

	// crew and boat
	if ( 'character' in d && ! CHARACTERS[ d.character ] ) warn( 'character', `unknown character ${ JSON.stringify( d.character ) } (Hyptile)` );
	if ( 'unlocked' in d ) {

		if ( ! Array.isArray( d.unlocked ) ) warn( 'unlocked', 'not a list (Hyptile only)' );
		else for ( const id of d.unlocked ) if ( ! CHARACTERS[ id ] ) warn( 'unlocked', `unknown character ${ JSON.stringify( id ) } (dropped)` );

	}

	if ( 'boat' in d && d.boat !== null && ! BOATS[ d.boat ] ) warn( 'boat', `unknown boat ${ JSON.stringify( d.boat ) } (on foot)` );

	// progression
	if ( isObj( d.rep ) ) {

		for ( const [ k, v ] of Object.entries( d.rep ) ) {

			if ( ! portSet.has( k ) ) warn( `rep.${ k }`, 'unknown port' );
			if ( ! fin( v ) ) warn( `rep.${ k }`, 'not a number (dropped)' );
			else if ( v < 0 || v > REP_MAX ) warn( `rep.${ k }`, `outside 0..${ REP_MAX } (clamped)` );

		}

	}

	if ( Array.isArray( d.discovered ) ) for ( const id of d.discovered ) if ( typeof id !== 'string' || ! portSet.has( id ) ) warn( 'discovered', `unknown port ${ JSON.stringify( id ) }` );

	// stats, quests, the world, the features
	if ( ! isObj( d.career ) ) err( 'career', 'not an object' );
	else for ( const [ k, v ] of Object.entries( d.career ) ) if ( typeof v !== 'boolean' && ! ( fin( v ) && v >= 0 && v <= 1e12 ) ) err( `career.${ k }`, 'expected a number 0..1e12 or a flag' );
	if ( 'quests' in d && ! isObj( d.quests ) ) err( 'quests', 'not an object' );
	if ( d.world !== null && d.world !== undefined && ! parseWorld( d.world ) ) warn( 'world', 'unreadable position (start at the pier)' );
	if ( ! isObj( d.features ) ) err( 'features', 'not an object' );

	return { ok: errors.length === 0, errors, warnings, bytes, schema, applied, data: d };

}

// a copy that loads safely whatever it held: bad numbers clamped, wrong types replaced, lists trimmed (the fallback
// when a save fails validation and no backup passes)
export function repairSave( json ) {

	const { data: d } = migrateSave( isObj( json ) && ( json.v === 1 || json.v === 2 ) ? json : { v: 2 } );
	const clampN = ( v, lo, hi, def ) => ( fin( v ) ? Math.max( lo, Math.min( hi, v ) ) : def );
	d.money = clampN( d.money, 0, MONEY_MAX, 0 );
	d.xp = Math.round( clampN( d.xp, 0, 1e9, 0 ) );
	if ( d.fuel !== null && ! ( fin( d.fuel ) && d.fuel >= 0 ) ) d.fuel = null;
	d.inventory = Array.isArray( d.inventory ) ? d.inventory.filter( ( f ) => isObj( f ) && FISH[ f.species ] && fin( f.kg ) && f.kg > 0 && f.kg < 5000 ).slice( 0, MAX_FISH ) : [];
	for ( const f of d.inventory ) if ( 'value' in f && ! ( fin( f.value ) && f.value >= 0 ) ) f.value = 0;
	if ( ! isObj( d.log ) ) d.log = {};
	for ( const k of Object.keys( d.log ) ) {

		const v = d.log[ k ];
		if ( ! FISH[ k ] || ! isObj( v ) ) { delete d.log[ k ]; continue; }
		v.count = Number.isInteger( v.count ) && v.count >= 0 ? v.count : 0;
		v.bestKg = clampN( v.bestKg, 0, 5000, 0 );

	}

	const up = defaultUpgrades();
	if ( isObj( d.upgrades ) ) for ( const [ k, v ] of Object.entries( d.upgrades ) ) if ( UPGRADES[ k ] ) up[ k ] = Math.round( clampN( v, 0, UPGRADES[ k ].levels.length - 1, 0 ) );
	d.upgrades = up;
	const career = defaultStats();
	if ( isObj( d.career ) ) for ( const [ k, v ] of Object.entries( d.career ) ) career[ k ] = typeof v === 'boolean' ? v : clampN( v, 0, 1e12, 0 );
	d.career = career;
	if ( ! isObj( d.quests ) ) d.quests = {};
	if ( ! isObj( d.features ) ) d.features = {};
	if ( ! isObj( d.rep ) ) d.rep = defaultRep();
	if ( ! Array.isArray( d.discovered ) ) d.discovered = [];
	return d;

}

// ---- files: exported saves, server profiles

export function unwrapSave( any ) {

	let o = any;
	if ( typeof o === 'string' ) {

		try { o = JSON.parse( o ); } catch ( e ) { return null; }

	}

	if ( ! isObj( o ) ) return null;
	if ( o.format === EXPORT_FORMAT && isObj( o.save ) ) return { save: o.save, source: 'export', meta: { mode: o.mode, slot: o.slot, exportedAt: o.exportedAt, schema: o.schema, captain: o.captain || null } };
	if ( isObj( o.profile ) && ( o.profile.v === 1 || o.profile.v === 2 ) ) return { save: o.profile, source: 'server', meta: { captain: o.captain || null, savedAt: o.savedAt, schema: o.schema } };
	if ( o.v === 1 || o.v === 2 ) return { save: o, source: 'raw', meta: {} };
	return null;

}

export function wrapExport( save, { mode = null, slot = null, captain = null } = {} ) {

	return { format: EXPORT_FORMAT, version: 1, schema: SAVE_SCHEMA, game: 'Hyptile Island', exportedAt: Date.now(), mode, slot, captain, save };

}

// a short summary for lists
export function summarize( save ) {

	if ( ! isObj( save ) ) return null;
	return {
		money: fin( save.money ) ? save.money : 0, xp: fin( save.xp ) ? save.xp : 0,
		character: CHARACTERS[ save.character ] ? save.character : DEFAULT_CHARACTER,
		boat: save.v === 1 ? 'lobster' : ( BOATS[ save.boat ] ? save.boat : null ),
		savedAt: fin( save.savedAt ) ? save.savedAt : 0, mode: isMode( save.mode ) ? save.mode : null,
		name: typeof save.name === 'string' ? save.name.slice( 0, 24 ) : '',
		playSeconds: isObj( save.career ) && fin( save.career.playSeconds ) ? save.career.playSeconds : 0,
	};

}

export function backupKey( key, i ) {

	return `${ key }.bak${ i }`;

}

export function corruptKey( key ) {

	return `${ key }.corrupt`;

}

// ---- the vault over a storage (localStorage-like: getItem / setItem / removeItem)

export class SaveVault {

	static keyOf( slot, mode = DEFAULT_MODE ) {

		return GameState.slotKey( slot, mode );

	}

	// storage: an object or () => object (the state's storage is swapped by the universe session)
	constructor( storage = safeStorage(), { backups = BACKUPS, gapMs = BACKUP_GAP_MS, now = () => Date.now() } = {} ) {

		this._storage = storage;
		this.backups = backups;
		this.gapMs = gapMs;
		this.now = now;
		this._lastBackup = new Map(); // key -> time of the last backup this page session
		this.lastReport = null;

	}

	get storage() {

		return typeof this._storage === 'function' ? this._storage() : this._storage;

	}

	// the universe session's storage is the server's: one profile, no local keys
	get remote() {

		const s = this.storage;
		return !! ( s && s.universe );

	}

	_get( key ) {

		const s = this.storage;
		if ( ! s ) return null;
		try { return s.getItem( key ); } catch ( e ) { return null; }

	}

	_set( key, value ) {

		const s = this.storage;
		if ( ! s ) return false;
		try { s.setItem( key, value ); return true; } catch ( e ) { return false; }

	}

	_del( key ) {

		const s = this.storage;
		if ( ! s ) return;
		try {

			if ( typeof s.removeItem === 'function' ) s.removeItem( key );
			else s.setItem( key, '' );

		} catch ( e ) { /* blocked */ }

	}

	// { raw, report } of a stored key (report null when nothing is there)
	read( key ) {

		const raw = this._get( key );
		if ( ! raw ) return { raw: null, report: null };
		return { raw, report: validateSave( raw ) };

	}

	listBackups( key ) {

		const out = [];
		if ( this.remote ) return out;
		for ( let i = 1; i <= this.backups; i ++ ) {

			const raw = this._get( backupKey( key, i ) );
			if ( ! raw ) continue;
			const report = validateSave( raw );
			out.push( { i, key: backupKey( key, i ), ok: report.ok, bytes: report.bytes, errors: report.errors, ...( summarize( report.data ) || {} ) } );

		}

		return out;

	}

	// copies the stored save into backup 1 (the older ones move down, the oldest drops off); only a save that passes
	// validation is kept. Throttled per key unless force. -> true when a backup was written
	backup( key, { force = false } = {} ) {

		if ( this.remote ) return false;
		const t = this.now();
		const last = this._lastBackup.get( key );
		if ( ! force && last !== undefined && t - last < this.gapMs ) return false;
		const cur = this._get( key );
		if ( ! cur ) return false;
		if ( ! validateSave( cur ).ok ) return false;
		if ( this._get( backupKey( key, 1 ) ) === cur ) {

			this._lastBackup.set( key, t );
			return false; // nothing new since the newest backup

		}

		for ( let i = this.backups; i > 1; i -- ) {

			const prev = this._get( backupKey( key, i - 1 ) );
			if ( prev ) this._set( backupKey( key, i ), prev );

		}

		const ok = this._set( backupKey( key, 1 ), cur );
		if ( ok ) this._lastBackup.set( key, t );
		return ok;

	}

	// frees room when the browser refuses a write: the oldest backups of this key go first
	trimBackups( key, keep = 1 ) {

		for ( let i = this.backups; i > keep; i -- ) this._del( backupKey( key, i ) );

	}

	// the stored save of `key` is replaced by backup i (the current one takes the backup's place, so this can be undone)
	restore( key, i ) {

		if ( this.remote ) return { ok: false, errors: [ { path: '', msg: 'server saves are kept by the server' } ], warnings: [] };
		const raw = this._get( backupKey( key, i ) );
		if ( ! raw ) return { ok: false, errors: [ { path: '', msg: 'no such backup' } ], warnings: [] };
		const report = validateSave( raw );
		if ( ! report.ok ) return report;
		const cur = this._get( key );
		if ( cur && cur !== raw ) this._set( backupKey( key, i ), cur );
		if ( ! this._set( key, JSON.stringify( report.data ) ) ) return { ...report, ok: false, errors: [ { path: '', msg: 'the browser refused the write' } ] };
		return report;

	}

	// Preflight of a load: the stored save, else the newest backup that passes, else a repaired copy.
	// -> { ok, source: 'none' | 'main' | 'backup' | 'repaired', index, report, data, rolledBack }
	preflight( key ) {

		const raw = this._get( key );
		if ( ! raw ) return { ok: true, source: 'none', index: 0, report: null, data: null, rolledBack: false };
		const report = validateSave( raw );
		if ( report.ok ) return { ok: true, source: 'main', index: 0, report, data: report.data, rolledBack: false };
		for ( const b of this.listBackups( key ) ) {

			if ( ! b.ok ) continue;
			const br = validateSave( this._get( b.key ) );
			return { ok: true, source: 'backup', index: b.i, report, backupReport: br, data: br.data, rolledBack: true };

		}

		// nothing better: a repaired copy (unreadable JSON or something that is not a save: nothing at all)
		const parsed = report.data || tryParse( raw );
		if ( ! isObj( parsed ) || ( parsed.v !== 1 && parsed.v !== 2 ) ) return { ok: false, source: 'none', index: 0, report, data: null, rolledBack: false };
		return { ok: true, source: 'repaired', index: 0, report, data: repairSave( parsed ), rolledBack: false };

	}

	// an imported file (exported save, server profile or bare save) into `key`; the save there is backed up first
	importText( key, text ) {

		if ( this.remote ) return { ok: false, errors: [ { path: '', msg: 'the universe save is kept by the server (read-only here)' } ], warnings: [], source: null };
		const u = unwrapSave( text );
		if ( ! u ) return { ok: false, errors: [ { path: '', msg: 'not a Hyptile Island save file' } ], warnings: [], source: null };
		const report = validateSave( u.save );
		if ( ! report.ok ) return { ...report, source: u.source, meta: u.meta };
		this.backup( key, { force: true } );
		const ok = this._set( key, JSON.stringify( report.data ) );
		return ok ? { ...report, source: u.source, meta: u.meta } : { ...report, ok: false, errors: [ { path: '', msg: 'the browser refused the write (storage full?)' } ], source: u.source };

	}

	exportText( key, meta = {} ) {

		const raw = this._get( key );
		if ( ! raw ) return null;
		const save = tryParse( raw );
		if ( ! isObj( save ) ) return null;
		return JSON.stringify( wrapExport( save, meta ), null, '\t' );

	}

	// copies the save of `from` into `to` (the save at `to` is backed up first)
	duplicate( from, to ) {

		if ( this.remote ) return { ok: false, errors: [ { path: '', msg: 'the universe save is kept by the server (read-only here)' } ], warnings: [] };
		const raw = this._get( from );
		if ( ! raw ) return { ok: false, errors: [ { path: '', msg: 'nothing to copy' } ], warnings: [] };
		const report = validateSave( raw );
		if ( ! report.ok ) return report;
		this.backup( to, { force: true } );
		return this._set( to, JSON.stringify( report.data ) ) ? report : { ...report, ok: false, errors: [ { path: '', msg: 'the browser refused the write' } ] };

	}

	// removes a stored save; it is backed up first (keepBackup) so Restore can bring it back
	remove( key, { keepBackup = true } = {} ) {

		if ( this.remote ) return false;
		if ( keepBackup ) this.backup( key, { force: true } );
		else for ( let i = 1; i <= this.backups; i ++ ) this._del( backupKey( key, i ) );
		this._del( key );
		return true;

	}

}

// ---- the hooks around GameState: load() preflights (with a rollback), save() keeps the backups
export function attachVault( state, opts = {} ) {

	if ( ! state ) return null;
	if ( state.vault ) return state.vault;
	const vault = new SaveVault( () => state.storage, opts );
	const onReport = typeof opts.onReport === 'function' ? opts.onReport : null;
	const load0 = state.load.bind( state ), save0 = state.save.bind( state );
	state.vault = vault;
	const report = ( r ) => {

		if ( onReport ) try { onReport( r ); } catch ( e ) { /* a toast failing must not stop the load */ }

	};

	state.load = function () {

		const key = this.key;
		if ( vault.remote ) {

			// the server's profile: checked, then GameState's own lenient load (the server sanitised it already)
			const raw = vault._get( key );
			const r = raw ? validateSave( raw ) : null;
			vault.lastReport = { key, source: 'server', ok: ! r || r.ok, report: r };
			if ( r && ! r.ok ) report( vault.lastReport );
			return load0();

		}

		let pf = vault.preflight( key );
		if ( pf.source === 'none' && ! pf.report ) {

			// nothing under the key: GameState may still find the legacy Tidewater save (campaign slot 0)
			vault.lastReport = { key, source: 'none', ok: true, report: null };
			return load0();

		}

		vault.lastReport = { key, ...pf };
		if ( ! pf.ok || ! pf.data ) {

			report( vault.lastReport );
			return false;

		}

		const before = safeStringify( this.toJSON() );
		try {

			if ( ! this.fromJSON( pf.data ) ) throw new Error( 'GameState refused the save' );

		} catch ( e ) {

			// rollback: the state as it was, then the backups the preflight did not use
			try { this.fromJSON( JSON.parse( before ) ); } catch ( e2 ) { /* defaults stay */ }
			const next = vault.listBackups( key ).find( ( b ) => b.ok && b.i !== pf.index );
			if ( ! next ) {

				vault.lastReport = { ...vault.lastReport, ok: false, error: String( ( e && e.message ) || e ) };
				report( vault.lastReport );
				return false;

			}

			const br = validateSave( vault._get( next.key ) );
			pf = { ok: true, source: 'backup', index: next.i, report: pf.report, data: br.data, rolledBack: true };
			vault.lastReport = { key, ...pf };
			try {

				if ( ! this.fromJSON( br.data ) ) return false;

			} catch ( e3 ) {

				try { this.fromJSON( JSON.parse( before ) ); } catch ( e4 ) { /* defaults stay */ }
				return false;

			}

		}

		if ( pf.source === 'backup' || pf.source === 'repaired' ) {

			// keep the bad one to look at, and store what was loaded so the next load is clean
			const raw = vault._get( key );
			if ( raw ) vault._set( corruptKey( key ), raw );
			vault._set( key, safeStringify( pf.data ) );
			report( vault.lastReport );

		}

		return true;

	};

	state.save = function () {

		const key = this.key;
		if ( ! vault.remote ) vault.backup( key );
		let ok = save0();
		if ( ! ok && ! vault.remote && this.storage ) {

			// the browser is full: this slot's backups make room for the save itself
			vault.trimBackups( key, 0 );
			ok = save0();

		}

		return ok;

	};

	return vault;

}

// every stored slot of a mode with its validation and backups
export function inspectSlots( storage = safeStorage(), mode = DEFAULT_MODE, count = SLOTS ) {

	const vault = new SaveVault( storage );
	const out = [];
	for ( let slot = 0; slot < count; slot ++ ) {

		const key = SaveVault.keyOf( slot, mode );
		const { raw, report } = vault.read( key );
		out.push( { slot, mode, key, exists: !! raw, ok: report ? report.ok : true, report, backups: vault.listBackups( key ), ...( report && report.data ? summarize( report.data ) : {} ) } );

	}

	return out;

}

function tryParse( raw ) {

	try { return JSON.parse( raw ); } catch ( e ) { return null; }

}

function clone( o ) {

	return o === undefined ? undefined : JSON.parse( JSON.stringify( o ) );

}

function safeStringify( o ) {

	try { return JSON.stringify( o ); } catch ( e ) { return ''; }

}

function byteLength( s ) {

	if ( typeof s !== 'string' ) return 0;
	if ( typeof TextEncoder !== 'undefined' ) return new TextEncoder().encode( s ).length;
	return s.length;

}

function safeStorage() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}
