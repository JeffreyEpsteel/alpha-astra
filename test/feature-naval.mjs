// Plain-node test of the naval feature (src/features/naval): the exported ship assets, the sea lanes against the
// real heightmap, ballistics, the AI ships' state machines, the combat / damage / sinking / loot flow, the water
// pool, the save round trip, the HUD maths and a stand-in DOM, the registry integration (keys, events), and a headless
// GPU render of the three ship models (test/out/naval-ships.png).
//   node test/feature-naval.mjs              everything (the render needs the headless WebGPU of the other tests)
//   node test/feature-naval.mjs --no-render  logic only
import './headless.mjs';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Features } from '../src/features/Features.js';
import * as navalModule from '../src/features/naval/index.js';
import { Naval, hullMaxFor, GUN_LEVELS } from '../src/features/naval/Naval.js';
import { Ship, SINK_TIME } from '../src/features/naval/Ship.js';
import { SHIP_CLASSES } from '../src/features/naval/ShipClasses.js';
import { MERCHANT_ROUTE, PATROLS, SAFE_ZONES, HARBOUR_ANCHORAGE, PONS_ROADS, makeCursor, legs, inSafeZone } from '../src/features/naval/Routes.js';
import { solveElevation, leadAim, stepBall, segmentVsObb, yawBox, quatBox, MUZZLE_SPEED, GRAVITY } from '../src/features/naval/Ballistics.js';
import { thinkPirate, thinkMerchant } from '../src/features/naval/Brains.js';
import { WaterPool, poseFromHeights } from '../src/features/naval/WaterPool.js';
import { arrowFor, hudModel, NavalHud } from '../src/features/naval/Hud.js';
import { ModelSet, MODEL_YAW } from '../src/features/naval/Models.js';
import { Projectiles } from '../src/features/naval/Projectiles.js';
import { Loot, LOOT_LIFE } from '../src/features/naval/Loot.js';
import { NavalAudio } from '../src/features/naval/NavalAudio.js';
import { makeRng, wrap, angleDiff, normaliseSide } from '../src/features/naval/util.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { ensureBlackwater } from '../src/world/islands/BlackwaterTerrain.js';
import { SEA_STACKS, PONS_STACKS } from '../src/world/terrain/IslandShape.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

const NO_RENDER = process.argv.includes( '--no-render' );
const root = new URL( '../', import.meta.url );
let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );
const deg = ( r ) => r * 180 / Math.PI;

// ------------------------------------------------------------------------------------------------ stand-ins

const t0 = performance.now();
const terrain = new TerrainData();
ensureBlackwater( terrain ); // wave 14D: the pirates' island on its own tile (TerrainData does this itself once root applies the patch; idempotent)
console.log( `heightmap built in ${ ( performance.now() - t0 ).toFixed( 0 ) } ms` );

function makeApp( over = {} ) {

	const toasts = [], kicks = [];
	const state = {
		boat: 'lobster', money: 0, earned: [],
		earn( n ) { this.money += n; this.earned.push( n ); return this.money; },
		spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; },
	};
	const keys = new Set();
	const app = {
		mode: 'campaign', settings: { timeOfDay: 12 },
		terrainData: terrain, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( - 50, 0, 450 ), quaternion: new Quaternion(), velocity: new Vector3(), driven: true, moored: false },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new Vector3( - 50, 4, 440 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new Vector3( - 50, 1, 450 ) },
		input: { hit: ( c ) => keys.has( c ), keys },
		game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick( k ) { kicks.push( k ); } },
		toasts, kicks,
		...over,
	};
	return app;

}

// a registry plus a naval instance: nothing auto-spawns unless asked
function setup( { app = makeApp(), settings = {}, seed = 7, extra = {}, install = true } = {} ) {

	const features = new Features( app );
	const events = [];
	for ( const n of [ 'shipSunk', 'enemyDefeated', 'playerBoatDamaged', 'playerBoatSunk', 'lootCollected' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed, hud: false, models: false, settings: { autoSpawn: false, ...settings }, ...extra } ) } );
	return { app, features, naval, events };

}

function run( features, seconds, dt = 0.05, each = null ) {

	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) {

		features.update( dt );
		if ( each && each( i, i * dt ) === false ) return i * dt;

	}

	return seconds;

}

// a ship that stands still (no brain acts on state 'dock' for a pirate)
function still( naval, kind, x, z, yaw = 0 ) {

	const s = naval.spawn( kind, { x, z, yaw } );
	s.state = 'dock';
	s.wantSpeed = 0;
	return s;

}

// ================================================================================================ 1. assets
section( '1. assets' );
{

	for ( const k of [ 'trawler', 'sloop', 'brigantine' ] ) {

		const file = new URL( `public/models/ships/${ k }_v2.glb`, root );
		ok( existsSync( file ), `${ k }_v2.glb copied to public/models/ships` );
		const buf = readFileSync( file );
		const g = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
		const cls = SHIP_CLASSES[ k ];
		let mn = [ 1e9, 1e9, 1e9 ], mx = [ - 1e9, - 1e9, - 1e9 ];
		let lantern = null;
		g.nodes.forEach( ( n ) => {

			if ( n.mesh === undefined ) return;
			for ( const p of g.meshes[ n.mesh ] ) {

				const P = p.attributes.POSITION.array;
				let cx = 0, cn = 0;
				for ( let i = 0; i < P.length; i += 3 ) {

					for ( let c = 0; c < 3; c ++ ) { mn[ c ] = Math.min( mn[ c ], P[ i + c ] ); mx[ c ] = Math.max( mx[ c ], P[ i + c ] ); }
					cx += P[ i ]; cn ++;

				}

				if ( /Lantern/.test( g.materials[ p.material ].name ) ) lantern = cx / cn;

			}

		} );
		ok( near( mx[ 0 ] - mn[ 0 ], cls.length, 0.7 ), `${ k }: hull length ${ ( mx[ 0 ] - mn[ 0 ] ).toFixed( 2 ) } m matches the class (${ cls.length })` );
		ok( near( mn[ 1 ], - cls.draft, 0.1 ) && near( mx[ 1 ], cls.mast, 0.1 ), `${ k }: keel ${ mn[ 1 ].toFixed( 2 ) } m / mast ${ mx[ 1 ].toFixed( 2 ) } m match draft ${ cls.draft } / mast ${ cls.mast }` );
		ok( lantern !== null && lantern < - cls.length * 0.3, `${ k }: the stern lantern sits at -X (x = ${ lantern && lantern.toFixed( 2 ) }), so the bow is +X and MODEL_YAW turns it to +Z` );

	}

	ok( near( MODEL_YAW, - Math.PI / 2 ), 'MODEL_YAW is -PI/2 (the prototype used the same turn)' );
	{

		// the root nodes of brigantine / trawler carry the scene layout offsets of the fork's blend file
		const rx = ( k ) => {

			const b = readFileSync( new URL( `public/models/ships/${ k }_v2.glb`, root ) );
			const g = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
			return g.nodes[ g.roots[ 0 ] ].t[ 0 ];

		};

		ok( near( rx( 'sloop' ), 0 ) && near( rx( 'brigantine' ), 24.533, 0.01 ) && near( rx( 'trawler' ), 54.666, 0.01 ), `GLB root nodes are offset along X by 0 / 24.53 / 54.67 m (sloop / brigantine / trawler): Models.js re-centres them` );

	}

	for ( const f of [ 'CannonShot_V01.mp3', 'ShipImpact_V01.mp3' ] ) ok( existsSync( new URL( 'public/audio/naval/' + f, root ) ) && readFileSync( new URL( 'public/audio/naval/' + f, root ) ).length > 20000, f + ' copied to public/audio/naval' );

}

// ================================================================================================ 2. sea lanes
section( '2. sea lanes against the heightmap' );
{

	const depth = ( a, b, lat ) => {

		let worst = - 1e9;
		const L = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ), dx = ( b[ 0 ] - a[ 0 ] ) / L, dz = ( b[ 1 ] - a[ 1 ] ) / L;
		for ( let s = 0; s <= L; s += 4 ) for ( const o of [ - lat, 0, lat ] ) worst = Math.max( worst, terrain.heightAt( a[ 0 ] + dx * s - dz * o, a[ 1 ] + dz * s + dx * o ) );
		return worst;

	};

	let worst = - 1e9;
	for ( const [ a, b ] of legs( MERCHANT_ROUTE ) ) worst = Math.max( worst, depth( a, b, 14 ) );
	ok( worst < - 2, `the merchant lane stays in water deeper than 2 m (highest point ${ worst.toFixed( 1 ) } m, 14 m either side)` );
	for ( const p of MERCHANT_ROUTE ) ok( terrain.heightAt( p[ 0 ], p[ 1 ] ) < - 3, `waypoint (${ p }) has ${ ( - terrain.heightAt( p[ 0 ], p[ 1 ] ) ).toFixed( 1 ) } m of water (a trawler draws 1.65 m)` );
	// the straight line from the pier head to the cove runs through the east stacks; the lane does not
	let clearance = 1e9;
	for ( const [ a, b ] of legs( MERCHANT_ROUTE ) ) {

		const L = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		for ( let s = 0; s <= L; s += 5 ) {

			const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * s / L, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * s / L;
			for ( const [ sx, sz, r ] of [ ...SEA_STACKS, ...PONS_STACKS ] ) clearance = Math.min( clearance, Math.hypot( x - sx, z - sz ) - r );

		}

	}

	ok( clearance > 60, `the lane keeps ${ clearance.toFixed( 0 ) } m clear of every sea stack` );
	const straight = depth( [ WORLD.boatDock.position.x, WORLD.boatDock.position.z ], [ WORLD.pons.dock.position.x, WORLD.pons.dock.position.z ], 0 );
	ok( straight > - 2, `(control) the straight pier-to-cove line does cross shoals (highest ${ straight.toFixed( 1 ) } m)` );
	ok( Math.hypot( HARBOUR_ANCHORAGE[ 0 ] - WORLD.boatDock.position.x, HARBOUR_ANCHORAGE[ 1 ] - WORLD.boatDock.position.z ) < 60, 'the harbour anchorage is by the boat dock' );
	ok( Math.hypot( PONS_ROADS[ 0 ] - WORLD.pons.dock.position.x, PONS_ROADS[ 1 ] - WORLD.pons.dock.position.z ) < 100, 'the Pons roads are off the cove dock' );

	PATROLS.forEach( ( route, i ) => {

		let w = - 1e9, minZ = 1e9;
		for ( const [ a, b ] of legs( route, true ) ) w = Math.max( w, depth( a, b, 20 ) );
		for ( const p of route ) minZ = Math.min( minZ, p[ 1 ] );
		const inZone = route.some( ( p ) => inSafeZone( p[ 0 ], p[ 1 ] ) );
		ok( w < - 3.5 && minZ > 150 && ! inZone, `patrol ${ i }: deep water all round (highest ${ w.toFixed( 1 ) } m), south of z = 150 (min ${ minZ }), outside the ports` );

	} );

}

// ================================================================================================ 3. ballistics
section( '3. ballistics' );
{

	// flat-ground range: the textbook elevation, and the integrator lands where the formula says
	const el = solveElevation( MUZZLE_SPEED, 100, 0 );
	ok( near( el, 0.5 * Math.asin( GRAVITY * 100 / MUZZLE_SPEED ** 2 ), 1e-9 ), `100 m at 120 m/s needs ${ deg( el ).toFixed( 3 ) } deg of elevation` );
	const b = { x: 0, y: 5, z: 0, vx: MUZZLE_SPEED * Math.cos( el ), vy: MUZZLE_SPEED * Math.sin( el ), vz: 0 };
	let t = 0;
	while ( b.y > 5 || t < 0.1 ) { stepBall( b, 0.001 ); t += 0.001; }
	ok( near( b.x, 100, 0.25 ) && near( t, 100 / ( MUZZLE_SPEED * Math.cos( el ) ), 0.01 ), `the ball returns to its launch height at x = ${ b.x.toFixed( 2 ) } m after ${ t.toFixed( 3 ) } s` );
	ok( solveElevation( MUZZLE_SPEED, 3000, 0 ) === null, 'out of range (3 km) has no solution' );
	ok( solveElevation( MUZZLE_SPEED, 100, 0, true ) > 1.4, 'the lob solution is steep' );
	const up = solveElevation( MUZZLE_SPEED, 100, 20 ), flat = solveElevation( MUZZLE_SPEED, 100, 0 );
	ok( up > flat, 'a target 20 m higher needs more elevation' );

	// a ball with the flat-ground elevation hits a box 100 m away; with 0 elevation it falls 3.5+ m short of it
	const target = yawBox( 100, 5, 0, 0, 3, 3, 8 );
	const fly = ( elev ) => {

		const ball = { x: 0, y: 5, z: 0, vx: MUZZLE_SPEED * Math.cos( elev ), vy: MUZZLE_SPEED * Math.sin( elev ), vz: 0 };
		for ( let i = 0; i < 3000; i ++ ) {

			const p0 = { x: ball.x, y: ball.y, z: ball.z };
			stepBall( ball, 0.002 );
			if ( segmentVsObb( p0, ball, target, 0.14 ) >= 0 ) return 'hit';
			if ( ball.y < 0 ) return 'water at ' + ball.x.toFixed( 0 );

		}

		return 'gone';

	};

	ok( fly( el ) === 'hit', 'the solved elevation hits the target box at 100 m' );
	ok( /^water/.test( fly( 0 ) ), 'level fire at 100 m falls into the sea first: ' + fly( 0 ) );

	// lead: a target crossing at 6 m/s, a shooter making 5 m/s that the ball inherits
	const S = { x: 0, y: 3, z: 0 }, Vs = { x: 0, y: 0, z: 5 }, T = { x: 120, y: 1, z: 40 }, Vt = { x: 0, y: 0, z: - 6 };
	const aim = leadAim( S, Vs, T, Vt, MUZZLE_SPEED );
	const ball = { x: S.x, y: S.y, z: S.z, vx: aim.dir.x * MUZZLE_SPEED + Vs.x, vy: aim.dir.y * MUZZLE_SPEED, vz: aim.dir.z * MUZZLE_SPEED + Vs.z };
	let steps = Math.round( aim.t / 0.001 );
	for ( let i = 0; i < steps; i ++ ) stepBall( ball, 0.001 );
	const tx = T.x + Vt.x * aim.t, tz = T.z + Vt.z * aim.t;
	ok( Math.hypot( ball.x - tx, ball.z - tz ) < 0.3 && near( ball.y, 1, 0.3 ), `lead aim meets the moving target (miss ${ Math.hypot( ball.x - tx, ball.z - tz, ball.y - 1 ).toFixed( 3 ) } m, flight ${ aim.t.toFixed( 3 ) } s)` );
	ok( leadAim( S, Vs, { x: 4000, y: 0, z: 0 }, { x: 0, y: 0, z: 0 } ) === null, 'no lead solution beyond the gun range' );

	// the oriented box: yaw boxes and quaternion boxes agree
	const q = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.8 );
	const a = yawBox( 5, 1, 7, 0.8, 1.5, 2, 6 ), c = quatBox( { x: 5, y: 1, z: 7 }, q, [ 1.5, 2, 6 ] );
	const p0 = { x: - 20, y: 1, z: 7 }, p1 = { x: 30, y: 1, z: 7 };
	ok( near( segmentVsObb( p0, p1, a ), segmentVsObb( p0, p1, c ), 1e-9 ) && segmentVsObb( p0, p1, a ) > 0, 'yawBox and quatBox give the same hit' );
	ok( segmentVsObb( { x: - 20, y: 20, z: 7 }, { x: 30, y: 20, z: 7 }, a ) === - 1, 'a segment above the box misses' );

}

// ================================================================================================ 4. sailing
section( '4. kinematics' );
{

	// a trawler turns at its rate and keeps way
	const s = new Ship( 'trawler', { x: 0, z: 400, yaw: 0, speed: 0 } );
	s.want = Math.PI / 2;
	s.wantSpeed = 1;
	let maxRate = 0;
	for ( let i = 0; i < 1200; i ++ ) { s.integrate( 0.05, null ); maxRate = Math.max( maxRate, Math.abs( s.yawRate ) ); }
	ok( maxRate <= SHIP_CLASSES.trawler.turn + 1e-6, `turn rate capped (${ maxRate.toFixed( 3 ) } <= ${ SHIP_CLASSES.trawler.turn } rad/s)` );
	ok( Math.abs( angleDiff( s.yaw, Math.PI / 2 ) ) < 0.03 && s.speed > 0.9 * SHIP_CLASSES.trawler.speed, `she settles on the heading at ${ s.speed.toFixed( 2 ) } m/s` );
	s.rigging = 0.2;
	for ( let i = 0; i < 400; i ++ ) s.integrate( 0.05, null );
	ok( s.speed < 0.65 * SHIP_CLASSES.trawler.speed, `shot-up rigging slows her to ${ s.speed.toFixed( 2 ) } m/s` );

	// steering round shoals: a sloop ordered straight at the beach never grounds
	const run1 = new Ship( 'sloop', { x: 60, z: 140, yaw: Math.PI, speed: 5 } );
	run1.want = Math.PI;
	run1.wantSpeed = 1;
	let highest = - 1e9;
	for ( let i = 0; i < 2400; i ++ ) {

		run1.integrate( 0.05, terrain );
		highest = Math.max( highest, terrain.heightAt( run1.x, run1.z ) );

	}

	ok( highest < - run1.cls.draft - 0.3 && run1.grounded === 0, `a sloop sent at the beach turns away (shallowest ${ highest.toFixed( 1 ) } m, grounded ${ run1.grounded.toFixed( 1 ) } s)` );
	const moved = Math.hypot( run1.x - 60, run1.z - 140 );
	ok( moved > 100, `and keeps sailing (${ moved.toFixed( 0 ) } m from the start)` );

	// pose: heel into a turn, list when shot up, sinking roll + sink
	const h = new Ship( 'sloop', { x: 0, z: 0 } );
	h.speed = 6; h.yawRate = 0.4;
	for ( let i = 0; i < 100; i ++ ) h.updatePose( 0.05 );
	const turned = h.finalPose( {} );
	ok( turned.roll > 0.03, `a port turn heels port-side up (roll ${ turned.roll.toFixed( 3 ) } rad)` );
	h.yawRate = 0; h.hp = 20;
	for ( let i = 0; i < 100; i ++ ) h.updatePose( 0.05 );
	ok( Math.abs( h.finalPose( {} ).roll ) > 0.04, 'a shot-up hull lists' );
	h.damage( 500, { by: 'player' } );
	ok( h.state === 'sinking' && h.hp === 0, 'lethal damage starts the sinking' );
	for ( let i = 0; i < 80; i ++ ) h.integrate( 0.05, null );
	const mid = h.finalPose( {} );
	for ( let i = 0; i < 100; i ++ ) h.integrate( 0.05, null );
	const end = h.finalPose( {} );
	ok( h.state === 'gone' && h.sinkT >= SINK_TIME, `after ${ SINK_TIME } s she is gone` );
	ok( mid.y < - 0.3 && end.y < - h.cls.draft - h.cls.sheer && Math.abs( end.roll ) > 1, `sinking: ${ mid.y.toFixed( 1 ) } m at 4 s, ${ end.y.toFixed( 1 ) } m at the end, rolled ${ deg( end.roll ).toFixed( 0 ) } deg` );

}

// ================================================================================================ 5. brains
section( '5. AI state machines' );
{

	const calls = { fire: [], escape: 0 };
	const w = { time: 0, night: false, storm: false, rng: makeRng( 3 ), terrain: null, target: { x: 4000, z: 4000, vx: 0, vz: 0, ok: true }, fire: ( s, side ) => { calls.fire.push( side ); return true; }, escape: () => { calls.escape ++; } };
	const mk = () => {

		const s = new Ship( 'sloop', { x: - 100, z: 700, yaw: 0, speed: 4 } ); // (wave 15C: outside the 450 m calm round the home dock)
		s.cursor = makeCursor( PATROLS[ 0 ], { loop: true, index: 1 } );
		return s;

	};

	let s = mk();
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'patrol' && s.wantSpeed === 0.6, 'far from the target a pirate patrols at 60 % speed' );
	w.target.x = s.x + 300; w.target.z = s.z;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'chase', 'the player inside the sight radius (300 m < 380 m) starts a chase' );
	thinkPirate( s, w, 0.05 );
	ok( Math.abs( angleDiff( s.want, Math.PI / 2 ) ) < 0.1 && s.wantSpeed === 1, 'she heads for the target at full speed' );
	w.target.x = s.x + 120;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'broadside', 'inside the engage range she turns to a broadside' );

	// the target is to the east: she must swing round until it is abeam, and fire only the side that bears
	w.target.x = s.x + 90; w.target.z = s.z; w.target.vx = 0; w.target.vz = 0;
	let bearsAt = - 1;
	for ( let i = 0; i < 1600 && bearsAt < 0; i ++ ) {

		thinkPirate( s, w, 0.05 );
		s.integrate( 0.05, null );
		const rel = angleDiff( Math.atan2( w.target.x - s.x, w.target.z - s.z ), s.yaw );
		if ( Math.abs( Math.abs( rel ) - Math.PI / 2 ) < 0.35 && calls.fire.length ) bearsAt = i;

	}

	const rel = angleDiff( Math.atan2( w.target.x - s.x, w.target.z - s.z ), s.yaw );
	ok( bearsAt >= 0, `she circled to put the target abeam (bearing ${ deg( rel ).toFixed( 0 ) } deg off the bow) and asked to fire` );
	ok( calls.fire.every( ( side ) => side === ( rel > 0 ? 'port' : 'starboard' ) ), `only the bearing side fires: ${ [ ...new Set( calls.fire ) ] } (target on the ${ rel > 0 ? 'port' : 'starboard' } side)` );
	s.reload.port = s.reload.starboard = 5;
	const n0 = calls.fire.length;
	thinkPirate( s, w, 0.05 );
	ok( calls.fire.length === n0, 'no fire request while the guns are reloading' );

	w.target.x = s.x + 300;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'chase', 'a target that opens to 300 m (> 1.3 x engage) is chased again' );

	// hull low -> flee, away from the target, gone beyond 650 m
	s.hp = s.maxHp * 0.2;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'flee', 'below 28 % of the hull the sloop flees' );
	ok( Math.abs( angleDiff( s.want, Math.atan2( w.target.x - s.x, w.target.z - s.z ) + Math.PI ) ) < 0.05, 'she runs straight away from the target' );
	w.target.x = s.x + 700;
	thinkPirate( s, w, 0.05 );
	ok( calls.escape === 1, 'beyond 650 m the fleeing pirate escapes' );

	// the player ducks into the harbour (not a legal target): after 4 s she gives up and goes back to patrol
	s = mk();
	w.target.x = s.x + 250; w.target.z = s.z;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'chase', 'chasing again' );
	w.target.ok = false;
	for ( let i = 0; i < 90; i ++ ) thinkPirate( s, w, 0.05 );
	ok( s.state === 'patrol', 'a target that is no longer legal (in a safe zone, moored) is dropped after 4 s' );
	w.target.ok = true;

	// night / alert: a pirate hit by the player hunts from farther than its sight
	s = mk();
	w.target.x = s.x + 500; w.target.z = s.z;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'patrol', '500 m is outside the 380 m sight' );
	s.alertT = 30;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'chase', 'a pirate that was shot at hunts from up to its lose range' );
	w.night = true;
	s = mk();
	w.target.x = s.x + 320;
	thinkPirate( s, w, 0.05 );
	ok( s.state === 'patrol', 'at night the sight shrinks (320 m > 285 m)' );
	w.night = false;

	// merchants: sail to the end, dock for 18-32 s, turn round; run when shot at
	const m = new Ship( 'trawler', { x: PONS_ROADS[ 0 ] - 30, z: PONS_ROADS[ 1 ], yaw: Math.PI / 2 } );
	m.cursor = makeCursor( MERCHANT_ROUTE, { index: MERCHANT_ROUTE.length - 1, dir: 1 } );
	w.target = { x: 0, z: 0, vx: 0, vz: 0, ok: false };
	for ( let i = 0; i < 600 && m.state === 'sail'; i ++ ) { thinkMerchant( m, w, 0.05 ); m.integrate( 0.05, null ); }
	ok( m.state === 'dock', 'the trawler docks at the end of the lane' );
	ok( m.cursor.dir === - 1 && m.cursor.index === MERCHANT_ROUTE.length - 2, 'and heads back along the lane' );
	const dockFor = m.mem.dockFor;
	ok( dockFor >= 18 && dockFor <= 32, `she waits ${ dockFor.toFixed( 1 ) } s` );
	for ( let i = 0; i < Math.round( dockFor / 0.05 ) + 2; i ++ ) { thinkMerchant( m, w, 0.05 ); m.integrate( 0.05, null ); }
	ok( m.state === 'sail', 'then sails again' );
	m.alertT = 20;
	thinkMerchant( m, w, 0.05 );
	ok( m.state === 'flee', 'a merchant shot at by the player runs' );

}

// ================================================================================================ 6. merchant lane, both ways
section( '6. merchants sail to Pons and back without touching land' );
{

	const { naval, features } = setup( { settings: { autoSpawn: true, maxPirates: 0, merchants: 2 }, app: makeApp( { boatCtl: { position: new Vector3( 0, 0, 0 ), quaternion: new Quaternion(), velocity: new Vector3(), driven: false, moored: true } } ) } );
	run( features, 1, 0.1 );
	ok( naval.merchants.length === 2 && naval.pirates.length === 0, 'two trawlers, no pirates (maxPirates 0)' );
	const track = new Map();
	let highest = - 1e9, grounded = 0, docks = 0;
	const seen = new Map();
	run( features, 760, 0.1, () => {

		for ( const s of naval.merchants ) {

			const T = track.get( s.id ) || { minPons: 1e9, minHarbour: 1e9, ponsAt: - 1, backAt: - 1 };
			track.set( s.id, T );
			highest = Math.max( highest, terrain.heightAt( s.x, s.z ), terrain.heightAt( s.x + Math.sin( s.yaw ) * 8, s.z + Math.cos( s.yaw ) * 8 ), terrain.heightAt( s.x - Math.sin( s.yaw ) * 8, s.z - Math.cos( s.yaw ) * 8 ) );
			grounded = Math.max( grounded, s.grounded );
			const dp = Math.hypot( s.x - PONS_ROADS[ 0 ], s.z - PONS_ROADS[ 1 ] ), dh = Math.hypot( s.x - HARBOUR_ANCHORAGE[ 0 ], s.z - HARBOUR_ANCHORAGE[ 1 ] );
			T.minPons = Math.min( T.minPons, dp );
			T.minHarbour = Math.min( T.minHarbour, dh );
			if ( dp < 40 && T.ponsAt < 0 ) T.ponsAt = naval.time;
			if ( dh < 40 && T.ponsAt > 0 && T.backAt < 0 ) T.backAt = naval.time;
			if ( s.state === 'dock' && seen.get( s.id ) !== 'dock' ) docks ++;
			seen.set( s.id, s.state );

		}

	} );
	for ( const [ id, T ] of track ) ok( T.ponsAt > 0 && T.backAt > T.ponsAt, `${ id }: reached the Pons roads at ${ T.ponsAt.toFixed( 0 ) } s and the harbour again at ${ T.backAt.toFixed( 0 ) } s` );
	ok( highest < - 2, `the hull ends never left water deeper than 2 m (shallowest ${ highest.toFixed( 1 ) } m)` );
	ok( grounded === 0, 'no ship touched the ground' );
	ok( docks >= 2, `${ docks } dockings` );

}

// ================================================================================================ 7. combat
section( '7. combat: the player\'s gun' );
{

	const saved = GUN_LEVELS[ 1 ].spread;
	GUN_LEVELS[ 1 ].spread = 0; // a perfectly laid gun, so the geometry is what is tested
	const { app, naval, features, events } = setup();
	const boat = app.boatCtl;
	boat.position.set( 0, 0, 450 );
	app.camera.position.set( 0, 4, 440 );
	const sloop = still( naval, 'sloop', 100, 450 );
	run( features, 0.2 );
	const fired = [];
	features.on( 'cannonFired', ( e ) => fired.push( e ) );
	ok( naval.fire( 'port' ) === false, 'no swivel gun yet: fire() refuses' );
	ok( app.toasts.some( ( t ) => /No gun - Captain Roid sells a swivel gun/.test( t ) ), 'and says so (where to get one)' );
	naval.playerGun.owned = true;
	const hp0 = sloop.hp;
	ok( naval.fire( 'port' ) === true && naval.balls.count === 1, 'with the gun owned a port shot leaves the muzzle' );
	ok( naval.fire( 'port' ) === false, 'the port gun is reloading' );
	ok( naval.reloadLeft.port > 3.9 && naval.reloadLeft.starboard === 0, 'reload is 4 s on the port gun only' );
	const ball = naval.balls.active[ 0 ];
	const muzzle = { x: ball.x, y: ball.y, z: ball.z };
	const horiz = Math.hypot( ball.vx, ball.vz );
	const elev = Math.atan2( ball.vy, horiz );
	const wantEl = solveElevation( MUZZLE_SPEED, Math.hypot( sloop.x - muzzle.x, sloop.z - muzzle.z ), sloop.cls.sheer * 0.4 - muzzle.y );
	ok( near( elev, wantEl, 0.004 ), `launch elevation ${ deg( elev ).toFixed( 2 ) } deg vs the solved ${ deg( wantEl ).toFixed( 2 ) } deg for the target 98 m away` );
	ok( ball.vx > 100 && Math.abs( ball.vz ) < 3, 'the shot goes out on the port side (+X)' );
	ok( fired.length === 1 && fired[ 0 ].by === 'player', 'cannonFired went out for the player (CameraFeel kicks from it)' );
	run( features, 1.4, 0.02 );
	ok( sloop.hp < hp0 && sloop.hp > hp0 - 21, `the ball hit the stationary sloop at 100 m: ${ hp0 } -> ${ sloop.hp.toFixed( 1 ) } hp` );
	ok( naval.stats.hits === 1 && naval.stats.shots === 1, 'stats count the shot and the hit' );
	ok( sloop.alertT > 40, 'a pirate hit by the player is alerted' );

	// 0 elevation at 100 m misses (falls short) and splashes
	const hpBefore = sloop.hp;
	naval.balls.spawn( { x: 1.5, y: 1, z: 450, vx: MUZZLE_SPEED, vy: 0, vz: 0, owner: 'player', faction: 'player', damage: 20 } );
	let splashes = naval.fx.counts.splash;
	run( features, 1.5, 0.02 );
	ok( sloop.hp === hpBefore && naval.fx.counts.splash === splashes + 1, 'a flat shot falls into the sea short of the target and splashes' );

	// reload completes after 4 s; starboard is independent
	run( features, 4, 0.05 );
	ok( naval.reloadLeft.port === 0, 'reloaded after 4 s' );
	ok( naval.fire( 'starboard' ) === true, 'the starboard gun fires independently (key X)' );
	// starboard shot with no target in the arc goes out to -X
	const b2 = naval.balls.active[ naval.balls.active.length - 1 ];
	ok( b2.vx < - 100, 'no target on that side: the ball goes out level to starboard (-X)' );
	GUN_LEVELS[ 1 ].spread = saved;

	// gun levels
	naval.playerGun.level = 3;
	ok( naval.reloadTime() === 2.8 && GUN_LEVELS[ 3 ].damage === 38, 'level 3 reloads in 2.8 s for 38 damage' );

	// target selection prefers pirates over a merchant in the arc, a far merchant is ignored
	const m2 = still( naval, 'trawler', 90, 440 );
	const m3 = still( naval, 'trawler', 250, 450 );
	sloop.hp = sloop.maxHp;
	naval.reloadLeft.port = 0;
	run( features, 0.05 );
	naval.fire( 'port' );
	const b3 = naval.balls.active[ naval.balls.active.length - 1 ];
	const aimTarget = sloop; // a ball aimed at the pirate flies past the nearer merchant (z offset 10 m: out of the arc)
	ok( b3.vx > 100 && Math.abs( Math.atan2( b3.vz, b3.vx ) ) < 0.1, 'pirate preferred as the auto-aim target' );
	void aimTarget; void m2; void m3;
	naval.balls.clear();
	for ( const s of naval.ships ) s.state = 'gone';
	run( features, 0.1 );

	// a ship carries its own battery: the sloop fires two balls a side (test/feature-ships.mjs has the full story)
	GUN_LEVELS[ 2 ].spread = 0;
	app.game.state.boat = 'sloop';
	app.boat.dimensions = { length: 14.4, beam: 5.2, draft: 1.4, freeboard: 3.0 };
	run( features, 0.2 );
	ok( naval.playerGun.builtIn && naval.playerGun.guns === 2 && naval.playerGun.bought === true && naval.playerGun.level >= 2, 'on the sloop: a built-in battery of 2 guns a side (the bought swivel stays bought)' );
	naval.reloadLeft.port = 0;
	const shots0 = naval.stats.shots;
	ok( naval.fire( 'port' ) === true, 'the sloop fires its port broadside' );
	run( features, 0.8, 0.02 );
	ok( naval.stats.shots - shots0 === 2 && Math.abs( naval.reloadTime() - GUN_LEVELS[ naval.playerGun.level ].reload * 1.12 ) < 1e-9, 'two balls leave the muzzles, the battery reloads 12 % slower than one gun' );
	GUN_LEVELS[ 2 ].spread = 0.018;
	app.game.state.boat = 'lobster';
	app.boat.dimensions = { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 };
	run( features, 0.2 );
	naval.balls.clear();

}

section( '8. damage, sinking, loot, events' );
{

	const { app, naval, features, events } = setup();
	const sloop = still( naval, 'sloop', 80, 450 );
	run( features, 0.1 );
	naval._shipHit( { owner: 'player', damage: 80, travelled: 0 }, sloop, 'hull', { x: 80, y: 1, z: 450 } );
	ok( sloop.hp === 40 && sloop.state === 'dock', 'a hit takes hull points off (120 -> 40)' );
	naval._shipHit( { owner: 'player', damage: 30, travelled: 400 }, sloop, 'rigging', { x: 80, y: 8, z: 450 } );
	ok( near( sloop.hp, 40 - 30 * 0.6 * 0.3, 1e-6 ) && sloop.rigging < 1, `damage falls off with range and a rigging hit mostly cuts speed (hp ${ sloop.hp.toFixed( 2 ) }, rigging ${ sloop.rigging.toFixed( 2 ) })` );
	naval._shipHit( { owner: 'player', damage: 100, travelled: 0 }, sloop, 'hull', { x: 80, y: 1, z: 450 } );
	ok( sloop.state === 'sinking', 'lethal hit sinks the sloop' );
	const sunk = events.filter( ( e ) => e[ 0 ] === 'shipSunk' );
	ok( sunk.length === 1 && sunk[ 0 ][ 1 ].id === sloop.id && sunk[ 0 ][ 1 ].faction === 'pirate' && sunk[ 0 ][ 1 ].byPlayer === true && near( sunk[ 0 ][ 1 ].x, sloop.x, 1e-6 ) && sunk[ 0 ][ 1 ].name === sloop.name, 'shipSunk { id, name, faction, x, z, byPlayer } is emitted once' );
	ok( events.some( ( e ) => e[ 0 ] === 'enemyDefeated' && e[ 1 ].kind === 'pirate' ), 'enemyDefeated is emitted for a pirate sunk by the player' );
	ok( naval.loot.list.length === SHIP_CLASSES.sloop.loot.crates, `${ naval.loot.list.length } loot crates float where she went down` );
	ok( naval.stats.shipsSunk === 1 && naval.stats.piratesSunk === 1, 'stats' );
	naval._shipHit( { owner: 'player', damage: 100, travelled: 0 }, sloop, 'hull', { x: 80, y: 1, z: 450 } );
	ok( events.filter( ( e ) => e[ 0 ] === 'shipSunk' ).length === 1, 'a ship already sinking is not sunk twice' );
	run( features, SINK_TIME + 0.5, 0.05 );
	ok( ! naval.ships.includes( sloop ), 'the wreck is despawned after the sinking animation' );

	// loot: sail over the crates (placed apart by hand so the pick-ups are told apart)
	ok( naval.loot.list.every( ( c ) => c.value >= 60 && c.value <= 110 ), 'each sloop crate is worth 60-110' );
	naval.loot.clear();
	const c1 = naval.loot.drop( 300, 450, 77, 'test' ), c2 = naval.loot.drop( 400, 450, 55, 'test' ), c3 = naval.loot.drop( 500, 450, 33, 'test' );
	c1.vx = c1.vz = c2.vx = c2.vz = c3.vx = c3.vz = 0;
	app.boatCtl.position.set( 300, 0, 450 );
	run( features, 0.1 );
	ok( app.game.state.money === 77 && naval.loot.list.length === 2, 'driving over a crate banks its $77' );
	ok( events.some( ( e ) => e[ 0 ] === 'lootCollected' && e[ 1 ].value === 77 ), 'lootCollected is emitted' );
	app.boatCtl.position.set( 0, 0, 0 );
	app.player.mode = 'swim'; app.player.position.set( 401, 0, 450 );
	run( features, 0.1 );
	ok( app.game.state.money === 77 + 55 && naval.loot.list.length === 1, 'a swimmer picks up a crate too' );
	app.player.mode = 'boat';
	run( features, LOOT_LIFE + 1, 0.1 );
	ok( naval.loot.list.length === 0 && app.game.state.money === 77 + 55, `an uncollected crate sinks after ${ LOOT_LIFE } s` );

	// a merchant sunk by a pirate ball is not "by player"; merchants drop trawler loot and get replaced later
	const { naval: n2, features: f2, events: e2 } = setup( { settings: { autoSpawn: true, maxPirates: 0, merchants: 1 } } );
	run( f2, 3, 0.1 );
	const tr = n2.merchants[ 0 ];
	n2._shipHit( { owner: 'sloop-9', damage: 999, travelled: 0 }, tr, 'hull', { x: tr.x, y: 1, z: tr.z } );
	const ev = e2.find( ( e ) => e[ 0 ] === 'shipSunk' );
	ok( ev && ev[ 1 ].faction === 'merchant' && ev[ 1 ].byPlayer === false && ! e2.some( ( e ) => e[ 0 ] === 'enemyDefeated' ), 'a merchant sunk by someone else: faction merchant, byPlayer false, no enemyDefeated' );
	run( f2, 236, 0.1 );
	ok( n2.merchants.filter( ( s ) => s.alive ).length === 0, 'no replacement within the first 4 minutes' );
	run( f2, 14, 0.1 );
	ok( n2.merchants.filter( ( s ) => s.alive ).length === 1, 'the merchant is replaced 4 minutes later' );

}

section( '9. the player\'s hull' );
{

	const { app, naval, features, events } = setup();
	const h = naval.playerHull;
	ok( h.max === hullMaxFor( 'lobster' ) && h.hp === h.max, `lobster boat hull ${ h.max } hp` );
	ok( hullMaxFor( 'skiff' ) < hullMaxFor( 'canoe' ) && hullMaxFor( 'canoe' ) < hullMaxFor( 'cutter' ) && hullMaxFor( 'cutter' ) < hullMaxFor( 'launch' ) && hullMaxFor( 'launch' ) < hullMaxFor( 'lobster' ), 'hull points grow with the boat class: ' + [ 'skiff', 'canoe', 'cutter', 'launch', 'lobster' ].map( hullMaxFor ).join( ' < ' ) );
	ok( naval.speedFactor === 1, 'full speed at full hull' );

	// a pirate ball into the box
	const shoot = ( dmg = 26 ) => naval.balls.spawn( { x: 20, y: 0.9, z: 450, vx: - MUZZLE_SPEED, vy: 0, vz: 0, owner: 'sloop-1', faction: 'pirate', damage: dmg } );
	app.boatCtl.position.set( 0, 0, 450 );
	shoot();
	run( features, 0.3, 0.02 );
	ok( near( h.hp, h.max - 26, 0.6 ) && h.hp > h.max - 26, `a pirate ball took 26 hp less the range falloff (${ h.hp.toFixed( 2 ) } of ${ h.max })` );
	const dmgEv = events.filter( ( e ) => e[ 0 ] === 'playerBoatDamaged' );
	ok( dmgEv.length === 1 && near( dmgEv[ 0 ][ 1 ].hp, h.hp, 0.06 ) && dmgEv[ 0 ][ 1 ].maxHp === h.max && /cannon/.test( dmgEv[ 0 ][ 1 ].cause ), 'playerBoatDamaged { hp, maxHp, cause }' );
	ok( app.kicks.includes( 'snap' ), 'the camera snaps on a hit' );

	// the balls of a ship's own faction pass through; the player's own balls never hit the player
	const before = h.hp;
	naval.balls.spawn( { x: 20, y: 0.9, z: 450, vx: - MUZZLE_SPEED, vy: 0, vz: 0, owner: 'player', faction: 'player', damage: 99 } );
	run( features, 0.3, 0.02 );
	ok( h.hp === before, 'the player\'s own ball does not hurt the player' );
	// a miss 5 m wide
	naval.balls.spawn( { x: 20, y: 0.9, z: 458, vx: - MUZZLE_SPEED, vy: 0, vz: 0, owner: 'sloop-1', faction: 'pirate', damage: 26 } );
	run( features, 0.4, 0.02 );
	ok( h.hp === before, 'a ball passing 8 m abeam misses' );

	// slowed as the hull goes
	h.hp = h.max * 0.5;
	ok( naval.speedFactor === 1, 'speed factor stays 1 down to half the hull' );
	h.hp = h.max * 0.25;
	ok( near( naval.speedFactor, 0.675, 1e-9 ), `quarter hull: speed factor ${ naval.speedFactor }` );
	h.hp = 1;
	ok( naval.speedFactor < 0.4 && naval.speedFactor > 0.34, `nearly sunk: speed factor ${ naval.speedFactor.toFixed( 3 ) }` );

	// sinking
	h.hp = 20;
	events.length = 0;
	shoot( 30 );
	run( features, 0.3, 0.02 );
	ok( h.sunk && h.hp === 0 && naval.speedFactor === 0, 'at 0 the boat is sunk (speed factor 0)' );
	ok( events.filter( ( e ) => e[ 0 ] === 'playerBoatSunk' ).length === 1, 'playerBoatSunk is emitted once' );
	shoot( 30 );
	run( features, 0.3, 0.02 );
	ok( events.filter( ( e ) => e[ 0 ] === 'playerBoatSunk' ).length === 1 && naval.target.ok === false, 'a sunk boat is no target and cannot sink twice' );
	ok( naval.fire( 'port' ) === false, 'and cannot fire' );
	// (wave 4) she goes down over SINK_TIME and becomes a wreck: no repair, only salvage
	const sunkEv = events.find( ( e ) => e[ 0 ] === 'playerBoatSunk' );
	ok( sunkEv && sunkEv[ 1 ].aboard === true && sunkEv[ 1 ].boat === 'lobster' && Number.isFinite( sunkEv[ 1 ].x ), 'playerBoatSunk { aboard, boat, x, z }' );
	ok( naval.sinking && app.player.mode === 'swim', 'she is sinking and the helmsman went overboard' );
	app.game.state.money = 1000;
	ok( naval.repair() === false && h.sunk, 'no repair while she goes down' );
	ok( naval.rescue() === false && h.sunk, 'no rescue either' );
	run( features, SINK_TIME + 0.5, 0.05 );
	ok( ! naval.sinking && naval.wreck && naval.wreck.boat === 'lobster', 'after SINK_TIME she is a wreck' );
	ok( naval.salvageCost() === 2250 && naval.repair() === false, `salvage costs $${ naval.salvageCost() } (25 % of the lobster boat's $9,000); repair refuses` );
	app.game.state.money = 5;
	ok( naval.salvage() === false && naval.wreck, '$5 cannot raise her' );
	app.game.state.money = 3000;
	ok( naval.salvage() === true && ! naval.wreck && h.hp === h.max && ! h.sunk && app.game.state.money === 750, 'salvage pays, raises her and restores the hull' );
	h.hp = 100;
	ok( naval.repairCost() === Math.ceil( ( h.max - 100 ) * 2 ) && naval.repair() === true && h.hp === h.max && app.game.state.money === 750 - Math.ceil( ( 264 - 100 ) * 2 ), 'repair pays and restores a damaged hull' );
	h.hp = 10;
	h.sunk = true;
	naval.rescue();
	ok( h.hp >= h.max * 0.25 && ! h.sunk, 'rescue() floats a (pre-wreck save) sunk boat again at a quarter hull' );
	app.player.mode = 'boat';

	// a new boat arrives undamaged with its own class hull
	app.game.state.boat = 'skiff';
	run( features, 0.1 );
	ok( h.boat === 'skiff' && h.max === hullMaxFor( 'skiff' ) && h.hp === h.max, `switching to the skiff: ${ h.hp }/${ h.max }` );

	// the ships carry more hull than any small boat (the catalog's hp)
	ok( [ 'trawler', 'sloop', 'brigantine' ].every( ( id ) => hullMaxFor( id ) > hullMaxFor( 'lobster' ) ) && hullMaxFor( 'brigantine' ) === 760, 'ship hulls: ' + [ 'sloop', 'trawler', 'brigantine' ].map( hullMaxFor ).join( ', ' ) + ' hp' );
	app.game.state.boat = 'brigantine';
	run( features, 0.1 );
	ok( h.boat === 'brigantine' && h.max === 760 && h.hp === 760, 'a new brigantine arrives with 760 hull points' );
	app.game.state.boat = 'skiff';
	run( features, 0.1 );

	// grounding damage from outside
	naval.damagePlayer( 10, 'rocks' );
	ok( h.hp === h.max - 10 && events.some( ( e ) => e[ 0 ] === 'playerBoatDamaged' && e[ 1 ].cause === 'rocks' ), 'damagePlayer( amount, cause ) for the integrator' );

}

// ================================================================================================ 10. engagement
section( '10. a pirate hunts the player (patrol -> chase -> broadside)' );
{

	const { app, naval, features, events } = setup( { seed: 11 } );
	app.boatCtl.position.set( - 50, 0, 700 ); // (wave 15C: the open sea starts 450 m off the home dock)
	const pirate = naval.spawn( 'sloop', { x: 200, z: 720, yaw: - Math.PI / 2, route: PATROLS[ 0 ], loop: true, index: 3, speed: 4 } );
	const states = new Set();
	let fired = 0, closest = 1e9, highest = - 1e9, ballsFiredByPirate = 0;
	const spawn0 = naval.balls.spawn.bind( naval.balls );
	naval.balls.spawn = ( b ) => { if ( b.owner === pirate.id ) ballsFiredByPirate ++; return spawn0( b ); };
	const ranges = [];
	run( features, 160, 0.05, () => {

		states.add( pirate.state );
		if ( pirate.state === 'broadside' ) ranges.push( Math.hypot( pirate.x + 50, pirate.z - 700 ) );
		closest = Math.min( closest, Math.hypot( pirate.x + 50, pirate.z - 700 ) );
		highest = Math.max( highest, terrain.heightAt( pirate.x, pirate.z ) );
		if ( app.boatCtl.position.x !== - 50 ) app.boatCtl.position.set( - 50, 0, 700 );
		if ( naval.playerHull.sunk ) return false;

	} );
	ok( states.has( 'chase' ) && states.has( 'broadside' ), `the pirate went through ${ [ ...states ] }` );
	ok( ballsFiredByPirate >= 2, `${ ballsFiredByPirate } balls fired at the player` );
	const inBand = ranges.filter( ( r ) => r > 40 && r < 190 ).length / Math.max( 1, ranges.length );
	ok( ranges.length > 20 && inBand > 0.9, `in the broadside state she holds ${ ( inBand * 100 ).toFixed( 0 ) } % of the time between 40 and 190 m (closest ${ closest.toFixed( 0 ) } m)` );
	ok( highest < - 2.5, `and stayed afloat in deep water (shallowest ${ highest.toFixed( 1 ) } m)` );
	ok( naval.playerHull.hp < naval.playerHull.max || events.some( ( e ) => e[ 0 ] === 'playerBoatDamaged' ), `the player's hull took hits: ${ naval.playerHull.hp.toFixed( 0 ) }/${ naval.playerHull.max }` );

	// the harbour is a safe zone: a pirate 100 m from the player at the berth stays on patrol and never fires
	const h = setup( { seed: 5 } );
	h.app.boatCtl.position.copy( WORLD.boatDock.position );
	h.app.boatCtl.moored = false;
	const p2 = h.naval.spawn( 'sloop', { x: 80, z: 160, yaw: 0, route: PATROLS[ 0 ], loop: true, index: 3 } );
	let any = 0;
	const sp = h.naval.balls.spawn.bind( h.naval.balls );
	h.naval.balls.spawn = ( b ) => { any ++; return sp( b ); };
	h.app.camera.position.set( 64, 4, 40 );
	run( h.features, 40, 0.05, () => { if ( p2.state === 'chase' || p2.state === 'broadside' ) any += 100; } );
	ok( ! h.naval.target.ok && h.naval.target.safe && any === 0, 'inside the harbour zone the player is not a target' );

	// a moored boat is not a target either, even in open water
	const m = setup( { seed: 5 } );
	m.app.boatCtl.moored = true; m.app.boatCtl.driven = false;
	run( m.features, 0.1 );
	ok( m.naval.target.ok === false, 'a boat tied up is not a target' );

	// flee: a crippled pirate runs and escapes
	const f = setup( { seed: 3 } );
	f.app.boatCtl.position.set( - 50, 0, 700 );
	const p3 = f.naval.spawn( 'sloop', { x: 100, z: 700, yaw: 0, route: PATROLS[ 0 ], loop: true, index: 3, speed: 6, hp: 20 } );
	p3.alertT = 40;
	let fled = false;
	run( f.features, 200, 0.05, () => { if ( p3.state === 'flee' ) fled = true; return ! ( p3.escaped ); } );
	ok( fled && p3.escaped && ! f.naval.ships.includes( p3 ), 'a pirate at 17 % hull flees and is gone beyond 650 m' );

}

// ================================================================================================ 11. spawning
section( '11. night and storm spawns' );
{

	const weather = { current: { kind: 'clear' } };
	const app = makeApp();
	const { naval, features } = setup( { app, settings: { autoSpawn: true }, seed: 21 } );
	features.list.set( 'weather', { instance: weather } );
	ok( naval.wantedPirates() === 1, 'one pirate by day in clear weather' );
	app.settings.timeOfDay = 23;
	ok( naval.wantedPirates() === 2, 'two at night' );
	weather.current.kind = 'storm';
	ok( naval.wantedPirates() === 3, 'three at night in a storm' );
	app.settings.timeOfDay = 12;
	ok( naval.wantedPirates() === 2, 'two by day in a storm' );
	weather.current.kind = 'rain';
	ok( naval.wantedPirates() === 1, 'rain does not add one' );
	weather.current.kind = 'storm';
	app.settings.timeOfDay = 23;
	run( features, 90, 0.1 );
	const alive = naval.pirates.filter( ( s ) => s.alive );
	ok( alive.length === 3 && naval.merchants.length === 2, `pirates ${ alive.length } (the night + storm cap), merchants ${ naval.merchants.length }` );
	ok( alive.some( ( s ) => s.kind === 'brigantine' ) || alive.length === 3, 'a brigantine may join the sloops: ' + alive.map( ( s ) => s.kind ) );
	const cam = app.camera.position;
	ok( alive.every( ( s ) => terrain.heightAt( s.x, s.z ) < - 3 ), 'all of them float in deep water' );
	// dawn: the surplus slips away once nobody can see it
	app.settings.timeOfDay = 12;
	weather.current.kind = 'clear';
	app.camera.position.set( - 800, 4, 0 );
	app.boatCtl.position.set( - 800, 0, 0 );
	run( features, 20, 0.1 );
	ok( naval.pirates.filter( ( s ) => s.alive ).length <= 2, 'at dawn the surplus pirates leave' );
	void cam;

	// no pop-in: nothing spawns within 300 m of the camera
	const e = setup( { seed: 4, settings: { autoSpawn: false } } );
	e.app.camera.position.set( 0, 4, 550 );
	e.app.boatCtl.position.set( 0, 0, 550 );
	for ( let i = 0; i < 6; i ++ ) {

		const p = e.naval.spawnPirate();
		if ( p ) ok( Math.hypot( p.x - 0, p.z - 550 ) >= 300, `pirate ${ i } spawned ${ Math.hypot( p.x, p.z - 550 ).toFixed( 0 ) } m from the camera` );

	}

	// multiplayer: the ships are local, so the module idles
	const mp = setup( { app: makeApp( { mode: 'multiplayer' } ), settings: { autoSpawn: true } } );
	run( mp.features, 5, 0.1 );
	ok( mp.naval.active === false && mp.naval.ships.length === 0, 'in Multiplayer the module is inactive (no local-only pirates)' );

}

// ---- bounty contracts from the notices feature
section( '11b. bounty contracts (bountyAccepted -> the named pirate)' );
{

	const app = makeApp();
	const { naval, features, events } = setup( { app, seed: 33, settings: { autoSpawn: true } } );
	const cancelled = [];
	features.on( 'bountyCancelled', ( e ) => cancelled.push( e ) );
	// a region on the home shoals: the spawn must move to deep water
	const payload = { id: 'b-1', target: 'Sable Orrow, the Salt Wolf', tier: 3, region: { x: 20, z: 60 }, captain: 'Sable Orrow', epithet: 'the Salt Wolf', ship: 'Hollow Gull', craft: 'a brigantine', port: 'home', expires: 99 };
	features.emit( 'bountyAccepted', payload );
	const t = naval.ships.find( ( s ) => s.bounty );
	ok( !! t && t.kind === 'brigantine' && t.name === 'Hollow Gull' && t.captain === 'Sable Orrow', 'tier 3: the named brigantine is spawned at once' );
	ok( terrain.heightAt( t.x, t.z ) < - 6 && ! inSafeZone( t.x, t.z ), `she floats in deep water (${ terrain.heightAt( t.x, t.z ).toFixed( 1 ) } m) even though the region was a shoal` );
	features.emit( 'bountyAccepted', { ...payload, resumed: true } );
	ok( naval.ships.filter( ( s ) => s.bounty ).length === 1, 'a resumed contract does not spawn a second ship' );
	run( features, 30, 0.1 );
	ok( naval.pirates.filter( ( s ) => ! s.bounty && s.alive ).length === 1 || naval.pirates.filter( ( s ) => ! s.bounty && s.alive ).length === 0, 'the bounty ship is not counted among the ambient pirates' );
	ok( terrain.heightAt( t.x, t.z ) < - 3, 'and she keeps to deep water while patrolling' );

	// a region far out at sea: spawned right there
	const far = setup( { app: makeApp(), seed: 5, settings: { autoSpawn: false } } );
	far.features.emit( 'bountyAccepted', { id: 'b-2', target: 'Dread Mallory, the Black', tier: 1, region: { x: - 100, z: 640 }, captain: 'Dread Mallory', ship: 'Night Heron' } );
	const f2 = far.naval.ships.find( ( s ) => s.bounty );
	ok( f2 && f2.kind === 'sloop' && Math.hypot( f2.x + 100, f2.z - 640 ) < 100, 'tier 1: a sloop at the region' );
	ok( f2.maxHp > SHIP_CLASSES.sloop.hp - 1 && f2.fleeAt === 0, 'tougher than an ordinary sloop, and never flees' );

	// sinking him emits shipSunk under the contract's target name (what the notices feature matches)
	t.hp = 1;
	t.damage( 50, { part: 'hull', by: 'player' } );
	naval._onSunk( t, true );
	const sunk = events.find( ( e ) => e[ 0 ] === 'shipSunk' && e[ 1 ].bountyId === 'b-1' );
	ok( sunk && sunk[ 1 ].name === 'Sable Orrow, the Salt Wolf' && sunk[ 1 ].captain === 'Sable Orrow' && sunk[ 1 ].byPlayer === true && sunk[ 1 ].faction === 'pirate', 'shipSunk names the bounty target (name / target / captain / bountyId)' );
	ok( ! naval.bounties.has( 'b-1' ), 'the contract is closed' );
	run( features, 10, 0.1 );
	ok( ! naval.ships.some( ( s ) => s.bounty && s.alive ), 'no replacement is spawned' );

	// cancelled: released, the ship sails away
	features.emit( 'bountyAccepted', { ...payload, id: 'b-3' } );
	ok( naval.ships.some( ( s ) => s.bounty && s.bounty.id === 'b-3' ), 'a second contract spawns' );
	features.emit( 'bountyCancelled', { id: 'b-3', target: payload.target, reason: 'abandoned' } );
	run( features, 1, 0.1 );
	ok( ! naval.ships.some( ( s ) => s.bounty && s.bounty.id === 'b-3' ) && ! naval.bounties.has( 'b-3' ), 'cancelling the contract releases the ship' );

	// a cleared world (module idle, e.g. Multiplayer) respawns the target when it is active again
	const k = setup( { app: makeApp(), seed: 8, settings: { autoSpawn: true } } );
	k.features.emit( 'bountyAccepted', { id: 'b-4', target: 'Tam Vane, the Gull', tier: 2, region: { x: 0, z: 600 }, captain: 'Tam Vane', ship: 'Salt Widow' } );
	k.naval._clearWorld();
	ok( ! k.naval.ships.some( ( s ) => s.bounty ), 'world cleared' );
	run( k.features, 6, 0.1 );
	ok( k.naval.ships.some( ( s ) => s.bounty && s.bounty.id === 'b-4' ), 'the contract target is back on the water' );
	const t2 = k.naval.ships.find( ( s ) => s.bounty );
	t2.dmgMul = 1;
	// a fleeing bounty ship does not escape
	t2.setState( 'flee' );
	k.naval._escape( t2 );
	ok( t2.alive && t2.state === 'patrol' && ! t2.escaped, 'a contract target never escapes' );
	// a malformed payload is ignored
	k.features.emit( 'bountyAccepted', { id: 'x' } );
	k.features.emit( 'bountyAccepted', null );
	ok( k.naval.bounties.size === 1, 'malformed payloads are ignored' );
	k.naval.reset();
	ok( k.naval.bounties.size === 0, 'reset() forgets the contracts' );
	k.naval.dispose();
	k.features.emit( 'bountyAccepted', { id: 'z', target: 't', region: { x: 0, z: 600 } } );
	ok( k.naval.bounties.size === 0, 'dispose() unsubscribes' );

}

// ================================================================================================ 12. water pool
section( '12. heave, pitch and roll from the water queries' );
{

	class FakeQuery {

		constructor( fn, delay = 2 ) {

			this.fn = fn; this.delay = delay;
			this.inputs = new Float32Array( 256 ); this.cpu = new Float32Array( 256 ); this.resultInputs = new Float32Array( 256 );
			this.count = 1; this.slots = new Map(); this.cpuValid = false; this.version = 0; this.latency = 0.05; this.q = [];

		}

		allocate( name, n ) {

			if ( this.slots.has( name ) ) return this.slots.get( name );
			const start = this.count;
			if ( start + n > 64 ) throw new Error( 'WaterQuery: out of slots' );
			this.slots.set( name, start ); this.count += n; return start;

		}

		setPoint( i, x, z ) { this.inputs[ i * 4 ] = x; this.inputs[ i * 4 + 1 ] = z; }

		update() {

			this.q.push( this.inputs.slice() );
			if ( this.q.length <= this.delay ) return;
			const snap = this.q.shift();
			for ( let i = 0; i < 64; i ++ ) this.cpu[ i * 4 ] = this.fn( snap[ i * 4 ], snap[ i * 4 + 1 ] );
			this.resultInputs.set( snap );
			this.cpuValid = true; this.version ++;

		}

	}

	const field = ( x, z ) => 0.4 + 0.02 * ( z - 300 ) + 0.03 * x;
	const query = new FakeQuery( field );
	const { naval, features, app } = setup( { app: makeApp( { query }, ), extra: {} } );
	ok( query.slots.has( 'naval' ) && naval.pool.ready, 'the pool allocated its slots (12) from the WaterQuery' );
	app.boatCtl.position.set( 0, 0, 0 );
	app.camera.position.set( 0, 4, 280 );
	const s = still( naval, 'sloop', 0, 300, 0 );
	const frame = ( dt = 0.05 ) => { features.update( dt ); query.update(); };
	frame();
	ok( s.poolGroup === 0, 'the nearest ship got slot group 0' );
	for ( let i = 0; i < 80; i ++ ) frame();
	ok( near( s.pose.y, 0.4, 0.03 ), `heave follows the mean water height (${ s.pose.y.toFixed( 3 ) } m, field mean 0.4)` );
	const fp = s.finalPose( {} );
	ok( fp.pitch > 0.012 && fp.pitch < 0.03, `bow up on a rising swell: pitch ${ deg( fp.pitch ).toFixed( 2 ) } deg` );
	ok( fp.roll > 0.02 && fp.roll < 0.04, `port side up where the water is higher to port: roll ${ deg( fp.roll ).toFixed( 2 ) } deg` );
	const exp = poseFromHeights( 0.4 + 0.02 * 5.184, 0.4 - 0.02 * 5.184, 0.4 + 0.03 * 2.184, 0.4 - 0.03 * 2.184, s.cls, {} );
	ok( near( exp.pitch, s.pose.tpitch, 1e-3 ) && near( exp.roll, s.pose.troll, 1e-3 ), 'the pose targets equal the formula on the four sample heights' );

	// capacity: five ships, three slot groups; the nearest three win; stale slots are not trusted
	const ships = [ 300, 330, 360, 390, 420 ].map( ( z ) => still( naval, 'trawler', 40, z, 0 ) );
	ships.push( s );
	for ( let i = 0; i < 4; i ++ ) frame();
	const withSlots = naval.ships.filter( ( x ) => x.poolGroup >= 0 );
	ok( withSlots.length === 3, `only 3 of ${ naval.ships.length } ships hold query slots` );
	const nearest = [ ...naval.ships ].sort( ( a, b ) => a.dist - b.dist ).slice( 0, 3 );
	ok( nearest.every( ( x ) => x.poolGroup >= 0 ), 'and they are the nearest three' );
	// hand a group to a different ship: its first read must be refused until its own points came back
	const pool = naval.pool;
	const victim = naval.ships.find( ( x ) => x.poolGroup < 0 );
	const donor = withSlots[ 2 ];
	pool.release( donor );
	pool.owner[ 2 ] = victim; victim.poolGroup = 2;
	pool.issued.fill( NaN, 2 * 8, 3 * 8 );
	ok( pool.read( victim ) === false, 'a group that changed hands is not read until its own result arrives' );
	pool.queue( victim );
	query.q.length = 0;
	for ( let i = 0; i < 4; i ++ ) { pool.queue( victim ); query.update(); }
	ok( pool.read( victim ) === true, 'and is read once the result computed at its points arrives' );
	// far ships get no slot and a procedural pose
	const far = still( naval, 'trawler', 40, 2000, 0 );
	app.camera.position.set( 0, 4, 280 );
	for ( let i = 0; i < 3; i ++ ) frame();
	ok( far.poolGroup < 0 && far._far === true, 'a ship 1.7 km away is skipped (no slot, no pose update)' );

	// no WaterQuery at all: the procedural swell still moves the hull
	const p = setup();
	p.app.camera.position.set( 0, 4, 440 );
	const s2 = still( p.naval, 'sloop', 0, 450, 0 );
	const ys = new Set();
	for ( let i = 0; i < 100; i ++ ) { p.features.update( 0.1 ); ys.add( s2.pose.y.toFixed( 3 ) ); }
	ok( ys.size > 20 && Math.abs( s2.pose.y ) < 0.5, 'without a WaterQuery the procedural swell heaves the ship by a few decimetres' );

}

// ================================================================================================ 13. save
section( '13. save round trip' );
{

	const { naval, app } = setup();
	naval.playerHull.hp = 123.4;
	naval.playerGun.owned = true;
	naval.playerGun.level = 2;
	naval.stats.piratesSunk = 3;
	naval.stats.looted = 456;
	const json = JSON.parse( JSON.stringify( naval.toJSON() ) );
	ok( json.v === 1 && json.hp === 123.4 && json.gun.owned === true && json.gun.level === 2 && json.boat === 'lobster', 'toJSON: ' + JSON.stringify( json ) );
	const b = setup();
	b.naval.fromJSON( json );
	ok( b.naval.playerHull.hp === 123.4 && b.naval.playerGun.owned && b.naval.playerGun.level === 2 && b.naval.stats.piratesSunk === 3 && b.naval.stats.looted === 456, 'fromJSON restores hull, gun and stats' );
	b.features.update( 0.05 );
	ok( b.naval.playerHull.hp === 123.4, 'the hull keeps its damage after the first frame (same boat)' );

	// via the registry: Features.toJSON / fromJSON carry it under 'naval'
	const reg = b.features.toJSON();
	ok( reg.naval && reg.naval.hp === 123.4, 'Features.toJSON() has the naval part' );
	const c = setup();
	c.features.fromJSON( JSON.parse( JSON.stringify( reg ) ) );
	ok( c.naval.playerHull.hp === 123.4 && c.naval.playerGun.owned, 'Features.fromJSON() hands it back' );

	// garbage
	const g = setup();
	g.naval.fromJSON( null );
	g.naval.fromJSON( 'x' );
	g.naval.fromJSON( { hp: 'lots', gun: 5, boat: 'battleship', stats: { shots: - 4, hits: 'x' } } );
	ok( g.naval.playerHull.hp === g.naval.playerHull.max && g.naval.playerGun.owned === false && g.naval.playerGun.level === 1 && g.naval.stats.shots === 0, 'garbage saves fall back to defaults' );
	g.naval.fromJSON( { boat: 'skiff', hp: 9999, gun: { owned: true, level: 99 } } );
	ok( g.naval.playerHull.max === hullMaxFor( 'skiff' ) && g.naval.playerHull.hp === g.naval.playerHull.max && g.naval.playerGun.level === 3, 'hp and level are clamped' );
	g.naval.fromJSON( { boat: 'lobster', hp: 0 } );
	ok( g.naval.playerHull.sunk === true && g.naval.speedFactor === 0, 'a save with 0 hp is a sunk boat until repaired' );
	g.naval.reset();
	ok( g.naval.playerHull.hp === g.naval.playerHull.max && ! g.naval.playerHull.sunk && ! g.naval.playerGun.owned && g.naval.ships.length === 0, 'reset() starts a new game' );

}

// ================================================================================================ 14. HUD
section( '14. HUD: arrows, model, DOM' );
{

	const cam = { position: new Vector3( 0, 5, 0 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 };
	// identity quaternion: looking down -Z, +X to the right
	let a = arrowFor( cam, { x: 0, y: 3, z: - 100 } );
	ok( a.visible && near( a.x, 0.5, 0.01 ), 'straight ahead is on screen' );
	a = arrowFor( cam, { x: 200, y: 3, z: - 20 } );
	ok( ! a.visible && a.x > 0.9 && near( a.angle, Math.PI / 2, 0.15 ), `far to the right: arrow at the right edge (x ${ a.x.toFixed( 2 ) }), pointing right (${ a.angle.toFixed( 2 ) } rad)` );
	a = arrowFor( cam, { x: - 200, y: 3, z: - 20 } );
	ok( ! a.visible && a.x < 0.1 && near( a.angle, - Math.PI / 2, 0.15 ), 'far to the left: left edge' );
	a = arrowFor( cam, { x: 0, y: 3, z: 100 } );
	ok( ! a.visible && a.behind && a.y > 0.5, 'behind the camera: an arrow at the bottom edge' );
	const yawed = { ...cam, quaternion: new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), - Math.PI / 2 ) }; // looking along +X
	a = arrowFor( yawed, { x: 100, y: 3, z: 0 } );
	ok( a.visible, 'the camera quaternion is honoured (turned to look at +X)' );

	// the model: pirates within 400 m and off screen only
	const { naval, app } = setup( { extra: { hud: false } } );
	app.camera.quaternion.copy( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), Math.PI ) ); // looking +Z
	app.camera.position.set( - 50, 4, 440 );
	const near1 = still( naval, 'sloop', - 50, 500, 0 ); // 50 m ahead of a camera looking +Z: on screen
	const near2 = still( naval, 'sloop', - 250, 400, 0 ); // off screen to the left? (behind the camera's left)
	const far1 = still( naval, 'sloop', 400, 450, 0 ); // 450 m: out of range
	const tr = still( naval, 'trawler', - 100, 420, 0 ); // not a pirate
	naval.playerGun.owned = true;
	naval.reloadLeft.port = 2;
	for ( const s of naval.ships ) s.dist = 0;
	const model = hudModel( naval );
	ok( model.visible && model.hull.hp === 264 && model.hull.max === 264 && ! model.hull.low, 'the model shows the hull at the helm' );
	ok( model.guns[ 0 ].key === 'Z' && model.guns[ 1 ].key === 'X' && near( model.guns[ 0 ].frac, 0.5, 1e-9 ) && ! model.guns[ 0 ].ready && model.guns[ 1 ].ready, 'reload fractions: port half-way (Z), starboard ready (X)' );
	ok( model.arrows.length === 1 && model.arrows[ 0 ].id === near2.id, `one arrow: the off-screen pirate within 400 m (${ model.arrows.map( ( x ) => x.name + ' ' + x.dist + ' m' ) })` );
	void near1; void far1; void tr;
	app.player.mode = 'walk';
	ok( hudModel( naval ).visible === false, 'hidden when not at the helm' );
	naval.playerHull.hp = 50;
	app.player.mode = 'boat';
	ok( hudModel( naval ).hull.low === true, 'the hull bar turns red below a third' );

	// the DOM (a stand-in): class prefix nv-, content follows the model
	const mkDoc = () => {

		const mk = ( tag ) => {

			const e = { tag, style: {}, children: [], classes: new Set(), parent: null, _text: '' };
			Object.defineProperty( e, 'className', { set( v ) { e.classes = new Set( String( v ).split( /\s+/ ).filter( Boolean ) ); }, get() { return [ ...e.classes ].join( ' ' ); } } );
			Object.defineProperty( e, 'textContent', { set( v ) { e._text = String( v ); }, get() { return e._text; } } );
			e.classList = { add: ( c ) => e.classes.add( c ), remove: ( c ) => e.classes.delete( c ), contains: ( c ) => e.classes.has( c ), toggle: ( c, f ) => { if ( f === undefined ? ! e.classes.has( c ) : f ) e.classes.add( c ); else e.classes.delete( c ); } };
			e.append = ( ...k ) => { for ( const c of k ) { e.children.push( c ); c.parent = e; } };
			e.remove = () => { if ( e.parent ) e.parent.children = e.parent.children.filter( ( c ) => c !== e ); e.parent = null; };
			return e;

		};

		return { createElement: mk, head: mk( 'head' ), body: mk( 'body' ) };

	};

	const doc = mkDoc();
	const hud = new NavalHud( { doc } );
	let all = [];
	const walk = ( e ) => { all.push( e ); e.children.forEach( walk ); };
	const collect = () => { all = []; walk( doc.body ); };
	collect();
	ok( doc.head.children.length === 1 && /\.nv-root/.test( doc.head.children[ 0 ].textContent ), 'the stylesheet is injected once' );
	new NavalHud( { doc: mkDoc() } ).dispose();
	ok( all.filter( ( e ) => e.classes.has( 'nv-root' ) ).length === 1, 'one nv-root' );
	const m = hudModel( naval );
	naval.playerGun.owned = true;
	hud.update( { ...m, visible: true, hull: { hp: 100, max: 264, frac: 100 / 264, low: false, sunk: false }, guns: [ { side: 'port', key: 'Z', owned: true, ready: false, frac: 0.25 }, { side: 'starboard', key: 'X', owned: false, ready: true, frac: 1 } ], arrows: [ { id: 'a', name: 'sloop', dist: 321, x: 0.93, y: 0.4, angle: 1.4, hunting: true } ] }, 0.016 );
	collect();
	const byClass = ( c ) => ( collect(), all.filter( ( e ) => e.classes.has( c ) ) );
	const root1 = byClass( 'nv-root' )[ 0 ];
	ok( root1.classes.has( 'is-on' ), 'the panel shows at the helm' );
	const num = byClass( 'nv-num' )[ 0 ];
	ok( num.textContent === '100', 'hull number' );
	ok( byClass( 'nv-gun' )[ 1 ].classes.has( 'is-off' ) && ! byClass( 'nv-gun' )[ 0 ].classes.has( 'is-off' ), 'the gun that is not owned is hidden' );
	const arrow = byClass( 'nv-arrow' )[ 0 ];
	ok( arrow && arrow.style.left === '93.0%' && /321 m/.test( arrow.children[ 1 ].textContent ) && arrow.classes.has( 'is-hunting' ), 'the arrow sits at the screen edge with its distance' );
	hud.update( { ...m, visible: true, arrows: [] }, 0.016 );
	ok( byClass( 'nv-arrow' ).length === 0 || ! hud.arrows.size, 'an arrow goes when its pirate does' );
	hud.hitMarker( 'sunk' );
	hud.update( { ...m, visible: false, arrows: [] }, 0.05 );
	ok( ! root1.classes.has( 'is-on' ) && Number( byClass( 'nv-hit' )[ 0 ].style.opacity ) > 0.5, 'the panel hides off the helm; the hit marker flashes' );
	hud.damageFrom( 1.0 );
	hud.update( { ...m, visible: false, arrows: [] }, 0.05 );
	ok( Number( byClass( 'nv-dmg' )[ 0 ].style.opacity ) > 0.9, 'the damage wedge flashes' );
	hud.dispose();

}

// ================================================================================================ 15. registry, keys, audio
section( '15. registry integration, keys, audio' );
{

	const app = makeApp();
	const features = new Features( app );
	features.claimKey( 'KeyQ', 'melee' );
	const instance = features.add( 'naval', navalModule );
	ok( instance instanceof Naval && features.get( 'naval' ) === instance, 'features.add( "naval", module ) installs it' );
	ok( features._keys.get( 'KeyZ' ) === 'naval' && features._keys.get( 'KeyX' ) === 'naval' && instance.keys.port && instance.keys.starboard, 'Z and X are claimed' );
	const other = new Features( app );
	other.claimKey( 'KeyZ', 'melee' );
	const second = other.add( 'naval', navalModule );
	ok( second.keys.port === false && second.keys.starboard === true, 'when another feature already holds Z, naval leaves that key alone' );
	second.dispose();

	instance.settings.autoSpawn = false;
	instance.playerGun.owned = true;
	still( instance, 'sloop', 100, 450 );
	const bc = app.boatCtl;
	bc.position.set( 0, 0, 450 );
	features.update( 0.05 );
	app.input.keys.add( 'KeyZ' );
	features.update( 0.05 );
	ok( instance.balls.count === 1 && instance.reloadLeft.port > 3.5, 'pressing Z at the helm fires the port gun' );
	app.input.keys.delete( 'KeyZ' );
	app.input.keys.add( 'KeyX' );
	features.update( 0.05 );
	ok( instance.balls.count === 2 && instance.reloadLeft.starboard > 3.5, 'X fires the starboard gun' );
	app.input.keys.delete( 'KeyX' );
	instance.reloadLeft.port = 0;
	app.player.mode = 'walk';
	app.input.keys.add( 'KeyZ' );
	features.update( 0.05 );
	ok( instance.balls.count <= 2 && instance.reloadLeft.port === 0, 'on foot the keys do nothing' );
	app.input.keys.clear();
	ok( features.toJSON().naval.v === 1, 'toJSON through the registry' );

	// events reach listeners; a throwing listener does not stop the sim
	const got = [];
	features.on( 'playerBoatDamaged', () => { throw new Error( 'listener bug' ); } );
	features.on( 'playerBoatDamaged', ( e ) => got.push( e ) );
	const warn = console.warn;
	console.warn = () => {};
	instance.damagePlayer( 5, 'test' );
	console.warn = warn;
	ok( got.length === 1 && got[ 0 ].cause === 'test', 'events are delivered despite a broken listener' );

	// audio: no SoundScape = silent but logged; with a stand-in context it builds a positional graph
	const logs = [];
	const silent = new NavalAudio( {} );
	silent.cannon( 1, 2, 3 );
	ok( silent.played.length === 1 && silent.played[ 0 ].name === 'cannon', 'without app.audio a shot is only logged' );
	const nodes = [];
	const node = ( kind ) => { const n = { kind, connect: ( d ) => { n.to = d; return d; }, disconnect() {}, gain: { value: 1 }, playbackRate: { value: 1 }, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, start( t ) { n.startedAt = t; }, stop() {} }; nodes.push( n ); return n; };
	const ctx = { currentTime: 10, destination: node( 'dest' ), createBufferSource: () => node( 'src' ), createGain: () => node( 'gain' ), createPanner: () => node( 'panner' ), decodeAudioData: async () => ( { duration: 2.2 } ) };
	const sfx = node( 'sfx' );
	const realFetch = globalThis.fetch;
	globalThis.fetch = async ( url ) => { logs.push( url ); return { arrayBuffer: async () => new ArrayBuffer( 8 ) }; };
	const loud = new NavalAudio( { audio: { ctx, sfxAbove: sfx, env: { lx: 0, ly: 0, lz: 0 }, _muted: false } }, { base: '/' } );
	loud.cannon( 400, 0, 0, 0.8 );
	await new Promise( ( r ) => setTimeout( r, 20 ) );
	globalThis.fetch = realFetch;
	const src = nodes.find( ( n ) => n.kind === 'src' );
	ok( logs[ 0 ] === '/audio/naval/CannonShot_V01.mp3', 'the shot is fetched from public/audio/naval' );
	ok( src && near( src.startedAt, 10 + 400 / 343, 1e-6 ), 'the sound arrives after distance / 343 s (1.17 s for 400 m)' );
	const pan = nodes.find( ( n ) => n.kind === 'panner' );
	ok( pan && pan.positionX.value === 400 && pan.to === sfx, 'positional panner into the sfx bus' );

}

// ================================================================================================ 16. render
if ( ! NO_RENDER ) {

	section( '16. headless render of the three ships' );
	const out = new URL( 'test/out/', root );
	mkdirSync( out, { recursive: true } );

	// PNG (8-bit RGB / RGBA, non-interlaced) -> RGBA8 for the embedded ship textures
	globalThis.__assetFile = async ( url ) => {

		const b = readFileSync( new URL( 'public/' + url.replace( /^\//, '' ), root ) );
		return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

	};

	globalThis.__assetImage = async ( bytes ) => {

		const b = Buffer.from( bytes );
		const w = b.readUInt32BE( 16 ), h = b.readUInt32BE( 20 ), bpp = b[ 25 ] === 6 ? 4 : 3;
		let pos = 8;
		const idat = [];
		while ( pos < b.length ) {

			const len = b.readUInt32BE( pos ), type = b.toString( 'ascii', pos + 4, pos + 8 );
			if ( type === 'IDAT' ) idat.push( b.subarray( pos + 8, pos + 8 + len ) );
			pos += 12 + len;

		}

		const raw = inflateSync( Buffer.concat( idat ) );
		const stride = w * bpp, px = Buffer.alloc( stride * h );
		for ( let y = 0; y < h; y ++ ) {

			const f = raw[ y * ( stride + 1 ) ];
			for ( let x = 0; x < stride; x ++ ) {

				const v = raw[ y * ( stride + 1 ) + 1 + x ];
				const A = x >= bpp ? px[ y * stride + x - bpp ] : 0, B = y > 0 ? px[ ( y - 1 ) * stride + x ] : 0, C = x >= bpp && y > 0 ? px[ ( y - 1 ) * stride + x - bpp ] : 0;
				let r = v;
				if ( f === 1 ) r = v + A; else if ( f === 2 ) r = v + B; else if ( f === 3 ) r = v + ( ( A + B ) >> 1 );
				else if ( f === 4 ) { const p = A + B - C, pa = Math.abs( p - A ), pb = Math.abs( p - B ), pc = Math.abs( p - C ); r = v + ( pa <= pb && pa <= pc ? A : pb <= pc ? B : C ); }
				px[ y * stride + x ] = r & 255;

			}

		}

		const data = new Uint8Array( w * h * 4 );
		for ( let i = 0; i < w * h; i ++ ) { data[ i * 4 ] = px[ i * bpp ]; data[ i * 4 + 1 ] = px[ i * bpp + 1 ]; data[ i * 4 + 2 ] = px[ i * bpp + 2 ]; data[ i * 4 + 3 ] = bpp === 4 ? px[ i * 4 + 3 ] : 255; }
		return { data, width: w, height: h };

	};

	const { worldHarness, done } = await import( './world-harness.mjs' );
	const { Material } = await import( '../src/engine/render/Material.js' );
	const H = await worldHarness( { width: 1600, height: 760 } );
	const { E, scene } = H;
	const sea = new E.Mesh( new E.PlaneGeometry( 600, 600 ).rotateX( - Math.PI / 2 ), new Material( { name: 'sea', color: 0x1f5c78, roughness: 0.3, metalness: 0 } ) );
	sea.position.y = - 0.03;
	sea.receiveShadow = true;
	scene.add( sea );
	const models = new ModelSet( { scene, baseUrl: '/' } );
	const layout = [ [ 'sloop', - 46 ], [ 'trawler', 0 ], [ 'brigantine', 50 ] ];
	// a visual made before its template has loaded is empty and fills in when the GLB arrives
	const early = layout.map( ( [ kind ] ) => models.create( kind ) );
	ok( early.every( ( v ) => ! v.loaded && v.meshes.length === 0 ), 'visuals created before the GLB loaded start empty' );
	await Promise.all( layout.map( ( [ k ] ) => models.ready( k ) ) );
	ok( early.every( ( v ) => v.loaded && v.meshes.length >= 10 ), 'and are filled once it has loaded' );
	for ( const v of early ) v.dispose();
	const vis = [];
	for ( const [ kind, z ] of layout ) {

		const v = models.create( kind );
		ok( v.loaded && v.meshes.length >= 10, `${ kind }: ${ v.meshes.length } meshes in the scene` );
		const ship = new Ship( kind, { x: 0, z, yaw: 0 } );
		ship.pose.y = 0.1; ship.pose.roll = 0.02;
		v.apply( ship, ship.finalPose( {} ) );
		v.setVisible( true );
		v.group.updateMatrixWorld( true );
		vis.push( [ v, ship ] );
		// the stern lantern, in the world, must be behind the ship's centre (-Z at yaw 0)
		const lantern = v.meshes.find( ( m ) => m.name === 'ship-glass' );
		const bb = lantern.geometry.boundingBox;
		const c = new Vector3( ( bb.min.x + bb.max.x ) / 2, ( bb.min.y + bb.max.y ) / 2, ( bb.min.z + bb.max.z ) / 2 ).applyMatrix4( lantern.matrixWorld );
		const box = new E.Box3();
		for ( const m of v.meshes ) box.union( new E.Box3().setFromObject( m ) );
		ok( Math.abs( ( box.min.z + box.max.z ) / 2 - z ) < 0.4 && Math.abs( ( box.min.x + box.max.x ) / 2 ) < 0.2, `${ kind }: hull centred on its origin (z ${ ( ( box.min.z + box.max.z ) / 2 - z ).toFixed( 2 ) }, length ${ ( box.max.z - box.min.z ).toFixed( 1 ) } m)` );
		ok( c.z - z < - SHIP_CLASSES[ kind ].length * 0.3 && Math.abs( c.x ) < 1, `${ kind }: lantern at ${ ( c.z - z ).toFixed( 1 ) } m from the centre = the stern; the bow points along +Z` );
		ok( v.meshes.every( ( m ) => m.material.underwaterLighting === 'lite' ), `${ kind }: materials use underwaterLighting 'lite'` );

	}

	// a bow marker (bright red post 1 m past the stem) so the picture shows which way the bow points
	const marker = new E.Mesh( new E.BoxGeometry( 0.5, 6, 0.5 ), new Material( { name: 'marker', color: 0xff2020, roughness: 0.5, emissive: [ 0.6, 0, 0 ] } ) );
	for ( const [ , ship ] of vis ) {

		const m = marker.clone();
		m.position.set( 0, 3, ship.z + ship.cls.length / 2 + 1.5 );
		scene.add( m );

	}

	await H.shot( new URL( 'naval-ships.png', out ).pathname.replace( /^\//, '' ), { pos: [ 95, 12, 0 ], target: [ 0, 5, 0 ], fov: 42 } );
	// combat effects in the same scene: muzzle flash + smoke, a ball in flight, a splash ring, splinters, loot crates
	{

		const { Effects } = await import( '../src/features/naval/Effects.js' );
		const fx = new Effects( { scene } );
		const loot = new Loot( { scene } );
		const balls = new Projectiles( { scene } );
		const sl = vis[ 0 ][ 1 ];
		const g = sl.toWorld( sl.cls.stations[ 0 ].x, sl.cls.stations[ 0 ].y, sl.cls.stations[ 0 ].z, {} );
		fx.muzzle( g.x, g.y, g.z, 1, 0.03, 0, false );
		fx.splash( 38, 0, - 40, 1 );
		fx.splash( 52, 0, - 30, 1.4 );
		fx.hit( 3, 3, 0 );
		fx.smoke( 0, 6, 8, 1 );
		const c = loot.drop( 24, - 20, 50, 'test' );
		c.vx = c.vz = 0;
		loot.drop( 28, - 16, 50, 'test' ).vx = 0;
		balls.spawn( { x: g.x + 12, y: g.y + 0.6, z: g.z, vx: 120, vy: 3, vz: 0, owner: 'x', faction: 'pirate' } );
		for ( let i = 0; i < 18; i ++ ) { fx.update( 1 / 30 ); loot.update( 1 / 30, 1.2, null ); balls.update( 1 / 30, { ships: [] } ); }
		ok( fx.puffs.some( ( p ) => p.on ) && fx.rings.some( ( r ) => r.on ) && fx.splinters.some( ( q ) => q.on ), 'puffs, rings and splinters are live' );
		await H.shot( new URL( 'naval-effects.png', out ).pathname.replace( /^\//, '' ), { pos: [ 60, 7, - 30 ], target: [ 5, 3, - 24 ], fov: 55 } );
		fx.dispose(); loot.dispose(); balls.dispose();

	}

	models.setNight( 1 );
	await H.shot( new URL( 'naval-ships-quarter.png', out ).pathname.replace( /^\//, '' ), { pos: [ 55, 16, - 95 ], target: [ 0, 4, 5 ], fov: 46 } );
	ok( existsSync( new URL( 'test/out/naval-ships.png', root ) ), 'wrote test/out/naval-ships.png and naval-ships-quarter.png' );
	models.dispose();
	console.log( `\n${ passes } checks passed, ${ fails } failed` );
	if ( fails ) process.exit( 1 );
	await done();

} else {

	console.log( `\n${ passes } checks passed, ${ fails } failed (render skipped)` );
	process.exit( fails ? 1 : 0 );

}
