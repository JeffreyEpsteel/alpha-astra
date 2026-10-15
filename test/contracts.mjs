// Plain-node tests of PoorGoat's quest board (no DOM): story quests, the intro, paid orders, save round trip.
import { GameState } from '../src/game/GameState.js';
import { Contracts, QUESTS, ORDER_RATE, ORDER_SLOTS } from '../src/game/Contracts.js';
import { FISH } from '../src/game/FishTable.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ), mem: m } );
const fresh = ( seed = 42 ) => {

	const st = new GameState( memStorage() );
	st.quests.seed = seed;
	st.upgrades.hold = 2; // a big hold so nothing is let go
	const c = new Contracts( st );
	return { st, c };

};
const land = ( st, c, species, kg, hour = 12, where = null ) => {

	st.addFish( species, kg, hour, where );
	c.onCatch( st.lastCatch );
	return st.lastCatch;

};
const byId = ( c, id ) => c.active.find( ( q ) => q.id === id );

// ---- quest table
ok( [ 'firstCatch', 'reefRun', 'nightShift', 'deepWater', 'recordHunter' ].every( ( id ) => QUESTS[ id ] ), 'the five quests exist' );
ok( QUESTS.reefRun.reward.unlock === 'doge' && QUESTS.nightShift.reward.unlock === 'pengu' && QUESTS.deepWater.reward.unlock === 'bravile' && QUESTS.recordHunter.reward.unlock === 'heptyle', 'story quests unlock the right characters' );

// ---- the board on a new save
{

	const { st, c } = fresh();
	const a = c.active;
	ok( a.length === 5 + ORDER_SLOTS, `a new board shows the five quests and ${ ORDER_SLOTS } orders (${ a.length })` );
	ok( a.filter( ( q ) => q.kind === 'order' ).length === ORDER_SLOTS, 'three orders at a time' );
	ok( a.every( ( q ) => typeof q.title === 'string' && typeof q.text === 'string' && q.goal > 0 && q.progress === 0 && ! q.done ), 'every entry has title, text, goal and starts at 0' );
	ok( st.quests.seed === 42 && Array.isArray( st.quests.orders ) && st.quests.orders.length === ORDER_SLOTS, 'the board is kept in state.quests' );
	ok( c.claimable( 'firstCatch' ) === false && c.deliver( 'firstCatch' ) === null, 'nothing to claim before a catch' );

}

// ---- first catch
{

	const { st, c } = fresh();
	let changes = 0;
	c.onChange( () => changes ++ );
	land( st, c, 'mullet', 1 );
	const q = byId( c, 'firstCatch' );
	ok( q && q.done && q.progress === 1 && c.claimable( 'firstCatch' ), 'first catch completes after any fish' );
	ok( changes === 1, 'progress fires onChange' );
	const money = st.money;
	const r = c.deliver( 'firstCatch' );
	ok( r && r.money === 40 && st.money === money + 40, 'claiming first catch pays $40' );
	ok( c.completed.includes( 'firstCatch' ) && ! byId( c, 'firstCatch' ), 'a claimed quest leaves the board' );
	ok( c.deliver( 'firstCatch' ) === null, 'it cannot be claimed twice' );

}

// ---- reef run
{

	const { st, c } = fresh();
	land( st, c, 'mullet', 1 ); // shallows: not a reef fish
	ok( byId( c, 'reefRun' ).progress === 0, 'a mullet does not count for the reef run' );
	land( st, c, 'tang', 0.4 );
	land( st, c, 'parrot', 2 );
	ok( byId( c, 'reefRun' ).progress === 2 && ! byId( c, 'reefRun' ).done, 'two reef fish: 2 of 3' );
	ok( c.deliver( 'reefRun' ) === null && ! st.isUnlocked( 'doge' ), 'not before three' );
	land( st, c, 'angel', 1 );
	ok( byId( c, 'reefRun' ).done, 'three reef fish complete it' );
	const money = st.money;
	const r = c.deliver( 'reefRun' );
	ok( r && r.money === 150 && r.unlock === 'doge' && st.money === money + 150, 'reef run pays $150' );
	ok( st.isUnlocked( 'doge' ), 'and unlocks Doge for free' );

}

// ---- night shift
{

	const { st, c } = fresh();
	land( st, c, 'grunt', 0.5, 12 );
	land( st, c, 'grunt', 0.5, 19.4 );
	ok( byId( c, 'nightShift' ).progress === 0, 'day and dusk catches do not count' );
	land( st, c, 'grunt', 0.5, 19.5 );
	land( st, c, 'grunt', 0.5, 23 );
	land( st, c, 'grunt', 0.5, 5.9 );
	ok( byId( c, 'nightShift' ).done, '19:30, 23:00 and 05:54 count: night shift done' );
	land( st, c, 'grunt', 0.5, 6 );
	ok( byId( c, 'nightShift' ).progress === 3, 'progress caps at the goal' );
	const r = c.deliver( 'nightShift' );
	ok( r && r.money === 200 && r.unlock === 'pengu' && st.isUnlocked( 'pengu' ), 'night shift unlocks PENGU' );

}

// ---- deep water
{

	const { st, c } = fresh();
	land( st, c, 'tuna', 5, 12, { habitat: 'deep', aboard: false } );
	land( st, c, 'tuna', 5, 12, { habitat: 'reef', aboard: true } );
	land( st, c, 'tuna', 5 );
	ok( byId( c, 'deepWater' ).progress === 0, 'deep from shore, reef from a boat and no place at all do not count' );
	land( st, c, 'redSnapper', 3, 12, { habitat: 'deep', aboard: true } );
	land( st, c, 'mahi', 6, 12, { habitat: 'deep', aboard: true } );
	ok( byId( c, 'deepWater' ).done, 'two deep catches from a boat complete it' );
	const r = c.deliver( 'deepWater' );
	ok( r && r.money === 400 && r.unlock === 'bravile' && st.isUnlocked( 'bravile' ), 'deep water unlocks Bravile' );

}

// ---- record hunter
{

	const { st, c } = fresh();
	land( st, c, 'jack', 2 ); // first of a species is not a record
	land( st, c, 'jack', 1.5 );
	ok( byId( c, 'recordHunter' ).progress === 0, 'a first catch or a smaller one is no record' );
	land( st, c, 'jack', 3 );
	land( st, c, 'jack', 4 );
	ok( byId( c, 'recordHunter' ).progress === 2, 'two records so far' );
	land( st, c, 'jack', 5 );
	ok( byId( c, 'recordHunter' ).done, 'three beaten records complete it' );
	const r = c.deliver( 'recordHunter' );
	ok( r && r.money === 500 && r.unlock === 'heptyle' && st.isUnlocked( 'heptyle' ), 'record hunter unlocks Heptyle' );

}

// ---- orders: deterministic from the seed
{

	const a = fresh( 7 ), b = fresh( 7 ), d = fresh( 8 );
	const orders = ( c ) => c.active.filter( ( q ) => q.kind === 'order' ).map( ( q ) => `${ q.id }:${ q.species }x${ q.count }+${ q.bonus }` ).join( ' ' );
	ok( orders( a.c ) === orders( b.c ), `the same seed gives the same orders (${ orders( a.c ) })` );
	ok( orders( a.c ) !== orders( d.c ), `another seed gives other orders (${ orders( d.c ) })` );
	ok( a.c.active.filter( ( q ) => q.kind === 'order' ).every( ( q ) => FISH[ q.species ] && q.count >= 1 && q.bonus > 0 && q.text.includes( FISH[ q.species ].name.toLowerCase() ) ), 'orders name a real species, a count and a bonus' );

}

// ---- orders: delivery takes the fish and pays more than selling
{

	const { st, c } = fresh( 3 );
	const o = c.active.find( ( q ) => q.kind === 'order' );
	const f = FISH[ o.species ];
	ok( o.deliverable.length === 0 && ! o.done && c.deliver( o.id ) === null, 'an order with no matching fish is not deliverable' );
	for ( let i = 0; i < o.count - 1; i ++ ) land( st, c, o.species, f.kg[ 0 ] );
	ok( byId( c, o.id ).progress === o.count - 1 && ! byId( c, o.id ).done, 'one fish short: not yet' );
	land( st, c, o.species, f.kg[ 1 ] ); // a big one, kept for sale
	land( st, c, 'mullet', 1 ); // and something else in the hold
	const q = byId( c, o.id );
	ok( q.done && q.deliverable.length === o.count && c.claimable( o.id ), 'with enough matching fish the order is deliverable' );
	const taken = st.inventory.filter( ( x ) => q.deliverable.includes( x.id ) );
	const sellValue = taken.reduce( ( v, x ) => v + x.value, 0 );
	const before = st.money, count = st.inventory.length;
	const r = c.deliver( o.id );
	ok( r && r.money === Math.round( sellValue * ORDER_RATE ) + o.bonus, `delivery pays ${ ORDER_RATE }× plus the bonus ($${ r && r.money } vs $${ sellValue } sold)` );
	ok( r.money > sellValue, 'which is more than selling would' );
	ok( st.money === before + r.money, 'the money arrives' );
	ok( st.inventory.length === count - o.count && ! st.inventory.some( ( x ) => q.deliverable.includes( x.id ) ), 'the delivered fish leave the hold' );
	ok( st.inventory.some( ( x ) => x.species === 'mullet' ), 'the other fish stay' );
	const after = c.active.filter( ( x ) => x.kind === 'order' );
	ok( after.length === ORDER_SLOTS && ! after.some( ( x ) => x.id === o.id ), 'a new order replaces the delivered one' );
	ok( st.career.earned === r.money, 'the career counts the earnings' );

}

// ---- progress survives a save round trip
{

	const { st, c } = fresh( 11 );
	land( st, c, 'tang', 0.4 );
	land( st, c, 'grunt', 0.5, 22 );
	land( st, c, 'mullet', 1 );
	c.deliver( 'firstCatch' );
	const before = c.active.map( ( q ) => `${ q.id }/${ q.progress }` ).join( ' ' );
	const st2 = new GameState( memStorage() );
	ok( st2.fromJSON( JSON.parse( JSON.stringify( st.toJSON() ) ) ), 'the save loads' );
	const c2 = new Contracts( st2 );
	const after = c2.active.map( ( q ) => `${ q.id }/${ q.progress }` ).join( ' ' );
	ok( before === after, `progress and orders survive toJSON / fromJSON (${ after })` );
	ok( c2.completed.includes( 'firstCatch' ) && st2.money === 40, 'claimed quests and the money too' );
	// and through the storage itself
	const st3 = new GameState( st.storage );
	ok( st3.load() && new Contracts( st3 ).active.map( ( q ) => `${ q.id }/${ q.progress }` ).join( ' ' ) === before, 'and through storage.load()' );

}

// ---- an older save seeds progress from the career stats
{

	const st = new GameState( memStorage() );
	st.career.caught = 5; st.career.reef = 2; st.career.night = 9; st.career.records = 1; st.career.deep = 3; st.career.aboard = 1;
	const c = new Contracts( st );
	ok( byId( c, 'firstCatch' ).done && byId( c, 'reefRun' ).progress === 2 && byId( c, 'nightShift' ).progress === 3 && byId( c, 'recordHunter' ).progress === 1 && byId( c, 'deepWater' ).progress === 1, 'a save without quests takes its career stats as progress' );

}

console.log( fails ? `\n${ fails } failing` : '\nall green' );
process.exit( fails ? 1 : 0 );
