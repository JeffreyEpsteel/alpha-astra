// Real registry + firearm/exploration modules and Input hit/endFrame dispatch; no DOM, GPU, storage or server.
import assert from 'node:assert/strict';
import { Features } from '../src/features/Features.js';
import { Input } from '../src/core/Input.js';
import { Group, PerspectiveCamera, Vector3 } from '../src/engine/index.js';
import * as firearms from '../src/features/firearms/index.js';
import * as exploration from '../src/features/exploration/index.js';
import { CONTROLS, controlKeyLabel } from '../src/ui/UI.js';
import en from '../src/i18n/en.js';

let checks = 0;
function check( condition, message ) { assert.ok( condition, message ); checks ++; console.log( 'ok', message ); }

function fixture( order = [ 'firearms', 'exploration' ] ) {

	// Construct input's non-DOM state; dispatch uses its production methods unchanged.
	const input = Object.assign( Object.create( Input.prototype ), { enabled: true, keys: new Set(), pressed: new Set(), _latch: new Set(), sensitivity: 1, mouseDown: false, rightDown: false } );
	const app = {
		mode: 'campaign', input, freeCam: false, scene: new Group(), camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ),
		player: { mode: 'walk', position: new Vector3( 50, 2, - 60 ), grounded: true },
		game: { state: { featuresData: {} }, toast() {}, rod: { equipped: false } },
		cameraFeel: { baseFov: () => 60 },
		firearmsOptions: { mesh: false, hud: false, audio: { click() {} } },
	};
	app.camera.position.set( 50, 3, - 60 );
	const features = new Features( app );
	for ( const name of order ) features.add( name, name === 'firearms' ? firearms : { install: ( a, f ) => exploration.install( a, f, { sites: [] } ) } );
	const fa = features.get( 'firearms' ), sg = features.get( 'exploration' ).spyglass;
	fa.owned.pistol = true; fa.owned.musket = true;
	const press = code => { input.pressed.add( code ); features.update( 1 / 60 ); input.endFrame(); };
	return { app, features, fa, sg, press };

}

for ( const order of [ [ 'firearms', 'exploration' ], [ 'exploration', 'firearms' ] ] ) {

	const { app, features, fa, sg, press } = fixture( order );
	check( fa.keyOk && sg.keyOk && features._keys.get( 'KeyG' ) === 'firearms' && features._keys.get( 'Backslash' ) === 'exploration', `both keys claimed (${ order.join( ' then ' ) })` );
	press( 'KeyG' ); check( fa.weapon === 'pistol' && sg.level === 0, 'G draws pistol without raising spyglass' );
	press( 'KeyG' ); check( fa.weapon === 'musket' && sg.level === 0, 'G cycles musket without raising spyglass' );
	press( 'KeyG' ); check( ! fa.drawn && sg.level === 0, 'G holsters without raising spyglass' );
	press( 'Backslash' ); check( sg.level === 1 && app.camera.fov === 15 && ! fa.drawn, 'Backslash raises x4 without drawing firearm' );
	press( 'Backslash' ); check( sg.level === 2 && Math.abs( app.camera.fov - 60 / 9 ) < 1e-9 && ! fa.drawn, 'Backslash zooms x9 without drawing firearm' );
	press( 'Backslash' ); check( sg.level === 0 && app.camera.fov === 60 && app.input.sensitivity === 1, 'third press lowers and restores camera/look' );
	press( 'Backslash' ); features.closePanels(); check( sg.level === 0 && app.camera.fov === 60, 'registry panel close lowers spyglass' );
	features.add( 'fixture-panel', { install: () => ( { isOpen: true } ) } );
	press( 'Backslash' ); check( sg.level === 0, 'modal panel blocks spyglass activation' );
	features.list.delete( 'fixture-panel' ); app.player.mode = 'swim';
	press( 'Backslash' ); check( sg.level === 0, 'swimming still refuses spyglass' );
	app.player.mode = 'boat'; press( 'Backslash' ); check( sg.level === 1 && ! fa.drawn, 'spyglass works at the helm while firearm stays holstered' );
	check( [ ...features.list.values() ].every( f => ! f.failed ), 'both feature updates completed without swallowed errors' );
	features.dispose();

}

for ( const context of [ 'foot', 'helm' ] ) {

	const row = CONTROLS.find( s => s.id === context ).rows.find( r => r.k.includes( 'Backslash' ) );
	check( row?.text === en[ 'ui.help.spyglass' ], `${ context } F1 controls show translated spyglass binding` );

}
check( [ '\\', 'Backslash' ].includes( controlKeyLabel( 'Backslash' ) ), 'Backslash key cap has a readable label' );
console.log( `${ checks } keybinding checks passed` );
