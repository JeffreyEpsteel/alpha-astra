// Plain-node test of the boarding feature (src/features/boarding): deck geometry, ransom / plunder tables, the crippled-ship rule,
// the Board offer (alongside, slow), the crossing state machine, crew fights with stub avatars through the real melee feature,
// riding the ship's frame, the surrender choice (prisoner / plunder), the prisoner in the boat and ashore, the ransom and bounty x1.5
// payouts through the real notices, escape risk, defeat / retreat / abort paths, the save and a fake-DOM run of the HUD.
// Real: Features, Melee, Naval (no models, no HUD), Notices, GameState, TerrainData. Stubs: player, input, boat, avatars, trade.
//   node test/feature-boarding.mjs
import { Vector3, Quaternion, Group, PerspectiveCamera } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import * as meleeModule from '../src/features/melee/index.js';
import { Naval } from '../src/features/naval/Naval.js';
import * as noticesModule from '../src/features/notices/index.js';
import * as boardingModule from '../src/features/boarding/index.js';
import { Boarding } from '../src/features/boarding/Boarding.js';
import {
	RULES, CREW_TWEAK, deckFor, deckQ, insideDeck, clampDeck, toLocal, toWorld, hullGap, layout, tierOf, ransomFor, plunderFor, hash,
} from '../src/features/boarding/BoardingData.js';
import { Prisoner } from '../src/features/boarding/Prisoner.js';
import { BoardingHud } from '../src/features/boarding/BoardingHud.js';
import { SHIP_CLASSES } from '../src/features/naval/ShipClasses.js';
import { BOARD_SITES, STALLS } from '../src/features/notices/Sites.js';
import { BOATS } from '../src/game/Boats.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { yawToward } from '../src/features/melee/MeleeData.js';
import { CLIPS } from '../src/game/Characters.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, eps = 1e-3 ) => Math.abs( a - b ) <= eps;
const section = ( s ) => console.log( '\n== ' + s );
const DT = 1 / 30;
const terrain = new TerrainData();
const tick = () => new Promise( ( r ) => setImmediate( r ) );

// ---------------------------------------------------------------- stubs

class FakeModel {

	constructor() {

		this.clips = new Set( [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Melee_Paddle', 'Hit_Reaction', 'Knockdown', 'GetUp_Front', 'Stumble', 'Laugh', 'Look_Around', 'Swagger_Idle' ] );
		this.cur = null;
		this.layer = null;
		this.materials = [ { name: 'skin', emissive: { r: 0, g: 0, b: 0 } } ];
		for ( const m of this.materials ) {

			const e = m.emissive;
			Object.defineProperty( m, 'emissive', { get: () => e, set: ( v ) => { e.r = v[ 0 ]; e.g = v[ 1 ]; e.b = v[ 2 ]; }, configurable: true } );

		}

	}

	get current() {

		return this.cur;

	}

	play( name, { loop = true, speed = 1 } = {} ) {

		if ( ! this.clips.has( name ) ) throw new Error( 'no clip ' + name );
		if ( name === this.cur && this.layer ) return this.layer;
		this.cur = name;
		this.layer = { name, time: 0, speed, ended: false, loop };
		return this.layer;

	}

	update( dt ) {

		if ( this.layer ) this.layer.time += dt * this.layer.speed;

	}

	hold() {}

}

const made = [];
function avatarFactory( o ) {

	const model = new FakeModel();
	const a = {
		group: new Group(), model, character: o.character, lite: o.lite, ready: Promise.resolve( model ), poses: [], disposed: false,
		update( dt, pose ) { this.last = { ...pose, position: pose.position.clone() }; this.poses.push( this.last ); },
		dispose() { this.disposed = true; },
	};
	made.push( a );
	return a;

}

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

// ---------------------------------------------------------------- a world

// the pirate ship lies at ( 0, 520 ) heading +Z; the player's boat 6 m off her port side (hull gap 6 m)
function makeWorld( o = {} ) {

	const calls = [], events = [], toasts = [];
	const state = new GameState( { getItem: () => null, setItem: () => {} } );
	state.boat = 'lobster';
	const baseMoney = state.money;
	const player = {
		mode: 'boat', position: new Vector3( 8.6, 1, 520 ), velocity: new Vector3(), yaw: 0, pitch: 0, stamina: 1, launched: 0, grounded: true, prompt: null, busy: false,
		seat: null, action: null, deckYaw: 0, armInit: true, camInit: true, _camY: 1,
		leaveHelm() { this.mode = 'deck'; calls.push( 'leaveHelm' ); },
		boardBoat() { this.mode = 'deck'; this.position.copy( boat.position ); calls.push( 'boardBoat' ); },
		groundAt: ( x, z ) => terrain.heightAt( x, z ),
	};
	const boat = {
		position: new Vector3( 8.6, 0, 520 ), quaternion: new Quaternion(), velocity: new Vector3(), speed: 0.4, driven: true, moored: false,
		mooring: { anchor: new Vector3( 5, 0, 5 ), heading: 1 }, throttle: 0.5,
		getYaw() { return 0; },
		toWorld( local, out ) { return out.copy( local ).applyQuaternion( this.quaternion ).add( this.position ); },
		reset() { calls.push( 'boatReset' ); this.moored = true; },
	};
	const input = new FakeInput();
	const rod = { equipped: false, equip( on ) { this.equipped = on; } };
	const app = {
		player, input, boatCtl: boat, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), scene: { add() {}, remove() {} },
		game: { state, rod, fight: null, hud: null, toast: ( t ) => toasts.push( t ), cancelLine() {} },
		terrainData: terrain, colliders: new Colliders(), settings: { timeOfDay: 12, timeSpeed: 0 }, mode: 'campaign', paused: false, menuOpen: false, freeCam: false,
		avatar: { character: 'hyptile' }, audio: null, ui: null, cameraFeel: { kick() {} },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
	};
	const features = new Features( app );
	for ( const n of [ 'shipSunk', 'enemyDefeated', 'bountyCaptured', 'bountyClaimed', 'bountyAccepted', 'noticeCompleted', 'prisonerTaken', 'prisonerEscaped', 'prisonerRansomed',
		'shipPlundered', 'boardingStarted', 'boardingEnded', 'shipCrippled', 'captainSurrendered', 'crewDefeated', 'playerKnockedDown' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const cargo = [];
	if ( o.trade !== false ) features.add( 'trade', { install: () => ( { addCargo( good, qty, opt ) { cargo.push( { good, qty, opt } ); return o.room === 0 ? 0 : qty; } } ) } );
	const notices = o.notices ? features.add( 'notices', noticesModule ) : null;
	const melee = o.melee === false ? null : features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, hud: false, fx: false, seed: 5, captain: false, audio: { play() { return true; }, lead: () => 0.1, preload() {} } } ) } );
	const naval = o.naval === false ? null : features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const boarding = features.add( 'boarding', { install: ( a, f ) => boardingModule.install( a, f, { avatarFactory, hud: false, seed: 11, ...( o.options || {} ) } ) } );
	return { app, features, player, boat, input, state, baseMoney, melee, naval, boarding, notices, events, calls, toasts, cargo, rod };

}

const evs = ( w, name ) => w.events.filter( ( e ) => e[ 0 ] === name ).map( ( e ) => e[ 1 ] );

function step( w, dt = DT ) {

	w.features.update( dt );
	w.input.endFrame();

}

function run( w, seconds, each = null ) {

	const n = Math.round( seconds / DT );
	for ( let i = 0; i < n; i ++ ) {

		step( w );
		if ( each && each( i ) === false ) return;

	}

}

// a crippled sloop 6 m off the boat's port... the boat lies to the ship's +X side
function cripple( w, ship, frac = 0.2 ) {

	ship.damage( ship.hp - ship.maxHp * frac, { by: 'player' } );

}

function addSloop( w, x = 0, z = 520, kind = 'sloop' ) {

	const s = w.naval.spawn( kind, { x, z, yaw: 0 } );
	s.state = 'dock'; // nothing acts on 'dock' for a pirate: she lies still until she is crippled
	s.wantSpeed = 0;
	return s;

}

// play the fight: the player attacks the nearest crew (faces it, presses LMB every 0.8 s), stays healthy unless `hurt`
function fight( w, { seconds = 90, hurt = false } = {} ) {

	let lastPress = - 9, t = 0;
	run( w, seconds, () => {

		t += DT;
		if ( w.boarding.phase !== 'fight' ) return w.boarding.phase === 'fight' ? true : ( w.boarding.phase === 'cross-in' || w.boarding.phase === 'cross-out' ? true : false );
		w.input.mouseDown = false;
		if ( ! hurt ) { w.melee.combat.hp = 100; }
		w.player.stamina = 1;
		const live = w.melee.raiders.filter( ( r ) => r.active && r.targetable && r.slot.id.startsWith( 'bd-crew' ) );
		if ( ! live.length ) return true;
		let best = null, bd = Infinity;
		for ( const r of live ) {

			const d = Math.hypot( r.x - w.player.position.x, r.z - w.player.position.z );
			if ( d < bd ) { bd = d; best = r; }

		}

		w.player.yaw = yawToward( w.player.position.x, w.player.position.z, best.x, best.z );
		if ( bd > 1.8 ) {

			const dx = best.x - w.player.position.x, dz = best.z - w.player.position.z, l = Math.hypot( dx, dz );
			w.player.position.x += dx / l * 2.7 * DT;
			w.player.position.z += dz / l * 2.7 * DT;

		} else if ( t - lastPress > 0.8 ) {

			lastPress = t;
			w.input.mouseDown = true;

		}

		return true;

	} );
	w.input.mouseDown = false;

}

// ================================================================ 1. data helpers
section( 'geometry, tables' );
{

	const pose = { x: 30, z: - 12, yaw: 0.7 };
	const l = toLocal( pose, 40, 3, {} ), w = toWorld( pose, l.x, l.z, {} );
	ok( near( w.x, 40 ) && near( w.z, 3 ), 'toLocal / toWorld round trip' );
	// the same convention as Ship.toWorld
	const w0 = toWorld( { x: 0, z: 0, yaw: Math.PI / 2 }, 0, 10, {} );
	ok( near( w0.x, 10 ) && near( w0.z, 0 ), 'forward (+Z local) turns with the yaw like the ship frame' );
	for ( const kind of [ 'sloop', 'brigantine' ] ) {

		const cls = SHIP_CLASSES[ kind ], d = deckFor( cls );
		ok( d.hl < cls.length / 2 && d.hb < cls.beam / 2 && d.hl > 3 && d.hb > 1.5, `${ kind }: the deck (${ d.hl.toFixed( 1 ) } x ${ d.hb.toFixed( 1 ) } m half-extents) fits inside the hull` );
		ok( insideDeck( d, 0, 0 ) && ! insideDeck( d, d.hb + 0.3, 0 ) && ! insideDeck( d, 0, d.hl + 0.3 ), `${ kind }: inside / outside tests` );
		const c = clampDeck( d, 40, - 30, {} );
		ok( deckQ( d, c.x, c.z ) < 1 && c.x > 0 && c.z < 0, `${ kind }: clampDeck pulls a far point back onto the deck, same direction` );
		const c2 = clampDeck( d, 0.3, 0.2, {} );
		ok( c2.x === 0.3 && c2.z === 0.2, `${ kind }: a point on the deck is left alone` );
		for ( const bl of [ { x: 8, z: 0 }, { x: - 8, z: 3 }, { x: 8, z: - 4 }, { x: - 6, z: - 6 } ] ) {

			const n = RULES.crew[ kind ], lay = layout( d, bl, n );
			ok( lay.crew.length === n && lay.crew.every( ( q ) => deckQ( d, q.x, q.z ) < 1 ) && deckQ( d, lay.arrive.x, lay.arrive.z ) < 1 && deckQ( d, lay.captain.x, lay.captain.z ) < 1, `${ kind }: every spot of the layout is on the deck (boat at ${ bl.x },${ bl.z })` );
			ok( Math.sign( lay.arrive.x ) === Math.sign( bl.x ) || bl.x === 0, `${ kind }: the player arrives at the rail on his boat's side` );
			const nearest = Math.min( ...lay.crew.map( ( q ) => Math.hypot( q.x - lay.arrive.x, q.z - lay.arrive.z ) ) );
			ok( nearest > 2.2, `${ kind }: the crew start ${ nearest.toFixed( 1 ) } m from the arrival point` );

		}

	}

	const cls = SHIP_CLASSES.sloop, ps = { x: 0, z: 0, yaw: 0 };
	ok( near( hullGap( cls, ps, 0, 0 ), 0 ) && near( hullGap( cls, ps, cls.beam / 2 + 6, 0 ), 6 ), 'hullGap: 0 inside, the distance from the rail beside her' );
	ok( near( hullGap( cls, ps, 0, cls.length / 2 + 3 ), 3 ) && near( hullGap( cls, ps, cls.beam / 2 + 3, cls.length / 2 + 4 ), 5 ), 'hullGap: off the bow and off the corner' );
	const rot = { x: 100, z: 100, yaw: Math.PI / 2 };
	ok( near( hullGap( cls, rot, 100 + cls.length / 2 + 2, 100 ), 2 ), 'hullGap: follows the ship\'s yaw' );
	ok( tierOf( { kind: 'sloop' } ) === 1 && tierOf( { kind: 'brigantine' } ) === 2 && tierOf( { kind: 'sloop', bounty: { tier: 3 } } ) === 3, 'tiers: sloop 1, brigantine 2, a bounty its own' );
	let lo = Infinity, hi = - Infinity;
	for ( let i = 0; i < 50; i ++ ) { const v = ransomFor( 2, () => i / 49 ); lo = Math.min( lo, v ); hi = Math.max( hi, v ); }
	ok( lo >= 520 * 0.85 - 5 && hi <= 520 * 1.15 + 5 && lo < hi, `ransom by tier within +-15% (${ lo }..${ hi } for tier 2)` );
	ok( ransomFor( 1, () => 0.5 ) === 240 && ransomFor( 3, () => 0.5 ) === 1100, 'ransom base 240 / 520 / 1100' );
	let seed = 3;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	const pl = plunderFor( SHIP_CLASSES.brigantine, rnd );
	ok( pl.coins >= 270 && pl.coins <= 480 && pl.goods.reduce( ( a, g ) => a + g.qty, 0 ) === 3 && pl.goods.every( ( g ) => RULES.plunderCargo.includes( g.good ) ), `plunder: ${ pl.coins } coins and 3 crates of ${ pl.goods.map( ( g ) => g.good ).join( ', ' ) }` );
	ok( hash( 'a' ) !== hash( 'b' ) && hash( 'abc' ) === hash( 'abc' ), 'hash is stable' );
	ok( CREW_TWEAK.flees === 0 && CREW_TWEAK.loot === 0 && CREW_TWEAK.hp < 100, 'the crew fight on (no flight, no own loot), lighter than a shore raider' );

}

// ================================================================ 2. install
section( 'install' );
{

	const w = makeWorld();
	const b = w.boarding;
	ok( b instanceof Boarding && w.features.get( 'boarding' ) === b, 'installs through Features.add( "boarding", module )' );
	ok( ! w.features.claimKey( 'KeyB', 'other' ) && w.features.claimKey( 'KeyB', 'boarding' ), 'claims KeyB' );
	ok( typeof b.update === 'function' && typeof b.dispose === 'function' && typeof b.toJSON === 'function' && typeof b.fromJSON === 'function' && typeof b.reset === 'function', 'interface: update / dispose / toJSON / fromJSON / reset' );
	ok( b.phase === 'idle' && b.prisoners.length === 0 && b.offer === null && ! b.isOpen && ! b.wantsMouse(), 'starts idle: no prisoners, no offer, no panel' );
	for ( const port of [ 'home', 'pons' ] ) {

		const s = BOARD_SITES[ port ], st = STALLS[ port ];
		let dx = s.x - st.x, dz = s.z - st.z;
		const l = Math.hypot( dx, dz );
		const x = s.x + dx / l * 2.2, z = s.z + dz / l * 2.2;
		b.prisoners.push( { name: 'Test', data: { value: 100 }, dispose() {} } );
		const it = w.features.nearestInteractable( { x, y: terrain.heightAt( x, z ), z } );
		b.prisoners.length = 0;
		ok( it && it.id === `boarding:handover:${ port }`, `${ port }: an interactable "Hand over prisoner" 2.2 m beyond the notice board` );
		ok( Math.hypot( x - st.x, z - st.z ) > 6, `${ port }: ${ Math.hypot( x - st.x, z - st.z ).toFixed( 1 ) } m from the fish buyer's stall (outside his 3.2 m talking range)` );

	}

	ok( w.features.nearestInteractable( { x: BOARD_SITES.home.x + 2, y: 2, z: BOARD_SITES.home.z } ) === null || w.features.nearestInteractable( { x: BOARD_SITES.home.x + 2, y: 2, z: BOARD_SITES.home.z } ).id.startsWith( 'notices' ), 'no hand-over prompt without prisoners' );
	ok( boardingModule.default.install === boardingModule.install, 'module shape: { install }' );
	b.dispose();
	ok( w.features.nearestInteractable( { x: BOARD_SITES.home.x, y: 2, z: BOARD_SITES.home.z } ) === null || w.features.nearestInteractable( { x: BOARD_SITES.home.x, y: 2, z: BOARD_SITES.home.z } ).id.startsWith( 'notices' ), 'dispose removes the interactables' );

}

// ================================================================ 3. the crippled-ship rule
section( 'crippled ships' );
{

	const w = makeWorld( { melee: false } );
	const s = addSloop( w );
	s.state = 'patrol';
	step( w );
	ok( s.state !== 'adrift', 'a sound pirate is left alone' );
	s.damage( 60, { by: 'player' } );
	step( w );
	ok( s.state !== 'adrift' && s.hpFraction > 0.25, 'at 50 % she still sails' );
	s.damage( 35, { by: 'player' } ); // 25 of 120 left: 20.8 %
	step( w );
	ok( s.state === 'adrift' && s.fleeAt === - 1 && s.wantSpeed === 0, 'below 25 % she strikes her colours: adrift, will not flee, no way on' );
	ok( evs( w, 'shipCrippled' ).length === 1 && w.toasts.some( ( t ) => /struck her colours/.test( t ) ), 'announced (event and toast)' );
	s.speed = 5;
	run( w, 25 );
	ok( s.speed < 0.1 && s.state === 'adrift' && s.alive, `she comes to rest and stays adrift (speed ${ s.speed.toFixed( 3 ) })` );

	const t = addSloop( w, 200, 700 );
	t.state = 'patrol';
	t.damage( t.hp - 20, { by: 'merchant' } );
	step( w );
	ok( t.state !== 'adrift', 'a ship wrecked by someone else does not surrender to the player' );

	// the brigantine's own flee point (16 %) is above the rule only for the sloop; both go adrift below 25 %
	const g = addSloop( w, - 200, 700, 'brigantine' );
	g.state = 'patrol';
	g.damage( g.hp - g.maxHp * 0.2, { by: 'player' } );
	step( w );
	ok( g.state === 'adrift', 'a brigantine at 20 % is adrift too' );

	// a bounty captain fights to the end (fleeAt 0) but still strikes at 25 %
	const bs = addSloop( w, 0, 900 );
	bs.bounty = { id: 'home:0:0', target: 'T', captain: 'C', tier: 2 };
	bs.fleeAt = 0;
	bs.state = 'patrol';
	bs.damage( bs.hp - bs.maxHp * 0.2, { by: 'player' } );
	step( w );
	ok( bs.state === 'adrift', 'a bounty captain strikes his colours at 25 % as well' );

	// nobody boards her: she founders on her own after a while, counted for the player
	const w2 = makeWorld( { melee: false } );
	const f = addSloop( w2 );
	cripple( w2, f );
	step( w2 );
	w2.boat.position.set( 400, 0, 400 ); // far away
	run( w2, RULES.adriftLife + 5 );
	ok( f.state === 'sinking' || f.state === 'gone', 'an unboarded wreck founders after the adrift time' );
	const sunk = evs( w2, 'shipSunk' );
	ok( sunk.length === 1 && sunk[ 0 ].byPlayer === true && sunk[ 0 ].faction === 'pirate' && sunk[ 0 ].how === 'foundered', 'her foundering is a shipSunk for the player' );

}

// ================================================================ 4. the offer
section( 'the offer' );
{

	const w = makeWorld();
	const s = addSloop( w );
	cripple( w, s );
	step( w );
	ok( w.boarding.offer === s, 'crippled, 6 m off the hull, boat slow, at the helm: the crossing is offered' );
	const v = w.boarding.view();
	ok( /Board the/.test( v.prompt ) && v.prompt.includes( s.name ) && /2 crew/.test( v.prompt ) && /<kbd>B<\/kbd>/.test( v.prompt ), `the prompt: ${ v.prompt }` );
	w.player.mode = 'deck';
	step( w );
	ok( w.boarding.offer === s, 'on deck it is offered too' );
	w.player.mode = 'walk';
	step( w );
	ok( w.boarding.offer === null, 'on foot there is no offer' );
	w.player.mode = 'boat';
	w.boat.speed = 3.5;
	step( w );
	ok( w.boarding.offer === null, 'too fast (3.5 m/s) for the crossing' );
	w.boat.speed = 0.4;
	w.boat.position.set( 2.6 + 9, 0, 520 );
	step( w );
	ok( w.boarding.offer === null, '9 m off the hull is too far' );
	w.boat.position.set( 2.6 + 7.9, 0, 520 );
	step( w );
	ok( w.boarding.offer === s, '7.9 m is in range' );
	w.boat.position.set( 8.6, 0, 520 );
	w.naval.playerHull.sunk = true;
	step( w );
	ok( w.boarding.offer === null, 'a sinking boat cannot board' );
	w.naval.playerHull.sunk = false;
	step( w );
	// a second, sound pirate alongside does not count
	const o = addSloop( w, 18, 520 );
	o.state = 'patrol';
	step( w );
	ok( w.boarding.offer === s, 'only the crippled ship is offered' );
	// nothing happens without the key
	run( w, 1 );
	ok( w.boarding.phase === 'idle', 'no key, no crossing' );
	// disabled: no offer
	w.boarding.enabled = false;
	step( w );
	w.boarding.enabled = true;

}

// ================================================================ 5. the whole boarding: prisoner
section( 'cross, fight, take the prisoner' );
const W = makeWorld( { notices: true } );
{

	const w = W;
	const s = addSloop( w );
	cripple( w, s );
	step( w );
	const swingBefore = w.melee.movePlayer === Object.getPrototypeOf( w.melee ).movePlayer;
	ok( swingBefore, 'before the crossing melee uses its own movePlayer' );
	const pm = w.rod;
	w.rod.equipped = true;
	w.input.press( 'KeyB' );
	step( w );
	ok( w.boarding.phase === 'cross-out' && w.boarding.ship === s, 'B starts the crossing (a fade out)' );
	ok( w.boat.moored === true && w.boat.driven === false && w.boat.mooring.anchor.x === 8.6 && w.boat.mooring.anchor.z === 520, 'the boat is moored where she lies (a moored boat is no target)' );
	run( w, 0.2 );
	ok( w.boarding.view().fade > 0.3 && w.boarding.view().fade < 1, 'the screen fades to black' );
	ok( w.player.mode === 'boat' || w.player.mode === 'deck', 'still at the boat during the fade' );
	run( w, 0.3 );
	await tick();
	ok( w.boarding.phase === 'cross-in', 'half way: cross-in' );
	ok( w.player.mode === 'walk' && w.calls.includes( 'leaveHelm' ), 'the player stands on deck on foot (left the helm)' );
	const pl = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, w.player.position.x, w.player.position.z, {} );
	const d = deckFor( s.cls );
	ok( deckQ( d, pl.x, pl.z ) < 1 && pl.x > 1, `on her deck, at the rail on the boat's side (local ${ pl.x.toFixed( 1 ) }, ${ pl.z.toFixed( 1 ) })` );
	ok( near( w.player.position.y, s.pose.y + s.cls.deck + 0.05, 0.25 ), `standing at her deck height (${ w.player.position.y.toFixed( 2 ) })` );
	ok( w.rod.equipped === false, 'the rod is put away' );
	ok( w.melee.movePlayer !== Object.getPrototypeOf( w.melee ).movePlayer, 'melee\'s evade is made deck-aware while aboard' );
	const crew = w.boarding.crew.filter( ( r ) => r.active );
	ok( crew.length === 2 && crew.every( ( r ) => w.melee.raiders.includes( r ) ), 'two crew, registered on melee.raiders (its blows, tags and telegraph apply)' );
	ok( crew.every( ( r ) => r.avatar.lite === true && r.avatar.character !== 'hyptile' && r.cfg.hp === CREW_TWEAK.hp && r.cfg.flees === 0 ), 'lite roster avatars, crew stats' );
	ok( crew.every( ( r ) => { const q = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, r.x, r.z, {} ); return deckQ( d, q.x, q.z ) < 1; } ), 'the crew stand on the deck' );
	ok( w.boarding.captain && w.boarding.captain.avatar.lite && w.boarding.captain.name === s.captain, 'the captain stands aft' );
	ok( s.state === 'boarded' && s.alive, 'the ship is "boarded": still, alive' );
	ok( evs( w, 'boardingStarted' ).length === 1 && evs( w, 'boardingStarted' )[ 0 ].crew === 2, 'boardingStarted { crew: 2 }' );
	run( w, 0.6 );
	ok( w.boarding.phase === 'fight' && w.boarding.view().fade === 0, 'then the fight, screen clear' );
	ok( /LMB/.test( w.boarding.view().prompt ), 'the fight hint is shown' );

	// riding: the ship moves and turns, the player and the crew go with her
	const loc0 = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, w.player.position.x, w.player.position.z, {} );
	const cl0 = crew.map( ( r ) => toLocal( { x: s.x, z: s.z, yaw: s.yaw }, r.x, r.z, {} ) );
	if ( w.melee ) w.melee.lockOn = false; // (wave 4: the soft lock would ease the view onto the crew; this checks the ride alone)
	const yaw0 = w.player.yaw - s.yaw;
	w.input.keys.clear();
	for ( let i = 0; i < 20; i ++ ) {

		s.x += 0.4;
		s.z += 0.25;
		s.yaw += 0.02;
		s.pose.ty = 0.6 * Math.sin( i / 3 );
		step( w );

	}

	const loc1 = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, w.player.position.x, w.player.position.z, {} );
	ok( Math.hypot( loc1.x - loc0.x, loc1.z - loc0.z ) < 0.8, `the player rides the moving, turning ship (drift ${ Math.hypot( loc1.x - loc0.x, loc1.z - loc0.z ).toFixed( 2 ) } m on deck)` );
	ok( Math.abs( ( w.player.yaw - s.yaw ) - yaw0 ) < 0.05, 'and turns with her' );
	ok( crew.every( ( r ) => { const q = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, r.x, r.z, {} ); return deckQ( d, q.x, q.z ) < 1.15; } ), 'the crew stay on the deck while she moves' );
	ok( near( w.player.position.y, s.pose.y + s.cls.deck, 0.9 ) && w.player.position.y > 1.0, 'the player rides her heave (y follows the deck)' );

	// the deck's edge: pushing overboard is stopped
	w.player.position.x += 30;
	step( w );
	const edge = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, w.player.position.x, w.player.position.z, {} );
	ok( deckQ( d, edge.x, edge.z ) < 1, 'walking off the deck is stopped at the bulwark' );

	// melee\'s evade dash moves along the deck
	const before = w.player.position.clone();
	w.melee.movePlayer( 2, 0 );
	const after = toLocal( { x: s.x, z: s.z, yaw: s.yaw }, w.player.position.x, w.player.position.z, {} );
	ok( deckQ( d, after.x, after.z ) < 1, 'an evade dash cannot leave the deck' );
	w.player.position.copy( before );

	// the crew hurt a player who does nothing
	w.melee.combat.hp = 100;
	run( w, 4 );
	ok( w.melee.playerHp < 100 && w.melee.playerHp > 0, `idle on deck the crew hit back (hp ${ w.melee.playerHp })` );
	w.melee.combat.hp = 100;
	ok( crew.every( ( r ) => r.owner === w.boarding.host ), 'the crew are driven by the deck host' );

	// win the fight
	fight( w, { seconds: 120 } );
	ok( w.boarding.crewDown === 2 && crew.every( ( r ) => DOWN_OR_GONE( r ) ), `both crew are down (${ crew.map( ( r ) => r.state ).join( ', ' ) })` );
	ok( w.boarding.phase === 'surrender' && w.boarding.view().choice, 'the captain surrenders and the choice appears' );
	const ch = w.boarding.view().choice;
	ok( ch.options.length === 2 && /prisoner/i.test( ch.options[ 0 ].label ) && /Plunder/.test( ch.options[ 1 ].label ) && ch.options[ 0 ].key === '1' && ! ch.options[ 0 ].disabled, 'choice: 1 Take prisoner / 2 Plunder' );
	ok( /Ransom about \$\d+/.test( ch.options[ 0 ].sub ) && /About \$\d+ and 2 crates/.test( ch.options[ 1 ].sub ), `numbers shown: ${ ch.options[ 0 ].sub } | ${ ch.options[ 1 ].sub }` );
	ok( evs( w, 'crewDefeated' ).length === 2 && evs( w, 'captainSurrendered' ).length === 1, 'crewDefeated x2, captainSurrendered' );
	step( w );
	ok( w.boarding.captain.avatar.last && w.boarding.captain.avatar.last.action === 'disappointed', 'the captain plays the surrender action' );
	ok( s.boarding.crewLeft === 0, 'the ship\'s crew count is spent' );
	ok( evs( w, 'shipSunk' ).length === 0 && evs( w, 'enemyDefeated' ).length === 0, 'beating the crew claims neither a sinking nor a shore-raider kill' );
	const money0 = w.state.money;
	w.input.press( 'Digit1' );
	step( w );
	ok( w.boarding.phase === 'ret-out', 'key 1: back across (fade)' );
	run( w, 0.6 );
	ok( w.boarding.phase === 'ret-in' && w.boarding.prisoners.length === 1, 'the prisoner is aboard' );
	ok( w.player.mode === 'deck' && w.calls.includes( 'boardBoat' ), 'the player is back on his boat\'s deck' );
	ok( w.boat.moored === false && w.boat.mooring.anchor.x === 5, 'the boat is released (its old mooring restored)' );
	ok( w.melee.movePlayer === Object.getPrototypeOf( w.melee ).movePlayer, 'melee\'s own evade is back' );
	ok( crew.every( ( r ) => ! r.active ), 'the crew are stood down' );
	ok( s.state === 'sinking', 'the pirate ship founders' );
	const pr = w.boarding.prisoners[ 0 ];
	ok( pr.name === s.captain && pr.data.value >= 200 && pr.data.value <= 280 && pr.data.tier === 1, `${ pr.name } is held for a ransom of $${ pr.data.value }` );
	ok( pr.avatar === made.find( ( a ) => a === pr.avatar ) && pr.avatar.disposed === false, 'his avatar lives on as the prisoner' );
	const sunk = evs( w, 'shipSunk' );
	ok( sunk.length === 1 && sunk[ 0 ].id === s.id && sunk[ 0 ].byPlayer === true && sunk[ 0 ].faction === 'pirate' && sunk[ 0 ].boarded === true, 'shipSunk { byPlayer, faction: pirate } so the notices count her' );
	ok( evs( w, 'prisonerTaken' ).length === 1 && evs( w, 'boardingEnded' )[ 0 ].outcome === 'prisoner', 'prisonerTaken, boardingEnded { prisoner }' );
	ok( w.state.money === money0, 'no cash yet: the ransom is paid at the harbour' );
	run( w, 0.7 );
	ok( w.boarding.phase === 'idle' && w.boarding.view().fade === 0, 'idle again' );
	ok( w.boarding.stats.boarded === 1 && w.boarding.stats.captured === 1 && w.boarding.stats.crewDefeated === 2, 'stats' );
	const hv = w.boarding.view();
	ok( hv.prisoners.length === 1 && hv.prisoners[ 0 ].name === pr.name, 'the HUD counter lists the prisoner' );

}

function DOWN_OR_GONE( r ) {

	return ! r.targetable;

}

// ================================================================ 6. the prisoner in the boat and ashore
section( 'the prisoner' );
{

	const w = W;
	const pr = w.boarding.prisoners[ 0 ];
	w.boat.position.set( 50, 0, 100 );
	w.boat.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.5 );
	w.player.mode = 'boat';
	run( w, 0.2 );
	ok( pr.mode === 'aboard' && pr.avatar.last.mode === 'seat', 'at sea he sits in the boat (seat pose)' );
	const seat = BOATS.lobster.seats[ 0 ];
	const wp = w.boat.toWorld( new Vector3( seat.x, BOATS.lobster.deckY, seat.z ), new Vector3() );
	ok( Math.hypot( pr.position.x - wp.x, pr.position.z - wp.z ) < 0.01 && pr.avatar.last.frame === w.boat.quaternion, 'in the passenger seat, in the boat\'s frame' );
	ok( pr.avatar.last.speed === 0, 'seated, still' );
	// the player walks ashore at the pier foot: he follows
	const px = WORLD.pier.x, pz = WORLD.pier.zStart + 8;
	w.player.mode = 'walk';
	w.player.position.set( px, terrain.heightAt( px, pz ) + 0.1, pz );
	w.player.yaw = Math.PI;
	run( w, 0.1 );
	ok( pr.mode === 'follow', 'ashore he follows' );
	let moved = false;
	for ( let i = 0; i < 120; i ++ ) {

		w.player.position.z -= 0.05;
		step( w );
		if ( pr.avatar.last.speed > 0.5 ) moved = true;

	}

	const dd = Math.hypot( pr.position.x - w.player.position.x, pr.position.z - w.player.position.z );
	ok( dd < 4.5 && moved && pr.avatar.last.mode === 'walk', `he walks after the player (${ dd.toFixed( 1 ) } m behind, walking)` );
	// he will not wade into the sea
	w.player.position.set( px, terrain.heightAt( px, pz ) + 0.1, pz );
	pr.position.set( px, 0.5, pz );
	// back to the boat
	w.player.mode = 'deck';
	run( w, 0.1 );
	ok( pr.mode === 'aboard', 'back aboard he is seated again' );
	// swimming beside the boat does not strand him on land
	w.player.mode = 'swim';
	run( w, 0.1 );
	ok( pr.mode === 'aboard', 'while the player swims he stays in the boat' );
	w.boat.position.set( 8.6, 0, 520 );
	w.boat.quaternion.identity();

}

// ================================================================ 7. the hand-over
section( 'the ransom' );
{

	const w = W;
	const pr = w.boarding.prisoners[ 0 ];
	const value = pr.data.value;
	const s = BOARD_SITES.home, st = STALLS.home;
	let dx = s.x - st.x, dz = s.z - st.z;
	const l = Math.hypot( dx, dz );
	const x = s.x + dx / l * 2.2, z = s.z + dz / l * 2.2;
	w.player.mode = 'walk';
	w.player.position.set( x, terrain.heightAt( x, z ), z );
	const it = w.features.nearestInteractable( w.player.position );
	ok( it && it.id === 'boarding:handover:home' && it.when(), 'at the harbour rail the hand-over is the nearest E' );
	const text = it.prompt();
	ok( new RegExp( `Hand over ${ pr.name } · \\$${ value }` ).test( text ), `prompt: ${ text }` );
	// away from it
	ok( ( () => { const q = w.features.nearestInteractable( { x: x + 40, y: 2, z } ); return ! q || q.id !== 'boarding:handover:home'; } )(), 'not offered elsewhere' );
	const money = w.state.money;
	it.onInteract();
	ok( w.state.money === money + value, `E pays the ransom ($${ value })` );
	ok( w.boarding.prisoners.length === 0 && pr.avatar === null, 'the prisoner is gone from the boat' );
	const rr = evs( w, 'prisonerRansomed' );
	ok( rr.length === 1 && rr[ 0 ].total === value && rr[ 0 ].count === 1 && rr[ 0 ].port === 'home', 'prisonerRansomed event' );
	ok( evs( w, 'bountyCaptured' ).length === 0, 'a plain ransom is not a bounty' );
	ok( w.boarding.stats.ransomed === 1 && w.boarding.stats.ransomTotal === value, 'stats: ransomed' );
	ok( w.boarding.handOver( 'home' ) === null, 'nothing more to hand over' );
	ok( w.features.nearestInteractable( w.player.position ) === null || ! w.features.nearestInteractable( w.player.position ).id.startsWith( 'boarding' ), 'the interactable goes quiet without prisoners' );

}

// ================================================================ 8. plunder
section( 'plunder' );
{

	const w = makeWorld( { notices: false } );
	const s = addSloop( w, 0, 520, 'brigantine' );
	cripple( w, s, 0.2 );
	w.boat.position.set( 3.4 + 4, 0, 520 );
	w.player.position.copy( w.boat.position );
	step( w );
	ok( w.boarding.offer === s, 'brigantine crippled: offered' );
	w.input.press( 'KeyB' );
	run( w, 1.2 );
	await tick();
	run( w, 0.1 );
	const crew = w.boarding.crew.filter( ( r ) => r.active );
	ok( crew.length === 3 && w.boarding.phase === 'fight', 'a brigantine has three crew' );
	fight( w, { seconds: 150 } );
	ok( w.boarding.phase === 'surrender', `three crew beaten (${ w.boarding.crewDown })` );
	const d = w.boarding.deal;
	ok( d.tier === 2 && d.plunder.goods.reduce( ( a, g ) => a + g.qty, 0 ) === 3, 'tier 2 deal: three crates' );
	const money = w.state.money;
	w.input.press( 'Digit2' );
	step( w );
	run( w, 0.7 );
	ok( w.state.money === money + d.plunder.coins && d.plunder.coins > 0, `plunder pays $${ d.plunder.coins }` );
	ok( w.cargo.length === d.plunder.goods.length && w.cargo.every( ( c, i ) => c.good === d.plunder.goods[ i ].good && c.qty === d.plunder.goods[ i ].qty && c.opt.paid === 0 ), 'the cargo goes to trade.addCargo( good, qty, { paid: 0 } )' );
	ok( w.boarding.prisoners.length === 0 && w.boarding.stats.plundered === 1, 'no prisoner' );
	ok( s.state === 'sinking', 'the ship founders' );
	const sunk = evs( w, 'shipSunk' );
	ok( sunk.length === 1 && sunk[ 0 ].loot === d.plunder.coins && sunk[ 0 ].how === 'plundered', 'shipSunk emitted at once' );
	ok( evs( w, 'shipPlundered' )[ 0 ].stowed === 3, 'shipPlundered { stowed }' );
	ok( made.filter( ( a ) => a.character && a.disposed ).length >= 1, 'the captain\'s avatar is disposed (he is not a prisoner)' );

	// no room in the hold
	const w2 = makeWorld( { notices: false, room: 0 } );
	const s2 = addSloop( w2 );
	cripple( w2, s2 );
	step( w2 );
	w2.input.press( 'KeyB' );
	run( w2, 1.2 );
	await tick();
	fight( w2, { seconds: 120 } );
	w2.input.press( 'Digit2' );
	step( w2 );
	run( w2, 0.7 );
	ok( w2.toasts.some( ( t ) => /no room in the hold/.test( t ) ), 'a full hold is reported, the coins still come' );

	// prisoner list full: option disabled
	const w3 = makeWorld( { notices: false } );
	const s3 = addSloop( w3 );
	cripple( w3, s3 );
	step( w3 );
	for ( let i = 0; i < RULES.maxPrisoners; i ++ ) w3.boarding.prisoners.push( new Prisoner( { id: 'x' + i, name: 'P' + i, value: 100, tier: 1, kind: 'sloop', ship: 's', character: 'bravile' }, avatarFactory( { character: 'bravile' } ) ) );
	w3.input.press( 'KeyB' );
	run( w3, 1.2 );
	await tick();
	fight( w3, { seconds: 120 } );
	const ch = w3.boarding.view().choice;
	ok( ch && ch.options[ 0 ].disabled && /no room/i.test( ch.options[ 0 ].sub ), 'with the boat full the prisoner option is disabled' );
	ok( w3.boarding.choose( 0 ) === false && w3.boarding.phase === 'surrender', 'and cannot be chosen' );
	ok( w3.boarding.choose( 1 ) === true, 'plunder still can' );
	run( w3, 1.3 );
	ok( w3.boarding.phase === 'idle', 'back to idle' );

}

// ================================================================ 9. bounty x1.5 through the real notices
section( 'bounty' );
{

	const w = makeWorld( { notices: true } );
	const n = w.notices;
	const bounty = {
		id: 'home:0:0', port: 'home', day: 0, slot: 0, kind: 'bounty', type: 'bounty', title: 'bounty', client: 'Test', text: 'x', params: {}, goal: 1,
		reward: { money: 900, rep: 11, unlock: null }, issued: 0, expires: 60, progress: 0, acceptedAt: 0, tier: 2, target: 'Gully Marrow, the Tide Rat', captain: 'Gully Marrow',
		epithet: 'the Tide Rat', ship: 'Rusty Gull', craft: 'a sloop', region: { x: 0, z: 520, compass: 'south', distance: 500 },
	};
	n.fromJSON( { ...n.toJSON(), active: [ bounty ] } );
	step( w );
	step( w );
	ok( w.naval.bounties.has( 'home:0:0' ), 'the notices announced the bounty and naval has it' );
	const bs = w.naval.ships.find( ( s ) => s.bounty );
	ok( bs && bs.captain === 'Gully Marrow', 'the captain\'s ship is afloat' );
	// bring her to us
	bs.x = 0;
	bs.z = 520;
	bs.yaw = 0;
	bs.speed = 0;
	bs.state = 'dock';
	cripple( w, bs, 0.2 );
	step( w );
	step( w );
	ok( bs.state === 'adrift', 'the bounty ship is crippled' );
	w.input.press( 'KeyB' );
	run( w, 1.2 );
	await tick();
	fight( w, { seconds: 150 } );
	ok( w.boarding.phase === 'surrender' && w.boarding.deal.bounty && w.boarding.deal.reward === 900, 'bounty surrender: the deal knows the contract pays $900' );
	ok( /x1\.5/.test( w.boarding.view().choice.options[ 0 ].sub ) && /1350/.test( w.boarding.view().choice.options[ 0 ].sub ), 'the choice says: bounty x1.5, about $1350' );
	w.input.press( 'Digit1' );
	step( w );
	run( w, 0.7 );
	const pr = w.boarding.prisoners[ 0 ];
	ok( pr && pr.data.bountyId === 'home:0:0' && pr.data.target === 'Gully Marrow, the Tide Rat' && pr.data.bountyInfo && pr.data.bountyInfo.region, 'a bounty prisoner carries the contract' );
	ok( evs( w, 'shipSunk' ).length === 0, 'no shipSunk yet: the claim waits for the hand-over' );
	ok( ! w.naval.bounties.has( 'home:0:0' ) && bs.state === 'sinking', 'naval forgets the contract (the ship will not respawn) and she goes down' );
	ok( n.active.length === 1, 'the notice is still open' );
	run( w, 0.7 );
	ok( /\$1350/.test( w.player.mode === 'deck' ? w.boarding._handOverPrompt( 'home' ) : '' ), 'the hand-over prompt shows $1350' );

	// save and load a prisoner with a bounty
	const save = JSON.parse( JSON.stringify( w.boarding.toJSON() ) );
	const w2 = makeWorld( { notices: true } );
	w2.boarding.fromJSON( save );
	ok( w2.boarding.prisoners.length === 1 && w2.boarding.prisoners[ 0 ].data.bountyId === 'home:0:0' && w2.boarding.prisoners[ 0 ].data.value === pr.data.value, 'the prisoner survives the save' );

	const money = w.state.money;
	const res = w.boarding.handOver( 'pons' );
	ok( res && res.total === 1350 && res.count === 1, `hand-over pays ${ res && res.total } (900 + the other half)` );
	ok( w.state.money === money + 1350, `money +$1350 (notices ${ 900 } + boarding ${ 450 })` );
	const cap = evs( w, 'bountyCaptured' );
	ok( cap.length === 1 && cap[ 0 ].target === 'Gully Marrow, the Tide Rat' && cap[ 0 ].id === 'home:0:0' && cap[ 0 ].reward === 1350, 'bountyCaptured { target, id, reward }' );
	const sunk = evs( w, 'shipSunk' );
	ok( sunk.length === 1 && sunk[ 0 ].target === 'Gully Marrow, the Tide Rat' && sunk[ 0 ].bountyId === 'home:0:0' && sunk[ 0 ].faction === 'pirate' && sunk[ 0 ].byPlayer === true, 'shipSunk { target, faction: pirate, byPlayer } for the notices' );
	ok( n.active.length === 0 && evs( w, 'bountyClaimed' ).length === 1 && n.stats.bounties === 1, 'the notice board claimed the bounty' );
	ok( w.boarding.prisoners.length === 0 && w.boarding.stats.ransomTotal === 1350, 'ledger' );
	ok( evs( w, 'prisonerRansomed' )[ 0 ].port === 'pons', 'ransom accepted at Pons too' );

}

// ================================================================ 10. escape
section( 'escape' );
{

	const w = makeWorld( { notices: true } );
	const mk = ( name, bountyId = null, info = null ) => new Prisoner( { id: name, name, value: 240, tier: 1, kind: 'sloop', ship: 's', character: 'bravile', bountyId, target: bountyId ? 'Tgt' : null, bountyInfo: info }, avatarFactory( { character: 'bravile' } ) );
	const a = mk( 'Ann' ), b = mk( 'Bo' );
	w.boarding.prisoners.push( a, b );
	w.boarding.rng = () => 0.9;
	w.features.emit( 'playerKnockedDown', { by: 'Raider' } );
	ok( w.boarding.prisoners.length === 2, 'a lucky roll (0.9 >= 0.65): they stay bound' );
	let r = 0.1;
	w.boarding.rng = () => r;
	w.features.emit( 'playerKnockedDown', { by: 'Raider' } );
	ok( w.boarding.prisoners.length === 0 && evs( w, 'prisonerEscaped' ).length === 2 && w.boarding.stats.escaped === 2, 'an unlucky roll: both escape' );
	ok( a.avatar === null && b.avatar === null, 'their avatars are gone' );
	ok( w.toasts.some( ( t ) => /slipped his bonds/.test( t ) ), 'toast' );

	// an escaped bounty captain is announced again and naval spawns him
	const info = { id: 'home:0:0', target: 'Gully Marrow, the Tide Rat', captain: 'Gully Marrow', tier: 2, ship: 'Rusty Gull', region: { x: 0, z: 900 }, port: 'home', expires: 60 };
	w.boarding.prisoners.push( mk( 'Gully Marrow', 'home:0:0', info ) );
	const before = evs( w, 'bountyAccepted' ).length;
	w.features.emit( 'playerKnockedDown', { by: 'Raider' } );
	const again = evs( w, 'bountyAccepted' ).slice( before );
	ok( again.length === 1 && again[ 0 ].resumed === true && again[ 0 ].id === 'home:0:0', 'the escaped bounty captain is re-announced (bountyAccepted, resumed)' );
	ok( w.naval.bounties.has( 'home:0:0' ), 'naval takes the contract back' );

	// a lapsed bounty makes him worth only the ransom
	w.boarding.prisoners.push( mk( 'Gully Marrow', 'home:0:1', info ) );
	w.features.emit( 'bountyCancelled', { id: 'home:0:1', target: 'Gully Marrow', reason: 'expired' } );
	ok( w.boarding.prisoners[ 0 ].data.bountyId === null && w.boarding._payout( w.boarding.prisoners[ 0 ] ).base === 240, 'a cancelled bounty: the prisoner is worth the plain ransom' );

}

// ================================================================ 11. defeat, retreat, aborts
section( 'defeat, retreat, abort' );
{

	// lose the fight
	const w = makeWorld( { notices: false } );
	const s = addSloop( w );
	cripple( w, s );
	step( w );
	w.boarding.prisoners.push( new Prisoner( { id: 'p', name: 'Pip', value: 240, tier: 1, kind: 'sloop', ship: 's', character: 'bravile' }, avatarFactory( { character: 'bravile' } ) ) );
	w.boarding.rng = () => 0.9; // the prisoner stays
	w.input.press( 'KeyB' );
	run( w, 1.2 );
	await tick();
	ok( w.boarding.phase === 'fight', 'in the fight' );
	// really get beaten: do nothing, with low hp
	w.melee.combat.hp = 20;
	run( w, 20, () => w.melee.playerDown ? false : true );
	ok( w.melee.playerDown || w.boarding.phase === 'idle', 'the crew knock the player down' );
	run( w, 0.1 );
	ok( w.boarding.phase === 'idle' && w.boarding.ship === null, 'the boarding ends at once (defeat)' );
	ok( w.calls.includes( 'boatReset' ), 'the boat is towed home' );
	ok( s.alive && s.state === 'flee' && s.repelled === true, 'the pirates sail off (fleeing)' );
	ok( w.boarding.crew.every( ( r ) => ! r.active ), 'the crew are stood down' );
	ok( w.boarding.prisoners.length === 1, 'the prisoner survived the lucky roll' );
	ok( w.melee.movePlayer === Object.getPrototypeOf( w.melee ).movePlayer, 'melee\'s evade restored' );
	ok( evs( w, 'boardingEnded' ).some( ( e ) => e.outcome === 'repelled' ) && w.boarding.stats.repelled === 1, 'boardingEnded { repelled }' );
	step( w );
	ok( s.state !== 'adrift', 'a repelled ship does not strike her colours again at once' );

	// retreat
	const r = makeWorld( { notices: false } );
	const s2 = addSloop( r );
	cripple( r, s2 );
	step( r );
	r.input.press( 'KeyB' );
	run( r, 1.2 );
	await tick();
	ok( r.boarding.phase === 'fight', 'second boarding: in the fight' );
	// kill one crew
	let t = 0;
	run( r, 60, () => {

		t += DT;
		r.melee.combat.hp = 100;
		r.player.stamina = 1;
		const live = r.boarding.crew.filter( ( q ) => q.active && q.targetable );
		if ( r.boarding.crewDown >= 1 || ! live.length ) return false;
		const q = live[ 0 ];
		r.input.mouseDown = false;
		r.player.yaw = yawToward( r.player.position.x, r.player.position.z, q.x, q.z );
		const dd = Math.hypot( q.x - r.player.position.x, q.z - r.player.position.z );
		if ( dd > 1.8 ) { r.player.position.x += ( q.x - r.player.position.x ) / dd * 2.7 * DT; r.player.position.z += ( q.z - r.player.position.z ) / dd * 2.7 * DT; } else if ( Math.floor( t / 0.8 ) !== Math.floor( ( t - DT ) / 0.8 ) ) r.input.mouseDown = true;
		return true;

	} );
	r.input.mouseDown = false;
	ok( r.boarding.crewDown === 1 && s2.boarding.crewLeft === 1, 'one crew down, one left on the ship record' );
	r.input.press( 'KeyB' );
	step( r );
	ok( r.boarding.phase === 'ret-out', 'B retreats to the boat' );
	run( r, 1.2 );
	ok( r.boarding.phase === 'idle' && r.player.mode === 'deck' && s2.state === 'adrift' && s2.alive, 'back on the boat; she lies adrift again' );
	ok( r.boat.moored === false, 'the boat is free' );
	step( r );
	ok( r.boarding.offer === s2 && /1 crew/.test( r.boarding.view().prompt ), 'offered again, with one crew left' );
	r.input.press( 'KeyB' );
	run( r, 1.2 );
	await tick();
	ok( r.boarding.phase === 'fight' && r.boarding.crew.filter( ( q ) => q.active ).length === 1, 'the second crossing meets only the survivor' );

	// the ship sinks under the boarders
	const a = makeWorld( { notices: false } );
	const s3 = addSloop( a );
	cripple( a, s3 );
	step( a );
	a.input.press( 'KeyB' );
	run( a, 1.2 );
	await tick();
	s3.startSinking();
	step( a );
	ok( a.boarding.phase === 'idle' && a.player.mode === 'deck' && a.boat.moored === false, 'the ship sunk by another: abort, back to the boat, boat free' );
	ok( evs( a, 'boardingEnded' ).some( ( e ) => e.outcome === 'aborted' ), 'boardingEnded { aborted }' );

	// the player's boat sinks mid-crossing
	const c = makeWorld( { notices: false } );
	const s4 = addSloop( c );
	cripple( c, s4 );
	step( c );
	c.input.press( 'KeyB' );
	run( c, 1.2 );
	await tick();
	c.features.emit( 'playerBoatSunk', { cause: 'fire' } );
	ok( c.boarding.phase === 'idle' && c.boarding.crew.every( ( q ) => ! q.active ) && s4.state === 'adrift', 'the boat sinks: boarding ends cleanly, ship stays adrift' );

	// the player leaves walk mode on her deck (a shove, a swim): abort
	const d = makeWorld( { notices: false } );
	const s5 = addSloop( d );
	cripple( d, s5 );
	step( d );
	d.input.press( 'KeyB' );
	run( d, 1.2 );
	await tick();
	d.player.mode = 'swim';
	step( d );
	ok( d.boarding.phase === 'idle', 'leaving walk mode aborts the boarding' );

	// E on deck away from the helm also boards
	const e = makeWorld( { notices: false } );
	const s6 = addSloop( e );
	cripple( e, s6 );
	e.player.mode = 'deck';
	e.player.prompt = { key: 'E', text: 'Take the helm' };
	step( e );
	e.input.press( 'KeyE' );
	step( e );
	ok( e.boarding.phase === 'idle', 'E at the helm prompt does not board' );
	e.player.prompt = null;
	e.input.press( 'KeyE' );
	step( e );
	ok( e.boarding.phase === 'cross-out', 'E on deck with nothing else to do boards' );

	// no melee: the crew give up at once
	const f = makeWorld( { melee: false, notices: false } );
	const s7 = addSloop( f );
	cripple( f, s7 );
	step( f );
	f.input.press( 'KeyB' );
	run( f, 1.2 );
	ok( f.boarding.phase === 'surrender', 'without the melee feature there is no crew: straight to the surrender' );
	f.input.press( 'Digit2' );
	step( f );
	run( f, 0.7 );
	ok( f.boarding.phase === 'idle' || f.boarding.phase === 'ret-in', 'and the plunder works' );

	// without naval nothing is offered and nothing throws
	const g = makeWorld( { naval: false, notices: false } );
	run( g, 1 );
	ok( g.boarding.phase === 'idle' && g.boarding.offer === null, 'without the naval feature the module idles' );

	// multiplayer mode (naval inactive)
	const h = makeWorld( { notices: false } );
	const s8 = addSloop( h );
	cripple( h, s8 );
	step( h );
	h.app.mode = 'multiplayer';
	step( h );
	ok( h.boarding.offer === null, 'in multiplayer (ships are local) nothing is offered' );

	// paused: nothing runs
	const p = makeWorld( { notices: false } );
	const s9 = addSloop( p );
	cripple( p, s9 );
	step( p );
	p.app.paused = true;
	p.input.press( 'KeyB' );
	run( p, 1 );
	ok( p.boarding.phase === 'idle', 'paused: no crossing' );

}

// ================================================================ 12. save, reset, junk
section( 'save' );
{

	const w = makeWorld( { notices: false } );
	const data = { id: 's1', name: 'Mad Meg Orrow', ship: 'Black Gull', kind: 'sloop', tier: 1, value: 255, character: 'bravile', bountyId: null, target: null, bountyInfo: null };
	w.boarding.prisoners.push( new Prisoner( { ...data }, avatarFactory( { character: 'bravile' } ) ) );
	w.boarding.stats.boarded = 3;
	const j = JSON.parse( JSON.stringify( w.features.toJSON() ) );
	ok( j.boarding && j.boarding.v === 1 && j.boarding.prisoners.length === 1 && j.boarding.stats.boarded === 3, 'features.toJSON carries a "boarding" section' );
	const w2 = makeWorld( { notices: false } );
	w2.features.fromJSON( j );
	w2.boarding.fromJSON( j.boarding );
	ok( w2.boarding.prisoners.length === 1 && w2.boarding.prisoners[ 0 ].name === 'Mad Meg Orrow' && w2.boarding.prisoners[ 0 ].data.value === 255 && w2.boarding.stats.boarded === 3, 'round trip: prisoner and stats' );
	ok( w2.boarding.prisoners[ 0 ].avatar && w2.boarding.prisoners[ 0 ].avatar.character === 'bravile', 'the prisoner gets his avatar back' );
	run( w2, 0.2 );
	ok( w2.boarding.prisoners[ 0 ].avatar.poses.length > 0, 'and is driven again' );
	let threw = false;
	for ( const junk of [ null, 5, 'x', [], { prisoners: 'no' }, { prisoners: [ null, 3, { name: 5 }, { name: 'A', value: 'lots', tier: 99, character: 'hacker', kind: 'galleon' } ] }, { stats: { boarded: - 4, captured: 'many' } } ] ) {

		try { w2.boarding.fromJSON( junk ); } catch ( e ) { threw = true; console.log( e ); }

	}

	ok( ! threw, 'junk save data does not throw' );
	w2.boarding.fromJSON( { prisoners: [ { name: 'A', value: 'lots', tier: 99, character: 'hacker', kind: 'galleon' }, { name: 'B' }, { name: 'C' } ] } );
	const a = w2.boarding.prisoners;
	ok( a.length === RULES.maxPrisoners && a[ 0 ].data.tier === 3 && a[ 0 ].data.kind === 'sloop' && a[ 0 ].data.character === 'heptyle' && a[ 0 ].data.value === 240, 'values are clamped and defaulted, at most two prisoners' );
	w2.boarding.reset();
	ok( w2.boarding.prisoners.length === 0 && w2.boarding.stats.boarded === 0 && w2.boarding.phase === 'idle', 'reset: a new game' );
	// reset during a boarding
	const r = makeWorld( { notices: false } );
	const s = addSloop( r );
	cripple( r, s );
	step( r );
	r.input.press( 'KeyB' );
	run( r, 1.2 );
	await tick();
	r.boarding.reset();
	ok( r.boarding.phase === 'idle' && r.boat.moored === false && r.boarding.crew.every( ( q ) => ! q.active ), 'reset in the middle of a boarding stands everything down' );

}

// ================================================================ 13. HUD with a fake DOM
section( 'HUD' );
{

	class El {

		constructor( tag ) {

			this.tag = tag;
			this.children = [];
			this.style = {};
			this._cls = new Set();
			this.className = '';
			this._html = '';
			this.handlers = {};
			this.classList = { add: ( c ) => this._cls.add( c ), remove: ( c ) => this._cls.delete( c ), toggle: ( c, on ) => { if ( on === undefined ? ! this._cls.has( c ) : on ) this._cls.add( c ); else this._cls.delete( c ); }, contains: ( c ) => this._cls.has( c ) };

		}

		set innerHTML( v ) {

			this._html = v;
			if ( v === '' || v ) this.children = [];

		}

		get innerHTML() {

			return this._html;

		}

		append( ...els ) {

			this.children.push( ...els );

		}

		remove() {

			this.removed = true;

		}

		addEventListener( n, f ) {

			this.handlers[ n ] = f;

		}

	}

	const doc = { createElement: ( t ) => new El( t ), head: new El( 'head' ) };
	const hudEl = new El( 'div' );
	const hud = new BoardingHud( { hud: hudEl, doc } );
	ok( hud.enabled && hudEl.children.length === 1 && doc.head.children.length === 1, 'builds its DOM (one root, one stylesheet)' );
	hud.update( 0.016, { prompt: '<kbd>B</kbd>Board the Gull', choice: null, fade: 0, prisoners: [] } );
	ok( hud.promptEl.classList.contains( 'is-on' ) && /Board the Gull/.test( hud.promptEl.innerHTML ), 'prompt shows' );
	hud.update( 0.016, { prompt: '', choice: null, fade: 0.5, prisoners: [ { name: '<b>Evil</b>' } ] } );
	ok( ! hud.promptEl.classList.contains( 'is-on' ) && hud.fadeEl.style.opacity === '0.500', 'prompt hides, fade applied' );
	ok( hud.countEl.classList.contains( 'is-on' ) && /Prisoner/.test( hud.countEl.innerHTML ) && ! /<b>Evil/.test( hud.countEl.innerHTML.replace( '<b>1</b>', '' ) ), 'prisoner counter, names escaped' );
	let chosen = - 1;
	hud.onChoose = ( i ) => { chosen = i; };
	const choice = { title: 'Meg surrenders', lines: [ 'a', 'b' ], options: [ { key: '1', label: 'Take prisoner', sub: 'x' }, { key: '2', label: 'Plunder', sub: 'y', disabled: true } ] };
	hud.update( 0.016, { prompt: '', choice, fade: 0, prisoners: [] } );
	ok( hud.choiceEl.classList.contains( 'is-on' ) && hud.choiceEl.children.length === 2, 'choice panel with two buttons' );
	hud.choiceEl.children[ 0 ].handlers.click();
	hud.choiceEl.children[ 1 ].handlers.click();
	ok( chosen === 0, 'clicking the first chooses it; a disabled button does nothing' );
	hud.update( 0.016, { prompt: '', choice: null, fade: 0, prisoners: [] } );
	ok( ! hud.choiceEl.classList.contains( 'is-on' ), 'choice hides' );
	hud.dispose();
	ok( hud.root === null && ! hud.enabled, 'dispose' );
	const none = new BoardingHud( {} );
	ok( ! none.enabled && none.update( 0, { prompt: '', choice: null, prisoners: [] } ) === undefined, 'headless: a no-op' );

	// the module with a DOM
	const w = makeWorld( { notices: false, options: { hud: true, doc, hudElement: hudEl } } );
	ok( w.boarding.hud && w.boarding.hud.enabled, 'the module builds its HUD from app.ui or options.hudElement' );
	run( w, 0.1 );
	w.boarding.dispose();
	ok( true, 'dispose with a HUD' );

}

// ================================================================ 14. the registry
section( 'registry' );
{

	const w = makeWorld( { notices: false } );
	const s = addSloop( w );
	cripple( w, s );
	// a throwing step must not stop the frame (Features catches), and the module recovers its state on abort
	step( w );
	w.boarding.board( s );
	w.boarding.ship = null; // corrupt it
	let threw = false;
	try { run( w, 1 ); } catch ( e ) { threw = true; }
	ok( ! threw, 'Features.update contains a failing update' );
	const k = makeWorld( { notices: false } );
	ok( k.features.list.has( 'boarding' ) && typeof k.features.list.get( 'boarding' ).instance.update === 'function', 'listed' );
	k.features.dispose();
	ok( k.features.list.size === 0, 'Features.dispose disposes the module' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
if ( fails ) process.exit( 1 );
