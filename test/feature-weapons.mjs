// Plain-node test of the arsenal (wave 18D: src/features/weapons + the new firearms): the data, the shop and the fence, the
// melee weapons through the real melee feature (cutlass reach / chain / parry window, the axe through a cutlass guard and an
// armoured wind-up, the harpoon's reach, the pin's stun), the new guns (blunderbuss pellets and shove, the rifle's zoom and
// reach, the duelling pair, the harpoon gun's line on a man, a small hull and a big fish), the throwables (the arc, a bomb's
// blast through the real destruction feature, a fire bottle on a deck, a smoke pot hiding the player), the swivel gun from
// the deck and chain / grape shot through naval's public Ship API, the raiders' arms (the cutlass guard, the gunman), the keys
// against the emote row, the meshes' budget and the save. No GPU, no DOM.
//   node test/feature-weapons.mjs
import { PerspectiveCamera, Vector3, Group, Quaternion } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { Features } from '../src/features/Features.js';
import * as meleeModule from '../src/features/melee/index.js';
import * as firearms from '../src/features/firearms/index.js';
import * as weapons from '../src/features/weapons/index.js';
import { Destruction } from '../src/features/destruction/Destruction.js';
import { KINDS } from '../src/features/destruction/Kinds.js';
import { Ship } from '../src/features/naval/Ship.js';
import { PLAYER, yawToward } from '../src/features/melee/MeleeData.js';
import { peaceZone } from '../src/features/melee/Peace.js';
import { BANKS } from '../src/features/melee/CombatAudio.js';
import { WEAPONS, ORDER, SLOT_OF, LINE, barrelsOf, cartridgesFor } from '../src/features/firearms/FirearmsData.js';
import {
	MELEE, THROWN, SHOT, SLOTS, RAIDER_ARMS, raiderLoadout, arcPoints, throwVelocity, blastFactor, modelTriangles, IDS,
	WEAPON_RECIPES, ATTACK_OF,
} from '../src/features/weapons/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const DT = 1 / 60;
const pz = peaceZone();
const FAR = { x: pz ? pz.x + pz.r + 500 : 3000, z: pz ? pz.z : 0 };
const GROUND = 1;
const flat = { heightAt: () => GROUND };

// ---------------------------------------------------------------- stubs (as test/feature-combat-play.mjs)

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

	constructor() { this.pressed = new Set(); this.mouseDown = false; this.rightDown = false; this.enabled = true; }
	down() { return false; }
	hit( c ) { return this.pressed.has( c ); }
	endFrame() { this.pressed.clear(); }

}

function makeWorld( o = {} ) {

	const log = { events: [], toasts: [], sent: [], vfx: [] };
	const at = o.at || { x: FAR.x - 60, z: FAR.z };
	const player = { position: new Vector3( at.x, GROUND, at.z ), velocity: new Vector3(), yaw: 0, stamina: 1, mode: 'walk', launched: 0, grounded: true };
	const state = { money: o.money ?? 10000, free: !! o.free, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const rod = { equipped: false, equip( on ) { this.equipped = on; } };
	const game = { state, rod, fight: null, hud: null, toast: ( t ) => log.toasts.push( t ), cancelLine() {} };
	const input = new FakeInput();
	const camera = new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 );
	camera.position.set( at.x, GROUND + 1.6, at.z );
	const app = {
		player, input, camera, scene: null, game, terrainData: flat, colliders: new Colliders(),
		settings: { timeOfDay: 12, timeSpeed: 0 }, mode: 'campaign', paused: false, menuOpen: false, freeCam: false,
		avatar: null, audio: null, ui: null, cameraFeel: { fovKick: 0, kick: () => true, baseFov: () => 60 },
		netsync: { sendWorldEvent: ( kind, data ) => log.sent.push( [ kind, data ] ) },
		...( o.app || {} ),
	};
	const features = new Features( app );
	for ( const n of [ 'explosion', 'blast', 'thrown', 'propDestroyed', 'gunFired', 'gunHarpoon', 'fishHarpooned', 'crewShot', 'sectionBroken', 'weaponBought', 'meleeHit', 'enemyDefeated' ] ) features.on( n, ( e ) => log.events.push( [ n, e ] ) );
	const vfx = {};
	for ( const k of [ 'flash', 'smoke', 'splash', 'dust', 'splinters', 'debris', 'fire', 'stopFire', 'explosion' ] ) vfx[ k ] = ( ...a ) => log.vfx.push( [ k, ...a ] );
	features.add( 'vfx', { install: () => vfx } );
	if ( o.naval ) features.add( 'naval', { install: () => o.naval } );
	if ( o.destruction ) features.add( 'destruction', { install: ( a, f ) => new Destruction( a, f, { physics: false, render: false, plan: o.destruction } ) } );
	if ( o.emotes ) features.add( 'emotes', { install: () => o.emotes } );
	const audio = { play() { return true; }, lead: ( b ) => ( BANKS[ b ] ? BANKS[ b ].lead : 0 ), preload() {} };
	const melee = features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, audio, hud: false, fx: false, seed: o.seed ?? 11, captain: false, terrain: flat, peaceZone: false, dummy: false, practice: false, slots: o.slots || [], ...( o.melee || {} ) } ) } );
	const gunAudio = { report() { return true; }, click() { return true; } };
	const fa = features.add( 'firearms', { install: ( a, f ) => firearms.install( a, f, { audio: gunAudio, mesh: false, hud: false, seed: o.seed ?? 11 } ) } );
	const wAudio = { blast() { return true; }, shatter() { return true; }, hiss() { return true; }, whoosh() { return true; }, clang() { return true; }, thud() { return true; }, report() { return true; }, click() { return true; } };
	const wp = features.add( 'weapons', { install: ( a, f ) => weapons.install( a, f, { audio: wAudio, mesh: false, seed: o.seed ?? 11 } ) } );
	return { app, features, melee, fa, wp, player, input, state, log, camera };

}

function frame( w, each = null ) {

	const p = w.player;
	if ( w.melee.combat.state !== 'evade' ) p.stamina = Math.min( 1, p.stamina + DT / 6 );
	w.features.update( DT );
	w.input.endFrame();
	if ( each ) each();

}

const run = ( w, n, each ) => { for ( let i = 0; i < n; i ++ ) frame( w, each ); };
const runFor = ( w, s, each ) => run( w, Math.round( s / DT ), each );
const lookQuat = ( d ) => new Quaternion().setFromUnitVectors( new Vector3( 0, 0, - 1 ), new Vector3( d.x, d.y, d.z ).normalize() );
const look = ( w, d ) => { w.camera.quaternion.copy( lookQuat( d ) ); w.camera.position.set( w.player.position.x, w.player.position.y + 1.6, w.player.position.z ); };
const tick = () => new Promise( ( r ) => setImmediate( r ) );

// a raider in front of the player (yaw 0 faces -Z), d m away; returns him once spawned and placed
async function raiderAt( w, d, o = {} ) {

	const p = w.player.position;
	const slot = { id: o.id || 'wt' + Math.floor( Math.random() * 1e6 ), x: p.x, z: p.z - d, when: 'day', characters: [ 'bonk' ], tier: o.tier || 2, ...( o.weapon !== undefined ? { weapon: o.weapon } : {} ) };
	w.melee.slots.push( { ...slot, raider: null, respawnLeft: 0 } );
	// (raiders only appear out of the player's sight: step away while he spawns)
	const z0 = p.z;
	p.z += d > 30 ? 0 : 40;
	for ( let i = 0; i < 4; i ++ ) { frame( w ); await tick(); }
	p.z = z0;
	const r = w.melee.raiders.find( ( x ) => x.id === slot.id );
	if ( r ) { r.x = slot.x; r.z = slot.z; r.homeX = r.x; r.homeZ = r.z; r.yaw = yawToward( r.x, r.z, p.x, p.z ); }
	return r;

}

// ---------------------------------------------------------------- 1. data
{

	ok( MELEE.paddle.damage === PLAYER.attackDamage && MELEE.paddle.contact === PLAYER.attackContact && MELEE.paddle.range === PLAYER.attackRange, 'the paddle row is PLAYER\'s numbers (the harness tuning)' );
	ok( MELEE.cutlass.contact < MELEE.paddle.contact && MELEE.cutlass.total < MELEE.paddle.total && MELEE.cutlass.parry > 0 && MELEE.cutlass.chip < 1, 'cutlass: faster, a wider parry, a cheaper block' );
	ok( MELEE.axe.guardBreak && MELEE.axe.contact > MELEE.paddle.contact && MELEE.axe.energy > KINDS.shedDoor.toughness && MELEE.paddle.energy < KINDS.shedDoor.toughness, `axe: slow, breaks guards and a shed door in one blow (${ MELEE.axe.energy } J vs ${ KINDS.shedDoor.toughness })` );
	ok( MELEE.pin.price < 50 && MELEE.pin.stun > 0 && MELEE.harpoon.range > 3.2 && MELEE.harpoon.throw, 'pin: cheap, it stuns; harpoon: long reach, thrown on a line' );
	ok( WEAPONS.blunderbuss.pellets === 9 && WEAPONS.blunderbuss.knock > 0 && WEAPONS.rifle.zoom >= 3 && WEAPONS.rifle.range >= 140 && barrelsOf( WEAPONS.duelling ) === 2 && WEAPONS.harpoongun.harpoon && cartridgesFor( WEAPONS.harpoongun ) === 0, 'firearms: blunderbuss 9 pellets, rifle x3.2 zoom to 140 m, duelling pair, harpoon gun on a line' );
	ok( ORDER.every( ( id ) => SLOT_OF[ id ] ) && WEAPONS.duelling_l && WEAPONS.duelling_l.hidden && ! ORDER.includes( 'duelling_l' ), 'every gun has a quick slot; the pair\'s second pistol is a hidden gate name' );
	ok( SLOTS.map( ( s ) => s.key ).join() === 'Digit1,Digit2,Digit3,Digit4', 'quick slots on 1-4 (5 stays the emote row)' );
	const ids = [ 'blackwater-guard-1', 'blackwater-guard-2', 'den3-guard-0', 'bd-crew-2', 'bd-crew-0', 'bd-crew-1', 't2-0', 'r1' ];
	const lo = ids.map( ( id ) => raiderLoadout( id, 2 ) );
	ok( lo.join() === 'blunderbuss,,cutlass,blunderbuss,cutlass,,,' && raiderLoadout( 'x', 4, 'captain' ) === 'cutlass' && raiderLoadout( 't1-0', 1, 'raider', 'cutlass' ) === 'cutlass', `raider loadouts by id: ${ lo.join() } (arena ids unarmed)` );
	ok( lo.join() === ids.map( ( id ) => raiderLoadout( id, 2 ) ).join(), 'loadouts are deterministic' );
	ok( blastFactor( 0, 4.5 ) === 1 && blastFactor( 4.5, 4.5 ) === 0 && blastFactor( 2, 4.5 ) > blastFactor( 3, 4.5 ), 'blast falloff: 1 at the centre, 0 at the edge, falling' );
	const v = throwVelocity( { x: 0, y: 0, z: - 1 }, 14 );
	const pts = arcPoints( { x: 0, y: 2.5, z: 0 }, v, { groundAt: () => 1, seaLevel: 0, step: 0.05 } );
	const end = pts[ pts.length - 1 ];
	ok( v.y > 0 && end.hit === 'ground' && Math.abs( end.y - 1 ) < 1e-6 && - end.z > 12 && - end.z < 24, `a level throw arcs up and lands ${ ( - end.z ).toFixed( 1 ) } m ahead on the ground` );
	const wet = arcPoints( { x: 0, y: 2, z: 0 }, v, { groundAt: () => - 3, seaLevel: 0 } );
	ok( wet[ wet.length - 1 ].hit === 'water', 'over deep water it lands in the sea' );
	ok( Object.keys( WEAPON_RECIPES ).length === 8 && Object.values( ATTACK_OF ).every( ( c ) => WEAPON_RECIPES[ c ] ), 'eight weapon pose clips; every melee weapon but the paddle has an attack clip' );
	ok( IDS.every( ( id ) => modelTriangles( id ) > 20 && modelTriangles( id ) < 600 ), 'every procedural stand-in is under 600 triangles' );

}

// ---------------------------------------------------------------- 2. shop and fence
{

	const w = makeWorld( { money: 5000 } );
	const rows = w.wp.shopRows() + w.fa.shopRows();
	ok( /data-wpn="cutlass"/.test( rows ) && /data-wpn="pin"/.test( rows ) && /data-wpn="harpoon"/.test( rows ) && /data-wpn="smoke"/.test( rows ) && /data-wpn="chain"/.test( rows ), 'Ethena\'s rows: cutlass, pin, harpoon, smoke pots, chain shot' );
	ok( /data-gun="duelling"/.test( rows ) && /data-gun="rifle"/.test( rows ) && /data-gun="harpoongun"/.test( rows ) && ! /data-gun="blunderbuss"/.test( rows ) && ! /data-wpn="axe"/.test( rows ) && ! /data-wpn="bomb"/.test( rows ), 'the legal guns at the chandlery; the blunderbuss, axe and bombs are not' );
	const mk = [ ...w.wp.marketRows( { ok: true } ), ...w.fa.marketRows( { ok: true } ) ];
	ok( [ 'wpn:axe', 'wpn:bomb', 'wpn:firebottle', 'wpn:grape', 'gun:blunderbuss' ].every( ( id ) => mk.some( ( r ) => r.id === id && r.ok ) ), 'the fence: axe, bombs, fire bottles, grape shot, the blunderbuss' );
	ok( w.wp.marketAction( 'wpn:bomb', { ok: false, reason: 'unwelcome' } ).ok === false && w.wp.marketRows( { ok: false, reason: 'unwelcome' } ).every( ( r ) => ! r.ok && r.why === 'unwelcome' ), 'not welcome: no deals' );
	const m0 = w.state.money;
	ok( w.wp.marketAction( 'wpn:bomb' ).ok && w.wp.thrown.bomb === 3 && w.state.money === m0 - THROWN.bomb.price, 'three bombs for $45' );
	ok( w.wp.marketAction( 'wpn:cutlass' ).ok === false, 'the fence does not sell the chandlery\'s cutlass' );
	ok( w.fa.marketAction( 'gun:blunderbuss' ).ok && w.fa.owned.blunderbuss && w.fa.marketAction( 'gun:pistol' ).ok === false, 'the blunderbuss from the fence (the pistol is not his)' );
	ok( w.wp.buy( 'cutlass' ).ok && w.wp.owned.cutlass && w.wp.melee === 'cutlass' && w.wp.buy( 'cutlass' ).why === 'owned', 'buy the cutlass once' );
	for ( let i = 0; i < 4; i ++ ) w.wp.buy( 'bomb' );
	ok( w.wp.thrown.bomb === THROWN.bomb.max && w.wp.buy( 'bomb' ).why === 'full', `bombs capped at ${ THROWN.bomb.max }` );
	const poor = makeWorld( { money: 10 } );
	ok( poor.wp.buy( 'cutlass' ).why === 'money' && ! poor.wp.owned.cutlass, 'no money, no cutlass' );
	const j = JSON.parse( JSON.stringify( w.wp.toJSON() ) );
	const w2 = makeWorld();
	w2.wp.fromJSON( j );
	ok( w2.wp.owned.cutlass && w2.wp.melee === 'cutlass' && w2.wp.thrown.bomb === THROWN.bomb.max && ! w2.wp.owned.axe, 'save round trip: the cutlass, the bombs' );
	w2.wp.fromJSON( { owned: [ 'bazooka', 'axe' ], melee: 'bazooka', thrown: { bomb: 1e9 }, shot: { chain: - 4 }, shotSel: 'nuke' } );
	ok( w2.wp.owned.axe && w2.wp.melee === 'paddle' && w2.wp.thrown.bomb === THROWN.bomb.max && w2.wp.shot.chain === 0 && w2.wp.shotSel === 'round', 'a bad save is clamped' );
	w2.wp.reset();
	ok( ! w2.wp.owned.cutlass && w2.wp.owned.paddle && w2.wp.thrown.bomb === 0, 'reset: back to the paddle' );

}

// ---------------------------------------------------------------- 3. melee weapons through the real melee feature
{

	// the cutlass: 20 a cut, the contact at 0.2 s, the third cut of a chain x1.5
	const w = makeWorld();
	w.wp.buy( 'cutlass' );
	const r = await raiderAt( w, 2.0, { tier: 3 } );
	ok( !! r && r.weapon === null, 'an arena raider carries nothing' );
	r.maxHp = r.hp = 500;
	w.input.pressed.add( 'Digit1' );
	frame( w );
	ok( w.wp.hand === 'melee' && w.melee.weaponStats().id === 'cutlass', 'key 1 draws the cutlass; melee reads it' );
	const hits = [];
	for ( let i = 0; i < 3; i ++ ) {

		r.state = 'circle'; r.t = 0; // (hold him still in the ring)
		w.melee.combat.attackPress();
		let t = 0;
		while ( w.melee.combat.state === 'swing' && t < 2 ) { frame( w ); t += DT; if ( w.melee.combat.swingContact && hits.length === i ) hits.push( { t, dealt: w.melee.combat.lastSwing && w.melee.combat.lastSwing.dealt } ); }

	}

	ok( hits.length === 3 && hits[ 0 ].t < PLAYER.attackContact && hits[ 0 ].dealt === 20, `the cut lands at ${ hits[ 0 ] && hits[ 0 ].t.toFixed( 2 ) } s for 20` );
	ok( hits[ 2 ] && hits[ 2 ].dealt === 30, `the third cut of the chain bites x1.5 (${ hits.map( ( h ) => h.dealt ).join( ', ' ) })` );
	// the parry window: a guard raised 0.27 s before the blow parries with the cutlass, blocks with the paddle
	const c = w.melee.combat;
	c.guardStart = c.clock - 0.27;
	ok( c.guardTiming() === 'parry', 'cutlass: a guard 0.27 s early still parries' );
	w.wp.melee = 'paddle';
	ok( c.guardTiming() === 'block', 'paddle: the same guard is a plain block' );

}

{

	// a cutlass guard turns some plain blows aside; the axe goes through every time, and staggers an armoured wind-up
	const w = makeWorld( { seed: 3 } );
	const r = await raiderAt( w, 2.0, { tier: 2, weapon: 'cutlass' } );
	ok( r && r.weapon === 'cutlass' && r.cfg.damage === Math.round( 16 * RAIDER_ARMS.cutlass.damage ), `a cutlass man (${ r && r.cfg.damage } a blow)` );
	let blocked = 0, landed = 0;
	for ( let i = 0; i < 40; i ++ ) {

		r.hp = r.maxHp; r.state = 'circle'; r.yaw = yawToward( r.x, r.z, w.player.position.x, w.player.position.z );
		const res = r.takeHit( 20, { from: { x: w.player.position.x, z: w.player.position.z } } );
		if ( res.blocked ) blocked ++; else landed ++;

	}

	ok( blocked > 5 && landed > 15, `paddle blows on his guard: ${ blocked } turned aside, ${ landed } landed` );
	let broke = 0, through = 0;
	for ( let i = 0; i < 40; i ++ ) {

		r.hp = r.maxHp; r.state = 'circle';
		const res = r.takeHit( 42, { from: { x: w.player.position.x, z: w.player.position.z }, guardBreak: true } );
		if ( ! res.blocked ) through ++;
		if ( res.guardBroken ) broke ++;

	}

	ok( through === 40 && broke === 40, 'the axe goes through his guard every time (guardBroken)' );
	r.hp = r.maxHp; r.state = 'circle';
	ok( r.takeHit( 99 ).blocked !== true, 'a hit without a source (a ball, a test) is never blocked' );
	// an armoured (tier 3) wind-up: a plain blow does not stop it, the axe does
	const w3 = makeWorld();
	const a = await raiderAt( w3, 2, { tier: 3 } );
	a._enter( 'windup' );
	a.takeHit( 10, {} );
	ok( a.state === 'windup', 'tier 3: a plain blow does not stop his wind-up' );
	a.takeHit( 10, { guardBreak: true } );
	ok( a.state === 'stagger', 'the axe staggers it' );
	// the swing through PlayerCombat: 'BLOCKED' on the cutlass man with the paddle, none with the axe
	const w4 = makeWorld( { seed: 5 } );
	w4.wp.buy( 'axe' );
	const g = await raiderAt( w4, 2.0, { weapon: 'cutlass' } );
	g.maxHp = g.hp = 2000;
	let axeBlocked = 0, axeHits = 0;
	for ( let i = 0; i < 12; i ++ ) {

		g.state = 'circle'; g.t = 0; g.yaw = yawToward( g.x, g.z, w4.player.position.x, w4.player.position.z );
		w4.melee.combat.attackPress();
		let t = 0;
		while ( w4.melee.combat.state === 'swing' && t < 2 ) { frame( w4 ); t += DT; }
		const ls = w4.melee.combat.lastSwing;
		if ( ls && ls.blocked ) axeBlocked ++; else if ( ls ) axeHits ++;

	}

	ok( axeBlocked === 0 && axeHits === 12, `12 axe blows on a cutlass guard: all land (${ axeHits })` );
	const doors = w4.log.events.filter( ( e ) => e[ 0 ] === 'meleeHit' );
	ok( doors.length && doors.every( ( e ) => e[ 1 ].energy === MELEE.axe.energy && e[ 1 ].weapon === 'axe' ), 'the axe\'s contact carries its energy to the props (meleeHit)' );

}

{

	// the harpoon's reach: a raider at 3.3 m is hit with it, missed with the paddle; the pin rattles him longer
	const w = makeWorld();
	w.wp.buy( 'harpoon' );
	const r = await raiderAt( w, 3.3 );
	r.maxHp = r.hp = 500; r.state = 'circle';
	r.update = () => {}; // (he stands still for the reach test)
	w.wp.melee = 'paddle';
	w.melee.combat.attackPress();
	runFor( w, 1 );
	ok( ! w.melee.combat.lastSwing, 'the paddle whiffs at 3.3 m' );
	w.wp.melee = 'harpoon';
	r.state = 'circle'; r.x = w.player.position.x; r.z = w.player.position.z - 3.3;
	w.melee.combat.attackPress();
	runFor( w, 1 );
	ok( w.melee.combat.lastSwing && w.melee.combat.lastSwing.dealt === MELEE.harpoon.damage, 'the harpoon\'s thrust reaches him' );
	r.state = 'circle';
	r.takeHit( 5, { stun: 0.25 } );
	ok( r.state === 'stagger' && Math.abs( r.staggerFor - ( r.cfg.stagger + 0.25 ) ) < 1e-6, 'the pin\'s stun lengthens the stagger' );

}

// ---------------------------------------------------------------- 4. the new guns
{

	// the blunderbuss: nine pellets, the man shoved back; nothing reaches 30 m
	const w = makeWorld();
	w.fa.buy( 'blunderbuss' ); w.fa.buy( 'pouch' );
	const r = await raiderAt( w, 4 );
	r.maxHp = r.hp = 900;
	r.update = () => {};
	look( w, { x: 0, y: - 0.1, z: - 1 } );
	w.fa.draw( 'blunderbuss' );
	w.input.rightDown = true;
	runFor( w, 1 );
	const d0 = Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z );
	const res = w.fa.fire();
	const d1 = Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z );
	const onHim = res.pellets.filter( ( k ) => k === 'raider' ).length;
	ok( res.pellets.length === 9 && onHim >= 3 && res.damage > 40, `a blast at 4 m (aimed): ${ onHim } of 9 pellets on him, ${ res.damage } damage` );
	ok( d1 > d0 + 0.8, `and shoved him back ${ ( d1 - d0 ).toFixed( 1 ) } m` );
	ok( ! w.fa.loaded.blunderbuss && w.fa.reload() && ( runFor( w, WEAPONS.blunderbuss.reload + 0.1 ), w.fa.loaded.blunderbuss ), 'reload: one cartridge' );
	r.x = w.player.position.x; r.z = w.player.position.z - 30; r.state = 'idle'; r.hp = r.maxHp;
	w.input.rightDown = false;
	runFor( w, 0.5 );
	const far = w.fa.fire();
	ok( ! far.pellets.includes( 'raider' ), 'nothing reaches 30 m' );

}

{

	// the long rifle: x3.2 zoom while aiming, a man hit at 120 m
	const w = makeWorld();
	w.fa.buy( 'rifle' ); w.fa.buy( 'pouch' );
	const r = await raiderAt( w, 120 );
	r.maxHp = r.hp = 900;
	look( w, { x: 0, y: ( r.y + 1.2 - ( GROUND + 1.6 ) ) / 120, z: - 1 } );
	w.fa.draw( 'rifle' );
	w.input.rightDown = true;
	runFor( w, 1.5 );
	ok( Math.abs( w.camera.fov - 60 / WEAPONS.rifle.zoom ) < 0.5 && w.fa.hud === null, `aiming the rifle: fov ${ w.camera.fov.toFixed( 1 ) } (x${ WEAPONS.rifle.zoom })` );
	const res = w.fa.fire();
	ok( res.hit === 'raider' && res.damage > 50, `a man at 120 m: ${ res.hit } for ${ res.damage }` );
	w.input.rightDown = false;
	runFor( w, 1 );
	ok( Math.abs( w.camera.fov - 60 ) < 0.5, 'released: the fov is back' );

}

{

	// the duelling pair: two quick shots, the second under its own wire name, then both to load (two cartridges)
	const w = makeWorld();
	w.fa.buy( 'duelling' ); w.fa.buy( 'pouch' );
	look( w, { x: 0, y: - 0.3, z: - 1 } );
	w.fa.draw( 'duelling' );
	runFor( w, 1 );
	const a = w.fa.fire();
	ok( ! a.refused && w.fa.loaded.duelling && w.fa.balls.duelling === 1, 'the first pistol fired; the second is still loaded' );
	ok( !! w.fa.fire().refused, 'not in the same instant' );
	runFor( w, 0.3 );
	const b = w.fa.fire();
	ok( ! b.refused && ! w.fa.loaded.duelling, 'the second shot a beat later; now both are empty' );
	const shots = w.log.sent.filter( ( s ) => s[ 0 ] === 'gunshot' ).map( ( s ) => s[ 1 ].weapon );
	ok( shots.join() === 'duelling,duelling_l', `the wire names: ${ shots.join() } (the universe gate counts each pistol)` );
	const before = w.fa.shots;
	w.fa.reload();
	runFor( w, WEAPONS.duelling.reload + 0.1 );
	ok( w.fa.balls.duelling === 2 && w.fa.shots === before - 2, 'reloading the pair takes two cartridges' );

}

{

	// the harpoon gun: a man dragged in, a small hull hauled closer, a big fish landed, R reels it home with no cartridge
	const w = makeWorld();
	w.fa.buy( 'harpoongun' );
	const r = await raiderAt( w, 12 );
	r.maxHp = r.hp = 900;
	look( w, { x: 0, y: ( r.y + 1.2 - ( GROUND + 1.6 ) ) / 12, z: - 1 } );
	w.fa.draw( 'harpoongun' );
	runFor( w, 1 );
	const res = w.fa.fire();
	const d0 = Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z );
	ok( res.hit === 'raider' && w.fa.line && w.fa.line.kind === 'raider', 'the harpoon is in him, on the line' );
	runFor( w, 1 );
	const d1 = Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z );
	ok( d1 < d0 - 1.5, `the line dragged him ${ ( d0 - d1 ).toFixed( 1 ) } m closer` );
	ok( !! w.fa.fire().refused && w.fa.shots === 0 && w.fa.reload(), 'out on its line: no shot; R reels it in with no cartridge' );
	runFor( w, WEAPONS.harpoongun.reload + 0.1 );
	ok( w.fa.loaded.harpoongun && ! w.fa.line, 'home and loaded' );

	// a small hull (the harbour launch, 9 m) is hauled; a sloop (14.4 m) is as well, the brigantine only holds
	const ships = [];
	const naval = { ships, active: true };
	const ws = makeWorld( { naval, app: { terrainData: { heightAt: () => - 5 } } } ); // (on a dock over open water)
	ws.fa.buy( 'harpoongun' );
	const launch = new Ship( 'launch', { x: ws.player.position.x, z: ws.player.position.z - 24, yaw: Math.PI / 2 } );
	launch.pose.y = 0;
	ships.push( launch );
	look( ws, { x: 0, y: ( 1.4 - ( GROUND + 1.6 ) ) / 24, z: - 1 } );
	ws.fa.draw( 'harpoongun' );
	runFor( ws, 1 );
	const sr = ws.fa.fire();
	const z0 = launch.z;
	runFor( ws, 2 );
	ok( sr.hit === 'ship' && ws.fa.line && launch.z > z0 + 3, `the launch is hauled ${ ( launch.z - z0 ).toFixed( 1 ) } m closer` );

	// a big fish under the water where the harpoon strikes (app.reef.fish: FishSchools' arrays)
	const fishPos = new Float32Array( [ 0, 0, 0 ] );
	const reef = { fish: { pos: fishPos, size: new Float32Array( [ 1.4 ] ), groups: [ { sp: { model: 'tarpon' }, active: true, offset: 0, count: 1, home: { x: 0, z: 0 } } ] } };
	const wf = makeWorld( { app: { reef, terrainData: { heightAt: () => - 6 } } } );
	wf.player.position.y = 1;
	const P = wf.player.position;
	fishPos.set( [ P.x, - 0.2, P.z - 14 ] );
	reef.fish.groups[ 0 ].home = { x: P.x + 50, z: P.z };
	wf.fa.buy( 'harpoongun' );
	look( wf, { x: 0, y: ( 0 - ( 1 + 1.6 ) ) / 14, z: - 1 } );
	wf.fa.draw( 'harpoongun' );
	runFor( wf, 1 );
	const fr = wf.fa.fire();
	ok( fr.hit === 'water' && wf.fa.line && wf.fa.line.kind === 'fish', 'the harpoon strikes a tarpon under the surface' );
	runFor( wf, 6 );
	const landed = wf.log.events.find( ( e ) => e[ 0 ] === 'fishHarpooned' );
	ok( !! landed && landed[ 1 ].species === 'tarpon' && landed[ 1 ].kg > 20, `hauled in and landed: ${ landed ? landed[ 1 ].kg + ' kg ' + landed[ 1 ].species : 'nothing' }` );

}

// ---------------------------------------------------------------- 5. throwables
{

	// a powder bomb: the arc shows, it lands, the fuse burns, the blast breaks a crate (destruction) and hurts a raider
	const p0 = { x: FAR.x - 60, z: FAR.z };
	const plan = [ { id: 'test-crate', kind: 'crate', site: 'test', x: p0.x + 1.8, y: GROUND, z: p0.z - 15, yaw: 0 } ]; // (beside where it lands)
	const w = makeWorld( { destruction: plan } );
	w.features.get( 'destruction' ).build();
	w.wp.buy( 'bomb' );
	const r = await raiderAt( w, 14 );
	r.maxHp = r.hp = 900;
	look( w, { x: 0, y: - 0.05, z: - 1 } );
	w.input.pressed.add( 'Digit4' );
	frame( w );
	ok( w.wp.hand === 'thrown' && w.wp.thrownSel === 'bomb' && w.wp.ownsMouse() && w.melee.canSwing() === false, 'key 4: a bomb in hand; the left button is the throw (no swing)' );
	frame( w );
	ok( w.wp.arc.shown && w.wp.arc.points > 10, `the arc preview (${ w.wp.arc.points } points)` );
	const aim = w.wp.aimThrow();
	const pts = arcPoints( aim.from, aim.vel, { groundAt: () => GROUND, seaLevel: 0, step: 0.05 } );
	const land = pts[ pts.length - 1 ];
	r.update = () => {}; // (he stands 1.5 m beside where it will come down)
	r.x = land.x - 1.5; r.z = land.z; r.state = 'idle';
	w.input.mouseDown = true;
	frame( w );
	w.input.mouseDown = false;
	runFor( w, 0.3 );
	ok( w.wp.flying.length === 1 && w.wp.thrown.bomb === 2, 'released: it flies, two left' );
	runFor( w, 1 );
	const pr = w.wp.flying[ 0 ];
	runFor( w, 0.4 );
	ok( pr && Math.abs( pr.z - land.z ) < 2.5, `it came down ${ pr ? ( p0.z - pr.z ).toFixed( 1 ) : '?' } m ahead (the preview said ${ ( p0.z - land.z ).toFixed( 1 ) })` );
	runFor( w, 1.6 );
	const ex = w.log.events.find( ( e ) => e[ 0 ] === 'explosion' );
	ok( !! ex && ex[ 1 ].by === 'player' && ex[ 1 ].radius === THROWN.bomb.radius && w.wp.flying.length === 0, 'the fuse burnt down: the blast' );
	ok( w.log.events.some( ( e ) => e[ 0 ] === 'propDestroyed' && e[ 1 ].id === 'test-crate' ), 'the blast broke the crate (destruction)' );
	ok( 900 - r.hp > 25, `the raider beside it took ${ 900 - r.hp } and was thrown (${ r.state })` );
	ok( w.log.sent.some( ( s ) => s[ 0 ] === 'thrown' && s[ 1 ].ev === 'blast' ), 'the other players see it (world event thrown)' );
	ok( w.melee.combat.hp === w.melee.combat.maxHp, 'the thrower stood clear: unhurt' );
	// at his own feet: he is hurt too
	const w2 = makeWorld();
	w2.wp.buy( 'bomb' );
	w2.wp.hand = 'thrown'; w2.wp.thrownSel = 'bomb';
	look( w2, { x: 0, y: - 1, z: - 0.01 } );
	w2.wp.throwNow();
	runFor( w2, 3 );
	ok( w2.melee.combat.hp < w2.melee.combat.maxHp, `a bomb at your own feet hurts (${ w2.melee.combat.maxHp - w2.melee.combat.hp })` );
	// into the sea: the fuse drowns
	const w3 = makeWorld( { app: { terrainData: { heightAt: () => - 5 } } } );
	w3.player.position.y = 0.5;
	w3.wp.buy( 'bomb' );
	w3.wp.hand = 'thrown'; w3.wp.thrownSel = 'bomb';
	look( w3, { x: 0, y: 0, z: - 1 } );
	w3.wp.throwNow();
	runFor( w3, 3 );
	ok( ! w3.log.events.some( ( e ) => e[ 0 ] === 'explosion' ), 'in the sea the fuse drowns' );

}

{

	// a fire bottle on a deck sets her alight; on the ground a fire pool burns the raider standing in it
	const ships = [];
	const w = makeWorld( { naval: { ships, active: true } } );
	w.wp.buy( 'firebottle' );
	const s = new Ship( 'sloop', { x: w.player.position.x, z: w.player.position.z - 12, yaw: Math.PI / 2 } );
	s.pose.y = 0;
	ships.push( s );
	w.wp.hand = 'thrown'; w.wp.thrownSel = 'firebottle';
	look( w, { x: 0, y: 0.1, z: - 1 } );
	w.wp.throwNow();
	runFor( w, 2 );
	ok( s.fire && s.fire.burning !== undefined ? s.fire.burning : s.fire && s.fire.level > 0, 'a fire bottle on the sloop\'s deck: she is alight' );
	const w2 = makeWorld();
	w2.wp.buy( 'firebottle' );
	const r = await raiderAt( w2, 9 );
	r.maxHp = r.hp = 900;
	w2.wp.hand = 'thrown'; w2.wp.thrownSel = 'firebottle';
	look( w2, { x: 0, y: - 0.2, z: - 1 } );
	w2.wp.throwNow();
	runFor( w2, 1.5 );
	const pool = w2.wp.fires[ 0 ];
	ok( !! pool && w2.log.vfx.some( ( v ) => v[ 0 ] === 'fire' ), 'it shattered into a fire pool' );
	if ( pool ) { r.x = pool.x; r.z = pool.z; r.state = 'circle'; }
	const hp0 = r.hp;
	runFor( w2, 2 );
	ok( r.hp < hp0, `standing in it burns (${ hp0 - r.hp } in 2 s)` );
	runFor( w2, 8 );
	ok( w2.wp.fires.length === 0 && w2.log.vfx.some( ( v ) => v[ 0 ] === 'stopFire' ), 'it burns out' );

}

{

	// a smoke pot: the raiders lose the player inside the cloud
	const w = makeWorld();
	w.wp.buy( 'smoke' );
	const r = await raiderAt( w, 7 );
	runFor( w, 1 );
	ok( r.aggro && w.melee.target().valid, 'he has seen the player' );
	w.wp.hand = 'thrown'; w.wp.thrownSel = 'smoke';
	look( w, { x: 0, y: - 1, z: - 0.2 } );
	w.wp.throwNow();
	runFor( w, 1.5 );
	ok( w.wp.clouds.length === 1 && w.wp.hidden( w.player.position.x, w.player.position.z ), 'the pot is smoking at his feet; the player is hidden' );
	ok( ! w.melee.target().valid, 'melee: the raiders cannot see him' );
	runFor( w, 3 );
	ok( r.state === 'return' || r.state === 'idle' || r.state === 'patrol', `the raider gives up (${ r.state })` );
	runFor( w, THROWN.smoke.time );
	ok( w.wp.clouds.length === 0 && ! w.wp.hidden( w.player.position.x, w.player.position.z ), 'the cloud thins away' );

}

{

	// the harpoon thrown on its line: it strikes, the paddle meanwhile, then it is back
	const w = makeWorld();
	w.wp.buy( 'harpoon' );
	const r = await raiderAt( w, 8 );
	r.maxHp = r.hp = 900; r.state = 'circle';
	ok( w.wp.throwables().includes( 'harpoon' ), 'the harpoon is in the throwables while it is home' );
	w.wp.hand = 'thrown'; w.wp.thrownSel = 'harpoon';
	look( w, { x: 0, y: ( r.y + 1 - ( GROUND + 1.6 ) ) / 8, z: - 1 } );
	w.wp.throwNow();
	runFor( w, 0.7 );
	ok( r.hp === 900 - MELEE.harpoon.throw.damage, `the thrown harpoon struck him for ${ 900 - r.hp }` );
	ok( w.wp.harpoonOut && w.wp.meleeNow() === 'paddle' && ! w.wp.throwables().includes( 'harpoon' ), 'out on its line: the paddle in hand' );
	runFor( w, MELEE.harpoon.throw.pull + 0.5 );
	ok( ! w.wp.harpoonOut && w.wp.meleeNow() === 'harpoon', 'pulled home' );

}

// ---------------------------------------------------------------- 6. the swivel from the deck, chain and grape shot
{

	const fired = [];
	const ships = [];
	const naval = { active: true, ships, playerGun: { owned: true }, playerHull: { sunk: false }, fire( side ) { fired.push( side ); return true; } };
	const w = makeWorld( { naval, app: { boatCtl: { position: new Vector3( FAR.x - 60, 0, FAR.z ), quaternion: new Quaternion() } } } );
	w.player.mode = 'deck';
	w.input.pressed.add( 'Digit4' );
	frame( w );
	ok( w.wp.hand === 'swivel', 'on your own deck key 4 mans the swivel gun' );
	look( w, { x: 1, y: 0, z: 0 } ); // the boat frame's +X is port
	w.input.mouseDown = true; frame( w ); w.input.mouseDown = false; frame( w );
	look( w, { x: - 1, y: 0, z: 0 } );
	w.input.mouseDown = true; frame( w ); w.input.mouseDown = false; frame( w );
	ok( fired.join() === 'port,starboard', `LMB fires the side you look at through naval.fire (${ fired.join() })` );
	// at the helm 1-3 pick the shot; each player ball takes one; the hit tears sails (chain) or sweeps the crew (grape)
	w.player.mode = 'boat';
	ok( w.wp.chooseShot( 'chain' ) === false, 'no chain shot aboard: refused' );
	w.wp.buy( 'chain' );
	w.state.money += 1000;
	w.wp.marketAction( 'wpn:grape' );
	w.input.pressed.add( 'Digit2' ); frame( w );
	ok( w.wp.shotSel === 'chain', 'key 2 at the helm: chain shot' );
	const s = new Ship( 'sloop', { id: 'pir1', x: FAR.x, z: FAR.z - 60 } );
	ships.push( s );
	const sails0 = s.sections.get ? s.sections.get( 'sails' ) : null;
	const hp0 = s.hp;
	w.features.emit( 'cannonFired', { by: 'player', x: 0, y: 0, z: 0 } );
	w.features.emit( 'cannonballImpact', { owner: 'player', hit: 'ship', target: 'pir1', x: s.x, y: 2, z: s.z } );
	ok( w.wp.shot.chain === 5 && w.wp.stats.chainHits === 1 && s.rigging < 1 && s.hp < hp0, `chain shot struck: rigging ${ s.rigging.toFixed( 2 ) }, hull ${ s.hp.toFixed( 1 ) } / ${ hp0 }` );
	w.input.pressed.add( 'Digit3' ); frame( w );
	s.crew = 6;
	w.features.emit( 'cannonFired', { by: 'player' } );
	w.features.emit( 'cannonballImpact', { owner: 'player', hit: 'ship', target: 'pir1' } );
	ok( w.wp.shotSel === 'grape' && s.crew === 6 - SHOT.grape.crew && w.log.events.some( ( e ) => e[ 0 ] === 'crewShot' ), `grape shot swept ${ SHOT.grape.crew } off her deck` );
	w.features.emit( 'cannonFired', { by: 'pirate' } );
	ok( w.wp.shotQueue.length === 0 && w.wp.shot.grape === 5, 'a pirate\'s gun is none of ours' );
	w.input.pressed.add( 'Digit1' ); frame( w );
	w.features.emit( 'cannonFired', { by: 'player' } );
	w.features.emit( 'cannonballImpact', { owner: 'player', hit: 'ship', target: 'pir1' } );
	ok( w.wp.shotSel === 'round' && w.wp.stats.chainHits === 1 && w.wp.stats.grapeHits === 1, 'key 1: round shot again (no extra effect)' );
	void sails0;

}

// ---------------------------------------------------------------- 7. the gunman
{

	const w = makeWorld( { seed: 21 } );
	const r = await raiderAt( w, 7, { weapon: 'blunderbuss' } );
	ok( r && r.weapon === 'blunderbuss', 'a raider with a blunderbuss' );
	let shot = null, minD = 99;
	for ( let i = 0; i < 60 * 12 && ! shot; i ++ ) {

		frame( w );
		minD = Math.min( minD, Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z ) );
		shot = w.log.events.find( ( e ) => e[ 0 ] === 'gunFired' && e[ 1 ].weapon === 'blunderbuss' );

	}

	ok( r.role === 'thrower' && !! shot, `he hangs back and fires (${ shot ? 'fired' : 'never fired' }, closest ${ minD.toFixed( 1 ) } m)` );
	ok( minD > 3, 'and keeps his distance' );
	ok( w.melee.combat.hp < w.melee.combat.maxHp || r.outcome === 'missed', `the blast: ${ r.outcome }, player ${ w.melee.combat.hp } hp` );

}

// ---------------------------------------------------------------- 8. keys and the emote row
{

	const emotes = { rowOpen: true };
	const w = makeWorld( { emotes } );
	w.wp.buy( 'cutlass' );
	w.input.pressed.add( 'Digit1' );
	frame( w );
	ok( w.wp.hand === null, 'with the emote row open 1 is the emote\'s' );
	emotes.rowOpen = false;
	w.input.pressed.add( 'Digit1' );
	frame( w );
	ok( w.wp.hand === null, 'nor on the frame the row closed (a pick)' );
	w.input.pressed.add( 'Digit1' );
	frame( w );
	ok( w.wp.hand === 'melee', 'then 1 draws the cutlass' );
	w.fa.buy( 'pistol' );
	w.input.pressed.add( 'Digit2' );
	frame( w );
	ok( w.fa.drawn && w.fa.sel === 'pistol' && w.wp.hand === null, 'key 2: the pistol (the cutlass goes away)' );
	w.input.pressed.add( 'Digit1' );
	frame( w );
	ok( ! w.fa.drawn && w.wp.hand === 'melee', 'key 1 again: the gun holstered, the cutlass out' );
	ok( w.wp.cycle() !== null, 'the touch Weapon button cycles' );
	const f = new Features( {} );
	weapons.install( {}, f, { mesh: false, audio: {} } );
	ok( ! f.claimKey( 'Digit0', 'other' ), 'Digit0 (the cycle) is claimed on the registry' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall weapons tests passed' );
process.exit( fails ? 1 : 0 );
