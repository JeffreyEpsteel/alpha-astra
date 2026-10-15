// Plain-node test of the wave 4 combat rework: the peaceful home waters, the soft lock-on, the two attack tokens and the
// circling crowd, the parry / late-block windows, the training post, defeat through the death feature, the naval aim
// assist (lead, arc, miss report), the pirate brains (keep out, broadside bearing, outgunned) and the hostile boarding parry.
// No GPU, no GLBs: stub avatars, a stub player and input, the real TerrainData, Colliders and Features.
//   node test/feature-combat.mjs
import { PerspectiveCamera, Vector3, Group, Quaternion } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Features } from '../src/features/Features.js';
import * as meleeModule from '../src/features/melee/index.js';
import { PLAYER, RAIDER, TIERS, TOKENS, TRAINING_POST, SLOTS, tierCfg, yawToward, facingDot } from '../src/features/melee/MeleeData.js';
import { inPeace, peaceZone, beyondReef, peaceExit } from '../src/features/melee/Peace.js';
import { pickLock, assistYaw, magnetTurn, LOCK } from '../src/features/melee/LockOn.js';
import { DUMMY } from '../src/features/melee/Dummy.js';
import { PATROLS, MERCHANT_ROUTE } from '../src/features/naval/Routes.js';
import { leadAim, stepBall, arcPoints, impactTime, MUZZLE_SPEED, GRAVITY } from '../src/features/naval/Ballistics.js';
import { aimPlan, missReport } from '../src/features/naval/AimAssist.js';
import { hudModel } from '../src/features/naval/Hud.js';
import { Ship } from '../src/features/naval/Ship.js';
import { think, keepOut, OUTGUNNED, BROADSIDE } from '../src/features/naval/Brains.js';
import { makeRng } from '../src/features/naval/util.js';
import { Hostile, HOSTILE } from '../src/features/boarding/Hostile.js';
import { guardTier, denSite } from '../src/features/pirates/Dens.js';
import { BANKS } from '../src/features/melee/CombatAudio.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, eps = 1e-3 ) => Math.abs( a - b ) <= eps;
const DT = 1 / 60;
const terrain = new TerrainData();
const tick = () => new Promise( ( r ) => setImmediate( r ) );

// ---------------------------------------------------------------- stubs (as test/feature-melee.mjs)

const CLIPS_ALL = [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Melee_Paddle', 'Hit_Reaction', 'Knockdown', 'GetUp_Front', 'Stumble', 'Laugh', 'Look_Around', 'Swagger_Idle' ];
class FakeModel {

	constructor() { this.clips = new Set( CLIPS_ALL ); this.cur = null; this.layer = null; this.materials = []; }
	get current() { return this.cur; }
	play( name, { speed = 1, loop = true } = {} ) { if ( name === this.cur && this.layer ) return this.layer; this.cur = name; this.layer = { name, time: 0, speed, ended: false, loop }; return this.layer; }
	update( dt ) { if ( this.layer ) this.layer.time += dt * this.layer.speed; }
	hold() {}

}

function avatarFactory( opts ) {

	const model = new FakeModel();
	return { group: new Group(), model, character: opts.character, lite: true, ready: Promise.resolve( model ), dispose() {} };

}

class FakeInput {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.mouseDown = false; this.rightDown = false; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	endFrame() { this.pressed.clear(); }

}

function makeWorld( o = {} ) {

	const log = { events: [], toasts: [], kicks: [], montages: [], sfx: [] };
	const at = o.at || { x: 80, z: - 70 };
	const player = { position: new Vector3( at.x, terrain.heightAt( at.x, at.z ), at.z ), velocity: new Vector3(), yaw: 0, stamina: 1, mode: 'walk', launched: 0, grounded: true };
	const state = { money: 1000, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const rod = { equipped: false, equip( on ) { this.equipped = on; } };
	const game = { state, rod, fight: null, hud: null, toast: ( t ) => log.toasts.push( t ), cancelLine() {} };
	const input = new FakeInput();
	const app = {
		player, input, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), scene: { add() {}, remove() {} }, game, terrainData: terrain, colliders: new Colliders(),
		settings: { timeOfDay: 12, timeSpeed: 0 }, mode: 'campaign', paused: false, menuOpen: false, freeCam: false,
		avatar: { character: 'hyptile', model: new FakeModel(), playMontage: ( n, op ) => { log.montages.push( n ); return { stop() {} }; } },
		audio: null, ui: null, cameraFeel: { kick: ( t ) => { log.kicks.push( t ); return true; } },
	};
	const features = new Features( app );
	for ( const n of [ 'enemyDefeated', 'playerKnockedDown', 'playerDied', 'meleeHit' ] ) features.on( n, ( e ) => log.events.push( [ n, e ] ) );
	if ( o.death ) features.add( 'death', { install: () => ( { kind: 'death-stub' } ) } );
	const audio = { play( bank ) { log.sfx.push( bank ); return bank !== 'parry'; }, lead: ( b ) => ( BANKS[ b ] ? BANKS[ b ].lead : 0 ), preload() {} };
	const melee = features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, audio, hud: false, fx: false, seed: 7, captain: false, ...( o.options || {} ) } ) } );
	return { app, features, melee, player, input, state, rod, log };

}

function run( w, frames, each = null ) {

	for ( let i = 0; i < frames; i ++ ) { w.features.update( DT ); w.input.endFrame(); if ( each ) each( i ); }

}

const runFor = ( w, s, each ) => run( w, Math.round( s / DT ), each );
const place = ( w, x, z, yaw = 0 ) => { w.player.position.set( x, terrain.heightAt( x, z ), z ); w.player.yaw = yaw; };

// ---------------------------------------------------------------- 1. the peaceful home waters

{

	const pz = peaceZone();
	ok( pz && pz.r > 400, `the zone is the home island's circle (r ${ pz && pz.r.toFixed( 0 ) } m)` );
	const inside = [ [ 'spawn', WORLD.spawn.position ], [ 'start', WORLD.start.position ], [ 'harbour mooring', WORLD.boatDock.position ], [ 'pier head', { x: WORLD.pier.x, z: WORLD.pier.zEnd } ],
		[ 'village', WORLD.village.center ], [ 'old camp', { x: 127, z: - 71 } ], [ 'training post', TRAINING_POST ] ];
	for ( const [ n, p ] of inside ) ok( inPeace( p.x, p.z ), `peaceful: ${ n }` );
	const R = WORLD.reef;
	let reefIn = true;
	for ( let a = 0; a < 360; a += 15 ) reefIn = reefIn && inPeace( R.center.x + Math.cos( a * Math.PI / 180 ) * R.radius, R.center.z + Math.sin( a * Math.PI / 180 ) * R.radius );
	ok( reefIn, 'the whole reef lies inside: hostile boarding only beyond it' );
	ok( beyondReef( 0, 260 ) && ! beyondReef( 0, 100 ), 'beyondReef: out at z 260, not at z 100' );
	for ( const port of WORLD.ports ) {

		if ( port.id === 'home' ) continue;
		ok( ! inPeace( port.dock.position.x, port.dock.position.z, 60 ) && ! inPeace( port.stand.x, port.stand.z, 60 ), `${ port.id }: its harbour is not in the home zone (60 m clear)` );

	}

	let lanesOut = true;
	for ( const r of PATROLS ) for ( const q of r ) lanesOut = lanesOut && ! inPeace( q[ 0 ], q[ 1 ], 60 );
	ok( lanesOut, 'every pirate patrol lane point is 60+ m outside the zone' );
	ok( ! inPeace( MERCHANT_ROUTE[ 1 ][ 0 ], MERCHANT_ROUTE[ 1 ][ 1 ] ), 'the merchant lane bend (100, 230) is outside' );
	for ( const isl of WORLD.islands ) {

		if ( isl.id === 'home' ) continue;
		const port = WORLD.ports.find( ( p ) => p.id === isl.id ) || null;
		const d = denSite( isl, terrain, port );
		ok( ! inPeace( d.x, d.z ) && ! inPeace( d.mx, d.mz ), `${ isl.id }: its pirate den and mooring are outside` );

	}

	const e = peaceExit( 0, 100 );
	ok( Math.cos( e ) > 0.95, 'peaceExit from the bay points out to sea (south)' );

	// melee: no camp, peaceful at home, not at an outer port
	const w = makeWorld( { at: { x: WORLD.start.position.x, z: WORLD.start.position.z } } );
	run( w, 5 );
	ok( w.melee.slots.length === 0 && w.melee.raiders.length === 0, 'the home island has no raider camp any more (abandoned: props only)' );
	ok( w.melee.peaceful === true && w.melee.inPeace, 'melee is peaceful on the home island' );
	const pons = WORLD.ports.find( ( p ) => p.id === 'pons' );
	place( w, pons.stand.x, pons.stand.z );
	run( w, 2 );
	ok( w.melee.peaceful === false, 'and not at Pons Cove' );
	w.melee.setPeaceful( true );
	ok( w.melee.peaceful === true, 'setPeaceful( true ) still makes it peaceful anywhere (the sandbox option)' );
	w.melee.dispose();

	// a slot raider inside the zone never picks a fight
	const w2 = makeWorld( { options: { slots: [ SLOTS[ 0 ] ] } } );
	place( w2, 60, - 70 );
	run( w2, 3 );
	await tick();
	const r = w2.melee.slots[ 0 ].raider;
	place( w2, r.x, r.z + 3 );
	runFor( w2, 3 );
	ok( r && ! r.aggro && ( r.state === 'idle' || r.state === 'patrol' ), `a raider in the home zone ignores the player (${ r && r.state })` );
	w2.melee.dispose();

}

// ---------------------------------------------------------------- 2. soft lock-on (pure)

{

	const p = { x: 0, z: 0, yaw: 0 }; // facing -Z
	const mk = ( x, z, t = true ) => ( { x, z, targetable: t } );
	const ahead = mk( 0, - 4 ), side = mk( 3.5, - 1 ), behind = mk( 0, 3 ), far = mk( 0, - 20 );
	ok( pickLock( p, [ side, ahead, behind, far ] ) === ahead, 'picks the enemy ahead in the cone' );
	ok( pickLock( p, [ behind ] ) === null, 'never one behind the player' );
	ok( pickLock( p, [ far ] ) === null, `nothing beyond ${ LOCK.range } m` );
	ok( pickLock( p, [ mk( 0, - 4, false ) ] ) === null, 'not a downed (untargetable) raider' );
	const nearer = mk( 1.6, - 3 );
	ok( pickLock( p, [ ahead, nearer ], ahead ) === ahead, 'sticky: the current lock is kept while it stays in the keep cone' );
	ok( pickLock( { ...p, yaw: Math.PI }, [ ahead ], ahead ) === null, 'and dropped when the player turns his back on it' );
	let yaw = 0;
	const tgt = mk( 4, - 4 );
	for ( let i = 0; i < 120; i ++ ) yaw = assistYaw( yaw, p, tgt, DT );
	ok( Math.abs( yaw - yawToward( 0, 0, 4, - 4 ) ) < 0.05, `camera assist eases the view onto the lock (${ yaw.toFixed( 2 ) } rad)` );
	ok( assistYaw( 0, p, behind, DT ) === 0, 'no pull toward something behind the player' );
	ok( Math.abs( magnetTurn( 0, p, mk( 4, 0 ) ) ) <= LOCK.magnet + 1e-9, `a swing turns at most ${ LOCK.magnet } rad toward the lock` );

}

// ---------------------------------------------------------------- 3. lock-on, tokens and the circling crowd (integration)

const ARENA = [
	{ id: 'a1', x: 122, z: - 70, when: 'day', characters: [ 'bonk' ] },
	{ id: 'a2', x: 130, z: - 66, when: 'day', characters: [ 'doge' ] },
	{ id: 'a3', x: 126, z: - 74, when: 'day', characters: [ 'pengu' ], tier: 3 },
];

{

	const w = makeWorld( { options: { slots: ARENA, peaceZone: false } } );
	const m = w.melee;
	place( w, 60, - 70 );
	run( w, 3 );
	await tick();
	ok( m.raiders.length === 3, 'three raiders in the arena' );
	ok( m.raiders[ 2 ].tier === 3 && m.raiders[ 2 ].cfg.windup === TIERS[ 3 ].windup && m.raiders[ 0 ].cfg.windup === RAIDER.windup, 'tiers: the tier 3 raider winds up faster' );
	m.combat.hurtInv = 1e9; // stand there and watch
	place( w, 126, - 62, 0 ); // facing -Z, toward the camp
	let maxTokens = 0, circled = false, together = 0, lockSeen = null;
	const seenCircle = new Set();
	runFor( w, 16, () => {

		maxTokens = Math.max( maxTokens, m.tokens.size );
		for ( const r of m.raiders ) if ( r.state === 'circle' ) { circled = true; seenCircle.add( r.id ); }
		const wind = m.raiders.filter( ( r ) => r.state === 'windup' );
		if ( wind.length > 2 ) together ++;
		if ( m.lock ) lockSeen = m.lock;
		m.combat.hurtInv = 1e9;

	} );
	ok( maxTokens <= TOKENS.max, `never more than ${ TOKENS.max } attack tokens out (max ${ maxTokens })` );
	ok( together === 0, 'never three wind-ups at once' );
	ok( circled, `the raider without a token circles instead of stacking (${ [ ...seenCircle ].join( ', ' ) })` );
	ok( m.raiders.reduce( ( n, r ) => n + r.strikeCount, 0 ) >= 6, 'they still take their turns' );
	let minGap = Infinity;
	for ( let i = 0; i < 3; i ++ ) for ( let j = i + 1; j < 3; j ++ ) minGap = Math.min( minGap, Math.hypot( m.raiders[ i ].x - m.raiders[ j ].x, m.raiders[ i ].z - m.raiders[ j ].z ) );
	ok( minGap > 0.8, `they keep apart (${ minGap.toFixed( 2 ) } m)` );
	ok( lockSeen && m.raiders.includes( lockSeen ), 'in the fight the soft lock picks one of them' );
	// a swing turns onto the lock
	m.lock = m.raiders.find( ( r ) => r.targetable );
	const lk = m.lock;
	const before = Math.abs( facingDot( w.player.yaw, w.player.position.x, w.player.position.z, lk.x, lk.z ) );
	w.player.yaw = yawToward( w.player.position.x, w.player.position.z, lk.x, lk.z ) + 0.4;
	const y0 = w.player.yaw;
	m.combat.state = 'free';
	m.combat._startSwing();
	ok( Math.abs( w.player.yaw - y0 ) > 0.3 && Number.isFinite( before ), 'a swing snaps the facing toward the locked raider' );
	ok( w.log.montages.includes( 'swing' ), 'the swing goes to the animation graph (avatar.playMontage "swing")' );
	m.dispose();

}

// ---------------------------------------------------------------- 4. parry windows

{

	const w = makeWorld( { options: { slots: [ SLOTS[ 0 ] ], peaceZone: false } } );
	const m = w.melee, c = m.combat;
	place( w, 60, - 70 );
	run( w, 3 );
	await tick();
	const r = m.slots[ 0 ].raider;
	const face = () => { place( w, r.x, r.z + 1.8, 0 ); r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z ); };
	// the timing itself
	c.reset();
	c.guardStart = 10;
	ok( c.guardTiming( 10 + PLAYER.lateWindow * 0.5 ) === 'late' && c.guardTiming( 10 + PLAYER.lateWindow + 0.01 ) === 'parry' && c.guardTiming( 10 + PLAYER.lateWindow + PLAYER.parryWindow - 0.01 ) === 'parry' && c.guardTiming( 10 + 0.4 ) === 'block',
		`guard timing: < ${ PLAYER.lateWindow } s late, then a ${ PLAYER.parryWindow } s parry window, then a plain block` );

	// a parry: guard raised 0.15 s before the blow
	face();
	c.reset();
	w.player.stamina = 0.5;
	r._enter( 'approach' );
	c.guardHeld = true;
	c.update( DT );
	c.update( 0.15 ); // raised 0.15 s before the blow
	ok( c.guarding, 'guard up' );
	const out = m.raiderStrike( r );
	ok( out === 'parried' && c.hp === 100, 'a well-timed guard parries: no damage' );
	ok( w.player.stamina >= 0.5, 'and costs no stamina' );
	ok( r.state === 'stagger' && r.punish && r.parriedT > 0, 'the raider reels, open to a punish' );
	ok( w.log.kicks.includes( 'parry' ) && w.log.sfx.includes( 'parry' ), 'parry hitstop + the parry clang (falls back to hookHit without it)' );
	const res = r.takeHit( PLAYER.attackDamage );
	ok( res.punish && res.dealt === Math.round( PLAYER.attackDamage * PLAYER.punishBonus ), `the punish hit lands for ${ res.dealt }` );

	// a late guard: chip damage
	r.spawn( { name: 'Kelp' } );
	face();
	c.reset();
	w.player.stamina = 1;
	c.guardHeld = true;
	c.update( PLAYER.lateWindow * 0.5 ); // up inside the blow's own step
	const o2 = m.raiderStrike( r );
	ok( o2 === 'chipped' && c.hp === 100 - Math.ceil( RAIDER.damage * PLAYER.chip ), `a late guard holds but lets ${ PLAYER.chip * 100 } % through (hp ${ c.hp })` );
	ok( near( 1 - w.player.stamina, PLAYER.blockChip, 0.005 ) && c.state === 'free', 'it chips stamina and does not stagger the player' );

	// held from long before: a plain block
	c.reset();
	w.player.stamina = 1;
	c.guardHeld = true;
	c.update( 0.02 );
	c.guardStart -= 1;
	ok( m.raiderStrike( r ) === 'blocked' && c.hp === 100, 'a guard held from earlier is a plain block' );

	// a parry through the real wind-up (the raider's own timing)
	c.reset();
	r.spawn( { name: 'Pike' } );
	face();
	c.hurtInv = 0;
	r.sinceAttack = 99;
	m.tokens.clear();
	m.tokenGap = 0;
	r._enter( 'approach' );
	let parried = false;
	for ( let i = 0; i < 120 && ! parried; i ++ ) {

		face();
		// raise the guard as the ring turns gold (the parry cue)
		if ( r.state === 'windup' && r.parryCue > 0.3 ) w.input.rightDown = true;
		run( w, 1 );
		if ( r.outcome === 'parried' ) parried = true;

	}

	w.input.rightDown = false;
	ok( parried, 'guarding on the gold cue of a real wind-up parries it' );
	m.dispose();

}

// ---------------------------------------------------------------- 5. the training post

{

	const w = makeWorld( { at: { x: TRAINING_POST.x, z: TRAINING_POST.z + 2 } } );
	const m = w.melee, d = m.dummy;
	ok( d && near( d.x, TRAINING_POST.x ) && inPeace( d.x, d.z ), 'the training post stands on the harbour beach, in the peaceful zone' );
	ok( terrain.heightAt( d.x, d.z ) > 0.3, 'on dry sand' );
	const ia = w.features.nearestInteractable( w.player.position );
	ok( ia && /Spar/.test( ia.prompt() ), `E there: "${ ia && ia.prompt() }"` );
	place( w, d.x, d.z + 1.6, 0 );
	run( w, 2 );
	ok( m.canSwing(), 'the swing works at the post (the rod away)' );
	m.combat.attackPress();
	runFor( w, 0.5 );
	ok( m.combat.lastSwing && m.combat.lastSwing.target === d && m.combat.lastSwing.dealt === PLAYER.attackDamage, 'a blow on the post registers (a damage number)' );
	ia.onInteract();
	ok( d.sparring, 'sparring started' );
	const hp0 = m.combat.hp;
	let swings = 0, parries = 0;
	runFor( w, 8, () => {

		place( w, d.x, d.z + 1.6, 0 );
		if ( d.state === 'windup' && d.t === 0 ) swings ++;
		// parry every other one
		w.input.rightDown = d.state === 'windup' && d.parryCue > 0.3 && d.strikeCount % 2 === 0;
		if ( d.outcome === 'parried' ) { parries ++; d.outcome = null; }

	} );
	w.input.rightDown = false;
	ok( d.strikeCount >= 2, `the post swings back on a slow beat (${ d.strikeCount } swings in 8 s)` );
	ok( m.combat.hp === hp0, 'its blows never hurt (practice)' );
	ok( parries >= 1, 'and its swings can be parried' );
	ok( DUMMY.windup > RAIDER.windup, 'its telegraph is slower than any raider\'s' );
	m.dispose();

}

// ---------------------------------------------------------------- 6. defeat through the death feature

{

	const w = makeWorld( { death: true, options: { slots: [ SLOTS[ 0 ] ], peaceZone: false } } );
	const m = w.melee, c = m.combat;
	place( w, 60, - 70 );
	run( w, 3 );
	await tick();
	const r = m.slots[ 0 ].raider;
	place( w, r.x, r.z + 1.8, 0 );
	r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z );
	c.hp = 5;
	const money = w.state.money;
	const at = w.player.position.clone();
	ok( m.raiderStrike( r ) === 'knockedDown', 'the last blow knocks the player down' );
	const died = w.log.events.filter( ( e ) => e[ 0 ] === 'playerDied' );
	ok( died.length === 1 && died[ 0 ][ 1 ].cause === 'melee' && near( died[ 0 ][ 1 ].x, at.x ), 'playerDied { cause: "melee", x, y, z } for the death feature' );
	ok( w.state.money === money, 'no cash taken here (the sea chest does that)' );
	runFor( w, 2 );
	ok( Math.hypot( w.player.position.x - at.x, w.player.position.z - at.z ) < 0.5, 'no pier wake-up while the death feature exists' );
	ok( m.respawnPlayer() === null && w.log.events.filter( ( e ) => e[ 0 ] === 'playerDied' ).length === 1, 'respawnPlayer() defers to it (no second playerDied)' );
	w.features.emit( 'playerRespawned', { cause: 'melee', x: 0, y: 0, z: 0 } );
	ok( c.state === 'free' && c.hp === c.maxHp, 'playerRespawned ends the knockdown with full health' );
	m.dispose();
	// without it: the old pier wake-up
	const w2 = makeWorld( { options: { slots: [ SLOTS[ 0 ] ], peaceZone: false } } );
	place( w2, 60, - 70 );
	run( w2, 3 );
	await tick();
	const r2 = w2.melee.slots[ 0 ].raider;
	place( w2, r2.x, r2.z + 1.8, 0 );
	r2.yaw = yawToward( r2.x, r2.z, w2.player.position.x, w2.player.position.z );
	w2.melee.combat.hp = 5;
	w2.melee.raiderStrike( r2 );
	runFor( w2, 1.5 );
	ok( Math.hypot( w2.player.position.x - WORLD.pier.x, w2.player.position.z - ( WORLD.pier.zStart + 5 ) ) < 3 && ! w2.log.events.some( ( e ) => e[ 0 ] === 'playerDied' ), 'no death feature: the old pier wake-up, no playerDied' );
	w2.melee.dispose();

}

// ---------------------------------------------------------------- 7. naval aim assist: lead, arc, readout, miss report

{

	// the lead: a ball fired along leadAim meets a moving target
	const S = { x: 0, y: 2, z: 0 }, T = { x: 150, y: 1.5, z: 60 }, Vt = { x: - 3, y: 0, z: 5 };
	const aim = leadAim( S, { x: 0, y: 0, z: 0 }, T, Vt, MUZZLE_SPEED );
	const b = { x: S.x, y: S.y, z: S.z, vx: aim.dir.x * MUZZLE_SPEED, vy: aim.dir.y * MUZZLE_SPEED, vz: aim.dir.z * MUZZLE_SPEED };
	const n = Math.round( aim.t / 0.001 );
	for ( let i = 0; i < n; i ++ ) stepBall( b, aim.t / n );
	const tx = T.x + Vt.x * aim.t, tz = T.z + Vt.z * aim.t;
	ok( Math.hypot( b.x - tx, b.y - T.y, b.z - tz ) < 0.3, `the lead meets the moving target (${ Math.hypot( b.x - tx, b.z - tz ).toFixed( 2 ) } m off after ${ aim.t.toFixed( 2 ) } s)` );
	const V = { x: 100, y: 12, z: 0 };
	const ti = impactTime( { x: 0, y: 2, z: 0 }, V, 0 );
	ok( near( 2 + V.y * ti - 0.5 * GRAVITY * ti * ti, 0, 1e-6 ), 'impactTime: the ball comes down to the water' );
	const pts = arcPoints( { x: 0, y: 2, z: 0 }, V, { max: 20 } );
	ok( pts.length === 20 && near( pts[ 19 ].y, 0, 1e-6 ) && pts[ 9 ].y > 2, 'arcPoints: the dots rise and end on the water' );
	ok( missReport( { x: 80, z: 0 }, { x: 100, z: 0 }, { x: 0, z: 0 } ).kind === 'short' && missReport( { x: 115, z: 0 }, { x: 100, z: 0 }, { x: 0, z: 0 } ).kind === 'long' && missReport( { x: 100, z: 25 }, { x: 100, z: 0 }, { x: 0, z: 0 } ).kind === 'wide', 'miss report: short / long / wide' );
	ok( missReport( { x: 88, z: 0 }, { x: 100, z: 0 }, { x: 0, z: 0 } ).by === 12, 'with the distance' );

	// aimPlan on a stub naval: the boat heading +Z (+X is port), a pirate off the port beam sailing north
	const target = new Ship( 'sloop', { x: 140, z: 0, yaw: Math.PI, speed: 4 } );
	target.speed = 4;
	const naval = {
		app: { boatCtl: { position: new Vector3( 0, 0, 0 ), quaternion: new Quaternion(), velocity: new Vector3() }, player: { mode: 'boat' }, camera: null },
		ships: [ target ], mods: { range: 1 }, playerGun: { owned: true, level: 1, guns: 1 }, playerHull: { hp: 100, max: 100, sunk: false }, active: true,
		reloadLeft: { port: 0, starboard: 2 }, reloadTime: () => 4,
		_gunPlan( sd ) { const sg = sd === 'port' ? 1 : - 1; return { sg, L: { traverse: 0.6 }, mounts: [ { x: sg * 1.5, y: 1, z: 0 } ] }; },
		_muzzleWorld( mt, bc, out ) { out.x = bc.position.x + mt.x; out.y = bc.position.y + mt.y; out.z = bc.position.z + mt.z; return out; },
	};
	const pp = aimPlan( naval, 'port' ), ps = aimPlan( naval, 'starboard' );
	ok( pp && pp.inArc && pp.target && pp.range > 130 && pp.range < 145, `port: the sloop in the arc at ${ pp && pp.range } m` );
	ok( pp.lead && pp.lead.z < - 2, `the lead marker sits ahead of her (z ${ pp.lead && pp.lead.z.toFixed( 1 ) }: she sails -Z)` );
	ok( pp.points.length > 5 && Math.hypot( pp.impact.x - pp.lead.x, pp.impact.z - pp.lead.z ) < 1.5, 'the arc of dots ends on the lead' );
	ok( ps && ! ps.inArc && ! ps.ready && ps.left === 2, 'starboard: nothing in its arc, reloading 2 s' );
	const hm = hudModel( naval );
	const pg = hm.guns.find( ( g ) => g.side === 'port' ), sg = hm.guns.find( ( g ) => g.side === 'starboard' );
	ok( hm.visible && hm.aim && pg.ready && pg.range === pp.range && ! sg.ready && sg.left === 2 && sg.range === null, 'the battery rows: READY + range on port, 2 s left on starboard' );

}

// ---------------------------------------------------------------- 8. pirate brains

{

	const rng = makeRng( 3 );
	const world = ( target ) => ( { time: 0, night: false, storm: false, target, rng, terrain: null, fire: () => true, escape() {} } );
	// a pirate chasing into the bay turns away; a target in the bay is not a target
	const s = new Ship( 'sloop', { x: 0, z: 250, yaw: Math.PI, faction: 'pirate' } );
	s.setState( 'chase' );
	think( s, world( { x: 60, z: 30, vx: 0, vz: 0, ok: true } ), 0.1 );
	const into = Math.cos( s.want ) < 0; // heading north (into the bay)?
	ok( ! into || Math.abs( Math.sin( s.want ) ) > 0.85, `a pirate at the edge does not steer into the home waters (want ${ s.want.toFixed( 2 ) })` );
	for ( let i = 0; i < 60; i ++ ) think( s, world( { x: 60, z: 30, vx: 0, vz: 0, ok: true } ), 0.1 );
	ok( s.state === 'patrol', `a boat in the home waters is not a target: she breaks off (${ s.state })` );
	const s2 = new Ship( 'sloop', { x: 20, z: 60, yaw: 0, faction: 'pirate' } );
	s2.setState( 'patrol' );
	keepOut( s2 );
	ok( Math.cos( s2.want ) > 0.9, 'one inside the zone heads straight out to sea' );
	// broadside: wears round to the loaded battery
	const b = new Ship( 'sloop', { x: 0, z: 600, yaw: 0, faction: 'pirate' } );
	b.setState( 'broadside' );
	const tgt = { x: - 90, z: 600, vx: 0, vz: 3, ok: true }; // off her port beam
	think( b, world( tgt ), 0.1 );
	const side0 = b.mem.side;
	b.reload.port = 4;
	b.reload.starboard = 0;
	b.reload[ side0 > 0 ? 'port' : 'starboard' ] = 4;
	b.reload[ side0 > 0 ? 'starboard' : 'port' ] = 0;
	think( b, world( tgt ), 0.1 );
	ok( b.mem.side === - side0, 'broadside: the engaged battery reloading, she wears round to the loaded side' );
	b.reload.port = b.reload.starboard = 4;
	b.reload[ b.mem.side > 0 ? 'port' : 'starboard' ] = 4;
	b.reload[ b.mem.side > 0 ? 'starboard' : 'port' ] = 0;
	const s1 = b.mem.side;
	think( b, world( tgt ), 0.1 );
	ok( b.mem.side === s1, `but not again inside ${ BROADSIDE.wear } s` );
	ok( b.wantSpeed >= 0.4 && b.wantSpeed <= 1, 'she matches the target\'s way to hold the bearing' );
	// outgunned
	const o = new Ship( 'sloop', { x: 0, z: 600, yaw: 0, faction: 'pirate' } );
	o.setState( 'broadside' );
	think( o, world( tgt ), 0.1 );
	o.hp = o.maxHp * 0.55;
	for ( let i = 0; i < 30; i ++ ) think( o, world( tgt ), 0.1 );
	ok( o.state === 'flee' && o.mem.outgunned && o.hpFraction > o.cls.fleeAt, `outgunned (lost ${ OUTGUNNED.share * 100 } %+ fast), she runs before her fleeAt` );

}

// ---------------------------------------------------------------- 9. hostile boarding: the parry beat, never in the home waters

{

	const input = new FakeInput();
	const boatCtl = { position: new Vector3( 0, 0, 600 ), velocity: new Vector3( 0, 0, 1 ), speed: 1, driven: true, moored: false };
	const ship = new Ship( 'sloop', { x: 60, z: 600, yaw: 0, faction: 'pirate' } );
	ship.setState( 'chase' );
	ship.mustBoard = true;
	const events = [];
	const b = {
		app: { input, player: { mode: 'boat', stamina: 1 }, boatCtl, cameraFeel: { kick: () => true } },
		naval: { ships: [ ship ], playerHull: { hp: 100, max: 100, sunk: false }, playerGun: { owned: true, level: 1 }, active: true },
		state: { money: 500, spend( n ) { this.money -= n; return true; } }, features: null, melee: null, trade: null, phase: 'idle', stats: {},
		_toast() {}, _emit( n, e ) { events.push( [ n, e ] ); },
	};
	const h = new Hostile( b, { seed: 4 } );
	h.update( 0.1 );
	ok( ship.state === 'close', 'beyond the reef a pirate may close to board' );
	// the same in the home waters
	const ship2 = new Ship( 'sloop', { x: 70, z: 60, yaw: 0, faction: 'pirate' } );
	ship2.setState( 'close' );
	b.naval.ships.push( ship2 );
	boatCtl.position.set( 60, 0, 60 );
	h._scanT = 0;
	h.update( 0.1 );
	ok( ship2.state === 'chase' && ship.state === 'chase', 'in the home waters nobody closes to board (they fall back)' );
	b.naval.ships.length = 1;
	boatCtl.position.set( 0, 0, 600 );
	// a fight: every exchange guarded on the beat is a parry
	h.ship = ship;
	h._boarded( ship );
	h.choose( 0 );
	const n0 = h.boarders;
	let k = 0;
	while ( h.phase === 'fight' && k ++ < 400 ) {

		// raise the guard ~0.15 s before each blow (the beat bar's gold end)
		input.rightDown = h._tickT < 0.17 && h._tickT > 0.12 ? true : ( h._tickT > 0.5 ? false : input.rightDown );
		h.update( DT );

	}

	ok( h.stats.parries === n0 && h.outcome === 'repelled' && h.hits === 0, `parrying every blow repels all ${ n0 } boarders with no losses` );
	ok( events.some( ( e ) => e[ 0 ] === 'boardersRepelled' ), 'boardersRepelled' );
	const v = h.view();
	ok( v.beat === null, 'the beat bar is gone after the fight' );
	h.ship = ship;
	h._boarded( ship );
	h.choose( 0 );
	h.update( DT );
	ok( h.view().beat && h.view().beat.zone > 0 && h.view().beat.zone < 0.5, 'the beat bar shows during the fight with its gold parry zone' );
	ok( HOSTILE.tick >= 0.8, 'the beat is readable (0.85 s per blow)' );

}

// ---------------------------------------------------------------- 10. den guards by tier

{

	ok( guardTier( 1 ) === 1 && guardTier( 3 ) === 2 && guardTier( 5 ) === 3, 'den guards take their keeper\'s tier (1 -> 1, 2-3 -> 2, 4-5 -> 3)' );
	const t1 = tierCfg( RAIDER, 1 ), t3 = tierCfg( RAIDER, 3 );
	ok( t1.windup > RAIDER.windup && t3.windup < RAIDER.windup && t1.flank === 0 && t3.flank > RAIDER.flank && t3.damage > t1.damage, 'difficulty curve: tier 1 slow and straight, tier 3 quick, hard and flanking' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
process.exit( fails ? 1 : 0 );
