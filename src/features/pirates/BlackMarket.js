// The Blackwater black market (wave 12B): the fence in the pirate town. Anyone who reaches him while the bell is quiet can buy
// the black flag; everything else is for those the brotherhood lets in (the flag, or enough corsair standing). He buys
// contraband - whatever the home harbour's customs would seize - at a premium, and sells powder and shot cheap, a chart to an
// unclaimed treasure cache (the exploration feature) and pirate crew (the characters for hire, through GameState).
//
//   letIn( { standing, flag } ) -> bool                       the flag, or standing >= MARKET_RULES.standingGate
//   contrabandGoods() -> [ good ]                             goods contraband at the home harbour (trade LEGALITY)
//   buyPrice( good, { cond, standing } ) -> $ per unit       what the fence pays (base x premium x condition, more for friends)
//   const bm = new BlackMarket( { state, trade, naval, exploration, toast, characters } )   (getters or objects)
//   bm.canTrade( ctx ) -> { ok, reason }   ctx { standing, flag, alarm, held, what }   reasons 'closed' | 'alarm' | 'unwelcome'
//   bm.rows( ctx ) -> [ { id, kind: 'sell' | 'buy' | 'flag' | 'chart' | 'crew', label, price, qty?, ok, why } ]   (a panel's rows)
//   bm.sell( good, qty, ctx ) / buyPowder( n, ctx ) / buyShot( ctx ) / buyFlag( ctx ) / buyChart( ctx ) / hireCrew( id, ctx )
//                                                              -> { ok, reason?, total?, qty? }
// Everything sold here that customs cares about is flagged by the trade feature's legality: powder and relics are contraband at
// home, so a hold full of Blackwater powder is seized there like any other (test/feature-stronghold.mjs checks it).
// Wave 15C: ctx.stolen ( hijack.stolenQuote() -> { hull, name, price } ) adds the row 'sellship': the fence takes a stolen hull
// off your hands (Stronghold.marketAction runs hijack.sellStolen(): the money, and a skiff thrown in at the dock).

import { GOODS, contrabandAt } from '../trade/goods.js';
import { CHARACTERS } from '../../game/Characters.js';

export const MARKET_RULES = {
	flagPrice: 800,
	standingGate: 25, // corsair standing (Notoriety.js, -100..100) at which the brotherhood lets you in without the flag
	buyPremium: 1.45, // x the good's base price
	friendBonus: 0.2, // up to +20 % more at standing 100
	powder: { price: 38, max: 6 }, // a keg (base 70; Gull Rock's stall ~48)
	shot: { rounds: 12, price: 30 }, // the yard asks $60 for twelve
	chart: 250,
	crewDiscount: 0.75, // pirate crew sign on for three quarters of their price
	judge: 'home', // contraband is what the home harbour's customs would seize
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const val = ( v ) => ( typeof v === 'function' ? v() : v );

export const letIn = ( { standing = 0, flag = false } = {}, R = MARKET_RULES ) => !! flag || standing >= R.standingGate;

export function contrabandGoods( R = MARKET_RULES ) {

	return contrabandAt( R.judge );

}

export function buyPrice( good, { cond = 1, standing = 0 } = {}, R = MARKET_RULES ) {

	const G = GOODS[ good ];
	if ( ! G || ! contrabandGoods( R ).includes( good ) ) return 0;
	const friend = 1 + R.friendBonus * clamp( standing, 0, 100 ) / 100;
	return Math.round( G.base * R.buyPremium * clamp( cond, 0, 1 ) * friend );

}

export class BlackMarket {

	constructor( { state = null, trade = null, naval = null, exploration = null, toast = null, rules = MARKET_RULES } = {} ) {

		this._state = state;
		this._trade = trade;
		this._naval = naval;
		this._exploration = exploration;
		this.toast = toast || ( () => {} );
		this.rules = rules;
		this.sold = 0; // $ paid out to the player
		this.taken = 0; // $ taken from the player

	}

	get state() { return val( this._state ); }
	get trade() { return val( this._trade ); }
	get naval() { return val( this._naval ); }
	get exploration() { return val( this._exploration ); }

	canTrade( { standing = 0, flag = false, alarm = false, held = true, what = 'trade' } = {} ) {

		if ( ! held ) return { ok: false, reason: 'closed' };
		if ( alarm ) return { ok: false, reason: 'alarm' };
		// the flag is sold to anyone with the coin; the rest only to those the brotherhood lets in
		if ( what !== 'flag' && ! letIn( { standing, flag }, this.rules ) ) return { ok: false, reason: 'unwelcome' };
		return { ok: true };

	}

	_pay( n ) {

		const st = this.state;
		if ( ! st || ! st.spend ) return false;
		if ( ! st.spend( n ) ) return false;
		this.taken += n;
		return true;

	}

	_earn( n ) {

		const st = this.state;
		if ( n > 0 && st && st.earn ) st.earn( n );
		this.sold += n;

	}

	// the fence buys contraband out of the hold
	sell( good, qty, ctx = {} ) {

		const c = this.canTrade( ctx );
		if ( ! c.ok ) return c;
		const tr = this.trade, cargo = tr && tr.cargo ? tr.cargo[ good ] : null;
		const price = buyPrice( good, { cond: cargo ? cargo.cond : 1, standing: ctx.standing || 0 }, this.rules );
		if ( ! price ) return { ok: false, reason: 'notContraband' };
		if ( ! cargo || ! ( cargo.qty > 0 ) ) return { ok: false, reason: 'empty' };
		const n = qty === 'all' ? cargo.qty : Math.min( cargo.qty, Math.max( 0, Math.floor( qty ) ) );
		if ( n < 1 ) return { ok: false, reason: 'qty' };
		const got = tr.takeCargo( good, n );
		const q = got && Number.isFinite( got.qty ) ? got.qty : n;
		const total = price * q;
		this._earn( total );
		this.toast( `Sold ${ q } ${ GOODS[ good ].name.toLowerCase() } to the fence · +$${ total }` );
		return { ok: true, qty: q, total, price };

	}

	buyPowder( n = 1, ctx = {} ) {

		const c = this.canTrade( ctx );
		if ( ! c.ok ) return c;
		const tr = this.trade;
		if ( ! tr || ! tr.addCargo ) return { ok: false, reason: 'noHold' };
		const want = clamp( Math.floor( n ) || 1, 1, this.rules.powder.max );
		const each = Math.round( this.rules.powder.price * ( 1 - clamp( ctx.powderOff || 0, 0, 0.9 ) ) ); // wave 13: the story's discount
		const total = want * each;
		if ( ! this._pay( total ) ) return { ok: false, reason: 'money' };
		const got = tr.addCargo( 'powder', want, { paid: total } ) || 0;
		// whatever does not fit is paid back
		if ( got < want ) {

			const back = ( want - got ) * each;
			this._earn( back );
			this.taken -= back;
			this.sold -= back;

		}

		if ( got < 1 ) return { ok: false, reason: 'capacity' };
		this.toast( `${ got } keg${ got > 1 ? 's' : '' } of powder stowed · contraband at home` );
		return { ok: true, qty: got, total: got * this.rules.powder.price };

	}

	buyShot( ctx = {} ) {

		const c = this.canTrade( ctx );
		if ( ! c.ok ) return c;
		const nv = this.naval, mag = nv && nv.ammo;
		if ( ! mag || ! mag.add ) return { ok: false, reason: 'noGuns' };
		if ( ! ( mag.room > 0 ) ) return { ok: false, reason: 'full' };
		const S = this.rules.shot;
		if ( ! this._pay( S.price ) ) return { ok: false, reason: 'money' };
		const added = mag.add( S.rounds );
		this.toast( `Powder and shot x${ added } · $${ S.price }` );
		return { ok: true, qty: added, total: S.price };

	}

	buyFlag( ctx = {} ) {

		const c = this.canTrade( { ...ctx, what: 'flag' } );
		if ( ! c.ok ) return c;
		if ( ctx.flag ) return { ok: false, reason: 'owned' };
		if ( ! this._pay( this.rules.flagPrice ) ) return { ok: false, reason: 'money' };
		this.toast( 'The black flag is yours · the batteries will hold fire while you fly it' );
		return { ok: true, total: this.rules.flagPrice };

	}

	// a chart to the next cache the player has not found (exploration.treasure)
	buyChart( ctx = {} ) {

		const c = this.canTrade( ctx );
		if ( ! c.ok ) return c;
		const ex = this.exploration, tr = ex && ex.treasure;
		const site = tr && Array.isArray( tr.sites ) ? tr.sites.find( ( s ) => ! tr.found.has( s.id ) ) : null;
		if ( ! site ) return { ok: false, reason: 'noChart' };
		if ( ! this._pay( this.rules.chart ) ) return { ok: false, reason: 'money' };
		tr.discover( site.id, 'chart' );
		this.toast( `A treasure chart · ${ site.label || 'a cache' } is marked on your map` );
		return { ok: true, total: this.rules.chart, site: site.id };

	}

	// pirate crew: the characters hired for coin sign on here for less (the crew feature posts them aboard)
	crewFor() {

		const st = this.state;
		return Object.entries( CHARACTERS ).filter( ( [ id, c ] ) => c.unlock && c.unlock.kind === 'buy' && ! ( st && st.isUnlocked && st.isUnlocked( id ) ) )
			.map( ( [ id, c ] ) => ( { id, name: c.name, price: Math.round( c.unlock.cost * this.rules.crewDiscount / 10 ) * 10 } ) );

	}

	hireCrew( id, ctx = {} ) {

		const c = this.canTrade( ctx );
		if ( ! c.ok ) return c;
		const row = this.crewFor().find( ( r ) => r.id === id );
		const st = this.state;
		if ( ! row || ! st || ! st.unlockCharacter ) return { ok: false, reason: 'noCrew' };
		if ( ! this._pay( row.price ) ) return { ok: false, reason: 'money' };
		st.unlockCharacter( id, { free: true } );
		this.toast( `${ row.name } signs on with a pirate's mark · $${ row.price }` );
		return { ok: true, total: row.price, id };

	}

	rows( ctx = {} ) {

		const out = [];
		const trade = this.canTrade( ctx ), flag = this.canTrade( { ...ctx, what: 'flag' } );
		const why = ( c ) => ( c.ok ? null : c.reason );
		const cargo = this.trade && this.trade.cargo ? this.trade.cargo : {};
		for ( const g of contrabandGoods( this.rules ) ) {

			const have = cargo[ g ] ? cargo[ g ].qty : 0;
			out.push( { id: 'sell:' + g, kind: 'sell', good: g, label: `Sell ${ GOODS[ g ].name }`, qty: have, price: buyPrice( g, { cond: cargo[ g ] ? cargo[ g ].cond : 1, standing: ctx.standing || 0 }, this.rules ), ok: trade.ok && have > 0, why: why( trade ) || ( have > 0 ? null : 'empty' ) } );

		}

		out.push( { id: 'buy:powder', kind: 'buy', good: 'powder', label: 'Black powder (keg)', price: this.rules.powder.price, ok: trade.ok, why: why( trade ) } );
		out.push( { id: 'buy:shot', kind: 'buy', label: `Powder and shot x${ this.rules.shot.rounds }`, price: this.rules.shot.price, ok: trade.ok, why: why( trade ) } );
		out.push( { id: 'flag', kind: 'flag', label: 'The black flag', price: this.rules.flagPrice, ok: flag.ok && ! ctx.flag, why: ctx.flag ? 'owned' : why( flag ) } );
		out.push( { id: 'chart', kind: 'chart', label: 'A treasure chart', price: this.rules.chart, ok: trade.ok, why: why( trade ) } );
		for ( const c of this.crewFor() ) out.push( { id: 'crew:' + c.id, kind: 'crew', label: `${ c.name } (pirate crew)`, price: c.price, ok: trade.ok, why: why( trade ) } );
		const st = ctx.stolen;
		if ( st && st.price > 0 ) out.push( { id: 'sellship', kind: 'ship', label: `Sell the stolen ${ st.name } (a skiff thrown in)`, price: st.price, ok: trade.ok, why: why( trade ) } );
		return out;

	}

}
