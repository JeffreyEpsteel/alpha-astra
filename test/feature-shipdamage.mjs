// Plain-node test of wave 11A ship damage (src/features/naval: Ammo.js, Sections.js, Fire.js, Flood.js, MastFall.js and their
// wiring in Naval.js / Ship.js / Brains.js / Hud.js): finite powder and shot (spend, dry, refill, the yard, a powder keg, the
// sandbox ramp), per-section damage (the pick by hit point, rudder and sail effects on turn and speed, silenced guns, a mast
// that falls once), fire (growth, burning, the magazine, dousing at the rail, the wind, AI crews, ramming), flooding (the rise,
// the pump, the crew, sinking with hull left), the AI's dry guns and aim preference, the HUD and the save round trip.
//   node test/feature-shipdamage.mjs
import { Features } from '../src/features/Features.js';
import { Naval, SECTION_REPAIR_PER_HP, MAST_COST } from '../src/features/naval/Naval.js';
import { Ship } from '../src/features/naval/Ship.js';
import { SHIP_CLASSES } from '../src/features/naval/ShipClasses.js';
import { thinkPirate, gunless, AIM_PREF } from '../src/features/naval/Brains.js';
import { AMMO_MAX, SHIP_AMMO, AMMO_PACK, POWDER_KEG, Magazine, ammoMaxFor, buyShot, shotQuote } from '../src/features/naval/Ammo.js';
import { Sections, pickSection, sectionsFor, shipSections, aimPoint, aimHeight, SECTION_RULES, MAST_STATIONS } from '../src/features/naval/Sections.js';
import { Fire, FIRE, growthMul, headwindOver, aiDouseTime } from '../src/features/naval/Fire.js';
import { Flood, FLOOD, floodRate } from '../src/features/naval/Flood.js';
import { MastFall, MastVisual, hideMast, MAST_FALL } from '../src/features/naval/MastFall.js';
import { hudModel, targetBar, damageLine } from '../src/features/naval/Hud.js';
import { aimPlan } from '../src/features/naval/AimAssist.js';
import { Vector3, Quaternion, Group, Mesh } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );

function makeApp( over = {} ) {

	const toasts = [], kicks = [];
	const state = { boat: 'lobster', money: 0, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const keys = new Set(), held = new Set();
	const input = { hit: ( c ) => keys.has( c ), down: ( c ) => held.has( c ), keys, held, rightDown: false, mouseDown: false, enabled: true };
	return {
		mode: 'campaign', settings: { timeOfDay: 12 }, wind: { x: 0, z: 0 },
		terrainData: null, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( 0, 0, 1500 ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), driven: true, moored: false, rudderLift: 2.8 },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 }, group: null },
		camera: { position: new Vector3( 0, 4, 1490 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new Vector3( 0, 1, 1500 ) },
		input, game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick( k ) { kicks.push( k ); } },
		toasts, kicks, ...over,
	};

}

function setup( { app = makeApp(), mode = null, boat = null, extras = {} } = {} ) {

	if ( mode ) app.mode = mode;
	if ( boat ) {

		app.game.state.boat = boat;
		if ( SHIP_CLASSES[ boat ] ) app.boat = { group: app.boat.group }; // (a ship: her size from Boats.js)

	}

	const features = new Features( app );
	const events = [];
	for ( const n of [ 'shipSunk', 'playerBoatDamaged', 'playerBoatSunk', 'outOfShot', 'shotBought', 'sectionBroken', 'mastFell', 'fireStarted', 'fireOut', 'magazineExploded', 'shipFlooded', 'explosion', 'cannonFired' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const spy = { splash: 0, splinters: 0, fire: 0, stopFire: 0, flash: 0, explosion: 0 };
	if ( extras.vfx ) features.add( 'vfx', { install: () => ( {
		splash() { spy.splash ++; }, splinters() { spy.splinters ++; }, debris() {}, smoke() {}, sinking() {}, bubbles() {},
		fire() { spy.fire ++; }, stopFire() { spy.stopFire ++; }, flash() { spy.flash ++; }, explosion() { spy.explosion ++; },
	} ) } );
	for ( const [ name, inst ] of Object.entries( extras.more || {} ) ) features.add( name, { install: () => inst } );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 11, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	return { app, features, naval, events, spy };

}

const run = ( features, seconds, dt = 1 / 30, each = null ) => {

	for ( let i = 0, n = Math.round( seconds / dt ); i < n; i ++ ) {

		features.update( dt );
		if ( each && each( i * dt ) === false ) return i * dt;

	}

	return seconds;

};
const count = ( events, name ) => events.filter( ( e ) => e[ 0 ] === name ).length;

// a ship nobody steers (state 'adrift')
function adrift( naval, kind, x, z, yaw = 0, speed = 0 ) {

	const s = naval.spawn( kind, { x, z, yaw } );
	s.state = 'adrift';
	s.speed = speed;
	s.wantSpeed = speed / s.cls.speed;
	return s;

}

// the naval rng with a fixed draw (pickSection's rudder roll, the fire chances), its helpers kept
function fixRng( naval, v ) {

	const r = naval.rng;
	naval.rng = Object.assign( () => v, { range: r.range, gauss: r.gauss, pick: r.pick } );
	return () => { naval.rng = r; };

}

// ================================================================================================ 1. ammunition
section( '1. powder and shot: a finite stock per hull' );
{

	ok( AMMO_MAX.skiff === 8 && AMMO_MAX.canoe === 8 && AMMO_MAX.cutter === 12 && AMMO_MAX.launch === 12 && AMMO_MAX.lobster === 16 && AMMO_MAX.trawler === 24 && AMMO_MAX.sloop === 40 && AMMO_MAX.brigantine === 60, 'magazine sizes per hull: skiff / canoe 8 (a swivel gun mounts there), cutter 12, launch 12, lobster 16, trawler 24, sloop 40, brigantine 60' );
	ok( ammoMaxFor( 'sloop' ) === 40 && ammoMaxFor( 'skiff' ) === 8 && ammoMaxFor( 'nope' ) === 0, 'ammoMaxFor reads the table (an unknown id: none)' );
	const m = new Magazine( 16 );
	ok( m.spend( 3 ) === 3 && m.rounds === 13 && m.spend( 20 ) === 13 && m.empty && m.spend( 1 ) === 0, 'spend takes what is there and no more' );
	ok( m.add( 40 ) === 16 && m.rounds === 16 && m.room === 0, 'add fills to the top only' );
	m.rounds = 10;
	ok( shotQuote( m ).rounds === 6 && shotQuote( m ).price === 30, 'nearly full: a part pack priced pro rata (6 rounds, $30)' );
	m.rounds = 0;
	const st = { money: 100, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const r1 = buyShot( m, { state: st } );
	ok( r1.ok && r1.added === AMMO_PACK.rounds && r1.price === AMMO_PACK.price && st.money === 40, '"Powder and shot x12, $60": 12 rounds for $60' );
	m.rounds = 0;
	const r2 = buyShot( m, { state: st } );
	ok( ! r2.ok && r2.reason === 'money' && m.rounds === 0 && st.money === 40, 'not enough money: refused' );
	m.rounds = 10;
	ok( buyShot( m, { state: st, free: true } ).ok && m.rounds === 16 && st.money === 40, 'free (sandbox): nothing charged, still capped' );
	ok( buyShot( m, { free: true } ).reason === 'full' && buyShot( new Magazine( 0 ), { free: true } ).reason === 'none', 'a full magazine, or a hull that carries none, is refused' );

	// the player's lobster boat: full at the start, one round per gun fired
	const { app, features, naval, events } = setup();
	naval.playerGun.owned = true;
	run( features, 0.1 );
	ok( naval.ammo.max === 16 && naval.ammo.rounds === 16, 'a new lobster boat comes with a full magazine (16)' );
	ok( naval.fire( 'port' ) && naval.ammo.rounds === 15, 'the swivel gun spends one round a shot' );
	naval.ammo.rounds = 0;
	naval.reloadLeft.port = naval.reloadLeft.starboard = 0;
	ok( naval.fire( 'starboard' ) === false && naval.balls.count === 1, 'dry: the gun clicks and nothing flies' );
	ok( count( events, 'outOfShot' ) === 1 && app.toasts.some( ( t ) => /Out of shot/.test( t ) ), 'outOfShot is emitted and a toast says "Out of shot"' );
	app.player.mode = 'boat';
	const hm = hudModel( naval );
	ok( hm.outOfShot && hm.ammo && hm.ammo.out && hm.guns.every( ( g ) => g.dry && ! g.ready ), 'the HUD says Out of shot, the gun rows NO SHOT' );
	ok( naval.crewFire( 'port' ) === null, 'the crew\'s gunners stop too (crewFire returns null)' );
	// the yard
	app.game.state.money = 100;
	const b1 = naval.buyShot();
	ok( b1.ok && naval.ammo.rounds === 12 && app.game.state.money === 40 && count( events, 'shotBought' ) === 1, 'naval.buyShot: 12 rounds for $60 (shotBought)' );

	// a ship's broadside spends a round a gun, the ripple included
	const s2 = setup( { boat: 'sloop' } );
	run( s2.features, 0.1 );
	ok( s2.naval.ammo.max === 40 && s2.naval.ammo.rounds === 40, 'a sloop carries 40 rounds' );
	s2.naval.fire( 'port' );
	run( s2.features, 0.5 );
	ok( s2.naval.ammo.rounds === 40 - s2.naval.playerGun.guns, `a broadside of ${ s2.naval.playerGun.guns } spends ${ s2.naval.playerGun.guns } rounds` );
	s2.naval.ammo.rounds = 1;
	s2.naval.reloadLeft.port = 0;
	const shots0 = count( s2.events, 'cannonFired' );
	s2.naval.fire( 'port' );
	run( s2.features, 0.5 );
	ok( count( s2.events, 'cannonFired' ) - shots0 === 1 && s2.naval.ammo.rounds === 0, 'the last round fires one gun; the rest of the ripple clicks' );

	// a powder keg from the trade hold
	const trade = { cargo: { powder: { qty: 2 } }, takeCargo( g, n ) { const c = this.cargo[ g ]; const k = Math.min( c.qty, n ); c.qty -= k; return { qty: k, paid: 0 }; } };
	const s3 = setup( { boat: 'sloop', extras: { more: { trade } } } );
	run( s3.features, 0.1 );
	s3.naval.ammo.rounds = 0;
	ok( s3.naval.fire( 'port' ) === true && trade.cargo.powder.qty === 1 && s3.naval.ammo.rounds === POWDER_KEG - s3.naval.playerGun.guns + ( s3.naval.playerGun.guns - 1 ), 'dry with a powder keg in the hold: it is broken out (+24) and the gun fires' );
	ok( s3.app.toasts.some( ( t ) => /keg of powder/.test( t ) ), 'a toast says so' );

	// the sandbox: free, still finite, refilled at the ramp
	const s4 = setup( { mode: 'sandbox' } );
	run( s4.features, 0.1 );
	s4.naval.ammo.rounds = 2;
	run( s4.features, 0.2 );
	ok( s4.naval.ammo.rounds === 2, 'sandbox at sea: the stock is still finite' );
	s4.app.boatCtl.moored = true;
	run( s4.features, 0.2 );
	ok( s4.naval.ammo.rounds === 16, 'sandbox moored at the ramp: topped up for free' );
	s4.naval.ammo.rounds = 0;
	ok( s4.naval.buyShot().ok && s4.naval.ammo.rounds === 12 && s4.app.game.state.money === 0, 'sandbox yard: shot is free' );

}

// ================================================================================================ 2. sections
section( '2. sections: the pick by hit point' );
{

	const sl = SHIP_CLASSES.sloop;
	const geo = { length: sl.length, beam: sl.beam, sheer: sl.sheer, guns: true, mast: true, masts: MAST_STATIONS.sloop, propulsion: 'sails' };
	ok( pickSection( { x: 2, y: 1, z: 0 }, geo, () => 0 ) === 'hull', 'below the sheer amidships: the hull' );
	ok( pickSection( { x: 0, y: 0.5, z: - sl.length * 0.45 }, geo, () => 0.1 ) === 'rudder', 'astern below the sheer: the rudder (30 % roll)' );
	ok( pickSection( { x: 0, y: 0.5, z: - sl.length * 0.45 }, geo, () => 0.5 ) === 'hull', '... or the hull the other 70 %' );
	ok( pickSection( { x: 2, y: sl.sheer + 0.6, z: 0 }, geo ) === 'gunsPort' && pickSection( { x: - 2, y: sl.sheer + 0.6, z: 0 }, geo ) === 'gunsStarboard', 'just above the sheer: the guns of that side' );
	ok( pickSection( { x: 0.1, y: 8, z: MAST_STATIONS.sloop[ 0 ] * sl.length }, geo ) === 'mast', 'up the mast at its station: the mast' );
	ok( pickSection( { x: 0.1, y: 8, z: - 4 }, geo ) === 'sails' && pickSection( { x: 1.5, y: 8, z: 1.4 }, geo ) === 'sails', 'up in the rig away from the spar: the sails' );
	ok( pickSection( { x: 0, y: 1.5, z: 0 }, { length: 8.2, beam: 2.9, sheer: 0.9, guns: true, mast: false, propulsion: 'engine' } ) === 'gunsPort'
		&& pickSection( { x: 0, y: 2.5, z: 0 }, { length: 8.2, beam: 2.9, sheer: 0.9, guns: true, mast: false, propulsion: 'engine' } ) === 'engine', 'a motor boat: the engine instead of the sails' );
	const lob = sectionsFor( 'lobster', 264 ), sk = sectionsFor( 'skiff', 69 ), slp = sectionsFor( 'sloop', 420 ), tr = shipSections( SHIP_CLASSES.trawler );
	ok( lob.has( 'engine' ) && ! lob.has( 'sails' ) && ! lob.has( 'mast' ) && lob.has( 'rudder' ), 'the lobster boat: rudder, engine, guns (no mast)' );
	ok( ! sk.has( 'sails' ) && ! sk.has( 'engine' ) && sk.speedMul === 1, 'the skiff\'s oars are not shot away' );
	ok( slp.has( 'sails' ) && slp.has( 'mast' ) && slp.parts.rudder.max === Math.round( 420 * 0.3 ), 'the sloop: rudder (30 % of the hull), sails, mast, guns' );
	ok( tr.has( 'engine' ) && tr.has( 'mast' ) && ! tr.has( 'gunsPort' ), 'the AI trawler: an engine and a mast, no guns' );

	// a ball through Naval: the section where it struck
	const { naval, features, events } = setup( { extras: { vfx: true } } );
	const s = adrift( naval, 'sloop', 60, 1500, 0 );
	run( features, 0.05 );
	const restore = fixRng( naval, 0.1 );
	naval._shipHit( { owner: 'player', damage: 20, travelled: 0 }, s, 'hull', s.toWorld( 0, 0.5, - sl.length * 0.45, {} ) );
	restore();
	ok( s.sections.parts.rudder.hp === s.sections.parts.rudder.max - 20 && near( s.hp, sl.hp - 10, 1e-9 ), 'a ball astern hits her rudder (the hull feels half of it)' );
	naval._shipHit( { owner: 'player', damage: 20, travelled: 0 }, s, 'hull', s.toWorld( - 2.4, sl.sheer + 0.3, 0, {} ) );
	ok( s.sections.parts.gunsStarboard.hp === s.sections.parts.gunsStarboard.max - 20, 'one at the starboard bulwark: her starboard guns' );
	naval._shipHit( { owner: 'player', damage: 30, travelled: 0 }, s, 'rigging', s.toWorld( 0, 8, - 3, {} ) );
	ok( s.sections.parts.sails.hp === s.sections.parts.sails.max - 30 && s.rigging < 1, 'one in the rig: her sails (and the old rigging speed loss)' );
	naval._shipHit( { owner: 'player', damage: 99, travelled: 0 }, s, 'hull', s.toWorld( - 2.4, sl.sheer + 0.3, 0, {} ) );
	ok( ! s.sections.gunsOk( 'starboard' ) && s.sections.gunsOk( 'port' ) && events.some( ( e ) => e[ 0 ] === 'sectionBroken' && e[ 1 ].section === 'gunsStarboard' ), 'shot away: that battery is silenced (sectionBroken)' );

}

section( '2b. rudder and sails: turn and speed' );
{

	const { naval, features } = setup();
	const a = adrift( naval, 'sloop', 0, 0, 0, 6 ), b = adrift( naval, 'sloop', 200, 0, 0, 6 ), c = adrift( naval, 'sloop', 400, 0, 0, 6 );
	for ( const s of [ a, b, c ] ) { s.want = Math.PI / 2; s.wantSpeed = 6 / s.cls.speed; }
	b.sections.parts.rudder.hp = b.sections.parts.rudder.max * 0.3; // < 40 %
	c.sections.parts.rudder.hp = 0;
	ok( a.sections.turnMul === 1 && b.sections.turnMul === 0.5 && c.sections.turnMul === 0, 'turnMul: 1, 0.5 under 40 %, 0 shot away' );
	run( features, 1.5 );
	ok( b.yaw > 0.1 && a.yaw > b.yaw * 1.6, `the half rudder turns her at about half the rate (${ a.yaw.toFixed( 3 ) } vs ${ b.yaw.toFixed( 3 ) } rad in 1.5 s)` );
	ok( Math.abs( c.yaw ) < 1e-6, 'no rudder: no steering, she holds her heading' );

	const d = adrift( naval, 'sloop', 0, 300, 0, 0 ), e = adrift( naval, 'sloop', 200, 300, 0, 0 ), g = adrift( naval, 'sloop', 400, 300, 0, 4 );
	for ( const s of [ d, e, g ] ) { s.want = 0; s.wantSpeed = 1; }
	e.sections.parts.sails.hp = e.sections.parts.sails.max * 0.4;
	g.sections.parts.sails.hp = 0;
	run( features, 20 );
	ok( near( e.speed / d.speed, 0.5, 0.03 ), `sails under 50 % halve her top speed (${ d.speed.toFixed( 2 ) } vs ${ e.speed.toFixed( 2 ) } m/s)` );
	ok( g.speed < 0.2, `no canvas: adrift (${ g.speed.toFixed( 2 ) } m/s)` );

	// the player's boat: the rudder on the controller, the engine on the thrust
	const p = setup();
	run( p.features, 0.1 );
	p.naval.hitPlayerSection( 'rudder', p.naval.sections.parts.rudder.max * 0.7 );
	run( p.features, 0.05 );
	ok( p.naval.turnFactor === 0.5 && near( p.app.boatCtl.rudderLift, 1.4, 1e-9 ), 'her rudder under 40 %: the controller\'s rudderLift halves (2.8 -> 1.4)' );
	p.naval.hitPlayerSection( 'rudder', p.naval.sections.parts.rudder.hp + 1 );
	run( p.features, 0.05 );
	ok( p.naval.turnFactor === 0 && p.app.boatCtl.rudderLift === 0, 'shot away: no rudder at all' );
	const base = p.naval.speedFactor;
	p.naval.sections.parts.engine.hp = p.naval.sections.parts.engine.max * 0.4;
	ok( near( p.naval.speedFactor, base * 0.25, 1e-9 ), 'the engine under 50 %: half the top speed (a quarter of the thrust)' );
	p.naval.sections.parts.engine.hp = 0;
	ok( p.naval.speedFactor === 0, 'the engine wrecked: adrift' );
	p.app.game.state.money = 5000;
	const cost = p.naval.sectionRepairCost();
	ok( cost === Math.ceil( p.naval.sections.missing() * SECTION_REPAIR_PER_HP ) && cost > 0, `"Rigging and rudder repairs" cost $${ cost }` );
	ok( p.naval.repairSections() && p.naval.turnFactor === 1 && p.app.game.state.money === 5000 - cost, 'the yard re-rigs her' );
	run( p.features, 0.05 );
	ok( p.app.boatCtl.rudderLift === 2.8, 'and the controller has its own rudder back' );

	// a silenced side
	p.naval.playerGun.owned = true;
	p.naval.sections.parts.gunsPort.hp = 0;
	ok( p.naval.fire( 'port' ) === false && p.naval.fire( 'starboard' ) === true, 'her port guns shot away: port is silent, starboard fires' );
	const m = hudModel( Object.assign( p.naval, {} ) );
	ok( m.guns[ 0 ].silent && ! m.guns[ 1 ].silent, 'the HUD marks the silenced side (OUT OF ACTION)' );

}

section( '2c. the mast falls, once' );
{

	const f = new MastFall( { height: 9, side: 1 } );
	const evs = [];
	for ( let t = 0; t < 40; t += 0.05 ) evs.push( ...f.update( 0.05 ).map( ( e ) => e.type ) );
	ok( evs[ 0 ] === 'crack' && evs.filter( ( e ) => e === 'splash' ).length === 1 && evs[ evs.length - 1 ] === 'gone' && f.phase === 'gone', 'MastFall: crack, one splash, then it sinks and is gone' );
	ok( f.angle >= MAST_FALL.max - 1e-9 && f.roll < 0 && new MastFall( { side: - 1 } ).roll > 0, 'it lies over the side it fell to (port: a negative roll about Z)' );

	const { naval, features, events, spy, app } = setup( { extras: { vfx: true } } );
	const s = adrift( naval, 'sloop', 80, 1500, 0 );
	run( features, 0.05 );
	const mastAt = s.toWorld( 0.1, 8, MAST_STATIONS.sloop[ 0 ] * s.cls.length, {} );
	for ( let i = 0; i < 6; i ++ ) naval._shipHit( { owner: 'player', damage: 20, travelled: 0 }, s, 'rigging', mastAt );
	ok( s.sections.mastDown && s.sections.frac( 'sails' ) === 0 && s.sections.speedMul === 0, 'shot through, her mast is down and the sails with it' );
	ok( count( events, 'mastFell' ) === 1 && naval.falls.length === 1, 'mastFell once (a falling mast), however often the stump is hit' );
	const sp0 = spy.splash;
	run( features, 4 );
	ok( spy.splash > sp0 && spy.splinters > 0, 'it cracks off with splinters and splashes over the side' );
	run( features, 30 );
	ok( naval.falls.length === 0, 'the fallen mast floats a while and sinks' );

	// the player's own mast, with a model: the spars hidden, a clone falls; the yard steps a new one
	const g = new Group();
	const spar = new Mesh(), sail = new Mesh(), hull = new Mesh();
	spar.name = 'boat-M_NavalSparTimber'; sail.name = 'boat-M_NavalSailCanvas'; hull.name = 'boat-M_NavalHullPlank';
	g.add( spar, sail, hull );
	const scene = new Group();
	scene.add( g );
	const appS = makeApp();
	appS.scene = null;
	appS.boat = { group: g };
	const P = setup( { app: appS, boat: 'sloop' } );
	P.naval.scene = scene;
	run( P.features, 0.05 );
	P.naval.hitPlayerSection( 'mast', P.naval.sections.parts.mast.max + 1, 'cannon', null, { x: 1, y: 6, z: 0 } );
	ok( P.naval.sections.mastDown && P.naval.speedFactor === 0 && count( P.events, 'mastFell' ) === 1, 'her mast down: no canvas, adrift (mastFell)' );
	ok( ! spar.visible && ! sail.visible && hull.visible && g.children.some( ( c ) => c.name === 'mast-fall' ), 'her spars and sails are hidden, a clone of them topples on a hinge' );
	run( P.features, 4 );
	ok( ! g.children.some( ( c ) => c.name === 'mast-fall' ) && scene.children.some( ( c ) => c.name === 'mast-fall' ), 'over the side it leaves her: it lies in the water (the scene)' );
	P.app.game.state.money = 1e4;
	ok( P.naval.sectionRepairCost() >= MAST_COST && P.naval.repair() && spar.visible && sail.visible && ! P.naval.sections.mastDown, 'the yard steps a new mast (repair): her spars are back' );
	ok( hideMast( g ).length === 2 && ! spar.visible, 'hideMast: a save with the mast down shows her dismasted' );

}

// ================================================================================================ 3. fire
section( '3. fire: growth, burning, the magazine, dousing' );
{

	const f = new Fire();
	ok( f.ignite( { x: 1, y: 2, z: 3 } ) && ! f.ignite() && f.burning, 'a spark starts a fire; a second only feeds it' );
	let hull = 0, sails = 0, t = 0;
	while ( f.level < 1 && t < 60 ) { const r = f.update( 0.1, { ammo: 0 } ); hull += r.hull; sails += r.sails; t += 0.1; }
	ok( near( t, FIRE.grow * ( 1 - 2 * FIRE.start ), 0.15 ), `it grows to full in ~40 s (${ t.toFixed( 1 ) } s)` );
	const r1 = f.update( 1, { ammo: 0 } );
	ok( near( r1.hull, FIRE.burn, 1e-9 ) && near( r1.sails, FIRE.burn * 2, 1e-9 ), 'at full it burns 0.5 hull points / s and the sails twice that' );
	while ( f.burning ) f.update( 0.5, { ammo: 0 } );
	ok( near( f.t, 0, 1e-9 ) && ! f.burning, 'with no powder aboard it burns itself out after 90 s' );
	const g = new Fire();
	g.ignite();
	let blew = - 1;
	for ( let k = 0; k < 900 && blew < 0; k ++ ) if ( g.update( 0.1, { ammo: 10 } ).magazine ) blew = k * 0.1;
	ok( blew > 38 && blew < 44, `with powder aboard: above 0.8 for 10 s the magazine goes up (${ blew.toFixed( 1 ) } s)` );
	ok( growthMul( 0 ) === 1 && near( growthMul( 20 ), FIRE.wind.min, 1e-9 ) && near( headwindOver( 0, 6, 0, 0, - 6 ), 12, 1e-9 ), 'heading into the wind at speed: 12 m/s over the deck, the growth at a quarter' );
	const h = new Fire();
	h.ignite();
	h.update( 20, { ammo: 0 } );
	ok( near( h.douse(), h.level, 1e-9 ) && h.level < 0.5, 'a bucket knocks it down by 0.4' );
	ok( aiDouseTime( 1 ) === 40 && aiDouseTime( 3 ) === 20 && aiDouseTime( 2 ) === 30, 'AI crews douse their own after 40 s (one hand) .. 20 s (three)' );

	// an AI ship: a brigantine's ball sets her alight, her crew put it out
	const { naval, features, events, spy } = setup( { extras: { vfx: true } } );
	const s = adrift( naval, 'sloop', 80, 1500, 0 );
	run( features, 0.05 );
	let restore = fixRng( naval, 0.05 );
	naval._shipHit( { owner: 'brigantine-9', damage: 10, travelled: 0, big: true }, s, 'hull', s.toWorld( 2, 1, 0, {} ) );
	restore();
	ok( s.fire.burning && events.some( ( e ) => e[ 0 ] === 'fireStarted' && e[ 1 ].id === s.id && e[ 1 ].cause === 'cannon' ), 'a brigantine\'s big gun (10 %) sets her alight (fireStarted)' );
	restore = fixRng( naval, 0.5 );
	const s2 = adrift( naval, 'sloop', 300, 1500, 0 );
	naval._shipHit( { owner: 'brigantine-9', damage: 10, travelled: 0, big: true }, s2, 'hull', s2.toWorld( 2, 1, 0, {} ) );
	naval._shipHit( { owner: 'sloop-9', damage: 10, travelled: 0 }, s2, 'hull', s2.toWorld( 2, 1, 0, {} ) );
	restore();
	ok( ! s2.fire.burning, 'the other 90 %, and any smaller gun, does not' );
	const hp0 = s.hp;
	run( features, 31 );
	ok( ! s.fire.burning && events.some( ( e ) => e[ 0 ] === 'fireOut' && e[ 1 ].id === s.id && e[ 1 ].doused ) && s.hp < hp0 && spy.fire > 0 && spy.stopFire > 0, `her crew of ${ s.hands } doused it after ${ aiDouseTime( s.hands ) } s (it burnt ${ ( hp0 - s.hp ).toFixed( 1 ) } hull points; vfx.fire / stopFire)` );
	// left to burn: the magazine
	s.fire.ignite( { x: 0, y: 2, z: 0 } );
	s._douseAt = 999;
	s.hp = s.maxHp;
	run( features, 45 );
	ok( count( events, 'magazineExploded' ) === 1 && s.ammo.rounds === 0 && count( events, 'explosion' ) === 1 && spy.flash > 0, 'left to burn with powder aboard, her magazine goes up (explosion, the shot is gone)' );
	ok( s.hp < s.maxHp * ( 1 - FIRE.blast ) + 1, `and it tears a hole in her (${ s.hp.toFixed( 0 ) } / ${ s.maxHp })` );

	// the player's boat: dousing at the rail
	const P = setup( { extras: { vfx: true } } );
	run( P.features, 0.05 );
	P.naval._ignitePlayer( { x: 0.5, y: 1, z: - 1 }, 'cannon' );
	ok( P.naval.fireState.burning && P.app.toasts.some( ( t ) => /Fire aboard/.test( t ) ), 'fire aboard: a toast tells where to douse it' );
	P.app.player.mode = 'deck';
	P.app.player.position.set( 1.2, 1, 1500 );
	run( P.features, 12 );
	const it = P.features.nearestInteractable( P.app.player.position );
	ok( it && it.id === 'naval-douse' && it.prompt() === 'Douse the fire', 'on deck: E "Douse the fire" at the rail' );
	const lv = P.naval.fireState.level;
	it.onInteract();
	ok( P.naval.channel && P.naval.channel.kind === 'douse' && ! P.features.nearestInteractable( P.app.player.position ), 'a 3 s bucket channel (no second prompt meanwhile)' );
	run( P.features, FIRE.douseTime + 0.1 );
	ok( P.naval.fireState.level < lv - 0.3 && ! P.naval.channel, `knocked down (${ lv.toFixed( 2 ) } -> ${ P.naval.fireState.level.toFixed( 2 ) })` );
	for ( let k = 0; k < 4 && P.naval.fireState.burning; k ++ ) {

		const e = P.features.nearestInteractable( P.app.player.position );
		if ( e ) e.onInteract();
		run( P.features, FIRE.douseTime + 0.1 );

	}

	ok( ! P.naval.fireState.burning && P.events.some( ( e ) => e[ 0 ] === 'fireOut' && e[ 1 ].id === 'player' && e[ 1 ].doused ), 'repeated, it puts the fire out (fireOut doused)' );
	ok( P.naval.playerHull.hp < P.naval.playerHull.max && P.events.some( ( e ) => e[ 0 ] === 'playerBoatDamaged' && e[ 1 ].cause === 'fire' ), 'meanwhile it burnt her hull (playerBoatDamaged cause fire)' );

	// the wind over the deck: heading into it at speed slows the growth
	const W1 = setup(), W2 = setup();
	for ( const w of [ W1, W2 ] ) { run( w.features, 0.05 ); w.naval._ignitePlayer( { x: 0, y: 1, z: 0 }, 'cannon' ); }
	W2.app.boatCtl.velocity.set( 0, 0, 6 ); // heading +Z at 6 m/s ...
	W2.app.wind = { x: 0, z: - 6 }; // ... into a 6 m/s wind
	run( W1.features, 10 );
	run( W2.features, 10 );
	ok( W2.naval.fireState.level < W1.naval.fireState.level * 0.5, `into the wind it grows slower (${ W2.naval.fireState.level.toFixed( 3 ) } vs ${ W1.naval.fireState.level.toFixed( 3 ) })` );

	// the player's magazine
	const M = setup();
	run( M.features, 0.05 );
	M.naval._ignitePlayer( { x: 0, y: 1, z: 0 }, 'cannon' );
	run( M.features, 45 );
	ok( count( M.events, 'magazineExploded' ) === 1 && M.naval.ammo.rounds === 0 && M.events.some( ( e ) => e[ 0 ] === 'playerBoatDamaged' && e[ 1 ].cause === 'magazine' ), 'her own magazine goes up if the fire is left (the shot is gone, a great hole)' );

	// a ramming crash faster than 7 m/s
	const R = setup();
	R.app.game.state.boat = 'brigantine';
	R.app.boat = {};
	run( R.features, 0.1 );
	R.app.boatCtl.velocity.set( 0, 0, 9 );
	const sr = adrift( R.naval, 'sloop', 0, 1500 + 18, Math.PI / 2, 0 );
	const rr = fixRng( R.naval, 0.1 );
	for ( let k = 0; k < 90 && ! R.events.some( ( e ) => e[ 0 ] === 'fireStarted' ); k ++ ) {

		R.app.boatCtl.position.z += R.app.boatCtl.velocity.z / 30;
		R.features.update( 1 / 30 );

	}

	rr();
	ok( R.events.some( ( e ) => e[ 0 ] === 'fireStarted' && e[ 1 ].cause === 'ramming' ) && ( R.naval.fireState.burning || sr.fire.burning ), 'a ramming crash at 9 m/s starts a fire at the contact' );

}

// ================================================================================================ 4. flooding
section( '4. flooding: the rise, the pump, the crew, sinking' );
{

	ok( floodRate( 0.5 ) === 0 && near( floodRate( 0.25 ), 0.01, 1e-12 ) && near( floodRate( 0.05 ), 0.03, 1e-12 ), 'below 35 %: 0.01 / s for every 10 % under the line' );
	const fl = new Flood();
	fl.update( 10, { hpFrac: 0.25 } );
	ok( near( fl.level, 0.1, 1e-9 ) && near( fl.speedMul, 0.95, 1e-9 ) && near( fl.settle( 1 ), 0.05, 1e-9 ), 'ten seconds at 25 %: 10 % water, 95 % speed, lower in the water' );
	fl.update( 5, { hpFrac: 0.25, pump: FLOOD.pump } );
	ok( near( fl.level, 0.1 - 0.15, 0.05 + 1e-9 ) && fl.level >= 0, 'the pump gains on it' );

	const group = { position: { y: 0 }, updateMatrixWorld() {} };
	const app = makeApp();
	app.boat.group = group;
	const { naval, features, events } = setup( { app } );
	run( features, 0.05 );
	const h = naval.playerHull;
	h.hp = h.max * 0.25;
	run( features, 10 );
	ok( near( naval.flood, 0.1, 0.01 ), `holed to 25 %, she makes water (${ ( naval.flood * 100 ).toFixed( 1 ) } % in 10 s)` );
	ok( app.toasts.some( ( t ) => /taking on water/.test( t ) ), 'a toast: she is taking on water' );
	ok( near( group.position.y, - naval.floodState.settle( 0.85 ), 1e-9 ), 'her model sits lower in the water' );
	ok( near( naval.speedFactor, ( 0.35 + 0.65 * 0.5 ) * ( 1 - 0.5 * naval.flood ) ** 2, 1e-9 ) && naval.speedFactor < 0.675, `and she is slower (${ naval.speedFactor.toFixed( 3 ) })` );
	// pumping
	app.player.mode = 'deck';
	app.player.position.set( 0, 1, 1500 );
	const pe = features.nearestInteractable( app.player.position );
	ok( pe && pe.id === 'naval-pump' && /Man the pump/.test( pe.prompt() ), 'on deck: E "Man the pump"' );
	const f0 = naval.flood;
	app.input.held.add( 'KeyE' );
	pe.onInteract();
	run( features, 3 );
	ok( naval.flood < f0 - 0.08 && naval.channel && naval.channel.kind === 'pump', `held, the pump drains her (-0.04 / s: ${ ( f0 * 100 ).toFixed( 1 ) } -> ${ ( naval.flood * 100 ).toFixed( 1 ) } %)` );
	app.input.held.delete( 'KeyE' );
	run( features, 1 );
	ok( ! naval.channel, 'let go, the pumping stops' );
	// the crew pump while no enemy is near
	const C = setup( { extras: { more: { crew: { posts: { pepe: 'gunner', doge: 'angler' } } } } } );
	run( C.features, 0.05 );
	C.naval.playerHull.hp = C.naval.playerHull.max * 0.3; // 0.005 / s in
	C.naval.floodState.level = 0.2;
	run( C.features, 10 );
	ok( C.naval.flood < 0.2 - 0.1, `two posted hands pump her out (${ ( C.naval.flood * 100 ).toFixed( 1 ) } %)` );
	C.naval.floodState.level = 0.2;
	adrift( C.naval, 'sloop', 100, 1500, 0 ).state = 'broadside';
	run( C.features, 10 );
	ok( C.naval.flood > 0.2, 'with a pirate in range they stay at their posts' );
	// full: she goes down with hull left
	naval.floodState.level = 0.995;
	app.player.mode = 'boat';
	run( features, 1 );
	const sunk = events.find( ( e ) => e[ 0 ] === 'playerBoatSunk' );
	ok( sunk && sunk[ 1 ].cause === 'flooding' && naval.sinking && count( events, 'shipFlooded' ) === 1, 'full of water she sinks through the sinking flow (cause flooding) with hull points left' );

	// repairs drain her
	const D = setup();
	run( D.features, 0.05 );
	D.naval.playerHull.hp = D.naval.playerHull.max * 0.2;
	D.naval.floodState.level = 0.4;
	D.app.game.state.money = 1e4;
	ok( D.naval.repair() && D.naval.flood === 0, 'the yard\'s repair pumps her dry' );

	// an AI ship
	const A = setup();
	const s = adrift( A.naval, 'sloop', 80, 1500, 0 );
	s.hp = s.maxHp * 0.05;
	run( A.features, 10 );
	ok( s.flood.level > 0.04, `an AI hull at 5 % floods too, her crew pumping (${ ( s.flood.level * 100 ).toFixed( 1 ) } %)` );
	s.flood.level = 0.995;
	run( A.features, 1 );
	ok( ! s.alive && count( A.events, 'shipFlooded' ) === 1 && count( A.events, 'shipSunk' ) === 1, 'full, she goes down (shipFlooded, shipSunk)' );
	const s2 = adrift( A.naval, 'sloop', 300, 1500, 0 );
	s2.hp = s2.maxHp * 0.05;
	s2.fleeAt = 0; // (she would run otherwise)
	s2.state = 'boarded';
	run( A.features, 5 );
	ok( s2.flood.level === 0, 'a prize alongside for a boarding is kept afloat' );

}

// ================================================================================================ 5. the AI's guns
section( '5. AI ships: finite rounds, dry guns, where they aim' );
{

	ok( SHIP_AMMO.sloop === 24 && SHIP_AMMO.brigantine === 36 && SHIP_AMMO.trawler === 0, 'AI stocks: sloop 24, brigantine 36, the trawler none' );
	const { naval, features, events, app } = setup();
	app.player.mode = 'boat';
	run( features, 0.05 );
	naval._refreshTarget();
	const s = adrift( naval, 'sloop', 100, 1500, 0 ); // her port side (+X... ) faces the boat at x = 0? she heads +Z: port is +X, the boat is at -X: starboard
	s.tgt = naval.target;
	ok( s.ammo.rounds === 24, 'a sloop sails with 24 rounds' );
	ok( naval._shipFire( s, 'starboard' ) === true, 'she fires a broadside' );
	run( features, 1.2 );
	ok( s.ammo.rounds === 24 - s.gunStations( 'starboard' ).length, `a round a gun (${ s.ammo.rounds } left)` );
	s.ammo.rounds = 1;
	s.reload.starboard = 0;
	naval._shipFire( s, 'starboard' );
	run( features, 1.2 );
	ok( s.ammo.rounds === 0 && events.some( ( e ) => e[ 0 ] === 'outOfShot' && e[ 1 ].by === s.id ), 'her last round: outOfShot { by: her id }' );
	s.reload.starboard = 0;
	ok( naval._shipFire( s, 'starboard' ) === false && gunless( s ), 'dry, she cannot fire' );

	// the brains: dry and heavier rams, dry and lighter runs
	const w = { time: 0, night: false, storm: false, rng: Object.assign( () => 0.5, { range: ( a, b ) => ( a + b ) / 2 } ), terrain: null, fire: () => false, escape: () => {} };
	const mk = ( mass ) => {

		const p = new Ship( 'sloop', { x: 0, z: 1500, yaw: 0 } );
		p.state = 'broadside';
		p.mem.side = 1;
		p.ammo.rounds = 0;
		return { p, t: { x: 90, z: 1500, vx: 0, vz: 0, ok: true, mass } };

	};
	let { p, t } = mk( 3000 );
	thinkPirate( p, { ...w, target: t }, 0.1 );
	ok( p.mem.dry && p.mem.ram && p.state === 'broadside' && p.wantSpeed === 1, 'dry and heavier than her target: she rams' );
	( { p, t } = mk( 90000 ) );
	thinkPirate( p, { ...w, target: t }, 0.1 );
	ok( p.state === 'flee', 'dry and lighter: she runs' );
	( { p, t } = mk( 90000 ) );
	p.state = 'patrol';
	thinkPirate( p, { ...w, target: t }, 0.1 );
	ok( p.state === 'patrol', 'a dry pirate who cannot ram does not start a chase' );
	( { p, t } = mk( 3000 ) );
	p.ammo.rounds = 10;
	p.sections.parts.gunsPort.hp = 0;
	p.reload.starboard = 0;
	p.mem.wearT = 0;
	thinkPirate( p, { ...w, target: { ...t, x: 90 } }, 0.1 );
	ok( p.mem.side === - 1, 'her engaged battery shot away: she wears round to bring the other to bear' );
	// aim preference: sails while he runs, hull while he closes
	const q = new Ship( 'sloop', { x: 0, z: 1500, yaw: 0 } );
	q.state = 'broadside';
	q.mem.side = 1;
	const tq = { x: 100, z: 1500, vx: 0, vz: 0, ok: true, mass: 3000 };
	for ( let k = 0; k < 30; k ++ ) { tq.x += 0.6; thinkPirate( q, { ...w, target: tq }, 0.1 ); }
	ok( q.mem.aim === 'sails', `he opens the range (${ q.mem.rangeRate.toFixed( 1 ) } m/s): she shoots at his sails` );
	for ( let k = 0; k < 40; k ++ ) { tq.x -= 0.6; thinkPirate( q, { ...w, target: tq }, 0.1 ); }
	ok( q.mem.aim === 'hull', 'he closes: the hull' );
	ok( naval._sailHeightOf( naval.target ) > 0.9 + 0.3, 'her guns lie higher for his sails' );

}

// ================================================================================================ 6. aiming at a part (Tab)
section( '6. the player aims at a part: hull / sails / rudder' );
{

	const { naval, features, app } = setup( { boat: 'sloop' } );
	ok( features._keys.get( 'Tab' ) === 'naval', 'Tab is claimed by naval' );
	ok( naval.aimPart === 'hull' && naval.cycleAimPart() === 'sails' && naval.cycleAimPart() === 'rudder' && naval.cycleAimPart() === 'hull', 'Tab cycles hull -> sails -> rudder' );
	const s = adrift( naval, 'sloop', 120, 1500, 0 );
	run( features, 0.05 );
	const ph = aimPoint( s, 'hull' ), ps = aimPoint( s, 'sails' ), pr = aimPoint( s, 'rudder' );
	ok( ps.y > ph.y + 3 && pr.z < s.z - 5, 'the aim points: the sails high, the rudder at her stern' );
	const ai = { side: 'port', range: 200, from: { x: 0, y: 3, z: 0 }, dir: { x: 1, y: 0.02, z: 0 }, el: 0.02 };
	naval.aimPart = 'sails';
	naval._aimForPart( ai );
	const sailsEl = ai.el;
	const ai2 = { side: 'port', range: 200, from: { x: 0, y: 3, z: 0 }, dir: { x: 1, y: 0.02, z: 0 }, el: 0.02 };
	naval.aimPart = 'hull';
	naval._aimForPart( ai2 );
	ok( sailsEl > ai2.el && ai.part === 'sails' && near( Math.hypot( ai.dir.x, ai.dir.y, ai.dir.z ), 1, 1e-9 ), `aimed by hand at the sails the elevation rises (${ ( sailsEl * 57.3 ).toFixed( 2 ) } vs ${ ( ai2.el * 57.3 ).toFixed( 2 ) } deg)` );
	app.player.mode = 'boat';
	app.boatCtl.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0 );
	naval.playerGun.owned = true;
	naval.aimPart = 'sails';
	const plan = aimPlan( naval, 'port' );
	naval.aimPart = 'hull';
	const plan2 = aimPlan( naval, 'port' );
	ok( plan && plan2 && plan.target && plan.points[ 0 ] && plan.t > 0 && plan2.t > 0, 'the aim assist leads on the chosen part' );
	naval.aiming = true;
	naval.aimInfo = { side: 'port', range: 120, inArc: true, from: { x: 0, y: 3, z: 1500 }, dir: { x: 1, y: 0.05, z: 0 }, el: 0.05, point: { x: 120, y: 0, z: 1500 } };
	naval.aimPart = 'rudder';
	const hm = hudModel( naval );
	ok( hm.aiming && hm.aiming.part === 'rudder', 'the aiming readout names the part' );
	naval.aiming = false;

}

// ================================================================================================ 7. HUD
section( '7. the HUD: pips, damage control' );
{

	const { naval, features, app } = setup();
	app.player.mode = 'boat';
	const s = adrift( naval, 'sloop', 120, 1500, 0 );
	run( features, 0.05 );
	s.sections.parts.rudder.hp = 0;
	s.sections.parts.sails.hp = s.sections.parts.sails.max * 0.3;
	s.fire.ignite();
	const tb = targetBar( naval );
	ok( tb && tb.sections.length === 5 && tb.sections.find( ( p ) => p.id === 'rudder' ).frac === 0 && tb.sections.find( ( p ) => p.id === 'sails' ).frac === 0.3 && tb.fire > 0, 'the target bar carries her sections as pips (and her fire)' );
	ok( damageLine( naval ) === null, 'a sound boat: no damage-control line' );
	naval.fireState.ignite();
	naval.floodState.level = 0.3;
	naval.sections.parts.rudder.hp = 0;
	const dl = damageLine( naval );
	ok( dl && /FIRE/.test( dl.text ) && /Flooding 30 %/.test( dl.text ) && /Rudder 0 %/.test( dl.text ) && dl.urgent, `her own trouble in a line: "${ dl && dl.text }"` );
	const hm = hudModel( naval );
	ok( hm.dc && hm.ammo === null, 'the model carries it (and no shot readout without a gun)' );
	naval.playerGun.owned = true;
	ok( hudModel( naval ).ammo.rounds === 16, 'with a gun: "Shot 16 / 16"' );

}

// ================================================================================================ 8. save
section( '8. the save round trip' );
{

	const A = setup( { boat: 'sloop' } );
	run( A.features, 0.05 );
	const n = A.naval;
	n.ammo.rounds = 7;
	n.sections.parts.rudder.hp = 10;
	n.hitPlayerSection( 'mast', n.sections.parts.mast.max + 1, 'cannon', null, { x: 1, y: 6, z: 0 } );
	n.floodState.level = 0.3;
	n.playerHull.hp = n.playerHull.max * 0.3;
	n._ignitePlayer( { x: 1, y: 2, z: 3 }, 'cannon' );
	n.fireState.level = 0.5;
	n.aimPart = 'rudder';
	const d = JSON.parse( JSON.stringify( n.toJSON() ) );
	const B = setup( { boat: 'sloop' } );
	B.naval.fromJSON( d );
	run( B.features, 0.05 );
	const m = B.naval;
	ok( m.ammo.rounds === 7 && m.ammo.max === 40, 'the magazine (7 / 40)' );
	ok( m.sections.parts.rudder.hp === 10 && m.sections.mastDown && m.sections.frac( 'sails' ) === 0, 'the sections, the mast down' );
	ok( near( m.flood, 0.3, 0.01 ) && m.fireState.burning && near( m.fireState.level, 0.5, 0.01 ) && m.fireState.at.z === 3 && m.aimPart === 'rudder', 'the water in her, the fire still burning, the aimed part' );
	const C = setup( { boat: 'sloop' } );
	C.naval.fromJSON( { v: 1, boat: 'sloop', hp: 100 } );
	ok( C.naval.ammo.rounds === 40 && ! C.naval.sections.damaged && C.naval.flood === 0 && ! C.naval.fireState.burning, 'a save from before: a full magazine, a sound rig, dry' );
	C.naval.reset();
	ok( C.naval.ammo.rounds === C.naval.ammo.max && C.naval.ammo.max === 40 && C.naval.aimPart === 'hull', 'a new game: a full magazine' );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
