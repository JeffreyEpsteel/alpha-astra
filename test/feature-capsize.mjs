// Plain-node test of wave 22B, capsizing and righting (src/features/capsize, BoatController's CAPSIZE rule): which hulls stay
// over, the righting minigame's maths (timing, weather, crew help, success / slip, stamina), the feature with the real
// Player and BoatController on analytic water (thrown in, the gear, E at the hull, the climb onto the keel, the pull with
// the real input, she comes up with water in her, the bilge and the pump, slipping off, letting go, an unpatched Player's
// "Board boat" ending on the keel too), the breath under her hull (death feature), the save round trip with a capsized boat
// and the multiplayer events (another player helping pull). No DOM, no GPU.
//   node test/feature-capsize.mjs
import './headless.mjs';
import * as E from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Player } from '../src/player/Player.js';
import { BoatController, CAPSIZE, isSmallHull } from '../src/player/BoatController.js';
import { createBoatModel } from '../src/world/boat/BoatFactory.js';
import { BOATS, BOAT_IDS } from '../src/game/Boats.js';
import { GameState } from '../src/game/GameState.js';
import { Features } from '../src/features/Features.js';
import { Flood } from '../src/features/naval/Flood.js';
import * as capsizeModule from '../src/features/capsize/index.js';
import { Capsize, SWAMP, HELP, RIGHTING, Righting, roughness, autoHold } from '../src/features/capsize/index.js';
import * as deathModule from '../src/features/death/index.js';
import { capsizeButtons } from '../src/ui/TouchControls.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const f1 = ( v ) => Number( v ).toFixed( 1 );
const DEG = Math.PI / 180;

class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	press( c ) { this.pressed.add( c ); }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

const terrain = new TerrainData();
const colliders = { boxes: [], groundHeightAt: () => - Infinity, resolveCapsule: () => false };
const SEA = new E.Vector3( 300, 0, 900 );
const store = () => { const m = new Map(); return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ) }; };

function makeQuery( swell = null ) {

	const q = {
		n: 0, points: new Float32Array( 8192 ), cpu: new Float32Array( 8192 ), resultInputs: new Float32Array( 8192 ), cpuValid: false, version: 0, resultTime: 0, latency: 2 / 60, time: 0,
		allocate( name, n ) { const s = this.n; this.n += n; return s; },
		setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
		tick() {

			for ( let i = 0; i < this.n; i ++ ) {

				const x = this.points[ i * 4 ], z = this.points[ i * 4 + 1 ];
				this.cpu[ i * 4 ] = swell ? swell( x, z, this.time ) : 0;
				this.cpu[ i * 4 + 1 ] = 0; this.cpu[ i * 4 + 2 ] = 0;
				this.resultInputs[ i * 4 ] = x; this.resultInputs[ i * 4 + 1 ] = z;

			}

			this.cpuValid = true; this.version ++; this.resultTime = this.time;

		},
	};
	return q;

}

const _s = new E.Vector3(), _u = new E.Vector3();
const heelOf = ( b ) => Math.abs( Math.atan2( _s.set( 1, 0, 0 ).applyQuaternion( b.quaternion ).y, _u.set( 0, 1, 0 ).applyQuaternion( b.quaternion ).y ) ) / DEG;

// a boat, the real Player, the features (capsize + death, a naval stand-in with the real Flood, a crew stand-in), a game
function rig( id = 'launch', { mode = 'campaign', crew = 0, net = null, swell = null } = {} ) {

	const query = makeQuery( swell );
	const model = createBoatModel( id );
	model.ready.catch( () => {} );
	const boat = new BoatController( { model, query, terrain, colliders } );
	boat.position.copy( SEA ); boat.mooring.anchor.copy( SEA ); boat.quaternion.identity(); boat.mooring.heading = 0; boat.moored = false;
	const input = new InputStub();
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	const player = new Player( { camera, input, terrain, colliders, query, boat } );
	const state = new GameState( store() );
	state.setMode( mode );
	state.boat = id;
	state.inventory = [ { species: 'snapper', kg: 2 }, { species: 'bass', kg: 1 } ];
	const toasts = [];
	const app = { mode, terrainData: terrain, colliders, input, player, boatCtl: boat, boatId: id, camera, settings: { timeSpeed: 0 },
		game: { state, toast: ( t ) => toasts.push( t ) }, netsync: net };
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'boatCapsized', 'boatRighted', 'rightingStarted', 'rightingSlipped', 'playerDied', 'breathLow', 'breathOut' ] ) features.on( n, ( e ) => events.push( { n, ...e } ) );
	const drops = [];
	const naval = { floodState: new Flood(), playerHull: { hp: 100, max: 100, sunk: false }, loot: { drop: ( x, z, v ) => drops.push( { x, z, v } ) } };
	features.list.set( 'naval', { module: null, instance: naval } );
	const hands = Array.from( { length: crew }, ( _, i ) => 'hand' + i );
	features.list.set( 'crew', { module: null, instance: { crew: { aboard: () => hands }, ctx: () => ( {} ) } } );
	const death = features.add( 'death', deathModule );
	const cap = features.add( 'capsize', capsizeModule );
	const dt = 1 / 60;
	const step = () => {

		query.time += dt;
		boat.queueQueries();
		boat.update( dt );
		query.tick();
		player.update( dt );
		features.update( dt );
		input.endFrame();

	};
	const run = ( sec, each = null ) => { for ( let t = 0; t < sec; t += dt ) { if ( each && each( t ) === false ) return t; step(); } return sec; };
	return { query, model, boat, input, player, state, app, features, events, toasts, naval, drops, death, cap, step, run, dt };

}

// ================================================================================================ 1. which hulls stay over
section( '1. which hulls stay capsized' );
{

	const small = BOAT_IDS.filter( ( id ) => isSmallHull( BOATS[ id ].mass, BOATS[ id ].length ) );
	ok( [ 'skiff', 'canoe', 'cutter', 'launch' ].every( ( id ) => small.includes( id ) ) && ! small.includes( 'lobster' ) && ! small.some( ( id ) => BOATS[ id ].kind === 'ship' ),
		`small hulls by mass / length (<= ${ CAPSIZE.mass } kg, <= ${ CAPSIZE.length } m): ${ small.join( ', ' ) }; the lobster boat and the ships keep their ballast` );
	for ( const id of [ 'skiff', 'canoe', 'cutter', 'launch', 'lobster' ] ) {

		const r = rig( id );
		const res = {};
		for ( const heel of [ 50, 120, 170 ] ) {

			r.boat.reset(); r.boat.position.copy( SEA ); r.boat.moored = false; r.boat.angular.set( 0, 0, 0 ); r.boat.velocity.set( 0, 0, 0 );
			r.boat.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), heel * DEG );
			for ( let t = 0; t < 20; t += r.dt ) { r.query.time += r.dt; r.boat.queueQueries(); r.boat.update( r.dt ); r.query.tick(); }
			res[ heel ] = { heel: heelOf( r.boat ), cap: r.boat.capsized, keel: r.boat.toWorld( new E.Vector3( 0, - r.boat.draft, 0 ), new E.Vector3() ).y };

		}

		if ( id === 'lobster' ) ok( ! r.boat.small && [ 50, 120, 170 ].every( ( h ) => res[ h ].heel < 5 && ! res[ h ].cap ), `the lobster boat rights herself from 50, 120 and 170 deg (ballast at every heel)` );
		else {

			ok( r.boat.small && res[ 50 ].heel < 5 && ! res[ 50 ].cap, `the ${ id } comes back from a 50 deg knock-down (ballast to ${ f1( CAPSIZE.keep / DEG ) } deg)` );
			ok( [ 120, 170 ].every( ( h ) => res[ h ].cap && res[ h ].heel > 165 ), `the ${ id } over at 120 / 170 deg stays hull up after 20 s (${ f1( res[ 120 ].heel ) } / ${ f1( res[ 170 ].heel ) } deg)` );
			ok( res[ 170 ].keel > 0.03 && res[ 170 ].keel < 0.5, `the ${ id }'s bottom floats out of the water (keel ${ res[ 170 ].keel.toFixed( 2 ) } m above it)` );

		}

	}

	// a 1 m beam sea (the harbour chop of 3af2572) does not turn a small hull over
	const k = 2 * Math.PI / 18, w = Math.sqrt( 9.81 * k );
	const r = rig( 'launch', { swell: ( x, z, t ) => 1.0 * Math.sin( k * x - w * t ) } );
	let max = 0;
	r.run( 30, () => { max = Math.max( max, heelOf( r.boat ) ); } );
	ok( ! r.boat.capsized && max < 60, `a 1 m beam sea rolls the launch ${ f1( max ) } deg at most and leaves her upright` );

}

// ================================================================================================ 2. the minigame
section( '2. the righting minigame' );
{

	const play = ( style, rough, helpers, seed ) => {

		const g = new Righting( { rough, helpers, seed } );
		let ev = null;
		for ( let i = 0; i < 60 * 90 && ! ev; i ++ ) ev = g.update( 1 / 60, { hold: autoHold( g, style ) } );
		return { ev, t: g.t, g };

	};
	const avg = ( style, rough, helpers ) => {

		const r = [ 1, 2, 3, 4, 5, 6 ].map( ( s ) => play( style, rough, helpers, s ) );
		const up = r.filter( ( x ) => x.ev === 'up' );
		return { up: up.length, n: r.length, t: up.length ? up.reduce( ( a, x ) => a + x.t, 0 ) / up.length : Infinity, slips: r.filter( ( x ) => x.ev === 'slipped' ).length };

	};
	const calm = avg( 'good', 0, 0 ), mid = avg( 'good', 0.5, 0 ), storm = avg( 'good', 1, 0 ), crew1 = avg( 'good', 0, 1 ), crew2 = avg( 'good', 0, 2 );
	ok( calm.up === calm.n && calm.t >= 10 && calm.t <= 25, `good timing in calm water: up every time in ${ f1( calm.t ) } s (10-25)` );
	ok( mid.up === mid.n && mid.t > calm.t && mid.t <= 25, `a moderate sea: ${ f1( mid.t ) } s` );
	ok( storm.t > mid.t, `rough weather is harder: ${ f1( storm.t ) } s, ${ storm.up }/${ storm.n } up` );
	ok( crew1.t < calm.t && crew2.t < crew1.t, `hands helping pull: ${ f1( crew1.t ) } s with one, ${ f1( crew2.t ) } s with two` );
	const g0 = new Righting( { rough: 0 } ), g1 = new Righting( { rough: 1 } ), gh = new Righting( { rough: 0, helpers: 2 } );
	ok( g1.half() < g0.half() && gh.half() > g0.half(), `the sweet spot narrows in a blow (${ g0.half().toFixed( 3 ) } -> ${ g1.half().toFixed( 3 ) }) and widens with helpers (${ gh.half().toFixed( 3 ) })` );
	const greedy = avg( 'greedy', 0, 0 ), off = avg( 'offbeat', 0, 0 ), idle = avg( 'idle', 0, 0 );
	ok( greedy.up === 0 && greedy.slips === greedy.n, 'holding on regardless (over-leaning): slips off every time' );
	ok( off.up === 0 && off.slips === off.n, 'pulling on a beat that ignores the swell: slips off' );
	ok( idle.up === 0 && idle.slips === 0, 'never pulling: nothing happens (no slip, she stays over)' );
	// the climb, stamina
	const g = new Righting( { seed: 3 } );
	g.update( 0.5, { hold: true } );
	ok( g.phase === 'climb' && g.heel === 0, 'the first RIGHTING.climb s are the climb (no pulling yet)' );
	for ( let i = 0; i < 40; i ++ ) g.update( 1 / 60, { hold: false } );
	const s0 = g.stamina;
	g.marker = 0; for ( let i = 0; i < 60; i ++ ) g.update( 1 / 60, { hold: true } );
	const s1 = g.stamina;
	for ( let i = 0; i < 60; i ++ ) g.update( 1 / 60, { hold: false } );
	ok( s1 < s0 && g.stamina > s1, `pulling drains stamina (${ s0.toFixed( 2 ) } -> ${ s1.toFixed( 2 ) }), resting brings it back (${ g.stamina.toFixed( 2 ) })` );
	const tired = new Righting( { seed: 4 } ); tired.phase = 'pull'; tired.stamina = 0; tired.marker = 0.5;
	tired.update( 0.1, { hold: true } );
	ok( ! tired.pulling && tired.marker < 0.5, 'with no stamina left holding does not pull (the marker falls)' );
	ok( roughness( null ) === 0 && roughness( { wind: 4 } ) === 0 && roughness( { wind: 16 } ) === 1 && Math.abs( roughness( { wind: 8, danger: 0.6 } ) - 0.6 ) < 1e-9, 'roughness from the weather (wind past a breeze, storm danger)' );

}

// ================================================================================================ 3. going over
section( '3. she goes over: the player in the water, the gear' );
{

	const r = rig( 'launch' );
	r.run( 1 );
	r.player.enterBoat();
	ok( r.player.mode === 'boat', 'at the helm' );
	r.boat.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), 120 * DEG );
	r.run( 3 );
	ok( r.boat.capsized && r.cap.capsized(), 'past the point of no return she is capsized' );
	ok( r.player.mode === 'swim', `the player is in the water (mode ${ r.player.mode })` );
	const ev = r.events.find( ( e ) => e.n === 'boatCapsized' );
	ok( ev && ev.aboard && ev.lost.fish === 2, `boatCapsized { aboard, lost: ${ JSON.stringify( ev && ev.lost ) } }` );
	ok( r.state.inventory.length === 0, 'the catch in the cooler swam off (campaign)' );
	ok( r.toasts.some( ( t ) => /turned turtle/.test( t ) ), 'a toast says so (no standing prompt)' );
	ok( ! r.boat.driven && r.boat.throttle === 0, 'the engine is drowned' );
	r.input.keys.add( 'KeyW' ); r.run( 1 ); r.input.keys.delete( 'KeyW' );
	ok( r.boat.capsized && r.player.mode !== 'boat' && r.player.mode !== 'deck', 'nobody gets back to the helm of an upturned hull' );
	const s = rig( 'skiff', { mode: 'sandbox' } );
	s.player.enterBoat(); s.boat.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), - 130 * DEG ); s.run( 3 );
	ok( s.boat.capsized && s.state.inventory.length === 2 && s.boat.capsizeSide === - 1, 'sandbox: she goes over (to port) and you keep the catch' );

}

// put a swimmer beside the upturned hull, facing her
function swimBeside( r, side = 1, out = 1.6 ) {

	const b = r.boat, yaw = b.getYaw();
	const d = b.model.dimensions;
	const ox = ( d.beam / 2 + out ) * side;
	r.player.mode = 'swim';
	r.player.floating = true;
	r.player.position.set( b.position.x + ox * Math.cos( yaw ), - 0.2, b.position.z - ox * Math.sin( yaw ) );
	r.player.velocity.set( 0, 0, 0 );

}

// ================================================================================================ 4. righting her
section( '4. E at the hull, the climb, the pull, she comes up' );
{

	const r = rig( 'launch' );
	r.boat.capsize( 1 );
	r.run( 2 );
	swimBeside( r, 1 );
	r.step();
	ok( r.player.prompt && r.player.prompt.key === 'E' && /^Right her/.test( r.player.prompt.text ), `beside her the prompt: "${ r.player.prompt && r.player.prompt.text }" (touch: the wide "Right her" button)` );
	ok( capsizeButtons( { righting: false } ).size === 0, 'no Let go button in the water' );
	r.input.press( 'KeyE' );
	r.step();
	ok( r.cap.game && r.player.mode === 'aboard' && r.player.hull === r.cap.hull, 'E: onto the hull (Player aboard her keel)' );
	ok( r.player.action === 'climbUp', 'the climb plays Climb_Pull (climbUp)' );
	ok( capsizeButtons( { righting: r.cap.righting() } ).has( 'letGo' ), 'touch: Let go comes up while on the hull' );
	const keelY = r.boat.toWorld( new E.Vector3( 0, - r.boat.draft, 0 ), new E.Vector3() ).y;
	r.run( 0.5 );
	ok( Math.abs( r.player.position.y - keelY ) < 0.25, `standing on the keel (feet ${ r.player.position.y.toFixed( 2 ) }, keel ${ keelY.toFixed( 2 ) })` );
	// walking does not take the feet off the keel
	const x0 = r.player.position.x, z0 = r.player.position.z;
	r.input.keys.add( 'KeyW' ); r.run( 0.5 ); r.input.keys.delete( 'KeyW' );
	ok( Math.hypot( r.player.position.x - x0, r.player.position.z - z0 ) < 0.3, 'WASD does not walk her keel' );
	// pull with good timing through the real input
	let maxPull = 0, t = 0, upAt = null, meterSeen = false;
	r.run( 40, ( tt ) => {

		const g = r.cap.game;
		if ( ! g ) { upAt = tt; return false; }
		if ( g.phase === 'pull' ) meterSeen = true;
		if ( autoHold( g, 'good' ) ) r.input.keys.add( 'KeyE' ); else r.input.keys.delete( 'KeyE' );
		maxPull = Math.max( maxPull, r.boat.pull );
		if ( g.phase === 'pull' && r.player.prompt ) t = tt;

	} );
	r.input.keys.delete( 'KeyE' );
	const up = r.events.find( ( e ) => e.n === 'boatRighted' );
	ok( up && up.t >= 10 && up.t <= 25, `she comes up after ${ up ? up.t : '-' } s of pulling (10-25)` );
	ok( maxPull > 0.5, `the pull lifted her (ctl.pull up to ${ maxPull.toFixed( 2 ) })` );
	ok( r.player.mode === 'swim' && ! r.cap.game, 'you end in the water at her side' );
	r.run( 4 );
	ok( ! r.boat.capsized && heelOf( r.boat ) < 10, `upright again (heel ${ f1( heelOf( r.boat ) ) } deg)` );
	ok( Math.abs( r.naval.floodState.level - SWAMP.level ) < 0.03, `full of water: flood level ${ r.naval.floodState.level.toFixed( 2 ) } (slower and lower until dry)` );
	ok( r.toasts.some( ( x ) => /She's up/.test( x ) ), 'a toast: bail her out' );
	const l0 = r.naval.floodState.level;
	r.run( 20 );
	const l1 = r.naval.floodState.level;
	ok( l1 < l0 && Math.abs( ( l0 - l1 ) - SWAMP.drain * 20 ) < 0.01, `she drains by herself (${ l0.toFixed( 3 ) } -> ${ l1.toFixed( 3 ) } in 20 s)` );
	r.naval.floodState.level -= 0.3; // the pump (naval's "Man the pump" on deck)
	r.run( 60 );
	ok( r.naval.floodState.level === 0 && r.cap.swamp === 0, 'pumped and drained: dry' );
	ok( r.cap.stats.righted === 1 && r.cap.stats.capsized === 1, `stats ${ JSON.stringify( r.cap.stats ) }` );

}

// ================================================================================================ 5. slipping off, letting go, helpers
section( '5. slipping off, letting go, crew help' );
{

	const r = rig( 'skiff' );
	r.boat.capsize( - 1 ); r.run( 1 ); swimBeside( r, - 1 ); r.step();
	r.input.press( 'KeyE' ); r.step();
	r.input.keys.add( 'KeyE' );
	r.run( 8, () => !! r.cap.game );
	r.input.keys.delete( 'KeyE' );
	const sl = r.events.find( ( e ) => e.n === 'rightingSlipped' );
	ok( sl && ! sl.letGo && r.player.mode === 'swim' && ! r.cap.game, 'holding on regardless: you slip off into the water' );
	r.run( 3 );
	ok( r.boat.capsized && heelOf( r.boat ) > 160, `she falls back hull up (${ f1( heelOf( r.boat ) ) } deg)` );
	// try again, then let go with Space
	swimBeside( r, - 1 ); r.step(); r.input.press( 'KeyE' ); r.step(); r.run( 1.2 );
	r.input.press( 'Space' ); r.step();
	const lg = r.events.filter( ( e ) => e.n === 'rightingSlipped' ).pop();
	ok( lg && lg.letGo && r.player.mode === 'swim', 'Space lets go' );
	// crew in the water help
	const a = rig( 'launch', { crew: 0 } ), b = rig( 'launch', { crew: 2 } );
	const timeIt = ( x ) => {

		x.boat.capsize( 1 ); x.run( 1 ); swimBeside( x, 1 ); x.step(); x.input.press( 'KeyE' ); x.step();
		x.run( 60, () => { const g = x.cap.game; if ( ! g ) return false; if ( autoHold( g, 'good' ) ) x.input.keys.add( 'KeyE' ); else x.input.keys.delete( 'KeyE' ); } );
		const e = x.events.find( ( q ) => q.n === 'boatRighted' );
		return e ? e : { t: Infinity, helpers: 0 };

	};
	const ta = timeIt( a ), tb = timeIt( b );
	ok( tb.helpers === 2 && tb.t < ta.t, `two hands aboard helping: ${ tb.t } s against ${ ta.t } s alone` );

}

// ================================================================================================ 6. an unpatched Player's "Board boat"
section( '6. the Player\'s own boarding of an upturned hull ends on the keel' );
{

	const r = rig( 'launch' );
	r.boat.capsize( 1 ); r.run( 1 );
	r.player.boardBoat();
	r.step();
	ok( r.player.mode === 'aboard' && r.cap.game, `boarded her deck (Player.nearBoat without the patch): the feature puts you on the keel instead (mode ${ r.player.mode })` );

}

// ================================================================================================ 7. breath under her
section( '7. trapped under the hull: the breath runs' );
{

	const r = rig( 'cutter' );
	r.boat.capsize( 1 ); r.run( 1 );
	r.player.mode = 'swim'; r.player.floating = true;
	r.player.position.set( r.boat.position.x, - 0.3, r.boat.position.z );
	ok( r.cap.trapped( r.player ), 'swimming under the upturned hull counts as trapped' );
	r.run( 3, () => { r.player.position.set( r.boat.position.x, - 0.3, r.boat.position.z ); } );
	ok( r.death.breath.air < 0.95 && r.death.breath.under, `the breath drains under her (air ${ r.death.breath.air.toFixed( 2 ) })` );
	swimBeside( r, 1, 2 ); r.run( 5 );
	ok( r.death.breath.air === 1 && ! r.cap.trapped( r.player ), 'out from under her: the lungs refill' );

}

// ================================================================================================ 8. save round trip
section( '8. the save with a capsized boat' );
{

	const r = rig( 'skiff' );
	r.boat.capsize( - 1 ); r.run( 1 );
	const saved = JSON.parse( JSON.stringify( r.features.toJSON() ) );
	ok( saved.capsize && saved.capsize.capsized === true && saved.capsize.side === - 1, `capsize saved: ${ JSON.stringify( saved.capsize ) }` );
	const r2 = rig( 'skiff' );
	r2.run( 1 );
	r2.features.fromJSON( saved );
	r2.boat.reset(); r2.boat.position.copy( SEA ); r2.boat.moored = false; // (App.applyWorld puts her back upright at the saved place)
	r2.run( 3 );
	ok( r2.boat.capsized && r2.boat.capsizeSide === - 1 && heelOf( r2.boat ) > 165, 'loaded: she is hull up again, same side' );
	ok( ! r2.events.some( ( e ) => e.n === 'boatCapsized' ), 'no second capsize (no gear lost again, no toast)' );
	// and righted in the save
	const r3 = rig( 'skiff' );
	r3.features.fromJSON( { capsize: { v: 1, capsized: false, side: 1, swamp: 0.2 } } );
	r3.naval.floodState.level = 0.2; // (naval's own save brings the water back)
	r3.run( 1 );
	ok( ! r3.boat.capsized && Math.abs( r3.cap.swamp - ( 0.2 - SWAMP.drain ) ) < 0.002, `an upright save stays upright, the water from the capsize still draining (${ r3.cap.swamp.toFixed( 3 ) })` );
	r3.cap.reset();
	ok( r3.cap.swamp === 0 && r3.cap.stats.capsized === 0, 'reset() clears it' );

}

// ================================================================================================ 9. multiplayer
section( '9. multiplayer: the capsize replicates, another player helps pull' );
{

	const sentA = [], sentB = [];
	const netA = { id: 'A', sendWorldEvent: ( kind, data ) => { sentA.push( { kind, data } ); return true; } };
	const netB = { id: 'B', sendWorldEvent: ( kind, data ) => { sentB.push( { kind, data } ); return true; } };
	const A = rig( 'launch', { net: netA } ), B = rig( 'launch', { net: netB } );
	A.state.name = 'Ana';
	A.player.enterBoat(); A.boat.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), 120 * DEG ); A.run( 3 );
	const over = sentA.find( ( m ) => m.kind === 'capsize' && m.data.phase === 'over' );
	ok( over && over.data.captain === 'A' && over.data.name === 'Ana' && Number.isFinite( over.data.x ), `A's capsize goes out: ${ JSON.stringify( over && over.data ) }` );
	// relay to B (as netsync emits remoteWorldEvent)
	const relay = ( from, list, to ) => { for ( const m of list.splice( 0 ) ) to.features.emit( 'remoteWorldEvent', { kind: m.kind, data: m.data, from } ); };
	relay( 'A', sentA, B );
	ok( B.cap.remote.has( 'A' ), 'B knows A\'s hull is over' );
	// B swims beside A's hull (B's world: the same coordinates; B's own boat is elsewhere)
	B.boat.position.set( SEA.x + 200, 0, SEA.z ); B.boat.mooring.anchor.copy( B.boat.position );
	B.player.mode = 'swim'; B.player.floating = true; B.player.position.set( over.data.x + 2.2, - 0.2, over.data.z );
	B.step();
	ok( B.player.prompt && /Ana/.test( B.player.prompt.text ), `B's prompt: "${ B.player.prompt && B.player.prompt.text }"` );
	// A climbs on and pulls; B holds E
	swimBeside( A, 1 ); A.step(); A.input.press( 'KeyE' ); A.step(); A.run( 1 );
	relay( 'A', sentA, B );
	B.input.keys.add( 'KeyE' ); B.run( 1.3 );
	const helps = sentB.filter( ( m ) => m.kind === 'capsizeHelp' );
	ok( helps.length >= 2 && helps.every( ( m ) => m.data.captain === 'A' ), `B holding E sends capsizeHelp to A (${ helps.length } in 1.3 s, every ${ HELP.every } s)` );
	relay( 'B', sentB, A );
	ok( A.cap.helpers() === 1, 'A counts one more hand on the line' );
	A.run( 2 );
	ok( A.cap.helpers() === 0, `the help lapses ${ HELP.ttl } s after B lets go` );
	ok( sentA.some( ( m ) => m.kind === 'capsize' && m.data.phase === 'righting' ), 'A\'s righting goes out (heel progress every 0.5 s)' );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
if ( fails ) process.exit( 1 );
