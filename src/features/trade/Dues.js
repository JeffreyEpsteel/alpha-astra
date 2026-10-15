import { GOODS, PORTS, HOLD_CRATES, identity } from './goods.js';
import { num } from './market.js';

// The harbourmaster's money (wave 15B): harbour dues on every docking and cargo insurance.
//
// Dues: charged once per arrival at a port by boat (a change of port: trade.arrive( port ), which trade.update calls
// when the player comes within DUES.arrive m of a dock, and trade.visit when a market opens). The fee scales with the
// hull (the boat's hold in crates) and the port (PORT_IDENTITY fee: Tidemark's big harbour 1.5x, the islets less).
// Waived at home, for a port that loves you (story / state reputation >= DUES.belovedRep) and in the sandbox. A fee
// the purse cannot pay becomes a small debt at that port (trade.credit.debt).
//
// Insurance: one policy at a time, bought at any market for INSURANCE.rate of the cargo's cost (lower with merchant
// standing), good for INSURANCE.hours. It pays INSURANCE.payout of the cost of what pirates take (boardersWon) or what
// goes down with the boat (playerBoatSunk), up to the insured value; a claim ends the policy.
//
//   dues.fee( port ) -> { fee, waived: null | 'home' | 'beloved' | 'sandbox' | 'foot' }
//   dues.arrive( port ) -> { port, fee, waived } | null (null: no change of port)
//   dues.quote() -> { value, premium, hours, active }      dues.insure() -> { ok, premium, value, until | reason, message }
//   dues.claim( kind, goods? ) -> payout                    dues.noteTaken( good, qty, cost ) (trade.takeCargo does it)
//
// Events: harbourDues { port, fee, waived }, insuranceBought { value, premium, until }, insuranceClaim { kind, payout }.

export const DUES = {
	base: 3, // $ a docking ...
	perCrate: 0.75, // ... plus this per crate of hold (a skiff ~$6, a trawler ~$25, a brigantine ~$36 at a plain port)
	belovedRep: 40, // story priceMod is 0.9 from here: the port waives your dues
	arrive: 45, // m from a dock: arrived
};

export const INSURANCE = {
	rate: 0.06, // of the insured cost
	rateGood: 0.035, // at merchant standing >= goodStanding
	goodStanding: 50,
	hours: 48,
	payout: 0.8,
	minValue: 40,
};

const r2 = ( v ) => Math.round( v * 100 ) / 100;

export class Dues {

	constructor( trade ) {

		this.trade = trade;
		this.reset();

	}

	reset() {

		this.last = null; // the port the boat last docked at
		this.paid = 0; // $ of dues paid
		this.waived = 0; // dockings waived
		this.policy = null; // { value, premium, start, until }
		this.premiums = 0;
		this.claimed = 0;
		this._taken = []; // [ { good, qty, cost, t } ] cargo taken out of the hold lately (for a piracy claim)

	}

	get state() {

		return this.trade.state;

	}

	_emit( name, payload ) {

		const f = this.trade.features;
		if ( f && f.emit ) f.emit( name, payload );

	}

	// reputation as the story counts it (grudges included), else the state's
	_rep( port ) {

		const st = this.trade._feature( 'story' );
		try { if ( st && st.rep ) return num( st.rep( port ) ); } catch ( e ) { /* the state's */ }
		const s = this.state;
		return s && s.rep && Number.isFinite( s.rep[ port ] ) ? s.rep[ port ] : 0;

	}

	fee( port ) {

		const s = this.state;
		const boat = s && s.boat ? s.boat : null;
		if ( ! PORTS[ port ] ) return { fee: 0, waived: 'unknown' };
		if ( ! boat ) return { fee: 0, waived: 'foot' };
		if ( port === 'home' ) return { fee: 0, waived: 'home' };
		if ( s && s.free ) return { fee: 0, waived: 'sandbox' };
		if ( this._rep( port ) >= DUES.belovedRep ) return { fee: 0, waived: 'beloved' };
		const crates = HOLD_CRATES[ boat ] != null ? HOLD_CRATES[ boat ] : 8;
		const scale = num( identity( port ).fee, 1, 0, 5 );
		return { fee: Math.max( 1, Math.round( ( DUES.base + DUES.perCrate * crates ) * scale ) ), waived: null };

	}

	// the boat came in at `port`: dues when it is a new port (once per arrival)
	arrive( port ) {

		if ( ! PORTS[ port ] || port === this.last ) return null;
		const s = this.state;
		if ( ! s || ! s.boat ) return null; // on foot (a swim, a seaplane): no docking, and the last port stays
		this.last = port;
		const f = this.fee( port );
		if ( f.waived ) {

			if ( f.waived === 'beloved' ) this.waived ++;
			this._emit( 'harbourDues', { port, fee: 0, waived: f.waived } );
			return { port, fee: 0, waived: f.waived };

		}

		if ( s.spend && s.spend( f.fee ) ) {

			this.paid += f.fee;
			this.trade.ledger.cost( 'dues', f.fee );
			this.trade._toast( `${ PORTS[ port ].name } harbour dues: $${ f.fee }` );

		} else if ( this.trade.credit ) {

			this.trade.credit.debt( port, f.fee, 'harbour dues' );
			this.trade._note( `You could not pay the ${ PORTS[ port ].name } harbour dues: $${ f.fee } owed there.`, 'cargo' );

		}

		this._emit( 'harbourDues', { port, fee: f.fee, waived: null } );
		return { port, fee: f.fee, waived: null };

	}

	// ---- insurance

	_value() {

		let v = 0;
		for ( const l of this.trade.lots ) v += l.paid;
		return r2( v );

	}

	rate() {

		const st = this.trade.credit ? this.trade.credit.standing : 0;
		return st >= INSURANCE.goodStanding ? INSURANCE.rateGood : INSURANCE.rate;

	}

	active() {

		return !! ( this.policy && this.trade.sim.abs < this.policy.until );

	}

	quote() {

		const value = this._value();
		const s = this.state;
		return { value, premium: s && s.free ? 0 : Math.ceil( value * this.rate() ), rate: this.rate(), hours: INSURANCE.hours, active: this.active(), policy: this.policy ? { ...this.policy, left: Math.max( 0, this.policy.until - this.trade.sim.abs ) } : null };

	}

	insure() {

		const q = this.quote();
		if ( q.value < INSURANCE.minValue ) return { ok: false, reason: 'value', message: `Nothing worth insuring aboard (the underwriter wants $${ INSURANCE.minValue } of cargo).` };
		const s = this.state;
		if ( q.premium > 0 && s && s.spend && ! s.spend( q.premium ) ) return { ok: false, reason: 'money', message: `The premium is $${ q.premium }.` };
		const now = this.trade.sim.abs;
		this.policy = { value: q.value, premium: q.premium, start: r2( now ), until: r2( now + INSURANCE.hours ) };
		this.premiums += q.premium;
		if ( q.premium > 0 ) this.trade.ledger.cost( 'insurance', q.premium );
		this._emit( 'insuranceBought', { value: q.value, premium: q.premium, until: this.policy.until } );
		return { ok: true, premium: q.premium, value: q.value, until: this.policy.until };

	}

	noteTaken( good, qty, cost ) {

		const now = this.trade.sim.abs;
		this._taken = this._taken.filter( ( t ) => now - t.t < 0.5 );
		if ( qty > 0 ) this._taken.push( { good, qty, cost: num( cost ), t: now } );

	}

	// kind 'piracy': goods = [ { good, qty } ] just taken; kind 'sunk': the whole hold. Returns the money paid.
	claim( kind, goods = null ) {

		if ( ! this.active() ) return 0;
		let cost = 0;
		if ( kind === 'piracy' ) {

			for ( const g of Array.isArray( goods ) ? goods : [] ) {

				const t = this._taken.find( ( x ) => x.good === g.good );
				if ( t ) cost += t.cost;
				else if ( GOODS[ g.good ] ) cost += GOODS[ g.good ].base * num( g.qty, 0, 0, 1e4 ) * 0.6; // taken some other way: the usual price

			}

			this._taken = [];

		} else cost = this._value();
		const payout = Math.floor( Math.min( this.policy.value, cost ) * INSURANCE.payout );
		if ( payout < 1 ) return 0;
		const s = this.state;
		if ( s && s.earn && ! s.free ) s.earn( payout );
		this.claimed += payout;
		this.policy = null;
		this.trade.ledger.cost( 'insurance', - payout );
		this._emit( 'insuranceClaim', { kind, payout } );
		this.trade._note( `The underwriter paid $${ payout } for the ${ kind === 'piracy' ? 'cargo the pirates took' : 'cargo lost with the boat' }.`, 'cargo' );
		return payout;

	}

	advance() {

		if ( this.policy && this.trade.sim.abs >= this.policy.until ) this.policy = null;

	}

	view() {

		const s = this.state;
		const here = this.trade.openPort || this.trade.lastPort || 'home';
		return { sandbox: !! ( s && s.free ), last: this.last, paid: this.paid, waivedCount: this.waived, feeHere: this.fee( here ), insurance: this.quote(), premiums: this.premiums, claimed: this.claimed };

	}

	toJSON() {

		return { last: this.last, paid: this.paid, waived: this.waived, policy: this.policy ? { ...this.policy } : null, premiums: this.premiums, claimed: this.claimed };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this.last = PORTS[ d.last ] ? d.last : null;
		this.paid = num( d.paid, 0, 0, 1e9 );
		this.waived = num( d.waived, 0, 0, 1e9 ) | 0;
		this.premiums = num( d.premiums, 0, 0, 1e9 );
		this.claimed = num( d.claimed, 0, 0, 1e9 );
		const p = d.policy;
		if ( p && typeof p === 'object' && num( p.value ) > 0 ) this.policy = { value: num( p.value, 0, 0, 1e9 ), premium: num( p.premium, 0, 0, 1e9 ), start: num( p.start, 0 ), until: num( p.until, 0 ) };

	}

}
