// Powder and shot (wave 11A, Unreal parity V3): a finite stock aboard every hull, pure logic (test/feature-shipdamage.mjs).
//
//   AMMO_MAX[ boatId ]        rounds a hull's magazine holds (skiff / canoe 8: a swivel gun can be mounted, cutter 12, launch 12, lobster 16, trawler 24,
//                             sloop 40, brigantine 60); ammoMaxFor( id ) reads Boats.js `ammo` first, unknown hulls 12;
//                             every hull carries at least AMMO_MIN (8)
//   SHIP_AMMO[ classId ]      the AI ships' own stock (ShipClasses: trawler 0, sloop 24, brigantine 36)
//   AMMO_PACK                 { rounds: 12, price: 60 }  Captain Roid's "Powder and shot x12, $60"
//   POWDER_KEG                24 rounds from one 'powder' keg out of the trade hold (trade.takeCargo( 'powder', 1 ))
//   const mag = new Magazine( max, rounds = max )
//   mag.spend( n ) -> rounds actually spent (every gun fired spends one; the crew's gunners spend the same stock)
//   mag.add( n ) -> added      mag.fill() -> added      mag.setMax( max, { fill } )      mag.empty / room
//   shotQuote( mag ) -> { rounds, price } the next pack (a part pack when the magazine is nearly full, priced pro rata)
//   buyShot( mag, { state, free } ) -> { ok, added, price, reason: 'full' | 'money' | 'none' }
//
// A new hull comes with her magazine full (her first load is in the price); after that it is bought at the yard, broken
// out of a powder keg in the hold, or (sandbox: free but still finite) refilled when she lies moored at the ramp.

import { BOATS } from '../../game/Boats.js';

export const AMMO_MAX = { skiff: 8, canoe: 8, cutter: 12, launch: 12, lobster: 16, trawler: 24, sloop: 40, brigantine: 60 };
export const AMMO_MIN = 8; // (coordinator's correction: every hull that can mount a gun carries some shot)
export const SHIP_AMMO = { trawler: 0, sloop: 24, brigantine: 36 };
export const AMMO_PACK = { rounds: 12, price: 60, label: 'Powder and shot x12' };
export const POWDER_KEG = 24;
export const OUT_OF_SHOT = 'Out of shot';

export function ammoMaxFor( boatId ) {

	const b = BOATS[ boatId ];
	if ( b && Number.isFinite( b.ammo ) ) return Math.max( AMMO_MIN, Math.round( b.ammo ) );
	if ( Object.prototype.hasOwnProperty.call( AMMO_MAX, boatId ) ) return Math.max( AMMO_MIN, AMMO_MAX[ boatId ] );
	return b ? 12 : 0;

}

export class Magazine {

	constructor( max = 0, rounds = max ) {

		this.max = Math.max( 0, Math.round( max ) || 0 );
		this.rounds = Math.max( 0, Math.min( this.max, Math.round( rounds ) || 0 ) );

	}

	get empty() {

		return this.rounds <= 0;

	}

	get room() {

		return Math.max( 0, this.max - this.rounds );

	}

	spend( n = 1 ) {

		const k = Math.max( 0, Math.min( this.rounds, Math.floor( n ) ) );
		this.rounds -= k;
		return k;

	}

	add( n ) {

		const k = Math.max( 0, Math.min( this.room, Math.floor( n ) || 0 ) );
		this.rounds += k;
		return k;

	}

	fill() {

		return this.add( this.room );

	}

	setMax( max, { fill = false } = {} ) {

		this.max = Math.max( 0, Math.round( max ) || 0 );
		this.rounds = fill ? this.max : Math.min( this.rounds, this.max );

	}

	toJSON() {

		return this.rounds;

	}

}

// the next pack of shot: a whole one, or what still fits (priced pro rata) when the magazine is nearly full
export function shotQuote( mag ) {

	const rounds = Math.min( AMMO_PACK.rounds, mag.room );
	return { rounds, price: rounds > 0 ? Math.ceil( AMMO_PACK.price * rounds / AMMO_PACK.rounds ) : 0 };

}

export function buyShot( mag, { state = null, free = false } = {} ) {

	if ( mag.max <= 0 ) return { ok: false, added: 0, price: 0, reason: 'none' };
	const q = shotQuote( mag );
	if ( q.rounds <= 0 ) return { ok: false, added: 0, price: 0, reason: 'full' };
	const price = free ? 0 : q.price;
	if ( price > 0 && state && typeof state.spend === 'function' && ! state.spend( price ) ) return { ok: false, added: 0, price, reason: 'money' };
	return { ok: true, added: mag.add( q.rounds ), price, reason: null };

}
