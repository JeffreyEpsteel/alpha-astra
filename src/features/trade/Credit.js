import { PORTS } from './goods.js';
import { clamp, num } from './market.js';

// Merchant credit and the merchant standing (docs/UNREAL_PARITY.md E6 and the merchant axis of E11).
//
// Standing (0..100, starts at 10) is what the harbours think of you as a trader: profitable sales, delivered
// contracts and repaid loans raise it; defaults, failed contracts and customs seizures cut it. It narrows the stalls'
// spread above 20 (trade.sim.spreadMul), lowers the interest and raises the credit limit, makes customs less
// suspicious and gates the master freight licence and the turbo diesel (Gear.js req.standing).
//
// Each port's money-lender lends against your standing and your reputation there. A loan accrues interest per
// in-game day (continuously), is due after `days` days and is repaid at the port that lent it. Overdue: the rate
// doubles and standing drops; two days past due it defaults: standing drops hard, that port refuses to sell to you
// until it is paid, and the harbourmaster takes what you carry in your purse each time you visit.
//
//   credit.standing / credit.adjust( n, why )
//   credit.limit( port ) / credit.rate( port )          what may still be borrowed there, interest per day
//   credit.take( port, amount, days ) -> { ok, loan | reason, message }
//   credit.repay( port, amount | 'all' ) -> { ok, paid, cleared, reason? }
//   credit.debt( port, amount, why )                    a forced loan (a customs fine you could not pay)
//   credit.owed( port? ) / credit.loans / credit.blocked( port )
//   credit.advance( hours ) (trade.advance does it) / credit.visit( port ) (trade.visit does it)
//
// Events: loanTaken { id, port, amount, due, rate }, loanRepaid { id, port, amount, cleared }, loanOverdue { id, port,
// owed }, loanDefaulted { id, port, owed }, debtCollected { port, amount }, merchantStanding { standing, delta, why }.
// Sandbox: no lender is needed (take refuses with 'sandbox'); standing still moves.

export const CREDIT = {
	startStanding: 10,
	baseLimit: 300, perStanding: 40, perRep: 10, // a lender's limit: 300 + 40 x standing + 10 x reputation there
	rateHigh: 0.06, rateLow: 0.02, // interest per in-game day at standing 0 / 100
	days: [ 1, 2, 3, 5 ], // terms on offer
	grace: 48, // hours past due before the loan defaults
	minLoan: 50,
};

const r2 = ( v ) => Math.round( v * 100 ) / 100;

export class Credit {

	constructor( trade ) {

		this.trade = trade;
		this.reset();

	}

	reset() {

		this.standing = CREDIT.startStanding;
		this.loans = []; // { id, port, principal, owed, rate, taken, due, status: 'open' | 'overdue' | 'defaulted', why }
		this.nextId = 1;

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

	adjust( n, why = '' ) {

		const before = this.standing;
		this.standing = r2( clamp( this.standing + num( n ), 0, 100 ) );
		const delta = r2( this.standing - before );
		if ( delta !== 0 ) this._emit( 'merchantStanding', { standing: this.standing, delta, why } );
		return this.standing;

	}

	// the spread factor the stalls give a trader of this standing: 1 up to 20, 0.7 at 100
	spreadMul() {

		return 1 - Math.max( 0, this.standing - 20 ) / 80 * 0.3;

	}

	rep( port ) {

		const s = this.state;
		return s && s.rep && Number.isFinite( s.rep[ port ] ) ? s.rep[ port ] : 0;

	}

	rate( port ) {

		const k = clamp( this.standing / 100 + this.rep( port ) / 400, 0, 1 );
		return r2( ( CREDIT.rateHigh + ( CREDIT.rateLow - CREDIT.rateHigh ) * k ) * 10000 ) / 10000;

	}

	owed( port = null ) {

		let n = 0;
		for ( const l of this.loans ) if ( ! port || l.port === port ) n += l.owed;
		return r2( n );

	}

	limit( port ) {

		if ( ! PORTS[ port ] ) return 0;
		if ( this.blocked( port ) ) return 0;
		const cap = CREDIT.baseLimit + CREDIT.perStanding * this.standing + CREDIT.perRep * this.rep( port );
		return Math.max( 0, Math.floor( cap - this.owed( port ) ) );

	}

	// a port whose loan defaulted refuses to sell to you until it is paid
	blocked( port ) {

		return this.loans.some( ( l ) => l.port === port && l.status === 'defaulted' );

	}

	_addMoney( n ) {

		const s = this.state;
		if ( ! s || s.free ) return;
		// borrowed money is not earnings: straight into the purse, not through earn() (career stats)
		s.money = Math.round( ( num( s.money ) + n ) * 100 ) / 100;
		if ( s.save ) s.save();
		if ( s.emit ) s.emit();

	}

	take( port, amount, days = 3 ) {

		const s = this.state;
		if ( ! PORTS[ port ] ) return { ok: false, reason: 'unknown', message: 'No lender here.' };
		if ( s && s.free ) return { ok: false, reason: 'sandbox', message: 'Sandbox: nobody needs a loan.' };
		amount = Math.floor( num( Number( amount ) ) );
		days = CREDIT.days.includes( days ) ? days : 3;
		if ( amount < CREDIT.minLoan ) return { ok: false, reason: 'amount', message: `The lender does not bother with less than $${ CREDIT.minLoan }.` };
		const lim = this.limit( port );
		if ( this.blocked( port ) ) return { ok: false, reason: 'blocked', message: 'You defaulted here: pay that first.' };
		if ( amount > lim ) return { ok: false, reason: 'limit', message: `Your credit at ${ PORTS[ port ].name } is $${ lim }.` };
		const loan = { id: this.nextId ++, port, principal: amount, owed: amount, rate: this.rate( port ), taken: this.now, due: this.now + days * 24, status: 'open', why: 'loan' };
		this.loans.push( loan );
		this._addMoney( amount );
		this._emit( 'loanTaken', { id: loan.id, port, amount, due: loan.due, rate: loan.rate } );
		return { ok: true, loan: { ...loan } };

	}

	// a forced debt (a fine you could not pay): due in two days at the usual rate, no limit
	debt( port, amount, why = 'fine' ) {

		amount = Math.max( 0, Math.round( num( amount ) ) );
		if ( amount < 1 || ! PORTS[ port ] ) return null;
		const loan = { id: this.nextId ++, port, principal: amount, owed: amount, rate: this.rate( port ), taken: this.now, due: this.now + 48, status: 'open', why };
		this.loans.push( loan );
		this._emit( 'loanTaken', { id: loan.id, port, amount, due: loan.due, rate: loan.rate, forced: true, why } );
		return { ...loan };

	}

	repay( port, amount = 'all' ) {

		const s = this.state;
		const mine = this.loans.filter( ( l ) => l.port === port );
		if ( ! mine.length ) return { ok: false, reason: 'none', message: 'You owe nothing here.', paid: 0 };
		const purse = ! s ? Infinity : s.free ? Infinity : num( s.money );
		let want = amount === 'all' ? this.owed( port ) : num( Number( amount ) );
		want = Math.min( want, this.owed( port ) );
		let pay = Math.ceil( want - 1e-9 );
		if ( pay > purse ) pay = Math.floor( purse );
		if ( pay < 1 ) return { ok: false, reason: 'money', message: 'Not enough money.', paid: 0 };
		if ( s && s.spend && ! s.spend( pay ) ) return { ok: false, reason: 'money', message: 'Not enough money.', paid: 0 };
		const paid = this._apply( port, pay );
		return { ok: true, paid, cleared: ! this.loans.some( ( l ) => l.port === port ) };

	}

	// pay `amount` into the oldest loans of a port first; returns the money applied
	_apply( port, amount ) {

		let left = amount, paid = 0;
		for ( const l of this.loans.filter( ( x ) => x.port === port ).sort( ( a, b ) => a.due - b.due ) ) {

			if ( left <= 0 ) break;
			const m = Math.min( l.owed, left );
			l.owed = r2( l.owed - m );
			left -= m;
			paid += m;
			if ( l.owed <= 0.009 ) {

				// on time it earns standing; a late payment only stops the bleeding
				if ( l.status === 'open' && l.why === 'loan' ) this.adjust( 3 + Math.min( 4, l.principal / 400 ), 'loan repaid' );
				l.owed = 0;
				this._emit( 'loanRepaid', { id: l.id, port, amount: r2( m ), cleared: true } );

			} else this._emit( 'loanRepaid', { id: l.id, port, amount: r2( m ), cleared: false } );

		}

		this.loans = this.loans.filter( ( l ) => l.owed > 0 );
		return r2( paid );

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		const now = this.now;
		for ( const l of this.loans ) {

			const rate = l.status === 'open' ? l.rate : l.rate * 2;
			l.owed = r2( l.owed * Math.exp( rate * hours / 24 ) );
			if ( l.status === 'open' && now > l.due ) {

				l.status = 'overdue';
				this.adjust( - 6, 'loan overdue' );
				this._emit( 'loanOverdue', { id: l.id, port: l.port, owed: l.owed } );
				this.trade._note( `Your loan at ${ PORTS[ l.port ].name } is overdue: $${ Math.ceil( l.owed ) }.`, 'cargo' );

			}

			if ( l.status === 'overdue' && now > l.due + CREDIT.grace ) {

				l.status = 'defaulted';
				this.adjust( - 15, 'loan defaulted' );
				this._emit( 'loanDefaulted', { id: l.id, port: l.port, owed: l.owed } );
				this.trade._note( `You defaulted at ${ PORTS[ l.port ].name }: the market there will not sell to you until you pay.`, 'cargo' );

			}

		}

	}

	// at a port with a defaulted loan the harbourmaster takes what your purse holds toward it
	visit( port ) {

		const s = this.state;
		if ( ! s || s.free || ! this.blocked( port ) ) return 0;
		const take = Math.min( Math.floor( num( s.money ) ), Math.ceil( this.owed( port ) ) );
		if ( take < 1 || ! s.spend( take ) ) return 0;
		const paid = this._apply( port, take );
		this._emit( 'debtCollected', { port, amount: paid } );
		this.trade._note( `The ${ PORTS[ port ].name } harbourmaster collected $${ Math.round( paid ) } of your debt.`, 'cargo' );
		return paid;

	}

	view( port ) {

		const s = this.state;
		return {
			standing: this.standing, sandbox: !! ( s && s.free ), port, limit: this.limit( port ), rate: this.rate( port ), owedHere: this.owed( port ), owed: this.owed(),
			blocked: this.blocked( port ), days: CREDIT.days.slice(),
			loans: this.loans.map( ( l ) => ( { ...l, name: PORTS[ l.port ] ? PORTS[ l.port ].name : l.port, left: l.due - this.now } ) ),
		};

	}

	toJSON() {

		return { standing: this.standing, next: this.nextId, loans: this.loans.map( ( l ) => ( { ...l } ) ) };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this.standing = clamp( num( d.standing, CREDIT.startStanding ), 0, 100 );
		this.nextId = Math.max( 1, num( d.next, 1, 1, 1e9 ) | 0 );
		for ( const l of Array.isArray( d.loans ) ? d.loans : [] ) {

			if ( ! l || ! PORTS[ l.port ] ) continue;
			const owed = num( l.owed, 0, 0, 1e9 );
			if ( owed <= 0 ) continue;
			this.loans.push( {
				id: num( l.id, this.nextId ++, 1, 1e9 ) | 0, port: l.port, principal: num( l.principal, owed, 0, 1e9 ), owed, rate: num( l.rate, CREDIT.rateHigh, 0, 0.5 ),
				taken: num( l.taken, 0 ), due: num( l.due, 0 ), status: [ 'open', 'overdue', 'defaulted' ].includes( l.status ) ? l.status : 'open', why: String( l.why || 'loan' ).slice( 0, 24 ),
			} );

		}

	}

}
