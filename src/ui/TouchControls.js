import { icon } from './icons.js';
import { t } from '../i18n/index.js';
import { detectDevice, stickVector, stickKeys, lookDelta, boatThrottleKeys, snapThrottle, planeDragKeys, planeThrottleKeys,
	promptAction, contextButtons, buttonIsOn, fightOn, splitButtons, FoldState, TRAY_ORDER } from '../core/Touch.js';

// Touch controls for phones and tablets: everything feeds core/Input.js (the same key / button state the keyboard and
// the gamepad produce), so Game, melee, naval, the seaplane and the panels need no changes.
//
//   left part of the screen   a floating stick (it centres where the thumb lands): W A S D, past the outer ring Shift
//                             (sprint, boat boost). At the helm the stick steers (A / D); the lever on the right sets
//                             the throttle. In the seaplane the stick taxis / banks, the lever is the throttle.
//   right part of the screen  drag to look (sensitivity and invert in Settings > Game > Touch). Seaplane: the drag
//                             is the stick (up = nose down, down = nose up, sides bank).
//   action buttons            context-sensitive, bottom right: the game's own prompt (E / Space: "Board boat",
//                             "Talk to PoorGoat") is the wide button; Cast / Strike / Reel (left button, hold), Reel in,
//                             Board (B), the 1 / 2 choices and Fire stay on screen. The rest folds away (core/Touch.js
//                             splitButtons): Rod (R), Jump (Space), Dive (C), Dodge (Q), Guard (right button, hold), Gun,
//                             Aim, Port / Starboard guns (Z / X), View (V), Deck, Cockpit, Lights, Nav, Landing sit in a
//                             tray under a slim handle at the bottom edge: tap it or drag up to open, tap / drag down /
//                             5 s idle to close; the handle hides in a melee or boarding fight (Dodge / Guard come up).
//   top right                 one round toggle (sliders): Map (M), Journal (J), Cooler (I), Crew (K), Fullscreen and
//                             Menu (Esc: closes a panel, else pauses) unfold from it and fold back after 6 s idle;
//                             while a panel is open the row stays unfolded (Menu is the way out)
//   the minimap               tap: the world map (game/Minimap.js)
//   contextual (wave 20D)     a navy hail at the helm brings Heave to (the lever to stop) and Run (full ahead) for HAIL_MS,
//                             gone once answered, fired on or boarded; at the helm with chain / grape shot aboard a Shot
//                             button names the loaded kind and loads the next (the 1 / 2 / 3 keys). Never on screen otherwise.
//   driving (wave 22A)        only while you drive a car (cars.driving): a steering slider bottom left (drag, it springs back
//                             to centre; Tilt beside it steers with the phone instead, calibrated where you hold it), the
//                             pedals bottom right (Gas, Brake / reverse), Handbrake and Horn above them, Exit at the top of
//                             the cluster (away from the gas), Siren in a police car. They write cars.touch = { active, steer,
//                             throttle, brake, handbrake, horn }; the stick, the lever and the action buttons stand down;
//                             the right of the screen still turns the camera. carLayout( W, H, { k } ) is the geometry.
//   capsize (wave 22B)        beside your upturned hull the game's prompt is the wide button ("Right her", E); on the hull it
//                             reads "Hold to pull" (held: E down while the thumb stays) and Let go (Space) comes up beside
//                             it (capsizeButtons). Never on screen otherwise.
// Discrete buttons send a real key event (keydown on press, keyup on release, through the player's bindings) so the
// panels' own key listeners (the map's M, the menu's Escape) answer too; held state goes through input.setTouchKeys.
//
// Shown: Settings > Touch controls 'auto' (default: on a touch-first device, or once a finger is used on a touch
// laptop, hidden again when a hardware key or a gamepad is used), 'on' or 'off'. A portrait phone gets a rotate hint
// over the game (the game keeps running). The first touches resume the audio (iOS needs a gesture).
//
//   const tc = new TouchControls( { app, ui } );   tc.update( dt, { prompt, promptText } );   tc.set( key, value )
//   tc.active   tc.settings { mode, sensitivity, invert, size, haptics }   tc.dispose()

export const TOUCH_KEY = 'alpha-astra.touch';
export const TOUCH_DEFAULTS = { mode: 'auto', sensitivity: 1, invert: false, size: 1, haptics: true, tilt: false };

const STICK_ZONE = 0.42; // the left share of the screen that starts the stick
const BUTTONS = {
	cast: { label: 'Cast', button: 'left', big: true },
	jump: { label: 'Jump', code: 'Space', hold: true },
	dive: { label: 'Dive', code: 'KeyC', hold: true },
	rod: { label: 'Rod', code: 'KeyR' },
	reel: { label: 'Reel in', button: 'right' },
	dodge: { label: 'Dodge', code: 'KeyQ' },
	guard: { label: 'Guard', button: 'right' },
	board: { label: 'Board', code: 'KeyB' },
	fireL: { label: 'Port', code: 'KeyZ' },
	fireR: { label: 'Starboard', code: 'KeyX' },
	camera: { label: 'View', code: 'KeyV' },
	deck: { label: 'Deck', code: 'KeyQ' },
	fire: { label: 'Fire', button: 'left', big: true }, // a drawn pistol / musket
	flare: { label: 'Flare', code: 'KeyF', hold: true }, // wave 15D: held, like the key
	weapon: { label: 'Weapon', code: 'Digit0' }, // wave 18D: the next quick slot
	aim: { label: 'Aim', button: 'right' },
	draw: { label: 'Gun', code: 'KeyG' },
	emote: { label: 'Emote', code: 'Digit5' },
	bail: { label: 'Bail out', code: 'Quote' }, // (twice within 2 s)
	brake: { label: 'Brake', code: 'KeyB', hold: true }, // the Kestrel on the ground
	search: { label: 'Search', code: 'Semicolon', hold: true }, // the searchlight (held) // at the helm next to land: E steps ashore, this one keeps the deck
	cockpit: { label: 'Cockpit', code: 'Digit3' },
	lights: { label: 'Lights', code: 'KeyL' }, // boat: root's L toggles every hull's lights
	navLights: { label: 'Nav', code: 'KeyN' }, // seaplane cockpit keys (Seaplane.js COCKPIT_KEYS)
	landing: { label: 'Landing', code: 'Semicolon' },
	choice1: { label: '1', code: 'Digit1' },
	choice2: { label: '2', code: 'Digit2' },
	heave: { label: 'Heave to' }, // wave 20D: a navy hail's two answers (the lever, not a key)
	run: { label: 'Run' },
	shot: { label: 'Round' }, // the next cannon shot kind (Digit1..3, as on a keyboard)
	letGo: { label: 'Let go', code: 'Space' }, // wave 22B: off the upturned hull into the water
	heliRise: { label: 'Rise', code: 'ShiftLeft', hold: true },
	heliDescend: { label: 'Descend', code: 'KeyC', hold: true },
	heliHover: { label: 'Hover / brake', code: 'Space', hold: true },
	heliLeft: { label: 'Slide left', code: 'Comma', hold: true },
	heliRight: { label: 'Slide right', code: 'Period', hold: true },
};
export const HELICOPTER_BUTTONS = [ 'heliRise', 'heliDescend', 'heliHover', 'heliLeft', 'heliRight' ];
export function helicopterButtons( s = {} ) {
	if ( s.busy || s.mode !== 'helicopter' ) return new Set();
	const out = new Set( [ ...HELICOPTER_BUTTONS, 'camera' ] );
	if ( promptAction( s.prompt )?.code ) out.add( 'interact' );
	return out;
}
export const HAIL_MS = 25000; // how long a hail's answer buttons stay up
const SHOT_KINDS = [ 'round', 'chain', 'grape' ];

// the contextual buttons of wave 20D for a snapshot: Set of 'heave', 'run', 'shot'
export function hailButtons( s = {} ) {

	const out = new Set();
	if ( s.busy || s.mode !== 'boat' ) return out;
	if ( s.hail ) { out.add( 'heave' ); out.add( 'run' ); }
	if ( s.guns && s.shot && s.shot.kinds.length > 1 ) out.add( 'shot' );
	return out;

}

// the contextual buttons of wave 22B: Let go while you work an upturned hull (s.righting: capsize.righting())
export function capsizeButtons( s = {} ) {

	const out = new Set();
	if ( s.busy || ! s.righting ) return out;
	out.add( 'letGo' );
	return out;

}

// the shot kind after `sel` among those aboard (round shot is always there)
export function nextShot( sel, kinds ) {

	const i = kinds.indexOf( sel );
	return kinds[ ( i + 1 ) % kinds.length ] || 'round';

}
// the driving cluster (wave 22A): the boxes in px for a W x H screen at touch size k (Settings > Touch > size, 0.75..1.4),
// measured from the safe area's edges: anchor 'br' (ox from the right, oy from the bottom) or 'bl' (ox from the left).
// rect: the box on a screen without insets. Every target is >= 44 px (48 at the smallest size).
export const CAR_IDS = [ 'wheel', 'tilt', 'gas', 'brake', 'hand', 'horn', 'exit', 'siren' ];
export const CAR_LABELS = { tilt: 'Tilt', gas: 'Gas', brake: 'Brake', hand: 'Handbrake', horn: 'Horn', exit: 'Exit', siren: 'Siren' };
export function carLayout( W, H, { k = 1 } = {} ) {

	k = clamp( Number( k ) || 1, 0.75, 1.4 );
	const m = 16 * k, gap = 12 * k, top = 72; // (top: clear of the top-right row, 44 px at 12 px, and the safe area)
	const q = ( v ) => Math.max( 48, v ); // (never under 48 px, whatever the size setting)
	// the pedals narrow on a narrow screen (the slider keeps 120 px); the stack shortens on a short one (under the top row)
	const pw = q( Math.min( 76 * k, ( W - 2 * m - gap - 24 * k - 120 ) / 2 ) );
	const hs = Math.max( 0.4, Math.min( k, ( H - top - m - 2 * gap ) / ( 120 + 56 + 48 ) ) );
	const gh = q( 120 * hs ), bh = q( 96 * hs ), sm = q( 56 * hs ), ex = q( 48 * hs );
	const out = {};
	const br = ( id, ox, oy, w, h ) => { out[ id ] = { id, anchor: 'br', ox, oy, w, h, rect: { x: W - ox - w, y: H - oy - h, w, h } }; };
	const bl = ( id, ox, oy, w, h ) => { out[ id ] = { id, anchor: 'bl', ox, oy, w, h, rect: { x: ox, y: H - oy - h, w, h } }; };
	// right thumb: the pedals in the corner, the hand brake and the horn above them, Exit (and Siren) on top
	br( 'gas', m, m, pw, gh );
	br( 'brake', m + pw + gap, m, pw, bh );
	br( 'horn', m, m + gh + gap, pw, sm );
	br( 'hand', m + pw + gap, m + bh + gap, pw, sm );
	br( 'exit', m, m + gh + gap + sm + gap, pw, ex );
	br( 'siren', m + pw + gap, m + bh + gap + sm + gap, pw, ex );
	// left thumb: the steering slider, as wide as the screen allows beside the pedals (Tilt above its left end)
	const right = m + 2 * pw + gap + 24 * k;
	const ww = clamp( Math.min( W * 0.44, 300 * k, W - right - 2 * m ), 120, 300 * k );
	const wh = q( 88 * Math.min( k, Math.max( hs, 0.9 ) ) );
	bl( 'wheel', m, m, ww, wh );
	bl( 'tilt', m, m + wh + gap, q( 72 * k ), ex );
	return out;

}

// the slider's steer for a thumb dx px off its centre (half: half the slider's travel): + is left (the A key), a small dead zone
export function wheelSteer( dx, half ) {

	const v = clamp( - dx / Math.max( 1, half ), - 1, 1 );
	return Math.abs( v ) < 0.06 ? 0 : v;

}

// the tilt's steer from a deviceorientation event: landscape uses beta (the long axis), portrait gamma; zero: the calibration
export function tiltSteer( e, angle = 90, zero = 0, range = 24 ) {

	if ( ! e ) return 0;
	const a = ( ( Number( angle ) || 0 ) % 360 + 360 ) % 360;
	const raw = a === 90 ? - ( e.beta || 0 ) : a === 270 ? ( e.beta || 0 ) : - ( e.gamma || 0 );
	const v = clamp( ( raw - zero ) / range, - 1, 1 );
	return Math.abs( v ) < 0.08 ? 0 : v;

}

export function tiltRaw( e, angle = 90 ) {

	const a = ( ( Number( angle ) || 0 ) % 360 + 360 ) % 360;
	return ! e ? 0 : a === 90 ? - ( e.beta || 0 ) : a === 270 ? ( e.beta || 0 ) : - ( e.gamma || 0 );

}

const FOLD_IDLE = 5000, RAIL_IDLE = 6000; // ms without a press before the tray / the top row folds back
const ROW_B = new Set( [ 'cast', 'fire' ] ); // the big buttons sit in the lower row, the other primaries above them
const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );
const TOP = [
	{ id: 'map', code: 'KeyM', icon: 'compass', label: 'Map' },
	{ id: 'journal', code: 'KeyJ', icon: 'grid', label: 'Journal' },
	{ id: 'cooler', code: 'KeyI', icon: 'droplet', label: 'Cooler' },
	{ id: 'crew', code: 'KeyK', icon: 'walk', label: 'Crew' },
	{ id: 'fullscreen', icon: 'expand', label: 'Fullscreen' }, // no key: _fullscreen()
	{ id: 'menu', code: 'Escape', icon: 'pause', label: 'Menu' },
];
const KEY_NAMES = { Space: ' ', Escape: 'Escape', Digit1: '1', Digit2: '2' };

// iOS plays Web Audio through the ringer's silent switch only while a media element is playing: a silent looping
// <audio> started inside the first touch switches the audio session to playback. (Harmless elsewhere; once per page.)
let _mediaUnlocked = false;
function unlockMediaSession() {

	if ( _mediaUnlocked || typeof document === 'undefined' || typeof Audio !== 'function' ) return;
	_mediaUnlocked = true;
	try {

		// 0.05 s of silence, 8 kHz mono 8-bit PCM
		const a = new Audio( 'data:audio/wav;base64,UklGRk4BAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSoBAAB' + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=' );
		a.loop = true; a.volume = 0.01; a.setAttribute( 'playsinline', '' ); a.playsInline = true;
		const p = a.play();
		if ( p && p.catch ) p.catch( () => { _mediaUnlocked = false; } );

	} catch ( e ) { _mediaUnlocked = false; }

}

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const el = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

export class TouchControls {

	constructor( { app, ui, input = app && app.input, device = detectDevice(), storage = null } = {} ) {

		this.app = app;
		this.ui = ui;
		this.input = input;
		this.device = device;
		this.storage = storage ?? ( typeof localStorage !== 'undefined' ? localStorage : null );
		this.settings = { ...TOUCH_DEFAULTS, ...this._load() };
		this.active = false;
		this._fingerUsed = !! device.coarse; // a touch-first device starts with the controls
		this._stick = null; // { id, cx, cy, v }
		this._look = null; // { id, x, y, sx, sy }
		this._held = new Map(); // pointerId -> { el, def, fold }
		this.fold = new FoldState( { idle: FOLD_IDLE } ); // the bottom tray
		this.railFold = new FoldState( { idle: RAIL_IDLE } ); // the top-right toggle
		this._foldPtr = undefined;
		this._trayCount = 0;
		this._throttle = 0; // the boat lever (-1..1, notched)
		this._planeThrottle = 0;
		this._shown = new Set();
		this._promptCode = null;
		this._ac = new AbortController();
		if ( input ) input.touchMode = false;
		this._build();
		this._bind();
		this._apply();

	}

	// ---- settings

	set( key, value ) {

		if ( ! ( key in TOUCH_DEFAULTS ) ) return;
		this.settings[ key ] = value;
		this._save();
		this._apply();

	}

	_load() {

		try {

			const s = this.storage && this.storage.getItem( TOUCH_KEY );
			const o = s ? JSON.parse( s ) : null;
			return o && typeof o === 'object' ? o : {};

		} catch ( e ) { return {}; }

	}

	_save() {

		try { if ( this.storage ) this.storage.setItem( TOUCH_KEY, JSON.stringify( this.settings ) ); } catch ( e ) { /* private mode */ }

	}

	_apply() {

		const s = this.settings;
		this.root.style.setProperty( '--tc-k', String( clamp( Number( s.size ) || 1, 0.75, 1.4 ) ) );
		this._refreshActive();

	}

	// ---- DOM

	_build() {

		const root = this.root = el( 'div', 'tc-root is-away' );
		root.setAttribute( 'aria-hidden', 'true' );
		this.lookEl = el( 'div', 'tc-pad' );
		this.stickEl = el( 'div', 'tc-stick', '<span class="tc-ring"></span><span class="tc-base"></span><span class="tc-knob"></span>' );
		this.knobEl = this.stickEl.querySelector( '.tc-knob' );
		this.actions = el( 'div', 'tc-actions' );
		this.interactEl = el( 'button', 'tc-btn tc-interact', '<span></span>' );
		this.interactEl.type = 'button';
		this.interactText = this.interactEl.firstChild;
		this.btns = {};
		const rowA = this.rowA = el( 'div', 'tc-row tc-row-a' ), rowB = this.rowB = el( 'div', 'tc-row tc-row-b' );
		for ( const id of [ 'choice1', 'choice2', 'board', 'reel', 'heave', 'run', 'shot', 'letGo' ] ) rowA.append( this._btn( id ) );
		for ( const id of [ 'cast', 'fire' ] ) rowB.append( this._btn( id ) );
		for ( const id of HELICOPTER_BUTTONS ) {
			const b = this._btn( id ); b.style.minHeight = '48px'; b.style.minWidth = '64px'; rowB.append( b );
		}
		this.actions.append( this.interactEl, rowA, rowB );
		// the fold: a tray of the secondary buttons above a slim handle at the bottom edge
		this.tray = el( 'div', 'tc-tray' );
		for ( const id of TRAY_ORDER ) this.tray.append( this._btn( id ) );
		this.foldEl = el( 'div', 'tc-fold', `<span class="tc-fold-grip"></span>${ icon( 'chevron-down' ) }` );
		this.foldEl.setAttribute( 'role', 'button' );
		this.foldEl.setAttribute( 'aria-label', t( 'touch.fold', 'More controls' ) );
		this.foldEl.hidden = true;
		// the lever (boat: astern / stop / ahead / full; seaplane: 0..100 %)
		this.leverEl = el( 'div', 'tc-lever', '<span class="tc-lever-track"><i data-n="1"></i><i data-n="0.7"></i><i data-n="0"></i><i data-n="-0.6"></i></span><span class="tc-lever-thumb"></span><span class="tc-lever-val"></span>' );
		this.leverThumb = this.leverEl.querySelector( '.tc-lever-thumb' );
		this.leverVal = this.leverEl.querySelector( '.tc-lever-val' );
		this.top = el( 'div', 'tc-top' );
		this.topItems = el( 'div', 'tc-top-items' );
		this.topBtns = {};
		for ( const b of TOP ) {

			const e = el( 'button', 'tc-tbtn', icon( b.icon ) );
			e.type = 'button';
			e.setAttribute( 'aria-label', t( 'touch.' + b.id, b.label ) );
			e.dataset.id = b.id;
			this.topItems.append( e );
			this.topBtns[ b.id ] = e;

		}

		// the toggle (always there, rightmost): unfolds the row, folds it back on a second tap or after 6 s
		this.railBtn = el( 'button', 'tc-tbtn tc-rail', icon( 'sliders' ) );
		this.railBtn.type = 'button';
		this.railBtn.setAttribute( 'aria-label', t( 'touch.rail', 'Shortcuts' ) );
		this.railBtn.setAttribute( 'aria-expanded', 'false' );
		this.railBtn.dataset.id = 'rail';
		this.top.append( this.topItems, this.railBtn );

		// installed on the home screen (iOS standalone) the page already fills the screen
		if ( this.topBtns.fullscreen && typeof navigator !== 'undefined' && navigator.standalone ) this.topBtns.fullscreen.hidden = true;
		this.photoEl = el( 'button', 'tc-tbtn tc-photo', icon( 'close' ) );
		this.photoEl.type = 'button';
		this.rotateEl = el( 'div', 'tc-rotate', `<div class="tc-rotate-card"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 30a16 16 0 0 0 16 12M40 18A16 16 0 0 0 24 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M24 42l-4-3M24 42l-3 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span>${ t( 'touch.rotate', 'Turn your device sideways to play' ) }</span></div>` );
		// the driving cluster (wave 22A): hidden until you drive
		this.carEl = el( 'div', 'tc-car' );
		this.carEl.hidden = true;
		this.carBtns = {};
		for ( const id of CAR_IDS ) {

			const b = id === 'wheel'
				? el( 'div', 'tc-cbtn tc-wheel', '<span class="tc-wheel-track"></span><span class="tc-wheel-knob"></span>' )
				: el( 'button', 'tc-cbtn tc-c-' + id, `<span>${ t( 'touch.car.' + id, CAR_LABELS[ id ] ) }</span>` );
			if ( id !== 'wheel' ) b.type = 'button';
			b.dataset.car = id;
			b.setAttribute( 'aria-label', t( 'touch.car.' + id, CAR_LABELS[ id ] || 'Steer' ) );
			this.carEl.append( b );
			this.carBtns[ id ] = b;

		}

		this.wheelKnob = this.carBtns.wheel.querySelector( '.tc-wheel-knob' );
		this._car = { held: new Map(), wheel: null, steer: 0, tilt: null, tiltZero: null, layout: '' };
		root.append( this.lookEl, this.stickEl, this.leverEl, this.actions, this.tray, this.foldEl, this.top, this.photoEl, this.carEl, this.rotateEl );
		document.body.append( root );

	}

	_btn( id ) {

		const d = BUTTONS[ id ];
		const b = el( 'button', 'tc-btn' + ( d.big ? ' tc-big' : '' ), `<span>${ t( 'touch.' + id, d.label ) }</span>` );
		b.type = 'button';
		b.dataset.id = id;
		b.hidden = true;
		this.btns[ id ] = b;
		return b;

	}

	// ---- events

	_bind() {

		const sig = { signal: this._ac.signal };
		const pad = this.lookEl;
		pad.addEventListener( 'pointerdown', ( e ) => this._padDown( e ), sig );
		window.addEventListener( 'pointermove', ( e ) => this._move( e ), { ...sig, passive: false } );
		window.addEventListener( 'pointerup', ( e ) => this._up( e ), sig );
		window.addEventListener( 'pointercancel', ( e ) => this._up( e ), sig );
		// the buttons: press on pointerdown (no 300 ms click delay), release on up / cancel
		const press = ( e ) => {

			const b = e.target.closest && e.target.closest( '.tc-btn, .tc-tbtn' );
			if ( ! b ) return;
			e.preventDefault();
			e.stopPropagation();
			this._fingerUsed = true;
			try { b.setPointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
			this._press( e.pointerId, b );

		};

		for ( const c of [ this.actions, this.tray, this.top, this.photoEl ] ) c.addEventListener( 'pointerdown', press, sig );
		this.carEl.addEventListener( 'pointerdown', ( e ) => this._carDown( e ), sig );
		// the handle: a tap toggles, an upward drag opens, a downward drag closes (pointer capture, like the lever)
		const foldDown = ( e ) => {

			e.preventDefault();
			e.stopPropagation();
			this._fingerUsed = true;
			if ( this._foldPtr !== undefined || ! this.fold.down( e.clientY, now() ) ) return;
			try { e.currentTarget.setPointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
			this._foldPtr = e.pointerId;

		};

		this.foldEl.addEventListener( 'pointerdown', foldDown, sig );
		this.leverEl.addEventListener( 'pointerdown', ( e ) => {

			e.preventDefault();
			e.stopPropagation();
			try { this.leverEl.setPointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
			this._lever = e.pointerId;
			this._leverAt( e.clientY );

		}, sig );
		// no long-press menus, selection or double-tap zoom on the controls
		this.root.addEventListener( 'contextmenu', ( e ) => e.preventDefault(), sig );
		this.root.addEventListener( 'touchstart', ( e ) => { if ( e.cancelable ) e.preventDefault(); }, { ...sig, passive: false } );
		// a finger anywhere shows the controls (auto); a hardware key or a gamepad hides them
		window.addEventListener( 'pointerdown', ( e ) => {

			if ( e.pointerType === 'touch' ) {

				this._fingerUsed = true;
				this._refreshActive();

			}

		}, { ...sig, capture: true, passive: true } );
		window.addEventListener( 'keydown', ( e ) => {

			if ( ! e.isTrusted || e.ctrlKey || e.metaKey ) return;
			const tg = e.target;
			if ( tg && ( tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable ) ) return;
			if ( this._fingerUsed && this.settings.mode === 'auto' ) {

				this._fingerUsed = false;
				this._refreshActive();

			}

		}, { ...sig, capture: true, passive: true } );
		const pad2 = this.app && this.app.gamepad;
		if ( pad2 && pad2.onDeviceChange ) this._offPad = pad2.onDeviceChange( ( d ) => {

			if ( d !== 'keyboard' && this.settings.mode === 'auto' ) {

				this._fingerUsed = false;
				this._refreshActive();

			}

		} );
		// iOS starts audio only inside a gesture: every touch until it runs tries again
		const audio = () => {

			const a = this.app && this.app.audio;
			if ( a && ! a.enabled && a.resume ) a.resume();
			unlockMediaSession();

		};

		window.addEventListener( 'touchend', audio, { ...sig, capture: true, passive: true } );
		window.addEventListener( 'click', audio, { ...sig, capture: true, passive: true } );
		const orient = () => this._orient();
		window.addEventListener( 'resize', orient, sig );
		window.addEventListener( 'orientationchange', orient, sig );
		this._orient();

	}

	_padDown( e ) {

		if ( ! this.active ) return;
		e.preventDefault();
		if ( this._busy() ) return;
		this._fingerUsed = true;
		const w = window.innerWidth || 1;
		try { this.lookEl.setPointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
		if ( e.clientX < w * STICK_ZONE && ! this._stick && this._canMove() && this._mode() !== 'car' ) {

			this._stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY, v: null };
			this.stickEl.classList.add( 'is-on' );
			this.stickEl.style.setProperty( '--x', e.clientX + 'px' );
			this.stickEl.style.setProperty( '--y', e.clientY + 'px' );
			this._stickAt( e.clientX, e.clientY );

		} else if ( ! this._look ) {

			this._look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };

		}

	}

	_move( e ) {

		if ( this._car.wheel && e.pointerId === this._car.wheel.id ) {

			e.preventDefault();
			this._wheelAt( e.clientX );

		} else if ( this._stick && e.pointerId === this._stick.id ) {

			e.preventDefault();
			this._stickAt( e.clientX, e.clientY );

		} else if ( this._look && e.pointerId === this._look.id ) {

			e.preventDefault();
			const l = this._look;
			const dx = e.clientX - l.x, dy = e.clientY - l.y;
			l.x = e.clientX;
			l.y = e.clientY;
			if ( this._mode() === 'plane' ) this._sync(); // the drag is the seaplane's stick
			else if ( this.input ) {

				const d = lookDelta( dx, dy, this.settings );
				this.input.addTouchLook( d.x, d.y );

			}

		} else if ( this._lever !== undefined && e.pointerId === this._lever ) {

			e.preventDefault();
			this._leverAt( e.clientY );

		} else if ( this._foldPtr !== undefined && e.pointerId === this._foldPtr ) {

			e.preventDefault();
			if ( this.fold.move( e.clientY, now() ) ) this._paintFold();

		}

	}

	_up( e ) {

		const id = e.pointerId;
		if ( this._stick && id === this._stick.id ) {

			this._stick = null;
			this.stickEl.classList.remove( 'is-on', 'is-sprint' );
			this.stickEl.style.removeProperty( '--x' ); // (back to its resting place)
			this.stickEl.style.removeProperty( '--y' );
			this.knobEl.style.transform = '';
			this._sync();

		}

		if ( this._look && id === this._look.id ) {

			this._look = null;
			this._sync();

		}

		if ( this._lever !== undefined && id === this._lever ) this._lever = undefined;
		if ( this._foldPtr !== undefined && id === this._foldPtr ) {

			this._foldPtr = undefined;
			if ( e.type === 'pointercancel' ) this.fold.cancel();
			else this.fold.up( e.clientY, now() );
			this._paintFold();

		}

		const h = this._held.get( id );
		if ( h ) {

			this._held.delete( id );
			this._release( h );

		}

		this._carUp( id );

	}

	_stickAt( x, y ) {

		const s = this._stick;
		const r = this._stickRadius();
		const v = s.v = stickVector( x - s.cx, y - s.cy, r );
		this.knobEl.style.transform = `translate(${ v.kx.toFixed( 1 ) }px, ${ v.ky.toFixed( 1 ) }px)`;
		this.stickEl.classList.toggle( 'is-sprint', v.sprint );
		this._sync();

	}

	_stickRadius() {

		return 54 * clamp( Number( this.settings.size ) || 1, 0.75, 1.4 );

	}

	_leverAt( y ) {

		const r = this.leverEl.querySelector( '.tc-lever-track' ).getBoundingClientRect();
		const f = clamp( ( r.bottom - y ) / Math.max( 1, r.height ), 0, 1 ); // 0 bottom .. 1 top
		if ( this._mode() === 'plane' ) this._planeThrottle = Math.round( f * 20 ) / 20;
		else this._throttle = snapThrottle( f * 1.6 - 0.6 ); // bottom -0.6 astern .. top 1 full
		this._paintLever();
		this._sync();

	}

	_paintLever() {

		const plane = this._mode() === 'plane';
		const f = plane ? this._planeThrottle : ( this._throttle + 0.6 ) / 1.6;
		this.leverThumb.style.setProperty( '--f', f.toFixed( 3 ) );
		const v = this._throttle;
		this.leverVal.textContent = plane ? `${ Math.round( this._planeThrottle * 100 ) }%`
			: v >= 1 ? t( 'touch.full', 'Full' ) : v > 0 ? t( 'touch.ahead', 'Ahead' ) : v < 0 ? t( 'touch.astern', 'Astern' ) : t( 'touch.stop', 'Stop' );
		this.leverEl.classList.toggle( 'is-plane', plane );

	}

	// ---- buttons

	_press( pointerId, b ) {

		const id = b.dataset.id;
		if ( this.settings.haptics && typeof navigator !== 'undefined' && navigator.vibrate ) try { navigator.vibrate( 8 ); } catch ( e ) { /* no vibration */ }
		b.classList.add( 'is-down' );
		// a press in the tray / the top row restarts that fold's idle clock; a held one (jump, dive) keeps it open
		const fold = b.closest( '.tc-tray' ) ? this.fold : b.closest( '.tc-top' ) ? this.railFold : null;
		if ( fold ) fold.press( now() );
		if ( b === this.railBtn ) {

			this.railFold.toggle( now() );
			this._paintRail();
			this._held.set( pointerId, { el: b, fold } );
			return;

		}

		if ( b === this.photoEl ) {

			if ( this.ui && this.ui.setPhotoMode ) this.ui.setPhotoMode( false );
			this._held.set( pointerId, { el: b } );
			return;

		}

		if ( id === 'fullscreen' ) {

			this._fullscreen();
			this._held.set( pointerId, { el: b, fold } );
			return;

		}

		// a hail answered: the lever goes to stop (heave to) or full ahead (run), and the two buttons go
		if ( id === 'heave' || id === 'run' ) {

			this.answerHail( id );
			this._held.set( pointerId, { el: b } );
			return;

		}

		// the next shot kind aboard: its number key (the weapons feature picks it at the helm)
		if ( id === 'shot' ) {

			const sh = this._shotState();
			const code = sh ? 'Digit' + ( SHOT_KINDS.indexOf( nextShot( sh.sel, sh.kinds ) ) + 1 ) : null;
			if ( code ) this._key( code, 'keydown' );
			this._held.set( pointerId, { el: b, def: code ? { code } : null } );
			return;

		}

		let def = null;
		if ( b === this.interactEl ) {

			const a = this._promptAct;
			if ( a && a.code ) def = { code: a.code };

		} else if ( BUTTONS[ id ] ) def = BUTTONS[ id ];
		else def = TOP.find( ( x ) => x.id === id ) || null;

		if ( def && def.button ) this.input && this.input.setTouchButton( def.button, true );
		else if ( def && def.code ) this._key( def.code, 'keydown' );
		this._held.set( pointerId, { el: b, def, fold } );

	}

	// the Fullscreen button: the page goes fullscreen where the browser allows it (Android Chrome); an iPhone's Safari has
	// no fullscreen API, there the way is Share > Add to Home Screen (standalone: no browser bars)
	_fullscreen() {

		const doc = typeof document !== 'undefined' ? document : null;
		const can = doc && doc.documentElement && typeof doc.documentElement.requestFullscreen === 'function';
		if ( can && this.input && this.input.toggleFullscreen ) {

			const p = this.input.toggleFullscreen();
			if ( p && p.then ) p.then( () => { if ( ! doc.fullscreenElement && this.ui && this.ui.toast ) this.ui.toast( t( 'touch.fs_denied', 'Fullscreen is not allowed here: add the game to your home screen instead' ), 4200 ); } );
			return;

		}

		if ( this.ui && this.ui.toast ) this.ui.toast( t( 'touch.fs_ios', 'For fullscreen on iPhone / iPad: tap Share, then "Add to Home Screen", and open Hyptile Island from there' ), 6000 );

	}

	_release( h ) {

		h.el.classList.remove( 'is-down' );
		if ( h.fold ) h.fold.release( now() );
		const d = h.def;
		if ( ! d ) return;
		if ( d.button ) this.input && this.input.setTouchButton( d.button, false );
		else if ( d.code ) this._key( d.code, 'keyup' );

	}

	// a real key event through the player's bindings: Input and every panel's own listener see it
	_key( logical, type ) {

		const inp = this.input;
		const code = inp && inp.physicalFor ? inp.physicalFor( logical ) || logical : logical;
		const key = KEY_NAMES[ code ] || ( /^Key[A-Z]$/.test( code ) ? code.slice( 3 ).toLowerCase() : code );
		try {

			const ev = new KeyboardEvent( type, { code, key, bubbles: true, cancelable: true } );
			( document.body || document ).dispatchEvent( ev );

		} catch ( e ) { /* very old browser */ }

	}

	_releaseAll() {

		for ( const h of this._held.values() ) this._release( h );
		this._held.clear();
		this._stick = null;
		this._look = null;
		this._lever = undefined;
		this._foldPtr = undefined;
		this.fold.cancel();
		this.fold.close();
		this.fold.holds = 0;
		this.railFold.close();
		this.railFold.holds = 0;
		this._paintFold();
		this._paintRail();
		this.stickEl.classList.remove( 'is-on', 'is-sprint' );
		this.stickEl.style.removeProperty( '--x' );
		this.stickEl.style.removeProperty( '--y' );
		this.knobEl.style.transform = '';
		this._carRelease();
		if ( this.input ) this.input.releaseTouch();

	}

	answerHail( id ) {

		this._throttle = id === 'run' ? 1 : 0;
		this._hail = null;
		this._paintLever();
		this._sync();

	}

	// a navy hail meant for us (the navy feature's navyHail): its answer buttons for HAIL_MS; fired on / boarded: gone
	_onHail( e ) {

		const say = e && e.say;
		if ( say === 'hail' || say === 'warn' ) this._hail = { t: now(), say };
		else if ( say === 'fire' || say === 'board' ) this._hail = null;

	}

	_hailOn() {

		if ( ! this._hailSub ) {

			const f = this.app && this.app.features;
			if ( f && typeof f.on === 'function' ) {

				const off = f.on( 'navyHail', ( e ) => this._onHail( e ) );
				this._hailSub = typeof off === 'function' ? off : true;

			}

		}

		if ( this._hail && now() - this._hail.t > HAIL_MS ) this._hail = null;
		return !! this._hail;

	}

	// the loaded shot kind and the kinds aboard (round always; chain / grape while stocked, or free in the sandbox)
	_shotState() {

		const w = this._feature( 'weapons' );
		if ( ! w || ! w.shot ) return null;
		const free = !! w.sandbox;
		const kinds = SHOT_KINDS.filter( ( k ) => k === 'round' || free || ( w.shot[ k ] | 0 ) > 0 );
		return { sel: kinds.includes( w.shotSel ) ? w.shotSel : 'round', kinds };

	}

	_feature( n ) {

		const f = this.app && this.app.features;
		try { return f && f.get ? f.get( n ) : null; } catch ( e ) { return null; }

	}

	// ---- state

	_mode() {

		const app = this.app;
		if ( ! app || ! app.player ) return 'walk';
		if ( app.freeCam ) return 'free';
		// (a car is a vehicle of Player mode 'plane': the cars feature says whether it is one)
		if ( app.player.mode === 'plane' && this._feature( 'cars' )?.driving ) return 'car';
		if ( app.player.mode === 'plane' && ( app.player.vehicle?.kind === 'helicopter' || this._feature( 'helicopter' )?.piloted ) ) return 'helicopter';
		return app.player.mode || 'walk';

	}

	_canMove() {

		return ! this._busy();

	}

	// a panel, a menu or an overlay has the screen: the game controls stand down (the Menu button stays)
	_busy() {

		const app = this.app, ui = this.ui;
		if ( ! app || this._awayNow() ) return true;
		if ( ui && ( ui._start || ui.helpOpen || ui.panelOpen || ui.photoMode ) ) return true;
		const hud = app.game && app.game.hud;
		if ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen || hud.catchOpen ) ) return true;
		if ( app.chat && app.chat.isOpen ) return true;
		try { if ( app.features && app.features.panelOpen && app.features.panelOpen() ) return true; } catch ( e ) { /* ignore */ }
		return false;

	}

	// the main menu, the pause menu, the start overlay, or no game yet (?nomenu runs have no session but do play)
	_awayNow() {

		const app = this.app, ui = this.ui;
		return ! app || ! app.game || !! app.menuOpen || !! ( app.menu && app.menu.open ) || !! ( ui && ui._start );

	}

	_wanted() {

		const m = this.settings.mode;
		if ( m === 'off' ) return false;
		if ( m === 'on' ) return true;
		return this._fingerUsed;

	}

	_refreshActive() {

		const on = this._wanted();
		if ( on === this.active ) return;
		this.active = on;
		this.root.classList.toggle( 'is-active', on );
		if ( this.ui && this.ui.root ) this.ui.root.classList.toggle( 'is-touch', on );
		if ( this.input ) this.input.touchMode = on;
		if ( ! on ) this._releaseAll();
		this._orient();

	}

	_orient() {

		const w = window.innerWidth || 1, h = window.innerHeight || 1;
		// phones play in landscape: a hint over the game in portrait (it keeps running)
		this.rotateEl.classList.toggle( 'is-on', this.active && this.device.phone && h > w * 1.1 );

	}

	// the held keys from the stick, the drag and the lever (buttons send their own events)
	_sync() {

		if ( ! this.input ) return;
		const keys = new Set();
		const mode = this._mode();
		const busy = this._busy();
		if ( ! busy ) {

			const v = this._stick && this._stick.v;
			if ( mode === 'boat' ) {

				// the stick steers; the lever is the throttle (a stick pushed forward with the lever at stop still goes)
				if ( v && v.mag > 0 ) {

					const nx = v.x / v.mag;
					if ( nx < - 0.38 ) keys.add( 'KeyA' );
					if ( nx > 0.38 ) keys.add( 'KeyD' );

				}

				boatThrottleKeys( this._throttle, keys );
				if ( this._throttle === 0 && v && v.mag > 0 ) {

					const ny = v.y / v.mag;
					if ( ny < - 0.38 ) keys.add( 'KeyW' );
					if ( ny > 0.38 ) keys.add( 'KeyS' );
					if ( v.sprint ) keys.add( 'ShiftLeft' );

				}

			} else if ( mode === 'helicopter' ) {

				// Left stick flies forward/back and yaws. Its outer sprint ring never
				// climbs: altitude changes only on the explicit Rise/Descend buttons.
				stickKeys( v, keys ); keys.delete( 'ShiftLeft' );

			} else {

				stickKeys( v, keys );
				if ( mode === 'plane' ) {

					const l = this._look;
					if ( l ) planeDragKeys( l.x - l.sx, l.y - l.sy, 18, keys );
					const sp = this._seaplane();
					const cur = sp && sp.flight && sp.flight.controls ? sp.flight.controls.throttle : null;
					if ( cur !== null ) {

						keys.delete( 'ShiftLeft' ); // (Shift is the seaplane's throttle: the stick's ring must not push it)
						planeThrottleKeys( this._planeThrottle, cur, keys );

					}

				}

			}

		}

		this.input.setTouchKeys( keys );

	}

	_seaplane() {

		const f = this.app && this.app.features;
		try { return f && f.get ? f.get( 'seaplane' ) : null; } catch ( e ) { return null; }

	}

	// the game's state -> which buttons show (core/Touch.js contextButtons)
	snapshot( prompt ) {

		const app = this.app || {}, p = app.player || {}, g = app.game || {}, f = app.features;
		const get = ( n ) => { try { return f && f.get ? f.get( n ) : null; } catch ( e ) { return null; } };
		const rod = g.rod || null;
		const naval = get( 'naval' ), boarding = get( 'boarding' ), melee = get( 'melee' );
		let meleeOn = false;
		try { meleeOn = !! ( melee && ( ( melee.engaged && melee.engaged() ) || ( melee.dummy && melee.dummy.sparring ) ) ); } catch ( e ) { /* ignore */ }
		const ph = boarding ? boarding.phase : null;
		return {
			mode: this._mode(), busy: this._busy(), freeCam: !! app.freeCam, prompt,
			rod: !! ( rod && rod.equipped ), rodState: rod ? rod.state : null, canFish: !! g.canFish, fight: !! g.fight,
			guns: !! ( naval && naval.active && naval.playerGun && naval.playerGun.owned ),
			boardOffer: !! ( boarding && ph === 'idle' && boarding.offer ), boardFight: ph === 'fight',
			choices: ph === 'surrender' || !! ( boarding && boarding.hostile && boarding.hostile.phase === 'boarded' ),
			melee: meleeOn,
			helmAshore: !! ( app.player && app.player.helmAshore ),
			gunOwned: !! ( get( 'firearms' ) && get( 'firearms' ).anyOwned && get( 'firearms' ).anyOwned() ), canFlare: !! ( get( 'rescue' ) && get( 'rescue' ).canFire && get( 'rescue' ).canFire() ), gunDrawn: !! ( get( 'firearms' ) && get( 'firearms' ).drawn ), weaponMouse: !! ( get( 'weapons' ) && get( 'weapons' ).ownsMouse && get( 'weapons' ).ownsMouse() ), weaponOwned: !! ( get( 'weapons' ) && get( 'weapons' ).owned && Object.entries( get( 'weapons' ).owned ).some( ( [ k, v ] ) => v && k !== 'paddle' ) ),
			planeWheels: !! ( get( 'seaplane' ) && get( 'seaplane' ).flight && get( 'seaplane' ).flight.spec && get( 'seaplane' ).flight.spec.wheels ), planeSearch: !! ( get( 'seaplane' ) && get( 'seaplane' ).hasUpgrade && get( 'seaplane' ).hasUpgrade( 'searchlight' ) ),
			boatLights: !! app.boatLightsOn,
			planeNav: !! get( 'seaplane' )?.systems?.nav,
			planeLanding: !! get( 'seaplane' )?.systems?.landing,
			hail: this._hailOn ? this._hailOn() : false,
			shot: this._shotState ? this._shotState() : null,
			righting: !! ( get( 'capsize' ) && get( 'capsize' ).righting && get( 'capsize' ).righting() ),
		};

	}

	// per frame (ui/AppUI.js): prompt = the player's p.prompt, promptText = its translated text
	update( dt, { prompt = null, promptText = '' } = {} ) {

		if ( ! this.active ) return;
		// the main menu, the pause menu and the start overlay: no controls at all
		const away = this._awayNow();
		if ( away !== this._away ) {

			this._away = away;
			this.root.classList.toggle( 'is-away', away );
			if ( away ) this._releaseAll();

		}

		if ( away ) return;
		const s = this.snapshot( prompt );
		const show = s.mode === 'helicopter' ? helicopterButtons( s ) : contextButtons( s );
		const busy = s.busy;
		if ( s.mode === 'helicopter' && busy && ! this._lastBusy ) this._releaseAll();
		const t0 = now();
		const fight = fightOn( s );
		const { primary, tray } = splitButtons( show, s.mode, { fight } );
		for ( const id of hailButtons( s ) ) primary.add( id ); // wave 20D: contextual, in the row above the big buttons
		for ( const id of capsizeButtons( s ) ) primary.add( id ); // wave 22B: Let go on an upturned hull
		if ( primary.has( 'shot' ) && s.shot.sel !== this._shotLabel ) {

			this._shotLabel = s.shot.sel;
			this.btns.shot.firstChild.textContent = t( 'touch.shot.' + s.shot.sel, s.shot.sel === 'chain' ? 'Chain' : s.shot.sel === 'grape' ? 'Grape' : 'Round' );

		}

		this.root.classList.toggle( 'is-busy', busy );
		this.root.classList.toggle( 'is-photo', !! ( this.ui && this.ui.photoMode ) );
		// the wide button is the game's own prompt
		const act = this._promptAct = promptAction( prompt );
		const text = String( promptText || ( prompt && prompt.text ) || '' ).split( '·' )[ 0 ].trim();
		const iOn = show.has( 'interact' ) && !! text;
		if ( iOn && text !== this._iText ) {

			this._iText = text;
			this.interactText.textContent = text;

		}

		this.interactEl.hidden = ! iOn;
		// a button lives in its row (primary) or in the tray; a fight lifts Dodge / Guard / Aim out of the tray
		let moved = false;
		for ( const [ id, b ] of Object.entries( this.btns ) ) {

			const on = primary.has( id ) || tray.has( id );
			if ( b.hidden === on ) b.hidden = ! on;
			if ( ! on ) continue;
			b.classList.toggle( 'is-on', buttonIsOn( id, s ) );
			const home = tray.has( id ) ? this.tray : ROW_B.has( id ) ? this.rowB : this.rowA;
			if ( b.parentNode !== home && ! b.classList.contains( 'is-down' ) ) { home.append( b ); moved = true; }

		}

		if ( moved ) for ( const id of TRAY_ORDER ) { const b = this.btns[ id ]; if ( b.parentNode === this.tray && ! b.classList.contains( 'is-down' ) ) this.tray.append( b ); }
		// the fold: per-mode open state, no handle in a fight or with an empty tray, idle close
		const fold = this.fold, rail = this.railFold;
		this._trayCount = tray.size;
		fold.setMode( s.mode, t0 );
		fold.setHidden( fight || tray.size === 0, t0 );
		if ( busy ) { fold.close(); rail.keep( t0 ); }
		rail.keep( t0 ); // the top row stays open (user 2026-10-13: no toggles); the plane and the helm get compact buttons instead
		this.root.classList.toggle( 'is-compact', s.mode === 'plane' || s.mode === 'boat' );
		fold.tick( t0 );
		rail.tick( t0 );
		this._paintFold();
		this._paintRail();

		// the cast button says what the left button does now
		if ( show.has( 'cast' ) ) {

			const bite = this.app.game && this.app.game.bite;
			const fight = this.app.game && this.app.game.fight;
			const st = s.rodState;
			const label = st === 'fighting' ? ( fight && fight.kind === 'marker' ? t( 'touch.tap', 'Tap' ) : t( 'touch.reel', 'Reel' ) )
				: st === 'floating' && bite && bite.phase === 'take' ? t( 'touch.strike', 'Strike!' ) : t( 'touch.cast', 'Cast' );
			if ( label !== this._castLabel ) {

				this._castLabel = label;
				this.btns.cast.firstChild.textContent = label;

			}

			this.btns.cast.classList.toggle( 'is-hot', st === 'floating' && !! bite && bite.phase === 'take' );
			this.btns.cast.classList.toggle( 'is-warn', !! ( fight && fight.tension > ( fight.band ? fight.band[ 1 ] : 1 ) ) );

		}

		// the lever: the boat's notches or the seaplane's throttle
		const mode = s.mode;
		const lever = show.has( 'throttle' ) || show.has( 'planeThrottle' );
		if ( mode !== this._lastMode ) {

			// a new vehicle starts at stop; the seaplane at its current throttle
			if ( mode === 'boat' ) this._throttle = 0;
			if ( mode === 'plane' ) {

				const sp = this._seaplane();
				this._planeThrottle = sp && sp.flight && sp.flight.controls ? sp.flight.controls.throttle || 0 : 0;

			}

			this._lastMode = mode;
			this._paintLever();

		}

		this.leverEl.hidden = ! lever || busy;
		this.root.dataset.mode = mode;
		this._carUpdate( mode === 'car' && ! busy );
		// the plane's throttle follows the slider every frame (Shift / C held until it is there)
		if ( mode === 'plane' || busy !== this._lastBusy ) this._sync();
		this._lastBusy = busy;
		if ( busy && ( this._stick || this._look ) ) {

			this._stick = null;
			this._look = null;
			this.stickEl.classList.remove( 'is-on' );
			this._sync();

		}

	}

	_paintFold() {

		const f = this.fold, n = this._trayCount;
		if ( n === 0 && f.open ) f.close();
		const open = f.open && ! f.hidden;
		this.tray.classList.toggle( 'is-open', open );
		this.foldEl.classList.toggle( 'is-open', open );
		this.foldEl.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		const hide = n === 0 || f.hidden;
		if ( this.foldEl.hidden !== hide ) this.foldEl.hidden = hide;

	}

	_paintRail() {

		const open = this.railFold.open;
		this.top.classList.toggle( 'is-open', open );
		this.railBtn.setAttribute( 'aria-expanded', open ? 'true' : 'false' );

	}

	// ---- the driving cluster (wave 22A)

	_carDown( e ) {

		const b = e.target.closest && e.target.closest( '.tc-cbtn' );
		if ( ! b ) return;
		e.preventDefault();
		e.stopPropagation();
		this._fingerUsed = true;
		try { b.setPointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
		const id = b.dataset.car, C = this._car;
		if ( this.settings.haptics && typeof navigator !== 'undefined' && navigator.vibrate ) try { navigator.vibrate( id === 'horn' ? 14 : 8 ); } catch ( err ) { /* no vibration */ }
		if ( id === 'wheel' ) {

			const r = b.getBoundingClientRect();
			C.wheel = { id: e.pointerId, cx: r.left + r.width / 2, half: Math.max( 1, r.width / 2 - 26 ) };
			b.classList.add( 'is-down' );
			this._wheelAt( e.clientX );
			return;

		}

		b.classList.add( 'is-down' );
		C.held.set( e.pointerId, id );
		const cars = this._feature( 'cars' );
		if ( id === 'exit' ) this._key( 'KeyE', 'keydown' );
		else if ( id === 'siren' && cars && cars.toggleSiren ) cars.toggleSiren();
		else if ( id === 'tilt' ) this._tiltToggle();

	}

	_carUp( pointerId ) {

		const C = this._car;
		if ( C.wheel && C.wheel.id === pointerId ) {

			C.wheel = null;
			C.steer = 0;
			this.carBtns.wheel.classList.remove( 'is-down' );
			this.wheelKnob.style.transform = '';

		}

		const id = C.held.get( pointerId );
		if ( id === undefined ) return;
		C.held.delete( pointerId );
		if ( ! [ ...C.held.values() ].includes( id ) ) this.carBtns[ id ].classList.remove( 'is-down' );
		if ( id === 'exit' ) this._key( 'KeyE', 'keyup' );

	}

	_carRelease() {

		const C = this._car;
		if ( ! C ) return;
		for ( const p of [ ...C.held.keys() ] ) this._carUp( p );
		if ( C.wheel ) this._carUp( C.wheel.id );

	}

	_wheelAt( x ) {

		const W = this._car.wheel;
		const dx = clamp( x - W.cx, - W.half, W.half );
		this._car.steer = wheelSteer( dx, W.half );
		this.wheelKnob.style.transform = `translateX(${ dx.toFixed( 1 ) }px)`;

	}

	// Tilt: on (iOS asks once, inside this tap) / off; the first reading after it is switched on is straight ahead
	_tiltToggle() {

		const on = ! this.settings.tilt;
		const go = () => { this.set( 'tilt', on ); this._car.tiltZero = null; };
		const D = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
		if ( on && D && typeof D.requestPermission === 'function' ) {

			D.requestPermission().then( ( r ) => {

				if ( r === 'granted' ) go();
				else if ( this.ui && this.ui.toast ) this.ui.toast( t( 'touch.car.tiltDenied', 'Tilt steering needs the motion sensors: allow them in Settings' ), 3200 );

			} ).catch( () => {} );
			return;

		}

		go();

	}

	_tiltListen( on ) {

		const C = this._car;
		if ( on && ! C.tiltOff && typeof window !== 'undefined' ) {

			const f = ( e ) => { C.tilt = e; };
			window.addEventListener( 'deviceorientation', f );
			C.tiltOff = () => window.removeEventListener( 'deviceorientation', f );

		} else if ( ! on && C.tiltOff ) {

			C.tiltOff();
			C.tiltOff = null;
			C.tilt = null;

		}

	}

	_carSteer() {

		const C = this._car;
		if ( C.wheel ) return C.steer;
		if ( ! this.settings.tilt || ! C.tilt ) return 0;
		const angle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : ( typeof window !== 'undefined' ? window.orientation : 90 );
		if ( C.tiltZero === null ) C.tiltZero = tiltRaw( C.tilt, angle );
		return tiltSteer( C.tilt, angle, C.tiltZero );

	}

	// per frame: shown only while driving; the boxes follow the screen and the touch size; cars.touch written
	_carUpdate( on ) {

		const C = this._car, cars = this._feature( 'cars' );
		if ( this.carEl.hidden === on ) this.carEl.hidden = ! on;
		this._tiltListen( on && !! this.settings.tilt );
		if ( ! on ) {

			if ( C.held.size || C.wheel ) this._carRelease();
			const tt = cars && cars.touch;
			if ( tt && tt.active ) { tt.active = false; tt.steer = tt.throttle = tt.brake = 0; tt.handbrake = tt.horn = false; }
			return;

		}

		const W = window.innerWidth || 1, H = window.innerHeight || 1, k = Number( this.settings.size ) || 1;
		const key = W + 'x' + H + '@' + k;
		if ( key !== C.layout ) {

			C.layout = key;
			const L = carLayout( W, H, { k } );
			for ( const id of CAR_IDS ) {

				const b = this.carBtns[ id ], box = L[ id ], st = b.style;
				st.width = box.w.toFixed( 1 ) + 'px';
				st.height = box.h.toFixed( 1 ) + 'px';
				st.bottom = `calc(var(--tw-safe-b) + ${ box.oy.toFixed( 1 ) }px)`;
				if ( box.anchor === 'br' ) { st.right = `calc(var(--tw-safe-r) + ${ box.ox.toFixed( 1 ) }px)`; st.left = ''; } else { st.left = `calc(var(--tw-safe-l) + ${ box.ox.toFixed( 1 ) }px)`; st.right = ''; }

			}

		}

		const police = !! ( cars && cars.drive && cars.drive.kind === 'police' );
		if ( this.carBtns.siren.hidden === police ) this.carBtns.siren.hidden = ! police;
		this.carBtns.siren.classList.toggle( 'is-on', police && !! cars.siren );
		this.carBtns.tilt.classList.toggle( 'is-on', !! this.settings.tilt );
		if ( ! cars || ! cars.touch ) return;
		const held = new Set( C.held.values() ), tt = cars.touch;
		tt.active = true;
		tt.steer = this._carSteer();
		tt.throttle = held.has( 'gas' ) ? 1 : 0;
		tt.brake = held.has( 'brake' ) ? 1 : 0;
		tt.handbrake = held.has( 'hand' );
		tt.horn = held.has( 'horn' );

	}

	dispose() {

		this._releaseAll();
		this._tiltListen( false );
		this._ac.abort();
		if ( this._offPad ) this._offPad();
		if ( typeof this._hailSub === 'function' ) this._hailSub();
		if ( this.ui && this.ui.root ) this.ui.root.classList.remove( 'is-touch' );
		if ( this.input ) this.input.touchMode = false;
		this.root.remove();

	}

}
