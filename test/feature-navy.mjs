// Plain-node test of the navy (src/features/navy, naval's Brains.thinkNavy / ShipClasses navy classes / Routes navy waters) and
// the weather's fronts at sea (src/features/weather/Fronts.js and their part in weather/index.js): the classes, the patrol /
// escort / hunt states, the hail-then-fire sequence, the boarding and its fine, AI vs AI battles through naval's guns, bounties
// (sunk, assisted, claimed), the standing gates of the chandler, the press gang, the sea events, the fronts' determinism and
// motion, bounded gusts, the lightning's timing, the forecast, and two clients agreeing on a front. No GPU, no browser.
//   node test/feature-navy.mjs
import './headless.mjs';
import { Features } from '../src/features/Features.js';
import { Naval } from '../src/features/naval/Naval.js';
import { SHIP_CLASSES, NAVY_KINDS, SHIP_KINDS } from '../src/features/naval/ShipClasses.js';
import { thinkNavy, think, NAVY, shipTarget } from '../src/features/naval/Brains.js';
import { NAVY_JETTY, navyLanes, inSafeZone, makeCursor } from '../src/features/naval/Routes.js';
import { Ship } from '../src/features/naval/Ship.js';
import * as navyModule from '../src/features/navy/index.js';
import { Navy } from '../src/features/navy/Navy.js';
import { STANDING, CHANDLER, BOUNTY, FINE, PARDON, bountyFor, fineFor, discount } from '../src/features/navy/NavyData.js';
import { dressGeometry, jettyGeometry, drawNavy } from '../src/features/navy/NavyModels.js';
import { FRONT, frontAt, influence, gustAt, strikesBetween, spoutAt, arrival, forecastText, edgeOffset, crossHours } from '../src/features/weather/Fronts.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );

// open water far from every port's calm circle
const SEA = { x: 1200, z: 900 };

function makeApp( over = {} ) {

	const toasts = [];
	const state = {
		boat: 'lobster', money: 1000, earned: [],
		earn( n ) { this.money += n; this.earned.push( n ); return this.money; },
		spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; },
	};
	return {
		mode: 'campaign', settings: { timeOfDay: 12 },
		terrainData: null, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( SEA.x, 0, SEA.z + 2000 ), quaternion: new Quaternion(), velocity: new Vector3(), driven: true, moored: false, mass: 3200 },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new Vector3( SEA.x, 4, SEA.z + 2000 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new Vector3( SEA.x, 1, SEA.z + 2000 ) },
		input: { hit: () => false, keys: new Set() },
		game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick() {} },
		toasts,
		...over,
	};

}

function setup( { app = makeApp(), extra = {}, navyOpts = {} } = {} ) {

	const features = new Features( app );
	const events = [];
	for ( const n of [ 'shipSunk', 'navyHail', 'navyBoarded', 'navyBounty', 'navyBountyPaid', 'navyStanding', 'pressGang', 'convoyAttacked', 'manOverboardRescued', 'cannonFired' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	for ( const [ k, v ] of Object.entries( extra ) ) features.add( k, { install: () => v } );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const navy = features.add( 'navy', { install: ( a, f ) => new Navy( a, f, { seed: 3, jetty: false, models: false, ...navyOpts } ) } );
	return { app, features, naval, navy, events };

}

function run( features, seconds, dt = 0.05, each = null ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) {

		features.update( dt );
		if ( each && each( i, i * dt ) === false ) return i * dt;

	}

	return seconds;

}

// a world for the brains alone
function world( target, fired = [] ) {

	return { time: 0, night: false, storm: false, target, rng: Math.random, terrain: null, fire: ( s, side ) => { fired.push( side ); s.reload[ side ] = 5; return true; }, escape() {} };

}

// ================================================================================================ 1. classes, lanes, models
section( '1. classes, lanes and looks' );
{

	const F = SHIP_CLASSES.frigate, R = SHIP_CLASSES.revenue, B = SHIP_CLASSES.brigantine;
	ok( NAVY_KINDS.includes( 'frigate' ) && NAVY_KINDS.includes( 'revenue' ) && F.faction === 'navy' && R.faction === 'navy', 'two navy classes: the frigate and the revenue cutter' );
	ok( SHIP_KINDS.length === 3 && ! F.glb && F.model === 'navy' && /navy\/frigate\.glb$/.test( F.navyGlb ) && /navy\/revenue\.glb$/.test( R.navyGlb ) && F.base === 'brigantine' && R.base === 'sloop', 'their own GLBs (navyGlb, wave 19F), the brigantine / sloop in dress as the fallback; SHIP_KINDS keeps the three' );
	const ys = [ ...new Set( F.stations.map( ( s ) => s.y.toFixed( 2 ) ) ) ];
	ok( ys.length === 2 && F.stations.filter( ( s ) => s.side === 'port' ).length === 6 && Math.abs( ys[ 0 ] - ys[ 1 ] ) > 1, `the frigate's two gun decks: 6 guns a side at heights ${ ys.join( ' / ' ) } m` );
	ok( F.turn < B.turn && F.mass > B.mass && F.hp > B.hp && F.speed < B.speed, 'the frigate turns slower, weighs and holds more than a brigantine' );
	ok( R.speed > SHIP_CLASSES.sloop.speed && R.turn >= SHIP_CLASSES.sloop.turn, 'the cutter is the quick patrol boat' );
	const lanes = navyLanes();
	ok( lanes.length === 2 && lanes.every( ( l ) => l.length >= 2 ), `two navy lanes (${ lanes.map( ( l ) => l.length ).join( ' + ' ) } points) from the Tidemark approach` );
	ok( !! inSafeZone( NAVY_JETTY.home.x, NAVY_JETTY.home.z ), 'the naval jetty lies inside Tidemark\'s calm circle' );
	const d = dressGeometry( 'frigate' ), j = jettyGeometry();
	ok( d && d.attributes.position.count > 100 && j && j.attributes.position.count > 200, `the frigate's dress (${ d.attributes.position.count } verts) and the jetty (${ j.attributes.position.count } verts) build` );
	// drawNavy on a set without templates of its own (the fallback): a scaled base-class visual in dress
	const made = [];
	const models = { visuals: new Set(), create( kind ) { const v = { kind, group: { name: '', scale: { set( x, y, z ) { this.v = [ x, y, z ]; } }, add( m ) { made.push( m ); } } }; return v; } };
	ok( drawNavy( models ) && ! drawNavy( models ), 'drawNavy wraps the ModelSet once' );
	const v = models.create( 'frigate' );
	ok( v.kind === 'brigantine' && v.navyKind === 'frigate' && v.group.scale.v[ 0 ] === F.scale && made.length === 1, 'without a template of its own a frigate visual is the brigantine at 1.3x in navy dress' );
	ok( models.create( 'sloop' ).kind === 'sloop', 'other classes pass through' );

}

// ================================================================================================ 2. brains
section( '2. the navy brain: patrol, escort, hunt, hail, board, pursue' );
{

	// patrol
	const s = new Ship( 'revenue', { x: SEA.x, z: SEA.z, yaw: 0 } );
	s.cursor = makeCursor( [ [ SEA.x, SEA.z ], [ SEA.x + 500, SEA.z ] ], { index: 1 } );
	s.navy = { foe: null, ward: null, wanted: false };
	s.state = 'patrol';
	const off = { ok: false, x: 0, z: 0, vx: 0, vz: 0 };
	thinkNavy( s, world( off ), 0.1 );
	ok( s.state === 'patrol' && Math.abs( s.want - Math.PI / 2 ) < 0.05 && s.wantSpeed > 0.3, 'patrol: she follows her lane' );

	// escort: station off the ward's port quarter
	const m = new Ship( 'trawler', { x: SEA.x, z: SEA.z + 200, yaw: 0 } );
	m.speed = 3;
	s.navy.ward = m;
	thinkNavy( s, world( off ), 0.1 );
	ok( s.state === 'escort', 'escort: a ward makes her keep station' );
	for ( let i = 0; i < 1200; i ++ ) { thinkNavy( s, world( off ), 0.05 ); s.integrate( 0.05, null ); m.want = 0; m.wantSpeed = 0.7; m.integrate( 0.05, null ); }
	const portX = m.x + NAVY.escort.off * Math.cos( m.yaw ) + NAVY.escort.back * Math.sin( m.yaw ), portZ = m.z - NAVY.escort.off * Math.sin( m.yaw ) + NAVY.escort.back * Math.cos( m.yaw );
	ok( Math.hypot( s.x - portX, s.z - portZ ) < 30, `escort: on station off her quarter after a minute (${ Math.hypot( s.x - portX, s.z - portZ ).toFixed( 1 ) } m off)` );

	// hunt -> broadside at a pirate (s.tgt is the pirate's record when she fires)
	const p = new Ship( 'sloop', { x: s.x + 400, z: s.z, yaw: 0 } );
	s.navy.foe = p;
	const fired = [];
	thinkNavy( s, world( off, fired ), 0.1 );
	ok( s.state === 'hunt', 'hunt: a pirate in sight' );
	p.x = s.x + 110; p.z = s.z;
	for ( let i = 0; i < 400 && ! fired.length; i ++ ) { thinkNavy( s, world( off, fired ), 0.05 ); s.integrate( 0.05, null ); }
	ok( s.state === 'broadside' && fired.length > 0 && s.tgt && s.tgt.ship === p, `broadside: she fires at the pirate's record (${ fired.length } broadside${ fired.length === 1 ? '' : 's' })` );
	p.state = 'gone';
	thinkNavy( s, world( off ), 0.1 );
	ok( s.state === 'escort' && s.tgt.ok === false, 'the pirate gone: back to her ward, guns on nobody' );

	// the hail-then-fire sequence against a boat that runs
	const h = new Ship( 'revenue', { x: SEA.x, z: SEA.z, yaw: 0 } );
	h.navy = { wanted: true };
	h.state = 'patrol';
	const runner = { x: SEA.x + 180, y: 0, z: SEA.z, vx: 0, vz: 4, ok: true, mass: 3200 };
	const says = [];
	let t = 0;
	const fr = [];
	for ( let i = 0; i < 1200; i ++ ) {

		thinkNavy( h, world( runner, fr ), 0.05 );
		if ( h.mem.say ) { says.push( [ h.mem.say, t ] ); h.mem.say = null; }
		h.integrate( 0.05, null );
		runner.z += runner.vz * 0.05;
		t += 0.05;

	}

	const seq = says.map( ( q ) => q[ 0 ] ).join( ',' );
	ok( seq.startsWith( 'hail,warn,fire' ), `a runner is hailed, warned, then fired on (${ seq })` );
	const tw = says.find( ( q ) => q[ 0 ] === 'warn' ), th = says.find( ( q ) => q[ 0 ] === 'hail' ), tf = says.find( ( q ) => q[ 0 ] === 'fire' );
	ok( tw && th && tw[ 1 ] - th[ 1 ] >= NAVY.hail.grace - 0.1 && tf[ 1 ] - tw[ 1 ] >= NAVY.hail.fireAfter - 0.1, `the grace (${ ( tw[ 1 ] - th[ 1 ] ).toFixed( 1 ) } s) and the warning (${ ( tf[ 1 ] - tw[ 1 ] ).toFixed( 1 ) } s) before the guns` );
	ok( h.state === 'pursue', 'pursue: she chases him' );

	// a boat that heaves to is boarded
	const b = new Ship( 'revenue', { x: SEA.x, z: SEA.z, yaw: 0 } );
	b.navy = { wanted: true };
	b.state = 'patrol';
	const still = { x: SEA.x + 150, y: 0, z: SEA.z, vx: 0, vz: 0, ok: true, mass: 3200 };
	const bs = [];
	for ( let i = 0; i < 1600; i ++ ) { thinkNavy( b, world( still ), 0.05 ); if ( b.mem.say ) { bs.push( b.mem.say ); b.mem.say = null; } b.integrate( 0.05, null ); }
	ok( bs[ 0 ] === 'hail' && bs.includes( 'board' ) && ! bs.includes( 'fire' ), `heave to and she boards, no shot (${ bs.join( ',' ) })` );

	// no hail in the calm: a wanted boat in Tidemark's calm circle is left alone
	const c = new Ship( 'revenue', { x: NAVY_JETTY.home.x + 300, z: NAVY_JETTY.home.z, yaw: 0 } );
	c.navy = { wanted: true };
	c.state = 'patrol';
	const calmT = { x: NAVY_JETTY.home.x, y: 0, z: NAVY_JETTY.home.z, vx: 0, vz: 3, ok: true };
	thinkNavy( c, world( calmT ), 0.1 );
	ok( c.state === 'patrol', 'the calm radius: no hail inside it' );
	// a pirate's foe stands in for the player
	const pr = new Ship( 'sloop', { x: SEA.x, z: SEA.z } );
	pr.state = 'patrol';
	const nv = new Ship( 'frigate', { x: SEA.x + 200, z: SEA.z } );
	pr.foe = nv;
	think( pr, world( { x: 0, y: 0, z: 0, vx: 0, vz: 0, ok: false } ), 0.1 );
	ok( pr.state === 'chase' && pr.tgt && pr.tgt.ship === nv, 'a pirate with a navy foe chases her instead (AI vs AI)' );

}

// ================================================================================================ 3. the feature: fleet, battles, bounties
section( '3. the fleet, AI vs AI battles and bounties' );
{

	const { app, features, naval, navy, events } = setup();
	run( features, 1 );
	const kinds = [ ...navy.ships.values() ].map( ( s ) => s.kind ).sort();
	ok( kinds.join( ',' ) === 'frigate,revenue,revenue', `the fleet sails: ${ kinds.join( ', ' ) }` );
	ok( [ ...navy.ships.values() ].every( ( s ) => s.navy && typeof s.navy.wanted === 'function' && s.ammo.max >= 30 ), 'orders and a navy magazine on each' );

	// AI vs AI: the frigate meets a pirate sloop in open water
	const fr = [ ...navy.ships.values() ].find( ( s ) => s.kind === 'frigate' );
	fr.x = SEA.x; fr.z = SEA.z; fr.yaw = 0; fr.speed = 3;
	const p = naval.spawn( 'sloop', { x: SEA.x + 260, z: SEA.z + 60, yaw: Math.PI, route: [ [ SEA.x + 260, SEA.z + 60 ], [ SEA.x - 400, SEA.z ] ], loop: true } );
	let navyShots = 0, frigateShots = 0, pirateShots = 0, navyHit = 0;
	const ids = new Set( navy.ships.keys() );
	features.on( 'cannonFired', ( e ) => { if ( ids.has( e.owner ) ) navyShots ++; if ( e.owner === fr.id ) frigateShots ++; if ( e.owner === p.id ) pirateShots ++; } );
	features.on( 'cannonballImpact', ( e ) => { if ( e.owner === p.id && ids.has( e.target ) ) navyHit ++; } );
	run( features, 3 );
	ok( fr.navy.foe === p && ( fr.state === 'hunt' || fr.state === 'broadside' ), 'the frigate takes the pirate on' );
	const tEnd = run( features, 300, 0.05, () => p.alive && ! p.escaped );
	ok( navyShots > 0 && frigateShots > 0 && pirateShots > 0, `broadsides both ways: the navy ${ navyShots } guns (the frigate ${ frigateShots }), the pirate ${ pirateShots }` );
	ok( ! p.alive || p.escaped, `the battle resolves in ${ ( tEnd + 3 ).toFixed( 0 ) } s: the pirate ${ p.escaped ? 'escaped' : 'sunk' } (she hit the navy ${ navyHit } times)` );
	ok( events.some( ( e ) => e[ 0 ] === 'shipSunk' && e[ 1 ].id === p.id && ! e[ 1 ].byPlayer ) || p.escaped, 'sunk by the navy: no bounty without a shot from the player in her' );
	ok( navy.owed === 0, 'nothing owed to the player for it' );

	// bounties: sunk by the player, an assist, the claim
	const owed0 = navy.owed;
	features.emit( 'shipSunk', { id: 'x1', name: 'Black Gull', faction: 'pirate', x: 0, z: 0, byPlayer: true, kind: 'sloop' } );
	ok( navy.owed - owed0 === bountyFor( 'sloop' ) && navy.standing === STANDING.pirateSunk, `a pirate the player sank: $${ bountyFor( 'sloop' ) } owed, standing +${ STANDING.pirateSunk }` );
	const q = naval.spawn( 'brigantine', { x: SEA.x + 2000, z: SEA.z } );
	fr.navy.foe = q;
	features.emit( 'cannonballImpact', { owner: 'player', hit: 'ship', target: q.id, x: 0, y: 0, z: 0 } );
	const owed1 = navy.owed;
	features.emit( 'shipSunk', { id: q.id, name: 'Salt Widow', faction: 'pirate', x: 0, z: 0, byPlayer: false, kind: 'brigantine' } );
	ok( navy.owed - owed1 === Math.round( bountyFor( 'brigantine' ) * BOUNTY.share ), `the navy's kill with the player's shot in her: a ${ BOUNTY.share * 100 }% share ($${ navy.owed - owed1 })` );
	const before = app.game.state.money, owed = navy.owed;
	ok( navy.claim() === owed && app.game.state.money === before + owed && navy.owed === 0, `claimed at Tidemark: $${ owed } paid` );
	ok( events.some( ( e ) => e[ 0 ] === 'navyBountyPaid' ), 'navyBountyPaid' );

}

// ================================================================================================ 4. the law: wanted, hail, board, fine
section( '4. the law' );
{

	const hijack = { vessel: null };
	const pirates = { notorietyLevel: () => 0 };
	const customs = { offences: ( port ) => ( port === 'pons' ? 0 : 0 ) };
	const { app, features, naval, navy, events } = setup( { extra: { hijack, pirates, customs } } );
	run( features, 1.2 );
	ok( ! navy.isWanted(), 'a clean captain is not wanted' );
	hijack.vessel = { wanted: true };
	ok( navy.isWanted() && navy.crimes().hull, 'a wanted hull is' );
	hijack.vessel = null;
	pirates.notorietyLevel = () => 3;
	ok( navy.isWanted(), 'notoriety 3 is' );
	pirates.notorietyLevel = () => 0;
	customs.offences = ( port ) => ( port === 'home' || port === 'pons' ? 1 : 0 );
	ok( navy.isWanted() && navy.crimes().offences === 2, 'two customs offences are' );
	// the boarding: a fine paid, the slate clean for PARDON hours
	const money = app.game.state.money;
	const r = navy._boarded( 'HMS Test' );
	ok( r.paid && r.fine === fineFor( { offences: 2 } ) && app.game.state.money === money - r.fine, `boarded: a fine of $${ r.fine } paid` );
	ok( ! navy.isWanted(), `pardoned for ${ PARDON } island hours` );
	customs.offences = ( port ) => ( port === 'home' || port === 'pons' || port === 'key' ? 1 : 0 );
	ok( navy.isWanted(), 'a new offence breaks the pardon' );
	// firing on the navy: hostile, standing down
	customs.offences = () => 0;
	navy.pardon = null;
	const s = [ ...navy.ships.values() ][ 0 ];
	const st0 = navy.standing;
	features.emit( 'cannonballImpact', { owner: 'player', hit: 'ship', target: s.id, x: 0, y: 0, z: 0 } );
	ok( navy.isWanted() && navy.standing === st0 + STANDING.navyHit && s.navy.hostile( {} ), 'a shot into a navy ship: hostile, standing down' );
	// the hail reaches the player as a toast, the run costs standing once
	app.toasts.length = 0;
	navy._hail( 'hail', 'HMS Vigilant' );
	ok( app.toasts.some( ( t ) => /Heave to/.test( t ) ), `the "Heave to!" toast ("${ app.toasts[ 0 ] }")` );
	const st1 = navy.standing;
	navy._hail( 'fire', 'HMS Vigilant', s );
	navy._hail( 'fire', 'HMS Vigilant', s );
	ok( navy.standing === st1 + STANDING.ran, 'running from her costs standing once' );
	// can't pay: owed at the office
	app.game.state.money = 0;
	hijack.vessel = { wanted: true };
	const r2 = navy._boarded( 'HMS Test' );
	ok( ! r2.paid && navy.fineOwed === r2.fine && hijack.vessel.wanted, 'an unpaid fine is owed, the hull stays wanted' );
	app.game.state.money = 5000;
	ok( navy.payFine() && navy.fineOwed === 0, 'paid at the office' );
	// the sandbox: only shooting at the navy makes it fight
	app.mode = 'sandbox';
	navy.hostileUntil = - 1;
	ok( ! navy.isWanted(), 'the sandbox: a wanted hull alone does not bring the navy' );
	app.mode = 'campaign';

	// end to end: a wanted boat at sea near a cutter is hailed by toast
	hijack.vessel = { wanted: true };
	navy.pardon = null;
	const cut = [ ...navy.ships.values() ].find( ( q ) => q.kind === 'revenue' );
	cut.x = SEA.x; cut.z = SEA.z; cut.speed = 4;
	cut.setState( 'patrol' );
	app.boatCtl.position.set( SEA.x + 260, 0, SEA.z );
	app.boatCtl.velocity.set( 0, 0, 0 );
	app.toasts.length = 0;
	run( features, 40, 0.05, () => ! app.toasts.some( ( t ) => /Heave to/.test( t ) ) );
	ok( app.toasts.some( ( t ) => /Heave to/.test( t ) ), 'end to end: the cutter sights the wanted boat and hails her' );
	run( features, 60, 0.05, () => ! events.some( ( e ) => e[ 0 ] === 'navyBoarded' ) );
	ok( events.some( ( e ) => e[ 0 ] === 'navyBoarded' ), 'end to end: hove to, she is boarded' );

}

// ================================================================================================ 5. standing gates, the press gang, sea events
section( '5. the chandler, the press gang, sea events' );
{

	const naval0 = { rows: [ { id: 'heavyGuns', tier: 0, maxTier: 2, price: 1800, canBuy: true } ] };
	const weapons = { shot: { chain: 0 } };
	const { app, features, naval, navy, events } = setup( { extra: { weapons } } );
	naval.moduleRows = () => naval0.rows;
	let bought = 0;
	naval.buyModule = ( id ) => { bought ++; return { ok: true, price: 1800, tier: 1 }; };
	navy.standing = 0;
	let rows = navy.chandlerRows();
	ok( rows.find( ( r ) => r.id === 'heavy' ).ok === false && rows.find( ( r ) => r.id === 'chain' ).ok, `standing 0: chain shot yes, the heavy guns no (${ rows.find( ( r ) => r.id === 'heavy' ).note })` );
	ok( ! navy.buy( 'heavy' ).ok && bought === 0, 'the gate holds' );
	navy.standing = CHANDLER.heavy;
	ok( navy.buy( 'heavy' ).ok && bought === 1, `standing ${ CHANDLER.heavy }: the Admiralty heavy shot` );
	naval0.rows[ 0 ].tier = 1;
	rows = navy.chandlerRows();
	ok( rows[ 0 ].id === 'long' && ! rows[ 0 ].ok, `the long guns wait for standing ${ CHANDLER.long }` );
	navy.standing = 100;
	const chain = navy.chandlerRows().find( ( r ) => r.id === 'chain' ).price;
	ok( chain === Math.round( CHANDLER.chain.price * ( 1 - CHANDLER.discountMax ) ) && chain < CHANDLER.chain.price, `chain shot cheaper by standing: $${ chain } (from $${ CHANDLER.chain.price })` );
	const m0 = app.game.state.money;
	ok( navy.buy( 'chain' ).ok && weapons.shot.chain === CHANDLER.chain.pack && app.game.state.money === m0 - chain, 'chain shot bought into the locker' );
	navy.standing = - 50;
	ok( navy.chandlerRows().every( ( r ) => ! r.ok ), 'a rogue is not served' );

	// the press gang
	navy.standing = - 30;
	app.player.mode = 'walk';
	const mp = app.game.state.money;
	ok( navy.startPress( 'tidemark' ) && navy.isOpen, 'the press gang\'s invitation opens' );
	navy.resolvePress( 'refuse' );
	ok( app.game.state.money === mp - 150 && navy.standing === - 30 + STANDING.pressRefused && ! navy.press, 'refused: a $150 fine' );
	navy.startPress( 'pons' );
	navy.resolvePress( 'sign' );
	ok( navy.standing === - 30 + STANDING.pressRefused + STANDING.pressSigned, 'signed on: standing up' );
	app.player.mode = 'boat';

	// sea events: a convoy attacked, a man overboard (the fleet kept away: the raiders are the player's to beat)
	navy._despawn();
	navy._respawn = { frigate: 1e12, outer: 1e12, escort: 1e12 };
	app.boatCtl.position.set( SEA.x, 0, SEA.z );
	app.camera.position.set( SEA.x, 4, SEA.z );
	ok( navy.events.startConvoy(), 'a convoy under attack appears' );
	const c = navy.events.convoy;
	ok( c.ship.convoy && c.pirates.length >= 1 && c.pirates.every( ( p ) => p.foe === c.ship ), `the convoy and ${ c.pirates.length } raider(s) on her` );
	const dc = Math.hypot( c.ship.x - SEA.x, c.ship.z - SEA.z );
	ok( dc >= 650 && dc <= 900, `on the horizon: ${ dc.toFixed( 0 ) } m off` );
	let pFire = 0;
	features.on( 'cannonFired', ( e ) => { if ( c.pirates.some( ( p ) => p.id === e.owner ) ) pFire ++; } );
	run( features, 90, 0.05, () => pFire === 0 );
	ok( pFire > 0, `the raiders fire on her (${ pFire } guns)` );
	features.emit( 'cannonballImpact', { owner: 'player', hit: 'ship', target: c.pirates[ 0 ].id, x: 0, y: 0, z: 0 } );
	ok( c.helped, 'your shot in a raider counts as help' );
	for ( const p of c.pirates ) p.setState( 'flee' );
	const mc = app.game.state.money;
	run( features, 0.2 );
	ok( c.done && app.game.state.money === mc + c.reward && navy.events.stats.convoysSaved === 1, `beaten off with your help: $${ c.reward }` );
	navy.events.clear();
	ok( navy.events.startOverboard(), 'a man overboard' );
	const o = navy.events.overboard;
	ok( ! navy.events.pullAboard(), 'too far to pull him out' );
	app.boatCtl.position.set( o.x + 2, 0, o.z );
	const mo = app.game.state.money;
	ok( navy.events.pullAboard() && app.game.state.money > mo && events.some( ( e ) => e[ 0 ] === 'manOverboardRescued' ), 'alongside: pulled aboard, paid' );

	// save round trip
	navy.owed = 300; navy.owedCount = 2; navy.standing = 42;
	const json = JSON.parse( JSON.stringify( navy.toJSON() ) );
	const { navy: n2 } = setup();
	n2.fromJSON( json );
	ok( n2.owed === 300 && n2.standing === 42 && n2.owedCount === 2, 'the save round trip' );
	n2.fromJSON( { standing: 'x', owed: - 4 } );
	ok( n2.standing === 0 && n2.owed === 0, 'garbage in the save is ignored' );

}

// ================================================================================================ 6. fronts at sea
section( '6. fronts: deterministic, moving, bounded gusts, lightning timing, forecast' );
{

	// find the first front after day 1
	let A = 30, f = null;
	for ( ; A < 400 && ! f; A += 0.25 ) f = frontAt( A );
	ok( !! f, `a front crosses the sea (slot ${ f && f.id }, from hour ${ f && f.t0.toFixed( 2 ) })` );
	const f2 = frontAt( A );
	ok( f2 && f2.id === f.id && f2.angle === f.angle && f2.t0 === f.t0, 'the same island hour gives the same front (a pure function: every client agrees)' );
	const mid = ( f.t0 + f.t1 ) / 2;
	const e1 = edgeOffset( f, mid ), e2 = edgeOffset( f, mid + 0.1 );
	ok( Math.abs( ( e2 - e1 ) - FRONT.speed * 0.1 ) < 1e-6, `the line moves ${ FRONT.speed } m per island hour (${ ( FRONT.speed * 0.01 ).toFixed( 0 ) } m/s at the 40-minute day)` );
	let n = 0;
	for ( let h = 0; h < 24 * 30; h += 0.5 ) if ( frontAt( 24 + h ) ) n ++;
	ok( n > 0 && n < 24 * 30 * 2 * 0.8, `fronts come and go (on the sea ${ ( n / ( 24 * 30 * 2 ) * 100 ).toFixed( 0 ) }% of a month)` );
	for ( let h = 0; h < 24 * 30; h += 0.1 ) { const g = frontAt( h ), k = Math.floor( h / FRONT.every ); if ( g && g.id < k - 1 ) { ok( false, 'one front at a time' ); break; } }
	// a point the line crosses: behind it the band, then the clearing
	const P = { x: FRONT.center.x, z: FRONT.center.z };
	const arr = arrival( P.x, P.z, f.t0, 12 );
	ok( arr && arr.inHours > 0, `the forecast at the centre: in ${ arr.inHours.toFixed( 2 ) } island hours from the ${ arr.from }` );
	const at = f.t0 + arr.inHours;
	const i0 = influence( f, P.x, P.z, at ), i1 = influence( f, P.x, P.z, at + 0.3 ), i2 = influence( f, P.x, P.z, at + ( FRONT.width + 400 ) / FRONT.speed );
	ok( Math.abs( i0.depth ) < 1 && i1.rain > 0.5 && i2.calm > 0.5 && i2.rain < 0.05, `on arrival the edge (depth ${ i0.depth.toFixed( 2 ) } m), then the band (rain ${ i1.rain.toFixed( 2 ) }), then the calm (${ i2.calm.toFixed( 2 ) })` );
	// gusts bounded
	let gmax = 0, gsum = 0, gn = 0;
	for ( let t = f.t0; t < f.t1; t += 0.002 ) { const g = gustAt( f, P.x, P.z, t ); gmax = Math.max( gmax, g.speed ); if ( g.speed > 0 ) { gsum += g.speed; gn ++; } if ( Math.abs( Math.hypot( g.x, g.z ) - g.speed ) > 1e-6 ) { ok( false, 'gust vector length' ); break; } }
	ok( gmax <= FRONT.maxGust + 1e-9 && gmax > FRONT.maxGust * 0.4 && gn > 0, `squall gusts up to ${ gmax.toFixed( 1 ) } m/s (bound ${ FRONT.maxGust })` );
	// lightning: deterministic strikes, inside the band
	const s1 = [], s2 = [];
	strikesBetween( f, mid, mid + 3, ( s ) => s1.push( s ), 999 );
	strikesBetween( f, mid, mid + 3, ( s ) => s2.push( s ), 999 );
	ok( s1.length > 0 && JSON.stringify( s1 ) === JSON.stringify( s2 ), `lightning on a schedule: ${ s1.length } strikes in 3 h, the same every time` );
	// (the wave 21 play-test: the sea strobed. A slot is seconds of real time apart and most slots are quiet)
	ok( FRONT.strikeStep * 100 >= 5 && s1.length <= 3 / FRONT.strikeStep * 0.5, `strike slots ${ ( FRONT.strikeStep * 100 ).toFixed( 0 ) } s apart at the 40-minute day, ${ s1.length } strikes in ${ Math.round( 3 / FRONT.strikeStep ) } slots` );
	ok( s1.every( ( s ) => { const q = influence( f, s.x, s.z, s.at ); return q.depth > 0 && q.depth < FRONT.width; } ), 'every strike falls inside the band' );
	const sp = [];
	for ( let k = 2; k < 400 && sp.length < 1; k ++ ) { const g = frontAt( k * FRONT.every + 4 ); if ( g && g.spout ) for ( let t = g.t0; t < g.t1; t += 0.02 ) { const w = spoutAt( g, t ); if ( w ) { sp.push( [ g, w, t ] ); break; } } }
	ok( sp.length === 1 && sp[ 0 ][ 1 ].life >= 0 && influence( sp[ 0 ][ 0 ], sp[ 0 ][ 1 ].x, sp[ 0 ][ 1 ].z, sp[ 0 ][ 2 ] ).under, 'a waterspout now and then, under the band' );
	ok( /squall line from the/.test( forecastText( P.x, P.z, f.t0, { speed: 0.01 } ) ) && /minutes out/.test( forecastText( P.x, P.z, f.t0, { speed: 0.01 } ) ), `the forecast: "${ forecastText( P.x, P.z, f.t0, { speed: 0.01 } ) }"` );

	// the weather module: the front over the player, the thunder delay, the gust on the boat, two clients agree
	globalThis.location = globalThis.location || { search: '' };
	const wx = await import( '../src/features/weather/index.js' );
	const mk = ( hour, net = null ) => {

		const applied = [];
		const app = {
			mode: 'campaign', rules: { serverClock: !! net }, net,
			settings: { timeOfDay: hour % 24, timeSpeed: 0.01, exposure: 0.55 },
			player: { position: new Vector3( P.x, 1, P.z ), mode: 'boat' },
			boatCtl: { position: new Vector3( P.x, 0, P.z ), mass: 3200, moored: false, applyCollision( dx, dz, jx, jz, px, py, pz ) { applied.push( { jx, jz, py } ); return true; } },
			game: { toast() {} },
		};
		const features = new Features( app );
		const w = features.add( 'weather', { install: ( a, fe ) => new wx.Weather( a, fe, { rng: () => 0.5 } ) } );
		w.day = Math.floor( hour / 24 );
		return { app, w, applied, features };

	};

	const edgeAt = at - 0.02; // the squall reaches him just before the band
	const W = mk( edgeAt );
	W.w.update( 0.1 );
	for ( let i = 0; i < 60; i ++ ) { W.app.settings.timeOfDay = ( edgeAt + i * 0.001 ) % 24; W.w.update( 0.1 ); }
	ok( W.w.front && W.w.front.id === f.id, 'the weather module sees the same front' );
	ok( W.applied.length > 0 && W.applied.every( ( a ) => Math.hypot( a.jx, a.jz ) <= 3200 * wx.GUST.accel * 0.1 + 1e-6 && a.py > 1 ), `the squall heels the boat: ${ W.applied.length } pushes, each at most ${ wx.GUST.accel } m/s^2 for the frame, ${ wx.GUST.lever } m up` );
	W.app.settings.timeOfDay = ( at + 0.25 ) % 24;
	for ( let i = 0; i < 80; i ++ ) W.w.update( 0.1 );
	ok( W.w.local.under && W.w.eff.wind > W.w.cur.wind + 2 && W.w.eff.fetch > W.w.cur.fetch && W.w.current.shown === 'storm', `under the band the sea gets up: wind ${ W.w.cur.wind.toFixed( 1 ) } -> ${ W.w.eff.wind.toFixed( 1 ) } m/s, fetch ${ W.w.cur.fetch.toFixed( 0 ) } -> ${ W.w.eff.fetch.toFixed( 0 ) } km` );
	const th = W.w.strike( 1.715 );
	ok( Math.abs( th.delay - 5 ) < 1e-9, 'the thunder: 1.715 km away, 5 s after the flash (343 m/s)' );
	ok( /squall|front|fronts/.test( W.w.forecastText() ), `the forecast at the helm: "${ W.w.forecastText() }"` );
	// the front's lightning on the screen (wave 21 play-test: it strobed the whole sea several times a second): only under
	// the band, only a strike near the player, never two flashes within seconds; ahead of the band the sky stays dark
	const flashes = [];
	const U = mk( at + 0.25 );
	U.features.on( 'lightningStrike', ( e ) => flashes.push( { ...e, t: U.w._age } ) );
	for ( let i = 0; i < 300; i ++ ) { U.app.settings.timeOfDay = ( at + 0.25 + i * 0.01 ) % 24; U.w.update( 0.25 ); }
	const gaps = flashes.slice( 1 ).map( ( s, i ) => s.t - flashes[ i ].t );
	ok( flashes.length >= 1 && flashes.length <= 15 && flashes.every( ( s ) => s.distanceKm <= 2.5 ) && gaps.every( ( g ) => g >= 8 - 1e-6 ), `under the band: ${ flashes.length } flashes in 3 island hours, all within 2.5 km, ${ gaps.length ? Math.min( ...gaps ).toFixed( 1 ) : '-' } s apart at least` );
	const ahead = [];
	const V = mk( at - 2 );
	V.features.on( 'lightningStrike', ( e ) => ahead.push( e ) );
	for ( let i = 0; i < 50; i ++ ) { V.app.settings.timeOfDay = ( at - 2 + i * 0.01 ) % 24; V.w.update( 0.25 ); }
	ok( V.w.front && V.w.front.id === f.id && ahead.length === 0 && V.w.strikes === 0, `ahead of the band (the edge ${ Math.round( - V.w.local.depth ) } m off): no flash on the screen` );
	// two clients on one universe clock
	const clock = { timeOfDay: at % 24, at: 1_700_000_000_000, timeSpeed: 0.01 };
	const day = Math.floor( at / 24 );
	clock.at = ( day * 24 + clock.timeOfDay ) / clock.timeSpeed * 1000; // (at / 1000 * speed - tod = day * 24)
	const A1 = mk( at, { clock } ), A2 = mk( at, { clock } );
	A1.w.now = A2.w.now = () => clock.at + 1000;
	A1.w.update( 0.1 ); A2.w.update( 0.1 );
	ok( A1.w.front && A2.w.front && A1.w.front.id === A2.w.front.id && Math.abs( A1.w.hours - A2.w.hours ) < 1e-9, `two clients on the universe clock see front ${ A1.w.front && A1.w.front.id } at the same hour` );

}

// ================================================================================================ 7. multiplayer and the board
section( '7. the host runs the navy for everybody; the harbourmaster\'s board' );
{

	const sent = [];
	const app = makeApp( { net: { id: 'me' }, netsync: { sendWorldEvent( kind, data ) { sent.push( [ kind, data ] ); } } } );
	const { features, naval, navy } = setup( { app } );
	// a stored frigate adopted by this host is given a role, not doubled
	const adopted = naval.spawn( 'frigate', { id: 'stored-frigate', x: SEA.x, z: SEA.z } );
	run( features, 1 );
	ok( navy.ships.get( 'stored-frigate' ) === adopted && [ ...navy.ships.values() ].filter( ( s ) => s.kind === 'frigate' ).length === 1 && adopted.navy, 'a navy ship already afloat takes the frigate\'s role (no second frigate)' );
	// another player's wanted flag reaches the host's navy
	features.emit( 'remoteWorldEvent', { kind: 'navyWanted', data: { wanted: true, hostile: false }, from: 'p2' } );
	ok( adopted.navy.wanted( { remote: 'p2' } ) && ! adopted.navy.wanted( { remote: 'p3' } ), 'the host judges each player\'s boat by his own flag' );
	// a hail meant for a guest goes to him as a world event
	adopted.mem.say = 'hail';
	adopted.mem.who = 'p2'; // (as thinkNavy leaves them when the boat she hails is p2's)
	navy._outbox();
	ok( sent.some( ( e ) => e[ 0 ] === 'navyHail' && e[ 1 ].to === 'p2' && e[ 1 ].say === 'hail' ), 'the hail for a guest is sent to him' );
	app.toasts.length = 0;
	features.emit( 'remoteWorldEvent', { kind: 'navyHail', data: { to: 'me', say: 'hail', ship: 'HMS Heron' }, from: 'host' } );
	ok( app.toasts.some( ( t ) => /Heave to/.test( t ) && /Heron/.test( t ) ), 'and a hail from the host\'s navy reaches us' );
	// the board at Tidemark lists the navy's bounty notice
	navy.owed = 380;
	const post = navy.postings( 'tidemark', 30 );
	ok( post.length === 1 && post[ 0 ].type === 'navyBounty' && post[ 0 ].reward.money === 380 && navy.postings( 'pons', 30 ).length === 0, 'Tidemark\'s board carries the navy bounty notice' );
	ok( typeof navyModule.install === 'function' && navyModule.install( makeApp(), new Features( makeApp() ), { jetty: false } ) instanceof Navy, 'the module exports install( app, features )' );

}

// ================================================================================================ 8. the navy's own GLBs (wave 19F)
section( '8. the frigate and the revenue cutter GLBs: nodes, materials, size; loaded through naval\'s ModelSet' );
{

	const { readFileSync, statSync } = await import( 'node:fs' );
	const { join } = await import( 'node:path' );
	const { fileURLToPath } = await import( 'node:url' );
	const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
	const json = ( f ) => { const b = readFileSync( join( ROOT, 'public', f ) ); return JSON.parse( b.subarray( 20, 20 + b.readUInt32LE( 12 ) ).toString( 'utf8' ) ); };
	const brig = statSync( join( ROOT, 'public/models/ships/brigantine_v2.glb' ) ).size;
	const MAT = [ 'M_NavalSparTimber', 'M_NavalSailCanvas', 'M_NavalRiggingHemp', 'M_NavalLanternGlass', 'M_NavalDeckPlank', 'M_NavalIron', 'M_NavyHullBlue', 'M_NavyHullWhite', 'M_NavyBlueCanvas', 'M_NavyHelmWheel' ];
	for ( const [ kind, node ] of [ [ 'frigate', 'SM_Frigate' ], [ 'revenue', 'SM_Revenue' ] ] ) {

		const cls = SHIP_CLASSES[ kind ], j = json( cls.navyGlb ), size = statSync( join( ROOT, 'public', cls.navyGlb ) ).size;
		const names = j.materials.map( ( m ) => m.name ), prims = j.meshes[ 0 ].primitives;
		const pos = prims.map( ( p ) => j.accessors[ p.attributes.POSITION ] );
		const lo = Math.min( ...pos.map( ( a ) => a.min[ 0 ] ) ), hi = Math.max( ...pos.map( ( a ) => a.max[ 0 ] ) );
		const tris = prims.reduce( ( n, p ) => n + j.accessors[ p.indices ].count / 3, 0 );
		ok( j.nodes.length === 1 && j.nodes[ 0 ].name === node && j.meshes.length === 1 && prims.length === names.length, `${ kind }: one node ${ node }, one primitive per material (${ prims.length })` );
		ok( MAT.every( ( m ) => names.includes( m ) ), `${ kind }: the brigantine's spar / sail / rigging / glass materials (masts fall, the lantern glows) and the navy's paint, canvas and wheel` );
		ok( Math.abs( lo + hi ) < 0.5, `${ kind }: the X extent is centred (${ lo.toFixed( 2 ) } .. ${ hi.toFixed( 2 ) }: centreOnHull leaves the hull where it is)` );
		ok( size < brig * 1.6 && tris < 24640 * 1.6 && ( j.images || [] ).length <= 7, `${ kind }: ${ ( size / 1e6 ).toFixed( 2 ) } MB (brigantine ${ ( brig / 1e6 ).toFixed( 2 ) }), ${ tris } triangles, ${ j.images.length } textures` );

	}

	// the frigate's stations: two tiers inside her sides, under the rail; the cutter's between deck and rail
	const F = SHIP_CLASSES.frigate, R = SHIP_CLASSES.revenue;
	ok( F.stations.every( ( s ) => Math.abs( s.x ) < F.beam / 2 && Math.abs( s.x ) > F.beam / 2 - 0.8 && s.y > 2 && s.y < F.sheer ), 'the frigate\'s guns stand inside her sides, under the rail' );
	ok( R.stations.every( ( s ) => Math.abs( s.x ) < R.beam / 2 && s.y > R.deck && s.y < R.sheer ) && R.stations.length === 4, 'the cutter\'s two guns a side stand at her ports, between deck and rail' );
	ok( F.helm.z < F.wheel.z && F.wheel.y > F.decks[ 0 ].y && F.wheel.z > F.decks[ 0 ].z0 && F.wheel.z < F.decks[ 0 ].z1, 'the frigate\'s coxswain stands aft of the wheel on the quarterdeck' );

	// a real load through naval's ModelSet (headless GPU for the textures)
	const { GPU } = await import( '../src/engine/gpu/GPU.js' );
	let gpu = true;
	try { await GPU.init( { headless: true } ); } catch ( e ) { gpu = false; }
	ok( gpu, 'a headless GPU for the textures' );
	if ( gpu ) {

		globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
		const GREY = new Uint8Array( 16 ).fill( 160 );
		globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
		const { ModelSet } = await import( '../src/features/naval/Models.js' );
		const { hideMast } = await import( '../src/features/naval/MastFall.js' );
		const { Scene } = await import( '../src/engine/index.js' );
		const set = new ModelSet( { scene: new Scene(), baseUrl: '/' } );
		drawNavy( set );
		for ( const kind of [ 'frigate', 'revenue' ] ) {

			const v = set.create( kind );
			const glb = await set.ready( kind );
			const names = v.meshes.map( ( m ) => m.name );
			ok( glb && v.loaded && v.kind === kind && v.navyKind === kind && ! v.dress && v.group.scale.x === 1, `${ kind }: her own GLB loads into the visual (no dress, no scale)` );
			ok( names.includes( 'ship-glass' ) && names.includes( 'ship-M_NavalSailCanvas' ) && names.includes( 'ship-M_NavyHullBlue' ) && ! names.includes( 'ship-M_NavyHelmWheel' ) && !! glb.lantern, `${ kind }: ${ names.length } meshes: the lantern glass, the canvas, the paint; the wheel lifted out` );
			const c = SHIP_CLASSES[ kind ], wp = v.wheel && v.wheel.parent.position;
			ok( !! v.wheel && Math.abs( wp.x ) < 0.05 && Math.abs( wp.y - c.wheel.y ) < 0.1 && Math.abs( wp.z - c.wheel.z ) < 0.1, `${ kind }: the wheel's hub at the helm (${ wp ? [ wp.x, wp.y, wp.z ].map( ( n ) => n.toFixed( 2 ) ).join( ', ' ) : '-' }, class ${ c.wheel.y } / ${ c.wheel.z })` );
			const ship = new Ship( kind, { x: 0, z: 0, yaw: 0 } );
			ship.steer = 0.5;
			v.apply( ship, ship.finalPose( {} ) );
			ok( !! v.wheel && Math.abs( v.wheel.rotation.z + 0.5 * v.wheelTurns * Math.PI * 2 ) < 1e-6, `${ kind }: the wheel turns with her helm` );
			// the hull's own extent (model frame: +X forward, Z across): the bowsprit past her length, the yards across her beam
			let xmax = - Infinity, zmax = 0;
			for ( const m of v.meshes ) { const b = m.geometry.boundingBox; xmax = Math.max( xmax, b.max.x ); zmax = Math.max( zmax, b.max.z ); }
			ok( Math.abs( glb.shiftX ) < 0.3 && xmax > c.length / 2 && zmax > c.beam / 2 - 0.1, `${ kind }: centred (shift ${ glb.shiftX.toFixed( 2 ) }), the bowsprit past her length, spars across her beam` );
			const hidden = hideMast( v.group );
			ok( hidden.length >= 3 && hidden.every( ( m ) => /Spar|Sail|Canvas|Rigging/.test( m.name ) ) && ! hidden.some( ( m ) => /Hull|glass/.test( m.name ) ), `${ kind }: a mast shot away takes ${ hidden.length } meshes (spars, canvas, rigging), not the hull` );
			v.dispose();

		}

		set.dispose();

	}

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
