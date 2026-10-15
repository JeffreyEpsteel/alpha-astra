import { GOODS, PORTS } from './goods.js';
import { clamp, num } from './market.js';

// The Tidemark warehouse (wave 15B): rent space by the crate and leave cargo there for later (buy cheap after a glut,
// sell when the market recovers; or keep the hold free for a contract). Store and withdraw at the Tidemark market
// only. Rent is charged per crate stored per in-game day at the turn of the day; rent the purse cannot pay is owed,
// and nothing leaves until it is paid. The cool stone cellar halves spoilage. The sandbox pays no rent.
//
//   warehouse.here( port )                    the market where the warehouse is (WAREHOUSE.port)
//   warehouse.store( port, good, n | 'all' ) / withdraw( port, good, n | 'all' ) -> { ok, qty, reason?, message? }
//   warehouse.lots / crates() / goods() -> { good: { qty, cond, paid } } / rentPerDay() / owed / payOwed()
//
// Events: warehouseStored { good, qty }, warehouseWithdrawn { good, qty }, warehouseRent { amount, owed }.

export const WAREHOUSE = {
	port: 'tidemark',
	capacity: 80, // crates
	rent: 1, // $ per crate per day
	spoil: 0.5, // perishables keep twice as long in the cellar
};

const r2 = ( v ) => Math.round( v * 100 ) / 100;

export class Warehouse {

	constructor( trade ) {

		this.trade = trade;
		this.reset();

	}

	reset() {

		this.lots = []; // { good, port, qty, cond, paid } (the lot's own history: the port it was bought at)
		this.owed = 0;
		this.hours = 0;
		this.rentPaid = 0;

	}

	get state() {

		return this.trade.state;

	}

	_emit( name, payload ) {

		const f = this.trade.features;
		if ( f && f.emit ) f.emit( name, payload );

	}

	here( port ) {

		return port === WAREHOUSE.port && !! PORTS[ port ];

	}

	crates() {

		let n = 0;
		for ( const l of this.lots ) n += l.qty * GOODS[ l.good ].crates;
		return n;

	}

	goods() {

		const out = {};
		for ( const l of this.lots ) {

			const o = out[ l.good ] || ( out[ l.good ] = { qty: 0, cond: 0, paid: 0 } );
			o.cond += l.cond * l.qty;
			o.qty += l.qty;
			o.paid += l.paid;

		}

		for ( const g in out ) {

			out[ g ].cond /= out[ g ].qty;
			out[ g ].paid = r2( out[ g ].paid );

		}

		return out;

	}

	rentPerDay() {

		const s = this.state;
		return s && s.free ? 0 : this.crates() * WAREHOUSE.rent;

	}

	_qty( have, n ) {

		return n === 'all' ? have : Math.min( have, Math.floor( num( Number( n ) ) ) );

	}

	store( port, good, n = 'all' ) {

		if ( ! this.here( port ) ) return { ok: false, reason: 'away', message: 'The warehouse is at Tidemark.' };
		const G = GOODS[ good ];
		const c = this.trade.cargo[ good ];
		if ( ! G || ! c ) return { ok: false, reason: 'empty', message: 'You carry none of that.' };
		let qty = this._qty( c.qty, n );
		qty = Math.min( qty, Math.floor( ( WAREHOUSE.capacity - this.crates() ) / G.crates ) );
		if ( qty < 1 ) return { ok: false, reason: n === 'all' || num( Number( n ) ) >= 1 ? 'full' : 'qty', message: 'The warehouse is full.' };
		for ( const t of this.trade._removeLots( good, qty ) ) this._add( good, t.port, t.m, t.cond, t.cost );
		this._emit( 'warehouseStored', { good, qty } );
		this.trade.panel.refresh();
		return { ok: true, qty };

	}

	withdraw( port, good, n = 'all' ) {

		if ( ! this.here( port ) ) return { ok: false, reason: 'away', message: 'The warehouse is at Tidemark.' };
		if ( this.owed > 0 ) return { ok: false, reason: 'owed', message: `The warehouse wants its rent first: $${ Math.ceil( this.owed ) }.` };
		const G = GOODS[ good ];
		let have = 0;
		for ( const l of this.lots ) if ( l.good === good ) have += l.qty;
		if ( ! G || have < 1 ) return { ok: false, reason: 'empty', message: 'Nothing of that in store.' };
		let qty = this._qty( have, n );
		qty = Math.min( qty, Math.floor( Math.max( 0, this.trade.free() ) / G.crates ) );
		if ( qty < 1 ) return { ok: false, reason: 'capacity', message: 'Your hold is full.' };
		let left = qty;
		for ( const l of this.lots ) {

			if ( l.good !== good || left <= 0 ) continue;
			const m = Math.min( l.qty, left );
			const cost = l.paid * m / l.qty;
			this.trade._addLot( good, l.port, m, l.cond, cost );
			l.paid -= cost;
			l.qty -= m;
			left -= m;

		}

		this.lots = this.lots.filter( ( l ) => l.qty > 0 );
		this._emit( 'warehouseWithdrawn', { good, qty } );
		this.trade.panel.refresh();
		return { ok: true, qty };

	}

	_add( good, port, qty, cond, paid ) {

		const l = this.lots.find( ( x ) => x.good === good && x.port === port );
		if ( l ) {

			l.cond = ( l.cond * l.qty + cond * qty ) / ( l.qty + qty );
			l.qty += qty;
			l.paid += paid;

		} else this.lots.push( { good, port, qty, cond, paid } );

	}

	payOwed() {

		if ( this.owed <= 0 ) return { ok: false, reason: 'none', message: 'No rent owed.' };
		const pay = Math.ceil( this.owed - 1e-9 );
		const s = this.state;
		if ( s && s.spend && ! s.spend( pay ) ) return { ok: false, reason: 'money', message: `The rent owed is $${ pay }.` };
		this.owed = 0;
		this.rentPaid += pay;
		this.trade.ledger.cost( 'rent', pay );
		return { ok: true, paid: pay };

	}

	_day() {

		const rent = this.rentPerDay();
		if ( rent <= 0 ) return;
		const s = this.state;
		if ( s && s.spend && s.spend( rent ) ) {

			this.rentPaid += rent;
			this.trade.ledger.cost( 'rent', rent );

		} else this.owed = r2( this.owed + rent );
		this._emit( 'warehouseRent', { amount: rent, owed: this.owed } );

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		for ( const l of this.lots ) {

			const rate = GOODS[ l.good ].perish * WAREHOUSE.spoil;
			if ( rate > 0 ) l.cond *= Math.exp( - rate * hours );

		}

		const gone = this.lots.filter( ( l ) => l.cond < 0.03 );
		if ( gone.length ) {

			this.lots = this.lots.filter( ( l ) => l.cond >= 0.03 );
			for ( const l of gone ) this.trade._note( `Your ${ GOODS[ l.good ].name.toLowerCase() } rotted in the Tidemark warehouse.`, 'cargo' );

		}

		this.hours += hours;
		let guard = 0;
		while ( this.hours >= 24 && guard ++ < 60 ) {

			this.hours -= 24;
			this._day();

		}

	}

	view() {

		const s = this.state;
		return { port: WAREHOUSE.port, name: PORTS[ WAREHOUSE.port ] ? PORTS[ WAREHOUSE.port ].name : WAREHOUSE.port, capacity: WAREHOUSE.capacity, used: this.crates(), rent: s && s.free ? 0 : WAREHOUSE.rent, rentPerDay: this.rentPerDay(), owed: this.owed, goods: this.goods(), sandbox: !! ( s && s.free ) };

	}

	toJSON() {

		return { lots: this.lots.map( ( l ) => ( { good: l.good, port: l.port, qty: l.qty, cond: Math.round( l.cond * 1e4 ) / 1e4, paid: r2( l.paid ) } ) ), owed: r2( this.owed ), hours: r2( this.hours ), rentPaid: this.rentPaid };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		for ( const l of Array.isArray( d.lots ) ? d.lots : [] ) {

			if ( ! l || ! GOODS[ l.good ] ) continue;
			const qty = Math.floor( num( l.qty, 0, 0, 1e4 ) );
			if ( qty < 1 ) continue;
			this._add( l.good, PORTS[ l.port ] ? l.port : WAREHOUSE.port, qty, clamp( num( l.cond, 1 ), 0, 1 ), Math.max( 0, num( l.paid ) ) );

		}

		this.owed = num( d.owed, 0, 0, 1e7 );
		this.hours = num( d.hours, 0, 0, 24 );
		this.rentPaid = num( d.rentPaid, 0, 0, 1e9 );

	}

}
