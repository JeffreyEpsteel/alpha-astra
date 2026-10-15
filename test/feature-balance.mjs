// Plain-node balance pass (wave 20C): earnings per real hour by activity (fishing, trade runs, notice bounties, navy bounties and
// convoys, hijack fencing, haul contracts) at early / mid / late game from the game's own constants (src/features/story/Balance.js),
// the trade boards and haul offers measured on a seeded headless market, wages (the boat's crew, upkeep, tavern hands) against
// income, and the prices of the 18D arsenal and the navy chandler in minutes of income. Writes docs/briefs/w20-balance-table.md.
// Invariants: no activity over 3x its stage's median; mid-game wages under 40 % of the mid-game median income. They are checked on
// the constants as they stand (the outliers are reported) and with the proposed patches (Balance.PROPOSED), which must hold.
//   node test/feature-balance.mjs            (--no-write: do not rewrite the doc)
import { writeFileSync } from 'node:fs';
import * as tradeModule from '../src/features/trade/index.js';
import { install as installTrade } from '../src/features/trade/index.js';
import { board } from '../src/features/trade/routes.js';
import { PORTS } from '../src/features/trade/goods.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { table, invariants, markdown, PROPOSED, STAGES, STAGE_IDS, MEDIAN_MAX, WAGE_SHARE, median, fishingPerHour, legGain } from '../src/features/story/Balance.js';
import { FENCE } from '../src/features/hijack/Fence.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );

// a seeded market, nothing happening on it: the boards and the haul offers a captain would see on day one
function measure() {

	const st = new GameState( memStorage() );
	st.money = 100000;
	st.boat = 'lobster';
	const app = { settings: { timeOfDay: 9.5 }, game: { state: st }, player: { mode: 'walk', position: { x: 0, y: 2, z: 0 } } };
	const f = new Features( app );
	const trade = installTrade( app, f, { noise: 0, events: false, seed: 3, toasts: false, rivals: false } );
	f.list.set( 'trade', { module: tradeModule, instance: trade } );
	const boards = {}, haul = [];
	trade.haul.licence = 2; // every offer shows; the model keeps the ones the stage's licence allows
	for ( const port of Object.keys( PORTS ) ) {

		try { boards[ port ] = board( trade, port, 20 ); } catch ( e ) { boards[ port ] = []; }
		try { haul.push( ...trade.haul.offers( port ).map( ( o ) => ( { from: o.from || port, to: o.to, crates: o.crates, reward: o.reward, tier: o.tier } ) ) ); } catch ( e ) { /* no haul board */ }

	}

	return { boards, haul };

}

const m = measure();
ok( Object.values( m.boards ).some( ( rows ) => rows.length >= 3 ) && m.haul.length >= 8, `measured ${ Object.keys( m.boards ).length } trade boards and ${ m.haul.length } haul offers on a seeded market` );

const live = table( { boards: m.boards, haul: m.haul } );
const tuned = table( { boards: m.boards, haul: m.haul, overrides: PROPOSED } );
for ( const r of live.rows ) console.log( '     ', r.label.padEnd( 36 ), STAGE_IDS.map( ( s ) => String( r[ s ] ?? 'n/a' ).padStart( 7 ) ).join( ' ' ) );
console.log( '      median'.padEnd( 42 ), STAGE_IDS.map( ( s ) => String( live.medians[ s ] ).padStart( 7 ) ).join( ' ' ), ' wages', STAGE_IDS.map( ( s ) => live.wages[ s ].perHour ).join( ' / ' ) );

// ---- the model is sane
ok( STAGE_IDS.every( ( s ) => live.rows.find( ( r ) => r.id === 'fishing' )[ s ] > 0 ), 'fishing pays at every stage' );
ok( live.rows.find( ( r ) => r.id === 'fishing' ).late > live.rows.find( ( r ) => r.id === 'fishing' ).early, 'deep water with two crew anglers beats the pier' );
ok( [ 'bounty', 'navy', 'hijack' ].every( ( id ) => live.rows.find( ( r ) => r.id === id ).early === null ), 'no guns early: no bounties, navy work or hijacking (n/a)' );
ok( STAGE_IDS.every( ( s ) => live.loops[ s ] && live.loops[ s ].gain > 0 ), `a profitable trade loop at every stage (late: ${ live.loops.late && live.loops.late.from } <-> ${ live.loops.late && live.loops.late.to })` );
const f1 = fishingPerHour( 'mid', 2000 ).value, f2 = fishingPerHour( 'mid', 2000 ).value;
ok( f1 === f2, 'deterministic (seeded)' );
ok( legGain( [ { to: 'b', gain: 100, room: 4, margin: 10, perCrate: 10 } ], 'b', 2 ) === 50, 'a leg fills only the hold it has' );
ok( median( [ 1, 9, 3 ] ) === 3 && median( [ 1, 2, 3, 4 ] ) === 2.5, 'median' );

// ---- the constants as they stand: report the outliers
const liveInv = invariants( live );
for ( const i of liveInv ) console.log( i.ok ? '      holds ' : '      BROKEN', i.text );
const hijackLate = live.rows.find( ( r ) => r.id === 'hijack' ).late;
ok( FENCE === PROPOSED[ 'hijack.fence' ] || live.flags.some( ( f ) => f.id === 'hijack' ), `with FENCE ${ FENCE } hijack fencing is the outlier ($${ hijackLate }/h late, ${ live.flags.filter( ( f ) => f.id === 'hijack' ).map( ( f ) => f.times + 'x' ).join( ' / ' ) } the median): reported patch FENCE -> ${ PROPOSED[ 'hijack.fence' ] }` );
ok( live.flags.every( ( f ) => f.id === 'hijack' ), `nothing else is out of line (${ live.flags.map( ( f ) => f.id + ' ' + f.stage ).join( ', ' ) || 'no flags' })` );

// ---- with the proposed patches every invariant holds
for ( const i of invariants( tuned ) ) ok( i.ok, `(proposed) ${ i.text }` );
ok( tuned.flags.length === 0, `(proposed) no activity over ${ MEDIAN_MAX }x its stage's median` );
ok( tuned.wages.mid.perHour < WAGE_SHARE * tuned.medians.mid && live.wages.mid.perHour < WAGE_SHARE * live.medians.mid, `wages: mid $${ tuned.wages.mid.perHour }/h of a $${ tuned.medians.mid }/h median (${ Math.round( tuned.wages.mid.share * 100 ) } %)` );
ok( tuned.wages.late.perHour < tuned.medians.late, 'late-game running costs stay under the late median income' );

// ---- prices: the arsenal and the navy chandler in minutes of income
const out = tuned.prices.filter( ( p ) => p.flag );
for ( const p of tuned.prices ) console.log( '     ', p.name.padEnd( 52 ), String( p.price ).padStart( 6 ), p.stage.padEnd( 5 ), String( p.minutes ).padStart( 5 ), 'min', p.flag );
ok( tuned.prices.length >= 12, `${ tuned.prices.length } prices checked` );
ok( out.length === 0, `no weapon or chandler price is trivial (< 2 min) or out of reach (> 3 h) of its stage's income ${ out.map( ( p ) => p.name + ': ' + p.flag ).join( ', ' ) }` );

if ( ! process.argv.includes( '--no-write' ) ) {

	writeFileSync( new URL( '../docs/briefs/w20-balance-table.md', import.meta.url ), markdown( live, tuned ) );
	console.log( '      wrote docs/briefs/w20-balance-table.md' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
if ( fails ) process.exit( 1 );
