// Plain-node test of the ship modules (src/features/naval/Modules.js, ModuleModels.js) and the v3 naval combat work in
// Naval.js: slots per hull, buying / fitting / removing, the effects on hull, speed, guns, cargo, fish hold, night bites and
// the HUD sight, the save, the yard rows, cannonFired / cannonballImpact for every gun (player, pirate, remote, props via
// the destruction feature's raycastSegment), the vfx feature with Effects.js as the fallback, pirates hunting the nearest
// player boat (local or remote) and the sinking animation.
//   node test/feature-modules.mjs
import { readFileSync, existsSync } from 'node:fs';
import { Features } from '../src/features/Features.js';
import { Naval, hullMaxFor, GUN_LEVELS, GUN_RANGE } from '../src/features/naval/Naval.js';
import { MODULES, MODULE_IDS, SLOT_KINDS, Fitting, moduleBlock, moduleMounts, fitMounts, moduleLabel, effectText, moduleMeshUrl } from '../src/features/naval/Modules.js';
import { ModuleMeshes } from '../src/features/naval/ModuleModels.js';
import { SINK_TIME } from '../src/features/naval/Ship.js';
import { hudModel, ARROW_RANGE } from '../src/features/naval/Hud.js';
import { BOATS, BOAT_IDS, slotsOf } from '../src/game/Boats.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { Vector3, Quaternion, Group } from '../src/engine/index.js';

const root = new URL( '../', import.meta.url );
let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );

const terrain = new TerrainData();

function makeApp( over = {} ) {

	const toasts = [];
	const state = {
		boat: 'lobster', money: 0, free: false,
		earn( n ) { this.money += n; return this.money; },
		spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; },
	};
	return {
		mode: 'campaign', settings: { timeOfDay: 12 },
		terrainData: terrain, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( - 50, 0, 750 ), quaternion: new Quaternion(), velocity: new Vector3(), driven: true, moored: false },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new Vector3( - 50, 4, 440 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new Vector3( - 50, 1, 750 ) },
		input: { hit: () => false },
		game: { state, toast( t ) { toasts.push( t ); } },
		cameraFeel: { kick() {} },
		toasts,
		...over,
	};

}

const EVENTS = [ 'shipSunk', 'playerBoatDamaged', 'playerBoatSunk', 'cannonFired', 'cannonballImpact', 'moduleBought', 'moduleFitted', 'moduleRemoved' ];

function setup( { app = makeApp(), vfx = null, destruction = null, seed = 5 } = {} ) {

	const features = new Features( app );
	const events = [];
	for ( const n of EVENTS ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	if ( vfx ) features.add( 'vfx', { install: () => vfx } );
	if ( destruction ) features.add( 'destruction', { install: () => destruction } );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	return { app, features, naval, events, state: app.game.state };

}

function run( features, seconds, dt = 0.05 ) {

	for ( let i = 0, n = Math.round( seconds / dt ); i < n; i ++ ) features.update( dt );

}

const evs = ( events, name ) => events.filter( ( e ) => e[ 0 ] === name ).map( ( e ) => e[ 1 ] );

// a vfx feature stand-in that records its calls
function vfxStub() {

	const calls = [];
	const rec = ( name ) => ( ...a ) => calls.push( [ name, ...a ] );
	return { calls, muzzle: rec( 'muzzle' ), splash: rec( 'splash' ), splinters: rec( 'splinters' ), debris: rec( 'debris' ), sinking: rec( 'sinking' ), smoke: rec( 'smoke' ) };

}

// ================================================================================================ 1. catalog and assets
section( 'catalog and assets' );
{

	for ( const id of BOAT_IDS ) {

		const sl = slotsOf( id );
		ok( sl.length >= 5 && sl.every( ( k ) => SLOT_KINDS.includes( k ) ) && SLOT_KINDS.every( ( k ) => sl.includes( k ) ), `${ id }: ${ sl.length } slots, one of every kind at least` );

	}

	ok( slotsOf( 'brigantine' ).length > slotsOf( 'lobster' ).length && slotsOf( 'lobster' ).length > slotsOf( 'skiff' ).length, 'bigger hulls carry more slots' );
	for ( const id of MODULE_IDS ) {

		const m = MODULES[ id ];
		ok( SLOT_KINDS.includes( m.slot ) && m.tiers.length >= 1 && m.tiers.every( ( t, i ) => t.price > 0 && ( i === 0 || t.price > m.tiers[ i - 1 ].price ) ), `${ id }: a ${ m.slot } module, ${ m.tiers.length } tier(s) with rising prices` );
		ok( effectText( m.tiers[ 0 ] ).length > 0, `${ id }: tier 1 reads "${ effectText( m.tiers[ 0 ] ) }"` );

	}

	ok( MODULES.swivel.tiers.map( ( t ) => t.price ).join() === '600,1200,2400', 'the swivel gun keeps the yard prices of v2 ($600 / $1200 / $2400)' );
	ok( moduleBlock( 'swivel', 'sloop' ) && moduleBlock( 'swivel', 'brigantine' ) && ! moduleBlock( 'swivel', 'trawler' ) && ! moduleBlock( 'swivel', 'skiff' ), 'a ship with her own battery cannot fit the swivel gun; the trawler and the small boats can' );
	ok( moduleLabel( 'rigging', 'skiff', 1 ) === 'Light oars' && moduleLabel( 'rigging', 'cutter', 2 ) === 'Racing engine' && moduleLabel( 'rigging', 'sloop', 0 ) === 'Reinforced rigging', 'the drive module is named for the hull (oars, engine, rigging)' );

	const meshes = new Set();
	for ( const id of MODULE_IDS ) for ( const b of BOAT_IDS ) for ( let t = 1; t <= MODULES[ id ].tiers.length; t ++ ) for ( const m of moduleMounts( id, t, b, { heavy: true } ) ) meshes.add( m.mesh );
	for ( const mesh of meshes ) {

		const url = new URL( 'public' + moduleMeshUrl( mesh ), root );
		let good = false, prims = 0;
		if ( existsSync( url ) ) {

			const buf = readFileSync( url );
			try {

				const g = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
				prims = g.meshes.reduce( ( n, m ) => n + m.length, 0 );
				good = prims > 0;

			} catch ( e ) { good = false; }

		}

		ok( good, `${ mesh }.glb exists and parses (${ prims } primitives)` );

	}

	// every mount stays on the hull: inside the beam (+ a plate's thickness) and the length
	let worst = null;
	for ( const b of BOAT_IDS ) {

		const B = BOATS[ b ];
		for ( const id of MODULE_IDS ) {

			if ( moduleBlock( id, b ) ) continue;
			for ( const m of moduleMounts( id, MODULES[ id ].tiers.length, b, { heavy: true } ) ) {

				const out = Math.max( Math.abs( m.x ) - ( B.beam / 2 + 0.12 ), Math.abs( m.z ) - ( B.length / 2 + 0.2 ) );
				if ( out > 0 && ( ! worst || out > worst.out ) ) worst = { b, id, out, m };

			}

		}

	}

	ok( ! worst, worst ? `a mount leaves the hull: ${ worst.b } ${ worst.id } by ${ worst.out.toFixed( 2 ) } m` : 'every module mount sits within its hull' );
	const plates = moduleMounts( 'plating', 1, 'sloop' );
	ok( plates.length >= 4 && plates.every( ( p ) => Math.sign( p.x ) === - Math.sign( p.roll ) ), 'armour plates face outboard (roll -PI/2 to port, +PI/2 to starboard)' );

}

// ================================================================================================ 2. the fitting
section( 'fitting: buy, fit, remove, change hulls, save' );
{

	let swivel = 0;
	const f = new Fitting( { hooks: { swivel: { get: () => swivel, set: ( t ) => { swivel = t; } } } } );
	f.setBoat( 'skiff' );
	const st = { money: 1000, free: false, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	ok( f.slots().length === 5 && f.slots().every( ( s ) => ! s.module ), 'the skiff: five empty slots' );
	let r = f.buy( 'plating', st );
	ok( ! r.ok && r.reason === 'Not enough money.' && st.money === 1000, 'plating costs $1200: not affordable with $1000' );
	r = f.buy( 'lantern', st );
	ok( r.ok && r.tier === 1 && st.money === 350 && f.isFitted( 'lantern' ), 'the lantern rig: $650, fitted at once' );
	ok( ! f.buy( 'navKit', st ).ok && f.buy( 'navKit', st ).reason === 'Not enough money.', 'the spyglass is refused: not enough money' );
	st.money = 100000;
	ok( f.buy( 'navKit', st ).ok && ! f.isFitted( 'navKit' ) && f.tierOf( 'navKit' ) === 1, 'bought with the deck slot taken: kept in the store, not fitted' );
	ok( f.fitBlock( 'navKit' ).startsWith( 'Every deck slot is taken' ), 'fitting it says the deck slot is taken' );
	ok( f.fit( 'navKit', f.fitted( 'lantern' ) ) && f.isFitted( 'navKit' ) && ! f.isFitted( 'lantern' ), 'fitting into the lantern\'s slot swaps them' );
	ok( f.buy( 'swivel', st ).ok && swivel === 1 && f.isFitted( 'swivel' ), 'the swivel gun goes through its hook (tier 1)' );
	ok( f.buy( 'swivel', st ).ok && swivel === 2 && f.price( 'swivel' ) === 2400, 'a second purchase is the bronze gun; next $2400' );
	ok( f.buy( 'rigging', st ).ok && f.buy( 'rigging', st ).ok && ! f.buy( 'rigging', st ).ok, 'two drive tiers, then fully upgraded' );
	ok( near( f.stats().speed, 1.12 ) && f.stats().gun === 2 && f.stats().sight === 800, 'stats: racing oars x1.12, gun level 2, pirates seen at 800 m' );
	ok( f.remove( 'navKit' ) && f.stats().sight === ARROW_RANGE && f.tierOf( 'navKit' ) === 1, 'removing keeps it owned; the effect goes' );
	ok( f.rows( st ).length === MODULE_IDS.length && f.rows( st ).every( ( r ) => 'canBuy' in r && 'fitted' in r && 'owned' in r && 'price' in r && 'label' in r && 'desc' in r ), 'one yard row per module with the documented fields' );
	// a new hull takes over what fits
	f.buy( 'extraHold', st );
	f.setBoat( 'lobster' );
	ok( f.isFitted( 'swivel' ) && f.isFitted( 'rigging' ) && f.isFitted( 'extraHold' ) && ! f.isFitted( 'navKit' ), 'the lobster boat takes the skiff\'s fit (not the removed spyglass)' );
	f.setBoat( 'sloop' );
	ok( ! f.isFitted( 'swivel' ) && f.isFitted( 'rigging' ), 'the sloop cannot carry the swivel gun; the rigging comes along' );
	ok( f.rows( st ).find( ( r ) => r.id === 'swivel' ).blocked, 'the yard row says why (blocked)' );
	f.setBoat( 'skiff' );
	ok( f.isFitted( 'swivel' ) && ! f.isFitted( 'navKit' ), 'back on the skiff: its own remembered fit' );
	const j = JSON.parse( JSON.stringify( f.toJSON() ) );
	let sw2 = swivel;
	const g = new Fitting( { hooks: { swivel: { get: () => sw2, set: ( t ) => { sw2 = t; } } } } );
	g.fromJSON( j );
	g.setBoat( 'skiff' );
	ok( g.isFitted( 'swivel' ) && g.isFitted( 'rigging' ) && ! g.isFitted( 'navKit' ) && g.tierOf( 'navKit' ) === 1 && g.tierOf( 'rigging' ) === 2, 'the save round trip keeps tiers, fits and the removed spyglass off' );
	g.fromJSON( { tiers: { plating: 99, bogus: 3 }, fits: { skiff: [ 'lantern', 'plating' ], nope: [] } } );
	g.setBoat( 'skiff' );
	ok( g.tierOf( 'plating' ) === 2 && g.slots().every( ( s ) => ! s.module || s.module === 'plating' ), 'garbage saves are clamped and modules in the wrong slot kind dropped' );

}

// ================================================================================================ 3. effects through naval
section( 'effects on the player\'s boat' );
{

	const { features, naval, state, app } = setup();
	run( features, 0.1 );
	const base = hullMaxFor( 'lobster' );
	ok( naval.playerHull.max === base && near( naval.speedFactor, 1 ) && naval.holdBonus() === 1 && naval.fishHoldBonus() === 1 && naval.biteBonus() === 1, 'nothing fitted: neutral' );
	ok( ! naval.buyModule( 'plating' ).ok, 'no money: no plating' );
	state.money = 100000;
	naval.damagePlayer( 50, 'test' );
	ok( near( naval.playerHull.hp, base - 50 ), 'unarmoured: 50 damage costs 50 points' );
	const r = naval.buyModule( 'plating' );
	run( features, 0.05 );
	ok( r.ok && naval.playerHull.max === Math.round( base * 1.25 ) && near( naval.playerHull.hp, naval.playerHull.max - 50 ), `oak sheathing: max ${ base } -> ${ naval.playerHull.max }, the damage taken stays` );
	const hp0 = naval.playerHull.hp;
	naval.damagePlayer( 50, 'test' );
	ok( near( hp0 - naval.playerHull.hp, 45 ), 'plating: 10% less damage' );
	ok( near( naval.speedFactor, 0.99 * 0.99 ), 'the plates weigh: speed factor 0.99^2' );
	naval.buyModule( 'rigging' );
	ok( near( naval.speedFactor, ( 0.99 * 1.06 ) ** 2 ), 'a tuned engine: thrust x speed^2' );
	naval.removeModule( 'plating' );
	run( features, 0.05 );
	ok( naval.playerHull.max === base && naval.playerHull.hp <= base, 'plating unshipped: the maximum drops back' );

	// guns
	naval.playerGun.owned = true;
	ok( naval.playerGun.owned && naval.fitting.isFitted( 'swivel' ), 'buying the gun the v2 way (owned = true) fits it' );
	const r0 = naval.reloadTime();
	naval.buyModule( 'quickReload' );
	ok( near( naval.reloadTime(), r0 * 0.82 ), `shot lockers: reload ${ r0.toFixed( 2 ) } -> ${ naval.reloadTime().toFixed( 2 ) } s` );
	ok( naval.fitting.slots().filter( ( s ) => s.kind === 'arms' ).every( ( s ) => s.module ), 'the lobster boat\'s two arms slots: swivel gun and lockers' );
	ok( naval.buyModule( 'heavyGuns' ).ok && ! naval.fitting.isFitted( 'heavyGuns' ), 'heavier guns bought with both arms slots taken: kept in the store' );
	ok( naval.removeModule( 'quickReload' ) && naval.fitModule( 'heavyGuns' ) && naval.fitting.isFitted( 'heavyGuns' ), 'swap the lockers for the heavier guns' );
	naval.fire( 'port' );
	const ball = naval.balls.active[ 0 ];
	ok( ball && near( ball.damage, GUN_LEVELS[ 1 ].damage * 1.25 ), `heavy shot: ${ ball && ball.damage } damage a ball` );
	ok( naval.removeModule( 'swivel' ) && ! naval.playerGun.owned && naval.playerGun.bought, 'the swivel gun unshipped: still bought, not usable' );
	naval.reloadLeft.port = naval.reloadLeft.starboard = 0;
	ok( naval.fire( 'starboard' ) === false, 'and it does not fire' );
	ok( naval.fitModule( 'quickReload' ) && ! naval.fitModule( 'swivel' ) && naval.fitting.fitBlock( 'swivel' ).startsWith( 'Every arms slot' ), 'the lockers take its slot: no room for the gun until something comes off' );
	naval.removeModule( 'heavyGuns' );
	ok( naval.fitModule( 'swivel' ) && naval.playerGun.owned, 'refitted: it fires again' );
	ok( naval.buyModule( 'swivel' ).ok && naval.playerGun.level === 2, 'the yard sells the bronze gun as the next swivel tier (gun level 2)' );

	// cargo, fish hold, lantern, spyglass
	naval.buyModule( 'extraHold' );
	naval.buyModule( 'extraHold' );
	naval.buyModule( 'fishWell' );
	ok( near( naval.holdBonus(), 1.6 ) && naval.fitting.isFitted( 'fishWell' ) && near( naval.fishHoldBonus(), 1.4 ), 'extended hold: crates x1.6 (holdBonus), fish well: kg x1.4' );
	naval.buyModule( 'lantern' );
	ok( naval.nightBiteBonus === 1.25 && naval.biteBonus() === 1, 'the lantern does nothing by day' );
	app.settings.timeOfDay = 22;
	ok( naval.biteBonus() === 1.25, 'at night at the helm: bites x1.25' );
	app.player.mode = 'walk';
	app.player.position.set( - 50, 1, 755 );
	ok( naval.biteBonus() === 1.25, 'fishing beside the boat counts' );
	app.player.position.set( 200, 1, 455 );
	ok( naval.biteBonus() === 1, 'far from the boat: no bonus' );
	app.player.mode = 'boat';
	app.settings.timeOfDay = 12;
	ok( naval.sightRange() === ARROW_RANGE, 'no spyglass: the HUD shows pirates within 400 m' );
	ok( naval.buyModule( 'navKit' ).ok && ! naval.fitting.isFitted( 'navKit' ), 'the lobster boat has one deck slot: the spyglass waits in the store' );
	ok( naval.removeModule( 'lantern' ) && naval.fitModule( 'navKit' ), 'the lantern comes off, the spyglass goes on' );
	const far = naval.spawn( 'sloop', { x: - 50, z: 750 + 650, yaw: Math.PI } );
	far.state = 'dock';
	app.camera.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0 ); // looking down -z: the sloop at +z is behind
	const m = hudModel( naval );
	ok( naval.sightRange() === 800 && m.arrows.some( ( a ) => a.id === far.id ), 'with the spyglass a pirate 650 m off gets a HUD arrow' );
	ok( state.money < 100000, 'the purchases were paid for' );

	// the save
	const j = JSON.parse( JSON.stringify( naval.toJSON() ) );
	const b = setup();
	b.naval.fromJSON( j );
	run( b.features, 0.05 );
	ok( b.naval.fitting.tierOf( 'lantern' ) === 1 && ! b.naval.fitting.isFitted( 'lantern' ) && b.naval.fitting.isFitted( 'navKit' ) && b.naval.playerGun.owned && b.naval.playerGun.level === 2 && near( b.naval.holdBonus(), 1.6 ), 'naval toJSON / fromJSON keeps the modules and the swivel tier' );
	// a v2 save: the gun, no modules
	const c = setup();
	c.naval.fromJSON( { v: 1, boat: 'lobster', hp: 100, gun: { owned: true, level: 3 } } );
	run( c.features, 0.05 );
	ok( c.naval.playerGun.owned && c.naval.fitting.isFitted( 'swivel' ) && c.naval.playerGun.level === 3 && c.naval.playerHull.hp === 100, 'a v2 save: the bought swivel gun is fitted, its level kept' );
	c.naval.reset();
	ok( ! c.naval.playerGun.owned && c.naval.fitting.tierOf( 'swivel' ) === 0 && MODULE_IDS.every( ( id ) => c.naval.fitting.tierOf( id ) === 0 ), 'reset() clears every module' );
	// sandbox: free
	const d = setup();
	d.state.free = true;
	ok( d.naval.buyModule( 'plating' ).ok && d.naval.buyModule( 'plating' ).ok && d.state.money === 0 && d.naval.moduleRows().find( ( r ) => r.id === 'plating' ).tier === 2, 'sandbox: modules are free' );
	ok( d.naval.moduleSlots().length === slotsOf( 'lobster' ).length && d.naval.moduleSlots()[ 0 ].label === 'Hull' && d.naval.moduleSlots()[ 0 ].moduleLabel === 'Iron plating', 'moduleSlots() names the slots and what sits in them' );
	ok( evs( d.events, 'moduleBought' ).length === 2 && evs( d.events, 'moduleBought' )[ 1 ].tier === 2, 'moduleBought { id, tier, price } per purchase' );

}

// ================================================================================================ 4. events and effects
section( 'cannonFired / cannonballImpact, vfx and the Effects fallback' );
{

	// without a vfx feature: Effects.js draws
	{

		const { features, naval, events } = setup();
		run( features, 0.05 );
		naval.playerGun.owned = true;
		naval.fire( 'port' );
		const f = evs( events, 'cannonFired' );
		ok( f.length === 1 && f[ 0 ].by === 'player' && f[ 0 ].side === 'port' && Number.isFinite( f[ 0 ].x ) && near( Math.hypot( f[ 0 ].dir.x, f[ 0 ].dir.y, f[ 0 ].dir.z ), 1, 1e-6 ), 'cannonFired { x, y, z, dir (unit), side: port, by: player }' );
		ok( naval.fx.counts.muzzle === 1, 'no vfx feature: Effects.js draws the muzzle' );
		run( features, 4 );
		const imp = evs( events, 'cannonballImpact' );
		ok( imp.length === 1 && imp[ 0 ].hit === 'water' && imp[ 0 ].energy > 5000 && imp[ 0 ].owner === 'player', `the ball lands: cannonballImpact hit water, energy ${ imp[ 0 ] && imp[ 0 ].energy } J` );
		ok( naval.fx.counts.splash >= 1, 'and Effects.js splashes' );

	}

	// with a vfx feature and a destruction feature
	{

		const vfx = vfxStub();
		let rays = 0;
		const destruction = {
			raycastSegment( ax, ay, az, bx, by, bz ) {

				rays ++;
				// a crate standing 30 m to port of the boat: a wall at x = -50 + 30
				const wx = - 20;
				if ( ( ax - wx ) * ( bx - wx ) > 0 || ay < 0 ) return null;
				const t = ( wx - ax ) / ( bx - ax );
				return { t, id: 'crate-1', x: wx, y: ay + ( by - ay ) * t, z: az + ( bz - az ) * t };

			},
		};
		const { features, naval, events } = setup( { vfx, destruction } );
		run( features, 0.05 );
		naval.playerGun.owned = true;
		// the boat heads +z (identity quaternion): port (+x) faces the crate
		naval.fire( 'port' );
		ok( naval.fx.counts.muzzle === 0 && vfx.calls.length === 0, 'with the vfx feature installed naval draws nothing itself (vfx reads cannonFired)' );
		run( features, 2 );
		const imp = evs( events, 'cannonballImpact' );
		ok( rays > 0 && imp.length === 1 && imp[ 0 ].hit === 'prop' && imp[ 0 ].target === 'crate-1' && near( imp[ 0 ].x, - 20, 1e-6 ), 'every step asks destruction.raycastSegment; the crate stops the ball (hit prop, target crate-1)' );
		ok( naval.fx.counts.hit === 0 && naval.fx.counts.splash === 0 && vfx.calls.length === 0, 'and no Effects.js splinters / splashes either (vfx reads cannonballImpact)' );

		// a pirate's broadside at us: by pirate, then a hit on our hull
		const s = naval.spawn( 'sloop', { x: - 50 - 110, z: 750, yaw: 0 } ); // our boat abeam to her port (+x)
		s.state = 'broadside';
		naval._refreshTarget();
		naval._gatherTargets( 0.05 );
		naval._targetFor( s );
		const before = evs( events, 'cannonFired' ).length;
		ok( naval._shipFire( s, 'port' ), 'the pirate fires her port battery' );
		run( features, 3 );
		const fired = evs( events, 'cannonFired' ).slice( before );
		ok( fired.length === s.gunStations( 'port' ).length && fired.every( ( e ) => e.by === 'pirate' && e.side === 'port' && e.owner === s.id ), `every pirate gun: cannonFired by pirate (${ fired.length })` );
		const hits = evs( events, 'cannonballImpact' ).filter( ( e ) => e.owner === s.id );
		ok( hits.length === fired.length && hits.every( ( e ) => [ 'water', 'ship', 'land', 'prop' ].includes( e.hit ) ), `each of her balls ends in a cannonballImpact (${ hits.map( ( e ) => e.hit ).join( ', ' ) })` );

		// a remote ball
		const n0 = evs( events, 'cannonFired' ).length;
		naval.remoteShot( [ 0, 3, 600 ], [ 0, 0.05, 1 ], 120, { owner: 'remote:p2', damage: 0, faction: 'player' } );
		const rf = evs( events, 'cannonFired' ).slice( n0 );
		ok( rf.length === 1 && rf[ 0 ].by === 'remote' && rf[ 0 ].owner === 'remote:p2', 'remoteShot: cannonFired by remote' );
		run( features, 4 );
		ok( evs( events, 'cannonballImpact' ).some( ( e ) => e.owner === 'remote:p2' ), 'a remote ball ends in a cannonballImpact too' );
		ok( naval.remoteShot( [ 'a' ], [ 0, 0, 1 ], 120, {} ) === null, 'garbage remote shots are ignored' );

		// sinking: list, settle, sink, then removal; shipSunk once; the vfx feature's sinking()
		const victim = naval.spawn( 'sloop', { x: - 50 + 120, z: 750, yaw: 0 } );
		victim.state = 'dock';
		naval._shipHit( { owner: 'player', damage: 1e4, travelled: 0 }, victim, 'hull', { x: victim.x, y: 1, z: victim.z } );
		ok( victim.state === 'sinking' && evs( events, 'shipSunk' ).length === 1 && naval.fx.counts.splash === 0, 'at 0 hp she starts sinking; shipSunk (vfx draws the sinking from it, no Effects.js splash)' );
		const p0 = victim.finalPose( {} );
		run( features, SINK_TIME * 0.5 );
		const p1 = victim.finalPose( {} );
		ok( Math.abs( p1.roll ) > Math.abs( p0.roll ) + 0.3 && p1.y < p0.y - 0.3, `she lists (${ p0.roll.toFixed( 2 ) } -> ${ p1.roll.toFixed( 2 ) } rad) and settles (${ p0.y.toFixed( 2 ) } -> ${ p1.y.toFixed( 2 ) } m)` );
		ok( naval.ships.includes( victim ), 'still afloat half way through the animation' );
		run( features, SINK_TIME * 0.6 );
		ok( ! naval.ships.includes( victim ) && evs( events, 'shipSunk' ).length === 1, 'removed when the animation is over; shipSunk only once' );

	}

}

// ================================================================================================ 5. pirates hunt any player
section( 'pirates go for the nearest player boat, local or remote' );
{

	const peers = new Map();
	const peer = { id: 'p2', boat: {}, hasPose: true, boatPos: new Vector3( - 50 + 160, 0, 750 + 520 ), boatState: { driven: true } };
	peers.set( 'p2', peer );
	const app = makeApp( { remotePlayers: { peers } } );
	app.boatCtl.position.set( - 50, 0, 750 );
	const { features, naval, events } = setup( { app } );
	run( features, 0.05 );
	const s = naval.spawn( 'sloop', { x: - 50, z: 750 + 520, yaw: 0 } ); // 520 m from us, 160 m from the other player
	run( features, 1.5 );
	ok( s.tgt && s.tgt.remote === 'p2' && ( s.state === 'chase' || s.state === 'broadside' ), `she goes for the other player's boat (state ${ s.state })` );
	// the other player ties up in harbour: we are next
	peer.boatState.driven = false;
	peer.boatPos.set( 2000, 0, 2000 );
	run( features, 1.5 );
	ok( s.tgt === naval.target && naval.target.ok, 'the other boat gone: she turns on ours' );
	// both legal, ours nearer
	peer.boatState.driven = true;
	peer.boatPos.set( s.x + 600, 0, s.z );
	run( features, 0.5 );
	ok( s.tgt === naval.target, 'ours is nearer: she keeps on us' );
	// a peer without a boat is never a target
	peers.set( 'p3', { id: 'p3', boat: null, hasPose: true, boatPos: new Vector3( s.x + 10, 0, s.z ) } );
	run( features, 0.2 );
	ok( s.tgt === naval.target, 'a swimmer / walker is no target' );
	// her guns aim at her own quarry: put the remote boat abeam to port at 100 m and fire
	peers.delete( 'p3' );
	app.boatCtl.driven = false;
	app.boatCtl.moored = true;
	peer.boatPos.set( s.x + Math.cos( s.yaw ) * 100, 0, s.z - Math.sin( s.yaw ) * 100 );
	run( features, 0.1 );
	const n0 = evs( events, 'cannonFired' ).length;
	s.reload.port = 0;
	const fired = naval._shipFire( s, 'port' );
	run( features, 1.2 );
	const shots = evs( events, 'cannonFired' ).slice( n0 ).filter( ( e ) => e.owner === s.id );
	const aimed = shots.length > 0 && shots.every( ( e ) => {

		const dx = peer.boatPos.x - e.x, dz = peer.boatPos.z - e.z, l = Math.hypot( dx, dz ), hl = Math.hypot( e.dir.x, e.dir.z );
		return ( dx * e.dir.x + dz * e.dir.z ) / ( l * hl ) > 0.95;

	} );
	ok( fired && aimed, `her broadside is laid on the remote boat (${ shots.length } guns), our moored boat is no target` );

}

// ================================================================================================ 6. the meshes on the hull
section( 'module meshes on the hull' );
{

	const loads = [];
	const loader = async ( url ) => {

		loads.push( url );
		const mk = ( name ) => ( { name, geometry: {}, material: { name }, castShadow: true, receiveShadow: true, renderOrder: 0 } );
		return { meshes: [ mk( 'nvmod-wood' ), ...( /Lantern/.test( url ) ? [ mk( 'nvmod-glass' ) ] : [] ) ], materials: [ { name: 'nvmod-wood' }, ...( /Lantern/.test( url ) ? [ { name: 'nvmod-glass' } ] : [] ) ], dispose() {} };

	};
	const mm = new ModuleMeshes( { baseUrl: '/', loader } );
	let swivel = 0;
	const f = new Fitting( { hooks: { swivel: { get: () => swivel, set: ( t ) => { swivel = t; } } } } );
	f.setBoat( 'cutter' );
	const st = { money: 1e6, spend( n ) { this.money -= n; return true; } };
	for ( const id of [ 'plating', 'swivel', 'lantern', 'extraHold', 'rigging' ] ) f.buy( id, st );
	const model = { id: 'cutter', group: new Group() };
	mm.sync( f, model, 0 );
	await new Promise( ( r ) => setTimeout( r, 20 ) );
	mm.sync( f, model, 1 );
	const g = model.group.children.find( ( c ) => c.name === 'nv-modules' );
	const want = fitMounts( f ).length;
	ok( g && g.children.length === want && want >= 6, `the fitted modules hang on the cutter: ${ g ? g.children.length : 0 } of ${ want } mounts` );
	ok( loads.every( ( u ) => u.startsWith( '/models/modules/SM_Module_' ) && u.endsWith( '.glb' ) ) && new Set( loads ).size === loads.length, 'each kit mesh is loaded once from models/modules' );
	const lantern = mm.templates.get( 'SM_Module_Lantern' );
	ok( lantern && lantern.glb.glass && lantern.glb.glass.emissive && lantern.glb.glass.emissive[ 0 ] > 0, 'at night the lantern glass glows' );
	f.remove( 'lantern' );
	mm.sync( f, model, 1 );
	const g2 = model.group.children.find( ( c ) => c.name === 'nv-modules' );
	ok( model.group.children.filter( ( c ) => c.name === 'nv-modules' ).length === 1 && g2.children.length === fitMounts( f ).length, 'a change rebuilds the set (one group, the lantern gone)' );
	mm.sync( f, { id: 'skiff', group: new Group() }, 0 );
	ok( ! model.group.children.some( ( c ) => c.name === 'nv-modules' ), 'another hull model (the fit is for the cutter): nothing shown on it' );
	mm.dispose();

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
