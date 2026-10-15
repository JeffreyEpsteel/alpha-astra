// Headless integration: native engine geometry, actual Player vehicle/cameras,
// authored Meridian roof colliders and stages, flight, recovery, saves and wire state.
// Fixtures are explicit: flat terrain, water 0, approach positions and mocked keys.
import assert from 'node:assert/strict';
import { Scene, Group, Vector3, PerspectiveCamera } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import { Colliders } from '../src/world/Colliders.js';
import { Player } from '../src/player/Player.js';
import { Helicopter, HOME } from '../src/features/helicopter/Helicopter.js';
import { RotorFlight } from '../src/features/helicopter/Flight.js';
import { HelicopterVisual } from '../src/features/helicopter/Model.js';
import { Meridian } from '../src/world/islands/meridian/Meridian.js';
import { cityPlan } from '../src/world/islands/meridian/CityPlan.js';
import { Seaplane } from '../src/features/seaplane/Seaplane.js';
import { sanitizeState } from '../src/net/Protocol.js';
import { GameState } from '../src/game/GameState.js';
import { CityWreck } from '../src/features/citywreck/CityWreck.js';

let checks = 0;
function check( condition, label ) { assert.ok( condition, label ); checks ++; console.log( 'ok', label ); }
function run( f, seconds, controls = {} ) { Object.assign( f.controls, controls ); for ( let i = 0; i < seconds * 60; i ++ ) f.update( 1 / 60 ); }
function world( render = false ) {
	const terrain = { heightAt: () => 1, normalAt: ( x, z, out ) => out.set( 0, 1, 0 ) }, colliders = new Colliders();
	const input = { keys: new Set(), pressed: new Set(), enabled: true, down( k ) { return this.keys.has( k ); }, hit( k ) { return this.pressed.has( k ); }, consumeLook: () => ( { x: 0, y: 0 } ), consumeWheel: () => 0 };
	const query = { allocate: () => 0, setPoint() {}, cpuValid: false, cpu: new Float32Array( 16 ), resultInputs: new Float32Array( 16 ), version: 0 };
	const camera = new PerspectiveCamera( 60, 1.6, 0.1, 5000 );
	const player = new Player( { terrain, colliders, input, query, camera, boat: null } );
	const toasts = [], app = { terrainData: terrain, colliders, input, query, camera, player, mode: 'campaign', scene: render ? new Scene() : null, game: { toast: s => toasts.push( s ), state: { save() {} } } };
	const features = new Features( app ), h = new Helicopter( app, features, { render } );
	features.list.set( 'helicopter', { instance: h } );
	const tick = () => { player.update( 1 / 60 ); features.update( 1 / 60 ); input.pressed.clear(); };
	return { app, h, features, player, input, camera, colliders, toasts, tick };
}

{
	const f = new RotorFlight( { groundAt: () => 1 } ); f.place( 0, 1, 0 ); f.engineOn = true;
	run( f, 3 ); check( f.grounded && Math.abs( f.position.y - 1 ) < 0.01, 'engine spool and neutral collective remain on pad' );
	run( f, 6, { lift: 1 } ); check( f.position.y > 30 && ! f.grounded, 'vertical takeoff climbs with no runway or forward speed' );
	check( f.drainEvents().filter( e => e.type === 'takeoff' ).length === 1, 'one takeoff transition per departure' );
	run( f, 3, { lift: 0 } ); const y = f.position.y; run( f, 8 );
	check( Math.abs( f.position.y - y ) < 0.001, 'neutral controls hold a stable hover after climb decelerates' );
	run( f, 2, { forward: 1, yaw: 0.6 } );
	check( Math.hypot( f.position.x, f.position.z ) > 25 && f.yaw > 1 && Math.abs( f.quaternion.x ) > 0.01, 'cyclic drives forward with visible pitch and controllable yaw' );
	run( f, 4, { forward: 0, yaw: 0, brake: true } );
	check( Math.hypot( f.velocity.x, f.velocity.z ) < 0.01, 'hover brake arrests forward motion' );
	run( f, 1, { strafe: 1, brake: false } ); check( f.velocity.length() > 5, 'lateral cyclic moves independently of heading' );
	run( f, 4, { strafe: 0, brake: true } ); run( f, 25, { lift: - 1 } );
	check( f.grounded && f.position.y === 1, 'controlled descent returns to the ground and stays supported' );
	check( f.drainEvents().filter( e => e.type === 'landed' ).length === 1, 'one safe touchdown event at descent speed below 3 m/s' );
}

{
	const w = world( true ), { h, app, player, input, tick, camera } = w;
	check( h.owned && h.hp === 100 && h.flight.grounded, 'campaign rescue helicopter is immediately available on a collision-backed pad' );
	check( ! h.board(), 'remote activation cannot board from across the island' );
	player.position.copy( h.flight.toWorld( [ 1.35, 0, 0.65 ] ) );
	const door = w.features.nearestInteractable( player.position ); check( door?.id === 'helicopter-door', 'normal E interactable exposes helicopter cabin' );
	door.onInteract(); check( h.piloted && player.mode === 'plane' && player.vehicle.kind === 'helicopter', 'existing Player vehicle lifecycle seats the helicopter pilot' );
	input.keys.add( 'ShiftLeft' ); for ( let i = 0; i < 420; i ++ ) tick(); input.keys.clear();
	check( h.flight.position.y > h.homeY + 20 && Number.isFinite( camera.position.y ), 'actual Player drive loop takes off and updates chase camera once per frame' );
	check( ! h.exit() && h.piloted && ! h.recall(), 'airborne exit and recall are refused' );
	player.setView( 'first' ); tick();
	check( camera.position.distanceTo( h.flight.toWorld( h.vehicle.eye ) ) < 0.001, 'V/first-person camera occupies the real canopy cockpit eye' );
	check( h.visual.mainRotor.rotation.y !== 0 && h.visual.tailRotor.rotation.x !== 0, 'both rotors visibly animate after spooling' );
	const visibleTriangles = h.visual.geometries.reduce( ( sum, g ) => sum + ( g.index?.count || g.attributes.position.count ) / 3, 0 );
	check( visibleTriangles > 2000 && visibleTriangles < 20000 && h.visual.cyclic && h.visual.collective && h.visual.pedals.length === 2 && h.visual.meshes.every( m => ! m.name.includes( 'instrument-needle' ) ), `authored rescue aircraft includes cabin/skids/rotors/working controls with redundant gauges removed (${ visibleTriangles } triangles)` );
	check( h.visual.meshes.find( m => m.name === 'bubble-canopy' )?.material.transparent, 'native renderer material supports transparent cockpit canopy' );
	input.keys.add( 'KeyC' ); for ( let i = 0; i < 1200 && ! h.flight.grounded; i ++ ) tick(); input.keys.clear();
	check( h.flight.grounded && h.hp === 100 && h.stats.landings === 1, 'normal descent safely lands the actual feature without damage' );
	input.pressed.add( 'KeyE' ); tick();
	check( ! h.piloted && player.mode === 'walk' && player.position.y >= h.homeY, 'E exits onto the pad after landing' );
	check( h.audio.state.rpm > 0 && ! h.flight.engineOn, 'leaving stops turbine while rotor/audio spool down' );
	const packet = sanitizeState( h.decorateState( { p: [ 0, 1, 0 ], yaw: 0, mode: 'walk' } ) );
	check( packet?.helicopter?.p.length === 3 && packet.helicopter.homeSlot === 0, 'existing wire protocol preserves helicopter pose/rotor/home slot extras' );
	const saved = h.toJSON(), h2 = new Helicopter( app, w.features, { render: false } ); h2.fromJSON( saved );
	check( h2.flight.position.distanceTo( h.flight.position ) < 0.01 && ! h2.piloted && ! h2.flight.engineOn, 'save roundtrip retains a safely parked helicopter with cold engine' );
	h2.fromJSON( { hp: NaN, pose: [ 1, Infinity, 2, 0 ] } ); check( Number.isFinite( h2.flight.position.y ) && h2.hp === 100, 'corrupt saved aircraft cannot inject invalid flight state' );
	h2.dispose(); h.dispose(); check( app.scene.children.length === 0, 'dispose removes aircraft, rotors, pad geometry and registered colliders' );
}

// Build ONLY the real tower handles/colliders, skipping renderer/terrain generation.
{
	const w = world(), city = Object.create( Meridian.prototype ); city.colliders = w.colliders; city.group = new Group(); city.handles = new Map();
	const towers = cityPlan().buildings.filter( b => b.kind === 'tower' );
	for ( const b of towers ) city.handles.set( b.id, city._handle( b, { key: 'twins', dirty: false } ) );
	w.app.meridian = city;
	for ( const b of towers ) {
		const roof = b.y + b.h, f = w.h.flight, x = b.x + 18;
		f.place( x, roof + 12, b.z ); f.rpm = 1; w.h.piloted = true; w.player.enterVehicle( w.h.vehicle ); w.input.keys.add( 'KeyC' );
		for ( let i = 0; i < 480 && ! f.grounded; i ++ ) w.tick(); w.input.keys.clear();
		check( f.grounded && Math.abs( f.position.y - roof ) < 0.03, `${ b.id }: downward approach lands on the actual roof slab` );
		check( w.h.exit() && Math.abs( w.player.position.y - roof ) < 0.1, `${ b.id }: safe door exit leaves player on the tower roof` );
		check( w.h.board(), `${ b.id }: parked helicopter remains boardable on rooftop` );
		w.input.keys.add( 'ShiftLeft' ); for ( let i = 0; i < 180; i ++ ) w.tick(); w.input.keys.clear();
		check( ! f.grounded && f.position.y > roof + 5, `${ b.id }: helicopter can take off again from rooftop` );
		w.h.piloted = false; w.player.exitVehicle( x, roof, b.z );
	}
	const b = towers[ 0 ], top = b.y + b.h, f = w.h.flight;
	f.place( b.x + 18, top, b.z ); check( f.grounded, 'landed helicopter has real tower support before collapse' );
	city.building( b.id ).setStage( 3 ); for ( let i = 0; i < 60; i ++ ) w.h.update( 1 / 60 );
	check( ! f.grounded && f.position.y < top - 4 && ! city.landingSurfaceAt( b.x + 18, b.z ), 'collapsing tower removes parked aircraft support immediately; aircraft falls' );
	city.building( b.id ).setStage( 0 );
	check( w.h.groundAt( b.x + 18, b.z, top - 20 ) < top - 100, 'query below skyscraper roof never returns its top or teleports aircraft up' );
	const saved = { v: 1, hp: 100, pose: [ b.x + 18, top, b.z, 0 ] }; city.building( b.id ).setStage( 3 ); w.h.fromJSON( saved ); w.h.update( 0 );
	check( w.h.flight.position.x === w.h.home.x, 'saved aircraft on a now-destroyed roof recovers to a supported home pad' );
	city.building( b.id ).setStage( 0 );
	const sp = new Seaplane( w.app, w.features, { models: false, site: false } );
	sp.flight.position.set( b.x + 8, top + 10, b.z );
	check( sp.flight.groundAt( b.x + 8, b.z ) === top + 6, 'existing seaplane queries the live Meridian plant roof above terrain' );
	sp.flight.position.y = top - 30; check( sp.flight.groundAt( b.x + 8, b.z ) < 10, 'existing seaplane below roof sees terrain, avoiding upward spring teleport' );
	sp.flight.place( b.x + 8, b.z, 0, top + 7 ); sp.flight.engineOn = false; sp.flight.airborne = true; sp.flight._wasAir = true; sp.flight.airTime = 2;
	const events = []; for ( let i = 0; i < 180; i ++ ) { sp.flight.update( 1 / 60 ); events.push( ...sp.flight.drainEvents() ); }
	check( events.some( e => e.type === 'touch' && e.surface === 'ground' ) && sp.flight.position.y > top + 5, 'real seaplane rigid-body model touches down and rests on elevated roof support' );
	sp.dispose(); w.h.dispose();
}

{
	const w = world(), { h } = w;
	w.features.list.set( 'netsync', { instance: { id: 'local-pilot' } } );
	const rem = { p: [ 40, 1.18, - 68 ], q: [ 0, 0, 0, 1 ], rpm: 0.9, piloted: true, homeSlot: 1 };
	h.updateRemote( [ { id: 'other-pilot', helicopter: rem } ] );
	check( h.remote.count === 1 && h.homeSlot !== 1, 'peer aircraft renders through interpolation and occupied home slot is reserved for its owner' );
	const slot = h.homeSlot; h.updateRemote( [ { id: 'new-pilot', helicopter: { ...rem, homeSlot: slot } }, { id: 'other-pilot', helicopter: rem } ] );
	check( h.homeSlot === slot, 'later joins never reshuffle a reserved local parking location' );
	h.updateRemote( [ { id: 'self', helicopter: { ...rem, p: [ NaN, 1, 0 ] } } ], { complete: true } ); check( h.remote.count === 0, 'invalid remote poses and disconnected peers remove their aircraft immediately' );
	h.updateRemote( [ { id: 'peer-a', helicopter: rem } ] ); h.updateRemote( [ { id: 'peer-b', helicopter: rem } ] );
	check( h.remote.count === 2 && h.remote.peers.has( 'peer-a' ), 'incremental state for B preserves unchanged parked aircraft A' );
	h.updateRemote( [ { id: 'peer-b', helicopter: rem } ], { complete: true } );
	check( h.remote.count === 1 && ! h.remote.peers.has( 'peer-a' ), 'full membership snapshot removes disconnected aircraft A' );
	h.updateRemote( [], { complete: true } );
	h.updateRemote( [ { id: 'local-pilot', helicopter: rem } ] ); check( h.remote.count === 0, 'own state echo cannot draw a second helicopter' );
	h.hp = 0; check( h.recall() && h.hp === 100 && h.flight.grounded, 'free service recovers and repairs a damaged helicopter after landing' );
	h.dispose();
}

{
	const w = world(), f = w.h.flight;
	w.colliders.addBox( new Vector3( 0, 31, 40 ), new Vector3( 20, 30, 1 ), 0, { solid: true } );
	f.place( 0, 25, 0 ); f.rpm = 1; w.h.piloted = true; w.player.enterVehicle( w.h.vehicle ); w.input.keys.add( 'KeyW' );
	for ( let i = 0; i < 240; i ++ ) w.tick();
	check( f.position.z < 38 && w.h.hp < 100, 'high-speed facade approach collides with the wall and damages the helicopter without tunneling' );
	w.h.piloted = false; w.player.exitVehicle( 0, 1, 0 ); f.place( 100, 20, 100 );
	for ( let i = 0; i < 180; i ++ ) w.h.update( 1 / 60 );
	check( f.grounded && w.h.hp === 0 && w.h.stats.hardLandings > 0, 'unpowered hard landing damages and disables the aircraft' );
	check( ! w.h.board() && w.h.recall() && w.h.hp === 100, 'disabled aircraft cannot be boarded until recovery/repair restores it' );
	w.h.dispose();
}

{
	const w = world(), f = w.h.flight;
	f.place( 200, 12, 200 ); w.app.terrainData.heightAt = () => - 10;
	for ( let i = 0; i < 240; i ++ ) w.h.update( 1 / 60 );
	check( f.onWater && w.h.hp === 0 && ! f.engineOn, 'unpowered water ditch disables flight and records damage' );
	w.h.piloted = true; w.player.enterVehicle( w.h.vehicle ); check( w.h.exit() && w.player.mode === 'swim', 'ditched pilot can leave safely into swimming mode' );
	w.h.dispose();
}

{
	// Actual ordered feature restoration: helicopter runs BEFORE citywreck.
	const w = world(), city = Object.create( Meridian.prototype ); city.colliders = w.colliders; city.group = new Group(); city.handles = new Map();
	const towers = cityPlan().buildings.filter( b => b.kind === 'tower' ); city.plan = { ...cityPlan(), buildings: towers }; city.roadHeight = () => 1;
	for ( const b of towers ) city.handles.set( b.id, city._handle( b, { key: 'twins', dirty: false } ) ); w.app.meridian = city;
	const cw = new CityWreck( w.app, w.features, { city, plan: city.plan, render: false } ); w.features.list.set( 'citywreck', { instance: cw } );
	const south = towers.find( b => b.id === 'twin-south' ), roofY = south.y + south.h;
	const savedHelicopter = { v: 1, hp: 41, pose: [ south.x + 18, roofY, south.z, 0 ], stats: { flights: 4, landings: 7, hardLandings: 0 } };
	w.features.reset(); w.features.fromJSON( { helicopter: savedHelicopter, citywreck: { v: 1, b: [ [ south.id, 3, 0, 0 ] ] } } );
	check( city.building( south.id ).stage === 3 && ! city.landingSurfaceAt( south.x + 18, south.z ), 'actual later CityWreck.fromJSON restores a collapsed tower after helicopter parking was read' );
	w.features.update( 1 / 60 );
	check( w.h.flight.grounded && w.h.flight.position.x === w.h.home.x && w.h.hp === 41 && w.h.stats.landings === 7 && w.h.stats.hardLandings === 0, 'first physics step recovers unsupported saved roof parking before falling, preserving condition and landing stats' );
	check( w.toasts.length === 0 && w.h.audio.state.crunches === 0, 'restore-order recovery is silent and cannot create a crash or service notification' );
	// The inverse ordering hazard: the previous session had a collapsed roof,
	// but the loaded city's intact roof must be retained once citywreck repairs it.
	w.features.fromJSON( { helicopter: savedHelicopter, citywreck: { v: 1, b: [] } } ); w.features.update( 1 / 60 );
	check( city.building( south.id ).stage === 0 && w.h.flight.grounded && Math.abs( w.h.flight.position.y - roofY ) < 0.01 && w.h.hp === 41 && w.h.stats.landings === 7, 'later restored intact roof retains parked aircraft without a spurious landing event' );
	w.h.fromJSON( savedHelicopter ); w.h.flight.position.y += 20; w.h.flight.velocity.y = 2; w.h.flight.rpm = 1; w.h.piloted = true; w.player.enterVehicle( w.h.vehicle ); w.h.drive( 1 / 60 );
	check( w.h.piloted && w.h.flight.position.y > roofY + 19 && ! w.h.flight.grounded, 'deferred parking validation never relocates a valid new airborne flight' );
	w.h.dispose(); cw.dispose();
}

{
	// Actual App.startSession order: state.load -> features.reset -> features.fromJSON.
	// A reset-triggered save would replace EVERY loaded feature before restoration.
	const w = world(), saved = new Map(); let writes = 0, recoveryEvents = 0;
	const state = new GameState( { getItem: k => saved.get( k ) ?? null, setItem: ( k, value ) => { saved.set( k, value ); writes ++; } } );
	w.app.game.state = state;
	const sibling = { value: 99, reset() { this.value = 0; }, toJSON() { return { value: this.value }; }, fromJSON( data ) { this.value = data.value; } };
	w.features.list.set( 'sibling', { instance: sibling } ); state.featuresProvider = () => w.features.toJSON();
	w.h.hp = 41; w.h.stats.landings = 7; w.h.flight.place( 150, 1, 180, 0.7 );
	state.save(); const rawSaved = saved.get( state.key );
	w.h.hp = 88; sibling.value = 12; state.load();
	const initialWrites = writes, toastCount = w.toasts.length;
	w.features.on( 'helicopterRecovered', () => recoveryEvents ++ );
	w.features.reset();
	check( writes === initialWrites && w.toasts.length === toastCount && recoveryEvents === 0, 'Features.reset performs no storage write, recovery event or service notification' );
	check( state.featuresData.sibling.value === 99 && state.featuresData.helicopter.hp === 41 && saved.get( state.key ) === rawSaved, 'feature reset cannot overwrite loaded sibling/helicopter data before session restoration' );
	w.features.fromJSON( state.featuresData );
	check( sibling.value === 99 && w.h.hp === 41 && w.h.stats.landings === 7 && w.h.flight.position.distanceTo( new Vector3( 150, 1, 180 ) ) < 0.01, 'actual GameState load/reset/fromJSON restores sibling progress, aircraft condition, landings and parking' );
	w.h.dispose();
}

console.log( `${ checks } helicopter checks passed. Headless only; no WebGPU image or audio playback acceptance.` );
