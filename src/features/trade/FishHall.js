import { PORTS, identity } from './goods.js';
import { num } from './market.js';
import { FISH_HALL, fishSaleFactor } from '../../game/FishStand.js';
import { FISH } from '../../game/FishTable.js';

// The fish halls' side of the economy (wave 15B): the catch loses value as it ages in the cooler (ice in the hold
// slows it), each port pays a little more for the species it eats, and each hall posts a wanted species for the day
// (a big bonus). Game sells the catch through GameState at its catch value; trade.fishSale( sold, port ) then settles
// the difference (a bonus is earned, a stale-fish discount is taken back). The sandbox keeps the catch fresh.
//
//   fishHall.age( id ) / quote( fish, port ) -> { price, factor, fresh, eats, wanted, age }
//   fishHall.wanted( port, day? ) -> species id      fishHall.settle( sold, port ) -> $ difference (applied)
//   fishHall.advance( hours ) (trade.advance does it) / track() (trade.update: stamps new catches)
//
// Events: fishHallBonus { port, delta, count } after a settled sale.

// the species a hall may ask for: the common catches (no rarities: a wanted fish should be catchable on purpose)
const POOL = Object.keys( FISH ).filter( ( s ) => FISH[ s ] && ! FISH[ s ].minigame && FISH[ s ].rarity >= 0.3 );

const hash = ( s ) => {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	h ^= h >>> 13;
	h = Math.imul( h, 0x5bd1e995 );
	return ( h ^ ( h >>> 15 ) ) >>> 0;

};

export class FishHall {

	constructor( trade ) {

		this.trade = trade;
		this.reset();

	}

	reset() {

		this.ages = {}; // fish id -> in-game hours in the cooler (slowed by ice)
		this.bonus = 0; // $ earned over the catch values
		this.lost = 0; // $ lost to staleness
		this.sold = 0;
		this._day = null;

	}

	get state() {

		return this.trade.state;

	}

	get free() {

		const s = this.state;
		return !! ( s && s.free );

	}

	iced() {

		const c = this.trade.cargo.ice;
		return !! ( c && c.qty > 0 );

	}

	// new catches start at age 0 (fish already in the cooler from an older save count as fresh)
	track() {

		const inv = this.state && Array.isArray( this.state.inventory ) ? this.state.inventory : null;
		if ( ! inv ) return;
		for ( const f of inv ) if ( f && f.id != null && this.ages[ f.id ] === undefined ) this.ages[ f.id ] = 0;

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		this.track();
		const k = this.iced() ? FISH_HALL.iced : 1;
		const inv = this.state && Array.isArray( this.state.inventory ) ? this.state.inventory : [];
		const live = new Set( inv.map( ( f ) => String( f.id ) ) );
		for ( const id in this.ages ) {

			if ( ! live.has( id ) ) delete this.ages[ id ]; // sold, eaten, crafted, lost
			else this.ages[ id ] += hours * k;

		}

		// a new day: the boards post their wanted species
		const day = this.trade.day;
		if ( this._day !== day ) {

			if ( this._day !== null ) {

				const home = this.wanted( 'home', day );
				if ( home && FISH[ home ] ) this.trade.sim.post( `The Home fish hall wants ${ FISH[ home ].name.toLowerCase() } today: +${ Math.round( FISH_HALL.wanted * 100 ) }%.`, 'fish' );

			}

			this._day = day;

		}

	}

	age( id ) {

		return num( this.ages[ id ], 0, 0, 1e6 );

	}

	// the day's wanted species at a port: stable for the day, different per port
	wanted( port, day = this.trade.day ) {

		if ( ! POOL.length ) return null;
		const eats = identity( port ).eats || [];
		const pool = [ ...new Set( [ ...eats.filter( ( s ) => FISH[ s ] ), ...POOL ] ) ];
		return pool[ hash( `${ port }:${ day | 0 }` ) % pool.length ];

	}

	quote( fish, port ) {

		const value = fish && Number.isFinite( fish.value ) ? fish.value : 0;
		const age = fish ? this.age( fish.id ) : 0;
		const r = fishSaleFactor( { species: fish && fish.species, age, eats: identity( port ).eats || [], wanted: this.wanted( port ), freshness: ! this.free } );
		return { ...r, age, value, price: Math.round( value * r.factor ) };

	}

	// the fish were just sold at their catch value: pay the bonus / take back the discount; returns the difference
	settle( sold, port ) {

		if ( ! Array.isArray( sold ) || ! sold.length || ! PORTS[ port ] ) return 0;
		let delta = 0;
		for ( const f of sold ) {

			if ( ! f ) continue;
			const q = this.quote( f, port );
			delta += q.price - q.value;
			delete this.ages[ f.id ];

		}

		delta = Math.round( delta );
		const s = this.state;
		if ( delta > 0 && s && s.earn ) s.earn( delta );
		else if ( delta < 0 && s && s.spend && ! s.free ) {

			// the sale just paid the full value into the purse, so the discount always fits
			if ( ! s.spend( - delta ) ) delta = 0;

		}

		if ( delta > 0 ) this.bonus += delta;
		else this.lost -= delta;
		this.sold += sold.length;
		this.trade.ledger.fishSale( sold.reduce( ( a, f ) => a + ( f && Number.isFinite( f.value ) ? f.value : 0 ), 0 ) + delta, delta );
		const F = this.trade.features;
		if ( F && F.emit && delta ) F.emit( 'fishHallBonus', { port, delta, count: sold.length } );
		return delta;

	}

	// what the halls want today (the price board's fish line)
	board( port ) {

		const w = this.wanted( port );
		return { port, wanted: w, wantedName: w && FISH[ w ] ? FISH[ w ].name : null, bonus: FISH_HALL.wanted, eats: ( identity( port ).eats || [] ).filter( ( s ) => FISH[ s ] ).map( ( s ) => FISH[ s ].name ), iced: this.iced() };

	}

	toJSON() {

		const ages = {};
		for ( const id in this.ages ) ages[ id ] = Math.round( this.ages[ id ] * 100 ) / 100;
		return { ages, bonus: this.bonus, lost: this.lost, sold: this.sold, day: this._day };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		if ( d.ages && typeof d.ages === 'object' ) for ( const id in d.ages ) this.ages[ id ] = num( d.ages[ id ], 0, 0, 1e6 );
		this.bonus = num( d.bonus, 0, 0, 1e9 );
		this.lost = num( d.lost, 0, 0, 1e9 );
		this.sold = num( d.sold, 0, 0, 1e9 ) | 0;
		this._day = Number.isFinite( d.day ) ? d.day : null;

	}

}
