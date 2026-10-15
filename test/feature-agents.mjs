// Plain-node test of wave 14C, Roid & Co.'s harbour agents (src/features/agents): an agent at every port's dock (not home),
// a 'yard' vendor pushed into game.vendors, a purchase at an agent moored at THAT dock (app.setBoat( id, { dock } ) stubbed),
// the agent's fee and story.priceMod, the free sandbox, salvage / ferry / seaplane recovery to that port, the Kestrel row at
// Tidemark, the map pin for a stranded player (questPin / questPinClear), the respawn hint and the window's HTML.
// No DOM, no GPU.
//   node test/feature-agents.mjs
import * as E from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import * as agentsModule from '../src/features/agents/index.js';
import { AGENT_FEE, HOME_RANGE, agentSpot, berthPoint, planeSpot, ferryBase, agentPorts } from '../src/features/agents/index.js';
import { renderAgentYard } from '../src/features/agents/Panel.js';
import { buildLecternGeometry, placardPixels } from '../src/features/agents/Lectern.js';
import { GameState } from '../src/game/GameState.js';
import { BOATS } from '../src/game/Boats.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';

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
const portOf = ( id ) => WORLD.ports.find( ( p ) => p.id === id );

// a registry with GameState, a stand-in boat controller and player, stubs for app.setBoat / story / naval / seaplane
function world( { mode = 'campaign', money = 5000, boat = null, mod = null, scene = null, player = null } = {} ) {

	const state = new GameState( store() );
	state.setMode( mode );
	state.money = money;
	state.boat = boat;
	const toasts = [], setBoats = [], pins = [], clears = [], deliveries = [];
	const boatCtl = {
		enabled: true, driven: false, moored: true, throttle: 0,
		position: new E.Vector3( 64.5, 0, 36.5 ), quaternion: new E.Quaternion(), velocity: new E.Vector3(), angular: new E.Vector3(),
		mooring: { anchor: new E.Vector3( 64.5, 0, 36.5 ), heading: 0 },
	};
	const app = {
		mode, scene, terrainData: terrain, colliders: new Colliders(), boatCtl,
		player: player || { mode: 'walk', position: new E.Vector3( 0, 2, - 60 ) },
		game: { state, vendors: [ { name: 'PoorGoat', kind: 'buyer' } ], toast: ( t ) => toasts.push( t ) },
		setBoat( id, opts ) { setBoats.push( { id, opts } ); },
	};
	const features = new Features( app );
	features.on( 'questPin', ( e ) => pins.push( e ) );
	features.on( 'questPinClear', ( e ) => clears.push( e ) );
	features.on( 'agentDelivery', ( e ) => deliveries.push( e ) );
	if ( mod ) features.list.set( 'story', { module: null, instance: { priceMod: ( p ) => mod[ p ] ?? 1 } } );
	const ag = features.add( 'agents', agentsModule );
	return { state, app, features, ag, toasts, setBoats, pins, clears, deliveries, boatCtl };

}

// ================================================================================================ 1. an agent per port
section( '1. an agent at every port\'s dock (home stays Captain Roid)' );
{

	const scene = new E.Scene();
	const W = world( { scene } );
	const ids = WORLD.ports.filter( ( p ) => p.id !== 'home' ).map( ( p ) => p.id );
	ok( ids.length >= 8 && W.ag.list.length === ids.length && ids.every( ( id ) => W.ag.agentOf( id ) ), `one agent for each of ${ ids.join( ', ' ) }` );
	ok( ! W.ag.agentOf( 'home' ) && agentPorts().every( ( p ) => p.id !== 'home' ), 'no agent at home: Captain Roid keeps the home yard' );
	for ( const a of W.ag.list ) {

		const D = portOf( a.port ).dock, v = a.vendor;
		const h = D.heading, c = Math.cos( h ), s = Math.sin( h );
		const lx = ( v.position.x - D.start.x ) * c - ( v.position.z - D.start.z ) * s, lz = ( v.position.x - D.start.x ) * s + ( v.position.z - D.start.z ) * c;
		const L = Math.hypot( D.end.x - D.start.x, D.end.z - D.start.z );
		ok( a.dock === D && v.kind === 'yard' && v.port === a.port && v.name === `Roid & Co. · ${ portOf( a.port ).name }`, `${ a.port }: a yard vendor named for the port, on its dock` );
		ok( Math.abs( lx ) < D.width / 2 && lz > L - 6 && lz < L && Math.abs( v.position.y - D.deckHeight ) < 1e-6, `${ a.port }: on the deck near the head (lx ${ lx.toFixed( 2 ) }, ${ ( L - lz ).toFixed( 1 ) } m from the end)` );
		const berthLx = ( D.position.x - D.start.x ) * c - ( D.position.z - D.start.z ) * s;
		ok( Math.sign( lx ) !== Math.sign( berthLx ), `${ a.port }: on the side away from the berth` );

	}

	ok( W.ag.list.every( ( a ) => W.app.game.vendors.includes( a.vendor ) ) && W.app.game.vendors[ 0 ].name === 'PoorGoat', 'pushed into game.vendors (E opens the yard window)' );
	ok( W.ag.lights.length === W.ag.list.length && W.ag.lights.every( ( l ) => l.kind === 'lantern' && l.position.y > 1 ), 'a lantern light per lectern' );
	ok( scene.children.length === W.ag.list.length * 2, 'the agent and the lectern in the scene' );
	ok( W.app.colliders.boxes.filter( ( b ) => b.tag === 'agentLectern' ).length === W.ag.list.length, 'the lecterns are solid' );
	const g = buildLecternGeometry(), px = placardPixels();
	ok( g && g.attributes && g.attributes.position.count > 100 && px.width * px.height * 4 === px.data.length, 'the lectern geometry and the placard face build in node' );
	ok( W.ag.heading( 'gull' ) === 'Roid & Co. · Gull Rock', 'the window heading names the port' );
	W.ag.dispose();
	ok( W.app.game.vendors.length === 1 && scene.children.length === 0, 'dispose takes them away' );

}

// ================================================================================================ 2. delivery at the dock
section( '2. a purchase at an agent moors the boat at that dock' );
{

	const W = world( { money: 5000 } );
	const base = W.state.boatPrice( 'cutter' ), price = W.ag.price( base, 'key' );
	ok( price === Math.round( base * ( 1 + AGENT_FEE ) ), `the agent's price: $${ base } + 15 % = $${ price }` );
	ok( W.ag.buyBoat( 'cutter', 'key' ), 'bought the cutter at Saltmarsh Key' );
	const D = portOf( 'key' ).dock, at = berthPoint( D, 'cutter' );
	ok( W.state.boat === 'cutter' && W.state.money === 5000 - price, `paid $${ price } (yard price and the fee)` );
	ok( W.setBoats.length === 1 && W.setBoats[ 0 ].id === 'cutter' && W.setBoats[ 0 ].opts.dock === D, 'app.setBoat( id, { dock } ) with Saltmarsh Key\'s dock' );
	ok( Math.hypot( W.boatCtl.position.x - at.x, W.boatCtl.position.z - at.z ) < 1e-6 && W.boatCtl.moored && W.boatCtl.mooring.anchor.distanceTo( new E.Vector3( at.x, 0, at.z ) ) < 1e-6 && W.boatCtl.mooring.heading === at.heading, 'moored at that dock\'s berth' );
	ok( /Saltmarsh Key/.test( W.toasts.at( - 1 ) ), `the toast says where: "${ W.toasts.at( - 1 ) }"` );
	ok( W.deliveries.length === 1 && W.deliveries[ 0 ].kind === 'boat' && W.deliveries[ 0 ].port === 'key', 'agentDelivery { kind: boat, port }' );
	ok( ! W.ag.buyBoat( 'cutter', 'key' ) && /already yours/.test( W.toasts.at( - 1 ) ), 'the same boat twice: already yours' );
	const big = berthPoint( D, 'brigantine' ), small = berthPoint( D, 'skiff' );
	ok( Math.hypot( big.x - D.position.x, big.z - D.position.z ) > 1 && Math.hypot( small.x - D.position.x, small.z - D.position.z ) < 1e-6, 'the big ships moor a little further off' );
	// _placeBoat when the App has it (the save's own placement)
	const W2 = world( { money: 5000 } );
	const placed = [];
	W2.app._placeBoat = ( bw ) => placed.push( bw );
	W2.ag.buyBoat( 'skiff', 'pons' );
	ok( placed.length === 1 && placed[ 0 ].moored && Math.abs( placed[ 0 ].x - portOf( 'pons' ).dock.position.x ) < 1e-6, 'App._placeBoat moors her when present' );

}

// ================================================================================================ 3. fees and priceMod
section( '3. the agent\'s fee and the port\'s priceMod; short of money' );
{

	const W = world( { money: 8000, mod: { gull: 1.2, tidemark: 0.9 } } );
	const base = W.state.boatPrice( 'launch' );
	ok( W.ag.price( base, 'gull' ) === Math.round( base * 1.2 * 1.15 ) && W.ag.price( base, 'tidemark' ) === Math.round( base * 0.9 * 1.15 ), 'priceMod x fee (hostile Gull Rock dearer, friendly Tidemark cheaper)' );
	ok( W.ag.price( base, 'home' ) === base, 'home: the yard\'s own price' );
	const rows = W.ag.rows( 'gull' ), r = rows.find( ( x ) => x.key === 'boat:launch' );
	ok( r && r.price === Math.round( base * 1.2 * 1.15 ) && r.action === 'Buy' && ! r.have, 'the window row carries the agent\'s price' );
	ok( W.ag.buyBoat( 'launch', 'gull' ) && W.state.money === 8000 - Math.round( base * 1.2 * 1.15 ), 'charged with priceMod and fee' );
	const poor = world( { money: 100 } );
	ok( ! poor.ag.buyBoat( 'lobster', 'haven' ) && poor.state.money === 100 && poor.state.boat === null && poor.setBoats.length === 0, 'short of money: nothing bought, nothing moved' );
	ok( poor.ag.rows( 'haven' ).find( ( x ) => x.key === 'boat:lobster' ).disabled, 'its button is disabled' );
	// the fee is checked up front: the yard price alone would fit, the fee would not
	const edge = world( { money: 0 } );
	edge.state.money = edge.state.boatPrice( 'skiff' );
	ok( ! edge.ag.buyBoat( 'skiff', 'shrine' ) && edge.state.boat === null, 'enough for the yard price but not the fee: refused' );

}

// ================================================================================================ 4. sandbox
section( '4. the sandbox is free' );
{

	const W = world( { mode: 'sandbox', money: 40 } );
	ok( W.ag.free() && W.ag.price( 9999, 'gull' ) === 0, 'price 0' );
	const r = W.ag.rows( 'gull' ).find( ( x ) => x.key === 'boat:brigantine' );
	ok( r && r.action === 'Take' && ! r.disabled, 'rows say Take' );
	ok( W.ag.buyBoat( 'brigantine', 'gull' ) && W.state.money === 40 && W.state.boat === 'brigantine', 'taken without a cent' );

}

// ================================================================================================ 5. salvage, ferry, seaplane
section( '5. salvage and the ferry to this dock; the seaplane to this port\'s water' );
{

	const W = world( { money: 5000, boat: 'skiff' } );
	const nv = { wreck: { boat: 'skiff', name: 'Marsh skiff' }, sinking: null, salvageCost: () => 300,
		salvage( { free } ) { if ( ! free && ! W.state.spend( 300 ) ) return false; this.wreck = null; return true; } };
	W.features.list.set( 'naval', { module: null, instance: nv } );
	const sal = W.ag.rows( 'shrine' ).find( ( x ) => x.key === 'salvage' );
	ok( sal && sal.price === Math.round( 300 * 1.15 ), 'salvage row at the agent\'s price' );
	ok( W.ag.salvage( 'shrine' ) && W.state.money === 5000 - Math.round( 300 * 1.15 ), 'raised: yard price and fee' );
	const sb = berthPoint( portOf( 'shrine' ).dock, 'skiff' );
	ok( Math.hypot( W.boatCtl.position.x - sb.x, W.boatCtl.position.z - sb.z ) < 1e-6, 'and moored at The Shrine\'s dock' );
	// ferry: she is at the shrine; at Pons she is far away
	ok( ! W.ag.rows( 'shrine' ).some( ( x ) => x.key === 'ferry' ), 'no ferry where she already lies' );
	const fq = W.ag.ferryQuote( 'pons' );
	ok( fq && fq.base === ferryBase( fq.dist ) && fq.price === Math.round( fq.base * 1.15 ), `ferry quote ${ Math.round( fq.dist ) } m: $${ fq.price }` );
	const m0 = W.state.money;
	ok( W.ag.ferryBoat( 'pons' ) && W.state.money === m0 - fq.price && W.boatCtl.position.distanceTo( new E.Vector3( portOf( 'pons' ).dock.position.x, 0, portOf( 'pons' ).dock.position.z ) ) < 1e-6, 'sailed round to Pons Cove' );
	W.boatCtl.driven = true;
	ok( W.ag.ferryQuote( 'gull' ) === null, 'not while someone sails her' );

	// the seaplane: lost, recovered to this port's water (Tidemark: the bay)
	const calls = [];
	let pos = { x: 0, z: 0 };
	const sp = { owned: true, lost: true, af: 'jade', piloted: false, recoveryCost: () => 600,
		recall( o ) { calls.push( o ); if ( this.lost && ! W.state.spend( 600 ) ) return { ok: false, text: 'short' }; this.lost = false; if ( o && o.at ) pos = { x: o.at.x, z: o.at.z }; return { ok: true, text: 'towed' }; },
		marker() { return this.lost ? null : { x: pos.x, z: pos.z, heading: 0 }; } };
	W.features.list.set( 'seaplane', { module: null, instance: sp } );
	const tr = W.ag.rows( 'tidemark' );
	ok( tr.some( ( x ) => x.key === 'plane' && x.label === 'Recover the seaplane to the bay' ) && tr.some( ( x ) => x.key === 'kestrel' && x.label === 'The Kestrel: ask at the airstrip' && x.have ), 'Tidemark: "Recover the seaplane to the bay" and "The Kestrel: ask at the airstrip"' );
	const m1 = W.state.money, r = W.ag.recoverPlane( 'tidemark' );
	ok( r.ok && calls[ 0 ].at.water === true && Math.abs( calls[ 0 ].at.x - WORLD.tidemark.bay.x ) < 1e-6 && Math.abs( calls[ 0 ].at.z - WORLD.tidemark.bay.z ) < 1e-6, 'sp.recall( { at: Tidemark\'s bay, water: true } )' );
	ok( W.state.money === m1 - Math.round( 600 * 1.15 ) && /bay/.test( r.text ), 'paid the recovery with the fee; the toast names the bay' );
	// another port: 40 m off the dock head (further out where it is shallow)
	sp.lost = true;
	const gp = planeSpot( portOf( 'gull' ), terrain ), D = portOf( 'gull' ).dock;
	const off = Math.hypot( gp.x - D.end.x, gp.z - D.end.z );
	ok( off >= 39.9 && off <= 120.1 && terrain.heightAt( gp.x, gp.z ) < 0, `Gull Rock: ${ off.toFixed( 0 ) } m off the dock head, over water` );
	ok( W.ag.recoverPlane( 'gull' ).ok && Math.abs( calls[ 1 ].at.x - gp.x ) < 1e-6, 'recovered to the water off Gull Rock\'s dock' );
	// fly her round from Gull Rock to Saltmarsh Key
	const pq = W.ag.planeFerryQuote( 'key' );
	ok( pq && W.ag.rows( 'key' ).some( ( x ) => x.key === 'planeFerry' ), 'an owned plane elsewhere: "Fly your Jade here"' );
	const m2 = W.state.money;
	ok( W.ag.ferryPlane( 'key' ).ok && W.state.money === m2 - pq.price && Math.hypot( pos.x - pq.at.x, pos.z - pq.at.z ) < 1e-6, 'flown round, charged once she is there' );
	// an older seaplane that ignores { at }: the yard price only, no fee
	sp.lost = true;
	const old = { ...sp, recall() { if ( ! W.state.spend( 600 ) ) return { ok: false }; this.lost = false; pos = { x: 0, z: 0 }; return { ok: true, text: 'Towed back to the ramp' }; } };
	W.features.list.set( 'seaplane', { module: null, instance: old } );
	const m3 = W.state.money;
	ok( W.ag.recoverPlane( 'pons' ).ok && W.state.money === m3 - 600, 'old recall (no { at }): only its own fee' );
	// the Kestrel is the airstrip's business
	const k = { owned: true, lost: true, af: 'kestrel', piloted: false, recoveryCost: () => 600, recall() { throw new Error( 'not here' ); }, marker: () => null };
	W.features.list.set( 'seaplane', { module: null, instance: k } );
	ok( ! W.ag.rows( 'haven' ).some( ( x ) => x.key === 'plane' ) && W.ag.rows( 'haven' ).some( ( x ) => x.key === 'kestrel' ), 'a lost Kestrel: "ask at the airstrip"' );
	ok( W.ag.recoverPlane( 'haven' ).ok === false, 'and no recovery at a dock' );

}

// ================================================================================================ 6. the pin
section( '6. stranded on foot: the nearest agent pinned, cleared once a boat is owned' );
{

	const D = portOf( 'gull' ).dock;
	const player = { mode: 'walk', position: new E.Vector3( D.start.x, 2, D.start.z ) };
	const W = world( { boat: null, player } );
	W.ag.update( 0.6 );
	ok( W.pins.length === 1 && W.pins[ 0 ].id === 'agent' && W.pins[ 0 ].label === 'Harbour agent', 'questPin { id: agent, label: Harbour agent }' );
	const a = W.ag.agentOf( 'gull' );
	ok( Math.abs( W.pins[ 0 ].x - a.spot.x ) < 0.1 && Math.abs( W.pins[ 0 ].z - a.spot.z ) < 0.1, 'at the Gull Rock agent' );
	ok( W.toasts.filter( ( t ) => /No boat\? Roid's agent/.test( t ) ).length === 1, 'the toast once' );
	W.ag.update( 0.6 );
	ok( W.pins.length === 1, 'not raised again while nothing changed' );
	player.position.set( portOf( 'key' ).dock.start.x, 2, portOf( 'key' ).dock.start.z );
	W.ag.update( 0.6 );
	ok( W.pins.length === 2 && Math.abs( W.pins[ 1 ].x - W.ag.agentOf( 'key' ).spot.x ) < 0.1, 'moves to the nearer agent' );
	W.state.boat = 'skiff';
	W.ag.update( 0.6 );
	ok( W.clears.length === 1 && W.clears[ 0 ].id === 'agent', 'questPinClear once a boat is owned' );
	W.state.boat = null;
	W.ag.update( 0.6 );
	ok( W.pins.length === 3 && W.toasts.filter( ( t ) => /No boat\? Roid's agent/.test( t ) ).length === 1, 'pinned again, no second toast this session' );
	// a wrecked boat counts as none; an owned plane counts as a way out
	W.features.list.set( 'seaplane', { module: null, instance: { owned: true, lost: false } } );
	W.ag.update( 0.6 );
	ok( W.clears.length === 2, 'an owned plane: cleared' );
	// near home: no pin (Captain Roid is right there); at the start a stale pin of a loaded save is cleared once
	const home = world( { boat: null, player: { mode: 'walk', position: new E.Vector3( WORLD.boatDock.position.x, 2, WORLD.boatDock.position.z - HOME_RANGE + 20 ) } } );
	home.ag.update( 0.6 );
	ok( home.pins.length === 0 && home.clears.length === 1, 'near the home dock: none (a stale one cleared)' );
	home.ag.update( 0.6 );
	ok( home.clears.length === 1, 'cleared only once' );
	// aboard something: none
	const sail = world( { boat: null, player: { mode: 'plane', position: new E.Vector3( D.start.x, 30, D.start.z ) } } );
	sail.ag.update( 0.6 );
	ok( sail.pins.length === 0, 'not while flying' );
	// the respawn hint
	const R = world( { boat: null } );
	R.features.emit( 'playerRespawned', { cause: 'lost' } );
	R.ag.update( 1.0 );
	ok( ! R.toasts.some( ( t ) => /any port's dock/.test( t ) ), 'the hint waits for the fade' );
	R.ag.update( 1.0 );
	ok( R.toasts.some( ( t ) => /Roid & Co\. at any port's dock/.test( t ) ), 'after a respawn with no boat: the agents are named' );
	const R2 = world( { boat: 'skiff' } );
	R2.features.emit( 'playerRespawned', { cause: 'melee' } );
	R2.ag.update( 3 );
	ok( ! R2.toasts.some( ( t ) => /any port's dock/.test( t ) ), 'no hint when the boat is fine' );

}

// ================================================================================================ 7. the window
section( '7. the window (HudPanels hands over through hud.yardPort)' );
{

	const W = world( { money: 2000, mod: { haven: 1.1 } } );
	const buttons = [];
	const stand = { innerHTML: '', querySelector: () => null, querySelectorAll: ( q ) => q === '[data-agent]' ? buttons : [] };
	let rerender = 0;
	const hud = { game: W.app.game, stand, yardPort: 'haven', standOpen: true, closeStand() {}, _keepScroll( f ) { f(); }, renderYard() { rerender ++; } };
	ok( W.ag.renderYard( hud ) === true, 'rendered' );
	ok( stand.innerHTML.includes( 'Roid &amp; Co. · West Haven' ) && stand.innerHTML.includes( 'You have $2,000' ) && stand.innerHTML.includes( 'plus 15 % for the agent' ) && stand.innerHTML.includes( 'at this port' ), 'heading, purse and the fee line' );
	const skiff = Math.round( W.state.boatPrice( 'skiff' ) * 1.1 * 1.15 );
	ok( stand.innerHTML.includes( `data-agent="boat:skiff"` ) && stand.innerHTML.includes( '$' + skiff.toLocaleString( 'en-US' ) ), 'boat rows at the agent\'s price' );
	hud.yardPort = 'home';
	ok( W.ag.renderYard( hud ) === false, 'home: Roid\'s own window' );
	const S = world( { mode: 'sandbox' } );
	const hs = { ...hud, game: S.app.game, yardPort: 'gull', stand: { ...stand, innerHTML: '' } };
	S.ag.renderYard( hs );
	ok( hs.stand.innerHTML.includes( 'Free in sandbox' ) && ! /\$\d/.test( hs.stand.innerHTML.replace( /You have \$[\d,]+/, '' ) ), 'sandbox: free, no prices' );
	ok( rerender === 0 && W.ag.act( 'boat:skiff', 'haven' ) && W.state.boat === 'skiff', 'act( boat:<id> ) buys there' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );
