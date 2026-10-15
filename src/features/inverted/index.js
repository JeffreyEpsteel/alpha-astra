// Inverted layer feature (docs/UNREAL_PARITY.md W17): the Unreal game's upside-down world as an opt-in sky over the
// ordinary sea. Islets hang upside down high overhead at a few spots with roots trailing toward the water; the big
// landmark islet hangs between the home harbour and Pons Cove (visible from both) with a beacon at the tip of its
// spire; under the layer the sky darkens toward the zenith (the "dark void"). The yellow Easter egg: the Unreal
// project's preserved yellow / upside-down preset comes back as a golden sky and golden islets for five minutes.
//
//   features.add( 'inverted', inverted );         // import * as inverted from './features/inverted/index.js'
//   const inv = features.get( 'inverted' );
//   inv.enabled  inv.setEnabled( bool )  inv.toggle()  inv.layout  inv.pool  inv.markers()  inv.look (the applied look)
//   inv.egg (0..1 yellow weight)  inv.eggFound (times found)  inv.startEgg()  inv.setPreset( 'void' | 'yellow' | null )
//
// Opt-in: off by default. It turns on with ?inverted in the URL (?inverted=0 forces it off), with setEnabled( true )
// (a settings row: see the report), or the first time the player reaches a port whose id or name says "invert" (the
// Inverted Isles of the islands worker): the sky turns over there and stays so. Saved: { enabled, unlocked, eggFound }.
// Easter-egg trigger: land a fish in the water under the landmark's spire (Layout.rootPool) between 22:00 and 03:00,
// or an upside-down eel anywhere under an islet. Multiplayer: the egg is shared as world event 'invertedEgg'.
// Sandbox only: setPreset( kind ) forces a look (?inverted=yellow does it from the URL); null gives it back.
//
// Hooks the root needs: the MODULES entry; nothing else (it draws its own meshes and only multiplies haze density).

import { WORLD } from '../../world/WorldLayout.js';
import { invertedLayout, rootPool, proximity } from './Layout.js';
import { Islets } from './Islets.js';
import { Veil, HazeLink, lookFor, blendLook, PRESETS } from './Look.js';
import { t } from '../../i18n/index.js';

export const EGG_SECONDS = 300;
const EGG_FADE = 8; // s in and out
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

function urlParam() {

	try {

		if ( typeof location === 'undefined' ) return null;
		const q = new URLSearchParams( location.search || '' );
		return q.has( 'inverted' ) ? q.get( 'inverted' ) : null;

	} catch ( e ) {

		return null;

	}

}

export class Inverted {

	constructor( app, features, { param = urlParam() } = {} ) {

		this.app = app;
		this.features = features || null;
		this.layout = invertedLayout( WORLD );
		this.pool = rootPool( this.layout );
		this.enabled = false;
		this.unlocked = false;
		this.eggFound = 0;
		this.eggT = 0; // s of yellow world left
		this.egg = 0; // eased weight
		this.forced = null; // sandbox preset
		this.prox = 0;
		this.look = lookFor();
		this.haze = new HazeLink();
		this.islets = null;
		this.veil = null;
		this._off = [];
		this._urlOff = param === '0' || param === 'off';
		this._urlOn = param !== null && ! this._urlOff;
		if ( this._urlOn ) this.enabled = true;
		this._urlYellow = param === 'yellow';
		if ( features && features.on ) {

			this._off.push( features.on( 'fishCaught', ( e ) => this._caught( e ) ) );
			this._off.push( features.on( 'portVisited', ( e ) => this._port( e ) ) );
			this._off.push( features.on( 'remoteWorldEvent', ( e ) => {

				if ( e && e.kind === 'invertedEgg' ) this.startEgg( { remote: true } );

			} ) );

		}

	}

	get sandbox() {

		return !! ( this.features && this.features.sandbox );

	}

	_toast( key, text, ms = 3600 ) {

		const g = this.app && this.app.game;
		if ( g && g.toast ) g.toast( t( key, text ), ms );

	}

	_build() {

		if ( this.islets || ! this.app || ! this.app.scene ) return;
		try {

			this.islets = new Islets( this.layout );
			this.veil = new Veil();
			this.app.scene.add( this.islets.mesh );
			this.app.scene.add( this.veil.mesh );

		} catch ( e ) {

			console.warn( 'inverted: the layer failed to build', e );
			this.islets = null;
			this.veil = null;
			this._failed = true;

		}

	}

	setEnabled( on ) {

		this.enabled = !! on;
		return this.enabled;

	}

	toggle() {

		return this.setEnabled( ! this.enabled );

	}

	// sandbox only: force a look ( 'void' | 'yellow' ) or give it back ( null )
	setPreset( kind ) {

		if ( ! this.sandbox ) return false;
		this.forced = kind && PRESETS[ kind ] ? kind : null;
		if ( this.forced ) this.enabled = true;
		return true;

	}

	// the player's spot: the boat afloat, else the player, else the camera
	_where() {

		const app = this.app || {}, p = app.player;
		if ( p && p.position ) return p.position;
		return app.camera ? app.camera.position : null;

	}

	isEggSpot( x, z ) {

		return Math.hypot( x - this.pool.x, z - this.pool.z ) <= this.pool.r;

	}

	_caught( e ) {

		if ( ! this.enabled || this.eggT > 0 ) return;
		const p = this._where();
		if ( ! p ) return;
		const s = this.app && this.app.settings;
		const hour = s && Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;
		const night = hour >= 22 || hour < 3;
		const eel = /upside.?down|invert/i.test( String( e && e.species || '' ) );
		const under = proximity( this.layout, p.x, p.z ) >= 1;
		if ( ( this.isEggSpot( p.x, p.z ) && ( night || eel ) ) || ( eel && under ) ) this.startEgg();

	}

	_port( e ) {

		const id = String( e && e.port || '' );
		const port = ( WORLD.ports || [] ).find( ( q ) => q.id === id );
		const name = port ? port.name || '' : '';
		if ( this.unlocked || ! /invert/i.test( id + ' ' + name ) ) return;
		this.unlocked = true;
		if ( this._urlOff ) return;
		this.enabled = true;
		this._toast( 'inverted.unlocked', 'Look up: the sky has turned over, and it stays that way here.', 4200 );

	}

	// the yellow world for EGG_SECONDS (a remote one does not count toward eggFound or re-broadcast)
	startEgg( { remote = false } = {} ) {

		if ( ! this.enabled && ! remote ) return false;
		const first = this.eggT <= 0;
		this.eggT = EGG_SECONDS;
		if ( ! first ) return true;
		if ( ! remote ) {

			this.eggFound ++;
			const ns = this.app && this.app.netsync;
			if ( ns && ns.sendWorldEvent ) try { ns.sendWorldEvent( 'invertedEgg', {} ); } catch ( err ) { /* offline */ }

		}

		if ( this.enabled ) this._toast( 'inverted.egg', 'The sky turns gold: the old upside-down world remembers you.', 4600 );
		return true;

	}

	update( dt ) {

		dt = Math.max( 0, Math.min( 0.25, dt || 0 ) );
		if ( this.eggT > 0 ) this.eggT = Math.max( 0, this.eggT - dt );
		const eggOn = this.eggT > 0 || ( this._urlYellow && this.sandbox );
		const target = eggOn ? 1 : 0;
		this.egg += clamp( target - this.egg, - dt / EGG_FADE, dt / EGG_FADE );
		const active = this.enabled || this.egg > 0;
		if ( ! active ) {

			if ( this.islets ) this.islets.mesh.visible = false;
			if ( this.veil ) this.veil.mesh.visible = false;
			this.look = lookFor();
			this.haze.release( this.app );
			return;

		}

		if ( ! this.islets && ! this._failed ) this._build();
		const p = this._where();
		const prox = p ? proximity( this.layout, p.x, p.z ) : 0;
		this.prox += ( prox - this.prox ) * Math.min( 1, dt * 0.5 );
		let look = lookFor( { enabled: this.enabled, proximity: this.prox, egg: this.egg } );
		if ( this.forced && this.sandbox ) look = blendLook( PRESETS.off, PRESETS[ this.forced ], 1 );
		if ( ! this.enabled ) look = blendLook( lookFor( { enabled: true, proximity: 0 } ), PRESETS.yellow, this.egg ); // a remote egg with the layer off
		this.look = look;
		const app = this.app || {};
		const cam = app.camera;
		const under = !! ( cam && cam.position && cam.position.y < ( app.cameraWaterHeight ?? 0 ) );
		if ( this.veil ) this.veil.apply( look, under );
		if ( this.islets ) {

			this.islets.mesh.visible = this.enabled;
			this.islets.setGold( look.gold );

		}

		this.haze.apply( app, look.haze );

	}

	markers() {

		if ( ! this.enabled ) return [];
		const l = this.layout.find( ( s ) => s.landmark );
		return l ? [ { id: 'inverted-landmark', kind: 'landmark', x: l.x, z: l.z, label: t( 'inverted.landmark', 'The Hanging Spire' ) } ] : [];

	}

	toJSON() {

		return { enabled: this.enabled, unlocked: this.unlocked, eggFound: this.eggFound };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		if ( typeof d.enabled === 'boolean' && ! this._urlOff ) this.enabled = d.enabled || this.enabled;
		if ( typeof d.unlocked === 'boolean' ) this.unlocked = d.unlocked;
		if ( Number.isFinite( d.eggFound ) ) this.eggFound = Math.max( 0, Math.floor( d.eggFound ) );

	}

	reset() {

		this.enabled = this._urlOn;
		this.unlocked = false;
		this.eggFound = 0;
		this.eggT = 0;
		this.forced = null;

	}

	dispose() {

		for ( const off of this._off ) try { off(); } catch ( e ) { /* gone */ }
		this._off.length = 0;
		this.haze.release( this.app );
		if ( this.islets ) this.islets.dispose();
		if ( this.veil ) this.veil.dispose();
		this.islets = null;
		this.veil = null;

	}

}

export function install( app, features, opts = {} ) {

	return new Inverted( app, features, opts );

}

export { invertedLayout, rootPool, proximity, elevationFrom, visibleFrom } from './Layout.js';
export { PRESETS, lookFor, HazeLink } from './Look.js';

export default { install };
