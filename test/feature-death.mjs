// Plain-node test of wave 4's losing things: the death feature (src/features/death: causes, the cut, the respawn at Jade
// Landing, the sea chest with its claim on foot and by diving, replacement, expiry, the save, the sandbox), the generic map
// markers (worldmap.addMarker -> the world map's list and the minimap), the player's boat sinking over SINK_TIME into a
// wreck (naval + Wrecks.js: her hold, salvage, trade-away, remote wrecks, the save mid-sinking) and the seaplane crash hook.
// No DOM, no GPU.
//   node test/feature-death.mjs
import * as E from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import * as deathModule from '../src/features/death/index.js';
import { Death, KEEP, EXPIRE_HOURS, LOST_AFTER, RESPAWN_AT, DURATION, causeTitle, landWithin } from '../src/features/death/index.js';
import { strip, stow, isEmpty, clean, summary } from '../src/features/death/Belongings.js';
import { Naval } from '../src/features/naval/Naval.js';
import { SINK_TIME } from '../src/features/naval/Ship.js';
import { Wrecks, salvageCostFor, floorPose } from '../src/features/naval/Wrecks.js';
import * as worldmap from '../src/features/worldmap/index.js';
import * as seaplane from '../src/features/seaplane/index.js';
import { SITE } from '../src/features/seaplane/index.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Player } from '../src/player/Player.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ) };

};

const terrain = new TerrainData();
const colliders = new Colliders();
const SEA_FAR = { x: 800, z: - 800 }; // (0, 700 is Blackwater's caldera since wave 12; the lost range is 300 m now) // deep water, no land within 450 m
const SEA_NEAR = { x: - 50, z: 300 }; // deep water a swim from the shore (z 450 until wave 14D: Blackwater's north shore was the land in reach there)

// a stand-in of the trade feature's hold
function fakeTrade() {

	const lots = {};
	return {
		lots,
		get cargo() {

			const out = {};
			for ( const g in lots ) if ( lots[ g ].qty > 0 ) out[ g ] = { qty: lots[ g ].qty, cond: lots[ g ].cond, paid: lots[ g ].paid, crates: lots[ g ].qty, kg: 0 };
			return out;

		},
		takeCargo( g, n ) {

			const l = lots[ g ];
			if ( ! l ) return { qty: 0, paid: 0 };
			const m = Math.min( n, l.qty ), paid = l.paid * m / l.qty;
			l.qty -= m;
			l.paid -= paid;
			return { qty: m, paid };

		},
		addCargo( g, n, { cond = 1, paid = 0 } = {} ) {

			const l = lots[ g ] || ( lots[ g ] = { qty: 0, cond, paid: 0 } );
			l.qty += n;
			l.paid += paid;
			l.cond = cond;
			return n;

		},
	};

}

function fish( id, kg = 2 ) {

	return { id, species: 'bass', kg, cm: 40, value: 30, caughtAt: 1, record: false };

}

class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

// a registry with GameState, a stand-in player, the fake trade and the death feature (+ whatever `extra` installs)
function world( { mode = 'campaign', money = 1000, player = null, naval = false, map = false, boat = 'lobster' } = {} ) {

	const state = new GameState( store() );
	state.setMode( mode );
	state.money = money;
	state.boat = boat;
	state.inventory = [ fish( 1 ), fish( 2, 5 ) ];
	const input = new InputStub();
	const toasts = [];
	const p = player || { mode: 'walk', position: new E.Vector3( 60, 2, 200 ), velocity: new E.Vector3(), yaw: 0, stamina: 0.3, launched: 0, boat: null,
		setBoat( b ) { if ( [ 'boat', 'deck', 'seat' ].includes( this.mode ) ) this.mode = 'walk'; this.boat = b; } };
	const sent = [];
	const app = {
		mode, terrainData: terrain, colliders, input, player: p, settings: { timeOfDay: 12, timeSpeed: 0 },
		camera: { position: new E.Vector3( 0, 5, 0 ), quaternion: new E.Quaternion() },
		game: { state, toast: ( t ) => toasts.push( t ), minimap: null },
		netsync: { sendWorldEvent: ( kind, data ) => { sent.push( { kind, data } ); return true; } },
	};
	const features = new Features( app );
	const events = [];
	for ( const n of [ 'playerDied', 'playerRespawned', 'crateClaimed', 'crateExpired', 'playerBoatSunk', 'wreckSalvaged', 'wreckLooted' ] ) features.on( n, ( e ) => events.push( { n, ...e } ) );
	const trade = fakeTrade();
	trade.addCargo( 'rum', 4, { paid: 80, cond: 0.9 } );
	features.list.set( 'trade', { module: null, instance: trade } );
	let nv = null, wm = null;
	if ( map ) wm = features.add( 'worldmap', worldmap );
	if ( naval ) nv = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 3, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const death = features.add( 'death', deathModule );
	const run = ( seconds, dt = 0.05, each = null ) => {

		const n = Math.round( seconds / dt );
		for ( let i = 0; i < n; i ++ ) {

			features.update( dt );
			if ( each ) each( i );
			input.endFrame();

		}

	};

	return { state, app, features, events, trade, death, naval: nv, wm, player: p, input, toasts, sent, run };

}

const count = ( W, n ) => W.events.filter( ( e ) => e.n === n ).length;

// ================================================================================================ 1. belongings
section( '1. belongings: strip and stow' );
{

	const W = world();
	const b = strip( W.features, { fish: true, cargo: true, money: true, keep: 100 } );
	ok( b.fish.length === 2 && W.state.inventory.length === 0, 'the fish leave the cooler' );
	ok( b.cargo.length === 1 && b.cargo[ 0 ].good === 'rum' && b.cargo[ 0 ].qty === 4 && Math.abs( b.cargo[ 0 ].paid - 80 ) < 1e-9 && ! W.trade.cargo.rum, 'the cargo leaves the hold (paid and condition kept)' );
	ok( b.money === 900 && W.state.money === 100, 'the purse above the keep' );
	ok( summary( b ) === '2 fish · 4 crates · $900', `summary: ${ summary( b ) }` );
	const earned = W.state.career.earned;
	const got = stow( W.features, b );
	ok( got.fish === 2 && got.cargo === 4 && got.money === 900 && W.state.money === 1000 && W.state.inventory.length === 2 && W.trade.cargo.rum.qty === 4, 'stow gives it all back' );
	ok( W.state.career.earned === earned, 'a returned purse is not counted as money made' );
	ok( isEmpty( clean( { fish: [ { species: 3 } ], cargo: [ { good: 'x', qty: - 1 } ], money: 'lots' } ) ) && isEmpty( clean( null ) ), 'clean() drops garbage' );

}

// ================================================================================================ 2. a death
section( '2. death: the cut, the chest, the respawn' );
{

	const W = world( { money: 1500 } );
	const { death, player, features } = W;
	ok( causeTitle( 'melee', { by: 'Rook' } ) === 'Knocked out by Rook' && causeTitle( 'lost' ) === 'Lost at sea' && causeTitle( 'seaplane', { text: 'Nose-in' } ) === 'Nose-in', 'cause lines' );
	// the melee module's knockout arrives as playerDied
	features.emit( 'playerDied', { cause: 'melee', by: 'Rook', x: 60, y: 2, z: 200 } );
	ok( death.dying && death.dying.cause === 'melee' && death.dying.title === 'Knocked out by Rook', 'another module\'s playerDied starts the cut' );
	ok( count( W, 'playerDied' ) === 1, 'and is not announced twice' );
	ok( death.crate && death.crate.loot.fish.length === 2 && death.crate.loot.cargo[ 0 ].qty === 4 && death.crate.loot.money === 1500 - KEEP, 'the chest holds the fish, the crates and the purse above the keep' );
	ok( W.state.money === KEEP && W.state.inventory.length === 0 && ! W.trade.cargo.rum, `you keep $${ KEEP }` );
	ok( death.kill( 'lost' ) === false && death.dying.cause === 'melee', 'a second death while the cut plays is ignored' );
	W.run( RESPAWN_AT * 0.5 );
	ok( player.position.x === 60 && player.velocity.x === 0, 'held in place while the screen goes black' );
	W.run( RESPAWN_AT * 0.6 );
	const s = WORLD.start.position;
	ok( Math.hypot( player.position.x - s.x, player.position.z - s.z ) < 0.01 && player.mode === 'walk' && player.stamina === 1, 'you wake at Jade Landing on foot, rested' );
	ok( Math.abs( player.position.y - ( Math.max( terrain.heightAt( s.x, s.z ), colliders.groundHeightAt( s.x, s.z, 50 ) ?? - Infinity ) + 0.05 ) ) < 0.01, 'standing on the ground there' );
	ok( count( W, 'playerRespawned' ) === 1 && W.events.find( ( e ) => e.n === 'playerRespawned' ).cause === 'melee', 'playerRespawned { cause }' );
	W.run( DURATION );
	ok( death.dying === null, 'the cut ends' );

	// walk back to the chest: E on foot (Game's feature prompt)
	player.position.set( death.crate.x + 1, death.crate.y + 0.5, death.crate.z );
	const it = features.nearestInteractable( player.position );
	ok( it && /sea chest/.test( it.prompt() ), `E: "${ it && it.prompt() }"` );
	it.onInteract();
	ok( ! death.crate && W.state.money === 1500 && W.state.inventory.length === 2 && W.trade.cargo.rum.qty === 4, 'claimed: everything back' );
	ok( count( W, 'crateClaimed' ) === 1 && W.events.find( ( e ) => e.n === 'crateClaimed' ).money === 1500 - KEEP, 'crateClaimed { fish, cargo, money }' );
	ok( ! features.nearestInteractable( player.position ), 'nothing left to claim' );

}

// ================================================================================================ 3. at sea, replace, expire, sandbox, save
section( '3. the chest at sea, replaced, expired; the sandbox; the save' );
{

	const W = world();
	const { death, player } = W;
	player.mode = 'swim';
	player.position.set( SEA_NEAR.x, - 0.4, SEA_NEAR.z );
	death.kill( 'drowned' );
	const floor = terrain.heightAt( SEA_NEAR.x, SEA_NEAR.z );
	ok( death.crate && Math.abs( death.crate.y - floor ) < 1e-6 && floor < - 5, `on the sea floor (${ floor.toFixed( 1 ) } m)` );
	W.run( DURATION + 0.1 );
	// dive to it: Game offers no prompts in the water, the feature does
	player.mode = 'swim';
	player.position.set( death.crate.x, death.crate.y + 6, death.crate.z );
	player.prompt = null;
	W.input.pressed.add( 'KeyE' );
	W.run( 0.05 );
	ok( death.crate && ! player.prompt, 'out of reach at the surface' );
	player.position.y = death.crate.y + 1.5;
	W.input.pressed.add( 'KeyE' );
	death.update( 0.016 );
	ok( ! death.crate && W.state.inventory.length === 2, 'diving beside it, E claims it' );

	// a second death replaces an unclaimed chest
	W.run( 0.1 );
	player.mode = 'walk';
	player.position.set( 60, 2, 200 );
	death.kill( 'melee' );
	const first = death.crate;
	W.run( DURATION + 0.1 );
	W.state.money = 700;
	W.state.inventory = [ fish( 9 ) ];
	death.kill( 'melee' );
	ok( death.crate !== first && death.crate.loot.fish.length === 1 && death.crate.loot.fish[ 0 ].id === 9 && death.crate.loot.money === 600, 'a new death: a new chest, the old contents are lost' );
	W.run( DURATION + 0.1 );

	// two in-game days
	W.app.settings.timeSpeed = 1; // hours per second
	W.run( EXPIRE_HOURS - 1, 0.5 );
	ok( death.crate, 'still there after 47 in-game hours' );
	W.run( 1.5, 0.5 );
	ok( ! death.crate && count( W, 'crateExpired' ) === 1, 'gone after 48 (crateExpired)' );

	// save round trip
	W.app.settings.timeSpeed = 0;
	W.state.inventory = [ fish( 11 ) ];
	W.state.money = 400;
	death.kill( 'melee' );
	W.run( 0.5 );
	const saved = JSON.parse( JSON.stringify( W.features.toJSON().death ) );
	const W2 = world();
	W2.features.fromJSON( { death: saved } );
	ok( W2.death.crate && W2.death.crate.loot.fish[ 0 ].id === 11 && W2.death.crate.loot.money === 300 && W2.death.stats.deaths === W.death.stats.deaths, 'the chest survives a save' );
	W2.death.fromJSON( { crate: { x: 'a' } } );
	ok( ! W2.death.crate, 'a broken save drops it' );
	W2.death.fromJSON( saved );
	W2.death.reset();
	ok( ! W2.death.crate && W2.death.stats.deaths === 0, 'reset() clears it' );

	// sandbox: nothing is taken
	const S = world( { mode: 'sandbox', money: 900 } );
	S.death.kill( 'melee' );
	ok( S.death.dying && ! S.death.crate && S.state.money === 900 && S.state.inventory.length === 2 && S.trade.cargo.rum.qty === 4, 'sandbox: you keep everything, no chest' );

}

// ================================================================================================ 4. map markers
section( '4. map markers: the world map list and the minimap' );
{

	const W = world( { map: true } );
	const added = new Map();
	W.app.game.minimap = { addMarker: ( m ) => added.set( m.id, { ...m } ), removeMarker: ( id ) => added.delete( id ), setWaypoint() {} };
	ok( W.wm && typeof W.wm.addMarker === 'function', 'worldmap.addMarker exists' );
	W.death.kill( 'melee' );
	W.run( 0.1 );
	const m = W.wm.markers.get( 'sea-chest' );
	ok( m && m.kind === 'death' && m.icon === 'chest' && m.mine === true && m.x === W.death.crate.x, 'the death spot is marked (mine)' );
	ok( added.has( 'sea-chest' ), 'and forwarded to the minimap' );
	const list = [];
	W.player.position.set( W.death.crate.x + 300, 0, W.death.crate.z );
	W.wm._collectMarkers( list );
	ok( list.length === 1 && list[ 0 ].key === 'pin:sea-chest' && list[ 0 ].label === 'Your sea chest · 300 m' && list[ 0 ].edge && /<svg/.test( list[ 0 ].icon ), `world map entry: "${ list[ 0 ] && list[ 0 ].label }"` );
	W.wm.addMarker( { id: 'x', kind: 'bad kind!', x: 1, z: 2, icon: 'nope' } );
	ok( W.wm.markers.get( 'x' ).kind === 'pin' && W.wm.addMarker( { id: 'y', x: NaN, z: 0 } ) === false, 'kinds are sanitised, bad positions refused' );
	W.wm.removeMarker( 'x' );
	W.run( DURATION + 0.1 );
	W.death.claim();
	W.run( 0.05 );
	ok( ! W.wm.markers.has( 'sea-chest' ) && ! added.has( 'sea-chest' ), 'claimed: cleared on both maps' );

}

// ================================================================================================ 5. the player's boat goes down
section( '5. naval: sinking, overboard, wreck, salvage' );
function navalWorld( o = {} ) {

	const W = world( { naval: true, map: true, ...o } );
	const app = W.app;
	app.boatCtl = { position: new E.Vector3( SEA_NEAR.x, 0, SEA_NEAR.z ), quaternion: new E.Quaternion(), velocity: new E.Vector3( 3, 0, 0 ), angular: new E.Vector3(), driven: true, moored: false, enabled: true,
		reset() { this.position.set( 60, 0, 30 ); this.moored = true; this.resets = ( this.resets || 0 ) + 1; } };
	app.boat = { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 }, group: { position: new E.Vector3( SEA_NEAR.x, 0, SEA_NEAR.z ), quaternion: new E.Quaternion(), visible: true } };
	W.player.mode = 'boat';
	W.player.boat = app.boatCtl;
	W.player.position.set( SEA_NEAR.x, 1, SEA_NEAR.z );
	return W;

}
{

	const W = navalWorld();
	const { naval, player, app } = W;
	naval.damagePlayer( 9999, 'cannon' );
	const ev = W.events.find( ( e ) => e.n === 'playerBoatSunk' );
	ok( ev && ev.aboard && ! ev.boarded && ev.boat === 'lobster', 'playerBoatSunk { aboard, boarded: false }' );
	ok( player.mode === 'swim' && player.boat === null && app.boatCtl.enabled === false && app.boatCtl.driven === false, 'thrown overboard; the controller frozen; nobody can board her' );
	ok( naval.sinking && naval.sinking.loot.cargo[ 0 ].qty === 4 && naval.sinking.loot.fish.length === 2 && W.state.inventory.length === 0, 'her hold (crates and, aboard, the fish) goes down with her' );
	ok( ! W.death.dying, 'near the shore you live' );
	const y0 = app.boat.group.position.y;
	W.run( SINK_TIME / 2 );
	const g = app.boat.group;
	const roll = 2 * Math.asin( Math.min( 1, Math.hypot( g.quaternion.x, g.quaternion.z ) ) );
	ok( g.position.y < y0 - 0.3 && roll > 0.5 && g.visible, `half way: settling (${ g.position.y.toFixed( 2 ) } m) and listing (${ ( roll * 57.3 ).toFixed( 0 ) } deg)` );
	ok( naval.repair( { free: true } ) === false, 'no repair while she goes down' );
	W.run( SINK_TIME / 2 + 0.2 );
	const w = naval.wreck;
	ok( ! naval.sinking && w && w.boat === 'lobster' && w.y < terrain.heightAt( w.x, w.z ) + 1 && Math.abs( w.roll ) > 0.4, 'a wreck on the floor, listed' );
	ok( g.visible === false && g.position.y === - 400 && app.boatCtl.position.y === - 400 && naval.playerHull.sunk, 'the boat is gone (hidden, parked)' );
	ok( W.wm.markers.get( 'wreck' ) && W.wm.markers.get( 'wreck' ).kind === 'wreck' && /Lobster boat/.test( W.wm.markers.get( 'wreck' ).label ), 'the wreck is on the maps' );
	ok( W.sent.some( ( s ) => s.kind === 'wreck' && s.data.boat === 'lobster' && s.data.id === w.id ), 'and announced to the others (sendWorldEvent wreck)' );

	// dive to her hold
	player.mode = 'swim';
	player.position.set( w.x + 1, w.y + 2, w.z );
	W.input.pressed.add( 'KeyE' );
	W.run( 0.05 );
	ok( isEmpty( w.loot ) && W.trade.cargo.rum.qty === 4 && W.state.inventory.length === 2 && count( W, 'wreckLooted' ) === 1, 'E beside the wreck recovers her hold' );

	// salvage at the yard
	const cost = naval.salvageCost();
	ok( cost === salvageCostFor( 'lobster' ) && cost === 2250, `salvage $${ cost }` );
	W.state.money = 100;
	ok( naval.salvage() === false && naval.wreck, 'too poor to raise her' );
	W.state.money = 3000;
	player.mode = 'walk';
	ok( naval.salvage() === true && ! naval.wreck && ! naval.wrecks.own && W.state.money === 750, 'raised for the fee' );
	ok( app.boatCtl.enabled === true && app.boat.group.visible && player.boat === app.boatCtl && app.boatCtl.resets === 1 && naval.playerHull.hp === naval.playerHull.max, 'afloat at her berth, boardable, hull sound' );
	ok( count( W, 'wreckSalvaged' ) === 1 && W.sent.some( ( s ) => s.kind === 'wreckSalvaged' && s.data.id === w.id ), 'wreckSalvaged emitted and sent' );
	W.run( 0.1 );
	ok( ! W.wm.markers.has( 'wreck' ), 'off the maps' );

}

// ================================================================================================ 6. deaths at sea
section( '6. deaths at sea: boarded, lost, towed home' );
{

	// a boarding party on deck as she goes: dead
	const A = navalWorld();
	A.features.list.set( 'boarding', { module: null, instance: { hostile: { phase: 'fight' } } } );
	A.state.money = 2000;
	A.naval.damagePlayer( 9999, 'cannon' );
	ok( A.death.dying && A.death.dying.cause === 'sunk' && count( A, 'playerDied' ) === 1, 'sunk with boarders aboard: death (cause sunk)' );
	ok( A.naval.sinking.loot.cargo.length === 1 && A.death.crate && A.death.crate.loot.money === 2000 - KEEP && A.death.crate.loot.cargo.length === 0, 'her crates went with the wreck, your purse into the chest' );
	A.run( SINK_TIME + 0.5 );
	ok( A.naval.wreck && A.player.mode === 'walk' && A.app.boatCtl.resets === undefined, 'respawned ashore; the wreck is not towed anywhere' );

	// overboard far from land: lost at sea
	const B = navalWorld();
	B.app.boatCtl.position.set( SEA_FAR.x, 0, SEA_FAR.z );
	B.player.position.set( SEA_FAR.x, 1, SEA_FAR.z );
	ok( ! landWithin( terrain, SEA_FAR.x, SEA_FAR.z ) && landWithin( terrain, SEA_NEAR.x, SEA_NEAR.z ), 'land within 450 m: none out there, some near the island' );
	B.naval.damagePlayer( 9999, 'cannon' );
	ok( ! B.death.dying, 'not at once' );
	B.run( LOST_AFTER - 0.5 );
	ok( ! B.death.dying, 'a few seconds in the water' );
	B.run( 1 );
	ok( B.death.dying && B.death.dying.cause === 'lost' && B.death.crate && Math.abs( B.death.crate.y - terrain.heightAt( B.player.position.x, B.player.position.z ) ) < 30, 'then lost at sea: the chest on the floor out there' );

	// boarders win while you are at the helm: dead, the boat towed home
	const C = navalWorld();
	C.features.emit( 'boardersWon', { captain: 'Mara Redwake', coins: 50 } );
	ok( C.death.dying && C.death.dying.title === "Mara Redwake's boarders took the deck" && C.death.dying.aboard, 'boardersWon: death at the helm' );
	C.run( RESPAWN_AT + 0.1 );
	ok( C.app.boatCtl.resets === 1 && C.events.find( ( e ) => e.n === 'playerRespawned' ).towed === true, 'the boat is towed back to her berth' );

}

// ================================================================================================ 7. wreck edge cases
section( '7. wrecks: the save mid-sinking, trade-away, remote wrecks' );
{

	const W = navalWorld();
	W.naval.damagePlayer( 9999, 'cannon' );
	W.run( 1 );
	const saved = JSON.parse( JSON.stringify( W.features.toJSON().naval ) );
	ok( saved.wreck && saved.wreck.boat === 'lobster' && saved.wreck.loot.cargo[ 0 ].qty === 4, 'a save mid-sinking records the wreck with her hold' );
	const L = navalWorld();
	L.features.fromJSON( { naval: saved } );
	L.run( 0.1 );
	ok( L.naval.wreck && L.naval.playerHull.sunk && L.app.boat.group.visible === false && L.player.boat === null, 'loaded: on the bottom, the boat hidden' );

	// traded away: no salvage, the hold stays for a diver, then the wreck goes
	L.state.boat = 'skiff';
	L.run( 0.1 );
	ok( ! L.naval.wreck && L.naval.wrecks.own && L.naval.wrecks.own.abandoned && L.naval.salvage( { free: true } ) === false, 'a new boat: the old wreck is abandoned (no salvage)' );
	ok( ! L.naval.playerHull.sunk && L.naval.playerHull.hp === L.naval.playerHull.max, 'the new boat is sound' );
	ok( L.naval.wrecks.claimLoot() && ! L.naval.wrecks.own, 'her hold recovered, the abandoned wreck is gone' );

	// another player's wreck arrives and leaves
	L.features.emit( 'remoteWorldEvent', { kind: 'wreck', data: { id: 'bob-1', boat: 'skiff', x: 10, z: 600, yaw: 1 }, from: 'bob' } );
	ok( L.naval.wrecks.remote.size === 1 && L.naval.wrecks.remote.get( 'bob-1' ).y === floorPose( terrain, 10, 600, 'skiff' ).y, 'a remote wreck settles on the floor' );
	ok( ! L.wm.markers.has( 'wreck' ), 'not on our maps' );
	L.features.emit( 'remoteWorldEvent', { kind: 'wreck', data: { id: 'bob-2', boat: 'warship', x: 0, z: 0 } } );
	L.features.emit( 'remoteWorldEvent', { kind: 'wreckSalvaged', data: { id: 'bob-1' } } );
	ok( L.naval.wrecks.remote.size === 0, 'unknown boats ignored; salvaged ones removed' );

	// a headless Wrecks with a model factory and a scene: the mesh is placed on the floor
	const scene = new E.Scene();
	const made = [];
	const wr = new Wrecks( { app: { terrainData: terrain }, scene, makeModel: ( id ) => {

		const g = new E.Group();
		made.push( g );
		return { group: g };

	} } );
	const r = wr.create( { boat: 'skiff', x: SEA_NEAR.x, z: SEA_NEAR.z, yaw: 0.5, list: - 1 } );
	await new Promise( ( res ) => setTimeout( res, 0 ) );
	ok( made.length === 1 && made[ 0 ].parent === scene && Math.abs( made[ 0 ].position.y - r.y ) < 1e-9 && Math.abs( made[ 0 ].rotation.z - r.roll ) < 1e-9 && r.roll < 0, 'the wreck model sits on the floor, listed' );
	wr.salvaged();
	ok( made[ 0 ].parent !== scene, 'and leaves the scene when raised' );
	wr.dispose();

}

// ================================================================================================ 8. seaplane crash
section( '8. the seaplane crash kills the pilot' );
{

	let time = 0;
	const query = {
		n: 1, cpu: new Float32Array( 128 * 4 ), points: new Float32Array( 128 * 4 ), cpuValid: false, version: 0, latency: 2 / 60,
		allocate( name, n ) { const s = this.n; this.n += n; return s; },
		setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
		tick() { this.cpuValid = true; this.version ++; time += 1 / 60; },
	};
	const input = new InputStub();
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	const player = new Player( { camera, input, terrain, colliders, query, boat: null } );
	const state = new GameState( store() );
	state.money = 50000;
	const app = { terrainData: terrain, colliders, query, input, camera, player, mode: 'campaign', settings: { timeSpeed: 0 }, game: { state, toast() {} } };
	const features = new Features( app );
	const evs = [];
	features.on( 'playerDied', ( e ) => evs.push( e ) );
	const sp = seaplane.install( app, features );
	features.list.set( 'seaplane', { module: seaplane, instance: sp } );
	const death = features.add( 'death', deathModule );
	ok( sp.buy().ok && sp.board() && player.mode === 'plane', 'bought and boarded the plane' );
	sp.flight.position.set( 0, 0.5, 300 );
	sp._crash( 'Nose-in at full power' );
	ok( evs.length === 1 && evs[ 0 ].cause === 'seaplane' && evs[ 0 ].text === 'Nose-in at full power', 'playerDied { cause: seaplane, text }' );
	ok( death.dying && death.dying.title === 'Nose-in at full power' && player.mode === 'swim' && Math.hypot( player.position.x, player.position.z - 300 ) < 0.01, 'out of the cockpit where it hit, the cut starts' );
	ok( Math.hypot( player.position.x - SITE.berth.x, player.position.z - SITE.berth.z ) > 50, 'not set down on the jetty' );
	for ( let i = 0; i < Math.ceil( ( RESPAWN_AT + 0.1 ) * 60 ); i ++ ) {

		query.tick();
		player.update( 1 / 60 );
		features.update( 1 / 60 );
		input.endFrame();

	}

	ok( player.mode === 'walk' && Math.hypot( player.position.x - WORLD.start.position.x, player.position.z - WORLD.start.position.z ) < 0.5, 'and wakes at Jade Landing' );

}

// ================================================================================================ 9. the cut while the game is paused
// Alpha report (wave 5): with the welcome guide open App skips features.update, so the cut could stop half way (a black
// screen, no respawn), and the cut could sit under the guide. It now runs on animation frames while update does not
// come, and its overlay lives on the UI root above every panel.
section( '9. the cut runs on while the game is paused, above every panel' );
{

	// a tiny DOM stand-in: the overlay only needs elements, classes and a parent
	const el = ( tag ) => {

		const e = { tag, children: [], parent: null, style: {}, attrs: {}, textContent: '', className: '',
			classList: { s: new Set(), add( c ) { this.s.add( c ); }, remove( c ) { this.s.delete( c ); }, contains( c ) { return this.s.has( c ); } },
			setAttribute( k, v ) { this.attrs[ k ] = v; }, append( ...cs ) { for ( const c of cs ) { c.parent = e; e.children.push( c ); } },
			remove() { if ( e.parent ) e.parent.children.splice( e.parent.children.indexOf( e ), 1 ); e.parent = null; } };
		return e;

	};

	const hadDoc = 'document' in globalThis;
	globalThis.document = { head: el( 'head' ), createElement: el };
	const W = world( { mode: 'sandbox' } );
	W.death.dispose();
	W.features.list.delete( 'death' );
	const root = el( 'div' ), hud = el( 'div' );
	root.append( hud );
	W.app.ui = { ui: { root, hud } };
	let T = 0;
	const frames = [];
	const death = W.features.add( 'death', { install: ( a, f ) => new Death( a, f, { now: () => T, raf: ( fn ) => frames.push( fn ) } ) } );
	ok( death.kill( 'melee' ) && frames.length === 1, 'a death starts an animation-frame loop' );
	ok( death.overlay && death.overlay.el.parent === root, 'the cut is on the UI root (not the HUD layer, which photo mode hides)' );
	const css = globalThis.document.head.children.map( ( c ) => c.textContent ).join( '' );
	const z = Number( ( /\.dt-cut \{[^}]*z-index:\s*(\d+)/.exec( css ) || [] )[ 1 ] );
	ok( z >= 900, `above every panel and the welcome guide (z-index ${ z })` );
	// the guide is open: no features.update at all, only animation frames
	let n = 0;
	while ( frames.length && n < 1000 ) {

		T += 1000 / 60;
		frames.shift()();
		n ++;

	}

	const s = WORLD.start.position, p = W.player;
	ok( death.dying === null && count( W, 'playerRespawned' ) === 1 && Math.hypot( p.position.x - s.x, p.position.z - s.z ) < 0.01, `the cut ran to the end on animation frames alone (${ n } frames), the respawn included` );
	ok( frames.length === 0 && death.overlay.alpha === 0 && ! death.overlay.el.classList.contains( 'is-on' ), 'then the loop stops and the screen is clear' );
	// the game running: update drives the cut and the loop stays out of the way (no double speed)
	death.kill( 'melee' );
	for ( let i = 0; i < 30; i ++ ) {

		T += 1000 / 60;
		W.features.update( 1 / 60 );
		const f = frames.shift();
		if ( f ) f();

	}

	ok( death.dying && Math.abs( death.dying.t - 0.5 ) < 1e-6, `with the game running, update alone drives it (t ${ death.dying && death.dying.t.toFixed( 3 ) } s after 0.5 s)` );
	W.features.update( DURATION );
	ok( death.dying === null, 'and it ends' );
	death.dispose();
	if ( ! hadDoc ) delete globalThis.document;

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
