// Plain-node test of hostile boarding (src/features/boarding/Hostile.js): the boarding roll, close-to-board steering, grappling,
// tearing free, the boarded panel (repel / ransom, keys 1 / 2 through Boarding's input), the repel fight both ways, the overrun
// losses, the auto-choice, aborts, and the pirates feature booking the outcome.
// Real: Features, Naval (no models, no HUD, no auto spawn), Boarding (hud off), Pirates, GameState, TerrainData. Stubs: player, boat, trade.
//   node test/feature-boarding-hostile.mjs
import { Vector3, Quaternion, PerspectiveCamera } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import { Naval } from '../src/features/naval/Naval.js';
import * as boardingModule from '../src/features/boarding/index.js';
import { HOSTILE } from '../src/features/boarding/index.js';
import * as piratesModule from '../src/features/pirates/index.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const DT = 1 / 30;
const terrain = new TerrainData();

class FakeInput {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.mouseDown = false; this.rightDown = false; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	press( c ) { this.pressed.add( c ); }
	endFrame() { this.pressed.clear(); }

}

function makeWorld( o = {} ) {

	const events = [], toasts = [], taken = [];
	const state = new GameState( { getItem: () => null, setItem: () => {} } );
	state.boat = 'lobster';
	state.money = o.money ?? 3000;
	const player = { mode: 'boat', position: new Vector3( 0, 1, 520 ), velocity: new Vector3(), yaw: 0, stamina: 1, prompt: null, busy: false, leaveHelm() {} };
	const boat = {
		position: new Vector3( 0, 0, 520 ), quaternion: new Quaternion(), velocity: new Vector3( 0, 0, 1 ), speed: 1, driven: true, moored: false,
		getYaw() { return 0; }, toWorld( l, out ) { return out.copy( l ).add( this.position ); }, reset() {},
	};
	const app = {
		player, input: new FakeInput(), boatCtl: boat, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), scene: { add() {}, remove() {} },
		game: { state, rod: { equipped: false, equip() {} }, toast: ( t ) => toasts.push( t ), cancelLine() {} },
		terrainData: terrain, colliders: new Colliders(), settings: { timeOfDay: 12, timeSpeed: 0 }, mode: 'campaign', paused: false,
		avatar: { character: 'hyptile' }, ui: null, cameraFeel: { kick() {} },
	};
	const features = new Features( app );
	for ( const n of [ 'hostileBoarding', 'boardersRepelled', 'boardersWon', 'ransomPaid', 'grappleBroken', 'playerBoatDamaged' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	features.add( 'trade', { install: () => ( {
		cargo: { rum: { qty: 4 }, rope: { qty: 2 } },
		addCargo() { return 0; },
		takeCargo( good, qty ) { const c = this.cargo[ good ]; const n = Math.min( qty, c ? c.qty : 0 ); if ( c ) c.qty -= n; taken.push( { good, n } ); return { qty: n, paid: 0 }; },
	} ) } );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const boarding = features.add( 'boarding', { install: ( a, f ) => boardingModule.install( a, f, { hud: false, seed: 11, avatarFactory: () => ( { update() {}, dispose() {} } ) } ) } );
	const pirates = o.pirates === false ? null : features.add( 'pirates', { install: ( a, f ) => piratesModule.install( a, f, { seed: 3, hud: false } ) } );
	return { app, features, player, boat, state, naval, boarding, pirates, hostile: boarding.hostile, events, toasts, taken };

}

const evs = ( w, name ) => w.events.filter( ( e ) => e[ 0 ] === name ).map( ( e ) => e[ 1 ] );
// the hostile logic alone (the ships do not sail: deterministic positions)
const tick = ( w, seconds ) => { for ( let i = 0, n = Math.max( 1, Math.round( seconds / DT ) ); i < n; i ++ ) w.hostile.update( DT ); };

function pirate( w, { x = - 100, z = 520, state = 'chase', must = true, kind = 'sloop' } = {} ) {

	const s = w.naval.spawn( kind, { x, z, yaw: 0 } );
	s.state = state;
	s.mustBoard = must;
	return s;

}

// alongside: her hull 3-4 m off the boat
const alongside = ( w, s ) => { s.x = w.boat.position.x - 6; s.z = w.boat.position.z; s.yaw = 0; };

function toBoarded( w, s ) {

	tick( w, 1.1 );
	alongside( w, s );
	w.boat.speed = 1;
	tick( w, 0.1 );
	tick( w, HOSTILE.grappleTime + 0.1 );

}

section( 'the boarding roll and closing' );
{

	const w = makeWorld();
	const h = w.hostile;
	ok( h && h.phase === 'idle', 'boarding.hostile exists, idle' );
	const s = pirate( w, { must: false } );
	ok( Math.abs( h._odds( s ) - ( HOSTILE.base + HOSTILE.unarmed ) ) < 1e-9, 'an unarmed boat: base + unarmed odds' );
	s.traits = [ 'boarder' ];
	ok( h._odds( s ) > 0.85, 'a boarder captain nearly always tries' );
	s.mustBoard = true;
	ok( h._odds( s ) === 1, 'a retaliation raid always does' );
	tick( w, 1.1 );
	ok( s.state === 'close' && h.stats.attempts === 1, 'she breaks off the gunnery to close and board (state close)' );
	const bearing = Math.atan2( w.boat.position.x - s.x, w.boat.position.z - s.z );
	ok( Math.abs( s.want - bearing ) < 0.3 && s.wantSpeed === 1, 'she steers for the boat at full sail' );
	// a far ship does not roll
	const far = pirate( w, { x: - 400, must: true } );
	tick( w, 1.1 );
	ok( far.state === 'chase' && ! far._boardRolled, 'beyond the choose range nothing happens' );
	// one roll per engagement
	const s2 = pirate( w, { x: 80, must: false } );
	s2.traits = [];
	h.rng = () => 0.999;
	tick( w, 1.1 );
	ok( s2.state === 'chase' && s2._boardRolled, 'a failed roll is not repeated every second' );
	// moored boat: no boarding, closing ships go back to the guns
	w.boat.moored = true;
	tick( w, 0.1 );
	ok( s.state === 'chase', 'a moored boat is left alone (closing ships fall back)' );

}

section( 'grapple and tearing free' );
{

	const w = makeWorld();
	const h = w.hostile;
	const s = pirate( w );
	tick( w, 1.1 );
	alongside( w, s );
	w.boat.speed = 8;
	tick( w, 0.1 );
	ok( h.phase === 'idle', 'a fast boat cannot be grappled' );
	w.boat.speed = 2;
	tick( w, 0.1 );
	ok( h.phase === 'grapple' && h.ship === s && s.state === 'grapple', 'alongside and slow: grappling hooks' );
	w.boat.speed = HOSTILE.breakSpeed + 1;
	tick( w, 0.1 );
	ok( h.phase === 'idle' && s.state === 'chase' && evs( w, 'grappleBroken' ).length === 1 && s._boardCool > 0, 'open the throttle: the lines part, she falls back' );

}

section( 'boarded: ransom through the keys' );
{

	const w = makeWorld();
	const h = w.hostile;
	const s = pirate( w );
	toBoarded( w, s );
	ok( h.phase === 'boarded' && s.state === 'boarding' && evs( w, 'hostileBoarding' ).length === 1, 'boarded: hostileBoarding emitted' );
	const v = h.view();
	ok( v.choice && v.choice.options.length === 2 && /Repel/.test( v.choice.options[ 0 ].label ) && /Pay \$\d+/.test( v.choice.options[ 1 ].label ), 'the panel: 1 Repel boarders / 2 Pay' );
	const want = h.ransomFor( s ), m0 = w.state.money;
	ok( want > 0 && h.canPay( s ), `ransom asked: $${ want }` );
	w.app.input.press( 'Digit2' );
	w.features.update( DT );
	w.app.input.endFrame();
	const r = evs( w, 'ransomPaid' );
	ok( r.length === 1 && r[ 0 ].amount === want && w.state.money === m0 - want, 'key 2 pays the ransom' );
	ok( h.phase === 'idle' && s.state === 'regroup', 'they cast off to regroup (the pirates feature steers it)' );
	ok( w.pirates.ledger.counts.ransoms === 1 && w.pirates.wanted.standing > 0, 'the pirates ledger books the ransom; the corsairs like it' );
	// broke: cannot pay
	const w2 = makeWorld( { money: 0 } );
	const s2 = pirate( w2 );
	toBoarded( w2, s2 );
	ok( ! w2.hostile.canPay( s2 ) && w2.hostile.view().choice.options[ 1 ].disabled && ! w2.hostile.choose( 1 ), 'no money: the ransom is greyed out' );

}

section( 'repel: winning and losing' );
{

	const w = makeWorld();
	const h = w.hostile;
	const s = pirate( w, { kind: 'brigantine' } );
	toBoarded( w, s );
	const hp0 = s.hp, n = h.boarders;
	ok( n === 3, 'a brigantine sends 3 boarders' );
	w.app.input.press( 'Digit1' );
	w.features.update( DT );
	w.app.input.endFrame();
	ok( h.phase === 'fight', 'key 1: repel' );
	const st0 = w.player.stamina;
	ok( h.rally() && w.player.stamina < st0 && h.rallyLevel > 0, 'rally costs stamina and lifts your side' );
	const o0 = h.odds( s );
	h.rallyLevel = 0;
	ok( o0 > h.odds( s ), 'odds include the rally' );
	h.rng = () => 0; // every exchange goes your way
	tick( w, HOSTILE.tick * ( n + 1 ) );
	const rep = evs( w, 'boardersRepelled' );
	ok( rep.length === 1 && h.phase === 'idle' && s.hostileRepelled, 'boarders repelled' );
	ok( s.hp < hp0 && s.state === 'regroup', 'she loses hull with her boarders and runs to regroup' );
	ok( w.pirates.ledger.counts.repelled === 1, 'booked in the pirates ledger' );
	// losing
	const w2 = makeWorld( { money: 2000 } );
	const h2 = w2.hostile;
	const s2 = pirate( w2 );
	toBoarded( w2, s2 );
	h2.choose( 0 );
	h2.rng = () => 0.999;
	const hull0 = w2.naval.playerHull.hp;
	tick( w2, HOSTILE.tick * ( HOSTILE.playerHits + 1 ) );
	const won = evs( w2, 'boardersWon' );
	ok( won.length === 1 && won[ 0 ].coins > 0 && w2.state.money === 2000 - won[ 0 ].coins, `overrun: they take $${ won[ 0 ] && won[ 0 ].coins }` );
	ok( w2.taken.length >= 1 && won[ 0 ].goods.length >= 1, 'and cargo from the hold' );
	ok( w2.naval.playerHull.hp < hull0 && ! w2.naval.playerHull.sunk, 'the boat is knocked about but not sunk by it' );
	ok( s2.state === 'regroup' && h2.phase === 'idle', 'they leave' );

}

section( 'auto choice, aborts, without the pirates feature' );
{

	const w = makeWorld( { pirates: false } );
	const h = w.hostile;
	const s = pirate( w );
	toBoarded( w, s );
	tick( w, HOSTILE.chooseTime + 0.1 );
	ok( h.phase === 'fight', 'no choice in time: you fight' );
	s.startSinking();
	tick( w, 0.1 );
	ok( h.phase === 'idle' && h.ship === null, 'her ship goes down mid-fight: it ends' );
	const sa = pirate( w, { x: 70 } );
	toBoarded( w, sa );
	sa.state = 'adrift';
	tick( w, 0.1 );
	ok( h.phase === 'idle' && sa.state === 'adrift', 'she strikes her colours mid-boarding: it ends, she stays adrift for your own boarding' );
	const s2 = pirate( w, { x: 60 } );
	toBoarded( w, s2 );
	h.choose( 1 );
	ok( s2.state === 'chase', 'without the pirates feature they go back to the chase' );
	// boarding (the player's own) in progress: no hostile scan
	const s3 = pirate( w, { x: 50 } );
	w.boarding.phase = 'fight';
	tick( w, 1.1 );
	ok( s3.state === 'chase', 'no hostile boarding while the player is boarding a ship' );
	w.boarding.phase = 'idle';
	// opts.hostile = false
	const app2 = { ...w.app };
	const f2 = new Features( app2 );
	const b2 = f2.add( 'boarding', { install: ( a, f ) => boardingModule.install( a, f, { hud: false, hostile: false } ) } );
	ok( b2 && b2.hostile === null, 'install option hostile: false turns it off' );
	w.boarding.reset();
	ok( h.phase === 'idle', 'boarding.reset resets it' );
	w.features.dispose();
	ok( w.boarding.hostile === null, 'disposed with boarding' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
