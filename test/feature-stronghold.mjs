// Plain-node test of the Blackwater stronghold (wave 12B: src/features/pirates/Stronghold.js, Batteries.js, BlackMarket.js,
// src/world/islands/Blackwater.js and stronghold/*): the island's place in the world (inside the terrain, its water gaps, the
// cove and the channel deep enough, the fort on its pad), the batteries' fire decisions and salvos (and real balls through the
// naval feature onto the player's boat), the alarm state machine, the destructible fort (platforms silence their battery, the
// powder blows), the claim / restock / retake timeline with loot, notoriety and retaliation, the black market's prices and the
// standing gate, contraband flagged for customs, discovery and the world map's battery reach, the guards, the save.
//   node test/feature-stronghold.mjs
import { Vector3, Quaternion, Group, PerspectiveCamera } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import { Naval } from '../src/features/naval/Naval.js';
import * as piratesModule from '../src/features/pirates/index.js';
import * as meleeModule from '../src/features/melee/index.js';
import * as stronghold from '../src/features/pirates/Stronghold.js';
import { Alarm, Batteries, BATTERY_RULES, batteryDecision, lineClear, STRONGHOLD_RULES, MARKET_RULES, letIn, buyPrice, contrabandGoods, BlackMarket } from '../src/features/pirates/Stronghold.js';
import { contrabandAt, GOODS } from '../src/features/trade/goods.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { ISLETS, ISLETS_BY_ID, BLACKWATER } from '../src/world/terrain/IslandShape.js';
import { ensureBlackwater, HALF as TILE_HALF } from '../src/world/islands/BlackwaterTerrain.js';
import { PATROLS, BLACKWATER_PATROLS, MERCHANT_ROUTE, SAFE_ZONES, legs, inSafeZone } from '../src/features/naval/Routes.js';
import { strongholdLayout } from '../src/world/islands/stronghold/Layout.js';
import { STRONGHOLD_KINDS, strongholdPlan } from '../src/world/islands/stronghold/Kinds.js';
import { findJoints, layoutBounds } from '../src/features/destruction/Kinds.js';
import { MUZZLE_SPEED } from '../src/features/naval/Ballistics.js';

let fails = 0, passes = 0;
const ok = ( c, msg, info = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else { passes ++; console.log( 'ok  ', msg, info ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const DT = 1 / 20;
const terrain = new TerrainData();
const tile = ensureBlackwater( terrain ); // TerrainData's constructor does this once root applies the wave 14D patch (idempotent)
const L = strongholdLayout();

// ---------------------------------------------------------------- 1. the island in the world
section( '1. Blackwater in the world' );
const isl = WORLD.islands.find( ( i ) => i.id === 'blackwater' );
{

	ok( isl && isl.name === 'Blackwater' && isl.den === false && isl.pirate === true, 'WORLD.islands has Blackwater (den: false, pirate: true)' );
	ok( WORLD.blackwater && WORLD.blackwater.cove && WORLD.blackwater.entrance && WORLD.blackwater.dock, 'WORLD.blackwater: cove, entrance, dock' );
	ok( ! WORLD.ports.some( ( p ) => p.id === 'blackwater' ), 'not a port (no customs, no market cell, no harbourmaster)' );
	// footprint: land and the extent (wave 14D: on its own terrain tile beyond the heightmap's south edge)
	let land = 0, rim = Infinity, shoalRim = Infinity, peak = - 99;
	const R = 300;
	for ( let dz = - R; dz <= R; dz += 2 ) for ( let dx = - R; dx <= R; dx += 2 ) {

		const x = BLACKWATER.x + dx, z = BLACKWATER.z + dz;
		if ( terrain.islandAt( x, z ) !== 'blackwater' ) continue;
		const h = terrain.heightAt( x, z );
		const toRim = Math.min( x - tile.x0, tile.x1 - x, z - tile.z0, tile.z1 - z );
		if ( h > 0.3 ) land += 4;
		if ( h > 1 ) rim = Math.min( rim, toRim );
		if ( h > - 2.5 ) shoalRim = Math.min( shoalRim, toRim );
		peak = Math.max( peak, h );

	}

	ok( land > 60000 && peak > 50, 'a big volcanic island', `${ ( land / 1e4 ).toFixed( 1 ) } ha of land, peak ${ peak.toFixed( 0 ) } m` );
	ok( tile.z0 >= WORLD.terrainSize / 2 + 6 && tile.x1 - tile.x0 === 2 * TILE_HALF && rim > 140 && shoalRim > 125, 'on its own tile wholly outside the heightmap, inside it clear of its rim fade',
		`tile z ${ tile.z0 }..${ tile.z1 }, land ${ rim.toFixed( 0 ) } m and shoal ${ shoalRim.toFixed( 0 ) } m from the rim (fade 120 m)` );
	const d = Math.hypot( BLACKWATER.x - WORLD.boatDock.position.x, BLACKWATER.z - WORLD.boatDock.position.z );
	ok( d > 1300, 'far from the home harbour', d.toFixed( 0 ) + ' m from the pier head' );
	// the seaplane's take-off run from its berth (SITE.berth (0, -20), heading 0: due +z) has open water for 1 km
	let run = 0;
	for ( let z = 60; z <= 1400; z += 2 ) { if ( [ - 30, 0, 30 ].some( ( o ) => terrain.heightAt( o, z ) > - 1 ) ) break; run = z + 20; }
	ok( run > 1000, 'the seaplane take-off run due south is clear of Blackwater', `open water for ${ run } m from the berth` );
	// open water between its land and every other island's land (the heightmap's south band and the tile)
	const mine = [], others = {};
	for ( let z = 260; z <= 2000; z += 4 ) for ( let x = - 760; x <= 760; x += 4 ) {

		if ( terrain.heightAt( x, z ) <= 0.3 ) continue;
		const id = terrain.islandAt( x, z );
		if ( id === 'blackwater' ) mine.push( [ x, z ] );
		else ( others[ id ] || ( others[ id ] = [] ) ).push( [ x, z ] );

	}

	let gap = Infinity, gapTo = null;
	for ( const id in others ) for ( const [ x, z ] of others[ id ] ) for ( let k = 0; k < mine.length; k += 3 ) {

		const g = Math.hypot( x - mine[ k ][ 0 ], z - mine[ k ][ 1 ] );
		if ( g < gap ) { gap = g; gapTo = id; }

	}

	ok( gap > 400, 'open water to every other island', `${ gap.toFixed( 0 ) } m to ${ gapTo }` );
	ok( ! ISLETS.some( ( I ) => I.id === 'blackwater' ) && ISLETS_BY_ID.blackwater === BLACKWATER && terrain.tiles.filter( ( q ) => q.id === 'blackwater' ).length === 1, 'one terrain entry: its tile (no longer a heightmap islet)' );
	// the merchant lane and the port approaches stay in open water past it
	let lane = Infinity;
	for ( const [ a, b ] of legs( MERCHANT_ROUTE ) ) for ( let s = 0; s <= 1; s += 0.01 ) {

		const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * s, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * s;
		for ( let k = 0; k < mine.length; k += 3 ) lane = Math.min( lane, Math.hypot( x - mine[ k ][ 0 ], z - mine[ k ][ 1 ] ) );

	}

	ok( lane > 50, 'the merchant lane passes clear of its shore', lane.toFixed( 0 ) + ' m' );

}

{

	const H = ( p ) => terrain.heightAt( p.x ?? p[ 0 ], p.z ?? p[ 1 ] );
	ok( L.moorings.every( ( m ) => H( m ) < - 5 ), 'the cove holds the moored ships (> 5 m of water)', L.moorings.map( ( m ) => H( m ).toFixed( 1 ) ).join( ' ' ) );
	let ch = - 99;
	for ( const [ a, b ] of legs( L.sailOut ) ) for ( let s = 0; s <= 1; s += 0.02 ) for ( const o of [ - 5, 0, 5 ] ) {

		const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], l = Math.hypot( dx, dz );
		ch = Math.max( ch, terrain.heightAt( a[ 0 ] + dx * s - dz / l * o, a[ 1 ] + dz * s + dx / l * o ) );

	}

	ok( ch < - 4.5, 'the hidden entrance: a channel between the cliffs deep enough to sail out', 'shallowest ' + ch.toFixed( 1 ) + ' m' );
	const cliffs = [ - 1, 1 ].map( ( s ) => { const [ a, b ] = [ L.sailOut[ 1 ], L.sailOut[ 2 ] ]; const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], l = Math.hypot( dx, dz ); let hi = - 99; for ( let o = 24; o <= 50; o += 2 ) hi = Math.max( hi, terrain.heightAt( ( a[ 0 ] + b[ 0 ] ) / 2 - dz / l * o * s, ( a[ 1 ] + b[ 1 ] ) / 2 + dx / l * o * s ) ); return hi; } );
	ok( cliffs.every( ( h ) => h > 8 ), 'cliffs either side of the channel', cliffs.map( ( h ) => h.toFixed( 0 ) + ' m' ).join( ' / ' ) );
	ok( L.palisade.every( ( p ) => Math.abs( H( p ) - L.fort.y ) < 0.3 ) && L.batteries.every( ( b ) => Math.abs( H( b ) - b.y ) < 0.3 ), 'the fort and the gun platforms stand level on the headland', L.fort.y + ' m up' );
	ok( L.town.every( ( b ) => H( b ) > 1.2 && H( b ) < 4 ), 'the town on the crescent beach, above the water', L.town.map( ( b ) => H( b ).toFixed( 1 ) ).join( ' ' ) );
	ok( L.docks.every( ( d ) => H( d.start ) > 0.3 && H( d.start ) < 1.6 && H( d.end ) < - 2 ), 'three docks run from the sand into the cove' );
	ok( L.palisade.length >= 16 && L.batteries.length === 2 && L.batteries.every( ( b ) => b.guns.length === 3 ), 'a palisade of ' + L.palisade.length + ' runs, two batteries of three guns' );
	ok( Object.values( L.routes ).every( ( r ) => r.every( ( p ) => terrain.heightAt( p[ 0 ], p[ 1 ] ) > 0.4 ) ), 'the guards\' beats are on dry land' );

}

section( '1b. the patrol lanes (Routes.BLACKWATER_PATROLS)' );
{

	const crossing = PATROLS.some( ( r ) => legs( r, true ).some( ( [ a, b ] ) => { for ( let s = 0; s <= 1; s += 0.01 ) if ( terrain.heightAt( a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * s, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * s ) > - 3.5 ) return true; return false; } ) );
	ok( ! crossing && PATROLS === BLACKWATER_PATROLS, 'Routes.PATROLS are the Blackwater lanes, clear of its land' );
	const depth = ( a, b, lat ) => {

		let worst = - 1e9;
		const Lg = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ), dx = ( b[ 0 ] - a[ 0 ] ) / Lg, dz = ( b[ 1 ] - a[ 1 ] ) / Lg;
		for ( let s = 0; s <= Lg; s += 4 ) for ( const o of [ - lat, 0, lat ] ) worst = Math.max( worst, terrain.heightAt( a[ 0 ] + dx * s - dz * o, a[ 1 ] + dz * s + dx * o ) );
		return worst;

	};
	const segDist = ( px, pz, a, b ) => { const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ]; const f = Math.max( 0, Math.min( 1, ( ( px - a[ 0 ] ) * dx + ( pz - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) ); return Math.hypot( px - a[ 0 ] - dx * f, pz - a[ 1 ] - dz * f ); };
	BLACKWATER_PATROLS.forEach( ( route, i ) => {

		let w = - 1e9;
		for ( const [ a, b ] of legs( route, true ) ) w = Math.max( w, depth( a, b, 20 ) );
		const minZ = Math.min( ...route.map( ( p ) => p[ 1 ] ) );
		let clear = Infinity;
		for ( const I of ISLETS ) if ( I.id !== 'blackwater' ) for ( const [ a, b ] of legs( route, true ) ) clear = Math.min( clear, segDist( I.x, I.z, a, b ) - Math.max( I.ru, I.rv ) - 30 );
		ok( w < - 3.5 && minZ > 150 && ! route.some( ( p ) => inSafeZone( p[ 0 ], p[ 1 ] ) ) && clear > 100, `patrol ${ i }: deep water all round (highest ${ w.toFixed( 1 ) } m), south of z 150, outside the ports, ${ clear.toFixed( 0 ) } m clear of the other islands` );

	} );
	// lane 0 keeps the heightmap's south band (between home and Blackwater); the others circle the island on its tile
	const band = BLACKWATER_PATROLS[ 0 ], ring = BLACKWATER_PATROLS.slice( 1 );
	ok( band.every( ( p ) => p[ 1 ] >= 380 && p[ 1 ] <= 990 && Math.abs( p[ 0 ] ) < 1024 - 120 ), 'lane 0 patrols the south band (z 380-990) inside the heightmap', band.map( ( p ) => p.join( ',' ) ).join( ' ' ) );
	const C = WORLD.blackwater.center;
	ok( ring.length >= 3 && ring.every( ( r ) => r.every( ( p ) => tile.contains( p[ 0 ], p[ 1 ] ) && Math.hypot( p[ 0 ] - C.x, p[ 1 ] - C.z ) < 480 ) ), `${ ring.length } lanes round Blackwater, every waypoint on its tile` );
	const sides = new Set( ring.flat().map( ( p ) => Math.round( Math.atan2( p[ 1 ] - C.z, p[ 0 ] - C.x ) / ( Math.PI / 2 ) ) & 3 ) );
	ok( sides.size === 4, 'they cover all four sides of the island' );
	let shore = Infinity;
	for ( const r of ring ) for ( const [ a, b ] of legs( r, true ) ) for ( let s = 0; s <= 1; s += 0.02 ) shore = Math.min( shore, tile.coastDistance( a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * s, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * s ).d );
	ok( shore > 60, 'and keep off its shore', `nearest ${ shore.toFixed( 0 ) } m (coast distance with the shelf)` );

}

// ---------------------------------------------------------------- 2. batteries
section( '2. battery fire decisions' );
{

	const b0 = { id: 't', x: 0, y: 20, z: 0, yaw: 0, guns: [ { x: - 2, z: 0 }, { x: 0, z: 0 }, { x: 2, z: 0 } ], reload: 0, silenced: false };
	const at = ( d, a = 0, o = {} ) => ( { ok: true, x: Math.sin( a ) * d, y: 0, z: Math.cos( a ) * d, vx: 0, vz: 0, friendly: false, ...o } );
	ok( batteryDecision( b0, at( 150 ) ).fire, 'a hostile boat at 150 m in front: fire' );
	ok( batteryDecision( b0, at( 219 ) ).fire && batteryDecision( b0, at( 221 ) ).reason === 'range', 'reach ' + BATTERY_RULES.range + ' m: 219 fire, 221 out of range' );
	ok( batteryDecision( b0, at( 20 ) ).reason === 'close', 'too close under the guns' );
	ok( batteryDecision( b0, at( 150, 0, { friendly: true } ) ).reason === 'flag', 'the black flag: hold fire' );
	ok( batteryDecision( { ...b0, silenced: true }, at( 150 ) ).reason === 'silenced', 'platform broken: silenced' );
	ok( batteryDecision( b0, at( 150, Math.PI ) ).reason === 'arc', 'behind the battery: outside its arc' );
	ok( batteryDecision( { ...b0, reload: 3 }, at( 150 ) ).reason === 'reloading', 'reloading' );
	ok( batteryDecision( b0, null ).reason === 'noTarget', 'no boat: nothing' );
	const wall = { heightAt: ( x, z ) => ( z > 60 && z < 70 ? 40 : - 10 ) };
	ok( batteryDecision( b0, at( 150 ), { terrain: wall } ).reason === 'blocked' && lineClear( { heightAt: () => - 10 }, { x: 0, y: 20, z: 0 }, { x: 0, y: 1, z: 150 } ), 'a ridge between: the shot is blocked' );
	// salvos: three guns rippled, then the slow reload
	const shots = [];
	let s = 1;
	const bats = new Batteries( [ { ...b0 } ], { rng: () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 ), launch: ( m, dir, info ) => shots.push( { m, dir, info } ) } );
	const tgt = at( 160, 0.2, { vx: 3 } );
	let t = 0, first = null;
	while ( t < 20 ) { bats.update( DT, tgt ); t += DT; if ( shots.length && first === null ) first = t; }
	ok( shots.length >= 6 && shots.length <= 9, 'three guns a salvo, a salvo per reload', shots.length + ' balls in 20 s' );
	ok( bats.list[ 0 ].salvos === 2 || bats.list[ 0 ].salvos === 3, 'reload ~9 s', bats.list[ 0 ].salvos + ' salvos' );
	ok( shots.every( ( q ) => q.info.faction === 'pirate' && q.info.damage === BATTERY_RULES.damage && q.info.owner === 'battery-t' && Math.abs( Math.hypot( q.dir.x, q.dir.y, q.dir.z ) - 1 ) < 1e-6 ), 'balls launched as pirate shot with unit directions' );
	const lead = shots[ 0 ].dir;
	ok( lead.y > - 0.2 && lead.z > 0.8, 'laid toward the boat' );
	ok( bats.silence( 't', 'platform' ) && bats.allSilenced() && bats.update( 10, tgt ).length === 0, 'silenced: no more salvos' );
	ok( bats.restore( 't' ) && ! bats.silenced( 't' ), 'restored' );
	const j = new Batteries( [ { ...b0 } ] );
	j.fromJSON( JSON.parse( JSON.stringify( bats.toJSON() ) ) );
	ok( ! j.allSilenced(), 'battery save round trip' );

}

// ---------------------------------------------------------------- 3. alarm
section( '3. the alarm state machine' );
{

	const a = new Alarm( { bellDelay: 5, standDown: 120 } );
	ok( a.state === 'calm' && a.spot() && a.state === 'spotted', 'calm -> spotted' );
	let ev = null;
	for ( let t = 0; t < 4.9; t += 0.1 ) ev = a.update( 0.1, true ) || ev;
	ok( ev === null && a.state === 'spotted', 'the bell waits for the watchman (5 s)' );
	for ( let t = 0; t < 0.3; t += 0.1 ) ev = a.update( 0.1, true ) || ev;
	ok( ev === 'bell' && a.state === 'alarm' && a.rings === 1, 'spotted -> alarm: the bell' );
	for ( let t = 0; t < 100; t += 1 ) a.update( 1, false );
	a.update( 1, true );
	ok( a.state === 'alarm', 'hostility keeps it ringing' );
	let sd = null;
	for ( let t = 0; t < 121; t += 1 ) sd = a.update( 1, false ) || sd;
	ok( sd === 'standDown' && a.state === 'calm', 'stood down after 120 s of quiet' );
	a.spot();
	ev = null;
	for ( let t = 0; t < 6; t += 1 ) ev = a.update( 1, false ) || ev;
	ok( ev === 'lost' && a.state === 'calm', 'a sighting that slips away does not ring' );
	ok( a.raise( 'cannon' ) && ! a.raise( 'cannon' ) && a.rings === 2, 'shots ring it at once (once)' );

}

// ---------------------------------------------------------------- a world
class FakeModel {

	constructor() { this.clips = new Set( [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Melee_Paddle', 'Hit_Reaction', 'Knockdown', 'GetUp_Front', 'Stumble', 'Laugh', 'Look_Around', 'Swagger_Idle' ] ); this.cur = null; this.layer = null; this.materials = []; }
	get current() { return this.cur; }
	play( name, { loop = true, speed = 1 } = {} ) { this.cur = name; this.layer = { name, time: 0, speed, ended: false, loop }; return this.layer; }
	update( dt ) { if ( this.layer ) this.layer.time += dt * this.layer.speed; }
	hold() {}

}

function avatarFactory( o ) {

	const model = new FakeModel();
	return { group: new Group(), model, character: o.character, lite: o.lite, ready: Promise.resolve( model ), update() {}, dispose() { this.disposed = true; } };

}

class FakeInput {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.mouseDown = false; this.rightDown = false; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	endFrame() { this.pressed.clear(); }

}

// a hold of lots like trade's
function fakeTrade() {

	const lots = {};
	return {
		lots,
		get cargo() { const o = {}; for ( const g in lots ) if ( lots[ g ] > 0 ) o[ g ] = { qty: lots[ g ], cond: 1, paid: 0, crates: lots[ g ], kg: 0 }; return o; },
		addCargo( g, q ) { lots[ g ] = ( lots[ g ] || 0 ) + q; return q; },
		takeCargo( g, q ) { const n = Math.min( lots[ g ] || 0, q ); lots[ g ] -= n; return { qty: n, paid: 0 }; },
		contraband( port ) { return contrabandAt( port ).filter( ( g ) => lots[ g ] > 0 ).map( ( g ) => ( { good: g, qty: lots[ g ] } ) ); },
	};

}

function makeWorld( o = {} ) {

	const events = [], toasts = [], shared = [], markers = [];
	const state = new GameState( { getItem: () => null, setItem: () => {} } );
	state.boat = 'lobster';
	state.money = o.money ?? 5000;
	const player = {
		mode: 'walk', position: new Vector3( 0, 2, 0 ), velocity: new Vector3(), yaw: 0, pitch: 0, stamina: 1, grounded: true, prompt: null, busy: false,
		seat: null, action: null, launched: 0, leaveHelm() { this.mode = 'deck'; }, groundAt: ( x, z ) => terrain.heightAt( x, z ),
	};
	const boat = {
		position: new Vector3( WORLD.boatDock.position.x, 0, WORLD.boatDock.position.z ), quaternion: new Quaternion(), velocity: new Vector3(), speed: 0, driven: false, moored: true,
		getYaw() { return 0; }, toWorld( l, out ) { return out.copy( l ).add( this.position ); }, reset() { this.moored = true; },
	};
	const app = {
		player, input: new FakeInput(), boatCtl: boat, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), scene: { add() {}, remove() {} },
		game: { state, rod: { equipped: false, equip() {} }, toast: ( t ) => toasts.push( t ), cancelLine() {} },
		terrainData: terrain, colliders: new Colliders(), settings: { timeOfDay: o.hour ?? 12, timeSpeed: 0 }, mode: 'campaign', paused: false,
		avatar: { character: 'hyptile' }, ui: null, cameraFeel: { kick() {} },
		netsync: { sendWorldEvent: ( kind, data ) => shared.push( { kind, data } ) },
	};
	const features = new Features( app );
	for ( const n of [ 'strongholdAlarm', 'strongholdClaimed', 'strongholdRetaken', 'batterySilenced', 'strongholdDamaged', 'explosion', 'strongholdDiscovered', 'blackFlagBought', 'cannonFired', 'retaliationRaid' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const trade = fakeTrade();
	features.add( 'trade', { install: () => trade } );
	features.add( 'worldmap', { install: () => ( { addMarker: ( m ) => markers.push( m ), removeMarker() {} } ) } );
	const melee = o.melee ? features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, hud: false, fx: false, seed: 5, captain: false, audio: { play() { return true; }, lead: () => 0.1, preload() {} } } ) } ) : null;
	const naval = o.naval === false ? null : features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const pirates = features.add( 'pirates', { install: ( a, f ) => piratesModule.install( a, f, { seed: 3, hud: false, avatarFactory } ) } );
	const s = features.add( 'stronghold', { install: ( a, f ) => stronghold.install( a, f, { build: false, seed: 9, avatarFactory } ) } );
	return { app, features, player, boat, state, naval, pirates, s, trade, melee, events, toasts, shared, markers };

}

const evs = ( w, name ) => w.events.filter( ( e ) => e[ 0 ] === name ).map( ( e ) => e[ 1 ] );
const run = ( w, seconds ) => { for ( let i = 0, n = Math.round( seconds / DT ); i < n; i ++ ) { w.features.update( DT ); w.app.input.endFrame(); } };
const sail = ( w, x, z ) => { w.player.mode = 'boat'; w.boat.moored = false; w.boat.position.set( x, 0, z ); w.player.position.set( x, 1, z ); };
const walk = ( w, x, z ) => { w.player.mode = 'walk'; w.boat.moored = true; w.player.position.set( x, terrain.heightAt( x, z ) + 0.1, z ); };
// a spot at sea in front of a battery, in its reach and its arc, with a clear line of fire
const seaSpot = ( b, d = 150 ) => {

	for ( const off of [ 0, 0.15, - 0.15, 0.3, - 0.3, 0.45, - 0.45, 0.6, - 0.6 ] ) for ( const r of [ d, d - 30, d + 30 ] ) {

		const x = b.x + Math.sin( b.yaw + off ) * r, z = b.z + Math.cos( b.yaw + off ) * r;
		if ( terrain.heightAt( x, z ) < - 4 && batteryDecision( { ...b, reload: 0, silenced: false }, { ok: true, x, y: 0, z }, { terrain } ).fire ) return { x, z };

	}

	return null;

};

section( '2b. the batteries in the world: real balls onto the player\'s boat' );
{

	const w = makeWorld();
	const spot = L.batteries.map( ( b ) => seaSpot( b ) );
	ok( spot.every( Boolean ), 'each battery covers open water in front of it', spot.map( ( p ) => p && `(${ p.x.toFixed( 0 ) }, ${ p.z.toFixed( 0 ) })` ).join( ' ' ) );
	sail( w, spot[ 0 ].x, spot[ 0 ].z );
	const hp0 = w.naval.playerHull.hp;
	run( w, 30 );
	const fired = evs( w, 'cannonFired' ).filter( ( e ) => String( e.owner ).startsWith( 'battery-' ) );
	ok( fired.length >= 3, 'the batteries fire at a hostile boat (through naval: cannonFired)', fired.length + ' guns' );
	ok( fired.every( ( e ) => e.by === 'pirate' ), 'through naval.launchFrom: the normal flow (by pirate, broadcast to every client), not a remote shot' );
	ok( w.naval.playerHull.hp < hp0, 'the balls fly and hit her', `hull ${ hp0 } -> ${ w.naval.playerHull.hp.toFixed( 0 ) }` );
	ok( w.s.alarm.state === 'alarm' && evs( w, 'strongholdAlarm' ).length >= 1, 'their fire rings the bell' );
	// the black flag: they hold fire
	const w2 = makeWorld();
	w2.s.blackFlag = true;
	sail( w2, spot[ 0 ].x, spot[ 0 ].z );
	run( w2, 30 );
	ok( ! evs( w2, 'cannonFired' ).some( ( e ) => String( e.owner ).startsWith( 'battery-' ) ) && w2.s.alarm.state === 'calm', 'flying the black flag: the batteries hold fire, no alarm' );
	// standing alone lets you in too
	const w3 = makeWorld();
	w3.pirates.wanted.standing = MARKET_RULES.standingGate + 1;
	ok( w3.s.friendly() && ! makeWorld().s.friendly(), `corsair standing >= ${ MARKET_RULES.standingGate } lets you in without the flag` );
	// firing on the island tears the flag up
	w2.features.emit( 'cannonballImpact', { x: L.fort.x, y: L.fort.y, z: L.fort.z, energy: 40000, hit: 'land', owner: 'player' } );
	ok( w2.s.betrayed && ! w2.s.blackFlag && ! w2.s.friendly() && w2.s.alarm.state === 'alarm', 'firing on Blackwater while flagged: betrayed, the flag no longer shields you' );
	run( w2, 6 );
	ok( evs( w2, 'cannonFired' ).some( ( e ) => String( e.owner ).startsWith( 'battery-' ) ), '... and the batteries open up' );

}

// ---------------------------------------------------------------- 4. the fort breaks
section( '4. destructible fort: platforms, powder, palisade' );
{

	for ( const kind of [ 'palisade', 'gunPlatform', 'powder' ] ) {

		let s = 3;
		const pieces = STRONGHOLD_KINDS[ kind ].build( () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 ), { length: 5.8 } );
		const joints = findJoints( pieces.map( ( p ) => ( { ...p, jf: p.jf || STRONGHOLD_KINDS[ kind ].def.jointForce || 1 } ) ) );
		const bb = layoutBounds( pieces );
		ok( pieces.length >= 6 && bb.min.y > - 0.05 && ( kind === 'powder' || joints.length >= pieces.length - 1 ), `${ kind }: ${ pieces.length } pieces on the ground, ${ joints.length } joints`, `${ bb.half.x.toFixed( 1 ) } x ${ ( bb.half.y * 2 ).toFixed( 1 ) } m` );

	}

	const plan = strongholdPlan( terrain );
	ok( plan.length === L.palisade.length + 4 && plan.every( ( p ) => p.site === 'blackwater' && p.port === null && Number.isFinite( p.y ) && STRONGHOLD_KINDS[ p.kind ] ), 'the plan: every palisade run, two platforms, two powder stores (planProps shape)' );
	ok( STRONGHOLD_KINDS.powder.def.explosive && STRONGHOLD_KINDS.gunPlatform.def.toughness > STRONGHOLD_KINDS.palisade.def.toughness, 'powder explodes; platforms are tougher than the walls' );

	const w = makeWorld();
	const [ bA, bB ] = L.batteries;
	// a hit on the platform: one ball does not do it, a few do
	const plat = plan.find( ( p ) => p.id === bA.platform );
	w.features.emit( 'cannonballImpact', { x: plat.x, y: plat.y + 1, z: plat.z, energy: 2000, hit: 'land', owner: 'player', target: null } );
	ok( ! w.s.batteries.silenced( bA.id ), 'a glancing ball does not silence a battery' );
	for ( let k = 0; k < 4; k ++ ) w.features.emit( 'cannonballImpact', { x: plat.x, y: plat.y + 1, z: plat.z, energy: 2000, hit: 'land', owner: 'player' } );
	ok( w.s.batteries.silenced( bA.id ) && evs( w, 'batterySilenced' ).some( ( e ) => e.id === bA.id && e.why === 'platform' ), 'its platform broken: the battery is silenced' );
	ok( w.s.alarm.state === 'alarm', 'and the bell rings' );
	// the other battery's powder store: it blows, and silences that battery
	const pw = plan.find( ( p ) => p.id === bB.powder );
	w.features.emit( 'cannonballImpact', { x: pw.x, y: pw.y + 1, z: pw.z, energy: 40000, hit: 'land', owner: 'player' } );
	const boom = evs( w, 'explosion' ).find( ( e ) => e.by === 'powder' );
	ok( boom && boom.radius >= 8 && w.s.batteries.silenced( bB.id ), 'the powder store explodes (explosion event) and the battery beside it falls silent' );
	ok( w.s.batteries.allSilenced(), 'both batteries silenced' );
	// melee on the palisade
	const wall = plan.find( ( p ) => p.kind === 'palisade' );
	for ( let k = 0; k < 8; k ++ ) w.features.emit( 'meleeHit', { x: wall.x, y: wall.y + 1, z: wall.z, range: 1.4, energy: 450, by: 'player' } );
	ok( w.s.structs.get( wall.id ).broken, 'a palisade run hacked down' );
	ok( w.shared.some( ( e ) => e.kind === 'strongholdProp' ), 'shared with the room' );
	// destruction owns the props once its patch is in: its propDestroyed is the authority
	const w2 = makeWorld();
	w2.features.emit( 'propDestroyed', { id: bA.platform, kind: 'gunPlatform', by: 'player' } );
	ok( w2.s.batteries.silenced( bA.id ), 'propDestroyed (destruction feature) silences the battery too' );
	w2.features.emit( 'propRespawned', { id: bA.platform, kind: 'gunPlatform' } );
	ok( ! w2.s.batteries.silenced( bA.id ), 'propRespawned rebuilds it' );
	// another crew broke one
	const w3 = makeWorld();
	w3.features.emit( 'remoteWorldEvent', { kind: 'strongholdProp', data: { id: bB.platform }, from: 'x' } );
	ok( w3.s.batteries.silenced( bB.id ) && ! w3.s.betrayed, 'a remote crew\'s break applies here' );

}

// ---------------------------------------------------------------- 5. claim, restock, retake
section( '5. claim / restock / retake timeline' );
{

	const w = makeWorld();
	const s = w.s, p = w.pirates;
	ok( ! s.claimable().ok && s.holder === 'pirates', 'held by the pirates' );
	// the ships in the cove
	sail( w, L.entrance.x + 250, L.entrance.z + 60 );
	run( w, 0.5 );
	const ships = s.ships.map( ( sl ) => sl.ship ).filter( Boolean );
	ok( ships.length === 3 && ships.every( ( sh ) => sh.state === 'moored' && sh.faction === 'pirate' ), '2-3 pirate ships moored in the cove (naval.spawn, state moored)', ships.map( ( sh ) => sh.kind ).join( ', ' ) );
	// the bell: they cast off
	s._hostileAct( 'cannon' );
	run( w, 0.5 );
	ok( ships.every( ( sh ) => sh.state !== 'moored' ), 'with the bell they cast off and hunt', ships.map( ( sh ) => sh.state ).join( ', ' ) );
	for ( const b of L.batteries ) s._break( b.platform, 'player' );
	ok( s.batteries.allSilenced() && ! s.claimable().ok, 'batteries silenced, but the ships and the guards still hold it' );
	for ( const sh of ships ) { sh.startSinking ? sh.startSinking() : ( sh.state = 'sinking' ); w.features.emit( 'shipSunk', { id: sh.id, name: sh.name, faction: 'pirate', x: sh.x, z: sh.z, byPlayer: true, kind: sh.kind } ); }
	ok( s.shipsLeft() === 0, 'ships sunk' );
	const guards = s.claimable().guards;
	ok( guards >= 6 && guards <= 10, '6-10 guards on watch', guards + ' (day, bell)' );
	while ( s.claimable().guards > 0 ) s.defeatGuard();
	ok( s.claimable().ok, 'everything beaten: claimable' );
	// a captain in irons: his ransom
	p.ledger.capture( 'Mossbeard', { day: 1 } );
	const heat0 = p.wanted.heat, st0 = p.wanted.standing, money0 = w.state.money, raids0 = p.ledger.counts.raids;
	walk( w, L.flag.x, L.flag.z );
	const r = s.claim();
	ok( r && r.coins >= STRONGHOLD_RULES.coins[ 0 ] && w.state.money === money0 + r.coins + r.ransom, 'claimed: a big purse', `$${ r.coins } + ransom $${ r.ransom }` );
	ok( r.ransom === STRONGHOLD_RULES.ransomPerTier * 4 && r.captain === 'Mossbeard', 'Mossbeard in irons: his band pays his ransom' );
	ok( r.goods.length === 3 && r.goods.some( ( g ) => contrabandAt( 'home' ).includes( g.good ) ) && Object.keys( w.trade.lots ).length >= 3, 'contraband cargo from the plunder store', r.goods.map( ( g ) => g.qty + ' ' + g.good ).join( ', ' ) );
	ok( p.wanted.heat > heat0 && p.wanted.standing < st0 && p.ledger.counts.raids === raids0 + 1, 'notoriety up, corsair standing down, booked as a raid in the ledger' );
	ok( evs( w, 'strongholdClaimed' ).length === 1 && w.shared.some( ( e ) => e.kind === 'strongholdClaimed' ), 'strongholdClaimed (and shared)' );
	ok( s.holder === 'player' && s.claim() === null && s.friendly(), 'yours: no second claim, its guns are quiet for you' );
	const r2 = makeWorld();
	r2.pirates.ledger.capture( 'Mossbeard', { day: 1 } );
	r2.s.ransomed.add( 'Mossbeard' );
	ok( r2.s.ransomed.has( 'Mossbeard' ), '(a ransom is paid once per captain)' );
	// the restock: the brotherhood comes back
	walk( w, WORLD.start.position.x, WORLD.start.position.z );
	p.advance( STRONGHOLD_RULES.restock - 1 );
	run( w, 0.2 );
	ok( s.holder === 'player', 'still yours after ' + ( STRONGHOLD_RULES.restock - 1 ) + ' h' );
	p.advance( 1.5 );
	run( w, 0.2 );
	ok( s.holder === 'pirates' && evs( w, 'strongholdRetaken' ).length === 1, 'retaken after DEN_RULES.restock (' + STRONGHOLD_RULES.restock + ' in-game hours)' );
	ok( ! s.batteries.allSilenced() && s.shipsLeft() === 3 && s.claimable().guards > 0, 'restocked: the guns, the ships and the watch are back' );
	ok( p.retaliation.pending.length === 1 && p.retaliation.pending[ 0 ].reason === 'stronghold', 'and retaliation follows', JSON.stringify( p.retaliation.pending[ 0 ] ) );
	// remote claim
	const w4 = makeWorld();
	w4.features.emit( 'remoteWorldEvent', { kind: 'strongholdClaimed', data: {}, from: 'x' } );
	ok( w4.s.holder === 'player' && w4.state.money === 5000, 'another crew\'s claim: held, no loot here' );
	// rebuild while the pirates hold it
	const w5 = makeWorld();
	w5.s._break( L.batteries[ 0 ].platform, 'other' );
	w5.pirates.advance( STRONGHOLD_RULES.rebuild + 0.5 );
	run( w5, 0.2 );
	ok( ! w5.s.batteries.silenced( L.batteries[ 0 ].id ), 'a broken battery is rebuilt after ' + STRONGHOLD_RULES.rebuild + ' h while the pirates hold it (player away)' );

}

// ---------------------------------------------------------------- 6. the black market
section( '6. black market prices and the standing gate' );
{

	ok( letIn( { standing: 25 } ) && ! letIn( { standing: 24 } ) && letIn( { standing: - 50, flag: true } ), 'the gate: the flag or standing >= 25' );
	const cg = contrabandGoods();
	ok( cg.includes( 'relics' ) && cg.includes( 'powder' ) && cg.includes( 'tobacco' ) && ! cg.includes( 'ice' ), 'buys what the home customs would seize', cg.join( ', ' ) );
	ok( buyPrice( 'relics' ) === Math.round( GOODS.relics.base * MARKET_RULES.buyPremium ) && buyPrice( 'relics' ) > GOODS.relics.base, 'at a premium', '$' + buyPrice( 'relics' ) + ' a chest of relics (base $' + GOODS.relics.base + ')' );
	ok( buyPrice( 'relics', { standing: 100 } ) > buyPrice( 'relics' ) && buyPrice( 'relics', { cond: 0.5 } ) < buyPrice( 'relics' ) && buyPrice( 'ice' ) === 0, 'friends get more, spoiled goods less, legal goods nothing' );
	ok( MARKET_RULES.powder.price < GOODS.powder.base * 0.7 && MARKET_RULES.shot.price < 60, 'powder and shot cheap', `$${ MARKET_RULES.powder.price } a keg, $${ MARKET_RULES.shot.price } for ${ MARKET_RULES.shot.rounds } rounds (yard $60)` );
	const w = makeWorld();
	const s = w.s;
	const bm = s.market;
	ok( bm.canTrade( s.marketCtx() ).reason === 'unwelcome', 'a stranger without the flag: unwelcome' );
	ok( bm.canTrade( { ...s.marketCtx(), what: 'flag' } ).ok, '... but the fence sells the flag to anyone' );
	const m0 = w.state.money;
	ok( s.marketAction( 'flag' ).ok && s.blackFlag && w.state.money === m0 - MARKET_RULES.flagPrice && evs( w, 'blackFlagBought' ).length === 1, 'the black flag for $' + MARKET_RULES.flagPrice );
	ok( ! s.marketAction( 'flag' ).ok, 'one flag' );
	w.trade.addCargo( 'relics', 3 );
	w.trade.addCargo( 'ice', 2 );
	const m1 = w.state.money;
	const sold = s.marketAction( 'sell:relics' );
	ok( sold.ok && sold.qty === 3 && w.state.money === m1 + sold.total && ! w.trade.lots.relics, 'sells contraband out of the hold', '+$' + sold.total );
	ok( ! s.marketAction( 'sell:ice' ).ok, 'legal goods are not his trade' );
	const pw = s.marketAction( 'buy:powder' );
	ok( pw.ok && w.trade.lots.powder === 1, 'buys a keg of powder' );
	ok( w.trade.contraband( 'home' ).some( ( c ) => c.good === 'powder' ), 'Blackwater powder is contraband at the home harbour: customs will find it' );
	ok( contrabandAt( 'home' ).includes( 'powder' ) && contrabandAt( 'home' ).includes( 'relics' ), '(trade LEGALITY flags everything the fence deals in)' );
	const mag = w.naval.ammo;
	mag.spend( 20 );
	const before = mag.rounds;
	ok( s.marketAction( 'buy:shot' ).ok && mag.rounds === before + MARKET_RULES.shot.rounds, 'powder and shot into the magazine' );
	const crew = bm.crewFor();
	ok( crew.length > 0 && crew.every( ( c ) => c.price < 2000 ), 'pirate crew for hire', crew.map( ( c ) => c.name + ' $' + c.price ).join( ', ' ) );
	const hired = s.marketAction( 'crew:' + crew[ 0 ].id );
	ok( hired.ok && w.state.isUnlocked( crew[ 0 ].id ), crew[ 0 ].name + ' signs on (GameState.unlockCharacter: the crew feature posts them)' );
	const ex = { treasure: { sites: [ { id: 'c1', label: 'a cache' } ], found: new Set(), discover( id ) { this.found.add( id ); return true; } } };
	w.features.add( 'exploration', { install: () => ex } );
	ok( s.marketAction( 'chart' ).ok && ex.treasure.found.has( 'c1' ) && ! s.marketAction( 'chart' ).ok, 'a treasure chart marks an unfound cache (exploration feature)' );
	s.alarm.raise( 'test' );
	ok( bm.canTrade( s.marketCtx() ).reason === 'alarm', 'no trade while the bell rings' );
	ok( s.marketRows().length >= 6, 'the window\'s rows', s.marketRows().map( ( r ) => r.id ).join( ' ' ) );
	// the tavern
	const w2 = makeWorld();
	const st0 = w2.pirates.wanted.standing;
	ok( w2.s.drink().ok && w2.pirates.wanted.standing > st0 && w2.s.drink().gain === 0, 'a round at the Rum Hole: a little standing, once a day' );

}

// ---------------------------------------------------------------- 7. the guards
section( '7. guards: melee raiders on their beats' );
{

	const w = makeWorld( { melee: true } );
	const s = w.s;
	const tv = L.town[ 0 ];
	walk( w, tv.x + 60, tv.z );
	run( w, 0.5 );
	const out = s.guards.filter( ( r ) => r && r.active );
	ok( out.length >= 6 && out.length <= 10 && out.every( ( r ) => r.tier >= 2 && r.tier <= 4 ), 'the watch turns out (melee Raiders, tiers 2-4)', out.length + ' guards, tiers ' + out.map( ( r ) => r.tier ).join( '' ) );
	const h0 = out.map( ( r ) => [ r.homeX, r.homeZ ] );
	run( w, 8 );
	ok( out.some( ( r, i ) => Math.hypot( r.homeX - h0[ i ][ 0 ], r.homeZ - h0[ i ][ 1 ] ) > 3 ), 'and walk their beats' );
	const n0 = s.claimable().guards;
	out[ 0 ].takeHit( 9999 );
	run( w, 0.2 );
	ok( s.claimable().guards === n0 - 1, 'a guard beaten in melee counts down the watch' );
	const night = makeWorld( { melee: true, hour: 23 } );
	walk( night, tv.x + 60, tv.z );
	run( night, 0.5 );
	ok( night.s.guards.filter( ( r ) => r && r.active ).length > out.length - 1, 'more on watch at night', night.s.guards.filter( ( r ) => r && r.active ).length + ' at 23:00' );
	const fr = makeWorld( { melee: true } );
	fr.s.blackFlag = true;
	ok( fr.s.host.peaceful && ! makeWorld( { melee: true } ).s.host.peaceful, 'friends of the brotherhood: the guards leave them be (until the bell)' );

}

// ---------------------------------------------------------------- 8. discovery, the map, the save
section( '8. discovery and the world map' );
{

	const w = makeWorld();
	ok( w.s.zones().length === 0, 'unknown: no battery reach on the map (the island is a "?")' );
	sail( w, L.center.x, L.center.z - 400 );
	run( w, 0.2 );
	ok( w.s.discovered && w.state.discovered.includes( 'blackwater' ) && evs( w, 'strongholdDiscovered' ).length === 1, 'sighted: discovered (GameState.discover: the map names it)' );
	const z = w.s.zones();
	ok( z.length === 2 && z.every( ( q ) => q.kind === 'battery' && q.r === BATTERY_RULES.range ), 'the batteries\' reach for the map (pirates.searchZones, after its patch)', z.map( ( q ) => `${ q.label } r ${ q.r }` ).join( '; ' ) );
	ok( w.markers.some( ( m ) => m.id === 'blackwater-fort' ), 'a pin on the fort (worldmap.addMarker)' );

}

section( '9. save, reset' );
{

	const w = makeWorld();
	const s = w.s;
	s.discovered = true;
	s.blackFlag = true;
	s._break( L.batteries[ 0 ].platform, 'other' );
	s.ships[ 1 ].down = true;
	s.defeatGuard();
	const j = JSON.parse( JSON.stringify( s.toJSON() ) );
	const w2 = makeWorld();
	w2.s.fromJSON( j );
	ok( w2.s.discovered && w2.s.blackFlag && w2.s.batteries.silenced( L.batteries[ 0 ].id ) && w2.s.structs.get( L.batteries[ 0 ].platform ).broken && w2.s.ships[ 1 ].down && w2.s.guardsLeft === s.guardsLeft, 'round trip' );
	w2.s.fromJSON( { holder: 'player', claimedAt: 'x', broken: [ [ 'nope' ] ], ransomed: [ 'Nobody' ], guardsLeft: 99, batteries: { silenced: 'x' } } );
	ok( w2.s.holder === 'pirates' && w2.s.guardsLeft === STRONGHOLD_RULES.guardsMax && w2.s.ransomed.size === 0 && ! w2.s.batteries.allSilenced(), 'bad data ignored or clamped' );
	w2.s.reset();
	ok( ! w2.s.discovered && ! w2.s.blackFlag && w2.s.holder === 'pirates', 'reset' );
	w2.s.dispose();
	ok( true, 'disposed' );

}

section( '10. the island model (headless)' );
{

	console.warn = () => {};
	const { Blackwater } = await import( '../src/world/islands/Blackwater.js' );
	const scene = new Group();
	const t0 = performance.now();
	const isle = new Blackwater( { scene, terrain, colliders: new Colliders() } );
	const ms = performance.now() - t0;
	let tris = 0, meshes = 0;
	const land = [ isle.land.near, isle.land.far ];
	isle.group.traverse( ( o ) => { if ( o.geometry && o.geometry.index && ! land.includes( o ) ) { tris += o.geometry.index.count / 3; meshes ++; } } );
	ok( meshes < 40 && tris < 160000, 'merged meshes', `${ meshes } meshes, ${ Math.round( tris ) } triangles, ${ Math.round( ms ) } ms` );
	// wave 14D: the island's ground is its tile's own mesh (the heightmap's chunks no longer reach it)
	const lt = land.map( ( m ) => m.geometry ? m.geometry.index.count / 3 : 0 );
	const P = isle.land.near.geometry.getAttribute( 'position' ).array, Cl = isle.land.near.geometry.getAttribute( 'color' ).array;
	let hiY = - 99, lum = 0, nv = P.length / 3, inBox = true;
	for ( let v = 0; v < nv; v ++ ) {

		hiY = Math.max( hiY, P[ v * 3 + 1 ] );
		lum += 0.2126 * Cl[ v * 3 ] + 0.7152 * Cl[ v * 3 + 1 ] + 0.0722 * Cl[ v * 3 + 2 ];
		if ( ! isle.land.tile.contains( P[ v * 3 ], P[ v * 3 + 2 ] ) ) inBox = false;

	}

	ok( isle.land.tile === tile && lt[ 0 ] > 10000 && lt[ 0 ] < 140000 && lt[ 1 ] > 1000 && lt[ 1 ] < lt[ 0 ] && inBox && hiY > 50, 'the land mesh: near 2 m and far 8 m grids of the tile, up to the summit', `${ lt.join( ' / ' ) } triangles, top ${ hiY.toFixed( 0 ) } m` );
	ok( isle.land.near.material === isle.material && isle.land.near.castShadow && isle.land.near.receiveShadow && lum / nv < 0.12, 'on the prop material, casting shadows, dark volcanic colours', `mean luminance ${ ( lum / nv ).toFixed( 3 ) } (linear)` );
	ok( isle.lights.length >= 3 && isle.lights.length <= 6, 'a few lights that matter (tavern, market, gate, dock)', isle.lights.length + ' lights' );
	ok( isle.structures.size === strongholdPlan( terrain ).length && isle.guns.size === 2, 'every breakable structure and both gun batteries drawn' );
	isle.setBroken( L.palisade[ 0 ].id, true );
	isle.setSilenced( L.batteries[ 0 ].id, true );
	isle.update( 0.1 );
	ok( ! isle.structures.get( L.palisade[ 0 ].id ).visible, 'a broken run disappears (destruction throws its pieces)' );
	isle.setStructuresDrawn( false );
	ok( [ ...isle.structures.values() ].every( ( m ) => ! m.visible ), 'hidden once destruction draws them' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
