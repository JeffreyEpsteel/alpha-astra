import { FISH, fishValue, fishLengthCm } from './FishTable.js';
import { defaultUpgrades, gearStats, nextLevel, unmetReqs, UPGRADES, FUEL_PRICE } from './Gear.js';
import { CHARACTERS, DEFAULT_CHARACTER } from './Characters.js';
import { BOATS, upgradePrice } from './Boats.js';
import { xpFor, repFor, levelFor, progress, PORTS, REP_MAX } from './Progression.js';
import { DEFAULT_MODE, isMode, rules, saveSpace } from './GameMode.js';

export const SAVE_KEY = 'alpha-astra.save.v2';
const OLD_SAVE_KEY = 'alpha-astra.save.v1'; // only candidate-owned legacy data; original-game data is imported explicitly
export const SLOTS = 4; // save slots 0..3 (slot 0 is the original key, the others are suffixed)

// Everything the player owns: wallet, the fish in the cooler / hold, the fish log, the gear levels,
// the character they play (and the ones unlocked), the boat (or none), quest progress, career
// stats, xp and port reputation. Saved to localStorage (per browser) after every change; storage can
// be missing or throw (private windows, blocked site data), so every access is guarded and the game
// runs without it. Four save slots: slot 0 keeps the original key (older saves load as they are),
// slots 1..3 add a `.slotN` suffix (see slotKey / useSlot / listSlots). Each game mode (GameMode.js) has
// its own four slots: the campaign keeps the original keys, the others prefix them (`sandbox.<key>`).
// Sandbox is free play: every character is unlocked and boats, gear and diesel cost nothing (`free`).
// `world` is where you are (player, boat, time of day): the game fills it through `beforeSave` just
// before each write and puts you back there after loading (App.captureWorld / App.applyWorld).
export class GameState {

	constructor( storage = safeStorage() ) {

		this.storage = storage;
		this.slot = 0;
		this.mode = DEFAULT_MODE; // 'sandbox' | 'campaign' | 'multiplayer'
		this.world = null; // { player: { x, y, z, yaw, mode }, boat: { x, z, heading, moored } | null, timeOfDay } | null
		this.beforeSave = null; // () => world | null: the game's snapshot, taken by save()
		this.xp = 0;
		this.rep = defaultRep(); // port id -> 0..REP_MAX
		this.discovered = []; // port ids visited (discover())
		this.lastLevelUp = 0; // the level reached by the last addXp that crossed a threshold (the HUD clears it)
		this.money = 0;
		this.inventory = []; // { id, species, kg, cm, value, caughtAt (game hours), record }
		this.log = {}; // species -> { count, bestKg, bestCm }
		// the last addFish: { species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept, timeOfDay, where } (the catch card)
		this.lastCatch = null;
		this.upgrades = defaultUpgrades();
		this.fuel = null; // litres left (null = full tank)
		this.character = DEFAULT_CHARACTER;
		this.unlocked = [ DEFAULT_CHARACTER ];
		this.boat = null; // BOATS id, or null on foot
		this.quests = {}; // owned by Contracts.js (serialised as is)
		this.career = defaultStats();
		this.name = ''; // multiplayer display name
		this._nextId = 1;
		this.listeners = new Set();
		// the v2 features' saved data (src/features): read back by App after a load, written through featuresProvider
		this.featuresData = {};
		this.featuresProvider = null;

	}

	// free play (sandbox): nothing needs money
	get free() {

		return rules( this.mode ).freeUnlocks;

	}

	// switches the rule set (the key space of the saves too). It does not load anything: call useSlot() after
	// to read that mode's slot. Sandbox unlocks the whole crew at once.
	setMode( mode ) {

		const m = isMode( mode ) ? mode : DEFAULT_MODE;
		if ( m === this.mode ) return false;
		this.mode = m;
		this._applyMode();
		this.emit();
		return true;

	}

	_applyMode() {

		if ( this.free ) this.unlocked = Object.keys( CHARACTERS );

	}

	// gear stats, with the boat's hold / tank multipliers applied (no boat: the cooler and no tank)
	get stats() {

		const s = gearStats( this.upgrades );
		const b = BOATS[ this.boat ];
		if ( b ) {

			s.holdKg = Math.round( s.holdKg * b.holdMul * ( this.holdKgBonus ? this.holdKgBonus() || 1 : 1 ) ); // naval fish well
			s.fuelL = Math.round( s.fuelL * b.fuelMul );
			s.maxThrust = b.maxThrust * s.speedMul * s.speedMul;
			s.pitchSpeed = b.pitchSpeed * s.speedMul;

		}

		return s;

	}

	get holdKg() {

		let kg = 0;
		for ( const f of this.inventory ) kg += f.kg;
		return kg;

	}

	get holdValue() {

		let v = 0;
		for ( const f of this.inventory ) v += f.value;
		return v;

	}

	// room in the cooler / hold for a fish of `kg`?
	fits( kg ) {

		return this.holdKg + kg <= this.stats.holdKg + 1e-6;

	}

	// store a caught fish; returns the entry, or null when the hold is full (it is logged either way).
	// A record beats an earlier catch of the species; the first one of a species is a new species.
	// where: { habitat: 'reef' | 'deep' | 'pier' | 'shallows' | 'bay', aboard: bool } for the career stats
	addFish( species, kg, timeOfDay = 12, where = null ) {

		kg = Math.round( kg * 100 ) / 100;
		const cm = Math.round( fishLengthCm( species, kg ) );
		const logEntry = this.log[ species ] || ( this.log[ species ] = { count: 0, bestKg: 0 } );
		const newSpecies = logEntry.count === 0;
		const prevBestKg = logEntry.bestKg, prevBestCm = logEntry.bestCm ?? ( prevBestKg > 0 ? Math.round( fishLengthCm( species, prevBestKg ) ) : 0 );
		const record = ! newSpecies && kg > prevBestKg;
		logEntry.count ++;
		if ( kg > prevBestKg ) {

			logEntry.bestKg = kg;
			logEntry.bestCm = cm;

		}

		const value = fishValue( species, kg );
		const kept = this.fits( kg );
		this.lastCatch = { species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept, timeOfDay, where };
		const st = this.career;
		st.caught ++;
		st.kg += kg;
		if ( record ) st.records ++;
		if ( newSpecies ) st.species ++;
		if ( timeOfDay < 6 || timeOfDay >= 19.5 ) st.night ++;
		if ( where && where.habitat === 'reef' ) st.reef ++;
		if ( where && where.habitat === 'deep' ) st.deep ++;
		if ( where && where.aboard ) st.aboard ++;
		// catch xp (the card shows it): 5 + kg, a record and a new species on top
		const xp = this._gainXp( xpFor( 'catch', { kg, record, newSpecies } ) );
		this.lastCatch.xp = xp.gained;
		this.lastCatch.levelUp = xp.levelUp;
		if ( ! kept ) {

			this.save();
			this.emit();
			return null;

		}

		const f = { id: this._nextId ++, species, kg, cm, value, caughtAt: timeOfDay, record };
		this.inventory.push( f );
		this.save();
		this.emit();
		return f;

	}

	// sell the given fish ids (all when omitted) at a port (reputation there); returns the money made
	sell( ids = null, port = 'home' ) {

		const keep = [], sold = [];
		for ( const f of this.inventory ) ( ids === null || ids.includes( f.id ) ? sold : keep ).push( f );
		let total = 0;
		for ( const f of sold ) total += f.value;
		this.inventory = keep;
		this.money += total;
		this.career.earned += total;
		this.career.sold += sold.length;
		const xp = this._gainXp( xpFor( 'sale', { total } ) );
		if ( total > 0 ) this._gainRep( port, repFor( 'sale', { total } ) );
		this.save();
		this.emit();
		return { total, count: sold.length, xp: xp.gained, levelUp: xp.levelUp };

	}

	// ---- progression (Progression.js keeps the rules)

	get level() {

		return levelFor( this.xp );

	}

	// { xp, level, prevXp, nextXp, frac, title, rep }
	get progress() {

		return progress( this );

	}

	// add xp (a quest delivery, a discovery: the game calls this; catches and sales add their own).
	// Returns { gained, xp, level, levelUp } (levelUp: the new level, or 0)
	addXp( n ) {

		const r = this._gainXp( n );
		this.save();
		this.emit();
		return r;

	}

	_gainXp( n ) {

		const gained = Math.max( 0, Math.round( Number.isFinite( n ) ? n : 0 ) );
		const before = this.level;
		this.xp += gained;
		const level = this.level;
		const levelUp = level > before ? level : 0;
		if ( levelUp ) this.lastLevelUp = levelUp;
		return { gained, xp: this.xp, level, levelUp };

	}

	// reputation at a port (0..REP_MAX); returns the new value
	addRep( port, n ) {

		const r = this._gainRep( port, n );
		this.save();
		this.emit();
		return r;

	}

	_gainRep( port, n ) {

		const id = typeof port === 'string' && port ? port : 'home';
		const cur = Number.isFinite( this.rep[ id ] ) ? this.rep[ id ] : 0;
		const v = Math.max( 0, Math.min( REP_MAX, cur + ( Number.isFinite( n ) ? n : 0 ) ) );
		this.rep[ id ] = Math.round( v * 100 ) / 100;
		return this.rep[ id ];

	}

	// first visit to a port: true the first time (and the discovery xp), false after
	discover( portId ) {

		if ( typeof portId !== 'string' || ! portId || this.discovered.includes( portId ) ) return false;
		this.discovered.push( portId );
		this._gainXp( xpFor( 'discovery', { port: portId } ) );
		this.save();
		this.emit();
		return true;

	}

	// take the given fish ids out of the hold without payment (a quest delivery); returns them
	takeFish( ids ) {

		const taken = this.inventory.filter( ( f ) => ids.includes( f.id ) );
		this.inventory = this.inventory.filter( ( f ) => ! ids.includes( f.id ) );
		this.save();
		this.emit();
		return taken;

	}

	release( id ) {

		this.inventory = this.inventory.filter( ( f ) => f.id !== id );
		this.save();
		this.emit();

	}

	// money in (quest rewards)
	earn( amount ) {

		this.money += amount;
		this.career.earned += amount;
		this.save();
		this.emit();
		return this.money;

	}

	// spend money; false when it can't be afforded (sandbox: always fine, nothing is taken)
	spend( amount ) {

		if ( this.free ) return true;
		if ( amount > this.money ) return false;
		this.money -= amount;
		this.save();
		this.emit();
		return true;

	}

	// buy the next level of an upgrade track; returns the new level entry or null
	buy( key, standing = null, discount = 0 ) {

		if ( ! UPGRADES[ key ] ) return null;
		const next = nextLevel( this.upgrades, key );
		if ( next && unmetReqs( this, next.req, standing ).length ) return null; // gated gear (level, reputation, quest, standing)
		const cost = next && ! this.free ? Math.round( next.cost * ( 1 - Math.min( 0.9, Math.max( 0, discount || 0 ) ) ) ) : 0;
		if ( ! next || cost > this.money ) return null;
		this.money -= cost;
		this.upgrades[ key ] = next.index;
		if ( key === 'fuel' ) this.fuel = null; // a new tank comes full
		this.save();
		this.emit();
		return next;

	}

	// ---- characters

	isUnlocked( id ) {

		return this.unlocked.includes( id );

	}

	// unlock a character: by paying (kind 'buy'), or for free (a quest reward, `free`); false when not possible
	unlockCharacter( id, { free = false } = {} ) {

		const c = CHARACTERS[ id ];
		if ( ! c || this.isUnlocked( id ) ) return false;
		if ( ! free ) {

			if ( c.unlock.kind !== 'buy' || c.unlock.cost > this.money ) return false;
			this.money -= c.unlock.cost;

		}

		this.unlocked.push( id );
		this.save();
		this.emit();
		return true;

	}

	setCharacter( id ) {

		if ( ! CHARACTERS[ id ] || ! this.isUnlocked( id ) || this.character === id ) return false;
		this.character = id;
		this.save();
		this.emit();
		return true;

	}

	// ---- boats

	// what the yard asks to move to boat `id` (trade-in credited); 0 in the sandbox
	boatPrice( id ) {

		if ( this.free ) return BOATS[ id ] ? 0 : Infinity;
		return upgradePrice( this.boat, id );

	}

	// buy (or trade up / down to) a boat; false when it can't be afforded or is already yours
	buyBoat( id ) {

		if ( ! BOATS[ id ] || id === this.boat ) return false;
		const price = this.boatPrice( id );
		if ( price > this.money ) return false;
		this.money -= price;
		this.boat = id;
		this.fuel = null; // delivered with a full tank
		this.career.boats ++;
		this.save();
		this.emit();
		return true;

	}

	get fuelL() {

		return this.fuel === null ? this.stats.fuelL : Math.min( this.fuel, this.stats.fuelL );

	}

	// burn litres (no save: that happens when the boat stops or at the next sale / purchase)
	burn( litres ) {

		this.fuel = Math.max( 0, this.fuelL - litres );
		return this.fuel;

	}

	// a broken rod (the fight hauled far past the line): Ethena repairs it for a share of the rod's value
	rodRepairCost() {

		const lvl = ( this.upgrades && this.upgrades.rod ) | 0;
		return 90 + lvl * 70;

	}

	repairRod() {

		if ( ! this.rodBroken ) return false;
		const cost = this.free ? 0 : this.rodRepairCost();
		if ( cost && ! this.spend( cost ) ) return false;
		this.rodBroken = false;
		this.save();
		return true;

	}

	refuelCost() {

		if ( this.free ) return 0;
		return Math.ceil( ( this.stats.fuelL - this.fuelL ) * FUEL_PRICE );

	}

	// fill up as far as the money goes (all the way in the sandbox); returns litres bought
	refuel() {

		const missing = this.stats.fuelL - this.fuelL;
		if ( this.free ) {

			if ( missing <= 0 ) return 0;
			this.fuel = null;
			this.save();
			this.emit();
			return missing;

		}

		const litres = Math.min( missing, Math.floor( this.money / FUEL_PRICE ) );
		if ( litres <= 0 ) return 0;
		this.money -= Math.ceil( litres * FUEL_PRICE );
		this.fuel = this.fuelL + litres;
		if ( this.fuel >= this.stats.fuelL - 1e-3 ) this.fuel = null;
		this.save();
		this.emit();
		return litres;

	}

	onChange( fn ) {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	emit() {

		for ( const fn of this.listeners ) fn( this );

	}

	toJSON() {

		return {
			v: 2, money: this.money, inventory: this.inventory, log: this.log, upgrades: this.upgrades, fuel: this.fuel, nextId: this._nextId,
			character: this.character, unlocked: this.unlocked, boat: this.boat, quests: this.quests, career: this.career, name: this.name,
			xp: this.xp, rep: this.rep, discovered: this.discovered, savedAt: Date.now(),
			mode: this.mode, world: this.world, rodBroken: !! this.rodBroken,
			features: this._featuresJSON(),
		};

	}

	_featuresJSON() {

		if ( this.featuresProvider ) {

			try { this.featuresData = this.featuresProvider() || {}; } catch ( e ) { /* keep the last data */ }

		}

		return this.featuresData;

	}

	fromJSON( d ) {

		if ( ! d || ( d.v !== 1 && d.v !== 2 ) ) return false;
		// progression (saves from before it: level 1, no reputation, nothing discovered)
		this.xp = Number.isFinite( d.xp ) && d.xp > 0 ? Math.round( d.xp ) : 0;
		this.rep = defaultRep();
		if ( d.rep && typeof d.rep === 'object' ) for ( const [ k, v ] of Object.entries( d.rep ) ) if ( Number.isFinite( v ) ) this.rep[ k ] = Math.max( 0, Math.min( REP_MAX, v ) );
		this.discovered = Array.isArray( d.discovered ) ? d.discovered.filter( ( id ) => typeof id === 'string' && id ) : [];
		this.lastLevelUp = 0;
		this.money = Number.isFinite( d.money ) ? d.money : 0;
		this.inventory = Array.isArray( d.inventory ) ? d.inventory.filter( ( f ) => f && FISH[ f.species ] && Number.isFinite( f.kg ) ) : [];
		// saves from before lengths were recorded
		for ( const f of this.inventory ) if ( ! Number.isFinite( f.cm ) ) f.cm = Math.round( fishLengthCm( f.species, f.kg ) );
		this.log = d.log && typeof d.log === 'object' ? d.log : {};
		for ( const [ k, v ] of Object.entries( this.log ) ) if ( FISH[ k ] && v && v.bestKg > 0 && ! Number.isFinite( v.bestCm ) ) v.bestCm = Math.round( fishLengthCm( k, v.bestKg ) );
		this.upgrades = { ...defaultUpgrades(), ...( d.upgrades || {} ) };
		this.rodBroken = !! d.rodBroken;
		this.fuel = Number.isFinite( d.fuel ) ? d.fuel : null;
		this._nextId = Math.max( d.nextId | 0, ...this.inventory.map( ( f ) => f.id + 1 ), 1 );
		// (the mode is the save's key space, set before loading: the `mode` stored in the file is informational)
		this.world = parseWorld( d.world );
		this.featuresData = d.features && typeof d.features === 'object' ? d.features : {};
		if ( d.v === 1 ) {

			// a Tidewater save: the boat it came with was the lobster boat
			this.boat = 'lobster';
			return true;

		}

		this.unlocked = Array.isArray( d.unlocked ) ? d.unlocked.filter( ( id ) => CHARACTERS[ id ] ) : [];
		if ( ! this.unlocked.includes( DEFAULT_CHARACTER ) ) this.unlocked.unshift( DEFAULT_CHARACTER );
		this._applyMode();
		this.character = CHARACTERS[ d.character ] && this.unlocked.includes( d.character ) ? d.character : DEFAULT_CHARACTER;
		this.boat = BOATS[ d.boat ] ? d.boat : null;
		this.quests = d.quests && typeof d.quests === 'object' ? d.quests : {};
		this.career = { ...defaultStats(), ...( d.career && typeof d.career === 'object' ? d.career : {} ) };
		this.name = typeof d.name === 'string' ? d.name.slice( 0, 24 ) : '';
		return true;

	}

	// ---- storage and save slots

	// the localStorage key of a slot: slot 0 is the original key, 1.. add `.slotN`; the sandbox and the
	// multiplayer slots are the same keys behind a `<mode>.` prefix (the campaign has no prefix)
	static slotKey( slot, mode = DEFAULT_MODE ) {

		const n = slot | 0;
		const key = n > 0 ? `${ SAVE_KEY }.slot${ n }` : SAVE_KEY;
		const space = saveSpace( mode );
		return space ? `${ space }.${ key }` : key;

	}

	get key() {

		return GameState.slotKey( this.slot, this.mode );

	}

	// writes the current slot (the world snapshot first); true when it was written
	save() {

		if ( ! this.storage ) return false;
		if ( this.beforeSave ) {

			try {

				const w = this.beforeSave( this );
				if ( w ) this.world = w;

			} catch ( e ) { /* the snapshot is optional */ }

		}

		try {

			this.storage.setItem( this.key, JSON.stringify( this.toJSON() ) );
			return true;

		} catch ( e ) {

			return false; // storage full or blocked: keep playing

		}

	}

	// loads the current slot (campaign slot 0 may read the candidate's legacy key); false when there is none
	load() {

		if ( ! this.storage ) return false;
		try {

			const raw = this.storage.getItem( this.key ) || ( this.slot === 0 && this.mode === DEFAULT_MODE ? this.storage.getItem( OLD_SAVE_KEY ) : null );
			return raw ? this.fromJSON( JSON.parse( raw ) ) : false;

		} catch ( e ) {

			return false;

		}

	}

	// switch to a slot (of `mode` when given: the rules and the save space change with it) and load it (a
	// fresh islander when it is empty); returns whether it existed.
	// Nothing is written until the next change, so an empty slot stays "Empty" until play starts.
	useSlot( slot, mode = this.mode ) {

		this.mode = isMode( mode ) ? mode : DEFAULT_MODE;
		this.slot = Math.max( 0, Math.min( SLOTS - 1, slot | 0 ) );
		this._defaults();
		const existed = this.load();
		if ( ! existed ) this._defaults();
		this.emit();
		return existed;

	}

	// remove a slot's save (the current one becomes a fresh islander, unsaved)
	deleteSlot( slot, mode = this.mode ) {

		const n = Math.max( 0, Math.min( SLOTS - 1, slot | 0 ) );
		const m = isMode( mode ) ? mode : DEFAULT_MODE;
		GameState.removeSlot( this.storage, n, m );
		if ( n === this.slot && m === this.mode ) {

			this._defaults();
			this.emit();

		}

	}

	// remove a stored save only (the menu's Delete: nothing in memory changes)
	static removeSlot( storage, slot, mode = DEFAULT_MODE ) {

		if ( ! storage ) return;
		const n = Math.max( 0, Math.min( SLOTS - 1, slot | 0 ) );
		const m = isMode( mode ) ? mode : DEFAULT_MODE;
		try {

			if ( typeof storage.removeItem === 'function' ) storage.removeItem( GameState.slotKey( n, m ) );
			else storage.setItem( GameState.slotKey( n, m ), '' );
			if ( n === 0 && m === DEFAULT_MODE && typeof storage.removeItem === 'function' ) storage.removeItem( OLD_SAVE_KEY );

		} catch ( e ) { /* blocked */ }

	}

	// a lightweight look at every slot of a mode (the menu): [ { slot, mode, exists, name, character, money, level, boat, playSeconds, savedAt } ]
	static listSlots( storage = safeStorage(), count = SLOTS, mode = DEFAULT_MODE ) {

		const out = [];
		mode = isMode( mode ) ? mode : DEFAULT_MODE;
		for ( let slot = 0; slot < count; slot ++ ) {

			const row = { slot, mode, exists: false, name: '', character: DEFAULT_CHARACTER, money: 0, level: 1, xp: 0, boat: null, playSeconds: 0, savedAt: 0 };
			out.push( row );
			if ( ! storage ) continue;
			try {

				const raw = storage.getItem( GameState.slotKey( slot, mode ) ) || ( slot === 0 && mode === DEFAULT_MODE ? storage.getItem( OLD_SAVE_KEY ) : null );
				if ( ! raw ) continue;
				const d = JSON.parse( raw );
				if ( ! d || ( d.v !== 1 && d.v !== 2 ) ) continue;
				row.exists = true;
				row.name = typeof d.name === 'string' ? d.name.slice( 0, 24 ) : '';
				row.character = CHARACTERS[ d.character ] ? d.character : DEFAULT_CHARACTER;
				row.money = Number.isFinite( d.money ) ? d.money : 0;
				row.xp = Number.isFinite( d.xp ) ? d.xp : 0;
				row.level = levelFor( row.xp );
				row.boat = d.v === 1 ? 'lobster' : ( BOATS[ d.boat ] ? d.boat : null );
				row.playSeconds = d.career && Number.isFinite( d.career.playSeconds ) ? d.career.playSeconds : 0;
				row.savedAt = Number.isFinite( d.savedAt ) ? d.savedAt : 0;

			} catch ( e ) { /* unreadable: shown as empty */ }

		}

		return out;

	}

	// in-memory defaults (no save, no emit)
	_defaults() {

		this.money = 0;
		this.inventory = [];
		this.log = {};
		this.lastCatch = null;
		this.upgrades = defaultUpgrades();
		this.fuel = null;
		this.character = DEFAULT_CHARACTER;
		this.unlocked = [ DEFAULT_CHARACTER ];
		this._applyMode();
		this.boat = null;
		this.quests = {};
		this.career = defaultStats();
		this.xp = 0;
		this.rep = defaultRep();
		this.discovered = [];
		this.lastLevelUp = 0;
		this.world = null;
		this._nextId = 1;

	}

	reset() {

		this.featuresData = {};

		const name = this.name; // the display name stays with the browser, not the run
		this._defaults();
		this.name = name;
		this.save();
		this.emit();

	}

}

// the player modes a save can hold: on foot (walk / swim load as walk) or aboard (deck / boat / seat)
const WORLD_MODES = [ 'walk', 'swim', 'deck', 'boat', 'seat' ];

// Where you are, as stored in the save, checked and trimmed (a bad or missing field is dropped):
//   { player: { x, y, z, yaw, mode } | null, boat: { x, z, heading, moored } | null, timeOfDay: hours 0..24 | null } | null
// x / y / z in metres, yaw / heading in radians. App.captureWorld() builds it, App.applyWorld() reads it.
export function parseWorld( w ) {

	if ( ! w || typeof w !== 'object' ) return null;
	const num = ( v, lim = 1e5 ) => typeof v === 'number' && Number.isFinite( v ) && Math.abs( v ) <= lim;
	const out = { player: null, boat: null, timeOfDay: null };
	const p = w.player;
	if ( p && typeof p === 'object' && num( p.x ) && num( p.y ) && num( p.z ) ) {

		out.player = { x: p.x, y: p.y, z: p.z, yaw: num( p.yaw, 1e4 ) ? p.yaw : 0, mode: WORLD_MODES.includes( p.mode ) ? p.mode : 'walk' };

	}

	const b = w.boat;
	if ( b && typeof b === 'object' && num( b.x ) && num( b.z ) ) out.boat = { x: b.x, z: b.z, heading: num( b.heading, 1e4 ) ? b.heading : 0, moored: !! b.moored };
	if ( num( w.timeOfDay, 1e6 ) ) out.timeOfDay = ( ( w.timeOfDay % 24 ) + 24 ) % 24;
	return out.player || out.boat || out.timeOfDay !== null ? out : null;

}

export function defaultRep() {

	const r = {};
	for ( const p of PORTS ) r[ p ] = 0;
	return r;

}

export function defaultStats() {

	// caught: fish landed; kg: total weight; records, species: firsts; night / reef / deep / aboard: catches
	// by circumstance (quests); sold: fish sold; earned: money ever made; boats: boats bought; playSeconds
	return { caught: 0, kg: 0, records: 0, species: 0, night: 0, reef: 0, deep: 0, aboard: 0, sold: 0, earned: 0, boats: 0, playSeconds: 0, assisted: 0 };

}

function safeStorage() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}
