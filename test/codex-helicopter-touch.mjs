// Stand-in DOM drives the actual TouchControls pointer/button handlers and HUD.
import assert from 'node:assert/strict';
const events = [], keys = new Set();
class El {
	constructor( tag ) {
		this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.className = ''; this.hidden = false; this.attrs = {}; this._q = new Map(); this.listeners = {}; this.textContent = '';
		this.style = { setProperty() {}, removeProperty() {} }; const cls = new Set();
		this.classList = { add: ( ...c ) => c.forEach( x => cls.add( x ) ), remove: ( ...c ) => c.forEach( x => cls.delete( x ) ), contains: c => cls.has( c ) || this.className.split( ' ' ).includes( c ), toggle: ( c, on ) => { if ( on === undefined ) on = ! cls.has( c ); if ( on ) cls.add( c ); else cls.delete( c ); return !! on; } };
	}
	set innerHTML( v ) { this._html = v; this._q.clear(); } get innerHTML() { return this._html || ''; }
	get firstChild() { return this.querySelector( ':first' ); }
	append( ...nodes ) { for ( const n of nodes ) { n.parentNode = this; this.children.push( n ); } }
	remove() { this.removed = true; }
	setAttribute( k, v ) { this.attrs[ k ] = v; } getAttribute( k ) { return this.attrs[ k ]; }
	addEventListener( t, fn ) { ( this.listeners[ t ] ||= [] ).push( fn ); } removeEventListener() {}
	dispatchEvent( e ) { events.push( e ); if ( e.type === 'keydown' ) keys.add( e.code ); else if ( e.type === 'keyup' ) keys.delete( e.code ); return true; }
	querySelector( s ) { if ( ! this._q.has( s ) ) this._q.set( s, new El( 'span' ) ); return this._q.get( s ); }
	querySelectorAll() { return []; }
	closest( selector ) { return selector.split( ',' ).some( s => this.classList.contains( s.trim().replace( /^\./, '' ) ) ) ? this : null; }
	setPointerCapture() {} getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; }
}
globalThis.window = { innerWidth: 844, innerHeight: 390, addEventListener() {}, removeEventListener() {} };
globalThis.document = { createElement: t => new El( t ), body: new El( 'body' ), head: new El( 'head' ), documentElement: new El( 'html' ) };
globalThis.KeyboardEvent = class { constructor( type, opts ) { this.type = type; Object.assign( this, opts ); } };
globalThis.screen = { orientation: { angle: 90 } };
const { TouchControls, HELICOPTER_BUTTONS, helicopterButtons } = await import( '../src/ui/TouchControls.js' );
const { Helicopter } = await import( '../src/features/helicopter/Helicopter.js' );
const { Features } = await import( '../src/features/Features.js' );
const { Vector3 } = await import( '../src/engine/index.js' );
let count = 0; const check = ( c, s ) => { assert.ok( c, s ); count ++; console.log( 'ok', s ); };
let touchKeys = new Set();
const input = { enabled: true, down: c => keys.has( c ) || touchKeys.has( c ), hit: () => false, setTouchKeys: s => { touchKeys = new Set( s ); }, setTouchButton() {}, releaseTouch() { keys.clear(); touchKeys.clear(); }, addTouchLook() {} };
const player = { mode: 'walk', position: new Vector3(), view: 'third', enterVehicle( v ) { this.vehicle = v; this.mode = 'plane'; return true; }, exitVehicle( x, y, z ) { this.vehicle = null; this.mode = 'walk'; this.position.set( x, y, z ); } };
const app = { player, input, terrainData: { heightAt: () => 1 }, game: { state: {}, rod: { equipped: true } } }, features = app.features = new Features( app );
const h = new Helicopter( app, features, { render: false } ); features.list.set( 'helicopter', { instance: h } );
const ui = { root: new El( 'div' ) }; app.ui = { ui };
const tc = new TouchControls( { app, ui, input, device: { coarse: true, phone: true }, storage: { getItem: () => null, setItem() {} } } );
player.position.copy( h.flight.toWorld( [ 1.35, 0, 0.65 ] ) ); h.board(); tc.update( 1 / 60 );
check( tc._mode() === 'helicopter' && tc.root.dataset.mode === 'helicopter', 'touch distinguishes helicopter from generic plane and car' );
check( HELICOPTER_BUTTONS.every( id => ! tc.btns[ id ].hidden && parseInt( tc.btns[ id ].style.minHeight ) >= 48 ), 'rise, descend, hover and both slides have separate visible 48 px targets' );
check( tc.leverEl.hidden && tc.btns.cockpit.hidden && tc.btns.bail.hidden && tc.btns.cast.hidden, 'plane throttle/bail and fishing controls do not appear in rotorcraft' );
tc._stick = { v: { x: 0.8, y: - 0.8, mag: 1, sprint: true, kx: 30, ky: - 30 } }; tc._sync();
check( ! touchKeys.has( 'ShiftLeft' ) && ( touchKeys.has( 'KeyW' ) || touchKeys.has( 'KeyD' ) ), 'outer stick controls movement without accidental climb from sprint ring' );
const press = id => tc._press( 7, tc.btns[ id ] ), release = () => tc._up( { pointerId: 7, type: 'pointerup', clientY: 0 } );
press( 'heliRise' ); check( h._input().lift === 1, 'held Rise reaches actual helicopter collective' ); release(); check( h._input().lift === 0, 'releasing Rise restores hover collective' );
press( 'heliDescend' ); check( h._input().lift === - 1, 'held Descend reaches actual helicopter collective' ); release();
press( 'heliHover' ); check( h._input().brake, 'hover button arrests cyclic motion' ); release();
press( 'heliLeft' ); check( h._input().strafe === - 1, 'slide left maps to lateral flight control' ); release();
press( 'heliRight' ); check( h._input().strafe === 1, 'slide right maps to lateral flight control' ); release();
tc._stick = null; tc._sync();
press( 'heliRise' ); ui.panelOpen = true; tc.update( 1 / 60 );
check( ! keys.has( 'ShiftLeft' ) && h._input().lift === 0 && h._input().brake, 'opening a panel releases held collective and neutralizes flight inputs' );
check( helicopterButtons( { mode: 'helicopter', busy: true } ).size === 0, 'all aircraft touch actions suppress while map/menu owns input' );
h.hud.update( h ); check( h.hud.root.hidden, 'flight instruments hide behind open panels' );
ui.panelOpen = false; h.hud.update( h ); check( ! h.hud.root.hidden && /ALT.*AGL/s.test( h.hud.root.textContent ) && /ROTOR.*HULL/s.test( h.hud.root.textContent ), 'piloted HUD exposes altitude, clearance, rotor, vertical speed and hull state' );
app.menuOpen = true; h.hud.update( h ); check( h.hud.root.hidden, 'pause menu hides flight instruments' ); app.menuOpen = false;
h.reset(); h.hud.update( h ); check( player.mode === 'walk' && ! player.vehicle && h.hud.root.hidden, 'reset leaves the vehicle lifecycle and hides flight instruments' );
tc.dispose(); h.dispose(); check( document.body.children.filter( e => e.className === 'helicopter-flight-hud' ).every( e => e.removed ), 'HUD cleans up its DOM on feature disposal' );
console.log( `${ count } helicopter touch/HUD checks passed. Stand-in DOM only.` );
