// Ship modules and upgrades: the naval fork's boat modules (UpsideDownFishing BoatModuleComponent: slots by kind,
// a tier ladder per module, a price, neutral-by-default effect multipliers, a visible mesh per fitted module; the mesh
// kit is Assets/NavalModules, converted to public/models/modules by tools/modules/build.ps1). Pure data and rules,
// no engine: the node tests drive it directly (test/feature-modules.mjs).
//
//   MODULES[ id ] = { label, slot, desc, mesh, tiers: [ { name, price, ...effects } ] }    tier n = tiers[ n - 1 ]
//     slot kinds (Boats.js `slots`, one entry per slot): 'hull' | 'arms' | 'drive' | 'hold' | 'deck'
//     effects (all optional and neutral when absent):
//       hpMul   hull points x            taken   damage taken x         speed   top speed x (naval.speedFactor = thrust x speed^2)
//       dmg     gun damage x             range   gun reach x            reload  reload time x
//       cargo   cargo crates x (trade: naval.holdBonus())   holdKg  fish hold x (GameState stats.holdKg)
//       nightBite  bites come this much faster at night while fishing aboard / beside the boat
//       sight   pirate arrows on the HUD reach this far (m)
//     the swivel gun's tier IS the gun level (naval GUN_LEVELS 1..3); a ship with a built-in battery cannot fit it
//
//   const f = new Fitting( { hooks: { swivel: { get: () => tier, set: ( t ) => {} } } } );   hooks keep a tier elsewhere
//   f.setBoat( id )            the current hull; a hull seen for the first time takes over the last hull's fit
//   f.slots()                  [ { index, kind, module } ] of the current hull
//   f.tierOf( id ) / f.fitted( id ) -> slot index or -1 / f.isFitted( id )
//   f.buy( id, state ) -> { ok, tier, price, reason }      state: { free, spend( n ) } (GameState); fits it when a slot is free
//   f.fit( id, slot? ) / f.remove( id ) -> bool              slot: an index, or none for the first free slot of the kind
//   f.stats() -> { hpMul, taken, speed, dmg, range, reload, cargo, holdKg, nightBite, sight, gun }   from the current fit
//   f.rows( state ) -> [ { id, label, desc, price, owned, fitted, canBuy, canFit, tier, maxTier, next, slot, kind, reason } ]
//   f.toJSON() / f.fromJSON( d )
//   moduleMounts( id, tier, boatId, ctx ) -> [ { mesh, x, y, z, yaw, roll, scale } ]   where the meshes sit (boat frame)

import { BOATS, slotsOf } from '../../game/Boats.js';

export const SLOT_KINDS = [ 'hull', 'arms', 'drive', 'hold', 'deck' ];
export const SLOT_LABELS = { hull: 'Hull', arms: 'Arms', drive: 'Drive', hold: 'Hold', deck: 'Deck' };

export const MODULES = {
	plating: {
		label: 'Armour plating', slot: 'hull', mesh: 'SM_Module_HullReinforcement',
		desc: 'Iron-strapped plates along the waterline: more hull points, less damage from every ball.',
		tiers: [
			{ name: 'Oak sheathing', price: 1200, hpMul: 1.25, taken: 0.9, speed: 0.99 },
			{ name: 'Iron plating', price: 3400, hpMul: 1.5, taken: 0.8, speed: 0.97 },
		],
	},
	swivel: {
		label: 'Swivel gun', slot: 'arms', mesh: 'SM_Module_Cannon',
		desc: 'A gun on the rail that swings to either side. Fire it from the helm with the port and starboard guns.',
		tiers: [
			{ name: 'Swivel gun', price: 600, gun: 1 },
			{ name: 'Bronze swivel gun', price: 1200, gun: 2 },
			{ name: 'Twin swivel guns', price: 2400, gun: 3 },
		],
	},
	heavyGuns: {
		label: 'Heavier guns', slot: 'arms', mesh: 'SM_Module_Cannon',
		desc: 'Heavier shot and longer barrels for the gun or battery you carry: more damage, more reach.',
		tiers: [
			{ name: 'Heavy shot', price: 1800, dmg: 1.25, range: 1.15 },
			{ name: 'Long guns', price: 4200, dmg: 1.45, range: 1.3 },
		],
	},
	quickReload: {
		label: 'Quick reload', slot: 'arms', mesh: 'SM_Module_CargoCrate',
		desc: 'Ready-use shot lockers and a drilled crew: the guns are loaded again sooner.',
		tiers: [
			{ name: 'Shot lockers', price: 1500, reload: 0.82 },
			{ name: 'Drilled gun crew', price: 3600, reload: 0.68 },
		],
	},
	rigging: {
		label: 'Reinforced rigging', slot: 'drive', mesh: 'SM_Module_SpareRigging',
		desc: 'More way through the water: better oars, a tuned engine or stronger rigging, whatever drives the hull.',
		tiers: [
			{ name: 'Tuned', price: 1400, speed: 1.06 },
			{ name: 'Racing', price: 3800, speed: 1.12 },
		],
	},
	extraHold: {
		label: 'Extra hold', slot: 'hold', mesh: 'SM_Module_CargoCrate',
		desc: 'Lashed deck crates and a deeper hold: more crates of trade goods.',
		tiers: [
			{ name: 'Deck crates', price: 700, cargo: 1.25 },
			{ name: 'Extended hold', price: 2200, cargo: 1.6 },
		],
	},
	fishWell: {
		label: 'Fish well', slot: 'hold', mesh: 'SM_Module_CrewBerth',
		desc: 'A flooded, covered well that keeps the catch alive: more kilograms of fish aboard.',
		tiers: [
			{ name: 'Fish well', price: 900, holdKg: 1.4 },
			{ name: 'Fish well and rod rack', price: 2400, holdKg: 1.8 },
		],
	},
	lantern: {
		label: 'Lantern rig', slot: 'deck', mesh: 'SM_Module_Lantern',
		desc: 'A lantern hung over the water draws fish at night: bites come faster after dark when you fish from the boat.',
		tiers: [
			{ name: 'Lantern rig', price: 650, nightBite: 1.25 },
			{ name: 'Bright lantern rig', price: 1600, nightBite: 1.45 },
		],
	},
	navKit: {
		label: 'Spyglass and charts', slot: 'deck', mesh: 'SM_Module_NavigationKit',
		desc: 'A brass spyglass and the pirates\' lanes on a chart: pirates show on the HUD from much farther.',
		tiers: [
			{ name: 'Spyglass and charts', price: 1100, sight: 800 },
		],
	},
};

export const MODULE_IDS = Object.keys( MODULES );

const ARROW_RANGE = 400; // Hud.js ARROW_RANGE: the reach without a spyglass

// the drive module's names on this hull by tier: oars, paddles, an engine or rigging
const DRIVE_NAMES = {
	ship: [ 'Reinforced rigging', 'Racing rigging' ],
	row: [ 'Light oars', 'Racing oars' ],
	paddle: [ 'Light paddles', 'Racing paddles' ],
	engine: [ 'Tuned engine', 'Racing engine' ],
};

function driveNames( boatId ) {

	const b = BOATS[ boatId ];
	if ( ! b ) return DRIVE_NAMES.ship;
	if ( b.kind === 'ship' ) return DRIVE_NAMES.ship;
	return DRIVE_NAMES[ b.drive ] || DRIVE_NAMES.engine;

}

export function driveLabel( boatId ) {

	return driveNames( boatId )[ 0 ];

}

// the module's name on a hull: tier 0 is the module itself, else the tier's name
export function moduleLabel( id, boatId, tier = 0 ) {

	const m = MODULES[ id ];
	if ( ! m ) return id;
	if ( id === 'rigging' ) return driveNames( boatId )[ Math.max( 0, Math.min( tier, 2 ) - 1 ) ];
	return tier > 0 ? m.tiers[ Math.min( tier, m.tiers.length ) - 1 ].name : m.label;

}

// what one tier does, in a few words for the yard
export function effectText( e ) {

	if ( ! e ) return '';
	const pc = ( v ) => `${ v > 1 ? '+' : '-' }${ Math.round( Math.abs( v - 1 ) * 100 ) }%`;
	const out = [];
	if ( e.gun ) out.push( `gun level ${ e.gun }` );
	if ( e.hpMul ) out.push( `${ pc( e.hpMul ) } hull points` );
	if ( e.taken ) out.push( `${ Math.round( ( 1 - e.taken ) * 100 ) }% less damage` );
	if ( e.speed && e.speed > 1 ) out.push( `${ pc( e.speed ) } speed` );
	if ( e.speed && e.speed < 1 ) out.push( `${ pc( e.speed ) } speed` );
	if ( e.dmg ) out.push( `${ pc( e.dmg ) } gun damage` );
	if ( e.range ) out.push( `${ pc( e.range ) } reach` );
	if ( e.reload ) out.push( `reloads ${ Math.round( ( 1 - e.reload ) * 100 ) }% faster` );
	if ( e.cargo ) out.push( `${ pc( e.cargo ) } cargo crates` );
	if ( e.holdKg ) out.push( `${ pc( e.holdKg ) } fish hold` );
	if ( e.nightBite ) out.push( `${ pc( e.nightBite ) } night bites` );
	if ( e.sight ) out.push( `pirates seen at ${ e.sight } m` );
	return out.join( ', ' );

}

// Can module `id` go on hull `boatId`? null when it can, else the reason (a short sentence for the yard).
export function moduleBlock( id, boatId ) {

	const m = MODULES[ id ];
	if ( ! m ) return 'Unknown module.';
	const b = BOATS[ boatId ];
	if ( ! b ) return 'You need a boat first.';
	if ( ! slotsOf( boatId ).includes( m.slot ) ) return `The ${ b.name } has no ${ SLOT_LABELS[ m.slot ].toLowerCase() } slot.`;
	if ( id === 'swivel' && b.broadside ) return `The ${ b.name } carries her own battery.`;
	return null;

}

const NEUTRAL = () => ( { hpMul: 1, taken: 1, speed: 1, dmg: 1, range: 1, reload: 1, cargo: 1, holdKg: 1, nightBite: 1, sight: ARROW_RANGE, gun: 0 } );

export class Fitting {

	constructor( { hooks = {} } = {} ) {

		this.hooks = hooks; // id -> { get() -> tier, set( tier ) }: a tier kept somewhere else (the swivel gun's level)
		this.tiers = {}; // id -> owned tier (1..)
		this.fits = {}; // boat id -> [ module id | null ] aligned with the hull's slots
		this.boat = null;
		this.version = 0; // bumped on every change (visuals and stats rebuild on it)

	}

	tierOf( id ) {

		const h = this.hooks[ id ];
		if ( h && h.get ) return Math.max( 0, Math.round( h.get() ) || 0 );
		return this.tiers[ id ] | 0;

	}

	setTier( id, t ) {

		const m = MODULES[ id ];
		if ( ! m ) return;
		t = Math.max( 0, Math.min( m.tiers.length, Math.round( t ) || 0 ) );
		const h = this.hooks[ id ];
		if ( h && h.set ) h.set( t );
		else if ( t > 0 ) this.tiers[ id ] = t;
		else delete this.tiers[ id ];
		this.version ++;

	}

	_fit( boatId = this.boat ) {

		if ( ! boatId || ! BOATS[ boatId ] ) return [];
		const kinds = slotsOf( boatId );
		let f = this.fits[ boatId ];
		if ( ! f || f.length !== kinds.length ) {

			const old = f || [];
			f = kinds.map( ( k, i ) => ( old[ i ] && MODULES[ old[ i ] ] && MODULES[ old[ i ] ].slot === k ? old[ i ] : null ) );
			this.fits[ boatId ] = f;

		}

		return f;

	}

	// The current hull. A hull without a remembered fit takes the modules of the previous one that it has slots for.
	setBoat( id ) {

		id = id && BOATS[ id ] ? id : null;
		if ( id === this.boat ) return false;
		const prev = this.boat ? this._fit( this.boat ).slice() : [];
		this.boat = id;
		if ( id ) {

			const known = !! this.fits[ id ];
			const f = this._fit( id );
			if ( ! known ) for ( const m of prev ) if ( m && this.tierOf( m ) > 0 && ! moduleBlock( m, id ) ) this._place( m, f );
			this._sanitise( id );

		}

		this.version ++;
		return true;

	}

	// drop what this hull cannot carry (or the player no longer owns) from its fit
	_sanitise( boatId ) {

		const f = this._fit( boatId );
		const seen = new Set();
		for ( let i = 0; i < f.length; i ++ ) {

			const m = f[ i ];
			if ( ! m ) continue;
			if ( seen.has( m ) || this.tierOf( m ) <= 0 || moduleBlock( m, boatId ) ) f[ i ] = null;
			else seen.add( m );

		}

	}

	// the first free slot of the module's kind; -1 when they are all taken
	_place( id, f, kinds = slotsOf( this.boat ) ) {

		const kind = MODULES[ id ].slot;
		for ( let i = 0; i < f.length; i ++ ) {

			if ( kinds[ i ] === kind && ! f[ i ] ) {

				f[ i ] = id;
				return i;

			}

		}

		return - 1;

	}

	slots() {

		const kinds = slotsOf( this.boat ), f = this._fit();
		return kinds.map( ( kind, index ) => ( { index, kind, module: f[ index ] || null } ) );

	}

	fitted( id ) {

		return this._fit().indexOf( id );

	}

	isFitted( id ) {

		return this.fitted( id ) >= 0 && this.tierOf( id ) > 0;

	}

	// why `id` cannot be fitted now (null: it can)
	fitBlock( id, slot = null ) {

		if ( ! MODULES[ id ] ) return 'Unknown module.';
		if ( this.tierOf( id ) <= 0 ) return 'Buy it first.';
		const why = moduleBlock( id, this.boat );
		if ( why ) return why;
		if ( slot !== null && slot !== undefined ) {

			const kinds = slotsOf( this.boat );
			if ( ! ( slot >= 0 && slot < kinds.length ) ) return 'No such slot.';
			if ( kinds[ slot ] !== MODULES[ id ].slot ) return `That is a ${ SLOT_LABELS[ kinds[ slot ] ].toLowerCase() } slot.`;

		} else if ( this.fitted( id ) < 0 && ! this._fit().some( ( m, i ) => ! m && slotsOf( this.boat )[ i ] === MODULES[ id ].slot ) ) {

			return `Every ${ SLOT_LABELS[ MODULES[ id ].slot ].toLowerCase() } slot is taken: remove a module first.`;

		}

		return null;

	}

	// fit an owned module: into `slot` (an index; whatever was there goes back to the store) or the first free slot of its kind
	fit( id, slot = null ) {

		if ( this.fitBlock( id, slot ) ) return false;
		const f = this._fit();
		const at = f.indexOf( id );
		if ( slot === null || slot === undefined ) {

			if ( at >= 0 ) return true;
			this._place( id, f );

		} else {

			if ( at === slot ) return true;
			if ( at >= 0 ) f[ at ] = null;
			f[ slot ] = id;

		}

		this.version ++;
		return true;

	}

	// unship a module (it stays owned, in the yard's store)
	remove( id ) {

		const f = this._fit();
		const at = f.indexOf( id );
		if ( at < 0 ) return false;
		f[ at ] = null;
		this.version ++;
		return true;

	}

	price( id, state = null ) {

		const m = MODULES[ id ];
		if ( ! m ) return null;
		const t = this.tierOf( id );
		if ( t >= m.tiers.length ) return null;
		return state && state.free ? 0 : m.tiers[ t ].price;

	}

	buyBlock( id, state = null ) {

		const m = MODULES[ id ];
		if ( ! m ) return 'Unknown module.';
		const why = moduleBlock( id, this.boat );
		if ( why ) return why;
		const price = this.price( id, state );
		if ( price === null ) return 'Fully upgraded.';
		if ( price > 0 && state && Number.isFinite( state.money ) && state.money < price ) return 'Not enough money.';
		return null;

	}

	// buy the next tier of `id` (state: GameState: free / spend); a new module goes straight into a free slot of its kind
	buy( id, state = null ) {

		const why = this.buyBlock( id, state );
		if ( why ) return { ok: false, reason: why };
		const price = this.price( id, state );
		if ( price > 0 && state && state.spend && ! state.spend( price ) ) return { ok: false, reason: 'Not enough money.' };
		const tier = this.tierOf( id ) + 1;
		this.setTier( id, tier );
		if ( this.fitted( id ) < 0 ) this.fit( id );
		this.version ++;
		return { ok: true, tier, price, fitted: this.fitted( id ) >= 0 };

	}

	// the effects of the modules fitted on the current hull
	stats() {

		const s = NEUTRAL();
		for ( const id of this._fit() ) {

			if ( ! id ) continue;
			const t = this.tierOf( id );
			if ( t <= 0 || moduleBlock( id, this.boat ) ) continue;
			const e = MODULES[ id ].tiers[ Math.min( t, MODULES[ id ].tiers.length ) - 1 ];
			for ( const k of [ 'hpMul', 'taken', 'speed', 'dmg', 'range', 'reload', 'cargo', 'holdKg', 'nightBite' ] ) if ( Number.isFinite( e[ k ] ) ) s[ k ] *= e[ k ];
			if ( e.sight ) s.sight = Math.max( s.sight, e.sight );
			if ( e.gun ) s.gun = Math.max( s.gun, e.gun );

		}

		return s;

	}

	// one row per module for the yard (Captain Roid's panel)
	rows( state = null ) {

		return MODULE_IDS.map( ( id ) => {

			const m = MODULES[ id ], tier = this.tierOf( id ), max = m.tiers.length;
			const block = moduleBlock( id, this.boat );
			const nextTier = tier < max ? m.tiers[ tier ] : null;
			const price = this.price( id, state );
			const buyWhy = this.buyBlock( id, state );
			const slot = this.fitted( id );
			const fitWhy = tier > 0 ? this.fitBlock( id ) : 'Buy it first.';
			return {
				id, kind: m.slot, tier, maxTier: max,
				label: moduleLabel( id, this.boat, tier ),
				next: nextTier ? ( id === 'rigging' ? moduleLabel( id, this.boat, tier + 1 ) : nextTier.name ) : null,
				desc: `${ m.desc } ${ nextTier ? 'Next: ' + effectText( nextTier ) : 'Fitted: ' + effectText( m.tiers[ max - 1 ] ) }.`.replace( /\.\.$/, '.' ),
				effect: effectText( tier > 0 ? m.tiers[ tier - 1 ] : nextTier ),
				price, owned: tier > 0, fitted: tier > 0 && slot >= 0, slot,
				canBuy: ! buyWhy, canFit: tier > 0 && slot < 0 && ! fitWhy, blocked: !! block,
				reason: block || ( slot >= 0 ? null : buyWhy && tier < max ? buyWhy : fitWhy ),
			};

		} );

	}

	toJSON() {

		const fits = {};
		for ( const [ b, f ] of Object.entries( this.fits ) ) if ( BOATS[ b ] ) fits[ b ] = f.slice(); // empty fits too: a removed module stays off
		return { tiers: { ...this.tiers }, fits };

	}

	fromJSON( d ) {

		this.tiers = {};
		this.fits = {};
		if ( d && typeof d === 'object' ) {

			const t = d.tiers && typeof d.tiers === 'object' ? d.tiers : {};
			for ( const id of MODULE_IDS ) {

				if ( this.hooks[ id ] ) continue; // kept by its owner (the swivel's level in the gun record)
				const v = Math.round( + t[ id ] );
				if ( v > 0 ) this.tiers[ id ] = Math.min( v, MODULES[ id ].tiers.length );

			}

			const fits = d.fits && typeof d.fits === 'object' ? d.fits : {};
			for ( const [ b, f ] of Object.entries( fits ) ) {

				if ( ! BOATS[ b ] || ! Array.isArray( f ) ) continue;
				const kinds = slotsOf( b );
				this.fits[ b ] = kinds.map( ( k, i ) => ( typeof f[ i ] === 'string' && MODULES[ f[ i ] ] && MODULES[ f[ i ] ].slot === k ? f[ i ] : null ) );

			}

		}

		if ( this.boat ) this._sanitise( this.boat );
		this.version ++;

	}

	reset() {

		this.tiers = {};
		this.fits = {};
		for ( const [ id, h ] of Object.entries( this.hooks ) ) if ( h.set && MODULES[ id ] ) h.set( 0 );
		this.version ++;

	}

}

// ------------------------------------------------------------------------------------------------ where the meshes sit
// Boat frame (+Z forward, +X port, y = 0 the waterline). The kit's meshes sit on their base (y 0) and point +Z (the
// cannon's barrel, the lantern's arm). roll turns about the forward axis (the armour plates stand on the hull side).
// ctx: { heavy } the heavier guns are fitted (the swivel barrels grow).

const LOBSTER_DECK = { crate: [ [ 0.65, - 2.9 ], [ 0.65, - 2.05 ] ], well: [ - 0.65, - 2.45 ], rack: [ - 1.2, - 1.4 ], bow: 3.55, bowY: 1.0, stern: - 3.95 };

export function moduleMounts( id, tier, boatId, ctx = {} ) {

	const b = BOATS[ boatId ], m = MODULES[ id ];
	if ( ! b || ! m || ! ( tier > 0 ) ) return [];
	const ship = b.kind === 'ship', lob = boatId === 'lobster';
	const L = b.length, B = b.beam, D = b.deckY;
	const rail = ship ? D + 0.95 : b.freeboard;
	const k = ship ? 1.25 : L > 6 ? 0.85 : 0.6; // the kit is sized for a ship's deck; the small boats get it scaled down
	const half = ( z ) => B / 2 * ( 1 - 0.5 * ( 2 * z / L ) ** 2 ); // the beam narrows toward bow and stern
	const out = [];
	const put = ( mesh, x, y, z, yaw = 0, roll = 0, scale = k ) => out.push( { mesh, x, y, z, yaw, roll, scale } );
	switch ( id ) {

		case 'plating': {

			const zs = ship ? ( tier >= 2 ? [ - 0.3, - 0.1, 0.1, 0.3 ] : [ - 0.2, 0, 0.2 ] ) : ( tier >= 2 ? [ - 0.22, 0, 0.22 ] : [ - 0.12, 0.12 ] );
			const y = ship ? D * 0.5 : rail * 0.5;
			// roll -PI/2 turns the plate's face (+y) to +X (port), +PI/2 to starboard
			for ( const f of zs ) for ( const sg of [ 1, - 1 ] ) put( m.mesh, sg * ( half( f * L ) + 0.015 ), y, f * L, 0, - sg * Math.PI / 2, k * 1.1 );
			break;

		}

		case 'swivel': {

			// the gun plan fires from 12 % of the length forward of amidships, one mount a side
			const s = k * 0.9 * ( ctx.heavy ? 1.25 : 1 ) * ( tier >= 3 ? 1.08 : 1 );
			for ( const sg of [ 1, - 1 ] ) put( m.mesh, sg * ( half( 0.12 * L ) - 0.12 * s ), rail - 0.04, 0.12 * L, sg * Math.PI / 2, 0, s );
			break;

		}

		case 'heavyGuns': {

			// a battery ship stows the heavier shot by the guns; a swivel gun just grows (see 'swivel')
			if ( b.broadside ) for ( const sg of [ 1, - 1 ] ) put( 'SM_Module_CargoCrate', sg * ( half( 0 ) - 1.0 ), D, 0.05 * L, 0, 0, 0.55 );
			break;

		}

		case 'quickReload': {

			if ( ship ) put( m.mesh, 0, D, - 0.04 * L, 0, 0, 0.6 * ( tier >= 2 ? 1.15 : 1 ) );
			else if ( lob ) put( m.mesh, - 0.6, D, - 0.8, 0, 0, 0.45 );
			else put( m.mesh, 0, D, 0.12 * L - 0.55, 0, 0, 0.4 );
			break;

		}

		case 'rigging': {

			if ( ship ) {

				put( 'SM_Module_SpareRigging', half( 0.15 * L ) - 0.55, D, 0.15 * L, 0, 0, 1.4 );
				if ( tier >= 2 ) put( 'SM_Module_SpareRigging', - ( half( 0.15 * L ) - 0.55 ), D, 0.15 * L, 0, 0, 1.4 );

			} else if ( b.drive === 'row' || b.drive === 'paddle' ) {

				put( 'SM_Module_OarRack', half( 0 ) * 0.55, D + 0.02, 0.05 * L, 0, 0, 0.62 );
				if ( tier >= 2 ) put( 'SM_Module_OarRack', - half( 0 ) * 0.55, D + 0.02, 0.05 * L, 0, 0, 0.62 );

			} else {

				// an auxiliary outboard on the transom (the lobster boat's own screw stays where it is)
				const z = lob ? LOBSTER_DECK.stern : - L / 2 + 0.05;
				put( 'SM_Module_Outboard', lob ? 0.75 : 0, rail - 0.45 * k, z, 0, 0, k * 1.2 * ( tier >= 2 ? 1.15 : 1 ) );

			}

			break;

		}

		case 'extraHold': {

			if ( ship ) {

				put( m.mesh, 1.3, D, - 0.15 * L, 0, 0, 1 );
				if ( tier >= 2 ) {

					put( m.mesh, - 1.3, D, - 0.15 * L, 0, 0, 1 );
					put( m.mesh, 1.3, D + 0.44, - 0.15 * L, 0.3, 0, 0.9 );

				}

			} else if ( lob ) {

				put( m.mesh, LOBSTER_DECK.crate[ 0 ][ 0 ], D, LOBSTER_DECK.crate[ 0 ][ 1 ], 0, 0, 0.85 );
				if ( tier >= 2 ) put( m.mesh, LOBSTER_DECK.crate[ 1 ][ 0 ], D, LOBSTER_DECK.crate[ 1 ][ 1 ], 0.2, 0, 0.85 );

			} else {

				put( m.mesh, 0, D, 0.3 * L, 0, 0, k );
				if ( tier >= 2 ) put( m.mesh, 0, D + 0.44 * k, 0.3 * L, 0.25, 0, k * 0.85 );

			}

			break;

		}

		case 'fishWell': {

			if ( ship ) {

				put( m.mesh, 0, D, - 0.3 * L, 0, 0, 1.2 );
				if ( tier >= 2 ) put( 'SM_Module_RodRack', half( - 0.3 * L ) - 0.45, D, - 0.3 * L, 0, 0, 1.1 );

			} else if ( lob ) {

				put( m.mesh, LOBSTER_DECK.well[ 0 ], D, LOBSTER_DECK.well[ 1 ], 0, 0, 0.8 );
				if ( tier >= 2 ) put( 'SM_Module_RodRack', LOBSTER_DECK.rack[ 0 ], D, LOBSTER_DECK.rack[ 1 ], 0, 0, 0.9 );

			} else {

				put( m.mesh, 0, D, - 0.33 * L, 0, 0, k * 0.9 );
				if ( tier >= 2 ) put( 'SM_Module_RodRack', half( - 0.3 * L ) - 0.2, D, - 0.3 * L, 0, 0, k );

			}

			break;

		}

		case 'lantern': {

			const s = ( ship ? 1.3 : k * 1.1 ) * ( tier >= 2 ? 1.12 : 1 );
			if ( ship ) put( m.mesh, 0, D, L / 2 - 2.0, 0, 0, s );
			else if ( lob ) put( m.mesh, 0, LOBSTER_DECK.bowY, LOBSTER_DECK.bow, 0, 0, s );
			else put( m.mesh, 0, Math.max( D, rail - 0.3 ), L / 2 - 0.35, 0, 0, s );
			if ( tier >= 2 && ship ) put( m.mesh, 0, b.helmDeckY ?? D, - L / 2 + 1.2, Math.PI, 0, s ); // and one over the stern
			break;

		}

		case 'navKit': {

			const h = b.helm || { x: 0, z: 0 };
			put( m.mesh, h.x + ( ship ? 0.8 : 0.45 ), ship ? ( b.helmDeckY ?? D ) : D, h.z + ( ship ? 0.6 : 0.35 ), 0, 0, ship ? 1.2 : k );
			break;

		}

		default:
			break;

	}

	return out;

}

// every mesh the fit shows: [ { id, tier, mesh, x, y, z, yaw, roll, scale } ]
export function fitMounts( fitting ) {

	const boat = fitting.boat, out = [];
	if ( ! boat ) return out;
	const heavy = fitting.isFitted( 'heavyGuns' );
	for ( const s of fitting.slots() ) {

		if ( ! s.module ) continue;
		const t = fitting.tierOf( s.module );
		if ( t <= 0 || moduleBlock( s.module, boat ) ) continue;
		for ( const m of moduleMounts( s.module, t, boat, { heavy } ) ) out.push( { id: s.module, tier: t, ...m } );

	}

	return out;

}

// the GLB of a kit mesh (public/models/modules)
export const moduleMeshUrl = ( mesh, base = '/' ) => `${ base }models/modules/${ mesh }.glb`;
