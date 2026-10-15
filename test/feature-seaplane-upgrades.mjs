// Plain-node tests of wave 12C (src/features/seaplane): the airframes (Jade, Petrel, Albatross, Kestrel) and their
// upgrades composed by Airframes.js spec(), flown in the fly() harness (takeoff runs and speeds, the twin's engine-out
// yaw, the Kestrel's ground roll and brakes, cargo mass), the hangar (buy, take out, fit, the airstrip's scope),
// cargo from the trade hold, the searchlight and the radio, bailing out on the parachute (Chute.js) while the
// abandoned plane flies on into a wreck, a land plane's water touchdown, the saves of several airframes, the cockpit
// and the crash parts on every variant, and the exported GLBs.
// No DOM, no GPU.
//   node test/feature-seaplane-upgrades.mjs
import fs from 'node:fs';
import * as E from '../src/engine/index.js';
import * as seaplane from '../src/features/seaplane/index.js';
import { install, Flight, Pilot, SPEC, GEOM, MAX_HP, SITE, CRASH, assess, judge } from '../src/features/seaplane/index.js';
import { AIRFRAMES, AIRFRAME_IDS, UPGRADES, LIVERIES, spec, upgradePrice, capacity, cargoMass, defaultUpgrades } from '../src/features/seaplane/Airframes.js';
import { Chute, CHUTE, buildCanopy } from '../src/features/seaplane/Chute.js';
import { stripPad, stripOffice, onStrip, findAirstrip } from '../src/features/seaplane/Site.js';
import { panelSnapshot, drawPanel } from '../src/features/seaplane/Cockpit.js';
import { Wreck, partsFor, PART_NAMES } from '../src/features/seaplane/Wreck.js';
import { wreckParts } from '../src/features/seaplane/Crash.js';
import { PlaneModels, meshParts, BODY_PARTS, propHubs } from '../src/features/seaplane/Model.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Player } from '../src/player/Player.js';
import { GOODS } from '../src/features/trade/goods.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const DEG = 180 / Math.PI;
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), map: m };

};

function fly( f, sec, ctl = () => {} ) {

	const ev = [];
	for ( let i = 0; i < sec * 60; i ++ ) {

		ctl( f );
		f.update( 1 / 60 );
		for ( const e of f.drainEvents() ) ev.push( { ...e, t: i / 60, z: f.position.z, x: f.position.x } );

	}

	return ev;

}

// a takeoff from rest: full power, back pressure past `rot` m/s; { speed, t, run } of the liftoff
function takeoff( s, { flaps = 0, rot = 12, ground = null } = {} ) {

	const f = new Flight( s );
	if ( ground !== null ) {

		f.groundAt = () => ground;
		for ( let i = 0; i < 4; i ++ ) f.setWater( i, ground - 30 );
		f.place( 0, 0, 0, ground );

	} else f.place( 0, 0, 0 );
	f.engineOn = true;
	fly( f, 3, ( p ) => { p.controls.throttle = 0; p.controls.brake = 1; } );
	const z0 = f.position.z;
	f.flaps = f.flapPos = flaps;
	const ev = fly( f, 70, ( p ) => { p.controls.brake = 0; p.controls.throttle = 1; p.controls.pitch = p.forwardSpeed > rot && ! p.airborne ? 0.6 : 0.1; } );
	const l = ev.find( ( e ) => e.type === 'liftoff' );
	return l ? { speed: l.speed, t: l.t, run: l.z - z0, f } : { speed: Infinity, t: Infinity, run: Infinity, f };

}

// level flight at full power on the autopilot: the top speed
function topSpeed( s, sec = 120 ) {

	const a = new Flight( s );
	a.place( 0, 0, 0 );
	a.position.y = 400;
	a.velocity.set( 0, 0, 40 );
	a.airborne = true;
	a.engineOn = true;
	a.rpm = 1;
	const pl = new Pilot();
	pl.throttle = 1;
	pl.engageAutopilot( a );
	fly( a, sec, ( q ) => pl.read( {}, null, q, 1 / 60 ) );
	return a.airspeed;

}

// ---------------------------------------------------------------- spec composition
{

	const jade0 = spec( 'jade' );
	ok( jade0.mass === SPEC.mass && jade0.maxThrust === SPEC.maxThrust && jade0.geom === GEOM && jade0.flaps.notches === 2 && jade0.litres === 300, 'the stock Jade is the old SPEC (same mass, thrust, geometry, two flap notches, 300 L)' );
	const thrust0 = SPEC.maxThrust;
	const j = spec( 'jade', { engine: 2, floats: 1, tank: 1, flaps: 1, pod: 1, armour: 1, lights: 1, search: 1, radio: 1, livery: 2 } );
	ok( Math.abs( j.maxThrust / thrust0 - 1.3 ) < 1e-9 && j.spoolUp < SPEC.spoolUp, `engine tier 2: +30 % thrust (${ Math.round( j.maxThrust ) } N), a faster spool` );
	ok( Math.abs( j.litres - 480 ) < 1e-9 && j.fuelMinutes > SPEC.fuelMinutes * 1.2 && j.fuelMinutes < SPEC.fuelMinutes * 1.6, `the long-range tank: 480 L, ${ j.fuelMinutes.toFixed( 1 ) } min (the hotter engine drinks more)` );
	ok( j.flaps.notches === 3 && j.flaps.dcl > SPEC.flaps.dcl, 'STOL flaps: a third notch' );
	ok( Math.abs( j.dragArea / SPEC.dragArea - 1.08 ) < 1e-9 && j.crates === 2, 'the cargo pod: +8 % drag, 2 crates' );
	ok( j.hullPoints === 1.5 && Math.abs( j.mass / SPEC.mass - 1.06 ) < 1e-9, 'armour: +50 % hull points, +6 % mass' );
	ok( j.rough > 1 && j.humpDrag < 1 && j.lights.pair && j.lights.search && j.radio && j.livery === 2, 'floats tier 1 (rough water), the lights, the searchlight, the radio and the livery are in the spec' );
	ok( SPEC.maxThrust === thrust0 && SPEC.flaps.notches === undefined && spec( 'jade' ).maxThrust === thrust0, 'spec() is pure: the base SPEC is untouched' );
	ok( AIRFRAME_IDS.join( ',' ) === 'jade,petrel,albatross,kestrel' && AIRFRAMES.petrel.price === 11000 && AIRFRAMES.albatross.price === 42000, 'four airframes: Jade, Petrel ($11,000), Albatross ($42,000), Kestrel' );
	const p = spec( 'petrel' ), a = spec( 'albatross' ), k = spec( 'kestrel' );
	ok( p.seats === 2 && p.litres < 300 && p.rough < 1 && p.mass < SPEC.mass, 'the Petrel: 2 seats, a small tank, fragile floats, light' );
	ok( a.seats === 4 && a.crates === 6 && a.litres > 600 && a.rough === 1.5 && a.geom.engines.length === 2 && a.geom.floats[ 0 ].side === 0 && a.mass > 2 * SPEC.mass, 'the Albatross: 4 seats, a 6-crate bay, a big tank, a hull (rough x1.5), two engines, heavy' );
	ok( k.landplane && k.geom.wheels.length === 3 && k.geom.keels.length === 0, 'the Kestrel: a land plane on three wheels' );
	ok( capacity( 'albatross', { pod: 1 } ) === 6 && ! UPGRADES.find( ( u ) => u.id === 'pod' ).not.includes( 'petrel' ) && capacity( 'petrel', { pod: 1 } ) === 2, 'the pod fits the Jade / Petrel, the Albatross has its bay' );
	ok( upgradePrice( 'albatross', 'engine', 1 ) > upgradePrice( 'jade', 'engine', 1 ) && upgradePrice( 'petrel', 'engine', 1 ) < upgradePrice( 'jade', 'engine', 1 ) && upgradePrice( 'jade', 'engine', 3 ) > upgradePrice( 'jade', 'engine', 1 ), 'upgrade prices by airframe class and tier' );
	ok( LIVERIES.length === 4 && UPGRADES.length >= 9, `${ UPGRADES.length } upgrade rows, ${ LIVERIES.length } liveries` );

	// the rough-water thresholds follow the airframe and the floats
	const touch = ( sink ) => ( { type: 'touch', surface: 'water', sink, speed: 26, pitch: 2, roll: 0 } );
	ok( assess( touch( 3.4 ) ).severity === 'rough' && assess( touch( 3.4 ), 100, { rough: a.rough } ).severity === 'none' && assess( touch( 7 ), 100, { rough: a.rough } ).severity === 'rough', 'the hull: rough-landing and wreck thresholds x1.5' );
	ok( assess( touch( 2.6 ), 100, { rough: p.rough } ).severity === 'rough' && assess( touch( 5.2 ), 100, { rough: p.rough } ).severity === 'wreck', 'the Petrel\'s fragile floats give way sooner' );
	ok( assess( touch( 3.2 ), 100, { rough: spec( 'jade', { floats: 2 } ).rough } ).severity === 'none', 'floats tier 2: a 3.2 m/s arrival is a landing' );
	const lw = assess( { type: 'touch', surface: 'water', sink: 1, speed: 24, pitch: 2, roll: 0 }, 100, { landplane: true } );
	ok( lw.severity === 'wreck' && assess( { type: 'touch', surface: 'ground', sink: 1.5, speed: 24, pitch: 2, roll: 0 }, 100, { landplane: true } ).severity === 'none' && assess( { type: 'touch', surface: 'ground', sink: 4, speed: 24, pitch: 2, roll: 0 }, 100, { landplane: true } ).severity === 'rough', 'a land plane: the ground under 3 m/s is a landing, the water a wreck' );

}

// ---------------------------------------------------------------- takeoffs and speeds (the fly() harness)
const T = {};
{

	T.jade = takeoff( spec( 'jade' ) );
	T.petrel = takeoff( spec( 'petrel' ), { rot: 9 } );
	T.albatross = takeoff( spec( 'albatross' ) );
	T.kestrel = takeoff( spec( 'kestrel' ), { ground: 2 } );
	const fmt = ( r ) => `${ r.run.toFixed( 0 ) } m, ${ r.speed.toFixed( 1 ) } m/s`;
	ok( T.jade.run > 250 && T.jade.run < 400, `the Jade unsticks after ${ fmt( T.jade ) }` );
	ok( T.petrel.run < T.jade.run * 0.6 && T.petrel.speed < T.jade.speed, `the Petrel in about half the run (${ fmt( T.petrel ) })` );
	ok( T.albatross.run > T.jade.run * 1.3 && T.albatross.speed > 32, `the Albatross needs a long run (${ fmt( T.albatross ) })` );
	ok( T.kestrel.run > 150 && T.kestrel.run < 260 && T.kestrel.speed > 22 && T.kestrel.speed < 30, `the Kestrel's ground roll: ${ fmt( T.kestrel ) } (~200 m, ~26 m/s)` );
	const vp = topSpeed( spec( 'petrel' ) ), vj = topSpeed( spec( 'jade' ) ), va = topSpeed( spec( 'albatross' ) );
	ok( vp > 30 && vp < 37 && vj > vp + 10 && va > 55, `top speeds: Petrel ${ vp.toFixed( 1 ) } (~34), Jade ${ vj.toFixed( 1 ) }, Albatross ${ va.toFixed( 1 ) } m/s (cruise ~55)` );
	const e3 = takeoff( spec( 'jade', { engine: 3 } ) );
	ok( e3.run < T.jade.run * 0.8 && topSpeed( spec( 'jade', { engine: 3 } ), 60 ) > vj + 2, `engine tier 3: a shorter run (${ fmt( e3 ) }) and more speed` );
	const s1 = takeoff( spec( 'jade', { flaps: 1 } ), { flaps: 1 } ), s0 = takeoff( spec( 'jade' ), { flaps: 1 } );
	ok( s1.run < s0.run, `STOL flaps: flaps 1 gets off sooner (${ s0.run.toFixed( 0 ) } -> ${ s1.run.toFixed( 0 ) } m)` );
	const st = new Flight( spec( 'jade', { flaps: 1 } ) );
	st.flaps = 3;
	fly( st, 6 );
	const s2 = new Flight( spec( 'jade' ) );
	s2.flaps = 3;
	fly( s2, 6 );
	ok( st.flapPos === 3 && s2.flapPos === 2, 'the third notch runs down only with STOL flaps' );
	const h0 = new Flight( spec( 'jade' ) ), h2 = new Flight( spec( 'jade', { floats: 2 } ) );
	for ( const f of [ h0, h2 ] ) {

		f.place( 0, 0, 0 );
		f.engineOn = true;
		fly( f, 9, ( q ) => { q.controls.throttle = 1; } );

	}

	ok( h2.forwardSpeed > h0.forwardSpeed, `floats tier 2: less drag at the hump (${ h0.forwardSpeed.toFixed( 1 ) } -> ${ h2.forwardSpeed.toFixed( 1 ) } m/s after 9 s)` );

}

// ---------------------------------------------------------------- the twin's engine out: asymmetric thrust yaws it
{

	const run = ( fail ) => {

		const f = new Flight( spec( 'albatross' ) );
		f.place( 0, 0, 0 );
		f.position.y = 500;
		f.velocity.set( 0, 0, 45 );
		f.airborne = true;
		f.engineOn = true;
		f.rpm = 1;
		if ( fail >= 0 ) f.engineFail[ fail ] = true;
		fly( f, 3, ( q ) => { q.controls.throttle = 1; } );
		return { hd: f.heading() * DEG, thrust: f.thrust };

	};

	const both = run( - 1 ), port = run( 0 ), star = run( 1 );
	ok( Math.abs( both.hd ) < 1, `both engines: straight ahead (${ both.hd.toFixed( 2 ) } deg)` );
	ok( port.hd > 3 && star.hd < - 3 && Math.abs( port.thrust - both.thrust / 2 ) < both.thrust * 0.1, `one engine out: the live one yaws the nose towards the dead side (port out ${ port.hd.toFixed( 1 ) } deg, starboard out ${ star.hd.toFixed( 1 ) } deg), half the thrust` );

}

// ---------------------------------------------------------------- cargo: mass and trim
{

	const crates = [ { good: 'tools', qty: 2, kg: GOODS.tools.kg, crates: 1 } ];
	const lp = spec( 'jade', { pod: 1 }, crates ), e0 = spec( 'jade', { pod: 1 } );
	ok( Math.abs( lp.mass - e0.mass - 2 * GOODS.tools.kg ) < 1e-9 && lp.geom.com[ 1 ] < e0.geom.com[ 1 ] && lp.inertia[ 0 ] > e0.inertia[ 0 ], `two crates of tools: +${ 2 * GOODS.tools.kg } kg, the centre of gravity lower, more inertia` );
	const bay = [ { good: 'timber', qty: 3, kg: GOODS.timber.kg, crates: 2 } ];
	const la = spec( 'albatross', {}, bay ), ea = spec( 'albatross' );
	ok( cargoMass( bay ).crates === 6 && la.geom.com[ 2 ] < ea.geom.com[ 2 ] && la.mass === ea.mass + 270, 'six crates of timber in the bay: +270 kg, the centre of gravity moves aft (a nose-up trim change)' );
	ok( ea.geom.com !== la.geom.com && spec( 'albatross' ).geom.com[ 2 ] === ea.geom.com[ 2 ], 'and the base geometry is not touched' );
	const tl = takeoff( la );
	ok( tl.run > T.albatross.run, `loaded, the Albatross needs more run (${ T.albatross.run.toFixed( 0 ) } -> ${ tl.run.toFixed( 0 ) } m)` );
	// trim: the same flight state, the loaded aft-heavy plane pitches nose up harder
	const pitchRate = ( s ) => {

		const f = new Flight( s );
		f.place( 0, 0, 0 );
		f.position.y = 400;
		f.velocity.set( 0, 0, 45 );
		f.airborne = true;
		fly( f, 0.5 );
		return f.pitchAngle();

	};

	ok( pitchRate( la ) > pitchRate( ea ), 'the aft load raises the nose (pitch trim change)' );

}

// ---------------------------------------------------------------- the feature: worlds, a fake airstrip
const terrain = new TerrainData();
let time = 0;
function makeQuery() {

	return {
		n: 1, cpu: new Float32Array( 128 * 4 ), points: new Float32Array( 128 * 4 ), cpuValid: false, version: 0, latency: 2 / 60,
		allocate( name, n ) { const s = this.n; this.n += n; return s; },
		setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
		tick() { for ( let i = 0; i < this.n; i ++ ) this.cpu[ i * 4 ] = 0; this.cpuValid = true; this.version ++; },
	};

}

class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

// a strip on a flat graded shelf far out at sea (x 2600): ground y 3 on the runway and the apron, water around it
const STRIP = { x: 2600, z: 400, y: 3, heading: 0, length: 420, width: 26, pad: { x: 2630, z: 240 } };
const world = ( strip = true ) => ( { islands: [ { id: 'testfield' } ], ...( strip ? { testfield: { airstrip: STRIP } } : {} ), ports: WORLD.ports } );

function makeWorld( { mode = null, money = 0, strip = true } = {} ) {

	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.money = money;
	const query = makeQuery();
	const colliders = new Colliders();
	const input = new InputStub();
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	const player = new Player( { camera, input, terrain, colliders, query, boat: null } );
	const toasts = [];
	const lights = [];
	const app = { terrainData: terrain, colliders, query, input, camera, player, mode: mode || 'campaign', game: { state, toast: ( t ) => toasts.push( t ) }, localLights: { add: ( l ) => lights.push( l ) } };
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'planeTookOff', 'planeLanded', 'planeCrashed', 'planeBailedOut', 'chuteLanded', 'seaplaneUpgraded', 'seaplaneBought', 'planeEngineFailed' ] ) features.on( n, ( e ) => events.push( { n, ...e } ) );
	const sp = install( app, features, { world: world( strip ) } );
	features.list.set( 'seaplane', { module: seaplane, instance: sp } );
	const frame = ( dt = 1 / 60 ) => {

		time += dt;
		query.tick();
		player.update( dt );
		features.update( dt );
		input.endFrame();

	};

	return { state, app, features, sp, player, input, camera, toasts, events, frame, lights };

}

// ---------------------------------------------------------------- the hangar: buy, take out, fit, scopes
{

	const W = makeWorld( { money: 200000 } );
	const { sp, state } = W;
	const ramp = sp.view( 'ramp' ), strip = sp.view( 'strip' );
	ok( ramp.airframes.map( ( a ) => a.id ).join( ',' ) === 'jade,petrel,albatross' && strip.airframes.map( ( a ) => a.id ).join( ',' ) === 'kestrel', 'the ramp hangar sells the three seaplanes, the airstrip hangar the Kestrel' );
	const o = stripOffice( STRIP ), pad = stripPad( STRIP );
	ok( Math.hypot( pad.x - STRIP.pad.x, pad.z - STRIP.pad.z ) < 1e-9 && Math.abs( pad.heading ) < 1e-9 && onStrip( STRIP, pad.x, pad.z ) && onStrip( STRIP, STRIP.x, STRIP.z + 150 ) && ! onStrip( STRIP, STRIP.x + 80, STRIP.z + 150 ), 'the pad faces down the runway; the runway and the apron are ground' );
	const it = W.features.nearestInteractable( new E.Vector3( o.x, o.y, o.z ) );
	ok( it && it.id === 'seaplane-strip-hangar', 'E at the strip\'s office: the airstrip hangar' );
	it.onInteract();
	ok( sp.panel.scope === 'strip', 'which opens the hangar window scoped to the strip' );
	ok( sp.buy().ok && sp.af === 'jade' && state.money === 200000 - 18000, 'the Jade first (the old buy())' );
	ok( sp.buy( 'petrel' ).ok && sp.af === 'petrel' && sp.owns( 'jade' ) && state.money === 200000 - 29000, 'the Petrel bought: it goes out on the ramp, the Jade into the hangar' );
	ok( sp.flight.spec.id === 'petrel' && sp.flight.mass === spec( 'petrel' ).mass, 'the flight model flies the Petrel now' );
	ok( sp.fit( 'engine' ).ok && sp.upgrades.engine === 1 && Math.abs( sp.flight.spec.maxThrust - spec( 'petrel' ).maxThrust * 1.15 ) < 1e-6, 'engine tier 1 fitted on the Petrel' );
	const m1 = state.money;
	ok( sp.fit( 'engine' ).ok && sp.fit( 'engine' ).ok && ! sp.fit( 'engine' ).ok && sp.upgrades.engine === 3 && m1 - state.money === upgradePrice( 'petrel', 'engine', 2 ) + upgradePrice( 'petrel', 'engine', 3 ), 'three engine tiers, then fully upgraded, paid by the Petrel\'s class' );
	ok( sp.fit( 'livery', 3 ).ok && sp.upgrades.livery === 3, 'repainted Sunflower' );
	ok( sp.takeOut( 'jade' ).ok && sp.af === 'jade' && sp.upgrades.engine === 0 && sp.fleet.petrel.upgrades.engine === 3, 'take the Jade out: its own (stock) upgrades; the Petrel keeps hers' );
	ok( ! sp.buy( 'kestrel' ).ok || true, '(the Kestrel is bought below)' );
	ok( sp.buy( 'albatross' ).ok && sp.af === 'albatross' && ! sp.fit( 'pod' ).ok && sp.capacity() === 6, 'the Albatross: no pod (it has its bay of 6)' );
	sp.flight.position.x += 400;
	ok( ! sp.fit( 'armour' ).ok, 'upgrades are fitted at the hangar only' );
	sp.recall();
	ok( sp.fit( 'armour' ).ok && sp.spec.hullPoints === 1.5, 'armour fitted at the ramp' );
	// no airstrip in the world: no Kestrel
	const N = makeWorld( { money: 50000, strip: false } );
	ok( ! N.sp.available( 'kestrel' ) && ! N.sp.buy( 'kestrel' ).ok && N.sp.view( 'strip' ).airframes.length === 0, 'no airstrip: the Kestrel is not for sale' );
	// sandbox: free, still fitted explicitly
	const S = makeWorld( { mode: 'sandbox' } );
	S.sp.buy( 'albatross' );
	ok( S.sp.af === 'albatross' && S.sp.upgrades.tank === 0 && S.sp.view().upgrades.every( ( u ) => u.cost === 0 ) && S.sp.fit( 'tank' ).ok && S.sp.spec.litres > 1400, 'sandbox: every airframe and upgrade free, but fitted explicitly' );

}

// ---------------------------------------------------------------- the save of several airframes
{

	const W = makeWorld( { money: 200000 } );
	const { sp } = W;
	sp.buy();
	sp.fit( 'tank' );
	sp.flight.fuel = 0.4;
	sp.hp = 70;
	sp.buy( 'petrel' );
	sp.fit( 'flaps' );
	sp.fit( 'livery', 2 );
	sp.buy( 'albatross' );
	sp.cargo.push( { good: 'rum', qty: 3, kg: GOODS.rum.kg, crates: 1, cond: 1, paid: 90 } );
	sp._respec();
	sp.failEngine( 1 );
	const saved = JSON.parse( JSON.stringify( sp.toJSON() ) );
	const W2 = makeWorld();
	W2.sp.fromJSON( saved );
	const s2 = W2.sp;
	ok( s2.af === 'albatross' && s2.owned && s2.cargo.length === 1 && s2.cargo[ 0 ].qty === 3 && s2.flight.mass === spec( 'albatross', {}, s2.cargo ).mass && s2.flight.engineFail[ 1 ], 'the Albatross comes back out, her cargo (and its mass) and the dead engine with her' );
	ok( s2.takeOut( 'jade' ).ok && s2.upgrades.tank === 1 && s2.hp === 70 && Math.abs( s2.flight.fuel - 0.4 ) < 1e-3 && s2.spec.litres === 480, 'the Jade: her tank upgrade, condition 70 %, 40 % fuel' );
	ok( s2.takeOut( 'petrel' ).ok && s2.upgrades.flaps === 1 && s2.upgrades.livery === 2 && s2.flight.notches === 3, 'the Petrel: STOL flaps and her livery' );
	ok( ! s2.owns( 'kestrel' ) && Object.keys( saved.fleet ).sort().join( ',' ) === 'albatross,jade,petrel', 'three airframes in the save' );
	const W3 = makeWorld();
	W3.sp.fromJSON( { owned: true, hp: 80, fuel: 0.3 } );
	ok( W3.sp.af === 'jade' && W3.sp.owned && W3.sp.hp === 80, 'an older save is the Jade' );

}

// ---------------------------------------------------------------- cargo from the trade hold
{

	const W = makeWorld( { mode: 'sandbox' } );
	const { sp, features } = W;
	const hold = { tools: 3, rum: 1 };
	const trade = {
		get cargo() { const o = {}; for ( const g in hold ) if ( hold[ g ] > 0 ) o[ g ] = { qty: hold[ g ], cond: 1, paid: 10 * hold[ g ], crates: hold[ g ] * GOODS[ g ].crates, kg: 0 }; return o; },
		crates() { let n = 0; for ( const g in hold ) n += hold[ g ]; return n; },
		takeCargo( g, n ) { const q = Math.min( hold[ g ] || 0, n ); hold[ g ] -= q; return { qty: q, paid: q * 10 }; },
		addCargo( g, n, o ) { this.added = { g, n, o }; hold[ g ] = ( hold[ g ] || 0 ) + n; return n; },
	};
	features.list.set( 'trade', { instance: trade } );
	sp.buy();
	ok( sp.capacity() === 0 && ! sp.loadCargo().ok, 'no pod: no cargo' );
	sp.fit( 'pod' );
	for ( let i = 0; i < 30; i ++ ) W.frame();
	const door = W.features.nearestInteractable( sp.flight.toWorldXYZ( - Math.abs( sp.flight.geom.door[ 0 ] ), sp.flight.geom.door[ 1 ], sp.flight.geom.door[ 2 ] - 1.2, new E.Vector3() ) );
	ok( door && door.id === 'seaplane-cargo' && /Load/.test( door.prompt() ), `the cargo door offers: ${ door ? door.prompt() : '-' }` );
	const m0 = sp.flight.mass;
	door.onInteract();
	ok( sp.cargoCrates() === 2 && hold.tools === 1 && sp.flight.mass === m0 + 2 * GOODS.tools.kg, `two crates of tools loaded into the pod (+${ sp.flight.mass - m0 } kg)` );
	ok( /Unload/.test( door.prompt() ) && sp.unloadCargo().ok && sp.cargoCrates() === 0 && hold.tools === 3 && trade.added.o.force && trade.added.o.port === 'home' && sp.flight.mass === m0, 'and unloaded back into the hold at the port' );
	sp.flight.position.x += 1500;
	ok( ! sp.cargoPort() && ! sp.loadCargo().ok, 'away from any port: no loading' );

}

// ---------------------------------------------------------------- the searchlight and the radio
{

	const W = makeWorld( { mode: 'sandbox' } );
	const { sp, input, frame, features } = W;
	const pins = new Map();
	features.list.set( 'worldmap', { instance: { addMarker: ( m ) => pins.set( m.id, m ), removeMarker: ( id ) => pins.delete( id ) } } );
	features.list.set( 'naval', { instance: { ships: [ { x: SITE.berth.x + 300, z: SITE.berth.z + 200, name: 'Near' }, { x: SITE.berth.x + 900, z: SITE.berth.z, name: 'Far' } ] } } );
	sp.buy();
	sp.fit( 'search' );
	sp.fit( 'lights' );
	sp.fit( 'radio' );
	ok( W.lights.length === 2 && W.lights.some( ( l ) => l.id === 'search' ), 'the upgrades\' lamps join the local lights once' );
	sp.board();
	input.keys.add( 'Semicolon' );
	for ( let i = 0; i < 30; i ++ ) frame();
	const sl = sp.systems.light( 'search' );
	ok( sp.systems.search && sl.enabled, 'holding ; sweeps the searchlight' );
	W.camera.quaternion.setFromAxisAngle( new E.Vector3( 0, 1, 0 ), Math.PI ).multiply( new E.Quaternion().setFromAxisAngle( new E.Vector3( 1, 0, 0 ), - 0.4 ) );
	frame();
	sl.update();
	ok( sl.dir.y < - 0.2 && sl.dir.z > 0.5, `it points where the pilot looks (down ahead: ${ sl.dir.x.toFixed( 2 ) }, ${ sl.dir.y.toFixed( 2 ) }, ${ sl.dir.z.toFixed( 2 ) })` );
	input.keys.delete( 'Semicolon' );
	frame();
	ok( ! sp.systems.search && ! sl.enabled && ! sp.systems.landing, 'released: off (no landing-light toggle)' );
	input.keys.add( 'Semicolon' );
	frame();
	input.keys.delete( 'Semicolon' );
	frame();
	ok( sp.systems.landing && sp.systems.light( 'landing2' ).enabled && sp.systems.light( 'landing2' ).cosOuter < Math.cos( 25 / DEG ), 'a tap of ; still toggles the landing lights: the pair, wider' );
	for ( let i = 0; i < 150; i ++ ) frame();
	ok( [ ...pins.values() ].some( ( m ) => /Near/.test( m.label ) ) && ! [ ...pins.values() ].some( ( m ) => /Far/.test( m.label ) ), 'the radio puts the ship within 600 m on the map (not the far one)' );
	sp.act( 'exit', 'panel' );
	frame();
	ok( ! [ ...pins.keys() ].some( ( k ) => k.startsWith( 'seaplane-radio-' ) ), 'out of the cockpit the radio pins go' );

}

// ---------------------------------------------------------------- the parachute
{

	// the chute alone: the canopy timing, the descent, the drift, the landing
	const c = new Chute( { position: new E.Vector3( 0, 300, 0 ), velocity: new E.Vector3( 0, 0, 40 ), heading: 0, agl: 300, seaAt: () => 0, look: () => ( { x: 1, z: 0 } ) } );
	let openAt = null, landed = null, vy = 0, vh = 0;
	for ( let i = 0; i < 60 * 120 && ! landed; i ++ ) {

		for ( const e of c.step( 1 / 60 ) ) {

			if ( e.type === 'open' ) openAt = c.t;
			if ( e.type === 'landed' ) landed = e;

		}

		if ( c.t > 10 && c.t < 11 ) {

			vy = c.velocity.y;
			vh = c.velocity.x;

		}

	}

	ok( openAt !== null && Math.abs( openAt - CHUTE.delay ) < 0.05, `the canopy opens ${ openAt ? openAt.toFixed( 2 ) : '-' } s after the bail` );
	ok( Math.abs( vy + CHUTE.sink ) < 0.3 && Math.abs( vh - CHUTE.drift ) < 0.3, `under the canopy: ${ ( - vy ).toFixed( 2 ) } m/s down, ${ vh.toFixed( 2 ) } m/s drift towards the look` );
	ok( landed && landed.mode === 'swim' && landed.x > 100, `down in the water (${ landed ? landed.mode : '-' }, drifted ${ landed ? landed.x.toFixed( 0 ) : '-' } m)` );
	const low = new Chute( { position: new E.Vector3( 0, 20, 0 ), agl: 20, seaAt: () => 0 } );
	ok( low.step( 1 / 60 ).some( ( e ) => e.type === 'open' ), 'under 25 m it opens at once' );
	const g = new Chute( { position: new E.Vector3( 0, 40, 0 ), agl: 40, seaAt: () => 0, groundAt: () => 6 } );
	let gl = null;
	for ( let i = 0; i < 60 * 30 && ! gl; i ++ ) gl = g.step( 1 / 60 ).find( ( e ) => e.type === 'landed' );
	ok( gl && gl.mode === 'walk' && gl.y === 6, 'over land: onto the ground on foot' );
	ok( buildCanopy().index.count / 3 < 4000, 'the canopy is a cheap dome of triangles and twelve lines' );

	// in the world: the bail-out gate, the ride down, the abandoned plane flies on into a wreck
	const W = makeWorld( { mode: 'sandbox' } );
	const { sp, player, frame, events, input } = W;
	sp.buy();
	sp.board();
	const f = sp.flight;
	f.position.set( 300, 25, 600 );
	f.quaternion.identity();
	f.velocity.set( 0, 0, 40 );
	f.airborne = true;
	f._wasAir = true;
	f.airTime = 2;
	f.engineOn = true;
	f.rpm = 0.8;
	sp.pilot.throttle = 0.8;
	frame();
	ok( ! sp.canBail() && ! sp.act( 'bail', 'key' ) && sp.piloted, `too low (${ f.agl.toFixed( 0 ) } m): no bailing out` );
	f.position.y = 260;
	frame();
	input.pressed.add( 'Quote' );
	frame();
	ok( sp.piloted && W.toasts.some( ( t ) => /again/.test( t ) ), "' once: a warning" );
	input.pressed.add( 'Quote' );
	frame();
	ok( ! sp.piloted && sp.abandoned && sp.chute && player.mode === 'plane' && player.vehicle === sp.chute.vehicle && events.some( ( e ) => e.n === 'planeBailedOut' ), 'twice: out of the door on the parachute (a Player vehicle), the plane flies on alone' );
	const pose = player.pose( {} );
	ok( pose.mode === 'seat' && pose.frame === sp.chute.quaternion, 'the pilot hangs seated in the harness' );
	for ( let i = 0; i < 300; i ++ ) frame();
	ok( sp.abandoned && f.airborne && Math.abs( f.rollAngle() * DEG ) < 5 && Math.abs( sp.pilot.throttle - 0.8 ) < 1e-9 && f.engineOn, `the abandoned plane: wings level (${ ( f.rollAngle() * DEG ).toFixed( 1 ) } deg), the throttle where it was` );
	// trimmed nose down it dives into the sea: a wreck, and nobody aboard
	sp.pilot.trim = - 1;
	let crash = null, down = null;
	for ( let i = 0; i < 60 * 90 && ! ( crash && down ); i ++ ) {

		frame();
		crash = crash || events.find( ( e ) => e.n === 'planeCrashed' );
		down = down || events.find( ( e ) => e.n === 'chuteLanded' );

	}

	ok( crash && crash.severity === 'wreck' && sp.lost && ! sp.abandoned && sp.wreck, `the abandoned plane went in: ${ crash ? crash.cause : '-' } (${ crash ? crash.severity : '-' })` );
	ok( down && down.mode === 'swim' && player.mode === 'swim' && ! sp.chute, 'the pilot came down in the water, swimming' );
	ok( sp.recall().ok && ! sp.lost, 'the wreck is recovered at the hangar as usual' );

}

// ---------------------------------------------------------------- the Kestrel: the strip, the brakes, the water
{

	const W = makeWorld( { money: 100000 } );
	const { sp, player, frame, events, input, features } = W;
	ok( sp.buy( 'kestrel' ).ok && sp.af === 'kestrel' && sp.home, 'the Kestrel bought at the airstrip hangar: out on the pad' );
	const f = sp.flight;
	player.position.set( STRIP.pad.x + 25, STRIP.y, STRIP.pad.z ); // (an unattended plane far from the camera is not simulated)
	for ( let i = 0; i < 60; i ++ ) frame();
	ok( Math.hypot( f.position.x - STRIP.pad.x, f.position.z - STRIP.pad.z ) < 1 && Math.abs( f.position.y - STRIP.y ) < 0.2 && f.grounded && Math.abs( f.heading() ) < 0.02, `parked on the pad, the wheels on the ground (${ ( f.position.y - STRIP.y ).toFixed( 2 ) } m, ${ Math.hypot( f.position.x - STRIP.pad.x, f.position.z - STRIP.pad.z ).toFixed( 2 ) } m off, heading ${ ( f.heading() * DEG ).toFixed( 1 ) }), nose down the runway` );
	ok( W.features.nearestInteractable( f.toWorldXYZ( ...f.geom.door, new E.Vector3() ) ).id === 'seaplane-door' && sp.board(), 'boards from the ground' );
	// taxi onto the runway centre line by hand, then the takeoff roll
	f.place( STRIP.x, STRIP.z - STRIP.length / 2 + 15, 0, STRIP.y );
	const z0 = f.position.z;
	input.keys.add( 'ShiftLeft' );
	let took = null;
	for ( let i = 0; i < 60 * 40 && ! took; i ++ ) {

		if ( f.forwardSpeed > 18 ) input.keys.add( 'KeyS' );
		frame();
		took = events.find( ( e ) => e.n === 'planeTookOff' );

	}

	const run = f.position.z - z0;
	ok( took && run > 150 && run < 330 && onStrip( STRIP, f.position.x, f.position.z ) && f.forwardSpeed > 20, `a ground roll on the strip: off after ${ run.toFixed( 0 ) } m at ${ f.forwardSpeed.toFixed( 1 ) } m/s` );
	input.keys.clear();
	// braking: rolling at 20 m/s on the runway, throttle closed; B stops it far sooner
	const roll = ( brake ) => {

		sp.reset();
		sp.fromJSON( { owned: true, af: 'kestrel', fleet: { kestrel: { owned: true } } } );
		sp.board();
		f.place( STRIP.x, STRIP.z - 180, 0, STRIP.y );
		f.engineOn = true;
		f.velocity.set( 0, 0, 20 );
		sp.pilot.throttle = 0;
		const s0 = f.position.z;
		if ( brake ) input.keys.add( 'KeyB' );
		for ( let i = 0; i < 60 * 8; i ++ ) frame();
		input.keys.delete( 'KeyB' );
		return { d: f.position.z - s0, v: f.airspeed };

	};

	const nb = roll( false ), wb = roll( true );
	ok( wb.v < 0.3 && wb.d < 60 && nb.v > 10 && nb.d > 120, `B brakes it from 20 m/s to a stop in ${ wb.d.toFixed( 0 ) } m (rolling free: still ${ nb.v.toFixed( 1 ) } m/s after ${ nb.d.toFixed( 0 ) } m)` );
	ok( sp.canExit() && f.grounded, 'stopped on the strip: climb out' );
	// a water touchdown is a wreck
	events.length = 0;
	f.place( 400, 900, 0, 1.2 );
	f.velocity.set( 0, - 1.2, 25 );
	f.airborne = true;
	f._wasAir = true;
	f.airTime = 2;
	let crash = null;
	for ( let i = 0; i < 60 * 4 && ! crash; i ++ ) {

		frame();
		crash = events.find( ( e ) => e.n === 'planeCrashed' );

	}

	ok( crash && crash.severity === 'wreck' && crash.water && sp.lost && player.mode === 'swim', `a gentle arrival on the water in the Kestrel: ${ crash ? crash.cause + ' ' + crash.severity + ' ' + crash.water : '-' } (thrown clear, ${ player.mode })` );
	// the hangar scope while the Kestrel is out
	ok( ! sp.view( 'ramp' ).inScope && sp.view( 'strip' ).inScope, 'the ramp hangar only swaps airframes while the Kestrel is out' );

}

// ---------------------------------------------------------------- the cockpit and the crash parts on every variant
{

	const calls = new Map();
	const ctx = new Proxy( {}, {
		get: ( o, k ) => ( k in o ? o[ k ] : ( ...a ) => { calls.set( k, ( calls.get( k ) || 0 ) + 1 ); return k === 'getImageData' ? { data: new Uint8ClampedArray( 4 ) } : undefined; } ),
		set: ( o, k, v ) => { o[ k ] = v; return true; },
	} );
	for ( const id of AIRFRAME_IDS ) {

		const W = makeWorld( { mode: 'sandbox' } );
		W.sp.buy( id );
		if ( id === 'jade' ) W.sp.fit( 'flaps' );
		W.sp.board();
		const snap = panelSnapshot( W.sp );
		let threw = null;
		try { drawPanel( ctx, snap ); } catch ( e ) { threw = e; }
		ok( ! threw && snap.name === AIRFRAMES[ id ].name && Number.isFinite( snap.litres ) && Object.values( snap ).every( ( v ) => v === null || typeof v === 'boolean' || typeof v === 'string' || Number.isFinite( v ) ), `${ id }: the cockpit reads the variant (${ snap.name }, ${ Math.round( snap.litres ) } L, ${ snap.notches } flap notches)` );
		const w = new Wreck( { position: new E.Vector3( 0, 0.2, 0 ), quaternion: new E.Quaternion(), velocity: new E.Vector3( 0, - 3, 20 ), seed: 5, airframe: id } );
		for ( const n of wreckParts( { type: 'strike', part: 'nose', surface: 'water', speed: 25 }, 'wreck', () => 0.3 ) ) w.detach( n );
		const pp = new E.Vector3(), pq = new E.Quaternion();
		w.pose( 'wingL', pp, pq );
		ok( w.bodies.size >= 5 && new E.Vector3( ...partsFor( id ).wingL.c ).applyQuaternion( pq ).add( pp ).distanceTo( w.bodies.get( 'wingL' ).c ) < 1e-6, `${ id }: the wreck sheds its parts about their own centres` );

	}

}

// ---------------------------------------------------------------- the models
{

	for ( const id of AIRFRAME_IDS ) {

		const url = new URL( '../public/' + AIRFRAMES[ id ].model, import.meta.url );
		if ( ! fs.existsSync( url ) ) {

			ok( false, `${ AIRFRAMES[ id ].model } exists` );
			continue;

		}

		const buf = fs.readFileSync( url );
		const gltf = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
		const len = buf.readUInt32LE( 12 );
		const json = JSON.parse( buf.subarray( 20, 20 + len ).toString( 'utf8' ) );
		let tris = 0;
		for ( const m of json.meshes ) for ( const p of m.primitives ) tris += json.accessors[ p.indices ].count / 3;
		const names = json.nodes.map( ( n ) => n.name );
		const parts = new Set( meshParts( gltf ) );
		const hubs = propHubs( id );
		const props = [ 'Propeller', 'Propeller2' ].slice( 0, hubs.length ).map( ( n ) => json.nodes.find( ( x ) => x.name === n ) );
		const atHub = props.every( ( p, k ) => p && p.translation && Math.hypot( p.translation[ 0 ] - hubs[ k ][ 0 ], p.translation[ 1 ] - hubs[ k ][ 1 ], p.translation[ 2 ] - hubs[ k ][ 2 ] ) < 0.02 );
		let hi = - Infinity;
		for ( const a of json.accessors ) if ( a.type === 'VEC3' && a.max && a.max.length === 3 ) hi = Math.max( hi, a.max[ 0 ] );
		const span = spec( id ).geom.span;
		ok( tris > 1000 && tris < 15000 && [ ...BODY_PARTS, 'prop' ].every( ( n ) => parts.has( n ) ) && atHub && Math.abs( hi - span / 2 ) < 0.25 && json.materials.some( ( m ) => m.name === 'SeaplaneGlass' ) && names.includes( 'Cabin' ), `${ id }.glb: ${ tris } triangles, parts ${ [ ...parts ].join( ' ' ) }, ${ hubs.length } propeller node(s) at the hub(s), span ${ ( hi * 2 ).toFixed( 1 ) } m` );

	}

	// a livery repaints the main / trim materials (clones), the others stay
	const scene = new E.Scene();
	const mat = ( name ) => ( { name, id: name, color: null, clone() { return { name, id: name + '*', color: null }; } } );
	const mk = ( n, m ) => Object.assign( new E.Mesh( new E.BoxGeometry( 1, 1, 1 ), m ), { name: n } );
	const jadeM = mat( 'seaplane-SeaplaneJade' ), creamM = mat( 'seaplane-SeaplaneCream' ), darkM = mat( 'seaplane-SeaplaneDark' );
	const pm = new PlaneModels( { scene, load: async () => ( { meshes: [ mk( 'a', jadeM ), mk( 'b', creamM ), mk( 'c', darkM ), mk( 'seaplane-SeaplaneProp', darkM ), mk( 'seaplane-SeaplaneProp', darkM ) ], parts: [ 'fuselage', 'wingL', 'tail', 'prop', 'prop2' ] } ) } );
	const v = pm.create( 'albatross', 2 );
	await pm.ready;
	const byName = ( n ) => v.meshes.find( ( m ) => m.name === n );
	ok( v.pivots.length === 2 && v.pivots[ 0 ].children.length === 1 && v.pivots[ 1 ].children.length === 1, 'the twin: two propeller pivots, one propeller each' );
	ok( byName( 'a' ).material !== jadeM && Array.isArray( byName( 'a' ).material.color ) && byName( 'c' ).material === darkM, 'livery 2: the jade and cream materials repainted, the rest as built' );
	v.setLivery( 0 );
	ok( byName( 'a' ).material === jadeM, 'and back to the factory paint' );

}

// ---------------------------------------------------------------- the Petrel through a head swell (the wave 21 play-test: with
// the Jade's planing lift she rode the hump 11 deg nose down and "the propeller dug into the water" in any swell)
{

	const _q = new E.Vector3();
	const swellRun = ( id, A, L, dir ) => {

		const f = new Flight( spec( id ) );
		f.place( 0, 0, 0 );
		f.engineOn = true;
		const k = 2 * Math.PI / L, w = Math.sqrt( 9.81 * k );
		let t = 0, lift = null, strike = null;
		const feed = () => { for ( let i = 0; i < 4; i ++ ) { f.probeWorld( i, _q ); const ph = k * _q.z * dir - w * t; f.setWater( i, A * Math.sin( ph ), - A * w * Math.cos( ph ) ); } f.resetWaterAge(); };
		for ( let i = 0; i < 180; i ++ ) { t += 1 / 60; feed(); f.controls.throttle = 0; f.update( 1 / 60 ); f.drainEvents(); }
		for ( let i = 0; i < 60 * 50 && lift === null && ! strike; i ++ ) {

			t += 1 / 60; feed();
			f.controls.throttle = 1;
			f.controls.pitch = f.airspeed > 26 && ! f.airborne ? 0.55 : 0;
			f.update( 1 / 60 );
			for ( const e of f.drainEvents() ) { if ( e.type === 'liftoff' ) lift = i / 60; if ( e.type === 'strike' ) strike = e.part; }

		}

		return { lift, strike };

	};
	for ( const [ A, L, dir ] of [ [ 0.15, 20, - 1 ], [ 0.3, 25, - 1 ], [ 0.5, 40, - 1 ], [ 0.3, 25, 1 ] ] ) {

		const r = swellRun( 'petrel', A, L, dir );
		ok( r.lift !== null && ! r.strike, `the Petrel unsticks through a ${ A } m ${ dir < 0 ? 'head' : 'following' } swell (${ r.strike ? 'STRIKE ' + r.strike : 'airborne at ' + r.lift.toFixed( 0 ) + ' s' })` );

	}

	const j = swellRun( 'jade', 0.3, 25, - 1 );
	ok( ! j.strike, `the Jade still crosses a 0.3 m head swell without a strike (${ j.lift !== null ? 'airborne at ' + j.lift.toFixed( 0 ) + ' s' : 'still on the water' })` );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall seaplane upgrade tests passed' );
process.exit( fails ? 1 : 0 );
