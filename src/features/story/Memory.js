// What each person remembers of the player (the naval fork's FWorldNpcMemory: disposition, good trades, rescues,
// harbour attacks, pranks, last encounter day; WORLD_TRADE_PIRATES_BRIEF C4: "a record plus ID-keyed reactions").
//
//   { met, talks, gifts, purchases, debt, rescues, pranks, trades, attacks, firstDay, lastDay, disposition (-100..100),
//     notes: { key: string | number } }   notes hold the facts a person brings up (Roid: firstBoat, sinks, bounties...)
//
// Dialogue conditions read it ({ mem: [ 'talks', '>=', 3 ] }, { note: [ 'sinks', '>=', 1 ] }); Story writes it.

// disposition per encounter, from PlayerWorldStateComponent.cpp (good trade +2, rescued +10, prank -3, attack -25)
export const DISPOSITION = { trade: 2, rescue: 10, prank: - 3, attack: - 25, gift: 4, talk: 0.5, debtPaid: 3, debtLate: - 6 };
export const MAX_NOTES = 16;

const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
const COUNTS = [ 'talks', 'gifts', 'purchases', 'rescues', 'pranks', 'trades', 'attacks' ];

export function blankMemory() {

	return { met: false, talks: 0, gifts: 0, purchases: 0, debt: 0, rescues: 0, pranks: 0, trades: 0, attacks: 0, firstDay: - 1, lastDay: - 1, disposition: 0, notes: {} };

}

export function clampDisposition( v ) {

	return Math.max( - 100, Math.min( 100, Math.round( num( v ) * 10 ) / 10 ) );

}

// a record from the save, checked and trimmed (null when it is not one)
export function cleanMemory( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	const m = blankMemory();
	m.met = !! raw.met;
	for ( const k of COUNTS ) m[ k ] = Math.max( 0, Math.min( 1e6, Math.floor( num( raw[ k ] ) ) ) );
	m.debt = Math.max( 0, Math.min( 1e6, Math.round( num( raw.debt ) ) ) );
	m.firstDay = Math.max( - 1, Math.floor( num( raw.firstDay, - 1 ) ) );
	m.lastDay = Math.max( - 1, Math.floor( num( raw.lastDay, - 1 ) ) );
	m.disposition = clampDisposition( raw.disposition );
	if ( raw.notes && typeof raw.notes === 'object' ) {

		for ( const [ k, v ] of Object.entries( raw.notes ).slice( 0, MAX_NOTES ) ) {

			if ( k.length > 24 ) continue;
			if ( typeof v === 'number' && Number.isFinite( v ) ) m.notes[ k ] = v;
			else if ( typeof v === 'string' ) m.notes[ k ] = v.slice( 0, 60 );

		}

	}

	return m;

}

// a word for how someone feels about the player (the dialogue panel's subtitle)
export function moodWord( d ) {

	const v = num( d );
	return v <= - 40 ? 'hostile' : v <= - 10 ? 'wary' : v < 10 ? 'neutral' : v < 30 ? 'friendly' : v < 60 ? 'warm' : 'devoted';

}
