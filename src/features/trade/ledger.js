import { GOODS, PORTS } from './goods.js';
import { num } from './market.js';

// The merchant's ledger: what the trade earned. A sale is booked per lot of cargo against the port the lot was
// bought at, so a route is "home>pons" (bought at Home, sold at Pons); "home>home" is a quick flip that never
// left the quay. A trip is a crossing between the two stalls with cargo aboard.
//
//   ledger.trips / crossings           voyages with cargo / all voyages between the two markets
//   ledger.spent / revenue / profit    money in the purchases / from the sales / the difference of the sold lots
//   ledger.routes[ 'home>pons' ]       { sales, units, revenue, cost, profit }
//   ledger.goods[ id ]                 { units, revenue, cost, profit }
//   ledger.best                        { good, qty, profit, from, to, day } the best single sale, or null
//   ledger.costs                       { dues, insurance, rent } the harbourmaster's and the warehouse's money (wave 15B;
//                                      insurance claims count against the premiums); ledger.cost( kind, n ); net()
//   ledger.fish                        { sold ($ the halls paid), bonus ($ over / under the catch value) }; fishSale( total, delta )
export const COST_KINDS = [ 'dues', 'insurance', 'rent' ];

export class Ledger {

	constructor() {

		this.reset();

	}

	reset() {

		this.trips = 0;
		this.crossings = 0;
		this.bought = 0; // units
		this.spent = 0;
		this.sold = 0; // units
		this.revenue = 0;
		this.profit = 0;
		this.routes = {};
		this.goods = {};
		this.best = null;
		this.costs = { dues: 0, insurance: 0, rent: 0 };
		this.fish = { sold: 0, bonus: 0 };

	}

	cost( kind, n ) {

		if ( ! COST_KINDS.includes( kind ) || ! Number.isFinite( n ) ) return;
		this.costs[ kind ] += n;

	}

	fishSale( total, delta ) {

		if ( Number.isFinite( total ) ) this.fish.sold += total;
		if ( Number.isFinite( delta ) ) this.fish.bonus += delta;

	}

	// the trading profit after the dues, the insurance and the rent
	net() {

		let c = 0;
		for ( const k of COST_KINDS ) c += this.costs[ k ];
		return this.profit - c;

	}

	buy( qty, total ) {

		this.bought += qty;
		this.spent += total;

	}

	// parts: [ { from: port the lot was bought at, qty, revenue, cost } ], one sale of one good at port `to`
	sale( { good, to, day = 1, parts } ) {

		let qty = 0, revenue = 0, cost = 0, bestFrom = to;
		let bestProfit = - Infinity;
		for ( const p of parts ) {

			const key = p.from + '>' + to;
			const r = this.routes[ key ] || ( this.routes[ key ] = { sales: 0, units: 0, revenue: 0, cost: 0, profit: 0 } );
			r.sales ++;
			r.units += p.qty;
			r.revenue += p.revenue;
			r.cost += p.cost;
			r.profit += p.revenue - p.cost;
			qty += p.qty;
			revenue += p.revenue;
			cost += p.cost;
			if ( p.revenue - p.cost > bestProfit ) {

				bestProfit = p.revenue - p.cost;
				bestFrom = p.from;

			}

		}

		const g = this.goods[ good ] || ( this.goods[ good ] = { units: 0, revenue: 0, cost: 0, profit: 0 } );
		g.units += qty;
		g.revenue += revenue;
		g.cost += cost;
		g.profit += revenue - cost;
		this.sold += qty;
		this.revenue += revenue;
		this.profit += revenue - cost;
		const profit = revenue - cost;
		if ( qty > 0 && ( ! this.best || profit > this.best.profit ) ) this.best = { good, qty, profit: Math.round( profit * 100 ) / 100, from: bestFrom, to, day };
		return profit;

	}

	// the player opened the stall at `port`; a change of port is a crossing, a trip when there was cargo aboard
	arrive( from, to, cargoAboard ) {

		if ( ! from || from === to ) return false;
		this.crossings ++;
		if ( cargoAboard ) this.trips ++;
		return true;

	}

	// routes sorted by profit, best first, with the ports' names: [ { key, from, to, label, ...route } ]
	routeList() {

		return Object.keys( this.routes ).map( ( key ) => {

			const [ from, to ] = key.split( '>' );
			const label = from === to ? `${ PORTS[ from ] ? PORTS[ from ].name : from } (quick flips)` : `${ PORTS[ from ] ? PORTS[ from ].name : from } to ${ PORTS[ to ] ? PORTS[ to ].name : to }`;
			return { key, from, to, label, ...this.routes[ key ] };

		} ).sort( ( a, b ) => b.profit - a.profit );

	}

	toJSON() {

		const r2 = ( v ) => Math.round( v * 100 ) / 100;
		const routes = {}, goods = {};
		for ( const k in this.routes ) {

			const r = this.routes[ k ];
			routes[ k ] = { sales: r.sales, units: r.units, revenue: r2( r.revenue ), cost: r2( r.cost ), profit: r2( r.profit ) };

		}

		for ( const k in this.goods ) {

			const g = this.goods[ k ];
			goods[ k ] = { units: g.units, revenue: r2( g.revenue ), cost: r2( g.cost ), profit: r2( g.profit ) };

		}

		return {
			trips: this.trips, crossings: this.crossings, bought: this.bought, spent: r2( this.spent ), sold: this.sold,
			revenue: r2( this.revenue ), profit: r2( this.profit ), routes, goods, best: this.best ? { ...this.best } : null,
			costs: { dues: r2( this.costs.dues ), insurance: r2( this.costs.insurance ), rent: r2( this.costs.rent ) }, fish: { sold: r2( this.fish.sold ), bonus: r2( this.fish.bonus ) },
		};

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return false;
		this.trips = num( d.trips, 0, 0, 1e9 ) | 0;
		this.crossings = num( d.crossings, 0, 0, 1e9 ) | 0;
		this.bought = num( d.bought, 0, 0, 1e9 ) | 0;
		this.spent = num( d.spent, 0, 0, 1e12 );
		this.sold = num( d.sold, 0, 0, 1e9 ) | 0;
		this.revenue = num( d.revenue, 0, 0, 1e12 );
		this.profit = num( d.profit, 0, - 1e12, 1e12 );
		for ( const k in ( d.routes || {} ) ) {

			const [ from, to ] = k.split( '>' );
			const r = d.routes[ k ];
			if ( ! PORTS[ from ] || ! PORTS[ to ] || ! r ) continue;
			this.routes[ k ] = { sales: num( r.sales, 0, 0, 1e9 ) | 0, units: num( r.units, 0, 0, 1e9 ) | 0, revenue: num( r.revenue, 0, 0, 1e12 ), cost: num( r.cost, 0, 0, 1e12 ), profit: num( r.profit, 0, - 1e12, 1e12 ) };

		}

		for ( const k in ( d.goods || {} ) ) {

			const g = d.goods[ k ];
			if ( ! GOODS[ k ] || ! g ) continue;
			this.goods[ k ] = { units: num( g.units, 0, 0, 1e9 ) | 0, revenue: num( g.revenue, 0, 0, 1e12 ), cost: num( g.cost, 0, 0, 1e12 ), profit: num( g.profit, 0, - 1e12, 1e12 ) };

		}

		const c = d.costs && typeof d.costs === 'object' ? d.costs : {};
		for ( const k of COST_KINDS ) this.costs[ k ] = num( c[ k ], 0, - 1e12, 1e12 );
		const f = d.fish && typeof d.fish === 'object' ? d.fish : {};
		this.fish = { sold: num( f.sold, 0, 0, 1e12 ), bonus: num( f.bonus, 0, - 1e12, 1e12 ) };
		const b = d.best;
		if ( b && GOODS[ b.good ] && PORTS[ b.from ] && PORTS[ b.to ] ) this.best = { good: b.good, qty: num( b.qty, 0, 0, 1e9 ) | 0, profit: num( b.profit, 0, - 1e12, 1e12 ), from: b.from, to: b.to, day: num( b.day, 1, 1, 1e6 ) | 0 };
		return true;

	}

}
