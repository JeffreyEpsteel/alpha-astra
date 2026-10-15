// Plain-node test of the firearms feature (src/features/firearms): damage falloff, the spread cone, reload timing, the cartridge
// bookkeeping and the shop, the peace-zone refusal (the training post is the exception), the hitscan against raiders (head x1.6,
// a wind-up interrupted), pirate decks (crew, else hull), props, water, the feel hooks, the zoom, the musket's pace, the mesh
// budget and the save round trip. No GPU, no DOM: stub player / camera / input, the real Features, GameState, Melee (its
// training post) and naval Ship.
//   node test/feature-firearms.mjs
import { Vector3, Quaternion } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { Ship } from '../src/features/naval/Ship.js';
import * as meleeModule from '../src/features/melee/index.js';
import { TRAINING_POST } from '../src/features/melee/MeleeData.js';
import { peaceZone, inPeace } from '../src/features/melee/Peace.js';
import * as firearms from '../src/features/firearms/index.js';
import {
	Firearms, WEAPONS, POUCH, HEADSHOT, damageAt, spreadRad, spreadDir, angleBetween, forwardOf, maxRange,
	resolveShot, hitHumanoid, weaponTriangles, deckBox,
} from '../src/features/firearms/index.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, eps = 1e-3 ) => Math.abs( a - b ) <= eps;
const DT = 1 / 60;

// ---------------------------------------------------------------- stubs

const store = () => {

	const m = new Map();
	return { getItem: ( k ) => ( m.has( k ) ? m.get( k ) : null ), setItem: ( k, v ) => m.set( k, v ) };

};

class Input {

	constructor() { this.mouseDown = false; this.rightDown = false; this.enabled = true; this._hits = new Set(); this.releases = 0; }
	hit( code ) { return this._hits.has( code ); }
	down() { return false; }
	press( code ) { this._hits.add( code ); }
	clear() { this._hits.clear(); }

}

// a raider as melee's Raider quacks: takeHit( dmg ) -> { dealt, killed, punish, staggered }, parried(), headPosition( out )
class StubRaider {

	constructor( x, z, o = {} ) {

		this.id = o.id || 'r1'; this.spawnId = this.id + '#1'; this.kind = o.kind || 'raider'; this.name = 'Test';
		this.x = x; this.y = 0; this.z = z; this.scale = 1; this.hp = o.hp ?? 100; this.state = o.state || 'idle';
		this.active = true; this.parriedCalls = 0; this.hits = [];

	}

	get targetable() { return this.active && this.state !== 'down'; }
	headPosition( out ) { return out.set( this.x, this.y + 1.7, this.z ); }
	takeHit( d ) {

		this.hits.push( d );
		this.hp = Math.max( 0, this.hp - d );
		if ( this.hp <= 0 ) { this.state = 'down'; return { dealt: d, killed: true, punish: false, staggered: false }; }
		if ( this.state === 'windup' ) this.state = 'stagger';
		return { dealt: d, killed: false, punish: false, staggered: true };

	}
	parried() { this.parriedCalls ++; this.state = 'stagger'; return true; }

}

function lookQuat( dir ) {

	const d = new Vector3( dir.x, dir.y, dir.z ).normalize();
	return new Quaternion().setFromUnitVectors( new Vector3( 0, 0, - 1 ), d );

}

// a world: the player at ( px, pz ) on flat ground at y = 0 (sea far below unless asked), a first-person camera at his eye
function makeWorld( { px = 0, pz = 0, ground = 0, mode = 'campaign', melee = null, extra = {} } = {} ) {

	const toasts = [], kicks = [], montages = [], vfxCalls = [];
	const state = new GameState( store() );
	state.mode = mode;
	state.money = 1000;
	const player = { position: new Vector3( px, ground, pz ), yaw: 0, mode: 'walk', grounded: true, velocity: new Vector3() };
	const camera = { position: new Vector3( px, ground + 1.6, pz ), quaternion: lookQuat( { x: 0, y: 0, z: - 1 } ), fov: 60, proj: 0, updateProjectionMatrix() { this.proj ++; } };
	const app = {
		player, camera, input: new Input(), mode,
		terrainData: { heightAt: () => ground },
		game: { state, rod: { equipped: false, equip( v ) { this.equipped = v; } }, toast: ( t ) => toasts.push( t ), fight: null, cancelLine() {} },
		cameraFeel: { fovKick: 0, kick: ( type, o ) => kicks.push( [ type, o ] ), baseFov: () => 60 },
		avatar: { playMontage: ( name, o ) => { montages.push( name ); return name === 'shoot' || name === 'reload' ? { playing: false } : { name, playing: true }; }, stopMontage() {} },
		...extra,
	};
	const features = new Features( app );
	app.game.features = features;
	const vfx = {};
	for ( const k of [ 'flash', 'smoke', 'splash', 'dust', 'splinters', 'debris' ] ) vfx[ k ] = ( ...a ) => vfxCalls.push( [ k, ...a ] );
	features.add( 'vfx', { install: () => vfx } );
	if ( melee ) features.add( 'melee', { install: () => melee } );
	const audio = { reports: [], clicks: [], report( k ) { this.reports.push( k ); return true; }, click( k ) { this.clicks.push( k ); return true; } };
	const fa = features.add( 'firearms', { install: ( a, f ) => firearms.install( a, f, { audio, mesh: false, seed: 7 } ) } );
	return { app, features, fa, state, player, camera, toasts, kicks, montages, vfxCalls, audio };

}

const step = ( w, seconds ) => { for ( let t = 0; t < seconds - 1e-9; t += DT ) { w.features.update( DT ); w.app.input.clear(); } };
const aim = ( w, dir ) => { w.camera.quaternion = lookQuat( dir ); };
// a point well outside the peaceful home waters
const pz = peaceZone();
const FAR = { x: pz ? pz.x + pz.r + 400 : 2000, z: pz ? pz.z : 0 };
ok( ! inPeace( FAR.x, FAR.z ), 'the test arena is outside the peace zone' );

// ---------------------------------------------------------------- damage falloff
{

	const P = WEAPONS.pistol, M = WEAPONS.musket;
	// (wave 12E retuned the damage against the play harness, test/feature-combat-play.mjs: pistol 52, musket 90, musket walk x0.7)
	ok( P.price === 180 && P.reload === 1.4 && P.range === 22 && P.damage === 52 && P.falloff === 15 && P.spread === 2.2 && P.aimSpread === 0.8 && P.walk === 1, 'pistol stats as designed' );
	ok( M.price === 420 && M.reload === 3.2 && M.range === 70 && M.damage === 90 && M.spread === 1.2 && M.aimSpread === 0.4 && M.walk === 0.7 && M.draw > P.draw, 'musket stats as designed (slower draw, walk x0.7)' );
	ok( POUCH.count === 12 && POUCH.price === 30, 'a pouch: 12 cartridges for $30' );
	ok( damageAt( P, 0 ) === P.damage && damageAt( P, 15 ) === P.damage, 'pistol: full damage to 15 m' );
	ok( near( damageAt( P, 22 ), P.damage / 2 ) && damageAt( P, 18 ) < P.damage && damageAt( P, 18 ) > P.damage / 2, 'pistol: falls off past 15 m to half at 22 m' );
	ok( damageAt( P, maxRange( P ) ) === 0 && damageAt( P, 40 ) === 0, 'pistol: nothing left past its max range' );
	let mono = true;
	for ( let d = 0; d < 120; d += 0.5 ) if ( damageAt( M, d + 0.5 ) > damageAt( M, d ) + 1e-9 ) mono = false;
	ok( mono && damageAt( M, 45 ) === M.damage && near( damageAt( M, 70 ), M.damage / 2 ), 'musket: never rises with distance, full to 45 m, half at 70 m' );

}

// ---------------------------------------------------------------- spread cone
{

	let seed = 12345;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	for ( const [ w, aiming ] of [ [ WEAPONS.pistol, false ], [ WEAPONS.pistol, true ], [ WEAPONS.musket, false ], [ WEAPONS.musket, true ] ] ) {

		const half = spreadRad( w, aiming );
		const d = new Vector3( 0.3, - 0.2, - 1 ).normalize();
		let max = 0, sum = 0, unit = true;
		const N = 4000;
		for ( let i = 0; i < N; i ++ ) {

			const s = spreadDir( d, half, rnd(), rnd() );
			if ( ! near( Math.hypot( s.x, s.y, s.z ), 1, 1e-9 ) ) unit = false;
			const a = angleBetween( d, s );
			max = Math.max( max, a );
			sum += a;

		}

		ok( unit && max <= half + 1e-9 && max > half * 0.97 && near( sum / N, half * 2 / 3, half * 0.05 ), `${ w.id } ${ aiming ? 'aimed' : 'hip' }: inside a ${ ( half / Math.PI * 180 ).toFixed( 1 ) } deg cone, uniform over the disc` );

	}

	ok( spreadRad( WEAPONS.pistol, true ) < spreadRad( WEAPONS.pistol, false ), 'aiming narrows the cone' );
	const f = forwardOf( lookQuat( { x: 1, y: 0, z: 0 } ) );
	ok( near( f.x, 1 ) && near( f.y, 0 ) && near( f.z, 0 ), 'forwardOf reads the camera quaternion' );

}

// ---------------------------------------------------------------- the shop and the cartridges
{

	const w = makeWorld( { px: FAR.x, pz: FAR.z } );
	const { fa, state } = w;
	ok( ! fa.drawn && fa.shots === 0 && ! fa.anyOwned(), 'starts with nothing' );
	ok( /data-gun="pistol"/.test( fa.shopRows() ) && /data-gun="pouch"/.test( fa.shopRows() ), 'shop rows: the guns and the pouch' );
	state.money = 100;
	ok( ! fa.buy( 'pistol' ).ok && state.money === 100, 'cannot afford the pistol with $100' );
	state.money = 1000;
	ok( fa.buy( 'pistol' ).ok && state.money === 820 && fa.has( 'pistol' ) && fa.loaded.pistol, 'buys the pistol for $180, sold loaded' );
	ok( fa.buy( 'pistol' ).why === 'owned', 'not twice' );
	ok( fa.buy( 'pouch' ).ok && fa.shots === 12 && state.money === 790, 'a pouch: +12 cartridges for $30' );
	fa.shots = POUCH.max;
	ok( fa.buy( 'pouch' ).why === 'full' && state.money === 790, 'a full pouch is refused, nothing spent' );
	fa.shots = 12;
	ok( /Owned/.test( fa.shopRows() ), 'the row says Owned' );

	// draw, fire, reload: timing and bookkeeping
	w.app.input.press( 'KeyG' );
	step( w, DT );
	ok( fa.drawn && fa.weapon === 'pistol' && fa.phase === 'drawing' && fa.wantsMouse(), 'G draws the pistol (claims the mouse)' );
	ok( fa.fire().refused === 'drawing', 'no shot while still drawing' );
	step( w, WEAPONS.pistol.draw + 0.05 );
	ok( fa.phase === 'ready', 'ready after the draw time' );
	const r = fa.fire();
	ok( ! r.refused && fa.loaded.pistol === false && fa.stats.fired === 1, 'fires; the barrel is empty' );
	ok( w.audio.reports[ 0 ] === 'pistol', 'the pistol report plays' );
	ok( w.kicks.some( ( k ) => k[ 0 ] === 'recoil' ), 'camera recoil kick' );
	ok( w.vfxCalls.some( ( c ) => c[ 0 ] === 'flash' ) && w.vfxCalls.some( ( c ) => c[ 0 ] === 'smoke' ), 'muzzle flash and smoke' );
	ok( w.montages[ 0 ] === 'shoot' && w.montages[ 1 ] === 'strike' && fa.lastMontage === 'strike', 'shoot montage, falls back to the strike clip' );
	step( w, 0.4 );
	ok( fa.fire().refused === 'empty' && w.audio.clicks.includes( 'dry' ), 'empty: a dry click, no shot' );
	step( w, 0.3 );
	w.app.input.press( 'KeyR' );
	step( w, DT );
	ok( fa.phase === 'reloading' && fa.shots === 12, 'R starts the reload (the cartridge is used at the end)' );
	ok( w.montages.includes( 'inspect' ), 'reload montage falls back to the inspect clip on the upper body' );
	step( w, 1.3 );
	ok( fa.phase === 'reloading' && ! fa.loaded.pistol, 'still reloading at 1.3 s' );
	step( w, 0.15 );
	ok( fa.phase === 'ready' && fa.loaded.pistol && fa.shots === 11, 'loaded after 1.4 s, one cartridge used' );
	ok( [ 'half', 'pour', 'ram', 'cock' ].every( ( k ) => w.audio.clicks.includes( k ) ), 'the reload clacks played' );

	// holstering stops a reload: nothing used
	fa.fire();
	step( w, 0.4 );
	fa.reload();
	step( w, 0.5 );
	fa.holster();
	ok( ! fa.drawn && ! fa.loaded.pistol && fa.shots === 11, 'holstering mid-reload uses nothing' );

	// no cartridges
	fa.shots = 0;
	fa.draw( 'pistol' );
	step( w, 0.5 );
	ok( ! fa.reload() && /No cartridges/.test( w.toasts.at( - 1 ) ), 'no cartridges: no reload, a toast' );

	// the musket, the G cycle
	ok( fa.buy( 'musket' ).ok && fa.has( 'musket' ), 'buys the musket' );
	fa.holster();
	w.app.input.press( 'KeyG' ); step( w, DT );
	ok( fa.weapon === 'pistol', 'G: the pistol first' );
	w.app.input.press( 'KeyG' ); step( w, DT );
	ok( fa.weapon === 'musket', 'G again: the musket' );
	w.app.input.press( 'KeyG' ); step( w, DT );
	ok( ! fa.drawn, 'G again: holstered' );
	fa.shots = 5;
	fa.draw( 'musket' );
	step( w, WEAPONS.musket.draw + 0.05 );
	fa.fire();
	step( w, 0.4 );
	fa.reload();
	step( w, 3.1 );
	ok( ! fa.loaded.musket, 'the musket is not loaded at 3.1 s' );
	step( w, 0.15 );
	ok( fa.loaded.musket && fa.shots === 4, 'the musket loads in 3.2 s' );

	// the musket's pace: a step forward is shortened to WEAPONS.musket.walk
	const p = w.player.position;
	step( w, DT );
	const x0 = p.x;
	p.x += 1 / 60 * 4;
	w.features.update( DT );
	ok( near( p.x - x0, 4 / 60 * WEAPONS.musket.walk, 1e-6 ), 'shouldered musket: walking is slowed to 85 %' );

	// the zoom: RMB held -> fov / 1.3, released -> back
	w.app.input.rightDown = true;
	step( w, 1 );
	ok( fa.aiming && near( w.camera.fov, 60 / 1.3, 0.05 ), 'RMB: a 1.3x zoom through the camera fov' );
	w.app.input.rightDown = false;
	step( w, 1 );
	ok( ! fa.aiming && w.camera.fov === 60, 'released: the fov is restored' );

	// the rod comes out: the gun goes away
	w.app.game.rod.equipped = true;
	step( w, DT );
	ok( ! fa.drawn, 'the rod out holsters the gun' );
	w.app.game.rod.equipped = false;
	fa.draw( 'pistol' );
	w.app.game.rod.equipped = true;
	fa.holster( true );
	fa.draw( 'pistol' );
	ok( fa.drawn && ! w.app.game.rod.equipped, 'drawing puts the rod away' );
	w.player.mode = 'swim';
	step( w, DT );
	ok( ! fa.drawn && fa.playerAction === null, 'swimming holsters it' );

}

// ---------------------------------------------------------------- sandbox: free
{

	const w = makeWorld( { px: FAR.x, pz: FAR.z, mode: 'sandbox' } );
	ok( w.state.free, 'sandbox state is free' );
	const m0 = w.state.money;
	ok( w.fa.buy( 'musket' ).ok && w.fa.buy( 'pouch' ).ok && w.state.money === m0 && w.fa.shots === 12, 'sandbox: guns and pouches are free' );
	ok( /Free/.test( w.fa.shopRows() ), 'sandbox rows say Free' );

}

// ---------------------------------------------------------------- hits: raiders
{

	const raider = new StubRaider( FAR.x, FAR.z - 10 );
	const melee = { targets: () => [ raider ], raiders: [ raider ], pops: [], pop( t ) { this.pops.push( t ); }, playerDown: false };
	const w = makeWorld( { px: FAR.x, pz: FAR.z, melee, ground: 0 } );
	const { fa } = w;
	fa.buy( 'pistol' ); fa.shots = 10;
	fa.draw( 'pistol' );
	step( w, 0.5 );
	// the chest of the raider 10 m north (the camera at eye height 1.6 looks down to his chest)
	aim( w, { x: 0, y: 1.1 - 1.6, z: - 10 } );
	fa.aiming = true;
	fa.rand = () => 0; // dead centre
	const r1 = fa.fire();
	const PD = WEAPONS.pistol.damage;
	ok( r1.hit === 'raider' && raider.hits[ 0 ] === PD && ! r1.head, `a body shot at 10 m: ${ PD } damage through takeHit` );
	ok( melee.pops.includes( String( PD ) ), 'the hit number goes through melee.pop' );
	fa.loaded.pistol = true; fa.after = 0;
	aim( w, { x: 0, y: 1.7 - 1.6, z: - 10 } );
	const r2 = fa.fire();
	ok( r2.head && raider.hits[ 1 ] === Math.round( PD * HEADSHOT ), `a head shot: x${ HEADSHOT }` );
	// a wind-up is interrupted like a parry
	const r3 = new StubRaider( FAR.x, FAR.z - 10, { state: 'windup', hp: 200 } );
	melee.targets = () => [ r3 ];
	fa.loaded.pistol = true; fa.after = 0;
	aim( w, { x: 0, y: 1.1 - 1.6, z: - 10 } );
	fa.fire();
	ok( r3.parriedCalls === 1 && r3.state === 'stagger', 'a shot during the wind-up staggers him (parried())' );
	// falloff on a far raider
	const r4 = new StubRaider( FAR.x, FAR.z - 20, { hp: 500 } );
	melee.targets = () => [ r4 ];
	fa.loaded.pistol = true; fa.after = 0;
	aim( w, { x: 0, y: 1.1 - 1.6, z: - 20 } );
	fa.fire();
	ok( r4.hits[ 0 ] < PD && r4.hits[ 0 ] > PD / 2 && near( r4.hits[ 0 ], damageAt( WEAPONS.pistol, 19.7 ), 1.5 ), `a raider at 20 m takes the fallen-off damage (${ r4.hits[ 0 ] })` );
	// a kill counts
	const r5 = new StubRaider( FAR.x, FAR.z - 5, { hp: 10 } );
	melee.targets = () => [ r5 ];
	fa.loaded.pistol = true; fa.after = 0;
	aim( w, { x: 0, y: 1.1 - 1.6, z: - 5 } );
	const k0 = fa.stats.kills;
	const r5r = fa.fire();
	ok( r5r.killed && r5.state === 'down' && fa.stats.kills === k0 + 1, 'a killing shot: the raider goes down (his own takeHit)' );
	// spread misses at the edge: the hip cone with a far target sometimes misses
	ok( hitHumanoid( new StubRaider( 0, - 10 ), { x: 0, y: 1.6, z: 0 }, new Vector3( 0.2, - 0.05, - 1 ).normalize(), 0, 30 ) === null, 'a ray 11 deg off misses him' );

}

// ---------------------------------------------------------------- hits: ships, props, water
{

	const w = makeWorld( { px: FAR.x, pz: FAR.z, ground: - 30 } );
	const { fa, features } = w;
	fa.buy( 'musket' ); fa.shots = 10;
	const ship = new Ship( 'sloop', { x: FAR.x, z: FAR.z - 40, yaw: Math.PI / 2 } );
	ship.pose.y = 0;
	const naval = { ships: [ ship ], sunk: 0, _onSunk() { this.sunk ++; } };
	features.add( 'naval', { install: () => naval } );
	w.player.position.y = 0.5; // on a dinghy-height deck
	w.camera.position.y = 2.1;
	fa.draw( 'musket' );
	step( w, 1 );
	fa.rand = () => 0;
	const deck = deckBox( ship );
	aim( w, { x: 0, y: deck.c.y - 2.1, z: - 40 } );
	const hp0 = ship.hp;
	const s1 = fa.fire();
	ok( s1.hit === 'ship' && ship.hp === hp0 - 2, 'a pirate deck without exposed crew: 2 hull damage' );
	ship.boarding = { crewLeft: 2, crewTotal: 2 };
	fa.loaded.musket = true; fa.after = 0;
	const s2 = fa.fire();
	ok( s2.killed && ship.boarding.crewLeft === 1 && ship.hp === hp0 - 2, 'with exposed crew: one of them goes down' );
	fa.loaded.musket = true; fa.after = 0;
	aim( w, { x: 0, y: ( ship.cls.sheer - 1 ) - 2.1, z: - 40 } );
	const s3 = fa.fire();
	ok( s3.hit === 'ship' && ship.hp === hp0 - 2 && ship.boarding.crewLeft === 1, 'a ball into the hull side: splinters only' );
	// a prop in the way
	const calls = [];
	const props = { raycastSegment: ( ax, ay, az, bx, by, bz ) => ( { t: 0.1, id: 'crate-1', x: ax + ( bx - ax ) * 0.1, y: ay + ( by - ay ) * 0.1, z: az + ( bz - az ) * 0.1 } ), damage: ( id, e, at, by ) => calls.push( [ id, e, by ] ) };
	features.add( 'destruction', { install: () => props } );
	fa.loaded.musket = true; fa.after = 0;
	const s4 = fa.fire();
	ok( s4.hit === 'prop' && calls[ 0 ][ 0 ] === 'crate-1' && calls[ 0 ][ 1 ] > 0 && calls[ 0 ][ 2 ] === 'player', 'a prop nearer than the ship takes the ball (destruction.damage)' );
	features.list.delete( 'destruction' );
	// the water
	fa.loaded.musket = true; fa.after = 0;
	aim( w, { x: 0.5, y: - 0.3, z: - 1 } );
	const s5 = fa.fire();
	ok( s5.hit === 'water' && w.vfxCalls.some( ( c ) => c[ 0 ] === 'splash' ), 'into the sea: a splash' );
	// the ground
	w.app.terrainData = { heightAt: () => 1 };
	fa.loaded.musket = true; fa.after = 0;
	aim( w, { x: - 0.5, y: - 0.3, z: - 1 } );
	const s6 = fa.fire();
	ok( s6.hit === 'ground' && w.vfxCalls.some( ( c ) => c[ 0 ] === 'dust' ), 'into the ground: dust' );

}

// ---------------------------------------------------------------- resolveShot: the nearest wins
{

	const o = { x: 0, y: 1.6, z: 0 }, d = { x: 0, y: 0, z: - 1 };
	const near1 = new StubRaider( 0, - 8 ), far1 = new StubRaider( 0, - 15, { id: 'r2' } );
	const h = resolveShot( { targets: [ far1, near1 ], ships: [], seaLevel: - 10 }, o, d, 0, 30 );
	ok( h && h.kind === 'raider' && h.target === near1, 'the nearer raider stops the ball' );
	const wall = resolveShot( { targets: [ far1 ], world: () => 5, seaLevel: - 10 }, o, d, 0, 30 );
	ok( wall && wall.kind === 'world' && near( wall.t, 5 ), 'a wall in front of him stops it' );
	ok( resolveShot( { targets: [ near1 ], seaLevel: - 10 }, o, d, 0, 5 ) === null, 'out of range: no hit' );

}

// ---------------------------------------------------------------- the peace zone: only the training post
{

	const ma = { hud: false, fx: false, audio: { play() { return false; } }, avatarFactory: () => ( {} ), captain: false };
	const P = TRAINING_POST;
	const w = makeWorld( { px: P.x, pz: P.z + 6, ground: 0 } );
	ok( inPeace( P.x, P.z + 6 ), 'the training post stands in the peace zone' );
	const melee = meleeModule.install( w.app, w.features, ma );
	w.features.list.set( 'melee', { module: meleeModule, instance: melee } );
	const dummy = melee.dummy;
	dummy.y = 0;
	const { fa } = w;
	fa.buy( 'pistol' ); fa.shots = 4;
	fa.draw( 'pistol' );
	step( w, 0.5 );
	aim( w, { x: 0, y: 0.5, z: - 1 } ); // at the sky
	const r = fa.fire();
	ok( ! r.refused && ! fa.loaded.pistol, 'peace zone: a shot at the sky goes off (only a shot at a person who is not a raider is refused)' );
	fa.loaded.pistol = true; fa.after = 0; fa.phase = 'ready';
	const hits0 = dummy.hits;
	step( w, 0.4 );
	aim( w, { x: dummy.x - P.x, y: 1.0 - 1.6, z: dummy.z - ( P.z + 6 ) } );
	const r2 = fa.fire();
	ok( ! r2.refused && r2.hit === 'raider' && dummy.hits === hits0 + 1, 'peace zone: the training post may be shot (its own takeHit)' );
	ok( fa.stats.refused === 0, 'nothing was refused on the home island' );

}

// ---------------------------------------------------------------- the save
{

	const w = makeWorld( { px: FAR.x, pz: FAR.z } );
	w.fa.buy( 'pistol' ); w.fa.buy( 'musket' ); w.fa.buy( 'pouch' );
	w.fa.loaded.pistol = false;
	w.fa.sel = 'musket';
	const j = JSON.parse( JSON.stringify( w.fa.toJSON() ) );
	ok( j.v === 1 && j.owned.length === 2 && j.shots === 12 && j.loaded.join() === 'musket' && j.sel === 'musket', 'toJSON: owned, loaded, shots, the selection' );
	const w2 = makeWorld( { px: FAR.x, pz: FAR.z } );
	w2.fa.fromJSON( j );
	ok( w2.fa.has( 'pistol' ) && w2.fa.has( 'musket' ) && w2.fa.shots === 12 && ! w2.fa.loaded.pistol && w2.fa.loaded.musket && w2.fa.sel === 'musket' && ! w2.fa.drawn, 'fromJSON restores it (holstered)' );
	// through the registry (Features.toJSON / fromJSON is what the GameState save calls)
	const all = JSON.parse( JSON.stringify( w.features.toJSON() ) );
	const w3 = makeWorld( { px: FAR.x, pz: FAR.z } );
	w3.features.fromJSON( all );
	ok( w3.fa.shots === 12 && w3.fa.has( 'musket' ), 'the registry save round trip' );
	w3.fa.fromJSON( { owned: [ 'cannon', 'pistol' ], loaded: [ 'musket' ], shots: 1e9, sel: 'musket' } );
	ok( w3.fa.has( 'pistol' ) && ! w3.fa.has( 'musket' ) && ! w3.fa.loaded.musket && w3.fa.shots === POUCH.max && w3.fa.sel === 'pistol', 'bad data is cleaned' );
	w3.fa.reset();
	ok( ! w3.fa.anyOwned() && w3.fa.shots === 0, 'reset: a new game has no guns' );

}

// ---------------------------------------------------------------- the mesh budget, the key
{

	const tp = weaponTriangles( 'pistol' ), tm = weaponTriangles( 'musket' );
	ok( tp < 600 && tm < 600 && tp > 100 && tm > 100, `the weapon meshes stay under 600 triangles (pistol ${ tp }, musket ${ tm })` );
	const f = new Features( {} );
	const a = new Firearms( { player: null }, f, { audio: { report() {}, click() {} }, mesh: false } );
	ok( a.keyOk && ! f.claimKey( 'KeyG', 'other' ), 'G is claimed on the registry' );
	ok( a.wantsMouse() === false && a.playerAction === null, 'holstered: the mouse and the pose are left alone' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall firearms tests passed' );
process.exit( fails ? 1 : 0 );
