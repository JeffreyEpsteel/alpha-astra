import { padFamily } from '../core/Gamepad.js';

// Controller glyphs: the label of an action's button on the device the player used last (keyboard, Xbox or
// PlayStation pad; core/Gamepad.js tracks it), so tips and toasts can say "Press X" or "Press □" instead of "E".
//
//   attachGlyphs( app )                 follow app.gamepad's last device and app.input's key / pad bindings; elements
//                                       with data-glyph="interact" anywhere in the page are re-labelled on a switch
//   glyph( 'interact' ) -> 'E' | 'X' | '□'          the label on the current device (or glyph( action, device ))
//   glyphHTML( 'interact' ) -> '<kbd class="glyph glyph-xbox" data-glyph="interact">X</kbd>'
//   glyphFor( action, device ) -> { label, device, kind: 'key' | 'pad', code, button }
//   currentDevice() -> 'keyboard' | 'xbox' | 'playstation' | 'gamepad'
//   onGlyphsChange( fn ) -> unsubscribe     refreshGlyphs( root = document )
//
// Actions are the Accessibility action ids (interact, jump, dive, sprint, rod, view, cooler, crew, journal,
// portGuns, starboardGuns, evade, board, light, map...) plus cast, reel, menu, controls, settings; a raw key code
// ('KeyE') works too. Actions with no pad button (the guns, the journal) show their key on every device.

// action -> logical key code (the code callers ask Input for) and the default pad button (standard mapping)
export const GLYPH_ACTIONS = {
	forward: { code: 'KeyW', pad: 'LS' }, back: { code: 'KeyS', pad: 'LS' }, left: { code: 'KeyA', pad: 'LS' }, right: { code: 'KeyD', pad: 'LS' },
	move: { code: 'KeyW', label: 'WASD', pad: 'LS' }, look: { code: null, label: 'Mouse', pad: 'RS' },
	jump: { code: 'Space', button: 0 }, dive: { code: 'KeyC', button: 1 }, interact: { code: 'KeyE', button: 2 },
	rod: { code: 'KeyR', button: 3 }, view: { code: 'KeyV', button: 4 }, sprint: { code: 'ShiftLeft', button: 5 },
	cast: { code: 'Mouse0', button: 7 }, reel: { code: 'Mouse2', button: 6 },
	controls: { code: 'F1', button: 8 }, settings: { code: 'KeyH', button: 9 }, menu: { code: 'Escape', button: 9 },
	cooler: { code: 'KeyI', button: 12 }, crew: { code: 'KeyK', button: 13 }, map: { code: 'KeyM', button: 14 },
	journal: { code: 'KeyJ' }, light: { code: 'KeyL' }, portGuns: { code: 'KeyZ' }, starboardGuns: { code: 'KeyX' },
	evade: { code: 'KeyQ' }, board: { code: 'KeyB' }, freecam: { code: 'KeyF' }, time: { code: 'KeyT' }, debug: { code: 'Backquote' },
};

export const PAD_NAMES = {
	xbox: [ 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Xbox' ],
	playstation: [ '✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'PS' ],
	gamepad: [ 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home' ],
};
const STICKS = { xbox: { LS: 'Left stick', RS: 'Right stick' }, playstation: { LS: 'Left stick', RS: 'Right stick' }, gamepad: { LS: 'Left stick', RS: 'Right stick' } };

const KEY_NAMES = {
	Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
	Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps', Backspace: 'Backspace', Backquote: '`', Minus: '-', Equal: '=',
	BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
	ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB',
	PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
};

// 'KeyE' -> 'E', 'Digit1' -> '1', 'Numpad4' -> 'Num 4', 'F1' -> 'F1'
export function keyName( code ) {

	if ( ! code ) return '';
	if ( KEY_NAMES[ code ] ) return KEY_NAMES[ code ];
	let m = /^Key([A-Z])$/.exec( code );
	if ( m ) return m[ 1 ];
	m = /^Digit(\d)$/.exec( code );
	if ( m ) return m[ 1 ];
	m = /^Numpad(.+)$/.exec( code );
	if ( m ) return 'Num ' + m[ 1 ];
	return code;

}

export function padName( button, family = 'xbox' ) {

	const names = PAD_NAMES[ family ] || PAD_NAMES.gamepad;
	if ( typeof button === 'string' ) return ( STICKS[ family ] || STICKS.gamepad )[ button ] || button;
	return Number.isInteger( button ) && names[ button ] ? names[ button ] : '?';

}

// ---- the source of truth: the app's gamepad (device) and input (bindings)
let source = null; // { gamepad, input }
const listeners = new Set();
let unsub = null;

export function attachGlyphs( app ) {

	if ( unsub ) unsub();
	unsub = null;
	source = app ? { gamepad: app.gamepad || null, input: app.input || null } : null;
	const gp = source && source.gamepad;
	if ( gp && typeof gp.onDeviceChange === 'function' ) {

		unsub = gp.onDeviceChange( ( d, prev ) => {

			if ( typeof document !== 'undefined' ) refreshGlyphs( document );
			for ( const fn of [ ...listeners ] ) {

				try { fn( d, prev ); } catch ( e ) { /* ignore */ }

			}

		} );

	}

	return { detach: () => { if ( unsub ) unsub(); unsub = null; source = null; } };

}

export function currentDevice() {

	const gp = source && source.gamepad;
	return gp && typeof gp.device === 'string' ? gp.device : 'keyboard';

}

export function onGlyphsChange( fn ) {

	listeners.add( fn );
	return () => listeners.delete( fn );

}

function physicalKey( code ) {

	const inp = source && source.input;
	const b = inp && inp._bindings;
	return b && typeof b[ code ] === 'string' && b[ code ] ? b[ code ] : code;

}

function padButtonOf( code, fallback ) {

	const inp = source && source.input;
	return inp && typeof inp.padButton === 'function' ? inp.padButton( code, fallback ) : fallback;

}

export function glyphFor( action, device = currentDevice() ) {

	const a = GLYPH_ACTIONS[ action ] || ( typeof action === 'string' ? { code: action } : null );
	if ( ! a ) return { label: '?', device, kind: 'key', code: null, button: null };
	const family = device === 'keyboard' ? null : ( PAD_NAMES[ device ] ? device : padFamily( device ) );
	if ( family ) {

		if ( a.pad ) return { label: padName( a.pad, family ), device: family, kind: 'pad', code: a.code, button: a.pad };
		if ( Number.isInteger( a.button ) ) {

			const b = a.code ? padButtonOf( a.code, a.button ) : a.button;
			return { label: padName( b, family ), device: family, kind: 'pad', code: a.code, button: b };

		}

	}

	if ( a.label ) return { label: a.label, device: 'keyboard', kind: 'key', code: a.code, button: null };
	const phys = a.code ? physicalKey( a.code ) : null;
	return { label: keyName( phys ), device: 'keyboard', kind: 'key', code: phys, button: null };

}

export function glyph( action, device ) {

	return glyphFor( action, device ).label;

}

const esc = ( s ) => String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ c ] ) );

export function glyphHTML( action, device ) {

	const g = glyphFor( action, device );
	return `<kbd class="glyph glyph-${ esc( g.device ) }" data-glyph="${ esc( action ) }">${ esc( g.label ) }</kbd>`;

}

// re-label every [data-glyph] element under root (they keep their own styling)
export function refreshGlyphs( root ) {

	if ( ! root || typeof root.querySelectorAll !== 'function' ) return 0;
	let n = 0;
	for ( const el of root.querySelectorAll( '[data-glyph]' ) ) {

		const g = glyphFor( el.getAttribute( 'data-glyph' ) );
		if ( el.textContent !== g.label ) el.textContent = g.label;
		el.classList.remove( 'glyph-keyboard', 'glyph-xbox', 'glyph-playstation', 'glyph-gamepad' );
		el.classList.add( 'glyph-' + g.device );
		n ++;

	}

	return n;

}
