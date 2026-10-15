// Plain-node tests of wave 14B (src/features/seaplane): the airframes that are not out stand at their bases (Remote.js
// ParkedPlane: the Kestrel on the airstrip pad, a seaplane at the ramp), appear / swap / repaint / disappear with the
// fleet, E on one opens its hangar (for sale) or flies it (yours); the airstrip hangar's office is easy to find (a 4 m
// prompt, a toast once a session on arriving); delivery with { at } (recall at the strip puts the plane on the pad,
// takeOut into a bay moors it there within 15 m until boarded); bailing out is discoverable (bailHint, the arming toasts,
// X when it is free, ' alone when naval holds X, the touch button sends ').
// No DOM, no GPU.
//   node test/feature-parked-planes.mjs
import fs from 'node:fs';
import * as E from '../src/engine/index.js';
import * as seaplane from '../src/features/seaplane/index.js';
import { install } from '../src/features/seaplane/index.js';
import { MOOR_RADIUS, STRIP_TIP_RANGE, COCKPIT_KEYS } from '../src/features/seaplane/Seaplane.js';
import { ParkedPlane } from '../src/features/seaplane/Remote.js';
import { stripPad } from '../src/features/seaplane/Site.js';
import { SITE } from '../src/features/seaplane/Site.js';
import { CHUTE } from '../src/features/seaplane/Chute.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Player } from '../src/player/Player.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), map: m };

};

const terrain = new TerrainData();
function makeQuery() {

	return {
		n: 1, cpu: new Float32Array( 128 * 4 ), points: new Float32Array( 128 * 4 ), cpuValid: false, version: 0, latency: 2 / 60,
		allocate( name, n ) { const s = this.n; this.n += n; return s; },
		setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
		tick() { for ( let i = 0; i < this.n; i ++ ) this.cpu[ i * 4 ] = 0; this.cpuValid = true; this.version ++; },
	};

}

class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

// a stand-in for PlaneModels: records every visual it makes and what was done to it
function fakeModels() {

	const made = [];
	return {
		made,
		create( af, liv = 0 ) {

			const v = {
				af, livery: liv, visible: true, pose: null, disposed: false, spun: 0,
				setPose( p, q ) { this.pose = { x: p.x, y: p.y, z: p.z, q: q.clone() }; },
				setVisible( b ) { this.visible = b; },
				setLivery( n ) { this.livery = n; },
				spin( dt, r ) { this.spun += r; },
				dispose() { this.disposed = true; },
			};
			made.push( v );
			return v;

		},
	};

}

// a strip on a flat graded shelf far out at sea (as feature-seaplane-upgrades): ground y 3 on the runway and the apron
const STRIP = { x: 2600, z: 400, y: 3, heading: 0, length: 420, width: 26, pad: { x: 2630, z: 240 } };
const world = () => ( { islands: [ { id: 'testfield' } ], testfield: { airstrip: STRIP }, ports: WORLD.ports } );

function makeWorld( { mode = null, money = 0, navalX = false } = {} ) {

	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.money = money;
	const query = makeQuery();
	const colliders = new Colliders();
	const input = new InputStub();
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	const player = new Player( { camera, input, terrain, colliders, query, boat: null } );
	const toasts = [];
	const app = { terrainData: terrain, colliders, query, input, camera, player, mode: mode || 'campaign', game: { state, toast: ( t ) => toasts.push( t ) }, localLights: { add() {} } };
	const features = new Features( app );
	if ( navalX ) features.claimKey( 'KeyX', 'naval' ); // (the real install order: naval's starboard guns first)
	const events = [];
	for ( const n of [ 'planeBailedOut', 'seaplaneBought', 'seaplaneRecovered' ] ) features.on( n, ( e ) => events.push( { n, ...e } ) );
	const warn = console.warn;
	console.warn = () => {}; // (the claimKey notice when naval holds X)
	const sp = install( app, features, { world: world() } );
	console.warn = warn;
	features.list.set( 'seaplane', { module: seaplane, instance: sp } );
	// the parked visuals through a recording stand-in (the plane out keeps none: no scene, no cockpit face)
	const models = fakeModels();
	sp.models = models;
	sp._syncParked();
	const frame = ( dt = 1 / 60 ) => {

		query.tick();
		player.update( dt );
		features.update( dt );
		input.endFrame();

	};

	return { state, app, features, sp, player, input, camera, query, toasts, events, frame, models };

}

const interactable = ( features, id ) => [ ...features._interactables ].find( ( e ) => e.id === id );
const live = ( W, slot ) => W.sp.parked.get( slot );

// ---------------------------------------------------------------- the airstrip in a new game: the Kestrel for sale
{

	const W = makeWorld( { money: 100000 } );
	const { sp, features, player, frame, toasts } = W;
	const pad = stripPad( STRIP );
	const k = live( W, 'strip' );
	ok( k && k.af === 'kestrel' && ! k.owned && ! live( W, 'ramp' ), 'a new game: a Kestrel stands on the strip (for sale), nothing parked at the ramp (the Jade out there is the one for sale)' );
	ok( k.view instanceof ParkedPlane && k.view.visual && k.view.visual.af === 'kestrel' && ! k.view.visual.disposed, 'drawn as a ParkedPlane (a PlaneVisual of the Kestrel)' );
	const pose = k.view.visual.pose;
	ok( pose && Math.hypot( pose.x - pad.x, pose.z - pad.z ) < 1e-6 && Math.abs( pose.y - STRIP.y ) < 1e-6, `on the pad, on the ground (${ pose ? pose.y.toFixed( 2 ) : '-' } m)` );
	const fwd = new E.Vector3( 0, 0, 1 ).applyQuaternion( pose.q );
	ok( Math.abs( Math.atan2( fwd.x, fwd.z ) - pad.heading ) < 1e-6 && Math.abs( fwd.y ) < 1e-9, 'level, nose down the runway (the pad heading)' );
	k.view.spin( 1, 1 );
	ok( k.view.visual.spun === 0, 'parked: the propeller stands still' );
	const it = features.nearestInteractable( new E.Vector3( k.door.x, k.door.y, k.door.z ) );
	ok( it && it.id === 'seaplane-parked-strip' && /^Kestrel for sale · ask at the airstrip hangar$/.test( it.prompt() ), `E at its door: "${ it ? it.prompt() : '-' }"` );
	sp.panel.scope = 'ramp';
	const r = it.onInteract();
	ok( r && r.opened === 'strip' && sp.panel.scope === 'strip' && ! sp.piloted, 'E opens the airstrip hangar\'s window (not yours yet)' );
	ok( interactable( features, 'seaplane-strip-hangar' ).radius === 4, 'the airstrip hangar\'s office: a 4 m prompt' );
	// the toast on arriving, once a session
	player.position.set( pad.x + 30, STRIP.y, pad.z - 20 );
	frame();
	const tips = () => toasts.filter( ( t ) => /airstrip hangar sells the Kestrel/.test( t ) ).length;
	ok( tips() === 1 && /E at the office by the shed/.test( toasts.find( ( t ) => /airstrip hangar sells/.test( t ) ) ), `arriving within ${ STRIP_TIP_RANGE } m of the pad: "The airstrip hangar sells the Kestrel · E at the office by the shed"` );
	player.position.set( 0, 2, - 50 );
	for ( let i = 0; i < 40; i ++ ) frame();
	player.position.set( pad.x, STRIP.y, pad.z );
	for ( let i = 0; i < 40; i ++ ) frame();
	ok( tips() === 1, 'and only once a session' );

	// the fleet changes: the Jade, then the Kestrel
	ok( sp.buy().ok && live( W, 'strip' ) && ! live( W, 'strip' ).owned && ! live( W, 'ramp' ), 'the Jade bought (out at the ramp): the Kestrel still for sale at the strip' );
	const kv = live( W, 'strip' ).view.visual;
	ok( sp.buy( 'kestrel' ).ok && sp.af === 'kestrel', 'the Kestrel bought: it goes out on the pad' );
	frame();
	ok( ! live( W, 'strip' ) && kv.disposed, 'the parked Kestrel is gone (the real one stands there now)' );
	const j = live( W, 'ramp' );
	ok( j && j.af === 'jade' && j.owned && Math.hypot( j.x - SITE.berth.x, j.z - SITE.berth.z ) < 1e-6 && Math.abs( j.view.visual.pose.y + 0.2 ) < 1e-6, 'the Jade, parked, floats at the ramp\'s berth' );
	ok( sp.parkedPrompt( 'ramp' ) === 'Fly the Jade', 'its prompt: "Fly the Jade"' );
	sp.fleet.jade.upgrades.livery = 2;
	frame();
	ok( live( W, 'ramp' ).view.visual.livery === 2 && ! live( W, 'ramp' ).view.visual.disposed, 'repainted in the hangar\'s records: the parked one repaints' );
	// a wrecked one is not parked anywhere
	sp.fleet.jade.lost = true;
	frame();
	ok( ! live( W, 'ramp' ), 'the Jade wrecked: nothing at the ramp (not "for sale" either)' );
	sp.fleet.jade.lost = false;
	frame();

	// E on the parked Jade: out it goes, the Kestrel into its hangar, aboard
	const jd = live( W, 'ramp' ).door;
	player.position.set( jd.x, jd.y, jd.z );
	const ij = features.nearestInteractable( player.position );
	ok( ij && ij.id === 'seaplane-parked-ramp', 'from the jetty: E at the parked Jade' );
	const rj = ij.onInteract();
	ok( rj.ok && rj.boarded && sp.af === 'jade' && sp.piloted && player.mode === 'plane' && sp.owns( 'kestrel' ), 'E: the Jade out and boarded, the Kestrel stashed' );
	frame();
	const kk = live( W, 'strip' );
	ok( kk && kk.af === 'kestrel' && kk.owned && ! live( W, 'ramp' ) && sp.parkedPrompt( 'strip' ) === 'Fly the Kestrel', 'the Kestrel parked on the pad again, yours ("Fly the Kestrel"); nothing extra at the ramp' );
	for ( let i = 0; i < 30; i ++ ) frame();
	ok( sp.exit() && ! sp.piloted, 'climbed out at the ramp' );
	player.position.set( kk.door.x, kk.door.y, kk.door.z );
	for ( let i = 0; i < 40; i ++ ) frame(); // (the same E press does not climb back in)
	const ik = features.nearestInteractable( player.position );
	ok( ik && ik.id === 'seaplane-parked-strip' && ik.onInteract().boarded && sp.af === 'kestrel' && sp.piloted, 'E at the parked Kestrel: flying it' );
	frame();
	ok( live( W, 'ramp' ) && live( W, 'ramp' ).af === 'jade' && live( W, 'ramp' ).owned, 'and the Jade stands at the ramp' );

}

// ---------------------------------------------------------------- the last seaplane out stands at the ramp; for sale
{

	const W = makeWorld( { money: 200000 } );
	const { sp, frame } = W;
	sp.buy();
	sp.buy( 'petrel' );
	sp.buy( 'kestrel' );
	frame();
	ok( live( W, 'ramp' ).af === 'petrel', 'the Petrel was out last: she is the one at the ramp' );
	const saved = sp.toJSON();
	ok( saved.last && saved.last.ramp === 'petrel' && saved.last.strip === 'kestrel', 'the save keeps which one stands where' );
	sp.reset();
	frame();
	ok( ! live( W, 'ramp' ) && live( W, 'strip' ) && ! live( W, 'strip' ).owned, 'a new game: the Kestrel for sale again' );
	sp.fromJSON( saved );
	frame();
	ok( sp.af === 'kestrel' && live( W, 'ramp' ).af === 'petrel' && live( W, 'ramp' ).owned, 'loaded: the Petrel at the ramp again' );
	sp.fleet.jade.owned = sp.fleet.petrel.owned = false;
	frame();
	ok( live( W, 'ramp' ).af === 'jade' && ! live( W, 'ramp' ).owned && /^Jade for sale · ask at the hangar$/.test( sp.parkedPrompt( 'ramp' ) ), 'no seaplane of yours: the Jade for sale at the ramp' );
	const r = sp.useParked( 'ramp' );
	ok( r.opened === 'ramp' && sp.panel.scope === 'ramp', 'E on it: the ramp hangar\'s window' );

}

// ---------------------------------------------------------------- delivery: the strip pad, a bay
{

	const W = makeWorld( { mode: 'sandbox' } );
	const { sp, features, camera, query, events } = W;
	const pad = stripPad( STRIP );
	sp.buy( 'kestrel' );
	ok( sp.spot( 'home', 'kestrel' ).kind === 'strip' && sp.spot( 'strip', 'jade' ).kind === 'ramp' && sp.spot( { x: 1, z: 2, water: true }, 'kestrel' ).kind === 'strip' && sp.spot( { x: 1, z: 2, water: true }, 'jade' ).kind === 'bay', 'spot(): its own base for home / strip, a bay for a seaplane only' );
	sp.flight.place( STRIP.x + 300, STRIP.z, 1, 0 );
	let r = sp.recall( { at: 'strip' } );
	const f = sp.flight;
	ok( r.ok && Math.hypot( f.position.x - pad.x, f.position.z - pad.z ) < 1e-6 && Math.abs( f.position.y - STRIP.y ) < 1e-6 && f.controls.brake === 1 && sp.home, `recall at the strip: on the pad, the brakes set ("${ r.text }")` );
	sp.lost = true;
	r = sp.recall( { at: 'strip' } );
	ok( r.ok && ! sp.lost && /raised the wreck: on the airstrip pad/.test( r.text ) && Math.hypot( f.position.x - pad.x, f.position.z - pad.z ) < 1e-6 && events.some( ( e ) => e.n === 'seaplaneRecovered' && e.at === 'strip' ), 'a wreck recovered at the strip hangar: towed to the pad' );
	r = sp.takeOut( 'kestrel', { at: { x: 500, z: 700, heading: 0, water: true } } );
	ok( r.ok && Math.hypot( f.position.x - pad.x, f.position.z - pad.z ) < 1e-6, 'the Kestrel asked into a bay: it stays on its pad (it does not float)' );

	// the Jade delivered into a bay: moored there, at most 15 m off, until boarded
	sp.buy( 'jade' );
	const BAY = { x: 420, z: 760, heading: 1.2, water: true };
	r = sp.takeOut( 'kestrel' ) && sp.takeOut( 'jade', { at: BAY } );
	ok( r.ok && sp.af === 'jade' && Math.hypot( f.position.x - BAY.x, f.position.z - BAY.z ) < 1e-6 && Math.abs( f.heading() - BAY.heading ) < 1e-6 && sp._moor && ! sp.home, `takeOut into a bay: there, heading ${ BAY.heading } ("${ r.text }")` );
	ok( live( W, 'strip' ) && live( W, 'strip' ).owned && live( W, 'strip' ).af === 'kestrel', 'and the Kestrel is parked on the pad meanwhile' );
	// a steady push (wind, a wake) for 60 s: the line holds it
	let far = 0;
	for ( let i = 0; i < 60 * 60; i ++ ) {

		camera.position.set( BAY.x, 5, BAY.z + 40 ); // (simulated: the camera is near)
		query.tick();
		f.velocity.x = Math.max( f.velocity.x, 2.5 );
		features.update( 1 / 60 );
		far = Math.max( far, Math.hypot( f.position.x - BAY.x, f.position.z - BAY.z ) );

	}

	ok( far > 10 && far <= MOOR_RADIUS + 0.05 && ! f.airborne, `pushed for a minute: it swung out ${ far.toFixed( 1 ) } m, never past ${ MOOR_RADIUS } m` );
	for ( let i = 0; i < 60 * 60; i ++ ) {

		camera.position.set( BAY.x, 5, BAY.z + 40 );
		query.tick();
		features.update( 1 / 60 );

	}

	const back = Math.hypot( f.position.x - BAY.x, f.position.z - BAY.z );
	ok( back < far - 3, `left alone it drifts back towards the spot (${ back.toFixed( 1 ) } m)` );
	sp.board();
	ok( sp.piloted && sp._moor === null, 'boarded: the mooring line is cast off' );

}

// ---------------------------------------------------------------- bailing out: the hint, the arming, X / ' only
function airborne( W, h ) {

	const { sp } = W, f = sp.flight;
	f.position.set( 300, h, 600 );
	f.quaternion.identity();
	f.velocity.set( 0, 0, 40 );
	f.airborne = true;
	f._wasAir = true;
	f.airTime = 2;
	f.engineOn = true;
	f.rpm = 0.8;
	sp.pilot.throttle = 0.8;

}

{

	const W = makeWorld( { mode: 'sandbox', navalX: true } );
	const { sp, frame, input, toasts } = W;
	ok( sp.keys.KeyX === false, 'naval holds X (the starboard guns): the plane keeps \' alone' );
	sp.buy();
	sp.board();
	airborne( W, 25 );
	frame();
	ok( sp.bailHint() === null, `too low (${ sp.flight.agl.toFixed( 0 ) } m < ${ CHUTE.minAgl }): no bail-out line` );
	airborne( W, 260 );
	frame();
	ok( sp.bailHint() === "' bail out (press twice)", `above ${ CHUTE.minAgl } m: "${ sp.bailHint() }"` );
	input.pressed.add( 'KeyX' );
	frame();
	ok( sp.piloted && ! toasts.some( ( t ) => /X again/.test( t ) ), 'X does nothing in the plane here' );
	input.pressed.add( 'Quote' );
	frame();
	ok( sp.piloted && toasts.includes( "Press ' again to bail out" ), "' once: \"Press ' again to bail out\" (armed)" );
	input.pressed.add( 'Quote' );
	frame();
	ok( ! sp.piloted && sp.chute && sp.abandoned, "' again within 2 s: out on the parachute" );
	const touch = fs.readFileSync( new URL( '../src/ui/TouchControls.js', import.meta.url ), 'utf8' );
	ok( /bail:\s*\{\s*label:\s*'Bail out',\s*code:\s*'Quote'\s*\}/.test( touch ) && COCKPIT_KEYS.Quote === 'bail', "the touch tray's Bail out button sends ' (the same twice-armed cockpit key)" );

}

{

	const W = makeWorld( { mode: 'sandbox' } );
	const { sp, frame, input, toasts } = W;
	ok( sp.keys.KeyX === true, 'X free (no naval): the plane claims it' );
	sp.buy();
	sp.board();
	airborne( W, 260 );
	frame();
	ok( /X: bail out \(press twice\)/.test( sp.bailHint() ), `the line names both keys: "${ sp.bailHint() }"` );
	input.pressed.add( 'KeyX' );
	frame();
	ok( sp.piloted && toasts.includes( 'Press X again to bail out' ), 'X once: "Press X again to bail out"' );
	input.pressed.add( 'KeyX' );
	frame();
	ok( ! sp.piloted && sp.chute, 'X twice: bailed out' );

}

// ---------------------------------------------------------------- the shared look: a remote parked entry
{

	const models = fakeModels();
	const sp = install( {}, null, { world: world(), site: false } );
	sp.models = models;
	const v = sp.parkedVisual( 'kestrel', 3 );
	ok( v instanceof ParkedPlane && models.made.length === 1 && models.made[ 0 ].af === 'kestrel' && models.made[ 0 ].livery === 3, 'parkedVisual( af, liv ): the same ParkedPlane (for netsync\'s remote parked entries)' );
	v.setPose( new E.Vector3( 5, 1, 6 ), new E.Quaternion() );
	v.spin( 1, 1 );
	v.setVisible( false );
	ok( models.made[ 0 ].pose.x === 5 && models.made[ 0 ].spun === 0 && models.made[ 0 ].visible === false, 'driven like a PlaneVisual (setPose / spin / setVisible): the propeller still' );
	v.set( 'jade', 1 );
	ok( models.made[ 0 ].disposed && models.made[ 1 ].af === 'jade' && models.made[ 1 ].pose.x === 5 && models.made[ 1 ].visible === false, 'another airframe: a new model in the same spot' );
	v.dispose();
	ok( models.made[ 1 ].disposed && v.visual === null, 'disposed' );
	sp.dispose();

}

console.log( fails ? `\n${ fails } FAILED` : '\nall parked-plane tests passed' );
process.exit( fails ? 1 : 0 );
