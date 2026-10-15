import { GOODS, PORTS, PORT_IDS, dockOf, syncPorts } from '../trade/goods.js';
import { Rng, clamp, num } from '../trade/market.js';
import { CustomsPanel } from './panel.js';

// Harbour customs and guard justice (docs/UNREAL_PARITY.md E8, the harbour side; the smuggler is trade/Smuggler.js).
//
// Sailing into a port (the player within ARRIVE metres of its dock while at the helm, on deck or in a seat, coming
// from outside LEAVE metres) may bring the customs launch alongside. With nothing illegal aboard it is a toast. With
// contraband for that port aboard a small window offers three choices, decided within CUSTOMS.decide seconds (else
// it is a submission):
//   submit   they search: crates beyond the smuggler's hidden compartment are found, the compartment itself only
//            sometimes; what is found is seized and fined (half its value, plus a fee). A fine you cannot pay
//            becomes a debt at that port (trade.credit.debt).
//   bribe    a third of the cargo's value; taken more often at night, by a merchant of standing, at a port that
//            does not know you; refused: the search goes ahead and the fine is half again as big.
//   dump     everything illegal goes over the side: no fine, no cargo.
// Forged papers (trade.smuggler.papers) wave you through without asking. Avoidable by design: arrive at night (half
// the chance), carry contraband only into ports where it is legal, keep your standing up, hide it, dump it.
//
// Justice: each seizure or refused bribe is an offence at that port (they fade after three days); three offences and
// the harbourmaster bans you from the market there for a day (trade asks banned( port )). Inspections at ports where
// you have offences come more often; so they do when the pirates' notoriety is high (features.get( 'pirates' ).notoriety()).
//
//   const customs = features.add( 'customs', customsModule );   // after 'trade'
//   customs.update( dt ) / customs.inspect( port, { force } ) / customs.resolve( 'submit' | 'bribe' | 'dump' )
//   customs.pending                     the inspection waiting for an answer (null when none)
//   customs.banned( port ) -> hours of ban left (0: none) / customs.offences( port )
//   customs.chance( port ) -> probability of an inspection on arrival now
//   isOpen / close() (Escape: a submission) / toJSON / fromJSON / reset / dispose
//
// Events: customsInspected { port, found, fine, seized: [ { good, qty } ], bribed, dumped, papers }, contrabandSeized
// { port, goods: [ { good, qty } ], value, fine }, customsBribed { port, amount, accepted }, contrabandDumped { port,
// goods }, harbourBan { port, hours }. Sandbox: no inspections (free play).

export const CUSTOMS = {
	arrive: 85, leave: 130, // metres from a port's dock
	strictness: { home: 0.5, pons: 0.32, gull: 0.22, key: 0.28 }, // chance an arrival is inspected (others: 0.3)
	night: 0.5, // factor after dark
	cooldown: 6, // hours between inspections at one port
	findExcess: 0.92, // chance crates beyond the compartment are found
	findHidden: 0.2, // chance the compartment is found
	fineFrac: 0.5, fee: 25,
	bribeFrac: 0.33, bribeMin: 40,
	offenceFade: 72, // hours an offence lasts
	banAt: 3, banHours: 24,
	decide: 25, // real seconds to answer before it counts as a submission
};

export class Customs {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = { toasts: true, ...opts };
		this.panel = new CustomsPanel( this );
		this.reset();

	}

	reset() {

		this.rng = new Rng( ( this.opts.seed ?? 4049 ) >>> 0 );
		this.offenceLog = {}; // port -> [ sim hour of each offence ]
		this.bans = {}; // port -> sim hour the ban ends
		this.last = {}; // port -> sim hour of the last inspection
		this.inside = {}; // port -> the player is within the arrival ring
		this._primed = false; // the first look only notes where the player is (a load at the berth is no arrival)
		this.pending = null;
		this._wait = 0;
		if ( this.panel ) this.panel.close();

	}

	get trade() {

		return this.features && this.features.get ? this.features.get( 'trade' ) : null;

	}

	get state() {

		return this.features ? this.features.state : null;

	}

	get now() {

		const t = this.trade;
		return t ? t.sim.abs : 0;

	}

	get decide() {

		return CUSTOMS.decide;

	}

	get isOpen() {

		return !! this.pending && this.panel.isOpen;

	}

	_emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	_toast( text ) {

		if ( ! this.opts.toasts ) return;
		try {

			const ui = this.app && this.app.ui && this.app.ui.ui;
			if ( ui && ui.toast ) ui.toast( text, 4800 );

		} catch ( e ) { /* optional */ }

	}

	offences( port ) {

		const now = this.now;
		const list = ( this.offenceLog[ port ] || [] ).filter( ( t ) => now - t < CUSTOMS.offenceFade );
		this.offenceLog[ port ] = list;
		return list.length;

	}

	banned( port ) {

		const end = this.bans[ port ];
		return end != null && end > this.now ? Math.round( ( end - this.now ) * 10 ) / 10 : 0;

	}

	_notoriety() {

		const p = this.features && this.features.get ? this.features.get( 'pirates' ) : null;
		let n = 0;
		try { n = p && p.notoriety ? p.notoriety() : 0; } catch ( e ) { n = 0; }
		return typeof n === 'number' && Number.isFinite( n ) ? clamp( n, 0, 100 ) : 0;

	}

	chance( port ) {

		const t = this.trade;
		const base = CUSTOMS.strictness[ port ] ?? 0.3;
		const night = t && t.smuggler && t.smuggler.isNight() ? CUSTOMS.night : 1;
		const standing = t && t.credit ? t.credit.standing : 10;
		return clamp( base * night * ( 1 - standing / 200 ) * ( 1 + this.offences( port ) * 0.3 ) * ( 1 + this._notoriety() / 100 ), 0, 0.95 );

	}

	update( dt ) {

		syncPorts();
		if ( this.pending ) {

			this._wait += dt;
			if ( this._wait > CUSTOMS.decide ) this.resolve( 'submit' );
			return;

		}

		const s = this.state;
		if ( s && s.free ) return;
		const p = this.app && this.app.player;
		if ( ! p || ! p.position ) return;
		const bySea = p.mode === 'boat' || p.mode === 'deck' || p.mode === 'seat';
		for ( const id of PORT_IDS ) {

			const d = dockOf( id );
			if ( ! d ) continue;
			const r = Math.hypot( p.position.x - d.x, p.position.z - d.z );
			if ( r > CUSTOMS.leave ) this.inside[ id ] = false;
			else if ( r < CUSTOMS.arrive && ! this.inside[ id ] ) {

				this.inside[ id ] = true;
				if ( bySea && this._primed ) this.arrive( id );

			} else if ( ! this._primed && r <= CUSTOMS.leave ) this.inside[ id ] = true;

		}

		this._primed = true;

	}

	// the player sailed into a port: maybe an inspection
	arrive( port ) {

		const last = this.last[ port ];
		if ( last != null && this.now - last < CUSTOMS.cooldown ) return null;
		if ( this.rng.next() >= this.chance( port ) ) return null;
		return this.inspect( port );

	}

	inspect( port, { force = false } = {} ) {

		const t = this.trade;
		if ( ! t || ! PORTS[ port ] || this.pending ) return null;
		const s = this.state;
		if ( s && s.free && ! force ) return null;
		this.last[ port ] = this.now;
		const hot = t.contraband( port );
		if ( ! hot.length ) {

			this._emit( 'customsInspected', { port, found: false, fine: 0, seized: [] } );
			this._toast( `Customs boarded you off ${ PORTS[ port ].name } and found nothing. Fair winds.` );
			return { port, clean: true };

		}

		if ( t.smuggler && t.smuggler.usePapers() ) {

			this._emit( 'customsInspected', { port, found: false, fine: 0, seized: [], papers: true } );
			this._toast( `Customs at ${ PORTS[ port ].name } read your papers and waved you through.` );
			return { port, papers: true };

		}

		const value = hot.reduce( ( a, h ) => a + h.value, 0 );
		this.pending = { port, goods: hot, value, bribe: Math.max( CUSTOMS.bribeMin, Math.round( value * CUSTOMS.bribeFrac ) ), at: this.now };
		this._wait = 0;
		this.panel.open( this.pending );
		return { port, pending: true };

	}

	_offence( port ) {

		( this.offenceLog[ port ] || ( this.offenceLog[ port ] = [] ) ).push( this.now );
		if ( this.offences( port ) >= CUSTOMS.banAt && ! this.banned( port ) ) {

			this.bans[ port ] = this.now + CUSTOMS.banHours;
			this._emit( 'harbourBan', { port, hours: CUSTOMS.banHours } );
			this._toast( `The ${ PORTS[ port ].name } harbourmaster bans you from the market for a day.` );

		}

	}

	_bribeChance( port ) {

		const t = this.trade;
		const night = t && t.smuggler && t.smuggler.isNight() ? 0.1 : 0;
		const standing = t && t.credit ? t.credit.standing : 10;
		return clamp( 0.5 + night + standing / 250 - this.offences( port ) * 0.12, 0.05, 0.9 );

	}

	// the search: returns the goods found [ { good, qty } ] (the compartment hides the first crates)
	_search( goods ) {

		const t = this.trade;
		const hides = t && t.smuggler ? t.smuggler.hidden() : 0;
		const total = goods.reduce( ( a, h ) => a + h.crates, 0 );
		const hiddenFound = hides > 0 && this.rng.next() < CUSTOMS.findHidden;
		const excessFound = total > hides && this.rng.next() < CUSTOMS.findExcess;
		if ( hiddenFound || hides === 0 ) return goods.map( ( h ) => ( { good: h.good, qty: h.qty } ) );
		if ( ! excessFound ) return [];
		// only what did not fit the compartment: the bulkiest-last crates beyond `hides`
		let room = hides;
		const found = [];
		for ( const h of goods ) {

			const per = GOODS[ h.good ].crates;
			const hidden = Math.min( h.qty, Math.floor( room / per ) );
			room -= hidden * per;
			if ( h.qty - hidden > 0 ) found.push( { good: h.good, qty: h.qty - hidden } );

		}

		return found;

	}

	_seize( port, found, fineMul = 1 ) {

		const t = this.trade;
		let value = 0;
		for ( const f of found ) {

			const got = t.takeCargo( f.good, f.qty );
			f.qty = got.qty;
			value += got.qty * GOODS[ f.good ].base;

		}

		const fine = Math.round( ( value * CUSTOMS.fineFrac + CUSTOMS.fee ) * fineMul );
		const s = this.state;
		let paid = 0;
		if ( s && ! s.free ) {

			const purse = Math.max( 0, Math.floor( num( s.money ) ) );
			paid = Math.min( purse, fine );
			if ( paid > 0 && s.spend ) s.spend( paid );
			if ( fine - paid > 0 && t.credit ) t.credit.debt( port, fine - paid, 'customs fine' );

		}

		if ( t.credit ) t.credit.adjust( - 8, 'contraband seized' );
		if ( s && s.addRep ) s.addRep( port, - 4 );
		this._offence( port );
		// a burned cargo leaves the port short of it for a while
		if ( found.length && t.sim ) t.sim.forceEvent( 'seizure', { good: found[ 0 ].good, ports: [ port ] } );
		return { value: Math.round( value ), fine, paid };

	}

	resolve( choice = 'submit' ) {

		const p = this.pending;
		if ( ! p ) return null;
		const t = this.trade;
		this.pending = null;
		this.panel.close();
		if ( ! t ) return null;
		const name = PORTS[ p.port ].name;
		// the cargo may have changed while the window was open: search what is aboard now
		const goods = t.contraband( p.port );
		if ( choice === 'dump' ) {

			const out = goods.map( ( h ) => ( { good: h.good, qty: t.takeCargo( h.good, h.qty ).qty } ) );
			this._emit( 'contrabandDumped', { port: p.port, goods: out } );
			this._emit( 'customsInspected', { port: p.port, found: false, fine: 0, seized: [], dumped: true } );
			const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
			const pos = this.app && this.app.player && this.app.player.position;
			try { if ( vfx && vfx.splash && pos ) vfx.splash( pos.x, 0, pos.z, 0.6 ); } catch ( e ) { /* optional */ }
			this._toast( `Over the side it went. The officers found nothing at ${ name }.` );
			return { choice, dumped: out };

		}

		if ( choice === 'bribe' ) {

			const s = this.state;
			const can = ! s || s.free || num( s.money ) >= p.bribe;
			if ( can && this.rng.next() < this._bribeChance( p.port ) ) {

				if ( s && s.spend ) s.spend( p.bribe );
				this._emit( 'customsBribed', { port: p.port, amount: p.bribe, accepted: true } );
				this._emit( 'customsInspected', { port: p.port, found: false, fine: 0, seized: [], bribed: true } );
				this._toast( `The officer pocketed $${ p.bribe } and looked the other way.` );
				return { choice, accepted: true, amount: p.bribe };

			}

			this._emit( 'customsBribed', { port: p.port, amount: p.bribe, accepted: false } );
			this._offence( p.port );
			const found = goods.map( ( h ) => ( { good: h.good, qty: h.qty } ) ); // a refused bribe means a thorough search
			const r = this._seize( p.port, found, 1.5 );
			this._report( p.port, found, r, `The officer refused your money. Seized and fined $${ r.fine } at ${ name }.` );
			return { choice, accepted: false, ...r, seized: found };

		}

		const found = this._search( goods );
		if ( ! found.length ) {

			this._emit( 'customsInspected', { port: p.port, found: false, fine: 0, seized: [] } );
			this._toast( `They searched the hold and missed the compartment. Fair winds from ${ name }.` );
			return { choice, found: false };

		}

		const r = this._seize( p.port, found, 1 );
		this._report( p.port, found, r, `Customs at ${ name } seized ${ found.map( ( f ) => `${ f.qty } ${ GOODS[ f.good ].name.toLowerCase() }` ).join( ', ' ) } and fined you $${ r.fine }${ r.paid < r.fine ? ` ($${ r.fine - r.paid } owed)` : '' }.` );
		return { choice, found: true, ...r, seized: found };

	}

	_report( port, found, r, text ) {

		this._emit( 'contrabandSeized', { port, goods: found.map( ( f ) => ( { ...f } ) ), value: r.value, fine: r.fine } );
		this._emit( 'customsInspected', { port, found: true, fine: r.fine, seized: found.map( ( f ) => ( { ...f } ) ) } );
		const t = this.trade;
		if ( t && t._note ) t._note( text, 'cargo' );
		else this._toast( text );

	}

	// Escape / closePanels: you cannot sail away from the customs launch
	close() {

		if ( this.pending ) this.resolve( 'submit' );

	}

	toJSON() {

		const r2 = ( v ) => Math.round( v * 100 ) / 100;
		const log = {}, bans = {}, last = {};
		for ( const p in this.offenceLog ) if ( this.offenceLog[ p ].length ) log[ p ] = this.offenceLog[ p ].map( r2 );
		for ( const p in this.bans ) bans[ p ] = r2( this.bans[ p ] );
		for ( const p in this.last ) last[ p ] = r2( this.last[ p ] );
		return { rng: this.rng.s, log, bans, last };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		if ( typeof d.rng === 'number' && Number.isFinite( d.rng ) ) this.rng.s = d.rng >>> 0;
		for ( const p in d.log || {} ) if ( PORTS[ p ] && Array.isArray( d.log[ p ] ) ) this.offenceLog[ p ] = d.log[ p ].filter( Number.isFinite ).slice( - 20 );
		for ( const p in d.bans || {} ) if ( PORTS[ p ] && Number.isFinite( d.bans[ p ] ) ) this.bans[ p ] = d.bans[ p ];
		for ( const p in d.last || {} ) if ( PORTS[ p ] && Number.isFinite( d.last[ p ] ) ) this.last[ p ] = d.last[ p ];

	}

	dispose() {

		this.pending = null;
		this.panel.dispose();

	}

}

export function install( app, features, opts = {} ) {

	return new Customs( app, features, opts );

}
