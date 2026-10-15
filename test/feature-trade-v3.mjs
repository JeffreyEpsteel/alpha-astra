// Plain-node tests of the v3 economy (WP-A): markets at every WORLD.ports entry, legality and contraband, the
// naval holdBonus / story priceMod hooks, the universe market snapshot API, hauling contracts and licences, merchant
// credit and standing, rival merchants and world-caused events, the smuggler, operating costs (bait, wages, upkeep)
// and the gear gates of Gear.js. No DOM, no GPU.
//   node test/feature-trade-v3.mjs
import * as tradeModule from '../src/features/trade/index.js';
import { install, factorSite } from '../src/features/trade/index.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { GOODS, GOOD_IDS, PORTS, PORT_IDS, REGION, LEGALITY, legalAt, contrabandAt, syncPorts, seaDistance, CAUSES, EVENTS } from '../src/features/trade/goods.js';
import { Market } from '../src/features/trade/market.js';
import { LICENCES } from '../src/features/trade/HaulContracts.js';
import { CREDIT } from '../src/features/trade/Credit.js';
import { BAIT, OPERATING } from '../src/features/trade/Operating.js';
import { SMUGGLER } from '../src/features/trade/Smuggler.js';
import { UPGRADES, gearGate, gearStats, defaultUpgrades } from '../src/game/Gear.js';
import { BAIT_TUB, CHANDLERY } from '../src/game/Chandlery.js';
import { WORLD } from '../src/world/WorldLayout.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, tol ) => Math.abs( a - b ) <= tol;
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ) };

};

function make( { boat = 'cutter', money = 5000, noise = 0, events = false, mode = null, seed, extra = {}, rivals } = {} ) {

	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.money = money;
	state.boat = boat;
	const app = { settings: { timeOfDay: 9.5 }, game: { state }, player: { mode: 'walk', position: { x: 0, y: 2, z: 0 } } };
	const features = new Features( app );
	for ( const k in extra ) features.list.set( k, { module: {}, instance: extra[ k ] } );
	const trade = install( app, features, { noise, events, seed, toasts: false, rivals } );
	features.list.set( 'trade', { module: tradeModule, instance: trade } );
	return { app, features, state, trade };

}

// ---- goods, legality, every port
{

	ok( GOOD_IDS.length >= 12, `${ GOOD_IDS.length } goods` );
	ok( GOOD_IDS.every( ( g ) => GOODS[ g ].cat && Array.isArray( GOODS[ g ].tags ) && Array.isArray( GOODS[ g ].origin ) && Array.isArray( GOODS[ g ].demand ) ), 'every good has a category, tags, origin and demand regions' );
	ok( WORLD.ports.every( ( p ) => PORT_IDS.includes( p.id ) && PORTS[ p.id ] && REGION[ p.id ] ), 'a market for every WORLD.ports entry' );
	ok( GOOD_IDS.every( ( g ) => PORT_IDS.every( ( p ) => REGION[ p ][ g ] > 0 ) ), 'a regional price for every good at every port' );
	ok( ! legalAt( 'home', 'tobacco' ) && legalAt( 'pons', 'tobacco' ) && legalAt( 'gull', 'powder' ) && ! legalAt( 'key', 'powder' ) && PORT_IDS.every( ( p ) => ! legalAt( p, 'relics' ) ), 'legality differs per port (tobacco, powder, relics)' );
	ok( contrabandAt( 'home' ).includes( 'tobacco' ) && Object.keys( LEGALITY ).every( ( g ) => GOODS[ g ] ), 'contrabandAt lists the illegal goods' );
	ok( near( seaDistance( 'home', 'pons' ), 700, 40 ) && seaDistance( 'gull', 'key' ) > seaDistance( 'home', 'pons' ), `sea distances from the docks (Home to Pons ${ Math.round( seaDistance( 'home', 'pons' ) ) } m)` );
	ok( CAUSES.every( ( c ) => GOODS[ c.good ] && c.ports.every( ( p ) => PORTS[ p ] ) ) && EVENTS.some( ( e ) => e.ports.includes( 'gull' ) ) && EVENTS.some( ( e ) => e.ports.includes( 'key' ) ), 'events reach the islets; world-caused templates are valid' );

	// thin islet markets: a round trip at one stall still always loses
	const m = new Market( { noise: 0, events: false } );
	let loses = true;
	for ( const p of PORT_IDS ) for ( const g of GOOD_IDS ) for ( const n of [ 1, 4, 12 ] ) {

		const b = m.quoteBuy( p, g, n );
		m.applyBuy( p, g, n );
		const s = m.quoteSell( p, g, n );
		m.applySell( p, g, n );
		if ( s.total >= b.total ) loses = false;

	}

	ok( loses, 'buying and selling back at any stall (thin islets included) is always a loss' );

	// a port that lands later gets a market
	const t0 = make().trade;
	WORLD.ports.push( { id: 'testisle', name: 'Test Isle', dock: { position: { x: - 900, z: 900 }, heading: 0, start: { x: - 920, z: 920 }, end: { x: - 900, z: 900 } } } );
	t0.update( 0.016 );
	ok( PORTS.testisle && REGION.testisle && t0.market( 'testisle' ).price( 'salt' ) > 0, 'a port pushed onto WORLD.ports later gets a market (derived prices)' );
	const fs = factorSite( 'testisle' );
	ok( fs && t0.features.nearestInteractable( { x: fs.x, y: 0, z: fs.z } ).id === 'trade:testisle', 'and an E interactable by its jetty' );
	ok( t0.buy( 'testisle', 'salt', 2 ).ok && t0.toJSON().sim.cells.testisle, 'it trades and saves' );
	t0.dispose();
	WORLD.ports.pop();
	PORT_IDS.splice( PORT_IDS.indexOf( 'testisle' ), 1 );
	delete PORTS.testisle;
	delete REGION.testisle;

}

// ---- legality at the stall, hooks from other features
{

	const { trade, state } = make( { boat: 'cutter' } );
	const r = trade.buy( 'home', 'tobacco', 1 );
	ok( ! r.ok && r.reason === 'contraband', 'the Home stall will not sell tobacco' );
	ok( trade.buy( 'pons', 'tobacco', 2 ).ok, 'Pons sells it openly' );
	ok( trade.sell( 'home', 'tobacco', 1 ).reason === 'contraband' && trade.contraband( 'home' ).length === 1 && trade.contraband( 'pons' ).length === 0, 'and Home will not buy it: it is contraband aboard there' );
	const v = trade.view( 'pons' );
	const row = v.rows.find( ( x ) => x.id === 'tobacco' );
	ok( row.other.contraband && row.room === 0, 'the window does not suggest carrying tobacco to Home' );
	ok( v.ports.length === PORT_IDS.length - 1 && trade.view( 'pons', 'key' ).other === 'key', 'the window can compare with any other port' );
	ok( trade.view( 'home' ).rows.find( ( x ) => x.id === 'powder' ).can.buy === false, 'contraband rows cannot be bought' );
	trade.dispose();

	const naval = { holdBonus: () => 1.5 };
	const story = { priceMod: ( p ) => ( p === 'pons' ? 1.2 : 1 ) };
	const a = make( { boat: 'cutter', extra: { naval, story } } ), b = make( { boat: 'cutter' } );
	ok( a.trade.capacity() === 12 && b.trade.capacity() === 8, 'the naval holdBonus scales the hold (8 x 1.5 = 12)' );
	ok( near( a.trade.market( 'pons' ).price( 'rum' ) / b.trade.market( 'pons' ).price( 'rum' ), 1.2, 1e-6 ) && near( a.trade.market( 'home' ).price( 'rum' ), b.trade.market( 'home' ).price( 'rum' ), 1e-9 ), 'the story priceMod scales one port\'s prices' );
	const broken = make( { extra: { naval: { holdBonus: () => NaN }, story: { priceMod: () => { throw new Error( 'x' ); } } } } );
	ok( broken.trade.capacity() === 8 && broken.trade.market( 'pons' ).price( 'rum' ) > 0, 'a broken hook falls back to the defaults' );
	for ( const x of [ a, b, broken ] ) x.trade.dispose();

}

// ---- the universe server API
{

	const a = make( { noise: 1, events: true, seed: 77 } ), b = make( { noise: 1, events: true, seed: 3 } );
	a.trade.advance( 20 );
	a.trade.buy( 'home', 'rope', 6 );
	const snap = JSON.parse( JSON.stringify( a.trade.marketSnapshot() ) );
	ok( snap.cells.home.rope && snap.cells.gull && Array.isArray( snap.events ), 'marketSnapshot is plain JSON (cells, events)' );
	snap.cells.atlantis = { salt: [ 0.5, 0 ] };
	delete snap.cells.key;
	const keyBefore = b.trade.market( 'key' ).price( 'oil' );
	ok( b.trade.adoptMarketSnapshot( snap ) && b.trade.following, 'adoptMarketSnapshot takes it and follows the server' );
	ok( [ 'home', 'pons', 'gull' ].every( ( p ) => GOOD_IDS.every( ( g ) => near( b.trade.market( p ).price( g ) / a.trade.market( p ).price( g ), 1, 1e-3 ) ) ), 'shared ports price the same afterwards' );
	ok( near( b.trade.market( 'key' ).price( 'oil' ), keyBefore, 1e-6 ) && ! PORTS.atlantis, 'a port missing from the snapshot keeps its state; an unknown one is ignored' );
	ok( ! b.trade.adoptMarketSnapshot( null ) && ! b.trade.adoptMarketSnapshot( { cells: 5 } ), 'junk snapshots are refused' );
	const heard = [];
	const off = b.trade.onMarketChange( ( e ) => heard.push( e ) );
	ok( typeof off === 'function', 'onMarketChange returns an unsubscribe function' );
	b.trade.buy( 'home', 'salt', 3 );
	ok( heard.length === 1 && heard[ 0 ].type === 'trade' && heard[ 0 ].side === 'buy' && heard[ 0 ].good === 'salt' && heard[ 0 ].qty === 3, 'it hears the player\'s trades' );
	const p0 = b.trade.market( 'pons' ).price( 'rum' );
	ok( b.trade.applyRemoteTrade( { port: 'pons', good: 'rum', qty: 5, side: 'buy' } ) && b.trade.market( 'pons' ).price( 'rum' ) > p0 && heard.length === 1, 'a relayed trade moves the price without being told again' );
	off();
	b.trade.buy( 'home', 'salt', 1 );
	ok( heard.length === 1, 'unsubscribed: no more calls' );
	const ev0 = b.trade.sim.events.length;
	b.trade.advance( 200 );
	ok( b.trade.sim.events.length <= ev0 && b.trade.rivals.list.every( ( r ) => r.voyages === 0 ), 'while following, no local events or rival voyages start' );
	b.app.netsync = { online: true, isHost: false };
	b.trade.update( 0.016 );
	ok( b.trade.following, 'a universe guest keeps following' );
	b.app.netsync.isHost = true;
	b.trade.update( 0.016 );
	ok( ! b.trade.following && b.trade.sim.useEvents, 'the host (or an offline player) runs its own market' );
	a.trade.dispose();
	b.trade.dispose();

}

// ---- hauling contracts and the licence
{

	const { trade, state, features } = make( { boat: 'launch', money: 3000 } );
	const got = [];
	for ( const n of [ 'haulAccepted', 'haulDelivered', 'haulFailed', 'licenceBought' ] ) features.on( n, ( e ) => got.push( n ) );
	const offers = trade.haul.offers( 'home' );
	ok( offers.length >= 3 && offers.every( ( o ) => o.from === 'home' && o.to !== 'home' && PORTS[ o.to ] && legalAt( 'home', o.good ) && legalAt( o.to, o.good ) && o.reward > 0 && o.hours >= 6 ), 'a board of legal consignments to other ports' );
	ok( offers[ 0 ].tier === 0 && offers[ 0 ].ok, 'a parcel anyone may take' );
	const big = offers.find( ( o ) => o.crates > LICENCES[ 0 ].maxCrates );
	if ( big ) ok( ! big.ok && /licence/i.test( big.why ), 'a bigger load wants a licence' );
	const o = offers[ 0 ];
	const m0 = state.money, free0 = trade.free();
	const r = trade.haul.accept( 'home', o.id );
	ok( r.ok && state.money === m0 - o.deposit && trade.free() === free0 - o.crates && ! trade.cargo[ o.good ], 'taking it holds the deposit and fills crates, but the goods are not yours to sell' );
	trade.advance( 1 );
	const m1 = state.money;
	trade.visit( o.to );
	ok( trade.haul.active.length === 0 && state.money >= m1 + o.deposit + Math.round( o.reward * 0.5 ) && trade.haul.done === 1, `delivered at ${ PORTS[ o.to ].name }: reward and deposit paid` );
	const st0 = trade.credit.standing;
	const o2 = trade.haul.offers( o.to )[ 0 ];
	trade.haul.accept( o.to, o2.id );
	trade.advance( o2.hours + 1 );
	ok( trade.haul.active.length === 0 && trade.haul.failed === 1 && trade.credit.standing < st0, 'late: it fails, the deposit is forfeit and standing drops' );
	ok( trade.haul.buyLicence().ok && trade.haul.licence === 1 && ! trade.haul.buyLicence().ok, 'the coastal licence is bought; the master licence wants standing' );
	ok( got.includes( 'haulAccepted' ) && got.includes( 'haulDelivered' ) && got.includes( 'haulFailed' ) && got.includes( 'licenceBought' ), 'contract events are emitted' );
	trade.dispose();

}

// ---- credit and standing
{

	const { trade, state, features } = make( { boat: 'cutter', money: 100 } );
	const got = [];
	for ( const n of [ 'loanTaken', 'loanRepaid', 'loanOverdue', 'loanDefaulted', 'debtCollected', 'merchantStanding' ] ) features.on( n, () => got.push( n ) );
	const lim = trade.credit.limit( 'home' );
	ok( lim >= CREDIT.baseLimit && trade.credit.rate( 'home' ) <= CREDIT.rateHigh, `a lender at Home: $${ lim } at ${ ( trade.credit.rate( 'home' ) * 100 ).toFixed( 1 ) }% a day` );
	const earned = state.career.earned;
	const r = trade.credit.take( 'home', 300, 2 );
	ok( r.ok && state.money === 400 && state.career.earned === earned, 'a loan fills the purse (not the career earnings)' );
	ok( ! trade.credit.take( 'home', lim * 10 ).ok && ! trade.credit.take( 'home', 10 ).ok, 'over the limit or under the minimum is refused' );
	trade.advance( 24 );
	ok( trade.credit.owed( 'home' ) > 300 && trade.credit.owed( 'home' ) < 320, `interest accrues ($${ trade.credit.owed( 'home' ) } after a day)` );
	const st = trade.credit.standing;
	ok( trade.credit.repay( 'home', 'all' ).ok && trade.credit.owed() === 0 && trade.credit.standing > st, 'repaid on time: clear, and standing rises' );
	trade.credit.take( 'pons', 200, 1 );
	state.money = 0;
	trade.advance( 30 );
	ok( trade.credit.loans[ 0 ].status === 'overdue', 'past due: overdue' );
	trade.advance( 50 );
	ok( trade.credit.blocked( 'pons' ) && trade.buy( 'pons', 'rum', 1 ).reason === 'blocked', 'two days later it defaults and Pons will not sell to you' );
	state.money = 1000;
	trade.visit( 'pons' );
	ok( ! trade.credit.blocked( 'pons' ) && state.money < 1000, 'the harbourmaster collects from the purse on the next visit' );
	ok( [ 'loanTaken', 'loanRepaid', 'loanOverdue', 'loanDefaulted', 'debtCollected', 'merchantStanding' ].every( ( n ) => got.includes( n ) ), 'credit events are emitted' );
	trade.credit.standing = 100;
	ok( trade.credit.spreadMul() < 0.75 && trade.credit.rate( 'home' ) < 0.03, 'high standing narrows the spread and the interest' );
	trade.dispose();
	const sb = make( { mode: 'sandbox' } );
	ok( sb.trade.credit.take( 'home', 200 ).reason === 'sandbox', 'sandbox: no loans needed' );
	sb.trade.dispose();

}

// ---- rival merchants and world causes
{

	const { trade, features } = make( { noise: 0, events: true, seed: 12, rivals: true } );
	const got = [];
	for ( const n of [ 'rivalVoyage', 'rivalArrived', 'rivalLost', 'marketEvent' ] ) features.on( n, ( e ) => got.push( [ n, e ] ) );
	trade.advance( 120 );
	const voyages = trade.rivals.list.reduce( ( a, r ) => a + r.voyages, 0 );
	ok( voyages >= 4 && got.some( ( g ) => g[ 0 ] === 'rivalArrived' ), `rivals sail on their own (${ voyages } voyages in five days)` );
	ok( trade.news.some( ( n ) => n.kind === 'rival' ), 'and the news says who moved the prices' );
	let atSea = trade.rivals.list.find( ( r ) => r.phase === 'sea' );
	for ( let i = 0; i < 40 && ! atSea; i ++ ) { trade.advance( 1 ); atSea = trade.rivals.list.find( ( r ) => r.phase === 'sea' ); }
	ok( !! atSea, 'a rival is at sea' );
	const where = trade.rivals.where( atSea );
	features.emit( 'shipSunk', { id: 9, name: 'x', faction: 'merchant', x: where.x, z: where.z, byPlayer: false } );
	ok( atSea.phase === 'lost' && got.some( ( g ) => g[ 0 ] === 'rivalLost' ) && trade.sim.events.some( ( e ) => e.tpl === 'merchantLost' ), 'a merchant sunk at sea takes a rival\'s cargo down: a shortage where it was bound' );
	features.emit( 'weatherChanged', { kind: 'storm', previous: 'rain', intensity: 1 } );
	ok( trade.sim.events.some( ( e ) => e.tpl === 'stormShoal' ), 'a storm closes the shoals (a market event)' );
	const n0 = trade.sim.events.length;
	features.emit( 'weatherChanged', { kind: 'storm', previous: 'rain', intensity: 1 } );
	ok( trade.sim.events.length === n0, 'not twice for one storm' );
	const saved = JSON.parse( JSON.stringify( trade.toJSON() ) );
	const b = make( { noise: 0, events: true, seed: 12, rivals: true } );
	b.trade.fromJSON( saved );
	trade.advance( 60 );
	b.trade.advance( 60 );
	ok( trade.rivals.list.every( ( r, i ) => r.voyages === b.trade.rivals.list[ i ].voyages && r.phase === b.trade.rivals.list[ i ].phase ) && PORT_IDS.every( ( p ) => near( trade.sim.mid( p, 'rope' ), b.trade.sim.mid( p, 'rope' ), 0.01 ) ), 'rivals survive a save and go on the same way' );
	trade.dispose();
	b.trade.dispose();

}

// ---- the smuggler
{

	const { trade, app, state, features } = make( { boat: 'cutter', money: 3000 } );
	ok( trade.smuggler.tonight() === null, 'by day nobody is there' );
	app.settings.timeOfDay = 22;
	const port = trade.smuggler.tonight();
	ok( PORTS[ port ] && trade.smuggler.here( port ), `at night he is at ${ port }` );
	const spot = trade.smuggler.spot( port );
	const e = features.nearestInteractable( { x: spot.x, y: 0, z: spot.z } );
	ok( e && e.id === 'smuggler:' + port && /smuggler/i.test( e.prompt() ), 'his spot is an E interactable after dark' );
	ok( trade.open( port, 'smuggler' ) && trade.openKind === 'smuggler', 'it opens his window' );
	trade.addCargo( 'relics', 2, { paid: 0, port: 'gull' } );
	const off = trade.smuggler.offers( port ).find( ( r ) => r.good === 'relics' );
	ok( off && off.bid > GOODS.relics.base, 'he pays well for relics' );
	const m0 = state.money;
	const s = trade.smuggler.sell( port, 'relics', 'all' );
	ok( s.ok && state.money === m0 + s.total && ! trade.cargo.relics && trade.smuggler.trust >= 1, 'sold: paid, booked, and his trust grows' );
	ok( ! trade.smuggler.sell( port, 'salt', 1 ).ok, 'he will not take legal goods' );
	ok( trade.smuggler.buyPapers().ok && trade.smuggler.papers === 1 && trade.smuggler.buyCompartment().ok && trade.smuggler.hidden() === SMUGGLER.compartments[ 1 ].hides, 'papers and a hidden compartment' );
	app.settings.timeOfDay = 8;
	trade.lastHour = null;
	trade.update( 0.016 );
	ok( ! trade.isOpen, 'at dawn he is gone and the window closes' );
	ok( /smuggler/i.test( trade.view( 'home' ).rumour ), 'the markets carry the rumour of where he will be' );
	trade.dispose();

}

// ---- operating costs
{

	const { trade, state, features } = make( { boat: 'trawler', money: 1000 } );
	const got = [];
	for ( const n of [ 'wagesPaid', 'wagesMissed', 'crewDeserted', 'crewReturned', 'baitOut', 'baitBought' ] ) features.on( n, () => got.push( n ) );
	const op = trade.operating;
	ok( op.bait === BAIT.start && op.useBait() === 1 && op.bait === BAIT.start - 1, 'a cast uses one bait' );
	op.bait = 1;
	op.useBait();
	ok( op.bait === 0 && op.useBait() === BAIT.bareFactor && got.includes( 'baitOut' ), 'out of bait: bites slow down' );
	ok( op.buyBait( 10 ).ok && op.bait === 10 && state.money === 1000 - BAIT.tinPrice, 'a tin of bait' );
	ok( op.wagesPerDay() === 3 * OPERATING.wage && op.upkeepPerDay() > 0, `the trawler costs $${ op.wagesPerDay() } wages and $${ op.upkeepPerDay() } upkeep a day` );
	const m1 = state.money;
	trade.advance( 24 );
	ok( state.money === m1 - op.wagesPerDay() - op.upkeepPerDay() && got.includes( 'wagesPaid' ), 'paid at the turn of the day' );
	state.money = 0;
	trade.advance( 72 );
	ok( op.deserted && op.speedFactor() === OPERATING.desertedSpeed && op.owed > 0 && got.includes( 'crewDeserted' ), 'three days unpaid: the crew walks off and the ship slows' );
	state.money = 5000;
	ok( op.payOwed().ok && ! op.deserted && op.speedFactor() === 1 && got.includes( 'crewReturned' ), 'paying them brings them back' );
	ok( BAIT_TUB && Math.hypot( BAIT_TUB.x - CHANDLERY.x, BAIT_TUB.z - CHANDLERY.z ) < 6 && features.nearestInteractable( { x: BAIT_TUB.x, y: 0, z: BAIT_TUB.z } ).id === 'trade:bait', 'Ethena\'s bait tub by the chandlery sells bait with E' );
	trade.dispose();
	const sb = make( { boat: 'brigantine', mode: 'sandbox', money: 0 } );
	sb.trade.advance( 100 );
	ok( sb.trade.operating.useBait() === 1 && sb.trade.operating.wagesPerDay() === 0 && ! sb.trade.operating.deserted, 'sandbox: no bait, wages or upkeep' );
	sb.trade.dispose();

}

// ---- the gear gates (F6)
{

	ok( UPGRADES.line.levels.some( ( l ) => /Reinforced/.test( l.label ) && l.req && l.req.quest ), 'the reinforced fishing line is gated by a quest' );
	ok( ! ( 'req' in gearStats( defaultUpgrades() ) ), 'requirements never leak into the gear stats' );
	const st = new GameState( store() );
	st.money = 100000;
	st.upgrades.line = 3;
	let g = gearGate( st, 'line' );
	ok( ! g.ok && g.why === 'locked' && g.reasons.some( ( r ) => /level/.test( r ) ) && g.reasons.some( ( r ) => /quest/i.test( r ) ), `locked: ${ g.reasons.join( '; ' ) }` );
	st.xp = 1e5;
	st.rep.home = 50;
	st.quests = { done: [ 'deepWater' ] };
	g = gearGate( st, 'line' );
	ok( g.ok && g.cost === 950, 'met: it may be bought' );
	st.money = 10;
	ok( gearGate( st, 'line' ).why === 'money', 'and money still matters' );
	st.money = 1e5;
	st.rep.pons = 50;
	st.upgrades.engine = 1;
	ok( gearGate( st, 'engine', 5 ).why === 'locked' && gearGate( st, 'engine', 30 ).ok && gearGate( st, 'engine' ).ok, 'merchant standing gates the turbo diesel when the caller knows it' );
	st.money = 10;
	const free = new GameState( store() );
	free.setMode( 'sandbox' );
	free.upgrades.line = 3;
	ok( gearGate( free, 'line' ).ok, 'sandbox: no gates' );
	st.money = 1e5;
	st.upgrades.line = 4;
	ok( gearGate( st, 'line' ).why === 'max', 'top of the line' );

}

// ---- the window's new tabs render from plain data (no DOM)
{

	const { trade, app } = make( { boat: 'launch', money: 3000 } );
	const P = trade.panel;
	trade.credit.take( 'home', 200 );
	trade.haul.accept( 'home', trade.haul.offers( 'home' )[ 0 ].id );
	P.port = 'home';
	const c = P.contractsHtml( trade.haul.view( 'home' ) ), k = P.creditHtml( trade.credit.view( 'home' ) ), o = P.costsHtml( trade.operating.view() );
	ok( /Licence/.test( c ) && /data-act="accept"/.test( c ) && /data-act="abandon"/.test( c ), 'the Contracts tab lists the licence, the board and the consignments aboard' );
	ok( /Standing/.test( k ) && /data-act="loan"/.test( k ) && /data-act="repay"/.test( k ), 'the Credit tab offers loans and repayment' );
	ok( /Bait/.test( o ) && /data-act="bait"/.test( o ), 'the Costs tab sells bait' );
	app.settings.timeOfDay = 23;
	const port = trade.smuggler.tonight();
	ok( /Forged papers/.test( P.denHtml( trade.smuggler.view( port ) ) ) && /rumour/i.test( P.newsHtml( trade.view( 'home' ) ) ), 'the smuggler tab and the rumour render' );
	trade.dispose();

}

// ---- save of the whole economy
{

	const a = make( { boat: 'launch', money: 4000, events: true, noise: 1, seed: 8, rivals: true } );
	a.trade.haul.accept( 'home', a.trade.haul.offers( 'home' )[ 0 ].id );
	a.trade.credit.take( 'home', 200 );
	a.trade.operating.buyBait( 20 );
	a.trade.haul.buyLicence();
	a.trade.advance( 10 );
	const saved = JSON.parse( JSON.stringify( a.trade.toJSON() ) );
	ok( saved.haul && saved.credit && saved.rivals && saved.smuggler && saved.operating && JSON.stringify( saved ).length < 60000, `the save carries every part (${ JSON.stringify( saved ).length } characters)` );
	const b = make( { boat: 'launch', money: 4000, events: true, noise: 1, seed: 99, rivals: true } );
	b.trade.fromJSON( saved );
	ok( b.trade.haul.active.length === 1 && b.trade.haul.licence === 1 && near( b.trade.credit.owed(), a.trade.credit.owed(), 0.01 ) && b.trade.operating.bait === a.trade.operating.bait && b.trade.crates() === a.trade.crates(), 'contracts, licence, loans, bait and the consigned crates survive' );
	let threw = false;
	for ( const junk of [ { haul: 5 }, { credit: { loans: [ null, { port: 'x' } ] } }, { rivals: { list: [ { id: 'marlow', phase: 'sea' } ] } }, { operating: 'x' }, { smuggler: { compartment: 99 } } ] ) {

		try { b.trade.fromJSON( junk ); } catch ( e ) { threw = true; console.log( e ); }

	}

	ok( ! threw && b.trade.smuggler.compartment <= 2 && b.trade.rivals.list[ 0 ].phase === 'port', 'garbage in the new parts is ignored' );
	b.trade.reset();
	ok( b.trade.haul.active.length === 0 && b.trade.credit.loans.length === 0 && b.trade.operating.bait === BAIT.start, 'reset clears them' );
	a.trade.dispose();
	b.trade.dispose();

}

syncPorts();
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
