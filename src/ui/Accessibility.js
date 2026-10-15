import { t, getLang, setLang, onLang, LANGS, OFFERED } from '../i18n/index.js';

// Accessibility and key remapping.
//
//   const a11y = new Accessibility( { app, ui } );   // AppUI makes it: app.accessibility
//   a11y.buildSettings( ui );                         // the "Controls" and "Access" tabs of the settings panel
//   a11y.subtitle( 'text', 2900, { speaker: 'Captain Roid' } )   // captions (size / background are options)
//   a11y.set( 'uiScale', 1.25 ); a11y.get( 'uiScale' )           // options apply live and are saved
//
// Everything is persisted in localStorage ('alpha-astra.a11y') and applied at once:
//   uiScale          1 = as designed; sets --tw-u (every HUD / panel metric scales with it)
//   subtitles, subtitleSize, subtitleBg   the caption element (a11y.subtitle)
//   highContrast     body.a11y-contrast: solid dark panels, white text and lines
//   colorBlind       'off' | 'redgreen' | 'blueyellow': body.a11y-cb-rg / a11y-cb-by recolour the tension band, the needle,
//                    the call text and the bite mark and add shapes (hatched danger zone, ▲ / ● marks), so the cues never
//                    rely on hue alone. They target GameHUD's .gm-band .gm-danger .gm-needle .gm-fight-call .gm-bite
//   reelMode, sprintMode   'hold' | 'toggle' (core/Input.js latches the sprint key and the left button while a fish is on)
//   guardMode        'hold' | 'toggle': the melee guard on the right button (input.guardToggle, app.settings.guardMode)
//   reduceMotion, cameraShake   app.settings.reduceMotion (steadier cameras, no shakes) and app.settings.cameraShake 0..1
//   sensitivity, invertY   mouse look (core/Input.js)
//   fishingAssist    OFF by default: line tension changes more slowly during the fight (catchMinigame rate x0.6). The game
//                    counts assisted fights in state.career.assisted so the save shows it.
// Key bindings are stored by action id ({ interact: 'KeyG' }); core/Input.js turns them into a physical -> logical table
// so callers keep asking for input.hit( 'KeyE' ). Gamepad button bindings are stored the same way (pad) and read by
// core/Gamepad.js through input.padButton( code, defaultIndex ).
// Wave 5: Ctrl is no game key any more (the dive lost its Ctrl alias: Ctrl+W closed the tab). The quick save answers
// Ctrl+S (input.onShortcut -> a11y.quickSave(): app.saveNow(), a universe sends its snapshot at once, a short toast),
// and the Controls tab has a Fullscreen button (input.toggleFullscreen: F11 does the same; fullscreen locks the keyboard
// so Ctrl+W / Ctrl+T reach the game).

export const STORAGE_KEY = 'alpha-astra.a11y';
export const ASSIST_RATE = 0.6; // tension rate multiplier while the fishing assist is on

// ---- the actions (the logical code is what callers pass to input.hit / down; `also` are aliases that follow it)
// Features register their own with registerAction() or through Features.claimKey (noteKey).
export const GROUPS = [
	{ id: 'move', name: 'Movement' },
	{ id: 'act', name: 'Actions' },
	{ id: 'ui', name: 'Windows' },
	{ id: 'sea', name: 'Ships and combat' },
	{ id: 'world', name: 'World' },
	{ id: 'more', name: 'Other' },
];

export const ACTIONS = [
	{ id: 'forward', code: 'KeyW', group: 'move', name: 'Move forward' },
	{ id: 'back', code: 'KeyS', group: 'move', name: 'Move back' },
	{ id: 'left', code: 'KeyA', group: 'move', name: 'Move left, steer left' },
	{ id: 'right', code: 'KeyD', group: 'move', name: 'Move right, steer right' },
	{ id: 'jump', code: 'Space', group: 'move', name: 'Jump, swim up' },
	{ id: 'dive', code: 'KeyC', group: 'move', name: 'Crouch, dive', tip: 'Seaplane: throttle down' },
	{ id: 'sprint', code: 'ShiftLeft', also: [ 'ShiftRight' ], group: 'move', name: 'Sprint, boat boost', tip: 'Seaplane: throttle up' },
	{ id: 'walk', code: 'CapsLock', group: 'move', name: 'Walk instead of jog' },
	{ id: 'interact', code: 'KeyE', group: 'act', name: 'Interact', tip: 'Board, helm, step ashore, talk, trade' },
	{ id: 'view', code: 'KeyV', group: 'act', name: 'Camera view', tip: 'First or third person' },
	{ id: 'rod', code: 'KeyR', group: 'act', name: 'Fishing rod', tip: 'Take it out or put it away' },
	{ id: 'light', code: 'KeyL', group: 'act', name: 'Flashlight' },
	{ id: 'emote', code: 'Digit5', group: 'act', name: 'Emotes', tip: '1-4: wave, dance, point, cheer' },
	{ id: 'mute', code: 'KeyM', group: 'act', name: 'Mute sound' },
	{ id: 'cooler', code: 'KeyI', group: 'ui', name: 'Cooler and fish log' },
	{ id: 'crew', code: 'KeyK', group: 'ui', name: 'Crew' },
	{ id: 'journal', code: 'KeyJ', group: 'ui', name: 'Journal', tip: 'Active notices and bounties' },
	{ id: 'portGuns', code: 'KeyZ', group: 'sea', name: 'Fire port guns', tip: 'Needs the swivel gun from Captain Roid' },
	{ id: 'starboardGuns', code: 'KeyX', group: 'sea', name: 'Fire starboard guns' },
	{ id: 'evade', code: 'KeyQ', group: 'sea', name: 'Evade (dodge)', tip: 'On foot, in a fight' },
	{ id: 'board', code: 'KeyB', group: 'sea', name: 'Board or retreat', tip: 'When a ship is alongside' },
	{ id: 'rudderLeft', code: 'Comma', group: 'sea', name: 'Seaplane rudder left' },
	{ id: 'rudderRight', code: 'Period', group: 'sea', name: 'Seaplane rudder right' },
	{ id: 'freecam', code: 'KeyF', group: 'world', name: 'Free camera', sandbox: true },
	{ id: 'time', code: 'KeyT', group: 'world', name: 'Pause time', sandbox: true },
];

// keys the game or the page keeps for itself: they cannot be assigned (the UI and the menus read these raw)
// Ctrl is not a game key (wave 5: Ctrl + a letter is a browser shortcut; Ctrl+W closes the tab), so it cannot be assigned
export const RESERVED = new Set( [ 'Escape', 'F1', 'F3', 'F5', 'F11', 'F12', 'KeyH', 'KeyP', 'Enter', 'NumpadEnter', 'Tab', 'ContextMenu', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'PrintScreen' ] );

// gamepad buttons (standard mapping) and the actions Gamepad.js reads from them
export const PAD_ACTIONS = [
	{ id: 'jump', code: 'Space', button: 0 },
	{ id: 'dive', code: 'KeyC', button: 1 },
	{ id: 'interact', code: 'KeyE', button: 2 },
	{ id: 'rod', code: 'KeyR', button: 3 },
	{ id: 'view', code: 'KeyV', button: 4 },
	{ id: 'sprint', code: 'ShiftLeft', button: 5 },
	{ id: 'cooler', code: 'KeyI', button: 12 },
	{ id: 'crew', code: 'KeyK', button: 13 },
];
// the triggers are the mouse buttons, Back / Start are the controls sheet and settings
export const PAD_RESERVED = new Set( [ 6, 7, 8, 9 ] );
export const PAD_BUTTONS = [ 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home' ];

// ---- the options

export const DEFAULTS = Object.freeze( {
	uiScale: 1,
	subtitles: true,
	subtitleSize: 'medium',
	subtitleBg: 'shade',
	highContrast: false,
	colorBlind: 'off',
	reelMode: 'hold',
	sprintMode: 'hold',
	guardMode: 'hold',
	reduceMotion: false,
	cameraShake: 1,
	sensitivity: 1,
	invertY: false,
	fishingAssist: false,
} );

const SCHEMA = {
	uiScale: { min: 0.8, max: 1.6 },
	subtitles: { bool: true },
	subtitleSize: { values: [ 'small', 'medium', 'large', 'huge' ] },
	subtitleBg: { values: [ 'none', 'shade', 'solid' ] },
	highContrast: { bool: true },
	colorBlind: { values: [ 'off', 'redgreen', 'blueyellow' ] },
	reelMode: { values: [ 'hold', 'toggle' ] },
	sprintMode: { values: [ 'hold', 'toggle' ] },
	guardMode: { values: [ 'hold', 'toggle' ] },
	reduceMotion: { bool: true },
	cameraShake: { min: 0, max: 1 },
	sensitivity: { min: 0.2, max: 3 },
	invertY: { bool: true },
	fishingAssist: { bool: true },
};

const SUB_SCALE = { small: 0.85, medium: 1.1, large: 1.45, huge: 1.9 };

// a value of the right kind and range for an option, or the default
export function coerce( key, v ) {

	const s = SCHEMA[ key ];
	if ( ! s ) return undefined;
	if ( s.bool ) return typeof v === 'boolean' ? v : DEFAULTS[ key ];
	if ( s.values ) return s.values.includes( v ) ? v : DEFAULTS[ key ];
	const n = Number( v );
	return Number.isFinite( n ) ? Math.min( s.max, Math.max( s.min, n ) ) : DEFAULTS[ key ];

}

// ---- key names

let layoutMap = null; // the browser's KeyboardLayoutMap (code -> printed key) when it has one: AZERTY shows Z for KeyW

export function loadLayout() {

	try {

		const kb = typeof navigator !== 'undefined' ? navigator.keyboard : null;
		if ( kb && kb.getLayoutMap ) kb.getLayoutMap().then( ( m ) => { layoutMap = m; } ).catch( () => {} );

	} catch ( e ) { /* the printed letters are the QWERTY ones */ }

}

const KEY_NAMES = {
	Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'Right Alt',
	CapsLock: 'Caps Lock', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page up', PageDown: 'Page down',
	ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc',
	Comma: ',', Period: '.',
};

// the text for a physical key code
export function keyLabel( code, map = layoutMap ) {

	if ( ! code ) return t( 'key.none', 'Unbound' );
	if ( KEY_NAMES[ code ] ) return t( `key.${ code }`, KEY_NAMES[ code ] );
	let m = /^Key([A-Z])$/.exec( code );
	if ( m ) return ( ( map && map.get && map.get( code ) ) || m[ 1 ] ).toUpperCase();
	m = /^Digit(\d)$/.exec( code );
	if ( m ) return ( map && map.get && map.get( code ) ) || m[ 1 ];
	m = /^Numpad(\d)$/.exec( code );
	if ( m ) return `Num ${ m[ 1 ] }`;
	const printed = map && map.get ? map.get( code ) : null;
	return printed ? String( printed ).toUpperCase() : code;

}

// the layout-independent default name of a code ( 'KeyE' -> 'E' ): what the static help text and the prompts print
function defaultName( code ) {

	const m = /^Key([A-Z])$/.exec( code );
	if ( m ) return m[ 1 ];
	return KEY_NAMES[ code ] || code;

}

export function padLabel( i ) {

	return PAD_BUTTONS[ i ] || `Button ${ i }`;

}

// ---- the model

export class Accessibility {

	constructor( { app = null, ui = null, input = app && app.input, storage, doc = typeof document !== 'undefined' ? document : null } = {} ) {

		this.app = app;
		this.ui = ui;
		this.input = input || null;
		this.doc = doc;
		this.storage = storage !== undefined ? storage : safeStorage();
		this.actions = ACTIONS.map( ( a ) => ( { ...a } ) );
		this.o = { ...DEFAULTS };
		this.bindings = {}; // action id -> physical code ('' = unbound); only the ones that differ from the default
		this.pad = {}; // action id -> button index
		this._listeners = new Set();
		this._listen = null; // { id, kind: 'key' | 'pad', pending }
		this._rows = new Map(); // action id -> { key, row, note }
		this._padRows = new Map();
		this._kbds = [];
		this._subs = null;
		this._saveT = 0;
		this.load();
		injectCss( doc );
		this._pushBindings();
		this._pushPad();
		this.applyAll();
		this._wireShortcuts();
		loadLayout();
		if ( doc && doc.defaultView ) this._hook( doc.defaultView );
		// a language change relabels the key buttons (the printed names of keys are translated) and tells the listeners
		this._offLang = onLang( () => {

			this._refreshRows();
			this._refreshKbds();
			this._emit( 'lang' );

		} );

	}

	// ---- persistence

	load() {

		let d = null;
		try {

			const raw = this.storage ? this.storage.getItem( STORAGE_KEY ) : null;
			d = raw ? JSON.parse( raw ) : null;

		} catch ( e ) { d = null; }

		if ( ! d || typeof d !== 'object' ) return false;
		for ( const k of Object.keys( DEFAULTS ) ) if ( k in d ) this.o[ k ] = coerce( k, d[ k ] );
		this.bindings = {};
		if ( d.bindings && typeof d.bindings === 'object' ) {

			for ( const [ id, code ] of Object.entries( d.bindings ) ) if ( typeof code === 'string' && ! RESERVED.has( code ) ) this.bindings[ id ] = code;

		}

		this.pad = {};
		if ( d.pad && typeof d.pad === 'object' ) {

			for ( const [ id, b ] of Object.entries( d.pad ) ) if ( Number.isInteger( b ) && b >= 0 && b < 32 && ! PAD_RESERVED.has( b ) ) this.pad[ id ] = b;

		}

		return true;

	}

	save() {

		clearTimeout( this._saveT );
		this._saveT = 0;
		try {

			if ( this.storage ) this.storage.setItem( STORAGE_KEY, JSON.stringify( { ...this.o, bindings: this.bindings, pad: this.pad } ) );
			return true;

		} catch ( e ) {

			return false;

		}

	}

	// sliders fire many times a second: write once they settle
	_saveSoon() {

		clearTimeout( this._saveT );
		this._saveT = setTimeout( () => this.save(), 250 );
		if ( this._saveT && this._saveT.unref ) this._saveT.unref();

	}

	onChange( fn ) {

		this._listeners.add( fn );
		return () => this._listeners.delete( fn );

	}

	_emit( what ) {

		for ( const fn of [ ...this._listeners ] ) {

			try { fn( what, this ); } catch ( e ) { console.warn( 'accessibility listener failed', e ); }

		}

	}

	// ---- options

	get( key ) {

		return this.o[ key ];

	}

	set( key, value ) {

		if ( ! ( key in DEFAULTS ) ) return false;
		this.o[ key ] = coerce( key, value );
		this._apply( key );
		this._saveSoon();
		this._emit( key );
		return true;

	}

	// back to the defaults (not the key bindings)
	resetOptions() {

		Object.assign( this.o, DEFAULTS );
		this.applyAll();
		this.save();
		this._emit( '*' );

	}

	get fishingAssist() {

		return !! this.o.fishingAssist;

	}

	// what CatchMinigame multiplies its tension rate by (1 = no assist)
	tensionRate() {

		return this.o.fishingAssist ? ASSIST_RATE : 1;

	}

	applyAll() {

		for ( const k of Object.keys( DEFAULTS ) ) this._apply( k );

	}

	_apply( key ) {

		const o = this.o, input = this.input, app = this.app, doc = this.doc;
		const body = doc && doc.body, root = doc && doc.documentElement;
		switch ( key ) {

			case 'uiScale':
				// --tw-u is clamp( 1px, .. 1.25px ) of the viewport: keep that and scale it
				if ( ! root ) break;
				if ( o.uiScale === 1 ) root.style.removeProperty( '--tw-u' );
				else root.style.setProperty( '--tw-u', `calc( clamp( 1px, calc( 0.7px + 0.04vmin ), 1.25px ) * ${ o.uiScale } )` );
				break;
			case 'highContrast':
				if ( body ) body.classList.toggle( 'a11y-contrast', o.highContrast );
				break;
			case 'colorBlind':
				if ( body ) {

					body.classList.toggle( 'a11y-cb-rg', o.colorBlind === 'redgreen' );
					body.classList.toggle( 'a11y-cb-by', o.colorBlind === 'blueyellow' );

				}

				break;
			case 'subtitleSize':
				if ( root ) root.style.setProperty( '--a11y-sub-scale', String( SUB_SCALE[ o.subtitleSize ] ) );
				break;
			case 'subtitleBg':
				if ( body ) for ( const v of SCHEMA.subtitleBg.values ) body.classList.toggle( `a11y-sub-bg-${ v }`, o.subtitleBg === v );
				break;
			case 'sensitivity':
				if ( input ) input.sensitivity = o.sensitivity;
				break;
			case 'invertY':
				if ( input ) input.invertY = o.invertY;
				break;
			case 'reelMode':
				if ( input ) {

					input.reelToggle = o.reelMode === 'toggle';
					input.reelActive = () => !! ( app && app.game && app.game.fight );

				}

				break;
			case 'sprintMode':
				if ( input ) input.setToggle( [ 'ShiftLeft', 'ShiftRight' ], o.sprintMode === 'toggle' );
				break;
			case 'guardMode':
				if ( input ) input.guardToggle = o.guardMode === 'toggle';
				if ( app && app.settings ) app.settings.guardMode = o.guardMode;
				break;
			case 'reduceMotion':
				if ( app && app.settings ) app.settings.reduceMotion = o.reduceMotion;
				if ( app && app.player ) app.player.reduceMotion = o.reduceMotion;
				break;
			case 'cameraShake':
				if ( app && app.settings ) app.settings.cameraShake = o.cameraShake;
				break;
			case 'fishingAssist':
				if ( app && app.settings ) app.settings.fishingAssist = o.fishingAssist;
				break;
			default:

		}

	}

	// ---- browser shortcuts the game answers (core/Input.js reports them)

	_wireShortcuts() {

		const input = this.input;
		if ( ! input || input.onShortcut ) return;
		input.onShortcut = ( name ) => {

			if ( name === 'save' ) this.quickSave();

		};

	}

	// Ctrl+S: write the slot now (the pause menu's Save game); a universe session sends its snapshot at once.
	// Nothing while the main menu is up or no game is loaded. Returns true when the browser took it.
	quickSave() {

		const app = this.app;
		if ( ! app || ! app.game || typeof app.saveNow !== 'function' || app.menuOpen || app.session === false ) return false;
		let ok = false;
		try { ok = !! app.saveNow(); } catch ( e ) { ok = false; }
		const u = app.universe;
		if ( ok && u && typeof u.flush === 'function' ) try { u.flush( true ); } catch ( e ) { /* it sends on its own tick */ }
		const ui = this.ui;
		if ( ui && typeof ui.toast === 'function' ) ui.toast( ok ? t( 'ctl.quicksave.done', 'Game saved' ) : t( 'pause.save_failed', 'Could not save' ), 1400 );
		return ok;

	}

	// ---- actions and key bindings

	action( id ) {

		return this.actions.find( ( a ) => a.id === id ) || null;

	}

	// a feature's own key: { id, code, name, group = 'more', also, tip }
	registerAction( def ) {

		if ( ! def || ! def.id || ! def.code || this.action( def.id ) ) return false;
		this.actions.push( { group: 'more', name: def.id, ...def } );
		this._pushBindings();
		this._buildKeys();
		this._refreshKbds();
		return true;

	}

	// Features.claimKey( code, owner ) reports here: a key nobody listed gets a row named after its feature
	noteKey( code, owner ) {

		if ( this.actions.some( ( a ) => a.code === code || ( a.also && a.also.includes( code ) ) ) ) return false;
		const name = FEATURE_NAMES[ owner ] || `${ owner[ 0 ].toUpperCase() }${ owner.slice( 1 ) }`;
		return this.registerAction( { id: `feature.${ owner }.${ code }`, code, group: 'more', name: `${ name } key` } );

	}

	// the physical key an action answers to now ('' = none)
	binding( id ) {

		const a = this.action( id );
		if ( ! a ) return '';
		return id in this.bindings ? this.bindings[ id ] : a.code;

	}

	// every physical key that triggers the action (the aliases only while it has not been rebound)
	keysOf( id ) {

		const a = this.action( id );
		if ( ! a ) return [];
		if ( id in this.bindings ) return this.bindings[ id ] ? [ this.bindings[ id ] ] : [];
		return [ a.code, ...( a.also || [] ) ];

	}

	isChanged( id ) {

		return id in this.bindings;

	}

	// the text on a key button: the primary key, plus the aliases it still has ( 'C / Ctrl' )
	label( id ) {

		const keys = this.keysOf( id );
		if ( ! keys.length ) return keyLabel( '' );
		const out = [];
		for ( const k of keys ) {

			const l = keyLabel( k );
			if ( ! out.includes( l ) ) out.push( l );

		}

		return out.join( ' / ' );

	}

	// who else answers to this physical key: [ action id ]
	usedBy( code, exceptId = null ) {

		const out = [];
		for ( const a of this.actions ) if ( a.id !== exceptId && this.keysOf( a.id ).includes( code ) ) out.push( a.id );
		return out;

	}

	// physical key -> [ action ids ] for every key that two or more actions share
	conflicts() {

		const seen = new Map();
		for ( const a of this.actions ) for ( const k of this.keysOf( a.id ) ) {

			if ( ! seen.has( k ) ) seen.set( k, [] );
			seen.get( k ).push( a.id );

		}

		for ( const [ k, ids ] of seen ) if ( ids.length < 2 ) seen.delete( k );
		return seen;

	}

	// Put an action on a physical key. Returns { ok: true, swapped? } | { ok: false, reason: 'reserved' | 'unknown' }
	// | { ok: false, conflict: id } when another action has the key (call again with { swap: true } to trade keys).
	rebind( id, code, { swap = false } = {} ) {

		const a = this.action( id );
		if ( ! a ) return { ok: false, reason: 'unknown' };
		if ( code && RESERVED.has( code ) ) return { ok: false, reason: 'reserved' };
		if ( ( code || '' ) === this.binding( id ) && this.keysOf( id ).length === 1 ) return { ok: true, same: true };
		const out = { ok: true };
		if ( code ) {

			const others = this.usedBy( code, id );
			if ( others.length && ! swap ) return { ok: false, conflict: others[ 0 ] };
			// a swap: whoever had the key gets the one this action is leaving
			if ( others.length ) {

				const mine = this.binding( id );
				for ( const other of others ) this._setBinding( other, mine );
				out.swapped = others;

			}

		}

		this._setBinding( id, code );
		this._changed();
		return out;

	}

	unbind( id ) {

		if ( ! this.action( id ) ) return false;
		this._setBinding( id, '' );
		this._changed();
		return true;

	}

	// a binding equal to the default is no binding at all (the aliases come back)
	_setBinding( id, code ) {

		const a = this.action( id );
		if ( ! a ) return;
		if ( code === a.code ) delete this.bindings[ id ];
		else this.bindings[ id ] = code || '';

	}

	resetAction( id ) {

		if ( ! ( id in this.bindings ) ) return false;
		delete this.bindings[ id ];
		this._changed();
		return true;

	}

	resetBindings() {

		this.bindings = {};
		this._changed();

	}

	// the logical -> physical table core/Input.js reads
	bindingTable() {

		const map = {};
		for ( const a of this.actions ) {

			if ( ! ( a.id in this.bindings ) ) continue;
			for ( const c of [ a.code, ...( a.also || [] ) ] ) map[ c ] = this.bindings[ a.id ] || null;

		}

		return map;

	}

	_pushBindings() {

		if ( this.input && this.input.setBindings ) this.input.setBindings( this.bindingTable() );

	}

	_changed() {

		this._pushBindings();
		this.save();
		this._refreshRows();
		this._refreshKbds();
		this._emit( 'bindings' );

	}

	// ---- gamepad buttons

	padButton( id ) {

		const a = PAD_ACTIONS.find( ( p ) => p.id === id );
		if ( ! a ) return -1;
		return id in this.pad ? this.pad[ id ] : a.button;

	}

	padTable() {

		const map = {};
		for ( const p of PAD_ACTIONS ) if ( p.id in this.pad ) map[ p.code ] = this.pad[ p.id ];
		return map;

	}

	_pushPad() {

		if ( this.input && this.input.setPadBindings ) this.input.setPadBindings( this.padTable() );

	}

	// { ok } | { ok: false, reason: 'reserved' } | { ok: false, conflict: id } (then swap: true)
	rebindPad( id, button, { swap = false } = {} ) {

		const p = PAD_ACTIONS.find( ( x ) => x.id === id );
		if ( ! p ) return { ok: false, reason: 'unknown' };
		if ( PAD_RESERVED.has( button ) ) return { ok: false, reason: 'reserved' };
		const mine = this.padButton( id );
		if ( button === mine ) return { ok: true, same: true };
		const other = PAD_ACTIONS.find( ( x ) => x.id !== id && this.padButton( x.id ) === button );
		if ( other && ! swap ) return { ok: false, conflict: other.id };
		if ( other ) this._setPad( other.id, mine );
		this._setPad( id, button );
		this._padChanged();
		return { ok: true, swapped: other ? [ other.id ] : undefined };

	}

	_setPad( id, button ) {

		const p = PAD_ACTIONS.find( ( x ) => x.id === id );
		if ( button === p.button ) delete this.pad[ id ];
		else this.pad[ id ] = button;

	}

	resetPad() {

		this.pad = {};
		this._padChanged();

	}

	_padChanged() {

		this._pushPad();
		this.save();
		this._refreshRows();
		this._emit( 'pad' );

	}

	// ---- what the HUD prints

	// the key hint for a prompt ('E' -> the key Interact is on now); keys it does not know pass through
	keyHint( key ) {

		for ( const a of this.actions ) {

			if ( defaultName( a.code ) !== key ) continue;
			const keys = this.keysOf( a.id );
			return keys.length ? keyLabel( keys[ 0 ] ) : key;

		}

		return key;

	}

	// A prompt ( { key, text } ) as it should be shown: its keys follow the bindings, the reel hint follows the reel mode,
	// the text is in the current language. Prompts embed keys like "·   R  put the rod away".
	prompt( p, translate = ( s ) => s ) {

		let text = p.text;
		if ( this.o.reelMode === 'toggle' && p.key === 'LMB' && /^Hold to reel/.test( text ) ) text = 'Click to reel · click again to ease off · let go when the tension goes red';
		const talk = /^Talk to (.+)$/.exec( text );
		text = talk ? t( 'prompt.talk', 'Talk to {name}', { name: talk[ 1 ] } ) : translate( text );
		text = text.replace( /(·\s+)([A-Z])(\s{2})/g, ( m, a, k, b ) => `${ a }${ this.keyHint( k ) }${ b }` );
		return { key: this.keyHint( p.key ), text };

	}

	// the static key caps of the controls sheet and the start screen follow the bindings too
	bindHelp( ...roots ) {

		this._kbds = [];
		const byName = new Map();
		for ( const a of this.actions ) byName.set( defaultName( a.code ), a.id );
		for ( const root of roots ) {

			if ( ! root || ! root.querySelectorAll ) continue;
			for ( const k of root.querySelectorAll( 'kbd' ) ) {

				const id = byName.get( k.textContent.trim() );
				if ( id ) {

					k.dataset.action = id;
					this._kbds.push( k );

				}

			}

		}

		this._refreshKbds();

	}

	_refreshKbds() {

		for ( const k of this._kbds ) {

			const keys = this.keysOf( k.dataset.action );
			k.textContent = keys.length ? keyLabel( keys[ 0 ] ) : keyLabel( '' );

		}

	}

	// ---- captions

	_host() {

		if ( this._subs && this._subs.isConnected ) return this._subs;
		const doc = this.doc;
		const el = this._subs = doc.createElement( 'div' );
		el.className = 'a11y-subs';
		el.setAttribute( 'aria-live', 'polite' );
		( this.ui && this.ui.root ? this.ui.root : doc.body ).append( el );
		return el;

	}

	// a caption line: `speaker` and a sound `cue` ('*click click*') lead the text; false when captions are off
	subtitle( text, ms = 3000, { speaker = '', cue = '' } = {} ) {

		if ( ! this.o.subtitles || ! this.doc || ! text ) return false;
		const doc = this.doc;
		const host = this._host();
		const line = doc.createElement( 'div' );
		line.className = 'a11y-sub';
		if ( speaker ) {

			const b = doc.createElement( 'b' );
			b.textContent = speaker;
			line.append( b );

		}

		if ( cue ) {

			const i = doc.createElement( 'i' );
			i.textContent = cue;
			line.append( i );

		}

		line.append( doc.createTextNode( text ) );
		host.append( line );
		while ( host.children.length > 3 ) host.firstElementChild.remove();
		requestAnimationFrame( () => line.classList.add( 'is-in' ) );
		setTimeout( () => {

			line.classList.add( 'is-out' );
			setTimeout( () => line.remove(), 260 );

		}, ms );
		return true;

	}

	// ---- listening for a key / a pad button (the Controls tab)

	_hook( win ) {

		// ahead of every other key handler (the pause menu's Escape included): while we listen the key is ours
		this._onKey = ( e ) => {

			if ( ! this._listen || this._listen.kind !== 'key' ) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if ( e.repeat ) return;
			this._heard( e.code );

		};
		this._onKeyUp = ( e ) => {

			// the button that started the listening also reacts to Space / Enter on key up: eat it
			if ( this._eatUp && this._eatUp === e.code ) {

				e.preventDefault();
				e.stopImmediatePropagation();
				this._eatUp = null;

			}

		};
		this._onDown = ( e ) => {

			if ( this._listen && ! ( e.target && e.target.closest && e.target.closest( '.a11y-key' ) ) ) this.cancelListen();

		};
		win.addEventListener( 'keydown', this._onKey, { capture: true } );
		win.addEventListener( 'keyup', this._onKeyUp, { capture: true } );
		win.addEventListener( 'pointerdown', this._onDown, { capture: true } );

	}

	listen( id, kind = 'key' ) {

		this.cancelListen();
		this._listen = { id, kind, pending: null };
		this._note( id, '', false, kind );
		this._refreshRows();
		if ( kind === 'pad' ) this._pollPad();

	}

	cancelListen() {

		if ( ! this._listen ) return;
		const { id, kind } = this._listen;
		this._listen = null;
		this._stopPoll();
		this._note( id, '', false, kind );
		this._refreshRows();

	}

	_stopPoll() {

		if ( this._padRaf && typeof cancelAnimationFrame === 'function' ) cancelAnimationFrame( this._padRaf );
		this._padRaf = 0;

	}

	// a key (code) or pad button (number) arrived while listening
	_heard( input ) {

		const L = this._listen;
		if ( ! L ) return;
		const pad = L.kind === 'pad';
		if ( ! pad ) this._eatUp = input;
		if ( ! pad && input === 'Escape' ) return this.cancelListen();
		if ( ! pad && ( input === 'Backspace' || input === 'Delete' ) ) {

			this.cancelListen();
			this.unbind( L.id );
			return;

		}

		const same = L.pending === input;
		const r = pad ? this.rebindPad( L.id, input, { swap: same } ) : this.rebind( L.id, input, { swap: same } );
		if ( r.ok ) {

			const id = L.id;
			this._listen = null;
			this._stopPoll();
			this._note( id, r.swapped ? t( 'ctl.swapped', 'Swapped with {name}', { name: this.nameOf( r.swapped[ 0 ] ) } ) : '', false, L.kind );
			this._refreshRows();
			return;

		}

		if ( r.conflict ) {

			L.pending = input;
			const key = pad ? padLabel( input ) : keyLabel( input );
			this._note( L.id, t( 'ctl.conflict', '{key} is already used by {name}. Press it again to swap, or choose another.', { key, name: this.nameOf( r.conflict ) } ), true, L.kind );

		} else if ( r.reason === 'reserved' ) {

			L.pending = null;
			this._note( L.id, t( 'ctl.reserved', 'That key is reserved for the menus. Choose another.' ), true, L.kind );

		}

	}

	_pollPad() {

		const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
		const p = [ ...pads ].find( ( x ) => x && x.connected );
		const L = this._listen;
		if ( ! L || L.kind !== 'pad' ) return;
		if ( p ) {

			// only a press that starts after listening began counts
			if ( ! L.down ) L.down = p.buttons.map( ( b ) => !! b.pressed );
			for ( let i = 0; i < p.buttons.length; i ++ ) {

				const now = !! p.buttons[ i ].pressed;
				const fresh = now && ! L.down[ i ];
				L.down[ i ] = now;
				if ( fresh ) {

					this._heard( i );
					break;

				}

			}

		}

		// still listening (nothing pressed, or the press was refused / needs a second press)
		if ( this._listen === L ) this._padRaf = requestAnimationFrame( () => this._pollPad() );

	}

	nameOf( id ) {

		const a = this.action( id );
		return a ? t( `act.${ a.id }`, a.name ) : id;

	}

	// ---- the settings tabs

	buildSettings( ui ) {

		this.ui = ui;
		injectCss( this.doc );
		this._kbTab = ui.addTab( 'controls', t( 'tab.controls', 'Controls' ), 'keyboard' );
		this._buildControls( this._kbTab );
		this._acTab = ui.addTab( 'access', t( 'tab.access', 'Access' ), 'eye' );
		this._buildAccess( this._acTab );
		this._refreshRows();
		return this;

	}

	_buildControls( tab ) {

		const hint = tab.addInfo( { label: t( 'ctl.hint', 'Click a key, then press the new one' ), get: () => '', tooltip: t( 'ctl.hint.tip', 'Esc cancels. Delete clears the key. Right-click a key to put it back. A key another action uses asks before swapping.' ) } );
		hint.el.classList.add( 'a11y-hint' );
		this._keyFolders = new Map();
		this._keysAt = tab;
		this._buildKeys();
		tab.addButton( { label: t( 'ctl.reset', 'Reset keys to defaults' ), icon: 'reset', tooltip: t( 'ctl.reset.tip', 'Every action goes back to its original key.' ), onClick: () => {

			this.cancelListen();
			this.resetBindings();
			this.ui.toast( t( 'ctl.reset.done', 'Keys reset' ), 1600 );

		} } );

		const pad = tab.addFolder( t( 'ctl.pad', 'Gamepad' ), { icon: 'gauge', open: false } );
		pad.addInfo( { label: t( 'ctl.pad.status', 'Gamepad' ), get: () => ( this.app && this.app.gamepad && this.app.gamepad.connected ? t( 'ctl.pad.on', 'Connected' ) : t( 'ctl.pad.off', 'Not detected' ) ) } );
		for ( const p of PAD_ACTIONS ) this._padRow( pad, p );
		pad.addInfo( { label: t( 'ctl.pad.fixed', 'Fixed' ), get: () => t( 'ctl.pad.fixed.v', 'Sticks move and look · LT / RT: right / left click · Start: settings · Back: controls' ), tooltip: t( 'ctl.pad.fixed.tip', 'These keep their place so the pad can always open the menus.' ) } );
		pad.addButton( { label: t( 'ctl.pad.reset', 'Reset gamepad buttons' ), icon: 'reset', onClick: () => {

			this.cancelListen();
			this.resetPad();
			this.ui.toast( t( 'ctl.reset.done', 'Keys reset' ), 1600 );

		} } );

		const look = tab.addFolder( t( 'ctl.look', 'Mouse and look' ), { icon: 'mouse' } );
		look.addSlider( { label: t( 'ctl.sens', 'Mouse sensitivity' ), object: this.o, key: 'sensitivity', min: 0.2, max: 3, step: 0.05, log: true, unit: '×', tooltip: t( 'ctl.sens.tip', 'How far the view turns for each mouse movement.' ), onChange: ( v ) => this.set( 'sensitivity', v ) } );
		look.addToggle( { label: t( 'ctl.invert', 'Invert vertical look' ), object: this.o, key: 'invertY', onChange: ( v ) => this.set( 'invertY', v ) } );
		look.addSelect( { label: t( 'ctl.reel', 'Reeling' ), object: this.o, key: 'reelMode', options: [ { label: t( 'opt.hold', 'Hold' ), value: 'hold' }, { label: t( 'opt.toggle', 'Toggle' ), value: 'toggle' } ], tooltip: t( 'ctl.reel.tip', 'Hold: reel while the left button is down. Toggle: click to start reeling, click again to stop.' ), onChange: ( v ) => this.set( 'reelMode', v ) } );
		look.addSelect( { label: t( 'ctl.sprint', 'Sprint' ), object: this.o, key: 'sprintMode', options: [ { label: t( 'opt.hold', 'Hold' ), value: 'hold' }, { label: t( 'opt.toggle', 'Toggle' ), value: 'toggle' } ], tooltip: t( 'ctl.sprint.tip', 'Hold: sprint while the key is down. Toggle: press once to start, again to stop; it also stops when you stop moving.' ), onChange: ( v ) => this.set( 'sprintMode', v ) } );
		look.addSelect( { label: t( 'ctl.guard', 'Guard' ), object: this.o, key: 'guardMode', options: [ { label: t( 'opt.hold', 'Hold' ), value: 'hold' }, { label: t( 'opt.toggle', 'Toggle' ), value: 'toggle' } ], tooltip: t( 'ctl.guard.tip', 'The right button in a fight. Hold: the guard is up while the button is down. Toggle: click to raise it, click again to lower it. It drops by itself when the fight ends.' ), onChange: ( v ) => this.set( 'guardMode', v ) } );
		look.addInfo( { label: t( 'ctl.lmb', 'Left button' ), get: () => t( 'ctl.lmb.v', 'Cast, strike, reel' ) } );
		look.addInfo( { label: t( 'ctl.rmb', 'Right button' ), get: () => t( 'ctl.rmb.v', 'Reel in an empty line, guard' ) } );
		look.addInfo( { label: t( 'ctl.wheel', 'Wheel' ), get: () => t( 'ctl.wheel.v', 'Camera distance' ) } );

		// the window: fullscreen keeps the Ctrl shortcuts in the game (the keyboard lock), Ctrl+S saves
		const win = tab.addFolder( t( 'ctl.window', 'Window' ), { icon: 'monitor' } );
		win.addButton( { label: t( 'ctl.fullscreen', 'Fullscreen (F11)' ), icon: 'monitor', tooltip: t( 'ctl.fullscreen.tip', 'Fills the screen. While it is fullscreen, Ctrl+W, Ctrl+T and the other browser shortcuts stay in the game.' ), onClick: () => {

			const input = this.input;
			if ( input && typeof input.toggleFullscreen === 'function' ) input.toggleFullscreen();

		} } );
		win.addInfo( { label: t( 'ctl.quicksave', 'Quick save' ), get: () => t( 'ctl.quicksave.v', 'Ctrl+S' ) } );

	}

	// the keyboard folders (rebuilt when a feature registers a key)
	_buildKeys() {

		if ( ! this._keysAt || ! this.ui ) return;
		const tab = this._keysAt;
		for ( const g of GROUPS ) {

			const list = this.actions.filter( ( a ) => a.group === g.id );
			if ( ! list.length ) continue;
			let f = this._keyFolders.get( g.id );
			if ( ! f ) {

				f = tab.addFolder( t( `grp.${ g.id }`, g.name ), { icon: 'keyboard', open: g.id === 'move' || g.id === 'act' } );
				this._keyFolders.set( g.id, f );
				// folders go above the reset button
				const reset = tab.page.querySelector( ':scope > .tw-ctl-button' );
				if ( reset ) tab.page.insertBefore( f.el, reset );

			}

			for ( const a of list ) if ( ! this._rows.has( a.id ) ) this._keyRow( f, a );

		}

	}

	_row( folder, id, name, tip, onClick, onReset ) {

		const doc = this.doc;
		const row = doc.createElement( 'div' );
		row.className = 'a11y-row';
		const label = doc.createElement( 'span' );
		label.className = 'a11y-name';
		label.textContent = name;
		if ( tip ) label.dataset.tip = tip;
		const key = doc.createElement( 'button' );
		key.type = 'button';
		key.className = 'a11y-key';
		key.addEventListener( 'click', onClick );
		key.addEventListener( 'contextmenu', ( e ) => {

			e.preventDefault();
			onReset();

		} );
		const note = doc.createElement( 'div' );
		note.className = 'a11y-note';
		note.hidden = true;
		row.append( label, key, note );
		folder.body.append( row );
		return { row, key, note, label };

	}

	_keyRow( folder, a ) {

		const name = t( `act.${ a.id }`, a.name );
		const tip = a.tip ? t( `act.${ a.id }.tip`, a.tip ) : a.sandbox ? t( 'ctl.sandbox', 'Sandbox only' ) : '';
		const r = this._row( folder, a.id, name, tip, () => this.listen( a.id ), () => this.resetAction( a.id ) );
		this._rows.set( a.id, r );

	}

	_padRow( folder, p ) {

		const full = this.action( p.id );
		const r = this._row( folder, p.id, full ? t( `act.${ full.id }`, full.name ) : p.id, '', () => this.listen( p.id, 'pad' ), () => {

			if ( p.id in this.pad ) {

				delete this.pad[ p.id ];
				this._padChanged();

			}

		} );
		this._padRows.set( p.id, r );

	}

	_note( id, text, bad, kind = 'key' ) {

		const r = ( kind === 'pad' ? this._padRows : this._rows ).get( id );
		if ( ! r ) return;
		r.note.textContent = text;
		r.note.hidden = ! text;
		r.row.classList.toggle( 'is-bad', !! bad );

	}

	// repaint every key button from the model
	_refreshRows() {

		const conflicts = this.conflicts();
		for ( const [ id, r ] of this._rows ) {

			const listening = this._listen && this._listen.kind === 'key' && this._listen.id === id;
			r.key.classList.toggle( 'is-listening', !! listening );
			r.key.textContent = listening ? t( 'ctl.press', 'Press a key…' ) : this.label( id );
			r.key.classList.toggle( 'is-changed', this.isChanged( id ) );
			const clash = this.keysOf( id ).some( ( k ) => conflicts.has( k ) );
			r.key.classList.toggle( 'is-conflict', clash );
			r.key.setAttribute( 'aria-label', `${ this.nameOf( id ) }: ${ this.label( id ) }` );
			if ( clash && ! r.note.textContent ) {

				const k = this.keysOf( id ).find( ( x ) => conflicts.has( x ) );
				const names = conflicts.get( k ).filter( ( x ) => x !== id ).map( ( x ) => this.nameOf( x ) ).join( ', ' );
				r.row.dataset.clash = t( 'ctl.shared', 'Shares its key with {name}', { name: names } );
				r.key.dataset.tip = r.row.dataset.clash;

			} else {

				delete r.row.dataset.clash;
				delete r.key.dataset.tip;

			}

		}

		for ( const [ id, r ] of this._padRows ) {

			const listening = this._listen && this._listen.kind === 'pad' && this._listen.id === id;
			r.key.classList.toggle( 'is-listening', !! listening );
			r.key.textContent = listening ? t( 'ctl.press.pad', 'Press a button…' ) : padLabel( this.padButton( id ) );
			r.key.classList.toggle( 'is-changed', id in this.pad );

		}

	}

	_buildAccess( tab ) {

		const o = this.o;
		const pct = ( v ) => `${ Math.round( v * 100 ) }%`;

		// the language is a choice of the interface, not of the save: it is stored by i18n/index.js on its own
		// (wave 20D: the game is English only for now: no picker while a single language is offered, i18n OFFERED)
		this._lang = { id: getLang() };
		const offered = LANGS.filter( ( l ) => OFFERED.includes( l.id ) );
		if ( offered.length > 1 ) {

			const lang = tab.addFolder( t( 'acc.language', 'Language' ), { icon: 'sky' } );
			lang.addSelect( { label: t( 'acc.language', 'Language' ), object: this._lang, key: 'id', options: offered.map( ( l ) => ( { label: l.name, value: l.id } ) ), tooltip: t( 'acc.language.tip', 'The language of the menus, panels and prompts. Some island text is still English.' ), onChange: ( v ) => setLang( v ) } );

		}

		onLang( ( id ) => { this._lang.id = id; this.ui.refresh(); } );

		const vis = tab.addFolder( t( 'acc.visual', 'Display' ), { icon: 'eye' } );
		vis.addSlider( { label: t( 'acc.scale', 'Interface size' ), object: o, key: 'uiScale', min: 0.8, max: 1.6, step: 0.05, format: pct, tooltip: t( 'acc.scale.tip', 'Scales the HUD, the panels and the menus.' ), onChange: ( v ) => this.set( 'uiScale', v ) } );
		vis.addToggle( { label: t( 'acc.contrast', 'High contrast' ), object: o, key: 'highContrast', tooltip: t( 'acc.contrast.tip', 'Solid dark panels with white text and outlines.' ), onChange: ( v ) => this.set( 'highContrast', v ) } );
		vis.addSelect( { label: t( 'acc.cb', 'Colour-blind palette' ), object: o, key: 'colorBlind', options: [
			{ label: t( 'opt.off', 'Off' ), value: 'off' },
			{ label: t( 'acc.cb.rg', 'Red-green' ), value: 'redgreen' },
			{ label: t( 'acc.cb.by', 'Blue-yellow' ), value: 'blueyellow' },
		], tooltip: t( 'acc.cb.tip', 'Recolours the line tension band, the needle and the bite mark, and adds shapes so they do not depend on colour.' ), onChange: ( v ) => this.set( 'colorBlind', v ) } );

		const sub = tab.addFolder( t( 'acc.subs', 'Subtitles' ), { icon: 'sound' } );
		sub.addToggle( { label: t( 'acc.subs.on', 'Show subtitles' ), object: o, key: 'subtitles', tooltip: t( 'acc.subs.tip', 'Captain Roid speaks in clicks; the words appear here.' ), onChange: ( v ) => this.set( 'subtitles', v ) } );
		sub.addSelect( { label: t( 'acc.subs.size', 'Size' ), object: o, key: 'subtitleSize', options: [
			{ label: t( 'opt.small', 'Small' ), value: 'small' },
			{ label: t( 'opt.medium', 'Medium' ), value: 'medium' },
			{ label: t( 'opt.large', 'Large' ), value: 'large' },
			{ label: t( 'opt.huge', 'Huge' ), value: 'huge' },
		], onChange: ( v ) => this.set( 'subtitleSize', v ) } );
		sub.addSelect( { label: t( 'acc.subs.bg', 'Background' ), object: o, key: 'subtitleBg', options: [
			{ label: t( 'opt.none', 'None' ), value: 'none' },
			{ label: t( 'opt.shade', 'Shaded' ), value: 'shade' },
			{ label: t( 'opt.solid', 'Solid' ), value: 'solid' },
		], onChange: ( v ) => this.set( 'subtitleBg', v ) } );
		sub.addButton( { label: t( 'acc.subs.preview', 'Preview subtitle' ), icon: 'play', onClick: () => {

			if ( ! this.subtitle( t( 'acc.subs.sample', 'Good morning. The bite is better near the reef.' ), 3600, { speaker: t( 'subtitle.roid', 'Captain Roid' ), cue: '*click click*' } ) ) this.ui.toast( t( 'acc.subs.off', 'Subtitles are off' ), 1600 );

		} } );

		const mot = tab.addFolder( t( 'acc.motion', 'Motion' ), { icon: 'camera' } );
		mot.addToggle( { label: t( 'acc.reduce', 'Reduce motion' ), object: o, key: 'reduceMotion', tooltip: t( 'acc.reduce.tip', 'Steadier boat cameras (less roll and pitch at the helm), no sailing zoom and no camera shake.' ), onChange: ( v ) => this.set( 'reduceMotion', v ) } );
		mot.addSlider( { label: t( 'acc.shake', 'Camera shake' ), object: o, key: 'cameraShake', min: 0, max: 1, step: 0.05, format: pct, tooltip: t( 'acc.shake.tip', 'Strength of the shake on a strike, a snapped line and a near miss. 0 turns it off.' ), onChange: ( v ) => this.set( 'cameraShake', v ) } );

		const fish = tab.addFolder( t( 'acc.fishing', 'Fishing' ), { icon: 'anchor' } );
		fish.addToggle( { label: t( 'acc.assist', 'Fishing assist' ), object: o, key: 'fishingAssist', tooltip: t( 'acc.assist.tip', 'The line tension changes more slowly during a fight, which leaves more time to react. Off by default. Fights played with it on are marked in your save.' ), onChange: ( v ) => this.set( 'fishingAssist', v ) } );
		fish.addInfo( { label: t( 'acc.assisted', 'Assisted fights' ), get: () => {

			const st = this.app && this.app.game && this.app.game.state;
			return st && st.career ? ( st.career.assisted | 0 ) : 0;

		} } );
		fish.addButton( { label: t( 'acc.reset', 'Reset accessibility options' ), icon: 'reset', onClick: () => {

			this.resetOptions();
			this.ui.refresh();
			this.ui.toast( t( 'acc.reset.done', 'Accessibility options reset' ), 1600 );

		} } );

	}

}

const FEATURE_NAMES = { naval: 'Naval', melee: 'Melee', boarding: 'Boarding', notices: 'Notices', seaplane: 'Seaplane', map: 'World map', story: 'Story' };

function safeStorage() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}

// ---- styles (one block, injected once)

const CSS = /* css */`
.a11y-row { position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--tw-2); padding: calc(5 * var(--tw-u)) 0; }
.a11y-row + .a11y-row { border-top: 1px dashed var(--tw-line); }
.a11y-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--tw-fs-md); color: var(--tw-ink-2); }
.a11y-name[data-tip] { text-decoration: underline dotted rgba(200, 222, 232, 0.35); text-underline-offset: 3px; }
.a11y-key { flex: none; min-width: calc(76 * var(--tw-u)); max-width: 60%; height: calc(26 * var(--tw-u)); padding: 0 calc(10 * var(--tw-u)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	border-radius: calc(7 * var(--tw-u)); font: 600 var(--tw-fs-sm) var(--tw-mono); color: var(--tw-ink); background: var(--tw-fill-2); box-shadow: inset 0 0 0 1px var(--tw-line-2);
	cursor: pointer; transition: background var(--tw-fast), box-shadow var(--tw-fast), color var(--tw-fast); }
.a11y-key:hover { background: rgba(170, 215, 235, 0.18); }
.a11y-key.is-changed { color: var(--tw-sun); box-shadow: inset 0 0 0 1px rgba(var(--tw-sun-rgb), 0.5); }
.a11y-key.is-conflict { color: var(--tw-coral); box-shadow: inset 0 0 0 1px var(--tw-coral); }
.a11y-key.is-listening { color: #06281f; background: var(--tw-aqua); box-shadow: 0 0 0 3px rgba(var(--tw-aqua-rgb), 0.3); animation: a11y-pulse 1s ease-in-out infinite; }
@keyframes a11y-pulse { 50% { box-shadow: 0 0 0 5px rgba(var(--tw-aqua-rgb), 0.12); } }
.a11y-note { flex: 1 0 100%; font-size: var(--tw-fs-xs); line-height: 1.35; color: var(--tw-ink-3); }
.a11y-row.is-bad .a11y-note { color: var(--tw-coral); }
.a11y-row[data-clash]::after { content: attr(data-clash); flex: 1 0 100%; font-size: var(--tw-fs-xs); color: var(--tw-coral); }
.a11y-hint { opacity: 0.8; }
.a11y-hint .tw-info-value { display: none; }

/* captions */
.a11y-subs { position: absolute; left: 50%; bottom: max(calc(22 * var(--tw-u)), 3.5vh); z-index: 20; display: flex; flex-direction: column; align-items: center; gap: calc(6 * var(--tw-u));
	width: min(92vw, calc(820 * var(--tw-u))); transform: translateX(-50%); pointer-events: none; font-family: var(--tw-font); }
.a11y-sub { max-width: 100%; padding: 0.2em 0.7em; border-radius: calc(8 * var(--tw-u)); font-size: calc(15 * var(--tw-u) * var(--a11y-sub-scale, 1.1)); font-weight: 600; line-height: 1.35;
	text-align: center; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 2px #000; opacity: 0; transform: translateY(6px); transition: opacity 200ms, transform 200ms; }
.a11y-sub.is-in { opacity: 1; transform: none; }
.a11y-sub.is-out { opacity: 0; }
.a11y-sub b { margin-right: 0.45em; font-weight: 700; color: var(--tw-sun); }
.a11y-sub i { margin-right: 0.45em; opacity: 0.75; }
body.a11y-sub-bg-shade .a11y-sub { background: rgba(0, 0, 0, 0.55); }
body.a11y-sub-bg-solid .a11y-sub { background: rgba(0, 0, 0, 0.94); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35); text-shadow: none; }
.tw-root.is-photo .a11y-subs { display: none; }

/* high contrast: solid panels, white text and outlines */
body.a11y-contrast { --tw-glass: rgba(0, 0, 0, 0.94); --tw-ink: #fff; --tw-ink-2: rgba(255, 255, 255, 0.96); --tw-ink-3: rgba(255, 255, 255, 0.82); --tw-ink-4: rgba(255, 255, 255, 0.62);
	--tw-fill: rgba(255, 255, 255, 0.14); --tw-fill-2: rgba(255, 255, 255, 0.22); --tw-line: rgba(255, 255, 255, 0.5); --tw-line-2: rgba(255, 255, 255, 0.75);
	--tw-aqua: #4dfff0; --tw-aqua-rgb: 77, 255, 240; --tw-sun: #ffd24d; --tw-sun-rgb: 255, 210, 77; --tw-coral: #ff7b86; }
body.a11y-contrast .tw-glass { border: 2px solid rgba(255, 255, 255, 0.8); -webkit-backdrop-filter: none; backdrop-filter: none; }
body.a11y-contrast .gm-tension { box-shadow: 0 0 0 2px #fff; }
body.a11y-contrast .gm-needle { width: 5px; margin-left: -2.5px; background: #fff; box-shadow: 0 0 0 1px #000; }
body.a11y-contrast .gm-needle.is-hot { background: var(--tw-coral); }
body.a11y-contrast .a11y-sub { text-shadow: 0 0 3px #000, 0 0 3px #000; }

/* colour-blind palettes: blue / orange for red-green, teal / pink for blue-yellow; shapes carry the meaning too */
body.a11y-cb-rg { --a11y-good: #4aa8ff; --a11y-good-rgb: 74, 168, 255; --a11y-warn: #ffb000; --a11y-warn-rgb: 255, 176, 0; }
body.a11y-cb-by { --a11y-good: #22d3c5; --a11y-good-rgb: 34, 211, 197; --a11y-warn: #ff5d73; --a11y-warn-rgb: 255, 93, 115; }
body[class*='a11y-cb-'] .gm-band { background: rgba(var(--a11y-good-rgb), 0.4); border-left: 2px solid var(--a11y-good); border-right: 2px solid var(--a11y-good); }
body[class*='a11y-cb-'] .gm-danger { width: 10%; background: repeating-linear-gradient(135deg, rgba(var(--a11y-warn-rgb), 0.95) 0 3px, rgba(0, 0, 0, 0.6) 3px 6px); }
body[class*='a11y-cb-'] .gm-needle { width: 5px; margin-left: -2.5px; }
body[class*='a11y-cb-'] .gm-needle.is-hot { background: var(--a11y-warn); box-shadow: 0 0 10px var(--a11y-warn); }
body[class*='a11y-cb-'] .gm-fight-call.is-warn { color: var(--a11y-warn); }
body[class*='a11y-cb-'] .gm-fight-call.is-warn::before { content: '\\25B2\\00a0'; }
body[class*='a11y-cb-'] .gm-fight-call.is-good { color: var(--a11y-good); }
body[class*='a11y-cb-'] .gm-fight-call.is-good::before { content: '\\25CF\\00a0'; }
body[class*='a11y-cb-'] .gm-bite { color: var(--a11y-warn); text-shadow: 0 0 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000, 0 0 18px rgba(var(--a11y-warn-rgb), 0.8); }
body[class*='a11y-cb-'] .gm-cooler.is-full .gm-cooler-bar > span { background: var(--a11y-warn); }
`;

function injectCss( doc ) {

	if ( ! doc || doc.getElementById( 'a11y-style' ) ) return;
	const style = doc.createElement( 'style' );
	style.id = 'a11y-style';
	style.textContent = CSS;
	doc.head.append( style );

}

// the CSS is also needed before the settings are built (captions, contrast, palettes apply from the first frame)
export function installStyles( doc = typeof document !== 'undefined' ? document : null ) {

	injectCss( doc );

}
