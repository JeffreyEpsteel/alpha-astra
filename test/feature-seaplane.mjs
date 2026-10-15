// Plain-node tests of the seaplane feature (src/features/seaplane): the flight model (floats at rest, the hump and
// the step, a takeoff near 28 m/s with back pressure, the stall), the pilot's controls and assist, what touchdowns
// and strikes mean, the site's clearances on the real heightmap, the purchase / repair / save, a full flight with
// the real Player (board from the jetty, take off, refuse to climb out in the air, a nose-in crash and the tow home,
// a gentle landing and climbing out into the water), multiplayer state and remote planes, and the exported GLB.
// Wave 8, the cockpit: flaps (more lift and drag, a shorter takeoff), fuel burn and an empty tank, engine off = no
// thrust, the starter and the master switch, the autopilot levelling the wings and holding the altitude, trim, the
// stall warning, the panel's controls reachable by a ray from the eye (and a click on one), the face drawing on a
// stand-in 2D context, refuelling, and the switches / fuel in the save.
// No DOM, no GPU.
//   node test/feature-seaplane.mjs
import fs from 'node:fs';
import * as E from '../src/engine/index.js';
import * as seaplane from '../src/features/seaplane/index.js';
import { install, Flight, GEOM, SPEC, liftCoefficient, waterResistance, Pilot, judge, MAX_HP, SITE, jettyPoint, PRICE, REPAIR_PER_HP } from '../src/features/seaplane/index.js';
import { RemotePlanes, INTERP } from '../src/features/seaplane/Remote.js';
import { KEYS as PLANE_KEYS, THROTTLE_DOWN } from '../src/features/seaplane/Seaplane.js';
import { buildSiteGeometry } from '../src/features/seaplane/Site.js';
import { buildStandIn } from '../src/features/seaplane/Model.js';
import { triangleCount } from '../src/world/boat/GeoKit.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Player } from '../src/player/Player.js';
import { STALL_SITES } from '../src/features/trade/stall.js';
import { YARD } from '../src/game/BoatYard.js';
import { Systems, FUEL, refuelCost, START_TIME, CONTROLS, TEX, FACE, rayPanel, hitControl, panelSnapshot, drawPanel } from '../src/features/seaplane/index.js';
import { COCKPIT_KEYS } from '../src/features/seaplane/Seaplane.js';
import { CRASH, assess, throwPoint, wreckParts, hullOffset } from '../src/features/seaplane/Crash.js';
import { Wreck, PARTS } from '../src/features/seaplane/Wreck.js';
import { meshParts, BODY_PARTS, PlaneModels } from '../src/features/seaplane/Model.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const finite = ( v ) => [ v.x, v.y, v.z ].every( Number.isFinite );
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), map: m };

};
const DEG = 180 / Math.PI;

// runs a bare Flight for `sec` at 60 Hz with `ctl( f )` setting the controls each frame; returns the events
function fly( f, sec, ctl = () => {} ) {

	const ev = [];
	for ( let i = 0; i < sec * 60; i ++ ) {

		ctl( f );
		f.update( 1 / 60 );
		for ( const e of f.drainEvents() ) ev.push( { ...e, t: i / 60 } );

	}

	return ev;

}

// ---------------------------------------------------------------- flight model
{

	ok( waterResistance( 9 ) > waterResistance( 2 ) && waterResistance( 9 ) > waterResistance( 22 ) * 2, 'hull resistance peaks at the hump and drops on the step' );
	const w = SPEC.surfaces[ 0 ];
	ok( liftCoefficient( 12 / DEG, w ) > liftCoefficient( 6 / DEG, w ) && liftCoefficient( 24 / DEG, w ) < liftCoefficient( 14 / DEG, w ) * 0.85, 'wing lift rises with alpha and falls past the ~15 degree stall' );

	const f = new Flight();
	f.place( 0, 0, 0 );
	fly( f, 6, ( p ) => { p.controls.throttle = 0; } );
	ok( Math.abs( f.load - 1 ) < 0.05 && f.position.y > - 0.5 && f.position.y < 0 && Math.abs( f.pitchAngle() * DEG ) < 4, `floats at rest: water carries the weight (load ${ f.load.toFixed( 2 ) }), keel ${ ( - f.position.y ).toFixed( 2 ) } m deep, level` );

	// full power and back pressure from 12 m/s: off the water near 28 m/s
	const g = new Flight();
	g.place( 0, 0, 0 );
	const ev = fly( g, 40, ( p ) => { p.controls.throttle = 1; p.controls.pitch = p.forwardSpeed > 12 && ! p.airborne ? 0.6 : 0.1; } );
	const lift = ev.find( ( e ) => e.type === 'liftoff' );
	ok( lift && lift.speed > 23 && lift.speed < 34, `takes off at ${ lift ? lift.speed.toFixed( 1 ) : '-' } m/s with back pressure (~25-30)` );
	ok( g.airborne && g.agl > 30 && finite( g.position ), `climbs away (${ g.agl.toFixed( 0 ) } m)` );

	// stick neutral: the floats stay on the step much longer (needs a far higher speed)
	const h = new Flight();
	h.place( 0, 0, 0 );
	const ev2 = fly( h, 18, ( p ) => { p.controls.throttle = 1; p.controls.pitch = 0; } );
	ok( ! ev2.some( ( e ) => e.type === 'liftoff' ), 'without rotating it is still on the water after 18 s' );

	// taxiing: the water rudder turns the plane
	const r = new Flight();
	r.place( 0, 0, 0 );
	fly( r, 5, ( p ) => { p.controls.throttle = 0.35; p.controls.waterRudder = 1; } );
	const hd = r.heading() * DEG; // heading grows towards +x (port): a right turn makes it negative
	ok( hd < - 15, `water rudder (right) turns the bow to starboard (heading ${ hd.toFixed( 0 ) } deg after 5 s)` );

	// the stall: slow flight with the stick held back flags it
	const s = new Flight();
	s.place( 0, 0, 0 );
	s.position.y = 300;
	s.velocity.set( 0, 0, 22 );
	s.airborne = true;
	let maxStall = 0;
	fly( s, 10, ( p ) => { p.controls.throttle = 0; p.controls.pitch = 1; maxStall = Math.max( maxStall, p.stall ); } );
	ok( maxStall > 0.5, `idle with full back stick stalls the wing (stall ${ maxStall.toFixed( 2 ) })` );

}

// ---------------------------------------------------------------- pilot
{

	const f = new Flight();
	f.place( 0, 0, 0 );
	f.onWater = true;
	const p = new Pilot();
	for ( let i = 0; i < 30; i ++ ) p.read( { down: true, right: true, throttleUp: true }, null, f, 1 / 60 );
	ok( f.controls.pitch > 0.3 && p.throttle > 0.2 && p.throttle < 0.5, 'S pulls the nose up; Shift opens the throttle gradually' );
	ok( f.controls.waterRudder > 0.5 && Math.abs( f.controls.roll ) < 0.1, 'taxiing: D steers the water rudder, the ailerons stay out' );
	const thr0 = p.throttle;
	for ( let i = 0; i < 30; i ++ ) p.read( { throttleDown: true }, null, f, 1 / 60 );
	ok( p.throttle < thr0 - 0.25, `C (throttleDown) closes it again (${ thr0.toFixed( 2 ) } -> ${ p.throttle.toFixed( 2 ) })` );
	for ( let i = 0; i < 30; i ++ ) p.read( { throttleUp: true }, null, f, 1 / 60 );
	f.airborne = true;
	f.airspeed = 40;
	for ( let i = 0; i < 30; i ++ ) p.read( { right: true }, null, f, 1 / 60 );
	ok( f.controls.roll > 0.5, 'flying: D banks right' );
	const pad = p.read( {}, { pitch: - 0.8, roll: 0, yaw: 0, throttle: 0 }, f, 1 / 60 );
	ok( pad.pitch < - 0.5, 'an analogue stick drives the elevator' );

	// assist: a released stick levels a banked plane
	const a = new Flight();
	a.place( 0, 0, 0 );
	a.position.y = 400;
	a.velocity.set( 0, 0, 40 );
	a.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), 35 / DEG );
	a.airborne = true;
	const ap = new Pilot();
	ap.throttle = 0.7;
	const b0 = Math.abs( a.rollAngle() );
	fly( a, 8, ( q ) => { ap.read( {}, null, q, 1 / 60 ); } );
	ok( Math.abs( a.rollAngle() ) < b0 * 0.4 && a.agl > 250, `stick released: wings come level (${ ( b0 * DEG ).toFixed( 0 ) } -> ${ ( Math.abs( a.rollAngle() ) * DEG ).toFixed( 0 ) } deg), no spiral` );

}

// ---------------------------------------------------------------- touchdowns and strikes
{

	ok( judge( { type: 'touch', surface: 'water', sink: 1.5, speed: 26, pitch: 3, roll: 1 } ).kind === 'landed', 'sink 1.5 m/s on the water: a landing' );
	const b = judge( { type: 'touch', surface: 'water', sink: 4.2, speed: 26, pitch: 2, roll: 0 } );
	ok( b.kind === 'bounce' && b.damage > 0 && b.damage < MAX_HP, `sink 4.2 m/s: a hard bounce (${ b.damage } damage)` );
	ok( judge( { type: 'touch', surface: 'water', sink: 7, speed: 30, pitch: 0, roll: 0 } ).kind === 'crash', 'sink 7 m/s: a crash' );
	ok( judge( { type: 'touch', surface: 'water', sink: 2, speed: 28, pitch: 0, roll: 40 } ).kind === 'crash', 'a wing down on touchdown: a crash' );
	ok( judge( { type: 'touch', surface: 'water', sink: 4.5, speed: 26, pitch: 2, roll: 0 }, 10 ).kind === 'crash', 'a hard bounce with the plane already battered breaks it' );
	ok( judge( { type: 'strike', part: 'propeller', surface: 'ground', speed: 3 } ).kind === 'crash', 'propeller on the ground: a crash' );
	ok( judge( { type: 'strike', part: 'float', surface: 'ground', speed: 2 } ).kind === 'scrape' && judge( { type: 'strike', part: 'float', surface: 'ground', speed: 14 } ).kind === 'crash', 'beaching at a walk is fine, running aground at speed is not' );
	ok( judge( { type: 'strike', part: 'wingtip', surface: 'water', speed: 30 } ).kind === 'crash', 'a wingtip caught at speed: a crash' );

}

// ---------------------------------------------------------------- the site on the real heightmap
const terrain = new TerrainData();
{

	const B = SITE.berth;
	ok( terrain.heightAt( B.x, B.z ) < - 0.6 && terrain.heightAt( B.x - 3, B.z + 4 ) < - 0.5, `berth afloat (seabed ${ terrain.heightAt( B.x, B.z ).toFixed( 2 ) } m)` );
	let land = Infinity;
	for ( const dx of [ - 5, 0, 5 ] ) for ( const dz of [ - 4, 0, 4 ] ) land = Math.min( land, terrain.heightAt( SITE.hangar.x + dx, SITE.hangar.z + dz ) );
	ok( land > 0.3, `hangar on dry sand (lowest corner ${ land.toFixed( 2 ) } m)` );
	// the takeoff run: 400 m south of the berth is water deep enough, and clear of the reef by more than a half span
	let shallow = 0;
	for ( let z = B.z; z < B.z + 400; z += 5 ) if ( terrain.heightAt( B.x, z ) > - 0.6 ) shallow ++;
	ok( shallow === 0, 'the takeoff run south of the berth is open water' );
	const reef = WORLD.reef;
	ok( Math.abs( B.x - reef.center.x ) - reef.radius > GEOM.span / 2, 'the run passes the reef with the wingtip clear' );
	const far = ( x, z, d ) => Math.hypot( x - B.x, z - B.z ) > d && Math.hypot( x - SITE.hangar.x, z - SITE.hangar.z ) > d;
	ok( Math.abs( B.x - WORLD.pier.x ) > 20 && Math.abs( SITE.jetty.x - WORLD.pier.x ) > 20, 'clear of the pier' );
	ok( far( WORLD.boatDock.position.x, WORLD.boatDock.position.z, 30 ) && far( YARD.x, YARD.z, 40 ), 'clear of the boat berth and the yard' );
	ok( far( STALL_SITES.home.x, STALL_SITES.home.z, 25 ) && far( WORLD.spawn.position.x, WORLD.spawn.position.z, 12 ) && far( WORLD.start.position.x, WORLD.start.position.z, 25 ), 'clear of the stalls, the spawn and the start' );
	const { geometry, floorY } = buildSiteGeometry( terrain );
	const tris = triangleCount( geometry );
	ok( tris > 200 && tris < 12000 && floorY > land, `site mesh ${ tris } triangles, hangar floor at ${ floorY.toFixed( 2 ) } m` );
	const jp = jettyPoint( 10, - 30 );
	ok( Math.abs( jp.x - SITE.jetty.x ) <= SITE.jetty.w / 2 && jp.y === SITE.jetty.y, 'jettyPoint clamps onto the walkway' );
	ok( triangleCount( buildStandIn() ) < 600, 'the stand-in model is cheap' );

}

// ---------------------------------------------------------------- the GLB
{

	const url = new URL( '../public/models/seaplane/Seaplane.glb', import.meta.url );
	const buf = fs.readFileSync( url );
	ok( buf.readUInt32LE( 0 ) === 0x46546c67, 'Seaplane.glb is a binary glTF' );
	const len = buf.readUInt32LE( 12 );
	const json = JSON.parse( buf.subarray( 20, 20 + len ).toString( 'utf8' ) );
	let tris = 0;
	for ( const m of json.meshes ) for ( const p of m.primitives ) tris += json.accessors[ p.indices ].count / 3;
	const mats = json.materials.map( ( m ) => m.name );
	const prop = json.nodes.find( ( n ) => n.name === 'Propeller' );
	ok( tris > 1000 && tris < 15000, `under 15k triangles (${ tris })` );
	ok( [ 'SeaplaneJade', 'SeaplaneCream', 'SeaplaneGlass', 'SeaplaneProp' ].every( ( n ) => mats.includes( n ) ), 'jade, cream, glass and propeller materials' );
	ok( prop && prop.translation && Math.abs( prop.translation[ 1 ] - GEOM.prop[ 1 ] ) < 0.01 && Math.abs( prop.translation[ 2 ] - GEOM.prop[ 2 ] ) < 0.01, 'the propeller is its own node at the hub' );
	let lo = Infinity, hi = - Infinity;
	for ( const a of json.accessors ) if ( a.type === 'VEC3' && a.min && a.max && a.min.length === 3 ) { lo = Math.min( lo, a.min[ 0 ] ); hi = Math.max( hi, a.max[ 0 ] ); }
	ok( Math.abs( hi - GEOM.span / 2 ) < 0.2, `wingspan matches the flight model (${ ( hi - lo ).toFixed( 1 ) } m)` );

}

// ---------------------------------------------------------------- the feature with the real Player
let time = 0;
const swell = ( x, z, t ) => 0.08 * Math.sin( 0.15 * x + 0.8 * t ) + 0.05 * Math.sin( 0.1 * z - 0.6 * t );
function makeQuery() {

	return {
		n: 1, cpu: new Float32Array( 128 * 4 ), points: new Float32Array( 128 * 4 ), resultInputs: new Float32Array( 128 * 4 ), cpuValid: false, version: 0, latency: 2 / 60,
		allocate( name, n ) { const s = this.n; this.n += n; return s; },
		setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
		tick() {

			for ( let i = 0; i < this.n; i ++ ) this.cpu[ i * 4 ] = swell( this.points[ i * 4 ], this.points[ i * 4 + 1 ], time );
			this.cpuValid = true;
			this.version ++;

		},
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

function makeWorld( { mode = null, money = 0 } = {} ) {

	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.money = money;
	const query = makeQuery();
	const colliders = new Colliders();
	const input = new InputStub();
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	const player = new Player( { camera, input, terrain, colliders, query, boat: null } );
	const toasts = [];
	const app = { terrainData: terrain, colliders, query, input, camera, player, mode: mode || 'campaign', game: { state, toast: ( t ) => toasts.push( t ) } };
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'planeTookOff', 'planeLanded', 'planeCrashed' ] ) features.on( n, ( e ) => events.push( { n, ...e } ) );
	const sp = install( app, features );
	features.list.set( 'seaplane', { module: seaplane, instance: sp } );
	const frame = ( dt = 1 / 60 ) => {

		time += dt;
		query.tick();
		player.update( dt );
		features.update( dt );
		input.endFrame();

	};

	return { state, app, features, sp, player, input, camera, colliders, query, toasts, events, frame };

}

{

	const W = makeWorld( { money: 0 } );
	const { sp, player, input, state, features, events, frame } = W;
	ok( ! sp.owned && sp.hp === MAX_HP && sp.slot > 0, 'starts unowned, at full condition, with its water probes' );
	ok( W.colliders.groundHeightAt( SITE.jetty.x, - 25, 5 ) === SITE.jetty.y, 'the jetty is walkable' );
	ok( features.claimKey( 'ShiftLeft', 'other' ) === false && sp.keys.Comma && sp.keys.Period, 'throttle and rudder keys claimed' );
	ok( ! sp.board() && player.mode === 'walk', 'an unowned plane cannot be boarded (the hangar window opens instead)' );
	ok( ! sp.buy().ok && ! sp.owned, 'cannot buy it broke' );
	state.money = PRICE + 2000;
	ok( sp.buy().ok && sp.owned && state.money === 2000, `buys it for $${ PRICE.toLocaleString( 'en-US' ) }` );

	// settle at the berth, then walk onto the jetty beside the door and press E
	for ( let i = 0; i < 120; i ++ ) frame();
	const fp = sp.flight.position;
	ok( Math.hypot( fp.x - SITE.berth.x, fp.z - SITE.berth.z ) < 1.5, 'moored at the berth while unattended' );
	const door = sp.flight.toWorldXYZ( ...GEOM.door, new E.Vector3() );
	const jp = jettyPoint( door.x, door.z );
	player.position.set( jp.x, jp.y, jp.z );
	const it = features.nearestInteractable( player.position );
	ok( it && /Fly/.test( it.prompt() ), 'the door offers to fly' );
	it.onInteract();
	ok( player.mode === 'plane' && sp.piloted && player.vehicle === sp.vehicle, 'boarded: the player pilots the plane' );
	const pose = player.pose( {} );
	ok( pose.mode === 'seat' && pose.frame === sp.flight.quaternion && finite( pose.position ), 'seated pose in the plane frame' );

	// full throttle, pull back past 20 m/s
	input.keys.add( 'ShiftLeft' );
	let took = null;
	for ( let i = 0; i < 60 * 45 && ! took; i ++ ) {

		if ( sp.flight.forwardSpeed > 20 ) input.keys.add( 'KeyS' );
		frame();
		took = events.find( ( e ) => e.n === 'planeTookOff' );

	}

	ok( took && sp.flight.airborne, `took off (${ sp.flight.forwardSpeed.toFixed( 1 ) } m/s) and emitted planeTookOff` );
	for ( let i = 0; i < 180; i ++ ) frame();
	input.keys.delete( 'KeyS' );
	ok( sp.flight.agl > 10 && finite( W.camera.position ) && W.camera.position.y > 0.5, `climbing (${ sp.flight.agl.toFixed( 0 ) } m), chase camera above the water` );
	// wave 5: the throttle comes down on C (the dive key), never on Ctrl (Ctrl+W, W pitching, closed the browser tab)
	input.keys.add( 'ControlLeft' );
	ok( ! sp._keysNow().throttleDown, 'Ctrl does nothing in the seaplane any more' );
	input.keys.delete( 'ControlLeft' );
	input.keys.add( 'KeyC' );
	const kn = sp._keysNow();
	ok( THROTTLE_DOWN === 'KeyC' && kn.throttleDown && kn.throttleUp, 'C closes the throttle, Shift opens it' );
	input.keys.delete( 'KeyC' );
	ok( ! PLANE_KEYS.some( ( k ) => /^Control/.test( k ) ), `no Ctrl among the plane's keys (${ PLANE_KEYS.join( ', ' ) })` );
	const planeSrc = [ 'Seaplane.js', 'Pilot.js' ].map( ( f ) => fs.readFileSync( new URL( `../src/features/seaplane/${ f }`, import.meta.url ), 'utf8' ).replace( /\/\/.*$/gm, '' ) ).join( '\n' );
	ok( ! /Control(Left|Right)|ctrlKey/.test( planeSrc ), 'the seaplane code never reads Ctrl' );
	const st = sp.decorateState( {} );
	ok( st.plane && st.plane.p.length === 3 && st.plane.q.length === 4 && st.plane.p.every( Number.isFinite ), 'multiplayer state carries the plane' );
	input.pressed.add( 'KeyE' );
	frame();
	ok( player.mode === 'plane' && W.toasts.some( ( t ) => /Slow down/.test( t ) ), 'no climbing out in the air' );

	// first person: the eye is in the cockpit
	player.setView( 'first' );
	frame();
	const eye = sp.flight.toWorldXYZ( ...GEOM.eye, new E.Vector3() );
	ok( W.camera.position.distanceTo( eye ) < 0.01, 'first person: the camera sits at the pilot eye' );
	player.setView( 'third' );

	// nose down at full power into the sea: a crash, towed home, the player on the jetty, repair due
	input.keys.add( 'KeyW' );
	let crash = null;
	for ( let i = 0; i < 60 * 30 && ! crash; i ++ ) {

		frame();
		crash = events.find( ( e ) => e.n === 'planeCrashed' );

	}

	input.keys.clear();
	ok( !! crash, `nose-in: crashed (${ crash ? `${ crash.cause }: ${ crash.severity } at ${ crash.speed.toFixed( 1 ) } m/s` : '-' })` );
	// wave 10: a direct hit (over CRASH.fatal) is fatal (no death feature here: set down on the jetty); a wreck throws the
	// pilot clear beside the pieces; either way the plane stays out there, wrecked, until Captain Roid's crew recovers it
	if ( crash && crash.severity === 'death' ) ok( ! sp.piloted && player.mode === 'walk' && Math.abs( player.position.y - SITE.jetty.y ) < 0.01, 'the pilot is set down on the jetty' );
	else ok( ! sp.piloted && [ 'swim', 'walk' ].includes( player.mode ) && sp.thrown && Math.hypot( player.position.x - crash.x, player.position.z - crash.z ) < 25, `the pilot is thrown clear beside the wreck (${ player.mode })` );
	ok( sp.lost && ! sp.home && sp.hp === 0 && crash && crash.cost === MAX_HP * REPAIR_PER_HP && crash.recovery === CRASH.recovery, `the wreck stays out there: recovery $${ crash ? crash.recovery : '-' } + repair $${ crash ? crash.cost : '-' }` );
	ok( sp.marker() === null && ! sp.board() && player.mode !== 'plane', 'a wrecked plane cannot fly (and has no plane pin)' );
	state.money = 100;
	ok( ! sp.recall().ok && sp.lost, 'the recovery needs the fee' );
	state.money = 5000 + CRASH.recovery;
	ok( sp.recall().ok && ! sp.lost && sp.home && sp.hp === 0 && state.money === 5000 && ! sp.wreck, 'Captain Roid\'s crew tows the wreck to the ramp' );
	state.money = 1000;
	ok( ! sp.repair().ok, 'repair needs the money' );
	state.money = 5000;
	ok( sp.repair().ok && sp.hp === MAX_HP && state.money === 5000 - MAX_HP * REPAIR_PER_HP, 'repaired at the hangar' );

	// a gentle approach set up by hand: 2 m over the water at 27 m/s sinking 1.2 m/s, power off
	ok( sp.board(), 'boards again' );
	const f = sp.flight;
	f.position.set( 0, 2.2, 160 );
	f.quaternion.setFromAxisAngle( new E.Vector3( 0, 1, 0 ), 0 ).multiply( new E.Quaternion().setFromAxisAngle( new E.Vector3( 1, 0, 0 ), - 4 / DEG ) );
	f.velocity.set( 0, - 1.2, 27 );
	f.angular.set( 0, 0, 0 );
	f.airborne = true;
	f._wasAir = true;
	f.airTime = 2;
	sp.pilot.throttle = 0;
	let landed = null;
	for ( let i = 0; i < 60 * 8 && ! landed; i ++ ) {

		frame();
		landed = events.find( ( e ) => e.n === 'planeLanded' );

	}

	ok( landed && landed.onWater && landed.sink < 3 && sp.hp === MAX_HP && sp.piloted, `a gentle landing on the water (sink ${ landed ? landed.sink.toFixed( 2 ) : '-' } m/s), planeLanded` );
	for ( let i = 0; i < 60 * 40 && f.airspeed > 2.5; i ++ ) frame();
	ok( f.airspeed < 3 && sp.canExit(), `slowed to ${ f.airspeed.toFixed( 1 ) } m/s on the water` );
	input.pressed.add( 'KeyE' );
	frame();
	ok( player.mode === 'swim' && ! sp.piloted && player.vehicle === null, 'climbed out into the water (far from the jetty)' );
	for ( let i = 0; i < 60; i ++ ) frame();
	input.pressed.add( 'KeyE' );
	frame();
	ok( player.mode === 'plane' && sp.piloted, 'a swimmer beside the door climbs back in with E' );
	input.pressed.add( 'KeyE' );
	frame();
	ok( player.mode === 'swim', 'and out again' );
	ok( sp.recall().ok && sp.home, 'towed back to the ramp from the hangar' );

	// save round trip
	const saved = JSON.parse( JSON.stringify( sp.toJSON() ) );
	const W2 = makeWorld();
	W2.sp.fromJSON( saved );
	ok( W2.sp.owned && W2.sp.hp === MAX_HP && W2.sp.stats.crashes === saved.stats.crashes && saved.stats.crashes >= 1 && W2.sp.stats.flights >= 1, 'ownership, condition and stats survive a save' );
	W2.sp.reset();
	ok( ! W2.sp.owned && W2.sp.stats.flights === 0, 'a new game starts without the plane' );

}

// ---------------------------------------------------------------- sandbox: free, crashes cost nothing
{

	const W = makeWorld( { mode: 'sandbox', money: 0 } );
	ok( W.sp.free && W.sp.buy().ok && W.sp.owned, 'sandbox: the plane is free' );
	W.sp.board();
	W.sp._crash( 'test' );
	ok( W.sp.hp === MAX_HP && W.sp.repairCost() === 0 && W.player.mode === 'walk', 'sandbox: a crash costs nothing' );

}

// ---------------------------------------------------------------- remote planes
{

	const r = new RemotePlanes( { models: null, localId: 'me' } );
	r.ingest( [ { id: 'a', plane: { p: [ 0, 10, 0 ], q: [ 0, 0, 0, 1 ], thr: 0.4 } }, { id: 'me', plane: { p: [ 1, 1, 1 ], q: [ 0, 0, 0, 1 ] } }, { id: 'b' }, { id: 'c', plane: { p: [ NaN, 0, 0 ], q: [ 0, 0, 0, 1 ] } } ], 1000 );
	r.ingest( [ { id: 'a', plane: { p: [ 10, 12, 0 ], q: [ 0, 0, 0, 1 ], thr: 0.8 } } ], 1100 );
	ok( r.count === 1, 'remote planes: only valid states of other players are kept' );
	const s = r.sample( 'a', 1050 + INTERP );
	ok( s && Math.abs( s.position.x - 5 ) < 1e-6 && Math.abs( s.position.y - 11 ) < 1e-6 && Math.abs( s.thr - 0.6 ) < 1e-6, 'interpolated INTERP ms behind the newest sample' );
	r.update( 1 / 60, 9000 );
	ok( r.count === 0, 'a plane not heard of for 3 s is dropped' );
	const map = new Map( [ [ 'x', { plane: { p: [ 1, 2, 3 ], q: [ 0, 0, 0, 1 ], thr: 0 } } ] ] );
	r.ingest( map, 10000 );
	ok( r.count === 1, 'also takes a Map of peer states' );

}

// ---------------------------------------------------------------- wave 8: the cockpit's flight systems
{

	// flaps: same state, more lift and drag with the flaps down; the motor takes its time
	const level = ( flaps ) => {

		const f = new Flight();
		f.place( 0, 0, 0 );
		f.position.y = 300;
		f.velocity.set( 0, 0, 30 );
		f.airborne = true;
		f.flaps = flaps;
		f.flapPos = flaps;
		f.update( 1 / 60 );
		return f;

	};

	const f0 = level( 0 ), f2 = level( 2 );
	ok( f2.surfaces[ 0 ].cl > f0.surfaces[ 0 ].cl + 0.4, `flaps 2 add wing lift (CL ${ f0.surfaces[ 0 ].cl.toFixed( 2 ) } -> ${ f2.surfaces[ 0 ].cl.toFixed( 2 ) })` );
	ok( f2.velocity.z < f0.velocity.z - 0.005, 'and drag (it slows faster)' );
	ok( f2.stallMargin < f0.stallMargin, 'and the wing stalls at a lower angle' );
	const takeoff = ( flaps ) => {

		const g = new Flight();
		g.place( 0, 0, 0 );
		g.flaps = flaps;
		g.flapPos = flaps;
		const ev = fly( g, 40, ( p ) => { p.controls.throttle = 1; p.controls.pitch = p.forwardSpeed > 12 && ! p.airborne ? 0.6 : 0.1; } );
		const l = ev.find( ( e ) => e.type === 'liftoff' );
		return l ? { speed: l.speed, t: l.t } : { speed: Infinity, t: Infinity };

	};

	const t0 = takeoff( 0 ), t1 = takeoff( 1 );
	ok( t1.speed < t0.speed - 1.5 && t1.t < t0.t, `flaps 1: off the water sooner (${ t0.speed.toFixed( 1 ) } m/s at ${ t0.t.toFixed( 1 ) } s -> ${ t1.speed.toFixed( 1 ) } m/s at ${ t1.t.toFixed( 1 ) } s)` );
	const m = new Flight();
	m.place( 0, 0, 0 );
	m.flaps = 2;
	fly( m, 1 );
	const after1 = m.flapPos;
	fly( m, 4 );
	ok( after1 > 0.3 && after1 < 1 && m.flapPos === 2, `the flap motor runs them down over a few seconds (${ after1.toFixed( 2 ) } after 1 s)` );

	// fuel: ~25 min at full power, the burn follows the rpm, empty stops the engine
	const b = new Flight();
	b.place( 0, 0, 0 );
	b.engineOn = true;
	b.rpm = 1;
	for ( let i = 0; i < 60 * 30; i ++ ) {

		b.controls.throttle = 1;
		for ( let k = 0; k < 10; k ++ ) b.fuel > 0 && b.update( 0.1 ); // (update clamps a frame to 0.1 s)
		b.position.set( 0, 500, 0 );
		b.velocity.set( 0, 0, 40 );
		b.quaternion.identity();
		b.angular.set( 0, 0, 0 );
		b.drainEvents();
		if ( i === 299 ) ok( Math.abs( b.fuel - 0.8 ) < 0.02, `five minutes at full power burn a fifth of the tank (${ ( b.fuel * 100 ).toFixed( 0 ) }% left)` );

	}

	ok( b.fuel === 0 && ! b.engineOn, 'an empty tank stops the engine' );
	const idle = new Flight();
	idle.place( 0, 0, 0 );
	idle.engineOn = true;
	fly( idle, 60, ( p ) => { p.controls.throttle = 0; } );
	ok( 1 - idle.fuel < ( 1 / 25 ) * 0.3, `idling burns far less (${ ( ( 1 - idle.fuel ) * 100 ).toFixed( 2 ) }% a minute)` );
	const ev = [];
	const e = new Flight();
	e.place( 0, 0, 0 );
	e.engineOn = true;
	e.fuel = 0.00001;
	ev.push( ...fly( e, 1, ( p ) => { p.controls.throttle = 1; } ) );
	ok( ev.some( ( x ) => x.type === 'fuelOut' ), 'running dry raises a fuelOut event' );

	// engine off: the lever does nothing
	const off = new Flight();
	off.place( 0, 0, 0 );
	off.engineOn = false;
	fly( off, 6, ( p ) => { p.controls.throttle = 1; } );
	ok( off.thrust < 1 && off.airspeed < 0.5, `engine off: no thrust at full throttle (${ off.thrust.toFixed( 1 ) } N, ${ off.airspeed.toFixed( 2 ) } m/s)` );
	const cut = new Flight();
	cut.place( 0, 0, 0 );
	cut.engineOn = true;
	fly( cut, 4, ( p ) => { p.controls.throttle = 1; } );
	const thr = cut.thrust;
	cut.engineOn = false;
	fly( cut, 5, ( p ) => { p.controls.throttle = 1; } );
	ok( thr > 3000 && cut.thrust < thr * 0.02, `cutting the engine winds the thrust down (${ thr.toFixed( 0 ) } -> ${ cut.thrust.toFixed( 0 ) } N)` );

	// trim: a neutral stick with nose-up trim still raises the elevator
	const tr = new Flight();
	tr.place( 0, 0, 0 );
	tr.controls.trim = 1;
	fly( tr, 1 );
	ok( tr.deflect.elevator > 0.2, `nose-up trim deflects the elevator with the stick neutral (${ tr.deflect.elevator.toFixed( 2 ) })` );
	const tp = new Pilot();
	const tf = new Flight();
	tf.place( 0, 0, 0 );
	for ( let i = 0; i < 60; i ++ ) tp.read( { trimUp: true }, null, tf, 1 / 60 );
	ok( tp.trim > 0.3 && tf.controls.trim === tp.trim, `= trims the nose up (${ tp.trim.toFixed( 2 ) })` );

	// the autopilot: from a 35 degree bank and a sink, wings level and the altitude held
	for ( const [ bank, vy ] of [ [ 35, 0 ], [ - 25, - 3 ] ] ) {

		const a = new Flight();
		a.place( 0, 0, 0 );
		a.position.y = 400;
		a.velocity.set( 0, vy, 40 );
		a.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), bank / DEG );
		a.airborne = true;
		const ap = new Pilot();
		ap.throttle = 0.6;
		ok( ap.engageAutopilot( a ) && ap.ap.on, 'autopilot engages in the air' );
		const alt0 = a.position.y;
		let dev = 0;
		fly( a, 30, ( q ) => { ap.read( {}, null, q, 1 / 60 ); dev = Math.max( dev, Math.abs( q.position.y - alt0 ) ); } );
		ok( Math.abs( a.rollAngle() * DEG ) < 3 && Math.abs( a.position.y - alt0 ) < 5 && dev < 20 && ap.ap.on, `autopilot from ${ bank } deg bank: wings level (${ ( a.rollAngle() * DEG ).toFixed( 1 ) } deg), altitude held (${ ( a.position.y - alt0 ).toFixed( 1 ) } m, worst ${ dev.toFixed( 1 ) } m)` );
		for ( let i = 0; i < 30; i ++ ) ap.read( { right: true }, null, a, 1 / 60 );
		ok( ! ap.ap.on && ap.ap.dropped === 'stick', 'a firm stick takes it back' );

	}

	const gp = new Pilot();
	const gf = new Flight();
	gf.place( 0, 0, 0 );
	ok( ! gp.engageAutopilot( gf ), 'no autopilot on the water' );

	// the switches: the master feeds the starter and the lights; the starter cranks, then the engine runs
	const sf = new Flight();
	sf.place( 0, 0, 0 );
	sf.engineOn = false;
	const sp = new Pilot();
	const sys = new Systems( sf, sp );
	ok( sys.master && ! sys.nav && sys.lights.every( ( l ) => l.id === 'cabin' ? l.enabled : ! l.enabled ), 'master on, nav and landing lights off (the cabin lamp on)' );
	sys.toggle( 'master' );
	ok( ! sys.start().ok && sys.start().why === 'master' && sys.lights.every( ( l ) => ! l.enabled ), 'master off: no start, every light dark' );
	sys.toggle( 'master' );
	ok( sys.start().ok && sys.cranking, 'the starter cranks' );
	let started = false, crankRpm = 0;
	for ( let i = 0; i < 60 * 3; i ++ ) {

		for ( const x of sys.update( 1 / 60, { hp: 100 } ) ) if ( x === 'started' ) started = i / 60;
		sf.update( 1 / 60 );
		if ( sys.cranking ) crankRpm = Math.max( crankRpm, sf.rpm );

	}

	ok( started && Math.abs( started - START_TIME ) < 0.1 && sf.engineOn && crankRpm > 0.02 && crankRpm < 0.08, `it catches after ${ started ? started.toFixed( 2 ) : '-' } s (the prop turns over at ${ ( crankRpm * 100 ).toFixed( 0 ) }% on the starter)` );
	sys.toggle( 'nav' );
	sys.toggle( 'landing' );
	ok( sys.light( 'navL' ).enabled && sys.light( 'navR' ).enabled && sys.light( 'landing' ).enabled, 'nav and landing lights switch on' );
	const lw = sys.light( 'landing' );
	lw.update();
	ok( lw.dir.z > 0.9 && lw.cosOuter < lw.cosInner && sys.light( 'navL' ).position.x > 6, 'the landing light is a spot ahead, the red nav light on the port tip' );
	sp.engageAutopilot( Object.assign( sf, { airborne: true } ) );
	sys.toggle( 'master' );
	ok( ! sp.ap.on && sf.engineOn, 'master off drops the autopilot (the magnetos keep the engine running)' );
	sys.toggle( 'master' );
	sf.airborne = false;
	ok( sys.stop().ok && ! sf.engineOn, 'stop cuts the engine' );
	sf.fuel = 0;
	ok( sys.start().why === 'fuel', 'no start on an empty tank' );
	sys.update( 0.1, { hp: 70 } );
	ok( sys.masterWarn, 'new damage lights the master warning' );
	sys.ack();
	ok( ! sys.masterWarn, 'a click silences it' );
	sys.update( 0.1, { hp: 40 } );
	sys.ack();
	ok( sys.masterWarn, 'it stays lit while the hull is badly hurt' );
	ok( refuelCost( 0.5 ) === FUEL.litres * FUEL.price / 2 && refuelCost( 0.5, true ) === 0, `refuelling half a tank costs $${ refuelCost( 0.5 ) } (free in the sandbox)` );

	// the stall warning: slow, nose high
	const st = new Flight();
	st.place( 0, 0, 0 );
	st.position.y = 300;
	st.velocity.set( 0, 0, 22 );
	st.airborne = true;
	const ss = new Systems( st, null );
	let warned = false;
	fly( st, 6, ( p ) => { p.controls.throttle = 0; p.controls.pitch = 1; warned = warned || ss.stallWarn; } );
	ok( warned, 'the stall warning sounds on the way into a stall' );
	const cruise = level( 0 );
	ok( ! new Systems( cruise, null ).stallWarn, 'and not in cruise' );

}

// ---------------------------------------------------------------- wave 8: the panel (layout, rays from the eye, drawing)
{

	const eye = new E.Vector3( ...GEOM.eye );
	const centre = ( c ) => {

		const u = ( c.x + c.w / 2 ) / TEX.w - 0.5, v = 0.5 - ( c.y + c.h / 2 ) / TEX.h;
		return FACE.C.clone().addScaledVector( FACE.R, u * FACE.w ).addScaledVector( FACE.U, v * FACE.h );

	};

	let reach = 0;
	for ( const c of CONTROLS ) {

		const d = centre( c ).sub( eye ).normalize();
		const hit = rayPanel( eye, d );
		if ( hit && hitControl( hit.px, hit.py ) === c ) reach ++;

	}

	ok( reach === CONTROLS.length, `every control and gauge is hit by a ray from the eye to its centre (${ reach } / ${ CONTROLS.length })` );
	ok( ! rayPanel( eye, new E.Vector3( 0, 0.05, 1 ).normalize() ), 'looking ahead out of the windscreen misses the panel' );
	ok( CONTROLS.every( ( c ) => c.x >= 0 && c.y >= 0 && c.x + c.w <= TEX.w && c.y + c.h <= TEX.h ), 'the controls lie on the face' );
	for ( let i = 0; i < CONTROLS.length; i ++ ) for ( let j = i + 1; j < CONTROLS.length; j ++ ) {

		const a = CONTROLS[ i ], b = CONTROLS[ j ];
		if ( a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h ) ok( false, `controls ${ a.id } and ${ b.id } overlap` );

	}

	// the six-pack sits in front of the pilot's seat (x +0.32): its centre column within 10 cm of his line of sight
	const hdg = centre( CONTROLS.find( ( c ) => c.id === 'att' ) );
	ok( Math.abs( hdg.x - GEOM.eye[ 0 ] ) < 0.1, `the attitude indicator is straight ahead of the pilot (x ${ hdg.x.toFixed( 2 ) })` );
	// the eye clears the glare shield: the line to the water 12 deg down passes over the panel's top edge
	const top = FACE.C.clone().addScaledVector( FACE.U, FACE.h / 2 );
	const down = Math.atan2( eye.y - top.y, top.z - eye.z ) * DEG;
	ok( down > 8 && down < 16, `over the panel the pilot sees the water from ${ down.toFixed( 1 ) } deg below the horizon` );

	// drawing on a stand-in 2D context: every call is a known canvas method, nothing throws, the hover outline is drawn
	const calls = new Map();
	const ctx = new Proxy( {}, {
		get: ( o, k ) => ( k in o ? o[ k ] : ( ...a ) => { calls.set( k, ( calls.get( k ) || 0 ) + 1 ); return k === 'getImageData' ? { data: new Uint8ClampedArray( 4 ) } : undefined; } ),
		set: ( o, k, v ) => { o[ k ] = v; return true; },
	} );
	const W = makeWorld( { mode: 'sandbox' } );
	W.sp.buy();
	W.sp.board();
	const snap = panelSnapshot( W.sp, 'master' );
	ok( Object.values( snap ).every( ( v ) => v === null || typeof v === 'boolean' || typeof v === 'string' || Number.isFinite( v ) ), 'the panel snapshot is plain finite numbers' );
	let threw = null;
	try { drawPanel( ctx, snap ); drawPanel( ctx, { ...snap, bank: 70, pitch: - 50, airspeed: 999, alt: 12345, vs: - 40, heading: 359.7, fuel: 0, hp: 5, flapPos: 2, trim: - 1, master: false, hover: null } ); } catch ( err ) { threw = err; }
	const known = [ 'fillRect', 'fillText', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'closePath', 'save', 'restore', 'translate', 'rotate', 'clip', 'arcTo' ];
	ok( ! threw && calls.get( 'fillText' ) > 80 && [ ...calls.keys() ].every( ( k ) => known.includes( k ) ), `the face draws (${ [ ...calls.values() ].reduce( ( a, b ) => a + b, 0 ) } canvas calls${ threw ? ', threw ' + threw.message : '' })` );
	ok( W.sp.cockpit.redraws >= 0 && W.sp.lights.length === 4 && W.sp.wantsMouse(), 'the feature has its cockpit, four local lights and keeps the mouse while flying' );

}

// ---------------------------------------------------------------- wave 8: flying it with the real Player
{

	const W = makeWorld( { money: 50000 } );
	const { sp, player, input, state, frame } = W;
	sp.buy();
	ok( sp.board() && ! sp.flight.engineOn, 'boarding: the engine is cold' );
	ok( Object.keys( COCKPIT_KEYS ).every( ( k ) => sp.keys[ k ] ), `the cockpit keys are claimed (${ Object.keys( COCKPIT_KEYS ).join( ' ' ) })` );
	input.pressed.add( 'KeyO' );
	frame();
	ok( sp.systems.cranking && sp.audio.state.clicks > 0, 'O cranks the starter (with a click)' );
	for ( let i = 0; i < 150; i ++ ) frame();
	ok( sp.flight.engineOn && sp.flight.rpm > 0.05, 'and the engine runs' );
	input.pressed.add( 'BracketRight' );
	frame();
	ok( sp.flight.flaps === 1, '] lowers the flaps a notch' );
	input.pressed.add( 'KeyN' );
	frame();
	ok( sp.systems.nav && sp.lights.find( ( l ) => l.id === 'navL' ).enabled, 'N: nav lights on' );
	input.pressed.add( 'KeyO' );
	frame();
	ok( ! sp.flight.engineOn, 'O again stops it' );

	// a click on the panel: the eye turned to the master switch, the left button pressed
	player.setView( 'first' );
	frame();
	const c = CONTROLS.find( ( k ) => k.id === 'master' );
	const u = ( c.x + c.w / 2 ) / TEX.w - 0.5, v = 0.5 - ( c.y + c.h / 2 ) / TEX.h;
	const local = FACE.C.clone().addScaledVector( FACE.R, u * FACE.w ).addScaledVector( FACE.U, v * FACE.h );
	const world = sp.flight.toWorld( local, new E.Vector3() );
	W.camera.position.copy( sp.flight.toWorld( new E.Vector3( ...GEOM.eye ), new E.Vector3() ) );
	W.camera.lookAt( world );
	input.locked = true;
	input.mouseDown = false;
	sp.cockpit.update( 1 / 60 );
	ok( sp.cockpit.hover === 'master', `looking at the master switch hovers it (${ sp.cockpit.hover })` );
	input.mouseDown = true;
	sp.cockpit.update( 1 / 60 );
	ok( ! sp.systems.master, 'a click flips it off' );
	input.mouseDown = false;
	sp.cockpit.update( 1 / 60 );
	input.mouseDown = true;
	sp.cockpit.update( 1 / 60 );
	input.mouseDown = false;
	ok( sp.systems.master, 'and on again' );
	player.setView( 'third' );

	// shift with the engine off cranks it (the touch lever), then the takeoff with flaps 1 and the autopilot
	input.keys.add( 'ShiftLeft' );
	let took = false;
	for ( let i = 0; i < 60 * 45 && ! took; i ++ ) {

		if ( sp.flight.forwardSpeed > 18 ) input.keys.add( 'KeyS' );
		frame();
		took = sp.flight.airborne;

	}

	ok( took && sp.flight.engineOn, 'Shift on a stopped engine starts it; flaps 1 and off the water' );
	for ( let i = 0; i < 240; i ++ ) frame();
	input.keys.delete( 'KeyS' );
	for ( let i = 0; i < 60; i ++ ) frame();
	input.pressed.add( 'KeyY' );
	frame();
	ok( sp.pilot.ap.on && sp.systems.apOn, 'Y engages the autopilot in the air' );
	const alt0 = sp.flight.position.y;
	for ( let i = 0; i < 60 * 20; i ++ ) frame();
	ok( Math.abs( sp.flight.position.y - alt0 ) < 15 && Math.abs( sp.flight.rollAngle() * DEG ) < 5, `it holds ${ ( alt0 - sp.flight.seaLevel() ).toFixed( 0 ) } m (${ ( sp.flight.position.y - alt0 ).toFixed( 1 ) } m off) with the wings level` );
	const burnt = 1 - sp.flight.fuel;
	ok( burnt > 0.005 && burnt < 0.05, `the flight burnt ${ ( burnt * 100 ).toFixed( 1 ) }% of the tank` );
	const saved = JSON.parse( JSON.stringify( sp.toJSON() ) );
	ok( Math.abs( saved.fuel - sp.flight.fuel ) < 0.001 && saved.switches && saved.switches.nav === true, 'fuel and switches go into the save' );
	input.keys.clear();

	// back home: refuel at the hangar
	sp.reset();
	sp.buy();
	sp.flight.fuel = 0.5;
	const m0 = state.money;
	const r = sp.refuel();
	ok( r.ok && sp.flight.fuel === 1 && state.money === m0 - FUEL.litres * FUEL.price / 2, `refuelled at the ramp for $${ m0 - state.money }` );
	ok( ! sp.refuel().ok, 'a full tank needs nothing' );
	sp.flight.position.x += 500;
	sp.flight.fuel = 0.4;
	ok( ! sp.refuel().ok && sp.view().canRefuel === false, 'away from the ramp there is no fuel' );
	const W2 = makeWorld();
	W2.sp.fromJSON( { owned: true, hp: 80, fuel: 0.3, switches: { master: false, nav: true, landing: false } } );
	ok( W2.sp.flight.fuel === 0.3 && ! W2.sp.systems.master && W2.sp.systems.nav, 'fuel and switches come back from a save' );
	W2.sp.fromJSON( { owned: true, hp: 80 } );
	ok( W2.sp.flight.fuel === 1, 'an older save has a full tank' );

	// the cockpit switch panel's actions (touch) run without a DOM
	const W3 = makeWorld( { mode: 'sandbox' } );
	W3.sp.buy();
	W3.sp.board();
	ok( W3.sp.act( 'engine', 'panel' ) && W3.sp.systems.cranking, 'the switch panel starts the engine' );
	ok( W3.sp.act( 'flapsDown', 'panel' ) && W3.sp.act( 'flapsDown', 'panel' ) && ! W3.sp.act( 'flapsDown', 'panel' ) && W3.sp.flight.flaps === 2, 'two flap notches, no third' );
	ok( W3.sp.act( 'trimUp', 'panel' ) && Math.abs( W3.sp.pilot.trim - 0.1 ) < 1e-9, 'trim steps a tenth' );
	ok( ! W3.sp.act( 'ap', 'panel' ) && ! W3.sp.pilot.ap.on, 'no autopilot on the water' );
	ok( ! W3.sp.act( 'map', 'panel' ), 'no world map feature here: the radio does nothing' );
	for ( let i = 0; i < 30; i ++ ) W3.frame();
	W3.sp.act( 'exit', 'panel' );
	ok( ! W3.sp.piloted, 'climb out from the panel (at rest at the ramp)' );

}

// ---------------------------------------------------------------- wave 10: crashes you can see, and walk away from
{

	// the table (Crash.js CRASH): pinned
	ok( CRASH.roughSink === 3 && CRASH.wreckSink === 6 && CRASH.tipWreck === 12 && CRASH.noseWreck === 8 && CRASH.direct === 25 && CRASH.fatal === 40, 'the CRASH thresholds: sink 3 / 6, wingtip 12, nose 8, direct 25, fatal 40 m/s' );
	const sev = ( e ) => assess( e, MAX_HP ).severity;
	const touch = ( sink, o = {} ) => ( { type: 'touch', surface: 'water', sink, speed: 26, pitch: 2, roll: 0, ...o } );
	const strike = ( part, surface, speed, o = {} ) => ( { type: 'strike', part, surface, speed, nose: 0.95, side: 0, ...o } );
	ok( sev( touch( 2 ) ) === 'none' && sev( touch( 4.2 ) ) === 'rough' && sev( touch( 6.5 ) ) === 'wreck', 'a float arrival: landing under 3 m/s, rough 3-6, a wreck above' );
	const rl = assess( touch( 4.5, { roll: 6 } ) );
	ok( rl.damage > 10 && rl.damage < 70 && rl.sprung === 'R', `a rough landing: hull damage (${ rl.damage }%) and the low (starboard) float sprung` );
	ok( sev( touch( 2, { roll: 40 } ) ) === 'wreck' && sev( touch( 2, { pitch: - 12 } ) ) === 'wreck', 'a wing down or the nose dug in on touchdown: a wreck' );
	ok( sev( strike( 'wingtip', 'water', 9 ) ) === 'rough' && sev( strike( 'wingtip', 'water', 13 ) ) === 'wreck' && sev( strike( 'wingtip', 'water', 3 ) ) === 'scrape', 'a wingtip in the water: rough under 12 m/s, a wreck above' );
	ok( sev( strike( 'propeller', 'water', 6 ) ) === 'rough' && sev( strike( 'nose', 'water', 9 ) ) === 'wreck', 'the nose / propeller digging in above 8 m/s: a wreck' );
	ok( sev( strike( 'float', 'ground', 4 ) ) === 'scrape' && sev( strike( 'float', 'ground', 8 ) ) === 'wreck' && sev( strike( 'tail', 'ground', 15 ) ) === 'wreck', 'the ground: beaching is fine, aground or a part on it is a wreck' );
	ok( sev( strike( 'nose', 'ground', 30 ) ) === 'death' && sev( strike( 'nose', 'ground', 30, { nose: 0.2 } ) ) === 'wreck' && sev( strike( 'nose', 'ground', 22 ) ) === 'wreck', 'a direct collision: nose first into terrain over 25 m/s is fatal (sideways or slower: a wreck)' );
	ok( sev( strike( 'propeller', 'ship', 27 ) ) === 'death' && sev( strike( 'wingtip', 'ship', 30 ) ) === 'wreck' && sev( strike( 'wingtip', 'ship', 6 ) ) === 'rough', 'a ship: nose first over 25 fatal, a wing into it a wreck, a clip rough' );
	ok( sev( strike( 'nose', 'prop', 30 ) ) === 'wreck' && sev( strike( 'nose', 'water', 41 ) ) === 'death' && sev( strike( 'wingtip', 'water', 41 ) ) === 'death', 'a crate is not a cliff; anything over 40 m/s is fatal' );
	const jr = judge( strike( 'nose', 'ground', 30 ) );
	ok( jr.kind === 'crash' && jr.severity === 'death' && judge( touch( 4.2 ) ).kind === 'bounce' && judge( strike( 'wingtip', 'water', 20 ) ).severity === 'wreck', 'judge keeps its kinds and carries the severity' );
	const wp = wreckParts( strike( 'wingtip', 'water', 20, { side: 1 } ), 'wreck', () => 0.3 );
	ok( wp.includes( 'wingL' ) && wp.includes( 'wingR' ) && wp.includes( 'floatL' ) && ! wp.includes( 'tail' ), `a wreck sheds both wings and the float on the side that hit (${ wp.join( ', ' ) })` );
	ok( wreckParts( strike( 'tail', 'ground', 15 ), 'wreck', () => 0.3 ).includes( 'tail' ) && wreckParts( strike( 'nose', 'water', 20 ), 'wreck', () => 0.3 ).includes( 'prop' ), 'a tail strike tears the tail off, a nose-in the propeller' );

	// thrown clear: outside the hull and the floats, in the water (swim) or on the ground (walk); not up a cliff
	const o = { x: 100, y: 1.5, z: 50, yaw: 0.7 };
	const tw = throwPoint( o, 1, { seaLevel: 0.1, groundAt: () => - 20 }, () => 0.5 );
	const off = hullOffset( o, tw.x, tw.z );
	ok( tw.mode === 'swim' && Math.abs( tw.y - ( 0.1 - 0.2 ) ) < 1e-9 && Math.abs( off.side ) > CRASH.clearOf && off.side > 0 && tw.dist < 8, `thrown clear into the water, ${ off.side.toFixed( 1 ) } m to port of the hull` );
	const tg = throwPoint( o, 1, { seaLevel: 0, groundAt: () => 3 }, () => 0.5 );
	ok( tg.mode === 'walk' && tg.y === 3 && Math.abs( hullOffset( o, tg.x, tg.z ).side ) > CRASH.clearOf, 'on land: onto the ground beside the wreck' );
	const tc = throwPoint( o, 1, { seaLevel: 0, groundAt: ( x, z ) => ( hullOffset( o, x, z ).side > 0 ? 40 : - 10 ) }, () => 0.5 );
	ok( hullOffset( o, tc.x, tc.z ).side < - CRASH.clearOf && tc.mode === 'swim', 'a cliff to port: thrown to starboard instead' );

	// the pieces: detach once, float, sink after their time
	const w = new Wreck( { position: new E.Vector3( 0, 0.2, 0 ), quaternion: new E.Quaternion(), velocity: new E.Vector3( 0, - 3, 20 ), seed: 3, afloat: 60 } );
	ok( w.detach( 'wingL' ) && w.detach( 'tail' ) && ! w.detach( 'wingL' ) && ! w.detach( 'fuselage' ) && w.bodies.size === 3, 'parts detach once each (and the fuselage is the wreck itself)' );
	const ev = [];
	let afloatAt = null;
	for ( let i = 0; i < 20 * 90; i ++ ) {

		for ( const e of w.update( 1 / 20, { seaAt: () => 0 } ) ) ev.push( { ...e, t: w.t } );
		if ( afloatAt === null && w.fuselage.state === 'afloat' ) afloatAt = w.t;

	}

	const sunk = ev.find( ( e ) => e.type === 'sunk' && e.name === 'fuselage' );
	ok( ev.some( ( e ) => e.type === 'splash' && e.name === 'wingL' ) && afloatAt !== null && afloatAt < 3, 'the torn-off parts fly and splash down; the fuselage settles afloat' );
	ok( sunk && sunk.t > 60 && sunk.t < 60 + CRASH.sinkTime + 3 && w.sunk, `the fuselage floats its 60 s, then sinks (gone at ${ sunk ? sunk.t.toFixed( 1 ) : '-' } s)` );
	const wg = new Wreck( { position: new E.Vector3( 0, 6, 0 ), quaternion: new E.Quaternion(), velocity: new E.Vector3( 0, - 5, 10 ), seed: 4, detach: [ 'wingR' ] } );
	for ( let i = 0; i < 20 * 150; i ++ ) wg.update( 1 / 20, { seaAt: () => 0, groundAt: () => 4 } );
	ok( wg.fuselage.state === 'aground' && Math.abs( wg.y - ( 4 + PARTS.fuselage.rest ) ) < 1e-6 && ! wg.sunk && wg.bodies.get( 'wingR' ).state === 'aground', 'on land the wreck comes to rest and stays' );
	// a part's group (model-frame geometry) is placed so the part's centre is where the body is
	const pp = new E.Vector3(), pq = new E.Quaternion();
	w.pose( 'tail', pp, pq );
	const tb = w.bodies.get( 'tail' );
	ok( new E.Vector3( ...PARTS.tail.c ).applyQuaternion( pq ).add( pp ).distanceTo( tb.c ) < 1e-6, 'a detached group is posed about its own centre' );

	// a sprung float lists the plane to its side
	const fs0 = new Flight();
	fs0.place( 0, 0, 0 );
	fs0.sprung[ 0 ] = 1;
	fly( fs0, 8, ( p ) => { p.controls.throttle = 0; } );
	ok( fs0.rollAngle() * DEG < - 0.8, `a sprung port float: it lists to port (${ ( fs0.rollAngle() * DEG ).toFixed( 1 ) } deg)` );

	// the GLB's nodes are the wreck's parts
	const gb = fs.readFileSync( new URL( '../public/models/seaplane/Seaplane.glb', import.meta.url ) );
	const parts = meshParts( parseGLB( gb.buffer.slice( gb.byteOffset, gb.byteOffset + gb.byteLength ) ) );
	ok( [ ...BODY_PARTS, 'prop' ].every( ( n ) => parts.includes( n ) ), `the GLB splits into ${ [ ...new Set( parts ) ].join( ', ' ) }` );
	// the visual draws each part in its own group; a wreck carries a part off once, the recovery puts it back
	const scene = new E.Scene();
	const mk = ( n ) => Object.assign( new E.Mesh( new E.BoxGeometry( 1, 1, 1 ), null ), { name: n } );
	const pm = new PlaneModels( { scene, load: async () => ( { meshes: [ mk( 'seaplane-SeaplaneJade' ), mk( 'seaplane-SeaplaneCream' ), mk( 'seaplane-SeaplaneJade' ) ], parts: [ 'fuselage', 'wingL', 'tail' ] } ) } );
	const pv = pm.create();
	await pm.ready;
	ok( pv.parts.wingL.children.length === 1 && pv.parts.tail.children.length === 1 && pv.parts.fuselage.children.length === 1, 'the model fills one group per part' );
	const wg0 = pv.detach( 'wingL' );
	ok( wg0 && wg0.parent === scene && pv.detach( 'wingL' ) === null, 'a part detaches into the scene once' );
	pv.reassemble();
	ok( wg0.parent === pv.body && pv.detached.size === 0, 'and goes back on the recovered plane' );

}

// the wreck in the world: a hard nose-in at 20 m/s (not a direct hit at sea): pieces, the pilot thrown clear
{

	const W = makeWorld( { money: 50000 } );
	const { sp, player, state, features, frame, input } = W;
	const calls = [];
	const vfx = new Proxy( {}, { get: ( _, k ) => ( ...a ) => calls.push( [ k, ...a ] ) } );
	features.list.set( 'vfx', { instance: vfx } );
	const pins = new Map();
	features.list.set( 'worldmap', { instance: { addMarker: ( m ) => pins.set( m.id, m ), removeMarker: ( id ) => pins.delete( id ) } } );
	const melee = { combat: { hp: 100, sinceHurt: 9 } };
	features.list.set( 'melee', { instance: melee } );
	sp.buy();
	ok( sp.board(), 'boards for the crash run' );
	const f = sp.flight;
	f.position.set( 60, 4, 260 );
	f.quaternion.setFromAxisAngle( new E.Vector3( 1, 0, 0 ), 25 / DEG ); // nose 25 deg down
	f.velocity.set( 0, - 8, 18 );
	f.angular.set( 0, 0, 0 );
	f.airborne = true;
	f._wasAir = true;
	f.airTime = 2;
	f.engineOn = true;
	let crash = null;
	for ( let i = 0; i < 60 * 4 && ! crash; i ++ ) {

		frame();
		crash = W.events.find( ( e ) => e.n === 'planeCrashed' );

	}

	ok( crash && crash.severity === 'wreck' && crash.water && sp.stats.crashes === 1, `a wreck at sea (${ crash ? `${ crash.cause }, ${ crash.speed.toFixed( 1 ) } m/s` : '-' }), the crash counted` );
	const wr = sp.wreck;
	const off = wr ? hullOffset( { x: wr.x, z: wr.z, yaw: wr.yaw }, player.position.x, player.position.z ) : { side: 0, along: 0 };
	ok( player.mode === 'swim' && ! sp.piloted && ( Math.abs( off.side ) > CRASH.clearOf || Math.abs( off.along ) > 6 ) && Math.hypot( off.side, off.along ) < 10, `thrown clear: swimming ${ Math.hypot( off.side, off.along ).toFixed( 1 ) } m from the wreck, outside the hull` );
	ok( sp.stun.active && melee.combat.hp < 100 && melee.combat.hp > 0, `blacked out, hurt (health ${ melee.combat.hp }), alive` );
	ok( wr && wr.detached.has( 'wingL' ) && wr.detached.has( 'wingR' ) && wr.parts.length >= 4, `the plane broke up (${ wr ? wr.parts.map( ( p ) => p.name ).join( ', ' ) : '-' })` );
	ok( [ 'splash', 'splinters', 'debris', 'smoke' ].every( ( k ) => calls.some( ( c ) => c[ 0 ] === k ) ) && pins.has( 'seaplane-wreck' ), 'a splash, splinters, debris and smoke; a wreck pin on the map' );
	ok( sp.audio.state.crunches >= 1, 'a crunch' );
	for ( let i = 0; i < 90; i ++ ) frame();
	ok( ! sp.stun.active, 'the black-out lifts' );
	ok( sp.wreck && sp.wreck.fuselage.state === 'afloat' && player.mode === 'swim', 'the fuselage floats; the pilot treads water beside it' );
	const smokes = calls.filter( ( c ) => c[ 0 ] === 'smoke' ).length;
	for ( let i = 0; i < 60; i ++ ) frame();
	ok( calls.filter( ( c ) => c[ 0 ] === 'smoke' ).length > smokes, 'the engine keeps smoking' );
	ok( ! sp.board() && ! features.nearestInteractable( sp.flight.toWorldXYZ( ...GEOM.door, new E.Vector3() ) )?.id?.startsWith?.( 'seaplane-door' ), 'no boarding a wreck' );
	// the floating fuselage is a perch: E beside it climbs onto the cabin roof
	const fz = sp.wreck.fuselage.c;
	player.position.set( fz.x + 3, player.position.y, fz.z );
	frame();
	input.pressed.add( 'KeyE' );
	frame();
	ok( player.mode === 'walk' && player.position.y > fz.y + 0.8 && sp._perchBox, `E: out of the water onto the wreck's roof (${ ( player.position.y - fz.y ).toFixed( 2 ) } m over its centre)` );
	for ( let i = 0; i < 120; i ++ ) frame();
	ok( player.mode === 'walk' && Math.abs( player.position.y - sp._perchBox.top ) < 0.15, 'standing on it as it bobs' );
	// let it sink (2 min at sea at most + the sinking), at 20 Hz
	for ( let i = 0; i < 20 * ( CRASH.afloat[ 1 ] + CRASH.sinkTime + 4 ) && sp.wreck; i ++ ) frame( 1 / 20 );
	ok( ! sp.wreck && sp.lost && calls.some( ( c ) => c[ 0 ] === 'bubbles' ), 'the wreck sinks after its time (bubbles); the plane stays lost' );
	ok( player.mode === 'swim' && ! sp._perchBox && ! W.colliders.boxes.some( ( b ) => b.tag === 'seaplane-wreck' ), 'it went down under the pilot: back in the water, the perch gone' );
	ok( pins.get( 'seaplane-wreck' ) && /sunk/.test( pins.get( 'seaplane-wreck' ).label ), 'the pin marks where it went down' );
	const saved = JSON.parse( JSON.stringify( sp.toJSON() ) );
	const W2 = makeWorld();
	W2.sp.fromJSON( saved );
	ok( W2.sp.lost && ! W2.sp.board(), 'a lost plane stays lost through a save' );
	const m0 = state.money;
	const rc = sp.recall();
	ok( rc.ok && ! sp.lost && sp.home && state.money === m0 - CRASH.recovery && ! pins.has( 'seaplane-wreck' ) && /Roid/.test( rc.text ), `recovered through the hangar for $${ CRASH.recovery } (${ rc.text })` );
	ok( sp.repair().ok && sp.hp === MAX_HP && sp.board(), 'repaired, it flies again' );

	// a rough landing: damage and a sprung float, the pilot stays aboard
	f.position.set( 60, 0.45, 260 );
	f.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), 4 / DEG ).multiply( new E.Quaternion().setFromAxisAngle( new E.Vector3( 1, 0, 0 ), - 3 / DEG ) );
	f.velocity.set( 0, - 4.4, 24 );
	f.angular.set( 0, 0, 0 );
	f.airborne = true;
	f._wasAir = true;
	f.airTime = 2;
	W.events.length = 0;
	let landed = null;
	for ( let i = 0; i < 60 * 3 && ! landed; i ++ ) {

		frame();
		landed = W.events.find( ( e ) => e.n === 'planeLanded' );

	}

	ok( landed && landed.sink >= CRASH.roughSink && landed.sink < CRASH.wreckSink && sp.hp < MAX_HP && sp.hp > 0, `a rough landing (sink ${ landed ? landed.sink.toFixed( 1 ) : '-' } m/s): hull ${ Math.round( sp.hp ) }%` );
	ok( sp.piloted && player.mode === 'plane' && ! sp.lost && ( f.sprung[ 0 ] > 0 || f.sprung[ 1 ] > 0 ) && sp.view().sprung, 'the pilot stays aboard; a float is sprung' );
	ok( sp.repair().ok && f.sprung[ 0 ] === 0 && f.sprung[ 1 ] === 0, 'the repair fixes the float' );

	// a ground wreck: thrown onto the ground beside it, a fire for ~20 s
	const land = { x: - 2.6, z: - 117.2 };
	const g = terrain.heightAt( land.x, land.z );
	f.place( land.x, land.z, 0.5, g + 0.2 );
	f.velocity.set( 0, - 2, 14 );
	calls.length = 0;
	const ge = { type: 'strike', part: 'float', surface: 'ground', speed: 14, nose: 0.9, side: 0 };
	sp._crash( 'Ran aground', ge, judge( ge ) );
	ok( player.mode === 'walk' && Math.abs( player.position.y - terrain.heightAt( player.position.x, player.position.z ) ) < 1.2 && calls.some( ( c ) => c[ 0 ] === 'fire' ) && calls.some( ( c ) => c[ 0 ] === 'dust' ), `a ground wreck: thrown onto the ground (${ player.mode }), dust and a fire` );
	for ( let i = 0; i < 20 * ( CRASH.fire + 2 ); i ++ ) frame( 1 / 20 );
	ok( calls.some( ( c ) => c[ 0 ] === 'stopFire' ) && sp.wreck && sp.wreck.fuselage.state === 'aground', 'the fire dies after ~20 s; the wreck stays on land' );
	ok( sp.recall().ok && ! sp.wreck && sp.home, 'and is recovered from there' );

	// a direct collision: playerDied (the death feature takes it from there)
	features.list.set( 'death', { instance: {} } );
	const died = [];
	features.on( 'playerDied', ( e ) => died.push( e ) );
	sp.repair();
	sp.board();
	f.place( land.x, land.z, 0.5, g + 1 );
	f.velocity.set( 0, - 6, 32 );
	const de = { type: 'strike', part: 'nose', surface: 'ground', speed: 32, nose: 0.97, side: 0 };
	sp._crash( 'Nose first into the ground', de, judge( de ) );
	ok( died.length === 1 && died[ 0 ].cause === 'seaplane' && sp.lost && sp.stats.crashes === 3, 'a direct collision kills the pilot (playerDied seaplane), the plane is wrecked' );

}

// ---------------------------------------------------------------- wave 14A: the cockpit follows the airframe out
{

	const W = makeWorld( { mode: 'sandbox' } );
	W.sp.buy();
	W.sp.cockpit.update( 1 / 60 );
	const was = W.sp.cockpit.layout.id;
	W.sp.buy( 'albatross' );
	W.sp.cockpit.update( 1 / 60 );
	ok( was === 'jade' && W.sp.af === 'albatross' && W.sp.cockpit.layout.id === 'albatross' && W.sp.cockpit.rebuilds >= 1, `the cockpit swaps its face with the airframe (${ was } -> ${ W.sp.cockpit.layout.id })` );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall seaplane tests passed' );
process.exit( fails ? 1 : 0 );
