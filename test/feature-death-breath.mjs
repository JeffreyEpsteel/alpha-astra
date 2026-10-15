// Plain-node test of wave 22B's breath and drowning (src/features/death: Breath.js, headUnder, the death feature's breath):
// the drain (~30 s, faster sprint-swimming, more with the bonus), the warning, the damage and 'drowned' through the death
// feature's own rules (the cut, the respawn, the sea chest), surfacing refills in ~4 s, the ring's contextual model, and
// nobody drowning at the helm, on a deck, in a seat, in the seaplane, in a car, wading or floating at the surface. No DOM.
//   node test/feature-death-breath.mjs
import * as E from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import * as deathModule from '../src/features/death/index.js';
import { Breath, BREATH, headUnder, SWIM_EYE, RESPAWN_AT, DURATION } from '../src/features/death/index.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const store = () => { const m = new Map(); return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ) }; };
const terrain = new TerrainData();
const colliders = new Colliders();

// ================================================================================================ 1. Breath
section( '1. Breath: the drain, the warning, the damage, the refill' );
{

	const run = ( b, sec, o ) => { const evs = []; for ( let t = 0; t < sec - 1e-9; t += 0.05 ) { const e = b.update( 0.05, o ); if ( e ) evs.push( [ e, Math.round( ( t + 0.05 ) * 100 ) / 100 ] ); } return evs; };
	const b = new Breath();
	const evs = run( b, 40, { under: true } );
	const at = ( n ) => ( evs.find( ( e ) => e[ 0 ] === n ) || [ null, NaN ] )[ 1 ];
	ok( Math.abs( at( 'warn' ) - ( BREATH.air - BREATH.warn ) ) < 0.1, `the warning ${ BREATH.warn } s before the air is out (at ${ at( 'warn' ) } s)` );
	ok( Math.abs( at( 'empty' ) - BREATH.air ) < 0.1, `~${ BREATH.air } s of air (out at ${ at( 'empty' ) } s)` );
	ok( Math.abs( at( 'drowned' ) - BREATH.air - BREATH.damage ) < 0.1, `then ${ BREATH.damage } s of damage: drowned at ${ at( 'drowned' ) } s` );
	ok( evs.filter( ( e ) => e[ 0 ] === 'warn' ).length === 1, 'one warning per dive' );
	const s = new Breath();
	const se = run( s, 25, { under: true, sprint: true } );
	const sEmpty = ( se.find( ( e ) => e[ 0 ] === 'empty' ) || [] )[ 1 ];
	ok( Math.abs( sEmpty - BREATH.air / BREATH.sprint ) < 0.1, `sprint-swimming under water: out after ${ sEmpty } s` );
	const u = new Breath(); u.bonus = 1.5;
	const ue = run( u, 50, { under: true } );
	ok( Math.abs( ( ue.find( ( e ) => e[ 0 ] === 'empty' ) || [] )[ 1 ] - 45 ) < 0.1, 'a 1.5 x upgrade: 45 s' );
	// surfacing refills in ~4 s
	const r = new Breath();
	run( r, 29, { under: true } );
	ok( r.air < 0.05, 'nearly out' );
	run( r, 2, { under: false } );
	ok( r.air > 0.5 && r.air < 0.6, `surfacing: ${ ( r.air * 100 ).toFixed( 0 ) } % after 2 s` );
	run( r, 2, { under: false } );
	ok( r.air === 1 && r.drowning === 0, 'full after ~4 s' );
	run( r, 23, { under: true } );
	ok( r.update( 0.05, { under: true } ) === null && r.warned, 'the next dive warns again once the lungs filled' );
	// drowning stops when you surface
	const d = new Breath();
	run( d, 33, { under: true } );
	ok( d.drowning > 2 && d.hurt > 0.3, `drowning: hurt ${ d.hurt.toFixed( 2 ) }` );
	run( d, 0.1, { under: false } );
	ok( d.drowning === 0 && d.hurt === 0, 'one breath at the surface ends the damage' );

}

section( '2. the ring (contextual)' );
{

	const b = new Breath();
	const tick = ( sec, o ) => { for ( let t = 0; t < sec - 1e-9; t += 0.05 ) b.update( 0.05, o ); };
	ok( ! b.ring().show, 'full lungs at the surface: no ring' );
	tick( 0.3, { under: true } ); tick( 0.5, { under: false } );
	ok( ! b.ring().show, 'a wave over the face (0.3 s): no ring' );
	b.reset();
	tick( 1, { under: true } );
	let m = b.ring();
	ok( m.show && m.tone === 'ok' && m.vignette === 0 && m.frac < 1, `under: the ring, ${ ( m.frac * 100 ).toFixed( 0 ) } % air, no vignette` );
	tick( 25, { under: true } );
	m = b.ring();
	ok( m.tone === 'warn' && m.vignette > 0.3 && m.pulse > 0, `the last ${ BREATH.warn } s: amber, pulsing, the vignette closes (${ m.vignette.toFixed( 2 ) })` );
	tick( 6, { under: true } );
	m = b.ring();
	ok( m.tone === 'out' && m.vignette > 0.75, `out of air: red, vignette ${ m.vignette.toFixed( 2 ) }` );
	tick( 1, { under: false } );
	m = b.ring();
	ok( m.show && m.vignette === 0 && m.tone === 'ok', 'surfaced: the ring stays while the lungs fill, the vignette is gone' );
	tick( 6, { under: false } );
	ok( ! b.ring().show, 'full again: the ring goes' );

}

// ================================================================================================ 3. the death feature
function rig( { mode = 'campaign', player = {} } = {} ) {

	const state = new GameState( store() );
	state.setMode( mode );
	state.money = 500;
	state.inventory = [ { species: 'snapper', kg: 2 } ];
	const keys = new Set();
	const input = { down: ( c ) => keys.has( c ), hit: () => false };
	const p = { mode: 'swim', floating: false, position: new E.Vector3( 300, - 3, 900 ), velocity: new E.Vector3(), waterH: 0, yaw: 0, stamina: 1, launched: 0, input, ...player };
	const toasts = [];
	const app = { mode, terrainData: terrain, colliders, input, player: p, settings: { timeSpeed: 0 }, game: { state, toast: ( t ) => toasts.push( t ) } };
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'playerDied', 'playerRespawned', 'breathLow', 'breathOut' ] ) features.on( n, ( e ) => events.push( { n, ...e } ) );
	const combat = { hp: 100, maxHp: 100 };
	features.list.set( 'melee', { module: null, instance: { combat } } );
	const death = features.add( 'death', deathModule );
	death._raf = null;
	const run = ( sec, each ) => { for ( let t = 0; t < sec - 1e-9; t += 1 / 30 ) { if ( each ) each( t ); features.update( 1 / 30 ); } };
	return { app, p, keys, features, events, death, combat, state, toasts, run };

}

section( '3. drowning through the death feature' );
{

	const r = rig();
	ok( headUnder( r.app, r.features ), `diving 3 m down: the head is under (eyes ${ SWIM_EYE } m over the body)` );
	r.run( BREATH.air - BREATH.warn + 0.2 );
	ok( r.events.some( ( e ) => e.n === 'breathLow' && e.left <= BREATH.warn ), 'breathLow { left } with 8 s to go (sfx patch)' );
	r.run( BREATH.warn + 0.2 );
	ok( r.events.some( ( e ) => e.n === 'breathOut' ), 'breathOut when the air is gone' );
	r.run( BREATH.damage * 0.5 );
	ok( r.combat.hp < 70 && r.combat.hp >= 1 && ! r.death.dying, `the damage: hit points ${ r.combat.hp } (never under 1 until the end)` );
	r.run( BREATH.damage * 0.5 + 0.2 );
	const died = r.events.find( ( e ) => e.n === 'playerDied' );
	ok( died && died.cause === 'drowned' && r.death.dying && r.death.dying.title === 'Drowned', `playerDied { cause: drowned } and the cut ("${ r.death.dying && r.death.dying.title }")` );
	ok( r.death.crate && r.death.crate.loot.fish.length === 1, 'the existing rules: your sea chest lies where you drowned' );
	r.run( DURATION + 0.2 );
	ok( r.p.mode === 'walk' && r.combat.hp === 100 && r.death.breath.air === 1, 'you wake at Jade Landing: on foot, full health, full lungs' );
	ok( r.events.some( ( e ) => e.n === 'playerRespawned' && e.cause === 'drowned' ), 'playerRespawned { cause: drowned }' );
	ok( r.events.filter( ( e ) => e.n === 'playerDied' ).length === 1, 'one death' );

}

section( '4. surfacing in time; who never drowns' );
{

	const r = rig();
	r.run( 28 );
	r.p.position.y = - SWIM_EYE + 0.1; r.p.floating = true; // at the surface, eyes out
	r.run( 4.2 );
	ok( r.death.breath.air === 1 && ! r.death.dying, 'up for air at 28 s: full lungs again after ~4 s, alive' );
	const never = [
		[ 'at the helm', { mode: 'boat' } ], [ 'on deck', { mode: 'deck' } ], [ 'aboard a ship', { mode: 'aboard' } ], [ 'in a seat', { mode: 'seat' } ],
		[ 'in the seaplane (the crash rules let you out first)', { mode: 'plane' } ], [ 'riding with another player', { mode: 'ride' } ],
		[ 'wading / walking on the bottom', { mode: 'walk' } ], [ 'floating at the surface', { mode: 'swim', floating: true, position: new E.Vector3( 300, - 0.06, 900 ) } ],
	];
	for ( const [ what, pl ] of never ) {

		const q = rig( { player: pl } );
		q.run( 45 );
		ok( ! q.death.dying && q.death.breath.air === 1, `${ what }: no drowning` );

	}

	const c = rig();
	c.features.list.set( 'cars', { module: null, instance: { driving: true } } );
	c.run( 45 );
	ok( ! c.death.dying, 'driving a car: no drowning' );
	const s = rig( { mode: 'sandbox' } );
	s.run( 37 );
	ok( s.events.some( ( e ) => e.n === 'playerDied' && e.cause === 'drowned' ) && ! s.death.crate, 'the sandbox drowns too (and keeps everything)' );
	// sprinting under water burns the air faster
	const f = rig();
	f.keys.add( 'ShiftLeft' );
	f.run( 20 );
	ok( f.death.breath.air === 0, 'sprint-swimming: out of air in under 20 s' );

}

section( '5. a capsized boat is towed home at the respawn' );
{

	let resets = 0;
	const r = rig();
	r.app.boatCtl = { capsized: true, enabled: true, driven: false, reset() { resets ++; this.capsized = false; } };
	r.death.kill( 'drowned' );
	r.run( RESPAWN_AT + 0.1 );
	const ev = r.events.find( ( e ) => e.n === 'playerRespawned' );
	ok( resets === 1 && ! r.app.boatCtl.capsized && ev && ev.towed, 'drowned beside her upturned hull: she is towed back to her berth' );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
if ( fails ) process.exit( 1 );
