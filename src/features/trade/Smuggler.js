import { GOODS, GOOD_IDS, PORTS, PORT_IDS, worldPort, legalAt } from './goods.js';
import { clamp, num } from './market.js';

// The smuggler contact (docs/UNREAL_PARITY.md E8, the trade side; customs is src/features/customs). After dark
// (20:00 to 05:00) the Mangrove Fox ties up at one port's quiet spot, a different port each night (the markets'
// news carries the rumour). He buys whatever is contraband at that port (sunken relics anywhere) for well over the
// open market: tobacco from the Pons stall fetches a fortune at Home, Gull Rock powder anywhere else. He never sells
// goods (he would only be buying them back), but he fits hidden compartments that customs rarely find and forges
// papers that wave you through one inspection. Every deal builds his trust (better prices).
//
//   smuggler.tonight() -> port | null           where he is now (null by day)
//   smuggler.spot( port ) -> { x, z }           his meeting place at a port (an E interactable, registered by trade)
//   smuggler.here( port )                       he is at that port now
//   smuggler.offers( port ) -> rows             { good, name, held, cond, bid (what he pays for the next unit) }
//   smuggler.sell( port, good, n | 'all' ) -> { ok, qty, total, profit, reason?, message? }
//   smuggler.buyCompartment() / smuggler.buyPapers()
//   smuggler.hidden()                           crates a compartment hides; smuggler.papers; smuggler.usePapers()
//
// Events: smugglerDeal { port, good, qty, total, profit }, smugglerGear { item: 'compartment' | 'papers', level, price }.

export const SMUGGLER = {
	name: 'the Mangrove Fox',
	night: [ 20, 5 ], // from 20:00 to 05:00
	bidMul: 1.15, // over the port's equilibrium price
	depth: 0.5, // his own market is half as deep as the port's
	recover: 10, // hours for his price push to fade
	trustPer: 150, // $ of business per point of trust
	trustMax: 50,
	compartments: [ { level: 0, hides: 0, price: 0 }, { level: 1, hides: 4, price: 700 }, { level: 2, hides: 10, price: 1800, trust: 5 } ],
	papersPrice: 300,
	papersMax: 2,
};

// fixed meeting places where the derived one would land somewhere silly (home: on the sand west of the pier foot)
export const SMUGGLER_SPOTS = { home: { x: 46, z: - 50 } };

const hash = ( n ) => {

	let h = ( n * 2654435761 ) >>> 0;
	h ^= h >>> 15;
	h = Math.imul( h, 0x2c1b3c6d ) >>> 0;
	return ( h ^ ( h >>> 12 ) ) >>> 0;

};

const r2 = ( v ) => Math.round( v * 100 ) / 100;

export class Smuggler {

	constructor( trade ) {

		this.trade = trade;
		this.reset();

	}

	reset() {

		this.trust = 0;
		this.business = 0; // $ dealt, the source of trust
		this.compartment = 0;
		this.papers = 0;
		this.push = {}; // good -> log price push on his bids

	}

	get state() {

		return this.trade.state;

	}

	_emit( name, payload ) {

		const f = this.trade.features;
		if ( f && f.emit ) f.emit( name, payload );

	}

	isNight( hour = this.trade.hour ) {

		return hour >= SMUGGLER.night[ 0 ] || hour < SMUGGLER.night[ 1 ];

	}

	nightIndex() {

		const h = this.trade.hour;
		return h >= SMUGGLER.night[ 0 ] ? this.trade.day : this.trade.day - 1;

	}

	// the port he visits on a night (any night index, so the news can tell of tonight's in the day)
	portFor( night ) {

		const ids = PORT_IDS.filter( ( p ) => PORTS[ p ] );
		return ids.length ? ids[ hash( night + 17 ) % ids.length ] : null;

	}

	tonight() {

		return this.isNight() ? this.portFor( this.nightIndex() ) : null;

	}

	// the port of the coming (or current) night, for the rumour
	rumour() {

		const n = this.isNight() ? this.nightIndex() : this.trade.day;
		return this.portFor( n );

	}

	here( port ) {

		return this.tonight() === port;

	}

	spot( port ) {

		if ( SMUGGLER_SPOTS[ port ] ) return SMUGGLER_SPOTS[ port ];
		const wp = worldPort( port );
		const d = wp && wp.dock;
		if ( d && d.start && d.end ) {

			// beside the foot of the jetty: 3 m inland along it, 9 m off to one side
			const ux = d.start.x - d.end.x, uz = d.start.z - d.end.z, l = Math.hypot( ux, uz ) || 1;
			const ax = ux / l, az = uz / l;
			return { x: d.start.x + ax * 3 - az * 9, z: d.start.z + az * 3 + ax * 9 };

		}

		if ( d && d.position ) return { x: d.position.x + 12, z: d.position.z };
		return null;

	}

	hidden() {

		return SMUGGLER.compartments[ this.compartment ].hides;

	}

	usePapers() {

		if ( this.papers < 1 ) return false;
		this.papers --;
		return true;

	}

	_trustMul() {

		return 1 + this.trust / 250; // up to +20% at full trust

	}

	_deal( total ) {

		this.business += total;
		this.trust = clamp( Math.floor( this.business / SMUGGLER.trustPer ), 0, SMUGGLER.trustMax );

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		const k = Math.exp( - hours / SMUGGLER.recover );
		for ( const g in this.push ) {

			this.push[ g ] *= k;
			if ( Math.abs( this.push[ g ] ) < 1e-4 ) delete this.push[ g ];

		}

	}

	buys( port, good ) {

		return !! GOODS[ good ] && ( good === 'relics' || ! legalAt( port, good ) );

	}

	_impact( port, good ) {

		return 1 / ( this.trade.sim.depth( port, good ) * SMUGGLER.depth );

	}

	// what he pays for the i-th unit of a sale
	_bidUnit( port, good, i ) {

		const eq = this.trade.sim.eq( port, good );
		return eq * SMUGGLER.bidMul * this._trustMul() * Math.exp( - ( this.push[ good ] || 0 ) - this._impact( port, good ) * ( i + 0.5 ) );

	}

	offers( port ) {

		const cargo = this.trade.cargo;
		const rows = [];
		for ( const g of GOOD_IDS ) {

			if ( ! this.buys( port, g ) ) continue;
			rows.push( {
				good: g, name: GOODS[ g ].name, unit: GOODS[ g ].unit, color: GOODS[ g ].color, held: cargo[ g ] ? cargo[ g ].qty : 0, cond: cargo[ g ] ? cargo[ g ].cond : 1,
				bid: r2( this._bidUnit( port, g, 0 ) ),
			} );

		}

		return rows;

	}

	sell( port, good, qty = 'all' ) {

		if ( ! this.here( port ) ) return { ok: false, reason: 'away', message: 'Nobody is here.' };
		if ( ! this.buys( port, good ) ) return { ok: false, reason: 'refused', message: 'He does not want that here: sell it at the stall.' };
		const have = this.trade.cargo[ good ] ? this.trade.cargo[ good ].qty : 0;
		if ( have < 1 ) return { ok: false, reason: 'empty', message: 'You carry none of that.' };
		const n = qty === 'all' ? have : Math.min( have, Math.floor( num( Number( qty ) ) ) );
		if ( n < 1 ) return { ok: false, reason: 'qty', message: 'Choose a quantity.' };
		const take = this.trade._removeLots( good, n );
		let raw = 0, i = 0;
		const parts = [];
		for ( const t of take ) {

			let rev = 0;
			for ( let j = 0; j < t.m; j ++ ) rev += this._bidUnit( port, good, i ++ ) * clamp( t.cond, 0, 1 );
			raw += rev;
			parts.push( { from: t.port, qty: t.m, revenue: rev, cost: t.cost } );

		}

		const total = Math.floor( raw + 1e-9 );
		const scale = raw > 0 ? total / raw : 0;
		for ( const p of parts ) p.revenue *= scale;
		this.push[ good ] = ( this.push[ good ] || 0 ) + n * this._impact( port, good );
		const s = this.state;
		if ( total > 0 && s && s.earn ) s.earn( total );
		const profit = this.trade.ledger.sale( { good, to: port, day: this.trade.day, parts } );
		this._deal( total );
		this._emit( 'smugglerDeal', { port, good, qty: n, total, profit: Math.round( profit ) } );
		this.trade.panel.refresh();
		return { ok: true, qty: n, total, profit: Math.round( profit ) };

	}

	buyCompartment() {

		const next = SMUGGLER.compartments[ this.compartment + 1 ];
		if ( ! next ) return { ok: false, reason: 'max', message: 'Your hold is as hollow as it gets.' };
		if ( next.trust && this.trust < next.trust && ! ( this.state && this.state.free ) ) return { ok: false, reason: 'trust', message: 'He does not know you well enough yet.' };
		const s = this.state;
		if ( s && s.spend && ! s.spend( next.price ) ) return { ok: false, reason: 'money', message: `That costs $${ next.price }.` };
		this.compartment = next.level;
		this._deal( s && s.free ? 0 : next.price );
		this._emit( 'smugglerGear', { item: 'compartment', level: next.level, price: next.price } );
		return { ok: true, level: next.level, hides: next.hides };

	}

	buyPapers() {

		if ( this.papers >= SMUGGLER.papersMax ) return { ok: false, reason: 'max', message: 'You already carry all the papers you can explain.' };
		const s = this.state;
		if ( s && s.spend && ! s.spend( SMUGGLER.papersPrice ) ) return { ok: false, reason: 'money', message: `Papers cost $${ SMUGGLER.papersPrice }.` };
		this.papers ++;
		this._deal( s && s.free ? 0 : SMUGGLER.papersPrice );
		this._emit( 'smugglerGear', { item: 'papers', level: this.papers, price: SMUGGLER.papersPrice } );
		return { ok: true, papers: this.papers };

	}

	view( port ) {

		const next = SMUGGLER.compartments[ this.compartment + 1 ] || null;
		return {
			name: SMUGGLER.name, port, portName: PORTS[ port ] ? PORTS[ port ].name : port, here: this.here( port ), trust: this.trust, rows: this.offers( port ),
			compartment: { ...SMUGGLER.compartments[ this.compartment ] }, nextCompartment: next ? { ...next } : null,
			papers: this.papers, papersPrice: SMUGGLER.papersPrice, papersMax: SMUGGLER.papersMax,
		};

	}

	toJSON() {

		const push = {};
		for ( const g in this.push ) push[ g ] = Math.round( this.push[ g ] * 1e4 ) / 1e4;
		return { business: r2( this.business ), compartment: this.compartment, papers: this.papers, push };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this.business = num( d.business, 0, 0, 1e9 );
		this._deal( 0 );
		this.compartment = clamp( num( d.compartment, 0 ) | 0, 0, SMUGGLER.compartments.length - 1 );
		this.papers = clamp( num( d.papers, 0 ) | 0, 0, SMUGGLER.papersMax );
		for ( const g in d.push || {} ) if ( GOODS[ g ] ) this.push[ g ] = num( d.push[ g ], 0, - 3, 3 );

	}

}
