// Plain-node tests of the wave-15B economy (src/features/trade): port identities (each port makes some goods cheap
// and wants others dear, the demand fills up as you sell), the route maths behind the window and the harbourmaster's
// board (margin per crate, hours, pirate lanes), rival convoys that move prices, the flood after a bulk sale, harbour
// dues and insurance, the Tidemark warehouse, licences for luxuries and bulk lots, the fish halls (freshness, taste,
// the wanted species) and the migration of a wave-14 save. No DOM, no GPU.
//   node test/feature-economy.mjs
import * as tradeModule from '../src/features/trade/index.js';
import { install, FLOOD } from '../src/features/trade/index.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { GOODS, GOOD_IDS, PORTS, PORT_IDS, REGION, PORT_IDENTITY, CAUSES, EVENTS, HOLD_CRATES, legalAt, identity, isFine } from '../src/features/trade/goods.js';
import { Market, packHist, unpackHist } from '../src/features/trade/market.js';
import { lanesCrossed, bestSale, bestSource, roomFor, board, riskOf } from '../src/features/trade/routes.js';
import { DUES, INSURANCE } from '../src/features/trade/Dues.js';
import { WAREHOUSE } from '../src/features/trade/Warehouse.js';
import { LICENCES, LICENCE_LOTS } from '../src/features/trade/HaulContracts.js';
import { OPERATING } from '../src/features/trade/Operating.js';
import { FISH_HALL, fishFreshness, fishSaleFactor } from '../src/game/FishStand.js';
import { FISH } from '../src/game/FishTable.js';
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

function make( { boat = 'trawler', money = 5000, noise = 0, events = false, mode = null, seed, rivals, extra = {} } = {} ) {

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

// a wave-14 trade save (the old code's toJSON after a few trades, trimmed to three ports and five goods): v 1, the
// sparklines as price arrays, every seen price as [ buy, sell, mid, t, rumour ], no dues / warehouse / fish halls
const W14 = {"v":1,"day":1,"lastPort":"pons","sim":{"abs":37,"next":76.7269,"rng":1294495258,"evId":2,"acc":1,"cells":{"home":{"ice":[0.0083,0.1211,[12.01,11.84,11.97,11.7,12,11.83,11.77,12.41,12.19,12.48,12.85,13.42,12.91,12.9,12.48,12.52,12.12,12.12,12.4,12.4,12.28,13.12,13.03,13.36]],"salt":[0,0.018,[8.5,8.72,8.49,8.63,8.65,8.26,8.58,8.46,8.52,8.27,8.26,8.46,8.61,8.45,8.58,8.43,8.94,8.66,8.18,7.85,7.84,7.8,7.54,8.01]],"rum":[0.0541,0.1926,[30.56,29.91,30.91,29.76,31.15,30.37,31.33,30.32,29.67,29.7,28.85,28.71,29.8,29.42,29.88,29.82,30.57,30.47,31.17,30.07,30.11,36.05,35.86,36.16]],"timber":[0,0.0931,[51.71,54.03,53.19,51.25,48.52,48.67,50.39,50.31,49.82,49.79,49.39,47.07,45.63,47.73,50.04,52.56,53.3,53.55,56.4,56.7,58.95,62.37,59.75,58.05]],"pearls":[-0.1679,-0.0175,[149.6,149.01,147.35,145.87,147.22,152.05,149.43,149.68,150.1,154.3,165.9,165.8,170.87,166.52,161.86,169.68,152.05,153.99,151.73,151.02,121.75,133.76,133.04,136.02]]},"pons":{"ice":[0,0.0469,[21.16,22.17,21.72,21.6,20.88,21.33,21.64,21.14,20.37,21.38,20.42,20.8,21.69,20.85,20.85,21.76,21.85,21.85,22.24,20.98,20.53,20.5,20.49,21.71]],"salt":[0,0.0356,[12.32,12.47,12.96,13.43,13.46,13.25,12.62,13.26,13.45,13.57,13.29,13.7,13.57,13.61,13.06,12.77,12.83,12.8,12.5,12.82,12.68,13.38,13.07,13.59]],"rum":[-0.0487,0.0782,[47.46,44.83,44.44,43.43,42.65,42.68,41.61,42.47,44.16,45.51,44.47,42.7,42.65,43.18,43.84,42.64,42.81,44.55,45.99,46.22,46.52,45.42,43.36,44.33]],"timber":[0.2224,0.0135,[33.14,33.36,32.88,32.95,32.55,31.59,31.7,31.9,32.75,31.33,29.86,28.85,30.51,30.94,30.73,30.9,29.54,30.14,30.92,30.85,31.23,31.87,32.69,40.3]],"pearls":[0.2575,0.014,[92.6,93.79,96.44,93.09,94.35,95.65,91.97,94.41,92.06,94.61,97.79,97.21,93.07,92.65,90.62,84.37,79.92,79.62,111.66,109.71,109.43,105.57,123.2,117.98]]},"gull":{"ice":[0,0.0243,[23.89,24.49,23.31,21.38,21.55,22.3,22.61,22.75,21.69,22.62,22.36,22.73,22.03,22.88,23.22,23.34,21.89,21.93,22.5,21.89,22.36,23.08,24.05,22.87]],"salt":[0,-0.085,[10.92,10.98,10.93,11.3,10.98,11.05,10.58,10.9,10.68,11.45,11.14,10.92,10.63,10.94,10.64,10.6,10.27,10.78,10.49,10.37,10.91,10.58,10.14,10.31]],"rum":[0,-0.0044,[47.93,45.27,44.88,45.96,45.17,44.73,44.91,46.74,44.59,45.07,45.21,46.29,47.72,48.64,48.77,47.19,47.1,48.52,49.15,46.57,45.38,46.14,47.46,46.32]],"timber":[0,-0.015,[58.37,60.36,56.99,57.17,59.96,57.69,58.91,58.18,60.43,62.59,61.93,62.71,62.91,62.03,60.78,56.96,57.01,57.5,56.21,53.86,55.95,55.27,55.25,55.42]],"pearls":[0,0.0273,[109.45,106.13,108.69,110.87,109.06,106.41,105.89,103.47,106.09,106.54,106.15,107.21,106.06,104.56,107.71,110.09,106.53,106.48,108.67,110.45,117.03,123.09,128.29,125.48]]}},"events":[{"id":1,"tpl":"smithy","good":"tools","ports":["home"],"mult":1.45,"start":16.422553330194205,"end":52.4778573284857,"text":"The Home smithy is cold for a week: iron tools +45% at Home"}],"news":[{"t":35,"text":"Old Teague's Ninefold loaded 5 palm timber at Pons Cove, bound for Home.","kind":"rival"},{"t":33,"text":"Captain Marlow's Salt Wren unloaded 10 hemp rope at Pons Cove.","kind":"rival"},{"t":30,"text":"Captain Marlow's Salt Wren loaded 10 hemp rope at Home, bound for Pons Cove.","kind":"rival"}]},"ledger":{"trips":1,"crossings":1,"bought":8,"spent":401,"sold":2,"revenue":83,"profit":16,"routes":{"home>pons":{"sales":1,"units":2,"revenue":83,"cost":67,"profit":16}},"goods":{"rum":{"units":2,"revenue":83,"cost":67,"profit":16}},"best":{"good":"rum","qty":2,"profit":16,"from":"home","to":"pons","day":1}},"seen":{"home":{"ice":[13.33,12.43,12.88,30,0],"salt":[8.12,7.57,7.84,30,0],"rum":[35.49,33.09,34.29,30,0],"timber":[61.01,56.88,58.95,30,0],"pearls":[126.01,117.49,121.75,30,0]},"pons":{"ice":[21.22,19.78,20.5,32,0],"salt":[13.84,12.91,13.38,32,0],"rum":[42.92,40.02,41.47,32,0],"timber":[32.98,30.75,31.87,32,0],"pearls":[131.05,122.19,126.62,32,0]},"gull":{"ice":[22.85,21.31,22.08,-24,1],"salt":[11.59,10.81,11.2,-24,1],"rum":[47.86,44.62,46.24,-24,1],"timber":[58.79,54.81,56.8,-24,1],"pearls":[124.2,115.8,120,-24,1]}},"lots":[{"good":"rum","port":"home","qty":2,"cond":1,"paid":67},{"good":"ice","port":"home","qty":2,"cond":0.8106,"paid":27},{"good":"pearls","port":"pons","qty":2,"cond":1,"paid":240}],"compare":{},"cool":{},"haul":{"licence":1,"rng":1382468,"next":1,"done":0,"failed":0,"boards":{},"active":[]},"credit":{"standing":10.05,"next":2,"loans":[{"id":1,"port":"pons","principal":200,"owed":202.35,"rate":0.055979999999999995,"taken":32,"due":104,"status":"open","why":"loan"}]},"rivals":{"rng":4242231487,"list":[{"id":"marlow","phase":"port","at":"pons","from":"home","to":null,"good":null,"qty":0,"eta":32.9116,"until":44.0366,"voyages":3},{"id":"vos","phase":"port","at":"home","from":"pons","to":null,"good":null,"qty":0,"eta":27.4939,"until":37.2129,"voyages":2},{"id":"teague","phase":"sea","at":"pons","from":"pons","to":"home","good":"timber","qty":5,"eta":37.3293,"until":34.1683,"voyages":3}]},"smuggler":{"business":0,"compartment":0,"papers":0,"push":{}},"operating":{"bait":20,"owed":0,"missed":0,"deserted":0,"hours":13,"days":1,"spent":{"bait":0,"wages":12,"upkeep":5}}};

// ---- port identities: made cheap, wanted dear, every good has its numbers
{

	const sig = { home: [ 'fish', 'rope', 'oil' ], pons: [ 'timber', 'resin' ], gull: [ 'salt', 'guano', 'wicks' ], key: [ 'reeds', 'eels', 'dyes' ], haven: [ 'cloth', 'iron' ], shrine: [ 'incense', 'carvings' ], shoal: [ 'pearls', 'shells' ], inverted: [ 'glass', 'fruit' ], tidemark: [ 'wine', 'silk', 'clocks' ] };
	ok( Object.keys( sig ).every( ( p ) => sig[ p ].every( ( g ) => GOODS[ g ] && PORT_IDENTITY[ p ].produces.includes( g ) && PORT_IDENTITY[ p ].signature.includes( g ) ) ), 'each port makes what it is known for (home fish / rope / oil ... Tidemark wine / silk / clocks)' );
	ok( PORT_IDENTITY.blackwater && PORT_IDENTITY.blackwater.market === false && [ 'powder', 'plunder' ].every( ( g ) => GOODS[ g ].origin.includes( 'blackwater' ) ) && ! PORTS.blackwater, 'Blackwater deals powder and stolen goods (no stall: the pirates\' fence)' );
	ok( WORLD.ports.every( ( p ) => PORT_IDENTITY[ p.id ] && PORTS[ p.id ] ), 'every port of the world has an identity and a market' );
	ok( GOOD_IDS.length >= 30 && GOOD_IDS.every( ( g ) => GOODS[ g ].kg > 0 && GOODS[ g ].crates >= 1 && GOODS[ g ].perish >= 0 && Array.isArray( GOODS[ g ].tags ) ), `${ GOOD_IDS.length } goods, each with a weight, a crate size and a perish rate` );
	ok( ! legalAt( 'home', 'plunder' ) && PORT_IDS.every( ( p ) => ! legalAt( p, 'plunder' ) ) && legalAt( 'tidemark', 'silk' ), 'stolen goods are contraband everywhere; the luxuries are legal' );
	let bad = [];
	for ( const p of PORT_IDS ) {

		const I = identity( p );
		for ( const g of I.produces ) if ( legalAt( p, g ) && ! ( REGION[ p ][ g ] < 0.9 ) ) bad.push( `${ p } makes ${ g } at ${ REGION[ p ][ g ] }` );
		for ( const g of I.wants ) if ( legalAt( p, g ) && ! ( REGION[ p ][ g ] > 1.2 ) ) bad.push( `${ p } wants ${ g } at ${ REGION[ p ][ g ] }` );

	}

	ok( bad.length === 0, `a port's own goods are cheap there, its wants dear${ bad.length ? ': ' + bad.join( '; ' ) : '' }` );
	const eq = ( p, g ) => GOODS[ g ].base * REGION[ p ][ g ];
	bad = [];
	for ( const g of GOOD_IDS ) {

		const from = GOODS[ g ].origin.filter( ( p ) => PORTS[ p ] && legalAt( p, g ) ), to = GOODS[ g ].demand.filter( ( p ) => PORTS[ p ] && legalAt( p, g ) );
		if ( from.length && to.length && ! ( Math.max( ...from.map( ( p ) => eq( p, g ) ) ) < Math.min( ...to.map( ( p ) => eq( p, g ) ) ) * 0.8 ) ) bad.push( g );

	}

	ok( bad.length === 0, `every good is at least 20% cheaper where it is made than where it is wanted${ bad.length ? ': ' + bad.join( ', ' ) : '' }` );
	const tm = identity( 'tidemark' );
	ok( GOOD_IDS.filter( ( g ) => legalAt( 'tidemark', g ) && ! tm.produces.includes( g ) && ! tm.wants.includes( g ) ).every( ( g ) => REGION.tidemark[ g ] >= 0.95 && REGION.tidemark[ g ] <= 1.2 ) && PORTS.tidemark.size > PORTS.home.size, 'Tidemark is the big market: everything at a fair price, and the deepest' );
	ok( [ 'wine', 'silk', 'clocks' ].every( ( g ) => isFine( g ) && PORT_IDS.filter( ( p ) => p !== 'tidemark' && ! identity( p ).wants.includes( g ) ).every( ( p ) => REGION[ p ][ g ] > 1.15 ) ), 'the luxuries are rare away from Tidemark' );

	// Tidemark swings more: the same walk, its log prices spread wider
	const w = new Market( { noise: 1, events: false, seed: 515 } );
	let a = 0, b = 0;
	for ( let i = 0; i < 1200; i ++ ) {

		w.advance( 2 );
		a += Math.log( w.mid( 'tidemark', 'rope' ) / w.eq( 'tidemark', 'rope' ) ) ** 2;
		b += Math.log( w.mid( 'pons', 'rope' ) / w.eq( 'pons', 'rope' ) ) ** 2;

	}

	ok( a > b * 1.6, `Tidemark's prices wander more (variance ${ ( a / 1200 ).toFixed( 4 ) } against Pons ${ ( b / 1200 ).toFixed( 4 ) })` );

	// the demand fills up as you sell, and the producer restocks
	const m = new Market( { noise: 0, events: false } );
	const p0 = m.mid( 'tidemark', 'eels' ), k0 = m.mid( 'key', 'eels' );
	m.applySell( 'tidemark', 'eels', 12 );
	m.applyBuy( 'key', 'eels', 12 );
	const p1 = m.mid( 'tidemark', 'eels' ), k1 = m.mid( 'key', 'eels' );
	ok( p1 < p0 * 0.85 && k1 > k0 * 1.15, `selling eels at Tidemark fills the demand (${ p0.toFixed( 1 ) } to ${ p1.toFixed( 1 ) }); buying them at the Key empties the stall (${ k0.toFixed( 1 ) } to ${ k1.toFixed( 1 ) })` );
	m.advance( GOODS.eels.recover * 4 );
	ok( near( m.mid( 'tidemark', 'eels' ) / p0, 1, 0.03 ) && near( m.mid( 'key', 'eels' ) / k0, 1, 0.03 ), 'a few recovery periods later the demand is back and the stall restocked' );

}

// ---- route maths: best sale, best source, the board, lanes and hours
{

	const { trade, state } = make( { boat: 'trawler', money: 5000 } );
	for ( const p of PORT_IDS ) trade.visit( p );
	trade.visit( 'pons' );
	const b = trade.bestSale( 'pons', 'timber' );
	const ask = trade.sim.ask( 'pons', 'timber' );
	ok( b && ! b.here && near( b.margin, b.value - ask, 1e-6 ) && near( b.perCrate, b.margin / 2, 1e-9 ), `timber from Pons sells best at ${ b.name }: ${ b.margin.toFixed( 1 ) } a bundle, ${ b.perCrate.toFixed( 1 ) } a crate (two crates a bundle)` );
	ok( near( b.hours, trade.voyageHours( 'pons', b.port ), 1e-9 ) && b.metres > 0 && b.lanes === lanesCrossed( 'pons', b.port ), 'with the voyage\'s hours at the boat\'s speed, its distance and the pirate lanes it crosses' );
	let beaten = false;
	for ( const p of PORT_IDS ) {

		if ( p === 'pons' || ! legalAt( p, 'timber' ) ) continue;
		const h = trade.voyageHours( 'pons', p ), L = lanesCrossed( 'pons', p );
		const value = trade.seen[ p ].timber.sell * Math.exp( - GOODS.timber.perish * h );
		if ( value - ask - value * 0.01 * h - value * 0.02 * L > b.score + 1e-9 ) beaten = true;

	}

	ok( ! beaten, 'no other port scores better (margin, less a percent an hour and two a pirate lane)' );
	const src = trade.bestSource( 'home', 'timber' );
	ok( src && src.port === 'pons' && near( src.margin, trade.sim.bid( 'home', 'timber' ) * Math.exp( - GOODS.timber.perish * trade.voyageHours( 'pons', 'home' ) ) - trade.seen.pons.timber.buy, 1e-6 ), `Home wants timber: bring it from ${ src.port } (${ src.perCrate.toFixed( 1 ) } a crate)` );
	const bd = trade.board( 'home', 5 );
	ok( bd.length === 5 && bd.every( ( x, i ) => x.margin > 0 && x.room >= 1 && ( i === 0 || bd[ i - 1 ].perCrate >= x.perCrate ) ), `the harbourmaster's board: five loads from Home, best margin a crate first (${ bd.map( ( x ) => `${ x.good }>${ x.to } +${ x.perCrate.toFixed( 0 ) }` ).join( ', ' ) })` );
	const top = bd[ 0 ];
	const r = roomFor( trade, 'home', top.to, top.good, 40 );
	const unit = ( j ) => trade.seen[ top.to ][ top.good ].sell * Math.exp( - trade.sim.impact( top.to, top.good ) * j ) * Math.exp( - GOODS[ top.good ].perish * trade.voyageHours( 'home', top.to ) ) - trade.sim.unitAsk( 'home', top.good, j );
	ok( r.room === top.room && unit( r.room - 1 ) > 0 && ( r.room === 40 || unit( r.room ) <= 0 ), `its room is where the next unit stops paying (${ r.room })` );
	ok( lanesCrossed( 'home', 'pons' ) === 0 && lanesCrossed( 'inverted', 'pons' ) >= 1 && lanesCrossed( 'pons', 'inverted' ) === lanesCrossed( 'inverted', 'pons' ) && riskOf( 0 ) === 'safe' && riskOf( 2 ) === 'pirate waters', 'Home to Pons is safe; the run past the southern patrols crosses a pirate lane' );
	state.boat = 'skiff';
	ok( trade.route( 'home', 'tidemark' ).hours > 2.5 * trade.route( 'home', 'pons' ).hours && trade.route( 'home', 'pons' ).hours > 2 * ( 700 / 6.5 * 0.01 ), 'hours follow the distance and the boat\'s speed' );
	state.boat = 'trawler';

	// the window's rows: identity, trend, the news behind a swing, the routes
	trade.forceEvent( 'wreck' );
	trade.sim.post( 'Captain Marlow\'s Salt Wren unloaded 12 cane rum at Home.', 'rival', { good: 'rum', port: 'home' } );
	trade.sim.advance( 4 );
	for ( let i = 0; i < 6; i ++ ) trade.buy( 'home', 'rope', 3 );
	const v = trade.view( 'home' );
	const row = ( g ) => v.rows.find( ( x ) => x.id === g );
	ok( row( 'rope' ).made && row( 'timber' ).wanted && ! row( 'timber' ).made && ! row( 'salt' ).wanted, 'rows say made here / wanted here' );
	ok( /timber/i.test( row( 'timber' ).why ) && /rum/.test( row( 'rum' ).why ), 'and the news that explains a swing (an event, a rival\'s cargo)' );
	ok( row( 'rope' ).trend.dir === 'up' && row( 'rope' ).trend.pct > 3 && row( 'salt' ).trend.dir === 'flat', `a trend arrow over the day (rope ${ row( 'rope' ).trend.pct }% after the buying)` );
	ok( row( 'rope' ).held === 18 && row( 'rope' ).best && typeof row( 'rope' ).best.margin === 'number' && row( 'timber' ).source && row( 'timber' ).source.port === 'pons', 'where to sell what you hold, where to bring a wanted good from' );
	ok( v.board.length === 5 && v.identity.signature.length === 3 && v.fish && typeof v.fish.wanted === 'string' && v.dues.waived === 'home', 'the view carries the board, the identity, the fish hall and the dues' );
	const P = trade.panel;
	const html = P.boardHtml( v );
	ok( /Harbourmaster's board/.test( html ) && ( html.match( /<li/g ) || [] ).length === 5 && /Fish hall/.test( html ), 'the board renders five rows and the fish hall\'s wanted species' );
	ok( P.shows( row( 'rope' ) ) && P.shows( row( 'timber' ) ) && ! P.shows( { ...row( 'clocks' ), held: 0, made: false, wanted: false, event: null, trend: { dir: 'flat' } } ), 'the market opens on this port\'s own goods' );
	const cell = P.routeCell( row( 'timber' ) );
	ok( /Pons/.test( cell.b ) && /crate/.test( cell.note ), `the best-route cell: ${ cell.b } ${ cell.note } ${ cell.age }` );
	trade.dispose();

}

// ---- convoys move prices; sinking or hijacking a merchant takes her cargo off the market
{

	const naval = { ships: [ { id: 77, faction: 'merchant', x: 0, z: 0 } ] };
	const a = make( { noise: 0, events: false, seed: 21, rivals: true, extra: { naval } } ), b = make( { noise: 0, events: false, seed: 21, rivals: false } );
	const got = [];
	for ( const n of [ 'rivalVoyage', 'rivalArrived', 'rivalLost', 'marketEvent' ] ) a.features.on( n, ( e ) => got.push( [ n, e ] ) );
	let lower = 0, higher = 0, checked = 0;
	for ( let h = 0; h < 240; h ++ ) {

		const n0 = got.length;
		a.trade.advance( 1 );
		b.trade.advance( 1 );
		for ( const [ n, e ] of got.slice( n0 ) ) {

			if ( n === 'rivalArrived' ) {

				checked ++;
				if ( a.trade.sim.mid( e.port, e.good ) < b.trade.sim.mid( e.port, e.good ) ) lower ++;

			} else if ( n === 'rivalVoyage' && a.trade.sim.mid( e.from, e.good ) > b.trade.sim.mid( e.from, e.good ) ) higher ++;

		}

	}

	ok( checked >= 6 && lower === checked, `a rival's cargo lowers the price where it lands (${ lower } of ${ checked } arrivals)` );
	ok( higher >= 6, `and her loading lifts it where she buys (${ higher } loadings)` );
	ok( got.some( ( [ n, e ] ) => n === 'rivalArrived' && e.convoy ) && a.trade.rivals.list.find( ( r ) => r.id === 'guild' ).voyages > 0, 'the Tidemark guild\'s convoy trades too' );
	ok( a.trade.news.some( ( x ) => x.kind === 'rival' && x.good && x.port ), 'rival news names the good and the port (the window\'s why)' );
	let atSea = a.trade.rivals.list.find( ( r ) => r.phase === 'sea' );
	for ( let i = 0; i < 40 && ! atSea; i ++ ) { a.trade.advance( 1 ); atSea = a.trade.rivals.list.find( ( r ) => r.phase === 'sea' ); }
	const w = a.trade.rivals.where( atSea );
	const bound = atSea.to, good = atSea.good, before = a.trade.sim.mid( bound, good );
	a.app.player.position = { x: w.x, y: 0, z: w.z };
	a.features.emit( 'shipPlundered', { id: 77, coins: 10, goods: [] } );
	a.trade.sim.advance( 4 );
	ok( atSea.phase === 'lost' && got.some( ( [ n, e ] ) => n === 'rivalLost' && e.hijack ) && a.trade.sim.events.some( ( e ) => e.tpl === 'hijack' && e.ports[ 0 ] === bound && e.good === good ), `a merchant hijacked at sea: her ${ good } never reaches ${ bound }` );
	ok( a.trade.sim.mid( bound, good ) > before * 1.2, 'and it goes short there' );
	a.features.emit( 'shipPlundered', { id: 5, goods: [] } );
	ok( a.trade.rivals.list.filter( ( r ) => r.phase === 'lost' ).length === 1, 'plundering a ship that is no merchant takes nobody\'s cargo' );
	const snap = JSON.parse( JSON.stringify( a.trade.marketSnapshot() ) );
	ok( Array.isArray( snap.rivals ) && snap.rivals.length === a.trade.rivals.list.length && JSON.stringify( snap ).length < 30000, `the market snapshot carries the rivals for the universe's guests (${ JSON.stringify( snap ).length } characters)` );
	const guest = make( { noise: 0, events: false } );
	guest.trade.adoptMarketSnapshot( snap );
	ok( guest.trade.rivals.list.every( ( r, i ) => r.phase === a.trade.rivals.list[ i ].phase && r.to === a.trade.rivals.list[ i ].to ) && guest.trade.rivals.list.every( ( r ) => r.voyages === 0 ), 'a guest shows where the host\'s rivals are (and sails none of its own)' );
	for ( const x of [ a, b, guest ] ) x.trade.dispose();

	// a storm closes a port; a raid burns a port's stores
	const s = make( { noise: 0, events: false } );
	s.features.emit( 'weatherChanged', { kind: 'storm' } );
	const st = s.trade.sim.events.find( ( e ) => e.tpl === 'stormPort' );
	ok( st && st.ports[ 0 ] !== 'home' && identity( st.ports[ 0 ] ).wants.includes( st.good ) && /storm closed/i.test( st.text ), `"${ st && st.text }"` );
	s.features.emit( 'retaliationRaid', { at: 'sea', x: WORLD.key.dock.position.x, z: WORLD.key.dock.position.z } );
	const rd = s.trade.sim.events.find( ( e ) => e.tpl === 'raid' );
	ok( rd && rd.ports[ 0 ] === 'key' && identity( 'key' ).produces.includes( rd.good ) && rd.mult > 1, `"${ rd && rd.text }"` );
	s.trade.dispose();

}

// ---- a bulk sale floods the market for a day
{

	const { trade, state } = make( { boat: 'brigantine', money: 1e6 } );
	trade.credit.standing = 40;
	trade.haul.buyLicence();
	trade.haul.buyLicence();
	ok( trade.haul.licence === 2 && trade.lotLimit() === LICENCE_LOTS[ 2 ], 'the master licence lifts the bulk limit' );
	trade.buy( 'home', 'rum', 40 );
	trade.advance( 2 );
	trade.visit( 'pons' );
	const small = trade.sell( 'pons', 'rum', 2 );
	ok( small.ok && ! trade.sim.events.some( ( e ) => e.tpl === 'flood' ), 'a small sale floods nothing' );
	const p0 = trade.sim.mid( 'pons', 'rum' );
	const big = trade.sell( 'pons', 'rum', 'all' );
	const fl = trade.sim.events.find( ( e ) => e.tpl === 'flood' );
	ok( big.ok && fl && fl.ports[ 0 ] === 'pons' && fl.good === 'rum' && near( fl.mult, FLOOD.mult, 1e-9 ) && /flooded Pons Cove/.test( fl.text ), `a bulk sale floods the market: "${ fl && fl.text }"` );
	ok( near( trade.sim.ev( 'pons', 'rum' ), FLOOD.mult, 1e-6 ), 'at once (no easing in)' );
	trade.advance( 12 );
	const half = trade.sim.mid( 'pons', 'rum' ) / trade.sim.eq( 'pons', 'rum' );
	trade.advance( 16 );
	const after = trade.sim.mid( 'pons', 'rum' ) / trade.sim.eq( 'pons', 'rum' );
	ok( half < 0.9 && ! trade.sim.events.some( ( e ) => e.tpl === 'flood' ) && after > half, `a day later it is over (${ ( half * 100 ).toFixed( 0 ) }% of the usual price at 12 h, ${ ( after * 100 ).toFixed( 0 ) }% after)` );
	ok( p0 > 0 && state.money > 0, 'the money went through' );
	trade.dispose();

}

// ---- harbour dues by hull size, waived at home, for beloved standing and in the sandbox
{

	const { trade, state, app, features } = make( { boat: 'trawler', money: 1000 } );
	const heard = [];
	features.on( 'harbourDues', ( e ) => heard.push( e ) );
	const fee = Math.round( ( DUES.base + DUES.perCrate * HOLD_CRATES.trawler ) * PORT_IDENTITY.pons.fee );
	ok( trade.dues.fee( 'pons' ).fee === fee && trade.dues.fee( 'home' ).waived === 'home', `Pons charges a trawler $${ fee } a docking; home charges nothing` );
	trade.arrive( 'pons' );
	ok( state.money === 1000 - fee && heard.length === 1 && heard[ 0 ].fee === fee, 'docking at Pons pays the dues' );
	trade.arrive( 'pons' );
	trade.visit( 'pons' );
	ok( state.money === 1000 - fee, 'once per arrival (opening the market there does not charge again)' );
	trade.arrive( 'home' );
	trade.arrive( 'pons' );
	ok( state.money === 1000 - 2 * fee && near( trade.ledger.costs.dues, 2 * fee, 1e-9 ), 'home and back: charged again, booked in the ledger' );
	state.boat = 'skiff';
	ok( trade.dues.fee( 'pons' ).fee < fee && trade.dues.fee( 'tidemark' ).fee > trade.dues.fee( 'pons' ).fee, 'a skiff pays less; Tidemark\'s big harbour more' );
	state.boat = 'trawler';
	state.rep.gull = 60;
	trade.arrive( 'gull' );
	ok( state.money === 1000 - 2 * fee && trade.dues.waived === 1, 'a port that loves you waives the dues' );
	app.player.mode = 'boat';
	const d = WORLD.key.dock.position;
	app.player.position = { x: d.x + 5, y: 0, z: d.z };
	trade.update( 0.6 );
	ok( trade.dues.last === 'key' && state.money < 1000 - 2 * fee, 'sailing up to a dock is a docking' );
	state.money = 0;
	trade.arrive( 'shrine' );
	ok( trade.credit.loans.some( ( l ) => l.port === 'shrine' && l.why === 'harbour dues' ), 'dues the purse cannot pay are owed at that port' );
	state.boat = null;
	ok( trade.arrive( 'pons' ) === null, 'no boat, no docking' );
	trade.dispose();
	const sb = make( { boat: 'brigantine', money: 0, mode: 'sandbox' } );
	sb.trade.arrive( 'tidemark' );
	ok( sb.state.money === 0 && sb.trade.dues.fee( 'tidemark' ).waived === 'sandbox', 'sandbox: no dues' );
	sb.trade.dispose();

}

// ---- cargo insurance
{

	const { trade, state, features } = make( { boat: 'trawler', money: 5000 } );
	ok( ! trade.dues.insure().ok, 'nothing aboard: nothing to insure' );
	trade.buy( 'home', 'rum', 10 );
	const q = trade.dues.quote();
	const m0 = state.money;
	const r = trade.dues.insure();
	ok( r.ok && r.premium === Math.ceil( q.value * INSURANCE.rate ) && state.money === m0 - r.premium && trade.dues.active(), `insuring $${ q.value } of rum costs $${ r.premium }` );
	ok( ! trade.dues.insure().ok || trade.dues.active(), 'one policy at a time' );
	const took = trade.takeCargo( 'rum', 5 );
	const m1 = state.money;
	features.emit( 'boardersWon', { id: 1, goods: [ { good: 'rum', qty: 5 } ] } );
	ok( state.money === m1 + Math.floor( took.paid * INSURANCE.payout ) && ! trade.dues.active(), `pirates took five casks: the underwriter pays $${ state.money - m1 } and the policy ends` );
	features.emit( 'boardersWon', { id: 2, goods: [ { good: 'rum', qty: 1 } ] } );
	ok( state.money === m1 + Math.floor( took.paid * INSURANCE.payout ), 'no policy, no claim' );
	trade.dues.insure();
	trade.advance( INSURANCE.hours + 1 );
	ok( ! trade.dues.active(), 'a policy runs out' );
	trade.dues.insure();
	const m2 = state.money, v2 = trade.dues.quote().value;
	features.emit( 'playerBoatSunk', { cause: 'test' } );
	ok( state.money === m2 + Math.floor( v2 * INSURANCE.payout ), 'the boat sinks: the insured cargo is paid' );
	trade.credit.standing = 60;
	ok( trade.dues.rate() < INSURANCE.rate, 'merchant standing buys cheaper cover' );
	ok( /Cargo insurance/.test( trade.panel.harbourHtml( trade.dues.view(), null, trade.cargo ) ), 'the Costs tab offers it' );
	trade.dispose();

}

// ---- the Tidemark warehouse
{

	const { trade, state } = make( { boat: 'trawler', money: 5000 } );
	trade.buy( 'home', 'salt', 10 );
	trade.buy( 'home', 'ice', 4 );
	ok( trade.warehouse.store( 'home', 'salt' ).reason === 'away', 'the warehouse is at Tidemark only' );
	const s1 = trade.warehouse.store( 'tidemark', 'salt' ), s2 = trade.warehouse.store( 'tidemark', 'ice', 4 );
	ok( s1.ok && s1.qty === 10 && s2.ok && ! trade.cargo.salt && trade.warehouse.crates() === 14 && trade.crates() === 0, 'store the salt and the ice: the hold is free' );
	const m0 = state.money;
	trade.advance( 24 );
	ok( state.money === m0 - 14 * WAREHOUSE.rent - trade.operating.wagesPerDay() - trade.operating.upkeepPerDay() && near( trade.ledger.costs.rent, 14 * WAREHOUSE.rent, 1e-9 ), `rent at the turn of the day: $${ 14 * WAREHOUSE.rent }` );
	ok( near( trade.warehouse.goods().ice.cond, Math.exp( - GOODS.ice.perish * WAREHOUSE.spoil * 24 ), 1e-6 ), 'the cool cellar halves spoilage' );
	const saved = JSON.parse( JSON.stringify( trade.toJSON() ) );
	state.money = 0;
	trade.advance( 24 );
	ok( trade.warehouse.owed > 0 && trade.warehouse.withdraw( 'tidemark', 'salt' ).reason === 'owed', 'unpaid rent keeps the goods' );
	state.money = 1000;
	ok( trade.warehouse.payOwed().ok && trade.warehouse.withdraw( 'tidemark', 'salt' ).ok && trade.cargo.salt.qty === 10 && trade.cargo.salt.paid > 0, 'paid up: the salt comes back aboard with its cost' );
	const b = make( { boat: 'trawler' } );
	b.trade.fromJSON( saved );
	ok( b.trade.warehouse.crates() === 14 && b.trade.warehouse.goods().salt.qty === 10, 'the warehouse survives a save' );
	ok( /warehouse/.test( b.trade.panel.harbourHtml( b.trade.dues.view(), b.trade.warehouse.view(), {} ) ) && /data-act="withdraw"/.test( b.trade.panel.harbourHtml( b.trade.dues.view(), b.trade.warehouse.view(), {} ) ), 'the Costs tab at Tidemark shows the warehouse' );
	trade.dispose();
	b.trade.dispose();

}

// ---- licences: the luxuries and the bulk lots; the tuned running costs
{

	const { trade } = make( { boat: 'brigantine', money: 1e5 } );
	ok( trade.buy( 'tidemark', 'silk', 1 ).reason === 'licence' && trade.view( 'tidemark' ).rows.find( ( r ) => r.id === 'silk' ).locked, 'the guild sells silk to licensed merchants only' );
	const s = trade.buy( 'home', 'salt', 'max' );
	ok( s.ok && s.qty === LICENCE_LOTS[ 0 ] && s.limited === 'licence', `without the master licence a purchase is ${ LICENCE_LOTS[ 0 ] } units at most` );
	ok( trade.haul.buyLicence().ok && trade.buy( 'tidemark', 'silk', 1 ).ok, 'the coastal licence opens the luxuries' );
	ok( LICENCES.every( ( l ) => typeof l.unlocks === 'string' ), 'every licence says what it opens' );
	trade.dispose();
	const sb = make( { boat: 'brigantine', money: 0, mode: 'sandbox' } );
	ok( sb.trade.buy( 'tidemark', 'clocks', 1 ).ok && sb.trade.lotLimit() === 60, 'sandbox: no licence needed' );
	sb.trade.dispose();
	const t = make( { boat: 'trawler' } ), g = make( { boat: 'brigantine' } ), c = make( { boat: 'cutter' } );
	const day = ( x ) => x.trade.operating.wagesPerDay() + x.trade.operating.upkeepPerDay();
	ok( day( t ) === 3 * OPERATING.wage + Math.round( 22000 * OPERATING.upkeep ) && day( g ) > 200 && day( c ) < 10, `running costs a day: cutter $${ day( c ) }, trawler $${ day( t ) }, brigantine $${ day( g ) }` );
	for ( const x of [ t, g, c ] ) x.trade.dispose();

}

// ---- the fish halls: freshness, the port's taste, the wanted species
{

	ok( fishFreshness( 0 ) === 1 && fishFreshness( FISH_HALL.freshHours ) === 1 && near( fishFreshness( FISH_HALL.freshHours + FISH_HALL.halfLife ), FISH_HALL.floor + ( 1 - FISH_HALL.floor ) / 2, 1e-9 ) && fishFreshness( 1000 ) >= FISH_HALL.floor, 'freshness: full price at first, halving toward the floor' );
	const f0 = fishSaleFactor( { species: 'grunt', age: 0, eats: [ 'grunt' ], wanted: 'grunt' } );
	ok( near( f0.factor, 1 + FISH_HALL.eats + FISH_HALL.wanted, 1e-9 ) && f0.eats && f0.wanted, 'a fresh fish the port eats and wants today: +75%' );
	const { trade, state, features } = make( { boat: 'trawler', money: 100 } );
	const fish = state.addFish( 'jack', 3, 9 );
	ok( fish && trade.fishHall.age( fish.id ) === 0, 'a catch starts fresh' );
	trade.advance( 20 );
	ok( near( trade.fishHall.age( fish.id ), 20, 1e-6 ), 'and ages in the cooler' );
	trade.buy( 'home', 'ice', 1 );
	trade.advance( 10 );
	ok( near( trade.fishHall.age( fish.id ), 20 + 10 * FISH_HALL.iced, 1e-6 ), 'ice in the hold slows it' );
	const q = trade.fishQuote( fish, 'home' );
	const m0 = state.money;
	const r = state.sell( [ fish.id ] );
	const delta = trade.fishSale( [ fish ], 'home' );
	ok( q.fresh < 0.8 && delta === q.price - q.value && state.money === m0 + r.total + delta && delta < 0, `a day-old jack fetches $${ q.price } instead of $${ q.value }` );
	const want = trade.fishHall.wanted( 'home' );
	ok( FISH[ want ] && trade.fishHall.wanted( 'home' ) === want && PORT_IDS.some( ( p ) => trade.fishHall.wanted( p ) !== want ), `the Home hall wants ${ FISH[ want ].name.toLowerCase() } today (other halls other fish)` );
	const days = new Set();
	for ( let d = 1; d < 15; d ++ ) days.add( trade.fishHall.wanted( 'home', d ) );
	ok( days.size >= 4, `the wanted species changes from day to day (${ days.size } in two weeks)` );
	const wf = { id: 9001, species: want, value: 100 };
	const qw = trade.fishQuote( wf, 'home' );
	ok( qw.wanted && qw.price >= 160, `a fresh wanted fish pays $${ qw.price } for $100` );
	ok( trade.ledger.fish.sold > 0 && trade.ledger.fish.bonus < 0, 'the ledger keeps the fish halls' );
	trade.dispose();
	const sb = make( { boat: 'trawler', mode: 'sandbox' } );
	const sf = sb.state.addFish( 'jack', 3, 9 );
	sb.trade.advance( 40 );
	ok( sb.trade.fishQuote( sf, 'home' ).fresh === 1, 'sandbox: the catch stays fresh' );
	sb.trade.dispose();

}

// ---- the save: a wave-14 save loads (migration), the new one round-trips and stays small
{

	const old = make( { boat: 'launch', money: 2515 } );
	old.trade.fromJSON( JSON.parse( JSON.stringify( W14 ) ) );
	const t = old.trade;
	const c = t.cargo;
	ok( c.rum.qty === 2 && c.ice.qty === 2 && near( c.ice.cond, 0.8106, 1e-4 ) && c.pearls.qty === 2 && near( c.pearls.paid, 240, 0.01 ), 'a wave-14 save keeps its cargo (quantity, condition, cost)' );
	ok( t.lastPort === 'pons' && t.day === W14.day && t.haul.licence === 1 && t.credit.loans.length === 1 && t.ledger.sold === W14.ledger.sold, 'its port, day, licence, loan and ledger' );
	const cell = W14.sim.cells.pons.rum;
	ok( near( t.sim.cells.pons.rum.x, cell[ 0 ], 1e-9 ) && near( t.sim.cells.pons.rum.w, cell[ 1 ], 1e-9 ) && t.sim.cells.pons.rum.hist.length === cell[ 2 ].length && t.sim.cells.pons.rum.hist.every( ( v, i ) => v === cell[ 2 ][ i ] ), 'its market (price push, drift, the old sparkline arrays)' );
	ok( t.seen.pons.rum.rumour === false && t.seen.pons.rum.sell === W14.seen.pons.rum[ 1 ] && t.seen.tidemark.wine.rumour === true, 'the prices it saw (and rumours for the rest)' );
	ok( t.sim.cells.tidemark.silk.hist.length >= 1 && t.dues.last === null && t.warehouse.crates() === 0 && Object.keys( t.fishHall.ages ).length === 0, 'the new ports, goods and parts start fresh' );
	t.advance( 3 );
	t.visit( 'home' );
	ok( t.sell( 'home', 'pearls', 'all' ).ok && t.view( 'home' ).rows.length === GOOD_IDS.length, 'and it trades on' );
	const saved = JSON.parse( JSON.stringify( t.toJSON() ) );
	ok( saved.v === 2 && typeof saved.sim.cells.home.salt[ 2 ] === 'string' && saved.dues && saved.warehouse && saved.fish, 'the new save is v 2 (packed sparklines, dues, warehouse, fish halls)' );
	const len = JSON.stringify( saved ).length;
	ok( len < 40000, `and small (${ len } characters for ${ PORT_IDS.length } ports and ${ GOOD_IDS.length } goods)` );
	const b = make( { boat: 'launch' } );
	b.trade.fromJSON( saved );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => near( b.trade.sim.mid( p, g ), t.sim.mid( p, g ), 0.01 ) ) ), 'every price survives the round trip' );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => { const h0 = t.sim.cells[ p ][ g ].hist, h1 = b.trade.sim.cells[ p ][ g ].hist; return h0.length === h1.length && h0.every( ( v, i ) => near( h1[ i ] / v, 1, 3e-3 ) ); } ) ), 'the sparklines survive packed (a quarter percent)' );
	ok( PORT_IDS.every( ( p ) => GOOD_IDS.every( ( g ) => b.trade.seen[ p ][ g ].rumour === t.seen[ p ][ g ].rumour && ( t.seen[ p ][ g ].rumour || b.trade.seen[ p ][ g ].sell === t.seen[ p ][ g ].sell ) ) ), 'the prices seen survive' );
	const eq = 25;
	const hist = [ 25, 30, 18.5, 60, 9 ];
	ok( unpackHist( packHist( hist, eq ), eq ).every( ( v, i ) => near( v / hist[ i ], 1, 2e-3 ) ), 'packHist / unpackHist round trip' );
	old.trade.dispose();
	b.trade.dispose();

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exitCode = fails ? 1 : 0;
