import { GOODS, GOOD_IDS, PORTS, PORT_IDS, seaDistance, legalAt } from './goods.js';
import { Rng, clamp, num } from './market.js';
import { DAY_SPEED } from '../../game/GameMode.js';

// Hauling contracts and the hauling licence (docs/UNREAL_PARITY.md E5). Each market posts a few consignments:
// carry `qty` units of a good from that port to another before a deadline. The goods are loaded at the stall
// (they take crates in the hold but are not yours to sell), a deposit is held against them, and the consignee
// pays the reward and returns the deposit on delivery. Late or abandoned: the deposit is forfeit, the goods go
// back to their owner and your merchant standing drops.
//
// Licences: without one you may only take parcels (up to LICENCES[ 0 ].maxCrates crates); the coastal licence opens
// ordinary freight, the master freight licence big loads with better pay (and wants merchant standing).
//
//   haul.offers( port ) -> [ offer ]            { id, from, to, good, qty, crates, reward, deposit, hours, tier, ok, why }
//   haul.accept( port, id ) / haul.deliver( port ) / haul.abandon( id )
//   haul.active                                 accepted contracts { ...offer, due, cond }
//   haul.crates()                               crates the consignments take in the hold
//   haul.buyLicence() / haul.licence            0 none, 1 coastal, 2 master
//
// Events: haulAccepted { id, from, to, good, qty, reward, due }, haulDelivered { id, from, to, good, qty, reward },
// haulFailed { id, from, to, good, qty, why: 'late' | 'abandoned' }, licenceBought { level, name, price }.

// wave 15B: the licences are the merchant tiers. The coastal licence also lets the Tidemark guild sell you its
// luxuries (wine, silk, clocks: goods tagged 'fine'); the master licence lifts the bulk limit on one purchase
// (LICENCE_LOTS: units per purchase by level). The sandbox needs none.
export const LICENCES = [
	{ level: 0, name: 'No licence', price: 0, maxCrates: 2, payMul: 1, unlocks: 'parcels only' },
	{ level: 1, name: 'Coastal hauling licence', price: 350, maxCrates: 14, payMul: 1, standing: 0, unlocks: 'freight contracts and the Tidemark luxuries' },
	{ level: 2, name: 'Master freight licence', price: 1400, maxCrates: 40, payMul: 1.2, standing: 35, unlocks: 'big loads, better pay and bulk lots' },
];

export const LICENCE_LOTS = [ 24, 24, 60 ];

export const HAUL = {
	perPort: 4, // offers on a board
	refresh: 12, // hours between new boards
	depositFrac: 0.25, // of the goods' value
	payFrac: 0.2, // of the goods' value, times the distance factor, plus a flat sum per 700 m
	flatPer700: 30,
	slowSpeed: 4, // m/s: the deadline assumes a slow boat ...
	slack: 3, // ... times this, plus `minHours`
	minHours: 6,
};

const r2 = ( v ) => Math.round( v * 100 ) / 100;

export class HaulContracts {

	constructor( trade, seed = 7 ) {

		this.trade = trade;
		this.seed = seed;
		this.reset();

	}

	reset() {

		this.rng = new Rng( this.seed * 977 + 13 );
		this.licence = 0;
		this.boards = {}; // port -> { at, list: [ offer ] }
		this.active = [];
		this.nextId = 1;
		this.done = 0;
		this.failed = 0;

	}

	get now() {

		return this.trade.sim.abs;

	}

	get state() {

		return this.trade.state;

	}

	_emit( name, payload ) {

		const f = this.trade.features;
		if ( f && f.emit ) f.emit( name, payload );

	}

	licenceInfo( level = this.licence ) {

		return LICENCES[ clamp( level | 0, 0, LICENCES.length - 1 ) ];

	}

	buyLicence() {

		const next = LICENCES[ this.licence + 1 ];
		if ( ! next ) return { ok: false, reason: 'max', message: 'You hold the best licence.' };
		const s = this.state;
		const standing = this.trade.credit ? this.trade.credit.standing : 0;
		if ( ! ( s && s.free ) && standing < ( next.standing || 0 ) ) return { ok: false, reason: 'standing', message: `The ${ next.name } wants merchant standing ${ next.standing }.` };
		if ( s && s.spend && ! s.spend( next.price ) ) return { ok: false, reason: 'money', message: `The ${ next.name } costs $${ next.price }.` };
		this.licence = next.level;
		this._emit( 'licenceBought', { level: next.level, name: next.name, price: s && s.free ? 0 : next.price } );
		return { ok: true, level: next.level, name: next.name };

	}

	crates() {

		let n = 0;
		for ( const c of this.active ) n += c.crates;
		return n;

	}

	// a contract's pay: a share of the goods' value scaled by the distance, plus a flat sum for the miles
	_price( from, to, good, qty, tier ) {

		const d = seaDistance( from, to ) / 700;
		const value = GOODS[ good ].base * qty;
		const mul = LICENCES[ tier ].payMul;
		return {
			reward: Math.round( ( value * HAUL.payFrac * ( 0.6 + 0.4 * d ) + HAUL.flatPer700 * d ) * mul ),
			deposit: Math.round( value * HAUL.depositFrac ),
			hours: Math.round( Math.max( HAUL.minHours, seaDistance( from, to ) / HAUL.slowSpeed * DAY_SPEED * HAUL.slack + HAUL.minHours ) ),
		};

	}

	_generate( port ) {

		const others = PORT_IDS.filter( ( p ) => p !== port );
		const list = [];
		if ( ! others.length ) return list;
		for ( let i = 0; i < HAUL.perPort; i ++ ) {

			const to = others[ Math.floor( this.rng.next() * others.length ) ];
			// what the destination wants, else anything legal at both ends (never contraband: that is the smuggler's)
			const wanted = GOOD_IDS.filter( ( g ) => legalAt( port, g ) && legalAt( to, g ) && GOODS[ g ].demand.includes( to ) );
			const pool = wanted.length ? wanted : GOOD_IDS.filter( ( g ) => legalAt( port, g ) && legalAt( to, g ) );
			if ( ! pool.length ) continue;
			const good = pool[ Math.floor( this.rng.next() * pool.length ) ];
			// tiers: parcels, freight, big loads (the first offer is always a parcel so a new trader has one)
			const roll = this.rng.next();
			const tier = i === 0 ? 0 : roll < 0.55 ? 1 : 2;
			const maxC = tier === 0 ? LICENCES[ 0 ].maxCrates : tier === 1 ? 10 : 26;
			const minC = tier === 0 ? 1 : tier === 1 ? 3 : 12;
			const crates = minC + Math.floor( this.rng.next() * ( maxC - minC + 1 ) );
			const qty = Math.max( 1, Math.floor( crates / GOODS[ good ].crates ) );
			list.push( { id: 'h' + ( this.nextId ++ ), from: port, to, good, qty, crates: qty * GOODS[ good ].crates, tier, ...this._price( port, to, good, qty, tier ) } );

		}

		return list;

	}

	_board( port ) {

		const b = this.boards[ port ];
		if ( b && this.now - b.at < HAUL.refresh && b.at <= this.now ) return b;
		const nb = { at: this.now, list: this._generate( port ) };
		this.boards[ port ] = nb;
		return nb;

	}

	// why an offer cannot be taken now (null: it can)
	_why( o ) {

		if ( o.tier > this.licence && o.crates > this.licenceInfo().maxCrates ) return o.tier === 2 ? 'Needs the master freight licence' : 'Needs a hauling licence';
		if ( this.trade.free() < o.crates ) return 'Not enough free crates';
		const s = this.state;
		if ( s && ! s.free && num( s.money ) < o.deposit ) return `Deposit $${ o.deposit }`;
		return null;

	}

	offers( port ) {

		if ( ! PORTS[ port ] ) return [];
		if ( port === 'tidemark' ) { // wave 13: the market cell opens with "A ferry to Tidemark"

			const story = this.trade && this.trade._feature ? this.trade._feature( 'story' ) : null;
			if ( story && story.opens && story.opens( 'haul:tidemark' ) === false ) return [];

		}
		return this._board( port ).list.map( ( o ) => {

			const why = this._why( o );
			return { ...o, name: GOODS[ o.good ].name, toName: PORTS[ o.to ] ? PORTS[ o.to ].name : o.to, ok: ! why, why };

		} );

	}

	accept( port, id ) {

		const b = this._board( port );
		const o = b.list.find( ( x ) => x.id === id );
		if ( ! o ) return { ok: false, reason: 'gone', message: 'That contract is gone.' };
		const why = this._why( o );
		if ( why ) return { ok: false, reason: 'cannot', message: why + '.' };
		const s = this.state;
		if ( s && s.spend && ! s.spend( o.deposit ) ) return { ok: false, reason: 'money', message: 'Not enough money for the deposit.' };
		b.list = b.list.filter( ( x ) => x !== o );
		const c = { ...o, due: this.now + o.hours, cond: 1, paidDeposit: s && s.free ? 0 : o.deposit };
		this.active.push( c );
		this._emit( 'haulAccepted', { id: c.id, from: c.from, to: c.to, good: c.good, qty: c.qty, reward: c.reward, due: c.due } );
		return { ok: true, contract: { ...c } };

	}

	_pay( n ) {

		const s = this.state;
		if ( n > 0 && s && s.earn ) s.earn( n );

	}

	// hand over every consignment due at this port; returns [ { id, reward } ]
	deliver( port ) {

		const out = [];
		for ( const c of this.active ) {

			if ( c.to !== port || this.now > c.due ) continue;
			// perishables are paid by the condition they arrive in
			const reward = Math.round( c.reward * ( GOODS[ c.good ].perish > 0 ? clamp( c.cond, 0, 1 ) : 1 ) );
			this._pay( reward + c.paidDeposit );
			c.delivered = true;
			this.done ++;
			if ( this.trade.credit ) this.trade.credit.adjust( 1.5 + c.tier, 'contract delivered' );
			const s = this.state;
			if ( s && s.addRep ) s.addRep( port, 1 + c.tier );
			this._emit( 'haulDelivered', { id: c.id, from: c.from, to: c.to, good: c.good, qty: c.qty, reward } );
			out.push( { id: c.id, reward, good: c.good, qty: c.qty } );

		}

		this.active = this.active.filter( ( c ) => ! c.delivered );
		return out;

	}

	abandon( id ) {

		const c = this.active.find( ( x ) => x.id === id );
		if ( ! c ) return false;
		this._fail( c, 'abandoned' );
		this.active = this.active.filter( ( x ) => x !== c );
		return true;

	}

	_fail( c, why ) {

		this.failed ++;
		if ( this.trade.credit ) this.trade.credit.adjust( why === 'late' ? - 5 : - 3, 'contract failed' );
		this._emit( 'haulFailed', { id: c.id, from: c.from, to: c.to, good: c.good, qty: c.qty, why } );
		this.trade._note( `Contract failed (${ why }): ${ c.qty } ${ GOODS[ c.good ].name.toLowerCase() } for ${ PORTS[ c.to ] ? PORTS[ c.to ].name : c.to }. The deposit is forfeit.`, 'cargo' );

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		for ( const c of this.active ) {

			const rate = GOODS[ c.good ].perish;
			if ( rate > 0 ) c.cond *= Math.exp( - rate * hours );

		}

		const late = this.active.filter( ( c ) => this.now > c.due );
		for ( const c of late ) this._fail( c, 'late' );
		if ( late.length ) this.active = this.active.filter( ( c ) => this.now <= c.due );

	}

	view( port ) {

		const s = this.state;
		const lic = this.licenceInfo(), next = LICENCES[ this.licence + 1 ] || null;
		return {
			licence: { ...lic }, next: next ? { ...next, price: s && s.free ? 0 : next.price } : null, sandbox: !! ( s && s.free ),
			offers: this.offers( port ), done: this.done, failed: this.failed,
			active: this.active.map( ( c ) => ( { ...c, name: GOODS[ c.good ].name, toName: PORTS[ c.to ] ? PORTS[ c.to ].name : c.to, fromName: PORTS[ c.from ] ? PORTS[ c.from ].name : c.from, left: c.due - this.now, here: c.to === port } ) ),
		};

	}

	toJSON() {

		const boards = {};
		for ( const p in this.boards ) boards[ p ] = { at: r2( this.boards[ p ].at ), list: this.boards[ p ].list.map( ( o ) => ( { ...o } ) ) };
		return { licence: this.licence, rng: this.rng.s, next: this.nextId, done: this.done, failed: this.failed, boards, active: this.active.map( ( c ) => ( { ...c, cond: Math.round( c.cond * 1e4 ) / 1e4 } ) ) };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this.licence = clamp( num( d.licence, 0 ) | 0, 0, LICENCES.length - 1 );
		if ( typeof d.rng === 'number' && Number.isFinite( d.rng ) ) this.rng.s = d.rng >>> 0;
		this.nextId = Math.max( 1, num( d.next, 1, 1, 1e9 ) | 0 );
		this.done = num( d.done, 0, 0, 1e9 ) | 0;
		this.failed = num( d.failed, 0, 0, 1e9 ) | 0;
		const valid = ( o ) => o && typeof o.id === 'string' && PORTS[ o.from ] && PORTS[ o.to ] && GOODS[ o.good ] && num( o.qty ) >= 1;
		const clean = ( o ) => ( {
			id: o.id, from: o.from, to: o.to, good: o.good, qty: num( o.qty, 1, 1, 500 ) | 0, crates: num( o.crates, 1, 1, 1000 ) | 0, tier: clamp( num( o.tier, 0 ) | 0, 0, 2 ),
			reward: num( o.reward, 0, 0, 1e7 ), deposit: num( o.deposit, 0, 0, 1e7 ), hours: num( o.hours, 12, 1, 1e4 ),
		} );
		const src = d.boards && typeof d.boards === 'object' ? d.boards : {};
		for ( const p in src ) {

			if ( ! PORTS[ p ] || ! src[ p ] ) continue;
			this.boards[ p ] = { at: num( src[ p ].at, - 1e9 ), list: ( Array.isArray( src[ p ].list ) ? src[ p ].list : [] ).filter( valid ).map( clean ) };

		}

		for ( const c of Array.isArray( d.active ) ? d.active : [] ) {

			if ( ! valid( c ) ) continue;
			this.active.push( { ...clean( c ), due: num( c.due, 0 ), cond: clamp( num( c.cond, 1 ), 0, 1 ), paidDeposit: num( c.paidDeposit, 0, 0, 1e7 ) } );

		}

	}

}
