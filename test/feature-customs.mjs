// Plain-node tests of harbour customs (src/features/customs): arrival inspections, the three choices (submit, bribe,
// dump), the smuggler's compartment and papers, fines that become debts, offences and the market ban, sandbox, save.
// No DOM, no GPU.
//   node test/feature-customs.mjs
import * as tradeModule from '../src/features/trade/index.js';
import * as customsModule from '../src/features/customs/index.js';
import { CUSTOMS } from '../src/features/customs/index.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { PORTS, dockOf } from '../src/features/trade/goods.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ) };

};

function make( { money = 2000, mode = null, seed = 1 } = {} ) {

	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.money = money;
	state.boat = 'launch';
	const app = { settings: { timeOfDay: 10 }, game: { state }, player: { mode: 'walk', position: { x: 0, y: 2, z: 0 } } };
	const features = new Features( app );
	const trade = features.add( 'trade', { install: ( a, f ) => tradeModule.install( a, f, { noise: 0, events: false, toasts: false } ) } );
	const customs = features.add( 'customs', { install: ( a, f ) => customsModule.install( a, f, { toasts: false, seed } ) } );
	const heard = [];
	for ( const n of [ 'customsInspected', 'contrabandSeized', 'customsBribed', 'contrabandDumped', 'harbourBan' ] ) features.on( n, ( e ) => heard.push( [ n, e ] ) );
	return { app, features, state, trade, customs, heard };

}

// ---- clean ship, submit, fines into debt
{

	const { trade, customs, state, heard } = make();
	let r = customs.inspect( 'home', { force: true } );
	ok( r && r.clean && heard.some( ( h ) => h[ 0 ] === 'customsInspected' && h[ 1 ].found === false ), 'a clean ship is waved on' );
	trade.buy( 'pons', 'tobacco', 4 );
	customs.last = {};
	r = customs.inspect( 'home', { force: true } );
	ok( r.pending && customs.pending && customs.pending.goods[ 0 ].good === 'tobacco' && customs.isOpen, 'tobacco aboard at Home: the customs window waits for an answer' );
	ok( customs.chance( 'home' ) > customs.chance( 'gull' ), 'Home is stricter than Gull Rock' );
	state.money = 10;
	const out = customs.resolve( 'submit' );
	ok( out.found && ! trade.cargo.tobacco && out.fine > 50, `searched: seized and fined $${ out.fine }` );
	ok( state.money === 0 && trade.credit.owed( 'home' ) === out.fine - 10, 'what the purse could not pay is a debt at Home' );
	ok( heard.some( ( h ) => h[ 0 ] === 'contrabandSeized' ) && heard.filter( ( h ) => h[ 0 ] === 'customsInspected' ).length === 2, 'customsInspected and contrabandSeized are emitted' );
	ok( customs.offences( 'home' ) === 1 && trade.sim.events.some( ( e ) => e.tpl === 'seizure' ), 'an offence is booked, and the burned cargo moves the price' );
	trade.dispose();

}

// ---- dump, papers, compartment, bribes
{

	const { trade, customs, state, app, heard } = make( { money: 5000 } );
	trade.buy( 'gull', 'powder', 3 );
	customs.inspect( 'pons', { force: true } );
	customs.resolve( 'dump' );
	ok( ! trade.cargo.powder && heard.some( ( h ) => h[ 0 ] === 'contrabandDumped' ) && customs.offences( 'pons' ) === 0, 'dumped overboard: no cargo, no fine, no offence' );

	app.settings.timeOfDay = 22;
	trade.lastHour = null;
	trade.buy( 'gull', 'powder', 2 );
	trade.smuggler.papers = 1;
	customs.last = {};
	const r = customs.inspect( 'key', { force: true } );
	ok( r.papers && trade.cargo.powder.qty === 2 && trade.smuggler.papers === 0, 'forged papers wave you through once' );

	trade.smuggler.compartment = 2; // hides 10 crates
	let missed = 0, found = 0;
	for ( let i = 0; i < 40; i ++ ) {

		if ( ! trade.cargo.powder ) trade.addCargo( 'powder', 2, { force: true } );
		customs.last = {};
		customs.offenceLog = {};
		customs.bans = {};
		customs.inspect( 'key', { force: true } );
		const o = customs.resolve( 'submit' );
		if ( o.found ) found ++; else missed ++;

	}

	ok( missed > found && found > 0, `the compartment is usually missed (${ missed } missed, ${ found } found in 40)` );

	let took = 0, refused = 0;
	for ( let i = 0; i < 40; i ++ ) {

		if ( ! trade.cargo.powder ) trade.addCargo( 'powder', 2, { force: true } );
		customs.last = {};
		customs.offenceLog = {};
		customs.bans = {};
		state.money = 5000;
		customs.inspect( 'key', { force: true } );
		const o = customs.resolve( 'bribe' );
		if ( o.accepted ) took ++; else refused ++;

	}

	ok( took > 10 && refused > 3, `bribes are often taken, sometimes refused (${ took } / ${ refused })` );
	ok( heard.some( ( h ) => h[ 0 ] === 'customsBribed' && h[ 1 ].accepted ) && heard.some( ( h ) => h[ 0 ] === 'customsBribed' && ! h[ 1 ].accepted ), 'customsBribed reports both' );
	trade.dispose();

}

// ---- offences ban the market; they fade
{

	const { trade, customs, heard } = make( { money: 50000 } );
	for ( let i = 0; i < 3; i ++ ) {

		trade.addCargo( 'relics', 1, { force: true } );
		customs.last = {};
		customs.inspect( 'pons', { force: true } );
		customs.resolve( 'submit' );

	}

	ok( customs.banned( 'pons' ) > 20 && heard.some( ( h ) => h[ 0 ] === 'harbourBan' ), 'three offences: banned from the Pons market for a day' );
	const r = trade.buy( 'pons', 'rum', 1 );
	ok( ! r.ok && r.reason === 'banned' && trade.view( 'pons' ).banned, 'the stall refuses you while banned' );
	trade.advance( CUSTOMS.banHours + 1 );
	ok( ! customs.banned( 'pons' ) && trade.buy( 'pons', 'rum', 1 ).ok, 'the ban lifts' );
	trade.advance( CUSTOMS.offenceFade );
	ok( customs.offences( 'pons' ) === 0, 'and the offences fade' );
	trade.dispose();

}

// ---- arrival detection, the timeout, sandbox, save
{

	const { app, trade, customs } = make( { seed: 5 } );
	trade.addCargo( 'relics', 1, { force: true } );
	const d = dockOf( 'home' );
	let inspected = 0;
	const realChance = customs.chance.bind( customs );
	customs.chance = () => 1; // every arrival is inspected for this part
	app.player.mode = 'boat';
	app.player.position = { x: d.x + 5, y: 0, z: d.z };
	customs.update( 0.1 );
	ok( ! customs.pending, 'starting (or loading) at the berth is not an arrival' );
	app.player.position = { x: d.x + 400, y: 0, z: d.z };
	customs.update( 0.1 );
	app.player.position = { x: d.x + 20, y: 0, z: d.z };
	customs.update( 0.1 );
	if ( customs.pending ) inspected ++;
	ok( inspected === 1 && customs.pending.port === 'home', 'sailing into Home brings the launch alongside' );
	customs.update( CUSTOMS.decide + 1 );
	ok( ! customs.pending && ! trade.cargo.relics, 'no answer in time counts as a submission' );
	app.player.position = { x: d.x + 25, y: 0, z: d.z };
	trade.addCargo( 'relics', 1, { force: true } );
	customs.update( 0.1 );
	ok( ! customs.pending, 'moving about inside the harbour is not a new arrival' );
	app.player.mode = 'walk';
	app.player.position = { x: d.x + 400, y: 0, z: d.z };
	customs.update( 0.1 );
	app.player.position = { x: d.x + 10, y: 0, z: d.z };
	customs.update( 0.1 );
	ok( ! customs.pending, 'walking in on foot is not an arrival by sea' );
	customs.chance = realChance;
	const saved = JSON.parse( JSON.stringify( customs.toJSON() ) );
	const b = make();
	b.customs.fromJSON( saved );
	ok( b.customs.offences( 'home' ) === customs.offences( 'home' ) && b.customs.rng.s === customs.rng.s, 'offences and the generator survive a save' );
	let threw = false;
	for ( const junk of [ null, 5, { log: { home: 'x' } }, { bans: { mars: 4 } } ] ) try { b.customs.fromJSON( junk ); } catch ( e ) { threw = true; }
	ok( ! threw, 'a bad save is ignored' );
	ok( typeof b.features.panelOpen() === 'boolean', 'the registry asks it about open panels' );
	trade.dispose();
	b.trade.dispose();

	const sb = make( { mode: 'sandbox' } );
	sb.trade.addCargo( 'relics', 1, { force: true } );
	ok( sb.customs.inspect( 'home' ) === null, 'sandbox: no inspections' );
	sb.trade.dispose();

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
