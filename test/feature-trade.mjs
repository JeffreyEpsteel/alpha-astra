// Plain-node tests of the merchant trade feature (src/features/trade): the market model (impact, drift,
// recovery, spread, events), the cargo (capacity by boat, spoilage), money through GameState, the route economics
// (profitable at first, not free money when repeated), the ledger, the clock, the interactables, the stall
// prop and the save round trip. No DOM, no GPU.
//   node test/feature-trade.mjs
import * as tradeModule from '../src/features/trade/index.js';
import { install, hold, Trade } from '../src/features/trade/index.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { BOATS, BOAT_IDS } from '../src/game/Boats.js';
import { GOODS, GOOD_IDS, PORTS, PORT_IDS, REGION, EVENTS, HOLD_CRATES, MARKET, legalAt } from '../src/features/trade/goods.js';
import { Market } from '../src/features/trade/market.js';
import { Ledger } from '../src/features/trade/ledger.js';
import { TradePanel } from '../src/features/trade/panel.js';
import { buildStallGeometry, TradeStall, STALL_SITES, stallFront, stallWorld } from '../src/features/trade/stall.js';
import { triangleCount } from '../src/world/boat/GeoKit.js';
import { STAND } from '../src/game/FishStand.js';
import { CHANDLERY } from '../src/game/Chandlery.js';
import { PONS_STAND } from '../src/game/PonsPort.js';
import { WORLD } from '../src/world/WorldLayout.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, tol ) => Math.abs( a - b ) <= tol;
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), map: m };

};

// a game stub: real GameState + the real Features registry; options go straight to install() (noise 0 = no random drift)
function make( { boat = null, money = 5000, noise = 0, events = false, mode = null, seed } = {} ) {

	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.earn( money );
	state.money = money;
	state.boat = boat;
	const app = { settings: { timeOfDay: 9.5 }, game: { state }, player: { mode: 'walk', position: { x: 0, y: 2, z: 0 } } };
	const features = new Features( app );
	const trade = install( app, features, { noise, events, seed, toasts: false } );
	features.list.set( 'trade', { module: tradeModule, instance: trade } );
	return { app, features, state, trade };

}

// buys the load that pays best (view().room / gain), carries it `hours`, sells it all; returns the money made
function leg( t, state, from, to, hours ) {

	t.visit( from );
	const m0 = state.money;
	for ( let guard = 0; guard < 16; guard ++ ) {

		const rows = t.view( from ).rows.filter( ( r ) => r.can.buy && r.room > 0 ).sort( ( a, b ) => b.gain / ( b.room * b.crates ) - a.gain / ( a.room * a.crates ) );
		if ( ! rows.length ) break;
		if ( ! t.buy( from, rows[ 0 ].id, rows[ 0 ].room ).ok ) break;

	}

	t.advance( hours );
	t.visit( to );
	for ( const g of GOOD_IDS ) if ( t.cargo[ g ] ) t.sell( to, g, 'all' );
	return state.money - m0;

}

// ---- the tables
{

	ok( GOOD_IDS.length >= 12, `${ GOOD_IDS.length } goods (12 or more)` );
	ok( GOOD_IDS.every( ( g ) => GOODS[ g ].base > 0 && GOODS[ g ].crates >= 1 && GOODS[ g ].kg > 0 && GOODS[ g ].perish >= 0 && GOODS[ g ].depth > 0 && GOODS[ g ].recover > 0 ), 'every good has a base price, crates, weight, perishability, depth and recovery' );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => REGION[ p ][ g ] > 0 ) ), 'a regional multiplier for every port and good' );
	const eq = ( p, g ) => GOODS[ g ].base * REGION[ p ][ g ];
	ok( eq( 'pons', 'coconuts' ) < eq( 'home', 'coconuts' ) && eq( 'pons', 'pearls' ) < eq( 'home', 'pearls' ), 'coconuts and pearls are cheap at Pons' );
	ok( eq( 'home', 'ice' ) < eq( 'pons', 'ice' ) && eq( 'home', 'rope' ) < eq( 'pons', 'rope' ), 'ice and rope are cheap at Home' );
	ok( GOOD_IDS.filter( ( g ) => PORT_IDS.some( ( p ) => legalAt( p, g ) ) ).every( ( g ) => Math.max( ...PORT_IDS.map( ( p ) => eq( p, g ) ) ) / Math.min( ...PORT_IDS.map( ( p ) => eq( p, g ) ) ) > 1.4 ), 'every open good sells at least 40% dearer at some port than at another' );
	ok( EVENTS.every( ( e ) => GOODS[ e.good ] && e.ports.every( ( p ) => PORTS[ p ] ) && e.mult > 0 && e.dur[ 0 ] > 0 && e.dur[ 1 ] >= e.dur[ 0 ] && e.text.includes( '{pct}' ) ), 'event templates point at real goods and ports' );
	ok( BOAT_IDS.every( ( b ) => HOLD_CRATES[ b ] > 0 ) && HOLD_CRATES.foot === 2, 'a hold size for every boat id, 2 crates on foot' );
	ok( Math.max( ...Object.values( EVENTS.map( ( e ) => e.mult ) ) ) >= 1.6 && EVENTS.some( ( e ) => e.mult < 1 ), 'events include shortages and gluts' );

}

// ---- the market model: buying raises the price, selling lowers it, it recovers
{

	const m = new Market( { noise: 0, events: false } );
	const p0 = m.mid( 'home', 'salt' );
	ok( near( p0, GOODS.salt.base * REGION.home.salt, 1e-9 ), 'no drift, no trade: the price is the equilibrium' );
	ok( m.ask( 'home', 'salt' ) > p0 && m.bid( 'home', 'salt' ) < p0, 'the stall asks over and pays under the middle price' );
	m.applyBuy( 'home', 'salt', 10 );
	const p1 = m.mid( 'home', 'salt' );
	ok( p1 > p0 * 1.1, `buying 10 sacks raises the price (${ p0.toFixed( 2 ) } to ${ p1.toFixed( 2 ) })` );
	ok( near( m.mid( 'pons', 'salt' ), GOODS.salt.base * REGION.pons.salt, 1e-9 ), 'the other port is not touched' );
	m.applySell( 'home', 'salt', 25 );
	ok( m.mid( 'home', 'salt' ) < p0 * 0.9, 'selling 25 lowers it under the equilibrium' );

	// recovery over in-game hours: monotone, the time constant is the good's own
	const r = new Market( { noise: 0, events: false } );
	r.applyBuy( 'pons', 'pearls', 6 );
	const eqP = r.eq( 'pons', 'pearls' );
	const dev = () => Math.abs( Math.log( r.mid( 'pons', 'pearls' ) / eqP ) );
	const d0 = dev();
	const devs = [ d0 ];
	for ( let i = 0; i < 4; i ++ ) {

		r.advance( GOODS.pearls.recover );
		devs.push( dev() );

	}

	ok( devs.every( ( d, i ) => i === 0 || d < devs[ i - 1 ] ), 'the price falls back toward equilibrium every period' );
	ok( near( devs[ 1 ] / devs[ 0 ], Math.exp( - 1 ), 0.01 ), 'one recovery period fades the push by a factor e' );
	ok( devs[ 4 ] < 0.02 * d0 + 0.005, 'after four periods the market has all but recovered' );
	ok( GOOD_IDS.every( ( g ) => GOODS[ g ].recover <= 16 ), 'recovery periods are hours of game time (at most 16 h, 27 minutes real)' );

	// drift: a mood away from the equilibrium fades; the live walk stays in a band and does move
	const d = new Market( { noise: 0, events: false } );
	d.cells.home.rum.w = 0.3;
	d.advance( MARKET.noiseTau );
	ok( near( d.cells.home.rum.w, 0.3 / Math.E, 0.003 ), 'the drift returns toward equilibrium with its time constant' );
	const w = new Market( { noise: 1, events: false, seed: 4242 } );
	let sum = 0, sq = 0, n = 0, worst = 0;
	for ( let i = 0; i < 1500; i ++ ) {

		w.advance( 2 );
		const l = Math.log( w.mid( 'home', 'rope' ) / w.eq( 'home', 'rope' ) );
		sum += l; sq += l * l; n ++; worst = Math.max( worst, Math.abs( l ) );

	}

	const sd = Math.sqrt( sq / n - ( sum / n ) ** 2 );
	ok( Math.abs( sum / n ) < 0.025 && sd > 0.03 && sd < 0.12 && worst < 0.45, `prices wander around the equilibrium (mean ${ ( sum / n ).toFixed( 3 ) }, sd ${ sd.toFixed( 3 ) }, worst ${ worst.toFixed( 2 ) })` );
	const hist = w.cells.home.rope.hist;
	ok( hist.length === MARKET.histLen && hist.every( ( v ) => v > 0 ), 'the sparkline keeps two days of samples' );
	ok( new Market( { noise: 1, seed: 7 } ).cells.home.ice.hist.length === MARKET.histLen, 'a new market already has a past to draw' );

	// a round trip at one stall with no time passing always loses (spread and rounding)
	const q = new Market( { noise: 0, events: false } );
	let lossOnly = true;
	for ( const g of GOOD_IDS ) for ( const n2 of [ 1, 3, 8 ] ) {

		const buy = q.quoteBuy( 'home', g, n2 );
		q.applyBuy( 'home', g, n2 );
		const sell = q.quoteSell( 'home', g, n2, 1 );
		q.applySell( 'home', g, n2 );
		if ( sell.total >= buy.total ) lossOnly = false;

	}

	ok( lossOnly, 'buying and selling the same goods at one stall right away is always a loss' );
	const b3 = q.quoteBuy( 'pons', 'pearls', 3 ), s3 = q.quoteSell( 'pons', 'pearls', 3, [ 1, 0.5, 0 ] );
	ok( Number.isInteger( b3.total ) && b3.total >= b3.raw && Number.isInteger( s3.total ) && s3.total <= s3.raw, 'purchases round up and sales round down (whole dollars)' );
	ok( s3.units[ 2 ] === 0 && s3.units[ 1 ] < s3.units[ 0 ], 'spoiled units fetch less than fresh ones' );

}

// ---- events
{

	const m = new Market( { noise: 0, events: false } );
	const base = m.mid( 'home', 'timber' );
	const e = m.forceEvent( 'wreck', { dur: 40 } );
	ok( e && e.text === 'Storm wrecked a supply ship: timber +60% at Home', 'the storm event reads like the brief' );
	ok( m.news[ 0 ].text === e.text && m.news[ 0 ].kind === 'event', 'it is posted as news' );
	m.advance( 1.5 );
	ok( near( m.mid( 'home', 'timber' ) / base, 1.3, 0.01 ), 'it eases in over three hours' );
	m.advance( 5 );
	ok( near( m.mid( 'home', 'timber' ) / base, 1.6, 0.001 ), 'timber is 60% dearer at Home while it lasts' );
	ok( near( m.mid( 'pons', 'timber' ) / ( GOODS.timber.base * REGION.pons.timber ), 1, 1e-9 ), 'the other port is not affected' );
	m.advance( 30 );
	ok( m.mid( 'home', 'timber' ) / base < 1.5, 'it eases out over the last hours' );
	m.advance( 10 );
	ok( m.events.length === 0 && near( m.mid( 'home', 'timber' ) / base, 1, 1e-9 ), 'then the event is over and the price is back' );
	const fest = m.forceEvent( 'festival' );
	ok( fest.good === 'rum' && fest.ports.join() === 'pons', 'a festival at Pons is a rum event' );
	const heat = m.forceEvent( 'heat' );
	ok( heat.ports.length === 2, 'a heat wave hits both ports' );
	const glut = m.forceEvent( 'saltGlut' );
	ok( glut.mult < 1 && /glut/i.test( glut.text ) && glut.text.includes( '-40%' ), 'a glut cuts the price' );

	// the schedule: a few a week, the first within the first day, never two on the same good at one port
	const heard = [];
	const s = new Market( { noise: 1, events: true, seed: 99 } );
	s.on( ( ev ) => heard.push( ev.event ) );
	ok( s.nextEventAt >= 10 && s.nextEventAt <= 20, 'the first event is due inside the first game day' );
	let overlap = false;
	for ( let h = 0; h < 24 * 70; h ++ ) {

		s.advance( 1 );
		const seen = new Set();
		for ( const ev of s.events ) for ( const p of ev.ports ) {

			const k = p + ':' + ev.good;
			if ( seen.has( k ) ) overlap = true;
			seen.add( k );

		}

	}

	const perWeek = [];
	for ( let wk = 0; wk < 10; wk ++ ) perWeek.push( heard.filter( ( ev ) => ev.start >= wk * 168 && ev.start < ( wk + 1 ) * 168 ).length );
	ok( heard.length >= 28 && heard.length <= 52, `about four events a week over ten weeks (${ heard.length }: ${ perWeek.join( ' ' ) })` );
	ok( perWeek.every( ( c ) => c >= 2 && c <= 8 ), 'every week has a few' );
	ok( ! overlap, 'two events never stack on the same good at the same port' );
	ok( new Set( heard.map( ( ev ) => ev.tpl ) ).size >= 8, 'a variety of events happens' );

}

// ---- the hold: crates by boat, independent from the fish cooler
{

	const caps = {};
	for ( const id of [ null, ...BOAT_IDS ] ) {

		const { trade, state } = make( { boat: id } );
		caps[ id ] = trade.capacity();
		ok( caps[ id ] === hold( id ) && caps[ id ] === ( id ? HOLD_CRATES[ id ] : 2 ), `capacity of ${ id || 'no boat' }: ${ caps[ id ] } crates` );
		trade.dispose();

	}

	ok( caps.null === 2 && caps.skiff < caps.canoe && caps.canoe < caps.cutter && caps.cutter < caps.launch && caps.launch < caps.lobster, 'bigger boats carry more' );
	ok( hold( 'mystery' ) === 2 && hold( 'x' ) >= 2, 'an unknown boat id still has a hold' );
	const { trade, state, features } = make( { boat: 'skiff', money: 5000 } );
	const cooler = state.stats.holdKg;
	const r = trade.buy( 'home', 'salt', 'max' );
	ok( r.ok && r.qty === 4 && r.limited === 'capacity' && trade.crates() === 4 && trade.free() === 0, 'max fills the skiff\'s four crates and no more' );
	ok( ! trade.buy( 'home', 'salt', 1 ).ok && trade.buy( 'home', 'salt', 1 ).reason === 'capacity', 'a full hold refuses more' );
	ok( state.stats.holdKg === cooler && state.holdKg === 0, 'the fish cooler is untouched by the cargo' );
	trade.sell( 'home', 'salt', 'all' );
	const t2 = trade.buy( 'home', 'timber', 'max' );
	ok( t2.qty === 2 && trade.crates() === 4, 'timber bundles take two crates each' );
	state.boat = null;
	ok( trade.capacity() === 2 && trade.free() === -2, 'trading the boat in leaves the cargo over the new capacity' );
	ok( ! trade.buy( 'home', 'rope', 1 ).ok, 'and buys nothing until it is sold down' );
	ok( trade.view( 'home' ).warnings.some( ( w ) => /over capacity/i.test( w ) ), 'the window warns about it' );
	ok( trade.sell( 'home', 'timber', 1 ).ok && trade.free() === 0, 'selling one bundle brings it back to the limit' );
	trade.dispose();

}

// ---- money and events through GameState / Features
{

	const { trade, state, features } = make( { boat: 'cutter', money: 200 } );
	const heard = { bought: [], sold: [] };
	features.on( 'cargoBought', ( e ) => heard.bought.push( e ) );
	features.on( 'cargoSold', ( e ) => heard.sold.push( e ) );
	const q = trade.market( 'home' ).quoteBuy( 'rum', 3 );
	const m0 = state.money;
	const b = trade.buy( 'home', 'rum', 3 );
	ok( b.ok && b.total === q.total && state.money === m0 - q.total, 'a purchase charges the quoted total through state.spend' );
	ok( heard.bought.length === 1 && heard.bought[ 0 ].good === 'rum' && heard.bought[ 0 ].qty === 3 && heard.bought[ 0 ].port === 'home' && near( heard.bought[ 0 ].price, q.total / 3, 0.01 ), 'cargoBought carries good, qty, price, port' );
	const poor = trade.buy( 'home', 'rum', 'max' );
	ok( poor.ok && poor.limited === 'money' && state.money >= 0 && state.money < trade.market( 'home' ).buy( 'rum' ), 'max stops at what the purse can pay' );
	ok( state.money < 200 && ! trade.buy( 'home', 'pearls', 1 ).ok && trade.buy( 'home', 'pearls', 1 ).reason === 'money', 'cannot buy what you cannot pay for' );
	const earned0 = state.career.earned, m1 = state.money;
	const s = trade.sell( 'pons', 'rum', 2 );
	ok( s.ok && state.money === m1 + s.total && state.career.earned === earned0 + s.total, 'a sale pays through state.earn (career earnings too)' );
	ok( heard.sold.length === 1 && heard.sold[ 0 ].port === 'pons' && heard.sold[ 0 ].qty === 2 && heard.sold[ 0 ].profit === s.profit && typeof heard.sold[ 0 ].price === 'number', 'cargoSold carries good, qty, price, port, profit' );
	ok( ! trade.sell( 'pons', 'pearls', 1 ).ok && trade.sell( 'pons', 'pearls', 1 ).reason === 'empty', 'cannot sell what you do not carry' );
	ok( ! trade.buy( 'nowhere', 'rum', 1 ).ok && ! trade.buy( 'home', 'gold', 1 ).ok && ! trade.buy( 'home', 'rum', 0 ).ok && ! trade.buy( 'home', 'rum', - 3 ).ok && ! trade.buy( 'home', 'rum', 'lots' ).ok, 'bad ports, goods and quantities are refused' );
	const mine = trade.takeCargo( 'rum', 5 );
	ok( mine.qty === trade.cargo.rum ? false : mine.qty > 0, 'takeCargo removes cargo for other systems (a pirate, a quest)' );
	ok( trade.addCargo( 'pearls', 3, { cond: 0.9, paid: 100, port: 'pons' } ) === 3 && trade.cargo.pearls.qty === 3 && near( trade.cargo.pearls.cond, 0.9, 1e-9 ), 'addCargo takes loot aboard' );
	ok( trade.addCargo( 'timber', 20 ) < 20 && trade.crates() <= trade.capacity(), 'loot is limited by the free crates' );
	trade.dispose();

	// sandbox: purchases are free, sales still pay
	const sb = make( { boat: 'skiff', money: 0, mode: 'sandbox' } );
	ok( sb.state.free, 'sandbox mode is free play' );
	const rb = sb.trade.buy( 'home', 'rum', 'max' );
	ok( rb.ok && rb.qty === 4 && sb.state.money === 0, 'sandbox: stocking up costs nothing' );
	const rs = sb.trade.sell( 'pons', 'rum', 'all' );
	ok( rs.ok && sb.state.money === rs.total && rs.profit > 0, 'sandbox: the sale still pays' );
	ok( sb.trade.view( 'home' ).sandbox, 'and the window says so' );
	sb.trade.dispose();

}

// ---- spoilage
{

	const { trade, state } = make( { boat: 'cutter', money: 5000 } );
	trade.buy( 'home', 'ice', 3 );
	trade.buy( 'home', 'rum', 3 );
	trade.buy( 'home', 'coconuts', 2 );
	trade.advance( 10 );
	const c = trade.cargo;
	ok( near( c.ice.cond, Math.exp( - 0.03 * 10 ), 1e-6 ), `ice melts: ${ Math.round( c.ice.cond * 100 ) }% after ten hours` );
	ok( c.rum.cond === 1 && near( c.coconuts.cond, Math.exp( - 0.005 * 10 ), 1e-6 ), 'rum keeps and coconuts barely turn' );
	const expect = trade.sim.quoteSell( 'pons', 'ice', 3, c.ice.cond ).total;
	const fresh = trade.sim.quoteSell( 'pons', 'ice', 3, 1 ).total;
	const sold = trade.sell( 'pons', 'ice', 'all' );
	ok( sold.total === expect && sold.total < fresh * 0.8, `melted ice fetches ${ sold.total } instead of ${ fresh }` );
	ok( state.money > 0 && trade.cargo.ice === undefined, 'a sale clears the ice from the hold' );
	trade.buy( 'home', 'ice', 2 );
	trade.advance( 150 );
	ok( trade.cargo.ice === undefined && trade.news.some( ( n ) => /ice spoiled/i.test( n.text ) ), 'ice left in the hold for days is gone, and the news says so' );
	ok( trade.cargo.rum && trade.cargo.rum.qty === 3 && trade.cargo.rum.cond === 1, 'while the rum is fine' );
	trade.dispose();

	// a slow boat pays for it: the same ice shows a smaller margin on foot than in the fast lobster boat
	const slow = make( { boat: null } ), fast = make( { boat: 'lobster' } );
	const mi = ( t ) => t.view( 'home' ).rows.find( ( r ) => r.id === 'ice' ).margin;
	ok( slow.trade.voyageHours() > 5 * fast.trade.voyageHours() && mi( slow.trade ) < mi( fast.trade ), 'a slow voyage costs spoilage in the projected margin' );
	slow.trade.dispose();
	fast.trade.dispose();

}

// ---- a profitable route exists, and it is not free money
{

	const { trade, state } = make( { boat: 'launch', money: 5000 } );
	const start = state.money;
	const view0 = trade.view( 'home' );
	ok( view0.rows.some( ( r ) => r.room > 0 ) && view0.tip, 'at Home something pays at Pons (the window suggests a load)' );
	const trip = [];
	const first = leg( trade, state, 'home', 'pons', 1 ) + leg( trade, state, 'pons', 'home', 1 );
	trip.push( first );
	ok( first > 100, `the first round trip in a launch earns $${ first }` );
	for ( let i = 0; i < 9; i ++ ) trip.push( leg( trade, state, 'home', 'pons', 1 ) + leg( trade, state, 'pons', 'home', 1 ) );
	const late = trip.slice( 7 );
	ok( Math.max( ...late ) < first / 2, `repeating it wears the margin out ($${ trip.join( ', ' ) })` );
	ok( trip.every( ( t ) => t > - 15 ), 'a trader who reads the window never loses much' );
	ok( state.money - start === Math.round( trade.ledger.net() ) || near( state.money - start, trade.ledger.net(), 0.5 ), 'the ledger profit after the harbour dues is the money made' );

	// leave the markets alone for three days and the route is back
	trade.advance( 72 );
	const again = leg( trade, state, 'home', 'pons', 1 ) + leg( trade, state, 'pons', 'home', 1 );
	ok( again > first * 0.6, `after three quiet days the route pays again ($${ again } against $${ first })` );
	trade.dispose();

	// no time passing at all: the profit available is finite
	const inst = make( { boat: 'launch', money: 5000 } );
	const loops = [];
	for ( let i = 0; i < 12; i ++ ) loops.push( leg( inst.trade, inst.state, 'home', 'pons', 0 ) + leg( inst.trade, inst.state, 'pons', 'home', 0 ) );
	const total = loops.reduce( ( a, b ) => a + b, 0 );
	ok( loops.slice( 6 ).every( ( v ) => v <= 5 ), `instant back-and-forth dries up ($${ loops.join( ', ' ) })` );
	ok( total < loops[ 0 ] * 3, 'the whole pile is a few trips\' worth, not a printing press' );
	inst.trade.dispose();

	// piling everything into one good is worse than reading the window
	const a = make( { boat: 'launch', money: 5000 } ), b = make( { boat: 'launch', money: 5000 } );
	const room = a.trade.view( 'pons' ).rows.find( ( r ) => r.id === 'pearls' ).room;
	a.trade.buy( 'pons', 'pearls', room );
	b.trade.buy( 'pons', 'pearls', 'max' );
	for ( const t of [ a, b ] ) {

		t.trade.advance( 1 );
		t.trade.visit( 'home' );
		t.trade.sell( 'home', 'pearls', 'all' );

	}

	ok( room >= 1 && room < 11 && a.state.money > 5000 && a.state.money > b.state.money, `eleven pearls at once earn less than ${ room } (the window said ${ room })` );
	a.trade.dispose();
	b.trade.dispose();

	// the window's room figure is where the marginal unit stops paying
	const t3 = make( { boat: 'lobster', money: 50000 } );
	const rr = t3.trade.view( 'pons' ).rows.find( ( r ) => r.id === 'spices' );
	const m3 = t3.trade.sim;
	const seen = t3.trade.seen.home.spices.sell;
	const k = m3.impact( 'home', 'spices' );
	const nextUnit = seen * Math.exp( - k * rr.room ) * Math.exp( - GOODS.spices.perish * t3.trade.voyageHours() ) - m3.unitAsk( 'pons', 'spices', rr.room );
	const lastUnit = seen * Math.exp( - k * ( rr.room - 1 ) ) * Math.exp( - GOODS.spices.perish * t3.trade.voyageHours() ) - m3.unitAsk( 'pons', 'spices', rr.room - 1 );
	ok( rr.room > 0 && lastUnit > 0 && ( nextUnit <= 0 || rr.room === 20 ), 'view().room is the last unit that still pays' );
	t3.trade.dispose();

}

// ---- the ledger and the trips
{

	const { trade, state } = make( { boat: 'cutter', money: 5000 } );
	trade.open( 'home' );
	ok( trade.isOpen && trade.openPort === 'home', 'the window opens headless (no DOM needed)' );
	trade.buy( 'home', 'rum', 4 );
	trade.buy( 'home', 'rope', 3 );
	trade.close();
	ok( ! trade.isOpen, 'and closes' );
	trade.advance( 1.4 );
	trade.open( 'pons' );
	ok( trade.ledger.trips === 1 && trade.ledger.crossings === 1, 'a crossing with cargo aboard is a trip' );
	trade.sell( 'pons', 'rum', 'all' );
	trade.sell( 'pons', 'rope', 'all' );
	const L = trade.ledger;
	ok( L.routes[ 'home>pons' ] && L.routes[ 'home>pons' ].units === 7 && L.routes[ 'home>pons' ].profit > 0, 'the route Home to Pons is booked with units and profit' );
	ok( L.best && L.best.to === 'pons' && L.best.from === 'home' && L.best.profit > 0, 'the best trade is remembered' );
	ok( L.sold === 7 && L.bought === 7 && near( L.profit, L.revenue - L.spent, 0.01 ), 'units, spent and revenue add up' );
	trade.buy( 'pons', 'coconuts', 2 );
	trade.sell( 'pons', 'coconuts', 2 );
	ok( L.routes[ 'pons>pons' ] && L.routes[ 'pons>pons' ].profit < 0 && L.routeList().some( ( r ) => /quick flips/.test( r.label ) ), 'buying and selling at one stall is a quick flip, and it loses' );
	trade.open( 'home' );
	ok( L.trips === 1 && L.crossings === 2, 'crossing back empty is not a trip' );
	const lj = new Ledger();
	lj.fromJSON( JSON.parse( JSON.stringify( L.toJSON() ) ) );
	ok( JSON.stringify( lj.toJSON() ) === JSON.stringify( L.toJSON() ), 'the ledger survives its own JSON' );
	ok( ! new Ledger().fromJSON( null ) && new Ledger().fromJSON( { routes: { 'x>y': { sales: 1 } }, goods: { gold: {} }, best: { good: 'nope' } } ), 'a bad ledger save is ignored piece by piece' );

	// the window's data and text
	const v = trade.view( 'home' );
	ok( v.rows.length === GOOD_IDS.length && v.rows.every( ( r ) => r.buy > r.sell && r.hist.length > 5 && r.other && typeof r.margin === 'number' && r.can ), 'the window lists every good: buy, sell, trend, other port, margin' );
	ok( v.rows.every( ( r ) => r.other.rumour ) === false && v.rows.some( ( r ) => ! r.other.rumour ), 'prices seen at Pons are no longer rumours' );
	ok( v.capacity === 8 && v.used === 0 && v.projected.has === false, 'capacity and used crates are in the view' );
	trade.buy( 'home', 'rum', 3 );
	const pv = trade.view( 'home' );
	ok( pv.projected.has && pv.projected.cost > 0 && pv.projected.value > pv.projected.cost && pv.projected.profit === pv.projected.value - pv.projected.cost, 'the projected profit is the cargo sold at the other port at the prices last seen' );
	const html = new TradePanel( trade );
	const lh = html.ledgerHtml( pv ), nh = html.newsHtml( pv );
	ok( /Home to Pons Cove/.test( lh ) && /Net profit/.test( lh ) && /Best trade/.test( lh ), 'the ledger tab renders the routes and the best trade' );
	ok( /Happening now/.test( nh ), 'the news tab renders' );
	trade.dispose();

}

// ---- the clock: hours from app.settings.timeOfDay, a day counter
{

	const { app, trade } = make( { boat: 'cutter' } );
	trade.update( 0.016 ); // reads the clock: no time passes on the first frame
	ok( trade.time === 0 && trade.day === 1, 'the first frame only reads the clock' );
	for ( let i = 0; i < 100; i ++ ) {

		app.settings.timeOfDay += 0.01;
		trade.update( 0.016 );

	}

	ok( near( trade.time, 1.0, 1e-6 ), 'a hundred small steps are one hour' );
	app.settings.timeOfDay = 23.95;
	trade.update( 0.016 );
	const t0 = trade.time;
	app.settings.timeOfDay = 0.05; // past midnight: 0.1 h
	trade.update( 0.016 );
	ok( trade.day === 2 && near( trade.time - t0, 0.1, 1e-6 ), 'midnight advances the day counter and the clock continues' );
	const t1 = trade.time;
	app.settings.timeOfDay = 18; // a loaded save or a slider jump
	trade.update( 0.016 );
	app.settings.timeOfDay = 6;
	trade.update( 0.016 );
	ok( trade.time === t1 && trade.day === 2, 'a jump or a rewind is not elapsed time' );
	app.settings.timeOfDay = 6; // paused
	trade.update( 0.016 );
	ok( trade.time === t1, 'a stopped clock stops the markets' );
	trade.dispose();

}

// ---- the interactables and the sites
{

	const { features, trade, app } = make( { boat: 'skiff' } );
	const home = stallFront( STALL_SITES.home ), pons = stallFront( STALL_SITES.pons );
	const nh = features.nearestInteractable( { x: home.x, y: 2, z: home.z } );
	const np = features.nearestInteractable( { x: pons.x + 1, y: 2, z: pons.z - 1 } );
	ok( nh && nh.id === 'trade:home' && np && np.id === 'trade:pons', 'a stall at each port is an E interactable' );
	ok( features.nearestInteractable( { x: 0, y: 2, z: 0 } ) === null && features.nearestInteractable( { x: 60, y: 2, z: 0 } ) === null, 'and only there' );
	ok( /Trade at the Home market/.test( nh.prompt() ) && /Pons Cove market/.test( np.prompt() ), 'the prompt names the market' );
	nh.onInteract();
	ok( trade.isOpen && trade.openPort === 'home' && /Leave/.test( nh.prompt() ), 'E opens the window' );
	nh.onInteract();
	ok( ! trade.isOpen, 'E again closes it' );
	trade.open( 'home' );
	app.player.position = { x: home.x + 30, y: 2, z: home.z };
	trade.update( 0.016 );
	ok( ! trade.isOpen, 'walking away from the stall closes it' );
	app.player.mode = 'boat';
	ok( features.nearestInteractable( { x: home.x, y: 2, z: home.z } ) === null, 'not from the helm of a boat' );
	app.player.mode = 'walk';

	const d = ( a, b ) => Math.hypot( a.x - b.x, a.z - b.z );
	ok( d( STALL_SITES.home, STAND ) > 5 && d( STALL_SITES.home, STAND ) < 14, `the Home stall stands ${ d( STALL_SITES.home, STAND ).toFixed( 1 ) } m from PoorGoat's stand` );
	ok( d( STALL_SITES.home, CHANDLERY ) > 15, 'and well clear of Ethena\'s chandlery' );
	ok( d( STALL_SITES.pons, PONS_STAND ) > 5 && d( STALL_SITES.pons, PONS_STAND ) < 14, `the Pons stall stands ${ d( STALL_SITES.pons, PONS_STAND ).toFixed( 1 ) } m from Pons's stall` );
	ok( near( STALL_SITES.pons.yaw, WORLD.pons.dock.heading, 1e-9 ) && Math.hypot( STALL_SITES.pons.x - WORLD.pons.dock.start.x, STALL_SITES.pons.z - WORLD.pons.dock.start.z ) < 40, 'the Pons stall faces the dock and is near its foot' );
	ok( Math.hypot( STALL_SITES.home.x - 53.6, STALL_SITES.home.z - ( - 77 ) ) < 10, 'the Home stall is by the boardwalk where the player starts' );
	trade.dispose();
	ok( features._interactables.size === 0, 'disposing removes the interactables' );

}

// ---- the stall prop: one merged mesh per stall
{

	for ( const v of [ 'home', 'pons' ] ) {

		const g = buildStallGeometry( v );
		const tris = triangleCount( g );
		const bb = g.boundingBox;
		ok( tris > 500 && tris < 8000, `${ v } stall: ${ tris } triangles in one geometry` );
		ok( [ 'position', 'normal', 'uv', 'color', 'aux' ].every( ( a ) => g.attributes[ a ] ), `${ v } stall: the prop material's attributes` );
		ok( bb.max.y > 2.4 && bb.max.y < 3.2 && bb.max.x - bb.min.x < 5 && bb.max.z - bb.min.z < 4, `${ v } stall: awning ${ bb.max.y.toFixed( 2 ) } m high, ${ ( bb.max.x - bb.min.x ).toFixed( 1 ) } m wide` );

	}

	const scene = { kids: [], add( o ) { this.kids.push( o ); }, remove( o ) { this.kids = this.kids.filter( ( k ) => k !== o ); } };
	const colliders = { boxes: [], cylinders: [], addBox( c, h, r, o ) { const b = { c, h, r, ...o }; this.boxes.push( b ); return b; }, addCylinder( x, z, r, a, b, o ) { const c = { x, z, r, ...o }; this.cylinders.push( c ); return c; } };
	const stall = new TradeStall( { scene, terrain: { heightAt: () => 2.3 }, colliders, site: STALL_SITES.home, variant: 'home' } );
	ok( scene.kids.length === 1 && stall.group.children.length === 1, 'a stall is one mesh in the scene (one draw call)' );
	ok( colliders.boxes.length >= 3 && colliders.cylinders.length >= 5 && stall.lights.length === 1, 'it blocks the counter, the crates and the posts, and carries a lantern' );
	ok( near( stall.group.position.y, 2.3, 1e-9 ) && near( stall.group.rotation.y, STALL_SITES.home.yaw, 1e-9 ), 'placed on the ground at its site and yaw' );
	// on a slope the platform sits on the highest ground under it
	const slope = { heightAt: ( x, z ) => 2 + 0.1 * ( z + 100 ) };
	const sl = new TradeStall( { scene, terrain: slope, site: STALL_SITES.home, variant: 'home' } );
	let top = - Infinity;
	for ( const [ ax, az ] of [ [ 0, 0 ], [ - 1.45, - 1.45 ], [ 1.45, - 1.45 ], [ - 1.45, 1.45 ], [ 1.45, 1.45 ] ] ) {

		const [ wx, wz ] = stallWorld( STALL_SITES.home, ax, az );
		top = Math.max( top, slope.heightAt( wx, wz ) );

	}

	ok( near( sl.group.position.y, top, 1e-9 ) && top > slope.heightAt( STALL_SITES.home.x, STALL_SITES.home.z ), 'on a slope it sits on the highest ground under the platform' );
	sl.dispose();
	stall.dispose();
	ok( scene.kids.length === 0 && colliders.boxes.length === 0 && colliders.cylinders.length === 0, 'and removed cleanly' );

	// installed with a scene it builds both stalls and hands out their lanterns
	const state = new GameState( store() );
	const app = { settings: { timeOfDay: 9.5 }, game: { state }, scene, terrainData: { heightAt: () => 2 }, colliders, player: { mode: 'walk', position: { x: 0, y: 0, z: 0 } } };
	const features = new Features( app );
	const t = features.add( 'trade', tradeModule );
	ok( t && Object.keys( t.stalls ).length === 2 && scene.kids.length === 2 && t.lights.length === 2, 'install builds the two stalls and exposes their lights' );
	features.dispose();
	ok( scene.kids.length === 0, 'features.dispose() takes the stalls down' );

}

// ---- save and load
{

	const a = make( { boat: 'cutter', money: 5000, noise: 1, events: true, seed: 31337 } );
	const t = a.trade;
	t.open( 'home' );
	t.buy( 'home', 'rum', 3 );
	t.buy( 'home', 'ice', 2 );
	t.advance( 30 );
	t.forceEvent( 'wreck' );
	t.advance( 3 );
	t.open( 'pons' );
	t.sell( 'pons', 'rum', 2 );
	t.close();
	const saved = JSON.parse( JSON.stringify( t.toJSON() ) );
	ok( saved.v === 2 && saved.lots.length === 2 && saved.ledger.sold === 2 && saved.sim.events.length >= 1, 'toJSON is plain data (cargo, ledger, markets, events)' );
	ok( JSON.stringify( saved ).length < 40000, `and small (${ JSON.stringify( saved ).length } characters)` );

	// through the Features registry, the way the game loads: data first, then the module is added
	const b = make( { boat: 'cutter', money: 5000, noise: 1, events: true, seed: 5 } );
	b.trade.fromJSON( saved );
	const cb = b.trade.cargo, ct = t.cargo;
	ok( Object.keys( ct ).length === 2 && Object.keys( ct ).every( ( g ) => cb[ g ] && cb[ g ].qty === ct[ g ].qty && near( cb[ g ].cond, ct[ g ].cond, 1e-3 ) && near( cb[ g ].paid, ct[ g ].paid, 0.01 ) ), 'cargo survives (quantity, condition, what was paid)' );
	ok( b.trade.day === t.day && b.trade.lastPort === t.lastPort && b.trade.ledger.trips === t.ledger.trips && near( b.trade.ledger.profit, t.ledger.profit, 0.01 ), 'day, last port and ledger survive' );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => near( b.trade.sim.mid( p, g ) / t.sim.mid( p, g ), 1, 1e-3 ) ) ), 'every price at both ports survives' );
	ok( b.trade.sim.events.length === t.sim.events.length && b.trade.news.length === t.news.length && near( b.trade.sim.nextEventAt, t.sim.nextEventAt, 1e-3 ) && b.trade.events[ 0 ].text === t.events[ 0 ].text, 'events, news and the schedule survive' );
	ok( b.trade.view( 'home' ).rows.every( ( r, i ) => { const h = t.view( 'home' ).rows[ i ].hist; return r.hist.length === h.length && r.hist.every( ( v, j ) => near( v / h[ j ], 1, 2e-3 ) ); } ), 'the sparklines survive' );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => b.trade.seen[ p ][ g ].sell === t.seen[ p ][ g ].sell && b.trade.seen[ p ][ g ].rumour === t.seen[ p ][ g ].rumour ) ), 'the prices last seen survive' );
	t.advance( 80 );
	b.trade.advance( 80 );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => near( b.trade.sim.mid( p, g ), t.sim.mid( p, g ), 0.01 ) ) ) && b.trade.sim.events.length === t.sim.events.length, 'and both go on the same way afterwards (the random walk is saved)' );

	// the registry path
	const store2 = new Features( { settings: { timeOfDay: 9 }, game: { state: new GameState( store() ) }, player: { mode: 'walk', position: { x: 0, y: 0, z: 0 } } } );
	store2.fromJSON( { trade: saved } );
	const inst = store2.add( 'trade', tradeModule );
	ok( inst.cargo.rum && inst.cargo.rum.qty === 1 && inst.ledger.sold === 2, 'Features.add restores the saved part' );
	const out = store2.toJSON();
	ok( out.trade && out.trade.v === 2 && out.trade.ledger.sold === 2, 'Features.toJSON includes it' );
	store2.dispose();

	// the clock after a load is not elapsed time
	b.app.settings.timeOfDay = 3;
	b.trade.update( 0.016 );
	const before = b.trade.time;
	b.trade.fromJSON( saved );
	b.app.settings.timeOfDay = 15;
	b.trade.update( 0.016 );
	ok( b.trade.time === b.trade.sim.abs && b.trade.sim.abs === saved.sim.abs, 'loading does not run the clock forward' );

	// a bad save never throws and leaves a working feature
	const c = make( { boat: 'skiff' } );
	let threw = false;
	for ( const junk of [ null, undefined, 5, 'x', [], {}, { lots: 5 }, { lots: [ null, { good: 'gold', qty: 3 }, { good: 'rum', qty: - 4 }, { good: 'rum', qty: 2, cond: 9, paid: 'a' } ] }, { sim: { cells: 7, events: [ { good: 'x' } ], news: [ 1 ] } }, { seen: { home: { rum: [ 'a' ] } } }, { ledger: 4 }, { day: 'many' } ] ) {

		try { c.trade.fromJSON( junk ); } catch ( e ) { threw = true; console.log( e ); }

	}

	ok( ! threw, 'garbage saves are ignored without throwing' );
	ok( c.trade.market( 'home' ).price( 'rum' ) > 0 && c.trade.buy( 'home', 'salt', 1 ).ok, 'the feature works afterwards' );
	c.trade.fromJSON( { lots: [ { good: 'rum', qty: 2, cond: 9, paid: 'a' } ] } );
	ok( c.trade.cargo.rum.qty === 2 && c.trade.cargo.rum.cond === 1 && c.trade.cargo.rum.paid === 0, 'a half-valid cargo entry is repaired, not dropped' );
	c.trade.reset();
	ok( c.trade.crates() === 0 && c.trade.ledger.sold === 0 && c.trade.day === 1 && c.trade.sim.abs === 0, 'reset starts a new game' );

}

// ---- headless: nothing needs a DOM, and a registry with every default option still works
{

	ok( typeof document === 'undefined', 'this test runs without a DOM' );
	const state = new GameState( store() );
	const f = new Features( { settings: { timeOfDay: 9.5 }, game: { state } } );
	const t = f.add( 'trade', tradeModule );
	ok( t instanceof Trade && f.get( 'trade' ) === t, 'Features.add( \'trade\', module ) returns the instance' );
	f.update( 0.016 );
	f.update( 0.016 );
	ok( ! t.open( 'nowhere' ) && t.open( 'home' ) && t.panel.isOpen === false, 'the window object is lazy: no DOM, no panel' );
	ok( typeof t.market( 'home' ).price( 'ice' ) === 'number' && t.market( 'nowhere' ) === null, 'market( portId ) answers prices' );
	f.dispose();

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
