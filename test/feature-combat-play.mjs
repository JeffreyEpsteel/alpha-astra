// Wave 12E play harness: a scripted player fights 1, 2 and 3 raiders of tiers 1-3 at 60 Hz through the real melee feature
// (Melee, PlayerCombat, Raider, the tokens, the thrower and his rocks) and shoots them with the real firearms feature. Its
// assertions are the combat's regression gate: tune MeleeData / FirearmsData until they hold.
//   - a tier 1 raider dies in 3-4 swings, a tier 3 in 6-8 (the scripted "block, then swing twice" loop)
//   - a guard held through the telegraph blocks (no damage, 0.15 stamina); a dodge in the last 0.25 s of a wind-up takes
//     nothing; a guard raised within 0.2 s before the blow parries and staggers the raider for 1 s; an unguarded tier 1 blow
//     costs ~12 % health
//   - three tier 1 raiders lose to "block then swing twice" with the player never under 40 %
//   - the pistol kills a tier 1 raider at 10 m in 2 body shots or 1 head shot, the musket in 1 body shot
//   - the feel and the enemies: hitstop, the parry's slow motion, the dodge cancel, interrupts by tier, spacing, the rock
//     thrower, the 2.5 s knockdown, aim magnetism, the walking spread, the practice fight at the training post
// No GPU, no GLBs, no DOM (a fake document for the HUD bits): stub avatars and input, flat ground well outside the peaceful
// home waters (the practice fight uses the real island terrain at the training post).
//   node test/feature-combat-play.mjs
import { PerspectiveCamera, Vector3, Group, Quaternion } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Features } from '../src/features/Features.js';
import * as meleeModule from '../src/features/melee/index.js';
import * as firearms from '../src/features/firearms/index.js';
import { PLAYER, RAIDER, TIERS, THROW, FEEL, TRAINING_POST, PRACTICE, tierCfg, yawToward, facingDot } from '../src/features/melee/MeleeData.js';
import { inPeace, peaceZone } from '../src/features/melee/Peace.js';
import { BANKS } from '../src/features/melee/CombatAudio.js';
import { MeleeHud } from '../src/features/melee/MeleeHud.js';
import { WEAPONS, HEADSHOT, MAGNET, DEG } from '../src/features/firearms/FirearmsData.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const DT = 1 / 60;
const tick = () => new Promise( ( r ) => setImmediate( r ) );
const pz = peaceZone();
const FAR = { x: pz ? pz.x + pz.r + 500 : 3000, z: pz ? pz.z : 0 }; // flat dry ground, well outside the peaceful home waters
const GROUND = 1;
const flat = { heightAt: () => GROUND };
const report = []; // the tuning table lines printed at the end

// ---------------------------------------------------------------- stubs

const CLIPS_ALL = [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Melee_Paddle', 'Hit_Reaction', 'Knockdown', 'GetUp_Front', 'Stumble', 'Laugh', 'Look_Around', 'Swagger_Idle' ];
class FakeModel {

	constructor() { this.clips = new Set( CLIPS_ALL ); this.cur = null; this.layer = null; this.materials = []; this.calls = []; }
	get current() { return this.cur; }
	play( name, { speed = 1, loop = true } = {} ) { this.calls.push( name ); if ( name === this.cur && this.layer ) return this.layer; this.cur = name; this.layer = { name, time: 0, speed, ended: false, loop }; return this.layer; }
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

class FakeEl {

	constructor( tag ) {

		this.tag = tag; this.children = []; this.parent = null; this.style = {}; this._cls = new Set(); this.textContent = ''; this.innerHTML = '';
		this.clientWidth = 1280; this.clientHeight = 720; this._q = new Map();
		const self = this;
		this.classList = {
			add: ( c ) => self._cls.add( c ), remove: ( c ) => self._cls.delete( c ), contains: ( c ) => self._cls.has( c ),
			toggle: ( c, f ) => { if ( f === undefined ? ! self._cls.has( c ) : f ) self._cls.add( c ); else self._cls.delete( c ); },
		};

	}

	set className( v ) { this._cls = new Set( String( v ).split( /\s+/ ).filter( Boolean ) ); }
	get className() { return [ ...this._cls ].join( ' ' ); }
	append( ...els ) { for ( const e of els ) { e.parent = this; this.children.push( e ); } }
	remove() { if ( this.parent ) this.parent.children.splice( this.parent.children.indexOf( this ), 1 ); this.parent = null; }
	querySelector( sel ) { if ( ! this._q.has( sel ) ) this._q.set( sel, new FakeEl( 'q' ) ); return this._q.get( sel ); }
	querySelectorAll() { return [ new FakeEl( 'i' ), new FakeEl( 'i' ), new FakeEl( 'i' ), new FakeEl( 'i' ) ]; }

}

// a world: the player on flat ground at FAR (or the real island with `terrain`), melee with the arena `slots`, firearms
function makeWorld( o = {} ) {

	const log = { events: [], toasts: [], kicks: [], montages: [], sfx: [], vfx: [] };
	const terrain = o.terrain || flat;
	const at = o.at || { x: FAR.x - 60, z: FAR.z };
	const player = { position: new Vector3( at.x, terrain.heightAt( at.x, at.z ), at.z ), velocity: new Vector3(), yaw: 0, stamina: 1, mode: 'walk', launched: 0, grounded: true };
	const state = { money: 10000, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const rod = { equipped: false, equip( on ) { this.equipped = on; } };
	const game = { state, rod, fight: null, hud: null, toast: ( t ) => log.toasts.push( t ), cancelLine() {} };
	const input = new FakeInput();
	const camera = new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 );
	const app = {
		player, input, camera, scene: { add() {}, remove() {} }, game, terrainData: terrain, colliders: new Colliders(),
		settings: { timeOfDay: 12, timeSpeed: 0 }, mode: 'campaign', paused: false, menuOpen: false, freeCam: false,
		avatar: { character: 'hyptile', model: new FakeModel(), playMontage: ( n ) => { log.montages.push( n ); return { stop() {} }; } },
		audio: null, ui: null, cameraFeel: { fovKick: 0, kick: ( t ) => { log.kicks.push( t ); return true; }, baseFov: () => 60 },
	};
	const features = new Features( app );
	for ( const n of [ 'enemyDefeated', 'playerKnockedDown', 'playerDied', 'practiceStarted', 'practiceEnded', 'rockThrown', 'gunHit' ] ) features.on( n, ( e ) => log.events.push( [ n, e ] ) );
	const vfx = {};
	for ( const k of [ 'flash', 'smoke', 'splash', 'dust', 'splinters', 'debris' ] ) vfx[ k ] = ( ...a ) => log.vfx.push( [ k, ...a ] );
	features.add( 'vfx', { install: () => vfx } );
	const audio = { play( bank ) { log.sfx.push( bank ); return true; }, lead: ( b ) => ( BANKS[ b ] ? BANKS[ b ].lead : 0 ), preload() {} };
	const melee = features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, audio, hud: false, fx: false, seed: o.seed ?? 11, captain: false, terrain, peaceZone: o.peaceZone ?? false, ...( o.options || {} ) } ) } );
	const gunAudio = { report() { return true; }, click() { return true; } };
	const fa = features.add( 'firearms', { install: ( a, f ) => firearms.install( a, f, { audio: gunAudio, mesh: false, hud: false, seed: o.seed ?? 11, ...( o.gun || {} ) } ) } );
	return { app, features, melee, fa, player, input, state, rod, log, camera, terrain };

}

// one 60 Hz frame: Player.js's stamina refill (walking: 1/6 per s), then the features
function frame( w, each = null ) {

	const p = w.player;
	if ( w.melee.combat.state !== 'evade' ) p.stamina = Math.min( 1, p.stamina + DT / 6 );
	w.features.update( DT );
	w.input.endFrame();
	if ( each ) each();

}

const run = ( w, n, each ) => { for ( let i = 0; i < n; i ++ ) frame( w, each ); };
const runFor = ( w, s, each ) => run( w, Math.round( s / DT ), each );
const place = ( w, x, z, yaw = w.player.yaw ) => { w.player.position.set( x, w.terrain.heightAt( x, z ), z ); w.player.yaw = yaw; };
const dist = ( w, r ) => Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z );
const face = ( w, r ) => { w.player.yaw = yawToward( w.player.position.x, w.player.position.z, r.x, r.z ); };

// an arena of `tiers.length` raiders round ( cx, cz ): spawned (the player far off first), then the player put `d` m south
async function arena( tiers, o = {} ) {

	const cx = FAR.x, cz = FAR.z;
	const slots = tiers.map( ( t, i ) => {

		const a = ( i / tiers.length ) * Math.PI * 2 + 0.4;
		return { id: `t${ t }-${ i }`, x: cx + Math.sin( a ) * 2.5, z: cz - 3 + Math.cos( a ) * 2.5, when: 'day', characters: [ 'bonk', 'doge', 'pengu' ], tier: t };

	} );
	const w = makeWorld( { ...o, options: { slots, dummy: false, practice: false, ...( o.options || {} ) } } );
	run( w, 2 );
	await tick();
	run( w, 1 );
	for ( const r of w.melee.raiders ) r.homeYaw = Math.PI;
	place( w, cx, cz + ( o.d ?? 6 ), 0 );
	return w;

}

// count the player's blows that land on each raider (Raider.takeHit with something dealt)
function countHits( w ) {

	for ( const r of w.melee.raiders ) {

		if ( r._counted ) continue;
		r._counted = true;
		r.blows = 0;
		r.blowsToKill = null;
		const orig = r.takeHit.bind( r );
		r.takeHit = ( dmg ) => {

			const res = orig( dmg );
			if ( res.dealt > 0 ) {

				r.blows ++;
				if ( res.killed && r.blowsToKill === null ) r.blowsToKill = r.blows;

			}

			return res;

		};

	}

}

// ---------------------------------------------------------------- the scripted player: "block, then swing twice"
// Guard up while a blow is coming (a wind-up in reach, a rock being thrown or in the air), facing it, but only REACT s after
// the telegraph starts (a person's reaction, not the code's): a telegraph shorter than that cannot be blocked. After a blow
// is blocked (or parried), two swings at that raider; a swing once started runs its course (it cannot be guarded out of).
// Otherwise close in on the nearest raider (a punishable one first) and wait guarded. Returns the stats of the fight.
const REACT = 0.25;
function botFight( w, { maxT = 120, ids = null } = {} ) {

	const m = w.melee, c = m.combat, inp = w.input;
	const mine = ( r ) => ! ids || ids.includes( r );
	let plan = 0, target = null, lmbPrev = false, t = 0;
	const out = { minHp: c.hp, hurt: 0, blocked: 0, parried: 0, rocksBlocked: 0, rocksHit: 0, maxWindups: 0, maxTokens: 0, minGap: Infinity, time: 0, won: false, guardDrops: 0 };
	const seenStrike = new Map();
	countHits( w );
	while ( t < maxT ) {

		const p = w.player.position;
		const all = m.raiders.filter( ( r ) => r.active && mine( r ) );
		const alive = all.filter( ( r ) => r.hp > 0 && ! r.yielded );
		if ( ! alive.length ) { out.won = true; break; }
		// the threats: a wind-up in reach, a throw, a rock in the air
		let threat = null, urg = - 1;
		for ( const r of alive ) {

			let u = - 1;
			if ( r.state === 'windup' && r.t >= REACT && dist( w, r ) < r.cfg.hitRange + 1 ) u = r.t / r.cfg.windup;
			else if ( r.state === 'throw' && r.t >= REACT ) u = 0.5 * r.t / THROW.windup;
			if ( u > urg ) { urg = u; threat = r; }

		}

		for ( const rk of m.rocks.list ) if ( ! rk.passed && rk.src.thrower ) { threat = rk.src.thrower; urg = 2; }
		let lmb = false;
		if ( threat && c.state !== 'swing' ) {

			face( w, threat );
			inp.rightDown = true;

		} else if ( plan > 0 && target && target.targetable ) {

			inp.rightDown = false;
			face( w, target );
			if ( dist( w, target ) > 2.1 && c.state === 'free' ) {

				const d = dist( w, target );
				const s = Math.min( 2.7 * DT, d - 2.0 );
				place( w, p.x + ( target.x - p.x ) / d * s, p.z + ( target.z - p.z ) / d * s );

			} else if ( c.state === 'free' && ! lmbPrev ) { lmb = true; plan --; }

		} else {

			plan = 0;
			let best = null, bd = Infinity;
			for ( const r of alive ) {

				if ( ! r.targetable ) continue;
				const open = r.state === 'recover' || ( r.state === 'stagger' && r.parriedT > 0 );
				const d = dist( w, r ) - ( open ? 3 : 0 ) + ( r.role === 'thrower' ? 6 : 0 );
				if ( d < bd ) { bd = d; best = r; }

			}

			target = best;
			if ( target ) {

				face( w, target );
				const d = dist( w, target );
				if ( ( target.state === 'recover' || ( target.state === 'stagger' && target.parriedT > 0 ) ) && d < 2.5 ) { plan = 2; inp.rightDown = false; }
				else {

					inp.rightDown = true; // wait guarded
					if ( d > 2.2 ) {

						const s = Math.min( 2.7 * DT, d - 2.1 );
						place( w, p.x + ( target.x - p.x ) / d * s, p.z + ( target.z - p.z ) / d * s );

					}

				}

			}

		}

		inp.mouseDown = lmb;
		lmbPrev = lmb;
		const hp0 = c.hp;
		frame( w );
		t += DT;
		if ( c.hp < hp0 ) out.hurt ++;
		out.minHp = Math.min( out.minHp, c.hp );
		out.maxTokens = Math.max( out.maxTokens, m.tokens.size );
		out.maxWindups = Math.max( out.maxWindups, all.filter( ( r ) => r.state === 'windup' ).length );
		const up = all.filter( ( r ) => r.active && r.state !== 'down' && r.state !== 'gone' );
		for ( let i = 0; i < up.length; i ++ ) for ( let j = i + 1; j < up.length; j ++ ) out.minGap = Math.min( out.minGap, Math.hypot( up[ i ].x - up[ j ].x, up[ i ].z - up[ j ].z ) );
		// a melee blow just resolved: blocked / parried -> the two swings
		for ( const r of all ) {

			if ( r.state === 'strike' && seenStrike.get( r ) !== r.strikeCount ) {

				seenStrike.set( r, r.strikeCount );
				if ( r.outcome === 'blocked' || r.outcome === 'chipped' ) { out.blocked ++; plan = 2; target = r; }

			}

			if ( r.state === 'stagger' && r.parriedT > 0 && seenStrike.get( r ) !== 'p' + r.strikeCount ) {

				seenStrike.set( r, 'p' + r.strikeCount );
				out.parried ++;
				plan = 2;
				target = r;

			}

		}

	}

	for ( const ev of w.log.events ) if ( ev[ 0 ] === 'rockThrown' ) out.rocks = ( out.rocks || 0 ) + 1;
	out.time = t;
	inp.rightDown = false;
	inp.mouseDown = false;
	return out;

}

// ---------------------------------------------------------------- 0. the arena

{

	ok( ! inPeace( FAR.x, FAR.z ) && ! inPeace( FAR.x - 60, FAR.z ), 'the harness arena is outside the peaceful home waters' );
	ok( PLAYER.attackDamage > 0 && TIERS[ 1 ].hp > 0 && TIERS[ 3 ].hp > 0, 'data loaded' );

}

// ---------------------------------------------------------------- 1. one on one: swings to kill by tier

const swingsToKill = {};
for ( const tier of [ 1, 2, 3 ] ) {

	const w = await arena( [ tier ] );
	const m = w.melee, c = m.combat;
	const r = m.raiders[ 0 ];
	ok( r && r.tier === tier && r.maxHp === tierCfg( RAIDER, tier ).hp, `tier ${ tier }: a raider with ${ r && r.maxHp } hp` );
	const res = botFight( w, { maxT: 90 } );
	swingsToKill[ tier ] = r.blowsToKill;
	report.push( `tier ${ tier } 1v1: ${ r.blowsToKill } swings, ${ res.time.toFixed( 1 ) } s, player ${ Math.round( res.minHp ) } hp min, ${ res.blocked } blocks / ${ res.parried } parries` );
	ok( res.won, `tier ${ tier }: the scripted player wins one on one (${ res.time.toFixed( 1 ) } s)` );
	if ( tier === 1 ) ok( r.blowsToKill >= 3 && r.blowsToKill <= 4, `a tier 1 raider dies in 3-4 swings (${ r.blowsToKill })` );
	if ( tier === 3 ) ok( r.blowsToKill >= 6 && r.blowsToKill <= 8, `a tier 3 raider dies in 6-8 swings (${ r.blowsToKill })` );
	if ( tier === 2 ) ok( r.blowsToKill >= 4 && r.blowsToKill <= 6, `a tier 2 raider sits between (${ r.blowsToKill } swings)` );
	ok( res.blocked + res.parried >= 1 && c.stats.hits >= r.blowsToKill, `tier ${ tier }: the loop blocks his blows and lands its swings` );
	// plain blows too (nothing punished): the curve holds
	const plain = Math.ceil( r.maxHp / PLAYER.attackDamage ), punished = Math.ceil( r.maxHp / Math.round( PLAYER.attackDamage * PLAYER.punishBonus ) );
	if ( tier === 1 ) ok( plain >= 3 && plain <= 4 && punished >= 3, `tier 1 by plain blows ${ plain }, by punishes ${ punished } (3-4)` );
	if ( tier === 3 ) ok( plain >= 6 && plain <= 8 && punished >= 6, `tier 3 by plain blows ${ plain }, by punishes ${ punished } (6-8)` );
	m.dispose();

}

// ---------------------------------------------------------------- 2. the guard held through the telegraph blocks

{

	const w = await arena( [ 1 ] );
	const m = w.melee, c = m.combat, r = m.raiders[ 0 ];
	m.lockOn = false;
	place( w, r.x, r.z + 1.9, 0 );
	face( w, r );
	let guardedAll = true, inWind = false, s0 = null, delta = null, hp0 = c.hp, outcome = null;
	for ( let i = 0; i < 60 * 6 && outcome === null; i ++ ) {

		place( w, r.x, r.z + 1.9 );
		face( w, r );
		w.input.rightDown = r.state === 'windup' && r.t < 0.3 ? true : w.input.rightDown && r.state === 'windup';
		if ( r.state === 'windup' && r.t > 0.4 && ! c.guarding ) guardedAll = false;
		const sBefore = w.player.stamina;
		const was = r.state;
		frame( w );
		if ( was === 'windup' && r.state === 'strike' ) {

			outcome = r.outcome;
			// the frame's own refill (Player.js) and the guard's drain aside: the block's cost
			delta = sBefore + DT / 6 - w.player.stamina - PLAYER.guardDrain * DT;

		}

		if ( r.state === 'windup' ) inWind = true;

	}

	w.input.rightDown = false;
	ok( inWind && guardedAll, 'the guard stays up through the whole telegraph (no drop)' );
	ok( outcome === 'blocked' && c.hp === hp0, `a guard held through the telegraph blocks: no damage (${ outcome })` );
	ok( delta !== null && Math.abs( delta - 0.15 ) < 0.006, `the block costs 0.15 stamina (${ delta && delta.toFixed( 3 ) })` );
	ok( c.guardFlash > 0.5 && w.log.vfx.some( ( v ) => v[ 0 ] === 'debris' && v[ 5 ] === 'metal' ), 'the block flashes the shield and throws sparks off the guard' );
	report.push( `block: ${ delta.toFixed( 3 ) } stamina, 0 damage` );
	m.dispose();

}

// ---------------------------------------------------------------- 3. an unguarded tier 1 blow costs ~12 %

{

	const w = await arena( [ 1 ] );
	const m = w.melee, c = m.combat, r = m.raiders[ 0 ];
	place( w, r.x, r.z + 1.9, 0 );
	let outcome = null;
	for ( let i = 0; i < 60 * 6 && outcome === null; i ++ ) {

		place( w, r.x, r.z + 1.9 );
		face( w, r );
		const was = r.state;
		frame( w );
		if ( was === 'windup' && r.state === 'strike' ) outcome = r.outcome;

	}

	const lost = 100 - c.hp;
	ok( outcome === 'hit' && lost >= 11 && lost <= 13, `an unguarded tier 1 blow costs ~12 % health (${ lost } %)` );
	ok( w.log.kicks.includes( 'meleeHurt' ) && c.hurtFlash > 0.5, 'being hit staggers the camera (meleeHurt) and flashes the screen edge' );
	ok( c.state === 'hurt', 'and the player reels (hurt)' );
	report.push( `unguarded tier 1 blow: ${ lost } % (was 14)` );
	m.dispose();

}

// ---------------------------------------------------------------- 4. a dodge in the last 0.25 s of the wind-up

{

	const cases = [];
	for ( const lead of [ 0.25, 0.18, 0.1, 0.05, DT ] ) for ( const dir of [ 'left', 'right', 'back', 'none' ] ) cases.push( { lead, dir } );
	let clean = 0;
	const fails0 = [];
	for ( const cs of cases ) {

		const w = await arena( [ 1 ] );
		const m = w.melee, c = m.combat, r = m.raiders[ 0 ];
		m.lockOn = false;
		let outcome = null, pressed = false;
		for ( let i = 0; i < 60 * 6 && outcome === null; i ++ ) {

			if ( ! pressed ) { place( w, r.x, r.z + 1.9 ); face( w, r ); }
			w.input.keys.clear();
			if ( r.state === 'windup' && ! pressed && r.cfg.windup - r.t <= cs.lead + 1e-6 ) {

				pressed = true;
				w.input.pressed.add( 'KeyQ' );
				if ( cs.dir === 'left' ) w.input.keys.add( 'KeyA' );
				if ( cs.dir === 'right' ) w.input.keys.add( 'KeyD' );
				if ( cs.dir === 'back' ) w.input.keys.add( 'KeyS' );

			}

			const was = r.state;
			frame( w );
			if ( was === 'windup' && r.state === 'strike' ) outcome = r.outcome;

		}

		if ( pressed && c.hp === 100 && ( outcome === 'dodged' || outcome === 'missed' ) ) clean ++;
		else fails0.push( `${ cs.lead.toFixed( 3 ) } ${ cs.dir }: ${ outcome } ${ c.hp }` );
		m.dispose();

	}

	ok( clean === cases.length, `a dodge anywhere in the last 0.25 s of the wind-up takes no damage (${ clean } / ${ cases.length }${ fails0.length ? ': ' + fails0.join( ', ' ) : '' })` );
	report.push( `dodge: ${ clean } / ${ cases.length } clean (i-frames ${ PLAYER.evadeInvuln } s)` );

}

// ---------------------------------------------------------------- 5. the parry: raised within 0.2 s before the blow

{

	let parries = 0, staggers = [], slowSeen = 0, sounds = 0;
	const leads = [ 0.2, 0.15, 0.1, 0.05, 0.03 ];
	for ( const lead of leads ) {

		const w = await arena( [ 1 ] );
		const m = w.melee, c = m.combat, r = m.raiders[ 0 ];
		m.lockOn = false;
		let outcome = null, staggerT = 0, slow = false;
		for ( let i = 0; i < 60 * 6 && outcome === null; i ++ ) {

			place( w, r.x, r.z + 1.9 );
			face( w, r );
			w.input.rightDown = r.state === 'windup' && r.cfg.windup - r.t <= lead + 1e-6;
			const was = r.state;
			frame( w );
			if ( was === 'windup' && r.state !== 'windup' ) outcome = r.outcome;

		}

		w.input.rightDown = false;
		if ( outcome === 'parried' && c.hp === 100 ) parries ++;
		if ( m.timeScale > 0 && m.timeScale < 1 ) slow = true;
		if ( w.log.sfx.includes( 'parry' ) ) sounds ++;
		// how long he reels (sim time: the slow motion runs his clock slower)
		const t0 = m.simTime;
		for ( let i = 0; i < 60 * 3 && r.state === 'stagger'; i ++ ) { frame( w ); if ( m.timeScale > 0 && m.timeScale < 1 ) slow = true; }
		staggerT = m.simTime - t0;
		staggers.push( staggerT );
		if ( slow ) slowSeen ++;
		m.dispose();

	}

	ok( parries === leads.length, `a guard raised 0.03 - 0.2 s before the blow parries it (${ parries } / ${ leads.length })` );
	ok( staggers.every( ( s ) => s > 0.93 && s < 1.07 ), `a parry staggers the raider for 1 s (${ staggers.map( ( s ) => s.toFixed( 2 ) ).join( ', ' ) })` );
	ok( slowSeen === leads.length && FEEL.slowT === 0.3 && FEEL.slowK === 0.4, 'the parry slows the fight: 0.3 s at 0.4 speed (melee.timeScale)' );
	ok( sounds === leads.length, 'and rings its own sound (the parry clang)' );
	report.push( `parry: ${ parries } / ${ leads.length } in the 0.2 s window, stagger ${ staggers[ 0 ].toFixed( 2 ) } s` );

}

// ---------------------------------------------------------------- 6. a swing that connects: hitstop, kick, number, dust; a whiff; the dodge cancel

{

	const w = await arena( [ 2 ] );
	const m = w.melee, c = m.combat, r = m.raiders[ 0 ];
	m.setPeaceful( true ); // he stands still while we measure
	r._enter( 'idle' );
	place( w, r.x + 0.7, r.z + 1.65 ); // 1.8 m off, a little to the side
	face( w, r );
	w.player.yaw += 0.35;
	ok( Math.abs( dist( w, r ) - 1.8 ) < 0.01, 'the raider stands 1.8 m off, 20 degrees off the facing' );
	w.input.mouseDown = true;
	frame( w );
	w.input.mouseDown = false;
	let stopped = null, frozenT = null;
	for ( let i = 0; i < 40 && stopped === null; i ++ ) {

		frame( w );
		if ( m.stopT > 0 ) { stopped = m.stopT; frozenT = { c: c.t, r: r.t }; }

	}

	ok( c.lastSwing && c.lastSwing.target === r, 'a swing at 1.8 m connects (no whiff)' );
	ok( stopped !== null && stopped >= 0.04 && stopped <= 0.09 && m.stops >= 1, `the hit freezes the fight: hitstop ${ stopped && ( stopped + DT ).toFixed( 3 ) } s (60-90 ms)` );
	frame( w );
	ok( frozenT && c.t === frozenT.c && r.t === frozenT.r && m.timeScale === 0, 'both fighters stand still in the hitstop (the player\'s swing and the raider)' );
	ok( w.log.kicks.includes( 'meleeHit' ) || w.log.kicks.includes( 'meleeHeavy' ), 'a camera kick' );
	ok( w.log.sfx.includes( 'paddleHit' ), 'a hit sound' );
	ok( w.log.vfx.some( ( v ) => v[ 0 ] === 'dust' ), 'a dust puff at the contact' );
	runFor( w, 0.5 );
	ok( c.state === 'free', 'the swing is over' );
	// the dodge cancel: Q after the contact ends the recovery at once
	r._enter( 'idle' );
	w.input.mouseDown = true;
	frame( w );
	w.input.mouseDown = false;
	let cancelAt = null;
	for ( let i = 0; i < 60 && cancelAt === null; i ++ ) {

		if ( c.state === 'swing' && c.swingContact && m.stopT <= 0 ) { w.input.pressed.add( 'KeyQ' ); }
		frame( w );
		if ( c.state === 'evade' ) cancelAt = c.stats.cancels;

	}

	ok( cancelAt >= 1, 'Q after the contact cancels the swing\'s recovery into the dodge' );
	runFor( w, 0.8 );
	// a press before the contact waits for it: the blow still lands, the dodge follows
	r._enter( 'idle' );
	place( w, r.x + 0.7, r.z + 1.65 );
	face( w, r );
	const hits0 = c.stats.hits;
	w.input.mouseDown = true;
	frame( w );
	w.input.mouseDown = false;
	w.input.pressed.add( 'KeyQ' );
	frame( w );
	let evaded = false;
	for ( let i = 0; i < 40; i ++ ) { frame( w ); if ( c.state === 'evade' ) evaded = true; }
	ok( c.stats.hits === hits0 + 1 && evaded, 'Q before the contact is queued: the blow lands, then the dodge' );
	runFor( w, 0.8 );
	// a whiff: a swish and the longer recovery
	w.player.yaw += Math.PI;
	const sw = w.log.sfx.length;
	w.input.mouseDown = true;
	frame( w );
	w.input.mouseDown = false;
	let len = 0;
	for ( let i = 0; i < 90 && ( c.state === 'swing' || len === 0 ); i ++ ) { frame( w ); if ( c.state === 'swing' ) len += DT; }
	ok( c.lastSwing === null && w.log.sfx.slice( sw ).includes( 'hookSwing' ), 'a whiff swishes' );
	ok( Math.abs( len - PLAYER.whiffTotal ) < 0.05 && PLAYER.whiffTotal > PLAYER.attackTotal, `and recovers a little longer (${ len.toFixed( 2 ) } s, a hit ${ PLAYER.attackTotal } s)` );
	m.dispose();

}

// ---------------------------------------------------------------- 7. interrupts by tier

{

	const w = await arena( [ 1, 3 ] );
	const m = w.melee;
	m.setPeaceful( true );
	const [ t1, t3 ] = m.raiders;
	t1._enter( 'windup' );
	t1.takeHit( PLAYER.attackDamage );
	ok( t1.state === 'stagger' && ! t1.alert, 'a tier 1 raider hit in his wind-up is interrupted' );
	t3._enter( 'windup' );
	t3.takeHit( PLAYER.attackDamage );
	ok( t3.state === 'windup' && t3.alert, 'a tier 3 raider keeps winding up through a plain blow' );
	ok( t3.parried() && t3.state === 'stagger', 'a parry stops the tier 3 wind-up' );
	// a ball stops it too (firearms: windup -> parried())
	t3.hp = t3.maxHp;
	t3._enter( 'windup' );
	w.fa.owned.pistol = true; w.fa.loaded.pistol = true; w.fa.shots = 10;
	place( w, t3.x, t3.z + 10, 0 );
	w.fa.draw( 'pistol' );
	runFor( w, 0.45, () => { if ( t3.state !== 'windup' ) t3._enter( 'windup' ); } );
	t3.t = 0.1;
	aimAt( w, t3, 1.2 );
	w.fa.aiming = true;
	const shot = w.fa.fire();
	ok( shot.hit === 'raider' && t3.state === 'stagger', `a ball stops the tier 3 wind-up (${ shot.hit }, ${ t3.state })` );
	ok( TIERS[ 1 ].armored !== true && TIERS[ 2 ].armored !== true && TIERS[ 3 ].armored === true, 'tiers 1-2 are interruptible, tier 3+ only by a parry or a shot' );
	m.dispose();

}

// ---------------------------------------------------------------- 8. three tier 1 raiders: the loop wins above 40 %

{

	const w = await arena( [ 1, 1, 1 ], { d: 7 } );
	const m = w.melee, c = m.combat;
	const res = botFight( w, { maxT: 150 } );
	const throwers = new Set( w.log.events.filter( ( e ) => e[ 0 ] === 'rockThrown' ).map( ( e ) => e[ 1 ].by ) );
	report.push( `3 x tier 1: ${ res.won ? 'won' : 'LOST' } in ${ res.time.toFixed( 1 ) } s, player min ${ Math.round( res.minHp ) } hp, hit ${ res.hurt } x, ${ res.blocked } blocks, ${ res.rocks || 0 } rocks (${ c.stats.blocks - res.blocked } blocked)` );
	ok( res.won, `the scripted "block then swing twice" loop beats three tier 1 raiders (${ res.time.toFixed( 1 ) } s)` );
	ok( res.minHp >= 40, `without dropping under 40 % health (min ${ Math.round( res.minHp ) })` );
	ok( res.maxWindups <= 1 && res.maxTokens <= 1, `a tier 1 crowd takes turns: at most one wind-up at once (${ res.maxWindups }), one token (${ res.maxTokens })` );
	ok( res.minGap > 0.8, `they keep apart, no stacking (closest ${ res.minGap.toFixed( 2 ) } m)` );
	ok( ( res.rocks || 0 ) >= 1 && throwers.size >= 1, `one of three hangs back and throws rocks (${ res.rocks || 0 } thrown)` );
	const blocksAll = c.stats.blocks;
	ok( blocksAll > res.blocked, `the guard blocks the rocks too (${ blocksAll - res.blocked } rock blocks)` );
	m.dispose();

}

// ---------------------------------------------------------------- 9. two tier 2 and a mixed crowd (the curve)

{

	const w = await arena( [ 2, 2 ] );
	const res = botFight( w, { maxT: 150 } );
	report.push( `2 x tier 2: ${ res.won ? 'won' : 'LOST' } in ${ res.time.toFixed( 1 ) } s, player min ${ Math.round( res.minHp ) } hp` );
	ok( res.won && res.minHp > 0, `two tier 2 raiders: the loop wins (min ${ Math.round( res.minHp ) } hp)` );
	ok( res.maxWindups <= 2 && res.maxTokens <= 2, 'never more than two swing at once' );
	w.melee.dispose();
	const w3 = await arena( [ 1, 2, 3 ] );
	const res3 = botFight( w3, { maxT: 180 } );
	report.push( `tiers 1+2+3: ${ res3.won ? 'won' : 'LOST' } in ${ res3.time.toFixed( 1 ) } s, player min ${ Math.round( res3.minHp ) } hp (a real fight)` );
	ok( res3.maxWindups <= 2 && res3.minGap > 0.7, `a mixed crowd: at most two wind-ups at once, no stacking (${ res3.minGap.toFixed( 2 ) } m)` );
	ok( w3.melee.combat.stats.hurt >= 1 || res3.minHp < 100, 'a tier 3 crowd can hurt (it is harder)' );
	w3.melee.dispose();

}

// ---------------------------------------------------------------- 10. a rock: unguarded it hits, the guard blocks it

{

	const w = await arena( [ 1 ] );
	const m = w.melee, c = m.combat, r = m.raiders[ 0 ];
	m.setPeaceful( true );
	r.role = 'thrower'; r.roleBy = m;
	place( w, r.x, r.z + 8.5, 0 );
	face( w, r );
	m.throwRock( r, { x: w.player.position.x, y: w.player.position.y, z: w.player.position.z } );
	let n = 0;
	while ( m.rocks.list.length && n ++ < 180 ) frame( w );
	const lost = 100 - c.hp;
	ok( lost > 0 && lost <= Math.ceil( TIERS[ 1 ].damage * THROW.damage ) + 1, `an unguarded rock hits for ${ lost }` );
	c.hurtInv = 0; c.state = 'free';
	runFor( w, 1 );
	const s0 = w.player.stamina;
	w.input.rightDown = true;
	frame( w );
	m.throwRock( r, { x: w.player.position.x, y: w.player.position.y, z: w.player.position.z } );
	const hp1 = c.hp;
	n = 0;
	let rk = m.rocks.list[ 0 ];
	while ( m.rocks.list.length && n ++ < 180 ) frame( w );
	w.input.rightDown = false;
	ok( rk.outcome === 'blocked' && c.hp === hp1, `a guarded rock is blocked (${ rk.outcome })` );
	// a dodge lets it pass
	runFor( w, 1 );
	m.throwRock( r, { x: w.player.position.x, y: w.player.position.y, z: w.player.position.z } );
	rk = m.rocks.list[ 0 ];
	const hp2 = c.hp;
	for ( let i = 0; i < 180 && m.rocks.list.length; i ++ ) {

		if ( ! c.evadeInv && rk.t > rk.flight - 0.15 && c.state === 'free' ) { w.input.pressed.add( 'KeyQ' ); w.input.keys.add( 'KeyA' ); }
		frame( w );
		w.input.keys.clear();

	}

	ok( c.hp === hp2, `a dodge as it arrives lets it pass (${ rk.outcome || 'passed' })` );
	ok( r.cfg.windup > 0 && THROW.windup >= 0.8, `a throw is telegraphed (${ THROW.windup } s, the ring marks where it lands)` );
	m.dispose();

}

// ---------------------------------------------------------------- 11. knockdown: 2.5 s down, then back in

{

	const w = await arena( [ 2 ] );
	const m = w.melee, r = m.raiders[ 0 ];
	place( w, r.x, r.z + 10, 0 );
	run( w, 2 );
	w.fa.owned.musket = true; w.fa.loaded.musket = true; w.fa.shots = 10;
	w.fa.draw( 'musket' );
	runFor( w, 0.9 );
	aimAt( w, r, 1.2 );
	w.fa.aiming = true;
	const hp0 = r.hp;
	const shot = w.fa.fire();
	ok( shot.hit === 'raider' && r.hp === hp0 - WEAPONS.musket.damage && r.hp > 0, `a musket ball into a tier 2 raider: ${ WEAPONS.musket.damage } (he lives)` );
	ok( r.state === 'down' && r.knocked && ! r.targetable, 'and knocks him off his feet' );
	let downT = 0;
	while ( r.state === 'down' && downT < 6 ) { frame( w ); downT += DT; }
	ok( Math.abs( downT - RAIDER.downTime ) < 0.1 && RAIDER.downTime === 2.5, `he stays down ${ downT.toFixed( 2 ) } s (2.5) before getting up` );
	ok( r.state === 'getup', 'then gets up' );
	runFor( w, RAIDER.getUpTime + 0.2 );
	ok( r.targetable && r.hp > 0 && [ 'approach', 'circle', 'windup', 'notice', 'strike', 'recover' ].includes( r.state ), `and comes back at the player (${ r.state })` );
	m.dispose();

}

// ---------------------------------------------------------------- 12. the guns: 2 body shots or 1 head shot (pistol), 1 body shot (musket)

function aimAt( w, r, h ) {

	const cam = w.camera, p = w.player.position;
	cam.position.set( p.x, p.y + 1.6, p.z + 0.01 );
	const y = typeof h === 'number' ? r.y + h * ( r.scale || 1 ) : h.y;
	const d = new Vector3( r.x - cam.position.x, y - cam.position.y, r.z - cam.position.z ).normalize();
	cam.quaternion.copy( new Quaternion().setFromUnitVectors( new Vector3( 0, 0, - 1 ), d ) );
	cam.updateMatrixWorld( true );

}

async function shootTrial( weapon, part, seed ) {

	const w = await arena( [ 1 ], { seed } );
	const m = w.melee, fa = w.fa, r = m.raiders[ 0 ];
	place( w, r.x, r.z + 10, 0 );
	fa.owned[ weapon ] = true; fa.loaded[ weapon ] = true; fa.shots = 20;
	fa.draw( weapon );
	runFor( w, WEAPONS[ weapon ].draw + 0.05 );
	let shots = 0;
	const kinds = [];
	while ( r.hp > 0 && shots < 6 ) {

		place( w, w.player.position.x, w.player.position.z );
		const d = dist( w, r );
		// the head: the sphere's centre; the body: the chest
		const hp = new Vector3();
		r.headPosition( hp );
		aimAt( w, r, part === 'head' ? { y: hp.y } : 1.15 );
		w.input.rightDown = true; // aiming
		frame( w );
		w.input.mouseDown = true; // LMB fires
		frame( w );
		w.input.mouseDown = false;
		shots ++;
		kinds.push( fa.last ? `${ fa.last.hit }${ fa.last.head ? '/head' : '' }@${ d.toFixed( 1 ) }` : 'none' );
		fa.loaded[ weapon ] = true; // (reloaded by hand: the count is about shots)
		fa.after = 0;

	}

	w.input.rightDown = false;
	const marker = fa.marker;
	m.dispose();
	return { shots, kinds, killed: r.hp <= 0, marker };

}

{

	const P = [], H = [], M = [];
	for ( let s = 1; s <= 8; s ++ ) {

		P.push( await shootTrial( 'pistol', 'body', s ) );
		H.push( await shootTrial( 'pistol', 'head', 100 + s ) );
		M.push( await shootTrial( 'musket', 'body', 200 + s ) );

	}

	ok( P.every( ( t ) => t.killed && t.shots === 2 ), `the pistol kills a tier 1 raider at 10 m in 2 body shots (${ P.map( ( t ) => t.shots ).join( ' ' ) })` );
	ok( H.every( ( t ) => t.killed && t.shots === 1 ), `or 1 head shot (${ H.map( ( t ) => t.shots + ':' + t.kinds[ 0 ] ).join( ' ' ) })` );
	ok( M.every( ( t ) => t.killed && t.shots === 1 ), `the musket in 1 body shot (${ M.map( ( t ) => t.shots ).join( ' ' ) })` );
	ok( P.every( ( t ) => t.marker === 'kill' ) && H.every( ( t ) => t.marker === 'kill' ), 'each kill shows the kill confirmation' );
	report.push( `pistol @10 m: ${ WEAPONS.pistol.damage } body / ${ Math.round( WEAPONS.pistol.damage * HEADSHOT ) } head -> 2 body or 1 head; musket ${ WEAPONS.musket.damage } -> 1 body` );

}

// ---------------------------------------------------------------- 13. shooting feel: markers, magnetism, the walking spread, kill hitstop, reload ring

{

	const w = await arena( [ 3 ] );
	const m = w.melee, fa = w.fa, r = m.raiders[ 0 ];
	m.setPeaceful( true );
	r._enter( 'idle' );
	place( w, r.x, r.z + 20, 0 );
	fa.owned.pistol = true; fa.loaded.pistol = true; fa.shots = 20;
	fa.rand = () => 0; // dead centre: the aim alone decides
	fa.draw( 'pistol' );
	runFor( w, 0.5 );
	// aim 2 degrees off his chest at 20 m: the shot snaps onto him
	const off = ( deg ) => {

		const cam = w.camera, p = w.player.position;
		cam.position.set( p.x, p.y + 1.6, p.z );
		const c = new Vector3( r.x - cam.position.x, r.y + MAGNET.chest - cam.position.y, r.z - cam.position.z ).normalize();
		const side = new Vector3( - c.z, 0, c.x ).normalize();
		const d = c.clone().multiplyScalar( Math.cos( deg * DEG ) ).add( side.multiplyScalar( Math.sin( deg * DEG ) ) ).normalize();
		cam.quaternion.copy( new Quaternion().setFromUnitVectors( new Vector3( 0, 0, - 1 ), d ) );

	};

	off( 2.0 );
	const s1 = fa.fire();
	ok( s1.hit === 'raider' && s1.magnet, `2 degrees off his chest at 20 m: the shot snaps onto him (${ s1.hit })` );
	ok( fa.marker === 'hit', 'a hit marker' );
	fa.loaded.pistol = true; fa.after = 0;
	off( 4.0 );
	const s2 = fa.fire();
	ok( s2.hit !== 'raider' && ! s2.magnet, `4 degrees off: no snap, a miss (${ s2.hit })` );
	// a head shot keeps its own marker (magnetism never pulls a head aim down to the chest)
	fa.loaded.pistol = true; fa.after = 0;
	const hp = new Vector3();
	r.headPosition( hp );
	aimAt( w, r, { y: hp.y } );
	const s3 = fa.fire();
	ok( s3.head && fa.marker === 'head' && ! s3.magnet, 'a head shot stays a head shot, with its own marker' );
	// the walking spread: wider on the move, tight while aiming
	fa.rand = Math.random;
	fa.speed = 0; fa.aiming = false;
	const still = fa.spreadNow();
	fa.speed = 2.7;
	const moving = fa.spreadNow();
	fa.aiming = true;
	const aimMove = fa.spreadNow();
	fa.speed = 0;
	const aimStill = fa.spreadNow();
	ok( moving > still && moving - still <= 1.05 * DEG && aimStill < still && aimMove < moving, `the pistol on the move: ${ ( still / DEG ).toFixed( 1 ) } -> ${ ( moving / DEG ).toFixed( 1 ) } deg (small penalty), aimed ${ ( aimStill / DEG ).toFixed( 1 ) }` );
	ok( WEAPONS.musket.walk === 0.7, 'the musket shouldered: walk x0.7' );
	// the musket's pace: a 1 m step while shouldered becomes 0.7 m
	fa.owned.musket = true; fa.loaded.musket = true;
	fa.draw( 'musket' );
	runFor( w, 0.9 );
	const x0 = w.player.position.x;
	w.player.position.x += 0.05;
	frame( w );
	ok( Math.abs( ( w.player.position.x - x0 ) - 0.035 ) < 0.002, `the musket slows the walk to x0.7 (${ ( ( w.player.position.x - x0 ) / 0.05 ).toFixed( 2 ) })` );
	// a kill: hitstop and a heavy kick
	fa.draw( 'pistol' );
	runFor( w, 0.5 );
	r.hp = 10;
	fa.loaded.pistol = true; fa.after = 0; fa.rand = () => 0;
	aimAt( w, r, 1.15 );
	const kicks0 = w.log.kicks.length;
	const s4 = fa.fire();
	ok( s4.killed && m.stopT > 0 && w.log.kicks.slice( kicks0 ).includes( 'meleeHeavy' ) && fa.marker === 'kill', 'a kill: hitstop, a heavy kick and the kill confirmation' );
	// the crosshair and the reload ring (GunHud headless: its numbers)
	const hud = new firearms.GunHud( { hud: new FakeEl( 'hud' ), doc: { head: new FakeEl( 'head' ), createElement: ( t ) => new FakeEl( t ) } } );
	fa.hud = hud;
	fa.loaded.pistol = false;
	fa.aiming = false;
	frame( w );
	ok( hud.shown && hud.cue && hud.gap > 3, `drawn: the crosshair (gap ${ hud.gap.toFixed( 1 ) } px) and "R to reload" while empty` );
	const g0 = hud.gap;
	w.input.rightDown = true;
	runFor( w, 0.2 );
	ok( hud.gap < g0, `aiming tightens the crosshair (${ g0.toFixed( 1 ) } -> ${ hud.gap.toFixed( 1 ) } px)` );
	w.input.rightDown = false;
	w.input.pressed.add( 'KeyR' );
	frame( w );
	runFor( w, 0.7 );
	ok( fa.phase === 'reloading' && hud.ringK > 0.4 && hud.ringK < 0.6 && ! hud.cue, `the reload ring fills (${ hud.ringK.toFixed( 2 ) } at 0.7 s of ${ WEAPONS.pistol.reload } s)` );
	fa.holster( true );
	frame( w );
	ok( ! hud.shown, 'holstered: no crosshair' );
	m.dispose();

}

// ---------------------------------------------------------------- 14. the lock-on reticle: his health and his wind-up as a filling ring

{

	const w = await arena( [ 1 ] );
	const m = w.melee, r = m.raiders[ 0 ];
	const doc = { head: new FakeEl( 'head' ), createElement: ( t ) => new FakeEl( t ) };
	const hud = new MeleeHud( { hud: new FakeEl( 'hud' ), camera: w.camera, doc } );
	m.hud = hud;
	place( w, r.x, r.z + 2, 0 );
	face( w, r );
	w.camera.position.set( r.x, r.y + 2.5, r.z + 6 );
	w.camera.lookAt( r.x, r.y + 1, r.z );
	w.camera.updateMatrixWorld( true );
	let ring = [], gold = false, hpShown = null;
	for ( let i = 0; i < 60 * 5; i ++ ) {

		place( w, r.x, r.z + 2 );
		face( w, r );
		m.combat.hurtInv = 9;
		frame( w );
		if ( m.lock === r && r.state === 'windup' ) {

			ring.push( hud.ring );
			if ( hud.lockEl.classList.contains( 'is-parry' ) ) gold = true;

		}

		if ( m.lock === r ) hpShown = hud.lockHpFrac;

	}

	const rising = ring.length > 10 && ring.every( ( k, i ) => i === 0 || k >= ring[ i - 1 ] - 1e-9 || k < 0.1 );
	ok( ring.length > 10 && rising && Math.max( ...ring ) > 0.9, `the lock ring fills with his wind-up up to the blow (max ${ Math.max( 0, ...ring ).toFixed( 2 ) })` );
	ok( gold, 'and turns gold in the parry window' );
	r.hp = r.maxHp / 2;
	frame( w );
	ok( Math.abs( hud.lockHpFrac - 0.5 ) < 0.01 && hpShown !== null, 'the reticle carries his health (50 %)' );
	// low health pulses the edge, the shield flashes on a block
	m.combat.hp = 20;
	const hurt = [];
	for ( let i = 0; i < 60; i ++ ) { frame( w ); hurt.push( Number( hud.hurtEl.style.opacity ) ); }
	ok( Math.max( ...hurt ) - Math.min( ...hurt ) > 0.1, `low health pulses the screen edge (${ Math.min( ...hurt ).toFixed( 2 ) } - ${ Math.max( ...hurt ).toFixed( 2 ) })` );
	m.flash( 'block' );
	frame( w );
	ok( Number( hud.shieldEl.style.opacity ) > 0.8, 'a blocked blow flashes the shield' );
	m.dispose();

}

// ---------------------------------------------------------------- 15. the guard stance: always up while RMB is held with the rod away

{

	const w = makeWorld( { options: { dummy: false, practice: false } } );
	const m = w.melee;
	run( w, 2 );
	ok( m.raiders.length === 0 && ! m.engaged(), 'nobody near' );
	w.input.rightDown = true;
	run( w, 3 );
	ok( m.guarding && w.log.montages.includes( 'block' ), 'RMB held with the rod away: the guard stance is up (no enemy needed)' );
	runFor( w, 5 );
	ok( m.guarding, 'and stays up while held' );
	w.input.rightDown = false;
	run( w, 2 );
	ok( ! m.guarding, 'let go: down' );
	w.rod.equipped = true;
	w.input.rightDown = true;
	run( w, 3 );
	ok( ! m.guarding, 'the rod out: RMB is the rod\'s' );
	w.input.rightDown = false;
	m.dispose();

}

// ---------------------------------------------------------------- 16. the practice fight at the training post

{

	const terrain = new TerrainData();
	const w = makeWorld( { terrain, at: { x: TRAINING_POST.x + PRACTICE.rackDx, z: TRAINING_POST.z + PRACTICE.rackDz + 0.8 }, peaceZone: true } );
	const m = w.melee, c = m.combat;
	run( w, 2 );
	ok( m.peaceful && inPeace( w.player.position.x, w.player.position.z ), 'the training post is in the peaceful home waters' );
	const pf = m.practice;
	ok( pf && terrain.heightAt( pf.rack.x, pf.rack.z ) > 0.3, 'the weapon rack stands on dry sand beside the post' );
	const ia = w.features.nearestInteractable( w.player.position );
	ok( ia && /Practice fight/.test( ia.prompt() ), `E at the rack: "${ ia && ia.prompt() }"` );
	place( w, TRAINING_POST.x, TRAINING_POST.z + 1.5 );
	const ia2 = w.features.nearestInteractable( w.player.position );
	ok( ia2 && /Spar/.test( ia2.prompt() ), `E at the post still offers "${ ia2 && ia2.prompt() }"` );
	place( w, pf.rack.x, pf.rack.z + 0.8 );
	ia.onInteract();
	run( w, 2 );
	await tick();
	run( w, 2 );
	const P = pf.partners;
	ok( pf.active && P.length === 2 && P.every( ( r ) => r.tier === 1 && r.practiceFight ), 'two tier 1 practice raiders come at the player' );
	ok( P.every( ( r ) => terrain.heightAt( r.x, r.z ) > 0.15 ), 'on the beach (dry sand)' );
	runFor( w, 1.5 );
	ok( P.some( ( r ) => r.inCombat && r.aggro ), 'they fight inside the peaceful zone (practice only)' );
	// the player shoots? no: wooden swords only
	w.fa.owned.pistol = true; w.fa.loaded.pistol = true; w.fa.shots = 5;
	ok( w.fa.has( 'pistol' ), 'a pistol in the belt' );
	// lose it: no guard, take the blows down to 10 %
	m.lockOn = false;
	let yielded = false;
	for ( let i = 0; i < 60 * 60 && ! yielded; i ++ ) {

		frame( w );
		if ( pf.result === 'lost' ) yielded = true;

	}

	ok( yielded && c.hp === Math.round( c.maxHp * PLAYER.practiceYield ) && c.state !== 'down', `the player yields at 10 % (${ c.hp } hp), not knocked down` );
	ok( w.log.toasts.includes( 'You\'re down - try again' ), 'the toast: "You\'re down - try again"' );
	ok( ! w.log.events.some( ( e ) => e[ 0 ] === 'playerDied' || e[ 0 ] === 'playerKnockedDown' ), 'no death, no knockdown event' );
	runFor( w, PRACTICE.leave + 0.5 );
	ok( pf.partners.length === 0 && c.hp === c.maxHp, 'they leave and the player is whole again' );
	// win it: the bot loop, the partners yield at 1 health
	place( w, pf.rack.x, pf.rack.z + 0.8 );
	pf.start();
	run( w, 3 );
	m.lockOn = true;
	const res = botFight( w, { maxT: 120, ids: pf.partners.slice() } );
	const yieldedAll = pf.raiders.every( ( r ) => r.yielded && r.hp === 1 );
	ok( pf.result === 'won' && yieldedAll, `the loop wins the practice: both yield at 1 health (${ res.time.toFixed( 1 ) } s)` );
	ok( ! w.log.events.some( ( e ) => e[ 0 ] === 'enemyDefeated' ) && w.state.money === 10000, 'no loot, no enemyDefeated (practice)' );
	ok( w.log.toasts.includes( 'Practice won · well fought' ), 'the toast: practice won' );
	m.dispose();

}

// ---------------------------------------------------------------- the tuning table

console.log( '\n-- harness numbers --' );
for ( const l of report ) console.log( '   ' + l );
console.log( `   tiers: hp ${ [ 1, 2, 3, 4 ].map( ( t ) => tierCfg( RAIDER, t ).hp ).join( ' / ' ) }, damage ${ [ 1, 2, 3, 4 ].map( ( t ) => tierCfg( RAIDER, t ).damage ).join( ' / ' ) }, wind-up ${ [ 1, 2, 3, 4 ].map( ( t ) => tierCfg( RAIDER, t ).windup ).join( ' / ' ) } s` );
console.log( `   player: ${ PLAYER.attackDamage } a blow (${ Math.round( PLAYER.attackDamage * PLAYER.punishBonus ) } punish), swing ${ PLAYER.attackTotal } s (whiff ${ PLAYER.whiffTotal }), parry ${ PLAYER.parryWindow } s, i-frames ${ PLAYER.evadeInvuln } s` );
console.log( fails ? `\n${ fails } FAILED` : '\nall combat play tests passed' );
process.exit( fails ? 1 : 0 );
