import { BAIT_TUB } from '../../game/Chandlery.js';
import { clamp, num } from './market.js';

// Operating costs (docs/UNREAL_PARITY.md E9; diesel and hull repairs already live in GameState and naval, ammo is
// WP-C): bait for the hook, the crew's wages and the boat's upkeep (mooring, caulking, paint). A campaign skipper
// has to keep earning to keep sailing; the sandbox pays nothing.
//
// Bait: every cast takes one (Game calls operating.useBait() when a bite wait starts; it returns the bite delay
// factor). With none left the hook goes out bare and bites come much slower, so fishing stays possible but costly in
// time. Bought at Ethena's bait tub beside the chandlery (an E interactable) and at any market's Costs tab.
//
// Wages and upkeep are counted in in-game days (24 h of trade.advance) and paid from the purse at the day's turn.
// Wages unpaid pile up as owed pay; three days of it and the crew walks off the ship (speedFactor() drops until
// the arrears are paid, which happens by itself the next time the purse allows, or from the panel).
//
//   operating.bait / buyBait( n ) / useBait() -> delay factor (1 with bait, BAIT.bareFactor without)
//   operating.wagesPerDay() / upkeepPerDay() / owed / payOwed()
//   operating.speedFactor()            1, or OPERATING.desertedSpeed while the crew is gone (Game multiplies maxThrust)
//   operating.advance( hours )         trade.advance does it
//
// Events: baitBought { qty, total }, baitOut {}, wagesPaid { amount, upkeep, day }, wagesMissed { owed, days },
// crewDeserted { owed }, crewReturned {}.

export const BAIT = {
	start: 20, // a new campaign starts with a tin
	tin: 10, // units in a tin
	tinPrice: 12,
	max: 200,
	bareFactor: 1.8, // bite delays with a bare hook
};

// crew (wage-earners beyond the skipper) and the daily rate; upkeep is a share of the boat's price per day
export const CREW = { skiff: 0, canoe: 0, cutter: 0, launch: 1, lobster: 1, trawler: 3, sloop: 4, brigantine: 7 };
// wave 15B: tuned so a ship's running costs are a real share of a good day's trading (a trawler about $90 a day, a
// brigantine about $220; a launch about $24) while a skiff or a cutter stays nearly free to run
export const OPERATING = {
	wage: 16, // $ per crew member per in-game day
	upkeep: 0.0018, // of the boat's price per day
	desertDays: 3, // days of unpaid wages before the crew walks off
	desertedSpeed: 0.6,
};

const r2 = ( v ) => Math.round( v * 100 ) / 100;

export class Operating {

	constructor( trade ) {

		this.trade = trade;
		this.reset();

	}

	reset() {

		this.bait = BAIT.start;
		this.owed = 0;
		this.missedDays = 0;
		this.deserted = false;
		this.hours = 0; // toward the next day's bill
		this.paidDays = 0;
		this.spent = { bait: 0, wages: 0, upkeep: 0 };
		this._warnedBait = false;

	}

	get state() {

		return this.trade.state;

	}

	get free() {

		const s = this.state;
		return !! ( s && s.free );

	}

	_emit( name, payload ) {

		const f = this.trade.features;
		if ( f && f.emit ) f.emit( name, payload );

	}

	boatInfo() {

		const s = this.state;
		const id = s && s.boat ? s.boat : null;
		const B = this.trade.boats ? this.trade.boats[ id ] : null;
		return { id, price: B && Number.isFinite( B.price ) ? B.price : 0, crew: id && CREW[ id ] != null ? CREW[ id ] : 0 };

	}

	wagesPerDay() {

		if ( this.free ) return 0;
		let crew = this.boatInfo().crew;
		// wave 13: "Hold the line" waives the posted gunners' wages
		const story = this.trade && this.trade._feature ? this.trade._feature( 'story' ) : null;
		if ( story && story.perk && story.perk( 'gunnerFee' ) > 0 ) {

			const c = this.trade._feature( 'crew' ), posts = c && c.posts ? c.posts : {};
			const gunners = Object.values( posts ).filter( ( p ) => p === 'gunner' ).length;
			crew = Math.max( 0, crew - gunners );

		}
		// wave 19C: the hands signed on at the taverns draw their own wages
		const cw = this.trade && this.trade._feature ? this.trade._feature( 'crew' ) : null;
		return crew * OPERATING.wage + ( cw && typeof cw.wagesPerDay === 'function' ? cw.wagesPerDay() : 0 );

	}

	upkeepPerDay() {

		return this.free ? 0 : Math.round( this.boatInfo().price * OPERATING.upkeep );

	}

	speedFactor() {

		return this.deserted && this.boatInfo().crew > 0 ? OPERATING.desertedSpeed : 1;

	}

	buyBait( n = BAIT.tin ) {

		n = Math.floor( num( Number( n ) ) );
		if ( n < 1 ) return { ok: false, reason: 'qty', message: 'Choose a quantity.' };
		n = Math.min( n, BAIT.max - this.bait );
		if ( n < 1 ) return { ok: false, reason: 'full', message: 'The bait box is full.' };
		const total = Math.ceil( n * BAIT.tinPrice / BAIT.tin - 1e-9 );
		const s = this.state;
		if ( s && s.spend && ! s.spend( total ) ) return { ok: false, reason: 'money', message: 'Not enough money.' };
		this.bait += n;
		this._warnedBait = false;
		if ( ! this.free ) this.spent.bait += total;
		this._emit( 'baitBought', { qty: n, total: this.free ? 0 : total } );
		return { ok: true, qty: n, total };

	}

	// one cast: takes a bait when there is one; returns the factor on the bite delay
	useBait() {

		if ( this.free ) return 1;
		if ( this.bait > 0 ) {

			this.bait --;
			if ( this.bait === 0 ) {

				this._emit( 'baitOut', {} );
				this.trade._note( 'Out of bait: the hook goes out bare and bites come slowly. Ethena sells bait by the chandlery.', 'cargo' );

			} else if ( this.bait === 5 && ! this._warnedBait ) {

				this._warnedBait = true;
				this.trade._toast( 'Five baits left.' );

			}

			return 1;

		}

		return BAIT.bareFactor;

	}

	payOwed() {

		const s = this.state;
		if ( this.owed <= 0 ) return { ok: false, reason: 'none', message: 'Nobody is owed anything.' };
		const pay = Math.ceil( this.owed - 1e-9 );
		if ( s && s.spend && ! s.spend( pay ) ) return { ok: false, reason: 'money', message: `The crew is owed $${ pay }.` };
		this.spent.wages += pay;
		this.owed = 0;
		this.missedDays = 0;
		if ( this.deserted ) {

			this.deserted = false;
			this._emit( 'crewReturned', {} );
			this.trade._note( 'Paid in full: the crew is back aboard.', 'cargo' );

		}

		return { ok: true, paid: pay };

	}

	// a day's bill: upkeep first (the yard will not wait), then the wages and anything owed
	_day() {

		this.paidDays ++;
		if ( this.free ) return;
		const s = this.state;
		const upkeep = this.upkeepPerDay(), wages = this.wagesPerDay();
		if ( upkeep > 0 && s && s.spend ) {

			if ( s.spend( upkeep ) ) this.spent.upkeep += upkeep;
			else {

				// the yard takes what there is and books the rest as owed with the crew's pay
				this.owed += upkeep;

			}

		}

		const due = wages + this.owed;
		if ( due <= 0 ) return;
		if ( s && s.spend && s.spend( Math.ceil( due - 1e-9 ) ) ) {

			this.spent.wages += Math.ceil( due - 1e-9 );
			this._emit( 'wagesPaid', { amount: Math.ceil( due - 1e-9 ), upkeep, day: this.paidDays } );
			this.owed = 0;
			this.missedDays = 0;
			if ( this.deserted ) {

				this.deserted = false;
				this._emit( 'crewReturned', {} );

			}

			return;

		}

		this.owed = r2( this.owed + wages );
		if ( wages > 0 ) this.missedDays ++;
		this._emit( 'wagesMissed', { owed: this.owed, days: this.missedDays } );
		this.trade._note( `You could not pay the day's costs: $${ Math.ceil( this.owed ) } owed.`, 'cargo' );
		if ( ! this.deserted && this.missedDays >= OPERATING.desertDays && this.boatInfo().crew > 0 ) {

			this.deserted = true;
			this._emit( 'crewDeserted', { owed: this.owed } );
			this.trade._note( 'Three days unpaid: the crew walked off. The ship sails short-handed until you pay them.', 'cargo' );

		}

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		this.hours += hours;
		let guard = 0;
		while ( this.hours >= 24 && guard ++ < 60 ) {

			this.hours -= 24;
			this._day();

		}

	}

	view() {

		const b = this.boatInfo();
		return {
			sandbox: this.free, bait: this.bait, baitMax: BAIT.max, tin: BAIT.tin, tinPrice: this.free ? 0 : BAIT.tinPrice,
			boat: b.id, crew: b.crew, wages: this.wagesPerDay(), upkeep: this.upkeepPerDay(), owed: this.owed, missedDays: this.missedDays, deserted: this.deserted,
			nextBillIn: Math.max( 0, 24 - this.hours ), spent: { ...this.spent },
		};

	}

	toJSON() {

		return { bait: this.bait, owed: r2( this.owed ), missed: this.missedDays, deserted: this.deserted ? 1 : 0, hours: r2( this.hours ), days: this.paidDays, spent: { bait: this.spent.bait, wages: this.spent.wages, upkeep: this.spent.upkeep } };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this.bait = clamp( num( d.bait, BAIT.start ) | 0, 0, BAIT.max );
		this.owed = num( d.owed, 0, 0, 1e7 );
		this.missedDays = num( d.missed, 0, 0, 1e4 ) | 0;
		this.deserted = d.deserted === 1 || d.deserted === true;
		this.hours = num( d.hours, 0, 0, 24 );
		this.paidDays = num( d.days, 0, 0, 1e7 ) | 0;
		const sp = d.spent && typeof d.spent === 'object' ? d.spent : {};
		this.spent = { bait: num( sp.bait, 0, 0, 1e9 ), wages: num( sp.wages, 0, 0, 1e9 ), upkeep: num( sp.upkeep, 0, 0, 1e9 ) };

	}

}

export { BAIT_TUB };
