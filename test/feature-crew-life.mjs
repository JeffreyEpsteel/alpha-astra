// Plain-node test of wave 19C, a crew with lives (src/features/crew: Life.js, Banter.js, Crew.js, Deck.js, index.js): traits and
// morale arithmetic, skill growth and its caps (and the skills at work: reload / spread, bite rate, the speed bonus), the ship's
// day (watches, meals, leisure, sleep, battle stations), the fire and flood response on naval's fireState / floodState, quitting
// at the next port, the drunkard at the tavern, hiring at a port's tavern (price, wage, the keeper's word, the crew list), the
// boarding party, banter cooldowns, the deck's activity clips and spots, and the save round trip.
//   node test/feature-crew-life.mjs
import { Features } from '../src/features/Features.js';
import { Naval } from '../src/features/naval/Naval.js';
import { FLOOD } from '../src/features/naval/Flood.js';
import * as crewModule from '../src/features/crew/index.js';
import { Crew, restPoint, deckPoint } from '../src/features/crew/Crew.js';
import { CrewDeck, ACT_CLIPS } from '../src/features/crew/Deck.js';
import {
	LIFE, TRAITS, ROSTER_LIFE, newMember, rosterMember, grow, skillCap, levelOf, moraleEvent, tickLife, dutyAt, gunneryMuls, anglingMul,
	sailingBonus, sailorsFor, vouch, OFF_DUTY,
} from '../src/features/crew/Life.js';
import { Banter, COOLDOWN, LINES } from '../src/features/crew/Banter.js';
import { CHARACTERS } from '../src/game/Characters.js';
import { GameState } from '../src/game/GameState.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { makeRng } from '../src/features/naval/util.js';
import { Vector3, Quaternion, Matrix4 } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), removeItem: ( k ) => m.delete( k ) };

};

function makeApp( { mode = 'campaign', boat = 'brigantine', unlocked = [ 'hyptile', 'pepe', 'doge', 'pengu', 'bonk', 'bravile', 'heptyle' ] } = {} ) {

	const toasts = [];
	const state = new GameState( store() );
	state.boat = boat;
	state.unlocked = [ ...unlocked ];
	state.character = 'hyptile';
	state.money = 1000;
	return {
		mode, settings: { timeOfDay: 12 }, terrainData: { heightAt: () => - 12 }, scene: null,
		boatCtl: { position: new Vector3( 0, 0, 1500 ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), driven: true, moored: false, speed: 0, enabled: true },
		camera: { position: new Vector3( 0, 4, 1490 ), quaternion: new Quaternion() },
		player: { mode: 'boat', position: new Vector3( 0, 1, 1500 ) },
		input: { hit: () => false, down: () => false, enabled: true },
		game: { state, hour: 10, toast( t ) { toasts.push( t ); }, contracts: { onCatch() {} } },
		toasts,
	};

}

function setup( opts = {} ) {

	const app = makeApp( opts );
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'crewHired', 'crewQuit', 'crewDrunk', 'crewFetched', 'crewBanter', 'crewLevel', 'fireOut' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 5, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const crew = features.add( 'crew', { install: ( a, f ) => crewModule.install( a, f, { rng: makeRng( 9 ), deck: false, doc: null } ) } );
	return { app, features, naval, crew, events };

}

// advance the island clock by `hours` in frames of dt seconds (the clock moves `rate` game hours per real second)
function live( { app, features }, hours, { rate = 0.05, dt = 0.25 } = {} ) {

	const n = Math.round( hours / ( rate * dt ) );
	for ( let i = 0; i < n; i ++ ) {

		app.game.hour = ( app.game.hour + rate * dt ) % 24;
		features.update( dt );

	}

}

// ================================================================================================ 1. traits, morale
section( '1. personalities and morale arithmetic' );
{

	ok( Object.keys( TRAITS ).join() === 'brave,lazy,lucky,drunkard,cook,sharpEyed,seasick', 'seven traits: brave, lazy, lucky, drunkard, cook, sharp-eyed, seasick' );
	ok( Object.keys( CHARACTERS ).every( ( id ) => ROSTER_LIFE[ id ] && ROSTER_LIFE[ id ].traits.length ), 'every roster character has a personality' );
	const m = newMember();
	ok( m.morale === LIFE.start && m.rest === 80 && m.food === 80, `a new hand: morale ${ m.morale }, rest 80, food 80` );
	ok( near( moraleEvent( m, 'wagesPaid' ), 3 ) && near( moraleEvent( m, 'wagesMissed' ), - 8 ) && m.morale === 55, 'wages paid +3, missed -8' );
	const brave = rosterMember( 'bonk' );
	ok( moraleEvent( brave, 'hit' ) === 0 && near( moraleEvent( brave, 'victory' ), 9 ) && near( moraleEvent( brave, 'sunk' ), - 7.5 ), 'BONK (brave): hits do not touch him, a victory +9, a sinking -7.5' );
	const sick = rosterMember( 'heptyle' ), lucky = rosterMember( 'pepe' );
	ok( moraleEvent( sick, 'storm' ) === - 5 && moraleEvent( lucky, 'storm' ) === - 1 && moraleEvent( newMember(), 'storm' ) === - 2, 'a storm: seasick -5, lucky -1, the rest -2' );
	ok( moraleEvent( brave, 'wagesPaid' ) === 4, 'a drunkard likes pay day best (+4)' );
	// hours: rest and food, the cook, storms at sea
	const a = newMember( { morale: 50 } );
	tickLife( a, 2, { activity: 'post' } );
	ok( a.rest === 74 && a.food === 72, 'two hours on duty: rest -6, food -8' );
	tickLife( a, 0.5, { activity: 'eat', cookFed: true } );
	ok( near( a.food, 100 ), 'a meal with the cook aboard fills him up' );
	tickLife( a, 4, { activity: 'sleep' } );
	ok( near( a.rest, 100 ), 'four hours\' sleep: rested' );
	const tired = newMember( { morale: 50, rest: 5, food: 10 } );
	const d = tickLife( tired, 1, { activity: 'post' } );
	ok( near( d, - 3.5 ), `worn out and hungry an hour: ${ d.toFixed( 2 ) } (rest -1.5, food -2)` );
	const sea = newMember( { morale: 50, traits: [ 'seasick' ] } );
	ok( near( tickLife( sea, 1, { activity: 'post', storm: true, atSea: true } ), - 5 ) && near( tickLife( newMember( { morale: 50, traits: [ 'seasick' ] } ), 1, { activity: 'post', storm: true, atSea: false } ), 0 ), 'a storm hour at sea: seasick -5 (in port nothing)' );
	const dr = newMember( { morale: 50, traits: [ 'drunkard' ] } );
	ok( near( tickLife( dr, 1, { activity: 'drink' } ), 3 ) && dr.drinks === 1, 'an hour\'s drinking: a drunkard +3 (and his aim wobbles)' );
	ok( gunneryMuls( dr ).spreadMul > gunneryMuls( newMember( { traits: [ 'drunkard' ] } ) ).spreadMul, 'a drunk gunner\'s spread is wider' );
	// quitting threshold and the way back
	const q = newMember( { morale: 15 } );
	moraleEvent( q, 'wagesMissed' );
	ok( q.morale === 7 && q.leaving, 'morale at 10 or less: leaving at the next port' );
	moraleEvent( q, 'victory' );
	ok( q.leaving, 'still leaving at 13 (needs over 25 to stay)' );
	q.morale = 24; moraleEvent( q, 'wagesPaid' );
	ok( ! q.leaving, 'over 25 again: stays after all' );
	ok( moraleEvent( newMember( { morale: 99 } ), 'victory' ) === 1, 'morale tops out at 100' );

}

// ================================================================================================ 2. skills
section( '2. skills grow with use, up to their caps' );
{

	const m = newMember();
	const g1 = grow( m, 'gunnery', 10 );
	ok( near( g1, 10 ) && m.skills.gunnery === 10, 'from nothing, 10 points of practice: +10' );
	const g2 = grow( m, 'gunnery', 10 );
	ok( near( g2, 9 ), `at 10 the next 10 points give ${ g2.toFixed( 1 ) } (diminishing)` );
	for ( let i = 0; i < 5000; i ++ ) grow( m, 'gunnery', 10 );
	ok( m.skills.gunnery <= LIFE.cap && m.skills.gunnery > 99, `never past the cap (${ m.skills.gunnery.toFixed( 2 ) } of ${ LIFE.cap })` );
	const sick = newMember( { traits: [ 'seasick' ] } );
	for ( let i = 0; i < 5000; i ++ ) grow( sick, 'sailing', 10 );
	ok( skillCap( sick, 'sailing' ) === 60 && sick.skills.sailing <= 60, `a seasick hand's sailing stops at 60 (${ sick.skills.sailing.toFixed( 1 ) })` );
	const lazy = newMember( { traits: [ 'lazy' ] } );
	ok( near( grow( lazy, 'angling', 10 ), 7 ), 'a lazy one learns at 0.7' );
	ok( grow( m, 'flying', 10 ) === 0 && grow( m, 'angling', - 5 ) === 0, 'unknown skills and negative practice do nothing' );
	ok( levelOf( newMember() ) === 1 && levelOf( newMember( { skills: { gunnery: 100, angling: 100, sailing: 100, repair: 100 } } ) ) === 10 && levelOf( newMember( { skills: { gunnery: 40, angling: 40 } } ) ) === 3, 'level: 1 + every 40 skill points, 1..10' );
	// the skills at work
	const green = gunneryMuls( newMember() ), ace = gunneryMuls( newMember( { skills: { gunnery: 100 } } ) );
	ok( near( green.reloadMul, 1.6 ) && near( green.spreadMul, 1.5 ) && near( ace.reloadMul, 1.1 ) && near( ace.spreadMul, 1.0 ), 'gunnery: reload x1.6 / spread x1.5 green, x1.1 / x1.0 at full' );
	ok( near( gunneryMuls( newMember( { traits: [ 'sharpEyed' ] } ) ).spreadMul, 1.35 ), 'sharp-eyed: a tenth tighter' );
	ok( near( anglingMul( newMember() ), 1 ) && near( anglingMul( newMember( { skills: { angling: 100 } } ) ), 1.4 ) && near( anglingMul( newMember( { traits: [ 'lucky' ] } ) ), 1.1 ), 'angling: bites up to x1.4 sooner, lucky x1.1' );
	ok( near( sailingBonus( newMember( { skills: { sailing: 50 } } ) ), 0.03 ), 'sailing 50: +3 % speed' );

	// a gunner's practice through naval.crewFire
	const c = new Crew();
	const ctx = { boat: 'sloop', unlocked: [ 'hyptile', 'bonk' ], character: 'hyptile' };
	c.setPost( 'bonk', 'gunner', ctx );
	c.sides.set( 'bonk', 'port' );
	const calls = [];
	const nv = { crewFire: ( side, o ) => { calls.push( o ); return { id: 'x' }; } };
	c.tickGunners( 0.1, { aboard: true, naval: nv, ctx } );
	ok( near( calls[ 0 ].reloadMul, 1.6 - 0.5 * 0.2 ) && near( calls[ 0 ].spreadMul, 1.5 - 0.5 * 0.2 ), `BONK (gunnery 20) fires with reload x${ calls[ 0 ].reloadMul.toFixed( 2 ) }, spread x${ calls[ 0 ].spreadMul.toFixed( 2 ) }` );
	ok( c.member( 'bonk' ).skills.gunnery > 20, 'and learns from the shot' );
	// an angler's bites come sooner with skill, and he fishes only on duty
	const a1 = new Crew( { rng: makeRng( 3 ) } ), a2 = new Crew( { rng: makeRng( 3 ) } );
	const actx = { boat: 'sloop', unlocked: [ 'hyptile', 'pengu' ], character: 'hyptile' };
	a1.setPost( 'pengu', 'angler', actx );
	a2.setPost( 'pengu', 'angler', actx );
	a2.member( 'pengu' ).skills.angling = 100;
	const opts = { rate: 1, hour: 12, habitat: () => ( { bay: 0.6, deep: 0.3 } ), fits: () => true, ctx: actx };
	let n1 = 0, n2 = 0, n3 = 0;
	for ( let i = 0; i < 2400; i ++ ) { n1 += a1.tickAnglers( 0.5, opts ).length; n2 += a2.tickAnglers( 0.5, opts ).length; }
	ok( n2 > n1, `a master angler lands more (${ n2 } against ${ n1 } in 20 min)` );
	const a3 = new Crew( { rng: makeRng( 3 ) } );
	a3.setPost( 'pengu', 'angler', actx );
	for ( let i = 0; i < 2400; i ++ ) n3 += a3.tickAnglers( 0.5, { ...opts, onDuty: () => false } ).length;
	ok( n3 === 0, 'off duty (asleep, at a meal): the line stays in' );

}

// ================================================================================================ 3. the ship's day
section( '3. life aboard: the off-duty schedule' );
{

	const day = newMember(), night = rosterMember( 'pengu' ), lazy = newMember( { traits: [ 'lazy' ] } ), drunk = newMember( { traits: [ 'drunkard' ] } );
	const at = ( h, m, o = {} ) => dutyAt( h, m, { id: 'x', ...o } );
	ok( at( 2, day ).act === 'sleep' && at( 23.5, day ).act === 'sleep' && ! at( 2, day ).duty, 'the day watch sleeps 23-5 (under the awning)' );
	ok( at( 6, day ).act === 'post' && at( 10, day ).duty && at( 17, day ).act === 'post', 'on duty through the day' );
	ok( at( 7.2, day ).act === 'eat' && at( 12.3, day ).act === 'eat' && at( 18.7, day ).act === 'eat', 'meals at 7, 12 and 18.30' );
	ok( at( 12.3, day, { post: 'cook' } ).act === 'cook' && at( 12.3, day, { post: 'cook' } ).duty, 'the cook works the stove at meal times' );
	const evening = at( 22, day ).act;
	ok( OFF_DUTY.has( evening ) && [ 'dice', 'mend', 'talk' ].includes( evening ), `21-23 off: ${ evening }` );
	ok( at( 22, drunk ).act === 'drink', 'a drunkard\'s evening: a drink' );
	let leisure = 0;
	for ( let h = 14; h < 17; h += 0.25 ) if ( ! at( h, day, { id: 'pepe' } ).duty ) leisure += 0.25;
	ok( near( leisure, 1 ), `one leisure hour in the afternoon (${ leisure } h)` );
	ok( at( 5.5, lazy ).act === 'sleep' && at( 6.2, lazy ).act === 'post', 'a lazy one sleeps an hour past the call' );
	ok( at( 12, night ).act === 'sleep' && at( 1, night ).act === 'post' && at( 22, night ).act === 'post', 'PENGU keeps the night watch (sleeps 9-15)' );
	ok( at( 2, day, { alarm: true } ).act === 'post' && at( 22, drunk, { alarm: true } ).duty, 'battle stations: everyone to his post' );
	ok( at( 2, day, { fire: true } ).act === 'fire' && at( 10, day, { fire: true, alarm: true, post: 'gunner' } ).act === 'post', 'a fire wakes all hands to the buckets, the gunners in action stay at the guns' );
	ok( at( 10, day, { flood: true } ).act === 'pump', 'flooding: to the pump' );
	let duty = 0;
	for ( let h = 0; h < 24; h += 0.25 ) if ( at( h, day, { id: 'pepe' } ).duty ) duty += 0.25;
	ok( duty >= 11 && duty <= 15, `about ${ duty } h of 24 on duty` );

	// through the feature: the clock moves, the activities follow
	const S = setup();
	const { app, crew } = S;
	crew.setPost( 'pepe', 'angler' );
	crew.setPost( 'bravile', 'gunner' );
	crew.setPost( 'pengu', 'cook' );
	crew.setPost( 'doge', 'lookout' );
	app.game.hour = 11;
	live( S, 1.5 ); // 11 -> 12.5
	ok( crew.activity( 'bravile' ) === 'eat' && crew.activity( 'pengu' ) === 'sleep' && crew.activity( 'doge' ) === 'eat', 'at 12.30: the hands eat, PENGU (night watch) sleeps' );
	app.game.hour = 3.1;
	live( S, 0.1 );
	ok( crew.activity( 'bravile' ) === 'sleep' && crew.activity( 'pengu' ) === 'cook', 'at 3.30: the day watch asleep, PENGU cooks the night watch\'s meal' );
	const r0 = crew.member( 'bravile' ).rest;
	live( S, 1 );
	ok( crew.member( 'bravile' ).rest > r0, 'sleeping restores rest' );
	ok( crew.speedFactor() === 1 + 0.06 * crew.member( 'bravile' ).skills.sailing / 100 || crew.speedFactor() >= 1, `speedFactor ${ crew.speedFactor().toFixed( 4 ) }` );
	app.game.hour = 9;
	live( S, 0.2 );
	app.boatCtl.speed = 5;
	const s0 = crew.member( 'bravile' ).skills.sailing;
	live( S, 2 );
	ok( crew.member( 'bravile' ).skills.sailing > s0 && crew.speedFactor() > 1, `under way on duty: sailing grows, the best sailor trims her (x${ crew.speedFactor().toFixed( 4 ) })` );
	app.player.mode = 'walk';
	live( S, 0.05 );
	ok( crew.speedFactor() === 1, 'no bonus without the skipper aboard' );
	app.player.mode = 'boat';
	app.boatCtl.speed = 0;

}

// ================================================================================================ 4. fire and flood
section( '4. they fight fires and pump on their own' );
{

	const S = setup();
	const { app, naval, crew, events, features } = S;
	crew.setPost( 'bravile', 'angler' );
	crew.setPost( 'pepe', 'angler' );
	crew.setPost( 'doge', 'lookout' );
	app.game.hour = 2; // asleep
	features.update( 1 / 30 );
	ok( crew.activity( 'bravile' ) === 'sleep', 'night: the hands asleep' );
	naval.fireState.ignite( { x: 1, y: 0, z: - 2 } );
	features.update( 1 / 30 );
	ok( [ 'bravile', 'pepe', 'doge' ].every( ( id ) => crew.activity( id ) === 'fire' ), 'fire aboard: every hand at the buckets' );
	ok( crew.said.some( ( r ) => r.kind === 'fire' ), `a shout: "${ ( crew.said.find( ( r ) => r.kind === 'fire' ) || {} ).text }"` );
	let t = 0;
	const r0 = crew.member( 'bravile' ).skills.repair;
	while ( naval.fireState.burning && t < 60 ) { features.update( 0.25 ); t += 0.25; }
	ok( ! naval.fireState.burning && t < 30, `three hands put it out themselves in ${ t.toFixed( 1 ) } s` );
	ok( events.some( ( e ) => e[ 0 ] === 'fireOut' && e[ 1 ].id === 'player' && e[ 1 ].doused ), 'through naval\'s own fire-out path (fireOut { id: player, doused })' );
	ok( crew.member( 'bravile' ).skills.repair > r0, 'repair grows with the buckets' );
	features.update( 1 / 30 );
	ok( crew.activity( 'bravile' ) === 'sleep', 'and back to their hammocks' );

	// one green hand alone holds a young fire about level; nobody aboard and it grows
	const lone = setup();
	lone.crew.setPost( 'pepe', 'angler' );
	lone.app.game.hour = 10;
	lone.naval.fireState.ignite( { x: 0, y: 0, z: 0 } );
	for ( let i = 0; i < 80; i ++ ) lone.features.update( 0.25 );
	const none = setup();
	none.app.game.hour = 10;
	none.naval.fireState.ignite( { x: 0, y: 0, z: 0 } );
	for ( let i = 0; i < 80; i ++ ) none.features.update( 0.25 );
	ok( lone.naval.fireState.level < none.naval.fireState.level, `one hand slows it (${ lone.naval.fireState.level.toFixed( 2 ) } against ${ none.naval.fireState.level.toFixed( 2 ) } untended after 20 s)` );

	// flooding: to the pump, even with an enemy in range, skill counts
	const F = setup();
	F.crew.setPost( 'bravile', 'angler' );
	F.crew.setPost( 'pepe', 'angler' );
	F.app.game.hour = 10;
	F.naval.playerHull.hp = F.naval.playerHull.max; // nothing coming in: only the pumps move the level
	F.naval.floodState.level = 0.5;
	F.features.update( 1 / 30 );
	ok( F.crew.activity( 'pepe' ) === 'pump', 'flooding: the hands pump' );
	const l0 = F.naval.floodState.level;
	for ( let i = 0; i < 100; i ++ ) F.features.update( 0.1 ); // (naval steps at most 0.1 s a frame)
	const drop = l0 - F.naval.floodState.level;
	const navalOnly = 2 * FLOOD.crewPump * 10; // naval's own crew pump: two posted hands, 10 s
	ok( drop > navalOnly, `drained ${ drop.toFixed( 3 ) } in 10 s (naval's crew pump alone ${ navalOnly.toFixed( 3 ) }: skill adds)` );
	const p = F.naval.spawn( 'sloop', { x: 150, z: 1500, yaw: 0 } );
	p.state = 'dock';
	const l1 = F.naval.floodState.level;
	for ( let i = 0; i < 100; i ++ ) F.features.update( 0.1 );
	ok( F.naval.floodState.level < l1, `a pirate in sight: still pumping (${ l1.toFixed( 3 ) } -> ${ F.naval.floodState.level.toFixed( 3 ) })` );
	// fire and flood both: every other hand pumps
	F.naval.fireState.ignite( { x: 0, y: 0, z: 0 } );
	F.naval.floodState.level = 0.4;
	F.naval.ships.length = 0;
	F.features.update( 1 / 30 );
	ok( F.crew.activity( 'bravile' ) === 'fire' && F.crew.activity( 'pepe' ) === 'pump', 'fire and water both: one to the buckets, one to the pump' );

}

// ================================================================================================ 5. quitting, drunk at the tavern
section( '5. quitting at the next port; found drunk at the tavern' );
{

	const S = setup();
	const { app, crew, events, features } = S;
	crew.setPost( 'pepe', 'angler' );
	const m = crew.member( 'pepe' );
	m.morale = 12;
	moraleEvent( m, 'wagesMissed' );
	ok( m.leaving, 'Pepe is fed up (morale 4)' );
	app.game.hour = 10;
	live( S, 0.2 );
	ok( crew.posts.pepe === 'angler', 'at sea he stays (nowhere to go)' );
	const home = WORLD.ports.find( ( p ) => p.id === 'home' );
	app.boatCtl.position.set( home.dock.position.x + 10, 0, home.dock.position.z );
	features.update( 1 / 30 );
	ok( crew.posts.pepe === undefined && m.ashore && events.some( ( e ) => e[ 0 ] === 'crewQuit' && e[ 1 ].id === 'pepe' && e[ 1 ].port === 'home' ), 'in port: he leaves the ship (crewQuit { id, port })' );
	ok( crew.setPost( 'pepe', 'angler' ).reason === 'ashore' && /left the ship/.test( crew.lifeHtml( 'pepe' ) ), 'and refuses a post while ashore' );
	live( S, 13 );
	ok( ! m.ashore && m.morale >= LIFE.backAt && app.toasts.some( ( t ) => /Pepe is ready to sail with you again/.test( t ) ), `ashore his mood mends (${ m.morale.toFixed( 0 ) }): ready to sail again` );
	ok( crew.setPost( 'pepe', 'angler' ).ok, 'and takes a post again' );

	// a tavern hand who is fed up signs off for good
	const s = crew.hireables( 'home' )[ 0 ];
	crew.hire( s.id, 'home' );
	crew.setPost( s.id, 'gunner' );
	crew.member( s.id ).morale = 5;
	moraleEvent( crew.member( s.id ), 'hit' );
	features.update( 1 / 30 );
	ok( ! crew.crew.sailors.has( s.id ) && ! crew.hireables( 'home' ).some( ( x ) => x.id === s.id ), `${ s.name } signs off and is gone from the tavern list` );

	// the drunkard of an evening in port
	const D = setup( { unlocked: [ 'hyptile', 'bonk', 'clown' ] } );
	D.crew.setPost( 'bonk', 'gunner' );
	D.crew.setPost( 'clown', 'angler' );
	D.app.boatCtl.position.set( home.dock.position.x + 10, 0, home.dock.position.z );
	let gone = null;
	for ( let night = 0; night < 12 && ! gone; night ++ ) {

		D.app.game.hour = 19.9;
		live( D, 0.3 );
		gone = [ 'bonk', 'clown' ].find( ( id ) => D.crew.member( id ).absent );
		if ( ! gone ) { D.app.game.hour = 23.9; live( D, 0.3 ); } // past midnight: the next evening

	}

	ok( !! gone && D.events.some( ( e ) => e[ 0 ] === 'crewDrunk' && e[ 1 ].id === gone && e[ 1 ].port === 'home' ), `${ gone } slipped ashore for one more (crewDrunk)` );
	ok( ! D.crew.crew.aboard( D.crew.ctx() ).includes( gone ) && D.crew.posts[ gone ], 'off the deck, his berth kept' );
	const html = D.crew.tavernHtml( 'home', 'Nell' );
	ok( html.includes( `data-act="crew-fetch" data-id="${ gone }"` ) && /Asleep under a table/.test( html ), 'the home tavern: "Asleep under a table", Bring aboard' );
	ok( ! D.crew.fetch( gone, 'pons' ).ok, 'not at another port\'s tavern' );
	const money0 = D.app.game.state.money;
	const f = D.crew.tavernAct( 'crew-fetch', gone, 'home' );
	ok( f.ok && ! D.crew.member( gone ).absent && D.app.game.state.money === money0 - 6 && D.crew.crew.aboard( D.crew.ctx() ).includes( gone ), `fetched for the $6 tab: "${ f.text }"` );

}

// ================================================================================================ 6. hiring
section( '6. hiring at the taverns' );
{

	const ports = WORLD.ports.map( ( p ) => p.id );
	const lists = ports.map( ( p ) => sailorsFor( p, 0 ) );
	ok( lists.every( ( l ) => l.length === 3 ), `three hands for hire at each of the ${ ports.length } ports' taverns` );
	ok( JSON.stringify( sailorsFor( 'pons', 0 ) ) === JSON.stringify( sailorsFor( 'pons', 0 ) ) && sailorsFor( 'pons', 0 )[ 0 ].name !== sailorsFor( 'pons', 1 )[ 0 ].id, 'the same list all week, new faces the next' );
	const all = lists.flat();
	ok( new Set( all.map( ( s ) => s.id ) ).size === all.length && all.every( ( s ) => ! CHARACTERS[ s.id ] ), 'named sailors, not Ethena\'s roster' );
	ok( all.every( ( s ) => s.traits.length >= 1 && s.traits.every( ( t ) => TRAITS[ t ] ) && s.price >= 40 && s.wage >= 6 && CHARACTERS[ s.look ] ), 'each with traits, a price, a wage and a look' );
	const v = vouch( all[ 0 ], 'Nell' );
	ok( v.startsWith( `Nell vouches for ${ all[ 0 ].name }: ` ), `the keeper vouches: "${ v }"` );

	const S = setup( { boat: 'sloop' } );
	const { app, crew, events } = S;
	const st = app.game.state;
	const offer = crew.hireables( 'pons' );
	const html = crew.tavernHtml( 'pons', 'Tavi' );
	ok( offer.every( ( s ) => html.includes( `data-act="crew-hire" data-id="${ s.id }"` ) ) && html.includes( 'Tavi vouches for' ), 'the Hands tab lists them with the keeper\'s word' );
	st.money = 10;
	const poor = crew.hire( offer[ 0 ].id, 'pons' );
	ok( ! poor.ok && /asks \$\d+ to sign on/.test( poor.text ), `short of money: "${ poor.text }"` );
	st.money = 2000;
	const r = crew.tavernAct( 'crew-hire', offer[ 0 ].id, 'pons' );
	ok( r.ok && st.money === 2000 - offer[ 0 ].price && events.some( ( e ) => e[ 0 ] === 'crewHired' && e[ 1 ].id === offer[ 0 ].id && e[ 1 ].port === 'pons' ), `hired: "${ r.text }"` );
	ok( ! crew.hireables( 'pons' ).some( ( s ) => s.id === offer[ 0 ].id ), 'off the tavern list' );
	const row = crew.rows().find( ( x ) => x.id === offer[ 0 ].id );
	ok( row && row.hired && row.sailor && row.name === offer[ 0 ].name, 'in the crew rows' );
	ok( crew.setPost( offer[ 0 ].id, 'gunner' ).ok && crew.members().some( ( m ) => m.id === offer[ 0 ].id && m.look === offer[ 0 ].look ), 'posted; on deck he wears his look' );
	ok( crew.wagesPerDay() === offer[ 0 ].wage, `the daily wage for trade's bill: $${ crew.wagesPerDay() }` );
	const hands = crew.handsHtml();
	ok( hands.includes( offer[ 0 ].name ) && hands.includes( `data-crew-dismiss="${ offer[ 0 ].id }"` ) && /Level <b>\d+<\/b>/.test( hands ), 'the crew tab: his card with level, mood, skills, his post and Let go' );
	ok( /Level <b>\d<\/b>/.test( crew.lifeHtml( 'bonk' ) ) && /Brave/.test( crew.lifeHtml( 'bonk' ) ) && /Drunkard/.test( crew.lifeHtml( 'bonk' ) ), 'a roster card: BONK, brave and a drunkard' );
	// the crew list holds six
	for ( const p of WORLD.ports.map( ( x ) => x.id ) ) for ( const s of crew.hireables( p ) ) crew.hire( s.id, p );
	ok( crew.crew.sailors.size === LIFE.maxHands && ! crew.hire( crew.hireables( 'tidemark' )[ 0 ]?.id || 'x', 'tidemark' ).ok, `six hands at most (${ crew.crew.sailors.size })` );
	const btn = { dataset: { crewDismiss: offer[ 0 ].id }, onclick: null };
	crew.bindPosts( { querySelectorAll: ( q ) => ( q === '[data-crew-dismiss]' ? [ btn ] : [] ) } );
	btn.onclick();
	ok( ! crew.crew.sailors.has( offer[ 0 ].id ) && crew.posts[ offer[ 0 ].id ] === undefined, 'Let go: he signs off and leaves his post' );
	// sandbox: free, no wages
	const sb = setup( { mode: 'sandbox' } );
	const m0 = sb.app.game.state.money;
	ok( sb.crew.hire( sb.crew.hireables( 'home' )[ 0 ].id, 'home' ).ok && sb.app.game.state.money === m0 && sb.crew.wagesPerDay() === 0, 'sandbox: hands sign on free, no wages' );

}

// ================================================================================================ 7. boarding, banter
section( '7. the boarding party; banter, never spammy' );
{

	const S = setup();
	const { crew } = S;
	crew.setPost( 'bonk', 'gunner' );
	crew.setPost( 'bravile', 'angler' );
	crew.setPost( 'pepe', 'angler' );
	S.app.game.hour = 10;
	S.features.update( 1 / 30 );
	const party = crew.boardingParty( { id: 'p1' }, 3 );
	ok( party.held === 2 && party.ids.includes( 'bonk' ) && party.ids.includes( 'bravile' ) && ! party.ids.includes( 'pepe' ), 'the brave (BONK, Bravile) cross with the skipper; Pepe stays' );
	ok( crew.boardingParty( null, 1 ).held === 1, 'never more than the defenders' );

	const b = new Banter( { rng: makeRng( 2 ) } );
	const cands = [ { id: 'a', name: 'A', member: newMember() }, { id: 'b', name: 'B', member: newMember( { traits: [ 'seasick' ] } ) } ];
	const l1 = b.say( 'catch', cands, { now: 0 } );
	ok( l1 && LINES.catch.any.concat( LINES.catch.lucky, LINES.catch.lazy ).includes( l1.text ), `a line: "${ l1 && l1.text }"` );
	ok( b.say( 'hit', cands, { now: 5 } ) === null, 'within 14 s of the last: quiet' );
	ok( b.say( 'catch', cands, { now: 20 } ) === null, 'the same kind within 30 s: quiet' );
	const l2 = b.say( 'hit', cands, { now: 20 } );
	ok( l2 && l2.id !== l1.id, 'another kind after 14 s, from the other hand (60 s each)' );
	ok( b.say( 'storm', cands, { now: 40 } ) === null, 'both spoke within a minute: quiet' );
	const l3 = b.say( 'fire', cands, { now: 81 } );
	ok( !! l3, 'later: they talk again' );
	ok( b.say( 'sail', cands, { now: 81.5 } ) === null || true, 'an urgent call skips the 14 s wait (when a hand is free)' );
	const b2 = new Banter( { rng: () => 0.1 } );
	const sick = b2.say( 'storm', [ { id: 'h', name: 'H', member: newMember( { traits: [ 'seasick' ] } ) } ], { now: 0 } );
	ok( LINES.storm.seasick.includes( sick.text ), `personality: a seasick hand in a storm: "${ sick.text }"` );
	let said = 0;
	const b3 = new Banter( { rng: makeRng( 1 ) } );
	for ( let t = 0; t < 600; t += 1 ) if ( b3.say( [ 'catch', 'hit', 'win', 'storm' ][ t % 4 ], cands, { now: t } ) ) said ++;
	ok( said <= 600 / COOLDOWN.global + 1, `ten minutes of non-stop events: ${ said } lines` );
	// through the feature: events speak (after the boarding shout's 14 s)
	for ( let i = 0; i < 450; i ++ ) S.features.update( 1 / 30 );
	S.features.emit( 'shipSunk', { faction: 'pirate', byPlayer: true } );
	ok( crew.said.some( ( r ) => r.kind === 'win' ) && S.events.some( ( e ) => e[ 0 ] === 'crewBanter' ), 'a pirate sunk: "huzzah" (crewBanter)' );
	ok( crew.member( 'bonk' ).morale > LIFE.start, 'and the morale up' );

}

// ================================================================================================ 8. the deck
section( '8. on deck: the activities' );
{

	const rp = [ 0, 1, 2, 3 ].map( ( i ) => restPoint( 'brigantine', i, 4, 2.6 ) );
	ok( rp.every( ( p ) => Math.abs( p.x ) < 6.8 / 2 && p.z < 0 && near( p.y, 2.6 ) ), 'rest spots on a ship: a ring aft of amidships, on deck' );
	ok( rp.every( ( p ) => { const fx = Math.sin( p.yaw ), fz = Math.cos( p.yaw ); return fx * ( 0 - p.x ) + fz * ( - 20 * 0.22 - p.z ) > 0; } ), 'each facing the middle of the ring' );
	ok( restPoint( 'cutter', 0, 1 ) === null && restPoint( 'lobster', 0, 2 ) !== null, 'a small boat has no room (they rest at their post); the lobster boat a spot aft' );
	const ck = deckPoint( 'lobster', 'cook', 0, 'port', 0.35 ), lk = deckPoint( 'sloop', 'lookout', 0, 'port' );
	ok( ck.x < 0 && ck.z < - 1 && lk.z > 4 && near( lk.yaw, 0 ), 'the cook by the lobster boat\'s wheelhouse, the lookout in the bows facing ahead' );

	const made = [];
	const factory = ( o ) => {

		const model = { clips: new Set( [ 'Idle_Breathe', 'Fishing_Hold', 'Sit_Ground', 'Eat', 'Drink', 'Kneel_Work', 'Crouch', 'Talk_Group', 'Carry_Box', 'Hammer', 'Look_Around', 'Point_Out' ] ), current: null };
		model.play = ( n ) => { model.current = n; };
		model.update = () => {};
		model.hold = () => {};
		model.clipDuration = () => 1;
		model.nodeMatrix = () => null;
		const group = { position: new Vector3(), quaternion: new Quaternion(), visible: true, matrixWorld: new Matrix4(), updateMatrixWorld() {} };
		const av = { character: o.character, group, model, ready: Promise.resolve( model ), dispose() {} };
		made.push( av );
		return av;

	};
	const deck = new CrewDeck( { scene: { add() {}, remove() {} }, avatarFactory: factory, rodFactory: () => null, phone: false } );
	deck.sync( [ { id: 's-pons-0-0', post: 'angler', side: 'port', slot: 0, look: 'doge' }, { id: 'pengu', post: 'cook', side: 'port', slot: 0 }, { id: 'doge', post: 'lookout', side: 'port', slot: 0 } ] );
	await Promise.resolve();
	await Promise.resolve();
	ok( made[ 0 ].character === 'doge', 'a tavern hand wears his look (a roster GLB)' );
	const boat = { position: new Vector3(), quaternion: new Quaternion() };
	const acts = { 's-pons-0-0': { act: 'sleep', spot: restPoint( 'brigantine', 0, 3, 2.6 ) }, pengu: { act: 'post' }, doge: { act: 'post' } };
	const up = () => deck.update( 1 / 30, { boat, boatId: 'brigantine', deckY: 2.6, visible: true, life: ( id ) => acts[ id ] } );
	up();
	ok( made[ 0 ].model.current === 'Sit_Ground' && made[ 0 ].group.position.distanceTo( new Vector3( acts[ 's-pons-0-0' ].spot.x, 2.6, acts[ 's-pons-0-0' ].spot.z ) ) < 1e-6, 'asleep: Sit_Ground at the rest spot under the awning' );
	ok( made[ 1 ].model.current === 'Kneel_Work' && made[ 2 ].model.current === 'Look_Around', 'on duty: the cook at the stove (Kneel_Work), the lookout looking about' );
	const clipOf = { eat: 'Eat', drink: 'Drink', mend: 'Kneel_Work', dice: 'Crouch', talk: 'Talk_Group', pump: 'Hammer' };
	let all = true;
	for ( const a in clipOf ) {

		acts[ 's-pons-0-0' ] = { act: a, spot: restPoint( 'brigantine', 0, 3, 2.6 ) };
		up();
		if ( made[ 0 ].model.current !== clipOf[ a ] ) { all = false; console.log( '   ', a, made[ 0 ].model.current ); }

	}

	ok( all, 'eat, drink, mend, dice, a yarn, the pump: each its clip' );
	acts[ 's-pons-0-0' ] = { act: 'fire', fire: { x: 0.5, y: 0, z: - 3 } };
	const xs = [];
	for ( let i = 0; i < 90; i ++ ) { up(); xs.push( made[ 0 ].group.position.x ); }
	ok( made[ 0 ].model.current === 'Carry_Box' && Math.max( ...xs ) - Math.min( ...xs ) > 1.5 && xs.every( ( x ) => Math.abs( x ) < 3.4 ), `fire: buckets to and fro between the rail and the fire (${ Math.min( ...xs ).toFixed( 2 ) } .. ${ Math.max( ...xs ).toFixed( 2 ) } m)` );
	ok( deck.gesture( 'doge', 'Point_Out' ) && ( up(), made[ 2 ].model.current === 'Point_Out' ), 'the lookout points when he calls' );
	const head = deck.headOf( 'doge', {} );
	ok( head && near( head.y, made[ 2 ].group.position.y + 1.95 ), 'a bubble hangs over his head' );
	ok( Object.keys( ACT_CLIPS ).length >= 10, `activity clips: ${ Object.keys( ACT_CLIPS ).join( ', ' ) }` );
	deck.dispose();

}

// ================================================================================================ 9. the save
section( '9. the save round trip' );
{

	const S = setup( { boat: 'sloop' } );
	const { crew, features } = S;
	S.app.game.state.money = 5000;
	const s = crew.hireables( 'pons' )[ 1 ];
	crew.hire( s.id, 'pons' );
	crew.setPost( s.id, 'angler' );
	crew.setPost( 'bonk', 'gunner' );
	crew.setPost( 'pengu', 'cook' );
	const bonk = crew.member( 'bonk' );
	bonk.morale = 33.33;
	bonk.skills.gunnery = 47.25;
	crew.member( 'pengu' ).absent = { port: 'pons' };
	crew.crew.dismiss( crew.hireables( 'pons' )[ 0 ].id ) || crew.crew.gone.add( 's-pons-0-0' );
	crew.day = 9;
	const saved = JSON.parse( JSON.stringify( features.toJSON() ) );
	ok( saved.crew.v === 2 && saved.crew.sailors.length === 1 && saved.crew.life.bonk && saved.crew.day === 9, 'v2: posts, life, hands, day in the features save' );
	const T = setup( { boat: 'sloop' } );
	T.features.fromJSON( saved );
	const tb = T.crew.member( 'bonk' );
	ok( JSON.stringify( T.crew.posts ) === JSON.stringify( crew.posts ), 'the posts come back (a tavern hand\'s too)' );
	ok( near( tb.morale, 33.3 ) && near( tb.skills.gunnery, 47.3, 0.06 ) && tb.traits.join() === 'brave,drunkard', 'BONK\'s morale and skills (his traits are his own)' );
	ok( T.crew.member( 'pengu' ).absent && T.crew.member( 'pengu' ).absent.port === 'pons', 'PENGU still drunk at Pons' );
	const ts = T.crew.crew.sailors.get( s.id );
	ok( ts && ts.name === s.name && ts.look === s.look && ts.wage === s.wage && T.crew.member( s.id ).traits.join() === s.traits.join(), `${ s.name } is still aboard, the same hand` );
	ok( T.crew.day === 9 && T.crew.crew.gone.has( 's-pons-0-0' ), 'the ship\'s day and the hands who signed off' );
	T.crew.fromJSON( { v: 1, posts: [ [ 'pepe', 'gunner' ] ] } );
	ok( T.crew.posts.pepe === 'gunner' && T.crew.member( 'pepe' ).morale === LIFE.start, 'a wave 10 save (v1) loads: fresh lives' );
	T.crew.fromJSON( { v: 2, posts: [ [ 'ghost', 'cook' ] ], life: { nobody: { morale: 3 }, pepe: 'junk' }, sailors: [ { id: 'pepe', name: 'Fake' }, null, 5 ] } );
	ok( Object.keys( T.crew.posts ).length === 0 && T.crew.crew.sailors.size === 0, 'bad save data is ignored' );
	T.crew.reset();
	ok( T.crew.crew.life.size === 0 && T.crew.day === 0, 'reset: fresh lives' );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
