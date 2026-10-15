// Plain-node test of wave 9 naval collisions, direct aiming and cripple-then-board (src/features/naval/Collisions.js,
// Naval.js, Ship.js, Brains.js, AimAssist.js lookAim, Hud.js, Planks.js; src/player/BoatController.js applyCollision):
//   SAT overlap + impulse (two hulls closing at 5 m/s separate and both lose hull), damage scaling by mass and speed and the
//   bow bonus, no damage while rubbing, the 0.4 s gap, the player's boat against a ship through Naval (controller impulse,
//   damagePlayer 'ramming', vfx / audio / destruction / planks), pirates ramming, merchants steering clear, aim side and
//   elevation from a look vector, the aimed broadside, the sandbox gun, the cripple threshold and its event, the HUD bar.
//   node test/feature-collisions.mjs
import { Features } from '../src/features/Features.js';
import { Naval, GUN_LEVELS, CRIPPLE } from '../src/features/naval/Naval.js';
import { Ship } from '../src/features/naval/Ship.js';
import { SHIP_CLASSES } from '../src/features/naval/ShipClasses.js';
import { COLLIDE, obb2, satOverlap, resolveContact, ramDamage, isBowOn, predictContact, CollisionWorld, yawInertia, contactPoint } from '../src/features/naval/Collisions.js';
import { thinkPirate, thinkMerchant, RAM } from '../src/features/naval/Brains.js';
import { lookAim, aimPlan } from '../src/features/naval/AimAssist.js';
import { hudModel, targetBar } from '../src/features/naval/Hud.js';
import { Planks, PLANK_LIFE } from '../src/features/naval/Planks.js';
import { solveElevation, MUZZLE_SPEED, rotateByQuat } from '../src/features/naval/Ballistics.js';
import { BoatController } from '../src/player/BoatController.js';
import { BOATS } from '../src/game/Boats.js';
import { RULES } from '../src/features/boarding/BoardingData.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );

// a free body on the water plane (what Naval builds from a Ship or the boat controller), integrated by hand
function body( id, { x = 0, z = 0, yaw = 0, hx = 1.5, hz = 4, mass = 3200, vx = 0, vz = 0, w = 0, maxHp = 100, fixed = false } = {} ) {

	const b = { id, x, z, yaw, hx, hz, mass, invMass: fixed ? 0 : 1 / mass, invI: fixed ? 0 : 1 / yawInertia( mass, hx, hz ), vx, vz, w, maxHp, hp: maxHp };
	b.push = ( dx, dz ) => { b.x += dx; b.z += dz; };
	b.impulse = ( jx, jz, px, pz ) => {

		b.vx += jx * b.invMass;
		b.vz += jz * b.invMass;
		b.w += ( ( pz - b.z ) * jx - ( px - b.x ) * jz ) * b.invI;

	};
	b.step = ( dt ) => { b.x += b.vx * dt; b.z += b.vz * dt; b.yaw += b.w * dt; };
	return b;

}

// ================================================================================================ 1. SAT
section( '1. oriented boxes on the water plane (SAT)' );
{

	const A = obb2( 0, 0, 0, 1.5, 4 ), B = obb2( 2.5, 0, 0, 1.5, 4 );
	const s = satOverlap( A, B );
	ok( s.hit && near( s.depth, 0.5, 1e-9 ) && near( s.nx, 1, 1e-9 ) && near( s.nz, 0, 1e-9 ), `side by side, 0.5 m overlap along +X (depth ${ s.depth.toFixed( 3 ) })` );
	const C = obb2( 3.5, 0, 0, 1.5, 4 );
	const s2 = satOverlap( A, C );
	ok( ! s2.hit && near( s2.sep, 0.5, 1e-9 ), 'apart by 0.5 m: no hit, the gap is reported' );
	// a hull turned 90 deg across the bow of another: bow to beam
	const D = obb2( 0, 5.2, Math.PI / 2, 1.5, 4 );
	const s3 = satOverlap( A, D );
	ok( s3.hit && near( s3.depth, 0.3, 1e-9 ) && near( s3.nz, 1, 1e-9 ), `T-bone: 0.3 m overlap along the bow (+Z), depth ${ s3.depth.toFixed( 3 ) }` );
	const p = contactPoint( A, D, s3.nx, s3.nz );
	ok( Math.abs( p.x ) < 1e-6 && p.z > 3.6 && p.z < 4.2, `the contact is at the bow (${ p.x.toFixed( 2 ) }, ${ p.z.toFixed( 2 ) })` );
	ok( isBowOn( { x: 0, z: 0, yaw: 0, hz: 4 }, s3.nx, s3.nz, p ) && ! isBowOn( { x: 0, z: 5.2, yaw: Math.PI / 2, hz: 4 }, - s3.nx, - s3.nz, p ), 'A rams bow-on; B is struck on the beam' );
	// rotated boxes: a 45 deg box near a corner
	const E = obb2( 3.6, 4.6, Math.PI / 4, 1, 2 );
	const s4 = satOverlap( A, E );
	ok( s4.hit === ( s4.sep < 0 ), 'a turned box: hit agrees with the separation sign' );
	ok( ! satOverlap( A, obb2( 6, 6, Math.PI / 4, 1, 2 ) ).hit, 'a turned box clear of the corner does not hit' );

}

// ================================================================================================ 2. impulse
section( '2. two hulls closing at 5 m/s separate and both lose hull' );
{

	const a = body( 'a', { x: 0, z: 0, vx: 2.5, maxHp: 264 } ), b = body( 'b', { x: 3.2, z: 0, vx: - 2.5, maxHp: 264 } );
	const world = new CollisionWorld();
	let t = 0, hits = 0, firstSpeed = 0, dmgA = 0, dmgB = 0;
	for ( let i = 0; i < 120; i ++ ) {

		a.step( 1 / 60 ); b.step( 1 / 60 );
		t += 1 / 60;
		for ( const c of world.step( t, [ a, b ] ) ) {

			if ( c.damage ) {

				hits ++;
				if ( ! firstSpeed ) firstSpeed = c.vClose;
				dmgA += c.damage.a; dmgB += c.damage.b;

			}

		}

	}

	const s = satOverlap( obb2( a.x, a.z, a.yaw, a.hx, a.hz ), obb2( b.x, b.z, b.yaw, b.hx, b.hz ) );
	ok( ! s.hit || s.depth < 0.05, `no longer overlapping after 2 s (gap ${ s.sep.toFixed( 2 ) } m)` );
	ok( a.vx < 0 && b.vx > 0, `they bounced: a ${ a.vx.toFixed( 2 ) } m/s, b ${ b.vx.toFixed( 2 ) } m/s` );
	ok( near( b.vx - a.vx, 5 * COLLIDE.restitution, 0.05 ), `separating at restitution x closing (${ ( b.vx - a.vx ).toFixed( 2 ) } m/s)` );
	ok( near( a.vx * a.mass + b.vx * b.mass, 0, 1e-6 ), 'momentum is conserved' );
	ok( hits === 1 && near( firstSpeed, 5, 0.01 ), `one damage event at the 5 m/s closing speed (${ hits })` );
	ok( dmgA > 0 && dmgB > 0 && near( dmgA, dmgB, 1e-9 ), `both lose hull, equally for equal hulls (${ dmgA.toFixed( 1 ) } hp each)` );
	// inverse-mass separation: an immovable hull does not move, the other takes all of it
	const r = body( 'rock', { fixed: true, mass: 64000 } ), m = body( 'm', { x: 2.8, vx: - 1 } );
	const c = { nx: 1, nz: 0, depth: 0.2, x: 1.5, z: 0 };
	resolveContact( r, m, c );
	ok( r.x === 0 && near( m.x, 2.8 + 0.2 - COLLIDE.slop, 1e-9 ) && m.vx > 0, 'against a grounded / moored hull: it stays, the other is pushed out and bounces' );
	// a heavy hull is pushed less than a light one (inverse mass)
	const hv = body( 'h', { mass: 30000 } ), lt = body( 'l', { x: 2.8, mass: 3000 } );
	resolveContact( hv, lt, { nx: 1, nz: 0, depth: 0.22, x: 1.5, z: 0 } );
	ok( near( - hv.x * 30000, lt.x * 3000 - 2.8 * 3000, 1e-6 ) && lt.x - 2.8 > - hv.x * 9, 'separation splits by inverse mass (the light hull moves 10x as far)' );
	// friction: a glancing blow is slowed along the tangent, at most mu jn
	const g1 = body( 'g1' ), g2 = body( 'g2', { x: 2.9, vx: - 1, vz: 4 } );
	const rr = resolveContact( g1, g2, { nx: 1, nz: 0, depth: 0.1, x: 1.5, z: 0 } );
	ok( Math.abs( rr.jt ) <= COLLIDE.friction * rr.jn + 1e-9 && rr.jt < 0, `a glancing blow rubs (jt ${ rr.jt.toFixed( 0 ) } <= mu jn ${ ( COLLIDE.friction * rr.jn ).toFixed( 0 ) })` );
	ok( g1.w !== 0 || g2.w !== 0, 'and the off-centre impulse kicks the yaw' );

}

// ================================================================================================ 3. damage scaling
section( '3. damage: mass, speed, bow' );
{

	const hp = ( id ) => BOATS[ id ].hp ?? Math.round( 40 + 0.07 * BOATS[ id ].mass );
	const skiff = { mass: BOATS.skiff.mass, maxHp: hp( 'skiff' ) }, brig = { mass: SHIP_CLASSES.brigantine.mass, maxHp: SHIP_CLASSES.brigantine.hp };
	const rammed = ramDamage( skiff, brig, 8, false, true );
	ok( rammed / skiff.maxHp > 0.8 && rammed / skiff.maxHp < 1, `a brigantine ramming a skiff at 8 m/s bow-on nearly sinks it (${ ( 100 * rammed / skiff.maxHp ).toFixed( 0 ) } %)` );
	const lob = { mass: 3200, maxHp: 264 };
	const nudge = ramDamage( lob, lob, 2 );
	ok( nudge / lob.maxHp > 0.015 && nudge / lob.maxHp < 0.025, `a 2 m/s nudge between equals is a scratch (${ ( 100 * nudge / lob.maxHp ).toFixed( 1 ) } %)` );
	ok( near( ramDamage( lob, lob, 4 ) / ramDamage( lob, lob, 2 ), 4, 1e-9 ), 'damage goes with the closing speed squared' );
	ok( ramDamage( lob, brig, 4 ) > ramDamage( lob, skiff, 4 ) * 5, 'a heavier other hull does more damage (mass ratio)' );
	ok( ramDamage( brig, skiff, 8, true, false ) < ramDamage( brig, skiff, 8 ), 'the rammer takes less (x0.6)' );
	ok( near( ramDamage( lob, lob, 3, false, true ) / ramDamage( lob, lob, 3 ), COLLIDE.bowOn, 1e-9 ), 'a bow-on hit does x1.5 to the other hull' );
	ok( ramDamage( lob, lob, COLLIDE.minSpeed * 0.9 ) === 0, 'a touch slower than minSpeed does nothing' );

}

// ================================================================================================ 4. rubbing
section( '4. no damage while rubbing; one event per blow, at most every 0.4 s' );
{

	const a = body( 'a' ), b = body( 'b', { x: 3.1, vx: - 3 } );
	const world = new CollisionWorld();
	let events = 0, t = 0;
	// b keeps driving into a for 3 s (an engine pushing, like a ship at full way)
	for ( let i = 0; i < 180; i ++ ) {

		t += 1 / 60;
		b.vx = Math.min( b.vx, 0 ) - 0.05; a.vx *= 0.9; a.vz = 0;
		a.step( 1 / 60 ); b.step( 1 / 60 );
		for ( const c of world.step( t, [ a, b ] ) ) if ( c.damage ) events ++;

	}

	ok( events === 1, `pressed together for 3 s: one damage event (${ events })` );
	// part, then strike again after 0.2 s: still within the gap -> no second event; after 0.5 s: a second one
	const w2 = new CollisionWorld();
	const p = body( 'p' ), q = body( 'q', { x: 2.9, vx: - 3 } );
	let n1 = 0;
	for ( const c of w2.step( 1.0, [ p, q ] ) ) if ( c.damage ) n1 ++;
	q.x = 8; q.vx = - 3; p.vx = 0;
	w2.step( 1.1, [ p, q ] ); // apart: re-armed
	q.x = 2.9;
	for ( const c of w2.step( 1.2, [ p, q ] ) ) if ( c.damage ) n1 ++;
	ok( n1 === 1, 'a second blow 0.2 s later does no damage (minimum gap 0.4 s)' );
	q.x = 8; w2.step( 1.5, [ p, q ] );
	q.x = 2.9; q.vx = - 3; p.vx = 0;
	for ( const c of w2.step( 1.7, [ p, q ] ) ) if ( c.damage ) n1 ++;
	ok( n1 === 2, 'after parting, a new blow 0.7 s later damages again' );
	// gentle hulls (a pirate coming alongside to grapple) bump without damage
	const w3 = new CollisionWorld();
	const g = body( 'g' ), h = body( 'h', { x: 2.9, vx: - 3 } );
	h.gentle = true;
	const cs = w3.step( 0, [ g, h ] );
	ok( cs.length === 1 && ! cs[ 0 ].damage && h.vx > - 3, 'a hull coming alongside on purpose bumps without damage' );

}

// ================================================================================================ stand-ins for Naval
function makeApp( over = {} ) {

	const toasts = [], kicks = [];
	const state = { boat: 'lobster', money: 0, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const keys = new Set();
	const input = { hit: ( c ) => keys.has( c ), keys, rightDown: false, mouseDown: false, enabled: true };
	return {
		mode: 'campaign', settings: { timeOfDay: 12 },
		terrainData: null, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( 0, 0, 1500 ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), driven: true, moored: false },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new Vector3( 0, 4, 1490 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new Vector3( 0, 1, 1500 ) },
		input, game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick( k, o ) { kicks.push( k ); } },
		toasts, kicks, ...over,
	};

}

function setup( { app = makeApp(), mode = null, extras = {} } = {} ) {

	if ( mode ) app.mode = mode;
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'shipSunk', 'playerBoatDamaged', 'playerBoatSunk', 'hullsCollided', 'shipCrippled', 'cannonFired' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const spy = { splinters: 0, debris: 0, splash: 0, smoke: 0, impulse: 0, debrisKinds: [] };
	if ( extras.vfx ) features.add( 'vfx', { install: () => ( {
		splinters() { spy.splinters ++; }, debris( x, y, z, s, k ) { spy.debris ++; spy.debrisKinds.push( k ); }, splash() { spy.splash ++; }, smoke() { spy.smoke ++; },
		sinking() {}, bubbles() {},
	} ) } );
	if ( extras.destruction ) features.add( 'destruction', { install: () => ( { impulse() { spy.impulse ++; }, raycastSegment() { return null; } } ) } );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 9, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	return { app, features, naval, events, spy };

}

const run = ( features, seconds, dt = 1 / 30 ) => { for ( let i = 0, n = Math.round( seconds / dt ); i < n; i ++ ) features.update( dt ); };

// a ship held on a heading at a set speed (state 'adrift': no brain steers her)
function drive( naval, kind, x, z, yaw, speed ) {

	const s = naval.spawn( kind, { x, z, yaw } );
	s.state = 'adrift';
	s.speed = speed;
	s.wantSpeed = speed / s.cls.speed;
	return s;

}

// ================================================================================================ 5. the player's boat
section( '5. the player\'s boat against a ship (Naval)' );
{

	const { app, features, naval, events, spy } = setup( { extras: { vfx: true, destruction: true } } );
	const b = app.boatCtl;
	// a sloop sailing at 6 m/s (heading -X: yaw -90 deg) into the beam of the stopped boat
	const s = drive( naval, 'sloop', 14, 1500, - Math.PI / 2, 6 );
	const hp0 = naval.playerHull.hp, shp0 = s.hp;
	let t = 0;
	for ( ; t < 4 && ! events.some( ( e ) => e[ 0 ] === 'hullsCollided' ); t += 1 / 30 ) features.update( 1 / 30 );
	const ev = events.find( ( e ) => e[ 0 ] === 'hullsCollided' );
	ok( !! ev, `hullsCollided after ${ t.toFixed( 2 ) } s (speed ${ ev && ev[ 1 ].speed } m/s)` );
	ok( naval.playerHull.hp < hp0 && s.hp < shp0, `both lose hull: boat ${ hp0 } -> ${ naval.playerHull.hp.toFixed( 1 ) }, sloop ${ shp0 } -> ${ s.hp.toFixed( 1 ) }` );
	ok( events.some( ( e ) => e[ 0 ] === 'playerBoatDamaged' && e[ 1 ].cause === 'ramming' ), 'the boat\'s damage is routed through damagePlayer( n, \'ramming\' )' );
	ok( b.velocity.x < - 1, `the boat is shoved away (vx ${ b.velocity.x.toFixed( 2 ) } m/s)` );
	ok( spy.splinters >= 1 && spy.debris >= 1 && spy.splash >= 1 && spy.debrisKinds.includes( 'wood' ), 'vfx: splinters, wood debris and a splash at the contact' );
	ok( spy.impulse >= 1, 'destruction.impulse at the crash' );
	ok( naval.audio.played.some( ( p ) => p.name === 'crunch' ), 'a crunch is played' );
	ok( app.kicks.includes( 'broadside' ) || app.kicks.includes( 'hit' ), 'the camera is kicked' );
	run( features, 2 );
	const sep = satOverlap( obb2( b.position.x, b.position.z, 0, 1.45, 4.1 ), obb2( s.x, s.z, s.yaw, s.cls.beam / 2, s.cls.length / 2 * 0.97 ) );
	ok( sep.depth < 0.3, `the hulls stay apart (no clipping through: overlap ${ sep.depth.toFixed( 2 ) } m)` );
	ok( events.filter( ( e ) => e[ 0 ] === 'hullsCollided' ).length <= 2, 'the sloop pressing on does not damage every frame' );

	// the real controller's response path: velocity from J / m, a yaw kick from the lever
	const fake = {
		position: new Vector3( 0, 0, 0 ), velocity: new Vector3(), angular: new Vector3(), quaternion: new Quaternion(),
		com: new Vector3( 0, 0.3, - 0.74 ), inertia: new Vector3( 14600, 15700, 3500 * 1.24 ), addedInertia: new Vector3( 1, 0.4, 0.2 ),
		wetFraction: 1, mass: 3200, model: null,
	};
	fake.toWorld = BoatController.prototype.toWorld;
	const okc = BoatController.prototype.applyCollision.call( fake, 0.1, 0, 3200 * 2, 0, 1.4, 0.6, 3.5 );
	ok( okc && near( fake.position.x, 0.1, 1e-9 ) && near( fake.velocity.x, 2, 1e-9 ), 'BoatController.applyCollision: pushed out, dv = J / m' );
	ok( fake.angular.y > 0 && Math.abs( fake.angular.z ) > 0, `a blow pushing the bow to port swings her to port and heels her (yaw ${ fake.angular.y.toFixed( 3 ) }, roll ${ fake.angular.z.toFixed( 3 ) } rad/s)` );
	ok( BoatController.prototype.applyCollision.call( fake, NaN, 0, 0, 0 ) === false, 'non-finite input is refused' );

}

// ================================================================================================ 6. destruction
section( '6. ramming to the bottom: sinking and floating planks' );
{

	const { app, features, naval, events, spy } = setup( { extras: { vfx: true } } );
	app.game.state.boat = 'brigantine';
	run( features, 0.1 );
	ok( naval.playerHull.boat === 'brigantine', 'the player sails a brigantine' );
	const b = app.boatCtl;
	b.velocity.set( 0, 0, 8 ); // 8 m/s ahead (+Z)
	const s = drive( naval, 'sloop', 0, 1500 + 18, Math.PI / 2, 0 ); // a sloop lying across her bow
	s.hp = 30;
	let t = 0;
	for ( ; t < 3 && s.alive; t += 1 / 30 ) {

		b.position.z += b.velocity.z / 30; // (the stand-in controller: the boat sails on by hand)
		features.update( 1 / 30 );

	}

	ok( ! s.alive, `the rammed sloop is going down (${ t.toFixed( 2 ) } s)` );
	const sunk = events.find( ( e ) => e[ 0 ] === 'shipSunk' );
	ok( sunk && sunk[ 1 ].byPlayer === true, 'shipSunk { byPlayer: true } (the loot / sinking flow is kept)' );
	ok( naval.loot.list.length >= 1, 'her loot crates float' );
	ok( naval.planks.list.length >= 6 && spy.debris >= 6, `floating planks (${ naval.planks.list.length }) and a burst of wood debris (${ spy.debris })` );
	const pk = naval.planks.list[ 0 ];
	run( features, 3 );
	ok( Math.abs( pk.y ) < 1.2 && pk.age > 2, 'the planks settle on the water' );
	run( features, PLANK_LIFE );
	ok( naval.planks.list.length === 0, 'and are gone after PLANK_LIFE' );
	// a ship past half her points lists (Ship.finalPose) and smokes (vfx.smoke between 50 and 35 %)
	const d = drive( naval, 'sloop', 300, 1500, 0, 0 );
	d.state = 'dock';
	d.hp = d.maxHp * 0.45;
	const base = new Ship( 'sloop', {} );
	ok( Math.abs( d.finalPose( {} ).roll - base.finalPose( {} ).roll ) > 0.01, 'a hull below 50 % lists' );
	const sm = spy.smoke;
	run( features, 1.5 );
	ok( spy.smoke > sm, 'and smokes' );

}

// ================================================================================================ 7. ship against ship
section( '7. ships against ships; pirates ram, merchants steer clear' );
{

	const { features, naval, events } = setup();
	const a = drive( naval, 'trawler', 0, 2000, Math.PI / 2, 4 ); // eastbound
	const c = drive( naval, 'brigantine', 30, 2000, - Math.PI / 2, 4 ); // westbound, head on
	run( features, 6 );
	const ev = events.filter( ( e ) => e[ 0 ] === 'hullsCollided' && e[ 1 ].byPlayer === false );
	ok( ev.length >= 1, `two AI ships collide head on (${ ev.length } blows)` );
	ok( a.hp < a.maxHp && c.hp < c.maxHp && ( a.maxHp - a.hp ) / a.maxHp > ( c.maxHp - c.hp ) / c.maxHp, 'both are holed, the lighter trawler worse' );
	ok( c.x - a.x > ( a.cls.length + c.cls.length ) * 0.3, 'they did not pass through each other' );

	// a pirate heavier than her target rams while her guns reload
	const s = new Ship( 'sloop', { x: 0, z: 1500, yaw: 0 } );
	s.state = 'broadside';
	s.mem.side = 1;
	s.reload.port = 4; s.reload.starboard = 3;
	const tgt = { x: 60, z: 1540, vx: 0, vz: 0, ok: true, mass: 3200 }; // (out in the open sea: not the peaceful home waters)
	const w = { time: 0, target: tgt, rng: () => 0.5, terrain: null, fire: () => false, escape: () => {} };
	w.rng.range = ( a, b ) => ( a + b ) / 2;
	thinkPirate( s, w, 0.1 );
	ok( s.mem.ram === true && s.wantSpeed === 1 && Math.abs( s.want - Math.atan2( 60, 40 ) ) < 0.05, 'a sloop with her guns reloading rams a lobster boat (bow at him, full speed)' );
	const s2 = new Ship( 'sloop', { x: 0, z: 1500, yaw: 0 } );
	s2.state = 'broadside'; s2.mem.side = 1; s2.reload.port = 4; s2.reload.starboard = 3;
	thinkPirate( s2, { ...w, target: { ...tgt, mass: 64000 } }, 0.1 );
	ok( ! s2.mem.ram, 'she does not ram a heavier ship' );
	s.reload.port = 0.2;
	thinkPirate( s, w, 0.1 );
	ok( ! s.mem.ram, 'and breaks off when a battery is ready' );

	// a merchant on a collision course turns away
	const m = setup();
	m.app.boatCtl.position.set( 0, 0, 3000 );
	m.app.boatCtl.velocity.set( 0, 0, 0 );
	const tr = m.naval.spawn( 'trawler', { x: 0, z: 2975, yaw: 0, route: [ [ 0, 2975 ], [ 0, 3400 ] ], index: 1 } );
	tr.speed = 4;
	run( m.features, 1 );
	ok( tr.mem.avoidT > 0 && tr.mem.avoidDir !== undefined, 'a merchant with the boat dead ahead within 3 s steers clear' );
	const yaw0 = tr.yaw;
	run( m.features, 1 );
	ok( Math.abs( tr.yaw - yaw0 ) > 0.02, `her heading changes (${ ( ( tr.yaw - yaw0 ) * 180 / Math.PI ).toFixed( 1 ) } deg)` );
	ok( predictContact( { x: 0, z: 0, vx: 0, vz: 5, yaw: 0, hx: 3, hz: 8 }, { x: 40, z: 40, vx: 0, vz: 0, yaw: 0, hx: 3, hz: 8 }, 3 ) === null, 'no avoidance for a hull that is not in the way' );

}

// ================================================================================================ 8. aiming
section( '8. aiming the guns by the camera look' );
{

	// boat at the origin heading +Z: port is +X, starboard -X
	const gunFor = ( side ) => ( { m: { x: side === 'port' ? 1.5 : - 1.5, y: 1, z: 1 }, n: { x: side === 'port' ? 1 : - 1, z: 0 } } );
	const opts = { traverse: 24 * Math.PI / 180, maxRange: 320, minRange: 20, speed: MUZZLE_SPEED };
	const eye = { x: 0, y: 6, z: - 6 };
	// look to port, down onto the sea 120 m out
	const P = { x: 121.5, y: 0, z: 1 }, d = Math.hypot( P.x - eye.x, P.y - eye.y, P.z - eye.z );
	const look = { x: ( P.x - eye.x ) / d, y: ( P.y - eye.y ) / d, z: ( P.z - eye.z ) / d };
	const a = lookAim( look, eye, gunFor, opts );
	ok( a.side === 'port' && a.inArc, 'looking over the port beam picks the port battery' );
	ok( near( a.range, 120, 1.5 ), `the range is where the look meets the water (${ a.range.toFixed( 1 ) } m)` );
	ok( near( a.el, solveElevation( MUZZLE_SPEED, a.range, - 1 ), 1e-9 ) && a.dir.y > 0, `the elevation drops the ball there (${ ( a.el * 180 / Math.PI ).toFixed( 2 ) } deg)` );
	const st = lookAim( { x: - 0.97, y: - 0.05, z: 0.2 }, eye, gunFor, opts );
	ok( st.side === 'starboard' && st.dir.x < 0, 'looking over the starboard beam picks starboard' );
	const fwd = lookAim( { x: 0.3, y: - 0.02, z: 0.95 }, eye, gunFor, opts );
	ok( fwd.side === 'port' && ! fwd.inArc && near( fwd.az, - opts.traverse, 1e-9 ) || near( fwd.az, opts.traverse, 1e-9 ), 'looking ahead: the bearing is held at the edge of the traverse' );
	const up = lookAim( { x: 0.99, y: 0.1, z: 0 }, eye, gunFor, opts );
	ok( near( up.range, 320, 1e-9 ), 'looking at the sky: full range' );
	const steep = lookAim( { x: 0.3, y: - 0.95, z: 0 }, eye, gunFor, opts );
	ok( near( steep.range, 20, 1e-9 ), 'looking down at the hull: the shortest range' );
	const longer = lookAim( { x: 0.99, y: - 0.02, z: 0 }, eye, gunFor, opts );
	ok( longer.el > a.el, 'raising the look raises the guns' );

	// through Naval: right mouse held at the helm aims, the left button fires that side along the look
	const saved = GUN_LEVELS[ 1 ].spread;
	GUN_LEVELS[ 1 ].spread = 0;
	const { app, features, naval, events } = setup();
	naval.playerGun.owned = true;
	const cam = app.camera;
	cam.position.set( 0, 6, 1494 );
	// turn the camera to look over the port beam (+X), a little down
	const q = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), - Math.PI / 2 );
	const tilt = new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), - 0.06 );
	cam.quaternion.copy( q.multiply( tilt ) );
	app.input.rightDown = true;
	run( features, 0.1 );
	ok( naval.aiming && naval.aimInfo && naval.aimInfo.side === 'port', 'right mouse at the helm: aiming the port battery' );
	const plan = aimPlan( naval, 'port' ), other = aimPlan( naval, 'starboard' );
	ok( plan && plan.aimed && plan.points.length > 3 && other === null, 'the aim dots show the aimed arc (and nothing for the other side)' );
	const m = hudModel( naval );
	ok( m.aiming && m.aiming.side === 'port' && m.aiming.range === Math.round( naval.aimInfo.range ), `the HUD readout: ${ m.aiming.side } ${ m.aiming.range } m` );
	app.input.mouseDown = true;
	run( features, 1 / 30 );
	app.input.mouseDown = false;
	const shot = events.filter( ( e ) => e[ 0 ] === 'cannonFired' && e[ 1 ].by === 'player' ).pop();
	ok( !! shot, 'the left button fires' );
	ok( shot && Math.abs( shot[ 1 ].dir.x - naval.aimInfo.dir.x ) < 0.02 && Math.abs( shot[ 1 ].dir.y - naval.aimInfo.dir.y ) < 0.02, 'along the aimed direction (not the auto lead)' );
	ok( naval.reloadLeft.port > 0, 'and the port battery reloads' );
	app.input.rightDown = false;
	run( features, 0.1 );
	ok( ! naval.aiming && naval.aimInfo === null, 'letting go of the right button ends the aiming (auto-aim again)' );
	app.game.rod = { equipped: true };
	app.input.rightDown = true;
	run( features, 0.1 );
	ok( ! naval.aiming, 'no aiming while the rod is out (its buttons are the rod\'s)' );
	app.game.rod = null;
	app.input.rightDown = false;
	app.input.aimHeld = true;
	run( features, 0.1 );
	ok( naval.aiming, 'the touch layer\'s input.aimHeld aims too' );
	app.input.aimHeld = false;
	GUN_LEVELS[ 1 ].spread = saved;

	// no gun: say where to get one; the sandbox always has one
	const c2 = setup();
	c2.app.input.rightDown = true;
	run( c2.features, 0.1 );
	ok( ! c2.naval.aiming && c2.app.toasts.some( ( t ) => /No gun - Captain Roid sells a swivel gun/.test( t ) ), 'without a gun: no aiming, and a tip says Captain Roid sells one' );
	ok( hudModel( c2.naval ).noGun === true, 'the naval HUD says it too (for a few seconds)' );
	run( c2.features, 5 );
	ok( hudModel( c2.naval ).noGun === false, 'then the line goes (no standing prompt)' );
	const sb = setup( { mode: 'sandbox' } );
	ok( sb.naval.playerGun.owned === true && sb.naval.playerGun.bought === false, 'the sandbox always has a swivel gun (nothing bought)' );
	ok( sb.naval.toJSON().gun.owned === false, 'and it is not written into the save as bought' );

}

// ================================================================================================ 9. cripple
section( '9. damage then board: the cripple line' );
{

	ok( CRIPPLE === RULES.cripple, `naval's cripple line is boarding's RULES.cripple (${ CRIPPLE })` );
	const { app, features, naval, events } = setup();
	const s = naval.spawn( 'sloop', { x: 120, z: 1500, yaw: 0 } );
	s.state = 'dock';
	run( features, 0.1 );
	// swivel hits (level 1) at ~120 m: how many to cripple her
	let hits = 0;
	while ( s.hpFraction >= CRIPPLE && hits < 20 ) {

		naval._shipHit( { damage: GUN_LEVELS[ 1 ].damage, owner: 'player', travelled: 120 }, s, 'hull', { x: s.x, y: 2, z: s.z } );
		hits ++;

	}

	ok( hits >= 4 && hits <= 6, `a sloop is crippled by ${ hits } swivel hits (4-6)` );
	ok( s.alive, 'and is still afloat to be boarded' );
	run( features, 0.1 );
	const ce = events.filter( ( e ) => e[ 0 ] === 'shipCrippled' );
	ok( ce.length === 1 && ce[ 0 ][ 1 ].id === s.id, 'shipCrippled { id } once, as she crosses the line' );
	run( features, 0.5 );
	ok( events.filter( ( e ) => e[ 0 ] === 'shipCrippled' ).length === 1, 'not again while she stays below it' );
	app.boatCtl.position.set( 0, 0, 1500 );
	naval.target.ok = true;
	s.reload.port = s.reload.starboard = 0;
	ok( naval._shipFire( s, 'starboard' ) === false && naval._shipFire( s, 'port' ) === false, 'a crippled pirate stops shooting' );
	const tb = targetBar( naval );
	ok( tb && tb.id === s.id && tb.mark === CRIPPLE && tb.crippled && tb.frac < CRIPPLE, `the HUD target bar: ${ Math.round( tb.frac * 100 ) } % with the mark at ${ tb.mark * 100 } %` );
	ok( hudModel( naval ).target && hudModel( naval ).target.id === s.id, 'the target bar is in the HUD model at the helm' );
	const far = naval.spawn( 'sloop', { x: 2000, z: 1500 } );
	far.state = 'dock';
	ok( targetBar( naval ).id === s.id, 'a pirate out of gun range shows no bar' );

}

// ================================================================================================ 10. HUD DOM
section( '10. HUD: crosshair, target bar with the cripple mark' );
{

	const mk = ( tag ) => {

		const e = { tag, children: [], classes: new Set(), style: {}, textContent: '', parent: null };
		e.classList = { add: ( c ) => e.classes.add( c ), remove: ( c ) => e.classes.delete( c ), toggle: ( c, on ) => ( on ?? ! e.classes.has( c ) ) ? e.classes.add( c ) : e.classes.delete( c ), contains: ( c ) => e.classes.has( c ) };
		Object.defineProperty( e, 'className', { get: () => [ ...e.classes ].join( ' ' ), set: ( v ) => { e.classes = new Set( String( v ).split( /\s+/ ).filter( Boolean ) ); } } );
		e.append = ( ...cs ) => { for ( const c of cs ) { c.parent = e; e.children.push( c ); } };
		e.remove = () => { if ( e.parent ) e.parent.children.splice( e.parent.children.indexOf( e ), 1 ); };
		return e;

	};

	const doc = { createElement: mk, head: mk( 'head' ), body: mk( 'body' ) };
	const { NavalHud } = await import( '../src/features/naval/Hud.js' );
	const hud = new NavalHud( { doc } );
	const all = [];
	const walk = ( e ) => { all.push( e ); e.children.forEach( walk ); };
	const find = ( c ) => { all.length = 0; walk( doc.body ); return all.find( ( e ) => e.classes.has( c ) ); };
	const model = {
		visible: true, hull: { hp: 200, max: 264, frac: 0.75, low: false, sunk: false },
		guns: [ { side: 'port', key: 'Z', owned: true, ready: true, frac: 1, count: 1 }, { side: 'starboard', key: 'X', owned: true, ready: false, left: 2, frac: 0.4, count: 1 } ],
		arrows: [], aim: null, aiming: { side: 'port', range: 214, inArc: true, ready: true, left: 0 },
		target: { id: 's', name: 'Black Gull', frac: 0.2, mark: 0.25, crippled: true, dist: 90 }, noGun: false, camera: null, features: null,
	};
	hud.update( model, 0.016 );
	ok( find( 'nv-xhair' ).classes.has( 'is-on' ) && /PORT · 214 m/.test( find( 'nv-xread' ).textContent ), 'the crosshair and "PORT · 214 m" while aiming' );
	const tg = find( 'nv-tgt' );
	ok( tg.classes.has( 'is-on' ) && tg.classes.has( 'is-crippled' ), 'the target bar shows, crippled' );
	const mark = tg.children[ 1 ].children[ 1 ];
	ok( mark.style.left === '25.0%', 'with the cripple mark at 25 %' );
	hud.update( { ...model, aiming: { ...model.aiming, inArc: false } }, 0.016 );
	ok( /out of arc/.test( find( 'nv-xread' ).textContent ) && find( 'nv-xhair' ).classes.has( 'is-out' ), 'out of the traverse it says so' );
	hud.update( { ...model, aiming: null, target: null, noGun: true }, 0.016 );
	ok( ! find( 'nv-xhair' ).classes.has( 'is-on' ) && ! find( 'nv-tgt' ).classes.has( 'is-on' ) && find( 'nv-nogun' ).classes.has( 'is-on' ), 'not aiming: no crosshair; no pirate: no bar; no gun: the line' );
	hud.dispose();

}

// ================================================================================================ 11. planks headless
section( '11. planks without a scene' );
{

	const p = new Planks();
	p.burst( 0, 0, 8, 3 );
	ok( p.list.length === 8 && p.list.every( ( q ) => q.mesh === null ), 'eight planks, no meshes headless' );
	for ( let i = 0; i < 60; i ++ ) p.update( 1 / 30, i / 30 );
	ok( p.list.every( ( q ) => Math.abs( q.y ) < 1 ), 'they come down onto the water' );
	p.dispose();
	ok( p.list.length === 0, 'disposed' );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
