// Plain-node test of the on-foot melee feature (src/features/melee): raider AI timings, block / evade, the
// punish window, knockdown + respawn, camp spots on the real terrain, stamina, the clock and the save.
// No GPU, no GLBs: stub avatars / models, a stub player and input, the real TerrainData, Colliders and Features.
//   node test/feature-melee.mjs
import { PerspectiveCamera, Vector3, Group } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Features } from '../src/features/Features.js';
import { CLIPS } from '../src/game/Characters.js';
import { YARD } from '../src/game/BoatYard.js';
import { ROID } from '../src/game/CaptainRoid.js';
import { CHANDLERY } from '../src/game/Chandlery.js';
import * as meleeModule from '../src/features/melee/index.js';
import { Melee, GUARD } from '../src/features/melee/index.js';
import {
	PLAYER, RAIDER, CAPTAIN, CLOCK, SLOTS, CAMP, yawToward, facingDot, isNight, crossed, hoursForward,
} from '../src/features/melee/MeleeData.js';
import { MeleeHud, project } from '../src/features/melee/MeleeHud.js';
import { CombatAudio, BANKS } from '../src/features/melee/CombatAudio.js';
import { Telegraph } from '../src/features/melee/Telegraph.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, eps = 1e-3 ) => Math.abs( a - b ) <= eps;
const DT = 1 / 60;

const terrain = new TerrainData();

// ---------------------------------------------------------------- stubs

class FakeModel {

	constructor( clips ) {

		this.clips = new Set( clips );
		this.calls = [];
		this.updates = 0;
		this.holds = 0;
		this.cur = null;
		this.layer = null;
		this.materials = [ { name: 'skin', emissive: { r: 0, g: 0, b: 0 } }, { name: 'eye', emissive: { r: 0.1, g: 0.1, b: 0.1 } } ];
		for ( const m of this.materials ) {

			const e = m.emissive;
			Object.defineProperty( m, 'emissive', { get: () => e, set: ( v ) => { e.r = v[ 0 ]; e.g = v[ 1 ]; e.b = v[ 2 ]; }, configurable: true } );

		}

	}

	get current() {

		return this.cur;

	}

	play( name, { fade = 0.4, loop = true, speed = 1 } = {} ) {

		if ( ! this.clips.has( name ) ) throw new Error( 'no clip ' + name );
		if ( name === this.cur && this.layer ) return this.layer;
		this.calls.push( { name, fade, loop, speed } );
		this.cur = name;
		this.layer = { name, time: 0, speed, ended: false, loop };
		return this.layer;

	}

	update( dt ) {

		this.updates ++;
		if ( this.layer ) this.layer.time += dt * this.layer.speed;

	}

	hold() {

		this.holds ++;

	}

}

const ALL_CLIPS = [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Melee_Paddle', 'Hit_Reaction', 'Knockdown', 'GetUp_Front', 'Stumble', 'Laugh', 'Look_Around', 'Swagger_Idle' ];

function avatarFactory( opts ) {

	const model = new FakeModel( ALL_CLIPS );
	const avatar = { group: new Group(), model, character: opts.character, lite: opts.lite, ready: Promise.resolve( model ), disposed: false, dispose() { this.disposed = true; } };
	avatarFactory.made.push( avatar );
	return avatar;

}

avatarFactory.made = [];

class FakeInput {

	constructor() {

		this.keys = new Set();
		this.pressed = new Set();
		this.mouseDown = false;
		this.rightDown = false;
		this.enabled = true;

	}

	down( c ) {

		return this.keys.has( c );

	}

	hit( c ) {

		return this.pressed.has( c );

	}

	endFrame() {

		this.pressed.clear();

	}

	press( c ) {

		this.pressed.add( c );

	}

}

function makeWorld( o = {} ) {

	const log = { sfx: [], events: [], toasts: [], kicks: [], pops: [] };
	const player = {
		position: new Vector3( 80, 0, - 70 ), velocity: new Vector3(), yaw: 0, stamina: 1, mode: 'walk', launched: 0, grounded: true, armInit: true, camInit: true, _camY: 1,
	};
	player.position.y = terrain.heightAt( player.position.x, player.position.z );
	const state = {
		money: o.money ?? 1000, free: false,
		earn( n ) { this.money += n; log.earned = ( log.earned || 0 ) + n; },
		spend( n ) { if ( this.free ) return true; if ( n > this.money ) return false; this.money -= n; return true; },
	};
	const rod = { equipped: false };
	const game = { state, rod, fight: null, hud: null, toast: ( t ) => log.toasts.push( t ), cancelLine: () => { log.cancelled = true; } };
	rod.equip = ( on ) => { rod.equipped = on; };
	const input = new FakeInput();
	const camera = new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 );
	const app = {
		player, input, camera, scene: { add() {}, remove() {} }, game, terrainData: terrain, colliders: new Colliders(),
		settings: { timeOfDay: o.hour ?? 12, timeSpeed: 0 }, mode: o.mode ?? 'campaign', paused: false, menuOpen: false, freeCam: false,
		avatar: { character: 'hyptile', model: new FakeModel( ALL_CLIPS ) }, audio: null, ui: null,
		cameraFeel: { kick: ( t ) => log.kicks.push( t ) },
	};
	const features = new Features( app );
	features.on( 'enemyDefeated', ( e ) => log.events.push( [ 'enemyDefeated', e ] ) );
	features.on( 'playerKnockedDown', ( e ) => log.events.push( [ 'playerKnockedDown', e ] ) );
	const audio = { played: [], play( bank, opts ) { this.played.push( { bank, ...opts } ); log.sfx.push( bank ); return true; }, lead: ( b ) => ( BANKS[ b ] ? BANKS[ b ].lead : 0 ), preload() {} };
	// wave 4: the home island is peaceful and has no camp; these tests run the AI as a slot arena on the old camp
	// (slots: SLOTS, no peace zone, no training post, no lock-on pull) - test/feature-combat.mjs covers the new rules
	const melee = features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, audio, hud: false, fx: o.fx ?? false, seed: o.seed ?? 5, captain: o.captain ?? false, slots: SLOTS, peaceZone: false, dummy: false, lockOn: false, ...( o.options || {} ) } ) } );
	return { app, features, melee, player, input, state, rod, game, log, audio };

}

// run n frames
function run( w, frames, dt = DT, each = null ) {

	for ( let i = 0; i < frames; i ++ ) {

		w.features.update( dt );
		w.input.endFrame();
		if ( each ) each( i );

	}

}

// seconds
const runFor = ( w, s, each = null ) => run( w, Math.round( s / DT ), DT, each );

// the player far enough to let r1 appear, then the first frames so it spawns
const tick = () => new Promise( ( r ) => setImmediate( r ) ); // let the avatars' ready promises resolve

async function spawnR1( w ) {

	w.player.position.set( 60, terrain.heightAt( 60, - 70 ), - 70 );
	run( w, 3 );
	await tick();
	const r = w.melee.slots[ 0 ].raider;
	return r;

}

function placePlayer( w, x, z, yaw = 0 ) {

	w.player.position.set( x, terrain.heightAt( x, z ), z );
	w.player.yaw = yaw;
	w.player.velocity.set( 0, 0, 0 );

}

// the player stands `d` m south of the raider (raiders face the water, +Z) looking at him (yaw 0 faces -Z)
function faceOff( w, r, d ) {

	placePlayer( w, r.x, r.z + d, 0 );

}

// ---------------------------------------------------------------- 1. the camp: real terrain

{

	const half = WORLD.terrainSize / 2;
	const idx = ( x, z ) => Math.floor( ( z - terrain.origin ) / terrain.texel ) * terrain.res + Math.floor( ( x - terrain.origin ) / terrain.texel );
	const houses = [
		[ 13.5, - 106.5 ], [ 26.5, - 112 ], [ 62.5, - 106 ], [ 79, - 110.5 ], [ 96, - 115.5 ], [ - 3, - 125 ], [ 16.5, - 130 ],
		[ 57.5, - 128.5 ], [ 75.5, - 132.5 ], [ 96.5, - 135 ], [ 3.5, - 151 ], [ 30.5, - 149 ], [ 55, - 152.5 ], [ 78.5, - 156 ],
		[ 67.8, - 64.6 ], [ 79.8, - 70.4 ], [ 37.2, - 72.4 ], [ 21.5, - 119.5 ], [ 68, - 124 ], [ 89, - 146 ], [ 43.5, - 155.5 ],
		[ 92.5, - 57.5 ], [ 40.2, - 113.2 ], [ 49.9, - 74.6 ], [ 85.5, - 60.5 ],
	];
	const boathouse = [ 92.5, - 57.5 ];
	ok( SLOTS.length === 5 && SLOTS.filter( ( s ) => s.when === 'day' ).length === 2 && SLOTS.filter( ( s ) => s.when === 'night' ).length === 2 && SLOTS.filter( ( s ) => s.when === 'captain' ).length === 1, 'camp: 2 day slots, 2 night slots, 1 captain slot' );
	ok( new Set( SLOTS.map( ( s ) => s.id ) ).size === SLOTS.length, 'camp: slot ids are unique' );
	for ( const s of SLOTS ) {

		const h = terrain.heightAt( s.x, s.z ), k = idx( s.x, s.z );
		ok( s.x >= 115 && s.x <= 140, `${ s.id }: x ${ s.x } is east of the boathouse (115..140)` );
		ok( terrain.sand[ k ] > 0 && terrain.rock[ k ] < 0.2, `${ s.id }: on sand (sand flag ${ terrain.sand[ k ] }, rock ${ terrain.rock[ k ].toFixed( 2 ) })` );
		ok( h > 0.4 && h < 3, `${ s.id }: dry beach, ${ h.toFixed( 2 ) } m above the sea` );
		const g = terrain.normalAt( s.x, s.z, new Vector3() );
		ok( g.y > 0.95, `${ s.id }: gentle slope (normal.y ${ g.y.toFixed( 3 ) })` );
		ok( Math.abs( s.x ) < half && Math.abs( s.z ) < half, `${ s.id }: inside the terrain` );
		ok( houses.every( ( [ bx, bz ] ) => Math.hypot( s.x - bx, s.z - bz ) > 25 ), `${ s.id }: 25+ m from every building, the boathouse, Ethena` );
		ok( Math.hypot( s.x - ROID.x, s.z - ROID.z ) > 25, `${ s.id }: 25+ m from Captain Roid (${ ROID.x.toFixed( 0 ) }, ${ ROID.z.toFixed( 0 ) })` );
		ok( Math.hypot( s.x - CHANDLERY.x, s.z - CHANDLERY.z ) > 25, `${ s.id }: 25+ m from the chandlery` );
		ok( s.x - WORLD.pier.x > 50, `${ s.id }: 50+ m from the pier line` );
		// the boat yard moorings (water, x 72..110, z -40..-10): well clear
		const dx = Math.max( 72 - s.x, 0, s.x - 110 ), dz = Math.max( - 40 - s.z, 0, s.z + 10 );
		ok( Math.hypot( dx, dz ) > 25 && Math.hypot( s.x - YARD.x, s.z - YARD.z ) > 35, `${ s.id }: ${ Math.hypot( dx, dz ).toFixed( 0 ) } m from the boat yard` );
		ok( Math.hypot( s.x - CAMP.x, s.z - CAMP.z ) <= CAMP.radius, `${ s.id }: inside the camp circle` );
		// the patrol ring (3.5 m) and the leash stay on dry sand where raiders walk
		let wet = 0;
		for ( let a = 0; a < 360; a += 30 ) if ( terrain.heightAt( s.x + Math.cos( a * Math.PI / 180 ) * 3.5, s.z + Math.sin( a * Math.PI / 180 ) * 3.5 ) <= 0.15 ) wet ++;
		ok( wet === 0, `${ s.id }: the 3.5 m patrol ring is dry` );

	}

	// the beach is wide: the shoreline (height 0.15) is 15+ m south of the nearest camp
	let shoreZ = - 100;
	for ( let z = - 90; z < - 20; z += 0.5 ) if ( terrain.heightAt( CAMP.x, z ) <= 0.15 ) { shoreZ = z; break; }
	ok( shoreZ - Math.max( ...SLOTS.map( ( s ) => s.z ) ) > 10, `shoreline at z ${ shoreZ } is 10+ m beyond the camp` );

}

// ---------------------------------------------------------------- 2. data helpers

{

	ok( near( yawToward( 0, 0, 0, - 5 ), 0 ) && near( yawToward( 0, 0, 5, 0 ), - Math.PI / 2 ) && near( Math.abs( yawToward( 0, 0, 0, 5 ) ), Math.PI ), 'yawToward: Player.yaw convention (0 faces -Z)' );
	ok( near( facingDot( 0, 0, 0, 0, - 3 ), 1 ) && near( facingDot( 0, 0, 0, 0, 3 ), - 1 ) && near( facingDot( 0, 0, 0, 3, 0 ), 0 ), 'facingDot: ahead 1, behind -1, beside 0' );
	ok( isNight( 22 ) && isNight( 3 ) && ! isNight( 12 ) && ! isNight( 5.6 ) && isNight( 19 ), 'isNight: 19:00 - 05:30' );
	ok( near( hoursForward( 23, 1 ), 2 ) && near( hoursForward( 5, 5 ), 0 ) && crossed( 5.99, 6.01, 6 ) && ! crossed( 6, 6.01, 6 ) && crossed( 23.5, 0.5, 0 ) && ! crossed( 6.1, 6.2, 6 ), 'clock helpers: hoursForward / crossed (exactly once)' );
	// (wave 12E retuned these against the play harness, test/feature-combat-play.mjs)
	ok( RAIDER.windup === 0.68 && RAIDER.recover === 0.8 && RAIDER.notice === 12 && PLAYER.attackContact === 0.3 && PLAYER.evadeInvuln === 0.3 && PLAYER.downTime === 3 && PLAYER.engageRange === 6, 'tuning matches wave 12E (0.68 s telegraph, 0.8 s punish, 12 m notice, 0.3 s contact, 0.3 s i-frames, 3 s down, 6 m)' );
	ok( CAPTAIN.hp > RAIDER.hp && CAPTAIN.damage > RAIDER.damage && CAPTAIN.armored && ! RAIDER.armored, 'the captain is tougher and armoured' );
	ok( PLAYER.attackDamage * 5 >= RAIDER.hp && PLAYER.attackDamage * 4 < RAIDER.hp, 'five plain blows put a tier 2 raider down, four do not' );

}

// ---------------------------------------------------------------- 3. install, keys, spawning, day / night

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee;
	ok( m instanceof Melee && w.features.get( 'melee' ) === m, 'installs through Features.add( "melee", module )' );
	ok( meleeModule.install( { ...w.app, meleeOptions: { hud: false, fx: false, peaceful: true, avatarFactory, audio: w.audio } }, { claimKey: () => true } ).peaceful === true, 'install() reads app.meleeOptions when Features.add passes no options' );
	ok( ! w.features.claimKey( 'KeyQ', 'someoneElse' ) && w.features.claimKey( 'KeyQ', 'melee' ), 'claims KeyQ: nobody else can take it' );
	ok( typeof m.update === 'function' && typeof m.dispose === 'function' && typeof m.toJSON === 'function' && typeof m.fromJSON === 'function' && typeof m.reset === 'function' && typeof m.wantsMouse === 'function', 'interface: update / dispose / toJSON / fromJSON / reset / wantsMouse' );
	ok( Array.isArray( m.raiders ) && m.playerHp === 100 && m.playerAction === null, 'interface: raiders[], playerHp 100, playerAction null' );

	// the player is 70 m from the camp: raiders are created (their GLB loads) once the player is inside 150 m
	w.player.position.set( - 100, terrain.heightAt( - 100, - 70 ), - 70 );
	run( w, 5 );
	ok( m.raiders.length === 0, 'no avatar is created while the player is 220 m away' );
	w.player.position.set( 60, terrain.heightAt( 60, - 70 ), - 70 );
	run( w, 3 );
	const active = () => m.raiders.filter( ( r ) => r.active && r.state !== 'gone' );
	ok( active().length === 2 && active().every( ( r ) => r.slot.when === 'day' ), 'by day two raiders camp (r1, r2)' );
	ok( avatarFactory.made.every( ( a ) => a.lite === true ), 'raiders use lite avatars' );
	ok( m.raiders.every( ( r ) => r.avatar.character !== 'hyptile' ), 'raider characters differ from the player\'s' );
	const names = active().map( ( r ) => r.name );
	ok( new Set( names ).size === names.length && names.every( ( n ) => n.length > 2 ), `raiders are named: ${ names.join( ', ' ) }` );
	ok( active().every( ( r ) => near( r.x, r.homeX ) && near( r.z, r.homeZ ) && r.y > 0.4 ), 'raiders stand at their camp spots on the sand' );
	ok( active().every( ( r ) => r.avatar.group.visible ), 'raider groups are visible' );
	ok( ! m.captain.active && ! m.slots[ 4 ].raider, 'no captain when the roll fails' );

	// night: two more
	w.app.settings.timeOfDay = 21;
	run( w, 3 );
	ok( active().length === 4 && active().filter( ( r ) => r.slot.when === 'night' ).length === 2, 'by night four raiders camp' );
	// dawn: the night pair leaves again (idle, out of sight of the player)
	w.app.settings.timeOfDay = 8;
	run( w, 3 );
	ok( active().length === 2 && active().every( ( r ) => r.slot.when === 'day' ), 'at dawn the night raiders leave' );
	// they do not pop in or out inside 25 m of the player
	w.app.settings.timeOfDay = 22;
	placePlayer( w, 118, - 70 );
	const n0 = active().length;
	run( w, 3 );
	ok( active().length === n0 || active().length === 3, 'nothing appears inside 25 m of the player' );
	ok( ! active().some( ( r ) => r.slot.id === 'r3' ), 'r3 (18 m from the player) is not spawned in view' );
	placePlayer( w, 60, - 70 );
	run( w, 3 );
	ok( active().length === 4, 'once the player is away the night raiders appear' );
	w.melee.dispose();

}

// ---------------------------------------------------------------- 4. raider AI timings

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee;
	const r = await spawnR1( w );
	ok( r && r.state === 'idle', 'r1 camps idle' );
	m.combat.hurtInv = 1e9; // the timings below are about him, not about damage
	// outside 12 m he stays put
	placePlayer( w, r.x, r.z + 13.5 );
	runFor( w, 1 );
	ok( r.state === 'idle' || r.state === 'patrol', 'a player 13.5 m away is not noticed' );
	r.state = 'idle'; r._enter( 'idle' );
	placePlayer( w, r.x, r.z + 11.5 );
	run( w, 2 );
	ok( r.state === 'notice' && r.aggro, 'inside 12 m he notices' );
	const t0 = m.time;
	runFor( w, 0.45 );
	ok( r.state === 'notice', 'the notice beat lasts about 0.5 s' );
	runFor( w, 0.12 );
	ok( r.state === 'approach', 'then he approaches' );
	// approach speed
	const x1 = r.x, z1 = r.z, ta = m.time;
	runFor( w, 1 );
	const sp = Math.hypot( r.x - x1, r.z - z1 ) / ( m.time - ta );
	ok( sp > RAIDER.speed * 0.8 && sp < RAIDER.speed * 1.2, `approach speed ${ sp.toFixed( 2 ) } m/s (about ${ RAIDER.speed })` );
	// fixed player 5 m away: record the whole attack cycle
	placePlayer( w, r.x, r.z + 1.9, 0 );
	let tWind = null, tStrike = null, tRecover = null, tApproach = null, alertSeen = false, ringOnlyInWindup = true, outcome0 = null;
	const seen = [];
	runFor( w, 3.5, () => {

		if ( seen[ seen.length - 1 ] !== r.state ) seen.push( r.state );
		if ( r.alert !== ( r.state === 'windup' ) ) ringOnlyInWindup = false;
		if ( r.state === 'windup' ) { alertSeen = true; if ( tWind === null ) tWind = m.time; }
		if ( r.state === 'strike' && tStrike === null ) { tStrike = m.time; outcome0 = r.outcome; }
		if ( r.state === 'recover' && tRecover === null ) tRecover = m.time;
		if ( r.state === 'approach' && tRecover !== null && tApproach === null ) tApproach = m.time;

	} );
	ok( alertSeen && ringOnlyInWindup, 'the telegraph (alert) is on exactly during the wind-up' );
	ok( tStrike - tWind > RAIDER.windup - 0.02 && tStrike - tWind < RAIDER.windup + 0.04, `wind-up lasts ${ ( tStrike - tWind ).toFixed( 3 ) } s (${ RAIDER.windup })` );
	ok( tRecover - tStrike > 0.1 && tRecover - tStrike < 0.15, `strike lasts ${ ( tRecover - tStrike ).toFixed( 3 ) } s (0.12)` );
	ok( tApproach - tRecover > 0.78 && tApproach - tRecover < 0.86, `recovery (punish window) lasts ${ ( tApproach - tRecover ).toFixed( 3 ) } s (0.8)` );
	ok( seen.join( ' ' ).startsWith( 'approach windup strike recover approach' ) || seen.join( ' ' ).startsWith( 'windup strike recover approach' ), `state order: ${ seen.slice( 0, 6 ).join( ' > ' ) }` );
	ok( outcome0 === 'ignored', 'his first blow resolved (ignored here: the player had hit-protection)' );

	// the swing clip contact (0.3 s into Melee_Paddle) lands when the wind-up ends: speed 0.5, then 1
	const calls = r.model.calls.filter( ( c ) => c.name === 'Melee_Paddle' );
	ok( calls.length >= 1 && near( calls[ 0 ].speed, 0.3 / RAIDER.windup, 0.01 ) && calls[ 0 ].loop === false, `Melee_Paddle plays one-shot slowed through the wind-up (contact at 0.3 s = end of the ${ RAIDER.windup } s telegraph)` );
	ok( r.model.calls.some( ( c ) => c.name === 'Run_InPlace' ) && r.model.calls.some( ( c ) => c.name === 'Idle_Breathe' ), 'he ran in and idled' );

	// leash: the player runs far off; he walks home
	r.state = 'approach'; r._enter( 'approach' );
	placePlayer( w, r.x - 40, r.z + 20 );
	runFor( w, 5 );
	ok( r.state === 'return' || r.state === 'idle' || r.state === 'patrol', `a player who leaves is not chased past the leash (${ r.state })` );
	runFor( w, 25 );
	ok( ( r.state === 'idle' || r.state === 'patrol' ) && Math.hypot( r.x - r.homeX, r.z - r.homeZ ) < 4, 'he walks back to camp' );
	ok( r.hp === r.maxHp, 'and is whole again' );
	m.dispose();

}

// ---------------------------------------------------------------- 5. block, evade, damage, punish

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	const r = await spawnR1( w );
	// the ground truth of the hit test: a blow at 2 m in front lands, behind him / far misses
	faceOff( w, r, 1.8 );
	r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z );
	c.guardHeld = false;
	c.update( DT );
	ok( m.raiderStrike( r ) === 'hit' && c.hp === 100 - RAIDER.damage, `an unguarded blow lands: hp ${ c.hp }` );
	c.reset();
	faceOff( w, r, 3.0 );
	ok( m.raiderStrike( r ) === 'missed' && c.hp === 100, 'out of reach (3 m) it misses' );
	faceOff( w, r, 1.8 );
	r.yaw += Math.PI;
	ok( m.raiderStrike( r ) === 'missed', 'a raider facing away misses' );
	r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z );

	// guard: hold RMB (rod away), face him
	c.reset();
	w.player.stamina = 1;
	c.guardHeld = true;
	c.update( DT );
	ok( c.guarding, 'holding the guard with the rod away raises it' );
	c.guardStart -= 1; // held for a while: a plain block (the parry / late timing is test/feature-combat.mjs)
	const s0 = w.player.stamina;
	ok( m.raiderStrike( r ) === 'blocked' && c.hp === 100, 'a guarded frontal blow is blocked: no damage' );
	ok( near( s0 - w.player.stamina, PLAYER.blockChip, 1e-6 ), `the block chips ${ PLAYER.blockChip } stamina` );
	// he is behind the player: the guard does not cover it
	c.reset();
	c.guardHeld = true;
	c.update( DT );
	w.player.yaw = Math.PI; // facing +Z, away from the raider who is at +... (the raider is south: z+1.8 of him is behind a player facing -Z? see below)
	// raider is at z - 1.8 relative to the player now (player stands south): the player faces +Z (away from him)
	const behind = facingDot( w.player.yaw, w.player.position.x, w.player.position.z, r.x, r.z );
	ok( behind < PLAYER.blockCone, `a blow from behind is outside the guard cone (dot ${ behind.toFixed( 2 ) })` );
	ok( m.raiderStrike( r ) === 'hit', 'and lands' );
	w.player.yaw = 0;
	// guard breaks with no stamina
	c.reset();
	c.guardHeld = true;
	w.player.stamina = 0.1;
	c.update( DT );
	ok( c.guarding, 'guard is up with 0.1 stamina' );
	c.guardStart -= 1; // held for a while (a raise one frame before the blow is a parry since wave 12E)
	ok( m.raiderStrike( r ) === 'guardBroken' && c.hp === 100 - Math.ceil( RAIDER.damage / 2 ), `with less than ${ PLAYER.blockChip } stamina the guard breaks: half damage (hp ${ c.hp })` );
	ok( w.player.stamina === 0, 'and stamina is spent' );
	// the guard needs the rod away
	c.reset();
	w.player.stamina = 1;
	w.rod.equipped = true;
	c.guardHeld = true;
	c.update( DT );
	ok( ! c.guarding, 'no guard with the rod out' );
	w.rod.equipped = false;

	// evade: i-frames negate even a blow that reaches
	c.reset();
	w.player.stamina = 1;
	faceOff( w, r, 1.8 );
	const px = w.player.position.x, pz = w.player.position.z;
	ok( c.evadePress( 0, 0, w.player.yaw ) === 'evade', 'Q starts an evade (a step back with no steering)' );
	ok( near( w.player.stamina, 1 - PLAYER.evadeStamina, 1e-6 ) && c.evadeInv > 0.2, 'evade costs 0.2 stamina and gives i-frames' );
	ok( c.takeStrike( r ) === 'dodged' && c.hp === 100, 'a blow that arrives during the i-frames is dodged' );
	for ( let i = 0; i < 13; i ++ ) c.update( DT ); // 0.2 s
	const moved = Math.hypot( w.player.position.x - px, w.player.position.z - pz );
	ok( near( moved, PLAYER.evadeDist, 0.05 ), `the dash covers ${ moved.toFixed( 2 ) } m (2) in 0.2 s` );
	ok( w.player.position.z > pz, 'a step back with no steering goes away from the facing (+Z)' );
	ok( c.state === 'free', 'back to free after 0.2 s' );
	ok( c.evadePress( 0, 0, 0 ) === 'cooldown', 'evade has a 0.5 s cooldown' );
	for ( let i = 0; i < 40; i ++ ) c.update( DT );
	ok( c.evadeInv === 0, 'i-frames last 0.25 s only' );
	ok( m.raiderStrike( r ) !== 'dodged', 'after the i-frames a blow lands (or misses by distance) but is not dodged' );
	// steered evade: W + D = forward-right
	c.reset();
	w.player.stamina = 1;
	w.player.yaw = 0;
	c.evadePress( 1, - 1, 0 ); // right (+X) and forward (-Z)
	const ex = c.evadeDir;
	ok( near( ex.x, Math.SQRT1_2, 1e-6 ) && near( ex.z, - Math.SQRT1_2, 1e-6 ), 'a steered evade goes where the player steers' );

	// hurt: damage, hurt state, i-frames, then free
	c.reset();
	w.player.stamina = 1;
	faceOff( w, r, 1.8 );
	r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z );
	m.raiderStrike( r );
	ok( c.state === 'hurt' && c.action === 'hit' && c.hurtInv > 0.4, 'a hit puts the player in hurt: action "hit"' );
	ok( m.raiderStrike( r ) === 'ignored', 'the hurt i-frames absorb a second blow' );
	ok( w.log.kicks.includes( 'meleeHurt' ), 'camera shake on damage (cameraFeel.kick "meleeHurt", falls back to "strike")' );
	runFor( w, 0.7 );
	ok( c.state === 'free', 'hurt lasts 0.6 s' );
	m.dispose();

}

// ---------------------------------------------------------------- 6. the player's blows, the punish window, defeat

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	const r = await spawnR1( w );
	w.player.stamina = 1;
	// a click with a raider 10 m away does nothing for melee
	placePlayer( w, r.x, r.z + 10 );
	ok( m.wantsMouse(), 'wantsMouse: true with the rod stowed even with no raider near (a swing at the air; a click never casts a stowed rod)' );
	placePlayer( w, r.x, r.z + 5.5 );
	ok( m.wantsMouse(), 'wantsMouse: true with a raider inside 6 m and the rod away' );
	w.rod.equipped = true;
	ok( ! m.wantsMouse(), 'wantsMouse: false with the rod out (LMB keeps casting)' );
	w.rod.equipped = false;

	// swing at a raider 2 m in front
	r.state = 'idle'; r._enter( 'idle' );
	m.peaceful = true; // he stays put while we measure the swing
	faceOff( w, r, 2.0 );
	w.input.mouseDown = true;
	run( w, 1 );
	w.input.mouseDown = false;
	ok( c.state === 'swing' && c.action === 'swing', 'LMB starts a swing: action "swing"' );
	ok( near( w.player.stamina, 1 - PLAYER.attackStamina, 0.01 ), 'a swing costs 0.08 stamina' );
	ok( m.wantsMouse(), 'wantsMouse stays true during the swing' );
	let hitT = null;
	const hp0 = r.hp;
	runFor( w, 0.45, () => { if ( hitT === null && r.hp < hp0 ) hitT = c.t; } );
	ok( hitT !== null && hitT >= 0.29 && hitT < 0.33, `the blow connects at ${ hitT && hitT.toFixed( 3 ) } s (0.3 contact)` );
	ok( r.hp === hp0 - PLAYER.attackDamage, `a plain blow does ${ PLAYER.attackDamage }: raider hp ${ r.hp }` );
	ok( r.state === 'stagger' && r.model.calls.some( ( x ) => x.name === 'Hit_Reaction' ), 'a hit outside his recovery staggers him (Hit_Reaction)' );
	ok( w.log.kicks.includes( 'meleeHit' ) || w.log.kicks.includes( 'meleeHeavy' ), 'the landing hit gives the hitstop (cameraFeel.kick "meleeHit" / "meleeHeavy", falls back to "catch")' );
	runFor( w, 0.4 );
	ok( c.state === 'free' && c.action === null, 'the swing ends at 0.7 s' );

	// cone and range: a raider behind the player is not hit (he stands still: no walking home to heal while we measure)
	r._enter( 'idle' );
	const hpB = r.hp;
	w.player.yaw = Math.PI; // faces +Z, the raider is at -Z
	w.player.stamina = 1;
	c.attackPress();
	runFor( w, 0.5 );
	ok( r.hp === hpB, 'a swing at nothing (the raider is behind) hits nothing' );
	w.player.yaw = 0;
	faceOff( w, r, 3.2 );
	w.player.stamina = 1;
	c.attackPress();
	runFor( w, 0.5 );
	ok( r.hp === hpB, 'a swing at 3.2 m is out of range (2.6)' );
	faceOff( w, r, 2.0 );

	// line of sight: a wall between blocks the blow
	const wall = w.app.colliders.addBox( new Vector3( r.x, r.y + 1, r.z + 1.0 ), new Vector3( 3, 2, 0.1 ), 0, { solid: true } );
	w.player.stamina = 1;
	c.attackPress();
	runFor( w, 0.5 );
	ok( r.hp === hpB, 'a wall between them blocks the blow (line of sight)' );
	w.app.colliders.boxes.splice( w.app.colliders.boxes.indexOf( wall ), 1 );
	runFor( w, 0.3 );

	// the punish window: a hit during his recovery does 1.5x and keeps him open
	m.peaceful = false;
	r.hp = r.maxHp;
	r.state = 'recover'; r._enter( 'recover' );
	r.t = 0.2;
	const p0 = r.hp;
	const res = r.takeHit( PLAYER.attackDamage );
	ok( res.punish && r.hp === p0 - Math.round( PLAYER.attackDamage * PLAYER.punishBonus ), `a hit in the recovery does ${ Math.round( PLAYER.attackDamage * PLAYER.punishBonus ) } (punish): hp ${ r.hp }` );
	ok( r.state === 'recover' && r.t <= RAIDER.recover - 0.44, 'and he stays open: the recovery is topped up' );
	ok( r.punish, 'the punish flag is on during the recovery' );

	// a hit interrupts a wind-up (not the captain's)
	r.hp = r.maxHp;
	r.state = 'idle'; r._enter( 'windup' );
	r.takeHit( 10 );
	ok( r.state === 'stagger' && ! r.alert, 'a hit interrupts a wind-up: the telegraph stops' );
	const capSlot = m.slots[ 4 ];
	m.captain.active = true;
	w.player.position.set( 40, terrain.heightAt( 40, - 70 ), - 70 );
	run( w, 3 );
	const cap = capSlot.raider;
	ok( cap && cap.kind === 'captain' && cap.name.startsWith( 'Captain' ) && cap.maxHp === CAPTAIN.hp && cap.scale > 1, `the captain camps: ${ cap && cap.name } (${ cap && cap.maxHp } hp, scale ${ cap && cap.scale })` );
	cap._enter( 'windup' );
	cap.takeHit( 10 );
	ok( cap.state === 'windup', 'the captain\'s wind-up is armoured: a hit does not interrupt it' );
	ok( cap.cfg.windup < RAIDER.windup && cap.cfg.damage > RAIDER.damage, 'the captain is quicker and hits harder' );
	cap.deactivate();
	m.captain.active = false;

	// knocked down: three blows, the event, the respawn timer, then he flees or lies down and goes
	const r2 = m.slots[ 1 ].raider;
	r2.spawn( { name: 'Test' } );
	placePlayer( w, r2.x, r2.z + 2, 0 );
	let down = null;
	const blows = Math.ceil( r2.maxHp / PLAYER.attackDamage );
	for ( let i = 0; i < blows; i ++ ) down = r2.takeHit( PLAYER.attackDamage );
	ok( down.killed && r2.hp === 0 && r2.state === 'down', `${ blows } blows knock a raider down (hp 0)` );
	const ev = w.log.events.find( ( e ) => e[ 0 ] === 'enemyDefeated' );
	ok( ev && ev[ 1 ].kind === 'raider' && ev[ 1 ].name === 'Test' && ev[ 1 ].id.startsWith( 'r2#' ), `enemyDefeated { id, name, kind: "raider" } emitted: ${ JSON.stringify( ev && ev[ 1 ] ) }` );
	ok( m.slots[ 1 ].respawnLeft === CLOCK.respawnHours && m.kills === 1, 'the slot is on a 24 in-game-hour respawn timer' );
	ok( w.log.earned === RAIDER.loot, `campaign loot paid: $${ w.log.earned }` );
	ok( ! r2.targetable && r2.model.calls.some( ( x ) => x.name === 'Knockdown' ), 'a downed raider plays Knockdown and cannot be hit' );
	ok( r2.takeHit( 50 ).dealt === 0, 'hitting him again does nothing' );
	r2.flees = true;
	runFor( w, RAIDER.downTime + 0.1 );
	ok( r2.state === 'getup' && r2.model.calls.some( ( x ) => x.name === 'GetUp_Front' ), 'a fleeing raider gets up (GetUp_Front)' );
	runFor( w, RAIDER.getUpTime + 0.2 );
	ok( r2.state === 'flee', 'then runs' );
	const before = Math.hypot( r2.x - w.player.position.x, r2.z - w.player.position.z );
	runFor( w, 2 );
	const after = Math.hypot( r2.x - w.player.position.x, r2.z - w.player.position.z );
	ok( after > before + 2, `he runs away from the player (${ before.toFixed( 1 ) } -> ${ after.toFixed( 1 ) } m)` );
	runFor( w, RAIDER.fleeTime + 0.5 );
	ok( r2.state === 'gone' && ! r2.avatar.group.visible && ! r2.visible, 'and is gone' );
	// the one that stays down
	r2.spawn( { name: 'Test2' } );
	m.slots[ 1 ].respawnLeft = 0;
	r2.hp = 1;
	r2.flees = false;
	r2.takeHit( 10 );
	r2.flees = false;
	runFor( w, RAIDER.downTime + 0.2 );
	ok( r2.state === 'down', `a beaten raider who does not run stays down past ${ RAIDER.downTime } s` );
	runFor( w, RAIDER.outTime );
	ok( r2.state === 'gone', 'and is dragged off after the down time' );
	m.dispose();

}

// ---------------------------------------------------------------- 7. knockdown, cash, respawn at the pier

{

	const w = makeWorld( { hour: 12, money: 1000 } );
	const m = w.melee, c = m.combat;
	const r = await spawnR1( w );
	faceOff( w, r, 1.8 );
	r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z );
	r.state = 'approach';
	w.rod.equipped = true;
	c.hp = 10;
	const res = m.raiderStrike( r );
	ok( res === 'knockedDown' && c.state === 'down' && c.hp === 0, 'a blow at 10 hp knocks the player down' );
	ok( w.state.money === 900 && c.lostCash === 100, `10 % of the cash carried is lost ($${ w.state.money } left of 1000)` );
	const ev = w.log.events.find( ( e ) => e[ 0 ] === 'playerKnockedDown' );
	ok( ev && ev[ 1 ].by === r.name && ev[ 1 ].cashLost === 100, `playerKnockedDown { by } emitted: ${ JSON.stringify( ev && ev[ 1 ] ) }` );
	ok( ! w.rod.equipped && w.log.cancelled, 'the rod is put away and the line cancelled' );
	ok( m.playerAction === 'knockdown' && m.wantsMouse() && m.playerDown, 'playerAction "knockdown"; the mouse belongs to melee' );
	const startX = w.player.position.x;
	let sawBlack = false, sawGetUp = false, lockedAlways = true, teleported = null;
	const actions = [];
	const feetAt = () => ( { x: w.player.position.x, z: w.player.position.z } );
	runFor( w, PLAYER.downTime + 0.2, () => {

		if ( actions[ actions.length - 1 ] !== m.playerAction ) actions.push( m.playerAction );
		if ( c.fade > 0.99 ) sawBlack = true;
		if ( c.state === 'down' && ! ( w.player.launched > 0 ) ) lockedAlways = false;
		if ( teleported === null && Math.abs( w.player.position.x - startX ) > 20 ) teleported = { t: c.t, ...feetAt() };

	} );
	ok( actions.join( ',' ) === 'knockdown,getUp,', `action sequence: ${ actions.join( ' > ' ) } (knockdown, getUp, null)` );
	ok( sawBlack, 'the screen cuts to black while the player is carried off' );
	ok( lockedAlways, 'the player\'s controls are locked while down (Player.launched)' );
	ok( teleported && Math.hypot( teleported.x - WORLD.pier.x, teleported.z - ( WORLD.pier.zStart + 5 ) ) < 1, `respawned at the nearest pier (${ teleported && teleported.x.toFixed( 1 ) }, ${ teleported && teleported.z.toFixed( 1 ) })` );
	ok( c.state === 'free' && c.hp === 100 && w.player.armInit === false, 'on his feet at 3 s with full health, camera arm reset' );
	ok( c.hurtInv > 1, 'with a moment of protection' );
	ok( w.log.toasts.some( ( t ) => /pier/.test( t ) && /100/.test( t ) ), 'toast tells where and what was lost' );
	// nearest pier: from Pons Cove the dock wakes you
	const w2 = makeWorld( { hour: 12 } );
	w2.player.position.set( 560, 0, 500 );
	const pt = w2.melee.respawnPoint();
	ok( Math.hypot( pt.x - WORLD.pons.dock.start.x, pt.z - WORLD.pons.dock.start.z ) < 5, 'near Pons Cove the respawn is the Pons dock' );
	// sandbox: no cash is lost
	const w3 = makeWorld( { hour: 12, mode: 'sandbox', money: 500 } );
	w3.state.free = true;
	const r3 = await spawnR1( w3 );
	faceOff( w3, r3, 1.8 );
	r3.yaw = yawToward( r3.x, r3.z, w3.player.position.x, w3.player.position.z );
	w3.melee.combat.hp = 5;
	w3.melee.raiderStrike( r3 );
	ok( w3.state.money === 500 && w3.melee.combat.lostCash === 0, 'sandbox: nothing is taken' );
	// raiders taunt a player who is down, then go home
	const r4 = m.slots[ 1 ].raider;
	m.dispose();

}

// ---------------------------------------------------------------- 8. stamina

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	const r = await spawnR1( w );
	m.peaceful = true;
	faceOff( w, r, 2 );
	w.player.stamina = 0.05;
	ok( c.attackPress() === 'tired' && c.state === 'free' && near( w.player.stamina, 0.05 ), 'with 0.05 stamina a swing is refused and nothing is spent' );
	ok( w.log.toasts.includes( 'Too tired' ), 'and the player is told' );
	w.player.stamina = 0.08;
	ok( c.attackPress() === 'swing' && w.player.stamina < 0.001, 'exactly 0.08 is enough for a swing' );
	runFor( w, 0.8 );
	w.player.stamina = 0.15;
	ok( c.evadePress( 0, 0, 0 ) === 'tired' && c.state === 'free', 'evade needs 0.2 stamina' );
	w.player.stamina = 1;
	// the guard drains on top of Player's own regen
	c.guardHeld = true;
	c.update( DT );
	const s = w.player.stamina;
	for ( let i = 0; i < 60; i ++ ) c.update( DT );
	ok( near( s - w.player.stamina, PLAYER.guardDrain, 0.005 ), `holding the guard costs ${ PLAYER.guardDrain } stamina per second (${ ( s - w.player.stamina ).toFixed( 3 ) })` );
	w.player.stamina = 0.02;
	c.update( DT );
	ok( ! c.guarding, 'the guard drops when stamina is gone' );
	c.guardHeld = false;
	// a buffered press swings again as soon as the first ends
	w.player.stamina = 1;
	c.reset();
	faceOff( w, r, 2 );
	c.attackPress();
	runFor( w, 0.45 );
	c.attackPress(); // inside the last 0.3 s
	ok( c.buffer > 0, 'a second press during the swing is buffered' );
	runFor( w, 0.3 );
	ok( c.stats.swings === 2, 'and the second swing follows' );
	ok( PLAYER.attackStamina < PLAYER.evadeStamina && PLAYER.evadeStamina < 0.5, 'costs are on the 0..1 stamina scale of Player.js' );
	m.dispose();

}

// ---------------------------------------------------------------- 9. input wiring (mouse, Q) and the rod

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	const r = await spawnR1( w );
	m.peaceful = true;
	faceOff( w, r, 4 );
	// LMB with the rod out: not melee's
	w.rod.equipped = true;
	w.input.mouseDown = true;
	run( w, 1 );
	w.input.mouseDown = false;
	run( w, 1 );
	ok( c.state === 'free', 'LMB with the rod out is left to fishing' );
	w.rod.equipped = false;
	w.input.mouseDown = true;
	run( w, 1 );
	ok( c.state === 'swing', 'LMB with the rod away and a raider at 4 m swings' );
	w.input.mouseDown = false;
	runFor( w, 0.8 );
	// a held button swings once (edge), not every frame
	const sw = c.stats.swings;
	w.input.mouseDown = true;
	runFor( w, 1.5 );
	w.input.mouseDown = false;
	ok( c.stats.swings === sw + 1, 'holding LMB is one swing' );
	// RMB guard
	w.input.rightDown = true;
	run( w, 2 );
	ok( m.guarding, 'RMB held raises the guard' );
	w.input.rightDown = false;
	run( w, 2 );
	ok( ! m.guarding, 'releasing RMB lowers it' );
	// Q with steering
	w.player.stamina = 1;
	w.input.keys.add( 'KeyD' );
	w.input.press( 'KeyQ' );
	const x0 = w.player.position.x;
	run( w, 1 );
	ok( c.state === 'evade' || c.evadeCd > 0, 'Q evades' );
	runFor( w, 0.3 );
	ok( w.player.position.x - x0 > 1.5, `D + Q dashes to the right (${ ( w.player.position.x - x0 ).toFixed( 2 ) } m)` );
	w.input.keys.delete( 'KeyD' );
	// not while swimming / in a boat
	w.player.mode = 'swim';
	w.input.mouseDown = true;
	run( w, 2 );
	w.input.mouseDown = false;
	ok( ! m.wantsMouse() && c.state === 'free', 'no melee while swimming' );
	w.player.mode = 'walk';
	// raiders ignore a swimmer
	m.peaceful = false;
	r.state = 'idle'; r._enter( 'idle' );
	w.player.mode = 'boat';
	run( w, 5 );
	ok( r.state === 'idle' || r.state === 'patrol', 'raiders do not go for a player at the helm' );
	w.player.mode = 'walk';
	// auto-stow: a blow coming at a player with the rod out puts it away
	w.rod.equipped = true;
	faceOff( w, r, 1.8 );
	r.state = 'approach'; r.sinceAttack = 99;
	run( w, 3 );
	ok( ! w.rod.equipped && w.log.toasts.includes( 'Rod away · fight!' ), 'a wind-up at a player with the rod out stows it' );
	// but not with a fish on
	w.rod.equipped = true;
	w.game.fight = {};
	ok( ! m.rodAway( false ) && w.rod.equipped, 'a fish on the line keeps the rod' );
	w.game.fight = null;
	// menus and panels
	w.app.paused = true;
	w.input.mouseDown = true;
	ok( ! m.canSwing(), 'no swing while paused' );
	w.app.paused = false;
	w.game.hud = { invOpen: true };
	ok( ! m.canSwing(), 'no swing while a panel is open' );
	w.game.hud = null;
	w.input.mouseDown = false;
	// disable
	m.setEnabled( false );
	ok( m.raiders.every( ( x ) => ! x.active ) && ! m.wantsMouse() && m.playerAction === null, 'setEnabled( false ) removes the raiders and the mouse' );
	m.dispose();

}

// ---------------------------------------------------------------- 9b. the player wades where the raider cannot follow

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee;
	const r = await spawnR1( w );
	m.combat.hurtInv = 1e9;
	// a player standing in the shallows 4 m beyond the raider's dry-sand limit
	let wz = r.z;
	while ( terrain.heightAt( r.x, wz ) > 0.15 ) wz += 0.25;
	placePlayer( w, r.x, wz + 4, 0 );
	r._enter( 'approach' );
	runFor( w, 1 );
	ok( r.state === 'approach' && terrain.heightAt( r.x, r.z ) > 0.15, 'he walks down to the waterline and no further' );
	// the walk down the beach takes about 6 s at 2.5 m/s, then 1.5 s of standing at the water's edge before he gives up
	runFor( w, 12, () => {} );
	ok( r.state === 'return' || r.state === 'idle', `unable to reach the player he gives up and walks home (${ r.state })` );
	ok( r.strikeCount === 0, 'without a single blow thrown' );
	m.dispose();

}

// ---------------------------------------------------------------- 10. two raiders: one wind-up at a time

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee;
	w.player.position.set( 60, terrain.heightAt( 60, - 70 ), - 70 );
	run( w, 3 );
	await tick();
	const [ a, b ] = [ m.slots[ 0 ].raider, m.slots[ 1 ].raider ];
	m.combat.hurtInv = 1e9;
	placePlayer( w, 126, - 74, 0 );
	let both = 0, windA = 0, windB = 0, maxStrikes = 0, maxTokens = 0;
	runFor( w, 14, () => {

		// wave 4: two tokens, so both may swing, but their wind-ups never start together (TOKENS.gap)
		if ( a.state === 'windup' && b.state === 'windup' && Math.abs( a.t - b.t ) < 0.2 ) both ++;
		maxTokens = Math.max( maxTokens, m.tokens.size );
		if ( a.state === 'windup' ) windA ++;
		if ( b.state === 'windup' ) windB ++;
		maxStrikes = Math.max( maxStrikes, a.strikeCount + b.strikeCount );

	} );
	ok( both === 0, 'two raiders never start a wind-up together (attack tokens, 0.4 s apart)' );
	ok( maxTokens <= 2, `never more than two tokens out (${ maxTokens })` );
	ok( windA > 0 && windB > 0 && maxStrikes >= 4, `both take their turns (${ a.strikeCount } and ${ b.strikeCount } blows in 14 s)` );
	const d = Math.hypot( a.x - b.x, a.z - b.z );
	ok( d > 0.8, `they keep apart (${ d.toFixed( 2 ) } m)` );
	ok( [ a, b ].every( ( r ) => terrain.heightAt( r.x, r.z ) > 0.15 ), 'and stay on dry sand' );
	m.dispose();

}

// ---------------------------------------------------------------- 11. the island clock: respawn after a day, dawn captain

{

	const w = makeWorld( { hour: 8, captain: false, seed: 11 } );
	const m = w.melee;
	const r = await spawnR1( w );
	m.peaceful = true;
	r.takeHit( 500 );
	ok( m.slots[ 0 ].respawnLeft === 24, 'respawn timer starts at 24 in-game hours' );
	r.flees = false;
	const advance = ( hours, step = 0.05 ) => {

		const dt = 0.1;
		for ( let h = 0; h < hours; h += step ) {

			w.app.settings.timeOfDay = ( w.app.settings.timeOfDay + step ) % 24;
			w.features.update( dt );
			w.input.endFrame();

		}

	};

	advance( 12 );
	ok( m.slots[ 0 ].respawnLeft > 11 && m.slots[ 0 ].respawnLeft < 13, `after 12 h: ${ m.slots[ 0 ].respawnLeft.toFixed( 1 ) } h left` );
	ok( r.state === 'gone', 'and he is still gone' );
	advance( 11 );
	ok( m.slots[ 0 ].respawnLeft > 0.5 && ! m._alive( r ), 'at 23 h he is not back' );
	advance( 1.5 );
	ok( m.slots[ 0 ].respawnLeft === 0 && m._alive( r ) && r.hp === r.maxHp && r.state === 'idle', 'after a full in-game day he is back at camp, whole' );
	ok( r.spawnId.startsWith( 'r1#2' ), `a new spawn id (${ r.spawnId })` );
	// setting the clock backwards or forwards by hand is not time passing
	const left = 5;
	m.slots[ 1 ].respawnLeft = left;
	w.app.settings.timeOfDay = 3;
	w.features.update( 0.1 );
	w.app.settings.timeOfDay = 15;
	w.features.update( 0.1 );
	ok( m.slots[ 1 ].respawnLeft > left - 0.1, 'a jump of the clock (sandbox time slider) does not count as elapsed time' );
	// a stopped clock still ticks at the 40-minute day pace
	w.app.settings.timeSpeed = 0;
	m.slots[ 1 ].respawnLeft = 1;
	for ( let i = 0; i < 100 * 10; i ++ ) w.features.update( 0.1 ); // 100 s -> 1 h of the 40-minute day
	ok( m.slots[ 1 ].respawnLeft < 0.05, `a stopped clock still respawns (about 100 real seconds per hour): ${ m.slots[ 1 ].respawnLeft.toFixed( 3 ) } h left` );

	// the captain: rolled at dawn (6:00), stays until beaten
	const w2 = makeWorld( { hour: 5.9, captain: false, seed: 3 } );
	let rolls = 0, got = 0;
	for ( let day = 0; day < 40; day ++ ) {

		w2.melee.captain.active = false;
		w2.app.settings.timeOfDay = 5.99;
		w2.features.update( 0.1 );
		w2.app.settings.timeOfDay = 6.01;
		w2.features.update( 0.1 );
		rolls ++;
		if ( w2.melee.captain.active ) got ++;

	}

	ok( got > 5 && got < 25, `a captain turns up on ${ got } of ${ rolls } dawns (about ${ Math.round( CLOCK.captainChance * 100 ) } %)` );
	w2.melee.captain.active = true;
	w2.melee.slots[ 4 ].respawnLeft = 3;
	w2.melee.captain.active = false;
	w2.app.settings.timeOfDay = 5.99;
	w2.features.update( 0.1 );
	w2.app.settings.timeOfDay = 6.01;
	w2.features.update( 0.1 );
	ok( ! w2.melee.captain.active, 'no captain moves in while the last one is still on his respawn timer' );
	m.dispose();
	w2.melee.dispose();

}

// ---------------------------------------------------------------- 12. save

{

	const w = makeWorld( { hour: 12, captain: true } );
	const m = w.melee;
	const r = await spawnR1( w );
	r.takeHit( 500 );
	m.combat.hp = 64;
	const j = JSON.parse( JSON.stringify( m.toJSON() ) );
	ok( j.v === 1 && j.hp === 64 && j.kills === 1 && j.captain === true && j.slots.r1 === 24, `toJSON: ${ JSON.stringify( j ) }` );
	const w2 = makeWorld( { hour: 12, captain: false } );
	w2.features.fromJSON( { melee: j } );
	ok( w2.melee.combat.hp === 64 && w2.melee.kills === 1 && w2.melee.captain.active && w2.melee.slots[ 0 ].respawnLeft === 24, 'fromJSON restores hp, kills, captain and timers' );
	w2.player.position.set( 60, terrain.heightAt( 60, - 70 ), - 70 );
	run( w2, 3 );
	ok( ! w2.melee._alive( w2.melee.slots[ 0 ].raider ), 'a beaten raider stays away after a load' );
	w2.melee.fromJSON( { hp: - 5, slots: { r1: 999 }, kills: 'x' } );
	ok( w2.melee.combat.hp >= 1 && w2.melee.slots[ 0 ].respawnLeft <= 24, 'bad save data is clamped' );
	w2.melee.fromJSON( null );
	w2.melee.fromJSON( 'junk' );
	ok( true, 'null / junk save data is ignored' );
	// Features.toJSON carries it
	ok( w.features.toJSON().melee.hp === 64, 'Features.toJSON includes the melee part' );
	w2.features.reset();
	ok( w2.melee.combat.hp === 100 && w2.melee.slots.every( ( s ) => s.respawnLeft === 0 ) && w2.melee.kills === 0, 'reset (new game): everyone is back, the player whole' );
	w.melee.dispose();
	w2.melee.dispose();

}

// ---------------------------------------------------------------- 13. regen

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	w.player.position.set( 40, terrain.heightAt( 40, - 70 ), - 70 );
	c.hp = 50;
	c.sinceHurt = 0;
	runFor( w, PLAYER.regenDelay - 1 );
	ok( c.hp === 50, 'no healing for 8 s after a hit' );
	runFor( w, 3 + 2 );
	ok( c.hp > 50, `then health comes back slowly (${ c.hp.toFixed( 1 ) })` );
	m.dispose();

}

// ---------------------------------------------------------------- 14. DOM: tags, bars, hint (fake document), projection, telegraph

class FakeEl {

	constructor( tag ) {

		this.tag = tag;
		this.children = [];
		this.parent = null;
		this.style = {};
		this._cls = new Set();
		this.textContent = '';
		this.innerHTML = '';
		this.clientWidth = 1280;
		this.clientHeight = 720;
		this._q = new Map();
		const self = this;
		this.classList = {
			add: ( c ) => self._cls.add( c ), remove: ( c ) => self._cls.delete( c ), contains: ( c ) => self._cls.has( c ),
			toggle: ( c, f ) => { if ( f === undefined ? ! self._cls.has( c ) : f ) self._cls.add( c ); else self._cls.delete( c ); },
		};

	}

	set className( v ) {

		this._cls = new Set( String( v ).split( /\s+/ ).filter( Boolean ) );

	}

	get className() {

		return [ ...this._cls ].join( ' ' );

	}

	append( ...els ) {

		for ( const e of els ) { e.parent = this; this.children.push( e ); }

	}

	remove() {

		if ( this.parent ) this.parent.children.splice( this.parent.children.indexOf( this ), 1 );
		this.parent = null;

	}

	querySelector( sel ) {

		if ( ! this._q.has( sel ) ) this._q.set( sel, new FakeEl( 'q' ) );
		return this._q.get( sel );

	}

}

{

	const doc = { head: new FakeEl( 'head' ), createElement: ( t ) => new FakeEl( t ) };
	const hudRoot = new FakeEl( 'div' );
	const w2 = makeWorld( { hour: 12 } );
	const m = w2.melee;
	const camera = w2.app.camera;
	const hud = new MeleeHud( { hud: hudRoot, camera, doc } );
	m.hud = hud;
	ok( hud.enabled && hudRoot.children.length === 1 && hudRoot.children[ 0 ].className === 'ml-root', 'the HUD root (ml-root) is added to the game HUD element' );
	ok( doc.head.children.length === 1 && /\.ml-tag/.test( doc.head.children[ 0 ].textContent ) && /\.ml-player/.test( doc.head.children[ 0 ].textContent ), 'CSS injected once, with the ml- prefix' );
	const r = await spawnR1( w2 );
	m.peaceful = true;
	const look = ( px, pz ) => {

		placePlayer( w2, px, pz, 0 );
		camera.position.set( px, w2.player.position.y + 3, pz + 6 );
		camera.lookAt( r.x, r.y + 1.5, r.z );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );

	};

	look( r.x, r.z + 9 );
	run( w2, 2 );
	const tag = hud.tags.get( r.id ).el;
	ok( ! tag.classList.contains( 'is-hidden' ), 'a raider 9 m away has a tag' );
	ok( hud.tags.get( r.id ).name.textContent === r.name, 'the tag shows his name' );
	ok( hud.tags.get( r.id ).fill.style.width === '100.0%', 'and a full health bar' );
	r.hp = r.maxHp * 0.4;
	run( w2, 2 );
	ok( hud.tags.get( r.id ).fill.style.width === '40.0%', 'the bar follows his health (40 %)' );
	ok( /translate\(/.test( tag.style.transform ), 'the tag is projected onto the screen' );
	look( r.x, r.z + 20 );
	run( w2, 2 );
	ok( tag.classList.contains( 'is-hidden' ), 'a raider 20 m away has no tag (15 m)' );
	look( r.x, r.z + 14 );
	run( w2, 2 );
	ok( ! tag.classList.contains( 'is-hidden' ) && Number( tag.style.opacity ) < 0.8, 'at 14 m the tag is fading out' );
	// behind the camera
	look( r.x, r.z + 9 );
	camera.lookAt( r.x, r.y + 1.5, r.z + 30 );
	camera.updateMatrixWorld( true );
	run( w2, 2 );
	ok( tag.classList.contains( 'is-hidden' ), 'no tag for a raider behind the camera' );
	look( r.x, r.z + 9 );
	r._enter( 'windup' );
	m._frameFx( DT );
	ok( tag.classList.contains( 'is-alert' ), 'the "!" shows during the wind-up' );
	r._enter( 'idle' );
	m._frameFx( DT );
	ok( ! tag.classList.contains( 'is-alert' ), 'and goes with it' );
	// the player's bar
	const bar = hud.playerEl;
	ok( ! bar.classList.contains( 'is-on' ), 'the player\'s health bar is quiet at full health' );
	w2.melee.combat.hp = 55;
	m._frameFx( DT );
	ok( ! bar.classList.contains( 'is-on' ), 'hurt but out of a fight: the bar stays hidden (wave 4: only in combat)' );
	w2.melee.combat.sinceCombat = 0;
	m._frameFx( DT );
	ok( bar.classList.contains( 'is-on' ) && hud.hpFill.style.width === '55.0%' && hud.hpNum.textContent === '55', 'it shows right after a blow is traded: 55 %' );
	w2.melee.combat.hp = 20;
	m._frameFx( DT );
	ok( bar.classList.contains( 'is-low' ), 'and turns red when low' );
	// hint
	m.onAggro( r );
	run( w2, 2 );
	ok( hud.hintEl.classList.contains( 'is-on' ) && /LMB/.test( hud.hintEl.innerHTML ) && /RMB/.test( hud.hintEl.innerHTML ) && /Q/.test( hud.hintEl.innerHTML ), 'the first fight shows the controls' );
	runFor( w2, 8.5 );
	ok( ! hud.hintEl.classList.contains( 'is-on' ), 'and the hint goes after 8 s' );
	w2.rod.equipped = true;
	r.aggro = true;
	r._enter( 'approach' );
	m.peaceful = false;
	run( w2, 2 );
	ok( hud.hintEl.classList.contains( 'is-on' ) && /R<\/kbd>/.test( hud.hintEl.innerHTML ), 'with the rod out and a raider coming: "put the rod away"' );
	w2.rod.equipped = false;
	// popups
	const p0 = hud.pops.length;
	hud.pop( 'PUNISH 51', { x: r.x, y: r.y + 1.8, z: r.z }, 'punish' );
	ok( hud.pops.length === p0 + 1 && hud.pops[ hud.pops.length - 1 ].el.classList.contains( 'is-punish' ), 'floating damage numbers' );
	for ( let i = 0; i < 70; i ++ ) hud.update( DT, { raiders: m.raiders, player: { x: 0, z: 0 }, hp: 20, maxHp: 100, hint: '' } );
	ok( hud.pops.length === 0, 'and they clear after about a second' );
	// fade / hurt overlays
	hud.update( DT, { raiders: [], player: { x: 0, z: 0 }, hp: 100, maxHp: 100, fade: 1, hurt: 0.5 } );
	ok( hud.fadeEl.style.opacity === '1.000' && hud.hurtEl.style.opacity === '0.50', 'black fade and red vignette overlays' );
	hud.dispose();
	ok( hudRoot.children.length === 0, 'dispose removes the DOM' );
	m.hud = null;
	// without a DOM at all
	const none = new MeleeHud( { hud: null, camera, doc: null } );
	none.update( 0.016, { raiders: [], player: { x: 0, z: 0 }, hp: 1, maxHp: 1 } );
	ok( ! none.enabled && none.pop( 'x', { x: 0, y: 0, z: 0 } ) === null, 'headless: the HUD is a no-op' );
	m.dispose();

	// projection helper
	const cam = new PerspectiveCamera( 60, 16 / 9, 0.1, 500 );
	cam.position.set( 0, 2, 10 );
	cam.lookAt( 0, 2, 0 );
	cam.updateProjectionMatrix();
	cam.updateMatrixWorld( true );
	const pt = project( cam, { x: 0, y: 2, z: 0 }, 1000, 500, {} );
	ok( pt && near( pt.x, 500, 1 ) && near( pt.y, 250, 1 ) && near( pt.dist, 10, 1e-3 ), 'project(): straight ahead lands at the screen centre' );
	ok( project( cam, { x: 0, y: 2, z: 20 }, 1000, 500, {} ) === null, 'project(): behind the camera is null' );
	const up = project( cam, { x: 0, y: 4, z: 0 }, 1000, 500, {} );
	ok( up && up.y < 250, 'project(): above the centre is higher on the screen' );

}

{

	// telegraph meshes on the real engine classes
	const added = [];
	const scene = { add: ( o ) => added.push( o ), remove() {} };
	const fx = new Telegraph( { scene } );
	const rr = { id: 'r1', active: true, visible: true, alert: true, state: 'windup', t: 0.3, x: 10, y: 1, z: 20, cfg: { windup: 0.6, hitRange: 2.4 } };
	fx.update( [ rr ], 0.2 );
	const it = fx.items.get( 'r1' );
	ok( it && it.ring.visible && it.fill.visible, 'the telegraph ring and disc show during the wind-up' );
	ok( near( it.ring.position.x, 10 ) && near( it.ring.position.z, 20 ) && it.ring.position.y > 1, 'placed on the ground at his feet' );
	ok( near( it.fill.scale.x, 0.5 * ( 2.4 / 2.4 ), 0.01 ), 'the disc fills toward the ring as the strike nears (50 % at 0.3 s)' );
	ok( it.ringMat.opacity > 0.25 && it.ringMat.opacity <= 1 && it.ringMat.transparent === true && it.ringMat.lit === false, 'a flashing, unlit, transparent material' );
	ok( it.ring.layers.isEnabled( 2 ), 'on the transparent layer' );
	rr.alert = false; rr.state = 'recover';
	fx.update( [ rr ], 0.3 );
	ok( ! it.ring.visible && ! it.fill.visible, 'hidden when the wind-up is over' );
	fx.dispose();
	ok( added.length === 1, 'one group added to the scene' );

}

// ---------------------------------------------------------------- 15. audio

{

	const loaded = [];
	const ctx = {
		decodeAudioData: ( ab, ok2 ) => ok2( { duration: 0.5 } ),
		createBufferSource: () => ( { playbackRate: { value: 1 }, connect() {}, start() { this.started = true; }, onended: null } ),
		createGain: () => ( { gain: { value: 1 }, connect() {}, disconnect() {} } ),
		createPanner: () => ( { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, connect() {}, disconnect() {} } ),
	};
	const audio = { ctx, sfxAbove: { name: 'sfx' } };
	const fetchImpl = ( url ) => { loaded.push( url ); return Promise.resolve( { ok: true, arrayBuffer: () => Promise.resolve( new ArrayBuffer( 8 ) ) } ); };
	const ca = new CombatAudio( audio, { url: '/audio/combat/', fetchImpl } );
	ok( ca.play( 'paddleSwing' ) === false, 'a sound whose file is not loaded yet is skipped (and starts loading)' );
	const n = await ca.preload();
	const total = Object.values( BANKS ).reduce( ( a, b ) => a + b.files.length, 0 );
	ok( n === total && total === 13 && loaded.every( ( u ) => /^\/audio\/combat\/[a-z_0-9]+\.ogg$/.test( u ) ), `preload fetches all ${ total } files from /audio/combat` );
	ok( ca.play( 'paddleHit', { at: { x: 1, y: 2, z: 3 }, rate: 0.9, gain: 0.8 } ) && ca.played === 1, 'a positional sound plays once loaded' );
	ok( ca.play( 'hookSwing' ) && ca.played === 2, 'and a head-relative one' );
	ok( ca.lead( 'paddleSwing' ) > ca.lead( 'hookSwing' ) && ca.lead( 'paddleHit' ) === 0, 'swing sounds lead the contact, impacts do not' );
	ok( new CombatAudio( null ).play( 'paddleHit' ) === false && new CombatAudio( { ctx: null } ).play( 'paddleHit' ) === false, 'no audio / not resumed: silent no-op' );
	// the files exist
	const fs = await import( 'node:fs' );
	const missing = Object.values( BANKS ).flatMap( ( b ) => b.files ).filter( ( f ) => ! fs.existsSync( new URL( `../public/audio/combat/${ f }.ogg`, import.meta.url ) ) );
	ok( missing.length === 0, 'every file in the banks exists in public/audio/combat' + ( missing.length ? ' (missing: ' + missing.join( ', ' ) + ')' : '' ) );

}

// ---------------------------------------------------------------- 16. flash, sounds, schedule

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	const r = await spawnR1( w );
	m.peaceful = true;
	faceOff( w, r, 2 );
	// hit flash on the raider's materials, then back to what they were
	const mats = r.model.materials;
	r.takeHit( 10 );
	ok( mats[ 0 ].emissive.r > 0.5 && mats[ 1 ].emissive.r > 0.5, 'a hit flashes the raider red (emissive on his materials)' );
	runFor( w, 0.5 );
	ok( near( mats[ 0 ].emissive.r, 0 ) && near( mats[ 1 ].emissive.r, 0.1 ), 'and the flash fades back to the original emissive' );
	// player flash
	c.hurtFlash = 1;
	run( w, 1 );
	const pm = w.app.avatar.model.materials;
	ok( pm[ 0 ].emissive.r > 0.5, 'the player\'s avatar flashes when hurt' );
	runFor( w, 0.6 );
	ok( near( pm[ 0 ].emissive.r, 0 ) && near( pm[ 1 ].emissive.r, 0.1 ), 'and recovers' );
	// raider swing sound arrives before the contact, once
	m.peaceful = false;
	w.audio.played.length = 0;
	r.state = 'approach'; r.sinceAttack = 99; r._enter( 'idle' ); r.state = 'approach';
	m.combat.hurtInv = 1e9;
	placePlayer( w, r.x, r.z + 1.9 );
	let swingAt = null, strikeAt = null;
	runFor( w, 1.2, () => {

		if ( swingAt === null && w.audio.played.some( ( p ) => p.bank === 'paddleSwing' ) ) swingAt = r.t + ( r.state === 'windup' ? 0 : 99 );
		if ( strikeAt === null && r.state === 'strike' ) strikeAt = m.time;

	} );
	const swings = w.audio.played.filter( ( p ) => p.bank === 'paddleSwing' );
	ok( swings.length >= 1 && swings[ 0 ].at && near( swings[ 0 ].at.x, r.x, 3 ), 'the raider\'s swing whoosh plays at his position' );
	ok( swingAt !== null && swingAt > 0.4 && swingAt < 0.6, `the whoosh starts ${ swingAt && ( 0.6 - swingAt ).toFixed( 2 ) } s before the contact` );
	// an interrupted wind-up makes no whoosh
	r.state = 'idle'; r._enter( 'idle' );
	w.audio.played.length = 0;
	r.sinceAttack = 99; r._enter( 'windup' );
	runFor( w, 0.1 );
	r.takeHit( 5 );
	runFor( w, 0.8 );
	ok( ! w.audio.played.some( ( p ) => p.bank === 'paddleSwing' ), 'an interrupted wind-up never whooshes' );
	// player swing + impact sounds
	w.audio.played.length = 0;
	r.hp = r.maxHp;
	r.state = 'idle'; r._enter( 'idle' );
	m.peaceful = true;
	faceOff( w, r, 2 );
	w.player.stamina = 1;
	c.reset();
	c.attackPress();
	runFor( w, 0.5 );
	ok( w.audio.played.some( ( p ) => p.bank === 'paddleSwing' && ! p.at ) && w.audio.played.some( ( p ) => p.bank === 'paddleHit' && p.at ), 'the player\'s swing whooshes and the impact sounds at the raider' );
	m.dispose();
	ok( avatarFactory.made.filter( ( a ) => a.disposed ).length >= 2, 'dispose releases the raiders\' avatars' );

}

// ---------------------------------------------------------------- 18. wave 5: the guard is a hold and its pose ends
// (wave 12E: held with the rod away the stance is always up, enemy or not; the idle drop is the toggle mode's)

{

	const w = makeWorld( { hour: 12 } );
	const m = w.melee, c = m.combat;
	const mts = [];
	w.app.avatar.playMontage = ( name ) => {

		const h = { name, playing: true, stops: 0, stop() { this.stops ++; this.playing = false; } };
		mts.push( h );
		return h;

	};
	const poseUp = () => mts.some( ( h ) => h.name === 'block' && h.playing );
	const r = await spawnR1( w );
	m.peaceful = true; // he stands where he is put
	const rmb = ( on, frames = 2 ) => { w.input.rightDown = on; run( w, frames ); };

	// nobody near: wave 12E, the stance still comes up while RMB is held (and costs no stamina out of a fight)
	faceOff( w, r, 30 );
	w.player.stamina = 1;
	rmb( true, 10 );
	ok( m.guarding && poseUp(), 'outside a fight RMB held still raises the guard stance (always visible while held)' );
	ok( w.player.stamina === 1, 'and it costs no stamina out of a fight' );
	rmb( false );
	ok( ! m.guarding && ! poseUp(), 'let go: it drops' );

	// near him: a hold. The looping 'block' pose starts with the guard and is STOPPED when RMB is let go
	faceOff( w, r, 4 );
	rmb( true );
	ok( m.guarding && poseUp(), 'an enemy within reach: RMB held raises the guard and its pose' );
	rmb( false );
	ok( ! m.guarding && ! poseUp() && mts.filter( ( h ) => h.name === 'block' ).every( ( h ) => h.stops >= 1 ), 'let go: the guard drops and the looping block pose is stopped (no more "locked in the block animation")' );

	// the button lost under the pointer lock / a blur (Input.releases bumps): the guard drops, and a held button needs a new press
	w.input.releases = 0;
	rmb( true );
	ok( m.guarding, 'guard up again' );
	w.input.releases ++;
	rmb( true );
	ok( ! m.guarding && ! poseUp(), 'focus / pointer lock lost: the guard drops' );
	rmb( false );
	rmb( true );
	ok( m.guarding, 'a fresh press raises it again' );

	// a panel opens / the rod comes out: down
	w.game.hud = { invOpen: true };
	run( w, 2 );
	ok( ! m.guarding && ! poseUp(), 'a panel opening lowers the guard' );
	w.game.hud = null;
	rmb( false );
	rmb( true );
	w.rod.equipped = true;
	run( w, 2 );
	ok( ! m.guarding && ! poseUp(), 'the rod coming out lowers the guard' );
	w.rod.equipped = false;
	rmb( false );

	// held, it stays up however long and wherever (wave 12E: no idle drop in hold mode, no drop when the fight ends)
	rmb( true );
	faceOff( w, r, 30 );
	runFor( w, GUARD.idle + 1 );
	ok( m.guarding && poseUp(), `held: the guard stays up past ${ GUARD.idle } s with nobody near` );
	rmb( false );
	let fighting = true;
	m.engaged = () => fighting;
	rmb( true );
	ok( m.guarding, 'guard up in a fight' );
	fighting = false;
	run( w, 2 );
	ok( m.guarding, 'the fight ends: a held guard stays up until let go' );
	rmb( false );
	ok( ! m.guarding && ! poseUp(), 'and drops on release' );
	delete m.engaged;

	// toggle mode (the Access option: input.guardToggle): a press raises it, the next lowers it
	w.input.guardToggle = true;
	rmb( true );
	rmb( false );
	ok( m.guarding && poseUp(), 'toggle: a click raises the guard and it stays up' );
	rmb( true );
	rmb( false );
	ok( ! m.guarding && ! poseUp(), 'toggle: the second click lowers it' );
	faceOff( w, r, 30 );
	rmb( true );
	rmb( false );
	ok( m.guarding, 'toggle: a click outside a fight raises it too (wave 12E)' );
	runFor( w, GUARD.idle + 0.3 );
	ok( ! m.guarding && ! poseUp(), `toggle: latched with nobody near, it drops after ${ GUARD.idle } s` );
	faceOff( w, r, 4 );
	rmb( true );
	rmb( false );
	w.input.releases ++;
	run( w, 2 );
	ok( ! m.guarding, 'toggle: losing the focus drops a latched guard' );
	w.input.guardToggle = false;
	w.app.settings.guardMode = 'toggle';
	ok( m._guardToggle(), 'settings.guardMode toggle works as well' );
	w.app.settings.guardMode = 'hold';

	// a parry's one-shot interrupts the pose; the pose comes back after it while the guard is held
	rmb( true );
	const before = mts.length;
	c._guardMt.playing = false; // the parry montage took the upper slot
	c._upperBusy = c.clock + 0.3;
	run( w, 3 );
	ok( mts.length === before, 'the guard pose waits for the parry to play out' );
	runFor( w, 0.4 );
	ok( mts.length === before + 1 && poseUp(), 'then the guard pose comes back while the guard is held' );
	rmb( false );
	ok( ! poseUp(), 'and goes when it is let go' );
	m.dispose();

}

// ---------------------------------------------------------------- 17. headless robustness

{

	// no game, no camera feel, no audio, no colliders, no settings: still runs
	const player = { position: new Vector3( 60, 1, - 70 ), velocity: new Vector3(), yaw: 0, stamina: 1, mode: 'walk' };
	const app = { player, input: new FakeInput(), camera: new PerspectiveCamera(), scene: { add() {}, remove() {} }, terrainData: terrain };
	const f = { emit() {}, claimKey: () => true, state: null, sandbox: false };
	const m = new Melee( app, f, { avatarFactory, audio: { play: () => false, lead: () => 0.1 }, hud: false, fx: false, seed: 1, captain: false, slots: SLOTS, peaceZone: false } );
	for ( let i = 0; i < 120; i ++ ) m.update( DT );
	ok( m.raiders.length === 2, 'runs with a bare app (no game, no settings): raiders appear' );
	player.position.set( 122, terrain.heightAt( 122, - 62 ), - 62 );
	for ( let i = 0; i < 600; i ++ ) m.update( DT );
	ok( m.combat.hp <= 100 && Number.isFinite( player.position.x ), 'and fights without a game object' );
	m.update( 0 );
	m.update( NaN );
	m.update( 5 );
	ok( true, 'zero / NaN / huge dt are survivable' );
	m.dispose();

}

console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
process.exit( fails ? 1 : 0 );
