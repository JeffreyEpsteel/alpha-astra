// The persistent universe of a Hyptile Island server (node server/index.mjs --universe <name> --data <dir>): captains and
// their saved games, the world events that outlive a session (destroyed props, claimed bounties), offline captains' moored
// boats, the shared trade market, the bounty and weather seeds, the chat log and the pirate ships. Plain JSON on disk:
//
//   <dir>/universe.json            { schema, name, createdAt, epoch, weatherSeed, bountySeed, captains, events, moored,
//                                    market, chat, ships, fort, savedAt }   (fort: the Blackwater stronghold, wave 15)
//   <dir>/profiles/<hash>.json     { schema, captain, savedAt, profile }   one per captain (the GameState JSON)
//   <dir>/backups/<YYYY-MM-DD>/    a copy of both, made once a day; the newest `backupDays` are kept
//
// Every write is atomic (a .tmp file renamed over the old one); the server flushes every ~10 s and on shutdown.
// Identity without passwords: a captain is a name plus sha256 of the browser's random 128-bit token; the first token to
// use a name owns it. Anti-cheat (simple, documented in docs/HOSTING.md): a saved game is shape-checked and clamped, and
// its money may rise by at most MONEY_BURST + MONEY_RATE per online second since the last accepted save, plus the rewards
// of world events the server relayed for that captain (each at most REWARD_MAX); xp likewise. Spending is never limited.
//
//   const u = new Universe( { name, dir, log } );  u.load();  u.flush();  u.backup()
//   u.admit( { name, token, remote } ) -> { ok, key, name, isNew } | { ok: false, code, text }
//   u.ban( name, reason ) / u.unban( name ) / u.release( name ) (the next token to use the name owns it) / u.captainList()
//   u.loadProfile( key ) / u.storeProfile( key, raw, session ) -> { ok, fix?, reason? }
//   u.recordEvent( key, from, kind, data, now ) / u.expire( now ) -> [ expired events ]
//   u.moor( key, name, boat ) / u.unmoor( key ) / u.setMarket( sim ) / u.pushChat( line ) / u.setShips( list ) / u.setFort( snap )
//   u.info( now ) / u.worldFor( key, onlineKeys )

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, rmSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import {
	CLOCK_START, CLOCK_SPEED, CHAT_KEEP, MAX_MARKET, WORLD_EVENT_RULES,
	sanitizeCaptainName, captainKey, sanitizeToken, cleanText,
} from '../src/net/Protocol.js';
import { fencePrice } from '../src/features/hijack/Fence.js';

export const SCHEMA = 1;
export const MONEY_BURST = 5000; // $ a save may add beyond the rate (one good sale)
export const MONEY_RATE = 50; // $ per online second
export const MONEY_MAX = 1e9;
export const XP_BURST = 2000;
export const XP_RATE = 10; // xp per online second
export const REWARD_MAX = 10000; // $ a world event's `reward` may explain
export const EVENTS_MAX = 2000; // persisted world events
export const NEW_CAPTAINS_PER_HOUR = 5; // per address
// wave 16D: a stolen hull sold to Blackwater's fence ('stolenSold' { hull, price }) is priced by the server from her hull
// (hijack/Rules.js fencePrice: a brigantine fetches more than REWARD_MAX), never from the client's number alone
export const CREDIT_MAX = Math.max( REWARD_MAX * 3, fencePrice( 'brigantine' ) + REWARD_MAX );
// the kinds Protocol.WORLD_EVENT_RULES persists, plus the universe's own: wave 20E, a tavern hand one captain signed on is not
// offered to another for a week of island days (40-minute days: ~5 h; the hand's id names his port and week)
export const EVENT_RULES = { ...WORLD_EVENT_RULES, handHired: { key: 'id', ttl: 5 * 3600 } };

const sha256 = ( s ) => createHash( 'sha256' ).update( s ).digest( 'hex' );
const fin = ( v ) => typeof v === 'number' && Number.isFinite( v );
const clamp = ( v, lo, hi ) => ( v < lo ? lo : v > hi ? hi : v );
const day = ( t ) => new Date( t ).toISOString().slice( 0, 10 );

// write `text` to `file` atomically: a sibling .tmp first, then a rename over the old file (retried: Windows can hold it)
export function writeAtomic( file, text ) {

	const tmp = file + '.tmp';
	writeFileSync( tmp, text );
	for ( let i = 0; ; i ++ ) {

		try {

			renameSync( tmp, file );
			return;

		} catch ( e ) {

			if ( i >= 4 ) {

				// last resort: copy over and drop the tmp (still never leaves a half-written file behind on a crash before this)
				copyFileSync( tmp, file );
				try { unlinkSync( tmp ); } catch ( e2 ) { /* gone */ }
				return;

			}

			const until = Date.now() + 20 * ( i + 1 );
			while ( Date.now() < until ) { /* a short spin: the rename is retried in a moment */ }

		}

	}

}

function readJSON( file ) {

	try {

		return JSON.parse( readFileSync( file, 'utf8' ) );

	} catch ( e ) {

		return null;

	}

}

// ---- the saved game: shape and anti-cheat

// $ a relayed world event explains in the captain's next save: its numeric `reward` (at most REWARD_MAX), or for the fence's
// purchase of a stolen hull the price the server knows for that hull (capped by what the client says it got)
export function rewardFor( kind, data ) {

	if ( ! data || typeof data !== 'object' ) return 0;
	if ( kind === 'stolenSold' ) {

		const price = typeof data.hull === 'string' ? fencePrice( data.hull ) : 0;
		return price > 0 ? Math.min( price, fin( data.price ) && data.price > 0 ? data.price : price ) : 0;

	}

	return fin( data.reward ) && data.reward > 0 ? Math.min( data.reward, REWARD_MAX ) : 0;

}

const num = ( v, lo, hi, d = 0 ) => ( fin( v ) ? clamp( v, lo, hi ) : d );

// A captain's GameState JSON (src/game/GameState.js toJSON, v 2), checked and clamped against the previous accepted one.
// opts: { name (forced), elapsedMs (online time since the last save), credit ($ explained by server events) }
// -> { profile, fix: { money?, xp? } | null, notes: [] } or null when it is not a save at all.
export function sanitizeProfile( raw, prev = null, { name = '', elapsedMs = 0, credit = 0 } = {} ) {

	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) || ( raw.v !== 1 && raw.v !== 2 ) ) return null;
	const p = { ...raw }; // unknown top-level fields ride along (bounded by MAX_SAVE): a newer client keeps its data
	const notes = [];
	const fix = {};
	const secs = Math.max( 0, elapsedMs / 1000 );
	p.v = 2;
	p.mode = 'multiplayer';
	p.name = name;
	p.savedAt = Date.now();
	// money: spending is free, earning is bounded by online time (and the rewards the server relayed)
	let money = Math.round( num( raw.money, 0, MONEY_MAX, 0 ) * 100 ) / 100;
	const prevMoney = prev && fin( prev.money ) ? prev.money : 0;
	const maxMoney = prevMoney + MONEY_BURST + MONEY_RATE * secs + Math.max( 0, credit );
	if ( money > maxMoney ) {

		notes.push( `money ${ money } > ${ Math.round( maxMoney ) }` );
		money = fix.money = Math.floor( maxMoney );

	}

	p.money = money;
	let xp = Math.round( num( raw.xp, 0, 1e9, 0 ) );
	const prevXp = prev && fin( prev.xp ) ? prev.xp : 0;
	const maxXp = Math.floor( prevXp + XP_BURST + XP_RATE * secs );
	if ( xp > maxXp ) {

		notes.push( `xp ${ xp } > ${ maxXp }` );
		xp = fix.xp = maxXp;

	}

	p.xp = xp;
	// the rest: right types, sane sizes
	p.inventory = Array.isArray( raw.inventory ) ? raw.inventory.filter( ( f ) => f && typeof f === 'object' && typeof f.species === 'string' && f.species.length <= 32 && fin( f.kg ) && f.kg > 0 && f.kg < 5000 ).slice( 0, 400 ).map( ( f ) => ( { ...f, value: num( f.value, 0, 1e5, 0 ) } ) ) : [];
	p.log = raw.log && typeof raw.log === 'object' && ! Array.isArray( raw.log ) && Object.keys( raw.log ).length <= 300 ? raw.log : {};
	p.upgrades = {};
	if ( raw.upgrades && typeof raw.upgrades === 'object' ) for ( const [ k, v ] of Object.entries( raw.upgrades ).slice( 0, 32 ) ) if ( /^[a-zA-Z]{1,24}$/.test( k ) ) p.upgrades[ k ] = Math.round( num( v, 0, 20, 0 ) );
	p.unlocked = Array.isArray( raw.unlocked ) ? raw.unlocked.filter( ( s ) => typeof s === 'string' && s.length <= 32 ).slice( 0, 64 ) : [];
	p.character = typeof raw.character === 'string' && raw.character.length <= 32 ? raw.character : null;
	p.boat = typeof raw.boat === 'string' && raw.boat.length <= 32 ? raw.boat : null;
	p.fuel = fin( raw.fuel ) ? clamp( raw.fuel, 0, 1e5 ) : null;
	p.nextId = Math.round( num( raw.nextId, 1, 1e9, 1 ) );
	p.rep = {};
	if ( raw.rep && typeof raw.rep === 'object' ) for ( const [ k, v ] of Object.entries( raw.rep ).slice( 0, 32 ) ) if ( fin( v ) ) p.rep[ k ] = clamp( v, 0, 1000 );
	p.discovered = Array.isArray( raw.discovered ) ? raw.discovered.filter( ( s ) => typeof s === 'string' && s.length <= 32 ).slice( 0, 64 ) : [];
	p.career = {};
	// (wave 16D: the flags Game.js keeps there, metRoid / ponsFound, are booleans: dropping them replayed Roid's first meeting)
	if ( raw.career && typeof raw.career === 'object' ) for ( const [ k, v ] of Object.entries( raw.career ).slice( 0, 48 ) ) if ( fin( v ) ) p.career[ k ] = clamp( v, 0, 1e12 ); else if ( typeof v === 'boolean' && k.length <= 32 ) p.career[ k ] = v;
	for ( const k of [ 'quests', 'world', 'features' ] ) p[ k ] = raw[ k ] && typeof raw[ k ] === 'object' && ! Array.isArray( raw[ k ] ) ? raw[ k ] : ( k === 'world' ? null : {} );
	return { profile: p, fix: Object.keys( fix ).length ? fix : null, notes };

}

// ---- the universe

export class Universe {

	constructor( { name = 'hyptile', dir = null, log = () => {}, backupDays = 14, now = () => Date.now() } = {} ) {

		this.name = String( name ).toLowerCase().replace( /[^a-z0-9_-]/g, '' ).slice( 0, 32 ) || 'hyptile';
		this.dir = resolve( dir || join( 'server-data', this.name ) );
		this.log = log;
		this.backupDays = backupDays;
		this.now = now;
		this.state = null;
		this.profiles = new Map(); // key -> profile (loaded on demand)
		this.dirtyProfiles = new Set();
		this.dirty = false;
		this.newCaptains = new Map(); // address -> [ times ] (name squatting brake)
		this.credits = new Map(); // key -> $ explained by relayed reward events since the last save
		this.lastBackupDay = null;

	}

	get file() {

		return join( this.dir, 'universe.json' );

	}

	profileFile( key ) {

		return join( this.dir, 'profiles', sha256( 'captain:' + key ).slice( 0, 32 ) + '.json' );

	}

	// reads the universe (or makes a new one); a broken file falls back on the newest backup
	load() {

		mkdirSync( join( this.dir, 'profiles' ), { recursive: true } );
		let s = existsSync( this.file ) ? readJSON( this.file ) : null;
		if ( existsSync( this.file ) && ! s ) {

			const b = this._newestBackup();
			this.log( `universe: ${ this.file } is unreadable${ b ? `, restoring ${ b }` : '' }` );
			if ( b ) s = readJSON( join( b, 'universe.json' ) );

		}

		const t = this.now();
		const fresh = ! s || s.schema !== SCHEMA;
		if ( s && s.schema !== SCHEMA ) this.log( `universe: schema ${ s.schema } is not ${ SCHEMA }; starting a new universe (the old file is kept as universe.old.json)` );
		if ( s && s.schema !== SCHEMA && existsSync( this.file ) ) copyFileSync( this.file, join( this.dir, 'universe.old.json' ) );
		this.state = {
			schema: SCHEMA, name: this.name, createdAt: t, epoch: t, weatherSeed: randomInt( 1, 2 ** 31 ), bountySeed: randomInt( 1, 2 ** 31 ),
			captains: {}, events: {}, moored: {}, market: null, chat: [], ships: [], fort: null, savedAt: 0,
			...( fresh ? {} : s ),
		};
		const st = this.state;
		for ( const k of [ 'captains', 'events', 'moored' ] ) if ( ! st[ k ] || typeof st[ k ] !== 'object' ) st[ k ] = {};
		if ( ! Array.isArray( st.chat ) ) st.chat = [];
		if ( ! Array.isArray( st.ships ) ) st.ships = [];
		if ( ! fin( st.epoch ) ) st.epoch = t;
		if ( ! st.fort || typeof st.fort !== 'object' || Array.isArray( st.fort ) ) st.fort = null; // (a universe from before wave 15)
		this.dirty = fresh;
		this.lastBackupDay = ( this._backupDays().pop() || '' ).slice( 0, 10 ) || null;
		this.log( `universe '${ this.name }' ${ fresh ? 'created' : 'loaded' } in ${ this.dir }: ${ Object.keys( st.captains ).length } captains, ${ Object.keys( st.events ).length } world events` );
		if ( fresh ) this.flush();
		return this;

	}

	// writes what changed (atomically); a daily backup copy first thing each day
	flush( force = false ) {

		if ( ! this.state ) return false;
		let wrote = false;
		for ( const key of this.dirtyProfiles ) {

			const p = this.profiles.get( key );
			const rec = this.state.captains[ key ];
			if ( p && rec ) writeAtomic( this.profileFile( key ), JSON.stringify( { schema: SCHEMA, captain: rec.name, savedAt: p.savedAt || this.now(), profile: p } ) );
			wrote = true;

		}

		this.dirtyProfiles.clear();
		if ( this.dirty || force ) {

			this.state.savedAt = this.now();
			writeAtomic( this.file, JSON.stringify( this.state ) );
			this.dirty = false;
			wrote = true;

		}

		if ( this.lastBackupDay !== day( this.now() ) ) this.backup();
		return wrote;

	}

	// copies universe.json and the profiles into backups/<today>/ (once a day; `force` makes another today) and prunes old ones
	backup( force = false ) {

		const today = day( this.now() );
		let dest = join( this.dir, 'backups', today );
		if ( existsSync( dest ) && force ) dest = join( this.dir, 'backups', `${ today }-${ new Date( this.now() ).toISOString().slice( 11, 19 ).replace( /:/g, '' ) }` );
		this.lastBackupDay = today;
		if ( existsSync( dest ) ) return dest;
		try {

			mkdirSync( join( dest, 'profiles' ), { recursive: true } );
			if ( existsSync( this.file ) ) copyFileSync( this.file, join( dest, 'universe.json' ) );
			for ( const f of readdirSync( join( this.dir, 'profiles' ) ) ) if ( f.endsWith( '.json' ) ) copyFileSync( join( this.dir, 'profiles', f ), join( dest, 'profiles', f ) );
			const days = this._backupDays();
			while ( days.length > this.backupDays ) rmSync( join( this.dir, 'backups', days.shift() ), { recursive: true, force: true } );
			this.log( `universe: backup ${ dest }` );

		} catch ( e ) {

			this.log( `universe: backup failed: ${ e.message }` );

		}

		return dest;

	}

	_backupDays() {

		const b = join( this.dir, 'backups' );
		if ( ! existsSync( b ) ) return [];
		return readdirSync( b ).filter( ( d ) => /^\d{4}-\d{2}-\d{2}/.test( d ) && statSync( join( b, d ) ).isDirectory() ).sort();

	}

	_newestBackup() {

		const d = this._backupDays().reverse().find( ( x ) => existsSync( join( this.dir, 'backups', x, 'universe.json' ) ) );
		return d ? join( this.dir, 'backups', d ) : null;

	}

	// ---- clock and the public header

	hours( now = this.now() ) {

		return CLOCK_START + ( now - this.state.epoch ) / 1000 * CLOCK_SPEED;

	}

	info( now = this.now() ) {

		const st = this.state;
		return { name: st.name, day: Math.floor( this.hours( now ) / 24 ), seed: st.weatherSeed, bountySeed: st.bountySeed, createdAt: st.createdAt };

	}

	// ---- captains

	// may this name + token come in? Registers a new captain on first use.
	admit( { name, token, remote = '?' } = {} ) {

		const clean = sanitizeCaptainName( name );
		if ( ! clean ) return { ok: false, code: 'badname', text: 'Pick a captain name of 2 to 24 letters or numbers' };
		const tok = sanitizeToken( token );
		if ( ! tok ) return { ok: false, code: 'token', text: 'This game build sent no captain token; update the game' };
		const key = captainKey( clean );
		const st = this.state, t = this.now();
		const hash = sha256( tok );
		let rec = st.captains[ key ];
		if ( rec && rec.banned ) return { ok: false, code: 'banned', text: `Captain ${ rec.name } is banned from this universe` };
		if ( rec && rec.hash ) {

			const a = Buffer.from( rec.hash, 'hex' ), b = Buffer.from( hash, 'hex' );
			if ( a.length !== b.length || ! timingSafeEqual( a, b ) ) return { ok: false, code: 'name', text: `The name ${ rec.name } belongs to another captain on this server. Pick another name.` };

		}

		let isNew = false;
		if ( rec && ! rec.hash ) {

			// a released (or reserved) name: the first browser to use it now owns it
			rec.hash = hash;
			this.dirty = true;
			this.log( `universe: "${ rec.name }" claimed from ${ remote }` );

		}

		if ( ! rec ) {

			const times = ( this.newCaptains.get( remote ) || [] ).filter( ( x ) => t - x < 3600e3 );
			if ( times.length >= ( this.newPerHour ?? NEW_CAPTAINS_PER_HOUR ) ) return { ok: false, code: 'rate', text: 'Too many new captains from your address; try again later' };
			times.push( t );
			this.newCaptains.set( remote, times );
			rec = st.captains[ key ] = { name: clean, hash, createdAt: t, lastSeen: t, money: 0, xp: 0, lastSaveAt: 0 };
			isNew = true;
			this.dirty = true;
			this.log( `universe: new captain "${ clean }" from ${ remote }` );

		}

		return { ok: true, key, name: rec.name, isNew };

	}

	// the console's kick list and ban list work on names
	findCaptain( name ) {

		const key = captainKey( name );
		return this.state.captains[ key ] ? key : null;

	}

	ban( name, reason = '' ) {

		const key = captainKey( name );
		if ( ! key ) return null;
		const rec = this.state.captains[ key ] || ( this.state.captains[ key ] = { name: cleanText( name, 24 ), hash: null, createdAt: this.now() } );
		rec.banned = { at: this.now(), reason: cleanText( reason, 120 ) };
		this.dirty = true;
		return rec.name;

	}

	// the captain lost the browser token (cleared site data, a new PC): the next browser to join with the name owns it
	release( name ) {

		const rec = this.state.captains[ captainKey( name ) ];
		if ( ! rec ) return null;
		rec.hash = null;
		this.dirty = true;
		return rec.name;

	}

	unban( name ) {

		const rec = this.state.captains[ captainKey( name ) ];
		if ( ! rec || ! rec.banned ) return null;
		delete rec.banned;
		this.dirty = true;
		return rec.name;

	}

	seen( key ) {

		const rec = this.state.captains[ key ];
		if ( rec ) {

			rec.lastSeen = this.now();
			this.dirty = true;

		}

	}

	// ---- profiles

	loadProfile( key ) {

		if ( this.profiles.has( key ) ) return this.profiles.get( key );
		const d = readJSON( this.profileFile( key ) );
		const p = d && d.profile && typeof d.profile === 'object' ? d.profile : null;
		if ( p ) this.profiles.set( key, p );
		return p;

	}

	// a save from the captain's client; session: { startedAt } of its connection (offline time earns nothing)
	storeProfile( key, raw, session = {} ) {

		const rec = this.state.captains[ key ];
		if ( ! rec ) return { ok: false, reason: 'captain' };
		const prev = this.loadProfile( key );
		const t = this.now();
		const since = Math.max( rec.lastSaveAt || 0, session.startedAt || t );
		const credit = this.credits.get( key ) || 0;
		const base = prev ? { money: prev.money, xp: prev.xp } : { money: rec.money || 0, xp: rec.xp || 0 };
		const r = sanitizeProfile( raw, base, { name: rec.name, elapsedMs: t - since, credit } );
		if ( ! r ) return { ok: false, reason: 'shape' };
		if ( r.fix ) this.log( `universe: clamped "${ rec.name }" save (${ r.notes.join( ', ' ) })` );
		this.profiles.set( key, r.profile );
		this.dirtyProfiles.add( key );
		this.credits.delete( key );
		rec.lastSaveAt = t;
		rec.money = r.profile.money;
		rec.xp = r.profile.xp;
		rec.lastSeen = t;
		if ( r.fix ) rec.clamped = ( rec.clamped || 0 ) + 1;
		this.dirty = true;
		return { ok: true, fix: r.fix };

	}

	// ---- world events

	// relayed by a captain (or a guest of a crew room: key null): persisted when EVENT_RULES knows the kind; a numeric
	// data.reward explains that much money in the captain's next save
	recordEvent( key, from, kind, data, now = this.now() ) {

		const reward = rewardFor( kind, data );
		if ( key && reward > 0 ) this.credits.set( key, Math.min( ( this.credits.get( key ) || 0 ) + reward, CREDIT_MAX ) );
		const rule = EVENT_RULES[ kind ];
		if ( ! rule ) return false;
		const id = data ? data[ rule.key ] : undefined;
		if ( typeof id !== 'string' && ! fin( id ) ) return false;
		const ev = this.state.events;
		if ( rule.clears ) {

			const k = `${ rule.clears }:${ id }`;
			if ( ev[ k ] ) {

				delete ev[ k ];
				this.dirty = true;

			}

			return true;

		}

		let ttl = rule.ttl;
		if ( rule.ttlField && fin( data[ rule.ttlField ] ) ) ttl = clamp( data[ rule.ttlField ], rule.min || 1, rule.max || ttl );
		ev[ `${ kind }:${ id }` ] = { kind, data, from, at: now, until: now + ttl * 1000 };
		const keys = Object.keys( ev );
		if ( keys.length > EVENTS_MAX ) {

			keys.sort( ( a, b ) => ev[ a ].at - ev[ b ].at );
			for ( const k of keys.slice( 0, keys.length - EVENTS_MAX ) ) delete ev[ k ];

		}

		this.dirty = true;
		return true;

	}

	// drops the events whose time ran out; returns the expiry events to broadcast ( { kind, data } )
	expire( now = this.now() ) {

		const out = [];
		const ev = this.state.events;
		for ( const k of Object.keys( ev ) ) {

			const e = ev[ k ];
			if ( e.until > now ) continue;
			delete ev[ k ];
			this.dirty = true;
			const rule = EVENT_RULES[ e.kind ];
			if ( ! rule || ! rule.expire ) continue;
			const data = { [ rule.key ]: e.data[ rule.key ] };
			for ( const f of rule.carry || [] ) if ( e.data[ f ] !== undefined ) data[ f ] = e.data[ f ]; // (a prop's respawn names its port)
			out.push( { kind: rule.expire, data } );

		}

		return out;

	}

	// ---- boats left at their moorings by captains who went offline

	moor( key, name, boat ) {

		if ( ! key || ! boat || typeof boat.id !== 'string' || ! Array.isArray( boat.p ) ) return null;
		const m = { captain: key, name, boat: boat.id, p: boat.p.slice( 0, 3 ), q: Array.isArray( boat.q ) ? boat.q.slice( 0, 4 ) : [ 0, 0, 0, 1 ], at: this.now() };
		this.state.moored[ key ] = m;
		this.dirty = true;
		return m;

	}

	unmoor( key ) {

		if ( ! this.state.moored[ key ] ) return false;
		delete this.state.moored[ key ];
		this.dirty = true;
		return true;

	}

	// ---- shared market, chat, pirates

	setMarket( sim ) {

		if ( ! sim || typeof sim !== 'object' || Array.isArray( sim ) ) return false;
		if ( JSON.stringify( sim ).length > MAX_MARKET ) return false;
		this.state.market = { at: this.now(), sim };
		this.dirty = true;
		return true;

	}

	pushChat( line ) {

		const chat = this.state.chat;
		chat.push( { name: cleanText( line.name, 24 ), text: cleanText( line.text, 200 ), at: line.at || this.now(), system: line.system === true || undefined } );
		if ( chat.length > CHAT_KEEP ) chat.splice( 0, chat.length - CHAT_KEEP );
		this.dirty = true;

	}

	setShips( ships ) {

		this.state.ships = Array.isArray( ships ) ? ships.slice( 0, 12 ) : [];
		this.state.shipsAt = this.now();
		this.dirty = true;

	}

	// the Blackwater stronghold (schema.readFort of the room's `fort`), kept like the moored boats so a restart does not hand
	// a claimed island back to the pirates; written only when it changed (the host's heartbeat repeats itself)
	setFort( snap ) {

		if ( ! snap || typeof snap !== 'object' || Array.isArray( snap ) ) return false;
		const { by, ...keep } = snap; // (`by` is a session id: meaningless after a restart; byName stays)
		const text = JSON.stringify( keep );
		if ( text.length > 8192 ) return false;
		if ( this._fortText === text ) return false;
		this._fortText = text;
		this.state.fort = { ...keep, at: this.now() };
		this.dirty = true;
		return true;

	}

	// what a joining captain needs: the live world events, the boats of offline captains (not its own), market, chat
	worldFor( key, onlineKeys = new Set() ) {

		const st = this.state, now = this.now();
		const events = Object.values( st.events ).filter( ( e ) => e.until > now ).sort( ( a, b ) => a.at - b.at ).slice( - 1500 );
		const boats = Object.values( st.moored ).filter( ( m ) => m.captain !== key && ! onlineKeys.has( m.captain ) );
		return { events, boats, market: st.market ? st.market.sim : null, chat: st.chat.slice( - CHAT_KEEP ) };

	}

	captainList() {

		return Object.values( this.state.captains ).map( ( c ) => ( { name: c.name, lastSeen: c.lastSeen || 0, money: c.money || 0, banned: !! c.banned } ) );

	}

}
