// Local cockpit integration: production Cars/physics/picking/geometry, synthetic input + canvas/DOM; no GPU/browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Features } from '../src/features/Features.js';
import { Cars } from '../src/features/cars/Cars.js';
import { KINDS } from '../src/features/cars/CarData.js';
import { CarCockpit, PANEL, CONTROLS, CABIN_STYLES, cockpitLayout, rayCarPanel, hitCarControl, drawCarPanel } from '../src/features/cars/CarCockpit.js';
import { WorldMap } from '../src/ui/WorldMap.js';
import { carPanelSnapshot, drivetrain } from '../src/features/cars/CarSystems.js';
import { splitCarTrimGeometry, carCabinBounds } from '../src/features/cars/CarRender.js';
import { Group, PerspectiveCamera, Vector3, Quaternion, Matrix4, Ray, BufferGeometry, BufferAttribute } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';

let checks = 0;
const check = ( result, name ) => { assert.ok( result, name ); checks ++; console.log( 'ok', name ); };
const DT = 1 / 60;
const events = () => ( { listeners: new Map(), addEventListener( n, fn ) { this.listeners.set( n, fn ); }, removeEventListener( n, fn ) { if ( this.listeners.get( n ) === fn ) this.listeners.delete( n ); } } );
const labels = [];
const ctx = new Proxy( { fillText: text => labels.push( String( text ) ) }, { get: ( obj, key ) => key in obj ? obj[ key ] : () => {} } );
const canvas = { width: PANEL.w, height: PANEL.h, getContext: () => ctx };

class Element {

	constructor() { Object.assign( this, events() ); this.children = []; this.attributes = {}; this.dataset = {}; this.queries = new Map(); this.classes = new Set(); this.classList = { add: x => this.classes.add( x ), remove: x => this.classes.delete( x ), toggle: ( x, on ) => on ? this.classes.add( x ) : this.classes.delete( x ) }; }
	append( el ) { this.children.push( el ); el.parent = this; }
	remove() { if ( this.parent ) this.parent.children = this.parent.children.filter( c => c !== this ); }
	setAttribute( k, v ) { this.attributes[ k ] = v; }
	focus() { document.activeElement = this; }
	querySelector( selector ) {

		if ( ! this.queries.has( selector ) ) { const el = new Element(); const match = /data-car-control="(\w+)"/.exec( selector ); if ( match ) el.dataset.carControl = match[ 1 ]; if ( selector === 'button' ) el.dataset.carControl = 'engine'; this.queries.set( selector, el ); }
		return this.queries.get( selector );

	}
	closest() { return this; }

}
const savedDoc = globalThis.document, savedWindow = globalThis.window;
globalThis.window = events();
globalThis.document = Object.assign( events(), { head: new Element(), createElement: () => new Element(), getElementById: id => document.head.children.find( el => el.id === id ), exitPointerLock() { this.pointerLockElement = null; this.releases = ( this.releases || 0 ) + 1; } } );

function fixture( kind = 'sedan', visual = false ) {

	const held = new Set(), pressed = new Set(), root = new Element(), scene = new Group();
	const player = { view: 'first', mode: 'walk', position: new Vector3(), enterVehicle( v ) { this.vehicle = v; this.mode = 'plane'; }, exitVehicle( x, y, z, yaw, mode ) { this.vehicle = null; this.mode = mode; this.position.set( x, y, z ); } };
	const app = { mode: 'campaign', scene, player, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), settings: { timeOfDay: 12 },
		input: { enabled: true, locked: true, sensitivity: 1, down: c => held.has( c ), hit: c => pressed.has( c ) },
		ui: { ui: { root, hud: root } }, game: { state: { money: 0 }, toast() {} } };
	const features = new Features( app );
	const cars = features.add( 'cars', { install: ( a, f ) => new Cars( a, f, { render: false, scale: 0, terrain: { heightAt: () => 0 }, roadHeight: () => 0, flatRoads: true, traffic: { cars: 0, buses: 0, police: 0, fill: 0 } } ) } );
	if ( visual ) { cars.cockpit.dispose(); cars.cockpit = new CarCockpit( cars, { visual: true, canvas } ); }
	const r = cars._record( kind, { x: 0, y: 0, z: 0, yaw: 0, state: 'idle' } ); r.own = true; cars.records.push( r );
	const step = ( n = 1 ) => { for ( let i = 0; i < n; i ++ ) { cars.update( DT ); pressed.clear(); } };
	const press = code => { pressed.add( code ); step(); };
	return { app, cars, features, r, held, step, press, root };

}

function authoredTrim( spec ) {

	const file = readFileSync( new URL( '../public/models/' + spec.glb, import.meta.url ) );
	const gltf = parseGLB( file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength ) ); let found;
	const visit = ( index, parent ) => {

		const node = gltf.nodes[ index ], matrix = new Matrix4().multiplyMatrices( parent, new Matrix4().compose( new Vector3( ...node.t ), new Quaternion( ...node.r ), new Vector3( ...node.s ) ) );
		for ( const primitive of gltf.meshes[ node.mesh ] || [] ) if ( gltf.materials[ primitive.material ].name === 'CarTrim' ) {

			found = new BufferGeometry();
			for ( const [ k, name ] of [ [ 'POSITION', 'position' ], [ 'NORMAL', 'normal' ], [ 'TEXCOORD_0', 'uv' ] ] ) { const a = primitive.attributes[ k ]; found.setAttribute( name, new BufferAttribute( new Float32Array( a.array ), a.itemSize ) ); }
			found.setIndex( Array.from( primitive.indices ) ); found.applyMatrix4( matrix );

		}
		for ( const child of node.children ) visit( child, matrix );

	};
	for ( const index of gltf.roots ) visit( index, new Matrix4() ); return found;

}

try {

	const cabinShapes = new Set(), instrumentLayouts = new Set();
	for ( const kind of Object.keys( KINDS ) ) {

		// Use the SAME dimensions/eye/seat for every kind, so paint and different GLB sizes cannot pass this check.
		const f = fixture( kind, true ); f.r.spec = KINDS.sedan; f.cars.enter( f.r );
		cabinShapes.add( JSON.stringify( Array.from( f.cars.cockpit.group.children[ 0 ].geometry.attributes.position.array ) ) );
		check( f.cars.cockpit.group.userData.cabinStyle === CABIN_STYLES[ kind ].id, kind + ': authored cabin style attached to physical cabin' );
		const trace = [], draw = new Proxy( {}, { get: ( _, key ) => ( ...args ) => { if ( [ 'arc', 'fillRect', 'strokeRect', 'moveTo', 'lineTo' ].includes( key ) ) trace.push( [ key, ...args ] ); } } );
		drawCarPanel( draw, { ...carPanelSnapshot( f.cars ), name: 'same name', kind } ); instrumentLayouts.add( JSON.stringify( trace ) );
		f.cars.dispose();

	}
	check( cabinShapes.size === 7, 'all seven cabin geometries differ even with identical dimensions and no color comparison' );
	check( instrumentLayouts.size === 7, 'all seven panel drawing layouts differ beyond labels and colors' );

	for ( const [ kind, spec ] of Object.entries( KINDS ) ) {

		const w = fixture( kind, true ), { cars, r, app } = w;
		check( cars.enter( r ).ok && cars.cockpit.record === r && r.cockpitDetailed, kind + ': boarding creates one local detailed cabin' );
		const trim = authoredTrim( spec ), split = splitCarTrimGeometry( trim ), bounds = carCabinBounds( spec, split.glass );
		cars.render = { sets: new Map( [ [ kind, { cabinBounds: bounds } ] ] ), draw() {}, dispose() {} }; w.step();
		const cp = cars.cockpit, group = cp.group, L = cp.layout; group.updateMatrixWorld( true );
		if ( kind === 'van' ) {

			const cam = new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), eye = new Vector3( ...spec.eye ); cam.position.copy( eye );
			cam.lookAt( eye.clone().add( new Vector3( 0, Math.sin( - 0.08 ), Math.cos( - 0.08 ) ) ) ); cam.updateMatrixWorld( true );
			for ( const px of [ 157, 408 ] ) {

				// Bottom corners of the digital-number boxes, beyond their text baselines.
				for ( const dx of [ - 58, 58 ] ) {

					const point = new Vector3( L.x - ( ( px + dx ) / PANEL.w - 0.5 ) * L.w, L.y + ( 0.5 - 214 / PANEL.h ) * L.h * Math.cos( L.tilt ), L.z + ( 0.5 - 214 / PANEL.h ) * L.h * Math.sin( L.tilt ) ).project( cam );
					check( Math.abs( point.x ) < 0.95 && Math.abs( point.y ) < 0.95, 'van: digital speed/RPM box fits default forward camera with margin' );

				}

			}
			check( L.w === 0.78 && spec.eye[ 2 ] === 1.25 && spec.seat[ 2 ] === 1.2, 'van: compact panel preserves authored eye and seat' );

		} else check( L.w === 1.32 && L.y === spec.eye[ 1 ] - 0.36, kind + ': original cockpit layout remains unchanged' );
		w.step( 3 ); check( cp.group === group, kind + ': loaded window bounds rebuild only once' );
		check( cp.mesh && cp.wheel && cp.pedals.length === 2 && group.children.length <= 6, kind + ': panel, moving wheel and pedals stay in a small local draw budget' );
		const eye = new Vector3( ...spec.eye ), ray = new Ray( eye, new Vector3( 0, 0, 1 ) ); let blocked = false;
		group.traverse( mesh => {

			if ( ! mesh.geometry ) return; const g = mesh.geometry, p = g.attributes.position.array, ids = g.index?.array || Array.from( { length: p.length / 3 }, ( _, i ) => i );
			check( Array.from( p ).every( Number.isFinite ), kind + ': finite cockpit geometry' );
			for ( let i = 0; i < ids.length; i += 3 ) {

				const vertices = [ ids[ i ], ids[ i + 1 ], ids[ i + 2 ] ].map( j => new Vector3( ...p.slice( j * 3, j * 3 + 3 ) ).applyMatrix4( mesh.matrixWorld ) );
				const hit = ray.intersectTriangle( ...vertices, false, new Vector3() ); if ( hit && hit.distanceTo( eye ) < spec.len ) blocked = true;

			}

		} );
		check( ! blocked, kind + ': detailed cabin leaves forward windshield sightline clear' );
		for ( const control of CONTROLS.filter( c => ! c.police || kind === 'police' ) ) {

			const px = control.x + control.w / 2, py = control.y + control.h / 2;
			const target = new Vector3( L.x - ( px / PANEL.w - 0.5 ) * L.w, L.y + ( 0.5 - py / PANEL.h ) * L.h * Math.cos( L.tilt ), L.z + ( 0.5 - py / PANEL.h ) * L.h * Math.sin( L.tilt ) );
			const hit = rayCarPanel( eye, target.clone().sub( eye ).normalize(), L );
			check( hit && hitCarControl( hit.px, hit.py, kind )?.id === control.id, kind + ': eye ray reaches ' + control.id );
			const sight = new Ray( eye, target.clone().sub( eye ).normalize() ); let occluded = false;
			group.traverse( mesh => {

				if ( ! mesh.geometry || mesh === cp.mesh ) return;
				const g = mesh.geometry, p = g.attributes.position.array, ids = g.index?.array || Array.from( { length: p.length / 3 }, ( _, i ) => i );
				for ( let i = 0; i < ids.length; i += 3 ) {

					const vertices = [ ids[ i ], ids[ i + 1 ], ids[ i + 2 ] ].map( j => new Vector3( ...p.slice( j * 3, j * 3 + 3 ) ).applyMatrix4( mesh.matrixWorld ) );
					const h = sight.intersectTriangle( ...vertices, false, new Vector3() ); if ( h && h.distanceTo( eye ) < target.distanceTo( eye ) - 0.005 ) occluded = true;

				}

			} );
			check( ! occluded, kind + ': real cabin triangles do not obscure ' + control.id + ' switch' );

		}
		app.camera.position.set( r.x + spec.eye[ 0 ], r.y + spec.eye[ 1 ], r.z + spec.eye[ 2 ] );
		const horn = CONTROLS.find( c => c.id === 'horn' ), target = new Vector3( L.x - ( ( horn.x + horn.w / 2 ) / PANEL.w - 0.5 ) * L.w, L.y + ( 0.5 - ( horn.y + horn.h / 2 ) / PANEL.h ) * L.h * Math.cos( L.tilt ), L.z + ( 0.5 - ( horn.y + horn.h / 2 ) / PANEL.h ) * L.h * Math.sin( L.tilt ) );
		app.camera.lookAt( target ); app.input.mouseDown = true; cp.update( DT );
		check( cp.hover === 'horn' && cars._hornPulse > 0, kind + ': actual cockpit gaze + mouse press routes horn' );
		app.input.locked = false; app.input.dom = { getBoundingClientRect: () => ( { left: 0, top: 0, width: 1440, height: 900 } ) }; cp.mouse = { x: 720, y: 450 };
		check( cp._aimAt()?.id === 'horn', kind + ': free mouse ray resolves same physical control' ); app.input.locked = true;
		app.input.mouseDown = false; cp.update( DT );
		const angle = cp.wheel.rotation.z; w.held.add( 'KeyA' ); w.step( 15 ); w.held.clear();
		check( cp.wheel.rotation.z !== angle && Math.abs( cp.wheel.rotation.z + r.body.steer * 2.4 ) < 1e-9, kind + ': steering wheel follows actual rack angle' );
		const geometry = cp.mesh.geometry, texture = cp.tex; let released = 0; geometry.addEventListener( 'dispose', () => released ++ );
		const version = texture.version;
		check( cars.exit() && ! cp.group && ! r.cockpitDetailed && app.player.mode === 'walk', kind + ': exiting removes local cabin and returns driver to walking' );
		check( released === 1 && texture.version > version && ! group.parent, kind + ': exit disposes geometry and texture' );
		cars.enter( r ); check( !! cp.group && app.scene.children.length === 1, kind + ': reboarding recreates exactly one local cabin' );
		cars.dispose(); for ( const g of [ trim, split.trim, split.glass ] ) g.dispose();

	}

	const w = fixture(), { cars, r, app, held, press, step } = w; cars.enter( r );
	press( 'Digit3' ); check( cars.isOpen() && cars.cockpit.el?.attributes[ 'aria-label' ] === 'Car dashboard controls', '3 opens accessible dashboard panel' );
	document.pointerLockElement = {}; cars.cockpit.close(); cars.cockpit.open(); check( ! document.pointerLockElement && document.releases > 0, 'controls panel releases pointer capture' );
	held.add( 'KeyW' ); step( 60 ); check( r.body.speed === 0, 'open dashboard blocks drive input' ); held.clear();
	const engineButton = new Element(); engineButton.dataset.carControl = 'engine'; cars.cockpit._onButton( { target: engineButton } );
	check( r.engineOn === false, 'accessible engine button invokes real engine switch' );
	const grid = cars.cockpit.el.querySelector( '.car-driver-grid' ); cars.cockpit._dom();
	check( grid.innerHTML.includes( 'aria-pressed="false"' ) && grid.innerHTML.includes( 'Engine start / stop' ), 'accessible buttons expose labels and switch state' );
	let stopped = 0, prevented = 0;
	for ( const code of [ 'Tab', 'Space', 'Enter' ] ) document.listeners.get( 'keydown' )( { code, stopPropagation() { stopped ++; }, preventDefault() { prevented ++; } } );
	check( stopped === 3 && prevented === 0, 'native Tab focus and Space/Enter button activation bypass game key prevention' );
	const escape = { code: 'Escape', preventDefault() {}, stopPropagation() {} }; document.listeners.get( 'keydown' )( escape ); check( ! cars.isOpen() && ! document.listeners.has( 'keydown' ), 'Escape closes controls and unregisters handler' );
	// Production map key dispatch retains the engine button's focus; an immediate native Enter must be inert.
	cars.cockpit.open(); const focused = document.activeElement, beforeMap = r.engineOn;
	const map = { isOpen: false, feature: {}, _canOpen: () => true, open() { this.isOpen = true; } };
	w.features.add( 'map-fixture', { install: () => ( { isOpen: () => map.isOpen } ) } );
	const keyEvent = code => ( { code, preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} } );
	WorldMap.prototype.key.call( map, keyEvent( 'KeyM' ) );
	check( map.isOpen && document.activeElement === focused, 'real M dispatch opens map while old dashboard button retains focus' );
	const enter = keyEvent( 'Enter' ); WorldMap.prototype.key.call( map, enter ); cars.cockpit._onKey( enter );
	cars.cockpit._onButton( { target: focused } );
	check( enter.prevented && ! cars.cockpit.isOpen && r.engineOn === beforeMap && ! cars.cockpitAct( 'engine' ).ok, 'map overlay closes tray and prevents stale focused-button and public-API engine activation' );
	map.isOpen = false;
	for ( const [ owner, key ] of [ [ app.ui.ui, 'helpOpen' ], [ app.ui.ui, 'panelOpen' ], [ app.ui.ui, 'photoMode' ], [ app.game.hud = {}, 'invOpen' ] ] ) {

		cars.cockpit.open(); owner[ key ] = true; cars.cockpit.update( DT );
		check( ! cars.cockpit.isOpen && ! cars.cockpitAct( 'horn' ).ok, key + ': external UI blocks dashboard controls and closes tray' ); owner[ key ] = false;

	}
	held.add( 'KeyW' ); step( 90 ); check( r.body.speed === 0 && ! cars.audio.state.on && carPanelSnapshot( cars ).rpm === 0, 'engine off disables drive, sound and RPM' );
	held.clear(); held.add( 'KeyS' ); step( 60 ); check( r.body.speed === 0, 'engine off refuses powered reverse' );
	r.body.vz = - 6; step( 120 ); check( Math.abs( r.body.speed ) < 0.4, 'engine off service brake still stops backward motion' ); held.clear();
	check( cars.cockpitAct( 'engine' ).ok && r.engineOn, 'stopped car engine restarts' );
	held.add( 'KeyW' ); step( 180 ); held.clear();
	const s = carPanelSnapshot( cars ); check( s.speed > 35 && s.rpm > 780 && /^D[1-6]$/.test( s.gear ) && Math.abs( s.rpm / 6500 - cars.audio.state.rpm ) < 1e-9, 'live speed, automatic gear and RPM match physics and engine audio' );
	check( ! cars.cockpitAct( 'engine' ).ok && r.engineOn, 'engine toggle safely refused while moving' );
	cars.cockpitAct( 'park' ); step( 240 ); check( Math.abs( r.body.speed ) < 0.4 && r.parkBrake && carPanelSnapshot( cars ).gear === 'P', 'parking brake stops and holds actual car' );
	cars.cockpitAct( 'park' ); held.add( 'KeyS' ); step( 60 ); held.clear(); check( r.body.speed < - 1 && carPanelSnapshot( cars ).gear === 'R', 'S produces powered reverse and real R indication' );
	r.body.place( 0, 0, 0, 0 );
	cars.lightsOn = null; app.settings.timeOfDay = 12; cars._lightsUpdate( false ); cars.cockpitAct( 'lights' ); cars._lightsUpdate( false );
	check( r.lights && cars.lights.every( l => l.enabled ), 'headlight button enables actual world spotlights' );
	cars.cockpitAct( 'horn' ); step(); check( cars.audio.state.horn, 'horn pulse reaches audio' ); step( 30 ); check( ! cars.audio.state.horn, 'horn pulse releases without a stuck key' );
	cars.cockpitAct( 'engine' ); cars.cockpitAct( 'horn' ); step(); check( cars.audio.state.horn && ! cars.audio.state.on, 'horn still works with engine stopped' );
	r.parkBrake = true;
	const saved = JSON.parse( JSON.stringify( cars.toJSON() ) ), loaded = fixture(); loaded.cars.fromJSON( saved );
	check( loaded.cars.owned().length === 1 && loaded.cars.owned()[ 0 ].engineOn === false && loaded.cars.owned()[ 0 ].parkBrake === true, 'owned-car engine and parking brake survive save round trip' );
	delete saved.owned[ 0 ].engineOn; delete saved.owned[ 0 ].parkBrake; loaded.cars.fromJSON( saved );
	check( loaded.cars.owned()[ 0 ].engineOn && ! loaded.cars.owned()[ 0 ].parkBrake, 'legacy saves keep original ready-to-drive defaults' ); loaded.cars.dispose();
	app.paused = true; check( ! cars.cockpitAct( 'engine' ).ok, 'paused dashboard actions refused' ); app.paused = false;
	const remote = cars._record( 'sedan', { state: 'remote' } ); cars.exit( { force: true } ); check( ! cars.enter( remote ).ok && ! cars.cockpitAct( 'engine' ).ok, 'another player car stays locked and out-of-car switches do nothing' );
	cars.enter( r ); press( 'Digit3' ); app.player.mode = 'walk'; app.player.vehicle = null; step(); check( ! cars.drive && ! cars.cockpit.record && ! cars.isOpen(), 'external respawn clears cockpit and modal' );
	cars.dispose(); check( ! window.listeners.has( 'mousemove' ) && ! document.listeners.has( 'keydown' ), 'feature disposal removes pointer and keyboard listeners' );
	const police = fixture( 'police' ); police.cars.enter( police.r ); police.cars.cockpitAct( 'siren' ); police.step(); check( police.cars.siren && police.cars.audio.state.siren, 'police dashboard siren affects real sound/beacons' ); police.cars.dispose();
	check( ! rayCarPanel( new Vector3( 0, 0, 9 ), new Vector3( 0, 0, - 1 ), cockpitLayout( KINDS.sedan ) ), 'panel rejects rays through dashboard back face' );
	labels.length = 0; drawCarPanel( ctx, { ...s, kind: 'police', lightMode: 'AUTO', hp: 37, hover: 'lights' } );
	check( labels.includes( 'RPM × 1000' ) && labels.includes( 'km/h' ) && labels.includes( s.gear ) && labels.includes( 'CONDITION 37%' ) && labels.includes( 'POLICE SIREN' ), 'instrument artwork includes live units, gear, condition and functional switches' );

} finally {

	globalThis.document = savedDoc; globalThis.window = savedWindow;

}
console.log( `${ checks } car cockpit checks passed` );
